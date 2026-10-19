// core › entities › body › skin: a mesh bound to a skeleton (4 bones and weights a vertex), packed for the graphics,
// with its motion baked once into rows of skin transforms (a clip: frames of a cycle, sampled by phase), so a crowd
// costs a few numbers a person a frame. The graphics blend the bones by dual quaternions (bent and twisted joints keep
// their volume), interpolate between two rows, and add up to two morph shapes a vertex (correctives) by the weights
// the row carries. Pure: no graphics here (skin › draw does that).
//   const mesh = skinMesh({ positions, joints, weights, index, slots })
//   const fig = figure({ id: 'ana', mesh, skeleton: sk, clips: { walk: bakeClip(sk, 16, (t) => ({ pose: walkAt(t) })) } })
//   entity({ id: 'ana', body: fig, motion: (e) => ({ clip: 'walk', at: e.gait / (2 * Math.PI) }) })
import { AslnutError } from '../../world/errors.ts';
import { packNormal } from '../../geometry/shapes/mesh.ts';
import { DQ_FLOATS, type Skeleton } from './skeleton.ts';

/** floats per vertex: (x, y, z, normal) · (joints 0–1, joints 2–3, palette slot, texture coordinate) · weights ·
 *  (morph deltas packed in three, the weight pair they take) */
export const SKIN_FLOATS = 16;
/** floats per instance: (x, z, height, turn) · (row a, row b, between, scale) · palette 0–3 · palette 4–7 · (id,
 *  decal params ×3) */
export const SKIN_INSTANCE_FLOATS = 20;
/** palette slots a vertex can take its colour from (the instance gives the colours) */
export const SKIN_SLOTS = 8;
/** a row's texels: two a bone, then one with the morph weights */
export const rowTexels = (bones: number) => bones * 2 + 1;

export interface SkinMeshInput {
  /** rest positions, 3 a vertex (metres; the body's frame: x left, y up, z forward) */
  positions: ArrayLike<number>;
  /** normals, 3 a vertex (smooth ones are made from the triangles when absent) */
  normals?: ArrayLike<number>;
  /** 4 bone numbers and 4 weights a vertex (weights summing to 1) */
  joints: ArrayLike<number>; weights: ArrayLike<number>;
  /** triangles (counter-clockwise from outside) */
  index: ArrayLike<number>;
  /** a palette slot a vertex (0 … 7, default 0): its colour comes from the instance */
  slots?: ArrayLike<number>;
  /** texture coordinates (2 a vertex, 0…1; −1: none) for a decal the material draws (a face) */
  uvs?: ArrayLike<number>;
  /** up to two morph shapes a vertex: offsets (3 a vertex each, metres, within ±0.2 m) and the weight pair (0 or 1;
   *  −1 none) a row carries for them */
  morphs?: { a: ArrayLike<number>; b: ArrayLike<number>; pair: ArrayLike<number> };
}
export interface SkinMesh {
  /** SKIN_FLOATS a vertex */
  vertices: Float32Array;
  index: Uint32Array;
  /** its size at rest: [min x, y, z, max x, y, z] */
  bounds: [number, number, number, number, number, number];
}
const q12 = (v: number) => Math.max(0, Math.min(4095, Math.round(v * 10000) + 2048));
/** pack a skinned mesh for the graphics */
export function skinMesh(o: SkinMeshInput): SkinMesh {
  const n = o.positions.length / 3;
  if (o.joints.length < n * 4 || o.weights.length < n * 4) throw new AslnutError('E-DATA-001', 'skinMesh: 4 joints and 4 weights a vertex', { fix: 'joints and weights: 4 numbers for each vertex' });
  const N = o.normals ?? smoothNormals(o.positions, o.index), out = new Float32Array(n * SKIN_FLOATS), P = o.positions;
  const b: [number, number, number, number, number, number] = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let v = 0; v < n; v++) {
    const k = v * SKIN_FLOATS, J = o.joints, W = o.weights;
    out[k] = P[v * 3]!; out[k + 1] = P[v * 3 + 1]!; out[k + 2] = P[v * 3 + 2]!;
    for (let c = 0; c < 3; c++) { b[c] = Math.min(b[c]!, P[v * 3 + c]!); b[c + 3] = Math.max(b[c + 3]!, P[v * 3 + c]!); }
    out[k + 3] = packNormal(N[v * 3]!, N[v * 3 + 1]!, N[v * 3 + 2]!);
    out[k + 4] = J[v * 4]! + 256 * J[v * 4 + 1]!; out[k + 5] = J[v * 4 + 2]! + 256 * J[v * 4 + 3]!;
    out[k + 6] = o.slots ? o.slots[v]! : 0;
    const u = o.uvs ? o.uvs[v * 2]! : -1, w = o.uvs ? o.uvs[v * 2 + 1]! : -1;
    out[k + 7] = u < 0 ? -1 : Math.round(Math.min(1, u) * 4095) * 4096 + Math.round(Math.max(0, Math.min(1, w)) * 4095);
    // weights renormalised (an exporter's rounding)
    const ws = W[v * 4]! + W[v * 4 + 1]! + W[v * 4 + 2]! + W[v * 4 + 3]! || 1;
    for (let c = 0; c < 4; c++) out[k + 8 + c] = W[v * 4 + c]! / ws;
    const m = o.morphs, pair = m ? m.pair[v]! : -1;
    if (m && pair >= 0) {
      const A = m.a, B = m.b, i = v * 3;
      out[k + 12] = q12(A[i]!) * 4096 + q12(A[i + 1]!); out[k + 13] = q12(A[i + 2]!) * 4096 + q12(B[i]!); out[k + 14] = q12(B[i + 1]!) * 4096 + q12(B[i + 2]!);
      out[k + 15] = pair;
    } else { out[k + 12] = out[k + 13] = out[k + 14] = 2048 * 4096 + 2048; out[k + 15] = -1; }
  }
  return { vertices: out, index: Uint32Array.from(o.index), bounds: b };
}
/** smooth normals: each vertex the area-weighted sum of its triangles' */
export function smoothNormals(P: ArrayLike<number>, index: ArrayLike<number>): Float32Array {
  const N = new Float32Array(P.length);
  for (let t = 0; t + 2 < index.length; t += 3) {
    const a = index[t]! * 3, b = index[t + 1]! * 3, c = index[t + 2]! * 3;
    const ux = P[b]! - P[a]!, uy = P[b + 1]! - P[a + 1]!, uz = P[b + 2]! - P[a + 2]!, vx = P[c]! - P[a]!, vy = P[c + 1]! - P[a + 1]!, vz = P[c + 2]! - P[a + 2]!;
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const i of [a, b, c]) { N[i] = N[i]! + nx; N[i + 1] = N[i + 1]! + ny; N[i + 2] = N[i + 2]! + nz; }
  }
  for (let i = 0; i < N.length; i += 3) { const l = Math.hypot(N[i]!, N[i + 1]!, N[i + 2]!) || 1; N[i] = N[i]! / l; N[i + 1] = N[i + 1]! / l; N[i + 2] = N[i + 2]! / l; }
  return N;
}

/** a body's state for one row: its pose (local rotations, 4 a bone), its roots moved by `root`, the morph weights */
export interface PoseFrame { pose: Float32Array; root?: readonly number[]; morphs?: readonly number[] }
/** a motion baked: `frames` rows of skin transforms (rowTexels(bones) × 4 floats each); a gait's cycle carries the
 *  metres it covers (the phase follows the ground walked, so the feet do not slide) */
export interface Clip { frames: number; loop: boolean; data: Float32Array; distance?: number }
/** bake a motion into rows: `at(t)` for t = 0 … 1 (a loop's last frame is its first again: t < 1) */
export function bakeClip(sk: Skeleton, frames: number, at: (t: number) => PoseFrame, o: { loop?: boolean; distance?: number } = {}): Clip {
  const loop = o.loop ?? true, T = rowTexels(sk.count) * 4, data = new Float32Array(frames * T);
  for (let f = 0; f < frames; f++) writeRow(sk, at(loop ? f / frames : frames > 1 ? f / (frames - 1) : 0), data, f * T);
  return { frames, loop, data, distance: o.distance };
}
/** one row's numbers for a pose frame (into `out` at `at`) */
export function writeRow(sk: Skeleton, fr: PoseFrame, out: Float32Array, at = 0): void {
  sk.dual(fr.pose, fr.root ?? [0, 0, 0], out, at);
  const m = fr.morphs ?? [], k = at + sk.count * DQ_FLOATS;
  for (let i = 0; i < 4; i++) out[k + i] = m[i] ?? 0;
}

/** what a body is doing now: a clip at a phase (0…1), blended toward another (`mix`), or a pose of its own */
export type Motion = { clip: string; at: number; to?: { clip: string; at: number; mix: number } } | { pose: PoseFrame; key?: unknown };
/** a skinned body ready to draw: its mesh, skeleton and clips; its decal material (a face) when it has one; how tall
 *  it stands (its level of detail goes by it) */
export interface Figure {
  readonly id: string;
  readonly mesh: SkinMesh;
  readonly skeleton: Skeleton;
  readonly clips: Readonly<Record<string, Clip>>;
  /** the decal's code (core › entities › body › draw: SkinMaterial); none: plain colours */
  readonly material?: SkinMaterial | null;
  readonly height: number;
}
/** a figure's decal, in both shading languages: a function `skinDecal(uv, params, base, seed) -> colour` (WGSL:
 *  `fn skinDecal(uv: vec2f, p: vec3f, base: vec3f, seed: f32) -> vec3f`; GLSL: `vec3 skinDecal(vec2 uv, vec3 p, vec3
 *  base, float seed)`), with `frame.eye.w` (seconds) for the clock. One program per material */
export interface SkinMaterial { readonly id: string; readonly wgsl: string; readonly glsl: string }
export function figure(o: { id: string; mesh: SkinMesh; skeleton: Skeleton; clips?: Record<string, Clip>; material?: SkinMaterial | null; height?: number }): Figure {
  return { id: o.id, mesh: o.mesh, skeleton: o.skeleton, clips: o.clips ?? {}, material: o.material ?? null, height: o.height ?? o.mesh.bounds[4] - o.mesh.bounds[1] };
}
