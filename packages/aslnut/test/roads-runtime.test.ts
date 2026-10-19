// modules › world › earth › presets › built › roads, on the device: the ground drawn under every road at every level of
// the terrain (its own tiles, and a finer tile drawn on a parent's heights while its own load), the lowering kept to a
// cell of the level round the road; a kerb's ends closed (not where it runs on into another kerb); a piece kept in the
// chunk of its middle drawn where it is, its chunk's square out of view; built in a worker (its numbers only cross, the
// same mesh back), the builds paced by the lane's room and their answers put inside the frames, a slice a frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { groundLevels } from '../tools/ground-levels.ts';
import { bakedMesh, bakedRoadsWorker, BakedRoads, BAKED_LOOK, clampTerrain, type BakedTile } from '../src/modules/world/earth/presets/built/roads/baked.ts';
import { worker } from '../src/core/runtime/workers.ts';
import { readFileSync, existsSync } from 'node:fs';
import { encodeNumbers } from '../src/core/data/loading/chunks/numbers.ts';
import { StreetDetail } from '../src/modules/world/surface/street-detail.ts';
import type { WorkerLane } from '../src/core/runtime/workers.ts';
import { tilePoint } from '../src/core/space/geo.ts';
import { MESH_FLOATS, MeshBuilder } from '../src/core/geometry/shapes/mesh.ts';
import { Solids } from '../src/core/geometry/shapes/solids.ts';
import { Camera } from '../src/core/observation/observers/orbit/camera.ts';
import { makeState } from '../src/core/world/state.ts';
import type { Terrain } from '../src/modules/world/surface/sources.ts';

const O: [number, number] = [145.09, -37.9], KX = 111320 * Math.cos((O[1] * Math.PI) / 180), KZ = 110574;
// rolling ground (slopes to about 1 in 8)
const G = (x: number, z: number) => 30 + 5 * Math.sin(x / 70) + 3 * Math.cos(z / 55) + 0.03 * x;

/** a made-up pack: a 7 m road across the hills in 20 m cells (its outline falling 12 cm across), the ground beside it
 *  left 0.9 m over it (ungraded, as a bake's coarse grid leaves it) */
function roadPack(): { dir: string; base: Terrain } {
  const dir = mkdtempSync(join(tmpdir(), 'aslnut-ground-'));
  const A = [30, 40], B = [470, 430], L = Math.hypot(B[0]! - A[0]!, B[1]! - A[1]!), tx = (B[0]! - A[0]!) / L, tz = (B[1]! - A[1]!) / L, nx = -tz, nz = tx, half = 3.5;
  const at = (s: number, side: number): [number, number, number] => { const cx = A[0]! + tx * s, cz = A[1]! + tz * s; return [cx + nx * half * side, cz + nz * half * side, G(cx, cz) + 0.06 * side]; };
  const cells: number[][] = [], pieces: number[][] = [], left: number[] = [], right: number[] = [];
  for (let s = 0; s < L; s += 20) {
    const s1 = Math.min(L, s + 20), q = [at(s, -1), at(s1, -1), at(s1, 1), at(s, 1)];
    cells.push([1, 4, ...q.flat()]); pieces.push([4, 0, 0, 0, 1, 4, ...q.flat()]);
  }
  for (let s = 0; s <= L; s += 20) { left.push(...at(Math.min(s, L), -1)); right.push(...at(Math.min(s, L), 1)); }
  writeFileSync(join(dir, 'index.json'), JSON.stringify({ v: 2, size: 500, origin: O, kinds: ['carriageway'], tiles: [[0, 0]] }));
  writeFileSync(join(dir, '0_0.json'), JSON.stringify({ v: 3, ix: 0, iz: 0, size: 500, infos: [{ kind: 'road', props: {} }], pieces }));
  writeFileSync(join(dir, 'clamp.json'), JSON.stringify({ v: 3, origin: O, size: 500, tiles: [[0, 0]] }));
  mkdirSync(join(dir, 'clamp'));
  writeFileSync(join(dir, 'clamp', '0_0.json'), JSON.stringify({ v: 3, cells, edges: [left, right] }));
  const base: Terrain = { kind: 'terrain', id: 'ungraded', attribution: '', terms: { show: true, prefetch: true, keep: true, export: true }, maxZoom: 22, blend: 0, version: 0,
    heights: async (t, n) => { const h = new Float32Array(n * n); for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) { const [lon, lat] = tilePoint(t.z, t.x, t.y, i / (n - 1), j / (n - 1)), x = (lon - O[0]) * KX, z = -(lat - O[1]) * KZ; h[j * n + i] = G(x, z) + 0.9; } return h; } };
  return { dir, base };
}

test('ground under the roads: none over a road by 15 cm at any terrain level, its own or a parent standing in (up to 5 up)', async () => {
  const { dir, base } = roadPack();
  try {
    let before = 0;
    for (let z = 12; z <= 20; z++) {
      const up = Array.from({ length: Math.min(5, 20 - z) }, (_, k) => k + 1);
      const r = await groundLevels({ dir, base, zooms: [z], standIns: up, step: 1, spread: true });
      for (const [name, s] of Object.entries(r.levels)) {
        assert.ok(s.samples > 1000, `${name}: measured`);
        assert.equal(s.over15, 0, `${name}: ${s.over15} road points with the ground over them by more than 15 cm (worst ${s.worst} m)`);
      }
      // the lowering kept to the cells the road touches: no sample lowered farther from it than a cell's diagonal
      const cell = (40075016.686 * Math.cos((O[1] * Math.PI) / 180)) / 2 ** z / 32, sp = r.spread[`z${z}`]!;
      assert.ok(sp.farthest <= cell * Math.SQRT2 + 0.5, `z${z}: lowered ${sp.farthest} m from the road (a cell ${cell.toFixed(1)} m)`);
      // the clamp at the samples only: the ground rose through the road between them
      before += (await groundLevels({ dir, base, zooms: [z], standIns: up, step: 1, under: false })).levels[`z${z}`]!.over15;
    }
    assert.ok(before > 1000, `without the cells held under, the ground rose over the road (${before} points over 15 cm)`);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('kerbs: every end closed by its cross-section facing out, but where it runs on into the next kerb', () => {
  // along x = 20 southwards, its top reaching 0.3 m east: a kerb to a ramp, a kerb from it, then on into another
  const pt = (z: number) => [20, z, 10, 9.8, 0.3, 0];
  const edge = (k: number, ...zs: number[]) => [5, k, 0, zs.length, ...zs.flatMap(pt)];
  const tile: BakedTile = { v: 3, ix: 0, iz: 0, size: 500, infos: [{ kind: 'road', props: {} }], pieces: [edge(1, 0, 10, 20), edge(2, 20, 24), edge(1, 24, 40), edge(1, 40, 60)] };
  const m = bakedMesh(tile, ['carriageway', 'kerb', 'ramp'], BAKED_LOOK).mesh, F = MESH_FLOATS;
  // the triangles lying across the kerb at z (all three points there), with the way each faces along z
  const across = (z: number) => {
    const out: { y0: number; y1: number; x0: number; x1: number; nz: number }[] = [];
    for (let i = 0; i < m.length; i += 3 * F) {
      const p = [0, 1, 2].map((k) => [m[i + k * F]!, m[i + k * F + 1]!, m[i + k * F + 2]!] as const);
      if (!p.every((q) => Math.abs(q[2] - z) < 1e-4)) continue;
      const a = p[0]!, b = p[1]!, c = p[2]!, nz = (b[0]! - a[0]!) * (c[1]! - a[1]!) - (b[1]! - a[1]!) * (c[0]! - a[0]!);
      out.push({ y0: Math.min(...p.map((q) => q[1])), y1: Math.max(...p.map((q) => q[1])), x0: Math.min(...p.map((q) => q[0])), x1: Math.max(...p.map((q) => q[0])), nz });
    }
    return out;
  };
  for (const [z, way] of [[0, -1], [20, 1], [24, -1], [60, 1]] as const) {
    const t = across(z);
    assert.equal(t.length, 2, `the end at z ${z} closed (two triangles)`);
    assert.ok(Math.min(...t.map((q) => q.y0)) <= 9.8 - 0.6 + 1e-3 && Math.max(...t.map((q) => q.y1)) >= 10.15 - 1e-3, `z ${z}: from the kerb's top down into the ground`);
    assert.ok(Math.min(...t.map((q) => q.x0)) <= 20 + 1e-3 && Math.max(...t.map((q) => q.x1)) >= 20.3 - 1e-3, `z ${z}: across its width`);
    assert.ok(t.every((q) => Math.sign(q.nz) === way), `z ${z}: facing out of the kerb`);
  }
  assert.equal(across(40).length, 0, 'where it runs on into the next kerb: nothing across it');
  assert.equal(across(10).length, 0, 'along a kerb: nothing across it');
});

test('solids: a piece kept in the chunk of its middle is drawn (and casts) where it is, its chunk square out of view', async () => {
  // a graphics chip that records nothing (the layer's own culling is what is measured)
  let uid = 0;
  const res = () => ({ uid: uid++, version: 0, write() {}, destroy() {} });
  const g = { api: 'webgl2', program: (desc: unknown) => ({ ready: Promise.resolve(), destroy() {}, desc }), buffer: res, texture: res, target: res } as never;
  const s = new Solids({ id: 'roads', shadows: true }), cam = new Camera({ lon: O[0] + 650 / KX, lat: O[1] - 105 / KZ, zoom: 19, tilt: 0 });
  cam.update(390, 844, 16);
  const world = { id: 'w', heightAt: () => 0, exaggeration: 1, error: (e: unknown) => { throw e; }, graphicsApi: 'webgl2', groundVersion: 0, context: 'app', now: 0, elementsOfKind: () => [], invalidate() {} };
  await s.attach({ graphics: g, loader: null as never, profile: null, camera: cam, world } as never);
  // the chunk at the place's corner (its square 0…500 m); its one piece 600…700 m east, 100…110 m south, 10 m up
  const mb = new MeshBuilder(); mb.quadUp([600, 10, 100], [700, 10, 100], [700, 10, 110], [600, 10, 110], '#3b3e42');
  s.put('0_0', { origin: O, at: [0, 0], mesh: mb.build(), free: true });
  const draws = s.frame({ graphics: g, camera: cam, s: makeState({ view: { lon: cam.lon, lat: cam.lat, zoom: 19 } }), frame: res() as never, now: 0, dt: 16, world: world as never, shadowMap: res() as never });
  const shown = draws.filter((d) => !d.shadowOnly && d.vertices), cast = draws.filter((d) => d.shadowOnly);
  assert.equal(shown.length, 1, 'drawn (and so picked): its square is out of view, the piece is in it');
  assert.equal(cast.length, 1, 'cast into the sun’s shadow map');
  // its box: where the piece is (not the square, not 100 km tall)
  const b = cast[0]!.bounds!;
  assert.ok(b[4]! - b[1]! < 20, `its box as high as the piece (${(b[4]! - b[1]!).toFixed(1)} m)`);
  assert.ok(b[3]! - b[0]! < 110 && b[5]! - b[2]! < 20, 'its box as wide as the piece');
});

// a graphics chip that records nothing, a world on flat ground, a camera over the place's corner
function rig() {
  let uid = 0;
  const res = () => ({ uid: uid++, version: 0, write() {}, destroy() {} });
  const g = { api: 'webgl2', program: (desc: unknown) => ({ ready: Promise.resolve(), destroy() {}, desc }), buffer: res, texture: res, target: res } as never;
  const world = { id: 'w', heightAt: () => 0, exaggeration: 1, error: (e: unknown) => { throw e; }, graphicsApi: 'webgl2', groundVersion: 0, context: 'app', now: 0, elementsOfKind: () => [], invalidate() {} };
  const cam = new Camera({ lon: O[0] + 250 / KX, lat: O[1] - 250 / KZ, zoom: 17, tilt: 0 }); cam.update(390, 844, 16);
  let n = 0;
  const frame = (s: Solids) => s.frame({ graphics: g, camera: cam, s: makeState({ view: { lon: cam.lon, lat: cam.lat, zoom: 17 } }), frame: res() as never, now: 0, n: ++n, dt: 16, world: world as never, shadowMap: res() as never });
  return { g, world, cam, frame };
}
const settle = () => new Promise((ok) => setTimeout(ok, 0));
/** a lane of `size` workers whose answers the test hands back (`answer`), counting its calls as a lane does */
function heldLane(size: number) {
  const held: { name: string; args: unknown[]; ok: (v: unknown) => void }[] = [];
  const call = <T,>(name: string, ...args: unknown[]) => new Promise<T>((ok) => { held.push({ name, args, ok: ok as (v: unknown) => void }); });
  const lane: WorkerLane = { size, get busy() { return held.length; }, call, callIn: (_at, name, ...args) => call(name, ...args), terminate() {} };
  return { lane, held, answer: (i: number, v: unknown) => { const [h] = held.splice(i, 1); h!.ok(v); } };
}

test('roads in a worker: only the numbers cross (still encoded), the same mesh comes back; the tile kept here as it came', () => {
  const pt = (z: number) => [20, z, 10, 9.8, 0.3, 0];
  const pieces = [[5, 1, 0, 3, ...[0, 10, 20].flatMap(pt)], [1, 0, 0, 0, 4, 0, 0, 10, 30, 0, 10.2, 30, 40, 10.4, 0, 40, 10.1]];
  const kinds = ['carriageway', 'kerb'], main: BakedTile = { v: 3, ix: 2, iz: 3, size: 500, infos: [{ kind: 'road', props: {} }], pieces: structuredClone(pieces) };
  const want = bakedMesh(main, kinds, BAKED_LOOK).mesh;
  // the tile as the bake writes it: its rows encoded
  const tile: BakedTile = { v: 3, ix: 2, iz: 3, size: 500, infos: [{ kind: 'road', props: { name: 'A' } }], pieces: [], numeric: encodeNumbers(pieces, 100), numericScale: 100 };
  delete (tile as { pieces?: unknown }).pieces;
  const sent = { v: tile.v, ix: tile.ix, iz: tile.iz, size: tile.size, numeric: tile.numeric, numericScale: tile.numericScale };
  const got = bakedRoadsWorker().roads(structuredClone(sent), kinds, { ...BAKED_LOOK }, []);
  assert.equal(got.length, want.length, 'as many numbers');
  assert.ok(got.every((v, i) => Math.abs(v - want[i]!) < 1e-4), 'the same mesh (to the encoding’s cm)');
  assert.ok(tile.numeric && !(tile as { pieces?: unknown }).pieces, 'the tile here not decoded: short to send again');
});

test('streamed tiles built in a worker: started as its lane has room, the nearest first; put inside the frames a slice a frame; an answer for a view left behind let go', async () => {
  const { g, world, cam, frame } = rig(), { lane, held, answer } = heldLane(1);
  const index = { size: 500, origin: O, tiles: [[0, 0], [1, 0], [0, 1], [1, 1], [-1, 0], [0, -1]] as [number, number][] };
  const loader = { get: async (u: string) => (u === 'index.json' ? index : { u }) };
  const mesh = () => { const mb = new MeshBuilder(); mb.quadUp([10, 1, 10], [20, 1, 10], [20, 1, 20], [10, 1, 20], '#3b3e42'); return mb.build(); };
  const sd = new StreetDetail<{ u: string }, null>({ url: 'index.json', worker: lane, putMs: 0, near: 4000, build: (_t, c) => lane.call<number>('b', c.ix, c.iz).then(() => ({ chunk: { mesh: mesh(), free: true } })) });
  await sd.attach({ graphics: g, loader: loader as never, profile: null, camera: cam, world } as never);
  for (let k = 0; k < 4; k++) { frame(sd); await settle(); }
  assert.equal(held.length, 2, 'two builds away for a lane of one worker (the rest wait here, where the view can still leave them)');
  answer(1, 0); answer(0, 0); await settle();
  assert.equal(sd.keys().length, 0, 'nothing put between the frames');
  frame(sd); assert.equal(sd.keys().length, 1, 'one put in the next frame (a slice of 0 ms: one at least)');
  frame(sd); assert.equal(sd.keys().length, 2, 'the other in the frame after');
  await settle(); assert.equal(held.length, 2, 'the next two started as the lane had room');
  // the view leaves: an answer for a tile it left behind is not put
  cam.lon = O[0] + 9000 / KX; cam.lat = O[1] - 9000 / KZ; cam.update(390, 844, 16);
  frame(sd); answer(0, 0); answer(0, 0); await settle(); frame(sd); frame(sd);
  assert.equal(sd.keys().length, 0, 'the answers for the view left behind let go, the tiles there dropped');
});

test('baked roads take their lane: the build is the worker’s, the mesh put in a frame', async () => {
  const { g, world, cam, frame } = rig(), { lane, held, answer } = heldLane(2);
  const pieces = [[1, 0, 0, 0, 4, 0, 0, 10, 30, 0, 10.2, 30, 40, 10.4, 0, 40, 10.1]], kinds = ['carriageway'];
  const tile = { v: 3, ix: 0, iz: 0, size: 500, infos: [{ kind: 'road', props: {} }], numeric: encodeNumbers(pieces, 100), numericScale: 100 };
  const index = { size: 500, origin: O, kinds, tiles: [[0, 0]] as [number, number][] };
  const loader = { get: async (u: string) => (u.endsWith('index.json') ? index : structuredClone(tile)) };
  const r = new BakedRoads({ url: '/p/index.json', worker: lane });
  await r.attach({ graphics: g, loader: loader as never, profile: null, camera: cam, world } as never);
  for (let k = 0; k < 3; k++) { frame(r); await settle(); }
  assert.equal(held.length, 1, 'one build asked of the lane');
  assert.equal(held[0]!.name, 'roads'); assert.deepEqual(held[0]!.args[1], kinds);
  assert.ok(!('infos' in (held[0]!.args[0] as object)) && 'numeric' in (held[0]!.args[0] as object), 'its numbers sent, encoded; its infos kept here');
  const m = bakedRoadsWorker().roads(...(held[0]!.args as Parameters<ReturnType<typeof bakedRoadsWorker>['roads']>));
  answer(0, m); await settle();
  assert.equal(r.keys().length, 0, 'not put between the frames'); frame(r);
  assert.deepEqual(r.keys(), ['0_0'], 'put in the frame'); assert.ok(r.reachOf('0_0'), 'its reach known (standing, culling)');
});

test('streamed layers share one put budget a frame: the other waits its turn, a layer left out two frames running puts one anyway', async () => {
  const { g, world, cam } = rig(), { lane, held, answer } = heldLane(4);
  const index = { size: 500, origin: O, tiles: [[0, 0], [1, 0], [0, 1], [1, 1]] as [number, number][] };
  const loader = { get: async (u: string) => (u === 'index.json' ? index : { u }) };
  const mesh = () => { const mb = new MeshBuilder(); mb.quadUp([10, 1, 10], [20, 1, 10], [20, 1, 20], [10, 1, 20], '#3b3e42'); return mb.build(); };
  const layer = (id: string) => new StreetDetail<{ u: string }, null>({ id, url: 'index.json', worker: lane, putMs: 0, near: 4000, build: (_t, c) => lane.call<number>('b', c.ix, c.iz).then(() => ({ chunk: { mesh: mesh(), free: true } })) });
  const a = layer('a'), b = layer('b');
  for (const l of [a, b]) await l.attach({ graphics: g, loader: loader as never, profile: null, camera: cam, world } as never);
  // one world frame: both layers in it (the world's frame number shared)
  let fn = 100;
  const tick = () => { fn++; for (const l of [a, b]) l.frame({ graphics: g, camera: cam, s: makeState({ view: { lon: cam.lon, lat: cam.lat, zoom: 17 } }), frame: { write() {}, destroy() {} } as never, now: 0, n: fn, dt: 16, world: world as never, shadowMap: { write() {}, destroy() {} } as never }); };
  for (let k = 0; k < 4; k++) { tick(); await settle(); }
  while (held.length) answer(0, 0);
  await settle();
  const counts: [number, number][] = [];
  for (let k = 0; k < 6; k++) { tick(); counts.push([a.keys().length, b.keys().length]); }
  // a frame puts one in all (putMs 0); b, left out two frames running, puts one anyway in the third
  assert.deepEqual(counts.slice(0, 3), [[1, 0], [2, 0], [3, 1]], `the puts frame by frame: ${JSON.stringify(counts)}`);
});

test('the clamp in a worker: the same heights, every level (only the ground and its clamp tiles cross); kept in one worker; a lane without workers runs it here', async () => {
  const { dir, base } = roadPack();
  try {
    const ctx = { loader: { get: async (u: string) => (existsSync(u) ? JSON.parse(readFileSync(u, 'utf8')) : null) } } as never;
    const fns = bakedRoadsWorker(), asked: { name: string; at: number | null }[] = [];
    // a lane whose calls cross as a worker's do (structured clones there and back)
    const lane: WorkerLane = { size: 2, busy: 0, call: async (name, ...args) => { asked.push({ name, at: null }); return structuredClone((fns as never as Record<string, (...a: unknown[]) => unknown>)[name]!(...structuredClone(args))) as never; },
      callIn: async (at, name, ...args) => { asked.push({ name, at }); return structuredClone((fns as never as Record<string, (...a: unknown[]) => unknown>)[name]!(...structuredClone(args))) as never; }, terminate() {} };
    const here = clampTerrain(base, `${dir}/clamp.json`), there = clampTerrain(base, `${dir}/clamp.json`, { worker: lane });
    // (no workers in Node: the lane's fallback, the same functions on this thread)
    const none = clampTerrain(base, `${dir}/clamp.json`, { worker: worker('x.js', { fallback: bakedRoadsWorker() }) });
    let tiles = 0;
    for (let z = 13; z <= 18; z++) {
      const k = 2 ** z, x0 = Math.floor(((O[0] + 180) / 360) * k), r = (O[1] * Math.PI) / 180, y0 = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * k);
      for (let x = x0; x <= x0 + 2; x++) for (let y = y0; y <= y0 + 2; y++) {
        const a = await here.heights({ z, x, y }, 33, ctx), b = await there.heights({ z, x, y }, 33, ctx), c = await none.heights({ z, x, y }, 33, ctx);
        assert.deepEqual(b, a, `z${z} ${x}/${y}: the same heights from the worker`); assert.deepEqual(c, a, `z${z} ${x}/${y}: the same from the lane's fallback`); tiles++;
      }
    }
    assert.ok(asked.length > 0 && asked.every((q) => q.name === 'clamp' && q.at === 0), 'asked of one worker of the lane, always the same one');
    assert.ok(tiles === 54);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('solids read their ground again a slice a frame, in view and nearest first; not settled until every chunk is read whole at the same terrain (however many frames it took)', async () => {
  let uid = 0, level = 10, step = 0.5, gv = 1;
  const res = () => ({ uid: uid++, version: 0, write() {}, destroy() {} });
  const g = { api: 'webgl2', program: () => ({ ready: Promise.resolve(), destroy() {} }), buffer: res, texture: res, target: res } as never;
  // a ground that steps up a little at x > 50 m (a probe of 25 points misses it: the grid must be read whole)
  const world = { id: 'w', heightAt: (lon: number) => level + ((lon - O[0]) * KX % 500 > 45 && (lon - O[0]) * KX % 500 < 55 ? step : 0), exaggeration: 1, error: (e: unknown) => { throw e; }, graphicsApi: 'webgl2', get groundVersion() { return gv; }, context: 'app', now: 0, elementsOfKind: () => [], invalidate() {} };
  const cam = new Camera({ lon: O[0] + 250 / KX, lat: O[1] - 250 / KZ, zoom: 17, tilt: 0 }); cam.update(390, 844, 16);
  const run = async (ms: number) => {
    const s = new Solids({ id: 'w', groundMs: ms, fade: 0 });
    await s.attach({ graphics: g, loader: null as never, profile: null, camera: cam, world } as never);
    s.shown = s.target = 1;
    const mb = new MeshBuilder(); mb.quadUp([10, 0.2, 10], [20, 0.2, 10], [20, 0.2, 20], [10, 0.2, 20], '#3f7fae'); const mesh = mb.build();
    for (const [k, at] of [['far', [6000, 6000]], ['next', [500, 0]], ['here', [0, 0]], ['farther', [9000, 0]]] as const) s.put(k, { origin: O, at: [at[0], at[1]], mesh });
    let n = 0; const frame = () => { n++; s.frame({ graphics: g, camera: cam, s: makeState({ view: { lon: cam.lon, lat: cam.lat, zoom: 17 } }), frame: res() as never, now: 0, n, dt: 16, world: world as never, shadowMap: res() as never }); };
    frame();
    level = 10; step = 0.5; gv = 1; for (let k = 0; k < 20 && !s.status().ready; k++) frame();
    // the terrain changes: the chunk in view under the camera read first
    level = 12; gv++;
    const chunks = (s as unknown as { chunks: Map<string, { groundRead: number; ground: Float32Array }> }).chunks;
    frame();
    const first = [...chunks].filter(([, c]) => c.groundRead === gv).map(([k]) => k);
    let waited = 0;
    while (!s.status().ready && waited < 50) { assert.ok(s.animating(), 'it asks for frames while a chunk waits'); frame(); waited++; }
    // only the step between the probes rises: the probes hold, each chunk is read whole all the same before it settles
    step = 1.5; gv++; frame();
    const held = [...chunks].filter(([, c]) => c.groundRead !== gv).length;
    for (let k = 0; k < 50 && !s.status().ready; k++) frame();
    const grids = [...chunks].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, c]) => Array.from(c.ground));
    return { first, waited, held, grids, ready: s.status().ready };
  };
  const one = await run(0), all = await run(1000);
  assert.ok(one.first.includes('here') && !one.first.includes('far') && !one.first.includes('farther'), `those in view read first (${one.first})`);
  assert.ok(one.waited >= 2 && one.ready, `those out of view a frame each after (${one.waited} frames), and settled only then`);
  assert.ok(all.waited === 0, 'with the time for it, all in one frame');
  assert.deepEqual(one.grids, all.grids, 'the same ground under every chunk, however many frames it took');
  assert.ok(one.held >= 2, `probes held most at first (${one.held} left to read whole)`);
  assert.ok(one.grids.every((gr) => gr.some((h) => h === 13.5)), 'every grid read whole at the last terrain (the step between the probes in it)');
});
