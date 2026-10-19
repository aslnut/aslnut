// journey: a trip from Melbourne to Bali, followed by the camera. A car drives the city's roads to the airport at
// Tullamarine (the quickest way, core › geometry › networks); two hours later a plane (this example's own airliner,
// kept 22 px across at the least: its size in metres with a floor in pixels) taxis out and takes off; the flight goes
// along the great circle at 11 km (the camera rises until it sees the globe, then comes down), lands at Ngurah Rai
// from the sea, and a car takes the road to Kuta, where the evening falls on the beach at street level (the roads,
// buildings and trees from open data baked as the twin's street level is) and the waves come in: the sea's look and
// its shore (modules › world › earth › water › sea). The world's clock is the trip's (the sun where it really is);
// the waits at the airports are jumps, said on screen. Both cars and the plane are sets moved by their logs (their
// samples on the chip, the clock a uniform); the plane flies at each sample's height (its log's altitude, over the
// land or the sea), its nose pitched by its log, banked into its turns by its path, its shadow under it on the ground.
// Each shot's camera is a plan of the library's moves (core › observation › observers › orbit › moves: a chase, a
// track, a crane, keyed rigs round the car or the plane, each damped as it follows its thing by its log), the beach's
// eye path this example's own. The first shot (and every one of the reel) holds at its first moment, the trip's clock
// stopped, until its views are loaded; a recording (w.record) instead waits frame by frame and loads the way ahead.
//   ?go=melbourne | takeoff | flight | landing | kuta (the drive, then the beach) | all (default: the whole trip) |
//   reel (the story in 37 s for a recorder, 16:9 or a phone: chase 7 · take-off 8 · globe 8 · landing 6 · kuta 8; with
//   &clock=30&record=1 a recorder calls `await aslnutDemo.next()` for each frame: w.record's, deterministic, every
//   tile in) |
//   parity (no network: a mock coast and terrain, the waves held at one moment; &tier=displaced)
//   &graphics=auto | webgpu | webgl2   &dpr=1   &clock=30 (a fixed step: the tools)   &at=seconds into the sequence
//   &view=lon,lat,zoom,tilt,bearing (a still view of your own)   &panel=0   &sea=plain (water()'s plain sea)
import { AslnutError, GraphicsUnavailable, Shot as Played, water, arc, buildings, bakedRoads, controllers, drive, earth, earthLite, entities, history, imagery, lookAt, move, moves, sea, sky, streets, sunAt, supported, terrain, track, trail, world, type Feature, type Pose, type RecordedFrame, type World } from '../../src/index.ts';
import { cars } from '../../src/modules/presets/vehicles/index.ts';
import { airliner, MAIN_GEAR } from './airliner.ts';
import { heightAt, timeline, type Journey, type Sample } from './story.ts';
import { KUTA, KUTA_TILES, LOOK, PACK, kutaGround, kutaWorkers } from './street-level.ts';
import { ease, from, lerp, offset, type Plan } from './camera.ts';

declare const __BUILD__: number;
const BUILD = typeof __BUILD__ === 'number' ? __BUILD__ : 0;
const q = new URLSearchParams(location.search);
const SHOTS = ['melbourne', 'takeoff', 'flight', 'landing', 'kuta', 'all', 'reel'] as const;
type ShotName = (typeof SHOTS)[number];
const go = (q.get('go') ?? 'all') as ShotName | 'parity';
const PARITY = go === 'parity', REEL = go === 'reel';
/** a recorder will take the frames (&record=1): after the first shot's hold the loop stops there, so the first frame
 *  recorded is the sequence's first moment on every run */
const RECORD = q.get('record') === '1';
const want = (q.get('graphics') ?? 'auto') as 'auto' | 'webgpu' | 'webgl2';
const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const errors: string[] = [];
const noteError = (m: string) => { errors.push(m); if (errors.length > 20) errors.shift(); };
addEventListener('error', (e) => noteError(String(e.message)));
addEventListener('unhandledrejection', (e) => noteError(String((e.reason as Error)?.message ?? e.reason)));
if (REEL || q.get('panel') === '0') document.body.classList.add('reel');
document.addEventListener('click', (e) => { const el = e.target as HTMLElement | null; if (el?.classList?.contains('credits')) el.classList.toggle('open'); });
const ODBL = { attribution: '© OpenStreetMap contributors (ODbL)' };

// ── the trip: its tracks (the pack) and their times ──
const J: Journey | null = PARITY ? null : await fetch(`${PACK}/journey.json`).then((r) => r.json());
const TL = J ? timeline(J) : null;
const T = TL?.t ?? null;
/** the plane's height over the ground where it is (each place passed once) */
const altAt = TL ? heightAt(TL.plane.samples) : () => 0;

// ── the shots: each a span of the trip's time, its rate, its camera (a function of the shot's own seconds) ──
const MEL = 'Australia/Melbourne', BALI = 'Asia/Makassar';
interface Shot {
  name: string; title: string; zone: string;
  /** the trip's time it starts at (ms, UTC) and its rate (world seconds a second) */
  from: number; rate: number;
  /** seconds it lasts on screen (the last one of a sequence holds) */
  seconds: number;
  /** said as it starts (a jump of the clock) */
  jump?: string;
  /** its camera: the moves it plays at its own seconds, or a pose of this example's own at a share of it (0..1) */
  plan?: Plan[];
  pose?: (w: World, k: number, timeMs: number) => { pose: Pose; ground: number };
}
let w: World;
// (the plane's: each sample's height over the ground or the sea under it, its pitch in degrees)
const carLog = history.log({ keep: Infinity, attribution: ODBL.attribution }), planeLog = history.log({ values: { pitch: 'f32' }, altitude: 'ground', keep: Infinity });
const append = (log: ReturnType<typeof history.log>, id: string, s: Sample[], air = false) => log.appendMany(s.map((x) => ({ id, t: x.t, lon: x.lon, lat: x.lat, ...(air ? { alt: x.alt, values: { pitch: x.pitch } } : {}) })));
if (TL) { append(carLog, 'car-mel', TL.cars.mel); append(carLog, 'car-dps', TL.cars.dps); append(planeLog, 'plane', TL.plane.samples, true); }
/** the things the camera follows: on their logs, at the world's time (the plane at its height over the ground) */
const carMel = track(carLog, 'car-mel', { up: 1 }), carDps = track(carLog, 'car-dps', { up: 1 }), plane = track(planeLog, 'plane', { up: (lon, lat) => altAt(lon, lat) });
/** shot seconds when the trip's clock reaches `ms`, in a shot from `from` at `rate` */
const secondsTo = (ms: number, from: number, rate: number) => Math.max(0, (ms - from) / 1000 / rate);

/** Kuta's beach: where the car stops on the beach road, over the beach wall, the sand 12 m from the water (the
 *  coastline here: 115.16908, -8.7205) */
const BEACH = { road: [115.16956, -8.72075] as [number, number], wall: [115.16960, -8.72040] as [number, number], sand: [115.16919, -8.72052] as [number, number] };
/** the take-off's and the landing's moves, keyed to the trip's moments (a shot started anywhere, at any rate, keeps
 *  them: the reel's shorter spans) */
function takeoff(from: number, rate: number): Plan[] {
  const t = T!;
  return [
    // alongside it on the runway as it rolls and lifts off (a tracking shot from its left), then the camera falls back
    // and rises behind it as it climbs away over the suburbs (it keeps 22 px across, its size floor: fixed pixels)
    { at: 0, move: moves.track(plane, { side: 78 * Math.sin(80 * Math.PI / 180), up: 78 * Math.cos(80 * Math.PI / 180), raise: 0.15 }) },
    { at: secondsTo(t.liftoff + 2e3, from, rate), seconds: 45 / rate, move: move({ kind: 'track', aim: plane, keys: [{ at: 0, rig: 'now' }, { at: 1, rig: { dist: 4200, tilt: 63, turn: 168, raise: 0 }, ease }] }) },
  ];
}
function landing(from: number, rate: number): Plan[] {
  const t = T!;
  return [
    // behind it as it comes in over the sea on its final approach, swinging round to its side as it touches down and
    // rolls along the runway
    { at: 0, move: move({ kind: 'track', aim: plane, keys: [{ at: 0, rig: { dist: 150, tilt: 74, turn: 155, raise: 0.1 } }] }) },
    { at: secondsTo(t.touchdown - 14e3, from, rate), seconds: 30 / rate, move: move({ kind: 'track', aim: plane, keys: [{ at: 0, rig: 'now' }, { at: 1, rig: { dist: 115, tilt: 79, turn: 95, raise: 0.1 }, ease }] }) },
  ];
}
function shots(): Record<Exclude<ShotName, 'all' | 'reel'> | 'beach', Shot> {
  const t = T!;
  const flightRate = ((t.final - 9 * 60e3) - (t.liftoff + 3 * 60e3)) / 1000 / 12;
  return {
    // the car on the freeway to the airport: a chase behind it; then a crane up over the terminal from the chase's eye
    melbourne: { name: 'melbourne', title: 'Melbourne · to the airport', zone: MEL, from: t.melArrive - 7.5 * 60e3, rate: 8, seconds: 60, plan: [
      { at: 0, move: moves.chase(carMel, { behind: 42, up: 16 }) },
      { at: 48, seconds: 12, move: moves.crane(carMel, { to: { dist: 1400, tilt: 52, turn: 30 }, ease }) },
    ] },
    takeoff: { name: 'takeoff', title: 'Melbourne Airport · take-off', zone: MEL, from: t.roll - 6e3, rate: 1.6, seconds: 50, plan: takeoff(t.roll - 6e3, 1.6) },
    // up until the globe is seen whole (Australia's coast, the sea, Indonesia), along with the plane, then down to Bali
    flight: { name: 'flight', title: 'Over Australia · to Bali', zone: MEL, from: t.liftoff + 3 * 60e3, rate: flightRate, seconds: 12, plan: [
      { at: 0, seconds: 12, move: move({ kind: 'crane', aim: lookAt(plane), keys: [
        { at: 0, rig: { dist: 20000, tilt: 55, turn: 0 } }, { at: 0.35, rig: { dist: 9.5e6, tilt: 4, bearing: 0 }, ease },
        { at: 0.62, rig: { dist: 9.5e6, tilt: 4, bearing: 0 } }, { at: 1, rig: { dist: 30000, tilt: 50, turn: 0 }, ease },
      ] }) },
    ] },
    landing: { name: 'landing', title: 'Ngurah Rai · landing', zone: BALI, from: t.touchdown - 62e3, rate: 2, seconds: 45, plan: landing(t.touchdown - 62e3, 2) },
    // the car from the arrivals to Kuta through Tuban's streets (a chase at street level)
    kuta: { name: 'kuta', title: 'Kuta · from the airport', zone: BALI, from: t.dpsStart, rate: (t.beach - t.dpsStart) / 1000 / 40, seconds: 40, plan: [{ at: 0, move: moves.chase(carDps, { behind: 30, up: 12 }) }] },
    // the beach at dusk at street level, the clock at its own pace: up from behind the car over the beach wall, down to
    // the sand by the water, the sun low over the sea, the waves breaking and running up the sand; then along the beach
    beach: { name: 'beach', title: 'Kuta · the beach at dusk', zone: BALI, from: t.beach, rate: 1, seconds: 40, pose: (ww, k, ms) => {
      const st = carLog.at('car-dps', ms), car = st ? { lon: st.lon, lat: st.lat } : { lon: BEACH.road[0], lat: BEACH.road[1] };
      const sun = sunAt(new Date(ms), BEACH.sand[1], BEACH.sand[0]).azimuth, seaAt = offset(BEACH.sand[0], BEACH.sand[1], sun, 320);
      const a = ease(k / 0.4), b = ease((k - 0.4) / 0.35), c = ease((k - 0.75) / 0.25);
      const behind = offset(car.lon, car.lat, sun + 180, 26), along = offset(BEACH.sand[0], BEACH.sand[1], sun + 90, 30 * c);
      const eye: [number, number, number] = b <= 0 ? [lerp(behind[0], BEACH.wall[0], a), lerp(behind[1], BEACH.wall[1], a), lerp(9, 26, a)] : [lerp(BEACH.wall[0], along[0], b), lerp(BEACH.wall[1], along[1], b), lerp(26, 9, b)];
      const at: [number, number, number] = b <= 0 ? [lerp(car.lon, seaAt[0], a), lerp(car.lat, seaAt[1], a), lerp(1.2, 0, a)] : [seaAt[0] + (along[0] - BEACH.sand[0]), seaAt[1] + (along[1] - BEACH.sand[1]), 0.6 * b];
      return from(ww, eye, at);
    } },
  };
}
/** the sequence a go= plays: one shot, the whole trip, or the reel */
function sequence(): Shot[] {
  if (!T) return [];
  const s = shots();
  if (go === 'all') return [s.melbourne, { ...s.takeoff, jump: '2 hours later · boarding' }, s.flight, s.landing, { ...s.kuta, jump: '17 minutes later · through arrivals' }, s.beach];
  if (go === 'kuta') return [s.kuta, s.beach];
  if (REEL) {
    const tk = T.liftoff - 12e3, ld = T.touchdown - 14e3;
    return [
      // (the chase: low behind the car on the freeway, swinging round it as it goes: a chase and an arc)
      { ...s.melbourne, name: 'chase', from: T.melArrive - 6.5 * 60e3, rate: 8, seconds: 7, plan: [{ at: 0, seconds: 7, move: moves.chase(carMel, { behind: 30 * Math.sin(74 * Math.PI / 180), up: 30 * Math.cos(74 * Math.PI / 180), turn: -35, to: { dist: 24, tilt: 70, turn: 40 }, ease }) }] },
      { ...s.takeoff, name: 'take-off', from: tk, rate: 3.5, seconds: 8, jump: '2 hours later', plan: takeoff(tk, 3.5) },
      { ...s.flight, name: 'globe', seconds: 8, rate: s.flight.rate * 1.5, plan: [{ ...s.flight.plan![0]!, seconds: 8 }] },
      { ...s.landing, name: 'landing', from: ld, rate: 3, seconds: 6, plan: landing(ld, 3) },
      { ...s.beach, name: 'kuta', seconds: 8, jump: 'Kuta at dusk', pose: (ww, k, ms) => s.beach.pose!(ww, 0.15 + 0.6 * k, ms) },
    ];
  }
  return [s[go as keyof typeof s] ?? s.kuta];
}

// ── the world ──
const canvas = $<HTMLCanvasElement>('#view');
const sup = await supported();
/** a plain ground (the parity check: no network, the same on every run) */
const plain = () => imagery.custom({ id: 'plain', attribution: '', draw: (g) => { g.fillStyle = '#c9c2a8'; g.fillRect(0, 0, 256, 256); return true; } });
/** a mock shore (the parity check): the land rising east of the coast at 1 in 25, the floor falling west of it */
const mockShore = () => terrain.custom({ id: 'mock-shore', heights: (t, n) => { const out = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const lon = ((t.x + i / (n - 1)) / 2 ** t.z) * 360 - 180; out[j * n + i] = Math.max(-25, Math.min(6, (lon - 115.1689) * 109400 / 25)); } return out; } });
const seq = sequence(), first = seq[0];
// (the parity view: a straight coast running north–south, the sea to its west, a low sun)
const PARITY_VIEW = { lon: 115.1700, lat: -8.7200, zoom: 18.6, tilt: 74, bearing: 255 };
try {
  w = await world(canvas, {
    // (the globe and the region from Sentinel-2's cloudless mosaic, free to load ahead and keep; the city and closer
    // from the high-resolution imagery tiles; an offline basemap under both, so the globe is never empty)
    body: PARITY ? earth({ imagery: [plain()], terrain: [mockShore()], sky: sky() }) : earth({
      imagery: [imagery.sentinel({ when: (s) => (s.observation.index <= 3 ? 1 : 0) }), imagery.esri({ when: (s) => (s.observation.index > 3 ? 1 : 0) })],
      base: earthLite({ url: '/aslnut/data/packs/earth-lite', maxZoom: 4, attribution: 'Sentinel-2 cloudless 2020 by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020), CC BY 4.0' }), terrain: [terrain.mapzen(), kutaGround()], sky: sky(),
    }),
    observation: { levels: 'default' },
    view: PARITY ? PARITY_VIEW : { lon: 144.95, lat: -37.81, zoom: 15, tilt: 60, bearing: 0 },
    graphics: want,
    clock: q.get('clock') === 'manual' ? 'manual' : q.get('clock') ? { fps: Number(q.get('clock')) } : 'real',
    time: PARITY ? new Date(Date.UTC(2026, 9, 19, 9, 50)) : new Date(first!.from),
    timeZone: 'auto',
    pixelRatio: q.get('dpr') ? Number(q.get('dpr')) : undefined,
    // (the credits: one line on a page, a tap shows them all; the reel's wrap, every credit read whole in a recording)
    attribution: { className: 'credits', format: (c) => `${c.join(' · ')} · build ${BUILD}` },
    onError: (e) => noteError(e instanceof AslnutError ? e.message : String((e as Error)?.message ?? e)),
  });
} catch (e) {
  const why = e instanceof GraphicsUnavailable ? `${e.message} · WebGPU here: ${sup.webgpu ? 'yes' : 'no'} · WebGL2 here: ${sup.webgl2 ? 'yes' : 'no'}` : String((e as Error).message);
  $('#panel').innerHTML = `<b>journey · build ${BUILD}</b><div class="err">${esc(why)}</div>`;
  throw e;
}

// ── the sea: its look (the waves the wind raises, a swell from the south-west) and its shore (Kuta's coastline) ──
const coastFeatures: Feature[] = PARITY
  // (a coast running north–south through the view, the land to its east: drawn north to south, the land on its left)
  ? [{ id: 'mock-coast', props: { natural: 'coastline' }, geometry: { type: 'LineString', coordinates: [[115.1690, -8.7100], [115.1692, -8.7150], [115.1688, -8.7200], [115.1690, -8.7250], [115.1686, -8.7300]] } }]
  : ((await fetch(`${PACK}/coast.geojson`).then((r) => r.json())) as { features: { id: string; properties: Record<string, unknown>; geometry: Feature['geometry'] }[] }).features.filter((f) => f.properties.natural === 'coastline').map((f) => ({ id: f.id, props: f.properties, geometry: f.geometry }));
if (q.get('sea') === 'plain') w.add(water({ id: 'water' })); else w.add(sea({
  look: { wind: { speed: 6, from: 120 }, swell: { height: 1.3, period: 12, from: 225 }, ...(REEL ? { clock: () => played } : {}) },
  shore: { coast: coastFeatures, surf: 140, runup: 14, period: 11 },
  // (the parity check: the waves held at one moment, the tier asked: the same picture on both graphics)
  ...(PARITY ? { look: { wind: { speed: 6, from: 120 }, swell: { height: 1.3, period: 12, from: 225 }, tier: q.get('tier') === 'displaced' ? 'displaced' : 'flat', clock: () => 12.5 } } : {}),
}));
if (!PARITY && T) {
  // Kuta's street level: the baked roads, the tiles of buildings and trees (built off the main thread)
  w.add(
    bakedRoads({ id: 'roads', url: `${KUTA}/index.json`, near: 3500, when: { level: { from: 'street' } } }),
    streets({ id: 'street', url: KUTA_TILES, near: 3500, look: LOOK, worker: kutaWorkers(), when: { level: { from: 'street' } } }),
  );
  // the airports: their terminals, hangars and buildings from their footprints (no names)
  const ap = ((await fetch(`${PACK}/airports.geojson`).then((r) => r.json())) as { features: { id: string; properties: Record<string, unknown>; geometry: Feature['geometry'] }[] }).features;
  const built = ap.filter((f) => (f.geometry?.type === 'Polygon' || f.geometry?.type === 'MultiPolygon') && (f.properties.building || ['terminal', 'hangar'].includes(String(f.properties.aeroway)))).map((f) => ({ id: f.id, props: { ...f.properties, building: f.properties.building ?? f.properties.aeroway, height: f.properties.height ?? (f.properties.aeroway === 'terminal' ? 18 : f.properties.aeroway === 'hangar' ? 16 : undefined) }, geometry: f.geometry })) as Feature[];
  // (shown while the trip is at an airport, by its time: from the district level down)
  const atAirport = (s: { time: { now: Date }; observation: { index: number } }) => { const t = s.time.now.getTime(), T0 = TL!.t; return s.observation.index >= 4 && (t < T0.liftoff + 4 * 60e3 || (t > T0.final - 4 * 60e3 && t < T0.dpsStart + 3 * 60e3)); };
  w.add(buildings({ id: 'airports', data: built, roofs: true, windows: { lit: 0.35 }, when: atAirport as never }));
  // the trip's way between the airports: the great circle on the ground, faint, seen from far; the plane's own way
  // behind it as it flies (its last two hours, at its height)
  const mel = J!.runways.mel.from, dps = J!.runways.dps.from;
  w.add(arc({ id: 'route', data: [{ id: 'route', props: {}, geometry: { type: 'LineString', coordinates: [mel, dps] } }] as Feature[], from: () => mel, to: () => dps, height: 0, color: '#ffffffa0', width: 1.6, dashes: [6, 6], pickable: false, when: { level: { to: 'region' } } }));
  const track = TL!.plane.samples.filter((s) => s.alt > 30);
  w.add(trail({ id: 'flown', data: [{ id: 'flown', props: { times: track.map((s) => s.t) }, geometry: { type: 'LineString', coordinates: track.map((s) => [s.lon, s.lat, s.alt]) } }] as Feature[], window: 7200, head: 0.4, width: 2, color: '#ffffffd0', on: 'absolute', pickable: false, when: { level: { to: 'city' } } }));
  // the cars: a set moved by its log (two things: Melbourne's, Bali's), the car near (14 px at the least), on the roads
  w.add(entities({ id: 'cars', drive: drive.data(carLog), shape: cars.make({ type: 'sedan', paint: '#c8382c', traffic: 'left' }), near: { pixels: 0, size: { min: 14 }, shadow: true }, color: '#c8382c', size: 9, trail: false, before: 'hide', when: { level: { from: 'district' } } }));
  // the plane: a set of one moved by its log, flying at each sample's height over the land or the sea under it, its
  // nose pitched by its log, banked into its turns, turned about its main gear (its nose lifts on the runway); its
  // soft shadow under it on the runway, gone as it climbs; shown while the trip has it (until five minutes after it
  // reached its stand)
  w.add(entities({ id: 'plane', drive: drive.data(planeLog), shape: airliner.make(), near: { pixels: 0, shadow: true }, attitude: { pitch: 'pitch', bank: true, pivot: MAIN_GEAR }, on: 'surface', when: (s) => s.time.now.getTime() <= TL!.t.stand + 5 * 60e3, color: '#ffffff', size: 8, trail: false, before: 'hold' }));
}

// (the camera may come as close as a person on the sand: some 4 m)
w.control(null, controllers.orbit({ zoomRange: [0, 26] }));
// ── the director: each shot's camera from its own seconds (its plan's moves played at their seconds, or its pose);
// the trip's clock its span at its rate. A shot that must be loaded first (the first one; every one of the reel when
// it plays live) holds at its first moment, the trip's clock stopped, until its views are in and the world settles;
// a recording (w.record) holds nothing: it waits frame by frame and loads the way ahead itself. The director runs
// before each frame is drawn (everyFrame before: the camera set for a frame is that frame's). The reel's own time
// (what the sea's waves go by there) counts only what plays ──
let shotI = -1, shotT0 = 0, touches = w.camera.touches, directing = !PARITY, holding = false, played = 0, ended = false, started = false, cameraMs = 0, planI = -1;
const caption = { where: $('#caption .where'), when: $('#caption .when'), jump: $('#caption .jump') };
/** the clock where the shot is: its hour and the zone's own short name (Melbourne's AEST or AEDT, Bali's WITA: each
 *  zone's name in its own country's words) */
const ZONE_WORDS: Record<string, string> = { [MEL]: 'en-AU', [BALI]: 'id-ID' };
const clock = (t: number, zone: string) => {
  const hm = new Intl.DateTimeFormat('en-AU', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false }).format(t);
  const name = new Intl.DateTimeFormat(ZONE_WORDS[zone] ?? 'en-AU', { timeZone: zone, timeZoneName: 'short' }).formatToParts(t).find((p) => p.type === 'timeZoneName')?.value ?? '';
  return `${hm} ${name}`;
};
/** the jump's caption (a jump of the trip's clock, said): on the reel's own clock (shown 3.5 s of what plays, faded in
 *  and out over 0.4 s), so a recording made frame by frame has it as the screen does */
let jumpAt = -Infinity;
const jumpShown = () => { const a = played - jumpAt, k = a < 0 ? 0 : a < 0.4 ? a / 0.4 : a < 3.5 ? 1 : Math.max(0, 1 - (a - 3.5) / 0.4); caption.jump.style.opacity = String(k); };
/** the camera's own numbers a move is worked out from (a pose ahead of time: what loads ahead) */
const camInfo = () => { const c = w.camera; return { pose: c.pose, groundY: c.groundY, fov: c.fov, floor: (h: number) => c.pitchAt(h) }; };
/** each plan entry's move as played ahead of time (its pose at a moment, undamped: what loads ahead) */
const ahead = new WeakMap<Plan, Played>();
/** a shot's pose at its second τ (the trip's things where they will be then); null: not known */
function poseAtShot(s: Shot, τ: number): Pose | null {
  const timeMs = s.from + τ * s.rate * 1000;
  if (s.pose) return s.pose(w, Math.max(0, Math.min(1, τ / s.seconds)), timeMs).pose;
  const p = s.plan ?? []; let e = p[0]; for (const x of p) if (x.at <= τ) e = x;
  if (!e) return null;
  let sh = ahead.get(e); if (!sh) { sh = new Played(e.move, { seconds: e.seconds }); ahead.set(e, sh); }
  return sh.poseAt(Math.max(0, τ - e.at), w.moveWorld(), camInfo(), timeMs);
}
/** the shot's camera at its second t: the plan's moves begun as their seconds come (each from where the camera is) */
function direct(s: Shot, t: number): void {
  if (s.pose) { const r = s.pose(w, Math.min(1, t / s.seconds), w.timeMs); w.camera.place(r.pose, r.ground); return; }
  const p = s.plan ?? [];
  while (planI + 1 < p.length && p[planI + 1]!.at <= t + 1e-9) { const e = p[++planI]!; void w.play(e.move, { seconds: e.seconds }); }
}
function startShot(i: number, at = 0, hold = true): void {
  const s = seq[i]; if (!s) return;
  shotI = i; ended = false; planI = -1; w.camera.stop();
  if (hold && !w.recording && (i === 0 || REEL || !started)) {
    started = true;
    holding = true; w.setTime(new Date(s.from + at * s.rate * 1000), { rate: 0 });
    caption.where.textContent = `${s.title} · loading`;
    // (the camera at the shot's first moment, still: posed before the views load and again after)
    const pose = () => { const p = directing ? poseAtShot(s, at) : null; if (p) w.camera.jump(p); };
    pose();
    void (async () => {
      await w.prefetch(viewsOf(s), { depth: 2, timeout: REEL ? 30000 : 12000 });
      pose(); await w.settled({ timeout: REEL ? 30000 : 8000 }).catch(() => false);
      holding = false; if (RECORD) w.stop(); begin(s, i, at);
    })();
    return;
  }
  begin(s, i, at);
}
function begin(s: Shot, i: number, at: number): void {
  shotT0 = w.now - at * 1000;
  w.setTime(new Date(s.from + at * s.rate * 1000), { rate: s.rate });
  caption.where.textContent = s.title;
  caption.jump.textContent = s.jump ?? ''; jumpAt = s.jump ? played : -Infinity; jumpShown();
  // the views the flight will reach: their tiles loaded ahead (where their terms allow), from the take-off on (a
  // recording loads its own way ahead)
  const fl = seq.find((x) => x.name === 'flight' || x.name === 'globe');
  if (!w.recording && fl && (s === fl || seq[i + 1] === fl)) void w.prefetch(viewsOf(fl), { depth: 2, timeout: 60000 });
  if (directing) direct(s, at);
  w.log('shot', { name: s.name, from: new Date(s.from).toISOString(), rate: s.rate });
}
/** the views a shot passes through (its camera at eight moments, the trip's things where they will be then) */
function viewsOf(shot: Shot): Pose[] {
  const out: Pose[] = [];
  for (let k = 0; k <= 1.0001; k += 1 / 7) { const p = poseAtShot(shot, k * shot.seconds); if (p) out.push(p); }
  return out;
}
/** the sequence's pose at its second t (the shot it falls in): the recorder's way ahead */
function poseAtSequence(t: number): Pose | null {
  let i = 0; while (i + 1 < seq.length && t >= seq[i]!.seconds) t -= seq[i++]!.seconds;
  const s = seq[i]; return s ? poseAtShot(s, Math.min(t, s.seconds)) : null;
}
// (&at=seconds into the sequence: the shot it falls in, that far into it)
const AT0 = Number(q.get('at') ?? 0) || 0;
{ let at = AT0, i = 0; while (i + 1 < seq.length && at >= seq[i]!.seconds) at -= seq[i++]!.seconds; if (seq.length) startShot(i, at, true); }
// (&view=lon,lat,zoom,tilt,bearing: a still view of your own, the trip's clock going on: a look round)
const own = q.get('view')?.split(',').map(Number);
if (own && own.length >= 3) { directing = false; w.go({ lon: own[0]!, lat: own[1]!, zoom: own[2]!, tilt: own[3] ?? 0, bearing: own[4] ?? 0 }); }
w.everyFrame((_s, dt) => {
  const s = seq[shotI]; if (!s) return;
  // (holding: the shot's first moment, still)
  if (holding) return;
  played += dt / 1000;
  const t = (w.now - shotT0) / 1000;
  if (t >= s.seconds && shotI + 1 < seq.length) { startShot(shotI + 1); return; }
  // (the last shot played: the trip's clock stops there, the camera rests on its last moment; the sea goes on)
  if (t >= s.seconds && w.timeRate !== 0 && !ended) { ended = true; w.setTimeRate(0); w.camera.stop(); }
  // a person's hands take the camera: the trip goes on, the camera is theirs
  if (w.camera.touches !== touches) { directing = false; w.camera.stop(); }
  if (directing && !ended) { const c0 = performance.now(); direct(s, Math.min(t, s.seconds)); cameraMs = cameraMs * 0.95 + (performance.now() - c0) * 0.05; }
  caption.when.textContent = `${clock(w.time.getTime(), s.zone)}${s.rate !== 1 ? ` · ×${s.rate >= 100 ? Math.round(s.rate / 100) * 100 : Math.round(s.rate * 10) / 10}` : ''}`;
  jumpShown();
}, { before: true, fps: 0 });

// ── the panel: the shots, the graphics, the build ──
const link = (k: string) => { const u = new URLSearchParams(q); u.set('go', k); return `?${u}`; };
let fps = 0, frames = 0, t0 = performance.now(), mainMs = 0;
w.on('frame', () => { frames++; const t = performance.now(); if (t - t0 > 1000) { fps = (frames * 1000) / (t - t0); frames = 0; t0 = t; mainMs = w.stats().cpuMs ?? 0; } });
const panel = () => {
  $('#panel').innerHTML = `<div><b>journey</b> · build ${BUILD} · <span class="${w.graphicsApi}">${w.graphicsApi === 'webgpu' ? 'WebGPU' : 'WebGL2'}</span> · ${fps.toFixed(0)} fps · ${mainMs.toFixed(1)} ms · ${w.level ?? ''}</div>`
    + `<div class="shots">${SHOTS.map((k) => `<a href="${link(k)}" class="${k === go ? 'on' : ''}">${k}</a>`).join('')}</div>`
    + (errors.length ? `<div class="err">${esc(errors.slice(-4).join('\n'))}</div>` : '');
};
setInterval(panel, 500); panel();
// (for the tools: the world, the trip's times and the logs)
// (a recorder: `await aslnutDemo.next()` for each frame of the sequence: w.record's (the world's clock one step of
// &clock's fps a frame, each frame held at its moment until every tile of it is in, the sequence's way loaded ahead),
// the frame's pixels back; null when the sequence has played)
const total = seq.reduce((a, s) => a + s.seconds, 0);
let rec: AsyncGenerator<RecordedFrame, void, void> | null = null;
async function next(): Promise<(RecordedFrame & { shot: string | null; played: number }) | null> {
  const fps = Number(q.get('clock')) || 30;
  // (from where the sequence is now: what played before the first frame is not recorded again)
  if (!rec) { const p0 = AT0 + played; rec = w.record({ fps, frames: Math.max(0, Math.round((total - p0) * fps)), path: (t) => poseAtSequence(p0 + t), timeout: 60000 }); }
  const r = await rec.next();
  if (r.done) return null;
  return { ...r.value, shot: seq[shotI]?.name ?? null, played };
}
Object.assign(window, { aslnutDemo: { w, T, TL, shots: seq.map((s) => ({ name: s.name, seconds: s.seconds, from: s.from, rate: s.rate })), startShot, next, get holding() { return holding; }, get shot() { return seq[shotI]?.name ?? null; }, get played() { return played; }, get cameraMs() { return cameraMs; }, lib: { moves, move, lookAt, track, history } } });
