// core › data › sources › tiled: what every source that follows the view in tiles shares (MVT tiles, a PMTiles file,
// GeoJSON tiles, a WFS asked tile by tile): the view's tiles at a level, each loaded once and kept (a few hundred),
// the features of the tiles wanted now handed on together (pieces of one feature cut at tiles' edges joined by id; a
// service answering whole features: one kept per id)
import { Source, type SourceContext } from './source.ts';
import { AslnutError } from '../../world/errors.ts';
import type { State } from '../../world/state.ts';
import type { Feature } from '../features.ts';
import { decodeMVT } from './mvt.ts';
import { Compression } from './pmtiles.ts';
import { D, mercY } from '../../space/geo.ts';
/** what every tiled vector source shares: the view's tiles at the view's level (within the source's), loaded,
 *  decoded and pieces of one feature joined by id */
export interface TiledOptions {
  /** the layer in the tiles (MVT; default: all) */
  layer?: string | string[];
  /** a prop that is the id (default the tile's feature id) */
  id?: string;
  /** a fixed level (loads the whole extent at it), or 'view' (default): the view's level within the source's */
  zoom?: number | 'view';
  /** at most this many tiles at once (default 64) */
  maxTiles?: number;
  /** ms a tile the view left stays among the features once the view stops (default 3000 for whole features, a
   *  service's; 0 for pieces of tiles): a zoom in and back out, a pan and back, finds them still there (nothing gone
   *  and come back); at most four times maxTiles of them */
  linger?: number;
  attribution?: string;
}
export abstract class Tiled extends Source {
  protected to: TiledOptions; protected range: { minZoom: number; maxZoom: number; bounds: [number, number, number, number] } | null = null;
  protected tiles = new Map<string, Feature[] | null>(); private want = new Set<string>(); private z = -1; private dirty = false; private lastKey = '';
  /** when each tile was last wanted (ms), and when the next one lingering stops */
  private wantedAt = new Map<string, number>(); private movedAt = -Infinity;
  protected ctx: SourceContext | null = null;
  /** its tiles hold whole features (a service's answer by box): a feature in several tiles is kept once, not joined */
  protected whole = false;
  /** features only added (whole features by id): what came in stays, a tile is asked once ever, nothing is replaced
   *  or asked again as the view moves (loading is a cache, never seen) */
  protected addOnly = false;
  private kept = new Map<string | number, Feature>(); private askedEver = new Set<string>();
  constructor(o: TiledOptions) { super({ attribution: o.attribution }); this.to = o; }
  /** the view's tiles (not a fixed level over the whole extent): it follows the view */
  override get byView(): boolean { return typeof this.to.zoom !== 'number'; }
  /** one tile's features (null or []: none there) */
  protected abstract tile(z: number, x: number, y: number, ctx: SourceContext): Promise<Feature[] | null>;
  /** the level of the tiles for this view (default the view's own, within the source's) */
  protected levelFor(s: State, h: { minZoom: number; maxZoom: number }): number { return Math.max(h.minZoom, Math.min(h.maxZoom, Math.floor(s.view.zoom))); }
  /** the tile that answers for this one (default itself; a coarser one already in can answer for its parts) */
  protected answerOf(key: string): string { return key; }
  /** how far the view's box reaches from its centre [degrees of longitude, of latitude] (default: the screen's larger
   *  side in metres each way, more when tilted: generous) */
  protected reach(s: State): [number, number] {
    const v = s.view, half = Math.max(v.width, v.height) * v.pixelSize * (1 + Math.min(3, v.tilt / 25));
    return [half / (111320 * Math.max(0.05, Math.cos(v.lat * D))), half / 110574];
  }
  /** the screen's own box (its width and height, turned with the view, deeper when tilted: the ground stretched as
   *  the view leans, up to 4 times), a little more */
  protected reachTight(s: State, more = 1.15): [number, number] {
    const v = s.view, hw = (v.width / 2) * v.pixelSize * more, hh = (v.height / 2) * v.pixelSize * more * Math.min(4, 1 / Math.cos(Math.min(80, v.tilt) * D));
    const b = v.bearing * D, c = Math.abs(Math.cos(b)), sn = Math.abs(Math.sin(b)), ex = hw * c + hh * sn, ey = hw * sn + hh * c;
    return [ex / (111320 * Math.max(0.05, Math.cos(v.lat * D))), ey / 110574];
  }
  /** nothing is asked for this view (default: always asked) */
  protected skip(_s: State): boolean { return false; }
  override frame(s: State, ctx: SourceContext): void {
    this.ctx ??= ctx;
    const h = this.range; if (!h || typeof this.to.zoom === 'number') { this.flush(); return; }
    if (this.skip(s)) { this.flush(); return; }
    const z = this.levelFor(s, h);
    const [dLon, dLat] = this.reach(s), v = s.view;
    const box: [number, number, number, number] = [Math.max(h.bounds[0], v.lon - dLon), Math.max(h.bounds[1], v.lat - dLat), Math.min(h.bounds[2], v.lon + dLon), Math.min(h.bounds[3], v.lat + dLat)];
    const key = `${z}:${box.map((x) => x.toFixed(3)).join(',')}`;
    if (key !== this.lastKey) { this.lastKey = key; this.movedAt = performance.now(); if (box[0] < box[2] && box[1] < box[3]) this.need(z, box); }
    this.flush();
  }
  protected need(z: number, box: [number, number, number, number]): void {
    const k = 2 ** z, fx = (lon: number) => ((lon + 180) / 360) * k, fy = (lat: number) => ((Math.PI - mercY(Math.max(-85.05, Math.min(85.05, lat)))) / (2 * Math.PI)) * k;
    const tx = (lon: number) => Math.min(k - 1, Math.max(0, Math.floor(fx(lon)))), ty = (lat: number) => Math.min(k - 1, Math.max(0, Math.floor(fy(lat))));
    // the tiles nearest the view's centre first (a cap leaves out the far ones, not a side)
    const cx = fx((box[0] + box[2]) / 2), cy = fy((box[1] + box[3]) / 2), all: [string, number][] = [];
    for (let y = ty(box[3]); y <= ty(box[1]); y++) for (let x = tx(box[0]); x <= tx(box[2]); x++) all.push([`${z}/${x}/${y}`, (x + 0.5 - cx) ** 2 + (y + 0.5 - cy) ** 2]);
    all.sort((p, q) => p[1] - q[1]);
    const want = new Set<string>(), max = this.to.maxTiles ?? 64;
    for (const [t] of all) { if (want.size >= max) break; want.add(this.answerOf(t)); }
    if (z !== this.z || want.size !== this.want.size || [...want].some((t) => !this.want.has(t))) this.dirty = true;
    this.want = want; this.z = z;
    const now = performance.now(); for (const t of want) this.wantedAt.set(t, now);
    for (const t of want) if (!this.tiles.has(t) && !(this.addOnly && this.askedEver.has(t))) {
      this.tiles.set(t, null); if (this.addOnly) this.askedEver.add(t);
      const [tz, x, y] = t.split('/').map(Number) as [number, number, number];
      void this.track(this.tile(tz, x, y, this.ctx!).then((fs) => { this.tiles.set(t, fs ?? []); this.dirty = true; })
        .catch((e: unknown) => { this.tiles.delete(t); this.failure = e instanceof Error ? e : new Error(String(e)); this.ctx?.error(e); }));
    }
    // keep a few hundred tiles; forget the oldest ones not wanted now
    if (this.tiles.size > 400) for (const t of this.tiles.keys()) { if (this.tiles.size <= 300) break; if (!want.has(t)) { this.tiles.delete(t); this.wantedAt.delete(t); } }
  }
  /** MVT bytes (gzipped or not) to features */
  protected async mvt(b: Uint8Array, z: number, x: number, y: number, compression: number): Promise<Feature[]> {
    const raw = await gunzip(b, compression);
    return Object.values(decodeMVT(raw, { z, x, y }, { layers: this.to.layer ? [this.to.layer].flat() : undefined, idProp: this.to.id })).flat();
  }
  /** the tiles wanted now, and how many of them are in */
  get tileCount(): { wanted: number; in: number; kept: number } { return { wanted: this.want.size, in: [...this.want].filter((t) => this.tiles.get(t)).length, kept: this.tiles.size }; }
  /** the features of the wanted tiles (all loaded at this level), pieces of one id joined */
  private flush(): void {
    if (!this.dirty) return;
    const ready = [...this.want].filter((t) => this.tiles.get(t));
    // wait until every wanted tile is in (or a few hundred ms) so a view never shows half its shapes long
    if (ready.length < this.want.size && [...this.want].some((t) => this.tiles.get(t) === null)) return;
    this.dirty = false;
    // only added: every feature that came in stays, in the order it came; new ones appended (never replaced)
    if (this.addOnly) {
      let added = false;
      for (const fs of this.tiles.values()) for (const f of fs ?? []) if (!this.kept.has(f.id)) { this.kept.set(f.id, f); added = true; }
      if (added) this.replace([...this.kept.values()], true);
      return;
    }
    // the tiles wanted now, and the ones left a moment ago (their features kept a while: lingering)
    // (pieces cut at tiles' edges, from two levels at once, would be drawn twice: only whole features linger by default)
    // (they linger while the view keeps moving, and that long after it stopped: a slow device's long zoom too; the
    // most recently wanted first, at most four times the view's own tiles. The ones past their time go with the next
    // change the view makes, not on their own: a still view is never built again for features off its screen)
    const now = performance.now(), linger = this.to.linger ?? (this.whole ? 3000 : 0), shown = new Set(this.want), most = 4 * (this.to.maxTiles ?? 64);
    if (linger > 0) {
      const left = [...this.wantedAt].filter(([t]) => !shown.has(t) && this.tiles.get(t)).sort((a, b) => b[1] - a[1]);
      for (const [t, at] of left) {
        const ends = Math.max(at, this.movedAt) + linger;
        if (now < ends && shown.size < most) shown.add(t); else this.wantedAt.delete(t);
      }
    }
    const by = new Map<string | number, Feature>();
    for (const t of shown) for (const f of this.tiles.get(t) ?? []) {
      const had = by.get(f.id);
      if (!had) { by.set(f.id, this.whole ? f : { ...f }); continue; }
      if (!this.whole) by.set(f.id, mergeFeature(had, f));
    }
    this.replace([...by.values()], true);
  }
}
export function mergeFeature(a: Feature, b: Feature): Feature {
  const g = a.geometry, h = b.geometry;
  if (!g || !h) return a;
  const polys = (x: typeof g) => (x.type === 'Polygon' ? [x.coordinates] : x.type === 'MultiPolygon' ? x.coordinates : null);
  const lines = (x: typeof g) => (x.type === 'LineString' ? [x.coordinates] : x.type === 'MultiLineString' ? x.coordinates : null);
  const pa = polys(g), pb = polys(h);
  if (pa && pb) return { ...a, geometry: { type: 'MultiPolygon', coordinates: [...pa, ...pb] }, cuts: [...(a.cuts ?? pa.map((p) => p.map((r) => new Uint8Array(r.length)))), ...(b.cuts ?? pb.map((p) => p.map((r) => new Uint8Array(r.length))))] };
  const la = lines(g), lb = lines(h);
  if (la && lb) return { ...a, geometry: { type: 'MultiLineString', coordinates: [...la, ...lb] } };
  return a;
}

/** gzip in a browser (DecompressionStream) or Node (zlib); other codecs: say so plainly */
export async function gunzip(b: Uint8Array, c: number): Promise<Uint8Array> {
  if (c === Compression.None || c === Compression.Unknown) return b;
  if (c !== Compression.Gzip) throw new AslnutError('E-DATA-002', `tiles compressed with codec ${c} (only gzip and none are read)`, { fix: 'bake the archive with gzip' });
  if (b[0] !== 0x1f || b[1] !== 0x8b) return b;
  if (typeof DecompressionStream !== 'undefined') {
    const s = new Blob([b as BlobPart]).stream().pipeThrough(new DecompressionStream('gzip'));
    return new Uint8Array(await new Response(s).arrayBuffer());
  }
  const z = await import('node:zlib'); return new Uint8Array(z.gunzipSync(b));
}
