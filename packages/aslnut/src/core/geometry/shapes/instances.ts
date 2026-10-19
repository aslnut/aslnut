// core › geometry › shapes › instances: a shape placed for every feature of your data. Each feature's params (your
// function of it) pick the shape built for it (a few distinct builds, cached; every copy of one build is an instance:
// one draw for all of them); its place, heading and size; a seeded variation in colour and size so a hundred bins are
// not one bin a hundred times. Streamed in 500 m chunks of a solids layer, levels by distance down to an impostor.
// A clone is its record only (a texture's texels: its place, scale and stretch, turn, colour, its groups' colours, its
// seed, its joints' rates): no geometry of its own, nothing per frame on the main thread. Its parts move by their joints
// (core › entities › kinematics) from the drivers you give: a rate, each clone's own, or your formula of the clock.
//   w.add(entities({ id: 'bins', shape: bin, data: binsSource, params: (d) => ({ lid: d.props.kind === 'recycling' ? '#e8c22c' : '#c43c2c' }), heading: (d) => d.props.facing }))
//   w.add(entities({ id: 'farm', shape: turbine, data: sites, joints: { rotor: (d) => ({ rate: d.props.rpm, unit: 'rpm' }) } }))
//   farm.joint('wt-12', 'rotor', { rate: 0 })     one write: it stops
//   w.add(entities({ id: 'homes', shape: await shapes.import(url, { kind: 'house' }), data }))   (a made shape: a model)
import { AslnutError } from '../../world/errors.ts';
import type { AttachContext } from '../../world/element.ts';
import { Source } from '../../data/sources/source.ts';
import type { Feature } from '../../data/features.ts';
import { D } from '../../space/geo.ts';
import { packNormal, rgbOf, SHAPE_FLOATS, unpackNormal, vary } from './mesh.ts';
import { EMIT_CODE } from '../../render/look/materials.ts';
import { RECORD, RECORD_FLOATS, Solids, type SetJoint, type SolidsProps } from './solids.ts';
import type { Made, Shape } from './shape.ts';
import type { SizeRange } from '../../render/drawing/size.ts';

export interface EntitiesProps<P = Record<string, unknown>> extends Omit<SolidsProps, 'params'> {
  /** a shape (built for each feature's params), or a made one placed as it is (a model from shapes.import) */
  shape: Shape<never, never> | Made | { make(p?: Partial<P>, seed?: number): { levels: readonly unknown[]; bounds: unknown }; id: string };
  /** features (points: one each; lines and areas: at their middle), or rows with a place */
  data: Source | Feature[];
  /** its place [lon, lat] or [lon, lat, metres up] (default: the feature's point) */
  at?: (d: Feature) => [number, number] | [number, number, number];
  /** its params (beyond the shape's defaults) */
  params?: (d: Feature) => Partial<P>;
  /** degrees from north, clockwise (default 0) */
  heading?: (d: Feature) => number;
  /** its size (default 1) */
  scale?: (d: Feature) => number;
  /** its colour: the shape's tinted pieces take it (`tint: true` in their finish: a fleet's paint, one build for
   *  all), or the whole shape when it has none (default white: as built) */
  tint?: (d: Feature) => string | number;
  /** each copy kept within a range of CSS px across (core › render › drawing › size; default the shape's own `size`):
   *  a symbol that stays readable far away and never fills the screen near */
  size?: SizeRange;
  /** a stretch along its height (1: as built; a taller tower, a longer bus), each clone's */
  stretch?: (d: Feature) => number;
  /** its groups' colours, each clone's (a shape's `b.group(name, …)`: the first four it names; a group's pieces take it
   *  as tinted pieces take `tint`; undefined: its own colour) */
  tints?: Record<string, (d: Feature) => string | number | undefined>;
  /** its parts' drivers (core › entities › kinematics), by part name (or a joint's kind: `wheel`, every wheel):
   *  nothing moves unless given. A rate (`unit` 'rpm', 'deg/s', 'rad/s' or a slider's 'm/s'; a phase in degrees,
   *  default each clone's by its seed), the same for every clone or each one's own (your function of it: then
   *  `joint(id, name, driver)` changes one clone in one write), or your formula (statements in the WGSL subset setting
   *  `value`, degrees or a slider's metres, of `time` s and `seed`) */
  joints?: Record<string, JointDriver | ((d: Feature) => JointDriver)>;
  /** shapes attached at its anchors (core › entities › placement › attach): each at every anchor of that name or kind
   *  ('stack': each of a plant's stacks), standing and turning with it, in its levels and its range on screen (smoke at a
   *  stack's top, a charger at a house's service point); its own params, and nothing per frame */
  attach?: { shape: { make(p?: Record<string, unknown>, seed?: number): Made }; at: string; params?: Record<string, unknown> }[];
  /** a seeded variation: `seed` (default the feature's id), how much the colour varies (0..1) and the size (a share) */
  variation?: { seed?: (d: Feature) => number | string; color?: number; scale?: number; /** distinct builds of each params (the shape's seed) */ builds?: number };
}
/** a joint's driver: a rate (in its unit; a phase in degrees), your formula, or a value of the log that moves a set (its
 *  samples: a wheel rolls by its metres, 'travel' the log keeps: history.log({ travel: true }); a hinge turns by its
 *  degrees, a slider by its metres; each × `per`) */
export type JointDriver = { rate: number; unit?: 'rpm' | 'deg/s' | 'rad/s' | 'm/s'; phase?: number } | { formula: string } | { value: string; per?: number } | null;
const UNIT = { rpm: (2 * Math.PI) / 60, 'deg/s': Math.PI / 180, 'rad/s': 1, 'm/s': 1 } as const;
/** a rate in radians (a slider's metres) a second */
export const rateOf = (d: { rate: number; unit?: keyof typeof UNIT }, slider: boolean) => d.rate * (slider ? 1 : UNIT[d.unit ?? 'deg/s']);
/** chunks of 500 m (each instance takes its level by its own size on screen: core › geometry › shapes › solids) */
const CHUNK = 500, KZ = 110574;
const hash = (v: unknown) => { let h = 2166136261; for (const c of String(v)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
/** a made shape (a model from a file, a preset made with its params) as a shape that makes it whatever its params */
const asShape = <P>(p: EntitiesProps<P>): EntitiesProps<P> => {
  const s = p.shape as Partial<Made> & { make?: unknown };
  return s && typeof s.make !== 'function' && Array.isArray(s.levels) ? { ...p, shape: { id: s.kind ?? 'model', make: () => s as Made } } : p;
};

export class Entities<P = Record<string, unknown>> extends Solids {
  private ep: EntitiesProps<P>; private src: Source | null = null; private seen = -1; private off: (() => void) | null = null;
  constructor(p0: EntitiesProps<P>) {
    const p = asShape(p0);
    // (its `params` are the shape's, a function of each feature: not a layer's uniform params)
    super({ hover: { color: '#ffd166' }, ...p, params: undefined } as SolidsProps);
    // (every chunk its data reaches is held: not a view's round it)
    this.chunksByDefault = 256;
    if (!p.shape || typeof (p.shape as { make?: unknown }).make !== 'function') throw new AslnutError('E-DATA-001', `entities '${p.id}' needs a shape (shape({ params, build }), or a made one: a model from shapes.import)`, { where: p.id, fix: 'entities({ shape: bin, data })' });
    this.ep = p;
  }
  private unwatch: (() => void)[] = [];
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    // one definition: its shape (and what it attaches) changed, every clone built again once
    for (const sh of [this.ep.shape, ...(this.ep.attach ?? []).map((a) => a.shape)]) { const w = (sh as { watch?: (f: () => void) => () => void }).watch; if (w) this.unwatch.push(w.call(sh, () => this.refresh())); }
    const d = this.ep.data;
    if (d instanceof Source) { this.src = d; this.off = d.watch(() => this.build()); void d.start({ loader: ctx.loader, error: (e) => ctx.world.error(e) }).then(() => this.build()); }
    else this.build();
  }
  override detach(): void { this.off?.(); this.off = null; for (const f of this.unwatch) f(); this.unwatch = []; super.detach(); }
  /** build again (your params or data changed) */
  refresh(): this { this.seen = -1; this.sigs.clear(); this.origin = null; this.build(); return this; }
  /** the features as last built, each chunk's clones' features (their indices), a clone by its feature's id */
  private fs: Feature[] = []; private byChunk = new Map<string, Int32Array>(); private where: Map<string, [string, number, number]> | null = null;
  /** each chunk's sets' joints as given (the set's own rate, or each clone's) */
  private jointsOf = new Map<string, SetJoint[][]>();
  /** each chunk as last put (its sets' forms and joints, their records): a build puts only the chunks that changed */
  private sigs = new Map<string, { forms: string; recs: Float32Array[] }>();
  /** the clones' metric frame's origin: the first place it was built with, kept (rows that come and go move no chunk) */
  private origin: [number, number] | null = null; private builtOnce = false;
  private build(): void {
    if (this.src && this.src.version === this.seen) return;
    this.seen = this.src?.version ?? 0;
    const raw = this.src ? this.src.features() : this.ep.data as Feature[];
    const fs = raw.map((f) => ((f as Feature).props ? f : { ...f, props: (f as unknown as { properties?: Record<string, unknown> }).properties ?? {} }) as Feature);
    const v = this.ep.variation ?? {}, builds = Math.max(1, v.builds ?? 1), ep = this.ep;
    this.fs = fs; this.where = null; this.byChunk.clear(); this.jointsOf.clear();
    // (the chunks it had: those it has no clones in now taken away after)
    const gone = new Set(this.keys());
    // each clone: its chunk, its build (params and seed), its place; grouped by chunk then by form (a set each: builds
    // that come out the same, whatever their params or seed, one set: one draw a level)
    const origin = this.origin ?? (() => { for (const f of fs) { const at = ep.at?.(f) ?? centreOf(f); if (at) return [at[0], at[1]] as [number, number]; } return null; })();
    if (!origin) { for (const k of gone) this.drop(k); this.sigs.clear(); return; }
    this.origin = origin;
    const kx = 111320 * Math.cos(origin[1] * D), chunks = new Map<string, Map<string, { made: Made; idx: number[]; at: number[] }>>();
    // (each build once in this pass, whatever the shape's cache keeps: more params × seeds than it holds never build twice)
    const builtNow = new Map<string, Made>();
    fs.forEach((f, fi) => {
      const at = ep.at?.(f) ?? centreOf(f); if (!at) return;
      const p = ep.params?.(f) ?? {}, seed = hash(v.seed ? v.seed(f) : f.id ?? JSON.stringify(at)), build = 1 + (seed % builds), bkey = `${build}|${JSON.stringify(p)}`;
      let made = builtNow.get(bkey); if (!made) builtNow.set(bkey, (made = (ep.shape as { make(p: unknown, s: number): Made }).make(p, build)));
      const x = (at[0] - origin[0]) * kx, z = -(at[1] - origin[1]) * KZ, key = `${Math.floor(x / CHUNK)}_${Math.floor(z / CHUNK)}`, bk = formOf(made);
      let c = chunks.get(key); if (!c) chunks.set(key, (c = new Map()));
      let g = c.get(bk); if (!g) c.set(bk, (g = { made, idx: [], at: [] }));
      g.idx.push(fi); g.at.push(x, z, at[2] ?? 0);
    });
    for (const [key, sets] of chunks) {
      const [ix, iz] = key.split('_').map(Number) as [number, number], feats: number[] = [], joints: SetJoint[][] = [];
      const instances = [...sets.values()].map((g) => {
        const made = g.made, groups = (made.pieces?.groups ?? []).slice(0, 4), gt = ep.tints ? groups.map((n) => ep.tints![n]) : [], tinted = gt.some(Boolean);
        // its joints: the shape's parts that can move and have a driver here (a function: each clone's own rate)
        const js: SetJoint[] = [], own: { k: number; fn: (d: Feature) => JointDriver }[] = [];
        (made.pieces?.parts ?? []).forEach((pt, i) => {
          // (by its part's name, else by its joint's kind: `wheel` drives every wheel)
          const d = pt.joint ? ep.joints?.[pt.name] ?? ep.joints?.[pt.joint.kind] : undefined; if (!pt.joint || d === undefined || d === null) return;
          const sl = pt.joint.kind === 'slider', lim = pt.joint.limits ? (sl ? pt.joint.limits : [pt.joint.limits[0] * Math.PI / 180, pt.joint.limits[1] * Math.PI / 180]) as [number, number] : undefined;
          const j: SetJoint = { name: pt.name, part: i + 1, kind: pt.joint.kind, pivot: pt.pivot, axis: pt.joint.axis, radius: pt.joint.radius, limits: lim };
          if (typeof d === 'function') { own.push({ k: js.length, fn: d }); j.own = 0; }
          else if ('value' in d) throw new AslnutError('E-DATA-001', `entities '${this.id}': joint '${pt.name}' reads a log's value ('${d.value}'): still clones have no log`, { where: this.id, fix: 'a rate or a formula; or a set moved by a log (drive: drive.data(log))' });
          else if ('formula' in d) j.formula = d.formula;
          else j.rate = rateOf(d, sl);
          js.push(j);
        });
        const T0 = RECORD + (tinted ? 1 : 0), R = T0 + Math.ceil(own.length / 2), n = g.idx.length, rec = new Float32Array(n * R * RECORD_FLOATS);
        own.forEach((o, q) => { js[o.k]!.own = T0 * RECORD_FLOATS + q * 2; });
        for (let i = 0; i < n; i++) {
          const f = fs[g.idx[i]!]!, sd = hash(v.seed ? v.seed(f) : f.id ?? i), r = ((sd >>> 8) % 1000) / 1000, r2 = ((sd >>> 18) % 1000) / 1000, o = i * R * RECORD_FLOATS;
          const sc = (ep.scale?.(f) ?? 1) * (1 + (r2 * 2 - 1) * (v.scale ?? 0)), st = ep.stretch?.(f) ?? 1, tint = v.color ? vary(ep.tint?.(f) ?? '#ffffff', r, v.color) : rgbOf(ep.tint?.(f) ?? '#ffffff');
          // its id in the chunk: its place in the chunk's features (picking answers with it)
          const id = feats.length; feats.push(g.idx[i]!);
          rec.set([g.at[i * 3]! - ix * CHUNK, g.at[i * 3 + 1]! - iz * CHUNK, g.at[i * 3 + 2]!, id, sc, sc * st, sc, (((ep.heading?.(f) ?? 0) + 180) * Math.PI) / 180, tint, 0, ((sd >>> 4) % 10007) / 10007, 0], o);
          if (tinted) for (let k = 0; k < 4; k++) { const c = gt[k]?.(f); rec[o + RECORD * RECORD_FLOATS + k] = c === undefined ? -1 : rgbOf(c); }
          own.forEach((q, k) => { const d = q.fn(f), j = js[q.k]!, sl = j.kind === 'slider', a = o + j.own!; if (d && 'rate' in d) { rec[a] = rateOf(d, sl); rec[a + 1] = d.phase !== undefined ? (sl ? d.phase : d.phase * Math.PI / 180) : rec[o + 10]! * 2 * Math.PI; } void k; });
        }
        joints.push(js);
        const set = { shape: made.levels as never, records: rec, stride: R, radius: radiusOf(made.bounds as [number[], number[]]), size: ep.size ?? made.size, groups: tinted, joints: js, emitters: made.pieces?.emitters };
        // what is attached at its anchors: the same records (its clones' places, turns, ranges on screen), its shape's
        // levels moved to the anchor (made once a shape, anchor and place)
        const attached = (ep.attach ?? []).flatMap((a) => made.anchors.filter((an) => an.name === a.at || an.kind === a.at).map((an) => {
          const m = a.shape.make(a.params ?? {}, 1), key = `${an.at.join(',')}|${an.heading ?? 0}`;
          let byKey = MOVED.get(m); if (!byKey) MOVED.set(m, (byKey = new Map()));
          let lv = byKey.get(key); if (!lv) byKey.set(key, (lv = m.levels.map((l) => (l instanceof Float32Array ? movedTo(l, an.at, an.heading ?? 0) : l))));
          joints.push([]);
          return { shape: lv as never, records: rec, stride: R, radius: set.radius, size: set.size, emitters: m.pieces?.emitters.map((e) => ({ ...e, at: turnedOff(e.at, an.at, an.heading ?? 0) })) };
        }));
        return [set, ...attached];
      }).flat();
      this.byChunk.set(key, Int32Array.from(feats)); this.jointsOf.set(key, joints); gone.delete(key);
      // (the same forms, joints and records as last put: nothing to put; a chunk put again keeps its look, a new one
      // after the first build is shown at once: rows that come and go never dissolve in)
      const sig = { forms: [...sets.keys()].join('|') + JSON.stringify(joints), recs: instances.map((x) => x.records) }, was = this.sigs.get(key);
      if (was && was.forms === sig.forms && was.recs.length === sig.recs.length && was.recs.every((r, k) => sameFloats(r, sig.recs[k]!))) continue;
      this.sigs.set(key, sig);
      this.put(key, { origin, side: CHUNK, at: [ix * CHUNK, iz * CHUNK], instances, ...(this.builtOnce ? { fade: false } : {}), info: (id) => { const fi = this.byChunk.get(key)?.[id]; const f = fi === undefined ? undefined : this.fs[fi]; return f ? { kind: (ep.shape as { id: string }).id, id: f.id ?? `${key}:${id}`, props: f.props as Record<string, unknown> } : null; } });
    }
    for (const k of gone) { this.drop(k); this.sigs.delete(k); }
    this.builtOnce = true;
  }
  /** one clone's joint driven anew (its set gives each clone its own rate: `joints: { name: (d) => … }`): one write, its
   *  value kept where it is now; a driver for every clone: `joint(name, driver)` */
  joint(id: string | number, name: string, d: JointDriver): this;
  joint(name: string, d: JointDriver): this;
  joint(a: string | number, b: string | JointDriver, c?: JointDriver): this {
    const one = c !== undefined || (typeof b === 'string'), name = one ? (b as string) : (a as string), d = (one ? c : b) as JointDriver;
    for (const [key, sets] of this.jointsOf) sets.forEach((js, si) => {
      const made = this.recordsOf(key, si); if (!made) return;
      // (by its part's name or its joint's kind)
      js.forEach((j, k) => {
        if (j.name !== name && j.kind !== name) return;
        const sl = j.kind === 'slider', rate = d && 'rate' in d ? rateOf(d, sl) : 0;
        if (!one) { if (j.own === undefined) this.setJointRate(key, si, k, rate); else for (let i = 0; i < made.n; i++) this.clone(key, si, i, j, rate); return; }
        if (j.own === undefined) throw new AslnutError('E-DATA-001', `entities '${this.id}': joint '${name}' has one driver for every clone`, { where: this.id, fix: `give each clone its own: joints: { ${name}: (d) => ({ rate: … }) }; or every clone at once: joint('${name}', { rate })` });
        const at = this.whereOf(String(a)); if (!at || at[0] !== key || at[1] !== si) return;
        this.clone(key, si, at[2], j, rate);
      });
    });
    return this;
  }
  /** a clone's own rate written (its texel: the joint's value kept where it is now) */
  private clone(key: string, si: number, i: number, j: SetJoint, rate: number): void {
    const r = this.recordsOf(key, si)!, o = i * r.stride * RECORD_FLOATS + j.own!, t0 = this.setClock(key, si), now = this.clockS();
    const old = r.rec[o]!, phase = r.rec[o + 1]! + (old - rate) * (now - t0), texel = Math.floor(j.own! / RECORD_FLOATS), q = r.rec.slice(i * r.stride * RECORD_FLOATS + texel * RECORD_FLOATS, i * r.stride * RECORD_FLOATS + texel * RECORD_FLOATS + RECORD_FLOATS);
    q[j.own! % RECORD_FLOATS] = rate; q[(j.own! % RECORD_FLOATS) + 1] = phase;
    this.writeRecord(key, si, i, texel, Array.from(q));
  }
  /** where a clone is: its chunk, its set, its record (found once, then kept) */
  private whereOf(id: string): [string, number, number] | undefined {
    if (!this.where) {
      this.where = new Map();
      for (const [key, feats] of this.byChunk) {
        // (a record's id is its feature's place among the chunk's: what is attached shares it, the first set keeps it)
        for (let si = 0; ; si++) { const r = this.recordsOf(key, si); if (!r) break; for (let i = 0; i < r.n; i++) { const f = this.fs[feats[r.rec[i * r.stride * RECORD_FLOATS + 3]!]!]; if (f && !this.where.has(String(f.id))) this.where.set(String(f.id), [key, si, i]); } }
      }
    }
    return this.where.get(id);
  }
}
/** two records' arrays alike (a chunk's clones as last put) */
const sameFloats = (a: Float32Array, b: Float32Array): boolean => { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && !(a[i] !== a[i] && b[i] !== b[i])) return false; return true; };
/** a build's form: its levels (the same arrays: a shape's builds that come out the same share them), its parts' pivots
 *  and joints, its anchors, emitters and range on screen; builds of one form are one set */
const FORMS = new WeakMap<Made, string>(), LEVEL_IDS = new WeakMap<object, number>();
let levelIds = 0;
function formOf(m: Made): string {
  let k = FORMS.get(m); if (k !== undefined) return k;
  const ids = m.levels.map((l) => { if (!l) return 0; let i = LEVEL_IDS.get(l); if (i === undefined) LEVEL_IDS.set(l, (i = ++levelIds)); return i; });
  k = `${ids.join(',')}|${JSON.stringify(m.pieces?.parts ?? [])}|${JSON.stringify(m.anchors)}|${JSON.stringify(m.size ?? null)}|${m.pieces?.groups.join(',') ?? ''}|${JSON.stringify(m.pieces?.emitters ?? [])}`;
  FORMS.set(m, k); return k;
}
/** a shape's levels moved to an anchor (made once a shape and anchor) */
const MOVED = new WeakMap<Made, Map<string, readonly unknown[]>>();
/** a point turned by `heading` degrees round the vertical, then moved to `at` */
const turnedOff = (p: readonly number[], at: readonly number[], heading: number): [number, number, number] => { const a = heading * Math.PI / 180, c = Math.cos(a), s = Math.sin(a); return [p[0]! * c - p[2]! * s + at[0]!, p[1]! + at[1]!, p[0]! * s + p[2]! * c + at[2]!]; };
/** a shape level's vertices turned and moved to an anchor (normals turned; a copy over time's number kept) */
function movedTo(l: Float32Array, at: readonly number[], heading: number): Float32Array {
  const out = Float32Array.from(l), a = heading * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  for (let i = 0; i + SHAPE_FLOATS <= out.length; i += SHAPE_FLOATS) {
    const [x, y, z] = turnedOff([out[i]!, out[i + 1]!, out[i + 2]!], at, heading); out[i] = x; out[i + 1] = y; out[i + 2] = z;
    if (out[i + 5]! < 65536 && out[i + 5]! % 256 === EMIT_CODE) continue;
    const n = unpackNormal(out[i + 3]!); out[i + 3] = packNormal(n[0] * c - n[2] * s, n[1], n[0] * s + n[2] * c);
  }
  return out;
}
const radiusOf = (b: [number[], number[]]) => Math.max(0.05, Math.hypot(b[1][0]! - b[0][0]!, b[1][1]! - b[0][1]!, b[1][2]! - b[0][2]!) / 2);
function centreOf(f: Feature): [number, number] | null {
  const g = f.geometry as { type: string; coordinates: unknown } | null; if (!g) return null;
  if (g.type === 'Point') return g.coordinates as [number, number];
  const pts: [number, number][] = [], walk = (c: unknown): void => { if (Array.isArray(c) && typeof c[0] === 'number') pts.push(c as [number, number]); else if (Array.isArray(c)) c.forEach(walk); };
  walk(g.coordinates); if (!pts.length) return null;
  let x = 0, y = 0; for (const [a, b] of pts) { x += a; y += b; } return [x / pts.length, y / pts.length];
}
/** a shape for every feature: entities({ shape, data, params }) */
export const entities = <P = Record<string, unknown>>(p: EntitiesProps<P>) => new Entities<P>(p);
