// core › data › history › channels: a value per item over time, bound once, read on the chip. Each part of a card, each
// value of a group, is bound to a channel: a constant, each item's own (your function of it), a value a log carries (by
// the item's id, or the ids you give: several summed), how many members a relation's host holds, or your formula of
// the others; or an aggregate of a value a host's members carry while it holds them. They are derived ONCE when the data
// comes, into one log: an item's samples at every time any of its
// channels changes (two samples at one time where a step changes: a count, a gate), every channel's value at each, so
// the chip reads them as a set reads its log (a binary search, a mix between two samples). Never per frame.
//   const cols = channels.derive(stations, { busy: { value: 'busy', log: ports, key: d => portsOf(d) }, kw: 'kw',
//     cars: plugged.count, share: { formula: (v, d) => v.busy / d.props.ports } }, { log: places })
//   cols.at('station-3', t).values.busy
import { AslnutError } from '../world/errors.ts';
import { Log, type Relations } from './history.ts';

type Key = string | number;
/** a log's value over time: its name, the log (default the one the reader gives; or each item's own: your function of
 *  it), the log's things it reads for an item (default the item's id; several: summed; none: 0) */
export interface ColumnChannel<D> { value: string; log?: Log | ((d: D) => Log | null | undefined); key?: (d: D) => Key | readonly Key[] | null | undefined }
/** how many members a host holds, over time (a relation's `count`) */
export interface CountChannel { relations: Relations; count: true }
/** an aggregate of a value a host's members carry while it holds them (a relation's `members(agg, value, log?)`) */
export interface MembersChannel { relations: Relations; members: { agg: 'sum' | 'mean' | 'min' | 'max'; value: string; log?: Log } }
/** your formula of the other channels at each sample (and the item), and of channels of its own (`inputs`: kept under
 *  its name, `v.soc` in it): worked out once per sample */
export interface FormulaChannel<D> { formula: (v: Record<string, number>, d: D) => number; inputs?: Record<string, Channel<D>> }
/** a channel: a constant, each item's own, a log's value by name (or with its log and keys), a relation's count, a formula */
export type Channel<D> = number | ((d: D) => number) | string | ColumnChannel<D> | CountChannel | MembersChannel | FormulaChannel<D>;
export interface DeriveOptions<D> {
  /** the log a value named by a string reads (`'kw'`: this log's value kw) */
  log?: Log | null;
  /** an item's id (default its `id`): the log's thing it reads, the host a relation counts, the derived log's thing */
  id?: (d: D, i: number) => Key;
  /** an item's place (the derived log keeps it; default none) */
  place?: (d: D) => readonly [number, number] | null | undefined;
}
export const isCount = (c: unknown): c is CountChannel => !!c && typeof c === 'object' && (c as CountChannel).count === true && !!(c as CountChannel).relations;
export const isMembers = (c: unknown): c is MembersChannel => !!c && typeof c === 'object' && !!(c as MembersChannel).members && !!(c as MembersChannel).relations;
export const isFormula = <D>(c: unknown): c is FormulaChannel<D> => !!c && typeof c === 'object' && typeof (c as FormulaChannel<D>).formula === 'function';
export const isColumn = <D>(c: unknown): c is ColumnChannel<D> => !!c && typeof c === 'object' && typeof (c as ColumnChannel<D>).value === 'string';
/** the logs a set of channels reads for these items (their loading is the reader's to wait for) */
export function logsOf<D>(chs: Record<string, Channel<D>>, log?: Log | null, items: readonly D[] = []): Log[] {
  const out = new Set<Log>(), all = Object.values(chs).flatMap((c) => (isFormula<D>(c) && c.inputs ? [c, ...Object.values(c.inputs)] : [c]));
  for (const c of all) {
    if (typeof c === 'string' && log) out.add(log);
    else if (isMembers(c)) { const l = c.members.log ?? log; if (l) out.add(l); }
    else if (isColumn<D>(c)) { if (typeof c.log === 'function') { for (const d of items) { const l = c.log(d); if (l) out.add(l); } } else { const l = c.log ?? log; if (l) out.add(l); } }
  }
  return [...out];
}
/** a thing's samples as times (ms) and one value, read once; a step (the value's `step`): held from each sample to
 *  the next, never mixed */
interface Track { t: Float64Array; v: Float64Array; step: boolean }
function trackOf(log: Log, i: number, k: number): Track {
  const n = log.count[i]!, t = new Float64Array(n), v = new Float64Array(n);
  for (let j = 0; j < n; j++) { const sl = log.slot(i, j); t[j] = log.epoch + log.secAt(sl) * 1000; v[j] = log.valueAt(k, sl); }
  return { t, v, step: !!log.values[k]!.step };
}
/** a track's value at a time (held before its first and after its last; between two samples, mixed, or held for a
 *  step), from a cursor that only moves on (the times asked come in order) */
function valueOn(tr: Track, t: number, cur: { j: number }): number {
  const n = tr.t.length; if (!n) return 0;
  while (cur.j + 1 < n && tr.t[cur.j + 1]! <= t) cur.j++;
  const j = cur.j;
  if (t < tr.t[0]!) return tr.v[0]!;
  // (two samples at one time: a step; at that time, the later one)
  if (j >= n - 1 || tr.t[j] === t || tr.step) return tr.v[j]!;
  const a = tr.t[j]!, b = tr.t[j + 1]!;
  return b > a ? tr.v[j]! + ((tr.v[j + 1]! - tr.v[j]!) * (t - a)) / (b - a) : tr.v[j + 1]!;
}
/** a track's value at a time (a step there: the value it steps to), by a binary search */
function valueAfter(tr: Track, t: number): number {
  const T = tr.t, n = T.length; if (!n) return 0;
  let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m]! <= t) lo = m + 1; else hi = m; }
  const j = lo - 1;
  if (j < 0) return tr.v[0]!;
  if (j >= n - 1 || T[j] === t || tr.step) return tr.v[j]!;
  return tr.v[j]! + ((tr.v[j + 1]! - tr.v[j]!) * (t - T[j]!)) / (T[j + 1]! - T[j]!);
}
const aggregate = (agg: 'sum' | 'mean' | 'min' | 'max', xs: number[]) => (!xs.length ? 0 : agg === 'sum' ? xs.reduce((a, b) => a + b, 0) : agg === 'mean' ? xs.reduce((a, b) => a + b, 0) / xs.length : agg === 'min' ? Math.min(...xs) : Math.max(...xs));
/** a track's value just before a time (a step there: the value it steps from) */
function valueBefore(tr: Track, t: number): number {
  const T = tr.t, n = T.length; if (!n) return 0;
  let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m]! < t) lo = m + 1; else hi = m; }
  if (lo >= n) return tr.v[n - 1]!;
  // (a step's value: the one it held since its sample before)
  if (tr.step) return tr.v[lo === 0 ? 0 : lo - 1]!;
  if (T[lo] === t || lo === 0) return tr.v[lo]!;
  const a = T[lo - 1]!, b = T[lo]!;
  return tr.v[lo - 1]! + ((tr.v[lo]! - tr.v[lo - 1]!) * (t - a)) / (b - a);
}

/** an item's samples as derived: their times (NaN: an item of constants only, set to the earliest of all), its place,
 *  each channel's values; what they were derived from (its inputs' marks: the same marks, the same samples) */
interface Derived<D> { d: D; marks: string; t: Float64Array; x: number; y: number; v: Float64Array[] }
/** a log's number for the marks (two logs of one id are two logs) */
const LOG_NO = new WeakMap<Log, number>(); let logNo = 0;
const noOf = (l: Log): number => { let n = LOG_NO.get(l); if (n === undefined) LOG_NO.set(l, (n = ++logNo)); return n; };
/** a thing of a log as it is now: its samples' count, where they start, its ring's head, its last time (a sample more,
 *  or the ring turned, is another mark) */
const thingMark = (log: Log, i: number): string => {
  if (i < 0) return '-';
  const n = log.count[i]!;
  return `${noOf(log)}.${i}.${n}.${log.first[i]}.${log.head[i]}.${n ? log.secAt(log.slot(i, n - 1)) : ''}`;
};
/** two items alike: the same one, or the same fields (each the same, or a props object of the same fields) */
function alike(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  const ka = Object.keys(a), kb = Object.keys(b); if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const x = (a as Record<string, unknown>)[k], y = (b as Record<string, unknown>)[k];
    if (x === y) continue;
    if (!x || !y || typeof x !== 'object' || typeof y !== 'object' || Array.isArray(x) || Array.isArray(y)) return false;
    const kx = Object.keys(x), ky = Object.keys(y); if (kx.length !== ky.length) return false;
    for (const q of kx) if ((x as Record<string, unknown>)[q] !== (y as Record<string, unknown>)[q]) return false;
  }
  return true;
}

/** the channels of a set of items, derived again as their data changes: only the items whose inputs changed (a log's
 *  things it reads, a relation's members of it, the item itself), the others kept as they were derived. One log,
 *  as `derive` makes it, each time */
export class Deriver<D> {
  private chs: Record<string, Channel<D>> = {}; readonly names: string[];
  private o: DeriveOptions<D>; private kept = new Map<string, Derived<D>>();
  /** items derived again in the last call (the tools': what a change cost) */
  remade = 0;
  constructor(chs0: Record<string, Channel<D>>, o: DeriveOptions<D> = {}) {
    // (a formula's own inputs: channels of their own, kept as `formula.input`, given to it by their short names)
    const chs = this.chs;
    for (const [n, c] of Object.entries(chs0)) {
      if (isFormula<D>(c) && c.inputs) {
        const ins = Object.keys(c.inputs); for (const k of ins) chs[`${n}.${k}`] = c.inputs[k]!;
        chs[n] = { formula: (v, d) => c.formula({ ...v, ...Object.fromEntries(ins.map((k) => [k, v[`${n}.${k}`] ?? 0])) }, d) };
      } else chs[n] = c;
    }
    this.names = Object.keys(chs); this.o = o;
    for (const n of this.names) { const c = chs[n]; if (!(typeof c === 'number' || typeof c === 'function' || typeof c === 'string' || isColumn(c) || isCount(c) || isMembers(c) || isFormula(c))) throw new AslnutError('E-DATA-001', `channel '${n}': ${JSON.stringify(c)} is not a channel`, { fix: "a number, d => number, a log's value ('kw', or { value, log, key }), relations.count, relations.members('mean', 'soc'), or { formula: (v, d) => … }" }); }
  }
  /** the log a column channel reads for an item (null: none), and its value's index */
  private columnOf(n: string, c: ColumnChannel<D> | string, d: D): { log: Log | null; k: number; col: ColumnChannel<D> } {
    const col: ColumnChannel<D> = typeof c === 'string' ? { value: c } : c, log = typeof col.log === 'function' ? col.log(d) ?? null : col.log ?? this.o.log ?? null;
    // (an item whose own log is none: 0)
    if (!log && typeof col.log === 'function') return { log: null, k: -1, col };
    if (!log) throw new AslnutError('E-DATA-001', `channel '${n}' reads '${col.value}' of no log`, { fix: `{ value: '${col.value}', log } (or the reader's log)` });
    const k = log.values.findIndex((v) => v.name === col.value);
    if (k < 0) throw new AslnutError('E-DATA-001', `channel '${n}': the log has no value '${col.value}'`, { fix: `its values: ${log.values.map((v) => v.name).join(', ') || 'none'}` });
    return { log, k, col };
  }
  private membersLog(n: string, c: MembersChannel): { log: Log; k: number } {
    const log = c.members.log ?? this.o.log;
    if (!log) throw new AslnutError('E-DATA-001', `channel '${n}' reads its members' '${c.members.value}' of no log`, { fix: `relations.members('${c.members.agg}', '${c.members.value}', log)` });
    const k = log.values.findIndex((v) => v.name === c.members.value);
    if (k < 0) throw new AslnutError('E-DATA-001', `channel '${n}': the log has no value '${c.members.value}'`, { fix: `its values: ${log.values.map((v) => v.name).join(', ') || 'none'}` });
    return { log, k };
  }
  private keysOf(col: ColumnChannel<D>, d: D, id: string): Key[] { const ks = col.key ? col.key(d) : id; return ks === null || ks === undefined ? [] : Array.isArray(ks) ? ks as Key[] : [ks as Key]; }
  /** what an item's samples are derived from, as one string: the things of the logs it reads, its relations' rows */
  private marksOf(d: D, id: string): string {
    let m = '';
    for (const n of this.names) {
      const c = this.chs[n]!;
      if (isCount(c)) { for (const r of c.relations.membersOf(id)) m += `|${r.of}:${r.from}:${r.until}`; }
      else if (isMembers(c)) { const { log } = this.membersLog(n, c); for (const r of c.relations.membersOf(id)) m += `|${r.of}:${r.from}:${r.until}:${thingMark(log, log.indexOf(r.of))}`; }
      else if (typeof c === 'string' || isColumn<D>(c)) {
        const { log, col } = this.columnOf(n, c as ColumnChannel<D> | string, d);
        if (log) for (const x of this.keysOf(col, d, id)) m += `|${thingMark(log, log.indexOf(x))}`;
      }
      m += ';';
    }
    return m;
  }
  /** the items' channels now: one log (a thing an item, a value a channel, 32-bit floats) */
  derive(items: readonly D[]): Log {
    const names = this.names, idOf = this.o.id ?? ((d: D, i: number) => ((d as { id?: Key }).id ?? i));
    const ids: string[] = [], rows: Derived<D>[] = [], next = new Map<string, Derived<D>>();
    let S = 0, remade = 0;
    items.forEach((d, i) => {
      const id = String(idOf(d, i)), marks = this.marksOf(d, id), had = this.kept.get(id);
      const r = had && had.marks === marks && alike(had.d, d) ? had : (remade++, this.one(d, id, marks));
      ids.push(id); rows.push(r); next.set(id, r); S += r.t.length;
    });
    this.kept = next; this.remade = remade;
    // (nothing derived again, the same items in the same order: the same log)
    if (!remade && this.last && this.lastIds.length === ids.length && this.lastIds.every((x, i) => x === ids[i])) return this.last;
    // one log of them all: their samples one after another
    const T = new Float64Array(S), X = new Float64Array(S), Y = new Float64Array(S), V: Record<string, Float64Array> = Object.fromEntries(names.map((n) => [n, new Float64Array(S)]));
    const count: number[] = [], props: Record<string, unknown>[] = [];
    let at = 0, tMin = Infinity;
    for (const r of rows) {
      const n = r.t.length; T.set(r.t, at); X.fill(r.x, at, at + n); Y.fill(r.y, at, at + n);
      names.forEach((k, q) => V[k]!.set(r.v[q]!, at));
      count.push(n); props.push({}); at += n;
      if (r.t[0]! < tMin) tMin = r.t[0]!;
    }
    const t0 = Number.isFinite(tMin) ? tMin : 0;
    for (let k = 0; k < S; k++) if (Number.isNaN(T[k]!)) T[k] = t0;
    this.lastIds = ids;
    return (this.last = Log.fromColumns({ ids, count, t: T, lon: X, lat: Y, values: V, props }, { values: Object.fromEntries(names.map((k) => [k, 'f32' as const])), place: { type: 'f32' }, time: { type: 'f32', epoch: t0 } }));
  }
  private last: Log | null = null; private lastIds: string[] = [];
  /** one item's samples: at every time any of its channels changes */
  private one(d: D, id: string, marks: string): Derived<D> {
    const names = this.names, chs = this.chs, o = this.o, K = names.length;
    // each channel's reader for this item, by its place: a constant, tracks (summed), members (an aggregate of those
    // held), a step (a count's changes), or a formula
    const konst = new Float64Array(K), isConst = new Uint8Array(K), tracks: { k: number; tr: Track[]; cur: Int32Array }[] = [], steps: { k: number; at: number[]; by: number[]; v: number; i: number }[] = [], formulas: { k: number; f: FormulaChannel<D> }[] = [];
    const members: { k: number; agg: 'sum' | 'mean' | 'min' | 'max'; rows: { from: number; until: number; tr: Track | null }[] }[] = [];
    const times: number[] = [];
    names.forEach((n, k) => {
      const c = chs[n]!;
      if (typeof c === 'number') { konst[k] = c; isConst[k] = 1; }
      else if (typeof c === 'function') { konst[k] = Number(c(d)) || 0; isConst[k] = 1; }
      else if (isFormula<D>(c)) formulas.push({ k, f: c });
      else if (isCount(c)) {
        // (+1 when a member comes, −1 when it goes: its count held between)
        const ev: [number, number][] = [];
        for (const r of c.relations.membersOf(id)) ev.push([r.from, 1], [r.until, -1]);
        ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        steps.push({ k, at: ev.map((e) => e[0]), by: ev.map((e) => e[1]), v: 0, i: 0 });
        for (const e of ev) times.push(e[0]);
      } else if (isMembers(c)) {
        // (each member held: its value's track, read while it is held; the aggregate over those held at each time)
        const { log, k: vk } = this.membersLog(n, c);
        const rows = c.relations.membersOf(id).map((r) => { const x = log.indexOf(r.of); return { from: r.from, until: r.until, tr: x >= 0 ? trackOf(log, x, vk) : null }; });
        members.push({ k, agg: c.members.agg, rows });
        for (const r of rows) { times.push(r.from, r.until); if (r.tr) for (const x of r.tr.t) if (x > r.from && x < r.until) times.push(x); }
      } else {
        const { log, k: vk, col } = this.columnOf(n, c as ColumnChannel<D> | string, d);
        const tr = log ? this.keysOf(col, d, id).map((x) => log.indexOf(x)).filter((x) => x >= 0).map((x) => trackOf(log, x, vk)) : [];
        tracks.push({ k, tr, cur: new Int32Array(tr.length) });
        for (const t of tr) for (const x of t.t) times.push(x);
      }
    });
    // every time any channel changes, in order (one sample at least: a constant item)
    times.sort((a, b) => a - b);
    const uniq: number[] = []; for (const t of times) if (!uniq.length || t !== uniq[uniq.length - 1]) uniq.push(t);
    // (an item of constants only: one sample, at the earliest time of all: set once every item is read)
    if (!uniq.length) uniq.push(NaN);
    const at = place(o.place?.(d));
    const T: number[] = [], V: number[][] = names.map(() => []), now = new Float64Array(K), was = new Float64Array(K);
    // (a formula sees the others by name: one record for the item, its fields set at each sample)
    const rec: Record<string, number> = {};
    const put = (t: number, vals: Float64Array) => {
      if (formulas.length) {
        for (let k = 0; k < K; k++) rec[names[k]!] = vals[k]!;
        for (const { k, f } of formulas) { const x = Number(f.formula(rec, d)); vals[k] = Number.isFinite(x) ? x : 0; rec[names[k]!] = vals[k]!; }
      }
      T.push(t); for (let k = 0; k < K; k++) V[k]!.push(vals[k]!);
    };
    const cur = { j: 0 }, held: number[] = [], heldWas: number[] = [];
    for (const t of uniq) {
      // a step changing here (a count; a log's two samples at one time; a step value's sample): its value before, then
      // after (two samples at one time: the chip holds each exactly)
      let changes = false;
      for (let k = 0; k < K; k++) if (isConst[k]) { now[k] = konst[k]!; was[k] = konst[k]!; }
      for (const x of tracks) {
        let s = 0, b = 0;
        for (let q = 0; q < x.tr.length; q++) { cur.j = x.cur[q]!; s += valueOn(x.tr[q]!, t, cur); x.cur[q] = cur.j; b += valueBefore(x.tr[q]!, t); }
        now[x.k] = s; was[x.k] = b; if (b !== s) changes = true;
      }
      for (const m of members) {
        held.length = 0; heldWas.length = 0;
        for (const r of m.rows) { if (!r.tr) continue; if (r.from <= t && t < r.until) held.push(valueAfter(r.tr, t)); if (r.from < t && t <= r.until) heldWas.push(valueBefore(r.tr, t)); }
        now[m.k] = aggregate(m.agg, held); was[m.k] = aggregate(m.agg, heldWas); if (was[m.k] !== now[m.k]) changes = true;
      }
      for (const st of steps) { was[st.k] = st.v; while (st.i < st.at.length && st.at[st.i]! <= t) { st.v += st.by[st.i]!; st.i++; } now[st.k] = st.v; if (st.v !== was[st.k]) changes = true; }
      if (changes) put(t, was);
      put(t, now);
    }
    return { d, marks, t: Float64Array.from(T), x: at[0], y: at[1], v: V.map((c) => Float64Array.from(c)) };
  }
}
/** each item's channels over time as one log (a thing an item, a value a channel, 32-bit floats), derived once (a
 *  Deriver derives them again as their data changes, only what changed) */
export function derive<D>(items: readonly D[], chs: Record<string, Channel<D>>, o: DeriveOptions<D> = {}): Log { return new Deriver(chs, o).derive(items); }
const place = (p: readonly [number, number] | null | undefined): [number, number] => (p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : [0, 0]);
/** the channels namespace */
export const channels = { derive, logsOf, Deriver };
