// modules › presets › humans › body › figure: one generated person made drawable. The body from its sliders, its
// face decal, ears and nose placed on its head, a hair style re-fitted to it, the garments it wears (the skin under
// them hidden), all skinned to the skeleton at the body's own joints; its walk, run and idle baked into rows once
// (each frame grounded: the lowest point of the body on the floor). Colours are not in it: they come from each
// instance's palette, so one figure dresses a crowd. Pure (no graphics): a worker can make it.
//   const fig = humanFigure(tpl, { body: { gender_female: 1 }, hair: 'bob', gait: 'brisk' })
//   const fitted = humanFigure(tpl, { body: { gender_female: 1 }, fit: await loadFit(url) })   (a base mesh's silhouette)
import { skeleton as makeSkeleton, skinPoint, type Skeleton } from '../../../../core/entities/body/skeleton.ts';
import { bakeClip, figure, skinMesh, smoothNormals, type Clip, type Figure, type PoseFrame } from '../../../../core/entities/body/skin.ts';
import { generate, vertexParts } from './generator.ts';
import type { Template } from './template.ts';
import { fitBody, type BodyFit } from './fit.ts';
import { AslnutError } from '../../../../core/world/errors.ts';
import { ears, earIndex, nose } from './features.ts';
import { fitHair } from '../hair/fit.ts';
import { buildGarment, GARMENTS, type Garment, type GarmentType } from '../clothing/garments.ts';
import { PALETTE } from '../clothing/index.ts';
import { HumanRig } from '../poses/ops.ts';
import { POSES, type Pose } from '../poses/index.ts';
import { cycle, idle, strideOf, GAITS, type GaitStyle } from '../gaits/index.ts';
import { FACE_MATERIAL } from '../face/index.ts';

export interface FigureSpec {
  /** the body's sliders (body › generator: MORPHS) */
  body?: Record<string, number>;
  /** a fit (body › fit: a base mesh's silhouette, made by tools/humans-fit.mjs) on top of the sliders; none: the
   *  generated body */
  fit?: BodyFit | null;
  /** a hair style of the template (hair › styles); null: none */
  hair?: string | null;
  /** garments made into it (clothing › garments) */
  garments?: Garment[];
  /** how it walks (gaits: a name or a style) */
  gait?: string | GaitStyle;
  /** the face decal (default true) */
  face?: boolean;
  /** frames baked a cycle (default walk 16, run 12, idle 8; 0: not baked) */
  frames?: { walk?: number; run?: number; idle?: number };
  /** still poses baked as one-frame clips (poses › POSES names, or your own) */
  poses?: Record<string, Pose | string>;
}
/** a person's figure, with what it was made from */
export interface HumanFigure extends Figure {
  readonly rig: HumanRig;
  /** its joints at rest (heads and tails) */
  readonly joints: Record<string, { head: [number, number, number]; tail: [number, number, number] }>;
  /** its leg's length (hip to floor, m): its stride goes by it */
  readonly legLength: number;
  readonly spec: FigureSpec;
  readonly triangles: number;
}
let base: Float32Array | null = null;
const bodyTris = (faces: readonly number[][], hide: Set<number>) => { const t: number[] = []; faces.forEach((f, fi) => { if (hide.has(fi)) return; for (let k = 1; k < f.length - 1; k++) t.push(f[0]!, f[k]!, f[k + 1]!); }); return t; };
/** which colour of the palette each body vertex takes: by the bone it follows most (a helper counts as its source) */
function regions(tpl: Template, parts: Uint8Array): Uint8Array {
  const R = new Uint8Array(tpl.verts), slotOf = tpl.bones.map((b) => {
    const n = b.name.replace(/^(Left|Right)/, '').replace(/^helper_(Left|Right)/, 'helper_');
    if (/^(Head|HeadTop_End|Neck)$/.test(n)) return PALETTE.skin;
    if (/^(Spine|Spine1|Spine2|Shoulder)$/.test(n)) return PALETTE.top;
    if (/^(Arm|helper_Shoulder)$/.test(n)) return PALETTE.upperArm;
    if (n === 'ForeArm') return PALETTE.forearm;
    if (/^(Hips|UpLeg|helper_Hip)$/.test(n)) return PALETTE.bottom;
    if (n === 'Leg') return PALETTE.shin;
    if (/^(Foot|ToeBase|Toe_End)$/.test(n)) return PALETTE.shoes;
    return PALETTE.skin;                                                  // the hands
  });
  for (let v = 0; v < tpl.verts; v++) {
    let best = 0, bw = -1; for (let s = 0; s < 4; s++) { const w = tpl.w[v * 4 + s]!; if (w > bw) { bw = w; best = tpl.j[v * 4 + s]!; } }
    R[v] = parts[v] === 3 ? PALETTE.bottom : slotOf[best]!;               // the crotch: the bottoms
  }
  return R;
}
let partsCache: Uint8Array | null = null;

/** make a person's figure from a template */
export function humanFigure(tpl: Template, spec: FigureSpec = {}, o: { id?: string; garmentTypes?: Readonly<Record<string, GarmentType>> } = {}): HumanFigure {
  if (spec.fit && spec.fit.verts !== tpl.verts) throw new AslnutError('E-LOAD-005', `humans fit: it fits ${spec.fit.verts} vertices, the template has ${tpl.verts}`, { fix: 'make the fit for this template (tools/humans-fit.mjs --template)' });
  const g = fitBody(generate(spec.body ?? {}), spec.fit), B1 = g.positions, P = g.P, n = tpl.verts;
  base ??= generate({}).positions;
  partsCache ??= vertexParts();
  const bone = (name: string) => tpl.bones.findIndex((b) => b.name === name), head = bone('Head');
  const faces = tpl.faces, N = smoothNormals(B1, bodyTris(faces, new Set()));
  // the pieces, merged: positions, joints, weights (0…1), slots, texture coordinates, triangles
  const pos: number[] = Array.from(B1), J: number[] = Array.from(tpl.j), W: number[] = Array.from(tpl.w, (x) => x / 255);
  const slots: number[] = Array.from(regions(tpl, partsCache)), uvs: number[] = new Array(n * 2).fill(-1), idx: number[] = [];
  const add = (p: ArrayLike<number>, tris: ArrayLike<number>, j: ArrayLike<number>, w: ArrayLike<number>, slot: number, uv?: ArrayLike<number>) => {
    const o0 = pos.length / 3, m = p.length / 3;
    for (let i = 0; i < p.length; i++) pos.push(p[i]!);
    for (let i = 0; i < m * 4; i++) { J.push(j[i]!); W.push(w[i]!); }
    for (let i = 0; i < m; i++) { slots.push(slot); uvs.push(uv ? uv[i * 2]! : -1, uv ? uv[i * 2 + 1]! : -1); }
    for (let i = 0; i < tris.length; i++) idx.push(tris[i]! + o0);
  };
  // garments first: they hide the body faces they cover
  const hide = new Set<number>(), types = o.garmentTypes ?? GARMENTS;
  const gb = { P: B1, N, faces, j: tpl.j, w: tpl.w, bone };
  const pieces = (spec.garments ?? []).map((x) => buildGarment(x, gb, types)).filter((x) => !!x);
  for (const pc of pieces) for (const f of pc.hide) hide.add(f);
  idx.push(...bodyTris(faces, hide));
  for (const pc of pieces) add(pc.pos, pc.tris, pc.j, pc.w, pc.slot);
  // the face decal: the body's face vertices a little out along their normals, its own coordinates
  if (spec.face !== false && tpl.decal?.vids?.length) {
    const d = tpl.decal, p: number[] = [], j: number[] = [], w: number[] = [];
    for (const v of d.vids) { for (let c = 0; c < 3; c++) p.push(B1[v * 3 + c]! + N[v * 3 + c]! * d.offset); for (let s = 0; s < 4; s++) { j.push(tpl.j[v * 4 + s]!); w.push(tpl.w[v * 4 + s]! / 255); } }
    add(p, d.tris, j, w, PALETTE.skin, d.uv.flat());
  }
  // ears and nose: the head's
  const one = (m: number) => ({ j: Array.from({ length: m * 4 }, (_, i) => (i % 4 ? 0 : head)), w: Array.from({ length: m * 4 }, (_, i) => (i % 4 ? 0 : 1)) });
  const ep = ears(B1, P), eo = one(ep.length / 3); add(ep, earIndex(), eo.j, eo.w, PALETTE.skin);
  const np = nose(B1, P), no = one(np.pos.length / 3); add(np.pos, np.tris, no.j, no.w, PALETTE.skin);
  // the hair, re-fitted to this head
  const hp = spec.hair ? tpl.hair[spec.hair] : null;
  if (hp) add(fitHair(tpl, hp, base, B1), hp.tris, hp.j, Array.from(hp.w, (x) => x / 255), PALETTE.hair);
  // the correctives: two shapes a vertex (its side's), from the template
  const sk: Skeleton = makeSkeleton(tpl.bones.map((b) => ({ name: b.name, parent: b.parent, head: g.joints[b.name]?.head ?? b.head })));
  const rig = new HumanRig(sk, g.joints, { helpers: tpl.helpers, rules: tpl.rules });
  const total = pos.length / 3, ma = new Float32Array(total * 3), mb = new Float32Array(total * 3), pair = new Float32Array(total).fill(-1);
  rig.morphKeys.forEach((keys, side) => keys.forEach((k, slot) => {
    const c = tpl.correctives[k]; if (!c) return;
    c.idx.forEach((v, i) => { (slot ? mb : ma).set([c.d[i * 3]!, c.d[i * 3 + 1]!, c.d[i * 3 + 2]!], v * 3); pair[v] = side; });
  }));
  const mesh = skinMesh({ positions: pos, joints: J, weights: W, index: idx, slots, uvs, morphs: { a: ma, b: mb, pair } });
  // the motions: grounded each frame (the body's lowest point on the floor)
  const gait: GaitStyle = typeof spec.gait === 'string' ? GAITS[spec.gait] ?? {} : spec.gait ?? {};
  const legLength = g.joints.LeftUpLeg?.head[1] ?? 0.9, height = Math.max(...Array.from({ length: n }, (_, v) => B1[v * 3 + 1]!));
  const dq = new Float32Array(sk.count * 8), out: [number, number, number] = [0, 0, 0];
  const grounded = (fr: PoseFrame): PoseFrame => {
    sk.dual(fr.pose, [0, 0, 0], dq);
    let min = Infinity; for (let v = 0; v < n; v += 1) { if (B1[v * 3 + 1]! > 0.6 * height) continue; skinPoint(out, B1[v * 3]!, B1[v * 3 + 1]!, B1[v * 3 + 2]!, tpl.j, W, v, dq); if (out[1] < min) min = out[1]; }
    return { pose: Float32Array.from(fr.pose), morphs: fr.morphs, root: [0, Number.isFinite(min) ? -min : 0, 0] };
  };
  const frames = { walk: 16, run: 12, idle: 8, ...spec.frames }, clips: Record<string, Clip> = {};
  const posed = (fn: (ops: ReturnType<HumanRig['begin']>) => void) => { fn(rig.begin()); return grounded(rig.end()); };
  if (frames.walk) clips.walk = bakeClip(sk, frames.walk, (t) => posed((ops) => cycle(ops, t * Math.PI * 2, 0, 1, gait)), { distance: strideOf(gait, legLength, 0) });
  if (frames.run) clips.run = bakeClip(sk, frames.run, (t) => posed((ops) => cycle(ops, t * Math.PI * 2, 1, 1, gait)), { distance: strideOf(gait, legLength, 1) });
  if (frames.idle) clips.idle = bakeClip(sk, frames.idle, (t) => posed((ops) => idle(ops, t, gait)));
  for (const [name, p] of Object.entries(spec.poses ?? {})) {
    const fn = typeof p === 'string' ? POSES[p] : p; if (!fn) continue;
    clips[name] = bakeClip(sk, 1, () => posed(fn), { loop: false });
  }
  const f = figure({ id: o.id ?? figureKey(spec), mesh, skeleton: sk, clips, material: spec.face !== false ? FACE_MATERIAL : null, height });
  return { ...f, rig, joints: g.joints, legLength, spec, triangles: mesh.index.length / 3 };
}
/** a figure's key: what its geometry and motion are made from (people with the same share one figure) */
export function figureKey(spec: FigureSpec): string {
  const r = (v: number) => Math.round(v * 1000) / 1000, body = Object.entries(spec.body ?? {}).filter(([, v]) => v).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${k}:${r(v)}`).join(',');
  return `h|${body}|${spec.fit ? spec.fit.key : '-'}|${spec.hair ?? '-'}|${JSON.stringify(spec.garments ?? [])}|${typeof spec.gait === 'string' ? spec.gait : JSON.stringify(spec.gait ?? {})}|${spec.face === false ? 0 : 1}|${JSON.stringify(spec.frames ?? {})}|${Object.keys(spec.poses ?? {}).join(',')}`;
}
