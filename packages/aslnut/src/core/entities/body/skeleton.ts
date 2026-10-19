// core › entities › body › skeleton: bones with a parent and a rest place (rest rotations are the identity, so a
// pose is simply each bone's rotation in its parent's rest frame), solved into the skin's transforms as dual
// quaternions (8 numbers a bone: a rotation and a translation that blend without losing volume). Pure: no graphics.
//   const sk = skeleton([{ name: 'hips', head: [0, 1, 0] }, { name: 'knee', parent: 'hips', head: [0.1, 0.5, 0] }])
//   const pose = sk.rest(); rotate(pose, sk.index('knee'), [1, 0, 0], 0.5); const dq = sk.dual(pose, [0, 0, 0])
//   skinPoint(out, x, y, z, joints, weights, k, dq)   (the same blend the graphics do, on the CPU)
import { AslnutError } from '../../world/errors.ts';

export type Vec3 = [number, number, number];
/** a bone: its name, its parent's (none: a root), where it starts at rest (metres, the body's own frame) */
export interface BoneSpec { name: string; parent?: string | null; head: readonly number[] }
/** floats per bone in a skin transform: a dual quaternion (rotation x y z w, then its dual part) */
export const DQ_FLOATS = 8;

export class Skeleton {
  readonly names: readonly string[];
  /** each bone's parent (−1: a root); parents always come before their children */
  readonly parent: Int16Array;
  /** rest places, 3 a bone */
  readonly head: Float32Array;
  private byName = new Map<string, number>();
  constructor(bones: readonly BoneSpec[]) {
    if (!bones?.length) throw new AslnutError('E-DATA-001', 'a skeleton needs bones', { fix: "skeleton([{ name: 'hips', head: [0, 1, 0] }, …])" });
    bones.forEach((b, i) => this.byName.set(b.name, i));
    this.names = bones.map((b) => b.name);
    this.parent = Int16Array.from(bones, (b, i) => {
      if (!b.parent) return -1;
      const p = this.byName.get(b.parent);
      if (p === undefined || p >= i) throw new AslnutError('E-DATA-001', `bone '${b.name}': its parent '${b.parent}' must come before it`, { fix: 'list parents before their children' });
      return p;
    });
    this.head = Float32Array.from(bones.flatMap((b) => [b.head[0]!, b.head[1]!, b.head[2]!]));
  }
  get count(): number { return this.names.length; }
  /** a bone's number (−1: none of that name) */
  index(name: string): number { return this.byName.get(name) ?? -1; }
  /** the rest pose: every rotation the identity (x y z w, 4 a bone) */
  rest(): Float32Array { const q = new Float32Array(this.count * 4); for (let i = 0; i < this.count; i++) q[i * 4 + 3] = 1; return q; }
  /** every bone's rotation and place in the body's frame for a pose (local rotations), the roots moved by `root` */
  solve(pose: Float32Array, root: readonly number[] = [0, 0, 0], out?: { q: Float32Array; p: Float32Array }): { q: Float32Array; p: Float32Array } {
    const n = this.count, q = out?.q ?? new Float32Array(n * 4), p = out?.p ?? new Float32Array(n * 3), H = this.head, v: Vec3 = [0, 0, 0];
    for (let i = 0; i < n; i++) {
      const a = this.parent[i]!;
      if (a < 0) {
        q.set(pose.subarray(i * 4, i * 4 + 4), i * 4);
        p[i * 3] = H[i * 3]! + root[0]!; p[i * 3 + 1] = H[i * 3 + 1]! + root[1]!; p[i * 3 + 2] = H[i * 3 + 2]! + root[2]!;
        continue;
      }
      // its place: the parent's, plus its rest offset turned as the parent is; its rotation: the parent's, then its own
      rotateVec(v, q, a * 4, H[i * 3]! - H[a * 3]!, H[i * 3 + 1]! - H[a * 3 + 1]!, H[i * 3 + 2]! - H[a * 3 + 2]!);
      p[i * 3] = p[a * 3]! + v[0]; p[i * 3 + 1] = p[a * 3 + 1]! + v[1]; p[i * 3 + 2] = p[a * 3 + 2]! + v[2];
      qmul(q, i * 4, q, a * 4, pose, i * 4);
    }
    return { q, p };
  }
  /** the skin's transforms for a pose: a dual quaternion a bone (DQ_FLOATS), mapping a rest point to its posed place */
  dual(pose: Float32Array, root: readonly number[] = [0, 0, 0], out?: Float32Array, at = 0): Float32Array {
    const n = this.count, o = out ?? new Float32Array(n * DQ_FLOATS), { q, p } = this.solve(pose, root, this.scratch()), v: Vec3 = [0, 0, 0], H = this.head;
    for (let i = 0; i < n; i++) {
      // the translation: where the bone is now, less its rest head turned by its rotation
      rotateVec(v, q, i * 4, H[i * 3]!, H[i * 3 + 1]!, H[i * 3 + 2]!);
      const tx = p[i * 3]! - v[0], ty = p[i * 3 + 1]! - v[1], tz = p[i * 3 + 2]! - v[2];
      const x = q[i * 4]!, y = q[i * 4 + 1]!, z = q[i * 4 + 2]!, w = q[i * 4 + 3]!, k = at + i * DQ_FLOATS;
      o[k] = x; o[k + 1] = y; o[k + 2] = z; o[k + 3] = w;
      // dual = ½ (t, 0) · q
      o[k + 4] = 0.5 * (tx * w + ty * z - tz * y);
      o[k + 5] = 0.5 * (ty * w + tz * x - tx * z);
      o[k + 6] = 0.5 * (tz * w + tx * y - ty * x);
      o[k + 7] = -0.5 * (tx * x + ty * y + tz * z);
    }
    return o;
  }
  private sc: { q: Float32Array; p: Float32Array } | null = null;
  private scratch() { return (this.sc ??= { q: new Float32Array(this.count * 4), p: new Float32Array(this.count * 3) }); }
}
export const skeleton = (bones: readonly BoneSpec[]) => new Skeleton(bones);

// ── quaternions (x y z w) in flat arrays ──────────────────────────────────────────────────────────────────────
/** out[o] = a[i] · b[j] (b first, then a); out may be a */
export function qmul(out: Float32Array | number[], o: number, a: ArrayLike<number>, i: number, b: ArrayLike<number>, j: number): void {
  const ax = a[i]!, ay = a[i + 1]!, az = a[i + 2]!, aw = a[i + 3]!, bx = b[j]!, by = b[j + 1]!, bz = b[j + 2]!, bw = b[j + 3]!;
  out[o] = aw * bx + ax * bw + ay * bz - az * by;
  out[o + 1] = aw * by - ax * bz + ay * bw + az * bx;
  out[o + 2] = aw * bz + ax * by - ay * bx + az * bw;
  out[o + 3] = aw * bw - ax * bx - ay * by - az * bz;
}
/** a rotation by `angle` radians about an axis (normalised here) */
export function qaxis(axis: readonly number[], angle: number): [number, number, number, number] {
  const l = Math.hypot(axis[0]!, axis[1]!, axis[2]!) || 1, s = Math.sin(angle / 2) / l;
  return [axis[0]! * s, axis[1]! * s, axis[2]! * s, Math.cos(angle / 2)];
}
/** v = q[i] turned (x, y, z) */
export function rotateVec(out: Vec3 | Float32Array, q: ArrayLike<number>, i: number, x: number, y: number, z: number): void {
  const qx = q[i]!, qy = q[i + 1]!, qz = q[i + 2]!, qw = q[i + 3]!;
  // v + 2 q×(q×v + w v)
  const cx = qy * z - qz * y + qw * x, cy = qz * x - qx * z + qw * y, cz = qx * y - qy * x + qw * z;
  out[0] = x + 2 * (qy * cz - qz * cy); out[1] = y + 2 * (qz * cx - qx * cz); out[2] = z + 2 * (qx * cy - qy * cx);
}
/** turn a bone of a pose by `angle` radians about an axis of its parent's rest frame (after what it has) */
export function rotate(pose: Float32Array, bone: number, axis: readonly number[], angle: number): void {
  if (bone < 0 || !angle) return;
  const r = qaxis(axis, angle); qmul(pose, bone * 4, r, 0, pose, bone * 4);
}
/** slerp from the identity toward q by t (a helper bone that follows its source half way) */
export function qpart(out: Float32Array, o: number, q: ArrayLike<number>, i: number, t: number): void {
  let x = q[i]!, y = q[i + 1]!, z = q[i + 2]!, w = q[i + 3]!;
  if (w < 0) { x = -x; y = -y; z = -z; w = -w; }
  const a = Math.acos(Math.min(1, w)), s = Math.sin(a);
  if (s < 1e-6) { out[o] = x * t; out[o + 1] = y * t; out[o + 2] = z * t; out[o + 3] = 1; const l = Math.hypot(out[o]!, out[o + 1]!, out[o + 2]!, 1); for (let k = 0; k < 4; k++) out[o + k]! /= l; return; }
  const k = Math.sin(a * t) / s;
  out[o] = x * k; out[o + 1] = y * k; out[o + 2] = z * k; out[o + 3] = Math.cos(a * t);
}

/** skin one rest point (x, y, z) of vertex k with its 4 joints and weights by dual-quaternion blending (or linear
 *  blending, `linear`): what the graphics do, on the CPU (grounding a pose, tests) */
export function skinPoint(out: Vec3 | Float32Array, x: number, y: number, z: number, J: ArrayLike<number>, W: ArrayLike<number>, k: number, dq: ArrayLike<number>, linear = false): Vec3 | Float32Array {
  let rx = 0, ry = 0, rz = 0, rw = 0, dx = 0, dy = 0, dz = 0, dw = 0, q0x = 0, q0y = 0, q0z = 0, q0w = 1, first = true;
  if (linear) {
    let ox = 0, oy = 0, oz = 0; const v: Vec3 = [0, 0, 0];
    for (let c = 0; c < 4; c++) {
      const w = W[k * 4 + c]!; if (!w) continue; const m = J[k * 4 + c]! * DQ_FLOATS;
      rotateVec(v, dq, m, x, y, z);
      const t = dqTranslation(dq, m);
      ox += w * (v[0] + t[0]); oy += w * (v[1] + t[1]); oz += w * (v[2] + t[2]);
    }
    out[0] = ox; out[1] = oy; out[2] = oz; return out;
  }
  for (let c = 0; c < 4; c++) {
    let w = W[k * 4 + c]!; if (!w) continue; const m = J[k * 4 + c]! * DQ_FLOATS;
    const qx = dq[m]!, qy = dq[m + 1]!, qz = dq[m + 2]!, qw = dq[m + 3]!;
    // the same hemisphere as the first bone (the shortest blend)
    if (first) { q0x = qx; q0y = qy; q0z = qz; q0w = qw; first = false; }
    if (qx * q0x + qy * q0y + qz * q0z + qw * q0w < 0) w = -w;
    rx += w * qx; ry += w * qy; rz += w * qz; rw += w * qw;
    dx += w * dq[m + 4]!; dy += w * dq[m + 5]!; dz += w * dq[m + 6]!; dw += w * dq[m + 7]!;
  }
  const l = Math.hypot(rx, ry, rz, rw) || 1; rx /= l; ry /= l; rz /= l; rw /= l; dx /= l; dy /= l; dz /= l; dw /= l;
  // p + 2 r×(r×p + w p) + 2 (w d − dw r + r×d)
  const cx = ry * z - rz * y + rw * x, cy = rz * x - rx * z + rw * y, cz = rx * y - ry * x + rw * z;
  out[0] = x + 2 * (ry * cz - rz * cy) + 2 * (rw * dx - dw * rx + (ry * dz - rz * dy));
  out[1] = y + 2 * (rz * cx - rx * cz) + 2 * (rw * dy - dw * ry + (rz * dx - rx * dz));
  out[2] = z + 2 * (rx * cy - ry * cx) + 2 * (rw * dz - dw * rz + (rx * dy - ry * dx));
  return out;
}
/** a dual quaternion's translation: 2 · dual · conj(real) */
export function dqTranslation(dq: ArrayLike<number>, m: number): Vec3 {
  const x = dq[m]!, y = dq[m + 1]!, z = dq[m + 2]!, w = dq[m + 3]!, a = dq[m + 4]!, b = dq[m + 5]!, c = dq[m + 6]!, d = dq[m + 7]!;
  return [2 * (-d * x + a * w - b * z + c * y), 2 * (-d * y + a * z + b * w - c * x), 2 * (-d * z - a * y + b * x + c * w)];
}
