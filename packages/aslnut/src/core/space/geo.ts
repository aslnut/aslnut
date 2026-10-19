// core › space › geo: Web Mercator tiles (z / x / y, as every web map) and where a place sits in the world. The world
// is local to the view's centre: x east, y up, z south, in metres, the centre at the origin. A place has two
// positions, on the globe and on the flat map (Mercator scaled to true metres at the centre); the map morphs from one
// to the other as you come closer (`morph`: 0 globe … 1 flat). Both use differences from the centre only, so float32
// on the graphics chip keeps centimetres at street level.

export const R = 6378137;   // the Web Mercator sphere (m)
export const D = Math.PI / 180;
export const MAX_LAT = 85.05112878;

export type LonLat = [number, number];
export type LonLatH = [number, number, number?];
/** a box in degrees: west, south, east, north */
export type BBox = [number, number, number, number];

/** Mercator y of a latitude (degrees in; ln tan(π/4 + φ/2) out) */
export const mercY = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * D) / 2));
export const latOfMercY = (m: number) => (2 * Math.atan(Math.exp(m)) - Math.PI / 2) / D;
export const wrap = (d: number) => ((((d + 180) % 360) + 360) % 360) - 180;

/** a tile's bounds: west / east in degrees, north / south as Mercator y */
export function tileBounds(z: number, x: number, y: number): { w: number; e: number; n: number; s: number } {
  const k = 2 ** z;
  return { w: (x / k) * 360 - 180, e: ((x + 1) / k) * 360 - 180, n: Math.PI * (1 - (2 * y) / k), s: Math.PI * (1 - (2 * (y + 1)) / k) };
}
/** a tile's box in degrees */
export function tileBBox(z: number, x: number, y: number): BBox {
  const b = tileBounds(z, x, y);
  return [b.w, latOfMercY(b.s), b.e, latOfMercY(b.n)];
}
export const tileOf = (lon: number, lat: number, z: number): [number, number] => {
  const k = 2 ** z, m = mercY(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)));
  return [Math.min(k - 1, Math.max(0, Math.floor(((lon + 180) / 360) * k))), Math.min(k - 1, Math.max(0, Math.floor(((Math.PI - m) / (2 * Math.PI)) * k)))];
};
/** the lon / lat of a point of a tile, (u, v) in 0..1 from its north-west corner */
export function tilePoint(z: number, x: number, y: number, u: number, v: number): LonLat {
  const b = tileBounds(z, x, y);
  return [b.w + (b.e - b.w) * u, latOfMercY(b.n + (b.s - b.n) * v)];
}
export const intersects = (a: BBox, b: BBox) => a[0] < b[2] && a[2] > b[0] && a[1] < b[3] && a[3] > b[1];
/** metres from a point inside a box to its nearest edge (negative outside) */
export function insideBy(lon: number, lat: number, b: BBox): number {
  const kx = 111320 * Math.cos(lat * D), ky = 110574;
  return Math.min((lon - b[0]) * kx, (b[2] - lon) * kx, (lat - b[1]) * ky, (b[3] - lat) * ky);
}

/** the view's centre and how flat it is: what every position is relative to */
export interface Frame { lon: number; lat: number; morph: number }

/** a place in the world (metres, centre-relative): the globe and the flat positions blended by `morph` */
export function worldOf(f: Frame, lon: number, lat: number, h = 0): [number, number, number] {
  const g = globeOf(f, lon, lat, h), p = flatOf(f, lon, lat, h), t = f.morph;
  return [g[0] + (p[0] - g[0]) * t, g[1] + (p[1] - g[1]) * t, g[2] + (p[2] - g[2]) * t];
}
export function globeOf(f: Frame, lon: number, lat: number, h = 0): [number, number, number] {
  const p0 = f.lat * D, p = lat * D, dl = wrap(lon - f.lon) * D, dp = p - p0, r = R + h;
  const s2 = (a: number) => { const s = Math.sin(a / 2); return 2 * s * s; };   // 1 − cos a, without cancellation
  const k = s2(dp) + Math.cos(p0) * Math.cos(p) * s2(dl);
  return [r * Math.cos(p) * Math.sin(dl), h - r * k, -r * (Math.sin(dp) + Math.sin(p0) * Math.cos(p) * s2(dl))];
}
export function flatOf(f: Frame, lon: number, lat: number, h = 0): [number, number, number] {
  const c = R * Math.cos(f.lat * D);
  return [c * wrap(lon - f.lon) * D, h, -c * (mercY(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat))) - mercY(f.lat))];
}
/** as the surface shader places a tile's points: longitudes not wrapped (a tile's west edge is wrapped once) */
export function worldAtUnwrapped(f: Frame, lon: number, lat: number, h = 0): [number, number, number] {
  const g = globeOf(f, lon, lat, h), p = flatOf(f, f.lon, lat, h), t = f.morph;
  p[0] = R * Math.cos(f.lat * D) * (lon - f.lon) * D;
  return [g[0] + (p[0] - g[0]) * t, g[1] + (p[1] - g[1]) * t, g[2] + (p[2] - g[2]) * t];
}

/** back from a world point on the ground (globe or flat, whichever the map is closer to) to lon / lat */
export function lonLatOf(f: Frame, x: number, y: number, z: number): LonLat {
  if (f.morph > 0.5) {
    const c = R * Math.cos(f.lat * D);
    return [wrap(f.lon + x / c / D), latOfMercY(mercY(f.lat) - z / c)];
  }
  const p0 = f.lat * D, l0 = f.lon * D;
  const e = [-Math.sin(l0), Math.cos(l0), 0], n = [-Math.sin(p0) * Math.cos(l0), -Math.sin(p0) * Math.sin(l0), Math.cos(p0)], u = [Math.cos(p0) * Math.cos(l0), Math.cos(p0) * Math.sin(l0), Math.sin(p0)];
  const q = [0, 1, 2].map((i) => x * e[i]! + (y + R) * u[i]! - z * n[i]!);
  return [Math.atan2(q[1]!, q[0]!) / D, Math.atan2(q[2]!, Math.hypot(q[0]!, q[1]!)) / D];
}
/** where the globe's centre is, in the world (the flat map has none) */
export const globeCentre = (): [number, number, number] => [0, -R, 0];
/** great-circle metres between two places */
export function metresBetween(a: LonLat, b: LonLat): number {
  const p1 = a[1] * D, p2 = b[1] * D, dp = p2 - p1, dl = wrap(b[0] - a[0]) * D;
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}
