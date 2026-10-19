// core › data › history › epochs (headless): which epoch a time picks (at, before, between, after the list), the morph
// share, the window of epochs held near the time (loaded lazily, a few at most, ahead the way the clock runs), features
// morphed by id, a raster field fed by epochs (its values between two hours), and the errors (unsorted, not a time).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, epochs, Epochs, field, AslnutError } from '../src/index.ts';
import { makeState } from '../src/core/world/state.ts';

const H = 3600e3, T7 = Date.UTC(2026, 0, 15, 7);
const at = (h: number) => T7 + (h - 7) * H;
const stateAt = (ms: number, rate = 0) => { const s = makeState({ time: { now: new Date(ms) } }); s.time.rate = rate; return s; };

test('epochs: a time picks the epoch at or before it; before the first the first, after the last the last', () => {
  const ep = epochs([7, 8, 9, 10].map((h) => ({ at: at(h), source: h })));
  assert.deepEqual(ep.pick(at(7)), { i: 0, j: 0, f: 0 }, 'at the first');
  assert.deepEqual(ep.pick(at(6)), { i: 0, j: 0, f: 0 }, 'before it: the first');
  assert.deepEqual(ep.pick(at(8.5)), { i: 1, j: 1, f: 0 }, 'between: the one before (step)');
  assert.deepEqual(ep.pick(at(9)), { i: 2, j: 2, f: 0 }, 'at one: that one');
  assert.deepEqual(ep.pick(at(12)), { i: 3, j: 3, f: 0 }, 'after the last: the last');
  assert.deepEqual(ep.pick(new Date(at(8.25))), { i: 1, j: 1, f: 0 }, 'a Date');
  assert.deepEqual(ep.pick(new Date(at(9)).toISOString()), { i: 2, j: 2, f: 0 }, 'an ISO string');
  assert.equal(ep.from.getTime(), at(7)); assert.equal(ep.to.getTime(), at(10));
});

test('epochs: morph gives the next one\'s share by the time', () => {
  const ep = epochs([7, 8, 9].map((h) => ({ at: at(h), source: h })), { blend: 'morph' });
  assert.deepEqual(ep.pick(at(7.5)), { i: 0, j: 1, f: 0.5 }, '07:30: half way from 07:00 to 08:00');
  const p = ep.pick(at(8) + 15 * 60e3); assert.equal(p.i, 1); assert.equal(p.j, 2); assert.ok(Math.abs(p.f - 0.25) < 1e-9);
  assert.deepEqual(ep.pick(at(9)), { i: 2, j: 2, f: 0 }, 'at the last: nothing to blend');
  assert.deepEqual(ep.pick(at(6)), { i: 0, j: 0, f: 0 }, 'before the first: the first alone');
  // by a param of yours (a year)
  const years = epochs([2020, 2030, 2040].map((y) => ({ at: y, source: y })), { blend: 'morph', by: 'scenario.year' });
  assert.deepEqual(years.pick(2035), { i: 1, j: 2, f: 0.5 });
  const s = makeState({ params: { 'scenario.year': 2025 } }); years.update(s);
  assert.deepEqual(years.now, { i: 0, j: 1, f: 0.5 });
});

test('epochs: loaded lazily near the time (the one shown, the next, the one before, one ahead the way the clock runs), a few held at most', async () => {
  const calls: number[] = [];
  const ep = epochs(Array.from({ length: 24 }, (_, h) => ({ at: Date.UTC(2026, 0, 15, h), source: () => { calls.push(h); return Promise.resolve(new Float32Array(4).fill(h)); } })), { blend: 'morph', keep: 4 });
  assert.equal(calls.length, 0, 'nothing loaded before it is followed');
  ep.update(stateAt(Date.UTC(2026, 0, 15, 7, 30), 60));
  assert.deepEqual([...calls].sort((a, b) => a - b), [6, 7, 8, 9], 'the one before, the two shown, one ahead (the clock runs forwards)');
  assert.equal(ep.shown().a, undefined, 'not held until it arrives');
  assert.ok(ep.status().pending.length > 0, 'pending while the shown ones load');
  await new Promise((ok) => setTimeout(ok, 0));
  const sh = ep.shown(); assert.equal(sh.a![0], 7); assert.equal(sh.b![0], 8); assert.equal(sh.f, 0.5);
  // the clock moves on: the far ones let go, the new ones loaded
  ep.update(stateAt(Date.UTC(2026, 0, 15, 12, 10), 60)); await new Promise((ok) => setTimeout(ok, 0));
  const st = ep.epochStats();
  assert.ok(st.held <= 4, `a few held at most (${st.held})`);
  assert.ok(calls.includes(11) && calls.includes(12) && calls.includes(13) && calls.includes(14), 'around 12:10 and one ahead');
  assert.equal(st.bytes, st.held * 16, 'its memory: the grids it holds');
  assert.ok(st.dropped >= 2, 'the far ones let go');
  // backwards: one ahead the other way
  calls.length = 0; ep.update(stateAt(Date.UTC(2026, 0, 15, 3, 10), -60));
  assert.ok(calls.includes(1), `one behind when the clock runs back (${calls})`);
});

test('epochs: features step (the geometry) and morph their numbers by id', () => {
  const sq = (x: number) => ({ type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] });
  const ep = data.epochs([
    { at: at(7), source: [{ id: 'a', geometry: sq(0), props: { heat: 20, name: 'A' } }, { id: 'b', geometry: sq(2), props: { heat: 30 } }] },
    { at: at(8), source: { type: 'FeatureCollection', features: [{ id: 'a', type: 'Feature', geometry: sq(5), properties: { heat: 30, name: 'A2' } }] } },
  ], { blend: 'morph' }) as Epochs;
  const ctx = { loader: null as never, error: (e: unknown) => { throw e; } };
  ep.frame(stateAt(at(7.5)), ctx);
  const fs = ep.features();
  assert.equal(fs.length, 2, 'the earlier epoch\'s features');
  assert.equal(fs[0]!.props.heat, 25, 'a number half way');
  assert.equal(fs[0]!.props.name, 'A', 'a word the earlier one\'s');
  assert.deepEqual((fs[0]!.geometry as { coordinates: number[][][] }).coordinates[0]![0], [0, 0], 'the geometry steps');
  assert.equal(fs[1]!.props.heat, 30, 'one not in the next: as it is');
  const v = ep.version, sv = ep.shapeVersion;
  ep.frame(stateAt(at(7.75)), ctx);
  assert.equal(ep.features()[0]!.props.heat, 27.5);
  assert.ok(ep.version > v && ep.shapeVersion === sv, 'numbers changed, not shapes');
  ep.frame(stateAt(at(8)), ctx);
  assert.equal(ep.features().length, 1); assert.ok(ep.shapeVersion > sv, 'the next epoch: its shapes');
});

test('epochs: a raster field shows them (07:30 between the 07:00 and 08:00 grids)', () => {
  const AREA = { centre: [145.12, -37.92] as [number, number], size: 200 };
  const grid = (v: number) => new Float32Array(20 * 20).fill(v);
  const ep = epochs([{ at: at(7), source: grid(10) }, { at: at(8), source: grid(20) }, { at: at(9), source: () => grid(40) }], { blend: 'morph' });
  const f = field({ id: 'warm', res: 10, area: AREA, data: ep, draw: { ramp: 'inferno', domain: [10, 40] } });
  const step = (ms: number) => (f as unknown as { followEpochs(s: unknown): void }).followEpochs(stateAt(ms));
  step(at(7.5));
  assert.equal(f.at(AREA.centre), 15, 'half way');
  const p = f.probe({ at: AREA.centre });
  step(at(8.25)); assert.equal(f.at(AREA.centre), 25, 'a quarter on from 08:00');
  assert.equal(p.value, 25, 'its probe follows');
  assert.ok(p.series.length >= 2);
  assert.equal(f.values()[0], 25);
  assert.equal(f.legend().kind, 'continuous'); assert.deepEqual(f.legend().domain, [10, 40]);
  // a grid of another size is said, with its fix
  const bad = field({ id: 'bad', res: 10, area: AREA, data: epochs([{ at: at(7), source: new Float32Array(7) }]) });
  let said: unknown = null; (bad as unknown as { attached: unknown }).attached = { world: { error: (e: unknown) => { said = e; } } };
  (bad as unknown as { followEpochs(s: unknown): void }).followEpochs(stateAt(at(7)));
  assert.ok(said instanceof AslnutError && /7 numbers/.test(said.message) && said.fix, String(said));
});

test('epochs: errors say what to do (unsorted, empty, not a time, a rule and data)', () => {
  const e1 = (() => { try { epochs([{ at: at(8), source: 1 }, { at: at(7), source: 2 }]); } catch (e) { return e; } })() as AslnutError;
  assert.ok(e1 instanceof AslnutError && /time order/.test(e1.message) && /sort/.test(e1.fix ?? ''), 'unsorted');
  assert.throws(() => epochs([{ at: at(7), source: 1 }, { at: at(7), source: 2 }]), /time order/, 'two at one time');
  assert.throws(() => epochs([]), (e: unknown) => e instanceof AslnutError && !!e.fix);
  assert.throws(() => epochs([{ at: 'not a time', source: 1 }]), /not a time/);
  assert.throws(() => epochs([{ at: at(7), source: 1 }], { blend: 'fade' as never }), /blend/);
  assert.throws(() => field({ id: 'x', res: 10, area: { centre: [145, -37], size: 100 }, data: epochs([{ at: at(7), source: new Float32Array(100) }]), rule: (c) => c }), /a rule and data/);
});
