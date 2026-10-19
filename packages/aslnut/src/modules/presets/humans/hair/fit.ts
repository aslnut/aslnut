// modules › presets › humans › hair › fit: a hair style made on the base body, re-fitted to another head. Each of the
// Head, Neck and Spine2 bones gets the affine map that best carries the base body's vertices it holds onto this body's
// (least squares); a hair vertex moves by its own bones' maps, blended by its weights, plus the nearby residual of the
// head's surface (bangs follow the face's sliders). Pure.
import type { SkinPiece, Template } from '../body/template.ts';
import { PART_NAMES, vertexParts } from '../body/generator.ts';

interface Fit { bones: number[]; sel: number[][]; headSet: number[] }
const fits = new WeakMap<Template, Fit>();
function fitOf(tpl: Template): Fit {
  let f = fits.get(tpl); if (f) return f;
  const bi = (n: string) => tpl.bones.findIndex((b) => b.name === n), bones = [bi('Head'), bi('Neck'), bi('Spine2')];
  const sel = bones.map((b) => { const s: number[] = []; for (let v = 0; v < tpl.verts; v++) for (let k = 0; k < 4; k++) if (tpl.j[v * 4 + k] === b && tpl.w[v * 4 + k]! >= 128) { s.push(v); break; } return s; });
  const parts = vertexParts(), headSet: number[] = [];
  for (let v = 0; v < tpl.verts; v++) if (['head', 'neck'].includes(PART_NAMES[parts[v]!]!)) headSet.push(v);
  fits.set(tpl, (f = { bones, sel, headSet }));
  return f;
}
/** each hair vertex's 6 nearest head and neck vertices on the base body, their weights, how much the surface pulls */
interface Near { nb: Int32Array; nf: Float32Array; gf: Float32Array }
const nears = new WeakMap<SkinPiece, Near>();
function nearOf(h: SkinPiece, B0: ArrayLike<number>, headSet: number[]): Near {
  let n = nears.get(h); if (n) return n;
  const m = h.pos.length / 3, nb = new Int32Array(m * 6), nf = new Float32Array(m * 6), gf = new Float32Array(m);
  for (let i = 0; i < m; i++) {
    const x = h.pos[i * 3]!, y = h.pos[i * 3 + 1]!, z = h.pos[i * 3 + 2]!, best: [number, number][] = [];
    for (const v of headSet) {
      const dd = Math.hypot(B0[v * 3]! - x, B0[v * 3 + 1]! - y, B0[v * 3 + 2]! - z);
      if (best.length < 6 || dd < best[5]![0]) { best.push([dd, v]); best.sort((a, b) => a[0] - b[0]); if (best.length > 6) best.pop(); }
    }
    let ws = 0; best.forEach(([dd], k) => { nf[i * 6 + k] = 1 / (dd + 0.004) ** 2; ws += nf[i * 6 + k]!; });
    best.forEach(([, v], k) => { nb[i * 6 + k] = v; nf[i * 6 + k] = nf[i * 6 + k]! / ws; });
    gf[i] = Math.exp(-0.5 * (best[0]![0] / 0.03) ** 2);
  }
  nears.set(h, (n = { nb, nf, gf }));
  return n;
}
/** least squares [x y z 1]·A ≈ B1 over the selected vertices (A: 4 × 3, row-major in 12 numbers) */
function fitAffine(B0: ArrayLike<number>, B1: ArrayLike<number>, sel: number[]): Float64Array {
  const M = new Float64Array(16), R = new Float64Array(12);
  for (const v of sel) {
    const X = [B0[v * 3]!, B0[v * 3 + 1]!, B0[v * 3 + 2]!, 1];
    for (let a = 0; a < 4; a++) { for (let b = 0; b < 4; b++) M[a * 4 + b] = M[a * 4 + b]! + X[a]! * X[b]!; for (let c = 0; c < 3; c++) R[a * 3 + c] = R[a * 3 + c]! + X[a]! * B1[v * 3 + c]!; }
  }
  for (let a = 0; a < 4; a++) M[a * 5] = M[a * 5]! + 1e-9;
  for (let col = 0; col < 4; col++) {         // Gauss–Jordan
    let p = col; for (let r = col + 1; r < 4; r++) if (Math.abs(M[r * 4 + col]!) > Math.abs(M[p * 4 + col]!)) p = r;
    for (let k = 0; k < 4; k++) [M[col * 4 + k], M[p * 4 + k]] = [M[p * 4 + k]!, M[col * 4 + k]!];
    for (let k = 0; k < 3; k++) [R[col * 3 + k], R[p * 3 + k]] = [R[p * 3 + k]!, R[col * 3 + k]!];
    const d = M[col * 5]!;
    for (let k = 0; k < 4; k++) M[col * 4 + k] = M[col * 4 + k]! / d; for (let k = 0; k < 3; k++) R[col * 3 + k] = R[col * 3 + k]! / d;
    for (let r = 0; r < 4; r++) { if (r === col) continue; const f = M[r * 4 + col]!; if (!f) continue; for (let k = 0; k < 4; k++) M[r * 4 + k] = M[r * 4 + k]! - f * M[col * 4 + k]!; for (let k = 0; k < 3; k++) R[r * 3 + k] = R[r * 3 + k]! - f * R[col * 3 + k]!; }
  }
  return R;
}
/** a hair piece (made on the base body B0) re-fitted to body B1: its positions */
export function fitHair(tpl: Template, h: SkinPiece, B0: ArrayLike<number>, B1: ArrayLike<number>): Float32Array {
  const F = fitOf(tpl), N = nearOf(h, B0, F.headSet), A = new Map<number, Float64Array>();
  F.bones.forEach((b, k) => A.set(b, fitAffine(B0, B1, F.sel[k]!)));
  const Ah = A.get(F.bones[0]!)!;
  const apply = (Af: Float64Array, x: number, y: number, z: number, o: number[], s: number) => { o[0]! += s * (x * Af[0]! + y * Af[3]! + z * Af[6]! + Af[9]!); o[1]! += s * (x * Af[1]! + y * Af[4]! + z * Af[7]! + Af[10]!); o[2]! += s * (x * Af[2]! + y * Af[5]! + z * Af[8]! + Af[11]!); };
  const m = h.pos.length / 3, out = new Float32Array(m * 3), q = [0, 0, 0], qi = [0, 0, 0];
  for (let i = 0; i < m; i++) {
    const x = h.pos[i * 3]!, y = h.pos[i * 3 + 1]!, z = h.pos[i * 3 + 2]!;
    q[0] = q[1] = q[2] = 0;
    for (let s = 0; s < 4; s++) { const w = h.w[i * 4 + s]! / 255; if (w) apply(A.get(h.j[i * 4 + s]!) ?? Ah, x, y, z, q, w); }
    let rx = 0, ry = 0, rz = 0;
    for (let k = 0; k < 6; k++) {
      const v = N.nb[i * 6 + k]!, f = N.nf[i * 6 + k]!;
      qi[0] = qi[1] = qi[2] = 0;
      for (let s = 0; s < 4; s++) { const w = h.w[i * 4 + s]! / 255; if (w) apply(A.get(h.j[i * 4 + s]!) ?? Ah, B0[v * 3]!, B0[v * 3 + 1]!, B0[v * 3 + 2]!, qi, w); }
      rx += f * (B1[v * 3]! - qi[0]!); ry += f * (B1[v * 3 + 1]! - qi[1]!); rz += f * (B1[v * 3 + 2]! - qi[2]!);
    }
    const g = N.gf[i]!;
    out[i * 3] = q[0]! + g * rx; out[i * 3 + 1] = q[1]! + g * ry; out[i * 3 + 2] = q[2]! + g * rz;
  }
  return out;
}
