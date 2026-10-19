// core › entities › identity › kind: what a thing is, as the traits every shape of it carries. A kind names its traits:
// anchors of a kind (where one enters, parks, plugs in), parts (wheels, doors), measures of the shape (its footprint,
// its front, its roof), params (its levels) and data (who lives there), each with where it must be (on the ground, at
// the front, outside the footprint, at a wall, up). Any design of a kind carries the same traits: a shape says its kind
// (shape({ kind })), a model from a file is given it (shapes.import(url, { kind, anchors })). check({ kind }) reports
// a trait missing or misplaced; traits(made, kind) reads them. What uses a house (cars parking, people entering, the
// sun on its roof) reads only its traits, so a neutral preset, an app's own design and a downloaded model serve alike.
// The kinds here: house, office, charger (a charging station or a wall charger) and vehicle; an app defines its own the
// same way (kind({ name, traits })).
//   const shed = kind({ name: 'shed', traits: { door: { anchors: 'entry', where: ['ground', 'front'] } } })
//   kinds.house.check(made).problems · traits(made, kinds.house).parking → anchors · shape.check({ kind: 'house' })
import { AslnutError } from '../world/errors.ts';
import { SHAPE_FLOATS } from '../geometry/shapes/mesh.ts';
import type { Anchor, Part, V3 } from '../geometry/shapes/parts.ts';

/** where a trait's anchors must be, in the shape's frame (its front +z, its foot at 0): on the ground (at its foot),
 *  at the front (the front half, facing the shape when it has a heading), outside or inside its footprint (the box of
 *  its group named 'walls', else of what stands up from the ground), at a wall (within .6 m of the footprint's edge),
 *  up (over the ground) */
export type Where = 'ground' | 'front' | 'outside' | 'inside' | 'wall' | 'up';
/** what a thing's shape measures: its footprint (the box of its 'walls' group, else of what stands up), its front (+z),
 *  its roof (a group named
 *  'roof', else what faces up at its top: surface, tilt) */
export type Measure = 'footprint' | 'front' | 'roof';
export interface TraitSpec {
  /** what it is, in words */
  about?: string;
  /** anchors of this kind ('entry', 'parking', 'service', 'seat', 'light') */
  anchors?: string;
  /** parts whose names start with this ('wheel', 'door') */
  parts?: string;
  /** a measure of the shape */
  measure?: Measure;
  /** a param of the shape's (its levels); with `guess`, read from the shape where it has none (a model's) */
  param?: string;
  guess?: (m: MadeLike) => unknown;
  /** a field of each thing's data (occupants): checked on data (kind.checkData), its default `def` */
  data?: string;
  def?: unknown;
  /** how many (anchors, parts; default at least 1) */
  min?: number; max?: number;
  /** as many as another trait has (a light per bay) */
  per?: string;
  where?: Where | readonly Where[];
  /** a trait a shape may leave out (checked only where it has it) */
  optional?: boolean;
}
/** what the traits are read from: a made shape (its anchors, parts, groups, bounds, params) */
export interface MadeLike {
  levels: readonly unknown[]; anchors: readonly Anchor[]; parts: readonly Part[]; bounds: [V3, V3];
  groups?: readonly { name: string; first: number; count: number }[];
  params?: Record<string, unknown>;
  kind?: string;
}
export interface KindSpec { name: string; about?: string; traits: Record<string, TraitSpec>; /** another kind's traits, then these over them */ extends?: EntityKind }
/** a footprint (m, the shape's frame): the box of its group named 'walls' when it has one, else of what stands up from
 *  the ground; `from` says which */
export interface Footprint { width: number; depth: number; min: [number, number]; max: [number, number]; from?: 'walls' | 'standing' | 'bounds' }
/** a roof as measured: its surface (m², the sun's to catch), its mean tilt (degrees), its top (m) */
export interface RoofMeasure { surface: number; tilt: number; top: number; kind?: string }
export interface KindCheck { ok: boolean; problems: string[] }

const registry = new Map<string, EntityKind>();
const D = 180 / Math.PI;
const wheres = (w: TraitSpec['where']): readonly Where[] => (!w ? [] : typeof w === 'string' ? [w] : w);

/** the anchor kinds a kind places by its traits (their places its rules') */
export const anchorKindsOf = (k: EntityKind): Set<string> => new Set(Object.values(k.traits).map((t) => t.anchors).filter((x): x is string => !!x));
export class EntityKind {
  readonly name: string; readonly about: string; readonly traits: Readonly<Record<string, TraitSpec>>;
  /** (a kind of yours is found by its name once made: kind() keeps it; the kinds here are found without that) */
  constructor(s: KindSpec, keep = true) {
    if (!s?.name || typeof s.name !== 'string') throw new AslnutError('E-DATA-001', 'a kind needs a name', { fix: "kind({ name: 'shed', traits: { door: { anchors: 'entry' } } })" });
    this.name = s.name; this.about = s.about ?? '';
    this.traits = { ...(s.extends?.traits ?? {}), ...s.traits };
    for (const [n, t] of Object.entries(this.traits)) {
      const what = [t.anchors, t.parts, t.measure, t.param, t.data].filter((x) => x !== undefined).length;
      if (!what) throw new AslnutError('E-DATA-001', `kind '${s.name}': trait '${n}' says nothing it is (anchors, parts, measure, param or data)`, { where: s.name, fix: `${n}: { anchors: 'entry' }` });
      if (t.per && !this.traits[t.per]) throw new AslnutError('E-DATA-001', `kind '${s.name}': trait '${n}' is per '${t.per}', which it does not have`, { where: s.name, fix: `traits: { ${t.per}: { … } }` });
    }
    if (keep) registry.set(this.name, this);
  }
  /** a made shape (a preset's, an app's, a model's) checked against the traits: what is missing or misplaced */
  check(m: MadeLike): KindCheck {
    const problems: string[] = [], fp = footprintOf(m), counts = new Map<string, number>();
    const say = (n: string, t: TraitSpec, what: string) => problems.push(`${this.name} › ${n}${t.about ? ` (${t.about})` : ''}: ${what}`);
    for (const [n, t] of Object.entries(this.traits)) {
      if (t.data !== undefined && t.anchors === undefined && t.parts === undefined && t.measure === undefined && t.param === undefined) continue;
      if (t.anchors !== undefined) {
        const list = m.anchors.filter((a) => a.kind === t.anchors); counts.set(n, list.length);
        if (!checkCount(list.length, t)) { if (!(t.optional && !list.length)) say(n, t, countWords(list.length, t, `'${t.anchors}' anchor`)); }
        for (const a of list) for (const w of wheres(t.where)) { const why = misplaced(a, w, fp); if (why) say(n, t, `anchor '${a.name}' ${why}`); }
      }
      if (t.parts !== undefined) {
        const list = m.parts.filter((p) => p.name.startsWith(t.parts!)); counts.set(n, list.length);
        if (!checkCount(list.length, t) && !(t.optional && !list.length)) say(n, t, countWords(list.length, t, `part named '${t.parts}…'`));
      }
      if (t.measure === 'roof' && !t.optional) { const r = roofMeasure(m); if (!r || r.surface <= 0) say(n, t, 'no roof: nothing faces up at its top (a group named \'roof\', or the faces up there)'); }
      if (t.measure === 'footprint' && (fp.width <= 0 || fp.depth <= 0)) say(n, t, 'nothing stands up from the ground');
      if (t.param !== undefined && !t.optional && m.params && !(t.param in m.params) && !t.guess) say(n, t, `no param '${t.param}'`);
    }
    for (const [n, t] of Object.entries(this.traits)) if (t.per && counts.has(n) && counts.has(t.per) && counts.get(n) !== counts.get(t.per)) say(n, t, `${counts.get(n)}, one per ${t.per} wanted (${counts.get(t.per)})`);
    return { ok: !problems.length, problems };
  }
  /** a thing's data checked: each data trait present (or its default) */
  checkData(props: Record<string, unknown>): KindCheck {
    const problems: string[] = [];
    for (const [n, t] of Object.entries(this.traits)) if (t.data !== undefined && t.def === undefined && props[t.data] === undefined) problems.push(`${this.name} › ${n}: no '${t.data}' in its data`);
    return { ok: !problems.length, problems };
  }
}
const checkCount = (n: number, t: TraitSpec) => n >= (t.min ?? 1) && n <= (t.max ?? Infinity);
const countWords = (n: number, t: TraitSpec, what: string) => `${n} ${what}${n === 1 ? '' : 's'}, ${t.max !== undefined && n > t.max ? `at most ${t.max}` : `at least ${t.min ?? 1}`} wanted`;
/** why an anchor is not where its trait wants it (null: it is) */
function misplaced(a: Anchor, w: Where, fp: Footprint): string | null {
  const [x, y, z] = a.at, tol = 0.05;
  const inBox = x > fp.min[0] + tol && x < fp.max[0] - tol && z > fp.min[1] + tol && z < fp.max[1] - tol;
  // (the ground: the shape's foot, y 0)
  if (w === 'ground') return Math.abs(y) > 0.35 ? `is ${y.toFixed(2)} m up, not on the ground` : null;
  if (w === 'up') return y < 0.3 ? 'is on the ground, not up' : null;
  // (the footprint said with the place it spans: a post or a sign standing out in a car park widens it, unless the
  // shape names its walls)
  const box = `the footprint (${fp.from === 'walls' ? "the box of its 'walls' group" : "the box of all that stands over 0.3 m; a group named 'walls' sets it instead"}: x ${fp.min[0].toFixed(1)} to ${fp.max[0].toFixed(1)}, z ${fp.min[1].toFixed(1)} to ${fp.max[1].toFixed(1)})`;
  if (w === 'outside') return inBox ? `is inside ${box}` : null;
  if (w === 'inside') return inBox ? null : `is outside ${box}`;
  if (w === 'front') {
    if (z < (fp.min[1] + fp.max[1]) / 2) return 'is at the back, not the front (+z)';
    // (an anchor with a heading at the front faces the shape: towards −z, within 60°)
    if (a.heading !== undefined && Math.abs((((a.heading - 180) % 360) + 540) % 360 - 180) > 60) return `faces ${a.heading}°, not the shape (180°)`;
    return null;
  }
  // a wall: within .6 m of the footprint's edge, on either side of it
  const dx = Math.max(fp.min[0] - x, 0, x - fp.max[0]), dz = Math.max(fp.min[1] - z, 0, z - fp.max[1]);
  const out = Math.hypot(dx, dz), inn = inBox ? Math.min(x - fp.min[0], fp.max[0] - x, z - fp.min[1], fp.max[1] - z) : 0;
  return out > 0.6 || inn > 0.6 ? `is ${Math.max(out, inn).toFixed(2)} m from a wall` : null;
}
/** the whole level's vertices (a made shape's first level, when it is triangles) */
const verticesOf = (m: MadeLike): Float32Array | null => (m.levels[0] instanceof Float32Array ? m.levels[0] : null);
/** a shape's footprint: the box of its group named 'walls' (`b.group('walls', …)`: a post, a letterbox or a carport
 *  beside it left out) when it has one; else the box of what stands up (vertices over 0.3 m above its foot, y 0: walls
 *  and roofs, not a slab, a driveway or a car park); else its bounds */
export function footprintOf(m: MadeLike): Footprint {
  const v = verticesOf(m), walls = (m.groups ?? []).filter((g) => g.name === 'walls' && g.count > 0);
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity, from: Footprint['from'] = walls.length ? 'walls' : 'standing';
  const take = (i: number) => { const x = v![i]!, z = v![i + 2]!; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; };
  if (v && walls.length) { for (const g of walls) for (let k = g.first; k < g.first + g.count; k++) take(k * SHAPE_FLOATS); }
  else if (v) for (let i = 0; i < v.length; i += SHAPE_FLOATS) if (v[i + 1]! > 0.3) take(i);
  if (!Number.isFinite(x0)) { x0 = m.bounds[0][0]; z0 = m.bounds[0][2]; x1 = m.bounds[1][0]; z1 = m.bounds[1][2]; from = 'bounds'; }
  return { width: x1 - x0, depth: z1 - z0, min: [x0, z0], max: [x1, z1], from };
}
/** a shape's roof: its groups named 'roof' measured (each face's area, its tilt from level), else the faces over the
 *  middle of its height that face up; null: none */
export function roofMeasure(m: MadeLike): RoofMeasure | null {
  const v = verticesOf(m); if (!v) return null;
  const gs = (m.groups ?? []).filter((x) => x.name === 'roof'), top = m.bounds[1][1], mid = m.bounds[0][1] + (top - m.bounds[0][1]) * 0.5;
  const ranges = gs.length ? gs.map((g) => [g.first, g.first + g.count] as const) : [[0, v.length / SHAPE_FLOATS] as const];
  let surface = 0, tilted = 0;
  for (const [a0, a1] of ranges) for (let k = a0; k + 2 < a1; k += 3) {
    const p = (j: number): V3 => [v[(k + j) * SHAPE_FLOATS]!, v[(k + j) * SHAPE_FLOATS + 1]!, v[(k + j) * SHAPE_FLOATS + 2]!];
    const A = p(0), B = p(1), C = p(2), u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], w = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
    const n = [u[1]! * w[2]! - u[2]! * w[1]!, u[2]! * w[0]! - u[0]! * w[2]!, u[0]! * w[1]! - u[1]! * w[0]!], l = Math.hypot(n[0]!, n[1]!, n[2]!);
    if (l < 1e-12) continue;
    const up = n[1]! / l, area = l / 2;
    // (a group: its faces that look up; else what looks up over the middle height: not the ground's slab)
    if (up < 0.2 || (!gs.length && (A[1] + B[1] + C[1]) / 3 < mid)) continue;
    surface += area; tilted += area * Math.acos(Math.min(1, up)) * D;
  }
  return surface > 0 ? { surface, tilt: tilted / surface, top, ...(m.params?.roof !== undefined ? { kind: String(m.params.roof) } : {}) } : null;
}
/** a thing's traits, read from its made shape (and its data): anchors and parts by trait, the measures, the params */
export type Traits = Record<string, Anchor[] | Part[] | Footprint | RoofMeasure | { heading: number; at: V3 } | unknown>;
export function traits(m: MadeLike, k: EntityKind | string, data: Record<string, unknown> = {}): Traits {
  const kd = kindOf(k), out: Traits = {}, fp = footprintOf(m);
  for (const [n, t] of Object.entries(kd.traits)) {
    if (t.anchors !== undefined) out[n] = m.anchors.filter((a) => a.kind === t.anchors);
    else if (t.parts !== undefined) out[n] = m.parts.filter((p) => p.name.startsWith(t.parts!));
    else if (t.measure === 'footprint') out[n] = fp;
    else if (t.measure === 'front') out[n] = { heading: 0, at: [(fp.min[0] + fp.max[0]) / 2, 0, fp.max[1]] as V3 };
    else if (t.measure === 'roof') out[n] = roofMeasure(m);
    else if (t.param !== undefined) out[n] = m.params?.[t.param] ?? (t.data !== undefined ? data[t.data] : undefined) ?? t.guess?.(m) ?? t.def;
    else if (t.data !== undefined) out[n] = data[t.data] ?? t.def;
  }
  return out;
}
/** a kind by itself or by its name (one of the kinds here, or one made by kind()) */
export function kindOf(k: EntityKind | string): EntityKind {
  if (k instanceof EntityKind) return k;
  const got = (HERE as Record<string, EntityKind | undefined>)[k] ?? registry.get(k);
  if (!got) throw new AslnutError('E-DATA-001', `no kind '${k}' (the kinds: ${[...Object.keys(HERE), ...registry.keys()].join(', ')})`, { fix: `kind({ name: '${k}', traits: { … } }) first, or one of kinds.house, kinds.office, kinds.charger, kinds.vehicle` });
  return got;
}
export const isKind = (k: unknown): k is EntityKind => k instanceof EntityKind;
/** anchors given: a list, or by name ({ 'entry-1': { at, kind, heading } }) */
export type Anchors = readonly Anchor[] | Record<string, Omit<Anchor, 'name'>>;
/** anchors given, as a list (a record's keys their names) */
export const anchorList = (a: Anchors): Anchor[] => (Array.isArray(a) ? (a as readonly Anchor[]).map((x) => ({ ...x, at: [...x.at] as V3 })) : Object.entries(a as Record<string, Omit<Anchor, 'name'>>).map(([name, x]) => ({ name, ...x, at: [...x.at] as V3 })));
/** a made shape as a kind (a model from a file, a shape of another kind's): the same triangles (shared, not copied),
 *  the kind's name, its anchors (a list, by name, or your function of it: an adapter from its bounds; replacing its
 *  own) and the params its kind reads */
export function asKind<M extends MadeLike>(m: M, k: EntityKind | string, o: { anchors?: Anchors | ((m: M) => Anchors); params?: Record<string, unknown> } = {}): M {
  const out = { ...m, kind: kindOf(k).name, ...(o.params ? { params: { ...(m.params ?? {}), ...o.params } } : {}) } as M;
  if (o.anchors) (out as unknown as { anchors: Anchor[] }).anchors = anchorList(typeof o.anchors === 'function' ? o.anchors(out) : o.anchors);
  return out;
}
/** a kind of your own: its name and traits (or another kind's, extended) */
export const kind = (s: KindSpec) => new EntityKind(s);

// ── the kinds here (made at import, kept nowhere: importing registers nothing) ─────────────────────────────────────
const here = (s: KindSpec) => new EntityKind(s, false);
/** levels from a model's height where it has no param (3 m a floor, under a roof) */
const levelsGuess = (m: MadeLike) => Math.max(1, Math.round((m.bounds[1][1] - m.bounds[0][1]) * 0.8 / 3));
const house = here({
  name: 'house', about: 'a home: one household, a few cars',
  traits: {
    footprint: { measure: 'footprint', about: 'the box of its walls' },
    front: { measure: 'front', about: 'the side to its street: +z' },
    levels: { param: 'levels', guess: levelsGuess, about: 'its floors' },
    floor: { param: 'floor', guess: () => 3, about: "a floor's height, m" },
    roof: { measure: 'roof', about: 'its kind, surface and tilt' },
    entries: { anchors: 'entry', where: ['ground', 'front'], about: 'where one walks in, from its front' },
    parking: { anchors: 'parking', where: ['ground', 'outside'], about: 'where a car stands' },
    service: { anchors: 'service', where: 'ground', about: 'a charger or a meter: on a wall or a post' },
    occupants: { data: 'occupants', def: 3, about: 'who lives there' },
  },
});
const office = here({
  name: 'office', about: 'a workplace: many doors, a car park',
  traits: {
    footprint: { measure: 'footprint', about: 'the box of its walls' },
    front: { measure: 'front', about: 'the side to its street: +z' },
    levels: { param: 'levels', guess: levelsGuess, about: 'its floors' },
    floor: { param: 'floor', guess: () => 3.4, about: "a floor's height, m" },
    roof: { measure: 'roof', about: 'its kind, surface and tilt' },
    entries: { anchors: 'entry', min: 2, where: ['ground', 'front'], about: 'its doors, at its front' },
    parking: { anchors: 'parking', min: 4, where: ['ground', 'outside'], about: "its car park's bays" },
    service: { anchors: 'service', where: ['ground'], about: 'chargers at its bays' },
    workers: { data: 'workers', def: 40, about: 'who works there' },
  },
});
const charger = here({
  name: 'charger', about: 'a place to charge electric vehicles: a station or a wall charger',
  traits: {
    bays: { anchors: 'parking', where: 'ground', about: 'where a car stands to charge' },
    ports: { param: 'ports', about: 'its ports' },
    power: { param: 'power', about: 'kW' },
    connector: { param: 'connector', about: 'its plug' },
    lights: { anchors: 'light', per: 'bays', where: 'up', about: "each bay's status light" },
  },
});
const vehicle = here({
  name: 'vehicle', about: 'a road vehicle',
  traits: {
    wheels: { parts: 'wheel', min: 2, about: 'its wheels (they spin, the front ones steer)' },
    doors: { parts: 'door', about: 'its doors (they open)' },
    seats: { anchors: 'seat', about: 'where one sits' },
    entries: { anchors: 'entry', where: ['ground', 'outside'], about: 'where one gets in' },
  },
});
const HERE = { house, office, charger, vehicle };
/** the kinds here: a house, an office, a charger, a vehicle (yours: kind({ name, traits })) */
export const kinds = { house, office, charger, vehicle, of: kindOf };
