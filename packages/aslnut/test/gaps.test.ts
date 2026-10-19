// The strengthened parts another interface leans on (a Leaflet-compatible layer among them): each gap the smallest
// strengthening of one existing part, tested here without graphics (what draws is checked on WebGPU and WebGL2 by the
// leaflet smoke, tools/smoke-leaflet.mjs).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Rows } from '../src/core/data/sources/index.ts';
import { World } from '../src/core/world/world.ts';
import { Camera } from '../src/core/observation/observers/orbit/camera.ts';
import { Loader } from '../src/core/data/loading/loader.ts';
import type { DrawCall, GBuffer, GTexture, Graphics, Program, ProgramDesc } from '../src/core/render/graphics/interface.ts';

// ── stand-in graphics: what is written kept, every frame's draws kept ──
let uid = 0;
interface FTex extends GTexture { label: string; data: ArrayBufferView | null }
interface FBuf extends GBuffer { label: string; data: Float32Array | null }
function fakeGraphics() {
  const buffers: FBuf[] = [], textures: FTex[] = [], frames: DrawCall[][] = [];
  const g = {
    api: 'webgl2', caps: { api: 'webgl2', compute: false, timer: false, floatTargets: false, maxTex: 4096, maxLayers: 256, vertexTextures: 16, f16: false, device: 'stand-in' },
    width: 400, height: 300, resize(w: number, h: number) { g.width = w; g.height = h; },
    buffer(kind: string, sizeOrData: number | ArrayBufferView, label = '') {
      const b = { kind, size: typeof sizeOrData === 'number' ? sizeOrData : sizeOrData.byteLength, uid: ++uid, version: 0, label, data: null as Float32Array | null,
        write(d: ArrayBufferView) { b.data = d instanceof Float32Array ? Float32Array.from(d) : null; b.version++; }, destroy() {} };
      buffers.push(b as unknown as FBuf); return b as unknown as FBuf;
    },
    texture(desc: { label?: string; width: number; height: number }) { const t = { desc, label: desc.label ?? '', data: null as ArrayBufferView | null, write(d: ArrayBufferView) { t.data = d instanceof Float32Array ? Float32Array.from(d) : d instanceof Uint8Array ? Uint8Array.from(d) : null; }, writeImage() {}, destroy() {} }; textures.push(t as unknown as FTex); return t as unknown as FTex; },
    target(width: number, height: number) { return { width, height, texture: g.texture({ label: 'target', width, height }), destroy() {} }; },
    readTexture: async () => new Uint8Array(4 * 4096),
    program(desc: ProgramDesc): Program { return { label: desc.label, desc, ready: Promise.resolve(), ok: true, destroy() {} } as Program; },
    frame(draws: DrawCall[], o: { target?: unknown; read?: boolean }) { if (!o.target) frames.push([...draws]); return o.read ? Promise.resolve(new Uint8Array(4 * 4096)) : null; },
    hold() {}, stats: { draws: 0, passes: 0, uploadBytes: 0, uploads: 0, gpuMs: null, uploadMaxMs: 0 },
    lost: new Promise<string>(() => {}), bytes: 0, memory: () => [], destroy() {},
  };
  return { g: g as unknown as Graphics, buffers, textures, frames };
}
// (a canvas for the pictures: node has none; nothing drawn)
class Canvas2D {
  canvas: { width: number; height: number }; constructor(c: { width: number; height: number }) { this.canvas = c; }
  save() {} restore() {} beginPath() {} rect() {} clip() {} translate() {} drawImage() {} fillRect() {} fillText() {} clearRect() {} measureText(t: string) { return { width: t.length * 7 }; }
  getImageData(_x: number, _y: number, w: number, h: number) { return { data: new Uint8ClampedArray(w * h * 4) }; }
}
(globalThis as { OffscreenCanvas?: unknown }).OffscreenCanvas ??= class { width: number; height: number; constructor(w: number, h: number) { this.width = w; this.height = h; } getContext() { return new Canvas2D(this); } };
const LON = 145.12, LAT = -37.92;
function standIn() {
  const fg = fakeGraphics();
  const w = new World({ body: null, camera: new Camera(), loader: new Loader(), ownLoader: true, graphics: fg.g, reason: 'stand-in', profile: null, canvas: { width: 400, height: 300 } as never, opts: { autostart: false, clock: { fps: 60 }, attribution: false } });
  w.go({ lon: LON, lat: LAT, zoom: 15 });
  return { w, ...fg };
}
const steps = async (w: World, n = 3) => { for (let i = 0; i < n; i++) { await new Promise((ok) => setTimeout(ok, 0)); w.step(1000 / 60); } };
const texOf = (fg: { textures: FTex[] }, label: string) => fg.textures.filter((t) => t.label === label).at(-1);
const bufOf = (fg: { buffers: FBuf[] }, label: string) => fg.buffers.filter((b) => b.label === label).at(-1);

// ── core › data › features › rows: rows of any shape (G4) ──
test('rows of any shape: features upserted and patched by id; a patch keeps the geometry it does not give', () => {
  const r = new Rows();
  const line = { id: 'l1', props: { color: 'red' }, geometry: { type: 'LineString', coordinates: [[145, -37.9], [145.01, -37.91]] } };
  const area = { id: 'a1', properties: { name: 'block' }, geometry: { type: 'Polygon', coordinates: [[[145, -37.9], [145.01, -37.9], [145.01, -37.91], [145, -37.9]]] } };
  r.upsert([line, area, { id: 'p1', lon: 145.02, lat: -37.92, kind: 'clinic' }]);
  assert.equal(r.size, 3);
  assert.equal(r.get('l1')!.geometry!.type, 'LineString');
  assert.equal(r.get('a1')!.props.name, 'block', 'GeoJSON properties are the props');
  assert.deepEqual(r.get('p1')!.geometry, { type: 'Point', coordinates: [145.02, -37.92] }, 'a row is a point from its lon / lat');
  // a feature's props change: its shape stays, only the values changed
  let sv = r.shapeVersion, v = r.version;
  r.patch('l1', { props: { color: 'blue' } });
  assert.equal(r.get('l1')!.geometry!.type, 'LineString', 'the line keeps its shape');
  assert.equal(r.get('l1')!.props.color, 'blue');
  assert.equal(r.shapeVersion, sv, 'a restyle, not a rebuild'); assert.equal(r.version, v + 1);
  // a feature's new geometry: a shape change
  r.patch('l1', { geometry: { type: 'LineString', coordinates: [[145, -37.9], [145.02, -37.93], [145.03, -37.9]] } });
  assert.equal(r.shapeVersion, sv + 1); assert.equal((r.get('l1')!.geometry as { coordinates: unknown[] }).coordinates.length, 3);
  assert.equal(r.get('l1')!.props.color, 'blue', 'the props it did not give are kept');
  // a row's change without coordinates keeps its point (it once rebuilt the row from lon / lat); with them it moves
  sv = r.shapeVersion;
  r.patch('p1', { kind: 'hospital' });
  assert.deepEqual(r.get('p1')!.geometry, { type: 'Point', coordinates: [145.02, -37.92] }); assert.equal(r.shapeVersion, sv);
  r.patch('p1', { lon: 145.03 });
  assert.deepEqual(r.get('p1')!.geometry, { type: 'Point', coordinates: [145.03, -37.92] }); assert.equal(r.shapeVersion, sv + 1);
  // one upsert of a feature with a new shape: one change; a bad geometry is said with its fix
  v = r.version;
  r.upsert([{ ...area, geometry: { type: 'Polygon', coordinates: [[[145, -37.9], [145.02, -37.9], [145.02, -37.92], [145, -37.9]]] } }]);
  assert.equal(r.version, v + 1);
  assert.throws(() => r.upsert([{ id: 'x', props: {}, geometry: { type: 'LineString', coordinates: [[1]] } }]), /E-DATA-002|not a list of positions/);
});

// ── core › render › project: a place from a screen point (G1) ──
test('unproject: a point on the canvas → the place on the ground, the inverse of project (flat, tilted, globe); the sky is null', async () => {
  const { world } = await import('../src/core/world/world.ts');
  const w = await world(null, { view: { lon: 145.12, lat: -37.92, zoom: 14 } });
  w.camera.width = 800; w.camera.height = 600; w.step(16);
  const near = (a: readonly number[] | null, b: readonly number[], tol: number) => !!a && Math.abs(a[0]! - b[0]!) < tol && Math.abs(a[1]! - b[1]!) < tol;
  for (const ll of [[145.12, -37.92], [145.13, -37.915], [145.105, -37.93]] as [number, number][]) {
    const xy = w.project(ll)!; assert.ok(xy, 'on screen');
    assert.ok(near(w.unproject(xy), ll, 1e-6), `${ll} → ${xy} → ${w.unproject(xy)}`);
  }
  // the centre of the canvas is the view's centre
  assert.ok(near(w.unproject([400, 300]), [145.12, -37.92], 1e-6));
  // tilted and turned: still the inverse; the top of a view tilted to the horizon is the sky
  w.go({ lon: 145.12, lat: -37.92, zoom: 15, tilt: 60, bearing: 30 }); w.step(16);
  const p = w.project([145.125, -37.918])!; assert.ok(near(w.unproject(p), [145.125, -37.918], 1e-6));
  w.go({ lon: 145.12, lat: -37.92, zoom: 15, tilt: 85, bearing: 0 }); w.step(16);
  assert.equal(w.unproject([400, 0]), null, 'the sky');
  // the globe
  w.go({ lon: 110, lat: -7, zoom: 2 }); w.step(16);
  const g = w.project([112, -6])!; assert.ok(near(w.unproject(g), [112, -6], 1e-4), `${w.unproject(g)}`);
  assert.throws(() => w.unproject([NaN, 3] as never), /E-VIEW-001/);
  w.dispose();
});

// ── core › interaction › events: the view's own event (G2) ──
test("the 'view' event: start, change, end; zoomed; by the app or a person's hands", async () => {
  const { world } = await import('../src/core/world/world.ts');
  const w = await world(null, { view: { lon: 145.12, lat: -37.92, zoom: 14 } });
  const seen: string[] = [];
  w.on('view', (e) => seen.push(`${e.phase}${e.zoomed ? '+z' : ''}:${e.by}`));
  w.step(16); w.step(16);
  assert.equal(seen.length, 0, 'the first pose is not a move');
  // a jump: start and change in its frame, the end once it is still
  w.go({ lon: 145.13, lat: -37.92, zoom: 14 });
  for (let i = 0; i < 5; i++) w.step(16);
  assert.deepEqual(seen, ['start:app', 'change:app', 'end:app']);
  // a flight that zooms: changes every frame, zoomed, one end
  seen.length = 0;
  const done = w.fly({ lon: 145.12, lat: -37.92, zoom: 15 }, { seconds: 0.2 });
  for (let i = 0; i < 30; i++) w.step(16);
  await done;
  assert.match(seen[0]!, /^start/); assert.equal(seen.at(-1), 'end+z:app', 'zoomed once its distance changed');
  assert.equal(seen.filter((x) => x.startsWith('end')).length, 1, 'one end');
  assert.ok(seen.filter((x) => x.startsWith('change')).length >= 10, 'a change a frame');
  // a person's hands (a pan as a drag makes it): by hands, not zoomed
  seen.length = 0;
  (w.camera as unknown as { panByHand(dx: number, dy: number): void }).panByHand(30, 0);
  for (let i = 0; i < 5; i++) w.step(16);
  assert.deepEqual(seen, ['start:hands', 'change:hands', 'end:hands']);
  const v = await new Promise<{ lon: number }>((ok) => { const off = w.on('view', (e) => { if (e.phase === 'end') { off(); ok(e.view); } }); w.go({ lon: 145.2, lat: -37.9, zoom: 12 }); for (let i = 0; i < 5; i++) w.step(16); });
  assert.ok(Math.abs(v.lon - 145.2) < 1e-9, 'the view at its end');
  w.dispose();
});

// ── core › data › sources › tiles › xyz: tile URLs as web maps write them (G6) ──
test('xyz: {s} over subdomains, 512 px tiles with a zoom offset, {-y}, a URL function, a picture for a failed tile', async () => {
  const { raster } = await import('../src/core/data/sources/raster.ts');
  const a = raster.xyz('https://{s}.tiles.test/{z}/{x}/{y}.png', { subdomains: 'abc' });
  assert.equal(a.urlFor!({ z: 3, x: 1, y: 1 }), 'https://c.tiles.test/3/1/1.png', '(x + y) % 3 picks the host');
  assert.equal(a.urlFor!({ z: 3, x: 1, y: 0 }), 'https://b.tiles.test/3/1/0.png');
  assert.equal(raster.xyz('https://{s}.t/{z}/{x}/{y}', { subdomains: ['one', 'two'] }).urlFor!({ z: 1, x: 0, y: 1 }), 'https://two.t/1/0/1');
  // 512 px tiles counted from level 0 (zoomOffset -1): a 256 px tile of level z is a quarter of the level z - 1 tile
  const b = raster.xyz('https://t/{z}/{x}/{y}@2x', { tileSize: 512, zoomOffset: -1 });
  assert.equal(b.urlFor!({ z: 4, x: 5, y: 9 }), 'https://t/3/2/4@2x');
  // TMS rows from the south; past the last level the last level's tile
  assert.equal(raster.xyz('https://t/{z}/{x}/{-y}').urlFor!({ z: 2, x: 1, y: 0 }), 'https://t/2/1/3');
  assert.equal(raster.xyz('https://t/{z}/{x}/{y}', { maxZoom: 3 }).urlFor!({ z: 5, x: 8, y: 12 }), 'https://t/3/2/3');
  assert.equal(raster.xyz((z, x, y) => `fn/${z}-${x}-${y}`, { tileSize: 512, zoomOffset: -1 }).urlFor!({ z: 2, x: 3, y: 1 }), 'fn/1-1-0');
  assert.throws(() => raster.xyz('https://t/{z}/{x}/{y}', { tileSize: 300 }), /E-DATA-001/);
  // the piece of a 512 px tile a 256 px tile draws, and a failed tile's picture
  const calls: unknown[] = [], img = (w: number) => ({ width: w, height: w });
  const g = { drawImage: (...x: unknown[]) => calls.push(x.slice(1)) } as never;
  const loader = (bad: string) => ({ get: async (u: string) => { if (u === bad) throw new Error('404'); return img(u.endsWith('err.png') ? 256 : 512); } }) as never;
  assert.equal(await b.draw(g, { z: 4, x: 5, y: 9 }, { loader: loader(''), priority: 'soon', prefetch: false } as never), true);
  assert.deepEqual(calls[0], [256, 256, 256, 256, 0, 0, 256, 256], 'the lower right quarter: x 5 and y 9 are odd');
  const c = raster.xyz('https://t/{z}/{x}/{y}.png', { errorUrl: 'https://t/err.png' });
  calls.length = 0;
  assert.equal(await c.draw(g, { z: 1, x: 0, y: 0 }, { loader: loader('https://t/1/0/0.png'), priority: 'soon', prefetch: false } as never), true);
  assert.deepEqual(calls[0], [0, 0, 256, 256], 'the error picture over the whole tile');
});

// ── core › encoding › marks › areas › raster: a picture you can tap (G10) ──
test('a picture over a box answers a pick when it is pickable (its feature: picture); never when it is not', async () => {
  const { raster } = await import('../src/core/encoding/marks/raster.ts');
  const fg = standIn(), { w } = fg;
  const bounds: [number, number, number, number] = [LON - 0.01, LAT - 0.01, LON + 0.01, LAT + 0.01];
  const pic = { width: 64, height: 64 } as never;
  const taps: unknown[] = [];
  w.add(raster({ id: 'plan', source: raster.image({ image: pic, bounds }), pickable: true, onTap: (f) => taps.push(f.id) }), raster({ id: 'photo', source: raster.image({ image: pic, bounds }) }));
  await steps(w, 6);
  const last = fg.frames.at(-1)!, drawsOf = (id: string) => last.filter((d) => (d.program as unknown as { label: string }).label.includes(id));
  assert.ok(drawsOf('plan').length && drawsOf('plan').every((d) => typeof d.pickProgram === 'function'), 'drawn into the picking pass');
  assert.ok(drawsOf('photo').length && drawsOf('photo').every((d) => d.pickProgram === undefined), 'not pickable: never in the picking pass');
  const info = w.element('plan').pickInfo(0)!;
  assert.equal(info.element, 'plan'); assert.equal(info.id, 'picture');
  // on the ground's tiles the CPU answers: only a pickable one
  assert.equal((w.element('photo') as unknown as { groundPick(lon: number, lat: number): number | null }).groundPick(LON, LAT), null);
  w.dispose();
});

// ── core › interaction › controllers: the hands a web map has (G7) ──
test('controllers.orbit: a box the centre is kept in (hard, or let go past and eased back), zoom by each input, snap, keys and their step', async () => {
  const { world } = await import('../src/core/world/world.ts');
  const { controllers } = await import('../src/core/entities/index.ts');
  const w = await world(null, { view: { lon: 145.12, lat: -37.92, zoom: 14 } });
  const cam = w.camera as unknown as { panByHand(dx: number, dy: number): void; lon: number; lat: number; zoom: number; zoomInputs: { wheel: boolean; pinch: boolean; keys: boolean }; key(k: string): boolean };
  const box: [number, number, number, number] = [145.1, -37.94, 145.14, -37.9];
  w.control(null, controllers.pan({ bounds: box }));
  for (let i = 0; i < 40; i++) { cam.panByHand(-200, 0); w.step(16); }
  assert.ok(Math.abs(cam.lon - 145.14) < 1e-9, `held at the east edge: ${cam.lon}`);
  // viscosity .5: past the edge by half the drag, eased back inside once let go
  w.go({ lon: 145.12, lat: -37.92, zoom: 14 });
  w.control(null, controllers.pan({ bounds: box, viscosity: 0.5 }));
  for (let i = 0; i < 40; i++) cam.panByHand(-200, 0);
  assert.ok(cam.lon > 145.14, `past the edge: ${cam.lon}`);
  for (let i = 0; i < 120; i++) w.step(16);
  assert.ok(Math.abs(cam.lon - 145.14) < 1e-6, `eased back: ${cam.lon}`);
  // zoom by input; the keys: off unless asked, the arrows move, + zooms by step levels, snapped
  w.control(null, controllers.pan({ zoom: { wheel: false }, keys: true, step: 2, snap: 1 }));
  assert.deepEqual(cam.zoomInputs, { wheel: false, pinch: true, keys: true });
  w.go({ lon: 145.12, lat: -37.92, zoom: 14 }); w.step(16);
  const lon0 = cam.lon;
  assert.equal(cam.key('ArrowRight'), true); assert.ok(cam.lon > lon0, 'the arrow moved the view east');
  assert.equal(cam.key('+'), true);
  for (let i = 0; i < 90; i++) w.step(16);
  assert.ok(Math.abs(cam.zoom - 16) < 0.01, `two levels in, whole: ${cam.zoom}`);
  // a zoom by hand that ends between levels: on to the nearest whole level
  (w.camera as unknown as { zoomByHand(f: number, x: number, y: number): void }).zoomByHand(0.8, 600, 400);
  for (let i = 0; i < 90; i++) w.step(16);
  assert.ok(Math.abs(cam.zoom - Math.round(cam.zoom)) < 0.01, `snapped: ${cam.zoom}`);
  w.control(null, controllers.pan());
  assert.equal(cam.key('+'), false, 'keys off by default');
  assert.throws(() => controllers.orbit({ bounds: [1, 2, 0, 3] }), /E-VIEW-001/);
  assert.throws(() => controllers.orbit({ viscosity: 2 }), /E-VIEW-001/);
  w.dispose();
});

// ── core › encoding › marks › symbols › icon: icons as web maps draw them (G5) ──
test('icon: an anchor that sits on the place, a size per axis (or by the picture), an atlas that grows', async () => {
  const { icon, icons } = await import('../src/core/encoding/marks/icon.ts');
  const fg = standIn(), { w } = fg;
  const pin = { width: 25, height: 41 } as never, star = { width: 32, height: 32 } as never;
  const pics = icons({ pin });
  const at = (i: number) => ({ id: `m${i}`, props: { i }, geometry: { type: 'Point' as const, coordinates: [LON + i * 1e-3, LAT] as [number, number] } });
  const sizes: Record<number, readonly [number, number]> = { 0: [25, 41], 1: [0, 0], 2: [20, 0] };
  w.add(icon({ id: 'pins', of: [at(0), at(1), at(2), at(3)], icons: pics, icon: (d) => (d.props.i === 3 ? 'star' : 'pin'), size: (d) => sizes[d.props.i as number] ?? [16, 16], anchor: (d) => (d.props.i === 0 ? [0.5, 1] : [0.5, 0.5]) }));
  await steps(w, 4);
  const items = () => texOf(fg, 'pins items')!.data as Float32Array, row = (k: number) => [...items().subarray(k * 12, k * 12 + 12)].map((x) => +x.toFixed(3));
  const k = Math.min(62 / 25, 62 / 41), rw = +((25 * k) / 64).toFixed(3), rh = +((41 * k) / 64).toFixed(3);
  assert.deepEqual(row(0), [0, 25, 41, 0, 1, 1, 1, 1, 0.5, 1, rw, rh], 'its cell, its sizes, its item; white; its tip on the place; the share of its cell the picture fills');
  assert.deepEqual(row(1).slice(0, 3), [0, 25, 41], '[0, 0]: the picture\'s own pixels');
  assert.deepEqual(row(2).slice(0, 3), [0, 20, 32.8], '[20, 0]: its height by its shape');
  assert.equal(row(3)[0], -1, 'a picture not in the atlas: nothing drawn');
  // the atlas grows: the new picture drawn once it is in the texture (made again), the items written again
  const v = pics.version; pics.add('star', star); assert.ok(pics.version > v);
  await steps(w, 3);
  assert.equal(fg.textures.filter((t) => t.label === 'icons').length, 2, 'the texture made again with the new picture');
  assert.equal(row(3)[0], 1, 'the new picture\'s cell');
  assert.equal(pics.cols * pics.rows >= 2, true);
  w.dispose();
});

// ── core › encoding › layers › stack: each feature's order inside its layer (G3) ──
test('feature.order: points and icons drawn in it (their records written again, nothing built), lines and areas built in it', async () => {
  const { points } = await import('../src/core/encoding/marks/points.ts');
  const { line } = await import('../src/core/encoding/marks/line.ts');
  const { icon, icons } = await import('../src/core/encoding/marks/icon.ts');
  const fg = standIn(), { w } = fg;
  const rows = new Rows([0, 1, 2, 3].map((i) => ({ id: `p${i}`, lon: LON + i * 1e-3, lat: LAT, z: [2, 0, 3, 1][i] })));
  const paths = new Rows([0, 1, 2].map((i) => ({ id: `l${i}`, props: { z: [1, 2, 0][i] }, geometry: { type: 'LineString', coordinates: [[LON, LAT + i * 1e-3], [LON + 0.01, LAT + i * 1e-3]] } })));
  const pins = [0, 1, 2].map((i) => ({ id: `m${i}`, props: { z: [5, -1, 0][i] }, geometry: { type: 'Point' as const, coordinates: [LON, LAT] as [number, number] } }));
  w.add(points({ id: 'dots', data: rows, feature: { order: (d) => d.props.z } }), line({ id: 'paths', data: paths, feature: { order: (d) => d.props.z } }),
    icon({ id: 'pins', of: pins, icons: icons({ a: { width: 8, height: 8 } as never }), icon: 'a', feature: { order: (d) => d.props.z as number } }));
  await steps(w, 4);
  const dots = w.element('dots') as unknown as { entries: { index: number; id: string }[] };
  const recIds = () => { const d = bufOf(fg, 'dots instances')!.data!; const byIdx = new Map(dots.entries.map((e) => [e.index, e.id])); return [0, 1, 2, 3].map((k) => byIdx.get(d[k * 4 + 3]!)); };
  assert.deepEqual(recIds(), ['p1', 'p3', 'p0', 'p2'], 'the points drawn lowest first');
  const builtLines = (w.element('paths') as unknown as { buildList(): { id: string }[] }).buildList().map((e) => e.id);
  assert.deepEqual(builtLines, ['l2', 'l0', 'l1'], 'the lines built lowest first');
  const slots = (texOf(fg, 'pins items')!.data as Float32Array);
  assert.deepEqual([0, 1, 2].map((k) => slots[k * 12 + 3]), [1, 2, 0], 'the icons slots hold their items lowest first');
  // a change of one order: the points' records written again, no new shapes; the lines built again in the new order
  const dotsVer = bufOf(fg, 'dots instances')!.version;
  rows.patch('p2', { z: -5 }); paths.patch('l2', { props: { z: 9 } });
  await steps(w, 3);
  assert.deepEqual(recIds(), ['p2', 'p1', 'p3', 'p0']);
  assert.ok(bufOf(fg, 'dots instances')!.version > dotsVer, 'records written again');
  assert.deepEqual((w.element('paths') as unknown as { buildList(): { id: string }[] }).buildList().map((e) => e.id), ['l0', 'l1', 'l2']);
  w.dispose();
});

// ── core › encoding › marks › symbols › point: a stroke per point (G9) ──
test("points: each feature's own outline colour and width (the mark's own plane, the numbers' fourth); the same for all: uniforms", async () => {
  const { points } = await import('../src/core/encoding/marks/points.ts');
  const fg = standIn(), { w } = fg;
  const rows = new Rows([0, 1, 2].map((i) => ({ id: `p${i}`, lon: LON + i * 1e-3, lat: LAT, c: ['#ff0000', '#00ff00', '#0000ff'][i], wd: i + 1 })));
  w.add(points({ id: 'each', data: rows, outline: { color: (d) => d.props.c, width: (d) => d.props.wd } }), points({ id: 'all', data: rows, outline: { color: '#ffffff', width: 2 } }));
  await steps(w, 4);
  type M = { slots: Int8Array; featData: Float32Array; at(i: number, k: number): number; entries: { index: number; id: string }[]; L: Float32Array };
  const each = w.element('each') as unknown as M, all = w.element('all') as unknown as M;
  assert.ok(each.slots[6]! >= 0 && each.slots[3]! >= 0, 'its own plane and its numbers on the chip');
  const of = (m: M, id: string, k: number) => { const e = m.entries.find((x) => x.id === id)!, q = m.at(e.index, k); return [...m.featData.subarray(q, q + 4)].map((x) => +x.toFixed(3)); };
  assert.deepEqual(of(each, 'p1', 6), [0, 1, 0, 1], 'p1 outlined green');
  assert.deepEqual(of(each, 'p2', 6), [0, 0, 1, 1]);
  assert.equal(of(each, 'p2', 3)[3], 3, 'p2 outlined 3 px wide');
  // the same for every feature: nothing more on the chip, its colour a uniform (k6), its width the numbers' constant
  assert.equal(all.slots[6], -1);
  assert.deepEqual([...all.L.subarray(64, 72)].map((x) => +x.toFixed(3)), [-1, 0, 0, 0, 1, 1, 1, 1]);
  // a restyle: one feature's outline changed, nothing built again
  const built = bufOf(fg, 'each instances')!.version;
  rows.patch('p0', { c: '#ffff00' }); await steps(w, 2);
  assert.deepEqual(of(each, 'p0', 6), [1, 1, 0, 1]);
  assert.equal(bufOf(fg, 'each instances')!.version, built, 'its places not written again');
  w.dispose();
});

// ── core › encoding › marks › lines › line: strokes as web maps draw them (G8) ──
test("line: dashes and their offset per feature (the mark's own plane, the numbers' fourth), caps and joins", async () => {
  const { line } = await import('../src/core/encoding/marks/line.ts');
  const fg = standIn(), { w } = fg;
  const paths = new Rows([0, 1, 2].map((i) => ({ id: `l${i}`, props: { d: [[4, 2], [10, 5, 1, 5], [3]][i], o: i * 2 }, geometry: { type: 'LineString', coordinates: [[LON, LAT + i * 1e-3], [LON + 0.01, LAT + i * 1e-3]] } })));
  w.add(line({ id: 'each', data: paths, dashes: (d) => d.props.d, dashOffset: (d) => d.props.o, caps: 'square', joins: 'round' }), line({ id: 'all', data: paths, dashes: [6, 3] }), line({ id: 'plain', data: paths }));
  await steps(w, 4);
  type M = { slots: Int8Array; featData: Float32Array; at(i: number, k: number): number; entries: { index: number; id: string }[]; L: Float32Array };
  const m = (id: string) => w.element(id) as unknown as M;
  const of = (x: M, id: string, k: number) => { const e = x.entries.find((y) => y.id === id)!, q = x.at(e.index, k); return [...x.featData.subarray(q, q + 4)]; };
  assert.ok(m('each').slots[6]! >= 0, 'dashes of its own on the chip');
  assert.deepEqual(of(m('each'), 'l0', 6), [4, 2, 0, 0]);
  assert.deepEqual(of(m('each'), 'l1', 6), [10, 5, 1, 5], 'two pairs');
  assert.deepEqual(of(m('each'), 'l2', 6), [3, 3, 0, 0], 'an odd list doubled');
  assert.equal(of(m('each'), 'l1', 3)[3], 2, 'its offset');
  assert.deepEqual([...m('each').L.subarray(28, 32)], [1, 1, 2, 1], 'square caps, round joins');
  assert.equal(m('all').slots[6], -1, 'the same for all: a uniform');
  assert.deepEqual([...m('all').L.subarray(68, 72)], [6, 3, 0, 0]);
  assert.deepEqual([...m('plain').L.subarray(68, 72)], [0, 0, 0, 0], 'none');
  assert.deepEqual([...m('plain').L.subarray(28, 32)], [1, 1, 0, 0], 'round caps, bevelled joins: as before');
  w.dispose();
});

// ── core › observation › observers › orbit › views: a zoom at the canvas's own pixels (a web map's scale) ──
test("frame 'pixels': a zoom is the web map's at the canvas's own pixels, whatever its height; kept as the canvas changes", async () => {
  const { world } = await import('../src/core/world/world.ts');
  const w = await world(null, { frame: 'pixels', view: { lon: 145.12, lat: -37.92, zoom: 14 } });
  const mpp = (z: number) => (156543.03392804097 * Math.cos((-37.92 * Math.PI) / 180)) / 2 ** z;
  for (const h of [400, 800, 1300]) {
    w.camera.width = 900; w.camera.height = h; w.go({ lon: 145.12, lat: -37.92, zoom: 14 }); w.step(16);
    assert.ok(Math.abs(w.camera.pixelSize / mpp(14) - 1) < 1e-6, `${h} px tall: ${w.camera.pixelSize} m a px`);
    assert.ok(Math.abs(w.camera.zoom - 14) < 1e-9);
  }
  // the canvas made taller: the same zoom, the same metres a pixel (more of the map seen)
  (w.camera as unknown as { update(w: number, h: number, dt: number): void }).update(900, 650, 16);
  assert.ok(Math.abs(w.camera.zoom - 14) < 1e-9 && Math.abs(w.camera.pixelSize / mpp(14) - 1) < 1e-6);
  w.dispose();
});
