// The recipes' world without the network (tools/smoke-recipes.mjs; the authoring guide's checks): every request a
// recipe or a model's script makes to a live service is answered here, the same on every run, and anything else from
// outside is refused and named (a check never depends on the network).
//   Esri's and OpenStreetMap's tiles     procedural pictures (a light grey map, imagery, OSM's beige)
//   Mapzen's Terrarium tiles             gentle hills (40–90 m), encoded as Terrarium
//   the Victorian GeoServer (WMS, WFS)   tools/ows-mock.mjs, the layers example's own mock service
//   the recipes' data files (data/…)     a district round the services' middle: streets with OSM tags, footprints,
//                                        trees, plots, districts and their statistics by year, a fleet's log (CSV)
//   a model (models/house.glb)           a CC0 house from the data folder when it is there, else a box
//   node tools/recipes-mock.mjs write <dir>    the data files into <dir>/data and the model into <dir>/models (a preview)
import { png } from './png.mjs';
import { answer, MIDDLE } from './ows-mock.mjs';
import { existsSync, mkdirSync, readFileSync, writeFileSync, cpSync } from 'node:fs';
import { join, resolve } from 'node:path';

const C = MIDDLE, KX = 111320 * Math.cos((C[1] * Math.PI) / 180), KY = 110574;
/** metres east and north of the middle → [lon, lat] */
const at = (x, y) => [+(C[0] + x / KX).toFixed(7), +(C[1] + y / KY).toFixed(7)];
const rng = (seed) => { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; };
const fc = (features) => JSON.stringify({ type: 'FeatureCollection', features });

// ── tiles ──
const tileBox = (z, x, y) => { const n = 2 ** z, lon = (x / n) * 360 - 180, lat = (t) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * t) / n))) * 180) / Math.PI; return [lon, lat(y + 1), ((x + 1) / n) * 360 - 180, lat(y)]; };
const LOOKS = { light: [226, 226, 222], dark: [52, 56, 62], imagery: [92, 112, 78], osm: [242, 239, 233], topo: [228, 232, 214] };
/** a 256 px picture of a tile: its look's colour, a soft pattern by place, a faint grid (so tiles differ and meet) */
function picture(look, z, x, y) {
  const [r0, g0, b0] = LOOKS[look] ?? LOOKS.light, [w, s, e, n] = tileBox(z, x, y), px = new Uint8Array(256 * 256 * 4);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const lon = w + ((i + 0.5) / 256) * (e - w), lat = n - ((j + 0.5) / 256) * (n - s), o = (j * 256 + i) * 4;
    const v = 10 * Math.sin(lon * 900) * Math.cos(lat * 700) + (i % 32 === 0 || j % 32 === 0 ? -8 : 0);
    px[o] = r0 + v; px[o + 1] = g0 + v; px[o + 2] = b0 + v; px[o + 3] = 255;
  }
  return png(256, 256, px);
}
/** heights in metres at a place: gentle hills */
const heightAt = (lon, lat) => 65 + 18 * Math.sin(lon * 140) * Math.cos(lat * 120) + 7 * Math.sin(lon * 610 + lat * 430);
function terrarium(z, x, y) {
  const [w, s, e, n] = tileBox(z, x, y), px = new Uint8Array(256 * 256 * 4);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
    const v = heightAt(w + ((i + 0.5) / 256) * (e - w), n - ((j + 0.5) / 256) * (n - s)) + 32768, o = (j * 256 + i) * 4;
    px[o] = Math.floor(v / 256); px[o + 1] = Math.floor(v) % 256; px[o + 2] = Math.floor((v % 1) * 256); px[o + 3] = 255;
  }
  return png(256, 256, px);
}

// ── the district (metres round the middle): a grid of streets, houses along them, a few offices, street trees ──
const STREETS = 5, STEP = 110, HALF = ((STREETS - 1) * STEP) / 2;
function district() {
  const roads = [], buildings = [], trees = [], r = rng(7);
  for (let k = 0; k < STREETS; k++) {
    const p = -HALF + k * STEP, main = k === 2, cls = main ? 'secondary' : 'residential';
    const ns = [], ew = []; for (let q = 0; q < STREETS; q++) { ns.push(at(p, -HALF + q * STEP)); ew.push(at(-HALF + q * STEP, p)); }
    roads.push({ type: 'Feature', id: `way/${k + 1}`, properties: { highway: cls, name: `${['First', 'Second', 'Main', 'Fourth', 'Fifth'][k]} Street`, lanes: main ? 4 : 2, sidewalk: 'both' }, geometry: { type: 'LineString', coordinates: ns } });
    roads.push({ type: 'Feature', id: `way/${k + 11}`, properties: { highway: main ? 'secondary' : 'residential', name: `${['Oak', 'Elm', 'High', 'Ash', 'Pine'][k]} Road`, lanes: main ? 4 : 2, sidewalk: 'both' }, geometry: { type: 'LineString', coordinates: ew } });
  }
  // each block: houses round its edge (fronts to their streets), an office in the blocks by the main roads
  let id = 1;
  for (let bx = 0; bx < STREETS - 1; bx++) for (let by = 0; by < STREETS - 1; by++) {
    const x0 = -HALF + bx * STEP + 18, y0 = -HALF + by * STEP + 18, x1 = x0 + STEP - 36, y1 = y0 + STEP - 36;
    if ((bx === 1 || bx === 2) && by === 1) {
      const ring = [[x0 + 8, y0 + 8], [x1 - 8, y0 + 8], [x1 - 8, y1 - 8], [x0 + 8, y1 - 8], [x0 + 8, y0 + 8]].map(([x, y]) => at(x, y));
      buildings.push({ type: 'Feature', id: `b${id++}`, properties: { building: 'commercial', 'building:levels': 5 + bx, name: `Office ${bx}` }, geometry: { type: 'Polygon', coordinates: [ring] } });
      continue;
    }
    for (const side of ['s', 'n', 'w', 'e']) for (let t = 0; t < 3; t++) {
      const along = 12 + t * 20, wd = 10 + r() * 3, dp = 11 + r() * 3;
      const cx = side === 's' || side === 'n' ? x0 + along : side === 'w' ? x0 + dp / 2 + 2 : x1 - dp / 2 - 2;
      const cy = side === 'w' || side === 'e' ? y0 + along : side === 's' ? y0 + dp / 2 + 2 : y1 - dp / 2 - 2;
      const [hw, hd] = side === 's' || side === 'n' ? [wd / 2, dp / 2] : [dp / 2, wd / 2];
      const ring = [[cx - hw, cy - hd], [cx + hw, cy - hd], [cx + hw, cy + hd], [cx - hw, cy + hd], [cx - hw, cy - hd]].map(([x, y]) => at(x, y));
      const front = { s: 180, n: 0, w: 270, e: 90 }[side];
      buildings.push({ type: 'Feature', id: `b${id++}`, properties: { building: 'house', height: r() < 0.3 ? 8.5 : 5.6, 'roof:shape': r() < 0.6 ? 'gabled' : 'hipped', front }, geometry: { type: 'Polygon', coordinates: [ring] } });
    }
  }
  // street trees: every 18 m along each street, 7 m off its centre line, on both sides
  for (let k = 0; k < STREETS; k++) for (let d = -HALF + 9; d < HALF; d += 18) for (const s of [-7, 7]) {
    const p = -HALF + k * STEP;
    if (Math.abs(((d + HALF) % STEP)) < 10 || Math.abs(((d + HALF) % STEP) - STEP) < 10) continue;
    trees.push({ type: 'Feature', id: `t${trees.length + 1}`, properties: { height: +(8 + r() * 7).toFixed(1), species: r() < 0.5 ? 'plane' : 'eucalypt' }, geometry: { type: 'Point', coordinates: at(p + s, d) } });
    trees.push({ type: 'Feature', id: `t${trees.length + 1}`, properties: { height: +(8 + r() * 7).toFixed(1), species: r() < 0.5 ? 'plane' : 'eucalypt' }, geometry: { type: 'Point', coordinates: at(d, p + s) } });
  }
  return { roads, buildings, trees };
}
/** plots for houses of your own: points along a street, each with its heading (to the street), width and levels */
function plots() {
  return Array.from({ length: 8 }, (_, i) => ({ type: 'Feature', id: `plot-${i + 1}`, properties: { heading: i < 4 ? 180 : 0, width: 9 + (i % 3) * 1.5, levels: 1 + (i % 2), model: i % 4 === 3 },
    geometry: { type: 'Point', coordinates: at(-60 + (i % 4) * 22, i < 4 ? 14 : -14) } }));
}
/** districts: a 6 × 5 grid of polygons over ~5 km, neighbours meeting exactly */
function districts() {
  const r = rng(3), nx = 6, ny = 5, w = -2600, s = -2000, dx = 5200 / nx, dy = 4000 / ny, P = [];
  for (let j = 0; j <= ny; j++) { P.push([]); for (let i = 0; i <= nx; i++) { const edge = i === 0 || j === 0 || i === nx || j === ny; P[j].push([w + i * dx + (edge ? 0 : (r() - 0.5) * dx * 0.4), s + j * dy + (edge ? 0 : (r() - 0.5) * dy * 0.4)]); } }
  const out = [];
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const ring = [P[j][i], P[j][i + 1], P[j + 1][i + 1], P[j + 1][i], P[j][i]].map(([x, y]) => at(x, y));
    out.push({ type: 'Feature', id: `D${j}${i}`, properties: { code: `D${j}${i}`, name: `${['North', 'Hill', 'Park', 'Lake', 'South'][j]} ${['West', 'Vale', 'Ridge', 'Centre', 'Brook', 'East'][i]}`, population: Math.round(4000 + 9000 * r()) }, geometry: { type: 'Polygon', coordinates: [ring] } });
  }
  return out;
}
/** a statistic per district for a year (rows keyed by code) */
const stats = (year) => districts().map((f, k) => { const r = rng(k * 31 + year); return { code: f.properties.code, rate: +(4 + 20 * r() + (year - 2020) * (k % 3 - 1) * 1.5).toFixed(1) }; });
/** a fleet's log: 24 vehicles round the district's blocks for 30 minutes, a sample every 5 s (id, time, lon, lat, charge) */
function trips() {
  const rows = ['vehicle,time,lon,lat,charge'], t0 = Date.UTC(2026, 9, 14, 22, 0, 0), r = rng(5);
  for (let v = 0; v < 24; v++) {
    const bx = v % (STREETS - 1), by = Math.floor(v / (STREETS - 1)) % (STREETS - 1), big = v % 3 === 0;
    const x0 = -HALF + bx * STEP, y0 = -HALF + by * STEP, x1 = x0 + STEP * (big ? 2 : 1), y1 = y0 + STEP;
    const loop = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], len = 2 * (x1 - x0 + y1 - y0), speed = 7 + r() * 6, off = r() * len, dir = v % 2 ? 1 : -1;
    let charge = 0.35 + r() * 0.6;
    for (let s = 0; s <= 1800; s += 5) {
      let d = (((off + dir * speed * s) % len) + len) % len, k = 0;
      while (true) { const a = loop[k], b = loop[(k + 1) % 4], l = Math.hypot(b[0] - a[0], b[1] - a[1]); if (d <= l) { const [lon, lat] = at(a[0] + ((b[0] - a[0]) * d) / l, a[1] + ((b[1] - a[1]) * d) / l); rows.push(`bus-${v + 1},${new Date(t0 + s * 1000).toISOString()},${lon},${lat},${charge.toFixed(3)}`); break; } d -= l; k++; }
      charge = Math.max(0.05, charge - 0.00012 * speed);
    }
  }
  return rows.join('\n');
}
/** a box 1 m a side as a .glb (when the data folder's CC0 house is not there) */
function boxGlb() {
  const P = [], q = (a, b, c, d) => P.push(...a, ...b, ...c, ...a, ...c, ...d), v = (x, y, z) => [x * 0.5, y * 0.5 + 0.5, z * 0.5];
  q(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)); q(v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)); q(v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1));
  q(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)); q(v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1)); q(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1));
  const pos = Buffer.from(new Float32Array(P).buffer), json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }], materials: [{ pbrMetallicRoughness: { baseColorFactor: [0.85, 0.82, 0.76, 1] } }], accessors: [{ bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3', min: [-0.5, 0, -0.5], max: [0.5, 1, 0.5] }], bufferViews: [{ buffer: 0, byteLength: pos.length }], buffers: [{ byteLength: pos.length }] };
  let j = Buffer.from(JSON.stringify(json)); j = Buffer.concat([j, Buffer.alloc((4 - (j.length % 4)) % 4, 32)]);
  const head = Buffer.alloc(12), jh = Buffer.alloc(8), bh = Buffer.alloc(8);
  head.writeUInt32LE(0x46546c67, 0); head.writeUInt32LE(2, 4); head.writeUInt32LE(12 + 8 + j.length + 8 + pos.length, 8);
  jh.writeUInt32LE(j.length, 0); jh.writeUInt32LE(0x4e4f534a, 4); bh.writeUInt32LE(pos.length, 0); bh.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([head, jh, j, bh, pos]);
}
const KIT = resolve(import.meta.dirname, '..', '..', '..', 'data', 'assets', 'buildings', 'kenney-city-kit-suburban');
/** the model files: models/house.glb (the kit's house when the data folder has it, else a box) and its textures */
function model(path) {
  if (existsSync(KIT)) { const f = path === 'house.glb' ? join(KIT, 'building-type-c.glb') : join(KIT, path); if (existsSync(f)) return { type: path.endsWith('.png') ? 'image/png' : 'model/gltf-binary', body: readFileSync(f) }; return null; }
  return path === 'house.glb' ? { type: 'model/gltf-binary', body: boxGlb() } : null;
}

/** the recipes' data files by name */
export function dataFile(name) {
  const d = district(), m = /^stats-(\d{4})\.json$/.exec(name);
  if (name === 'roads.geojson') return { type: 'application/json', body: fc(d.roads) };
  if (name === 'buildings.geojson') return { type: 'application/json', body: fc(d.buildings) };
  if (name === 'trees.geojson') return { type: 'application/json', body: fc(d.trees) };
  if (name === 'plots.geojson') return { type: 'application/json', body: fc(plots()) };
  if (name === 'districts.geojson') return { type: 'application/json', body: fc(districts()) };
  if (name === 'trips.csv') return { type: 'text/csv', body: trips() };
  if (m && Number(m[1]) >= 2019 && Number(m[1]) <= 2025) return { type: 'application/json', body: JSON.stringify(stats(Number(m[1]))) };
  return null;
}
export const DATA_FILES = ['roads.geojson', 'buildings.geojson', 'trees.geojson', 'plots.geojson', 'districts.geojson', 'trips.csv', ...[2019, 2020, 2021, 2022, 2023, 2024, 2025].map((y) => `stats-${y}.json`)];

/** one request answered (null: not the mock's, nor a live service's: let it through when it is the page's own) */
export function mockOf(url) {
  const u = new URL(url), p = u.pathname;
  let m;
  if (u.hostname === 'server.arcgisonline.com' && (m = /\/MapServer\/tile\/(\d+)\/(\d+)\/(\d+)/.exec(p))) {
    const look = /Light_Gray/.test(p) ? 'light' : /Dark_Gray/.test(p) ? 'dark' : /Topo|Street/.test(p) ? 'topo' : 'imagery';
    return { status: 200, type: 'image/png', body: picture(look, +m[1], +m[3], +m[2]) };
  }
  if (u.hostname === 'server.arcgisonline.com' && /\/export$/.test(p)) { const px = new Uint8Array(16 * 16 * 4); return { status: 200, type: 'image/png', body: png(16, 16, px) }; }
  if (/(^|\.)tile\.openstreetmap\.org$/.test(u.hostname) && (m = /\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(p))) return { status: 200, type: 'image/png', body: picture('osm', +m[1], +m[2], +m[3]) };
  if (u.hostname === 'tiles.maps.eox.at' && (m = /\/(\d+)\/(\d+)\/(\d+)\.jpg$/.exec(p))) return { status: 200, type: 'image/png', body: picture('imagery', +m[1], +m[3], +m[2]) };
  if (u.hostname === 's3.amazonaws.com' && (m = /\/terrarium\/(\d+)\/(\d+)\/(\d+)\.png$/.exec(p))) return { status: 200, type: 'image/png', body: terrarium(+m[1], +m[2], +m[3]) };
  if (u.hostname === 'opendata.maps.vic.gov.au' && (m = /\/geoserver(?:\/[\w-]+)?\/(wms|wfs|ows)$/i.exec(p))) {
    const svc = m[1].toLowerCase() === 'ows' ? (/wfs/i.test(u.searchParams.get('service') ?? u.searchParams.get('SERVICE') ?? '') ? 'wfs' : 'wms') : m[1].toLowerCase();
    const a = answer(`/aslnut/mock/ows/${svc}${u.search}`); return a && { status: a.status, type: a.type, body: a.body };
  }
  // (the page's data/ and models/ folders, however a script names them: 'data/x', './data/x', '/data/x')
  if ((m = /\/data\/([\w.-]+)$/.exec(p)) && !p.startsWith('/aslnut/data/')) { const f = dataFile(m[1]); if (f) return { status: 200, ...f }; if (/\/recipes\//.test(p)) return { status: 404, type: 'text/plain', body: 'no such file' }; }
  if ((m = /\/models\/(.+)$/.exec(p))) { const f = model(decodeURIComponent(m[1])); if (f) return { status: 200, ...f }; if (/\/recipes\//.test(p)) return { status: 404, type: 'text/plain', body: 'no such file' }; }
  return null;
}
/** a page's requests answered by the mocks; what comes from outside and is not mocked is refused and listed */
export async function route(page, local) {
  const outside = [];
  await page.route('**/*', (r) => {
    const url = r.request().url(), mock = (() => { try { return mockOf(url); } catch (e) { return { status: 500, type: 'text/plain', body: String(e.message) }; } })();
    if (mock) return r.fulfill({ status: mock.status, contentType: mock.type, body: mock.body, headers: { 'Access-Control-Allow-Origin': '*' } });
    if (url.startsWith(local) || url.startsWith('data:') || url.startsWith('blob:')) return r.continue();
    outside.push(url); return r.abort();
  });
  return outside;
}

if (import.meta.url === `file://${process.argv[1]}` && process.argv[2] === 'write') {
  const dir = process.argv[3]; if (!dir) throw new Error('node tools/recipes-mock.mjs write <dir>');
  mkdirSync(join(dir, 'data'), { recursive: true }); mkdirSync(join(dir, 'models'), { recursive: true });
  for (const f of DATA_FILES) writeFileSync(join(dir, 'data', f), dataFile(f).body);
  if (existsSync(KIT)) { writeFileSync(join(dir, 'models', 'house.glb'), readFileSync(join(KIT, 'building-type-c.glb'))); cpSync(join(KIT, 'Textures'), join(dir, 'models', 'Textures'), { recursive: true }); }
  else writeFileSync(join(dir, 'models', 'house.glb'), boxGlb());
  console.log(`wrote ${DATA_FILES.length} data files and the model into ${dir}`);
}
