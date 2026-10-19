// Feature demos (?go=regions | fleet | flows | story | city | players, their flights and parity twins): regions three
// levels deep with rollups and drill-down, a fleet replayed over time, flows as arcs on the globe, a scripted story,
// a city probe (walkability, parks, walks, shade) and players on a plane, built from aslnut alone, on WebGPU and
// WebGL2 alike.
// Data: Java's provinces and regencies (BIG, simplified) with MOCK districts and MOCK numbers; Melbourne's main roads
// (© OpenStreetMap contributors, ODbL) with a MOCK fleet and chargers; the world's countries and cities (Natural Earth,
// public domain) with MOCK flows. All prepared by tools/demo-data-regions.mjs and tools/demo-data-fleet.mjs.
import {
  arc, area, custom, data, earth, earthLite, extrusion, geo, imagery, layer, legend, line, plane, planeAt, points, regions, scale, terrain, text, trail,
  type Body, type LevelSpec, type Feature, type Element, type LegendHandle, type View, type World, type WorldState,
} from '../../src/index.ts';
import { plainImagery, type DemoPreset } from './demos.ts';
import * as heatShader from './heat.shader.ts';
import { blocks, cells, rng } from './mock.ts';

const PACK = '/aslnut/data/packs/demo';
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };
const lite = () => earthLite({ url: '/aslnut/data/packs/earth-lite', maxZoom: 4, attribution: 'Sentinel-2 cloudless 2020 by EOX (CC BY 4.0)' });
const BIG = 'Badan Informasi Geospasial (BIG)';
const centre = (f: Feature): [number, number] => { let x = 0, y = 0, n = 0; const walk = (c: unknown): void => { if (typeof (c as number[])[0] === 'number') { x += (c as number[])[0]!; y += (c as number[])[1]!; n++; } else (c as unknown[]).forEach(walk); }; walk((f.geometry as { coordinates: unknown }).coordinates); return [x / Math.max(1, n), y / Math.max(1, n)]; };
const param = (w: World, key: string, spec: Parameters<World['param']>[1], v0: unknown) => { try { w.get(key); return; } catch { /* new */ } let v = v0; w.param(key, spec, (x) => { v = x; }, () => v); };

// ═══ 1 · regions: province → regency → district, a joined indicator, a category, drill-down, answers ═══════════════
const SECTORS = { agriculture: '#84cc16', industry: '#64748b', services: '#38bdf8', fisheries: '#06b6d4' } as const;
const GLYPH: Record<string, string> = { agriculture: '✿', industry: '⚙', services: '⌂', fisheries: '⚓' };
const CITIES: [number, number][] = [[106.85, -6.21], [112.75, -7.25], [107.61, -6.91], [110.42, -6.97]];
/** the mock indicator API: per district, people, stunting %, the leading sector */
function districtRows(districts: readonly Feature[]) {
  return districts.map((f) => {
    const c = centre(f), near = Math.min(...CITIES.map((k) => Math.hypot(k[0] - c[0], k[1] - c[1]))), h = hash(String(f.id)), coast = c[1] > -6.45 || c[1] < -8.05;
    const city = String(f.props.name).startsWith('Kota') || near < 0.12;
    const sector = near < 0.18 ? (h < 0.6 ? 'services' : 'industry') : coast && h < 0.45 ? 'fisheries' : h < 0.2 ? 'industry' : h < 0.32 ? 'services' : 'agriculture';
    const stunting = Math.round((13 + 17 * Math.min(1, near / 1.6) + 8 * (hash(`${f.id}s`) - 0.5) + (f.props.province === '35' ? 3 : f.props.province === '36' ? 4 : 0)) * 10) / 10;
    return { id: String(f.id), code: String(f.id), regency: String(f.props.regency), province: String(f.props.province), name: String(f.props.name), people: Math.round((city ? 90 : 35) * 1000 * (0.5 + h)), stunting, sector };
  });
}
const majority = (rows: Record<string, unknown>[], k: string, w: string) => { const m = new Map<string, number>(); for (const r of rows) m.set(String(r[k]), (m.get(String(r[k])) ?? 0) + Number(r[w] ?? 1)); return [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null; };
const weighted = (rows: Record<string, unknown>[], k: string, w: string) => { let s = 0, n = 0; for (const r of rows) { s += Number(r[k]) * Number(r[w]); n += Number(r[w]); } return n ? Math.round((s / n) * 10) / 10 : null; };

function regionsLayers(o: { parity?: boolean } = {}) {
  const provinces = data.geojson(`${PACK}/java-provinces.geojson`, { id: 'code', attribution: `${BIG} (simplified)` });
  const regencies = data.geojson(`${PACK}/java-regencies.geojson`, { id: 'code', attribution: `${BIG}, kabupaten / kota 1:50.000 (simplified)` });
  const districts = data.geojson(`${PACK}/java-districts.geojson`, { id: 'code', attribution: 'mock districts' });
  // the indicator rows per district: a query (here a mock API), sector added as a category
  const rows = data.custom({ id: 'id', load: async (ctx) => { await districts.start(ctx); return districtRows(districts.features()); } });
  const tree = regions.tree({ levels: ['province', 'regency', 'district'], sources: { province: provinces, regency: regencies, district: districts }, parentOf: { regency: (f) => f.props.province, district: (f) => f.props.regency } });
  const up = (to: string) => tree.rollup(rows, { on: 'code', to, sum: ['people'], fn: (rs) => ({ stunting: weighted(rs, 'stunting', 'people'), sector: majority(rs, 'sector', 'people'), districts: rs.length }) });
  const byRegency = up('regency'), byProvince = up('province');
  const stunting = scale.threshold((d: Feature) => d.props.stunting as number, { domain: [16, 20, 24, 28], range: 'ylorrd' });
  const sector = scale.category((d: Feature) => d.props.sector as string, { map: SECTORS });
  const P = (s: { world: { params: Record<string, unknown> } }) => String(s.world.params['regions.province'] ?? ''), Rg = (s: { world: { params: Record<string, unknown> } }) => String(s.world.params['regions.regency'] ?? '');
  const tip = (level: string) => (d: Feature) => `${d.props.name} (${level})\nstunting ${d.props.stunting ?? '–'} % · ${d.props.sector ?? '–'}\n${Math.round(Number(d.props.people ?? 0) / 1000).toLocaleString()} k people${d.props.districts ? ` · ${d.props.districts} districts` : ''}`;
  const look = { opacity: 0.78, outline: { width: 1, color: '#ffffff99' }, hover: { color: '#ffffff', mix: 0.3, outline: 3 }, selected: { color: '#ffd166', mix: 0.45, outline: 3.5 }, transition: 0.5 } as const;
  const glyph = (id: string, src: Parameters<typeof text<Feature>>[0]['data'], when: (d: Feature, s: never) => boolean, level?: LevelSpec) =>
    text({ id, data: src, text: (d) => GLYPH[String(d.props.sector)] ?? null, size: 15, color: '#ffffff', halo: { width: 3, color: '#0b1220cc' }, collide: 'own', feature: { when: when as never }, ...(level ? { when: { level } } : {}), pickable: false });
  const provData = provinces.join(byProvince, { on: 'id' }), regData = regencies.join(byRegency, { on: 'id' }), disData = districts.join(rows, { on: 'code' });
  return {
    provinces, regencies, districts, rows, tree, byRegency, byProvince, scales: { stunting, sector },
    layers: [
      area({ id: 'provinces', data: provData, color: stunting, ...look, tooltip: tip('province'), feature: { when: (d, s) => P(s) !== String(d.id) }, reveal: o.parity ? undefined : { mode: 'radial', dur: 0.9 } }),
      area({ id: 'regencies', data: regData, color: stunting, ...look, tooltip: tip('regency'), when: (s) => P(s) !== '', feature: { when: (d, s) => d.props.province === P(s) && Rg(s) !== String(d.id) }, reveal: o.parity ? undefined : { mode: 'wipe', dur: 0.7 } }),
      area({ id: 'districts', data: disData, color: stunting, ...look, outline: { width: 0.8, color: '#ffffff88' }, tooltip: tip('district, mock'), when: (s) => Rg(s) !== '', feature: { when: (d, s) => d.props.regency === Rg(s) }, reveal: o.parity ? undefined : { mode: 'pop', dur: 0.5, stagger: 0.02 } }),
      line({ id: 'province-lines', data: provinces, width: 1.8, color: '#f8fafc', pickable: false }),
      glyph('province-glyphs', provData, (d, s) => P(s) !== String(d.id)),
      glyph('regency-glyphs', regData, (d, s) => d.props.province === P(s as never) && Rg(s as never) !== String(d.id), { from: 'region' }),
      glyph('district-glyphs', disData, (d, s) => d.props.regency === Rg(s as never), { from: 'city' }),
      layer({ id: 'province-names', data: provinces, when: (s) => P(s) === '', labels: { text: (d) => d.props.name, size: 12, offset: [0, 14], pickable: false } }),
      layer({ id: 'regency-names', data: regencies, when: { level: { from: 'region' } }, labels: { text: (d) => String(d.props.name).replace(/^Kab\. /, ''), size: 10.5, offset: [0, 13], feature: { when: (d, s) => d.props.province === P(s) && Rg(s) === '' }, pickable: false } }),
      layer({ id: 'district-names', data: districts, when: { level: { from: 'city' } }, labels: { text: (d) => d.props.name, size: 10, offset: [0, 13], feature: { when: (d, s) => d.props.regency === Rg(s) }, pickable: false } }),
    ] as Element[],
  };
}
const javaView: View = { lon: 110.2, lat: -7.25, zoom: 6.6, tilt: 25, bearing: 0 };
let lastRegions: ReturnType<typeof regionsLayers> | null = null;
function regionsParams(w: World): void {
  param(w, 'regions.province', { type: 'text', default: '', describe: 'the province drilled into (code)' }, '');
  param(w, 'regions.regency', { type: 'text', default: '', describe: 'the regency drilled into (code)' }, '');
  param(w, 'regions.metric', { type: 'enum', default: 'stunting', options: ['stunting', 'sector'] }, 'stunting');
}
/** colour every level by the metric (a layer prop change: they restyle with a transition) */
function setMetric(w: World, g: ReturnType<typeof regionsLayers>, m: string): void {
  const c = m === 'sector' ? g.scales.sector : g.scales.stunting;
  for (const id of ['provinces', 'regencies', 'districts']) w.element(id).setProps({ color: c } as never);
}
function regionsUI(w: World, el: HTMLElement): void {
  const g = lastRegions!; regionsParams(w);
  const narrow = innerWidth < 700, slot = document.createElement('div');
  let lg: LegendHandle | null = null;
  const showLegend = () => { lg?.remove(); const m = String(w.get('regions.metric')); lg = legend(w, { for: m === 'sector' ? g.scales.sector as never : g.scales.stunting as never, title: m === 'sector' ? 'Leading sector (by people)' : 'Stunting, % of under-fives (mock)', position: 'bottom-left', ...(narrow ? { into: slot } : {}) }); };
  el.innerHTML = `<div class="row"><span id="crumbs" class="why">Java</span><button id="up">↑ up</button></div>
    <div class="row"><button data-m="stunting" class="on">stunting %</button><button data-m="sector">leading sector</button></div>
    <div class="q"><button data-q="0">Which regency of West Java has the most stunting?</button><button data-q="1">What leads in Kabupaten Bandung's districts?</button><button data-q="2">All of Java, by sector</button></div>
    <div id="info" class="why">tap a province, then a regency</div>`;
  if (narrow) el.prepend(slot);
  const $ = (s: string) => el.querySelector(s) as HTMLElement;
  const crumbs = () => {
    const p = String(w.get('regions.province')), r = String(w.get('regions.regency'));
    const pn = p ? g.provinces.get(p)?.props.name : null, rn = r ? g.regencies.get(r)?.props.name : null;
    $('#crumbs').textContent = ['Java', pn, rn].filter(Boolean).join(' › ');
  };
  const drill = async (level: 'province' | 'regency' | null, id: string) => {
    if (level === 'province') { w.set('regions.province', id); w.set('regions.regency', ''); }
    else if (level === 'regency') w.set('regions.regency', id);
    crumbs();
    const f = level === 'province' ? g.provinces.get(id) : level === 'regency' ? g.regencies.get(id) : null;
    if (f) await w.fit(f, { padding: 0.06, tilt: 30, seconds: 1.6, ease: 'cinematic' }); else await w.fly(javaView, { seconds: 1.4, ease: 'cinematic' });
  };
  $('#up').onclick = () => { const r = String(w.get('regions.regency')), p = String(w.get('regions.province')); if (r) void drill('province', p); else if (p) { w.set('regions.province', ''); void drill(null, ''); } };
  el.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => { b.onclick = () => { w.set('regions.metric', b.dataset.m!); setMetric(w, g, b.dataset.m!); showLegend(); el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', x === b)); }; });
  w.on('tap', (f) => {
    if (!f) return;
    $('#info').textContent = `${f.props.name}: stunting ${f.props.stunting ?? '–'} % · ${f.props.sector ?? '–'}`;
    if (f.element === 'provinces') void drill('province', String(f.id));
    else if (f.element === 'regencies') void drill('regency', String(f.id));
  });
  // each question's answer is a state (plain JSON: a server or an assistant could send it)
  const answers: (() => Promise<WorldState>)[] = [
    async () => { await g.byRegency.ready; const best = g.byRegency.features().filter((f) => g.regencies.get(f.id)?.props.province === '32').sort((a, b) => Number(b.props.stunting) - Number(a.props.stunting))[0]!;
      return { v: 1, note: 'Which regency of West Java has the most stunting?', elements: {}, view: w.viewToFit(g.provinces.get('32')!, { tilt: 30, padding: 0.04 }), params: { 'regions.province': '32', 'regions.regency': '', 'regions.metric': 'stunting' }, selection: [String(best.id)] }; },
    async () => ({ v: 1, note: "What leads in Kabupaten Bandung's districts?", elements: {}, view: w.viewToFit(g.regencies.get('32.04')!, { tilt: 35, padding: 0.05 }), params: { 'regions.province': '32', 'regions.regency': '32.04', 'regions.metric': 'sector' }, selection: [] }),
    async () => ({ v: 1, note: 'All of Java, by sector', elements: {}, view: { lon: 110.2, lat: -7.25, zoom: 6.6, tilt: 25, bearing: 0 }, params: { 'regions.province': '', 'regions.regency': '', 'regions.metric': 'sector' }, selection: [] }),
  ];
  el.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) => { b.onclick = async () => {
    el.querySelectorAll('[data-q]').forEach((x) => x.classList.toggle('on', x === b));
    const s = await answers[Number(b.dataset.q)]!();
    const m = String(s.params?.['regions.metric']); setMetric(w, g, m); el.querySelectorAll('[data-m]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.m === m));
    await w.apply(s, { seconds: 2.2, ease: 'cinematic' }); crumbs(); showLegend();
    const sel = s.selection?.[0]; $('#info').textContent = `${s.note}${sel ? ` → ${g.regencies.get(sel)?.props.name ?? sel}` : ''}`;
  }; });
  showLegend(); crumbs();
}
const regionsBody = () => earth({ imagery: [imagery.sentinel()], terrain: [terrain.mapzen()], base: lite(), exaggerate: 2, surface: { grade: { saturation: 0.35, brightness: 0.6 } } });

// ═══ 2 · a fleet replay: trails over time, vehicles, chargers live, a time scrubber, follow a vehicle ═══════════════
const T0 = Date.UTC(2026, 9, 11, 19, 0, 0), T1 = T0 + 3 * 3600e3;
const KIND = { taxi: '#facc15', delivery: '#f97316', rideshare: '#a78bfa', bus: '#22d3ee' } as const;
/** where a vehicle is at time t (its samples every dt seconds) */
function positionAt(f: Feature, t: number): [number, number] | null {
  const c = (f.geometry as { coordinates: [number, number][] } | null)?.coordinates, dt = f.props.dt as number[] | undefined; if (!c?.length || !dt) return null;
  const s = (t - Number(f.props.t0)) / 1000, step = dt[1]! - dt[0]!, i = Math.max(0, Math.min(c.length - 1, Math.floor(s / step))), k = Math.max(0, Math.min(1, s / step - i)), a = c[i]!, b = c[Math.min(c.length - 1, i + 1)]!;
  return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k];
}
function socAt(f: Feature, t: number): number { const soc = f.props.soc as number[], dt = f.props.dt as number[]; const i = Math.max(0, Math.min(soc.length - 1, Math.round((t - Number(f.props.t0)) / 1000 / (dt[1]! - dt[0]!)))); return soc[i]!; }
function fleetLayers(o: { parity?: boolean } = {}) {
  const fleet = data.geojson(`${PACK}/melbourne-fleet.geojson`, { id: 'id', attribution: 'mock fleet on OpenStreetMap roads' });
  const roads = data.geojson(`${PACK}/melbourne-roads.geojson`, { attribution: '© OpenStreetMap contributors (ODbL)' });
  const chargerShapes = data.geojson(`${PACK}/melbourne-chargers.geojson`, { id: 'id' });
  // the vehicles: rows moved to the world's time each frame (a replay; a live feed would upsert the same rows)
  const vehicles = data.rows<Record<string, unknown>>([], { id: 'id' });
  // the chargers' ports in use: a live stream (mock: a message every second; a websocket URL works the same)
  const busy = data.stream<Record<string, unknown>>({ id: 'id', connect: (emit) => {
    const tick = () => { const list = chargerShapes.features(); if (!list.length) return; const t = Math.floor(Date.now() / 1000); emit({ upsert: list.map((f, i) => ({ id: String(f.id), busy: Math.floor(((Math.sin(t / 7 + i * 1.7) + 1) / 2) * (Number(f.props.ports) + 0.99)) })) }); };
    tick(); if (o.parity) return () => {}; const h = setInterval(tick, 1000); return () => clearInterval(h);
  } });
  const chargers = chargerShapes.join(busy, { on: 'id' });
  return {
    fleet, vehicles, chargers, busy,
    layers: [
      line({ id: 'roads', data: roads, width: 1.1, color: '#cbd5e155', pickable: false, when: { level: { from: 'city' } } }),
      // the fleet loads as the camera comes close (each layer's data loads when its `when` first lets it show)
      trail({ id: 'trails', data: fleet, times: (d) => (d.props.dt as number[]).map((s) => Number(d.props.t0) + s * 1000), window: 900, head: 0.7, width: 2.4, when: { level: { from: 'region' } }, color: scale.category((d: Feature) => d.props.kind as string, { map: KIND }), tooltip: (d) => `${d.id} · ${d.props.kind}`, select: 'tap' }),
      points({ id: 'chargers', data: chargers, size: (d) => 7 + Number(d.props.kw) / 60, color: scale.threshold((d: Feature) => Number(d.props.busy ?? 0) / Number(d.props.ports), { domain: [0.5, 0.99], range: ['#22c55e', '#f59e0b', '#ef4444'] }), outline: { color: '#0b1220', width: 2 }, when: { level: { from: 'region' } }, tooltip: (d) => `${d.props.name} · ${d.props.kw} kW\n${d.props.busy ?? '–'} of ${d.props.ports} ports in use (live)`, transition: 0.4 }),
      // the vehicles move along their paths by the world's time, on their own (no rows set per frame)
      points<Feature>({ id: 'vehicles', data: fleet, along: { times: (d) => (d.props.dt as number[]).map((s) => Number(d.props.t0) + s * 1000) }, size: 8, color: scale.category((d: Feature) => d.props.kind as string, { map: KIND }), outline: { color: '#ffffff', width: 1.5 }, transition: 0, when: { level: { from: 'region' } }, tooltip: (d, s) => `${d.id} · ${d.props.kind}\nbattery ${socAt(d, s.time.now.getTime())} %`, select: 'tap' }),
    ] as Element[],
  };
}
let lastFleet: ReturnType<typeof fleetLayers> | null = null;
/** move the vehicles to the world's time */
function moveFleet(_w: World, _f: ReturnType<typeof fleetLayers>): void { /* the vehicles follow the world's time by themselves (points along) */ }
function fleetUI(w: World, el: HTMLElement): void {
  const f = lastFleet!;
  const narrow = innerWidth < 700, slot = document.createElement('div');
  legend(w, { for: 'trails', title: 'Vehicles by kind', position: 'bottom-left', ...(narrow ? { into: slot } : {}) });
  const clock = (t: number) => new Date(t + 11 * 3600e3).toISOString().slice(11, 16);
  el.innerHTML = `<div class="row"><button id="play">▶</button><input id="tm" type="range" min="0" max="${(T1 - T0) / 1000}" step="10" value="0"><b id="tv">06:00</b></div>
    <div class="row"><button data-x="60" class="on">×60</button><button data-x="240">×240</button><button id="stop" disabled>stop following</button></div>
    <div id="info" class="why">tap a vehicle to follow it · chargers update live</div>`;
  if (narrow) el.prepend(slot);
  const $ = (s: string) => el.querySelector(s) as HTMLElement;
  // the clock starts paused: nothing moves until ▶ (&play=1: the tools)
  let playing = new URLSearchParams(location.search).get('play') === '1', speed = 60;
  if (playing) $('#play').textContent = '❚❚';
  const tm = $('#tm') as HTMLInputElement;
  const show = () => { const t = w.time.getTime(); tm.value = String(Math.round((t - T0) / 1000)); $('#tv').textContent = clock(t); };
  tm.oninput = () => { w.setTime(new Date(T0 + Number(tm.value) * 1000)); moveFleet(w, f); $('#tv').textContent = clock(w.time.getTime()); };
  $('#play').onclick = () => { playing = !playing; $('#play').textContent = playing ? '❚❚' : '▶'; };
  el.querySelectorAll<HTMLButtonElement>('[data-x]').forEach((b) => { b.onclick = () => { speed = Number(b.dataset.x); el.querySelectorAll('[data-x]').forEach((x) => x.classList.toggle('on', x === b)); }; });
  // the clock runs on the display's frames while playing (a paused fleet asks for no frames at all)
  let n = 0, last = 0;
  const run = (now: number) => {
    if (w.isDisposed) return;
    const dt = last ? Math.min(250, now - last) : 0; last = now;
    if (playing && dt) { let t = w.time.getTime() + dt * speed; if (t > T1) t = T0; w.setTime(new Date(t)); if (n++ % 10 === 0) show(); }
    requestAnimationFrame(run);
  };
  requestAnimationFrame(run);
  const following = { id: '' };
  $('#stop').onclick = () => { w.follow(null); following.id = ''; ($('#stop') as HTMLButtonElement).disabled = true; w.select(null); };
  w.on('tap', (p) => {
    if (!p || (p.element !== 'vehicles' && p.element !== 'trails')) return;
    const id = String(p.id), v = f.fleet.get(id); if (!v) return;
    following.id = id; w.select([id]);
    w.follow(() => positionAt(v, w.time.getTime()), { smooth: 300 }); ($('#stop') as HTMLButtonElement).disabled = false;
    $('#info').textContent = `following ${id} (${v.props.kind}) · drag the map to stop`;
    if (!playing) $('#play').click();
  });
}
const melbourne: View = { lon: 144.98, lat: -37.83, zoom: 10.3, tilt: 40, bearing: 0 };
const fleetBody = () => earth({ imagery: [imagery.sentinel()], terrain: [terrain.mapzen()], base: lite(), surface: { grade: { saturation: 0.3, brightness: 0.45, contrast: 1.1 } } });

// ═══ 3 · flows: countries (a choropleth of real populations), flows as arcs, labels, globe ↔ flat ═══════════════════
interface City { name: string; lon: number; lat: number; kind: string; country: string; pop: number; rank: number }
let cityList: City[] = [];
const cities = data.custom({ id: 'name', load: async (ctx) => { const r = await ctx.loader.get<{ cities: City[] }>(`${PACK}/world-cities.json`, { kind: 'json' }); cityList = r?.cities ?? []; return cityList; } });
const HUBS = ['Jakarta', 'Surabaya', 'Bandung', 'Medan', 'Makassar'];
/** mock flows: from Indonesia's big cities to the world's (people moving, songs streamed, calls…) */
function flowRows(list: City[]) {
  const from = list.filter((c) => HUBS.includes(c.name)), to = list.filter((c) => c.kind === 'capital' && c.rank <= 3 && c.country !== 'Indonesia' && c.lon > -30).slice(0, 60);
  const out: Record<string, unknown>[] = [];
  for (const a of from) for (const b of to) { const h = hash(`${a.name}|${b.name}`); if (h < 0.18) out.push({ id: `${a.name}→${b.name}`, from: a.name, to: b.name, olon: a.lon, olat: a.lat, dlon: b.lon, dlat: b.lat, n: Math.round(200 + 9800 * h ** 2 / 0.0324), kind: ['work', 'study', 'family'][Math.floor(h * 100) % 3] }); }
  return out;
}
function flowsLayers(o: { parity?: boolean } = {}) {
  const countries = data.geojson(`${PACK}/world-countries.geojson`, { id: 'code', attribution: 'Natural Earth (public domain)' });
  const flows = data.custom({ id: 'id', load: async (ctx) => { await cities.start(ctx); return flowRows(cityList); } });
  return [
    area({ id: 'countries', data: countries, color: scale.quantile((d: Feature) => Number(d.props.pop) || null, { n: 6, range: 'blues' }), opacity: 0.82, outline: { width: 0.6, color: '#ffffff66' }, hover: { color: '#ffffff', mix: 0.3, outline: 2 }, tooltip: (d) => `${d.props.name}\n${(Number(d.props.pop) / 1e6).toFixed(1)} million people`, select: 'tap' }),
    arc<Feature>({ id: 'flows', data: flows, from: (d) => [Number(d.props.olon), Number(d.props.olat)], to: (d) => [Number(d.props.dlon), Number(d.props.dlat)], height: (d) => Math.min(900e3, 0.12 * geo.metresBetween([Number(d.props.olon), Number(d.props.olat)], [Number(d.props.dlon), Number(d.props.dlat)])), width: (d) => 1 + Math.sqrt(Number(d.props.n)) / 45, color: scale.category((d: Feature) => d.props.kind as string, { map: { work: '#f59e0b', study: '#a78bfa', family: '#f472b6' } }),
      tooltip: (d) => `${d.props.from} → ${d.props.to}\n${Number(d.props.n).toLocaleString()} people (mock) · ${d.props.kind}`, reveal: o.parity ? undefined : { mode: 'trace', dur: 1.6, stagger: 0.03, head: { glow: 0.9 } } }),
    points({ id: 'cities', data: cities, size: (d) => (HUBS.includes(String(d.props.name)) ? 9 : 4 + 6 / Math.max(1, Number(d.props.rank))), color: (d) => (HUBS.includes(String(d.props.name)) ? '#fde047' : '#e2e8f0'), feature: { when: (d) => Number(d.props.rank) <= 1 || HUBS.includes(String(d.props.name)) }, tooltip: (d) => `${d.props.name}, ${d.props.country}` }),
    layer({ id: 'country-names', data: countries, labels: { text: (d) => d.props.name, size: 10.5, priority: (d) => Number(d.props.pop), pickable: false } }),
    layer({ id: 'city-names', data: cities, when: { level: { from: 'country' } }, labels: { text: (d) => (Number(d.props.rank) <= 1 || HUBS.includes(String(d.props.name)) ? d.props.name : null), size: 11, offset: [0, 12], priority: (d) => -Number(d.props.rank), pickable: false } }),
  ] as Element[];
}
function flowsUI(w: World, el: HTMLElement): void {
  const narrow = innerWidth < 700, slot = document.createElement('div');
  legend(w, { for: 'flows', title: 'Flows from Indonesia (mock)', position: 'bottom-left', ...(narrow ? { into: slot } : {}) });
  el.innerHTML = `<div class="row"><button data-p="auto" class="on">auto</button><button data-p="globe">globe</button><button data-p="flat">flat map</button></div>
    <div class="row"><button id="flow">flowing</button><button id="replay">replay arcs</button></div><div id="info" class="why">w.setProjection('flat') eases the globe open</div>`;
  if (narrow) el.prepend(slot);
  const $ = (s: string) => el.querySelector(s) as HTMLElement;
  el.querySelectorAll<HTMLButtonElement>('[data-p]').forEach((b) => { b.onclick = () => { w.setProjection(b.dataset.p as 'auto'); if (b.dataset.p === 'flat' && w.state.view.zoom < 2.7) void w.fly({ ...w.camera.view, dist: undefined, zoom: 2.7 } as never, { seconds: 1.2 }); /* the flat map has one copy of the world */ el.querySelectorAll('[data-p]').forEach((x) => x.classList.toggle('on', x === b)); }; });
  let flowing = false;
  $('#flow').onclick = () => { flowing = !flowing; w.element('flows').setProps({ reveal: flowing ? { mode: 'pulse' } : { mode: 'trace', dur: 1.6, head: { glow: 0.9 } } } as never); $('#flow').classList.toggle('on', flowing); };
  $('#replay').onclick = async () => { w.hide('flows'); await new Promise((ok) => setTimeout(ok, 700)); w.release('flows'); };
  w.on('tap', (f) => { $('#info').textContent = f ? String(f.props.name ?? f.id) : ''; });
}
const flowsView: View = { lon: 112, lat: -2, zoom: 1.9, tilt: 0, bearing: 0 };

// ═══ 4 · a story (the scripted regression): terrain, reveals in a script, camera keys, settled frames, attribution ══
// No network: drawn imagery and a synthetic ridge (a fault scarp), so every frame is the same on every run.
const FAULT: [number, number][] = Array.from({ length: 30 }, (_, i) => { const t = i / 29; return [107.46 + 0.3 * t, -6.835 + 0.03 * t + 0.008 * Math.sin(t * 9)]; });
const scarp = () => terrain.custom({ id: 'scarp', attribution: 'synthetic terrain (a fault scarp)', heights: (t, n) => {
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [lon, lat] = geo.tilePoint(t.z, t.x, t.y, i / (n - 1), j / (n - 1));
    const d = lat - (-6.835 + (lon - 107.46) * 0.1 + 0.008 * Math.sin(((lon - 107.46) / 0.3) * 9));
    h[j * n + i] = 900 + 1100 * Math.exp(-((lon - 107.6) ** 2 + (lat + 6.76) ** 2) / 0.004) + (d > 0 ? 380 * (1 - Math.exp(-d * 60)) : -40 * (1 - Math.exp(d * 80))) + 60 * Math.sin(lon * 90) * Math.cos(lat * 70);
  }
  return h;
} });
const storyKeys = [
  { at: 0, view: { lon: 107.62, lat: -6.95, zoom: 10.4, tilt: 50, bearing: 0 } },
  { at: 3, view: { lon: 107.6, lat: -6.86, zoom: 11.6, tilt: 60, bearing: 335 }, ease: 'cinematic' },
  { at: 6, view: { lon: 107.66, lat: -6.83, zoom: 12.4, tilt: 68, bearing: 290 }, ease: 'glide' },
  { at: 8, view: { lon: 107.66, lat: -6.83, zoom: 12.4, tilt: 68, bearing: 280 } },
];
function storyLayers(): Element[] {
  const at = (t: number) => (s: { time: { t: number } }) => s.time.t >= t;
  const fault = { type: 'FeatureCollection', features: [{ id: 'fault', props: { name: 'the fault', km: 29 }, geometry: { type: 'LineString', coordinates: FAULT } }] };
  const zone = { type: 'FeatureCollection', features: [{ id: 'zone', props: { name: 'within 2 km' }, geometry: { type: 'Polygon', coordinates: [[...FAULT.map(([x, y]) => [x, y + 0.018]), ...FAULT.slice().reverse().map(([x, y]) => [x, y - 0.018]), [FAULT[0]![0], FAULT[0]![1] + 0.018]]] } }] };
  const towns = [['north town', 107.62, -6.8], ['valley town', 107.6, -6.88], ['east town', 107.7, -6.82], ['west town', 107.5, -6.85]] as const;
  return [
    area({ id: 'zone', data: data.geojson(zone), color: '#f97316', opacity: 0.32, outline: { width: 1.5, color: '#fdba74' }, when: at(3), reveal: { mode: 'sweep', dur: 1.4 } }),
    line({ id: 'fault', data: data.geojson(fault), width: 4, color: '#ef4444', when: at(1), reveal: { mode: 'trace', dur: 2, from: FAULT[0], head: { glow: 0.9 } } }),
    extrusion({ id: 'buildings', data: data.geojson({ type: 'FeatureCollection', features: blocks(107.6, -6.875, 36, 0.02, 0.0028, 4) }), height: (d) => d.props.levels * 9, color: '#e7e1d3', when: at(4.5), reveal: { mode: 'rise', dur: 1.2, stagger: 0.02 } }),
    text({ id: 'fault-label', data: data.geojson(fault), at: () => [107.61, -6.818], text: (d) => `${d.props.name} · ${d.props.km} km`, size: 15, color: '#fecaca', when: at(2.2), reveal: { mode: 'type', dur: 1 }, occlude: false }),
    points({ id: 'towns', data: towns.map(([name, lon, lat]) => ({ at: [lon, lat] as [number, number], name })), size: 11, color: '#fde047', outline: { color: '#1f2937', width: 2 }, when: at(5.5), reveal: { mode: 'pop', dur: 0.5, stagger: 0.15 } }),
    layer({ id: 'town-names', data: towns.map(([name, lon, lat]) => ({ at: [lon, lat] as [number, number], name })), when: at(6), labels: { text: (d) => d.name, size: 12, offset: [0, 13], reveal: { mode: 'fade', dur: 0.6 } } }),
  ];
}

// ═══ 5 · gap probes: a city (walkability, parks, walks, shade), players on a plane ════════════════════════════════
function cityLayers(): Element[] {
  const box: [number, number, number, number] = [144.95, -37.825, 144.985, -37.805];
  const grid = cells(box, 7, 5, 21).map((f) => ({ ...f, props: { ...f.props, walk: Math.round(35 + 60 * hash(String(f.id))) } }));
  const r = rng(8), parks = Array.from({ length: 7 }, (_, i) => { const lon = 144.952 + r() * 0.03, lat = -37.823 + r() * 0.016, s = 0.0012 + r() * 0.0018; return { id: `park${i}`, props: { name: `Park ${i + 1}`, trees: Math.round(40 + r() * 300) }, geometry: { type: 'Polygon', coordinates: [[[lon - s, lat - s * 0.7], [lon + s, lat - s * 0.8], [lon + s * 1.1, lat + s * 0.7], [lon - s * 0.9, lat + s * 0.8], [lon - s, lat - s * 0.7]]] } }; });
  const walks = Array.from({ length: 6 }, (_, i) => ({ id: `walk${i}`, props: { name: `Walk ${i + 1}`, km: 1 + i * 0.4 }, geometry: { type: 'LineString', coordinates: Array.from({ length: 12 }, (_, k) => [box[0] + 0.004 + (k / 11) * 0.028, box[1] + 0.003 + i * 0.003 + 0.0012 * Math.sin(k + i)]) } }));
  const shade = Array.from({ length: 220 }, (_, i) => ({ at: [box[0] + hash(`x${i}`) * (box[2] - box[0]), box[1] + hash(`y${i}`) * (box[3] - box[1])] as [number, number], v: hash(`v${i}`) }));
  return [
    area({ id: 'walkability', data: data.geojson({ type: 'FeatureCollection', features: grid }), color: scale.quantize((d: Feature) => d.props.walk as number, { n: 5, range: 'purples' }), opacity: 0.45, blend: 'multiply', tooltip: (d) => `walk score ${d.props.walk} (mock)` }),
    custom({ id: 'shade', data: shade, at: (d) => d.at, size: 160, shape: 'ground', blend: 'add', attributes: { value: (d) => d.v }, uniforms: { gain: 0.8, tint: '#38bdf8' }, varyings: { glow: 'f32' }, vertex: heatShader.vertex, fragment: heatShader.fragment }),
    area({ id: 'parks', data: data.geojson({ type: 'FeatureCollection', features: parks }), color: '#22c55e', opacity: 0.75, outline: { width: 1.5, color: '#bbf7d0' }, tooltip: (d) => `${d.props.name} · ${d.props.trees} trees` }),
    line({ id: 'walks', data: data.geojson({ type: 'FeatureCollection', features: walks }), width: 3, color: '#fef08a', dashes: [8, 5], tooltip: (d) => `${d.props.name} · ${d.props.km} km`, reveal: { mode: 'pulse' } }),
    extrusion({ id: 'buildings', data: data.geojson({ type: 'FeatureCollection', features: blocks(144.967, -37.815, 60, 0.012, 0.0009, 12) }), height: (d) => d.props.levels * 7, color: '#e2e8f0', opacity: 0.95, tooltip: (d) => `${d.props.levels} levels` }),
    layer({ id: 'park-names', data: data.geojson({ type: 'FeatureCollection', features: parks }), when: { level: { from: 'street' } }, labels: { text: (d) => d.props.name, size: 11, pickable: false } }),
  ];
}
const CITY_GAPS = ['walkways as a network, routing, isochrones → 0.2 (networks)', 'trees, benches, people as shapes → 0.2 (shapes, instancing)', 'sun shadows on the ground → 0.2'];
function playersLayers(o: { parity?: boolean } = {}): Element[] {
  // players: a live stream (mock: 16 players moving, 10 messages a second; a game server's socket works the same)
  const players = data.stream<Record<string, unknown>>({ id: 'id', connect: (emit) => {
    const at = (i: number, t: number) => { const p = planeAt(Math.cos(t * 0.3 + i) * (30 + i * 4), Math.sin(t * 0.37 + i * 1.3) * (30 + i * 3)); return { id: `p${i + 1}`, name: `player ${i + 1}`, team: i % 2 ? 'red' : 'blue', lon: p[0], lat: p[1], hp: 40 + Math.round(60 * hash(`${i}`)) }; };
    const tick = () => emit({ upsert: Array.from({ length: 16 }, (_, i) => at(i, o.parity ? 1 : performance.now() / 1000)) });
    tick(); if (o.parity) return () => {}; const h = setInterval(tick, 100); return () => clearInterval(h);
  } });
  const zones = [[-60, -40, 40], [50, 30, 30], [0, 70, 25]].map(([x, y, s], i) => ({ id: `z${i}`, props: { name: ['spawn', 'market', 'arena'][i] }, geometry: { type: 'Polygon', coordinates: [[planeAt(x! - s!, y! - s!), planeAt(x! + s!, y! - s!), planeAt(x! + s!, y! + s!), planeAt(x! - s!, y! + s!), planeAt(x! - s!, y! - s!)]] } }));
  return [
    area({ id: 'zones', data: data.geojson({ type: 'FeatureCollection', features: zones }), color: scale.category((d: Feature) => d.props.name as string, { map: { spawn: '#22c55e', market: '#f59e0b', arena: '#ef4444' } }), opacity: 0.35, outline: { width: 2, color: '#ffffffaa' }, tooltip: (d) => String(d.props.name) }),
    extrusion({ id: 'walls', data: data.geojson({ type: 'FeatureCollection', features: [[-90, -90, 180, 4], [-90, 86, 180, 4], [-90, -90, 4, 180], [86, -90, 4, 180]].map(([x, y, w2, h2], i) => ({ id: `w${i}`, props: {}, geometry: { type: 'Polygon', coordinates: [[planeAt(x!, y!), planeAt(x! + w2!, y!), planeAt(x! + w2!, y! + h2!), planeAt(x!, y! + h2!), planeAt(x!, y!)]] } })) }), height: 6, color: '#94a3b8', pickable: false }),
    custom({ id: 'heat', data: Array.from({ length: 40 }, (_, i) => ({ at: planeAt(Math.sin(i * 1.7) * 70, Math.cos(i * 2.3) * 70), v: (i % 7) / 7 })), at: (d) => d.at, size: 26, shape: 'ground', blend: 'add', attributes: { value: (d) => d.v }, uniforms: { gain: 1, tint: '#a855f7' }, varyings: { glow: 'f32' }, vertex: heatShader.vertex, fragment: heatShader.fragment }),
    points({ id: 'players', data: players, size: 13, color: scale.category((d: Feature) => d.props.team as string, { map: { blue: '#3b82f6', red: '#ef4444' } }), outline: { color: '#ffffff', width: 2 }, transition: 0, tooltip: (d) => `${d.props.name} · ${d.props.hp} hp`, select: 'tap' }),
    layer({ id: 'player-names', data: players, labels: { text: (d) => d.props.name, size: 10, offset: [0, 14], transition: 0, pickable: false } }),
  ];
}
const PLAYERS_GAPS = ['avatars and props as shapes, glTF, VRM → 0.2–0.3', 'physics and collisions → 0.3 (kits/game)', 'presence (who is online, interest areas) → 0.3', 'lights and shadows → 0.2'];
function gapsUI(list: string[], extra?: (w: World, el: HTMLElement) => void) {
  return (w: World, el: HTMLElement) => {
    el.innerHTML = `<div class="why">0.1 does: what you see. Waits for later:</div><ul class="gaps">${list.map((g) => `<li>${g}</li>`).join('')}</ul><div id="info" class="why"></div>`;
    extra?.(w, el);
  };
}
const playersUI = gapsUI(PLAYERS_GAPS, (w, el) => {
  const info = el.querySelector('#info') as HTMLElement;
  w.on('tap', (p) => { if (p?.element !== 'players') return; const id = String(p.id); w.select([id]); w.follow(() => { const f = (w.element('players') as unknown as { source: { get(id: string): Feature | undefined } }).source.get(id); const c = f?.geometry?.type === 'Point' ? f.geometry.coordinates as [number, number] : null; return c; }, { smooth: 200 }); info.textContent = `following ${p.props.name} · drag to stop`; });
});

export const PRODUCTS: Record<string, DemoPreset> = {
  regions: { title: 'regions three levels deep (drill-down, an indicator, a category, answers)', view: javaView, body: regionsBody, layers: () => (lastRegions = regionsLayers()).layers, ui: regionsUI, ready: async (w) => regionsParams(w) },
  'regions-fly': { title: 'globe → the regions of Java', view: { lon: 100, lat: -2, zoom: 1.8 }, body: regionsBody, layers: () => (lastRegions = regionsLayers()).layers, ui: regionsUI, ready: async (w) => regionsParams(w), keys: [{ at: 0, view: { lon: 100, lat: -2, zoom: 1.8 } }, { at: 12, view: javaView, ease: 'cinematic' }] },
  fleet: { title: 'a fleet replay (trails, a time scrubber, live chargers, follow)', view: melbourne, body: fleetBody, layers: () => (lastFleet = fleetLayers()).layers, ui: fleetUI, ready: async (w) => { w.setTime(new Date(T0 + 45 * 60e3)); await lastFleet!.fleet.ready; moveFleet(w, lastFleet!); } },
  'fleet-fly': { title: 'globe → Melbourne fleet', view: { lon: 130, lat: -25, zoom: 1.8 }, body: fleetBody, layers: () => (lastFleet = fleetLayers()).layers, ui: fleetUI, ready: async (w) => { w.setTime(new Date(T0 + 45 * 60e3)); }, keys: [{ at: 0, view: { lon: 130, lat: -25, zoom: 1.8 } }, { at: 12, view: melbourne, ease: 'cinematic' }] },
  flows: { title: 'flows (countries, arcs, labels, globe ↔ flat)', view: flowsView, body: () => earth({ imagery: [imagery.sentinel()], terrain: [], base: lite(), surface: { grade: { saturation: 0.25, brightness: 0.45 } } }), layers: () => flowsLayers(), ui: flowsUI },
  story: { title: 'a scripted story (no network)', deterministic: true, context: 'video', view: storyKeys[0]!.view, body: () => earth({ imagery: [plainImagery()], terrain: [scarp()], exaggerate: 1.6 }), layers: storyLayers, keys: storyKeys },
  city: { title: 'a city probe (walkability, parks, walks, shade)', view: { lon: 144.968, lat: -37.818, zoom: 14.6, tilt: 55, bearing: 20 }, body: () => earth({ imagery: [imagery.sentinel()], terrain: [terrain.mapzen()], base: lite() }), layers: cityLayers, ui: gapsUI(CITY_GAPS) },
  players: { title: 'players on a plane (probe)', view: { lon: 0, lat: 0, dist: 260, tilt: 55, bearing: 330 }, body: () => plane({ size: 200, grid: 10 }), layers: () => playersLayers(), ui: playersUI },
  // deterministic twins for the parity check (no network)
  'parity-regions': { title: 'parity: regions drilled into West Java', deterministic: true, view: { lon: 107.6, lat: -6.95, zoom: 7.9, tilt: 25, bearing: 0 }, body: () => earth({ imagery: [plainImagery()], terrain: [] }), layers: () => (lastRegions = regionsLayers({ parity: true })).layers, ready: async (w) => { regionsParams(w); w.set('regions.province', '32'); } },
  'parity-fleet': { title: 'parity: the fleet at 06:45', deterministic: true, view: { lon: 144.97, lat: -37.83, zoom: 10.6, tilt: 30, bearing: 0 }, body: () => earth({ imagery: [plainImagery()], terrain: [] }), layers: () => (lastFleet = fleetLayers({ parity: true })).layers, ready: async (w) => { w.setTime(new Date(T0 + 45 * 60e3)); await lastFleet!.fleet.ready; moveFleet(w, lastFleet!); } },
  'parity-flows': { title: 'parity: countries and arcs on the globe', deterministic: true, view: { lon: 105, lat: 5, zoom: 2.2 }, body: () => earth({ imagery: [plainImagery()], terrain: [] }), layers: () => flowsLayers({ parity: true }) },
  'parity-flows-flat': { title: 'parity: the same, flat', deterministic: true, view: { lon: 105, lat: 5, zoom: 2.8 }, body: () => earth({ imagery: [plainImagery()], terrain: [] }), layers: () => flowsLayers({ parity: true }), ready: async (w) => { w.setProjection('flat', 0); } },
  'parity-story': { title: 'parity: the story at its end', deterministic: true, view: storyKeys[3]!.view, body: () => earth({ imagery: [plainImagery()], terrain: [scarp()], exaggerate: 1.6 }), layers: () => storyLayers().map((l) => { l.setProps({ when: true, reveal: undefined } as never); return l; }) },
  'parity-city': { title: 'parity: the city probe', deterministic: true, view: { lon: 144.968, lat: -37.818, zoom: 14.6, tilt: 55, bearing: 20 }, body: () => earth({ imagery: [plainImagery()], terrain: [] }), layers: () => cityLayers().map((l) => (l.id === 'walks' ? (l.setProps({ reveal: undefined } as never), l) : l)) },
  'parity-players': { title: 'parity: the players probe', deterministic: true, view: { lon: 0, lat: 0, dist: 260, tilt: 55, bearing: 330 }, body: () => plane({ size: 200, grid: 10 }), layers: () => playersLayers({ parity: true }) },
};
export { T0 as FLEET_T0, storyKeys, regionsLayers, regionsParams };
export type { Body };
