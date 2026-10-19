// The shape packages (core › geometry › shapes › recipes › package), the car and drone presets (modules › presets).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

test('shape packages: info, presets, kinematics and states checked; a world keeps them; a catalogue loads them', async () => {
  const { shape, num, shapePackage, ShapeShelf, AslnutError } = await import('../src/index.ts');
  const lid = shape({ id: 'bin', params: { h: num(0.8, 1.4, 1) }, build: (b, p) => { b.solid('box', { size: [0.6, p.h, 0.7], at: [0, p.h / 2, 0] }); b.part('lid', (b) => b.solid('box', { size: [0.62, 0.05, 0.72], at: [0, p.h + 0.03, 0] }), { pivot: [0, p.h, -0.35] }); } });
  const info = { id: 'bin', name: 'Wheelie bin', version: '1.0.0', licence: 'Apache-2.0' };
  const pkg = shapePackage({ info, shape: lid, presets: { tall: { h: 1.3 } }, kinematics: { lid: { part: 'lid', kind: 'hinge', axis: 'x', limits: [0, 110] } }, states: { open: { lid: 100 } } });
  assert.equal(pkg.check().ok, true, pkg.check().problems.join('; '));
  assert.ok(pkg.make('tall').bounds[1][1] > pkg.make().bounds[1][1]);
  // what a check finds: a joint on no part, a state past its limits, a licence that is not SPDX, a preset unknown
  const bad = shapePackage({ info: { ...info, licence: 'mine, all rights' }, shape: lid, kinematics: { flap: { part: 'flap', kind: 'hinge', axis: 'x', limits: [0, 90] }, w: { part: 'lid', kind: 'wheel', axis: 'x' } }, states: { wide: { flap: 120 }, odd: { nothing: 1 } } });
  const c = bad.check();
  assert.equal(c.ok, false); assert.equal(c.problems.length, 5, c.problems.join('\n'));
  assert.throws(() => pkg.preset('short'), (e: unknown) => e instanceof AslnutError);
  assert.throws(() => shapePackage({ info: { id: 'x' } as never, shape: lid }), (e: unknown) => e instanceof AslnutError);
  // a shelf (w.shapes): use, make by id and preset, list; a catalogue's modules imported
  const shelf = new ShapeShelf().use(pkg as never);
  assert.ok(shelf.has('bin') && shelf.make('bin', 'tall').triangles[0]! > 0 && shelf.list()[0]!.name === 'Wheelie bin');
  const { cars } = await import('../src/modules/presets/vehicles/index.ts');
  const got = await new ShapeShelf().load('https://example.org/shapes/catalogue.json', {
    fetch: async () => ({ packages: [{ id: 'car', module: './car/shape.js' }, { id: 'bin', module: './bin/shape.js' }] }),
    import: async (u) => (u === 'https://example.org/shapes/car/shape.js' ? { default: cars.package } : { package: pkg }),
  });
  assert.deepEqual(got.map((i) => i.id), ['car', 'bin']);
  await assert.rejects(new ShapeShelf().load('https://example.org/c.json', { fetch: async () => ({ packages: [{ id: 'truck', module: './car.js' }] }), import: async () => ({ default: cars.package }) }), (e: unknown) => e instanceof AslnutError);
});

test('the car: every type and preset within its budget, wheels and front doors as parts, seats away from the kerb, the paint tinted, a livery, lamps', async () => {
  const { cars, CAR_TYPES } = await import('../src/modules/presets/vehicles/index.ts');
  const { SHAPE_FLOATS, LAMP_CODES } = await import('../src/index.ts');
  const c = cars.package.check();
  assert.equal(c.ok, true, c.problems.join('; '));
  assert.deepEqual(Object.keys(c.presets), ['hatch', 'sedan', 'wagon', 'pickup', 'van', 'bus', 'truck', 'suv', 'crossover', 'tractor', 'citybus']);
  for (const t of CAR_TYPES) {
    const m = cars.make({ type: t }), r = Number(m.params!.wheel);
    assert.deepEqual(m.parts.map((p) => p.name).filter((n) => /^(wheel[FR]|door)/.test(n)), ['wheelFL', 'wheelFR', 'wheelRL', 'wheelRR', 'doorL', 'doorR'], t);
    for (const a of ['driver', 'passenger', 'gripL', 'gripR', 'entryL', 'entryR']) assert.ok(m.anchors.some((x) => x.name === a), `${t}: ${a}`);
    // the front wheels ahead of the rear ones (it faces +z), all on the ground
    const p = (n: string) => m.parts.find((x) => x.name === n)!.pivot;
    assert.ok(p('wheelFL')[2] > p('wheelRL')[2] && Math.abs(p('wheelFL')[1] - r) < 0.01 && Math.abs(m.bounds[0][1]) < 0.01, t);
  }
  assert.ok(cars.bus.make().bounds[1][2] > 5.9 && cars.truck.make().parts.length === 8);
  // the driver away from the kerb: on the left (+x) where traffic keeps right, on the right where it keeps left
  const seat = (traffic: string) => cars.make({ traffic }).anchors.find((a) => a.name === 'driver')!.at[0];
  assert.ok(seat('right') > 0 && seat('left') < 0);
  // the paint takes the instance's colour, the rest keeps its own; head and tail lamps; a livery on both sides
  const w = cars.make({ type: 'van', livery: 'ACME 24' }).levels[0] as Float32Array, codes = new Map<number, number>();
  for (let i = 5; i < w.length; i += SHAPE_FLOATS) codes.set(w[i]! % 512, (codes.get(w[i]! % 512) ?? 0) + 1);
  assert.ok(codes.has(1) && codes.has(256 + LAMP_CODES.head) && codes.has(256 + LAMP_CODES.tail) && codes.has(256 + 2), [...codes.keys()].join(','));
  const plain = cars.make({ type: 'van' }).levels[0] as Float32Array;
  assert.ok(w.length > plain.length + 100 * SHAPE_FLOATS, 'the livery letters');
  // the package on disk: shape.json, presets.json, kinematics.ts, states.ts, LICENCE
  const dir = join(import.meta.dirname, '../src/modules/presets/vehicles/car');
  for (const f of ['shape.json', 'presets.json', 'kinematics.ts', 'states.ts', 'shape.ts', 'body.ts', 'hitch.ts', 'LICENCE']) assert.ok(existsSync(join(dir, f)), f);
  assert.equal(JSON.parse(readFileSync(join(dir, 'shape.json'), 'utf8')).id, 'car');
});

test('the car\'s rows: each type one row of the silhouette\'s numbers; a type given brings its row, what is given besides stands over it', async () => {
  const { cars, CAR_TYPES } = await import('../src/modules/presets/vehicles/index.ts');
  const rows = JSON.parse(readFileSync(join(import.meta.dirname, '../src/modules/presets/vehicles/car/presets.json'), 'utf8')) as Record<string, Record<string, unknown>>;
  const silhouette = ['length', 'width', 'height', 'wheel', 'wheelbase', 'front', 'rear', 'bonnet', 'rake', 'roofline', 'tail', 'clearance', 'arch', 'belt', 'glass', 'windows', 'cladding', 'lights', 'load', 'axles', 'doors', 'pods', 'paint'];
  assert.deepEqual(Object.keys(rows), [...CAR_TYPES]);
  for (const [name, row] of Object.entries(rows)) {
    for (const k of silhouette) assert.ok(k in row, `${name}: ${k}`);
    // its overhangs and wheelbase its length; every number within its param's range (a row is never clamped)
    assert.ok(Math.abs(Number(row.front) + Number(row.wheelbase) + Number(row.rear) - Number(row.length)) < 0.01, `${name}: front + wheelbase + rear = length`);
    const pp = cars.shape.params(row as never) as Record<string, unknown>;
    for (const k of silhouette) assert.deepEqual(pp[k], row[k], `${name}: ${k} within its range`);
    // the type given: the same build as the preset's
    const a = cars.make({ type: name }), b = (cars as unknown as Record<string, { make(): typeof a }>)[name]!.make();
    assert.deepEqual([a.triangles, a.bounds], [b.triangles, b.bounds], name);
  }
  assert.equal(cars.make({ type: 'van', height: 2.2 }).bounds[1][1].toFixed(2), '2.20');
  assert.ok(cars.shape.make({ type: 'bus' }).bounds[1][2] > 5.9, 'the shape itself brings the row too (entities({ shape: cars.shape, params }))');
  // the new rows: a coupé SUV's fastback with cladding, a small crossover's hatch, a tractor's trailer, a city bus's doors and pods
  const g = (t: string) => (cars.make({ type: t }).groups ?? []).map((x) => x.name);
  assert.ok(g('suv').includes('cladding') && g('crossover').includes('cladding') && !g('hatch').includes('cladding'));
  assert.ok(g('tractor').includes('load') && g('truck').includes('load') && CAR_TYPES.every((t) => g(t).includes('glass')));
  assert.ok(cars.citybus.make().bounds[1][1] > 3.25, 'the city bus\'s pods over its roof');
});

test('the car\'s levels: the whole, a simple one (fewer sides), a far symbol, each within its budget (hundreds of cars on a phone)', async () => {
  const { cars, CAR_TYPES } = await import('../src/modules/presets/vehicles/index.ts');
  const big: Record<string, number> = { bus: 4500, citybus: 4500, truck: 4500, tractor: 6000 };
  for (const t of CAR_TYPES) {
    const m = cars.make({ type: t }), [whole, simple, far] = m.triangles as [number, number, number];
    assert.ok(whole <= (big[t] ?? 3500), `${t}: whole ${whole}`);
    assert.ok(simple <= whole * 0.6 && simple <= (big[t] ? 2000 : 1400), `${t}: simple ${simple}`);
    assert.ok(far <= 80 && far < simple / 8, `${t}: far ${far}`);
    // each level a form of its own (a far symbol: its outline across its width), every level with its parts' numbers
    assert.ok(m.levels[0] !== m.levels[1] && m.levels[1] !== m.levels[2], t);
  }
});

test('the trailer: a hinge at the fifth wheel, turned by its track (cars.hitch): its axles inside the tractor\'s path on a turn, straight behind it after', async () => {
  const { cars } = await import('../src/modules/presets/vehicles/index.ts');
  const m = cars.tractor.make(), trailer = m.parts.find((p) => p.name === 'trailer')!, hitch = m.anchors.find((a) => a.name === 'hitch')!.at, axle = m.anchors.find((a) => a.name === 'trailerAxle')!.at;
  assert.equal(trailer.joint?.kind, 'hinge'); assert.deepEqual(trailer.joint?.axis, [0, 1, 0]); assert.deepEqual(trailer.pivot.map((v) => v.toFixed(3)), hitch.map((v) => v.toFixed(3)));
  assert.ok(m.pieces!.parts.some((p) => p.name === 'trailer') && m.bounds[0][2] < -13, 'its trailer reaches back behind it');
  // a circle of 25 m, turning left (four laps, a sample every 2°): the axles settle on the circle a tractrix keeps,
  // √(R² + k² − L²) (k: the fifth wheel behind its place, L: the axles behind the fifth wheel), the trailer to the inside
  const R = 25, lon0 = 145, lat0 = -37.9, kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574, rows = [];
  for (let i = 0; i <= 720; i++) { const a = (i * 2 * Math.PI) / 180; rows.push({ id: 'rig', t: i * 1000, lon: lon0 + (R * Math.cos(a)) / kx, lat: lat0 + (R * Math.sin(a)) / ky, values: { soc: i / 720 }, props: { kind: 'tractor' } }); }
  let axles: [number, number][] = [];
  const out = cars.hitch(rows, m, { axles: (_, a) => (axles = a) }), k = hitch[2], L = hitch[2] - axle[2];
  const rt = axles.slice(-60).map(([lo, la]) => Math.hypot((lo - lon0) * kx, (la - lat0) * ky)), mean = rt.reduce((a, b) => a + b, 0) / rt.length, want = Math.sqrt(R * R + k * k - L * L);
  assert.ok(Math.abs(mean - want) / want < 0.01, `axles on ${mean.toFixed(2)} m, the tractrix's ${want.toFixed(2)} m`);
  assert.ok(R - mean > 1.5, `off-tracking ${(R - mean).toFixed(2)} m`);
  const phi = out.slice(-60).map((r) => r.values!.hitch!), steady = -((Math.atan(Math.abs(k) / R) + Math.asin(L / Math.hypot(R, k))) * 180) / Math.PI;
  assert.ok(phi.every((v) => Math.abs(v - steady) < 2), `the hinge at ${phi.slice(-3).map((v) => v.toFixed(1))}° (a left turn: the trailer to the left, ${steady.toFixed(1)}°)`);
  assert.ok(out.length > rows.length && out.every((r, i) => i === 0 || Number(r.t) >= Number(out[i - 1]!.t)), 'sampled where it turns, in time order');
  assert.ok(out[0]!.props?.kind === 'tractor' && Math.abs(out[out.length - 1]!.values!.soc! - 1) < 1e-6, 'its props and values carried');
  // a right-angle turn then a straight: rounded (no tighter than its radius), the trailer straight again 40 m on
  const leg = [[0, 0], [0, 60], [80, 60]].map(([x, y], i) => ({ id: 'rig', t: [0, 8000, 20000][i]!, lon: lon0 + x! / kx, lat: lat0 + y! / ky }));
  const turn = cars.hitch(leg, m, { radius: 12 }), last = turn[turn.length - 1]!, peak = Math.max(...turn.map((r) => Math.abs(r.values!.hitch!)));
  assert.ok(peak > 20 && Math.abs(last.values!.hitch!) < 2, `the hinge peaks at ${peak.toFixed(1)}°, ${last.values!.hitch!.toFixed(1)}° at the end`);
  assert.ok(turn.some((r) => r.values!.hitch! > 1), 'a right turn: the trailer to the right (positive)');
});

test('the drone: 4 to 8 rotors as parts on their motors, a camera anchor, a payload when it carries one, within budget', async () => {
  const { drones } = await import('../src/modules/presets/drones/index.ts');
  const c = drones.package.check();
  assert.equal(c.ok, true, c.problems.join('; '));
  for (const n of [4, 6, 8]) {
    const m = drones.make({ rotors: n });
    assert.equal(m.parts.filter((p) => p.name.startsWith('rotor')).length, n);
    assert.ok(m.anchors.some((a) => a.name === 'camera'));
  }
  assert.equal(drones.make({ rotors: 5 }).parts.length, 6, 'an odd count stands lopsided: the next even one');
  assert.ok(drones.cargo.make().anchors.some((a) => a.name === 'payload') && !drones.quad.make().anchors.some((a) => a.name === 'payload'));
  assert.ok(drones.make({ span: 2 }).bounds[1][0] > 2 * drones.make({ span: 0.6 }).bounds[1][0]);
  assert.equal(Object.keys(drones.kinematicsFor(8)).length, 8);
});
