// hello-earth presets (?go=…): each one shows a part of aslnut, on WebGPU and WebGL2 alike (?graphics=webgpu|webgl2).
// Data here is mock data: what matters is what the library does with it.
import { area, custom, data, earth, earthLite, extrusion, imagery, line, plane, planeAt, points, scale, terrain, geo, type Body, type Element, type View, type World } from '../../src/index.ts';
import { DEMOS } from './demos.ts';
import { PRODUCTS } from './products.ts';
import { CHECKS } from './checks.ts';
import { PEOPLE_PRESETS } from './people.ts';
import * as heatShader from './heat.shader.ts';
import { blocks, cells, wavy } from './mock.ts';

export interface Preset { title: string; body: () => Body; view: View; layers: () => Element[]; graphics?: 'webgpu' | 'webgl2'; editor?: boolean; deterministic?: boolean; /** 'video': the full reveals (a recorded scene); an app (default) fades */ context?: 'app' | 'video'; keys?: { at: number; view: View; ease?: string }[]; ui?: (w: World, el: HTMLElement) => void; ready?: (w: World) => Promise<void> }

const CITIES: [string, number, number, number][] = [
  ['Jakarta', 106.85, -6.21, 10.6], ['Surabaya', 112.75, -7.25, 2.9], ['Bandung', 107.61, -6.91, 2.5], ['Medan', 98.67, 3.59, 2.4],
  ['Semarang', 110.42, -6.97, 1.7], ['Palembang', 104.75, -2.98, 1.7], ['Makassar', 119.42, -5.14, 1.5], ['Denpasar', 115.22, -8.65, 0.9],
  ['Balikpapan', 116.83, -1.24, 0.7], ['Pontianak', 109.33, -0.03, 0.66], ['Manado', 124.84, 1.47, 0.45], ['Kupang', 123.6, -10.17, 0.44],
  ['Yogyakarta', 110.37, -7.8, 0.4], ['Jayapura', 140.72, -2.53, 0.4], ['Banda Aceh', 95.32, 5.55, 0.27],
];
const PLACES: [string, number, number][] = [['Lembang', 107.617, -6.811], ['Cimahi', 107.54, -6.872], ['Soreang', 107.518, -7.03], ['Tangkuban Perahu', 107.6, -6.76], ['Dago', 107.618, -6.87], ['Kiaracondong', 107.646, -6.925], ['Ujungberung', 107.7, -6.912], ['Dayeuhkolot', 107.625, -6.99]];

/** a seeded random (the same mock data every time) */
function rng(seed: number) { let s = seed >>> 0; return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; }; }
/** mock "heat" around a place: n spots, value 0..1 */
function heatAround(lon: number, lat: number, n: number, spread: number, seed = 7) {
  const r = rng(seed), out: { at: [number, number]; v: number }[] = [];
  for (let i = 0; i < n; i++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * spread; out.push({ at: [lon + Math.cos(a) * d, lat + Math.sin(a) * d * 0.9], v: 0.25 + 0.75 * r() ** 2 }); }
  return out;
}
const cities = (when?: Element['props']['when']) => points({
  id: 'cities', data: CITIES.map(([name, lon, lat, pop]) => ({ at: [lon, lat] as [number, number], value: pop, name })),
  size: (d) => 6 + Math.sqrt(d.value ?? 0) * 5, color: '#ffb000', when,
  shader: { color: 'color = vec4f(mix(color.rgb, vec3f(1.0, 0.35, 0.1), clamp(value / 10.0, 0.0, 1.0)), color.a);' },
});
const places = () => points({ id: 'places', data: PLACES.map(([name, lon, lat]) => ({ at: [lon, lat] as [number, number], name })), size: 9, color: '#7ee787', when: { level: { from: 'city' } }, transition: 0.6 });
const heat = (lon: number, lat: number, spread: number, size: number) => custom({
  id: 'heat', data: heatAround(lon, lat, 260, spread), at: (d) => d.at, size, shape: 'ground', blend: 'add',
  attributes: { value: (d) => d.v }, uniforms: { gain: 1.2, tint: '#ff3d00' }, varyings: { glow: 'f32' },
  vertex: heatShader.vertex, fragment: heatShader.fragment, when: { level: { from: 'city' } }, transition: 0.8,
});

// ── no network at all: procedural imagery and terrain (the parity check and the tests use these) ─────────────────
const procImagery = () => imagery.custom({
  id: 'procedural', attribution: 'procedural test imagery',
  draw: (g, t) => {
    const b = geo.tileBBox(t.z, t.x, t.y), lon = (b[0] + b[2]) / 2, lat = (b[1] + b[3]) / 2;
    const r = Math.round(90 + 80 * Math.sin(lon * 0.05)), gg = Math.round(120 + 60 * Math.cos(lat * 0.07)), bb = Math.round(70 + 40 * Math.sin((lon + lat) * 0.02));
    g.fillStyle = `rgb(${r},${gg},${bb})`; g.fillRect(0, 0, 256, 256);
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 2; g.strokeRect(1, 1, 254, 254);
    g.fillStyle = 'rgba(20,30,60,0.5)'; g.beginPath(); g.arc(128, 128, 40 + (t.z % 4) * 12, 0, Math.PI * 2); g.fill();
    return true;
  },
});
const synthTerrain = () => terrain.custom({
  id: 'synthetic', attribution: 'synthetic test terrain',
  heights: (t, n) => {
    const h = new Float32Array(n * n);
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const [lon, lat] = geo.tilePoint(t.z, t.x, t.y, i / (n - 1), j / (n - 1));
      const d2 = (lon - 107.6) ** 2 + (lat + 6.85) ** 2;
      h[j * n + i] = 2100 * Math.exp(-d2 / 0.004) + 600 * Math.exp(-d2 / 0.08) + 120 * Math.sin(lon * 60) * Math.cos(lat * 60);
    }
    return h;
  },
});

const DEM = '/dataset/dem/bandung-raya-30m';
const bandungTerrain = () => [terrain.mapzen(), terrain.grid({ id: 'bandung-30m', url: DEM, attribution: 'Copernicus GLO-30 (ESA)', blend: 400, when: { level: { from: 'city' } } })];
const lite = () => earthLite({ url: '/aslnut/data/packs/earth-lite', maxZoom: 4, attribution: 'Sentinel-2 cloudless 2020 by EOX (CC BY 4.0)' });
const globeView: View = { lon: 112, lat: -2, zoom: 1.7 };
const bandungView: View = { lon: 107.62, lat: -6.88, zoom: 11.6, tilt: 62, bearing: 340 };

export const PRESETS: Record<string, Preset> = {
  globe: { title: 'globe', view: globeView, body: () => earth({ imagery: [imagery.sentinel()], terrain: [terrain.mapzen()], base: lite(), exaggerate: (s) => (s.observation.index >= 0 && s.observation.index < 3 ? 4 : 1.5) }), layers: () => [cities()] },
  bandung: { title: 'Bandung + terrain', view: bandungView, editor: true, body: () => earth({ imagery: [imagery.sentinel({ when: { level: { to: 'region' } } }), imagery.esri({ when: { level: { from: 'city' } } })], terrain: bandungTerrain(), base: lite(), exaggerate: (s) => (s.observation.index >= 0 && s.observation.index < 3 ? 4 : 1.5) }), layers: () => [cities({ level: { to: 'region' } }), places(), heat(107.62, -6.91, 0.09, 600)] },
  flat: { title: 'flat (terrain: [])', view: { ...bandungView, tilt: 0, zoom: 12 }, editor: true, body: () => earth({ imagery: [imagery.esri()], terrain: [], base: lite() }), layers: () => [places(), heat(107.62, -6.91, 0.09, 600)] },
  webgl2: { title: 'Bandung, WebGL2 forced', view: bandungView, graphics: 'webgl2', editor: true, body: () => PRESETS.bandung!.body(), layers: () => PRESETS.bandung!.layers() },
  zoom: {
    title: 'globe → Bandung', view: globeView, body: () => PRESETS.bandung!.body(), layers: () => PRESETS.bandung!.layers(),
    keys: [{ at: 0, view: globeView }, { at: 14, view: bandungView, ease: 'cinematic' }],
  },
  plane: { title: 'plane (a floor)', view: { lon: 0, lat: 0, dist: 240, tilt: 55, bearing: 330 }, editor: true, body: () => plane({ size: 200, grid: 5 }), layers: () => [
    points({ id: 'posts', data: Array.from({ length: 24 }, (_, i) => ({ at: planeAt(-80 + (i % 6) * 32, -60 + Math.floor(i / 6) * 40), value: i })), size: 12, color: '#2f81f7' }),
    custom({ id: 'heat', data: Array.from({ length: 60 }, (_, i) => ({ at: planeAt(Math.sin(i * 1.7) * 70, Math.cos(i * 2.3) * 70), v: (i % 7) / 7 })), at: (d) => d.at, size: 30, shape: 'ground', blend: 'add', attributes: { value: (d) => d.v }, uniforms: { gain: 1.2, tint: '#ff3d00' }, varyings: { glow: 'f32' }, vertex: heatShader.vertex, fragment: heatShader.fragment }),
  ] },
  parity: { title: 'parity (no network)', deterministic: true, view: { lon: 107.6, lat: -6.93, zoom: 10.8, tilt: 66, bearing: 350 }, body: () => earth({ imagery: [procImagery()], terrain: [synthTerrain()], exaggerate: 2 }), layers: () => [
    points({ id: 'places', data: PLACES.map(([name, lon, lat]) => ({ at: [lon, lat] as [number, number], name, value: lon - 107.5 })), size: 14, color: '#7ee787',
      shader: { color: 'color = vec4f(mix(color.rgb, vec3f(0.2, 0.4, 1.0), clamp(value * 4.0, 0.0, 1.0)), color.a);', alpha: 'alpha = alpha * (0.6 + 0.4 * step(0.3, length(uv)));' } }),
    custom({ id: 'heat', data: heatAround(107.6, -6.9, 120, 0.08), at: (d) => d.at, size: 1600, shape: 'ground', blend: 'add', attributes: { value: (d) => d.v }, uniforms: { gain: 2, tint: '#ff3d00' }, varyings: { glow: 'f32' }, vertex: heatShader.vertex, fragment: heatShader.fragment }),
  ] },
  'parity-globe': { title: 'parity globe (no network)', deterministic: true, view: { lon: 107, lat: -5, zoom: 2.2 }, body: () => earth({ imagery: [procImagery()], terrain: [synthTerrain()], exaggerate: 30 }), layers: () => [cities()] },
  'parity-flat': { title: 'parity flat (no network)', deterministic: true, view: { lon: 107.6, lat: -6.88, zoom: 12.5, tilt: 0 }, body: () => earth({ imagery: [procImagery()], terrain: [] }), layers: () => [PRESETS.parity!.layers()[1]!] },
  'parity-vectors': { title: 'parity: lines, areas, extrusions (no network)', deterministic: true, view: { lon: 107.62, lat: -6.9, zoom: 11.2, tilt: 55, bearing: 345 }, body: () => earth({ imagery: [procImagery()], terrain: [synthTerrain()], exaggerate: 1.5 }), layers: () => vectors() },
  vectors: { title: 'lines, areas, extrusions on terrain', view: { lon: 107.62, lat: -6.9, zoom: 11.2, tilt: 55, bearing: 345 }, body: () => PRESETS.bandung!.body(), layers: () => vectors() },
  ...DEMOS,
  ...PRODUCTS,
  ...CHECKS,
  ...PEOPLE_PRESETS,
  'parity-plane': { title: 'parity plane', deterministic: true, view: { lon: 0, lat: 0, dist: 240, tilt: 55, bearing: 330 }, body: () => plane({ size: 200, grid: 5 }), layers: () => PRESETS.plane!.layers() },
};
/** mock districts (choropleth + hover + tooltip), lines (traced), blocks (risen) over the Bandung basin */
function vectors(): Element[] {
  const districts = data.geojson({ type: 'FeatureCollection', features: cells([107.48, -7.0, 107.76, -6.8], 7, 5) });
  return [
    area({ id: 'districts', data: districts, color: scale.quantile((d) => d.props.value, { n: 5, range: 'ylorrd' }), opacity: 0.72, outline: { width: 1, color: '#ffffff80' },
      hover: { color: '#ffffff', mix: 0.35, outline: 3 }, tooltip: (d) => `${d.props.name}: ${d.props.value}`, select: 'toggle' }),
    line({ id: 'grid', data: data.geojson({ type: 'FeatureCollection', features: wavy([107.5, -6.98, 107.74, -6.82], 4) }), width: (d) => d.props.kv / 60, color: scale.category((d) => d.props.operator, { range: ['#38bdf8', '#a78bfa'] }), tooltip: (d) => d.props.name }),
    extrusion({ id: 'blocks', data: data.geojson({ type: 'FeatureCollection', features: blocks(107.61, -6.91, 40, 0.035, 0.006) }), height: (d) => d.props.levels * 12, color: '#e8e2d4', tooltip: (d) => `${d.props.levels} levels` }),
    points({ id: 'places', data: PLACES.map(([name, lon, lat]) => ({ at: [lon, lat] as [number, number], name })), size: 10, color: '#7ee787', tooltip: (d) => d.name as string }),
  ];
}
/** the hooks the tests check: each turns its effect up so it can be seen in the pixels */
export const HOOK_TESTS: Record<string, { layer: 'surface' | 'points'; code: Record<string, string> }> = {
  'surface.color': { layer: 'surface', code: { color: 'color = vec4f(1.0, 0.0, 0.0, 1.0);' } },
  'surface.position': { layer: 'surface', code: { position: 'position = position + vec3f(0.0, 1.0e9, 0.0);' } },
  'points.color': { layer: 'points', code: { color: 'color = vec4f(0.0, 0.0, 1.0, color.a);' } },
  'points.position': { layer: 'points', code: { position: 'size = size * 4.0;' } },
  'points.alpha': { layer: 'points', code: { alpha: 'alpha = 0.0;' } },
  'points.reveal': { layer: 'points', code: { reveal: 'alpha = alpha * step(0.5, reveal) * 0.0;' } },
};
