// modules › world › surface › tiles: the surface's tile state, apart from any graphics. For the tiles a view wants it
// decides what to load (coarse to fine, from the screen's centre out, the camera's path ahead when there is room),
// when a drawn tile is revealed (with the rest of the view, then faded in over what was there), and what each tile
// shows meanwhile (its children zooming out, else its nearest loaded parent's piece, its parent's heights until its
// own rise in). Time is the world's clock (ms), never the wall clock: a capture steps it exactly, and `settle` is a
// pure function of the state.
import type { Priority } from '../../../core/data/loading/loader.ts';
import { D, mercY, tileBounds, wrap } from '../../../core/space/geo.ts';
import type { Want } from './quadtree.ts';

export const N = 33;            // mesh points per tile side (the shader's N)
export const REC = 28;          // floats per tile record (7 texels; the 7th: the ground marks' overlay, written by the surface)
/** a tile's number: z, x, y in one float64 (z ≤ 24); Map keys without strings (no garbage per lookup) */
export const tkey = (z: number, x: number, y: number): number => z + 32 * (x + 2 ** z * y);
/** a tile's key back to z, x, y */
export const untkey = (k: number): [number, number, number] => { const z = k % 32, r = (k - z) / 32, n = 2 ** z; return [z, r % n, Math.floor(r / n)]; };
export const tname = (z: number, x: number, y: number): string => `${z}/${x}/${y}`;
/** the most levels up a base tile's heights stand in for a tile's own (and answer heightAt) */
export const STAND_UP = 5;

export interface Entry {
  key: number; z: number; x: number; y: number;
  /** shown: its imagery layer (-1: nothing yet), the look it has, when revealed; heights since when */
  slot: number; ver: string; at: number; heights: boolean; hAt: number;
  /** the look it had before, fading out under the new one */
  prev: number;
  /** drawn, waiting to be revealed with the rest of the view */
  pend: { slot: number; ver: string; heights: boolean; done: number } | null;
  used: number; busy: boolean;
  /** a source failed: not before this time again; how many times in a row */
  retry: number; fails: number; lastError?: string;
  /** the loader had nothing for it (replay / offline), in this look: its ancestor stands in */
  missing?: string;
  /** its heights (m, before exaggeration), kept for ground queries, and the highest */
  h?: Float32Array; hmax?: number; hmin?: number;
  /** ms its heights take to rise in (default the set's fadeH; with the imagery's fade when they came with it) */
  hDur?: number;
  /** its heights are still coming (its imagery is shown already: heights never hold a tile's first image back) */
  hBusy?: boolean;
  /** asked for ahead of need (the camera's path) */
  soon?: boolean;
  /** in flight but no longer wanted (a fast zoom went past it): it no longer holds a place among the loads */
  stale?: boolean;
  /** stops its load in flight */
  stop?: AbortController;
  /** the look it last got only part of (its fast sources, not yet its slow ones): the next load waits for all */
  partial?: string;
}
/** what a load gives: the heights if they came with the imagery; else `later`, the promise of them; `partial` when
 *  only the sources that answered quickly were painted (the tile is drawn again, whole, right after) */
export interface Loaded { heights: Float32Array | null; partial?: boolean; later?: Promise<Float32Array | null>; /** loaded ahead of need without the sources whose terms allow no prefetching: not the whole look */ ahead?: boolean }
export interface TileOptions {
  layers: number; maxTiles: number;
  /** the coarsest levels, never evicted: the fallback of last resort */
  baseZ?: number;
  /** ms a new tile fades in over what was there; ms new terrain takes to rise; ms drawn tiles wait for the rest */
  fade?: number; fadeH?: number; hold?: number;
  /** loads at once */
  inflight?: number;
  /** draw tile e in look `ver` into layer `slot`; null: the look changed meanwhile. Throws when a source failed */
  load(e: Entry, ver: string, slot: number, o: { priority: Priority; prefetch: boolean; lenient: boolean; /** paint what is in after a short wait, the rest later */ hurry: boolean; /** aborted when the view went past the tile */ signal?: AbortSignal }): Promise<Loaded | null>;
  /** heights that came after the imagery: write them to layer `slot` */
  writeHeights?(slot: number, h: Float32Array): void;
  /** this error means "not to be had now" (replay / offline), not a failure */
  isMiss(err: unknown): boolean;
}
export interface TileStats { /** tiles drawn with nothing at all (no imagery, no loaded ancestor: the `missing` colour) */ holes: number; /** tiles shown with their quick sources only, the rest on the way */ partial: number; /** tiles drawn from an ancestor's piece while their own load */ standIns: number; visible: number; loading: number; cached: number; zMin: number; zMax: number; loads: number; failed: number; missed: number; free: number; waiting: number; inflight: number; /** loads stopped because the view went past */ aborted: number }
export interface SettleState { done: boolean; /** how many tiles are not done */ pending: number; failed: { tile: string; error: string }[]; missing: string[] }

export class TileSet {
  readonly cache = new Map<number, Entry>();
  /** the finest level holding heights (ground queries start there) */
  private hz = 0; private last: Entry | null = null;
  /** how many tiles under each tile (by its key) hold heights: none, and a place in it is answered by it alone */
  private finer = new Map<number, number>();
  /** a tile holding heights counted in (+1) or out (−1) by every tile above it */
  private countFiner(e: Entry, d: number): void {
    for (let z = e.z - 1, k = 1; z >= 0; z--, k++) { const key = tkey(z, e.x >> k, e.y >> k), n = (this.finer.get(key) ?? 0) + d; if (n > 0) this.finer.set(key, n); else this.finer.delete(key); }
  }
  readonly stats: TileStats = { partial: 0, holes: 0, standIns: 0, visible: 0, loading: 0, cached: 0, zMin: 0, zMax: 0, loads: 0, failed: 0, missed: 0, free: 0, waiting: 0, inflight: 0, aborted: 0 };
  readonly recs: Float32Array;
  /** the drawn tiles in record order: z, x, y each */
  readonly drawn: Int32Array;
  count = 0;
  /** bumped whenever heights change anywhere (draped layers re-read the ground then) */
  heightsVersion = 0;
  private mid = new Set<number>(); private wanted = new Set<Entry>(); private near = new Set<number>(); private busyNow = new Set<Entry>();
  /** an ancestor of it is shown already (its piece stands in while it loads) */
  ancestorShown(e: Entry): boolean { for (let u = 1; u <= e.z; u++) { const a = this.cache.get(tkey(e.z - u, e.x >> u, e.y >> u)); if (a && a.slot >= 0) return true; } return false; }
  /** still worth uploading: the view wants it, falls back on it, or the camera is on its way to it */
  wantedOrNear(e: Entry): boolean { return e.z <= this.o.baseZ || !!e.soon || this.near.has(e.key); }
  private free: number[] = []; private pending = new Set<Entry>(); private inflight = 0; private requestLimit = 0; private clock = 0; private now = 0;
  private o: Required<Omit<TileOptions, 'load' | 'isMiss' | 'writeHeights'>> & Pick<TileOptions, 'load' | 'isMiss' | 'writeHeights'>;
  private alive = true;
  constructor(o: TileOptions) {
    this.o = { baseZ: 2, fade: 280, fadeH: 600, hold: 250, inflight: 8, ...o };
    this.recs = new Float32Array(o.maxTiles * REC);
    this.drawn = new Int32Array(o.maxTiles * 3);
    for (let i = o.layers - 1; i >= 0; i--) this.free.push(i);
  }
  /** its layers now (the pool grows by need) */
  get layers(): number { return this.o.layers; }
  /** more layers: the new ones free (what was in the old ones was copied over) */
  grow(layers: number): void { for (let i = layers - 1; i >= this.o.layers; i--) this.free.push(i); this.o.layers = Math.max(this.o.layers, layers); }

  /** one frame: load what is missing, reveal what is ready, write the records. `now` is the world's clock (ms) */
  update(want: Want[], ver: string, now: number, centre: { lon: number; lat: number }, ahead: { tiles: Want[]; prefetch: (z: number) => boolean }[] = [], requestLimit = this.o.inflight): void {
    this.clock++; this.now = now; this.requestLimit = requestLimit;
    // 1. the base (z ≤ baseZ, a few tiles, kept for good): a tile entering the screen never shows a hole
    const B = this.o.baseZ;
    for (const t of want) { const u = t.z - Math.min(t.z, B); this.request(this.entry(t.z - u, t.x >> u, t.y >> u), ver); }
    const byCentre = [...want].sort((a, b) => a.c - b.c || a.d - b.d);
    const mid = this.mid; mid.clear();
    const fineFirst = requestLimit > this.o.inflight;
    // Motion sharpens the whole view coarsely first. A still opening already has the base as cover: its exact
    // tiles take the available slots first, so extra fallback requests do not add a round to startup.
    const fallbacks = () => {
      for (const t of byCentre) if (t.z > B + 2) {
        const own = this.cache.get(tkey(t.z, t.x, t.y));
        if (fineFirst && ((own?.slot ?? -1) >= 0 || own?.pend?.ver === ver)) continue;
        const k = tkey(t.z - 2, t.x >> 2, t.y >> 2);
        if (!mid.has(k)) { mid.add(k); this.request(this.entry(t.z - 2, t.x >> 2, t.y >> 2), ver); }
      }
    };
    if (!fineFirst) fallbacks();
    // 3. the tiles themselves, from the screen's centre out (not nearest first: a tilted view would sharpen in bands)
    let loading = 0;
    for (const t of byCentre) {
      const e = this.entry(t.z, t.x, t.y);
      if (!(e.slot >= 0 && e.ver === ver)) { if (e.missing !== ver && !(e.fails >= 3 && now < e.retry)) loading++; this.request(e, ver); }
    }
    if (fineFirst) fallbacks();
    // 4. where the camera is going, with room left only
    this.aheadOf(ahead, ver);
    // reveal: drawn tiles wait for the rest of the view (at most `hold` ms), then fade in together
    const wanted = this.wanted; wanted.clear();
    // what the view uses or falls back on: the wanted tiles and three levels of their ancestors
    const near = this.near; near.clear();
    for (const t of want) for (let u = 0; u <= 3 && u <= t.z; u++) near.add(tkey(t.z - u, t.x >> u, t.y >> u));
    // loads the view went past give their places to what it wants now (their answers still land in the cache)
    // and stop: the loader ends the fetch unless another tile still waits for it (record mode keeps every fetch)
    if (this.inflight > 0) for (const e of this.busyNow) if (!e.stale && !e.soon && e.z > B && !near.has(e.key)) { e.stale = true; this.inflight--; e.stop?.abort(); }
    let waiting = 0, oldest = Infinity, complete = true;
    for (const t of want) {
      const e = this.cache.get(tkey(t.z, t.x, t.y));
      // a wanted tile is in use though not drawn yet (its look in, waiting for the rest of the view): never the one that
      // gives its layers away (given away, its look was loaded again)
      if (e) { wanted.add(e); e.used = this.clock; }
      if (!e || !((e.slot >= 0 && e.ver === ver) || e.pend?.ver === ver || e.missing === ver)) complete = false;
      if (e?.pend) { waiting++; oldest = Math.min(oldest, e.pend.done); }
    }
    // nothing is held back while ground shows nothing at all (the first image, a jump far away)
    const revealAll = waiting > 0 && (complete || now - oldest > this.o.hold || this.stats.holes > 0);
    if (this.pending.size) for (const e of [...this.pending]) if (revealAll || !wanted.has(e)) this.reveal(e, now);
    for (const e of this.cache.values()) if (e.prev >= 0 && now - e.at > this.o.fade) { this.release(e.prev); e.prev = -1; }
    this.records(want, ver, centre);
    Object.assign(this.stats, { loading, cached: this.cache.size, free: this.free.length, waiting, inflight: this.inflight });
  }

  /** each wanted tile's record; still loading: its children (zooming out), else its nearest loaded parent's piece;
   *  anything in the current look before anything in an old one */
  private records(want: Want[], ver: string, centre: { lon: number; lat: number }): void {
    const recs = this.recs, l0 = centre.lon, m0 = mercY(centre.lat), now = this.now, o = this.o;
    let n = 0, zMin = 99, zMax = 0, holes = 0, standIns = 0, partial = 0;
    const fade = (t0: number, d: number) => (d <= 0 ? 1 : Math.min(1, Math.max(0, (now - t0) / d)));
    const sub = (q: number, x: number, y: number, up: number) => { const k = 2 ** up; recs[q] = 1 / k; recs[q + 1] = 1 / k; recs[q + 2] = (x - ((x >> up) << up)) / k; recs[q + 3] = (y - ((y >> up) << up)) / k; };
    const put = (z: number, x: number, y: number, e: Entry | undefined, up: number) => {
      const b = tileBounds(z, x, y), q = n * REC;
      recs[q] = wrap(b.w - l0) * D; recs[q + 1] = (b.e - b.w) * D; recs[q + 2] = b.n; recs[q + 3] = b.n - m0;
      const ok = !!e && e.slot >= 0;
      if (ok) e!.used = this.clock;
      if (!ok) holes++; else if (up > 0) standIns++;
      if (ok && e!.ver.endsWith('~partial')) partial++;
      recs[q + 4] = b.n - b.s;
      recs[q + 5] = ok ? e!.slot : -1;
      recs[q + 6] = ok && up === 0 && e!.heights ? e!.slot : -1;
      recs[q + 7] = y === 0 ? 1 : y === 2 ** z - 1 ? 2 : 0;
      sub(q + 8, x, y, up);
      const f = ok ? fade(e!.at, o.fade) : 1;
      let under = -1, uu = up;
      if (f < 1 && e!.prev >= 0) under = e!.prev;
      else if (f < 1) for (let u = up + 1; u <= z && under < 0; u++) { const p = this.cache.get(tkey(z - u, x >> u, y >> u)); if (p && p !== e && p.slot >= 0) { under = p.slot; uu = u; p.used = this.clock; } }
      recs[q + 12] = under; recs[q + 13] = f; recs[q + 14] = ok ? fade(e!.hAt, e!.hDur ?? o.fadeH) : 1;
      sub(q + 16, x, y, uu);
      // the heights under it until its own are in (and while they rise): the nearest ancestor that has some, but not
      // a base tile (the globe in a few tiles) more than STAND_UP levels up: its 33 × 33 heights over Java mix in the
      // sea floor, and a city view drawn on them sank kilometres below its neighbours, the sky showing through the
      // cracks. None: drawn at sea level (heightAt agrees: it skips the base levels then too)
      let hp = -1;
      for (let u = 1; u <= z && hp < 0 && !(z - u <= o.baseZ && u > STAND_UP); u++) { const a = this.cache.get(tkey(z - u, x >> u, y >> u)); if (a && a.slot >= 0 && a.heights) { hp = a.slot; sub(q + 20, x, y, u); a.used = this.clock; } }
      recs[q + 15] = hp;
      recs[q + 24] = -1; recs[q + 25] = 1; recs[q + 26] = 0; recs[q + 27] = 0;
      this.drawn[3 * n] = z; this.drawn[3 * n + 1] = x; this.drawn[3 * n + 2] = y;
      n++; zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
    };
    const cur = (e?: Entry) => !!e && e.slot >= 0 && e.ver === ver, any = (e?: Entry) => !!e && e.slot >= 0;
    const pick = (t: { z: number; x: number; y: number }, ok: (e?: Entry) => boolean): boolean => {
      const own = this.cache.get(tkey(t.z, t.x, t.y));
      if (ok(own)) { put(t.z, t.x, t.y, own, 0); return true; }
      const z1 = t.z + 1, x1 = 2 * t.x, y1 = 2 * t.y;
      const k0 = this.cache.get(tkey(z1, x1, y1)), k1 = this.cache.get(tkey(z1, x1 + 1, y1)), k2 = this.cache.get(tkey(z1, x1, y1 + 1)), k3 = this.cache.get(tkey(z1, x1 + 1, y1 + 1));
      if (n + 4 <= o.maxTiles && ok(k0) && ok(k1) && ok(k2) && ok(k3)) { put(z1, x1, y1, k0, 0); put(z1, x1 + 1, y1, k1, 0); put(z1, x1, y1 + 1, k2, 0); put(z1, x1 + 1, y1 + 1, k3, 0); return true; }
      for (let up = 1; up <= t.z; up++) { const e = this.cache.get(tkey(t.z - up, t.x >> up, t.y >> up)); if (ok(e)) { put(t.z, t.x, t.y, e, up); return true; } }
      return false;
    };
    for (const t of want) { if (n >= o.maxTiles) break; if (!pick(t, cur) && !pick(t, any)) put(t.z, t.x, t.y, undefined, 0); }
    this.count = n;
    Object.assign(this.stats, { visible: n, zMin: n ? zMin : 0, zMax, holes, standIns, partial });
  }

  /** how far the view is from done: every tile its own, in the current look, faded and risen in, nothing pending.
   *  A tile that failed (3 times) or that the loader could not have (replay / offline) is listed, not waited for */
  settle(want: Want[], ver: string): SettleState {
    let pending = 0; const failed: SettleState['failed'] = [], missing: string[] = [], now = this.now, o = this.o;
    for (const t of want) {
      const e = this.cache.get(tkey(t.z, t.x, t.y));
      if (e?.missing === ver) { missing.push(tname(t.z, t.x, t.y)); continue; }
      if (e && e.fails >= 3 && !(e.slot >= 0 && e.ver === ver)) { failed.push({ tile: tname(t.z, t.x, t.y), error: e.lastError ?? 'failed' }); continue; }
      if (!e || e.busy || e.pend || e.hBusy || e.slot < 0 || e.ver !== ver || now - e.at < o.fade || (e.heights && now - e.hAt < (e.hDur ?? o.fadeH)) || e.prev >= 0) pending++;
    }
    return { done: want.length > 0 && pending === 0, pending, failed, missing };
  }

  /** the ground's height (m, before exaggeration) at a place, from the finest tile loaded there; NaN if none */
  heightAt(lon: number, lat: number, maxZ = 20): number {
    const m = mercY(Math.max(-85.0511, Math.min(85.0511, lat))), u = (lon + 180) / 360, v = (Math.PI - m) / (2 * Math.PI);
    // the tile asked last first (queries come in runs along a line or over an area), then from the finest level down
    const l = this.last;
    // the base levels (the whole globe in a few tiles) answer only while nothing finer is known anywhere: a city
    // view waits for its own (the camera once sank 2 km onto a z2 tile's sea floor before Bandung's heights came)
    const zLow = this.hz > this.o.baseZ + STAND_UP ? this.o.baseZ + 1 : 0;
    // (the tile asked last, holding the place: the finest tile holding heights there is it or one under it, walked
    // down only where tiles under hold any; a grid of questions over a chunk asks a level or two, not every one)
    if (l?.h && l.z <= maxZ && l.z >= zLow) {
      let k = 2 ** l.z;
      if (Math.floor(u * k) === l.x && Math.floor(v * k) === l.y) {
        let best = l, z = l.z, key = l.key;
        while (z < maxZ && this.finer.has(key)) { z++; k *= 2; key = tkey(z, Math.floor(u * k), Math.floor(v * k)); const e = this.cache.get(key); if (e?.h) best = e; }
        if (best !== l) this.last = best;
        const kb = 2 ** best.z;
        return this.sample(best.h!, u * kb - best.x, v * kb - best.y);
      }
    }
    for (let z = Math.min(maxZ, this.hz); z >= zLow; z--) {
      const k = 2 ** z, fx = u * k, fy = v * k, x = Math.floor(fx), y = Math.floor(fy);
      const e = this.cache.get(tkey(z, x, y));
      if (!e?.h) continue;
      this.last = e;
      return this.sample(e.h, fx - x, fy - y);
    }
    return NaN;
  }
  private sample(h: Float32Array, tx: number, ty: number): number {
    const gx = tx * (N - 1), gy = ty * (N - 1), x0 = Math.min(N - 2, Math.floor(gx)), y0 = Math.min(N - 2, Math.floor(gy)), ax = gx - x0, ay = gy - y0;
    return (h[y0 * N + x0]! * (1 - ax) + h[y0 * N + x0 + 1]! * ax) * (1 - ay) + (h[(y0 + 1) * N + x0]! * (1 - ax) + h[(y0 + 1) * N + x0 + 1]! * ax) * ay;
  }
  /** bumped whenever a tile's heights are kept (ranges known so far may change) */
  keptN = 0;
  /** the highest ground in a tile (true m): its own heights, else its nearest ancestor's (a tile not loaded yet, or
   *  whose load failed, is drawn on its ancestor's heights: culled at sea level, it left a hole at the edge of a tilted
   *  view, the sky showing through) */
  hiOf(z: number, x: number, y: number): number {
    // asked for every tile the view visits, every frame: kept until a tile's heights are kept again
    if (this.hiSeen !== this.keptN) { this.hiMemo.clear(); this.hiSeen = this.keptN; }
    const key = tkey(z, x, y), memo = this.hiMemo.get(key); if (memo !== undefined) return memo;
    let out = this.hmaxAll;
    for (let u = 0; u <= z; u++) { const h = this.cache.get(tkey(z - u, x >> u, y >> u))?.hmax; if (h !== undefined) { out = h; break; } }
    // (nothing known above it either (their loads failed): the highest ground seen so far, culled as if that high)
    if (this.hiMemo.size > 20000) this.hiMemo.clear();
    this.hiMemo.set(key, out);
    return out;
  }
  private hiMemo = new Map<number, number>(); private hiSeen = -1;
  /** the highest ground of any tile loaded (true m) */
  private hmaxAll = 0;
  /** the lowest and highest ground the tiles may draw in a tile (true m): its finest heights known and those of up to
   *  three levels above (the ground rises in from them); [0, 0] joins in where nothing is known (drawn flat) */
  rangeOfTile(z: number, x: number, y: number, out: [number, number]): void {
    let lo = Infinity, hi = -Infinity, found = 0;
    for (let zz = Math.min(z, this.hz), k = z - zz; zz >= 0 && found < 4; zz--, k++) {
      const e = this.cache.get(tkey(zz, x >> k, y >> k));
      if (!e?.h) { if (found) found++; continue; }
      found++; if (e.hmin! < lo) lo = e.hmin!; if (e.hmax! > hi) hi = e.hmax!;
    }
    if (!found) { lo = 0; hi = 0; }
    out[0] = Math.min(lo, 0); out[1] = Math.max(hi, 0);
  }

  private entry(z: number, x: number, y: number): Entry {
    const key = tkey(z, x, y);
    let e = this.cache.get(key);
    if (!e) { e = { key, z, x, y, slot: -1, ver: '', at: 0, heights: false, hAt: 0, prev: -1, pend: null, used: this.clock, busy: false, retry: 0, fails: 0 }; this.cache.set(key, e); }
    return e;
  }
  private release(s: number): void { if (s >= 0) this.free.push(s); }
  /** a free layer for `asker`; else the least recently used tile gives its layers (never the base, never one loading,
   *  never one the view wants: used is set each frame for every wanted tile, drawn or not; never the asker itself:
   *  given away to itself, it went on loading outside the set and its answer landed in a layer no tile owned, one lost
   *  each time, until a pool had none left and the view stayed loading) */
  private slot(asker: Entry): number {
    if (this.free.length) return this.free.pop()!;
    let old: Entry | null = null;
    for (const e of this.cache.values()) if (e !== asker && !e.busy && e.z > this.o.baseZ && e.used < this.clock - 1 && (e.slot >= 0 || e.prev >= 0 || e.pend) && (!old || e.used < old.used)) old = e;
    if (!old) return -1;
    this.release(old.slot); this.release(old.prev); this.release(old.pend?.slot ?? -1);
    this.pending.delete(old); this.cache.delete(old.key); if (this.last === old) this.last = null; if (old.h) { this.hiSeen = -1; this.countFiner(old, -1); }
    // it owns nothing now: heights still on the way for it must not land in a layer another tile took
    old.slot = -1; old.prev = -1; old.pend = null;
    return this.free.pop() ?? -1;
  }
  private reveal(e: Entry, now: number): void {
    const p = e.pend; if (!p) return;
    this.release(e.prev);
    // a fade only over something shown (its old look, or an ancestor's piece): over nothing it is a reveal, and an
    // app's first view is shown as it is, complete (the reveal policy)
    const over = e.slot >= 0 || this.ancestorShown(e);
    e.prev = e.slot; e.slot = p.slot; e.ver = p.ver; e.at = over ? now : now - this.o.fade;
    // heights that come with the imagery rise with its fade (no longer than it): the view is complete when the
    // imagery is; heights that come later rise over `fadeH` under a picture already shown
    if (p.heights && !e.heights) { e.hAt = now; e.hDur = over ? this.o.fade : 0; }
    if (p.heights) this.heightsVersion++;
    e.heights = p.heights; e.pend = null; this.pending.delete(e);
  }
  /** where the camera is going (also between frames: a still view loads it), with room left only: the coarser
   *  levels first (`depth` of them, default 1), then exact */
  aheadOf(ahead: { tiles: Want[]; prefetch: (z: number) => boolean; depth?: number }[], ver: string): void {
    if (this.inflight >= 4) return;
    const B = this.o.baseZ;
    for (const a of ahead) {
      const aw = [...a.tiles].sort((p, q) => p.c - q.c);
      for (let d = a.depth ?? 1; d >= 1; d--) for (const t of aw) if (t.z > B + d) this.request(this.entry(t.z - d, t.x >> d, t.y >> d), ver, 'soon', a.prefetch(t.z - d));
      for (const t of aw) this.request(this.entry(t.z, t.x, t.y), ver, 'soon', a.prefetch(t.z));
      if (this.inflight >= 6) break;
    }
  }
  /** of these tiles, how many are loaded in this look (shown, waiting to be, or known to be missing) */
  had(tiles: Want[], ver: string): number {
    let n = 0;
    const ah = `${ver}~ahead`;
    for (const t of tiles) { const e = this.cache.get(tkey(t.z, t.x, t.y)); if (e && ((e.slot >= 0 && (e.ver === ver || e.ver === ah)) || e.pend?.ver === ver || e.pend?.ver === ah || e.missing === ver || e.fails >= 3)) n++; }
    return n;
  }
  private request(e: Entry, ver: string, priority: Priority = 'now', prefetch = false): void {
    if (!this.alive || e.busy || this.inflight >= this.requestLimit || this.now < e.retry) return;
    if ((e.slot >= 0 && e.ver === ver) || e.pend?.ver === ver || e.missing === ver) return;
    // (ahead of need, a look loaded ahead already is all it can have: the whole one waits for the view to reach it)
    if (prefetch && ((e.slot >= 0 && e.ver === `${ver}~ahead`) || e.pend?.ver === `${ver}~ahead`)) return;
    // the whole look of a tile shown partly waits while other ground shows nothing yet
    if (e.partial === ver && this.stats.holes > 0 && priority === 'now') return;
    const s = this.slot(e); if (s < 0) return;
    e.busy = true; this.inflight++; this.stats.loads++; e.soon = priority === 'soon'; e.stale = false; this.busyNow.add(e);
    const hurry = e.partial !== ver, stop = new AbortController(); e.stop = stop;
    this.o.load(e, ver, s, { priority, prefetch, lenient: e.fails >= 3, hurry, signal: stop.signal }).then((r) => {
      if (!this.alive) return;
      if (!r) { this.release(s); return; }
      if (e.pend) this.release(e.pend.slot);
      // a partial look counts as another look: shown now, and the whole one is asked for right after
      const look = r.partial ? `${ver}~partial` : r.ahead ? `${ver}~ahead` : ver;
      e.partial = r.partial ? ver : undefined;
      e.pend = { slot: s, ver: look, heights: !!r.heights, done: this.now }; this.pending.add(e); e.fails = 0; e.missing = undefined;
      if (r.heights) this.keepHeights(e, r.heights);
      if (r.later) {
        e.hBusy = true;
        r.later.then((h) => {
          if (!this.alive) return;
          e.hBusy = false;
          if (!h) return;
          const mine = this.cache.get(e.key) === e && (e.slot === s || e.pend?.slot === s);
          if (!mine) return;
          this.o.writeHeights?.(s, h);
          this.keepHeights(e, h);
          if (e.pend?.slot === s) e.pend.heights = true;
          else if (e.slot === s) { e.heights = true; e.hAt = this.now; e.hDur = this.o.fadeH; }
          this.heightsVersion++;
        }, (err: unknown) => {
          if (!this.alive) return;
          e.hBusy = false;
          if (stop.signal.aborted) return;
          // its heights failed: the tile keeps its imagery on its parent's heights, and is drawn again later
          e.fails++; e.lastError = String((err as Error)?.message ?? err); e.retry = this.now + Math.min(8000, 400 * 2 ** e.fails); this.stats.failed++;
          if (e.ver === ver) e.ver = `${ver}~noheights`;
        });
      }
    }, (err: unknown) => {
      if (!this.alive) return;
      this.release(s);
      // abandoned: the view went past it (not a failure; asked again if the view comes back)
      if (stop.signal.aborted) { this.stats.aborted++; return; }
      if (this.o.isMiss(err)) { e.missing = ver; e.retry = this.now + 5000; this.stats.missed++; return; }
      // a source failed (the network): keep what is shown, try again later (sooner the first times); after three
      // failures the failing sources are left out (lenient)
      e.fails++; e.lastError = String((err as Error)?.message ?? err); e.retry = this.now + Math.min(8000, 400 * 2 ** e.fails); this.stats.failed++;
    }).finally(() => { e.busy = false; this.busyNow.delete(e); if (!e.stale) this.inflight--; e.stale = false; if (e.stop === stop) e.stop = undefined; });
  }
  private keepHeights(e: Entry, h: Float32Array): void {
    this.keptN++;
    if (!e.h && this.cache.get(e.key) === e) this.countFiner(e, 1);
    e.h = h; let m = 0, lo = Infinity; for (let i = 0; i < h.length; i++) { const v = h[i]!; if (v > m) m = v; if (v < lo) lo = v; } e.hmax = m; e.hmin = Number.isFinite(lo) ? lo : 0;
    if (m > this.hmaxAll) this.hmaxAll = m;
    if (e.z > this.hz) this.hz = e.z;
  }
  /** forget everything (the surface's dispose) */
  dispose(): void { this.alive = false; this.cache.clear(); this.finer.clear(); this.pending.clear(); this.free = []; }
}
