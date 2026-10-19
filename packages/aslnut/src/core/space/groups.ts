// core › space › regions › rollup: things rolled up into groups, with values over time, shown by level. The members (a
// set's moving things, a layer's features, a source, an array) are put in groups by areas (each in the one its place
// lies in), by square cells of so many metres, or by your key; each group's values are aggregates over its members at
// every time one of them changes or one comes or goes (how many, a sum, a mean, the least, the most of a channel: core ›
// data › history › channels; or yours). Made once per level (one grouping for all its levels, or one a level), in a
// worker (the places and the members' values cross as arrays; where workers cannot run, here), over time when the
// members move. A level's groups are a source (a feature a group: its area, its cell, or its members' middle; its
// values as props) with a log (each group a thing at its place, its values over time): drawn as cards (kits ›
// dashboard › markers) by default, or by your mark. Shown only through the observation gates (core › observation:
// margin, dwell, keep): the groups at their levels, the members at the finer ones; never by the camera.
//   w.add(groups({ id: 'districts', of: 'homes', by: { regions: suburbs }, values: { n: { count: true },
//     kw: { sum: 'kw' }, soc: { mean: 'soc' } }, log: power, show: { levels: ['city', 'district'] } }))
//   groups({ of: fleet, by: { city: { cells: 2000 }, district: { cells: 500 } }, mark: (g) => entities({ drive: drive.data(g.log), … }) })
import { AslnutError } from '../world/errors.ts';
import { Element, type AttachContext, type ElementProps, type ElementStatus, type FrameContext } from '../world/element.ts';
import type { State } from '../world/state.ts';
import type { DrawCall } from '../render/graphics/interface.ts';
import { Source, type SourceContext } from '../data/sources/source.ts';
import { anchorOf, bboxOf, normalize, polygonsOf, type Feature, type Geometry, type Props } from '../data/features.ts';
import { Log } from '../data/history.ts';
import { derive, logsOf, type Channel } from '../data/channels.ts';
import { EntitySet, type Thing } from '../entities/sets.ts';
import { inLevels } from '../observation/levels.ts';
import { shown, type When } from '../observation/presence.ts';
import { D } from './geo.ts';
import { text } from '../encoding/marks/text.ts';

/** how members are put in groups: areas (each in the one its place lies in; its name from `name`, default its props'
 *  `name`), square cells of so many metres, or your key of each member */
export type GroupBy<D> = { regions: Source<any> | readonly Feature[]; name?: (f: Feature) => string } | { cells: number } | ((d: D) => string | number | null | undefined);   // eslint-disable-line @typescript-eslint/no-explicit-any
/** a group's value at each time, over its members then: how many, the sum, the mean, the least, the most of a channel,
 *  or your function of the members' values of a channel */
export type GroupValue<D> = { count: true } | { sum: Channel<D> } | { mean: Channel<D> } | { min: Channel<D> } | { max: Channel<D> } | { of: Channel<D>; fn: (values: number[]) => number };
export interface GroupsProps<D> extends ElementProps {
  /** the members: a set (its moving things: in a group while they are inside it), a layer or an instance set (its
   *  features), a source or an array */
  of: string | Element | Source<any> | readonly D[];   // eslint-disable-line @typescript-eslint/no-explicit-any
  /** one grouping for every level shown, or one a level ({ city: { cells: 2000 }, district: { regions: suburbs } }) */
  by: GroupBy<D> | Record<string, GroupBy<D>>;
  /** each group's values (default { n: { count: true } }) */
  values?: Record<string, GroupValue<D>>;
  /** the log a value named by a string reads (default the set's own) */
  log?: Log;
  /** the levels the groups are shown at (the members are hidden there, shown at the others); none: always both */
  show?: { levels: string[] };
  /** a level's groups drawn: your mark of them (default a card each: its name, each value a row) */
  mark?: (g: GroupsSource, level: string | null) => Element;
}
const isFn = <D>(b: unknown): b is (d: D) => string | number | null | undefined => typeof b === 'function';
const isBy = (b: unknown): boolean => isFn(b) || (!!b && typeof b === 'object' && ('regions' in (b as object) || 'cells' in (b as object)));

// ── the job (a worker's, or here): self-contained, it crosses as its own text ──────────────────────────────────────
/** what the job is given: each member's places over time (a still one: one place), the grouping (areas' rings, cells,
 *  or each member's group already), each aggregate's operation and the members' channel it reads (their samples) */
export interface GroupsJobIn {
  n: number; off: Int32Array; t: Float64Array; x: Float64Array; y: Float64Array;
  by: { kind: 'regions'; groups: number; rings: Float64Array; ringOff: Int32Array; groupRings: Int32Array; hole: Uint8Array; box: Float64Array } | { kind: 'cells'; size: number; lat0: number } | { kind: 'keys'; key: Int32Array; groups: number };
  ops: number[]; chan: number[];
  /** the members' channels (core › data › history › channels): each member's samples (off), their times (ms), a column a channel */
  vOff: Int32Array; vT: Float64Array; v: Float32Array[];
}
export interface GroupsJobOut { groups: number; cells: Int32Array; members: Int32Array; off: Int32Array; t: Float64Array; v: Float32Array[] }
/** each member's group over time, then each group's values at every time one of its members changes, comes or goes
 *  (two samples at one time where one comes or goes: the chip holds each value exactly). ops: 0 count, 1 sum, 2 mean,
 *  3 min, 4 max, 5 the members' values (yours, worked out here after) */
export function groupsJob(I: GroupsJobIn, fns?: (((xs: number[]) => number) | null)[]): GroupsJobOut {
  const by = I.by, K = 111320, KZ = 110574;
  // ── which group a place is in ──
  const cellKeys = new Map<string, number>(), cellXY: number[] = [];
  const inRing = (r: number, px: number, py: number) => { const a = I.by.kind === 'regions' ? I.by.ringOff[r]! : 0, b = I.by.kind === 'regions' ? I.by.ringOff[r + 1]! : 0, R = (I.by as { rings: Float64Array }).rings; let c = false; for (let i = a, j = b - 1; i < b; j = i++) { const xi = R[2 * i]!, yi = R[2 * i + 1]!, xj = R[2 * j]!, yj = R[2 * j + 1]!; if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) c = !c; } return c; };
  const groupOf = (m: number, px: number, py: number): number => {
    if (by.kind === 'keys') return by.key[m]!;
    if (by.kind === 'cells') {
      const kx = K * Math.cos(by.lat0 * Math.PI / 180), ix = Math.floor((px * kx) / by.size), iy = Math.floor((py * KZ) / by.size), k = `${ix}_${iy}`;
      let g = cellKeys.get(k); if (g === undefined) { g = cellKeys.size; cellKeys.set(k, g); cellXY.push(ix, iy); }
      return g;
    }
    for (let g = 0; g < by.groups; g++) {
      if (px < by.box[4 * g]! || px > by.box[4 * g + 2]! || py < by.box[4 * g + 1]! || py > by.box[4 * g + 3]!) continue;
      // inside an outer ring and none of its holes (a group's rings: each outer one, then its holes)
      let inside = false;
      for (let r = by.groupRings[g]!; r < by.groupRings[g + 1]!; r++) { if (by.hole[r]) { if (inside && inRing(r, px, py)) inside = false; } else if (!inside && inRing(r, px, py)) inside = true; }
      if (inside) return g;
    }
    return -1;
  };
  // ── each member's group over time: (from, group) changes ──
  const spans: { m: number; g: number; from: number; until: number }[] = [];
  for (let m = 0; m < I.n; m++) {
    const a = I.off[m]!, b = I.off[m + 1]!;
    let cur = -2, from = -Infinity;
    for (let k = a; k < b; k++) {
      const g = groupOf(m, I.x[k]!, I.y[k]!), t = b - a > 1 ? I.t[k]! : -Infinity;
      if (g !== cur) { if (cur >= 0) spans.push({ m, g: cur, from, until: t }); cur = g; from = t; }
    }
    if (cur >= 0) spans.push({ m, g: cur, from, until: Infinity });
  }
  const G = by.kind === 'cells' ? cellKeys.size : by.groups;
  // ── each group's values over time ──
  const per: { m: number; from: number; until: number }[][] = Array.from({ length: G }, () => []);
  for (const s of spans) per[s.g]!.push(s);
  const members = new Int32Array(G); for (let g = 0; g < G; g++) members[g] = new Set(per[g]!.map((s) => s.m)).size;
  const valueAt = (m: number, c: number, t: number): number => {
    const a = I.vOff[m]!, b = I.vOff[m + 1]!, T = I.vT, V = I.v[c]!; if (b <= a) return 0;
    if (t <= T[a]!) return V[a]!; if (t >= T[b - 1]!) return V[b - 1]!;
    let lo = a, hi = b - 1; while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (T[mid]! <= t) lo = mid; else hi = mid; }
    const ta = T[lo]!, tb = T[hi]!; return tb > ta ? V[lo]! + ((V[hi]! - V[lo]!) * (t - ta)) / (tb - ta) : V[hi]!;
  };
  const OT: number[] = [], OV: number[][] = I.ops.map(() => []), off = new Int32Array(G + 1);
  const agg = (op: number, xs: number[], k: number) => (op === 0 ? xs.length : op === 5 ? Number(fns?.[k]?.(xs)) || 0 : !xs.length ? 0 : op === 1 ? xs.reduce((s, x) => s + x, 0) : op === 2 ? xs.reduce((s, x) => s + x, 0) / xs.length : op === 3 ? Math.min(...xs) : op === 4 ? Math.max(...xs) : 0);
  let tMin = Infinity; for (let k = 0; k < I.t.length; k++) if (I.t[k]! > -Infinity && I.t[k]! < tMin) tMin = I.t[k]!; for (let k = 0; k < I.vT.length; k++) if (I.vT[k]! < tMin) tMin = I.vT[k]!;
  if (!Number.isFinite(tMin)) tMin = 0;
  for (let g = 0; g < G; g++) {
    off[g] = OT.length;
    const sp = per[g]!, times: number[] = [tMin];
    for (const s of sp) { if (Number.isFinite(s.from)) times.push(s.from); if (Number.isFinite(s.until)) times.push(s.until); }
    // (each member's own samples while it is in the group: its values change then)
    if (I.chan.some((c) => c >= 0)) for (const s of sp) for (let k = I.vOff[s.m]!; k < I.vOff[s.m + 1]!; k++) { const t = I.vT[k]!; if (t >= s.from && t < s.until) times.push(t); }
    times.sort((p, q) => p - q);
    let last = NaN;
    const put = (t: number, inside: (s: { from: number; until: number }) => boolean) => {
      OT.push(t);
      I.ops.forEach((op, k) => { const c = I.chan[k]!, xs: number[] = []; for (const s of sp) if (inside(s)) xs.push(c >= 0 ? valueAt(s.m, c, t) : 1); OV[k]!.push(agg(op, xs, k)); });
    };
    for (const t of times) {
      if (t === last) continue; last = t;
      // a member coming or going now: its value before (the members up to now), then after
      if (OT.length > off[g]! && sp.some((s) => s.from === t || s.until === t)) put(t, (s) => s.from < t && s.until >= t);
      put(t, (s) => s.from <= t && s.until > t);
    }
  }
  off[G] = OT.length;
  return { groups: G, cells: Int32Array.from(cellXY), members, off, t: Float64Array.from(OT), v: OV.map((x) => Float32Array.from(x)) };
}
/** the job run in a worker: its own text, nothing imported (the same function runs here where workers cannot) */
let lane: { w: Worker; seq: number; waiting: Map<number, (r: GroupsJobOut | Error) => void> } | null = null, laneBroken = false;
function runJob(input: GroupsJobIn, fns: (((xs: number[]) => number) | null)[]): Promise<GroupsJobOut> {
  // (your own aggregates are functions: they stay here, the job with them)
  if (fns.some(Boolean)) return Promise.resolve(groupsJob(input, fns));
  if (!laneBroken && !lane && typeof Worker !== 'undefined' && typeof Blob !== 'undefined' && typeof URL !== 'undefined') {
    try {
      const src = `const groupsJob = ${groupsJob.toString()};\nself.onmessage = (e) => { const { id, input } = e.data; try { const r = groupsJob(input); self.postMessage({ id, r }, [r.t.buffer, r.off.buffer, r.members.buffer, r.cells.buffer, ...r.v.map((x) => x.buffer)]); } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); } };`;
      const w = new Worker(URL.createObjectURL(new Blob([src], { type: 'text/javascript' })));
      const l = { w, seq: 0, waiting: new Map<number, (r: GroupsJobOut | Error) => void>() };
      w.onmessage = (e: MessageEvent<{ id: number; r?: GroupsJobOut; error?: string }>) => { const f = l.waiting.get(e.data.id); l.waiting.delete(e.data.id); f?.(e.data.r ?? new Error(e.data.error ?? 'the groups worker failed')); };
      w.onerror = (e) => { e.preventDefault?.(); laneBroken = true; for (const f of l.waiting.values()) f(new Error('the groups worker did not start')); l.waiting.clear(); };
      lane = l;
    } catch { laneBroken = true; }
  }
  const l = lane;
  if (!l || laneBroken) return Promise.resolve(groupsJob(input));
  const id = ++l.seq;
  return new Promise<GroupsJobOut>((ok, bad) => { l.waiting.set(id, (r) => (r instanceof Error ? bad(r) : ok(r))); l.w.postMessage({ id, input }); }).catch(() => groupsJob(input));
}

// ── a level's groups: a source of features, and a log of their values over time ─────────────────────────────────
/** a level's groups: a feature each (its area, its cell, or its members' middle; props: id, name, members, its values
 *  at the first time), and `log`: each group a thing at its place, its values over time */
export class GroupsSource extends Source<Props> {
  readonly level: string | null;
  /** each group's values over time (a thing a group, at its place): what cards and sets read on the chip */
  log: Log = new Log({ keep: Infinity });
  private make: (ctx: SourceContext) => Promise<{ features: Feature[]; log: Log }>;
  constructor(id: string, level: string | null, make: (ctx: SourceContext) => Promise<{ features: Feature[]; log: Log }>) { super({ id }); this.level = level; this.make = make; }
  protected async load(ctx: SourceContext): Promise<void> { const r = await this.make(ctx); this.log = r.log; this.replace(r.features); }
  /** make them again (the members or their values changed) */
  async again(ctx: SourceContext): Promise<void> { const r = await this.track(this.make(ctx)); this.log = r.log; this.replace(r.features); }
}

const OPS = { count: 0, sum: 1, mean: 2, min: 3, max: 4 } as const;
export class Groups<D = unknown> extends Element<GroupsProps<D>> {
  readonly kind = 'custom' as const;
  /** each level's groups (one for every level shown when one grouping serves them all) */
  readonly sources: GroupsSource[] = [];
  private marks: Element[] = [];
  private members: Element | null = null; private memberWhen: When | undefined; private wrapped = false;
  private ctx: AttachContext | null = null;
  constructor(p: GroupsProps<D>) {
    super(p);
    const by = p.by, levels = p.show?.levels ?? [];
    if (!by) throw new AslnutError('E-DATA-001', `groups '${this.id}' needs a grouping: by`, { where: this.id, fix: 'by: { regions: suburbs } · { cells: 500 } · d => d.props.district' });
    const perLevel = !isBy(by);
    if (perLevel) for (const k of Object.keys(by)) { if (!levels.includes(k)) throw new AslnutError('E-DATA-001', `groups '${this.id}': a grouping for '${k}', not a level it shows`, { where: this.id, fix: `show: { levels: [${[...levels, k].map((x) => `'${x}'`).join(', ')}] }` }); if (!isBy((by as Record<string, unknown>)[k])) throw new AslnutError('E-DATA-001', `groups '${this.id}': by.${k} is not a grouping`, { where: this.id, fix: '{ regions } · { cells } · a function' }); }
    const list: [string | null, GroupBy<D>][] = perLevel ? Object.entries(by as Record<string, GroupBy<D>>) : [[null, by as GroupBy<D>]];
    for (const [level, b] of list) {
      const src = new GroupsSource(`${this.id}${level ? `-${level}` : ''}`, level, (ctx) => this.build(b, level, ctx));
      this.sources.push(src);
      const mark = p.mark ? p.mark(src, level) : defaultMark(src, p.values ?? { n: { count: true } });
      // shown at its level (or at every level the groups show); with no levels, always
      if (levels.length && mark.props.when === undefined) mark.props.when = { level: level ? level : levels };
      mark.owner = this; this.marks.push(mark);
    }
  }
  override companions(): Element[] { return this.marks; }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx); this.ctx = ctx;
    // the members hidden where the groups are shown (the gates swap them together: a level change, never the camera)
    const levels = this.props.show?.levels;
    const of = this.props.of, w = ctx.world as unknown as { element?: (id: string) => Element };
    this.members = typeof of === 'string' && w.element ? w.element(of) : of instanceof Element ? of : null;
    if (levels?.length && this.members && !this.wrapped) {
      const el = this.members, orig = el.props.when; this.memberWhen = orig; this.wrapped = true;
      el.setProps({ when: (s: State) => { const o = s.observation; if (o && o.level !== null && inLevels(levels, o.levels, o.index, `groups '${this.id}'`)) return 0; return shown(orig, s, `element '${el.id}'`); } });
    }
    for (const s of this.sources) void s.start({ loader: ctx.loader, error: (e) => ctx.world.error(e) });
  }
  override detach(): void { if (this.members && this.wrapped) { this.members.setProps({ when: this.memberWhen }); this.wrapped = false; } this.ctx = null; super.detach(); }
  /** the members, their places over time and their values' channels, as the job takes them */
  private async build(by: GroupBy<D>, level: string | null, ctx: SourceContext): Promise<{ features: Feature[]; log: Log }> {
    const p = this.props, w = this.ctx?.world as unknown as { element?: (id: string) => Element } | undefined;
    let of = p.of as GroupsProps<D>['of'];
    if (typeof of === 'string') { if (!w?.element) throw new AslnutError('E-DATA-001', `groups '${this.id}': no element '${of}'`, { where: this.id }); of = w.element(of); }
    // ── the members: a set's things (their samples), or features (their places) ──
    let items: D[] = [], set: EntitySet | null = null;
    if (of instanceof EntitySet) { set = of; await set.log.start({ loader: ctx.loader, error: ctx.error }); items = set.log.ids.map((id, index) => ({ id, props: set!.log.props[index] ?? {}, index }) as Thing as unknown as D); }
    else {
      let data: unknown = of;
      // (an element's features: a layer's or an instance set's data, a card set's or an icon's items)
      if (of instanceof Element) { const pp = of.props as unknown as { data?: unknown; of?: unknown }; data = pp.data ?? pp.of; }
      if (data instanceof Source) { await data.start(ctx); data = data.features(); }
      if (!Array.isArray(data)) throw new AslnutError('E-DATA-001', `groups '${this.id}': its members have no features`, { where: this.id, fix: 'of: a set, a layer with data, a source or an array' });
      items = (data as D[]).map((f) => ((f as unknown as Feature).props || !(f as unknown as { properties?: unknown }).properties ? f : normalize([f])[0] as unknown as D));
    }
    const n = items.length, offs = new Int32Array(n + 1), T: number[] = [], X: number[] = [], Y: number[] = [];
    const at = (of instanceof Element ? (of.props as unknown as { at?: (d: D) => readonly number[] }).at : undefined);
    items.forEach((d, i) => {
      offs[i] = X.length;
      if (set) { const log = set.log; for (let j = 0; j < log.count[i]!; j++) { const sl = log.slot(i, j), r = log.relAt(sl), ll = log.lonLat(r[0], r[1]); T.push(log.epoch + log.secAt(sl) * 1000); X.push(ll[0]); Y.push(ll[1]); } }
      else { const q = at ? at(d) : anchorOf((d as unknown as Feature).geometry ?? null); if (q) { T.push(-Infinity); X.push(q[0]!); Y.push(q[1]!); } }
    });
    offs[n] = X.length;
    // ── the grouping ──
    let byIn: GroupsJobIn['by'], areas: Feature[] = [], keys: (string | number)[] = [];
    if (isFn<D>(by)) {
      const ix = new Map<string, number>(), key = new Int32Array(n);
      items.forEach((d, i) => { const k = by(d); if (k === null || k === undefined) { key[i] = -1; return; } const s = String(k); let g = ix.get(s); if (g === undefined) { g = ix.size; ix.set(s, g); keys.push(k); } key[i] = g; });
      byIn = { kind: 'keys', key, groups: ix.size };
    } else if ('cells' in by) {
      if (!(by.cells > 0)) throw new AslnutError('E-DATA-001', `groups '${this.id}': cells of ${by.cells} m`, { where: this.id, fix: 'by: { cells: 500 } (metres)' });
      let lat0 = 0; for (let k = 0; k < Y.length; k++) lat0 += Y[k]!; lat0 = Y.length ? lat0 / Y.length : 0;
      byIn = { kind: 'cells', size: by.cells, lat0 };
    } else {
      const src = by.regions; if (src instanceof Source) await src.start(ctx);
      areas = (src instanceof Source ? src.features() : src).map((f) => ((f as Feature).props || !(f as unknown as { properties?: unknown }).properties ? f as Feature : normalize([f])[0]!)).filter((f) => polygonsOf(f.geometry).length);
      const rings: number[] = [], ringOff: number[] = [0], groupRings: number[] = [0], hole: number[] = [], box: number[] = [];
      areas.forEach((f) => {
        for (const poly of polygonsOf(f.geometry)) poly.forEach((r, k) => { for (const q of r) rings.push(q[0], q[1]); ringOff.push(rings.length / 2); hole.push(k > 0 ? 1 : 0); });
        groupRings.push(hole.length);
        const b = bboxOf(f.geometry) ?? [0, 0, 0, 0]; box.push(...b);
      });
      byIn = { kind: 'regions', groups: areas.length, rings: Float64Array.from(rings), ringOff: Int32Array.from(ringOff), groupRings: Int32Array.from(groupRings), hole: Uint8Array.from(hole), box: Float64Array.from(box) };
    }
    // ── the values: each aggregate's operation, the members' channels it reads (derived once) ──
    const vals = Object.entries(p.values ?? { n: { count: true } }), chs: Record<string, Channel<D>> = {}, ops: number[] = [], chan: number[] = [];
    for (const [name, v] of vals) {
      const k = 'count' in v ? 'count' : 'sum' in v ? 'sum' : 'mean' in v ? 'mean' : 'min' in v ? 'min' : 'max' in v ? 'max' : 'fn' in v ? 'fn' : null;
      if (!k) throw new AslnutError('E-DATA-001', `groups '${this.id}': value '${name}' is not an aggregate`, { where: this.id, fix: '{ count: true } · { sum: ch } · { mean: ch } · { min: ch } · { max: ch } · { of: ch, fn }' });
      if (k === 'count') { ops.push(0); chan.push(-1); continue; }
      const ch = k === 'fn' ? (v as { of: Channel<D> }).of : (v as Record<string, Channel<D>>)[k]!;
      chan.push(Object.keys(chs).length); chs[`c${Object.keys(chs).length}`] = ch; ops.push(k === 'fn' ? 5 : OPS[k as keyof typeof OPS]);
    }
    const mlog = p.log ?? set?.log ?? null;
    for (const l of logsOf(chs, mlog, items)) await l.start({ loader: ctx.loader, error: ctx.error });
    const mv = Object.keys(chs).length ? derive(items, chs, { log: mlog, id: (d, i) => (d as { id?: string | number }).id ?? i }) : null;
    const vOff = new Int32Array(n + 1), vT: number[] = [], vC: number[][] = Object.keys(chs).map(() => []);
    for (let i = 0; i < n; i++) { vOff[i] = vT.length; if (!mv) continue; for (let j = 0; j < mv.count[i]!; j++) { const sl = mv.first[i]! + j; vT.push(mv.epoch + mv.secAt(sl) * 1000); vC.forEach((c, k) => c.push((mv.cols[k] as Float32Array)[sl]!)); } }
    vOff[n] = vT.length;
    const input: GroupsJobIn = { n, off: offs, t: Float64Array.from(T), x: Float64Array.from(X), y: Float64Array.from(Y), by: byIn, ops, chan, vOff, vT: Float64Array.from(vT), v: vC.map((c) => Float32Array.from(c)) };
    const r = await runJob(input, vals.map(([, v]) => ('fn' in v ? (v as { fn: (xs: number[]) => number }).fn : null)));
    // ── the groups: their features and places, their log ──
    const G = r.groups, ids: string[] = [], feats: Feature[] = [], LX: number[] = [], LY: number[] = [], count: number[] = [];
    const lat0 = byIn.kind === 'cells' ? byIn.lat0 : 0, size = byIn.kind === 'cells' ? byIn.size : 0;
    for (let g = 0; g < G; g++) {
      let geometry: Geometry, name: string, id: string;
      if (byIn.kind === 'regions') { const f = areas[g]!; geometry = f.geometry!; id = String(f.id); name = String((by as { name?: (f: Feature) => string }).name?.(f) ?? f.props.name ?? f.id); }
      else if (byIn.kind === 'cells') {
        const ix = r.cells[2 * g]!, iy = r.cells[2 * g + 1]!, kx = 111320 * Math.cos(lat0 * D), x0 = (ix * size) / kx, y0 = (iy * size) / 110574, x1 = ((ix + 1) * size) / kx, y1 = ((iy + 1) * size) / 110574;
        geometry = { type: 'Polygon', coordinates: [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]] }; id = `${ix}_${iy}`; name = id;
      } else {
        // (your key: its members' middle)
        let sx = 0, sy = 0, k = 0; items.forEach((_, i) => { if ((byIn as { key: Int32Array }).key[i] !== g) return; for (let q = offs[i]!; q < offs[i + 1]!; q++) { sx += X[q]!; sy += Y[q]!; k++; } });
        geometry = { type: 'Point', coordinates: [k ? sx / k : 0, k ? sy / k : 0] }; id = String(keys[g]); name = id;
      }
      const a = anchorOf(geometry) ?? [0, 0], first = r.off[g]!, props: Props = { id, name, level, members: r.members[g]! };
      vals.forEach(([nm], k) => { props[nm] = r.v[k]![first] ?? 0; });
      if (!r.members[g]) continue;
      ids.push(id); feats.push({ id, props, geometry });
      const m = r.off[g + 1]! - first; count.push(m); for (let s = 0; s < m; s++) { LX.push(a[0]!); LY.push(a[1]!); }
    }
    // (the groups with no member left out: their samples too)
    const keep: number[] = []; for (let g = 0; g < G; g++) if (r.members[g]) for (let s = r.off[g]!; s < r.off[g + 1]!; s++) keep.push(s);
    const log = Log.fromColumns({ ids, count, t: keep.map((s) => r.t[s]!), lon: LX, lat: LY, values: Object.fromEntries(vals.map(([nm], k) => [nm, keep.map((s) => r.v[k]![s]!)])), props: feats.map((f) => f.props) }, { values: Object.fromEntries(vals.map(([nm]) => [nm, 'f32' as const])), place: { type: 'f32' }, time: { type: 'f32' } });
    return { features: feats, log };
  }
  frame(_ctx: FrameContext): DrawCall[] { return []; }
  override status(): ElementStatus {
    const st = super.status();
    for (const s of this.sources) { const ss = s.status(); st.pending.push(...ss.pending); st.failed.push(...ss.failed); }
    st.ready = !st.pending.length;
    return st;
  }
  override readouts() { return { groups: () => this.sources.map((s) => s.size).join('/') }; }
}
/** a level's groups drawn by default: a label each at its place, its name and its first value (as it is when the data
 *  comes; a value over time: cards({ of: groups }) or a set driven by the groups' log, as your mark) */
function defaultMark<D>(src: GroupsSource, values: Record<string, GroupValue<D>>): Element {
  const first = Object.keys(values)[0];
  return text({ id: `${src.id}-labels`, data: src, text: (d: Feature) => (first ? `${d.props.name}\n${Math.round(Number(d.props[first]) * 10) / 10}` : String(d.props.name)), priority: (d: Feature) => Number(first ? d.props[first] : d.props.members) || 0, size: 13, color: '#1f2937', halo: { width: 3, color: '#ffffffe6' } }) as unknown as Element;
}
/** things rolled up into groups per level, with values over time: groups({ of, by, values, show }) */
export function groups<D = unknown>(p: GroupsProps<D>): Groups<D> { return new Groups<D>(p); }
