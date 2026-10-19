// modules › world › earth › air › sky › ephemeris: where the sun and the moon are in a place's sky at an instant, and the
// moon's phase. Low-precision almanac formulas (the sun to a fraction of a degree, the moon to about a degree): what
// lighting, shadows and a sky need. Pure functions, no rendering.
//   sunAt(new Date(), -37.81, 144.96)   → { altitude: 41.2, azimuth: 352.8 }   (degrees; azimuth clockwise from north)
const RAD = Math.PI / 180;

export interface SkyPosition { /** degrees above the horizon */ altitude: number; /** degrees clockwise from north */ azimuth: number }
export interface MoonPosition extends SkyPosition { /** the lit fraction of its disc, 0..1 */ illumination: number; /** degrees from the sun along the ecliptic: 0 new, 90 first quarter, 180 full, 270 last quarter */ elongation: number; /** 0 new … 0.5 full … 1 */ phase: number }

/** the sun's place in the sky */
export function sunAt(t: Date | number, lat: number, lon: number): SkyPosition {
  const n = (typeof t === 'number' ? t : t.getTime()) / 86400000 + 2440587.5 - 2451545.0;
  const meanLon = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * RAD;
  const ecl = (meanLon + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * RAD;
  const obl = (23.439 - 0.0000004 * n) * RAD;
  const ra = Math.atan2(Math.cos(obl) * Math.sin(ecl), Math.cos(ecl)), dec = Math.asin(Math.sin(obl) * Math.sin(ecl));
  const gmst = (18.697374558 + 24.06570982441908 * n) % 24;
  const ha = (gmst * 15 + lon) * RAD - ra, phi = lat * RAD;
  const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(ha));
  const azS = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
  return { altitude: alt / RAD, azimuth: (azS / RAD + 180 + 360) % 360 };
}

/** the moon's place in the sky (parallax included) and its phase */
export function moonAt(t: Date | number, lat: number, lon: number): MoonPosition {
  const ms = typeof t === 'number' ? t : t.getTime(), d = ms / 86400000 - 10957.5;
  const L = 218.316 + 13.176396 * d, M = (134.963 + 13.064993 * d) * RAD, F = (93.272 + 13.22935 * d) * RAD;
  const Dm = (297.85 + 12.190749 * d) * RAD, Ms = (357.529 + 0.98560028 * d) * RAD;
  const elon = (L + 6.289 * Math.sin(M) - 1.274 * Math.sin(M - 2 * Dm) + 0.658 * Math.sin(2 * Dm) - 0.186 * Math.sin(Ms) - 0.059 * Math.sin(2 * M - 2 * Dm) - 0.057 * Math.sin(M - 2 * Dm + Ms) + 0.053 * Math.sin(M + 2 * Dm)) * RAD;
  const elat = (5.128 * Math.sin(F) + 0.281 * Math.sin(M + F) - 0.278 * Math.sin(F - M) - 0.173 * Math.sin(F - 2 * Dm)) * RAD;
  const eps = (23.439 - 0.0000004 * d) * RAD;
  const ra = Math.atan2(Math.sin(elon) * Math.cos(eps) - Math.tan(elat) * Math.sin(eps), Math.cos(elon));
  const dec = Math.asin(Math.sin(elat) * Math.cos(eps) + Math.cos(elat) * Math.sin(eps) * Math.sin(elon));
  const lst = ((280.46061837 + 360.98564736629 * d + lon) % 360) * RAD, ha = lst - ra, la = lat * RAD;
  let el = Math.asin(Math.sin(la) * Math.sin(dec) + Math.cos(la) * Math.cos(dec) * Math.cos(ha));
  el -= 0.0166 * Math.cos(el);
  const az = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(la) - Math.tan(dec) * Math.cos(la)) + Math.PI;
  const g = (357.528 + 0.9856003 * d) * RAD;
  const sunLon = (280.46 + 0.9856474 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) % 360;
  const elong = (((elon / RAD - sunLon) % 360) + 360) % 360;
  const illum = (1 - Math.cos(Math.acos(Math.cos(elat) * Math.cos(elong * RAD)))) / 2;
  return { altitude: el / RAD, azimuth: ((az / RAD) + 360) % 360, illumination: illum, elongation: elong, phase: elong / 360 };
}

/** a direction in the sky → the world's axes (x east, y up, z south), unit */
export function skyDir(p: SkyPosition): [number, number, number] {
  const el = p.altitude * RAD, az = p.azimuth * RAD;
  return [Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el)];
}

/** the day's sunrise, sunset and solar noon as hours after `dayStart` (an instant: local midnight), and the sun's
 *  highest altitude (a 5-minute search; null: no rise or set that day) */
export function sunTimes(dayStart: number, lat: number, lon: number): { rise: number | null; set: number | null; noon: number; highest: number } {
  let rise: number | null = null, set: number | null = null, noon = 12, hi = -90, prev = sunAt(dayStart, lat, lon).altitude;
  for (let m = 5; m <= 1440; m += 5) {
    const a = sunAt(dayStart + m * 60000, lat, lon).altitude;
    if (prev < -0.83 && a >= -0.83) rise = m / 60;
    if (prev >= -0.83 && a < -0.83) set = m / 60;
    if (a > hi) { hi = a; noon = m / 60; }
    prev = a;
  }
  return { rise, set, noon, highest: hi };
}
const PHASES = ['New moon', 'Waxing crescent', 'First quarter', 'Waxing gibbous', 'Full moon', 'Waning gibbous', 'Last quarter', 'Waning crescent'];
/** the moon's phase in words */
export function phaseName(elongation: number): string {
  const e = ((elongation % 360) + 360) % 360;
  if (e < 8 || e > 352) return PHASES[0]!;
  if (e < 82) return PHASES[1]!; if (e < 98) return PHASES[2]!; if (e < 172) return PHASES[3]!; if (e < 188) return PHASES[4]!;
  if (e < 262) return PHASES[5]!; if (e < 278) return PHASES[6]!; return PHASES[7]!;
}
