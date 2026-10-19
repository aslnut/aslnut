// The rods: relations over time (core › data › history), channels derived once into one log (core › data › history ›
// channels: constants, each item's own, a log's values by key (several summed), a relation's count as exact steps,
// formulas), and groups (core › space › regions › rollup: the job that puts members in areas, cells or by key, over time
// when they move, and aggregates their values: count, sum, mean, min, max, yours).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { history, Relations } from '../src/core/data/history.ts';
import { derive, logsOf } from '../src/core/data/channels.ts';
import { groupsJob, type GroupsJobIn } from '../src/core/space/groups.ts';

const T0 = Date.UTC(2026, 9, 18, 0, 0, 0), M = 60e3;
const at = (log: ReturnType<typeof history.log>, id: string, t: number) => log.at(id, t)!.values;

test('relations: windows of a member joined, the host at a time, what a host holds; from a log value', () => {
  const r = history.relations([
    { of: 'car-1', to: 'st-1', from: T0, until: T0 + 10 * M },
    { of: 'car-1', to: 'st-1', from: T0 + 5 * M, until: T0 + 20 * M },
    { of: 'car-2', to: 'st-1', from: T0 + 30 * M, until: T0 + 40 * M },
    { of: 'car-2', to: 'st-2', from: new Date(T0 + 50 * M), until: new Date(T0 + 55 * M) },
    { of: 'bad', to: 'st-2', from: T0 + 5, until: T0 + 5 },
  ]);
  assert.equal(r.rows.length, 4, 'an empty window is dropped');
  assert.deepEqual(r.windowsOf('car-1'), [[T0, T0 + 20 * M]], 'overlapping windows joined');
  assert.equal(r.hostOf('car-2', T0 + 35 * M), 'st-1'); assert.equal(r.hostOf('car-2', T0 + 45 * M), null); assert.equal(r.hostOf('car-2', T0 + 52 * M), 'st-2');
  assert.deepEqual(r.heldBy('st-1', T0 + 6 * M), ['car-1', 'car-1']); assert.deepEqual(r.heldBy('st-1', T0 + 35 * M), ['car-2']);
  const v = r.version; r.set([]); assert.ok(r.version > v); assert.equal(r.rows.length, 0);
  // from a log: a value naming each thing's host over time (0: none)
  const log = history.log({ values: { at: 'f32' } });
  for (const [k, h] of [[0, 0], [1, 2], [2, 2], [3, 0], [4, 1]] as const) log.append('car-9', T0 + k * M, 145, -37, { at: h });
  const rl = Relations.fromLog(log, { value: 'at', to: (x) => (x > 0 ? `st-${x}` : null) });
  assert.deepEqual(rl.rows.map((x) => [x.to, (x.from - T0) / M, (x.until - T0) / M]), [['st-2', 1, 3]], 'a host until the next sample names another (a last one with no time after: none)');
});

test('channels: constants, each item\'s own, a log value by key (several summed), a count as exact steps, a formula', () => {
  const ports = history.log({ values: { busy: 'f32' } });
  // two ports of one station: busy 0 → 1 at 10 min (one), the other 0 → 1 at 20 min
  ports.append('st-1-p1', T0, 145, -37, { busy: 0 }); ports.append('st-1-p1', T0 + 10 * M, 145, -37, { busy: 0 }); ports.append('st-1-p1', T0 + 10 * M, 145, -37, { busy: 1 }); ports.append('st-1-p1', T0 + 60 * M, 145, -37, { busy: 1 });
  ports.append('st-1-p2', T0, 145, -37, { busy: 0 }); ports.append('st-1-p2', T0 + 20 * M, 145, -37, { busy: 0 }); ports.append('st-1-p2', T0 + 20 * M, 145, -37, { busy: 1 }); ports.append('st-1-p2', T0 + 60 * M, 145, -37, { busy: 1 });
  const plugged = history.relations([{ of: 'car-1', to: 'st-1', from: T0 + 15 * M, until: T0 + 25 * M }]);
  const items = [{ id: 'st-1', props: { ports: 2, name: 'one' } }, { id: 'st-2', props: { ports: 4, name: 'two' } }];
  const chs = {
    k: 7, ports: (d: (typeof items)[number]) => d.props.ports,
    busy: { value: 'busy', key: (d: (typeof items)[number]) => [`${d.id}-p1`, `${d.id}-p2`] },
    cars: plugged.count,
    share: { formula: (v: Record<string, number>) => v.busy! / v.ports! },
  };
  assert.deepEqual(logsOf(chs, ports, items), [ports]);
  const cols = derive(items, chs, { log: ports });
  assert.equal(cols.size, 2);
  const a = (t: number) => at(cols, 'st-1', T0 + t * M);
  assert.equal(a(0).k, 7); assert.equal(a(0).ports, 2);
  assert.equal(a(5).busy, 0); assert.equal(a(9.99).busy, 0, 'a step held exactly up to it'); assert.ok(Math.abs(a(15).busy! - 1) < 1e-6, `one busy at 15 min: ${a(15).busy}`); assert.ok(Math.abs(a(30).busy! - 2) < 1e-6);
  assert.ok(Math.abs(a(30).share! - 1) < 1e-6, `the formula of the others: ${a(30).share}`);
  // the count holds exactly between its steps (never mixed across one)
  assert.equal(a(14.9).cars, 0); assert.equal(a(15).cars, 1); assert.equal(a(24.9).cars, 1); assert.equal(a(25).cars, 0);
  // an item with no samples of its own: its constants, its keys' none (0)
  const b = at(cols, 'st-2', T0 + 30 * M); assert.equal(b.ports, 4); assert.equal(b.busy, 0); assert.equal(b.cars, 0);
  // the members' mean charge while the host holds them (a car plugged in from 15 to 25 min: its charge 0.2 → 0.6)
  const cars = history.log({ values: { charge: 'f32' } });
  cars.append('car-1', T0, 145, -37, { charge: 0.1 }); cars.append('car-1', T0 + 15 * M, 145, -37, { charge: 0.2 }); cars.append('car-1', T0 + 25 * M, 145, -37, { charge: 0.6 });
  const mm = derive(items, { soc: plugged.members('mean', 'charge', cars), n: plugged.count, pct: { formula: (v) => v.c! * 100, inputs: { c: plugged.members('max', 'charge', cars) } } });
  const m = (t: number) => at(mm, 'st-1', T0 + t * M);
  assert.equal(m(14.9).soc, 0, 'none held: 0'); assert.ok(Math.abs(m(15).soc! - 0.2) < 1e-6, `held at 15: ${m(15).soc}`); assert.ok(Math.abs(m(20).soc! - 0.4) < 1e-6, `half way: ${m(20).soc}`); assert.equal(m(25).soc, 0, 'gone at 25');
  assert.ok(Math.abs(m(20).pct! - 40) < 1e-4, `a formula of its own inputs: ${m(20).pct}`);
  // each item's own log (a function: none for the second, 0)
  const own = derive(items, { busy: { value: 'busy', log: (d: (typeof items)[number]) => (d.id === 'st-1' ? ports : null), key: (d: (typeof items)[number]) => `${d.id}-p1` } });
  assert.equal(at(own, 'st-1', T0 + 30 * M).busy, 1); assert.equal(at(own, 'st-2', T0 + 30 * M).busy, 0);
});

/** members at places (still: one place each; moving: their samples), the job's input */
function job(places: [number, number, number?][][], by: GroupsJobIn['by'], ops: number[] = [0], vals?: { t: number[]; v: number[] }[]): GroupsJobIn {
  const off = new Int32Array(places.length + 1), t: number[] = [], x: number[] = [], y: number[] = [];
  places.forEach((ps, i) => { off[i] = x.length; for (const p of ps) { t.push(p[2] ?? -Infinity); x.push(p[0]); y.push(p[1]); } });
  off[places.length] = x.length;
  const vOff = new Int32Array(places.length + 1), vT: number[] = [], v0: number[] = [];
  places.forEach((_, i) => { vOff[i] = vT.length; for (let k = 0; k < (vals?.[i]?.t.length ?? 0); k++) { vT.push(vals![i]!.t[k]!); v0.push(vals![i]!.v[k]!); } });
  vOff[places.length] = vT.length;
  return { n: places.length, off, t: Float64Array.from(t), x: Float64Array.from(x), y: Float64Array.from(y), by, ops, chan: ops.map((o) => (o === 0 ? -1 : 0)), vOff, vT: Float64Array.from(vT), v: [Float32Array.from(v0)] };
}
const square = (w: number, s: number, e: number, n: number) => [w, s, e, s, e, n, w, n, w, s];

test('groups: members in areas (a hole kept out), counted; in cells; by key', () => {
  // two areas side by side; the first with a hole in its middle
  const rings = [...square(0, 0, 1, 1), ...square(0.4, 0.4, 0.6, 0.6), ...square(1, 0, 2, 1)];
  const by: GroupsJobIn['by'] = { kind: 'regions', groups: 2, rings: Float64Array.from(rings), ringOff: Int32Array.from([0, 5, 10, 15]), groupRings: Int32Array.from([0, 2, 3]), hole: Uint8Array.from([0, 1, 0]), box: Float64Array.from([0, 0, 1, 1, 1, 0, 2, 1]) };
  const r = groupsJob(job([[[0.2, 0.2]], [[0.5, 0.5]], [[0.8, 0.3]], [[1.5, 0.5]], [[3, 3]]], by));
  assert.deepEqual([...r.members], [2, 1], 'two in the first (one in its hole is out), one in the second, one in none');
  assert.equal(r.v[0]![r.off[0]!], 2); assert.equal(r.v[0]![r.off[1]!], 1);
  // cells of 1 km at the equator: two members together, one apart
  const c = groupsJob(job([[[0.001, 0.001]], [[0.002, 0.002]], [[0.05, 0.001]]], { kind: 'cells', size: 1000, lat0: 0 }));
  assert.equal(c.groups, 2); assert.deepEqual([...c.members], [2, 1]);
  const k = groupsJob(job([[[0, 0]], [[1, 1]], [[2, 2]]], { kind: 'keys', key: Int32Array.from([1, 0, 1]), groups: 2 }));
  assert.deepEqual([...k.members], [1, 2]);
});

test('groups: a moving member counted where it is over time (two samples at a step), sums and means of values, yours', () => {
  const by: GroupsJobIn['by'] = { kind: 'regions', groups: 2, rings: Float64Array.from([...square(0, 0, 1, 1), ...square(1, 0, 2, 1)]), ringOff: Int32Array.from([0, 5, 10]), groupRings: Int32Array.from([0, 1, 2]), hole: Uint8Array.from([0, 0]), box: Float64Array.from([0, 0, 1, 1, 1, 0, 2, 1]) };
  // a member in A from 0 to 10, in B from 10 on; another always in A
  const r = groupsJob(job([[[0.5, 0.5, 0], [0.5, 0.5, 5], [1.5, 0.5, 10], [1.5, 0.5, 20]], [[0.2, 0.2]]], by));
  const series = (g: number) => Array.from({ length: r.off[g + 1]! - r.off[g]! }, (_, s) => [r.t[r.off[g]! + s]!, r.v[0]![r.off[g]! + s]!]);
  assert.deepEqual(series(0), [[0, 2], [10, 2], [10, 1]], 'A: two, then (at 10, before and after) one');
  assert.deepEqual(series(1), [[0, 0], [10, 0], [10, 1]], 'B: none, then one');
  // values: two still members of one area, their values over time
  const one: GroupsJobIn['by'] = { kind: 'keys', key: Int32Array.from([0, 0]), groups: 1 };
  const vals = [{ t: [0, 10], v: [2, 4] }, { t: [0, 10], v: [6, 6] }];
  const s = groupsJob(job([[[0, 0]], [[0, 0]]], one, [1, 2, 3, 4], vals));
  const last = s.off[1]! - 1;
  assert.deepEqual([s.v[0]![last], s.v[1]![last], s.v[2]![last], s.v[3]![last]], [10, 5, 4, 6], 'sum, mean, min, max at the end');
  const f = groupsJob(job([[[0, 0]], [[0, 0]]], one, [5], vals), [(xs) => xs.reduce((a, b) => a * b, 1)]);
  assert.equal(f.v[0]![f.off[1]! - 1], 24, 'yours: their product');
});
