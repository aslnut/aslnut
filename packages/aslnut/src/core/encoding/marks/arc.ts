// core › geometry › marks › arc: a line through the air from one place to another (origin → destination flows,
// migrations, trade, calls), along the great circle, rising to a height in the middle and coming down on the ground at
// both ends. It is a line: width, colour per feature, dashes, hover, tooltip, tap, and the reveals trace (from the
// origin, a glowing head), pulse (flowing along) and fade; hooks as the line mark.
//   arc({ id: 'flows', data: rows, from: d => [d.props.olon, d.props.olat], to: d => [d.props.dlon, d.props.dlat],
//         width: d => Math.sqrt(d.props.n), color: scale.category(d => d.props.kind), reveal: { mode: 'trace' } })
// What it keeps is data, not geometry: each arc is one small record (its ends, their heights, the rise, its feature, its
// segments: 40 bytes), drawn as an instance of one strip shared by every arc; the graphics chip makes its points
// (shaders arc.wgsl / arc.glsl). Its colour, width and state are the feature's (the features texture), so a restyle
// writes no record; new data writes the records only; a change of the ground reads two heights an arc and writes
// only the records whose ends moved.
import { AslnutError } from '../../world/errors.ts';
import type { FrameContext } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import type { DrawCall, GBuffer, Graphics } from '../../render/graphics/interface.ts';
import { HOOK_POINTS, assemble, type ParamBlock, type ShaderCode } from '../../render/graphics/shaders/hooks.ts';
import { ARC_GLSL } from '../../render/graphics/shaders/arc.glsl.ts';
import { ARC_WGSL } from '../../render/graphics/shaders/arc.wgsl.ts';
import { rgba, type Color } from '../../render/style/color.ts';
import { D, R, metresBetween, wrap, type LonLat } from '../../space/geo.ts';
import { motionFrames } from '../../runtime/frame.ts';
import { unwrapNear } from '../../geometry/build/mesh.ts';
import { FeatureMark, Prog, type Entry, type FeatureMarkProps, type PerFeature, type Styled } from './features.ts';
import type { LineProps } from './line.ts';
import { sizeUnits, sizeValue, type SizeOf, type SizeUnits } from '../../render/drawing/size.ts';
import type { Leveled } from '../../observation/presence.ts';

/** how many points along each arc: a number for every arc, or by its length (one every `every` metres, `min` to `max`) */
export type ArcPoints = number | { every?: number; min?: number; max?: number };
export interface ArcProps<D> extends Omit<LineProps<D>, 'on' | 'dashes' | 'dashOffset' | 'caps' | 'joins'> {
  /** [on, off] CSS px, for every arc */
  dashes?: [number, number];
  /** where each arc starts */
  from: (d: D) => LonLat;
  /** where it ends */
  to: (d: D) => LonLat;
  /** metres up at the middle (default a quarter of its length, at most 1,500 km); 0 lies on the ground */
  height?: PerFeature<number, D>;
  /** metres above the ground where it starts (a roof, a mast; default 0) */
  fromHeight?: PerFeature<number, D>;
  /** metres above the ground where it ends (default 0) */
  toHeight?: PerFeature<number, D>;
  /** points along each arc (default by its length: one every 25 m, 8 to 64; at most 513). The graphics chip makes
   *  them: more points cost the chip's time only, no memory */
  points?: ArcPoints;
}

/** the great circle from a to b, n points (longitudes kept continuous) */
export function greatCircle(a: LonLat, b: LonLat, n = 64): LonLat[] {
  const [l1, p1, l2, p2] = [a[0] * D, a[1] * D, b[0] * D, b[1] * D];
  const v1 = [Math.cos(p1) * Math.cos(l1), Math.cos(p1) * Math.sin(l1), Math.sin(p1)], v2 = [Math.cos(p2) * Math.cos(l2), Math.cos(p2) * Math.sin(l2), Math.sin(p2)];
  const w = Math.acos(Math.max(-1, Math.min(1, v1[0]! * v2[0]! + v1[1]! * v2[1]! + v1[2]! * v2[2]!)));
  const out: LonLat[] = [];
  let prev = a[0];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    let x: number, y: number, z: number;
    if (w < 1e-9) { x = v1[0]!; y = v1[1]!; z = v1[2]!; }
    else { const s = Math.sin(w), k1 = Math.sin((1 - t) * w) / s, k2 = Math.sin(t * w) / s; x = k1 * v1[0]! + k2 * v2[0]!; y = k1 * v1[1]! + k2 * v2[1]!; z = k1 * v1[2]! + k2 * v2[2]!; }
    let lon = Math.atan2(y, x) / D; const lat = Math.atan2(z, Math.hypot(x, y)) / D;
    while (lon - prev > 180) lon -= 360;
    while (lon - prev < -180) lon += 360;
    prev = lon; out.push([lon, lat]);
  }
  // the ends exactly where they were asked for (the last one on the continuous side)
  out[0] = [a[0], a[1]];
  if (n > 1) { let lb = b[0]; while (lb - out[n - 2]![0] > 180) lb -= 360; while (lb - out[n - 2]![0] < -180) lb += 360; out[n - 1] = [lb, b[1]]; }
  return out;
}

/** floats per arc: ab (its ends, rel. to the origin) · hf (their heights, the rise, the feature) · nw (segments, ± the
 *  direction along; the angle between the ends) */
export const ARC_STRIDE = 10;
/** an arc's segments: by its length (default one every 25 m, 8 to 64 points), or the same for every arc */
export function arcSegments(metres: number, points: ArcPoints | undefined): number {
  if (typeof points === 'number') return Math.max(1, Math.min(512, Math.round(points) - 1));
  const every = points?.every ?? 25, lo = points?.min ?? 8, hi = points?.max ?? 64;
  return Math.max(1, Math.min(512, Math.min(hi, Math.max(lo, Math.ceil(metres / every))) - 1));
}
/** the segments drawn for an arc of n: arcs of one size class share a draw (8 segments a class up to 64, then 64), their
 *  spare points folding onto their last */
export const arcClass = (n: number, points: ArcPoints | undefined) => (typeof points === 'number' ? n : n <= 64 ? Math.ceil(n / 8) * 8 : Math.ceil(n / 64) * 64);

export const arcProgram = (g: Graphics, label: string, code: ShaderCode, params: ParamBlock, blend: FeatureMarkProps<unknown>['blend'] = 'alpha', over = false) => {
  const src = assemble({ wgsl: ARC_WGSL, glsl: ARC_GLSL }, HOOK_POINTS.line, code, params, `layer '${label}'`);
  return new Prog(g, {
    label: `arc ${label}`, wgsl: src.wgsl, glsl: src.glsl, blocks: ['Frame', 'L', 'Params'], textures: [{ name: 'feat', kind: '2d', sample: 'unfilterable' }],
    instance: { stride: ARC_STRIDE, attributes: [{ name: 'ab', location: 0, size: 4, offset: 0 }, { name: 'hf', location: 1, size: 4, offset: 4 }, { name: 'nw', location: 2, size: 2, offset: 8 }] },
    blend: blend ?? 'alpha', depth: { write: false, test: over ? 'always' : 'less' },
  });
};
const val = <T, D>(v: PerFeature<T, D> | undefined, d: D, s: State, def: T): T => (v === undefined ? def : typeof v === 'function' ? (v as (d: D, s: State) => T)(d, s) : v);
/** the arcs of one size class: their records, on the chip in one buffer, drawn in one call */
interface Bucket { n: number; count: number; data: Float32Array; of: Int32Array; own: Float32Array; buf: GBuffer | null; cap: number }

export class Arc<D = unknown> extends FeatureMark<D, ArcProps<D>> {
  readonly kind = 'line' as const;
  protected readonly mark = 'line';
  private arcP: ArcProps<D>;
  /** per feature: its ends (lon, lat, lon, lat; NaN: not drawn) */
  private ends = new Float64Array(0);
  /** per size class: its arcs */
  private buckets = new Map<number, Bucket>();
  /** the strip every arc is an instance of: two vertices a point, its triangles by point (shared by every class) */
  private strip: GBuffer | null = null; private stripN = 0;
  /** the records want making again (new data, or a prop they read: every one of them, `full`) */
  private stale = true; private full = true;
  /** what the records were last made from: the features (by key), their ends, each one's class and place in it */
  /** the records as last written: by the arc's place in the list then (its key → that place) */
  private was: { byKey: Map<string, Entry<D>>; pos: Map<string, number>; E: Float64Array; N: Int32Array; J: Int32Array } | null = null;
  /** the ground version the records' heights are from */
  private heightsAt = -1;
  constructor(p: ArcProps<D>) {
    if (typeof p.from !== 'function' || typeof p.to !== 'function') throw new AslnutError('E-DATA-001', `arc '${p.id}' needs from: d => [lon, lat] and to: d => [lon, lat]`, { where: p.id, fix: 'arc({ data, from: d => [d.props.olon, d.props.olat], to: d => [d.props.dlon, d.props.dlat] })' });
    // it stands where its heights say (the ground under its ends, read here)
    super({ ...p, on: 'absolute' } as ArcProps<D>);
    // (its own props: those given by level as resolved now)
    const run = this.props as unknown as Record<string, unknown>;
    this.arcP = { ...p, ...Object.fromEntries(Object.keys(this.byLevel).filter((k) => k !== 'on').map((k) => [k, run[k]])) } as ArcProps<D>;
  }
  protected override drapeMark(): 'arc' { return 'arc'; }
  protected override legacySits(): 'above' | 'ground' | undefined { return this.props.over === undefined ? undefined : this.props.over ? 'above' : 'ground'; }
  /** drawn over the world: after the buildings and shapes (4), under the points (5), unless placed */
  override get order(): number | undefined { return this.props.order ?? (this.sits === 'above' ? 4.5 : undefined); }
  override setProps(given: Partial<Leveled<ArcProps<D>>>): this { const p = given as Partial<ArcProps<D>>;
    super.setProps(p);
    this.arcP = { ...this.arcP, ...p };
    if (['from', 'to', 'height', 'fromHeight', 'toHeight', 'points', 'reveal'].some((k) => k in p)) { this.stale = true; this.full = true; }
    return this;
  }
  /** a pulse plays forever, flowing dashes move, your code reading the clock changes by itself */
  override animating(s: State): boolean { return super.animating(s) || this.flowing(); }
  /** its frames (core › runtime › frame): a shader reading the clock every display frame; dashes that flow by their
   *  pace (at most a pixel a frame) */
  override wantsFrames(s: State): number { return super.animating(s) ? Infinity : this.flowing() ? motionFrames(Math.abs(this.props.flow!)) : 0; }
  /** dashes that move: the frames keep coming while it is shown and has something to draw (hidden or empty: none) */
  flowing(): boolean { const p = this.props; return !!p.dashes && p.dashes[0] > 0 && !!p.flow && this.shown > 0 && this.entries.length > 0; }
  protected programs(code: ShaderCode): Prog[] { return [arcProgram(this.g!, this.id, code, this.paramBlock!, this.props.blend, this.sits === 'above')]; }
  protected styleProps(): unknown[] { return [this.props.color, sizeValue(this.props.width), this.props.value]; }
  protected override sizeUnits(): SizeUnits { return sizeUnits(this.props.width, `arc '${this.id}' width`); }
  protected style(e: Entry<D>, s: State): Styled {
    const st = this.st; this.colourInto(val(this.props.color, e.d, s, '#ffb000' as Color)); st.number = val(sizeValue(this.props.width), e.d, s, 2); st.value = val(this.props.value, e.d, s, 0);
    return st;
  }
  /** the features with their ends (a two-point line: its box, its middle for reveals and hover) */
  protected override read(now: number): Entry<D>[] {
    const es = super.read(now), p = this.arcP, ends = new Float64Array(es.length * 4);
    for (let i = 0; i < es.length; i++) {
      const e = es[i]!, a = p.from(e.d), b = p.to(e.d);
      if (!(a && b && Number.isFinite(a[0]) && Number.isFinite(a[1]) && Number.isFinite(b[0]) && Number.isFinite(b[1]))) { ends.fill(NaN, i * 4, i * 4 + 4); e.geometry = null; continue; }
      // (b on a's side of ±180°: the short way)
      const lb = a[0] + wrap(b[0] - a[0]);
      ends[i * 4] = a[0]; ends[i * 4 + 1] = a[1]; ends[i * 4 + 2] = lb; ends[i * 4 + 3] = b[1];
      e.geometry = { type: 'LineString', coordinates: [[a[0], a[1]], [lb, b[1]]] };
    }
    this.ends = ends; this.stale = true;
    return es;
  }
  protected build(ctx: FrameContext): void { this.records(ctx); this.boxes(); }
  /** every arc's record, by size class, onto the chip. An arc whose datum and ends are as before keeps its record (its
   *  heights included: the ground pass keeps them); only the new ones are worked out */
  private records(ctx: FrameContext): void {
    this.stale = false;
    const es = this.entries, p = this.arcP, st = ctx.s, o = this.origin, E = this.ends, S = ARC_STRIDE, g = ctx.graphics, full = this.full;
    this.full = false;
    const rv = typeof this.props.reveal === 'object' ? this.props.reveal.from : undefined;
    const old = this.buckets, was = full ? null : this.was, gv = ctx.world.groundVersion;
    let kept = 0;
    // per arc: its class, and the record it keeps (its class and place before), or its length to work one out
    const nOf = new Int32Array(es.length), keep = new Int32Array(es.length).fill(-1), keepN = new Int32Array(es.length), lenOf = new Float64Array(es.length), counts = new Map<number, number>();
    for (let i = 0; i < es.length; i++) {
      const q = i * 4; if (!(E[q] === E[q])) continue;
      const e = es[i]!, pe = was?.byKey.get(e.key), pi = pe ? was!.pos.get(e.key) ?? -1 : -1, pq = pi * 4;
      if (pe && was && pe.d === e.d && was.J[pi]! >= 0 && was.E[pq] === E[q] && was.E[pq + 1] === E[q + 1] && was.E[pq + 2] === E[q + 2] && was.E[pq + 3] === E[q + 3]) {
        const N = was.N[pi]!, j = was.J[pi]!, ob = old.get(N);
        if (ob) { nOf[i] = Math.abs(ob.data[j * S + 8]!); keep[i] = j; keepN[i] = N; counts.set(N, (counts.get(N) ?? 0) + 1); kept++; continue; }
      }
      const len = metresBetween([E[q]!, E[q + 1]!], [E[q + 2]!, E[q + 3]!]), n = arcSegments(len, p.points), N = arcClass(n, p.points);
      nOf[i] = n; lenOf[i] = len; counts.set(N, (counts.get(N) ?? 0) + 1);
    }
    // the classes: new arrays for the arcs in them (the chip's buffers kept while they are big enough)
    const next = new Map<number, Bucket>();
    for (const [N, c] of counts) { const ob = old.get(N); next.set(N, { n: N, count: 0, data: new Float32Array(c * S), of: new Int32Array(c), own: new Float32Array(c * 2), buf: ob?.buf ?? null, cap: ob?.cap ?? 0 }); }
    for (const [N, ob] of old) if (!counts.has(N)) ob.buf?.destroy();
    this.buckets = next;
    const slotN = new Int32Array(es.length), slotJ = new Int32Array(es.length).fill(-1);
    const H = (lon: number, lat: number) => { const h = ctx.world.heightAt(lon, lat); return Number.isNaN(h) ? 0 : h; };
    for (let i = 0; i < es.length; i++) {
      const n = nOf[i]!; if (!n) continue;
      const q = i * 4, e = es[i]!, N = keep[i]! >= 0 ? keepN[i]! : arcClass(n, p.points), k = next.get(N)!, j = k.count++, r = j * S, d = k.data;
      if (keep[i]! >= 0) {
        const ob = old.get(N)!, oj = keep[i]!;
        d.set(ob.data.subarray(oj * S, oj * S + S), r); d[r + 7] = e.index; k.own[j * 2] = ob.own[oj * 2]!; k.own[j * 2 + 1] = ob.own[oj * 2 + 1]!;
      } else {
        const len = lenOf[i]!, ra = o.rel(E[q]!, E[q + 1]!), rb = o.rel(E[q + 2]!, E[q + 3]!), o0 = val(p.fromHeight, e.d, st, 0), o1 = val(p.toHeight, e.d, st, 0);
        // the trace from the end nearest a place: along runs from b
        const rev = !!rv && (E[q + 2]! - rv[0]) ** 2 + (E[q + 3]! - rv[1]) ** 2 < (E[q]! - rv[0]) ** 2 + (E[q + 1]! - rv[1]) ** 2;
        d[r] = ra[0]; d[r + 1] = ra[1]; d[r + 2] = unwrapNear(rb[0], ra[0]); d[r + 3] = rb[1];
        d[r + 4] = H(E[q]!, E[q + 1]!) + o0; d[r + 5] = H(E[q + 2]!, E[q + 3]!) + o1; d[r + 6] = val(p.height, e.d, st, Math.min(1.5e6, len * 0.25)); d[r + 7] = e.index;
        d[r + 8] = rev ? -n : n; d[r + 9] = len / R;
        k.own[j * 2] = o0; k.own[j * 2 + 1] = o1;
      }
      k.of[j] = i; slotN[i] = N; slotJ[i] = j;
    }
    const pos = new Map<string, number>(); for (let i = 0; i < es.length; i++) pos.set(es[i]!.key, i);
    this.was = { byKey: this.byKey, pos, E, N: slotN, J: slotJ };
    // the heights are all from this ground when none was kept, or the kept ones were too (else the ground pass reads them)
    if (!kept || this.heightsAt === gv) this.heightsAt = gv;
    let most = 0;
    for (const b of this.buckets.values()) {
      most = Math.max(most, b.n);
      if (!b.buf || b.cap < b.count) {
        // (exactly what it needs the first time; room to grow only once it has grown)
        const grown = !!b.buf; b.buf?.destroy(); b.cap = grown ? Math.ceil(b.count * 1.25) : b.count;
        b.buf = g.buffer('instance', b.cap * S * 4, `${this.id} arcs ×${b.n}`);
      }
      if (b.count) b.buf.write(b.data);
    }
    if (most > this.stripN || !this.strip) this.makeStrip(g, Math.max(most, 8));
  }
  /** the strip: point k's two vertices are 2k and 2k + 1; segment k's triangles (2k, 2k + 1, 2k + 2) (2k + 2, 2k + 1,
   *  2k + 3) */
  private makeStrip(g: Graphics, n: number): void {
    const ix = new Uint32Array(n * 6);
    for (let k = 0; k < n; k++) ix.set([2 * k, 2 * k + 1, 2 * k + 2, 2 * k + 2, 2 * k + 1, 2 * k + 3], k * 6);
    this.strip?.destroy(); this.strip = g.buffer('index', ix, `${this.id} strip`); this.stripN = n;
  }
  /** the ground changed: two heights an arc read again; only the records whose ends moved are written */
  protected ground(ctx: FrameContext): void {
    if (this.stale || this.heightsAt === ctx.world.groundVersion) return;
    this.heightsAt = ctx.world.groundVersion;
    const S = ARC_STRIDE, E = this.ends;
    for (const b of this.buckets.values()) {
      const d = b.data; let lo = -1, hi = -1;
      for (let j = 0; j < b.count; j++) {
        const q = b.of[j]! * 4;
        const g0 = ctx.world.heightAt(E[q]!, E[q + 1]!), g1 = ctx.world.heightAt(E[q + 2]!, E[q + 3]!);
        const h0 = Math.fround((Number.isNaN(g0) ? 0 : g0) + b.own[j * 2]!), h1 = Math.fround((Number.isNaN(g1) ? 0 : g1) + b.own[j * 2 + 1]!);
        if (h0 !== d[j * S + 4] || h1 !== d[j * S + 5]) { d[j * S + 4] = h0; d[j * S + 5] = h1; if (lo < 0) lo = j; hi = j; }
      }
      if (lo >= 0 && b.buf) b.buf.write(d.subarray(lo * S, (hi + 1) * S), lo * S * 4);
    }
  }
  protected override uniforms(ctx: FrameContext): void {
    const p = this.props, d = p.dashes;
    this.L.set([1, 1, d?.[0] ?? 0, d?.[1] ?? 0], 28);
    this.L.set([p.glow ?? 0.5, d ? p.flow ?? 0 : 0, p.depthBias ?? 2, 0], 32);
    this.L.set([0, 0, 0, 0], 36);
    // its heights are true metres: the shader takes the world's exaggeration for them (not for the rise)
    const ex = (ctx as Partial<FrameContext> | undefined)?.world?.exaggeration;
    if (typeof ex === 'number') this.L[2] = ex;
  }
  protected draws(ctx: FrameContext): DrawCall[] {
    if (this.stale) this.records(ctx);
    const prog = this.progs[0]; if (!prog || !this.strip) return [];
    const out: DrawCall[] = [];
    for (const b of this.buckets.values()) if (b.count && b.buf) out.push(this.call(prog, { instances: b.buf, index: this.strip, count: b.n * 6, instanceCount: b.count }, ctx.frame));
    return out;
  }
  protected freeGeometry(): void { for (const b of this.buckets.values()) b.buf?.destroy(); this.buckets.clear(); this.was = null; this.heightsAt = -1; this.strip?.destroy(); this.strip = null; this.stripN = 0; this.stale = true; this.full = true; }
  /** the arcs drawn, and the segments the chip makes for them */
  override readouts() {
    return {
      count: () => this.size,
      arcs: () => { let n = 0; for (const b of this.buckets.values()) n += b.count; return n; },
      segments: () => { let n = 0; for (const b of this.buckets.values()) for (let j = 0; j < b.count; j++) n += Math.abs(b.data[j * ARC_STRIDE + 8]!); return n; },
    };
  }
}
export const arc = <D = unknown>(p: Leveled<ArcProps<D>>) => new Arc<D>(p as ArcProps<D>);
