// Things in the air: a log's altitude (each sample's height over the ground or the sea: a value of its own, read
// between samples as its place is, kept through appends, rows, columns, a live source's points and a saved log), and a
// set's pose from its path (its pitch from its climb, its bank from its turn at its speed, eased; or the log's own
// columns): the numbers the chip's pose pass finds, worked out on the CPU the same way (set.attitude).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { history, Log } from '../src/core/data/history.ts';
import { dataDrive, entities, type EntitySet, type EntitySetProps } from '../src/core/entities/sets.ts';
import { data } from '../src/core/data/sources/index.ts';
import type { Made } from '../src/core/geometry/shapes/shape.ts';

const T0 = Date.UTC(2026, 9, 17, 0, 0, 0), L = 145.12, B = -37.92, G = 9.80665, DEG = Math.PI / 180;
// (on the sphere the log keeps places on: a circle of metres is a circle)
const KZ = 6378137 * DEG, kx = KZ * Math.cos(B * DEG);
/** a place `x` m east and `y` m north of (L, B) */
const at = (x: number, y: number): [number, number] => [L + x / kx, B + y / KZ];
/** a shape for a set (only its being there matters to the pose) */
const SHAPE = { levels: [new Float32Array(0), null, null], bounds: [[-1, 0, -1], [1, 1, 1]], size: null, parts: [] } as unknown as Made;
const setOf = (log: Log, attitude: EntitySetProps['attitude'], near?: { turn?: number }) => entities({ id: 'air', drive: dataDrive(log), shape: SHAPE, attitude, near }) as EntitySet;

test('log: an altitude a sample, over the ground or the sea: read between samples, kept by rows, columns and saves', () => {
  const log = history.log({ altitude: 'ground' });
  assert.deepEqual(log.altitude, { over: 'ground', value: 'alt' });
  assert.deepEqual(log.values.map((v) => [v.name, v.type]), [['alt', 'f32']], 'its own value, a 32-bit float by default');
  log.append('d', T0, ...at(0, 0), { alt: 20 });
  log.appendMany([{ id: 'd', t: T0 + 10e3, lon: at(100, 0)[0], lat: B, alt: 60 }]);
  const s = log.at('d', T0 + 5e3)!;
  assert.ok(Math.abs(s.alt! - 40) < 1e-9, `halfway between its samples: ${s.alt}`);
  assert.equal(s.values.alt, s.alt);
  assert.equal(log.altMax, 60);
  // (a place and its altitude at once, as a set's near things ask)
  const p: [number, number, number] = [0, 0, 0]; log.relOf(0, 2.5, p, true, log.altK()); assert.ok(Math.abs(p[2] - 30) < 1e-9);
  // over the sea, a byte over its domain (0.6 m a step); saved and read back with it
  const sea = history.log({ altitude: { over: 'sea', type: 'u8', domain: [0, 150] } });
  sea.append('p', T0, L, B, { alt: 75 }); sea.append('p', T0 + 1e3, L, B, { alt: 150 });
  const back = Log.fromBytes(sea.toBytes());
  assert.deepEqual(back.altitude, { over: 'sea', value: 'alt' });
  assert.ok(Math.abs(back.at('p', T0)!.alt! - 75) < 0.3, `a byte holds it within its step: ${back.at('p', T0)!.alt}`);
  assert.ok(Math.abs(back.altMax - 150) < 1e-6);
  // a log saved without an altitude, its value read as one when asked
  const plain = history.log({ values: { alt: 'f32' } }); plain.append('q', T0, L, B, { alt: 9 });
  const asked = Log.fromBytes(plain.toBytes(), { altitude: 'sea' });
  assert.deepEqual(asked.altitude, { over: 'sea', value: 'alt' }); assert.equal(asked.at('q', T0)!.alt, 9); assert.equal(asked.altMax, 9);
  assert.equal(Log.fromBytes(plain.toBytes()).altitude, null);
  // a recorded track's own array; a log without one has none (its things on the ground)
  const rec = history.fromColumns({ ids: ['a'], count: [2], t: [T0, T0 + 4e3], lon: [L, at(40, 0)[0]], lat: [B, B], alt: [0, 120] }, { altitude: 'ground' });
  assert.ok(Math.abs(rec.at('a', T0 + 1e3)!.alt! - 30) < 1e-6); assert.equal(rec.altMax, 120);
  assert.equal(history.log().altitude, null); assert.equal(history.log().at('x', T0), null);
  assert.throws(() => history.log({ altitude: { over: 'moon' as never } }), /altitude over 'moon'/);
});

test('drive.data: a live point\'s third coordinate is its altitude (unless its props say)', async () => {
  const rows = data.rows<{ id: string; lon: number; lat: number; t: number; alt?: number }>([], {});
  const d = dataDrive(rows, { log: { altitude: 'ground' } });
  await d.start({ loader: null as never, error: (e) => { throw e; } });
  rows.set({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'a', properties: { t: T0 }, geometry: { type: 'Point', coordinates: [L, B, 35] } }] } as never);
  rows.upsert([{ id: 'b', lon: L, lat: B, t: T0, alt: 12 }]);
  assert.equal(d.log.at('a', T0)!.alt, 35, 'its third coordinate');
  assert.equal(d.log.at('b', T0)!.alt, 12, 'its props');
  d.stop();
});

test('attitude: a level turn banks it by atan(v² / r g), into the turn, off the ground; a straight path keeps it level', () => {
  // a circle of 80 m at 15 m/s, a sample a second, clockwise seen from above (a right turn) and the other way
  const r = 80, v = 15, w = v / r, log = history.log({ altitude: 'ground', keep: Infinity });
  for (let k = 0; k <= 120; k++) {
    const a = w * k;
    log.append('right', T0 + k * 1e3, ...at(r * Math.sin(a), r * Math.cos(a)), { alt: 50 });
    log.append('left', T0 + k * 1e3, ...at(-r * Math.sin(a), r * Math.cos(a)), { alt: 50 });
    log.append('straight', T0 + k * 1e3, ...at(v * k, 0), { alt: 50 });
    // (the same turn on the ground, and just off it)
    log.append('taxi', T0 + k * 1e3, ...at(r * Math.sin(a), r * Math.cos(a)), { alt: 0 });
    log.append('low', T0 + k * 1e3, ...at(r * Math.sin(a), r * Math.cos(a)), { alt: 0.5 });
  }
  const set = setOf(log, { bank: true, pitch: true });
  const want = Math.atan((v * v) / (r * G)) / DEG;
  const right = set.attitude('right', T0 + 60e3)!, left = set.attitude('left', T0 + 60e3)!, straight = set.attitude('straight', T0 + 60e3)!;
  // (its chord between samples is a little shorter than the arc: within 2 %)
  assert.ok(Math.abs(right.bank - want) / want < 0.02, `right turn: ${right.bank.toFixed(2)}° (want ${want.toFixed(2)}°)`);
  assert.ok(Math.abs(left.bank + want) / want < 0.02, `left turn: ${left.bank.toFixed(2)}°`);
  assert.ok(Math.abs(straight.bank) < 1e-6 && Math.abs(straight.pitch) < 1e-6 && Math.abs(right.pitch) < 1e-6, 'level: no turn, no climb');
  // steady through the turn (a sample a second, eased over 2 s: no wobble from one sample to the next)
  const banks = Array.from({ length: 40 }, (_, k) => set.attitude('right', T0 + 40e3 + k * 250)!.bank);
  assert.ok(Math.max(...banks) - Math.min(...banks) < 0.05, `steady: ${Math.min(...banks).toFixed(3)} … ${Math.max(...banks).toFixed(3)}`);
  // on the ground it does not bank (a plane taxiing); off it, more as it rises, fully once as high as it is tall (1 m)
  assert.equal(set.attitude('taxi', T0 + 60e3)!.bank, 0);
  const low = set.attitude('low', T0 + 60e3)!.bank; assert.ok(Math.abs(low - want / 2) < 0.05, `half a metre up: ${low.toFixed(2)}° (half of ${want.toFixed(2)}°)`);
  // at most its most
  assert.ok(Math.abs(setOf(log, { bank: true, max: [30, 5] }).attitude('right', T0 + 60e3)!.bank - 5) < 1e-9);
});

test('attitude: a climb pitches it by the angle of its path; a sharp corner banks it in and out smoothly', () => {
  // climbing at 6° for a minute, then level, sparse samples (10 s apart)
  const log = history.log({ altitude: 'ground', keep: Infinity }), g = Math.tan(6 * DEG);
  for (let k = 0; k <= 12; k++) { const x = k * 200; log.append('climb', T0 + k * 10e3, ...at(x, 0), { alt: k <= 6 ? x * g : 1200 * g }); }
  const set = setOf(log, { pitch: true, bank: true });
  assert.ok(Math.abs(set.attitude('climb', T0 + 30e3)!.pitch - 6) < 0.01, `climbing: ${set.attitude('climb', T0 + 30e3)!.pitch.toFixed(3)}°`);
  assert.ok(Math.abs(set.attitude('climb', T0 + 90e3)!.pitch) < 1e-6, 'level again');
  const top = set.attitude('climb', T0 + 60e3)!.pitch;
  assert.ok(top > 0.5 && top < 5.5, `easing over at the top: ${top.toFixed(2)}°`);
  // a right-angle corner after 30 s of a straight road, 20 m/s: it banks only near the corner, rising and falling with
  // no jump; its heading's own turn (1.2 s either side) within the ease
  const c = history.log({ keep: Infinity });
  for (let k = 0; k <= 6; k++) c.append('c', T0 + k * 15e3, ...(k <= 3 ? at(0, k * 300) : at((k - 3) * 300, 900)));
  const cs = setOf(c, { bank: true }), bank = (s: number) => cs.attitude('c', T0 + s * 1e3)!.bank;
  assert.ok(Math.abs(bank(30)) < 1e-6 && Math.abs(bank(60)) < 1e-6, 'level along the straights');
  assert.ok(bank(45) > 20, `into the corner: ${bank(45).toFixed(1)}°`);
  let jump = 0; for (let s = 40; s < 50; s += 0.05) jump = Math.max(jump, Math.abs(bank(s + 0.05) - bank(s)));
  assert.ok(jump < 1.5, `no jump through the corner: at most ${jump.toFixed(2)}° in 50 ms`);
});

test('attitude: from the log\'s own columns (degrees, between samples), and none without one', () => {
  const log = history.log({ values: { pitch: 'f32', roll: { type: 'u8', domain: [-60, 60] } }, keep: Infinity });
  log.append('a', T0, L, B, { pitch: 2, roll: -30 }); log.append('a', T0 + 10e3, ...at(500, 0), { pitch: 10, roll: 30 });
  const set = setOf(log, { pitch: 'pitch', bank: 'roll' }), p = set.attitude('a', T0 + 5e3)!;
  assert.ok(Math.abs(p.pitch - 6) < 1e-6, `${p.pitch}`); assert.ok(Math.abs(p.bank) < 0.3, `${p.bank}`);
  assert.deepEqual(setOf(log, undefined).attitude('a', T0 + 5e3), { pitch: 0, bank: 0 });
  assert.throws(() => setOf(log, { pitch: 'nose' }).attitude('a', T0), /reads 'nose', a value its log has not/);
});

test('sets: a shape given as a Shape (a preset: drones.quad) is made, not taken for a made one', async () => {
  const { shape } = await import('../src/core/geometry/shapes/shape.ts');
  const box = shape({ id: 'test-box', build: (b) => { b.solid('box', { size: [1, 2, 1], at: [0, 1, 0] }); } });
  const log = history.log({ altitude: 'ground', keep: Infinity });
  log.append('a', T0, L, B, { alt: 10 }); log.append('a', T0 + 10e3, ...at(100, 0), { alt: 10 });
  const set = entities({ id: 'shaped', drive: dataDrive(log), shape: box, attitude: { bank: true } }) as EntitySet;
  // (its pose reads the shape's height: a Shape taken for a made one has none, and every frame failed)
  assert.deepEqual(set.attitude('a', T0 + 5e3), { pitch: 0, bank: 0 });
  const made = (set as unknown as { made(): Made }).made();
  assert.ok(Array.isArray(made.bounds) && made.bounds[1][1] > 1.9, `made: its bounds ${JSON.stringify(made.bounds)}`);
});
