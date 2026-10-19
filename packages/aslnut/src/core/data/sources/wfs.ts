// core › data › sources › services › wfs: features from an OGC web feature service, loaded ONCE: over the extent
// you give, or the whole layer when it is small (counted first: at most `most` features), paged (count and
// startIndex) and handed on together when every page is in. Looking never changes it: a zoom, a tilt, a pan ask for
// nothing. Only on request (`tiles: true`) does it follow the view: the view is cut into tiles of a grid (a level a
// little coarser than the view's), each tile asked once ever, and features are only ADDED by id, never replaced or
// asked again (a scale over it is given its domain). Version 2.0.0, and 1.1.0 when the service does not answer it;
// longitude / latitude asked for (EPSG:4326), else what the layer offers: web Mercator (turned back into degrees) or
// GDA94 / GDA2020 (read as degrees: within metres). A filter (CQL or FES) narrows what it asks for; headers, your
// fetch or a proxy reach a service that needs them.
//   data.wfs('https://…/wfs', { typeName: 'ns:lga_polygon', extent: [144.9, -38.0, 145.3, -37.8] })
//   data.wfs(url, { typeName: 'ns:foi_point', extent, filter: "feature_type = 'hospital'" })      a CQL filter
//   data.wfs(url, { typeName: 'ns:parcels', tiles: true })                                        the view's tiles
//   data.wfs(url, { typeName, filter: { fes: '<fes:PropertyIsEqualTo>…</fes:PropertyIsEqualTo>' } })
//   data.wfs(url, { typeName, proxy: 'https://my.proxy/?url=' })                           a service without CORS
//   await data.wfs.capabilities(url)          its layers (name, title, coordinate systems, box), formats, paging
//   await data.wfs.describe(url, typeName)    a layer's fields and its geometry
import { AslnutError } from '../../world/errors.ts';
import type { State } from '../../world/state.ts';
import { normalize, type Feature, type IdRule, type Position } from '../features.ts';
import { tileBBox, type BBox } from '../../space/geo.ts';
import type { SourceContext, SourceStatus } from './source.ts';
import { Tiled } from './tiled.ts';
import { epsgOf, exceptionOf, GEOGRAPHIC, MERCATOR, proxied, wfsCapabilities, wfsDescribe, withParams, type ServiceOptions, type WFSCapabilities } from './ogc.ts';

export interface WFSOptions extends ServiceOptions {
  /** the layer (its name, with its prefix when it has one: 'ns:lga_polygon') */
  typeName: string;
  /** '2.0.0', '1.1.0', or 'auto' (default: 2.0.0, then 1.1.0 when the service does not answer it) */
  version?: '2.0.0' | '1.1.0' | 'auto';
  /** what to ask for: a CQL filter (text), or { cql } / { fes } (an FES filter's inside: one or more operators, the
   *  `fes:` prefix; asked of a 1.1.0 service as its `ogc:` filter). The view's box is added to it */
  filter?: string | { cql: string } | { fes: string };
  /** the geometry's field (a filter needs it: default the one DescribeFeatureType says) */
  geometryName?: string;
  /** the coordinate system asked for (default EPSG:4326 when the layer offers it, else web Mercator or a GDA one) */
  crs?: string;
  /** the output format (default application/json) */
  format?: string;
  /** a prop that is the id (default the service's feature id) */
  id?: IdRule;
  /** the box loaded once [w, s, e, n] (degrees). Unset: the whole layer, when it has at most `most` features */
  extent?: BBox;
  /** the whole layer is loaded (no extent) when it has at most this many features (default 20000); more is an error
   *  that says to give an extent (or, with `orExtent`, that box is loaded instead) */
  most?: number;
  /** no extent and the whole layer too big: this box instead (a layer added from a list: the view's box then) */
  orExtent?: BBox;
  /** follow the view instead (default false): the view's tiles, each asked once, features only added by id */
  tiles?: boolean;
  /** with tiles: the grid's level for this view: the view's zoom less this (default 1), within minGrid..maxGrid (10..15) */
  gridOffset?: number; minGrid?: number; maxGrid?: number;
  /** with tiles: below this view zoom nothing is asked (default 11) */
  minZoom?: number;
  /** features one request asks for (default 1000, or less when the service says so) */
  pageSize?: number;
  /** the most features one tile holds (default 5000): more and the tile is cut short (finer tiles ask again) */
  maxFeatures?: number;
  /** at most this many tiles for a view (default 24) */
  maxTiles?: number;
  /** only within this box [w, s, e, n] (default: the layer's box when the capabilities were read, else anywhere) */
  bounds?: BBox;
  attribution?: string;
}
/** what a WFS source has done: its version and coordinate system, requests, bytes, tiles, features */
export interface WFSInfo { version: string; crs: string; requests: number; bytes: number; tiles: number; truncated: number; features: number; ms: number }

const R = 6378137;
const toLonLat = (x: number, y: number): [number, number] => [(x / R) * (180 / Math.PI), (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * (180 / Math.PI)];
/** every position of a geometry changed in place by fn */
function eachPosition(f: Feature, fn: (p: Position) => void): void {
  const g = f.geometry; if (!g) return;
  switch (g.type) {
    case 'Point': fn(g.coordinates); break;
    case 'MultiPoint': case 'LineString': g.coordinates.forEach(fn); break;
    case 'MultiLineString': case 'Polygon': g.coordinates.forEach((r) => r.forEach(fn)); break;
    case 'MultiPolygon': g.coordinates.forEach((p) => p.forEach((r) => r.forEach(fn))); break;
  }
}

export class WFS extends Tiled {
  readonly url: string;
  private o: WFSOptions;
  private ver: '2.0.0' | '1.1.0';
  private crs = 'EPSG:4326';
  private geomName: string | null;
  private caps: WFSCapabilities | null = null;
  private truncated = new Set<string>();
  private stats = { requests: 0, bytes: 0, ms: 0 };
  /** the service's capabilities were read (to find a coordinate system after a refusal) */
  private crsAsked = false;
  constructor(url: string, o: WFSOptions) {
    super({ attribution: o?.attribution, maxTiles: o?.maxTiles ?? 24 });
    if (typeof url !== 'string' || !url) throw new AslnutError('E-DATA-001', 'data.wfs needs the service URL', { fix: "data.wfs('https://…/wfs', { typeName: 'ns:layer' })" });
    if (!o?.typeName) throw new AslnutError('E-DATA-001', 'data.wfs needs { typeName }', { where: url, fix: "data.wfs(url, { typeName: 'ns:layer' }) (data.wfs.capabilities(url) lists them)" });
    this.url = url; this.o = o; this.whole = true; this.addOnly = true;
    if (o.extent && !(Array.isArray(o.extent) && o.extent.length === 4 && o.extent.every(Number.isFinite) && o.extent[0] < o.extent[2] && o.extent[1] < o.extent[3])) throw new AslnutError('E-DATA-001', `data.wfs extent ${JSON.stringify(o.extent)} is not a box`, { where: url, fix: 'extent: [west, south, east, north] in degrees' });
    this.ver = o.version === '1.1.0' ? '1.1.0' : '2.0.0';
    if (o.crs) this.crs = o.crs;
    this.geomName = o.geometryName ?? null;
  }
  protected async load(ctx: SourceContext): Promise<void> {
    this.ctx = ctx;
    if (this.o.tiles) {
      const lo = this.o.minGrid ?? 10, hi = this.o.maxGrid ?? 15;
      this.range = { minZoom: lo, maxZoom: Math.max(lo, hi), bounds: this.o.bounds ?? [-180, -85.05, 180, 85.05] };
      return;
    }
    // once: the extent (or the whole layer, when it is small; too big: the box it falls back to), every page, handed on
    // together
    let box = this.o.extent ?? null; const most = this.o.most ?? 20000;
    const size = Math.max(1, Math.min(this.o.pageSize ?? 1000, this.caps?.countDefault ?? Infinity));
    const out: Feature[] = [], seen = new Set<string | number>();
    const tooMany = (n: number | string) => new AslnutError('E-DATA-003', `layer '${this.o.typeName}' has ${n} features: too many to load at once without an extent`, { where: this.id, fix: `data.wfs(url, { typeName: '${this.o.typeName}', extent: [west, south, east, north] }) (or tiles: true: the view's tiles, a scale over it given its domain)` });
    for (let start = 0; ;) {
      const page = await this.page(box, start, size, ctx);
      if (!box && page.total !== null && page.total > most) {
        if (!this.o.orExtent) throw tooMany(page.total);
        box = this.o.orExtent; out.length = 0; seen.clear(); start = 0; continue;
      }
      let fresh = 0;
      for (const f of page.features) if (!seen.has(f.id)) { seen.add(f.id); out.push(f); fresh++; }
      start += page.features.length;
      // (a service that does not page answers the first page again: nothing new, the end)
      if (page.features.length < size || fresh === 0 || (page.total !== null && start >= page.total)) break;
      if (!box && out.length > most) { if (!this.o.orExtent) throw tooMany(`more than ${most}`); box = this.o.orExtent; out.length = 0; seen.clear(); start = 0; }
    }
    this.replace(out, true);
  }
  /** it follows the view only when asked (tiles: true) */
  override get byView(): boolean { return !!this.o.tiles; }
  /** the screen's own box (a service is asked for what is seen, not a square round it) */
  protected override reach(s: State): [number, number] { return this.reachTight(s); }
  protected override skip(s: State): boolean { return s.view.zoom < (this.o.minZoom ?? 11); }
  protected override levelFor(s: State, h: { minZoom: number; maxZoom: number }): number { return Math.max(h.minZoom, Math.min(h.maxZoom, Math.floor(s.view.zoom - (this.o.gridOffset ?? 1)))); }
  /** a coarser tile already in, not cut short, answers for its parts (a zoom in asks for nothing) */
  protected override answerOf(key: string): string {
    let [z, x, y] = key.split('/').map(Number) as [number, number, number];
    const lo = this.range?.minZoom ?? 0;
    while (z > lo) {
      z--; x >>= 1; y >>= 1;
      const k = `${z}/${x}/${y}`;
      if (this.tiles.get(k) && !this.truncated.has(k)) return k;
    }
    return key;
  }
  /** what it has done */
  get info(): WFSInfo {
    return { version: this.ver, crs: this.crs, requests: this.stats.requests, bytes: this.stats.bytes, tiles: this.tileCount.kept, truncated: this.truncated.size, features: this.size, ms: Math.round(this.stats.ms) };
  }
  override status(): SourceStatus { return super.status(); }

  // ── asking ───────────────────────────────────────────────────────────────────────────────────────────────────
  /** one tile: its pages, until the service has no more (or the tile's most) */
  protected async tile(z: number, x: number, y: number, ctx: SourceContext): Promise<Feature[]> {
    const box = tileBBox(z, x, y), key = `${z}/${x}/${y}`;
    const size = Math.max(1, Math.min(this.o.pageSize ?? 1000, this.caps?.countDefault ?? Infinity)), most = this.o.maxFeatures ?? 5000;
    const out: Feature[] = [], seen = new Set<string | number>();
    for (let start = 0; ;) {
      const page = await this.page(box, start, size, ctx);
      let fresh = 0;
      for (const f of page.features) if (!seen.has(f.id)) { seen.add(f.id); out.push(f); fresh++; }
      start += page.features.length;
      // (a service that does not page answers the first page again: nothing new, the end)
      if (page.features.length < size || fresh === 0 || (page.total !== null && start >= page.total)) break;
      if (out.length >= most) { this.truncated.add(key); break; }
    }
    return out;
  }
  /** one request (2.0.0 refused: 1.1.0; 4326 refused: what the layer offers), its features in longitude / latitude */
  private async page(box: BBox | null, start: number, count: number, ctx: SourceContext): Promise<{ features: Feature[]; total: number | null }> {
    try { return await this.ask(box, start, count, ctx); }
    catch (e) {
      // (a refusal: another version, then another coordinate system, before giving up)
      if (this.o.version === undefined || this.o.version === 'auto') {
        if (this.ver === '2.0.0') { this.ver = '1.1.0'; try { return await this.ask(box, start, count, ctx); } catch { this.ver = '2.0.0'; } }
      }
      if (!this.crsAsked && !this.o.crs) {
        this.crsAsked = true;
        // (what the capabilities say plainly is said; capabilities that do not come leave the first refusal standing)
        const crs = await this.offered(ctx).catch((x: unknown) => { if (x instanceof AslnutError && x.code === 'E-DATA-001') throw x; return null; });
        if (crs && crs !== this.crs) { this.crs = crs; return this.ask(box, start, count, ctx); }
      }
      throw e;
    }
  }
  /** the coordinate system to ask for, from the capabilities: 4326, else web Mercator, else a geographic one (GDA) */
  private async offered(_ctx: SourceContext): Promise<string | null> {
    this.caps ??= await wfsCapabilities(this.url, { ...this.so(), version: this.ver });
    const l = this.caps.layers.find((x) => x.name === this.o.typeName || x.name.endsWith(`:${this.o.typeName}`));
    if (!l) throw new AslnutError('E-DATA-001', `the service has no layer '${this.o.typeName}'`, { where: this.id, fix: `one of: ${this.caps.layers.slice(0, 6).map((x) => x.name).join(', ')}${this.caps.layers.length > 6 ? ' …' : ''}` });
    const codes = l.crs.map(epsgOf);
    if (codes.includes(4326)) return 'EPSG:4326';
    const m = codes.find((c) => c !== null && MERCATOR.has(c)); if (m) return `EPSG:${m}`;
    const g = codes.find((c) => c !== null && GEOGRAPHIC.has(c)); if (g) return `EPSG:${g}`;
    throw new AslnutError('E-DATA-001', `layer '${this.o.typeName}' is offered only in ${l.crs.join(', ')}`, { where: this.id, fix: 'aslnut reads longitude / latitude (EPSG:4326, GDA94, GDA2020) and web Mercator: ask the service for one of them, or reproject it' });
  }
  private so(): ServiceOptions { return { headers: this.o.headers, fetch: this.o.fetch, proxy: this.o.proxy }; }
  /** the request's URL for a box (its filter with the box in it, when there is one); no box: the whole layer */
  async urlFor(box: BBox | null, start: number, count: number): Promise<string> {
    const v = this.ver, code = epsgOf(this.crs) ?? 4326, merc = MERCATOR.has(code);
    // the box: in metres for web Mercator; else latitude first in the URN form (the order every version reads alike)
    const [w, s, e, n] = box ?? [-180, -85.05, 180, 85.05], [x0, y0] = merc ? [w * (Math.PI / 180) * R, Math.log(Math.tan(Math.PI / 4 + (s * Math.PI) / 360)) * R] : [w, s];
    const [x1, y1] = merc ? [e * (Math.PI / 180) * R, Math.log(Math.tan(Math.PI / 4 + (n * Math.PI) / 360)) * R] : [e, n];
    const urn = `urn:ogc:def:crs:EPSG::${code}`;
    const bbox = merc ? `${x0},${y0},${x1},${y1},EPSG:${code}` : `${y0},${x0},${y1},${x1},${urn}`;
    const q: Record<string, string | number | undefined> = { service: 'WFS', version: v, request: 'GetFeature', outputFormat: this.o.format ?? 'application/json', srsName: `EPSG:${code}` };
    if (v === '2.0.0') { q.typeNames = this.o.typeName; q.count = count; q.startIndex = start; }
    else { q.typeName = this.o.typeName; q.maxFeatures = count; q.startIndex = start; }
    const f = this.o.filter;
    if (!f) { if (box) q.bbox = bbox; }
    else if (!box && (typeof f === 'string' || 'cql' in f)) q.CQL_FILTER = typeof f === 'string' ? f : f.cql;
    else if (!box && typeof f === 'object' && 'fes' in f) q.FILTER = v === '2.0.0' ? `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0">${f.fes}</fes:Filter>` : `<ogc:Filter xmlns:ogc="http://www.opengis.net/ogc">${f.fes.replace(/fes:ValueReference/g, 'ogc:PropertyName').replace(/fes:/g, 'ogc:')}</ogc:Filter>`;
    else {
      const geom = this.geomName ?? (this.geomName = (await wfsDescribe(this.url, this.o.typeName, { ...this.so(), version: v }).catch(() => null))?.geometry?.name ?? 'the_geom');
      if (typeof f === 'string' || 'cql' in f) {
        const cql = typeof f === 'string' ? f : f.cql;
        q.CQL_FILTER = `BBOX(${geom},${x0},${y0},${x1},${y1},'EPSG:${code}') AND (${cql})`;
      } else {
        const env = (ns: string) => `<gml:Envelope srsName="${urn}"><gml:lowerCorner>${merc ? `${x0} ${y0}` : `${y0} ${x0}`}</gml:lowerCorner><gml:upperCorner>${merc ? `${x1} ${y1}` : `${y1} ${x1}`}</gml:upperCorner></gml:Envelope>`.replace(/gml:/g, ns);
        q.FILTER = v === '2.0.0'
          ? `<fes:Filter xmlns:fes="http://www.opengis.net/fes/2.0" xmlns:gml="http://www.opengis.net/gml/3.2"><fes:And><fes:BBOX><fes:ValueReference>${geom}</fes:ValueReference>${env('gml:')}</fes:BBOX>${f.fes}</fes:And></fes:Filter>`
          : `<ogc:Filter xmlns:ogc="http://www.opengis.net/ogc" xmlns:gml="http://www.opengis.net/gml"><ogc:And><ogc:BBOX><ogc:PropertyName>${geom}</ogc:PropertyName>${env('gml:')}</ogc:BBOX>${f.fes.replace(/fes:ValueReference/g, 'ogc:PropertyName').replace(/fes:/g, 'ogc:')}</ogc:And></ogc:Filter>`;
      }
    }
    return withParams(this.url, q);
  }
  private async ask(box: BBox | null, start: number, count: number, ctx: SourceContext): Promise<{ features: Feature[]; total: number | null }> {
    const url = await this.urlFor(box, start, count), t0 = typeof performance !== 'undefined' ? performance.now() : Date.now();
    let text: string | null;
    this.stats.requests++;
    if (this.o.fetch || this.o.proxy) {
      const f = this.o.fetch ?? fetch, r = await f(proxied(url, this.o.proxy), { headers: this.o.headers, mode: 'cors' });
      text = await r.text();
      if (!r.ok) throw new AslnutError('E-DATA-002', `the service answered ${r.status}${exceptionOf(text) ? `: ${exceptionOf(text)}` : ''}`, { where: this.id, fix: 'check the layer name and the filter' });
    } else text = await ctx.loader.get<string>(url, { kind: 'text', init: this.o.headers ? { headers: this.o.headers } : undefined });
    this.stats.ms += (typeof performance !== 'undefined' ? performance.now() : Date.now()) - t0;
    if (text === null) throw new AslnutError('E-DATA-002', `nothing at ${url}`, { where: this.id, fix: 'check the service URL' });
    this.stats.bytes += text.length;
    const ex = exceptionOf(text);
    if (ex) throw new AslnutError('E-DATA-002', `the service said: ${ex}`, { where: this.id, fix: 'check the layer name, the filter and the coordinate system' });
    let j: { features?: unknown[]; numberMatched?: number | string; totalFeatures?: number | string };
    try { j = JSON.parse(text); }
    catch { throw new AslnutError('E-DATA-002', `the answer is not GeoJSON (${text.slice(0, 80).replace(/\s+/g, ' ')}…)`, { where: this.id, fix: "the service must answer outputFormat=application/json (format option: its own name for GeoJSON, e.g. 'json')" }); }
    const features = normalize(j.features ? j : { type: 'FeatureCollection', features: [] }, { id: this.o.id, where: this.id });
    this.toDegrees(features, box);
    const tot = Number(j.numberMatched ?? j.totalFeatures);
    return { features, total: Number.isFinite(tot) && tot >= 0 ? tot : null };
  }
  /** web Mercator metres back to degrees; an answer in latitude / longitude order turned round (found against the box
   *  asked for; no box (the whole layer): as the service says it is) */
  private toDegrees(fs: Feature[], box: BBox | null): void {
    const code = epsgOf(this.crs) ?? 4326;
    if (MERCATOR.has(code)) { for (const f of fs) eachPosition(f, (p) => { const [lon, lat] = toLonLat(p[0], p[1]); p[0] = lon; p[1] = lat; }); return; }
    if (!box) return;
    // (GeoJSON is longitude first; a service answering latitude first is found by where its first points fall)
    let inside = 0, swapped = 0, n = 0;
    const [w, s, e, nn] = box, padX = (e - w) * 2, padY = (nn - s) * 2;
    for (const f of fs) {
      if (n >= 40) break;
      let p0: Position | null = null; eachPosition(f, (p) => { p0 ??= p; });
      if (!p0) continue; n++;
      const [a, b] = p0 as Position;
      if (a >= w - padX && a <= e + padX && b >= s - padY && b <= nn + padY) inside++;
      if (b >= w - padX && b <= e + padX && a >= s - padY && a <= nn + padY) swapped++;
    }
    if (swapped > inside) for (const f of fs) eachPosition(f, (p) => { const t = p[0]; p[0] = p[1]; p[1] = t; });
  }
}

/** a WFS layer's features for the view; data.wfs.capabilities / describe read the service */
export const wfs = Object.assign((url: string, o: WFSOptions) => new WFS(url, o), {
  /** the service's layers, formats and paging (2.0.0, else 1.1.0) */
  capabilities: (url: string, o?: ServiceOptions & { version?: '2.0.0' | '1.1.0' }) => wfsCapabilities(url, o),
  /** a layer's fields and its geometry */
  describe: (url: string, typeName: string, o?: ServiceOptions & { version?: '2.0.0' | '1.1.0' }) => wfsDescribe(url, typeName, o),
});
