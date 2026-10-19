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

// ── the atlas ────────────────────────────────────────────────────────────────────────────────────────────────────
/** a picture: a URL (loaded through the world's loader), a decoded image or canvas, or your function drawing it into a
 *  square of `size` px (white shapes tint best) */
export type IconImage = string | ImageBitmap | HTMLImageElement | HTMLCanvasElement | OffscreenCanvas | ((g: OffscreenCanvasRenderingContext2D, size: number) => void);
/** the app's pictures packed into one texture: a cell each (`size` px square, the picture fitted in, its shape kept) */
export class IconAtlas {
  readonly names: string[]; readonly size: number; readonly cols: number; readonly rows: number;
  private images: Record<string, IconImage>; private decoded = new Map<string, CanvasImageSource | ((g: OffscreenCanvasRenderingContext2D, size: number) => void)>();
  private loading: Promise<void> | null = null; private textures = new WeakMap<Graphics, GTexture>();
  /** a picture that could not be loaded (it draws nothing) */
  failed: string[] = [];
  constructor(images: Record<string, IconImage>, o: { size?: number } = {}) {
    this.names = Object.keys(images);
    if (!this.names.length) throw new AslnutError('E-DATA-001', 'icons: give at least one picture', { fix: "icons({ car: '/img/car.png' })" });
    this.images = images; this.size = Math.max(8, Math.min(256, Math.round(o.size ?? 64)));
    this.cols = Math.min(this.names.length, Math.max(1, Math.floor(2048 / this.size))); this.rows = Math.ceil(this.names.length / this.cols);
  }
  /** a picture's cell (-1: not in the atlas) */
  index(name: string): number { return this.names.indexOf(name); }
  /** decode the pictures given by URL (once, through the loader: cached and offline as everything else) */
  load(loader: Loader): Promise<void> {
    this.loading ??= Promise.all(this.names.map(async (n) => {
      const im = this.images[n]!;
      if (typeof im !== 'string') { this.decoded.set(n, im as CanvasImageSource); return; }
      try {
        const bytes = await loader.get<ArrayBuffer>(im, { kind: 'bytes' });
        if (!bytes) throw new Error(`nothing at ${im}`);
        this.decoded.set(n, await createImageBitmap(new Blob([bytes])));
      } catch (e) { this.failed.push(`${n}: ${(e as Error).message}`); }
    })).then(() => {});
    return this.loading;
  }
  get ready(): boolean { return this.decoded.size + this.failed.length >= this.names.length; }
  /** its texture on this graphics (drawn once, colours times alpha); null until its pictures are in */
  texture(g: Graphics): GTexture | null {
    const had = this.textures.get(g); if (had) return had;
    if (!this.ready || typeof OffscreenCanvas === 'undefined') return null;
    const S = this.size, W = this.cols * S, H = this.rows * S, c = new OffscreenCanvas(W, H), x = c.getContext('2d', { willReadFrequently: true });
    if (!x) return null;
    this.names.forEach((n, k) => {
      const im = this.decoded.get(n); if (!im) return;
      const cx = (k % this.cols) * S, cy = Math.floor(k / this.cols) * S, pad = 1;
      x.save(); x.beginPath(); x.rect(cx, cy, S, S); x.clip();
      if (typeof im === 'function') { x.translate(cx, cy); im(x, S); }
      else {
        const w = (im as { width: number }).width || S, h = (im as { height: number }).height || S, k2 = Math.min((S - 2 * pad) / w, (S - 2 * pad) / h);
        x.drawImage(im, cx + (S - w * k2) / 2, cy + (S - h * k2) / 2, w * k2, h * k2);
      }
      x.restore();
    });
    const px = x.getImageData(0, 0, W, H).data, out = new Uint8Array(px.length);
    for (let i = 0; i < px.length; i += 4) { const a = px[i + 3]! / 255; out[i] = Math.round(px[i]! * a); out[i + 1] = Math.round(px[i + 1]! * a); out[i + 2] = Math.round(px[i + 2]! * a); out[i + 3] = px[i + 3]!; }
    const t = g.texture({ label: 'icons', width: W, height: H, format: 'rgba8', filter: 'linear' }); t.write(out);
    this.textures.set(g, t);
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
  /** CSS px across (default 24), or `{ m, min, max }`: metres kept within a range of CSS px (core › render › drawing ›
   *  size); one for all or each item's own */
  size?: SizeOf<number | ((d: D) => number)>;
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
    void this.props.icons.load(ctx.loader).then(() => (ctx.world as { invalidate?: () => void }).invalidate?.());
  }
  override setProps(p: Partial<IconProps<D>>): this { super.setProps(p); if ('icon' in p || 'size' in p || 'color' in p) this.itemsSeen = -1; if ('heading' in p) this.progKey = ''; return this; }
  /** each item's cell, size and tint (2 texels), written when the items change */
  private itemsUpload(): void {
    const n = this.on.items.length, rows = Math.max(1, Math.ceil((2 * n) / 4096)), p = this.props, atlas = p.icons, z = sizeValue(p.size);
    if (!this.items || rows > this.itemsCap) { this.items?.destroy(); this.itemsCap = Math.max(rows, this.itemsCap * 2 || 1); this.items = this.g!.texture({ label: `${this.id} items`, width: 4096, height: this.itemsCap, format: 'rgba32f', filter: 'nearest' }); }
    const d = new Float32Array(rows * 4096 * 4);
    this.on.items.forEach((it, i) => {
      const name = typeof p.icon === 'function' ? p.icon(it) : p.icon, k = name ? atlas.index(name) : -1, c = rgba(typeof p.color === 'function' ? p.color(it) : p.color ?? '#ffffff');
      d.set([k, typeof z === 'function' ? Number(z(it)) || 0 : z ?? 24, 0, 0, c[0], c[1], c[2], c[3]], i * 8);
    });
    this.items.write(d, { x: 0, y: 0, width: 4096, height: rows });
    this.itemsSeen = this.on.version;
  }
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
    if (this.itemsSeen !== this.on.version) this.itemsUpload();
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
export function icon<D = Thing>(p: IconProps<D>): Icon<D> { return new Icon<D>(p); }
