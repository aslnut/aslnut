// core › observation › presence: params by level. Any prop of any element given as { level: { rung: value } } takes
// the nearest named coarser rung (else the nearest finer), resolved once a level change (through the gates' margin and
// dwell) and applied through the element's own setProps, only where its value changed. A field's res and area by level
// make it a new grid, its state carried over.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AslnutError, DEFAULT_LADDER, Element, field, isByLevel, levelValue, points, rules, world, type ElementProps, type Leveled } from '../src/index.ts';

const NAMES = DEFAULT_LADDER.map((r) => r.name);
const at = (n: string) => NAMES.indexOf(n);

test('params by level: the nearest named coarser rung, else the nearest finer', () => {
  const size = { level: { district: 6, street: 14 } };
  const got = Object.fromEntries(NAMES.map((n) => [n, levelValue(size, NAMES, at(n))]));
  assert.deepEqual(got, { world: 6, country: 6, region: 6, city: 6, district: 6, street: 14, building: 14, room: 14 });
  // any value: a colour, an object, an array
  const area = { level: { city: { size: 12000 }, street: { size: 600 } } };
  assert.equal(levelValue(area, NAMES, at('building')), area.level.street);
  assert.equal(levelValue({ level: { room: [1, 2] } }, NAMES, at('world'))[1], 2, 'none coarser: the nearest finer');
  // a ladder of your own
  assert.equal(levelValue({ level: { campus: 'a', room: 'b' } }, ['campus', 'floor', 'room'], 1), 'a');
});

test('params by level: only { level: { … } } is one (plain JSON; nothing else is taken for it)', () => {
  assert.equal(isByLevel({ level: { street: 1 } }), true);
  assert.equal(isByLevel(JSON.parse(JSON.stringify({ level: { street: 1 } }))), true, 'a round trip through JSON');
  for (const v of [{ level: 'street' }, { level: { street: 1 }, other: 1 }, { level: [1] }, [{ level: {} }], null, 3, '#fff', { from: 'district' }, new (class { level = { a: 1 }; })()]) assert.equal(isByLevel(v), false, JSON.stringify(v));
});

/** an element that writes down every setProps it gets */
class Probe extends Element<ElementProps & { a?: number; b?: string; c?: number[] }> {
  readonly kind = 'custom' as const;
  calls: string[][] = [];
  constructor(p: Leveled<ElementProps & { a?: number; b?: string; c?: number[] }>) { super(p); }
  frame() { return []; }
  override setProps(p: Partial<Leveled<ElementProps & { a?: number; b?: string; c?: number[] }>>): this { this.calls.push(Object.keys(p).sort()); for (const v of Object.values(p)) assert.equal(isByLevel(v), false, 'its own setProps sees values, never a spec'); return super.setProps(p); }
}

test('params by level: built with the values for the level it is added at; one apply per level change, only what changed', async () => {
  const w = await world(null);
  w.go({ lon: 145.1, lat: -37.9, zoom: 13 });
  assert.equal(w.level, null, 'no levels yet');
  const c = [1, 2], p = new Probe({ id: 'p', a: { level: { district: 6, street: 14 } }, b: { level: { city: 'far', street: 'near' } }, c: { level: { world: c } } });
  w.add(p);
  assert.equal(w.level, 'district', 'a prop by level turned the default ladder on (as when: { level } does)');
  assert.deepEqual({ a: p.props.a, b: p.props.b }, { a: 6, b: 'far' }, 'resolved for the level it starts at');
  assert.equal(p.props.c, c);
  assert.deepEqual(p.byLevel.a, { level: { district: 6, street: 14 } }, 'the spec as given');
  assert.deepEqual(JSON.parse(JSON.stringify(p.byLevel)), { a: { level: { district: 6, street: 14 } }, b: { level: { city: 'far', street: 'near' } }, c: { level: { world: [1, 2] } } }, 'specs are plain JSON');
  p.calls.length = 0;
  w.setLevel('street');
  assert.deepEqual(p.calls, [['a', 'b']], 'one setProps, with only the props whose value changed');
  w.setLevel('building');
  assert.deepEqual(p.calls, [['a', 'b']], 'street → building: nothing changed, nothing applied');
  w.setLevel('city');
  assert.deepEqual(p.calls, [['a', 'b'], ['a', 'b']]);
  assert.deepEqual({ a: p.props.a, b: p.props.b }, { a: 6, b: 'far' });
  assert.equal(w.observation!.counts.applied, 2);
  w.dispose();
});

test('params by level: once a level change through the margin and the dwell, never per frame (an acrobatic zoom)', async () => {
  const w = await world(null, { observation: { levels: 'default' } });
  w.go({ lon: 145.1, lat: -37.9, zoom: 13 }); w.step(16); w.step(1000); w.step(16);
  const p = new Probe({ id: 'p', a: { level: { district: 6, street: 14 } } });
  w.add(p); p.calls.length = 0;
  // a pinch overshooting the street edge (14.5) and back, faster than the dwell: no change, nothing applied
  for (const z of [14.2, 14.9, 15.2, 14.6, 14.1, 13.8]) { w.go({ lon: 145.1, lat: -37.9, zoom: z }); w.step(16); w.step(100); }
  w.step(1000); w.step(16);
  assert.equal(w.level, 'district'); assert.deepEqual(p.calls, [], 'an overshoot and back: no apply');
  // in and held: one apply; frames after it: none
  w.go({ lon: 145.1, lat: -37.9, zoom: 15.5 }); for (let k = 0; k < 40; k++) w.step(50);
  assert.equal(w.level, 'street'); assert.deepEqual(p.calls, [['a']]); assert.equal(p.props.a, 14);
  // hovering on the edge within the margin: nothing
  for (const z of [14.4, 14.6, 14.3, 14.7]) { w.go({ lon: 145.1, lat: -37.9, zoom: z }); for (let k = 0; k < 20; k++) w.step(50); }
  assert.deepEqual(p.calls, [['a']]);
  // out past building and back to city: each level crossed is a change; `a` changes only at street → district
  w.go({ lon: 145.1, lat: -37.9, zoom: 18 }); for (let k = 0; k < 40; k++) w.step(50);
  w.go({ lon: 145.1, lat: -37.9, zoom: 10 }); for (let k = 0; k < 40; k++) w.step(50);
  const o = w.observation!;
  assert.equal(w.level, 'city');
  assert.deepEqual(p.calls, [['a'], ['a']], `${o.counts.changes} level changes, an apply only where the value changed`);
  assert.equal(o.counts.applied, 2);
  w.dispose();
});

test('params by level: a rung not on the ladder is E-LEVEL-002 (element and prop said, the ladder listed), at add and at setProps', async () => {
  const w = await world(null, { observation: { levels: ['city', 'district', 'street'] } });
  let e: unknown;
  try { w.add(points({ id: 'clinics', data: [], size: { level: { district: 6, blok: 14 } } })); } catch (x) { e = x; }
  assert.ok(e instanceof AslnutError); assert.equal((e as AslnutError).code, 'E-LEVEL-002');
  assert.equal((e as AslnutError).where, 'clinics.size'); assert.match(String((e as AslnutError).fix), /city, district, street/);
  assert.ok(!w.list.some((l) => l.id === 'clinics'), 'not added');
  const ok = points({ id: 'ok', data: [], size: 4 }); w.add(ok);
  assert.throws(() => ok.setProps({ size: { level: { room: 2 } } }), (x: unknown) => x instanceof AslnutError && x.code === 'E-LEVEL-002');
  assert.equal(ok.props.size, 4, 'nothing changed');
  w.dispose();
});

test('params by level: setProps with a spec replaces it and resolves at once; a plain value drops back to plain', async () => {
  const w = await world(null, { observation: { levels: 'default', level: 'street' } });
  const m = points({ id: 'm', data: [], size: { level: { city: 4, street: 12 } } });
  w.add(m);
  assert.equal(m.props.size, 12);
  m.setProps({ size: { level: { district: 3, building: 9 } } });
  assert.equal(m.props.size, 3, 'resolved at once (street: the nearest coarser is district)');
  assert.deepEqual(m.byLevel.size, { level: { district: 3, building: 9 } });
  w.setLevel('room'); assert.equal(m.props.size, 9);
  m.setProps({ size: 7 });
  assert.equal(m.props.size, 7); assert.equal(m.byLevel.size, undefined, 'plain again');
  w.setLevel('city'); assert.equal(m.props.size, 7, 'a level change leaves a plain prop alone');
  // given as JSON (a catalog's config)
  const j = points(JSON.parse('{"id":"j","data":[],"size":{"level":{"district":6,"street":14}},"color":{"level":{"city":"#ff0000","street":"#00ff00"}}}'));
  w.add(j); assert.deepEqual([j.props.size, j.props.color], [6, '#ff0000']);
  w.setLevel('street'); assert.deepEqual([j.props.size, j.props.color], [14, '#00ff00']);
  w.dispose();
});

test('params by level: a field\'s res and area by level make a new grid, the state carried over where they overlap (CPU)', async () => {
  const centre: [number, number] = [145.12, -37.92];
  const w = await world(null, { observation: { levels: 'default', level: 'district' } });
  const f = field({ id: 'flood', res: { level: { street: 5, district: 20 } }, area: { level: { district: { centre, size: 800 }, street: { centre, size: 400 } } }, rule: rules.diffusion({ k: 0 }), init: (lon) => (lon > centre[0] ? 2 : 1) });
  w.add(f);
  assert.deepEqual([f.w, f.h, f.cell], [40, 40, 20], 'district: 800 m at 20 m');
  // a state of its own (not init): a bump in the middle
  for (let j = 18; j < 22; j++) for (let i = 18; i < 22; i++) f.state[(j * f.w + i) * 4] = 10;
  f.version++;
  const probe = f.probe({ at: centre });
  const before = f.at(centre);
  w.setLevel('street');
  assert.deepEqual([f.w, f.h, f.cell], [80, 80, 5], 'street: 400 m at 5 m');
  assert.ok(Math.abs(f.at(centre) - before) < 1e-6, `the state carried over (${f.at(centre)} vs ${before})`);
  assert.ok(Math.abs(probe.value - f.at(centre)) < 1, 'the probe follows the new grid');
  const corner = f.lonLatOf(0, 0);
  assert.ok(Math.abs(f.at(corner) - 1) < 1e-6, 'away from the bump: the old state there');
  // back out: a bigger area at a coarser res; where the street grid did not reach, the old district grid's cells are
  // gone (the street grid was all there was): init there
  w.setLevel('city');
  assert.deepEqual([f.w, f.h], [40, 40]);
  assert.ok(f.at(centre) > 9, `the bump still there (${f.at(centre)}): the mean of the finer cells each cell covers`);
  assert.ok(Math.abs(f.at(f.lonLatOf(0, 0)) - 1) < 1e-6 && Math.abs(f.at(f.lonLatOf(39, 39)) - 2) < 1e-6, 'outside the street grid: init');
  // too big: an error that says the level, and the field as it was
  let e: unknown;
  try { f.setProps({ res: { level: { street: 5, district: 20, city: 0.1 } } }); } catch (x) { e = x; }
  assert.ok(e instanceof AslnutError); assert.match((e as Error).message, /at level 'city'/); assert.match((e as Error).message, /2048/);
  assert.deepEqual([f.w, f.h], [40, 40], 'the field as it was');
  assert.deepEqual(f.byLevel.res, { level: { street: 5, district: 20 } }, 'its spec as it was');
  w.dispose();
});
