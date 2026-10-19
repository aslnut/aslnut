// The lego bricks, headless: one size rule (core › render › drawing › size: CSS px or metres within a range of CSS px),
// the levels kept within a margin (core › runtime › detail: a size on screen's hysteresis).
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('size: CSS px or metres within a range; the values a mark styles; a range that is not one is refused', async () => {
  const { sizeUnits, sizeValue, sizePxAt, AslnutError } = await import('../src/index.ts');
  // CSS px as before: a value, a function, no range
  assert.deepEqual(sizeUnits(8), [0, 0, 1e6, 0]);
  assert.equal(sizeValue(8), 8);
  const f = (d: { n: number }) => d.n; assert.equal(sizeValue(f), f);
  // metres within a range; px within one
  assert.deepEqual(sizeUnits({ m: 40, min: 4, max: 32 }), [1, 4, 32, 0]);
  assert.equal(sizeValue({ m: 40, min: 4 }), 40);
  assert.deepEqual(sizeUnits({ px: 6, max: 12 }), [0, 0, 12, 0]);
  // what the frame shader does: 40 m at 1 m a CSS px is 40 px, kept within [4, 32]; far away 4
  assert.equal(sizePxAt(40, sizeUnits({ m: 40, min: 4, max: 32 }), 100, 0.01), 32);
  assert.equal(sizePxAt(40, sizeUnits({ m: 40, min: 4, max: 32 }), 1e5, 0.01), 4);
  assert.equal(sizePxAt(40, sizeUnits({ m: 40, min: 4, max: 64 }), 100, 0.01), 40);
  assert.throws(() => sizeUnits({ m: 40, min: 30, max: 10 }), AslnutError);
  // a shape carries its range; made, it keeps it
  const { shape } = await import('../src/index.ts');
  const s = shape({ id: 'sym', size: { min: 8, max: 40 }, build: (b) => b.solid('box', { size: [2, 1, 4], at: [0, 0.5, 0] }) });
  assert.deepEqual(s.make().size, { min: 8, max: 40 });
});

test('levels: kept within a margin by pixels and by distance; the level before stays until past an edge', async () => {
  const { keptLevel } = await import('../src/core/geometry/shapes/solids.ts');
  const px = (v: number, prev: number) => keptLevel(v, prev, 120, 25, 1.2, false), dist = (v: number, prev: number) => keptLevel(v, prev, 350, 800, 1.2, true);
  // no level before: by its edges
  assert.deepEqual([px(200, -1), px(50, -1), px(10, -1)], [0, 1, 2]);
  // within the margin of an edge: the level before stays (either way)
  assert.deepEqual([px(130, 1), px(110, 0), px(28, 2), px(23, 1)], [1, 0, 2, 1]);
  // past it: it changes (by as many levels as it is sure of)
  assert.deepEqual([px(200, 2), px(130, 2), px(90, 0), px(15, 0)], [0, 1, 1, 2]);
  assert.deepEqual([dist(340, 1), dist(280, 1), dist(360, 0), dist(430, 0), dist(900, 1), dist(1000, 1)], [1, 0, 0, 1, 1, 2]);
});

test('pieces: parts and groups numbered in the vertices, joints declared in the build, copies over time per level', async () => {
  const { shape } = await import('../src/index.ts');
  const t = shape({ id: 'mill', build: (b) => {
    b.solid('box', { size: [1, 4, 1], at: [0, 2, 0] });
    b.group('roof', (b) => b.solid('box', { size: [1.2, 0.2, 1.2], at: [0, 4.1, 0] }));
    b.part('rotor', (b) => b.solid('box', { size: [4, 0.2, 0.1], at: [0, 4, 0.7] }), { pivot: [0, 4, 0.7], joint: { kind: 'hinge', axis: 'z' } });
    b.copy((b) => b.mesh([[-0.1, 0, 0], [0.1, 0, 0], [0, 0.2, 0]]), { emit: { count: [12, 4, 0], life: 2, rise: 3 } });
  }, simple: true });
  const m = t.make();
  assert.deepEqual(m.pieces?.parts.map((p) => [p.name, p.joint?.kind, p.joint?.axis]), [['rotor', 'hinge', [0, 0, 1]]]);
  assert.deepEqual(m.pieces?.groups, ['roof']);
  assert.equal(m.pieces?.emitters.length, 1); assert.equal(m.pieces?.emitters[0]!.count, 12);
  // the codes: the rotor's vertices part 1, the roof's group 1 (512 × (part + 16 × group)), the copies' material 17
  const w = m.levels[0] as Float32Array, codes = new Set<number>(); for (let i = 5; i < w.length; i += 6) codes.add(Math.floor(w[i]! / 512));
  assert.ok(codes.has(1) && codes.has(16) && codes.has(0), [...codes].join(','));
  const copies = (l: Float32Array) => { let n = 0; for (let i = 5; i < l.length; i += 18) if (l[i]! % 256 === 17) n++; return n; };
  assert.equal(copies(w), 12); assert.equal(copies(m.levels[1] as Float32Array), 4);
});

test('cache: builds kept the least lately used out first; one definition updated, every layer told', async () => {
  const { shape, num } = await import('../src/index.ts');
  const s = shape({ id: 'c', params: { h: num(1, 1000, 1) }, build: (b, p) => b.solid('box', { size: [1, p.h, 1], at: [0, p.h / 2, 0] }) });
  const a = s.make({ h: 2 }); for (let i = 0; i < 300; i++) s.make({ h: 3 + i });
  assert.equal((s as unknown as { cache: Map<string, unknown> }).cache.size, 256);
  assert.notEqual(s.make({ h: 2 }), a, 'the least lately used was let go');
  const b = s.make({ h: 7 }); assert.equal(s.make({ h: 7 }), b, 'a hit is the same build');
  let told = 0; s.watch(() => told++);
  s.update({ build: (bb, p) => bb.solid('cylinder', { radius: 0.5, size: p.h, at: [0, p.h / 2, 0] }) });
  assert.equal(told, 1); assert.notEqual(s.make({ h: 7 }), b); assert.equal(s.version, 1);
});

test('forms: builds that come out the same share their levels (one buffer, one set); a seed that changes the build does not', async () => {
  const { shape, num } = await import('../src/index.ts');
  const same = shape({ id: 's', params: { h: num(1, 9, 2) }, build: (b, p) => b.solid('box', { size: [1, p.h, 1], at: [0, p.h / 2, 0] }) });
  const a = same.make({ h: 2 }, 1), b = same.make({ h: 2 }, 2);
  assert.notEqual(a, b); assert.equal(a.levels[0], b.levels[0]); assert.equal(a.levels[2], b.levels[2]);
  const seeded = shape({ id: 'r', build: (b, _p, r) => b.solid('box', { size: [1, 1 + r(), 1], at: [0, 1, 0] }) });
  assert.notEqual(seeded.make({}, 1).levels[0], seeded.make({}, 2).levels[0]);
  // more builds between them than the cache keeps (100 forms of 40 seeds: 4,000 builds), still one array for the same
  for (let i = 0; i < 300; i++) same.make({ h: 3 + (i % 6) }, 10 + i);
  assert.equal((same as unknown as { cache: Map<string, unknown> }).cache.has(`1|${JSON.stringify({ h: 2 })}`), false, 'the first build let go from the cache');
  assert.equal(same.make({ h: 2 }, 999).levels[0], a.levels[0], 'a build of the same numbers: the same array as before');
});

test('travel: a log keeps each sample\'s metres along its thing\'s track (appended, recorded, loaded)', async () => {
  const { history } = await import('../src/index.ts');
  const lat = -37.9, kx = 111320 * Math.cos((lat * Math.PI) / 180), lon = (m: number) => 145 + m / kx, t0 = Date.UTC(2026, 0, 1);
  const travelOf = (l: ReturnType<typeof history.log>, id: string) => { const i = l.ids.indexOf(id), k = l.values.findIndex((v) => v.name === 'travel'); return Array.from({ length: l.count[i]! }, (_, j) => Math.round(l.valueAt(k, l.slot(i, j)))); };
  const a = history.log({ travel: true, keep: Infinity });
  for (let j = 0; j < 4; j++) a.append('car', t0 + j * 10000, lon(j * 100), lat);
  a.append('bus', t0, lon(0), lat); a.append('bus', t0 + 10000, lon(0), lat + 250 / 111320);   // (the lib's metres: a sphere of 6,378,137 m)
  assert.deepEqual(travelOf(a, 'car'), [0, 100, 200, 300]); assert.deepEqual(travelOf(a, 'bus'), [0, 250]);
  const b = history.fromColumns({ ids: ['car'], count: [3], t: [t0, t0 + 1e4, t0 + 2e4], lon: [lon(0), lon(50), lon(150)], lat: [lat, lat, lat] }, { travel: true });
  assert.deepEqual(travelOf(b, 'car'), [0, 50, 150]);
  // saved without it, loaded with it: worked out once
  const plain = history.log({ keep: Infinity }); for (let j = 0; j < 3; j++) plain.append('car', t0 + j * 1e4, lon(j * 40), lat);
  const c = history.fromBytes(plain.toBytes(), { travel: true });
  assert.deepEqual(travelOf(c, 'car'), [0, 40, 80]);
});

test('priorities: the app\'s drop order first (an element by id: its own detail), the world\'s after; kept ones never', async () => {
  const { world, points } = await import('../src/index.ts');
  const w = await world(null, { budget: { drawCalls: 10 }, priorities: { drop: ['smoke'], keep: ['evs', 'quality'] } });
  const smoke = points({ id: 'smoke', data: [] }), evs = points({ id: 'evs', data: [] }), other = points({ id: 'other', data: [] });
  w.add(smoke, evs, other);
  const gov = (w as unknown as { gov: { frame(f: object): { dropped: string[] } | null } }).gov, over = { gapMs: 16, cpuMs: 1, gpuMs: null, draws: 50, triangles: 0, gpuMB: 0 };
  const steps: string[][] = []; for (let i = 0; i < 200 && steps.length < 6; i++) { const e = gov.frame(over); if (e) steps.push(e.dropped); }
  assert.deepEqual(steps.at(-1), ['smoke 0.75', 'smoke 0.5', 'smoke 0.25', 'detail 0.75', 'detail 0.5']);
  const s = (w as unknown as { state: import('../src/core/world/state.ts').State }).state;
  assert.equal(smoke.forced, null, 'never hidden'); assert.equal(smoke.detailOf(s), 0.125);
  assert.equal(evs.detailOf(s), 1, 'kept: the world\'s detail does not reach it'); assert.equal(other.detailOf(s), 0.5);
  // new priorities: everything given back, the ladder made again
  w.setPriorities({}); assert.equal(smoke.detailOwn, 1); assert.equal(evs.detailPinned, false);
  w.dispose();
});

test('copy round any axis: blades turned round a hub (z through it), the same as built one by one', async () => {
  const { shape } = await import('../src/index.ts');
  const hub: [number, number, number] = [0, 10, 2];
  const blade = (b: import('../src/core/geometry/shapes/builder.ts').Builder) => b.solid('box', { size: [0.4, 6, 0.2], at: [0, 13, 2] });
  const a = shape({ id: 'a', build: (b) => b.copy(blade, { repeat: 3, turn: 120, axis: 'z', at: hub }) }).make();
  const [lo, hi] = a.bounds.map((v) => v.map((x) => Math.round(x * 10) / 10)) as [number[], number[]], bounds = [lo, hi] as const, at = (v: number[], k: number) => v[k]!;
  // three blades of 6 m from a hub at 10 m: up to 16 m, down to 10 − 6 sin 30° … the tips round the hub
  assert.ok(Math.abs(at(hi, 1) - 16) < 0.2 && at(lo, 1) < 7.5 && at(lo, 1) > 6.5, JSON.stringify(bounds));
  assert.ok(Math.abs(at(lo, 0) + at(hi, 0)) < 0.2 && at(hi, 0) > 4.5, 'even round the hub');
  assert.ok(Math.abs(at(lo, 2) - 1.9) < 0.11 && Math.abs(at(hi, 2) - 2.1) < 0.11, 'in the hub\'s plane');
});

test('draws: every chunk\'s clones of a form drawn in one draw a level (not one a chunk); nothing written again while nothing changes; a chunk gone, its clones out of the lists; one texture holds every chunk\'s records, each naming its chunk', async () => {
  const { World } = await import('../src/core/world/world.ts');
  const { Camera } = await import('../src/core/observation/observers/orbit/camera.ts');
  const { Loader } = await import('../src/core/data/loading/loader.ts');
  const { solids } = await import('../src/core/geometry/shapes/solids.ts');
  const { shape, num } = await import('../src/index.ts');
  // stand-in graphics: what is written is counted, frames keep their draws
  const writes = new Map<string, number>(), textures: string[] = [], frames: { draws: import('../src/core/render/graphics/interface.ts').DrawCall[]; target: unknown }[] = [];
  let uid = 0;
  const g = {
    api: 'webgl2', caps: { api: 'webgl2', compute: false, timer: false, floatTargets: false, maxTex: 4096, maxLayers: 256, vertexTextures: 16, f16: false, device: 'stand-in' }, width: 200, height: 100, resize() {},
    buffer(kind: string, d: number | ArrayBufferView, label = '') { const b = { kind, label, size: typeof d === 'number' ? d : d.byteLength, uid: ++uid, version: 0, write() { b.version++; writes.set(label, (writes.get(label) ?? 0) + 1); }, destroy() {} }; return b; },
    texture(desc: { label?: string }) { textures.push(desc.label ?? ''); const t = { desc, write() { writes.set(desc.label ?? '', (writes.get(desc.label ?? '') ?? 0) + 1); }, writeImage() {}, destroy() {} }; return t; },
    target(width: number, height: number) { return { width, height, texture: g.texture({ label: 'target' }), destroy() {} }; }, layerTarget() { return { width: 1, height: 1, destroy() {} }; },
    readTexture: async () => new Uint8Array(4), program(desc: { label: string }) { return { label: desc.label, desc, ready: Promise.resolve(), ok: true, destroy() {} }; },
    frame(draws: never[], o: { target?: unknown; read?: boolean }) { frames.push({ draws: [...draws], target: o.target }); return o.read ? Promise.resolve(new Uint8Array(4 * 4096)) : null; },
    stats: { draws: 0, passes: 0, uploadBytes: 0, uploads: 0, gpuMs: null, uploadMaxMs: 0 }, lost: new Promise<string>(() => {}), bytes: 0, destroy() {},
  };
  const w = new World({ body: null, camera: new Camera(), loader: new Loader(), ownLoader: true, graphics: g as never, reason: 'stand-in', profile: null, canvas: { width: 200, height: 100 } as never, opts: { autostart: false, clock: { fps: 60 }, attribution: false } } as never);
  const settle = async (n = 3) => { await new Promise((ok) => setTimeout(ok, 0)); for (let i = 0; i < n; i++) w.step(1000 / 60); };
  const O: [number, number] = [145.12, -37.92];
  w.go({ lon: O[0] + 750 / 87900, lat: O[1] - 750 / 110574, zoom: 13, tilt: 0 });
  const s = solids({ id: 'farm', fade: 0 }); w.add(s); await settle();
  // two forms of a mast, 9 chunks of 500 m, 8 clones of each form a chunk
  const mast = shape({ id: 'mast', params: { h: num(1, 99, 10) }, build: (b, p) => b.solid('box', { size: [1, p.h, 1], at: [0, p.h / 2, 0] }) });
  const forms = [mast.make({ h: 10 }), mast.make({ h: 20 })], data = (k: number) => Float32Array.from({ length: 8 * 10 }, (_, i) => [50 + (i / 10 | 0) * 40, 250, 0, k * 8 + (i / 10 | 0), 1, 1, 1, 0, 0xffffff, 0][i % 10]!);
  for (let ix = 0; ix < 3; ix++) for (let iz = 0; iz < 3; iz++) s.put(`${ix}_${iz}`, { origin: O, at: [ix * 500, iz * 500], instances: forms.map((f, k) => ({ shape: f.levels as never, data: data(k) })), info: () => null });
  await settle();
  const sets = () => frames.at(-1)!.draws.filter((d) => d.program.label.includes('instances') && !d.shadowOnly);
  const n0 = sets().reduce((a, d) => a + (d.instanceCount ?? 1), 0);
  assert.ok(sets().length <= forms.length * 3, `one draw a form and level: ${sets().length} draws (one a chunk: 18)`);
  assert.equal(n0, 9 * 16, 'every clone of every chunk in them');
  assert.equal(textures.filter((t) => t === 'farm records').length, 1, 'one texture for every chunk\'s records');
  const slots = [0, 1, 2].map((k) => s.recordsOf(`${k}_0`, 0)!.rec[11]);
  assert.equal(new Set(slots).size, 3, `each chunk's records name its slot: ${slots}`);
  // nothing changes: nothing written again (the lists, the records, the chunks' tiles)
  const before = new Map(writes); await settle(4);
  for (const k of ['farm level 0', 'farm level 1', 'farm level 2', 'farm records']) assert.equal(writes.get(k) ?? 0, before.get(k) ?? 0, `${k}: written again while nothing changed`);
  // a chunk gone: its clones out of the lists, the same draws
  s.drop('1_1'); await settle();
  assert.equal(sets().reduce((a, d) => a + (d.instanceCount ?? 1), 0), 8 * 16, 'its 16 clones out');
  w.dispose();
});

test('smooth raw triangles: each corner the mean of the faces at its place within the crease, sharp past it; a shape\'s defaults by what is given', async () => {
  const { shape, num, choice, SHAPE_FLOATS } = await import('../src/index.ts');
  const { unpackNormal } = await import('../src/core/geometry/shapes/mesh.ts');
  // a roof of two slopes 20° apart (smooth across) on a wall 90° down from them (sharp)
  const P = (x: number, y: number, z: number) => [x, y, z] as [number, number, number], a = Math.tan((10 * Math.PI) / 180);
  const tris = [P(-1, 1, 0), P(0, 1 + a, 0), P(0, 1 + a, 1), P(-1, 1, 0), P(0, 1 + a, 1), P(-1, 1, 1), P(0, 1 + a, 0), P(1, 1, 0), P(1, 1, 1), P(0, 1 + a, 0), P(1, 1, 1), P(0, 1 + a, 1), P(1, 1, 0), P(1, 0, 0), P(1, 0, 1), P(1, 1, 0), P(1, 0, 1), P(1, 1, 1)];
  const normals = (smooth: boolean) => { const v = shape({ build: (b) => { b.mesh(tris, { smooth }); } }).make().levels[0] as Float32Array, out: Record<string, number[]> = {}; for (let i = 0; i < v.length; i += SHAPE_FLOATS) { const k = `${v[i]!.toFixed(2)},${v[i + 1]!.toFixed(2)}`; (out[k] ??= []).push(...unpackNormal(v[i + 3]!)); } return out; };
  const sm = normals(true), fl = normals(false);
  assert.ok(Math.abs(sm['0.00,1.18']![0]!) < 0.02 && Math.abs(fl['0.00,1.18']![0]!) > 0.15, 'the ridge: one normal straight up smooth, each slope its own flat');
  assert.ok(sm['1.00,0.00']!.every((v, i) => i % 3 !== 0 || Math.abs(v) > 0.99), 'the wall keeps its own normal (past the crease)');
  // defaults by what is given: a type brings its numbers, what is given stands over them
  const box = shape({ params: { kind: choice(['small', 'big'], 'small'), h: num(0.5, 5, 1) }, defaults: (g) => (g.kind === 'big' ? { h: 3 } : null), build: (b, p) => { b.solid('box', { size: [1, p.h, 1], at: [0, p.h / 2, 0] }); } });
  assert.equal(box.params({ kind: 'big' }).h, 3); assert.equal(box.params({ kind: 'big', h: 2 }).h, 2); assert.equal(box.params({}).h, 1);
});
