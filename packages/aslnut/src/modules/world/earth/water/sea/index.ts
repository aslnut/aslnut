// modules › world › earth › water › sea: the sea's look and its shore (look.ts, shore.ts), drawn by the ground's sea
// (the surface: the ground under the sea level as water, at every zoom, on every graphics) and, with room, by the sea's
// own surface near the eye (rings round the point under it, lifted by the waves). Both read one block of uniforms and
// one field of the coast, written here once a frame (the waves' phases at the view's centre, the clock): nothing per
// vertex or per pixel on the main thread. sea() gives the world its sea (over water()'s plain one: the first layer
// in the draw order that gives one).
//   w.add(sea({ look: { wind: { speed: 7, from: 230 } }, shore: { coast: data.geojson('/coast.geojson') } }))
import { Element, type AttachContext, type ElementProps, type ElementStatus, type FrameContext, type Sea } from '../../../../../core/world/element.ts';
import type { Fn } from '../../../../../core/observation/presence.ts';
import type { State } from '../../../../../core/world/state.ts';
import type { DrawCall, GBuffer, GTexture, Graphics, Program } from '../../../../../core/render/graphics/interface.ts';
import { SEA_FLOATS, SEA_SEGMENTS, SEA_WAVES, SEA_WGSL } from '../../../../../core/render/graphics/shaders/sea.wgsl.ts';
import { SEA_GLSL } from '../../../../../core/render/graphics/shaders/sea.glsl.ts';
import { Source } from '../../../../../core/data/sources/source.ts';
import { valueOf } from '../../../../../core/observation/presence.ts';
import { D, R, mercY, latOfMercY, wrap } from '../../../../../core/space/geo.ts';
import { LOOK, rgbOf, waveSet, type SeaLook, type Wave } from './look.ts';
import { SHORE, coastFeatures, coastField, coastSegments, type SeaShore } from './shore.ts';
import type { Leveled } from '../../../../../core/observation/presence.ts';

export { LOOK, waveSet, type SeaLook, type Wave } from './look.ts';
export { SHORE, FAR, coastField, coastSegments, coastFeatures, localFrame, type FieldGrid, type SeaShore } from './shore.ts';

/** the sea: its level, its look and its shore */
export interface SeaProps extends Omit<ElementProps, 'params' | 'shader'> {
  /** sea level, m (default 0): a number, or your function of the state (a tide, a rise) */
  level?: Fn<number>;
  /** what it looks like (true: the defaults) */
  look?: SeaLook | true;
  /** where it meets the land: its coast, its waves breaking, its swash */
  shore?: SeaShore;
}
/** the field's window: cells a side */
const N = 1024;
/** the displaced surface's rings */
const RINGS = 96, RATIO = 1.075;
const MEAN_SPAN = (RATIO ** RINGS - 1) / (RATIO - 1);

export class SeaSurface extends Element<SeaProps> {
  readonly kind = 'custom' as const;
  private look: SeaLook; private shore: SeaShore | null;
  private g: Graphics | null = null; private prog: Program | null = null; private block: GBuffer | null = null; private index: GBuffer | null = null;
  private u = new Float32Array(SEA_FLOATS);
  private waves: Wave[] = []; private wavesKey = '';
  /** the waves' frame: its latitude (moved only when the eye goes 2° away) */
  private anchor = NaN;
  /** the displaced surface's share now (eased to the tier's) */
  private share = 0; private lastNow = -1;
  /** the coast: its features' version, the field's windows (shown, being made) */
  private src: Source | null = null; private off: (() => void) | null = null; private coastV = -1;
  private fields: { tex: GTexture; lon0: number; lat0: number; x0: number; y0: number; cell: number; band: number; key: string }[] = [];
  private job: { key: string; lon0: number; lat0: number; x0: number; y0: number; cell: number; band: number; f: ReturnType<typeof coastField> } | null = null;
  private none = false;
  /** the sea is in view and low enough for its waves to move on screen (frames asked for), the eye's height */
  private seen = false; private eyeH = Infinity;
  constructor(p: SeaProps = {}) {
    super({ id: 'sea', order: 0.5, ...p });
    this.look = p.look === true || !p.look ? {} : p.look; this.shore = p.shore ?? null;
  }
  /** the sea level now (m) */
  seaLevel(s: State): number { return valueOf(this.props.level ?? 0, s); }
  /** the sea it gives the world: its level, its deep colour (the plain sea's), its look (the block and the field) */
  override sea(s: State): Sea | null { return { level: this.seaLevel(s), color: rgbOf(this.look.deep ?? LOOK.deep), look: this.pack(s) }; }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    const c = this.shore?.coast;
    if (c instanceof Source) { this.src = c; this.off = c.watch(() => { this.coastV = -1; }); void c.start({ loader: ctx.loader, error: (e) => ctx.world.error(e) }); }
    const g = ctx.graphics; if (!g) return;
    this.g = g;
    this.block = g.buffer('uniform', SEA_FLOATS * 4, `${this.id} block`);
    // the rings' triangles (each ring to the next, every segment; the segments' last column its own: no seam)
    const idx = new Uint32Array(RINGS * SEA_SEGMENTS * 6), W = SEA_SEGMENTS + 1; let k = 0;
    for (let j = 0; j < RINGS; j++) for (let i = 0; i < SEA_SEGMENTS; i++) { const a = j * W + i; idx.set([a, a + W, a + 1, a + 1, a + W, a + W + 1], k); k += 6; }
    this.index = g.buffer('index', idx, `${this.id} rings`);
    this.prog = g.program({ label: `${this.id} surface`, wgsl: SEA_WGSL, glsl: SEA_GLSL, blocks: ['Frame', 'Sea'], textures: [{ name: 'seaField', kind: '2d', sample: 'unfilterable' }, { name: 'shadowMap', kind: '2d', sample: 'float' }], blend: 'alpha', depth: { write: true, test: 'less' }, cull: 'none' });
    await this.prog.ready.catch((e) => { this.failure = e as Error; });
  }
  override detach(): void {
    this.off?.(); this.off = null; this.src = null;
    for (const f of this.fields) f.tex.destroy(); for (const t of this.retired) t.destroy(); this.fields = []; this.retired = []; this.job = null;
    this.prog?.destroy(); this.block?.destroy(); this.index?.destroy(); this.dummy?.destroy(); this.prog = null; this.block = this.index = this.dummy = null;
    super.detach();
  }
  private dummy: GTexture | null = null; private retired: GTexture[] = [];
  /** the tier the look asks for now: 'auto' by the governor's quality and detail */
  private wantsDisplaced(s: State): boolean {
    const t = this.look.tier ?? 'auto';
    if (t !== 'auto') return t === 'displaced';
    return s.render.quality === 'realistic' && (s.render.detail ?? 1) >= 0.75;
  }

  /** the block and the field, for this frame (the world asks once a frame, before anything draws) */
  private pack(s: State): Sea['look'] {
    const ctx = this.attached, g = this.g; if (!ctx || !g || !this.block) return null;
    // (a field finished: taken now, before anything draws this frame; the ones it took over from let go)
    for (const t of this.retired) t.destroy(); this.retired = [];
    this.fieldStep();
    const cam = ctx.camera, w = ctx.world, now = w.now, l = w.light ?? null, look = this.look, u = this.u;
    const dt = this.lastNow < 0 ? 0 : Math.max(0, now - this.lastNow); this.lastNow = now;
    // the waves for the wind now (made again only when the wind changes)
    const speed = valueOf(look.wind?.speed ?? (l?.wind && l.wind > 0 ? l.wind : LOOK.speed), s), from = valueOf(look.wind?.from ?? LOOK.from, s);
    const key = `${speed.toFixed(2)}|${from.toFixed(1)}|${JSON.stringify(look.swell ?? null)}|${look.waves ?? LOOK.waves}`;
    if (key !== this.wavesKey) { this.wavesKey = key; this.waves = waveSet({ speed, from, swell: look.swell, count: look.waves ?? LOOK.waves }); }
    const displaced = this.wantsDisplaced(s);
    this.share = displaced ? Math.min(1, this.share + dt / 600) : Math.max(0, this.share - dt / 600);
    const flat = !displaced && this.share === 0, n = this.waves.length, all = flat && s.render.quality === 'lite' ? Math.min(8, n) : n, nv = Math.min(8, n);
    // the waves' frame: Mercator metres at its latitude (the eye going far north or south moves it, never a step it sees)
    if (!(Math.abs(cam.lat - this.anchor) < 2)) this.anchor = cam.lat;
    const ca = Math.cos(this.anchor * D), cc = Math.cos(cam.lat * D), sc = ca / cc;
    const qx = R * ca * cam.lon * D, qz = -R * ca * mercY(Math.max(-85.0511, Math.min(85.0511, cam.lat))), t = look.clock ? look.clock(s) : now / 1000;
    const TAU = Math.PI * 2;
    let left = 0;
    for (let i = 0; i < SEA_WAVES; i++) {
      const wv = this.waves[i];
      if (!wv) { u.fill(0, 40 + i * 4, 44 + i * 4); u.fill(0, 104 + i * 4, 108 + i * 4); continue; }
      if (i >= all) left += 0.5 * (wv.k * wv.a) ** 2;
      const ph = wv.k * (wv.dir[0] * qx + wv.dir[1] * qz) - wv.omega * t;
      u.set([wv.dir[0], wv.dir[1], wv.k, wv.a], 40 + i * 4);
      u.set([ph - TAU * Math.floor(ph / TAU), wv.q, 0, 0], 104 + i * 4);
    }
    const ex = w.exaggeration, level = this.seaLevel(s) * ex, sh = this.shore, shallow = rgbOf(look.shallow ?? LOOK.shallow), deep = rgbOf(look.deep ?? LOOK.deep);
    const period = sh ? valueOf(sh.period ?? SHORE.period, s) : 0, eyeH = Math.max(1, cam.dist * Math.sin(cam.pitch)); this.eyeH = eyeH;
    u.set([1, this.share, nv, all], 0);
    u.set([look.glitter ?? LOOK.glitter, sc, t % 36000, level], 4);
    u.set([...shallow, look.clarity ?? LOOK.clarity], 8);
    u.set([...deep, sh?.shelf ?? SHORE.shelf], 12);
    // the coast's field: the window it has for where the eye is (a new one made a slice a frame as the eye moves away)
    const f = sh ? this.fieldFor(cam, eyeH) : null;
    if (f) {
      const ratio = cc / Math.cos(f.lat0 * D), c = R * cc;
      u.set([c * D * wrap(f.lon0 - cam.lon) + f.x0 * ratio, -c * (mercY(f.lat0) - mercY(Math.max(-85.0511, Math.min(85.0511, cam.lat)))) - f.y0 * ratio, f.cell * ratio, 1], 16);
    } else u.set([0, 0, 1, 0], 16);
    let drop = 0.3; for (let i = 0; i < nv; i++) drop += this.waves[i]?.a ?? 0;
    u.set([N, N, f?.band ?? 0, drop + (sh ? 1 : 0)], 20);
    u.set(sh ? [sh.surf ?? SHORE.surf, sh.runup ?? SHORE.runup, period, sh.foam ?? SHORE.foam] : [SHORE.surf, 0, 0, 0], 24);
    // the displaced surface: its rings round the point under the eye (moved in steps of its first ring's: the waves it
    // samples hold still as the eye drifts)
    const outer = Math.max(300, Math.min(25000, eyeH * (look.reach ?? LOOK.reach))), r0 = outer / MEAN_SPAN, step = r0 * 8;
    const ex0 = qx + cam.eye[0]! * sc, ez0 = qz + cam.eye[2]! * sc, sx = Math.round(ex0 / step) * step, sz = Math.round(ez0 / step) * step;
    u.set([r0, RATIO, RINGS, outer], 28);
    u.set([(sx - qx) / sc, (sz - qz) / sc, cam.dist * 6, cam.dist * 40], 32);
    // (the sea's whole roughness for its wind, Cox and Munk's: what a wide footprint sees, the smallest ripples in it)
    u.set([left, 0.003 + 0.00512 * speed, 0, 0], 36);
    this.block.write(u);
    // in view: low enough to see the waves move, and water among what the screen's corners and middle look at
    this.seen = eyeH < 30000 && this.waterInView(cam, level / Math.max(ex, 1e-6), f);
    return { block: this.block, field: f?.tex ?? (this.dummy ??= g.texture({ label: `${this.id} no field`, width: 1, height: 1, format: 'r32f', filter: 'nearest' })) };
  }
  /** is there water in the view: the ground under the screen's corners, edges and middle under the sea level, or the
   *  coast's field there */
  private waterInView(cam: AttachContext['camera'], level: number, f: SeaSurface['fields'][number] | null): boolean {
    const w = this.attached!.world, W = cam.width, H = cam.height;
    for (const [px, py] of [[0.5, 0.5], [0.1, 0.35], [0.9, 0.35], [0.5, 0.15], [0.1, 0.9], [0.9, 0.9], [0.5, 0.75]] as const) {
      const ll = cam.lonLatAt(px * W, py * H); if (!ll) continue;
      const h = w.heightAt(ll[0], ll[1]); if (Number.isFinite(h) && h < level + 0.5) return true;
    }
    return !!f && f.key !== '';
  }
  /** the field's window for the eye (cells by its height: 2 m at street level, coarser higher up), made a slice a frame
   *  when the eye moves out of the middle of the one there is; null: no coast near */
  private fieldFor(cam: AttachContext['camera'], eyeH: number): SeaSurface['fields'][number] | null {
    const sh = this.shore!, base = sh.cell ?? SHORE.cell;
    const v = this.src ? this.src.version : 0;
    if (v !== this.coastV) { this.coastV = v; for (const f of this.fields) this.retired.push(f.tex); this.fields = []; this.job = null; this.none = false; }
    let lvl = Math.max(0, Math.ceil(Math.log2(Math.max(1, (eyeH * 10) / (base * N * 0.25)))));
    const cur = this.fields[0];
    // (a level up or down only past half a level: no new window for a wobble of the eye)
    if (cur) { const l0 = Math.round(Math.log2(cur.cell / base)); if (Math.abs(Math.log2(Math.max(1, (eyeH * 10) / (base * N * 0.25))) - l0) < 0.5 + (lvl > l0 ? 0.5 : 0)) lvl = l0; }
    const cell = base * 2 ** lvl, half = (cell * N) / 2;
    // (the band: the surf zone and the swash, never more: far from the coast its nearest piece may say the wrong side;
    // seen from high up, cells wider than a third of it say nothing: no field, the ground's height decides)
    const band = Math.max((sh.surf ?? SHORE.surf) * 1.4, (sh.runup ?? SHORE.runup) * 2 + 4);
    if (band < cell * 3) { if (this.fields.length) { for (const f of this.fields) this.retired.push(f.tex); this.fields = []; } this.job = null; return null; }
    // its middle: where the eye looks, in steps of a quarter window
    const lat = cam.lat, lon = cam.lon, qy = R * mercY(lat), stepM = half / 2;
    const okNow = cur && cur.cell === cell && Math.abs(R * D * wrap(lon - cur.lon0) * Math.cos(cur.lat0 * D)) < stepM && Math.abs((qy - R * mercY(cur.lat0)) * Math.cos(cur.lat0 * D)) < stepM;
    if (!okNow && !this.job) {
      const c0 = Math.cos(lat * D), lon0 = Math.round((lon * D * R * c0) / stepM) * stepM / (R * c0 * D), lat0 = latOfMercY(Math.round((qy * c0) / stepM) * stepM / (R * c0)), key = `${lon0.toFixed(6)}|${lat0.toFixed(6)}|${cell}`;
      if (key !== cur?.key) {
        const k = R * Math.cos(lat0 * D), at = (lo: number, la: number): [number, number] => [k * D * wrap(lo - lon0), k * (mercY(la) - mercY(lat0))];
        const span = (half * 1.3) / (R * Math.cos(lat0 * D) * D), spanY = (half * 1.3) / 110574;
        const box: [number, number, number, number] = [lon0 - span, lat0 - spanY, lon0 + span, lat0 + spanY];
        const segs = coastSegments(coastFeatures(sh.coast), at, box);

        if (!segs.length) { this.none = true; if (cur) { for (const f of this.fields) this.retired.push(f.tex); this.fields = []; } return null; }
        this.none = false;
        this.job = { key, lon0, lat0, x0: -half, y0: half, cell, band, f: coastField(segs, { x0: -half, y0: half, cell, nx: N, ny: N }, band) };
      }
    }
    return this.fields[0] ?? null;
  }
  /** a slice of the field being made (within ~3 ms), shown when whole */
  private fieldStep(): void {
    const j = this.job, g = this.g; if (!j || !g) return;
    const t0 = performance.now();
    while (!j.f.step(6)) if (performance.now() - t0 > 3) return;
    const tex = g.texture({ label: `${this.id} coast field`, width: N, height: N, format: 'r32f', filter: 'nearest' });
    tex.write(j.f.out);
    // (the one it takes over from is let go a frame later: this frame's draws may hold it still)
    for (const f of this.fields) this.retired.push(f.tex);
    this.fields = [{ tex, lon0: j.lon0, lat0: j.lat0, x0: j.x0, y0: j.y0, cell: j.cell, band: j.band, key: j.key }];
    this.job = null;
    (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.();
  }
  frame(ctx: FrameContext): DrawCall[] {
    const sea = ctx.sea, cam = ctx.camera;
    if (!this.prog || !this.block || !this.index || this.failure || !sea?.look || this.share <= 0 || cam.morph < 0.99 || this.eyeH > 5000) return [];
    const field = sea.look.field ?? this.dummy!;
    return [{ program: this.prog, blocks: [ctx.frame, this.block], textures: [field, ctx.shadowMap!], index: this.index, count: RINGS * SEA_SEGMENTS * 6 }];
  }
  /** its waves move: frames while the sea is in view and near enough to see them, fewer higher up */
  override wantsFrames(_s: State): number { return !this.seen ? 0 : this.eyeH < 1500 ? Infinity : this.eyeH < 6000 ? 30 : 10; }
  override animating(s: State): boolean { return this.wantsFrames(s) > 0; }
  /** the coast loading, its field being made */
  override status(): ElementStatus {
    const pending: string[] = [];
    if (this.src) pending.push(...this.src.status().pending);
    if (this.job) pending.push(`${this.id} coast field`);
    const failed = [...(this.src?.status().failed ?? []), ...(this.failure ? [{ what: this.id, error: this.failure.message }] : [])];
    return { ready: !pending.length && !failed.length, pending, failed, missing: [] };
  }
  override attribution(): string[] { return this.src?.attribution ? [this.src.attribution] : []; }
}
/** the sea: its level, its look (the waves the wind raises, its water by depth, the sky and the sun in it) and its
 *  shore (the waves breaking on its coast, the swash); it gives the world its sea, over water()'s plain one */
export const sea = (p: Leveled<SeaProps> = {}) => new SeaSurface(p as SeaProps);
