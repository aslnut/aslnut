// The healthy-city example's region data, made from open data (never in git): Greater Melbourne's councils and
// suburbs (from tools/demo-data.mjs) with the numbers the statistics read, and the open space as points.
//   node tools/demo-data-city.mjs   → data/packs/city/{councils,suburbs}.geojson, open-space.geojson, sources.json
// Sources:
//   boundaries   © State of Victoria, Vicmap Admin (CC BY 4.0) · data/packs/demo/melbourne-{lgas,suburbs}.geojson
//   population   ABS Census 2021, G01 persons by LGA and by suburb (SAL) (CC BY 4.0) · data.api.abs.gov.au
//   open space   DataVic / VEAC Metropolitan open space (CC BY 4.0) · opendata.maps.vic.gov.au WFS veac_metro_open_space
//   cycling      Department of Transport and Planning, Bicycle infrastructure network (CC BY 4.0) · opendata.transport.vic.gov.au
//   heat         MOCK (the DataVic urban heat 2018 set is an order-only download): seeded, rises with built density
// Downloads are cached in data/raw-city/.
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { contains, centreOf, bboxOf, polygonsOf } from '../src/index.ts';
import { ringArea } from '../src/core/data/features.ts';

const DATA = join(import.meta.dirname, '..', '..', '..', 'data'), RAW = join(DATA, 'raw-city'), OUT = join(DATA, 'packs', 'city');
mkdirSync(RAW, { recursive: true }); mkdirSync(OUT, { recursive: true });
const D = Math.PI / 180;

async function cached(name, url, o = {}) {
  const f = join(RAW, name);
  if (existsSync(f)) return readFileSync(f, 'utf8');
  console.log('fetch', url.slice(0, 120));
  const r = await fetch(url, { headers: { 'User-Agent': 'aslnut-demo-data/0.1', ...(o.headers ?? {}) } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const t = await r.text(); writeFileSync(f, t); return t;
}
// names that changed since the census, and names Vicmap qualifies differently
const ALIAS = { 'merri bek': 'moreland', 'bellfield greater melbourne': 'bellfield banyule vic', 'hillside greater melbourne': 'hillside melton vic' };
const clean = (s) => { const k = String(s ?? '').toLowerCase().replace(/\s*\((vic\.?|c|s|rc|b|vic)\)\s*/g, ' ').replace(/[^a-z0-9]+/g, ' ').trim(); return ALIAS[k] ?? k; };

// ── boundaries ───────────────────────────────────────────────────────────────────────────────────────────────────
const lgas = JSON.parse(readFileSync(join(DATA, 'packs', 'demo', 'melbourne-lgas.geojson'), 'utf8')).features;
const suburbs = JSON.parse(readFileSync(join(DATA, 'packs', 'demo', 'melbourne-suburbs.geojson'), 'utf8')).features;
/** km² of a lon / lat polygon (local equirectangular per ring) */
const km2 = (g) => polygonsOf(g).reduce((a, rings) => a + rings.reduce((b, r, i) => { const k = 111.32 * Math.cos(r[0][1] * D); const s = Math.abs(ringArea(r.map((p) => [p[0] * k, p[1] * 110.574]))); return b + (i === 0 ? s : -s); }, 0), 0);
for (const f of [...lgas, ...suburbs]) f.properties.area_km2 = +km2(f.geometry).toFixed(3);

// ── population: ABS Census 2021 (persons), matched by name ───────────────────────────────────────────────────────
async function census(kind) {
  const csv = await cached(`abs-${kind}.csv`, `https://data.api.abs.gov.au/rest/data/ABS,C21_G01_${kind},1.0.0/3.P_1..${kind === 'LGA' ? 'LGA2021' : 'SAL'}.2`, { headers: { Accept: 'application/vnd.sdmx.data+csv' } });
  const struct = JSON.parse(await cached(`abs-${kind}-struct.json`, `https://data.api.abs.gov.au/rest/dataflow/ABS/C21_G01_${kind}/latest?references=all`, { headers: { Accept: 'application/vnd.sdmx.structure+json' } }));
  const cl = struct.data.codelists.find((c) => c.id === (kind === 'LGA' ? 'CL_LGA_2021' : 'CL_SAL_2021'));
  const name = new Map(cl.codes.map((c) => [c.id, c.name]));
  const out = new Map();
  for (const line of csv.trim().split('\n').slice(1)) { const c = line.split(','); const n = name.get(c[3]); if (n) out.set(clean(n), Number(c[7])); }
  return out;
}
const popL = await census('LGA'), popS = await census('SAL');
let mL = 0, mS = 0;
for (const f of lgas) { const p = popL.get(clean(f.properties.name)); if (p !== undefined) { f.properties.pop = p; mL++; } }
for (const f of suburbs) { const p = popS.get(clean(f.properties.name)); if (p !== undefined) { f.properties.pop = p; mS++; } }
console.log(`population: ${mL}/${lgas.length} councils, ${mS}/${suburbs.length} suburbs matched`);

// ── open space: VEAC metropolitan open space, every parcel as a point (its middle) with its hectares and group ───
async function openSpace() {
  const f = join(RAW, 'open-space-points.json');
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const pts = [];
  for (let start = 0; ; start += 4000) {
    const url = `https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform:veac_metro_open_space&outputFormat=application/json&count=4000&startIndex=${start}&sortBy=veac_id`;
    console.log('fetch open space from', start);
    const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`);
    const j = await r.json();
    for (const x of j.features) {
      const c = centreOf(x.geometry); if (!c) continue;
      const p = x.properties;
      pts.push({ id: p.veac_id, at: [+c[0].toFixed(6), +c[1].toFixed(6)], ha: +Number(p.ha ?? 0).toFixed(3), group: p.os_group ?? '', name: p.name && p.name !== 'NO DATA' ? p.name : '', owner: p.ownername_summary ?? '' });
    }
    if (j.features.length < 4000) break;
  }
  writeFileSync(f, JSON.stringify(pts));
  return pts;
}
const os = await openSpace();
console.log(`open space: ${os.length} parcels`);
writeFileSync(join(OUT, 'open-space.geojson'), JSON.stringify({ type: 'FeatureCollection', attribution: 'Open space © VEAC / State of Victoria, CC BY 4.0', features: os.map((p) => ({ type: 'Feature', id: p.id, properties: { ha: p.ha, group: p.group, name: p.name, owner: p.owner }, geometry: { type: 'Point', coordinates: p.at } })) }));

// ── cycling: km of bicycle infrastructure inside each area (each segment counted where its middle is) ────────────
const bike = JSON.parse(readFileSync(join(RAW, 'bicycle.geojson'), 'utf8')).features;
const index = (fs) => fs.map((f) => ({ f, b: bboxOf(f.geometry) }));
const inLga = index(lgas), inSub = index(suburbs);
const find = (list, p) => { for (const x of list) { const b = x.b; if (p[0] < b[0] || p[0] > b[2] || p[1] < b[1] || p[1] > b[3]) continue; if (contains(x.f.geometry, p)) return x.f; } return null; };
for (const f of [...lgas, ...suburbs]) f.properties.bike_km = 0;
let segs = 0;
for (const f of bike) {
  const g = f.geometry; if (!g) continue;
  const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
  for (const l of lines) for (let i = 0; i + 1 < l.length; i++) {
    const a = l[i], b = l[i + 1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    const km = Math.hypot((b[0] - a[0]) * 111.32 * Math.cos(m[1] * D), (b[1] - a[1]) * 110.574);
    const s = find(inSub, m); if (s) s.properties.bike_km += km;
    const c = find(inLga, m); if (c) c.properties.bike_km += km;
    segs++;
  }
}
for (const f of [...lgas, ...suburbs]) f.properties.bike_km = +f.properties.bike_km.toFixed(2);
console.log(`cycling: ${segs} segments`);

// ── heat and vegetation: MOCK (seeded): hotter where denser and farther from the bay and the green wedges ────────
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
const CBD = [144.9631, -37.8136];
for (const f of [...suburbs, ...lgas]) {
  const c = centreOf(f.geometry) ?? CBD, p = f.properties, dens = p.pop && p.area_km2 ? p.pop / p.area_km2 : 1500;
  const dCbd = Math.hypot((c[0] - CBD[0]) * 88, (c[1] - CBD[1]) * 111), west = Math.max(0, CBD[0] - c[0]) * 30;
  const tree = Math.max(4, Math.min(48, 26 - dens / 450 + 0.25 * dCbd - west * 0.6 + 8 * (hash(`${f.id}t`) - 0.5)));
  p.tree_pct = +tree.toFixed(1);
  p.grass_pct = +Math.max(5, Math.min(45, 18 + 10 * hash(`${f.id}g`) + west * 0.4)).toFixed(1);
  p.uhi = +Math.max(0.5, Math.min(12, 3 + dens / 900 + west * 0.25 - tree * 0.08 + 1.5 * hash(`${f.id}u`))).toFixed(1);
}

const fc = (features, attribution) => ({ type: 'FeatureCollection', attribution, features });
const ATTR = '© State of Victoria (Vicmap Admin), CC BY 4.0 · ABS Census 2021 (CC BY 4.0) · bicycle network © DTP, CC BY 4.0';
writeFileSync(join(OUT, 'councils.geojson'), JSON.stringify(fc(lgas, ATTR)));
writeFileSync(join(OUT, 'suburbs.geojson'), JSON.stringify(fc(suburbs, ATTR)));
writeFileSync(join(OUT, 'sources.json'), JSON.stringify({
  boundaries: { title: 'Vicmap Admin: LGA and locality polygons', licence: 'CC BY 4.0', url: 'https://discover.data.vic.gov.au/dataset/vicmap-admin' },
  population: { title: 'ABS Census 2021, G01 (persons) by LGA and suburb', licence: 'CC BY 4.0', url: 'https://data.api.abs.gov.au/rest/dataflow/ABS/C21_G01_LGA' },
  openSpace: { title: 'VEAC Metropolitan Melbourne open space', licence: 'CC BY 4.0', url: 'https://discover.data.vic.gov.au/dataset/open-space' },
  cycling: { title: 'DTP Bicycle infrastructure network', licence: 'CC BY 4.0', url: 'https://opendata.transport.vic.gov.au/dataset/bicycle-infrastructure-network' },
  heat: { title: 'mock values (seeded), not measurements', licence: '—', url: '' },
}, null, 1));
for (const f of ['councils.geojson', 'suburbs.geojson', 'open-space.geojson']) console.log(f, (statSync(join(OUT, f)).size / 1e6).toFixed(2), 'MB');
