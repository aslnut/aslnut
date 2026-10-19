// core › geometry › shapes › roofs: a roof over a rectangle as triangles, in its own frame (metres: x across its
// width, z across its depth, y up from its eaves, the rectangle centred). Forms: flat (a slab), gable, hip, dutch (a
// hip with a small gable at the top of each end), skillion (one slope), pyramidal. A pitched roof's ridge runs along
// the rectangle's long side unless asked otherwise. The slopes, the gable ends (walls: built in the wall's finish) and
// the soffit under the eaves come apart, every face turned outward.
//   const r = roofFaces('dutch', 12, 9, { pitch: 26 })   b.mesh(r.slopes, roof); b.mesh(r.ends, wall); b.mesh(r.under, soffit)
import type { V3 } from './parts.ts';

export type RoofForm = 'flat' | 'gable' | 'hip' | 'dutch' | 'skillion' | 'pyramidal';
export const ROOF_FORMS: readonly RoofForm[] = ['flat', 'gable', 'hip', 'dutch', 'skillion', 'pyramidal'];
export interface RoofFaceOptions {
  /** degrees (default 25): a skillion's slope, the others' slopes up to the ridge */
  pitch?: number;
  /** the ridge along the long side (default), the short side, or an axis (a gable to the street: along z) */
  ridge?: 'long' | 'short' | 'x' | 'z';
  /** metres over the eaves at the top, in place of the pitch's (a skillion's drop: its high side over its low) */
  rise?: number;
  /** a dutch roof: how far up its hips reach before the little gable, a share of the rise (default .5) */
  gablet?: number;
  /** the gable ends (and a skillion's walls) set in from the rectangle's edge by this much: the overhang at the rake
   *  (default 0) */
  endInset?: number;
  /** a skillion: its high side (default '+z') */
  high?: '+z' | '-z' | '+x' | '-x';
  /** a flat roof's thickness (default .25) */
  thick?: number;
}
export interface RoofFaces {
  /** the roof's own faces (every three points a triangle, turned outward) */
  slopes: V3[];
  /** gable ends, a dutch roof's gablets, a skillion's sides and high wall: walls (in the wall's finish) */
  ends: V3[];
  /** the underside of the eaves (a soffit: the roof is not paper-thin from below), facing down */
  under: V3[];
  /** its top over the eaves */
  rise: number;
  /** the axis its ridge runs along (a skillion: the axis of its high side; flat: 'x') */
  ridge: 'x' | 'z';
}
const D2R = Math.PI / 180;
/** where the ridge runs and how high the top is: what roofFaces would make, without the faces */
export function roofRise(form: RoofForm, w: number, d: number, o: RoofFaceOptions = {}): { rise: number; ridge: 'x' | 'z' } {
  const r = ridgeOf(form, w, d, o), A = (r === 'x' ? w : d) / 2, B = (r === 'x' ? d : w) / 2, t = Math.tan((o.pitch ?? 25) * D2R);
  if (form === 'flat') return { rise: o.thick ?? 0.25, ridge: 'x' };
  if (form === 'skillion') return { rise: o.rise ?? 2 * B * t, ridge: r };
  if (form === 'pyramidal') return { rise: o.rise ?? Math.min(A, B) * t, ridge: r };
  return { rise: o.rise ?? B * t, ridge: r };
}
function ridgeOf(form: RoofForm, w: number, d: number, o: RoofFaceOptions): 'x' | 'z' {
  // a skillion's "ridge" is its high side's axis: it slopes across the other
  if (form === 'skillion') { const h = o.high ?? '+z'; return h === '+z' || h === '-z' ? 'x' : 'z'; }
  const r = o.ridge ?? 'long';
  return r === 'x' || r === 'z' ? r : (w >= d) === (r === 'long') ? 'x' : 'z';
}
/** a roof over a w × d rectangle (its eaves), centred, y up from the eaves */
export function roofFaces(form: RoofForm, w: number, d: number, o: RoofFaceOptions = {}): RoofFaces {
  const { rise: R, ridge } = roofRise(form, w, d, o);
  // built along u (the ridge) and v (across it), then laid onto x and z
  const A = (ridge === 'x' ? w : d) / 2, B = (ridge === 'x' ? d : w) / 2, e = Math.max(0, Math.min(o.endInset ?? 0, A * 0.45));
  const P = (u: number, y: number, v: number): V3 => (ridge === 'x' ? [u, y, v] : [v, y, u]);
  const slopes: V3[] = [], ends: V3[] = [], under: V3[] = [];
  // every face outward: away from a point inside the roof
  const mid: V3 = [0, form === 'flat' ? R / 2 : R * 0.3, 0];
  const tri = (out: V3[], a: V3, b: V3, c: V3) => {
    const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    if (Math.hypot(n[0]!, n[1]!, n[2]!) < 1e-12) return;
    const m = [(a[0] + b[0] + c[0]) / 3 - mid[0], (a[1] + b[1] + c[1]) / 3 - mid[1], (a[2] + b[2] + c[2]) / 3 - mid[2]];
    if (n[0]! * m[0]! + n[1]! * m[1]! + n[2]! * m[2]! >= 0) out.push(a, b, c); else out.push(a, c, b);
  };
  const poly = (out: V3[], ...p: V3[]) => { for (let i = 1; i + 1 < p.length; i++) tri(out, p[0]!, p[i]!, p[i + 1]!); };
  // the soffit: the eaves' rectangle facing down
  const soffit = () => { const a = P(-A, 0, -B), b = P(A, 0, -B), c = P(A, 0, B), dd = P(-A, 0, B); const s = [a, b, c, a, c, dd]; for (let i = 0; i < 6; i += 3) { const p = s[i]!, q = s[i + 1]!, r = s[i + 2]!; const ny = (q[2] - p[2]) * (r[0] - p[0]) - (q[0] - p[0]) * (r[2] - p[2]); if (ny <= 0) under.push(p, q, r); else under.push(p, r, q); } };
  if (form === 'flat') {
    const t = R, c = (u: number, v: number, y: number) => P(u, y, v);
    poly(slopes, c(-A, -B, t), c(A, -B, t), c(A, B, t), c(-A, B, t));
    for (const [u0, v0, u1, v1] of [[-A, -B, A, -B], [A, -B, A, B], [A, B, -A, B], [-A, B, -A, -B]] as const) poly(slopes, c(u0, v0, 0), c(u1, v1, 0), c(u1, v1, t), c(u0, v0, t));
    soffit();
    return { slopes, ends, under, rise: R, ridge };
  }
  if (form === 'skillion') {
    // high on its `high` side (v = −B or +B in its frame), low on the other
    const h = o.high ?? '+z', up = h === '+z' || h === '+x' ? 1 : -1, y = (v: number) => (v * up > 0 ? R : 0);
    poly(slopes, P(-A, y(-B), -B), P(A, y(-B), -B), P(A, y(B), B), P(-A, y(B), B));
    // its sides (up to the slope) and its high wall, on the walls' lines (set in by the overhang)
    const ev = Math.min(e, B * 0.45), vh = up * (B - ev), vl = -up * (B - ev), yh = (R * (2 * B - ev)) / (2 * B), yl = (R * ev) / (2 * B);
    for (const u of [-(A - e), A - e]) poly(ends, P(u, 0, vl), P(u, 0, vh), P(u, yh, vh), P(u, yl, vl));
    poly(ends, P(-(A - e), 0, vh), P(A - e, 0, vh), P(A - e, yh, vh), P(-(A - e), yh, vh));
    soffit();
    return { slopes, ends, under, rise: R, ridge };
  }
  if (form === 'pyramidal') {
    const top = P(0, R, 0);
    tri(slopes, P(-A, 0, -B), P(A, 0, -B), top); tri(slopes, P(A, 0, -B), P(A, 0, B), top); tri(slopes, P(A, 0, B), P(-A, 0, B), top); tri(slopes, P(-A, 0, B), P(-A, 0, -B), top);
    soffit();
    return { slopes, ends, under, rise: R, ridge };
  }
  if (form === 'gable') {
    for (const s of [-1, 1]) poly(slopes, P(-A, 0, s * B), P(A, 0, s * B), P(A, R, 0), P(-A, R, 0));
    for (const u of [-(A - e), A - e]) tri(ends, P(u, 0, -B), P(u, 0, B), P(u, R, 0));
    soffit();
    return { slopes, ends, under, rise: R, ridge };
  }
  if (form === 'hip') {
    const r = Math.max(0, A - B);
    for (const s of [-1, 1]) { poly(slopes, P(-A, 0, s * B), P(A, 0, s * B), P(r, R, 0), P(-r, R, 0)); tri(slopes, P(s * A, 0, -B), P(s * A, 0, B), P(s * r, R, 0)); }
    soffit();
    return { slopes, ends, under, rise: R, ridge };
  }
  // dutch: hips up to k of the rise, then a small vertical gable (the gablet) under the ridge's ends
  const k = Math.max(0.2, Math.min(0.8, o.gablet ?? 0.5)), xg = A - k * B, vg = (1 - k) * B, yk = k * R;
  for (const s of [-1, 1]) {
    // a long slope: its middle up to the ridge, and a triangle at each end beside the hip (it is not convex: in three)
    poly(slopes, P(-xg, 0, s * B), P(xg, 0, s * B), P(xg, R, 0), P(-xg, R, 0));
    tri(slopes, P(xg, 0, s * B), P(A, 0, s * B), P(xg, yk, s * vg)); tri(slopes, P(-A, 0, s * B), P(-xg, 0, s * B), P(-xg, yk, s * vg));
    poly(slopes, P(s * A, 0, -B), P(s * A, 0, B), P(s * xg, yk, vg), P(s * xg, yk, -vg));
    tri(ends, P(s * xg, yk, -vg), P(s * xg, yk, vg), P(s * xg, R, 0));
  }
  soffit();
  return { slopes, ends, under, rise: R, ridge };
}
