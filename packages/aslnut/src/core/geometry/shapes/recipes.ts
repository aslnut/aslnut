// core › geometry › shapes › recipes › branching: trees (and shrubs) grown from a spec. A trunk, then levels of
// branches, each a tapering tube that bends a little, its children spread round it by the golden angle; leaves as
// cards on the last levels (each card a cluster of leaves cut out in the shader: the shadow falls through its gaps).
// Levels of detail come with it: the whole tree, a simple one (the trunk and first branches, fewer bigger cards) and
// a far one (an impostor baked from the whole tree, or a few cards). A seed makes each one its own.
//   const plane = recipes.branching({ trunk: { height: 12, radius: 0.35 }, levels: [{ count: 6, angle: 50, length: 0.55, taper: 0.6 }, { count: 5, angle: 40, length: 0.5, taper: 0.6 }], leaves: { size: 1.1, density: 4 } })
//   solids.put('trees', { instances: [{ shape: plane.levels, data }] })
import { MeshBuilder, rgbOf, shapeOf, type Colorish } from './mesh.ts';
import { AslnutError } from '../../world/errors.ts';
import { Shape, type ParamSpec, type ParamsOf, type ShapeSpec } from './shape.ts';

export interface BranchLevel {
  /** children on each branch of the level above */
  count: number;
  /** degrees from the parent's direction */
  angle: number;
  /** length as a share of the parent's */
  length: number;
  /** radius at its base as a share of the parent's radius where it starts */
  taper: number;
  /** where along the parent the children start (0 foot … 1 tip; default 0.35 for the first level, 0.25 after) */
  start?: number;
  /** how much it bends up (+) or down (−) along its length, degrees (default 10) */
  bend?: number;
}
export interface BranchSpec {
  trunk: { height: number; radius: number; /** degrees off vertical */ lean?: number; /** the share of the height that is bare trunk before the crown (default .35) */ clear?: number };
  levels: BranchLevel[];
  /** unset: no leaves (a bare tree) */
  leaves?: {
    /** 'broad' (round leaves), 'narrow' (long, hanging: eucalypts), 'needle' */
    kind?: 'broad' | 'narrow' | 'needle';
    /** a card's side, m */ size?: number;
    /** cards per metre of the last level's branches */ density?: number;
    colors?: string[];
  };
  bark?: string;
  /** the crown's outline: branches longer in the middle ('round'), at the foot ('conical'), all short ('columnar') */
  crown?: 'round' | 'conical' | 'columnar' | 'vase';
  method?: 'recursive' | 'colonize';
  seed?: number;
}
/** a tree made: its levels of detail for instances (unit: metres as given), and what it is like */
export interface BranchingShape {
  /** [whole, simple, far]: instance shapes (x, y, z, normal, colour, leaf card) */
  levels: [Float32Array, Float32Array, Float32Array];
  height: number; crownRadius: number; crownBase: number;
  /** the share of the sun that passes through the crown straight down (from its cards and their cut-outs) */
  transmissivity: number;
  /** leaf cards, triangles */
  counts: { cards: number; vertices: number[] };
  spec: BranchSpec;
}

const D = Math.PI / 180, GOLDEN = Math.PI * (3 - Math.sqrt(5));
/** the share of a card a leaf cluster covers (the shader's cut-out, measured once) */
export const LEAF_FILL = { broad: 0.58, narrow: 0.35, needle: 0.14 } as const;
type V3 = [number, number, number];
const add = (a: V3, b: V3, k = 1): V3 => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];
const norm = (a: V3): V3 => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
class Rnd { private s: number; constructor(seed: number) { this.s = (seed * 2654435761) >>> 0 || 1; } next(): number { let x = this.s; x ^= x << 13; x ^= x >>> 17; x ^= x << 5; this.s = x >>> 0; return this.s / 4294967296; } range(a: number, b: number) { return a + (b - a) * this.next(); } }
/** a direction turned `angle` away from `axis`, round it by `spin` */
function spread(axis: V3, angle: number, spin: number): V3 {
  const ref: V3 = Math.abs(axis[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(axis, ref)), v = cross(axis, u), s = Math.sin(angle), c = Math.cos(angle);
  return norm([axis[0] * c + (u[0] * Math.cos(spin) + v[0] * Math.sin(spin)) * s, axis[1] * c + (u[1] * Math.cos(spin) + v[1] * Math.sin(spin)) * s, axis[2] * c + (u[2] * Math.cos(spin) + v[2] * Math.sin(spin)) * s]);
}
interface Branch { pts: V3[]; r0: number; r1: number; level: number; length: number; dir: V3 }

/** a tree from its spec */
export function branching(spec: BranchSpec): BranchingShape {
  if (!(spec?.trunk?.height > 0) || !(spec.trunk.radius > 0) || !Array.isArray(spec.levels)) throw new AslnutError('E-DATA-001', 'recipes.branching needs { trunk: { height, radius }, levels: [...] }', { fix: 'recipes.branching({ trunk: { height: 10, radius: 0.3 }, levels: [{ count: 5, angle: 45, length: 0.5, taper: 0.6 }] })' });
  const rnd = new Rnd(spec.seed ?? 1), H = spec.trunk.height, crown = spec.crown ?? 'round', clear = spec.trunk.clear ?? 0.35;
  const branches: Branch[] = [];
  // a tube along a gently bending path
  const grow = (from: V3, dir: V3, length: number, r0: number, r1: number, level: number, bend: number): Branch => {
    const n = level === 0 ? 6 : level === 1 ? 4 : 2, pts: V3[] = [from]; let d = dir, p = from;
    for (let i = 1; i <= n; i++) { d = norm(add(d, [0, 1, 0], (bend * D) / n)); d = norm(add(d, [rnd.range(-0.06, 0.06), 0, rnd.range(-0.06, 0.06)])); p = add(p, d, length / n); pts.push(p); }
    const b = { pts, r0, r1, level, length, dir }; branches.push(b); return b;
  };
  const lean = (spec.trunk.lean ?? 0) * D, la = rnd.next() * Math.PI * 2;
  if (spec.method === 'colonize') colonize(spec, rnd, branches);
  else {
  const trunk = grow([0, 0, 0], norm([Math.sin(lean) * Math.cos(la), Math.cos(lean), Math.sin(lean) * Math.sin(la)]), H, spec.trunk.radius, spec.trunk.radius * 0.25, 0, 0);
  let parents = [trunk];
  spec.levels.forEach((L, li) => {
    const next: Branch[] = [];
    for (const par of parents) {
      const start = L.start ?? (li === 0 ? clear : 0.25), spin0 = rnd.next() * Math.PI * 2;
      for (let k = 0; k < L.count; k++) {
        const t = start + (1 - start) * ((k + 0.5) / L.count) * (li === 0 ? 0.92 : 1), at = pointAt(par, t);
        // the crown's outline: how long a first-level branch is for where it starts
        const prof = li > 0 ? 1 : crown === 'conical' ? 1.25 - t : crown === 'columnar' ? 0.45 : crown === 'vase' ? 0.6 + 0.6 * t : 0.55 + Math.sin(Math.PI * Math.min(1, (t - start) / (1 - start) * 0.9 + 0.1)) * 0.6;
        const len = par.length * L.length * prof * rnd.range(0.8, 1.15), dir = spread(par.dir, (L.angle + rnd.range(-8, 8)) * D, spin0 + k * GOLDEN * 2 + rnd.range(-0.3, 0.3));
        const rStart = par.r0 + (par.r1 - par.r0) * t;
        next.push(grow(at, dir, len, Math.max(0.01, rStart * L.taper), Math.max(0.006, rStart * L.taper * 0.3), li + 1, L.bend ?? (li === 0 && crown === 'vase' ? 25 : 10)));
      }
    }
    parents = next;
  });
  }
  // the leaves: cards along the last levels' branches, facing out of the crown
  const lv = spec.leaves ?? {}, kind = lv.kind ?? 'broad', size = lv.size ?? Math.max(0.5, H * 0.08), density = lv.density ?? 3;
  const colours = (lv.colors ?? ['#4f7a3a', '#5b8a3f', '#466f35']).map((c) => c);
  const maxLevel = spec.levels.length, leafy = branches.filter((b) => b.level >= Math.max(1, maxLevel - 1));
  let lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (const b of leafy) for (const p of b.pts) { lo = [Math.min(lo[0], p[0]), Math.min(lo[1], p[1]), Math.min(lo[2], p[2])]; hi = [Math.max(hi[0], p[0]), Math.max(hi[1], p[1]), Math.max(hi[2], p[2])]; }
  const centre: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  interface Card { c: V3; n: V3; plane: V3; s: number; rot: number; colour: string }
  const cards: Card[] = [];
  // no leaves asked for, none made (a bare tree: winter, a dead one, a frame for your own crown)
  for (const b of spec.leaves ? leafy : []) {
    const m = Math.max(1, Math.round(b.length * density * (b.level === maxLevel ? 1 : 0.6)));
    for (let k = 0; k < m; k++) {
      const t = 0.3 + 0.7 * ((k + rnd.next()) / m), p = pointAt(b, t), out = norm(add(add(p, centre, -1), [rnd.range(-0.4, 0.4), 0.35, rnd.range(-0.4, 0.4)]));
      // the card faces any way (seen from anywhere, some face you), lit as the crown's surface there (its normal out)
      const plane = norm([rnd.range(-1, 1), rnd.range(-0.4, 1), rnd.range(-1, 1)]);
      cards.push({ c: add(p, out, size * 0.15), n: out, plane, s: size * rnd.range(0.8, 1.2), rot: rnd.next() * Math.PI * 2, colour: colours[Math.floor(rnd.next() * colours.length)]! });
    }
  }
  const bark = spec.bark ?? '#6b5440', kindNo = kind === 'broad' ? 1 : kind === 'narrow' ? 3 : 2;
  const tubes = (mb: MeshBuilder, maxL: number, sides: (l: number) => number) => { for (const b of branches) if (b.level <= maxL) tube(mb, b, sides(b.level), bark); };
  const cardsInto = (mb: MeshBuilder, list: Card[], grow = 1) => { for (const c of list) leafCard(mb, c.c, c.plane, c.n, c.s * grow, c.rot, kindNo, c.colour); };
  const whole = shapeOf((mb) => { tubes(mb, 99, (l) => (l === 0 ? 7 : l === 1 ? 5 : 3)); cardsInto(mb, cards); });
  const simple = shapeOf((mb) => { tubes(mb, 1, (l) => (l === 0 ? 5 : 3)); cardsInto(mb, cards.filter((_, i) => i % 3 === 0), 1.65); });
  const far = shapeOf((mb) => { tubes(mb, 0, () => 3); cardsInto(mb, cards.filter((_, i) => i % 12 === 0), 3.2); });
  // how much sun the crown lets through straight down: the cards' cut-out area over the crown's footprint (Beer–Lambert)
  const crownR = Math.max(0.5, Math.max(hi[0] - lo[0], hi[2] - lo[2]) / 2 + size * 0.5), foot = Math.PI * crownR * crownR;
  let leafArea = 0; for (const c of cards) leafArea += c.s * c.s * LEAF_FILL[kind] * Math.abs(c.plane[1]);
  const transmissivity = Math.exp(-0.9 * (leafArea / foot));
  return { levels: [whole, simple, far], height: Math.max(H, hi[1] + size * 0.5), crownRadius: crownR, crownBase: lo[1], transmissivity, counts: { cards: cards.length, vertices: [whole, simple, far].map((x) => x.length / 6) }, spec };
}
/** space colonisation (Runions et al. 2007): points scattered through the crown's outline pull the branches towards
 *  them; a branch grows a step towards the points near it, a point is taken once a branch reaches it. Thickness by the
 *  pipe model (a branch as thick as its children together); the thinnest are the leafy ones */
function colonize(spec: BranchSpec, rnd: Rnd, out: Branch[]): void {
  const H = spec.trunk.height, crown = spec.crown ?? 'round', clear = (spec.trunk.clear ?? 0.35) * H, levels = Math.max(1, spec.levels.length);
  const R = H * (crown === 'columnar' ? 0.17 : crown === 'conical' ? 0.3 : crown === 'vase' ? 0.42 : 0.38), top = H * 1.2, mid = (clear + top) / 2, half = (top - clear) / 2;
  // the crown's outline: an ellipsoid (narrower at the top for a cone, at the foot for a vase)
  const pts: V3[] = [];
  while (pts.length < 380) {
    const p: V3 = [rnd.range(-1, 1), rnd.range(-1, 1), rnd.range(-1, 1)];
    if (p[0] * p[0] + p[1] * p[1] + p[2] * p[2] > 1) continue;
    const w = crown === 'conical' ? (1 - p[1]) / 2 + 0.15 : crown === 'vase' ? (1 + p[1]) / 2 + 0.25 : 1;
    pts.push([p[0] * R * w, mid + p[1] * half, p[2] * R * w]);
  }
  const step = H * 0.055, reach = R * 1.1, kill = step * 1.6;
  interface Node { p: V3; parent: number; kids: number; r: number }
  const nodes: Node[] = [{ p: [0, 0, 0], parent: -1, kids: 0, r: 0 }];
  for (let y = step; y < clear; y += step) nodes.push({ p: [0, y, 0], parent: nodes.length - 1, kids: 0, r: 0 });
  for (let it = 0; it < 120 && pts.length; it++) {
    const pull = new Map<number, V3>();
    for (const a of pts) {
      let best = -1, bd = reach;
      for (let i = 0; i < nodes.length; i++) { const n = nodes[i]!.p, d = Math.hypot(a[0] - n[0], a[1] - n[1], a[2] - n[2]); if (d < bd) { bd = d; best = i; } }
      if (best < 0) continue;
      const n = nodes[best]!.p, dir = norm([a[0] - n[0], a[1] - n[1], a[2] - n[2]]), v = pull.get(best) ?? [0, 0, 0];
      pull.set(best, [v[0] + dir[0], v[1] + dir[1], v[2] + dir[2]]);
    }
    if (!pull.size) { const t = nodes[nodes.length - 1]!; nodes.push({ p: add(t.p, [0, 1, 0], step), parent: nodes.length - 1, kids: 0, r: 0 }); continue; }
    for (const [i, v] of pull) { const d = norm(add(v, [rnd.range(-0.1, 0.1), 0.05, rnd.range(-0.1, 0.1)])); nodes.push({ p: add(nodes[i]!.p, d, step), parent: i, kids: 0, r: 0 }); }
    for (let k = pts.length - 1; k >= 0; k--) { const a = pts[k]!; if (nodes.some((n) => Math.hypot(a[0] - n.p[0], a[1] - n.p[1], a[2] - n.p[2]) < kill)) pts.splice(k, 1); }
  }
  // thickness: leaves first, each parent as thick as its children (r^2.5 summed)
  for (const n of nodes) if (n.parent >= 0) nodes[n.parent]!.kids++;
  const tip = Math.max(0.008, spec.trunk.radius * 0.06);
  const acc = new Float64Array(nodes.length);
  for (let i = nodes.length - 1; i >= 0; i--) { const n = nodes[i]!; n.r = n.kids === 0 ? tip : Math.pow(acc[i]!, 1 / 2.5); if (n.parent >= 0) acc[n.parent] = acc[n.parent]! + Math.pow(n.r, 2.5); }
  const scale = spec.trunk.radius / Math.max(1e-6, nodes[0]!.r);
  for (const n of nodes) n.r *= scale;
  for (let i = 1; i < nodes.length; i++) {
    const n = nodes[i]!, p = nodes[n.parent]!, rel = n.r / spec.trunk.radius;
    const level = rel > 0.5 ? 0 : Math.min(levels, Math.max(1, Math.round((1 - Math.min(1, rel * 2)) * levels)));
    out.push({ pts: [p.p, n.p], r0: p.r, r1: n.r, level, length: step, dir: norm(add(n.p, p.p, -1)) });
  }
}
function pointAt(b: Branch, t: number): V3 {
  const f = Math.max(0, Math.min(1, t)) * (b.pts.length - 1), i = Math.min(b.pts.length - 2, Math.floor(f)), k = f - i, a = b.pts[i]!, c = b.pts[i + 1]!;
  return [a[0] + (c[0] - a[0]) * k, a[1] + (c[1] - a[1]) * k, a[2] + (c[2] - a[2]) * k];
}
/** a tapering tube along a branch's points */
function tube(mb: MeshBuilder, b: Branch, sides: number, color: Colorish): void {
  const rings: V3[][] = [], n = b.pts.length;
  for (let i = 0; i < n; i++) {
    const p = b.pts[i]!, d = norm(add(b.pts[Math.min(n - 1, i + 1)]!, b.pts[Math.max(0, i - 1)]!, -1)), ref: V3 = Math.abs(d[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(d, ref)), v = cross(d, u), r = b.r0 + (b.r1 - b.r0) * (i / (n - 1)), ring: V3[] = [];
    for (let s = 0; s < sides; s++) { const a = (s / sides) * Math.PI * 2; ring.push([p[0] + (u[0] * Math.cos(a) + v[0] * Math.sin(a)) * r, p[1] + (u[1] * Math.cos(a) + v[1] * Math.sin(a)) * r, p[2] + (u[2] * Math.cos(a) + v[2] * Math.sin(a)) * r]); }
    rings.push(ring);
  }
  for (let i = 0; i + 1 < n; i++) for (let s = 0; s < sides; s++) {
    const a = rings[i]![s]!, b2 = rings[i]![(s + 1) % sides]!, c = rings[i + 1]![(s + 1) % sides]!, d = rings[i + 1]![s]!;
    // smooth: each corner's normal from the ring's centre
    const ca = b.pts[i]!, cb = b.pts[i + 1]!, nrm = (p: V3, o: V3) => norm(add(p, o, -1));
    mb.smoothTri(a, nrm(a, ca), b2, nrm(b2, ca), c, nrm(c, cb), color).smoothTri(a, nrm(a, ca), c, nrm(c, cb), d, nrm(d, cb), color);
  }
}
/** a card of leaves at c in the plane facing `plane`, lit as facing n, its side s, turned by rot; its corners carry the
 *  cut-out's coordinates */
function leafCard(mb: MeshBuilder, c: V3, plane: V3, n: V3, s: number, rot: number, kind: number, color: Colorish): void {
  const ref: V3 = Math.abs(plane[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0], u0 = norm(cross(plane, ref)), v0 = cross(plane, u0);
  const u = norm(add([u0[0] * Math.cos(rot), u0[1] * Math.cos(rot), u0[2] * Math.cos(rot)], v0, Math.sin(rot))), v = cross(plane, u), h = s / 2;
  const at = (a: number, b: number): V3 => [c[0] + (u[0] * a + v[0] * b) * h, c[1] + (u[1] * a + v[1] * b) * h, c[2] + (u[2] * a + v[2] * b) * h];
  mb.card(at(-1, -1), at(1, -1), at(1, 1), at(-1, 1), n, kind, color);
}
export interface ShapePresets<P> { [name: string]: Partial<P> }
/** named sets of a shape's params (a 'king' bed, a 'recycling' bin): the shape with them as its defaults */
export function preset<D extends Record<string, ParamSpec>, X>(s: Shape<D, X>, name: string, p: Partial<ParamsOf<D>>): Shape<D, X> {
  const params = Object.fromEntries(Object.entries(s.spec.params ?? {}).map(([k, v]) => [k, k in p ? { ...v, def: (p as Record<string, unknown>)[k] } : v])) as unknown as D;
  return new Shape<D, X>({ ...s.spec, id: `${s.id}:${name}`, params });
}
/** a kit of pieces put together: each piece a shape, placed (snapped to a grid) and turned; the whole is one shape */
export function kitbash<D extends Record<string, ParamSpec> = Record<string, never>, X = object>(kit: Record<string, Shape<Record<string, ParamSpec>, object>>, layout: readonly { piece: string; at: V3; heading?: number; params?: Record<string, unknown> }[] | ((p: ParamsOf<D> & X) => readonly { piece: string; at: V3; heading?: number; params?: Record<string, unknown> }[]), o: { id?: string; params?: D; grid?: number; budget?: ShapeSpec<D, X>['budget'] } = {}): Shape<D, X> {
  const grid = o.grid ?? 0.5, snap = (v: number) => (grid > 0 ? Math.round(v / grid) * grid : v);
  return new Shape<D, X>({
    id: o.id, params: o.params, budget: o.budget,
    build: (b, p, rand) => {
      for (const it of typeof layout === 'function' ? layout(p) : layout) {
        const piece = kit[it.piece]; if (!piece) throw new AslnutError('E-DATA-001', `the kit has no piece '${it.piece}' (it has ${Object.keys(kit).join(', ')})`, { fix: `kit: { ${it.piece}: shape({ … }) }` });
        b.frame({ at: [snap(it.at[0]), snap(it.at[1]), snap(it.at[2])], turn: it.heading ?? 0 }, (b) => piece.spec.build(b, piece.params(it.params as never), rand));
      }
    },
  });
}
/** recipes: trees by branching, things from a kit of pieces, a shape's named presets (buildings by a grammar: scope.ts) */
export const recipes = { branching, kitbash, preset };
export { rgbOf };
