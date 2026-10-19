// This example's drones' flights (an app's own data: made here, seeded, the same on every run). Each drone has a pad
// somewhere over the suburb, a height it cruises at and a loop it flies: it waits on its pad, lifts off along its loop
// while climbing, flies round it (its height rising and falling a little), comes down slowing to its pad, lands. One
// cycle of 300 s, each drone at its own point in it, a sample every 2 s: the span loops with no seam.
//   droneFlights(n, [lon, lat]) → the columns of a recorded track (history.fromColumns), each sample's battery (`charge`)
//   and its height over the ground (`alt`, m)
import type { LogColumns } from '../../src/index.ts';

const KZ = 110574, D = Math.PI / 180, CYCLE = 300, STEP = 2;
const smooth = (k: number) => { const x = Math.max(0, Math.min(1, k)); return x * x * (3 - 2 * x); };
/** the phases of a cycle (s): on the pad, lifting off (climbing, its speed rising), flying round, coming down (slowing),
 *  on the pad again */
const PAD = 5, UP = 25, DOWN = 273, LAND = 295;

/** n drones' flights over a square `side` m across round `at`, from `from` (ms) for one cycle */
export function droneFlights(n: number, at: [number, number], o: { from: number; side?: number; seed?: number }): LogColumns & { alt: Float64Array } {
  const side = o.side ?? 3000, kx = 111320 * Math.cos(at[1] * D), per = CYCLE / STEP + 1, N = n * per;
  let x = (o.seed ?? 7) >>> 0;
  const rnd = () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; };
  const ids: string[] = [], count = new Float64Array(n), t = new Float64Array(N), lon = new Float64Array(N), lat = new Float64Array(N), alt = new Float64Array(N), charge = new Float64Array(N);
  let k = 0;
  for (let i = 0; i < n; i++) {
    ids.push(`drone-${i + 1}`); count[i] = per;
    // its pad, the loop through it (radius, which way round), its cruising height and speed, where it is in the cycle
    const px = (rnd() - 0.5) * side, py = (rnd() - 0.5) * side, r = 40 + rnd() * 180, dir = rnd() < 0.5 ? -1 : 1, beta = rnd() * 2 * Math.PI;
    const A = 30 + rnd() * 110, v0 = 8 + rnd() * 7, off = rnd() * CYCLE;
    // (its speed rises over the lift-off and falls over the landing: the metres round its loops, whole loops)
    const metresAt = (ph: number) => ph <= PAD ? 0 : ph <= UP ? ((ph - PAD) ** 2) / (2 * (UP - PAD)) : ph <= DOWN ? (UP - PAD) / 2 + (ph - UP) : ph <= LAND ? (UP - PAD) / 2 + (DOWN - UP) + (ph - DOWN) - ((ph - DOWN) ** 2) / (2 * (LAND - DOWN)) : (UP - PAD) / 2 + (DOWN - UP) + (LAND - DOWN) / 2;
    const total = metresAt(CYCLE), loops = Math.max(1, Math.round((v0 * total) / (2 * Math.PI * r))), v = (loops * 2 * Math.PI * r) / total;
    const cx = px + r * Math.sin(beta), cy = py + r * Math.cos(beta), th0 = beta + Math.PI;
    for (let j = 0; j < per; j++, k++) {
      const tt = j * STEP, ph = (tt + off) % CYCLE, th = th0 + dir * (v * metresAt(ph)) / r;
      const h = ph <= PAD || ph >= LAND ? 0 : ph <= UP ? A * smooth((ph - PAD) / (UP - PAD)) : ph <= DOWN ? A + 8 * Math.sin((2 * Math.PI * (ph - UP)) / ((DOWN - UP) / 2)) : A * (1 - smooth((ph - DOWN) / (LAND - DOWN)));
      t[k] = o.from + tt * 1000;
      lon[k] = at[0] + (cx + r * Math.sin(th)) / kx; lat[k] = at[1] + (cy + r * Math.cos(th)) / KZ;
      alt[k] = Math.round(h * 100) / 100; charge[k] = 0.95 - 0.6 * (ph / CYCLE);
    }
  }
  return { ids, count, t, lon, lat, alt, values: { charge, alt } };
}
/** the span the flights cover (ms): one cycle */
export const DRONE_SPAN = CYCLE * 1000;
