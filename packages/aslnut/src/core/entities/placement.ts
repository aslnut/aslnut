// core › entities › placement: what a thing placed on another reads. An icon or a card is placed on things: a set's
// moving things (by reference: read on the chip from the set's own track, its block and textures, in the same frame;
// nothing written per frame, a seek is the set's one change), or features (a layer's, an instance set's, a source's,
// your array's: each one's place read once, its height read again only when the ground under it changes, a slice a
// frame). The follower's program includes one of the anchors' forms (shaders/anchors.wgsl.ts): anchorOf(e) is where
// item e stands this frame.
//   const on = placement('evs')                     a set by its id (its things), or a layer, a source, an array
//   on.attach(ctx, () => rebuild())  ·  on.frame(ctx)  ·  on.textures()  ·  on.blocks(ctx.frame)
import { AslnutError } from '../world/errors.ts';
import type { AttachContext, Element, FrameContext } from '../world/element.ts';
import type { GBuffer, GTexture, Graphics } from '../render/graphics/interface.ts';
import { Source } from '../data/sources/source.ts';
import { anchorOf as anchorOfGeometry, normalize, type Feature } from '../data/features.ts';
import { D, mercY, wrap } from '../space/geo.ts';
import { EntitySet, type SetTrack, type Thing } from './sets.ts';

/** what a thing is placed on: an element by its id (a set's things, or a layer's or an instance set's features), the
 *  element itself, a source, or an array of features (or of your own items, with `at`) */
export type PlacedOn<D = unknown> = string | Element | Source<any> | readonly D[];   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface PlacementOptions<D> {
  /** where an item is ([lon, lat] or [lon, lat, metres over the sea]; default the host's own `at`, else its feature's
   *  point, a line's middle, a place well inside an area) */
  at?: (d: D) => readonly number[] | null | undefined;
  /** its heading, degrees clockwise from north (features; a set's things turn along their paths) */
  heading?: (d: D) => number;
  /** metres over where it stands (default 0; a set's things: over their dots) */
  lift?: number | ((d: D) => number);
}
/** placed on a set's things, or still features */
export type PlacementKind = 'set' | 'still';
const KEYS = 2;

export class Placement<D = any> {   // eslint-disable-line @typescript-eslint/no-explicit-any
  readonly of: PlacedOn<D>; private o: PlacementOptions<D>;
  /** the element it is placed on (null: a source or an array) */
  host: Element | null = null; set: EntitySet | null = null; private source: Source | null = null;
  /** the items: the set's things, or the features */
  items: D[] = []; ids: string[] = [];
  /** bumped when the items change (a follower builds its per-item data again) */
  version = 0;
  private ctx: AttachContext | null = null; private offs: (() => void)[] = []; private onChange: () => void = () => {};
  constructor(of: PlacedOn<D>, o: PlacementOptions<D> = {}) {
    if (of === undefined || of === null) throw new AslnutError('E-DATA-001', 'placed on nothing: give `of` (an element id, an element, a source or an array)', { fix: "icon({ of: 'stations', … }) · cards({ of: chargers, … })" });
    this.of = of; this.o = o;
  }
  get kind(): PlacementKind { return this.set ? 'set' : 'still'; }
  /** resolve what it is placed on (an id: an element already in the world), start its data, follow its changes */
  attach(ctx: AttachContext, onChange: () => void): void {
    this.ctx = ctx; this.onChange = onChange;
    let of = this.of as PlacedOn<D>;
    if (typeof of === 'string') {
      const w = ctx.world as unknown as { element?: (id: string) => Element };
      if (!w.element) throw new AslnutError('E-DATA-001', `placed on '${of}': this world cannot find elements by id`, { fix: 'give the element itself' });
      of = w.element(of);
    }
    if (of instanceof EntitySet) {
      this.host = of; this.set = of;
      this.offs.push(of.log.watch((c) => { if (c.kind === 'all' || (c.kind === 'thing' && (c.index < 0 || c.index >= this.items.length))) this.things(); }));
      this.things();
      return;
    }
    if (of instanceof Source) this.source = of;
    else if (Array.isArray(of)) this.items = of as D[];
    else {
      // an element with data: a layer of features or an instance set (its `data`, and its `at`)
      const el = of as Element, p = el.props as unknown as { data?: unknown; at?: (d: D) => readonly number[] };
      this.host = el;
      if (p.at && !this.o.at) this.o = { ...this.o, at: p.at };
      if (p.data instanceof Source) this.source = p.data;
      else if (Array.isArray(p.data)) this.items = p.data as D[];
      else throw new AslnutError('E-DATA-001', `placed on '${el.id}': it has no features (a set, a layer or an instance set)`, { where: el.id, fix: 'place it on a set of entities, a layer with data, or give a source' });
    }
    const src = this.source;
    if (src) { this.offs.push(src.watch(() => this.features())); void src.start({ loader: ctx.loader, error: (e) => ctx.world.error(e) }).then(() => this.features()); }
    else this.features();
  }
  detach(): void { for (const f of this.offs) f(); this.offs = []; this.tex?.destroy(); this.tex = null; this.cap = 0; this.ctx = null; }
  /** a set's things, as your functions see them */
  private things(): void {
    const log = this.set!.log;
    if (log.size === this.items.length && this.items.length) return;
    this.items = log.ids.map((id, index) => ({ id, props: log.props[index] ?? {}, index }) as Thing as unknown as D);
    this.ids = log.ids.slice(); this.version++; this.onChange();
  }
  /** the features (a source's now, or the array's), their places read once */
  private features(): void {
    const raw = this.source ? (this.source.features() as unknown as D[]) : this.items;
    // (GeoJSON features as they come: their properties as props)
    const fs = raw.map((f) => ((f as unknown as Feature).props || !(f as unknown as { properties?: unknown }).properties ? f : normalize([f])[0] as unknown as D));
    this.items = fs; this.ids = fs.map((f, i) => String((f as unknown as { id?: unknown }).id ?? i));
    const n = fs.length, ll = new Float64Array(n * 2), own = new Float32Array(n), turn = new Float32Array(n), lift = new Float32Array(n), ok = new Uint8Array(n);
    const at = this.o.at, L = this.o.lift;
    fs.forEach((f, i) => {
      const p = at ? at(f) : anchorOfGeometry((f as unknown as Feature).geometry ?? null);
      if (!p || !Number.isFinite(p[0]) || !Number.isFinite(p[1])) return;
      ll[2 * i] = p[0]!; ll[2 * i + 1] = p[1]!; own[i] = p[2] !== undefined ? p[2] : NaN; ok[i] = 1;
      turn[i] = this.o.heading ? (Number(this.o.heading(f)) || 0) * D : 0;
      lift[i] = typeof L === 'function' ? Number(L(f)) || 0 : L ?? 0;
    });
    this.ll = ll; this.own = own; this.turn = turn; this.liftOf = lift; this.ok = ok;
    // the origin: the first place (the places are kept from it: radians of longitude, Mercator y)
    const k = ok.indexOf(1); if (k >= 0) { this.lon0 = ll[2 * k]!; this.m0 = mercY(ll[2 * k + 1]!); }
    this.hts = new Float32Array(0); this.version++; this.dirty = true;
    this.onChange();
  }
  // ── still: the places on the chip ──
  private ll = new Float64Array(0); private own = new Float32Array(0); private turn = new Float32Array(0); private liftOf = new Float32Array(0); private ok = new Uint8Array(0);
  private lon0 = 0; private m0 = 0;
  private hts = new Float32Array(0); private hVer = -1; private hAt = -1e9; private hNext = -1; private hPass = -1; private dirty = true;
  private tex: GTexture | null = null; private cap = 0; private data = new Float32Array(0);
  /** the ground under the places read (again as it sharpens, a slice a frame), the places written when they changed;
   *  a set: its track this frame. False: not ready to draw */
  frame(ctx: FrameContext): boolean {
    if (this.set) return !!this.track(ctx);
    const n = this.items.length, g = ctx.graphics; if (!n) return false;
    const gv = ctx.world.groundVersion, ground = (q: number) => { const h0 = this.own[q]!; if (h0 === h0) { this.hts[q] = h0; return; } const h = ctx.world.heightAt(this.ll[2 * q]!, this.ll[2 * q + 1]!); this.hts[q] = Number.isNaN(h) ? 0 : h; };
    if (this.hts.length !== n) { this.hts = new Float32Array(n); for (let q = 0; q < n; q++) ground(q); this.hVer = gv; this.hAt = ctx.now; this.hNext = -1; this.dirty = true; }
    else if (this.hNext < 0 && gv !== this.hVer && ctx.now - this.hAt > 250) { this.hNext = 0; this.hPass = gv; }
    if (this.hNext >= 0) {
      const t0 = performance.now();
      while (this.hNext < n) { ground(this.hNext++); if ((this.hNext & 255) === 0 && performance.now() - t0 > 2) break; }
      if (this.hNext >= n) { this.hNext = -1; this.hVer = this.hPass; this.hAt = ctx.now; this.dirty = true; }
    }
    if (this.dirty) this.upload(g);
    return !!this.tex;
  }
  /** the places' texture: 2 texels an item (x, y from the origin, height m, how it stands · heading rad, lift m) */
  private upload(g: Graphics): void {
    const n = this.items.length, rows = Math.max(1, Math.ceil((KEYS * n) / 4096));
    if (!this.tex || rows > this.cap) { this.tex?.destroy(); this.cap = Math.max(rows, this.cap * 2 || 1); this.tex = g.texture({ label: 'placed places', width: 4096, height: this.cap, format: 'rgba32f', filter: 'nearest' }); this.data = new Float32Array(this.cap * 4096 * 4); }
    const d = this.data;
    d.fill(0, 0, rows * 4096 * 4);
    for (let i = 0; i < n; i++) {
      if (!this.ok[i]) continue;
      const o = i * 8, lat = Math.max(-85.0511, Math.min(85.0511, this.ll[2 * i + 1]!));
      d[o] = wrap(this.ll[2 * i]! - this.lon0) * D; d[o + 1] = mercY(lat) - this.m0; d[o + 2] = this.hts[i]!; d[o + 3] = this.own[i]! === this.own[i]! ? 2 : 1;
      d[o + 4] = this.turn[i]!; d[o + 5] = this.liftOf[i]!;
    }
    this.tex.write(d.subarray(0, rows * 4096 * 4), { x: 0, y: 0, width: 4096, height: rows });
    this.dirty = false;
  }
  /** a set's track this frame (it draws before its followers; hidden or not drawn yet: null) */
  track(ctx: FrameContext): SetTrack | null { const t = this.set?.track() ?? null; return t && t.at === ctx.now ? t : null; }
  /** the place block's numbers (`u.place`): the origin − the view's centre (radians of longitude, Mercator y), the
   *  exaggeration, the lift over a set's things */
  place(ctx: FrameContext, lift = 0): [number, number, number, number] {
    const cam = ctx.camera;
    return [wrap(this.lon0 - cam.lon) * D, this.m0 - mercY(Math.max(-85.0511, Math.min(85.0511, cam.lat))), ctx.world.exaggeration, lift];
  }
  /** the textures before the follower's own: a set's (SET_TEXTURES), or the places */
  textures(ctx: FrameContext): GTexture[] { return this.set ? this.track(ctx)?.textures ?? [] : this.tex ? [this.tex] : []; }
  /** the blocks before the follower's own: the frame, and a set's */
  blocks(ctx: FrameContext): GBuffer[] { const t = this.set ? this.track(ctx) : null; return t ? [ctx.frame, t.block] : [ctx.frame]; }
  /** how much the host is shown (a follower is shown with it: a set's things hidden, its cards too) */
  get shown(): number { return this.host ? this.host.shown : 1; }
  /** the ground under it is still being read */
  get busy(): boolean { return this.hNext >= 0; }
  /** an item's place now, on the main thread ([lon, lat]: a set's thing at the world's time; null: not placed) */
  lonLat(i: number, t?: number): [number, number] | null {
    if (this.set) { const st = this.set.log.at(i, t ?? Date.now(), true); return st ? [st.lon, st.lat] : null; }
    return this.ok[i] ? [this.ll[2 * i]!, this.ll[2 * i + 1]!] : null;
  }
}
/** a thing placed on another: on a set's things (by reference, read on the chip), or on features */
export const placement = <D = unknown>(of: PlacedOn<D>, o?: PlacementOptions<D>) => new Placement<D>(of, o);
