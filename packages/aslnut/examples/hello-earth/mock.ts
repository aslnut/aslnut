// Mock data for the examples and the checks: seeded (the same every run), no network.
import type { Feature } from '../../src/index.ts';

export function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }

/** a grid of jittered cells over a box: polygons with ids and a value (mock districts) */
export function cells(box: [number, number, number, number], nx: number, ny: number, seed = 3): Feature[] {
  const r = rng(seed), [w, s, e, n] = box, dx = (e - w) / nx, dy = (n - s) / ny;
  // shared jittered corners so neighbours meet exactly
  const P: [number, number][][] = [];
  for (let j = 0; j <= ny; j++) { P.push([]); for (let i = 0; i <= nx; i++) { const edge = i === 0 || j === 0 || i === nx || j === ny; P[j]!.push([w + i * dx + (edge ? 0 : (r() - 0.5) * dx * 0.5), s + j * dy + (edge ? 0 : (r() - 0.5) * dy * 0.5)]); } }
  const out: Feature[] = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ring = [P[j]![i]!, P[j]![i + 1]!, P[j + 1]![i + 1]!, P[j + 1]![i]!, P[j]![i]!];
    out.push({ id: `c${j}-${i}`, props: { name: `District ${String.fromCharCode(65 + j)}${i + 1}`, group: `G${Math.floor(i / 2)}${Math.floor(j / 2)}`, value: Math.round(10 + 90 * r() ** 1.5), kind: ['housing', 'industry', 'park', 'farm'][Math.floor(r() * 4)] }, geometry: { type: 'Polygon', coordinates: [ring] } });
  }
  return out;
}
/** wavy lines across a box (mock power lines / routes) */
export function wavy(box: [number, number, number, number], n: number, seed = 5): Feature[] {
  const r = rng(seed), [w, s, e, nn] = box, out: Feature[] = [];
  for (let k = 0; k < n; k++) {
    const y0 = s + (nn - s) * (k + 0.5) / n, amp = (nn - s) / n * 0.4, ph = r() * 6, pts: [number, number][] = [];
    for (let i = 0; i <= 40; i++) { const t = i / 40; pts.push([w + (e - w) * t, y0 + Math.sin(t * 9 + ph) * amp]); }
    out.push({ id: `l${k}`, props: { name: `Line ${k + 1}`, kv: [70, 150, 500][k % 3], operator: ['North', 'South'][k % 2] }, geometry: { type: 'LineString', coordinates: pts } });
  }
  return out;
}
/** small square footprints round a place (mock buildings) */
export function blocks(lon: number, lat: number, n: number, spread: number, size: number, seed = 9): Feature[] {
  const r = rng(seed), out: Feature[] = [];
  for (let k = 0; k < n; k++) {
    const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread, x = lon + Math.cos(a) * d, y = lat + Math.sin(a) * d * 0.9, h = size * (0.5 + r()), q = h * 0.5;
    out.push({ id: `b${k}`, props: { levels: 2 + Math.floor(r() * 30) }, geometry: { type: 'Polygon', coordinates: [[[x - q, y - q], [x + q, y - q], [x + q, y + q], [x - q, y + q], [x - q, y - q]]] } });
  }
  return out;
}
