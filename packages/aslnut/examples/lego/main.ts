import { presetOf } from '../preset.ts';
// The lego page: the bricks of one interface for one thing, each in a scene the tools open (tools/lego.mjs), on
// WebGPU and WebGL2. Not a demo: it uses the public API as an app would and reads a few counts back.
//   ?go=size      the size rule: points, a line, an arc, quads and shapes in metres kept within a range of CSS px
//   ?go=levels    a farm of turbines (instances) and 400 cars on rings (a set moved by its log): their levels by the
//                 pixels each covers, kept within a margin while the camera wobbles at an edge
//   ?go=joints    1,000 turbines whose rotors turn by their joints (each its own rate), one stopped by one write
//   ?go=emit      stacks with smoke attached at their tops (copies over time: white triangles rising, fading, looping)
//   ?go=measure   an empty flat world the measures fill (clones, builds, moving parts, a zoom step's cost, the camera
//                 moving over 10k clones of many forms)
//   ?go=cars      every row of the car side by side (each a row of numbers: presets.json), the camera going slowly
//                 round them; &level=0 | 1 | 2 each drawn at that level (whole, simple, far), &orbit=0 still
//   ?go=hitch     a tractor and its trailer driving a loop (a set moved by its log): the trailer turned at its fifth
//                 wheel by the log's value from the track (cars.hitch), its axles' own track drawn inside the tractor's
//   &graphics=webgpu | webgl2   &clock=30 (the tools: a fixed step)
import { arc, color, controllers, custom, drive, earth, entities, entity, entityElement, history, imagery, line, num, points, shape, text, world, type World } from '../../src/index.ts';
import { cars } from '../../src/modules/presets/vehicles/index.ts';

declare const __BUILD__: number;
const q = new URLSearchParams(location.search), go = presetOf(q, ['size', 'levels', 'joints', 'emit', 'measure', 'cars', 'hitch'], 'size');
const graphics = (q.get('graphics') ?? 'auto') as 'auto' | 'webgpu' | 'webgl2';
const AT: [number, number] = [145.13, -37.91];
const KZ = 110574, kx = 111320 * Math.cos((AT[1] * Math.PI) / 180);
/** metres east / south of the middle → [lon, lat] */
const ll = (x: number, z: number): [number, number] => [AT[0] + x / kx, AT[1] - z / KZ];
const plain = imagery.custom({ id: 'plain', attribution: '', draw: (g: CanvasRenderingContext2D) => { g.fillStyle = '#4c5a46'; g.fillRect(0, 0, 256, 256); return true; } } as never);
const asphalt = imagery.custom({ id: 'asphalt', attribution: '', draw: (g: CanvasRenderingContext2D) => { g.fillStyle = '#5b6064'; g.fillRect(0, 0, 256, 256); return true; } } as never);

// a wind turbine as an app (or an agent) writes it: a tower, a nacelle, a rotor of three tapered blades as a part on
// its hub; three levels: whole, simple (the same build, fewer sides), far (its own symbol: a mast and a bar)
export const turbine = shape({
  id: 'turbine',
  params: { height: num(60, 140, 90), blade: num(20, 60, 40), paint: color('#eef0f2') },
  build: (b, p) => {
    const H = p.height, hub: [number, number, number] = [0, H + 1.5, 3.6];
    b.lathe([[0, 0], [2.2, 0], [1.3, H], [0, H]], { color: p.paint });
    b.group('nacelle', (b) => b.solid('box', { size: [3, 3, 9], at: [0, H + 1.5, -0.8], color: p.paint, round: 0.5 }));
    b.anchor('hub', hub);
    b.part('rotor', (b) => {
      b.solid('sphere', { radius: 1.3, at: hub, color: p.paint });
      for (let i = 0; i < 3; i++) {
        const a = (i * 2 * Math.PI) / 3, tip: [number, number, number] = [Math.cos(a) * p.blade, hub[1] + Math.sin(a) * p.blade, hub[2] + 0.4];
        b.sweep({ rect: [1.8, 0.35] }, [hub, tip], { scale: [1, 0.25], color: p.paint });
      }
    }, { pivot: hub, joint: { kind: 'hinge', axis: 'z' } });
  },
  simple: true,
  far: (b, p) => { b.solid('box', { size: [2.5, p.height, 2.5], at: [0, p.height / 2, 0], color: p.paint }); b.solid('box', { size: [p.blade * 2, 2, 1], at: [0, p.height + 1.5, 3.6], color: p.paint }); },
});
// a rotor alone (before the joints: the only way to turn a turbine's rotor was its own instance, turned by the app each
// frame, round the vertical only)
const rotor = shape({ id: 'rotor', params: {}, build: (b) => { b.solid('sphere', { radius: 1.3, at: [0, 1.5, 0] }); for (let i = 0; i < 3; i++) { const a = (i * 2 * Math.PI) / 3; b.sweep({ rect: [1.8, 0.35] }, [[0, 1.5, 0], [Math.cos(a) * 30, 1.5, Math.sin(a) * 30]], { scale: [1, 0.25] }); } } });
/** points scattered in a square of `side` metres (a seeded random) */
const feats = (n: number, side = 3000, seed = 1) => { let s = (seed * 2654435761) >>> 0 || 1; const r = () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; return Array.from({ length: n }, (_, i) => ({ id: `t${i}`, props: { kind: 'turbine' }, geometry: { type: 'Point' as const, coordinates: ll((r() - 0.5) * side, (r() - 0.5) * side) } })); };
const cacheOf = (s: unknown) => (s as { cache: Map<string, unknown> }).cache;
let w: World;
let prepared: ReturnType<typeof feats> | null = null;

// ── the size rule's scene: each mark in its own colour (the tool reads the pixels) ──
const SIZE = { points: 40, line: 12, arc: 6, quad: 50 } as const;
const POINTS = [-300, -100, 100, 300].flatMap((x) => [-300, 300].map((z) => ll(x, z)));
/** the label in metres: well north of the marks (seen alone, centred, by labelSteps) */
const LABEL = ll(0, 2500);
async function sizeScene(): Promise<void> {
  w.add(points({ id: 'pts', data: POINTS.map((at, i) => ({ id: `p${i}`, at })), size: { m: SIZE.points, min: 4, max: 32 }, color: '#ff00ff', outline: { width: 0 }, drape: 'above' }));
  w.add(line({ id: 'road', data: [{ id: 'r', props: {}, geometry: { type: 'LineString', coordinates: [ll(-2000, 0), ll(2000, 0)] } }] as never, width: { m: SIZE.line, min: 1, max: 60 }, color: '#00ffff', drape: false, lift: 0.5 }));
  w.add(arc({ id: 'flow', data: [{ id: 'a' }], from: () => ll(-150, -150), to: () => ll(150, -150), height: 40, width: { m: SIZE.arc, min: 1.5, max: 24 }, color: '#ffff00' }));
  w.add(custom({ id: 'quads', data: [ll(-150, 150), ll(150, 150)], at: (d: [number, number]) => d, shape: 'ground', size: { m: SIZE.quad, min: 6, max: 40 }, fragment: 'color = vec4f(1.0, 0.5, 0.0, 1.0);', blend: 'alpha' }));
  w.add(text({ id: 'names', data: [{ id: 'n', at: LABEL }] as never, at: (d: { at: [number, number] }) => d.at, text: () => 'Lego', size: { m: 30, min: 9, max: 22 }, color: '#ffffff' }));
  // (shapes in their range: well away from the marks, which they would cover far out)
  w.add(entities({ id: 'farm', shape: turbine, data: feats(12, 1600, 3).map((f) => ({ ...f, geometry: { ...f.geometry, coordinates: [f.geometry.coordinates[0] + 9000 / kx, f.geometry.coordinates[1]] as [number, number] } })), size: { min: 20, max: 80 } }));
}

// ── the levels' scene: turbines as instances, cars as a set on rings round the middle (their log: 10 min of samples) ──
const EPOCH = Date.UTC(2026, 0, 15, 2, 0, 0);
async function levelsScene(): Promise<void> {
  w.add(entities({ id: 'farm', shape: turbine, data: feats(300, 2400, 5), variation: { seed: (d) => d.id as string, builds: 4 } }));
  const log = history.log({ keep: Infinity }), rows = [];
  for (let i = 0; i < 400; i++) {
    const r = 60 + (i % 20) * 9, a0 = i * 2.4, v = (8 + (i % 7)) / r;
    for (let t = 0; t <= 600; t += 10) { const a = a0 + v * t; rows.push({ id: `c${i}`, t: EPOCH + t * 1000, lon: ll(Math.cos(a) * r, Math.sin(a) * r)[0], lat: ll(Math.cos(a) * r, Math.sin(a) * r)[1] }); }
  }
  log.appendMany(rows);
  w.add(entities({ id: 'cars', drive: drive.data(log), shape: cars.make({ type: 'hatch' }), trail: false, color: '#e8e8e8' }));
  w.setTime(new Date(EPOCH + 120000));
}

// ── the joints' scene: turbines whose rotors turn by their joints, each at its own rate (a function of the clone) ──
async function jointsScene(n = 1000, side = 4000): Promise<void> {
  // (each its own tower's height: a stretch its rotor rides along, round)
  w.add(entities({ id: 'farm', shape: turbine, data: feats(n, side, 9), variation: { seed: (d) => d.id as string, builds: 4 }, stretch: (d) => 0.7 + (Number(String(d.id).slice(1)) % 5) * 0.15, joints: { rotor: (d) => ({ rate: 8 + (Number(String(d.id).slice(1)) % 7), unit: 'rpm' }) } }));
  // carts of a set moved by a log that keeps their travel (north of the farm, 5 m/s east): every wheel rolls by it
  const log = history.log({ keep: Infinity, travel: true }), rows = [];
  for (let i = 0; i < 6; i++) for (let t = 0; t <= 600; t += 10) { const at = ll(ROLL[0] + 5 * t, ROLL[1] + i * 6); rows.push({ id: `r${i}`, t: EPOCH + t * 1000, lon: at[0], lat: at[1] }); }
  log.appendMany(rows);
  w.add(entities({ id: 'rollers', drive: drive.data(log), shape: cart.make(), trail: false, color: '#e8e8e8', near: { levels: { full: 20, simple: 8 } }, joints: { wheel: { value: 'travel' } } }));
  w.setTime(new Date(EPOCH + 120000));
}
/** a cart whose two wheels show how far they have turned (a spoke across each: a wheel alone looks the same at any
 *  angle) */
const cart = shape({ id: 'cart', build: (b) => {
  b.solid('box', { size: [1.6, 0.5, 3], at: [0, 0.9, 0], color: '#c9ccd0' });
  for (const z of [1, -1]) b.part(z > 0 ? 'front' : 'rear', (b) => { b.solid('cylinder', { radius: 0.6, size: 1.9, axis: 'x', at: [0, 0.6, z], color: '#24272b' }); b.solid('box', { size: [2, 1.3, 0.25], at: [0, 0.6, z], color: '#ff4d2e' }); }, { pivot: [0, 0.6, z], joint: { kind: 'wheel', axis: 'x', radius: 0.6 } });
} });
/** where the rolling cars start (m east, south of the middle) */
const ROLL: [number, number] = [-1500, -2600];

// ── copies over time: smoke (the app's own effect) attached at each stack's top ──
const smoke = shape({ id: 'smoke', build: (b) => b.copy((b) => b.mesh([[-0.7, 0, 0], [0.7, 0, 0], [0, 1.2, 0]], { color: '#f4f4f2' }), { emit: { count: [28, 10, 0], life: 5, rise: 34, spread: 7, grow: 3, fade: [0.75, 0], drift: [9, 2] } }) });
const stack = shape({ id: 'stack', params: { h: num(30, 80, 50) }, build: (b, p) => { b.lathe([[0, 0], [3, 0], [2.2, p.h], [0, p.h]], { color: '#b7b1a8' }); b.anchor('top', [0, p.h, 0], { kind: 'stack' }); }, simple: true, far: (b, p) => b.solid('box', { size: [4, p.h, 4], at: [0, p.h / 2, 0], color: '#b7b1a8' }) });
// ── the cars: every row side by side, their fronts on one line; a tractor and its trailer on a loop ──
const LINEUP: string[] = ['hatch', 'crossover', 'sedan', 'wagon', 'suv', 'pickup', 'van', 'truck', 'bus', 'citybus', 'tractor'];
/** each row's place (m east, south of the middle), its made shape */
const lineup: { type: string; x: number; z: number; made: ReturnType<typeof cars.make> }[] = [];
async function carsScene(): Promise<void> {
  const L = q.get('level'), pin = L === '0' || L === '1' || L === '2' ? Number(L) : null;
  let x = 0;
  for (const type of LINEUP) {
    const m = cars.make({ type }), wide = m.bounds[1][0] - m.bounds[0][0];
    lineup.push({ type, x: x + wide / 2, z: m.bounds[1][2], made: m }); x += wide + 1.6;
  }
  for (const r of lineup) r.x -= x / 2;
  // (a level pinned: each row drawn at that level wherever the camera is)
  const shown = (m: ReturnType<typeof cars.make>) => (pin === null ? m : { ...m, levels: [m.levels[pin]!, m.levels[pin]!, m.levels[pin]!] });
  for (const r of lineup) w.add(entities({ id: `car-${r.type}`, shape: shown(r.made) as never, data: [{ id: r.type, props: {}, geometry: { type: 'Point' as const, coordinates: ll(r.x, r.z) } }] }));
  // (a morning's low sun: their shapes modelled by it)
  w.setTime(new Date(EPOCH - 4.5 * 3600e3));
  // (the camera allowed close: a car a few metres away)
  w.control(null, controllers.orbit({ zoomRange: [8, 24.5] }));
  if (q.get('orbit') !== '0') { const t0 = performance.now(); w.everyFrame(() => w.go({ lon: AT[0], lat: AT[1], dist: 46, tilt: 62, bearing: (200 + ((performance.now() - t0) / 1000) * 6) % 360 } as never), { fps: 60 }); }
}
/** the tractor's loop: its corners (m east, south; rounded to a 16 m turn), driven at 7 m/s, lap after lap; its
 *  trailer's axles' track */
const LOOP: [number, number][] = [[-70, -35], [70, -35], [70, 5], [30, 35], [-70, 35]];
const axleTrack: [number, number][][] = [];
async function hitchScene(): Promise<void> {
  const tractor = cars.tractor.make(), rows: { id: string; t: number; lon: number; lat: number }[] = [];
  let t = 0, prev = LOOP[0]!;
  for (let lap = 0; lap < 12; lap++) for (const c of [...LOOP.slice(1), LOOP[0]!]) { t += Math.hypot(c[0] - prev[0], c[1] - prev[1]) / 7; const at = ll(c[0], c[1]); rows.push({ id: 'rig', t: EPOCH + t * 1000, lon: at[0], lat: at[1] }); prev = c; }
  rows.unshift({ id: 'rig', t: EPOCH, lon: ll(LOOP[0]![0], LOOP[0]![1])[0], lat: ll(LOOP[0]![0], LOOP[0]![1])[1] });
  const log = history.log({ keep: Infinity, values: { hitch: 'f32' } });
  log.appendMany(cars.hitch(rows, tractor, { radius: 16, axles: (_, a) => axleTrack.push(a) }));
  w.add(line({ id: 'axles', data: axleTrack.map((c, i) => ({ id: `a${i}`, props: {}, geometry: { type: 'LineString' as const, coordinates: c } })) as never, width: 2, color: '#ffb347', drape: false, lift: 0.08 }));
  w.add(entities({ id: 'rig', drive: drive.data(log), shape: tractor, trail: { seconds: 40, width: 3, color: '#7cc4ff' }, color: '#e8e8e8', near: { pixels: 0 }, joints: { trailer: { value: 'hitch' } } }));
  w.setTime(new Date(EPOCH + 30000));
}
async function emitScene(): Promise<void> {
  w.add(entities({ id: 'stacks', shape: stack, data: feats(16, 900, 4), params: (d) => ({ h: 30 + (Number(String(d.id).slice(1)) % 5) * 10 }), attach: [{ shape: smoke, at: 'stack' }] }));
}

const lego = {
  ready: false, go,
  async init() {
    const view = go === 'cars' ? { lon: AT[0], lat: AT[1], dist: 46, tilt: 62, bearing: 200 } : go === 'hitch' ? { lon: AT[0], lat: AT[1], dist: 150, tilt: 55, bearing: 0 } : { lon: AT[0], lat: AT[1], zoom: go === 'size' ? 15 : 14.2, tilt: go === 'size' ? 0 : 45, bearing: 0 };
    w = await world(document.querySelector('#view') as HTMLCanvasElement, { graphics, body: earth({ imagery: [go === 'cars' || go === 'hitch' ? asphalt : plain], terrain: [], base: null, sky: false } as never), view, budget: false, controls: true, clock: q.get('clock') ? { fps: Number(q.get('clock')) } : 'real' });
    (window as unknown as { w: World }).w = w;
    if (go === 'size') await sizeScene();
    if (go === 'levels') await levelsScene();
    if (go === 'joints') await jointsScene();
    if (go === 'emit') await emitScene();
    if (go === 'cars') await carsScene();
    if (go === 'hitch') await hitchScene();
    await w.settled({ timeout: 60000 });
    lego.ready = true;
    document.querySelector('#bar')!.innerHTML = ['size', 'levels', 'joints', 'emit', 'measure', 'cars', 'hitch'].map((k) => `<a href="?go=${k}${q.get('graphics') ? `&graphics=${q.get('graphics')}` : ''}" class="${k === go ? 'on' : ''}">${k}</a>`).join('');
    document.querySelector('#note')!.textContent = `lego · ${go} · ${(w as unknown as { api: string }).api} · build ${typeof __BUILD__ === 'number' ? __BUILD__ : 0}`;
    return { api: (w as unknown as { api: string }).api };
  },
  /** the camera wobbling round a zoom (± amp, `frames` frames at the fixed clock): how many instances and things
   *  changed level, with the levels' margin as given */
  async wobble(zoom: number, amp: number, frames: number, margin: number) {
    const farm = w.element('farm') as unknown as { setProps(p: object): void; levelChanges: number }, set = w.element('cars') as unknown as { setProps(p: object): void; levelChanges: number; readouts(): { levels(): string } };
    farm.setProps({ pixels: { margin } }); set.setProps({ near: { levels: { margin } } });
    w.go({ lon: AT[0], lat: AT[1], zoom, tilt: 50, bearing: 20 } as never); await w.settled({ timeout: 60000 });
    for (let i = 0; i < 4; i++) await new Promise((ok) => requestAnimationFrame(() => ok(null)));
    const f0 = farm.levelChanges, s0 = set.levelChanges, levels0 = set.readouts().levels();
    for (let i = 0; i < frames; i++) {
      w.go({ lon: AT[0], lat: AT[1], zoom: zoom + amp * Math.sin((i / frames) * Math.PI * 8), tilt: 50, bearing: 20 } as never);
      await new Promise((ok) => requestAnimationFrame(() => ok(null)));
    }
    return { zoom, amp, margin, farm: farm.levelChanges - f0, cars: set.levelChanges - s0, levels: levels0 };
  },
  /** a budget no frame meets, the stacks dropped first: what the governor dropped (in order), the smoke's copies kept
   *  then (the stacks' detail: their share); then no budget: all of it back */
  async priorities() {
    const stacks = w.element('stacks')!, frame = () => new Promise((ok) => requestAnimationFrame(() => ok(null)));
    w.setPriorities({ drop: ['stacks'], keep: ['quality'] }); w.setBudget({ drawCalls: 1 });
    const stop = w.everyFrame(() => {}, { fps: 60 });
    let dropped: string[] = [];
    for (let i = 0; i < 600 && !(dropped.includes('detail 0.5')); i++) { await frame(); dropped = w.governor?.dropped ?? []; }
    const share = stacks.detailOf((w as unknown as { state: Parameters<typeof stacks.detailOf>[0] }).state), shown = stacks.shown > 0.99;
    w.setBudget(null); for (let i = 0; i < 60; i++) await frame(); stop();
    return { dropped, share, shown, back: stacks.detailOwn === 1 && !w.governor };
  },
  /** two frames `ms` apart at a view: how many pixels changed (parts turning) */
  async framesApart(ms: number, view?: { zoom: number; tilt: number; bearing: number; lon?: number; lat?: number }) {
    if (view) { w.go({ lon: view.lon ?? AT[0], lat: view.lat ?? AT[1], zoom: view.zoom, tilt: view.tilt, bearing: view.bearing } as never); await w.settled({ timeout: 60000 }); }
    const a = await w.frame({ attribution: false }); await new Promise((ok) => setTimeout(ok, ms)); w.invalidate(); await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(() => ok(null))));
    const b = await w.frame({ attribution: false }); let d = 0;
    for (let i = 0; i < a.pixels.length; i += 4) if (Math.abs(a.pixels[i]! - b.pixels[i]!) + Math.abs(a.pixels[i + 1]! - b.pixels[i + 1]!) + Math.abs(a.pixels[i + 2]! - b.pixels[i + 2]!) > 24) d++;
    return d;
  },
  /** every rotor at a rate (0: stopped), or one clone's (`id`): one write */
  jointRate(rate: number, id?: string) { const f = w.element('farm') as unknown as { joint(...a: unknown[]): unknown }; if (id) f.joint(id, 'rotor', { rate, unit: 'rpm' }); else f.joint('rotor', { rate, unit: 'rpm' }); return true; },
  /** the rolling carts at one time, seen close (from their side): their wheels rolled by their travel (× 1), not rolled (× 0), and rolled
   *  again (× 1): how many pixels changed between the first and each other */
  async rollers() {
    const set = w.element('rollers') as unknown as { joint(n: string, d: unknown): unknown }, at = ll(ROLL[0] + 5 * 120, ROLL[1] + 15);
    w.go({ lon: at[0], lat: at[1], zoom: 21.5, tilt: 70, bearing: 0 } as never);
    const shot = async () => { await w.settled({ timeout: 60000 }); for (let i = 0; i < 3; i++) await new Promise((ok) => requestAnimationFrame(() => ok(null))); return w.frame({ attribution: false }); };
    const diff = (a: { pixels: Uint8Array }, b: { pixels: Uint8Array }) => { let d = 0; for (let i = 0; i < a.pixels.length; i += 4) if (Math.abs(a.pixels[i]! - b.pixels[i]!) + Math.abs(a.pixels[i + 1]! - b.pixels[i + 1]!) + Math.abs(a.pixels[i + 2]! - b.pixels[i + 2]!) > 24) d++; return d; };
    const a = await shot(); set.joint('wheel', { value: 'travel', per: 0 }); w.invalidate();
    const b = await shot(); set.joint('wheel', { value: 'travel', per: 1 }); w.invalidate();
    const c = await shot();
    return { unrolled: diff(a, b), again: diff(a, c) };
  },
  /** a clone's joint values as its record holds them (its rate rad/s and phase) */
  jointOf(id: string) {
    const f = w.element('farm') as unknown as { whereOf(id: string): [string, number, number] | undefined; recordsOf(k: string, s: number): { rec: Float32Array; stride: number } | null };
    const at = f.whereOf(id); if (!at) return null; const r = f.recordsOf(at[0], at[1])!; const o = at[2] * r.stride * 4 + 12; return [r.rec[o]!, r.rec[o + 1]!];
  },
  gpuMB: () => ((w as unknown as { graphics: { bytes: number } }).graphics.bytes / 1048576),
  /** the cars' line-up: a row framed by the camera (its middle; `dist` m away, `tilt`, `bearing` from north), alone
   *  (the others hidden) when asked, settled */
  async carView(type: string, v: { dist: number; tilt: number; bearing: number; alone?: boolean }) {
    const r = lineup.find((x) => x.type === type)!, b = r.made.bounds, mz = r.z - (b[0][2] + b[1][2]) / 2;
    for (const o of lineup) { if (o.type === type || !v.alone) w.reveal(`car-${o.type}`, { seconds: 0 }); else w.hide(`car-${o.type}`, { seconds: 0 }); }
    // (the camera aims at its middle height: the ground point that line meets behind it)
    const up = (b[1][1] - b[0][1]) / 2, past = up * Math.tan((Math.min(85, v.tilt) * Math.PI) / 180), a = (v.bearing * Math.PI) / 180, at = ll(r.x + Math.sin(a) * past, mz - Math.cos(a) * past);
    w.go({ lon: at[0], lat: at[1], dist: v.dist + Math.hypot(past, up), tilt: v.tilt, bearing: v.bearing } as never);
    await w.settled({ timeout: 60000 }); for (let i = 0; i < 3; i++) await new Promise((ok) => requestAnimationFrame(() => ok(null)));
    return { type, length: b[1][2] - b[0][2] };
  },
  /** each row drawn: alone, near and farther, the share of the frame's middle it changes (shown against hidden) */
  async carsDrawn() {
    const diff = (a: { pixels: Uint8Array }, b: { pixels: Uint8Array }) => { let d = 0; for (let i = 0; i < a.pixels.length; i += 4) if (Math.abs(a.pixels[i]! - b.pixels[i]!) + Math.abs(a.pixels[i + 1]! - b.pixels[i + 1]!) + Math.abs(a.pixels[i + 2]! - b.pixels[i + 2]!) > 24) d++; return d / (a.pixels.length / 4); };
    const frame = async () => { w.invalidate(); for (let i = 0; i < 3; i++) await new Promise((ok) => requestAnimationFrame(() => ok(null))); return w.frame({ attribution: false }); };
    const out: { type: string; shares: number[] }[] = [];
    for (const r of lineup) {
      const len = r.made.bounds[1][2] - r.made.bounds[0][2], shares: number[] = [];
      for (const k of [1.6, 6]) {
        await lego.carView(r.type, { dist: len * k, tilt: 75, bearing: 135, alone: true }); const a = await frame();
        w.hide(`car-${r.type}`, { seconds: 0 }); const b = await frame(); w.reveal(`car-${r.type}`, { seconds: 0 });
        shares.push(Math.round(diff(a, b) * 1000) / 1000);
      }
      out.push({ type: r.type, shares });
    }
    return out;
  },
  /** the tractor's trailer at the moment it turns most on its first lap, seen from above: its log's angle there, the
   *  pixels that change when its hinge is not driven (× 0) and when it is again (× 1) */
  async hitchTurn() {
    const set = w.element('rig') as unknown as { joint(n: string, d: unknown): unknown; log: { at(id: string, t: number): { lon: number; lat: number; values: Record<string, number> } | null } };
    let best = { s: 0, v: 0 };
    for (let s = 5; s < 60; s += 0.5) { const st = set.log.at('rig', EPOCH + s * 1000), v = st?.values.hitch ?? 0; if (Math.abs(v) > Math.abs(best.v)) best = { s, v }; }
    w.setTime(new Date(EPOCH + best.s * 1000), { rate: 0 });
    const st = set.log.at('rig', EPOCH + best.s * 1000)!;
    w.go({ lon: st.lon, lat: st.lat, dist: 45, tilt: 15, bearing: 0 } as never);
    const shot = async () => { await w.settled({ timeout: 60000 }); w.invalidate(); for (let i = 0; i < 3; i++) await new Promise((ok) => requestAnimationFrame(() => ok(null))); return w.frame({ attribution: false }); };
    const diff = (a: { pixels: Uint8Array }, b: { pixels: Uint8Array }) => { let d = 0; for (let i = 0; i < a.pixels.length; i += 4) if (Math.abs(a.pixels[i]! - b.pixels[i]!) + Math.abs(a.pixels[i + 1]! - b.pixels[i + 1]!) + Math.abs(a.pixels[i + 2]! - b.pixels[i + 2]!) > 24) d++; return d; };
    const a = await shot(); set.joint('trailer', { value: 'hitch', per: 0 });
    const b = await shot(); set.joint('trailer', { value: 'hitch', per: 1 });
    const c = await shot();
    return { at: best.s, hitch: Math.round(best.v * 10) / 10, straightened: diff(a, b), again: diff(a, c) };
  },
  /** each row: its triangles at each level, its build's ms (first, then a cache hit) */
  carRows() {
    return LINEUP.map((type) => {
      cacheOf(cars.shape).clear();
      const t0 = performance.now(), m = cars.make({ type }), first = performance.now() - t0, t1 = performance.now(); cars.make({ type }); const hit = performance.now() - t1;
      return { type, triangles: m.triangles, ms: Math.round(first * 10) / 10, hitMs: Math.round(hit * 1000) / 1000 };
    });
  },
  /** the size rule seen: at a zoom (looking straight down), each mark's size on screen against the rule's own answer */
  async sizeAt(zoom: number) {
    w.go({ lon: AT[0], lat: AT[1], zoom, tilt: 0, bearing: 0 } as never);
    await w.settled({ timeout: 60000 });
    for (let i = 0; i < 3; i++) await new Promise((ok) => requestAnimationFrame(() => ok(null)));
    const f = await w.frame({ attribution: false }), dpr = f.width / w.camera.width, mpp = w.camera.pixelSize;
    const px = (x: number, y: number) => { const i = (Math.round(y) * f.width + Math.round(x)) * 4; return [f.pixels[i]!, f.pixels[i + 1]!, f.pixels[i + 2]!]; };
    const is = (c: number[], want: number[]) => Math.abs(c[0]! - want[0]!) < 70 && Math.abs(c[1]! - want[1]!) < 70 && Math.abs(c[2]! - want[2]!) < 70;
    /** how far the colour runs from a place along x (or y), both ways, CSS px */
    const run = (at: [number, number], want: number[], dir: 'x' | 'y') => {
      const xy = w.project(at); if (!xy) return 0;
      const cx = xy[0] * dpr, cy = xy[1] * dpr; let n = 0;
      for (const s of [-1, 1]) for (let k = s > 0 ? 0 : 1; k < 400; k++) { const x = dir === 'x' ? cx + s * k : cx, y = dir === 'y' ? cy + s * k : cy; if (x < 0 || y < 0 || x >= f.width || y >= f.height || !is(px(x, y), want)) break; n++; }
      return n / dpr;
    };
    const rule = (m: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, m / mpp));
    const pts = POINTS.map((p) => run(p, [255, 0, 255], 'x')).filter((v) => v > 0).sort((a, b) => a - b);
    return {
      zoom, mpp,
      points: { got: pts[Math.floor(pts.length / 2)] ?? 0, want: rule(SIZE.points, 4, 32) },
      line: { got: run(ll(200, 0), [0, 255, 255], 'y'), want: rule(SIZE.line, 1, 60) },
      quad: { got: run(ll(-150, 150), [255, 128, 0], 'x'), want: rule(SIZE.quad, 6, 40) },
      restepped: (w.element('names') as unknown as { restepped: number }).restepped,
    };
  },
  /** the label in metres while the camera zooms in over `frames` frames (from 16 to 18.5: from its least px to its most),
   *  then wobbling ± `amp` round the zoom where it is at a step's edge: how many times its picture was drawn again (a few
   *  in the zoom, once a step; at most once in the wobble: the step keeps within its margin) */
  async labelSteps(frames = 90, amp = 0.02) {
    const L = w.element('names') as unknown as { restepped: number }, frame = () => new Promise((ok) => requestAnimationFrame(() => ok(null)));
    const view = (zoom: number) => w.go({ lon: LABEL[0], lat: LABEL[1], zoom, tilt: 0, bearing: 0 } as never), from = 16, to = 18.5;
    view(from); await w.settled({ timeout: 60000 }); for (let i = 0; i < 3; i++) await frame();
    const r0 = L.restepped;
    for (let i = 1; i <= frames; i++) { view(from + ((to - from) * i) / frames); await frame(); }
    const r1 = L.restepped;
    // the zoom where its size wants a step and a half (8 steps a doubling: 8 a zoom)
    view(17.2); await frame(); const want = 8 * Math.log2(30 / w.camera.pixelSize), edge = 17.2 + (Math.floor(want) + 0.5 - want) / 8;
    view(edge); await frame(); await frame(); const r2 = L.restepped;
    for (let i = 0; i < frames; i++) { view(edge + amp * Math.sin((i / frames) * Math.PI * 8)); await frame(); }
    return { zoomIn: r1 - r0, wobble: L.restepped - r2, edge };
  },
  /** shape builds: a first build, a cache hit, n variants by seed (a car and the turbine) */
  builds(n = 40) {
    const t = (f: () => void) => { const t0 = performance.now(); f(); return performance.now() - t0; };
    cacheOf(cars.shape).clear(); cacheOf(turbine).clear();
    const carFirst = t(() => cars.make({ type: 'sedan' }, 1)), carHit = t(() => { for (let i = 0; i < 1000; i++) cars.make({ type: 'sedan' }, 1); }) / 1000;
    const carVariants = t(() => { for (let i = 2; i < 2 + n; i++) cars.make({ type: 'sedan' }, i); }) / n;
    const tFirst = t(() => turbine.make({}, 1)), tHit = t(() => { for (let i = 0; i < 1000; i++) turbine.make({}, 1); }) / 1000;
    const tVariants = t(() => { for (let i = 2; i < 2 + n; i++) turbine.make({ height: 60 + (i % 9) * 10 }, i); }) / n;
    return { carFirst, carHit, carVariants, turbineFirst: tFirst, turbineHit: tHit, turbineVariants: tVariants };
  },
  /** the shape caches emptied (before a clean heap reading) */
  clear() { cacheOf(turbine).clear(); cacheOf(cars.shape).clear(); },
  /** the app's data made first (its bytes are the app's, not the clones') */
  prep(n: number) { prepared = feats(n); return prepared.length; },
  /** n clones of one shape (a solids layer of instances), `builds` distinct seeded builds */
  async clones(n: number, builds = 1) {
    let made = 0; const make0 = turbine.make.bind(turbine); (turbine as unknown as { make: typeof turbine.make }).make = (p, s) => { made++; return make0(p, s); };
    const t0 = performance.now();
    const layer = entities({ id: 'farm', shape: turbine, data: prepared && prepared.length === n ? prepared : feats(n), variation: { seed: (d) => d.id as string, builds } });
    w.add(layer);
    await w.settled({ timeout: 120000 });
    (turbine as unknown as { make: typeof turbine.make }).make = make0;
    return { ms: performance.now() - t0, makes: made, cached: cacheOf(turbine).size, counts: (layer as unknown as { counts(): unknown }).counts() };
  },
  async remove(id: string) { w.remove(id); await w.settled({ timeout: 60000 }); },
  /** n clones of the turbine that all look different, with no build of their own: `builds` seeded builds, and each
   *  clone its colour (varied round its group's base), its nacelle's (its group's tint), its size and its tower's stretch, its
   *  heading, its rotor's own rate; `forms` blade lengths besides (0: none; each a build of its own geometry) */
  async variety(n: number, builds = 40, forms = 0) {
    let made = 0; const make0 = turbine.make.bind(turbine); (turbine as unknown as { make: typeof turbine.make }).make = (p, s) => { made++; return make0(p, s); };
    const num = (d: { id?: unknown }) => Number(String(d.id).slice(1)), owners = ['#eef0f2', '#e4ece6', '#f2ebe0'], nacelles = ['#2f6db5', '#c8452d', '#3c8f4f', '#e0b23a', '#6b4fa0'];
    const t0 = performance.now();
    const layer = entities({
      id: 'farm', shape: turbine, data: prepared && prepared.length === n ? prepared : feats(n),
      variation: { seed: (d) => d.id as string, builds, color: 0.12, scale: 0.15 },
      ...(forms ? { params: (d: { id?: unknown }) => ({ blade: 30 + (num(d) % forms) * (20 / forms) }) } : {}),
      tint: (d) => owners[num(d) % 3]!, tints: { nacelle: (d) => nacelles[(num(d) >> 2) % 5]! },
      stretch: (d) => 0.8 + ((num(d) * 37) % 41) / 100, heading: (d) => (num(d) * 47) % 360,
      joints: { rotor: (d) => ({ rate: 6 + ((num(d) * 13) % 90) / 10, unit: 'rpm' }) },
    });
    w.add(layer);
    await w.settled({ timeout: 120000 });
    (turbine as unknown as { make: typeof turbine.make }).make = make0;
    return { ms: performance.now() - t0, makes: made, cached: cacheOf(turbine).size, counts: (layer as unknown as { counts(): unknown }).counts() };
  },
  /** how many distinct looks the farm's records hold (the seed and phase aside), and the texels a clone */
  looks(n: number) {
    const L = w.element('farm') as unknown as { whereOf(id: string): [string, number, number] | undefined; recordsOf(k: string, s: number): { rec: Float32Array; stride: number } | null };
    const looks = new Set<string>();
    for (const f of (prepared && prepared.length === n ? prepared : feats(n))) {
      const at = L.whereOf(f.id); if (!at) continue; const r = L.recordsOf(at[0], at[1])!, o = at[2] * r.stride * 4, x = r.rec;
      // its scale and stretch, heading, colour, its groups' colours, its rotor's rate (not its seed or its phase)
      const k = [x[o + 4], x[o + 5], x[o + 7], x[o + 8], ...x.subarray(o + 12, o + 16), x[o + 16]].map((v) => v!.toFixed(4)).join(',');
      looks.add(k);
    }
    return { looks: looks.size, stride: (L.recordsOf(...(L.whereOf('t0')!.slice(0, 2) as [string, number])))!.stride };
  },
  /** points for a zoom step's cost: CSS px (the app restyles them on a zoom) or metres (the rule: nothing to restyle) */
  async pointsAdd(n: number, metres = false) { w.add(points({ id: 'pts', data: feats(n).map((f) => ({ id: f.id, at: f.geometry.coordinates })), size: metres ? { m: 30, min: 3, max: 24 } : 6, color: '#ffd166' })); await w.settled({ timeout: 60000 }); },
  /** one zoom step: CSS px points restyled by the app (a size rule of the zoom), or metres ones (none: the zoom alone) */
  async pointsResize(k: number, metres = false) {
    const L = w.element('pts') as unknown as { setProps(p: object): void }, t0 = performance.now();
    // the same zoom step for both: the camera moves; CSS px points are restyled by the app as well
    w.go({ lon: AT[0], lat: AT[1], zoom: 14 + k * 0.1, tilt: 45, bearing: 0 } as never); if (!metres) L.setProps({ size: () => 4 + k });
    const t1 = performance.now(); await w.settled({ timeout: 30000 }); return { setMs: t1 - t0, settleMs: performance.now() - t0 };
  },
  /** one zoom step on instances: a new scale for every clone (refresh: the chunks built again), or a size range (none) */
  async clonesRescale(k: number) { const L = w.element('farm') as unknown as { refresh(): void; ep: { scale?: () => number } }, t0 = performance.now(); L.ep.scale = () => 1 + k * 0.01; L.refresh(); const t1 = performance.now(); await w.settled({ timeout: 30000 }); return { refreshMs: t1 - t0, settleMs: performance.now() - t0 }; },
  /** n rotors turned by the app each frame (their own instances, their headings written) */
  async movers(n: number, move = true) {
    const made = rotor.make(), layer = entityElement({ id: 'movers' });
    for (const f of feats(n, 3000, 7)) layer.add(entity({ id: f.id, shape: made, at: f.geometry.coordinates as [number, number], heading: 0, ...(move ? { drive: { kind: 'script', want: (e: { heading: number; speed: number }, _i: unknown, dt: number) => { e.heading = (e.heading + 84 * dt) % 360; e.speed = 3; return { forward: 0, right: 0, up: 0, turn: 0, fast: false, jump: false }; } } } : {}) } as never));
    w.add(layer);
    await new Promise((ok) => setTimeout(ok, 1500));
    return { n: layer.list().length };
  },
  frames: () => (w as unknown as { renderer: { frames: number } }).renderer.frames,
  cpuMs: () => (w as unknown as { renderer: { cpuMs: number } }).renderer.cpuMs,
  /** keep frames coming without other work (a baseline at the same frame rate) */
  everyFrame() { return w.everyFrame(() => {}, { fps: 60 }); },
  /** the camera going round the middle (a turn in 8 s) and in and out (zoom 14.2 to 16.2 and back in 4 s) each frame:
   *  chunks come into the view and leave it, clones change level; stopped, the view as it was */
  moving() {
    const c = w.camera, v0 = { lon: c.lon, lat: c.lat, zoom: c.zoom, tilt: 90 - (c.pitch * 180) / Math.PI, bearing: ((-c.yaw * 180) / Math.PI + 360) % 360 }, t0 = performance.now();
    const stop = w.everyFrame(() => { const s = (performance.now() - t0) / 1000; w.go({ lon: AT[0], lat: AT[1], zoom: 15.2 - Math.cos((s * Math.PI) / 2), tilt: 52, bearing: (s * 45) % 360 } as never); }, { fps: 60 });
    return () => { stop(); w.go(v0 as never); };
  },
};
(window as unknown as { lego: typeof lego }).lego = lego;

// ?go=measure&run=10000 (&forms=40 &move=0): the measure run on its own, for a phone opened by hand: n clones that all
// look different (forms: blade lengths, each its own build), the camera going round unless move=0, and once a second the
// frame rate, the draws and the main thread's ms
async function selfRun(): Promise<void> {
  const n = Number(q.get('run') ?? 0), note = document.querySelector('#note')!, head = note.textContent ?? '';
  if (go !== 'measure') return;
  if (!(n > 0)) { note.textContent = `${head}\nempty: the tools fill it; add &run=10000 (&forms=40) to run it here`; return; }
  const forms = Number(q.get('forms') ?? 40);
  note.textContent = `${head}\nbuilding ${n.toLocaleString()} clones of ${forms} forms…`;
  lego.prep(n);
  const r = await lego.variety(n, 40, forms);
  if (q.get('move') !== '0') lego.moving();
  setInterval(() => {
    const t = w.telemetry() as unknown as { frames: { fps: number }; draws: number; cpuMs: number; frameP95: number };
    note.textContent = `${head}\n${n.toLocaleString()} clones · ${forms} forms · built in ${(r.ms / 1000).toFixed(1)} s\n${Math.round(t.frames.fps)} fps · ${t.draws} draws · ${t.cpuMs.toFixed(1)} ms main thread · p95 ${Math.round(t.frameP95)} ms`;
  }, 1000);
}
if (!q.has('manual')) void lego.init().then(selfRun);
