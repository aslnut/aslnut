// Layers stacked over a twin: where each mark sits (core › geometry › marks › drape), what showing, opacity and order
// need from a layer (core › world › elements: one frame, nothing built again), and the layer list (kits › dashboard ›
// layers) described for your own UI. Headless: no graphics, the same answers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, area, line, points, text, arc, raster, layer, DRAPE_DEFAULTS, drapeOf, layers, AslnutError, Tiled, type ElementChange } from '../src/index.ts';

const box = (w: number, s: number, e: number, n: number, id: string) => ({ id, props: { v: 1 }, geometry: { type: 'Polygon' as const, coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] } });
const ln = (id: string) => ({ id, props: {}, geometry: { type: 'LineString' as const, coordinates: [[107.6, -6.9], [107.61, -6.91]] } });

test('where a mark sits: one place for the defaults, a layer\'s own drape, the older props as before', () => {
  assert.deepEqual(DRAPE_DEFAULTS, { area: 'over', line: 'ground', raster: 'over', point: 'above', label: 'above', arc: 'above' });
  assert.equal(drapeOf(undefined, 'area'), 'over'); assert.equal(drapeOf(true, 'line'), 'ground'); assert.equal(drapeOf(false, 'area'), 'free'); assert.equal(drapeOf('above', 'line'), 'above');
  const a = area({ id: 'a', data: [box(107.6, -6.9, 107.7, -6.8, 'x')] }), l = line({ id: 'l', data: [ln('r')] }), p = points({ id: 'p', data: [{ at: [107.6, -6.9] }] });
  assert.deepEqual([a.sits, l.sits, p.sits], ['over', 'ground', 'above']);
  assert.equal(a.draped, true, 'over: draped (its ground part, and its part over the solids)');
  assert.equal(area({ id: 'b', data: [], drape: 'above' }).draped, false, 'above: floating, not draped');
  assert.equal(area({ id: 'c', data: [], drape: 'above' }).order, 4.5, 'above: after the buildings, under the points');
  assert.equal(area({ id: 'd', data: [] }).order, undefined, 'over and ground keep the area place');
  // the older props: a line's or an arc's over, a label's occlude, unless drape says otherwise
  assert.equal(line({ id: 'e', data: [], over: true }).sits, 'above');
  assert.equal(line({ id: 'f', data: [], over: true, drape: 'ground' }).sits, 'ground', 'drape wins');
  assert.equal(text({ id: 'g', data: [], text: () => 'x', occlude: false }).sits, 'above');
  assert.equal(text({ id: 'h', data: [], text: () => 'x', occlude: true }).sits, 'ground');
  assert.equal(text({ id: 'i', data: [], text: () => 'x' }).sits, 'above', 'unset: the labels\' default');
  assert.equal(arc({ id: 'j', data: [], from: () => [0, 0], to: () => [1, 1], over: false }).sits, 'ground');
  assert.equal(line({ id: 'k', data: [], drape: false }).draped, false, 'false: each vertex at the ground\'s height');
  // a picture over a box: a draped area of its own (its default: the pictures')
  const pic = raster({ id: 'pic', source: raster.image({ url: '/p.png', bounds: [107.6, -6.95, 107.7, -6.85] }) });
  assert.equal(pic.kind, 'area'); assert.equal(pic.sits, 'over'); assert.equal(pic.fades, true);
  assert.throws(() => raster.image({ url: '/p.png', bounds: [1, 2, 0, 3] }), (e: unknown) => e instanceof AslnutError && e.code === 'E-DATA-001');
});

test('showing, opacity and order: uniforms and the draw order, nothing styled again; the world tells a list', async () => {
  const w = await world(null), seen: ElementChange[] = [];
  w.on('elements', (c) => seen.push(c));
  const a = area({ id: 'a', data: [box(107.6, -6.9, 107.7, -6.8, 'x')], color: '#ff0000', opacity: 0.5 }), l = line({ id: 'l', data: [ln('r')] }), p = points({ id: 'p', data: [{ at: [107.6, -6.9] }] });
  w.add(a, l, p);
  assert.deepEqual(seen.at(-1), { what: 'add', ids: ['a', 'l', 'p'] });
  // the opacity is a uniform: nothing styled again (a colour is)
  const scales = () => (a as unknown as { seen: { scales: string } }).seen.scales;
  const before = scales();
  w.setOpacity('a', 0.2);
  assert.equal(a.props.opacity, 0.2); assert.equal(scales(), before, 'no restyle for an opacity');
  assert.deepEqual(seen.at(-1), { what: 'opacity', ids: ['a'] });
  a.setProps({ color: '#00ff00' }); assert.notEqual(scales(), before, 'a colour restyles');
  assert.throws(() => w.setOpacity('nothing', 1), /no element/);
  // the stack: a line under the area, each kept in its band (the point stays over the twin's solids)
  w.reorder(['l', 'a', 'p']);
  assert.deepEqual(w.list.filter((x) => ['a', 'l', 'p'].includes(x.id)).map((x) => x.id), ['l', 'a', 'p']);
  assert.ok(l.order! > 2 && l.order! < 3 && a.order! > l.order! && p.order! > 5 && p.order! < 6);
  assert.deepEqual(seen.at(-1), { what: 'order', ids: ['l', 'a', 'p'] });
  // showing by hand in one frame (seconds: 0), and back to its own `when`
  w.step(1000); assert.equal(a.shown, 1, 'faded in (its own length, the first time)');
  w.hide('a', { seconds: 0 }); w.step(16);
  assert.equal(a.shown, 0, 'hidden in one frame'); assert.equal(a.once, null, 'the one-off length used once');
  w.release('a', { seconds: 0 }); w.step(16); assert.equal(a.shown, 1, 'shown again in one frame');
  w.hide('a'); w.step(16); assert.ok(a.shown > 0 && a.shown < 1, 'without seconds: its own fade');
  assert.ok(seen.some((c) => c.what === 'shown' && c.ids.includes('a')));
  w.remove('p'); assert.deepEqual(seen.at(-1), { what: 'remove', ids: ['p'] });
  w.dispose();
});

test('the layer list as data: groups, parts, state, legends; it shows, fades and restacks', async () => {
  const w = await world(null);
  const a = area({ id: 'suburbs', label: 'Suburbs', data: [box(107.6, -6.9, 107.7, -6.8, 'x')], color: '#ff0000', opacity: 0.5 });
  const l = line({ id: 'bike', label: 'Bike', data: [ln('r')], color: '#22d3ee' }), p = points({ id: 'stops', label: 'Stops', data: [{ at: [107.6, -6.9] }] });
  const odd = line({ id: 'odd', label: 'Unlisted', data: [] });
  w.add(a, l, p, odd);
  let relief = true;
  const list = layers(w, { groups: { Data: ['suburbs', 'bike', 'stops'], Twin: [{ id: 'terrain', label: 'Terrain', shown: () => relief, show: (on) => { relief = on; } }] } });
  assert.equal(list.el, null, 'headless: described, not drawn');
  const d = list.describe();
  assert.deepEqual(d.groups.map((g) => [g.name, g.items.map((i) => i.id)]), [['Data', ['stops', 'bike', 'suburbs']], ['Twin', ['terrain']], ['Other', ['odd']]], 'top first, as drawn; a labelled layer no group names: Other');
  const sub = d.groups[0]!.items.find((i) => i.id === 'suburbs')!;
  assert.deepEqual([sub.label, sub.kind, sub.sits, sub.on, sub.opacity, sub.movable], ['Suburbs', 'area', 'over', true, 0.5, true]);
  w.step(1000);
  assert.equal(d.groups[1]!.items[0]!.kind, 'part');
  list.show('suburbs', false); w.step(16);
  assert.equal(a.shown, 0, 'hidden in one frame'); assert.equal(list.describe().groups[0]!.items.find((i) => i.id === 'suburbs')!.on, false);
  list.show('suburbs', true); w.step(16); assert.equal(a.shown, 1);
  list.show('terrain', false); assert.equal(relief, false, 'a part switched through its own function');
  list.setOpacity('suburbs', 0.25); assert.equal(a.props.opacity, 0.25);
  list.restack('Data', ['suburbs', 'bike', 'stops']);
  assert.deepEqual(list.describe().groups[0]!.items.map((i) => i.id), ['stops', 'suburbs', 'bike'], 'the suburbs over the bike; the stops float over both, in their own band');
  list.remove(); w.dispose();
});

test('steady while the view moves fast: a feature that comes back is not revealed again; a tile left lingers; a zoom range\'s edge does not flap', async () => {
  // a feature that left the data and came back keeps its birth (no reveal from nothing for what was on screen)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const l: any = points({ id: 'p', data: [{ id: 'a', at: [145.1, -37.9] }, { id: 'b', at: [145.2, -37.9] }] });
  l.born = true;
  const take = (now: number) => { const e = l.read(now); l.byKey = new Map(e.map((x: { key: string }) => [x.key, x])); return e; };
  const first = take(100);
  l.props = { ...l.props, data: [{ id: 'a', at: [145.1, -37.9] }] }; take(200);
  l.props = { ...l.props, data: [{ id: 'a', at: [145.1, -37.9] }, { id: 'b', at: [145.2, -37.9] }] };
  const back = take(300);
  assert.equal(back.find((e: { key: string }) => e.key === 'b').born, first.find((e: { key: string }) => e.key === 'b').born, 'its first birth');
  l.props = { ...l.props, data: [{ id: 'a', at: [145.1, -37.9] }, { id: 'b', at: [145.2, -37.9] }, { id: 'c', at: [145.3, -37.9] }] };
  assert.equal(take(400).find((e: { key: string }) => e.key === 'c').born, 400, 'a new one: born now (revealed)');
  // a source by the view's tiles: a tile the view left keeps its features a while (whole features)
  class Grid extends Tiled {
    constructor() { super({ linger: 60000 }); this.whole = true; }
    protected async load() { this.range = { minZoom: 14, maxZoom: 14, bounds: [-180, -85, 180, 85] }; }
    protected async tile(z: number, x: number, y: number) { return [{ id: `${z}/${x}/${y}`, props: {}, geometry: { type: 'Point' as const, coordinates: [0, 0] as [number, number] } }]; }
  }
  const g = new Grid(), ctx = { loader: null as never, error: () => {} };
  await g.start(ctx);
  const at = (lon: number) => ({ view: { lon, lat: -37.9, zoom: 14.5, width: 300, height: 300, pixelSize: 5, tilt: 0, bearing: 0 } }) as never;
  g.frame(at(145.1), ctx); await new Promise((k) => setTimeout(k, 0)); g.frame(at(145.1), ctx);
  const here = new Set(g.features().map((f) => f.id));
  g.frame(at(145.3), ctx); await new Promise((k) => setTimeout(k, 0)); g.frame(at(145.3), ctx);
  const now = new Set(g.features().map((f) => f.id));
  assert.ok([...here].every((id) => now.has(id)), 'the tiles left a moment ago still there');
  assert.ok(now.size > here.size, 'with the new ones');
  // a level's edge (core › observation): an element shown by level stays until the orbit is past the edge by the
  // margin for the dwell; a zoom hovering on the edge never flips it
  const w = await world(null, { observation: { levels: 'default' } }), a = area({ id: 'z', data: [], when: { level: { from: 'street' } } });
  w.add(a); w.go({ lon: 145.1, lat: -37.9, zoom: 15.3 }); w.step(16); w.step(1000); w.step(16);
  assert.equal(w.level, 'street'); assert.equal(a.target, 1);
  w.go({ lon: 145.1, lat: -37.9, zoom: 14.3 }); w.step(16); w.step(1000); assert.equal(a.target, 1, 'within the margin (0.3): still shown');
  w.go({ lon: 145.1, lat: -37.9, zoom: 14.1 }); w.step(16); assert.equal(a.target, 1, 'past the margin, before the dwell (0.5 s): still shown');
  w.go({ lon: 145.1, lat: -37.9, zoom: 14.6 }); w.step(16); w.step(1000); assert.equal(w.level, 'street', 'back before the dwell: no change at all');
  w.go({ lon: 145.1, lat: -37.9, zoom: 14.1 }); w.step(16); w.step(600); w.step(16); assert.equal(w.level, 'district'); assert.equal(a.target, 0, 'past the margin for the dwell: hidden');
  w.dispose();
});

test('a layer takes a sign later: setProps with a sign it did not have adds it (attached, in its place, in its band), labels with it', async () => {
  const w = await world(null), data = [box(107.6, -6.9, 107.7, -6.8, 'x')];
  const L = layer({ id: 'zones', data, points: { size: 6 } });
  w.add(L, points({ id: 'top', data: [{ at: [107.6, -6.9] }] }));
  await w.settled();
  const kindBefore = L.kind;
  L.setProps({ line: { color: '#333333', width: 2 } });
  assert.deepEqual(L.signs.map((m) => m.id), ['zones-line', 'zones-points'], 'the outline in its place (before the points)');
  L.setProps({ area: { color: '#ff0000' } });
  assert.deepEqual(L.signs.map((m) => m.id), ['zones-fill', 'zones-line', 'zones-points']);
  assert.notEqual(L.kind, kindBefore, 'a fill first: the layer moves to the fills\' band');
  assert.ok(w.list.findIndex((x) => x.id === 'zones') < w.list.findIndex((x) => x.id === 'top'), 'sorted again: under the points layer');
  await w.settled({ strict: true });
  assert.equal(L.status().ready, true, 'its new signs attached');
  assert.equal(L.signs[0]!.props.data, data, 'the layer\'s data');
  // a sign it has: changed, not made again
  const fill = L.signs[0]; L.setProps({ area: { color: '#00ff00' } }); assert.equal(L.signs[0], fill);
  // labels later: in the world with it, removed with it
  L.setProps({ labels: { text: () => 'x' } });
  assert.ok(L.labels && w.list.some((x) => x.id === 'zones-labels'));
  w.remove('zones'); assert.ok(!w.list.some((x) => x.id.startsWith('zones')));
  // before it is in a world: made, attached with it
  const M = layer({ id: 'later', data, area: { color: '#ff0000' } }); M.setProps({ line: { color: '#000000' } });
  w.add(M); await w.settled({ strict: true }); assert.deepEqual(M.signs.map((m) => m.id), ['later-fill', 'later-line']);
  w.dispose();
});
