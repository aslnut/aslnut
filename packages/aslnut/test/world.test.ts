import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, points, custom, earth, imagery, terrain, plane, planeAt, AslnutError, makeState, keys } from '../src/index.ts';
import { composeHeights, gridSampler, tileHeights, decodeHeight, type GridData } from '../src/modules/world/surface/sources.ts';
import { TileSet, N } from '../src/modules/world/surface/tiles.ts';
import { wantFor, poseOf } from '../src/modules/world/surface/quadtree.ts';
import { Camera } from '../src/core/observation/observers/orbit/camera.ts';
import { tileOf } from '../src/core/space/geo.ts';
import { Loader, LoaderMiss, MemoryStore } from '../src/core/data/loading/index.ts';

/** a synthetic DEM: a 2 km cone at its centre, over [107.5, -7.0, 107.7, -6.8] */
function synthDem(cols = 81, rows = 81): GridData {
  const h = new Float32Array(cols * rows);
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) { const dx = i / (cols - 1) - 0.5, dy = j / (rows - 1) - 0.5; h[j * cols + i] = Math.max(0, 2000 * (1 - Math.hypot(dx, dy) * 2.5)); }
  return { cols, rows, heights: h, bbox: [107.5, -7.0, 107.7, -6.8] };
}
const ctx = () => ({ loader: new Loader({ store: new MemoryStore() }), priority: 'now' as const, prefetch: false });

test('providers: named factories with the services\' terms; your own url, draw and heights', () => {
  const esri = imagery.esri(), osm = imagery.osm(), s2 = imagery.sentinel(), mz = terrain.mapzen();
  assert.deepEqual([esri.terms.prefetch, esri.terms.keep, esri.terms.export], [false, false, false]);
  assert.deepEqual([osm.terms.prefetch, osm.terms.keep], [false, false]);
  assert.deepEqual([s2.terms.prefetch, s2.terms.keep, s2.terms.export], [true, true, true]);
  assert.match(s2.attribution, /EOX.*CC BY 4\.0/);
  assert.equal(esri.urlFor!({ z: 3, x: 6, y: 4 }), 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/4/6');
  assert.equal(mz.urlFor!({ z: 18, x: 4, y: 4 }), 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/15/0/0.png', 'over-zoom past 15 asks the parent');
  assert.equal(imagery.osm({ url: 'https://my.tiles/{z}/{x}/{y}.png' }).terms.keep, true, 'your own tile server is yours to keep');
  assert.equal(imagery.esri({ terms: { keep: true } }).terms.keep, true, 'a licence holder may override');
  assert.throws(() => imagery.custom({} as never), (e: unknown) => e instanceof AslnutError && e.code === 'E-DATA-001');
  assert.throws(() => imagery.custom({ url: 'https://x/{z}/{x}.png' }), /needs \{z\}, \{x\} and \{y\}/);
  assert.throws(() => terrain.grid({ data: synthDem(), where: [1, 2, 0, 3] }), /\[west, south, east, north\]/);
  assert.throws(() => earth({ terrain: [imagery.esri()] as never }), /not a terrain source/);
  assert.equal(decodeHeight('terrarium', 128, 0, 0), 0);
  assert.equal(decodeHeight('mapbox', 1, 134, 160), 0);
});
test('terrain: a grid, where, blend; lists compose; [] is flat', async () => {
  const dem = synthDem(), s = gridSampler(dem, 'dem');
  assert.ok(Math.abs(s.at(107.6, -6.9) - 2000) < 30, 'the cone top');
  assert.ok(Number.isNaN(s.at(108, -6.9)), 'outside: no data');
  const z = 12, [x, y] = tileOf(107.6, -6.9, z), t = { z, x, y };
  const base = terrain.custom({ id: 'base', heights: (_t, n) => new Float32Array(n * n).fill(100) });
  const grid = terrain.grid({ data: dem, blend: 0 });
  const h = (await composeHeights([base, grid], t, N, ctx()))!;
  const mid = h[Math.floor(N / 2) * N + Math.floor(N / 2)]!;
  assert.ok(mid > 1000, `the grid wins where it covers (${mid})`);
  // a grid with a blend: the edge of its box eases from what is under it
  const blended = terrain.grid({ data: { ...dem, heights: new Float32Array(dem.cols * dem.rows).fill(500) }, blend: 3000 });
  const z2 = 10, [x2, y2] = tileOf(107.5, -6.9, z2);
  const hb = (await composeHeights([base, blended], { z: z2, x: x2, y: y2 }, N, ctx()))!;
  const vals = [...hb].filter((v) => v > 100.5 && v < 499.5);
  assert.ok(vals.length > 0, 'values between the two near the edge');
  assert.equal(await composeHeights([], t, N, ctx()), null, 'no terrain: flat');
  // a local metric frame (the format of a DEM in local metres)
  const loc = gridSampler({ cols: 3, rows: 3, heights: new Float32Array([1, 2, 3, 4, 5, 6, 7, 8, 9]), local: { lon0: 107.6, lat0: -6.9, west: -45, north: 45, cell: 30 } }, 'local');
  assert.ok(Math.abs(loc.at(107.6, -6.9) - 5) < 1e-6, 'the centre cell');
  assert.equal(tileHeights(t, 3, () => 7).length, 9);
  const heightsAt = terrain.custom({ heights: (_t, n) => new Float32Array(n) });
  await assert.rejects(heightsAt.heights(t, 4, ctx()), /gave 4 heights for 4 × 4/);
});
test('quadtree: a globe view wants coarse tiles and skips the far side; a street view wants fine ones', () => {
  const cam = new Camera({ lon: 0, lat: 0, zoom: 1.5 }); cam.update(400, 800, 16);
  const want = wantFor({ lon: cam.lon, lat: cam.lat, morph: cam.morph, eye: cam.eye, vp: cam.viewProj, H: 800, fov: cam.fov, dist: cam.dist, groundY: 0 }, { tilePx: 300, maxZoom: 20, maxTiles: 400 });
  assert.ok(want.length > 4 && want.every((t) => t.z <= 4));
  assert.ok(!want.some((t) => t.z >= 2 && (t.x === 0 || t.x === 2 ** t.z - 1) && t.y === 2 ** t.z / 2), 'nothing at the antimeridian');
  const near = wantFor(poseOf({ lon: 107.6, lat: -6.9, dist: 2000, bearing: 0, pitch: 0.8 }, { fov: cam.fov, width: 400, height: 800, morphAt: (d) => cam.morphAt(d), planes: (d) => cam.planes(d), pitch: 0.8 }), { tilePx: 300, maxZoom: 20, maxTiles: 400 });
  assert.ok(Math.max(...near.map((t) => t.z)) >= 13);
});

/** the tile state machine on a fake source: every load resolves on the next tick */
function tileSet(behaviour: (key: string) => 'ok' | 'fail' | 'miss' = () => 'ok') {
  return new TileSet({ layers: 64, maxTiles: 400, fade: 100, fadeH: 100, hold: 50, load: async (e) => { await Promise.resolve(); const k = `${e.z}/${e.x}/${e.y}`, b = behaviour(k); if (b === 'fail') throw new Error('network down'); if (b === 'miss') throw new LoaderMiss(k, 'replay'); return { heights: new Float32Array(N * N).fill(e.z) }; }, isMiss: (err) => err instanceof LoaderMiss });
}
const flush = () => new Promise((r) => setTimeout(r, 0));
test('settled: a pure function of the tile state and the world clock (no wall clock)', async () => {
  const ts = tileSet(), want = [{ z: 3, x: 6, y: 4, d: 1, c: 0 }, { z: 3, x: 7, y: 4, d: 1, c: 0.5 }];
  let now = 0;
  for (let i = 0; i < 8; i++) { ts.update(want, 'v1', now, { lon: 0, lat: 0 }); await flush(); }
  assert.equal(ts.settle(want, 'v1').done, false, 'loaded but not yet faded in at the same clock');
  for (let i = 0; i < 20; i++) { now += 16; ts.update(want, 'v1', now, { lon: 0, lat: 0 }); await flush(); }
  const st = ts.settle(want, 'v1');
  assert.equal(st.done, true, JSON.stringify(st));
  // a new look: pending again until redrawn, while the old look stays shown
  ts.update(want, 'v2', now, { lon: 0, lat: 0 });
  assert.equal(ts.settle(want, 'v2').done, false);
  assert.ok(ts.count >= 2, 'the old look is still drawn');
});
test('settled: failures and misses are listed, not waited for forever', async () => {
  const ts = tileSet((k) => (k === '3/6/4' ? 'fail' : k === '3/7/4' ? 'miss' : 'ok')), want = [{ z: 3, x: 6, y: 4, d: 1, c: 0 }, { z: 3, x: 7, y: 4, d: 1, c: 0 }];
  let now = 0;
  for (let i = 0; i < 400; i++) { now += 50; ts.update(want, 'v', now, { lon: 0, lat: 0 }); await flush(); }
  const st = ts.settle(want, 'v');
  assert.deepEqual(st.failed.map((f) => f.tile), ['3/6/4']);
  assert.match(st.failed[0]!.error, /network down/);
  assert.deepEqual(st.missing, ['3/7/4']);
  assert.equal(st.pending, 0);
  assert.ok(ts.stats.holes >= 0 && ts.count === 2, 'still drawn (from the base)');
});

test('a headless world: views, params, readouts, points, when, the same results without graphics', async () => {
  const w = await world(null, { body: earth({ imagery: [imagery.sentinel()], terrain: [] }), view: { lon: 107.6, lat: -6.9, zoom: 12 }, views: { globe: { lon: 110, lat: 0, zoom: 2 } } });
  assert.equal(w.api, 'none');
  const pts = points({ id: 'cities', data: [{ at: [107.6, -6.9], value: 3 }], when: { level: { from: 'city' } }, params: { gain: 1.5, tint: '#ff8800' } });
  w.add(pts);
  assert.equal(w.level, 'city', 'an element asking for a level turned the default ladder on (zoom 12: city)');
  w.step(16);
  assert.equal(pts.target, 1);
  w.go('globe'); w.step(16); w.step(600); w.step(16);
  assert.equal(w.level, 'world');
  assert.equal(pts.target, 0, 'when hides it at a coarser level (past the margin, after the dwell)');
  assert.equal(w.get('cities.gain'), 1.5);
  w.set('cities.gain', 2);
  assert.equal(w.get('cities.gain'), 2);
  assert.throws(() => w.set('cities.gain', 'loud'), (e: unknown) => e instanceof AslnutError && e.code === 'E-WORLD-004');
  assert.throws(() => w.set('cities.nope', 1), /no param 'cities.nope'/);
  assert.equal(w.read('cities.count'), 1);
  w.readout('x.lit', () => 4);
  assert.equal(w.state.world.readouts['x.lit'], 4);
  assert.equal(w.state.world.params['cities.gain'], 2);
  assert.throws(() => w.add(points({ id: 'cities', data: [] })), /two elements with id 'cities'/);
  assert.throws(() => points({ id: 'a.b', data: [] }), /not a plain name/);
  w.go({ lon: 107.6, lat: -6.9, zoom: 12 });
  const xy = w.project([107.6, -6.9]);
  assert.ok(xy && Math.abs(xy[0] - w.camera.width / 2) < 1 && Math.abs(xy[1] - w.camera.height / 2) < 1, 'the centre projects to the middle');
  assert.equal(await w.settled({ timeout: 2000 }), true);
  w.dispose();
  assert.throws(() => w.add(points({ data: [] })), (e: unknown) => e instanceof AslnutError && e.code === 'E-WORLD-003');
});
test('a headless world: order, move and when across kinds', async () => {
  const w = await world(null, { body: plane({ size: 100 }) });
  const a = points({ id: 'a', data: [{ at: planeAt(1, 2) }] }), h = custom({ id: 'h', data: [{ at: planeAt(0, 0) }], at: (d) => d.at });
  w.add(a, h);
  assert.deepEqual(w.list.map((l) => l.id), ['sky', 'surface', 'h', 'a']);
  w.move('a', { below: 'h' });
  assert.deepEqual(w.list.map((l) => l.id), ['sky', 'surface', 'a', 'h']);
  assert.throws(() => w.move('a', { below: 'nope' }), (e: unknown) => e instanceof AslnutError && e.code === 'E-WORLD-002');
  assert.ok(Math.abs(planeAt(100, 0)[0] - 100 / 111319.49) < 1e-6);
  // fly and keys on the world clock
  void w.play(keys([{ at: 0, view: { lon: 0, lat: 0, dist: 300 } }, { at: 1, view: { lon: 0, lat: 0, dist: 150 } }]));
  for (let i = 0; i < 70; i++) w.step(1000 / 60);
  assert.ok(Math.abs(w.camera.dist - 150) < 1e-6);
  w.dispose();
});
test('state: what `when` reads is the same shape everywhere', () => {
  const s = makeState();
  for (const k of ['view', 'time', 'world', 'user', 'device', 'render'] as const) assert.ok(k in s);
});

test('the quadtree finds tiles over high ground (a tilted view near the ground)', () => {
  const cam = new Camera({ lon: 107.66, lat: -6.83, zoom: 12.4, tilt: 68 }); cam.update(480, 320, 16);
  for (const groundY of [0, 1440]) for (const hi of [0, 2500]) {
    const pose = poseOf({ lon: 107.66, lat: -6.83, dist: 24669, pitch: 0.3839 }, cam, groundY);
    assert.ok(wantFor(pose, { tilePx: 280, maxZoom: 20, maxTiles: 400, hiOf: () => hi }).length > 10, `groundY ${groundY} hi ${hi}`);
  }
});
test('quality as your function of the state; setQuality over it; w.control keeps the map within a zoom range', async () => {
  const { controllers } = await import('../src/index.ts');
  const w = await world(null, { view: { lon: 144.96, lat: -37.81, zoom: 10 }, render: { quality: (s) => (s.view.zoom > 14 ? 'realistic' : 'lite') } });
  assert.equal(w.state.render.quality, 'lite');
  w.go({ lon: 144.96, lat: -37.81, zoom: 16 }); w.step(16);
  assert.equal(w.state.render.quality, 'realistic');
  w.setQuality('lite'); assert.equal(w.state.render.quality, 'lite');
  w.setQuality(null);
  w.control(null, controllers.pan({ zoomRange: [8, 12] }));
  assert.equal(w.camera.gestures.rotate, false); assert.equal(w.camera.gestures.pan, true);
  w.step(16); assert.ok(Math.abs(w.camera.zoom - 12) < 0.01, `zoom held in: ${w.camera.zoom}`);
  w.go({ lon: 144.96, lat: -37.81, zoom: 3 }); w.step(16); assert.ok(Math.abs(w.camera.zoom - 8) < 0.01, `zoom held out: ${w.camera.zoom}`);
  w.control(null); assert.equal(w.camera.gestures.rotate, true);
  assert.throws(() => w.control({ id: 'loose' } as never, controllers.walk()), /E-WORLD-005/);
  w.dispose();
});

test('time zones: the place\'s zone (auto: the nearest principal place, loaded on first use), your own lookup, wall-clock times in a zone', async () => {
  const { zoneLookups, zonedTime, localTime } = await import('../src/core/time/zones.ts');
  const near = zoneLookups.nearest();
  assert.equal(await near(145.12, -37.92), 'Australia/Melbourne');
  assert.equal(await near(107.6, -6.9), 'Asia/Jakarta');
  assert.equal(await near(-0.1, 51.5), 'Europe/London');
  assert.equal(await near(-73.9, 40.7), 'America/New_York');
  assert.equal(await near(-125, -48), null, 'the open sea: solar time');
  const t = zonedTime('2026-01-15T15:00', 'Australia/Melbourne');
  assert.equal(t.toISOString(), '2026-01-15T04:00:00.000Z', 'daylight saving: +11');
  assert.equal(zonedTime('2026-07-10T14:00', 'Australia/Melbourne').toISOString(), '2026-07-10T04:00:00.000Z', 'winter: +10');
  assert.equal(localTime(t, 145, 'Australia/Melbourne').hour, 15);
  // a world whose clocks follow the place under the camera
  const w = await world(null, { body: earth({ imagery: [], terrain: [] }), view: { lon: 145.12, lat: -37.92, zoom: 15 }, time: t, timeZone: 'auto' });
  w.step(16); await new Promise((ok) => setTimeout(ok, 30)); w.step(16);
  assert.equal(w.state.time.local.zone, 'Australia/Melbourne'); assert.equal(w.state.time.local.hour, 15); assert.equal(w.timeZone, 'Australia/Melbourne');
  w.go({ lon: 106.8, lat: -6.2, zoom: 15 }); w.step(16); await new Promise((ok) => setTimeout(ok, 30)); w.step(16);
  assert.equal(w.state.time.local.zone, 'Asia/Jakarta'); assert.equal(w.state.time.local.hour, 11, 'Jakarta is 4 h behind Melbourne in January');
  // your own lookup; a fixed zone; none (solar time)
  w.setTimeZone((lon) => (lon > 0 ? 'Asia/Tokyo' : null)); w.step(16); await new Promise((ok) => setTimeout(ok, 10)); w.step(16);
  assert.equal(w.state.time.local.zone, 'Asia/Tokyo');
  w.setTimeZone('Europe/Paris'); w.step(16); assert.equal(w.state.time.local.zone, 'Europe/Paris');
  w.setTimeZone(undefined); w.step(16); assert.equal(w.state.time.local.zone, 'solar');
  w.dispose();
});

test('stars from a catalogue: parsed (VizieR rows or a pack), turned into the sky over a place by the sidereal time', async () => {
  const { parseStars, skyTurn, starData, catalogues, gmst } = await import('../src/modules/world/earth/air/sky/stars.ts');
  const rows = parseStars('#c\nRAICRS\tDEICRS\tVmag\tB-V\n------\t---\n101.2872\t-16.7161\t-1.44\t0.009\n279.2347\t38.7837\t0.03\t-0.001\n0.0\t0.0\t\t\n');
  assert.equal(rows.length, 2); assert.equal(rows[0]!.mag, -1.44);
  const d = starData(rows); assert.equal(d.length, 16); assert.ok(Math.abs(d[2]! - Math.sin((-16.7161 * Math.PI) / 180)) < 1e-6, 'Sirius first (the brightest)');
  const apply = (r: number[][], e: number[]) => r.map((row) => row[0]! * e[0]! + row[1]! * e[1]! + row[2]! * e[2]!);
  // the south celestial pole stands at the latitude's height, due south; the north one under the ground
  const t = Date.UTC(2026, 3, 15, 12, 0), r = skyTurn(t, 145.12, -37.92), south = apply(r, [0, 0, -1]), north = apply(r, [0, 0, 1]);
  assert.ok(Math.abs(Math.asin(south[1]!) * 180 / Math.PI - 37.92) < 1e-6 && south[2]! > 0.78 && Math.abs(south[0]!) < 1e-9);
  assert.ok(north[1]! < 0);
  // a star on the meridian at the latitude's declination is overhead (its right ascension the local sidereal time)
  const lst = gmst(t) + (145.12 * Math.PI) / 180, dec = (-37.92 * Math.PI) / 180, e = [Math.cos(dec) * Math.cos(lst), Math.cos(dec) * Math.sin(lst), Math.sin(dec)];
  assert.ok(apply(r, e)[1]! > 0.99999);
  // Sirius at 22:00 in Melbourne in mid-April (12:00 UTC): in the west, some 20–35° up
  const sir = apply(r, [Math.cos(-0.2918) * Math.cos(1.7678), Math.cos(-0.2918) * Math.sin(1.7678), Math.sin(-0.2918)]), alt = Math.asin(sir[1]!) * 180 / Math.PI;
  assert.ok(alt > 15 && alt < 40 && sir[0]! < -0.5, `Sirius at ${alt.toFixed(1)}°, east ${sir[0]!.toFixed(2)}`);
  // a catalogue of your own, cut to the magnitude
  const c = catalogues.custom({ load: () => rows }); assert.equal((await c.load({ magnitude: 0, loader: null })).length, 1);
  assert.match(catalogues.hipparcos().attribution, /Hipparcos/);
});
