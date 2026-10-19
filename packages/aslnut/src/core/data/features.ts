// core › data › features: what every vector source gives a layer. A feature has a stable `id`, its `props`, and a
// `geometry` in longitude / latitude (GeoJSON's types; null for a row that is only numbers). Ids come from the data
// (GeoJSON `id`, a prop you name, or your function) so picking, joins, selection and live updates find the same
// feature every time.
//   normalize(geojson, { id: 'suburb_code' }) → Feature[]
import { AslnutError } from '../world/errors.ts';
import type { BBox } from '../space/geo.ts';

export type Position = [number, number] | [number, number, number];
export type Geometry =
  | { type: 'Point'; coordinates: Position }
  | { type: 'MultiPoint'; coordinates: Position[] }
  | { type: 'LineString'; coordinates: Position[] }
  | { type: 'MultiLineString'; coordinates: Position[][] }
  | { type: 'Polygon'; coordinates: Position[][] }
  | { type: 'MultiPolygon'; coordinates: Position[][][] };
// props are read loosely in style functions (d.props.rate): any, so plain JS and TS read alike
export type Props = Record<string, any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface Feature<P = Props> {
  id: string | number;
  props: P;
  geometry: Geometry | null;
  /** edges that are cuts, not real boundaries (a polygon split at a tile's edge): per polygon, per ring, per edge
   *  (1 = a cut, no outline drawn there) */
  cuts?: Uint8Array[][];
}
/** how an id is found: a prop name, or a function of the GeoJSON feature (or row) and its index */
export type IdRule = string | ((f: { id?: unknown; properties?: Props | null; [k: string]: unknown }, i: number) => string | number);

const fail = (msg: string, where: string, fix: string) => new AslnutError('E-DATA-002', msg, { where, fix });

/** a GeoJSON FeatureCollection, Feature, Geometry or array of Features → features with ids */
export function normalize(input: unknown, o: { id?: IdRule; where?: string } = {}): Feature[] {
  const where = o.where ?? 'data';
  const list: unknown[] = Array.isArray(input) ? input
    : input && typeof input === 'object' && (input as { type?: string }).type === 'FeatureCollection' ? (input as { features: unknown[] }).features
    : input && typeof input === 'object' && (input as { type?: string }).type === 'Feature' ? [input]
    : input && typeof input === 'object' && typeof (input as { type?: string }).type === 'string' ? [{ type: 'Feature', geometry: input, properties: {} }]
    : (() => { throw fail(`not GeoJSON (got ${input === null ? 'null' : typeof input})`, where, 'give a FeatureCollection, a Feature, a geometry or an array of features'); })();
  const out: Feature[] = [];
  const seen = new Set<string | number>();
  list.forEach((raw, i) => {
    const f = raw as { id?: unknown; geometry?: unknown; properties?: Props | null; props?: Props; cuts?: Uint8Array[][] };
    if (!f || typeof f !== 'object') throw fail(`feature ${i} is not an object`, where, 'each feature is { type: "Feature", geometry, properties }');
    // GeoJSON's `properties`, or aslnut's own features (`props`)
    const props = (f.properties ?? f.props ?? {}) as Props;
    let id: unknown = typeof o.id === 'function' ? o.id(f as never, i) : typeof o.id === 'string' ? props[o.id] : f.id;
    if (id === undefined || id === null || id === '') id = i;
    if (typeof id !== 'string' && typeof id !== 'number') id = String(id);
    // a repeated id: the later one is kept apart (picking needs one feature per id)
    if (seen.has(id as string | number)) id = `${id}#${i}`;
    seen.add(id as string | number);
    out.push({ id: id as string | number, props, geometry: checkGeometry(f.geometry, `${where} feature ${String(id)}`), ...(f.cuts ? { cuts: f.cuts } : {}) });
  });
  return out;
}

const isPos = (p: unknown): p is Position => Array.isArray(p) && p.length >= 2 && typeof p[0] === 'number' && typeof p[1] === 'number' && Number.isFinite(p[0]) && Number.isFinite(p[1]);
export function checkGeometry(g: unknown, where: string): Geometry | null {
  if (g === null || g === undefined) return null;
  const x = g as { type?: string; coordinates?: unknown; geometries?: unknown[] };
  const bad = (what: string) => fail(`${x.type}: ${what}`, where, 'coordinates are [lon, lat] pairs, as in GeoJSON');
  switch (x.type) {
    case 'Point': if (!isPos(x.coordinates)) throw bad('not a position'); break;
    case 'MultiPoint': case 'LineString': if (!Array.isArray(x.coordinates) || !x.coordinates.every(isPos)) throw bad('not a list of positions'); break;
    case 'MultiLineString': case 'Polygon': if (!Array.isArray(x.coordinates) || !x.coordinates.every((r) => Array.isArray(r) && r.every(isPos))) throw bad('not a list of lists of positions'); break;
    case 'MultiPolygon': if (!Array.isArray(x.coordinates) || !x.coordinates.every((p) => Array.isArray(p) && p.every((r) => Array.isArray(r) && r.every(isPos)))) throw bad('not a list of polygons'); break;
    case 'GeometryCollection': {
      // flattened: its polygons, lines or points (the first kind found) as one multi geometry
      const parts = (x.geometries ?? []).map((p) => checkGeometry(p, where)).filter(Boolean) as Geometry[];
      const polys = parts.flatMap((p) => (p.type === 'Polygon' ? [p.coordinates] : p.type === 'MultiPolygon' ? p.coordinates : []));
      if (polys.length) return { type: 'MultiPolygon', coordinates: polys };
      const lines = parts.flatMap((p) => (p.type === 'LineString' ? [p.coordinates] : p.type === 'MultiLineString' ? p.coordinates : []));
      if (lines.length) return { type: 'MultiLineString', coordinates: lines };
      const pts = parts.flatMap((p) => (p.type === 'Point' ? [p.coordinates] : p.type === 'MultiPoint' ? p.coordinates : []));
      return pts.length ? { type: 'MultiPoint', coordinates: pts } : null;
    }
    default: throw fail(`unknown geometry type '${x.type}'`, where, 'use Point, LineString, Polygon or their Multi forms');
  }
  return x as Geometry;
}

/** the polygons of a geometry (rings: outer first, then holes) */
export function polygonsOf(g: Geometry | null): Position[][][] {
  if (!g) return [];
  return g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : [];
}
/** the lines of a geometry (a polygon's rings count as closed lines) */
export function linesOf(g: Geometry | null, rings = true): Position[][] {
  if (!g) return [];
  switch (g.type) {
    case 'LineString': return [g.coordinates];
    case 'MultiLineString': return g.coordinates;
    case 'Polygon': return rings ? g.coordinates : [];
    case 'MultiPolygon': return rings ? g.coordinates.flat() : [];
    default: return [];
  }
}
/** the points of a geometry (a line's or area's middle when `centres`) */
export function pointsOf(g: Geometry | null, centres = false): Position[] {
  if (!g) return [];
  if (g.type === 'Point') return [g.coordinates];
  if (g.type === 'MultiPoint') return g.coordinates;
  if (!centres) return [];
  const c = centreOf(g); return c ? [c] : [];
}
export function bboxOf(g: Geometry | null, into?: BBox): BBox | null {
  if (!g) return into ?? null;
  const b: BBox = into ?? [Infinity, Infinity, -Infinity, -Infinity];
  const add = (p: Position) => { if (p[0] < b[0]) b[0] = p[0]; if (p[1] < b[1]) b[1] = p[1]; if (p[0] > b[2]) b[2] = p[0]; if (p[1] > b[3]) b[3] = p[1]; };
  switch (g.type) {
    case 'Point': add(g.coordinates); break;
    case 'MultiPoint': case 'LineString': g.coordinates.forEach(add); break;
    case 'MultiLineString': case 'Polygon': g.coordinates.forEach((r) => r.forEach(add)); break;
    case 'MultiPolygon': g.coordinates.forEach((p) => p.forEach((r) => r.forEach(add))); break;
  }
  return b;
}
/** a good place for a label or a marker: the largest polygon's area-weighted centre (inside for convex shapes), a
 *  line's middle point, a point itself */
export function centreOf(g: Geometry | null): Position | null {
  if (!g) return null;
  if (g.type === 'Point') return g.coordinates;
  if (g.type === 'MultiPoint') return g.coordinates[0] ?? null;
  const polys = polygonsOf(g);
  if (polys.length) {
    let best: Position[] | null = null, bestA = -1;
    for (const p of polys) { const a = Math.abs(ringArea(p[0]!)); if (a > bestA) { bestA = a; best = p[0]!; } }
    if (!best) return null;
    let cx = 0, cy = 0, a = 0;
    for (let i = 0, j = best.length - 1; i < best.length; j = i++) {
      const p = best[i]!, q = best[j]!, k = q[0] * p[1] - p[0] * q[1];
      a += k; cx += (q[0] + p[0]) * k; cy += (q[1] + p[1]) * k;
    }
    if (Math.abs(a) < 1e-18) return best[0] ?? null;
    const c: Position = [cx / (3 * a), cy / (3 * a)];
    return pointInRing(c, best) ? c : best[Math.floor(best.length / 2)]!;
  }
  const ls = linesOf(g);
  if (ls.length) { const l = ls.reduce((a, b) => (b.length > a.length ? b : a)); return l[Math.floor(l.length / 2)] ?? null; }
  return null;
}
/** signed area of a ring in degrees² (positive: counter-clockwise) */
export function ringArea(r: Position[]): number { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] - r[i]![0]) * (r[j]![1] + r[i]![1]); return a / 2; }
export function pointInRing(p: Position, r: Position[]): boolean {
  let inside = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]!, b = r[j]!;
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) inside = !inside;
  }
  return inside;
}
/** where a label of a feature sits, decided once: a point's place, a line's middle, and for an area a place well
 *  inside its largest part (holes respected): its centroid when that is inside and clear of the edges, else the
 *  inside point farthest from every edge on a grid over the part (the edges taken in degrees scaled to metres) */
export function anchorOf(g: Geometry | null): Position | null {
  const polys = polygonsOf(g);
  if (!polys.length) return centreOf(g);
  let best: Position[][] | null = null, bestA = -1;
  for (const p of polys) { const a = Math.abs(ringArea(p[0]!)); if (a > bestA) { bestA = a; best = p; } }
  if (!best) return null;
  const outer = best[0]!, k = Math.cos(((outer[0]?.[1] ?? 0) * Math.PI) / 180);
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  for (const q of outer) { if (q[0] < w) w = q[0]; if (q[0] > e) e = q[0]; if (q[1] < s) s = q[1]; if (q[1] > n) n = q[1]; }
  const inside = (p: Position) => pointInRing(p, outer) && !best!.slice(1).some((h) => pointInRing(p, h));
  /** the distance to the nearest edge (degrees, x scaled by cos(lat)) */
  const clear = (p: Position) => {
    let d = Infinity;
    for (const r of best!) for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
      const ax = r[j]![0] * k, ay = r[j]![1], bx = r[i]![0] * k, by = r[i]![1], px = p[0] * k, py = p[1];
      const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L)) : 0;
      const x = ax + t * dx - px, y = ay + t * dy - py, dd = x * x + y * y; if (dd < d) d = dd;
    }
    return Math.sqrt(d);
  };
  const c = centreOf({ type: 'Polygon', coordinates: best });
  const span = Math.min((e - w) * k, n - s);
  if (c && inside(c) && clear(c) > span * 0.2) return c;
  // the grid: the clearest inside point (a C-shaped suburb's middle may lie outside it)
  let at: Position | null = c && inside(c) ? c : null, far = at ? clear(at) : -1;
  const N = 12;
  for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
    const p: Position = [w + ((i + 0.5) / N) * (e - w), s + ((j + 0.5) / N) * (n - s)];
    if (!inside(p)) continue;
    const d = clear(p); if (d > far) { far = d; at = p; }
  }
  return at ?? c ?? outer[0] ?? null;
}
/** is a place inside a polygon geometry (holes respected) */
export function contains(g: Geometry | null, p: Position): boolean {
  for (const poly of polygonsOf(g)) if (pointInRing(p, poly[0]!) && !poly.slice(1).some((h) => pointInRing(p, h))) return true;
  return false;
}
