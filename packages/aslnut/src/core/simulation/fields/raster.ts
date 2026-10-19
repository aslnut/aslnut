// core › simulation › fields › raster: a grid over a piece of the ground, stepped by a rule, drawn on the ground in a
// ramp, asked anywhere (probes). On the chip (a float target, one draw a step: WebGPU and WebGL2 alike) where it can
// take float targets; on the CPU otherwise, cell for cell the same arithmetic. Its state comes back from the chip a
// few times a second for drawing and probes (never stalling it).
//   const water = w.add(field({ id: 'flood', res: 4, area: [145.11, -37.93, 145.13, -37.91],
//     rule: rules.shallowWater(), inputs: { ground: 'terrain' }, init: 0, rate: 10,
//     draw: { ramp: 'blues', domain: [0, 1], min: 0.01 } }))
//   water.step(60)  ·  water.play(20)  ·  water.at([lon, lat])  ·  water.probe({ at: [lon, lat] }).value
import { AslnutError } from '../../world/errors.ts';
import { Element, type AttachContext, type FrameContext, type ElementProps } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import type { DrawCall, GBuffer, GTarget, GTexture, Graphics, Program } from '../../render/graphics/interface.ts';
import { FIELD_GLSL, FIELD_GLSL_VERTEX } from '../../render/graphics/shaders/field.glsl.ts';
import { FIELD_WGSL } from '../../render/graphics/shaders/field.wgsl.ts';
import { FIELD_SURFACE_GLSL } from '../../render/graphics/shaders/field-surface.glsl.ts';
import { FIELD_SURFACE_WGSL } from '../../render/graphics/shaders/field-surface.wgsl.ts';
import { R, mercY } from '../../space/geo.ts';
import { tileBBox, type BBox } from '../../space/geo.ts';
import { rgba } from '../../render/style/color.ts';
import { ramp as rampOf, type Ramp } from '../../render/style/ramp.ts';
import { OPEN } from '../../data/rights.ts';
import type { RasterSource } from '../../data/sources/raster.ts';
import { ruleOf, type CpuGrid, type Kernel, type Rule } from '../rules.ts';

const D = Math.PI / 180, KY = 110574;
type LonLat = [number, number];
/** what an input is: another field, a number, your function of a place, a grid (w × h numbers, row 0 north) or the
 *  world's terrain (heights, m) */
export type FieldInput = RasterField | number | ((lon: number, lat: number) => number) | Float32Array | 'terrain';
export interface FieldDraw {
  ramp?: Ramp; domain?: [number, number]; opacity?: number;
  /** which of the four numbers is drawn (default 0) */
  channel?: number;
  /** cells below this are not drawn (dry ground under a flood) */
  min?: number;
  /** 'ground' (default): painted into the ground's tiles (it drapes, under what stands on the ground) · 'surface': a
   *  surface standing at the input `base` plus the value (water over the streets), drawn from the chip's state */
  on?: 'ground' | 'surface';
  /** with on: 'surface', the input that is the ground under it (default 'ground'; none: the world's terrain) */
  base?: string;
  /** with on: 'surface': lying on its base (the value only colours it: a temperature), `lift` metres above it */
  flat?: boolean; lift?: number;
}
export interface FieldProps extends ElementProps {
  kind?: 'raster';
  /** metres a cell */
  res: number;
  /** the piece of the ground: [west, south, east, north] degrees, or a centre and a side (m) */
  area: BBox | { centre: LonLat; size: number };
  /** the first state: a number, your function of a place, or a grid (w × h, or 4 numbers a cell) */
  init?: number | ((lon: number, lat: number) => number) | Float32Array;
  rule: Rule | Kernel | ((cur: number, n: { laplacian: number; neighbours: [number, number, number, number]; inputs: Record<string, number> }, dt: number, p: Record<string, number>) => number);
  /** the rule's inputs by its names */
  inputs?: Record<string, FieldInput>;
  /** the rule's numbers by name (over its defaults) */
  params?: Record<string, number>;
  /** simulated seconds per second while it plays (0: still until step / play) */
  rate?: number;
  /** a step's length (s); default the rule's longest stable one */
  dt?: number;
  draw?: FieldDraw | false;
  /** 'auto' (default): on the chip where it takes float targets and the rule has a kernel */
  gpu?: 'auto' | boolean;
}
export interface Probe {
  /** the mean of the field's value where it looks, now */
  readonly value: number;
  /** (simulated seconds, value) as the field steps */
  readonly series: readonly [number, number][];
  stop(): void;
}
interface ProbeState { cells: number[]; series: [number, number][]; value: number; every: number | 'step'; last: number; on: boolean }

export class RasterField extends Element<FieldProps> {
  readonly kind = 'raster' as const;
  readonly w: number; readonly h: number; readonly cell: number;
  /** [west, south, east, north] */
  readonly box: BBox;
  rule: Rule;
  /** simulated seconds stepped so far */
  time = 0;
  /** bumped when the state seen on the CPU changed (drawing, probes) */
  version = 0;
  /** the state on the CPU: four numbers a cell, row 0 north (on the chip: as of its last read back) */
  state: Float32Array;
  private next: Float32Array;
  private p = new Float32Array(16);
  private inputs: Float32Array[] = [];
  private dLon: number; private dLat: number;
  private probes = new Set<ProbeState>();
  private playing = 0;
  private gpu: { g: Graphics; prog: Program; a: GTexture; b: GTexture; ta: GTarget; tb: GTarget; block: GBuffer; ins: GTexture[]; zero: GTexture } | null = null;
  private reading = false; private readP: Promise<void> | null = null; private readAt = 0; private dirtyGpu = false; private stepsSinceRead = 0;
  private terrainSeen = -1; private terrainAt = 0;
  private mode: 'cpu' | 'gpu' = 'cpu';
  /** drawn as a surface: its program, block, ramp, and (on the CPU) its state and base as textures */
  private surf: { g: Graphics; prog: Program; block: GBuffer; lut: GTexture; state: GTexture | null; base: GTexture; baseOf: Float32Array | null; stateVersion: number; u: Float32Array; lutKey: string } | null = null;
  constructor(p: FieldProps) {
    super(p);
    if (!(p.res > 0)) throw new AslnutError('E-DATA-001', `field '${this.id}' needs res (metres a cell)`, { where: this.id, fix: "field({ id: 'flood', res: 4, area, rule })" });
    this.rule = ruleOf(p.rule);
    const a = p.area as { centre?: LonLat; size?: number };
    let box: BBox;
    if (Array.isArray(p.area)) box = p.area as BBox;
    else if (a?.centre && a.size! > 0) { const kx = 111320 * Math.cos(a.centre[1] * D), hx = a.size! / 2 / kx, hy = a.size! / 2 / KY; box = [a.centre[0] - hx, a.centre[1] - hy, a.centre[0] + hx, a.centre[1] + hy]; }
    else throw new AslnutError('E-DATA-001', `field '${this.id}' needs an area: [w, s, e, n] or { centre, size }`, { where: this.id, fix: 'area: { centre: [145.12, -37.92], size: 800 }' });
    this.box = box;
    const lat = (box[1] + box[3]) / 2, kx = 111320 * Math.cos(lat * D);
    this.cell = p.res;
    this.w = Math.max(2, Math.round(((box[2] - box[0]) * kx) / p.res)); this.h = Math.max(2, Math.round(((box[3] - box[1]) * KY) / p.res));
    if (this.w > 2048 || this.h > 2048) throw new AslnutError('E-DATA-001', `field '${this.id}' would be ${this.w} × ${this.h} cells (at most 2048 a side)`, { where: this.id, fix: 'a coarser res or a smaller area' });
    this.dLon = (box[2] - box[0]) / this.w; this.dLat = (box[3] - box[1]) / this.h;
    this.state = new Float32Array(this.w * this.h * 4); this.next = new Float32Array(this.state.length);
    this.setParams(p.params ?? {});
    this.reset();
    this.playing = p.rate ?? 0;
  }
  /** a cell's centre */
  lonLatOf(i: number, j: number): LonLat { return [this.box[0] + (i + 0.5) * this.dLon, this.box[3] - (j + 0.5) * this.dLat]; }
  /** the cell under a place (null: outside) */
  cellOf(lon: number, lat: number): [number, number] | null {
    const i = Math.floor((lon - this.box[0]) / this.dLon), j = Math.floor((this.box[3] - lat) / this.dLat);
    return i < 0 || j < 0 || i >= this.w || j >= this.h ? null : [i, j];
  }
  /** where it runs: 'gpu' (the chip) or 'cpu' */
  get runsOn(): 'cpu' | 'gpu' { return this.mode; }
  /** another rule from now on (a scenario's): the state stays; on the chip its kernel is built first (the CPU takes
   *  over where it has none) */
  async setRule(r: FieldProps['rule'], params: Record<string, number> = {}): Promise<this> {
    const next = ruleOf(r), g = this.gpu?.g ?? null;
    let prog: Program | null = null;
    if (g && next.wgsl && next.glsl) {
      prog = g.program({ label: `field ${this.id}`, wgsl: FIELD_WGSL(next.wgsl), glsl: { vertex: FIELD_GLSL_VERTEX, fragment: FIELD_GLSL(next.glsl) }, blocks: ['FieldU'], textures: ['cur', 'tin0', 'tin1', 'tin2', 'tin3'].map((name) => ({ name, kind: '2d' as const, sample: 'unfilterable' as const })), overlay: true, format: 'rgba32f', blend: 'none' });
      await prog.ready;
    }
    if (this.gpu) {
      await this.sync();
      if (prog) { this.gpu.prog.destroy(); this.gpu.prog = prog; this.mode = 'gpu'; } else { this.mode = 'cpu'; }
    }
    this.rule = next; this.p.fill(0); this.setParams(params);
    this.refreshInputs(true);
    if (this.gpu && this.mode === 'gpu') this.gpu.a.write(this.state);
    this.version++; this.invalidate();
    return this;
  }
  /** the rule's numbers (by name) */
  setParams(v: Record<string, number>): this {
    for (const [n, s] of Object.entries(this.rule.params)) this.p[s.slot] = v[n] ?? s.value;
    for (const n of Object.keys(v)) if (!(n in this.rule.params)) throw new AslnutError('E-DATA-001', `field '${this.id}': the rule '${this.rule.name}' has no number '${n}' (it has ${Object.keys(this.rule.params).join(', ') || 'none'})`, { where: this.id });
    return this;
  }
  /** back to the first state (init) */
  reset(init = this.props.init): this {
    const s = this.state, n = this.w * this.h;
    s.fill(0);
    if (typeof init === 'number') for (let k = 0; k < n; k++) s[k * 4] = init;
    else if (typeof init === 'function') { for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) { const [lo, la] = this.lonLatOf(i, j); s[(j * this.w + i) * 4] = init(lo, la); } }
    else if (init instanceof Float32Array) { if (init.length === n * 4) s.set(init); else if (init.length === n) for (let k = 0; k < n; k++) s[k * 4] = init[k]!; else throw new AslnutError('E-DATA-001', `field '${this.id}': init has ${init.length} numbers (want ${n} or ${n * 4})`, { where: this.id }); }
    this.time = 0; this.version++;
    if (this.gpu) this.gpu.a.write(s);
    this.touchProbes(true);
    this.invalidate();
    return this;
  }
  /** play: `rate` simulated seconds a second (0 stops) */
  play(rate = this.props.rate || 1): this { this.playing = rate; this.invalidate(); return this; }
  pause(): this { this.playing = 0; return this; }
  get rate(): number { return this.playing; }
  /** a step's length (s) */
  get dt(): number { return this.props.dt ?? Math.max(1e-4, Math.min(60, this.rule.maxDt(this.cell, this.p))); }
  /** step `seconds` of simulated time (in equal steps no longer than the stable one) */
  step(seconds = this.dt): this {
    if (!(seconds > 0)) return this;
    const n = Math.max(1, Math.ceil(seconds / this.dt - 1e-9)), dt = seconds / n;
    this.refreshInputs();
    if (this.gpu && this.mode === 'gpu') this.stepGpu(n, dt);
    else this.stepCpu(n, dt);
    this.time += n * dt;
    this.invalidate();
    return this;
  }
  /** the state on the CPU caught up with the chip (resolves at once on the CPU) */
  async sync(): Promise<void> {
    if (this.mode !== 'gpu') return;
    // a read already on its way holds what was there before the last steps: wait for it, then read again
    while (this.reading && this.readP) await this.readP;
    if (this.dirtyGpu) await this.readBack();
  }
  /** the value (or another of its numbers) at a place, bilinear between cells; NaN outside */
  at(p: LonLat, channel = 0): number {
    const x = (p[0] - this.box[0]) / this.dLon - 0.5, y = (this.box[3] - p[1]) / this.dLat - 0.5;
    if (x < -0.5 || y < -0.5 || x > this.w - 0.5 || y > this.h - 0.5) return NaN;
    const cx = Math.max(0, Math.min(this.w - 1, x)), cy = Math.max(0, Math.min(this.h - 1, y)), i = Math.min(this.w - 2, Math.floor(cx)), j = Math.min(this.h - 2, Math.floor(cy)), fx = cx - i, fy = cy - j, s = this.state, W = this.w;
    const v = (a: number, b: number) => s[(b * W + a) * 4 + channel]!;
    return (v(i, j) * (1 - fx) + v(i + 1, j) * fx) * (1 - fy) + (v(i, j + 1) * (1 - fx) + v(i + 1, j + 1) * fx) * fy;
  }
  /** one of the four numbers of every cell (w × h, row 0 north) */
  values(channel = 0): Float32Array { const out = new Float32Array(this.w * this.h); for (let k = 0; k < out.length; k++) out[k] = this.state[k * 4 + channel]!; return out; }
  /** watch the value at a point, the mean along a line, or over an area (a ring), as the field steps */
  probe(o: { at?: LonLat; along?: LonLat[]; over?: LonLat[]; every?: 'step' | number }): Probe {
    const cells: number[] = [];
    if (o.at) { const c = this.cellOf(o.at[0], o.at[1]); if (c) cells.push(c[1] * this.w + c[0]); }
    else if (o.along) {
      for (let k = 0; k + 1 < o.along.length; k++) {
        const [a, b] = [o.along[k]!, o.along[k + 1]!], m = Math.hypot((b[0] - a[0]) / this.dLon, (b[1] - a[1]) / this.dLat), n = Math.max(1, Math.ceil(m));
        for (let t = 0; t <= n; t++) { const c = this.cellOf(a[0] + ((b[0] - a[0]) * t) / n, a[1] + ((b[1] - a[1]) * t) / n); if (c) cells.push(c[1] * this.w + c[0]); }
      }
    } else if (o.over) {
      const ring = o.over;
      for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
        const [x, y] = this.lonLatOf(i, j); let inside = false;
        for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xa, ya] = ring[a]!, [xb, yb] = ring[b]!; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) inside = !inside; }
        if (inside) cells.push(j * this.w + i);
      }
    } else throw new AslnutError('E-DATA-001', `field '${this.id}': a probe needs at, along or over`, { where: this.id, fix: 'field.probe({ at: [lon, lat] })' });
    const st: ProbeState = { cells: [...new Set(cells)], series: [], value: NaN, every: o.every ?? 'step', last: -Infinity, on: true };
    this.probes.add(st); this.measure(st, true);
    const self = this;
    return { get value() { return st.value; }, get series() { return st.series; }, stop() { st.on = false; self.probes.delete(st); } };
  }

  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    const want = this.props.gpu ?? 'auto', g = ctx.graphics;
    const can = !!g && g.caps.floatTargets && !!this.rule.wgsl && !!this.rule.glsl;
    if (want === true && !can) throw new AslnutError('E-GPU-003', `field '${this.id}' was asked to run on the chip, which cannot here (${!g ? 'no graphics' : !g.caps.floatTargets ? 'no float targets' : 'the rule has no kernel'})`, { where: this.id, fix: "gpu: 'auto' (the CPU where the chip cannot)" });
    this.refreshInputs(true);
    if (g && can && want !== false) {
      try {
        const prog = g.program({
          label: `field ${this.id}`, wgsl: FIELD_WGSL(this.rule.wgsl!), glsl: { vertex: FIELD_GLSL_VERTEX, fragment: FIELD_GLSL(this.rule.glsl!) },
          blocks: ['FieldU'], textures: ['cur', 'tin0', 'tin1', 'tin2', 'tin3'].map((name) => ({ name, kind: '2d' as const, sample: 'unfilterable' as const })),
          overlay: true, format: 'rgba32f', blend: 'none',
        });
        await prog.ready;
        const tex = (label: string) => g.texture({ label, width: this.w, height: this.h, format: 'rgba32f', filter: 'nearest', renderable: true });
        const a = tex(`${this.id} a`), b = tex(`${this.id} b`);
        a.write(this.state);
        const zero = g.texture({ label: `${this.id} none`, width: 1, height: 1, format: 'rgba32f', filter: 'nearest' }); zero.write(new Float32Array(4));
        this.gpu = { g, prog, a, b, ta: g.layerTarget(a, 0), tb: g.layerTarget(b, 0), block: g.buffer('uniform', 80, `${this.id} field`), ins: [], zero };
        this.uploadInputs();
        this.mode = 'gpu';
      } catch (e) { this.mode = 'cpu'; this.gpu = null; ctx.world.error(e); }
    }
    if (g && this.surfaceDraw) { try { await this.attachSurface(g); } catch (e) { ctx.world.error(e); } }
  }
  /** a surface over the ground is drawn with the solids' last (it is see-through) */
  override get order(): number | undefined { return this.props.order ?? (this.surfaceDraw ? 4.5 : undefined); }
  private get surfaceDraw(): boolean { const d = this.props.draw; return !!d && d.on === 'surface'; }
  private async attachSurface(g: Graphics): Promise<void> {
    const prog = g.program({
      label: `field ${this.id} surface`, wgsl: FIELD_SURFACE_WGSL, glsl: FIELD_SURFACE_GLSL, blocks: ['Frame', 'S'],
      textures: [{ name: 'state', kind: '2d', sample: 'unfilterable' }, { name: 'base', kind: '2d', sample: 'unfilterable' }, { name: 'lut', kind: '2d', sample: 'float' }, { name: 'shadowMap', kind: '2d', sample: 'float' }],
      blend: 'alpha', depth: { write: false, test: 'less' }, cull: 'none',
    });
    await prog.ready;
    const d = (this.props.draw || {}) as FieldDraw, l = this.lut(d), lut = g.texture({ label: `${this.id} ramp`, width: 256, height: 1, format: 'rgba8', filter: 'nearest' });
    lut.write(new Uint8Array(l.buffer.slice(0)));
    const base = g.texture({ label: `${this.id} base`, width: this.w, height: this.h, format: 'rgba32f', filter: 'nearest' });
    this.surf = { g, prog, block: g.buffer('uniform', 64, `${this.id} surface`), lut, state: null, base, baseOf: null, stateVersion: -1, u: new Float32Array(16), lutKey: JSON.stringify(d.ramp ?? 'viridis') };
    this.writeBase();
  }
  /** the ground under the surface: its base input, else the terrain */
  private writeBase(): void {
    const q = this.surf; if (!q) return;
    const name = ((this.props.draw || {}) as FieldDraw).base ?? 'ground', k = this.rule.inputs.indexOf(name);
    let a = k >= 0 ? this.inputs[k] : undefined;
    if (!a) { const world = this.attached?.world; a = new Float32Array(this.w * this.h * 4); for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) { const [lon, lat] = this.lonLatOf(i, j), v = world ? world.heightAt(lon, lat) : NaN; a[(j * this.w + i) * 4] = Number.isFinite(v) ? v : 0; } }
    q.baseOf = a; q.base.write(a);
  }
  private surfaceCall(ctx: FrameContext): DrawCall | null {
    const q = this.surf; if (!q || this.shown <= 0) return null;
    let state: GTexture;
    if (this.gpu && this.mode === 'gpu') state = this.gpu.a;
    else {
      if (!q.state) q.state = q.g.texture({ label: `${this.id} state`, width: this.w, height: this.h, format: 'rgba32f', filter: 'nearest' });
      if (q.stateVersion !== this.version) { q.state.write(this.state); q.stateVersion = this.version; }
      state = q.state;
    }
    const d = (this.props.draw || {}) as FieldDraw, cam = ctx.camera, cv = R * Math.cos(cam.lat * D), mV = mercY(cam.lat);
    const [lon0, lat0] = this.lonLatOf(0, 0), latM = (this.box[1] + this.box[3]) / 2, u = q.u, [lo, hi] = d.domain ?? [0, 1];
    u[0] = cv * (((lon0 - cam.lon + 540) % 360) - 180) * D; u[1] = -cv * (mercY(lat0) - mV); u[2] = cv * this.dLon * D; u[3] = (cv * this.dLat * D) / Math.cos(latM * D);
    u[4] = lo; u[5] = hi; u[6] = d.min ?? -1e30; u[7] = (d.opacity ?? 0.8) * this.shown;
    u[8] = ctx.world.exaggeration; u[9] = this.w; u[10] = this.h; u[11] = d.channel ?? 0;
    u[12] = d.flat ? 1 : 0; u[13] = d.lift ?? (d.flat ? 0.3 : 0); u[14] = 0; u[15] = 0;
    // a ramp changed (setProps): its texture again
    const key = JSON.stringify(d.ramp ?? 'viridis'); if (key !== q.lutKey) { q.lut.write(new Uint8Array(this.lut(d).buffer.slice(0))); q.lutKey = key; }
    q.block.write(u);
    return { program: q.prog, blocks: [ctx.frame, q.block], textures: [state, q.base, q.lut, ctx.shadowMap!], count: (this.w - 1) * (this.h - 1) * 6 };
  }
  override detach(): void {
    const sf = this.surf; this.surf = null;
    if (sf) { sf.prog.destroy(); sf.block.destroy(); sf.lut.destroy(); sf.base.destroy(); sf.state?.destroy(); }
    const q = this.gpu; this.gpu = null;
    if (q) { q.a.destroy(); q.b.destroy(); q.ta.destroy(); q.tb.destroy(); q.block.destroy(); q.zero.destroy(); for (const t of q.ins) t.destroy(); q.prog.destroy(); }
    super.detach();
  }
  override animating(_s: State): boolean { return this.playing > 0 || this.reading; }
  frame(ctx: FrameContext): DrawCall[] {
    if (this.playing > 0 && ctx.dt > 0) {
      let secs = Math.min(0.25, ctx.dt / 1000) * this.playing;
      // on the CPU, a few ms a frame at most: the simulated time falls behind the clock rather than the frames
      if (this.mode === 'cpu') secs = Math.min(secs, Math.max(1, Math.floor(6 / Math.max(0.01, this.cpuStepMs))) * this.dt);
      this.step(secs);
    }
    // the terrain under it, as finer heights arrive (once a second at most)
    if (this.usesTerrain() && ctx.world.groundVersion !== this.terrainSeen && ctx.now - this.terrainAt > 1000) { this.terrainAt = ctx.now; this.refreshInputs(true); }
    if (this.mode === 'gpu' && this.dirtyGpu && !this.reading && ctx.now - this.readAt > (this.playing > 0 ? 250 : 0)) void this.readBack();
    const call = this.surfaceDraw ? this.surfaceCall(ctx) : null;
    return call ? [call] : [];
  }
  /** what the ground paints for it (its look; re-painted as its state changes) */
  painted(): RasterSource | null {
    const d = this.props.draw; if (d === false || this.surfaceDraw) return null;
    const k = Math.round(this.shown * 4) / 4; if (k <= 0) return null;
    const lut = this.lut(d ?? {}), [lo, hi] = d?.domain ?? [0, 1], ch = d?.channel ?? 0, min = d?.min ?? -Infinity, self = this, N = 64;
    return {
      kind: 'imagery', id: `${this.id}:field`, attribution: '', terms: OPEN, where: this.box, minZoom: 0, maxZoom: 24,
      opacity: (d?.opacity ?? 0.8) * k, blend: 'normal', version: this.version,
      async draw(g, t) {
        const [w0, s0, e0, n0] = tileBBox(t.z, t.x, t.y);
        if (e0 < self.box[0] || w0 > self.box[2] || n0 < self.box[1] || s0 > self.box[3]) return false;
        const im = new ImageData(N, N), px = im.data; let any = false;
        for (let y = 0; y < N; y++) {
          // tiles are Mercator: rows by latitude through the tile's own projection
          const v = (y + 0.5) / N, lat = tileLat(t.z, t.y + v);
          for (let x = 0; x < N; x++) {
            const lon = w0 + ((e0 - w0) * (x + 0.5)) / N, val = self.at([lon, lat], ch);
            if (!Number.isFinite(val) || val < min) continue;
            const c = Math.max(0, Math.min(255, Math.round(((val - lo) / (hi - lo || 1)) * 255))) * 4, o = (y * N + x) * 4;
            px[o] = lut[c]!; px[o + 1] = lut[c + 1]!; px[o + 2] = lut[c + 2]!; px[o + 3] = lut[c + 3]!; any = true;
          }
        }
        if (!any) return false;
        const cv = new OffscreenCanvas(N, N); cv.getContext('2d')!.putImageData(im, 0, 0);
        g.imageSmoothingEnabled = true; g.drawImage(cv, 0, 0, 256, 256);
        return true;
      },
    };
  }
  override status() {
    const st = super.status();
    // a step asked for and not seen yet (a playing field is moving, as a fleet is: never pending for that)
    if (this.mode === 'gpu' && this.dirtyGpu && !this.playing) st.pending.push('reading the field back');
    return st;
  }
  override readouts(): Record<string, () => unknown> { return { time: () => this.time, runsOn: () => this.mode, cells: () => this.w * this.h }; }

  // ── stepping ────────────────────────────────────────────────────────────────────────────────────────────────────
  private grid(dt: number): CpuGrid { return { w: this.w, h: this.h, cell: this.cell, dt, cur: this.state, inputs: this.inputs, p: this.p }; }
  /** what one CPU step costs (ms, smoothed) */
  private cpuStepMs = 1;
  private stepCpu(n: number, dt: number): void {
    const t0 = performance.now();
    for (let s = 0; s < n; s++) {
      const g = this.grid(dt), out = this.next;
      for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) this.rule.cpu(g, i, j, out, (j * this.w + i) * 4);
      this.next = this.state; this.state = out;
    }
    this.cpuStepMs += ((performance.now() - t0) / n - this.cpuStepMs) * 0.3;
    this.version++; this.touchProbes();
  }
  private stepGpu(n: number, dt: number): void {
    const q = this.gpu!;
    // the same numbers for every step of this run (a uniform write lands before the steps recorded with it)
    q.block.write(Float32Array.from([this.w, this.h, this.cell, dt, ...this.p]));
    for (let s = 0; s < n; s++) {
      const ins = [0, 1, 2, 3].map((k) => this.inputTexture(k));
      q.g.frame([{ program: q.prog, blocks: [q.block], textures: [q.a, ...ins], count: 3 }], { target: q.tb, clear: [0, 0, 0, 0] });
      [q.a, q.b] = [q.b, q.a]; [q.ta, q.tb] = [q.tb, q.ta];
    }
    this.dirtyGpu = true; this.stepsSinceRead += n;
  }
  private readBack(): Promise<void> {
    if (!this.gpu || this.reading) return this.readP ?? Promise.resolve();
    this.readP = this.readOnce();
    return this.readP;
  }
  private async readOnce(): Promise<void> {
    const q = this.gpu!;
    this.reading = true; this.dirtyGpu = false; this.readAt = performance.now();
    try {
      const px = await q.g.readTexture(q.a);
      if (this.gpu === q && px instanceof Float32Array && px.length === this.state.length) { this.state.set(px); this.version++; this.touchProbes(); }
    } catch (e) { this.attached?.world.error(e); }
    finally { this.reading = false; this.invalidate(); }
  }
  /** the texture a field input is on the chip: another field's state when it runs there too, else an upload */
  private inputTexture(k: number): GTexture {
    const q = this.gpu!, name = this.rule.inputs[k], src = name ? this.props.inputs?.[name] : undefined;
    if (src instanceof RasterField && src.gpu && src.w === this.w && src.h === this.h) return src.gpu.a;
    return q.ins[k] ?? q.zero;
  }
  private usesTerrain(): boolean { return Object.values(this.props.inputs ?? {}).some((x) => x === 'terrain'); }
  /** each input as a grid of this field's size (four numbers a cell) */
  private refreshInputs(force = false): void {
    if (!force && this.inputs.length === this.rule.inputs.length) {
      // fields given as inputs change as they step: theirs are read again each run (CPU) or bound live (chip)
      if (!this.rule.inputs.some((n) => this.props.inputs?.[n] instanceof RasterField)) return;
    }
    const world = this.attached?.world;
    this.inputs = this.rule.inputs.map((name) => {
      const src = this.props.inputs?.[name], out = new Float32Array(this.w * this.h * 4);
      if (src === undefined) return out;
      for (let j = 0; j < this.h; j++) for (let i = 0; i < this.w; i++) {
        const [lon, lat] = this.lonLatOf(i, j), k = (j * this.w + i) * 4;
        if (typeof src === 'number') out[k] = src;
        else if (src === 'terrain') { const v = world ? world.heightAt(lon, lat) : NaN; out[k] = Number.isFinite(v) ? v : 0; }
        else if (typeof src === 'function') out[k] = src(lon, lat);
        else if (src instanceof Float32Array) out[k] = src.length === this.w * this.h * 4 ? src[k]! : src[j * this.w + i]!;
        else if (src instanceof RasterField) { for (let c = 0; c < 4; c++) out[k + c] = src.at([lon, lat], c) || 0; }
      }
      return out;
    });
    if (world) this.terrainSeen = world.groundVersion;
    if (this.gpu) this.uploadInputs();
    if (this.surf) this.writeBase();
  }
  private uploadInputs(): void {
    const q = this.gpu!;
    this.inputs.forEach((a, k) => {
      if (!q.ins[k]) q.ins[k] = q.g.texture({ label: `${this.id} in${k}`, width: this.w, height: this.h, format: 'rgba32f', filter: 'nearest' });
      q.ins[k]!.write(a);
    });
  }
  private touchProbes(force = false): void { for (const p of this.probes) this.measure(p, force); }
  private measure(p: ProbeState, force: boolean): void {
    if (!p.on) return;
    let s = 0, n = 0; for (const c of p.cells) { const v = this.state[c * 4]!; if (Number.isFinite(v)) { s += v; n++; } }
    p.value = n ? s / n : NaN;
    if (force || p.every === 'step' || this.time - p.last >= p.every) { p.series.push([this.time, p.value]); p.last = this.time; if (p.series.length > 10000) p.series.splice(0, p.series.length - 10000); }
  }
  private luts = new Map<string, Uint8ClampedArray>();
  private lut(d: FieldDraw): Uint8ClampedArray {
    const key = JSON.stringify(d.ramp ?? 'viridis'); let l = this.luts.get(key);
    if (!l) { const f = rampOf(d.ramp ?? 'viridis'); l = new Uint8ClampedArray(256 * 4); for (let i = 0; i < 256; i++) { const c = rgba(f(i / 255)); l[i * 4] = c[0] * 255; l[i * 4 + 1] = c[1] * 255; l[i * 4 + 2] = c[2] * 255; l[i * 4 + 3] = c[3] * 255; } this.luts.set(key, l); }
    return l;
  }
  private invalidate(): void { (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); }
}
const tileLat = (z: number, y: number) => { const n = Math.PI - (2 * Math.PI * y) / 2 ** z; return Math.atan(Math.sinh(n)) / D; };

/** a field: field({ kind: 'raster', res, area, rule, … }) */
export function field(p: FieldProps): RasterField {
  if (p.kind && p.kind !== 'raster') throw new AslnutError('E-DATA-001', `field '${p.id}': kind '${p.kind}' is not here yet (raster is)`, { where: p.id, fix: "kind: 'raster'" });
  return new RasterField(p);
}
