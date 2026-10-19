import { presetOf } from '../preset.ts';
// fleet: many vehicles moving smoothly over the world, each with its trail, driven by data over time. An hour of a
// mock fleet driving the street place's OpenStreetMap roads (tools/fleet-data.mjs: never in git), its charge level
// colouring each one. The first scene (go=clayton): Esri imagery on Mapzen's terrain with the place's own ground grid,
// the roads the vehicles drive drawn as lines draped on it, the dots and their trails on the same ground; go=city:
// OpenStreetMap's tiles over the suburbs; &twin=1 the same fleet over the twin's street level (its roads, buildings and
// trees: the healthy-city example's street level, loaded the same way). The whole fleet is one set (core › entities ›
// sets) moved by its log (drive › data, core › data › history): its samples go to the chip once, the world's clock is
// a uniform, a seek is one change, a paused world draws nothing.
// go=charge: a day of 50 cars on a few blocks, on Esri's light grey map: their homes (a garage, a driveway, a wall
// charger), offices (a car park, a row of chargers) and charging stations (core › … › mobility › charger), each placed
// at a point of a scenario file with its layout in its own frame (tools/fleet-data.mjs charge: never in git). Each car
// a bar over it showing its battery and its per cent ('72%': drawn on the chip), each charger's bay lit green (free)
// or blue (a car charging there) from the ports' logs; a tap tells a car's habit and state, a building's chargers in
// use and its cars. It starts at 12:30 (cars charging at home, at work and at the stations); &car=preset (aslnut's car)
// | model (a CC0 glTF model loaded by URL, kept with the data); &houses=kit (CC0 city kits' models by URL, given the
// places' traits: the default) | neutral (aslnut's neutral presets: white to grey) | built (aslnut's buildings from a
// footprint and its tags) | raised (this example's own house: raised on posts under a steep roof of its own shape):
// every design carries its kind's traits (core › entities › identity › kind), and the cars park at the parking, the
// chargers stand at the service points, whichever is drawn; &base=esri-light (default) | osm-light (OpenStreetMap's
// tiles greyed by a light theme) | plain (a light ground, only the roads drawn). Its other traffic passes through (grey:
// not the scenario's cars), routed as the scenario's cars are (one-way streets their way). Each car near the camera has
// a soft shadow under it. It opens a little way up over an office and a station, playing at 4× (&play=0: paused).
// Each place with chargers has a card over it (kits › dashboard › markers): its picture and name, its chargers in use
// ('2/4' and a bar, from the ports' logs), the power they draw, the cars plugged in there (their mean battery), its
// colour by its chargers' share in use, and a badge:
// the cars plugged in there; a car plugged in folds into its place's card while it charges (core › data › history:
// relations; core › entities › sets: fold), &fold=0 keeps them, &cards=0 none. &icons=1: each car far away an icon
// of its own (core › encoding › marks › symbols › icon), turned along its path, painted as the car
// go=drones: N of aslnut's quadcopters (the preset's shape, its rotors spinning) flying loops of their own over the suburb,
// each from its pad and back (this example's flights: drones.ts), over the place's ground (plain; &base=esri: imagery):
// each sample's height in their log (its altitude, over the ground), each banked into its turns, its shadow on the
// ground under it shrinking and fading as it climbs (gone by 60 m up); &air=0: the same drones on the ground
//   ?go=clayton | charge | city | street | close | drones | parity | parity-close (the checks': no network)   &n=500 | 2000 | 10000   &twin=1
//   &cards=0   &fold=0   &icons=1   &bench=cards (the cards' measure: 400 cards on still places round the view and 100 on
//   moving vehicles, the first 100 of the log, as a set of their own; collision on)
//   &trail=60 (s)   &speed=4   &t=20 (minutes in)
//   &play=1   &graphics=auto | webgpu | webgl2   &dpr=1   &clock=30 (a fixed step: the tools)   &log=0   &panel=0   &defer=1
import { AslnutError, GraphicsUnavailable, HOUSE, area, asKind, bakedRoads, buildings, cards, chargers, data, drive, earth, entities, history, icon, icons, imagery, kinds, line, num, ramp, replay, shape, shapes, streets, supported, terrain, theme, traits, typology, world, type Feature, type HouseLook, type Made, type Playback, type Held, type ShapeAnchor, type SolidPicked, type Thing, type V3, type View, type World } from '../../src/index.ts';
import { cars } from '../../src/modules/presets/vehicles/index.ts';
import { drones } from '../../src/modules/presets/drones/index.ts';
import { droneFlights, DRONE_SPAN } from './drones.ts';
import { ROADS, STREET_TILES, LOOK, streetGround, streetWorkers } from '../healthy-city/street-level.ts';

declare const __BUILD__: number;
const BUILD = typeof __BUILD__ === 'number' ? __BUILD__ : 0;
const q = new URLSearchParams(location.search);
const N = [500, 2000, 10000].includes(Number(q.get('n'))) ? Number(q.get('n')) : 2000;
const want = (q.get('graphics') ?? 'auto') as 'auto' | 'webgpu' | 'webgl2';
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const errors: string[] = [];
const noteError = (m: string) => { errors.push(m); if (errors.length > 20) errors.shift(); };
addEventListener('error', (e) => noteError(String(e.message)));
addEventListener('unhandledrejection', (e) => noteError(String((e.reason as Error)?.message ?? e.reason)));

// the views: the suburb from above (the city), a street of the twin, a busy road close (the cars themselves)
const VIEWS: Record<string, View> = {
  clayton: { lon: 145.1215, lat: -37.9232, zoom: 15.3, tilt: 50, bearing: 0 },
  charge: { lon: 145.1197, lat: -37.9250, zoom: 20.9, tilt: 60, bearing: 0 },
  city: { lon: 145.128, lat: -37.922, zoom: 14.2, tilt: 45, bearing: 15 },
  street: { lon: 145.1205, lat: -37.9245, zoom: 17.6, tilt: 66, bearing: 330 },
  close: { lon: 145.1209, lat: -37.9242, zoom: 20.4, tilt: 70, bearing: 330 },
  drones: { lon: 145.1215, lat: -37.9232, zoom: 16.4, tilt: 62, bearing: 20 },
};
// the checks' views (no network: a plain ground; the twin's own ground and packs): the parity tool and smoke-fleet
const CHECKS: Record<string, { view: View; twin: boolean; charge?: boolean }> = {
  parity: { view: { lon: 145.1215, lat: -37.9235, zoom: 15.6, tilt: 40, bearing: 0 }, twin: false },
  'parity-close': { view: VIEWS.close!, twin: true },
  'parity-charge': { view: VIEWS.charge!, twin: false, charge: true },
};
const go = presetOf(q, [...Object.keys(VIEWS), ...Object.keys(CHECKS)], q.get('twin') === '1' ? 'street' : 'clayton'), check = CHECKS[go] ?? null;
const TWIN = check ? check.twin : q.get('twin') === '1';
/** the first scene: Esri's imagery on the place's ground, the roads drawn as lines (the twin draws its own roads) */
const CHARGE = (!check && !TWIN && go === 'charge') || !!check?.charge, CLAYTON = !check && !TWIN && (go === 'clayton' || CHARGE);
/** the drones scene: N of aslnut's drones flying their own loops over the suburb (this example's flights: drones.ts) */
const DRONES = !check && !TWIN && go === 'drones', AIR = DRONES && q.get('air') !== '0';
const FLEET = '/aslnut/data/packs/fleet';

// ── this example's own house (not a preset of aslnut's: an app's design, made with its tools): raised on posts, under a
// steep roof of its own shape (a tall gable with deep eaves, a flared skirt and horned ridge ends), its walls a warm
// render; a house look (buildings' house: walls, windows, a door to its street, steps up to it) with its own roof ──
/** a triangle facing away from a point inside the roof */
const away = (a: V3, b: V3, c: V3, inside: V3): V3[] => { const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])], m = [(a[0] + b[0] + c[0]) / 3 - inside[0], (a[1] + b[1] + c[1]) / 3 - inside[1], (a[2] + b[2] + c[2]) / 3 - inside[2]]; return n[0]! * m[0]! + n[1]! * m[1]! + n[2]! * m[2]! >= 0 ? [a, b, c] : [a, c, b]; };
const steepRoof = shape({
  id: 'steep-roof',
  params: { width: num(1, 80, 10), depth: num(1, 80, 8), height: num(0.3, 30, 5) },
  build: (b, p) => {
    const A = p.width / 2 + 0.5, B = p.depth / 2, H = p.height, skirt = 0.8, drop = 0.35, mid: V3 = [0, H * 0.3, 0];
    const quad = (a: V3, b2: V3, c: V3, d: V3, inside = mid) => [...away(a, b2, c, inside), ...away(a, c, d, inside)];
    // its two steep slopes up to the ridge, a flared skirt below each (gentler: rain thrown clear of the walls)
    const slopes: V3[] = [], ends: V3[] = [], trim: V3[] = [];
    for (const s of [-1, 1]) {
      slopes.push(...quad([-A, 0, s * B], [A, 0, s * B], [A, H, 0], [-A, H, 0]));
      slopes.push(...quad([-A, 0, s * B], [A, 0, s * B], [A, -drop, s * (B + skirt)], [-A, -drop, s * (B + skirt)], [0, 0.6, 0]));
      // the gable ends (in the walls' timber), set in a little, with a dark vent under the ridge
      const x = s * (A - 0.35);
      ends.push(...away([x, 0, -B], [x, 0, B], [x, H * 0.97, 0], [0, H * 0.3, 0]));
      trim.push(...away([x + s * 0.02, H * 0.55, -0.35], [x + s * 0.02, H * 0.55, 0.35], [x + s * 0.02, H * 0.8, 0], [0, H * 0.3, 0]));
      // a horn at each end of the ridge: the ridge carried past the gable, rising
      const r = s * A;
      trim.push(...away([r, H - 0.12, -0.12], [r, H - 0.12, 0.12], [r + s * 0.7, H + 0.55, 0], [r - s, H - 0.5, 0]));
      trim.push(...away([r, H + 0.08, -0.12], [r, H + 0.08, 0.12], [r + s * 0.7, H + 0.55, 0], [r - s, H + 2, 0]));
    }
    b.mesh(slopes, { color: '#4d3b2f' });
    b.mesh(ends, { color: '#8a6a4e' });
    b.mesh(trim, { color: '#2b211b', detail: 1 });
    // the ridge beam
    b.solid('box', { size: [2 * A, 0.18, 0.24], at: [0, H + 0.02, 0], color: '#2b211b' });
  },
});
/** the raised house's look: the house's own (its plan, windows, door), on posts 1.9 m up, under the steep roof */
const RAISED: HouseLook = {
  ...HOUSE, roof: steepRoof, raise: 1.9, roofPitch: 50, pitchVary: 3, forms: { gable: 1 }, minEave: 2.6,
  lean: { ...HOUSE.lean, chance: 0 }, chimneyChance: 0, eaves: 0.3,
  walls: { '#efe6d2': 2, '#e6d8bd': 1 }, windowColor: '#2f2a24', doorColor: '#5a3f2b', soffit: '#6b5440',
  posts: { color: '#5e4a38', floor: '#8a7158', size: 0.24, spacing: 2.2 },
};
/** a place's traits (its frame: x across its front, z to its road): where one goes in, cars stand, chargers go */
interface PlaceTraits { entries: ShapeAnchor[]; parking: ShapeAnchor[]; service: ShapeAnchor[] }
/** each place's, read from the design drawn; and what its kind's check says of it */
const traitsOf = new Map<string, PlaceTraits>(), traitProblems: string[] = [];

// ── the charge scene's scenario: the buildings placed at points, each one's layout in its own frame (metres: x across
// its front, z towards its road; its front faces `heading`, degrees clockwise from north, as a shape's) ──
interface Place { id: string; properties: Record<string, any>; geometry: { coordinates: [number, number] } }   // eslint-disable-line @typescript-eslint/no-explicit-any
const scenario: Place[] = CHARGE ? ((await fetch(`${FLEET}/charge-scenario.geojson`).then((r) => r.json())) as { features: Place[] }).features : [];
const KZ = 110574, RAD = Math.PI / 180;
/** a place in a building's frame → [lon, lat] (a building placed at a point: its footprint, its lot, its charger) */
const frameOf = (f: Place) => {
  const [lon0, lat0] = f.geometry.coordinates, h = Number(f.properties.heading) * RAD, c = Math.cos(h), sn = Math.sin(h), kx = 111320 * Math.cos(lat0 * RAD);
  return (lx: number, lz: number): [number, number] => [lon0 + (-lx * c + lz * sn) / kx, lat0 + (lx * sn + lz * c) / KZ];
};
/** a rectangle [x, z, width, depth] of a building's frame as a ring */
const rectOf = (f: Place, r: number[]) => { const at = frameOf(f), [x, z, w, d] = r as [number, number, number, number]; const ring = [at(x - w / 2, z - d / 2), at(x + w / 2, z - d / 2), at(x + w / 2, z + d / 2), at(x - w / 2, z + d / 2)]; return [[...ring, ring[0]!]]; };
/** a place's traits as the scenario gives them ([x, z, heading] in its frame): anchors */
const asTraits = (f: Place): PlaceTraits => { const t = (f.properties.traits ?? {}) as Record<'entries' | 'parking' | 'service', [number, number, number][]>, kind = (k: string) => (k === 'entries' ? 'entry' : k);
  return Object.fromEntries((['entries', 'parking', 'service'] as const).map((k) => [k, (t[k] ?? []).map(([x, z, h], i) => ({ name: `${kind(k)}-${i + 1}`, at: [x, 0, z] as [number, number, number], kind: kind(k), heading: h }))])) as unknown as PlaceTraits; };
/** where to look at a building from: its road, facing its front */
const viewOf = (f: Place, o: { zoom?: number; tilt?: number; side?: number; ahead?: number; turn?: number } = {}): View => {
  const k = f.properties.kind, [lon, lat] = frameOf(f)(o.side ?? (k === 'office' ? -4 : 0), o.ahead ?? (k === 'office' ? 9 : k === 'house' ? 5 : 3));
  return { lon, lat, zoom: o.zoom ?? (k === 'office' ? 21.6 : k === 'charger' ? 22.3 : 21.9), tilt: o.tilt ?? (k === 'charger' ? 64 : 56), bearing: (Number(f.properties.heading) + 180 + (o.turn ?? -35) + 360) % 360 };
};
/** the start: an office and the station nearest it (the pair nearest each other), the houses round them, seen from
 *  the station's side a little way up (cars driving between them); the checks: that office's car park close up */
const ofKind = (k: string) => scenario.filter((f) => f.properties.kind === k), ll = (f: Place) => f.geometry.coordinates;
const metres = (a: [number, number], b: [number, number]) => Math.hypot((a[0] - b[0]) * 111320 * Math.cos(a[1] * RAD), (a[1] - b[1]) * KZ);
const pair = ofKind('office').flatMap((o) => ofKind('charger').map((st) => ({ o, st, d: metres(ll(o), ll(st)) }))).sort((a, b) => a.d - b.d)[0];
if (pair) {
  const [a, b] = [ll(pair.st), ll(pair.o)], dx = (b[0] - a[0]) * Math.cos(a[1] * RAD), dy = b[1] - a[1];
  VIEWS.charge = { lon: (a[0] + b[0]) / 2, lat: (a[1] + b[1]) / 2, zoom: 19, tilt: 58, bearing: ((Math.atan2(dx, dy) / RAD) + 360) % 360 };
  CHECKS['parity-charge']!.view = viewOf(pair.o);
}
const view = check?.view ?? VIEWS[go] ?? VIEWS.clayton!;
/** the road classes the vehicles were routed on (tools/fleet-data.mjs): the lines drawn are the same ones */
const ROUTED = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street']);
const MAJOR = new Set(['motorway', 'trunk', 'primary', 'secondary']);
/** a plain ground: no network, the same on every run */
const plain = () => imagery.custom({ id: 'plain', attribution: '', draw: (g) => { g.fillStyle = '#d6dad2'; g.fillRect(0, 0, 256, 256); return true; } });
// the log's span: an hour from 08:00 in Melbourne; the charge scene's day from 00:00, starting at 12:30
const FROM = CHARGE ? Date.UTC(2026, 9, 14, 13, 0, 0) : Date.UTC(2026, 9, 14, 21, 0, 0), SPAN = CHARGE ? 24 * 3600e3 : DRONES ? DRONE_SPAN : 3600e3;
// (the charge scene: from 12:05, the lunchtime trips under way; its checks at 12:30)
const T_START = Number(q.get('t') ?? (CHARGE ? (check ? 750 : 725) : DRONES ? 1 : 20));
/** the charge scene's map: Esri's light grey (default), OpenStreetMap's tiles greyed by a light theme, or a plain light
 *  ground (only the roads drawn) */
const BASE = q.get('base') === 'osm-light' ? 'osm-light' : q.get('base') === 'plain' ? 'plain' : 'esri-light';
const lightGround = () => imagery.custom({ id: 'plain-light', attribution: '', draw: (g) => { g.fillStyle = '#eceee9'; g.fillRect(0, 0, 256, 256); return true; } });

/** the place's own ground grid without the twin's clamp to its baked roads (no baked roads drawn here: the clamp's grid,
 *  2.7 million heights, would be ~37 MB of the heap for nothing) */
const placeGround = () => terrain.grid({ url: `${ROADS}.ground`, blend: 60, attribution: 'Terrain: Mapzen terrain tiles (AWS Open Data), buildings taken out' });
let w: World;
// the twin's one lane: its ground under the roads, its roads and its street tiles made there
const lane = TWIN && q.get('workers') !== '0' ? streetWorkers() : undefined;
const canvas = $<HTMLCanvasElement>('#view');
const sup = await supported();
try {
  w = await world(canvas, {
    // a twin: looked at by levels (its street parts from the street level)
    observation: { levels: 'default' },
    // the first scene: Esri's imagery on Mapzen's terrain with the place's own ground grid (as the roads example);
    // else OpenStreetMap's tiles on Mapzen's terrain (the twin: its street place's ground under its roads)
    body: check ? earth({ imagery: [plain()], terrain: TWIN ? [streetGround(lane)] : [], sky: false })
      : CHARGE ? earth({ imagery: [BASE === 'osm-light' ? imagery.osm() : BASE === 'plain' ? lightGround() : imagery.esri({ layer: 'light' })], terrain: [terrain.mapzen(), placeGround()] })
      : CLAYTON ? earth({ imagery: [imagery.esri()], terrain: [terrain.mapzen(), placeGround()] })
      // (the drones: over the place's own ground, a plain one unless &base=esri: no network, the same on every run)
      : DRONES ? earth({ imagery: [q.get('base') === 'esri' ? imagery.esri() : plain()], terrain: q.get('ground') === 'flat' ? [] : [placeGround()] })
      : earth({ imagery: [imagery.osm()], terrain: [terrain.mapzen(), ...(TWIN ? [streetGround(lane)] : [])] }),
    // (OpenStreetMap's tiles greyed: everything the scene draws keeps its colours)
    ...(CHARGE && !check && BASE === 'osm-light' ? { theme: theme.light({ subjects: ['roads', 'lots', 'buildings', 'chargers', 'lights-wall', 'lights-station', 'fleet', 'traffic'] }) } : {}),
    view, graphics: want,
    clock: q.get('clock') === 'manual' ? 'manual' : q.get('clock') ? { fps: Number(q.get('clock')) } : 'real',
    time: new Date(FROM + T_START * 60e3), timeZone: 'Australia/Melbourne',
    pixelRatio: q.get('dpr') ? Number(q.get('dpr')) : undefined,
    attribution: { format: (c) => `${c.slice(0, 3).join(' · ')} · build ${BUILD}` },
    onError: (e) => noteError(e instanceof AslnutError ? e.message : String((e as Error)?.message ?? e)),
  });
} catch (e) {
  const why = e instanceof GraphicsUnavailable ? `${e.message} · WebGPU here: ${sup.webgpu ? 'yes' : 'no'} · WebGL2 here: ${sup.webgl2 ? 'yes' : 'no'}` : String((e as Error).message);
  $('#panel').innerHTML = `<b>fleet · build ${BUILD}</b><div class="err">${esc(why)}</div>`;
  throw e;
}

// the twin's street level: the baked roads, and the tiles of plots, buildings and trees (built off the main thread)
if (TWIN) w.add(
  bakedRoads({ id: 'roads', url: `${ROADS}/index.json`, near: 3500, worker: lane, when: { level: { from: 'street' } } }),
  streets({ id: 'street', url: STREET_TILES, near: 3500, look: LOOK, worker: lane, when: { level: { from: 'street' } } }),
);

const AREA = scenario.length ? (() => { const xs = scenario.map((f) => f.geometry.coordinates[0]), ys = scenario.map((f) => f.geometry.coordinates[1]), pad = 1200 / KZ; return [Math.min(...xs) - pad * 1.3, Math.min(...ys) - pad, Math.max(...xs) + pad * 1.3, Math.max(...ys) + pad]; })() : null;
const near = (d: Feature) => !AREA || ((d.geometry as { coordinates: [number, number][] }).coordinates ?? []).some(([x, y]) => x > AREA[0]! && x < AREA[2]! && y > AREA[1]! && y < AREA[3]!);
// (the charge scene: only the ways round its blocks, 1.2 km out, kept: the street place's whole network held as a
// source is ~6 MB of the heap)
const ODBL = { attribution: '© OpenStreetMap contributors (ODbL)' };
const roadsData = CHARGE && AREA ? data.geojson({ type: 'FeatureCollection', features: ((await fetch(`${ROADS}.geojson`).then((r) => r.json())) as { features: { geometry: Feature['geometry'] }[] }).features.filter((f) => f.geometry?.type === 'LineString' && near(f as unknown as Feature)) } as never, ODBL) : null;
// the first scene's roads: the OpenStreetMap ways the vehicles drive, lines draped on the terrain (the main ones wider;
// on the light grey map, a darker grey)
if (CLAYTON) w.add(line({
  id: 'roads', data: roadsData ?? data.geojson(`${ROADS}.geojson`, ODBL),
  filter: (d: Feature) => d.geometry?.type === 'LineString' && ROUTED.has(String(d.props.highway)),
  width: (d: Feature) => (MAJOR.has(String(d.props.highway)) ? 2.6 : 1.4),
  color: (d: Feature) => (CHARGE ? (MAJOR.has(String(d.props.highway)) ? '#6b7480d9' : '#8d96a1b3') : MAJOR.has(String(d.props.highway)) ? '#fff6d8e6' : '#e8eef4b3'),
  pickable: false,
}));

// the fleet: its log loads once, its samples go to the chip as they are; a dot each far away, a car near the camera.
// The trail: 12 s behind each (100–200 m at 30–60 km/h: a short tail, not a line), fading from the head
// (the drones: their flights made here, a recorded track straight from its arrays)
// (their heights: a byte each over 0 … 160 m, 0.6 m a step)
const log = DRONES ? history.fromColumns(droneFlights(N, [VIEWS.drones!.lon, VIEWS.drones!.lat], { from: FROM }), { values: { charge: 'u8' }, ...(AIR ? { altitude: { over: 'ground' as const, type: 'u8' as const, domain: [0, 160] as [number, number] } } : {}) }) : history.log({ url: CHARGE ? `${FLEET}/charge-cars.hist` : `${FLEET}/street-1h-${N}.hist` });
const trailSec = Number(q.get('trail') ?? 12);
const fade = (q.get('fade') ?? 'ease') as 'linear' | 'ease';
// (on the light grey map: a deep blue trail behind each car)
const trailOf = (sec: number) => (sec > 0 ? { seconds: sec, width: 3, fade: Number(fade) || fade, ...(CHARGE ? { color: '#1e3a8a' } : {}) } : false as const);

// ── the charge scene's places: the buildings and their lots, the chargers (the preset, at each one's point, turned to
// its road), each charger's bays lit by its ports' logs (busy: green free, blue charging) ──
const portLogs = CHARGE ? { wall: history.log({ url: `${FLEET}/charge-ports-wall.hist` }), station: history.log({ url: `${FLEET}/charge-ports-station.hist` }) } : null;
const placeById = new Map(scenario.map((f) => [f.id, f]));
const KIND: Record<string, string> = { house: 'home', office: 'office', charger: 'charging station' };
/** the houses and offices, every design carrying its kind's traits (its entries, parking and service points: the
 *  scenario's): aslnut's neutral presets (neutral), a CC0 kit's models given the traits (kit: the default), aslnut's
 *  buildings from a footprint and its tags (built), or this example's own house: raised on posts under a steep roof
 *  (raised: buildings() with a house look of its own) */
const HOUSES = (['neutral', 'kit', 'built', 'raised'] as const).find((x) => x === q.get('houses')) ?? 'kit', KITS = '/aslnut/data/assets/buildings';
/** a place's chargers now: in use (a car charging) and free */
const portsAt = (f: Place) => {
  const lg = f.properties.kind === 'charger' ? portLogs!.station : portLogs!.wall, t = w.time.getTime(); let busy = 0;
  for (let k = 1; k <= Number(f.properties.charger.ports); k++) if ((lg.at(`${f.id}-p${k}`, t)?.values.busy ?? 0) > 0.5) busy++;
  return { busy, free: Number(f.properties.charger.ports) - busy };
};
/** the place a car stands at (its home, its office, a station: within 45 m), or null */
const placeAt = (lon: number, lat: number) => {
  let best: Place | null = null, bd = 45;
  for (const f of scenario) { const [x, y] = f.geometry.coordinates, d = Math.hypot((x - lon) * 111320 * Math.cos(y * RAD), (y - lat) * KZ); if (d < bd) { bd = d; best = f; } }
  return best;
};
const placeName = (f: Place | null) => (!f ? 'by the road' : f.properties.kind === 'house' ? (f.properties.cars as string[]).length ? `home (${f.id})` : f.id : f.properties.kind === 'office' ? `work (${f.id})` : `a station (${f.id})`);
/** what a tap on a building or a charger tells: its kind, its chargers in use and free, its cars (here or away, their
 *  battery) */
const placeTip = (id: string) => {
  const f = placeById.get(id); if (!f) return null;
  const pr = f.properties, p = portsAt(f), now = w.time.getTime() - (fleet?.drive.smooth ?? 0);
  const cars = ((pr.cars ?? []) as string[]).map((c) => { const st = log.at(c, now); if (!st) return c; const here = placeAt(st.lon, st.lat)?.id === f.id; return `${c} ${here ? 'here' : 'away'} ${Math.round((st.values.charge ?? 0) * 100)}%`; });
  const held = plugged.heldBy(id, now);
  return `${KIND[pr.kind] ?? pr.kind} · ${id}${pr.kind === 'office' ? ` · ${pr.levels} floors` : ''}\nchargers: ${p.busy} in use · ${p.free} free (${pr.charger.power} kW)${cars.length ? `\ncars: ${cars.join(' · ')}` : ''}${held.length ? `\nplugged in: ${held.join(' · ')}` : ''}`;
};
if (CHARGE) {
  const houses = scenario.filter((f) => f.properties.kind === 'house'), offices = scenario.filter((f) => f.properties.kind === 'office'), stations = scenario.filter((f) => f.properties.kind === 'charger');
  const poly = (id: string, f: Place, r: number[], props: Record<string, unknown>): Feature => ({ id, props: { of: f.id, ...props }, geometry: { type: 'Polygon', coordinates: rectOf(f, r) } });
  // the lots: driveways (concrete), car parks and forecourts (asphalt), a car park's spaces marked (white lines)
  const bays = offices.flatMap((f) => { const out: Feature[] = []; for (const z of [10.8, 22.7]) for (let j = 0; j <= 9; j++) out.push(poly(`${f.id}-line-${z}-${j}`, f, [(j - 4.5) * 2.7, z, 0.12, 5], { color: '#f4f5f2' })); return out; });
  w.add(area({
    id: 'lots', data: [
      ...houses.map((f) => poly(`${f.id}-driveway`, f, f.properties.driveway, { color: '#d3cec4' })),
      ...offices.map((f) => poly(`${f.id}-carpark`, f, f.properties.carpark, { color: '#5d6166' })),
      ...stations.map((f) => poly(`${f.id}-forecourt`, f, f.properties.forecourt, { color: '#55595e' })),
      ...bays,
    ],
    color: (d: Feature) => String(d.props.color), outline: 0, pickable: false, when: { level: { from: 'street' } },
  }));
  // the buildings, each design with its kind's traits: what stands at each place reads them (its cars park at its
  // parking, its chargers stand at its service points), so the designs serve the same scenario. A tap tells a
  // building's chargers and cars
  const kindOfPlace = (f: Place) => (f.properties.kind === 'office' ? kinds.office : kinds.house);
  const fromMade = (f: Place, m: Made) => { const t = traits(m, kindOfPlace(f)); traitsOf.set(f.id, { entries: t.entries as ShapeAnchor[], parking: t.parking as ShapeAnchor[], service: t.service as ShapeAnchor[] }); const c = kindOfPlace(f).check(m); if (!c.ok) traitProblems.push(...c.problems.map((x) => `${f.id}: ${x}`)); };
  if (HOUSES === 'neutral') {
    // aslnut's neutral presets (white to grey) at each place's params: their anchors are the traits
    const made = new Map([...houses, ...offices].map((f) => [f.id, f.properties.kind === 'office' ? typology.office.make(f.properties.preset) : typology.house.make(f.properties.preset)]));
    for (const f of [...houses, ...offices]) fromMade(f, made.get(f.id)!);
    w.add(entities({
      id: 'buildings', shape: { id: 'typology', make: (p?: { id?: string }) => made.get(p?.id ?? '')! },
      data: [...houses, ...offices].map((f) => ({ id: f.id, props: { id: f.id, kind: f.properties.kind, heading: f.properties.heading }, geometry: { type: 'Point', coordinates: f.geometry.coordinates } }) as Feature),
      params: (d: Feature) => ({ id: String(d.props.id) }), heading: (d: Feature) => Number(d.props.heading),
      tooltip: (d: SolidPicked) => placeTip(String(d.props.id ?? '')),
    }));
  } else if (HOUSES === 'kit') {
    // a CC0 kit's models by URL (Kenney's suburban and commercial city kits, kept with the data: never in git) at the
    // same points, turned to their roads: each imported as its kind (its entry from its own bounds: the middle of its
    // front), then given the place's parking and service points; a model each (its type and colours by its place in the
    // list), a house 8.5 m a kit unit, an office as wide as its footprint
    const SUB = `${KITS}/kenney-city-kit-suburban`, COM = `${KITS}/kenney-city-kit-commercial`, TEX = ['colormap', 'variation-a', 'variation-b', 'variation-c'];
    const HOUSE_TYPES = 'abcdefghijklmnopqrstu', OFFICE_TYPES = ['j', 'k', 'e', 'n'];
    const keyOf = (f: Place, k: number) => (f.properties.kind === 'house' ? `${SUB}/building-type-${HOUSE_TYPES[(k * 7) % HOUSE_TYPES.length]}.glb|${TEX[k % TEX.length]}` : `${COM}/building-${OFFICE_TYPES[k % OFFICE_TYPES.length]}.glb|colormap`);
    const placed = [...houses, ...offices].map((f, k) => ({ f, key: keyOf(f, f.properties.kind === 'house' ? k : k - houses.length) }));
    const made = new Map<string, Made>();
    // (an entry at the middle of its front: the adapter from its bounds; its doors elsewhere are the model's own)
    const entryAt = (m: Made) => ({ 'entry-1': { at: [(m.bounds[0][0] + m.bounds[1][0]) / 2, 0, m.bounds[1][2] + 0.8] as [number, number, number], kind: 'entry', heading: 180 } });
    await Promise.all([...new Set(placed.map((x) => x.key))].map(async (key) => {
      const [url, tex] = key.split('|') as [string, string], office = url.startsWith(COM);
      made.set(key, await shapes.import(url, { ...(office ? { length: 24 } : { scale: 8.5 }), paint: false, kind: office ? 'office' : 'house', anchors: entryAt, fetch: async (u) => (await fetch(u.replace('colormap.png', `${tex}.png`))).arrayBuffer() }));
    }));
    for (const { f, key } of placed) { const m = made.get(key)!, t = asTraits(f); fromMade(f, asKind(m, kindOfPlace(f), { anchors: [...(f.properties.kind === 'office' ? t.entries : m.anchors), ...t.parking, ...t.service], params: { levels: f.properties.levels } })); }
    w.add(entities({
      id: 'buildings', shape: { id: 'kit', make: (p?: { key?: string }) => made.get(p?.key ?? '')! },
      data: placed.map(({ f, key }) => ({ id: f.id, props: { id: f.id, kind: f.properties.kind, heading: f.properties.heading, key }, geometry: { type: 'Point', coordinates: f.geometry.coordinates } }) as Feature),
      params: (d: Feature) => ({ key: String(d.props.key) }), heading: (d: Feature) => Number(d.props.heading),
      tooltip: (d: SolidPicked) => placeTip(String(d.props.id ?? '')),
    }));
  } else {
    // aslnut's buildings from a footprint and its tags (a house with its door to its road and its roof by its tag, its
    // garage, an office block), or this example's own house (raised: on posts under a steep roof of its own shape);
    // the traits are the scenario's (buildings() draws from footprints: the places' own)
    for (const f of [...houses, ...offices]) { const t = asTraits(f); traitsOf.set(f.id, t); }
    const raised = HOUSES === 'raised';
    const homes = houses.map((f) => poly(f.id, f, [0, 0, ...(f.properties.size as number[])], { id: f.id, kind: 'house', building: 'house', 'roof:shape': f.properties.roof, height: raised ? (f.properties.levels > 1 ? 12.5 : 10) : f.properties.levels > 1 ? 8.6 : 5.4, front: f.properties.heading }));
    const others = [
      ...houses.map((f) => poly(`${f.id}-garage`, f, f.properties.garage, { id: f.id, kind: 'garage', building: 'garage', height: 2.8 })),
      ...offices.map((f) => poly(f.id, f, [0, 0, ...(f.properties.size as number[])], { id: f.id, kind: 'office', building: 'office', 'building:levels': f.properties.levels })),
    ];
    const tip = (d: SolidPicked) => placeTip(String(d.props.id ?? ''));
    const look = (d: Feature) => (d.props.kind === 'garage' ? { wall: '#d8d2c4', roof: '#6f7378' } : d.props.kind === 'office' ? { wall: '#d3d8dc', roof: '#80878e', window: '#86a3ba' } : {});
    if (raised) w.add(
      buildings({ id: 'buildings', roofs: true, windows: { lit: 0.4 }, data: homes, house: () => true, look: { house: RAISED }, tooltip: tip }),
      buildings({ id: 'buildings-other', roofs: true, windows: { lit: 0.4 }, data: others, house: (d: Feature) => d.props.kind === 'house', look, tooltip: tip }),
    );
    else w.add(buildings({ id: 'buildings', roofs: true, windows: { lit: 0.4 }, data: [...homes, ...others], house: (d: Feature) => d.props.kind === 'house', look, tooltip: tip }));
  }
  // the chargers: the preset at each place's service points, turned as they face (a house's wall box, an office's row
  // of wall chargers at its bays' heads), and each station's own (its canopy and pedestals) at its point; the
  // example's own colours (the preset is neutral)
  const OWN = { brand: '#1f6feb', marking: '#2f8f5b' };
  const chargerAt = (f: Place, a: ShapeAnchor, k: number, props: Record<string, unknown>): Feature => ({ id: `${f.id}-charger-${k + 1}`, props: { owner: f.id, heading: (Number(f.properties.heading) + (a.heading ?? 0)) % 360, ...props }, geometry: { type: 'Point', coordinates: frameOf(f)(a.at[0], a.at[2]) } }) as Feature;
  w.add(entities({
    id: 'chargers', shape: chargers.shape,
    data: [
      ...[...houses, ...offices].flatMap((f) => (traitsOf.get(f.id)?.service ?? []).slice(0, Number(f.properties.charger.ports)).map((a, k) => chargerAt(f, a, k, { ports: 1, power: String(f.properties.charger.power), mount: 'wall', marked: f.properties.charger.marked !== false }))),
      ...stations.map((f) => ({ id: `${f.id}-charger`, props: { owner: f.id, heading: f.properties.heading, ...f.properties.charger }, geometry: { type: 'Point', coordinates: frameOf(f)(...(f.properties.charger.at as [number, number])) } }) as Feature),
    ],
    params: (d: Feature) => ({ ports: Number(d.props.ports), power: String(d.props.power) as '7', mount: d.props.mount as 'wall', marked: d.props.marked !== false, canopy: d.props.mount === 'pedestal', sign: d.props.mount === 'pedestal', ...OWN }),
    heading: (d: Feature) => Number(d.props.heading),
    tooltip: (d: SolidPicked) => placeTip(String(d.props.owner ?? '')),
  }));
  // each bay's light (the preset's anchor: its height), green while free, blue while a car charges there
  const lightAt = (m: Made) => m.anchors.find((a) => a.name === 'light-1')?.at[1] ?? 1.5;
  const lights = (id: string, lg: ReturnType<typeof history.log>, lift: number) => entities({ id, drive: drive.data(lg), color: { value: 'busy', ramp: ['#16a34a', '#2563eb'], domain: [0, 1] }, size: 8, outline: { color: '#ffffff', width: 1.5 }, trail: false, on: 'ground', lift, pickable: false, when: { level: { from: 'building' } } });
  w.add(lights('lights-wall', portLogs!.wall, lightAt(chargers.wall(1))), lights('lights-station', portLogs!.station, lightAt(chargers.station(4))));
}

// ── the cards over the charging places, the cars plugged in folding into them, the pictures ──
const CARDS = CHARGE && q.get('cards') !== '0', FOLD = CHARGE && q.get('fold') !== '0', ICONS = q.get('icons') === '1';
/** the example's own pictures (drawn here, no files): a house, an office, a station's plug, a car seen from above */
const pictures = icons({
  house: (g, n) => { g.fillStyle = '#334155'; g.beginPath(); g.moveTo(n * 0.5, n * 0.1); g.lineTo(n * 0.92, n * 0.48); g.lineTo(n * 0.8, n * 0.48); g.lineTo(n * 0.8, n * 0.9); g.lineTo(n * 0.2, n * 0.9); g.lineTo(n * 0.2, n * 0.48); g.lineTo(n * 0.08, n * 0.48); g.closePath(); g.fill(); g.fillStyle = '#ffffff'; g.fillRect(n * 0.42, n * 0.62, n * 0.16, n * 0.28); },
  office: (g, n) => { g.fillStyle = '#334155'; g.fillRect(n * 0.2, n * 0.08, n * 0.6, n * 0.84); g.fillStyle = '#ffffff'; for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) g.fillRect(n * (0.3 + x * 0.24), n * (0.17 + y * 0.18), n * 0.16, n * 0.1); },
  station: (g, n) => { g.fillStyle = '#1d4ed8'; g.beginPath(); g.arc(n / 2, n / 2, n * 0.44, 0, Math.PI * 2); g.fill(); g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(n * 0.56, n * 0.16); g.lineTo(n * 0.3, n * 0.56); g.lineTo(n * 0.48, n * 0.56); g.lineTo(n * 0.42, n * 0.86); g.lineTo(n * 0.7, n * 0.44); g.lineTo(n * 0.52, n * 0.44); g.closePath(); g.fill(); },
  car: (g, n) => { g.fillStyle = '#ffffff'; g.strokeStyle = '#0f172a'; g.lineWidth = n * 0.06; g.beginPath(); g.roundRect(n * 0.3, n * 0.08, n * 0.4, n * 0.84, n * 0.12); g.fill(); g.stroke(); g.fillStyle = '#0f172a'; g.fillRect(n * 0.35, n * 0.26, n * 0.3, n * 0.14); g.fillRect(n * 0.35, n * 0.66, n * 0.3, n * 0.1); },
});
/** the cars plugged in: each car's time charging (its battery rising while it stands) at the place it stands at, from
 *  its log once it is in (the example's own reading of its data: a relation's rows) */
const plugged = history.relations([]);
const pluggedRows = (): Held[] => {
  const out: Held[] = [], k = log.values.findIndex((v) => v.name === 'charge'), a: [number, number] = [0, 0], b: [number, number] = [0, 0];
  if (k < 0) return out;
  for (let i = 0; i < log.size; i++) {
    let cur: Held | null = null;
    for (let j = 0; j + 1 < log.count[i]!; j++) {
      const s0 = log.slot(i, j), s1 = log.slot(i, j + 1); log.relAt(s0, a); log.relAt(s1, b);
      const still = Math.hypot(a[0] - b[0], a[1] - b[1]) * 6378137 < 1, up = log.valueAt(k, s1) > log.valueAt(k, s0) + 1e-4, t0 = log.epoch + log.secAt(s0) * 1000, t1 = log.epoch + log.secAt(s1) * 1000;
      if (still && up) { if (!cur) { const [lon, lat] = log.lonLat(a[0], a[1]), at = placeAt(lon, lat); if (at) cur = { of: log.ids[i]!, to: at.id, from: t0, until: t1, kind: 'plugged' }; } else cur.until = t1; }
      else if (cur) { out.push(cur); cur = null; }
    }
    if (cur) out.push(cur);
  }
  return out;
};
if (CARDS) {
  // (a place's ports in its ports' log: `${place}-p1` …)
  const portsOf = (d: Feature) => Array.from({ length: Number(d.props.charger.ports) }, (_, k) => `${d.id}-p${k + 1}`);
  const NAME: Record<string, string> = { house: 'Home', office: 'Office', charger: 'Station' };
  const placeFeature = (f: Place): Feature => ({ id: f.id, props: f.properties, geometry: { type: 'Point', coordinates: f.geometry.coordinates } });
  // (one card set for every place: each reads its own ports' log, a station's or a wall charger's; they make room
  // among each other)
  const portsLog = (d: Feature) => (d.props.kind === 'charger' ? portLogs!.station : portLogs!.wall);
  w.add(cards({
    id: 'place-cards', of: scenario.map(placeFeature), icons: pictures,
    // over the roof (a house, an office of its floors), the canopy
    lift: (d: Feature) => (d.props.kind === 'office' ? Number(d.props.levels) * 3.4 + 2 : d.props.kind === 'charger' ? 6 : 7),
    header: { icon: (d: Feature) => String(d.props.kind === 'charger' ? 'station' : d.props.kind), text: (d: Feature) => `${NAME[String(d.props.kind)] ?? d.props.kind} ${String(d.id).replace(/\D+/g, '')}` },
    rows: [
      { label: 'in use', value: { value: 'busy', log: portsLog, key: portsOf }, of: (d: Feature) => Number(d.props.charger.ports), bar: true },
      { label: 'kW', value: { formula: (v, d: Feature) => v.r0! * Number(d.props.charger.power) } },
      // (the cars plugged in: their mean battery while they charge here, a member aggregate)
      { label: 'cars %', value: { formula: (v) => v.soc! * 100, inputs: { soc: plugged.members('mean', 'charge', log) } } },
    ],
    // its colour: white while its chargers are free, blue as they fill
    fill: { value: { formula: (v) => v.r0! / Math.max(1, v.r0of!) }, color: ramp(['#ffffff', '#dbeafe', '#93c5fd']), domain: [0, 1] },
    badge: { value: plugged.count },
    priority: (d: Feature) => (d.props.kind === 'charger' ? 2 : d.props.kind === 'office' ? 1 : 0),
    size: { px: 108 }, when: { level: { from: 'building' } }, tooltip: (d: Feature) => placeTip(String(d.id)),
  }));
}

/** what a tap on a car tells: its id, its habit, its battery, its speed, what it is doing (driving; charging: its
 *  charge rising; parked) and where */
const tip = (d: Thing) => {
  const st = d.state; if (!st) return d.id;
  const soc = st.values.charge ?? 0, later = log.at(d.id, w.time.getTime() + 20e3), charging = !!later && (later.values.charge ?? 0) > soc + 0.002;
  const doing = DRONES ? (st.alt ?? 0) > 0.5 ? `flying ${Math.round(st.alt!)} m up` : st.speed > 0.5 ? 'taking off' : 'on its pad' : st.speed > 0.5 ? 'driving' : `${charging ? 'charging' : 'parked'}${CHARGE ? ` at ${placeName(placeAt(st.lon, st.lat))}` : ''}`;
  return `${d.id}${d.props.kind ? ` · ${d.props.kind}` : ''}${d.props.charges ? ` · ${d.props.charges}` : ''}\nbattery ${Math.round(soc * 100)} % · ${Math.round(st.speed * 3.6)} km/h · ${doing}`;
};
// the car: aslnut's preset (the default: its coupé SUV row here), or a CC0 glTF model (Kenney's car kit, kept with
// the data: never in git) by its URL (&car=model)
const carModel = q.get('car') ?? 'preset';
const carShape: Made = CHARGE && carModel === 'model' ? await shapes.import('/aslnut/data/assets/vehicles/kenney-car-kit/sedan.glb', { length: 4.6 }) : cars.make({ type: CHARGE ? 'suv' : 'hatch', paint: '#ffffff', traffic: 'left' });
/** the cars near the camera: a soft contact shadow under each (one quad each on the chip; &shadow=0: none) */
const SHADOW = q.get('shadow') === '0' ? false : { opacity: 0.5 };
const fleet = entities(CHARGE
  ? {
    // each car its own paint (as a street has), a bar over it showing its battery and its per cent, the whole build
    // close up
    id: 'fleet', drive: drive.data(log), shape: carShape, near: { pixels: 6, max: 60, level: 0, shadow: SHADOW }, ...(FOLD ? { fold: plugged } : {}), ...(ICONS ? { dots: false } : {}),
    color: (d: Thing) => String(d.props.paint ?? '#d0d0d0'), size: 8, outline: { color: '#ffffff', width: 1.5 }, trail: trailOf(trailSec),
    gauge: { value: 'charge', domain: [0, 1], size: [34, 13], outline: '#0b1220', label: true, within: 160, over: 4 }, tooltip: tip,
  }
  : DRONES ? {
    // aslnut's quadcopter, kept 8 px across at the least (its metres near, a drone you can see farther away: the nearest
    // 200 whole or simple, 1500 more in its far form, the rest dots), its rotors spinning, its battery its colour; in
    // the air banked into its turns (30° at most), its shadow fading as it climbs
    id: 'fleet', drive: drive.data(log), shape: drones.quad, near: { pixels: 0, size: { min: 8 }, farMax: 1500, shadow: AIR && SHADOW ? { ...SHADOW, fade: 60 } : SHADOW }, joints: { wheel: { rate: 3600, unit: 'rpm' } }, ...(AIR ? { attitude: { bank: true, max: [30, 30] as [number, number] } } : {}),
    color: { value: 'charge', ramp: 'rdylgn', domain: [0, 1] }, size: 6, trail: trailOf(trailSec), tooltip: tip,
  } : {
    id: 'fleet', drive: drive.data(log), shape: carShape, near: { shadow: SHADOW },
    color: { value: 'charge', ramp: 'rdylgn', domain: [0, 1] }, size: 7,
    trail: trailOf(trailSec), tooltip: tip,
  });
// &icons=1: each car far away its own icon (the example's picture, drawn here: a car seen from above), turned along its
// path and painted as the car; near the camera its shape (the icon gives way, as the dot does)
if (CHARGE && ICONS) w.add(icon({ id: 'fleet-icons', of: fleet, icons: pictures, icon: 'car', heading: true, size: { m: 9, min: 14, max: 30 }, color: (d: Thing) => String(d.props.paint ?? '#d0d0d0'), tooltip: tip }));
// the charge scene's other traffic: vehicles passing through (not the scenario's cars), grey, no bar
const trafficLog = CHARGE ? history.log({ url: `${FLEET}/charge-traffic.hist` }) : null;
const trafficTrail = (sec: number) => (sec > 0 ? { seconds: sec, width: 2.5, fade: 'ease' as const, color: '#475569' } : false as const);
const traffic = trafficLog ? entities({
  id: 'traffic', drive: drive.data(trafficLog), shape: carShape, near: { pixels: 6, max: 60, level: 0, shadow: SHADOW },
  color: '#5b6573', size: 6, outline: { color: '#ffffff', width: 1.2 }, trail: trafficTrail(trailSec),
  tooltip: (d: Thing) => `${d.id} · passing through (not one of the scenario's cars)${d.state ? ` · ${Math.round(d.state.speed * 3.6)} km/h` : ''}`,
}) : null;
if (traffic) w.add(traffic);
// (&defer=1: the fleet waits for aslnutDemo.start(): a measurement brackets its own build)
const DEFER = q.get('defer') === '1';
// (the cars plugged in: read from their log once it is in)
const start = async () => { w.add(fleet); await log.start({ loader: w.loader }); if (CHARGE) plugged.set(pluggedRows()); await w.settled({ timeout: 60000 }); };
if (!DEFER) { w.add(fleet); await log.start({ loader: w.loader }); if (CHARGE) plugged.set(pluggedRows()); }

// ── &bench=cards: 500 cards, 100 of them on moving things (a set of the log's first 100 vehicles) and 400 on still
// places spread round the view (seeded), each a header and two rows; what the cards cost is the measure's ──
let bench: Record<string, { readouts(): Record<string, () => unknown> }> | null = null;
if (q.get('bench') === 'cards' && !CHARGE) {
  await log.start({ loader: w.loader });
  const sub = history.fromBytes(log.toBytes({ things: 100 })), v = view;
  const movers = entities({ id: 'movers', drive: drive.data(sub), color: { value: 'charge', ramp: 'rdylgn', domain: [0, 1] }, size: 7, trail: false });
  const rnd = ((x: number) => () => { x = (x * 1664525 + 1013904223) >>> 0; return x / 4294967296; })(151);
  const sites = Array.from({ length: 400 }, (_, i) => ({ id: `site-${i + 1}`, props: { load: Math.round(rnd() * 100), ports: 1 + (i % 6) }, geometry: { type: 'Point' as const, coordinates: [v.lon + (rnd() - 0.5) * 0.06, v.lat + (rnd() - 0.5) * 0.08] as [number, number] } }));
  const still = cards({ id: 'bench-sites', of: sites, header: { text: (d: Feature) => String(d.id) }, rows: [{ label: 'load', value: (d: Feature) => Number(d.props.load), of: 100, bar: true }, { label: 'ports', value: (d: Feature) => Number(d.props.ports) }], size: { px: 96 } });
  const moving = cards({ id: 'bench-movers', of: movers, header: { text: (d: Thing) => d.id }, rows: [{ label: 'charge %', value: { formula: (vv) => vv.fill! * 100 } }], fill: { value: 'charge', color: ramp('rdylgn'), domain: [0, 1] }, size: { px: 88 }, lift: 2, priority: () => 1 });
  w.add(movers, still, moving);
  bench = { movers, still, moving };
}

// the replay: the log's hour on the world's clock (play, pause, speed, seek); looping
const play: Playback = replay(w, { from: FROM, to: FROM + SPAN, speed: Number(q.get('speed') ?? 4), loop: true });
play.seek(FROM + T_START * 60e3);

// ── the bar ──
const playBtn = $<HTMLButtonElement>('#play'), time = $<HTMLInputElement>('#time'), clockEl = $('#clock');
const speed = $<HTMLSelectElement>('#speed'), trail = $<HTMLInputElement>('#trail'), trailV = $('#trail-v'), nSel = $<HTMLSelectElement>('#n');
if (CHARGE) {
  nSel.parentElement!.querySelectorAll('.lab')[2]!.remove(); nSel.remove(); $('#key').style.display = 'none';
  // (a day: faster speeds too)
  for (const v of [300, 1200]) { const o = document.createElement('option'); o.value = String(v); o.textContent = `${v}×`; speed.append(o); }
}
speed.value = String(play.speed); trail.value = String(trailSec); trailV.textContent = `${trailSec} s`; nSel.value = String(N);
const hhmm = (d: Date) => d.toLocaleTimeString('en-AU', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'Australia/Melbourne' });
const show = () => { playBtn.textContent = play.playing ? '❚❚ pause' : '▶ play'; playBtn.classList.toggle('on', play.playing); clockEl.textContent = hhmm(play.time); if (document.activeElement !== time) time.value = String(play.progress); };
play.on(show); w.on('frame', show); show();
playBtn.onclick = () => play.toggle();
time.oninput = () => play.seek(Number(time.value), { share: true });
speed.onchange = () => play.setSpeed(Number(speed.value));
// the trail's length: drawn at once while dragged; its pieces counted again when let go
trail.oninput = () => { trailV.textContent = `${trail.value} s`; fleet.setProps({ trail: trailOf(Number(trail.value)) }); traffic?.setProps({ trail: trafficTrail(Number(trail.value)) }); };
if (!CHARGE) nSel.onchange = () => { const u = new URLSearchParams(q); u.set('n', nSel.value); location.search = `?${u}`; };
// (the charge scene plays at once, at 4×: &play=0 starts it paused; the others start paused: &play=1 plays)
if (q.get('play') === '1' || (CHARGE && !check && q.get('play') !== '0')) play.play();

// ── the panel: which graphics, frames, memory, the set's numbers ──
const link = (k: string, v: string | null) => { const u = new URLSearchParams(q); if (v === null) u.delete(k); else u.set(k, v); return `?${u}`; };
const panel = $('#panel');
const draw = () => {
  const s = w.stats(), tm = w.telemetry(), c = fleet.counts(), fr = tm.frames;
  const api = s.api === 'webgpu' ? 'WebGPU' : 'WebGL2';
  panel.innerHTML = `<div class="row"><b>fleet · build ${BUILD}</b><span class="${s.api}">${api}</span></div>
    <div class="row"><span>${fr.resting ? '<span class="webgpu">resting</span> · 0 fps' : `${fr.fps} fps`}</span><span>gpu ${tm.memoryMB.toFixed(0)} MB${s.heapBytes ? ` · heap ${(s.heapBytes / 1048576).toFixed(0)} MB` : ''}</span></div>
    <div class="why">${c.things} vehicles · ${c.samples < 1e5 ? c.samples.toLocaleString('en') : `${(c.samples / 1e6).toFixed(2)} M`} samples · trail ${c.trailPieces ? `${c.trailPieces / Math.max(1, c.things)} pieces` : 'off'} · ${c.shapes} cars near</div>
    <div class="why">zoom ${s.zoom.toFixed(1)} · ${s.draws} draws</div>${CHARGE ? charging() : ''}
    ${errors.length ? `<div class="err">${errors.slice(-4).map(esc).join('\n')}</div>` : ''}
    <div><a href="${link('graphics', 'webgpu')}" class="${want === 'webgpu' ? 'on' : ''}">webgpu</a> <a href="${link('graphics', 'webgl2')}" class="${want === 'webgl2' ? 'on' : ''}">webgl2</a> <a href="${link('twin', TWIN ? null : '1')}" class="${TWIN ? 'on' : ''}">twin</a> ${Object.keys(VIEWS).map((k) => `<a href="${link('go', k)}" class="${k === go ? 'on' : ''}">${k}</a>`).join(' ')}</div>`;
};
/** how far each standing car is from the nearest parking point of the design drawn (its traits; a station's bays): the
 *  scenario's cars stand where any design of a house or an office says its cars do */
const parkingFit = (t = w.time.getTime() - (fleet?.drive.smooth ?? 0)) => {
  const spots: [number, number][] = [];
  for (const f of scenario) { const at = frameOf(f), list = f.properties.kind === 'charger' ? asTraits(f).parking : traitsOf.get(f.id)?.parking ?? []; for (const a of list) spots.push(at(a.at[0], a.at[2])); }
  let standing = 0, worst = 0;
  for (const st of log.stateAt(t)) { if (st.speed > 0.05 || st.outside) continue; let d = Infinity; for (const p of spots) d = Math.min(d, metres([st.lon, st.lat], p)); standing++; worst = Math.max(worst, d); }
  return { standing, worst: +worst.toFixed(3), spots: spots.length };
};
// the charge scene: who charges now, where (the ports' logs), and the places to go to (each a tap: the next of its kind)
const charging = () => {
  if (!portLogs?.wall.size) return '';
  const n: Record<string, number> = { house: 0, office: 0, charger: 0 };
  for (const f of scenario) n[f.properties.kind] = (n[f.properties.kind] ?? 0) + portsAt(f).busy;
  return `<div class="why">charging now: <b>${n.house}</b> at home · <b>${n.office}</b> at work · <b>${n.charger}</b> at stations</div>
    <div class="why">houses: ${HOUSES} · traits of ${traitsOf.size} places${traitProblems.length ? ` · <span class="err">${traitProblems.length} misplaced</span>` : ' · all in place'}</div>
    <div>${['office', 'charger', 'house'].map((k) => `<a href="#" data-place="${k}">${KIND[k]} ▸</a>`).join(' ')}</div>`;
};
const nextOf: Record<string, number> = {};
panel.addEventListener('click', (e) => {
  const k = (e.target as HTMLElement).dataset?.place; if (!k) return;
  e.preventDefault(); const list = scenario.filter((f) => f.properties.kind === k); if (!list.length) return;
  const i = (nextOf[k] = ((nextOf[k] ?? -1) + 1) % list.length); void w.fly(viewOf(list[i]!), { seconds: 1.2 });
});
// (&panel=0: no panel at all: a measurement's rest is the world's own)
if (q.get('panel') === '0') panel.style.display = 'none'; else { setInterval(draw, 500); draw(); }
(window as unknown as { aslnutDemo: unknown }).aslnutDemo = { w, fleet, log, play, plugged, pictures, bench, build: BUILD, errors, n: N, twin: TWIN, views: VIEWS, start, portLogs, scenario, place: (id: string, o?: Parameters<typeof viewOf>[1]) => viewOf(placeById.get(id)!, o), tips: { car: tip, place: placeTip }, lib: { history, entities, drive }, houses: HOUSES, traitsOf, traitProblems, parkingFit };
