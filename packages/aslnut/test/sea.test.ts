// modules › world › earth › water › sea: the look's waves from the wind, and the shore's field of the coast
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FAR, LOOK, SHORE, coastField, coastSegments, localFrame, sea, waveSet } from '../src/modules/world/earth/water/sea/index.ts';
import type { Feature } from '../src/core/data/features.ts';
import { SEA_FLOATS, SEA_WAVES } from '../src/core/render/graphics/shaders/sea.wgsl.ts';

test('sea look: the wind raises a fully developed sea (Pierson and Moskowitz), the longest first, spread round its way', () => {
  for (const speed of [3, 6, 12]) {
    const w = waveSet({ speed, from: 225, count: 16 });
    assert.equal(w.length, 16);
    for (let i = 1; i < w.length; i++) assert.ok(w[i]!.k > w[i - 1]!.k, 'longest first');
    // the significant height: 4 √(Σ a² / 2) near 0.21 U² / g (the steepest short waves held back a little)
    const hs = 4 * Math.sqrt(w.reduce((s, x) => s + (x.a * x.a) / 2, 0)), want = (0.21 * speed * speed) / 9.81;
    assert.ok(hs > want * 0.6 && hs < want * 1.3, `${speed} m/s: Hs ${hs.toFixed(2)} m against ${want.toFixed(2)} m`);
    // they go the way the wind blows (from 225°: towards 45°, north-east: +x east, −z north), within 62° of it
    for (const x of w) { const ang = Math.atan2(x.dir[0], -x.dir[1]) * 180 / Math.PI; assert.ok(Math.abs(((ang - 45 + 540) % 360) - 180) <= 62.5, `a wave towards ${ang.toFixed(0)}°`); }
    // deep water: ω² = g k; together they never fold over (Σ q k a ≤ 0.6)
    for (const x of w) assert.ok(Math.abs(x.omega * x.omega - 9.81 * x.k) < 1e-6 * x.omega * x.omega + 1e-9);
    assert.ok(w.reduce((s, x) => s + x.q * x.k * x.a, 0) <= 0.6 + 1e-9);
  }
  // the same waves every time (seeded); a swell first when one is given, its length by its period (g T² / 2π)
  assert.deepEqual(waveSet({ speed: 7, from: 100 }), waveSet({ speed: 7, from: 100 }));
  const sw = waveSet({ speed: 6, from: 120, swell: { height: 1.2, period: 12, from: 225 }, count: 12 });
  assert.equal(sw.length, 12); assert.ok(Math.abs((2 * Math.PI) / sw[0]!.k - (9.81 * 144) / (2 * Math.PI)) < 0.01); assert.equal(sw[0]!.a, 0.6);
  assert.ok(SEA_WAVES >= 16 && SEA_FLOATS === 40 + SEA_WAVES * 8, 'the block holds them all');
});

test('sea shore: the coast\'s signed distance (+ at sea, − on land), within its band, the land on the line\'s left', () => {
  // a coast running north to south along x = 0 (the land on its left: east), in a frame of metres
  const segs = Float64Array.from([0, 500, 0, -500]), grid = { x0: -100, y0: 100, cell: 2, nx: 100, ny: 100 };
  const f = coastField(segs, grid, 60); assert.equal(f.step(), true);
  const at = (x: number, y: number) => f.out[Math.floor((grid.y0 - y) / grid.cell) * grid.nx + Math.floor((x - grid.x0) / grid.cell)]!;
  assert.ok(Math.abs(at(-21, 0) - 21) < 1.01, `west of it, at sea: ${at(-21, 0)}`);
  assert.ok(Math.abs(at(31, 0) + 31) < 1.01, `east of it, on land: ${at(31, 0)}`);
  assert.equal(at(-90, 0), FAR, 'beyond the band: not known');
  // made a slice at a time: the same field
  const g = coastField(segs, grid, 60); let n = 0; while (!g.step(0)) n++;
  assert.deepEqual(g.out, f.out);
  // an island (a polygon of land, whichever way it was drawn): out of it at sea, in it on land; a hole in it is sea
  const ring = (r: number, cw: boolean): [number, number][] => { const p: [number, number][] = [[-r, -r], [r, -r], [r, r], [-r, r], [-r, -r]]; return cw ? p.reverse() : p; };
  for (const cw of [false, true]) {
    const k = 1 / 111320, island: Feature = { id: 'i', props: {}, geometry: { type: 'Polygon', coordinates: [ring(40 * k, cw), ring(10 * k, !cw)] } };
    const s = coastSegments([island], localFrame([0, 0])), h = coastField(s, { x0: -60, y0: 60, cell: 1, nx: 120, ny: 120 }, 30); h.step();
    const v = (x: number, y: number) => h.out[Math.floor(60 - y) * 120 + Math.floor(x + 60)]!;
    assert.ok(v(50.5, 0.5) > 0, 'outside the island: sea'); assert.ok(v(25.5, 0.5) < 0, 'on it: land'); assert.ok(v(0.5, 0.5) > 0, 'its lagoon: sea');
  }
  // only the coast inside a box is gathered
  const line: Feature = { id: 'c', props: {}, geometry: { type: 'LineString', coordinates: [[0, 1], [0, 0], [0, -1], [0, -2]] } };
  assert.equal(coastSegments([line], localFrame([0, 0])).length, 12);
  assert.equal(coastSegments([line], localFrame([0, 0]), [-0.5, -0.5, 0.5, 0.5]).length, 8);
});

test('sea: pay only for what you set; it gives the world its sea, its defaults said once', () => {
  const s = sea();
  assert.equal(s.kind, 'custom');
  assert.equal(s.seaLevel({} as never), 0);
  assert.equal(sea({ level: () => 1.5 }).seaLevel({} as never), 1.5);
  // (headless: no graphics, no block)
  assert.equal(s.sea({} as never)?.look ?? null, null);
  assert.equal(s.wantsFrames({} as never), 0, 'nothing in view: no frames asked');
  assert.ok(LOOK.clarity > 0 && SHORE.surf > SHORE.runup);
});
