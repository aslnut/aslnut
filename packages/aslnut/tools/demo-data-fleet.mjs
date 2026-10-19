// The EV fleet demo's data, made once (never in git): Melbourne's main roads (OpenStreetMap contributors, ODbL, via
// Overpass: data/osm/aus/melbourne-arterials.json) as a road graph (motorways and trunk roads drawn), and on it a MOCK fleet: 120 electric vehicles
// driving for three hours of a morning (random routes along real roads at each road's speed, stops at chargers), sampled
// every 20 s; and 36 mock chargers at road junctions.
//   node tools/demo-data-fleet.mjs → data/packs/demo/melbourne-{roads,fleet,chargers}.geojson
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(import.meta.dirname, '..', '..', '..', 'data'), OUT = join(DATA, 'packs', 'demo');
mkdirSync(OUT, { recursive: true });
const BOX = [144.75, -37.98, 145.2, -37.68];
const T0 = Date.UTC(2026, 9, 11, 19, 0, 0);   // 06:00 in Melbourne (AEDT), 12 Oct 2026
const HOURS = 3, STEP = 20;
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const rand = rng(2026);
const r6 = (v) => Math.round(v * 1e5) / 1e5;
const metres = (a, b) => { const k = Math.cos(((a[1] + b[1]) / 2) * Math.PI / 180); return Math.hypot((b[0] - a[0]) * 111320 * k, (b[1] - a[1]) * 110574); };

const els = JSON.parse(readFileSync(join(DATA, 'osm', 'aus', 'melbourne-arterials.json'), 'utf8')).elements.filter((e) => e.type === 'way' && e.geometry && e.nodes);
const inBox = (p) => p[0] > BOX[0] && p[0] < BOX[2] && p[1] > BOX[1] && p[1] < BOX[3];
// the graph: nodes (OSM ids) with their place, edges along ways (both ways unless oneway), each with its speed
const place = new Map(), adj = new Map();
const SPEED = { motorway: 90, trunk: 70, primary: 55, secondary: 45, motorway_link: 50, trunk_link: 40 };
const roads = [];
for (const w of els) {
  const hw = w.tags?.highway; if (!SPEED[hw]) continue;
  const pts = w.geometry.map((g) => [g.lon, g.lat]);
  if (!pts.some(inBox)) continue;
  const v = Number.parseFloat(w.tags.maxspeed) || SPEED[hw], one = w.tags.oneway === 'yes' || hw === 'motorway';
  w.nodes.forEach((n, i) => place.set(n, pts[i]));
  for (let i = 0; i + 1 < w.nodes.length; i++) {
    const a = w.nodes[i], b = w.nodes[i + 1], len = metres(pts[i], pts[i + 1]);
    (adj.get(a) ?? adj.set(a, []).get(a)).push({ to: b, len, v });
    if (!one) (adj.get(b) ?? adj.set(b, []).get(b)).push({ to: a, len, v });
  }
  if (hw === 'motorway' || hw === 'trunk') roads.push({ type: 'Feature', id: w.id, properties: { kind: hw, name: w.tags.name ?? '' }, geometry: { type: 'LineString', coordinates: pts.map((p) => [r6(p[0]), r6(p[1])]) } });
}
const nodes = [...adj.keys()].filter((n) => inBox(place.get(n)) && adj.get(n).length > 0);
const junctions = nodes.filter((n) => adj.get(n).length >= 3);
// chargers at junctions spread over the area
const chargers = [];
for (let tries = 0; chargers.length < 36 && tries < 5000; tries++) {
  const n = junctions[Math.floor(rand() * junctions.length)], p = place.get(n);
  if (chargers.some((c) => metres(c.p, p) < 2500)) continue;
  chargers.push({ n, p });
}
const KINDS = ['taxi', 'delivery', 'rideshare', 'bus'];
const fleet = [];
for (let v = 0; v < 120; v++) {
  let n = nodes[Math.floor(rand() * nodes.length)], prev = null, t = 0, battery = 40 + rand() * 55;
  const kind = KINDS[v % KINDS.length], coords = [], times = [], soc = [];
  let pos = place.get(n), edge = null, along = 0;
  const pace = 0.7 + rand() * 0.35;   // traffic: a share of the road's speed
  for (t = 0; t <= HOURS * 3600; t += STEP) {
    coords.push([r6(pos[0]), r6(pos[1])]); times.push(t); soc.push(Math.round(battery));
    let left = STEP;
    while (left > 0) {
      if (!edge) {
        const out = adj.get(n) ?? []; if (!out.length) break;
        const fwd = out.filter((e) => e.to !== prev), pick = (fwd.length ? fwd : out);
        edge = pick[Math.floor(rand() * pick.length)]; along = 0;
      }
      const speed = (edge.v / 3.6) * pace, need = (edge.len - along) / speed;
      if (need > left) { along += speed * left; left = 0; }
      else { left -= need; prev = n; n = edge.to; edge = null; along = 0; battery -= 0.0012 * (need * speed / 1000) * 100 / 6; }
      if (battery < 15 && !edge) { const c = chargers.find((c) => c.n === n); if (c) { battery = 92; left = 0; } }
    }
    if (edge) { const a = place.get(n), b = place.get(edge.to), k = edge.len > 0 ? along / edge.len : 0; pos = [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k]; }
    else pos = place.get(n);
    battery = Math.max(3, battery);
  }
  fleet.push({ type: 'Feature', id: `ev${String(v + 1).padStart(3, '0')}`, properties: { id: `ev${String(v + 1).padStart(3, '0')}`, kind, t0: T0, dt: times, soc }, geometry: { type: 'LineString', coordinates: coords } });
}
const fc = (features, attribution) => ({ type: 'FeatureCollection', attribution, features });
writeFileSync(join(OUT, 'melbourne-roads.geojson'), JSON.stringify(fc(roads, '© OpenStreetMap contributors (ODbL)')));
writeFileSync(join(OUT, 'melbourne-fleet.geojson'), JSON.stringify(fc(fleet, 'mock fleet on OpenStreetMap roads')));
writeFileSync(join(OUT, 'melbourne-chargers.geojson'), JSON.stringify(fc(chargers.map((c, i) => ({ type: 'Feature', id: `ch${i + 1}`, properties: { id: `ch${i + 1}`, name: `Charger ${i + 1}`, kw: [22, 50, 75, 150, 350][i % 5], ports: 2 + (i % 4) }, geometry: { type: 'Point', coordinates: [r6(c.p[0]), r6(c.p[1])] } })), 'mock chargers')));
for (const f of ['melbourne-roads.geojson', 'melbourne-fleet.geojson', 'melbourne-chargers.geojson']) console.log(f, (statSync(join(OUT, f)).size / 1e6).toFixed(2), 'MB');
console.log(`${roads.length} roads · ${nodes.length} nodes · ${fleet.length} vehicles × ${fleet[0].geometry.coordinates.length} samples · ${chargers.length} chargers`);
