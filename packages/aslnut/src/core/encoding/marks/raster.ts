// core › geometry › marks › raster: a picture of data painted into the ground (it drapes on the terrain by being
// part of it), in its place in the draw order among other rasters (later on top), with its opacity, blend and `when`
// (a change re-paints the tiles, crossfading). Painted rasters cannot be picked: data you want to hover is a vector
// layer; a picture over a box can be (`pickable: true`: its box answers a tap or a hover, as the feature 'picture').
//   raster({ id: 'solar', source: raster.field({ value: ghi, ramp: 'inferno', domain: [3, 7] }), opacity: .6 })
//   raster({ id: 'night', source: raster.wms('https://…/wms', { layers: 'VIIRS' }), blend: 'screen', when: s => s.time.hour >= 18 })
//   raster({ id: 'canopy', source: raster.image({ url: '/canopy.png', bounds }), opacity: .8 })   one picture over a box,
//      drawn on the chip as a mark of its own (its opacity a uniform, stacked with the other layers, draped as an area)
//   raster({ id: 'zones', source: raster.wms(url, { layers: 'ns:zones', single: true }), opacity: .6 })   one picture of
//      the view, the same kind of mark, asked again when the view reaches new ground or comes much closer
import { AslnutError } from '../../world/errors.ts';
import { Element, type AttachContext, type FrameContext, type ElementProps, type ElementStatus } from '../../world/element.ts';
import type { DrawCall, GTexture } from '../../render/graphics/interface.ts';
import { raster as sources, type ImageSource, type RasterBlend, type RasterSource, type ViewSource } from '../../data/sources/raster.ts';
import type { BBox } from '../../space/geo.ts';
import type { Feature } from '../../data/features.ts';
import type { Legend } from '../scales.ts';
import { Area, type AreaProps } from './area.ts';
import type { Leveled } from '../../observation/presence.ts';

export interface RasterProps extends ElementProps { source: RasterSource; opacity?: number; blend?: RasterBlend }
/** a picture over a box (raster.image): an area's props (drape, opacity, when, order, reveal; `pickable: true` with
 *  `onTap`, `onHover`, `tooltip`: its box answers a pick, as its feature 'picture'), and its legend for a layer list */
export interface ImageRasterProps extends Omit<AreaProps<Feature>, 'data' | 'color' | 'height' | 'value'> { source: ImageSource | ViewSource; /** what its colours mean (a layer list shows it) */ legend?: Legend }

export class Raster extends Element<RasterProps> {
  readonly kind = 'raster' as const;
  constructor(p: RasterProps) {
    super(p);
    if (!p.source || typeof p.source.draw !== 'function') throw new AslnutError('E-DATA-001', `raster '${this.id}' needs a source`, { where: this.id, fix: "raster({ source: raster.xyz('https://…/{z}/{x}/{y}.png') })" });
  }
  /** what the ground paints for it now (its opacity × how far shown, in quarters: each step re-paints) */
  painted(): RasterSource | null {
    const k = Math.round(this.shown * 4) / 4; if (k <= 0) return null;
    const s = this.props.source;
    return { ...s, id: `${this.id}:${s.id}`, opacity: (this.props.opacity ?? 1) * k, blend: this.props.blend ?? s.blend, when: undefined, draw: s.draw, urlFor: s.urlFor };
  }
  frame(): DrawCall[] { return []; }
  override attribution(): string[] { return this.props.source.attribution ? [this.props.source.attribution] : []; }
  /** its opacity re-paints the ground's tiles under it (a painted picture is part of the ground) */
  override get fades(): boolean { return true; }
}
/** one picture over a box, on the chip: a draped area (a box's triangles) whose colour is the picture's where each pixel
 *  falls, so it drapes exactly, sits with the twin as an area does (its default: DRAPE_DEFAULTS.raster), fades with a
 *  uniform and stacks in any order among the other layers. Its picture loads with the layer (a URL through the
 *  world's loader, or yours as given) into one texture */
export class ImageRaster extends Area<Feature> {
  private img: ImageSource | ViewSource;
  constructor(p: ImageRasterProps) {
    const src = p.source, box = src.kind === 'image' ? src.bounds : null;
    super({ outline: 0, pickable: false, ...p, data: box ? [boxFeature(box)] : [], color: '#ffffffff' } as unknown as AreaProps<Feature>);
    this.img = src;
  }
  protected override drapeMark(): 'raster' { return 'raster'; }
  protected override imaged(): boolean { return true; }
  private loadErr: Error | null = null; private loading = false; private ctx: AttachContext | null = null;
  // (a picture of the view: the box drawn now, the one coming, when the view last moved)
  private box: BBox | null = null; private density = 0; private next: { tex: GTexture; box: BBox } | null = null; private stillSince = -1; private asks = 0;
  /** a picture that did not come: asked again only after a while (2 s, doubling to a minute), never in a loop */
  private retryAt = 0; private retryMs = 2000;
  /** a new picture is due (the view no longer covered, or come much closer): asked once the view holds still */
  private due = false;
  /** the picture's box now and the pictures asked for (a picture of the view) */
  get picture(): { box: BBox | null; asked: number; loading: boolean } { return { box: this.box, asked: this.asks, loading: this.loading }; }
  override async attach(ctx: AttachContext): Promise<void> {
    this.ctx = ctx;
    await super.attach(ctx);
    if (!ctx.graphics || this.img.kind !== 'image') return;
    const im = this.img;
    await this.load(async () => im.image ?? (im.url ? await ctx.loader.get<ImageBitmap>(im.url, { kind: 'image', priority: 'soon' }) : null), im.url ?? 'no url', im.bounds);
  }
  /** a picture in: colours times alpha, the same on WebGPU and WebGL2 (filtered without fringes where it turns
   *  see-through; its shader divides again); a picture of the view waits for its box's geometry (the next frame) */
  private async load(get: () => Promise<ImageBitmap | OffscreenCanvas | HTMLCanvasElement | null>, what: string, box: BBox): Promise<void> {
    const ctx = this.ctx, g = ctx?.graphics; if (!ctx || !g) return;
    this.loading = true; this.asks++;
    try {
      const im = await get();
      if (!im) throw new AslnutError('E-DATA-002', `raster '${this.id}': its picture did not load (${what})`, { where: this.id, fix: 'check the url, or give raster.image({ image }) a picture' });
      if (!this.attached) return;
      const pre = typeof createImageBitmap === 'function' ? await createImageBitmap(im as ImageBitmap, { premultiplyAlpha: 'premultiply' }) : im;
      if (!this.attached) return;
      const tex = g.texture({ label: `${this.id} picture`, width: pre.width, height: pre.height, format: 'rgba8', filter: 'linear' });
      tex.writeImage(pre as ImageBitmap, { premultiplied: true });
      this.loadErr = null;
      if (this.img.kind === 'image') { this.imageTex = tex; this.box = box; }
      else { this.next?.tex.destroy(); this.next = { tex, box }; this.setProps({ data: [boxFeature(box)] } as never); }
      this.retryMs = 2000;
    } catch (e) {
      this.loadErr = e instanceof Error ? e : new Error(String(e)); ctx.world.error(e);
      this.retryAt = ctx.world.now + this.retryMs; this.retryMs = Math.min(60000, this.retryMs * 2);
    } finally { this.loading = false; (ctx.world as { invalidate?: () => void }).invalidate?.(); }
  }
  /** nothing drawn until its picture is in (its programs bind it); a picture of the view asks again when it must */
  override frame(ctx: FrameContext): DrawCall[] {
    if (this.img.kind === 'view') {
      // (the new picture and its box's geometry, drawn from the same frame)
      if (this.next) { this.imageTex?.destroy(); this.imageTex = this.next.tex; this.box = this.next.box; this.next = null; }
      this.follow(ctx, this.img);
    }
    return this.imageTex ? super.frame(ctx) : [];
  }
  /** the view's ground (its screen's corners and edges where they meet the ground; the sky left out) widened a little,
   *  and the picture's pixels for it; asked for when the view has been still a moment and is no longer covered, or has
   *  come much closer than the picture's pixels */
  private follow(ctx: FrameContext, src: ViewSource): void {
    const c = ctx.camera, now = ctx.world.now;
    if (!this.ctx || c.moving || this.target <= 0) { this.stillSince = -1; this.due = false; return; }
    if (this.stillSince < 0) this.stillSince = now;
    if (this.loading) return;
    const W = c.width, H = c.height; let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity, hits = 0;
    for (let j = 0; j <= 6; j++) for (let i = 0; i <= 4; i++) {
      const ll = c.lonLatAt((i / 4) * W, (j / 6) * H); if (!ll) continue;
      hits++; w = Math.min(w, ll[0]); e = Math.max(e, ll[0]); s = Math.min(s, ll[1]); n = Math.max(n, ll[1]);
    }
    if (!hits) return;
    const v = ctx.s.view, cos = Math.max(0.05, Math.cos((v.lat * Math.PI) / 180));
    // (a view up to the horizon: the far ground kept within a few screens of the centre)
    const far = (Math.max(W, H) * v.pixelSize * 3) / 111320;
    w = Math.max(w, v.lon - far / cos); e = Math.min(e, v.lon + far / cos); s = Math.max(s, v.lat - far); n = Math.min(n, v.lat + far);
    const need = Math.max(1e-9, src.scale / v.pixelSize);   // pixels per metre wanted at the centre
    const pw = (e - w) * 0.1, ph = (n - s) * 0.1, box: BBox = [w - pw, s - ph, e + pw, n + ph];
    const mw = (box[2] - box[0]) * 111320 * cos, mh = (box[3] - box[1]) * 110574, cap = Math.min(src.maxSize, ctx.graphics.caps.maxTex || 4096, this.ctx.profile?.quality === 'lite' ? 1024 : Infinity);
    // (as sharp as a picture of this box can be: a deep tilted view is held to the picture's largest side)
    const k = Math.min(need, cap / Math.max(mw, mh));
    if (this.box) {
      const b = this.box, inside = w >= b[0] && e <= b[2] && s >= b[1] && n <= b[3];
      // covered, and within 1.6 times as sharp as a new picture of this view would be: nothing asked
      if (inside && k <= this.density * 1.6) { this.due = false; return; }
    }
    // (one is due: the view held still a moment first, not asked again soon after a failure; the view is not
    // complete meanwhile)
    this.due = true;
    if ((this.box && now - this.stillSince < 250) || now < this.retryAt) return;
    this.due = false;
    const pxW = Math.max(16, Math.round(mw * k)), pxH = Math.max(16, Math.round(mh * k));
    this.density = k;
    const url = src.url(box, pxW, pxH), loader = this.ctx.loader;
    void this.load(() => loader.get<ImageBitmap>(url, { kind: 'image', priority: 'soon', init: src.init }), url, box);
  }
  override status(): ElementStatus {
    const st = super.status();
    if (this.loadErr) st.failed.push({ what: this.id, error: this.loadErr.message });
    else if ((this.loading || this.next || this.due) && (this.target > 0 || this.shown > 0)) { st.pending.push(this.due ? 'its picture due' : 'its picture loading'); st.ready = false; }
    return st;
  }
  override detach(): void { this.imageTex?.destroy(); this.imageTex = null; this.next?.tex.destroy(); this.next = null; this.box = null; this.ctx = null; super.detach(); }
  override attribution(): string[] { return this.img.attribution ? [this.img.attribution] : []; }
  /** its legend for a layer list: yours, else its source's picture (a WMS's GetLegendGraphic) */
  get legendImage(): string | null { return this.img.kind === 'view' ? this.img.legend ?? null : null; }
}
const boxFeature = ([w, s, e, n]: BBox): Feature => ({ id: 'picture', props: {}, geometry: { type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
/** raster(props) makes the layer (a picture over a box: an ImageRaster on the chip); raster.xyz / wms / field /
 *  custom / image make its source */
function rasterOf(p: Leveled<RasterProps>): Raster;
function rasterOf(p: Leveled<ImageRasterProps>): ImageRaster;
function rasterOf(p: Leveled<RasterProps> | Leveled<ImageRasterProps>): Raster | ImageRaster { const k = (p.source as { kind?: string })?.kind; return k === 'image' || k === 'view' ? new ImageRaster(p as ImageRasterProps) : new Raster(p as RasterProps); }
export const raster = Object.assign(rasterOf, sources);
