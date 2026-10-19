import { test } from 'node:test';
import assert from 'node:assert/strict';
import { arc, data } from '../src/index.ts';
import { ARC_STRIDE, arcClass, arcSegments } from '../src/core/encoding/marks/arc.ts';
import { ARC_WGSL } from '../src/core/render/graphics/shaders/arc.wgsl.ts';
import { ARC_GLSL } from '../src/core/render/graphics/shaders/arc.glsl.ts';

/** a graphics stand-in that keeps what is written (per buffer: its writes, offset and bytes) */
function fakeGraphics() {
  const made: { kind: string; label: string; size: number; writes: { offset: number; bytes: number }[]; data?: Float32Array }[] = [];
  return {
    made,
    buffer(kind: string, sizeOrData: number | ArrayBufferView, label = '') {
      const b = { kind, label, size: typeof sizeOrData === 'number' ? sizeOrData : sizeOrData.byteLength, writes: [] as { offset: number; bytes: number }[], data: undefined as Float32Array | undefined };
      made.push(b);
      return { kind, size: b.size, uid: made.length, version: 0, write(d: ArrayBufferView, offset = 0) { b.writes.push({ offset, bytes: d.byteLength }); if (d instanceof Float32Array) b.data = d.slice(); }, destroy() {} };
    },
  };
}
type Rec = { id: string; o: [number, number]; d: [number, number]; top?: number };
const rowsOf = (n: number, at = 0): Rec[] => Array.from({ length: n }, (_, i) => ({ id: `h${i + at}`, o: [145.12 + (i + at) * 1e-4, -37.92], d: [145.12 + (i + at) * 1e-4, -37.92 + 0.001 + (i % 5) * 0.004] }));
/** an arc layer driven by hand: its features read, its records made, as a frame would */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Driven = any;
function driven(rows: unknown, heights: (lon: number, lat: number) => number, props: object = {}) {
  const a: Driven = arc({ id: 'ar', data: rows as never, from: (d: { props: Rec }) => d.props.o, to: (d: { props: Rec }) => d.props.d, fromHeight: (d: { props: Rec }) => d.props.top ?? 0, ...props } as never);
  const g = fakeGraphics(); let reads = 0;
  const world = { heightAt: (lon: number, lat: number) => { reads++; return heights(lon, lat); }, exaggeration: 1, groundVersion: 0 };
  const ctx = { s: {}, graphics: g, world };
  // (as attach would: the source read from; as a frame would: the features by key)
  a.src = a.source;
  const step = () => { a.entries = a.read(0); a.byKey = new Map(a.entries.map((e: { key: string }) => [e.key, e])); a.originFor(); a.records(ctx); };
  return { a, g, ctx, world, step, reads: () => reads };
}

test('arc: points by length (one every 25 m, 8 to 64) or set; arcs drawn by size class (8 segments a class)', () => {
  assert.equal(arcSegments(10, undefined), 7, 'a short arc: 8 points, 7 segments');
  assert.equal(arcSegments(260, undefined), 10, '260 m: 11 points');
  assert.equal(arcSegments(5e6, undefined), 63, 'a long one: 64 points');
  assert.equal(arcSegments(260, 24), 23, 'set: the same for every arc');
  assert.equal(arcSegments(260, { every: 10, min: 4, max: 100 }), 25, 'your rule');
  assert.deepEqual([7, 8, 9, 23, 63].map((n) => arcClass(n, undefined)), [8, 8, 16, 24, 64]);
  assert.equal(arcClass(23, 24), 23, 'one count for every arc: one class, exactly it');
});

test('arc: one record an arc (40 bytes), instances of one shared strip; the ground at both ends, its own heights over it', () => {
  const rows = data.rows(rowsOf(30), { id: 'id' }), h = driven(rows, () => 12, { fromHeight: 5 });
  h.step();
  assert.equal(h.a.readouts().arcs(), 30, 'every arc an instance');
  assert.equal(ARC_STRIDE * 4, 40);
  const inst = h.g.made.filter((b) => b.kind === 'instance'), strip = h.g.made.filter((b) => b.kind === 'index');
  assert.equal(inst.reduce((n, b) => n + b.size, 0), 30 * 40, 'exactly 40 bytes an arc the first time');
  assert.equal(strip.length, 1, 'one strip for every arc');
  const d = inst[0]!.data!;
  assert.equal(d[4], 17, 'its start: the ground (12) and its own height (5)');
  assert.equal(d[5], 12, 'its end: the ground');
  assert.ok(d[6]! > 0 && Math.abs(d[9]! * 6378137 - d[6]! * 4) < 1, 'the rise a quarter of its length; the angle between its ends');
  assert.equal(h.reads(), 60, 'two heights an arc');
});

test('arc: a ground change reads two heights an arc and writes only the records whose ends moved', () => {
  let bump = false;
  const rows = data.rows(rowsOf(40), { id: 'id' }), h = driven(rows, (lon) => (bump && lon > 145.1235 ? 20 : 3));
  h.step();
  const before = h.g.made.filter((b) => b.kind === 'instance').map((b) => b.writes.length);
  const r00 = h.reads(); h.a.ground(h.ctx);
  assert.equal(h.reads() - r00, 0, 'the ground as the records read it: no pass');
  bump = true; h.world.groundVersion++; const r0 = h.reads();
  h.a.ground(h.ctx);
  assert.equal(h.reads() - r0, 80, 'two heights an arc');
  const writes = h.g.made.filter((b) => b.kind === 'instance').flatMap((b, i) => b.writes.slice(before[i]));
  const bytes = writes.reduce((n, w) => n + w.bytes, 0);
  assert.ok(writes.length >= 1 && bytes < 40 * 40, `only the arcs that moved written (${bytes} bytes)`);
  h.world.groundVersion++; const r1 = h.reads(); h.a.ground(h.ctx);
  const again = h.g.made.filter((b) => b.kind === 'instance').reduce((n, b) => n + b.writes.length, 0);
  assert.equal(h.reads() - r1, 80);
  assert.equal(again, before.reduce((a, b) => a + b, 0) + writes.length, 'nothing moved: nothing written');
});

test('arc: new data keeps the records of the arcs that are as before; only the new ones are worked out', () => {
  const rows = data.rows(rowsOf(50), { id: 'id' }), h = driven(rows, () => 7);
  h.step();
  const r0 = h.reads();
  rows.upsert(rowsOf(5, 50) as never);
  h.step();
  assert.equal(h.a.readouts().arcs(), 55);
  assert.equal(h.reads() - r0, 10, 'two heights for each of the 5 new arcs only');
  // a prop the records read (the rise): every one worked out again
  h.a.setProps({ height: 30 });
  const r1 = h.reads(); h.a.records(h.ctx);
  assert.equal(h.reads() - r1, 110, 'every arc again');
});

test('arc: drawn over the world by its own order; a still arc asks for no frames; its shaders are twins', () => {
  const rows = [{ o: [0, 0], d: [0.003, 0] }];
  const over = arc({ id: 'ov', data: rows, from: (d) => d.o as [number, number], to: (d) => d.d as [number, number], over: true });
  assert.equal(over.order, 4.5);
  (over as unknown as { shown: number }).shown = 1; (over as unknown as { entries: unknown[] }).entries = [{}];
  assert.equal(over.wantsFrames({} as never), 0, 'still: no frames');
  // the same shape in both languages: the instance (ab, hf, nw) from the vertex number, the hooks
  for (const name of ['ab', 'hf', 'nw']) { assert.match(ARC_WGSL, new RegExp(`\\b${name}\\b`)); assert.match(ARC_GLSL.vertex, new RegExp(`in vec[24] ${name};`)); }
  assert.match(ARC_WGSL, /@builtin\(vertex_index\)/); assert.match(ARC_GLSL.vertex, /gl_VertexID/);
  for (const hook of ['color', 'alpha', 'reveal']) { assert.ok(ARC_WGSL.includes(`/*@${hook}*/`)); assert.ok(ARC_GLSL.fragment.includes(`/*@${hook}*/`)); }
});

test('park access worked out once for a place: entrances, one pass, the bands from it; each house once, its way drawn once', async () => {
  const { accessPlace } = await import('../examples/healthy-city/access-place.ts');
  // a street grid 100 m apart (metres east / south of the origin), a park in its north-west corner
  const origin: [number, number] = [145, -37.9], kx = 111320 * Math.cos((origin[1] * Math.PI) / 180), ll = (x: number, z: number): [number, number] => [origin[0] + x / kx, origin[1] - z / 110574];
  const lines: (string | number)[][] = [];
  for (let i = 0; i <= 5; i++) for (let j = 0; j < 5; j++) { lines.push(['footpath', j * 100, i * 100, (j + 1) * 100, i * 100]); lines.push(['footpath', i * 100, j * 100, i * 100, (j + 1) * 100]); }
  const park = [ll(-60, -60), ll(-10, -60), ll(-10, -10), ll(-60, -10), ll(-60, -60)];
  const files: Record<string, unknown> = { walk: { origin, lines }, parks: { features: [{ properties: { group: 'Parkland and garden' }, geometry: { type: 'Polygon', coordinates: [park] } }, { properties: { group: 'Services and utilities area' }, geometry: { type: 'Polygon', coordinates: [[ll(480, 480), ll(520, 480), ll(520, 520), ll(480, 480)]] } }] } };
  const place = accessPlace(async (u) => files[u]);
  const info = await place.load({ walk: 'walk', parks: 'parks' });
  assert.equal(info.parks, 1, 'the groups that count');
  assert.ok(info.entrances >= 1 && info.nodes === 36, JSON.stringify({ e: info.entrances, n: info.nodes }));
  assert.equal(info.bands.length, 2, '400 and 800 m');
  // two houses on the same street: the far one's way joins the near one's
  const h = place.houses(Float64Array.from([...ll(305, 3), ...ll(205, 3)]));
  assert.ok(h.straight[0]! > h.straight[1]! && h.walk[0]! > h.walk[1]!);
  assert.ok(Math.abs(h.walk[1]! - (205 + 3 + Math.hypot(10, 10))) < 15, `walk ${h.walk[1]}`);
  const n0 = h.offs[1]! - h.offs[0]!, n1 = h.offs[2]! - h.offs[1]!;
  assert.ok(n0 >= 3 && n1 >= 3, 'each house: itself, its point on the way, then the way');
  // asked again: the ways are drawn already (only the house's own two points and the node it meets)
  const again = place.houses(Float64Array.from([...ll(305, 3)]));
  assert.ok(again.offs[1]! - again.offs[0]! <= 3, `drawn once: ${again.offs[1]! - again.offs[0]!}`);
});
