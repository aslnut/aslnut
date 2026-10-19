// core › data › scenarios on a world with no graphics: define on a base, use (sources swapped by layer or source id,
// params set, fields given other rules) and back to base, diff, and compare (twins beside the layers it changes).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, area, data, field, rules, AslnutError } from '../src/index.ts';

const sq = (id: string, x: number, v: number) => ({ type: 'Feature', id, properties: { v }, geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] } });
const fc = (fs: unknown[]) => data.geojson({ type: 'FeatureCollection', features: fs } as never);

test('scenarios: define, use, back to base; diff; compare', async () => {
  const w = await world(null, { view: { lon: 0.5, lat: 0.5, zoom: 7 } });
  const baseSrc = fc([sq('a', 0, 1), sq('b', 1, 2)]), planSrc = fc([sq('a', 0, 1), sq('b', 1, 5), sq('c', 2, 3)]);
  const blocks = area({ id: 'blocks', data: baseSrc, params: { gain: 1 } });
  const heat = field({ id: 'temp', res: 2000, area: { centre: [0.5, 0.5], size: 40000 }, rule: rules.diffusion({ k: 1 }), init: 20 });
  w.add(blocks, heat);
  assert.equal(w.scenario.current, 'base');
  assert.throws(() => w.scenario('base', {}), /as it is/);
  w.scenario('plan', { set: { blocks: planSrc }, params: { 'blocks.gain': 3 }, rules: { temp: { rule: rules.heat({ k: 0, relax: 0.1, to: 30 }) } } });
  w.scenario('plan-b', { base: 'plan', params: { 'blocks.gain': 4 } });
  assert.deepEqual(w.scenario.list(), ['base', 'plan', 'plan-b']);
  assert.equal(w.scenario.manager.resolved('plan-b').params['blocks.gain'], 4);
  assert.ok(w.scenario.manager.resolved('plan-b').set.blocks === planSrc, 'what its base swaps');

  w.scenario.use('plan');
  assert.equal(blocks.props.data, planSrc); assert.equal(w.get('blocks.gain'), 3);
  await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(heat.rule.name, 'heat');
  w.scenario.use('base');
  assert.equal(blocks.props.data, baseSrc); assert.equal(w.get('blocks.gain'), 1);
  await new Promise((ok) => setTimeout(ok, 10));
  assert.equal(heat.rule.name, 'diffusion');

  const d = await w.scenario.diff('base', 'plan');
  assert.deepEqual(d.added.map((x) => x.id), ['c']); assert.deepEqual(d.changed.map((x) => x.id), ['b']); assert.deepEqual(d.removed, []);
  assert.deepEqual(d.params, [{ key: 'blocks.gain', a: 1, b: 3 }]);
  assert.deepEqual(d.rules, [{ field: 'temp', a: 'diffusion', b: 'heat' }]);

  w.scenario.compare('base', 'plan', { view: 'split' });
  assert.ok(w.element('blocks--plan') && w.element('temp--plan'), 'twins of what plan changes');
  assert.equal((w.element('blocks--plan').props as { data: unknown }).data, planSrc);
  assert.equal(w.compareView!.at, 0.5);
  assert.ok(w.compareView!.leftHides.has(w.element('blocks--plan')) && w.compareView!.rightHides.has(blocks));
  w.scenario.setSplit(0.3); assert.equal(w.compareView!.at, 0.3);
  w.scenario.compare(null);
  assert.equal(w.compareView, null); assert.throws(() => w.element('blocks--plan'), AslnutError);

  w.scenario.compare('base', 'plan', { view: 'difference' });
  assert.ok(w.element('temp--plan--difference') && w.element('blocks--plan--removed'));
  assert.equal(blocks.props.when, false, 'a shown as its difference');
  w.scenario.compare(null);
  assert.notEqual(blocks.props.when, false);
  w.dispose();
});
