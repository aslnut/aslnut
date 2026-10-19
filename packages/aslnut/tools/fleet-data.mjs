// The fleet example's data, made once (never in git): N vehicles driving an hour on the street place's OpenStreetMap
// roads (© OpenStreetMap contributors, ODbL: data/packs/roads/street.geojson, the area the twin is built for), each
// trip from where it is to a random destination by the quickest way (core › geometry › networks: the speed by road
// class; one-way streets gone their way only: OpenStreetMap's `oneway` tag, roundabouts and motorways one way by
// themselves), a short stop there, then on to the next; a charge level that runs down with the distance driven and fills
// up at a stop when low. Each vehicle keeps to the left of the road's middle. Samples at the route's corners only
// (where it turns or its speed changes: a place between two samples is on the road), in the smallest columns that hold
// them (core › data › history: 16-bit places in the area's box, 16-bit times in tenths, the charge in a byte).
//   node tools/fleet-data.mjs [vehicles=10000] [minutes=60] → data/packs/fleet/street-1h-{500,2000,10000}.hist
//   node tools/fleet-data.mjs charge → data/packs/fleet/charge-{scenario.geojson, cars.hist, ports-wall.hist,
//     ports-station.hist}: a day of 50 cars on a few blocks round the street place's middle. The scenario: 25 houses
//     (a garage, a driveway, a wall charger), 4 offices (a car park, a row of chargers) and 3 charging stations (the
//     charger preset's: its bays and lights are its anchors), placed off the roads facing them (a point each, its
//     layout in its own frame). Each place's traits (core › entities › identity › kind: its entries, parking and
//     service points) are its kind's neutral preset's at its params (modules › … › buildings › typology): the cars
//     stand at its parking, its chargers at its service points; any design of the place that carries the same traits
//     (the preset, a model given them, the app's own) serves the same scenario. Each car has its home and its office among them and a charging habit (at home in the
//     evening, overnight, or through the middle of the day; at work 09:00–17:00; a lunchtime top-up at a station); it
//     stands in its driveway or a car park's bay, never on the road; its charge (0..1) falls as it drives (by the
//     distance and the speed: 30 kWh, 0.13 + 0.0000125 v² kWh a km at v km/h, a leg standing for a commute of 10–25 km)
//     and rises as it charges (7 kW at home, 3.7 kW with the sun or at work, a station 50 kW); a low one goes to the
//     nearest station with a bay free first. The ports: each charger's bay, busy (1) while a car charges there, at its
//     light (a log for the wall chargers, one for the stations: their lights' heights); charge-traffic.hist: the street's
//     other traffic (not the scenario's: 40 vehicles crossing the blocks through the day)
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { network } from '../src/core/geometry/networks/index.ts';
import { chargers as CHARGERS } from '../src/modules/world/earth/presets/built/infrastructure/mobility/charger.ts';
import { typology } from '../src/modules/world/earth/presets/built/buildings/typology.ts';
import { kinds, traits } from '../src/core/entities/kinds.ts';
import { history, smallest } from '../src/core/data/history.ts';

const DATA = join(import.meta.dirname, '..', '..', '..', 'data'), OUT = join(DATA, 'packs', 'fleet');
const CHARGE = process.argv[2] === 'charge', args = CHARGE ? process.argv.slice(3) : process.argv.slice(2);
const N = Number(args[0] ?? (CHARGE ? 50 : 10000)), MIN = Number(args[1] ?? 60), SPAN = MIN * 60;
const T0 = Date.UTC(2026, 9, 14, 21, 0, 0);   // 08:00 in Melbourne (AEDT), 15 Oct 2026
// km/h by road class (no service roads, tracks or paths: they are no one's way through)
const SPEED = { motorway: 100, motorway_link: 60, trunk: 70, trunk_link: 50, primary: 60, primary_link: 45, secondary: 60, secondary_link: 45, tertiary: 50, tertiary_link: 40, unclassified: 50, residential: 40, living_street: 15 };
const LANE = 1.7;   // metres left of the road's middle (Melbourne keeps left)
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const rand = rng(2026);
const t0 = performance.now();

const gj = JSON.parse(readFileSync(join(DATA, 'packs', 'roads', 'street.geojson'), 'utf8'));
/** a way's direction from its OpenStreetMap tags: 1 along its points, -1 against them, 0 both ways (a roundabout and a
 *  motorway are one way by themselves) */
const ONEWAY = (p) => { const o = String(p.oneway ?? '').toLowerCase(); if (['yes', '1', 'true'].includes(o)) return 1; if (['-1', 'reverse'].includes(o)) return -1; if (['no', '0', 'false'].includes(o)) return 0; return p.junction === 'roundabout' || p.junction === 'circular' || p.highway === 'motorway' ? 1 : 0; };
const lines = gj.features.filter((f) => f.geometry?.type === 'LineString' && SPEED[f.properties.highway]).map((f) => ({ line: f.geometry.coordinates, props: { kmh: SPEED[f.properties.highway], way: ONEWAY(f.properties) } }));
const net = network({ lines, cost: (m, p) => m / (p.kmh / 3.6), oneway: (p) => p.way });
const n = net.xs.length;
// the main network: the nodes the middle one reaches and that reach it (one way streets: from each, to each)
let mid = 0, best = Infinity; const cx = net.xs.reduce((a, b) => a + b, 0) / n, cz = net.zs.reduce((a, b) => a + b, 0) / n;
for (let i = 0; i < n; i++) { const d = Math.hypot(net.xs[i] - cx, net.zs[i] - cz); if (net.adj[i].length && d < best) { best = d; mid = i; } }
const reach = net.shortest([{ node: mid }]).dist, back = net.shortest([{ node: mid }], { toward: true }).dist, main = [];
for (let i = 0; i < n; i++) if (Number.isFinite(reach[i]) && Number.isFinite(back[i]) && net.adj[i].length) main.push(i);
console.log(`network: ${n} nodes, ${net.size.pieces} pieces (${net.pieceWay.filter((w) => w !== 0).length} one way), ${main.length} in the main part (${(performance.now() - t0).toFixed(0)} ms)`);

// destinations: a pool, each one's quickest-way tree made once (every vehicle bound there follows it: the costs toward
// it, each node's next one on the way)
const POOL = 320, pool = [], trees = new Map();
while (pool.length < POOL) { const d = main[Math.floor(rand() * main.length)]; if (!pool.includes(d)) pool.push(d); }
const tree = (d) => { let t = trees.get(d); if (!t) { t = net.shortest([{ node: d }], { toward: true }); trees.set(d, t); } return t; };
const costOf = (a, b) => { const adj = net.adj[a]; for (let k = 0; k < adj.length; k += 2) if (adj[k] === b) return adj[k + 1]; wrongWay++; return Infinity; };
// (the steps driven along one-way pieces, and any against one: none, by construction)
const oneWayOf = new Map(); for (let k = 0; k < net.pieces.length; k += 3) if (net.pieceWay[k / 3]) oneWayOf.set(`${net.pieces[k]}_${net.pieces[k + 1]}`, 1).set(`${net.pieces[k + 1]}_${net.pieces[k]}`, 1);
let wrongWay = 0, oneWaySteps = 0, steps = 0;
const countSteps = (path) => { for (let i = 0; i + 1 < path.length; i++) { steps++; if (oneWayOf.has(`${path[i]}_${path[i + 1]}`)) oneWaySteps++; } };

// the area's box (the u16 places) and the log
let w = Infinity, s = Infinity, e = -Infinity, nn = -Infinity;
for (const i of main) { const [lon, lat] = net.lonLat(net.xs[i], net.zs[i]); w = Math.min(w, lon); e = Math.max(e, lon); s = Math.min(s, lat); nn = Math.max(nn, lat); }
const pad = 0.001, box = [w - pad, s - pad, e + pad, nn + pad];
const cols = smallest({ box, from: T0, to: T0 + SPAN * 1000 });
const log = history.log({ id: 'fleet', keep: Infinity, attribution: 'mock fleet on © OpenStreetMap contributors roads', place: cols.place, time: cols.time, values: { charge: { type: 'u8', domain: [0, 1] } } });
console.log(`columns: places ${cols.place.type}, times ${cols.time.type}${cols.time.step ? ` (${cols.time.step} s)` : ''}, charge u8`);

const KINDS = ['taxi', 'delivery', 'rideshare', 'service'];
/** a path's points moved LANE metres to the left of the way it is driven (a corner: along the bisector, at most 1.2×) */
function keepLeft(pts) {
  const out = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[i], c = pts[Math.min(pts.length - 1, i + 1)];
    const n1 = norm(a, b) ?? norm(b, c), n2 = norm(b, c) ?? n1;
    if (!n1) { out.push([b[0], b[1]]); continue; }
    let mx = n1[0] + n2[0], mz = n1[1] + n2[1]; const ml = Math.hypot(mx, mz);
    if (ml < 1e-6) { mx = n1[0]; mz = n1[1]; } else { mx /= ml; mz /= ml; }
    const k = Math.min(1.2, 1 / Math.max(0.5, mx * n1[0] + mz * n1[1]));
    out.push([b[0] + mx * LANE * k, b[1] + mz * LANE * k]);
  }
  return out;
}
/** Douglas–Peucker between a and b (kept), marking the points that stay within `tol` metres */
function simplify(pts, a, b, tol, keep) {
  if (b - a < 2) return;
  const [ax, az] = pts[a], [bx, bz] = pts[b], dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
  let far = -1, fd = tol;
  for (let i = a + 1; i < b; i++) {
    const [px, pz] = pts[i], t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (pz - az) * dz) / l2)) : 0, d = Math.hypot(px - ax - dx * t, pz - az - dz * t);
    if (d > fd) { fd = d; far = i; }
  }
  if (far < 0) return;
  keep[far] = 1; simplify(pts, a, far, tol, keep); simplify(pts, far, b, tol, keep);
}
// left of a → b in local metres (x east, z south): (dz, −dx) normalised
function norm(a, b) { const dx = b[0] - a[0], dz = b[1] - a[1], l = Math.hypot(dx, dz); return l < 1e-6 ? null : [dz / l, -dx / l]; }

/** a way (its nodes) as samples: the corners only, each run at one speed simplified (Douglas–Peucker, 0.4 m: a place
 *  between two samples stays on the road, the time between them along it), those under 0.3 s apart merged (a time is
 *  kept in tenths), each moved to its side of the road */
function legOf(path, pace) {
  countSteps(path);
  const mid = path.map((i) => [net.xs[i], net.zs[i]]);
  const secs = []; for (let i = 0; i + 1 < path.length; i++) secs.push(costOf(path[i], path[i + 1]) / pace);
  return legAlong(mid, secs);
}
/** points along the roads' middle and the seconds between them as samples (as a way's: legOf) */
function legAlong(mid, secs) {
  // (the road's own speed: its length on the road's middle over its time)
  const speedOf = (i) => Math.hypot(mid[i + 1][0] - mid[i][0], mid[i + 1][1] - mid[i][1]) / Math.max(1e-6, secs[i]);
  const keep = new Uint8Array(mid.length); keep[0] = 1; keep[mid.length - 1] = 1;
  for (let i = 1; i + 1 < mid.length; i++) if (Math.abs(speedOf(i) - speedOf(i - 1)) > 0.05) keep[i] = 1;
  const runs = []; for (let i = 0; i < mid.length; i++) if (keep[i]) runs.push(i);
  for (let r = 0; r + 1 < runs.length; r++) simplify(mid, runs[r], runs[r + 1], 0.4, keep);
  const at = [0]; for (let i = 0; i < secs.length; i++) at.push(at[i] + secs[i]);
  const kept = [0];
  for (let i = 1; i < mid.length; i++) if (keep[i] && (at[i] - at[kept[kept.length - 1]] >= 0.3 || i === mid.length - 1)) { if (i === mid.length - 1 && kept.length > 1 && at[i] - at[kept[kept.length - 1]] < 0.3) kept.pop(); kept.push(i); }
  // (the kept line's own corners: no spikes at a junction's short pieces)
  const side = keepLeft(kept.map((i) => mid[i])), pts = []; kept.forEach((i, k) => (pts[i] = side[k]));
  return { mid, secs, kept, pts };
}
/** the quickest way from one node to another (null: none) */
function wayTo(from, d) {
  const tr = tree(d), path = [from]; let u = from, guard = 0;
  while (u !== d && guard++ < 1e5) { u = tr.prev[u]; if (u < 0) return null; path.push(u); }
  return u === d ? path : null;
}
let samples = 0, trips = 0, stops = 0;
if (CHARGE) { await chargeMode(); process.exit(0); }
for (let v = 0; v < N; v++) {
  const id = `v${String(v).padStart(5, '0')}`, kind = KINDS[v % KINDS.length];
  let from = main[Math.floor(rand() * main.length)], t = rand() * 30, charge = 0.35 + rand() * 0.6;
  const pace = 0.82 + rand() * 0.18;   // traffic: a share of the road's speed
  const add = (x, z, tt, c) => { const [lon, lat] = net.lonLat(x, z); log.append(id, T0 + tt * 1000, lon, lat, { charge: c }, log.indexOf(id) < 0 ? { kind } : undefined); samples++; };
  let first = true;
  while (t < SPAN) {
    // a destination at least 600 m away along the roads, reachable
    let d = -1;
    for (let k = 0; k < 20 && d < 0; k++) { const c = pool[Math.floor(rand() * POOL)]; if (c !== from && tree(c).dist[from] > 60 && Number.isFinite(tree(c).dist[from])) d = c; }
    if (d < 0) break;
    const tr = tree(d), path = [from]; let u = from, guard = 0;
    while (u !== d && guard++ < 1e5) { u = tr.prev[u]; if (u < 0) break; path.push(u); }
    if (u !== d) break;
    trips++;
    const { mid, secs, kept, pts } = legOf(path, pace);
    if (first) { add(pts[0][0], pts[0][1], 0, charge); first = false; }
    // it sets off from its own side of the road (after a stop: turned round where it stood)
    if (t > 0) add(pts[0][0], pts[0][1], t, charge);
    let prev = 0, tt = t;
    for (const k of kept.slice(1)) {
      let dist = 0, sec = 0; for (let i = prev; i < k; i++) { dist += Math.hypot(mid[i + 1][0] - mid[i][0], mid[i + 1][1] - mid[i][1]); sec += secs[i]; }
      tt += sec; charge = Math.max(0.02, charge - (dist / 1000) * 0.012);
      add(pts[k][0], pts[k][1], tt, charge); prev = k;
      if (tt > SPAN) break;
    }
    t = tt; from = d;
    if (t >= SPAN) break;
    // a stop: short, or charging when low
    const low = charge < 0.3, dwell = low ? 240 + rand() * 240 : 30 + rand() * 150;
    t += dwell; if (low) charge = Math.min(1, charge + dwell * 0.003);
    stops++;
  }
}
mkdirSync(OUT, { recursive: true });
console.log(`${N} vehicles · ${trips} trips · ${stops} stops · ${log.samples} samples (${(log.samples / N).toFixed(0)} a vehicle, a sample every ${(SPAN * N / log.samples).toFixed(1)} s) · fastest ${(log.maxSpeed * 3.6).toFixed(0)} km/h · trail pieces for 60 s: ${log.densest(60) + 1}`);
// the page's choices of N: each file the first N vehicles (the same ones in each)
let total = 0;
for (const k of [500, 2000, N].filter((x, i, a) => x <= N && a.indexOf(x) === i)) {
  const file = join(OUT, `street-${MIN === 60 ? '1h' : `${MIN}m`}-${k}.hist`);
  writeFileSync(file, log.toBytes({ things: k })); total += statSync(file).size;
  console.log(`→ ${file}: ${(statSync(file).size / 1e6).toFixed(1)} MB`);
}
console.log(`all ${(total / 1e6).toFixed(1)} MB · ${(performance.now() - t0).toFixed(0)} ms · ${steps} steps routed, ${oneWaySteps} along one-way pieces, ${wrongWay} against one`);


// ── charge: a day of 50 cars, their homes, offices and charging stations ──────────────────────────────────────────
async function chargeMode() {
  const crand = rng(5050), BATTERY = 30, DAY = 24 * 3600, R = 430, CENTRE = net.local([145.1205, -37.9245]);
  const D0 = Date.UTC(2026, 9, 14, 13, 0, 0);   // 00:00 in Melbourne (AEDT), 15 Oct 2026
  const hm = (h) => h * 3600, ll = (x, z) => net.lonLat(x, z), r7 = (v) => +v.toFixed(7), r2 = (v) => +v.toFixed(2);
  const inside = (x, z) => Math.hypot(x - CENTRE[0], z - CENTRE[1]) < R;
  const roadGap = (x, z) => net.nearest(ll(x, z), { max: 60 })?.distance ?? 99;
  const shuffle = (a) => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(crand() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  // the road pieces inside, by class (houses on the streets; offices and stations on the larger roads)
  const HW = gj.features.filter((f) => f.geometry?.type === 'LineString' && SPEED[f.properties.highway]).map((f) => f.properties.highway);
  const BIG = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'trunk']), pieces = [];
  for (let k = 0; k < net.pieces.length; k += 3) {
    const a = net.pieces[k], b = net.pieces[k + 1], hw = HW[net.pieces[k + 2]], ax = net.xs[a], az = net.zs[a], bx = net.xs[b], bz = net.zs[b], len = Math.hypot(bx - ax, bz - az);
    if (len >= 22 && inside((ax + bx) / 2, (az + bz) / 2)) pieces.push({ ax, az, bx, bz, len, big: BIG.has(hw), res: hw === 'residential' || hw === 'living_street' });
  }
  // a building's frame, as a shape's: its front (+z) towards its heading (degrees clockwise from north: towards its
  // road); a place in it → world metres (x east, z south)
  const frameOf = (b) => { const h = (b.heading * Math.PI) / 180, c = Math.cos(h), sn = Math.sin(h); return (lx, lz) => [b.x - lx * c + lz * sn, b.z - lx * sn - lz * c]; };
  const placed = [];
  /** a building `S` metres off a road piece, facing it; `round`: its circle [lx, lz, r] (clear of the others), `body`:
   *  its corners (clear of every road), `ok`: anything else asked of its place */
  function site(pc, S, round, body, ok = () => true) {
    for (let tries = 0; tries < 8; tries++) {
      const t = 0.3 + crand() * 0.4, side = crand() < 0.5 ? -1 : 1, tx = (pc.bx - pc.ax) / pc.len, tz = (pc.bz - pc.az) / pc.len;
      const rx = pc.ax + (pc.bx - pc.ax) * t, rz = pc.az + (pc.bz - pc.az) * t, x = rx - tz * side * S, z = rz + tx * side * S;
      const b = { x, z, rx, rz, heading: ((Math.atan2(rx - x, -(rz - z)) * 180) / Math.PI + 360) % 360 }, f = frameOf(b), c = f(round[0], round[1]);
      if (!inside(x, z) || !ok(x, z) || placed.some((q) => Math.hypot(q[0] - c[0], q[1] - c[1]) < q[2] + round[2])) continue;
      if (body.some(([lx, lz]) => { const p = f(lx, lz); return roadGap(p[0], p[1]) < 5; })) continue;
      placed.push([c[0], c[1], round[2]]); b.at = f; return b;
    }
    return null;
  }
  const big = pieces.filter((p) => p.big), res = pieces.filter((p) => p.res);
  // the layouts, in a building's frame (metres: x across its front, z towards its road; rectangles [x, z, width, depth])
  const STATION = CHARGERS.station(4), stations = [], offices = [], houses = [];
  for (const pc of shuffle([...big])) {
    if (stations.length >= 3) break;
    // (the stations apart: one in each part of the place)
    const b = site(pc, 14, [0.6, 4, 11], [[-7, -2], [8.2, -2], [-7, 6], [8.2, 6]], (x, z) => stations.every((q) => Math.hypot(q.x - x, q.z - z) > 220)); if (!b) continue;
    b.kind = 'charger'; b.forecourt = [0.6, 4.2, 15.2, 12.4]; b.charger = { at: [0, 0], ports: 4, mount: 'pedestal', power: 50, made: STATION };
    stations.push(b);
  }
  for (const pc of shuffle([...big])) {
    if (offices.length >= 4) break;
    const b = site(pc, 32, [0, 10, 21], [[-12.8, -7], [12.8, -7], [-12.8, 20], [12.8, 20]], (x, z) => offices.every((q) => Math.hypot(q.x - x, q.z - z) > 160)); if (!b) continue;
    b.kind = 'office'; b.size = [24, 14]; b.levels = 3 + (offices.length % 3); b.carpark = [0, 17.55, 25.5, 19.9];
    // its traits: the neutral office's at its params (its car park's bays, a service point at the head of each of the
    // first row's)
    b.preset = { width: 24, depth: 14, levels: b.levels, carpark: 2, bays: 9, bay: 2.7, paved: false };
    b.traits = traits(typology.office.make(b.preset), kinds.office);
    offices.push(b);
  }
  for (const pc of shuffle([...res, ...res, ...big])) {
    if (houses.length >= 25) break;
    const k = houses.length, w = 9 + (k % 3), d = 10 + (k % 4), gs = k % 2 ? 1 : -1, gx = gs * (w / 2 + 2.1);
    const b = site(pc, 18, [0, 3, 12], [[-w / 2, -d / 2], [w / 2, -d / 2], [gx + gs * 1.9, -d / 2], [gx + gs * 1.9, d / 2]]); if (!b) continue;
    b.kind = 'house'; b.size = [w, d]; b.levels = k % 4 === 0 ? 2 : 1; b.roof = k % 3 === 0 ? 'hipped' : 'gabled';
    b.garage = [gx, d / 2 - 3.2, 3.8, 6.4]; b.driveway = [gx - gs * 1.2, (d / 2 + 14.4) / 2, 6.2, 14.4 - d / 2];
    // its traits: the neutral house's at its params (its garage on its own left, +x, or right; the driveway to the
    // lot's front); its charger at its service point, turned as it is
    b.preset = { width: w, depth: d, levels: b.levels, roof: b.roof === 'hipped' ? 'hip' : 'gable', garage: gs > 0 ? 'left' : 'right', driveway: 14.4 - d / 2, paved: false };
    b.traits = traits(typology.house.make(b.preset), kinds.house);
    const sv = b.traits.service[0];
    b.charger = { at: [sv.at[0], sv.at[2]], turn: sv.heading ?? 0, ports: 1, mount: 'wall', power: 7, marked: false, made: CHARGERS.wall(1, false) };
    houses.push(b);
  }
  console.log(`placed: ${stations.length} stations, ${offices.length} offices, ${houses.length} houses`);
  // the cars: two a house; the first charges at home (in the evening, overnight, or through the middle of the day with
  // the sun), the second away (at work, or a lunchtime top-up at a station); each with an office
  const HABITS = { 'home-evening': 'charges at home 18:00–22:00', 'home-night': 'charges at home 22:00–07:00 (off-peak)', 'home-day': 'charges at home 10:00–15:00 (solar)', work: 'charges at work 09:00–17:00', 'station-lunch': 'tops up at a station 12:00–13:00' };
  const PAINTS = ['#c81e1e', '#1d4ed8', '#15803d', '#d97706', '#7c3aed', '#0f172a', '#db2777', '#0e7490', '#ea580c', '#334155', '#f1f5f9', '#854d0e'];
  const cars = [];
  houses.forEach((_, k) => {
    cars.push({ home: k, habit: ['home-evening', 'home-night', 'home-night', 'home-day', 'home-day'][k % 5], office: k % offices.length });
    cars.push({ home: k, habit: k % 3 === 0 ? 'station-lunch' : 'work', office: (k + 2) % offices.length });
  });
  cars.forEach((c, i) => {
    c.id = `car-${String(i + 1).padStart(2, '0')}`; c.paint = PAINTS[(i * 7) % PAINTS.length];
    // (the place is a few blocks: a trip here stands for a commute of 10–25 km, its energy so many times the leg's)
    c.stretch = (10 + crand() * 15) / 0.9; c.soc = c.habit.startsWith('home-night') ? 0.3 + crand() * 0.25 : 0.22 + crand() * 0.4;
  });
  // the spots: where a car stands (a place in the frame, its heading there, the way from it to the road)
  const spot = (b, lx, lz, rel, via) => ({ b, at: b.at(lx, lz), heading: (b.heading + rel) % 360, via: via.map(([x, z]) => b.at(x, z)), busy: [] });
  /** the first spot of a list free from `a` to `b` (seconds), taken for then (null: none) */
  const take = (list, a, b) => { const sp = list.find((x) => x.busy.every(([p, q]) => q < a || p > b)); sp?.busy.push([a, b]); return sp ?? null; };
  /** a charger's bays and lights in its building's frame (the preset's anchors, turned as the charger is: its heading
   *  in the frame, degrees from the frame's front) */
  const portsOf = (b) => { const m = b.charger.made, [cx, cz] = b.charger.at, A = (n) => m.anchors.find((a) => a.name === n), t = ((b.charger.turn ?? 0) * Math.PI) / 180, c = Math.cos(t), sn = Math.sin(t);
    const R = (x, z) => [cx + x * c + z * sn, cz - x * sn + z * c];
    return m.anchors.filter((a) => a.name.startsWith('bay-')).map((a, k) => { const li = A(`light-${k + 1}`); return { bay: R(a.at[0], a.at[2]), light: [...R(li.at[0], li.at[2]), li.at[1]] }; }); };
  /** a parking anchor as a spot: the way out from it (5 m straight out the way it faces, then `then`) */
  const parkAt = (b, a, then) => { const out = a.at[2] + (Math.abs(((a.heading ?? 0) % 360) - 180) < 1 ? 5 : -5); return spot(b, a.at[0], a.at[2], a.heading ?? 0, [[a.at[0], out], ...then]); };
  const ports = [], portIds = new Map();
  const addPort = (b, owner, kind, k, p) => { const id = `${owner}-p${k + 1}`, [lx, lz, y] = p.light, o = { id, kind, owner, light: [...ll(...b.at(lx, lz)), y], busy: [] }; ports.push(o); portIds.set(id, o); return o; };
  // a house's cars at its parking (the first at its charger's bay), out to its road (15 m out, the road at 18)
  houses.forEach((b, k) => {
    b.id = `house-${k + 1}`; const [p] = portsOf(b);
    b.port = addPort(b, b.id, 'home', 0, p);
    b.spots = b.traits.parking.map((a) => spot(b, a.at[0], a.at[2], a.heading ?? 0, [[a.at[0], 15]]));
    void k;
  });
  // an office: its chargers at the first of its service points (one for each car charging there, 2–8), a car at each
  // charger's bay (its parking anchor there), the others free; out along the car park's aisle to its road
  offices.forEach((b, k) => {
    b.id = `office-${k + 1}`;
    const workers = cars.filter((c) => c.office === k && c.habit === 'work'), n = Math.min(8, Math.max(2, workers.length)), sv = b.traits.service.slice(0, n);
    b.charger = { at: [(sv[0].at[0] + sv[n - 1].at[0]) / 2, sv[0].at[2]], ports: n, mount: 'wall', power: 7, marked: true, made: CHARGERS.wall(n, true) };
    const ps = portsOf(b); b.ports = ps.map((p, j) => addPort(b, b.id, 'office', j, p));
    const rows = b.traits.parking, aisle = [[0, 16.7], [0, 27]];
    // (a charger's bay: the parking anchor nearest it)
    const near = (q) => rows.reduce((m, a) => (Math.hypot(a.at[0] - q[0], a.at[2] - q[1]) < Math.hypot(m.at[0] - q[0], m.at[2] - q[1]) ? a : m));
    const own = ps.map((p) => near(p.bay));
    b.portSpots = own.map((a) => parkAt(b, a, aisle));
    b.free = rows.filter((a) => !own.includes(a)).map((a) => parkAt(b, a, aisle));
  });
  stations.forEach((b, k) => {
    b.id = `station-${k + 1}`; const ps = portsOf(b);
    b.ports = ps.map((p, j) => addPort(b, b.id, 'station', j, p));
    b.portSpots = ps.map((p) => spot(b, p.bay[0], p.bay[1], 180, [[p.bay[0], p.bay[1] + 5], [p.bay[0] * 0.5, 11]]));
  });
  // the logs: the cars (their charge, as f32 seconds of the day), each charger's bays (busy) by the height of their lights
  const clog = history.log({ id: 'charge-cars', keep: Infinity, attribution: 'mock cars on © OpenStreetMap contributors roads', place: cols.place, time: { type: 'f32', epoch: D0 }, values: { charge: { type: 'u8', domain: [0, 1] } } });
  // the ways between buildings' road points: along the roads' middle, the quickest (a tree per destination node)
  const nearOf = (b) => (b.near ??= net.nearest(ll(b.rx, b.rz), { max: 200 }));
  function roadLeg(A, B, pace) {
    const na = nearOf(A), nb = nearOf(B), from = [A.rx, A.rz], to = [B.rx, B.rz];
    // on one piece, the way it goes: straight along it (a one-way piece the other way: round the block)
    if (na.a === nb.a && na.b === nb.b && (nb.toA > na.toA ? na.way !== -1 : na.way !== 1)) return legAlong([from, to], [Math.abs(na.toA - nb.toA) / pace]);
    if (na.a === nb.b && na.b === nb.a && (nb.toB > na.toA ? na.way !== -1 : na.way !== 1)) return legAlong([from, to], [Math.abs(na.toA - nb.toB) / pace]);
    let best = null;
    // (onto the network the way its piece goes: to a against a → b; off it, from b along a → b)
    for (const [n1, c1, ok1] of [[na.a, na.toA, na.way !== 1], [na.b, na.toB, na.way !== -1]]) for (const [n2, c2, ok2] of [[nb.a, nb.toA, nb.way !== -1], [nb.b, nb.toB, nb.way !== 1]]) {
      if (!ok1 || !ok2) continue;
      const c = c1 + tree(n2).dist[n1] + c2; if (Number.isFinite(c) && (!best || c < best.c)) best = { c, n1, n2, c1, c2 };
    }
    if (!best) { unrouted++; return null; }
    const path = best.n1 === best.n2 ? [best.n1] : wayTo(best.n1, best.n2); if (!path) { unrouted++; return null; }
    countSteps(path);
    const mid = [from, ...path.map((i) => [net.xs[i], net.zs[i]]), to], secs = [best.c1 / pace];
    for (let i = 0; i + 1 < path.length; i++) secs.push(costOf(path[i], path[i + 1]) / pace);
    secs.push(best.c2 / pace);
    return legAlong(mid, secs);
  }
  let sessions = 0, unrouted = 0;
  for (const c of cars) {
    const home = houses[c.home], office = offices[c.office], pace = 0.85 + crand() * 0.15;
    let t = 0, soc = c.soc, last = -Infinity, place = c.habit.startsWith('home') ? home.spots[0] : home.spots[1];
    const add = (p, tt, v) => {
      // (each sample after the one before: a stop's two ends are two samples)
      tt = Math.max(tt, last + 0.05); last = tt;
      const [lon, lat] = ll(p[0], p[1]);
      clog.append(c.id, D0 + tt * 1000, lon, lat, { charge: Math.max(0, Math.min(1, v)) }, clog.indexOf(c.id) < 0 ? { paint: c.paint, home: home.id, office: office.id, habit: c.habit, charges: HABITS[c.habit] } : undefined);
      return tt;
    };
    const use = (m, kmh) => { soc = Math.max(0.03, soc - ((m / 1000) * (0.13 + 0.0000125 * kmh * kmh) * c.stretch) / BATTERY); };
    // (it came in before the day began: its heading where it stands is the way it drove in)
    add(place.via[0], -12, soc); t = add(place.at, 0, soc);
    /** off the road (a driveway, a car park: 2.5 m/s) through these points */
    const slow = (pts) => { let p0 = pts[0]; for (const p of pts.slice(1)) { const m = Math.hypot(p[0] - p0[0], p[1] - p0[1]); t += m / 2.5 + 0.5; use(m, 9); t = add(p, t, soc); p0 = p; } };
    /** drive from where it stands to a spot: out to its road, the quickest way, in to the spot */
    const drive = (to) => {
      const leg = to.b === place.b ? null : roadLeg(place.b, to.b, pace);
      slow([place.at, ...place.via]);
      if (leg) {
        const { mid, secs, kept, pts } = leg; slow([place.via[place.via.length - 1], pts[0]]);
        let prev = 0;
        for (const k of kept.slice(1)) {
          let m = 0, sec = 0; for (let i = prev; i < k; i++) { m += Math.hypot(mid[i + 1][0] - mid[i][0], mid[i + 1][1] - mid[i][1]); sec += secs[i]; }
          t += sec; use(m, sec > 0 ? (m / sec) * 3.6 : 0); t = add(pts[k], t, soc); prev = k;
        }
        slow([pts[kept[kept.length - 1]], ...[...to.via].reverse(), to.at]);
      } else slow([place.via[place.via.length - 1], ...[...to.via].reverse(), to.at]);
      place = to;
    };
    /** charge where it stands until `until` or full (to `top`), at kW; its port busy meanwhile */
    const charge = (kw, until, port, top = 0.98) => {
      const t1 = Math.min(until, t + (((top - soc) * BATTERY) / kw) * 3600); if (t1 <= t + 60) return;
      soc = Math.min(top, soc + (((t1 - t) / 3600) * kw) / BATTERY); port?.busy.push([t, t1]); t = add(place.at, t1, soc); sessions++;
    };
    const wait = (h) => { if (t < hm(h)) t = add(place.at, hm(h), soc); };
    /** to a station (the nearest by road with a bay free when it gets there), charged to `top` at 50 kW */
    const station = (top) => {
      const order = [...stations].sort((a, b) => (tree(nearOf(a).a).dist[nearOf(place.b).a] ?? 1e9) - (tree(nearOf(b).a).dist[nearOf(place.b).a] ?? 1e9));
      for (const s0 of order) {
        const eta = t + 120, k = s0.ports.findIndex((p) => p.busy.every(([a, b]) => b < eta - 30 || a > eta + 1800));
        if (k < 0) continue;
        drive(s0.portSpots[k]); charge(50, DAY, s0.ports[k], top); return;
      }
    };
    /** set off at `h` (a station first when low) to a spot */
    const go = (h, to) => { wait(h); if (soc < 0.2) station(0.8); drive(to); };
    const mySpot = c.habit === 'work' ? (() => { const j = cars.filter((x) => x.office === c.office && x.habit === 'work').indexOf(c); return j < office.ports.length ? { s: office.portSpots[j], port: office.ports[j] } : { s: take(office.free, hm(7), hm(19.5)) }; })() : null;
    /** a visit to an office (a meeting, lunch): its car park's first spot free from `h` for `stay` hours, the others
     *  shuffled (not its own) */
    const visit = (h, stay, not = -1) => { for (const o of shuffle(offices.filter((_, k) => k !== not))) { const sp = take(o.free, hm(h) - 600, hm(h + stay) + 1200); if (sp) return sp; } return null; };
    const away = (h, stay, back, not) => { const sp = visit(h, stay, not); if (!sp) return; go(h, sp); wait(h + stay); drive(back); };
    if (c.habit === 'home-night') charge(7, hm(7), home.port);
    if (c.habit === 'home-day') {
      // errands in the morning and the afternoon (an office's car park: a meeting), charging at home between
      away(8.2 + crand() * 0.8, 0.4 + crand() * 0.3, home.spots[0]);
      wait(10); charge(3.7, hm(15), home.port);
      away(15.3 + crand() * 0.6, 0.5 + crand() * 0.4, home.spots[0]);
    } else {
      // the commute: to the office in the morning (to its charger, or a free spot); home again after work
      const at = mySpot?.s ?? take(office.free, hm(7), hm(19.5)) ?? office.portSpots[0];
      go(7.3 + crand() * 1.4, at);
      if (mySpot?.port) { wait(9); charge(3.7, hm(17), mySpot.port); }
      if (c.habit === 'station-lunch') { wait(12 + crand() * 0.7); station(0.92); drive(at); }
      // lunch at another office (most of those not charging at work)
      if (c.habit.startsWith('home') && crand() < 0.85) away(11.9 + crand() * 0.8, 0.4 + crand() * 0.4, at, c.office);
      go(16.6 + crand() * 1.2, c.habit.startsWith('home') ? home.spots[0] : home.spots[1]);
      if (c.habit === 'home-evening') { wait(18); charge(7, hm(22), home.port); }
      if (c.habit === 'home-night') { wait(22); charge(7, DAY, home.port); }
    }
    if (t < DAY) add(place.at, DAY, soc);
  }
  // the ports' busy over the day: a step at each change (the light turns at once)
  const plogs = {};
  for (const kind of ['wall', 'station']) plogs[kind] = history.log({ id: `charge-ports-${kind}`, keep: Infinity, attribution: 'mock charging ports', place: cols.place, time: { type: 'f32', epoch: D0 }, values: { busy: { type: 'u8', domain: [0, 1] } } });
  for (const p of ports) {
    let lt = -Infinity;
    const lg = plogs[p.kind === 'station' ? 'station' : 'wall'], [lon, lat, y] = p.light;
    const put = (tt, v) => { tt = Math.max(tt, lt + 0.01); lt = tt; lg.append(p.id, D0 + tt * 1000, lon, lat, { busy: v }, lg.indexOf(p.id) < 0 ? { kind: p.kind, owner: p.owner, height: r2(y) } : undefined); };
    const iv = [...p.busy].sort((a, b) => a[0] - b[0]); put(0, 0);
    for (const [a, b] of iv) { put(a - 0.2, 0); put(a, 1); put(b, 1); put(b + 0.2, 0); }
    put(DAY, 0);
  }
  // the street's other traffic (not the scenario's cars): 40 vehicles, each out from its start hour (06:00–09:00) to
  // its end hour (16:00–21:00): in from far away, then across the blocks again and again (from just outside them to
  // the other side, by the quickest way), then far away again, where it stays (out of sight)
  const trand = rng(7070), tlog = history.log({ id: 'charge-traffic', keep: Infinity, attribution: 'mock traffic on © OpenStreetMap contributors roads', place: cols.place, time: { type: 'f32', epoch: D0 }, values: {} });
  const fromC = (i) => Math.hypot(net.xs[i] - CENTRE[0], net.zs[i] - CENTRE[1]), angOf = (i) => Math.atan2(net.zs[i] - CENTRE[1], net.xs[i] - CENTRE[0]);
  // (the places out there: pools, each one's quickest-way tree made once)
  const pool = (lo, hi, n) => { const all = main.filter((i) => { const d = fromC(i); return d > lo && d < hi; }); return Array.from({ length: n }, () => all[Math.floor(trand() * all.length)]); };
  const near = pool(480, 900, 80), far = pool(2200, 3200, 16);
  let tTrips = 0;
  for (let v = 0; v < 40; v++) {
    const id = `traffic-${String(v + 1).padStart(2, '0')}`, pace = 0.85 + trand() * 0.15, end = hm(16 + trand() * 5);
    let from = far[Math.floor(trand() * far.length)], t = hm(6 + trand() * 3), first = true, last = false;
    const put = (pt, ts) => { const [lon, lat] = net.lonLat(pt[0], pt[1]); tlog.append(id, D0 + ts * 1000, lon, lat, undefined, first ? { kind: 'traffic' } : undefined); first = false; };
    while (!last) {
      last = t > end;
      // to the other side of the blocks (an angle over 100° round from where it is), or at the end far away
      let path = null;
      for (let k = 0; k < 40 && !path; k++) {
        const d = last ? far[Math.floor(trand() * far.length)] : near[Math.floor(trand() * near.length)]; if (d === from) continue;
        const da = Math.abs(((angOf(d) - angOf(from) + 3 * Math.PI) % (2 * Math.PI)) - Math.PI);
        if (!last && fromC(from) < 1000 && da < (100 * Math.PI) / 180) continue;
        const pth = wayTo(from, d); if (pth && (last || pth.some((i) => fromC(i) < R * 0.7))) path = pth;
      }
      if (!path) { t += 120; if (t > DAY) break; continue; }
      const { mid, secs, kept, pts } = legOf(path, pace); let prev = 0, tt = t;
      put(pts[0], tt);
      for (const k of kept.slice(1)) { let sec = 0; for (let i = prev; i < k; i++) sec += secs[i]; tt += sec; put(pts[k], tt); prev = k; }
      void mid; tTrips++; from = path[path.length - 1]; t = tt + 2 + trand() * 20;
      // (it turns round where the way ended: a few seconds there)
    }
  }
  writeFileSync(join(OUT, 'charge-traffic.hist'), tlog.toBytes());
  console.log(`traffic: 40 vehicles · ${tTrips} trips · ${tlog.samples} samples`);
  // the scenario: the placed buildings (a point each: its middle) with their layouts, chargers and cars
  const rect = (r) => r && r.map(r2);
  const carsOf = (pred) => cars.filter(pred).map((c) => c.id);
  // (its traits as [x, z, heading] in its frame: entries, parking, service points; the station's: its bays)
  const tr = (b) => b.traits ? Object.fromEntries(['entries', 'parking', 'service'].map((k) => [k, b.traits[k].map((a) => [r2(a.at[0]), r2(a.at[2]), a.heading ?? 0])])) : { parking: b.charger.made.anchors.filter((a) => a.kind === 'parking').map((a) => [r2(a.at[0]), r2(a.at[2]), a.heading ?? 0]) };
  const feat = (b, props) => ({ type: 'Feature', id: b.id, properties: { id: b.id, kind: b.kind, heading: r2(b.heading), road: ll(b.rx, b.rz).map(r7), charger: { at: b.charger.at.map(r2), ports: b.charger.ports, mount: b.charger.mount, power: b.charger.power, marked: b.charger.marked ?? true }, traits: tr(b), ...(b.preset ? { preset: b.preset } : {}), ...props }, geometry: { type: 'Point', coordinates: ll(b.x, b.z).map(r7) } });
  const features = [
    ...houses.map((b, k) => feat(b, { size: b.size, levels: b.levels, roof: b.roof, garage: rect(b.garage), driveway: rect(b.driveway), cars: carsOf((c) => c.home === k) })),
    ...offices.map((b, k) => feat(b, { size: b.size, levels: b.levels, carpark: rect(b.carpark), cars: carsOf((c) => c.office === k && !c.habit.startsWith('home-day')) })),
    ...stations.map((b) => feat(b, { forecourt: rect(b.forecourt), bays: 4 })),
  ];
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, 'charge-scenario.geojson'), JSON.stringify({ type: 'FeatureCollection', note: 'a mock scenario: generic places on © OpenStreetMap contributors roads (tools/fleet-data.mjs charge)', features }));
  writeFileSync(join(OUT, 'charge-cars.hist'), clog.toBytes());
  for (const [kind, lg] of Object.entries(plogs)) writeFileSync(join(OUT, `charge-ports-${kind}.hist`), lg.toBytes());
  // who charges at 12:30, and where
  const busyAt = (kind, h) => ports.filter((p) => p.kind === kind && p.busy.some(([a, b]) => a <= hm(h) && b >= hm(h))).length;
  for (const h of [2, 8, 10.5, 12.5, 15, 19, 23]) console.log(`charging at ${h}: homes ${busyAt('home', h)}, offices ${busyAt('office', h)}, stations ${busyAt('station', h)}`);
  console.log(`routed: ${steps} steps, ${oneWaySteps} along one-way pieces, ${wrongWay} against one`);
  console.log(`${cars.length} cars · ${sessions} charging sessions · ${clog.samples} car samples · ${ports.length} ports · lowest charge ${(Math.min(...cars.map((c) => c.soc)) * 100).toFixed(0)} % · ${unrouted} legs with no way by road (driven straight)`);
}
