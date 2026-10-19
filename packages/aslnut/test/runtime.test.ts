import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Governor, type FrameSample, type GovernorRung } from '../src/core/runtime/budget/index.ts';
import { RemoteLog } from '../src/core/runtime/telemetry/index.ts';
import { Loader, MemoryStore } from '../src/core/data/loading/index.ts';
import { motionFrames, sunFrames, msPer } from '../src/core/runtime/frame.ts';
import { profileOf } from '../src/core/render/graphics/caps.ts';
import { Element } from '../src/core/world/element.ts';
import { world, points } from '../src/index.ts';
import type { Caps } from '../src/core/render/graphics/interface.ts';

const frame = (o: Partial<FrameSample> = {}): FrameSample => ({ gapMs: 16.7, cpuMs: 3, gpuMs: null, draws: 50, triangles: 1e5, gpuMB: 100, ...o });
/** a ladder of counters: what each rung dropped */
function ladder() {
  const level = { a: 0, b: 0 };
  const rungs: GovernorRung[] = [
    { name: 'a', down: () => (level.a < 2 ? `a ${++level.a}` : null), up: () => { level.a--; } },
    { name: 'b', down: () => (level.b < 1 ? `b ${++level.b}` : null), up: () => { level.b--; } },
  ];
  return { level, rungs };
}

test('the governor steps down after frames over the budget, one rung at a time, and back up with room', () => {
  const { level, rungs } = ladder();
  const g = new Governor({ frameMs: 16 }, { stepDownAfter: 5, stepUpAfter: 20 }, rungs);
  const events = [];
  for (let i = 0; i < 4; i++) assert.equal(g.frame(frame({ gapMs: 40 })), null, 'not before 5 frames over');
  const e = g.frame(frame({ gapMs: 40 }));
  assert.deepEqual(e && { step: e.step, dropped: e.dropped }, { step: 'down', dropped: ['a 1'] });
  for (let i = 0; i < 20; i++) { const x = g.frame(frame({ gapMs: 40 })); if (x) events.push(x); }
  assert.deepEqual(g.drops, ['a 1', 'a 2', 'b 1', ]);
  assert.deepEqual(level, { a: 2, b: 1 });
  // frames with room: back up, the last drop first
  let up = null; for (let i = 0; i < 20 && !up; i++) up = g.frame(frame());
  assert.equal(up?.step, 'up'); assert.deepEqual(g.drops, ['a 1', 'a 2']); assert.equal(level.b, 0);
  // a frame within the display's time but heavy work is no room
  for (let i = 0; i < 40; i++) assert.equal(g.frame(frame({ cpuMs: 12 })), null);
  g.reset(); assert.deepEqual(level, { a: 0, b: 0 }); assert.deepEqual(g.drops, []);
});
test('the governor measures only what the budget sets (draw calls here), and backs off a see-saw', () => {
  const { rungs } = ladder();
  const g = new Governor({ drawCalls: 100 }, { stepDownAfter: 2, stepUpAfter: 10 }, rungs);
  for (let i = 0; i < 5; i++) assert.equal(g.frame(frame({ gapMs: 200 })), null, 'slow frames: no frame budget set');
  g.frame(frame({ draws: 150 })); assert.equal(g.frame(frame({ draws: 150 }))?.step, 'down');
  let n = 0; while (!g.frame(frame({ draws: 10 })) && n < 100) n++; assert.equal(n, 9, 'up after 10 roomy frames');
  g.frame(frame({ draws: 150 })); g.frame(frame({ draws: 150 }));
  n = 0; while (!g.frame(frame({ draws: 10 })) && n < 100) n++; assert.equal(n, 19, 'undone soon: twice as long before the next step up');
});
test('remote log: batched JSON lines with the fields, info dropped at warn', async () => {
  const sent: string[] = [];
  const log = new RemoteLog({ url: '/log', fields: { page: 'p', build: 7 }, every: 10, send: (_u, body) => sent.push(body) });
  log.send('hb', { fps: 60 }); log.send('error', { msg: 'x' }, 'warn'); log.send('governor', { step: 'down' }, 'warn');
  await new Promise((ok) => setTimeout(ok, 30));
  assert.equal(sent.length, 1);
  const lines = sent[0]!.split('\n').map((l) => JSON.parse(l));
  assert.deepEqual(lines.map((l) => l.ev), ['error', 'governor']);
  assert.equal(lines[0].page, 'p'); assert.equal(lines[0].build, 7); assert.equal(typeof lines[0].sid, 'string');
  const info = new RemoteLog({ url: '/log', level: 'info', send: (_u, b) => sent.push(b) }); info.send('hb', { fps: 60 }); info.flush();
  assert.equal(JSON.parse(sent[1]!).ev, 'hb'); log.dispose(); info.dispose();
});
test('memory: an eviction score of your own keeps what it values', async () => {
  const body = new Uint8Array(100), calls: string[] = [];
  const f = (async (u: string) => { calls.push(String(u)); return new Response(body, { status: 200 }); }) as unknown as typeof fetch;
  const lru = new Loader({ store: new MemoryStore(), retries: 0, fetch: f, memory: 1000 });
  const mine = new Loader({ store: new MemoryStore(), retries: 0, fetch: f, memory: 1000, evict: (it) => (it.key.includes('keep') ? 1e9 : -it.seenMsAgo) });
  for (const l of [lru, mine]) { await l.get('https://x.test/keep.bin'); for (let i = 0; i < 12; i++) await l.get(`https://x.test/${i}.bin`); }
  calls.length = 0; await lru.get('https://x.test/keep.bin'); assert.equal(calls.length, 1, 'least seen: the first went');
  calls.length = 0; await mine.get('https://x.test/keep.bin'); assert.equal(calls.length, 0, 'scored high: kept');
  mine.setMemory(300); assert.ok(mine.stats().memory.bytes <= 300);
  lru.dispose(); mine.dispose();
});

test('materials: a wire sphere is its latitudes and longitudes (no quad diagonals), raw lines, ghosts and your own apart', async () => {
  const { shape, material, splitParts, shapeCode, SHAPE_FLOATS } = await import('../src/index.ts');
  const glow = material.custom({ uniforms: { gain: 2 }, fragment: 'color = vec4f(color.rgb * params.gain, 1.0);' });
  const s = shape({ id: 'mix', params: {}, build: (b) => {
    b.solid('box', { size: 1 });
    b.solid('sphere', { radius: 2, sides: 12, material: 'wire', at: [0, 3, 0] });
    b.mesh([[0, 0, 0], [0, 5, 0], [0, 5, 0], [1, 5, 0]], { lines: true });
    b.solid('box', { size: 1, at: [3, 0, 0], material: material('ghost', { opacity: 0.5 }) });
    b.solid('box', { size: 1, at: [-3, 0, 0], material: glow });
  } });
  const whole = s.make().levels[0] as Float32Array;
  const sp = splitParts(whole, SHAPE_FLOATS, shapeCode)!;
  assert.ok(sp, 'special parts found');
  assert.equal(sp.solid.length / SHAPE_FLOATS, 36, 'the plain box alone stays solid');
  // a 12-sided sphere of 6 bands: 12 meridians × 6 + 5 parallels × 12 = 132 edges (+ 2 raw segments)
  assert.equal(sp.lines!.length / SHAPE_FLOATS / 2, 132 + 2);
  assert.equal(sp.ghost!.length / SHAPE_FLOATS, 36);
  assert.equal(sp.custom.get(glow.code)!.length / SHAPE_FLOATS, 36);
  const plain = shape({ id: 'plain', params: {}, build: (b) => { b.solid('box', { size: 1 }); } }).make().levels[0] as Float32Array;
  assert.equal(splitParts(plain, SHAPE_FLOATS, shapeCode), null, 'nothing special: nothing split (no second program)');
});

test('draw on demand: the rates things ask for (a pixel a frame on screen, the sun 0.02° a frame), on a steady beat', () => {
  assert.equal(motionFrames(0), 0, 'nothing moving: no frames');
  assert.equal(motionFrames(2), 4, 'slow on screen: a few a second at the least');
  assert.equal(motionFrames(28), 28);
  assert.equal(motionFrames(28, { stepPx: 2 }), 14, 'a soft edge may step further');
  assert.equal(motionFrames(200), Infinity, 'fast: every display frame');
  assert.equal(sunFrames(0), 0); assert.equal(sunFrames(1), 1, 'real time: once a second at most (the world looks at the light itself)');
  assert.ok(sunFrames(60) > 12 && sunFrames(60) < 13, 'a minute a second: 12.5 frames a second');
  assert.equal(sunFrames(3600), Infinity);
  assert.equal(msPer(Infinity), 0); assert.equal(msPer(30), 1000 / 30);
});
test('the layer contract: a still layer asks for no frames; animating() is the short form of wantsFrames', () => {
  class Still extends Element { readonly kind = 'custom' as const; frame() { return []; } }
  class Pulse extends Still { override animating() { return true; } }
  class Far extends Still { override wantsFrames(_s: unknown) { return 10; } }
  const s = {} as never;
  assert.equal(new Still({ id: 'a' }).wantsFrames(s), 0);
  assert.equal(new Pulse({ id: 'b' }).wantsFrames(s), Infinity);
  assert.equal(new Far({ id: 'c' }).wantsFrames(s), 10);
});
test('auto quality and budget: the device picks (lite and a 22 ms budget on a phone, WebGL2 lite, a strong desktop realistic with none)', () => {
  const caps = (api: 'webgpu' | 'webgl2') => ({ api, compute: api === 'webgpu', timer: false, floatTargets: true, maxTex: 8192, maxLayers: 256, vertexTextures: 16, f16: false, device: '' }) as Caps;
  const phone = profileOf(caps('webgpu'), { touch: true, deviceMemory: 4, cores: 8 });
  assert.deepEqual([phone.quality, phone.tier, phone.budget, phone.why], ['lite', 'mid', { frameMs: 22 }, 'a touch device']);
  const desk = profileOf(caps('webgpu'), { touch: false, deviceMemory: 16, cores: 12 });
  assert.deepEqual([desk.quality, desk.tier, desk.budget], ['realistic', 'high', null]);
  const gl = profileOf(caps('webgl2'), { touch: false, deviceMemory: 16, cores: 12 });
  assert.deepEqual([gl.quality, gl.why, gl.budget], ['lite', 'the WebGL2 default', null]);
  const weak = profileOf(caps('webgpu'), { touch: false, deviceMemory: 2, cores: 4 });
  assert.deepEqual([weak.quality, weak.tier, weak.budget], ['lite', 'low', { frameMs: 22 }]);
  assert.equal(profileOf(caps('webgpu'), { touch: true, quality: 'realistic' }).quality, 'realistic', 'yours wins');
});
test('telemetry: each layer and what it wants, headless too (no graphics: no memory)', async () => {
  const w = await world(null, { view: { lon: 0, lat: 0, zoom: 3 } });
  w.add(points({ id: 'p', data: [{ id: 1, geometry: { type: 'Point', coordinates: [0, 0] }, props: {} }] as never }));
  w.step(16);
  const t = w.telemetry();
  assert.ok(t.elements.some((l) => l.id === 'p'));
  assert.equal(t.memoryMB, 0); assert.deepEqual(t.memory, []); assert.equal(t.budget, null, 'headless: no device, no budget');
  assert.equal(t.frames.resting, false); assert.equal(t.frames.wants, 0);
  const off = w.everyFrame(() => {}, { fps: 5 });
  assert.equal(typeof off, 'function'); off();
  w.dispose();
});
