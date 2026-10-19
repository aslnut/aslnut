// modules › world › surface › street-detail: the street level, streamed as in a city-building game. Square tiles
// (500 m) of an area are fetched and built round the camera when it comes close, nearest first, a few at a time and a
// slice of milliseconds a frame (never a long frame); far ones are dropped. Each tile is built by your function into
// solids (core › geometry › shapes › solids): what a tile holds and how it looks is yours (earth.streets gives a city's
// roads, buildings, trees, parks and water from open data). Built in workers (core › runtime › workers), a build starts
// as the lane has room and its answer is put inside a frame, a few milliseconds of them a frame: one build path for
// every streamed layer (the street level's tiles, the baked roads).
//   streetDetail({ url: '/tiles/index.json', build: (tile, ctx) => ({ chunk: { mesh, instances, info } }) })
import { Solids, type SolidsChunk, type SolidsProps } from '../../../core/geometry/shapes/solids.ts';
import type { AttachContext, FrameContext, ElementStatus } from '../../../core/world/element.ts';
import { D } from '../../../core/space/geo.ts';
import type { WorkerLane } from '../../../core/runtime/workers.ts';
import type { Leveled } from '../../../core/observation/presence.ts';

/** a tiled area: the tiles' side (m), the origin [lon, lat] of their metric frame, which tiles exist */
export interface DetailIndex { size: number; origin: [number, number]; tiles: [number, number][]; attribution?: string; sources?: Record<string, { title: string; licence: string; url: string }> }
export interface DetailContext {
  ix: number; iz: number; size: number; origin: [number, number]; at: [number, number];
  /** the ground at a place of the tile (metres from its corner, x east, z south), true metres; NaN not known yet */
  groundAt(x: number, z: number): number;
  /** a place of the tile → [lon, lat] */
  lonLat(x: number, z: number): [number, number];
}
export interface DetailBuilt<E = unknown> { chunk: Omit<SolidsChunk, 'origin' | 'at'>; extra?: E }
export interface StreetDetailProps<T, E> extends SolidsProps {
  /** the index (or its URL): { size, origin, tiles } */
  url: string | DetailIndex;
  /** a tile's URL (default: next to the index, `${ix}_${iz}.json`) */
  tileUrl?: (ix: number, iz: number) => string;
  /** a tile's solids: at once, or a promise (built in a worker: core › runtime › workers) */
  build: (tile: T, ctx: DetailContext) => DetailBuilt<E> | Promise<DetailBuilt<E>>;
  /** it streams while the camera is nearer than this (m, default 4000); beyond 1.3 × that it lets go of every tile */
  near?: number;
  /** tiles fetched at once (default 6); ms of building a frame (default 8) */
  fetches?: number; budgetMs?: number;
  /** the workers your build runs in (core › runtime › workers): builds start as they have room (two a worker, counted
   *  over every streamed layer that builds in it), the nearest first, so a build the view has left behind waits for
   *  none of them; unset, at most 4 builds of this layer away at once */
  worker?: WorkerLane;
  /** ms of putting built tiles a frame (their uploads; default 3), shared by every streamed layer of the world, the
   *  nearest first; a layer left out two frames running puts one anyway; an answer for a tile no longer wanted is let go */
  putMs?: number;
  /** a tile was built (its extra: what your build function gave besides the solids) or dropped */
  onTile?: (key: string, extra: E | null, ctx: DetailContext | null) => void;
}
const KZ = 110574;
/** the ms the streamed layers of a world have put in its frame (n): one budget a frame, not one a layer */
const PUTS = new WeakMap<object, { n: number; ms: number; puts: number }>();
/** the builds of streamed layers away in a lane (its other calls, a terrain's clamp, not counted: they take no room) */
const AWAY = new WeakMap<WorkerLane, number>();
interface Slot<T, E> { state: 'loading' | 'ready' | 'building' | 'arrived' | 'built' | 'missing'; tile?: T; dist: number; got?: { b: DetailBuilt<E>; ctx: DetailContext } }

export class StreetDetail<T = unknown, E = unknown> extends Solids {
  // (a tile's roads, paths and kerbs lie on the ground in its mesh, its buildings beside them: a mark on the ground
  // paints what lies within GROUND_WITHIN m of the terrain)
  override readonly stands = false;
  declare props: StreetDetailProps<T, E>;
  private index: DetailIndex | null = null; private avail = new Set<string>();
  private slots = new Map<string, Slot<T, E>>(); private inflight = 0;
  private extras = new Map<string, { extra: E | undefined; ctx: DetailContext }>();
  private failure2: string | null = null;
  /** frames running this layer had answers to put and the frame's budget was spent by others */
  private skipped = 0;
  constructor(p: StreetDetailProps<T, E>) { super({ id: 'street', ...p }); }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    const u = this.props.url;
    this.index = typeof u === 'string' ? await ctx.loader.get<DetailIndex>(u, { kind: 'json', priority: 'soon' }) : u;
    if (!this.index?.tiles) { this.failure2 = 'no tile index'; return; }
    this.avail = new Set(this.index.tiles.map(([x, z]) => `${x}_${z}`));
  }
  private urlOf(ix: number, iz: number): string {
    if (this.props.tileUrl) return this.props.tileUrl(ix, iz);
    const u = typeof this.props.url === 'string' ? this.props.url : '';
    return `${u.replace(/[^/]*$/, '')}${ix}_${iz}.json`;
  }
  private ctxOf(ix: number, iz: number, world: FrameContext['world']): DetailContext {
    const ix0 = this.index!, kx = 111320 * Math.cos(ix0.origin[1] * D), at: [number, number] = [ix * ix0.size, iz * ix0.size];
    const lonLat = (x: number, z: number): [number, number] => [ix0.origin[0] + (at[0] + x) / kx, ix0.origin[1] - (at[1] + z) / KZ];
    return { ix, iz, size: ix0.size, origin: ix0.origin, at, lonLat, groundAt: (x, z) => { const [lo, la] = lonLat(x, z); return world.heightAt(lo, la); } };
  }
  /** the tiles built now, with what your build function gave besides the solids */
  built(): { key: string; extra: E | undefined; ctx: DetailContext }[] { return [...this.extras].map(([key, v]) => ({ key, ...v })); }
  /** the tiles built now as they came (your format), with their places */
  tiles(): { key: string; tile: T; ctx: DetailContext }[] {
    const out: { key: string; tile: T; ctx: DetailContext }[] = [];
    for (const [key, s] of this.slots) { const e = this.extras.get(key); if (s.state === 'built' && s.tile && e) out.push({ key, tile: s.tile, ctx: e.ctx }); }
    return out;
  }
  /** a tile built now as it came (your format); null: not built */
  builtTile(ix: number, iz: number): T | null { const s = this.slots.get(`${ix}_${iz}`); return s?.state === 'built' && s.tile && this.extras.has(`${ix}_${iz}`) ? s.tile : null; }
  /** build every tile again (a new look or a new filter): they are kept, so nothing is fetched again */
  rebuild(): this { for (const s of this.slots.values()) if ((s.state === 'built' || s.state === 'building' || s.state === 'arrived') && s.tile) { s.state = 'ready'; s.got = undefined; } (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); return this; }
  /** the index (null until loaded) */
  get area(): DetailIndex | null { return this.index; }
  override frame(ctx: FrameContext): ReturnType<Solids['frame']> {
    this.stream(ctx);
    return super.frame(ctx);
  }
  private stream(ctx: FrameContext): void {
    const ix0 = this.index; if (!ix0 || !this.attached) return;
    const cam = ctx.camera, near = this.props.near ?? 4000;
    const kx = 111320 * Math.cos(ix0.origin[1] * D), cx = (cam.lon - ix0.origin[0]) * kx, cz = -(cam.lat - ix0.origin[1]) * KZ, size = ix0.size;
    const far = cam.dist > near * 1.3;
    // the ground in view reaches about this far (the distance a zoom means, not the portrait screen's extra)
    const radius = Math.max(700, Math.min(2600, (cam.dist / cam.frameK) * 1.4));
    // what is wanted: tiles within the radius of the camera's centre, when near enough
    const want = new Map<string, number>();
    if (cam.dist <= near && cam.morph > 0.98) {
      for (let x = Math.floor((cx - radius) / size); x <= Math.floor((cx + radius) / size); x++) for (let z = Math.floor((cz - radius) / size); z <= Math.floor((cz + radius) / size); z++) {
        const k = `${x}_${z}`; if (!this.avail.has(k)) continue;
        const d = Math.hypot((x + 0.5) * size - cx, (z + 0.5) * size - cz);
        if (d <= radius + size * 0.7) want.set(k, d);
      }
    }
    // let go of what is far
    for (const [k, s] of this.slots) {
      if (want.has(k)) continue;
      const [x, z] = k.split('_').map(Number) as [number, number], d = Math.hypot((x + 0.5) * size - cx, (z + 0.5) * size - cz);
      if (far || d > Math.max(1200, cam.dist * 1.8) + size) { this.slots.delete(k); if (s.state === 'built') { this.drop(k); this.extras.delete(k); this.props.onTile?.(k, null, null); } }
      // fetched but no longer wanted (the view came closer): not built, and not waited for (fetched again, from the
      // loader's cache, if it is wanted again); built in a worker for a view left behind: not put
      else if (s.state === 'ready' || s.state === 'missing' || s.state === 'arrived') this.slots.delete(k);
    }
    // fetch the nearest first
    const order = [...want].sort((a, b) => a[1] - b[1]);
    for (const [k, d] of order) {
      const s = this.slots.get(k); if (s) { s.dist = d; continue; }
      if (this.inflight >= (this.props.fetches ?? 6)) continue;
      const [x, z] = k.split('_').map(Number) as [number, number];
      const slot: Slot<T, E> = { state: 'loading', dist: d }; this.slots.set(k, slot); this.inflight++;
      this.attached.loader.get<T>(this.urlOf(x, z), { kind: 'json', priority: 'now' })
        .then((t) => { if (this.slots.get(k) === slot) { slot.tile = t ?? undefined; slot.state = t ? 'ready' : 'missing'; } }, () => { if (this.slots.get(k) === slot) slot.state = 'missing'; })
        .finally(() => { this.inflight--; (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); });
    }
    const done = (k: string, b: DetailBuilt<E>, c: DetailContext) => {
      this.put(k, { ...b.chunk, origin: ix0.origin, at: c.at });
      this.extras.set(k, { extra: b.extra, ctx: c });
      this.props.onTile?.(k, b.extra ?? null, c);
    };
    // what came back from the workers put a slice of ms a frame (their uploads), the nearest first: one budget for
    // the frame, shared by the world's streamed layers (one left out two frames running puts one anyway); the answers
    // never land all at once between two frames
    const putMs = this.props.putMs ?? 3, fn = ctx.n ?? ctx.now, sh = PUTS.get(ctx.world) ?? { n: NaN, ms: 0, puts: 0 };
    if (sh.n !== fn) { sh.n = fn; sh.ms = 0; sh.puts = 0; PUTS.set(ctx.world, sh); }
    let puts = 0, waiting = false;
    for (const [k] of order) {
      const s = this.slots.get(k); if (!s || s.state !== 'arrived' || !s.got) continue;
      waiting = true;
      if (sh.puts && sh.ms >= putMs && (puts || this.skipped < 2)) break;
      const { b, ctx: c } = s.got, p0 = performance.now(); s.got = undefined; s.state = 'built'; puts++;
      try { done(k, b, c); } catch (e) { ctx.world.error(e); }
      sh.ms += performance.now() - p0; sh.puts++;
    }
    this.skipped = waiting && !puts ? this.skipped + 1 : 0;
    // build a slice a frame, the nearest first; a build that answers later (a worker's) started while its lane has room
    const t1 = performance.now(), budget = this.props.budgetMs ?? 8, lane = this.props.worker, room = lane ? Math.max(2, lane.size * 2) : 4;
    let away = 0; for (const s of this.slots.values()) if (s.state === 'building') away++;
    for (const [k] of order) {
      if (performance.now() - t1 > budget || (lane ? (AWAY.get(lane) ?? 0) >= room : away >= 4)) break;
      const s = this.slots.get(k); if (!s || s.state !== 'ready' || !s.tile) continue;
      const [x, z] = k.split('_').map(Number) as [number, number], c = this.ctxOf(x, z, ctx.world);
      try {
        const b = this.props.build(s.tile, c);
        if (b instanceof Promise) {
          s.state = 'building'; away++;
          if (lane) AWAY.set(lane, (AWAY.get(lane) ?? 0) + 1);
          b.finally(() => { if (lane) AWAY.set(lane, (AWAY.get(lane) ?? 1) - 1); }).catch(() => {});
          b.then((r) => { if (this.slots.get(k) === s && s.state === 'building') { s.got = { b: r, ctx: c }; s.state = 'arrived'; } }, (e) => { ctx.world.error(e); if (this.slots.get(k) === s && s.state === 'building') s.state = 'built'; })
            .finally(() => (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.());
          continue;
        }
        done(k, b, c);
      } catch (e) { ctx.world.error(e); }
      s.state = 'built';
    }
  }
  override status(): ElementStatus {
    const st = super.status();
    if (this.failure2) st.failed.push({ what: this.id, error: this.failure2 });
    if (this.shown <= 0 && this.target <= 0) return st;
    let loading = 0, ready = 0; for (const s of this.slots.values()) { if (s.state === 'loading') loading++; if (s.state === 'ready' || s.state === 'building' || s.state === 'arrived') ready++; }
    if (loading) st.pending.push(`${loading} tile(s) loading`);
    if (ready) st.pending.push(`${ready} tile(s) building`);
    st.ready = !st.pending.length;
    return st;
  }
  override animating(): boolean { if (super.animating()) return true; for (const s of this.slots.values()) if (s.state === 'ready' || s.state === 'building' || s.state === 'arrived') return true; return false; }
  override attribution(): string[] { return this.index?.attribution ? [this.index.attribution] : []; }
  /** tiles loading, waiting to be built, built */
  tileCounts(): { loading: number; ready: number; built: number; available: number } {
    let loading = 0, ready = 0, built = 0; for (const s of this.slots.values()) { if (s.state === 'loading') loading++; else if (s.state === 'ready') ready++; else if (s.state === 'built') built++; }
    return { loading, ready, built, available: this.avail.size };
  }
}
export const streetDetail = <T, E>(p: Leveled<StreetDetailProps<T, E>>) => new StreetDetail<T, E>(p as StreetDetailProps<T, E>);
