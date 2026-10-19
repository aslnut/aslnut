// Presets the checks use (and anyone can open): ?go=drape (areas and lines on rugged terrain: every ground pixel under
// the area must be the area's, none of the terrain poking through), ?go=gesture (the dashboard while a fast pinch-zoom
// in, out and pan plays on its own, with frame times in the panel: repeat it on a phone). No network for drape.
import { area, data, earth, geo, imagery, line, terrain, type Feature, type Element } from '../../src/index.ts';
import type { DemoPreset } from './demos.ts';
import { PRODUCTS, regionsLayers, regionsParams } from './products.ts';

/** a flat colour: where the ground shows through the area, this is what shows */
export const GROUND_RGB: [number, number, number] = [40, 64, 96];
const flat = () => imagery.custom({ id: 'flat-ground', attribution: 'procedural', draw: (g) => { g.fillStyle = `rgb(${GROUND_RGB.join(',')})`; g.fillRect(0, 0, 256, 256); return true; } });
/** sharp peaks every few km (up to 1.8 km high): what pokes through anything not truly draped */
const rugged = () => terrain.custom({ id: 'rugged', attribution: 'synthetic terrain (sharp peaks)', heights: (t, n) => {
  const h = new Float32Array(n * n);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [lon, lat] = geo.tilePoint(t.z, t.x, t.y, i / (n - 1), j / (n - 1));
    const a = Math.sin(lon * 260) * Math.cos(lat * 240), b = Math.sin(lon * 610 + 1.3) * Math.sin(lat * 570 + 0.4);
    h[j * n + i] = 300 + 900 * Math.max(0, a) ** 3 + 600 * Math.max(0, b) ** 4;
  }
  return h;
} });
const box = (w: number, s: number, e: number, n: number, id: string, props: Record<string, unknown> = {}) => ({ id, props, geometry: { type: 'Polygon' as const, coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
function drapeLayers(): Element[] {
  const cells: ReturnType<typeof box>[] = [];
  for (let i = 0; i < 6; i++) for (let j = 0; j < 6; j++) cells.push(box(107.2 + i * 0.12, -7.2 + j * 0.1, 107.32 + i * 0.12, -7.1 + j * 0.1, `c${i}-${j}`, { v: (i * 7 + j * 3) % 10 }));
  const grid: Feature[] = [];
  for (let i = 0; i <= 12; i++) grid.push({ id: `g${i}`, props: {}, geometry: { type: 'LineString', coordinates: [[107.2 + i * 0.06, -7.2], [107.2 + i * 0.06, -6.6]] } } as Feature);
  return [
    // under everything: one area wider than the view (on rugged terrain, every ground pixel must be this or a cell)
    area({ id: 'under', data: data.geojson({ type: 'FeatureCollection', features: [box(106.4, -8.2, 108.8, -5.8, 'under')] }), color: '#f0c020ff', transition: 0, pickable: false }),
    area({ id: 'cover', data: data.geojson({ type: 'FeatureCollection', features: cells }), color: (d: Feature) => ['#e040fbd9', '#d500f9d9', '#ff4081d9', '#f50057d9', '#ff80abd9'][Number(d.props.v) % 5] as `#${string}`, outline: { width: 1.5, color: '#ffffffcc' }, tooltip: (d) => `cell ${d.id}`, transition: 0 }),
    line({ id: 'grid', data: data.geojson({ type: 'FeatureCollection', features: grid }), width: 3, color: '#ffe066', transition: 0 }),
  ];
}
const HOLE_VIEWS = { jb: { lon: 107.55, lat: -6.95, zoom: 10.4, tilt: 50, bearing: 350 }, kb: { lon: 107.6, lat: -7.05, zoom: 13.8, tilt: 60, bearing: 340 } };
function holes(): Record<string, DemoPreset> {
  const out: Record<string, DemoPreset> = {};
  for (const [k, view] of Object.entries(HOLE_VIEWS)) for (const flatT of [false, true]) {
    out[`holes-${k}${flatT ? '-flat' : ''}`] = { title: `holes check: ${k === 'jb' ? 'West Java, zoom 10.4' : "Kab. Bandung's districts, zoom 13.8"}${flatT ? ', terrain off' : ''}`, view,
      body: () => earth({ imagery: [flat()], terrain: flatT ? [] : [terrain.mapzen()] }),
      layers: () => regionsLayers({ parity: true }).layers.filter((l) => l.kind === 'area' || l.kind === 'line'),
      ready: async (w) => { regionsParams(w); if (k === 'kb') { w.set('regions.province', '32'); w.set('regions.regency', '32.04'); } } };
  }
  return out;
}
const drapeView = { lon: 107.5, lat: -6.92, zoom: 11.3, tilt: 58, bearing: 335 };
/** a near-black ground: what a line adds there is the line alone, each kind in its own colour */
const dark = () => imagery.custom({ id: 'dark-ground', attribution: 'procedural', draw: (g) => { g.fillStyle = 'rgb(12,12,12)'; g.fillRect(0, 0, 256, 256); return true; } });
/** thin lines on rugged terrain, one colour per kind and never on top of each other: 1 px red and 2 px green running
 *  north (away from the camera), 2 px blue dashes [10, 10] running north, 1.5 px yellow area outlines, 3 px cyan
 *  running east (across the view). The same on the prisms and the tiles: widths, brightness and dash lengths compared
 *  (?go=tile-lines, and tile-lines-bg for the ground alone) */
function tileLineLayers(): Element[] {
  const ns = (lon0: number, id: string): Feature[] => Array.from({ length: 12 }, (_, i) => ({ id: `${id}${i}`, props: {}, geometry: { type: 'LineString', coordinates: [[lon0 + i * 0.12, -7.8], [lon0 + i * 0.12, -6.2]] } }) as Feature);
  const ew: Feature[] = Array.from({ length: 16 }, (_, j) => ({ id: `e${j}`, props: {}, geometry: { type: 'LineString', coordinates: [[106.8, -7.75 + j * 0.1], [108.4, -7.75 + j * 0.1]] } }) as Feature);
  const cells: ReturnType<typeof box>[] = [];
  for (let i = 0; i < 12; i++) for (let j = 0; j < 15; j++) cells.push(box(106.8 + i * 0.12, -7.8 + j * 0.1, 106.92 + i * 0.12, -7.7 + j * 0.1, `c${i}-${j}`));
  const fc = (features: Feature[]) => data.geojson({ type: 'FeatureCollection', features });
  return [
    area({ id: 'outlines', data: data.geojson({ type: 'FeatureCollection', features: cells }), color: '#00000000', outline: { width: 1.5, color: '#ffff00' }, transition: 0, pickable: false }),
    line({ id: 'thin1', data: fc(ns(106.83, 'r')), width: 1, color: '#ff0000', transition: 0, pickable: false }),
    line({ id: 'thin2', data: fc(ns(106.86, 'g')), width: 2, color: '#00ff00', transition: 0, pickable: false }),
    line({ id: 'dashed', data: fc(ns(106.89, 'b')), width: 2, color: '#0000ff', dashes: [10, 10], transition: 0, pickable: false }),
    line({ id: 'across', data: fc(ew), width: 3, color: '#00ffff', transition: 0, pickable: false }),
  ];
}
export const CHECKS: Record<string, DemoPreset> = {
  drape: { title: 'areas and lines draped on rugged terrain', deterministic: true, view: drapeView, body: () => earth({ imagery: [flat()], terrain: [rugged()], exaggerate: 2 }), layers: drapeLayers },
  'parity-drape': { title: 'parity: draped on rugged terrain', deterministic: true, view: drapeView, body: () => earth({ imagery: [flat()], terrain: [rugged()], exaggerate: 2 }), layers: drapeLayers },
  'drape-flat': { title: 'the same, terrain off (what the draped marks must cover)', deterministic: true, view: drapeView, body: () => earth({ imagery: [flat()], terrain: [] }), layers: drapeLayers },
  'tile-lines': { title: 'thin lines, outlines and dashes on rugged terrain (prisms and tiles alike)', deterministic: true, view: drapeView, body: () => earth({ imagery: [dark()], terrain: [rugged()], exaggerate: 2 }), layers: tileLineLayers },
  'tile-lines-bg': { title: 'the same ground, no lines', deterministic: true, view: drapeView, body: () => earth({ imagery: [dark()], terrain: [rugged()], exaggerate: 2 }), layers: () => [] },
  // the dashboard on real terrain over a flat-coloured ground (any ground pixel inside the fills is a hole), at the
  // views where holes were seen: West Java at zoom 10.4, Kab. Bandung's districts at zoom 13.8, tilted; -flat: terrain off
  ...holes(),
  // the gesture test on the dashboard (the page plays it: frame times in the panel)
  gesture: { ...PRODUCTS.regions!, title: 'gesture test: fast zoom in, out, pan (frame times in the panel)' },
};
