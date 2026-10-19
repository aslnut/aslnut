// core › geometry › shapes › builder › scope: a box (or a footprint) to build in by splitting, the grammar mechanism
// buildings are made with. A scope splits along an axis, repeats, takes its faces (scopes of no depth: x along the
// face, y up it, z out), insets, stands out (extrude), fills itself (solid), takes a panel or a roof, or hands you its
// frame (build). grammar(spec) makes a shape from rules over scopes (a split grammar).
//   b.scope({ footprint, height: 9 }).split('y', ['~3']).forEach((floor) => floor.faces().walls.forEach(…))
//   grammar({ lot: (p) => p.site, rules: { Lot: (s, p, go) => { … }, Floor: … } })
import { AslnutError } from '../../world/errors.ts';
import { add, frameOf, neg, type V2, type V3 } from './parts.ts';
import type { Builder, Finish, SolidKind, SolidOpts } from './builder.ts';
import { roofFaces, type RoofFaceOptions, type RoofForm } from './roofs.ts';
import { Shape, type ParamSpec, type ParamsOf, type ShapeSpec } from './shape.ts';

/** a box to build in by splitting: its corner (bottom, west, north), its axes x, y (up) and z, and its size along
 *  them; faces are scopes of no depth lying on a side, x along it, y up it, z outward */
export class Scope {
  readonly b: Builder; readonly o: V3; readonly x: V3; readonly y: V3; readonly z: V3; readonly size: V3; private ring: readonly V2[] | null;
  constructor(b: Builder, o: V3, x: V3, y: V3, z: V3, size: V3, ring: readonly V2[] | null = null) { this.b = b; this.o = o; this.x = x; this.y = y; this.z = z; this.size = size; this.ring = ring; }
  static footprint(b: Builder, ring: readonly V2[], height: number): Scope {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    return new Scope(b, [x0, 0, z0], [1, 0, 0], [0, 1, 0], [0, 0, 1], [x1 - x0, height, z1 - z0], ring);
  }
  get width(): number { return this.size[0]; } get height(): number { return this.size[1]; } get depth(): number { return this.size[2]; }
  /** a place in the scope: fractions (0..1) or, with `metres`, metres along its axes */
  at(u: number, v: number, w: number, metres = false): V3 { const k: V3 = metres ? [1, 1, 1] : this.size; return add(add(add(this.o, this.x, u * k[0]), this.y, v * k[1]), this.z, w * k[2]); }
  /** split along an axis: sizes in metres, '*' takes what is left (shared), '~n' repeats near n metres to fill */
  split(axis: 'x' | 'y' | 'z', sizes: readonly (number | '*' | `~${number}`)[]): Scope[] {
    const k = axis === 'x' ? 0 : axis === 'y' ? 1 : 2, total = this.size[k]!;
    const fixed = sizes.reduce<number>((s, v) => s + (typeof v === 'number' ? v : 0), 0), stars = sizes.filter((v) => v === '*').length;
    const out: Scope[] = []; let t = 0;
    const piece = (len: number) => { const o = add(this.o, k === 0 ? this.x : k === 1 ? this.y : this.z, t); const sz: V3 = [...this.size] as V3; sz[k] = len; out.push(new Scope(this.b, o, this.x, this.y, this.z, sz)); t += len; };
    for (const v of sizes) {
      if (typeof v === 'number') piece(Math.max(0, v));
      else if (v === '*') piece(Math.max(0, (total - fixed) / Math.max(1, stars) - 0));
      else { const want = Number(v.slice(1)), left = Math.max(0, total - fixed - t + (sizes.indexOf(v) > 0 ? 0 : 0)), n = Math.max(1, Math.round(left / want)); for (let i = 0; i < n; i++) piece(left / n); }
    }
    return out;
  }
  /** equal pieces near `size` metres along an axis */
  repeat(axis: 'x' | 'y' | 'z', size: number): Scope[] { return this.split(axis, [`~${size}`]); }
  /** its faces: scopes of no depth, x along the face, y up it, z out of the box */
  faces(): { front: Scope; back: Scope; left: Scope; right: Scope; top: Scope; bottom: Scope; walls: Scope[] } {
    const [w, h, d] = this.size, X = this.x, Y = this.y, Z = this.z, nZ = neg(Z), nX = neg(X);
    const front = new Scope(this.b, add(this.o, Z, d), X, Y, Z, [w, h, 0]);                         // south side (+z)
    const back = new Scope(this.b, add(this.o, X, w), nX, Y, nZ, [w, h, 0]);
    const right = new Scope(this.b, add(add(this.o, X, w), Z, d), nZ, Y, X, [d, h, 0]);
    const left = new Scope(this.b, this.o, Z, Y, nX, [d, h, 0]);
    const top = new Scope(this.b, add(add(this.o, Y, h), Z, d), X, nZ, Y, [w, d, 0]);
    const bottom = new Scope(this.b, this.o, X, Z, nZ, [w, d, 0]);
    const walls = this.ring ? footprintWalls(this) : [front, right, back, left];
    return { front, back, left, right, top, bottom, walls };
  }
  /** the footprint's corner points (a box's four) */
  get footprint(): V2[] { if (this.ring) return [...this.ring]; const c = [this.at(0, 0, 0), this.at(1, 0, 0), this.at(1, 0, 1), this.at(0, 0, 1)]; return c.map((p) => [p[0], p[2]]); }
  /** fill it: a solid of its size at its centre (turned with it) */
  solid(kind: SolidKind = 'box', o: Omit<SolidOpts, 'size' | 'at' | 'turn'> & { inset?: number } = {}): this {
    const i = o.inset ?? 0, s: V3 = [Math.max(0.001, this.size[0] - 2 * i), Math.max(0.001, this.size[1] - 2 * i), Math.max(0.001, this.size[2] - 2 * i)];
    if (this.ring && kind === 'box') { this.b.sweep(this.ring.map(([x, z]) => [x, z] as V2), { up: this.size[1] }, o); return this; }
    const c = this.at(0.5, 0.5, 0.5);
    this.b.within(frameOf(this.x, this.y, this.z, c), () => this.b.solid(kind, { ...o, size: s, at: [0, 0, 0] }));
    return this;
  }
  /** a panel on a face scope: depth metres thick, standing `out` metres off it (negative: set in); `flat`: one face
   *  (two triangles) looking out, no thickness */
  panel(o: Finish & { depth?: number; out?: number; inset?: number; flat?: boolean } = {}): this {
    const d = o.flat ? 0 : o.depth ?? 0.05, i = o.inset ?? 0, w = Math.max(0.001, this.size[0] - 2 * i), h = Math.max(0.001, this.size[1] - 2 * i);
    const c = add(this.at(0.5, 0.5, 0), this.z, (o.out ?? 0) + d / 2);
    this.b.within(frameOf(this.x, this.y, this.z, c), () => {
      // (through mesh: drawn only at the levels its finish's `detail` asks, as every other verb; wound to look out, +z)
      if (o.flat) { const hw = w / 2, hh = h / 2; this.b.mesh([[-hw, -hh, 0], [hw, -hh, 0], [hw, hh, 0], [-hw, -hh, 0], [hw, hh, 0], [-hw, hh, 0]], o); }
      else this.b.solid('box', { ...o, size: [w, h, d], at: [0, 0, 0] });
    });
    return this;
  }
  /** build in its own frame (its corner the origin, its axes x y z) */
  build(fn: (b: Builder, s: { width: number; height: number; depth: number }) => void): this {
    this.b.within(frameOf(this.x, this.y, this.z, this.o), () => fn(this.b, { width: this.size[0], height: this.size[1], depth: this.size[2] }));
    return this;
  }
  /** a roof over it (core › geometry › shapes › roofs): 'flat', 'gable', 'hip', 'dutch' (a hip with a small gable at
   *  the top of each end), 'skillion' (high on its `high` side, default +z), 'pyramidal'; `pitch` in degrees,
   *  `overhang` in metres past its walls, the `ridge` along its long side (default) or 'short', 'x', 'z'; `rise`: the
   *  top's height over the eaves in place of the pitch's; `ends`: the gable ends' finish (default the roof's); the
   *  soffit under the eaves is drawn whole only (detail 0) */
  roof(kind: RoofForm, o: Finish & { pitch?: number; overhang?: number; ridge?: RoofFaceOptions['ridge']; rise?: number; gablet?: number; high?: RoofFaceOptions['high']; ends?: Finish } = {}): this {
    const ov = o.overhang ?? 0.4, w = this.size[0] + 2 * ov, d = this.size[2] + 2 * ov;
    const r = roofFaces(kind, w, d, { pitch: o.pitch, ridge: o.ridge, rise: o.rise, gablet: o.gablet, high: o.high, endInset: ov });
    this.b.within(frameOf(this.x, this.y, this.z, this.at(0.5, 1, 0.5)), () => {
      this.b.mesh(r.slopes, o);
      if (r.ends.length) this.b.mesh(r.ends, { ...o, ...o.ends });
      this.b.mesh(r.under, { ...o, detail: 0 });
    });
    return this;
  }
  /** a scope standing out of a face (a bay, a porch): depth metres out, its own box */
  extrude(depth: number): Scope { return new Scope(this.b, this.o, this.x, this.y, this.z, [this.size[0], this.size[1], depth]); }
  /** a smaller scope inside a face or box: metres in from each side */
  inset(left: number, bottom: number, right = left, top = bottom): Scope {
    return new Scope(this.b, add(add(this.o, this.x, left), this.y, bottom), this.x, this.y, this.z, [Math.max(0, this.size[0] - left - right), Math.max(0, this.size[1] - bottom - top), this.size[2]]);
  }
}
/** a footprint's walls as face scopes (each edge, outward) */
function footprintWalls(s: Scope): Scope[] {
  const ring = s.footprint, h = s.size[1], out: Scope[] = [];
  let area = 0; for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) area += ring[j]![0] * ring[i]![1] - ring[i]![0] * ring[j]![1];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.05) continue;
    const X: V3 = [(b[0] - a[0]) / len, 0, (b[1] - a[1]) / len];
    // outward: to the right of the edge seen from above for one winding, the left for the other
    const Z: V3 = area > 0 ? [-X[2], 0, X[0]] : [X[2], 0, -X[0]];
    out.push(new Scope(s.b, [a[0], s.o[1], a[1]], X, [0, 1, 0], Z, [len, h, 0]));
  }
  return out;
}
/** a split grammar: rules by name, each given a scope to split, take faces of, fill, or hand to another rule
 *  (`go(name, scope)`); the first is applied to the lot (a footprint, or a box) */
export interface GrammarSpec<D extends Record<string, ParamSpec>, X> {
  id?: string; params?: D; start?: string;
  rules: Record<string, (s: Scope, p: ParamsOf<D> & X, go: (rule: string, s: Scope) => void, rand: () => number) => void>;
  /** the lot: a footprint (with a height) or a box, from what it is built on */
  lot: (p: ParamsOf<D> & X) => { footprint: readonly V2[]; height: number } | { size: V3; at?: V3; turn?: number };
  far?: ShapeSpec<D, X>['far']; budget?: ShapeSpec<D, X>['budget'];
}
export function grammar<D extends Record<string, ParamSpec> = Record<string, never>, X = object>(g: GrammarSpec<D, X>): Shape<D, X> {
  const start = g.start ?? Object.keys(g.rules)[0]!;
  return new Shape<D, X>({
    id: g.id, params: g.params, far: g.far, budget: g.budget,
    build: (b, p, rand) => {
      let depth = 0;
      const go = (rule: string, s: Scope) => {
        const r = g.rules[rule]; if (!r) throw new AslnutError('E-DATA-001', `the grammar has no rule '${rule}' (it has ${Object.keys(g.rules).join(', ')})`, { fix: `rules: { ${rule}: (s, p, go) => … }` });
        if (++depth > 2000) throw new AslnutError('E-DATA-001', `the grammar went ${depth} rules deep (a rule that calls itself without end?)`, { fix: 'split scopes smaller each time, or stop at a size' });
        r(s, p, go, rand); depth--;
      };
      go(start, b.scope(g.lot(p)));
    },
  });
}
