// Live data: what changes while the rows stream and the camera follows. Cards make room with each other without
// blinking (the cards shown keep their room first, a loss only after a cover held, a return only after a while away),
// keep their decisions by item id when their items change, derive again only what changed (on the world's clock) and
// settle while rows stream; a row may show its item's text, each card as wide as it holds. A log value may be a step
// (never mixed between samples). A mark draped on the ground paints what lies on it, never what stands on it. A set
// keeps a folded thing in its near choice. Instances put only the chunks that changed. What a frame's draws hold is
// freed after the frame is drawn, and a source changed while it is made is told to its layers after.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world/world.ts';
import { Camera } from '../src/core/observation/observers/orbit/camera.ts';
import { Loader } from '../src/core/data/loading/loader.ts';
import { Element, type FrameContext } from '../src/core/world/element.ts';
import type { DrawCall, GBuffer, GTexture, Graphics, Program, ProgramDesc } from '../src/core/render/graphics/interface.ts';
import { cards, type Cards } from '../src/kits/dashboard/cards.ts';
import { history, Log } from '../src/core/data/history.ts';
import { derive, type Deriver } from '../src/core/data/channels.ts';
import { dataDrive, entities, type EntitySet } from '../src/core/entities/sets.ts';
import { setsWGSL } from '../src/core/render/graphics/shaders/sets.wgsl.ts';
import { setsGLSL } from '../src/core/render/graphics/shaders/sets.glsl.ts';
import { Rows } from '../src/core/data/sources/index.ts';
import { Entities } from '../src/core/geometry/shapes/instances.ts';
import { Solids } from '../src/core/geometry/shapes/solids.ts';
import { createWebGL2 } from '../src/core/render/graphics/webgl2.ts';
import type { Made } from '../src/core/geometry/shapes/shape.ts';
import type { Feature } from '../src/core/data/features.ts';

const L = 145.12, B = -37.92, T0 = Date.UTC(2026, 9, 19, 0, 0, 0), KZ = 6378137 * Math.PI / 180, kx = KZ * Math.cos(B * Math.PI / 180);
const at = (x: number, y: number): [number, number] => [L + x / kx, B + y / KZ];
const pt = (id: string, x: number, y: number, props: Record<string, unknown> = {}): Feature => ({ id, props, geometry: { type: 'Point', coordinates: at(x, y) } }) as Feature;

// ── a canvas for the pictures (node has none): text measured by its length, nothing drawn ──
class Canvas2D {
  font = ''; fillStyle = ''; textBaseline = ''; textAlign = ''; canvas: { width: number; height: number };
  constructor(canvas: { width: number; height: number }) { this.canvas = canvas; }
  measureText(t: string) { return { width: t.length * 7 }; }
  fillText() {} clearRect() {} drawImage() {}
  getImageData(_x: number, _y: number, w: number, h: number) { return { data: new Uint8ClampedArray(w * h * 4) }; }
}
(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas ??= class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h; } getContext() { return new Canvas2D(this); } };

// ── stand-in graphics: what is written kept, every frame kept (its draws, its target), hold() noted ──
let uid = 0;
interface FTex extends GTexture { label: string; data: ArrayBufferView | null; writes: number }
interface FBuf extends GBuffer { label: string; data: Float32Array | null }
function fakeGraphics() {
  const buffers: FBuf[] = [], textures: FTex[] = [], frames: { draws: DrawCall[]; target: { tex?: FTex } | undefined }[] = [], log: string[] = [];
  const g = {
    api: 'webgl2', caps: { api: 'webgl2', compute: false, timer: false, floatTargets: false, maxTex: 4096, maxLayers: 256, vertexTextures: 16, f16: false, device: 'stand-in' },
    width: 400, height: 300, resize(w: number, h: number) { g.width = w; g.height = h; },
    buffer(kind: string, sizeOrData: number | ArrayBufferView, label = '') {
      const b = { kind, size: typeof sizeOrData === 'number' ? sizeOrData : sizeOrData.byteLength, uid: ++uid, version: 0, label, data: null as Float32Array | null,
        write(d: ArrayBufferView) { b.data = d instanceof Float32Array ? Float32Array.from(d) : null; b.version++; }, destroy() { log.push(`destroy ${label}`); } };
      buffers.push(b as unknown as FBuf); return b as unknown as FBuf;
    },
    texture(desc: { label?: string; width: number; height: number }) { const t = { desc, label: desc.label ?? '', data: null as ArrayBufferView | null, writes: 0, write(d: ArrayBufferView) { t.data = d instanceof Float32Array ? Float32Array.from(d) : d instanceof Uint8Array ? Uint8Array.from(d) : null; t.writes++; }, writeImage() {}, destroy() {} }; textures.push(t as unknown as FTex); return t as unknown as FTex; },
    target(width: number, height: number) { return { width, height, texture: g.texture({ label: 'target', width, height }), destroy() {} }; },
    layerTarget(tex: FTex) { return { width: tex.desc.width, height: tex.desc.height, tex, destroy() {} }; },
    copyLayers: () => false,
    readTexture: async (t: FTex) => (t.data instanceof Uint8Array ? t.data : new Uint8Array(4 * 4096)),
    program(desc: ProgramDesc): Program { return { label: desc.label, desc, ready: Promise.resolve(), ok: true, destroy() {} } as Program; },
    frame(draws: DrawCall[], o: { target?: { tex?: FTex }; read?: boolean }) { frames.push({ draws: [...draws], target: o.target }); if (!o.target) log.push('frame'); return o.read ? Promise.resolve(new Uint8Array(4 * 4096)) : null; },
    hold(on: boolean) { log.push(`hold ${on}`); },
    stats: { draws: 0, passes: 0, uploadBytes: 0, uploads: 0, gpuMs: null, uploadMaxMs: 0 },
    lost: new Promise<string>(() => {}), bytes: 0, memory: () => [], destroy() {},
  };
  return { g: g as unknown as Graphics, buffers, textures, frames, log };
}
function standIn(view: { zoom?: number; tilt?: number } = {}) {
  const fg = fakeGraphics();
  const w = new World({ body: null, camera: new Camera(), loader: new Loader(), ownLoader: true, graphics: fg.g, reason: 'stand-in', profile: null, canvas: { width: 400, height: 300 } as never, opts: { autostart: false, clock: { fps: 60 }, attribution: false } });
  w.go({ lon: L, lat: B, zoom: view.zoom ?? 17, tilt: view.tilt ?? 0 });
  return { w, ...fg };
}
const steps = async (w: World, n = 3, ms = 1000 / 60) => { for (let i = 0; i < n; i++) { await new Promise((ok) => setTimeout(ok, 0)); w.step(ms); } };
const block = (fg: { buffers: FBuf[] }, id: string) => fg.buffers.find((b) => b.label === `${id} cards`)!.data!;
const tex = (fg: { textures: FTex[] }, label: string) => fg.textures.filter((t) => t.label === label).at(-1)!;
const progOf = (d: DrawCall) => (d.program as Program & { label: string }).label;

// ── kits.dashboard.cards ──────────────────────────────────────────────────────────────────────────────────────────
test('cards make room: the timing in their block (a share covered, for how long, the least time away, the fade), the claims drawn from the decisions just made, each set\'s cards shown before its rest', async () => {
  const fg = standIn(), { w } = fg;
  const sites = [pt('a', 0, 0, { name: 'A' }), pt('b', 4, 0, { name: 'B' }), pt('c', 30, 0, { name: 'C' })];
  w.add(cards({ id: 'low', of: sites, header: { text: (d: Feature) => String(d.props.name) } }), cards({ id: 'top', of: sites, header: { text: 'x' }, collide: { cover: 0.5, hold: 1 } }));
  await steps(w, 6);
  const low = block(fg, 'low'), top = block(fg, 'top');
  assert.deepEqual([...low.subarray(24, 28)].map((x) => +x.toFixed(3)), [0.35, 0.6, 1.5, 0.35], 'the defaults: more than 35 % covered for 0.6 s loses; back 1.5 s after at the soonest; faded 0.35 s');
  assert.deepEqual([...top.subarray(24, 28)].map((x) => +x.toFixed(3)), [0.5, 1, 1.5, 0.35], 'as given');
  assert.equal(low[28], 3, 'three texels an item (no text rows)');
  // (the room's one order: the top set first, each set's part two blocks of 2^18: its cards shown, then the rest)
  assert.equal(top[59], 1); assert.equal(low[59], 1 + 2 * 262144);
  // the claims of the frame read the decisions this frame's decide pass wrote
  let checked = 0;
  for (let k = 1; k < fg.frames.length; k++) {
    const f = fg.frames[k]!, d0 = f.draws[0]; if (!d0 || progOf(d0) !== 'cards low claim') continue;
    const dec = fg.frames.slice(0, k).reverse().find((x) => x.draws[0] && progOf(x.draws[0]) === 'cards low decide'); if (!dec) continue;
    if (fg.frames.indexOf(dec) < k - 3) continue;
    assert.ok(d0.textures!.includes(dec.target!.tex!), 'its claims by the decisions just made (the cards shown claim first)');
    checked++;
  }
  assert.ok(checked > 0, 'a decide then its claims, in one frame');
  w.dispose();
});

test('cards made again: decisions carried by item id (a carry pass, never decided again at once), values derived again only for what changed, on the world\'s clock; settled while rows stream', async () => {
  const fg = standIn(), { w } = fg;
  const rows = new Rows([{ id: 'a', lon: at(0, 0)[0], lat: B, name: 'A' }, { id: 'b', lon: at(10, 0)[0], lat: B, name: 'B' }]);
  const kw = history.log({ values: { kw: 'f32' } });
  for (const id of ['a', 'b']) { kw.append(id, T0, L, B, { kw: 1 }); kw.append(id, T0 + 60e3, L, B, { kw: 2 }); }
  w.setTime(new Date(T0 + 30e3));
  const c = cards({ id: 'kw', of: rows, log: kw, header: { text: (d: Feature) => String(d.props.name) }, rows: [{ label: 'kW', value: 'kw' }] });
  w.add(c); await steps(w, 8);
  // a row in front of the others: the items' order changes
  rows.upsert([{ id: 'z', lon: at(-10, 0)[0], lat: B, name: 'Z' }]);
  const n0 = fg.frames.length; await steps(w, 2);
  const after = fg.frames.slice(n0).map((f) => (f.draws[0] ? progOf(f.draws[0]) : ''));
  assert.ok(after.includes('cards kw carry'), `a carry pass after the items changed (${after.join(', ')})`);
  assert.ok(after.indexOf('cards kw carry') < after.lastIndexOf('cards kw decide') || !after.includes('cards kw decide'), 'carried before it decides');
  assert.equal(block(fg, 'kw')[67], 0, 'not decided again at once (no first decision for every card)');
  const ids = (c as Cards<Feature>).ids, it = tex(fg, 'kw items').data as Float32Array;
  const old = ids.map((_, i) => it[i * 12 + 10]! - 1);
  assert.deepEqual(ids.map((id, i) => [id, old[i]]), [['a', 0], ['b', 1], ['z', -1]], 'each item\'s decision found by its id (a new one: none, decided when its claims are in)');
  // a row gone a moment, then given again: its decision kept meanwhile (after the items), found again
  rows.remove('a'); await steps(w, 3);
  const gone = tex(fg, 'kw items').data as Float32Array;
  assert.deepEqual([...(c as Cards<Feature>).ids], ['b', 'z']);
  assert.equal(gone[2 * 12 + 10], 1, 'its decision kept after the items (from its place before)');
  assert.equal(block(fg, 'kw')[29], 3, 'three places of decisions: two items, one gone a moment');
  rows.upsert([{ id: 'a', lon: at(0, 0)[0], lat: B, name: 'A' }]); await steps(w, 3);
  const back = tex(fg, 'kw items').data as Float32Array;
  assert.deepEqual([...(c as Cards<Feature>).ids], ['b', 'z', 'a']);
  assert.equal(back[2 * 12 + 10]! - 1, 2, 'given again within the time away: its decision found where it was kept');
  await steps(w, 120, 20);
  rows.remove('a'); await steps(w, 3); await steps(w, 100, 20); rows.upsert([{ id: 'a', lon: at(0, 0)[0], lat: B, name: 'A' }]); await steps(w, 3);
  assert.equal((tex(fg, 'kw items').data as Float32Array)[2 * 12 + 10], 0, 'after longer: a new card');
  // a value of one item's thing changes: only it derived again, the pictures kept
  const texts = tex(fg, 'kw texts'), w0 = texts.writes;
  kw.append('b', T0 + 61e3, L, B, { kw: 3 });
  await steps(w, 40);
  const der = (c as unknown as { deriver: Deriver<Feature> }).deriver;
  assert.equal(der.remade, 1, 'one item derived again');
  assert.equal(texts.writes, w0, 'its pictures not made again');
  // (on the world's clock: a log changed, then nothing for 0.5 s of it)
  kw.append('a', T0 + 62e3, L, B, { kw: 5 });
  const make = c as unknown as { make: (whole?: boolean) => void }, was = make.make.bind(c); let made = 0; make.make = (wh?: boolean) => { made++; was(wh); };
  await steps(w, 10, 10);
  assert.equal(made, 0, 'not within 0.5 s of the world\'s clock');
  await steps(w, 50, 10);
  assert.equal(made, 1, 'once after');
  // rows streaming (one every 0.2 s): the cards settle between them
  let settledSeen = 0;
  for (let k = 0; k < 20; k++) { rows.upsert([{ id: 'a', lon: at(0, 0)[0], lat: B, name: `A${k}` }]); await steps(w, 12, 1000 / 60); if (!w.report().pending.some((p) => p.includes('making room'))) settledSeen++; }
  assert.ok(settledSeen > 10, `settled between the rows (${settledSeen} of 20: ${w.report().pending.join('; ')})`);
  w.dispose();
});

test('cards: a row of its item\'s text, each card as wide as it holds (fit)', async () => {
  const fg = standIn(), { w } = fg;
  const people = [pt('a', 0, 0, { name: 'Al', job: 'baker' }), pt('b', 20, 0, { name: 'Bartholomew Longname', job: 'a very long job title here' })];
  w.add(cards({ id: 'who', of: people, header: { text: (d: Feature) => String(d.props.name) }, rows: [{ label: 'job', text: (d: Feature) => String(d.props.job) }, { label: 'n', value: 3 }], fit: true }));
  await steps(w, 4);
  const u = block(fg, 'who'), it = tex(fg, 'who items').data as Float32Array;
  assert.equal(u[28], 5, 'five texels an item: three, and two for its text row');
  assert.deepEqual([...u.subarray(76, 80)], [-2, 0, 0, 0], 'the text row: −2, its picture\'s slot');
  assert.equal(u[80], 0, 'the value row reads its channel');
  const wide = [it[11]!, it[5 * 4 + 11]!];
  assert.ok(wide[0]! >= 60 && wide[0]! < 120, `a short name and job: narrower than the size (${wide[0]})`);
  assert.ok(wide[1]! > 120 && wide[1]! <= 240, `a long one: wider, within twice the size (${wide[1]})`);
  for (const i of [0, 1]) assert.ok(it[i * 20 + 16]! > 0 && it[i * 20 + 17]! > 0, 'its text row\'s picture, its size');
  assert.throws(() => cards({ id: 'x', of: people, rows: [{ label: 'none' }] }), /shows nothing/);
  w.dispose();
});

// ── core.data.history.log ─────────────────────────────────────────────────────────────────────────────────────────
test('log: a step value is never mixed between samples (read, derived, on the chip)', () => {
  const log = history.log({ values: { state: { type: 'f32', step: true }, level: 'f32' } });
  log.append('m', T0, L, B, { state: 1, level: 0 }); log.append('m', T0 + 10e3, L, B, { state: 5, level: 10 });
  const s = log.at('m', T0 + 5e3)!;
  assert.equal(s.values.state, 1, 'held until its next sample');
  assert.equal(s.values.level, 5, 'a value of no step mixed');
  assert.equal(Log.fromBytes(log.toBytes()).values.find((v) => v.name === 'state')!.step, true, 'kept by a save');
  // derived: two samples at the step's time, held between
  const cols = derive([{ id: 'm' }], { st: 'state', lv: 'level' }, { log });
  assert.equal(cols.at('m', T0 + 5e3)!.values.st, 1); assert.equal(cols.at('m', T0 + 9.9e3)!.values.st, 1); assert.equal(cols.at('m', T0 + 10e3)!.values.st, 5);
  assert.ok(Math.abs(cols.at('m', T0 + 5e3)!.values.lv! - 5) < 1e-6);
  // a set coloured by it: its programs hold it
  const set = entities({ id: 'm', drive: dataDrive(log), color: { value: 'state', ramp: 'viridis', domain: [0, 6] } }) as EntitySet;
  const v = (set as unknown as { variant(): { step?: boolean } }).variant();
  assert.equal(v.step, true);
  assert.match(setsWGSL('dots', v as never), /const STEP: i32 = 1;/); assert.match(setsGLSL('dots', v as never).vertex, /const int STEP = 1;/);
  const v2 = (entities({ id: 'n', drive: dataDrive(log), color: { value: 'level', ramp: 'viridis' } }) as unknown as { variant(): { step?: boolean } }).variant();
  assert.equal(v2.step, undefined);
});

// ── core.encoding.marks.drape ─────────────────────────────────────────────────────────────────────────────────────
class Probe extends Element {
  readonly kind = 'custom' as const; private prog: Program | null = null; private calls: Partial<DrawCall>[];
  constructor(p: { id: string; order: number }, calls: Partial<DrawCall>[]) { super(p); this.calls = calls; }
  override async attach(ctx: Parameters<Element['attach']>[0]) { await super.attach(ctx); this.prog = ctx.graphics!.program({ label: this.id, wgsl: '', glsl: { vertex: '', fragment: '' }, blocks: ['Frame'] }); }
  frame(ctx: FrameContext): DrawCall[] { return this.prog ? this.calls.map((c, i) => ({ program: this.prog!, blocks: [ctx.frame], count: 3, label: `${this.id}${i}`, ...c }) as DrawCall) : []; }
}
test('drape: a mark on the ground paints what lies on the ground (roads, paths), never what stands on it (benches, trees): its parts drawn before them', async () => {
  const fg = standIn(), { w } = fg;
  // (a body: an element that stands, its draws not marked one by one)
  class Body extends Probe { readonly stands = true; }
  w.add(new Probe({ id: 'bench', order: 4 }, [{ stands: true }]), new Body({ id: 'body', order: 4 }, [{}]), new Probe({ id: 'road', order: 4 }, [{}]), new Probe({ id: 'rug', order: 2 }, [{}, { upper: 'ground' }]), new Probe({ id: 'choropleth', order: 2 }, [{}, { upper: true }]));
  await steps(w, 3);
  const main = fg.frames.filter((f) => !f.target).at(-1)!, order = main.draws.map((d) => `${(d as { label?: string }).label}${d.keepDepth ? '*' : ''}`);
  const i = (s: string) => order.findIndex((x) => x.startsWith(s));
  assert.ok(i('road0') < i('rug1') && i('rug1') < i('bench0') && i('rug1') < i('body0'), `the rug's part after the road, before the bench and the body (${order.join(' ')})`);
  assert.ok(i('bench0') < i('choropleth1'), 'a mark over everything after everything standing');
  assert.equal(order.filter((x) => x.endsWith('*')).length, 1, 'the terrain\'s depth kept once');
  assert.ok(order[i('rug0')]!.endsWith('*'), 'before the first draw after the ground');
  // what stands says so: the twin's solids (and an instance set), unless they lie on the ground
  assert.equal(new Solids({ id: 's' }).stands, true);
  w.dispose();
});

// ── core.entities.sets.sets ───────────────────────────────────────────────────────────────────────────────────────
const SHAPE = { levels: [new Float32Array(0), null, null], bounds: [[-1, 0, -1], [1, 2, 1]], size: null, parts: [], anchors: [] } as unknown as Made;
test('sets: a thing folded into another stays in the near choice (the chip hides it): it stands up drawn, never waiting for the next choice', async () => {
  const fg = standIn({ zoom: 20 }), { w } = fg;
  const log = history.log();
  for (const id of ['p', 'q']) { log.append(id, T0, ...at(id === 'p' ? 0 : 3, 0)); log.append(id, T0 + 60e3, ...at(id === 'p' ? 0 : 3, 0)); }
  const fold = history.relations([{ of: 'p', to: 'bench', from: T0 + 10e3, until: T0 + 20e3 }]);
  w.setTime(new Date(T0 + 15e3));
  const set = entities({ id: 'people', drive: dataDrive(log), shape: SHAPE, fold, near: { pixels: 0.01 } }) as EntitySet;
  w.add(set); await steps(w, 4);
  const s = set as unknown as { lvOf: Uint8Array; foldedNow(i: number, sec: number): boolean; sec: number };
  assert.equal(s.foldedNow(log.indexOf('p'), s.sec), true, 'p sits');
  assert.notEqual(s.lvOf[log.indexOf('p')], 255, 'kept in the near choice while it sits');
  assert.notEqual(s.lvOf[log.indexOf('q')], 255);
  w.dispose();
});

// ── core.geometry.shapes.instances ────────────────────────────────────────────────────────────────────────────────
test('instances: rows that come and go put only their chunks again (the others kept as they are), and never dissolve in', async () => {
  const fg = standIn(), { w } = fg;
  const rows = new Rows([{ id: 'a', lon: at(0, 0)[0], lat: B }, { id: 'b', lon: at(1200, 0)[0], lat: B }]);
  const bins = new Entities({ id: 'bins', shape: { id: 'bin', make: () => SHAPE } as never, data: rows as never });
  const puts: string[] = [], put = bins.put.bind(bins); bins.put = (k, s) => { puts.push(k); return put(k, s); };
  w.add(bins); await steps(w, 3);
  const keys = [...puts]; assert.equal(keys.length, 2, 'two chunks');
  const chunks = (bins as unknown as { chunks: Map<string, { born: number }> }).chunks, born = new Map([...chunks].map(([k, c]) => [k, c.born]));
  puts.length = 0; await steps(w, 20);
  // a row moved within its chunk, then one in a new chunk
  rows.upsert([{ id: 'a', lon: at(2, 0)[0], lat: B }]); await steps(w, 2);
  assert.deepEqual(puts, [keys[0]], 'only its chunk put again');
  assert.equal(chunks.get(keys[0]!)!.born, born.get(keys[0]!), 'kept as it was (no dissolve)');
  puts.length = 0;
  rows.upsert([{ id: 'c', lon: at(0, 1500)[0], lat: at(0, 1500)[1] }]); await steps(w, 2);
  assert.equal(puts.length, 1, 'only the new chunk');
  assert.ok(chunks.get(puts[0]!)!.born < -1e8, 'shown at once');
  rows.remove('c'); await steps(w, 2);
  assert.equal(chunks.size, 2, 'its chunk taken away');
  w.dispose();
});

// ── core.runtime.frame ────────────────────────────────────────────────────────────────────────────────────────────
test('frame: what your everyFrame work frees is freed after the frame its draws were gathered for is drawn', async () => {
  const fg = standIn(), { w, log } = fg;
  let held: GBuffer | null = null, n = 0;
  const rows = new Rows<{ id: string; lon: number; lat: number; n?: number }>([{ id: 'a', lon: L, lat: B }]); rows.watch(() => log.push('told'));
  w.add(new Probe({ id: 'p', order: 4 }, [{}]));
  w.everyFrame(() => { held?.destroy(); held = fg.g.buffer('vertex', 64, 'replaced'); rows.upsert([{ id: 'a', lon: L, lat: B, n: ++n }]); rows.upsert([{ id: 'a', lon: L, lat: B, n: ++n }]); });
  await steps(w, 3);
  const k = log.lastIndexOf('destroy replaced');
  assert.ok(k > 0, 'freed in the work');
  assert.equal(log.slice(0, k).lastIndexOf('hold true') > log.slice(0, k).lastIndexOf('hold false'), true, 'while the frame is held');
  assert.ok(log.indexOf('frame', k) > k && log.indexOf('hold false', k) > log.indexOf('frame', k), 'the frame drawn, then the hold let go');
  // a source changed in the work: its layers told once the frame is drawn, once however often it changed
  const f = log.indexOf('frame', k), tk = log.indexOf('told', k);
  assert.ok(tk > f, `told after the frame is drawn (${log.slice(k, k + 6).join(', ')})`);
  assert.equal(log.slice(k, log.indexOf('hold true', k) < 0 ? undefined : log.indexOf('hold true', k)).filter((x) => x === 'told').length, 1, 'once');
  assert.equal(rows.get('a')!.props.n, n, 'its rows themselves at once');
  rows.upsert([{ id: 'a', lon: L, lat: B, n: 0 }]); assert.equal(log.at(-1), 'told', 'outside a frame: told at once');
  // what records every row (drive.data) is told of each change at once, in a frame too: no row lost
  const live = new Rows<{ id: string; lon: number; lat: number; t: number; v: number }>([]), rec = dataDrive(live, { time: (d) => Number(d.props.t) });
  await rec.start({ loader: new Loader(), error: (e) => { throw e; } });
  let k2 = 0; w.everyFrame(() => { for (let j = 0; j < 3; j++) { k2++; live.upsert([{ id: 'r', lon: L, lat: B, t: T0 + k2 * 1000, v: k2 }]); } });
  await steps(w, 2);
  assert.equal(rec.log.count[rec.log.indexOf('r')], k2, `every row a sample (${k2})`);
  // WebGL2: what is destroyed while held is deleted when the hold ends
  const calls: string[] = [];
  const gl = new Proxy({}, { get: (_t, key) => (typeof key === 'string' && /^[A-Z0-9_]+$/.test(key) ? 1 : (...a: unknown[]) => { calls.push(String(key)); return key === 'getParameter' ? 4096 : key === 'getExtension' ? null : key === 'getShaderParameter' || key === 'getProgramParameter' ? true : {}; }) });
  const g = createWebGL2({ width: 4, height: 4, getContext: () => gl, addEventListener() {} } as unknown as HTMLCanvasElement);
  g.hold!(true);
  const b = g.buffer('vertex', 64, 'x'), t = g.texture({ width: 4, height: 4, format: 'rgba8' });
  b.destroy(); t.destroy();
  assert.equal(calls.filter((c) => c === 'deleteBuffer' || c === 'deleteTexture').length, 0, 'nothing deleted while held');
  g.hold!(false);
  assert.deepEqual(calls.filter((c) => c === 'deleteBuffer' || c === 'deleteTexture'), ['deleteBuffer', 'deleteTexture'], 'deleted when let go');
  b.destroy(); assert.equal(calls.filter((c) => c === 'deleteBuffer').length, 1, 'once');
  const b2 = g.buffer('vertex', 64, 'y'); b2.destroy(); assert.equal(calls.filter((c) => c === 'deleteBuffer').length, 2, 'not held: at once');
  w.dispose();
});
