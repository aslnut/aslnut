import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Camera, keys, ease, poseOf, viewOf, Flight } from '../src/core/observation/observers/orbit/index.ts';
import { poseOf as tilePose } from '../src/modules/world/surface/quadtree.ts';
import { AslnutError } from '../src/core/world/errors.ts';
import { world, earth, controllers, entity, followEntity } from '../src/index.ts';

const globe = { lon: 100, lat: 0, zoom: 1.5 }, bandung = { lon: 107.6, lat: -6.9, zoom: 12, tilt: 55, bearing: 30 };

test('views: one vocabulary, degrees in and out', () => {
  const v = viewOf(poseOf(bandung));
  assert.ok(Math.abs(v.zoom - 12) < 1e-9 && Math.abs(v.tilt - 55) < 1e-9 && v.bearing === 30);
  assert.throws(() => poseOf({ lon: 1, lat: 2, dist: 5, zoom: 3 }), /dist \(5 m\) and zoom \(3\) disagree/);
  assert.throws(() => poseOf({ lon: 107, lat: 400 }), /swap lon and lat/);
  assert.throws(() => poseOf({ lat: 1 } as never), (e: unknown) => e instanceof AslnutError && e.code === 'E-VIEW-001');
});
test('easing: presets and expressions; a typo throws', () => {
  for (const p of ['smooth', 'cinematic', 'glide', 'snap', 'anticipate', 'overshoot', 'linear']) { assert.equal(ease(p, 0), 0); assert.ok(Math.abs(ease(p, 1) - 1) < 1e-9); }
  assert.ok(ease('anticipate', 0.1) < 0, 'anticipate pulls back first');
  assert.ok(Math.max(...Array.from({ length: 50 }, (_, i) => ease('overshoot', i / 49))) > 1, 'overshoot passes the key');
  assert.equal(ease('steps(4)', 0.3), 0.25);
  assert.throws(() => ease('smoth', 0.5), /unknown ease 'smoth'/);
});
test('keys: exact at the keys, pure in t, eased between', () => {
  const k = keys([{ at: 0, view: globe }, { at: 6, view: bandung, ease: 'cinematic', path: 'arc' }, { at: 9, view: { ...bandung, bearing: 120 }, path: 'around', turns: 0 }]);
  assert.equal(k.duration, 9);
  const a = k.at(0), b = k.at(6), c = k.at(9);
  assert.ok(Math.abs(a.lon - 100) < 1e-9 && Math.abs(b.zoom - 12) < 1e-9 && Math.abs(c.bearing - 120) < 1e-6);
  assert.deepEqual(k.at(3.3), k.at(3.3));
  // up and over: in the middle of a long arc the camera is higher than both ends
  const mid = keys([{ at: 0, view: { lon: 0, lat: 0, zoom: 10 } }, { at: 1, view: { lon: 40, lat: 0, zoom: 10 }, ease: 'linear' }]).pose(0.5);
  assert.ok(mid.dist > poseOf({ lon: 0, lat: 0, zoom: 10 }).dist * 10);
  assert.throws(() => keys([{ at: 2, view: globe }, { at: 1, view: bandung }]), /comes before/);
  assert.throws(() => keys([{ at: 0, view: globe }, { at: 1, view: bandung, ease: 'nope' }]), /unknown ease/);
});
test('camera: fly and play run on the world clock, not the wall clock', async () => {
  const c = new Camera(globe);
  let arrived = false;
  void c.fly(bandung, { seconds: 2 }).then(() => { arrived = true; });
  for (let i = 0; i < 59; i++) c.update(390, 844, 1000 / 30);
  assert.equal(arrived, false);
  c.update(390, 844, 1000 / 30); c.update(390, 844, 1000 / 30);
  await Promise.resolve();
  assert.equal(arrived, true);
  assert.ok(Math.abs(c.view.lon - 107.6) < 1e-9);
  const k = keys([{ at: 0, view: globe }, { at: 1, view: bandung }]);
  const c2 = new Camera(); void c2.play(k);
  // (the first frame is the first key: then half a second)
  for (let i = 0; i < 16; i++) c2.update(390, 844, 1000 / 30);
  const half = k.at(0.5);
  assert.ok(Math.abs(c2.view.lon - half.lon) < 1e-6);
});
test('camera: project and lonLatAt are inverse on the flat map; the far side of the globe is not facing', () => {
  const c = new Camera({ lon: 107.6, lat: -6.9, zoom: 13, tilt: 40 }); c.update(390, 844, 16);
  const p = c.project(107.61, -6.905)!;
  const back = c.lonLatAt(p[0], p[1])!;
  assert.ok(Math.abs(back[0] - 107.61) < 1e-6 && Math.abs(back[1] + 6.905) < 1e-6);
  const g = new Camera({ lon: 0, lat: 0, zoom: 1 }); g.update(800, 800, 16);
  assert.equal(g.facing(10, 0), true);
  assert.equal(g.facing(180, 0), false);
  const f = new Flight([globe, bandung]);
  assert.ok(f.seconds > 1 && Math.abs(f.at(1).lon - 107.6) < 1e-9);
});
test('moving: a pose set from outside on consecutive frames counts as moving, like a flight or a hand; still once it stops', () => {
  const c = new Camera(globe);
  c.update(390, 844, 16);
  assert.equal(c.moving, false, 'the first pose is not a move');
  c.update(390, 844, 16);
  assert.equal(c.moving, false);
  // a scripted driver: jump every frame (w.go per frame, the auto test, a follow)
  for (let i = 0; i < 5; i++) { c.jump({ lon: 100.5 + i * 0.5, lat: 0, zoom: 1.7 + i * 0.2 }); c.update(390, 844, 16); assert.equal(c.moving, true, `frame ${i}`); }
  // it stops: one more frame still counts (the last change), then still
  c.update(390, 844, 16); assert.equal(c.moving, true);
  c.update(390, 844, 16); assert.equal(c.moving, false);
  // a single jump is a short move, then still
  c.jump(bandung); c.update(390, 844, 16); assert.equal(c.moving, true);
  c.update(390, 844, 16); c.update(390, 844, 16); assert.equal(c.moving, false);
});

// The web-map convention: bearing 90 puts east at the top of the screen.
test('bearing: clockwise from north, for flat and globe, tilted and overhead', () => {
  for (const projection of ['flat', 'globe'] as const) for (const tilt of [0, 50]) {
    for (const [bearing, lon, lat] of [[0, 0, 0.01], [90, 0.01, 0], [180, 0, -0.01], [270, -0.01, 0]]) {
      const c = new Camera({ lon: 0, lat: 0, dist: 10000, tilt, bearing });
      c.projection = projection; c.update(800, 800, 0);
      const centre = c.project(0, 0)!, ahead = c.project(lon!, lat!)!;
      assert.ok(ahead[1] < centre[1], `${projection}, tilt ${tilt}, bearing ${bearing}: forward is screen up`);
      assert.ok(Math.abs(ahead[0] - centre[0]) < 0.1, 'forward stays on the screen centreline');
      assert.equal((c.view.bearing + 360) % 360, bearing);
      const hit = c.lonLatAt(...ahead)!;
      assert.ok(Math.abs(hit[0] - lon!) < 1e-5 && Math.abs(hit[1] - lat!) < 1e-5);
    }
  }
});

test('bearing: keys, flights and tile planning agree with the view; dragging follows the screen', () => {
  const v = { lon: 0, lat: 0, dist: 10000, tilt: 50, bearing: 90 };
  const c = new Camera(v); c.update(800, 800, 0);
  const q = tilePose(c.pose, c, c.groundY);
  for (let i = 0; i < 16; i++) assert.ok(Math.abs(q.vp[i]! - c.viewProj[i]!) < 1e-4 * Math.max(1, Math.abs(c.viewProj[i]!)));
  assert.deepEqual(Array.from(q.eye).map((x) => Math.round(x)), Array.from(c.eye).map((x) => Math.round(x)));
  c.pan(0, 10);
  assert.ok(c.lon > 0, 'at bearing 90, dragging down moves the centre east');
  const k = keys([{ at: 0, view: { ...v, bearing: 0 } }, { at: 1, view: v, ease: 'linear' }]);
  void c.play(k); c.update(800, 800, 16); c.update(800, 800, 1000);
  assert.equal(c.view.bearing, 90);
  assert.ok(c.project(0.01, 0)![1] < c.project(0, 0)![1]);
  void c.fly({ ...v, bearing: 270 }, { seconds: 1 }); c.update(800, 800, 16); c.update(800, 800, 1000);
  assert.equal(c.view.bearing, -90);
  assert.ok(c.project(-0.01, 0)![1] < c.project(0, 0)![1]);
});

// a number that is not finite (NaN, Infinity) in the camera made a still world draw every frame for ever (the frame
// loop's "did the view change?" never settles on NaN): every way a view or a pose comes in refuses one, naming it
const viewErr = (k: string) => (e: unknown) => e instanceof AslnutError && e.code === 'E-VIEW-001' && e.message.includes(`a view's ${k} is not a finite number`);
const poseErr = (k: string) => (e: unknown) => e instanceof AslnutError && e.code === 'E-VIEW-001' && e.message.includes(`a camera pose's ${k} is`);
test('finite: a view\'s lon, lat, dist, zoom, tilt or bearing that is not a finite number is refused, naming it', () => {
  for (const k of ['lon', 'lat', 'dist', 'zoom', 'tilt', 'bearing'] as const) for (const x of [NaN, Infinity, -Infinity, '25']) {
    assert.throws(() => poseOf({ lon: 107.6, lat: -6.9, tilt: 30, bearing: 10, [k]: x } as never), viewErr(k), `${k}: ${x}`);
  }
  for (const dist of [0, -5]) assert.throws(() => poseOf({ lon: 107.6, lat: -6.9, dist }), /dist is/);
  assert.throws(() => poseOf({ lon: 107.6, lat: -6.9, bearing: NaN }), (e: unknown) => e instanceof AslnutError && /w\.camera\.view/.test(e.fix), 'the fix says where the view is read in the same terms');
  assert.equal(poseOf({ lon: 107.6, lat: -6.9, bearing: undefined }).bearing, 0, 'left out: as before');
});
test('finite: a jump or a flight asked a number that is not finite is refused before anything stops; nothing changes', async () => {
  const c = new Camera(bandung); c.update(390, 844, 16);
  const before = c.pose;
  assert.throws(() => c.jump({ ...bandung, bearing: NaN }), viewErr('bearing'));
  assert.throws(() => c.jump({ ...before, pitch: NaN }), poseErr('pitch'));
  assert.deepEqual(c.pose, before);
  let arrived = false; void c.fly({ ...bandung, zoom: 13 }, { seconds: 1 }).then(() => { arrived = true; });
  // (the camera's own numbers are a pose's: it has no bearing, its yaw and pitch are radians; the view is c.view)
  const own = (c as unknown as { bearing?: number }).bearing;
  assert.throws(() => c.fly({ ...bandung, bearing: (own! + 25) % 360 }), viewErr('bearing'));
  for (const seconds of [NaN, Infinity, -1]) assert.throws(() => c.fly(bandung, { seconds }), /a flight's seconds is/);
  assert.throws(() => c.fly(bandung, { ease: 'smoth' }), /unknown ease 'smoth'/);
  assert.throws(() => c.fly(bandung, { path: 'zigzag' as never }), /unknown path 'zigzag'/);
  c.update(390, 844, 16); c.update(390, 844, 500); assert.equal(c.moving, true, 'the flight under way goes on');
  c.update(390, 844, 600); await Promise.resolve();
  assert.equal(arrived, true); assert.ok(Math.abs(c.view.zoom - 13) < 1e-9);
});
test('finite: an ease or camera keys of your own answering NaN end the move there, refused; the pose stays a pose', async () => {
  const c = new Camera(bandung); c.update(390, 844, 16);
  const before = c.pose;
  let done = false; void c.fly({ ...bandung, zoom: 14 }, { seconds: 1, ease: () => NaN }).then(() => { done = true; });
  assert.throws(() => c.update(390, 844, 100), poseErr('lon'));
  await Promise.resolve(); assert.equal(done, true, 'the flight ended (resolved, as a newer move ends one)');
  c.update(390, 844, 16); assert.deepEqual(c.pose, before);
  const mine = { list: [{ at: 0, view: bandung }, { at: 1, view: bandung }], duration: 1, pose: () => ({ ...before, bearing: NaN }), at: () => c.view };
  void c.play(mine as never);
  assert.throws(() => c.update(390, 844, 16), poseErr('bearing'));
  c.update(390, 844, 16); assert.deepEqual(c.pose, before); assert.equal(c.moving, false);
});
test('finite: camera keys, flights and the moves by hand refuse a number that is not finite', () => {
  assert.throws(() => keys([{ at: 0, view: globe }, { at: 1, view: { ...bandung, tilt: NaN } }]), /camera key 1: .*a view's tilt is not a finite number/);
  assert.throws(() => keys([{ at: 0, view: globe }, { at: 1, view: bandung, path: 'around', turns: NaN }]), /camera key 1: turns is NaN/);
  assert.throws(() => new Flight([globe, { ...poseOf(bandung), dist: Infinity }]), (e: unknown) => poseErr('dist')(e) && (e as AslnutError).where === 'flight[1]');
  const c = new Camera(bandung); c.update(390, 844, 16);
  const before = c.pose;
  assert.throws(() => c.turn(NaN, 0), /camera\.turn/);
  assert.throws(() => c.pan(Infinity, 0), /camera\.moveBy/);
  assert.throws(() => c.moveBy(0, NaN), /camera\.moveBy/);
  assert.throws(() => c.zoomBy(0), /camera\.zoomBy/);
  assert.throws(() => c.zoomAt(NaN, 100, 100), /camera\.zoomBy/);
  assert.deepEqual(c.pose, before);
});
test('finite: w.go, w.fly, w.addView, w.fit, w.prefetch, w.follow, w.control and an entity\'s follow refuse one; a tilted flight then holds still', async () => {
  const w = await world(null, { body: earth({ imagery: [], terrain: [] }), view: { lon: 145.12, lat: -37.92, zoom: 15, tilt: 40 } });
  const c = w.camera; w.step(16);
  const v0 = c.view, at = { lon: v0.lon, lat: v0.lat, zoom: v0.zoom, tilt: v0.tilt, bearing: v0.bearing };
  // (the found case: a bearing read from the camera, which has none)
  const own = (c as unknown as { bearing?: number }).bearing;
  assert.throws(() => w.fly({ ...at, tilt: 40, bearing: (own! + 25) % 360 }, { seconds: 2 }), viewErr('bearing'));
  assert.throws(() => w.go({ ...at, zoom: NaN }), viewErr('zoom'));
  assert.throws(() => w.addView('x', { lon: NaN, lat: 0 }), viewErr('lon'));
  assert.throws(() => w.fit([145.1, -37.93, 145.13, -37.91], { padding: NaN }), /fit: padding is NaN/);
  assert.throws(() => w.fit([145.1, -37.93, 145.13, -37.91], { bearing: Infinity }), viewErr('bearing'));
  assert.throws(() => w.prefetch([{ ...at, tilt: NaN }]), viewErr('tilt'));
  assert.throws(() => w.follow(() => [145.12, -37.92], { smooth: NaN }), /follow: smooth is NaN/);
  assert.throws(() => w.control(null, controllers.orbit({ zoomRange: [10, NaN] })), /control: zoomRange is \[10,null\]/);
  const e = entity({ id: 'car', at: [145.12, -37.92, 0] });
  assert.throws(() => followEntity(w, e, { offset: [0, NaN, -8] }), /follow: offset is/);
  assert.throws(() => followEntity(w, e, { lag: Infinity }), /follow: lag is Infinity/);
  for (let i = 0; i < 3; i++) w.step(16);
  assert.deepEqual(c.view, v0, 'nothing refused changed the view');
  assert.equal(w.isFollowing, false);
  // a real tilted flight that turns: it arrives, and then nothing of the view changes frame to frame (the loop rests)
  let arrived = false; void w.fly({ ...at, tilt: 15, bearing: v0.bearing + 25 }, { seconds: 1 }).then(() => { arrived = true; });
  for (let i = 0; i < 70 && !arrived; i++) { w.step(16); await Promise.resolve(); }
  assert.equal(arrived, true);
  const sig = () => [c.lon, c.lat, c.dist, c.pitch, c.yaw, c.groundY, c.morph];
  w.step(16); const s1 = sig();
  for (let i = 0; i < 5; i++) w.step(16);
  assert.ok(s1.every(Number.isFinite)); assert.deepEqual(sig(), s1); assert.equal(c.moving, false);
  assert.ok(Math.abs(c.view.tilt - 15) < 1e-9 && Math.abs(c.view.bearing - 25) < 1e-9);
  w.dispose();
});

test('views: the view read is the view written: w.camera.view flies back as it is; a dist and a zoom that disagree are refused', async () => {
  // (a phone's portrait screen: the camera stands 2.5 times farther than the view's dist, which is the view's own)
  const c = new Camera(bandung); c.update(390, 844, 16);
  const v = c.view, d0 = c.dist;
  assert.ok(v.dist !== undefined && v.zoom !== undefined);
  assert.doesNotThrow(() => poseOf(v));
  let arrived = false; void c.fly({ ...v, tilt: 40 }, { seconds: 1 }).then(() => { arrived = true; });
  c.update(390, 844, 16); c.update(390, 844, 1000); await Promise.resolve();
  assert.equal(arrived, true);
  assert.ok(Math.abs(c.view.tilt - 40) < 1e-9 && Math.abs(c.view.zoom - 12) < 1e-9 && Math.abs(c.view.bearing - 30) < 1e-9);
  assert.ok(Math.abs(c.dist - d0) < 1e-6, 'the same distance (not framed twice)');
  assert.throws(() => poseOf({ ...v, zoom: v.zoom + 1 }), (e: unknown) => e instanceof AslnutError && e.code === 'E-VIEW-001' && /a view's dist \(.* m\) and zoom \(13[\d.]*\) disagree: that dist is zoom 12 /.test(e.message) && /leave the other out/.test(e.fix));
  c.jump({ ...v, dist: undefined, zoom: 13 }); c.update(390, 844, 16);
  assert.ok(Math.abs(c.view.zoom - 13) < 1e-9, 'one of them changed, the other left out');
});
test('camera: a move\'s time starts at its first drawn frame: a 1.2 s flight from a resting world takes 1.2 s, camera keys too', async () => {
  const c = new Camera(globe); c.update(390, 844, 16);
  let arrived = false; void c.fly(bandung, { seconds: 1.2 }).then(() => { arrived = true; });
  // the first frame after a rest carries the rested time on the world's clock (up to a quarter of a second): not the
  // flight's; it shows where the flight starts
  c.update(390, 844, 250 + 1000 / 60);
  assert.ok(Math.abs(c.lon - 100) < 1e-9, 'the first frame: the start');
  let frames = 0;
  while (!arrived && frames < 200) { c.update(390, 844, 1000 / 60); frames++; await Promise.resolve(); }
  assert.ok(frames >= 72 && frames <= 73, `1.2 s at 60 frames a second after the first (${frames})`);
  assert.ok(Math.abs(c.view.lon - 107.6) < 1e-9);
  const k = keys([{ at: 0, view: globe }, { at: 1, view: bandung, ease: 'linear' }]), c2 = new Camera(bandung);
  void c2.play(k); c2.update(390, 844, 250);
  assert.ok(Math.abs(c2.lon - k.at(0).lon) < 1e-9, 'the first frame: the first key');
  for (let i = 0; i < 30; i++) c2.update(390, 844, 1000 / 60);
  assert.ok(Math.abs(c2.view.lon - k.at(0.5).lon) < 1e-6, 'half a second later: the keys at 0.5 s');
});
test('finite: a number written straight into the camera is said once (E-VIEW-001), never repaired, and is not a move every frame', async () => {
  const w = await world(null, { body: earth({ imagery: [], terrain: [] }), view: { lon: 145.12, lat: -37.92, zoom: 15, tilt: 40 } });
  const errs: AslnutError[] = []; w.on('error', (e) => { errs.push(e as AslnutError); });
  const c = w.camera; w.step(16);
  c.yaw = NaN;
  for (let i = 0; i < 10; i++) w.step(16);
  assert.equal(errs.length, 1, 'said once');
  assert.ok(errs[0]!.code === 'E-VIEW-001' && /the camera's yaw is NaN/.test(errs[0]!.message) && /w\.go or w\.fly/.test(errs[0]!.fix));
  assert.ok(Number.isNaN(c.yaw), 'never repaired');
  assert.equal(c.moving, false, 'one change, not one every frame');
  w.go({ lon: 145.12, lat: -37.92, zoom: 15, tilt: 40 }); for (let i = 0; i < 3; i++) w.step(16);
  assert.equal(errs.length, 1);
  c.dist = Infinity; w.step(16); w.step(16);
  assert.equal(errs.length, 2, 'said again after a good view'); assert.match(errs[1]!.message, /the camera's dist is Infinity/);
  w.dispose();
});
