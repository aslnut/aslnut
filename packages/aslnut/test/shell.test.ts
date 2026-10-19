// core › world › host › react › elements: the shell keeps a real (headless) world in step with lists of elements and
// options, using only the world's own calls; counted by spying on them.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { area, layer, line, points, shell, theme, world, Element, type Feature, type World } from '../src/index.ts';

const pt = (id: string, lon: number, lat: number): Feature => ({ id, props: { n: 1 }, geometry: { type: 'Point', coordinates: [lon, lat] } });
const sq = (id: string, x: number): Feature => ({ id, props: { rate: x }, geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] } });
const PTS = [pt('a', 0, 0), pt('b', 1, 1)], SQS = [sq('s1', 0), sq('s2', 2)];

/** a headless world whose add / remove calls and elements' setProps calls are counted */
async function counted() {
  const w = await world(null, {});
  const n = { add: 0, remove: 0, set: [] as [string, string[]][], errors: [] as unknown[] };
  const add = w.add.bind(w), remove = w.remove.bind(w);
  w.add = (...ls: Element[]) => { n.add += ls.length; return add(...ls); };
  w.remove = (id: string) => { n.remove++; return remove(id); };
  w.on('error', (e) => { n.errors.push(e); });
  return { w, n };
}
/** spy on setProps of these elements (their classes' own setProps run as before) */
function watch(n: { set: [string, string[]][] }, ...els: Element[]) {
  for (const el of els) { const own = el.setProps.bind(el); el.setProps = (p) => { n.set.push([el.id, Object.keys(p)]); return own(p); }; }
}
const ids = (w: World) => w.list.map((x) => x.id);

test('shell: new ids are added, kept ones untouched, gone ones removed (by id, never made again)', async () => {
  const { w, n } = await counted();
  const s = shell(w);
  const roads = line({ id: 'roads', data: SQS, color: '#333', width: 2 }), dots = points({ id: 'dots', data: PTS, size: 6 });
  s.elements([roads, dots]);
  assert.deepEqual(ids(w), ['roads', 'dots']);
  assert.equal(n.add, 2);
  assert.deepEqual(s.ids, ['roads', 'dots']);
  // the same list again (the same objects, or new ones with the same props): nothing
  s.elements([roads, dots]);
  s.elements([line({ id: 'roads', data: SQS, color: '#333', width: 2 }), points({ id: 'dots', data: PTS, size: 6 })]);
  assert.equal(n.add, 2); assert.equal(n.remove, 0);
  assert.equal(w.element('roads'), roads, 'the element in the world is the first one');
  // gone: removed, and detached
  s.elements([roads]);
  assert.deepEqual(ids(w), ['roads']); assert.equal(n.remove, 1);
  assert.deepEqual(s.ids, ['roads']);
  s.elements([]);
  assert.deepEqual(ids(w), []); assert.equal(n.remove, 2);
  assert.equal(n.errors.length, 0);
  w.dispose();
});

test('shell: a changed prop is set on the element in the world (setProps with only what changed)', async () => {
  const { w, n } = await counted();
  const s = shell(w);
  // a render: a new layer each time, its options new objects; its functions kept (made outside the component)
  const name = (d: Feature) => String(d.id);
  const look = (dark: boolean, labels = true) => layer({ id: 'zones', data: SQS, area: { color: dark ? '#222' : '#ddd', opacity: 0.8, outline: { color: '#fff', width: 1 } }, ...(labels ? { labels: { text: name } } : {}) });
  const first = look(false);
  watch(n, first);
  s.elements([first]);
  s.elements([look(false)]);
  assert.deepEqual(n.set, [], 'nothing changed: nothing set');
  s.elements([look(true)]);
  assert.deepEqual(n.set, [['zones', ['area', 'color']]], 'the fill only (and the colour it gives the layer)');
  assert.equal(w.element('zones'), first, 'never made again');
  assert.equal(first.props.area!.color, '#222');
  assert.equal(n.add, 2, 'the layer and its labels, once');
  assert.equal(n.remove, 0);
  // a prop gone is set to undefined
  n.set.length = 0;
  s.elements([look(true, false)]);
  assert.deepEqual(n.set, [['zones', ['labels']]]);
  // a function made again each render is a new prop: a restyle (set), still never a rebuild
  n.set.length = 0;
  s.elements([layer({ id: 'zones', data: SQS, area: { color: () => '#222', opacity: 0.8, outline: { color: '#fff', width: 1 } } })]);
  assert.deepEqual(n.set, [['zones', ['area', 'color']]]);
  assert.equal(w.element('zones'), first);
  w.dispose();
});

test('shell: a keyed reorder moves nothing; the stack is a prop (order, above, below) set like any other', async () => {
  const { w, n } = await counted();
  const s = shell(w);
  const a = area({ id: 'a', data: SQS, color: '#f00' }), b = area({ id: 'b', data: SQS, color: '#0f0' }), c = area({ id: 'c', data: SQS, color: '#00f' });
  watch(n, a, b, c);
  s.elements([a, b, c]);
  assert.deepEqual(ids(w), ['a', 'b', 'c']);
  s.elements([c, a, b]);
  assert.equal(n.add, 3); assert.equal(n.remove, 0); assert.deepEqual(n.set, []);
  assert.deepEqual(ids(w), ['a', 'b', 'c'], 'the draw order is the world\'s (kind, then the add order)');
  assert.deepEqual(s.ids, ['c', 'a', 'b']);
  // the stack through a prop: c below a
  s.elements([area({ id: 'c', data: SQS, color: '#00f', below: 'a' }), a, b]);
  assert.deepEqual(n.set, [['c', ['below']]]);
  assert.deepEqual(ids(w), ['c', 'a', 'b']);
  assert.equal(w.element('c'), c);
  w.dispose();
});

test('shell: another kind under an id is made anew; placed elements go in and out in a working order', async () => {
  const { w, n } = await counted();
  const s = shell(w);
  // a new element placed above another new one, in one list
  s.elements([area({ id: 'base', data: SQS, color: '#ccc' }), line({ id: 'edge', data: SQS, color: '#000', above: 'base' })]);
  assert.deepEqual(ids(w), ['base', 'edge']);
  // both gone at once: the one placed above goes first (the world refuses to strand it)
  s.elements([]);
  assert.deepEqual(ids(w), []);
  assert.equal(n.errors.length, 0, String(n.errors[0]));
  // a kept element let go of its anchor in the same list the anchor goes
  s.elements([area({ id: 'base', data: SQS, color: '#ccc' }), line({ id: 'edge', data: SQS, color: '#000', above: 'base' })]);
  s.elements([line({ id: 'edge', data: SQS, color: '#000' })]);
  assert.deepEqual(ids(w), ['edge']); assert.equal(n.errors.length, 0, String(n.errors[0]));
  // the same id, another kind: out, and the new one in
  const before = n.remove;
  s.elements([points({ id: 'edge', data: PTS })]);
  assert.equal(n.remove, before + 1);
  assert.equal(w.element('edge').kind, 'point');
  w.dispose();
});

test('shell: what it cannot do is said through the world\'s errors, and the rest still happens', async () => {
  const { w, n } = await counted();
  const s = shell(w);
  s.elements([points({ id: 'p', data: PTS }), points({ id: 'p', data: PTS }), {} as Element, points({ id: 'q', data: PTS })]);
  assert.deepEqual(ids(w), ['p', 'q']);
  assert.equal(n.errors.length, 2);
  assert.match(String(n.errors[0]), /two elements with id 'p'/);
  assert.match(String(n.errors[1]), /elements take aslnut elements/);
  // an element with no id of its own: a new one each time it is made (said once)
  n.errors.length = 0;
  s.elements([points({ id: 'p', data: PTS }), points({ data: PTS })]);
  s.elements([points({ id: 'p', data: PTS }), points({ data: PTS })]);
  assert.equal(n.errors.length, 1); assert.match(String(n.errors[0]), /has no id of its own/);
  // removed by hand meanwhile: nothing to remove, nothing said
  n.errors.length = 0;
  w.remove('p');
  s.elements([]);
  assert.equal(n.errors.length, 0);
  // a disposed world: nothing (no throw)
  w.dispose();
  s.elements([points({ id: 'r', data: PTS })]);
});

test('shell: options with a setter follow their changes; the view moves the camera only when asked', async () => {
  const w = await world(null, { view: { lon: 10, lat: 10, zoom: 12, tilt: 0, bearing: 0 }, time: new Date('2026-06-21T03:00:00Z') });
  const calls: string[] = [];
  for (const k of ['setTime', 'setTheme', 'setQuality', 'setShadows', 'observe', 'go', 'fly', 'addView'] as const) {
    const own = (w[k] as (...a: unknown[]) => unknown).bind(w);
    (w as unknown as Record<string, unknown>)[k] = (...a: unknown[]) => { calls.push(k); return own(...a); };
  }
  const o0 = { view: { lon: 10, lat: 10, zoom: 12, tilt: 0, bearing: 0 }, time: new Date('2026-06-21T03:00:00Z') };
  const s = shell(w, { options: o0 });
  // the same values in new objects (a render): nothing
  s.options({ view: { lon: 10, lat: 10, zoom: 12, tilt: 0, bearing: 0 }, time: new Date('2026-06-21T03:00:00Z') });
  assert.equal(calls.join(), '');
  // a new time, a theme (made again each render: the same by its name and settings), a quality
  s.options({ ...o0, time: new Date('2026-06-21T09:00:00Z'), theme: theme.dark(), quality: 'lite' });
  assert.equal(calls.join(), 'setTime,setQuality,setTheme');
  assert.equal(w.time.toISOString(), '2026-06-21T09:00:00.000Z');
  calls.length = 0;
  s.options({ ...o0, time: new Date('2026-06-21T09:00:00Z'), theme: theme.dark(), quality: 'lite' });
  assert.equal(calls.join(), '', 'theme.dark() again is the same theme');
  // a changed view: the camera is the person's unless asked
  s.options({ ...o0, view: { lon: 11, lat: 10, zoom: 12, tilt: 0, bearing: 0 } });
  assert.ok(!calls.includes('go') && !calls.includes('fly'));
  assert.ok(Math.abs(w.camera.view.lon - 10) < 1e-9);
  s.options({ ...o0, view: { lon: 12, lat: 10, zoom: 12, tilt: 0, bearing: 0 } }, 'go');
  assert.ok(calls.includes('go'));
  assert.ok(Math.abs(w.camera.view.lon - 12) < 1e-6, `jumped (${w.camera.view.lon})`);
  s.options({ ...o0, view: { lon: 13, lat: 10, zoom: 12, tilt: 0, bearing: 0 } }, { seconds: 0.5 });
  assert.ok(calls.includes('fly'));
  // the levels: observed again only when they change
  calls.length = 0;
  s.options({ ...o0, view: { lon: 13, lat: 10, zoom: 12, tilt: 0, bearing: 0 }, observation: { levels: 'default' } });
  s.options({ ...o0, view: { lon: 13, lat: 10, zoom: 12, tilt: 0, bearing: 0 }, observation: { levels: 'default' } });
  assert.deepEqual(calls.filter((c) => c === 'observe'), ['observe']);
  assert.ok(w.level);
  w.dispose();
});
