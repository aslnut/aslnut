// core › simulation › fields › surface (headless, a stand-in graphics that keeps what is written): values by vertex and
// by facet drawn by the solids' own draws (no draw of its own), the far mesh's by its own vertices, clones by one value
// each; .set writes only the chunks whose values changed; .at and probes read it; epochs of values morph on the chip
// (both sets there, the share in the look); and the errors (a wrong length, an unknown `on`).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { World } from '../src/core/world/world.ts';
import { Camera } from '../src/core/observation/observers/orbit/camera.ts';
import { Loader } from '../src/core/data/loading/loader.ts';
import type { DrawCall, Graphics, Program, ProgramDesc, TextureDesc } from '../src/core/render/graphics/interface.ts';
import { Solids, type SolidsChunk } from '../src/core/geometry/shapes/solids.ts';
import { MeshBuilder, shapeOf, unpackNormal, MESH_FLOATS } from '../src/core/geometry/shapes/mesh.ts';
import { field, epochs, AslnutError, SurfaceField, type SurfaceInput } from '../src/index.ts';
import { FIELD_TEXELS } from '../src/core/render/graphics/shaders/solid-field.wgsl.ts';

const L = 145.12, B = -37.92, T7 = Date.UTC(2026, 0, 15, 7), H = 3600e3;
let uid = 0;
interface Tex { desc: TextureDesc; label: string; px: Float32Array | Uint8Array; writes: number; destroyed: boolean }
/** a graphics that keeps every texture's texels (written by rectangles), every frame's draws */
function standIn() {
  const textures: Tex[] = [], frames: DrawCall[][] = [];
  const g = {
    api: 'webgl2', caps: { api: 'webgl2', compute: false, timer: false, floatTargets: false, maxTex: 4096, maxLayers: 256, vertexTextures: 16, f16: false, device: 'stand-in' },
    width: 400, height: 300, resize() {},
    buffer(kind: string, sizeOrData: number | ArrayBufferView, label = '') { return { kind, size: typeof sizeOrData === 'number' ? sizeOrData : sizeOrData.byteLength, uid: ++uid, version: 0, label, write() {}, destroy() {} }; },
    texture(desc: TextureDesc) {
      const ch = desc.format === 'r32f' ? 1 : 4, n = desc.width * desc.height * (desc.layers ?? 1) * ch;
      const t: Tex & { write(d: ArrayBufferView, o?: { x?: number; y?: number; width?: number; height?: number }): void; writeImage(): void; destroy(): void } = {
        desc, label: desc.label ?? '', px: desc.format === 'rgba8' ? new Uint8Array(n) : new Float32Array(n), writes: 0, destroyed: false,
        write(d, o = {}) {
          t.writes++; const x0 = o.x ?? 0, y0 = o.y ?? 0, w = o.width ?? desc.width, h = o.height ?? desc.height, src = d as Float32Array | Uint8Array;
          if ((o as { layer?: number }).layer) return;
          for (let y = 0; y < h; y++) for (let x = 0; x < w * ch; x++) { const k = (y * w * ch) + x; if (k < src.length) t.px[((y0 + y) * desc.width * ch) + x0 * ch + x] = src[k]!; }
        },
        writeImage() {}, destroy() { t.destroyed = true; },
      };
      textures.push(t); return t;
    },
    target(width: number, height: number) { return { width, height, destroy() {} }; },
    layerTarget(tex: Tex) { return { width: tex.desc.width, height: tex.desc.height, destroy() {} }; },
    copyLayers: () => false, readTexture: async () => new Uint8Array(4),
    program(desc: ProgramDesc): Program { return { label: desc.label, desc, ready: Promise.resolve(), destroy() {} } as Program; },
    frame(draws: DrawCall[]) { frames.push([...draws]); return null; },
    stats: { draws: 0, passes: 0, uploadBytes: 0, uploads: 0, gpuMs: null, uploadMaxMs: 0 },
    lost: new Promise<string>(() => {}), bytes: 0, memory: () => [], destroy() {},
  };
  const w = new World({ body: null, camera: new Camera(), loader: new Loader(), ownLoader: true, graphics: g as unknown as Graphics, reason: 'stand-in', profile: null, canvas: { width: 400, height: 300 } as never, opts: { autostart: false, clock: { fps: 60 }, attribution: false, time: new Date(T7) } as never });
  w.go({ lon: L, lat: B, zoom: 18, tilt: 50 });
  return { w, textures, frames };
}
const steps = async (w: World, n = 4) => { for (let i = 0; i < n; i++) { await new Promise((ok) => setTimeout(ok, 0)); w.step(1000 / 60); } };
const tex = (fg: { textures: Tex[] }, label: string) => fg.textures.filter((t) => t.label === label && !t.destroyed).at(-1);
/** two blocks (a 20 × 12 m one, 9 m tall, and a 10 × 10 m one, 21 m tall) in a chunk at the view's centre */
function block(id = 'city', twoChunks = false) {
  const s = new Solids({ id });
  const put = (key: string, dx: number) => {
    const mb = new MeshBuilder(), far = new MeshBuilder(), ring = (x: number, z: number, w: number, d: number): [number, number][] => [[x, z], [x + w, z], [x + w, z + d], [x, z + d]];
    for (const m of [mb, far]) {
      m.as(0).on([60, 60]).prism(ring(50, 54, 20, 12), 0, 9, '#cccccc', '#999999', [0, 1, 2, 0, 2, 3]);
      m.as(1).on([105, 65]).prism(ring(100, 60, 10, 10), 0, 21, '#cccccc', '#999999', [0, 1, 2, 0, 2, 3]);
    }
    const infos = [{ kind: 'building', id: `${key}-a`, props: { h: 9 } }, { kind: 'building', id: `${key}-b`, props: { h: 21 } }];
    s.put(key, { origin: [L, B], at: [dx, 0], mesh: mb.build(), far: far.build(), info: (i) => infos[i] ?? null });
  };
  put('0_0', -250);
  if (twoChunks) put('1_0', 250);
  return s;
}
/** a made-up value: roofs 10, walls 2 + 3 × how much they face north, + the height / 10 */
const byFacet = (_b: unknown, facet: unknown, n: [number, number, number], at: [number, number, number]) => (facet === 'roof' ? 10 : 2 + 3 * n[1]) + at[2] / 10;

test('surface field: values by facet on the walls and roofs, drawn by the solids\' own draws (one more texture, no draw of its own)', async () => {
  const fg = standIn(), { w } = fg, s = block();
  w.add(s); await steps(w);
  const before = fg.frames.at(-1)!.length;
  const surf = field({ id: 'warm', kind: 'surface', on: 'city', values: byFacet, draw: { ramp: 'inferno', domain: [0, 15] } });
  assert.ok(surf instanceof SurfaceField);
  w.add(surf); await steps(w, 30);
  const last = fg.frames.at(-1)!, mine = last.filter((d) => (d.program as Program).label === 'solids city field');
  assert.equal(last.length, before, `no more draws (${before} → ${last.length})`);
  assert.equal(mine.length, 1, 'its chunk drawn by the field program');
  const near = tex(fg, 'warm 0_0 near')!, far = tex(fg, 'warm 0_0 far')!;
  assert.ok(near && far, 'its whole mesh\'s values and its far mesh\'s');
  assert.equal(mine[0]!.textures!.at(-1), near as never, 'the near draw binds them');
  const px = near.px as Float32Array;
  assert.deepEqual([...px.subarray(0, 8)].map((x) => +x.toFixed(3)), [1, 0, 15, Math.fround(-1e30), 1, 0, 1, 1], 'its look: on, the domain, no least, opacity, no morph, one row of values, a subject');
  assert.ok(px[8]! >= 0 && px[8 + 255]! > px[8]!, 'its ramp from texel 8 (packed colours, dark to bright)');
  // each vertex's value as the function gave it, in the mesh's order
  const mesh = (s as unknown as { chunks: Map<string, { spec: { mesh: Float32Array } }> }).chunks.get('0_0')!.spec.mesh;
  const n = mesh.length / MESH_FLOATS; let walls = new Set<number>();
  for (let v = 0; v < n; v++) {
    const [nx, ny, nz] = unpackNormal(mesh[v * MESH_FLOATS + 6]!), want = (ny > 0.5 ? 10 : 2 + 3 * -nz) + mesh[v * MESH_FLOATS + 1]! / 10;
    assert.ok(Math.abs(px[FIELD_TEXELS + v]! - want) < 1e-4, `vertex ${v}: ${px[FIELD_TEXELS + v]} vs ${want}`);
    if (ny < 0.5 && mesh[v * MESH_FLOATS + 1]! === 0) walls.add(+px[FIELD_TEXELS + v]!.toFixed(2)); void nx;
  }
  assert.deepEqual([...walls].sort(), [-1, 2, 5].map((x) => +x.toFixed(2)).sort(), 'walls by orientation: north 5, east and west 2, south -1');
  assert.equal(px[FIELD_TEXELS + n], Math.fround(-3e38), 'past the last vertex: none');
  // reading it
  const top = surf.at([L + (-250 + 105) / (111320 * Math.cos(B * Math.PI / 180)), B - 65 / 110574, 21]);
  assert.ok(Math.abs(top - (10 + 2.1)) < 1e-3, `the roof of the tall one: ${top}`);
  const pr = surf.probe({ of: '0_0-b' });
  assert.ok(pr.value > 2 && pr.value < 12.1, `a thing's mean over its facets: ${pr.value}`);
  assert.equal(surf.legend().kind, 'continuous');
  w.dispose();
});

test('surface field: .set writes only the chunks whose values changed; values by vertex; a wrong length is said', async () => {
  const fg = standIn(), { w } = fg, s = block('city', true);
  const surf = field({ id: 'v', kind: 'surface', on: s, values: () => 1 });
  w.add(s, surf); await steps(w, 30);
  const a = tex(fg, 'v 0_0 near')!, b = tex(fg, 'v 1_0 near')!;
  assert.ok(a && b);
  const wa = a.writes, wb = b.writes;
  surf.set((thing) => (String(thing.id).startsWith('1_0') ? 2 : 1)); await steps(w, 4);
  assert.equal(tex(fg, 'v 0_0 near')!.writes, wa, 'the chunk whose values are the same: nothing written');
  assert.equal(tex(fg, 'v 1_0 near')!.writes, wb + 1, 'the one that changed: its values (one write)');
  assert.equal((tex(fg, 'v 1_0 near')!.px as Float32Array)[FIELD_TEXELS], 2);
  // by vertex, a chunk's own order
  const counts = surf.vertices(); assert.equal(typeof counts['0_0'], 'number');
  const vals = new Float32Array(counts['0_0']!).map((_, i) => i);
  surf.set({ '0_0': vals, '1_0': new Float32Array(counts['1_0']!) }); await steps(w, 4);
  const px = tex(fg, 'v 0_0 near')!.px as Float32Array;
  assert.equal(px[FIELD_TEXELS + 7], 7, 'vertex 7\'s value where vertex 7 is drawn');
  const farPx = tex(fg, 'v 0_0 far')!.px as Float32Array, half = counts['0_0']! / 2;
  assert.ok(Math.abs(farPx[FIELD_TEXELS]! - (half - 1) / 2) < 1, `the far mesh: each thing's mean (${farPx[FIELD_TEXELS]})`);
  const e = (() => { try { surf.set({ '0_0': new Float32Array(3) }); } catch (x) { return x; } })() as AslnutError;
  assert.ok(e instanceof AslnutError && /has \d+ vertices, the values 3/.test(e.message) && /vertices\(\)/.test(e.fix ?? ''), `a wrong length: ${e}`);
  assert.throws(() => surf.set({ '9_9': new Float32Array(3) }), /no chunk '9_9'/);
  assert.throws(() => surf.set(new Float32Array(3)), /one array of values for 2 chunks/);
  w.dispose();
});

test('surface field: an unknown `on` is said with the layers there; a value of another kind too', async () => {
  const fg = standIn(), { w } = fg;
  w.add(block()); await steps(w);
  const surf = field({ id: 'lost', kind: 'surface', on: 'buildings', values: () => 1 });
  w.add(surf); await steps(w);
  assert.ok(surf.failure instanceof AslnutError && /no solids layer 'buildings'/.test(surf.failure.message) && /'city'/.test((surf.failure as AslnutError).fix ?? ''), String(surf.failure));
  assert.throws(() => field({ id: 'x', kind: 'surface', on: 42 as never, values: () => 1 }), /on must be a solids layer/);
  assert.throws(() => field({ id: 'y', kind: 'surface', on: 'city' } as never), /needs values/);
  w.dispose();
});

test('surface field: epochs of values morph on the chip (both sets there, the share in the look); clones take one value each', async () => {
  const fg = standIn(), { w } = fg, s = block();
  // a few clones (instances) in the chunk: ids 2 and 3
  const box = shapeOf((mb) => mb.box(0, 0, 0, 1, 1, 1, 0, '#ffffff'));
  s.put('0_0', { ...(s as unknown as { pending: Map<string, SolidsChunk> }).pending.get('0_0')!, instances: [{ shape: box, data: new Float32Array([10, 10, 0, 2, 1, 1, 1, 0, 0xffffff, 0, 20, 10, 0, 3, 1, 1, 1, 0, 0xffffff, 0]) }], info: (i: number) => (i < 4 ? { kind: i < 2 ? 'building' : 'bin', id: `t${i}`, props: {} } : null) });
  // each hour's values: your function (given as it is; a function of no parameters would be a loader)
  const morph = field({ id: 'hourm', kind: 'surface', on: s, data: epochs<SurfaceInput>([7, 8, 9].map((h) => ({ at: T7 + (h - 7) * H, source: (_thing: unknown, _facet: unknown) => h })), { blend: 'morph' }), draw: { domain: [7, 9] } });
  w.add(s, morph); w.setTime(new Date(T7 + 0.5 * H)); await steps(w, 30);
  const px = tex(fg, 'hourm 0_0 near')!.px as Float32Array, rows = px[6]!;
  assert.equal(px[5], 0.5, '07:30: the next epoch\'s share, half');
  assert.equal(px[FIELD_TEXELS], 7, 'the 07:00 values'); assert.equal(px[FIELD_TEXELS * (1 + rows)], 8, 'the 08:00 values after them');
  const writes = fg.textures.filter((t) => t.label.startsWith('hourm 0_0')).reduce((n, t) => n + t.writes, 0);
  w.setTime(new Date(T7 + 0.75 * H)); await steps(w, 3);
  assert.equal((tex(fg, 'hourm 0_0 near')!.px as Float32Array)[5], 0.75, 'the share moved');
  const after = fg.textures.filter((t) => t.label.startsWith('hourm 0_0')).reduce((n, t) => n + t.writes, 0);
  assert.ok(after - writes <= 4, `as the time moves only the look's first numbers are written (${after - writes} writes)`);
  assert.equal(morph.at([L, B]), 7.75, 'read between them');
  // clones: one value each, a tint (their theme's subject) in the ramp's colour
  const tints = tex(fg, 'city tints')!;
  assert.ok(tints, 'the clones\' tints');
  const tp = tints.px as Uint8Array;
  assert.ok(tp[2 * 4 + 3]! === 255 && tp[3 * 4 + 3]! === 255, 'both clones tinted, fully');
  assert.equal(tp[0 * 4 + 3], 0, 'a mesh\'s thing: no tint (its vertices carry the values)');
  const st = morph.epochStats()[0]!; assert.ok(st.held >= 2 && st.held <= 4, `epochs held near the time: ${st.held}`);
  const tl = w.telemetry().epochs.find((e) => e.of === 'hourm');
  assert.ok(tl && tl.held === st.held && tl.epochs === 3, `in the telemetry: ${JSON.stringify(tl)}`);
  w.dispose();
});
