// The trip's tracks and their times (this example's own: an app's story, built on aslnut's parts). From the pack
// (tools/journey-data.mjs): the car's routes, the plane's taxi ways, the runways. Here: when each thing is where.
//   the car       Melbourne's city → the international terminal (the quickest way by road class), its speed by its
//                 road's class and slower through the corners; at Kuta, from the arrivals to the beach road
//   the plane     the stand → taxi → runway 27 → the take-off roll (2.2 m/s² to 75 m/s) → its climb (12 m/s, then
//                 10) turning onto the great circle to Bali → 11 km at 215 m/s over the ground (a headwind) → down from 230 km out → a downwind leg
//                 south of Ngurah Rai over the sea, a right turn onto the final approach of runway 09 (3°) → the flare,
//                 the landing roll → taxi to its stand. Its log carries its place, its height over the land or the sea
//                 (its altitude) and its pitch
// Times: the world's (UTC); the beach is reached at 17:52 in Bali (the sun some 4° up over the sea, at its real place)
// and every time before it follows from the tracks (the waits at the airports are jumps, said on screen).
import { zonedTime } from '../../src/index.ts';

export type LL = [number, number];
const R = 6378137, D = Math.PI / 180, KZ = 110574;
const kxOf = (lat: number) => 111320 * Math.cos(lat * D);
export interface Journey {
  drives: Record<'mel' | 'dps', { line: LL[]; kmh: number[]; metres: number; seconds: number }>;
  taxi: Record<'mel' | 'dps', { line: LL[]; metres: number }>;
  runways: Record<'mel' | 'dps', { from: LL; to: LL; heading: number; metres: number }>;
  places: Record<'mel' | 'dps', { stand: LL; from: LL; to: LL }>;
}
/** a sample of a track: where, when (ms, UTC), and for the plane its height over the ground (m) and pitch (°) */
export interface Sample { lon: number; lat: number; t: number; alt: number; pitch: number }

// ── on the sphere ──
export const metres = (a: LL, b: LL) => { const p1 = a[1] * D, p2 = b[1] * D, dp = p2 - p1, dl = (b[0] - a[0]) * D, h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2; return 2 * R * Math.asin(Math.min(1, Math.sqrt(h))); };
export const bearing = (a: LL, b: LL) => { const p1 = a[1] * D, p2 = b[1] * D, dl = (b[0] - a[0]) * D; return ((Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)) / D) + 360) % 360; };
/** the place `m` metres from `a` going `brg` degrees */
export const along = (a: LL, brg: number, m: number): LL => { const d = m / R, p1 = a[1] * D, l1 = a[0] * D, b = brg * D, p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(b)); return [(l1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2))) / D, p2 / D]; };
/** the great circle from a to b, at a fraction f */
export const between = (a: LL, b: LL, f: number): LL => {
  const p1 = a[1] * D, l1 = a[0] * D, p2 = b[1] * D, l2 = b[0] * D, d = metres(a, b) / R; if (d < 1e-9) return a;
  const A = Math.sin((1 - f) * d) / Math.sin(d), B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(p1) * Math.cos(l1) + B * Math.cos(p2) * Math.cos(l2), y = A * Math.cos(p1) * Math.sin(l1) + B * Math.cos(p2) * Math.sin(l2), z = A * Math.sin(p1) + B * Math.sin(p2);
  return [Math.atan2(y, x) / D, Math.atan2(z, Math.hypot(x, y)) / D];
};
/** a local frame round a place: metres east, north ↔ lon, lat */
const frame = (o: LL) => { const kx = kxOf(o[1]); return { to: (p: LL): [number, number] => [(p[0] - o[0]) * kx, (p[1] - o[1]) * KZ], from: (x: number, y: number): LL => [o[0] + x / kx, o[1] + y / KZ] }; };

/** a path drawn in pieces: each piece adds its points (lon, lat) and their speeds (m/s), heights (m) and pitch */
class Path {
  pts: { p: LL; v: number; alt: number; pitch: number }[] = [];
  add(p: LL, v: number, alt = 0, pitch = 0): this { const l = this.pts.at(-1); if (!l || metres(l.p, p) > 0.3) this.pts.push({ p, v, alt, pitch }); return this; }
  get end(): LL { return this.pts.at(-1)!.p; }
  /** timed from t0: each piece at the mean of its ends' speeds */
  samples(t0: number): Sample[] {
    const out: Sample[] = []; let t = t0;
    this.pts.forEach((q, i) => { if (i) { const a = this.pts[i - 1]!; t += (metres(a.p, q.p) / Math.max(0.5, (a.v + q.v) / 2)) * 1000; } out.push({ lon: q.p[0], lat: q.p[1], t, alt: q.alt, pitch: q.pitch }); });
    return out;
  }
}
const smooth = (k: number) => k * k * (3 - 2 * k);

/** the car along a route from t0: a sample at each corner (its time by its piece's speed), slower by `k`; it stops
 *  `short` metres before the route's end (a terminal's kerb under its canopy: the car pulls up before it) */
export function driveSamples(r: Journey['drives']['mel'], t0: number, k = 1, short = 0): Sample[] {
  let left = 0; for (let i = 0; i + 1 < r.line.length; i++) left += metres(r.line[i]!, r.line[i + 1]!);
  left -= short;
  const out: Sample[] = [{ lon: r.line[0]![0], lat: r.line[0]![1], t: t0, alt: 0, pitch: 0 }]; let t = t0;
  for (let i = 0; i + 1 < r.line.length && left > 0; i++) {
    const a = r.line[i]!, b = r.line[i + 1]!, m = metres(a, b), f = Math.min(1, left / m), p: LL = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    t += ((m * f) / (r.kmh[i]! / 3.6)) * 1000 * k; left -= m; out.push({ lon: p[0], lat: p[1], t, alt: 0, pitch: 0 });
  }
  return out;
}

/** the flight: from the stand at Melbourne (its pushback at t0) to the stand at Ngurah Rai */
/** the moments of a flight (ms, UTC): its taxi out, its roll, lift-off, the final approach, touchdown, at its stand */
export interface Marks { taxi: number; roll: number; liftoff: number; final: number; touchdown: number; stand: number }
export function flight(j: Journey, t0: number): { samples: Sample[]; marks: Marks } {
  const P = new Path(), at: Record<string, number> = {};
  // taxi: along the taxiways to runway 27's threshold, 8 m/s (5 through the corners)
  const tx = j.taxi.mel.line;
  tx.forEach((p, i) => { const a = tx[i - 1], b = tx[i + 1], turn = a && b ? Math.abs(((bearing(p, b) - bearing(a, p) + 540) % 360) - 180) : 0; P.add(p, i === 0 ? 2 : turn > 30 ? 4 : 8); });
  const rw = j.runways.mel, hdg = bearing(rw.from, rw.to);
  // line up: onto the centreline a little way in, stopped
  P.add(along(rw.from, hdg, 60), 3).add(along(rw.from, hdg, 70), 0.1);
  const roll0 = P.pts.length - 1;
  // the roll: 2.2 m/s² from rest; the nose up from 68 m/s (to 8° at lift-off, 75 m/s, 1,280 m)
  for (let v = 4; v <= 75; v += 3) { const s = 70 + (v * v) / 4.4; P.add(along(rw.from, hdg, s), v, 0, v > 68 ? ((v - 68) / 7) * 8 : 0); }
  const liftoff = P.pts.length - 1, L0 = P.end;
  // the climb straight out: 12 m/s up while speeding to 130 m/s, 6 km
  for (let s = 250; s <= 6000; s += 250) { const k = s / 6000, v = 75 + 55 * Math.sqrt(k); P.add(along(L0, hdg, s), v, (s / ((75 + v) / 2)) * 12, 9 - k * 2); }
  // the turn onto the great circle to the downwind leg's start south-east of Ngurah Rai (a right turn, 2° a second).
  // (the approach in the runway's own axes: u along it from its threshold, v to its left)
  const dpsRw = j.runways.dps, F = frame(dpsRw.from), hr = bearing(dpsRw.from, dpsRw.to) * D;
  const RW = (u: number, v: number): LL => F.from(u * Math.sin(hr) - v * Math.cos(hr), u * Math.cos(hr) + v * Math.sin(hr)), DW: LL = RW(6000, -9000);
  let here = P.end, h = hdg, alt = P.pts.at(-1)!.alt; const vT = 140, step = 300;
  for (let n = 0; n < 60; n++) { const want = bearing(here, DW), turn = ((want - h + 540) % 360) - 180; if (Math.abs(turn) < 1) break; h += Math.sign(turn) * Math.min(Math.abs(turn), (2 * step) / vT); here = along(here, h, step); alt += (step / vT) * 10; P.add(here, vT, alt, 7); }
  // the great circle: up to 11 km (10 m/s up, gaining speed to 215 m/s over the ground), cruise, down from 230 km out
  const G0 = P.end, total = metres(G0, DW), alt0 = alt, up = ((11000 - alt0) / 10) * 190, down = 230000;
  for (let s = 2000; s < total; s += s < up || total - s < down + 5000 ? 2000 : 20000) {
    const p = between(G0, DW, s / total), a = s < up ? alt0 + (11000 - alt0) * (s / up) : total - s < down ? 1500 + (11000 - 1500) * ((total - s) / down) : 11000;
    const v = s < up ? 140 + 75 * (s / up) : total - s < down ? 130 + 85 * ((total - s) / down) : 215;
    P.add(p, v, a, s < up ? 5 : total - s < down ? -1 : 2);
  }
  P.add(DW, 125, 1500, 2);
  // the downwind leg back west, right of the runway (south of it, over the sea), then a right turn of 4.5 km onto the
  // final approach 12 km out
  const fafU = -12000, rad = 4500;
  for (let u = 6000 - 1000; u >= fafU; u -= 1000) P.add(RW(u, -9000), 115, 1500 - ((6000 - u) / 18000) * 500, 2);
  for (let a = 1; a <= 18; a++) { const th = -Math.PI / 2 - Math.PI * (a / 18); P.add(RW(fafU + rad * Math.cos(th), -rad + rad * Math.sin(th)), 95, 1000 - (a / 18) * 370, 3); }
  // the final approach: 3° to the threshold (its height 15 m over it), 75 m/s
  at.final = P.pts.length - 1;
  for (let u = fafU + 1000; u <= -500; u += 1000) P.add(RW(u, 0), 75, Math.max(15, -u * Math.tan(3 * D) + 15), 2.5);
  // the flare and touchdown, 400 m in; the roll to taxi speed (2.5 m/s²) to 2.2 km down the runway
  const hd = bearing(dpsRw.from, dpsRw.to);
  P.add(along(dpsRw.from, hd, 0), 72, 15, 3).add(along(dpsRw.from, hd, 200), 70, 4, 5).add(along(dpsRw.from, hd, 400), 68, 0, 4);
  at.touchdown = P.pts.length - 1;
  for (let s = 500; s <= 2200; s += 100) { const v = Math.max(10, Math.sqrt(Math.max(0, 68 * 68 - 2 * 2.5 * (s - 400)))); P.add(along(dpsRw.from, hd, s), v, 0, Math.max(0, 4 - (s - 400) / 60)); }
  // taxi in to the stand
  const ti = j.taxi.dps.line;
  ti.forEach((p, i) => { const a = ti[i - 1], b = ti[i + 1], turn = a && b ? Math.abs(((bearing(p, b) - bearing(a, p) + 540) % 360) - 180) : 0; P.add(p, i === ti.length - 1 ? 0.5 : turn > 30 ? 4 : 8); });
  const s = P.samples(t0);
  return { samples: s, marks: { taxi: t0, roll: s[roll0]!.t, liftoff: s[liftoff]!.t, final: s[at.final!]!.t, touchdown: s[at.touchdown!]!.t, stand: s.at(-1)!.t } };
}

/** a function of a place: the height over the ground the plane flies at there (m), from its samples (each place is
 *  passed once: its nearest piece's, along it) */
export function heightAt(samples: Sample[]): (lon: number, lat: number) => number {
  const C = 0.02, cells = new Map<string, number[]>(), key = (x: number, y: number) => `${Math.floor(x / C)}_${Math.floor(y / C)}`;
  for (let i = 0; i + 1 < samples.length; i++) {
    const a = samples[i]!, b = samples[i + 1]!, x0 = Math.floor(Math.min(a.lon, b.lon) / C) - 1, x1 = Math.floor(Math.max(a.lon, b.lon) / C) + 1, y0 = Math.floor(Math.min(a.lat, b.lat) / C) - 1, y1 = Math.floor(Math.max(a.lat, b.lat) / C) + 1;
    if ((x1 - x0) * (y1 - y0) > 400) continue;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) { const k = `${x}_${y}`; let l = cells.get(k); if (!l) cells.set(k, (l = [])); l.push(i); }
  }
  // (far from every piece: the nearest of a coarse list)
  const coarse = samples.filter((_, i) => i % 10 === 0);
  return (lon, lat) => {
    const l = cells.get(key(lon, lat));
    if (l) {
      const kx = kxOf(lat); let best = Infinity, h = 0;
      for (const i of l) {
        const a = samples[i]!, b = samples[i + 1]!, ax = (a.lon - lon) * kx, ay = (a.lat - lat) * KZ, bx = (b.lon - lon) * kx, by = (b.lat - lat) * KZ, dx = bx - ax, dy = by - ay;
        const t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1))), d = Math.hypot(ax + t * dx, ay + t * dy);
        if (d < best) { best = d; h = a.alt + (b.alt - a.alt) * t; }
      }
      return h;
    }
    let best = Infinity, h = 0; for (const s of coarse) { const d = metres([lon, lat], [s.lon, s.lat]); if (d < best) { best = d; h = s.alt; } } return h;
  };
}

/** the times of the whole trip (UTC ms), from the beach reached at 17:52 in Bali on 19 October 2026 */
export function timeline(j: Journey) {
  const beach = zonedTime('2026-10-19T17:52', 'Asia/Makassar').getTime();
  const dps = driveSamples(j.drives.dps, 0, 1.6), dpsDrive = dps.at(-1)!.t;
  const dpsStart = beach - dpsDrive;
  // the plane: its stand at Ngurah Rai some 17 minutes before the car leaves (through arrivals)
  const probe = flight(j, 0), standIn = dpsStart - 17 * 60e3, pushback = standIn - probe.marks.stand;
  const plane = flight(j, pushback);
  // the car at Melbourne: at the terminal two hours before the pushback (check-in, boarding)
  // (it pulls up 450 m short of the departures kerb, before the terminal's canopy and car park mapped over the road)
  const mel = driveSamples(j.drives.mel, 0, 1, 450), melStart = pushback - 2 * 3600e3 - mel.at(-1)!.t;
  return {
    beach, plane, cars: { mel: driveSamples(j.drives.mel, melStart, 1, 450), dps: driveSamples(j.drives.dps, dpsStart, 1.6) },
    t: { melStart, melArrive: melStart + mel.at(-1)!.t, pushback, ...plane.marks, dpsStart, beach },
  };
}
