import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, arc, trail, area, line, data, greatCircle, regions } from '../src/index.ts';
import { metresBetween } from '../src/core/space/geo.ts';
import { PIECE, SEG, Segments } from '../src/core/geometry/build/segments.ts';
import { Origin, polygonMesh, unwrapNear } from '../src/core/geometry/build/mesh.ts';
import { Camera } from '../src/core/observation/observers/orbit/camera.ts';
import { Loader, MemoryStore } from '../src/core/data/loading/index.ts';

test('arc: the great circle, its ends exact, longitudes continuous across ±180°', () => {
  const g = greatCircle([106.8, -6.2], [-122.4, 37.8], 33);
  assert.equal(g.length, 33);
  assert.deepEqual(g[0], [106.8, -6.2]);
  assert.ok(Math.abs(g[32]![0] - (-122.4 + 360)) < 1e-6 && Math.abs(g[32]![1] - 37.8) < 1e-6, `ends at ${g[32]}`);
  for (let i = 1; i < g.length; i++) assert.ok(Math.abs(g[i]![0] - g[i - 1]![0]) < 30, 'no jump between neighbours');
  // the great circle is the short way: its length is the haversine distance
  let len = 0; for (let i = 1; i < g.length; i++) len += metresBetween(g[i - 1]!, g[i]!);
  assert.ok(Math.abs(len / metresBetween([106.8, -6.2], [-122.4, 37.8]) - 1) < 0.002, `${len}`);
  assert.throws(() => arc({ id: 'x', data: [], from: undefined as never, to: () => [0, 0] }), /from: d => \[lon, lat\]/);
});

test('segments: a line can measure "along" by your own number per input point (a trail\'s time)', () => {
  const o = new Origin(107.6, -6.9), s = new Segments();
  const times = [0, 10, 40];
  s.build(o, [{ f: 0, line: [[107.6, -6.9], [107.61, -6.9], [107.62, -6.9]], closed: false, along: (at) => { const i = Math.floor(at), f = at - i; const a = times[Math.min(2, i)]!, b = times[Math.min(2, i + 1)]!; return (a + (b - a) * f) / 40; } }], 300);
  // the 1.1 km segments are split every 300 m: the points between take the time between
  assert.ok(s.frac.length > 3);
  assert.equal(s.frac[0], 0); assert.equal(s.frac[s.frac.length - 1], 1);
  const mid = s.frac.findIndex((x) => x > 0.25);
  assert.ok(s.frac[mid - 1]! <= 0.25 + 1e-6, 'the first input segment takes 0 .. 10 of 40');
  for (let i = 1; i < s.frac.length; i++) assert.ok(s.frac[i]! >= s.frac[i - 1]!, 'times only go forward');
});

test('segments: a draped line\'s pieces are written directly, the same numbers as the vertex records\' first corner', () => {
  const o = new Origin(107.6, -6.9);
  const lines = [
    { f: 0, line: [[107.6, -6.9], [107.61, -6.9], [107.62, -6.905]] as [number, number][], closed: false },
    { f: 1, line: [[107.6, -6.91], [107.605, -6.91], [107.605, -6.915], [107.6, -6.91]] as [number, number][], closed: true, cuts: [0, 1, 0] },
    { f: 2, line: [[107.6, -6.92]] as [number, number][], closed: false },
  ];
  const r = new Segments().build(o, lines, 400), p = new Segments().build(o, lines, 400, { form: 'pieces', row: 2048 * 4 });
  assert.equal(p.count, r.count); assert.ok(r.count > 4, `${r.count} segments`);
  assert.equal(p.pieces.length % (2048 * 4), 0, 'padded to whole rows');
  assert.equal(p.data.length + p.xy.length + p.index.length, 0, 'no vertex records kept for a draped line');
  for (let i = 0; i < r.count; i++) for (let k = 0; k < 18; k++) assert.equal(p.pieces[i * PIECE + k], r.data[i * SEG * 4 + k], `segment ${i} float ${k}`);
  const a = new Float64Array(4), b = new Float64Array(4);
  for (let i = 0; i < r.count; i++) { r.box(i, a); p.box(i, b); assert.deepEqual([...a], [...b]); }
});

test('ground marks into the tiles only where they pay: relief under it and holding still, unless chosen', () => {
  const route = (l: unknown, w: object, sampled: [number, number]) => { const x = l as { attached: unknown; sampled: [number, number]; onTiles: boolean }; x.attached = { world: { exaggeration: 1, ...w } }; x.sampled = sampled; return x.onTiles; };
  const auto = { groundMarks: 'tiles', groundMarksChosen: false }, flat: [number, number] = [12, 12.4], hills: [number, number] = [12, 80];
  const still = line({ id: 'a', data: [] });
  assert.equal(route(still, auto, flat), false, 'level ground: the flat route');
  assert.equal(route(still, auto, hills), true, 'relief, still: into the tiles');
  assert.equal(route(still, { groundMarks: 'prisms', groundMarksChosen: false }, hills), false, 'a world drawing prisms');
  assert.equal(route(line({ id: 'f', data: [], dashes: [6, 4], flow: 20 }), auto, hills), false, 'flowing dashes: never into the tiles');
  assert.equal(route(trail({ id: 't', data: [], clock: () => 0 }), auto, hills), false, 'a trail\'s clock: never into the tiles');
  assert.equal(route(line({ id: 'm', data: [], blend: 'multiply' }), auto, hills), false, 'a blend the tiles cannot hold');
  assert.equal(route(still, { groundMarks: 'tiles', groundMarksChosen: true }, flat), true, 'the world\'s choice holds');
  assert.equal(route(trail({ id: 't2', data: [], clock: () => 0 }), { groundMarks: 'tiles', groundMarksChosen: true }, flat), true);
  assert.equal(route(line({ id: 'o', data: [], groundMarks: 'prisms' }), { groundMarks: 'tiles', groundMarksChosen: true }, hills), false, 'the layer\'s own choice wins');
  assert.equal(route(line({ id: 'o2', data: [], groundMarks: 'tiles' }), auto, flat), true);
  assert.equal(route(line({ id: 'd', data: [], drape: false }), auto, hills), false, 'not draped: never');
});

test('polygon mesh: a footprint shorter than the step is earcut\'s triangles as they are; a long one split without cracks', () => {
  const o = new Origin(145.13, -37.91);
  const ring: [number, number][] = [[145.13, -37.91], [145.1302, -37.91], [145.1302, -37.9102], [145.1301, -37.9101], [145.13, -37.9102], [145.13, -37.91]];
  const m = polygonMesh(o, [ring], 50);
  assert.equal(m.xy.length / 2, 5, 'its corners, no more'); assert.equal(m.tris.length / 3, 3);
  const big = polygonMesh(o, [ring], 5);
  assert.ok(big.tris.length / 3 > 3 && big.xy.length / 2 > 5, 'split when an edge is longer than the step');
  // every corner a triangle uses exists, and edges shared by two triangles share their middles (each middle once)
  const seen = new Set<string>(); for (let i = 0; i < big.xy.length; i += 2) { const k = `${big.xy[i]},${big.xy[i + 1]}`; assert.ok(!seen.has(k), 'one corner per place'); seen.add(k); }
  for (const t of big.tris) assert.ok(t < big.xy.length / 2);
});

test('a trail needs times; it measures its span; an arc stands on its own heights', () => {
  const t = trail({ id: 'tr', data: [{ id: 'a', geometry: { type: 'LineString', coordinates: [[0, 0], [0.01, 0]] }, times: [1000, 2000] }], times: (d) => (d as { times: number[] }).times, window: 60 });
  assert.equal(t.kind, 'line');
  const a = arc({ id: 'ar', data: [{ o: [0, 0], d: [10, 0] }], from: (d) => d.o as [number, number], to: (d) => d.d as [number, number] });
  assert.equal((a.props as { on?: string }).on, 'absolute');
});

test('rings touching ±180° stay continuous (no band across the map)', () => {
  assert.ok(Math.abs(unwrapNear(-Math.PI + 0.01, Math.PI - 0.01) - (Math.PI + 0.01)) < 1e-9);
  const o = new Origin(0, 0);
  const ring: [number, number][] = [[178, -16], [180, -16], [180, -18], [178, -18], [178, -16]];
  const m = polygonMesh(o, [ring], 50000);
  let lo = Infinity, hi = -Infinity; for (let i = 0; i < m.xy.length; i += 2) { lo = Math.min(lo, m.xy[i]!); hi = Math.max(hi, m.xy[i]!); }
  assert.ok(hi - lo < 0.05, `the ring spans ${(hi - lo).toFixed(3)} rad, not the whole world`);
});

test('portrait screens: a zoom shows as much across as on a landscape screen; fit uses the real shape', async () => {
  const c = new Camera();
  c.width = 1200; c.height = 800; assert.equal(c.frameK, 1);
  c.width = 390; c.height = 844; assert.ok(c.frameK > 2 && c.frameK <= 2.5, `${c.frameK}`);
  c.jump({ lon: 107, lat: -7, zoom: 6 });
  assert.ok(Math.abs(c.zoom - 6) < 1e-9, 'the zoom read back is the zoom asked for');
  assert.ok(Math.abs(c.view.zoom - 6) < 1e-9);
  c.frame = 'height'; assert.equal(c.frameK, 1);
  const w = await world(null, { view: { lon: 0, lat: 0, zoom: 3 } });
  w.camera.width = 390; w.camera.height = 844;
  const v = w.viewToFit([105, -9, 115, -5]);
  w.go(v); w.step(16);
  // the box's width fits the narrow screen
  const left = w.project([105, -7]), right = w.project([115, -7]);
  assert.ok(left && right && left[0] >= 0 && right[0] <= 390 && right[0] - left[0] > 300, `${left} ${right}`);
  w.dispose();
});

test('follow: the camera keeps a moving place in the middle; setProjection eases the globe flat', async () => {
  const w = await world(null, { view: { lon: 100, lat: 0, zoom: 2 } });
  let lon = 120;
  w.follow(() => [lon, 10], { smooth: 30 });
  for (let i = 0; i < 30; i++) w.step(33);
  assert.ok(Math.abs(w.camera.lon - 120) < 0.01 && Math.abs(w.camera.lat - 10) < 0.01 && w.isFollowing);
  lon = 121; for (let i = 0; i < 30; i++) w.step(33);
  assert.ok(Math.abs(w.camera.lon - 121) < 0.01);
  w.follow(null); assert.equal(w.isFollowing, false);
  assert.ok(w.camera.morph < 0.5, 'a globe at zoom 2');
  w.setProjection('flat', 0.5);
  w.step(33); assert.ok(w.camera.morph > 0 && w.camera.morph < 1, 'eases');
  for (let i = 0; i < 60; i++) w.step(33);
  assert.equal(w.camera.morph, 1);
  w.setProjection('auto', 0); w.step(33); assert.ok(w.camera.morph < 0.5);
  w.dispose();
});

test('feature layers credit their data (a joined source: its shapes and its rows)', () => {
  const shapes = data.geojson({ type: 'FeatureCollection', features: [] }, { attribution: 'boundaries © A' });
  const rows = data.rows([], { attribution: 'numbers © B' });
  const l = area({ id: 'x', data: shapes.join(rows, { on: 'id' }) });
  assert.deepEqual(l.attribution().sort(), ['boundaries © A', 'numbers © B']);
});

test('a three-level region tree rolls the bottom rows up two levels', async () => {
  const sq = (x: number, y: number, s: number) => ({ type: 'Polygon' as const, coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] });
  const prov = data.geojson({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'P', properties: { name: 'P' }, geometry: sq(0, 0, 2) }] });
  const reg = data.geojson({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'R1', properties: { name: 'R1', p: 'P' }, geometry: sq(0, 0, 1) }, { type: 'Feature', id: 'R2', properties: { name: 'R2', p: 'P' }, geometry: sq(1, 0, 1) }] });
  const dis = data.geojson({ type: 'FeatureCollection', features: [{ type: 'Feature', id: 'D1', properties: { r: 'R1' }, geometry: sq(0, 0, 0.5) }, { type: 'Feature', id: 'D2', properties: { r: 'R1' }, geometry: sq(0.5, 0, 0.5) }, { type: 'Feature', id: 'D3', properties: { r: 'R2' }, geometry: sq(1, 0, 0.5) }] });
  const tree = regions.tree({ levels: ['province', 'regency', 'district'], sources: { province: prov, regency: reg, district: dis }, parentOf: { regency: (f) => f.props.p as string, district: (f) => f.props.r as string } });
  await tree.load(new Loader({ store: new MemoryStore() }));
  const rows = data.rows([{ id: 'D1', n: 2 }, { id: 'D2', n: 3 }, { id: 'D3', n: 7 }]);
  const toProv = tree.rollup(rows, { on: 'id', to: 'province', sum: ['n'] }), toReg = tree.rollup(rows, { on: 'id', to: 'regency', sum: ['n'] });
  assert.equal(toProv.get('P')!.props.n, 12);
  assert.equal(toReg.get('R1')!.props.n, 5);
  assert.deepEqual(tree.path(tree.get('district', 'D3')!).map((r) => r.id), ['P', 'R2', 'D3']);
  rows.patch('D3', { n: 1 });
  assert.equal(toProv.get('P')!.props.n, 6, 'live');
});

test('flowing dashes: flow moves the dashes along (px a second, into the shader), frames only while shown with data', () => {
  const rows = [{ o: [0, 0], d: [0.01, 0] }];
  const of = (p: object) => arc({ id: 'fl', data: rows, from: (d) => d.o as [number, number], to: (d) => d.d as [number, number], ...p });
  const L = (a: ReturnType<typeof of>) => { (a as unknown as { uniforms(c: unknown): void }).uniforms({}); return (a as unknown as { L: Float32Array }).L; };
  const still = of({ dashes: [6, 4] }), flowing = of({ dashes: [6, 4], flow: 30 }), noDashes = of({ flow: 30 });
  assert.equal(L(still)[33], 0, 'no flow: the dashes hold still');
  assert.equal(L(flowing)[33], 30, 'the speed reaches the shader (b.y)');
  assert.deepEqual([...L(flowing).slice(28, 32)], [1, 1, 6, 4], 'the dashes as before');
  assert.equal(L(noDashes)[33], 0, 'flow without dashes: nothing moves');
  const s = {} as never;
  // pay only for what is set: hidden or empty, a flowing layer asks for no frames
  assert.equal(flowing.animating(s), false, 'not shown yet');
  (flowing as unknown as { shown: number }).shown = 1;
  assert.equal(flowing.animating(s), false, 'shown, but nothing to draw');
  (flowing as unknown as { entries: unknown[] }).entries = [{}];
  assert.equal(flowing.animating(s), true, 'shown with arcs: the frames keep coming');
  // (draw on demand: at the dashes' own pace, a pixel a frame at most: 30 px a second, 30 frames a second)
  assert.equal(flowing.wantsFrames(s), 30, 'the frames it asks for: by its pace');
  (still as unknown as { shown: number }).shown = 1; (still as unknown as { entries: unknown[] }).entries = [{}];
  assert.equal(still.animating(s), false, 'still dashes: no frames');
  assert.equal(still.wantsFrames(s), 0, 'still dashes: none asked');
});

test('an arc drawn over the world comes after the buildings (the arcs\' default: above); one on the ground keeps the line place', () => {
  const rows = [{ o: [0, 0], d: [0.003, 0] }];
  const over = arc({ id: 'ov', data: rows, from: (d) => d.o as [number, number], to: (d) => d.d as [number, number], fromHeight: 6, over: true });
  const plain = arc({ id: 'pl', data: rows, from: (d) => d.o as [number, number], to: (d) => d.d as [number, number] });
  const ground = arc({ id: 'gr', data: rows, from: (d) => d.o as [number, number], to: (d) => d.d as [number, number], drape: 'ground' });
  const old = arc({ id: 'old', data: rows, from: (d) => d.o as [number, number], to: (d) => d.d as [number, number], over: false });
  assert.equal(over.order, 4.5);
  assert.equal(plain.order, 4.5, 'unset: DRAPE_DEFAULTS.arc, above');
  assert.equal(ground.order, undefined);
  assert.equal(old.order, undefined, 'over: false is drape: ground');
  assert.equal(arc({ id: 'set', data: rows, from: (d) => d.o as [number, number], to: (d) => d.d as [number, number], over: true, order: 2 }).order, 2);
});
