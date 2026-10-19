// core › encoding › scales: numbers (or kinds) → looks. A scale is a function you give any prop (`color`, `size`,
// `height`, `width`). Its domain, when you say 'auto' (the default), is read from the WHOLE data, once per change of
// the data (a query's new numbers, a simulation step, rows joined anew), never from what a view has loaded: the same
// value gives the same look, always, at every zoom. A source that follows the view has no whole on the device: a
// scale over it is given its domain (an 'auto' one is an error with its fix). Every scale describes itself for a
// legend: `scale.legend()`.
//   color: scale.quantile(d => d.props.rate, { n: 5, range: 'reds' })         five classes, equal counts
//   color: scale.category(d => d.props.party, { range: 'category' })           a colour per kind
//   size:  scale.sqrt(d => d.props.mw, { range: [4, 30] })                     area ∝ value
import { AslnutError } from '../world/errors.ts';
import type { State } from '../world/state.ts';
import { colours, ramp, type Ramp } from '../render/style/ramp.ts';
import type { Feature } from '../data/features.ts';

export type Value<D> = (d: D, s?: State) => unknown;
export interface LegendItem { color?: string; size?: number; label: string; from?: number; to?: number; value?: unknown }
export interface Legend { kind: 'classes' | 'continuous' | 'categories' | 'image'; items: LegendItem[]; stops?: string[]; domain?: [number, number]; missing?: string; /** kind 'image': a picture of the legend (a map service's GetLegendGraphic) */ image?: string }
export interface Scale<D, T> {
  // any datum: a scale made for features can style any layer (your value function reads what it needs)
  (d: any, s?: State): T;   // eslint-disable-line @typescript-eslint/no-explicit-any
  /** read the domain from the whole data (marks call this when their data changes; `key` names the data's version: the
   *  same key again reads nothing) */
  prepare(data: readonly D[], key?: string): void;
  /** its domain is read from the data ('auto'); false: you gave it */
  readonly auto: boolean;
  legend(o?: { format?: (v: number) => string }): Legend;
  /** the classes' upper breaks (quantile, quantize, threshold), or the categories */
  readonly breaks: readonly unknown[];
  readonly kind: string;
  /** bumped when the domain changes (a layer then restyles) */
  readonly version: number;
}
export interface ScaleOptions<T> {
  /** [min, max], the breaks (threshold), the categories, or 'auto' (from the data) */
  domain?: 'auto' | [number, number] | number[] | unknown[];
  /** a ramp (name, colours, function) or two numbers [from, to] */
  range?: Ramp | [number, number] | T[];
  /** number of classes (quantile, quantize) */
  n?: number;
  clamp?: boolean;
  /** the look of a missing value (no number, no row joined) */
  missing?: T;
  reverse?: boolean;
}
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN);
const isNums = (r: unknown): r is [number, number] => Array.isArray(r) && r.length === 2 && typeof r[0] === 'number' && typeof r[1] === 'number';
const fmt = (v: number) => (Math.abs(v) >= 1000 ? Math.round(v).toLocaleString('en') : Math.abs(v) >= 10 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(1) : v.toPrecision(2));

function make<D, T>(kind: string, value: Value<D>, o: ScaleOptions<T>, f: (x: number) => T, prepare: (xs: number[]) => void, legend: (fm: (v: number) => string) => Legend, breaks: () => unknown[], state: { version: number }, auto: boolean): Scale<D, T> {
  if (typeof value !== 'function') throw new AslnutError('E-DATA-001', `scale.${kind} needs a function of the feature`, { fix: `scale.${kind}(d => d.props.rate, { … })` });
  const missing = (o.missing ?? (isNums(o.range) ? 0 : '#8a8f98')) as T;
  const sc = ((d: D, s?: State) => { const x = num(value(d, s)); return Number.isFinite(x) ? f(x) : missing; }) as Scale<D, T>;
  let lastKey: string | undefined;
  Object.defineProperties(sc, {
    prepare: { value: (data: readonly D[], key?: string) => { if (key !== undefined && key === lastKey) return; lastKey = key; prepare(data.map((d) => num(value(d))).filter(Number.isFinite)); } },
    auto: { value: auto },
    legend: { value: (lo?: { format?: (v: number) => string }) => ({ ...legend(lo?.format ?? fmt), missing: typeof missing === 'string' ? missing : undefined }) },
    breaks: { get: breaks }, kind: { value: kind }, version: { get: () => state.version },
  });
  return sc;
}
/** the output for t in 0..1: a colour from the ramp, or a number between the range's two */
function outOf<T>(o: ScaleOptions<T>): (t: number) => T {
  const r = o.range ?? 'viridis';
  if (isNums(r)) return ((t: number) => r[0] + (r[1] - r[0]) * t) as unknown as (t: number) => T;
  const f = ramp(r as Ramp, { reverse: o.reverse });
  return f as unknown as (t: number) => T;
}
function continuous<D, T>(kind: 'linear' | 'log' | 'sqrt', value: Value<D>, o: ScaleOptions<T> = {}): Scale<D, T> {
  const st = { version: 0 }, out = outOf(o);
  let extent: [number, number] = Array.isArray(o.domain) && o.domain.length === 2 ? o.domain as [number, number] : [0, 1];
  const tf = kind === 'log' ? (x: number) => Math.log10(Math.max(1e-12, x)) : kind === 'sqrt' ? (x: number) => Math.sqrt(Math.max(0, x)) : (x: number) => x;
  const f = (x: number) => { const a = tf(extent[0]), b = tf(extent[1]); let t = b === a ? 0.5 : (tf(x) - a) / (b - a); if (o.clamp !== false) t = Math.max(0, Math.min(1, t)); return out(t); };
  return make(kind, value, o, f, (xs) => { if (o.domain && o.domain !== 'auto') return; if (!xs.length) return; let lo = Infinity, hi = -Infinity; for (const x of xs) { if (x < lo) lo = x; if (x > hi) hi = x; } if (lo !== extent[0] || hi !== extent[1]) { extent = [lo, hi]; st.version++; } },
    (fm) => ({ kind: 'continuous', domain: extent, stops: isNums(o.range) ? undefined : ramp((o.range ?? 'viridis') as Ramp, { reverse: o.reverse }).stops, items: [0, 0.5, 1].map((t) => { const v = kind === 'log' ? 10 ** (tf(extent[0]) + (tf(extent[1]) - tf(extent[0])) * t) : kind === 'sqrt' ? (tf(extent[0]) + (tf(extent[1]) - tf(extent[0])) * t) ** 2 : extent[0] + (extent[1] - extent[0]) * t; const y = f(v); return { label: fm(v), value: v, ...(typeof y === 'string' ? { color: y } : { size: y as number }) }; }) }),
    () => extent, st, !(Array.isArray(o.domain) && o.domain.length === 2));
}
/** Fisher–Jenks natural breaks of sorted values into k classes: each class's lowest value from the second on
 *  (O(k·n²); hundreds of areas are instant) */
export function jenksBreaks(sorted: readonly number[], k: number): number[] {
  const n = sorted.length;
  if (n <= k) return sorted.slice(1);
  const lower: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(0));
  const vari: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(k + 1).fill(Infinity));
  for (let j = 1; j <= k; j++) { lower[1]![j] = 1; vari[1]![j] = 0; }
  for (let l = 2; l <= n; l++) {
    let s1 = 0, s2 = 0, w = 0;
    for (let m = 1; m <= l; m++) {
      const i3 = l - m + 1, v = sorted[i3 - 1]!;
      s2 += v * v; s1 += v; w++;
      const vr = s2 - (s1 * s1) / w;
      if (i3 > 1) for (let j = 2; j <= k; j++) if (vari[l]![j]! >= vr + vari[i3 - 1]![j - 1]!) { lower[l]![j] = i3; vari[l]![j] = vr + vari[i3 - 1]![j - 1]!; }
    }
    lower[l]![1] = 1; vari[l]![1] = s2 - (s1 * s1) / w;
  }
  // walk back: the first value of each class from the second on
  const out: number[] = []; let idx = n;
  for (let j = k; j >= 2; j--) { const first = lower[idx]![j]!; out.unshift(sorted[first - 1]!); idx = first - 1; }
  return out;
}
/** round steps (1, 2, 2.5, 5 × 10ⁿ) covering [lo, hi] in about k classes: the inner breaks */
export function prettyBreaks(lo: number, hi: number, k: number): number[] {
  const raw = (hi - lo) / Math.max(1, k) || 1, mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((x) => x >= raw) ?? raw;
  const out: number[] = []; for (let v = Math.floor(lo / step) * step + step; v < hi - 1e-9 * step && out.length < k - 1; v += step) out.push(+v.toPrecision(12));
  return out;
}
/** classes: values below breaks[i] (and at or above breaks[i-1]) get class i */
function classed<D, T>(kind: 'quantile' | 'quantize' | 'threshold' | 'jenks' | 'pretty', value: Value<D>, o: ScaleOptions<T> = {}): Scale<D, T> {
  const st = { version: 0 };
  // the breaks you gave (threshold; quantile, jenks and pretty given breaks keep them: a source that follows the view)
  const given = Array.isArray(o.domain) && kind !== 'quantize' && (kind === 'threshold' || o.domain.length >= 1);
  let br: number[] = given ? ([...(o.domain as number[])] as number[]) : [];
  if (kind === 'threshold' && !br.length) throw new AslnutError('E-DATA-001', 'scale.threshold needs domain: the breaks', { fix: 'scale.threshold(d => d.props.v, { domain: [10, 50, 100], range: "reds" })' });
  let lo = 0, hi = 1;
  const n = () => (given || ((kind === 'pretty' || kind === 'jenks') && br.length) ? br.length + 1 : o.n ?? 5);
  const looks = (): T[] => {
    const r = o.range ?? 'reds';
    if (Array.isArray(r) && !isNums(r) && r.length >= n() && typeof r[0] !== 'object') return (r as T[]).slice(0, n());
    if (isNums(r)) return Array.from({ length: n() }, (_, i) => (r[0] + ((r[1] - r[0]) * i) / Math.max(1, n() - 1)) as unknown as T);
    const cs = colours(r as Ramp, n()); return (o.reverse ? cs.reverse() : cs) as unknown as T[];
  };
  let cached = looks();
  const f = (x: number) => { let i = 0; while (i < br.length && x >= br[i]!) i++; return cached[Math.min(i, cached.length - 1)]!; };
  const prepare = (xs: number[]) => {
    if (given || !xs.length) { if (given && xs.length) { lo = Math.min(...xs); hi = Math.max(...xs); } return; }
    const sorted = [...xs].sort((a, b) => a - b), k = kind === 'pretty' || kind === 'jenks' ? o.n ?? 5 : n();
    lo = sorted[0]!; hi = sorted[sorted.length - 1]!;
    const next = kind === 'quantile'
      ? Array.from({ length: k - 1 }, (_, i) => sorted[Math.min(sorted.length - 1, Math.floor(((i + 1) * sorted.length) / k))]!)
      : kind === 'jenks' ? jenksBreaks(sorted, k)
      : kind === 'pretty' ? prettyBreaks(lo, hi, k)
      : Array.from({ length: k - 1 }, (_, i) => (Array.isArray(o.domain) ? (o.domain[0] as number) + (((o.domain[1] as number) - (o.domain[0] as number)) * (i + 1)) / k : lo + ((hi - lo) * (i + 1)) / k));
    if (next.join() !== br.join()) { br = next; cached = looks(); st.version++; }
  };
  return make(kind, value, o, f, prepare, (fm) => ({
    kind: 'classes', items: cached.map((c, i) => {
      // before the data is in there are no breaks yet: the classes without numbers
      if (!br.length) return { label: '…', ...(typeof c === 'string' ? { color: c } : { size: c as unknown as number }) };
      const from = i === 0 ? lo : br[i - 1] ?? lo, to = i < br.length ? br[i]! : hi;
      return { from, to, label: i === 0 ? `< ${fm(br[0] ?? hi)}` : i === cached.length - 1 ? `≥ ${fm(br[i - 1] ?? lo)}` : `${fm(from)} – ${fm(to)}`, ...(typeof c === 'string' ? { color: c } : { size: c as unknown as number }) };
    }),
  }), () => br, st, !given && !(kind === 'quantize' && Array.isArray(o.domain) && o.domain.length === 2));
}
/** kinds → looks: a palette in order of first appearance (or your domain), or your own map */
function category<D, T = string>(value: Value<D>, o: ScaleOptions<T> & { map?: Record<string, T>; other?: T } = {}): Scale<D, T> {
  const st = { version: 0 };
  let cats: string[] = Array.isArray(o.domain) ? (o.domain as unknown[]).map(String) : o.map ? Object.keys(o.map) : [];
  let pal: T[] = [];
  const repal = () => {
    const r = o.range as unknown;
    pal = Array.isArray(r) && !isNums(r) && r.length && (r.length >= cats.length || typeof r[0] !== 'string') ? r as T[] : colours((r as Ramp | undefined) ?? 'category', Math.max(1, cats.length)) as unknown as T[];
  };
  repal();
  const missing = (o.missing ?? '#8a8f98') as T, other = (o.other ?? '#8a8f98') as T;
  const sc = ((d: D, s?: State) => {
    const v = value(d, s); if (v === undefined || v === null || v === '') return missing;
    const k = String(v);
    if (o.map && k in o.map) return o.map[k]!;
    const i = cats.indexOf(k); return i >= 0 ? pal[i % pal.length]! : other;
  }) as Scale<D, T>;
  let lastKey: string | undefined;
  Object.defineProperties(sc, {
    auto: { value: !Array.isArray(o.domain) && !o.map },
    prepare: { value: (data: readonly D[], key?: string) => {
      if (key !== undefined && key === lastKey) return; lastKey = key;
      if (Array.isArray(o.domain) || o.map) return;
      const seen = new Set(cats); let added = false;
      for (const d of data) { const v = value(d); if (v === undefined || v === null || v === '') continue; const k = String(v); if (!seen.has(k)) { seen.add(k); cats.push(k); added = true; } }
      if (added) { repal(); st.version++; }
    } },
    legend: { value: () => ({ kind: 'categories', items: cats.map((k, i) => ({ label: k, value: k, color: String(o.map?.[k] ?? pal[i % pal.length]) })), missing: String(missing) }) },
    breaks: { get: () => cats }, kind: { value: 'category' }, version: { get: () => st.version },
  });
  return sc;
}

export const scale = {
  linear: <D = Feature, T = string>(value: Value<D>, o?: ScaleOptions<T>) => continuous<D, T>('linear', value, o),
  log: <D = Feature, T = string>(value: Value<D>, o?: ScaleOptions<T>) => continuous<D, T>('log', value, o),
  sqrt: <D = Feature, T = string>(value: Value<D>, o?: ScaleOptions<T>) => continuous<D, T>('sqrt', value, o),
  quantile: <D = Feature, T = string>(value: Value<D>, o?: ScaleOptions<T>) => classed<D, T>('quantile', value, o),
  quantize: <D = Feature, T = string>(value: Value<D>, o?: ScaleOptions<T>) => classed<D, T>('quantize', value, o),
  threshold: <D = Feature, T = string>(value: Value<D>, o?: ScaleOptions<T>) => classed<D, T>('threshold', value, o),
  /** natural breaks (Fisher–Jenks): classes where the values cluster */
  jenks: <D = Feature, T = string>(value: Value<D>, o?: ScaleOptions<T>) => classed<D, T>('jenks', value, o),
  /** round breaks (1, 2, 2.5, 5 × 10ⁿ): classes a reader can say aloud */
  pretty: <D = Feature, T = string>(value: Value<D>, o?: ScaleOptions<T>) => classed<D, T>('pretty', value, o),
  category: <D = Feature, T = string>(value: Value<D>, o?: ScaleOptions<T> & { map?: Record<string, T>; other?: T }) => category<D, T>(value, o),
};
/** is this prop a scale (it reads its domain from the data) */
export const isScale = (v: unknown): v is Scale<unknown, unknown> => typeof v === 'function' && typeof (v as { prepare?: unknown }).prepare === 'function' && typeof (v as { legend?: unknown }).legend === 'function';
