// The healthy-city example's street level: open data for an area cut into 500 m tiles (one small JSON each), the
// format aslnut's street detail reads (modules › world › earth › street). Downloads are cached in data/raw-city/.
//   node tools/demo-data-city-tiles.mjs [w s e n]   → data/packs/city/tiles/{index.json, ix_iz.json}
// Sources (all open):
//   roads        Vicmap Transport TR_ROAD (class, name)               © State of Victoria, CC BY 4.0 (WFS)
//   trees        Vicmap Vegetation TREE_URBAN (height, canopy radius)  © State of Victoria, CC BY 4.0 (WFS)
//   open space   VEAC metropolitan open space (polygons, group)        © VEAC / State of Victoria, CC BY 4.0 (WFS)
//   water        Vicmap Hydro water areas and watercourses             © State of Victoria, CC BY 4.0 (WFS)
//   buildings    Overture Maps buildings (footprint, height, floors)   © Overture Maps Foundation, ODbL / CDLA
//   road reserve Vicmap Property road casements (the reserve between    © State of Victoria, CC BY 4.0 (WFS)
//                the property boundaries; intersection casements apart)
//                (data/raw-city/overture-buildings-monash.csv, made with DuckDB from the Overture release on S3)
// Tile format (v1): coordinates are decimetres from the tile's north-west corner, x east, z south, polylines delta
// encoded; `s` is the string table.
//   roads     [class, width dm, name, id, x0, z0, dx, dz, …]  class: Vicmap 0 freeway … 5 local, 6+ tracks (v2: an id;
//             each piece whole, in the tile of its middle)
//   junctions [arms, then per arm: class, road id, end, points, x0, z0, …]   (every junction a tile's roads touch)
//   buildings [height dm, height source (0 measured, 1 floors, 2 default), class, x0, z0, …]
//   trees     x, z, height dm, canopy radius dm, …
//   parks     [name, group, full area m², x0, z0, …]         (clipped to the tile)
//   water     [name, type, full area m², x0, z0, …]
//   streams   [width dm, name, type, x0, z0, …]
//   reserves  [junction 0 | 1, x0, z0, …]                        (whole: every tile its box touches)
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

const DATA = join(import.meta.dirname, '..', '..', '..', 'data'), RAW = join(DATA, 'raw-city'), OUT = join(DATA, 'packs', 'city', 'tiles');
const [W, S, E, N] = process.argv.length >= 6 ? process.argv.slice(2, 6).map(Number) : [145.09, -37.95, 145.16, -37.9];
const SIZE = 500, LON0 = 145.09, LAT0 = -37.9, D = Math.PI / 180;
const KX = 111320 * Math.cos(LAT0 * D), KZ = 110574;
const X = (lon) => (lon - LON0) * KX, Z = (lat) => -(lat - LAT0) * KZ;
mkdirSync(RAW, { recursive: true }); mkdirSync(OUT, { recursive: true });

async function wfs(layer, extra = '') {
  const f = join(RAW, `wfs-${layer}-${W}_${S}_${E}_${N}.json`);
  if (existsSync(f)) return JSON.parse(readFileSync(f, 'utf8'));
  const all = [];
  for (let start = 0; ; start += 5000) {
    const url = `https://opendata.maps.vic.gov.au/geoserver/wfs?service=WFS&version=2.0.0&request=GetFeature&typeNames=open-data-platform:${layer}&outputFormat=application/json&count=5000&startIndex=${start}&bbox=${S},${W},${N},${E},urn:ogc:def:crs:EPSG::4326${extra}`;
    console.log('fetch', layer, start);
    const r = await fetch(url); if (!r.ok) throw new Error(`${r.status} ${url}`);
    const j = await r.json(); all.push(...j.features);
    if (j.features.length < 5000) break;
  }
  writeFileSync(f, JSON.stringify(all)); return all;
}

const tiles = new Map();
const tileOf = (ix, iz) => { const k = `${ix}_${iz}`; let t = tiles.get(k); if (!t) { t = { ix, iz, roads: [], buildings: [], trees: [], parks: [], water: [], streams: [], reserves: [] }; tiles.set(k, t); } return t; };
const x0 = Math.floor(X(W) / SIZE), x1 = Math.floor(X(E) / SIZE), z0 = Math.floor(Z(N) / SIZE), z1 = Math.floor(Z(S) / SIZE);
for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) tileOf(ix, iz);
const keyOf = (x, z) => [Math.floor(x / SIZE), Math.floor(z / SIZE)];
const has = (ix, iz) => tiles.has(`${ix}_${iz}`);

/** a polyline split into runs of segments whose middles lie in one tile */
function splitRuns(pts, add) {
  let run = [], rk = null;
  for (let i = 0; i + 1 < pts.length; i++) {
    const a = pts[i], b = pts[i + 1], k = keyOf((a[0] + b[0]) / 2, (a[1] + b[1]) / 2), ks = k.join('_');
    if (ks !== rk) { if (rk && run.length > 1) add(rk, run); run = [a]; rk = ks; }
    run.push(b);
  }
  if (rk && run.length > 1) add(rk, run);
}
const linesOf = (g) => (g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : []);
const polysOf = (g) => (g.type === 'Polygon' ? [g.coordinates] : g.type === 'MultiPolygon' ? g.coordinates : []);
const local = (ring) => ring.map((p) => [X(p[0]), Z(p[1])]);
const area = (r) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]); return Math.abs(a / 2); };
/** a ring clipped to a box (Sutherland–Hodgman: the box is convex) */
function clip(ring, bx0, bz0, bx1, bz1) {
  let out = ring;
  const edges = [[(p) => p[0] >= bx0, (a, b) => { const t = (bx0 - a[0]) / (b[0] - a[0]); return [bx0, a[1] + t * (b[1] - a[1])]; }], [(p) => p[0] <= bx1, (a, b) => { const t = (bx1 - a[0]) / (b[0] - a[0]); return [bx1, a[1] + t * (b[1] - a[1])]; }],
    [(p) => p[1] >= bz0, (a, b) => { const t = (bz0 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), bz0]; }], [(p) => p[1] <= bz1, (a, b) => { const t = (bz1 - a[1]) / (b[1] - a[1]); return [a[0] + t * (b[0] - a[0]), bz1]; }]];
  for (const [inside, cut] of edges) {
    const src = out; out = [];
    for (let i = 0; i < src.length; i++) {
      const a = src[(i + src.length - 1) % src.length], b = src[i];
      if (inside(b)) { if (!inside(a)) out.push(cut(a, b)); out.push(b); } else if (inside(a)) out.push(cut(a, b));
    }
    if (!out.length) break;
  }
  return out;
}

// ── roads ──────────────────────────────────────────────────────────────────────────────────────────────────────────
const WIDTH = { 0: 26, 1: 20, 2: 15, 3: 12, 4: 10, 5: 7.5, 6: 4, 7: 4, 8: 3, 9: 3 };
// each road piece whole, in the tile of its middle (long ones in pieces of at most ~500 m), with its id; and every
// junction's arms (the first 30 m of each road meeting there) in every tile one of them is in, so each tile solves the
// junctions it touches from all their arms, the same way as its neighbours do
let nr = 0;
const pieces = [];
for (const f of await wfs('tr_road')) {
  const p = f.properties, cls = Number(p.class_code ?? 5), name = p.ezi_road_name_label ?? '';
  for (const l of linesOf(f.geometry)) {
    const pts = local(l); let run = [pts[0]], len = 0, k = 0;
    for (let i = 1; i < pts.length; i++) {
      len += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); run.push(pts[i]);
      if ((len > 480 && i < pts.length - 1) || i === pts.length - 1) { pieces.push({ uid: `${p.ufi}:${k++}`, cls, name, pts: run }); run = [pts[i]]; len = 0; }
    }
  }
}
const lenOf = (pts) => { let l = 0; for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return l; };
const midOf = (pts) => { const L = lenOf(pts) / 2; let a = 0; for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); if (a + l >= L) { const f = (L - a) / (l || 1); return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f]; } a += l; } return pts[0]; };
const nkey = (q) => `${Math.round(q[0] * 5)},${Math.round(q[1] * 5)}`;
const nodes = new Map();
for (const pc of pieces) for (const end of [0, 1]) { const q = pc.pts[end ? pc.pts.length - 1 : 0], k = nkey(q); let n = nodes.get(k); if (!n) nodes.set(k, (n = { q, ends: [] })); n.ends.push({ pc, end }); }
/** the first 50 m of a piece from one of its ends (its arm at that junction) */
const stubOf = (pc, end) => { const pts = end ? [...pc.pts].reverse() : pc.pts, out = [pts[0]]; let l = 0; for (let i = 1; i < pts.length && l < 50; i++) { l += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); out.push(pts[i]); } return out; };
for (const pc of pieces) {
  const [mx, mz] = midOf(pc.pts), [ix, iz] = keyOf(mx, mz); if (!has(ix, iz)) continue;
  const t = tileOf(ix, iz); t.roads.push([pc.cls, Math.round((WIDTH[pc.cls] ?? 4) * 10), pc.name, pc.uid, pc.pts]); nr++;
  for (const end of [0, 1]) {
    const n = nodes.get(nkey(pc.pts[end ? pc.pts.length - 1 : 0])); if (!n || n.ends.length < 2) continue;
    (t.junctionSet ??= new Set()).add(n);
  }
}
for (const t of tiles.values()) t.junctions = [...(t.junctionSet ?? [])].map((n) => ({ q: n.q, arms: n.ends.map(({ pc, end }) => ({ uid: pc.uid, cls: pc.cls, end, pts: stubOf(pc, end) })) }));
console.log('road pieces', nr);
// ── watercourses ───────────────────────────────────────────────────────────────────────────────────────────────────
const SW = { watercourse_river: 12, connector_river: 12, watercourse_channel_drain: 4, connector_channel_drain: 4 };
for (const f of await wfs('hy_watercourse')) {
  const p = f.properties, w = SW[p.feature_type_code] ?? (p.hierarchy === 'L' ? 3 : 6);
  for (const l of linesOf(f.geometry)) splitRuns(local(l), (k, run) => { const t = tiles.get(k); if (t) t.streams.push([w * 10, p.name ?? '', p.feature_type_code ?? '', run]); });
}
// ── trees ──────────────────────────────────────────────────────────────────────────────────────────────────────────
let nt = 0;
for (const f of await wfs('tree_urban', '&sortBy=ufi')) {
  const c = f.geometry?.coordinates; if (!c) continue;
  const x = X(c[0]), z = Z(c[1]), [ix, iz] = keyOf(x, z); if (!has(ix, iz)) continue;
  const p = f.properties;
  tileOf(ix, iz).trees.push([x, z, Number(p.height_m ?? 6), Number(p.canopy_radius_m ?? 2.5)]); nt++;
}
console.log('trees', nt);
// ── open space and water areas: clipped to each tile ─────────────────────────────────────────────────────────────
function areas(features, bucket, meta) {
  let n = 0;
  for (const f of features) for (const poly of polysOf(f.geometry)) {
    const ring = local(poly[0]); if (ring.length < 4) continue;
    const full = area(ring);
    let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity; for (const p of ring) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); }
    for (let ix = Math.floor(bx0 / SIZE); ix <= Math.floor(bx1 / SIZE); ix++) for (let iz = Math.floor(bz0 / SIZE); iz <= Math.floor(bz1 / SIZE); iz++) {
      if (!has(ix, iz)) continue;
      const c = clip(ring.slice(0, -1), ix * SIZE, iz * SIZE, (ix + 1) * SIZE, iz * SIZE + SIZE);
      if (c.length >= 3 && area(c) > 20) { tileOf(ix, iz)[bucket].push([...meta(f.properties), Math.round(full), c]); n++; }
    }
  }
  return n;
}
console.log('park pieces', areas(await wfs('veac_metro_open_space'), 'parks', (p) => [p.name && p.name !== 'NO DATA' ? p.name : '', p.os_group ?? '']));
console.log('water pieces', areas(await wfs('hy_water_area_polygon'), 'water', (p) => [p.name ?? '', p.feature_type_code ?? '']));
// ── the road reserve: Vicmap's road casements (the land between the property boundaries), whole in every tile they touch ──
let nres = 0;
for (const f of await wfs('road_casement_polygon')) for (const poly of polysOf(f.geometry)) {
  const ring = local(poly[0]); if (ring.length < 4) continue;
  let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity; for (const p of ring) { bx0 = Math.min(bx0, p[0]); bx1 = Math.max(bx1, p[0]); bz0 = Math.min(bz0, p[1]); bz1 = Math.max(bz1, p[1]); }
  for (let ix = Math.floor(bx0 / SIZE); ix <= Math.floor(bx1 / SIZE); ix++) for (let iz = Math.floor(bz0 / SIZE); iz <= Math.floor(bz1 / SIZE); iz++) if (has(ix, iz)) { tileOf(ix, iz).reserves.push([f.properties.intersection === 'Y' ? 1 : 0, ring.slice(0, -1)]); nres++; }
}
console.log('reserve pieces', nres);
// ── buildings: Overture, by the footprint's middle ───────────────────────────────────────────────────────────────
let nb = 0;
{
  const text = readFileSync(join(RAW, 'overture-buildings-monash.csv'), 'utf8');
  const lines = text.split('\n'); const head = lines[0].split('\t');
  const ih = head.indexOf('height'), iff = head.indexOf('num_floors'), ic = head.indexOf('class'), iw = head.indexOf('wkt');
  for (let li = 1; li < lines.length; li++) {
    const c = lines[li].split('\t'); if (c.length < head.length) continue;
    const w = c[iw]; if (!w.startsWith('POLYGON')) continue;
    const outer = w.slice(w.indexOf('((') + 2, w.indexOf(')')).split(',').map((s) => s.trim().split(' ').map(Number));
    let lo = 0, la = 0; for (const p of outer) { lo += p[0]; la += p[1]; } lo /= outer.length; la /= outer.length;
    if (lo < W || lo > E || la < S || la > N) continue;
    const ring = local(outer), cx = X(lo), cz = Z(la), [ix, iz] = keyOf(cx, cz); if (!has(ix, iz)) continue;
    let h = Number(c[ih]), src = 0;
    if (!(h > 0)) { const fl = Number(c[iff]); if (fl > 0) { h = fl * 3.2; src = 1; } else { h = 6; src = 2; } }
    tileOf(ix, iz).buildings.push([Math.round(Math.min(h, 250) * 10), src, c[ic] ?? '', ring]); nb++;
  }
}
console.log('buildings', nb);

// ── write ────────────────────────────────────────────────────────────────────────────────────────────────────────
for (const f of readdirSync(OUT)) rmSync(join(OUT, f));
const dm = (v) => Math.round(v * 10);
let total = 0; const list = [];
for (const t of tiles.values()) {
  const ox = t.ix * SIZE, oz = t.iz * SIZE, strings = [], sidx = new Map();
  const S_ = (v) => { v = v ?? ''; if (!sidx.has(v)) { sidx.set(v, strings.length); strings.push(v); } return sidx.get(v); };
  const flat = (pts) => { const o = [dm(pts[0][0] - ox), dm(pts[0][1] - oz)]; for (let i = 1; i < pts.length; i++) o.push(dm(pts[i][0] - ox) - dm(pts[i - 1][0] - ox), dm(pts[i][1] - oz) - dm(pts[i - 1][1] - oz)); return o; };
  const doc = {
    v: 2, ix: t.ix, iz: t.iz, size: SIZE,
    roads: t.roads.map(([c, w, n, u, p]) => [c, w, S_(n), S_(u), ...flat(p)]),
    // junctions: [arm count, then per arm: class, its road's id, which end (0 its start, 1 its end), points, x0, z0, …]
    junctions: t.junctions.map((j) => [j.arms.length, ...j.arms.flatMap((a) => [a.cls, S_(a.uid), a.end, a.pts.length, ...flat(a.pts)])]),
    buildings: t.buildings.map(([h, s, c, r]) => [h, s, S_(c), ...flat(r)]),
    trees: t.trees.flatMap(([x, z, h, r]) => [dm(x - ox), dm(z - oz), dm(h), dm(r)]),
    parks: t.parks.map(([n, g, a, r]) => [S_(n), S_(g), a, ...flat(r)]),
    water: t.water.map(([n, ty, a, r]) => [S_(n), S_(ty), a, ...flat(r)]),
    streams: t.streams.map(([w, n, ty, p]) => [w, S_(n), S_(ty), ...flat(p)]),
    reserves: t.reserves.map(([j, r]) => [j, ...flat(r)]),
    s: null,
  };
  doc.s = strings;
  const empty = !doc.roads.length && !doc.buildings.length && !doc.trees.length && !doc.parks.length;
  if (empty) continue;
  const s = JSON.stringify(doc); writeFileSync(join(OUT, `${t.ix}_${t.iz}.json`), s); total += s.length; list.push([t.ix, t.iz]);
}
writeFileSync(join(OUT, 'index.json'), JSON.stringify({ v: 1, size: SIZE, origin: [LON0, LAT0], bbox: [W, S, E, N], tiles: list,
  attribution: 'Roads, trees, water © State of Victoria (Vicmap), CC BY 4.0 · open space © VEAC, CC BY 4.0 · buildings © Overture Maps Foundation (ODbL)',
  sources: {
    roads: { title: 'Vicmap Transport: road network (TR_ROAD)', licence: 'CC BY 4.0 © State of Victoria', url: 'https://discover.data.vic.gov.au/dataset/vicmap-transport' },
    trees: { title: 'Vicmap Vegetation: urban trees (TREE_URBAN)', licence: 'CC BY 4.0 © State of Victoria', url: 'https://discover.data.vic.gov.au/dataset/vicmap-vegetation-urban-tree-canopy' },
    parks: { title: 'VEAC Metropolitan Melbourne open space', licence: 'CC BY 4.0 © VEAC', url: 'https://discover.data.vic.gov.au/dataset/open-space' },
    water: { title: 'Vicmap Hydro: water areas and watercourses', licence: 'CC BY 4.0 © State of Victoria', url: 'https://discover.data.vic.gov.au/dataset/vicmap-hydro' },
    reserves: { title: 'Vicmap Property: road casements (the road reserve)', licence: 'CC BY 4.0 © State of Victoria', url: 'https://discover.data.vic.gov.au/dataset/vicmap-property' },
    buildings: { title: 'Overture Maps: buildings (measured heights where known)', licence: 'ODbL © Overture Maps Foundation, OpenStreetMap contributors', url: 'https://docs.overturemaps.org/guides/buildings/' },
  } }));
console.log(`${list.length} tiles · ${(total / 1e6).toFixed(1)} MB · avg ${(total / list.length / 1e3).toFixed(0)} KB`);
