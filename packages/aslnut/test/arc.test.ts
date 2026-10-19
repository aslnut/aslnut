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
  // (as a frame does when a build is done: what is drawn is from the origin the build placed it from)
  const step = () => { a.entries = a.read(0); a.byKey = new Map(a.entries.map((e: { key: string }) => [e.key, e])); a.originFor(); a.records(ctx); a.drawnOrigin = a.origin; };
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

test('arc: new data that moves the layer\'s origin: the kept arcs\' ends from the origin now (none drawn off its place); a ground not known keeps the ends where they were', () => {
  let known = true;
  const rows = data.rows(rowsOf(50), { id: 'id' }), h = driven(rows, () => (known ? 7 : NaN), { fromHeight: 4 });
  h.step();
  const o0 = h.a.origin;
  // houses of a tile 2 km east: the box's middle (the origin) moves a kilometre
  rows.upsert(rowsOf(5, 50).map((r) => ({ ...r, o: [r.o[0] + 0.025, r.o[1]], d: [r.d[0] + 0.025, r.d[1]] })) as never);
  h.step();
  assert.ok(Math.abs(h.a.origin.lon0 - o0.lon0) > 0.01, 'the origin moved');
  const off = () => { let worst = 0; for (const b of h.a.buckets.values()) for (let j = 0; j < b.count; j++) { const q = b.of[j] * 4, r = j * ARC_STRIDE, ra = h.a.origin.rel(h.a.ends[q], h.a.ends[q + 1]), rb = h.a.origin.rel(h.a.ends[q + 2], h.a.ends[q + 3]); worst = Math.max(worst, Math.abs(b.data[r] - ra[0]), Math.abs(b.data[r + 1] - ra[1]), Math.abs(b.data[r + 2] - rb[0]), Math.abs(b.data[r + 3] - rb[1])); } return worst * 6371008.8; };
  assert.ok(off() < 0.01, `every arc's ends from the origin now (worst ${off().toFixed(3)} m off)`);
  assert.equal(h.a.readouts().arcs(), 55);
  // the ground let go under them (a view moving away): the ends stay, never down to 0 and back
  known = false; h.world.groundVersion++; h.a.ground(h.ctx);
  let low = Infinity; for (const b of h.a.buckets.values()) for (let j = 0; j < b.count; j++) low = Math.min(low, b.data[j * ARC_STRIDE + 4], b.data[j * ARC_STRIDE + 5]);
  assert.equal(low, 7, 'the heights as before (the ground 7, the start 4 over it)');
});

test('arc: a row is drawn where it says, whatever other rows come, go or move (rows A; rows B far away move the origin; B removed): A\'s drawn ends do not move', () => {
  const A = rowsOf(20), rows = data.rows(A, { id: 'id' }), h = driven(rows, () => 30, { fromHeight: 5 });
  // the place drawn: a record's ends plus the view's offset from the origin (the uniform), from a camera that stays
  const cam = [145.121, -37.921] as const;
  const drawn = () => {
    const off = h.a.drawnOrigin.offset(cam[0], cam[1]), out = new Map<string, number[]>();
    for (const b of h.a.buckets.values()) for (let j = 0; j < b.count; j++) {
      const e = h.a.entries[b.of[j]], r = j * ARC_STRIDE;
      out.set(e.key, [b.data[r] + off[0], b.data[r + 1] + off[1], b.data[r + 2] + off[0], b.data[r + 3] + off[1], b.data[r + 4], b.data[r + 5]]);
    }
    return out;
  };
  const worst = (x: Map<string, number[]>, y: Map<string, number[]>) => { let m = 0; for (const [k, v] of x) { const u = y.get(k); assert.ok(u, `arc ${k} still drawn`); for (let i = 0; i < 4; i++) m = Math.max(m, Math.abs(v[i]! - u[i]!) * 6371008.8); for (let i = 4; i < 6; i++) m = Math.max(m, Math.abs(v[i]! - u[i]!)); } return m; };
  h.step(); const a0 = drawn();
  const B = rowsOf(8, 100).map((r) => ({ ...r, o: [r.o[0] + 0.05, r.o[1] - 0.03], d: [r.d[0] + 0.05, r.d[1] - 0.03] }));
  const o0 = h.a.origin.lon0; rows.upsert(B as never); h.step();
  assert.ok(Math.abs(h.a.origin.lon0 - o0) > 0.02, 'B moved the origin');
  const a1 = drawn(); assert.equal(a1.size, 28);
  assert.ok(worst(a0, a1) < 0.005, `A drawn where it was with B in (worst ${worst(a0, a1).toFixed(4)} m)`);
  rows.remove(...B.map((r) => r.id)); h.step();
  const a2 = drawn(); assert.equal(a2.size, 20);
  assert.ok(worst(a0, a2) < 0.005, `A drawn where it was with B gone (worst ${worst(a0, a2).toFixed(4)} m)`);
});

test('arc: an end whose ground is not known yet waits, drawn as nothing (never at a stand-in height), and is drawn where it says once the ground comes', () => {
  let known = false;
  const rows = data.rows(rowsOf(10), { id: 'id' }), h = driven(rows, (lon) => (known || lon < 145.1205 ? 40 : NaN), { fromHeight: 3 });
  h.step();
  const rec = () => { const out: number[][] = []; for (const b of h.a.buckets.values()) for (let j = 0; j < b.count; j++) out.push(Array.from(b.data.subarray(j * ARC_STRIDE, j * ARC_STRIDE + ARC_STRIDE))); return out; };
  assert.equal(h.a.readouts().waiting(), 5, 'the 5 whose ground is not known wait');
  for (const r of rec().filter((x) => x[4] !== 43)) assert.ok(r[0] === r[2] && r[1] === r[3] && r[6] === 0 && r[9] === 0, 'a waiting arc: no length, no rise (nothing drawn)');
  known = true; h.world.groundVersion++; h.a.ground(h.ctx);
  assert.equal(h.a.readouts().waiting(), 0);
  for (const r of rec()) assert.ok(r[4] === 43 && r[5] === 40 && r[6]! > 0 && r[9]! > 0 && (r[0] !== r[2] || r[1] !== r[3]), 'every arc on its ground, its rise and length');
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
