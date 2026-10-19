// core › entities › identity › kind (a kind's traits: checked, read), the neutral presets by kind (modules › … ›
// buildings › typology), the charger and the car neutral by default, a model imported as a kind, the two house tools
// (a roof of your own, a raised floor), one-way lines in a network, a recorded track straight from its arrays.
import { test } from 'node:test';
import assert from 'node:assert/strict';

/** a colour 0xRRGGBB's spread between its channels (0: a grey) */
const spread = (c: number) => { const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255; return Math.max(r, g, b) - Math.min(r, g, b); };

test('kinds: each names its traits; a shape of a kind is checked at every param set; a trait missing or misplaced is said', async () => {
  const { kinds, kind, traits, shape, num, typology, chargers, AslnutError } = await import('../src/index.ts');
  const { cars } = await import('../src/modules/presets/vehicles/index.ts');
  assert.deepEqual(Object.keys(kinds.house.traits), ['footprint', 'front', 'levels', 'floor', 'roof', 'entries', 'parking', 'service', 'occupants']);
  for (const k of ['office', 'charger', 'vehicle'] as const) assert.ok(Object.keys(kinds[k].traits).length >= 4, k);
  // the presets carry their kinds' traits at every param set
  for (const s of [typology.house, typology.office, chargers.shape, cars.shape]) { const c = s.check(); assert.equal(c.ok, true, `${s.id}: ${c.problems.join('; ')}`); }
  // a box called a house: what it lacks, by trait (once each, not once a param set)
  const box = shape({ id: 'box', params: { h: num(2, 6, 3) }, build: (b, p) => b.solid('box', { size: [8, p.h, 8], at: [0, p.h / 2, 0] }) });
  const c = box.check({ kind: 'house' });
  assert.equal(c.ok, false);
  assert.deepEqual(c.problems.map((p) => p.replace(/^\{\}: house › (\w+).*$/, '$1')), ['entries', 'parking', 'service']);
  // misplaced: an entry at the back, parking inside the walls, a service point up a wall
  const bad = shape({ id: 'bad', kind: kinds.house, build: (b) => {
    b.solid('box', { size: [8, 3, 8], at: [0, 1.5, 0] });
    b.anchor('entry-1', [0, 0, -4.8], { kind: 'entry', heading: 180 }); b.anchor('parking-1', [0, 0, 1], { kind: 'parking' }); b.anchor('service-1', [4.2, 1.2, 0], { kind: 'service' });
  } }).check();
  assert.match(bad.problems.join('\n'), /entries.*'entry-1' is at the back/); assert.match(bad.problems.join('\n'), /parking.*'parking-1' is inside the footprint/); assert.match(bad.problems.join('\n'), /service.*'service-1' is 1\.20 m up/);
  // a kind of your own; one per another (a light per bay)
  const shed = kind({ name: 'shed', traits: { door: { anchors: 'entry', where: ['ground', 'front'] }, bays: { anchors: 'parking', min: 2 }, lights: { anchors: 'light', per: 'bays', where: 'up' } } });
  const mine = shape({ id: 'mine', kind: shed, build: (b) => { b.solid('box', { size: [4, 2.5, 3], at: [0, 1.25, 0] }); b.anchor('door', [0, 0, 2], { kind: 'entry', heading: 180 }); for (const x of [-1, 1]) b.anchor(`bay-${x}`, [x * 1.5, 0, 4], { kind: 'parking' }); b.anchor('light', [0, 2, 1.6], { kind: 'light' }); } }).check();
  assert.deepEqual(mine.problems, ['{}: shed › lights: 1, one per bays wanted (2)']);
  assert.throws(() => kind({ name: 'odd', traits: { x: {} } }), (e: unknown) => e instanceof AslnutError);
  assert.throws(() => box.check({ kind: 'castle' } as never), (e: unknown) => e instanceof AslnutError || e instanceof Error);
  // read: the traits of a made house (its parking, its roof measured, its params)
  const t = traits(typology.house.make({ width: 10, depth: 11, levels: 2, roof: 'gable', garage: 'left' }), 'house');
  assert.equal((t.parking as unknown[]).length, 2); assert.equal(t.levels, 2); assert.equal(t.occupants, 3);
  const roof = t.roof as { surface: number; tilt: number; kind: string };
  // (the gable over 10.9 × 11.9 at 25°, the garage's flat roof 4 × 6.6)
  assert.ok(Math.abs(roof.surface - (10.9 * 11.9 / Math.cos((25 * Math.PI) / 180) + 26.4)) < 3, `${roof.surface}`); assert.ok(roof.tilt > 15 && roof.tilt < 25 && roof.kind === 'gable');
});

test('typology: a neutral house and office in white to grey, fully by params, with whole, simple and box levels', async () => {
  const { typology, traits, kinds, SHAPE_FLOATS } = await import('../src/index.ts');
  for (const [s, p] of [[typology.house, { roof: 'hip', garage: 'right', levels: 2 }], [typology.office, { levels: 6, bays: 12 }]] as const) {
    const m = s.make(p as never), v = m.levels[0] as Float32Array;
    let worst = 0; for (let i = 0; i < v.length; i += SHAPE_FLOATS) worst = Math.max(worst, spread(v[i + 4]!));
    assert.ok(worst <= 16, `${s.id}: its colours are greys (worst spread ${worst})`);
    assert.ok(m.triangles[1]! < m.triangles[0]! && m.triangles[2]! < 40, `${s.id} levels: ${m.triangles}`);
  }
  // its garage at its own left (+x) or right (−x): the service point and the first parking at that side; none: one pad
  const L = traits(typology.house.make({ garage: 'left' }), kinds.house), R = traits(typology.house.make({ garage: 'right' }), kinds.house), N = traits(typology.house.make({ garage: 'none' }), kinds.house);
  const x = (t: typeof L, k: string) => (t[k] as { at: number[] }[])[0]!.at[0]!;
  assert.ok(x(L, 'service') > 5 && x(R, 'service') < -5 && x(L, 'parking') === x(L, 'service'));
  assert.equal((N.parking as unknown[]).length, 1);
  // the garage is drawn at every level, at its side, whatever the roof, size or levels (a flat-roofed two-storey house
  // 14 m wide with its garage at its left drew it too: it stood behind the house in a view of the house's back, as the
  // front faces the heading: heading 0, the front to the north, seen from the north)
  const { SHAPE_FLOATS: SF } = await import('../src/index.ts');
  const reach = (v: Float32Array) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < v.length; i += SF) { lo = Math.min(lo, v[i]!); hi = Math.max(hi, v[i]!); } return [lo, hi] as const; };
  for (const p of [{ width: 14, depth: 11, levels: 2, roof: 'flat', garage: 'left', driveway: 6 }, { width: 11, depth: 13, levels: 1, roof: 'dutch', pitch: 30, garage: 'left', driveway: 9 }, { width: 12, depth: 12, levels: 2, roof: 'hip', garage: 'right', driveway: 7 }, { width: 14, depth: 11, levels: 2, roof: 'flat', garage: 'none' }] as const) {
    const m = typology.house.make(p as never), side = p.garage === 'left' ? 1 : p.garage === 'right' ? -1 : 0;
    m.levels.forEach((v, k) => {
      const [lo, hi] = reach(v as Float32Array), far = side > 0 ? hi : side < 0 ? -lo : Math.max(hi, -lo);
      if (side) assert.ok(far > p.width / 2 + 3.5, `${JSON.stringify(p)} level ${k}: its garage reaches ${far.toFixed(1)} m out`);
      else assert.ok(far < p.width / 2 + 3.5, `no garage, level ${k}`);
    });
    const entry = (traits(m, kinds.house).entries as { at: number[] }[])[0]!;
    assert.ok(entry.at[2]! > p.depth / 2, 'its door at its front (+z), the side that faces its heading');
  }
  // an office: its bays by rows, a service point at the head of each of the first row's
  const o = traits(typology.office.make({ carpark: 2, bays: 9 }), kinds.office);
  assert.equal((o.parking as unknown[]).length, 18); assert.equal((o.service as unknown[]).length, 9); assert.equal((o.entries as unknown[]).length, 2);
});

test('neutral by default: the charger without a brand colour (its colours params), the car in a light grey', async () => {
  const { chargers, rgbOf, SHAPE_FLOATS } = await import('../src/index.ts');
  const { cars } = await import('../src/modules/presets/vehicles/index.ts');
  const colours = (v: Float32Array) => { const s = new Set<number>(); for (let i = 0; i < v.length; i += SHAPE_FLOATS) s.add(v[i + 4]!); return s; };
  const plain = colours(chargers.station(4).levels[0] as Float32Array), mine = colours(chargers.make({ brand: '#1f6feb', marking: '#2f8f5b' }).levels[0] as Float32Array);
  assert.ok(!plain.has(rgbOf('#1f6feb')) && !plain.has(rgbOf('#2f8f5b')) && mine.has(rgbOf('#1f6feb')) && mine.has(rgbOf('#2f8f5b')));
  // its lights (the status, the canopy's lamps) and its screen its only colours: everything else a grey
  for (const c of plain) assert.ok(spread(c) <= 24 || ['#34d399', '#0f1b26', '#fff7e0'].some((x) => c === rgbOf(x)), `#${c.toString(16)}`);
  assert.equal(cars.shape.params().paint, '#d4d6d8');
  for (const [name, p] of Object.entries(cars.package.presets)) assert.ok(spread(rgbOf(String(p.paint))) <= 16, `${name}: ${p.paint}`);
});

test('import: a model given a kind and its anchors (a list, by name, or from its bounds) carries the kind\'s traits', async () => {
  const { importShape } = await import('../src/core/geometry/import/gltf.ts');
  const { kinds, traits, asKind } = await import('../src/index.ts');
  // a cube 8 m a side (12 triangles) as a .glb
  const P: number[] = [], f = (a: number[], b: number[], c: number[]) => P.push(...a, ...b, ...c);
  const q = (a: number[], b: number[], c: number[], d: number[]) => { f(a, b, c); f(a, c, d); };
  const v = (x: number, y: number, z: number) => [x * 4, y * 4 + 4, z * 4];
  q(v(-1, -1, 1), v(1, -1, 1), v(1, 1, 1), v(-1, 1, 1)); q(v(1, -1, -1), v(-1, -1, -1), v(-1, 1, -1), v(1, 1, -1)); q(v(1, -1, 1), v(1, -1, -1), v(1, 1, -1), v(1, 1, 1));
  q(v(-1, -1, -1), v(-1, -1, 1), v(-1, 1, 1), v(-1, 1, -1)); q(v(-1, 1, 1), v(1, 1, 1), v(1, 1, -1), v(-1, 1, -1)); q(v(-1, -1, -1), v(1, -1, -1), v(1, -1, 1), v(-1, -1, 1));
  const pos = new Float32Array(P), json = { asset: { version: '2.0' }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0 }], meshes: [{ primitives: [{ attributes: { POSITION: 0 } }] }], accessors: [{ bufferView: 0, componentType: 5126, count: P.length / 3, type: 'VEC3' }], bufferViews: [{ buffer: 0, byteLength: pos.byteLength }], buffers: [{ byteLength: pos.byteLength }] };
  let j = new TextEncoder().encode(JSON.stringify(json)); const pad = (4 - (j.length % 4)) % 4; const jj = new Uint8Array(j.length + pad).fill(32); jj.set(j); j = jj;
  const out = new Uint8Array(28 + j.length + pos.byteLength), dv = new DataView(out.buffer);
  out.set([0x67, 0x6c, 0x54, 0x46]); dv.setUint32(4, 2, true); dv.setUint32(8, out.length, true); dv.setUint32(12, j.length, true); dv.setUint32(16, 0x4e4f534a, true); out.set(j, 20);
  dv.setUint32(20 + j.length, pos.byteLength, true); dv.setUint32(24 + j.length, 0x004e4942, true); out.set(new Uint8Array(pos.buffer), 28 + j.length);
  // as it is: a box, not a house (no entries, parking or service)
  const raw = await importShape('/house.glb', { fetch: async () => out.buffer, paint: false });
  assert.equal(kinds.house.check(raw).problems.length, 3);
  // as a house: its entry from its bounds (an adapter), parking and service given by name
  const home = await importShape('/house.glb', { fetch: async () => out.buffer, paint: false, kind: 'house', params: { levels: 2 }, anchors: (m) => ({
    'entry-1': { at: [0, 0, m.bounds[1][2] + 0.8], kind: 'entry', heading: 180 }, 'parking-1': { at: [6, 0, 7], kind: 'parking', heading: 180 }, 'service-1': { at: [5, 0, 4.2], kind: 'service' },
  }) });
  assert.equal(home.kind, 'house'); assert.deepEqual(kinds.house.check(home).problems, []);
  const t = traits(home, 'house'); assert.equal(t.levels, 2); assert.equal((t.parking as unknown[]).length, 1);
  assert.ok(Math.abs((t.roof as { surface: number }).surface - 64) < 1e-6, 'its top: 8 × 8, measured from what faces up');
  // the same triangles as another place's house: shared, its own anchors
  const there = asKind(home, 'house', { anchors: [{ name: 'parking-1', at: [-6, 0, 7], kind: 'parking' }] });
  assert.equal(there.levels[0], home.levels[0]); assert.equal(there.anchors.length, 1); assert.equal(home.anchors.length, 3);
  // placed as it is: entities({ shape: model }) (a made shape: the same triangles whatever a feature's params)
  const { entities } = await import('../src/index.ts');
  const homes = entities({ id: 'homes', shape: home, data: [{ id: 'h1', props: {}, geometry: { type: 'Point', coordinates: [145, -37.9] } }] });
  const sh = (homes as unknown as { ep: { shape: { id: string; make(p?: object): unknown } } }).ep.shape;
  assert.equal(sh.id, 'house'); assert.equal(sh.make({ levels: 3 }), home);
});

test('a house look of your own: a roof of your shape over its body and wings, a floor raised on posts with steps; unset, the house as it was', async () => {
  const { house, HOUSE, MeshBuilder, MESH_FLOATS, shape, num, buildings } = await import('../src/index.ts');
  const { Rng, orientedBox } = await import('../src/modules/world/earth/shared/plan.ts');
  // a slab exactly its width × depth, at its foot: where a roof of yours lands
  const calls: { width: number; depth: number; height: number }[] = [];
  const slab = shape({ id: 'slab', params: { width: num(0.1, 99, 1), depth: num(0.1, 99, 1), height: num(0, 30, 1) }, build: (b, p) => { calls.push({ ...p }); b.solid('box', { size: [p.width, 0.1, p.depth], at: [0, 0.05, 0], color: '#ff0000' }); } });
  const a = (30 * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), W = 14, D = 8;
  const ring = ([[-W / 2, -D / 2], [W / 2, -D / 2], [W / 2, D / 2], [-W / 2, D / 2]] as [number, number][]).map(([x, z]) => [x * c - z * s, x * s + z * c] as [number, number]);
  const box = orientedBox(ring), outside = (d: Float32Array, pick: (i: number) => boolean) => { let worst = 0; for (let i = 0; i < d.length; i += MESH_FLOATS) if (pick(i)) { const x = d[i]!, z = d[i + 2]!, u = (x - box.cx) * box.ux + (z - box.cz) * box.uz, vv = (x - box.cx) * box.vx + (z - box.cz) * box.vz; worst = Math.max(worst, Math.abs(u) - box.a, Math.abs(vv) - box.b); } return worst; };
  const red = (d: Float32Array) => (i: number) => d[i + 3] === 0xff0000;
  const mb = new MeshBuilder(), r = house(mb, { ring, height: 6, front: { x: -s, z: c } }, { ...HOUSE, roof: slab, forms: { gable: 1 } }, new Rng(3))!;
  const d = mb.build();
  // (unset: the house as it was, to the number)
  const m0 = new MeshBuilder(), m1 = new MeshBuilder(); house(m0, { ring, height: 6 }, HOUSE, new Rng(3)); house(m1, { ring, height: 6 }, { ...HOUSE, roof: undefined, raise: 0 }, new Rng(3));
  assert.deepEqual(m1.build(), m0.build());
  assert.ok(calls.length >= 1 && calls[0]!.width >= calls[0]!.depth, 'its width along the ridge (the long side)');
  assert.ok(outside(d, red(d)) < 1e-6, `the roof over the footprint, turned with it: ${outside(d, red(d))}`);
  // raised 1.8 m: its walls and eaves up by that, posts under its floor down to the ground, steps up to its door
  const up = new MeshBuilder(), r2 = house(up, { ring, height: 6 + 1.8, front: { x: -s, z: c } }, { ...HOUSE, roof: slab, forms: { gable: 1 }, raise: 1.8, posts: { color: '#123456' } }, new Rng(3))!;
  const u = up.build();
  assert.ok(Math.abs(r2.eave - (r.eave + 1.8)) < 1e-9 && Math.abs(r2.top - (r.top + 1.8)) < 1e-9);
  let posts = 0, low = Infinity; for (let i = 0; i < u.length; i += MESH_FLOATS) if (u[i + 3] === 0x123456) { posts++; low = Math.min(low, u[i + 1]!); }
  assert.ok(posts > 48 && low <= 0, `${posts} post vertices down to ${low}`);
  // a block with a roof of your shape: turned with its footprint too
  const blk = buildings({ id: 'b', data: [{ id: 'blk', props: { height: 12, class: 'office' }, geometry: { type: 'Polygon', coordinates: [ring.map(([x, z]) => [145 + x / 87900, -37.9 - z / 110574])] } }] as never, roofs: () => slab, windows: false });
  await blk.attach({ graphics: null, loader: null as never, profile: null, camera: null as never, world: { error: (e: unknown) => { throw e; } } as never });
  const ch = [...(blk as unknown as { pending: Map<string, { mesh: () => Float32Array }> }).pending.values()][0]!.mesh();
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, rx0 = Infinity, rx1 = -Infinity, rz0 = Infinity, rz1 = -Infinity;
  for (let i = 0; i < ch.length; i += MESH_FLOATS) { const x = ch[i]!, z = ch[i + 2]!; if (ch[i + 3] === 0xff0000) { rx0 = Math.min(rx0, x); rx1 = Math.max(rx1, x); rz0 = Math.min(rz0, z); rz1 = Math.max(rz1, z); } else { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } }
  assert.ok(Math.abs(rx0 - x0) < 0.05 && Math.abs(rx1 - x1) < 0.05 && Math.abs(rz0 - z0) < 0.05 && Math.abs(rz1 - z1) < 0.05, 'the roof over the block, not turned the other way');
});

test('network: a one-way line is gone its way only; toward a place, each node\'s next one on the way; both ways unchanged', async () => {
  const { network } = await import('../src/core/geometry/networks/index.ts');
  // a square block: its south side one way, east → west (against its points' order: −1); the rest both ways
  const k = 0.001, sq = (o: number) => [[145, -37.9], [145 + k, -37.9], [145 + k, -37.9 - k], [145, -37.9 - k]].map(([x, y]) => [x!, y!] as [number, number]);
  const p = sq(0);
  const lines = [{ line: [p[0]!, p[1]!], props: { way: 0 } }, { line: [p[1]!, p[2]!], props: { way: 0 } }, { line: [p[3]!, p[2]!], props: { way: -1 } }, { line: [p[3]!, p[0]!], props: { way: 0 } }];
  const both = network({ lines }), one = network({ lines, oneway: (q) => q.way });
  // west → east along the south side: both ways straight (≈ 88 m), one way round the other three sides
  const a: [number, number] = [145 + k * 0.1, -37.9 - k], b: [number, number] = [145 + k * 0.9, -37.9 - k];
  const r0 = both.route(a, b)!, r1 = one.route(a, b)!, back = one.route(b, a)!;
  assert.ok(r0.cost < 80 && r1.cost > 250 && back.cost < 80, `${r0.cost.toFixed(0)} · ${r1.cost.toFixed(0)} · ${back.cost.toFixed(0)}`);
  // toward a node: its costs to it, prev the next node on the way
  const at = (q: [number, number]) => one.xs.findIndex((x, i) => Math.abs(x - one.local(q)[0]) < 1 && Math.abs(one.zs[i]! - one.local(q)[1]) < 1), sw = at(p[3]!), se = at(p[2]!);
  const t = one.shortest([{ node: sw }], { toward: true }), o = one.shortest([{ node: sw }]);
  assert.ok(t.dist[se]! < 100 && o.dist[se]! > 250, `from the south-east corner to the south-west one (${t.dist[se]!.toFixed(0)}) ≠ from it back (${o.dist[se]!.toFixed(0)})`);
  assert.equal(t.prev[se], sw, 'the south-east corner goes on west, the way the south side goes');
  // every line both ways: toward and from are the same costs
  const bt = both.shortest([{ node: 0 }], { toward: true }).dist, bo = both.shortest([{ node: 0 }]).dist;
  assert.deepEqual(Array.from(bt), Array.from(bo));
  assert.equal(both.radj, both.adj);
});

test('history.fromColumns: a recorded track straight from its arrays, the same columns as appending it, a thing out of order sorted', async () => {
  const { history, AslnutError } = await import('../src/index.ts');
  const T0 = Date.UTC(2026, 9, 14, 21), N = 300, count = new Uint32Array(N), ids: string[] = [];
  let S = 0; for (let i = 0; i < N; i++) { count[i] = 3 + (i % 7); S += count[i]!; ids.push(`v${i}`); }
  const t = new Float64Array(S), lon = new Float64Array(S), lat = new Float64Array(S), charge = new Float32Array(S);
  let k = 0; for (let i = 0; i < N; i++) { let x = 145.1 + i * 1e-4, y = -37.92; for (let j = 0; j < count[i]!; j++, k++) { x += 2e-4 * Math.cos(i + j); y += 2e-4 * Math.sin(2 * i + j); t[k] = T0 + i * 7 + j * 9000; lon[k] = x; lat[k] = y; charge[k] = 1 - j / 12; } }
  const values = { charge: { type: 'u8' as const, domain: [0, 1] as [number, number] } };
  const cols = history.smallest({ box: [145.0, -38.0, 145.3, -37.8], from: T0, to: T0 + 3600e3 });
  const a = history.log({ keep: Infinity, place: cols.place, time: cols.time, values }), rows: Parameters<typeof a.appendMany>[0] & unknown[] = [];
  k = 0; for (let i = 0; i < N; i++) for (let j = 0; j < count[i]!; j++, k++) rows.push({ id: ids[i]!, t: t[k]!, lon: lon[k]!, lat: lat[k]!, values: { charge: charge[k]! }, props: j ? undefined : { n: i } });
  a.appendMany(rows);
  const b = history.fromColumns({ ids, count, t, lon, lat, values: { charge }, props: ids.map((_, i) => ({ n: i })) }, { place: cols.place, time: cols.time, values });
  assert.equal(b.size, N); assert.equal(b.samples, S); assert.equal(b.maxSpeed, a.maxSpeed); assert.deepEqual(b.bounds(), a.bounds()); assert.equal(b.from, a.from); assert.equal(b.to, a.to);
  for (let i = 0; i < N; i++) for (let j = 0; j < count[i]!; j++) { const sa = a.slot(i, j), sb = b.slot(i, j); assert.ok(a.time[sa] === b.time[sb] && a.place[2 * sa] === b.place[2 * sb] && a.place[2 * sa + 1] === b.place[2 * sb + 1] && a.cols[0]![sa] === b.cols[0]![sb]); }
  const when = T0 + 10e3; assert.deepEqual(b.at('v5', when), a.at('v5', when));
  // its room exact (no slots left by growing), and it may be appended to
  assert.equal(b.used, S); assert.ok(b.append('v1', T0 + 3000e3, 145.2, -37.9, { charge: 0.5 }) && b.count[1] === count[1]! + 1);
  // the columns chosen for it when not said; a thing's samples out of order: sorted
  const c = history.fromColumns({ ids: ['x'], count: [3], t: [T0 + 2000, T0, T0 + 1000], lonlat: [145.02, -37.9, 145.0, -37.9, 145.01, -37.9] });
  assert.equal(c.timeType, 'u16'); assert.deepEqual([0, 1, 2].map((j) => c.secAt(c.slot(0, j))), [0, 1, 2]);
  assert.ok(Math.abs(c.at('x', T0 + 500)!.lon - 145.005) < 1e-6);
  assert.throws(() => history.fromColumns({ ids: ['x'], count: [2], t: [T0, T0 + 9e6], lonlat: [145, -37.9, 145.1, -37.9] }, { time: { type: 'u16', epoch: T0, step: 0.1 } }), (e: unknown) => e instanceof AslnutError);
  assert.throws(() => history.fromColumns({ ids: ['x', 'y'], count: [2], t: [T0, T0] }), (e: unknown) => e instanceof AslnutError);
});

test('a footprint: the box of a group named walls when the shape has one (a carport post and a letterbox outside left out), else the box of all that stands over 0.3 m', async () => {
  const { shape, kinds, footprintOf } = await import('../src/index.ts');
  const house = (walled: boolean) => shape({ id: walled ? 'walled' : 'plain', kind: kinds.house, build: (b) => {
    if (walled) b.group('walls', (g) => g.solid('box', { size: [9, 3, 12], at: [0, 1.5, 0] }));
    else b.solid('box', { size: [9, 3, 12], at: [0, 1.5, 0] });
    b.solid('box', { size: [0.15, 2.4, 0.15], at: [7, 1.2, 9] });     // a carport post, out by the drive
    b.solid('box', { size: [0.3, 1.1, 0.3], at: [-2, 0.55, 8.5] });    // a letterbox at the front
    b.anchor('entry-1', [0, 0, 6.8], { kind: 'entry', heading: 180 });
    b.anchor('parking-1', [7, 0, 8], { kind: 'parking', heading: 180 });
    b.anchor('service-1', [4.6, 0, 3], { kind: 'service' });
  } }).make();
  const near = (a: number, b: number) => assert.ok(Math.abs(a - b) < 1e-3, `${a} ≠ ${b}`);
  const w = footprintOf(house(true)), p = footprintOf(house(false));
  near(w.width, 9); near(w.depth, 12); assert.equal(w.from, 'walls');
  near(p.width, 7.075 + 4.5); near(p.depth, 9.075 + 6); assert.equal(p.from, 'standing');
  // the bay by the post: outside the walls; inside the larger box, said with the span and the way out
  assert.equal(kinds.house.check(house(true)).ok, true, kinds.house.check(house(true)).problems.join('; '));
  const plain = kinds.house.check(house(false)).problems.join('\n');
  assert.match(plain, /'parking-1' is inside the footprint \(the box of all that stands over 0\.3 m; a group named 'walls' sets it instead: x -4\.5 to 7\.1/);
});
