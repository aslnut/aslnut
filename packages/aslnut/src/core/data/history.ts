// core › data › history: a log of state changes (where each thing was, when, and the values it carried), the state at
// any time from it, and its replay on the world's clock (play, pause, speed, seek). The log keeps data, not shapes:
// each thing's samples in typed-array columns of the smallest type that holds them (a place as two 16-bit numbers
// within the log's box, or two 32-bit floats; a time as 16-bit steps from the epoch, or a 32-bit float; each value
// as one byte over its domain, or a 32-bit float). The same columns go to the graphics chip as they are (core ›
// entities › sets draws from them); a live source only appends: the new samples are the only new bytes.
//   const log = history.log({ values: { charge: { type: 'u8', domain: [0, 1] } } })
//   log.append('bus-12', Date.now(), 145.12, -37.92, { charge: .8 })
//   log.stateAt(t)                       → every thing's place, heading, speed and values at t
//   const play = replay(w, { from: log.from, to: log.to, speed: 60, loop: true }); play.play(); play.seek(t)
//   history.log({ url: '/data/fleet.hist' })   a log saved by log.toBytes() (tools write it once; never in git)
//   history.fromColumns({ ids, count, t, lon, lat, values: { charge } })   a recorded track straight from its arrays
//   history.log({ altitude: 'ground' })   each sample's height too (metres over the ground, or over the sea: 'sea'): its
//   value `alt` (log.append(id, t, lon, lat, { alt: 120 }), a row's `alt`, a point's third coordinate)
import { AslnutError } from '../world/errors.ts';
import { D, mercY, latOfMercY, wrap, R } from '../space/geo.ts';
import type { Loader } from './loading/loader.ts';

export type PlaceType = 'u16' | 'f32';
export type TimeType = 'u16' | 'f32';
export type ValueType = 'u8' | 'f32';
/** a value a sample carries: its column type; a byte (u8) holds its domain in 255 steps */
/** a value a sample carries: its column type; a byte (u8) holds its domain in 255 steps; `step`: it holds from one
 *  sample to the next and changes at the next (a state, a count: never mixed between two samples, on the chip or here) */
export interface ValueSpec { type?: ValueType; domain?: [number, number]; step?: boolean }
/** each sample's height: metres over the ground (what it stands on) or over the sea, a value of its own (its column
 *  type and domain as any value's: a byte over [0, 150] m is 0.6 m a step; default a 32-bit float), named `value`
 *  (default 'alt') */
export interface AltitudeSpec extends ValueSpec { over?: 'ground' | 'sea'; value?: string }
export interface LogOptions {
  id?: string;
  /** the values each sample carries, by name (default none: a place and a time only) */
  values?: Record<string, ValueSpec | ValueType>;
  /** the place's column: 'u16' (each axis 0..65535 across `box` [w, s, e, n]: a 7 km box is 11 cm a step) or 'f32'
   *  (default 'f32': anywhere) */
  place?: { type?: PlaceType; box?: [number, number, number, number] };
  /** the time's column: 'u16' (steps of `step` seconds from `epoch`; 65535 steps at most: an hour and 49 minutes in
   *  tenths) or 'f32' (seconds from `epoch`; default) */
  time?: { type?: TimeType; epoch?: number | Date | string; step?: number };
  /** samples a live thing keeps (a ring: the oldest go as new ones come; default 512, at most 8191); Infinity: every
   *  one (its slots grow). A recorded log keeps every sample it was loaded with */
  keep?: number;
  /** a saved log (log.toBytes()) loaded through the world's loader when a layer first uses it */
  url?: string;
  /** keep each sample's metres along its thing's track since its first (a value 'travel', a 32-bit float, kept by the
   *  log as samples come or once loaded: what a wheel's joint rolls by: core › entities › kinematics) */
  travel?: boolean;
  /** each sample's height (a thing in the air): metres over the ground ('ground': over what it stands on) or over the
   *  sea ('sea': never under the ground there), its value `alt` (or yours: `value`) of the type given (default a 32-bit
   *  float); none by default (a set of them draws each thing on the ground) */
  altitude?: 'ground' | 'sea' | AltitudeSpec;
  attribution?: string;
}
/** a thing's state at one time */
export interface StateAt {
  id: string; index: number;
  lon: number; lat: number;
  /** degrees clockwise from north (from its path; held while it stands) */
  heading: number;
  /** metres a second along its path */
  speed: number;
  values: Record<string, number>;
  /** its constant props (as given on its first sample, or loaded) */
  props: Record<string, unknown>;
  /** before its first sample or after its last: it holds there */
  outside: -1 | 0 | 1;
  /** its height (m, over the ground or the sea: the log's altitude), between its samples; absent: the log has none */
  alt?: number;
}
/** a recorded track as arrays: each thing's samples one after another (thing by thing, each in time order), or where
 *  each thing's start */
export interface Columns {
  /** each thing's id, in order */
  ids: readonly (string | number)[];
  /** each thing's samples: how many */
  count: ArrayLike<number>;
  /** each thing's first sample in the arrays (default: one after another, by `count`) */
  start?: ArrayLike<number>;
  /** each sample's time, ms since 1970 (a Float64Array, or numbers) */
  t: ArrayLike<number>;
  /** each sample's place: its longitude and latitude (two arrays), or [lon, lat] pairs in one (`lonlat`) */
  lon?: ArrayLike<number>; lat?: ArrayLike<number>; lonlat?: ArrayLike<number>;
  /** each sample's values, by name (an array each) */
  values?: Record<string, ArrayLike<number>>;
  /** each sample's height, a log with an altitude (its value's own array: as `values.alt`) */
  alt?: ArrayLike<number>;
  /** each thing's constant props */
  props?: readonly (Record<string, unknown> | undefined)[];
}
/** what changed in the columns: a range of sample slots, or everything (they grew or moved) */
export type LogChange = { kind: 'samples'; lo: number; hi: number } | { kind: 'thing'; index: number } | { kind: 'all' };

const ROW = 4096, MAGIC = 'ASLNHST1', U16 = 65535;
const msOf = (t: number | Date | string): number => (typeof t === 'number' ? t : typeof t === 'string' ? Date.parse(t) : t.getTime());
let seq = 0;

/** the log: things (ids, constant props), each one's slots in the columns (start, count, capacity, head), the columns */
export class Log {
  readonly id: string;
  attribution: string;
  /** ms since 1970 of time 0 */
  epoch: number;
  readonly timeType: TimeType; readonly timeStep: number;
  readonly placeType: PlaceType;
  /** the origin of the places (lon, lat): places are kept as (longitude in radians, Mercator y) from it */
  lon0: number; lat0: number; m0: number;
  /** the place box in those units [x0, y0, x1, y1] (u16) */
  box: [number, number, number, number] = [0, 0, 0, 0];
  readonly values: { name: string; type: ValueType; domain: [number, number]; step?: boolean }[];
  readonly keep: number;
  /** it keeps each sample's metres along its thing's track (the value 'travel') */
  readonly travel: boolean;
  /** each sample's height: over the ground or the sea, the value that carries it; null: none (on the ground) */
  readonly altitude: { over: 'ground' | 'sea'; value: string } | null;
  /** the highest any sample is (m, the altitude's value; −Infinity: none yet): how near a thing up there may come to a
   *  camera (a set's shapes) */
  altMax = -Infinity;
  // ── things ──
  ids: string[] = []; private index = new Map<string, number>();
  props: Record<string, unknown>[] = [];
  /** per thing: its first slot, its samples, its slots, its oldest sample's place among them (a ring once full) */
  first = new Int32Array(64); count = new Int32Array(64); cap = new Int32Array(64); head = new Int32Array(64);
  /** per thing: it keeps every sample (a recorded one: loaded with its slots exactly its samples, it moves to the end
   *  with room when it grows); else a live one keeps `keep` (a ring once full) */
  private packed = new Uint8Array(64);
  /** per thing: slots between its samples (1: one after the other; a live thing's group: as many as the group holds
   *  things, its samples interleaved with theirs by place in the ring, so a stream's tick (a sample each) is one run
   *  of slots: one write) */
  stride = new Int32Array(64);
  /** the live things' group being filled: its first slot, its size (things), how many it holds */
  private group: { base: number; size: number; n: number } | null = null; private groups = 0;
  /** the box of every place so far (the origin's units), kept as samples come; null: not known yet (a loaded log
   *  reads it once) */
  seen: [number, number, number, number] | null = null;
  // ── the columns (slots; a multiple of 4096) ──
  slots = 0; used = 0;
  time: Uint16Array | Float32Array = new Float32Array(0);
  place: Uint16Array | Float32Array = new Float32Array(0);
  cols: (Uint8Array | Float32Array)[] = [];
  /** the fastest a thing moves anywhere in it (m/s): how far one may get in a while (the drawing's frames, its near set) */
  maxSpeed = 0;
  /** the first and last time of any sample (ms) */
  from = Infinity; to = -Infinity;
  /** bumped on every change */
  version = 0;
  private shared = false;
  private watchers = new Set<(c: LogChange) => void>();
  readonly url: string | null; private started: Promise<void> | null = null; private loaded = false;
  failure: Error | null = null;

  constructor(o: LogOptions = {}) {
    this.id = o.id ?? `log-${++seq}`; this.attribution = o.attribution ?? '';
    this.url = o.url ?? null;
    this.timeType = o.time?.type ?? 'f32'; this.timeStep = o.time?.step ?? 0.1;
    this.epoch = o.time?.epoch !== undefined ? msOf(o.time.epoch) : NaN;
    this.placeType = o.place?.type ?? 'f32';
    this.values = Object.entries(o.values ?? {}).map(([name, v]) => { const s = typeof v === 'string' ? { type: v } : v; return { name, type: s.type ?? 'f32', domain: s.domain ?? [0, 1], ...(s.step ? { step: true } : {}) }; });
    this.travel = !!o.travel; if (this.travel && !this.values.some((v) => v.name === 'travel')) this.values.push({ name: 'travel', type: 'f32', domain: [0, 1] });
    // (its altitude: a value of its own, unless the values name it already)
    const al = o.altitude ? (typeof o.altitude === 'string' ? { over: o.altitude } : o.altitude) : null;
    this.altitude = al ? { over: al.over ?? 'ground', value: al.value ?? 'alt' } : null;
    if (al && !this.values.some((v) => v.name === this.altitude!.value)) this.values.push({ name: this.altitude!.value, type: al.type ?? 'f32', domain: al.domain ?? [0, 1] });
    if (al && al.over !== undefined && al.over !== 'ground' && al.over !== 'sea') throw new AslnutError('E-DATA-001', `log '${this.id}': altitude over '${String(al.over)}'`, { where: this.id, fix: "altitude: 'ground' (metres over what it stands on) or 'sea' (metres over the sea)" });
    if (!(this.timeStep > 0)) throw new AslnutError('E-DATA-001', `log '${this.id}': time.step must be above 0`, { where: this.id, fix: 'time: { type: \'u16\', step: 0.1 }' });
    this.keep = o.keep === Infinity ? Infinity : Math.max(2, Math.min(8191, Math.round(o.keep ?? 512)));
    const b = o.place?.box;
    this.lon0 = b ? (b[0] + b[2]) / 2 : NaN; this.lat0 = b ? (b[1] + b[3]) / 2 : NaN; this.m0 = Number.isNaN(this.lat0) ? NaN : mercY(this.lat0);
    if (this.placeType === 'u16') {
      if (!b) throw new AslnutError('E-DATA-001', `log '${this.id}': a 16-bit place needs its box`, { where: this.id, fix: "place: { type: 'u16', box: [w, s, e, n] }" });
      const [x0, y0] = this.rel(b[0], b[1]), [x1, y1] = this.rel(b[2], b[3]);
      this.box = [x0, Math.min(y0, y1), x1, Math.max(y0, y1)];
    }
  }
  // ── places ──
  /** (lon, lat) → (radians of longitude, Mercator y) from the origin */
  rel(lon: number, lat: number): [number, number] { return [wrap(lon - this.lon0) * D, mercY(Math.max(-85.0511, Math.min(85.0511, lat))) - this.m0]; }
  lonLat(x: number, y: number): [number, number] { return [wrap(this.lon0 + x / D), latOfMercY(this.m0 + y)]; }
  /** a slot's place, in the origin's units */
  relAt(slot: number, out: [number, number] = [0, 0]): [number, number] {
    const p = this.place;
    if (this.placeType === 'u16') { const b = this.box; out[0] = b[0] + (p[2 * slot]! / U16) * (b[2] - b[0]); out[1] = b[1] + (p[2 * slot + 1]! / U16) * (b[3] - b[1]); }
    else { out[0] = p[2 * slot]!; out[1] = p[2 * slot + 1]!; }
    return out;
  }
  /** a slot's time, seconds from the epoch */
  secAt(slot: number): number { return this.timeType === 'u16' ? this.time[slot]! * this.timeStep : this.time[slot]!; }
  valueAt(k: number, slot: number): number { const v = this.values[k]!, c = this.cols[k]!; return v.type === 'u8' ? v.domain[0] + (c[slot]! / 255) * (v.domain[1] - v.domain[0]) : c[slot]!; }
  /** each sample's metres along its thing's track since its first (the value 'travel': its column made when it has
   *  none, a loaded log's or a recorded track's), worked out once */
  private fillTravel(): void {
    let k = this.values.findIndex((v) => v.name === 'travel');
    if (k < 0) { this.values.push({ name: 'travel', type: 'f32', domain: [0, 1] }); k = this.values.length - 1; }
    let c = this.cols[k];
    if (!(c instanceof Float32Array) || c.length < this.slots || this.shared) { const was = c; c = new Float32Array(Math.max(this.slots, was?.length ?? 0)); this.cols[k] = c; }
    const a: [number, number] = [0, 0], b: [number, number] = [0, 0];
    for (let i = 0; i < this.size; i++) {
      let d = 0;
      for (let j = 0; j < this.count[i]!; j++) {
        const sl = this.slot(i, j); this.relAt(sl, b);
        if (j) d += Math.hypot(b[0] - a[0], b[1] - a[1]) * R * Math.cos(latOfMercY(this.m0 + b[1]) * D);
        c[sl] = d; a[0] = b[0]; a[1] = b[1];
      }
    }
  }
  /** the slot of a thing's j-th sample (0: its oldest) */
  slot(i: number, j: number): number { const c = this.cap[i]!; return this.first[i]! + ((this.head[i]! + j) % c) * this.stride[i]!; }

  // ── things ──
  get size(): number { return this.ids.length; }
  get samples(): number { let n = 0; for (let i = 0; i < this.ids.length; i++) n += this.count[i]!; return n; }
  indexOf(id: string | number): number { return this.index.get(String(id)) ?? -1; }
  /** bytes the columns hold (slots × each column's bytes a sample) */
  get bytes(): number { return this.time.byteLength + this.place.byteLength + this.cols.reduce((s, c) => s + c.byteLength, 0) + this.ids.length * 16; }
  private thing(id: string, props?: Record<string, unknown>): number {
    let i = this.index.get(id);
    if (i !== undefined) return i;
    i = this.ids.length;
    if (i >= this.first.length) { const g = (a: Int32Array) => { const b = new Int32Array(a.length * 2); b.set(a); return b; }; this.first = g(this.first); this.count = g(this.count); this.cap = g(this.cap); this.head = g(this.head); this.stride = g(this.stride); const p = new Uint8Array(this.packed.length * 2); p.set(this.packed); this.packed = p; }
    this.ids.push(id); this.index.set(id, i); this.props.push(props ?? {});
    this.first[i] = 0; this.count[i] = 0; this.cap[i] = 0; this.head[i] = 0; this.packed[i] = 0; this.stride[i] = 1;
    // a live one: a place in a group (16, then 64, then 256 things a group: a small log stays small)
    if (this.keep !== Infinity) {
      let gp = this.group;
      if (!gp || gp.n >= gp.size) { const size = Math.min(256, 16 * 4 ** this.groups++); this.room(size * this.keep); gp = this.group = { base: this.used, size, n: 0 }; this.used += size * this.keep; }
      this.first[i] = gp.base + gp.n++; this.cap[i] = this.keep; this.stride[i] = gp.size;
    }
    this.emit({ kind: 'thing', index: i });
    return i;
  }
  /** room for `n` more slots at the end (the columns grow in rows of 4096, doubling) */
  private room(n: number): void {
    if (this.shared) this.unshare();
    if (this.used + n <= this.slots) return;
    let s = Math.max(ROW, this.slots); while (s < this.used + n) s *= 2;
    s = Math.ceil(s / ROW) * ROW;
    const t = this.timeType === 'u16' ? new Uint16Array(s) : new Float32Array(s); t.set(this.time.subarray(0, this.used)); this.time = t;
    const p = this.placeType === 'u16' ? new Uint16Array(2 * s) : new Float32Array(2 * s); p.set(this.place.subarray(0, 2 * this.used)); this.place = p;
    this.cols = this.values.map((v, k) => { const c = v.type === 'u8' ? new Uint8Array(s) : new Float32Array(s); if (this.cols[k]) c.set(this.cols[k]!.subarray(0, this.used)); return c; });
    this.slots = s;
    this.emit({ kind: 'all' });
  }
  /** the columns are another's (a loaded file kept by the loader): copied before the first write */
  private unshare(): void {
    this.shared = false;
    this.time = this.time.slice(); this.place = this.place.slice(); this.cols = this.cols.map((c) => c.slice());
  }
  /** one sample: a thing (by id) at a place at a time, with its values; samples of a thing come in time order (an
   *  older one than its last is dropped). Its props are kept from its first sample */
  append(id: string | number, t: number | Date | string, lon: number, lat: number, values?: Record<string, number>, props?: Record<string, unknown>): boolean {
    const ms = msOf(t);
    if (!Number.isFinite(ms) || !Number.isFinite(lon) || !Number.isFinite(lat)) return false;
    if (Number.isNaN(this.epoch)) this.epoch = ms;
    if (Number.isNaN(this.lon0)) { this.lon0 = lon; this.lat0 = lat; this.m0 = mercY(lat); }
    const i = this.thing(String(id), props), n = this.count[i]!;
    const sec = (ms - this.epoch) / 1000, kept = this.timeType === 'u16' ? Math.round(sec / this.timeStep) * this.timeStep : sec;
    // (as it is kept: two samples in one step of a 16-bit time are both kept, at the same time)
    if (n > 0 && kept < this.secAt(this.slot(i, n - 1)) - 1e-6) return false;
    // a value not given keeps the thing's last one
    const last = n > 0 ? this.slot(i, n - 1) : -1, held = this.values.map((_, k) => (last >= 0 ? this.cols[k]![last]! : 0));
    if (this.timeType === 'u16' && (sec < 0 || sec / this.timeStep > U16)) throw new AslnutError('E-DATA-001', `log '${this.id}': ${new Date(ms).toISOString()} is outside its 16-bit time (${this.timeStep} s steps from ${new Date(this.epoch).toISOString()})`, { where: this.id, fix: "time: { type: 'f32' } for a log that runs longer" });
    // its slot: the next free one; a full thing grows (recorded: moved to the end with room) or, at `keep`, overwrites
    // its oldest (a ring)
    let slot: number;
    if (n < this.cap[i]!) slot = this.slot(i, n);
    else if (this.stride[i]! > 1) { slot = this.slot(i, 0); this.head[i] = (this.head[i]! + 1) % this.cap[i]!; }
    else { this.grow(i, Math.max(16, this.cap[i]! * 2)); slot = this.slot(i, this.count[i]!); }
    if (this.count[i]! < this.cap[i]!) this.count[i]!++;
    if (this.dense.length) this.dense = [];
    this.write(slot, sec, lon, lat, values, held);
    // its speed from its sample before (the drawing's frames and near set read the fastest)
    if (n > 0) {
      const a = this.slot(i, this.count[i]! - 2), dt = kept - this.secAt(a);
      if (dt > 0.05) { const pa = this.relAt(a), pb = this.relAt(slot), k = R * Math.cos(lat * D), v = Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * k / dt; if (v > this.maxSpeed && v < 1e4) this.maxSpeed = v; }
      // (its travel: the sample before's and the metres between)
      if (this.travel) { const tk = this.values.findIndex((v) => v.name === 'travel'), c = this.cols[tk]!, pa = this.relAt(a), pb = this.relAt(slot); c[slot] = c[a]! + Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * R * Math.cos(lat * D); }
    }
    if (ms < this.from) this.from = ms; if (ms > this.to) this.to = ms;
    this.version++;
    this.emit({ kind: 'samples', lo: slot, hi: slot + 1 });
    this.emit({ kind: 'thing', index: i });
    return true;
  }
  /** a thing moved to the end of the columns with room for `cap` samples (its samples copied, oldest first) */
  private grow(i: number, cap: number): void {
    const n = this.count[i]!; this.room(cap);
    const s0 = this.used;
    for (let j = 0; j < n; j++) this.copySlot(this.slot(i, j), s0 + j);
    this.first[i] = s0; this.cap[i] = cap; this.head[i] = 0; this.stride[i] = 1; this.used += cap;
    if (n) this.emit({ kind: 'samples', lo: s0, hi: s0 + n });
  }
  private copySlot(a: number, b: number): void {
    this.time[b] = this.time[a]!; this.place[2 * b] = this.place[2 * a]!; this.place[2 * b + 1] = this.place[2 * a + 1]!;
    for (const c of this.cols) c[b] = c[a]!;
  }
  private write(slot: number, sec: number, lon: number, lat: number, values: Record<string, number> | undefined, held: number[]): void {
    this.time[slot] = this.timeType === 'u16' ? Math.round(sec / this.timeStep) : sec;
    const [x, y] = this.rel(lon, lat), b0 = this.seen;
    if (!b0) this.seen = [x, y, x, y]; else { if (x < b0[0]) b0[0] = x; if (y < b0[1]) b0[1] = y; if (x > b0[2]) b0[2] = x; if (y > b0[3]) b0[3] = y; }
    if (this.placeType === 'u16') { const b = this.box; this.place[2 * slot] = q16((x - b[0]) / (b[2] - b[0])); this.place[2 * slot + 1] = q16((y - b[1]) / (b[3] - b[1])); }
    else { this.place[2 * slot] = x; this.place[2 * slot + 1] = y; }
    this.values.forEach((v, k) => {
      const raw = values?.[v.name], c = this.cols[k]!;
      c[slot] = raw === undefined || !Number.isFinite(raw) ? held[k]! : v.type === 'u8' ? Math.round(Math.max(0, Math.min(1, (raw - v.domain[0]) / (v.domain[1] - v.domain[0] || 1))) * 255) : raw;
    });
    // (the highest sample: its altitude as kept)
    if (this.altitude) { const k = this.altK(); if (k >= 0) { const a = this.valueAt(k, slot); if (a > this.altMax) this.altMax = a; } }
  }
  /** the altitude's value column (−1: none) */
  altK(): number { const a = this.altitude; return a ? this.values.findIndex((v) => v.name === a.value) : -1; }
  /** the highest of value k over every sample (−Infinity: none): read once (a loaded or a recorded log) */
  private scanMax(k: number): number {
    if (k < 0) return -Infinity;
    let best = -Infinity;
    for (let i = 0; i < this.size; i++) for (let j = 0; j < this.count[i]!; j++) { const v = this.valueAt(k, this.slot(i, j)); if (v > best) best = v; }
    return best;
  }
  /** many samples at once (a recorded track, a batch from a stream): one change for all of them */
  appendMany(rows: Iterable<{ id: string | number; t: number | Date | string; lon: number; lat: number; /** its height (a log with an altitude) */ alt?: number; values?: Record<string, number>; props?: Record<string, unknown> }>): number {
    // a log that keeps every sample: each thing's room made once, exactly (a recorded track loaded in one go is
    // packed: no slots left behind by growing a sample at a time)
    if (this.keep === Infinity && Array.isArray(rows) && rows.length > 1) this.reserve(rows);
    const w = this.watchers; this.watchers = new Set();
    const runs: number[] = [], things = new Set<number>(); let n = 0, moved = false;
    // the slots touched, as runs (a tick of a live group is one); the things touched, each once
    const spy = (c: LogChange) => { if (c.kind === 'samples') { const k = runs.length; if (k && runs[k - 1] === c.lo) runs[k - 1] = c.hi; else runs.push(c.lo, c.hi); } else if (c.kind === 'all') moved = true; else things.add(c.index); };
    this.watchers.add(spy);
    const an = this.altitude?.value;
    try { for (const r of rows) if (this.append(r.id, r.t, r.lon, r.lat, an && r.alt !== undefined ? { ...r.values, [an]: r.alt } : r.values, r.props)) n++; } finally { this.watchers = w; }
    if (moved) { this.emit({ kind: 'all' }); this.emit({ kind: 'thing', index: -1 }); return n; }
    for (let k = 0; k < runs.length; k += 2) this.emit({ kind: 'samples', lo: runs[k]!, hi: runs[k + 1]! });
    for (const i of things) this.emit({ kind: 'thing', index: i });
    return n;
  }
  /** room for the samples coming to each thing (a thing that keeps every sample): new things side by side, exactly;
   *  a thing that would outgrow its slots moved once to as many as it will hold */
  private reserve(rows: readonly { id: string | number; props?: Record<string, unknown> }[]): void {
    const need = new Map<string, number>(), props = new Map<string, Record<string, unknown> | undefined>();
    for (const r of rows) { const k = String(r.id), c = need.get(k); need.set(k, (c ?? 0) + 1); if (c === undefined) props.set(k, r.props); }
    let fresh = 0; for (const [k, n] of need) if (!this.index.has(k)) fresh += n;
    if (fresh) this.room(fresh);
    for (const [k, n] of need) {
      const i0 = this.index.get(k);
      if (i0 === undefined) {
        const i = this.thing(k, props.get(k));
        if (this.stride[i] === 1) { this.first[i] = this.used; this.cap[i] = n; this.used += n; }
      } else if (this.stride[i0] === 1 && this.count[i0]! + n > this.cap[i0]!) this.grow(i0, this.count[i0]! + n);
    }
  }
  /** call fn on every change (what a drawing uploads); returns the function that stops it */
  watch(fn: (c: LogChange) => void): () => void { this.watchers.add(fn); return () => this.watchers.delete(fn); }
  private emit(c: LogChange): void { for (const f of this.watchers) { try { f(c); } catch (e) { console.error(e); } } }

  // ── the state at a time ──
  /** a thing's sample at or before `sec` (binary search over its samples; -1: before its first) */
  sampleAt(i: number, sec: number): number {
    const n = this.count[i]!; if (!n) return -1;
    if (sec < this.secAt(this.slot(i, 0))) return -1;
    let lo = 0, hi = n - 1;
    if (sec >= this.secAt(this.slot(i, hi))) return hi;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (this.secAt(this.slot(i, m)) <= sec) lo = m; else hi = m; }
    return lo;
  }
  /** one thing's state at a time (null: no samples) */
  at(id: string | number | number, t: number | Date | string, byIndex = false): StateAt | null {
    const i = byIndex ? Number(id) : this.indexOf(id); if (i < 0 || i >= this.ids.length || !this.count[i]) return null;
    const sec = (msOf(t) - this.epoch) / 1000, n = this.count[i]!, j = this.sampleAt(i, sec);
    const a = this.slot(i, Math.max(0, j)), b = this.slot(i, Math.min(n - 1, Math.max(0, j) + 1));
    const ta = this.secAt(a), tb = this.secAt(b), f = j < 0 ? 0 : tb > ta ? Math.max(0, Math.min(1, (sec - ta) / (tb - ta))) : 0;
    const pa = this.relAt(a), pb = this.relAt(b, [0, 0]);
    const x = pa[0] + (pb[0] - pa[0]) * f, y = pa[1] + (pb[1] - pa[1]) * f, [lon, lat] = this.lonLat(x, y);
    const values: Record<string, number> = {};
    this.values.forEach((v, k) => { const va = this.valueAt(k, a), vb = this.valueAt(k, b); values[v.name] = v.step ? va : va + (vb - va) * f; });
    const k = R * Math.cos(lat * D), moving = j >= 0 && j < n - 1 && tb > ta, an = this.altitude?.value;
    return { id: this.ids[i]!, index: i, lon, lat, heading: this.headingAt(i, Math.max(0, Math.min(n - 2, j))), speed: moving ? (Math.hypot(pb[0] - pa[0], pb[1] - pa[1]) * k) / (tb - ta) : 0, values, props: this.props[i]!, outside: j < 0 ? -1 : j >= n - 1 && sec > this.secAt(this.slot(i, n - 1)) ? 1 : 0, ...(an ? { alt: values[an] ?? 0 } : {}) };
  }
  /** a thing's place at `sec` (seconds from the epoch) in the origin's units, into `out` (no allocation: a drawing's
   *  near set asks for every thing), and value `k` there into `out[2]` (k ≥ 0: its altitude's, a set's near things);
   *  false: no samples, or before its first and not `hold` */
  relOf(i: number, sec: number, out: [number, number] | [number, number, number], hold = true, k = -1): boolean {
    const n = this.count[i]!; if (!n) return false;
    const j = this.sampleAt(i, sec); if (j < 0 && !hold) return false;
    const a = this.slot(i, Math.max(0, j));
    if (j < 0 || j >= n - 1) { this.relAt(a, out as [number, number]); if (k >= 0) out[2] = this.valueAt(k, a); return true; }
    const b = this.slot(i, j + 1), ta = this.secAt(a), tb = this.secAt(b), f = tb > ta ? Math.max(0, Math.min(1, (sec - ta) / (tb - ta))) : 0;
    const p = this.relAt(a, this.tmpA), q = this.relAt(b, this.tmpB);
    out[0] = p[0] + (q[0] - p[0]) * f; out[1] = p[1] + (q[1] - p[1]) * f;
    if (k >= 0) { const va = this.valueAt(k, a); out[2] = va + (this.valueAt(k, b) - va) * f; }
    return true;
  }
  private tmpA: [number, number] = [0, 0]; private tmpB: [number, number] = [0, 0];
  /** the most samples any thing has within `seconds` (a trail of that length draws one piece more than this): from
   *  the saved log's table (its smallest window that long or longer: never fewer), else counted (a pass over every
   *  sample) */
  densest(seconds: number): number {
    const row = this.dense.find(([w]) => w >= seconds);
    return row ? row[1] : this.densestScan(seconds);
  }
  /** windows (s) and the most samples any thing has within each, saved with the log (empty: count them) */
  dense: [number, number][] = [];
  private densestScan(seconds: number, things = this.ids.length): number {
    let best = 0;
    for (let i = 0; i < things; i++) {
      const n = this.count[i]!; let lo = 0;
      for (let hi = 0; hi < n; hi++) {
        const th = this.secAt(this.slot(i, hi));
        while (this.secAt(this.slot(i, lo)) <= th - seconds) lo++;
        if (hi - lo + 1 > best) best = hi - lo + 1;
      }
    }
    return best;
  }
  /** samples thing i has within `seconds` of its newest (its trail's pieces then: one more) */
  densestOf(i: number, seconds: number): number {
    const n = this.count[i]!; if (!n) return 0;
    const j = this.sampleAt(i, this.secAt(this.slot(i, n - 1)) - seconds);
    return n - 1 - j;
  }
  /** the box of every place (the origin's units: x0, y0, x1, y1); null: none. Kept as samples come (a loaded log:
   *  read once) */
  bounds(): [number, number, number, number] | null {
    if (!this.ids.length) return null;
    if (!this.seen) this.seen = this.scanBounds();
    return this.seen ? [this.seen[0], this.seen[1], this.seen[2], this.seen[3]] : null;
  }
  private scanBounds(things = this.ids.length): [number, number, number, number] | null {
    if (this.placeType === 'u16') {
      let a = 65535, b = 65535, c = 0, d = 0; const p = this.place;
      for (let i = 0; i < things; i++) for (let j = 0; j < this.count[i]!; j++) { const s = this.slot(i, j), x = p[2 * s]!, y = p[2 * s + 1]!; if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
      const B = this.box, k = (q: number, lo: number, w: number) => lo + (q / U16) * w;
      return [k(a, B[0], B[2] - B[0]), k(b, B[1], B[3] - B[1]), k(c, B[0], B[2] - B[0]), k(d, B[1], B[3] - B[1])];
    }
    let a = Infinity, b = Infinity, c = -Infinity, d = -Infinity; const p = this.place;
    for (let i = 0; i < things; i++) for (let j = 0; j < this.count[i]!; j++) { const s = this.slot(i, j), x = p[2 * s]!, y = p[2 * s + 1]!; if (x < a) a = x; if (x > c) c = x; if (y < b) b = y; if (y > d) d = y; }
    return Number.isFinite(a) ? [a, b, c, d] : null;
  }
  /** the heading along a thing's j-th piece (degrees from north); a piece where it stands takes the one before it (up
   *  to 8 back), then the one after */
  headingAt(i: number, j: number): number {
    const n = this.count[i]!, pa: [number, number] = [0, 0], pb: [number, number] = [0, 0];
    const dir = (k: number): number | null => { if (k < 0 || k + 1 >= n) return null; this.relAt(this.slot(i, k), pa); this.relAt(this.slot(i, k + 1), pb); const dx = pb[0] - pa[0], dy = pb[1] - pa[1]; return dx * dx + dy * dy > 1e-20 ? ((Math.atan2(dx, dy) / D) + 360) % 360 : null; };
    for (let k = j; k >= Math.max(0, j - 8); k--) { const h = dir(k); if (h !== null) return h; }
    for (let k = j + 1; k < Math.min(n - 1, j + 9); k++) { const h = dir(k); if (h !== null) return h; }
    return 0;
  }
  /** every thing's state at a time (or only these ids) */
  stateAt(t: number | Date | string, ids?: readonly (string | number)[]): StateAt[] {
    const out: StateAt[] = [], list = ids ? ids.map((id) => this.indexOf(id)).filter((i) => i >= 0) : this.ids.map((_, i) => i);
    for (const i of list) { const s = this.at(i, t, true); if (s) out.push(s); }
    return out;
  }
  /** seconds from the epoch → a Date */
  dateOf(sec: number): Date { return new Date(this.epoch + sec * 1000); }

  // ── saved and loaded ──
  /** the log as bytes (a header, then each column as it is kept): what tools write once and pages load */
  toBytes(o: { things?: number } = {}): Uint8Array {
    // the things packed in order (each one's samples oldest first), the columns cut to the slots used, a whole row;
    // `things`: only the first so many
    const N = Math.min(this.ids.length, o.things ?? Infinity);
    let total = 0; for (let i = 0; i < N; i++) total += this.count[i]!;
    const slots = Math.max(ROW, Math.ceil(total / ROW) * ROW);
    const start = new Uint32Array(N), count = new Uint32Array(N);
    const t = this.timeType === 'u16' ? new Uint16Array(slots) : new Float32Array(slots), p = this.placeType === 'u16' ? new Uint16Array(2 * slots) : new Float32Array(2 * slots);
    const cs = this.values.map((v) => (v.type === 'u8' ? new Uint8Array(slots) : new Float32Array(slots)));
    let s = 0;
    for (let i = 0; i < N; i++) {
      start[i] = s; count[i] = this.count[i]!;
      for (let j = 0; j < this.count[i]!; j++, s++) { const a = this.slot(i, j); t[s] = this.time[a]!; p[2 * s] = this.place[2 * a]!; p[2 * s + 1] = this.place[2 * a + 1]!; cs.forEach((c, k) => (c[s] = this.cols[k]![a]!)); }
    }
    const sections: { name: string; data: ArrayBufferView }[] = [{ name: 'start', data: start }, { name: 'count', data: count }, { name: 'time', data: t }, { name: 'place', data: p }, ...this.values.map((v, k) => ({ name: `value:${v.name}`, data: cs[k]! }))];
    const props = this.props.slice(0, N), propNames = [...new Set(props.flatMap((x) => Object.keys(x)))];
    // the box and the densest windows read once here, saved: a page that loads it reads neither again
    const bounds = N === this.ids.length ? this.bounds() : this.scanBounds(N), dense = DENSE.map((w) => [w, this.densestScan(w, N)]);
    const head = { v: 1, bounds, dense, id: this.id, attribution: this.attribution, epoch: this.epoch, origin: [this.lon0, this.lat0], time: { type: this.timeType, step: this.timeStep }, place: { type: this.placeType, box: this.box }, values: this.values, ...(this.altitude ? { altitude: this.altitude, altMax: this.altMax } : {}), maxSpeed: this.maxSpeed, from: this.from, to: this.to, ids: this.ids.slice(0, N), props: Object.fromEntries(propNames.map((k) => [k, props.map((x) => x[k] ?? null)])), slots, sections: [] as { name: string; offset: number; bytes: number }[] };
    // the header's room first (sections are 8-byte aligned after it); its offsets written once their places are known
    let json = JSON.stringify(head), off = 0;
    for (let pass = 0; pass < 3; pass++) {
      off = align8(12 + new TextEncoder().encode(json).length + 64);
      head.sections = sections.map((x) => { const o = { name: x.name, offset: off, bytes: x.data.byteLength }; off = align8(off + x.data.byteLength); return o; });
      json = JSON.stringify(head);
    }
    const hb = new TextEncoder().encode(json), out = new Uint8Array(off);
    out.set(new TextEncoder().encode(MAGIC), 0); new DataView(out.buffer).setUint32(8, hb.length, true); out.set(hb, 12);
    for (let pad = 12 + hb.length; pad < head.sections[0]!.offset; pad++) out[pad] = 32;
    head.sections.forEach((x, k) => out.set(new Uint8Array(sections[k]!.data.buffer, sections[k]!.data.byteOffset, sections[k]!.data.byteLength), x.offset));
    return out;
  }
  /** a recorded track straight from its arrays: each thing's room made once, exactly, every sample written in one pass
   *  (no rows, no appends). Its columns the smallest that hold it (as smallest(): a place 0.25 m, a time 0.1 s) unless
   *  the options say; each thing keeps every sample (it may be appended to) */
  static fromColumns(c: Columns, o: LogOptions = {}): Log {
    const N = c.ids.length, cnt = c.count, ll = c.lonlat ?? null, lon = c.lon, lat = c.lat, T = c.t;
    if (cnt.length !== N || (!ll && (!lon || !lat))) throw new AslnutError('E-DATA-001', `history.fromColumns: ${N} ids, ${cnt.length} counts${ll || (lon && lat) ? '' : ', and no places (lon and lat, or lonlat)'}`, { fix: 'history.fromColumns({ ids, count, t, lon, lat })' });
    const st = c.start ?? (() => { const a = new Float64Array(N); for (let i = 1; i < N; i++) a[i] = a[i - 1]! + cnt[i - 1]!; return a; })();
    const X = (k: number) => (ll ? ll[2 * k]! : lon![k]!), Y = (k: number) => (ll ? ll[2 * k + 1]! : lat![k]!);
    // one pass: its box and its span (for the columns' types and the epoch)
    let S = 0, w = Infinity, s0 = Infinity, e = -Infinity, n = -Infinity, from = Infinity, to = -Infinity;
    for (let i = 0; i < N; i++) {
      const a = st[i]!, b = a + cnt[i]!; S += cnt[i]!;
      for (let k = a; k < b; k++) { const x = X(k), y = Y(k), t = T[k]!; if (x < w) w = x; if (x > e) e = x; if (y < s0) s0 = y; if (y > n) n = y; if (t < from) from = t; if (t > to) to = t; }
    }
    if (!S) return new Log({ ...o, keep: Infinity });
    const pad = 1e-5, box: [number, number, number, number] = [w - pad, s0 - pad, e + pad, n + pad], auto = !o.place || !o.time ? smallest({ box, from, to }) : null;
    const place = o.place ?? auto!.place, time = o.time ?? auto!.time;
    const log = new Log({ ...o, keep: Infinity, place, time: { ...time, epoch: time.epoch ?? from } });
    if (log.timeType === 'u16' && ((from - log.epoch) < 0 || (to - log.epoch) / 1000 / log.timeStep > U16)) throw new AslnutError('E-DATA-001', `log '${log.id}': its times are outside its 16-bit time (${log.timeStep} s steps from ${new Date(log.epoch).toISOString()})`, { where: log.id, fix: "time: { type: 'f32' } for a log that runs longer" });
    // (its origin: a 16-bit place's box's middle, else its first sample, as appends would have it)
    if (Number.isNaN(log.lon0)) { const k0 = st[N > 0 ? (() => { let i = 0; while (i < N - 1 && !cnt[i]) i++; return i; })() : 0]!; log.lon0 = X(k0); log.lat0 = Y(k0); log.m0 = mercY(log.lat0); }
    const slots = Math.max(ROW, Math.ceil(S / ROW) * ROW), cap = Math.max(64, N);
    log.time = log.timeType === 'u16' ? new Uint16Array(slots) : new Float32Array(slots);
    log.place = log.placeType === 'u16' ? new Uint16Array(2 * slots) : new Float32Array(2 * slots);
    log.cols = log.values.map((v) => (v.type === 'u8' ? new Uint8Array(slots) : new Float32Array(slots)));
    log.first = new Int32Array(cap); log.count = new Int32Array(cap); log.cap = new Int32Array(cap); log.head = new Int32Array(cap); log.stride = new Int32Array(cap).fill(1);
    log.packed = new Uint8Array(cap).fill(1, 0, N);
    log.ids = c.ids.map(String); log.index = new Map(log.ids.map((id, i) => [id, i])); log.props = log.ids.map((_, i) => c.props?.[i] ?? {});
    const vals = log.values.map((v) => c.values?.[v.name] ?? (v.name === log.altitude?.value ? c.alt ?? null : null)), U = log.timeType === 'u16', P = log.placeType === 'u16', step = log.timeStep, ep = log.epoch;
    const bx = log.box, kx = 1 / (bx[2] - bx[0] || 1), ky = 1 / (bx[3] - bx[1] || 1), lon0 = log.lon0, m0 = log.m0;
    let slot = 0, maxSpeed = 0, sx0 = Infinity, sy0 = Infinity, sx1 = -Infinity, sy1 = -Infinity; const here: [number, number] = [0, 0];
    for (let i = 0; i < N; i++) {
      const a = st[i]!, m = cnt[i]!;
      // (a thing's samples in time order: as they come, or sorted when they are not)
      let order: number[] | null = null;
      for (let k = a + 1; k < a + m; k++) if (T[k]! < T[k - 1]!) { order = Array.from({ length: m }, (_, j) => a + j).sort((p, q) => T[p]! - T[q]!); break; }
      log.first[i] = slot; log.count[i] = m; log.cap[i] = m;
      let px = 0, py = 0, pt = 0;
      for (let j = 0; j < m; j++, slot++) {
        const k = order ? order[j]! : a + j, sec = (T[k]! - ep) / 1000, x = wrap(X(k) - lon0) * D, y = mercY(Math.max(-85.0511, Math.min(85.0511, Y(k)))) - m0;
        log.time[slot] = U ? Math.round(sec / step) : sec;
        if (P) { log.place[2 * slot] = q16((x - bx[0]) * kx); log.place[2 * slot + 1] = q16((y - bx[1]) * ky); }
        else { log.place[2 * slot] = x; log.place[2 * slot + 1] = y; }
        for (let v = 0; v < vals.length; v++) {
          const src = vals[v]; if (!src) continue;
          const sp = log.values[v]!, raw = src[k]!, col = log.cols[v]!;
          col[slot] = !Number.isFinite(raw) ? (j ? col[slot - 1]! : 0) : sp.type === 'u8' ? Math.round(Math.max(0, Math.min(1, (raw - sp.domain[0]) / (sp.domain[1] - sp.domain[0] || 1))) * 255) : raw;
        }
        if (x < sx0) sx0 = x; if (x > sx1) sx1 = x; if (y < sy0) sy0 = y; if (y > sy1) sy1 = y;
        // its speed from the sample before, as kept (as append finds it: the fastest anywhere)
        const kept = U ? Math.round(sec / step) * step : sec, at = log.relAt(slot, here);
        if (j && kept - pt > 0.05) { const kk = R * Math.cos(Y(k) * D), v = Math.hypot(at[0] - px, at[1] - py) * kk / (kept - pt); if (v > maxSpeed && v < 1e4) maxSpeed = v; }
        px = at[0]; py = at[1]; pt = kept;
      }
    }
    log.slots = slots; log.used = S; log.maxSpeed = maxSpeed; log.from = from; log.to = to;
    log.seen = [sx0, sy0, sx1, sy1];
    if (log.altitude) log.altMax = log.scanMax(log.altK());
    if (log.travel) log.fillTravel();
    log.version++;
    return log;
  }
  /** a saved log (no copy: the columns are views of the bytes until the log is written to) */
  static fromBytes(buf: ArrayBuffer | Uint8Array, o: { keep?: number; travel?: boolean; /** a log saved without an altitude: the value to read as its altitude (`altitude`'s `value`, default 'alt') */ altitude?: LogOptions['altitude'] } = {}): Log {
    const b = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    if (new TextDecoder().decode(b.subarray(0, 8)) !== MAGIC) throw new AslnutError('E-DATA-002', 'not a saved log (its first bytes are not ASLNHST1)', { fix: 'save it with log.toBytes()' });
    const n = new DataView(b.buffer, b.byteOffset, b.byteLength).getUint32(8, true);
    const h = JSON.parse(new TextDecoder().decode(b.subarray(12, 12 + n))) as { bounds?: [number, number, number, number] | null; dense?: [number, number][]; id: string; attribution: string; epoch: number; origin: [number, number]; time: { type: TimeType; step: number }; place: { type: PlaceType; box: [number, number, number, number] }; values: { name: string; type: ValueType; domain: [number, number]; step?: boolean }[]; altitude?: { over: 'ground' | 'sea'; value: string }; altMax?: number; maxSpeed: number; from: number; to: number; ids: string[]; props: Record<string, unknown[]>; slots: number; sections: { name: string; offset: number; bytes: number }[] };
    const log = new Log({ id: h.id, attribution: h.attribution, time: { type: h.time.type, step: h.time.step, epoch: h.epoch }, place: { type: 'f32' }, values: Object.fromEntries(h.values.map((v) => [v.name, { type: v.type, domain: v.domain, ...(v.step ? { step: true } : {}) }])), ...(h.altitude ? { altitude: h.altitude } : o.altitude && h.values.some((v) => v.name === (typeof o.altitude === 'string' ? 'alt' : o.altitude!.value ?? 'alt')) ? { altitude: o.altitude } : {}), keep: o.keep });
    (log as { placeType: PlaceType }).placeType = h.place.type; log.box = h.place.box;
    log.lon0 = h.origin[0]; log.lat0 = h.origin[1]; log.m0 = mercY(h.origin[1]);
    const sec = (name: string) => { const s = h.sections.find((x) => x.name === name); if (!s) throw new AslnutError('E-DATA-002', `saved log '${h.id}' has no '${name}'`, { fix: 'save it again with log.toBytes()' }); return s; };
    // the bytes' own buffer when it is aligned for the column's type (it is, as saved), else a copy
    const view = <T>(name: string, C: { new (b: ArrayBuffer, o: number, n: number): T; BYTES_PER_ELEMENT: number }): T => {
      const s = sec(name), at = b.byteOffset + s.offset;
      return at % C.BYTES_PER_ELEMENT === 0 ? new C(b.buffer as ArrayBuffer, at, s.bytes / C.BYTES_PER_ELEMENT) : new C(b.slice(s.offset, s.offset + s.bytes).buffer as ArrayBuffer, 0, s.bytes / C.BYTES_PER_ELEMENT);
    };
    const start = view('start', Uint32Array), count = view('count', Uint32Array), N = h.ids.length;
    log.ids = h.ids; (log as unknown as { index: Map<string, number> }).index = new Map(h.ids.map((id, i) => [id, i]));
    const names = Object.keys(h.props ?? {});
    log.props = h.ids.map((_, i) => Object.fromEntries(names.map((k) => [k, h.props[k]![i]]).filter(([, v]) => v !== null)));
    const cap = Math.max(64, N);
    log.first = new Int32Array(cap); log.count = new Int32Array(cap); log.cap = new Int32Array(cap); log.head = new Int32Array(cap); log.stride = new Int32Array(cap).fill(1); (log as unknown as { packed: Uint8Array }).packed = new Uint8Array(cap).fill(1, 0, N);
    let used = 0;
    for (let i = 0; i < N; i++) { log.first[i] = start[i]!; log.count[i] = count[i]!; log.cap[i] = count[i]!; used = Math.max(used, start[i]! + count[i]!); }
    log.time = h.time.type === 'u16' ? view('time', Uint16Array) : view('time', Float32Array);
    log.place = h.place.type === 'u16' ? view('place', Uint16Array) : view('place', Float32Array);
    log.cols = h.values.map((v) => (v.type === 'u8' ? view(`value:${v.name}`, Uint8Array) : view(`value:${v.name}`, Float32Array)));
    log.slots = h.slots; log.used = used; log.maxSpeed = h.maxSpeed; log.from = h.from; log.to = h.to;
    log.seen = h.bounds ?? null; log.dense = h.dense ?? [];
    (log as unknown as { shared: boolean }).shared = true;
    // (its highest sample: saved, else read once)
    if (log.altitude) log.altMax = h.altMax ?? log.scanMax(log.altK());
    // (its travel kept when asked for and it was saved without it)
    if (o.travel && !h.values.some((v) => v.name === 'travel')) { (log as { travel: boolean }).travel = true; log.fillTravel(); }
    log.version++;
    return log;
  }
  /** load a saved one (through the world's loader when a layer starts it); the same promise for every caller */
  start(ctx: { loader: Loader; error?: (e: unknown) => void }): Promise<void> {
    if (!this.url) return Promise.resolve();
    this.started ??= (async () => {
      const bytes = await ctx.loader.get<ArrayBuffer>(this.url!, { kind: 'bytes' });
      if (!bytes) throw new AslnutError('E-DATA-002', `nothing at ${this.url}`, { where: this.id, fix: 'check the URL (a saved log: tools write it once)' });
      const l = Log.fromBytes(bytes, { keep: this.keep, travel: this.travel, ...(this.altitude ? { altitude: this.altitude } : {}) });
      for (const k of ['epoch', 'lon0', 'lat0', 'm0', 'box', 'ids', 'index', 'props', 'first', 'count', 'cap', 'head', 'stride', 'packed', 'seen', 'dense', 'time', 'place', 'cols', 'slots', 'used', 'maxSpeed', 'from', 'to', 'shared', 'altitude', 'altMax'] as const) (this as unknown as Record<string, unknown>)[k] = (l as unknown as Record<string, unknown>)[k];
      (this as { placeType: PlaceType }).placeType = l.placeType; (this as { timeType: TimeType }).timeType = l.timeType; (this as { timeStep: number }).timeStep = l.timeStep;
      (this as { values: Log['values'] }).values = l.values;
      if (!this.attribution) this.attribution = l.attribution;
      this.loaded = true; this.version++;
      this.emit({ kind: 'all' }); this.emit({ kind: 'thing', index: -1 });
    })().catch((e: unknown) => { this.failure = e instanceof Error ? e : new Error(String(e)); ctx.error?.(e); });
    return this.started;
  }
  /** resolves when its saved bytes are in (at once for a log filled by appends) */
  get ready(): Promise<void> { return this.started ?? Promise.resolve(); }
  get loading(): boolean { return !!this.url && !this.loaded && !this.failure; }
}
const q16 = (f: number) => Math.round(Math.max(0, Math.min(1, f)) * U16);
/** the trail windows (s) a saved log keeps its densest count for */
const DENSE = [15, 30, 45, 60, 90, 120, 180, 300, 600];
const align8 = (n: number) => Math.ceil(n / 8) * 8;

/** a log's column types chosen for its data: the smallest that keep `precision` (metres for places, seconds for times):
 *  a box under 65535 × precision wide takes 16-bit places; a span under 65535 steps 16-bit times */
export function smallest(o: { box: [number, number, number, number]; from: number | Date | string; to: number | Date | string; precision?: { place?: number; time?: number } }): { place: { type: PlaceType; box?: [number, number, number, number] }; time: { type: TimeType; epoch: number; step?: number } } {
  const pm = o.precision?.place ?? 0.25, ts = o.precision?.time ?? 0.1, b = o.box;
  const kx = 111320 * Math.cos(((b[1] + b[3]) / 2) * D), wide = Math.max((b[2] - b[0]) * kx, (b[3] - b[1]) * 110574);
  const from = msOf(o.from), span = (msOf(o.to) - from) / 1000;
  return {
    place: wide / U16 <= pm ? { type: 'u16', box: b } : { type: 'f32' },
    time: span / ts <= U16 ? { type: 'u16', epoch: from, step: ts } : { type: 'f32', epoch: from },
  };
}

// ── replay ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** the part of a world a replay drives: its clock (core › time › clock) */
export interface ClockWorld {
  time: Date; readonly timeRate: number;
  setTime(t: Date | 'now', o?: { rate?: number }): unknown; setTimeRate(rate: number): unknown;
  on(ev: 'frame', f: (e: { dt: number }) => void): () => void;
}
export interface ReplayOptions {
  /** the span played (default: the log's, or now → an hour on) */
  from?: number | Date | string; to?: number | Date | string;
  /** seconds of world time a second (default 1) */
  speed?: number;
  /** at the end: back to the start (default false: it stops there) */
  loop?: boolean;
  /** start playing at once (default false: it waits at `from`, or at the world's time when that is inside) */
  play?: boolean;
}
export interface Playback {
  readonly playing: boolean; readonly speed: number; readonly from: Date; readonly to: Date;
  /** the world's time now */
  readonly time: Date;
  /** 0..1 through the span */
  readonly progress: number;
  play(): Playback; pause(): Playback; toggle(): Playback;
  /** seconds of world time a second while playing */
  setSpeed(x: number): Playback;
  /** a time (or a share of the span 0..1 with `share`): one change of the clock, nothing rebuilt */
  seek(t: number | Date | string, o?: { share?: boolean }): Playback;
  /** called when it plays, pauses, seeks, loops or ends */
  on(fn: (p: Playback, why: 'play' | 'pause' | 'seek' | 'speed' | 'loop' | 'end') => void): () => void;
  /** stop following the world's frames */
  dispose(): void;
}
/** play a span of time on the world's clock: play and pause (the clock runs at `speed`, or stands), seek (one change of
 *  the clock), loop or stop at the end. What reads the world's time (a set of entities driven by data, a trail, the
 *  sun) follows by itself; a paused world draws nothing for it */
export function replay(w: ClockWorld, o: ReplayOptions & { log?: Log } = {}): Playback {
  const from = msOf(o.from ?? (o.log && Number.isFinite(o.log.from) ? o.log.from : w.time.getTime()));
  const to = msOf(o.to ?? (o.log && Number.isFinite(o.log.to) ? o.log.to : from + 3600e3));
  if (!(to > from)) throw new AslnutError('E-DATA-001', 'replay: `to` must come after `from`', { fix: 'replay(w, { from, to })' });
  let speed = o.speed ?? 1, playing = false;
  const fns = new Set<(p: Playback, why: 'play' | 'pause' | 'seek' | 'speed' | 'loop' | 'end') => void>();
  const tell = (why: 'play' | 'pause' | 'seek' | 'speed' | 'loop' | 'end') => { for (const f of fns) { try { f(p, why); } catch (e) { console.error(e); } } };
  const now = () => w.time.getTime();
  const p: Playback = {
    get playing() { return playing; }, get speed() { return speed; },
    from: new Date(from), to: new Date(to),
    get time() { return new Date(now()); },
    get progress() { return Math.max(0, Math.min(1, (now() - from) / (to - from))); },
    play() { if (now() >= to && speed > 0) w.setTime(new Date(from)); playing = true; w.setTime(new Date(now()), { rate: speed }); tell('play'); return p; },
    pause() { playing = false; w.setTime(new Date(now()), { rate: 0 }); tell('pause'); return p; },
    toggle() { return playing ? p.pause() : p.play(); },
    setSpeed(x) { speed = x; if (playing) w.setTimeRate(x); tell('speed'); return p; },
    seek(t, so = {}) { const ms = so.share ? from + Math.max(0, Math.min(1, Number(t))) * (to - from) : msOf(t); w.setTime(new Date(Math.max(from, Math.min(to, ms))), { rate: playing ? speed : 0 }); tell('seek'); return p; },
    on(fn) { fns.add(fn); return () => fns.delete(fn); },
    dispose() { off(); fns.clear(); },
  };
  // the end of the span, on the frames drawn anyway (nothing asked for here: a paused world draws none)
  const off = w.on('frame', () => {
    if (!playing) return;
    const t = now();
    if (speed > 0 && t >= to) { if (o.loop) { w.setTime(new Date(from + ((t - from) % (to - from))), { rate: speed }); tell('loop'); } else { playing = false; w.setTime(new Date(to), { rate: 0 }); tell('end'); } }
    else if (speed < 0 && t <= from) { if (o.loop) { w.setTime(new Date(to), { rate: speed }); tell('loop'); } else { playing = false; w.setTime(new Date(from), { rate: 0 }); tell('end'); } }
  });
  const t0 = now();
  if (!(t0 >= from && t0 <= to)) w.setTime(new Date(from), { rate: 0 }); else w.setTime(new Date(t0), { rate: 0 });
  if (o.play) p.play();
  return p;
}

// ── relations over time ─────────────────────────────────────────────────────────────────────────────────────────
/** one thing held by another for a while: a member (`of`: a car) held by a host (`to`: a charger) from `from` until
 *  `until` (ms since 1970, a Date or a string), of a kind (plugged, parked, aboard) */
export interface RelationRow { of: string | number; to: string | number; from: number | Date | string; until: number | Date | string; kind?: string }
/** a relation as kept: ids as strings, times in ms */
export interface Held { of: string; to: string; from: number; until: number; kind: string }
/** where each field of your rows is (default the row's own `of`, `to`, `from`, `until`, `kind`) */
export interface RelationsOptions<R> { of?: (r: R) => string | number; to?: (r: R) => string | number; from?: (r: R) => number | Date | string; until?: (r: R) => number | Date | string; kind?: (r: R) => string }
/** things related to others for a while (core › data › history: relations over time): which host holds a member when,
 *  which members a host holds when. Decided once, when the data comes: a set folds its members into their hosts by it
 *  (entities({ fold })), a card counts a host's members by it (`relations.count`), both on the chip */
export class Relations {
  /** every relation, in time order (by `from`) */
  readonly rows: Held[];
  /** bumped when the rows change */
  version = 0;
  private byOf = new Map<string, Held[]>(); private byTo = new Map<string, Held[]>();
  constructor(rows: readonly Held[]) { this.rows = []; this.set(rows); }
  /** the rows again (a scenario's new answer): everything that reads them reads them again */
  set(rows: readonly Held[]): this {
    const list = rows.filter((r) => Number.isFinite(r.from) && Number.isFinite(r.until) && r.until > r.from).sort((a, b) => a.from - b.from);
    this.rows.length = 0; this.rows.push(...list); this.byOf.clear(); this.byTo.clear();
    for (const r of list) { (this.byOf.get(r.of) ?? this.byOf.set(r.of, []).get(r.of)!).push(r); (this.byTo.get(r.to) ?? this.byTo.set(r.to, []).get(r.to)!).push(r); }
    this.version++;
    return this;
  }
  /** the windows a member is held in (ms), overlapping ones joined, in time order */
  windowsOf(id: string | number): [number, number][] {
    const out: [number, number][] = [];
    for (const r of this.byOf.get(String(id)) ?? []) { const l = out[out.length - 1]; if (l && r.from <= l[1]) l[1] = Math.max(l[1], r.until); else out.push([r.from, r.until]); }
    return out;
  }
  /** the relations a host holds, in time order */
  membersOf(host: string | number): readonly Held[] { return this.byTo.get(String(host)) ?? []; }
  /** the host holding a member at a time (null: none) */
  hostOf(id: string | number, t: number | Date | string): string | null { const ms = msOf(t); for (const r of this.byOf.get(String(id)) ?? []) if (r.from <= ms && ms < r.until) return r.to; return null; }
  /** the members a host holds at a time */
  heldBy(host: string | number, t: number | Date | string): string[] { const ms = msOf(t); return this.membersOf(host).filter((r) => r.from <= ms && ms < r.until).map((r) => r.of); }
  /** how many members each host holds, over time: a channel a card or a group reads (core › data › history ›
   *  channels: derived once per host when the data comes, never per frame) */
  get count(): { relations: Relations; count: true } { return { relations: this, count: true }; }
  /** an aggregate of a value its members carry while a host holds them, over time (the mean charge of the cars
   *  plugged in; their sum of power): a channel, derived once per host, its steps exact as members come and go */
  members(agg: 'sum' | 'mean' | 'min' | 'max', value: string, log?: Log): { relations: Relations; members: { agg: 'sum' | 'mean' | 'min' | 'max'; value: string; log?: Log } } { return { relations: this, members: { agg, value, ...(log ? { log } : {}) } }; }
  /** from your rows (each field where `o` says), or from a log's value over time naming each thing's host (a sample's
   *  host held until the thing's next sample names another; none: `to` answers null) */
  static of<R = RelationRow>(rows: readonly R[], o: RelationsOptions<R> = {}): Relations {
    const g = (r: R, k: keyof RelationRow) => (r as unknown as Record<string, unknown>)[k];
    return new Relations(rows.map((r) => ({ of: String(o.of ? o.of(r) : g(r, 'of')), to: String(o.to ? o.to(r) : g(r, 'to')), from: msOf((o.from ? o.from(r) : g(r, 'from')) as number), until: msOf((o.until ? o.until(r) : g(r, 'until')) as number), kind: String((o.kind ? o.kind(r) : g(r, 'kind')) ?? '') })));
  }
  static fromLog(log: Log, o: { value: string; to: (v: number, thing: string) => string | number | null | undefined; kind?: string }): Relations {
    const k = log.values.findIndex((v) => v.name === o.value), out: Held[] = [];
    if (k < 0) throw new AslnutError('E-DATA-001', `relations: the log has no value '${o.value}'`, { fix: `its values: ${log.values.map((v) => v.name).join(', ') || 'none'}` });
    for (let i = 0; i < log.size; i++) {
      let cur: Held | null = null;
      for (let j = 0; j < log.count[i]!; j++) {
        const sl = log.slot(i, j), t = log.epoch + log.secAt(sl) * 1000, h = o.to(log.valueAt(k, sl), log.ids[i]!), to = h === null || h === undefined ? null : String(h);
        if (cur && cur.to !== to) { cur.until = t; out.push(cur); cur = null; }
        if (to !== null && !cur) cur = { of: log.ids[i]!, to, from: t, until: t, kind: o.kind ?? '' };
      }
      if (cur) { cur.until = Math.max(cur.until, log.to); if (cur.until > cur.from) out.push(cur); }
    }
    return new Relations(out);
  }
}

/** the history namespace: a log (empty, or a saved one by its url), a saved one from bytes, the smallest column types
 *  for some data, relations over time */
export const history = {
  log: (o: LogOptions = {}) => new Log(o),
  fromBytes: (b: ArrayBuffer | Uint8Array, o?: Parameters<typeof Log.fromBytes>[1]) => Log.fromBytes(b, o),
  fromColumns: (c: Columns, o?: LogOptions) => Log.fromColumns(c, o),
  smallest,
  /** things held by others for a while: rows `{ of, to, from, until, kind? }` (or yours, with `o` saying where each
   *  field is) · `history.relations.fromLog(log, { value, to })`: from a value over time naming each thing's host */
  relations: Object.assign(<R = RelationRow>(rows: readonly R[], o?: RelationsOptions<R>) => Relations.of(rows, o), { fromLog: (log: Log, o: { value: string; to: (v: number, thing: string) => string | number | null | undefined; kind?: string }) => Relations.fromLog(log, o) }),
};
