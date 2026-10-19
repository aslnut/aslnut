// core › data › sources › raster: pictures of data, painted into the ground's tiles in their layers' order (a solar
// map, night lights, a hazard zone grid). The same small interface as a body's imagery: draw(g, tile, ctx) paints a
// 256 px tile. Named factories with defaults, your tiles, your function:
//   raster.xyz('https://…/{z}/{x}/{y}.png')                      picture tiles
//   raster.wms('https://…/wms', { layers: 'VIIRS' })              an OGC web map service, painted into the ground
//   raster.wms(url, { layers: 'ns:zones', single: true })         the same as one picture of the view (asked again for
//                                                                 new ground), drawn on the chip as a mark of its own:
//                                                                 stacked among the vector layers in any order
//   raster.wms.capabilities(url) · raster.wms.legend(url, layer) · raster.wms.info(url, { layers, lon, lat })
//   raster.view({ url: (box, width, height) => '…' })              your picture of the view (an export endpoint)
//   raster.field({ value: (lon, lat) => ghi(lon, lat), ramp: 'inferno', domain: [3, 7] })   your function, coloured
//   raster.custom({ draw: (g, tile) => { … ; return true } })     your own painting
//   raster.image({ url: '/canopy.png', bounds: [w, s, e, n] })    one picture over a box, drawn on the chip as a mark of
//                                                                 its own (its opacity a uniform, stacked with the
//                                                                 other layers, draped as an area is)
import type { Loader, Priority } from '../loading/loader.ts';
import { OPEN, type Terms } from '../rights.ts';
import { AslnutError } from '../../world/errors.ts';
import type { State } from '../../world/state.ts';
import type { When } from '../../observation/presence.ts';
import { tileBBox, tilePoint, type BBox } from '../../space/geo.ts';
import { ramp as rampOf, type Ramp } from '../../render/style/ramp.ts';
import { normalize, type Feature } from '../features.ts';
import { proxied, serviceText, withParams, wmsCapabilities, type ServiceOptions, type WMSCapabilities } from './ogc.ts';

export type Ctx2D = OffscreenCanvasRenderingContext2D;
export interface RasterTile { z: number; x: number; y: number }
export interface RasterContext { loader: Loader; priority: Priority; prefetch: boolean }
export type RasterBlend = 'normal' | 'multiply' | 'screen' | 'add';
/** what the ground paints (the same shape as a body's imagery) */
export interface RasterSource {
  readonly kind: 'imagery';
  id: string; attribution: string; terms: Terms; when?: When; where?: BBox;
  minZoom: number; maxZoom: number; opacity: number; blend: RasterBlend;
  /** bumped when its look changes: tiles drawn before are drawn again */
  version: number;
  draw(g: Ctx2D, tile: RasterTile, ctx: RasterContext): Promise<boolean>;
  urlFor?(tile: RasterTile): string | null;
}
export interface RasterSourceOptions { id?: string; attribution?: string; terms?: Partial<Terms>; minZoom?: number; maxZoom?: number; where?: BBox }
/** picture tiles at a URL, as web maps write them */
export interface XYZOptions extends RasterSourceOptions {
  /** the hosts `{s}` stands for: letters ('abc') or names; each tile asks one, spread by its x and y (default a, b, c) */
  subdomains?: string | readonly string[];
  /** the service's tiles' size in pixels (default 256; 512: each covers what four 256 px tiles of the next level do) */
  tileSize?: number;
  /** added to the zoom written in the URL (default 0; -1 for 512 px tiles counted from level 0) */
  zoomOffset?: number;
  /** a picture for a tile that fails to load (drawn over the whole tile) */
  errorUrl?: string;
}
/** one picture over a box [w, s, e, n] (plain lon/lat, north up): a URL, or a picture you made (a canvas, a bitmap) */
export interface ImageSource {
  readonly kind: 'image';
  id: string; attribution: string; bounds: BBox;
  url?: string; image?: ImageBitmap | OffscreenCanvas | HTMLCanvasElement;
}
/** a picture of the view, asked again when the view reaches new ground or comes much closer: its URL for a box
 *  [w, s, e, n] (longitude / latitude, north up: the picture's pixels even in degrees) and a size in pixels. A raster
 *  layer draws it on the chip as a mark of its own (an image raster) */
export interface ViewSource {
  readonly kind: 'view';
  id: string; attribution: string;
  url(box: BBox, width: number, height: number): string;
  /** the picture's largest side, pixels (default 2048; the lite profile, a phone's, holds it to 1024: 4 MB a picture) */
  maxSize: number;
  /** picture pixels per CSS pixel at the view's centre (default 1) */
  scale: number;
  /** its legend's picture (a layer list shows it) */
  legend?: string;
  /** sent with each request (headers) */
  init?: RequestInit;
  /** a WMS's: its URL and layers (what a tap can ask GetFeatureInfo of) */
  wms?: { url: string; layers: string; version: string };
}
export interface ViewSourceOptions extends ServiceOptions { id?: string; attribution?: string; maxSize?: number; scale?: number; legend?: string }
/** a WMS layer (or layers, comma-separated): its options */
export interface WMSOptions extends RasterSourceOptions, ServiceOptions {
  layers: string; styles?: string; format?: string; version?: string; transparent?: boolean; params?: Record<string, string>;
  /** one picture of the view instead of tiles (drawn on the chip as a mark: stacked among vector layers, its opacity a
   *  uniform); asked again for new ground */
  single?: boolean;
  /** single: the picture's largest side (default 2048) and its pixels per CSS pixel (default 1) */
  maxSize?: number; scale?: number;
}
let seq = 0;
const base = (o: RasterSourceOptions, id: string): Omit<RasterSource, 'draw'> => ({ kind: 'imagery', id: o.id ?? `${id}-${++seq}`, attribution: o.attribution ?? '', terms: { ...OPEN, ...o.terms }, where: o.where, minZoom: o.minZoom ?? 0, maxZoom: o.maxZoom ?? 22, opacity: 1, blend: 'normal', version: 0 });
const T = 256;

export const raster = {
  /** picture tiles from a {z}/{x}/{y} URL, or your function of a tile (past its last level: the last level's piece,
   *  scaled up). Tile URLs as other web maps write them: `{s}` spread over `subdomains`, `{-y}` counted from the south
   *  (TMS), tiles of 512 px (`tileSize`: one covers four of the next level's 256 px), the zoom in the URL moved by
   *  `zoomOffset`, a picture for a tile that fails (`errorUrl`) */
  xyz(url: string | ((z: number, x: number, y: number) => string), o: XYZOptions = {}): RasterSource {
    if (typeof url !== 'function' && (typeof url !== 'string' || !/\{z\}/.test(url))) throw new AslnutError('E-DATA-001', `raster.xyz needs a URL with {z}, {x}, {y} (got ${JSON.stringify(url)})`, { fix: "raster.xyz('https://…/{z}/{x}/{y}.png') or raster.xyz((z, x, y) => `https://…/${z}/${x}/${y}.png`)" });
    const size = o.tileSize ?? T, k = size / T, off = o.zoomOffset ?? 0;
    if (!(Number.isInteger(Math.log2(k)) && k >= 1)) throw new AslnutError('E-DATA-001', `raster.xyz: tileSize ${size} is not 256 times a power of two`, { fix: 'tileSize: 256 or 512' });
    if (!Number.isInteger(off)) throw new AslnutError('E-DATA-001', `raster.xyz: zoomOffset ${off} is not a whole number`, { fix: 'zoomOffset: -1 for 512 px tiles counted from level 0, else 0' });
    const subs = typeof o.subdomains === 'string' ? o.subdomains.split('') : o.subdomains ?? ['a', 'b', 'c'];
    const s = base(o, 'xyz'), max = o.maxZoom ?? 18;
    /** the service's tile under a 256 px tile: its zoom in the URL, its x and y, and where the 256 px tile is in it */
    const tileOf = (t: RasterTile) => {
      const zn = Math.min(t.z, max), per = 2 ** (t.z - zn) * k, tx = Math.floor(t.x / per), ty = Math.floor(t.y / per);
      return { z: zn + off, x: tx, y: ty, n: Math.max(1, 2 ** zn / k), per, ix: t.x - tx * per, iy: t.y - ty * per };
    };
    const urlOf = (q: ReturnType<typeof tileOf>) => typeof url === 'function' ? url(q.z, q.x, q.y)
      : url.replace('{s}', subs.length ? subs[Math.abs(q.x + q.y) % subs.length]! : '').replace('{z}', String(q.z)).replace('{x}', String(q.x)).replace('{y}', String(q.y)).replace('{-y}', String(q.n - 1 - q.y));
    return {
      ...s, maxZoom: max,
      urlFor: (t) => urlOf(tileOf(t)),
      async draw(g, t, ctx) {
        if (t.z < s.minZoom) return false;
        const q = tileOf(t), opts = { kind: 'image' as const, priority: ctx.priority, prefetch: ctx.prefetch };
        let im: ImageBitmap | null = null;
        try { im = await ctx.loader.get<ImageBitmap>(urlOf(q), opts); } catch (e) { if (!o.errorUrl) throw e; }
        if (!im && o.errorUrl) { const e = await ctx.loader.get<ImageBitmap>(o.errorUrl, opts); if (e) { g.drawImage(e, 0, 0, T, T); return true; } }
        if (!im) return false;
        const sz = im.width / q.per; g.drawImage(im, q.ix * sz, q.iy * sz, sz, sz, 0, 0, T, T);
        return true;
      },
    };
  },
  /** an OGC WMS: GetMap per tile (EPSG:3857), painted into the ground; { single: true }: one picture of the view, a
   *  mark of its own. wms.capabilities, wms.legend and wms.info read the service */
  wms: Object.assign(wmsSource, { capabilities: wmsCaps, legend: wmsLegend, info: wmsInfo }),
  /** your picture of the view: its URL for a box and a size (an export endpoint, your own server) */
  view(o: ViewSourceOptions & { url: (box: BBox, width: number, height: number) => string }): ViewSource {
    if (typeof o?.url !== 'function') throw new AslnutError('E-DATA-001', 'raster.view needs url: (box, width, height) => string', { fix: 'raster.view({ url: ([w, s, e, n], width, height) => `https://…/export?bbox=${w},${s},${e},${n}&size=${width},${height}` })' });
    return { kind: 'view', id: o.id ?? `view-${++seq}`, attribution: o.attribution ?? '', url: (b, w, h) => proxied(o.url(b, w, h), o.proxy), maxSize: o.maxSize ?? 2048, scale: o.scale ?? 1, legend: o.legend, init: o.headers ? { headers: o.headers } : undefined };
  },
  /** your function of a place, coloured by a ramp: value (lon, lat) → number (null: nothing there) */
  field(o: RasterSourceOptions & { value: (lon: number, lat: number) => number | null; ramp?: Ramp; domain?: [number, number]; /** px per cell (default 4) */ cell?: number; /** 0..1 */ alpha?: number }): RasterSource {
    if (typeof o?.value !== 'function') throw new AslnutError('E-DATA-001', 'raster.field needs value: (lon, lat) => number', { fix: "raster.field({ value: (lon, lat) => …, ramp: 'inferno', domain: [0, 1] })" });
    const f = rampOf(o.ramp ?? 'viridis'), [lo, hi] = o.domain ?? [0, 1], c = Math.max(1, Math.min(64, o.cell ?? 4)), a = o.alpha ?? 1;
    return {
      ...base(o, 'field'),
      async draw(g, t) {
        let any = false;
        for (let y = 0; y < T; y += c) for (let x = 0; x < T; x += c) {
          const [lon, lat] = tilePoint(t.z, t.x, t.y, (x + c / 2) / T, (y + c / 2) / T), v = o.value(lon, lat);
          if (v === null || !Number.isFinite(v)) continue;
          g.fillStyle = f(Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)))); g.globalAlpha = a; g.fillRect(x, y, c, c); any = true;
        }
        g.globalAlpha = 1;
        return any;
      },
    };
  },
  /** one picture over a box (your model's output, a canopy or heat map): drawn on the chip as a mark of its own, not
   *  painted into the ground's tiles: its opacity is a uniform (one frame), it stacks among the other layers in any
   *  order, and it sits with the twin as an area does (drape) */
  image(o: { url?: string; image?: ImageBitmap | OffscreenCanvas | HTMLCanvasElement; bounds: BBox; id?: string; attribution?: string }): ImageSource {
    const b = o?.bounds;
    if (!Array.isArray(b) || b.length !== 4 || !b.every(Number.isFinite) || !(b[2] > b[0]) || !(b[3] > b[1])) throw new AslnutError('E-DATA-001', `raster.image needs bounds [w, s, e, n] (got ${JSON.stringify(b)})`, { fix: "raster.image({ url: '/heat.png', bounds: [145.09, -37.95, 145.16, -37.9] })" });
    if (!o.url && !o.image) throw new AslnutError('E-DATA-001', 'raster.image needs a url or an image', { fix: "raster.image({ url: '/heat.png', bounds })" });
    return { kind: 'image', id: o.id ?? `image-${++seq}`, attribution: o.attribution ?? '', bounds: [b[0], b[1], b[2], b[3]], url: o.url, image: o.image };
  },
  /** your own painting of a 256 px tile (return false: nothing here) */
  custom(o: RasterSourceOptions & { draw: (g: Ctx2D, tile: RasterTile, ctx: RasterContext) => boolean | Promise<boolean> }): RasterSource {
    if (typeof o?.draw !== 'function') throw new AslnutError('E-DATA-001', 'raster.custom needs draw(g, tile)', { fix: 'raster.custom({ draw: (g, tile) => { …; return true } })' });
    return { ...base(o, 'custom'), draw: async (g, t, ctx) => !!(await o.draw(g, t, ctx)) };
  },
};
const R3857 = 20037508.342789244;
function wmsSource(url: string, o: WMSOptions & { single: true }): ViewSource;
function wmsSource(url: string, o: WMSOptions): RasterSource;
function wmsSource(url: string, o: WMSOptions): RasterSource | ViewSource {
  if (!o?.layers) throw new AslnutError('E-DATA-001', 'raster.wms needs { layers }', { fix: "raster.wms('https://…/wms', { layers: 'VIIRS_Night' }) (raster.wms.capabilities(url) lists them)" });
  const v = o.version ?? '1.3.0', common = { SERVICE: 'WMS', REQUEST: 'GetMap', VERSION: v, LAYERS: o.layers, STYLES: o.styles ?? '', FORMAT: o.format ?? 'image/png', TRANSPARENT: String(o.transparent ?? true), ...o.params };
  if (o.single) {
    // longitude / latitude, north up (CRS:84 in 1.3.0: longitude first, as EPSG:4326 is in 1.1.1)
    const src = raster.view({ ...o, id: o.id ?? `wms-${++seq}`, legend: wmsLegend(url, o.layers.split(',')[0]!, { style: o.styles, version: v, proxy: o.proxy }), url: ([w, s, e, n], width, height) => withParams(url, { ...common, ...(v.startsWith('1.3') ? { CRS: 'CRS:84' } : { SRS: 'EPSG:4326' }), BBOX: `${w},${s},${e},${n}`, WIDTH: width, HEIGHT: height }) });
    return { ...src, wms: { url, layers: o.layers, version: v } };
  }
  const urlFor = (t: RasterTile) => {
    const k = (2 * R3857) / 2 ** t.z, x0 = -R3857 + t.x * k, y1 = R3857 - t.y * k;
    return proxied(withParams(url, { ...common, WIDTH: 256, HEIGHT: 256, [v.startsWith('1.3') ? 'CRS' : 'SRS']: 'EPSG:3857', BBOX: `${x0},${y1 - k},${x0 + k},${y1}` }), o.proxy);
  };
  const init = o.headers ? { headers: o.headers } : undefined;
  return { ...base(o, 'wms'), urlFor, async draw(g, t, ctx) { const im = await ctx.loader.get<ImageBitmap>(urlFor(t), { kind: 'image', priority: ctx.priority, prefetch: ctx.prefetch, init }); if (!im) return false; g.drawImage(im, 0, 0, T, T); return true; } };
}
/** a WMS's layers, formats and what it answers (1.3.0, else 1.1.1) */
function wmsCaps(url: string, o?: ServiceOptions & { version?: '1.3.0' | '1.1.1' }): Promise<WMSCapabilities> { return wmsCapabilities(url, o); }
/** a WMS layer's legend picture (GetLegendGraphic) */
function wmsLegend(url: string, layer: string, o: { style?: string; version?: string; format?: string; proxy?: ServiceOptions['proxy'] } = {}): string {
  return proxied(withParams(url, { SERVICE: 'WMS', REQUEST: 'GetLegendGraphic', VERSION: o.version ?? '1.3.0', FORMAT: o.format ?? 'image/png', LAYER: layer, STYLE: o.style || undefined }), o.proxy);
}
/** what a WMS says is at a place (GetFeatureInfo, as GeoJSON): the features there, each with its layer's name when
 *  the service gives it. `metres`: a picture pixel's size there (default from `zoom`, else 1 m); `count` at most */
async function wmsInfo(url: string, q: { layers: string; lon: number; lat: number; zoom?: number; metres?: number; count?: number; version?: '1.3.0' | '1.1.1'; format?: string }, o: ServiceOptions = {}): Promise<(Feature & { layer: string | null })[]> {
  const v = q.version ?? '1.3.0', m = q.metres ?? (q.zoom !== undefined ? (156543.03 * Math.cos((q.lat * Math.PI) / 180)) / 2 ** q.zoom : 1);
  const dy = (m * 50) / 110574, dx = (m * 50) / (111320 * Math.max(0.05, Math.cos((q.lat * Math.PI) / 180)));
  const box = `${q.lon - dx},${q.lat - dy},${q.lon + dx},${q.lat + dy}`;
  const u = withParams(url, { SERVICE: 'WMS', REQUEST: 'GetFeatureInfo', VERSION: v, LAYERS: q.layers, QUERY_LAYERS: q.layers, STYLES: '', ...(v === '1.3.0' ? { CRS: 'CRS:84', I: 50, J: 50 } : { SRS: 'EPSG:4326', X: 50, Y: 50 }), BBOX: box, WIDTH: 101, HEIGHT: 101, INFO_FORMAT: q.format ?? 'application/json', FEATURE_COUNT: q.count ?? 5 });
  const t = await serviceText(u, o, 'wms');
  let j: unknown; try { j = JSON.parse(t); } catch { throw new AslnutError('E-DATA-002', `the WMS did not answer GetFeatureInfo as GeoJSON (${t.slice(0, 60).replace(/\s+/g, ' ')}…)`, { where: url, fix: "ask with its own format name (format: 'application/geo+json' …): raster.wms.capabilities(url).infoFormats lists them" }); }
  const raw = ((j as { features?: { id?: unknown }[] }).features ?? []);
  return normalize({ type: 'FeatureCollection', features: raw }, { where: url }).map((f, i) => ({ ...f, layer: typeof raw[i]?.id === 'string' ? (raw[i]!.id as string).replace(/\.[^.]*$/, '') : null }));
}
/** the box a tile covers (for your own draw functions) */
export const rasterTileBox = (t: RasterTile): BBox => tileBBox(t.z, t.x, t.y);
export type { State };
