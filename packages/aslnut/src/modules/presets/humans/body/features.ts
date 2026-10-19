// modules › presets › humans › body › features: the parts of a head that are their own small meshes, placed from the
// head's rings on every generated body: the ears (a flap each side, a recessed bowl, the rim swept back) and the nose
// (a small wedge: bridge, tip, wings, base). Both follow every body and slider; skinned to the Head bone. Pure math.
import { headRings, vertexParts, PART_NAMES } from './generator.ts';

type P3 = [number, number, number];
const at = (B: ArrayLike<number>, i: number): P3 => [B[i * 3]!, B[i * 3 + 1]!, B[i * 3 + 2]!];
const add = (a: P3, b: P3, k = 1): P3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const sub = (a: P3, b: P3): P3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const lerp = (a: P3, b: P3, t: number): P3 => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const dot = (a: P3, b: P3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: P3, b: P3): P3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: P3): P3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };

let headVerts: number[] | null = null;
/** the head's landmarks on a body: chin (the lowest front point) → crown; the eye line half way; the nose tip and
 *  the mouth where the face decal's rows put them; the chin's and the eye's ring */
export function headMeasures(B: ArrayLike<number>): { chin: number; crown: number; Hh: number; eye: number; nose: number; mouth: number; kChin: number; kEye: number } {
  const R = headRings(), y = (i: number) => B[i * 3 + 1]!;
  headVerts ??= [...vertexParts()].flatMap((p, v) => (PART_NAMES[p] === 'head' ? [v] : []));
  let kChin = 1; for (let k = 1; k < R.length; k++) if (y(R[k]![0]!) < y(R[kChin]![0]!)) kChin = k;
  let crown = -Infinity; for (const v of headVerts) crown = Math.max(crown, y(v));
  const chin = y(R[kChin]![0]!), Hh = crown - chin, eye = chin + Hh / 2, z1 = eye + (0.43 / 0.57) * (eye - chin);
  let kEye = 0; for (let k = 0; k < R.length; k++) if (Math.abs(y(R[k]![6]!) - eye) < Math.abs(y(R[kEye]![6]!) - eye)) kEye = k;
  return { chin, crown, Hh, eye, nose: z1 - 0.65 * (z1 - chin), mouth: z1 - 0.83 * (z1 - chin), kChin, kEye };
}

// the ear's profile: heights along it (lobe → top), the rim's width at each, rows from root to rim (u: a share of the
// rim's width; out: lift off the head as a share of the ear's height; row 1 the recessed bowl)
const EAR_V = [0, 0.14, 0.32, 0.52, 0.72, 0.88, 1.0];
const EAR_W = [0.36, 0.52, 0.56, 0.62, 0.68, 0.6, 0.3];
const EAR_ROWS = [{ u: 0, out: 0 }, { u: 0.55, out: 0.08 }, { u: 1, out: 0.3 }];
/** the ears' triangles (both ears, front and back faces, the rim closed) */
export function earIndex(): number[] {
  const nv = EAR_V.length, nr = EAR_ROWS.length, per = nv * nr, idx: number[] = [];
  for (let s = 0; s < 2; s++) for (let f = 0; f < 2; f++) {
    const o = (s * 2 + f) * per;
    for (let r = 0; r < nr - 1; r++) for (let v = 0; v < nv - 1; v++) {
      const a = o + r * nv + v, b = a + 1, c = a + nv, d = c + 1;
      if (f === 0) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
    }
  }
  for (let s = 0; s < 2; s++) { const o0 = s * 2 * per + (nr - 1) * nv, o1 = o0 + per; for (let v = 0; v < nv - 1; v++) idx.push(o0 + v, o1 + v, o0 + v + 1, o0 + v + 1, o1 + v, o1 + v + 1); }
  return idx;
}
/** the ears' vertices on a body (P: its parameters: ear size, out, low) */
export function ears(B: ArrayLike<number>, P: Record<string, number>): Float32Array {
  const R = headRings(), M = headMeasures(B), Hh = M.Hh, H = Hh * 0.3 * (1 + 0.18 * (P.ear! - 1));
  const out = new Float32Array(EAR_ROWS.length * EAR_V.length * 2 * 2 * 3); let w = 0;
  for (const [side, col, colBack] of [[1, 6, 7], [-1, 18, 17]] as const) {
    // the root line on the head, a little behind the side's middle, as a function of height
    const S = R.map((ring) => lerp(at(B, ring[col]!), at(B, ring[colBack]!), 0.3));
    const rootAt = (y: number): P3 => { for (let k = 0; k < S.length - 1; k++) { const a = S[k]!, b = S[k + 1]!; if (y >= a[1] && y <= b[1]) return lerp(a, b, (y - a[1]) / (b[1] - a[1] || 1)); } return y < S[0]![1] ? S[0]! : S[S.length - 1]!; };
    const yTop = M.eye + Hh * (0.01 - 0.06 * P.ear_y!), yLow = yTop - H, up: P3 = [0, 1, 0];
    const bk = sub(at(B, R[M.kEye]![colBack]!), at(B, R[M.kEye]![col]!)); bk[1] = 0; const back = norm(bk);
    const ow: P3 = [side, 0, 0], outw = norm(add(ow, back, -dot(ow, back)));
    for (let f = 0; f < 2; f++) for (const [ri, row] of EAR_ROWS.entries()) for (const [vi, v] of EAR_V.entries()) {
      const shape = EAR_W[vi]! * row.u;
      let p = add(rootAt(yLow + v * H), up, ri ? shape * H * 0.08 : 0);
      p = add(p, back, shape * H * (0.62 - 0.25 * P.ear_out!));
      p = add(p, outw, row.out * H + shape * H * (0.4 + 0.5 * P.ear_out!) - (ri === 0 ? 0.002 : 0) + (f ? -0.0012 : 0));
      out[w++] = p[0]; out[w++] = p[1]; out[w++] = p[2];
    }
  }
  return out;
}

const NOSE_TRIS = [[0, 7, 1], [0, 1, 8], [7, 4, 1], [1, 4, 2], [1, 2, 5], [1, 5, 8], [4, 3, 2], [2, 3, 5], [4, 6, 3], [3, 6, 5]];
/** the nose on a body: its 9 vertices and 10 triangles (turned to face away from the head's middle). P: size, long,
 *  wide, bridge (flat ↔ high), tip (upturned), low; the rim sits 1 mm inside the face so only the ridge shows */
export function nose(B: ArrayLike<number>, P: Record<string, number>): { pos: Float32Array; tris: number[] } {
  const R = headRings(), M = headMeasures(B), F = R.slice(M.kChin).map((ring) => at(B, ring[0]!));
  const Hh = M.Hh, up: P3 = [0, 1, 0], kE = M.kEye;
  const fw = sub(at(B, R[kE]![0]!), at(B, R[kE]![12]!)); fw[1] = 0; const fwd = norm(fw);
  const side = norm(cross(up, fwd)), e6 = at(B, R[kE]![6]!), e18 = at(B, R[kE]![18]!), rw = Math.hypot(e6[0] - e18[0], e6[1] - e18[1], e6[2] - e18[2]) / 2;
  const front = (y: number): P3 => { for (let k = 0; k < F.length - 1; k++) { const a = F[k]!, b = F[k + 1]!; if (y >= a[1] && y <= b[1]) return lerp(a, b, (y - a[1]) / (b[1] - a[1] || 1)); } return y < F[0]![1] ? F[0]! : F[F.length - 1]!; };
  const surf = (y: number, dx: number, o = 0) => add(add(front(y), side, dx), fwd, o - (dx * dx) / (1.8 * rw));
  const s = 0.75 + 0.25 * P.nose!, proj = Hh * 0.03 * P.nose_proj! * s, w = Hh * 0.045 * P.nose_w! * s;
  const yTip = M.nose - Hh * 0.04 * P.nose_y!, yRoot = Math.min(M.eye, yTip + (M.eye - M.nose) * 0.8 * P.nose_len! * s);
  const yMid = (yTip + yRoot) / 2, lift = Hh * 0.014 * P.nose_tip!, sink = -0.001;
  const pts = [
    surf(yRoot, 0, sink), surf(yMid, 0, proj * 0.5), surf(yTip + lift, 0, proj),
    surf(yTip - Hh * 0.018 + lift * 0.5, 0, proj * (0.55 + 0.25 * P.nose_tip!)),
    surf(yTip - Hh * 0.006, -w, sink + proj * 0.12), surf(yTip - Hh * 0.006, w, sink + proj * 0.12),
    surf(yTip - Hh * 0.03, 0, sink), surf(yMid, -w * 0.45, sink), surf(yMid, w * 0.45, sink),
  ];
  let c: P3 = [0, 0, 0]; for (const i of R[kE]!) c = add(c, at(B, i), 1 / R[kE]!.length);
  const tris: number[] = [];
  for (const [a, b, d] of NOSE_TRIS as [number, number, number][]) {
    const n = cross(sub(pts[b]!, pts[a]!), sub(pts[d]!, pts[a]!)), m = sub(lerp(lerp(pts[a]!, pts[b]!, 0.5), pts[d]!, 1 / 3), c);
    if (dot(n, m) < 0) tris.push(a, d, b); else tris.push(a, b, d);
  }
  return { pos: Float32Array.from(pts.flat()), tris };
}
