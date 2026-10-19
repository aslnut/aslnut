// core › simulation › fields on the CPU path (the chip's path is checked against it in the browser smoke, on WebGPU and
// WebGL2): the ready rules keep what they should, move what they should; probes; kernels; custom rules.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { field, rules, kernel, constants, world } from '../src/index.ts';

const AREA = { centre: [145.12, -37.92] as [number, number], size: 400 };
const sum = (a: Float32Array) => a.reduce((s, v) => s + v, 0);

test('fields: a raster over an area, cells and places agree', () => {
  const f = field({ id: 'f', res: 10, area: AREA, rule: rules.diffusion() });
  assert.equal(f.w, 40); assert.equal(f.h, 40);
  const c = f.lonLatOf(12, 30), back = f.cellOf(c[0], c[1]);
  assert.deepEqual(back, [12, 30]);
  assert.equal(f.cellOf(150, 0), null);
  assert.equal(f.runsOn, 'cpu');
});

test('fields: diffusion spreads a spike and keeps its total', () => {
  const init = new Float32Array(40 * 40); init[20 * 40 + 20] = 1000;
  const f = field({ id: 'd', res: 10, area: AREA, rule: rules.diffusion({ k: 5 }), init });
  const t0 = sum(f.values());
  f.step(60);
  const v = f.values();
  assert.ok(Math.abs(sum(v) - t0) < 1e-2, `total ${sum(v)} vs ${t0}`);
  assert.ok(v[20 * 40 + 20]! < 1000 && v[20 * 40 + 21]! > 0, 'spread to the neighbours');
  assert.ok(f.time >= 59 && f.time <= 61);
});

test('fields: advection carries a blob downwind (east)', () => {
  const f = field({ id: 'a', res: 10, area: AREA, rule: rules.advection({ wind: [4, 0] }), init: (lon) => (Math.abs(lon - 145.1195) < 0.0003 ? 1 : 0) });
  const before = f.values(), cx = (v: Float32Array) => { let s = 0, m = 0; for (let j = 0; j < 40; j++) for (let i = 0; i < 40; i++) { s += i * v[j * 40 + i]!; m += v[j * 40 + i]!; } return s / m; };
  f.step(40);
  assert.ok(cx(f.values()) - cx(before) > 14 && cx(f.values()) - cx(before) < 18, `moved ${cx(f.values()) - cx(before)} cells (≈ 16 expected)`);
});

test('fields: heat relaxes towards its target; a source warms', () => {
  const f = field({ id: 'h', res: 10, area: AREA, rule: rules.heat({ k: 0, relax: 0.01, to: 20 }), init: 40 });
  f.step(100);
  assert.ok(Math.abs(f.at(AREA.centre) - (20 + 20 * Math.exp(-1))) < 0.6, `at ${f.at(AREA.centre)}`);
  const g = field({ id: 'h2', res: 10, area: AREA, rule: rules.heat({ k: 0, sourceScale: 0.1 }), init: 0, inputs: { source: 1 } });
  g.step(10);
  assert.ok(Math.abs(g.at(AREA.centre) - 1) < 1e-3);
});

test('fields: shallow water runs downhill, keeps its volume, pools in the low side', () => {
  // a ground sloping down to the east 5 m over the area; 0.5 m of water on the west quarter
  const f = field({ id: 'w', res: 10, area: AREA, rule: rules.shallowWater({ friction: 0.2 }), inputs: { ground: (lon) => 5 - (lon - 145.1177) * 2200 }, init: (lon) => (lon < 145.119 ? 0.5 : 0) });
  const v0 = sum(f.values());
  const p = f.probe({ over: [[145.1215, -37.9218], [145.1223, -37.9218], [145.1223, -37.9182], [145.1215, -37.9182]] });
  for (let k = 0; k < 20; k++) f.step(30);
  const v = f.values();
  assert.ok(Math.abs(sum(v) - v0) / v0 < 1e-3, `volume ${sum(v)} vs ${v0}`);
  assert.ok(v.every((x) => x >= 0), 'no negative depth');
  assert.ok(p.value > 0.05, `the east side filled: ${p.value}`);
  assert.ok(p.series.length > 2 && p.series.at(-1)![1] > p.series[0]![1]);
});

test('fields: rain fills flat ground at its rate (flow)', () => {
  const f = field({ id: 'r', res: 10, area: AREA, rule: rules.flow({ rain: 1e-4 }), inputs: { ground: 0 }, init: 0 });
  f.step(100);
  assert.ok(Math.abs(f.at(AREA.centre) - 0.01) < 1e-4, `depth ${f.at(AREA.centre)}`);
});

test('fields: custom rules (CPU) and kernels (with their CPU twin) step the same as diffusion', () => {
  const init = new Float32Array(40 * 40); init[20 * 40 + 20] = 100;
  const a = field({ id: 'k1', res: 10, area: AREA, rule: rules.diffusion({ k: 2 }), init, dt: 5 });
  const b = field({ id: 'k2', res: 10, area: AREA, rule: rules.custom((c, n, dt, p) => c + dt * p.k! * n.laplacian, { params: { k: 2 } }), init, dt: 5 });
  const c = field({ id: 'k3', res: 10, area: AREA, rule: kernel({ wgsl: 'next = cur + dt * k * laplacian(cur);', params: { k: 2 }, cpu: (cur, n, dt, p) => cur + dt * p.k! * n.laplacian }), init, dt: 5 });
  for (const f of [a, b, c]) f.step(50);
  assert.ok(Math.abs(a.at(AREA.centre) - b.at(AREA.centre)) < 1e-4 && Math.abs(a.at(AREA.centre) - c.at(AREA.centre)) < 1e-4);
  assert.ok(c.rule.wgsl!.includes('let k = u.p0.x;') && c.rule.glsl!.includes('float k = u.p0.x;'));
  assert.throws(() => field({ id: 'k4', res: 10, area: AREA, rule: kernel({ wgsl: 'next = cur;' }) }).step(1), /no CPU path/);
  assert.throws(() => field({ id: 'k5', res: 10, area: AREA, rule: rules.diffusion(), params: { nope: 1 } }), /no number 'nope'/);
});

test('constants: citable tables, one number by its path, your own table, materials for the heat model', () => {
  const m = constants.load('materials');
  assert.equal(m.asphalt!.albedo!.value, 0.08); assert.ok(m.asphalt!.albedo!.source.length > 10); assert.equal(m.asphalt!.rhoC!.unit, 'J/m³K');
  assert.equal(constants.get('physics.sigma'), 5.67e-8);
  assert.throws(() => constants.get('materials.nope.albedo'), /no constant/);
  constants.add('mine', { basalt: { albedo: { value: 0.1, unit: '', source: 'test' } } });
  assert.equal(constants.get('mine.basalt.albedo'), 0.1);
  assert.throws(() => constants.add('bad', { x: { y: { value: 1 } as never } }), /needs \{ value, unit, source \}/);
  const [a] = constants.materials(['asphalt']); assert.equal(a!.albedo, 0.08); assert.equal(a!.label, 'Asphalt road');
});

test('constants: what a world adds stays its own (w.constants, a scope of the process\'s tables); constants.add is the process\'s, seen by every world', async () => {
  const a = await world(null), b = await world(null);
  a.constants.add('site', { slab: { albedo: { value: 0.3, unit: '', source: 'a survey' } } });
  a.constants.add('materials', { asphalt: { albedo: { value: 0.2, unit: '', source: 'a fresh coat' } } });
  assert.equal(a.constants.get('site.slab.albedo'), 0.3);
  assert.throws(() => b.constants.get('site.slab.albedo'), /no constant/, 'the other world does not see it');
  assert.throws(() => constants.get('site.slab.albedo'), /no constant/, 'nor the process');
  assert.equal(a.constants.materials(['asphalt'])[0]!.albedo, 0.2, 'its own value over the table');
  assert.equal(a.constants.get('materials.grass.albedo'), constants.get('materials.grass.albedo'), 'the rest of the table as the process has it');
  assert.equal(b.constants.materials(['asphalt'])[0]!.albedo, 0.08); assert.equal(constants.get('materials.asphalt.albedo'), 0.08);
  // the process's own: every world sees it (also one made before), as the docs say
  constants.add('shared', { x: { k: { value: 2, unit: '', source: 'test' } } });
  assert.equal(a.constants.get('shared.x.k'), 2); assert.equal(b.constants.get('shared.x.k'), 2);
  assert.ok(b.constants.names().includes('shared') && !b.constants.names().includes('site') && a.constants.names().includes('site'));
  // a scope of a scope: reads both, keeps its own
  const s = a.constants.scope(); s.add('site', { slab: { emissivity: { value: 0.9, unit: '', source: 'test' } } });
  assert.equal(s.get('site.slab.albedo'), 0.3); assert.equal(s.get('site.slab.emissivity'), 0.9);
  assert.throws(() => a.constants.get('site.slab.emissivity'), /no constant/);
  a.dispose(); b.dispose();
});
