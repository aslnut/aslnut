import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera, Follower, springStep, moves, move, lookAt, track, keys, pitchFloor, tiltMaxAt, TILT_LIMIT } from '../src/core/observation/observers/orbit/index.ts';
import { TileSet, type Loaded } from '../src/modules/world/surface/tiles.ts';
import { AslnutError } from '../src/core/world/errors.ts';
import { world, earth, plane, history, controllers } from '../src/index.ts';

const D = Math.PI / 180, KZ = 6378137 * D, LON = 145, LAT = -37.8, KX = KZ * Math.cos(LAT * D);
const at = (x: number, y: number, up = 0) => ({ lon: LON + x / KX, lat: LAT + y / KZ, up });
const metres = (a: { lon: number; lat: number }, b: { lon: number; lat: number }) => Math.hypot((b.lon - a.lon) * KX, (b.lat - a.lat) * KZ);
const flat = () => world(null, { body: earth({ imagery: [], terrain: [] }), view: { lon: LON, lat: LAT, zoom: 17, tilt: 50 }, time: new Date(Date.UTC(2026, 9, 19, 2)) });
/** a car on a log: along a curve, a sample a second */
function carLog(t0: number, n = 60) {
  const log = history.log({ keep: Infinity });
  for (let i = 0; i <= n; i++) { const x = i * 15, y = 40 * Math.sin(x / 100); log.append('car', t0 + i * 1000, LON + x / KX, LAT + y / KZ); }
  return log;
}
const steps = (w: { step(ms: number): unknown }, n: number, ms = 1000 / 30) => { for (let i = 0; i < n; i++) w.step(ms); };
const bearingOf = (c: Camera) => ((c.pose.bearing % 360) + 360) % 360;

test('damping: a critically damped step is exact, so many small steps land where one long one does', () => {
  // a target moving straight: one step of a second, or 100 of 10 ms, end at the same place
  let a: [number, number] = [0, 0]; a = springStep(a[0], a[1], 0, 10, 1, 4);
  let b: [number, number] = [0, 0]; for (let i = 0; i < 100; i++) b = springStep(b[0], b[1], (i / 100) * 10, ((i + 1) / 100) * 10, 0.01, 4);
  assert.ok(Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9, `${a} vs ${b}`);
  // no overshoot: from rest towards a still target it closes the gap and never passes it; the half-life is half of it
  const f = new Follower({ place: { halfLife: 0.5, lead: 0 } }), p0 = at(0, 0), p1 = at(100, 0);
  f.step({ place: [p0.lon, p0.lat, 0] }, 0);
  let far = 0, half = NaN;
  for (let i = 1; i <= 300; i++) { const d = f.step({ place: [p1.lon, p1.lat, 0] }, 1 / 60); const x = metres(p0, { lon: d.place![0], lat: d.place![1] }); far = Math.max(far, x); if (Number.isNaN(half) && x >= 50) half = i / 60; }
  assert.ok(far <= 100 + 1e-6, `never past it (${far})`);
  assert.ok(Math.abs(half - 0.5) < 1 / 60 + 1e-9, `half the gap in its half-life (${half})`);
});
test('damping: the same camera at 30, 60 and 144 frames a second (the world\'s clock, not the frames)', () => {
  const run = (fps: number) => {
    const f = new Follower(), out: { place: [number, number, number]; heading: number }[] = [];
    for (let i = 0; i <= 6 * fps; i++) {
      const t = i / fps, p = at(25 * t, 30 * Math.sin(t), 0);
      const d = f.step({ place: [p.lon, p.lat, 0], heading: null }, i ? 1 / fps : 0, 30);
      out.push({ place: d.place!, heading: d.heading ?? NaN });
    }
    return out;
  };
  const a = run(30), b = run(60), c = run(150);
  for (let i = 30; i < a.length; i += 15) {
    const t = i / 30, pb = b[i * 2]!, pc = c[i * 5]!, pa = a[i]!;
    const dm = Math.max(metres({ lon: pa.place[0], lat: pa.place[1] }, { lon: pb.place[0], lat: pb.place[1] }), metres({ lon: pa.place[0], lat: pa.place[1] }, { lon: pc.place[0], lat: pc.place[1] }));
    assert.ok(dm < 0.01, `the place within a centimetre at ${t} s (${dm.toFixed(4)} m)`);
    assert.ok(Math.abs(pa.heading - pb.heading) < 0.01 && Math.abs(pa.heading - pc.heading) < 0.01, `the heading within a hundredth of a degree at ${t} s`);
  }
});
test('damping: a dead zone holds still for small moves, a top speed holds, a jump cuts, the heading turns the short way', () => {
  const p = at(0, 0), f = new Follower({ place: { halfLife: 0.2, deadZone: 2, lead: 0 }, snap: 50 });
  f.step({ place: [p.lon, p.lat, 0] }, 0);
  // bumps under the dead zone: the camera does not move
  for (let i = 0; i < 60; i++) { const q = at(1.3 * Math.sin(i), 1.3 * Math.cos(i * 1.3)); const d = f.step({ place: [q.lon, q.lat, 0] }, 1 / 30); assert.ok(metres(p, { lon: d.place![0], lat: d.place![1] }) < 1e-6, 'still'); }
  // a jump farther than the snap: the camera is there at once, said
  const far = at(400, 0), d = f.step({ place: [far.lon, far.lat, 0] }, 1 / 30);
  assert.equal(d.cut, true); assert.ok(metres(far, { lon: d.place![0], lat: d.place![1] }) < 1e-6);
  // a top speed: 10 m/s at most
  const g = new Follower({ place: { halfLife: 0.05, maxSpeed: 10, lead: 0 }, snap: false }), q0 = at(0, 0), q1 = at(100, 0);
  g.step({ place: [q0.lon, q0.lat, 0] }, 0);
  let last: { lon: number; lat: number } = q0; for (let i = 0; i < 30; i++) { const r = g.step({ place: [q1.lon, q1.lat, 0] }, 1 / 30); const now = { lon: r.place![0], lat: r.place![1] }; assert.ok(metres(last, now) <= 10 / 30 + 1e-6, 'no faster than its top speed'); last = now; }
  // the heading from 350° to 10°: 20° the short way, through 0
  const h = new Follower({ heading: { halfLife: 0.2, deadZone: 0 } }); h.step({ heading: 350 }, 0);
  const seen: number[] = []; for (let i = 0; i < 60; i++) seen.push(h.step({ heading: 10 }, 1 / 30).heading!);
  assert.ok(seen.every((x) => x >= 349.99 || x <= 10.0001), `never the long way (${seen.slice(0, 5).map((x) => x.toFixed(1))})`);
  assert.ok(Math.abs(seen.at(-1)! - 10) < 0.01);
  assert.throws(() => new Follower({ place: { halfLife: NaN } }), (e: unknown) => e instanceof AslnutError && e.code === 'E-VIEW-001' && /place\.halfLife is NaN/.test(e.message));
  assert.throws(() => new Follower({ heading: { from: 'sideways' as never } }), /heading\.from/);
});

test('aim: look at a thing in the air: it sits at the middle of the screen (or raised), the view\'s centre on the ground beyond it', async () => {
  const w = await flat(), c = w.camera;
  void w.play(move({ aim: lookAt({ ...at(0, 0), up: 300 }), keys: [{ at: 0, rig: { dist: 800, tilt: 60, bearing: 30 } }] }));
  steps(w, 3);
  const xy = w.project([LON, LAT, 300])!;
  assert.ok(Math.abs(xy[0] - c.width / 2) < 0.5 && Math.abs(xy[1] - c.height / 2) < 0.5, `at the middle (${xy})`);
  assert.ok(metres({ lon: c.lon, lat: c.lat }, { lon: LON, lat: LAT }) > 300 * Math.tan(60 * D) - 1, 'the centre beyond it on the ground');
  void w.play(move({ aim: lookAt({ ...at(0, 0), up: 300 }, { raise: 0.5 }), keys: [{ at: 0, rig: { dist: 800, tilt: 60, bearing: 30 } }] }));
  steps(w, 3);
  const up = w.project([LON, LAT, 300])!;
  assert.ok(Math.abs(up[1] - c.height / 4) < 1, `raised a quarter of the screen (${up[1]} of ${c.height})`);
  assert.throws(() => lookAt({ lon: NaN, lat: 0 }), /lookAt/);
  w.dispose();
});

test('moves: chase, track, crane, dolly, arc and reveal are the same parts (a path round an aim, damping, an ease)', async () => {
  const w = await flat(), c = w.camera, t0 = w.time.getTime(), log = carLog(t0), car = track(log, 'car', { up: 1 });
  w.setTime(new Date(t0), { rate: 1 });
  const eye = () => { const e = c.eye; return { x: (c.lon - LON) * KX + e[0]!, y: (c.lat - LAT) * KZ - e[2]!, z: e[1]! }; };
  const carNow = () => { const s = log.at('car', w.time.getTime())!; return { x: (s.lon - LON) * KX, y: (s.lat - LAT) * KZ, h: s.heading }; };
  // chase: behind it and over it, facing the way it goes
  void w.play(moves.chase(car, { behind: 30, up: 10 })); steps(w, 90);
  assert.equal(w.playing?.kind, 'chase');
  let e = eye(), s = carNow();
  assert.ok(Math.abs(Math.hypot(e.x - s.x, e.y - s.y, e.z - 1) - Math.hypot(30, 10)) < 4, 'the rig\'s distance (its lag a little more)');
  assert.ok(Math.abs(((bearingOf(c) - s.h + 540) % 360) - 180) < 12, `facing the way it goes (${bearingOf(c).toFixed(1)} vs ${s.h.toFixed(1)})`);
  assert.ok(Math.abs(e.z - 11) < 3, `up over it (${e.z.toFixed(1)})`);
  // track: to its left, looking across at it
  void w.play(moves.track(car, { side: 20, up: 2 })); steps(w, 60);
  e = eye(); s = carNow();
  const side = ((Math.atan2(e.x - s.x, e.y - s.y) / D - s.h + 720) % 360);
  assert.ok(Math.abs(side - 270) < 15, `on its left (${side.toFixed(0)}°)`);
  // crane: from where the camera is, up 200 m and round 30°, in its seconds (it carries the track's springs on)
  const h0 = eye().z; let done = false; void w.play(moves.crane(car, { up: 200, swing: 30 }), { seconds: 2 }).then(() => { done = true; });
  let n = 0; while (!done && n < 200) { w.step(1000 / 30); n++; await Promise.resolve(); }
  assert.ok(done && n >= 60 && n <= 62, `in its two seconds (${n} frames)`);
  assert.ok(Math.abs(eye().z - (h0 + 200)) < 6, `200 m up (${eye().z.toFixed(1)} from ${h0.toFixed(1)})`);
  // dolly, arc and reveal round a still place
  const p = at(0, 0), d0 = 120;
  void w.play(move({ aim: lookAt(p), keys: [{ at: 0, rig: { dist: d0, tilt: 50, bearing: 0 } }] })); steps(w, 3);
  done = false; void w.play(moves.dolly(p, { in: 70 }), { seconds: 1 }).then(() => { done = true; }); steps(w, 32); await Promise.resolve();
  assert.ok(done); assert.ok(Math.abs(Math.hypot(eye().x, eye().y, eye().z) - (d0 - 70)) < 0.5, `70 m in (${Math.hypot(eye().x, eye().y, eye().z).toFixed(2)})`);
  done = false; void w.play(moves.arc(p, { degrees: 90 }), { seconds: 1 }).then(() => { done = true; }); steps(w, 32); await Promise.resolve();
  assert.ok(done && Math.abs(bearingOf(c) - 90) < 0.5, `90° round (${bearingOf(c)})`);
  void w.play(moves.reveal(p, { from: 'below', dist: 200 }), { seconds: 2 }); steps(w, 1);
  const near = Math.hypot(eye().x, eye().y, eye().z); steps(w, 62);
  assert.ok(near < 60 && Math.abs(Math.hypot(eye().x, eye().y, eye().z) - 200) < 1, `from close in (${near.toFixed(0)} m) to the whole of it (200 m)`);
  // a person's hands moving the camera end a move; refused numbers say which
  assert.throws(() => moves.chase(car, { behind: NaN }), /moves\.chase: key 0's dist is NaN/);
  assert.throws(() => moves.dolly(p, { to: -1 }), /moves\.dolly: to is -1/);
  assert.throws(() => move({ aim: p, keys: [{ at: 0.5, rig: {} }, { at: 0.2, rig: {} }] }), /comes before/);
  w.dispose();
});

test('views: a tilt to 88° with the eye at street level or below, 80° from 300 m up, eased between; zooming out takes it back', () => {
  assert.equal(tiltMaxAt(2), 88); assert.equal(tiltMaxAt(TILT_LIMIT.street), 88); assert.equal(tiltMaxAt(5000), 80);
  const mid = tiltMaxAt(95); assert.ok(mid < 88 && mid > 80);
  // the floor keeps the eye's own height within the limit
  for (const d of [20, 300, 900, 3000, 20000]) { const p = pitchFloor(d), h = d * Math.sin(p); assert.ok(90 - p / D <= tiltMaxAt(h) + 1e-6, `at ${d} m`); }
  const c = new Camera({ lon: LON, lat: LAT, dist: 60, tilt: 88 }); c.update(390, 844, 16);
  assert.ok(Math.abs(c.view.tilt - 88) < 1e-9, `88° near the ground (${c.view.tilt})`);
  c.zoomBy(100); c.update(390, 844, 16);
  assert.ok(Math.abs(c.view.tilt - 80) < 1e-6, `80° from high up (${c.view.tilt})`);
  const hi = new Camera({ lon: LON, lat: LAT, zoom: 12, tilt: 88 }); hi.update(390, 844, 16);
  assert.ok(Math.abs(hi.view.tilt - 80) < 1e-6, 'a tilted map keeps today\'s limit');
  // the eye kept over what is under it (here a 30 m wall behind the centre)
  const g = new Camera({ lon: LON, lat: LAT, dist: 60, tilt: 88 }); g.under = (_lon, lat) => (lat < LAT - 0.0005 ? 30 : 0);
  g.update(390, 844, 16);
  assert.ok(g.eye[1]! >= 31 - 1e-6, `over the wall behind it (${g.eye[1]!.toFixed(2)} m)`);
  assert.ok(Math.abs(g.view.tilt - 88) < 1e-9, 'the view\'s own pose kept: only what is drawn is raised');
  g.under = () => 0; g.update(390, 844, 16);
  assert.ok(g.eye[1]! < 30, 'the wall gone: nothing of it stays');
  g.clear = false; g.jump({ lon: LON, lat: LAT, dist: 60, tilt: 88 }); g.update(390, 844, 16);
  assert.ok(g.eye[1]! < 30, 'clear: false (a view from under the ground): nothing raised');
});

test('follow: springs on the place; a zoom goes on, a pan ends it; asked again each frame it keeps its springs; a thing in the air stays mid-screen', async () => {
  const w = await flat(), c = w.camera, t0 = w.time.getTime(), log = carLog(t0);
  w.setTime(new Date(t0), { rate: 1 });
  w.follow(track(log, 'car')); steps(w, 60);
  const s = log.at('car', w.time.getTime())!;
  assert.ok(metres({ lon: c.lon, lat: c.lat }, s) < 3, `on it (${metres({ lon: c.lon, lat: c.lat }, s).toFixed(2)} m)`);
  // the hands: a zoom keeps it, a pan ends it
  (c as unknown as { hands: { zoom: number } }).hands.zoom++; c.zoomBy(0.5); steps(w, 2);
  assert.equal(w.isFollowing, true, 'a zoom goes on following');
  (c as unknown as { hands: { pan: number } }).hands.pan++; steps(w, 2);
  assert.equal(w.isFollowing, false, 'a pan ends it');
  // re-armed every frame: the same as armed once
  const run = async (each: boolean) => {
    const v = await flat(); v.setTime(new Date(t0), { rate: 1 }); const fn = (ms: number) => { const x = log.at('car', ms)!; return { lon: x.lon, lat: x.lat, up: 0 }; };
    v.follow(fn); for (let i = 0; i < 45; i++) { if (each) v.follow((ms: number) => fn(ms)); v.step(1000 / 30); }
    const out = [v.camera.lon, v.camera.lat]; v.dispose(); return out;
  };
  assert.deepEqual(await run(true), await run(false));
  // a thing in the air
  w.go({ lon: LON, lat: LAT, zoom: 15, tilt: 55 });
  w.follow((ms: number) => ({ ...at((ms - t0) / 50, 0), up: 400 })); steps(w, 60);
  const xy = w.project([LON + (w.time.getTime() - t0) / 50 / KX, LAT, 400])!;
  assert.ok(Math.abs(xy[0] - c.width / 2) < 3 && Math.abs(xy[1] - c.height / 2) < 3, `mid-screen (${xy.map((x) => x.toFixed(1))})`);
  assert.throws(() => w.follow(track(log, 'car'), { dist: -3 }), /follow: dist is -3/);
  w.dispose();
});

test('world: a camera set before the frame is its own; the first view is honoured; keys\' views go back in; drag orbits; the clock keeps its fractions', async () => {
  // (e) everyFrame before the draws: what it sets is this frame's camera
  const w = await world(null, { body: plane(), view: { lon: 0, lat: 0, dist: 6, tilt: 60 } });
  assert.ok(Math.abs(w.camera.dist - 6) < 1e-9, `(a) the first view as asked, under the default nearest (${w.camera.dist})`);
  let i = 0, seen = NaN; w.everyFrame(() => { w.go({ lon: 0, lat: 0, dist: 10 + i++, tilt: 40 }); }, { before: true });
  w.on('frame', () => { seen = w.camera.dist; });
  w.step(16); assert.equal(seen, 10); w.step(16); assert.equal(seen, 11);
  // (c) a key's view (dist and zoom both) goes back into w.go
  const k = keys([{ at: 0, view: { lon: 0, lat: 0, zoom: 19, tilt: 30 } }, { at: 2, view: { lon: 0.001, lat: 0, zoom: 20, tilt: 50 } }]);
  assert.doesNotThrow(() => w.go(k.at(1)));
  // (d) a one-finger drag turns round the centre
  w.control(null, controllers.orbit({ drag: 'orbit' })); assert.equal(w.camera.drag, 'orbit');
  w.control(null, controllers.orbit()); assert.equal(w.camera.drag, 'pan');
  assert.throws(() => controllers.orbit({ drag: 'spin' as never }), /drag/);
  // the world's clock at 60 frames a second: 30 s are 30 s (a Date's whole ms once lost 0.67 ms a frame)
  const v = await world(null, { body: plane(), time: new Date(Date.UTC(2026, 0, 1)) }); v.setTime(new Date(Date.UTC(2026, 0, 1)), { rate: 1 });
  for (let j = 0; j < 1800; j++) v.step(1000 / 60);
  assert.equal(v.time.getTime() - Date.UTC(2026, 0, 1), 30000);
  // a headless world records nothing; a recording's numbers are checked
  const it = w.record({ fps: 30, frames: 2 });
  await assert.rejects(() => it.next(), (e: unknown) => e instanceof AslnutError && e.code === 'E-WORLD-003');
  w.dispose(); v.dispose();
});

test('tiles: one loaded ahead without a show-only source is its own look: done ahead, loaded again whole when the view reaches it', async () => {
  const asked: { z: number; prefetch: boolean }[] = [], pending: ((r: Loaded | null) => void)[] = [];
  const tiles = new TileSet({ layers: 64, maxTiles: 100, inflight: 6, isMiss: () => false, load: (e, _v, _s, o) => { asked.push({ z: e.z, prefetch: o.prefetch }); return new Promise((ok) => pending.push(ok)); } });
  const t = { z: 9, x: 400, y: 300, c: 0, d: 0 }, centre = { lon: 0, lat: 0 };
  tiles.update([], 'v', 0, centre);
  tiles.aheadOf([{ tiles: [t], prefetch: () => true, depth: 0 }], 'v');
  assert.ok(asked.some((a) => a.z === 9 && a.prefetch), 'asked ahead');
  for (const done of pending.splice(0)) done({ heights: null, ahead: true });
  await new Promise<void>((ok) => setImmediate(ok));
  tiles.update([], 'v', 0, centre);
  assert.equal(tiles.had([t], 'v'), 1, 'ahead of need, it is done');
  asked.length = 0; tiles.aheadOf([{ tiles: [t], prefetch: () => true, depth: 0 }], 'v');
  assert.ok(!asked.some((a) => a.z === 9), 'not asked ahead again');
  tiles.update([t], 'v', 16, centre);
  assert.ok(asked.some((a) => a.z === 9 && !a.prefetch), 'the view reached it: loaded again, whole');
  tiles.dispose(); for (const done of pending) done(null);
});

test('follow: heading turns the view with the thing (from the way it goes), dist keeps the eye that far; a move after another on the same thing carries its springs', async () => {
  const w = await flat(), c = w.camera, t0 = w.time.getTime(), log = carLog(t0), car = track(log, 'car');
  w.setTime(new Date(t0), { rate: 1 });
  w.follow(car, { heading: true, dist: 80 }); steps(w, 120);
  const s = log.at('car', w.time.getTime())!;
  assert.ok(Math.abs(((bearingOf(c) - s.heading + 540) % 360) - 180) < 15, `the view faces the way it goes (${bearingOf(c).toFixed(1)} vs ${s.heading.toFixed(1)})`);
  assert.ok(Math.abs(c.dist - 80) < 2, `the eye kept 80 m from it (${c.dist.toFixed(1)})`);
  w.follow(null);
  // a chase, then a crane on the same thing: no jump at the change (the crane starts from the chase's eye and springs)
  void w.play(moves.chase(car, { behind: 30, up: 10 })); steps(w, 60);
  const e0 = c.eye.slice(), at0 = [c.lon, c.lat];
  void w.play(moves.crane(car, { up: 100 }), { seconds: 3 }); w.step(1000 / 30);
  const de = Math.hypot((c.lon - at0[0]!) * KX + c.eye[0]! - e0[0]!, -(c.lat - at0[1]!) * KZ + c.eye[2]! - e0[2]!, c.eye[1]! - e0[1]!);
  assert.ok(de < 2, `the eye goes on from where it was (${de.toFixed(2)} m in a frame)`);
  w.dispose();
});
