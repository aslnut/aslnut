// The example's town, made in code (nothing fetched): a grid of blocks on a flat floor, each with a kind, a number of
// levels and a rate (a value to colour by), the streets between them, and a fleet of vans driving rounds of the blocks
// for ten minutes (a log: each van's samples, its charge a value carried with them).
import { history, planeAt, planeXY, type Feature } from 'aslnut';

/** blocks across and down, a block's side and a street's width (m) */
const N = 6, BLOCK = 80, STREET = 24, STEP = BLOCK + STREET, HALF = (N * STEP - STREET) / 2;
export const KINDS = ['homes', 'shops', 'offices', 'park', 'school'] as const;
export type Kind = (typeof KINDS)[number];

/** a small seeded random (the same town every time) */
function seeded(seed: number): () => number {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const ring = (x0: number, y0: number, x1: number, y1: number) => [planeAt(x0, y0), planeAt(x1, y0), planeAt(x1, y1), planeAt(x0, y1), planeAt(x0, y0)];

/** the blocks: polygons with their name, kind, levels and rate */
export const BLOCKS: Feature[] = (() => {
  const rnd = seeded(7), out: Feature[] = [];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const x0 = -HALF + i * STEP, y0 = -HALF + j * STEP, r = rnd();
    const kind: Kind = r < 0.42 ? 'homes' : r < 0.62 ? 'shops' : r < 0.8 ? 'offices' : r < 0.92 ? 'park' : 'school';
    const levels = kind === 'park' ? 0 : kind === 'offices' ? 4 + Math.floor(rnd() * 9) : kind === 'shops' ? 1 + Math.floor(rnd() * 3) : 1 + Math.floor(rnd() * 4);
    out.push({ id: `b${j}${i}`, props: { name: `Block ${String.fromCharCode(65 + j)}${i + 1}`, kind, levels, rate: Math.round((0.15 + 0.8 * rnd()) * 100) / 100 }, geometry: { type: 'Polygon', coordinates: [ring(x0, y0, x0 + BLOCK, y0 + BLOCK)] } });
  }
  return out;
})();

/** the streets: a line down the middle of each */
export const STREETS: Feature[] = (() => {
  const out: Feature[] = [], end = HALF + STREET;
  for (let k = 0; k <= N; k++) {
    const c = -HALF - STREET / 2 + k * STEP;
    out.push({ id: `ns${k}`, props: {}, geometry: { type: 'LineString', coordinates: [planeAt(c, -end), planeAt(c, end)] } });
    out.push({ id: `ew${k}`, props: {}, geometry: { type: 'LineString', coordinates: [planeAt(-end, c), planeAt(end, c)] } });
  }
  return out;
})();

/** the fleet's log: each van drives round a rectangle of blocks along the streets, its charge going down */
export function fleetLog(vans = 24, minutes = 10) {
  const log = history.log({ values: { charge: { type: 'u8', domain: [0, 1] } }, travel: true });
  const rnd = seeded(11), t0 = Date.UTC(2026, 5, 21, 9, 0, 0), rows: { id: string; t: number; lon: number; lat: number; values: { charge: number } }[] = [];
  const street = (k: number) => -HALF - STREET / 2 + k * STEP;
  for (let v = 0; v < vans; v++) {
    // a round: from street column a to b and row c to d, driven one way
    const a = Math.floor(rnd() * (N - 1)), b = a + 1 + Math.floor(rnd() * (N - a)), c = Math.floor(rnd() * (N - 1)), d = c + 1 + Math.floor(rnd() * (N - c));
    const pts: [number, number][] = [[street(a), street(c)], [street(b), street(c)], [street(b), street(d)], [street(a), street(d)]];
    if (rnd() < 0.5) pts.reverse();
    const lens = pts.map((p, i) => { const q = pts[(i + 1) % 4]!; return Math.hypot(q[0] - p[0], q[1] - p[1]); }), round = lens.reduce((s, x) => s + x, 0);
    const speed = 7 + rnd() * 5, start = rnd() * round, charge0 = 0.45 + rnd() * 0.5;
    for (let s = 0; s <= minutes * 60; s += 2) {
      let m = (start + s * speed) % round, k = 0;
      while (m > lens[k]!) { m -= lens[k]!; k++; }
      const p = pts[k]!, q = pts[(k + 1) % 4]!, f = m / lens[k]!;
      // (each drives on the right of the street's middle)
      const dx = (q[0] - p[0]) / lens[k]!, dy = (q[1] - p[1]) / lens[k]!, side = 3;
      const [lon, lat] = planeAt(p[0] + (q[0] - p[0]) * f + dy * side, p[1] + (q[1] - p[1]) * f - dx * side);
      rows.push({ id: `van-${String(v + 1).padStart(2, '0')}`, t: t0 + s * 1000, lon, lat, values: { charge: Math.max(0.05, charge0 - s / (minutes * 60) * 0.3) } });
    }
  }
  log.appendMany(rows);
  return log;
}

/** the town's box [west, south, east, north] (the map's view fits it to the screen) */
export const TOWN: [number, number, number, number] = [...planeAt(-HALF - STREET, -HALF - STREET), ...planeAt(HALF + STREET, HALF + STREET)] as [number, number, number, number];

/** where the camera looks: the whole town from above (until it is fitted to the screen), and a twin's view down a street */
export const VIEWS = {
  map: { lon: 0, lat: 0, zoom: 15.6, tilt: 0, bearing: 0 },
  twin: { lon: 0, lat: 0, zoom: 19, tilt: 64, bearing: 35 },
};

/** the buildings: each block but the parks, set in from its edges, its levels' height */
export const BUILDINGS: Feature[] = BLOCKS.filter((b) => b.props.kind !== 'park').map((b) => {
  const [w, s] = (b.geometry as { coordinates: [number, number][][] }).coordinates[0]![0]!, inset = 12;
  const [x0, y0] = planeXY(w, s);
  return { id: `h-${b.id}`, props: b.props, geometry: { type: 'Polygon', coordinates: [ring(x0 + inset, y0 + inset, x0 + BLOCK - inset, y0 + BLOCK - inset)] } };
});
