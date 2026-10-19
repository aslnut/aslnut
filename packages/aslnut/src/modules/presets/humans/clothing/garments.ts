// modules › presets › humans › clothing › garments: clothes as shells over the body's own topology, plus pieces that
// hang free (a skirt's cone, a collar). A shell takes a set of body vertices (ranges of the body's rings) and re-emits
// every body face whose corners are all in it, pushed out along the body's normal by the cloth's thickness; its
// vertices carry the body's skin weights, so it bends exactly like the skin under it. The body faces a shell covers
// are hidden (a figure's own index). A garment is a type (its slot, its numbers, its build) and a palette slot: its
// colour is the person's, not baked. Your own type: the same `GarmentType` (a head covering would be one more: none
// ships yet). Pure.
//   buildGarment({ type: 'dress', params: { length: 'midi' } }, body)   → { pos, tris, j, w, slot, hide }
import { bodyRings, type BodyRings } from '../body/generator.ts';

/** the body a garment is made on: its positions and smooth normals (3 a vertex), the template's faces and weights,
 *  the bone numbers by name */
export interface GarmentBody { P: ArrayLike<number>; N: ArrayLike<number>; faces: readonly number[][]; j: ArrayLike<number>; w: ArrayLike<number>; bone: (name: string) => number }
/** a garment made: a skinned piece (weights 0…1), the palette slot it takes, the body faces it hides */
export interface GarmentPiece { pos: number[]; tris: number[]; j: number[]; w: number[]; slot: number; hide: Set<number> }
export interface Garment { type: string; params?: Record<string, string | number> }
type Ext = { rings: { v?: number; pos: number[]; w: Record<number, number>; out?: number[] }[][]; hideV?: Set<number>; cap?: boolean };
interface Build { set: Map<number, number>; ext: Ext[] }
export interface GarmentType {
  /** where it goes: one garment a slot (a dress covers the bottom too) */
  slot: 'top' | 'bottom' | 'feet' | 'head';
  /** its numbers: enums (the first the default) or [min, max, default] */
  params: Record<string, readonly string[] | readonly [number, number, number]>;
  /** the palette slot of its colour (1 top, 4 bottom, 6 shoes: see clothing › PALETTE) */
  palette: number;
  /** slots it covers besides its own */
  covers?: readonly string[];
  build(b: GarmentBody, p: Record<string, string | number>, R: BodyRings): Build;
}
const LAYER = { top: 0.0085, bottom: 0.005, feet: 0.007, head: 0.011 };
const sleeveEnd: Record<string, number> = { none: -1, short: 3, elbow: 4, long: 12 };
type Add = (rings: number[][], off: number | ((ri: number, c: number) => number)) => void;
const adder = (set: Map<number, number>): Add => (rings, off) => rings.forEach((ring, ri) => ring.forEach((v, c) => { if (v >= 0) set.set(v, Math.max(set.get(v) ?? 0, typeof off === 'function' ? off(ri, c) : off)); }));
const span = (r: number[][], a: number, b: number) => r.slice(a, b + 1);
/** a top: the torso from its hem up, the sleeves to their end; a dress adds a skirt from the hips */
function top(kind: 'shirt' | 'jacket' | 'dress') {
  return (B: GarmentBody, p: Record<string, string | number>, R: BodyRings): Build => {
    const set = new Map<number, number>(), add = adder(set), ext: Ext[] = [];
    const hem = ({ crop: 4, waist: 3, hip: 1, long: 0, knee: 1, midi: 1, ankle: 1 } as Record<string, number>)[String(p.length)] ?? 1;
    const L = Number(p.loose ?? 0), thick = LAYER.top + (kind === 'jacket' ? 0.006 : 0);
    add(span(R.torso, hem, 9), (ri) => thick + L * 0.012 * (1 - Math.abs(ri - 4) / 6));
    const se = sleeveEnd[String(p.sleeve)] ?? 3;
    if (se >= 0) for (const k of [R.armL, R.armR]) add(span(k, 0, se), (ri) => thick + L * 0.008 + (ri === se ? 0.004 : 0));
    if (kind === 'dress') ext.push(skirt(B, R, 1, ({ knee: 0.45, midi: 0.28, ankle: 0.07 } as Record<string, number>)[String(p.length)] ?? 0.28, Number(p.flare ?? 0.45), thick + 0.004));
    if (kind === 'jacket' || p.collar === 'yes') ext.push(collar(B, R, thick));
    return { set, ext };
  };
}
export const GARMENTS: Readonly<Record<string, GarmentType>> = {
  shirt: { slot: 'top', palette: 1, params: { sleeve: ['short', 'none', 'elbow', 'long'], length: ['hip', 'crop', 'waist', 'long'], loose: [0, 1, 0.25], collar: ['no', 'yes'] }, build: top('shirt') },
  jacket: { slot: 'top', palette: 1, params: { sleeve: ['long'], length: ['hip', 'waist'], loose: [0, 1, 0.6] }, build: top('jacket') },
  dress: { slot: 'top', palette: 1, covers: ['bottom'], params: { sleeve: ['long', 'short', 'elbow', 'none'], length: ['ankle', 'knee', 'midi'], flare: [0, 1, 0.45], loose: [0, 1, 0.4] }, build: top('dress') },
  trousers: {
    slot: 'bottom', palette: 4, params: { length: ['long', 'shorts', 'knee', 'three-quarter'], loose: [0, 1, 0.3] },
    build(_B, p, R) {
      const set = new Map<number, number>(), add = adder(set), L = Number(p.loose ?? 0.3);
      const end = ({ shorts: 4, knee: 7, 'three-quarter': 10, long: 13 } as Record<string, number>)[String(p.length)] ?? 13;
      add(span(R.torso, 0, 2), LAYER.bottom + L * 0.006);
      for (const v of R.crotch) set.set(v, LAYER.bottom + L * 0.006);
      for (const k of [R.legL, R.legR]) add(span(k, 0, end), (ri) => LAYER.bottom + L * (0.004 + (0.012 * ri) / end));
      return { set, ext: [] };
    },
  },
  skirt: {
    slot: 'bottom', palette: 4, params: { length: ['knee', 'mini', 'midi', 'ankle'], flare: [0, 1, 0.35] },
    build(B, p, R) {
      const set = new Map<number, number>(); adder(set)(span(R.torso, 2, 3), LAYER.bottom + 0.002);
      return { set, ext: [skirt(B, R, 2, ({ mini: 0.6, knee: 0.45, midi: 0.28, ankle: 0.07 } as Record<string, number>)[String(p.length)] ?? 0.45, Number(p.flare ?? 0.35), LAYER.bottom + 0.003)] };
    },
  },
  sarong: {
    slot: 'bottom', palette: 4, params: { length: ['ankle', 'midi'], flare: [0, 1, 0.15] },
    build(B, p, R) {
      const set = new Map<number, number>(); adder(set)(span(R.torso, 2, 3), LAYER.bottom + 0.002);
      return { set, ext: [skirt(B, R, 2, ({ midi: 0.28, ankle: 0.07 } as Record<string, number>)[String(p.length)] ?? 0.07, Number(p.flare ?? 0.15), LAYER.bottom + 0.003)] };
    },
  },
  shoes: {
    slot: 'feet', palette: 6, params: { high: ['low', 'ankle'] },
    build(_B, p, R) { const set = new Map<number, number>(); for (const k of [R.legL, R.legR]) adder(set)(span(k, p.high === 'ankle' ? 12 : 14, 19), (ri) => LAYER.feet + (ri >= 15 ? 0.002 : 0)); return { set, ext: [] }; },
  },
};
/** a garment's numbers with their defaults */
export function garmentParams(t: GarmentType, p: Record<string, string | number> = {}): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const [k, s] of Object.entries(t.params)) out[k] = p[k] ?? (typeof s[0] === 'string' ? (s[0] as string) : (s as readonly number[])[2]!);
  return out;
}

/** the rings of a skirt's cone from a torso ring down to a height (a share of the body's), flaring, never inside the
 *  legs; it hides the pelvis and the legs above its hem */
function skirt(B: GarmentBody, R: BodyRings, ringIx: number, yHemRel: number, flare: number, off: number): Ext {
  const P = B.P, N = B.N, waist = R.torso[ringIx]!, n = waist.length, c = [0, 0, 0];
  waist.forEach((v) => { for (let k = 0; k < 3; k++) c[k] = c[k]! + P[v * 3 + k]! / n; });
  const yHem = yHemRel * (Math.max(...R.torso[10]!.map((v) => P[v * 3 + 1]!)) / 1.45), steps = 6;
  // what the skirt must enclose: the legs, the crotch, the lower torso rings (the pelvis, the seat)
  const legs = [...R.legL.flat(), ...R.legR.flat(), ...R.crotch, ...R.torso.slice(0, ringIx).flat()].filter((v) => v >= 0);
  const hips = B.bone('Hips'), ul = B.bone('LeftUpLeg'), ur = B.bone('RightUpLeg'), ll = B.bone('LeftLeg'), lr = B.bone('RightLeg');
  const rings: Ext['rings'] = [], T = (k: number) => (k / steps) ** 1.5;          // rings closer together near the waist
  for (let k = 0; k <= steps; k++) {
    const t = T(k), tPrev = k ? T(k - 1) : 0, ring: Ext['rings'][number] = [];
    for (let i = 0; i < n; i++) {
      const v = waist[i]!, dx = P[v * 3]! - c[0]!, dz = P[v * 3 + 2]! - c[2]!, r0 = Math.hypot(dx, dz) || 0.1, ux = dx / r0, uz = dz / r0;
      const y = P[v * 3 + 1]! + (yHem - P[v * 3 + 1]!) * t, yUp = P[v * 3 + 1]! + (yHem - P[v * 3 + 1]!) * tPrev;
      if (k === 0) { const w: Record<number, number> = {}; for (let s = 0; s < 4; s++) w[B.j[v * 4 + s]!] = (w[B.j[v * 4 + s]!] ?? 0) + B.w[v * 4 + s]! / 255; ring.push({ v, pos: [P[v * 3]! + N[v * 3]! * off, P[v * 3 + 1]! + N[v * 3 + 1]! * off, P[v * 3 + 2]! + N[v * 3 + 2]! * off], w, out: [ux, 0, uz] }); continue; }
      let r = (r0 + off) * (1 + flare * 0.9 * t * t + 0.1 * t);
      for (const lv of legs) {
        const ly = P[lv * 3 + 1]!; if (ly < y - 0.05 || ly > yUp + 0.01) continue;
        const ex = P[lv * 3]! - c[0]!, ez = P[lv * 3 + 2]! - c[2]!, along = ex * ux + ez * uz;
        if (along <= 0) continue;
        const cosA = along / (Math.hypot(ex, ez) || 1);
        if (cosA < 0.94) continue;                                     // inside this column's sector (±20°)
        if ((along / cosA) * 0.98 + 0.035 > r) r = (along / cosA) * 0.98 + 0.035;
      }
      // weights: the hips at the waist; down the skirt the thigh on its side takes over (the middle columns share)
      const a = Math.min(1, t * 1.15), side = ux > 0.25 ? 'L' : ux < -0.25 ? 'R' : 'C', w: Record<number, number> = {};
      w[hips] = 1 - 0.75 * a;
      if (side === 'C') { w[ul] = 0.375 * a; w[ur] = 0.375 * a; } else { w[side === 'L' ? ul : ur] = 0.75 * a * (t > 0.75 ? 0.75 : 1); if (t > 0.75) w[side === 'L' ? ll : lr] = 0.75 * a * 0.25; }
      ring.push({ pos: [c[0]! + ux * r, y, c[2]! + uz * r], w, out: [ux, 0, uz] });
    }
    rings.push(ring);
  }
  const hideV = new Set([...R.torso.slice(0, ringIx + 1).flat(), ...R.crotch].filter((v) => v >= 0));
  for (const v of [...R.legL.flat(), ...R.legR.flat()]) if (v >= 0 && P[v * 3 + 1]! > yHem + 0.1) hideV.add(v);
  return { rings, hideV };
}
/** a stand-up collar at the neck */
function collar(B: GarmentBody, R: BodyRings, off: number): Ext {
  const P = B.P, N = B.N, sp2 = B.bone('Spine2'), neck = B.bone('Neck');
  return { rings: [R.torso[9]!, R.torso[10]!].map((ring, k) => ring.map((v) => ({ pos: [P[v * 3]! + N[v * 3]! * (off + 0.006), P[v * 3 + 1]! + N[v * 3 + 1]! * off + k * 0.025, P[v * 3 + 2]! + N[v * 3 + 2]! * (off + 0.006)], w: { [sp2]: 0.6 - k * 0.3, [neck]: 0.4 + k * 0.3 }, out: [N[v * 3]!, 0, N[v * 3 + 2]!] }))) };
}

/** a garment on a body: its shell and pieces skinned, the faces it hides; null for an unknown type */
export function buildGarment(g: Garment, B: GarmentBody, types: Readonly<Record<string, GarmentType>> = GARMENTS): GarmentPiece | null {
  const t = types[g.type]; if (!t) return null;
  const R = bodyRings(), { set, ext } = t.build(B, garmentParams(t, g.params), R), P = B.P, N = B.N;
  const pos: number[] = [], ref: number[] = [], J: number[] = [], W: number[] = [], tris: number[] = [], vmap = new Map<string, number>();
  const emit = (key: string, p: readonly number[], n: readonly number[], j: readonly number[], w: readonly number[]) => {
    let i = vmap.get(key); if (i !== undefined) return i;
    i = pos.length / 3; vmap.set(key, i); pos.push(p[0]!, p[1]!, p[2]!); ref.push(n[0]!, n[1]!, n[2]!); J.push(...j); W.push(...w);
    return i;
  };
  const bodyVert = (v: number) => { const off = set.get(v)!; return emit(`b${v}`, [P[v * 3]! + N[v * 3]! * off, P[v * 3 + 1]! + N[v * 3 + 1]! * off, P[v * 3 + 2]! + N[v * 3 + 2]! * off], [N[v * 3]!, N[v * 3 + 1]!, N[v * 3 + 2]!], [0, 1, 2, 3].map((s) => B.j[v * 4 + s]!), [0, 1, 2, 3].map((s) => B.w[v * 4 + s]! / 255)); };
  // the shell: body faces with every corner in the set; the ones away from its edge are hidden
  const hide = new Set<number>(), boundary = new Set<number>();
  B.faces.forEach((f) => { const k = f.filter((v) => set.has(v)).length; if (k && k < f.length) f.forEach((v) => set.has(v) && boundary.add(v)); });
  B.faces.forEach((f, fi) => {
    if (!f.every((v) => set.has(v))) return;
    const ids = f.map(bodyVert);
    for (let k = 1; k < ids.length - 1; k++) tris.push(ids[0]!, ids[k]!, ids[k + 1]!);
    if (!f.some((v) => boundary.has(v))) hide.add(fi);
  });
  for (const e of ext) if (e.hideV) B.faces.forEach((f, fi) => { if (f.every((v) => e.hideV!.has(v))) hide.add(fi); });
  // the pieces: lofted rings, joined to the shell where they start on its vertices
  const W4 = (w: Record<number, number>): [number[], number[]] => { const e = Object.entries(w).filter(([, x]) => x > 1e-3).sort((a, b) => b[1] - a[1]).slice(0, 4), s = e.reduce((a, [, x]) => a + x, 0) || 1; const j = e.map(([b]) => +b), ww = e.map(([, x]) => x / s); while (j.length < 4) { j.push(0); ww.push(0); } return [j, ww]; };
  ext.forEach((e, ei) => {
    const ids = e.rings.map((ring, ri) => ring.map((q, i) => { if (q.v !== undefined && set.has(q.v)) return bodyVert(q.v); const [j, w] = W4(q.w); return emit(`e${ei}:${ri}:${i}`, q.pos, q.out ?? [0, 0, 1], j, w); }));
    for (let r = 0; r < ids.length - 1; r++) for (let i = 0; i < ids[r]!.length; i++) {
      const j = (i + 1) % ids[r]!.length, a = ids[r]![i]!, b = ids[r]![j]!, c = ids[r + 1]![j]!, d = ids[r + 1]![i]!;
      tris.push(a, d, c, a, c, b);
    }
  });
  // every triangle facing out (the way the body's normals point under it)
  for (let t = 0; t < tris.length; t += 3) {
    const a = tris[t]! * 3, b = tris[t + 1]! * 3, c = tris[t + 2]! * 3;
    const ux = pos[b]! - pos[a]!, uy = pos[b + 1]! - pos[a + 1]!, uz = pos[b + 2]! - pos[a + 2]!, vx = pos[c]! - pos[a]!, vy = pos[c + 1]! - pos[a + 1]!, vz = pos[c + 2]! - pos[a + 2]!;
    const fx = uy * vz - uz * vy, fy = uz * vx - ux * vz, fz = ux * vy - uy * vx;
    if (fx * (ref[a]! + ref[b]! + ref[c]!) + fy * (ref[a + 1]! + ref[b + 1]! + ref[c + 1]!) + fz * (ref[a + 2]! + ref[b + 2]! + ref[c + 2]!) < 0) { const x = tris[t + 1]!; tris[t + 1] = tris[t + 2]!; tris[t + 2] = x; }
  }
  return { pos, tris, j: J, w: W, slot: t.palette, hide };
}
