import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gzipSync } from 'node:zlib';
import { data, normalize, parseCSV, decodeMVT, encodeMVT, PMTilesWriter, PMTilesReader, earcut, contains, centreOf, regions, AslnutError, makeState, type Feature } from '../src/index.ts';
import { Loader, MemoryStore } from '../src/core/data/loading/index.ts';
import { polygonMesh, lineStrip, Origin, relMetres } from '../src/core/geometry/build/mesh.ts';
import { gunzip } from '../src/core/data/sources/index.ts';

const ctx = () => ({ loader: new Loader({ store: new MemoryStore() }), error: (e: unknown) => { throw e; } });
const sq = (x: number, y: number, s: number, props: Record<string, unknown> = {}, id?: string | number) => ({ type: 'Feature', ...(id !== undefined ? { id } : {}), properties: props, geometry: { type: 'Polygon', coordinates: [[[x, y], [x + s, y], [x + s, y + s], [x, y + s], [x, y]]] } });

test('features: ids from the data, a prop or a function; repeated ids kept apart; bad GeoJSON named plainly', () => {
  const fc = { type: 'FeatureCollection', features: [sq(0, 0, 1, { code: 'A' }, 7), sq(1, 0, 1, { code: 'B' }), sq(2, 0, 1, { code: 'A' })] };
  assert.deepEqual(normalize(fc).map((f) => f.id), [7, 1, 2], 'GeoJSON id, else the index');
  assert.deepEqual(normalize(fc, { id: 'code' }).map((f) => f.id), ['A', 'B', 'A#2'], 'a prop; a repeat kept apart');
  assert.deepEqual(normalize(fc, { id: (f, i) => `${f.properties!.code}-${i}` }).map((f) => f.id), ['A-0', 'B-1', 'A-2']);
  assert.equal(normalize({ type: 'Point', coordinates: [1, 2] })[0]!.geometry!.type, 'Point', 'a bare geometry');
  assert.throws(() => normalize(42), (e: unknown) => e instanceof AslnutError && e.code === 'E-DATA-002');
  assert.throws(() => normalize({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[['a', 1]]] } }), /coordinates are \[lon, lat\]/);
  assert.equal(contains(normalize(sq(0, 0, 2))[0]!.geometry, [1, 1]), true);
  assert.deepEqual(centreOf(normalize(sq(0, 0, 2))[0]!.geometry), [1, 1]);
});

test('csv: quotes, delimiters, numbers; rows with coordinates become points', async () => {
  const rows = parseCSV('name,lon,lat,note\n"Lembang, North",107.62,-6.81,"say ""hi"""\nCimahi,107.54,-6.87,\n');
  assert.deepEqual(rows[0], { name: 'Lembang, North', lon: 107.62, lat: -6.81, note: 'say "hi"' });
  assert.equal(rows.length, 2);
  assert.deepEqual(parseCSV('a\tb\n1\t2')[0], { a: 1, b: 2 }, 'tabs found by themselves');
  assert.throws(() => parseCSV('a\n"open'), /not closed/);
  const c = data.csv('id,lon,lat\nx,1,2\ny,3,4\n', { id: 'id' });
  assert.deepEqual(c.features().map((f) => [f.id, f.geometry?.type]), [['x', 'Point'], ['y', 'Point']]);
});

test('rows: set / upsert / patch / remove say whether shapes or only numbers changed', () => {
  const r = data.rows([{ id: 'a', v: 1 }, { id: 'b', v: 2 }]);
  const v0 = r.version, s0 = r.shapeVersion;
  r.patch('a', { v: 5 });
  assert.equal(r.get('a')!.props.v, 5); assert.ok(r.version > v0); assert.equal(r.shapeVersion, s0, 'numbers only: no shape change');
  r.upsert([{ id: 'c', v: 3 }]); assert.equal(r.size, 3); assert.ok(r.shapeVersion > s0, 'a new row is a shape change');
  r.remove('b'); assert.deepEqual(r.features().map((f) => f.id), ['a', 'c']);
  const p = data.rows([{ id: 1, lon: 1, lat: 1 }]); const s1 = p.shapeVersion;
  p.upsert([{ id: 1, lon: 2, lat: 1 }]); assert.ok(p.shapeVersion > s1, 'a moved point is a shape change');
  assert.throws(() => r.patch('zz', {}), /no row 'zz'/);
});

test('join: shapes once, numbers live; a key on either side; unmatched shapes keep their own props', () => {
  const shapes = data.geojson({ type: 'FeatureCollection', features: [sq(0, 0, 1, { code: 'A' }, 'a'), sq(1, 0, 1, { code: 'B' }, 'b'), sq(2, 0, 1, { code: 'C' }, 'c')] });
  const rows = data.rows([{ suburb: 'A', rate: 10 }, { suburb: 'B', rate: 20 }]);
  const j = shapes.join(rows, { on: 'code', rowsOn: 'suburb' });
  assert.deepEqual(j.features().map((f) => [f.id, f.props.rate]), [['a', 10], ['b', 20], ['c', undefined]]);
  assert.equal(j.matched, 2);
  const sv = j.shapeVersion;
  rows.set([{ suburb: 'C', rate: 99 }]);
  assert.deepEqual(j.features().map((f) => f.props.rate), [undefined, undefined, 99]);
  assert.equal(j.shapeVersion, sv, 'new numbers: the shapes did not change');
  assert.throws(() => shapes.join(rows, {} as never), /join needs \{ on \}/);
});

test('query: runs when its deps change (debounced), only while `when` holds, the latest answer wins', async () => {
  let calls = 0;
  const q = data.query((s) => { calls++; return new Promise((ok) => setTimeout(() => ok([{ id: 'x', year: s.time.year }]), 5)); }, { deps: (s) => s.time.year, debounce: 0, when: (s) => s.view.zoom > 5 });
  const c = ctx(); await q.start(c);
  q.frame(makeState({ view: { zoom: 3 }, time: { year: 2020 } }), c); assert.equal(calls, 0, 'when false: nothing runs');
  q.frame(makeState({ view: { zoom: 8 }, time: { year: 2020 } }), c);
  q.frame(makeState({ view: { zoom: 9 }, time: { year: 2020 } }), c); assert.equal(calls, 1, 'same deps: one run');
  await new Promise((ok) => setTimeout(ok, 30));
  assert.equal(q.get('x')!.props.year, 2020);
  q.frame(makeState({ view: { zoom: 9 }, time: { year: 2021 } }), c);
  await new Promise((ok) => setTimeout(ok, 30));
  assert.equal(calls, 2); assert.equal(q.get('x')!.props.year, 2021); assert.equal(q.answeredFor, 2021);
});

test('stream: your connect(emit) upserts, patches and removes by id; close stops it', async () => {
  let emit!: (m: unknown) => void, stopped = false;
  const st = data.stream({ connect: (e) => { emit = e as (m: unknown) => void; return () => { stopped = true; }; } });
  await st.start(ctx());
  emit([{ id: 'car1', lon: 1, lat: 1, soc: 80 }, { id: 'car2', lon: 2, lat: 2, soc: 50 }]);
  emit({ patch: { id: 'car1', change: { soc: 79 } }, remove: ['car2'] });
  assert.deepEqual(st.features().map((f) => [f.id, f.props.soc]), [['car1', 79]]);
  assert.equal(st.messages, 2);
  st.close(); assert.equal(stopped, true);
});

test('MVT and PMTiles: written and read back; polygons cut at the tile edge mark their cut edges', async () => {
  const f: Feature[] = [
    { id: 1, props: { name: 'across', n: 5 }, geometry: { type: 'Polygon', coordinates: [[[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1], [-0.1, -0.1]]] } },
    { id: 2, props: { name: 'road', ok: true }, geometry: { type: 'LineString', coordinates: [[-0.2, 0.05], [0.2, 0.05]] } },
    { id: 3, props: { name: 'pt', h: -2.5 }, geometry: { type: 'Point', coordinates: [0.05, 0.05] } },
  ];
  const z = 8, tiles = [[128, 127], [127, 127], [128, 128], [127, 128]] as const;
  const w = new PMTilesWriter({ tileType: 1, tileCompression: 2, metadata: { name: 'test' }, bounds: [-1, -1, 1, 1] });
  for (const [x, y] of tiles) w.add(z, x, y, gzipSync(encodeMVT({ shapes: f }, { z, x, y })));
  const bytes = await w.finish((b) => gzipSync(b));
  const r = await new PMTilesReader(async (o, l) => bytes.subarray(o, o + l), (b, c) => gunzip(b, c)).open();
  assert.equal(r.header.maxZoom, 8); assert.deepEqual(r.metadata, { name: 'test' });
  const raw = await gunzip((await r.tile(z, 128, 127))!, r.header.tileCompression);
  const got = decodeMVT(raw, { z, x: 128, y: 127 }).shapes!;
  const poly = got.find((g) => g.id === 1)!;
  assert.equal(poly.props.name, 'across'); assert.equal(poly.props.n, 5);
  assert.equal(poly.geometry!.type, 'Polygon');
  const ring = (poly.geometry as { coordinates: number[][][] }).coordinates[0]!;
  assert.ok(ring.every((p) => p[0]! >= -1e-6 && p[1]! >= -1e-6), 'cut to its own tile (the north-east quarter)');
  assert.ok(poly.cuts![0]![0]!.some((c) => c === 1), 'the cut edges are marked');
  assert.ok(poly.cuts![0]![0]!.some((c) => c === 0), 'the real edges are not');
  assert.equal(got.find((g) => g.id === 2)!.props.ok, true);
  assert.equal(got.find((g) => g.id === 3)!.props.h, -2.5);
  assert.equal(await r.tile(z, 0, 0), null, 'no tile there');
});

test('earcut and the mesh: holes; long edges split the same way on both sides (no cracks)', () => {
  const t = earcut([0, 0, 10, 0, 10, 10, 0, 10, 3, 3, 7, 3, 7, 7, 3, 7], [4]);
  assert.equal(t.length / 3, 8, 'a square with a square hole: 8 triangles');
  const o = new Origin(107.6, -6.9);
  const a = polygonMesh(o, [[[107.6, -6.9], [107.7, -6.9], [107.7, -6.8], [107.6, -6.9]]], 2000);
  const b = polygonMesh(o, [[[107.6, -6.9], [107.7, -6.8], [107.6, -6.8], [107.6, -6.9]]], 2000);
  // the shared diagonal: every point of it in one mesh is in the other
  const A = o.rel(107.6, -6.9), B = o.rel(107.7, -6.8);
  const onDiag = (m: typeof a) => { const s = new Set<string>(); for (let i = 0; i < m.xy.length; i += 2) { const x = m.xy[i]!, y = m.xy[i + 1]!, cross = (B[0] - A[0]) * (y - A[1]) - (B[1] - A[1]) * (x - A[0]); if (Math.abs(cross) < 1e-14) s.add(`${x},${y}`); } return s; };
  assert.deepEqual([...onDiag(a)].sort(), [...onDiag(b)].sort());
  assert.ok(onDiag(a).size > 4, 'the diagonal was split');
  for (let i = 0; i < a.tris.length; i += 3) {
    const p = (k: number): [number, number] => [a.xy[2 * a.tris[i + k]!]!, a.xy[2 * a.tris[i + k]! + 1]!];
    for (const [u, v] of [[0, 1], [1, 2], [2, 0]] as const) assert.ok(relMetres(o, p(u)[0], p(u)[1], p(v)[0], p(v)[1]) <= 2000 + 1e-6);
  }
  const s = lineStrip(o, [[107.6, -6.9], [107.7, -6.9]], 1000);
  assert.ok(Math.abs(s.length - 11053) < 60, `${s.length} m`); assert.equal(s.dist.at(-1), s.length);
});

test('regions: which region a place is in, parents and children, numbers rolled up live', async () => {
  const lgas = data.geojson({ type: 'FeatureCollection', features: [sq(0, 0, 2, { name: 'West' }, 'W'), sq(2, 0, 2, { name: 'East' }, 'E')] });
  const subs = data.geojson({ type: 'FeatureCollection', features: [sq(0, 0, 1, { name: 'w1' }, 'w1'), sq(1, 1, 1, { name: 'w2' }, 'w2'), sq(2, 0, 1, { name: 'e1' }, 'e1')] });
  const tree = await regions.tree({ levels: ['lga', 'suburb'], sources: { lga: lgas, suburb: subs } }).load(new Loader({ store: new MemoryStore() }));
  assert.equal(tree.at(0.5, 0.5)!.id, 'w1');
  assert.equal(tree.at(3.5, 0.5, 'lga')!.name, 'East');
  assert.equal(tree.parent(tree.get('suburb', 'w2')!)!.id, 'W', 'by containment');
  assert.deepEqual(tree.children(tree.get('lga', 'W')!).map((r) => r.id), ['w1', 'w2']);
  const crime = data.rows([{ id: 1, suburb: 'w1', count: 3 }, { id: 2, suburb: 'w2', count: 4 }, { id: 3, suburb: 'e1', count: 10 }]);
  const up = tree.rollup(crime, { on: 'suburb', to: 'lga', sum: ['count'], count: true });
  assert.deepEqual(up.features().map((f) => [f.id, f.props.count]), [['W', 2], ['E', 1]], 'count overrides: rows per region');
  const up2 = tree.rollup(crime, { on: 'suburb', to: 'lga', sum: ['count'] });
  assert.deepEqual(up2.features().map((f) => [f.id, f.props.count]), [['W', 7], ['E', 10]]);
  crime.patch(3, { count: 1 });
  assert.equal(up2.get('E')!.props.count, 1, 'live');
});

test('tiles at a URL: MVT and GeoJSON for the view, pieces of one id joined; TMS rows; missing tiles are none', async () => {
  const f: Feature[] = [
    { id: 1, props: { name: 'across' }, geometry: { type: 'Polygon', coordinates: [[[-0.1, -0.1], [0.1, -0.1], [0.1, 0.1], [-0.1, 0.1], [-0.1, -0.1]]] } },
    { id: 2, props: { name: 'pt' }, geometry: { type: 'Point', coordinates: [0.05, 0.05] } },
  ];
  const z = 8, calls: string[] = [];
  const fetch = (async (u: string) => {
    calls.push(String(u)); const m = /\/(\d+)\/(\d+)\/(\d+)\.(pbf|json)$/.exec(String(u)); if (!m) return new Response(null, { status: 404 });
    const [tz, x, y] = [Number(m[1]), Number(m[2]), Number(m[3])];
    if (m[4] === 'pbf') { const yy = 2 ** tz - 1 - y; return new Response(gzipSync(encodeMVT({ shapes: f }, { z: tz, x, y: yy })), { status: 200 }); }
    const b = x === 128 && y === 127 ? { type: 'FeatureCollection', features: [{ type: 'Feature', id: 7, properties: { name: 'tile' }, geometry: { type: 'Point', coordinates: [0.05, 0.05] } }] } : null;
    return b ? new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response(null, { status: 404 });
  }) as unknown as typeof globalThis.fetch;
  const c = { loader: new Loader({ store: new MemoryStore(), fetch, retries: 0 }), error: (e: unknown) => { throw e; } };
  const s = makeState({ view: { lon: 0, lat: 0, zoom: z, width: 800, height: 800 } });
  const mvt = data.mvt('https://t.test/{z}/{x}/{-y}.pbf', { maxZoom: 8 });
  await mvt.start(c); mvt.frame(s, c);
  for (let i = 0; i < 50 && !mvt.size; i++) { await new Promise((ok) => setTimeout(ok, 10)); mvt.frame(s, c); }
  assert.ok(calls.some((u) => u.includes('/8/128/')), 'the view\'s tiles at its level');
  const poly = mvt.get(1)!;
  assert.equal(poly.geometry!.type, 'MultiPolygon', 'the four pieces across tile edges joined into one feature');
  assert.equal(mvt.get(2)?.props.name, 'pt');
  const gj = data.geojson('https://t.test/{z}/{x}/{y}.json', { maxZoom: 8 });
  await gj.start(c); gj.frame(s, c);
  for (let i = 0; i < 50 && !gj.size; i++) { await new Promise((ok) => setTimeout(ok, 10)); gj.frame(s, c); }
  assert.equal(gj.size, 1); assert.equal(gj.get(7)?.props.name, 'tile');
  assert.throws(() => data.mvt('https://t.test/tiles.pbf'), /E-DATA-001/);
});

test('streams close when their last element or world is disposed, including joins and data drives', async () => {
  const { world, points, entities, drive } = await import('../src/index.ts');
  let opened = 0, stopped = 0;
  const live = data.stream({ connect: emit => { opened++; emit([{ id: 'a', lon: 0, lat: 0 }]); return () => { stopped++; }; } });
  const shapes = data.rows([{ id: 'a', lon: 0, lat: 0 }]);
  const w = await world(null);
  w.add(points({ id: 'one', data: live }), points({ id: 'two', data: shapes.join(live, { on: 'id' }) }));
  await new Promise(resolve => setImmediate(resolve));
  await live.start(ctx());
  assert.equal(opened, 1);
  w.remove('one');
  assert.equal(stopped, 0, 'a joined layer still uses the stream');
  w.dispose(); w.dispose(); live.close();
  assert.equal(stopped, 1, 'closed exactly once');

  const moving = data.stream({ connect: () => () => { stopped++; } });
  const w3 = await world(null);
  w3.add(entities({ id: 'moving', drive: drive.data(moving) }));
  await moving.start(ctx());
  w3.dispose();
  assert.equal(stopped, 2, 'drive.data owns its stream too');
});

test('disposing a socket stream closes the socket and cancels reconnection', async (t) => {
  const sockets: Socket[] = [];
  class Socket {
    onmessage: ((e: { data: string }) => void) | null = null;
    onopen: (() => void) | null = null;
    onclose: (() => void) | null = null;
    closed = 0;
    constructor(_url: string) { sockets.push(this); }
    close() { this.closed++; this.onclose?.(); }
  }
  t.mock.method(globalThis, 'setTimeout', (() => { throw new Error('must not reconnect on disposal'); }) as never);
  t.mock.property(globalThis, 'WebSocket', Socket as never);
  const { world, points } = await import('../src/index.ts');
  const s = data.stream('wss://example.test/live'), w = await world(null);
  w.add(points({ id: 'socket', data: s }));
  await s.start(ctx());
  w.dispose(); s.close();
  assert.equal(sockets[0]!.closed, 1);
});


test('a stream detached before its lazy load cannot open a connection afterwards', async () => {
  const { world, entities, drive } = await import('../src/index.ts');
  let opened = 0;
  const live = data.stream({ connect: () => { opened++; } });
  const w = await world(null);
  w.add(entities({ id: 'late', drive: drive.data(live) }));
  w.dispose();
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(opened, 0);
});

test('a stream closed by its last layer opens again for the next one (remove then add)', async () => {
  const { world, points } = await import('../src/index.ts');
  let opened = 0, stopped = 0;
  const live = data.stream({ connect: emit => { opened++; emit([{ id: 'a', lon: 0, lat: 0 }]); return () => { stopped++; }; } });
  const w = await world(null);
  w.add(points({ id: 'one', data: live }));
  await live.start(ctx());
  w.remove('one');
  assert.equal(stopped, 1);
  w.add(points({ id: 'again', data: live }));
  await live.start(ctx());
  assert.equal(opened, 2, 'connected again');
  w.dispose();
  assert.equal(stopped, 2);
});

