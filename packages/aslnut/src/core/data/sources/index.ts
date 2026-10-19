// core › data › sources: where a layer's features come from. Every source is a named factory with defaults; your
// own data and your own loader fit the same small interface (Source). All of them load through the world's loader
// (cache tiers, record / replay, provider terms).
//   data.geojson(url | object, { id })         a GeoJSON file or object
//   data.csv(url | text, { lon, lat, id })     a table; rows with coordinates become points
//   data.pmtiles(url, { layer, id })           tiled vector data in one file, read in pieces for the view
//   data.mvt(url, { layer, maxZoom })          MVT tiles at a {z}/{x}/{y} URL, for the view (and data.geojson with one)
//   data.rows(rows?, { id })                   your rows, changed later: set / upsert / patch / remove
//   data.query(s => …, { deps, when, every })  a function whose answer becomes the rows, run again when deps change
//   data.stream(url | { connect })             live changes (upsert / remove by id) over a socket or your function
//   data.custom({ load })                      your own loader
//   data.wfs(url, { typeName })                an OGC web feature service's layer, asked by the view's tiles
//   shapes.join(rows, { on })                  shapes that load once, numbers that change
import { AslnutError } from '../../world/errors.ts';
import type { State } from '../../world/state.ts';
import { shown, type When } from '../../observation/presence.ts';
import { normalize, type Feature, type IdRule, type Props } from '../features.ts';
import { parseCSV, type CSVOptions } from './csv.ts';
import { PMTilesReader, Compression, type Header } from './pmtiles.ts';
import { Source, type SourceContext } from './source.ts';
import { Tiled, gunzip, type TiledOptions } from './tiled.ts';
import { wfs } from './wfs.ts';

export { Source, Joined } from './source.ts';
export type { SourceContext, SourceStatus, JoinOptions } from './source.ts';
export { Tiled, gunzip } from './tiled.ts';
export type { TiledOptions } from './tiled.ts';
export { WFS } from './wfs.ts';
export type { WFSOptions, WFSInfo } from './wfs.ts';
export { readXML, readWFSCapabilities, readWFSDescribe, readWMSCapabilities, exceptionOf, epsgOf } from './ogc.ts';
export type { ServiceOptions, WFSCapabilities, WFSLayer, WFSFields, WMSCapabilities, WMSLayer, XNode } from './ogc.ts';

/** a row → a feature: its id (a prop or a function), a point where it has coordinates */
export interface RowOptions { id?: IdRule; /** the props holding coordinates (default lon / lat when present) */ lon?: string; lat?: string; attribution?: string }
function rowFeature(row: Props, i: number, o: RowOptions): Feature {
  const idv = typeof o.id === 'function' ? o.id({ properties: row, ...row } as never, i) : row[o.id ?? 'id'];
  const id = typeof idv === 'string' || typeof idv === 'number' ? idv : i;
  const lon = row[o.lon ?? 'lon'] ?? row['lng'] ?? row['longitude'], lat = row[o.lat ?? 'lat'] ?? row['latitude'];
  const g = typeof lon === 'number' && typeof lat === 'number' && Number.isFinite(lon) && Number.isFinite(lat) ? { type: 'Point' as const, coordinates: [lon, lat] as [number, number] } : null;
  return { id, props: row, geometry: g };
}
const sameShape = (a: Feature | undefined, b: Feature) => !!a && JSON.stringify(a.geometry) === JSON.stringify(b.geometry);

/** your rows: set, upsert, patch, remove; a layer updates only what changed (numbers recolour, shapes rebuild) */
export class Rows<P = Props> extends Source<P> {
  protected o: RowOptions;
  constructor(rows: P[] = [], o: RowOptions & { id?: IdRule } = {}) { super({ attribution: o.attribution }); this.o = o; if (rows.length) this.set(rows); }
  protected async load(_ctx: SourceContext): Promise<void> {}
  private feat(r: P, i: number): Feature<P> { return rowFeature(r as Props, i, this.o) as Feature<P>; }
  /** replace every row */
  set(rows: P[] | readonly P[] | { features: unknown[] }): this {
    const list = Array.isArray(rows) ? rows.map((r, i) => this.feat(r as P, i)) : normalize(rows, { id: this.o.id, where: this.id }) as Feature<P>[];
    const shapes = list.length !== this.list.length || list.some((f) => !sameShape(this.byId.get(f.id) as Feature | undefined, f as Feature));
    this.replace(list, shapes);
    return this;
  }
  /** add or replace rows by id */
  upsert(rows: P[]): this {
    let shapes = false; const list = [...this.list];
    const at = new Map(list.map((f, i) => [f.id, i]));
    rows.forEach((r, k) => {
      const f = this.feat(r, list.length + k), i = at.get(f.id);
      if (i === undefined) { at.set(f.id, list.length); list.push(f); shapes = true; } else { if (!sameShape(list[i] as Feature, f as Feature)) shapes = true; list[i] = f; }
    });
    this.replace(list, shapes);
    return this;
  }
  /** change some props of one row */
  patch(id: string | number, change: Partial<P>): this {
    const f = this.get(id); if (!f) throw new AslnutError('E-DATA-001', `no row '${id}'`, { where: this.id, fix: 'upsert it first' });
    const g = this.feat({ ...(f.props as object), ...(change as object) } as P, 0);
    const list = this.list.map((x) => (x === f ? { ...g, id: f.id } : x));
    this.replace(list, !sameShape(f as Feature, g as Feature));
    return this;
  }
  remove(...ids: (string | number)[]): this {
    const gone = new Set(ids.map(String));
    this.replace(this.list.filter((f) => !gone.has(String(f.id))), true);
    return this;
  }
  /** the rows themselves */
  rows(): P[] { return this.list.map((f) => f.props); }
}

/** a function whose answer becomes the rows; it runs again when `deps(s)` changes (and every `every` seconds), only
 *  while `when` holds. Its answer: rows (an array), or GeoJSON */
export interface QueryOptions<P> extends RowOptions {
  /** what it depends on: it runs again when this changes (default: runs once) */
  deps?: (s: State) => unknown;
  when?: When;
  /** seconds between runs (polling) */
  every?: number;
  /** ms to wait after deps change before running (default 150: a dragged slider runs once) */
  debounce?: number;
  /** the answer before it is rows (an API's envelope) */
  map?: (answer: unknown) => P[] | unknown;
}
export class Query<P = Props> extends Rows<P> {
  private fn: (s: State) => unknown;
  private q: QueryOptions<P>;
  private key: string | null = null; private timer: ReturnType<typeof setTimeout> | null = null; private last = 0; private runs = 0; private flying = 0;
  private ctx: SourceContext | null = null;
  /** the deps of the answer shown now */
  answeredFor: unknown = undefined;
  constructor(fn: (s: State) => unknown, o: QueryOptions<P> = {}) {
    super([], o); this.fn = fn; this.q = o;
    if (typeof fn !== 'function') throw new AslnutError('E-DATA-001', 'data.query needs a function s => rows', { where: this.id, fix: 'data.query(s => fetch(`/api?year=${s.time.year}`).then(r => r.json()))' });
  }
  protected override async load(ctx: SourceContext): Promise<void> { this.ctx = ctx; }
  override frame(s: State, ctx: SourceContext): void {
    this.ctx ??= ctx;
    if (this.q.when !== undefined && shown(this.q.when, s, `query '${this.id}'`) <= 0) return;
    const dep = this.q.deps ? this.q.deps(s) : null, key = JSON.stringify(dep) ?? 'undefined';
    const now = s.time.t;
    const due = this.q.every && this.runs > 0 && now - this.last >= this.q.every;
    if (key === this.key && !due) return;
    this.key = key;
    if (this.timer) clearTimeout(this.timer);
    const go = () => { this.timer = null; this.last = s.time.t; void this.run(s, dep); };
    if (this.runs === 0 || due || !(this.q.debounce ?? 150)) go(); else this.timer = setTimeout(go, this.q.debounce ?? 150);
  }
  /** run it now (with the last state) */
  refresh(): Promise<void> { return this.run(null, this.answeredFor); }
  private lastS: State | null = null;
  private async run(s: State | null, dep: unknown): Promise<void> {
    if (s) this.lastS = s;
    const st = this.lastS; if (!st) return;
    const n = ++this.runs; this.flying++;
    try {
      const a = await this.track(Promise.resolve(this.fn(st)));
      if (n !== this.runs) return;   // a newer run answered (or will): this one is stale
      const v = this.q.map ? this.q.map(a) : a;
      this.set(v as P[]); this.answeredFor = dep; this.failure = null;
    } catch (e) { this.failure = e instanceof Error ? e : new Error(String(e)); this.ctx?.error(new AslnutError('E-DATA-002', `query '${this.id}' failed: ${this.failure.message}`, { where: this.id, fix: 'check the function and the service it calls', cause: e })); }
    finally { this.flying--; }
  }
  override status() { const st = super.status(); if (this.timer) st.pending.push(`query '${this.id}' waiting to run`); return st; }
}

/** live changes. A message is rows (upserted), or { set | upsert | remove | patch }. From a WebSocket URL, or your own
 *  `connect(emit)` (a simulation, a poller, another library); `connect` returns the function that stops it */
export type StreamMessage<P> = P[] | { set?: P[]; upsert?: P[]; remove?: (string | number)[]; patch?: { id: string | number; change: Partial<P> } };
export interface StreamOptions<P> extends RowOptions {
  url?: string;
  connect?: (emit: (m: StreamMessage<P>) => void) => (() => void) | void;
  /** a socket message → a stream message (default JSON.parse) */
  parse?: (data: unknown) => StreamMessage<P>;
  /** seconds before reconnecting a dropped socket (default 2, doubling to 30) */
  retry?: number;
}
export class Stream<P = Props> extends Rows<P> {
  private so: StreamOptions<P>; private stop: (() => void) | null = null; private ws: WebSocket | null = null; private closed = false;
  messages = 0;
  constructor(o: StreamOptions<P>) {
    super([], o); this.so = o;
    if (!o.url && typeof o.connect !== 'function') throw new AslnutError('E-DATA-001', 'data.stream needs a url or connect(emit)', { where: this.id, fix: "data.stream('wss://…') or data.stream({ connect: emit => { … } })" });
  }
  protected override async load(ctx: SourceContext): Promise<void> {
    const emit = (m: StreamMessage<P>) => { if (this.closed) return; this.messages++; this.apply(m); };
    if (this.so.connect) { const s = this.so.connect(emit); this.stop = typeof s === 'function' ? s : null; return; }
    let wait = (this.so.retry ?? 2) * 1000;
    const open = () => {
      if (this.closed || typeof WebSocket === 'undefined') return;
      const ws = new WebSocket(this.so.url!); this.ws = ws;
      ws.onmessage = (e) => { try { emit((this.so.parse ?? ((d) => JSON.parse(String(d))))(e.data) as StreamMessage<P>); } catch (err) { ctx.error(new AslnutError('E-DATA-002', `stream '${this.id}': a message could not be read: ${(err as Error).message}`, { where: this.id, fix: 'send JSON rows or { upsert, remove }; or give parse()' })); } };
      ws.onopen = () => { wait = (this.so.retry ?? 2) * 1000; };
      ws.onclose = () => { if (!this.closed) { setTimeout(open, wait); wait = Math.min(30000, wait * 2); } };
    };
    open();
  }
  private apply(m: StreamMessage<P>): void {
    if (Array.isArray(m)) { this.upsert(m); return; }
    if (m.set) this.set(m.set);
    if (m.upsert) this.upsert(m.upsert);
    if (m.patch && this.get(m.patch.id)) this.patch(m.patch.id, m.patch.change);
    if (m.remove?.length) this.remove(...m.remove);
  }
  close(): void { this.closed = true; this.stop?.(); this.ws?.close(); this.ws = null; }
}

/** a GeoJSON file or object */
export interface GeoJSONOptions { id?: IdRule; attribution?: string }
export class GeoJSON extends Source {
  private input: string | object; private go: GeoJSONOptions;
  constructor(input: string | object, o: GeoJSONOptions = {}) {
    super({ attribution: o.attribution });
    if (typeof input !== 'string' && (typeof input !== 'object' || input === null)) throw new AslnutError('E-DATA-001', 'data.geojson needs a URL or a GeoJSON object', { where: this.id, fix: "data.geojson('/data/suburbs.geojson', { id: 'code' })" });
    this.input = input; this.go = o;
    if (typeof input === 'object') this.replace(normalize(input, { id: o.id, where: this.id }));
  }
  protected async load(ctx: SourceContext): Promise<void> {
    if (typeof this.input !== 'string') return;
    const j = await ctx.loader.get(this.input, { kind: 'json' });
    if (j === null) throw new AslnutError('E-DATA-002', `nothing at ${this.input}`, { where: this.id, fix: 'check the URL' });
    this.replace(normalize(j, { id: this.go.id, where: this.id }));
  }
}

/** a table (CSV or TSV) */
export class CSV extends Rows {
  private input: string; private co: CSVOptions & RowOptions;
  constructor(input: string, o: CSVOptions & RowOptions = {}) { super([], o); this.input = input; this.co = o; if (input.includes('\n')) this.set(parseCSV(input, o, this.id)); }
  protected override async load(ctx: SourceContext): Promise<void> {
    if (this.input.includes('\n')) return;
    const t = await ctx.loader.get<string>(this.input, { kind: 'text' });
    if (t === null) throw new AslnutError('E-DATA-002', `nothing at ${this.input}`, { where: this.id, fix: 'check the URL' });
    this.set(parseCSV(t, this.co, this.id));
  }
}

/** your own loader: a function giving features, GeoJSON or rows */
export class Custom<P = Props> extends Rows<P> {
  private fn: (ctx: SourceContext) => unknown;
  constructor(o: RowOptions & { load: (ctx: SourceContext) => unknown }) { super([], o); this.fn = o.load; if (typeof o.load !== 'function') throw new AslnutError('E-DATA-001', 'data.custom needs load()', { where: this.id, fix: 'data.custom({ load: async ctx => myFeatures })' }); }
  protected override async load(ctx: SourceContext): Promise<void> {
    const v = await this.fn(ctx);
    if (Array.isArray(v) && v.length && (v[0] as Feature).geometry !== undefined && (v[0] as Feature).props !== undefined) this.replace(v as Feature<P>[]);
    else this.set(v as P[]);
  }
}

/** PMTiles: one file of MVT tiles read by byte ranges */
export type PMTilesOptions = TiledOptions;
/** z/x/y tiles at a URL template ({z}, {x}, {y}; {-y} for TMS): their levels and extent */
export interface TemplateOptions extends TiledOptions { minZoom?: number; maxZoom?: number; bounds?: [number, number, number, number] }
/** tiled vector data in one PMTiles file (MVT tiles), read in pieces for the view */
export class PMTiles extends Tiled {
  private url: string; private reader: PMTilesReader | null = null; header: Header | null = null;
  constructor(url: string, o: PMTilesOptions = {}) { super(o); this.url = url; if (typeof url !== 'string') throw new AslnutError('E-DATA-001', 'data.pmtiles needs a URL', { where: this.id, fix: "data.pmtiles('/tiles/suburbs.pmtiles')" }); }
  protected async load(ctx: SourceContext): Promise<void> {
    this.ctx = ctx;
    const fetchRange = async (offset: number, length: number) => {
      // (the loader's range is [offset, length])
      const b = await ctx.loader.get<ArrayBuffer>({ url: this.url, range: [offset, length] }, { kind: 'bytes' });
      if (!b) throw new AslnutError('E-DATA-002', `nothing at ${this.url}`, { where: this.id, fix: 'check the URL (and that the server answers byte ranges)' });
      return new Uint8Array(b);
    };
    this.reader = await new PMTilesReader(fetchRange, gunzip).open();
    this.header = this.reader.header; this.range = { minZoom: this.header.minZoom, maxZoom: this.header.maxZoom, bounds: this.header.bounds as [number, number, number, number] };
    if (typeof this.to.zoom === 'number') this.need(this.to.zoom, this.range.bounds);
  }
  protected async tile(z: number, x: number, y: number): Promise<Feature[] | null> {
    const b = await this.reader!.tile(z, x, y); return b ? this.mvt(b, z, x, y, this.header!.tileCompression) : null;
  }
}
/** z/x/y tiles at a URL template: MVT ('mvt') or GeoJSON ('geojson') */
export class TemplateTiles extends Tiled {
  private url: string; private format: 'mvt' | 'geojson';
  constructor(url: string, format: 'mvt' | 'geojson', o: TemplateOptions = {}) {
    super(o); this.url = url; this.format = format;
    if (typeof url !== 'string' || !url.includes('{z}')) throw new AslnutError('E-DATA-001', `data.${format === 'mvt' ? 'mvt' : 'geojson'} tiles need a URL with {z}, {x} and {y}`, { where: this.id, fix: `data.${format === 'mvt' ? 'mvt' : 'geojson'}('/tiles/{z}/{x}/{y}.${format === 'mvt' ? 'pbf' : 'geojson'}')` });
  }
  protected async load(ctx: SourceContext): Promise<void> {
    this.ctx = ctx; const o = this.to as TemplateOptions;
    this.range = { minZoom: o.minZoom ?? 0, maxZoom: o.maxZoom ?? 14, bounds: o.bounds ?? [-180, -85.05, 180, 85.05] };
    if (typeof o.zoom === 'number') this.need(o.zoom, this.range.bounds);
  }
  protected async tile(z: number, x: number, y: number, ctx: SourceContext): Promise<Feature[] | null> {
    const url = this.url.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)).replace('{-y}', String(2 ** z - 1 - y));
    if (this.format === 'geojson') { const j = await ctx.loader.get<object>(url, { kind: 'json' }); return j ? normalize(j, { id: this.to.id, where: this.id }) : null; }
    const b = await ctx.loader.get<ArrayBuffer>(url, { kind: 'bytes' });
    return b ? this.mvt(new Uint8Array(b), z, x, y, Compression.Gzip) : null;
  }
}
/** the factories */
export const data = {
  /** a GeoJSON file or object; a URL with {z}/{x}/{y}: GeoJSON tiles for the view */
  geojson: (input: string | object, o?: GeoJSONOptions & TemplateOptions): Source => (typeof input === 'string' && input.includes('{z}') ? new TemplateTiles(input, 'geojson', o) : new GeoJSON(input, o)),
  /** MVT tiles at a z/x/y URL template, loaded for the view */
  mvt: (url: string, o?: TemplateOptions) => new TemplateTiles(url, 'mvt', o),
  csv: (input: string, o?: CSVOptions & RowOptions) => new CSV(input, o),
  pmtiles: (url: string, o?: PMTilesOptions) => new PMTiles(url, o),
  rows: <P = Props>(rows?: P[], o?: RowOptions) => new Rows<P>(rows, o),
  query: <P = Props>(fn: (s: State) => unknown, o?: QueryOptions<P>) => new Query<P>(fn, o),
  stream: <P = Props>(o: string | StreamOptions<P>) => new Stream<P>(typeof o === 'string' ? { url: o } : o),
  custom: <P = Props>(o: RowOptions & { load: (ctx: SourceContext) => unknown }) => new Custom<P>(o),
  /** an OGC web feature service's layer, asked by the view's tiles (paged, kept); wfs.capabilities / wfs.describe read the service */
  wfs,
};
