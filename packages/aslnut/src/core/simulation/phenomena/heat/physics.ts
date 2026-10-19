// core › simulation › phenomena › heat › physics: the constants and small formulas of urban heat: radiation, vapour, wind near the
// ground, convection; the surface energy balance, steady or stored through the day (force–restore); materials as a
// citable table (core › simulation › constants).
export const SIGMA = 5.67e-8, K0 = 273.15, D2R = Math.PI / 180;
/** air, J/m³K */
export const RHO_CP = 1200;
/** latent heat of vaporisation, J/kg (1 kg/m² = 1 mm) */
export const LAMBDA = 2.45e6;
/** a suburb's roughness length (m) */
export const Z0 = 0.5;
export const OMEGA = (2 * Math.PI) / 86400;

/** water vapour pressure at saturation (hPa, Magnus) and at a relative humidity */
export const saturationVapour = (ta: number) => 6.105 * Math.exp((17.27 * ta) / (237.7 + ta));
export const vapourPressure = (ta: number, rh: number) => (rh / 100) * saturationVapour(ta);
/** the sky's heat radiation (W/m²): clear-sky emissivity (Brutsaert), raised by cloud */
export function skyLongwave(ta: number, rh: number, cloud: number): number {
  const e = vapourPressure(ta, rh), T = ta + K0;
  return Math.min(1, 1.24 * Math.pow(e / T, 1 / 7) * (1 + 0.22 * cloud * cloud)) * SIGMA * T ** 4;
}
export const blackbody = (tC: number, eps = 1) => eps * SIGMA * (tC + K0) ** 4;
/** the wind at height y from the 10 m wind (log profile) */
export const windProfile = (u10: number, y: number) => u10 * (Math.log(Math.max(y, Z0 * 1.2) / Z0) / Math.log(10 / Z0));
/** convection coefficient (W/m²K), a + b · wind */
export const convection = (u2: number) => 6 + 4 * u2;

/** a surface material: how much sun it reflects, how well it radiates, how much of its energy goes into evaporation
 *  and (in the quick balance) into the ground; heat capacity, conductivity, water it holds after rain; its colour */
export interface Material { id: string; label: string; albedo: number; emissivity: number; evap: number; storage: number; rhoC: number; k: number; waterCap: number; color: string; source?: string }
const TYP = 'typical published values (Oke et al. 2017, Urban Climates; TEB / SUEWS tables), rounded';
/** the materials of a street (core › simulation › constants): each value with where it comes from */
export const MATERIALS: Record<string, Material> = {
  asphalt: { id: 'asphalt', label: 'Asphalt road', albedo: 0.08, emissivity: 0.95, evap: 0, storage: 0.35, rhoC: 1.94e6, k: 0.75, waterCap: 1, color: '#2f3236', source: TYP },
  coolpave: { id: 'coolpave', label: 'Light (cool) pavement', albedo: 0.33, emissivity: 0.92, evap: 0, storage: 0.3, rhoC: 1.94e6, k: 0.75, waterCap: 1, color: '#9a9a96', source: TYP },
  concrete: { id: 'concrete', label: 'Concrete footpath', albedo: 0.3, emissivity: 0.92, evap: 0, storage: 0.3, rhoC: 2.0e6, k: 1.5, waterCap: 1, color: '#c9c5bb', source: TYP },
  grass: { id: 'grass', label: 'Watered grass', albedo: 0.23, emissivity: 0.97, evap: 0.8, storage: 0.1, rhoC: 2.5e6, k: 1.2, waterCap: 10, color: '#5f9a45', source: TYP },
  drygrass: { id: 'drygrass', label: 'Dry grass / soil', albedo: 0.2, emissivity: 0.95, evap: 0.1, storage: 0.2, rhoC: 1.3e6, k: 0.3, waterCap: 10, color: '#b8a774', source: TYP },
  roof: { id: 'roof', label: 'Building', albedo: 0.15, emissivity: 0.9, evap: 0, storage: 0.3, rhoC: 1.4e6, k: 0.7, waterCap: 1, color: '#7a4a35', source: TYP },
  water: { id: 'water', label: 'Water', albedo: 0.06, emissivity: 0.98, evap: 0.9, storage: 0.6, rhoC: 4.18e6, k: 0.6, waterCap: 1000, color: '#3f7fae', source: TYP },
};
/** brick walls */
export const WALL: Material = { id: 'brick', label: 'Brick wall', albedo: 0.3, emissivity: 0.9, evap: 0, storage: 0.3, rhoC: 1.4e6, k: 0.7, waterCap: 0, color: '#b0674a', source: TYP };
const WET_ALBEDO = 0.8, WET_EVAP = 0.7;
export const albedoOf = (m: Material, wet: boolean) => (wet ? m.albedo * WET_ALBEDO : m.albedo);
export const evapShare = (m: Material, wet: boolean) => (wet ? Math.max(m.evap, WET_EVAP) : m.evap);
/** the balance at this hour alone (no memory): (1−α)K↓ + εL↓ − εσTs⁴ − h(Ts − Ta) − λE − G = 0 (Newton) */
export function solveSteady(m: Material, K: number, Lin: number, hc: number, ta: number, wet = false): number {
  const a = albedoOf(m, wet), ev = evapShare(m, wet), Ta = ta + K0; let T = Ta;
  for (let it = 0; it < 12; it++) {
    const avail = (1 - a) * K + m.emissivity * Lin - m.emissivity * SIGMA * T ** 4, keep = avail > 0 ? (1 - m.storage) * (1 - ev) : 1;
    T -= (avail * keep - hc * (T - Ta)) / (-keep * 4 * m.emissivity * SIGMA * T ** 3 - hc);
  }
  return T - K0;
}
/** heat capacity per m² of the layer that follows the daily cycle: ρc · d / 2, d = √(2κ / ω) */
export const surfaceCapacity = (m: Material) => (m.rhoC * Math.sqrt((2 * m.k) / (m.rhoC * OMEGA))) / 2;
/** one step of `dt` seconds of force–restore (Deardorff 1978): the surface stores heat and relaxes to its deep
 *  temperature; its new temperature and the evaporation (W/m²) */
export function stepSurface(T: number, m: Material, C: number, K: number, Lin: number, hc: number, ta: number, deep: number, wet: boolean, dt: number): { T: number; LE: number } {
  const a = albedoOf(m, wet), ev = evapShare(m, wet), Tk = T + K0;
  const Rn = (1 - a) * K + m.emissivity * Lin - m.emissivity * SIGMA * Tk ** 4, LE = ev * Math.max(0, Rn);
  return { T: T + dt * ((Rn - hc * (T - ta) - LE) / C - OMEGA * (T - deep)), LE };
}
