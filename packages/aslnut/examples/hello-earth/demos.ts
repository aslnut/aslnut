// Product demos (?go=crime | answer | energy, and their parity twins): what a dashboard, an answer-as-presentation and
// an energy map need, built from aslnut alone. The numbers are mock (seeded, the same every run); the suburb and
// council boundaries are open data (© State of Victoria, Vicmap Admin, CC BY 4.0) prepared by tools/demo-data.mjs.
import {
  area, data, earth, earthLite, imagery, layer, legend, line, points, raster, regions, scale, states, terrain, text, extrusion, geo,
  type Body, type Feature, type Element, type View, type World, type WorldState,
} from '../../src/index.ts';
import { rng } from './mock.ts';

const PACK = '/aslnut/data/packs/demo';
const CBD: [number, number] = [144.9631, -37.8136];
const km = (a: [number, number], b: [number, number]) => geo.metresBetween(a, b) / 1000;
/** a stable number from text (the mock API's seed) */
const hash = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return (h >>> 0) / 4294967296; };

// ── the mock crime API: rates per suburb, by year and offence (a pattern by distance from the city, plus noise) ──
export const OFFENCES = ['burglary', 'assault', 'theft'] as const;
export function crimeRows(suburbs: readonly Feature[], year: number, offence: string): { code: string; rate: number; count: number }[] {
  return suburbs.map((f) => {
    const c = (f.geometry ? (geo as unknown as { tileBBox: unknown }) && centre(f) : CBD) as [number, number];
    const d = km(c, CBD), base = offence === 'assault' ? 9 : offence === 'theft' ? 22 : 12;
    const city = Math.exp(-d / (offence === 'burglary' ? 22 : 9)), noise = hash(`${f.id}|${offence}`), trend = 1 + (year - 2022) * (offence === 'theft' ? 0.06 : -0.03) * (0.5 + hash(`${f.id}|${year}`));
    const rate = Math.max(0.3, base * (0.25 + 1.6 * city + 0.9 * noise) * trend);
    return { code: String(f.id), rate: Math.round(rate * 10) / 10, count: Math.round(rate * (3 + 20 * noise)) };
  });
}
const centre = (f: Feature): [number, number] => { const g = f.geometry as { type: string; coordinates: number[][][] | number[][][][] }; const ring = (g.type === 'Polygon' ? g.coordinates[0] : (g.coordinates as number[][][][])[0]![0]) as number[][]; let x = 0, y = 0; for (const p of ring) { x += p[0]!; y += p[1]!; } return [x / ring.length, y / ring.length]; };

export interface DemoPreset { title: string; body: () => Body; view: View; layers: () => Element[]; deterministic?: boolean; context?: 'app' | 'video'; ui?: (w: World, el: HTMLElement) => void; ready?: (w: World) => Promise<void>; keys?: { at: number; view: View; ease?: string }[] }

// ── crime: a choropleth driven by a query, with a legend, hover, councils, labels and police stations ────────────
function crimeLayers(o: { pmtiles?: boolean; parity?: boolean } = {}) {
  const suburbs = o.pmtiles ? data.pmtiles(`${PACK}/melbourne-suburbs.pmtiles`, { layer: 'suburbs', id: 'code', attribution: '© State of Victoria (Vicmap), CC BY 4.0' }) : data.geojson(`${PACK}/melbourne-suburbs.geojson`, { id: 'code', attribution: '© State of Victoria (Vicmap), CC BY 4.0' });
  const councils = data.geojson(`${PACK}/melbourne-lgas.geojson`, { attribution: '© State of Victoria (Vicmap), CC BY 4.0' });
  // the query: it runs again when the year or the offence changes (world params a person or a timeline turns)
  const crime = data.query((s) => new Promise((ok) => {
    const year = Number(s.world.params['q.year'] ?? 2025), offence = String(s.world.params['q.offence'] ?? 'burglary');
    const rows = crimeRows(suburbs.features(), year, offence);
    if (o.parity) ok(rows); else setTimeout(() => ok(rows), 120);
  }), { deps: (s) => [s.world.params['q.year'], s.world.params['q.offence'], suburbs.size], id: 'code', debounce: o.parity ? 0 : 120 });
  const tree = regions.tree({ levels: ['council', 'suburb'], sources: { council: councils, suburb: suburbs }, parentOf: { suburb: (f) => f.props.lga } });
  const byCouncil = tree.rollup(crime, { on: 'code', to: 'council', sum: ['count'], count: true, fn: (rows) => ({ rate: Math.round(rows.reduce((a, r) => a + Number(r.rate), 0) / Math.max(1, rows.length) * 10) / 10 }) });
  const stations = data.custom({ load: async (ctx) => { await suburbs.start(ctx); const r = rng(11), list = suburbs.features(); return Array.from({ length: 42 }, (_, i) => { const f = list[Math.floor(r() * list.length)]; const c = f ? centre(f) : CBD; return { id: `ps${i}`, name: `Police station ${i + 1}`, lon: c[0], lat: c[1] }; }); } });
  return {
    suburbs, councils, crime, tree, byCouncil,
    layers: [
      area({ id: 'crime', data: suburbs.join(crime, { on: 'code' }),
        // from tiles the suburbs follow the view: the whole data is not known here, so the classes are given (E-DATA-003)
        color: o.pmtiles ? scale.threshold((d) => d.props.rate, { domain: [6, 10, 15, 22], range: 'reds' }) : scale.quantile((d) => d.props.rate, { n: 5, range: 'reds' }), opacity: 0.8, outline: { width: 0.6, color: '#ffffff55' },
        hover: { color: '#ffffff', mix: 0.3, outline: 2.5 }, selected: { color: '#ffd166', mix: 0.5, outline: 3 }, select: 'tap', transition: 0.6,
        tooltip: (d) => `${d.props.name} · ${d.props.lga_name}\n${d.props.rate ?? '–'} per 1,000 · ${d.props.count ?? '–'} reports`,
        reveal: { mode: 'wipe', dur: 0.9, stagger: o.parity ? 0 : 0.003, order: (d: Feature) => km(centre(d), CBD) } }),
      area({ id: 'councils', data: councils.join(byCouncil, { on: 'id' }), color: scale.quantile((d) => d.props.rate, { n: 5, range: 'purples' }), opacity: 0.75, outline: { width: 1.4, color: '#ffffffaa' }, when: false,
        hover: { color: '#ffffff', mix: 0.3 }, tooltip: (d) => `${d.props.name}\naverage ${d.props.rate ?? '–'} per 1,000 · ${d.props.count ?? 0} suburbs`, reveal: { mode: 'radial', dur: 0.8 } }),
      line({ id: 'council-lines', data: councils, width: 1.3, color: '#ffffffb0', pickable: false, when: { level: { from: 'region' } } }),
      layer({ id: 'council-names', data: councils, when: { level: { from: 'city' } }, labels: { text: (d) => d.props.name, size: 11, color: '#f1f5f9', priority: (d) => -String(d.props.name).length, pickable: false } }),
      layer({ id: 'suburb-names', data: suburbs, when: { level: { from: 'district' } }, labels: { text: (d) => d.props.name, size: 10, color: '#e2e8f0', pickable: false } }),
      points({ id: 'stations', data: stations, size: 7, color: '#38bdf8', outline: { color: '#0b1220', width: 1.5 }, when: { level: { from: 'city' } }, tooltip: (d) => String(d.props.name) }),
    ] as Element[],
  };
}
const melbourne: View = { lon: 144.98, lat: -37.83, zoom: 9.6, tilt: 28, bearing: 0 };
const lite = () => earthLite({ url: '/aslnut/data/packs/earth-lite', maxZoom: 4, attribution: 'Sentinel-2 cloudless 2020 by EOX (CC BY 4.0)' });
const crimeBody = () => earth({ imagery: [imagery.sentinel()], terrain: [terrain.mapzen()], base: lite(), exaggerate: 1.5, surface: { grade: { saturation: 0.35, brightness: 0.62, contrast: 1.05 } } });
let lastCrime: ReturnType<typeof crimeLayers> | null = null;

function crimeUI(w: World, el: HTMLElement, withQuestions: boolean): void {
  const c = lastCrime!;
  demoParams(w);
  const now = () => ({ year: Number(w.get('q.year')), offence: String(w.get('q.offence')) });
  // on a phone the legend sits in this box (the screen has no free corner)
  const narrow = innerWidth < 700, slot = document.createElement('div');
  const lg = legend(w, { for: 'crime', title: 'Burglary per 1,000 (2025)', position: 'bottom-left', ...(narrow ? { into: slot } : {}) });
  const title = () => { const l = lg.el?.firstElementChild, { year, offence } = now(); if (l) l.textContent = `${offence[0]!.toUpperCase()}${offence.slice(1)} per 1,000 (${year})`; };
  w.on('frame', title);
  const { year, offence } = now();
  el.innerHTML = `<div class="row"><label>year <b id="yv">${year}</b></label><input id="yr" type="range" min="2019" max="2025" step="1" value="${year}"></div>
    <div class="row">${OFFENCES.map((o) => `<button data-o="${o}" class="${o === offence ? 'on' : ''}">${o}</button>`).join('')}</div>
    <div class="row"><button id="lvl">councils</button><button id="share">share view</button></div>
    ${withQuestions ? `<div class="q"><button data-q="0">Where is burglary highest in 2025?</button><button data-q="1">Which council has the most assaults?</button><button data-q="2">Theft in the south-east, 2021</button></div>` : ''}
    <div id="info" class="why"></div>`;
  if (narrow) el.prepend(slot);
  const $ = (s: string) => el.querySelector(s) as HTMLElement;
  const yr = $('#yr') as HTMLInputElement;
  yr.oninput = () => { w.set('q.year', Number(yr.value)); $('#yv').textContent = yr.value; };
  el.querySelectorAll<HTMLButtonElement>('[data-o]').forEach((b) => { b.onclick = () => { w.set('q.offence', b.dataset.o!); el.querySelectorAll('[data-o]').forEach((x) => x.classList.toggle('on', x === b)); }; });
  let councils = false;
  $('#lvl').onclick = () => { councils = !councils; if (councils) { w.reveal('councils'); w.hide('crime'); lg.remove(); } else { w.release('councils'); w.release('crime'); } $('#lvl').classList.toggle('on', councils); };
  $('#share').onclick = () => { const u = states.toURL(w.capture({ note: 'shared view' })); $('#info').textContent = `link (${u.length} chars) in the console`; console.log(u); void navigator.clipboard?.writeText(u).catch(() => {}); };
  w.on('tap', (f) => { $('#info').textContent = f ? `${f.props.name}: ${f.props.rate ?? '–'} per 1,000 · ${f.props.count ?? '–'} reports (${f.element})` : ''; });
  if (!withQuestions) return;
  const top = (n: number) => [...c.crime.features()].sort((a, b) => Number(b.props.rate) - Number(a.props.rate)).slice(0, n).map((f) => String(f.props.code));
  // each question's answer is a state: plain JSON (it could come from a server or an assistant)
  const answers: (() => Promise<WorldState>)[] = [
    async () => { w.set('q.year', 2025); w.set('q.offence', 'burglary'); await c.crime.ready; await new Promise((ok) => setTimeout(ok, 300));
      const ids = top(3), f = c.suburbs.get(ids[0]!)!, at = centre(f);
      return { v: 1, note: 'Where is burglary highest in 2025?', view: { lon: at[0], lat: at[1], zoom: 11.6, tilt: 45, bearing: 340 }, elements: { crime: { shown: true, filter: null }, councils: { shown: false }, stations: { shown: true } }, params: { 'q.year': 2025, 'q.offence': 'burglary' }, selection: ids }; },
    async () => { w.set('q.year', 2025); w.set('q.offence', 'assault'); await new Promise((ok) => setTimeout(ok, 300));
      const best = [...c.byCouncil.features()].sort((a, b) => Number(b.props.rate) - Number(a.props.rate))[0]!, g = c.councils.get(best.id)!, at = centre(g);
      return { v: 1, note: 'Which council has the most assaults?', view: { lon: at[0], lat: at[1], zoom: 10.4, tilt: 35, bearing: 15 }, elements: { crime: { shown: false }, councils: { shown: true }, stations: { shown: false } }, params: { 'q.year': 2025, 'q.offence': 'assault' }, selection: [String(best.id)] }; },
    async () => ({ v: 1, note: 'Theft in the south-east, 2021', view: { lon: 145.17, lat: -37.95, zoom: 11, tilt: 55, bearing: 220 }, elements: { crime: { shown: true, filter: null }, councils: { shown: false }, stations: { shown: true } }, params: { 'q.year': 2021, 'q.offence': 'theft' }, selection: [] }),
  ];
  el.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) => { b.onclick = async () => {
    el.querySelectorAll('[data-q]').forEach((x) => x.classList.toggle('on', x === b));
    const s = await answers[Number(b.dataset.q)]!();
    yr.value = String(s.params?.['q.year'] ?? now().year); $('#yv').textContent = yr.value;
    el.querySelectorAll('[data-o]').forEach((x) => x.classList.toggle('on', (x as HTMLElement).dataset.o === s.params?.['q.offence']));
    $('#info').textContent = `${s.note} · state ${JSON.stringify(s).length} bytes`;
    await w.apply(s, { seconds: 2.4, ease: 'cinematic' });
  }; });
  // a link with ?state=… opens that answer
  const from = states.fromURL(location.href); if (from) void w.apply(from, { seconds: 0 });
}

// ── energy: rasters (solar, wind) stacked in order, concessions, lines traced from substations, plants by fuel ────
const PLANTS: [string, number, number, string, number][] = [
  ['Suralaya', 106.03, -5.89, 'coal', 4025], ['Muara Karang', 106.79, -6.11, 'gas', 1208], ['Cirata', 107.33, -6.7, 'hydro', 1008], ['Saguling', 107.38, -6.91, 'hydro', 797],
  ['Jatiluhur', 107.39, -6.53, 'hydro', 187], ['Wayang Windu', 107.62, -7.2, 'geothermal', 227], ['Kamojang', 107.79, -7.14, 'geothermal', 235], ['Darajat', 107.73, -7.22, 'geothermal', 271],
  ['Salak', 106.73, -6.74, 'geothermal', 377], ['Patuha', 107.4, -7.16, 'geothermal', 55], ['Cirata Floating PV', 107.36, -6.69, 'solar', 145], ['Indramayu', 108.33, -6.3, 'coal', 990],
  ['Cilacap', 109.0, -7.7, 'coal', 1260], ['Tambak Lorok', 110.42, -6.95, 'gas', 1034], ['Sidrap', 119.8, -3.9, 'wind', 75], ['Dieng', 109.9, -7.21, 'geothermal', 60],
];
const SUBS: [string, number, number][] = [['Bandung Selatan', 107.6, -7.0], ['Cibinong', 106.85, -6.48], ['Cirata', 107.33, -6.72], ['Mandirancan', 108.47, -6.83], ['Ungaran', 110.4, -7.14], ['Pedan', 110.7, -7.6], ['Cilegon', 106.05, -6.02], ['Muara Tawar', 107.0, -6.1]];
const FUEL = { coal: '#64748b', gas: '#f59e0b', hydro: '#38bdf8', geothermal: '#ef4444', solar: '#facc15', wind: '#34d399' };
const solar = (lon: number, lat: number) => 4.2 + 1.3 * Math.cos((lat + 7.5) * 0.9) + 0.5 * Math.sin(lon * 1.7) - 0.6 * Math.exp(-((lon - 107.6) ** 2 + (lat + 7.0) ** 2) / 0.15);
const wind = (lon: number, lat: number) => 3 + 2.4 * Math.max(0, Math.sin(lon * 2.2 + lat)) * Math.exp(-((lat + 7.9) ** 2) / 0.4) + 1.2 * Math.exp(-((lon - 106.3) ** 2 + (lat + 6.2) ** 2) / 0.3);
function energyLayers(parity = false): Element[] {
  const plants = data.rows(PLANTS.map(([name, lon, lat, fuel, mw]) => ({ id: name, name, lon, lat, fuel, mw })), { id: 'id' });
  const subs = data.rows(SUBS.map(([name, lon, lat]) => ({ id: name, name, lon, lat })), { id: 'id' });
  // lines: each plant to its nearest substation, and the backbone between substations
  const near = (lon: number, lat: number) => SUBS.reduce((b, s) => ((s[1] - lon) ** 2 + (s[2] - lat) ** 2 < (b[1] - lon) ** 2 + (b[2] - lat) ** 2 ? s : b));
  const curve = (a: [number, number], b: [number, number], k = 0.12): [number, number][] => Array.from({ length: 24 }, (_, i) => { const t = i / 23, nx = -(b[1] - a[1]), ny = b[0] - a[0], s = Math.sin(Math.PI * t) * k; return [a[0] + (b[0] - a[0]) * t + nx * s, a[1] + (b[1] - a[1]) * t + ny * s]; });
  const feeders: Feature[] = PLANTS.filter((p) => p[1] < 112).map(([name, lon, lat, , mw]) => { const s = near(lon, lat); return { id: `f-${name}`, props: { name: `${name} → ${s[0]}`, kv: mw > 900 ? 500 : 150 }, geometry: { type: 'LineString', coordinates: curve([lon, lat], [s[1], s[2]], 0.08) } }; });
  const order = [6, 1, 7, 2, 0, 3, 5, 4];
  const backbone: Feature[] = order.slice(1).map((k, i) => { const a = SUBS[order[i]!]!, b = SUBS[k]!; return { id: `bb${i}`, props: { name: `${a[0]} – ${b[0]}`, kv: 500 }, geometry: { type: 'LineString', coordinates: curve([a[1], a[2]], [b[1], b[2]], 0.05) } }; });
  // geothermal working areas round volcanoes (mock outlines)
  const blob = (lon: number, lat: number, r: number, seed: number): Feature => { const q = rng(seed); return { id: `wka-${seed}`, props: { name: ['Kamojang WKP', 'Wayang Windu WKP', 'Salak WKP', 'Dieng WKP', 'Patuha WKP', 'Tangkuban Perahu WKP'][seed % 6], status: ['producing', 'exploring', 'tender'][seed % 3] }, geometry: { type: 'Polygon', coordinates: [Array.from({ length: 19 }, (_, i) => { const a = (i % 18) / 18 * Math.PI * 2, rr = r * (0.75 + 0.5 * q()); return [lon + Math.cos(a) * rr, lat + Math.sin(a) * rr * 0.9] as [number, number]; })] } }; };
  const wka = [blob(107.79, -7.14, 0.07, 0), blob(107.62, -7.2, 0.06, 1), blob(106.73, -6.74, 0.08, 2), blob(109.9, -7.21, 0.07, 3), blob(107.4, -7.16, 0.05, 4), blob(107.6, -6.77, 0.06, 5)];
  const head = parity ? undefined : { glow: 0.8 };
  return [
    raster({ id: 'solar', source: raster.field({ value: solar, ramp: 'inferno', domain: [3, 6.5], cell: 4, attribution: 'mock irradiance (kWh/m²/day)' }), opacity: 0.55, when: (s) => s.observation.index >= 1 && !s.user.toggles['no-solar'] }),
    raster({ id: 'wind', source: raster.field({ value: (lon, lat) => { const v = wind(lon, lat); return v > 4 ? v : null; }, ramp: 'ylgnbu', domain: [4, 6.5], cell: 4, attribution: 'mock wind (m/s at 100 m)' }), opacity: 0.6, blend: 'screen', when: (s) => s.observation.index >= 1 && !s.user.toggles['no-wind'] }),
    area({ id: 'concessions', data: data.geojson({ type: 'FeatureCollection', features: wka }), color: scale.category((d) => d.props.status, { map: { producing: '#ef4444aa', exploring: '#f97316aa', tender: '#a855f7aa' } }), outline: { width: 1.5, color: '#ffffffcc' },
      hover: { color: '#ffffff', mix: 0.3, outline: 3 }, tooltip: (d) => `${d.props.name}\n${d.props.status}`, reveal: { mode: 'trace-fill', dur: 1.2, stagger: parity ? 0 : 0.15 } }),
    line({ id: 'backbone', data: data.geojson({ type: 'FeatureCollection', features: backbone }), width: 3.2, color: '#e2e8f0', tooltip: (d) => `${d.props.name} · ${d.props.kv} kV`, reveal: { mode: 'trace', dur: 1.6, stagger: parity ? 0 : 0.25, head } }),
    line({ id: 'feeders', data: data.geojson({ type: 'FeatureCollection', features: feeders }), width: (d) => (d.props.kv > 200 ? 2.2 : 1.4), color: '#94a3b8', dashes: [6, 4], tooltip: (d) => `${d.props.name} · ${d.props.kv} kV`, reveal: { mode: 'trace', dur: 1, from: [107.6, -7.0], head } }),
    points({ id: 'substations', data: subs, size: 9, color: '#0f172a', outline: { color: '#e2e8f0', width: 2 }, tooltip: (d) => `substation ${d.props.name}` }),
    points({ id: 'plants', data: plants, size: scale.sqrt((d) => d.props.mw, { range: [7, 30] }), color: scale.category((d) => d.props.fuel, { map: FUEL }), outline: { color: '#ffffff', width: 1.5 },
      tooltip: (d) => `${d.props.name}\n${d.props.fuel} · ${d.props.mw} MW`, reveal: { mode: 'pop', dur: 0.6, stagger: parity ? 0 : 0.06, order: (d: Feature) => -Number(d.props.mw) }, select: 'tap' }),
    text({ id: 'plant-names', data: plants, text: (d) => (d.props.mw >= 700 ? d.props.name : null), size: 11, anchor: 'top', offset: [0, 10], when: { level: { from: 'region' } }, pickable: false }),
    extrusion({ id: 'capacity', data: data.geojson({ type: 'FeatureCollection', features: PLANTS.filter((p) => p[4] > 900).map(([name, lon, lat, , mw]) => ({ id: `cap-${name}`, props: { name, mw }, geometry: { type: 'Polygon', coordinates: [[[lon - 0.02, lat - 0.02], [lon + 0.02, lat - 0.02], [lon + 0.02, lat + 0.02], [lon - 0.02, lat + 0.02], [lon - 0.02, lat - 0.02]]] } })) }),
      height: (d) => d.props.mw * 6, color: '#fde68a', opacity: 0.9, when: { level: { from: 'region' } }, tooltip: (d) => `${d.props.name}: ${d.props.mw} MW`, reveal: { mode: 'rise', dur: 1 } }),
  ];
}
function energyUI(w: World, el: HTMLElement): void {
  const narrow = innerWidth < 700, slot = document.createElement('div');
  legend(w, { for: 'plants', title: 'Plants by fuel', position: 'bottom-left', ...(narrow ? { into: slot } : {}) });
  el.innerHTML = `<div class="row"><button id="t-solar" class="on">solar</button><button id="t-wind" class="on">wind</button><button id="swap">wind ${'↓'} solar</button></div>
    <div class="row"><button id="replay">replay reveals</button></div><div id="info" class="why">rasters: solar under wind (add order); swap moves wind below</div>`;
  if (narrow) el.prepend(slot);
  const $ = (s: string) => el.querySelector(s) as HTMLElement;
  $('#t-solar').onclick = () => { w.toggle('no-solar'); $('#t-solar').classList.toggle('on'); };
  $('#t-wind').onclick = () => { w.toggle('no-wind'); $('#t-wind').classList.toggle('on'); };
  let below = false;
  $('#swap').onclick = () => { below = !below; w.move('wind', below ? { below: 'solar' } : { order: undefined }); $('#swap').textContent = below ? 'wind ↑ solar' : 'wind ↓ solar'; $('#info').textContent = below ? 'w.move(\'wind\', { below: \'solar\' })' : 'back to add order: wind over solar'; };
  $('#replay').onclick = async () => { for (const id of ['concessions', 'backbone', 'feeders', 'plants']) w.hide(id); await new Promise((ok) => setTimeout(ok, 900)); for (const id of ['concessions', 'backbone', 'feeders', 'plants']) w.reveal(id); };
  w.on('tap', (f) => { $('#info').textContent = f ? `${f.element}: ${f.props.name ?? f.id}` : ''; });
}
const java: View = { lon: 107.75, lat: -7.05, zoom: 7.2, tilt: 38, bearing: 0 };

// ── no network: procedural imagery for the parity twins ───────────────────────────────────────────────────────────
import { imagery as img } from '../../src/index.ts';
export const plainImagery = () => img.custom({ id: 'plain', attribution: 'procedural', draw: (g, t) => { const b = geo.tileBBox(t.z, t.x, t.y); const v = Math.round(60 + 30 * Math.sin((b[0] + b[2]) * 3) * Math.cos((b[1] + b[3]) * 2)); g.fillStyle = `rgb(${v},${v + 12},${v + 30})`; g.fillRect(0, 0, 256, 256); g.strokeStyle = 'rgba(255,255,255,.12)'; g.strokeRect(0.5, 0.5, 255, 255); return true; } });
export const synth = () => terrain.custom({ id: 'synthetic', attribution: 'synthetic', heights: (t, n) => { const h = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const [lon, lat] = geo.tilePoint(t.z, t.x, t.y, i / (n - 1), j / (n - 1)); h[j * n + i] = 900 * Math.exp(-((lon - 107.6) ** 2 + (lat + 7.1) ** 2) / 0.05) + 400 * Math.exp(-((lon - 106.75) ** 2 + (lat + 6.72) ** 2) / 0.03); } return h; } });

export const DEMOS: Record<string, DemoPreset> = {
  crime: { title: 'crime choropleth (query + legend + hover)', view: melbourne, body: crimeBody, layers: () => (lastCrime = crimeLayers()).layers, ui: (w, el) => crimeUI(w, el, false) },
  'crime-pmtiles': { title: 'crime, suburbs from PMTiles', view: melbourne, body: crimeBody, layers: () => (lastCrime = crimeLayers({ pmtiles: true })).layers, ui: (w, el) => crimeUI(w, el, false) },
  answer: { title: 'answers as presentations (states)', view: melbourne, body: crimeBody, layers: () => (lastCrime = crimeLayers()).layers, ui: (w, el) => crimeUI(w, el, true) },
  energy: { title: 'energy map (rasters + vectors + order)', view: java, body: () => earth({ imagery: [imagery.sentinel()], terrain: [terrain.mapzen()], base: lite(), exaggerate: 2, surface: { grade: { saturation: 0.5, brightness: 0.7 } } }), layers: () => energyLayers(), ui: energyUI },
  // the same, flown into from the globe (camera keys): what the live recordings watch
  'crime-fly': { title: 'globe → Melbourne crime', view: { lon: 120, lat: -20, zoom: 1.8 }, body: crimeBody, layers: () => (lastCrime = crimeLayers()).layers, ui: (w, el) => crimeUI(w, el, false), keys: [{ at: 0, view: { lon: 120, lat: -20, zoom: 1.8 } }, { at: 14, view: melbourne, ease: 'cinematic' }] },
  'energy-fly': { title: 'globe → Java energy', view: { lon: 100, lat: 0, zoom: 1.8 }, body: () => DEMOS.energy!.body(), layers: () => energyLayers(), ui: energyUI, keys: [{ at: 0, view: { lon: 100, lat: 0, zoom: 1.8 } }, { at: 14, view: java, ease: 'cinematic' }] },
  'parity-crime': { title: 'parity crime (no network)', deterministic: true, view: { lon: 144.97, lat: -37.82, zoom: 10.2, tilt: 30, bearing: 0 }, body: () => earth({ imagery: [plainImagery()], terrain: [] }), layers: () => (lastCrime = crimeLayers({ parity: true })).layers.filter((l) => l.id !== 'suburb-names'), ready: async (w) => demoParams(w) },
  'parity-energy': { title: 'parity energy (no network)', deterministic: true, view: { lon: 107.3, lat: -6.9, zoom: 8.2, tilt: 40, bearing: 0 }, body: () => earth({ imagery: [plainImagery()], terrain: [synth()], exaggerate: 2 }), layers: () => energyLayers(true) },
  'parity-answer': { title: 'parity: an answer applied (no network)', deterministic: true, view: { lon: 144.97, lat: -37.82, zoom: 9, tilt: 0, bearing: 0 }, body: () => earth({ imagery: [plainImagery()], terrain: [] }), layers: () => (lastCrime = crimeLayers({ parity: true })).layers.filter((l) => l.id !== 'suburb-names'),
    ready: async (w) => { demoParams(w); await lastCrime!.suburbs.ready; await w.apply({ v: 1, note: 'parity answer', view: { lon: 145.02, lat: -37.86, zoom: 11, tilt: 40, bearing: 335 }, elements: { crime: { shown: true }, councils: { shown: false }, stations: { shown: false } }, params: { 'q.year': 2021, 'q.offence': 'theft' }, selection: ['3'] }, { seconds: 0 }); } },
};
/** the query's knobs: world params a person, a timeline or a state turns */
export function demoParams(w: World): void {
  try { w.get('q.year'); return; } catch { /* not yet */ }
  let year = 2025, offence = 'burglary';
  w.param('q.year', { type: 'number', default: 2025, range: [2019, 2025], describe: 'the year asked' }, (v) => { year = Number(v); }, () => year);
  w.param('q.offence', { type: 'enum', default: 'burglary', options: [...OFFENCES] }, (v) => { offence = String(v); }, () => offence);
}
export type { Feature };
