// core › data › history › epochs: one dataset per time, played through time. A list of { at, source }: features (areas,
// lines, points), a grid (a raster field's values) or surface values (a surface field's), each given or loaded when
// it is needed. It follows the world's clock (s.time: replay, a seek and a time slider drive it) or a param of yours.
// 'step' holds the latest epoch at or before the time; 'morph' blends the two around it: grids and surface values on
// the chip (both epochs there, and their mix: nothing computed again on the CPU as the time moves), features by id
// (the numbers in their props between the two, the geometry the earlier one's). Only the epochs near the time are
// held (the one shown, the next, the one before, the one after next while the clock runs that way), a few at most.
//   const heat = data.epochs(hours.map((h) => ({ at: h.time, source: () => fetchGrid(h.url) })), { blend: 'morph' })
//   w.add(field({ id: 'heat', res: 10, area, data: heat, draw: { ramp: 'inferno', domain: [20, 40] } }))
//   area({ data: data.epochs(iceSheets), when: (s) => s.time.now.getUTCFullYear() < 1990 })
import { AslnutError } from '../world/errors.ts';
import type { State } from '../world/state.ts';
import type { Feature } from './features.ts';
import { Source, type SourceContext } from './sources/source.ts';

/** a time: ms since 1970, a Date or an ISO string (or, with `by` a param, that param's number) */
export type Time = number | Date | string;
/** a grid of a raster field: w × h numbers (row 0 north), or 4 a cell; with its size (and area) when you know them */
export type GridSource = Float32Array | { values: Float32Array; size?: [number, number]; area?: [number, number, number, number] };
/** what an epoch holds, given or made when it is needed: a function of no parameters is a loader (called each time it
 *  is loaded: sync or a promise); any other value (a function of a surface field's thing and facet too) is the value */
export type EpochSource<T> = T | (() => T | Promise<T>);
const isLoader = (v: unknown): v is () => unknown => typeof v === 'function' && v.length === 0;
export interface Epoch<T> { at: Time; source: EpochSource<T> }
export interface EpochsOptions {
  /** 'step' (default): the latest epoch at or before the time · 'morph': the two around it blended by the time */
  blend?: 'step' | 'morph';
  /** what it follows: 'time' (default: the world's clock) or a param's key (`w.set('scenario.year', 2040)`) */
  by?: string;
  /** epochs held at most (default 4: the one shown, the next, the one before, one more the way the clock runs) */
  keep?: number;
  id?: string;
}
/** where the time falls among the epochs: the one at or before it (`i`), the next (`j`: `i` at the ends and when
 *  stepping), and the next one's share (`f`: 0 when stepping) */
export interface EpochPick { i: number; j: number; f: number }
/** what epochs hold and cost (telemetry) */
export interface EpochStats { id: string; epochs: number; held: number; bytes: number; loading: number; loads: number; dropped: number; shown: [number, number, number] }

const msOf = (t: Time, by: string): number => {
  if (by !== 'time') { const n = Number(t); if (!Number.isFinite(n)) throw new AslnutError('E-DATA-001', `epochs by '${by}': '${String(t)}' is not a number`, { fix: 'give each epoch its param\'s number: { at: 2040, source }' }); return n; }
  const ms = t instanceof Date ? t.getTime() : typeof t === 'string' ? Date.parse(t) : t;
  if (!Number.isFinite(ms)) throw new AslnutError('E-DATA-001', `epochs: '${String(t)}' is not a time`, { fix: "at: Date.UTC(2026, 0, 1, 7) · new Date(…) · '2026-01-01T07:00Z'" });
  return ms;
};
/** the bytes a value holds (typed arrays exactly; features by their coordinates and props, roughly) */
function bytesOf(v: unknown): number {
  if (!v) return 0;
  if (ArrayBuffer.isView(v)) return v.byteLength;
  if (Array.isArray(v)) { let n = 0; for (const f of v) n += featureBytes(f); return n; }
  if (typeof v === 'object') {
    const o = v as Record<string, unknown>;
    if (ArrayBuffer.isView(o.values)) return (o.values as ArrayBufferView).byteLength;
    if (Array.isArray(o.features)) return bytesOf(o.features);
    let n = 0; for (const x of Object.values(o)) if (ArrayBuffer.isView(x)) n += x.byteLength; return n;
  }
  return 0;
}
function featureBytes(f: unknown): number {
  const g = (f as { geometry?: { coordinates?: unknown } })?.geometry, p = (f as { props?: object; properties?: object })?.props ?? (f as { properties?: object })?.properties;
  const count = (c: unknown): number => (Array.isArray(c) ? (typeof c[0] === 'number' ? 1 : c.reduce((s: number, x) => s + count(x), 0)) : 0);
  return 64 + count(g?.coordinates) * 16 + (p ? Object.keys(p).length * 24 : 0);
}

/** one dataset per time: data.epochs(list, { blend, by }) */
export class Epochs<T = unknown> extends Source {
  readonly blend: 'step' | 'morph';
  readonly by: string;
  /** each epoch's time (ms; or the param's number), in order */
  readonly times: readonly number[];
  private items: { source: EpochSource<T>; value: T | undefined; loading: Promise<T> | null; bytes: number; failed: Error | null }[];
  private keepN: number;
  private nowPick: EpochPick = { i: 0, j: 0, f: 0 }; private t = NaN; private dir = 0;
  private loads = 0; private dropped = 0;
  /** told when an epoch it was waiting for arrives (a paused world draws it) */
  private arrived = new Set<() => void>();
  constructor(list: readonly Epoch<T>[], o: EpochsOptions = {}) {
    super({ id: o.id });
    if (!Array.isArray(list) || !list.length) throw new AslnutError('E-DATA-001', 'data.epochs needs a list of { at, source }', { fix: 'data.epochs([{ at: Date.UTC(2026, 0, 1, 7), source: grid7 }, { at: Date.UTC(2026, 0, 1, 8), source: grid8 }])' });
    this.blend = o.blend ?? 'step'; this.by = o.by ?? 'time';
    if (this.blend !== 'step' && this.blend !== 'morph') throw new AslnutError('E-DATA-001', `epochs: blend '${String(this.blend)}' is not one (step, morph)`, { fix: "blend: 'step' · blend: 'morph'" });
    const times = list.map((e, k) => { if (!e || e.at === undefined) throw new AslnutError('E-DATA-001', `epochs: entry ${k} has no 'at'`, { fix: '{ at: time, source }' }); return msOf(e.at, this.by); });
    for (let k = 1; k < times.length; k++) if (!(times[k]! > times[k - 1]!)) throw new AslnutError('E-DATA-001', `epochs are not in time order: entry ${k} (${new Date(times[k]!).toISOString?.() ?? times[k]}) is not after entry ${k - 1}`, { fix: 'sort them by time first: list.sort((a, b) => +new Date(a.at) - +new Date(b.at)); one epoch per time' });
    this.times = times;
    this.items = list.map((e) => ({ source: e.source, value: undefined, loading: null, bytes: 0, failed: null }));
    this.keepN = Math.max(2, o.keep ?? 4);
  }
  /** the first and the last epoch's time (the span a replay plays: replay(w, { from: ep.from, to: ep.to })) */
  get from(): Date { return new Date(this.times[0]!); }
  get to(): Date { return new Date(this.times[this.times.length - 1]!); }
  get length(): number { return this.times.length; }
  /** where a time falls: the epoch at or before it, the next, the next one's share (before the first: the first; after
   *  the last: the last) */
  pick(t: Time): EpochPick {
    const x = typeof t === 'number' ? t : msOf(t, this.by), T = this.times, n = T.length;
    if (!(x > T[0]!)) return { i: 0, j: 0, f: 0 };
    if (x >= T[n - 1]!) return { i: n - 1, j: n - 1, f: 0 };
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (T[m]! <= x) lo = m; else hi = m; }
    if (this.blend === 'step') return { i: lo, j: lo, f: 0 };
    return { i: lo, j: hi, f: (x - T[lo]!) / (T[hi]! - T[lo]!) };
  }
  /** the pick as last followed (update) */
  get now(): EpochPick { return this.nowPick; }
  /** an epoch's value when it is held (undefined: not loaded) */
  value(i: number): T | undefined { return this.items[i]?.value; }
  /** what the state says the time is (the world's clock, or your param) */
  timeOf(s: State): number {
    if (this.by === 'time') return s.time.now.getTime();
    const v = Number(s.world.params[this.by]);
    return Number.isFinite(v) ? v : this.times[0]!;
  }
  /** follow the state: pick the epochs for its time, load those near it, let go of the far ones. True when what is
   *  shown changed (another epoch, a new share, an epoch arrived) */
  update(s: State): boolean { return this.follow(this.timeOf(s), s.time.rate); }
  /** the same for a time given (ms, or the param's number) and the way the clock runs (> 0 forwards) */
  follow(t: number, rate = 0): boolean {
    const p = this.pick(t), was = this.nowPick;
    this.dir = rate > 0 ? 1 : rate < 0 ? -1 : this.dir;
    const moved = p.i !== was.i || p.j !== was.j || Math.abs(p.f - was.f) > 1e-6 || t !== this.t;
    this.t = t; this.nowPick = p;
    this.window(p);
    return moved && (p.i !== was.i || p.j !== was.j || Math.abs(p.f - was.f) > 1e-6);
  }
  /** the epochs held near a pick: the two shown, the one before, one more ahead the way the clock runs */
  private wanted(p: EpochPick): number[] {
    const n = this.times.length, { i, j } = p;
    // (first the two shown, then the way the clock runs, then the other way)
    const order = this.dir > 0 ? [i, j, j + 1, i - 1, j + 2] : this.dir < 0 ? [i, j, i - 1, i - 2, j + 1] : [i, j, i - 1, j + 1];
    return [...new Set(order)].filter((k) => k >= 0 && k < n).slice(0, this.keepN);
  }
  private window(p: EpochPick): void {
    const want = this.wanted(p);
    for (const k of want) this.epoch(k);
    // a few held at most: the farthest from the one shown let go first (those wanted never)
    const held = this.items.map((it, k) => (it.value !== undefined ? k : -1)).filter((k) => k >= 0 && !want.includes(k));
    let n = this.items.filter((it) => it.value !== undefined || it.loading).length;
    held.sort((a, b) => Math.abs(b - p.i) - Math.abs(a - p.i));
    for (const k of held) { if (n <= this.keepN) break; const it = this.items[k]!; if (!isLoader(it.source)) continue; it.value = undefined; it.bytes = 0; this.dropped++; n--; }
  }
  /** an epoch's value now, or once it is loaded (loaded now if it is not held) */
  epoch(k: number): T | Promise<T> | undefined {
    const it = this.items[k]; if (!it) return undefined;
    if (it.value !== undefined) return it.value;
    if (it.loading) return it.loading;
    if (it.failed) return undefined;
    const src = it.source;
    if (!isLoader(src)) { it.value = src as T; it.bytes = bytesOf(src); return it.value; }
    let r: T | Promise<T>;
    try { r = (src as () => T | Promise<T>)(); } catch (e) { it.failed = e instanceof Error ? e : new Error(String(e)); this.failure = it.failed; return undefined; }
    this.loads++;
    if (!(r instanceof Promise)) { it.value = r; it.bytes = bytesOf(r); return r; }
    it.loading = this.track(r).then((v) => {
      it.loading = null; it.value = v; it.bytes = bytesOf(v);
      const p = this.nowPick; if (k === p.i || k === p.j) for (const f of [...this.arrived]) { try { f(); } catch (e) { console.error(e); } }
      return v;
    }, (e: unknown) => { it.loading = null; it.failed = e instanceof Error ? e : new Error(String(e)); this.failure = it.failed; throw e; });
    it.loading.catch(() => {});
    return it.loading;
  }
  /** the two epochs shown and the next one's share; an epoch not held yet: undefined (the caller keeps what it shows) */
  shown(): { a: T | undefined; b: T | undefined; f: number; i: number; j: number } {
    const p = this.nowPick; return { a: this.items[p.i]?.value, b: this.items[p.j]?.value, f: p.f, i: p.i, j: p.j };
  }
  /** call fn when an epoch shown arrives (loaded after it was asked for); returns the function that stops it */
  onArrive(fn: () => void): () => void { this.arrived.add(fn); return () => this.arrived.delete(fn); }
  /** what it holds and costs */
  epochStats(): EpochStats {
    let held = 0, bytes = 0, loading = 0;
    for (const it of this.items) { if (it.value !== undefined) { held++; bytes += it.bytes; } if (it.loading) loading++; }
    const p = this.nowPick;
    return { id: this.id, epochs: this.times.length, held, bytes, loading, loads: this.loads, dropped: this.dropped, shown: [p.i, p.j, +p.f.toFixed(4)] };
  }
  override status() {
    const st = super.status(), p = this.nowPick;
    for (const k of new Set([p.i, p.j])) if (this.items[k]?.loading) st.pending.push(`epoch ${k} of '${this.id}' loading`);
    return st;
  }

  // ── as a source of features (areas, lines, points): the epoch shown, its numbers morphed by id ──
  private shownKey = '';
  protected async load(_ctx: SourceContext): Promise<void> { this.window(this.nowPick); this.syncFeatures(); }
  override frame(s: State, _ctx: SourceContext): void { this.update(s); this.syncFeatures(); }
  private syncFeatures(): void {
    const { a, b, f, i, j } = this.shown();
    const fa = featuresOf(a), fb = featuresOf(b);
    if (!fa) return;
    const key = `${i}|${j}|${fb ? f.toFixed(5) : 0}`;
    if (key === this.shownKey) return;
    const shapes = !this.shownKey.startsWith(`${i}|`) || this.shownKey === '';
    this.shownKey = key;
    // (stepping, or the next not held yet: the epoch at or before)
    if (!fb || f <= 0 || i === j) { this.replace(fa, shapes); return; }
    const byId = new Map(fb.map((x) => [x.id, x]));
    const out = fa.map((x) => {
      const y = byId.get(x.id); if (!y) return x;
      const props: Record<string, unknown> = { ...(x.props as Record<string, unknown>) };
      for (const [k, v] of Object.entries(props)) { const w = (y.props as Record<string, unknown>)[k]; if (typeof v === 'number' && typeof w === 'number') props[k] = v + (w - v) * f; }
      return { ...x, props } as Feature;
    });
    this.replace(out, shapes);
  }
}
/** an epoch's features (an array of features, a FeatureCollection, rows with an id): null when it is not features */
function featuresOf(v: unknown): Feature[] | null {
  if (!v) return null;
  const list = Array.isArray(v) ? v : Array.isArray((v as { features?: unknown }).features) ? (v as { features: unknown[] }).features : null;
  if (!list) return null;
  return list.map((f, k) => {
    const x = f as Feature & { properties?: Record<string, unknown> };
    if (x.geometry !== undefined) return (x.props ? x : { ...x, id: x.id ?? (x.properties?.id as string) ?? k, props: x.properties ?? {} }) as Feature;
    // a row: its place from lon / lat
    const r = f as Record<string, unknown>;
    return { id: (r.id as string | number) ?? k, geometry: Number.isFinite(r.lon) && Number.isFinite(r.lat) ? { type: 'Point', coordinates: [r.lon, r.lat] } : null, props: r } as unknown as Feature;
  });
}
/** a grid's numbers and size (null: not a grid) */
export function gridOf(v: unknown): { values: Float32Array; size?: [number, number] } | null {
  if (v instanceof Float32Array) return { values: v };
  const o = v as { values?: unknown; size?: [number, number] } | null;
  return o && o.values instanceof Float32Array ? { values: o.values, size: o.size } : null;
}
export const isEpochs = (v: unknown): v is Epochs => v instanceof Epochs;
/** one dataset per time: data.epochs([{ at, source }], { blend: 'step' | 'morph', by: 'time' }) */
export const epochs = <T = unknown>(list: readonly Epoch<T>[], o?: EpochsOptions) => new Epochs<T>(list, o);
