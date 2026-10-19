import { presetOf } from '../preset.ts';
// healthy-city: a city twin for walking, cycling, parks, trees and shade, built from aslnut alone.
// Greater Melbourne: councils → suburbs → the street, statistics from open data draped on the terrain.
//   ?go=region | council | suburb | parity-region      (short links for phones)
//   ?ui=twin    the twin dashboard's interface (light glass cards, sheets on a phone; ?go=twin, twin-flow, twin-region)
//   ?theme=dark | grey | light | none   an analysis view on any preset: the world muted, its data in colour (?go=theme-grey)
//   &graphics=auto | webgpu | webgl2   &dpr=1   &clock=30 (a fixed step: the tools) | manual (w.step only)   &log=0
import { AslnutError, arc, zonedTime, catalogues, buildings, roofOf, water, roads as roadsFrom, bakedRoads, openMeteo, shape, collision, controllers, type Made, network, preview, field, rules, kernel, vegetation, worker, GraphicsUnavailable, WEATHERS, avatars, cityRasters, area, data, earth, earthLite, imagery, layer, legend, line, rain, scale, sky, stats, streets, supported, terrain, theme, world, geo,
  type Feature, type Element, type LegendHandle, type Source, type Stats, type Theme, type View, type World } from '../../src/index.ts';
import { CATEGORIES, CLASS_METHODS, NORMALISE_LABEL, QUESTIONS, RAMPS, formatStat, normaliseOptions, unitOf, type Geography, type Normalise, type Question } from './catalog.ts';
import { BUILD, errors, LOG, log, noteError, panelHTML, q, watchFrames } from './page.ts';
import { entityCard, envDialog, layersDialog } from './street-ui.ts';
import { ACCESS_LAYERS, ACCESS_RAMP, ParkAccess, accessPanel } from './park-access.ts';
import { HeatView, heatPanel, probeCard } from './heat.ts';
import { FloodView, floodPanel } from './flood.ts';
import { MELBOURNE_TREES } from './trees.ts';
import { furniture } from './furniture.ts';
import { AVATAR_SHAPES, traffic } from './vehicles.ts';
import { house } from './houses.ts';
import { lineup, streetPeople } from './people.ts';
import { lookAcross, lookAlong, materialsAvenue, speciesAvenue, vehicleAvenue } from './showcase.ts';
import { areaTip, cameraPad, installTwin, loaded, skyChip, twinEnv } from './twin-ui.ts';
import { LOOK, ROADS, STREET_TILES, streetGround, streetWorkers } from './street-level.ts';

const PACK = '/aslnut/data/packs/city';
// the street level's roads, footpaths, nature strips and crossings: baked once (tools › compile, the street place: the
// city tiles' area), drawn as they come; the ground goes under them (the clamp); its plots, buildings (each on its pad),
// trees and furniture placed against them by the bake's gated stages 12–15 (roads/street/built): placement only, the
// looks are this example's (LOOK, street-level.ts: the fleet example loads the same street level)
const want = (q.get('graphics') ?? 'auto') as 'auto' | 'webgpu' | 'webgl2';
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// ── the presets (?go=…) ────────────────────────────────────────────────────────────────────────────────────────────
interface Preset { title: string; view: View; deterministic?: boolean; /** the ready-made people side by side, close (in the middle of the nearest street, looking along it) */ lineup?: { near?: number; names?: string[] }; mode?: 'walk' | 'car' | 'drone'; /** the library's ready-made things down the nearest street */ showcase?: 'trees' | 'vehicles' | 'vehicles-close' | 'materials'; /** the buildings from the open footprints (buildings({ data })) in place of the street level's own */ buildings?: boolean; /** the streets from OpenStreetMap's ways as roads({ data }) builds them, in place of the baked ones */ osmRoads?: boolean; council?: string; suburb?: string; question?: string; /** a Melbourne wall-clock time: 'YYYY-MM-DDTHH:MM' */ time?: string; street?: boolean; weather?: string; access?: 'roads' | 'straight'; /** an analysis view (as ?theme=): the world muted, the data in colour */ theme?: 'dark' | 'grey' | 'light'; heat?: boolean; flood?: boolean; traffic?: boolean; /** the twin dashboard's interface (as ?ui=twin) */ ui?: 'twin'; /** park access: dashes running from each house to its park */ flow?: boolean }
const MELBOURNE: View = { lon: 145.0, lat: -37.86, zoom: 9.3, tilt: 25, bearing: 0 };
const CLAYTON: View = { lon: 145.1205, lat: -37.9245, zoom: 17.6, tilt: 66, bearing: 330 };
/** an instant from a Melbourne wall-clock time ('2026-01-15T15:00'; the presets' times are Melbourne's): the zone's
 *  offset that day */
const melbourne = (t: string): Date => zonedTime(t, 'Australia/Melbourne');
const PRESETS: Record<string, Preset> = {
  region: { title: 'Greater Melbourne', view: MELBOURNE },
  council: { title: 'Monash', view: MELBOURNE, council: 'Monash' },
  suburb: { title: 'Clayton', view: MELBOURNE, council: 'Monash', suburb: 'Clayton' },
  bike: { title: 'Cycling by suburb', view: MELBOURNE, question: 'bike-km' },
  street: { title: 'Clayton, street level', view: CLAYTON, street: true },
  dusk: { title: 'Clayton at dusk', view: { ...CLAYTON, bearing: 110 }, street: true, time: '2026-01-15T20:30' },
  night: { title: 'Clayton at night', view: CLAYTON, street: true, time: '2026-01-15T23:30' },
  rain: { title: 'Clayton in the rain', view: { ...CLAYTON, zoom: 18.4, tilt: 72 }, street: true, time: '2026-07-10T14:00', weather: 'rain' },
  storm: { title: 'a storm at night', view: { ...CLAYTON, zoom: 18.4, tilt: 72 }, street: true, time: '2026-07-10T21:00', weather: 'storm' },
  fog: { title: 'Clayton in fog', view: { ...CLAYTON, zoom: 18, tilt: 70 }, street: true, time: '2026-07-10T08:30', weather: 'fog' },
  access: { title: 'park access, walking', view: { ...CLAYTON, zoom: 17.2, tilt: 50 }, street: true, time: '2026-01-15T15:00', access: 'roads' },
  flood: { title: 'storm water in a downpour', view: { ...CLAYTON, zoom: 17.6, tilt: 55 }, street: true, time: '2026-02-03T16:00', weather: 'storm', flood: true },
  'access-straight': { title: 'park access, straight line', view: { ...CLAYTON, zoom: 17.2, tilt: 50 }, street: true, time: '2026-01-15T15:00', access: 'straight' },
  walk: { title: 'walk the streets', view: { ...CLAYTON, zoom: 18.4, tilt: 60 }, street: true, time: '2026-01-15T17:30', mode: 'walk' },
  car: { title: 'drive the streets', view: { ...CLAYTON, zoom: 18.4, tilt: 60 }, street: true, time: '2026-01-15T10:30', mode: 'car' },
  traffic: { title: 'cars on the streets', view: { ...CLAYTON, zoom: 18.6, tilt: 62 }, street: true, time: '2026-01-15T10:30', traffic: true },
  drone: { title: 'fly a drone', view: { ...CLAYTON, zoom: 18, tilt: 60 }, street: true, time: '2026-01-15T17:30', mode: 'drone' },
  heat: { title: 'heat on the street (the hottest day)', view: { ...CLAYTON, zoom: 18.8, tilt: 38, bearing: 0 }, street: true, heat: true },
  'parity-street': { title: 'street (no network)', view: CLAYTON, street: true, deterministic: true, time: '2026-01-15T15:00' },
  people: { title: 'the ready-made people on the street', view: CLAYTON, street: true, deterministic: true, time: '2026-01-15T16:30', lineup: { near: 13 } },
  'people-close': { title: 'a few of the people, close', view: CLAYTON, street: true, deterministic: true, time: '2026-01-15T16:30', lineup: { near: 6.2, names: ['grandmother', 'boy', 'office-worker', 'father'] } },
  'parity-rain': { title: 'rain (no network)', view: { ...CLAYTON, zoom: 18.4, tilt: 72 }, street: true, deterministic: true, time: '2026-07-10T14:00', weather: 'rain' },
  trees: { title: 'the tree library down a street', view: CLAYTON, street: true, deterministic: true, time: '2026-01-15T15:00', showcase: 'trees' },
  stars: { title: 'the night sky: the real stars low in the south-east', view: { ...CLAYTON, zoom: 18.6, tilt: 80, bearing: 150 }, street: true, deterministic: true, time: '2026-01-15T23:30' },
  buildings: { title: 'buildings from open footprints: roofs, windows', view: { lon: 145.1262, lat: -37.9300, zoom: 19.2, tilt: 66, bearing: 150 }, street: true, deterministic: true, time: '2026-01-15T15:00', buildings: true },
  'buildings-night': { title: 'buildings at night: lit rooms behind the windows', view: { lon: 145.1266, lat: -37.9306, zoom: 20, tilt: 76, bearing: 160 }, street: true, deterministic: true, time: '2026-01-15T22:15', buildings: true },
  'osm-roads': { title: 'streets from OpenStreetMap ways (roads({ data }))', view: { ...CLAYTON, zoom: 18.4, tilt: 58, bearing: 20 }, street: true, deterministic: true, time: '2026-01-15T15:00', osmRoads: true },
  materials: { title: 'the materials side by side', view: CLAYTON, street: true, deterministic: true, time: '2026-01-15T16:00', showcase: 'materials' },
  'materials-rain': { title: 'the materials wet in the rain, at dusk', view: CLAYTON, street: true, deterministic: true, time: '2026-07-10T17:20', weather: 'rain', showcase: 'materials' },
  water: { title: 'a lake and a creek (Vicmap Hydro)', view: { lon: 145.0998, lat: -37.9152, zoom: 18.4, tilt: 62, bearing: 20 }, street: true, deterministic: true, time: '2026-01-15T17:00' },
  'trees-counted': { title: 'the street trees counted (zoomed out)', view: { ...CLAYTON, zoom: 16.45, tilt: 40 }, street: true, deterministic: true, time: '2026-01-15T15:00' },
  vehicles: { title: 'the car and drone presets down a street', view: CLAYTON, street: true, deterministic: true, time: '2026-01-15T11:00', showcase: 'vehicles' },
  'vehicles-close': { title: 'the bus and the truck close: liveries, doors, lamps', view: CLAYTON, street: true, deterministic: true, time: '2026-01-15T16:30', showcase: 'vehicles-close' },
  'vehicles-dusk': { title: 'the vehicles at dusk, their lamps lit', view: CLAYTON, street: true, deterministic: true, time: '2026-01-15T21:15', showcase: 'vehicles' },
  'parity-region': { title: 'region (no network)', view: { ...MELBOURNE, tilt: 0 }, deterministic: true },
  // the twin dashboard's interface: its arcs from every house to the nearest park (the analysis look: a dark ground and
  // sky), the same with dashes running along them, and the region in it
  twin: { title: 'the twin dashboard: park access arcs', view: { ...CLAYTON, zoom: 17.2, tilt: 50 }, street: true, time: '2026-01-15T15:00', access: 'straight', ui: 'twin' },
  'twin-flow': { title: 'the twin dashboard: the arcs running', view: { ...CLAYTON, zoom: 17.2, tilt: 50 }, street: true, time: '2026-01-15T15:00', access: 'straight', flow: true, ui: 'twin' },
  'twin-region': { title: 'the twin dashboard over the region', view: MELBOURNE, ui: 'twin' },
  // an analysis view (core › render › style › theme): park access in its one colour scale on a grey world
  'theme-grey': { title: 'park access on a grey world (a theme)', view: { ...CLAYTON, zoom: 17.2, tilt: 50 }, street: true, time: '2026-01-15T15:00', access: 'straight', theme: 'grey' },
};
const go = presetOf(q, Object.keys(PRESETS), 'region');
const preset = PRESETS[go]!;
/** the twin dashboard's interface (?ui=twin, or a twin preset; ?ui=plain the default one) */
const TWIN = q.get('ui') === 'twin' || (preset.ui === 'twin' && q.get('ui') !== 'plain');
if (TWIN) installTwin({ place: 'Greater Melbourne' });
// the analysis view (aslnut's theme): ?theme= (or the preset's) mutes the whole world, its data in colour; else park
// access brings its own (dark) while it is on. Its subjects are the data layers; their colours one scale (the ramp)
const SUBJECTS = ['councils-stat', 'suburbs-stat', ...ACCESS_LAYERS, 'heat-field', 'storm-water'];
const themeQ = q.get('theme') ?? preset.theme ?? null;
const pageTheme: Theme | null = themeQ === 'dark' || themeQ === 'grey' || themeQ === 'light' ? theme[themeQ]({ subjects: SUBJECTS, ramp: ACCESS_RAMP }) : null;
/** park access's look while it is on: the page's theme, else a dark one */
const analysisTheme: Theme | null = themeQ === 'none' ? null : pageTheme ?? theme.dark({ subjects: SUBJECTS, ramp: ACCESS_RAMP });

// ── the ground: imagery and terrain from the network, or procedural (the parity check) ────────────────────────────
const procImagery = () => imagery.custom({ id: 'procedural', attribution: 'procedural', draw: (g, t) => { const b = geo.tileBBox(t.z, t.x, t.y); const v = Math.round(70 + 25 * Math.sin((b[0] + b[2]) * 9) * Math.cos((b[1] + b[3]) * 7)); g.fillStyle = `rgb(${v},${v + 14},${v + 8})`; g.fillRect(0, 0, 256, 256); return true; } });
/** a plain ground of the original's street green (the hillshade reads the land over it) */
const calmGround = () => imagery.custom({ id: 'calm-ground', attribution: '', draw: (g) => { g.fillStyle = '#9cab72'; g.fillRect(0, 0, 256, 256); return true; } });
// the sky: the real sun and moon for Melbourne's time, and its weather
// the real stars at night (Hipparcos, to magnitude 5: a suburb's sky), from the pack served with the data
// (an analysis view darkens or greys it through the world's theme)
const skyL = sky({ stars: { magnitude: 5, catalogue: catalogues.hipparcos({ url: '/aslnut/data/packs/sky/hipparcos.tsv' }) } });
if (preset.weather) skyL.setWeather(preset.weather, { seconds: 0 });
const body = () => preset.deterministic
  ? earth({ imagery: [procImagery()], terrain: [streetGround(groundLane())], sky: skyL })
  // the calm look (the default): no imagery, the land read from its heights (a hillshade over a plain green, as the
  // original drew its streets); satellite imagery is a layer one turns on (Layers › satellite, or ?satellite=1)
  : earth({ sky: skyL, imagery: [calmGround(), imagery.sentinel({ when: (s) => (s.user.toggles.satellite && s.observation.index <= 3 ? 1 : 0) }), imagery.esri({ when: (s) => (s.user.toggles.satellite && s.observation.index > 3 ? 1 : 0) })], terrain: [terrain.mapzen(), streetGround(groundLane())], base: null, exaggerate: (s) => (s.observation.index < 4 ? 1.5 : 1),
    surface: { shade: 0.75 } });

// ── the data ─────────────────────────────────────────────────────────────────────────────────────────────────────
const councils = data.geojson(`${PACK}/councils.geojson`, { attribution: '© State of Victoria (Vicmap Admin), CC BY 4.0 · ABS Census 2021' });
const suburbs = data.geojson(`${PACK}/suburbs.geojson`, { id: 'code', attribution: '© State of Victoria (Vicmap Admin), CC BY 4.0 · ABS Census 2021' });
const openSpace = data.geojson(`${PACK}/open-space.geojson`, { attribution: 'Open space © VEAC / State of Victoria, CC BY 4.0' });

// ── what is asked now ──────────────────────────────────────────────────────────────────────────────────────────────
interface Ask { question: Question; geography: Geography; normalise: Normalise; method: string; ramp: string }
let ask: Ask = { question: QUESTIONS.find((x) => x.id === (preset.question ?? 'park-area'))!, geography: preset.question === 'bike-km' ? 'suburb' : 'council', normalise: 'share', method: 'jenks', ramp: 'rdylgn' };
ask.normalise = ask.question.normalise[0]!;
const statsFor = (g: Geography, a: Ask): Stats => stats({ areas: g === 'council' ? councils : suburbs, ...a.question.measure({ openSpace }), ...normaliseOptions(a.question, a.normalise) });
const statC = statsFor('council', ask), statS = statsFor('suburb', ask);
const colourOf = (a: Ask) => (scale as unknown as Record<string, (v: (d: Feature) => unknown, o: object) => never>)[a.method]!((d: Feature) => d.props.value, { n: 5, range: a.ramp, reverse: a.question.highIsBad ? a.ramp === 'rdylgn' || a.ramp === 'spectral' : false, missing: '#5b6470' });

// ── the drill-down: region → council → suburb ─────────────────────────────────────────────────────────────────────
type Level = { kind: 'region' } | { kind: 'council'; f: Feature } | { kind: 'suburb'; f: Feature; council: Feature };
let level: Level = { kind: 'region' };

// the street level: open data in 500 m tiles, built round the camera when it comes close
// the street level's tiles are built in workers (the look is the same there: tiles.worker.ts)
/** the tree's hover form: a wire net round its crown (made once per size) */
const nets = new Map<string, Made>();
function crownNet(r: number, h: number, color = '#ffe066'): Made | null {
  if (!(r > 0) || !(h > 0)) return null;
  const k = `${r.toFixed(1)}:${h.toFixed(1)}${color === '#ffe066' ? '' : `:${color.slice(1)}`}`; let m = nets.get(k);
  if (!m) { m = shape({ id: `crown-net-${k.replace(/:/g, '-')}`, params: {}, build: (b) => { b.solid('sphere', { radius: 1.05 * r, sides: 16, at: [0, Math.max(r, h - r), 0], color, material: 'wire' }); } }).make(); nets.set(k, m); }
  return m;
}
// no procedural poles: there is no open data for them here (the street level draws poles only where data has them)
const tileLane = streetWorkers(q.get('workers') ? Number(q.get('workers')) : undefined);
// (the ground under the roads made in the same lane)
function groundLane() { return q.get('workers') === '0' ? undefined : tileLane; }
let furnitureSoon = 0;
const roads = bakedRoads({ url: `${ROADS}/index.json`, near: 3500, worker: q.get('workers') === '0' ? undefined : tileLane, when: { level: { from: 'street' } }, tooltip: (d) => `${d.props.name ?? d.props.what ?? d.kind}${d.props.highway ? ` · ${d.props.highway}` : ''}` });
// zoomed out over the street level (a tree a few pixels across), the trees are counted: a number per 250 m square
// instead of every tree (core › geometry › shapes › levels › counted)
const street = streets({ url: STREET_TILES, near: 3500, look: LOOK, counted: { cell: 250, level: 'street', size: 11, color: '#e8f5d0' },
  // hover a tree: the original's wire net round its crown (1.05 × its radius, 16 × 12)
  hover: { color: '#ffe066', shape: (d: { kind: string; props: Record<string, unknown> }) => (d.kind === 'tree' ? crownNet(Number(d.props['crown radius (m)']), Number(d.props['height (m)'])) : null) },
  // (the twin dashboard: the selected tree in its blue)
  ...(TWIN ? { selected: { shape: (d: { kind: string; props: Record<string, unknown> }) => (d.kind === 'tree' ? crownNet(Number(d.props['crown radius (m)']), Number(d.props['height (m)']), '#38bdf8') : null) } } : {}), worker: q.get('workers') === '0' ? undefined : tileLane, onTile: () => { clearTimeout(furnitureSoon); furnitureSoon = window.setTimeout(() => furn.update(street.built()), 400); }, when: { level: { from: 'street' } }, tooltip: (d) => `${d.props.name ?? d.props.kind ?? d.kind}${d.props['height (m)'] ? ` · ${d.props['height (m)']} m` : ''}` });
// the buildings from the open footprints (Overture: height and class), as aslnut's buildings({ data }) draws them:
// houses as houses, roofs from tags or this example's rule (low blocks hipped), windows lit at night (fewer late),
// rooms behind them (?go=buildings: the street level's own buildings give way to them)
const openBuildings = buildings({ id: 'open-buildings', data: data.geojson(`${PACK}/test-buildings.geojson`, { attribution: 'Buildings: Overture Maps (ODbL)' }), when: { level: { from: 'street' } },
  roofs: (d) => roofOf(d.props) ?? (Number(d.props.h) < 10 ? 'hip' : 'flat'), windows: { lit: (s) => (s.time.local.hour >= 23 || s.time.local.hour < 6 ? 0.15 : 0.5), interior: true },
  tooltip: (d) => `a building · ${d.props['height (m)']} m` });
// the streets straight from OpenStreetMap's ways (?go=osm-roads): aslnut's roads({ data }) splits them where they meet,
// fits each section's profile from its tags and the rules, solves the junctions, and gives a network to route on
const osmRoads = roadsFrom({ id: 'osm-roads', data: data.geojson(`${ROADS}.geojson`, { attribution: '© OpenStreetMap contributors (ODbL)' }), when: { level: { from: 'street' } }, tooltip: (d) => `${d.props.name ?? 'road'}${d.props['carriageway (m)'] ? ` · ${d.props['carriageway (m)']} m` : ''}` });
// the water: lakes and creeks (Vicmap Hydro) and the sea (Port Phillip Bay over the terrain's seafloor), drawn by
// aslnut's water() in place of the street level's own
const waterSrc = data.geojson(`${PACK}/water.geojson`, { attribution: '© State of Victoria (Vicmap Hydro), CC BY 4.0' });
const waterL = water({ id: 'water', lakes: waterSrc, rivers: waterSrc, sea: true, tooltip: (d) => `${d.props.name ?? 'water'}${d.props['width (m)'] ? ` · ${d.props['width (m)']} m wide` : ''}` });
/** what the street level builds itself: not its water (water() draws it), nor its buildings where the open footprints
 *  stand in (?go=buildings) */
const streetKinds = (k: string) => k !== 'water' && k !== 'waterway' && !(preset.buildings && k === 'building');
street.setView(streetKinds);
// street furniture authored in this example (furniture.ts), placed on what the street level built
const furn = furniture(null as never);
function layers(): Element[] {
  const tip = (d: Feature) => (TWIN
    ? areaTip(String(d.props.name), (d.props.lga_name as string) ?? null, `${formatStat(d.props.value as number)} ${unitOf(ask.question, ask.normalise)}`, Number(d.props.pop) || null) as unknown as string
    : `${d.props.name}\n${formatStat(d.props.value as number)} ${unitOf(ask.question, ask.normalise)}${d.props.rank ? ` · #${d.props.rank}` : ''}`);
  return [
    area({ id: 'councils-stat', data: councils.join(statC, { on: 'id' }), color: colourOf(ask), opacity: 0.72, outline: { width: 1.2, color: '#ffffffaa' },
      hover: { color: '#ffffff', mix: 0.3, outline: 2.5 }, tooltip: tip, transition: 0.25, onTap: (f) => drillCouncil(f.d as Feature) }),
    area({ id: 'suburbs-stat', data: suburbs.join(statS, { on: 'id' }), color: colourOf(ask), opacity: 0.72, outline: { width: 0.7, color: '#ffffff88' }, when: false,
      hover: { color: '#ffffff', mix: 0.3, outline: 2.5 }, tooltip: tip, transition: 0.25, onTap: (f) => drillSuburb(f.d as Feature) }),
    line({ id: 'council-lines', data: councils, width: 1.4, color: '#ffffffc0', pickable: false, when: { level: { from: 'region', to: 'district' } } }),
    waterL, preset.osmRoads ? osmRoads : roads, street, street.wires, ...(preset.buildings ? [openBuildings] : []), ...furn.layers, rain(preset.deterministic ? { at: 3 } : {}),
    layer({ id: 'council-names', data: councils, when: (s) => (s.observation.level === 'region' || s.observation.level === 'city') && !s.user.toggles['in-council'], labels: { text: (d) => d.props.name as string, size: 11, color: '#f8fafc', pickable: false } }),
    layer({ id: 'suburb-names', data: suburbs, when: { level: { from: 'city', to: 'street' } }, labels: { text: (d) => d.props.name as string, size: 10, color: '#e2e8f0', filter: (d) => !!(level.kind !== 'region' && d.props.lga === (level.kind === 'suburb' ? level.council.id : level.f.id)), pickable: false } }),
  ];
}
let w: World;
let lg: LegendHandle | null = null;
const crumbs = () => {
  // on a phone, deeper levels name the region shortly (the top bar has room for two names)
  const parts: string[] = [`<a href="#" data-up="region" class="${level.kind === 'region' ? '' : 'up'}">${level.kind === 'region' ? 'Greater Melbourne' : '<span class="far">Greater </span>Melbourne'}</a>`];
  if (level.kind !== 'region') { const c = level.kind === 'council' ? level.f : level.council; parts.push(`<span class="sep">›</span><a href="#" data-up="council" class="${level.kind === 'council' ? '' : 'up'}">${esc(c.props.name)}</a>`); }
  if (level.kind === 'suburb') parts.push(`<span class="sep">›</span><a href="#">${esc(level.f.props.name)}</a>`);
  $('#crumbs').innerHTML = parts.join('');
  $('#crumbs').querySelectorAll<HTMLAnchorElement>('[data-up]').forEach((a) => { a.onclick = (e) => { e.preventDefault(); if (a.dataset.up === 'region') drillRegion(); else if (level.kind === 'suburb') drillCouncil(level.council); }; });
};
function show(): void {
  // which areas carry the statistic: councils over the region (a council question), else the suburbs (of the council)
  const suburbLevel = level.kind !== 'region' || ask.geography === 'suburb';
  const sub = w.element('suburbs-stat'), cou = w.element('councils-stat');
  const inCouncil = level.kind === 'region' ? null : level.kind === 'council' ? level.f.id : level.council.id;
  // the statistics give way to the street level (core › observation: presence by level, never by the camera)
  const near = { level: { to: 'district' } };
  (sub as unknown as { setProps(p: object): void }).setProps({ when: suburbLevel && ask.question.geographies.includes('suburb') ? near : false, filter: inCouncil === null ? null : { lga: String(inCouncil) }, opacity: level.kind === 'suburb' ? 0.35 : 0.72 });
  (cou as unknown as { setProps(p: object): void }).setProps({ when: !suburbLevel ? near : false, filter: null });
  w.toggle('in-council', level.kind !== 'region');
  const layerId = suburbLevel ? 'suburbs-stat' : 'councils-stat';
  lg?.remove();
  lg = legend(w, { for: layerId, into: $('#legend-slot'), format: (v) => formatStat(v), ...(TWIN ? { className: 't-legend-rows' } : {}) });
  $('#legend-box').style.display = streetNear ? 'none' : 'block';
  $('#walk').style.display = level.kind === 'suburb' && !streetNear ? 'block' : 'none';
  if (TWIN) {
    // the dashboard's legend: the question, then its unit and the areas it is per, the sources under the classes
    $('#legend-title').textContent = ask.question.title;
    $('#legend-sub').textContent = `${unitOf(ask.question, ask.normalise)} · per ${suburbLevel ? 'suburb' : 'council'}`;
    $('#legend-src').innerHTML = `Sources: ${ask.question.sources.map((x) => (x.url ? `<a href="${esc(x.url)}" target="_blank" rel="noopener">${esc(x.title)}</a>` : esc(x.title))).join(' · ')}`;
    $('#legend-box').style.display = streetNear || accessOn() ? 'none' : 'block';
  } else $('#legend-title').textContent = `${ask.question.title} · ${unitOf(ask.question, ask.normalise)}`;
  crumbs();
}
/** the camera is at the street level (the statistics give way) */
let streetNear = false;
/** park access is on (the twin dashboard hides the legend then) */
let accessOn = () => false;
/** to the street level: the suburb's middle, close and tilted (the street tiles cover the Clayton area) */
async function toStreet(): Promise<void> {
  const f = level.kind === 'suburb' ? level.f : null;
  const at = f ? (() => { const b = bboxOfF(f); return [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2]; })() : [CLAYTON.lon, CLAYTON.lat];
  const inArea = street.area ? (() => { const b = (street.area as { bbox?: number[] }).bbox ?? [145.09, -37.95, 145.16, -37.9]; return at[0]! > b[0]! && at[0]! < b[2]! && at[1]! > b[1]! && at[1]! < b[3]!; })() : true;
  const to = inArea ? { lon: at[0]!, lat: at[1]!, zoom: 17.4, tilt: 64, bearing: 330 } : CLAYTON;
  if (!inArea) { const h = $('#hint'); h.textContent = 'street detail covers the Clayton area: flying there'; h.style.opacity = '1'; setTimeout(() => { h.style.opacity = '0'; }, 3500); }
  log('street', { inArea });
  await w.fly(to, { seconds: 2.4 });
}
const bboxOfF = (f: Feature): [number, number, number, number] => { const b: [number, number, number, number] = [180, 90, -180, -90]; const walk = (c: unknown): void => { if (Array.isArray(c) && typeof c[0] === 'number') { b[0] = Math.min(b[0], c[0] as number); b[1] = Math.min(b[1], c[1] as number); b[2] = Math.max(b[2], c[0] as number); b[3] = Math.max(b[3], c[1] as number); } else if (Array.isArray(c)) c.forEach(walk); }; walk((f.geometry as { coordinates: unknown }).coordinates); return b; };
async function drillRegion(): Promise<void> {
  level = { kind: 'region' }; show(); w.select([]);
  await w.fly(MELBOURNE, { seconds: 1.6 });
}
async function drillCouncil(f: Feature): Promise<void> {
  level = { kind: 'council', f }; show(); w.select([]);
  log('drill', { to: 'council', name: f.props.name });
  await w.fit(f, { padding: 0.06, tilt: 30, bearing: 0, seconds: 1.8 });
}
async function drillSuburb(f: Feature): Promise<void> {
  const council = level.kind === 'council' ? level.f : level.kind === 'suburb' ? level.council : councils.get(String(f.props.lga));
  if (!council) return;
  level = { kind: 'suburb', f, council }; show(); w.select([String(f.id)]);
  log('drill', { to: 'suburb', name: f.props.name });
  await w.fit(f, { padding: 0.04, tilt: 55, bearing: 340, seconds: 2.2 });
}

// ── the statistics dialog ──────────────────────────────────────────────────────────────────────────────────────────
let tab = ask.question.category;
function statsDialog(): void {
  const tabs = $('#tabs'), pane = $('#pane');
  tabs.innerHTML = CATEGORIES.map((c) => `<button data-c="${c.id}" class="${c.id === tab ? 'on' : ''}" ${c.ready ? '' : ''}>${esc(c.title)}${c.ready ? '' : `<span class="note">${esc(c.note ?? '')}</span>`}</button>`).join('');
  tabs.querySelectorAll<HTMLButtonElement>('[data-c]').forEach((b) => { b.onclick = () => { tab = b.dataset.c!; const first = QUESTIONS.find((x) => x.category === tab); if (first && first.category !== ask.question.category) setAsk({ question: first, normalise: first.normalise[0]!, geography: first.geographies.includes(ask.geography) ? ask.geography : first.geographies[0]! }); statsDialog(); }; });
  const cat = CATEGORIES.find((c) => c.id === tab)!;
  if (!cat.ready) { pane.innerHTML = `<div class="desc">${esc(cat.note ?? 'Not ready yet.')}</div>`; return; }
  const qs = QUESTIONS.filter((x) => x.category === tab), a = ask, st = a.geography === 'council' ? statC : statS;
  const rows = st.ranked(a.question.highIsBad ? 'desc' : 'desc').filter((r) => level.kind === 'region' || a.geography === 'council' || String(r.lga) === String(level.kind === 'council' ? level.f.id : level.council.id));
  const max = Math.max(1e-9, ...rows.map((r) => r.value ?? 0));
  pane.innerHTML = `<div class="qs">${qs.map((x) => `<button data-q="${x.id}" class="${x.id === a.question.id ? 'on' : ''}">${esc(x.title)}</button>`).join('')}</div>
    <div class="desc">${esc(a.question.description)}</div>
    <div class="cfg">
      <label>per</label><select id="c-geo">${a.question.geographies.map((g) => `<option value="${g}" ${g === a.geography ? 'selected' : ''}>${g === 'council' ? 'council (LGA)' : 'suburb'}</option>`).join('')}</select>
      <label>normalise</label><select id="c-norm">${a.question.normalise.map((n) => `<option value="${n}" ${n === a.normalise ? 'selected' : ''}>${NORMALISE_LABEL[n]}</option>`).join('')}</select>
      <label>classes</label><select id="c-method">${CLASS_METHODS.map(([k, t]) => `<option value="${k}" ${k === a.method ? 'selected' : ''}>${t}</option>`).join('')}</select>
      <label>colours</label><select id="c-ramp">${RAMPS.map(([k, t]) => `<option value="${k}" ${k === a.ramp ? 'selected' : ''}>${t}</option>`).join('')}</select>
    </div>
    <table class="ranked">${rows.slice(0, 40).map((r) => `<tr><td class="r">${r.rank ?? ''}</td><td>${esc(r.name)}</td><td style="width:34%"><div class="bar" style="width:${Math.max(1, (100 * (r.value ?? 0)) / max).toFixed(1)}%"></div></td><td class="n">${formatStat(r.value)}</td></tr>`).join('')}</table>
    <div class="desc">${rows.length} ${a.geography === 'council' ? 'councils' : 'suburbs'} · ${esc(unitOf(a.question, a.normalise))}${rows.length > 40 ? ' · the top 40 shown' : ''}</div>
    <div class="sources">Sources: ${a.question.sources.map((s) => `${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.title)}</a>` : esc(s.title)} (${esc(s.licence)})`).join(' · ')}</div>
    <div class="actions"><button id="c-close">Close</button><button id="c-show" class="primary">Show on map</button></div>`;
  pane.querySelectorAll<HTMLButtonElement>('[data-q]').forEach((b) => { b.onclick = () => { const x = QUESTIONS.find((y) => y.id === b.dataset.q)!; setAsk({ question: x, normalise: x.normalise[0]!, geography: x.geographies.includes(ask.geography) ? ask.geography : x.geographies[0]! }); statsDialog(); }; });
  ($('#c-geo') as HTMLSelectElement).onchange = (e) => { setAsk({ geography: (e.target as HTMLSelectElement).value as Geography }); statsDialog(); };
  ($('#c-norm') as HTMLSelectElement).onchange = (e) => { setAsk({ normalise: (e.target as HTMLSelectElement).value as Normalise }); statsDialog(); };
  ($('#c-method') as HTMLSelectElement).onchange = (e) => { setAsk({ method: (e.target as HTMLSelectElement).value }); statsDialog(); };
  ($('#c-ramp') as HTMLSelectElement).onchange = (e) => { setAsk({ ramp: (e.target as HTMLSelectElement).value }); statsDialog(); };
  $('#c-close').onclick = () => $('#d-stats').classList.remove('open');
  $('#c-show').onclick = () => { $('#d-stats').classList.remove('open'); show(); };
}
function setAsk(p: Partial<Ask>): void {
  ask = { ...ask, ...p };
  const o = { ...ask.question.measure({ openSpace }), ...normaliseOptions(ask.question, ask.normalise) };
  // the measure's keys that are not in the new one are cleared (a count after a sum)
  const clear = { of: undefined, filter: undefined, sum: undefined, mean: undefined, value: undefined, count: undefined };
  statC.setOptions({ ...clear, ...o }); statS.setOptions({ ...clear, ...o });
  for (const id of ['councils-stat', 'suburbs-stat']) (w.element(id) as unknown as { setProps(p: object): void }).setProps({ color: colourOf(ask) });
  log('ask', { q: ask.question.id, geo: ask.geography, norm: ask.normalise, method: ask.method });
  show();
}

// ── the environment chip: the time on the clocks where the camera is (the world's zone: 'auto', from the place) ─────
const clock = () => { const l = w.state.time.local; return `${String(l.hour).padStart(2, '0')}:${String(l.minute).padStart(2, '0')}`; };

async function main(): Promise<void> {
  const canvas = $<HTMLCanvasElement>('#view');
  const sup = await supported();
  log('start', { want, support: sup, dpr: devicePixelRatio, css: [innerWidth, innerHeight], ua: navigator.userAgent });
  $('#build').textContent = `aslnut healthy city · build ${BUILD}`;
  try {
    w = await world(canvas, {
      body: body(), view: preset.view, graphics: want,
      // a twin: looked at by levels (the default ladder; margin 0.3, dwell 0.5 s, the last 2 levels kept 60 s)
      observation: { levels: 'default' },
      // the device picks (auto, the default) and the governor holds it to the budget; &quality=lite|realistic|auto
      quality: (q.get('quality') as 'lite' | 'realistic' | 'auto' | null) ?? 'auto',
      groundMarks: q.get('ground') === 'tiles' ? 'tiles' : q.get('ground') === 'prisms' ? 'prisms' : undefined,
      clock: q.get('clock') === 'manual' ? 'manual' : q.get('clock') ? { fps: Number(q.get('clock')) } : 'real',
      time: q.get('t') ? melbourne(q.get('t')!) : preset.time ? melbourne(preset.time) : preset.deterministic ? new Date(Date.UTC(2026, 0, 15, 3, 0, 0)) : 'now',
      // the clocks keep the zone of the place under the camera (Melbourne's here)
      timeZone: 'auto',
      render: { shadows: q.get('shadows') !== '0' },
      pixelRatio: q.get('dpr') ? Number(q.get('dpr')) : undefined,
      // the device's budget (auto: a phone holds 30 frames a second at the least: the governor drops detail, shadows,
      // quality, then resolution (to 1.5, smoothed by FXAA while it is cut) before frames go over 33 ms); ?budget=ms
      // sets another, ?budget=0 none; ?aa=1 smooths every frame, ?aa=0 none
      resolution: { antialias: q.get('aa') === '1' ? true : q.get('aa') === '0' ? false : 'auto' },
      budget: q.get('budget') ? (Number(q.get('budget')) > 0 ? { frameMs: Number(q.get('budget')) } : false) : 'auto',
      log: LOG,
      user: { toggles: { satellite: q.get('satellite') === '1' } },
      ...(TWIN ? { tooltip: { className: 'twin-tip' } } : {}),
      theme: pageTheme,
      attribution: { format: (c) => `${c.slice(0, 3).join(' · ')} · build ${BUILD} · ${w?.api === 'webgpu' ? 'WebGPU' : 'WebGL2'}` },
      onError: (e) => noteError(e instanceof AslnutError ? e.message : String((e as Error)?.message ?? e)),
    });
  } catch (e) {
    const why = e instanceof GraphicsUnavailable ? `${e.message} · WebGPU here: ${sup.webgpu ? 'yes' : 'no'} · WebGL2 here: ${sup.webgl2 ? 'yes' : 'no'}` : String((e as Error).message);
    $('#panel').style.display = 'block'; $('#panel').innerHTML = `<b>healthy city · build ${BUILD}</b><div class="err">${esc(why)}</div>`;
    log('fail', { msg: why }); return;
  }
  log('device', { api: w.api, renderer: w.stats().device, reason: w.reason });
  w.add(...layers());
  // a city's twin: the hands go from the whole metropolis (zoom 6) to a doorstep, never out to the globe
  w.control(null, controllers.orbit({ zoomRange: [6, 21.5] }));
  watchFrames(w);
  show();
  // the panel: which graphics, frames, tiles; the presets as short links
  const link = (k: string, g?: string) => { const u = new URLSearchParams(q); u.set('go', k); if (g) u.set('graphics', g); else u.delete('graphics'); return `?${u}`; };
  // the quality: the device's pick (auto), or one forced (&quality=lite|realistic): the page opened again with it
  const qNow = q.get('quality') ?? 'auto', qLink = (v: string) => { const u = new URLSearchParams(q); if (v === 'auto') u.delete('quality'); else u.set('quality', v); return `?${u}`; };
  const qualityLinks = () => ['auto', 'lite', 'realistic'].map((v) => `<a href="${qLink(v)}" class="${v === qNow ? 'on' : ''}">${v}</a>`).join('');
  const links = () => Object.keys(PRESETS).filter((k) => !k.startsWith('parity')).map((k) => `<a href="${link(k)}" class="${k === go ? 'on' : ''}">${k}</a>`).join('') + `<a href="${link(go, 'webgpu')}" class="${want === 'webgpu' ? 'on' : ''}">webgpu</a><a href="${link(go, 'webgl2')}" class="${want === 'webgl2' ? 'on' : ''}">webgl2</a><br>quality ${qualityLinks()}`;
  let panelOn = q.get('panel') === '1';
  const drawPanel = () => { if (panelOn && !w.isDisposed) $('#panel').innerHTML = panelHTML(w, links()); $('#panel').style.display = panelOn ? 'block' : 'none'; };
  $('#b-panel').onclick = () => { panelOn = !panelOn; drawPanel(); };
  setInterval(drawPanel, 400); drawPanel();
  if (!TWIN) { setInterval(() => { const c = clock(); if ($('#env-t').textContent !== c) $('#env-t').textContent = c; }, 1000); $('#env-t').textContent = clock(); }
  // the credits on screen are the world's (with the build and the graphics after them)
  $('#build').remove();
  // dialogs
  $('#b-stats').onclick = () => { const d = $('#d-stats'); d.classList.toggle('open'); if (d.classList.contains('open')) statsDialog(); };
  $('#x-stats').onclick = () => $('#d-stats').classList.remove('open');
  $('#b-layers').onclick = () => $('#d-layers').classList.toggle('open');
  $('#x-layers').onclick = () => $('#d-layers').classList.remove('open');
  $('#env').onclick = () => $('#d-env').classList.toggle('open');
  $('#x-env').onclick = () => $('#d-env').classList.remove('open');
  // the street level: what was tapped, time and weather, curated views
  entityCard(w);
  // the weather: a preset, or what is observed now at three places round the view (Open-Meteo), read where the view is
  const observed = async () => {
    const c = w.camera; const pts: [number, number][] = [[c.lon - 0.12, c.lat + 0.05], [c.lon + 0.12, c.lat + 0.05], [c.lon, c.lat - 0.1]];
    try { const fs = await openMeteo.current(pts, { loader: w.loader }); skyL.feed({ data: () => fs, wind: 'wind', rain: 'rain', visibility: 'visibility', cover: 'cover' }); log('weather', { k: 'observed', fs: fs.map((f) => f.props) }); }
    catch (e) { noteError(`weather now: ${(e as Error).message}`); }
  };
  const weathers = [...Object.entries(WEATHERS).map(([key, x]) => ({ key, label: x.label })), { key: 'observed', label: 'Observed now' }];
  const setWeather = (k: string) => { if (k === 'observed') { void observed(); if (!TWIN) $('#env-w').textContent = ' · observed now'; return; } skyL.feed(null); skyL.setWeather(k); log('weather', { k }); if (!TWIN) $('#env-w').textContent = ` · ${WEATHERS[k]!.label}`; };
  const weatherNow = () => (skyL.weatherName === 'feed' ? 'observed' : skyL.weatherName);
  // (the twin dashboard: its own dialog, and the chip shows the season and the weather)
  const env = TWIN ? twinEnv(w, { zone: 'Australia/Melbourne', weathers, setWeather, weatherNow, close: () => $('#d-env').classList.remove('open') }) : envDialog(w, { weathers, setWeather, weatherNow });
  if (TWIN) skyChip(w, () => weathers.find((x) => x.key === weatherNow())?.label ?? '');
  else $('#env-w').textContent = ` · ${WEATHERS[skyL.weatherName]?.label ?? ''}`;
  $('#env').onclick = () => { const d = $('#d-env'); d.classList.toggle('open'); if (d.classList.contains('open')) env(); };
  setInterval(() => { if ($('#d-env').classList.contains('open')) env(); }, 1000);
  let shadowsOn = q.get('shadows') !== '0';
  layersDialog(w, street, (v) => street.setView((k) => v.show(k) && streetKinds(k)), `<div class="qs" style="margin-top:6px"><button id="t-shadows" class="${shadowsOn ? 'on' : ''}">sun shadows</button> <button id="t-sat" class="${w.state.user.toggles.satellite ? 'on' : ''}">satellite</button></div><div class="qs t-quality" style="margin-top:6px">quality: ${['auto', 'lite', 'realistic'].map((v) => `<a href="${qLink(v)}"><button class="${v === qNow ? 'on' : ''}">${v === 'auto' ? `auto (${w.telemetry().quality.auto ?? '–'})` : v}</button></a>`).join(' ')}</div>`);
  $('#layers-pane').addEventListener('click', (e) => { if ((e.target as HTMLElement).id === 't-sat') { w.toggle('satellite'); (e.target as HTMLElement).classList.toggle('on', !!w.state.user.toggles.satellite); return; } if ((e.target as HTMLElement).id === 't-shadows') { shadowsOn = !shadowsOn; w.setShadows(shadowsOn); (e.target as HTMLElement).classList.toggle('on', shadowsOn); } });
  $('#walk').onclick = () => void toStreet();
  // park access: an analysis view on the street level
  const box = $('#access');
  // the place's walking graph and its parks: worked out once, off the page (park-access.ts)
  const access = new ParkAccess(w, street, (st) => { box.innerHTML = accessPanel(st, access.mode, access.flow); }, (analysisTheme ?? theme.dark({ ramp: ACCESS_RAMP })).ramp, { walk: `${ROADS}/walk.json`, parks: `${ROADS}.parks.geojson`, look: TWIN ? 'twin' : 'plain' });
  w.add(...access.layers);
  accessOn = () => access.enabled;
  // its look: the analysis view while it is on (the page's own theme stays when it is off)
  // (one call each: the panel is written by the analysis as it answers; a tap works nothing out again)
  const setAccess = (on: boolean) => { w.setTheme(on ? analysisTheme : pageTheme); box.style.display = on ? 'block' : 'none'; box.innerHTML = accessPanel(null, access.mode, access.flow); access.setEnabled(on); $('#t-access')?.classList.toggle('on', on); $('#b-access')?.classList.toggle('on', on); if (TWIN) show(); log('access-on', { on }); };
  box.addEventListener('click', (e) => { const el = e.target as HTMLElement; if (el.dataset.fold) { box.classList.toggle('folded'); return; } if (el.dataset.flow) { access.setFlow(!access.flow); el.classList.toggle('on', access.flow); log('access-flow', { on: access.flow }); return; } const m = el.dataset.am as 'roads' | 'straight' | undefined; if (m) { box.innerHTML = accessPanel(null, m, access.flow); access.setMode(m); } });
  if (TWIN) {
    // the bar's own buttons: home (the region), park access, settings (the layers and the rendering)
    $('#b-home').onclick = () => void drillRegion();
    $('#b-access').onclick = () => setAccess(!access.enabled);
    $('#b-settings').onclick = () => $('#d-layers').classList.toggle('open');
  }
  $('#layers-pane').insertAdjacentHTML('beforeend', '<div class="qs"><button id="t-access">park access</button></div>');
  $('#layers-pane').addEventListener('click', (e) => { if ((e.target as HTMLElement).id === 't-access') setAccess(!access.enabled); });
  if (preset.access) { access.mode = preset.access; if (preset.flow) access.setFlow(true); setAccess(true); }
  // heat on the street: the model on the tiles round the camera
  const hbox = $('#heat');
  const heat = new HeatView(w, street, () => { hbox.innerHTML = heatPanel(heat); });
  const setHeat = async (on: boolean) => { hbox.style.display = on ? 'block' : 'none'; $('#t-heat')?.classList.toggle('on', on); log('heat-on', { on }); await heat.setEnabled(on); };
  hbox.addEventListener('click', (e) => {
    const el = e.target as HTMLElement;
    if (el.dataset.fold) { hbox.classList.toggle('folded'); return; }
    if (el.dataset.hd) void heat.setDate(el.dataset.hd);
    if (el.dataset.hm) void heat.setMetric(el.dataset.hm as never);
    if (el.dataset.hc) { const k = el.dataset.hc as 'streetTrees' | 'coolRoads' | 'wateredGrass', c = { ...heat.changes, [k]: !heat.changes[k] }; void heat.setChanges(c, !!(c.streetTrees || c.coolRoads || c.wateredGrass)); }
    if (el.id === 'h-impact') void heat.measureImpacts();
  });
  hbox.addEventListener('change', (e) => { const el = e.target as HTMLInputElement; if (el.id === 'h-hour') void heat.setHour(Number(el.value)); if (el.dataset.ho) void heat.setOption(el.dataset.ho as never, el.checked as never); });
  $('#layers-pane').insertAdjacentHTML('beforeend', '<div class="qs"><button id="t-heat">heat on the street</button></div>');
  $('#layers-pane').addEventListener('click', (e) => { if ((e.target as HTMLElement).id === 't-heat') void setHeat(!heat.enabled); });
  w.on('tap', (f, at) => { if (!heat.enabled || at.lon === null || at.lat === null) return; const lon = f?.at ? f.at[0] : at.lon, lat = f?.at ? f.at[1] : at.lat, x = heat.probe(lon, lat!); const card = $('#card'); if (x) { card.innerHTML = `<button class="x" title="close">✕</button>${probeCard(x)}`; card.style.display = 'block'; (card.querySelector('.x') as HTMLElement).onclick = () => { card.style.display = 'none'; }; } });
  // storm water: a shallow-water field over the ground round the camera, rain from the sky
  const fbox = $('#flood');
  const flood = new FloodView(w, street, () => { fbox.innerHTML = floodPanel(flood); });
  const setFlood = (on: boolean) => { fbox.style.display = on ? 'block' : 'none'; $('#t-flood')?.classList.toggle('on', on); log('flood-on', { on }); flood.setEnabled(on); };
  fbox.addEventListener('click', (e) => { const el = e.target as HTMLElement; if (el.dataset.fold) fbox.classList.toggle('folded'); if (el.dataset.fc) flood.setCompare(!flood.comparing); });
  $('#layers-pane').insertAdjacentHTML('beforeend', '<div class="qs"><button id="t-flood">storm water</button></div>');
  $('#layers-pane').addEventListener('click', (e) => { if ((e.target as HTMLElement).id === 't-flood') setFlood(!flood.enabled); });
  if (preset.flood) { const once = () => { if (street.tiles().length >= 6 && Number.isFinite(w.heightAt(w.camera.lon, w.camera.lat))) setFlood(true); else setTimeout(once, 500); }; once(); }
  // walk, drive, fly: an avatar on the street level, the camera behind it
  const HELP: Record<string, string> = { map: 'drag to move · two fingers to turn and tilt · scroll to zoom', walk: 'W A S D or the stick · Shift run · Space jump · F get into a car · V eyes / behind · drag to look · Esc map', car: 'W throttle · S brake · A D steer · Shift boost · F get out · V eyes / behind · Esc map', drone: 'W A S D or the stick · E / ▲ up · Q / ▼ down · Shift fast · Esc map' };
  // what stops a walker or a car, and pulls the camera in: the world's own solids (the street level's buildings)
  const obstacle = collision(w, { radius: 0.3 });
  /** the middle of the nearest street of what is built (a local one: classes 2–5), and the way it runs */
  const nearestStreet = (at: [number, number]) => {
    let best: { d: number; at: [number, number]; heading: number } | null = null;
    for (const b of street.built()) for (const r of b.extra?.roads ?? []) { if (r.cls < 2 || r.cls > 5) continue; for (let i = 0; i + 1 < r.pts.length; i++) { const a = b.ctx.lonLat(r.pts[i]![0], r.pts[i]![1]), c = b.ctx.lonLat(r.pts[i + 1]![0], r.pts[i + 1]![1]), m: [number, number] = [(a[0] + c[0]) / 2, (a[1] + c[1]) / 2], d = Math.hypot((m[0] - at[0]) * 88000, (m[1] - at[1]) * 110574); if (!best || d < best.d) best = { d, at: m, heading: Math.atan2((c[0] - a[0]) * 88000, (c[1] - a[1]) * 110574) }; } }
    return best;
  };
  const av = avatars(w, {
    // start on the nearest street of what is built, facing along it
    start: (at) => nearestStreet(at),
    obstacle,
    shapes: AVATAR_SHAPES,
    // the neighbourhood's cars: walk up to one and press F (or ⇄) to drive it; again to get out and leave it parked
    vehicles: { near: () => cars.cars.map((c) => ({ id: c.id, at: [c.at[0], c.at[1]] as [number, number], heading: c.heading, made: c.shape as Made })), onEnter: (id) => cars.take(id), onExit: (v) => cars.park(v) },
    onMode: (m) => { document.querySelectorAll<HTMLButtonElement>('#modes [data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m)); $('#mode-help').textContent = HELP[m]!; log('mode', { m }); },
  });
  w.add(av.element);
  // people: the person you walk as (a ready-made one: &person=<name>, 'walker' for the plain shape), and a light crowd
  // on the footpaths round the camera at the street level (&people=0 off, &people=N how many)
  const coarse = matchMedia('(pointer: coarse)').matches;
  const people = streetPeople(w, { walkUrl: `${ROADS}/walk.json`, count: q.get('people') !== null ? Number(q.get('people')) : preset.deterministic ? 0 : coarse ? 16 : 28, radius: q.get('radius') ? Number(q.get('radius')) : undefined, around: () => [w.camera.lon, w.camera.lat], shown: () => streetNear });
  if (people.crowd) w.add(people.crowd.element);
  let crowdOn = false;
  const startCrowd = () => { if (crowdOn || !people.crowd) return; crowdOn = true; void people.crowd.start().then(() => log('people-ready', people.crowd!.figures())); };
  const personPick = document.createElement('select'); personPick.id = 'person'; personPick.title = 'who you walk as';
  personPick.innerHTML = [...people.names, 'walker'].map((n) => `<option value="${n}">${n === 'walker' ? 'plain walker' : n.replace(/-/g, ' ')}</option>`).join('');
  personPick.value = q.get('person') ?? people.names[0]!;
  $('#modes .bar').insertBefore(personPick, $('#kmh'));
  const walkAs = async (name: string) => { const b = await people.avatar(name === 'walker' ? null : name); av.setBody(b); log('person', { name, body: !!b }); };
  personPick.onchange = () => void walkAs(personPick.value);
  void walkAs(personPick.value);
  // a few cars of the neighbourhood driving its streets (entities with a script's drive; the example's own car shape)
  let driveNet: { key: string; net: ReturnType<typeof network<{ cls: number }>> | null } = { key: '', net: null };
  const roadsNet = () => {
    const built = street.built(), key = built.map((b) => b.key).sort().join(',');
    if (key !== driveNet.key) {
      const lines: { line: [number, number][]; props: { cls: number } }[] = [];
      for (const b of built) for (const r of b.extra?.roads ?? []) if (r.cls >= 2 && r.cls <= 5) lines.push({ line: r.pts.map(([x, z]) => b.ctx.lonLat(x, z)), props: { cls: r.cls } });
      driveNet = { key, net: lines.length ? network({ lines, snap: 1.5 }) : null };
    }
    return driveNet.net;
  };
  // (they keep to the roads: no buildings to ask about; the obstacle raster is the avatar's, round it)
  const cars = traffic(w, { count: 8, network: roadsNet, centre: () => [w.camera.lon, w.camera.lat] });
  w.add(cars.layer);
  const setTraffic = (on: boolean) => { if (on) cars.place(); else cars.clear(); $('#t-traffic')?.classList.toggle('on', on); w.invalidate(); };
  $('#layers-pane').insertAdjacentHTML('beforeend', '<div class="qs"><button id="t-traffic">cars on the streets</button></div>');
  $('#layers-pane').addEventListener('click', (e) => { if ((e.target as HTMLElement).id === 't-traffic') setTraffic(!cars.cars.length); });
  if (preset.traffic) { const go3 = () => { if (street.built().length >= 4 && roadsNet()) setTraffic(true); else setTimeout(go3, 400); }; go3(); }
  $('#mode-help').textContent = HELP.map!;
  if (TWIN) cameraPad(w, () => av.mode === 'map');
  document.querySelectorAll<HTMLButtonElement>('#modes [data-mode]').forEach((b) => { b.onclick = () => av.setMode(b.dataset.mode as never); });
  // (written only when it changed: a still page does no layout for it)
  setInterval(() => { const d = streetNear || av.mode !== 'map' ? 'flex' : 'none', k = av.mode === 'map' ? '' : `${Math.round(av.kmh)} km/h`; if ($('#modes').style.display !== d) $('#modes').style.display = d; if ($('#kmh').textContent !== k) $('#kmh').textContent = k; }, 250);
  if (preset.lineup) { const lu = preset.lineup, go4 = () => { const st = street.built().length >= 4 ? nearestStreet([preset.view.lon, preset.view.lat]) : null; if (st) void lineup(w, people.template, { ...lu, at: st.at, bearing: (st.heading * 180) / Math.PI, doing: { girl: 'wave', father: 'greet', student: 'phone', runner: 'run', 'teen-girl': 'walk', 'office-worker': 'walk' } }); else setTimeout(go4, 400); }; go4(); }
  if (preset.showcase) { const go5 = () => { const st = street.built().length >= 4 ? nearestStreet([preset.view.lon, preset.view.lat]) : null; if (!st) { setTimeout(go5, 400); return; } const h = (st.heading * 180) / Math.PI;
    if (preset.showcase === 'materials') { const m = materialsAvenue(st.at, h, procImagery()); w.add(m.layer); lookAlong(w, st.at, h, { back: 2, up: 6, tilt: 72 }); log('showcase', { what: 'materials', names: m.names }); }
    else if (preset.showcase === 'vehicles' || preset.showcase === 'vehicles-close') { const v = vehicleAvenue(st.at, h); w.add(...v.layers); if (preset.showcase === 'vehicles') lookAlong(w, st.at, h, { back: 4, up: 9, tilt: 68 }); else lookAcross(w, st.at, h, 46, { off: -30, up: 3.5, tilt: 84 }); log('showcase', { what: preset.showcase, names: v.names }); }
    else { const sp = speciesAvenue(st.at, h); w.add(sp.layer); lookAlong(w, st.at, h); log('showcase', { what: preset.showcase, names: sp.names }); } }; go5(); }
  if (preset.mode) { const go2 = () => { if (street.built().length >= 4) av.setMode(preset.mode!); else setTimeout(go2, 400); }; go2(); }
  if (preset.heat) { const once = () => { if (street.tiles().length >= 4) void setHeat(true); else setTimeout(once, 500); }; once(); }
  // the statistics give way to the street level (and come back at the district level): the observation level, past
  // its margin and after its dwell (never the camera's zoom frame by frame)
  const onLevel = () => { const near = (w.levels?.findIndex((r) => r.name === w.level) ?? -1) >= 5; if (near !== streetNear) { streetNear = near; show(); } if (near) startCrowd(); };
  w.on('level', onLevel); onLevel();
  // the stats rows changed (a load, a new question): the open dialog follows
  statC.watch(() => { if ($('#d-stats').classList.contains('open')) statsDialog(); });
  statS.watch(() => { if ($('#d-stats').classList.contains('open')) statsDialog(); });
  // a preset that starts deeper: wait for the shapes, then go there (the camera moves only because the link asks)
  if (preset.council) {
    const ctx = { loader: w.loader, error: (e: unknown) => noteError(String((e as Error)?.message ?? e)) };
    await Promise.all([councils.start(ctx), suburbs.start(ctx)]);
    const c = councils.features().find((f) => f.props.name === preset.council);
    const s = preset.suburb ? suburbs.features().find((f) => f.props.name === preset.suburb && f.props.lga === c?.id) : undefined;
    if (c) { level = { kind: 'council', f: c }; show(); w.go(w.viewToFit(c, { padding: 0.06, tilt: 30 })); }
    if (c && s) { level = { kind: 'suburb', f: s, council: c }; show(); w.select([String(s.id)]); w.go(w.viewToFit(s, { padding: 0.04, tilt: 55, bearing: 340 })); }
  }
  // (the twin dashboard: the loading line goes once the councils are in and drawn, or the street level is)
  if (TWIN) { const done = () => { if ((councils.features().length && w.report().frames > 2) || street.built().length) loaded(); else setTimeout(done, 300); }; done(); setTimeout(loaded, 20000); }
  const hint = $('#hint');
  hint.textContent = 'tap a council to go in';
  setTimeout(() => { hint.style.opacity = '0'; }, 5000);
  (window as unknown as { aslnutDemo: unknown }).aslnutDemo = { w, go, preset, errors, build: BUILD, log: LOG?.url ?? null, presets: Object.keys(PRESETS), sky: skyL, stats: { councils: statC, suburbs: statS }, street, av, heat, access, flood, cars, furn, people, lib: { controllers, field, rules, kernel, vegetation, trees: MELBOURNE_TREES, preview, house, tileLane, arc } };
}
void main();
export type { Source };
