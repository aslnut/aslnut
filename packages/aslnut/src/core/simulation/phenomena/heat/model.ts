// core › simulation › phenomena › heat: urban heat on a raster field, for a person in the street. From rasters of a place (ground
// material, building and canopy heights, awnings, the streets they belong to, where people walk) and the hour's
// weather (air, humidity, wind, cloud, direct and diffuse sun, rain) it works out, cell by cell:
//   L1  the sun's shadow mask (a ray march over the heights) and the sky view factor; the mean radiant temperature a
//       standing person feels (SOLWEIG's six directions: Lindberg et al. 2008), the ground round them and the
//       sun-heated walls beside them counted
//   L2  surface temperatures from their energy balance, with heat stored through the day (force–restore: a spin-up
//       day, then 10-minute steps), rain wetting them
//   L3  the street's air from a canyon heat budget (after TEB, Masson 2000), coupled back into the surfaces; comfort as
//       UTCI (the operational polynomial) and the Bureau of Meteorology's apparent temperature
// Every piece can be switched off (options), to see what it changes. On WebGPU and WebGL2 alike: it runs on the CPU
// (a worker or the main thread in slices), the field is drawn as any raster.
//   const m = heatModel(rasters, { regions })
//   const f = await m.field({ hour: 15, weather, day, sunAt }, DEFAULT_HEAT_OPTIONS)
//   f.point(x, z, 1.1)  → { tmrt, utci, feels, air, surface, sunVisible, … }
import { blackbody, convection, D2R, LAMBDA, MATERIALS, OMEGA, saturationVapour, skyLongwave, solveSteady, stepSurface, surfaceCapacity, albedoOf, vapourPressure, windProfile, WALL, type Material } from './physics.ts';
import { utci, utciStress } from './utci.ts';

/** a place as rasters: x east, z south, `cell` metres a side, row 0 north */
export interface HeatRasters {
  w: number; h: number; cell: number;
  /** each cell's ground: an index into `materials` */
  mat: Uint8Array; materials: Material[];
  /** building height, canopy top and base (m; 0: none), an awning's height over a footpath */
  bH: Float32Array; cTop: Float32Array; cBase: Float32Array; aw?: Float32Array;
  /** the share of the sun each cell's crown lets through (its species' leaves); none: the options' canopyTransmission */
  cTrans?: Float32Array;
  /** the street each cell belongs to (0: none; 1… an index into `regions` + 1) and where people walk */
  region: Uint8Array; walk: Uint8Array;
  regions: { id: string; traffic?: boolean; tallBuildings?: boolean; /** the canyon's width, m (default 25) */ width?: number }[];
}
export interface HourWeather { hour: number; ta: number; rh: number; u10: number; cloud: number; dirH: number; difH: number; precip: number }
export interface DayWeather { date: string; source: string; hours: HourWeather[] }
/** the sun in the rasters' frame: degrees above the horizon, degrees clockwise from north */
export interface Sun { elevation: number; azimuth: number }
export interface HeatInput { hour: number; weather: HourWeather; day: DayWeather | null; sunAt: (hour: number) => Sun; /** what the day's run is cached by */ key: string }
export interface HeatOptions {
  /** surfaces store heat through the day (force–restore) */ memory: boolean;
  /** a person feels the ground around them, not only underfoot */ surroundings: boolean;
  /** walls have their own temperature from sun and air */ walls: boolean;
  /** rain wets surfaces: evaporation, darker when wet */ rain: boolean;
  /** surfaces lose heat to the street's air, not the station's */ coupling: boolean;
  /** street air from a canyon heat budget */ canyon: boolean;
  /** the share of direct sun through a tree crown */ canopyTransmission: number;
}
export const DEFAULT_HEAT_OPTIONS: HeatOptions = { memory: true, surroundings: true, walls: true, rain: true, coupling: true, canyon: true, canopyTransmission: 0.03 };
export const HEAT_OPTION_INFO: { key: keyof HeatOptions; label: string; help: string }[] = [
  { key: 'memory', label: 'Heat stored through the day', help: 'Surfaces warm up from the morning and give heat back after sunset' },
  { key: 'surroundings', label: 'Heat from surrounding surfaces', help: 'The road beside you and the grass strip count, not only the ground underfoot' },
  { key: 'walls', label: 'Sun-heated walls', help: 'Each street front\'s temperature from its sun, sky, ground and air' },
  { key: 'rain', label: 'Rain wets surfaces', help: 'Water on the ground evaporates and cools it; wet surfaces are darker' },
  { key: 'coupling', label: 'Surfaces and street air coupled', help: 'Surfaces lose heat to the warmer street air rather than the weather station\'s air' },
  { key: 'canyon', label: 'Street air from canyon heat budget', help: 'Air warmed by road, walls and traffic, flushed by wind; deep canyons flush slower' },
];
export { utciStress };

const STEP = 600, WET_MM = 0.05, WALL_BASE = 2, TRAFFIC_HEAT = 50, EXCHANGE = 0.03, TREE_LATENT = 0.25, CANOPY_OPACITY = 0.7;
const NORMALS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** a street's front facing one way: its area, mean height, places to test the sun on, the ground in front of it */
interface Facade { region: number; q: number; nx: number; nz: number; area: number; h: number; samples: number[]; front: number[] }
interface Budget { area: number; crownArea: number; traffic: boolean; height: number; width: number }
interface Kernel { di: Int16Array; dj: Int16Array; down: Float32Array; sides: Float32Array[] }
interface HourState { hour: number; w: HourWeather; sun: Sun; Ts: Float32Array; wet: Uint8Array; Sg: Float32Array; wallT: Float32Array; wallK: Float32Array; dStreet: number[]; memoryUsed: boolean }
/** what a person at a place feels, and why */
export interface HeatPoint {
  k: number; material: Material; region: number; height: number; sunVisible: number; svf: number; surface: number; airBackground: number; streetAir: number; nearSurface: number;
  air: number; Kdown: number; Kup: number; kDirect: number; beam: number; Ldown: number; Lup: number; Lsky: number; groundL: number; besideL: number; besideT: number | null; wet: boolean;
  tmrt: number; wind: number; ws10: number; vapour: number; radiationLoad: number; feels: number; utci: number; stress: string; canopyOverhead: boolean; underAwning: boolean; memoryUsed: boolean;
}
export interface HeatField {
  Ts: Float32Array; Sg: Float32Array; dStreet: number[]; wallT: Float32Array; Lsky: number; In: number; memoryUsed: boolean;
  /** a person at (x, z) metres of the rasters, y metres up; `sun`: as if in the sun (1) or shade (the crown's share) */
  point(x: number, z: number, y: number, sun?: number): HeatPoint | null;
  /** is (x, z, y) in the sun: 1, a crown's share, 0 */
  sunVisibility(x: number, z: number, y: number): number;
}

/** what depends on the place alone: the sky view, the street fronts, materials per cell, the people's kernels */
export function heatModel(r: HeatRasters) {
  const n = r.w * r.h, c = r.cell;
  const svf = skyViewFactor(r), facades = buildFacades(r);
  const regions = r.regions.length + 1;
  const shelter = new Float32Array(n), budgets: Budget[] = Array.from({ length: regions }, () => ({ area: 0, crownArea: 0, traffic: false, height: 0, width: 25 }));
  for (let k = 0; k < n; k++) {
    const reg = r.region[k]!, s = reg > 0 ? r.regions[reg - 1] : undefined;
    shelter[k] = (s?.tallBuildings ? 0.7 : 1) * (r.cTop[k]! > 0 ? 0.8 : 1);
    if (r.walk[k] && reg > 0) { budgets[reg]!.area += c * c; if (r.cTop[k]! > 0) budgets[reg]!.crownArea += c * c; }
  }
  for (let reg = 1; reg < regions; reg++) {
    const s = r.regions[reg - 1]!, fs = facades.filter((f) => f.region === reg), a = fs.reduce((t, f) => t + f.area, 0);
    budgets[reg]!.traffic = !!s.traffic; budgets[reg]!.width = s.width ?? 25;
    budgets[reg]!.height = a ? fs.reduce((t, f) => t + f.h * f.area, 0) / a : 0;
  }
  const P = { albedo: new Float32Array(n), emissivity: new Float32Array(n), evap: new Float32Array(n), waterCap: new Float32Array(n), capacity: new Float32Array(n), hcFactor: new Float32Array(n), building: new Uint8Array(n) };
  for (let k = 0; k < n; k++) {
    const m = r.materials[r.mat[k]!]!;
    P.albedo[k] = m.albedo; P.emissivity[k] = m.emissivity; P.evap[k] = m.evap; P.waterCap[k] = m.waterCap; P.capacity[k] = surfaceCapacity(m);
    P.hcFactor[k] = m.id === 'grass' || m.id === 'drygrass' ? 1.5 : 1; P.building[k] = r.bH[k]! > 0 ? 1 : 0;
  }
  const kernels = new Map<number, Kernel>(), sunCache = new Map<string, Float32Array>(), dayCache = new Map<string, HourState[]>();
  const wallCap = surfaceCapacity(WALL);
  const kernel = (y: number) => { let k = kernels.get(y); if (!k) { k = makeKernel(y, c); kernels.set(y, k); } return k; };
  const cellIdx = (x: number, z: number) => { const i = Math.floor(x / c), j = Math.floor(z / c); return i < 0 || j < 0 || i >= r.w || j >= r.h ? -1 : j * r.w + i; };
  const matOf = (k: number) => r.materials[r.mat[k]!]!;

  function forcing(w: HourWeather, sun: Sun, opt: HeatOptions) {
    const el = sun.elevation * D2R, key = `${sun.elevation.toFixed(2)}|${sun.azimuth.toFixed(2)}|${opt.canopyTransmission}`;
    let Sg = sunCache.get(key); if (!Sg) { Sg = groundSun(r, sun, opt.canopyTransmission); if (sunCache.size > 64) sunCache.clear(); sunCache.set(key, Sg); }
    const vis = sunTest(r, sun, opt.canopyTransmission);
    const In = el > 0.02 ? Math.min(1100, w.dirH / Math.sin(el)) : 0;
    const faceSun = facades.map((f) => (opt.walls ? facadeSunlit(f, sun, vis) : 0)), faceInc = facades.map((f) => incidence(f, sun));
    return { Sg, vis, In, Lsky: skyLongwave(w.ta, w.rh, w.cloud), faceSun, faceInc };
  }
  function wallMeans(wallT: Float32Array, wallK: Float32Array, w: HourWeather, opt: HeatOptions, dStreet: number[]) {
    const T = Array.from({ length: regions }, (_, reg) => w.ta + (dStreet[reg] ?? 0) + WALL_BASE), K = Array.from({ length: regions }, () => 0.3 * (w.dirH + w.difH));
    if (!opt.walls) return { T, K };
    const st = new Float64Array(regions), sk = new Float64Array(regions), sa = new Float64Array(regions);
    facades.forEach((f, i) => { st[f.region]! += wallT[i]! * f.area; sk[f.region]! += wallK[i]! * f.area; sa[f.region]! += f.area; });
    for (let reg = 0; reg < regions; reg++) if (sa[reg]) { T[reg] = st[reg]! / sa[reg]!; K[reg] = sk[reg]! / sa[reg]!; }
    return { T, K };
  }
  function cellIn(k: number, w: HourWeather, Sg: Float32Array, Lsky: number, means: { T: number[]; K: number[] }) {
    const V = svf[k]!, reg = r.region[k]!;
    return { K: w.dirH * Sg[k]! + w.difH * V + (1 - V) * WALL.albedo * means.K[reg]!, Lin: V * Lsky + (1 - V) * blackbody(means.T[reg]!, 0.95) };
  }
  function wallIn(i: number, w: HourWeather, F: ReturnType<typeof forcing>, Ts: Float32Array) {
    const f = facades[i]!; let gK = 0, gL = 0, alb = 0;
    for (const k of f.front) { const m = matOf(k); gK += w.dirH * F.Sg[k]! + w.difH * svf[k]!; gL += blackbody(Ts[k]!, m.emissivity); alb += m.albedo; }
    const nf = Math.max(1, f.front.length);
    const K = F.In * F.faceInc[i]! * F.faceSun[i]! + 0.5 * 0.8 * w.difH + 0.5 * (alb / nf) * (gK / nf);
    const Lin = 0.5 * (0.8 * F.Lsky + 0.2 * blackbody(w.ta + WALL_BASE, 0.95)) + 0.5 * (f.front.length ? gL / nf : blackbody(w.ta, 0.95));
    const reg = r.regions[f.region - 1];
    return { K, Lin, hc: convection(windProfile(w.u10, f.h / 2) * (reg?.tallBuildings ? 0.7 : 1)) };
  }
  const cellHc = (k: number, w: HourWeather) => convection(windProfile(w.u10, 2) * shelter[k]!) * P.hcFactor[k]!;
  function canyon(b: Budget, sensible: number, u10: number, sunlight: number): number {
    if (!b.area) return 0;
    const vent = b.height > 0 ? Math.exp(-b.height / (4 * b.width)) : 1, we = Math.max(0.01, EXCHANGE * windProfile(u10, Math.max(4, b.height)) * vent);
    const gain = sensible + (b.traffic ? TRAFFIC_HEAT * b.area : 0) - TREE_LATENT * sunlight * b.crownArea;
    return Math.max(-3, Math.min(6, gain / (1200 * we * b.area)));
  }
  const simpleAir = (excess: number, canopy: number, u10: number) => Math.max(-2.5, Math.min(3, (0.04 * excess - 1.5 * canopy) / (1 + 0.3 * u10)));
  function airFromBudget(sens: Float64Array, excess: Float64Array, w: HourWeather, opt: HeatOptions): number[] {
    return budgets.map((b, reg) => (!b.area ? 0 : !opt.canyon ? simpleAir(excess[reg]! / (b.area / (c * c)), b.crownArea / b.area, w.u10) : canyon(b, sens[reg]!, w.u10, w.dirH + w.difH)));
  }
  function streetAir(Ts: Float32Array, wallT: Float32Array, w: HourWeather, opt: HeatOptions, prev: number[]): number[] {
    const sens = new Float64Array(regions), excess = new Float64Array(regions);
    for (let k = 0; k < n; k++) { if (!r.walk[k]) continue; const reg = r.region[k]!; sens[reg]! += cellHc(k, w) * (Ts[k]! - (w.ta + (prev[reg] ?? 0))) * c * c; excess[reg]! += Ts[k]! - w.ta; }
    facades.forEach((f, i) => { sens[f.region]! += convection(windProfile(w.u10, f.h / 2)) * (wallT[i]! - (w.ta + (prev[f.region] ?? 0))) * f.area; });
    return airFromBudget(sens, excess, w, opt);
  }
  /** one hour on its own: the balance at that hour, no memory of earlier hours */
  function steadyHour(input: HeatInput, opt: HeatOptions): HourState {
    const w = input.weather, sun = input.sunAt(input.hour), F = forcing(w, sun, opt);
    const Ts = new Float32Array(n), wet = new Uint8Array(n), wallT = new Float32Array(facades.length).fill(w.ta + WALL_BASE), wallK = new Float32Array(facades.length);
    const raining = opt.rain && (w.precip || 0) > 0.1;
    let dStreet = new Array<number>(regions).fill(0);
    for (let it = 0; it < (opt.coupling ? 3 : 1); it++) {
      const means = wallMeans(wallT, wallK, w, opt, dStreet);
      for (let k = 0; k < n; k++) {
        if (P.building[k]) { Ts[k] = w.ta + 8; continue; }
        const { K, Lin } = cellIn(k, w, F.Sg, F.Lsky, means);
        wet[k] = raining ? 1 : 0;
        Ts[k] = solveSteady(matOf(k), K, Lin, cellHc(k, w), w.ta + (opt.coupling ? dStreet[r.region[k]!]! : 0), raining);
      }
      facades.forEach((f, i) => { const { K, Lin, hc } = wallIn(i, w, F, Ts); wallK[i] = K; wallT[i] = opt.walls ? solveSteady(WALL, K, Lin, hc, w.ta + (opt.coupling ? dStreet[f.region]! : 0)) : w.ta + WALL_BASE; });
      dStreet = streetAir(Ts, wallT, w, opt, opt.coupling ? dStreet : new Array<number>(regions).fill(0));
    }
    return { hour: input.hour, w, sun, Ts, wet, Sg: F.Sg, wallT, wallK, dStreet, memoryUsed: false };
  }
  /** the whole day in 10-minute steps after a spin-up day; a picture per hour. The deep temperature each surface relaxes
   *  to is its own mean over the spin-up day (force–restore) */
  async function runDay(day: DayWeather, sunAt: (h: number) => Sun, opt: HeatOptions, yieldEvery?: () => Promise<void>): Promise<HourState[]> {
    const hours = day.hours, nf = facades.length, steps = 3600 / STEP;
    const meanAir = hours.reduce((s, x) => s + x.ta, 0) / hours.length;
    const Ts = new Float32Array(n).fill(hours[0]!.ta), water = new Float32Array(n), wet = new Uint8Array(n), deep = new Float32Array(n).fill(meanAir), sumTs = new Float64Array(n);
    const wallT = new Float32Array(nf).fill(hours[0]!.ta + WALL_BASE), wallK = new Float32Array(nf), wallDeep = new Float32Array(nf).fill(meanAir), sumWall = new Float64Array(nf);
    const Kbase = new Float32Array(n), hc = new Float32Array(n), out: HourState[] = [];
    let dStreet = new Array<number>(regions).fill(0);
    for (let pass = 0; pass < 2; pass++) {
      for (const w of hours) {
        const sun = sunAt(w.hour), F = forcing(w, sun, opt), rainStep = opt.rain ? ((w.precip || 0) * STEP) / 3600 : 0, u2 = windProfile(w.u10, 2);
        for (let k = 0; k < n; k++) { Kbase[k] = w.dirH * F.Sg[k]! + w.difH * svf[k]!; hc[k] = convection(u2 * shelter[k]!) * P.hcFactor[k]!; }
        for (let s = 0; s < steps; s++) {
          const means = wallMeans(wallT, wallK, w, opt, dStreet);
          const Lobst = means.T.map((t) => blackbody(t, 0.95)), Kwall = means.K.map((x) => WALL.albedo * x);
          const sens = new Float64Array(regions), excess = new Float64Array(regions);
          for (let k = 0; k < n; k++) {
            if (P.building[k]) { Ts[k] = w.ta + 8; continue; }
            const reg = r.region[k]!, V = svf[k]!, K = Kbase[k]! + (1 - V) * Kwall[reg]!, Lin = V * F.Lsky + (1 - V) * Lobst[reg]!;
            const isWet = opt.rain && water[k]! > WET_MM, alb = isWet ? P.albedo[k]! * 0.8 : P.albedo[k]!, ev = isWet ? Math.max(P.evap[k]!, 0.7) : P.evap[k]!;
            const T = Ts[k]!, Tk = T + 273.15, eps = P.emissivity[k]!, airC = w.ta + (opt.coupling ? dStreet[reg]! : 0);
            const Rn = (1 - alb) * K + eps * Lin - eps * 5.67e-8 * Tk * Tk * Tk * Tk, LE = ev * (Rn > 0 ? Rn : 0), H = hc[k]! * (T - airC);
            if (r.walk[k]) { sens[reg]! += hc[k]! * (T - (w.ta + dStreet[reg]!)) * c * c; excess[reg]! += T - w.ta; }
            Ts[k] = T + STEP * ((Rn - H - LE) / P.capacity[k]! - OMEGA * (T - deep[k]!));
            wet[k] = isWet ? 1 : 0;
            if (opt.rain) water[k] = Math.max(0, Math.min(P.waterCap[k]!, water[k]! + rainStep - (isWet ? (LE * STEP) / LAMBDA : 0)));
          }
          for (let i = 0; i < nf; i++) {
            const f = facades[i]!, { K, Lin, hc: h2 } = wallIn(i, w, F, Ts);
            wallK[i] = K;
            wallT[i] = opt.walls ? stepSurface(wallT[i]!, WALL, wallCap, K, Lin, h2, w.ta + (opt.coupling ? dStreet[f.region]! : 0), wallDeep[i]!, false, STEP).T : w.ta + WALL_BASE;
            sens[f.region]! += convection(windProfile(w.u10, f.h / 2)) * (wallT[i]! - (w.ta + dStreet[f.region]!)) * f.area;
          }
          dStreet = airFromBudget(sens, excess, w, opt);
          if (pass === 0) { for (let k = 0; k < n; k++) sumTs[k]! += Ts[k]!; for (let i = 0; i < nf; i++) sumWall[i]! += wallT[i]!; }
        }
        if (pass === 1) out[w.hour] = { hour: w.hour, w, sun, Ts: Ts.slice(), wet: wet.slice(), Sg: F.Sg, wallT: wallT.slice(), wallK: wallK.slice(), dStreet: dStreet.slice(), memoryUsed: true };
        if (yieldEvery) await yieldEvery();
      }
      if (pass === 0) { const cnt = hours.length * steps; for (let k = 0; k < n; k++) deep[k] = sumTs[k]! / cnt; for (let i = 0; i < nf; i++) wallDeep[i] = sumWall[i]! / cnt; }
    }
    return out;
  }
  async function hourState(input: HeatInput, opt: HeatOptions, yieldEvery?: () => Promise<void>): Promise<HourState> {
    if (!opt.memory || !input.day || input.day.hours.length < 24) return steadyHour(input, opt);
    const key = `${input.key}|${JSON.stringify(opt)}`;
    let day = dayCache.get(key);
    if (!day) { if (dayCache.size > 12) dayCache.clear(); day = await runDay(input.day, input.sunAt, opt, yieldEvery); dayCache.set(key, day); }
    return day[input.hour] ?? steadyHour(input, opt);
  }
  /** the field at an hour: surfaces, street air, and what a person feels anywhere */
  async function field(input: HeatInput, opt: HeatOptions = DEFAULT_HEAT_OPTIONS, o: { yield?: () => Promise<void> } = {}): Promise<HeatField> {
    const st = await hourState(input, opt, o.yield);
    const w = st.w, sun = st.sun, F = forcing(w, sun, opt), el = sun.elevation * D2R, az = sun.azimuth * D2R;
    const means = wallMeans(st.wallT, st.wallK, w, opt, st.dStreet), e = vapourPressure(w.ta, w.rh);
    // what each ground cell sends up: heat radiation and reflected sun
    const Lup = new Float32Array(n), Kup = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      if (P.building[k]) { const reg = r.region[k]!; Lup[k] = blackbody(means.T[reg] ?? w.ta + WALL_BASE, WALL.emissivity); Kup[k] = WALL.albedo * (means.K[reg] ?? 0); continue; }
      const m = matOf(k), ci = cellIn(k, w, st.Sg, F.Lsky, means);
      Kup[k] = albedoOf(m, !!st.wet[k]) * ci.K; Lup[k] = blackbody(st.Ts[k]!, m.emissivity) + (1 - m.emissivity) * ci.Lin;
    }
    const facadeT = (reg: number, q: number) => { const i = facades.findIndex((f) => f.region === reg && f.q === q); return i >= 0 ? { T: st.wallT[i]!, K: st.wallK[i]! } : null; };
    const shadedSurface = (k: number) => {
      const m = matOf(k), K = w.dirH * (r.cTrans?.[k] || opt.canopyTransmission) + w.difH * svf[k]!, Lin = svf[k]! * F.Lsky + (1 - svf[k]!) * blackbody(means.T[r.region[k]!]!, 0.95);
      return solveSteady(m, K, Lin, cellHc(k, w), w.ta + st.dStreet[r.region[k]!]!, !!st.wet[k]);
    };
    const point = (x: number, z: number, y: number, sunOverride?: number): HeatPoint | null => {
      const k = cellIdx(x, z); if (k < 0 || P.building[k]) return null;
      const i = k % r.w, j = Math.floor(k / r.w), reg = r.region[k]!, m = matOf(k);
      const S = sunOverride ?? F.vis(x, z, y), V = svf[k]!;
      const ts = sunOverride !== undefined && sunOverride < 0.5 ? shadedSurface(k) : st.Ts[k]!;
      const nearSurface = 0.1 * (ts - w.ta) * Math.exp(-y / 0.25), ta = w.ta + st.dStreet[reg]! + nearSurface;
      const obstL = blackbody(opt.walls ? means.T[reg]! : ta + WALL_BASE, 0.95);
      const dirFace = (q: number) => F.In * Math.cos(el) * S * Math.max(0, Math.cos(az - (q * Math.PI) / 2));
      let Kdown: number, Ldown: number, KupP: number, LupP: number, sides = 0, kDirect = 0, groundL: number, besideL = 0, besideT: number | null = null;
      if (!opt.surroundings) {
        const wallRefl = (1 - V) * 0.3 * 0.5 * (w.dirH + w.difH);
        Kdown = w.dirH * S + w.difH * V + wallRefl * 0.5;
        KupP = albedoOf(m, !!st.wet[k]) * (w.dirH * (sunOverride ?? st.Sg[k]!) + w.difH * V);
        Ldown = V * F.Lsky + (1 - V) * obstL;
        LupP = blackbody(ts, m.emissivity) + (1 - m.emissivity) * Ldown;
        const Lside = 0.5 * (Ldown + LupP);
        for (let q = 0; q < 4; q++) { const d = dirFace(q); kDirect += d; sides += 0.22 * (0.7 * (d + 0.5 * (w.difH * V + KupP + wallRefl)) + 0.97 * Lside); }
        groundL = LupP;
      } else {
        const ker = kernel(y); let dK = 0, dL = 0, dW = 0; const sK = [0, 0, 0, 0], sL = [0, 0, 0, 0], sW = [0, 0, 0, 0];
        for (let cc = 0; cc < ker.di.length; cc++) {
          const ii = i + ker.di[cc]!, jj = j + ker.dj[cc]!; if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.h) continue;
          const kk = jj * r.w + ii; let kup = Kup[kk]!, lup = Lup[kk]!;
          if (kk === k && sunOverride !== undefined) { kup = albedoOf(m, !!st.wet[k]) * (w.dirH * sunOverride + w.difH * V); lup = blackbody(ts, m.emissivity) + (1 - m.emissivity) * F.Lsky; }
          dK += ker.down[cc]! * kup; dL += ker.down[cc]! * lup; dW += ker.down[cc]!;
          for (let q = 0; q < 4; q++) { const wq = ker.sides[q]![cc]!; if (wq) { sK[q]! += wq * kup; sL[q]! += wq * lup; sW[q]! += wq; } }
        }
        KupP = dK / (dW || 1); LupP = dL / (dW || 1); groundL = LupP;
        const views = sideViews(r, i, j, y);
        let oL = 0, oK = 0, oW = 0, tSum = 0, tW = 0;
        views.forEach((v, q) => {
          let L = obstL, Kr = 0, T = ta + WALL_BASE;
          // a wall: the front of this street that faces back towards the person
          if (v.kind === 'wall') { const f = facadeT(reg, (q + 2) % 4); T = opt.walls && f ? f.T : ta + WALL_BASE; L = blackbody(T, WALL.emissivity); Kr = f ? WALL.albedo * f.K : 0; }
          else if (v.kind === 'crown') { T = ta + 1; L = blackbody(T, 0.97); Kr = 0.15 * 0.5 * (w.dirH + w.difH); }
          else if (v.kind === 'awning') { T = ta + 5; L = blackbody(T, 0.9); Kr = 0; }
          const gK = (sK[q]! / (sW[q]! || 1)) * 0.5, gL = (sL[q]! / (sW[q]! || 1)) * 0.5, d = dirFace(q); kDirect += d;
          const Kq = d + 0.5 * (1 - v.sinH) * w.difH + 0.5 * v.sinH * Kr + gK, Lq = 0.5 * (1 - v.sinH) * F.Lsky + 0.5 * v.sinH * L + gL;
          sides += 0.22 * (0.7 * Kq + 0.97 * Lq);
          oL += v.sinH * L; oK += v.sinH * Kr; oW += v.sinH;
          if (v.kind !== 'open' && v.sinH > 0.05) { tSum += T * v.sinH; tW += v.sinH; }
        });
        besideL = oW ? oL / oW : 0; besideT = tW ? tSum / tW : null;
        Kdown = w.dirH * S + w.difH * V + (1 - V) * (oW ? oK / oW : 0);
        Ldown = V * F.Lsky + (1 - V) * (oW ? oL / oW : obstL);
      }
      const absorbed = 0.06 * (0.7 * Kdown + 0.97 * Ldown) + 0.06 * (0.7 * KupP + 0.97 * LupP) + sides;
      const tmrt = Math.pow(absorbed / (0.97 * 5.67e-8), 0.25) - 273.15;
      const ws = Math.max(0.5, w.u10 * shelter[k]!), Q = 0.97 * 5.67e-8 * ((tmrt + 273.15) ** 4 - (ta + 273.15) ** 4);
      const feels = ta + 0.348 * e - 0.7 * ws + (0.7 * Q) / (ws + 10) - 4.25;
      const rhLocal = Math.min(100, (100 * e) / saturationVapour(ta)), u = utci(ta, tmrt, ws, rhLocal);
      return {
        k, material: m, region: reg, height: y, sunVisible: S, svf: V, surface: ts, airBackground: w.ta, streetAir: st.dStreet[reg]!, nearSurface,
        air: ta, Kdown, Kup: KupP, kDirect, beam: F.In * S, Ldown, Lup: LupP, Lsky: F.Lsky, groundL, besideL, besideT, wet: !!st.wet[k],
        tmrt, wind: windProfile(w.u10, y) * shelter[k]!, ws10: ws, vapour: e, radiationLoad: Q, feels, utci: u, stress: utciStress(u),
        canopyOverhead: r.cTop[k]! > 0, underAwning: (r.aw?.[k] ?? 0) > 0, memoryUsed: st.memoryUsed,
      };
    };
    return { Ts: st.Ts, Sg: st.Sg, dStreet: st.dStreet, wallT: st.wallT, Lsky: F.Lsky, In: F.In, memoryUsed: st.memoryUsed, point, sunVisibility: F.vis };
  }
  return { rasters: r, svf, facades, field };
}
export type HeatModel = ReturnType<typeof heatModel>;

/** is a place in the sun: a march towards it over the heights: 1 in sun, the crown's share through a tree, 0 behind
 *  a building or under an awning */
export function sunTest(r: HeatRasters, sun: Sun, transmission: number): (x: number, z: number, y: number) => number {
  const el = sun.elevation * D2R, az = sun.azimuth * D2R, sx = Math.sin(az), sz = -Math.cos(az), tanEl = Math.tan(Math.max(el, 0.001)), c = r.cell;
  let maxH = 0; for (let k = 0; k < r.bH.length; k++) { if (r.bH[k]! > maxH) maxH = r.bH[k]!; if (r.cTop[k]! > maxH) maxH = r.cTop[k]!; }
  const idx = (x: number, z: number) => { const i = Math.floor(x / c), j = Math.floor(z / c); return i < 0 || j < 0 || i >= r.w || j >= r.h ? -1 : j * r.w + i; };
  return (x, z, y) => {
    if (el <= 0) return 0;
    if (r.aw && y < 3) { const d = (3 - y) / tanEl, k = idx(x + sx * d, z + sz * d); if (k >= 0 && r.aw[k]! > 0) return 0; }
    let t = 1;
    for (let d = c * 0.5; d < 400; d += c * 0.5) {
      const ry = y + d * tanEl; if (ry > maxH) break;
      const k = idx(x + sx * d, z + sz * d); if (k < 0) break;
      if (r.bH[k]! > ry) return 0;
      if (r.cTop[k]! > 0 && ry >= r.cBase[k]! && ry <= r.cTop[k]!) t = Math.min(t, r.cTrans?.[k] || transmission);
    }
    return t;
  };
}
/** the sun on every ground cell (just above it) */
export function groundSun(r: HeatRasters, sun: Sun, transmission: number): Float32Array {
  const out = new Float32Array(r.w * r.h); if (sun.elevation <= 0) return out;
  const vis = sunTest(r, sun, transmission), c = r.cell;
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) { const k = j * r.w + i; if (r.bH[k]! > 0) continue; out[k] = vis((i + 0.5) * c, (j + 0.5) * c, 0.05); }
  return out;
}
/** the share of the sky dome each ground cell sees: horizon angles in 16 directions over buildings and crowns (a
 *  crown lets 30 % through); an awning overhead hides most of it */
export function skyViewFactor(r: HeatRasters): Float32Array {
  const out = new Float32Array(r.w * r.h), c = r.cell, reach = Math.ceil(60 / c), DIRS = 16;
  const dirs = Array.from({ length: DIRS }, (_, d) => [Math.cos((2 * Math.PI * d) / DIRS), Math.sin((2 * Math.PI * d) / DIRS)] as const);
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
    const k = j * r.w + i; if (r.bH[k]! > 0) continue;
    let sum = 0;
    for (const [dx, dz] of dirs) {
      let tb = 0, tc = 0;
      for (let s = 1; s <= reach; s++) {
        const ii = Math.floor(i + 0.5 + dx * s), jj = Math.floor(j + 0.5 + dz * s); if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.h) break;
        const kk = jj * r.w + ii, dist = s * c;
        if (r.bH[kk]! > 0) tb = Math.max(tb, r.bH[kk]! / dist);
        if (r.cTop[kk]! > 0) tc = Math.max(tc, r.cTop[kk]! / dist);
        if (r.aw && r.aw[kk]! > 0) tb = Math.max(tb, r.aw[kk]! / dist);
      }
      if (r.cTop[k]! > 0) tc = Math.max(tc, 50);
      sum += Math.max((tb * tb) / (1 + tb * tb), CANOPY_OPACITY * ((tc * tc) / (1 + tc * tc)));
    }
    out[k] = (1 - sum / DIRS) * (r.aw && r.aw[k]! > 0 ? 0.25 : 1);
  }
  return out;
}
/** each street's fronts by the way they face: the building cells next to the street's own cells */
function buildFacades(r: HeatRasters): Facade[] {
  const map = new Map<string, Facade>(), c = r.cell;
  for (let j = 0; j < r.h; j++) for (let i = 0; i < r.w; i++) {
    const k = j * r.w + i, h = r.bH[k]!; if (h <= 0) continue;
    NORMALS.forEach(([nx, nz], q) => {
      const ii = i + nx, jj = j + nz; if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.h) return;
      const kk = jj * r.w + ii; if (r.bH[kk]! > 0) return;
      const reg = r.region[kk]!; if (!reg) return;
      const key = `${reg}|${q}`; let f = map.get(key);
      if (!f) { f = { region: reg, q, nx, nz, area: 0, h: 0, samples: [], front: [] }; map.set(key, f); }
      f.h = (f.h * f.area + h * c * h) / (f.area + c * h); f.area += c * h;
      if (f.front.length < 400 && (i + j) % 2 === 0) f.front.push(kk);
      if (f.samples.length < 24 * 3 && (i * 7 + j * 13) % 5 === 0) f.samples.push((ii + 0.5) * c - nx * c * 0.4, (jj + 0.5) * c - nz * c * 0.4, h);
    });
  }
  return [...map.values()];
}
const incidence = (f: Facade, sun: Sun) => { if (sun.elevation <= 0) return 0; const el = sun.elevation * D2R, az = sun.azimuth * D2R; return Math.max(0, Math.cos(el) * (Math.sin(az) * f.nx - Math.cos(az) * f.nz)); };
function facadeSunlit(f: Facade, sun: Sun, vis: (x: number, z: number, y: number) => number): number {
  if (incidence(f, sun) <= 0 || !f.samples.length) return 0;
  let s = 0, n = 0;
  for (let i = 0; i < f.samples.length; i += 3) for (const hf of [0.2, 0.5, 0.8]) { s += vis(f.samples[i]! + f.nx * 0.6, f.samples[i + 1]! + f.nz * 0.6, hf * f.samples[i + 2]!); n++; }
  return s / n;
}
/** what a standing person sees of the ground within 10 m: view factors for the downward face y² / (π s⁴) and for each
 *  side (d · n) y / (π s⁴) on its half */
function makeKernel(y: number, c: number): Kernel {
  const R = Math.ceil(10 / c), di: number[] = [], dj: number[] = [], down: number[] = [], sides: number[][] = [[], [], [], []];
  for (let j = -R; j <= R; j++) for (let i = -R; i <= R; i++) {
    const x = i * c, z = j * c, r2 = x * x + z * z; if (r2 > 100) continue;
    const s4 = (r2 + y * y) ** 2; di.push(i); dj.push(j); down.push((y * y) / (Math.PI * s4));
    NORMALS.forEach(([nx, nz], q) => sides[q]!.push((Math.max(0, x * nx + z * nz) * y) / (Math.PI * s4)));
  }
  const norm = (a: number[], total: number) => { const s = a.reduce((p, v) => p + v, 0) || 1; return Float32Array.from(a, (v) => (v * total) / s); };
  return { di: Int16Array.from(di), dj: Int16Array.from(dj), down: norm(down, 1), sides: sides.map((a) => norm(a, 0.5)) };
}
/** how high obstacles rise towards each side of a person (three rays a side), and what they are */
function sideViews(r: HeatRasters, i: number, j: number, y: number): { sinH: number; kind: 'open' | 'wall' | 'crown' | 'awning' }[] {
  const reach = Math.ceil(40 / r.cell), c = r.cell;
  return NORMALS.map(([nx, nz]) => {
    let sinSum = 0, best: { sinH: number; kind: 'open' | 'wall' | 'crown' | 'awning' } = { sinH: 0, kind: 'open' };
    for (const off of [-0.52, 0, 0.52]) {
      const co = Math.cos(off), so = Math.sin(off), dx = nx * co - nz * so, dz = nz * co + nx * so;
      let tb = 0, tc = 0, ta = 0;
      for (let s = 1; s <= reach; s++) {
        const ii = Math.floor(i + 0.5 + dx * s), jj = Math.floor(j + 0.5 + dz * s); if (ii < 0 || jj < 0 || ii >= r.w || jj >= r.h) break;
        const k = jj * r.w + ii, dist = s * c;
        if (r.bH[k]! > y) tb = Math.max(tb, (r.bH[k]! - y) / dist);
        if (r.cTop[k]! > y) tc = Math.max(tc, (r.cTop[k]! - y) / dist);
        if (r.aw && r.aw[k]! > y) ta = Math.max(ta, (r.aw[k]! - y) / dist);
      }
      const sin = (t: number) => t / Math.sqrt(1 + t * t), sb = sin(tb), sc = CANOPY_OPACITY * sin(tc), sa = sin(ta), m = Math.max(sb, sc, sa);
      sinSum += m;
      if (m > best.sinH) best = { sinH: m, kind: m === sb ? 'wall' : m === sc ? 'crown' : 'awning' };
    }
    return { ...best, sinH: sinSum / 3 };
  });
}
export { MATERIALS, WALL };
