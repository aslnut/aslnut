// The healthy-city parts that need no graphics: natural and pretty breaks, and the stats kit (counts, sums, a prop,
// normalised, ranked, live when its inputs change).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { data, scale, stats, areaKm2, jenksBreaks, prettyBreaks } from '../src/index.ts';

const sq = (id: string, x: number, y: number, s: number, props = {}) => ({ type: 'Feature', id, properties: { name: id, ...props }, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] } });
const pt = (id: string, x: number, y: number, props = {}) => ({ type: 'Feature', id, properties: props, geometry: { type: 'Point', coordinates: [x, y] } });

test('scale: natural breaks find the clusters; pretty breaks are round', () => {
  assert.deepEqual(jenksBreaks([1, 2, 3, 10, 11, 12, 30, 31], 3), [10, 30]);
  assert.deepEqual(prettyBreaks(0, 97, 5), [20, 40, 60, 80]);
  const s = scale.jenks((d: { props: { v: number } }) => d.props.v, { n: 3, range: ['#000', '#888', '#fff'] });
  s.prepare([1, 2, 3, 10, 11, 12, 30, 31].map((v) => ({ props: { v } })));
  assert.equal(s({ props: { v: 2 } }), '#000'); assert.equal(s({ props: { v: 11 } }), '#888'); assert.equal(s({ props: { v: 31 } }), '#fff');
  assert.equal(s.legend().items.length, 3);
});

test('stats: counts, sums and props per area, normalised and ranked, live', async () => {
  // two squares 0.1° across near the equator (≈ 11.1 km each side), a third with nothing in it
  const areas = data.geojson({ type: 'FeatureCollection', features: [sq('a', 0, 0, 0.1, { pop: 2000 }), sq('b', 0.2, 0, 0.1, { pop: 500 }), sq('c', 0.4, 0, 0.1, { pop: 0 })] });
  const parks = data.geojson({ type: 'FeatureCollection', features: [pt('p1', 0.05, 0.05, { ha: 2, kind: 'park' }), pt('p2', 0.02, 0.08, { ha: 3, kind: 'park' }), pt('p3', 0.25, 0.05, { ha: 7, kind: 'sport' })] });
  const ctx = { loader: null as never, error: (e: unknown) => { throw e; } };
  await areas.start(ctx); await parks.start(ctx);
  assert.ok(Math.abs(areaKm2(areas.get('a')!) - 123.1) < 1, `area ${areaKm2(areas.get('a')!)}`);
  const count = stats({ areas, of: parks, count: true });
  assert.deepEqual(count.rows().map((r) => [r.id, r.value]), [['a', 2], ['b', 1], ['c', 0]]);
  assert.equal(count.ranked()[0]!.id, 'a'); assert.equal(count.get('a')!.props.rank, 1);
  const ha = stats({ areas, of: parks, sum: 'ha', filter: { kind: 'park' }, per: 'pop', scale: 1000 });
  assert.equal(ha.get('a')!.props.value, 2.5); assert.equal(ha.get('b')!.props.value, 0);
  assert.equal(ha.get('c')!.props.value, null, 'divided by zero people: no value');
  const own = stats({ areas, value: 'pop', per: 'km2' });
  assert.ok(Math.abs(Number(own.get('a')!.props.value) - 2000 / 123.1) < 0.2);
  // live: new options, new rows
  let changed = 0; count.watch(() => changed++);
  count.setOptions({ filter: { kind: 'sport' } });
  assert.deepEqual(count.rows().map((r) => r.value), [0, 1, 0]); assert.ok(changed > 0);
  assert.ok(Math.abs(count.total - 1) < 1e-9);
});

import { MeshBuilder, MESH_FLOATS, packNormal, skyNow, sunAt, moonAt, localTime, shadowBox, Camera } from '../src/index.ts';
import { cityTile } from '../src/modules/world/earth/street.ts';
const normalOf = (d: Float32Array, v: number): [number, number, number] => { const n = d[v * MESH_FLOATS + 6]!, qx = Math.floor(n / 4096), qy = n % 4096; let x = (qx / 4095) * 2 - 1, y = (qy / 4095) * 2 - 1; let z = 1 - Math.abs(x) - Math.abs(y); if (z < 0) { const k = -z; x += x >= 0 ? -k : k; y += y >= 0 ? -k : k; } const l = Math.hypot(x, y, z); return [x / l, z / l, y / l]; };

test('builder: faces point out of solids and up from the ground, whatever the ring winding', () => {
  // a 10 m square, counter-clockwise on the map (x east, z south: north is -z) and the same reversed
  const ccw: [number, number][] = [[0, 0], [10, 0], [10, -10], [0, -10]], cw = [...ccw].reverse() as [number, number][];
  for (const ring of [ccw, cw]) {
    const mb = new MeshBuilder(); mb.prism(ring.slice(0) as [number, number][], 0, 5, '#fff', '#888', [0, 1, 2, 0, 2, 3]);
    const d = mb.build(), n = d.length / MESH_FLOATS;
    for (let v = 0; v < n; v += 3) {
      const [nx, ny, nz] = normalOf(d, v), cx = (d[v * MESH_FLOATS]! + d[(v + 1) * MESH_FLOATS]! + d[(v + 2) * MESH_FLOATS]!) / 3, cz = (d[v * MESH_FLOATS + 2]! + d[(v + 1) * MESH_FLOATS + 2]! + d[(v + 2) * MESH_FLOATS + 2]!) / 3;
      if (ny > 0.9) continue;   // the roof
      assert.ok(nx * (cx - 5) + nz * (cz + 5) > 0, `a wall faces in: n ${nx.toFixed(2)},${nz.toFixed(2)} at ${cx},${cz}`);
    }
    assert.ok(normalOf(d, n - 1)[1] > 0.99, 'the roof faces up');
  }
  const b = new MeshBuilder(); b.box(0, 0, 0, 2, 3, 2, 0.3, '#fff');
  const d = b.build();
  for (let v = 0; v < d.length / MESH_FLOATS; v += 3) { const [nx, ny, nz] = normalOf(d, v), x = (d[v * MESH_FLOATS]! + d[(v + 1) * MESH_FLOATS]! + d[(v + 2) * MESH_FLOATS]!) / 3, y = (d[v * MESH_FLOATS + 1]! + d[(v + 1) * MESH_FLOATS + 1]! + d[(v + 2) * MESH_FLOATS + 1]!) / 3, z = (d[v * MESH_FLOATS + 2]! + d[(v + 1) * MESH_FLOATS + 2]! + d[(v + 2) * MESH_FLOATS + 2]!) / 3; assert.ok(nx * x + ny * (y - 1.5) + nz * z > 0, 'a box face points out'); }
  assert.equal(packNormal(0, 1, 0), packNormal(0, 1, 0));
});

test('sky: the sun and the moon where the almanac puts them; the light by day and night', () => {
  // Melbourne, 15 Jan 2026 15:00 AEDT (04:00 UTC): the sun high in the north-west
  const t = Date.UTC(2026, 0, 15, 4, 0), s = sunAt(t, -37.81, 144.96);
  assert.ok(s.altitude > 55 && s.altitude < 70 && s.azimuth > 280 && s.azimuth < 330, JSON.stringify(s));
  const night = skyNow(Date.UTC(2026, 0, 15, 13, 0), 144.96, -37.81), day = skyNow(t, 144.96, -37.81);
  assert.ok(day.light.shadows && day.light.daylight > 0.9 && !night.light.shadows && night.light.daylight < 0.2);
  assert.ok(day.light.color[0] > 0.5 && night.light.color[0] < 0.1, 'the sun lights the day; at night only the moon, faintly');
  const m = moonAt(t, -37.81, 144.96); assert.ok(m.illumination >= 0 && m.illumination <= 1 && m.phase >= 0 && m.phase < 1);
  // wall-clock time in a zone, with its offset (daylight saving: +11 h in January)
  const lt = localTime(new Date(t), 144.96, 'Australia/Melbourne'); assert.deepEqual([lt.hour, lt.minute, lt.offset], [15, 0, 660]);
  // the shadow box: near views get one, a view from far away none
  const c = new Camera({ lon: 144.96, lat: -37.81, zoom: 17, tilt: 50 }); c.update(800, 600, 16);
  assert.ok(shadowBox(c, day.light.dir, 2048, 1500)); const far = new Camera({ lon: 144.96, lat: -37.81, zoom: 9 }); far.update(800, 600, 16);
  assert.equal(shadowBox(far, day.light.dir, 2048, 1500), null);
});

test('street tile: roads, houses, trees and parks become solids with what each one is', () => {
  const tile = { v: 1, ix: 0, iz: 0, size: 500, s: ['', 'Main Street', 'house', 'Central Park', 'Parkland and garden'],
    roads: [[5, 75, 1, 0, 2500, 5000, 0]], buildings: [[65, 0, 2, 2000, 2700, 120, 0, 0, 100, -120, 0]], trees: [3000, 2800, 120, 35],
    parks: [[3, 4, 9000, 3500, 3500, 600, 0, 0, 600, -600, 0]], water: [], streams: [] };
  const ctx = { ix: 0, iz: 0, size: 500, origin: [145, -37.9] as [number, number], at: [0, 0] as [number, number], groundAt: () => 50, lonLat: (x: number, z: number) => [145 + x / 88000, -37.9 - z / 110574] as [number, number] };
  const b = cityTile(tile, ctx);
  assert.ok(b.chunk.mesh.length / MESH_FLOATS > 200, 'a mesh');
  assert.equal(b.chunk.instances.length, 1, 'one grown tree: its species variant');
  const lv = b.chunk.instances[0]!.shape as readonly unknown[];
  assert.equal(lv.length, 3, 'whole, simple, impostor'); assert.equal((lv[2] as { kind: string }).kind, 'impostor');
  assert.ok((lv[0] as Float32Array).length > (lv[1] as Float32Array).length, 'the simple one is lighter');
  const kinds = new Set<string>(); for (let i = 0; i < 10; i++) { const x = b.chunk.info(i); if (x) kinds.add(x.kind); }
  assert.deepEqual([...kinds].sort(), ['building', 'park', 'pole', 'road', 'tree'].filter((k) => kinds.has(k)).sort());
  assert.ok(kinds.has('road') && kinds.has('building') && kinds.has('tree') && kinds.has('park'));
  assert.equal(b.extra.houses.length, 1); assert.equal(b.extra.roads[0]!.name, 'Main Street');
});

import { network } from '../src/index.ts';
test('networks: a graph from lines, the nearest point, routes, every node from many sources at once, isochrones', () => {
  // a 3 × 3 grid of streets 0.001° apart (≈ 88 m east-west, 111 m north-south at 37.9° S), the middle row a freeway
  const L = (a: [number, number], b: [number, number], cls = 5) => ({ line: [a, b], props: { cls } });
  const p = (i: number, j: number): [number, number] => [145 + i * 0.001, -37.9 - j * 0.001];
  const lines = [];
  for (let j = 0; j < 3; j++) for (let i = 0; i < 2; i++) lines.push(L(p(i, j), p(i + 1, j), j === 1 ? 0 : 5));
  for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) lines.push(L(p(i, j), p(i, j + 1)));
  const net = network({ lines, keep: (q) => q.cls !== 0 });
  assert.equal(net.size.nodes, 9); assert.equal(net.size.pieces, 10);
  const near = net.nearest([145.0005, -37.90002])!; assert.ok(near.distance < 3, `nearest ${near.distance}`);
  // from the north-west corner to the south-east one: 2 east + 2 south, the freeway row not walked
  const r = net.route(p(0, 0), p(2, 2))!;
  const ew = 0.001 * 111320 * Math.cos(37.9 * Math.PI / 180), ns = 0.001 * 110574;
  assert.ok(Math.abs(r.cost - (2 * ew + 2 * ns)) < 2, `route ${r.cost}`); assert.ok(r.line.length >= 5);
  // two sources: every node takes the nearest
  const s = net.shortest([{ at: p(0, 0) }, { at: p(2, 2) }]);
  assert.ok(Math.abs(s.costAt(p(1, 0)) - ew) < 1 && Math.abs(s.costAt(p(2, 1)) - ns) < 1);
  assert.ok(s.pathFrom(p(1, 0))!.length >= 2);
  const iso = net.isochrone(p(0, 0), [150, 400]);
  assert.equal(iso.length, 2); assert.equal(iso[0]!.props.within, 400);
  // a smooth outline: the 150 m one round the corner, the 400 m one reaching the far corner's streets
  const ringOf = (ff: unknown) => { const f = ff as { geometry: { type: string; coordinates: unknown } }; return (f.geometry.type === 'Polygon' ? (f.geometry.coordinates as [number, number][][])[0]! : (f.geometry.coordinates as [number, number][][][])[0]![0]!); };
  const inRing = (pt: [number, number], rg: [number, number][]) => { let c = false; for (let a = 0, bb = rg.length - 1; a < rg.length; bb = a++) { const [xa, ya] = rg[a]!, [xb, yb] = rg[bb]!; if ((ya > pt[1]) !== (yb > pt[1]) && pt[0] < ((xb - xa) * (pt[1] - ya)) / (yb - ya) + xa) c = !c; } return c; };
  assert.ok(inRing([145.0005, -37.9], ringOf(iso[1]!)), 'halfway along the first street');
  assert.ok(!inRing([145.0019, -37.9], ringOf(iso[1]!)), 'not past 150 m');
  assert.ok(inRing([145.001, -37.9015], ringOf(iso[0]!)), '400 m: the middle column, halfway down');
  assert.ok(ringOf(iso[1]!).length > 8, 'a contour, not a box');
  // from a pass already made: the same areas, no second pass; a pass of another network refused
  const pass = net.shortest([{ at: p(0, 0) }]), again = net.isochrone(pass, [150, 400]);
  assert.deepEqual(again.map((f) => f.geometry), iso.map((f) => f.geometry), 'the same areas from the pass');
  assert.throws(() => net.isochrone({ ...pass, dist: new Float64Array(3) }, [150]), /the pass given has 3 nodes, this network 9/);
  // a matrix: from two places to two
  const m = net.matrix([p(0, 0), p(2, 2)], [p(2, 0), p(0, 2)]);
  assert.ok(Math.abs(m[0]![0]! - 2 * ew) < 2 && Math.abs(m[1]![0]! - 2 * ns) < 2, JSON.stringify(m));
});

test('procedural trees: branching grows a trunk, branches and leaf cards; levels; the crown lets some sun through', async () => {
  const { branching } = await import('../src/core/geometry/shapes/recipes.ts');
  const { SHAPE_FLOATS } = await import('../src/core/geometry/shapes/mesh.ts');
  const t = branching({ trunk: { height: 9, radius: 0.3 }, levels: [{ count: 6, angle: 50, length: 0.55, taper: 0.55 }, { count: 4, angle: 40, length: 0.5, taper: 0.6 }], leaves: { kind: 'broad', size: 2, density: 3 }, seed: 3 });
  const [whole, simple, far] = t.levels;
  assert.ok(whole.length / SHAPE_FLOATS > simple.length / SHAPE_FLOATS && simple.length > far.length);
  let cards = 0; for (let i = 5; i < whole.length; i += SHAPE_FLOATS) if (whole[i]! >= 65536) cards++;
  assert.equal(cards, t.counts.cards * 6, 'every card vertex carries its cut-out');
  assert.ok(t.height > 9 && t.crownRadius > 2 && t.crownBase > 1 && t.crownBase < t.height);
  assert.ok(t.transmissivity > 0.02 && t.transmissivity < 0.6, `transmissivity ${t.transmissivity}`);
  const again = branching({ trunk: { height: 9, radius: 0.3 }, levels: [{ count: 6, angle: 50, length: 0.55, taper: 0.55 }, { count: 4, angle: 40, length: 0.5, taper: 0.6 }], leaves: { kind: 'broad', size: 2, density: 3 }, seed: 3 });
  assert.deepEqual(again.levels[0], whole, 'the same seed, the same tree');
  const { impostor } = await import('../src/core/geometry/shapes/levels.ts');
  const imp = impostor(whole, { views: 8 });
  assert.equal(imp.views, 8); assert.equal(imp.size, 512); assert.ok(imp.radius > t.crownRadius && Math.abs(imp.centreY - t.height / 2) < t.height * 0.25);
});

test('canopy: a crown thinned to the sun it should let through; the heat model reads the same number', async () => {
  const { treeInstances, treeCrown, TREES } = await import('../src/modules/world/earth/presets/living/plants/index.ts');
  const { INSTANCE_FLOATS } = await import('../src/core/geometry/shapes/mesh.ts');
  const t = { x: 10, z: 10, height: 9, radius: 4, id: 1, seed: 7 };
  const natural = treeCrown(t);
  const full = treeInstances([t])[0]!;
  assert.equal(full.data.length, INSTANCE_FLOATS); assert.equal(full.data[9], 0, 'all its leaves');
  const look = { ...TREES, canopy: { transmit: () => 0.5 } };
  const thinned = treeInstances([t], look)[0]!;
  assert.ok(thinned.data[9]! > 0 && thinned.data[9]! < 1, `thinned by ${thinned.data[9]}`);
  assert.equal(treeCrown(t, look).transmissivity, Math.max(0.5, natural.transmissivity));
  assert.ok(natural.top === 9 && natural.base > 0 && natural.base < 9 && natural.radius > 1);
});

test('species library: every species grows within its budget, its own height and shape; botanical names find theirs; a named tree grows from the library', async () => {
  const { SPECIES, speciesOf } = await import('../src/modules/world/earth/presets/living/plants/species.ts');
  const { branching } = await import('../src/core/geometry/shapes/recipes.ts');
  const { SHAPE_FLOATS } = await import('../src/core/geometry/shapes/mesh.ts');
  const { treeInstances, TREES } = await import('../src/modules/world/earth/presets/living/plants/index.ts');
  const seen = new Set<string>();
  for (const [name, sp] of Object.entries(SPECIES)) {
    const t = branching({ ...sp.spec, seed: 11 }), v = t.levels.map((l) => l.length / SHAPE_FLOATS);
    assert.ok(v[0]! < 40000 && v[0]! > v[1]! && v[1]! > v[2]!, `${name}: vertices ${v}`);
    assert.ok(t.height >= sp.spec.trunk.height && t.height < sp.spec.trunk.height * 1.8 && t.crownRadius > 0.8 && t.transmissivity > 0.001 && t.transmissivity < 0.8, `${name}: ${t.height} ${t.crownRadius} ${t.transmissivity}`);
    const k = `${t.height.toFixed(1)}:${t.crownRadius.toFixed(1)}:${t.counts.cards}`; assert.ok(!seen.has(k), `${name} is like another`); seen.add(k);
  }
  assert.ok(Object.keys(SPECIES).length >= 15);
  assert.equal(speciesOf('Platanus x acerifolia'), 'plane'); assert.equal(speciesOf('Eucalyptus camaldulensis'), 'eucalypt'); assert.equal(speciesOf('Corymbia maculata'), 'eucalypt');
  assert.equal(speciesOf('pine'), 'pine'); assert.equal(speciesOf('Maxima unknown'), null); assert.equal(speciesOf('Banksia integrifolia', { banksia: 'paperbark' }), 'paperbark');
  // a tree named 'Ulmus procera' (not in the mix) is grown from the library's elm; one named nothing, from the mix
  const [elm] = treeInstances([{ x: 0, z: 0, height: 15, radius: 6, id: 1, seed: 3, species: 'Ulmus procera' }], TREES);
  assert.ok(elm!.shape.startsWith('library:elm:'), elm!.shape);
  const [plain] = treeInstances([{ x: 0, z: 0, height: 9, radius: 4, id: 1, seed: 3 }], TREES);
  assert.ok(plain!.shape.startsWith('tree:'), plain!.shape);
});

test('procedural trees by space colonisation: branches grow into the crown, thick at the foot, leafy at the tips', async () => {
  const { branching } = await import('../src/core/geometry/shapes/recipes.ts');
  const t = branching({ trunk: { height: 10, radius: 0.3, clear: 0.3 }, crown: 'round', method: 'colonize', levels: [{ count: 1, angle: 0, length: 1, taper: 1 }, { count: 1, angle: 0, length: 1, taper: 1 }], leaves: { size: 2.4, density: 2 }, seed: 5 });
  assert.ok(t.counts.cards > 50 && t.crownRadius > 2 && t.height > 10, JSON.stringify({ c: t.counts, h: t.height, r: t.crownRadius }));
  assert.ok(t.crownBase > 2 && t.crownBase < 6, `the crown starts above the clear trunk: ${t.crownBase}`);
});

test('builder by options: box (rounded too), cylinder on any axis with its ends, sphere; every face outward', async () => {
  const { MeshBuilder, MESH_FLOATS } = await import('../src/index.ts');
  const inward = (f: (mb: InstanceType<typeof MeshBuilder>) => void, c: number[]) => {
    const mb = new MeshBuilder(); f(mb); const d = mb.build(); let bad = 0, n = 0;
    for (let i = 0; i < d.length; i += MESH_FLOATS * 3) {
      const a = [d[i]!, d[i + 1]!, d[i + 2]!], b = [d[i + 8]!, d[i + 9]!, d[i + 10]!], e = [d[i + 16]!, d[i + 17]!, d[i + 18]!];
      const u = [b[0]! - a[0]!, b[1]! - a[1]!, b[2]! - a[2]!], v = [e[0]! - a[0]!, e[1]! - a[1]!, e[2]! - a[2]!];
      const nx = u[1]! * v[2]! - u[2]! * v[1]!, ny = u[2]! * v[0]! - u[0]! * v[2]!, nz = u[0]! * v[1]! - u[1]! * v[0]!;
      if (Math.hypot(nx, ny, nz) < 1e-9) continue; n++;
      if (nx * ((a[0]! + b[0]! + e[0]!) / 3 - c[0]!) + ny * ((a[1]! + b[1]! + e[1]!) / 3 - c[1]!) + nz * ((a[2]! + b[2]! + e[2]!) / 3 - c[2]!) < 0) bad++;
    }
    assert.ok(n > 0); return bad;
  };
  assert.equal(inward((mb) => mb.box({ size: [2, 1, 3], at: [1, 0.5, 2] }), [1, 0.5, 2]), 0);
  assert.equal(inward((mb) => mb.box({ size: [2, 1, 3], at: [1, 0.5, 2], round: 0.2 }), [1, 0.5, 2]), 0);
  for (const axis of ['x', 'y', 'z'] as const) assert.equal(inward((mb) => mb.cylinder({ radius: 0.5, size: 2, at: [0, 1, 0], axis }), [0, 1, 0]), 0, axis);
  assert.equal(inward((mb) => mb.sphere({ radius: 1, at: [0, 2, 0] }), [0, 2, 0]), 0);
});

test('vegetation: trees from points and planted areas, in 500 m chunks, each grown from its species', async () => {
  const { vegetation, world } = await import('../src/index.ts');
  const w = await world(null, { view: { lon: 145.12, lat: -37.92, zoom: 16 } });
  const v = vegetation({ id: 'v', data: [{ type: 'Feature', id: 'p1', properties: { height: 10 }, geometry: { type: 'Point', coordinates: [145.12, -37.92] } }, { type: 'Feature', id: 'park', properties: {}, geometry: { type: 'Polygon', coordinates: [[[145.121, -37.921], [145.123, -37.921], [145.123, -37.919], [145.121, -37.919], [145.121, -37.921]]] } }] as never, density: () => 50, species: (d) => (d.id === 'p1' ? 'columnar' : 'eucalypt') });
  w.add(v); await new Promise((ok) => setTimeout(ok, 50));
  assert.deepEqual(v.keys().sort(), ['0_-1', '0_0']);
  w.dispose();
});

test('authoring: a shape of params and verbs; levels; checks; presets; forms; a grammar; a kit', async () => {
  const { shape, num, color, choice, flag, preset, form, grammar, kitbash, MeshBuilder } = await import('../src/index.ts');
  const bin = shape({ id: 'bin', params: { lid: color('#c43c2c'), height: num(0.9, 1.2, 1.05), wheels: flag(true) }, budget: { whole: 600 }, simple: true, far: 'impostor',
    build: (b, p) => {
      b.sweep([[-0.29, -0.36], [0.29, -0.36], [0.29, 0.36], [-0.29, 0.36]], { up: p.height - 0.07 }, { color: '#2f4f3a', scale: [0.88, 1] });
      b.solid('box', { size: [0.62, 0.06, 0.78], at: [0, p.height - 0.03, 0], color: p.lid, round: 0.02, material: 'painted' });
      if (p.wheels) b.copy((b) => b.solid('cylinder', { radius: 0.1, size: 0.05, axis: 'x', at: [0.27, 0.1, -0.33], detail: 1 }), { mirror: 'x' });
      b.part('lid', (b) => b.solid('box', { size: [0.1, 0.02, 0.1], at: [0, p.height, 0.3] }), { pivot: [0, p.height, -0.38] });
      b.anchor('handle', [0, p.height - 0.08, -0.4], { kind: 'grip' });
    } });
  const m = bin.make();
  assert.equal(m.levels.length, 3); assert.equal((m.levels[2] as { kind: string }).kind, 'impostor');
  assert.ok(m.triangles[0]! > m.triangles[1]!, 'the simple level is lighter');
  assert.equal(m.anchors[0]!.name, 'handle'); assert.equal(m.parts[0]!.name, 'lid');
  assert.deepEqual(bin.check().problems, []);
  assert.equal(bin.make({ height: 9 }).bounds[1][1] < 1.3, true, 'params are clamped to their range');
  const red = preset(bin, 'red', { lid: '#ff0000' }); assert.equal(red.params().lid, '#ff0000');
  assert.deepEqual(form(bin).controls.map((c) => c.kind), ['colour', 'slider', 'switch']);
  const over = shape({ budget: { whole: 10 }, build: (b) => b.solid('sphere', { radius: 1 }) });
  // pay only for what is set: no levels asked for, none made (the whole one stands in, the same array)
  const plain = shape({ build: (b) => b.solid('box', { size: 1 }) }).make();
  assert.ok(plain.levels[0] === plain.levels[1] && plain.levels[1] === plain.levels[2]);
  assert.match(over.check().problems.join(), /over its budget/);
  // a grammar: a lot split into floors, each floor's front into bays with a window
  const block = grammar({ params: { floors: { kind: 'int', min: 1, max: 6, def: 3 } as never }, lot: (p: { floors: number }) => ({ size: [12, p.floors * 3, 10] }),
    rules: {
      Lot: (s, p, go) => { s.solid('box', { color: '#b0a090' }); for (const f of s.split('y', Array(Number(p.floors)).fill(3))) go('Floor', f.faces().front); s.roof('flat'); },
      Floor: (s, _p, go) => { for (const bay of s.repeat('x', 3)) go('Bay', bay); },
      Bay: (s) => { s.inset(0.6, 0.8, 0.6, 0.6).panel({ material: 'glass', flat: true }); },
    } });
  const bm = block.make({ floors: 4 } as never);
  assert.ok(bm.triangles[0]! >= 12 + 4 * 4 * 2, `windows on every floor: ${bm.triangles[0]}`);
  assert.equal(bm.bounds[1][1] > 11.9 && bm.bounds[1][1] < 12.4, true);
  // a kit: two pieces snapped together
  const post = shape({ build: (b) => b.solid('box', { size: [0.2, 1, 0.2], at: [0, 0.5, 0] }) }), rail = shape({ build: (b) => b.solid('box', { size: [2, 0.1, 0.1], at: [0, 0.9, 0] }) });
  const fence = kitbash({ post, rail } as never, [{ piece: 'post', at: [0, 0, 0] }, { piece: 'post', at: [2.04, 0, 0] }, { piece: 'rail', at: [1, 0, 0] }], { grid: 0.5 });
  const fb = fence.make(); assert.ok(Math.abs(fb.bounds[1][0] - 2.1) < 0.01, 'snapped to the half-metre grid');
  // into a mesh (a chunk's): the triangles carry the id and the material
  const mb = new MeshBuilder(); bin.into(mb, {}, { at: [10, 0, 10], id: 7 });
  const d = mb.build(); assert.ok(d.length > 0); let painted = false; for (let i = 7; i < d.length; i += 8) { if (d[i]! % 65536 !== 7) throw new Error('id'); if (Math.floor(d[i]! / 65536) === 1) painted = true; } assert.ok(painted, 'materials ride with the id');
  void choice;
});

test('sky: the haze as asked (thicker, a clear day of its own, thinning higher), the clouds\' shadow deck in the light', async () => {
  const { sky, makeState } = await import('../src/index.ts');
  const s = makeState({ view: { lon: 145.12, lat: -37.92, zoom: 15 }, time: { now: new Date(Date.UTC(2026, 0, 15, 2, 0, 0)) } });
  const plain = sky().setWeather('partly', { seconds: 0 }).light(s);
  const thick = sky({ haze: { level: 2 } }).setWeather('partly', { seconds: 0 }).light(s);
  const clear = sky({ haze: { clear: 20000 } }).setWeather('partly', { seconds: 0 }).light(s);
  const high = sky({ haze: { height: 6000 } }).setWeather('partly', { seconds: 0 }).light(s);
  assert.ok(Math.abs(thick.visibility! - plain.visibility! / 2) < 1, 'twice as thick: half as far');
  assert.ok(Math.abs(clear.visibility! - plain.visibility! / 2) < 1, 'a clear day of 20 km: half as far');
  assert.ok(high.visibility! < plain.visibility!, 'thinning over more metres: less clearing from up here');
  assert.ok(plain.clouds && plain.clouds.base === 2700, 'the deck that shades the ground');
  assert.equal(sky({ clouds: { shadows: false } }).setWeather('partly', { seconds: 0 }).light(s).clouds, undefined);
  assert.equal(sky({ clouds: false }).setWeather('partly', { seconds: 0 }).light(s).clouds, undefined);
});

test('roads: a profile from the reserve (data), then the rules; a junction solved from its arms; footprints keep trees off the road', async () => {
  const { reserveAcross } = await import('../src/core/geometry/networks/sections.ts');
  const { profileFor, VIC_STREETS } = await import('../src/modules/world/earth/presets/built/roads/street-profiles.ts');
  const { solveJunctions } = await import('../src/core/geometry/networks/junctions.ts');
  const { walkways } = await import('../src/core/geometry/networks/walkways.ts');
  const { Footprints } = await import('../src/modules/world/earth/shared/plan.ts');
  // a 20 m reserve along a street running east (the property lines 10 m each side)
  const reserve: [number, number][] = [[-100, -10], [100, -10], [100, 10], [-100, 10]];
  const across = reserveAcross([[-50, 0], [0, 0], [50, 0]], [reserve]);
  assert.ok(Math.abs(across.left! - 10) < 0.01 && Math.abs(across.right! - 10) < 0.01, JSON.stringify(across));
  const p = profileFor(5, { reserve: across });
  assert.equal(p.from, 'reserve');
  assert.equal(p.carriageway, VIC_STREETS.carriageway(5));
  const v = p.left, total = p.carriageway / 2 + v.kerb + v.strip + v.footpath + v.gap;
  assert.ok(Math.abs(total - 10) < 1e-9, 'the verge reaches the property line');
  assert.equal(v.footpath, 1.5); assert.ok(v.strip > 3, `a nature strip ${v.strip}`);
  const tagged = profileFor(5, { tags: { sidewalk: 'left', 'sidewalk:width': '2.2' } });
  assert.equal(tagged.from, 'tags'); assert.equal(tagged.left.footpath, 2.2); assert.equal(tagged.right.footpath, 0);
  // a crossroads: four arms meet; each cut back, a platform with four kerb returns, the footpaths round the corners
  const mk = (id: string, pts: [number, number][]) => ({ id, cls: 5, name: id, pts, profile: profileFor(5, { reserve: { left: 10, right: 10 } }), trim: [0, 0] as [number, number], ends: [null, null] as [null, null] });
  const secs = [mk('e', [[0, 0], [60, 0]]), mk('w', [[0, 0], [-60, 0]]), mk('n', [[0, 0], [0, -60]]), mk('s', [[0, 60], [0, 0]])];
  const js = solveJunctions(secs);
  assert.equal(js.length, 1); assert.equal(js[0]!.arms.length, 4); assert.equal(js[0]!.corners.length, 4);
  assert.ok(secs.every((s) => s.trim[0] > 3 || s.trim[1] > 3), 'every arm cut back');
  assert.ok(js[0]!.corners.every((c) => c.bands.some((b) => b.kind === 'footpath')), 'the footpaths go round every corner');
  const walks = walkways(secs, js); assert.equal(walks.filter((w) => w.side === 'corner').length, 4);
  // footprints: a tree on the carriageway is left out; one on the footpath steps onto the verge
  const fp = new Footprints(); const h = secs[0]!.profile.carriageway / 2, k = secs[0]!.profile.left.kerb, st = secs[0]!.profile.left.strip;
  fp.addBand([[-60, 0], [60, 0]], -(h + k), h + k); fp.addBand([[-60, 0], [60, 0]], h + k + st, h + k + st + 1.5);
  assert.equal(fp.place(20, 0, { r: 0.3, nudge: 2 }), null, 'mid road: dropped');
  const moved = fp.place(20, h + k + st + 0.7, { r: 0.3, nudge: 2 })!;
  assert.ok(moved && (moved[1] < h + k + st || moved[1] > h + k + st + 1.5), `off the footpath: ${moved}`);
});

test('the finish: tint (only tinted pieces take the instance colour; into() paints them), lamps (their codes), labels (a block font on a face)', async () => {
  const { shape, SHAPE_FLOATS, MeshBuilder, MESH_FLOATS, LAMP_CODES, shapeCode } = await import('../src/index.ts');
  const { glyphRuns, hasGlyph } = await import('../src/core/geometry/shapes/font.ts');
  const { blockOf } = await import('../src/core/geometry/shapes/levels.ts');
  const car = shape({ id: 'tinted', build: (b) => { b.solid('box', { size: [2, 1, 4], at: [0, 0.8, 0], color: '#ffffff', tint: true }); b.solid('box', { size: [1.8, 0.4, 3.6], at: [0, 0.2, 0], color: '#111111' }); b.solid('box', { size: [0.3, 0.1, 0.05], at: [0.6, 0.8, 2.03], color: '#fff6dd', lamps: 'head' }); } });
  const m = car.make(), w = m.levels[0] as Float32Array, codes = new Set<number>();
  for (let i = 5; i < w.length; i += SHAPE_FLOATS) codes.add(w[i]!);
  // the paint takes the instance's colour (code 0); the tyres and the lamp keep their own (256 +)
  assert.deepEqual([...codes].sort((a, b) => a - b), [0, 256, 256 + LAMP_CODES.head]);
  assert.equal(shapeCode(w, (w.length / SHAPE_FLOATS) - 1), LAMP_CODES.head, 'the code without its mark');
  // a shape without tinted pieces is as before (every piece takes the instance's colour)
  const plain = shape({ build: (b) => b.solid('box', { color: '#808080' }) }).make().levels[0] as Float32Array;
  for (let i = 5; i < plain.length; i += SHAPE_FLOATS) assert.equal(plain[i], 0);
  // the block far away: mostly tinted, it takes the colour
  const blk = blockOf(w, 'box'); let own = 0; for (let i = 5; i < blk.length; i += SHAPE_FLOATS) if (blk[i]! >= 256) own++;
  assert.equal(own, 0);
  // built into a mesh with a tint: the tinted pieces in it, the others their own
  const mb = new MeshBuilder(); car.into(mb, {}, { tint: '#2060c0' }); const d = mb.build(), cols = new Set<number>();
  for (let i = 3; i < d.length; i += MESH_FLOATS) cols.add(d[i]!);
  assert.ok(cols.has(0x2060c0) && cols.has(0x111111) && !cols.has(0xffffff), [...cols].map((c) => c.toString(16)).join(','));
  // a label: the font's runs, quads on the face looking out of it
  assert.ok(hasGlyph('A') && hasGlyph('7') && hasGlyph('a') && !hasGlyph('§'));
  assert.equal(glyphRuns('I').length, 7); assert.deepEqual(glyphRuns('-'), [[1, 3, 4]]);
  const sign = shape({ build: (b) => b.solid('box', { size: [2, 0.6, 0.1], at: [0, 1, 0], color: '#222', label: { text: 'TAXI', color: '#ffcc00' } }) });
  const s = sign.make().levels[0] as Float32Array, boxTris = 12; let yellow = 0, front = 0;
  const runs = [...'TAXI'].reduce((n, c) => n + glyphRuns(c).length, 0);
  for (let i = 0; i < s.length; i += SHAPE_FLOATS * 3) if (s[i + 4] === 0xffcc00) { yellow++; if (s[i + 2]! > 0.05) front++; }
  assert.equal(s.length / SHAPE_FLOATS / 3, boxTris + runs * 2, 'the box and two triangles a run');
  assert.equal(yellow, runs * 2); assert.equal(front, yellow, 'on the front face, standing off it');
  // a label's letters fit the face; one on the left side looks left
  const side = shape({ build: (b) => b.solid('box', { size: [2, 1, 4], at: [0, 0.5, 0], label: { text: 'BUS 7', on: 'left' } }) }).make().levels[0] as Float32Array;
  let minZ = Infinity, maxZ = -Infinity, xs = 0; for (let i = 0; i < side.length; i += SHAPE_FLOATS) if (side[i]! < -1.001) { minZ = Math.min(minZ, side[i + 2]!); maxZ = Math.max(maxZ, side[i + 2]!); xs++; }
  assert.ok(xs > 0 && minZ > -2 && maxZ < 2, `${minZ} ${maxZ}`);
});

test('the counted level: far enough (a copy under `below` px), nothing per copy, a number per cell (a label layer it brings)', async () => {
  const { world, earth, entities, shape } = await import('../src/index.ts');
  const w = await world(null, { body: earth({ imagery: [], terrain: [] }), view: { lon: 145, lat: -37.9, zoom: 17 }, observation: { levels: 'default' } });
  const box = shape({ id: 'box', build: (b) => b.solid('box', { size: [2, 2, 2], at: [0, 1, 0] }) });
  // 300 copies in a 3 km square: 9 cells of 1 km, about 33 a cell
  const data = Array.from({ length: 300 }, (_, i) => ({ id: i, geometry: { type: 'Point', coordinates: [145 + ((i % 20) / 20) * 0.034, -37.9 - (Math.floor(i / 20) / 15) * 0.027] }, props: {} }));
  const l = entities({ id: 'boxes', shape: box, data: data as never, counted: { cell: 1000, level: { to: 'district' } } });
  w.add(l); w.step(16); await new Promise((ok) => setTimeout(ok, 20)); w.step(16);
  assert.ok(w.element('boxes-counted'), 'its label layer came with it');
  const cells = l.cells();
  assert.equal(cells.reduce((n, c) => n + c.count, 0), 300);
  assert.ok(cells.length >= 9 && cells.length <= 16, `${cells.length} cells`);
  // close (the building level): drawn per copy; at the city level (past the margin, after the dwell): counted
  assert.equal(l.countedAt(w.state), false);
  w.go({ lon: 145.02, lat: -37.91, zoom: 12 }); w.step(16); w.step(600); w.step(16);
  assert.equal(w.level, 'city'); assert.equal(l.countedAt(w.state), true);
  // removed with it
  w.remove('boxes'); assert.throws(() => w.element('boxes-counted'));
  // unset: nothing brought
  const plain = entities({ id: 'plain', shape: box, data: data as never }); w.add(plain);
  assert.throws(() => w.element('plain-counted')); assert.equal(plain.countedAt(w.state), false);
  w.dispose();
});

test('buildings({ data }): footprints from any source raised to their height, houses, roofs from tags or yours, lit windows', async () => {
  const { buildings, roofOf, MESH_FLOATS, LAMP_CODES, shape, num } = await import('../src/index.ts');
  // a 20 × 12 m block (4 floors), a small house, a 30 × 30 m hall with a dome, one with its roof from tags
  const m = (lon: number, lat: number, w: number, d: number) => { const kx = 111320 * Math.cos(-37.92 * Math.PI / 180), dx = w / 2 / kx, dz = d / 2 / 110574; return [[[lon - dx, lat - dz], [lon + dx, lat - dz], [lon + dx, lat + dz], [lon - dx, lat + dz], [lon - dx, lat - dz]]]; };
  const f = (id: string, lon: number, w: number, d: number, props: Record<string, unknown>) => ({ id, geometry: { type: 'Polygon', coordinates: m(lon, -37.92, w, d) }, props });
  const data = [f('block', 145.1, 20, 12, { 'building:levels': 4 }), f('house', 145.1004, 11, 9, { class: 'house', height: 6 }), f('hall', 145.1009, 30, 30, { height: 14, 'roof:shape': 'dome' }), f('shed', 145.1014, 16, 8, { height: 7, roof_shape: 'gabled' })];
  assert.equal(roofOf({ 'roof:shape': 'hipped' }), 'hip'); assert.equal(roofOf({ roof_shape: 'skillion' }), 'skillion'); assert.equal(roofOf({}), null);
  // (a chunk's whole mesh is made when it comes near: made here)
  const meshOf = (b: InstanceType<typeof import('../src/index.ts').Buildings>) => { const c = (b as unknown as { pending: Map<string, { mesh: () => Float32Array; info: (id: number) => { props: Record<string, unknown> } | null }> }).pending; return [...c.values()].map((x) => ({ ...x, mesh: x.mesh() })); };
  const top = (mesh: Float32Array, id: number) => { let y = -Infinity; for (let i = 0; i < mesh.length; i += MESH_FLOATS) if (mesh[i + 7]! % 65536 === id) y = Math.max(y, mesh[i + 1]!); return y; };
  // flat roofs by default: each as high as it is
  const flat = buildings({ id: 'b', data: data as never });
  await flat.attach({ graphics: null, loader: null as never, profile: null, camera: null as never, world: { error: (e: unknown) => { throw e; } } as never });
  const [c0] = meshOf(flat);
  assert.ok(Math.abs(top(c0!.mesh, 0) - 12.8) < 0.01, `4 levels × 3.2: ${top(c0!.mesh, 0)}`);
  assert.equal(c0!.info(2)!.props['height (m)'], 14);
  // its windows are lamps (lit at night by the layer's share); a house's too
  let lamps = 0; for (let i = 0; i < c0!.mesh.length; i += MESH_FLOATS) if (Math.floor(c0!.mesh[i + 7]! / 65536) === LAMP_CODES.windows) lamps++;
  assert.ok(lamps > 100, `${lamps} window vertices`);
  // roofs from tags: the hall's dome and the shed's gable rise over a lower eave; the block stays flat
  const tagged = buildings({ id: 'b2', data: data as never, roofs: true });
  await tagged.attach({ graphics: null, loader: null as never, profile: null, camera: null as never, world: { error: (e: unknown) => { throw e; } } as never });
  const [c1] = meshOf(tagged);
  assert.ok(Math.abs(top(c1!.mesh, 2) - 14) < 0.01 && Math.abs(top(c1!.mesh, 3) - 7) < 0.01 && Math.abs(top(c1!.mesh, 0) - 12.8) < 0.01);
  let dome = 0; for (let i = 0; i < c1!.mesh.length; i += MESH_FLOATS) if (c1!.mesh[i + 7]! % 65536 === 2 && c1!.mesh[i + 1]! > 6 && c1!.mesh[i + 1]! < 13.9) dome++;
  assert.ok(dome > 50, `the dome between its eaves and its top: ${dome} vertices`);
  // your function: a shape of your own on every block (a water tank: its params width, depth, height)
  const tank = shape({ id: 'tank', params: { width: num(1, 100, 10), depth: num(1, 100, 10), height: num(0, 20, 3) }, build: (b, p) => b.solid('cylinder', { radius: Math.min(p.width, p.depth) / 4, size: 3, at: [0, 1.5, 0] }) });
  const mine = buildings({ id: 'b3', data: data as never, roofs: (d) => (d.id === 'block' ? tank : 'pyramidal'), windows: false });
  await mine.attach({ graphics: null, loader: null as never, profile: null, camera: null as never, world: { error: (e: unknown) => { throw e; } } as never });
  const [c2] = meshOf(mine);
  let lamps2 = 0; for (let i = 0; i < c2!.mesh.length; i += MESH_FLOATS) if (Math.floor(c2!.mesh[i + 7]! / 65536) === LAMP_CODES.windows) lamps2++;
  assert.equal(lamps2, 0, 'windows: false');
  // (a shape's height: the pitch's rise over the half width, 6 × tan 25°: its foot at the eaves, 12.8 − 2.8)
  assert.ok(Math.abs(top(c2!.mesh, 0) - (12.8 - 6 * Math.tan((25 * Math.PI) / 180) + 3)) < 0.01, `the tank on the roof: ${top(c2!.mesh, 0)}`);
});

test('water({ lakes, rivers, sea, level }): lakes and watercourses in the water material, widths by kind, the sea it gives the world', async () => {
  const { water, widthOf, world, earth, MESH_FLOATS, MATERIAL_CODES } = await import('../src/index.ts');
  assert.equal(widthOf({ waterway: 'river' }), 20); assert.equal(widthOf({ feature_type_code: 'watercourse_channel_drain' }), 3); assert.equal(widthOf({ width: '7.5' }), 7.5);
  const lake = { id: 'lake', geometry: { type: 'Polygon', coordinates: [[[145.1, -37.92], [145.102, -37.92], [145.102, -37.921], [145.1, -37.921], [145.1, -37.92]]] }, props: { name: 'a lake' } };
  const creek = { id: 'creek', geometry: { type: 'LineString', coordinates: [[145.1, -37.922], [145.103, -37.923]] }, props: { name: 'a creek', waterway: 'stream' } };
  const w = await world(null, { body: earth({ imagery: [], terrain: [] }), view: { lon: 145.1, lat: -37.92, zoom: 15 } });
  let tide = 0.4;
  const l = water({ id: 'water', lakes: [lake] as never, rivers: [creek] as never, level: () => tide });
  w.add(l); await new Promise((ok) => setTimeout(ok, 10));
  const pend = (l as unknown as { pending: Map<string, { mesh: Float32Array; free?: boolean; info: (id: number) => { props: Record<string, unknown> } | null }> }).pending;
  const chunk = [...pend.entries()].find(([k]) => k !== 'sea')![1];
  let mat = 0; for (let i = 0; i < chunk.mesh.length; i += MESH_FLOATS) if (Math.floor(chunk.mesh[i + 7]! / 65536) === MATERIAL_CODES.water) mat++;
  assert.equal(mat, chunk.mesh.length / MESH_FLOATS, 'all of it water');
  assert.equal(chunk.info(1)!.props['width (m)'], 4);
  // the sea it gives the world: at its level (a tide), in its colour; none when asked for none
  assert.deepEqual(l.sea(w.state), { level: 0.4, color: [0x2f / 255, 0x6a / 255, 0x96 / 255] });
  tide = 1.2; assert.equal(l.sea(w.state)!.level, 1.2);
  assert.equal(water({ id: 'dry', sea: false }).sea(w.state), null);
  w.dispose();
});

test('roads({ data }): ways with OSM tags split where they meet, sections by their tags and class, junctions solved, a network to route on', async () => {
  const { roads } = await import('../src/index.ts');
  const kx = 111320 * Math.cos((-37.92 * Math.PI) / 180), ll = (x: number, z: number): [number, number] => [145.1 + x / kx, -37.92 - z / 110574];
  // a residential street crossing a primary road at a shared place, a lane off it; a footway (not a road)
  const line = (id: string, pts: [number, number][], props: Record<string, unknown>) => ({ id, geometry: { type: 'LineString', coordinates: pts.map(([x, z]) => ll(x, z)) }, props });
  const data = [
    line('main', [[-200, 0], [0, 0], [200, 0]], { highway: 'primary', name: 'Main Road', lanes: '4' }),
    line('side', [[0, -150], [0, 0], [0, 150]], { highway: 'residential', name: 'Side Street', sidewalk: 'both' }),
    line('lane', [[0, 150], [90, 150]], { highway: 'service' }),
    line('path', [[-50, -50], [50, 50]], { highway: 'footway' }),
  ];
  const r = roads({ id: 'r', data: data as never });
  await r.attach({ graphics: null, loader: null as never, profile: null, camera: null as never, world: { error: (e: unknown) => { throw e; } } as never });
  const secs = r.sections();
  assert.equal(secs.length, 5, 'main and side split where they cross; the lane; no footway');
  const main = secs.filter((s) => s.name === 'Main Road'), side = secs.filter((s) => s.name === 'Side Street');
  assert.ok(main.every((s) => s.cls === 2 && s.profile.lanes === 4 && s.profile.from === 'tags') && side.every((s) => s.cls === 5));
  assert.ok(main[0]!.profile.carriageway > side[0]!.profile.carriageway);
  const js = r.junctions();
  assert.equal(js.length, 2, 'the crossroads and the lane off the side street');
  const x = js.find((j) => j.arms.length === 4)!; assert.ok(x && x.crossings.length >= 2 && x.platform.length > 4);
  assert.ok(main.every((s) => s.trim.some((t) => t > 5)), 'cut back for the junction');
  // drawn: chunks with meshes, each piece picked as a road
  const pend = (r as unknown as { pending: Map<string, { mesh: () => Float32Array; far: Float32Array; info: (id: number) => { kind: string; props: Record<string, unknown> } | null }> }).pending;
  assert.ok(pend.size >= 1 && [...pend.values()].every((c) => c.mesh().length > c.far.length && c.far.length > 0), 'the whole mesh made when near, more than the far one');
  const c0 = [...pend.values()][0]!; assert.equal(c0.info(0)!.kind, 'road');
  // the network: from one end of the main road to the lane's end, along the side street
  const net = r.network(), route = net.route(ll(-200, 0), ll(90, 150));
  assert.ok(route && route.cost > 400 && route.cost < 500, `${route?.cost}`);
});

test('materials: flat, facade, imagery, interior and physically based (roughness, metal) as codes every vertex carries', async () => {
  const { material, codeOf, MATERIAL_CODES, shape, SHAPE_FLOATS, shapeCode, partOf, AslnutError } = await import('../src/index.ts');
  assert.equal(material('flat').code, MATERIAL_CODES.flat); assert.equal(material('facade').code, 14); assert.equal(material('imagery').code, 15); assert.equal(material('interior').code, 16);
  // physically based: 192 + roughness (0…7) × 8 + metal (0…7)
  assert.equal(material('pbr', { roughness: 0, metal: 1 }).code, 199); assert.equal(material('pbr', { roughness: 1, metal: 0 }).code, 248);
  assert.equal(codeOf('pbr'), 192 + 4 * 8);
  for (const k of ['flat', 'facade', 'imagery', 'interior'] as const) assert.equal(partOf(material(k).code), 'solid', 'drawn by the solids\' own program');
  assert.equal(partOf(material('pbr', { roughness: 0.3, metal: 0.7 }).code), 'solid');
  const s = shape({ build: (b) => { b.solid('sphere', { radius: 1, material: material('pbr', { roughness: 0.2, metal: 1 }) }); b.solid('box', { size: [2, 3, 2], at: [3, 1.5, 0], material: 'facade' }); } }).make().levels[0] as Float32Array;
  const codes = new Set<number>(); for (let i = 0; i < s.length / SHAPE_FLOATS; i++) codes.add(shapeCode(s, i));
  assert.deepEqual([...codes].sort((a, b) => a - b), [14, 192 + 1 * 8 + 7]);
  assert.throws(() => material('velvet' as never), (e: unknown) => e instanceof AslnutError);
});

test('sky: dim darkens the sky and its haze towards a colour, eased; unset, nothing of it is worked out', async () => {
  const { sky, makeState } = await import('../src/index.ts');
  const s = makeState({ view: { lon: 145.12, lat: -37.92, zoom: 15 }, time: { now: new Date(Date.UTC(2026, 0, 15, 2, 0, 0)) } });
  const tick = (k: unknown, n: number) => { for (let i = 0; i <= n; i++) (k as { tickWeather(c: unknown): void }).tickWeather({ s, now: i * 250 }); };
  const plain = sky(), on = { v: 1 };
  const dimmed = sky({ dim: { amount: () => on.v, color: '#000000', seconds: 0.5 } });
  tick(plain, 4); tick(dimmed, 1);
  assert.equal(plain.animating(s), false, 'no dim: nothing eases');
  assert.equal(dimmed.animating(s), true, 'easing towards the dim: the frames keep coming');
  assert.equal(dimmed.wantsFrames(s), Infinity, 'easing: every display frame');
  tick(dimmed, 40);
  assert.equal(dimmed.animating(s), false, 'arrived: still');
  assert.equal(dimmed.wantsFrames(s), 0, 'arrived: no frames asked');
  assert.equal(plain.wantsFrames(s), 0, 'a clear sky asks for none (its clouds hold still unless cloudsMove)');
  const a = plain.light(s).haze!, b = dimmed.light(s).haze!;
  assert.ok(b[0] < a[0] * 0.2 && b[1] < a[1] * 0.2 && b[2] < a[2] * 0.2, `the haze darkened towards black: ${a} → ${b}`);
  on.v = 0; tick(dimmed, 40);
  assert.deepEqual(dimmed.light(s).haze, a, 'off again: the haze as without it');
});
