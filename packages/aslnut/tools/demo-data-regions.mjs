// More demo data, made once from open data already in the data folder (never in git):
//   · Java's provinces (6) and regencies / cities (119): Badan Informasi Geospasial (BIG), Batas Wilayah, simplified
//     (data/geo/idn-provinces.json, data/geo/java-kabkota.json);
//   · districts: MOCK. Each regency is cut into 4–12 cells round seeded points (Voronoi cells clipped to its border);
//     their names and numbers are made up, marked `mock: true`;
//   · the world's countries (Natural Earth 1:50m, public domain; data/geo/world-countries.json).
//   node tools/demo-data-regions.mjs → data/packs/demo/java-{provinces,regencies,districts}.geojson, world-countries.geojson
import { readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { contains } from '../src/index.ts';

const DATA = join(import.meta.dirname, '..', '..', '..', 'data'), OUT = join(DATA, 'packs', 'demo');
mkdirSync(OUT, { recursive: true });
const JAVA = ['31', '32', '33', '34', '35', '36'];
const r6 = (v) => Math.round(v * 1e5) / 1e5;
// { name, code, rings: [[x, y, x, y, …], …] } → a MultiPolygon (each ring its own polygon: islands)
const geomOf = (l) => ({ type: 'MultiPolygon', coordinates: l.rings.filter((r) => r.length >= 8).map((r) => { const ring = []; for (let i = 0; i + 1 < r.length; i += 2) ring.push([r6(r[i]), r6(r[i + 1])]); const a = ring[0], b = ring[ring.length - 1]; if (a[0] !== b[0] || a[1] !== b[1]) ring.push([...a]); return [ring]; }) });
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
const simpG = (g, tol) => ({ type: 'MultiPolygon', coordinates: g.coordinates.map((p) => p.map((r) => simplify(r, tol))) });
const fc = (features, attribution) => ({ type: 'FeatureCollection', attribution, features });
const BIG = 'Badan Informasi Geospasial (BIG), Batas Wilayah';

const prov = JSON.parse(readFileSync(join(DATA, 'geo', 'idn-provinces.json'), 'utf8')).layers.filter((l) => JAVA.includes(l.code));
const provinces = prov.map((l) => ({ type: 'Feature', id: l.code, properties: { code: l.code, name: l.name }, geometry: simpG(geomOf(l), 250) }));
const kab = JSON.parse(readFileSync(join(DATA, 'geo', 'java-kabkota.json'), 'utf8')).layers;
const regencies = kab.map((l) => ({ type: 'Feature', id: l.code, properties: { code: l.code, name: l.name, province: l.code.split('.')[0], kota: !!l.kota }, geometry: simpG(geomOf(l), 120) }));

// ── mock districts: seeded Voronoi cells clipped to each regency ─────────────────────────────────────────────────
function rng(seed) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
const hash = (t) => { let h = 2166136261; for (let i = 0; i < t.length; i++) h = Math.imul(h ^ t.charCodeAt(i), 16777619); return h >>> 0; };
/** keep the part of a ring on the side of the half plane n·p <= c (Sutherland–Hodgman, one edge) */
function clip(ring, nx, ny, c) {
  const out = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const a = ring[i], b = ring[i + 1], da = nx * a[0] + ny * a[1] - c, db = nx * b[0] + ny * b[1] - c;
    if (da <= 0) out.push(a);
    if ((da <= 0) !== (db <= 0)) { const t = da / (da - db); out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]); }
  }
  if (out.length >= 3) out.push([...out[0]]);
  return out.length >= 4 ? out : null;
}
const area = (ring) => { let s = 0; for (let i = 0; i < ring.length - 1; i++) s += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]; return Math.abs(s / 2); };
const SIDES = ['Utara', 'Selatan', 'Timur', 'Barat', 'Tengah', 'Kidul', 'Wetan', 'Kulon', 'Hilir', 'Hulu', 'Pesisir', 'Gunung'];
const districts = [];
for (const r of regencies) {
  const polys = r.geometry.coordinates, rand = rng(hash(r.id));
  const b = [Infinity, Infinity, -Infinity, -Infinity];
  for (const p of polys) for (const q of p[0]) { b[0] = Math.min(b[0], q[0]); b[1] = Math.min(b[1], q[1]); b[2] = Math.max(b[2], q[0]); b[3] = Math.max(b[3], q[1]); }
  const big = polys.reduce((a, p) => a + area(p[0]), 0), k = Math.max(4, Math.min(12, Math.round(big / 0.012) + (r.properties.kota ? 0 : 3)));
  const seeds = [];
  for (let tries = 0; seeds.length < k && tries < 4000; tries++) { const s = [b[0] + rand() * (b[2] - b[0]), b[1] + rand() * (b[3] - b[1])]; if (contains(r.geometry, s)) seeds.push(s); }
  seeds.forEach((s, i) => {
    const parts = [];
    for (const p of polys) {
      let ring = p[0];
      for (let j = 0; j < seeds.length && ring; j++) { if (j === i) continue; const o = seeds[j], nx = o[0] - s[0], ny = o[1] - s[1]; ring = clip(ring, nx, ny, nx * (s[0] + o[0]) / 2 + ny * (s[1] + o[1]) / 2); }
      if (ring && area(ring) > 1e-6) parts.push([ring.map((q) => [r6(q[0]), r6(q[1])])]);
    }
    if (!parts.length) return;
    const short = r.properties.name.replace(/^(Kab\.|Kota Adm\.|Kota)\s+/, '');
    districts.push({ type: 'Feature', id: `${r.id}.${String(i + 1).padStart(2, '0')}`, properties: { code: `${r.id}.${String(i + 1).padStart(2, '0')}`, name: `${short} ${SIDES[i % SIDES.length]}${i >= SIDES.length ? ` ${Math.floor(i / SIDES.length) + 1}` : ''}`, regency: r.id, province: r.properties.province, mock: true }, geometry: { type: 'MultiPolygon', coordinates: parts } });
  });
}

// ── the world's countries ─────────────────────────────────────────────────────────────────────────────────────────
const wc = JSON.parse(readFileSync(join(DATA, 'geo', 'world-countries.json'), 'utf8'));
const countries = (wc.layers ?? []).map((l, i) => ({ type: 'Feature', id: l.code ?? l.iso ?? String(i), properties: { name: l.name, code: l.code ?? String(i), pop: l.pop ?? null }, geometry: geomOf(l) }));

writeFileSync(join(OUT, 'java-provinces.geojson'), JSON.stringify(fc(provinces, `${BIG} (simplified)`)));
writeFileSync(join(OUT, 'java-regencies.geojson'), JSON.stringify(fc(regencies, `${BIG}, Kabupaten / Kota 1:50.000 (simplified)`)));
writeFileSync(join(OUT, 'java-districts.geojson'), JSON.stringify(fc(districts, 'mock districts (cells inside BIG regency borders)')));
writeFileSync(join(OUT, 'world-countries.geojson'), JSON.stringify(fc(countries, 'Natural Earth (public domain)')));
for (const f of ['java-provinces.geojson', 'java-regencies.geojson', 'java-districts.geojson', 'world-countries.geojson']) console.log(f, (statSync(join(OUT, f)).size / 1e6).toFixed(2), 'MB');
console.log(`${provinces.length} provinces · ${regencies.length} regencies · ${districts.length} mock districts · ${countries.length} countries`);
// the world's cities (Natural Earth populated places, public domain, + Indonesia's province capitals), as they are
writeFileSync(join(OUT, 'world-cities.json'), readFileSync(join(DATA, 'geo', 'cities.json')));
