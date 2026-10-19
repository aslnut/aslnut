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
/** a thing's samples as times (ms) and one value, read once */
interface Track { t: Float64Array; v: Float64Array }
function trackOf(log: Log, i: number, k: number): Track {
  const n = log.count[i]!, t = new Float64Array(n), v = new Float64Array(n);
  for (let j = 0; j < n; j++) { const sl = log.slot(i, j); t[j] = log.epoch + log.secAt(sl) * 1000; v[j] = log.valueAt(k, sl); }
  return { t, v };
}
/** a track's value at a time (held before its first and after its last; between two samples, mixed), from a cursor
 *  that only moves on (the times asked come in order) */
function valueOn(tr: Track, t: number, cur: { j: number }): number {
  const n = tr.t.length; if (!n) return 0;
  while (cur.j + 1 < n && tr.t[cur.j + 1]! <= t) cur.j++;
  const j = cur.j;
  if (t < tr.t[0]!) return tr.v[0]!;
  // (two samples at one time: a step; at that time, the later one)
  if (j >= n - 1 || tr.t[j] === t) return tr.v[j]!;
  const a = tr.t[j]!, b = tr.t[j + 1]!;
  return b > a ? tr.v[j]! + ((tr.v[j + 1]! - tr.v[j]!) * (t - a)) / (b - a) : tr.v[j + 1]!;
}
/** a track's value at a time (a step there: the value it steps to), by a binary search */
function valueAfter(tr: Track, t: number): number {
  const T = tr.t, n = T.length; if (!n) return 0;
  let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m]! <= t) lo = m + 1; else hi = m; }
  const j = lo - 1;
  if (j < 0) return tr.v[0]!;
  if (j >= n - 1 || T[j] === t) return tr.v[j]!;
  return tr.v[j]! + ((tr.v[j + 1]! - tr.v[j]!) * (t - T[j]!)) / (T[j + 1]! - T[j]!);
}
const aggregate = (agg: 'sum' | 'mean' | 'min' | 'max', xs: number[]) => (!xs.length ? 0 : agg === 'sum' ? xs.reduce((a, b) => a + b, 0) : agg === 'mean' ? xs.reduce((a, b) => a + b, 0) / xs.length : agg === 'min' ? Math.min(...xs) : Math.max(...xs));
/** a track's value just before a time (a step there: the value it steps from) */
function valueBefore(tr: Track, t: number): number {
  const T = tr.t, n = T.length; if (!n) return 0;
  let lo = 0, hi = n; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m]! < t) lo = m + 1; else hi = m; }
  if (lo >= n) return tr.v[n - 1]!;
  if (T[lo] === t || lo === 0) return tr.v[lo]!;
  const a = T[lo - 1]!, b = T[lo]!;
  return tr.v[lo - 1]! + ((tr.v[lo]! - tr.v[lo - 1]!) * (t - a)) / (b - a);
}

/** each item's channels over time as one log (a thing an item, a value a channel, 32-bit floats), derived once */
export function derive<D>(items: readonly D[], chs0: Record<string, Channel<D>>, o: DeriveOptions<D> = {}): Log {
  // (a formula's own inputs: channels of their own, kept as `formula.input`, given to it by their short names)
  const chs: Record<string, Channel<D>> = {};
  for (const [n, c] of Object.entries(chs0)) {
    if (isFormula<D>(c) && c.inputs) {
      const ins = Object.keys(c.inputs); for (const k of ins) chs[`${n}.${k}`] = c.inputs[k]!;
      chs[n] = { formula: (v, d) => c.formula({ ...v, ...Object.fromEntries(ins.map((k) => [k, v[`${n}.${k}`] ?? 0])) }, d) };
    } else chs[n] = c;
  }
  const names = Object.keys(chs), idOf = o.id ?? ((d: D, i: number) => ((d as { id?: Key }).id ?? i));
  for (const n of names) { const c = chs[n]; if (!(typeof c === 'number' || typeof c === 'function' || typeof c === 'string' || isColumn(c) || isCount(c) || isMembers(c) || isFormula(c))) throw new AslnutError('E-DATA-001', `channel '${n}': ${JSON.stringify(c)} is not a channel`, { fix: "a number, d => number, a log's value ('kw', or { value, log, key }), relations.count, relations.members('mean', 'soc'), or { formula: (v, d) => … }" }); }
  const ids: string[] = [], count: number[] = [], T: number[] = [], X: number[] = [], Y: number[] = [], V: Record<string, number[]> = Object.fromEntries(names.map((n) => [n, []]));
  const props: Record<string, unknown>[] = [];
  let tMin = Infinity;
  items.forEach((d, i) => {
    const id = String(idOf(d, i)); ids.push(id); props.push({});
    // each channel's reader for this item: a constant, tracks (summed), a step (a count's changes), or a formula
    const consts: Record<string, number> = {}, tracks: Record<string, { tr: Track[]; cur: { j: number }[] }> = {}, steps: Record<string, { at: number[]; by: number[] }> = {}, formulas: [string, FormulaChannel<D>][] = [];
    const members: Record<string, { agg: 'sum' | 'mean' | 'min' | 'max'; rows: { from: number; until: number; tr: Track | null }[] }> = {};
    const times: number[] = [];
    for (const n of names) {
      const c = chs[n]!;
      if (typeof c === 'number') consts[n] = c;
      else if (typeof c === 'function') consts[n] = Number(c(d)) || 0;
      else if (isFormula<D>(c)) formulas.push([n, c]);
      else if (isCount(c)) {
        // (+1 when a member comes, −1 when it goes: its count held between)
        const ev: [number, number][] = [];
        for (const r of c.relations.membersOf(id)) ev.push([r.from, 1], [r.until, -1]);
        ev.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
        steps[n] = { at: ev.map((e) => e[0]), by: ev.map((e) => e[1]) };
        for (const e of ev) times.push(e[0]);
      } else if (isMembers(c)) {
        // (each member held: its value's track, read while it is held; the aggregate over those held at each time)
        const log = c.members.log ?? o.log;
        if (!log) throw new AslnutError('E-DATA-001', `channel '${n}' reads its members' '${c.members.value}' of no log`, { fix: `relations.members('${c.members.agg}', '${c.members.value}', log)` });
        const k = log.values.findIndex((v) => v.name === c.members.value);
        if (k < 0) throw new AslnutError('E-DATA-001', `channel '${n}': the log has no value '${c.members.value}'`, { fix: `its values: ${log.values.map((v) => v.name).join(', ') || 'none'}` });
        const rows = c.relations.membersOf(id).map((r) => { const x = log.indexOf(r.of); return { from: r.from, until: r.until, tr: x >= 0 ? trackOf(log, x, k) : null }; });
        members[n] = { agg: c.members.agg, rows };
        for (const r of rows) { times.push(r.from, r.until); if (r.tr) for (const x of r.tr.t) if (x > r.from && x < r.until) times.push(x); }
      } else {
        const col: ColumnChannel<D> = typeof c === 'string' ? { value: c } : c, log = typeof col.log === 'function' ? col.log(d) : col.log ?? o.log;
        // (an item whose own log is none: 0)
        if (!log && typeof col.log === 'function') { tracks[n] = { tr: [], cur: [] }; continue; }
        if (!log) throw new AslnutError('E-DATA-001', `channel '${n}' reads '${col.value}' of no log`, { fix: `{ value: '${col.value}', log } (or the reader's log)` });
        const k = log.values.findIndex((v) => v.name === col.value);
        if (k < 0) throw new AslnutError('E-DATA-001', `channel '${n}': the log has no value '${col.value}'`, { fix: `its values: ${log.values.map((v) => v.name).join(', ') || 'none'}` });
        const ks = col.key ? col.key(d) : id, list = ks === null || ks === undefined ? [] : Array.isArray(ks) ? ks : [ks as Key];
        const tr = list.map((x) => log.indexOf(x)).filter((x) => x >= 0).map((x) => trackOf(log, x, k));
        tracks[n] = { tr, cur: tr.map(() => ({ j: 0 })) };
        for (const t of tr) for (const x of t.t) times.push(x);
      }
    }
    // every time any channel changes, in order (one sample at least: a constant item)
    times.sort((a, b) => a - b);
    const uniq: number[] = []; for (const t of times) if (!uniq.length || t !== uniq[uniq.length - 1]) uniq.push(t);
    // (an item of constants only: one sample, at the earliest time of all: set once every item is read)
    if (!uniq.length) uniq.push(NaN);
    const at = place(o.place?.(d));
    const stepNow: Record<string, { v: number; k: number }> = Object.fromEntries(Object.keys(steps).map((n) => [n, { v: 0, k: 0 }]));
    let n = 0;
    const put = (t: number, vals: Record<string, number>) => {
      for (const [f, c] of formulas) { const x = Number(c.formula(vals, d)); vals[f] = Number.isFinite(x) ? x : 0; }
      T.push(t); X.push(at[0]); Y.push(at[1]); for (const k of names) V[k]!.push(vals[k] ?? 0); n++;
    };
    for (const t of uniq) {
      const vals: Record<string, number> = { ...consts };
      // a step changing here (a count; a log's two samples at one time): its value before, then after (two samples at
      // one time: the chip holds each exactly)
      let changes = false;
      const before: Record<string, number> = {};
      for (const [k, x] of Object.entries(tracks)) { let s = 0, b = 0; x.tr.forEach((tr, q) => { s += valueOn(tr, t, x.cur[q]!); b += valueBefore(tr, t); }); vals[k] = s; before[k] = b; if (b !== s) changes = true; }
      for (const [k, m] of Object.entries(members)) {
        const now: number[] = [], was: number[] = [];
        for (const r of m.rows) { if (!r.tr) continue; if (r.from <= t && t < r.until) now.push(valueAfter(r.tr, t)); if (r.from < t && t <= r.until) was.push(valueBefore(r.tr, t)); }
        vals[k] = aggregate(m.agg, now); before[k] = aggregate(m.agg, was); if (before[k] !== vals[k]) changes = true;
      }
      for (const [k, st] of Object.entries(steps)) { const sn = stepNow[k]!; before[k] = sn.v; while (sn.k < st.at.length && st.at[sn.k]! <= t) { sn.v += st.by[sn.k]!; sn.k++; } if (sn.v !== before[k]) changes = true; }
      if (changes) put(t, { ...vals, ...before });
      for (const k of Object.keys(steps)) vals[k] = stepNow[k]!.v;
      put(t, vals);
    }
    count.push(n);
    if (uniq[0]! < tMin) tMin = uniq[0]!;
  });
  const t0 = Number.isFinite(tMin) ? tMin : 0;
  for (let k = 0; k < T.length; k++) if (Number.isNaN(T[k]!)) T[k] = t0;
  return Log.fromColumns({ ids, count, t: T, lon: X, lat: Y, values: V, props }, { values: Object.fromEntries(names.map((k) => [k, 'f32' as const])), place: { type: 'f32' }, time: { type: 'f32', epoch: t0 } });
}
const place = (p: readonly [number, number] | null | undefined): [number, number] => (p && Number.isFinite(p[0]) && Number.isFinite(p[1]) ? [p[0], p[1]] : [0, 0]);
/** the channels namespace */
export const channels = { derive, logsOf };
