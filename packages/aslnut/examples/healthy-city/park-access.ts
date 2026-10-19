// Park access, on what the street level has loaded: from every house, the distance to the nearest park, as the crow
// flies (to the park's edge) or walking the footpaths (the baked walking graph: footpaths, crossings, the links from
// the kerb ramps, the paths through parks; to a park entrance: a point of it within 30 m of a park).
// The place is worked out once, off the main thread (access-place.ts in access.worker.ts): the walking graph, the
// parks, their entrances, one pass from every entrance at once (aslnut's networks), the walk bands. Each house is
// answered once, as its tile arrives: only the new ones are asked for and only their records written (the arcs, the
// ways as one tree, the tint). A tap on a mode works nothing out again: it shows the other layers, tints the houses by
// the other distance and writes the panel.
// Houses are tinted green → yellow → red, each house's way to its park drawn (arcs, or the ways along the footpaths),
// all from one colour scale (the theme's ramp); the rest of the world is muted by the page's theme (an info view, as in
// a city builder: core › render › style › theme), whose subjects these layers are; the numbers in a panel.
import { arc, area, data, rgba, worker, type Element, type Streets, type World, type WorkerLane } from '../../src/index.ts';
import { accessPlace, type HouseAnswers, type PlaceInfo, type PlaceOptions } from './access-place.ts';
import { RouteTree } from './route-tree.ts';
import { log } from './page.ts';

type LonLat = [number, number];
export type Mode = 'straight' | 'roads';
export interface AccessStats { mode: Mode; houses: number; parks: number; nearest: number; farthest: number; median: number; mean: number; beyond400: number; beyond800: number; noPark: number; detourMedian?: number; entrances?: number; ms: number }
/** the distance's colours (near → far): the page's theme takes them as its one colour scale */
export const ACCESS_RAMP: [number, string][] = [[0, '#22c55e'], [0.5, '#facc15'], [1, '#ef4444']];
/** the layers park access draws: the subjects of the page's theme */
export const ACCESS_LAYERS = ['access-bands', 'access-routes', 'access-arcs'];
const OF_MODE: Record<Mode, string[]> = { straight: ['access-arcs'], roads: ['access-bands', 'access-routes'] };

export interface AccessOptions {
  /** the place's walking graph (tools › compile: walk.json) and its parks (open space, GeoJSON with a `group`) */
  walk: string; parks: string;
  /** the rest of the place's analysis (entrance distance, search, bands …): access-place.ts */
  place?: Omit<PlaceOptions, 'walk' | 'parks'>;
  /** 'twin' draws the ways as the twin dashboard did (arcs brighter at their top, the ways fainter) */
  look?: 'plain' | 'twin';
}
interface Known { s: number; w: number }
interface ArcRow { id: string; from: LonLat; to: LonLat; top: number; dist: number }
/** houses asked for: their keys, tiles and ids there, places (lon, lat) and roofs' tops */
interface Batch { keys: string[]; tiles: string[]; ids: number[]; at: number[]; top: number[] }

export class ParkAccess {
  mode: Mode = 'roads'; enabled = false;
  /** the dashes run along the arcs and the ways, from each house to its park */
  flow = false;
  readonly layers: Element[];
  private w: World; private street: Streets; private onStats: (s: AccessStats | null) => void; private o: AccessOptions;
  /** the colour scale: t (0 nearest … 1 farthest) → colour (the theme's ramp), and 65 of its colours ready */
  private colour: (t: number) => string; private lut: (readonly [number, number, number, number])[];
  private arcRows = data.rows([] as ArcRow[], { id: 'id' }); private bands = data.rows([], { id: 'id' });
  private arcs: Element; private routes: RouteTree;
  /** the place: worked out once (a worker lane; here where workers cannot run) */
  private lane: WorkerLane | null = null; private place: Promise<PlaceInfo | null> | null = null; private info: PlaceInfo | null = null;
  /** the place could not be worked out (its files): said once, nothing waits for it */
  private failed: unknown = null;
  /** each house answered: its straight distance and its walk (m); the tiles whose houses were asked for */
  private known = new Map<string, Known>(); private seenTiles = new Set<string>();
  /** the same by tile, then by the house's id there (what the tint asks for: no key made per house) */
  private byTile = new Map<string, Map<number, Known>>();
  /** each tile's arcs as answered, and the tiles whose arcs are drawn: only those of the tiles built now (a tile let go
   *  takes its arcs with it, built again it brings them back: never an arc from a house not drawn) */
  private arcsOf = new Map<string, ArcRow[]>(); private arcTiles = new Set<string>();
  private queue: Batch[] = []; private flying = 0; private lastMs = 0;
  /** each mode's range (the colour scale is relative to the houses answered) */
  private range: Record<Mode, [number, number]> = { straight: [0, 1], roads: [0, 1] };
  constructor(w: World, street: Streets, onStats: (s: AccessStats | null) => void, colour: (t: number) => string, o: AccessOptions) {
    this.w = w; this.street = street; this.onStats = onStats; this.colour = colour; this.o = o;
    this.lut = Array.from({ length: 65 }, (_, i) => { const c = rgba(colour(i / 64) as never); return [c[0]!, c[1]!, c[2]!, 0.85] as const; });
    const on = () => this.enabled, twin = o.look === 'twin';
    const tOf = (m: Mode, d: number) => { const [lo, hi] = this.range[m]; return Number.isFinite(d) ? Math.max(0, Math.min(1, (d - lo) / Math.max(1, hi - lo))) : 1; };
    this.arcs = arc({ id: 'access-arcs', data: this.arcRows as never, from: (d: { props: { from: LonLat } }) => d.props.from, to: (d: { props: { to: LonLat } }) => d.props.to, height: (d: { props: { dist: number } }) => Math.max(8, d.props.dist * 0.22), width: 0.8,
      // from the roof's top to the park, over the houses (nothing hides it)
      fromHeight: (d: { props: { top?: number } }) => (d.props.top ?? 0) + 0.3, over: true, color: (d: { props: { dist: number } }) => this.colour(tOf('straight', d.props.dist)), pickable: false, when: on,
      // the dashboard's arcs: dimmer at their ends, brightest at the top (along 0 → 1)
      ...(twin ? { opacity: 0.95, shader: { color: 'color = vec4f(color.rgb * (0.55 + 0.45 * sin(3.14159265 * along)), color.a);' } } : {}) } as never);
    this.routes = new RouteTree({ id: 'access-routes', width: 1.8, opacity: twin ? 0.6 : 0.9, lift: 1.6, order: 3, ramp: [colour(0), colour(0.5), colour(1)], busy: () => this.busy(), when: on });
    this.layers = [
      // (a wash on the ground, its roads and paths: the houses keep their own access colours)
      area({ id: 'access-bands', data: this.bands, color: (d) => (Number(d.props.within) <= 400 ? '#22c55e' : '#facc15'), opacity: 0.22, outline: { width: 1.2, color: '#ffffffaa' }, pickable: false, when: on, drape: 'ground' }),
      this.routes, this.arcs,
    ];
    // tiles arriving (more of the city loaded): only their houses are asked for (nothing worked out again)
    w.on('frame', () => { if (this.enabled) this.scan(); });
  }
  /** work still to come (the place, houses asked for): the world is not settled meanwhile */
  private busy(): boolean { return this.enabled && !this.failed && ((!!this.place && !this.info) || this.flying > 0 || this.queue.length > 0); }
  setEnabled(on: boolean): void {
    this.enabled = on;
    // the analysis look: what reads the toggle (a darker sky, a dark ground) follows
    this.w.toggle('analysis', on);
    this.show();
    if (on) { void this.start(); this.scan(); this.tint(); this.stats(); }
    else { this.street.tint(null); this.onStats(null); }
    this.w.invalidate();
  }
  /** the other distance: the other layers shown, the houses tinted by it, the panel (nothing worked out) */
  setMode(m: Mode): void { this.mode = m; if (!this.enabled) return; this.show(); this.tint(); this.stats(); this.w.invalidate(); log('access-mode', { mode: m }); }
  /** dashes running along the arcs and the ways, house → park (frames keep coming while they show) */
  setFlow(on: boolean): void {
    this.flow = on;
    (this.arcs as unknown as { setProps(p: object): void }).setProps(on ? { dashes: [7, 5], flow: 28 } : { dashes: undefined, flow: 0 });
    this.routes.setDashes(on ? 7 : 0, 5, 28);
    this.w.invalidate();
  }
  /** what is new on the street level asked for, the panel written (nothing worked out again) */
  run(): void { this.scan(); this.stats(); }
  /** the mode's layers shown, the other's hidden (made ready meanwhile: a tap shows them at once) */
  private show(): void {
    for (const [m, ids] of Object.entries(OF_MODE) as [Mode, string[]][]) for (const id of ids) {
      if (!this.enabled || m === this.mode) this.w.release(id); else this.w.hide(id);
    }
  }
  /** the place, worked out once */
  private start(): Promise<PlaceInfo | null> {
    return (this.place ??= (async () => {
      const t0 = performance.now();
      this.lane ??= worker(() => new Worker(new URL('./access.worker.ts', import.meta.url), { type: 'module' }), { count: 1, fallback: accessPlace() as never });
      const info = await this.lane.call<PlaceInfo>('load', { ...this.o.place, walk: this.o.walk, parks: this.o.parks } satisfies PlaceOptions);
      this.info = info;
      this.bands.set({ type: 'FeatureCollection', features: info.bands } as never);
      log('access-place', { nodes: info.nodes, entrances: info.entrances, parks: info.parks, ...Object.fromEntries(Object.entries(info.ms).map(([k, v]) => [k, Math.round(v)])), ms: Math.round(performance.now() - t0), worker: this.lane.size > 0 });
      this.stats(); this.w.invalidate();
      return info;
    })().catch((e: unknown) => { this.failed = e; this.w.error(e); return null; }));
  }
  /** the houses of tiles not seen yet: asked for (a batch a time) */
  private scan(): void {
    const keys: string[] = [], tiles: string[] = [], ids: number[] = [], at: number[] = [], top: number[] = [];
    const built = this.street.built();
    this.drawnArcs(new Set(built.map((b) => b.key)));
    for (const b of built) {
      const e = b.extra; if (!e || this.seenTiles.has(b.key)) continue;
      this.seenTiles.add(b.key);
      for (const h of e.houses) {
        if (h.id < 0) continue;
        const k = `${b.key}:${h.id}`; if (this.known.has(k)) continue;
        const p = b.ctx.lonLat(h.x, h.z); keys.push(k); tiles.push(b.key); ids.push(h.id); at.push(p[0], p[1]); top.push(h.top);
      }
    }
    if (keys.length) { this.queue.push({ keys, tiles, ids, at, top }); void this.pump(); }
  }
  /** the arcs of the tiles built now drawn, those of the tiles let go taken away (their answers kept) */
  private drawnArcs(built: Set<string>): void {
    const add: ArcRow[] = [], gone: string[] = [];
    for (const [t, rows] of this.arcsOf) {
      const on = built.has(t), was = this.arcTiles.has(t);
      if (on && !was) { this.arcTiles.add(t); for (const r of rows) add.push(r); }
      else if (!on && was) { this.arcTiles.delete(t); for (const r of rows) gone.push(r.id); }
    }
    if (gone.length) this.arcRows.remove(...gone);
    if (add.length) this.arcRows.upsert(add);
  }
  private async pump(): Promise<void> {
    if (this.flying) return;
    this.flying++;
    try {
      if (!(await this.start())) return;
      while (this.queue.length) {
        const qs = this.queue.splice(0), batch: Batch = { keys: qs.flatMap((q) => q.keys), tiles: qs.flatMap((q) => q.tiles), ids: qs.flatMap((q) => q.ids), at: qs.flatMap((q) => q.at), top: qs.flatMap((q) => q.top) };
        const ans = await this.lane!.call<HouseAnswers>('houses', Float64Array.from(batch.at));
        this.apply(batch, ans);
      }
    } catch (e) { this.w.error(e); } finally { this.flying--; this.w.invalidate(); }
  }
  /** a batch answered: its arcs, its stretches of way, the tint and the panel (only the new written) */
  private apply(batch: Batch, a: HouseAnswers): void {
    const t0 = performance.now(), rows: ArcRow[] = [], ways: number[] = [];
    let routes = 0;
    for (let i = 0; i < batch.keys.length; i++) {
      const s = a.straight[i]!, wk = a.walk[i]!, key = batch.keys[i]!;
      const kn = { s, w: wk }; this.known.set(key, kn);
      let bt = this.byTile.get(batch.tiles[i]!); if (!bt) this.byTile.set(batch.tiles[i]!, (bt = new Map())); bt.set(batch.ids[i]!, kn);
      if (Number.isFinite(s)) { const row: ArcRow = { id: key, from: [batch.at[i * 2]!, batch.at[i * 2 + 1]!], to: [a.at[i * 2]!, a.at[i * 2 + 1]!], top: batch.top[i]!, dist: s }, t = batch.tiles[i]!; let l = this.arcsOf.get(t); if (!l) this.arcsOf.set(t, (l = [])); l.push(row); if (this.arcTiles.has(t)) rows.push(row); }
      const v0 = a.offs[i]!, v1 = a.offs[i + 1]!;
      if (v1 - v0 >= 2) { routes++; for (let v = v0; v + 1 < v1; v++) for (let k = 0; k < 6; k++) ways.push(a.verts[v * 3 + k]!); }
    }
    this.rescale();
    // (the arcs of the tiles drawn now: those of the tiles answered here drawn at once, a tile let go meanwhile keeps
    // its arcs for when it is built again)
    if (rows.length) this.arcRows.upsert(rows);
    this.drawnArcs(new Set(this.street.built().map((b) => b.key)));
    this.routes.append(Float64Array.from(ways), routes);
    this.tint(); this.stats();
    this.lastMs = a.ms;
    log('access-houses', { houses: batch.keys.length, ways: ways.length / 6, worker: Math.round(a.ms), here: Math.round(performance.now() - t0) });
  }
  /** each mode's range over the houses answered: the ways' uniform, the arcs restyled when theirs moved */
  private rescale(): void {
    const r: Record<Mode, [number, number]> = { straight: [Infinity, -Infinity], roads: [Infinity, -Infinity] };
    for (const k of this.known.values()) {
      if (Number.isFinite(k.s)) { if (k.s < r.straight[0]) r.straight[0] = k.s; if (k.s > r.straight[1]) r.straight[1] = k.s; }
      if (Number.isFinite(k.w)) { if (k.w < r.roads[0]) r.roads[0] = k.w; if (k.w > r.roads[1]) r.roads[1] = k.w; }
    }
    for (const m of ['straight', 'roads'] as Mode[]) if (!Number.isFinite(r[m][0])) r[m] = [0, 1];
    const moved = r.straight[0] !== this.range.straight[0] || r.straight[1] !== this.range.straight[1];
    this.range = r;
    this.routes.setScale(r.roads[0], r.roads[1]);
    if (moved) (this.arcs as unknown as { setProps(p: object): void }).setProps({});
  }
  /** houses by the mode's distance, from the colour scale (what is tinted is the theme's subject) */
  private tint(): void {
    if (!this.enabled) return;
    const m = this.mode, [lo, hi] = this.range[m], span = Math.max(1, hi - lo), byTile = this.byTile, lut = this.lut;
    // (asked for every thing of every tile: the tile's houses looked up once a tile)
    let tile = '', here: Map<number, Known> | undefined;
    this.street.tint((_info, chunk, id) => {
      if (chunk !== tile) { tile = chunk; here = byTile.get(chunk); }
      const k = here?.get(id); if (!k) return null;
      const d = m === 'roads' ? k.w : k.s, t = Number.isFinite(d) ? Math.max(0, Math.min(1, (d - lo) / span)) : 1;
      return lut[Math.round(t * 64)]!;
    });
  }
  /** the panel's numbers, from the houses answered (one pass, typed sorts) */
  private stats(): void {
    if (!this.enabled) return;
    if (!this.known.size) { this.onStats(null); return; }
    const m = this.mode, all = new Float64Array(this.known.size), dt = new Float64Array(this.known.size);
    let n = 0, nd = 0, sum = 0, b4 = 0, b8 = 0;
    for (const k of this.known.values()) {
      const d = m === 'roads' ? k.w : k.s;
      if (Number.isFinite(d)) { all[n++] = d; sum += d; if (d > 400) b4++; if (d > 800) b8++; }
      if (m === 'roads' && k.s > 20 && Number.isFinite(k.s) && Number.isFinite(k.w)) dt[nd++] = k.w / k.s;
    }
    const ds = all.subarray(0, n).sort(), detours = dt.subarray(0, nd).sort(), c = Math.max(1, n);
    this.onStats({
      mode: m, houses: this.known.size, parks: this.info?.parks ?? 0, nearest: n ? ds[0]! : 0, farthest: n ? ds[n - 1]! : 0, median: n ? ds[n >> 1]! : 0, mean: sum / c,
      beyond400: b4 / c, beyond800: b8 / c, noPark: this.known.size - n, detourMedian: nd ? detours[nd >> 1] : undefined, entrances: m === 'roads' ? this.info?.entrances : undefined, ms: Math.round(this.lastMs),
    });
  }
}

const fmt = (m: number) => (m >= 1000 ? `${(m / 1000).toFixed(2)} km` : `${Math.round(m)} m`);
const pct = (f: number) => `${Math.round(f * 100)}%`;
export function accessPanel(st: AccessStats | null, mode: Mode, flow = false): string {
  const what = mode === 'roads' ? 'Shortest walk along the footpaths (crossing the roads at the crossings, through the parks on their paths) from each house to a park entrance (a footpath point within 30 m of the park).' : 'Straight-line distance from each house to the nearest park edge (parks, sportsfields, natural open space, corridors).';
  return `<div class="t" data-fold="1">Park access ▾</div>
    <div class="qs"><button data-am="straight" class="${mode === 'straight' ? 'on' : ''}">Straight line</button><button data-am="roads" class="${mode === 'roads' ? 'on' : ''}">Along footpaths</button></div>
    <div class="desc">${what}</div>
    <div class="qs t-flow"><button data-flow="1" class="${flow ? 'on' : ''}" title="dashes running from each house to its park">moving</button></div>
    ${!st ? '<div class="desc">Fly to the street level (Clayton): the analysis runs on the houses loaded round the camera.</div>' : `
    <table>${[['Houses', st.houses.toLocaleString('en-AU')], ['Nearest', fmt(st.nearest), 'c-near'], ['Median', fmt(st.median), 'c-med'], ['Farthest', fmt(st.farthest), 'c-far'], ['Beyond 400 m', pct(st.beyond400)], ['Beyond 800 m', pct(st.beyond800)], ...(st.detourMedian ? [['Median detour', `× ${st.detourMedian.toFixed(2)} of a straight line`]] : []), ...(st.entrances !== undefined ? [['Park entrances', st.entrances.toLocaleString('en-AU')]] : [])].map(([k, v, c]) => `<tr><td class="k">${k}</td><td class="v${c ? ` ${c}` : ''}">${v}</td></tr>`).join('')}</table>
    <div style="height:8px;border-radius:4px;margin-top:6px;background:linear-gradient(90deg,#22c55e,#facc15,#ef4444)"></div>
    <div class="row" style="display:flex;justify-content:space-between;font-size:11px;color:#9aa7b4"><span>${fmt(st.nearest)}</span><span>relative to the loaded area</span><span>${fmt(st.farthest)}</span></div>
    ${st.noPark ? `<div class="desc" style="color:#fca5a5">${st.noPark} houses have no reachable park in the loaded area.</div>` : ''}
    <div class="desc">400 m ≈ a 5-minute walk, a common benchmark for local park access. ${st.ms} ms (off the page). Sources: VEAC open space, OpenStreetMap footpaths and Vicmap road reserves (baked), Overture buildings.</div>`}`;
}
