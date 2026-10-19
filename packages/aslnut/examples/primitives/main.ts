import { presetOf } from '../preset.ts';
// The primitives check: every visual a city twin's five screens need (and the tree's wire-sphere hover), and a
// low-level 3D checklist, built with the public API only, on WebGPU and WebGL2. Not a demo: a page the
// smoke opens scene by scene (?go=region | studio | heatlab | clayton | access | wire | three | extend | surface |
// epochs | levels). Every value shown is generated here: no data files.
//   &graphics=webgpu | webgl2   &clock=30 (the tools: a fixed step)
import {
  BLOCK, HOUSE, LOT, Element, MeshBuilder, POLES, STREET, area, bins, buildings, custom, data, earth, fence, field, house, imagery, legend, line,
  material, points, poles, replay, roadSection, rules, shape, sidewalks, sky, solids, streets, text, wires, world, type AttachContext, type DrawCall,
  type FrameContext, type GBuffer, type Program, type SurfaceFn, type World,
} from '../../src/index.ts';

declare const __BUILD__: number;
const q = new URLSearchParams(location.search);
const PACK = '/aslnut/data/packs';
const CLAYTON: [number, number] = [145.1205, -37.9245];
const KZ = 110574, kx = 111320 * Math.cos(CLAYTON[1] * Math.PI / 180);
/** metres east / south of a place → [lon, lat] */
const ll = (x: number, z: number, at: [number, number] = CLAYTON): [number, number] => [at[0] + x / kx, at[1] - z / KZ];
/** a seeded random with the presets' interface (next, chance, range, pick, weighted) */
class Rng {
  private s: number;
  constructor(seed: number) { this.s = (seed * 2654435761) >>> 0 || 1; }
  next(): number { this.s ^= this.s << 13; this.s ^= this.s >>> 17; this.s ^= this.s << 5; this.s >>>= 0; return this.s / 4294967296; }
  chance(p: number): boolean { return this.next() < p; }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  pick<T>(a: readonly T[]): T { return a[Math.floor(this.next() * a.length)]!; }
  weighted(w: Record<string, number>): string { const t = Object.values(w).reduce((a, b) => a + b, 0); let r = this.next() * t; for (const [k, v] of Object.entries(w)) { r -= v; if (r <= 0) return k; } return Object.keys(w)[0]!; }
}
/** a flat ground of one colour (no network) */
const plain = (color: string) => imagery.custom({ id: `plain-${color.slice(1)}`, attribution: '', draw: (g) => { g.fillStyle = color; g.fillRect(0, 0, 256, 256); return true; } });
const GREENS = ['#4f7a3a', '#5b8a3f', '#3f6b33', '#6a8f45', '#7a9a52', '#596f3e'];
/** a street tree as the original drew it: a trunk and a crown (round, columnar, or a eucalypt of five blobs) */
const tree = shape({
  id: 'original-tree', params: {},
  build: (b) => {
    b.solid('cylinder', { radius: 0.23, size: 1, at: [0, 0.5, 0], color: '#6b5440', sides: 6 });
    for (const [x, y, z, r] of [[0, 0.2, 0, 0.62], [0.45, -0.1, 0.2, 0.5], [-0.4, 0, -0.25, 0.55], [0.1, 0.45, -0.3, 0.45], [-0.2, -0.2, 0.4, 0.42]] as const) b.solid('sphere', { radius: r * 1.6, at: [x * 1.6, 1.0 + y * 1.6 + 0.85, z * 1.6], color: '#ffffff', material: 'foliage', sides: 8 });
  },
});
/** the tree's hover form: a lat-long net round its crown (16 × 12, as the original's) */
const crownNet = shape({ id: 'crown-net', params: {}, build: (b) => { b.solid('sphere', { radius: 1, sides: 16, at: [0, 0, 0], color: '#ffe066', material: 'wire' }); } });
const netOf = shape({ id: 'crown-net-sized', params: {}, build: () => {} });
void netOf;

async function main(): Promise<void> {
  const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
  const scenes: Record<string, { view: { lon: number; lat: number; zoom: number; tilt: number; bearing: number }; ground: string; lit?: boolean; note: string }> = {
    region: { view: { lon: 145.02, lat: -37.86, zoom: 9.6, tilt: 14, bearing: 352 }, ground: '#232b37', note: 'the region: a dark plain ground, main roads in screen px by class, the suburb choropleth (5 classes, .42, white outlines)' },
    studio: { view: { lon: ll(0, 0)[0], lat: ll(0, 0)[1], zoom: 20.1, tilt: 62, bearing: 330 }, ground: '#8fae6a', lit: true, note: 'the asset street: houses, fences, bins, poles and wires, street and yard trees' },
    heatlab: { view: { lon: ll(0, 0)[0], lat: ll(0, 0)[1], zoom: 18.7, tilt: 48, bearing: 340 }, ground: '#7d9a58', lit: true, note: 'the heat lab: the compass ring (canvas texture), N E S W badges, street pills, dots by UTCI (instances), two street rows' },
    clayton: { view: { lon: 145.1205, lat: -37.9245, zoom: 17.6, tilt: 66, bearing: 330 }, ground: '#9cab72', lit: true, note: 'Clayton 3D: the street level from open data on a flat green ground' },
    access: { view: { lon: ll(0, 0)[0], lat: ll(0, 0)[1], zoom: 19.4, tilt: 62, bearing: 330 }, ground: '#232b37', lit: true, note: 'park access: arcs from each house to its park (quadratic, 14 segments, coloured by distance, brightest mid-span)' },
    wire: { view: { lon: ll(0, 0)[0], lat: ll(0, 0)[1], zoom: 21.4, tilt: 60, bearing: 330 }, ground: '#8fae6a', lit: true, note: 'hover a tree: the wire net round its crown (a shape in the wire material, a hover form)' },
    three: { view: { lon: ll(0, 0)[0], lat: ll(0, 0)[1], zoom: 20.5, tilt: 58, bearing: 340 }, ground: '#3a4250', lit: true, note: 'your own geometry (positions, normals, uvs, colours, attributes, indexed), triangles / lines / points, your shader with uniforms, varyings and a canvas texture, blending, depth, sides, instances with their own attributes' },
    extend: { view: { lon: ll(0, 0)[0], lat: ll(0, 0)[1], zoom: 20.0, tilt: 50, bearing: 0 }, ground: '#3a4250', note: 'your own layer: a class extending Element with its own program (WGSL and GLSL), drawn each frame' },
    surface: { view: { lon: ll(0, 0)[0], lat: ll(0, 0)[1], zoom: 17.4, tilt: 60, bearing: 330 }, ground: '#3a4250', lit: true, note: 'a surface field: a block of buildings, walls and roofs coloured by a made-up value by facet orientation and height (&n=2000: more buildings, &field=0: none)' },
    epochs: { view: { lon: ll(0, 0)[0], lat: ll(0, 0)[1], zoom: 16.9, tilt: 52, bearing: 330 }, ground: '#3a4250', lit: true, note: 'epochs: 24 hourly grids of a warm patch moving over a district, morphed by the clock (the slider), on the ground and on the buildings\' walls and roofs (&t=7.5: the hour)' },
    levels: { view: { lon: ll(0, 0)[0], lat: ll(0, 0)[1], zoom: 13.5, tilt: 0, bearing: 0 }, ground: '#3a4250', note: 'params by level: points sized and coloured by the observation level, a field whose res and area follow it (the default ladder, turned on by them; zoom in and out)' },
  };
  const go = presetOf(q, Object.keys(scenes), 'region');
  const sc = scenes[go]!;
  document.querySelector('#bar')!.innerHTML = Object.keys(scenes).map((k) => `<a href="?go=${k}${q.get('graphics') ? `&graphics=${q.get('graphics')}` : ''}" class="${k === go ? 'on' : ''}">${k}</a>`).join('');
  document.querySelector('#note')!.textContent = `${sc.note} · build ${typeof __BUILD__ === 'number' ? __BUILD__ : 0}`;
  const w = await world(canvas, {
    body: earth({ imagery: [plain(sc.ground)], terrain: [], base: null, sky: sc.lit ? sky() : false }),
    view: sc.view, graphics: (q.get('graphics') as 'webgpu' | 'webgl2' | null) ?? 'auto',
    clock: q.get('clock') ? { fps: Number(q.get('clock')) } : 'real', time: new Date(Date.UTC(2026, 0, 15, 3, 0, 0)), timeZone: 'Australia/Melbourne',
    pixelRatio: q.get('dpr') ? Number(q.get('dpr')) : undefined, attribution: { position: 'bottom-right' },
  });
  const extra: Record<string, unknown> = {};
  if (go === 'region') region(w);
  else if (go === 'studio') studio(w);
  else if (go === 'heatlab') heatlab(w, extra);
  else if (go === 'clayton') w.add(streets({ url: `${PACK}/city/tiles/index.json`, near: 3500 }));
  else if (go === 'access') access(w);
  else if (go === 'wire') studio(w, true, extra);
  else if (go === 'three') three(w);
  else if (go === 'extend') w.add(new PulseRing({ id: 'pulse', at: ll(0, 0), radius: 30 }));
  else if (go === 'surface') surfaceScene(w, extra);
  else if (go === 'epochs') epochsScene(w, extra);
  else if (go === 'levels') levelsScene(w, extra);
  (window as unknown as { aslnutDemo: unknown }).aslnutDemo = { w, go, extra, ll };
}

// ── 1. the region: dark ground, roads by class in screen px, the suburb choropleth ────────────────────────────────
function region(w: World): void {
  const RAMP = ['#d7191c', '#fdae61', '#ffffbf', '#a6d96a', '#1a9641'];
  const suburbs = data.geojson(`${PACK}/city/suburbs.geojson`, { id: 'code' });
  let breaks: number[] = [];
  const cls = (v: number) => { let k = 0; while (k < breaks.length && v > breaks[k]!) k++; return RAMP[k]!; };
  w.add(area({ id: 'choropleth', data: suburbs, opacity: 0.42, outline: { width: 1.6, color: '#ffffffcc' }, hover: { color: '#ffffff', outline: 4 }, selected: { color: '#111827', outline: 5 }, select: 'tap',
    color: (d) => { if (!breaks.length) { const vs = suburbs.features().map((f) => Number(f.props.tree_pct ?? 0)).sort((a, b) => a - b); breaks = [0.2, 0.4, 0.6, 0.8].map((p) => vs[Math.floor(p * (vs.length - 1))]!); } return cls(Number((d as { props: Record<string, unknown> }).props.tree_pct ?? 0)); } }));
  const roads = data.geojson(`${PACK}/demo/melbourne-roads.geojson`);
  const style = (k: string) => (k === 'motorway' ? { w: 6, c: '#f08a24' } : k === 'trunk' ? { w: 4.6, c: '#f6c94e' } : { w: 2.8, c: '#fdfdf8' });
  w.add(line({ id: 'roads', data: roads, width: (d) => style(String((d as { props: Record<string, unknown> }).props.kind)).w, color: (d) => style(String((d as { props: Record<string, unknown> }).props.kind)).c, pickable: false }));
}

// ── 2. the asset street (and 6: the tree's wire-sphere hover) ─────────────────────────────────────────────
function studio(w: World, wire = false, extra: Record<string, unknown> = {}): void {
  const mb = new MeshBuilder(), infos: { kind: string; id: string; props: Record<string, unknown> }[] = [];
  const id = (kind: string, props: Record<string, unknown> = {}) => { infos.push({ kind, id: `${kind}-${infos.length}`, props }); return infos.length - 1; };
  const C = 250, road = { cls: 5, width: 7.5 }, axis: [number, number][] = [[C - 48, C], [C + 48, C]];
  mb.as(id('road', { name: 'the street' })).on(null);
  roadSection(mb, axis, road, STREET); sidewalks(mb, axis, road, STREET);
  const spans: { ax: number; az: number; bx: number; bz: number; top: number }[] = [];
  mb.as(id('pole', { what: 'power poles' })); poles(mb, axis, 6.8, POLES, spans);
  const rnd = new Rng(7);
  for (const side of [-1, 1]) for (let k = 0; k < 3; k++) {
    const cx = C - 32 + 32 * k + rnd.range(-2, 2), wdt = rnd.range(11, 16), dep = rnd.range(9, 13), set = 8.6 + rnd.range(6, 9), cz = C + side * (set + dep / 2);
    const ring: [number, number][] = [[cx - wdt / 2, cz - dep / 2], [cx + wdt / 2, cz - dep / 2], [cx + wdt / 2, cz + dep / 2], [cx - wdt / 2, cz + dep / 2]];
    mb.as(id('building', { kind: 'house' })).on([cx, cz]);
    house(mb, { ring, height: rnd.range(4.2, 5.2), front: { x: 0, z: -side } }, HOUSE, rnd as never);
    const fz = C + side * 8.6;
    fence(mb, [cx - wdt / 2 - 1.5, fz], [cx + wdt / 2 - 1.7, fz], rnd.weighted(LOT.fence.types), LOT.fence);
    bins(mb, cx + wdt / 2 + 0.6, C + side * 10.8, { x: 1, z: 0 }, LOT.bins);
  }
  void BLOCK;
  // trees: on the nature strip and in the front yards, a crown each (instances of one shape, tinted green)
  const made = tree.make(), data_: number[] = [];
  for (const side of [-1, 1]) for (let k = 0; k < 6; k++) {
    const street = k % 2 === 0, x = C - 40 + k * 16 + (side > 0 ? 6 : 0), z = C + side * (street ? 5.7 : 11.6), h = street ? rnd.range(6, 11) : rnd.range(4, 8), r = street ? rnd.range(2.5, 4.5) : rnd.range(1.8, 3.2);
    const tint = parseInt(rnd.pick(GREENS).slice(1), 16);
    (extra.trees ??= [] as unknown[]) && (extra.trees as unknown[]).push([...ll(x - C, z - C), (1.85 / 3.6) * h]);
    data_.push(x, z, 0, id('tree', { 'height (m)': +h.toFixed(1), 'crown radius (m)': +r.toFixed(1) }), r / 1.6, h / 3.6, r / 1.6, rnd.range(0, 6.28), tint, 0);
  }
  const s = solids({ id: 'street', tooltip: (d) => `${d.kind}`,
    // the original's tree hover: a 16 × 12 net round the crown, 1.05 × its radius, in the hover colour, a little see-through
    hover: wire ? { color: '#ffe066', shape: (d, place) => d.kind === 'tree' ? netAt(Number(d.props['crown radius (m)']), Number(d.props['height (m)']), place) : null } : { color: '#ffe066' } });
  s.put('studio', { origin: CLAYTON, at: [-C, -C], mesh: mb.build(), instances: [{ shape: made.levels, data: Float32Array.from(data_), radius: 4 }], info: (n) => infos[n] ?? null });
  w.add(s);
  w.add(wires({ id: 'wires', data: spans.map((p) => ({ a: ll(p.ax - C, p.az - C), b: ll(p.bx - C, p.bz - C), top: p.top })), color: '#1f2328' }));
}
/** the crown's net: 1.05 × the crown, its middle at the crown's (this page's tree: its crown's middle at 1.85 of its
 *  3.6 units of height) */
const nets = new Map<string, { levels: readonly unknown[] }>();
function netAt(r: number, h: number, _place: unknown): { levels: readonly unknown[] } {
  const key = `${r.toFixed(1)}:${h.toFixed(1)}`;
  let m = nets.get(key);
  if (!m) { const sh = shape({ id: `net-${key}`, params: {}, build: (b) => { b.solid('sphere', { radius: 1.05 * r, sides: 16, at: [0, (1.85 / 3.6) * h, 0], color: '#ffe066', material: 'wire' }); } }); m = sh.make(); nets.set(key, m); }
  return m;
}
void crownNet;

// ── 3. the heat lab ───────────────────────────────────────────────────────────────────────────────────────────
function heatlab(w: World, extra: Record<string, unknown>): void {
  // the ground cells by material, and the streets (a trunk, two rows): one mesh, flat
  const MAT = { asphalt: '#2f3236', concrete: '#c9c5bb', grass: '#5f9a45', drygrass: '#b8a774' };
  const streetsL = [{ name: 'Main street', color: '#475569', pts: [[-75, 0], [-22, 0]], w: 9 }, { name: 'Street A', color: '#0369a1', pts: [[-22, 0], [-4, -24], [75, -24]], w: 10 }, { name: 'Street B', color: '#6d28d9', pts: [[-22, 0], [-4, 24], [75, 24]], w: 10 }] as const;
  const near = (x: number, z: number) => { let best = { d: 1e9, s: streetsL[0] as (typeof streetsL)[number] }; for (const s of streetsL) for (let i = 0; i + 1 < s.pts.length; i++) { const [ax, az] = s.pts[i]!, [bx, bz] = s.pts[i + 1]!, dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz))), d = Math.hypot(x - ax - t * dx, z - az - t * dz); if (d < best.d) best = { d, s }; } return best; };
  const mb = new MeshBuilder(), C = 250, dots: number[] = [];
  for (let z = -55; z < 55; z++) for (let x = -75; x < 75; x++) {
    const n = near(x + 0.5, z + 0.5), half = n.s.w / 2, col = n.d < half ? MAT.asphalt : n.d < half + 0.45 ? MAT.concrete : n.d < half + 3.45 ? (z < 0 ? MAT.drygrass : MAT.grass) : n.d < half + 5.05 ? MAT.concrete : (z < 0 ? MAT.drygrass : MAT.grass);
    mb.floor([[C + x, C + z], [C + x + 1, C + z], [C + x + 1, C + z + 1], [C + x, C + z + 1]], 0.05, col, [0, 1, 2, 0, 2, 3]);
    if (n.d < half + 5.55) dots.push(x + 0.5, z + 0.5, n.d, z);
  }
  // buildings on both rows: low (north) and tall (south), lots every 14 m
  for (const side of [-1, 1]) for (const row of [-24, 24]) for (let x = 4; x < 72; x += 14) {
    const tall = row > 0, front = 5 + 0.45 + 3 + 1.6 + (tall ? 1.5 : 7), depth = 12, z0 = row + side * front, z1 = z0 + side * depth;
    if (Math.abs(Math.min(z0, z1)) < 1 || Math.abs(z1) > 55) continue;
    const h = tall ? 10.5 : 4.2;
    mb.box(C + x + 5.5, C + (z0 + z1) / 2, 0, 11, h, depth, 0, tall ? '#c9c2b4' : '#b0674a', tall ? '#8d9196' : '#4a4d52');
  }
  const s = solids({ id: 'lab' }); s.put('lab', { origin: CLAYTON, at: [-C, -C], mesh: mb.build(), info: () => null }); w.add(s);
  // trees on street B (every 8 m each side), as the original's round crowns
  const t = tree.make(), td: number[] = [];
  for (let x = 0; x < 72; x += 8) for (const side of [-1, 1]) td.push(C + x + (side > 0 ? 4 : 0), C + 24 + side * 6.95, 0, 0, 2.6, 2.8, 2.6, 0, parseInt(GREENS[0]!.slice(1), 16), 0);
  s.put('trees', { origin: CLAYTON, at: [-C, -C], instances: [{ shape: t.levels, data: Float32Array.from(td), radius: 4 }], info: () => null });
  // the compass: drawn into a canvas, the canvas on a flat square (a custom mesh with a texture), as the original did
  const R = 112, size = 2 * R + 40, k = 2048 / size, cv = new OffscreenCanvas(2048, 2048), g = cv.getContext('2d')!;
  g.translate(1024, 1024); g.strokeStyle = 'rgba(255,255,255,0.9)'; g.fillStyle = 'rgba(255,255,255,0.95)';
  for (const r of [112, 106]) { g.lineWidth = 1.6 * k; g.beginPath(); g.arc(0, 0, r * k, 0, Math.PI * 2); g.stroke(); }
  for (let deg = 0; deg < 360; deg += 5) {
    const len = deg % 45 === 0 ? 9 : deg % 15 === 0 ? 5 : 2.5, a = (deg - 90) * Math.PI / 180;
    g.strokeStyle = deg === 0 ? '#e5484d' : 'rgba(255,255,255,0.9)'; g.lineWidth = (deg % 45 === 0 ? 1.4 : 0.6) * k;
    g.beginPath(); g.moveTo(Math.cos(a) * 106 * k, Math.sin(a) * 106 * k); g.lineTo(Math.cos(a) * (106 - len) * k, Math.sin(a) * (106 - len) * k); g.stroke();
  }
  g.font = `600 ${4.2 * k}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const deg of [30, 60, 120, 150, 210, 240, 300, 330]) { const a = (deg - 90) * Math.PI / 180; g.save(); g.translate(Math.cos(a) * 117 * k, Math.sin(a) * 117 * k); g.rotate(deg * Math.PI / 180); g.fillText(`${deg}°`, 0, 0); g.restore(); }
  g.fillStyle = '#e5484d'; g.beginPath(); { const p = (deg: number, r: number) => { const a = (deg - 90) * Math.PI / 180; return [Math.cos(a) * r * k, Math.sin(a) * r * k] as const; }; g.moveTo(...p(0, 126)); g.lineTo(...p(4, 113)); g.lineTo(...p(-4, 113)); } g.fill();
  const hs = size / 2;
  w.add(custom({ id: 'compass', at: ll(0, 0), geometry: { positions: [-hs, 0.3, -hs, hs, 0.3, -hs, hs, 0.3, hs, -hs, 0.3, hs], uvs: [0, 0, 1, 0, 1, 1, 0, 1], index: [0, 1, 2, 0, 2, 3] },
    uniforms: { ring: { image: cv } }, fragment: 'color = tex_ring(uv);', blend: 'alpha', depth: { write: false } }));
  // the N E S W badges: discs facing the eye, 14 m (one atlas, the letter by its column)
  const badges = new OffscreenCanvas(512, 128), bg = badges.getContext('2d')!;
  ['N', 'E', 'S', 'W'].forEach((L, i) => { bg.fillStyle = L === 'N' ? '#e5484d' : 'rgba(20,28,40,0.78)'; bg.beginPath(); bg.arc(64 + i * 128, 64, 58, 0, Math.PI * 2); bg.fill(); bg.fillStyle = '#ffffff'; bg.font = 'bold 76px system-ui, sans-serif'; bg.textAlign = 'center'; bg.textBaseline = 'middle'; bg.fillText(L, 64 + i * 128, 68); });
  const quad = { positions: [-7, -7, 0, 7, -7, 0, 7, 7, 0, -7, 7, 0], uvs: [0, 1, 1, 1, 1, 0, 0, 0], index: [0, 1, 2, 0, 2, 3] };
  w.add(custom({ id: 'badges', geometry: quad, data: [0, 90, 180, 270].map((deg, i) => ({ deg, i })), at: (d) => { const a = d.deg * Math.PI / 180; return [...ll(Math.sin(a) * 128, -Math.cos(a) * 128), 6] as [number, number, number]; },
    attributes: { col: (d) => d.i }, uniforms: { letters: { image: badges } },
    // a billboard: the square turned to face the eye
    vertex: 'cu = col; let f = normalize(eye - origin); let r = normalize(cross(vec3f(0.0, 1.0, 0.0), f)); let up = cross(f, r); position = r * position.x + up * position.y;',
    varyings: { cu: 'f32' }, fragment: 'color = tex_letters(vec2f((uv.x + cu) / 4.0, uv.y));', functions: '', blend: 'alpha', depth: { test: false, write: false } }));
  // the street pills: constant screen size (points), the name on its colour
  const pills = new OffscreenCanvas(512, 384), pg = pills.getContext('2d')!;
  streetsL.forEach((s, i) => { pg.fillStyle = s.color; pg.beginPath(); pg.roundRect(8, 8 + i * 128, 496, 112, 56); pg.fill(); pg.fillStyle = '#fff'; pg.font = 'bold 64px system-ui, sans-serif'; pg.textAlign = 'center'; pg.textBaseline = 'middle'; pg.fillText(s.name, 256, 68 + i * 128); });
  const at3 = [[-48.5, 0], [35.5, -24], [35.5, 24]];
  w.add(custom({ id: 'pills', primitive: 'points', pointSize: 70, geometry: { positions: at3.flatMap(([x, z]) => [x!, 12, z!]), attributes: { row: { data: [0, 1, 2], size: 1 } } }, at: ll(0, 0),
    uniforms: { names: { image: pills } }, varyings: { rw: 'f32' }, vertex: 'rw = row;', fragment: 'let p = corner * 0.5 + vec2f(0.5); let v = (1.0 - p.y) * 4.0 - 1.5; if (abs(v) > 0.5) { discard; } color = tex_names(vec2f(p.x, (rw + (v + 0.5)) / 3.0));', blend: 'alpha', depth: { test: false, write: false } }));
  // the dots: a small sphere at 1.1 m on every walk cell, its colour by UTCI (instances with their own colour)
  const RAMP = ['#2c7bb6', '#00a6ca', '#90eb9d', '#f9d057', '#f29e2e', '#e76818', '#d7191c', '#7a0177'].map((h) => [parseInt(h.slice(1, 3), 16) / 255, parseInt(h.slice(3, 5), 16) / 255, parseInt(h.slice(5, 7), 16) / 255]);
  const ramp = (t: number) => { const u = Math.max(0, Math.min(1, t)) * 7, i = Math.min(6, Math.floor(u)), f = u - i; return [0, 1, 2].map((c) => RAMP[i]![c]! * (1 - f) + RAMP[i + 1]![c]! * f); };
  const sph: number[] = [], idx: number[] = [];
  for (let a = 0; a <= 6; a++) for (let o = 0; o <= 10; o++) { const th = (a / 6) * Math.PI, ph = (o / 10) * Math.PI * 2; sph.push(0.14 * Math.sin(th) * Math.cos(ph), 0.14 * Math.cos(th), 0.14 * Math.sin(th) * Math.sin(ph)); }
  for (let a = 0; a < 6; a++) for (let o = 0; o < 10; o++) { const p = a * 11 + o; idx.push(p, p + 11, p + 1, p + 1, p + 11, p + 12); }
  const cells = [] as { x: number; z: number; utci: number }[];
  for (let i = 0; i < dots.length; i += 4) { const x = dots[i]!, z = dots[i + 1]!, shade = z > 0 && Math.abs(z - 24) > 3 ? 0.35 : 0, utci = 48 - 10 * shade - (z > 0 ? 3 : 0) + 2 * Math.sin(x * 0.2); cells.push({ x, z, utci }); }
  extra.dots = cells.length;
  w.add(custom({ id: 'dots', geometry: { positions: sph, normals: sph.map((v) => v / 0.14), index: idx }, data: cells, at: (d) => [...ll(d.x, d.z), 1.1] as [number, number, number],
    attributes: { tone: (d) => ramp((d.utci - 20) / 36) }, varyings: { tone3: 'vec3f' }, vertex: 'tone3 = tone;', fragment: 'color = vec4f(tone3, 1.0);' }));
  // the dots' colour comes through a varying (instance attributes reach the vertex stage)
}

// ── 5. park access: arcs from houses to their park ───────────────────────────────────────────────────────────
function access(w: World): void {
  studio(w);
  const park: [number, number][] = [[60, -60], [110, -60], [110, -20], [60, -20]];
  w.add(area({ id: 'park', data: [{ id: 'p', props: { name: 'park' }, geometry: { type: 'Polygon', coordinates: [park.map(([x, z]) => ll(x, z))] } }] as never, color: '#2f5d50', opacity: 0.9 }));
  const houses = [[-32, -20], [0, -20], [32, -20], [-32, 20], [0, 20], [32, 20]];
  const pos: number[] = [], col: number[] = [];
  const RAMP = [[0x22, 0xc5, 0x5e], [0xfa, 0xcc, 0x15], [0xef, 0x44, 0x44]].map((c) => c.map((v) => v / 255));
  for (const [hx, hz] of houses) {
    const ex = Math.max(60, Math.min(110, hx!)), ez = Math.max(-60, Math.min(-20, hz!)), d = Math.hypot(ex - hx!, ez - hz!), t = Math.min(1, d / 160);
    const c = t < 0.5 ? RAMP[0]!.map((v, i) => v + (RAMP[1]![i]! - v) * t * 2) : RAMP[1]!.map((v, i) => v + (RAMP[2]![i]! - v) * (t - 0.5) * 2);
    const y0 = 6, y1 = 0.5, apex = Math.max(y0, y1) + Math.max(8, 0.22 * d);
    const P = (u: number) => [hx! + (ex - hx!) * u, (1 - u) ** 2 * y0 + 2 * u * (1 - u) * apex + u * u * y1, hz! + (ez - hz!) * u];
    for (let s = 0; s < 14; s++) { const u0 = s / 14, u1 = (s + 1) / 14, k = 0.55 + 0.45 * Math.sin(Math.PI * (u0 + u1) / 2); pos.push(...P(u0), ...P(u1)); col.push(...c.map((v) => v * k), 0.95, ...c.map((v) => v * k), 0.95); }
  }
  // the houses tinted by their walk to the park (green near, red far), the rest quiet
  (w.element('street') as unknown as { tint(fn: (i: { kind: string }) => readonly [number, number, number, number] | null): void }).tint((i) => (i.kind === 'building' ? [0.9, 0.75, 0.3, 0.55] : [0.32, 0.36, 0.42, 0.8]));
  w.add(custom({ id: 'arcs', primitive: 'lines', at: ll(0, 0), geometry: { positions: pos, colors: col }, blend: 'alpha' }));
}

// ── 7. your own geometry ────────────────────────────────────────────────────────────────────────────────────
function three(w: World): void {
  // a canvas texture, a cube with normals, uvs, colours and its own attribute, indexed
  const tex = new OffscreenCanvas(128, 128), tg = tex.getContext('2d')!;
  for (let i = 0; i < 8; i++) for (let j = 0; j < 8; j++) { tg.fillStyle = (i + j) % 2 ? '#f5f5f5' : '#2f81f7'; tg.fillRect(i * 16, j * 16, 16, 16); }
  const P: number[] = [], N: number[] = [], U: number[] = [], Cc: number[] = [], H: number[] = [], I: number[] = [];
  const face = (n: [number, number, number], u: [number, number, number], v: [number, number, number]) => { const b = P.length / 3; for (const [a, c] of [[-1, -1], [1, -1], [1, 1], [-1, 1]] as const) { P.push(n[0] * 3 + u[0] * a * 3 + v[0] * c * 3, 3 + n[1] * 3 + u[1] * a * 3 + v[1] * c * 3, n[2] * 3 + u[2] * a * 3 + v[2] * c * 3); N.push(...n); U.push((a + 1) / 2, (1 - c) / 2); Cc.push(1, 1, 1); H.push((c + 1) / 2); } I.push(b, b + 1, b + 2, b, b + 2, b + 3); };
  face([0, 0, 1], [1, 0, 0], [0, 1, 0]); face([0, 0, -1], [-1, 0, 0], [0, 1, 0]); face([1, 0, 0], [0, 0, -1], [0, 1, 0]); face([-1, 0, 0], [0, 0, 1], [0, 1, 0]); face([0, 1, 0], [1, 0, 0], [0, 0, -1]); face([0, -1, 0], [1, 0, 0], [0, 0, 1]);
  const cube = { positions: P, normals: N, uvs: U, colors: Cc, index: I, attributes: { up: { data: H, size: 1 as const } } };
  // textured, lit, instanced with a per-copy tint and a shader uniform (numbers, a vector, a colour)
  w.add(custom({ id: 'cubes', geometry: cube, data: [0, 1, 2, 3], at: (k) => [...ll(-30 + k * 12, 0), 0] as [number, number, number], attributes: { tint: (k) => [[1, 1, 1], [1, 0.6, 0.6], [0.6, 1, 0.6], [0.6, 0.7, 1]][k]! },
    uniforms: { photo: { image: tex }, gain: 1.0, lift: [0, 0.4, 0], glow: '#ffd166' }, varyings: { shine: 'f32', tinted: 'vec3f' },
    vertex: 'shine = up; tinted = tint; position = position + params.lift * up;', fragment: 'color = vec4f(tex_photo(uv).rgb * tinted * lambert(normal) * params.gain + params.glow * shine * 0.15, 1.0);' }));
  // lines (a net), points (round, sized in px), see-through blends: alpha, add, multiply; one with no depth test
  const lp: number[] = []; for (let i = -5; i <= 5; i++) lp.push(i * 3, 0.2, -15, i * 3, 0.2, 15, -15, 0.2, i * 3, 15, 0.2, i * 3);
  w.add(custom({ id: 'grid', primitive: 'lines', at: ll(0, 25), geometry: { positions: lp }, fragment: 'color = vec4f(0.5, 0.9, 1.0, 1.0);' }));
  const pp: number[] = [], pc: number[] = []; for (let i = 0; i < 200; i++) { const a = i * 0.7, r = 2 + i * 0.07; pp.push(Math.cos(a) * r, 1 + i * 0.05, Math.sin(a) * r); pc.push(i / 200, 0.4, 1 - i / 200); }
  w.add(custom({ id: 'spiral', primitive: 'points', pointSize: 10, at: ll(28, 22), geometry: { positions: pp, colors: pc }, fragment: 'if (length(corner) > 1.0) { discard; }' }));
  const sq = { positions: [-4, 0, 0, 4, 0, 0, 4, 8, 0, -4, 8, 0], index: [0, 1, 2, 0, 2, 3] };
  for (const [i, blend, color] of [[0, 'alpha', '[1.0, 0.3, 0.3, 0.5]'], [1, 'add', '[0.2, 0.6, 1.0, 1.0]'], [2, 'multiply', '[1.0, 0.8, 0.2, 1.0]']] as const) {
    w.add(custom({ id: `blend-${blend}`, at: [...ll(-24 + i * 12, 14), 0] as [number, number, number], geometry: sq, blend, side: 'double', fragment: `color = vec4f${color.replace('[', '(').replace(']', ')')};` }));
  }
  w.add(custom({ id: 'on-top', at: [...ll(16, 14), 0] as [number, number, number], geometry: sq, blend: 'alpha', depth: { test: false, write: false }, side: 'front', fragment: 'color = vec4f(1.0, 1.0, 1.0, 0.35);', order: 99 }));
  // a shape in every material: solid, wire, raw lines, ghost and a custom one that pulses with the clock
  const pulse = material.custom({ uniforms: { speed: 2 }, fragment: 'color = vec4f(color.rgb * (0.6 + 0.4 * sin(time * params.speed)), 1.0);' });
  const kit = shape({ id: 'materials-kit', params: {}, build: (b) => {
    b.solid('box', { size: 2, at: [0, 1, 0], color: '#d0d4da' });
    b.solid('sphere', { radius: 2, sides: 16, at: [5, 2, 0], color: '#7fdcff', material: 'wire' });
    b.mesh([[9, 0, 0], [9, 4, 0], [9, 4, 0], [11, 4, 0]], { lines: true, color: '#ffffff' });
    b.solid('box', { size: 2, at: [14, 1, 0], color: '#ffd166', material: material('ghost', { opacity: 0.4 }) });
    b.solid('box', { size: 2, at: [18, 1, 0], color: '#ff6b6b', material: pulse });
  } });
  const s = solids({ id: 'kit' }); s.put('kit', { origin: ll(-10, -16), at: [0, 0], instances: [{ shape: kit.make().levels, data: Float32Array.from([0, 0, 0, 0, 1, 1, 1, 0, 0xffffff, 0]) }], info: () => null }); w.add(s);
}

// ── 8. your own layer: a class extending Element, its program in WGSL and GLSL, drawn every frame ─────────────────
const PULSE_WGSL = /* wgsl */ `
struct Frame { viewProj: mat4x4f, eye: vec4f, size: vec4f }
@group(0) @binding(0) var<uniform> frame: Frame;
struct U { at: vec4f }
@group(0) @binding(1) var<uniform> u: U;
struct O { @builtin(position) pos: vec4f, @location(0) k: f32 }
@vertex fn vs(@builtin(vertex_index) i: u32) -> O {
  // six vertices a segment: two triangles between the inner and the outer circle
  let c = i % 6u;
  let seg = f32(i / 6u + select(0u, 1u, c == 2u || c == 3u || c == 5u));
  let outer = select(0.0, 1.0, c == 1u || c == 4u || c == 5u);
  let a = seg / 64.0 * 6.2831853;
  let r = u.at.w * (0.9 + 0.1 * outer) * (0.75 + 0.25 * sin(frame.eye.w * 2.0));
  var o: O;
  o.pos = frame.viewProj * vec4f(u.at.xyz + vec3f(cos(a) * r, 0.5, sin(a) * r), 1.0);
  o.k = outer;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f { return vec4f(0.3 + 0.7 * i.k, 0.8, 1.0, 1.0); }
`;
const PULSE_GLSL = {
  vertex: /* glsl */ `#version 300 es
precision highp float;
layout(std140) uniform Frame { mat4 viewProj; vec4 eye; vec4 size; } frame;
layout(std140) uniform U { vec4 at; } u;
out float k;
void main() {
  int c = gl_VertexID % 6;
  float seg = float(gl_VertexID / 6 + ((c == 2 || c == 3 || c == 5) ? 1 : 0));
  float outer = (c == 1 || c == 4 || c == 5) ? 1.0 : 0.0;
  float a = seg / 64.0 * 6.2831853;
  float r = u.at.w * (0.9 + 0.1 * outer) * (0.75 + 0.25 * sin(frame.eye.w * 2.0));
  gl_Position = frame.viewProj * vec4(u.at.xyz + vec3(cos(a) * r, 0.5, sin(a) * r), 1.0);
  gl_Position.z = gl_Position.z * 2.0 - gl_Position.w;
  k = outer;
}`,
  fragment: /* glsl */ `#version 300 es
precision highp float;
in float k;
out vec4 outColor;
void main() { outColor = vec4(0.3 + 0.7 * k, 0.8, 1.0, 1.0); }`,
};
class PulseRing extends Element<{ id?: string; at: [number, number]; radius: number }> {
  readonly kind = 'custom' as const;
  private prog: Program | null = null; private ubuf: GBuffer | null = null;
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    const g = ctx.graphics; if (!g) return;
    this.ubuf = g.buffer('uniform', 16, 'pulse');
    this.prog = g.program({ label: 'pulse ring', wgsl: PULSE_WGSL, glsl: PULSE_GLSL, blocks: ['Frame', 'U'], depth: { write: true, test: 'less' }, cull: 'none' });
    await this.prog.ready;
  }
  frame(ctx: FrameContext): DrawCall[] {
    if (!this.prog || !this.ubuf) return [];
    const k = 6378137 * Math.cos(ctx.camera.lat * Math.PI / 180), x = k * (this.props.at[0] - ctx.camera.lon) * Math.PI / 180, z = -6378137 * (Math.log(Math.tan(Math.PI / 4 + this.props.at[1] * Math.PI / 360)) - Math.log(Math.tan(Math.PI / 4 + ctx.camera.lat * Math.PI / 360))) * Math.cos(ctx.camera.lat * Math.PI / 180);
    this.ubuf.write(Float32Array.from([x, ctx.camera.groundY, z, this.props.radius]));
    return [{ program: this.prog, blocks: [ctx.frame, this.ubuf], count: 64 * 6 }];
  }
  override animating(): boolean { return true; }
  override detach(): void { this.prog?.destroy(); this.ubuf?.destroy(); this.prog = null; this.ubuf = null; super.detach(); }
}

void main().catch((e) => { document.querySelector('#note')!.textContent = String((e as Error).message ?? e); console.error(e); });
void text;

// ── 9. a surface field: values on walls and roofs (aslnut draws them; the values are made up here) ────────────────
/** a block of rectangular buildings round the centre (m east, south): a grid of plots, seeded sizes and heights */
function blocks(n: number, seed: number): { id: string; ring: [number, number][]; h: number }[] {
  const rnd = new Rng(seed), side = Math.ceil(Math.sqrt(n)), plot = 34, out: { id: string; ring: [number, number][]; h: number }[] = [];
  for (let k = 0; k < n; k++) {
    const i = k % side, j = Math.floor(k / side), x = (i - side / 2) * plot + rnd.range(-2, 2), z = (j - side / 2) * plot + rnd.range(-2, 2), wd = rnd.range(14, 24), dp = rnd.range(12, 22);
    out.push({ id: `b${k}`, ring: [[x, z], [x + wd, z], [x + wd, z + dp], [x, z + dp], [x, z]], h: rnd.chance(0.15) ? rnd.range(40, 70) : rnd.range(8, 26) });
  }
  return out;
}
const asFeatures = (bs: { id: string; ring: [number, number][]; h: number }[]) => bs.map((b) => ({ id: b.id, props: { height: b.h }, geometry: { type: 'Polygon' as const, coordinates: [b.ring.map(([x, z]) => ll(x, z))] } }));
/** a made-up warmth: walls by how much they face the north-east (0.25 … 0.85), the higher up the warmer, roofs warm */
const warmth: SurfaceFn = (_b, facet, n, at) => (facet === 'roof' ? 1 : 0.2 + 0.3 * (1 + 0.7071 * (n[0] + n[1]))) + Math.min(0.15, at[2] / 300);
function surfaceScene(w: World, extra: Record<string, unknown>): void {
  const n = Number(q.get('n') ?? 400), bs = blocks(n, 11);
  w.add(buildings({ id: 'block', data: asFeatures(bs) as never, windows: false }));
  if (q.get('field') !== '0') {
    w.add(field({ id: 'warmth', kind: 'surface', on: 'block', values: warmth, draw: { ramp: 'plasma', domain: [0.15, 1.15] } }));
    legend(w, { for: 'warmth', title: 'made-up warmth (facet, height)', position: 'bottom-right' });
  }
  // (the smoke reads the middle of two walls of the building nearest the centre: its south face and its east face)
  const b = bs.reduce((a, c) => (Math.hypot(c.ring[0]![0] + 10, c.ring[0]![1] + 10) < Math.hypot(a.ring[0]![0] + 10, a.ring[0]![1] + 10) ? c : a));
  const [x0, z0] = b.ring[0]!, [x1] = b.ring[1]!, [, z2] = b.ring[2]!;
  extra.walls = { south: [...ll((x0 + x1) / 2, z2), b.h * 0.4], east: [...ll(x1, (z0 + z2) / 2), b.h * 0.4], building: b.id };
}

// ── 10. epochs: 24 hourly grids of a moving warm patch, morphed by the clock, on the ground and on the buildings ────
function epochsScene(w: World, extra: Record<string, unknown>): void {
  const H = 3600e3, day = Date.UTC(2026, 0, 14, 13), size = 900, res = 10, cells = size / res;
  // where the patch is at hour h (m east, south of the centre): round the district once a day
  const centreAt = (h: number): [number, number] => [Math.cos((h / 24) * 2 * Math.PI) * 260, Math.sin((h / 24) * 2 * Math.PI) * 260];
  const warmAt = (h: number, x: number, z: number) => { const [cx, cz] = centreAt(h); return 22 + 16 * Math.exp(-((x - cx) ** 2 + (z - cz) ** 2) / (2 * 140 ** 2)); };
  const grid = (h: number) => { const g = new Float32Array(cells * cells); for (let j = 0; j < cells; j++) for (let i = 0; i < cells; i++) g[j * cells + i] = warmAt(h, (i + 0.5) * res - size / 2, (j + 0.5) * res - size / 2); return g; };
  // (each hour loaded when the clock comes near it: a function of no parameters)
  const hours = Array.from({ length: 24 }, (_, h) => h);
  const ground = data.epochs(hours.map((h) => ({ at: day + h * H, source: () => grid(h) })), { blend: 'morph' });
  const walls = data.epochs<SurfaceFn>(hours.map((h) => ({ at: day + h * H, source: ((_b, facet, _n, at) => warmAt(h, (at[0] - CLAYTON[0]) * kx, (CLAYTON[1] - at[1]) * KZ) + (facet === 'roof' ? 3 : 0)) as SurfaceFn })), { blend: 'morph' });
  w.add(buildings({ id: 'district', data: asFeatures(blocks(144, 5)) as never, windows: false }));
  w.add(field({ id: 'warm', res, area: { centre: CLAYTON, size }, data: ground, draw: { ramp: 'inferno', domain: [20, 42], opacity: 0.8 } }));
  w.add(field({ id: 'warm-walls', kind: 'surface', on: 'district', data: walls, draw: { ramp: 'inferno', domain: [20, 42] } }));
  legend(w, { for: 'warm', title: 'made-up warmth (°C)', position: 'bottom-right' });
  const p = replay(w, { from: ground.from, to: ground.to, speed: Number(q.get('speed') ?? 1800), loop: true });
  p.seek(day + Number(q.get('t') ?? 7.5) * H);
  // the time slider: the hour of the day, and play
  const ui = document.createElement('div');
  ui.style.cssText = 'position:fixed;left:8px;right:8px;top:calc(46px + env(safe-area-inset-top));display:flex;gap:8px;align-items:center;z-index:5;background:rgba(10,14,22,.8);border-radius:7px;padding:6px 9px';
  ui.innerHTML = '<button id="ep-play" style="font:inherit">play</button><input id="ep-t" type="range" min="0" max="23" step="0.05" style="flex:1"><output id="ep-h" style="min-width:3.2em"></output>';
  document.body.appendChild(ui);
  const t = ui.querySelector<HTMLInputElement>('#ep-t')!, out = ui.querySelector('output')!, play = ui.querySelector<HTMLButtonElement>('#ep-play')!;
  const show = () => { const h = (w.time.getTime() - day) / H; t.value = String(h); out.textContent = `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };
  t.oninput = () => { p.seek(day + Number(t.value) * H); show(); };
  play.onclick = () => { p.toggle(); play.textContent = p.playing ? 'pause' : 'play'; };
  p.on(() => show()); w.on('frame', () => { if (p.playing) show(); }); show();
  extra.epochs = { day, H, playback: p, hotAt: (h: number) => { const [cx, cz] = centreAt(h); return ll(cx, cz); } };
}

// ── 11. params by level: points sized and coloured by the level, a field whose res and area follow it ─────────────
function levelsScene(w: World, extra: Record<string, unknown>): void {
  const rng = new Rng(11), centre = ll(0, 0);
  // made-up places over 10 km: a ring of them round the centre, denser near it
  const places = Array.from({ length: 240 }, (_, k) => { const r = 150 + 4800 * rng.next() ** 2, a = rng.next() * 2 * Math.PI; return { id: `p${k}`, at: ll(Math.cos(a) * r, Math.sin(a) * r) }; });
  w.add(points({ id: 'clinics', data: places, at: (d) => d.at,
    size: { level: { district: 6, street: 14 } }, color: { level: { city: '#ffd166', street: '#ef476f' } }, outline: { width: 1, color: '#111827' } }));
  // a warm patch, smoothed once (its state is its own, not its init): a finer grid near, a coarser one over more
  // ground far, about the same cells at each level
  const flood = field({ id: 'flood', rule: rules.diffusion({ k: 40 }),
    res: { level: { street: 2, district: 8, city: 32 } },
    area: { level: { street: { centre, size: 600 }, district: { centre, size: 2400 }, city: { centre, size: 12000 } } },
    init: (lon, lat) => { const x = (lon - centre[0]) * kx, z = (centre[1] - lat) * KZ; return Math.exp(-(x * x + z * z) / (2 * 260 ** 2)) + 0.6 * Math.exp(-((x - 520) ** 2 + (z + 320) ** 2) / (2 * 240 ** 2)); },
    draw: { ramp: 'viridis', domain: [0, 1], min: 0.02, opacity: 0.75 } });
  w.add(flood);
  flood.step(600);
  // every setProps an element gets is heard (the world's 'elements' event, what: 'props'): the measure of applies
  const applies: Record<string, number> = { clinics: 0, flood: 0 };
  w.on('elements', (e) => { if (e.what === 'props') for (const id of e.ids) if (id in applies) applies[id]!++; });
  extra.levels = { applies, centre };
}
