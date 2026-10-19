// Camera paths, in aslnut's view terms (lon, lat, zoom, tilt, bearing): every run follows the same function of time
// (w.go(view)).
export interface PathView { lon: number; lat: number; zoom: number; tilt: number; bearing: number }
export type Path = (t: number) => PathView;

const s = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
const BDG: [number, number] = [107.61, -6.9], JKT: [number, number] = [106.85, -6.21];

/** globe → Bandung: zoom 2 → 13 over the time, the tilt rising as it lands */
export const zoomIn = (dur: number): Path => (t) => { const k = s(0, dur, t); return { lon: 110 + (BDG[0] - 110) * k, lat: -4 + (BDG[1] + 4) * k, zoom: 2 + 11 * k, tilt: 50 * s(0.5 * dur, dur, t), bearing: 0 }; };
/** a fast pinch at a city: 8 → 14 → 7 → 13 in quick strokes (3 s each), over Bandung */
export const fastZoom: Path = (t) => { const u = t % 12; const zoom = u < 3 ? 8 + 6 * s(0, 3, u) : u < 6 ? 14 - 7 * s(3, 6, u) : u < 9 ? 7 + 6 * s(6, 9, u) : 13 - 5 * s(9, 12, u); return { lon: BDG[0], lat: BDG[1], zoom, tilt: 45, bearing: 0 }; };
/** a pan at zoom 12 with terrain: east 0.35° and back with a 30° turn */
export const pan: Path = (t) => { const k = Math.sin((Math.PI * t) / 8); return { lon: BDG[0] - 0.1 + 0.35 * k * k, lat: BDG[1] + 0.08 * k, zoom: 12, tilt: 55, bearing: (360 - 30 * k) % 360 }; };
/** a fly Bandung → Jakarta and back (an arc: out to 8.5 in the middle, tilt up to 60) */
export const fly = (dur: number): Path => (t) => {
  const half = dur / 2, back = t > half, k = s(0, half, back ? t - half : t), a = back ? JKT : BDG, b = back ? BDG : JKT;
  return { lon: a[0] + (b[0] - a[0]) * k, lat: a[1] + (b[1] - a[1]) * k, zoom: 13 - 4.5 * Math.sin(Math.PI * k), tilt: 45 + 15 * Math.sin(Math.PI * k), bearing: 0 };
};
/** Java whole (still), then a zoom into West Java and Bandung's regencies */
export const java = (still: number, dur: number): Path => (t) => {
  const k = s(still, dur, t);
  return { lon: 110.2 + (107.6 - 110.2) * k, lat: -7.25 + (-6.95 + 7.25) * k, zoom: 6.6 + 3.4 * k, tilt: 25 + 20 * k, bearing: 0 };
};
/** a slow zoom over Java's provinces and their names */
export const javaSlow: Path = (t) => ({ lon: 109.5 - 0.15 * t, lat: -7.2, zoom: 6.4 + 0.2 * t, tilt: 20, bearing: 0 });
/** a slow orbit over blocks in Bandung's centre */
export const orbit: Path = (t) => ({ lon: 107.61, lat: -6.915, zoom: 14.2, tilt: 60, bearing: ((340 - 9 * t) % 360 + 360) % 360 });
/** a slow drift over Java (points) */
export const drift: Path = (t) => ({ lon: 108.5 + 0.25 * t, lat: -7.1, zoom: 7.3 + 0.15 * t, tilt: 30, bearing: 0 });
/** still, at a place */
export const still = (v: PathView): Path => () => v;
