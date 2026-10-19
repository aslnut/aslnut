// core › geometry › build › mesh: features → the numbers a mark uploads. Places are kept relative to the layer's
// origin (longitude in radians, Mercator y), so float32 keeps centimetres; the shader adds the view's offset. Long
// edges are split (each edge at its middle, until no piece is longer than `step` metres; an edge is split the same way
// in both triangles that share it, so there are no cracks) so areas and lines follow the terrain and the globe.
// Builders count, then allocate, then fill typed arrays: no array per point, no growing lists of numbers.
//   const o = new Origin(107.6, -6.9); const m = polygonMesh(o, rings, 250)
import { D, latOfMercY, mercY, R, wrap } from '../../space/geo.ts';
import type { Position } from '../../data/features.ts';
import { earcut } from './earcut.ts';

const LAT = 85.0511;
export class Origin {
  readonly lon0: number; readonly lat0: number; readonly m0: number;
  /** Mercator y near the origin's latitude as a series in the latitude's difference (radians): y' = sec, y'' = sec·tan,
   *  … to the fifth term; within half a degree of it (below 70°) it is under a millimetre from the exact value and
   *  costs a few multiplications, not a logarithm and a tangent per point */
  private readonly k: [number, number, number, number, number] | null;
  constructor(lon0: number, lat0: number) {
    this.lon0 = lon0; this.lat0 = Math.max(-85, Math.min(85, lat0)); this.m0 = mercY(this.lat0);
    const f = this.lat0 * D, t = Math.tan(f), c = 1 / Math.cos(f), t2 = t * t;
    this.k = Math.abs(this.lat0) < 70 ? [c, (c * t) / 2, (c * (2 * t2 + 1)) / 6, (c * t * (6 * t2 + 5)) / 24, (c * (24 * t2 * t2 + 28 * t2 + 5)) / 120] : null;
  }
  rel(lon: number, lat: number): [number, number] { return [this.x(lon), this.y(lat)]; }
  lonLat(x: number, y: number): [number, number] { return [this.lonOf(x), this.latOf(y)]; }
  /** a place's x (radians of longitude from the origin's) and y (Mercator from the origin's), one number at a time:
   *  nothing made per point */
  x(lon: number): number { const d = lon - this.lon0; return (d > -180 && d < 180 ? d : wrap(d)) * D; }
  y(lat: number): number {
    const d = lat - this.lat0, k = this.k;
    if (k && d > -0.5 && d < 0.5) { const p = d * D; return p * (k[0] + p * (k[1] + p * (k[2] + p * (k[3] + p * k[4])))); }
    return mercY(Math.max(-LAT, Math.min(LAT, lat))) - this.m0;
  }
  lonOf(x: number): number { return wrap(this.lon0 + x / D); }
  latOf(y: number): number { return latOfMercY(this.m0 + y); }
  /** the view's offset from the origin, in float64 (the shader adds it in float32) */
  offset(centreLon: number, centreLat: number): [number, number] { return [wrap(this.lon0 - centreLon) * D, this.m0 - mercY(Math.max(-LAT, Math.min(LAT, centreLat)))]; }
}
/** metres between two places given relative to the origin (Mercator: one unit is R · cos lat metres; cos lat is
 *  1 / cosh of the Mercator y) */
export function relMetres(o: Origin, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  return (Math.sqrt(dx * dx + dy * dy) * R) / Math.cosh(o.m0 + (ay + by) / 2);
}

/** a typed array that grows by doubling (a builder that cannot count ahead: triangles come out of earcut) */
export class Grow<T extends Float64Array | Float32Array | Uint32Array | Int32Array> {
  a: T; n = 0;
  constructor(a: T) { this.a = a; }
  /** room for k more */
  room(k: number): T {
    if (this.n + k > this.a.length) { const b = new (this.a.constructor as new (n: number) => T)(Math.max(this.n + k, this.a.length * 2)); b.set(this.a.subarray(0, this.n)); this.a = b; }
    return this.a;
  }
  push(v: number): void { this.room(1)[this.n++] = v; }
  push2(x: number, y: number): void { const a = this.room(2); a[this.n] = x; a[this.n + 1] = y; this.n += 2; }
  /** what was written, in an array of its own size (the array itself when it is full) */
  done(): T { return (this.n === this.a.length ? this.a : this.a.slice(0, this.n)) as T; }
  clear(): void { this.n = 0; }
}

export interface Mesh { xy: Float64Array; tris: Uint32Array | number[] }
/** x (radians of longitude) moved by whole turns to lie within half a turn of `near` */
export const unwrapNear = (x: number, near: number) => { while (x - near > Math.PI) x -= 2 * Math.PI; while (x - near < -Math.PI) x += 2 * Math.PI; return x; };
const KEY = 67108864;   // 2^26: an edge's two corners as one number (ids below 2^26)
/** one polygon (outer ring, then holes) → triangles, edges split to at most `step` metres. When no edge can be longer
 *  than the step (the polygon's whole box is shorter: every footprint, every block), earcut's triangles are taken as
 *  they are; else each long edge is split at its middle, the same middle for both triangles sharing it (one corner per
 *  edge, found by the edge's two corners) */
export function polygonMesh(o: Origin, rings: Position[][], step: number, maxDepth = 10): Mesh {
  let total = 0;
  const ends = new Int32Array(rings.length);
  for (let k = 0; k < rings.length; k++) {
    const r = rings[k]!, n = r.length > 1 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1] ? r.length - 1 : r.length;
    total += n; ends[k] = total;
  }
  const flat = new Float64Array(total * 2), holes: number[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let k = 0, at = 0; k < rings.length; k++) {
    const r = rings[k]!;
    if (k > 0) holes.push(at);
    // longitudes kept continuous along the ring (a ring touching ±180° must not jump across the map)
    let prev = NaN;
    for (let i = 0; at < ends[k]!; i++, at++) {
      let x = o.x(r[i]![0]); const y = o.y(r[i]![1]);
      if (prev === prev) x = unwrapNear(x, prev);
      prev = x; flat[2 * at] = x; flat[2 * at + 1] = y;
      if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  const t = earcut(flat, holes, 2);
  // the box's diagonal at its latitude nearest the equator (where a metre is the fewest units): no edge is longer
  const m0 = o.m0 + y0, m1 = o.m0 + y1, kMax = R / (m0 * m1 <= 0 ? 1 : Math.min(Math.cosh(m0), Math.cosh(m1)));
  if (!total || Math.hypot(x1 - x0, y1 - y0) * kMax <= step) return { xy: flat, tris: t };
  // long edges: split at their middles
  const xy = new Grow(new Float64Array(flat.length * 2)), tris = new Grow(new Uint32Array(t.length * 2)), mid = new Map<number, number>();
  xy.room(flat.length).set(flat); xy.n = flat.length;
  const middle = (a: number, b: number): number => {
    const key = a < b ? a * KEY + b : b * KEY + a; let m = mid.get(key);
    if (m === undefined) { const p = xy.a; m = xy.n / 2; xy.push2((p[2 * a]! + p[2 * b]!) / 2, (p[2 * a + 1]! + p[2 * b + 1]!) / 2); mid.set(key, m); }
    return m;
  };
  const len = (a: number, b: number) => { const p = xy.a; return relMetres(o, p[2 * a]!, p[2 * a + 1]!, p[2 * b]!, p[2 * b + 1]!); };
  const split = (a: number, b: number, c: number, depth: number) => {
    const ab = len(a, b), bc = len(b, c), ca = len(c, a), m = Math.max(ab, bc, ca);
    if (m <= step || depth >= maxDepth) { const r = tris.room(3); r[tris.n] = a; r[tris.n + 1] = b; r[tris.n + 2] = c; tris.n += 3; return; }
    if (m === ab) { const x = middle(a, b); split(a, x, c, depth + 1); split(x, b, c, depth + 1); }
    else if (m === bc) { const x = middle(b, c); split(a, b, x, depth + 1); split(a, x, c, depth + 1); }
    else { const x = middle(c, a); split(a, b, x, depth + 1); split(x, b, c, depth + 1); }
  };
  for (let i = 0; i < t.length; i += 3) split(t[i]!, t[i + 1]!, t[i + 2]!, 0);
  return { xy: xy.done(), tris: tris.done() };
}

export interface Strip { xy: Float64Array; /** metres from the start, per point */ dist: Float64Array; length: number; closed: boolean; /** per segment: 1 = not drawn (a cut) */ skip?: Uint8Array; /** per point: where it is among the input points (2.5 = halfway from point 2 to 3) */ idx: Float64Array }
/** a line (or a closed ring) → points relative to the origin, segments split to at most `step` metres, with the
 *  distance along it; `cuts` (per original segment) marks segments not to draw */
export function lineStrip(o: Origin, line: Position[], step: number, closed = false, cuts?: ArrayLike<number>): Strip {
  const s = new StripScratch(), n = s.read(o, line, step, closed);
  const xy = new Float64Array(n * 2), dist = new Float64Array(n), idx = new Float64Array(n), skip = new Uint8Array(Math.max(0, n - 1));
  s.points((k, x, y, d, at, cut) => { xy[2 * k] = x; xy[2 * k + 1] = y; dist[k] = d; idx[k] = at; if (k) skip[k - 1] = cut; }, cuts);
  return n < 2 ? { xy: new Float64Array(0), dist: new Float64Array(0), length: 0, closed, idx: new Float64Array(0) } : { xy, dist, length: s.length, closed, skip, idx };
}
/** one line read once (its places, its segments' lengths and how many pieces each is split into), then walked: the
 *  same numbers for a count and for a fill, kept in arrays reused line after line */
export class StripScratch {
  /** the input points (unwrapped x, y), the input segments' metres and pieces */
  private p = new Float64Array(64); private len = new Float64Array(32); private k = new Int32Array(32);
  private n = 0; private segs = 0; length = 0; closed = false;
  /** read a line; how many points it becomes (0: not a line) */
  read(o: Origin, line: Position[], step: number, closed: boolean): number {
    let n = line.length;
    if (closed && n > 1 && line[0]![0] === line[n - 1]![0] && line[0]![1] === line[n - 1]![1]) n--;
    this.closed = closed; this.n = n; this.length = 0; this.segs = 0;
    if (n < 2) { this.n = 0; return 0; }
    if (this.p.length < n * 2) this.p = new Float64Array(n * 4);
    const p = this.p;
    for (let i = 0; i < n; i++) { let x = o.x(line[i]![0]); if (i) x = unwrapNear(x, p[2 * i - 2]!); p[2 * i] = x; p[2 * i + 1] = o.y(line[i]![1]); }
    const segs = (this.segs = closed ? n : n - 1);
    if (this.len.length < segs) { this.len = new Float64Array(segs * 2); this.k = new Int32Array(segs * 2); }
    let pts = 1, d = 0;
    for (let s = 0; s < segs; s++) {
      const a = 2 * s, b = 2 * ((s + 1) % n), l = relMetres(o, p[a]!, p[a + 1]!, p[b]!, p[b + 1]!);
      const k = Math.max(1, Math.min(256, Math.ceil(l / step)));
      this.len[s] = l; this.k[s] = k; pts += k; d += l;
    }
    this.length = d;
    return pts;
  }
  /** the segments drawn (cuts left out) */
  drawn(cuts?: ArrayLike<number>): number { let c = 0; for (let s = 0; s < this.segs; s++) if (!(cuts && cuts[s])) c += this.k[s]!; return c; }
  /** each point in order: its index, place, metres along, where among the input points, and whether the segment
   *  ending at it is cut */
  points(f: (k: number, x: number, y: number, dist: number, at: number, cut: number) => void, cuts?: ArrayLike<number>): void {
    if (!this.n) return;
    const p = this.p, n = this.n;
    f(0, p[0]!, p[1]!, 0, 0, 0);
    let q = 1, d = 0;
    for (let s = 0; s < this.segs; s++) {
      const a = 2 * s, b = 2 * ((s + 1) % n), k = this.k[s]!, l = this.len[s]!, cut = cuts ? cuts[s] ?? 0 : 0;
      const ax = p[a]!, ay = p[a + 1]!, bx = p[b]!, by = p[b + 1]!;
      for (let j = 1; j <= k; j++) { const t = j / k; f(q++, ax + (bx - ax) * t, ay + (by - ay) * t, d + l * t, s + t, cut ? 1 : 0); }
      d += l;
    }
  }
}

/** a sensible step (metres) for features spanning `diag` metres: fine enough to follow hills and the globe's curve */
export const stepFor = (diag: number) => Math.max(40, Math.min(60000, diag / 96));
