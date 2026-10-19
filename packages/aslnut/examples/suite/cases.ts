// The suite's cases: each one the same function on WebGL2 and WebGPU (same data, same camera path, same time), built
// fresh for every run: a body and layers. Each run is measured from its first complete image (settled); the time to
// it is `readyMs`.
import { area, data, earth, extrusion, imagery, layer, line, points, terrain, type Body, type Element } from '../../src/index.ts';
import { colorOf, type SuiteData } from './data.ts';
import { fastZoom, fly, java, javaSlow, orbit, pan, drift, still, zoomIn, type Path } from './path.ts';

export interface Ctx { data: SuiteData; bust: string; css: [number, number] }
export interface AslnutSide { body: Body; layers: Element[] }
export interface Case {
  id: string; title: string;
  /** seconds measured (quick mode scales it) */
  dur: number;
  path: Path;
  /** named stretches of the run, reported separately: [name, from s, to s] */
  phases?: [string, number, number][];
  /** 'equal' (the suite's pixel ratio, the moving resolution off), a number, 'device', or 'default' (out of the box:
   *  its own ratio and moving resolution) */
  pr?: 'equal' | number | 'device' | 'default';
  /** the cache key: 'new' (cold for every run) or a name shared by runs of the same engine (the second is warm) */
  cache?: 'new' | string;
  /** each frame, while measured: pointer sweeps etc. */
  act?: 'hover';
  quick?: boolean;
  /** the engines it runs on (default all): an aslnut-only variant compares two ways of aslnut's own */
  engines?: ('webgl2' | 'webgpu')[];
  /** how aslnut draws marks on the ground (default: aslnut's own choice for the device) */
  groundMarks?: 'prisms' | 'tiles';
  /** run only when named in ?only= or in a set (a comparison already decided, kept to check again; a set's own case) */
  optional?: boolean;
  /** a layer switched on and off while measured: its id on both sides, hidden at the start, and when (s) it switches */
  toggle?: { layer: string; at: [number, boolean][] };
  aslnut: (c: Ctx) => AslnutSide;
}

const S2 = 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/{z}/{y}/{x}.jpg';
const DEM = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const GREY = 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}';
const S2_ATTR = 'Sentinel-2 cloudless 2020 by EOX (CC BY 4.0)', DEM_ATTR = 'Mapzen terrain tiles (AWS Open Data)', GREY_ATTR = 'Esri, HERE, Garmin, © OpenStreetMap contributors';
const EXAG = 2;
const b = (url: string, bust: string) => `${url}?r=${bust}`;

// ── the ground, the same on both sides ─────────────────────────────────────────────────────────────────────────
function aslnutGround(c: Ctx, o: { terrain?: boolean; grey?: boolean } = {}): Body {
  const im = [imagery.custom({ id: 's2', url: b(S2, c.bust), maxZoom: 15, attribution: S2_ATTR })];
  if (o.grey) im.push(imagery.custom({ id: 'grey', url: b(GREY, c.bust), maxZoom: 16, opacity: 0.5, attribution: GREY_ATTR }));
  return earth({ imagery: im, terrain: o.terrain === false ? [] : [terrain.mapzen({ url: b(DEM, c.bust) })], exaggerate: EXAG });
}

// ── the choropleth (provinces, then regencies: aslnut by observation level, from the city level), the same classes and colours ─────────────────────
function aslnutChoropleth(c: Ctx): Element[] {
  const look = { opacity: 0.78, outline: { width: 1, color: '#ffffff99' } } as const;
  return [
    area({ id: 'provinces', data: data.geojson(c.data.provinces, { id: 'code' }), color: (d) => colorOf(Number(d.props.v)), ...look, when: { level: { to: 'region' } } }),
    area({ id: 'regencies', data: data.geojson(c.data.regencies, { id: 'code' }), color: (d) => colorOf(Number(d.props.v)), ...look, when: { level: { from: 'city' } }, hover: { color: '#ffffff', mix: 0.3, outline: 3 } }),
  ];
}

const BANDUNG = { lon: 107.61, lat: -6.9, zoom: 12.5, tilt: 50, bearing: 345 };
// a coloured layer switched on and off mid-view (the regencies, no `when`): frame times around each switch
const SWITCHES: [number, boolean][] = [[2, true], [4, false], [6, true], [8, false]];
// open from empty (a cold cache) at five places: ms to the first complete image
const PLACES: [string, { lon: number; lat: number; zoom: number; tilt: number; bearing: number }][] = [
  ['bandung', BANDUNG],
  ['jakarta', { lon: 106.83, lat: -6.2, zoom: 11.5, tilt: 30, bearing: 0 }],
  ['merapi', { lon: 110.44, lat: -7.54, zoom: 11, tilt: 60, bearing: 160 }],
  ['bali', { lon: 115.1, lat: -8.4, zoom: 8.6, tilt: 20, bearing: 0 }],
  ['java', { lon: 110.2, lat: -7.25, zoom: 6.6, tilt: 0, bearing: 0 }],
];

export const CASES: Case[] = [
  { id: 'zoom-in', title: 'globe → Bandung, imagery + terrain', dur: 12, path: zoomIn(12), quick: true,
    aslnut: (c) => ({ body: aslnutGround(c), layers: [] }) },
  { id: 'fast-zoom', title: 'fast zoom in / out at a city', dur: 12, path: fastZoom, quick: true,
    aslnut: (c) => ({ body: aslnutGround(c), layers: [] }) },
  { id: 'pan', title: 'pan at zoom 12, terrain', dur: 8, path: pan,
    aslnut: (c) => ({ body: aslnutGround(c), layers: [] }) },
  { id: 'fly', title: 'fly Bandung → Jakarta → Bandung', dur: 10, path: fly(10),
    aslnut: (c) => ({ body: aslnutGround(c), layers: [] }) },
  { id: 'choropleth-terrain', title: 'choropleth on terrain: Java still 5 s, then zoom to regencies', dur: 11, path: java(5, 11), phases: [['still', 0, 5], ['zoom', 5, 11]], quick: true,
    aslnut: (c) => ({ body: aslnutGround(c), layers: aslnutChoropleth(c) }) },
  { id: 'choropleth-flat', title: 'the same choropleth, terrain off', dur: 11, path: java(5, 11), phases: [['still', 0, 5], ['zoom', 5, 11]],
    aslnut: (c) => ({ body: aslnutGround(c, { terrain: false }), layers: aslnutChoropleth(c) }) },
  { id: 'lines-labels', title: 'province and regency outlines + province names', dur: 8, path: javaSlow,
    aslnut: (c) => ({ body: aslnutGround(c), layers: [
      line({ id: 'reg-lines', data: data.geojson(c.data.regencies, { id: 'code' }), width: 1, color: '#e2e8f0', pickable: false }),
      line({ id: 'prov-lines', data: data.geojson(c.data.provinces, { id: 'code' }), width: 1.8, color: '#f8fafc', pickable: false }),
      layer({ id: 'prov-names', data: data.geojson(c.data.provinceCentres, { id: 'code' }), labels: { text: (d) => String(d.props.name), size: 12, pickable: false } }),
    ] }) },
  { id: 'extrusions', title: '1500 extruded blocks, orbit, terrain', dur: 8, path: orbit,
    aslnut: (c) => ({ body: aslnutGround(c), layers: [extrusion({ id: 'blocks', data: data.geojson(c.data.blocks), height: (d) => Number(d.props.h), color: '#e8e2d4', pickable: false })] }) },
  { id: 'points-10k', title: '10 000 points over Java', dur: 8, path: drift,
    aslnut: (c) => ({ body: aslnutGround(c), layers: [points({ id: 'pts', data: data.geojson(c.data.points), size: 5, color: '#ffb000', pickable: false })] }) },
  { id: 'raster-stack', title: 'two rasters (imagery + 50 % grey basemap), pan, terrain', dur: 8, path: pan,
    aslnut: (c) => ({ body: aslnutGround(c, { grey: true }), layers: [] }) },
  { id: 'hover', title: 'hover sweep over regencies (pick + highlight each frame)', dur: 6, path: still({ lon: 107.6, lat: -6.95, zoom: 8.6, tilt: 30, bearing: 0 }), act: 'hover', quick: true,
    aslnut: (c) => ({ body: aslnutGround(c), layers: aslnutChoropleth(c) }) },
  { id: 'choropleth-terrain-prisms', title: 'the choropleth on terrain, ground marks as prisms (?only=: the phones chose tiles, build 98)', dur: 11, path: java(5, 11), phases: [['still', 0, 5], ['zoom', 5, 11]], engines: ['webgl2', 'webgpu'], groundMarks: 'prisms', optional: true,
    aslnut: (c) => ({ body: aslnutGround(c), layers: aslnutChoropleth(c) }) },
  { id: 'choropleth-terrain-tiles', title: 'the choropleth on terrain, ground marks in the tiles (?only=)', dur: 11, path: java(5, 11), phases: [['still', 0, 5], ['zoom', 5, 11]], engines: ['webgl2', 'webgpu'], groundMarks: 'tiles', optional: true,
    aslnut: (c) => ({ body: aslnutGround(c), layers: aslnutChoropleth(c) }) },
  { id: 'idle', title: 'a still view once it has loaded: 6 s idle (frames drawn should be ~0)', dur: 6, path: still(BANDUNG), quick: true,
    aslnut: (c) => ({ body: aslnutGround(c), layers: [] }) },
  { id: 'cold-start', title: 'fast zoom, empty cache', dur: 8, path: fastZoom, cache: 'cw',
    aslnut: (c) => ({ body: aslnutGround(c), layers: [] }) },
  { id: 'warm-start', title: 'the same fast zoom again, warm cache', dur: 8, path: fastZoom, cache: 'cw',
    aslnut: (c) => ({ body: aslnutGround(c), layers: [] }) },
  { id: 'pr-1', title: 'fast zoom at pixel ratio 1', dur: 8, path: fastZoom, pr: 1,
    aslnut: (c) => ({ body: aslnutGround(c), layers: [] }) },
  { id: 'pr-1.5', title: 'fast zoom at pixel ratio 1.5', dur: 8, path: fastZoom, pr: 1.5,
    aslnut: (c) => ({ body: aslnutGround(c), layers: [] }) },
  { id: 'pr-device', title: "fast zoom at the device's pixel ratio", dur: 8, path: fastZoom, pr: 'device',
    aslnut: (c) => ({ body: aslnutGround(c), layers: [] }) },
  { id: 'defaults', title: 'out of the box: its own defaults, fast zoom + choropleth', dur: 10, path: java(2, 10), pr: 'default', quick: true,
    aslnut: (c) => ({ body: aslnutGround(c), layers: aslnutChoropleth(c) }) },
  // ── the focus bench's own (?set=focus) ──────────────────────────────────────────────────────────────────────
  { id: 'layer-appears', title: 'a coloured layer switched on and off mid-view (on at 2 s, off at 4, on at 6, off at 8)', dur: 10, optional: true,
    path: still({ lon: 107.6, lat: -6.95, zoom: 8.2, tilt: 30, bearing: 0 }),
    phases: [['before', 0.5, 2], ...SWITCHES.map(([t, on], i): [string, number, number] => [`${on ? 'on' : 'off'}-${Math.floor(i / 2) + 1}`, t, t + 0.6])],
    toggle: { layer: 'appear', at: SWITCHES },
    aslnut: (c) => ({ body: aslnutGround(c), layers: [area({ id: 'appear', data: data.geojson(c.data.regencies, { id: 'code' }), color: (d) => colorOf(Number(d.props.v)), opacity: 0.78, outline: { width: 1, color: '#ffffff99' } })] }) },
  ...PLACES.map(([name, v]): Case => ({ id: `first-image-${name}`, title: `open from empty at ${name}: ms to the first complete image`, dur: 2, path: still(v), cache: 'new', optional: true,
    aslnut: (c) => ({ body: aslnutGround(c), layers: [] }) })),
  { id: 'soak', title: "'defaults' again and again: what the page holds after each run must not grow", dur: 10, path: java(2, 10), pr: 'default', optional: true, engines: ['webgpu', 'webgl2'],
    aslnut: (c) => ({ body: aslnutGround(c), layers: aslnutChoropleth(c) }) },
];
/** sets of cases run together (?set=): each group's cases, how many times, and in which order */
export interface SetGroup { cases: string[]; reps: number; /** engine by engine (all of one engine's repeats, then the next), else repeat by repeat */ byEngine?: boolean }
export const SETS: Record<string, { title: string; groups: SetGroup[] }> = {
  focus: { title: 'the focus bench: the open problems, 3 times each, then a soak', groups: [
    { cases: ['choropleth-flat'], reps: 3 },
    { cases: ['choropleth-terrain'], reps: 3 },
    { cases: ['defaults'], reps: 3 },
    { cases: ['points-10k'], reps: 3 },
    { cases: ['pr-1.5', 'pr-1'], reps: 3 },
    // the cache warmed once, then the warm runs
    { cases: ['cold-start'], reps: 1 },
    { cases: ['warm-start'], reps: 3 },
    { cases: ['hover'], reps: 3 },
    { cases: ['layer-appears'], reps: 3 },
    { cases: PLACES.map(([n]) => `first-image-${n}`), reps: 3 },
    { cases: ['soak'], reps: 10, byEngine: true },
  ] },
  soak: { title: "the soak alone: 'defaults' 10 times on each graphics", groups: [{ cases: ['soak'], reps: 10, byEngine: true }] },
};
