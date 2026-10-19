// core › encoding › marks › symbols › icon: the app's own pictures, packed into one atlas, drawn as symbols at the places
// of the things they are placed on (core › entities › placement: a set's moving things, read on the chip from its own
// track; or features), facing the screen, by the one size rule (CSS px, or metres kept within a range of CSS px), tinted,
// turned by a heading (a set's thing along its path; a feature's own) as the screen sees it. Near the camera a set's
// thing drawn as its shape keeps its shape: the icon gives way, as the set's dot does. Nothing per frame on the main
// thread: an item's picture, size and tint are written once; a set's things move on the chip. Card headers take their
// icons from the same atlas (kits › dashboard › markers).
//   const pics = icons({ car: '/img/car.png', van: '/img/van.png', plug: (g, n) => { … draw … } })
//   icon({ id: 'fleet-icons', of: 'fleet', icons: pics, icon: d => d.props.kind, heading: true, size: 22 })
//   icon({ of: chargers, icons: pics, icon: 'plug', size: { m: 12, min: 14, max: 40 }, color: '#2563eb' })
import { AslnutError } from '../../world/errors.ts';
import { Element, type AttachContext, type ElementProps, type ElementStatus, type FrameContext, type Picked } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import type { Loader } from '../../data/loading/loader.ts';
import type { DrawCall, GBuffer, GTexture, Graphics, Program, ProgramDesc } from '../../render/graphics/interface.ts';
import { iconWGSL } from '../../render/graphics/shaders/icon.wgsl.ts';
import { iconGLSL } from '../../render/graphics/shaders/icon.glsl.ts';
import { SET_TEXTURES } from '../../render/graphics/shaders/sets.wgsl.ts';
import { rgba, type Color } from '../../render/style/color.ts';
import { sizeUnits, sizeValue, type SizeOf } from '../../render/drawing/size.ts';
import { Placement, type PlacedOn, type PlacementOptions } from '../../entities/placement.ts';
import type { Thing } from '../../entities/sets.ts';
import type { Leveled } from '../../observation/presence.ts';

// ── the atlas ────────────────────────────────────────────────────────────────────────────────────────────────────
/** a picture: a URL (loaded through the world's loader), a decoded image or canvas, or your function drawing it into a
 *  square of `size` px (white shapes tint best) */
export type IconImage = string | ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ((g: OffscreenCanvasRenderingContext2D, size: number) => void);
/** the app's pictures packed into one texture: a cell each (`size` px square, the picture fitted in, its shape kept).
 *  It grows: `add(name, image)` a picture later (the texture made again once it is in; the pictures before keep
 *  drawing meanwhile) */
export class IconAtlas {
  readonly names: string[]; readonly size: number; cols: number; rows: number;
  private images: Record<string, IconImage>; private decoded = new Map<string, CanvasImageSource | ((g: OffscreenCanvasRenderingContext2D, size: number) => void)>();
  private loading: Promise<void> | null = null; private textures = new WeakMap<Graphics, { tex: GTexture; version: number; names: number }>();
  private loader: Loader | null = null;
  /** each picture's own pixels (w, h) and the share of its cell it fills (centred) */
  private dims = new Map<string, [number, number]>(); private rects = new Map<string, [number, number]>();
  /** a picture that could not be loaded (it draws nothing) */
  failed: string[] = [];
  /** bumped when a picture is added or comes in: the texture is made again, its users write their items again */
  version = 0;
  constructor(images: Record<string, IconImage>, o: { size?: number } = {}) {
    this.names = Object.keys(images);
    if (!this.names.length) throw new AslnutError('E-DATA-001', 'icons: give at least one picture', { fix: "icons({ car: '/img/car.png' })" });
    this.images = { ...images }; this.size = Math.max(8, Math.min(256, Math.round(o.size ?? 64)));
    this.cols = 1; this.rows = 1; this.layout();
  }
  private layout(): void { this.cols = Math.min(this.names.length, Math.max(1, Math.floor(2048 / this.size))); this.rows = Math.ceil(this.names.length / this.cols); }
  /** a picture's cell (-1: not in the atlas) */
  index(name: string): number { return this.names.indexOf(name); }
  /** a picture's own size in pixels (null: not in yet; a drawing of yours: the cell's) */
  pixels(name: string): [number, number] | null { return this.dims.get(name) ?? null; }
  /** the share of its cell a picture fills, across and down (its shape kept, centred) */
  rect(name: string): [number, number] { return this.rects.get(name) ?? [1, 1]; }
  /** in the texture now: the picture is decoded and drawn into the texture its users draw from */
  has(name: string, g?: Graphics): boolean { const k = this.index(name); if (k < 0 || !this.decoded.has(name)) return false; const t = g && this.textures.get(g); return !g || !t || k < t.names; }
  /** add a picture (a URL through the world's loader, an image, a canvas, your drawing); a name already there is kept */
  add(name: string, image: IconImage): this {
    if (this.images[name] !== undefined) return this;
    this.images[name] = image; this.names.push(name); this.layout(); this.version++;
    // (a picture given as it is: in at once; a URL: once the loader has it, or when the atlas is first loaded)
    if (this.loader || typeof image !== 'string') void this.decode(name, this.loader!).then(() => { this.version++; this.onChange?.(); });
    return this;
  }
  /** told when a picture added later is in (an icon layer asks for a frame) */
  onChange: (() => void) | null = null;
  private async decode(n: string, loader: Loader): Promise<void> {
    const im = this.images[n]!;
    if (typeof im !== 'string') { this.decoded.set(n, im as CanvasImageSource); this.measure(n, im); return; }
    try {
      const bytes = await loader.get<ArrayBuffer>(im, { kind: 'bytes' });
      if (!bytes) throw new Error(`nothing at ${im}`);
      const bm = await createImageBitmap(new Blob([bytes]));
      this.decoded.set(n, bm); this.measure(n, bm);
    } catch (e) { this.failed.push(`${n}: ${(e as Error).message}`); }
  }
  private measure(n: string, im: unknown): void {
    if (typeof im === 'function') { this.dims.set(n, [this.size, this.size]); this.rects.set(n, [1, 1]); return; }
    const S = this.size, pad = 1, w = (im as { width: number }).width || S, h = (im as { height: number }).height || S, k = Math.min((S - 2 * pad) / w, (S - 2 * pad) / h);
    this.dims.set(n, [w, h]); this.rects.set(n, [(w * k) / S, (h * k) / S]);
  }
  /** decode the pictures given by URL (once, through the loader: cached and offline as everything else) */
  load(loader: Loader): Promise<void> {
    this.loader ??= loader;
    this.loading ??= Promise.all(this.names.map((n) => this.decode(n, loader))).then(() => { this.version++; });
    return this.loading;
  }
  get ready(): boolean { return this.decoded.size + this.failed.length >= this.names.length; }
  /** its texture on this graphics (drawn once, colours times alpha; made again when a picture added later is in: the
   *  one before is drawn meanwhile); null until its first pictures are in */
  texture(g: Graphics): GTexture | null {
    const had = this.textures.get(g);
    if (had && (had.version === this.version || !this.ready)) return had.tex;
    if (!this.ready || typeof OffscreenCanvas === 'undefined') return had?.tex ?? null;
    const S = this.size, W = this.cols * S, H = this.rows * S, c = new OffscreenCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return had?.tex ?? null;
    this.names.forEach((n, k) => {
      const im = this.decoded.get(n); if (!im) return;
      const cx = (k % this.cols) * S, cy = Math.floor(k / this.cols) * S;
      x.save(); x.beginPath(); x.rect(cx, cy, S, S); x.clip();
      if (typeof im === 'function') { x.translate(cx, cy); im(x, S); }
      else {
        const r = this.rect(n), w = r[0] * S, h = r[1] * S;
        x.drawImage(im, cx + (S - w) / 2, cy + (S - h) / 2, w, h);
      }
      x.restore();
    });
    const px = x.getImageData(0, 0, W, H).data, out = new Uint8Array(px.length);
    for (let i = 0; i < px.length; i += 4) { const a = px[i + 3]! / 255; out[i] = Math.round(px[i]! * a); out[i + 1] = Math.round(px[i + 1]! * a); out[i + 2] = Math.round(px[i + 2]! * a); out[i + 3] = px[i + 3]!; }
    const t = g.texture({ label: 'icons', width: W, height: H, format: 'rgba8', filter: 'linear' }); t.write(out);
    had?.tex.destroy();
    this.textures.set(g, { tex: t, version: this.version, names: this.names.length });
    return t;
  }
}
/** the app's own pictures in one atlas: icons({ name: url | image | canvas | (g, size) => draw }, { size: 64 }) */
export const icons = (images: Record<string, IconImage>, o?: { size?: number }) => new IconAtlas(images, o);

// ── the mark ─────────────────────────────────────────────────────────────────────────────────────────────────────
export interface IconProps<D = Thing> extends ElementProps, Omit<PlacementOptions<D>, 'heading'> {
  /** what it is placed on: a set (its things, by its id or itself), a layer or an instance set (its features), a
   *  source or an array */
  of: PlacedOn<D>;
  icons: IconAtlas;
  /** each item's picture: its name in the atlas (one for all, or your function of it; unknown: none drawn) */
  icon: string | ((d: D) => string | null | undefined);
  /** CSS px across (default 24), or `[width, height]` (0 for one of them: by the picture's shape; [0, 0]: the
   *  picture's own pixels), or `{ m, min, max }`: metres kept within a range of CSS px (core › render › drawing ›
   *  size); one for all or each item's own */
  size?: SizeOf<number | readonly [number, number] | ((d: D) => number | readonly [number, number])>;
  /** the point of the picture that sits on the place: shares across from its left and down from its top (default
   *  [.5, .5], its middle; [.5, 1]: a pin's tip at the bottom); one for all or each item's own */
  anchor?: readonly [number, number] | ((d: D) => readonly [number, number]);
  /** each item's own order: higher drawn over lower (the items' own order between equals; core › encoding › layers ›
   *  stack) */
  feature?: { order?: (d: D) => number };
  /** its tint: the picture's colours times it (default white: as drawn) */
  color?: Color | ((d: D) => Color);
  /** turned by its heading as the screen sees it: true (a set's thing along its path; a feature by `heading`) */
  heading?: boolean | ((d: D) => number);
  tooltip?: (d: D, s: State) => string | null | undefined;
  onTap?: (f: Picked<D>, s: State) => void;
  onHover?: (f: Picked<D> | null, s: State) => void;
  select?: 'tap' | 'toggle' | false;
  pickable?: boolean;
}
const UFLOATS = 16;
/** texels an item takes in its items texture */
const ITEM = 3;

export class Icon<D = Thing> extends Element<IconProps<D>> {
  readonly kind = 'point' as const;
  private on: Placement<D>; private g: Graphics | null = null;
  private prog: Program | null = null; private pick: Program | null = null; private progKey = ''; private ok = false;
  private ubuf: GBuffer | null = null; private u = new Float32Array(UFLOATS); private quad: GBuffer | null = null;
  private items: GTexture | null = null; private itemsCap = 0; private itemsSeen = -1;
  constructor(p: IconProps<D>) {
    // (over the points, a set's dots among them: an icon placed on a set's things is drawn after the set, which writes
    // their track this frame; under the labels)
    super(p.order === undefined ? { ...p, order: 5.5 } : p);
    if (!(p.icons instanceof IconAtlas)) throw new AslnutError('E-DATA-001', `icon '${this.id}' needs its atlas: icons({ … })`, { where: this.id, fix: "icon({ of, icons: icons({ car: '/img/car.png' }), icon: 'car' })" });
    const h = p.heading;
    this.on = new Placement<D>(p.of, { at: p.at, lift: p.lift, heading: typeof h === 'function' ? h : undefined });
  }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    this.g = ctx.graphics;
    this.on.attach(ctx, () => { this.itemsSeen = -1; (ctx.world as { invalidate?: () => void }).invalidate?.(); });
    if (this.g) { this.ubuf = this.g.buffer('uniform', UFLOATS * 4, `${this.id} icon`); this.quad = this.g.buffer('index', Uint32Array.from([0, 1, 2, 2, 1, 3]), `${this.id} quad`); }
    const wake = () => (ctx.world as { invalidate?: () => void }).invalidate?.();
    this.props.icons.onChange = wake;
    void this.props.icons.load(ctx.loader).then(wake);
  }
  override setProps(given: Partial<Leveled<IconProps<D>>>): this { const p = given as Partial<IconProps<D>>; super.setProps(p); if ('icon' in p || 'size' in p || 'color' in p || 'anchor' in p || 'feature' in p) this.itemsSeen = -1; if ('heading' in p) this.progKey = ''; return this; }
  /** each item's cell, size (across, down), its index; its tint; its anchor and the share of its cell its picture fills
   *  (3 texels), written when the items change or a picture comes in */
  private itemsUpload(): void {
    const n = this.on.items.length, rows = Math.max(1, Math.ceil((ITEM * n) / 4096)), p = this.props, atlas = p.icons, z = sizeValue(p.size), g = this.g!;
    if (!this.items || rows > this.itemsCap) { this.items?.destroy(); this.itemsCap = Math.max(rows, this.itemsCap * 2 || 1); this.items = g.texture({ label: `${this.id} items`, width: 4096, height: this.itemsCap, format: 'rgba32f', filter: 'nearest' }); }
    const d = new Float32Array(rows * 4096 * 4), fixed = typeof p.anchor === 'function' ? null : p.anchor ?? [0.5, 0.5];
    // (drawn in their own order: an instance's slot holds its item, lower first, the items' order between equals)
    const fo = p.feature?.order, items = this.on.items;
    const seq = fo ? (() => { const o = items.map((it) => Number(fo(it)) || 0), q = items.map((_, i) => i); q.sort((a, b) => o[a]! - o[b]! || a - b); return q; })() : null;
    (seq ?? items).forEach((x, slot) => {
      const i = seq ? (x as number) : slot, it = items[i]!;
      const name = typeof p.icon === 'function' ? p.icon(it) : p.icon, k = name && atlas.has(name, g) ? atlas.index(name) : -1, c = rgba(typeof p.color === 'function' ? p.color(it) : p.color ?? '#ffffff');
      const zv = typeof z === 'function' ? z(it) : z ?? 24, r = name ? atlas.rect(name) : [1, 1] as [number, number];
      let w = 24, h = 24;
      if (Array.isArray(zv)) {
        [w, h] = [Number(zv[0]) || 0, Number(zv[1]) || 0];
        // (0 for one side: by the picture's shape; both: its own pixels)
        if (w <= 0 && h <= 0) { const px = name ? atlas.pixels(name) : null; [w, h] = px ?? [24, 24]; }
        else if (w <= 0) w = (h * r[0]) / Math.max(1e-6, r[1]);
        else if (h <= 0) h = (w * r[1]) / Math.max(1e-6, r[0]);
      } else { w = h = Number(zv) || 0; }
      const an = fixed ?? (p.anchor as (d: D) => readonly [number, number])(it);
      // (a square size draws the picture fitted in its square, its shape kept, as before; two sides: stretched to them)
      const sq = !Array.isArray(zv);
      d.set([k, w, h, i, c[0], c[1], c[2], c[3], an[0] ?? 0.5, an[1] ?? 0.5, sq ? 1 : r[0], sq ? 1 : r[1]], slot * ITEM * 4);
    });
    this.items.write(d, { x: 0, y: 0, width: 4096, height: rows });
    this.itemsSeen = this.on.version; this.atlasSeen = atlas.version;
  }
  private atlasSeen = -1;
  private programs(ctx: FrameContext): void {
    const follow = this.on.set ? this.on.track(ctx)?.variant ?? null : null;
    if (this.on.set && !follow) return;
    const key = JSON.stringify(follow);
    if (key === this.progKey) return;
    this.progKey = key; this.prog?.destroy(); this.pick?.destroy(); this.pick = null; this.ok = false;
    const set = (names: readonly string[]) => names.map((name) => ({ name, kind: '2d' as const, sample: 'unfilterable' as const }));
    const desc: ProgramDesc = {
      label: `icon ${this.id}`, wgsl: iconWGSL(follow), glsl: iconGLSL(follow), blocks: follow ? ['Frame', 'S', 'U'] : ['Frame', 'U'],
      textures: [...(follow ? set(SET_TEXTURES) : set(['places'])), ...set(['items']), { name: 'atlas', kind: '2d', sample: 'float' }],
      blend: 'alpha', depth: { write: false, test: 'always' },
    };
    this.desc = desc;
    this.prog = this.g!.program(desc); this.broken = null; this.prog.ready.then(() => { this.ok = true; (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); }, (e: unknown) => { this.broken = String((e as Error)?.message ?? e); this.attached?.world.error(e); });
  }
  private desc: ProgramDesc | null = null; private broken: string | null = null;
  frame(ctx: FrameContext): DrawCall[] {
    const g = ctx.graphics, p = this.props;
    if (!this.ubuf || !this.on.frame(ctx)) return [];
    const atlas = p.icons.texture(g); if (!atlas) return [];
    this.programs(ctx); if (!this.prog || !this.ok) return [];
    if (this.itemsSeen !== this.on.version || this.atlasSeen !== p.icons.version) this.itemsUpload();
    const n = this.on.items.length; if (!n || !this.items) return [];
    const u = this.u, su = sizeUnits(p.size, `icon '${this.id}' size`);
    u.set(this.on.place(ctx, typeof p.lift === 'number' ? p.lift : 0), 0);
    u.set(su, 4);
    u.set([(p.opacity ?? 1) * this.shown * this.on.shown, p.icons.cols, p.icons.rows, p.heading ? 1 : 0], 8);
    u.set([this.pickNo, 0, 0, 0], 12);
    this.ubuf.write(u);
    const prog = this.prog, desc = this.desc!;
    return [{ program: prog, blocks: [...this.on.blocks(ctx), this.ubuf], textures: [...this.on.textures(ctx), this.items, atlas], index: this.quad!, count: 6, instanceCount: n, pickProgram: p.pickable === false ? undefined : () => (this.pick ??= g.program({ ...desc, label: `${desc.label} pick`, blend: 'none' })) }];
  }
  override pickInfo(index: number): Omit<Picked, 'at' | 'x' | 'y'> | null {
    const it = this.on.items[index]; if (it === undefined) return null;
    const set = this.on.set;
    if (set) { const pk = set.pickInfo(index); return pk ? { ...pk, element: this.id } : null; }
    const f = it as unknown as { id?: string | number; props?: Record<string, unknown> };
    return { element: this.id, id: f.id ?? index, props: f.props ?? {}, d: it, index };
  }
  override status(): ElementStatus {
    const st = super.status();
    if (!this.props.icons.ready) st.pending.push(`${this.id}: its pictures loading`);
    if (this.on.busy) st.pending.push(`${this.id}: reading the ground under its places`);
    if (this.broken) st.failed.push({ what: `${this.id} program`, error: this.broken });
    else if (this.prog && !this.ok) st.pending.push(`${this.id}: its program building`);
    st.ready = !st.pending.length;
    return st;
  }
  override wantsFrames(_s: State): number { return this.on.busy ? Infinity : 0; }
  override readouts() { return { count: () => this.on.items.length }; }
  override detach(): void { this.on.detach(); this.prog?.destroy(); this.pick?.destroy(); this.prog = this.pick = null; this.progKey = ''; this.ubuf?.destroy(); this.quad?.destroy(); this.items?.destroy(); this.ubuf = this.quad = null; this.items = null; this.itemsCap = 0; this.itemsSeen = -1; super.detach(); }
}
/** pictures of the app's own at the places of the things they are placed on: icon({ of, icons, icon }) */
export function icon<D = Thing>(p: Leveled<IconProps<D>>): Icon<D> { return new Icon<D>(p as IconProps<D>); }
