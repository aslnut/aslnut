import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shown } from '../src/core/observation/presence.ts';
import { makeState, zoomForDist, distForZoom } from '../src/core/world/state.ts';
import { sortElements, type Orderable } from '../src/core/world/order.ts';
import { AslnutError } from '../src/core/world/errors.ts';

test('when: boolean, function, fraction', () => {
  const s = makeState({ view: { zoom: 9 } });
  assert.equal(shown(undefined, s), 1);
  assert.equal(shown(true, s), 1);
  assert.equal(shown(false, s), 0);
  assert.equal(shown((s) => s.view.zoom > 8, s), 1);
  assert.equal(shown((s) => s.view.zoom > 10, s), 0);
  assert.equal(shown(() => 0.25, s), 0.25);
  assert.equal(shown(() => 3, s), 1);
});
test('when: the shorthand, levels (one, a set, a range), hours wrap round midnight; the camera\'s keys are gone', () => {
  const names = ['world', 'country', 'region', 'city', 'district', 'street', 'building', 'room'];
  const at = (level: string, hour: number) => makeState({ observation: { level, index: names.indexOf(level), levels: names, by: 'orbit' }, time: { hour } });
  assert.equal(shown({ level: 'street' }, at('street', 12)), 1);
  assert.equal(shown({ level: 'street' }, at('district', 12)), 0);
  assert.equal(shown({ level: ['city', 'district'] }, at('district', 12)), 1);
  assert.equal(shown({ level: { from: 'district' } }, at('room', 12)), 1);
  assert.equal(shown({ level: { from: 'district' } }, at('city', 12)), 0);
  assert.equal(shown({ level: { from: 'city', to: 'district' } }, at('street', 12)), 0);
  assert.equal(shown({ hour: [18, 6] }, at('city', 23)), 1);
  assert.equal(shown({ hour: [18, 6] }, at('city', 3)), 1);
  assert.equal(shown({ hour: [18, 6] }, at('city', 12)), 0);
  assert.equal(shown({ level: 'city', hour: [18, 6] }, at('city', 12)), 0);
  assert.throws(() => shown({ level: 'moon' }, at('city', 12)), /no level 'moon'.*the levels: world/);
  assert.throws(() => shown({ zoom: [10, 22] } as never, at('city', 12)), /'when: \{ zoom \}' is gone/);
  assert.throws(() => shown({ level: 'city' }, makeState()), /a world with no levels/);
  const s = makeState({ device: { api: 'webgl2' }, user: { toggles: { crime: true } } });
  assert.equal(shown({ api: 'webgpu' }, s), 0);
  assert.equal(shown({ api: ['webgpu', 'webgl2'] }, s), 1);
  assert.equal(shown({ toggle: 'crime' }, s), 1);
  assert.equal(shown({ toggle: 'parks' }, s), 0);
});
test('when: wrong values fail with the fix', () => {
  const s = makeState();
  assert.throws(() => shown(() => 'yes' as unknown as boolean, s, 'layer heat'), (e: unknown) => e instanceof AslnutError && e.code === 'E-WHEN-001' && /boolean, or a number/.test(e.fix) && e.where === 'layer heat');
  assert.throws(() => shown({ zom: [1, 2] } as never, s), /unknown 'when' key 'zom'/);
  assert.throws(() => shown(() => { throw new Error('boom'); }, s), /threw: boom/);
});
test('state: s carries view, time, world, user, device, render', () => {
  const s = makeState({ view: { lon: 107.6, lat: -6.9, zoom: 12 }, params: { 'heat.gain': 2 }, readouts: { 'buildings.lit': 4 }, time: { now: new Date(Date.UTC(2026, 6, 1, 12)) } });
  assert.ok(Math.abs(s.view.zoom - 12) < 1e-9);
  assert.equal(s.world.params['heat.gain'], 2);
  assert.equal(s.world.readouts['buildings.lit'], 4);
  assert.ok(Math.abs(s.time.hour - (12 + 107.6 / 15)) < 1e-9);
  assert.equal(s.time.season, 'winter');   // July, southern hemisphere
  assert.equal(s.device.api, 'none');
  assert.equal(s.render.quality, 'realistic');
  for (const z of [2, 8, 15]) assert.ok(Math.abs(zoomForDist(distForZoom(z, 40), 40) - z) < 1e-9);
});

const L = (id: string, kind: Orderable['kind'], added: number, o: Partial<Orderable> = {}): Orderable => ({ id, kind, added, ...o });
const ids = (l: Orderable[]) => sortElements(l).map((x) => x.id).join(' ');
test('order: by kind, then add order', () => {
  assert.equal(ids([L('pts', 'point', 0), L('zones', 'area', 1), L('solar', 'raster', 2), L('wind', 'raster', 3), L('grid', 'line', 4)]), 'solar wind zones grid pts');
});
test('order: a number on the kind scale', () => {
  assert.equal(ids([L('zones', 'area', 0), L('grid', 'line', 1), L('crime', 'area', 2, { order: 3.5 })]), 'zones grid crime');
});
test('order: above / below, chains, and errors', () => {
  assert.equal(ids([L('a', 'area', 0), L('b', 'area', 1), L('c', 'area', 2), L('g', 'line', 3, { below: 'a' })]), 'g a b c');
  assert.equal(ids([L('a', 'area', 0), L('b', 'area', 1), L('x', 'point', 2, { above: 'a' }), L('y', 'point', 3, { above: 'a' })]), 'a x y b');
  assert.equal(ids([L('a', 'area', 0), L('y', 'point', 1, { above: 'x' }), L('x', 'point', 2, { above: 'a' })]), 'a x y');
  assert.throws(() => sortElements([L('a', 'area', 0, { above: 'nope' })]), (e: unknown) => e instanceof AslnutError && e.code === 'E-WORLD-002');
  assert.throws(() => sortElements([L('a', 'area', 0, { above: 'b' }), L('b', 'area', 1, { above: 'a' })]), /circle/);
});

test('a gate is asked again only when what it read changed: the fields read are written down', async () => {
  const { tracked, readsOf } = await import('../src/core/observation/presence.ts');
  const s = makeState({ params: { 'regions.province': 'JB' }, view: { zoom: 9 } });
  const rec = new Set<string>(), ts = tracked(s, rec);
  const gate = (d: { p: string }, st: typeof s) => d.p === st.world.params['regions.province'] && st.view.zoom > 8;
  assert.equal(gate({ p: 'JB' }, ts), true);
  const paths = [...rec].sort();
  assert.deepEqual(paths, ['view\u0001zoom', 'world\u0001params\u0001regions.province'].sort(), 'a key with a dot stays one part');
  const before = readsOf(s, paths);
  assert.equal(readsOf(s, paths), before, 'nothing changed: the same reads');
  (s.world.params as Record<string, unknown>)['regions.province'] = 'JT';
  assert.notEqual(readsOf(s, paths), before, 'the param changed: asked again');
});
