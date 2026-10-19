// modules › world › surface › sources: what a body's surface is made of. Two small interfaces anyone can implement:
//   Imagery   draw(g, tile, ctx) paints its part of a 256 px tile (false: nothing here)
//   Terrain   heights(tile, n, ctx) gives n × n heights in metres for a tile (null: nothing here)
// Both carry an id, an attribution, the provider's terms, and the props every element has: `when` (shown?), `where`
// (the box it covers). Lists compose: imagery is painted in order (later on top, by `opacity` and `blend`); terrain
// later items win where they cover, blended over `blend` metres at their edge.
import type { Loader, Priority } from '../../../core/data/loading/loader.ts';
import { OPEN, termsOf, type Terms } from '../../../core/data/rights.ts';
import { AslnutError } from '../../../core/world/errors.ts';
import type { When } from '../../../core/observation/presence.ts';
import { insideBy, intersects, tileBBox, tilePoint, type BBox } from '../../../core/space/geo.ts';

export const TILE = 256;
export type Ctx2D = OffscreenCanvasRenderingContext2D;
export interface Tile { z: number; x: number; y: number }
export interface SourceContext { loader: Loader; priority: Priority; /** a load ahead of need (refused where the terms forbid prefetching) */ prefetch: boolean; /** the tile's load was abandoned (the view went past it): pass it to `loader.get` */ signal?: AbortSignal }
export type Blend = 'normal' | 'multiply' | 'screen' | 'add';

interface Common { id: string; attribution: string; terms: Terms; when?: When; where?: BBox }
export interface Imagery extends Common {
  readonly kind: 'imagery';
  minZoom: number; maxZoom: number; opacity: number; blend: Blend;
  /** bumped when its look changes: tiles drawn before are redrawn */
  version: number;
  draw(g: Ctx2D, tile: Tile, ctx: SourceContext): Promise<boolean>;
  /** the decoded image a tile shows and the part of it (sx, sy, size px): the surface uploads it straight to the
   *  graphics when nothing is drawn over or under it (no canvas, no pixels through JavaScript) */
  bitmap?(tile: Tile, ctx: SourceContext): Promise<{ im: ImageBitmap; sx: number; sy: number; size: number } | null>;
  /** the tile's own image as pixels decoded in a worker, when it has one at this level (null: use bitmap / draw) */
  pixels?(tile: Tile, ctx: SourceContext): Promise<{ width: number; height: number; data: Uint8ClampedArray } | null>;
  /** covers its tiles fully (a JPEG): what is under it is never seen */
  opaque?: boolean;
  /** the URL a tile fetches (for planning what a view needs); null: none */
  urlFor?(tile: Tile): string | null;
}
export interface Terrain extends Common {
  readonly kind: 'terrain';
  maxZoom: number;
  /** metres over which it blends into what is under it at the edge of `where` */
  blend: number;
  version: number;
  heights(tile: Tile, n: number, ctx: SourceContext): Promise<Float32Array | null>;
  urlFor?(tile: Tile): string | null;
}

export interface CommonOptions { id?: string; attribution?: string; terms?: Partial<Terms>; when?: When; where?: BBox }
export function checkBBox(b: unknown, where: string): BBox | undefined {
  if (b === undefined) return undefined;
  if (!Array.isArray(b) || b.length !== 4 || b.some((x) => typeof x !== 'number' || !Number.isFinite(x)) || b[0] >= b[2] || b[1] >= b[3]) {
    throw new AslnutError('E-DATA-001', `'where' must be a box [west, south, east, north] in degrees (got ${JSON.stringify(b)})`, { where, fix: 'write [107.4, -7.1, 107.85, -6.75]' });
  }
  return b as BBox;
}
export const covers = (s: { where?: BBox }, t: Tile) => !s.where || intersects(s.where, tileBBox(t.z, t.x, t.y));

// ── XYZ raster imagery ───────────────────────────────────────────────────────────────────────────────────────────
export interface XYZOptions extends CommonOptions { url: string; minZoom?: number; maxZoom?: number; opacity?: number; blend?: Blend; subdomains?: string[]; /** covers its tiles fully (default: a .jpg URL) */ opaque?: boolean }
export const COMPOSITE: Record<Blend, GlobalCompositeOperation> = { normal: 'source-over', multiply: 'multiply', screen: 'screen', add: 'lighter' };
export function xyzUrl(tpl: string, t: Tile, subdomains?: string[]): string {
  const s = subdomains?.length ? subdomains[(t.x + t.y) % subdomains.length]! : '';
  return tpl.replace('{z}', String(t.z)).replace('{x}', String(t.x)).replace('{y}', String(t.y)).replace('{-y}', String(2 ** t.z - 1 - t.y)).replace('{s}', s);
}
export function xyzImagery(o: XYZOptions & { terms?: Partial<Terms> }, base: Readonly<Terms> = OPEN): Imagery {
  if (typeof o.url !== 'string' || !/\{z\}/.test(o.url) || !/\{x\}/.test(o.url) || !/\{-?y\}/.test(o.url)) throw new AslnutError('E-DATA-001', `an imagery url needs {z}, {x} and {y} (got ${JSON.stringify(o.url)})`, { where: o.id ?? 'imagery', fix: "write 'https://…/{z}/{x}/{y}.png'" });
  const minZoom = o.minZoom ?? 0, maxZoom = o.maxZoom ?? 19;
  const urlOf = (t: Tile) => xyzUrl(o.url, t, o.subdomains);
  const img: Imagery = {
    kind: 'imagery', id: o.id ?? o.url, attribution: o.attribution ?? '', terms: termsOf(o.terms, base), when: o.when, where: checkBBox(o.where, o.id ?? o.url),
    minZoom, maxZoom, opacity: o.opacity ?? 1, blend: o.blend ?? 'normal', version: 0,
    urlFor(t) { if (t.z < minZoom) return null; const zz = Math.min(t.z, maxZoom), k = 2 ** (t.z - zz); return urlOf({ z: zz, x: Math.floor(t.x / k), y: Math.floor(t.y / k) }); },
    opaque: o.opaque ?? /\.jpe?g(\?|$)/i.test(o.url),
    async bitmap(t, ctx) {
      if (t.z < minZoom) return null;
      // past its last level: a piece of the last tile, scaled up; a tile missing at a level (coverage varies): the
      // nearest level above that has it
      const zz = Math.min(t.z, maxZoom), k = 2 ** (t.z - zz), px = Math.floor(t.x / k), py = Math.floor(t.y / k);
      let im: ImageBitmap | null = null, lz = zz, lx = px, ly = py;
      for (let up = 0; !im && up <= 6 && zz - up >= minZoom; up++) {
        lz = zz - up; lx = px >> up; ly = py >> up;
        im = await ctx.loader.get<ImageBitmap>(urlOf({ z: lz, x: lx, y: ly }), { kind: 'image', priority: ctx.priority, prefetch: ctx.prefetch, signal: ctx.signal });
      }
      if (!im) return null;
      const kk = 2 ** (t.z - lz), s = im.width / kk;
      return { im, sx: (t.x - lx * kk) * s, sy: (t.y - ly * kk) * s, size: s };
    },
    async pixels(t, ctx) {
      if (t.z < minZoom || t.z > maxZoom) return null;
      return ctx.loader.get<{ width: number; height: number; data: Uint8ClampedArray }>(urlOf(t), { kind: 'imagePixels', priority: ctx.priority, prefetch: ctx.prefetch, signal: ctx.signal });
    },
    async draw(g, t, ctx) {
      const b = await img.bitmap!(t, ctx); if (!b) return false;
      await paint(g, img, t, () => g.drawImage(b.im, b.sx, b.sy, b.size, b.size, 0, 0, TILE, TILE));
      return true;
    },
  };
  return img;
}
/** paint clipped to the source's `where` (its opacity and blend apply when the surface composes the tile) */
export async function paint<T>(g: Ctx2D, s: { where?: BBox }, t: Tile, f: () => T | Promise<T>): Promise<T> {
  g.save();
  if (s.where) {
    const [w, so, e, n] = s.where, tb = tileBBox(t.z, t.x, t.y);
    if (!(w <= tb[0] && so <= tb[1] && e >= tb[2] && n >= tb[3])) {
      // the box in tile pixels (Mercator in y)
      const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
      const k = 2 ** t.z, X = (lon: number) => (((lon + 180) / 360) * k - t.x) * TILE, Y = (lat: number) => ((1 - merc(lat) / Math.PI) / 2 * k - t.y) * TILE;
      g.beginPath(); g.rect(X(w), Y(n), X(e) - X(w), Y(so) - Y(n)); g.clip();
    }
  }
  try { return await f(); } finally { g.restore(); }
}

// ── terrain-RGB heights (Terrarium, Mapbox) ──────────────────────────────────────────────────────────────────────
export type Encoding = 'terrarium' | 'mapbox';
export const decodeHeight = (enc: Encoding, r: number, g: number, b: number) => (enc === 'terrarium' ? r * 256 + g + b / 256 - 32768 : -10000 + (r * 65536 + g * 256 + b) * 0.1);
/** n × n heights for a tile from the RGBA pixels of a (possibly coarser) terrain tile, bilinear between pixel centres */
export function sampleRGB(px: Uint8ClampedArray | Uint8Array, w: number, enc: Encoding, k: number, ox: number, oy: number, n: number): Float32Array {
  const out = new Float32Array(n * n);
  const h = (xx: number, yy: number) => { const q = (yy * w + xx) * 4; return decodeHeight(enc, px[q]!, px[q + 1]!, px[q + 2]!); };
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const fx = Math.min(w - 1, Math.max(0, (ox + i / (n - 1) / k) * w - 0.5)), fy = Math.min(w - 1, Math.max(0, (oy + j / (n - 1) / k) * w - 0.5));
    const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(w - 1, x0 + 1), y1 = Math.min(w - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
    out[j * n + i] = (h(x0, y0) * (1 - ax) + h(x1, y0) * ax) * (1 - ay) + (h(x0, y1) * (1 - ax) + h(x1, y1) * ax) * ay;
  }
  return out;
}
export interface RGBTerrainOptions extends CommonOptions {
  url: string; encoding?: Encoding; maxZoom?: number; blend?: number;
  /** levels coarser than the imagery tile its terrain tile is (default 2: a 256-pixel terrain tile still gives each
   *  of the 16 tiles under it 64 × 64 samples for its 33 × 33 heights, and one request and one decode serve all 16) */
  coarser?: number;
}
export function rgbTerrain(o: RGBTerrainOptions, base: Readonly<Terms> = OPEN): Terrain {
  const enc = o.encoding ?? 'terrarium', maxZoom = o.maxZoom ?? 15, up = Math.max(0, Math.round(o.coarser ?? 2));
  // the terrain tile's level for an imagery tile at z
  const levelOf = (z: number) => Math.min(Math.max(0, z - up), maxZoom);
  // the last tiles decoded (a parent's pixels serve its children); loads in flight are shared by the loader, which
  // also stops a fetch only when every tile waiting for it let go
  const px = new Map<string, { w: number; d: Uint8ClampedArray } | null>();
  const pixels = async (url: string, ctx: SourceContext) => {
    if (px.has(url)) return px.get(url)!;
    // decoded to raw pixels in a worker (the loader's 'pixels'): the main thread only samples the heights
    const im = await ctx.loader.get<{ width: number; data: Uint8ClampedArray }>(url, { kind: 'pixels', priority: ctx.priority, prefetch: ctx.prefetch, signal: ctx.signal });
    const v = im ? { w: im.width, d: im.data } : null;
    px.set(url, v); if (px.size > 48) px.delete(px.keys().next().value!);
    return v;
  };
  const urlOf = (t: Tile) => xyzUrl(o.url, t);
  return {
    kind: 'terrain', id: o.id ?? o.url, attribution: o.attribution ?? '', terms: termsOf(o.terms, base), when: o.when, where: checkBBox(o.where, o.id ?? o.url), maxZoom, blend: o.blend ?? 0, version: 0,
    urlFor(t) { const zz = levelOf(t.z), k = 2 ** (t.z - zz); return urlOf({ z: zz, x: Math.floor(t.x / k), y: Math.floor(t.y / k) }); },
    async heights(t, n, ctx) {
      const zz = levelOf(t.z), k = 2 ** (t.z - zz), px0 = Math.floor(t.x / k), py0 = Math.floor(t.y / k);
      const p = await pixels(urlOf({ z: zz, x: px0, y: py0 }), ctx);
      return p ? sampleRGB(p.d, p.w, enc, k, (t.x - px0 * k) / k, (t.y - py0 * k) / k, n) : null;
    },
  };
}

// ── a height grid (your own DEM for one area) ────────────────────────────────────────────────────────────────────
/** a grid in memory: rows north → south, columns west → east; either a lon / lat box, or a local metric frame */
export interface GridData {
  cols: number; rows: number; heights: Float32Array;
  bbox?: BBox | { west: number; south: number; east: number; north: number };
  /** a local equirectangular frame: e = (lon − lon0) · 111320 · cos lat0, n = (lat − lat0) · 110574 */
  local?: { lon0: number; lat0: number; west: number; north: number; cell: number };
  nodata?: number;
}
export function gridSampler(d: GridData, where: string): { at(lon: number, lat: number): number; box: BBox } {
  if (!(d.heights instanceof Float32Array) || d.heights.length < d.cols * d.rows) throw new AslnutError('E-DATA-001', `the grid has ${d.heights?.length ?? 0} heights for ${d.cols} × ${d.rows}`, { where, fix: 'heights must be a Float32Array of cols × rows, row 0 north' });
  let box: BBox, toPx: (lon: number, lat: number) => [number, number];
  if (d.local) {
    const L = d.local, kx = 111320 * Math.cos((L.lat0 * Math.PI) / 180), ky = 110574;
    toPx = (lon, lat) => [((lon - L.lon0) * kx - L.west) / L.cell - 0.5, (L.north - (lat - L.lat0) * ky) / L.cell - 0.5];
    box = [L.lon0 + L.west / kx, L.lat0 + (L.north - d.rows * L.cell) / ky, L.lon0 + (L.west + d.cols * L.cell) / kx, L.lat0 + L.north / ky];
  } else if (d.bbox) {
    const b = Array.isArray(d.bbox) ? d.bbox as BBox : [d.bbox.west, d.bbox.south, d.bbox.east, d.bbox.north] as BBox;
    box = checkBBox(b, where)!;
    toPx = (lon, lat) => [((lon - b[0]) / (b[2] - b[0])) * d.cols - 0.5, ((b[3] - lat) / (b[3] - b[1])) * d.rows - 0.5];
  } else throw new AslnutError('E-DATA-001', 'a grid needs a bbox or a local frame', { where, fix: 'give bbox: [west, south, east, north]' });
  const H = d.heights, W = d.cols, nod = d.nodata;
  return {
    box,
    at(lon, lat) {
      const [fx0, fy0] = toPx(lon, lat);
      if (fx0 < -0.5 || fy0 < -0.5 || fx0 > W - 0.5 || fy0 > d.rows - 0.5) return NaN;
      const fx = Math.min(W - 1, Math.max(0, fx0)), fy = Math.min(d.rows - 1, Math.max(0, fy0));
      const x0 = Math.floor(fx), y0 = Math.floor(fy), x1 = Math.min(W - 1, x0 + 1), y1 = Math.min(d.rows - 1, y0 + 1), ax = fx - x0, ay = fy - y0;
      const v = [H[y0 * W + x0]!, H[y0 * W + x1]!, H[y1 * W + x0]!, H[y1 * W + x1]!];
      if (nod !== undefined && v.some((x) => x === nod)) return NaN;
      return (v[0]! * (1 - ax) + v[1]! * ax) * (1 - ay) + (v[2]! * (1 - ax) + v[3]! * ax) * ay;
    },
  };
}
/** n × n heights for a tile from a sampler (NaN outside) */
export function tileHeights(t: Tile, n: number, at: (lon: number, lat: number) => number): Float32Array {
  const out = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const [lon, lat] = tilePoint(t.z, t.x, t.y, i / (n - 1), j / (n - 1)); out[j * n + i] = at(lon, lat); }
  return out;
}

// ── composing a terrain list ─────────────────────────────────────────────────────────────────────────────────────
/** the heights of a tile from a list, in order: later sources win where they have data, blended over their `blend`
 *  metres inside their `where`. null: no source had anything (the tile has no terrain) */
export async function composeHeights(list: Terrain[], t: Tile, n: number, ctx: SourceContext): Promise<Float32Array | null> {
  let out: Float32Array | null = null;
  const got = await Promise.all(list.map((s) => (covers(s, t) ? s.heights(t, n, ctx) : Promise.resolve(null))));
  list.forEach((s, k) => {
    const h = got[k]; if (!h) return;
    if (!out) { out = new Float32Array(n * n).fill(NaN); }
    const o = out;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const q = j * n + i, v = h[q]!; if (Number.isNaN(v)) continue;
      let w = 1;
      if (s.where && s.blend > 0) { const [lon, lat] = tilePoint(t.z, t.x, t.y, i / (n - 1), j / (n - 1)); w = Math.max(0, Math.min(1, insideBy(lon, lat, s.where) / s.blend)); }
      o[q] = Number.isNaN(o[q]!) || w >= 1 ? v : o[q]! + (v - o[q]!) * w;
    }
  });
  if (out) { const o = out as Float32Array; for (let q = 0; q < o.length; q++) if (Number.isNaN(o[q]!)) o[q] = 0; }
  return out;
}
