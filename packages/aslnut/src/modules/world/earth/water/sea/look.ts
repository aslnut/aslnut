// modules › world › earth › water › sea › look: what the sea looks like. Its water by its depth (shallow to deep over
// its clarity), the sky in it and the sun's glitter, a fade into the haze at the horizon; and its waves: a sum of
// directional waves the wind raises (Pierson and Moskowitz's sea for its speed: the longest a few tens of metres in a
// breeze, shorter ones round them, spread round the way it blows; a swell from far away when you give one), each a
// direction, a length and a height, run on the chip. With room (the governor's realistic quality) the sea's own
// surface near the eye is lifted by them (Gerstner waves: the crests sharpen); on a phone the ground's sea takes their
// slopes only: the same sea, flat. Far away the waves too small to see are left out and their roughness widens the
// glitter instead (it never flickers). Pay only for what you set: no look, the plain sea.
//   water({ sea: { look: { wind: { speed: 8, from: 225 }, swell: { height: 1.2, period: 12, from: 220 } } } })
import type { Fn } from '../../../../../core/observation/presence.ts';

export interface SeaLook {
  /** the water where it is shallow and where it is deep (default a clear turquoise, a deep blue) */
  shallow?: string; deep?: string;
  /** the depth it turns from shallow to deep over, m (default 9) */
  clarity?: number;
  /** the wind that raises the waves: its speed m/s (default the sky's weather, else 6) and where it blows from,
   *  degrees clockwise from north (default 225): a number, or your function of the state */
  wind?: { speed?: Fn<number>; from?: Fn<number> };
  /** a swell from far away: its height m, its period s and where it comes from (degrees); none by default */
  swell?: { height?: number; period?: number; from?: number } | false;
  /** the sun's glitter on it (0 none … 2; default 1) */
  glitter?: number;
  /** how many waves (default 16; a phone's flat sea draws the 8 longest) */
  waves?: number;
  /** 'auto' (the default): the governor's quality decides (realistic: the displaced surface near the eye; lite: the
   *  flat sea, its waves in its light only); or always one */
  tier?: 'auto' | 'flat' | 'displaced';
  /** how far the displaced surface reaches round the eye, × its height (default 300; 300 m at the least, 25 km at
   *  the most) */
  reach?: number;
  /** the waves' clock, s (default the world's own: they move at their own pace whatever the world's time does); your
   *  function of the state (a recording's own time, so its frames are the same however long the loading took) */
  clock?: (s: import('../../../../../core/world/state.ts').State) => number;
}
/** the look's values with their defaults */
export const LOOK = { shallow: '#2fb3ad', deep: '#0b3a57', clarity: 9, speed: 6, from: 225, glitter: 1, waves: 16, reach: 300 } as const;
/** a wave: its direction (x east, z south: where it goes), wavenumber (rad/m), amplitude (m), angular frequency
 *  (rad/s) and steepness (Gerstner's Q, 0..1) */
export interface Wave { dir: [number, number]; k: number; a: number; omega: number; q: number }
const G = 9.81, D = Math.PI / 180;
/** a seeded number 0..1 (the same waves every time) */
const rnd = (i: number, s: number) => { let h = Math.imul(i + 1, 2654435761) ^ Math.imul(s + 7, 1597334677); h = Math.imul(h ^ (h >>> 15), 2246822519); h ^= h >>> 13; return (h >>> 0) / 4294967296; };
/** the waves a wind raises (and a swell, first when given): `count` in all, the longest first; their heights from
 *  Pierson and Moskowitz's spectrum for a fully developed sea (significant height 0.21 U² / g), spread round the way
 *  the wind blows (the short ones wider), each gentle enough that the sum never folds over */
export function waveSet(o: { speed: number; from: number; swell?: { height?: number; period?: number; from?: number } | false; count?: number; seed?: number }): Wave[] {
  const n = Math.max(1, Math.min(16, o.count ?? 16)), U = Math.max(0.5, o.speed), wp = (0.877 * G) / U, out: Wave[] = [];
  const to = (from: number): [number, number] => { const b = (from + 180) * D; return [Math.sin(b), -Math.cos(b)]; };
  const sw = o.swell || null;
  if (sw && (sw.height ?? 1) > 0) {
    const T = sw.period ?? 11, w = (2 * Math.PI) / T, k = (w * w) / G, a = (sw.height ?? 1) / 2;
    out.push({ dir: to(sw.from ?? o.from), k, a, omega: w, q: 0 });
  }
  const m = n - out.length, r = m > 1 ? 10 ** (1 / (m - 1)) : 1, seed = o.seed ?? 1;
  for (let i = 0; i < m; i++) {
    const w = 0.72 * wp * r ** i, dw = w * (r - 1 || 0.5), S = (0.0081 * G * G) / w ** 5 * Math.exp(-1.25 * (wp / w) ** 4), a = Math.sqrt(2 * S * dw);
    const spread = (22 + 40 * (i / Math.max(1, m - 1))) * D, th = (o.from + 180) * D + (rnd(i, seed) - 0.5) * 2 * spread;
    out.push({ dir: [Math.sin(th), -Math.cos(th)], k: (w * w) / G, a: Math.min(a, 0.14 / ((w * w) / G)), omega: w, q: 0 });
  }
  // (Gerstner's steepness: together they never fold over, Σ q k a ≤ 0.6)
  for (const wv of out) wv.q = Math.min(1, 0.6 / (out.length * wv.k * wv.a + 1e-9));
  return out;
}
/** the colour '#rrggbb' as linear 0..1 rgb (as the frame's light is) */
export const rgbOf = (c: string): [number, number, number] => { const h = c.replace('#', ''), v = (k: number) => parseInt(h.slice(k, k + 2), 16) / 255; return [v(0), v(2), v(4)]; };
