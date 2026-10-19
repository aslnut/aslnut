// core › data › history: the log (samples in typed columns, appended in time order, a live thing's ring), the state at
// any time (a place between two samples, its heading along its path, its values), a saved log read back, the
// smallest columns for some data, and the replay (play, pause, speed, seek, loop) on a clock. drive.data recording a
// live source into a log.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { history, Log, replay, smallest, type ClockWorld, type LogChange } from '../src/core/data/history.ts';
import { dataDrive } from '../src/core/entities/sets.ts';
import { data } from '../src/core/data/sources/index.ts';

const T0 = Date.UTC(2026, 9, 17, 0, 0, 0), L = 145.12, B = -37.92;
const kx = 111320 * Math.cos(B * Math.PI / 180), KZ = 110574;
const east = (m: number) => L + m / kx, north = (m: number) => B + m / KZ;
const metres = (a: [number, number], b: [number, number]) => Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * KZ);

test('log: a place between two samples, its heading along its path, its speed and values; held after its last', () => {
  const log = history.log({ values: { charge: { type: 'u8', domain: [0, 1] } } });
  log.append('v1', T0, L, B, { charge: 1 });
  log.append('v1', T0 + 10e3, east(100), B, { charge: 0.5 });
  log.append('v1', T0 + 20e3, east(100), north(100), { charge: 0 });
  const s = log.at('v1', T0 + 5e3)!;
  assert.ok(metres([s.lon, s.lat], [east(50), B]) < 0.01, `half way east: ${metres([s.lon, s.lat], [east(50), B])} m off`);
  assert.ok(Math.abs(s.heading - 90) < 0.01, `heading east ${s.heading}`);
  assert.ok(Math.abs(s.speed - 10) < 0.01, `10 m/s: ${s.speed}`);
  assert.ok(Math.abs(s.values.charge! - 0.75) < 1 / 255, `charge ${s.values.charge}`);
  const s2 = log.at('v1', T0 + 15e3)!;
  assert.ok(Math.abs(s2.heading - 0) < 0.01, `heading north ${s2.heading}`);
  const late = log.at('v1', T0 + 60e3)!;
  assert.equal(late.outside, 1); assert.equal(late.speed, 0); assert.ok(metres([late.lon, late.lat], [east(100), north(100)]) < 0.01);
  assert.equal(log.at('v1', T0 - 1)!.outside, -1);
  // an older sample than its last is dropped; a value not given keeps the last
  assert.equal(log.append('v1', T0 + 1e3, L, B), false);
  log.append('v1', T0 + 30e3, east(100), north(200));
  assert.ok(log.at('v1', T0 + 30e3)!.values.charge! < 1 / 255);
  assert.equal(log.samples, 4); assert.equal(log.size, 1);
  assert.equal(log.from, T0); assert.equal(log.to, T0 + 30e3);
  // (metres on the Web Mercator sphere: a degree of latitude is 111.3 km there, 0.7% more than this test's 110.6)
  assert.ok(Math.abs(log.maxSpeed - 10) < 0.1, `fastest ${log.maxSpeed}`);
});

test('log: standing still keeps the heading it came with; stateAt gives every thing', () => {
  const log = history.log();
  log.append('a', T0, L, B); log.append('a', T0 + 10e3, L, north(50)); log.append('a', T0 + 20e3, L, north(50)); log.append('a', T0 + 30e3, east(50), north(50));
  log.append('b', T0, east(10), B); log.append('b', T0 + 10e3, east(20), B);
  const a = log.at('a', T0 + 15e3)!;
  assert.equal(a.speed, 0); assert.ok(Math.abs(a.heading - 0) < 0.01, `still facing north: ${a.heading}`);
  const all = log.stateAt(T0 + 5e3);
  assert.deepEqual(all.map((x) => x.id), ['a', 'b']);
  assert.ok(Math.abs(all[1]!.heading - 90) < 0.01);
  assert.deepEqual(log.stateAt(T0 + 5e3, ['b']).map((x) => x.id), ['b']);
});

test('log: 16-bit places and times hold their precision; the smallest columns for some data', () => {
  const box: [number, number, number, number] = [145.08, -37.96, 145.17, -37.89];
  const t = smallest({ box, from: T0, to: T0 + 3600e3 });
  assert.equal(t.place.type, 'u16'); assert.equal(t.time.type, 'u16');
  assert.equal(smallest({ box: [144, -38.5, 146, -37], from: T0, to: T0 + 3600e3 }).place.type, 'f32');
  assert.equal(smallest({ box, from: T0, to: T0 + 30 * 3600e3 }).time.type, 'f32');
  const log = history.log({ place: t.place, time: t.time, values: { charge: 'u8' } });
  const pts: [number, number][] = [[145.1, -37.93], [145.11, -37.925], [145.15, -37.9]];
  // times on its steps (tenths): the places alone are rounded
  pts.forEach((p, i) => log.append('x', T0 + i * 61.4e3, p[0], p[1], { charge: i / 3 }));
  assert.ok(log.time instanceof Uint16Array && log.place instanceof Uint16Array && log.cols[0] instanceof Uint8Array);
  const step = Math.max((box[2] - box[0]) * kx, (box[3] - box[1]) * KZ) / 65535;
  pts.forEach((p, i) => { const s = log.at('x', T0 + i * 61.4e3)!; assert.ok(metres([s.lon, s.lat], p) <= step, `within one step (${step.toFixed(3)} m): ${metres([s.lon, s.lat], p)}`); });
  log.append('y', T0 + 61.37e3, 145.1, -37.93);
  assert.ok(Math.abs(log.secAt(log.slot(1, 0)) - 61.37) <= 0.05 + 1e-9, `time to a tenth: ${log.secAt(log.slot(1, 0))}`);
  assert.throws(() => log.append('x', T0 + 3 * 3600e3, 145.1, -37.9), /16-bit time/);
});

test('log: a live thing keeps `keep` samples (a ring): each append changes one slot; a recorded thing grows and keeps all', () => {
  const log = history.log({ keep: 32 }), seen: LogChange[] = [];
  log.watch((c) => seen.push(c));
  for (let i = 0; i < 100; i++) log.append('live', T0 + i * 1e3, east(i), B);
  assert.equal(log.count[0], 32);
  const s = log.at('live', T0 + 99e3)!; assert.ok(metres([s.lon, s.lat], [east(99), B]) < 0.01);
  assert.equal(log.at('live', T0 + 10e3)!.outside, -1, 'the oldest went');
  const after = seen.length; log.append('live', T0 + 100e3, east(100), B);
  const sampleChanges = seen.slice(after).filter((c) => c.kind === 'samples') as { lo: number; hi: number }[];
  assert.deepEqual(sampleChanges.map((c) => c.hi - c.lo), [1], 'one slot: the new bytes only');
  // a saved (recorded) log keeps every sample when appended to
  const rec = Log.fromBytes(log.toBytes(), { keep: 32 });
  for (let i = 101; i < 200; i++) rec.append('live', T0 + i * 1e3, east(i), B);
  assert.equal(rec.count[0], 32 + 99);
  assert.ok(metres(((s2) => [s2.lon, s2.lat] as [number, number])(rec.at('live', T0 + 150e3)!), [east(150), B]) < 0.01);
});

test('log: a stream\'s tick (a sample for each live thing) lands in one run of slots a group: the new bytes in a few writes', () => {
  const log = history.log({ keep: 64 }), runs: [number, number][] = [];
  for (let k = 0; k < 3; k++) for (let i = 0; i < 300; i++) log.append(`t${i}`, T0 + k * 1e3, east(i), north(k));
  log.watch((c) => { if (c.kind !== 'samples') return; const r = runs[runs.length - 1]; if (r && c.lo === r[1]) r[1] = c.hi; else runs.push([c.lo, c.hi]); });
  for (let i = 0; i < 300; i++) log.append(`t${i}`, T0 + 3e3, east(i), north(3));
  assert.equal(runs.length, 3, `groups of 16, 64, 256: ${JSON.stringify(runs)}`);
  assert.equal(runs.reduce((n, r) => n + r[1] - r[0], 0), 300, 'one slot a thing');
  const s = log.at('t150', T0 + 2.5e3)!; assert.ok(metres([s.lon, s.lat], [east(150), north(2.5)]) < 0.01);
  // its ring: 70 more each, the oldest gone, the newest where they should be
  for (let k = 4; k < 74; k++) for (let i = 0; i < 300; i += 37) log.append(`t${i}`, T0 + k * 1e3, east(i), north(k));
  const r = log.at('t148', T0 + 73e3)!; assert.ok(metres([r.lon, r.lat], [east(148), north(73)]) < 0.01); assert.equal(log.count[log.indexOf('t148')], 64);
});

test('log: a recorded track loaded in one go is packed (each thing\'s room made once, exactly)', () => {
  const log = history.log({ keep: Infinity }), rows = [];
  for (let v = 0; v < 100; v++) for (let i = 0; i < 37; i++) rows.push({ id: `v${v}`, t: T0 + i * 1e3, lon: east(v + i), lat: B, props: i ? undefined : { k: v % 3 } });
  assert.equal(log.appendMany(rows), 3700);
  assert.equal(log.used, 3700, `slots used: ${log.used}`); assert.equal(log.props[5]!.k, 2);
  const s = log.at('v7', T0 + 10.5e3)!; assert.ok(metres([s.lon, s.lat], [east(17.5), B]) < 0.01);
  // more for some: moved once, to as many as they hold
  log.appendMany([{ id: 'v1', t: T0 + 40e3, lon: east(50), lat: B }, { id: 'v1', t: T0 + 41e3, lon: east(51), lat: B }]);
  assert.equal(log.cap[1], 39); const v1 = log.at('v1', T0 + 41e3)!; assert.ok(metres([v1.lon, v1.lat], [east(51), B]) < 0.01);
});

test('log: saved and read back as it was (columns as views of the bytes, nothing copied)', () => {
  const t = smallest({ box: [145.08, -37.96, 145.17, -37.89], from: T0, to: T0 + 3600e3 });
  const log = history.log({ id: 'fleet', place: t.place, time: t.time, values: { charge: { type: 'u8', domain: [0, 1] }, speed: 'f32' } });
  for (let v = 0; v < 50; v++) for (let i = 0; i < 20; i++) log.append(`v${v}`, T0 + i * 7e3 + v * 13, 145.1 + v * 1e-4 + i * 2e-4, -37.93 + i * 1e-4, { charge: 1 - i / 20, speed: i }, i === 0 ? { kind: v % 2 ? 'taxi' : 'van' } : undefined);
  const bytes = log.toBytes(), back = Log.fromBytes(bytes);
  assert.equal(back.size, 50); assert.equal(back.samples, 1000);
  assert.equal(back.props[3]!.kind, 'taxi');
  assert.ok(back.place.buffer === bytes.buffer, 'the place column is a view of the bytes');
  for (const tt of [T0 + 3e3, T0 + 50e3, T0 + 140e3]) {
    const a = log.stateAt(tt), b = back.stateAt(tt);
    a.forEach((x, k) => { const y = b[k]!; assert.equal(x.id, y.id); assert.ok(Math.abs(x.lon - y.lon) < 1e-9 && Math.abs(x.lat - y.lat) < 1e-9); assert.ok(Math.abs(x.values.charge! - y.values.charge!) < 1e-6); assert.equal(x.values.speed, y.values.speed); });
  }
  // its densest windows saved with it: a window it keeps (30 s) exactly, another from the next longer one (never fewer)
  assert.equal(back.densest(30), log.densest(30));
  assert.ok(back.densest(20) >= log.densest(20) && log.densest(20) >= 3 && log.densest(20) <= 4, `samples within 20 s: ${log.densest(20)} (saved: ${back.densest(20)})`);
  assert.deepEqual(back.bounds(), log.bounds(), 'its box saved with it');
});

/** a clock as the world keeps it: time, rate, frames */
function clock(): ClockWorld & { tick(ms: number): void } {
  const fns = new Set<(e: { dt: number }) => void>();
  const w = {
    time: new Date(T0), timeRate: 0,
    setTime(t: Date | 'now', o: { rate?: number } = {}) { if (t !== 'now') w.time = new Date(t.getTime()); w.timeRate = o.rate ?? 0; },
    setTimeRate(r: number) { w.timeRate = r; },
    on(_ev: 'frame', f: (e: { dt: number }) => void) { fns.add(f); return () => fns.delete(f); },
    tick(ms: number) { w.time = new Date(w.time.getTime() + ms * w.timeRate); for (const f of fns) f({ dt: ms }); },
  };
  return w;
}

test('replay: play runs the clock at its speed, pause stands it, seek is one change, the end stops or loops', () => {
  const w = clock(), why: string[] = [];
  const p = replay(w, { from: T0, to: T0 + 3600e3, speed: 60 });
  p.on((_x, y) => why.push(y));
  assert.equal(p.playing, false); assert.equal(w.timeRate, 0);
  p.play(); assert.equal(w.timeRate, 60);
  w.tick(1000); assert.equal(w.time.getTime(), T0 + 60e3);
  p.setSpeed(240); assert.equal(w.timeRate, 240);
  p.pause(); assert.equal(w.timeRate, 0); w.tick(1000); assert.equal(w.time.getTime(), T0 + 60e3);
  p.seek(T0 + 1800e3); assert.equal(w.time.getTime(), T0 + 1800e3); assert.equal(w.timeRate, 0);
  p.seek(0.25, { share: true }); assert.equal(p.progress, 0.25);
  p.seek(T0 + 3590e3); p.play(); w.tick(1000); assert.equal(p.playing, false); assert.equal(w.time.getTime(), T0 + 3600e3);
  // playing again from the end starts over
  p.play(); assert.equal(w.time.getTime(), T0);
  assert.deepEqual(why.slice(0, 4), ['play', 'speed', 'pause', 'seek']);
  assert.ok(why.includes('end'));
  p.dispose();
});

test('replay: looping wraps round to the start', () => {
  const w = clock();
  const p = replay(w, { from: T0, to: T0 + 60e3, speed: 30, loop: true, play: true });
  w.tick(2500);   // 75 s on: past the end by 15 s
  assert.equal(p.playing, true); assert.equal(w.time.getTime(), T0 + 15e3);
});

test('drive.data: a live source recorded into a log, each changed row a sample (the others untouched)', async () => {
  const rows = data.rows<{ id: string; lon: number; lat: number; t: number; charge: number }>([], {});
  const d = dataDrive(rows, { log: { values: { charge: 'u8' } } });
  await d.start({ loader: null as never, error: (e) => { throw e; } });
  rows.upsert([{ id: 'a', lon: L, lat: B, t: T0, charge: 1 }, { id: 'b', lon: east(10), lat: B, t: T0, charge: 0.5 }]);
  rows.upsert([{ id: 'a', lon: east(20), lat: B, t: T0 + 2e3, charge: 0.9 }]);
  assert.equal(d.log.size, 2); assert.equal(d.log.samples, 3);
  const a = d.log.at('a', T0 + 1e3)!; assert.ok(metres([a.lon, a.lat], [east(10), B]) < 0.01);
  assert.equal(d.smooth, 250);
  d.stop();
});
