// modules › world › earth › presets › built › buildings › plan: a house's plan from its measured footprint. Its frame
// faces the street on the footprint's own axes (x along the street, z towards it: the side of the footprint's
// best-fit box that looks most at its front), and it is built of rectangles that lie inside the footprint: the
// biggest one (the main body) and up to three more beside it (an L's leg, a back addition, a front wing). A house built
// on them stays inside its footprint, eaves and verandas included: next-door houses never run into each other.
//   const plan = housePlan(site.footprint, site.front)
//   b.frame({ turn: plan.turn }, (b) => { const m = plan.main; … build on m.x0 … m.z1 (m.z1 is its front) })
import { orientedBox, signedArea, type P2 } from '../../../shared/plan.ts';

/** a rectangle in the house's frame: x along its street, z towards it (z1 its front) */
export interface Rect { x0: number; x1: number; z0: number; z1: number }
/** where a wing meets the main body: on its front (towards the street), back, left or right (as seen from the street), or
 *  apart from it */
export type WingSide = 'front' | 'back' | 'left' | 'right' | 'apart';
export interface Wing extends Rect { side: WingSide }
export interface HousePlan {
  /** degrees round the vertical that turn the house's frame onto the place's (b.frame({ turn })) */
  turn: number;
  /** the frame's x (along the street) and z (towards it), unit vectors on the map (x east, z south) */
  x: P2; z: P2;
  /** the footprint in the house's frame */
  footprint: P2[];
  /** the biggest rectangle inside the footprint: the main body */
  main: Rect;
  /** more rectangles inside the footprint, biggest first, and where each meets the main body */
  wings: Wing[];
  /** the footprint's area (m²), the share of it the rectangles cover, the share of its best-fit box it fills */
  area: number; cover: number; rectangularity: number;
}
export interface PlanOptions {
  /** how many rectangles beside the main one, at most (default 3) */
  wings?: number;
  /** a wing's least area, m² (default 6) and least width, m (default 2) */
  minWing?: number; minWidth?: number;
  /** the grid the rectangles are first found on, m (default .4; each then grows to the footprint's edge) */
  step?: number;
}
export const PLAN: Required<PlanOptions> = { wings: 3, minWing: 6, minWidth: 2, step: 0.4 };
export const rectArea = (r: Rect) => (r.x1 - r.x0) * (r.z1 - r.z0);

/** a house's plan on its footprint (metres round its middle, x east, z south) facing `front` (the unit way to its street,
 *  or null: it faces the footprint's own +z side nearest south) */
export function housePlan(footprint: readonly P2[], front: P2 | readonly [number, number] | null, o: PlanOptions = DEFAULTS): HousePlan {
  // (a house is built twice, near and far, on the same footprint: the plan is made once; it is not to be changed)
  const c = last; if (c && c.footprint === footprint && c.f0 === front?.[0] && c.f1 === front?.[1] && c.o === o) return c.plan;
  const plan = makePlan(footprint, front, o); last = { footprint, f0: front?.[0], f1: front?.[1], o, plan };
  return plan;
}
const DEFAULTS: PlanOptions = {};
let last: { footprint: readonly P2[]; f0: number | undefined; f1: number | undefined; o: PlanOptions; plan: HousePlan } | null = null;
function makePlan(footprint: readonly P2[], front: P2 | readonly [number, number] | null, o: PlanOptions): HousePlan {
  const opt = { ...PLAN, ...o };
  const box = orientedBox(footprint), f: P2 = front ? [front[0], front[1]] : [0, 1];
  // the frame's z: the box's side that faces the front most
  const sides: P2[] = [[box.ux, box.uz], [-box.ux, -box.uz], [box.vx, box.vz], [-box.vx, -box.vz]];
  let z = sides[0]!, best = -Infinity; for (const s of sides) { const d = s[0] * f[0] + s[1] * f[1]; if (d > best + 1e-9) { best = d; z = s; } }
  // turnY(t) carries the frame's z onto (−sin t, cos t), its x onto (cos t, sin t)
  const turn = (Math.atan2(-z[0], z[1]) * 180) / Math.PI, x: P2 = [z[1], -z[0]];
  const local: P2[] = footprint.map(([px, pz]) => [px * x[0] + pz * x[1], px * z[0] + pz * z[1]]);
  const area = Math.abs(signedArea(local)), rects = rectangles(local, opt);
  const main = rects[0] ?? boxOf(local);
  const wings = rects.slice(1).map((r) => ({ ...r, side: sideOf(r, main) }));
  const cover = area > 0 ? Math.min(1, rects.reduce((s, r) => s + rectArea(r), 0) / area) : 0;
  return { turn, x, z, footprint: local, main, wings, area, cover, rectangularity: area / Math.max(1e-9, 4 * box.a * box.b) };
}
/** is a rectangle (in the house's frame) inside the plan's footprint, within `tol` m: its corners and sides (sampled
 *  every 50 cm) inside, no footprint corner inside it (a roof that reaches into the main body's stays on the lot) */
export function rectInside(plan: HousePlan, r: Rect, tol = 0.01): boolean {
  const q = { x0: r.x0 + tol, x1: r.x1 - tol, z0: r.z0 + tol, z1: r.z1 - tol }; if (q.x1 <= q.x0 || q.z1 <= q.z0) return true;
  const fp = plan.footprint, nx = Math.max(1, Math.ceil((q.x1 - q.x0) / 0.5)), nz = Math.max(1, Math.ceil((q.z1 - q.z0) / 0.5));
  for (let k = 0; k <= nx; k++) { const x = q.x0 + ((q.x1 - q.x0) * k) / nx; if (!inPoly(x, q.z0, fp) || !inPoly(x, q.z1, fp)) return false; }
  for (let k = 1; k < nz; k++) { const z = q.z0 + ((q.z1 - q.z0) * k) / nz; if (!inPoly(q.x0, z, fp) || !inPoly(q.x1, z, fp)) return false; }
  for (const [px, pz] of fp) if (inRect(px, pz, q, 0)) return false;
  return true;
}
/** a wing's roof reaching into the main body's (by up to `reach` m, less where that would leave the footprint) */
export function reachInto(plan: HousePlan, w: Rect, side: 'x0' | 'x1' | 'z0' | 'z1', reach: number): Rect {
  const sign = side === 'x0' || side === 'z0' ? -1 : 1;
  for (const k of [1, 0.75, 0.5, 0.25]) { const r = { ...w }; r[side] += sign * reach * k; if (rectInside(plan, r)) return r; }
  return { ...w };
}
const boxOf = (p: readonly P2[]): Rect => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of p) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return { x0, x1, z0, z1 }; };
const inPoly = (x: number, z: number, ring: readonly P2[]) => { let c = false; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i]!, [xj, zj] = ring[j]!; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; } return c; };
const inRect = (x: number, z: number, r: Rect, e: number) => x > r.x0 + e && x < r.x1 - e && z > r.z0 + e && z < r.z1 - e;
function sideOf(w: Rect, m: Rect): WingSide {
  const t = 0.3, overX = Math.min(w.x1, m.x1) - Math.max(w.x0, m.x0), overZ = Math.min(w.z1, m.z1) - Math.max(w.z0, m.z0);
  if (overX > 1 && Math.abs(w.z0 - m.z1) < t) return 'front';
  if (overX > 1 && Math.abs(w.z1 - m.z0) < t) return 'back';
  if (overZ > 1 && Math.abs(w.x1 - m.x0) < t) return 'left';
  if (overZ > 1 && Math.abs(w.x0 - m.x1) < t) return 'right';
  return 'apart';
}
/** the rectangles: the biggest inside the footprint, then the biggest in what is left (each found on a grid, then
 *  grown to the footprint's edges) */
function rectangles(poly: readonly P2[], o: Required<PlanOptions>): Rect[] {
  const bb = boxOf(poly), W = bb.x1 - bb.x0, H = bb.z1 - bb.z0; if (!(W > 0.5 && H > 0.5)) return [];
  // the grid a centimetre inside the footprint's box (its corners off the box's edges, where the footprint's own lie)
  const g = 0.01, X0 = bb.x0 + g, Z0 = bb.z0 + g, nx = Math.max(1, Math.round((W - 2 * g) / o.step)), nz = Math.max(1, Math.round((H - 2 * g) / o.step)), sx = (W - 2 * g) / nx, sz = (H - 2 * g) / nz;
  // a cell is free when its four corners and its middle are inside the footprint (a row at a time: where the
  // footprint's edges cross it, sorted, then which points of the row lie between an odd and an even crossing)
  const row = (z: number, n: number, x0: number, out: Uint8Array, at: number) => {
    const xs: number[] = [];
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) { const [xa, za] = poly[a]!, [xb, zb] = poly[b]!; if ((za > z) !== (zb > z)) xs.push(((xb - xa) * (z - za)) / (zb - za) + xa); }
    xs.sort((p, q) => p - q);
    for (let i = 0, k = 0; i < n; i++) { const x = x0 + i * sx; while (k < xs.length && xs[k]! <= x) k++; out[at + i] = k & 1; }
  };
  const corner = new Uint8Array((nx + 1) * (nz + 1)), middle = new Uint8Array(nx * nz);
  for (let j = 0; j <= nz; j++) row(Z0 + j * sz, nx + 1, X0, corner, j * (nx + 1));
  for (let j = 0; j < nz; j++) row(Z0 + (j + 0.5) * sz, nx, X0 + 0.5 * sx, middle, j * nx);
  const free = new Uint8Array(nx * nz), c = (i: number, j: number) => corner[j * (nx + 1) + i]!;
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) free[j * nx + i] = c(i, j) && c(i + 1, j) && c(i, j + 1) && c(i + 1, j + 1) && middle[j * nx + i] ? 1 : 0;
  const out: Rect[] = [];
  // (a candidate's cells are found a cell short of the least width: it grows to the footprint's edges after)
  for (let tries = 0; out.length <= o.wings && tries < o.wings + 4; tries++) {
    const first = !out.length, cells = biggest(free, nx, nz, sx, sz, first ? 0 : Math.max(0, o.minWidth - 1.5 * Math.max(sx, sz))); if (!cells) break;
    let r: Rect = { x0: X0 + cells.i0 * sx, x1: X0 + (cells.i1 + 1) * sx, z0: Z0 + cells.j0 * sz, z1: Z0 + (cells.j1 + 1) * sz };
    // (a wing's first cells may reach half a cell into a rectangle already taken: pulled back off it)
    for (const s of out) r = off(r, s);
    r = grow(r, poly, out, sx, sz);
    const ok = first || (rectArea(r) >= o.minWing && Math.min(r.x1 - r.x0, r.z1 - r.z0) >= o.minWidth);
    if (ok) out.push(r);
    // its cells are taken (a cell whose middle it covers; a candidate too small: its cells, so the next is another)
    const k = ok ? 0.5 : 0;
    for (let j = cells.j0 - 1; j <= cells.j1 + 1; j++) for (let i = cells.i0 - 1; i <= cells.i1 + 1; i++) { if (i < 0 || j < 0 || i >= nx || j >= nz) continue; const cx = X0 + (i + 0.5) * sx, cz = Z0 + (j + 0.5) * sz; if (ok ? cx > r.x0 - sx * k && cx < r.x1 + sx * k && cz > r.z0 - sz * k && cz < r.z1 + sz * k : i >= cells.i0 && i <= cells.i1 && j >= cells.j0 && j <= cells.j1) free[j * nx + i] = 0; }
    if (ok) for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { const cx = X0 + (i + 0.5) * sx, cz = Z0 + (j + 0.5) * sz; if (cx > r.x0 && cx < r.x1 && cz > r.z0 && cz < r.z1) free[j * nx + i] = 0; }
  }
  return out;
}
/** a rectangle pulled back off another it overlaps (along the axis it overlaps least) */
function off(r: Rect, s: Rect): Rect {
  const ox = Math.min(r.x1, s.x1) - Math.max(r.x0, s.x0), oz = Math.min(r.z1, s.z1) - Math.max(r.z0, s.z0); if (ox <= 0 || oz <= 0) return r;
  const q = { ...r };
  if (ox < oz) { if ((r.x0 + r.x1) / 2 > (s.x0 + s.x1) / 2) q.x0 = s.x1; else q.x1 = s.x0; }
  else if ((r.z0 + r.z1) / 2 > (s.z0 + s.z1) / 2) q.z0 = s.z1; else q.z1 = s.z0;
  return q;
}
/** the biggest rectangle of free cells (each side at least `minSide` m): the histogram method, row by row */
function biggest(free: Uint8Array, nx: number, nz: number, sx: number, sz: number, minSide: number): { i0: number; i1: number; j0: number; j1: number } | null {
  const h = new Int32Array(nx); let best: { i0: number; i1: number; j0: number; j1: number } | null = null, bestA = 0;
  const stack: number[] = [];
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) h[i] = free[j * nx + i] ? h[i]! + 1 : 0;
    stack.length = 0;
    for (let i = 0; i <= nx; i++) {
      const hi = i < nx ? h[i]! : 0;
      while (stack.length && h[stack[stack.length - 1]!]! >= hi) {
        const top = stack.pop()!, height = h[top]!, left = stack.length ? stack[stack.length - 1]! + 1 : 0, w = (i - left) * sx, d = height * sz, a = w * d;
        if (height > 0 && a > bestA && w >= minSide && d >= minSide) { bestA = a; best = { i0: left, i1: i - 1, j0: j - height + 1, j1: j }; }
      }
      stack.push(i);
    }
  }
  return best;
}
/** a rectangle grown out to the footprint's edges: each side as far as the strip it adds stays inside the footprint
 *  and off the others */
function grow(r0: Rect, poly: readonly P2[], others: readonly Rect[], sx: number, sz: number): Rect {
  const r = { ...r0 }, e = 0.005;
  const inside = (x: number, z: number) => { if (!inPoly(x, z, poly)) return false; for (const s of others) if (inRect(x, z, s, e)) return false; return true; };
  const okStrip = (q: Rect, k: 'x0' | 'x1' | 'z0' | 'z1') => {
    // its sides sampled every 35 cm, nudged in, but its outer side (the way it grows) exactly: the rectangle never
    // ends past the footprint's edge; no footprint corner inside it, off the others
    let x0 = q.x0 + (k === 'x0' ? 0 : e), x1 = q.x1 - (k === 'x1' ? 0 : e), z0 = q.z0 + (k === 'z0' ? 0 : e), z1 = q.z1 - (k === 'z1' ? 0 : e);
    // (a strip thinner than the nudge: its outer side alone)
    if (x1 < x0) { if (k === 'x0') x1 = x0; else if (k === 'x1') x0 = x1; else return true; }
    if (z1 < z0) { if (k === 'z0') z1 = z0; else if (k === 'z1') z0 = z1; else return true; }
    const nx = Math.max(1, Math.ceil((x1 - x0) / 0.35)), nz = Math.max(1, Math.ceil((z1 - z0) / 0.35));
    for (let i = 0; i <= nx; i++) { const x = x0 + ((x1 - x0) * i) / nx; if (!inside(x, z0) || !inside(x, z1)) return false; }
    for (let i = 1; i < nz; i++) { const z = z0 + ((z1 - z0) * i) / nz; if (!inside(x0, z) || !inside(x1, z)) return false; }
    for (const [px, pz] of poly) if (inRect(px, pz, q, e)) return false;
    for (const s of others) if (q.x0 < s.x1 - e && q.x1 > s.x0 + e && q.z0 < s.z1 - e && q.z1 > s.z0 + e) return false;
    return true;
  };
  const strip = (k: 'x0' | 'x1' | 'z0' | 'z1', t: number): Rect => k === 'x0' ? { ...r, x0: r.x0 - t, x1: r.x0 } : k === 'x1' ? { ...r, x0: r.x1, x1: r.x1 + t } : k === 'z0' ? { ...r, z0: r.z0 - t, z1: r.z0 } : { ...r, z0: r.z1, z1: r.z1 + t };
  for (let pass = 0; pass < 2; pass++) for (const k of ['x0', 'x1', 'z0', 'z1'] as const) {
    // as far as a cell and a half out, by halving
    const sign = k === 'x0' || k === 'z0' ? -1 : 1;
    let lo = 0, hi = (k[0] === 'x' ? sx : sz) * 1.5;
    if (okStrip(strip(k, hi), k)) lo = hi;
    else for (let it = 0; it < 7; it++) { const mid = (lo + hi) / 2; if (okStrip(strip(k, mid), k)) lo = mid; else hi = mid; }
    r[k] += sign * lo;
  }
  return r;
}
