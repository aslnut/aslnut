// core › render › reveal: how elements appear and disappear. Nothing pops: a layer that becomes shown (added, its `when`
// turning true, w.reveal) plays its reveal, and backwards when hidden; features that arrive later play theirs.
// Timing: dur, ease, stagger (seconds between features) and order (which goes first). Modes per mark; `{ video, app }`
// picks one per context (world option `context`). Your own modes, at two more depths:
//   reveal.define('drop-in', { feature: (d, p) => ({ opacity: p, offset: [0, 0, (1 - p) * 300] }) })   per feature
//   reveal.define('scan', { wgsl: 'alpha = alpha * step(fract(position.y * 0.01 - reveal * 2.0), 0.5);' })  per pixel
import { ease, type Ease } from '../../observation/observers/orbit/ease.ts';
import { AslnutError } from '../../world/errors.ts';
import type { State } from '../../world/state.ts';

/** the built-in modes and the number the shaders know them by */
export const MODES = { fade: 0, trace: 1, pulse: 2, 'trace-fill': 3, grow: 4, wipe: 5, radial: 6, sweep: 7, pop: 8, rise: 9, ripple: 10, type: 11, count: 12, mask: 13, custom: 14 } as const;
export type ModeName = keyof typeof MODES | (string & {});
/** which modes each mark draws (others fall back to fade) */
export const MARK_MODES: Record<string, ModeName[]> = {
  line: ['trace', 'pulse', 'fade'], area: ['trace-fill', 'grow', 'wipe', 'radial', 'sweep', 'fade'], extrusion: ['rise', 'pop', 'sweep', 'fade'],
  point: ['sweep', 'pop', 'fade'], text: ['type', 'count', 'mask', 'fade'], custom: ['fade'],
};
/** how a feature looks at progress p (0 → 1): your mode, depth 3 */
export interface FeatureLook { opacity?: number; /** metres east, north, up */ offset?: [number, number, number]; scale?: number }
export interface ModeSpec { feature?: (d: unknown, p: number, s?: State) => FeatureLook; /** shader statements at the /*@reveal*\/ hook: read `reveal`, `position`, `alpha`; write `alpha` */ wgsl?: string; /** the built-in mode it starts from */ base?: ModeName }
export interface RevealSpec {
  mode?: ModeName;
  /** a mode per context: rich in a recorded video, plain in an app */
  video?: ModeName; app?: ModeName;
  /** seconds per feature (default .8) */
  dur?: number;
  ease?: Ease;
  /** seconds between features (default 0) */
  stagger?: number;
  /** which feature goes first (smaller first) */
  order?: (d: never, s?: State) => number;
  /** lines: trace from the end nearest this place; and features nearest it first */
  from?: [number, number];
  /** play the order backwards */
  reverse?: boolean;
  /** lines: the soft front (fraction of the line) and the glowing head */
  soft?: number; head?: { glow?: number };
}
const defined = new Map<string, ModeSpec>();

export const reveal = {
  /** a new mode: per feature (opacity, offset, scale at progress p) and/or per pixel (a shader line) */
  define(name: string, spec: ModeSpec): string {
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new AslnutError('E-DATA-001', `reveal mode name '${name}' is not plain`, { fix: "use lowercase letters, digits and '-', like 'drop-in'" });
    if (name in MODES) throw new AslnutError('E-DATA-001', `'${name}' is a built-in mode`, { fix: 'pick another name' });
    if (!spec || (typeof spec.feature !== 'function' && typeof spec.wgsl !== 'string')) throw new AslnutError('E-DATA-001', `reveal.define('${name}') needs feature (d, p) => look, or wgsl`, { fix: "reveal.define('drop-in', { feature: (d, p) => ({ opacity: p }) })" });
    defined.set(name, spec);
    return name;
  },
  get: (name: string): ModeSpec | undefined => defined.get(name),
  /** every mode name: built-in and defined */
  names: (): string[] => [...Object.keys(MODES).filter((k) => k !== 'custom'), ...defined.keys()],
  /** forget a defined mode (tests, hot reload) */
  undefine: (name: string) => defined.delete(name),
};

export interface Plan { mode: number; name: string; dur: number; total: number; spec: ModeSpec | null; delays: Float32Array; easeFn: (u: number) => number }
/** an app's reveal (context 'app', the default) when the layer asks for no app mode of its own: a short fade, no
 *  stagger. Rich modes are for recorded videos (context 'video'), or asked for in an app with { app: 'radial' } */
export const APP_FADE = 0.25;
/** the longest a stagger spreads its features over (s), however many there are */
export const STAGGER_MAX = 1;
/** the reveal of a layer: its mode for this context and each feature's delay. `shownOnly`: the features taking part
 *  in a stagger (the others, hidden by their own `when`, wait for nothing) */
export function plan<D>(r: RevealSpec | ModeName | undefined, list: readonly D[], o: { mark: string; context: 'app' | 'video'; s?: State; centreOf?: (d: D) => [number, number] | null; fallback: number; shownOnly?: (i: number) => boolean }): Plan {
  const spec: RevealSpec = typeof r === 'string' ? { mode: r } : r ?? {};
  // an app plays what the code asks for an app (spec.app) and otherwise a short fade; a video the full reveal
  const plain = o.context === 'app' && spec.app === undefined;
  // every mode named is checked, played here or not (a typo shows in the app, not first in the video)
  for (const m of [spec.mode, spec.video, spec.app]) if (m !== undefined && !defined.has(String(m)) && !(String(m) in MODES)) throw new AslnutError('E-DATA-001', `no reveal mode '${m}'`, { fix: `use ${reveal.names().join(', ')}, or reveal.define('${m}', …)` });
  const name = String(plain ? 'fade' : (o.context === 'video' ? spec.video : spec.app) ?? spec.mode ?? 'fade');
  const def = defined.get(name) ?? null;
  const base = def ? (def.base ?? (def.wgsl ? 'custom' : 'fade')) : name;
  if (!def && !(name in MODES)) throw new AslnutError('E-DATA-001', `no reveal mode '${name}'`, { fix: `use ${reveal.names().join(', ')}, or reveal.define('${name}', …)` });
  const allowed = MARK_MODES[o.mark] ?? ['fade'];
  const id = def ? MODES[base as keyof typeof MODES] ?? 0 : allowed.includes(name) || name === 'fade' ? MODES[name as keyof typeof MODES] : 0;
  const asked = r === undefined ? o.fallback : Math.max(0, spec.dur ?? 0.8);
  const dur = plain ? Math.min(asked, APP_FADE) : asked, stagger0 = plain ? 0 : Math.max(0, spec.stagger ?? 0);
  const delays = new Float32Array(list.length);
  if (stagger0 > 0 && list.length > 1) {
    let key: (d: D) => number;
    if (spec.order) key = (d) => (spec.order as (d: D, s?: State) => number)(d, o.s);
    else if (spec.from && o.centreOf) { const f = spec.from; key = (d) => { const c = o.centreOf!(d); return c ? (c[0] - f[0]) ** 2 + (c[1] - f[1]) ** 2 : Infinity; }; }
    else key = () => 0;
    const take: number[] = []; for (let i = 0; i < list.length; i++) if (!o.shownOnly || o.shownOnly(i)) take.push(i);
    const idx = take.map((i) => [i, Number(key(list[i]!)) || 0] as const).sort((a, b) => a[1] - b[1] || a[0] - b[0]);
    // the whole spread capped: a thousand features never make a reveal of many seconds
    const stagger = idx.length > 1 ? Math.min(stagger0, STAGGER_MAX / (idx.length - 1)) : 0;
    idx.forEach(([i], rank) => { delays[i] = (spec.reverse ? idx.length - 1 - rank : rank) * stagger; });
  }
  let maxD = 0; for (const x of delays) if (x > maxD) maxD = x;
  return { mode: id, name, dur, total: Math.max(0.0001, dur + maxD), spec: def, delays, easeFn: (u) => ease(spec.ease ?? 'smooth', u) };
}
/** feature i's progress when the layer's clock (0..1 of the plan's total) is at `t` */
export function progress(p: Plan, i: number, t: number): number {
  if (p.dur <= 0) return t > 0 ? 1 : 0;
  const x = (t * p.total - (p.delays[i] ?? 0)) / p.dur;
  return x <= 0 ? 0 : x >= 1 ? 1 : p.easeFn(x);
}
