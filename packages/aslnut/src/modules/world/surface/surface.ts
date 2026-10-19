// modules › world › surface: a body's ground as web-map tiles, on the globe and flat, with terrain, on WebGPU and
// WebGL2 alike. Each frame the quadtree picks the tiles the camera needs; each tile's imagery list is painted in order
// into one layer of a texture array, its terrain list composed into heights; one instanced draw shows them all.
// Hooks: shader: { position, color } (see core/render/graphics/shaders/hooks.ts).
import { composeOf, type ComposePart } from '../../../core/data/loading/decode.ts';
import { LoaderMiss, type Priority } from '../../../core/data/loading/loader.ts';
import { AslnutError } from '../../../core/world/errors.ts';
import { Element, type AttachContext, type FrameContext, type ElementProps, type ElementStatus } from '../../../core/world/element.ts';
import type { State } from '../../../core/world/state.ts';
import type { Camera } from '../../../core/observation/observers/orbit/camera.ts';
import { shown, valueOf, type Fn } from '../../../core/observation/presence.ts';
import type { DrawCall, GBuffer, GroundDraw, GTarget, GTexture, Graphics, Program } from '../../../core/render/graphics/interface.ts';
import { APP_FADE } from '../../../core/render/reveal/index.ts';
import { HOOK_POINTS, assemble, paramBlock, type ShaderCode } from '../../../core/render/graphics/shaders/hooks.ts';
import { SURFACE_GLSL } from '../../../core/render/graphics/shaders/surface.glsl.ts';
import { SURFACE_WGSL } from '../../../core/render/graphics/shaders/surface.wgsl.ts';
import { SEA_FLOATS } from '../../../core/render/graphics/shaders/sea.wgsl.ts';
import { D, mercY, R, tileBBox, tileBounds, worldAtUnwrapped, wrap } from '../../../core/space/geo.ts';
import { poseOf, wantFor, type Want } from './quadtree.ts';
import { COMPOSITE, TILE, composeHeights, covers, type Imagery, type Terrain } from './sources.ts';
import { N, REC, TileSet, tkey, untkey, type Entry, type Loaded } from './tiles.ts';

/** a pool's cap by the device's memory (navigator.deviceMemory, GB; not said: none): 2 GB or less holds 64 imagery
 *  layers (16 MB) and 32 overlay layers (32 MB), 4 GB 64 overlay layers */
function memoryCap(pool: 'imagery' | 'overlays'): number {
  const gb = typeof navigator !== 'undefined' ? (navigator as { deviceMemory?: number }).deviceMemory : undefined;
  if (!gb) return Infinity;
  if (pool === 'imagery') return gb <= 2 ? 64 : Infinity;
  return gb <= 2 ? 32 : gb <= 4 ? 64 : Infinity;
}
/** the budget's steps for the ground beyond the view's centre (each a further coarsening there) */
const FAR_STEPS = [0, 0.6, 1.5, 3, 6];
/** a colour grade over the whole surface: imagery 0 (a flat `base` colour) … 1 (the imagery); saturation;
 *  brightness; contrast; a tint by lightness; how much of the imagery's light and dark stays in the base (detail) */
export interface SurfaceGrade { imagery: number; base: [number, number, number]; saturation: number; brightness: number; contrast: number; tint: [number, number, number]; tintAmount: number; detail: number }
export interface SurfaceProps extends ElementProps {
  imagery: Imagery[];
  terrain: Terrain[];
  /** always painted first, under the imagery list (an offline basemap) */
  base?: Imagery | null;
  exaggerate?: Fn<number>;
  /** the size a tile should have on screen (CSS px): smaller = sharper and more tiles (default: the profile's) */
  tilePx?: number;
  maxZoom?: number;
  /** the colour under the imagery (the sea where it is transparent) */
  empty?: [number, number, number];
  /** ground with nothing loaded yet, not even a coarse parent (dark: a hole never flashes white) */
  missing?: [number, number, number];
  horizon?: [number, number, number];
  /** hillshade strength on terrain, 0..1 */
  shade?: number;
  grade?: Partial<SurfaceGrade>;
  /** a flat body's extent [w, s, e, n]: tiles outside are not drawn */
  bounds?: [number, number, number, number];
  /** ms a tile waits, after its first source answered, for the others before it is shown with what it has (the rest
   *  follow at once); 0 = never wait */
  patience?: number;
  /** how a tile's own image reaches the graphics: 'pixels' (default) decoded in a worker and written as bytes — the
   *  same small, steady cost on every chip; 'image' the decoded image handed over as it is — fastest on desktop chips,
   *  but some phone drivers convert it on the main thread (50–60 ms a tile measured on a mid-range phone) */
  upload?: 'pixels' | 'image';
}
const M = N + 2;
/** a tile overlay's scale record: 0 west, 1 east (degrees), 2 north, 3 south (latitude), 4 north, 5 south (Mercator
 *  y), 6..9 the ground's height at the corners (× exaggeration, m), 10..13 metres per CSS pixel at the corners when it
 *  was drawn, 14 the ground version those heights are from */
const SC = 15;
/** a tile overlay: its texture layer, the look it was drawn in, when it was last used, its scale record */
type Ovl = { slot: number; ver: string; used: number; sc: Float64Array };
/** what each imagery source gave a tile: a canvas it drew, a piece of an image, or pixels (undefined: not in yet) */
type Got = ({ c?: OffscreenCanvas; b?: { im: ImageBitmap; sx: number; sy: number; size: number }; px?: { width: number; height: number; data: Uint8ClampedArray }; k: number; src: Imagery } | null | undefined)[];
const GRADE: SurfaceGrade = { imagery: 1, base: [0.06, 0.12, 0.25], saturation: 1, brightness: 1, contrast: 1, tint: [0.1, 0.2, 0.45], tintAmount: 0, detail: 0.6 };

export class Surface extends Element<SurfaceProps> {
  readonly kind = 'basemap' as const;
  private tiles: TileSet | null = null;
  private g: Graphics | null = null;
  private tex: GTexture | null = null; private recTex: GTexture | null = null; private hTex: GTexture | null = null;
  /** the tiles' records, written every frame: three in turn, so a frame never writes what one still in flight reads */
  private recRing: GTexture[] = []; private recI = 0;
  private index: GBuffer | null = null; private ubuf: GBuffer | null = null; private pbuf: GBuffer | null = null;
  private prog: Program | null = null;
  private u = new Float32Array(36);
  private want: Want[] = [];
  private ver = '';
  private ahead: { lon: number; lat: number; dist: number; bearing?: number; pitch?: number }[] = [];
  private turns: (() => void)[] = [];
  private canvas: OffscreenCanvas | null = null;
  private pool: OffscreenCanvas[] = [];
  private s: State | null = null;
  private layersN = 0; private layersCap = 0;
  /** the imagery pool's first size and its steps (layers of 256 × 256: 256 kB each) */
  static imageryStart = 32; static imageryStep = 16;
  /** the overlay pool's steps (layers of 512 × 512: 1 MB each) */
  static overlayStep = 8;
  /** growths in a row whose copy did not land before the imagery pool is held where it is */
  static growTries = 3;
  private growFailed = 0;
  /** the pools' layers now and their caps (imagery 256 kB a layer, overlays 1 MB a layer) */
  get pools(): { imagery: number; imageryCap: number; overlays: number; overlaysCap: number } { return { imagery: this.layersN, imageryCap: this.layersCap, overlays: this.ovlK, overlaysCap: this.ovlCap() }; }
  /** the imagery pool made bigger (the view needs more tiles than it holds): its layers copied, none loaded again */
  private growImagery(need: number): void {
    const g = this.g; if (!g || !this.tex || !this.hTex || !this.tiles) return;
    const n = Math.min(this.layersCap, Math.ceil(need / Surface.imageryStep) * Surface.imageryStep);
    if (n <= this.layersN) return;
    const tex = g.texture({ label: 'surface imagery', width: TILE, height: TILE, layers: n, format: 'rgba8', filter: 'linear', growable: true });
    const hTex = g.texture({ label: 'surface heights', width: N, height: N, layers: n, format: 'r32f', growable: true });
    // a copy that did not land (WebGL2 refused it under a busy GPU process): the pool stays as it was, every tile in it
    // still shown, and grows at the next need; one that never lands holds the pool where it is (its tiles coarser)
    if (!g.copyLayers(this.tex, tex, this.layersN) || !g.copyLayers(this.hTex, hTex, this.layersN)) {
      tex.destroy(); hTex.destroy();
      if (++this.growFailed >= Surface.growTries) this.layersCap = this.layersN;
      return;
    }
    this.growFailed = 0;
    this.tex.destroy(); this.hTex.destroy(); this.tex = tex; this.hTex = hTex;
    this.tiles.grow(n); this.layersN = n;
    if (this.lastDraw?.textures) { this.lastDraw.textures[0] = tex; this.lastDraw.textures[2] = hTex; }
  }

  constructor(p: SurfaceProps) { super({ id: 'surface', ...p }); }

  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    const g = ctx.graphics; if (!g) return;
    this.g = g;
    const prof = ctx.profile;
    // the imagery pool: as many layers as the view needs, in steps, up to the profile's and the device memory's cap
    // (a pool that cannot be copied into a bigger one, WebGL2 without float targets for the heights: its cap at once)
    this.layersCap = Math.min(g.caps.maxLayers, prof?.tileLayers ?? 160, memoryCap('imagery'));
    this.layersN = g.api === 'webgpu' || g.caps.floatTargets ? Math.min(this.layersCap, Surface.imageryStart) : this.layersCap;
    const maxTiles = 400;
    this.tex = g.texture({ label: 'surface imagery', width: TILE, height: TILE, layers: this.layersN, format: 'rgba8', filter: 'linear', growable: true });
    this.hTex = g.texture({ label: 'surface heights', width: N, height: N, layers: this.layersN, format: 'r32f', growable: true });
    this.recRing = [0, 1, 2].map((i) => g.texture({ label: `surface tiles ${i}`, width: REC / 4, height: maxTiles, format: 'rgba32f' }));
    this.recTex = this.recRing[0]!;
    // the ground marks' overlays: one blank layer until a mark lies on the ground
    this.ovlTex = g.texture({ label: 'surface overlay (none)', width: 1, height: 1, layers: 1, format: 'rgba8', filter: 'linear' });
    const idx: number[] = [];
    for (let j = 0; j < M - 1; j++) for (let i = 0; i < M - 1; i++) { const a = j * M + i; idx.push(a, a + M, a + 1, a + 1, a + M, a + M + 1); }
    this.index = g.buffer('index', new Uint32Array(idx), 'surface index');
    this.ubuf = g.buffer('uniform', 36 * 4, 'surface');
    this.paramBlock ??= paramBlock({});
    this.pbuf = g.buffer('uniform', this.paramBlock.size, 'surface params');
    // the sea's look when the world's sea has none (its first number 0: the plain sea), and no coast's field
    this.noSea = g.buffer('uniform', new Float32Array(SEA_FLOATS), 'surface no sea look');
    this.noField = g.texture({ label: 'surface no coast field', width: 1, height: 1, format: 'r32f', filter: 'nearest' });
    this.prog = this.build(this.props.shader ?? {});
    this.canvas = new OffscreenCanvas(TILE, TILE);
    this.tiles = new TileSet({
      // loads at once: a view's first image is a few rounds of them (HTTP/2 hosts answer many at once; a host's own
      // limit holds in the loader)
      // Apps use the short reveal policy for imagery and late terrain alike.
      ...(ctx.world.context === 'app' ? { fade: APP_FADE * 1000, fadeH: APP_FADE * 1000 } : {}),
      layers: this.layersN, maxTiles, inflight: prof?.quality === 'lite' ? 10 : 12,
      load: (e, ver, slot, o) => this.compose(e, ver, slot, o),
      writeHeights: (slot, h) => this.hTex?.write(h, { layer: slot }),
      isMiss: (err) => err instanceof LoaderMiss,
    });
    // Tile requests and worker decoding can run while the surface program compiles.
    await this.prog.ready;
  }
  private build(code: ShaderCode): Program {
    const src = assemble({ wgsl: SURFACE_WGSL, glsl: SURFACE_GLSL }, HOOK_POINTS.surface, code, this.paramBlock ?? paramBlock({}), `layer '${this.id}'`);
    return this.g!.program({
      label: `surface ${this.id}`, wgsl: src.wgsl, glsl: src.glsl, blocks: ['Frame', 'U', 'Params', 'Sea'],
      textures: [{ name: 'imagery', kind: '2d-array', sample: 'float' }, { name: 'tiles', kind: '2d', sample: 'unfilterable' }, { name: 'heights', kind: '2d-array', sample: 'unfilterable' }, { name: 'overlay', kind: '2d-array', sample: 'float' }, { name: 'shadowMap', kind: '2d', sample: 'float' }, { name: 'seaField', kind: '2d', sample: 'unfilterable' }],
      depth: { write: true, test: 'less' }, cull: 'none',
    });
  }
  /** swap the shader code (hot reload): the old program stays if the new one fails, and the error is thrown */
  async setShader(code: ShaderCode): Promise<void> {
    if (!this.g) { this.props = { ...this.props, shader: code }; return; }
    const p = this.build(code);
    await p.ready.catch((e) => { p.destroy(); throw e; });
    this.prog?.destroy(); this.prog = p; this.props = { ...this.props, shader: code };
  }

  /** views the camera will reach soon: their tiles load in the background when the view leaves room (only from
   *  sources whose terms allow prefetching) */
  prefetch(views: { lon: number; lat: number; dist?: number; zoom?: number; bearing?: number; tilt?: number; pitch?: number }[], o: { depth?: number } = {}): void {
    this.ahead = views.map((v) => ({ lon: v.lon, lat: v.lat, dist: v.dist ?? 6378137 * 3, bearing: v.bearing, pitch: v.pitch ?? (v.tilt !== undefined ? (90 - v.tilt) * D : undefined) }));
    this.aheadDepth = o.depth ?? 1; this.aheadWant = null;
  }
  private aheadDepth = 1; private aheadWant: Want[][] | null = null;
  /** the tiles of the views ahead (worked out once per prefetch) */
  private aheadTiles(): Want[][] {
    const cam = this.attached?.camera; if (!cam || !this.ahead.length) return [];
    return (this.aheadWant ??= this.ahead.map((v) => wantFor(poseOf(v, cam, cam.groundY), this.qopts())));
  }
  /** load the views ahead now (between frames too: a still view's idle time) and say how far it got */
  pumpAhead(): { needed: number; have: number } | null {
    const t = this.tiles; if (!t || !this.ver || !this.ahead.length) return null;
    const ws = this.aheadTiles();
    t.aheadOf(ws.map((tiles) => ({ tiles, prefetch: () => true, depth: this.aheadDepth })), this.ver);
    let needed = 0, have = 0; for (const w of ws) { needed += w.length; have += t.had(w, this.ver); }
    return { needed, have };
  }
  /** every URL these views will fetch: their tiles, the fallbacks, the base; per source and terrain */
  plan(views: { lon: number; lat: number; dist: number; bearing?: number; pitch?: number }[]): string[] {
    const cam = this.attached!.camera, keys = new Set<string>();
    for (const v of views) for (const t of wantFor(poseOf(v, cam), this.qopts())) {
      keys.add(`${t.z}/${t.x}/${t.y}`);
      for (const u of [1, 2]) if (t.z - u > 2) keys.add(`${t.z - u}/${t.x >> u}/${t.y >> u}`);
      const b = t.z - Math.min(t.z, 2); keys.add(`${t.z - b}/${t.x >> b}/${t.y >> b}`);
    }
    const urls = new Set<string>(), s = this.s;
    for (const k of keys) {
      const [z, x, y] = k.split('/').map(Number) as [number, number, number], t = { z, x, y };
      for (const src of [...(this.props.base ? [this.props.base] : []), ...this.props.imagery, ...this.props.terrain]) if ((!s || shown(src.when, s) > 0) && covers(src, t)) { const u = src.urlFor?.(t); if (u) urls.add(u); }
    }
    return [...urls];
  }
  private qopts() {
    return { tilePx: this.props.tilePx ?? this.attached?.profile?.tilePx ?? 300, maxZoom: this.props.maxZoom ?? 20, maxTiles: 400, hiOf: (z: number, x: number, y: number) => (this.tiles?.hiOf(z, x, y) ?? 0) * this.exag(), bounds: this.props.bounds };
  }
  private exag(): number { return this.s ? valueOf(this.props.exaggerate ?? 1, this.s) : typeof this.props.exaggerate === 'number' ? this.props.exaggerate : 1; }
  /** the imagery and terrain shown now (their `when`), as the look tiles are drawn in */
  private active(s: State): { imagery: { src: Imagery; k: number }[]; terrain: Terrain[]; ver: string } {
    const imagery: { src: Imagery; k: number }[] = [];
    for (const src of [...(this.props.base ? [this.props.base] : []), ...this.props.imagery]) { const k = Math.round(shown(src.when, s, `imagery '${src.id}'`) * 4) / 4; if (k > 0) imagery.push({ src, k }); }
    // raster layers paint after the body's imagery, in their draw order
    for (const l of this.attached?.world.elementsOfKind('raster') ?? []) { const src = (l as unknown as { painted?: () => Imagery | null }).painted?.(); if (src) imagery.push({ src, k: 1 }); }
    const terrain = this.props.terrain.filter((t) => shown(t.when, s, `terrain '${t.id}'`) > 0);
    const ver = imagery.map((i) => `${i.src.id}:${i.src.version}:${i.src.opacity * i.k}:${i.src.blend}`).join('|') + `#${terrain.map((t) => `${t.id}:${t.version}`).join('|')}#${(this.props.empty ?? [0.79, 0.89, 0.95]).join(',')}`;
    return { imagery, terrain, ver };
  }

  frame(ctx: FrameContext): DrawCall[] {
    const g = this.g, tiles = this.tiles; if (!g || !tiles || !this.prog) return [];
    this.s = ctx.s;
    // uploads: a few per frame, within a time budget (a burst of arriving tiles never makes a long frame)
    const t0 = performance.now(), most = this.attached?.profile?.quality === 'lite' ? 3 : 6;
    let ran = 0;
    for (let i = 0; i < most && this.turns.length && (i === 0 || performance.now() - t0 < 2); i++) { this.turns.shift()!(); ran++; }
    const t1 = performance.now(); this.cost.uploadMs = t1 - t0; this.cost.uploads = ran; this.cost.queued = this.turns.length;
    const cam = ctx.camera, act = this.active(ctx.s);
    this.ver = act.ver; this.act = act;
    const tk = act.terrain.map((t) => `${t.id}:${t.version}`).join('|');
    if (tk !== this.terrainKey) { this.terrainKey = tk; this.terrainBumps++; }
    const q = this.qopts();
    // hysteresis while the camera moves (no flicker of levels); none when it is still: a still view always gets
    // the same tiles, whatever the way it came (captures, states, settled frames are exact)
    const sp = this.split; [sp.prev, sp.next] = [sp.next, sp.prev];
    if (!cam.moving) sp.prev.clear();
    // never more tiles than the texture layers can hold with room to load and fall back (a tilted view on a big
    // screen asked for more, and tiles pushed each other out forever): coarser until they fit
    const pose = { lon: cam.lon, lat: cam.lat, morph: cam.morph, eye: cam.eye, vp: cam.viewProj, H: cam.height, fov: cam.fov, dist: cam.dist, groundY: cam.groundY };
    let fit = Math.floor(this.layersN * 0.6);
    // (it starts from last frame's coarseness: a tilted view that needed coarser tiles needs them the next frame too;
    // a finer one is tried again every few frames, and always when the camera stops)
    // (the governor's detail below 1: bigger tiles on screen, fewer of them)
    const dk = 1 / Math.max(0.25, this.detailOf(ctx.s));
    // (coarser steps: first the ground beyond the view's centre, more and more (a tilted view's far side: the centre
    // keeps its detail); then every tile a little bigger on screen)
    const at = (k: number) => wantFor(pose, { ...q, tilePx: q.tilePx * dk * 1.35 ** Math.max(0, k - FAR_STEPS.length + 1), far: FAR_STEPS[Math.min(k, FAR_STEPS.length - 1)], maxTiles: Math.min(q.maxTiles, fit * 2), split: sp });
    let k = cam.moving ? this.coarse : 0;
    this.want = at(k);
    // (more tiles than the pool holds with room to spare: the pool grows, in steps up to its cap, before any tile is
    // made coarser)
    if (k === 0 && this.want.length > fit && this.layersN < this.layersCap) { this.growImagery(Math.ceil(this.want.length / 0.6)); fit = Math.floor(this.layersN * 0.6); this.want = at(0); }
    while (this.want.length > fit && k < FAR_STEPS.length + 3) this.want = at(++k);
    if (k > 0 && cam.moving && (this.coarseTry = (this.coarseTry + 1) % 8) === 0) { const finer = at(k - 1); if (finer.length <= fit) { this.want = finer; k--; } }
    this.coarse = k;
    // the camera's path ahead: compose() asks only sources whose terms allow prefetching
    const ahead = this.aheadTiles().map((tiles) => ({ tiles, prefetch: () => true, depth: this.aheadDepth }));
    // A still view can fill the sources' existing host queues in parallel. Motion keeps the smaller window so
    // requests that the camera passes do not displace the new view; uploads keep the same per-frame budget.
    const inflight = cam.moving ? (this.attached?.profile?.quality === 'lite' ? 10 : 12) : 16;
    tiles.update(this.want, act.ver, ctx.loadNow ?? ctx.now, cam, ahead, inflight);
    this.cost.tilesMs = performance.now() - t1;
    let zm = 0; for (const t of this.want) if (t.z > zm) zm = t.z; this.zMax = zm;
    this.recI = (this.recI + 1) % this.recRing.length; this.recTex = this.recRing[this.recI]!;
    if (tiles.count) this.recTex.write(tiles.recs.subarray(0, tiles.count * REC), { width: REC / 4, height: tiles.count });
    const p = this.props, gr = { ...GRADE, ...p.grade }, ex = act.terrain.length ? this.exag() : 0, alt = cam.dist, u = this.u;
    u.set([cam.lat * D, Math.cos(cam.lat * D), Math.sin(cam.lat * D), cam.morph], 0);
    u.set([ex, act.terrain.length ? p.shade ?? 0.6 : 0, alt * 6, alt * 40], 4);
    u.set([...(p.empty ?? [0.79, 0.89, 0.95]), 1], 8);
    u.set([...(p.horizon ?? [0.82, 0.88, 0.94]), 1], 12);
    u.set([...gr.tint, gr.tintAmount], 16);
    u.set([gr.saturation, gr.brightness, gr.contrast, gr.detail], 20);
    u.set([...gr.base, gr.imagery], 24);
    u.set([...(p.missing ?? [0.05, 0.08, 0.12]), 1], 28);
    // the world's sea (a layer gives it): the ground under its level drawn as water; none: r < 0
    const sea = ctx.sea; u.set(sea ? [sea.color[0], sea.color[1], sea.color[2], sea.level * ex] : [-1, 0, 0, 0], 32);
    this.ubuf!.write(u);
    if (this.paramsDirty && this.paramBlock) { this.pbuf!.write(this.paramBlock.pack(this.paramValues)); this.paramsDirty = false; }
    if (!tiles.count) return [];
    // in the picking pass the ground draws nothing but its depth (what is behind a hill is not picked)
    const prog = this.prog;
    this.lastDraw = { program: prog, blocks: [ctx.frame, this.ubuf!, this.pbuf!, sea?.look?.block ?? this.noSea!], textures: [this.tex!, this.recTex!, this.hTex!, this.ovlTex!, ctx.shadowMap!, sea?.look?.field ?? this.noField!], index: this.index!, count: (M - 1) * (M - 1) * 6, instanceCount: tiles.count, pickProgram: () => prog } as DrawCall;
    return [this.lastDraw];
  }
  private act: ReturnType<Surface['active']> | null = null; private lastDraw: DrawCall | null = null;
  private noSea: GBuffer | null = null; private noField: GTexture | null = null;
  private cost = { uploadMs: 0, uploads: 0, tilesMs: 0, queued: 0 };
  /** the last frame's cost (the world's profile) */
  frameCost() { const c = this.cost; return { uploadMs: +c.uploadMs.toFixed(2), uploads: c.uploads, tilesMs: +c.tilesMs.toFixed(2), queued: c.queued }; }
  /** the coarseness last frame needed (tilePx × 1.35^k), and a counter for trying finer again */
  private coarse = 0; private coarseTry = 0;
  /** how coarse the tiles were kept to fit the texture layers (0: as the screen asks) */
  get coarseness(): number { return this.coarse; }
  private split = { prev: new Set<number>(), next: new Set<number>() };

  /** work to do inside a frame (uploads): run by frame() within its budget, so loading never stalls a frame */
  private inFrame<T>(f: () => T): Promise<T> { return new Promise((ok, bad) => this.turns.push(() => { try { ok(f()); } catch (e) { bad(e); } })); }
  private canvasOf(): OffscreenCanvas {
    // its pixels are read (the tile's picture is composed in a worker): kept in memory, not on the graphics chip. On the
    // chip each read went through the graphics process: a tile's compose took 0.9 s instead of 81 ms (p50, WebGPU on a
    // normal run; WebGL2 265 ms instead of 34), about 2 s instead of 4 ms with that process busy
    const c = this.pool.pop() ?? new OffscreenCanvas(TILE, TILE), g = c.getContext('2d', { willReadFrequently: true })!;
    g.setTransform(1, 0, 0, 1, 0, 0); g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, TILE, TILE);
    return c;
  }
  /** paint a tile's imagery in order, into texture layer `slot`. The usual case (the top source covers the tile, at
   *  its own level) uploads its decoded image as it is: no canvas, no pixels through JavaScript; otherwise the sources
   *  (drawn on canvases kept in memory) are composed in a worker and uploaded as pixels. Nothing slow holds the first image
   *  back: in a hurry, what answered within `patience` ms of the first source is painted (a partial look, drawn again
   *  whole right after); heights that are not in yet come `later` and rise in under the imagery */
  private async compose(e: Entry, ver: string, slot: number, o: { priority: Priority; prefetch: boolean; lenient: boolean; hurry: boolean; signal?: AbortSignal }): Promise<Loaded | null> {
    const act = this.act; if (!act || act.ver !== ver) return null;
    const t = { z: e.z, x: e.x, y: e.y }, loader = this.attached!.loader, used: OffscreenCanvas[] = [];
    // ahead of need: only what the terms allow to be prefetched
    const ok = (src: { terms: { prefetch: boolean } }) => !o.prefetch || src.terms.prefetch;
    const sctx = { loader, priority: o.priority, prefetch: o.prefetch, signal: o.signal };
    let all: Promise<unknown> = Promise.resolve();
    try {
      type Part = { c?: OffscreenCanvas; b?: { im: ImageBitmap; sx: number; sy: number; size: number }; px?: { width: number; height: number; data: Uint8ClampedArray }; k: number; src: Imagery } | null;
      // the top opaque source as pixels decoded in a worker, written as they are: an image copy into a texture is slow
      // on some WebGPU implementations and on some phone drivers under WebGL2 (`upload: 'image'` hands the image over)
      const topPx = (this.props.upload ?? 'pixels') === 'pixels' ? act.imagery.length - 1 : -1;
      const got: (Part | undefined)[] = act.imagery.map(() => undefined);
      let first: (() => void) | null = null;
      const firstIn = new Promise<void>((r) => { first = r; });
      all = Promise.all(act.imagery.map(async ({ src, k }, i) => {
        try {
          if (t.z < src.minZoom || !covers(src, t) || !ok(src)) { got[i] = null; return; }
          try {
            if (i === topPx && src.pixels && src.opaque && !src.where && k * src.opacity >= 1 && src.blend === 'normal') { const px = await src.pixels(t, sctx); if (px && px.width === TILE && px.height === TILE) { got[i] = { px, k, src }; return; } }
            if (src.bitmap && !src.where) { const b = await src.bitmap(t, sctx); got[i] = b ? { b, k, src } : null; return; }
            const c = this.canvasOf(); used.push(c);
            got[i] = (await src.draw(c.getContext('2d')!, t, sctx)) ? { c, k, src } : null;
          } catch (err) {
            // after three failures a failing overlay is left out (lenient); a failing opaque base never is: the tile
            // would show the bare 'empty' colour (a white hole while it splits finer). It stays out, its ancestor
            // standing in, and is asked again later
            if (o.lenient && !(err instanceof LoaderMiss) && !(src.opaque && src.blend === 'normal' && k * src.opacity >= 1)) { got[i] = null; return; }
            throw err;
          }
        } finally { if (got[i]) first!(); }
      }));
      const terr = act.terrain.filter(ok);
      const hp = terr.length ? composeHeights(terr, t, N, sctx).catch((err) => { if (o.lenient && !(err instanceof LoaderMiss)) return null; throw err; }) : Promise.resolve(null);
      // handled from the start: an imagery failure or an abort below returns before anyone waits for the heights, and
      // their rejection (an abandoned load, on every fast zoom) must not surface as an unhandled one. Whoever takes
      // `later` still sees the rejection
      hp.catch(() => {});
      let partial = false;
      // in a hurry only where nothing stands in yet (the first image, a jump far away): elsewhere an ancestor's piece
      // shows meanwhile, and a partial look would only be drawn twice
      if (o.hurry && act.imagery.length > 1 && !this.tiles?.ancestorShown(e)) {
        // the first source that painted something, then a little patience for the rest; whatever is still out is
        // painted next time (a source that has nothing here does not start the wait)
        all.catch(() => {});
        await Promise.race([firstIn, all]);
        await Promise.race([all, new Promise((r) => setTimeout(r, this.props.patience ?? 150))]);
        partial = got.some((x) => x === undefined);
      } else await all;
      // heights: with the imagery if they are in already, else later (never holding the image back)
      let heights: Float32Array | null = null, later: Promise<Float32Array | null> | undefined;
      // a failed `hp` counts as "not in": it goes on as `later`, whose taker handles the failure (the race's own promise
      // never rejects, so it is never left unhandled after the timer won)
      const h0 = await Promise.race([hp.then((h) => ({ h }), () => null), new Promise<null>((r) => setTimeout(() => r(null), 0))]);
      if (h0) heights = h0.h; else later = hp;
      if (ver !== this.act?.ver) return null;
      // a tile the view no longer wants (a fast zoom went past it) is not uploaded
      if (!this.tiles?.wantedOrNear(e)) return null;
      // several sources in one picture: composed in a worker (the canvas work and its read-back off the main thread)
      const pre = await this.composed(got).catch(() => null);
      if (ver !== this.act?.ver || !this.tiles?.wantedOrNear(e)) return null;
      // the upload runs inside a frame, within that frame's budget
      const r = await this.inFrame(() => this.upload(got, slot, ver, heights, partial, later, pre));
      // ahead of need without a source whose terms allow no prefetching (show only): a look of its own, never taken
      // for the whole one (the tile loads again, whole, when the view reaches it)
      const held = o.prefetch && (act.imagery.some(({ src }) => !src.terms.prefetch && t.z >= src.minZoom && covers(src, t)) || act.terrain.some((src) => !src.terms.prefetch));
      return r && held ? { ...r, ahead: true } : r;
    } finally {
      // a canvas goes back to the pool only when its source has finished drawing into it (a partial look, a look
      // that changed meanwhile: a late draw must never land in a canvas another tile is using)
      void all.catch(() => {}).finally(() => this.pool.push(...used));
    }
  }
  /** what a tile shows (from the top-most source that covers it fully, up), and whether that is one picture as it
   *  is (its pixels, or one whole image) */
  private shows(got: Got): { from: number; whole: boolean } {
    let from = 0;
    for (let i = got.length - 1; i >= 0; i--) { const p = got[i]; if (p && p.k * p.src.opacity >= 1 && p.src.blend === 'normal' && p.src.opaque && (p.b || p.c || p.px)) { from = i; break; } }
    const top = got[from];
    if (top?.px && from === got.length - 1) return { from, whole: true };
    const only = got.slice(from).filter(Boolean).length === 1 && from === got.length - 1 || got.slice(from + 1).every((x) => !x);
    return { from, whole: !!(top?.b && only && from >= 0 && top.k * top.src.opacity >= 1 && top.src.opaque && top.b.sx === 0 && top.b.sy === 0 && top.b.size === TILE && top.b.im.width === TILE && top.b.im.height === TILE) };
  }
  /** the tile's picture composed in a worker when it is more than one picture as it is; null: nothing to compose */
  private async composed(got: Got): Promise<{ data: Uint8ClampedArray } | null> {
    const { from, whole } = this.shows(got); if (whole) return null;
    const parts: ComposePart[] = [];
    for (let i = from; i < got.length; i++) {
      const p = got[i]; if (!p) continue;
      const alpha = p.k * p.src.opacity, op = COMPOSITE[p.src.blend];
      if (p.b) parts.push({ im: p.b.im, sx: p.b.sx, sy: p.b.sy, sw: p.b.size, sh: p.b.size, alpha, op });
      else if (p.c) parts.push({ im: await createImageBitmap(p.c), sx: 0, sy: 0, sw: TILE, sh: TILE, alpha, op, own: true });
      else if (p.px) parts.push({ im: await createImageBitmap(new ImageData(new Uint8ClampedArray(p.px.data), p.px.width, p.px.height)), sx: 0, sy: 0, sw: p.px.width, sh: p.px.height, alpha, op, own: true });
    }
    const [r, g, b] = (this.props.empty ?? [0.79, 0.89, 0.95]).map((v) => Math.round(v * 255));
    const px = await composeOf(TILE, `rgb(${r},${g},${b})`, parts);
    return px.width === TILE && px.height === TILE ? px : null;
  }
  private upload(got: Got, slot: number, ver: string, heights: Float32Array | null, partial: boolean, later: Promise<Float32Array | null> | undefined, pre: { data: Uint8ClampedArray } | null = null): Loaded | null {
    {
      if (ver !== this.act?.ver || !this.canvas || !this.tex) return null;
      if (pre) { this.tex.write(pre.data, { layer: slot }); if (heights) this.hTex!.write(heights, { layer: slot }); return { heights, partial, later }; }
      // what shows: from the top-most source that covers the tile fully, up
      const { from, whole } = this.shows(got);
      const top = got[from];
      if (top?.px && from === got.length - 1) { this.tex.write(top.px.data, { layer: slot }); if (heights) this.hTex!.write(heights, { layer: slot }); return { heights, partial, later }; }
      if (whole && top?.b) {
        this.tex.writeImage(top.b.im, { layer: slot });
      } else {
        const g = this.canvas.getContext('2d')!;
        const [r, gg, b] = (this.props.empty ?? [0.79, 0.89, 0.95]).map((v) => Math.round(v * 255));
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over'; g.fillStyle = `rgb(${r},${gg},${b})`; g.fillRect(0, 0, TILE, TILE);
        for (let i = from; i < got.length; i++) {
          const part = got[i]; if (!part) continue;
          g.globalAlpha = part.k * part.src.opacity; g.globalCompositeOperation = COMPOSITE[part.src.blend];
          if (part.b) g.drawImage(part.b.im, part.b.sx, part.b.sy, part.b.size, part.b.size, 0, 0, TILE, TILE); else g.drawImage(part.c!, 0, 0);
        }
        g.globalAlpha = 1; g.globalCompositeOperation = 'source-over';
        this.tex.writeImage(this.canvas, { layer: slot });
      }
      if (heights) this.hTex!.write(heights, { layer: slot });
      return { heights, partial, later };
    }
  }

  override status(): ElementStatus {
    if (!this.attached) return { ready: false, pending: ['attaching'], failed: [], missing: [] };
    if (!this.tiles) return super.status();
    const st = this.tiles.settle(this.want, this.ver);
    const pending = st.pending ? [`${st.pending} tile(s) loading or fading in`] : this.want.length ? [] : ['no frame yet'];
    if (this.ovlPending) pending.push(`${this.ovlPending} tile(s) drawing their ground marks`);
    return { ready: st.done && !this.ovlPending, pending, failed: st.failed.map((f) => ({ what: `tile ${f.tile}`, error: f.error })), missing: st.missing.map((m) => `tile ${m}`) };
  }
  /** frames go on while tiles still draw their ground marks */
  override animating(_s: State): boolean { return this.ovlPending > 0; }

  // ── the ground marks' overlays ──────────────────────────────────────────────────────────────────────────────
  // Marks lying on the ground (areas, lines, outlines) are drawn into a texture layer per drawn tile, in the tile's
  // own map space, and the ground shows them: exact on any terrain (they are the ground's own picture), one pass for
  // the frame with nothing read back (a phone's chip never resolves its tiles mid-frame), and drawn again only when
  // something about them changed. A tile whose own is not drawn yet shows its nearest ancestor's piece meanwhile.
  private ovlTex: GTexture | null = null; private ovlK = 0; private ovlSize = 512; private ovlTargets: (GTarget | null)[] = [];
  private ovlSlots = new Map<number, Ovl>(); private ovlFree: number[] = [];
  private ovlEach: string[] = []; private ovlBufs: (GBuffer | null)[] = []; private ovlT = new Float32Array(12); private ovlKeys = new Set<number>(); private ovlShift = 0; private ovlClock = 0; private ovlPending = 0; private ovlVer = '';
  /** the shown overlays whose scale drifted too far from the camera's (drawn again within the budget); what that was
   *  last found for (the camera, its stillness, the ground, the overlays shown): found again only when one changed */
  private ovlCov = new Uint8Array(64);
  private ovlRescale = new Set<number>(); private ovlSig = new Float64Array(11).fill(NaN); private ovlNow = new Float64Array(4); private ovlSc = new Float64Array(SC);
  /** when a mark last lay on the ground's tiles (ms): the overlays are let go a while after the last one left */
  private ovlUsedAt = 0;
  /** how long the overlays are kept with no mark on the tiles (ms): a mark leaving them a moment (its clock started,
   *  then stopped again) finds them still there */
  static overlayKeepMs = 5000;
  /** how far (a ratio) the camera may take a tile overlay's scale from the one it was drawn with before it is drawn
   *  again: while the camera moves (a zoom does not draw every overlay every frame; a few a frame within the budget)
   *  and once it is still (a settled view's lines within a few % of their width; a small move draws nothing) */
  static overlayDrift = { moving: 1.3, still: 1.08 };
  /** the overlay pool's cap: the profile's (64 layers at lite, 128 else), the device memory's */
  private ovlCap(): number { const g = this.g; return g ? Math.min(g.caps.maxLayers, this.attached?.profile?.quality === 'lite' ? 64 : 128, memoryCap('overlays')) : 0; }
  /** the overlays for `need` layers (the tiles the marks cover now, and the covers a level up): made at the first
   *  step that holds them, grown (copied over: nothing drawn again) when a view needs more, up to the cap */
  private ensureOverlays(need: number): void {
    const g = this.g; if (!g) return;
    this.ovlUsedAt = performance.now();
    const step = Surface.overlayStep, cap = this.ovlCap(), n = Math.min(cap, Math.max(step, Math.ceil(need / step) * step));
    if (n <= this.ovlK) return;
    const old = this.ovlTex, had = this.ovlK;
    this.ovlTex = g.texture({ label: 'surface overlay', width: this.ovlSize, height: this.ovlSize, layers: n, format: 'rgba8', filter: 'linear', growable: true });
    // (grown: what was drawn in the smaller pool copied into the bigger one; its slots kept)
    if (had && old && !g.copyLayers(old, this.ovlTex, had)) { this.ovlSlots.clear(); this.ovlFree = []; for (let i = had - 1; i >= 0; i--) this.ovlFree.push(i); this.ovlRescale.clear(); this.ovlSig.fill(NaN); }
    // this frame's ground draw already holds the old one (or the blank one): it takes the new one
    if (this.lastDraw?.textures) this.lastDraw.textures[3] = this.ovlTex;
    for (const t of this.ovlTargets) t?.destroy();
    old?.destroy();
    this.ovlTargets = Array.from({ length: n }, () => null);
    for (let i = n - 1; i >= had; i--) this.ovlFree.unshift(i);
    this.ovlBufs = [...this.ovlBufs, ...Array.from({ length: n - had }, () => null)];
    this.ovlK = n;
  }
  /** the overlays let go (no mark has lain on the tiles for a while): one blank layer again, its memory back */
  private releaseOverlays(): void {
    const g = this.g; if (!g || !this.ovlK) return;
    for (const r of [...this.ovlTargets, ...this.ovlBufs]) r?.destroy();
    const old = this.ovlTex;
    this.ovlTex = g.texture({ label: 'surface overlay (none)', width: 1, height: 1, layers: 1, format: 'rgba8', filter: 'linear' });
    if (this.lastDraw?.textures) this.lastDraw.textures[3] = this.ovlTex;
    old?.destroy();
    this.ovlTargets = []; this.ovlBufs = []; this.ovlFree = []; this.ovlSlots.clear(); this.ovlK = 0; this.ovlVer = ''; this.ovlEach = [];
    this.ovlRescale.clear(); this.ovlSig.fill(NaN);
  }
  /** a tile's corners now, as metres per CSS pixel there (what mppAt measures in the draped marks: the eye's distance),
   *  north-west, north-east, south-west, south-east, into out[o..o + 3]. Placed as the surface shader places a tile:
   *  on a flat map the Mercator plane alone (a few multiplies: the usual case under relief), else the globe blend */
  private cornersNow(sc: Float64Array, cam: Camera, out: Float64Array, o: number): void {
    const e = cam.eye, k = (2 * Math.tan(cam.fov / 2)) / Math.max(1, cam.height), w0 = cam.lon + wrap(sc[0]! - cam.lon), e0 = w0 + (sc[1]! - sc[0]!);
    if (cam.morph >= 1) {
      const c = R * Math.cos(cam.lat * D), m0 = mercY(Math.max(-85.0511, Math.min(85.0511, cam.lat)));
      for (let i = 0; i < 4; i++) {
        const dx = c * ((i & 1 ? e0 : w0) - cam.lon) * D - e[0]!, dy = sc[6 + i]! - e[1]!, dz = -c * (sc[i & 2 ? 5 : 4]! - m0) - e[2]!;
        out[o + i] = Math.sqrt(dx * dx + dy * dy + dz * dz) * k;
      }
      return;
    }
    for (let i = 0; i < 4; i++) {
      const p = worldAtUnwrapped(cam, i & 1 ? e0 : w0, sc[i & 2 ? 3 : 2]!, sc[6 + i]!), dx = p[0] - e[0]!, dy = p[1] - e[1]!, dz = p[2] - e[2]!;
      out[o + i] = Math.sqrt(dx * dx + dy * dy + dz * dz) * k;
    }
  }
  /** the ground's height at a tile's corners (× the exaggeration, as drawn), and the ground version they are from */
  private cornerHeights(sc: Float64Array): void {
    const ex = this.act?.terrain.length ? this.exag() : 0;
    for (let i = 0; i < 4; i++) { const h = ex ? this.heightAt(sc[i & 1 ? 1 : 0]!, sc[i & 2 ? 3 : 2]!) : 0; sc[6 + i] = Number.isFinite(h) ? h * ex : 0; }
    sc[14] = this.groundVersion;
  }
  /** a tile overlay's block (T in tile.wgsl.ts) for the camera now, and its scale record in sc: the corners, their
   *  heights, metres per CSS pixel there now. The texels per device pixel at the corners make a line as wide on the
   *  ground's tiles as the draped prisms make it (they measure each pixel's own distance), wherever in its tile it lies:
   *  a tile shows anywhere between a fraction and the whole of the quadtree's tilePx (the quadtree stops splitting it
   *  at its nearest point, and a tilted view shrinks its far side), so one number per tile drew lines too thin and
   *  dashes too short. Gives the tile's box (degrees) */
  private ovlBlock(key: number, cam: Camera, pixelRatio: number, ysign: number, T: Float32Array, sc: Float64Array): [number, number, number, number] {
    const [z, x, y] = untkey(key), b = tileBounds(z, x, y), bb = tileBBox(z, x, y), m0 = mercY(Math.max(-85.0511, Math.min(85.0511, cam.lat)));
    sc[0] = b.w; sc[1] = b.e; sc[2] = bb[3]; sc[3] = bb[1]; sc[4] = b.n; sc[5] = b.s;
    this.cornerHeights(sc);
    this.cornersNow(sc, cam, sc, 10);
    // world metres per texel, as the marks' places measure them: the view centre's latitude on the flat map, the
    // tile's own on the globe
    const cl = Math.cos(((bb[1] + bb[3]) / 2) * D), texW = ((R * (b.e - b.w) * D) / this.ovlSize) * (cl + (Math.cos(cam.lat * D) - cl) * Math.min(1, cam.morph));
    const pr = Math.max(0.25, pixelRatio), p0 = sc[10]! / pr / texW, p1 = sc[11]! / pr / texW, p2 = sc[12]! / pr / texW, p3 = sc[13]! / pr / texW;
    T.set([wrap(b.w - cam.lon) * D, (b.e - b.w) * D, b.n - m0, b.n - b.s, this.ovlSize, ysign, Math.max(p0, p1, p2, p3), texW, p0, p1, p2, p3]);
    return bb;
  }
  /** the shown overlays drawn under a camera since moved too far: a corner's scale off by more than the drift allowed
   *  (moving, or still; `exact`: any drift once still, so a fixed clock's capture is the same whatever way the view
   *  came and whenever the heights came in). Looked for again only when the camera, its stillness, the ground or the
   *  overlays shown changed (one kept from an earlier view shows again): a still view pays next to nothing */
  private rescaleScan(keys: Set<number>, ver: string, cam: Camera, exact: boolean): void {
    const s = this.ovlSig, e = cam.eye, still = cam.moving ? 0 : exact ? 2 : 1, gv = this.groundVersion;
    let same = true, shown = keys.size;
    for (const key of keys) shown = (shown * 31 + key) % 2147483647;
    const was = (i: number, v: number) => { if (s[i] !== v) { s[i] = v; same = false; } };
    was(0, e[0]!); was(1, e[1]!); was(2, e[2]!); was(3, cam.lon); was(4, cam.lat); was(5, cam.morph); was(6, cam.fov); was(7, cam.height); was(8, still); was(9, gv); was(10, shown);
    if (same) return;
    this.ovlRescale.clear();
    const hi = still === 2 ? 1 + 1e-6 : still ? Surface.overlayDrift.still : Surface.overlayDrift.moving, lo = 1 / hi, now = this.ovlNow;
    for (const key of keys) {
      const o = this.ovlSlots.get(key); if (!o || o.ver !== ver) continue;
      // heights in since it was drawn: the ground under it now (it was drawn on the coarser stand-in's)
      if (o.sc[14] !== gv) this.cornerHeights(o.sc);
      this.cornersNow(o.sc, cam, now, 0);
      for (let i = 0; i < 4; i++) { const q = now[i]! / o.sc[10 + i]!; if (q > hi || q < lo) { this.ovlRescale.add(key); break; } }
    }
  }
  private warmTexture: GTexture | null = null; private warmTarget: GTarget | null = null; private warmBlock: GBuffer | null = null;
  private warmProgress = new Map<string, { keys: number[]; i: number }>();
  /** Prepare hidden marks on a one-pixel target: tile-piece uploads and the driver's first draw happen ahead of
   *  reveal, without rasterising a country's polygons into every full-size overlay in that frame. */
  prepareOverlays(ground: GroundDraw[], ctx: FrameContext, pixelRatio: number): boolean {
    const g = this.g, tiles = this.tiles;
    if (!g || !tiles || !tiles.count || ground.some((d) => !d.ready)) return false;
    if (!ground.length) return true;
    // (drawn into a one-pixel target: no pool made for marks not shown yet)
    this.ovlUsedAt = performance.now();
    this.warmTexture ??= g.texture({ label: 'overlay preparation', width: 1, height: 1, format: 'rgba8' });
    this.warmTarget ??= g.layerTarget(this.warmTexture, 0);
    this.warmBlock ??= g.buffer('uniform', 12 * 4, 'overlay preparation');
    const id = ground.map((d) => d.version.split('/').slice(0, 3).join('/')).join('|');
    let job = this.warmProgress.get(id);
    if (!job) { job = { keys: [], i: 0 }; this.warmProgress.set(id, job); }
    // Prepare the requested fine tiles too, before their imagery arrives. Otherwise preparing a coarse stand-in
    // once would leave all of the finer tiles' first uploads until reveal.
    for (const t of this.want) {
      const key = tkey(t.z, t.x, t.y), up = Math.min(t.z, 1), cover = tkey(t.z - up, t.x >> up, t.y >> up);
      if (!job.keys.includes(key)) job.keys.push(key);
      if (!job.keys.includes(cover)) job.keys.push(cover);
    }
    const t0 = performance.now(), out: DrawCall[] = [], T = this.ovlT;
    for (; job.i < job.keys.length; job.i++) {
      if (job.i && performance.now() - t0 > 2) { g.flush?.(); return false; }
      const key = job.keys[job.i]!, box = this.ovlBlock(key, ctx.camera, pixelRatio, g.api === 'webgpu' ? 1 : -1, T, this.ovlSc);
      this.warmBlock.write(T); out.length = 0;
      for (const d of ground) d.tile({ key, bounds: [T[0]!, T[1]!, T[2]!, T[3]!], box, block: this.warmBlock }, out);
      g.frame(out, { clear: [0, 0, 0, 0], target: this.warmTarget });
    }
    g.flush?.();
    return tiles.settle(this.want, this.ver).done;
  }
  /** the ground marks of this frame, in order: tiles whose overlay is missing or older are drawn (all of them when the
   *  look changed, a few new ones a frame), and every drawn tile is told which overlay it shows */
  overlays(ground: GroundDraw[], ctx: FrameContext, pixelRatio: number, all: boolean): boolean {
    const g = this.g, tiles = this.tiles; if (!g || !tiles) return false;
    const n = tiles.count, recs = tiles.recs, drawn = tiles.drawn;
    this.ovlClock++;
    if (!ground.length) {
      this.ovlPending = 0;
      if (this.ovlSlots.size) { this.ovlSlots.clear(); this.ovlFree = Array.from({ length: this.ovlK }, (_, i) => this.ovlK - 1 - i); this.ovlRescale.clear(); this.ovlSig.fill(NaN); }
      // made only while some mark is really on the tiles (64 MB at lite): let go a while after the last left
      if (this.ovlK && performance.now() - this.ovlUsedAt > Surface.overlayKeepMs) this.releaseOverlays();
      return true;
    }
    // a mark whose programs are still being built: not taken (the frame draws them as prisms meanwhile), nothing drawn
    // into tiles yet (they would be kept empty)
    if (ground.some((d) => !d.ready)) { this.ovlPending = 0; this.ovlUsedAt = performance.now(); return false; }
    // the drawn tiles some mark lies on (a mark that says where: its box, a tenth of a tile round it for a line's
    // width); the others show no overlay and hold no layer
    const wh = ground.map((d) => d.where), anywhere = wh.some((b) => !b), cov = this.ovlCov.length >= n ? this.ovlCov : (this.ovlCov = new Uint8Array(Math.max(n, 64)));
    for (let i = 0; i < n; i++) {
      if (anywhere) { cov[i] = 1; continue; }
      const bb = tileBBox(drawn[3 * i]!, drawn[3 * i + 1]!, drawn[3 * i + 2]!), mx = (bb[2] - bb[0]) * 0.1, my = (bb[3] - bb[1]) * 0.1;
      cov[i] = wh.some((b) => b![0] <= bb[2] + mx && b![2] >= bb[0] - mx && b![1] <= bb[3] + my && b![3] >= bb[1] - my) ? 1 : 0;
    }
    const firstLook = this.ovlSlots.size === 0;
    const ver = ground.map((d) => d.version).join('|'), changed = ver !== this.ovlVer, was = this.ovlVer, wasEach = this.ovlEach; this.ovlVer = ver;
    this.ovlEach = ground.map((d) => d.version);
    // a change of look only within some boxes (a feature hovered): the overlays drawn in the look before that lie
    // elsewhere are current as they are
    if (changed && was && wasEach.length === ground.length && ground.every((d, i) => d.version === wasEach[i] || d.since?.version === wasEach[i])) {
      const boxes: number[] = [];
      for (const d of ground) if (d.since && d.version !== d.since.version) for (let i = 0; i < d.since.boxes.length; i++) boxes.push(d.since.boxes[i]!);
      for (const [key, e] of this.ovlSlots) {
        if (e.ver !== was) continue;
        const [z, x, y] = untkey(key), bb = tileBBox(z, x, y), mx = (bb[2] - bb[0]) * 0.1, my = (bb[3] - bb[1]) * 0.1;
        let hit = false;
        for (let i = 0; i + 3 < boxes.length && !hit; i += 4) hit = boxes[i]! <= bb[2] + mx && boxes[i + 2]! >= bb[0] - mx && boxes[i + 1]! <= bb[3] + my && boxes[i + 3]! >= bb[1] - my;
        if (!hit) e.ver = ver;
      }
    }
    const cam = ctx.camera;
    // the overlays' level: the drawn tiles' own, or coarser (one overlay over 4, 16 … of them) when more tiles are
    // drawn than there are layers, so every drawn tile always has one
    const keys = this.ovlKeys, reserve = new Set<number>(); let u = 0;
    for (; u <= 4; u++) {
      keys.clear();
      for (let i = 0; i < n; i++) { if (!cov[i]) continue; const z = drawn[3 * i]!, d = Math.min(u, z); keys.add(tkey(z - d, drawn[3 * i + 1]! >> d, drawn[3 * i + 2]! >> d)); }
      reserve.clear();
      for (const key of keys) { const [z, x, y] = untkey(key); reserve.add(tkey(Math.max(0, z - 1), z ? x >> 1 : x, z ? y >> 1 : y)); }
      // the pool: as big as this view's overlays need (in steps, up to its cap) before any is made coarser
      if (u === 0) this.ensureOverlays(keys.size + reserve.size + 2);
      // Covers must fit beside every fine overlay, so refinement never waits forever for a slot all covers use.
      if (keys.size + reserve.size <= this.ovlK - 2) break;
    }
    this.ovlShift = u;
    const ysign = g.api === 'webgpu' ? 1 : -1;
    // every overlay this frame shows is in use (never given away below)
    for (const key of keys) { const e = this.ovlSlots.get(key); if (e) e.used = this.ovlClock; }
    // a drawn tile with nothing to show yet (no overlay of its own, none above it): one overlay a level up covers it
    // and its neighbours at once, drawn first; its own follows within the budget (no tile ever shows bare ground).
    // When the look changed, every tile is drawn again in this frame: one that has an overlay of the older look needs
    // no cover (a cover drawn for each, every pixel of 64 tiles' worth of marks, made each hover and each step of a
    // fade cost several times over)
    const cover = new Set<number>(), current = (k: number) => this.ovlSlots.get(k)?.ver === ver;
    for (let i = 0; i < n; i++) {
      if (!cov[i]) continue;
      const z = drawn[3 * i]!, x = drawn[3 * i + 1]!, y = drawn[3 * i + 2]!;
      let ok = false;
      for (let k = Math.min(u, z); k <= z && k <= u + 4 && !ok; k++) { const key = tkey(z - k, x >> k, y >> k); ok = current(key) || (changed && k === Math.min(u, z) && this.ovlSlots.has(key)); }
      if (ok) continue;
      const c = Math.min(z, u + 1);
      cover.add(tkey(z - c, x >> c, y >> c));
    }
    for (const ck of cover) { const e = this.ovlSlots.get(ck); if (e) e.used = this.ovlClock; }
    // the shown overlays drawn under a camera since moved too far (each was drawn to the camera of its moment)
    this.rescaleScan(keys, ver, cam, all);
    // what to draw now: the covers, then every stale one when the look changed (one look across the view), else a
    // few new ones; then, within what is left of the budget, those whose scale drifted
    let fresh = 0, pending = 0;
    const budget = all ? Infinity : firstLook ? 0 : changed ? this.ovlK : 6, T = this.ovlT, out: DrawCall[] = [];
    const draw = (key: number): boolean => {
      let e = this.ovlSlots.get(key);
      const slot = e ? e.slot : this.ovlAlloc(); if (slot < 0) return false;
      // its scale from the camera now (the corners' texels per pixel), kept with it to tell when it drifted
      const sc = e?.sc ?? new Float64Array(SC), bb = this.ovlBlock(key, cam, pixelRatio, ysign, T, sc);
      this.ovlRescale.delete(key);
      // a block per layer: the tiles drawn in one frame go to the chip together (each must keep its own numbers)
      const buf = (this.ovlBufs[slot] ??= g.buffer('uniform', 12 * 4, 'tile overlay'));
      buf.write(T);
      out.length = 0;
      for (const d of ground) d.tile({ key, bounds: [T[0]!, T[1]!, T[2]!, T[3]!], box: bb, block: buf }, out);
      const tg = (this.ovlTargets[slot] ??= g.layerTarget(this.ovlTex!, slot));
      g.frame(out, { clear: [0, 0, 0, 0], target: tg });
      if (!e) { e = { slot, ver, used: this.ovlClock, sc }; this.ovlSlots.set(key, e); } else { e.ver = ver; e.used = this.ovlClock; }
      return true;
    };
    for (const ck of cover) if (!current(ck) && !draw(ck)) pending++;
    for (const key of keys) {
      if (current(key)) continue;
      if (fresh >= budget || !draw(key)) { pending++; continue; }
      fresh++;
    }
    // (what is left of the budget: a drifted one still shows the right marks meanwhile, a little off their width)
    for (const key of this.ovlRescale) {
      if (!keys.has(key) || !current(key)) continue;
      if (fresh >= budget || !draw(key)) { pending++; continue; }
      fresh++;
    }
    this.ovlPending = pending;
    // which overlay each drawn tile shows: its overlay (a stale one too, until drawn again), else the nearest
    // ancestor's that is there, as a piece of it
    for (let i = 0; i < n; i++) {
      const z = drawn[3 * i]!, x = drawn[3 * i + 1]!, y = drawn[3 * i + 2]!, q = i * REC;
      if (!cov[i]) { recs[q + 24] = -1; continue; }
      // the nearest current one first, else the nearest at all (stale until drawn again)
      let e: Ovl | undefined, up = 0;
      for (let k = Math.min(u, z); !e && k <= z && k <= u + 4; k++) { const a = this.ovlSlots.get(tkey(z - k, x >> k, y >> k)); if (a?.ver === ver) { e = a; up = k; } }
      for (let k = Math.min(u, z); !e && k <= z && k <= u + 4; k++) { e = this.ovlSlots.get(tkey(z - k, x >> k, y >> k)); up = k; }
      if (!e) { recs[q + 24] = -1; continue; }
      e.used = this.ovlClock;
      const s2 = 2 ** up;
      recs[q + 24] = e.slot; recs[q + 25] = 1 / s2; recs[q + 26] = (x - ((x >> up) << up)) / s2; recs[q + 27] = (y - ((y >> up) << up)) / s2;
    }
    if (n) this.recTex!.write(recs.subarray(0, n * REC), { width: REC / 4, height: n });
    return true;
  }
  /** a free overlay layer, or the one used longest ago by a tile not drawn now */
  private ovlAlloc(): number {
    const f = this.ovlFree.pop(); if (f !== undefined) return f;
    let old: number | null = null, oldUsed = Infinity;
    for (const [key, e] of this.ovlSlots) if (e.used < this.ovlClock && e.used < oldUsed) { old = key; oldUsed = e.used; }
    if (old === null) return -1;
    const e = this.ovlSlots.get(old)!; this.ovlSlots.delete(old); return e.slot;
  }
  tileStats() { return this.tiles ? { ...this.tiles.stats, layers: this.layersN, want: this.want.length } : null; }
  /** the ground's height (m, before exaggeration) from the finest tile loaded there */
  /** the lowest and highest ground drawn anywhere in a box (true m): from the tiles' own ranges, a margin over */
  rangeIn(w: number, s: number, e: number, n: number): [number, number] | null {
    const t = this.tiles; if (!t) return null;
    const span = Math.max(e - w, (n - s) * 1.5, 1e-7);
    let z = Math.max(0, Math.min(16, Math.floor(Math.log2(360 / span))));
    const tx = (lon: number, k: number) => Math.max(0, Math.min(k - 1, Math.floor(((lon + 180) / 360) * k)));
    const ty = (lat: number, k: number) => Math.max(0, Math.min(k - 1, Math.floor(((Math.PI - mercY(Math.max(-85.0511, Math.min(85.0511, lat)))) / (2 * Math.PI)) * k)));
    let k = 2 ** z, x0 = tx(w, k), x1 = tx(e, k), y0 = ty(n, k), y1 = ty(s, k);
    while ((x1 - x0 + 1) * (y1 - y0 + 1) > 9 && z > 0) { z--; k = 2 ** z; x0 = tx(w, k); x1 = tx(e, k); y0 = ty(n, k); y1 = ty(s, k); }
    // tile ranges remembered until any tile's heights change (a layer asks for thousands of pieces at once)
    if (this.memoN !== t.keptN) { this.memo.clear(); this.memoN = t.keptN; }
    let lo = Infinity, hi = -Infinity; const r = this.rr;
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const key = tkey(z, x, y); let m = this.memo.get(key);
      if (!m) { t.rangeOfTile(z, x, y, r); m = [r[0], r[1]]; this.memo.set(key, m); }
      if (m[0] < lo) lo = m[0]; if (m[1] > hi) hi = m[1];
    }
    return [lo, hi];
  }
  private rr: [number, number] = [0, 0]; private memo = new Map<number, [number, number]>(); private memoN = -1;
  heightAt(lon: number, lat: number): number {
    if (this.act && !this.act.terrain.length) return 0;
    return this.tiles?.heightAt(lon, lat, this.zMax || 20) ?? NaN;
  }
  /** bumped whenever the ground's heights change (tiles' heights in, terrain turned on or off) */
  get groundVersion(): number { return (this.tiles?.heightsVersion ?? 0) + this.terrainBumps; }
  private terrainBumps = 0; private terrainKey = ''; private zMax = 0;
  override attribution(): string[] {
    const a = this.act;
    return a ? [...a.imagery.map((i) => i.src.attribution), ...a.terrain.map((t) => t.attribution)] : [];
  }
  override detach(): void {
    this.tiles?.dispose(); this.tiles = null;
    for (const r of [this.tex, this.hTex, ...this.recRing, this.index, this.ubuf, this.pbuf, this.prog, this.ovlTex, this.warmTarget, this.warmTexture, this.warmBlock, ...this.ovlBufs, ...this.ovlTargets, this.noSea, this.noField]) r?.destroy();
    this.noSea = null; this.noField = null;
    this.warmTarget = this.warmTexture = this.warmBlock = null; this.warmProgress.clear();
    this.ovlTex = null; this.ovlBufs = []; this.ovlTargets = []; this.ovlK = 0; this.ovlSlots.clear(); this.ovlFree = [];
    this.recRing = []; this.tex = this.hTex = this.recTex = null; this.index = this.ubuf = this.pbuf = null; this.prog = null;
    this.turns = []; this.pool = []; this.canvas = null; this.g = null;
    super.detach();
  }
}
export function checkSurface(p: SurfaceProps): void {
  if (!Array.isArray(p.imagery) || !Array.isArray(p.terrain)) throw new AslnutError('E-DATA-001', 'a surface needs imagery and terrain lists', { fix: 'earth({ imagery: [imagery.esri()], terrain: [terrain.mapzen()] }); terrain: [] is flat' });
}
