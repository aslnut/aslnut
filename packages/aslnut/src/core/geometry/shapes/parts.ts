// core › geometry › shapes › parts: how a shape is put together. Its builder works in a frame (moved, turned,
// scaled: frame(t, fn)), and names what it builds: parts (movable pieces with a pivot), anchors (contact points: where
// you sit, grip, stand, enter) and groups (a cab, a bay: kept with their triangles, no pivot). The verbs that make the
// triangles are the builder's (builder.ts); it carries these.
//   b.part('lid', (b) => b.solid('box', { size: [.6, .05, .7], at: [0, 1, 0] }), { pivot: [0, 1, -.35] })
//   b.anchor('driver', [1.8, .9, -.45], { kind: 'seat' }) · b.group('cab', (b) => { … })
import type { MeshBuilder } from './mesh.ts';

export type V3 = [number, number, number];
export type V2 = [number, number];
/** a contact point of a shape (where you sit, grip, stand, enter) */
export interface Anchor { name: string; at: V3; kind?: string; heading?: number }
/** what a part can do (core › entities › kinematics): turn round an axis through its pivot (a hinge within its
 *  limits, degrees; a wheel, its radius m), or slide along it (metres within its limits). Nothing moves it until a layer
 *  gives it a driver */
export interface JointDecl { kind: 'hinge' | 'wheel' | 'slider'; axis: 'x' | 'y' | 'z' | V3; limits?: [number, number]; radius?: number }
/** a movable piece of a shape: its triangles (the vertex range it was built into), its pivot, and its joint (its axis
 *  in the shape's frame) when it has one */
export interface Part { name: string; pivot: V3; first: number; count: number; joint?: JointDecl & { axis: V3 } }

/** a copy over time's emitter (core › geometry › shapes › builder › copy: emit): where it is (the shape's frame), its
 *  copies' life (s), how far they rise, spread and drift over it (m), how much they grow, their opacity from birth to
 *  death, its copies at the whole level */
export interface Emitter { at: V3; life: number; rise: number; spread: number; grow: number; fade: [number, number]; drift: [number, number]; count: number }
/** an affine frame: 3 × 4, columns x, y, z, origin */
export type M = number[];
export const I: M = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];
export const mul = (a: M, b: M): M => {
  const o = new Array<number>(12);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 3; r++) o[c * 3 + r] = a[r]! * b[c * 3]! + a[3 + r]! * b[c * 3 + 1]! + a[6 + r]! * b[c * 3 + 2]! + (c === 3 ? a[9 + r]! : 0);
  return o;
};
export const translate = (v: V3): M => [1, 0, 0, 0, 1, 0, 0, 0, 1, v[0], v[1], v[2]];
export const turnY = (deg: number): M => { const c = Math.cos(deg * Math.PI / 180), s = Math.sin(deg * Math.PI / 180); return [c, 0, s, 0, 1, 0, -s, 0, c, 0, 0, 0]; };
/** a turn of `deg` round a unit axis through the origin, the way turnY turns round y (round y: turnY) */
export const turnAround = (a: V3, deg: number): M => {
  const t = -deg * Math.PI / 180, c = Math.cos(t), s = Math.sin(t), k = 1 - c, [x, y, z] = a;
  return [c + x * x * k, y * x * k + z * s, z * x * k - y * s, x * y * k - z * s, c + y * y * k, z * y * k + x * s, x * z * k + y * s, y * z * k - x * s, c + z * z * k, 0, 0, 0];
};
export const scaleM = (v: V3): M => [v[0], 0, 0, 0, v[1], 0, 0, 0, v[2], 0, 0, 0];
export const frameOf = (x: V3, y: V3, z: V3, o: V3): M => [x[0], x[1], x[2], y[0], y[1], y[2], z[0], z[1], z[2], o[0], o[1], o[2]];
export const det = (m: M) => m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[3]! * (m[1]! * m[8]! - m[2]! * m[7]!) + m[6]! * (m[1]! * m[5]! - m[2]! * m[4]!);
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const neg = (a: V3): V3 => [-a[0], -a[1], -a[2]];

/** a shape's structure: its frames, parts, anchors and groups (the builder extends it with its verbs) */
export class Parts {
  /** the level of detail being built (0 whole, 1 simple, 2 far): your build may read it too */
  readonly level: number;
  readonly anchors: Anchor[] = [];
  readonly parts: Part[] = [];
  readonly groups: { name: string; first: number; count: number }[] = [];
  /** its copies over time (copy: emit): each emitter's place and motion */
  readonly emitters: Emitter[] = [];
  protected m: M = I;
  protected mb: MeshBuilder;
  constructor(mb: MeshBuilder, level = 0) { this.mb = mb; this.level = level; }
  part(name: string, fn: (b: this) => void, o: { pivot?: V3; joint?: JointDecl } = {}): this {
    const first = this.mb.count; fn(this);
    const j = o.joint, ax = j ? (typeof j.axis === 'string' ? ({ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] } as Record<string, V3>)[j.axis]! : j.axis) : null;
    this.parts.push({ name, pivot: this.place(o.pivot ?? [0, 0, 0]), first, count: this.mb.count - first, ...(j && ax ? { joint: { ...j, axis: this.dir(ax) } } : {}) });
    return this;
  }
  /** a named group of what fn builds (a cab, a bay): kept with its triangles like a part, without a pivot */
  group(name: string, fn: (b: this) => void): this { const first = this.mb.count; fn(this); this.groups.push({ name, first, count: this.mb.count - first }); return this; }
  anchor(name: string, at: V3, o: { kind?: string; heading?: number } = {}): this { this.anchors.push({ name, at: this.place(at), kind: o.kind, heading: o.heading }); return this; }
  /** build in a frame of your own: moved, turned (degrees round the vertical), scaled */
  frame(t: { at?: V3; turn?: number; scale?: number | V3 }, fn: (b: this) => void): this {
    const s = typeof t.scale === 'number' ? [t.scale, t.scale, t.scale] as V3 : t.scale ?? [1, 1, 1];
    return this.within(mul(mul(translate(t.at ?? [0, 0, 0]), turnY(t.turn ?? 0)), scaleM(s)), () => fn(this));
  }
  /** in the frame m (relative to the current one) */
  within(m: M, fn: () => void): this { const keep = this.m; this.m = mul(keep, m); try { fn(); } finally { this.m = keep; } return this; }
  /** a frame's place → the shape's */
  place(p: V3): V3 { const m = this.m; return [m[0]! * p[0] + m[3]! * p[1] + m[6]! * p[2] + m[9]!, m[1]! * p[0] + m[4]! * p[1] + m[7]! * p[2] + m[10]!, m[2]! * p[0] + m[5]! * p[1] + m[8]! * p[2] + m[11]!]; }
  /** a frame's direction → the shape's (unit) */
  protected dir(n: V3): V3 { const m = this.m; return norm([m[0]! * n[0] + m[3]! * n[1] + m[6]! * n[2], m[1]! * n[0] + m[4]! * n[1] + m[7]! * n[2], m[2]! * n[0] + m[5]! * n[1] + m[8]! * n[2]]); }
}
