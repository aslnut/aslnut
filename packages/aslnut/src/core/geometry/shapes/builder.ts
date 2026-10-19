// core › geometry › shapes › builder: a shape's build gets a builder with a few verbs that cover what things are
// made of:
//   solid(kind, o)            box, cylinder, sphere, cone, capsule
//   extrude(footprint, h, o)  a footprint straight up (a sweep along { up: h })
//   lathe(profile, o)         a profile (radius, height) round the vertical axis (a sweep along { around: 'y' })
//   sweep(profile, path, o)   a 2D profile along a path: an extrusion, a lathe, a tube, a moulding, a railing, a branch
//   copy(fn, how)             mirror, repeat, along a path, scatter in an area: fn builds each copy in its own frame
//   scope(box | footprint)    a box (or a footprint) to split along an axis and to take the faces of: the grammar
//                             mechanism that buildings are made with (scope.ts)
//   mesh(triangles, o)        raw triangles: the escape hatch
//   label(text, o)            letters on a face (a block font: a livery, a sign, a number)
//   finish on every verb      color, material, round, detail (the levels it is drawn at), tint (the instance's colour
//                             on it: a fleet's paint), lamps (it lights up from dusk: head, tail, windows), label
// plus part(name, fn, { pivot }), anchor(name, at), group(name, fn) and frame(t, fn) (parts.ts). Places are metres
// (x east, y up, z south); faces turn outward by themselves. The builder writes into a MeshBuilder (mesh.ts): a shape
// for instances, or a mesh for a solids chunk.
import { MeshBuilder, type Colorish } from './mesh.ts';
import { AslnutError } from '../../world/errors.ts';
import { Parts, I, mul, translate, turnY, turnAround, scaleM, det, sub, add, cross, dot, norm, neg, type M, type V2, type V3 } from './parts.ts';
import { Scope } from './scope.ts';
import { EMIT_CODE, LINE_CODE, LAMP_CODES, codeOf, type LampKind, type Material, type MaterialName as AnyMaterialName } from '../../render/look/materials.ts';
import { glyphRuns } from './font.ts';

export type { V2, V3 };
/** what a surface is made of (the shader lights each its way; ids carried with every vertex) */
export const MATERIALS_LOOK = { matte: 0, painted: 1, glass: 2, metal: 3, emissive: 4, foliage: 5, water: 6 } as const;
/** a material by name ('wire': its edges as lines; 'ghost': see-through) or a Material (material(kind, opts),
 *  material.custom({ … }): core › render › look › materials) */
export type MaterialName = AnyMaterialName;
/** a finish, on every verb: its colour, material, rounded edges (m), the levels of detail it is drawn at (0: the
 *  whole shape only; 1: the simple one too; 2: also far away); `tint`: it takes the instance's colour (the other
 *  pieces keep theirs: a car's paint by instance) or, built into a mesh, the build's tint; `lamps`: it lights up
 *  from dusk (head, tail, windows: some lit rooms) */
export interface Finish { color?: Colorish; material?: MaterialName | Material; round?: number; detail?: 0 | 1 | 2; tint?: boolean; lamps?: LampKind }
/** letters on a face: their height (m, a capital's), colour, how far they stand off it */
export interface LabelOpts extends Finish {
  /** the middle of the text (local metres; default the origin) */
  at?: V3;
  /** the way the face looks (default [0, 0, 1]) */
  facing?: V3;
  /** the way the text runs (default: across the face, level: up × facing) */
  along?: V3;
  /** a capital's height, m (default .3) */
  height?: number;
  /** the letters off the face, m (default .004) */
  off?: number;
}
/** a label on a solid's face: its text, the face (default front, +z), its middle on the face (u along, v up, m) */
export type SolidLabel = string | { text: string; on?: 'front' | 'back' | 'left' | 'right' | 'top'; at?: V2; height?: number; color?: Colorish; material?: MaterialName | Material; lamps?: LampKind };
export type SolidKind = 'box' | 'cylinder' | 'sphere' | 'cone' | 'capsule';
export interface SolidOpts extends Finish {
  /** a box's size [w, h, d] (or one number); a cylinder's / cone's / capsule's length along its axis */
  size?: number | V3;
  radius?: number;
  /** a cone's radius at its top (default 0) */
  top?: number;
  /** its centre */
  at?: V3;
  axis?: 'x' | 'y' | 'z';
  /** degrees round the vertical */
  turn?: number;
  sides?: number;
  /** letters on one of its faces (a box's; round ones: on its side) */
  label?: SolidLabel;
}
/** a profile: points in its own plane (x across, y up), a circle, or a rectangle (centred) */
export type Profile = readonly V2[] | { circle: number; sides?: number } | { rect: V2 };
/** a path: points in 3D, straight up (an extrusion of a footprint: the profile lies flat, x east, y south), or round
 *  the vertical axis (a lathe: the profile is (radius, height)) */
export type Path = readonly V3[] | { up: number } | { around: 'y'; segments?: number; angle?: number };
export interface SweepOpts extends Finish {
  /** the profile's ends closed (default: a closed profile that is not a lathe) */
  caps?: boolean;
  /** the profile's scale along the path: one number, or [start, end] (a taper) */
  scale?: number | V2;
  /** degrees the profile turns along the path */
  twist?: number;
  /** normals smooth round the profile (a tube) or flat (a moulding); default: smooth for circles and lathes */
  smooth?: boolean;
}
export type CopyHow =
  | { mirror: 'x' | 'z'; keep?: boolean }
  | { repeat: number; step?: V3; turn?: number; /** the turn's axis (default y) and a point on it (default the origin): blades round a hub */ axis?: 'x' | 'y' | 'z' | V3; at?: V3 }
  | { along: readonly V3[]; every: number; align?: boolean }
  | { scatter: readonly V2[]; count: number; seed?: number; turn?: boolean }
  | { emit: EmitSpec };
/** copies over time (an emitter: smoke, sparks, spray): `count` copies (or one count a level: whole, simple, far; 0:
 *  none there) built where copy is, each moving on the chip by its age over its `life` (s, default 3): risen `rise` m,
 *  spread up to `spread` m, drifted by `drift` [x, z] m, grown to `grow` × its size, its opacity from `fade[0]` at birth
 *  to `fade[1]` at death, looping, each its own phase; at most 2 a shape, 1,023 copies each */
export interface EmitSpec { count: number | readonly number[]; life?: number; rise?: number; spread?: number; grow?: number; fade?: readonly [number, number]; drift?: readonly [number, number] }

/** the builder a shape's build gets: the verbs (its parts, anchors, groups and frames: Parts) */
export class Builder extends Parts {
  private tris = 0;
  /** building a copy over time (its triangles take its code) */
  private emitting = false;
  /** the colour tinted pieces take when built straight into a mesh (shape.into(mb, p, { tint })); null: their own */
  tintColor: Colorish | null = null;
  /** triangles so far */
  get triangles(): number { return this.tris; }
  // ── the verbs ─────────────────────────────────────────────────────────────────────────────────────────────────
  solid(kind: SolidKind, o: SolidOpts = {}): this {
    if (!this.drawn(o)) return this;
    const at = o.at ?? [0, 0, 0], axis = o.axis ?? 'y';
    // its own frame: centred on `at`, turned, its axis onto y
    const ax: M = axis === 'y' ? I : axis === 'x' ? [0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0] : [1, 0, 0, 0, 0, 1, 0, -1, 0, 0, 0, 0];
    this.within(mul(mul(translate(at), turnY(o.turn ?? 0)), ax), () => {
      const sides = Math.max(3, o.sides ?? (this.level > 0 ? 8 : 16));
      if (kind === 'box') { const s = sizeOf(o.size, 1); const r = Math.min(o.round ?? 0, s[0] / 2, s[1] / 2, s[2] / 2); if (r > 0) this.roundedBox(s, r, o); else this.box(s, o); return; }
      const r = o.radius ?? (typeof o.size === 'number' ? o.size / 2 : 0.5), h = typeof o.size === 'number' ? o.size : o.size ? o.size[1] : 1;
      if (kind === 'sphere') { this.revolve(Array.from({ length: Math.max(4, Math.round(sides / 2)) + 1 }, (_, i) => { const a = -Math.PI / 2 + (i / Math.max(4, Math.round(sides / 2))) * Math.PI; return [Math.cos(a) * r, Math.sin(a) * r] as V2; }), sides, true, o); return; }
      if (kind === 'cylinder' || kind === 'cone') { const top = kind === 'cone' ? o.top ?? 0 : r; this.revolve([[0, -h / 2], [r, -h / 2], [top, h / 2], [0, h / 2]], sides, false, o); return; }
      if (kind === 'capsule') {
        const n = Math.max(3, Math.round(sides / 4)), prof: V2[] = [];
        for (let i = 0; i <= n; i++) { const a = -Math.PI / 2 + (i / n) * (Math.PI / 2); prof.push([Math.cos(a) * r, -h / 2 + r + Math.sin(a) * r]); }
        for (let i = 0; i <= n; i++) { const a = (i / n) * (Math.PI / 2); prof.push([Math.cos(a) * r, h / 2 - r + Math.sin(a) * r]); }
        this.revolve(prof, sides, true, o); return;
      }
      throw new AslnutError('E-DATA-001', `solid '${kind}' is not one of box, cylinder, sphere, cone, capsule`, { fix: "b.solid('box', { size: [1, 2, 1] })" });
    });
    // its label on a face as it stands (turned, not onto its axis)
    if (o.label !== undefined) this.within(mul(translate(at), turnY(o.turn ?? 0)), () => this.solidLabel(kind, o));
    return this;
  }
  /** letters on a face: a block font, each lit run of a row one quad facing out of the face (the font: capitals,
   *  figures, common marks; small letters as capitals) */
  label(text: string, o: LabelOpts = {}): this {
    if (!this.drawn(o) || !text) return this;
    const f = norm(o.facing ?? [0, 0, 1]), up0: V3 = Math.abs(f[1]) > 0.95 ? [0, 0, -1] : [0, 1, 0];
    let x = o.along ? norm(o.along) : norm(cross(up0, f)); const y = norm(cross(f, x)); x = norm(cross(y, f));
    const h = o.height ?? 0.3, cell = h / 7, adv = cell * 6, at = o.at ?? [0, 0, 0], off = o.off ?? 0.004, chars = [...text];
    const left = -(chars.length * adv - cell) / 2, P = (u: number, v: number): V3 => add(add(add(at, x, u), y, v), f, off);
    chars.forEach((ch, i) => {
      for (const [c0, row, c1] of glyphRuns(ch)) {
        const u0 = left + i * adv + c0 * cell, u1 = left + i * adv + c1 * cell, v1 = h / 2 - row * cell, v0 = v1 - cell;
        this.tri(P(u0, v0), P(u1, v0), P(u1, v1), [f, f, f], o); this.tri(P(u0, v0), P(u1, v1), P(u0, v1), [f, f, f], o);
      }
    });
    return this;
  }
  /** a solid's label on its face (in its own frame: centred, its axis up) */
  private solidLabel(kind: SolidKind, o: SolidOpts): void {
    const L = typeof o.label === 'string' ? { text: o.label } : o.label!, on = L.on ?? 'front';
    const s = kind === 'box' ? sizeOf(o.size, 1) : (() => { const r = o.radius ?? (typeof o.size === 'number' ? o.size / 2 : 0.5), h = typeof o.size === 'number' ? o.size : o.size ? o.size[1] : 1; return [r * 2, kind === 'sphere' ? r * 2 : h, r * 2] as V3; })();
    // the face: its middle, the way it looks, its width (along the text) and height
    const face: Record<string, [V3, V3, number, number]> = { front: [[0, 0, s[2] / 2], [0, 0, 1], s[0], s[1]], back: [[0, 0, -s[2] / 2], [0, 0, -1], s[0], s[1]], right: [[s[0] / 2, 0, 0], [1, 0, 0], s[2], s[1]], left: [[-s[0] / 2, 0, 0], [-1, 0, 0], s[2], s[1]], top: [[0, s[1] / 2, 0], [0, 1, 0], s[0], s[2]] };
    const [mid, facing, w, hh] = face[on] ?? face.front!, n = Math.max(1, [...L.text].length), height = L.height ?? Math.min(hh * 0.6, (w * 0.9) / (n * 6 / 7));
    const x = norm(cross(Math.abs(facing[1]) > 0.95 ? [0, 0, -1] : [0, 1, 0], facing)), y = norm(cross(facing, x)), uv = L.at ?? [0, 0];
    // round solids: the letters stand off their widest point
    this.label(L.text, { at: add(add(mid, x, uv[0]), y, uv[1]), facing, height, off: kind === 'box' ? 0.004 : 0.01, color: L.color ?? '#ffffff', material: L.material, lamps: L.lamps, detail: o.detail });
  }
  /** a footprint ([x, z] lying flat) straight up: the same as sweep(footprint, { up: height }, o) */
  extrude(footprint: readonly V2[], height: number, o: SweepOpts = {}): this { return this.sweep(footprint, { up: height }, o); }
  /** a profile ([radius, height]) round the vertical axis: the same as sweep(profile, { around: 'y', segments, angle }, o) */
  lathe(profile: readonly V2[], o: SweepOpts & { segments?: number; angle?: number } = {}): this { return this.sweep(profile, { around: 'y', segments: o.segments, angle: o.angle }, o); }
  sweep(profile: Profile, path: Path, o: SweepOpts = {}): this {
    if (!this.drawn(o)) return this;
    const prof = profileOf(profile, this.level), closed = !Array.isArray(profile) || true, isCircle = !Array.isArray(profile) && 'circle' in profile;
    if (!Array.isArray(path) && 'around' in path) { this.revolve(prof as V2[], Math.max(3, path.segments ?? (this.level > 0 ? 10 : 24)), o.smooth ?? true, o, (path.angle ?? 360) * Math.PI / 180); return this; }
    const pts: V3[] = Array.isArray(path) ? path as V3[] : [[0, 0, 0], [0, (path as { up: number }).up, 0]];
    if (pts.length < 2) return this;
    const flat = !Array.isArray(path); // a footprint straight up: the profile lies in the ground plane
    const n = pts.length, sc = typeof o.scale === 'number' ? [o.scale, o.scale] : o.scale ?? [1, 1], tw = (o.twist ?? 0) * Math.PI / 180;
    const rings: V3[][] = [];
    let lenAll = 0; const at: number[] = [0]; for (let i = 1; i < n; i++) { lenAll += Math.hypot(...sub(pts[i]!, pts[i - 1]!)); at.push(lenAll); }
    let prevB: V3 | null = null;
    for (let i = 0; i < n; i++) {
      const t = lenAll ? at[i]! / lenAll : 0, k = sc[0]! + (sc[1]! - sc[0]!) * t, a = tw * t;
      let T = norm(sub(pts[Math.min(n - 1, i + 1)]!, pts[Math.max(0, i - 1)]!));
      if (i > 0 && i < n - 1) T = norm(add(norm(sub(pts[i]!, pts[i - 1]!)), norm(sub(pts[i + 1]!, pts[i]!))));
      // the profile's axes: flat (x east, y south) up a vertical path; else across (right) and up, carried along
      let X: V3, Y: V3;
      if (flat) { X = [1, 0, 0]; Y = [0, 0, 1]; }
      else {
        let B: V3 = prevB ? norm(sub(prevB, add([0, 0, 0], T, dot(prevB, T)))) : norm(cross(T, Math.abs(T[1]) > 0.95 ? [1, 0, 0] : [0, 1, 0]));
        if (!Number.isFinite(B[0])) B = [1, 0, 0];
        prevB = B; X = B; Y = cross(T, B);
      }
      const ca = Math.cos(a), sa = Math.sin(a);
      rings.push(prof.map(([u, v]) => { const uu = (u * ca - v * sa) * k, vv = (u * sa + v * ca) * k; return add(add(pts[i]!, X, uu), Y, vv); }));
    }
    const m = prof.length, wrap = closed && m > 2, smooth = o.smooth ?? isCircle;
    const centre = rings.map((r) => r.reduce((s, p) => add(s, p, 1 / r.length), [0, 0, 0] as V3));
    for (let i = 0; i + 1 < n; i++) for (let j = 0; j < (wrap ? m : m - 1); j++) {
      const a = rings[i]![j]!, b = rings[i]![(j + 1) % m]!, c = rings[i + 1]![(j + 1) % m]!, d = rings[i + 1]![j]!;
      if (smooth) { const na = norm(sub(a, centre[i]!)), nb = norm(sub(b, centre[i]!)), nc = norm(sub(c, centre[i + 1]!)), nd = norm(sub(d, centre[i + 1]!)); this.face4(a, b, c, d, [na, nb, nc, nd], o, centre[i]!); }
      else this.face4(a, b, c, d, null, o, centre[i]!);
    }
    if ((o.caps ?? wrap) && wrap) {
      const tris = triangulate(prof);
      const s0 = rings[0]!, s1 = rings[n - 1]!, dir = norm(sub(centre[n - 1]!, centre[0]!));
      for (let k = 0; k + 2 < tris.length; k += 3) {
        this.faceOut(s0[tris[k]!]!, s0[tris[k + 1]!]!, s0[tris[k + 2]!]!, [-dir[0], -dir[1], -dir[2]], o);
        this.faceOut(s1[tris[k]!]!, s1[tris[k + 1]!]!, s1[tris[k + 2]!]!, dir, o);
      }
    }
    return this;
  }
  copy(fn: (b: Builder, i: number) => void, how: CopyHow): this {
    if ('emit' in how) {
      const e = how.emit, c = typeof e.count === 'number' ? [e.count, e.count, e.count] : e.count, c0 = Math.min(1023, Math.max(0, Math.round(c[0] ?? 0)));
      const n = Math.min(1023, Math.max(0, Math.round(c[Math.min(this.level, c.length - 1)] ?? c0)));
      if (this.emitters.length >= 2) throw new AslnutError('E-DATA-001', 'a shape has at most 2 copies over time (copy: emit)', { fix: 'one emitter with more copies' });
      const k = this.emitters.length;
      this.emitters.push({ at: this.place([0, 0, 0]), life: Math.max(0.05, e.life ?? 3), rise: e.rise ?? 1, spread: e.spread ?? 0.3, grow: e.grow ?? 1, fade: [e.fade?.[0] ?? 1, e.fade?.[1] ?? 0], drift: [e.drift?.[0] ?? 0, e.drift?.[1] ?? 0], count: c0 });
      // each copy its number (spread over the whole level's: a level of fewer copies keeps their phases even)
      for (let i = 0; i < n; i++) { this.mb.normalNow = k * 1024 + Math.floor((i * Math.max(c0, n)) / n); this.emitting = true; try { fn(this, i); } finally { this.emitting = false; this.mb.normalNow = null; } }
      return this;
    }
    if ('mirror' in how) {
      if (how.keep !== false) fn(this, 0);
      return this.within(scaleM(how.mirror === 'x' ? [-1, 1, 1] : [1, 1, -1]), () => fn(this, 1));
    }
    if ('repeat' in how) {
      // each copy stepped, and turned round the axis through `at` (default y through the origin)
      const ax = how.axis === undefined ? null : how.axis === 'x' ? [1, 0, 0] as V3 : how.axis === 'y' ? null : how.axis === 'z' ? [0, 0, 1] as V3 : norm(how.axis), at = how.at ?? [0, 0, 0];
      for (let i = 0; i < how.repeat; i++) {
        const t = (how.turn ?? 0) * i, R = ax ? turnAround(ax, t) : turnY(t), round = how.at ? mul(translate(at), mul(R, translate(neg(at)))) : R;
        this.within(mul(translate([(how.step?.[0] ?? 0) * i, (how.step?.[1] ?? 0) * i, (how.step?.[2] ?? 0) * i]), round), () => fn(this, i));
      }
      return this;
    }
    if ('along' in how) {
      const p = how.along; let total = 0; const seg: number[] = [0]; for (let i = 1; i < p.length; i++) { total += Math.hypot(...sub(p[i]!, p[i - 1]!)); seg.push(total); }
      const n = Math.max(1, Math.floor(total / Math.max(1e-6, how.every)) + 1);
      for (let k = 0; k < n; k++) {
        const s = Math.min(total, k * how.every); let i = 1; while (i < p.length - 1 && seg[i]! < s) i++;
        const t = (s - seg[i - 1]!) / Math.max(1e-9, seg[i]! - seg[i - 1]!), q = add(p[i - 1]!, sub(p[i]!, p[i - 1]!), t), d = sub(p[i]!, p[i - 1]!);
        const turn = how.align === false ? 0 : -Math.atan2(d[2], d[0]) * 180 / Math.PI;
        this.within(mul(translate(q), turnY(turn)), () => fn(this, k));
      }
      return this;
    }
    if ('scatter' in how) {
      const ring = how.scatter; let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      let s = (how.seed ?? 1) * 2654435761 >>> 0 || 1; const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; };
      for (let k = 0, made = 0; made < how.count && k < how.count * 30; k++) {
        const x = x0 + (x1 - x0) * r(), z = z0 + (z1 - z0) * r(); if (!inside(ring, x, z)) continue;
        const turn = how.turn === false ? 0 : r() * 360; this.within(mul(translate([x, 0, z]), turnY(turn)), () => fn(this, made)); made++;
      }
      return this;
    }
    throw new AslnutError('E-DATA-001', 'copy needs how: { mirror } | { repeat } | { along, every } | { scatter, count }', { fix: "b.copy((b, i) => b.solid('box'), { repeat: 5, step: [2, 0, 0] })" });
  }
  scope(box: { size: V3; at?: V3; turn?: number } | { footprint: readonly V2[]; height: number }): Scope {
    if ('footprint' in box) return Scope.footprint(this, box.footprint, box.height);
    const s = box.size, at = box.at ?? [0, 0, 0], t = (box.turn ?? 0) * Math.PI / 180;
    // its corner: the bottom west north of its box (scopes grow from a corner: x, y, z along its sides)
    const X: V3 = [Math.cos(t), 0, Math.sin(t)], Z: V3 = [-Math.sin(t), 0, Math.cos(t)];
    return new Scope(this, add(add(at, X, -s[0] / 2), Z, -s[2] / 2), X, [0, 1, 0], Z, [s[0], s[1], s[2]]);
  }
  /** raw triangles (every three points a face, facing the way its winding says), or with `lines: true` raw 3D
   *  segments (every two points a line, a pixel wide: nets, wireframes, rays). `smooth`: each corner's normal the mean
   *  of the faces that meet at its place (each by its angle there) turning less than `crease` degrees (default 50) from
   *  its own face: a lofted body's panels smooth, its sharp edges kept */
  mesh(points: readonly V3[], o: Finish & { smooth?: boolean; crease?: number; lines?: boolean } = {}): this {
    if (!this.drawn(o)) return this;
    if (o.lines) {
      const col = o.color ?? '#ffffff';
      for (let k = 0; k + 1 < points.length; k += 2) { const A = this.place(points[k]!), B = this.place(points[k + 1]!), up: V3 = [0, 1, 0]; this.mb.solidVertex(A, up, col, LINE_CODE).solidVertex(B, up, col, LINE_CODE).solidVertex(B, up, col, LINE_CODE); }
      return this;
    }
    if (!o.smooth) { for (let k = 0; k + 2 < points.length; k += 3) this.tri(points[k]!, points[k + 1]!, points[k + 2]!, null, o); return this; }
    // each face's normal, each corner's angle (its weight: however the faces are split, a place's normal the same); the
    // corners at each place (places within .1 mm are one)
    const n = Math.floor(points.length / 3), unit: V3[] = [], ang: number[] = [], at = new Map<string, number[]>(), cos = Math.cos(((o.crease ?? 50) * Math.PI) / 180);
    const key = (p: V3) => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)},${Math.round(p[2] * 1e4)}`;
    const angle = (p: V3, q: V3, r: V3) => { const u = norm(sub(q, p)), v = norm(sub(r, p)); return Math.acos(Math.max(-1, Math.min(1, dot(u, v)))); };
    for (let f = 0; f < n; f++) {
      const a = points[f * 3]!, b = points[f * 3 + 1]!, c = points[f * 3 + 2]!; unit.push(norm(cross(sub(b, a), sub(c, a))));
      ang.push(angle(a, b, c), angle(b, c, a), angle(c, a, b));
      [a, b, c].forEach((p, k) => { const id = key(p), l = at.get(id); if (l) l.push(f * 3 + k); else at.set(id, [f * 3 + k]); });
    }
    for (let f = 0; f < n; f++) {
      const u = unit[f]!; if (!(Math.abs(u[0]) + Math.abs(u[1]) + Math.abs(u[2]) > 0.5)) continue;
      const corner = (p: V3): V3 => { let s: V3 = [0, 0, 0]; for (const g of at.get(key(p))!) { const ug = unit[Math.floor(g / 3)]!; if (dot(ug, u) >= cos) s = add(s, ug, ang[g]!); } return norm(s); };
      const a = points[f * 3]!, b = points[f * 3 + 1]!, c = points[f * 3 + 2]!;
      this.tri(a, b, c, [corner(a), corner(b), corner(c)], o);
    }
    return this;
  }
  // ── inside ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** is a piece with this finish drawn at the level built */
  private drawn(o: Finish): boolean { return (o.detail ?? 2) >= this.level; }
  /** a triangle (local places, normals or flat), its winding fixed so the face looks the way its normal does */
  tri(a: V3, b: V3, c: V3, n: [V3, V3, V3] | null, o: Finish): void {
    let A = this.place(a), B = this.place(b), C = this.place(c);
    const fn = cross(sub(B, A), sub(C, A)); if (Math.hypot(fn[0], fn[1], fn[2]) < 1e-14) return;
    let na: V3, nb: V3, nc: V3;
    if (n) { na = this.dir(n[0]); nb = this.dir(n[1]); nc = this.dir(n[2]); if (det(this.m) < 0) { na = neg(na); nb = neg(nb); nc = neg(nc); } }
    else { na = nb = nc = norm(fn); }
    // the winding follows the normal (a mirrored frame turns triangles inside out: put them back)
    if (dot(fn, add(add(na, nb), nc)) < 0) { [B, C] = [C, B]; [nb, nc] = [nc, nb]; }
    const mat = this.emitting ? EMIT_CODE : o.lamps ? LAMP_CODES[o.lamps] ?? 0 : codeOf(o.material), col = o.tint && this.tintColor !== null ? this.tintColor : o.color ?? '#ffffff', t = !!o.tint;
    this.mb.solidVertex(A, na, col, mat, t).solidVertex(B, nb, col, mat, t).solidVertex(C, nc, col, mat, t);
    this.tris++;
  }
  /** a quad a b c d, outward from `inside` (or with normals at its corners) */
  private face4(a: V3, b: V3, c: V3, d: V3, n: [V3, V3, V3, V3] | null, o: Finish, inside: V3): void {
    if (n) { this.tri(a, b, c, [n[0], n[1], n[2]], o); this.tri(a, c, d, [n[0], n[2], n[3]], o); return; }
    let f = norm(cross(sub(b, a), sub(c, a))); const mid: V3 = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2, (a[2] + c[2]) / 2];
    if (dot(f, sub(mid, inside)) < 0) f = neg(f);
    this.tri(a, b, c, [f, f, f], o); this.tri(a, c, d, [f, f, f], o);
  }
  private faceOut(a: V3, b: V3, c: V3, out: V3, o: Finish): void { this.tri(a, b, c, [out, out, out], o); }
  private box(s: V3, o: Finish): void {
    const [x, y, z] = [s[0] / 2, s[1] / 2, s[2] / 2], P = (i: number, j: number, k: number): V3 => [i * x, j * y, k * z];
    const faces: [V3, V3[]][] = [
      [[1, 0, 0], [P(1, -1, -1), P(1, -1, 1), P(1, 1, 1), P(1, 1, -1)]], [[-1, 0, 0], [P(-1, -1, 1), P(-1, -1, -1), P(-1, 1, -1), P(-1, 1, 1)]],
      [[0, 1, 0], [P(-1, 1, -1), P(1, 1, -1), P(1, 1, 1), P(-1, 1, 1)]], [[0, -1, 0], [P(-1, -1, 1), P(1, -1, 1), P(1, -1, -1), P(-1, -1, -1)]],
      [[0, 0, 1], [P(1, -1, 1), P(-1, -1, 1), P(-1, 1, 1), P(1, 1, 1)]], [[0, 0, -1], [P(-1, -1, -1), P(1, -1, -1), P(1, 1, -1), P(-1, 1, -1)]],
    ];
    for (const [nn, q] of faces) { if (nn[1] < 0 && (this.level > 0 || (o as SolidOpts & { bottom?: boolean }).bottom === false)) continue; this.tri(q[0]!, q[1]!, q[2]!, [nn, nn, nn], o); this.tri(q[0]!, q[2]!, q[3]!, [nn, nn, nn], o); }
  }
  private roundedBox(s: V3, r: number, o: Finish): void {
    const U = this.level > 0 ? 8 : 16, V = this.level > 0 ? 4 : 8, inner: V3 = [s[0] / 2 - r, s[1] / 2 - r, s[2] / 2 - r];
    const pt = (u: number, v: number): [V3, V3] => { const th = (u / U) * Math.PI * 2, ph = (v / V) * Math.PI, d: V3 = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)]; return [[Math.sign(d[0]) * inner[0] + d[0] * r, Math.sign(d[1]) * inner[1] + d[1] * r, Math.sign(d[2]) * inner[2] + d[2] * r], d]; };
    for (let v = 0; v < V; v++) for (let u = 0; u < U; u++) { const [a, na] = pt(u, v), [b, nb] = pt(u + 1, v), [c, nc] = pt(u + 1, v + 1), [d, nd] = pt(u, v + 1); this.tri(a, b, c, [na, nb, nc], o); this.tri(a, c, d, [na, nc, nd], o); }
  }
  /** a profile (radius, height) round the vertical axis; smooth: normals round the axis, else flat faces */
  private revolve(prof: readonly V2[], sides: number, smooth: boolean, o: Finish, angle = Math.PI * 2): void {
    const full = angle >= Math.PI * 2 - 1e-6, steps = full ? sides : Math.max(1, Math.round(sides * angle / (Math.PI * 2)));
    // each segment's normal in the profile plane (radius, height); smooth: a profile point's normal the mean of its
    // two segments' where they turn by less than 50° (a sphere is round both ways; a cylinder's rim stays sharp)
    const seg = prof.slice(0, -1).map((p0, i) => { const p1 = prof[i + 1]!, dy = p1[1] - p0[1], dr = p1[0] - p0[0], ln = Math.hypot(dy, dr) || 1; return [dy / ln, -dr / ln] as V2; });
    const at = (i: number, j: number): V2 => {
      const own = seg[i]!, nb = seg[j]; if (!smooth || !nb || own[0] * nb[0] + own[1] * nb[1] < Math.cos(50 * Math.PI / 180)) return own;
      const m: V2 = [own[0] + nb[0], own[1] + nb[1]], l = Math.hypot(m[0], m[1]) || 1; return [m[0] / l, m[1] / l];
    };
    for (let i = 0; i + 1 < prof.length; i++) {
      const [r0, y0] = prof[i]!, [r1, y1] = prof[i + 1]!; if (r0 < 1e-9 && r1 < 1e-9) continue;
      // (a pole on the axis faces straight along it)
      const [nr, ny] = seg[i]!, [nr0, ny0] = smooth && r0 < 1e-6 ? [0, y0 < y1 ? -1 : 1] : at(i, i - 1), [nr1, ny1] = smooth && r1 < 1e-6 ? [0, y1 < y0 ? -1 : 1] : at(i, i + 1);
      for (let k = 0; k < steps; k++) {
        const a = (k / sides) * Math.PI * 2, b = ((k + 1) / sides) * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a), cb = Math.cos(b), sb = Math.sin(b);
        const A: V3 = [r0 * ca, y0, r0 * sa], B: V3 = [r0 * cb, y0, r0 * sb], C: V3 = [r1 * cb, y1, r1 * sb], D: V3 = [r1 * ca, y1, r1 * sa];
        const NA: V3 = [nr0 * ca, ny0, nr0 * sa], NB: V3 = [nr0 * cb, ny0, nr0 * sb], NC: V3 = [nr1 * cb, ny1, nr1 * sb], ND: V3 = [nr1 * ca, ny1, nr1 * sa];
        if (smooth) { this.tri(A, B, C, [NA, NB, NC], o); this.tri(A, C, D, [NA, NC, ND], o); }
        else { const m = (a + b) / 2, N: V3 = [nr * Math.cos(m), ny, nr * Math.sin(m)]; this.tri(A, B, C, [N, N, N], o); this.tri(A, C, D, [N, N, N], o); }
      }
    }
    void full;
  }
}
const sizeOf = (s: SolidOpts['size'], def: number): V3 => (typeof s === 'number' ? [s, s, s] : s ? [s[0], s[1], s[2]] : [def, def, def]);
function profileOf(p: Profile, level: number): V2[] {
  if (Array.isArray(p)) return p as V2[];
  if ('circle' in p) { const n = Math.max(3, (p as { sides?: number }).sides ?? (level > 0 ? 6 : 12)); return Array.from({ length: n }, (_, i) => [Math.cos((i / n) * Math.PI * 2) * p.circle, Math.sin((i / n) * Math.PI * 2) * p.circle] as V2); }
  const [w, h] = (p as { rect: V2 }).rect; return [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
}
function inside(ring: readonly V2[], x: number, z: number): boolean { let c = false; for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xa, za] = ring[a]!, [xb, zb] = ring[b]!; if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) c = !c; } return c; }
/** a polygon's triangles (ear clipping): index triples */
export function triangulate(ring: readonly V2[]): number[] {
  const n = ring.length; if (n < 3) return [];
  let area = 0; for (let i = 0, j = n - 1; i < n; j = i++) area += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  const idx = Array.from({ length: n }, (_, i) => i); if (area < 0) idx.reverse();
  const out: number[] = []; let guard = 0;
  const cr = (a: V2, b: V2, c: V2) => (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  while (idx.length > 3 && guard++ < n * n) {
    let cut = false;
    for (let i = 0; i < idx.length; i++) {
      const ia = idx[(i + idx.length - 1) % idx.length]!, ib = idx[i]!, ic = idx[(i + 1) % idx.length]!, a = ring[ia]!, b = ring[ib]!, c = ring[ic]!;
      if (cr(a, b, c) <= 0) continue;
      let ear = true; for (const k of idx) { if (k === ia || k === ib || k === ic) continue; const p = ring[k]!; if (cr(a, b, p) >= 0 && cr(b, c, p) >= 0 && cr(c, a, p) >= 0) { ear = false; break; } }
      if (!ear) continue;
      out.push(ia, ib, ic); idx.splice(i, 1); cut = true; break;
    }
    if (!cut) break;
  }
  if (idx.length === 3) out.push(idx[0]!, idx[1]!, idx[2]!);
  return out;
}
