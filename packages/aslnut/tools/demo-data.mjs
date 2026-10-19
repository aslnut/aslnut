// The demo data, made once from open data already in the data folder (never in git): Greater Melbourne's suburbs
// (Vicmap localities) and councils (LGAs), clipped to the metro area, simplified to ~30 m (councils ~90 m), each suburb with its
// council; as GeoJSON and as a PMTiles archive (MVT, z8–13) so the examples show both sources.
//   node tools/demo-data.mjs   → data/packs/demo/melbourne-{suburbs,lgas}.geojson, melbourne-suburbs.pmtiles
// Sources (CC BY 4.0, © State of Victoria, Vicmap Admin): data/geo/raw/vic-ad_{locality,lga}_area_polygon.geojson
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { encodeMVT, PMTilesWriter, contains, centreOf } from '../src/index.ts';

const DATA = join(import.meta.dirname, '..', '..', '..', 'data'), OUT = join(DATA, 'packs', 'demo');
mkdirSync(OUT, { recursive: true });
const BOX = [144.55, -38.2, 145.45, -37.55];
const inBox = (b) => b[0] < BOX[2] && b[2] > BOX[0] && b[1] < BOX[3] && b[3] > BOX[1];
const bbox = (g) => { const b = [Infinity, Infinity, -Infinity, -Infinity]; const add = (p) => { b[0] = Math.min(b[0], p[0]); b[1] = Math.min(b[1], p[1]); b[2] = Math.max(b[2], p[0]); b[3] = Math.max(b[3], p[1]); }; (g.type === 'Polygon' ? [g.coordinates] : g.coordinates).forEach((p) => p.forEach((r) => r.forEach(add))); return b; };
// Douglas–Peucker in metres (local equirectangular)
function simplify(r, tol) {
  if (r.length < 5) return r;
  const k = 111320 * Math.cos(r[0][1] * Math.PI / 180), P = r.map((p) => [p[0] * k, p[1] * 110574]);
  const keep = new Uint8Array(r.length); keep[0] = keep[r.length - 1] = 1;
  // a closed ring: split at the point farthest from its start
  let far = 1, fd = 0; for (let i = 1; i < r.length - 1; i++) { const d = Math.hypot(P[i][0] - P[0][0], P[i][1] - P[0][1]); if (d > fd) { fd = d; far = i; } }
  keep[far] = 1;
  const st = [[0, far], [far, r.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let m = -1, md = tol;
    const [ax, ay] = P[a], [bx, by] = P[b], dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
    for (let i = a + 1; i < b; i++) { const d = Math.abs(dy * (P[i][0] - ax) - dx * (P[i][1] - ay)) / L; if (d > md) { md = d; m = i; } }
    if (m > 0) { keep[m] = 1; st.push([a, m], [m, b]); }
  }
  const out = r.filter((_, i) => keep[i]).map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]);
  return out.length >= 4 ? out : r.map((p) => [+p[0].toFixed(6), +p[1].toFixed(6)]);
}
const simp = (g, tol) => ({ type: g.type, coordinates: g.type === 'Polygon' ? g.coordinates.map((r) => simplify(r, tol)) : g.coordinates.map((p) => p.map((r) => simplify(r, tol))) });
const title = (s) => s.toLowerCase().replace(/\b[a-z]/g, (c) => c.toUpperCase()).replace(/ \(Vic\)$/i, '');

const lgaRaw = JSON.parse(readFileSync(join(DATA, 'geo', 'raw', 'vic-ad_lga_area_polygon.geojson'), 'utf8')).features;
const lgas = lgaRaw.filter((f) => f.properties.state === 'VIC' && f.geometry && inBox(bbox(f.geometry))).map((f) => ({ type: 'Feature', id: String(f.properties.pfi), properties: { name: title(f.properties.name) }, geometry: simp(f.geometry, 90) }));
const locRaw = JSON.parse(readFileSync(join(DATA, 'geo', 'raw', 'vic-ad_locality_area_polygon.geojson'), 'utf8')).features;
const suburbs = [];
for (const f of locRaw) {
  if (f.properties.state !== 'VIC' || !f.geometry) continue;
  const b = bbox(f.geometry); if (!inBox(b) || b[0] < BOX[0] - 0.05 || b[2] > BOX[2] + 0.05 || b[1] < BOX[1] - 0.05 || b[3] > BOX[3] + 0.05) continue;
  const g = simp(f.geometry, 30), c = centreOf(g), lga = c ? lgas.find((l) => contains(l.geometry, c)) : null;
  if (!lga) continue;
  suburbs.push({ type: 'Feature', id: String(f.properties.pfi), properties: { code: String(f.properties.pfi), name: title(f.properties.name), lga: lga.id, lga_name: lga.properties.name }, geometry: g });
}
const used = new Set(suburbs.map((s) => s.properties.lga));
const metroLgas = lgas.filter((l) => used.has(l.id));
const fc = (features) => ({ type: 'FeatureCollection', attribution: '© State of Victoria (Vicmap Admin), CC BY 4.0', features });
writeFileSync(join(OUT, 'melbourne-suburbs.geojson'), JSON.stringify(fc(suburbs)));
writeFileSync(join(OUT, 'melbourne-lgas.geojson'), JSON.stringify(fc(metroLgas)));
// the same suburbs as vector tiles in one PMTiles file
const w = new PMTilesWriter({ tileType: 1, tileCompression: 2, metadata: { name: 'melbourne-suburbs', attribution: '© State of Victoria (Vicmap Admin), CC BY 4.0', vector_layers: [{ id: 'suburbs' }] }, bounds: BOX, center: [144.96, -37.81, 10] });
const feats = suburbs.map((s) => ({ id: Number(s.id), props: s.properties, geometry: s.geometry }));
let tiles = 0;
for (let z = 8; z <= 13; z++) {
  const k = 2 ** z, tx = (lon) => Math.floor(((lon + 180) / 360) * k), ty = (lat) => Math.floor((1 - Math.log(Math.tan(Math.PI / 4 + lat * Math.PI / 360)) / Math.PI) / 2 * k);
  for (let y = ty(BOX[3]); y <= ty(BOX[1]); y++) for (let x = tx(BOX[0]); x <= tx(BOX[2]); x++) {
    const n = 1 / k, w0 = x * n * 360 - 180, e0 = (x + 1) * n * 360 - 180;
    const lat = (yy) => (2 * Math.atan(Math.exp(Math.PI * (1 - 2 * yy / k))) - Math.PI / 2) * 180 / Math.PI, n0 = lat(y), s0 = lat(y + 1);
    const here = feats.filter((f) => { const b = bbox(f.geometry); return b[0] < e0 && b[2] > w0 && b[1] < n0 && b[3] > s0; });
    if (!here.length) continue;
    w.add(z, x, y, gzipSync(encodeMVT({ suburbs: here }, { z, x, y })));
    tiles++;
  }
}
writeFileSync(join(OUT, 'melbourne-suburbs.pmtiles'), await w.finish((b) => gzipSync(b)));
for (const f of ['melbourne-suburbs.geojson', 'melbourne-lgas.geojson', 'melbourne-suburbs.pmtiles']) console.log(f, (statSync(join(OUT, f)).size / 1e6).toFixed(2), 'MB');
console.log(`${suburbs.length} suburbs in ${metroLgas.length} councils · ${tiles} tiles`);
