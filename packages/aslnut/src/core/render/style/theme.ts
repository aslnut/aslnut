// core › render › style › theme: an analysis view (an "info view", as city-builder games have them). The base world
// (the ground and its imagery, roads, buildings, trees, water, people, the sky) turns grey or dark: greyed, tinted
// towards a colour keeping its light and dark, its brightness and contrast set, the sky and its haze dimmed towards a
// colour (the sky's own `dim`); eased in and out. What the view is about keeps its colour: its subjects (layers you
// name, or whose `subject` prop says so), the selected and the hovered things, and things an analysis tints (a solids
// layer's `tint`); the subjects take their colours from one colour scale (`t.ramp`, `t.scale.*`).
// The muting is one step every program shares (frame.wgsl / frame.glsl: themed), so a theme draws nothing extra; a
// subject layer draws with a copy of the frame block whose muting is 0. No theme set: nothing of it is worked out.
//   const t = theme.dark({ subjects: ['transit'], ramp: 'turbo' });
//   world(canvas, { theme: t }) · w.setTheme(theme.grey(), { seconds: 1 }) · w.setTheme(null)
//   line({ id: 'transit', data, subject: true, color: t.scale.category((d) => d.props.route) })
//   const sepia = theme.define({ grey: 1, tint: '#704214', tintAmount: 0.6 }); w.setTheme(sepia({ subjects: ['x'] }))
import { AslnutError } from '../../world/errors.ts';
import type { Element } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import { shown, type When } from '../../observation/presence.ts';
import { rgba, type Color } from './color.ts';
import { ramp as makeRamp, type Ramp, type RampFn } from './ramp.ts';
import { scale, type Scale, type ScaleOptions, type Value } from '../../encoding/scales.ts';

/** how a theme mutes what is not its subject, and what it keeps */
export interface ThemeSpec {
  /** how grey: 0 keeps the colours, 1 all grey (default 1) */
  grey?: number;
  /** a colour the grey turns towards, keeping its light and dark (default: none) */
  tint?: Color;
  /** how far towards the tint, 0..1 (default .75 with a tint, else 0) */
  tintAmount?: number;
  /** × the brightness: below 1 darker, above 1 lighter (default 1) */
  brightness?: number;
  /** the contrast round the middle grey: below 1 flatter (default 1) */
  contrast?: number;
  /** × the ground's brightness after that (the ground and its imagery): below 1 the ground darker than what stands on
   *  it, as an info view draws it (default 1) */
  ground?: number;
  /** the sky and its haze (the ground's fog) dimmed towards a colour by an amount (the sky's own `dim`); false: the sky
   *  as it is. Default: the preset's */
  sky?: false | { amount?: number; color?: Color };
  /** the layers that keep their colour: ids, or your function of a layer. A layer whose `subject` prop is true is one
   *  too; so are the selected and the hovered things, and what a solids layer tints */
  subjects?: readonly string[] | ((layer: Element) => boolean);
  /** the one colour scale the subjects take their colours from (a ramp's name, colours, stops or your function;
   *  default 'viridis') */
  ramp?: Ramp;
  /** seconds it eases in and out (default 1; 0: at once) */
  seconds?: number;
  /** when it applies: a `when` like every element's (a toggle, a zoom range, your function of the state; default
   *  always). Off, it eases out; on again, in */
  when?: When;
}
/** the scales of `core › render › style › scale`, their range the theme's ramp */
export type ThemeScales = { [K in keyof typeof scale]: <D = unknown>(value: Value<D>, o?: Omit<ScaleOptions<string>, 'range'> & { map?: Record<string, string>; other?: string }) => Scale<D, string> };
/** a theme: what it mutes and how, what it keeps, its colour scale */
export interface Theme {
  readonly name: string;
  readonly spec: Readonly<ThemeSpec>;
  /** the subjects' colour scale: t (0..1) → colour */
  readonly ramp: RampFn;
  /** scale.linear, .quantile, .category … over the theme's ramp: `color: t.scale.quantile((d) => d.props.rate)` */
  readonly scale: ThemeScales;
  /** is a layer one of its subjects (its `subject` prop, or named by `subjects`) */
  subject(layer: Element): boolean;
  /** a colour as the theme mutes it (rgb 0..1; `amount` 0..1, default 1): the shaders' step on the CPU (legends, tests) */
  mute(rgb: readonly number[], amount?: number): [number, number, number];
}

/** the presets' settings (every one can be overridden) */
export const THEMES: Record<'dark' | 'grey' | 'light', ThemeSpec> = {
  // dark blue-grey, the ground darker than what stands on it, the sky and its haze night-blue: what is drawn over it
  // (arcs, tinted houses) reads
  dark: { grey: 0.95, tint: '#394c6a', tintAmount: 0.8, brightness: 0.62, contrast: 0.9, ground: 0.55, sky: { amount: 1, color: '#151c28' } },
  // a neutral grey world under a grey sky: coloured data on it
  grey: { grey: 1, brightness: 1.0, contrast: 0.8, sky: { amount: 0.8, color: '#8e959c' } },
  // pale, low contrast, a light sky: a print-like base
  light: { grey: 1, tint: '#eef1f4', tintAmount: 0.35, brightness: 1.3, contrast: 0.55, sky: { amount: 0.85, color: '#e6eaee' } },
};

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const num = (v: unknown, d: number, what: string, lo = 0, hi = Infinity): number => {
  if (v === undefined) return d;
  if (typeof v !== 'number' || !Number.isFinite(v) || v < lo || v > hi) throw new AslnutError('E-DATA-001', `theme: ${what} must be a number from ${lo} to ${hi === Infinity ? 'any' : hi}, got ${String(v)}`, { fix: `e.g. theme.grey({ ${what}: ${d} })` });
  return v;
};

/** a theme from its settings (a preset's, with yours over them) */
function make(name: string, spec: ThemeSpec): Theme {
  const s: ThemeSpec = { ...spec };
  // checked now, not in a frame
  num(s.grey, 1, 'grey', 0, 1); num(s.tintAmount, 0.75, 'tintAmount', 0, 1); num(s.brightness, 1, 'brightness', 0, 4); num(s.contrast, 1, 'contrast', 0, 4); num(s.ground, 1, 'ground', 0, 4); num(s.seconds, 1, 'seconds', 0);
  if (s.tint !== undefined) rgba(s.tint);
  if (s.sky) { num(s.sky.amount, 1, 'sky.amount', 0, 1); if (s.sky.color !== undefined) rgba(s.sky.color); }
  if (s.subjects !== undefined && typeof s.subjects !== 'function' && !Array.isArray(s.subjects)) throw new AslnutError('E-DATA-001', 'theme: subjects are layer ids or your function of a layer', { fix: "theme.dark({ subjects: ['transit'] }) · theme.dark({ subjects: (l) => l.id.startsWith('access') })" });
  const r = makeRamp(s.ramp ?? 'viridis');
  const scales = Object.fromEntries(Object.entries(scale).map(([k, f]) => [k, (value: Value<unknown>, o: object = {}) => (f as (v: Value<unknown>, o: object) => Scale<unknown, string>)(value, { ...o, range: r })])) as unknown as ThemeScales;
  const ids = Array.isArray(s.subjects) ? new Set(s.subjects as readonly string[]) : null, fn = typeof s.subjects === 'function' ? s.subjects : null;
  const p = pack(s);
  return {
    name, spec: s, ramp: r, scale: scales,
    subject: (l) => (l.props as { subject?: boolean }).subject === true || (ids ? ids.has(l.id) : fn ? !!fn(l) : false),
    mute: (rgb, amount = 1) => muteRGB(rgb, p, amount),
  };
}
/** the settings as the frame block carries them: theme (tint rgb, tint amount) · mute (grey, brightness, contrast,
 *  the ground's ×) · the sky's (rgb, amount) */
function pack(s: ThemeSpec): Float32Array {
  const t = s.tint !== undefined ? rgba(s.tint) : [0.5, 0.5, 0.5], sk = s.sky ? rgba(s.sky.color ?? '#151c28') : [0, 0, 0];
  return Float32Array.from([t[0]!, t[1]!, t[2]!, s.tint !== undefined ? s.tintAmount ?? 0.75 : 0, s.grey ?? 1, s.brightness ?? 1, s.contrast ?? 1, s.ground ?? 1, sk[0]!, sk[1]!, sk[2]!, s.sky ? s.sky.amount ?? 1 : 0]);
}
/** the shaders' `themed` on the CPU (frame.wgsl.ts), over packed settings */
function muteRGB(c: readonly number[], p: ArrayLike<number>, k: number): [number, number, number] {
  const out: [number, number, number] = [c[0]!, c[1]!, c[2]!];
  if (!(k > 0)) return out;
  const l = 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;
  for (let i = 0; i < 3; i++) {
    let m = c[i]! + (l - c[i]!) * p[4]!;
    m = m + (p[i]! * 2 * l - m) * p[3]!;
    m = (m - 0.5) * p[6]! + 0.5;
    m = Math.max(0, m * p[5]!);
    out[i] = c[i]! + (m - c[i]!) * k;
  }
  return out;
}
const preset = (name: 'dark' | 'grey' | 'light') => (o: ThemeSpec = {}): Theme => make(name, { ...THEMES[name], ...o });
/** analysis views: theme.dark(), .grey(), .light() (each with your settings over the preset's), .none() (no theme),
 *  .custom(spec) (all yours), .define(spec) (a preset of your own: a function like theme.dark) */
export const theme = {
  dark: preset('dark'),
  grey: preset('grey'),
  light: preset('light'),
  /** no theme: the world as it is (setTheme(theme.none()) eases the one shown out) */
  none: (): null => null,
  /** a theme of your own settings (the defaults: grey, no tint, no change of brightness or contrast, the sky as it is) */
  custom: (spec: ThemeSpec = {}): Theme => make('custom', { sky: false, ...spec }),
  /** a preset of your own: its settings, yours over them each time it is used */
  define: (spec: ThemeSpec, name = 'custom'): ((o?: ThemeSpec) => Theme) => { make(name, spec); return (o: ThemeSpec = {}) => make(name, { sky: false, ...spec, ...o }); },
};
export const isTheme = (v: unknown): v is Theme => !!v && typeof v === 'object' && typeof (v as Theme).subject === 'function' && typeof (v as Theme).mute === 'function';

/** what the world's theme is doing now (layers read it: the sky dims by it) */
export interface ThemeNow {
  /** how much it mutes now, 0..1 (eased) */
  readonly amount: number;
  /** the sky's dim now: how much (0..1, eased) and towards what colour; null: the sky as it is */
  readonly sky: { amount: number; color: [number, number, number] } | null;
}
const STEP_MS = 125;
/** the world's side: the theme shown, eased in, out and from one to another; written into the frame block */
export class ThemeState implements ThemeNow {
  /** the theme shown (kept while it eases out) and the one asked for */
  shownTheme: Theme | null = null; private want: Theme | null = null;
  /** the amount and the settings now; where the ease started and where it goes (from one theme's settings to another's) */
  private k = 0; private v = new Float32Array(12);
  private k0 = 0; private v0 = new Float32Array(12); private kTo = 0; private to = new Float32Array(12);
  /** the ease: 0 → 1 over `seconds` (smoothstep), 1 when it is still */
  private p = 1; private seconds = 1; private clockMs = 0; private gen = 0; private started = false;
  /** the theme asked for (null: none): eased in over its `seconds` (or yours; 0: at once) */
  set(t: Theme | null, seconds?: number): void {
    if (t !== null && !isTheme(t)) throw new AslnutError('E-DATA-001', 'setTheme takes a theme (theme.dark(), theme.grey() …) or null', { fix: 'w.setTheme(theme.grey({ subjects: [\'my-layer\'] }))' });
    this.want = t; this.gen++;
    this.seconds = seconds ?? t?.spec.seconds ?? this.shownTheme?.spec.seconds ?? 1;
    if (t) { this.to.set(pack(t.spec)); if (!this.shownTheme || this.k <= 0) { this.v.set(this.to); this.shownTheme = t; } }
    // (the target amount is read at the next step, from the theme's `when`)
    this.started = false;
  }
  get asked(): Theme | null { return this.want; }
  get amount(): number { return this.k; }
  /** easing now: the frames keep coming */
  get easing(): boolean { return !this.started ? !!(this.want || this.shownTheme) : this.p < 1; }
  /** muting something now (a subject draws with its own frame block) */
  get active(): boolean { return this.k > 0; }
  /** a step of the world's clock: the amount (the theme's `when`) and the settings eased towards the theme asked for */
  step(dtMs: number, s: State): void {
    if (!this.shownTheme && !this.want) { this.p = 1; this.started = true; return; }
    this.clockMs += dtMs;
    const target = this.want ? shown(this.want.spec.when, s, 'theme') : 0;
    // a new target (a theme asked for, its `when` changed): a new ease from where it is now
    if (!this.started || target !== this.kTo) { this.started = true; this.k0 = this.k; this.v0.set(this.v); this.kTo = target; this.p = 0; }
    if (this.p < 1) {
      this.p = this.seconds <= 0 ? 1 : Math.min(1, this.p + Math.max(0, dtMs) / 1000 / this.seconds);
      const e = this.p * this.p * (3 - 2 * this.p);
      this.k = this.k0 + (this.kTo - this.k0) * e;
      if (this.want) for (let i = 0; i < 12; i++) this.v[i] = this.v0[i]! + (this.to[i]! - this.v0[i]!) * e;
    }
    if (this.want) this.shownTheme = this.want;
    else if (this.k <= 0) { this.shownTheme = null; this.gen++; }
  }
  /** into the frame block at `at`: theme (tint rgb, tint amount), mute (grey, brightness, contrast, amount) and
   *  themeGround (the ground's ×, 0, 0, 0) */
  write(f: Float32Array, at: number, amount = this.k): void {
    const v = this.v;
    f[at] = v[0]!; f[at + 1] = v[1]!; f[at + 2] = v[2]!; f[at + 3] = v[3]!;
    f[at + 4] = v[4]!; f[at + 5] = v[5]!; f[at + 6] = v[6]!; f[at + 7] = this.shownTheme ? amount : 0;
    f[at + 8] = this.shownTheme ? v[7]! : 0; f[at + 9] = 0; f[at + 10] = 0; f[at + 11] = 0;
  }
  get sky(): ThemeNow['sky'] {
    const v = this.v; if (!this.shownTheme || !(v[11]! > 0) || !(this.k > 0)) return null;
    return { amount: clamp01(v[11]! * this.k), color: [v[8]!, v[9]!, v[10]!] };
  }
  /** is a layer a subject of the theme shown */
  subject(l: Element): boolean { return !!this.shownTheme && this.shownTheme.subject(l); }
  /** for marks drawn into the ground's tiles (kept until their look changes): '' with no theme; changes as the muting
   *  does (in steps of 125 ms while it eases, exactly at its end) */
  key(): string {
    if (!this.shownTheme && this.k <= 0) return '';
    return this.p < 1 ? `/th${this.gen}e${Math.floor(this.clockMs / STEP_MS)}` : `/th${this.gen}k${this.k.toFixed(3)}`;
  }
}
