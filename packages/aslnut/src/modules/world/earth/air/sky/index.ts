// modules › world › earth › air › sky: the Earth's sky for a place and a time. The real sun and moon (ephemeris.ts) where the
// view is, at the world's time; a physical daylight sky near the ground (Preetham), stars and a phase-correct moon at
// night, the haze at the horizon following the sun (gold at dusk, dark blue at night); space and the glow round the
// globe from afar. It lights the world: the sun by day (with shadows when the world draws them), the moon by night,
// the sky's ambient light, the haze the ground fades into. Weather presets grey it (modules › earth › air › weather).
//   earth({ sky: sky() })                                   the sky over the view, at the world's time
//   earth({ sky: sky({ at: [144.96, -37.81], turbidity: 4 }) })
//   w.read('sky.sun')  → { altitude, azimuth }              w.light → the light this frame
import { Element, type AttachContext, type FrameContext, type ElementProps } from '../../../../../core/world/element.ts';
import type { State } from '../../../../../core/world/state.ts';
import type { DrawCall, GBuffer, Program } from '../../../../../core/render/graphics/interface.ts';
import type { Light } from '../../../../../core/render/look/light.ts';
import type { ThemeNow } from '../../../../../core/render/style/theme.ts';
import { ATMOSPHERE_GLSL } from '../../../../../core/render/graphics/shaders/atmosphere.glsl.ts';
import { ATMOSPHERE_WGSL } from '../../../../../core/render/graphics/shaders/atmosphere.wgsl.ts';
import { D, R, tileOf } from '../../../../../core/space/geo.ts';
import type { RasterSource } from '../../../../../core/data/sources/raster.ts';
import type { Loader } from '../../../../../core/data/loading/loader.ts';
import { moonAt, phaseName, skyDir, sunAt, type MoonPosition, type SkyPosition } from './ephemeris.ts';
import { motionFrames } from '../../../../../core/runtime/frame.ts';
import { STARS_GLSL } from '../../../../../core/render/graphics/shaders/stars.glsl.ts';
import { STARS_WGSL } from '../../../../../core/render/graphics/shaders/stars.wgsl.ts';
import { catalogues, skyTurn, starData, STAR_FLOATS, type Catalogue } from './stars.ts';
import type { Leveled } from '../../../../../core/observation/presence.ts';

export { sunAt, moonAt, skyDir, sunTimes, phaseName } from './ephemeris.ts';
export type { SkyPosition, MoonPosition } from './ephemeris.ts';
export { catalogues, parseStars, skyTurn, gmst, starData } from './stars.ts';
export type { Star, Catalogue } from './stars.ts';
/** stars from a catalogue: down to a magnitude, how bright (0..1), how many CSS px a magnitude-0 star spans */
export interface StarsOptions { magnitude?: number; catalogue?: Catalogue; brightness?: number; size?: number }

/** what the weather does to the sky (0..1 each; the weather module eases them between presets) */
export interface SkyWeather { cover: number; overcast: number; rain: number; turbidity: number; fog: number; wind: number; lightning: number }
export const CLEAR: SkyWeather = { cover: 0.18, overcast: 0, rain: 0, turbidity: 2.5, fog: 1, wind: 6, lightning: 0 };
/** weather presets (modules › earth › air › weather › presets): what each does to the sky, the light and the air */
export const WEATHERS: Record<string, SkyWeather & { label: string }> = {
  clear: { label: 'Clear', ...CLEAR },
  partly: { label: 'Partly cloudy', cover: 0.48, overcast: 0.12, rain: 0, turbidity: 4.5, fog: 1.25, wind: 9, lightning: 0 },
  overcast: { label: 'Overcast', cover: 0.8, overcast: 0.62, rain: 0, turbidity: 8, fog: 1.9, wind: 12, lightning: 0 },
  drizzle: { label: 'Drizzle', cover: 0.86, overcast: 0.74, rain: 0.22, turbidity: 9, fog: 2.6, wind: 12, lightning: 0 },
  rain: { label: 'Rain', cover: 0.94, overcast: 0.86, rain: 0.65, turbidity: 10, fog: 3.6, wind: 16, lightning: 0 },
  storm: { label: 'Storm', cover: 1, overcast: 0.95, rain: 1, turbidity: 10, fog: 5, wind: 26, lightning: 1 },
  fog: { label: 'Fog', cover: 0.9, overcast: 0.7, rain: 0, turbidity: 10, fog: 14, wind: 2, lightning: 0 },
};
/** how far one sees through the air for a weather (m): 40 km clear, 3 km in a storm, 600 m in fog */
export const visibilityOf = (w: SkyWeather) => 40000 / Math.max(1, w.fog) ** 1.6;

export interface EarthSkyProps extends ElementProps {
  /** the sun (its disc, its light, its shadows); default true */
  sun?: boolean;
  /** the moon (its disc, its light at night); default true */
  moon?: boolean;
  /** stars at night: false, their brightness 0..1 (default 1: a field of stars made up, nothing loaded), or the real
   *  ones from a catalogue ({ magnitude = 6, catalogue = catalogues.hipparcos(), brightness = 1, size = 3 }: loaded
   *  when night first falls) */
  stars?: boolean | number | StarsOptions;
  /** where the sun and the moon are reckoned: the view's centre (default) or a place [lon, lat] */
  at?: 'view' | [number, number];
  /** the weather's part (cover, overcast, rain, turbidity …): a value, or your function of the state */
  weather?: Partial<SkyWeather> | ((s: State) => Partial<SkyWeather>);
  /** the look from afar: space and the glow round the globe (rgb 0..1) */
  space?: [number, number, number]; glow?: [number, number, number];
  /** brightness of the sun's light on the ground (default 1) */
  sunlight?: number;
  /** clouds: their base above sea level (m, default 2700), their shadows on the ground (default true), the cover from a
   *  raster of your own (cloud cover 0..1 in its red: a satellite's cloud mask; read where the view is); false: none */
  clouds?: false | { base?: number; shadows?: boolean; source?: RasterSource; /** the raster's level read (default 6) */ zoom?: number };
  /** the haze: how thick (× the weather's; default 1), the height over the ground the air thins above (m, default 0)
   *  and over how many metres (default 600), how far one sees on a clear day (m, default 40000) */
  haze?: { level?: number; base?: number; height?: number; clear?: number };
  /** the sky and its haze darkened towards a colour, so that what is drawn over the world reads (an analysis view:
   *  arcs, tinted houses): `amount` 0..1, or your function of the state (a toggle); eased over `seconds` (default 1);
   *  `color` default '#151c28'. Unset: the world's theme dims it (core › render › style › theme: its `sky`); with no
   *  theme either, nothing of it is worked out. */
  dim?: { amount: number | ((s: State) => number); color?: string; seconds?: number };
}
/** weather observed somewhere (stations, a model's grid as points): what each field is called in its props, or your
 *  function of a feature; read at the view's centre (the nearest few, by distance), every `every` seconds */
export interface WeatherFeed {
  /** the observations: features with a point each (a Source, or a function giving them) */
  data: { features(): readonly { geometry: { type: string; coordinates: unknown } | null; props: Record<string, unknown> }[] } | (() => readonly { geometry: { type: string; coordinates: unknown } | null; props: Record<string, unknown> }[]);
  /** wind, m/s */
  wind?: string | ((p: Record<string, unknown>) => number | null);
  /** rain, mm/h (8 mm/h and more: as hard as it rains) */
  rain?: string | ((p: Record<string, unknown>) => number | null);
  /** visibility, m (fog and haze from it) */
  visibility?: string | ((p: Record<string, unknown>) => number | null);
  /** cloud cover, 0..1 (or %, over 1) */
  cover?: string | ((p: Record<string, unknown>) => number | null);
  /** seconds between readings (default 10); seconds the weather eases to a new one (default 3) */
  every?: number; seconds?: number;
}

const sstep = (a: number, b: number, x: number) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
type RGB = [number, number, number];
const lerp = (a: readonly number[], b: readonly number[], t: number): RGB => [a[0]! + (b[0]! - a[0]!) * t, a[1]! + (b[1]! - a[1]!) * t, a[2]! + (b[2]! - a[2]!) * t];
const hex = (h: string): RGB => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255];
const srgb = (c: readonly number[]): RGB => c.map((x) => (x <= 0.0031308 ? x * 12.92 : 1.055 * x ** (1 / 2.4) - 0.055)) as RGB;
const HAZE_DAY = hex('#b4cbe4'), HAZE_GOLD = hex('#f0c49a'), HAZE_DUSK = hex('#6b5d73'), HAZE_NIGHT = hex('#0d1626');
const GREY: RGB = [0.58, 0.61, 0.64], GREY_DARK: RGB = [0.3, 0.32, 0.35], NIGHT_SKY: RGB = [0.012, 0.018, 0.04];
const SUN_LOW: RGB = [1.0, 0.55, 0.3], SUN_HIGH: RGB = [1.0, 0.96, 0.9];

/** everything the sky works out for one moment and place: what it draws and how it lights */
export interface SkyNow {
  sun: SkyPosition; moon: MoonPosition; sunDir: RGB; moonDir: RGB;
  day: number; golden: number; night: number; dusk: number;
  weather: SkyWeather; haze: RGB; light: Light;
}
/** the sky's state for a time and place (also headless: what the UI shows, what tests check) */
export function skyNow(t: Date | number, lon: number, lat: number, weather: SkyWeather = CLEAR, o: { sun?: boolean; moon?: boolean; sunlight?: number } = {}): SkyNow {
  const sun = sunAt(t, lat, lon), moon = moonAt(t, lat, lon), sunDir = skyDir(sun), moonDir = skyDir(moon), w = weather;
  const e = sunDir[1], day = sstep(-0.1, 0.12, e), golden = (1 - sstep(0.02, 0.35, e)) * sstep(-0.08, 0.02, e), night = 1 - sstep(-0.2, -0.02, e), dusk = sstep(-0.22, -0.02, e) * (1 - day);
  // the haze follows the sun, greyed by cloud
  let haze: RGB = e > 0.25 ? HAZE_DAY : e > 0 ? lerp(HAZE_GOLD, HAZE_DAY, e / 0.25) : e > -0.12 ? lerp(HAZE_DUSK, HAZE_GOLD, (e + 0.12) / 0.12) : lerp(HAZE_NIGHT, HAZE_DUSK, Math.max(0, Math.min(1, (e + 0.25) / 0.13)));
  const grey = lerp(GREY, GREY_DARK, w.rain).map((x) => x * (0.08 + 0.92 * day)) as RGB;
  haze = lerp(haze, srgb(grey), w.overcast * 0.85);
  const sunVis = o.sun === false ? 0 : day * (1 - 0.82 * w.overcast);
  const moonVis = o.moon === false ? 0 : night * sstep(-0.05, 0.2, moonDir[1]) * (1 - 0.8 * w.overcast) * (0.15 + 0.85 * moon.illumination);
  // the ground's light: the sun by day, the moon by night; the sky's own light from the haze's colour
  const sunCol = lerp(SUN_LOW, SUN_HIGH, sstep(0.02, 0.5, e)), k = 0.74 * sunVis * (o.sunlight ?? 1);
  // (a low sun lights little from straight on: the sky's own light is fuller then, so the walls turned away from it
  // and the streets in long shadow stay readable; on a phone's small screen most of a golden-hour view is in shade)
  const hemi = lerp(haze, [0.85, 0.9, 1.0], 0.3), amb = 0.1 + 0.3 * day * (1 - 0.25 * w.overcast) + 0.1 * dusk + 0.2 * golden * (1 - 0.5 * w.overcast);
  const byMoon = sunVis < 0.02 && moonVis > 0;
  // the eye adapts: by day, flat ground in the sun comes out about as bright as the imagery (a low sun makes long
  // shadows and warm walls, not a dim world); at night it stays dark
  const ambient = lerp([0.05, 0.06, 0.1], hemi.map((x) => x * amb), day);
  const lum = (c: readonly number[]) => 0.299 * c[0]! + 0.587 * c[1]! + 0.114 * c[2]!;
  const flat = lum(ambient) + lum(sunCol) * k * Math.max(0, e);
  const gain = byMoon ? 1 : 1 + (Math.min(1.7, Math.max(1, (0.4 + 0.55 * day) / Math.max(0.05, flat))) - 1) * day;
  const light: Light = {
    dir: byMoon ? moonDir : sunDir,
    color: byMoon ? [0.55 * 0.2 * moonVis, 0.62 * 0.2 * moonVis, 0.8 * 0.2 * moonVis] : [sunCol[0] * k * gain, sunCol[1] * k * gain, sunCol[2] * k * gain],
    ambient: ambient.map((x) => x * gain) as RGB,
    bounce: 0.35 * day, daylight: Math.max(0.12, day * (1 - 0.45 * w.overcast)),
    shadows: !byMoon && sunVis > 0.05 && e > 0.03, haze,
    visibility: visibilityOf(w), wet: Math.min(1, w.rain * 1.4), cover: w.cover, wind: w.wind, rain: w.rain,
  };
  return { sun, moon, sunDir, moonDir, day, golden, night, dusk, weather: w, haze, light };
}

const linear = (c: readonly number[]): RGB => c.map((x) => (x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4)) as RGB;

export class EarthSky extends Element<EarthSkyProps> {
  readonly kind = 'sky' as const;
  private prog: Program | null = null; private ubuf: GBuffer | null = null; private u = new Float32Array(48);
  private now: SkyNow | null = null; private nowKey = '';
  /** the weather now (eased towards its target), and the lightning's clock */
  private wNow: SkyWeather; private wTarget: SkyWeather | null = null; private wEase = 4; private wName = 'clear';
  private nextFlash = 5; private lastMs = -1; private cloudOff: [number, number] = [0, 0];
  constructor(p: EarthSkyProps = {}) { super({ id: 'sky', ...p }); const wt = this.props.weather; this.wNow = { ...CLEAR, ...(typeof wt === 'object' ? wt : {}) }; }
  /** change the weather: a preset's name (WEATHERS) or your mix; it eases there over `seconds` (default 4) */
  setWeather(w: string | Partial<SkyWeather>, o: { seconds?: number } = {}): this {
    const t = typeof w === 'string' ? WEATHERS[w] : { ...this.wNow, ...w };
    if (!t) throw new Error(`no weather '${w}': ${Object.keys(WEATHERS).join(', ')}`);
    if (typeof w === 'string') this.wName = w;
    this.wTarget = { ...t }; this.wEase = o.seconds ?? 4;
    if (this.wEase <= 0) { this.wNow = { ...this.wTarget }; this.wTarget = null; }
    (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.();
    return this;
  }
  /** the preset last asked for */
  get weatherName(): string { return this.wName; }
  /** how dark it is made now (eased towards the dim's amount; or the world's theme's sky, eased by the world) */
  private dimNow = 0; private dimFrom: RGB | null = null;
  private dimTarget(s: State): number { const d = this.props.dim; if (!d) return 0; const a = typeof d.amount === 'function' ? d.amount(s) : d.amount; return Math.max(0, Math.min(1, Number(a) || 0)); }
  private dimColor(): RGB { return this.props.dim ? hex(this.props.dim.color ?? '#151c28') : this.dimFrom ?? hex('#151c28'); }
  private loader: Loader | null = null;
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    this.loader = ctx.loader;
    const g = ctx.graphics; if (!g) return;
    this.ubuf = g.buffer('uniform', 48 * 4, 'earth sky');
    this.prog = g.program({ label: 'earth sky', wgsl: ATMOSPHERE_WGSL, glsl: ATMOSPHERE_GLSL, blocks: ['Frame', 'U'], depth: { write: false, test: 'always' } });
    await this.prog.ready;
  }
  /** the weather now (your function of the state, or the eased presets) */
  private weather(s: State): SkyWeather { const w = this.props.weather; return typeof w === 'function' ? { ...CLEAR, ...w(s) } : this.wNow; }
  /** the sky for this frame's state (worked out once per moment and place) */
  state(s: State): SkyNow {
    const at: [number, number] = this.props.at && this.props.at !== 'view' ? this.props.at : [s.view.lon, s.view.lat];
    const w = this.weather(s), key = `${s.time.now.getTime()}|${at[0].toFixed(2)}|${at[1].toFixed(2)}|${Object.values(w).join(',')}|${this.props.sunlight ?? 1}`;
    if (key !== this.nowKey || !this.now) { this.nowKey = key; this.now = skyNow(s.time.now, at[0], at[1], w, { sun: this.props.sun, moon: this.props.moon, sunlight: this.props.sunlight }); }
    return this.now;
  }
  override light(s: State): Light {
    const l = this.state(s).light, hz = this.props.haze, cp = this.props.clouds;
    // the haze: thicker or thinner than the weather's, a clear day's distance of your own; the air thins with height
    // (above its base: from high above, the ground is seen through less of it)
    const clear = hz?.clear ?? 40000, vis = ((l.visibility ?? 40000) * clear) / 40000 / Math.max(0.05, hz?.level ?? 1);
    const above = Math.max(0, s.view.altitude - (hz?.base ?? 0));
    const out: Light = { ...l, visibility: vis * (1 + above / Math.max(1, hz?.height ?? 600)), flash: this.flash };
    if (this.dimNow > 0 && l.haze) out.haze = lerp(l.haze, this.dimColor(), this.dimNow * 0.85);
    // the clouds' shadows: the deck where the sky draws it (its pattern's place: the view's centre and the drift)
    if (cp !== false && cp?.shadows !== false && (l.cover ?? 0) > 0.01) {
      const k = R * Math.cos(s.view.lat * D);
      out.clouds = { base: cp?.base ?? 2700, x: ((k * s.view.lon * D + this.cloudOff[0]) % 32000 + 32000) % 32000, z: ((-k * Math.log(Math.tan(Math.PI / 4 + (s.view.lat * D) / 2)) + this.cloudOff[1]) % 32000 + 32000) % 32000 };
    }
    return out;
  }
  // ── weather from observations (a feed) and cloud cover from a raster ──
  private feedNow: WeatherFeed | null = null; private feedAt = -1e9; private feedKey = ''; private coverAt = -1e9; private coverFrom: number | null = null;
  /** the weather from observations: wind, rain, visibility and cover read at the view's centre (the nearest few
   *  stations by inverse distance), eased in; null: back to the presets */
  feed(f: WeatherFeed | null): this { this.feedNow = f; this.feedAt = -1e9; this.feedKey = ''; return this; }
  /** read the feed and the cloud raster now and then (seconds of the world's clock) */
  private readFeeds(s: State, nowMs: number): void {
    const f = this.feedNow;
    if (f && nowMs - this.feedAt > (f.every ?? 10) * 1000) {
      this.feedAt = nowMs;
      const list = typeof f.data === 'function' ? f.data() : f.data.features(), at = [s.view.lon, s.view.lat] as const, kx = Math.cos(at[1] * D);
      const near = list.flatMap((x) => (x.geometry?.type === 'Point' ? [{ p: x.props, d: Math.hypot(((x.geometry.coordinates as number[])[0]! - at[0]) * kx, (x.geometry.coordinates as number[])[1]! - at[1]) }] : [])).sort((a, b) => a.d - b.d).slice(0, 4);
      const read = (k: WeatherFeed['wind']) => {
        if (!k) return null; let sw = 0, sv = 0;
        for (const n of near) { const v = typeof k === 'function' ? k(n.p) : Number(n.p[k]); if (v === null || !Number.isFinite(v)) continue; const wgt = 1 / Math.max(1e-6, n.d) ** 2; sw += wgt; sv += wgt * v; }
        return sw > 0 ? sv / sw : null;
      };
      const wind = read(f.wind), rain = read(f.rain), vis = read(f.visibility), cov = read(f.cover), mix: Partial<SkyWeather> = {};
      if (wind !== null) mix.wind = Math.max(0, wind);
      if (rain !== null) { mix.rain = Math.max(0, Math.min(1, rain / 8)); if (rain > 25) mix.lightning = 1; }
      if (vis !== null) mix.fog = Math.max(1, (40000 / Math.max(50, vis)) ** (1 / 1.6));
      if (cov !== null) { const c = Math.max(0, Math.min(1, cov > 1 ? cov / 100 : cov)); mix.cover = c; mix.overcast = Math.max(0, (c - 0.45) * 1.6); }
      const key = JSON.stringify(mix);
      if (key !== this.feedKey && Object.keys(mix).length) { this.feedKey = key; this.setWeather(mix, { seconds: f.seconds ?? 3 }); this.wName = 'feed'; }
    }
    const cp = this.props.clouds !== false ? this.props.clouds : undefined, src = cp?.source;
    if (src && this.loader && nowMs - this.coverAt > 10000) {
      this.coverAt = nowMs;
      void coverAt(src, s.view.lon, s.view.lat, cp?.zoom ?? 6, this.loader).then((c) => { if (c !== null && Number.isFinite(c) && c !== this.coverFrom) { this.coverFrom = c; this.setWeather({ cover: Math.max(0, Math.min(1, c)) }, { seconds: 3 }); } }).catch(() => {});
    }
  }
  override readouts() {
    const st = () => this.now;
    return {
      sun: () => { const n = st(); return n ? { altitude: +n.sun.altitude.toFixed(2), azimuth: +n.sun.azimuth.toFixed(2) } : null; },
      moon: () => { const n = st(); return n ? { altitude: +n.moon.altitude.toFixed(2), azimuth: +n.moon.azimuth.toFixed(2), illumination: +n.moon.illumination.toFixed(3), phase: phaseName(n.moon.elongation) } : null; },
      daylight: () => st()?.light.daylight ?? null,
    };
  }
  /** the weather's clock: easing towards the target, lightning, the clouds' drift (the world's clock: captures repeat) */
  private tickWeather(ctx: FrameContext): void {
    if (this.feedNow || (this.props.clouds !== false && this.props.clouds?.source)) this.readFeeds(ctx.s, ctx.now);
    const ms = ctx.now, dt = this.lastMs < 0 ? 0 : Math.max(0, Math.min(0.25, (ms - this.lastMs) / 1000)); this.lastMs = ms;
    if (this.wTarget) {
      const k = 1 - Math.exp(-dt * (3 / Math.max(0.1, this.wEase))); let done = true;
      for (const key of Object.keys(this.wNow) as (keyof SkyWeather)[]) { const d = this.wTarget[key] - this.wNow[key]; this.wNow[key] += d * k; if (Math.abs(d) > 1e-3) done = false; }
      if (done) { this.wNow = { ...this.wTarget }; this.wTarget = null; }
    }
    const w = this.weather(ctx.s);
    if (w.lightning > 0.5) { this.nextFlash -= dt; if (this.nextFlash < 0) { this.flash = 1; this.nextFlash = 3 + 9 * ((Math.sin(ms * 0.001237) + 1) / 2); } }
    if (this.flash > 0) this.flash = Math.max(0, this.flash - dt * 4);
    this.cloudOff[0] += dt * w.wind; this.cloudOff[1] += dt * w.wind * 0.35;
    // the dim: your own (eased here), else the world's theme's (eased by the world); neither: none
    const td = this.props.dim ? null : (ctx.world as { themeNow?: ThemeNow | null } | undefined)?.themeNow?.sky ?? null;
    if (this.props.dim) {
      const to = this.dimTarget(ctx.s), k = 1 - Math.exp(-dt * (3 / Math.max(0.05, this.props.dim?.seconds ?? 1)));
      this.dimNow = Math.abs(to - this.dimNow) < 1e-3 ? to : this.dimNow + (to - this.dimNow) * k;
    } else if (td || this.dimNow > 0) { this.dimNow = td ? td.amount : 0; this.dimFrom = td ? [td.color[0], td.color[1], td.color[2]] : null; }
  }
  // ── stars from a catalogue ──
  private starsProg: Program | null = null; private starsU: GBuffer | null = null; private starsBuf: GBuffer | null = null; private starsN = 0;
  private starsLoad: Promise<void> | null = null; private starsKey = ''; private starsFailed: string | null = null; private su = new Float32Array(16);
  /** the real stars from a catalogue (options), the made-up field (true, a brightness) or none (false) */
  stars(o: boolean | number | StarsOptions): this { this.props = { ...this.props, stars: o }; (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); return this; }
  private get starsOpts(): Required<StarsOptions> | null {
    const o = this.props.stars; if (!o || typeof o !== 'object') return null;
    return { magnitude: o.magnitude ?? 6, catalogue: o.catalogue ?? (this.defaultCatalogue ??= catalogues.hipparcos()), brightness: o.brightness ?? 1, size: o.size ?? 3 };
  }
  private defaultCatalogue: Catalogue | null = null;
  /** the catalogue's stars: loaded once (again for another catalogue or magnitude), their program made then */
  private loadStars(o: Required<StarsOptions>): void {
    const key = `${o.catalogue.id}|${o.magnitude}`, g = this.attached?.graphics;
    if (!g || key === this.starsKey) return;
    this.starsKey = key; this.starsFailed = null;
    this.starsProg ??= g.program({ label: 'stars', wgsl: STARS_WGSL, glsl: STARS_GLSL, blocks: ['Frame', 'U'], instance: { stride: STAR_FLOATS, attributes: [{ name: 'a', location: 0, size: 4, offset: 0 }, { name: 'b', location: 1, size: 4, offset: 4 }] }, blend: 'add', depth: { write: false, test: 'always' }, cull: 'none' });
    this.starsU ??= g.buffer('uniform', 16 * 4, 'stars');
    const p = this.starsLoad = Promise.all([o.catalogue.load({ magnitude: o.magnitude, loader: this.loader }), this.starsProg.ready]).then(([list]) => {
      if (this.starsLoad !== p || !this.attached?.graphics) return;
      const d = starData(list); this.starsBuf?.destroy(); this.starsBuf = d.length ? g.buffer('instance', d, 'stars') : null; this.starsN = d.length / STAR_FLOATS;
      (this.attached.world as { invalidate?: () => void }).invalidate?.();
    }, (e: unknown) => { if (this.starsLoad === p) { this.starsFailed = String((e as Error)?.message ?? e); this.attached?.world.error(e); } }).finally(() => { if (this.starsLoad === p) this.starsLoad = null; });
  }
  override status() { const st = super.status(); if (this.starsLoad) st.pending.push('stars loading'); if (this.starsFailed) st.failed.push({ what: 'stars', error: this.starsFailed }); return st; }
  override attribution(): string[] { const o = this.starsOpts; return o && this.starsN ? [o.catalogue.attribution].filter(Boolean) : []; }
  frame(ctx: FrameContext): DrawCall[] {
    if (!this.prog || !this.ubuf) return [];
    this.tickWeather(ctx);
    const n = this.state(ctx.s), p = this.props, u = this.u, w = n.weather, e = n.sunDir[1];
    const up = sstep(-0.03, 0.02, e), low = 1 - sstep(0, 0.35, e);
    const dim = this.dimNow, dimC = dim > 0 ? this.dimColor() : null;
    const greyL = lerp(lerp(GREY, GREY_DARK, w.rain).map((x) => x * (0.08 + 0.92 * n.day)), NIGHT_SKY, n.night * (1 - w.overcast * 0.5));
    const grey = srgb(dimC ? lerp(greyL, linear(dimC), dim) : greyL);
    const exposure = (0.78 + 0.22 * (1 - n.day)) * (1 + 0.2 * w.overcast * n.day) * 0.9;
    u.set([n.sunDir[0], n.sunDir[1], n.sunDir[2], p.sun === false ? 0 : (1 - w.overcast) * up], 0);
    u.set([n.moonDir[0], n.moonDir[1], n.moonDir[2], p.moon === false ? 0 : sstep(-0.03, 0.03, n.moonDir[1]) * (0.35 + 0.65 * n.night) * (1 - 0.92 * w.overcast) * (1 - 0.5 * w.cover * n.day)], 4);
    u.set([w.turbidity, (2.2 + 1.5 * n.golden) * (1 - 0.5 * w.overcast), 0.004 + 0.016 * w.overcast, 0.82], 8);
    // the stars: made up (a brightness), or a catalogue's (drawn apart, below); none
    const so = this.starsOpts, starsK = n.night * (1 - sstep(0.3, 0.9, w.cover)), stars = so || p.stars === false ? 0 : typeof p.stars === 'number' ? p.stars : 1;
    u.set([Math.max(Math.min(0.97, w.overcast * 0.9 + n.night * 0.85), dim * 0.95), n.day * (1 - w.overcast) * (1 - 0.6 * n.golden) * (1 - dim), stars * starsK, ctx.camera.morph], 12);
    const fl = this.flash > 0 ? this.flash * (0.6 + 0.4 * Math.sin(this.flash * 40)) : 0;
    u.set([grey[0], grey[1], grey[2], fl], 16);
    const haze = dimC ? lerp(n.haze, dimC, dim * 0.85) : n.haze;
    u.set([haze[0], haze[1], haze[2], exposure], 20);
    u.set([...(p.space ?? [0.015, 0.02, 0.04]), 1], 24);
    u.set([...(p.glow ?? [0.55, 0.75, 1.0]), 1], 28);
    u.set([R, p.sun === false ? 0 : up * (0.55 + 0.35 * low) * (1 - 0.75 * w.overcast) * (1 - 0.8 * w.rain), 0.0095, 0], 32);
    // clouds: the plane's height over the eye's ground, where the view's centre is in metres (drift and pan), cover;
    // their lit and shaded colours from the sun and the haze
    const cam = ctx.camera, cb = p.clouds === false ? -1 : (p.clouds?.base ?? 2700), k = R * Math.cos(cam.lat * D);
    const ox = ((k * cam.lon * D + this.cloudOff[0]) % 32000 + 32000) % 32000, oz = ((-k * Math.log(Math.tan(Math.PI / 4 + (cam.lat * D) / 2)) + this.cloudOff[1]) % 32000 + 32000) % 32000;
    u.set([cb < 0 ? 0 : w.cover, ox, oz, cb < 0 ? -1 : cb - 0], 36);
    const sunVis = n.day * (1 - 0.82 * w.overcast);
    const lit = lerp(lerp([1, 0.55, 0.3], [1, 0.96, 0.9], sstep(0.02, 0.5, e)).map((x) => x * (0.03 + 0.95 * sunVis + 0.5 * n.dusk)), n.haze, 0.25).map((x, i) => x + [0.05, 0.06, 0.09][i]! * n.night);
    const shade = lerp(lerp(GREY, GREY_DARK, w.rain).map((x) => x * (0.08 + 0.92 * n.day) * (0.55 + 0.4 * n.day)), n.haze, 0.3);
    u.set([...srgb(lit), 1 - sstep(3500, 9000, cam.groundY + cam.dist * Math.sin(cam.pitch))], 40);
    u.set([...srgb(shade), 0], 44);
    this.ubuf.write(u);
    const out: DrawCall[] = [{ program: this.prog, blocks: [ctx.frame, this.ubuf], count: 3 }];
    // a catalogue's stars, once night falls near the ground (loaded then): added over the sky
    const sk = so ? so.brightness * starsK * ctx.camera.morph : 0;
    if (so && sk > 0.003) {
      this.loadStars(so);
      if (this.starsBuf && this.starsN && this.starsProg && this.starsU) {
        const at: [number, number] = p.at && p.at !== 'view' ? p.at : [ctx.s.view.lon, ctx.s.view.lat], r = skyTurn(ctx.s.time.now, at[0], at[1]), su = this.su;
        su.set([...r[0], 0, ...r[1], 0, ...r[2], 0, sk, so.magnitude, so.size, 1]);
        this.starsU.write(su);
        out.push({ program: this.starsProg, blocks: [ctx.frame, this.starsU], instances: this.starsBuf, count: 6, instanceCount: this.starsN });
      }
    }
    return out;
  }
  /** a lightning flash 0..1 (the weather module sets it) */
  flash = 0;
  /** the sky changes by itself while the world's time runs fast (a time-lapse) or a flash plays */
  override animating(s: State): boolean { const w = this.weather(s); return (!!this.props.dim && Math.abs(this.dimTarget(s) - this.dimNow) > 1e-3) || this.flash > 0 || this.wTarget !== null || w.lightning > 0.5 || (w.cover > 0.05 && w.wind > 0) && this.cloudsMove || Math.abs(s.time.rate ?? 0) > 30; }
  /** its frames (core › runtime › frame): a dim easing, a flash, a change of weather every display frame; a storm
   *  between flashes 10 a second (a flash starts on time); drifting clouds (`cloudsMove`) by how fast their shade
   *  crosses the ground on screen (a soft edge may step 6 px a frame). (A time-lapse's sun: the world's own frames) */
  override wantsFrames(s: State): number {
    const w = this.weather(s);
    if ((!!this.props.dim && Math.abs(this.dimTarget(s) - this.dimNow) > 1e-3) || this.flash > 0 || this.wTarget !== null) return Infinity;
    let r = 0;
    if (w.lightning > 0.5) r = 10;
    if (this.cloudsMove && w.cover > 0.05 && w.wind > 0) r = Math.max(r, motionFrames(w.wind / Math.max(1e-3, s.view.pixelSize), { stepPx: 6 }));
    return r;
  }
  /** drifting clouds keep the frames coming (false: they hold still unless something else draws) */
  cloudsMove = false;
  override detach(): void { this.prog?.destroy(); this.ubuf?.destroy(); this.prog = null; this.ubuf = null; this.starsProg?.destroy(); this.starsU?.destroy(); this.starsBuf?.destroy(); this.starsProg = this.starsU = this.starsBuf = null; this.starsN = 0; this.starsKey = ''; this.starsLoad = null; super.detach(); }
}
/** a raster's cloud cover at a place (its tile at that level drawn, the pixel's brightness 0..1: white is cloud) */
export async function coverAt(src: RasterSource, lon: number, lat: number, z: number, loader: Loader): Promise<number | null> {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const zz = Math.max(src.minZoom, Math.min(src.maxZoom, z)), [tx, ty] = tileOf(lon, lat, zz), n = 2 ** zz;
  const c = new OffscreenCanvas(256, 256), g = c.getContext('2d', { willReadFrequently: true }); if (!g) return null;
  if (!(await src.draw(g, { z: zz, x: tx, y: ty }, { loader, priority: 'later', prefetch: false }))) return null;
  const fx = ((lon + 180) / 360) * n - tx, my = (1 - Math.log(Math.tan(Math.PI / 4 + (lat * D) / 2)) / Math.PI) / 2 * n - ty;
  const px = g.getImageData(Math.min(255, Math.max(0, Math.floor(fx * 256))), Math.min(255, Math.max(0, Math.floor(my * 256))), 1, 1).data;
  return (px[3]! / 255) * ((0.299 * px[0]! + 0.587 * px[1]! + 0.114 * px[2]!) / 255);
}
/** the Earth's sky over the view at the world's time: the real sun and moon, stars, a physical sky, its light */
export const sky = (p: Leveled<EarthSkyProps> = {}) => new EarthSky(p as EarthSkyProps);
