// modules › presets › humans › body › generator: a generated human body. Slider weights → vertex positions and joint
// positions, with no graphics and no DOM (it runs in a worker or on a server alike).
//   Fixed topology: every body has the same 1,520 vertices in the same order, so one template's faces, skin weights
//   and correctives fit any generated body. Built in a design space (+Z up, the body faces −Y, its left = +X), warped by
//   the length parameters, returned in the figure's axes (x left, y up, z forward: (x, z, −y)).
//   const { P, positions, joints } = generate({ gender_female: 1, weight_heavy: 0.4 })
// Checked against the reference positions and joints the template was exported with (test/humans.test.ts).
type P = Record<string, number>;

// ── vectors (design space) ─────────────────────────────────────────────────────────────────────────────────────
class V {
  x: number; y: number; z: number;
  constructor(x = 0, y = 0, z = 0) { this.x = x; this.y = y; this.z = z; }
  add(b: V) { return new V(this.x + b.x, this.y + b.y, this.z + b.z); }
  sub(b: V) { return new V(this.x - b.x, this.y - b.y, this.z - b.z); }
  mul(s: number) { return new V(this.x * s, this.y * s, this.z * s); }
  dot(b: V) { return this.x * b.x + this.y * b.y + this.z * b.z; }
  cross(b: V) { return new V(this.y * b.z - this.z * b.y, this.z * b.x - this.x * b.z, this.x * b.y - this.y * b.x); }
  len() { return Math.hypot(this.x, this.y, this.z); }
  norm() { const l = this.len(); return l > 0 ? this.mul(1 / l) : new V(); }
  lerp(b: V, t: number) { return this.add(b.sub(this).mul(t)); }
}
const v3 = (a: readonly number[]) => new V(a[0], a[1], a[2]);
const mirror = (p: V) => new V(-p.x, p.y, p.z);
const vsum = (arr: V[]) => arr.reduce((a, b) => a.add(b), new V());
const rad = (d: number) => (d * Math.PI) / 180;
const smooth = (e0: number, e1: number, x: number) => { const t = Math.max(0, Math.min(1, (x - e0) / (e1 - e0))); return t * t * (3 - 2 * t); };
const sup = (v: number, e: number) => Math.sign(v) * Math.abs(v) ** (2 / e);
const gauss = (x: number, s: number) => Math.exp(-0.5 * (x / s) ** 2);
const angdiff = (a: number, b: number) => ((((a - b + 180) % 360) + 360) % 360) - 180;
const pw = (P: P, spec: Record<string, number> = {}) => Object.entries(spec).reduce((r, [k, e]) => r * P[k]! ** e, 1);

// ── parameters: BASE = a lean young adult ──────────────────────────────────────────────────────────────────────
export const BASE: Readonly<P> = {
  gscale: 0.975, thigh_len: 1.22, shin_len: 1.12, torso_len: 0.85, neck_len: 1.0, arm_len: 1.0,
  head: 1.04, head_w: 1.07, jaw: 1.0, nose: 1.0, ear: 1.0, face_round: 0.0, jaw_sharp: 0.0, chin: 0.0,
  // the nose and ear meshes only (the body positions ignore them)
  nose_len: 1.0, nose_w: 1.0, nose_proj: 1.0, nose_tip: 0.0, nose_y: 0.0, ear_out: 0.0, ear_y: 0.0,
  neck: 0.92, trap: 0.9, shoulder_w: 1.0, deltoid: 0.95, chest_w: 0.98, chest_d: 0.97, pec: 0.5, breast: 0.0,
  waist_w: 0.9, waist_d: 0.93, belly: 0.0, hip_w: 0.9, butt: 1.0, back_d: 1.0, blade: 0.8, hunch: 0.0,
  upperarm: 0.95, forearm: 0.95, hand: 0.88, thigh: 1.0, knee: 0.95, calf: 0.97, foot: 0.84,
};
/** a slider: parameters scaled by 1 + (mul − 1)·w, then add·w added */
export interface Morph { mul?: Record<string, number>; add?: Record<string, number> }
export const MORPHS: Readonly<Record<string, Morph>> = {
  gender_female: { mul: { gscale: 0.965, head: 0.99, jaw: 0.86, nose: 0.7, neck: 0.86, trap: 0.7, shoulder_w: 0.87, deltoid: 0.82, chest_w: 0.88, chest_d: 0.94, pec: 0.0, waist_w: 0.86, waist_d: 0.88, hip_w: 1.1, butt: 1.5, back_d: 0.95, upperarm: 0.86, forearm: 0.86, hand: 0.9, thigh: 1.12, knee: 0.92, calf: 0.97, foot: 0.88, thigh_len: 1.02, torso_len: 0.97 }, add: { breast: 0.55 } },
  weight_heavy: { mul: { neck: 1.2, trap: 1.2, shoulder_w: 1.05, deltoid: 1.15, chest_w: 1.14, chest_d: 1.2, waist_w: 1.25, waist_d: 1.4, hip_w: 1.18, butt: 1.5, back_d: 1.12, upperarm: 1.3, forearm: 1.18, hand: 1.06, thigh: 1.28, knee: 1.15, calf: 1.18, jaw: 1.12 }, add: { belly: 1.0 } },
  weight_thin: { mul: { neck: 0.9, shoulder_w: 0.97, deltoid: 0.85, chest_w: 0.92, chest_d: 0.9, pec: 0.5, waist_w: 0.9, waist_d: 0.88, hip_w: 0.94, butt: 0.6, upperarm: 0.82, forearm: 0.86, thigh: 0.82, knee: 0.92, calf: 0.86, jaw: 0.95 } },
  muscular: { mul: { neck: 1.18, trap: 1.45, shoulder_w: 1.06, deltoid: 1.25, chest_w: 1.07, chest_d: 1.1, pec: 2.4, waist_w: 0.98, back_d: 1.08, blade: 1.6, upperarm: 1.25, forearm: 1.17, thigh: 1.13, calf: 1.12 } },
  age_elder: { mul: { gscale: 0.985, butt: 0.6, pec: 0.5, chest_d: 0.95, shoulder_w: 0.96, deltoid: 0.85, upperarm: 0.9, forearm: 0.92, thigh: 0.9, calf: 0.9, waist_w: 1.08, waist_d: 1.1, neck: 0.95, jaw: 1.05 }, add: { belly: 0.5, hunch: 1.0 } },
  bust: { add: { breast: 1.0 } },
  hips_wide: { mul: { hip_w: 1.15, thigh: 1.05, butt: 1.1 } },
  waist_narrow: { mul: { waist_w: 0.85, waist_d: 0.9 } },
  shoulders_wide: { mul: { shoulder_w: 1.14, deltoid: 1.06, trap: 1.1, chest_w: 1.04 } },
  chest_deep: { mul: { chest_d: 1.18, back_d: 1.04 } },
  butt: { mul: { butt: 1.75 } },
  legs_long: { mul: { thigh_len: 1.1, shin_len: 1.1 } },
  arms_long: { mul: { arm_len: 1.1 } },
  neck_long: { mul: { neck_len: 1.45 } },
  head_size: { mul: { head: 1.12 } },
  face_round: { add: { face_round: 1.0 } },
  jaw_sharp: { add: { jaw_sharp: 1.0 } },
  chin_long: { add: { chin: 1.0 } },
  ears_big: { mul: { ear: 2.2 } },
  nose_size: { mul: { nose: 2.6 } },
  nose_long: { mul: { nose_len: 1.5 } },
  nose_wide: { mul: { nose_w: 1.6 } },
  nose_bridge: { mul: { nose_proj: 1.9 } },
  nose_flat: { mul: { nose_proj: 0.35, nose_len: 0.8 } },
  nose_upturned: { add: { nose_tip: 1.0 } },
  nose_low: { add: { nose_y: 1.0 } },
  ears_out: { add: { ear_out: 1.0 } },
  ears_low: { add: { ear_y: 1.0 } },
  // ages and heights (no reference shape: they only scale lengths the warp already carries)
  age_child: { mul: { gscale: 0.74, head: 1.2, head_w: 1.03, thigh_len: 0.9, shin_len: 0.9, torso_len: 0.94, neck_len: 0.75, shoulder_w: 0.9, chest_w: 0.94, chest_d: 0.95, hip_w: 0.9, butt: 0.7, pec: 0.2, neck: 0.9, trap: 0.8, deltoid: 0.85, upperarm: 0.85, forearm: 0.88, thigh: 0.9, calf: 0.9, jaw: 0.88, hand: 1.02, foot: 1.0, nose: 0.75 }, add: { face_round: 0.6 } },
  age_teen: { mul: { gscale: 0.92, head: 1.05, thigh_len: 0.98, shin_len: 0.99, shoulder_w: 0.95, deltoid: 0.9, upperarm: 0.92, forearm: 0.94, thigh: 0.95, jaw: 0.95 }, add: { face_round: 0.2 } },
  tall: { mul: { gscale: 1.08 } },
  short: { mul: { gscale: 0.92 } },
};
export const MORPH_ORDER = Object.keys(MORPHS);

/** slider weights { gender_female: 0.7, … } → parameters. Sliders combine multiplicatively (two 'wider' sliders
 *  compound instead of adding deltas), then the additions */
export function params(sliders: Record<string, number> = {}): P {
  const P: P = { ...BASE };
  for (const [name, w] of Object.entries(sliders)) {
    const m = MORPHS[name]; if (!m || !w) continue;
    for (const [k, v] of Object.entries(m.mul ?? {})) P[k] = P[k]! * (1 + (v - 1) * w);
  }
  for (const [name, w] of Object.entries(sliders)) {
    const m = MORPHS[name]; if (!m || !w) continue;
    for (const [k, v] of Object.entries(m.add ?? {})) P[k] = P[k]! + v * w;
  }
  return P;
}

// ── design-space skeleton and the length warp ──────────────────────────────────────────────────────────────────
const ARM_A = rad(45);
const AD = new V(Math.sin(ARM_A), 0, -Math.cos(ARM_A));      // along the left arm
const AU = new V(Math.cos(ARM_A), 0, Math.sin(ARM_A));       // arm 'top' = back of the hand
const AF = new V(0, -1, 0);                                  // arm front = thumb side
const L_UP = 0.285, L_FORE = 0.245, SW = L_UP + L_FORE;
const AJ = new V(0.098, 0.022, 0.085), BALL = new V(0.104, -0.105, 0.022), TOE = new V(0.106, -0.19, 0.018);
const ZA = 0.085, ZK = 0.48, ZH = 0.885, ZNK = 1.43, ZN = 1.505;
const SJd = (P: P) => new V(0.165 * P.shoulder_w! ** 0.5, 0.012, 1.382);
const HJd = (P: P) => new V(0.088 * P.hip_w! ** 0.5, 0.0, ZH);
const KJd = (P: P) => new V(0.092 + (HJd(P).x - 0.088) * 0.4, -0.008, ZK);

function zmap(z: number, P: P): number {
  const tA = ZA, tK = tA + (ZK - ZA) * P.shin_len!, tH = tK + (ZH - ZK) * P.thigh_len!;
  const tNk = tH + (ZNK - ZH) * P.torso_len!, tN = tNk + (ZN - ZNK) * P.neck_len!;
  if (z <= ZA) return z;
  if (z <= ZK) return tA + (z - ZA) * P.shin_len!;
  if (z <= ZH) return tK + (z - ZK) * P.thigh_len!;
  if (z <= ZNK) return tH + (z - ZH) * P.torso_len!;
  if (z <= ZN) return tNk + (z - ZNK) * P.neck_len!;
  return tN + (z - ZN);
}
type Part = 'core' | 'head' | 'arm';
/** design → final. 'core' (torso, legs, neck), 'head' (rigid with the head joint), 'arm' (defined on the left; the
 *  right arm is warped as its mirror image) */
function warp(p: V, part: Part, P: P): V {
  if (part === 'arm' && p.x < 0) return mirror(warp(mirror(p), part, P));
  let q: V;
  if (part === 'head') q = new V(p.x, p.y, p.z - ZN + zmap(ZN, P));
  else if (part === 'arm') {
    const sj = SJd(P), v = p.sub(sj), s = v.dot(AD);
    const s2 = s <= SW ? s * P.arm_len! : s + SW * (P.arm_len! - 1);
    q = new V(sj.x, sj.y, zmap(sj.z, P)).add(v).add(AD.mul(s2 - s));
    const t = smooth(0.09, 0.0, s);                          // the first arm rings blend into the torso warp (socket)
    if (t > 0) q = q.lerp(new V(p.x, p.y, zmap(p.z, P)), 0.5 * t);
  } else q = new V(p.x, p.y, zmap(p.z, P));
  return q.mul(P.gscale!);
}
function legAxis(z: number, P: P): V {
  const HJ = HJd(P), KJ = KJd(P);
  if (z >= KJ.z) return HJ.lerp(KJ, (HJ.z - z) / (HJ.z - KJ.z));
  return KJ.lerp(AJ, (KJ.z - z) / (KJ.z - AJ.z));
}

// ── body tables (design space) ─────────────────────────────────────────────────────────────────────────────────
interface Ring { zf: number; zs: number; zb: number; w: number; df: number; db: number; yc: number; e?: number; ef?: number; eb?: number; ws?: Record<string, number>; fs?: Record<string, number>; bs?: Record<string, number>; bump?: [string, number][]; groove?: number; sock?: number }
const TH_SOCK = [0, 24, 46, 66, 86, 106, 128, 152, 180];
const TH_UNI = Array.from({ length: 9 }, (_, i) => 22.5 * i);
const BUMP: Record<string, [number, number, number, string]> = { pec: [32, 20, -0.007, 'pec'], breast: [38, 22, -0.034, 'breast'], butt: [150, 28, 0.014, 'butt'], belly: [0, 48, -0.045, 'belly'], blade: [138, 22, 0.006, 'blade'], hunch: [180, 55, 0.02, 'hunch'] };
const TORSO: Ring[] = [
  { zf: 0.905, zs: 0.9, zb: 0.872, w: 0.145, df: 0.08, db: 0.1, yc: 0.004, e: 2.4, ws: { hip_w: 1 }, fs: { waist_d: 0.6 }, bs: { back_d: 0.5 }, bump: [['butt', 1.0], ['belly', 0.55]] },
  { zf: 0.985, zs: 0.985, zb: 0.975, w: 0.133, df: 0.086, db: 0.086, yc: 0.004, e: 2.4, ws: { hip_w: 0.5, waist_w: 0.5 }, fs: { waist_d: 0.8 }, bs: { back_d: 1 }, bump: [['butt', 0.3], ['belly', 1.0]] },
  { zf: 1.06, zs: 1.06, zb: 1.06, w: 0.12, df: 0.09, db: 0.082, yc: 0.005, e: 2.5, ws: { waist_w: 1 }, fs: { waist_d: 1 }, bs: { back_d: 1 }, bump: [['belly', 0.9]], groove: 1 },
  { zf: 1.14, zs: 1.14, zb: 1.14, w: 0.133, df: 0.097, db: 0.09, yc: 0.008, e: 2.6, ws: { waist_w: 0.4, chest_w: 0.6 }, fs: { chest_d: 0.6, waist_d: 0.4 }, bs: { back_d: 1 }, bump: [['belly', 0.45], ['breast', 0.25]], groove: 1 },
  { zf: 1.215, zs: 1.215, zb: 1.22, w: 0.149, df: 0.108, db: 0.096, yc: 0.008, e: 2.6, ws: { chest_w: 1 }, fs: { chest_d: 1 }, bs: { back_d: 1 }, bump: [['pec', 1], ['breast', 1], ['blade', 0.5], ['hunch', 0.5], ['belly', 0.1]], groove: 1 },
  { zf: 1.275, zs: 1.28, zb: 1.29, w: 0.155, df: 0.107, db: 0.099, yc: 0.01, e: 2.6, ws: { chest_w: 0.5, shoulder_w: 0.5 }, fs: { chest_d: 1 }, bs: { back_d: 1 }, bump: [['pec', 0.7], ['breast', 0.5], ['blade', 1], ['hunch', 0.8]], sock: 1 },
  { zf: 1.34, zs: 1.34, zb: 1.345, w: 0.162, df: 0.096, db: 0.096, yc: 0.01, e: 2.6, ws: { shoulder_w: 1 }, fs: { chest_d: 0.7 }, bs: { back_d: 1 }, bump: [['pec', 0.3], ['breast', 0.1], ['blade', 0.8], ['hunch', 1]], sock: 1 },
  { zf: 1.392, zs: 1.405, zb: 1.418, w: 0.16, df: 0.08, db: 0.088, yc: 0.01, e: 2.6, ws: { shoulder_w: 1 }, fs: { chest_d: 0.4 }, bs: { back_d: 0.7 }, bump: [['hunch', 0.8]], sock: 1 },
  { zf: 1.405, zs: 1.433, zb: 1.44, w: 0.126, df: 0.064, db: 0.074, yc: 0.012, e: 2.2, ws: { trap: 0.6, shoulder_w: 0.4 }, fs: { neck: 0.5 }, bs: { trap: 0.5 }, bump: [['hunch', 0.5]] },
  { zf: 1.425, zs: 1.452, zb: 1.458, w: 0.06, df: 0.056, db: 0.059, yc: 0.013, e: 2.0, ws: { neck: 1 }, fs: { neck: 1 }, bs: { neck: 1 } },
];
const NECK: Ring[] = [
  { zf: 1.465, zs: 1.48, zb: 1.49, w: 0.055, df: 0.053, db: 0.056, yc: 0.015, ws: { neck: 1 }, fs: { neck: 1 }, bs: { neck: 1 } },
  { zf: 1.495, zs: 1.512, zb: 1.532, w: 0.056, df: 0.051, db: 0.057, yc: 0.012, ws: { neck: 0.7 }, fs: { neck: 0.7 }, bs: { neck: 0.7 } },
];
// the head: a skull (cranium ellipsoid, the forehead half a little shallower) + a face / jaw ellipsoid tilted so its
// lower end comes forward + a chin, smoothly joined; sampled by rays from HEAD_O (on the neck axis) into HEAD_N columns
// (0 = front, 6 = left side, 12 = back) × HEAD_K rings from the neck junction up to HEAD_ECAP degrees, then a domed cap
const HEAD_O = new V(0, 0.012, 1.585), HEAD_N = 24, HEAD_K = 12, HEAD_ECAP = 58;
const CRANIUM = { c: new V(0, 0.012, 1.612), rx: 0.079, ryf: 0.095, ryb: 0.097, rz: 0.1 };
const FACE = { c: new V(0, -0.022, 1.56), rx: 0.067, ry: 0.066, rz: 0.07, tilt: 16 };
const CHIN = { c: new V(0, -0.054, 1.503), r: 0.025 };
const HEAD_TOP = 1.712, HEAD_PIVOT = new V(0, 0.008, 1.505);
const SOCK_IDX: [number, number][] = [[8, 4], [8, 3], [7, 3], [6, 3], [6, 4], [6, 5], [6, 6], [7, 6], [8, 6], [8, 5]];
const SOCK_HOLE: Record<number, number[]> = { 6: [3, 4, 5, 10, 11, 12], 7: [3, 4, 5, 10, 11, 12] };
const L0Z = [0.805, 0.83, 0.855, 0.875, 0.885, 0.87, 0.835, 0.8, 0.8, 0.79, 0.775, 0.785];
const L0B_T = 0.4;
interface LegSpec { z: number; rf: number; rb: number; rl: number; rm: number; sc: string; fan?: number; name?: string }
const LEG: LegSpec[] = [
  { z: 0.75, rf: 0.068, rb: 0.072, rl: 0.068, rm: 0.062, sc: 'thigh' },
  { z: 0.66, rf: 0.062, rb: 0.062, rl: 0.061, rm: 0.056, sc: 'thigh' },
  { z: 0.58, rf: 0.055, rb: 0.054, rl: 0.054, rm: 0.052, sc: 'thigh' },
  { z: 0.48, fan: 1, rf: 0.05, rb: 0.046, rl: 0.047, rm: 0.049, sc: 'knee' },
  { z: 0.48, fan: 0.45, rf: 0.053, rb: 0.044, rl: 0.046, rm: 0.047, sc: 'knee' },
  { z: 0.48, rf: 0.055, rb: 0.043, rl: 0.045, rm: 0.046, sc: 'knee', name: 'knee' },
  { z: 0.48, fan: -0.45, rf: 0.05, rb: 0.044, rl: 0.043, rm: 0.045, sc: 'knee' },
  { z: 0.48, fan: -1, rf: 0.045, rb: 0.046, rl: 0.042, rm: 0.044, sc: 'knee' },
  { z: 0.39, rf: 0.043, rb: 0.056, rl: 0.046, rm: 0.048, sc: 'calf' },
  { z: 0.315, rf: 0.04, rb: 0.052, rl: 0.043, rm: 0.046, sc: 'calf' },
  { z: 0.23, rf: 0.034, rb: 0.039, rl: 0.035, rm: 0.036, sc: 'calf' },
  { z: 0.15, rf: 0.028, rb: 0.031, rl: 0.029, rm: 0.029, sc: 'calf' },
  { z: 0.095, rf: 0.03, rb: 0.034, rl: 0.034, rm: 0.034, sc: 'foot', name: 'ankle' },
];
interface FootSpec { c: number[]; v: number[]; ht: number; hb: number; wl: number; wm: number; skew?: number }
const FOOT: FootSpec[] = [
  { c: [0.098, 0.03, 0.046], v: [0, -0.7071, 0.7071], ht: 0.04, hb: 0.062, wl: 0.034, wm: 0.033 },
  { c: [0.1, -0.035, 0.033], v: [0, -0.12, 1], ht: 0.039, hb: 0.033, wl: 0.038, wm: 0.036 },
  { c: [0.104, -0.105, 0.022], v: [0, 0, 1], ht: 0.023, hb: 0.022, wl: 0.044, wm: 0.04, skew: 0.01 },
  { c: [0.105, -0.15, 0.017], v: [0, 0, 1], ht: 0.018, hb: 0.017, wl: 0.042, wm: 0.04, skew: 0.013 },
  { c: [0.105, -0.185, 0.014], v: [0, 0, 1], ht: 0.012, hb: 0.014, wl: 0.032, wm: 0.031, skew: 0.016 },
];
const ANKLE_RING = 2 + LEG.findIndex((d) => d.name === 'ankle');
interface ArmSpec { s: number; cu?: number; rt?: number; rb?: number; rf?: number; rk?: number; ao?: number; sc: Record<string, number>; fan?: number; flat?: number; hd?: number; hp?: number; hw?: number; knuck?: number; name?: string }
const ARM: ArmSpec[] = [
  { s: 0.03, cu: 0.002, rt: 0.05, rb: 0.04, rf: 0.049, rk: 0.05, ao: 18, sc: { deltoid: 1 } },
  { s: 0.078, cu: 0.001, rt: 0.045, rb: 0.037, rf: 0.044, rk: 0.044, ao: 18, sc: { deltoid: 0.6, upperarm: 0.4 } },
  { s: 0.14, rt: 0.036, rb: 0.036, rf: 0.04, rk: 0.039, ao: 18, sc: { upperarm: 1 } },
  { s: 0.2, rt: 0.033, rb: 0.033, rf: 0.035, rk: 0.036, ao: 18, sc: { upperarm: 1 } },
  { s: 0.285, fan: -1, rt: 0.031, rb: 0.031, rf: 0.031, rk: 0.034, ao: 18, sc: { upperarm: 0.5, forearm: 0.5 } },
  { s: 0.285, fan: -0.45, rt: 0.031, rb: 0.03, rf: 0.03, rk: 0.036, ao: 18, sc: { upperarm: 0.5, forearm: 0.5 } },
  { s: 0.285, rt: 0.031, rb: 0.03, rf: 0.029, rk: 0.038, ao: 18, sc: { upperarm: 0.5, forearm: 0.5 }, name: 'elbow' },
  { s: 0.285, fan: 0.45, rt: 0.032, rb: 0.031, rf: 0.031, rk: 0.036, ao: 17, sc: { forearm: 1 } },
  { s: 0.285, fan: 1, rt: 0.033, rb: 0.031, rf: 0.032, rk: 0.034, ao: 16, sc: { forearm: 1 } },
  { s: 0.345, rt: 0.037, rb: 0.031, rf: 0.036, rk: 0.033, ao: 13, sc: { forearm: 1 } },
  { s: 0.41, rt: 0.031, rb: 0.027, rf: 0.031, rk: 0.029, ao: 8, sc: { forearm: 1 } },
  { s: 0.47, rt: 0.023, rb: 0.021, rf: 0.028, rk: 0.026, ao: 3, sc: { forearm: 0.5, hand: 0.5 } },
  { s: 0.53, rt: 0.016, rb: 0.017, rf: 0.027, rk: 0.025, ao: 0, flat: 0.5, sc: { hand: 1 }, name: 'wrist' },
  { s: 0.552, hd: 0.013, hp: 0.018, hw: 0.034, flat: 1, sc: { hand: 1 }, name: 'palm0' },
  { s: 0.585, hd: 0.011, hp: 0.015, hw: 0.039, flat: 1, sc: { hand: 1 }, name: 'palm1' },
  { s: 0.615, hd: 0.0095, hp: 0.0088, hw: 0.037, flat: 1, knuck: 1, sc: { hand: 1 }, name: 'knuckle' },
];
const AN = ARM.map((d) => d.name);
const P0_RING = 1 + AN.indexOf('palm0'), P1_RING = 1 + AN.indexOf('palm1'), KNUCK_RING = 1 + AN.indexOf('knuckle');
const K2TB: Record<number, ['t' | 'b', number]> = { 0: ['t', 2], 1: ['t', 1], 2: ['t', 0], 3: ['b', 0], 4: ['b', 1], 5: ['b', 2], 6: ['b', 3], 7: ['b', 4], 8: ['t', 4], 9: ['t', 3] };
const KT: Record<number, number> = { 0: 2, 1: 1, 2: 0, 3: 9, 4: 8 }, KB: Record<number, number> = { 0: 3, 1: 4, 2: 5, 3: 6, 4: 7 };
const HCOL = [1.0, 0.5, 0.0, -0.48, -0.93], ARCH_T = [0.72, 0.95, 1.0, 0.95, 0.72], ARCH_B = [0.8, 1.0, 1.0, 1.0, 0.8];
const KNUCK_S = [-0.005, 0.0, 0.001, -0.005, -0.013];
// long, slim fingers
const FINGERS: [string, number[], number, number, number][] = [['Index', [0.046, 0.028, 0.022], 0.0076, 0.0072, 5], ['Middle', [0.05, 0.031, 0.023], 0.0079, 0.0074, 1], ['Ring', [0.047, 0.03, 0.022], 0.0075, 0.007, -3], ['Pinky', [0.037, 0.022, 0.019], 0.0066, 0.0063, -8]];
const FINGER_RINGS = [[0.45, 1, 1.0], [1.0, 1, 0.95], [0.5, 2, 0.9], [1.0, 2, 0.86], [0.55, 3, 0.8], [0.92, 3, 0.5]] as const;
const CMC_OFF = AD.mul(0.018).add(AF.mul(0.022)).sub(AU.mul(0.006));
const TD1 = AD.mul(0.35).add(AF.mul(0.85)).sub(AU.mul(0.38)).norm();
const TD2 = AD.mul(0.62).add(AF.mul(0.65)).sub(AU.mul(0.35)).norm();
const TD3 = AD.mul(0.75).add(AF.mul(0.55)).sub(AU.mul(0.3)).norm();
const T_LEN = [0.046, 0.035, 0.03];

function handPts(P: P): [V, V, V, V, V] {
  const h = P.hand!, wj = SJd(P).add(AD.mul(SW)), cmc = wj.add(CMC_OFF.mul(h));
  const mcp = cmc.add(TD1.mul(T_LEN[0]! * h)), ip = mcp.add(TD2.mul(T_LEN[1]! * h)), tip = ip.add(TD3.mul(T_LEN[2]! * h));
  return [wj, cmc, mcp, ip, tip];
}

// ── shape functions (design space, left side) ──────────────────────────────────────────────────────────────────
function ringPoint(th: number, spec: Ring, P: P): V {
  const t = rad(th), s = Math.sin(t), c = Math.cos(t);
  const ef = spec.ef ?? spec.e ?? 2.0, eb = spec.eb ?? spec.e ?? 2.0;
  const w = spec.w * pw(P, spec.ws), df = spec.df * pw(P, spec.fs), db = spec.db * pw(P, spec.bs);
  const ee = c >= 0 ? ef : eb;
  const x = w * sup(s, ee), y = spec.yc - (c >= 0 ? df : db) * sup(c, ee);
  const z = spec.zs * s * s + (c >= 0 ? spec.zf : spec.zb) * c * c;
  return new V(th > 0.01 && th < 179.99 ? x : 0, y, z);
}
function torsoHalf(spec: Ring, P: P): V[] {
  return (spec.sock ? TH_SOCK : TH_UNI).map((th) => {
    const p = ringPoint(th, spec, P);
    for (const [name, amp] of spec.bump ?? []) { const [ang, sig, amt, par] = BUMP[name]!; p.y += amt * P[par]! * amp * gauss(angdiff(th, ang), sig); }
    if (spec.groove) p.y -= 0.004 * gauss(angdiff(th, 180), 12);
    return p;
  });
}
function legSocket(P: P): V[] {
  const sc = P.hip_w! ** 0.6 * P.thigh! ** 0.4, cx = HJd(P).x, cy = -0.002;
  const rf = 0.08 * sc, rb = (0.094 + 0.006 * (P.butt! - 1)) * sc, rl = 0.07 * P.hip_w! ** 0.8 * P.thigh! ** 0.2, rm = 0.09;
  const pts: V[] = [];
  for (let j = 0; j < 12; j++) {
    const ph = rad(330 + 30 * j), s = Math.sin(ph), c = Math.cos(ph);
    let x = cx + (s >= 0 ? rl : rm) * sup(s, 2.2), y = cy - (c >= 0 ? rf : rb) * sup(c, 2.2);
    if ([0, 8, 9, 10, 11].includes(j)) x = 0;
    if (j === 9) y = 0.04; if (j === 10) y = -0.005; if (j === 11) y = -0.045;
    pts.push(new V(x, y, L0Z[j]));
  }
  return pts;
}
function legRing(spec: LegSpec, P: P): V[] {
  const sc = P[spec.sc] ?? 1.0, pts: V[] = [];
  for (let j = 0; j < 12; j++) {
    const ph = rad(330 + 30 * j), s = Math.sin(ph), c = Math.cos(ph);
    const z = spec.z + (spec.fan || 0) * (0.03 + 0.012 * c), a = legAxis(z, P);
    pts.push(new V(a.x + (s >= 0 ? spec.rl : spec.rm) * sc * sup(s, 2.2), a.y - (c >= 0 ? spec.rf : spec.rb) * sc * sup(c, 2.2), z));
  }
  return pts;
}
function groinRing(L0: V[], L1: V[], P: P): V[] {
  return L0.map((p0, j) => { const p = p0.lerp(L1[j]!, L0B_T), a = legAxis(p.z, P); return p.add(new V(p.x - a.x, p.y - a.y, 0).mul(0.05)); });
}
function footRing(spec: FootSpec, P: P): V[] {
  const sc = P.foot!, base = new V(AJ.x, AJ.y, 0), c0 = base.add(v3(spec.c).sub(base).mul(sc)), v = v3(spec.v).norm(), lat = new V(1, 0, 0);
  const pts: V[] = [];
  for (let j = 0; j < 12; j++) {
    const ph = rad(330 + 30 * j), s = Math.sin(ph), c = Math.cos(ph);
    let p = c0.add(lat.mul((s >= 0 ? spec.wl : spec.wm) * sc * sup(s, 2.3)));
    p = p.add(v.mul((c >= 0 ? spec.ht : spec.hb) * sc * sup(c, c >= 0 ? 2.0 : 3.0)));
    p.y += (spec.skew || 0) * s * sc;
    if (c < -0.8) p.z = 0; p.z = Math.max(p.z, 0);
    pts.push(p);
  }
  return pts;
}
function socketRing(P: P): V[] {
  const c = new V(0.148 * P.shoulder_w! ** 0.5, 0.008, 1.348), tilt = rad(15), n1 = new V(Math.sin(tilt), 0, Math.cos(tilt)), sc = P.deltoid! ** 0.3;
  return Array.from({ length: 10 }, (_, k) => { const a = rad(18 + 36 * k), ca = Math.cos(a), sa = Math.sin(a); return c.add(n1.mul(0.066 * ca * sc)).add(AF.mul((sa >= 0 ? 0.058 : 0.06) * sa * sc)); });
}
function flatPt(c: V, k: number, hd: number, hp: number, hw: number, knuck: number | undefined, sc: number): V {
  const [row, col] = K2TB[k]!, u = row === 't' ? hd * ARCH_T[col]! : -hp * ARCH_B[col]!;
  let p = c.add(AU.mul(u)).add(AF.mul(HCOL[col]! * hw));
  if (knuck) p = p.add(AD.mul(KNUCK_S[col]! * sc));
  return p;
}
function armRing(spec: ArmSpec, P: P): V[] {
  const sc = pw(P, spec.sc), pts: V[] = [];
  for (let k = 0; k < 10; k++) {
    const a = rad((spec.ao || 0) + 36 * k), ca = Math.cos(a), sa = Math.sin(a);
    let s = spec.s + (spec.fan || 0) * (0.022 - 0.01 * sa);
    if (s > SW) s = SW + (s - SW) * P.hand!;
    const c = SJd(P).add(AD.mul(s)).add(AU.mul(spec.cu || 0)), flat = spec.flat || 0;
    let p = new V();
    if (flat < 1) p = c.add(AU.mul((ca >= 0 ? spec.rt! : spec.rb!) * sc * ca)).add(AF.mul((sa >= 0 ? spec.rf! : spec.rk!) * sc * sa));
    if (flat > 0) {
      const q = flatPt(c, k, (spec.hd ?? spec.rt!) * sc, (spec.hp ?? spec.rb!) * sc, (spec.hw ?? spec.rf!) * sc, spec.knuck, P.hand!);
      p = flat >= 1 ? q : p.lerp(q, flat);
    }
    pts.push(p);
  }
  return pts;
}
function fingerFrame(n: number): [V, V] {
  const a = rad(FINGERS[n]![4]);
  return [AD.mul(Math.cos(a)).add(AF.mul(Math.sin(a))), AF.mul(Math.cos(a)).sub(AD.mul(Math.sin(a)))];
}
function thumbRings(P: P): V[][] {
  const sc = P.hand!, [, , mcp, ip] = handPts(P);
  const specs: [V, V, number, number][] = [[mcp.sub(TD1.mul(0.008 * sc)).sub(AU.mul(0.004 * sc)), TD1, 0.0125, 0.0108], [mcp.add(TD2.mul(0.006 * sc)), TD2, 0.0095, 0.0084],
    [mcp.add(TD2.mul(0.019 * sc)), TD2, 0.0088, 0.0078], [ip, TD2.lerp(TD3, 0.5).norm(), 0.0082, 0.0072],
    [ip.add(TD3.mul(0.016 * sc)), TD3, 0.0075, 0.0066], [ip.add(TD3.mul(0.028 * sc)), TD3, 0.0046, 0.004]];
  return specs.map(([c, d, hw, hh]) => {
    let up = AU.add(AF.mul(0.3)); up = up.sub(d.mul(up.dot(d))).norm();
    const side = d.cross(up).norm(); hw *= sc; hh *= sc;
    return [c.add(side.mul(hw)).add(up.mul(hh)), c.sub(side.mul(hw)).add(up.mul(hh)), c.sub(side.mul(hw)).sub(up.mul(hh)), c.add(side.mul(hw)).sub(up.mul(hh))];
  });
}
const smin = (a: number, b: number, k: number) => { const h = Math.max(k - Math.abs(a - b), 0) / k; return Math.min(a, b) - h * h * k * 0.25; };
const ellD = (x: number, y: number, z: number, rx: number, ry: number, rz: number) => (Math.sqrt((x / rx) ** 2 + (y / ry) ** 2 + (z / rz) ** 2) - 1) * Math.min(rx, ry, rz);
/** the head's distance-like field (design space, before the head scale): < 0 inside */
function headField(P: P): (x: number, y: number, z: number) => number {
  const hw = P.head_w!, fr = P.face_round!, js = P.jaw_sharp!;
  const crx = CRANIUM.rx * hw, fcx = FACE.rx * P.jaw! * (1 + (hw - 1) * 0.6) * (1 + 0.12 * fr - 0.12 * js);
  const chr = CHIN.r * (1 - 0.25 * js + 0.1 * fr), chy = CHIN.c.y - 0.004 * P.chin!, chz = CHIN.c.z - 0.014 * P.chin!;
  const ta = rad(FACE.tilt), ca = Math.cos(ta), sa = Math.sin(ta);
  return (x, y, z) => {
    const C = CRANIUM.c, dC = ellD(x, y - C.y, z - C.z, crx, y < C.y ? CRANIUM.ryf : CRANIUM.ryb, CRANIUM.rz);
    const qy = y - FACE.c.y, qz = z - FACE.c.z;
    const dF = ellD(x, qy * ca - qz * sa, qy * sa + qz * ca, fcx, FACE.ry, FACE.rz);
    const dK = Math.sqrt(x * x + (y - chy) ** 2 + (z - chz) ** 2) - chr;
    return smin(smin(dC, dF, 0.02), dK, 0.015);
  };
}
const headDir = (th: number, e: number) => { const t = rad(th), c = Math.cos(rad(e)); return new V(c * Math.sin(t), -c * Math.cos(t), Math.sin(rad(e))); };
/** the surface point along the ray from HEAD_O in direction d (bisection: the head is star-shaped from HEAD_O) */
function headHit(F: (x: number, y: number, z: number) => number, d: V): V {
  let a = 0, b = 0.2;
  for (let it = 0; it < 40; it++) { const m = (a + b) / 2; if (F(HEAD_O.x + d.x * m, HEAD_O.y + d.y * m, HEAD_O.z + d.z * m) < 0) a = m; else b = m; }
  const t = (a + b) / 2; return new V(HEAD_O.x + d.x * t, HEAD_O.y + d.y * t, HEAD_O.z + d.z * t);
}
const headPlace = (q: V, P: P) => HEAD_PIVOT.add(q.sub(HEAD_PIVOT).mul(P.head!)).add(new V(0, -0.012 * P.hunch!, -0.004 * P.hunch!));
/** the head grid in design space: rings [HEAD_K][HEAD_N] (ring 0 = where the head meets the neck tube) + cap points */
function headGrid(P: P): { rings: V[][]; cap: V[]; c0: number; n: number } {
  const F = headField(P), T = NECK[1]!;
  const nw = T.w * pw(P, T.ws), nf = T.df * pw(P, T.fs), nb = T.db * pw(P, T.bs), yc = T.yc - 0.012 * P.hunch!;
  // how far a placed point lies outside the neck tube (an ellipse around (0, yc), the top neck ring's shape)
  const tube = (s: V) => { const dx = s.x, dy = s.y - yc, r = Math.hypot(dx, dy) || 1e-9, d = dy < 0 ? nf : nb; return r - 1 / Math.sqrt((dx / r / nw) ** 2 + (dy / r / d) ** 2); };
  const half: V[][] = [];
  for (let j = 0; j <= HEAD_N / 2; j++) {
    const th = (360 / HEAD_N) * j;
    let lo = -89, hi = 20;
    for (let it = 0; it < 40; it++) { const m = (lo + hi) / 2; if (tube(headPlace(headHit(F, headDir(th, m)), P)) < 0) lo = m; else hi = m; }
    const e0 = (lo + hi) / 2, col: V[] = [];
    for (let k = 0; k < HEAD_K; k++) { const q = headHit(F, headDir(th, e0 + ((HEAD_ECAP - e0) * k) / (HEAD_K - 1))); col.push(j === 0 || j === HEAD_N / 2 ? new V(0, q.y, q.z) : q); }
    half.push(col);
  }
  const rings = Array.from({ length: HEAD_K }, (_, k) => Array.from({ length: HEAD_N }, (_, j) => (j <= HEAD_N / 2 ? half[j]![k]! : mirror(half[HEAD_N - j]![k]!))));
  // the cap: a Coons grid over the last ring, each point pushed out onto the surface along its ray from HEAD_O
  const n = HEAD_N / 4, c0 = HEAD_N - HEAD_N / 8, top = rings[HEAD_K - 1]!, R = top.map((_, i) => top[(c0 + i) % HEAD_N]!);
  const G = (i: number, j: number) => (j === 0 ? R[i]! : i === n ? R[n + j]! : j === n ? R[3 * n - i]! : R[(4 * n - j) % HEAD_N]!);
  const cap: V[] = [];
  for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) {
    const u = i / n, w = j / n;
    const p = G(i, 0).mul(1 - w).add(G(i, n).mul(w)).add(G(0, j).mul(1 - u)).add(G(n, j).mul(u))
      .sub(G(0, 0).mul((1 - u) * (1 - w)).add(G(n, 0).mul(u * (1 - w))).add(G(0, n).mul((1 - u) * w)).add(G(n, n).mul(u * w)));
    const d = p.sub(HEAD_O).norm(), q = headHit(F, d);
    cap.push(Math.abs(q.x) < 1e-12 ? new V(0, q.y, q.z) : q);
  }
  return { rings: rings.map((r) => r.map((q) => headPlace(q, P))), cap: cap.map((q) => headPlace(q, P)), c0, n };
}
function align(prev: V[], nw: V[]): number[] {
  const n = nw.length, cp = vsum(prev).mul(1 / n), cn = vsum(nw).mul(1 / n);
  const dp = prev.map((p) => p.sub(cp).norm()), dn = nw.map((p) => p.sub(cn).norm());
  let best: [number, number[]] | null = null;
  for (const rev of [false, true]) {
    const order = rev ? [...Array(n).keys()].reverse() : [...Array(n).keys()];
    for (let sh = 0; sh < n; sh++) {
      const perm = Array.from({ length: n }, (_, i) => order[(i + sh) % n]!);
      const sc = dp.reduce((a, d, i) => a + d.dot(dn[perm[i]!]!), 0);
      if (!best || sc > best[0] + 1e-9) best = [sc, perm];
    }
  }
  return best![1];
}

// ── the builder (the vertex order every template uses) ─────────────────────────────────────────────────────────
const PART: Record<string, number> = { torso: 0, neck: 1, head: 2, crotch: 3, leg: 4, foot: 5, arm: 6, finger: 7, thumb: 8 };
/** what each vertex belongs to (vertexParts() gives the index into this) */
export const PART_NAMES = Object.keys(PART);
/** the body's ring structure, as vertex indices (−1: a vertex dropped in the shoulder-socket hole): topology only */
export interface BodyRings { torso: number[][]; neck: number[][]; head: number[][]; crotch: number[]; legL: number[][]; legR: number[][]; armL: number[][]; armR: number[][] }
interface Design { co: V[]; part: number[]; faces: number[][]; headRings: number[][]; rings: BodyRings }
function buildDesign(P: P): Design {
  const co: V[] = [], part: number[] = [], faces: number[][] = [];
  const v = (p: V, pt: string) => { co.push(p); part.push(PART[pt]!); return co.length - 1; };
  const q = (a: number, b: number, c: number, d: number) => faces.push([a, b, c, d]);
  const loft = (A: number[], B: number[], skip: number[] = []) => { const n = A.length; for (let i = 0; i < n; i++) { if (skip.includes(i)) continue; const j = (i + 1) % n; q(A[i]!, A[j]!, B[j]!, B[i]!); } };
  const capLadder = (ring: number[], start: number) => { const n = ring.length, R = ring.map((_, i) => ring[(start + i) % n]!); for (let i = 0; i < n / 2 - 1; i++) q(R[i]!, R[i + 1]!, R[n - 2 - i]!, R[n - 1 - i]!); };
  // torso
  const L0 = legSocket(P);
  const TR = [L0.slice(0, 9), ...TORSO.map((s) => torsoHalf(s, P))];
  const sock = socketRing(P);
  SOCK_IDX.forEach(([r, i], k) => (TR[r]![i] = sock[k]!));
  const full = TR.map((h) => Array.from({ length: 16 }, (_, i) => (i <= 8 ? h[i]! : mirror(h[16 - i]!))));
  const TI = full.map((ring) => ring.map((p) => v(p, 'torso')));
  for (let r = 0; r < 10; r++) loft(TI[r]!, TI[r + 1]!, SOCK_HOLE[r] ?? []);
  // neck + head
  let prev = TI[10]!;
  const neckRings: number[][] = [];
  NECK.slice(0, 1).forEach((spec, k) => {
    const pts = torsoHalf({ ...spec, e: 2.0 }, P);
    let ring = Array.from({ length: 16 }, (_, i) => (i <= 8 ? pts[i]! : mirror(pts[16 - i]!)));
    if (P.hunch) ring = ring.map((p) => p.add(new V(0, -0.006 * P.hunch! * (k + 1), 0)));
    const cur = ring.map((p) => v(p, 'neck')); loft(prev, cur); prev = cur; neckRings.push(cur);
  });
  const HG = headGrid(P), headRings = HG.rings.map((ring) => ring.map((p) => v(p, 'head')));
  // neck (16 columns) → head (24): every 2 neck edges meet 3 head edges as quad, triangle, quad
  for (let m = 0; m < 8; m++) {
    const a = prev[2 * m]!, b = prev[2 * m + 1]!, c = prev[(2 * m + 2) % 16]!, H = headRings[0]!, j = 3 * m;
    q(a, b, H[j + 1]!, H[j]!); faces.push([b, H[j + 2]!, H[j + 1]!]); q(b, c, H[(j + 3) % HEAD_N]!, H[j + 2]!);
  }
  for (let k = 1; k < HEAD_K; k++) loft(headRings[k - 1]!, headRings[k]!);
  { const R = headRings[HEAD_K - 1]!, n = HG.n, N = HEAD_N, ix = R.map((_, i) => R[(HG.c0 + i) % N]!);
    const G: number[][] = Array.from({ length: n + 1 }, () => Array(n + 1).fill(-1));
    for (let i = 0; i <= n; i++) { G[i]![0] = ix[i]!; G[n]![i] = ix[n + i]!; G[n - i]![n] = ix[2 * n + i]!; G[0]![n - i] = ix[(3 * n + i) % N]!; }
    let c = 0; for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) G[i]![j] = v(HG.cap[c++]!, 'head');
    for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) q(G[i]![j]!, G[i + 1]![j]!, G[i + 1]![j + 1]!, G[i]![j + 1]!); }
  // crotch
  const C3 = v(L0[9]!, 'crotch'), C2 = v(L0[10]!, 'crotch'), C1 = v(L0[11]!, 'crotch');
  // legs and feet
  const legPts = [...LEG.map((s) => legRing(s, P)), ...FOOT.map((s) => footRing(s, P))];
  const rings = [groinRing(L0, legPts[0]!, P), ...legPts];
  const legRings: { L: number[][]; R: number[][] } = { L: [], R: [] }, armRings0: { L: number[][]; R: number[][] } = { L: [], R: [] };
  for (const left of [true, false]) {
    const mp = left ? (p: V) => p : mirror, t0 = TI[0]!;
    prev = [t0[0]!, ...[1, 2, 3, 4, 5, 6, 7].map((i) => (left ? t0[i]! : t0[16 - i]!)), t0[8]!, C3, C2, C1];
    legRings[left ? 'L' : 'R'].push(prev);
    rings.forEach((pts, k0) => {
      const k = k0 + 1, cur = pts.map((p) => v(mp(p), k <= ANKLE_RING ? 'leg' : 'foot'));
      loft(prev, cur); prev = cur; legRings[left ? 'L' : 'R'].push(cur);
    });
    capLadder(prev, 1);
  }
  // arms, hands, fingers, thumb
  const armRings = ARM.map((s) => armRing(s, P)), thRings = thumbRings(P);
  for (const left of [true, false]) {
    const mp = left ? (p: V) => p : mirror;
    prev = SOCK_IDX.map(([r, i]) => TI[r]![left ? i : 16 - i]!);
    const ringsIdx = [prev];
    armRings.forEach((pts, k0) => {
      const k = k0 + 1, cur = pts.map((p) => v(mp(p), 'arm'));
      loft(prev, cur, k === P1_RING ? [2] : []); ringsIdx.push(cur); prev = cur;
    });
    armRings0[left ? 'L' : 'R'] = ringsIdx;
    const knuck = ringsIdx[KNUCK_RING]!, P0r = ringsIdx[P0_RING]!, P1r = ringsIdx[P1_RING]!;
    FINGERS.forEach(([, lens, hw, hh], n) => {
      let fprev = [knuck[KT[n]!]!, knuck[KT[n + 1]!]!, knuck[KB[n + 1]!]!, knuck[KB[n]!]!];
      const kr = armRings[KNUCK_RING - 1]!, mcp = vsum([kr[KT[n]!]!, kr[KT[n + 1]!]!, kr[KB[n + 1]!]!, kr[KB[n]!]!]).mul(0.25);
      const [d, side] = fingerFrame(n);
      for (const [frac, ph, size] of FINGER_RINGS) {
        const t = (lens.slice(0, ph - 1).reduce((a, b) => a + b, 0) + frac * lens[ph - 1]!) * P.hand!, c = mcp.add(d.mul(t));
        const a = hw * size * P.hand!, b = hh * size * P.hand!;
        const pts = [c.add(side.mul(a)).add(AU.mul(b)), c.sub(side.mul(a)).add(AU.mul(b)), c.sub(side.mul(a)).sub(AU.mul(b)), c.add(side.mul(a)).sub(AU.mul(b))];
        const cur = pts.map((p) => v(mp(p), 'finger')); loft(fprev, cur); fprev = cur;
      }
      q(fprev[0]!, fprev[1]!, fprev[2]!, fprev[3]!);
    });
    let tprev = [P0r[2]!, P1r[2]!, P1r[3]!, P0r[3]!];
    const a0 = armRings[P0_RING - 1]!, a1 = armRings[P1_RING - 1]!;
    let prevL = [a0[2]!, a1[2]!, a1[3]!, a0[3]!];
    for (let pts of thRings) {
      const perm = align(prevL, pts); pts = perm.map((i) => pts[i]!);
      const cur = pts.map((p) => v(mp(p), 'thumb')); loft(tprev, cur); tprev = cur; prevL = pts;
    }
    q(tprev[0]!, tprev[1]!, tprev[2]!, tprev[3]!);
  }
  // drop the vertices no face uses (torso vertices inside the shoulder-socket holes)
  const used = new Uint8Array(co.length); for (const f of faces) for (const i of f) used[i] = 1;
  const keep: number[] = []; for (let i = 0; i < co.length; i++) if (used[i]) keep.push(i);
  const remap = new Int32Array(co.length).fill(-1); keep.forEach((o, n) => (remap[o] = n));
  const R = (r: number[]) => r.map((i) => remap[i]!);
  return { co: keep.map((i) => co[i]!), part: keep.map((i) => part[i]!), faces: faces.map(R), headRings: headRings.map(R),
    rings: { torso: TI.map(R), neck: neckRings.map(R), head: headRings.map(R), crotch: [C3, C2, C1].map((i) => remap[i]!),
      legL: legRings.L.map(R), legR: legRings.R.map(R), armL: armRings0.L.map(R), armR: armRings0.R.map(R) } };
}

const partOf = (pt: number): Part => (pt === PART.arm || pt === PART.finger || pt === PART.thumb ? 'arm' : pt === PART.head ? 'head' : 'core');

/** positions (x left, y up, z forward; metres, feet at y = 0) for the given parameters */
export function buildPositions(P: P, out?: Float32Array): Float32Array {
  const { co, part } = buildDesign(P);
  const pos = out ?? new Float32Array(co.length * 3);
  co.forEach((p, i) => { const q = warp(p, partOf(part[i]!), P); pos[i * 3] = q.x; pos[i * 3 + 1] = q.z; pos[i * 3 + 2] = -q.y; });
  return pos;
}
/** a preview: the generated body as positions + faces (quads and triangles), no template needed */
export function designMesh(sliders: Record<string, number> = {}): { positions: Float32Array; faces: number[][]; part: number[] } {
  const P = params(sliders), d = buildDesign(P), pos = new Float32Array(d.co.length * 3);
  d.co.forEach((p, i) => { const q = warp(p, partOf(d.part[i]!), P); pos[i * 3] = q.x; pos[i * 3 + 1] = q.z; pos[i * 3 + 2] = -q.y; });
  return { positions: pos, faces: d.faces, part: d.part };
}
let topo: Design | null = null;
const topology = () => (topo ??= buildDesign(BASE as P));
/** the body's rings (topology only, the same for every body): torso[0..10][16] (0 the leg-socket ring … 10 the neck
 *  base; column 0 front, 4 left, 8 back, 12 right), neck[1][16], head[12][24], crotch[3], legL / legR [socket ring,
 *  groin, thigh … ankle, foot …][12], armL / armR [socket ring, deltoid … elbow … wrist, palm, knuckle][10] */
export function bodyRings(): BodyRings { return topology().rings; }
/** the head ring vertex indices [ring 0 = the neck junction … 11][24 columns, 0 front, 6 left, 12 back, 18 right] */
export function headRings(): number[][] { return topology().headRings; }
/** a part per vertex (an index into PART_NAMES): topology only */
export function vertexParts(): Uint8Array { return Uint8Array.from(topology().part); }

// ── joints: a pure function of the parameters, through the same warp ───────────────────────────────────────────
export interface Joint { head: [number, number, number]; tail: [number, number, number] }
export function joints(P: P): Record<string, Joint> {
  const J: Record<string, Joint> = {};
  const gl = (p: V): [number, number, number] => [p.x, p.z, -p.y];
  const b = (n: string, h: V, t: V, part: Part = 'core', tpart?: Part) => (J[n] = { head: gl(warp(h, part, P)), tail: gl(warp(t, tpart ?? part, P)) });
  b('Hips', new V(0, 0.005, 0.93), new V(0, 0.005, 1.01));
  b('Spine', new V(0, 0.005, 1.01), new V(0, 0.008, 1.11));
  b('Spine1', new V(0, 0.008, 1.11), new V(0, 0.012, 1.235));
  b('Spine2', new V(0, 0.012, 1.235), new V(0, 0.015, 1.43));
  b('Neck', new V(0, 0.015, 1.43), new V(0, 0.008, 1.505));
  const top = HEAD_PIVOT.z + (HEAD_TOP - HEAD_PIVOT.z) * P.head!;
  b('Head', new V(0, 0.008, 1.505), new V(0, 0.008, top), 'head');
  b('HeadTop_End', new V(0, 0.008, top), new V(0, 0.008, top + 0.06), 'head');
  const knuck = armRing(ARM[KNUCK_RING - 1]!, P);
  const SJ = SJd(P), EJ = SJ.add(AD.mul(L_UP));
  const [wj, cmc, tmcp, tip_, ttip] = handPts(P);
  const HJ = HJd(P), KJ = KJd(P), base = new V(AJ.x, AJ.y, 0);
  const ball = base.add(BALL.sub(base).mul(P.foot!)), toe = base.add(TOE.sub(base).mul(P.foot!));
  const mcps = [0, 1, 2, 3].map((n) => vsum([knuck[KT[n]!]!, knuck[KT[n + 1]!]!, knuck[KB[n + 1]!]!, knuck[KB[n]!]!]).mul(0.25));
  for (const S of ['Left', 'Right']) {
    const m = S === 'Left' ? (p: V) => p : mirror, L = S;
    b(L + 'Shoulder', m(new V(0.03, 0, 1.39)), m(SJ), 'core', 'arm');
    b(L + 'Arm', m(SJ), m(EJ), 'arm');
    b('helper_' + S + 'Shoulder', m(SJ), m(EJ), 'arm');
    b(L + 'ForeArm', m(EJ), m(wj), 'arm');
    b(L + 'Hand', m(wj), m(mcps[1]!), 'arm');
    const tp = [cmc, tmcp, tip_, ttip, ttip.add(TD3.mul(0.012 * P.hand!))];
    for (let i = 0; i < 4; i++) b(`${L}HandThumb${i + 1}`, m(tp[i]!), m(tp[i + 1]!), 'arm');
    FINGERS.forEach(([name, lens], n) => {
      const [d] = fingerFrame(n), p = [mcps[n]!];
      for (const Ln of lens) p.push(p[p.length - 1]!.add(d.mul(Ln * P.hand!)));
      p.push(p[p.length - 1]!.add(d.mul(0.012 * P.hand!)));
      for (let i = 0; i < 4; i++) b(`${L}Hand${name}${i + 1}`, m(p[i]!), m(p[i + 1]!), 'arm');
    });
    b(L + 'UpLeg', m(HJ), m(KJ));
    b('helper_' + S + 'Hip', m(HJ), m(KJ));
    b(L + 'Leg', m(KJ), m(AJ));
    b(L + 'Foot', m(AJ), m(ball));
    b(L + 'ToeBase', m(ball), m(toe));
    b(L + 'Toe_End', m(toe), m(toe.add(new V(0, -0.025, 0))), 'core');
  }
  return J;
}

/** everything for one body: its parameters, its vertex positions and its joints */
export function generate(sliders: Record<string, number> = {}): { P: P; positions: Float32Array; joints: Record<string, Joint> } {
  const P = params(sliders);
  return { P, positions: buildPositions(P), joints: joints(P) };
}
