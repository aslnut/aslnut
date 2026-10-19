// core › geometry › zones › rules › frontage: what stands behind a line it must not cross (a property line, a road
// reserve's edge), and the plot in front of it.
//   fitBehind(ring, inside, o)   an outline that reaches into the reserve: clipped when only a little of it does
//                                (footprint-clip, under `clipShare` of its area), else moved straight out of it by the
//                                least distance up to `setback` metres (setback), else nothing fits (omit)
//   FrontLines / front(x, z)     the nearest point of the line within `reach` and the way along it
//   frontagePlot(ring, front, o) the plot: the outline's span along its front line widened by `side` metres, from the
//                                line back to `back` metres behind the outline
//   splitPlots(plots)            two plots that overlap: each keeps the side of the bisector nearer its own middle
// Nothing here knows what the outline is (a house, a kiosk, a tank): the caller says what may not be crossed.
import { areaD, FillRule, intersectD, type PathD } from 'clipper2-ts';

export type P2 = [number, number];
const PREC = 2;
const toPath = (r: readonly P2[]): PathD => { const p = r.map((q) => ({ x: q[0], y: q[1] })); return areaD(p) < 0 ? p.reverse() : p; };
const fromPath = (p: PathD): P2[] => p.map((q) => [q.x, q.y] as P2);
const area = (r: readonly P2[]) => Math.abs(areaD(toPath(r)));
export const centroidOf = (r: readonly P2[]): P2 => { let x = 0, z = 0; for (const p of r) { x += p[0]; z += p[1]; } return [x / (r.length || 1), z / (r.length || 1)]; };

export interface Inside {
  /** m² of an outline in what may not be crossed */
  overlap(ring: readonly P2[]): number;
  /** the outline with it taken out: the pieces left, largest first */
  clip(ring: readonly P2[]): P2[][];
}
export interface Fit { ring: P2[]; how: 'clear' | 'footprint-clip' | 'setback' | 'omit'; share: number; moved: number; clippedM2: number }
/** an outline fitted behind what it may not cross. `clear(ring)`: may a moved outline stand there (no other
 *  building, say); `tolerance`: m² of overlap that is no overlap (the outlines' rounding) */
export function fitBehind(ring: readonly P2[], inside: Inside, o: { clipShare?: number; setback?: number; step?: number; dirs?: number; tolerance?: number; clear?: (ring: P2[]) => boolean } = {}): Fit {
  const clipShare = o.clipShare ?? 0.15, setback = o.setback ?? 3, step = o.step ?? 0.25, dirs = o.dirs ?? 16, tol = o.tolerance ?? 0.25, clear = o.clear ?? (() => true);
  const a = area(ring), inA = inside.overlap(ring), share = a > 0 ? inA / a : 1, copy = ring.map((p) => [p[0], p[1]] as P2);
  if (inA <= tol) return { ring: copy, how: 'clear', share, moved: 0, clippedM2: 0 };
  // a clip only takes area away; a setback must not stand where the outline did not (`clear`)
  if (share < clipShare) {
    const [best] = inside.clip(ring);
    if (best && best.length >= 3 && area(best) >= a * (1 - clipShare) - tol) return { ring: best, how: 'footprint-clip', share, moved: 0, clippedM2: a - area(best) };
  }
  for (let d = step; d <= setback + 1e-9; d += step) for (let k = 0; k < dirs; k++) {
    const dx = Math.cos((k / dirs) * 2 * Math.PI) * d, dz = Math.sin((k / dirs) * 2 * Math.PI) * d, moved = ring.map((p) => [p[0] + dx, p[1] + dz] as P2);
    if (inside.overlap(moved) <= tol && clear(moved)) return { ring: moved, how: 'setback', share, moved: d, clippedM2: 0 };
  }
  return { ring: copy, how: 'omit', share, moved: 0, clippedM2: 0 };
}

/** a line's segments in 25 m cells: the nearest point on it */
export class FrontLines {
  private cells = new Map<string, [P2, P2][]>();
  private cell: number;
  constructor(segments: Iterable<[P2, P2]>, cell = 25) {
    this.cell = cell;
    for (const s of segments) { const [a, b] = s; for (let i = Math.floor(Math.min(a[0], b[0]) / cell); i <= Math.floor(Math.max(a[0], b[0]) / cell); i++) for (let k = Math.floor(Math.min(a[1], b[1]) / cell); k <= Math.floor(Math.max(a[1], b[1]) / cell); k++) { const key = `${i},${k}`; let l = this.cells.get(key); if (!l) this.cells.set(key, (l = [])); l.push(s); } }
  }
  /** the nearest point within `reach` m: the point, the unit way along the line there, the distance */
  front(x: number, z: number, reach = 40): { p: P2; t: P2; d: number } | null {
    let best: { p: P2; t: P2; d: number } | null = null; const seen = new Set<[P2, P2]>();
    for (let i = Math.floor((x - reach) / this.cell); i <= Math.floor((x + reach) / this.cell); i++) for (let k = Math.floor((z - reach) / this.cell); k <= Math.floor((z + reach) / this.cell); k++) for (const s of this.cells.get(`${i},${k}`) ?? []) {
      if (seen.has(s)) continue; seen.add(s);
      const [a, b] = s, dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz; if (L2 < 0.25) continue;
      const u = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)), px = a[0] + dx * u, pz = a[1] + dz * u, d = Math.hypot(px - x, pz - z);
      if (d <= reach && (!best || d < best.d)) { const l = Math.sqrt(L2); best = { p: [px, pz], t: [dx / l, dz / l], d }; }
    }
    return best;
  }
}
export interface Plot { ring: P2[]; front: { p: P2; t: P2 }; span: [number, number] }
/** the plot of an outline on its front line: its span along the line widened by `side` m, from the line to `back` m
 *  behind the outline. `span` is along the line from `front.p` (the frontage, where a fence would go) */
export function frontagePlot(ring: readonly P2[], front: { p: P2; t: P2 }, o: { side?: number; back?: number } = {}): Plot {
  const side = o.side ?? 1.5, back = o.back ?? 3, [px, pz] = front.p, [tx, tz] = front.t, [cx, cz] = centroidOf(ring);
  const s0 = (cx - px) * -tz + (cz - pz) * tx > 0 ? 1 : -1, nx = -tz * s0, nz = tx * s0;
  let a0 = Infinity, a1 = -Infinity, d1 = 0; for (const [x, z] of ring) { const s = (x - px) * tx + (z - pz) * tz, d = (x - px) * nx + (z - pz) * nz; a0 = Math.min(a0, s); a1 = Math.max(a1, s); d1 = Math.max(d1, d); }
  a0 -= side; a1 += side; d1 += back;
  const L = (s: number, d: number): P2 => [px + tx * s + nx * d, pz + tz * s + nz * d];
  return { ring: [L(a0, 0), L(a1, 0), L(a1, d1), L(a0, d1)], front: { p: [px, pz], t: [tx, tz] }, span: [a0, a1] };
}
/** a plot with outlines taken out (the pieces largest first) */
export function clipPlot(plot: readonly P2[], inside: Inside): P2[] | null { const [best] = inside.clip(plot); return best && best.length >= 3 ? best : null; }
/** the plots that overlap (more than `tolerance` m²): each keeps the half-plane nearer its own middle. Gives the
 *  number of pairs split */
export function splitPlots(plots: { ring: P2[]; middle: P2 }[], tolerance = 0.5): { pairs: number; worstM2: number } {
  const cell = 30, grid = new Map<string, number[]>();
  const boxOf = (r: readonly P2[]) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, z0, x1, z1] as const; };
  plots.forEach((p, i) => { const [x0, z0, x1, z1] = boxOf(p.ring); for (let a = Math.floor(x0 / cell); a <= Math.floor(x1 / cell); a++) for (let b = Math.floor(z0 / cell); b <= Math.floor(z1 / cell); b++) { const k = `${a},${b}`; let l = grid.get(k); if (!l) grid.set(k, (l = [])); l.push(i); } });
  let pairs = 0, worst = 0;
  const half = (m: P2, o: P2, size: number): PathD => {
    // the half-plane nearer m than o, as a big square on m's side of the bisector
    const mx = (m[0] + o[0]) / 2, mz = (m[1] + o[1]) / 2, dx = m[0] - o[0], dz = m[1] - o[1], l = Math.hypot(dx, dz) || 1, ux = dx / l, uz = dz / l, vx = -uz, vz = ux;
    return toPath([[mx + vx * size, mz + vz * size], [mx + vx * size + ux * size, mz + vz * size + uz * size], [mx - vx * size + ux * size, mz - vz * size + uz * size], [mx - vx * size, mz - vz * size]]);
  };
  for (let i = 0; i < plots.length; i++) {
    const [x0, z0, x1, z1] = boxOf(plots[i]!.ring), near = new Set<number>();
    for (let a = Math.floor(x0 / cell); a <= Math.floor(x1 / cell); a++) for (let b = Math.floor(z0 / cell); b <= Math.floor(z1 / cell); b++) for (const j of grid.get(`${a},${b}`) ?? []) if (j > i) near.add(j);
    for (const j of near) {
      const A = plots[i]!, B = plots[j]!;
      const both = intersectD([toPath(A.ring)], [toPath(B.ring)], FillRule.NonZero, PREC), shared = Math.abs(both.reduce((s, p) => s + areaD(p), 0));
      if (shared <= tolerance) continue;
      pairs++; worst = Math.max(worst, shared);
      if (Math.hypot(A.middle[0] - B.middle[0], A.middle[1] - B.middle[1]) < 1e-6) continue;
      const size = 500;
      const a2 = intersectD([toPath(A.ring)], [half(A.middle, B.middle, size)], FillRule.NonZero, PREC).sort((p, q) => areaD(q) - areaD(p))[0];
      const b2 = intersectD([toPath(B.ring)], [half(B.middle, A.middle, size)], FillRule.NonZero, PREC).sort((p, q) => areaD(q) - areaD(p))[0];
      if (a2) A.ring = fromPath(a2); if (b2) B.ring = fromPath(b2);
    }
  }
  return { pairs, worstM2: worst };
}
