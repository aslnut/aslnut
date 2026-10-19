import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, area, line, points, data, states, AslnutError, type WorldState } from '../src/index.ts';

const sq = (x: number, y: number, s: number, props: Record<string, unknown>, id: string) => ({ type: 'Feature', id, properties: props, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] } });
async function make() {
  const w = await world(null, { view: { lon: 144.96, lat: -37.81, zoom: 9 }, time: new Date('2026-10-12T04:00:00Z') });
  w.add(
    area({ id: 'crime', data: data.geojson({ type: 'FeatureCollection', features: [sq(144.9, -37.9, 0.1, { kind: 'a' }, 'x'), sq(145, -37.9, 0.1, { kind: 'b' }, 'y')] }), params: { glow: 0.5 } }),
    line({ id: 'roads', data: [], when: false }),
    points({ id: 'stations', data: [{ at: [144.95, -37.8] }] }),
  );
  return w;
}

test('states: capture → encode → decode → apply on another world → the same state', async () => {
  const a = await make();
  a.go({ lon: 145.01, lat: -37.85, zoom: 12.5, tilt: 40, bearing: 30 });
  a.set('crime.glow', 1.5); a.select(['x']); a.toggle('night', true); a.hide('stations');
  a.element('crime').setProps({ filter: { kind: ['a'] } } as never);
  a.step(16);
  const s = a.capture({ note: 'Where is it highest?' });
  assert.equal(s.note, 'Where is it highest?');
  assert.deepEqual(s.view, { lon: 145.01, lat: -37.85, zoom: 12.5, tilt: 40, bearing: 30 });
  assert.deepEqual(s.elements.crime, { shown: true, params: { glow: 1.5 }, filter: { kind: ['a'] } });
  assert.equal(s.elements.roads!.shown, false, 'its when is false'); assert.equal(s.elements.stations!.shown, false, 'hidden by hand');
  assert.deepEqual(s.selection, ['x']); assert.deepEqual(s.toggles, { night: true });
  const link = states.toURL(s, 'https://example.org/map?x=1');
  const back = states.fromURL(link)!;
  assert.deepEqual(back, s, 'the link carries it whole');
  const b = await make();
  const rep = await b.apply(back, { seconds: 0 });
  assert.deepEqual(rep, { missing: [], refused: [] });
  b.step(16);
  assert.deepEqual(b.capture({ note: 'Where is it highest?' }), s);
  assert.equal(b.time.toISOString(), '2026-10-12T04:00:00.000Z');
});

test('states: apply flies with an easing preset; layers it names that the world has not are reported, never made', async () => {
  const w = await make();
  const s: WorldState = { v: 1, view: { lon: 144.9, lat: -37.7, zoom: 11, tilt: 30, bearing: 10 }, elements: { crime: { shown: false }, ghost: { shown: true } }, selection: [] };
  const done = w.apply(s, { seconds: 1, ease: 'cinematic' });
  for (let i = 0; i < 70; i++) w.step(16.7);
  const rep = await done;
  assert.deepEqual(rep.missing, ['ghost']);
  assert.equal(w.element('crime').forced, false);
  assert.ok(Math.abs(w.camera.view.zoom - 11) < 1e-6 && Math.abs(w.camera.lon - 144.9) < 1e-9);
  assert.throws(() => w.element('ghost'));
});

test('states: diff lists what changed, path by path', async () => {
  const w = await make();
  const a = w.capture({ time: false }); w.go({ lon: 144.96, lat: -37.81, zoom: 10 }); w.hide('crime'); w.step(16);
  const b = w.capture({ time: false });
  assert.deepEqual(states.diff(a, b).map((c) => c.path), ['view.zoom', 'elements.crime.shown']);
});

test('states: the schema refuses what does not fit, naming the path and the fix', () => {
  const ok = { v: 1, view: { lon: 1, lat: 2, zoom: 3, tilt: 0, bearing: 0 }, elements: {}, selection: [] };
  assert.doesNotThrow(() => states.validate(ok));
  const bad = (x: unknown, re: RegExp) => assert.throws(() => states.validate(x), (e: unknown) => e instanceof AslnutError && e.code === 'E-STATE-001' && re.test(e.message));
  bad(null, /state: is not an object/);
  bad({ ...ok, v: 2 }, /state\.v/);
  bad({ ...ok, view: { ...ok.view, lat: 120 } }, /state\.view\.lat: 120 is outside -90\.\.90.*swap/);
  bad({ ...ok, view: { lon: 1, lat: 2, zoom: 3, tilt: 0 } }, /state\.view\.bearing/);
  bad({ ...ok, elements: { 'a.b': {} } }, /state\.elements\.a\.b: is not an element id/);
  bad({ ...ok, elements: { a: { shown: 'yes' } } }, /state\.elements\.a\.shown/);
  bad({ ...ok, elements: { a: { colour: 1 } } }, /state\.elements\.a\.colour: is not an element field/);
  bad({ ...ok, selection: [1] }, /state\.selection/);
  bad({ ...ok, time: 'yesterday' }, /state\.time/);
  bad({ ...ok, extra: 1 }, /state\.extra: is not a state field/);
  assert.throws(() => states.decode('%%%'), /could not be read/);
  assert.equal(states.schema.required.join(), 'v,view,elements,selection');
});

test('states: URL round trips preserve the clockwise viewing direction', async () => {
  const a = await world(null, { view: { lon: 0, lat: 0, zoom: 13, tilt: 45, bearing: 90 } });
  a.step(0);
  const state = states.fromURL(states.toURL(a.capture(), 'https://example.org/world'))!;
  assert.equal(state.view.bearing, 90);
  const b = await world(null);
  await b.apply(state, { seconds: 0 }); b.step(0);
  for (const w of [a, b]) assert.ok(w.camera.project(0.01, 0)![1] < w.camera.project(0, 0)![1], 'east stays screen up');
  a.dispose(); b.dispose();
});
