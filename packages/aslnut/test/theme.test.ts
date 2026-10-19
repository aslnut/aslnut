// core › render › style › theme (an analysis view) and the solids' selected colour (core › interaction › signals ›
// selection), on a world with stand-in graphics (no chip: what the world hands the graphics is what is checked):
// no theme costs nothing; the muting is in every program that draws the world's colours, WGSL and GLSL alike; a
// theme's subjects draw with a frame block that mutes nothing; the selection keeps its colour under a theme.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world/world.ts';
import { Camera } from '../src/core/observation/observers/orbit/camera.ts';
import { Loader } from '../src/core/data/loading/loader.ts';
import { Element, type FrameContext } from '../src/core/world/element.ts';
import type { DrawCall, GBuffer, Graphics, Program, ProgramDesc } from '../src/core/render/graphics/interface.ts';
import { FRAME_FLOATS } from '../src/core/render/graphics/interface.ts';
import { theme, THEMES, ThemeState } from '../src/core/render/style/theme.ts';
import { solids } from '../src/core/geometry/shapes/solids.ts';
import { MeshBuilder } from '../src/core/geometry/shapes/mesh.ts';
import { makeState } from '../src/core/world/state.ts';
import * as S from '../src/core/render/graphics/shaders/index.ts';
import { SOLID_WGSL } from '../src/core/render/graphics/shaders/solid.wgsl.ts';
import { SOLID_GLSL } from '../src/core/render/graphics/shaders/solid.glsl.ts';
import { SOLID_INST_WGSL } from '../src/core/render/graphics/shaders/solid-inst.wgsl.ts';
import { SOLID_INST_GLSL } from '../src/core/render/graphics/shaders/solid-inst.glsl.ts';
import { IMPOSTOR_WGSL } from '../src/core/render/graphics/shaders/impostor.wgsl.ts';
import { IMPOSTOR_GLSL } from '../src/core/render/graphics/shaders/impostor.glsl.ts';
import { skinWGSL } from '../src/core/render/graphics/shaders/skin.wgsl.ts';
import { skinGLSL } from '../src/core/render/graphics/shaders/skin.glsl.ts';
import { SURFACE_WGSL } from '../src/core/render/graphics/shaders/surface.wgsl.ts';
import { SURFACE_GLSL } from '../src/core/render/graphics/shaders/surface.glsl.ts';
import { AREA_WGSL } from '../src/core/render/graphics/shaders/area.wgsl.ts';
import { AREA_GLSL } from '../src/core/render/graphics/shaders/area.glsl.ts';
import { AREA_DRAPE_WGSL } from '../src/core/render/graphics/shaders/area-drape.wgsl.ts';
import { AREA_DRAPE_GLSL } from '../src/core/render/graphics/shaders/area-drape.glsl.ts';
import { AREA_TILE_WGSL } from '../src/core/render/graphics/shaders/area-tile.wgsl.ts';
import { AREA_TILE_GLSL } from '../src/core/render/graphics/shaders/area-tile.glsl.ts';
import { LINE_WGSL } from '../src/core/render/graphics/shaders/line.wgsl.ts';
import { ARC_WGSL } from '../src/core/render/graphics/shaders/arc.wgsl.ts';
import { ARC_GLSL } from '../src/core/render/graphics/shaders/arc.glsl.ts';
import { LINE_GLSL } from '../src/core/render/graphics/shaders/line.glsl.ts';
import { LINE_DRAPE_WGSL } from '../src/core/render/graphics/shaders/line-drape.wgsl.ts';
import { LINE_DRAPE_GLSL } from '../src/core/render/graphics/shaders/line-drape.glsl.ts';
import { LINE_TILE_WGSL } from '../src/core/render/graphics/shaders/line-tile.wgsl.ts';
import { LINE_TILE_GLSL } from '../src/core/render/graphics/shaders/line-tile.glsl.ts';
import { EXTRUSION_WGSL } from '../src/core/render/graphics/shaders/extrusion.wgsl.ts';
import { EXTRUSION_GLSL } from '../src/core/render/graphics/shaders/extrusion.glsl.ts';
import { POINTS_WGSL } from '../src/core/render/graphics/shaders/points.wgsl.ts';
import { POINTS_GLSL } from '../src/core/render/graphics/shaders/points.glsl.ts';
import { TEXT_WGSL } from '../src/core/render/graphics/shaders/text.wgsl.ts';
import { TEXT_GLSL } from '../src/core/render/graphics/shaders/text.glsl.ts';
import { CUSTOM_WGSL } from '../src/core/render/graphics/shaders/custom.wgsl.ts';
import { CUSTOM_GLSL } from '../src/core/render/graphics/shaders/custom.glsl.ts';
import { CUSTOM_MESH_WGSL } from '../src/core/render/graphics/shaders/custom-mesh.wgsl.ts';
import { CUSTOM_MESH_GLSL } from '../src/core/render/graphics/shaders/custom-mesh.glsl.ts';
import { FIELD_SURFACE_WGSL } from '../src/core/render/graphics/shaders/field-surface.wgsl.ts';
import { FIELD_SURFACE_GLSL } from '../src/core/render/graphics/shaders/field-surface.glsl.ts';
import { RAIN_WGSL } from '../src/core/render/graphics/shaders/rain.wgsl.ts';
import { RAIN_GLSL } from '../src/core/render/graphics/shaders/rain.glsl.ts';
import { STARS_WGSL } from '../src/core/render/graphics/shaders/stars.wgsl.ts';
import { STARS_GLSL } from '../src/core/render/graphics/shaders/stars.glsl.ts';
import { SKY_WGSL } from '../src/core/render/graphics/shaders/sky.wgsl.ts';
import { SKY_GLSL } from '../src/core/render/graphics/shaders/sky.glsl.ts';

// ── stand-in graphics: buffers and textures keep what is written, frames keep their draws ──
let uid = 0;
interface FakeBuffer extends GBuffer { label: string; data: Float32Array | null; writes: number }
function fakeGraphics() {
  const buffers: FakeBuffer[] = [], textures: { label: string; data: Uint8Array | null }[] = [], frames: { draws: DrawCall[]; target: unknown }[] = [];
  const g = {
    api: 'webgl2', caps: { api: 'webgl2', compute: false, timer: false, floatTargets: false, maxTex: 4096, maxLayers: 256, vertexTextures: 16, f16: false, device: 'stand-in' },
    width: 200, height: 100, resize(w: number, h: number) { g.width = w; g.height = h; },
    buffer(kind: string, sizeOrData: number | ArrayBufferView, label = '') {
      const b: FakeBuffer = { kind, size: typeof sizeOrData === 'number' ? sizeOrData : sizeOrData.byteLength, uid: ++uid, version: 0, label, data: null, writes: 0,
        write(d: ArrayBufferView) { b.data = d instanceof Float32Array ? Float32Array.from(d) : null; b.writes++; (b as { version: number }).version++; }, destroy() {} } as FakeBuffer;
      buffers.push(b); return b;
    },
    texture(desc: { label?: string }) { const t = { desc, label: desc.label ?? '', data: null as Uint8Array | null, write(d: ArrayBufferView) { t.data = d instanceof Uint8Array ? Uint8Array.from(d) : null; }, writeImage() {}, destroy() {} }; textures.push(t); return t; },
    target(width: number, height: number) { return { width, height, texture: g.texture({ label: 'target' }), destroy() {} }; },
    layerTarget() { return { width: 1, height: 1, destroy() {} }; },
    readTexture: async () => new Uint8Array(4),
    program(desc: ProgramDesc): Program { return { label: desc.label, desc, ready: Promise.resolve(), ok: true, destroy() {} } as Program; },
    frame(draws: DrawCall[], o: { target?: unknown; read?: boolean }) { frames.push({ draws: [...draws], target: o.target }); return o.read ? Promise.resolve(new Uint8Array(4 * 4096)) : null; },
    stats: { draws: 0, passes: 0, uploadBytes: 0, uploads: 0, gpuMs: null, uploadMaxMs: 0 },
    lost: new Promise<string>(() => {}), bytes: 0, destroy() {},
  };
  return { g: g as unknown as Graphics, buffers, textures, frames };
}
/** a world drawn by the stand-in graphics (a fixed clock, nothing started) */
function standIn(o: { theme?: ReturnType<typeof theme.dark> | null } = {}) {
  const fg = fakeGraphics();
  const w = new World({ body: null, camera: new Camera(), loader: new Loader(), ownLoader: true, graphics: fg.g, reason: 'stand-in', profile: null, canvas: { width: 200, height: 100 } as never, opts: { autostart: false, clock: { fps: 60 }, attribution: false, theme: o.theme } });
  w.go({ lon: 145.12, lat: -37.92, zoom: 16, tilt: 40 });
  return { w, ...fg };
}
/** a layer that draws one call over the frame block it is given (and keeps which one) */
class Probe extends Element {
  readonly kind = 'custom' as const; frames: GBuffer[] = [];
  private prog: Program | null = null;
  override async attach(ctx: Parameters<Element['attach']>[0]) { await super.attach(ctx); this.prog = ctx.graphics!.program({ label: this.id, wgsl: '', glsl: { vertex: '', fragment: '' }, blocks: ['Frame'] }); }
  frame(ctx: FrameContext): DrawCall[] { this.frames.push(ctx.frame); return this.prog ? [{ program: this.prog, blocks: [ctx.frame], count: 3, pickProgram: () => this.prog! }] : []; }
}
const frameData = (w: World) => (w.renderer as unknown as { frameData: Float32Array }).frameData;
const settle = async (w: World, n = 2) => { await new Promise((ok) => setTimeout(ok, 0)); for (let i = 0; i < n; i++) w.step(1000 / 60); };

test('theme: none set costs nothing (no muting in the frame block, no second frame block, the same draws)', async () => {
  const { w, buffers, frames } = standIn();
  const base = new Probe({ id: 'base' }), data = new Probe({ id: 'data', subject: true });
  w.add(base, data); await settle(w);
  assert.equal(FRAME_FLOATS, 112, 'the frame block carries the theme: 3 vec4 more');
  assert.deepEqual([...frameData(w).subarray(100, 112)], [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0], 'no theme: its floats are 0 (the shaders return the colour at once)');
  assert.equal(buffers.filter((b) => b.label.includes('subjects')).length, 0, 'no frame block of its own for subjects');
  assert.equal(data.frames.at(-1), base.frames.at(-1), 'a layer marked subject draws with the frame block as every layer');
  assert.equal(w.theme, null); assert.equal(w.themeNow, null);
  assert.equal((w as unknown as { themeS: ThemeState }).themeS.key(), '', 'marks on the ground tiles keep their versions');
  const before = frames.at(-1)!.draws.length;
  // a theme whose `when` is off: registered, nothing muted, nothing more made
  w.setTheme(theme.dark({ when: false, seconds: 0 })); await settle(w);
  assert.equal(frameData(w)[107], 0, 'a theme gated off mutes nothing');
  assert.equal(buffers.filter((b) => b.label.includes('subjects')).length, 0, 'gated off: still no second frame block');
  assert.equal(frames.at(-1)!.draws.length, before, 'the same draws');
  w.dispose();
});

test('theme: on, everything but its subjects is muted; the subjects draw with a frame block that mutes nothing; no extra draws', async () => {
  const { w, buffers, frames } = standIn();
  const base = new Probe({ id: 'base' }), data = new Probe({ id: 'data' }), mine = new Probe({ id: 'mine', subject: true });
  w.add(base, data, mine); await settle(w);
  const drawsOff = frames.at(-1)!.draws.length;
  w.setTheme(theme.grey({ subjects: ['data'], seconds: 0 })); await settle(w);
  const f = frameData(w), g = THEMES.grey;
  assert.equal(f[107], 1, 'muting fully');
  assert.deepEqual([f[104], f[105], f[106]].map((x) => +x!.toFixed(3)), [g.grey, g.brightness, g.contrast], 'grey, brightness, contrast as the preset says');
  const sub = buffers.find((b) => b.label.includes('subjects'))!;
  assert.ok(sub, 'one frame block for the subjects');
  assert.equal(data.frames.at(-1), sub, 'a subject named by the theme draws with it');
  assert.equal(mine.frames.at(-1), sub, 'a layer whose subject prop is true too');
  assert.notEqual(base.frames.at(-1), sub, 'the rest with the muted one');
  assert.equal(sub.data![107], 0, 'the subjects\' block mutes nothing');
  assert.deepEqual([...sub.data!.subarray(0, 100)], [...f.subarray(0, 100)], 'otherwise this very frame');
  assert.equal(frames.at(-1)!.draws.length, drawsOff, 'no extra draws');
  // picking draws the subjects' ids with the picking frame block (not the subjects' own, which draws colours)
  await w.pick(100, 50);
  const pick = [...frames].reverse().find((x) => x.target)!;
  assert.ok(pick.draws.length >= 3 && pick.draws.every((d) => d.blocks[0] !== sub), 'picking: every draw on the picking frame block');
  w.dispose();
});

test('theme: eased in over its seconds, from one theme to another, eased out and gone; its `when` gates it', async () => {
  const t = new ThemeState(), s = makeState({ view: { lon: 145, lat: -37.9, zoom: 16 } }), toggles: Record<string, boolean> = {};
  const st = makeState({ view: { lon: 145, lat: -37.9, zoom: 16 }, user: { toggles } });
  t.set(theme.dark({ seconds: 1 }));
  const ks: number[] = []; for (let i = 0; i < 90; i++) { t.step(1000 / 60, s); ks.push(t.amount); }
  assert.ok(ks[5]! > 0 && ks[5]! < 0.5, `easing in: ${ks[5]}`); assert.equal(ks.at(-1), 1, 'in after its seconds'); assert.equal(t.easing, false, 'still: no frames asked for');
  assert.ok(ks.every((k, i) => i === 0 || k >= ks[i - 1]!), 'monotonic');
  const sky = t.sky!; assert.equal(sky.amount, 1); assert.deepEqual(sky.color.map((x) => +x.toFixed(3)), [0.082, 0.11, 0.157], 'the dark sky: #151c28');
  // to grey: the settings ease across, the amount stays
  t.set(theme.grey({ seconds: 0.5 })); const f = new Float32Array(8);
  t.step(1000 / 60, s); t.write(f, 0); assert.ok(f[5]! > THEMES.dark.brightness! && f[5]! < 1, `brightness on its way: ${f[5]}`); assert.equal(f[7], 1);
  for (let i = 0; i < 60; i++) t.step(1000 / 60, s);
  t.write(f, 0); assert.equal(+f[5]!.toFixed(3), 1, 'grey\'s brightness');
  // out: eased to 0, then no theme at all
  t.set(null); t.step(1000 / 60, s); assert.ok(t.amount < 1 && t.amount > 0 && t.easing);
  for (let i = 0; i < 60; i++) t.step(1000 / 60, s);
  assert.equal(t.amount, 0); assert.equal(t.shownTheme, null); assert.equal(t.key(), '', 'gone: the ground tiles\' marks as without it');
  // gated by a toggle
  t.set(theme.dark({ when: { toggle: 'analysis' }, seconds: 0 })); t.step(16, st); assert.equal(t.amount, 0, 'toggle off');
  toggles.analysis = true; t.step(16, st); assert.equal(t.amount, 1, 'toggle on: at once (seconds 0)');
  // a theme's checks happen when it is made, not in a frame
  assert.throws(() => theme.grey({ grey: 2 }), /grey must be a number from 0 to 1/);
  assert.throws(() => theme.custom({ tint: 'nope' }), /colour 'nope'/);
  assert.equal(theme.none(), null, 'none: no theme');
});

test('theme: the muting step is in every program that draws the world\'s colours (WGSL and GLSL alike), and its CPU twin', () => {
  const frag = (g: string | { fragment: string }) => (typeof g === 'string' ? g : g.fragment);
  const programs: [string, string, string | { fragment: string }][] = [
    ['solid', SOLID_WGSL, SOLID_GLSL], ['solid instances', SOLID_INST_WGSL, SOLID_INST_GLSL], ['impostor', IMPOSTOR_WGSL, IMPOSTOR_GLSL], ['people (skin)', skinWGSL(), skinGLSL()],
    ['surface', SURFACE_WGSL, SURFACE_GLSL], ['area', AREA_WGSL, AREA_GLSL], ['area draped', AREA_DRAPE_WGSL, AREA_DRAPE_GLSL], ['area on tiles', AREA_TILE_WGSL, AREA_TILE_GLSL],
    ['line', LINE_WGSL, LINE_GLSL], ['arc', ARC_WGSL, ARC_GLSL], ['line draped', LINE_DRAPE_WGSL, LINE_DRAPE_GLSL], ['line on tiles', LINE_TILE_WGSL, LINE_TILE_GLSL], ['extrusion', EXTRUSION_WGSL, EXTRUSION_GLSL],
    ['points', POINTS_WGSL, POINTS_GLSL], ['text', TEXT_WGSL, TEXT_GLSL], ['custom', CUSTOM_WGSL, CUSTOM_GLSL], ['custom mesh', CUSTOM_MESH_WGSL, CUSTOM_MESH_GLSL],
    ['field on the surface', FIELD_SURFACE_WGSL, FIELD_SURFACE_GLSL], ['rain', RAIN_WGSL, RAIN_GLSL], ['stars', STARS_WGSL, STARS_GLSL], ['flat sky', SKY_WGSL, SKY_GLSL],
  ];
  for (const [name, wgsl, glsl] of programs) {
    const fsW = wgsl.slice(wgsl.indexOf('@fragment'));
    assert.match(/themed(Ground)?\(/.test(fsW) ? fsW : wgsl.match(/fn shadeSolid[\s\S]*?\n}\n/)?.[0] ?? '', /themed(Ground)?\(/, `${name}: WGSL mutes`);
    assert.match(frag(glsl), /themed(Ground)?\(/, `${name}: GLSL mutes`);
    assert.match(wgsl, /fn themed\(c: vec3f, keep: f32\)/, `${name}: WGSL has the shared step`);
  }
  // the solids' every material: both ways out of shadeSolid go through it, keeping what is tinted (the selected) and hovered
  for (const src of [SOLID_WGSL, SOLID_GLSL.fragment]) {
    const fn = src.slice(src.search(/shadeSolid\(/), src.indexOf('\n}\n', src.search(/shadeSolid\(/)));
    assert.equal((fn.match(/return airFog\(/g) ?? []).length, (fn.match(/return airFog\(themed\([a-z]+, keep\)/g) ?? []).length, 'every return of shadeSolid is muted');
    assert.match(fn, /keep = step\(0\.002, tn\.a\)/, 'a tinted (or selected) thing is kept');
  }
  assert.ok(S.translateStatements, 'shaders index loads');
  // the CPU twin: grey mutes a red to its grey, amount 0 leaves it, a subject (keep) is the shaders' job
  const g = theme.grey(), red = [0.9, 0.1, 0.1];
  assert.deepEqual(g.mute(red, 0), red, 'amount 0: as it is');
  const m = g.mute(red), l = 0.299 * 0.9 + 0.587 * 0.1 + 0.114 * 0.1;
  assert.ok(Math.abs(m[0] - m[1]) < 1e-9 && Math.abs(m[1] - m[2]) < 1e-9, `grey: ${m}`);
  assert.ok(Math.abs(m[0] - Math.max(0, ((l - 0.5) * THEMES.grey.contrast! + 0.5) * THEMES.grey.brightness!)) < 1e-6, 'its contrast and brightness');
  const d = theme.dark().mute([0.6, 0.67, 0.45]);
  assert.ok(d[2] > d[0] && d[0] < 0.3, `dark: blue-grey and dark: ${d}`);
  const lt = theme.light().mute([0.2, 0.3, 0.2]);
  assert.ok(lt[0] > 0.3, `light: lighter: ${lt}`);
  // its one colour scale: the theme's ramp, through every scale kind
  const t = theme.grey({ ramp: ['#000000', '#ffffff'] }), sc = t.scale.linear((x: { v: number }) => x.v, { domain: [0, 10] });
  assert.equal(sc({ v: 5 }), '#808080'); assert.equal(t.ramp(1), '#ffffff');
});

test('selected colour: a solids layer draws the selected things (a tap, w.select) in its selected colour, kept under a theme; other layers\' ids are not its', async () => {
  const { w, textures } = standIn();
  const mb = new MeshBuilder(), n = 3;
  for (let i = 0; i < n; i++) mb.as(i).box(i * 20 + 5, 5, 0, 10, 10, 10, 0, '#c8b8a0');
  const s = solids({ id: 'city' }), other = solids({ id: 'roads' });
  w.add(s, other); await settle(w);
  const info = (id: number) => (id < n ? { kind: 'building', id, props: {} } : null);
  s.put('0_0', { origin: [145.12, -37.92], at: [0, 0], mesh: mb.build(), info });
  other.put('0_0', { origin: [145.12, -37.92], at: [0, 0], mesh: mb.build(), info });
  await settle(w);
  // (the layer's tints: one texture, each tinted chunk's rows in it; this one chunk's from its first)
  const tints = () => textures.filter((t) => t.label === 'city tints');
  assert.equal(tints().length, 0, 'nothing selected: no tints made (the shared empty one)');
  // a thing of 'city' selected (the world picked it there): its texel in the selected colour, mixed .65
  (w as unknown as { remember(f: object): void }).remember({ element: 'city', id: '0_0:1', props: {}, d: {}, index: 1, at: null, x: 0, y: 0 });
  w.select(['0_0:1']); w.setTheme(theme.dark({ seconds: 0 })); await settle(w);
  const t = tints().at(-1)!; assert.ok(t?.data, 'the chunk\'s tints made');
  assert.deepEqual([...t.data!.subarray(4, 8)], [0x38, 0xbd, 0xf8, Math.round(0.65 * 255)], 'blue (#38bdf8) at its id, mix .65');
  assert.deepEqual([...t.data!.subarray(0, 4)], [0, 0, 0, 0], 'the others: their own colour');
  assert.equal(textures.filter((x) => x.label === 'roads tints').length, 0, 'the same id in another layer is not selected');
  // a colour of your own, and none
  s.setProps({ selected: { color: '#ff0000', mix: 1 } }); await settle(w);
  assert.deepEqual([...tints().at(-1)!.data!.subarray(4, 8)], [255, 0, 0, 255]);
  // under the theme, a tinted texel is kept (the shaders' keep = step(0.002, tint's alpha)): any selected mix > 0 is
  assert.ok(1 / 255 > 0.002, 'the smallest tint an 8-bit texel holds is kept');
  // nothing selected again: back to the shared empty tints
  w.select([]); await settle(w);
  const drawn = (w as unknown as { lastDraws: DrawCall[] }).lastDraws.filter((d) => d.textures?.some((x) => (x as unknown as { label: string }).label === 'city tints'));
  assert.equal(drawn.length, 0, 'deselected: its tints let go');
  w.dispose();
});

test('sky: a theme dims the sky and its haze through its own dim (the theme\'s sky part); its own dim set, that wins', async () => {
  const { sky } = await import('../src/index.ts');
  const s = makeState({ view: { lon: 145.12, lat: -37.92, zoom: 15 }, time: { now: new Date(Date.UTC(2026, 0, 15, 2, 0, 0)) } });
  const tick = (k: unknown, world: unknown) => { for (let i = 0; i <= 4; i++) (k as { tickWeather(c: unknown): void }).tickWeather({ s, now: i * 250, world }); };
  const plain = sky(), themed = sky(), own = sky({ dim: { amount: 0 } });
  const world = { themeNow: { amount: 1, sky: { amount: 1, color: [0, 0, 0] } } };
  tick(plain, {}); tick(themed, world); tick(own, world);
  const a = plain.light(s).haze!, b = themed.light(s).haze!, c = own.light(s).haze!;
  assert.ok(b[0] < a[0] * 0.2 && b[2] < a[2] * 0.2, `the theme's sky darkened the haze: ${a} → ${b}`);
  assert.deepEqual(c, a, 'the sky\'s own dim (0) over the theme\'s');
  tick(themed, { themeNow: null });
  assert.deepEqual(themed.light(s).haze, a, 'the theme gone: as without it');
});
