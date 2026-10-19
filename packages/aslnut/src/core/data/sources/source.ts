// core › data › sources › source: what every vector source is. It loads once through the loader (shared by every
// layer that uses it), keeps its features with stable ids, and says when they changed: `version` for any change,
// `shapeVersion` when shapes changed (not only numbers), so a layer rebuilds geometry only when it must and just
// recolours otherwise. Sources that follow the view (tiles, queries) get the state each frame.
//   class MySource extends Source { protected async load(ctx) { this.replace(await myFeatures()); } }
import type { Loader } from '../loading/loader.ts';
import { AslnutError } from '../../world/errors.ts';
import type { State } from '../../world/state.ts';
import type { Feature, Props } from '../features.ts';
import { whenDrawn } from '../../runtime/frame.ts';

export interface SourceContext { loader: Loader; error(e: unknown): void }
export interface SourceStatus { pending: string[]; failed: { what: string; error: string }[] }
export interface JoinOptions<P = Props> {
  /** the key: a prop name of the shapes (and of the rows, unless `rowsOn`), or a function of a feature */
  on: string | ((f: Feature<P>) => unknown);
  /** the rows' key, when it is named differently */
  rowsOn?: string | ((f: Feature) => unknown);
}

let seq = 0;
export abstract class Source<P = Props> {
  readonly kind = 'source' as const;
  readonly id: string;
  attribution: string;
  /** bumped on every change */
  version = 0;
  /** bumped when shapes change (added, removed, moved); not when only props change */
  shapeVersion = 0;
  failure: Error | null = null;
  protected list: Feature<P>[] = [];
  protected byId = new Map<string | number, Feature<P>>();
  private watchers = new Set<() => void>(); private recorders = new Set<() => void>();
  private started: Promise<void> | null = null;
  private busy = 0;
  constructor(o: { id?: string; attribution?: string } = {}) { this.id = o.id ?? `${this.constructor.name.toLowerCase()}-${++seq}`; this.attribution = o.attribution ?? ''; }

  /** the features now (empty until loaded) */
  features(): readonly Feature<P>[] { return this.list; }
  /** it follows the view (tiles asked as the view moves): it never holds the whole data on the device, so a scale
   *  over it needs its domain given (core › encoding › scales). Loading by view is a cache only: features are added
   *  by id, never changed by looking */
  get byView(): boolean { return false; }
  get(id: string | number): Feature<P> | undefined { return this.byId.get(id) ?? this.byId.get(String(id)) ?? (typeof id === 'string' && id !== '' && !Number.isNaN(Number(id)) ? this.byId.get(Number(id)) : undefined); }
  get size(): number { return this.list.length; }
  /** begin loading; the same promise for every caller (a source is shared) */
  start(ctx: SourceContext): Promise<void> {
    this.started ??= this.track(this.load(ctx)).catch((e: unknown) => { this.failure = e instanceof Error ? e : new Error(String(e)); ctx.error(e); });
    return this.started;
  }
  /** forget the load done, so the next start loads again (a closed stream taken up again) */
  protected unstart(): void { this.started = null; }
  /** resolves when what it is doing now is done (and at once when nothing is) */
  get ready(): Promise<void> { return this.started ?? Promise.resolve(); }
  protected abstract load(ctx: SourceContext): Promise<void>;
  /** each frame, for sources that follow the view or the time */
  frame(_s: State, _ctx: SourceContext): void {}
  status(): SourceStatus {
    return { pending: this.busy ? [`source '${this.id}' loading`] : [], failed: this.failure ? [{ what: `source '${this.id}'`, error: this.failure.message }] : [] };
  }
  /** count work in flight (settled waits for it) */
  protected track<T>(p: Promise<T>): Promise<T> { this.busy++; return p.finally(() => { this.busy--; }); }
  /** call fn whenever the features change; returns the function that stops it. Changed while a frame is being made
   *  (your everyFrame work): told once that frame is drawn, once however often it changed (a layer draws what it was
   *  made of); `now`: told at once, each change (a recorder of every row: drive.data) */
  watch(fn: () => void, o: { now?: boolean } = {}): () => void { const s = o.now ? this.recorders : this.watchers; s.add(fn); return () => s.delete(fn); }
  /** how many are told of its changes now (watchers and recorders): what holds on to it (0: nothing does) */
  get watching(): number { return this.watchers.size + this.recorders.size; }
  /** the sources it is made from (a join's shapes and rows, a roll-up's rows and every level's shapes): the layers that
   *  use it use them too (core › world › element: opened with its first layer, closed with its last) */
  inputs(): readonly Source[] { return []; }
  /** taken up again by a layer after close(): what it follows (its inputs, a stream's socket) followed again */
  reopen(): void {}
  /** let go of what it holds while no layer uses it (its subscriptions to its inputs; a stream's socket). The world
   *  closes it when the last layer using it is removed or the world disposed; a source you use without a layer you
   *  close yourself. Read while closed, it catches up with its inputs then */
  close(): void {}
  /** replace every feature */
  protected replace(list: Feature<P>[], shapes = true): void {
    this.list = list; this.byId = new Map(list.map((f) => [f.id, f]));
    this.changed(shapes);
  }
  protected changed(shapes: boolean): void {
    this.version++; if (shapes) this.shapeVersion++;
    for (const f of [...this.recorders]) { try { f(); } catch (e) { console.error(e); } }
    // (changed while a frame is being made, in your everyFrame work: its layers told once that frame is drawn)
    whenDrawn(this, () => { for (const f of [...this.watchers]) { try { f(); } catch (e) { console.error(e); } } });
  }
  /** these shapes with the props of matching rows (a query's numbers on boundaries that load once) */
  join<R = Props>(rows: Source<R>, o: JoinOptions<P>): Joined<P, R> { return new Joined(this, rows, o); }
}

/** shapes joined with rows by a key: shapes stay, numbers change */
export class Joined<P = Props, R = Props> extends Source<P & Partial<R>> {
  private keyOf: (f: Feature<P>) => unknown; private rowKeyOf: (f: Feature<R>) => unknown;
  private seen = [-1, -1, -1];
  readonly shapes: Source<P>; readonly rows: Source<R>;
  constructor(shapes: Source<P>, rows: Source<R>, o: JoinOptions<P>) {
    super({ id: `${shapes.id}+${rows.id}`, attribution: [shapes.attribution, rows.attribution].filter(Boolean).join(' · ') });
    this.shapes = shapes; this.rows = rows;
    if (!o || (typeof o.on !== 'string' && typeof o.on !== 'function')) throw new AslnutError('E-DATA-001', 'join needs { on }', { where: this.id, fix: "shapes.join(rows, { on: 'suburb_code' })" });
    const k = (on: string | ((f: never) => unknown)) => (typeof on === 'function' ? on : (f: Feature<Props>) => (on === 'id' ? f.id : f.props[on]));
    this.keyOf = k(o.on as never) as (f: Feature<P>) => unknown;
    this.rowKeyOf = k((o.rowsOn ?? o.on) as never) as (f: Feature<R>) => unknown;
    // (joined at once, each change: what records its rows sees every one; its layers told as any source's)
    this.reopen();
  }
  private offs: (() => void)[] = [];
  override inputs(): readonly Source[] { return [this.shapes as unknown as Source, this.rows as unknown as Source]; }
  override reopen(): void {
    if (!this.offs.length) this.offs = [this.shapes.watch(() => this.sync(), { now: true }), this.rows.watch(() => this.sync(), { now: true })];
    this.sync();
  }
  override close(): void { for (const off of this.offs) off(); this.offs = []; }
  // (closed: what it reads catches up with its shapes and rows first)
  override features(): readonly Feature<P & Partial<R>>[] { if (!this.offs.length) this.sync(); return super.features(); }
  override get(id: string | number): Feature<P & Partial<R>> | undefined { if (!this.offs.length) this.sync(); return super.get(id); }
  override get size(): number { if (!this.offs.length) this.sync(); return super.size; }
  protected async load(ctx: SourceContext): Promise<void> { await Promise.all([this.shapes.start(ctx), this.rows.start(ctx)]); this.sync(); }
  override frame(s: State, ctx: SourceContext): void { this.shapes.frame(s, ctx); this.rows.frame(s, ctx); }
  override status(): SourceStatus { const a = this.shapes.status(), b = this.rows.status(); return { pending: [...a.pending, ...b.pending], failed: [...a.failed, ...b.failed] }; }
  override get ready(): Promise<void> { return Promise.all([this.shapes.ready, this.rows.ready]).then(() => {}); }
  override get byView(): boolean { return this.shapes.byView || this.rows.byView; }
  /** how many shapes found a row */
  matched = 0;
  private sync(): void {
    if (this.seen[0] === this.shapes.version && this.seen[1] === this.rows.version) return;
    const shapesChanged = this.seen[2] !== this.shapes.shapeVersion;
    this.seen = [this.shapes.version, this.rows.version, this.shapes.shapeVersion];
    const rows = new Map<string, Feature<R>>();
    for (const r of this.rows.features()) { const k = this.rowKeyOf(r); if (k !== undefined && k !== null) rows.set(String(k), r); }
    let m = 0;
    const out = this.shapes.features().map((f) => {
      const r = rows.get(String(this.keyOf(f)));
      if (r) m++;
      return { id: f.id, geometry: f.geometry, cuts: f.cuts, props: (r ? { ...f.props, ...r.props } : { ...f.props }) as P & Partial<R> };
    });
    this.matched = m;
    this.replace(out, shapesChanged);
  }
}
