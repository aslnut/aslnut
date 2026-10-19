// The journey example's data, made once (never in git) from the places tools/journey/extract.py cut from
// OpenStreetMap (© OpenStreetMap contributors, ODbL) and Mapzen's terrain tiles:
//   kuta/            the street level at Kuta's beach, baked as the twin's is (tools › compile: the roads solved on
//                    their ground, stages 12–15 placing the buildings and trees against them): index.json and its
//                    tiles, clamp.json, built/ (the placement tiles)
//   kuta.ground.*    its ground (a 4 m grid, buildings taken out), fitted to the coastline: the sand rises from the
//                    coast at 1 in 20, the sea floor falls at 1 in 40 (the terrain's 30 m cells put the waterline
//                    100 m out; the coast's line is the truth here)
//   journey.json     the trip's tracks: the car's routes (Melbourne to the airport, Ngurah Rai to Kuta: the quickest
//                    way by road class, core › geometry › networks; one-way streets their way only), the plane's taxi
//                    ways (the airports' taxiways, routed the same way) and the runways; the places the story stops at
//   airports.geojson the runways, taxiways, aprons, terminals and buildings of both airports (no names)
//   coast.geojson    the coastline round Kuta and the airport (land on the left) and the beaches: the sea's shore
//   node tools/journey-data.mjs      (after python3 tools/journey/extract.py) → data/packs/journey/
import { readFileSync, writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { network } from '../src/core/geometry/networks/index.ts';
import { solveRoads } from '../src/modules/world/earth/presets/built/roads/compile.ts';
import { councilFootpathWidth, roadFeatures, pathFeatures, waterFeatures } from '../src/modules/world/earth/presets/built/roads/inputs.ts';
import { roadSources } from '../src/modules/world/earth/presets/built/roads/sources.ts';
import { writeTiles } from '../src/core/data/loading/chunks/write.ts';
import { bakeBuilt } from '../src/modules/world/earth/presets/built/buildings/compile.ts';
import { builtTiles } from '../src/modules/world/earth/presets/built/buildings/tiles.ts';
import { coastSegments, coastField, localFrame, FAR } from '../src/modules/world/earth/water/sea/shore.ts';

const DATA = join(import.meta.dirname, '..', '..', '..', 'data'), RAW = join(DATA, 'raw-journey'), OUT = join(DATA, 'packs', 'journey');
mkdirSync(OUT, { recursive: true });
const read = (f) => JSON.parse(readFileSync(join(RAW, f), 'utf8'));
const ODBL = '© OpenStreetMap contributors (ODbL)';
const RAD = Math.PI / 180, KZ = 110574, kxOf = (lat) => 111320 * Math.cos(lat * RAD);
const t0 = performance.now(), took = () => `${((performance.now() - t0) / 1000).toFixed(1)} s`;
const writeJson = (file, o) => { const s = JSON.stringify(o); mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, s); writeFileSync(`${file}.gz`, gzipSync(s)); return Buffer.byteLength(s); };
const seedOf = (s) => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; };
const coast = read('bali-coast.geojson');

// ── the street place's ground, fitted to the coastline ──
const hd = read('kuta.ground.json'), buf = readFileSync(join(RAW, 'kuta.ground.f32')), origin = [hd.origin.lon, hd.origin.lat];
const data = new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
{
  // the coast's signed distance at each ground point (+ at sea), within 1.5 km of it; the grid's points are its cells'
  // middles here (x0, z0 is the first point: the field's corner half a cell before it)
  const segs = coastSegments(coast.features.filter((f) => f.properties.natural === 'coastline').map((f) => ({ ...f, props: f.properties })), localFrame(origin));
  const f = coastField(segs, { x0: hd.x0 - hd.step / 2, y0: -hd.z0 + hd.step / 2, cell: hd.step, nx: hd.nx, ny: hd.nz }, 1500); f.step();
  let sea = 0, sand = 0;
  for (let k = 0; k < data.length; k++) {
    const d = f.out[k]; if (d >= FAR) continue;
    const h = data[k];
    // at sea: the floor falls from 0.4 m under the waterline at 1 in 40 (deeper where the terrain is deeper)
    if (d > 0) { data[k] = Math.min(h, -0.4 - d / 40); sea++; }
    // on land: the sand rises from 0.3 m at 1 in 20 for 25 m, then meets the terrain over the next 40 m
    else { const sandH = 0.3 - d / 20, k2 = Math.min(1, Math.max(0, (-d - 25) / 40)); data[k] = -d < 25 ? sandH : Math.max(h, sandH) * (1 - k2) + h * k2; sand++; }
  }
  writeFileSync(join(OUT, 'kuta.ground.f32'), Buffer.from(data.buffer));
  writeFileSync(join(OUT, 'kuta.ground.json'), JSON.stringify({ ...hd, source: `${hd.source}; fitted to the OpenStreetMap coastline (the sand rising at 1 in 20, the sea floor falling at 1 in 40)` }));
  console.log(`kuta ground: ${hd.nx} × ${hd.nz}, ${sea} points at sea and ${sand} on the sand fitted to the coast (${took()})`);
}

// ── the street place: its roads solved on that ground, then its buildings and trees placed against them ──
{
  const doc = read('kuta.geojson'), ground = { x0: hd.x0, z0: hd.z0, step: hd.step, nx: hd.nx, nz: hd.nz, data };
  const kx = kxOf(origin[1]), at = ([lon, lat]) => [(lon - origin[0]) * kx, -(lat - origin[1]) * KZ];
  const built = read('kuta.built.geojson').features;
  // each street's width where its tags give none: measured between the buildings on its two sides (Kuta's lanes are
  // 3 to 6 m wall to wall; the bake's defaults are Victoria's, 7.3 m between kerbs and verges of 4.3 m, which put a
  // third of the buildings inside the road reserve). Each way's points every 4 m look 12 m to each side for the first
  // building wall; its corridor is the quarter-lowest sum of the two sides (where both see one), its carriageway three
  // quarters of that (2.6 m at the least, the bake's default at the most)
  const edges = new Map(), CELL = 20, cellOf = (x, z) => `${Math.floor(x / CELL)}_${Math.floor(z / CELL)}`;
  for (const f of built) if (f.properties.kind === 'building') { const r = f.geometry.coordinates[0].map(at); for (let i = 0; i + 1 < r.length; i++) { const a = r[i], b = r[i + 1], x0 = Math.floor(Math.min(a[0], b[0]) / CELL), x1 = Math.floor(Math.max(a[0], b[0]) / CELL), z0 = Math.floor(Math.min(a[1], b[1]) / CELL), z1 = Math.floor(Math.max(a[1], b[1]) / CELL); for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) { const k = `${x}_${z}`; let l = edges.get(k); if (!l) edges.set(k, (l = [])); l.push(a[0], a[1], b[0], b[1]); } } }
  const ray = (px, pz, dx, dz, max) => { let best = max; const seen = new Set(); for (let s = 0; s <= max; s += CELL / 2) { const k = cellOf(px + dx * s, pz + dz * s); if (seen.has(k)) continue; seen.add(k); const l = edges.get(k); if (!l) continue; for (let i = 0; i < l.length; i += 4) { const ex = l[i + 2] - l[i], ez = l[i + 3] - l[i + 1], den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue; const qx = l[i] - px, qz = l[i + 1] - pz, t = (qx * ez - qz * ex) / den, u = (qx * dz - qz * dx) / den; if (t > 0 && t < best && u >= 0 && u <= 1) best = t; } } return best; };
  const DEFAULT_CW = { 2: 13.2, 3: 7.6, 4: 7.6, 5: 7.3, 7: 5 }, CLS = { primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 5, living_street: 5, road: 5, service: 7 };
  let measured = 0;
  for (const f of doc.features) {
    const p = f.properties; if (f.geometry.type !== 'LineString' || p.width || !(p.highway?.replace(/_link$/, '') in CLS)) continue;
    const pts = f.geometry.coordinates.map(at), sums = [];
    for (let i = 0; i + 1 < pts.length; i++) {
      const a = pts[i], b = pts[i + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.5) continue;
      const tx = (b[0] - a[0]) / L, tz = (b[1] - a[1]) / L;
      for (let s = 2; s < L; s += 4) { const x = a[0] + tx * s, z = a[1] + tz * s, l = ray(x, z, -tz, tx, 12), r = ray(x, z, tz, -tx, 12); if (l < 12 && r < 12) sums.push(l + r); }
    }
    if (sums.length < 3) continue;
    sums.sort((a, b) => a - b);
    const corridor = sums[Math.floor(sums.length / 4)], cls = CLS[p.highway.replace(/_link$/, '')];
    const cw = Math.max(2.6, Math.min(DEFAULT_CW[cls] ?? 7.3, corridor * 0.75));
    if (cw < (DEFAULT_CW[cls] ?? 7.3) - 0.2) { p.width = cw.toFixed(1); p['width:source'] = 'measured between the buildings'; measured++; }
  }
  console.log(`kuta streets: ${measured} widths measured between the buildings (${took()})`);
  const { ways, crossings } = roadFeatures(doc.features), paths = pathFeatures(read('kuta.paths.geojson').features), waterways = waterFeatures(read('kuta.water.geojson').features);
  // (the verges past the kerbs: Kuta's streets have none to speak of, a narrow edge where they are kerbed)
  const solved = solveRoads(ways, origin, ground, { crossings, paths, reserves: [], footpathWidth: councilFootpathWidth([]), waterways, stamps: [], options: { place: 'kuta', snapshots: false, verges: { 1: 2, 2: 1.6, 3: 1.2, 4: 1, 5: 0.6, 6: 0.5 } } });
  const r = solved.report;
  console.log(`kuta roads: ${r.roads} roads · ${r.levels} levels · ${r.zones} junction zones · ${r.bridges} on decks · invalid ${r.invalid} · slivers ${r.slivers} · z-fight ${r.zfight} · gates ${r.stages.map((g) => `${g.stage}:${g.ok ? 'ok' : 'FAIL'}`).join(' ')} (${took()})`);
  // what stands there, in the place's metres (x east, z south of its origin): OpenStreetMap's buildings (their height,
  // else their levels × 3.2 m, else a kind's own: a house 6 m, two floors elsewhere) and trees (their height, else
  // 9 m with a 3 m crown); its parks
  const KINDS = { house: 6, residential: 7, detached: 6, hut: 3.5, shed: 3, roof: 4, garage: 3, kiosk: 3.5, hotel: 14, apartments: 14, commercial: 10, retail: 7, office: 12, temple: 8, religious: 8 };
  const heightOf = (p) => { const h = Number(p.height); if (h > 0) return h; const l = Number(p['building:levels']); if (l > 0) return l * 3.2 + 0.6; return KINDS[p.building] ?? 7; };
  const buildings = built.filter((f) => f.properties.kind === 'building').map((f) => { let ring = f.geometry.coordinates[0].map(at); if (ring.length > 1 && ring[0][0] === ring.at(-1)[0] && ring[0][1] === ring.at(-1)[1]) ring = ring.slice(0, -1); return { id: String(f.id), ring, height: heightOf(f.properties), heightFrom: Number(f.properties.height) > 0 ? 1 : Number(f.properties['building:levels']) > 0 ? 2 : 0, cls: String(f.properties.building ?? 'yes'), seed: seedOf(f.id) }; }).filter((b) => b.ring.length >= 3);
  const trees = built.filter((f) => f.properties.kind === 'tree').map((f) => { const [x, z] = at(f.geometry.coordinates), h = Number(f.properties.height); return { id: String(f.id), x, z, height: h > 0 ? h : 9, crown: Number(f.properties.diameter_crown) > 0 ? Number(f.properties.diameter_crown) / 2 : 3, seed: seedOf(f.id) }; });
  const ringArea = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a / 2); };
  const parks = built.filter((f) => f.properties.kind === 'park').map((f) => { const ring = f.geometry.coordinates[0].map(at); return { name: '', group: String(f.properties.group ?? 'park'), area: Math.round(ringArea(ring)), ring }; });
  const inputs = { buildings, trees, roads: [], parks, water: [], streams: [], furniture: [], sources: { buildings: { title: 'OpenStreetMap buildings', licence: 'ODbL © OpenStreetMap contributors' }, trees: { title: 'OpenStreetMap trees', licence: 'ODbL © OpenStreetMap contributors' } }, attribution: ODBL };
  const bake = bakeBuilt({ pieces: solved.pieces, reserve: solved.verge.R, clamp: solved.clamp, inputs, stages: solved.report.stages, options: { place: 'kuta', snapshots: false } });
  const gs = bake.gates;
  console.log(`kuta built: buildings ${gs[1].counts.buildings}/${gs[1].counts.source} (clipped ${gs[1].counts.clipped}, set back ${gs[1].counts.setback}, left out ${gs[1].counts.omittedPieces}) · trees ${gs[2].counts.trees}/${gs[2].counts.source} (nudged ${gs[2].counts.nudged}, left out ${gs[2].counts.omittedPieces}) · gates ${gs.map((g) => `${g.stage}:${g.ok ? 'ok' : 'FAIL'}`).join(' ')} (${took()})`);
  for (const g of gs) for (const p of g.patches ?? []) if (p.ids.length > 20) { p.moved = { ...p.moved, idsListed: 20, ids: p.ids.length }; p.ids = p.ids.slice(0, 20); }
  const dir = join(OUT, 'kuta'); rmSync(dir, { recursive: true, force: true });
  const out = writeTiles(dir, { origin, bbox: doc.bbox, attribution: doc.attribution, ground: hd.source, sources: roadSources(hd.source), solved });
  const tiles = builtTiles({ placement: bake, ground: inputs, origin, bbox: doc.bbox, attribution: inputs.attribution, sources: inputs.sources, gates: gs });
  let bytes = writeJson(join(dir, 'built', 'index.json'), tiles.index); for (const [k, t] of tiles.tiles) bytes += writeJson(join(dir, 'built', `${k}.json`), t);
  console.log(`kuta pack: ${out.tiles} road tiles ${(out.bytes / 1e6).toFixed(2)} MB · placement ${(bytes / 1e6).toFixed(2)} MB (${took()})`);
}

// ── the car's routes: the quickest way by road class (km/h), one-way streets their way only ──
const SPEED = { motorway: 100, motorway_link: 60, trunk: 80, trunk_link: 50, primary: 60, primary_link: 40, secondary: 50, secondary_link: 35, tertiary: 40, tertiary_link: 30, unclassified: 35, residential: 30, living_street: 15, road: 30, service: 20 };
const ONEWAY = (p) => { const o = String(p.oneway ?? '').toLowerCase(); if (['yes', '1', 'true'].includes(o)) return 1; if (['-1', 'reverse'].includes(o)) return -1; if (['no', '0', 'false'].includes(o)) return 0; return p.junction === 'roundabout' || p.junction === 'circular' || p.highway === 'motorway' ? 1 : 0; };
const metres = (a, b) => Math.hypot((a[0] - b[0]) * kxOf((a[1] + b[1]) / 2), (a[1] - b[1]) * KZ);
/** a route's points with the speed each piece is driven at (its road's class: the nearest way to its middle), slower
 *  through a turn (a corner of θ: at most 60 km/h × (1 − θ / 180°), 12 km/h at the least) */
function drive(name, features, from, to) {
  const lines = features.filter((f) => f.geometry?.type === 'LineString' && SPEED[f.properties.highway]).map((f) => ({ line: f.geometry.coordinates, props: { kmh: SPEED[f.properties.highway], way: ONEWAY(f.properties), hw: f.properties.highway } }));
  const net = network({ lines, cost: (m, p) => m / (p.kmh / 3.6), oneway: (p) => p.way, snap: 1 });
  const r = net.route(from, to, { max: 400 });
  if (!r) throw new Error(`${name}: no route from ${from} to ${to}`);
  // (each piece's road: the nearest line's class, from a grid of the lines' pieces)
  const grid = new Map(), C = 0.0005, key = (lon, lat) => `${Math.floor(lon / C)}_${Math.floor(lat / C)}`;
  for (const l of lines) for (let i = 0; i + 1 < l.line.length; i++) { const k = key((l.line[i][0] + l.line[i + 1][0]) / 2, (l.line[i][1] + l.line[i + 1][1]) / 2); let g = grid.get(k); if (!g) grid.set(k, (g = [])); g.push([l.line[i], l.line[i + 1], l.props.kmh]); }
  const segDist = (p, a, b) => { const kx = kxOf(p[1]), ax = (a[0] - p[0]) * kx, ay = (a[1] - p[1]) * KZ, bx = (b[0] - p[0]) * kx, by = (b[1] - p[1]) * KZ, dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, -(ax * dx + ay * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(ax + t * dx, ay + t * dy); };
  const kmhAt = (p) => { let best = 30, bd = Infinity; const [cx, cy] = [Math.floor(p[0] / C), Math.floor(p[1] / C)]; for (let x = cx - 1; x <= cx + 1; x++) for (let y = cy - 1; y <= cy + 1; y++) for (const [a, b, k] of grid.get(`${x}_${y}`) ?? []) { const d = segDist(p, a, b); if (d < bd) { bd = d; best = k; } } return best; };
  const line = r.line.filter((p, i, a) => i === 0 || metres(p, a[i - 1]) > 0.5).map((p) => [Math.round(p[0] * 1e7) / 1e7, Math.round(p[1] * 1e7) / 1e7]);
  const kmh = line.slice(0, -1).map((p, i) => kmhAt([(p[0] + line[i + 1][0]) / 2, (p[1] + line[i + 1][1]) / 2]));
  // through the corners: slower (the sharper the turn, the slower), eased over the pieces either side
  for (let i = 1; i + 1 < line.length; i++) {
    const a = line[i - 1], b = line[i], c = line[i + 1], h1 = Math.atan2((b[0] - a[0]) * kxOf(b[1]), (b[1] - a[1]) * KZ), h2 = Math.atan2((c[0] - b[0]) * kxOf(b[1]), (c[1] - b[1]) * KZ);
    let turn = Math.abs(h2 - h1) / RAD; if (turn > 180) turn = 360 - turn;
    if (turn > 25) { const v = Math.max(12, 60 * (1 - turn / 180)); kmh[i - 1] = Math.min(kmh[i - 1], v); kmh[i] = Math.min(kmh[i], v); }
  }
  let m = 0; for (let i = 0; i + 1 < line.length; i++) m += metres(line[i], line[i + 1]);
  let s = 0; for (let i = 0; i + 1 < line.length; i++) s += metres(line[i], line[i + 1]) / (kmh[i] / 3.6);
  console.log(`${name}: ${line.length} points, ${(m / 1000).toFixed(1)} km, ${(s / 60).toFixed(1)} min (${took()})`);
  return { line, kmh, metres: Math.round(m), seconds: Math.round(s) };
}
/** a plane's way on the ground: over the taxiways (both ways), from a stand to a runway's end */
function taxi(name, features, from, to) {
  const lines = features.filter((f) => f.geometry?.type === 'LineString' && ['taxiway', 'taxilane'].includes(f.properties.aeroway)).map((f) => ({ line: f.geometry.coordinates, props: {} }));
  const net = network({ lines, snap: 2 });
  const r = net.route(from, to, { max: 400 });
  if (!r) throw new Error(`${name}: no taxi way from ${from} to ${to}`);
  const line = r.line.filter((p, i, a) => i === 0 || metres(p, a[i - 1]) > 0.5).map((p) => [Math.round(p[0] * 1e7) / 1e7, Math.round(p[1] * 1e7) / 1e7]);
  let m = 0; for (let i = 0; i + 1 < line.length; i++) m += metres(line[i], line[i + 1]);
  console.log(`${name}: taxi ${line.length} points, ${Math.round(m)} m`);
  return { line, metres: Math.round(m) };
}

// ── the trip: where the car starts and stops, the plane's stands and runways ──
const mel = { roads: read('mel.roads.geojson').features, airport: read('mel.airport.geojson').features };
const dps = { roads: read('dps.roads.geojson').features, airport: read('dps.airport.geojson').features };
const runwayOf = (features, ref) => { const f = features.find((x) => x.properties.aeroway === 'runway' && x.properties.ref === ref && x.geometry.type === 'LineString'); if (!f) throw new Error(`no runway ${ref}`); const c = f.geometry.coordinates; return [c[0], c.at(-1)]; };
const PLACES = {
  // the car: from the city's north-west (King and La Trobe streets) to the international terminal's departures; the
  // plane from its stand at the international pier to runway 27's threshold (east end: the take-off rolls west)
  mel: { from: [144.9551, -37.8126], to: [144.8466, -37.6688], stand: [144.8440, -37.6668], runway: '09/27', takeoff: 'east' },
  // the plane lands on runway 09 from the west (over the sea), taxis to the international apron; the car from the
  // international arrivals to Kuta's beach road (Jalan Pantai Kuta, one way north along the beach)
  dps: { stand: [115.1680, -8.7457], runway: '09/27', landing: 'west', from: [115.1678, -8.7424], to: [115.16956, -8.72075] },
};
const journey = { v: 1, attribution: ODBL, places: PLACES, drives: {}, taxi: {}, runways: {} };
journey.drives.mel = drive('mel drive', mel.roads, PLACES.mel.from, PLACES.mel.to);
journey.drives.dps = drive('dps drive', dps.roads, PLACES.dps.from, PLACES.dps.to);
{
  const [w, e] = runwayOf(mel.airport, '09/27'), [a, b] = w[0] < e[0] ? [w, e] : [e, w];
  // (runway 27: from its east threshold west)
  journey.runways.mel = { from: b, to: a, heading: Math.round(Math.atan2((a[0] - b[0]) * kxOf(b[1]), (a[1] - b[1]) * KZ) / RAD * 10) / 10, metres: Math.round(metres(a, b)) };
  journey.taxi.mel = taxi('mel', mel.airport, PLACES.mel.stand, b);
}
{
  const [w, e] = runwayOf(dps.airport, '09/27'), [a, b] = w[0] < e[0] ? [w, e] : [e, w];
  // (runway 09: from its west threshold east)
  journey.runways.dps = { from: a, to: b, heading: Math.round(Math.atan2((b[0] - a[0]) * kxOf(a[1]), (b[1] - a[1]) * KZ) / RAD * 10) / 10, metres: Math.round(metres(a, b)) };
  // (the taxi in: from where the landing roll ends, 2.2 km down the runway, to the stand)
  const t = Math.min(1, 2200 / metres(a, b)), end = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  journey.taxi.dps = taxi('dps', dps.airport, end, PLACES.dps.stand);
}
console.log(`runways: MEL 27 heading ${journey.runways.mel.heading}° ${journey.runways.mel.metres} m · DPS 09 heading ${journey.runways.dps.heading}° ${journey.runways.dps.metres} m`);
writeJson(join(OUT, 'journey.json'), journey);

// ── the airports (their parts, no names) and the coast round Kuta and the airport ──
const near = (f, box) => { const g = f.geometry, pts = g.type === 'LineString' ? g.coordinates : g.type === 'Polygon' ? g.coordinates[0] : g.type === 'MultiPolygon' ? g.coordinates.flatMap((p) => p[0]) : []; return pts.some(([x, y]) => x >= box[0] && x <= box[2] && y >= box[1] && y <= box[3]); };
// (each airport's own: what stands inside its aerodrome's outline (the houses beyond its fence left out), its parts)
const AIRPORTS = { mel: [144.815, -37.700, 144.865, -37.645], dps: [115.150, -8.756, 115.188, -8.739] };
const ringsOf = (f) => (f.geometry.type === 'Polygon' ? [f.geometry.coordinates[0]] : f.geometry.type === 'MultiPolygon' ? f.geometry.coordinates.map((p) => p[0]) : []);
const inRing = (r, x, y) => { let c = false; for (let a = 0, b = r.length - 1; a < r.length; b = a++) { const [xa, ya] = r[a], [xb, yb] = r[b]; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c; } return c; };
const middle = (f) => { const r = ringsOf(f)[0] ?? f.geometry.coordinates; const n = r.length; return [r.reduce((a, p) => a + p[0], 0) / n, r.reduce((a, p) => a + p[1], 0) / n]; };
const own = (list, box, name) => {
  const fence = list.filter((f) => f.properties.aeroway === 'aerodrome').flatMap(ringsOf);
  const kept = list.filter((f) => f.properties.aeroway !== 'aerodrome' && near(f, box) && (!fence.length || f.properties.aeroway || fence.some((r) => inRing(r, ...middle(f)))));
  console.log(`${name} airport: ${kept.length} of ${list.length} parts and buildings inside its fence (${fence.length} outline${fence.length === 1 ? '' : 's'})`);
  return kept.map((f) => ({ ...f, properties: { ...f.properties, airport: name } }));
};
const airportFeatures = [...own(mel.airport, AIRPORTS.mel, 'mel'), ...own(dps.airport, AIRPORTS.dps, 'dps')];
const ab = writeJson(join(OUT, 'airports.geojson'), { type: 'FeatureCollection', attribution: ODBL, features: airportFeatures });
const cb = writeJson(join(OUT, 'coast.geojson'), { type: 'FeatureCollection', attribution: ODBL, features: coast.features });
console.log(`airports: ${airportFeatures.length} features ${(ab / 1e6).toFixed(2)} MB · coast: ${coast.features.length} features ${(cb / 1e6).toFixed(2)} MB (${took()})`);
