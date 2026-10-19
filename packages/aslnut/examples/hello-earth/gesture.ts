// The gesture test: fast pinch-zoom in, out, a fast pan with a turn, then in again while panning (12 s, looped), over
// Bandung's terrain. The same function drives aslnut (w.go) and the reference maps (jumpTo), so frame times compare
// like for like. ?go=gesture runs it on the dashboard; &gesture=1 runs it on any preset. Plain JS inside (the perf
// tool sends it to the reference page as text).
export function gestureView(t: number): { lon: number; lat: number; zoom: number; tilt: number; bearing: number } {
  const T = 12, u = ((t % T) + T) % T, s = (a: number, b: number, x: number) => { const k = Math.min(1, Math.max(0, (x - a) / (b - a))); return k * k * (3 - 2 * k); };
  const lon0 = 107.61, lat0 = -6.9;
  let zoom: number, lon = lon0, lat = lat0, bearing = 0;
  if (u < 3) zoom = 8 + 6 * s(0, 3, u);
  else if (u < 6) zoom = 14 - 7 * s(3, 6, u);
  else if (u < 9) { zoom = 11; const k = s(6, 9, u); lon = lon0 + 0.6 * k; lat = lat0 + 0.25 * k; bearing = (360 - 40 * k) % 360; }
  else { const k = s(9, 12, u); zoom = 7 + 6 * k; lon = lon0 + 0.6 * (1 - k); lat = lat0 + 0.25 * (1 - k); bearing = (360 - 40 * (1 - k)) % 360; }
  return { lon, lat, zoom, tilt: 45, bearing };
}
/** frame-time statistics of a list of frame intervals (ms) */
export function frameStats(dts: number[]): { n: number; p50: number; p95: number; max: number; over33: number; over100: number } {
  const a = [...dts].sort((x, y) => x - y), q = (p: number) => a.length ? a[Math.min(a.length - 1, Math.floor(p * a.length))]! : 0;
  return { n: a.length, p50: +q(0.5).toFixed(1), p95: +q(0.95).toFixed(1), max: +(a.at(-1) ?? 0).toFixed(1), over33: a.filter((x) => x > 33.4).length, over100: a.filter((x) => x > 100).length };
}
