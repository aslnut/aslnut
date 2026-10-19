// core › geometry › landform › compose › exclusion: where things may not stand. Named layers of ground (the road
// reserve, carriageways, kerbs, footpaths, nature strips, water, buildings, …) as cell regions, asked three ways:
//   at(x, z)            which layers a point is in
//   overlap(ring, …)    how much of an outline lies in some layers (m²), and the outline with them taken out
//   nudge(x, z, ok, …)  the nearest point within a limit where `ok` holds (rings of 16 directions, outward)
// The layers come from anything with outlines; `layersOfPieces` makes them from a bake's typed pieces with a
// classifier you give (a kind → a layer name, or null to ignore it).
//   const ex = new Exclusion(layersOfPieces(pieces, (k) => k === 'carriageway' ? 'road' : null));
//   ex.at(12, 40) // ['road']
import { areaD, differenceD, EndType, FillRule, inflatePathsD, intersectD, JoinType, unionD, type PathD, type PathsD } from 'clipper2-ts';
import type { Piece } from '../../networks/bake-types.ts';
import { cellsOf, inPoly, type Poly } from '../../networks/union.ts';

export type P2 = [number, number];
const PREC = 2, CELL = 20;
const path = (pts: readonly (readonly number[])[]): PathD => pts.map((p) => ({ x: p[0]!, y: p[1]! }));
/** outers counter-clockwise (positive), so overlapping pieces add up under the non-zero rule */
const positive = (p: PathD): PathD => (areaD(p) < 0 ? [...p].reverse() : p);
const negative = (p: PathD): PathD => (areaD(p) > 0 ? [...p].reverse() : p);
export const ringArea = (ring: readonly P2[]): number => Math.abs(areaD(path(ring)));

/** a piece's ground outline(s): strips by their outer edges, polygons, areas (with holes), kerb edges as their band
 *  (the line and its inward offset), walls as a band of `wall` metres, boxes as their rectangle */
export function outlineOfPiece(p: Piece, o: { wall?: number; edge?: number } = {}): PathsD {
  const wall = o.wall ?? 0.3;
  if (p.t === 'strip') { const a = p.edges[0], b = p.edges[p.edges.length - 1]; if (!a || !b || a.length < 2) return []; return [positive(path([...a, ...[...b].reverse()]))]; }
  if (p.t === 'poly') return p.ring.length >= 3 ? [positive(path(p.ring))] : [];
  if (p.t === 'area') { const [outer, ...holes] = p.rings; if (!outer || outer.length < 3) return []; return [positive(path(outer)), ...holes.filter((h) => h.length >= 3).map((h) => negative(path(h)))]; }
  if (p.t === 'edge') {
    if (p.pts.length < 2) return [];
    const scale = o.edge ?? 1, inner = p.pts.map((q) => [q[0] + q[4] * scale, q[1] + q[5] * scale]);
    const band = path([...p.pts, ...inner.reverse()]);
    return Math.abs(areaD(band)) > 1e-3 ? [positive(band)] : inflatePathsD([path(p.pts)], 0.15, JoinType.Round, EndType.Butt, 2, PREC, 0.1);
  }
  if (p.t === 'wall') return p.line.length >= 2 ? inflatePathsD([path(p.line)], wall / 2, JoinType.Miter, EndType.Butt, 2, PREC, 0.1) : [];
  const c = Math.cos(p.turn), s = Math.sin(p.turn), P = (u: number, v: number): number[] => [p.at[0] + u * c - v * s, p.at[1] + u * s + v * c];
  return [positive(path([P(-p.d / 2, -p.w / 2), P(p.d / 2, -p.w / 2), P(p.d / 2, p.w / 2), P(-p.d / 2, p.w / 2)]))];
}
/** a bake's pieces as named layers: `classify` gives each piece its layer (or null: not an obstacle) */
export function layersOfPieces(pieces: readonly Piece[], classify: (piece: Piece) => string | null, o: { wall?: number } = {}): Record<string, PathsD> {
  const out: Record<string, PathsD> = {};
  for (const p of pieces) { const layer = classify(p); if (!layer) continue; (out[layer] ??= []).push(...outlineOfPiece(p, o)); }
  return out;
}

/** named layers as cell regions (20 m cells): point and outline queries */
export class Exclusion {
  readonly names: string[];
  private cells = new Map<string, Map<string, Poly[]>>();
  constructor(layers: Record<string, PathsD>) {
    this.names = Object.keys(layers);
    for (const [name, paths] of Object.entries(layers)) this.cells.set(name, cellsOf(paths.filter((p) => p.length >= 3), CELL));
  }
  /** is (x, z) in this layer */
  has(layer: string, x: number, z: number): boolean { const c = this.cells.get(layer)?.get(`${Math.floor(x / CELL)},${Math.floor(z / CELL)}`); return !!c && c.some((p) => inPoly(x, z, p)); }
  /** the layers (of those asked, default all) a point is in */
  at(x: number, z: number, layers: readonly string[] = this.names): string[] { return layers.filter((l) => this.has(l, x, z)); }
  /** the first of `layers` a disc of radius r touches (its middle and 8 points round it), or null */
  disc(x: number, z: number, r: number, layers: readonly string[] = this.names): string | null {
    for (const l of layers) {
      if (this.has(l, x, z)) return l;
      if (r > 0) for (let a = 0; a < 8; a++) if (this.has(l, x + Math.cos((a * Math.PI) / 4) * r, z + Math.sin((a * Math.PI) / 4) * r)) return l;
    }
    return null;
  }
  /** the polygons of a layer near an outline (its cells), as Clipper paths */
  private near(layer: string, ring: readonly P2[]): PathsD {
    const m = this.cells.get(layer); if (!m) return [];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const out: PathsD = [];
    for (let i = Math.floor(x0 / CELL); i <= Math.floor(x1 / CELL); i++) for (let k = Math.floor(z0 / CELL); k <= Math.floor(z1 / CELL); k++) for (const p of m.get(`${i},${k}`) ?? []) out.push(positive(p.outer), ...p.holes.map(negative));
    return out;
  }
  /** m² of an outline inside any of `layers` */
  overlap(ring: readonly P2[], layers: readonly string[] = this.names): number {
    const other = layers.flatMap((l) => this.near(l, ring)); if (!other.length) return 0;
    return Math.abs(intersectD([positive(path(ring))], unionD(other, [], FillRule.NonZero, PREC), FillRule.NonZero, PREC).reduce((a, p) => a + areaD(p), 0));
  }
  /** an outline with `layers` taken out: the pieces left, largest first */
  clip(ring: readonly P2[], layers: readonly string[] = this.names): P2[][] {
    const other = layers.flatMap((l) => this.near(l, ring)); if (!other.length) return [ring.map((p) => [p[0], p[1]] as P2)];
    const left = differenceD([positive(path(ring))], unionD(other, [], FillRule.NonZero, PREC), FillRule.NonZero, PREC).filter((p) => areaD(p) > 0);
    return left.sort((a, b) => areaD(b) - areaD(a)).map((p) => p.map((q) => [q.x, q.y] as P2));
  }
}

/** the nearest point to (x, z) within `limit` metres where `ok` holds: rings `step` apart, 16 directions each (the
 *  first found on the nearest ring); null when there is none. `ok` is asked of (x, z) itself first */
export function nudge(x: number, z: number, ok: (x: number, z: number) => boolean, o: { limit?: number; step?: number; dirs?: number } = {}): { at: P2; moved: number } | null {
  if (ok(x, z)) return { at: [x, z], moved: 0 };
  const limit = o.limit ?? 2, step = o.step ?? 0.25, dirs = o.dirs ?? 16;
  for (let d = step; d <= limit + 1e-9; d += step) for (let a = 0; a < dirs; a++) { const px = x + Math.cos((a / dirs) * 2 * Math.PI) * d, pz = z + Math.sin((a / dirs) * 2 * Math.PI) * d; if (ok(px, pz)) return { at: [px, pz], moved: d }; }
  return null;
}
/** m² of an outline inside some others (a few, near it: no cells) */
export function overlapWith(ring: readonly P2[], others: readonly (readonly P2[])[]): number {
  if (!others.length) return 0;
  return Math.abs(intersectD([positive(path(ring))], unionD(others.map((r) => positive(path(r))), [], FillRule.NonZero, PREC), FillRule.NonZero, PREC).reduce((a, p) => a + areaD(p), 0));
}
/** an outline with some others taken out: the pieces left, largest first */
export function clipBy(ring: readonly P2[], others: readonly (readonly P2[])[]): P2[][] {
  if (!others.length) return [ring.map((p) => [p[0], p[1]] as P2)];
  const left = differenceD([positive(path(ring))], unionD(others.map((r) => positive(path(r))), [], FillRule.NonZero, PREC), FillRule.NonZero, PREC).filter((p) => areaD(p) > 0);
  return left.sort((a, b) => areaD(b) - areaD(a)).map((p) => p.map((q) => [q.x, q.y] as P2));
}
