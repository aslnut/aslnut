// core › geometry › marks › point: a disc per feature, facing the screen, sized in CSS pixels, standing on the ground
// (the terrain under it × exaggeration) unless it gives its own height. Data: an array (each item's `at`, or your
// `at` function) or any source (a point per Point, MultiPoint's each, an area's or a line's middle). Every prop is a
// constant, a function of the feature, or a scale; `when` gates the layer, `feature.when` each feature; hover, tooltip,
// tap, selection and reveals (sweep, pop, fade) as every feature layer; hooks: shader { position, color, alpha, reveal }.
// On the chip each point is its place and its feature (16 bytes); its colour, size, value and state are the feature's,
// read from the features texture as lines and areas read them (a restyle is one write there, eased on the chip).
//   points({ id: 'cities', data: [{ at: [107.6, -6.9], value: 2.5 }], size: d => 4 + d.value * 3, color: '#ffb000' })
import { AslnutError } from '../../world/errors.ts';
import type { FrameContext } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import type { DrawCall, GBuffer } from '../../render/graphics/interface.ts';
import { HOOK_POINTS, assemble, type ShaderCode } from '../../render/graphics/shaders/hooks.ts';
import { POINTS_GLSL } from '../../render/graphics/shaders/points.glsl.ts';
import { POINTS_WGSL } from '../../render/graphics/shaders/points.wgsl.ts';
import { centreOf, pointsOf, type Geometry } from '../../data/features.ts';
import type { LonLatH } from '../../space/geo.ts';
import { rgba, type Color } from '../../render/style/color.ts';
import { FeatureMark, LFLOATS, Prog, type Entry, type FeatureMarkProps, type PerFeature, type Styled } from './features.ts';
import { BEHIND } from './drape.ts';
import { sizeUnits, sizeValue, type SizeOf, type SizeUnits } from '../../render/drawing/size.ts';
import type { Leveled } from '../../observation/presence.ts';

/** an item of an array of points; a source's features come as features ({ id, props, geometry }) */
export interface PointDatum { at: LonLatH; value?: number; id?: string | number; [k: string]: any }   // eslint-disable-line @typescript-eslint/no-explicit-any
export interface PointsProps<D = PointDatum> extends FeatureMarkProps<D> {
  /** where each feature is (default d.at, or the feature's geometry) */
  at?: (d: D) => LonLatH;
  /** diameter: CSS px, or `{ m, min, max }` metres kept within a range of CSS px (core › render › drawing › size) */
  size?: SizeOf<PerFeature<number, D>>;
  /** '#rrggbb', '#rrggbbaa' or [r, g, b, a?] 0..1 */
  color?: PerFeature<Color, D>;
  /** the number hooks read as `value` */
  value?: PerFeature<number, D>;
  /** a ring round each point: its colour and width (CSS px), one for all or each feature's own (default '#00000080',
   *  1.5) */
  outline?: { color?: PerFeature<Color, D>; width?: PerFeature<number, D> };
  /** moving points: each feature's line is its path, `times` the time at each of its points (ms since 1970 or
   *  Dates); the point is where the world's time (or `clock`) puts it, every frame, with no rebuild and nothing per
   *  frame from you (a replay of vehicles, ships, people) */
  along?: { times: (d: D) => readonly (number | Date)[] | null | undefined; clock?: (s: State) => number | Date };
  /** floating over everything (drape 'above', the points' default): a point behind something drawn at this share of
   *  its opacity (default BEHIND: .35; 0: hidden there, as on the ground) */
  behind?: number;
}
/** floats per instance: x, y (from the origin), height m, the feature */
const STRIDE = 4;
const val = <T, D>(v: PerFeature<T, D> | undefined, d: D, s: State, def: T): T => (v === undefined ? def : typeof v === 'function' ? (v as (d: D, s: State) => T)(d, s) : v);

export class Points<D = PointDatum> extends FeatureMark<D, PointsProps<D>> {
  readonly kind = 'point' as const;
  protected readonly mark = 'point';
  private inst: GBuffer | null = null;
  private data = new Float32Array(0); private cap = 0; private count = 0;
  /** each place: lon, lat (float64), its own height (NaN: none), its feature */
  private ll = new Float64Array(0); private own = new Float32Array(0); private fi = new Float32Array(0);
  /** moving points: per place, its path (lon, lat pairs) and times (ms) */
  private paths: ({ ll: Float64Array; t: Float64Array } | null)[] = [];
  constructor(p: PointsProps<D>) {
    super(p);
    if (p.at !== undefined && typeof p.at !== 'function') throw new AslnutError('E-DATA-001', `points '${this.id}': at must be a function d => [lon, lat, h?]`, { where: this.id, fix: 'at: d => d.at' });
  }
  protected override drapeMark(): 'point' { return 'point'; }
  /** floating over everything: what is in front of a point (a building, a hill) dims it, never hides it: the same
   *  points drawn twice, where in front (depth less) and where behind (greater-equal) at `behind` of their opacity: one
   *  more draw, nothing read back, and nothing at all for points on the ground */
  protected programs(code: ShaderCode): Prog[] {
    const src = assemble({ wgsl: POINTS_WGSL, glsl: POINTS_GLSL }, HOOK_POINTS.points, code, this.paramBlock!, `layer '${this.id}'`);
    const desc = {
      label: `points ${this.id}`, wgsl: src.wgsl, glsl: src.glsl, blocks: ['Frame', 'L', 'Params'], textures: [{ name: 'feat', kind: '2d' as const, sample: 'unfilterable' as const }],
      instance: { stride: STRIDE, attributes: [{ name: 'at', location: 0, size: 4 as const, offset: 0 }] },
      blend: 'alpha' as const, depth: { write: false, test: 'less' as const },
    };
    const main = new Prog(this.g!, desc);
    return this.sits === 'above' && (this.props.behind ?? BEHIND) > 0 ? [main, new Prog(this.g!, { ...desc, label: `points ${this.id} (behind)`, depth: { write: false, test: 'greater-equal' } })] : [main];
  }
  /** the layer block of the part behind things (its opacity × behind) */
  private lbufB: GBuffer | null = null; private LB = new Float32Array(LFLOATS);
  protected override read(now: number): Entry<D>[] {
    const list = super.read(now);
    const at = this.props.at;
    if (at) for (const e of list) { const p = at(e.d); e.geometry = { type: 'Point', coordinates: [p[0], p[1], ...(p[2] !== undefined ? [p[2]] : [])] as [number, number] } as Geometry; }
    return list;
  }
  protected styleProps(): unknown[] { return [this.props.color, sizeValue(this.props.size), this.props.value, this.props.outline?.color, this.props.outline?.width]; }
  /** its outline's colour, read as a colour is (one object, no allocation per feature) */
  private oc: [number, number, number, number] = [0, 0, 0, 0.5];
  protected override sizeUnits(): SizeUnits { return sizeUnits(this.props.size, `points '${this.id}' size`); }
  protected style(e: Entry<D>, s: State): Styled {
    const d = e.d as unknown as PointDatum;
    const st = this.st; this.colourInto(val(this.props.color, e.d, s, '#ffb000' as Color)); st.number = val(sizeValue(this.props.size), e.d, s, 8); st.value = val(this.props.value, e.d, s, typeof d?.value === 'number' ? d.value : 0);
    // its outline (each feature's own: the numbers' fourth, the mark's own plane; the same for all: uniforms)
    const o = this.props.outline, oc = val(o?.color, e.d, s, '#00000080' as Color), r = typeof oc === 'string' ? rgba(oc) : oc;
    this.oc[0] = r[0] ?? 0; this.oc[1] = r[1] ?? 0; this.oc[2] = r[2] ?? 0; this.oc[3] = r[3] ?? 1;
    st.base = val(o?.width, e.d, s, 1.5); st.extra = this.oc;
    return st;
  }
  protected build(): void {
    this.paths = [];
    const along = this.props.along, es = this.entries;
    if (along) {
      const ll: number[] = [], fi: number[] = [];
      for (const e of es) {
        // a moving point: its line, its times
        const ln = (e.geometry?.type === 'LineString' ? e.geometry.coordinates : e.geometry?.type === 'MultiLineString' ? e.geometry.coordinates.flat() : null) as [number, number][] | null;
        const ts = along.times(e.d);
        if (!ln?.length || !ts?.length) continue;
        const n = Math.min(ln.length, ts.length), pl = new Float64Array(n * 2), t = new Float64Array(n);
        for (let k = 0; k < n; k++) { pl[2 * k] = ln[k]![0]; pl[2 * k + 1] = ln[k]![1]; const x = ts[k]!; t[k] = typeof x === 'number' ? x : x.getTime(); }
        ll.push(pl[0]!, pl[1]!); fi.push(e.index); this.paths.push({ ll: pl, t });
      }
      this.ll = Float64Array.from(ll); this.fi = Float32Array.from(fi); this.own = new Float32Array(fi.length).fill(NaN);
      this.boxes(); return;
    }
    // count, then fill: a place per Point, per MultiPoint's point, else the feature's middle
    let n = 0;
    for (const e of es) { const g = e.geometry; n += g?.type === 'Point' ? 1 : g?.type === 'MultiPoint' ? g.coordinates.length : centreOf(g) ? 1 : 0; }
    const ll = new Float64Array(n * 2), own = new Float32Array(n), fi = new Float32Array(n);
    let q = 0;
    for (const e of es) {
      const g = e.geometry, pts = g?.type === 'Point' || g?.type === 'MultiPoint' ? pointsOf(g) : null;
      const put = (p: readonly number[]) => { ll[2 * q] = p[0]!; ll[2 * q + 1] = p[1]!; own[q] = p[2] !== undefined ? p[2] : NaN; fi[q] = e.index; q++; };
      if (pts) for (const p of pts) put(p);
      else { const c = centreOf(g); if (c) put(c); }
    }
    this.ll = ll; this.own = own; this.fi = fi;
    this.boxes();
  }
  protected ground(): void {}
  /** the places' ground heights (true m) as last read, and when */
  private hts = new Float32Array(0); private hVer = -1; private hAt = -1e9; private key = ''; private hNext = -1; private hPass = -1;
  /** its heights are the world's exaggeration × its own or the ground's (on any `on`), as it has always stood */
  protected override uniforms(ctx: FrameContext): void {
    const p = this.props, L = this.L;
    const hv = p.hover === false ? null : p.hover ?? (p.tooltip || p.onHover ? { color: '#ffffff' } : null), sl = p.selected === false ? null : p.selected ?? { color: '#ffd166', outline: 2 };
    const hc = rgba(hv?.color ?? '#ffffff'), sc = rgba(sl?.color ?? '#ffd166');
    L[2] = ctx.world.exaggeration;
    // its looks: a hovered / selected colour mixed into the fill (none unless asked), an outline added (px), a size ×
    L[12] = hc[0]; L[13] = hc[1]; L[14] = hc[2]; L[15] = hv?.mix ?? 0;
    L[17] = hv ? hv.outline ?? 1.5 : 0;
    L[20] = sc[0]; L[21] = sc[1]; L[22] = sc[2]; L[23] = sl?.mix ?? 0;
    L[25] = sl ? sl.outline ?? 2 : 0;
    // (the outline's width and colour are each feature's: its numbers' fourth and the mark's own plane)
    L[28] = 0; L[29] = p.depthBias !== undefined ? p.depthBias * 1e-5 : 0.00002; L[30] = hv ? 1.25 : 1; L[31] = sl ? 1.15 : 1;
    L[32] = L[33] = L[34] = L[35] = 0;
    L[36] = L[37] = L[38] = L[39] = 0;
  }
  protected draws(ctx: FrameContext): DrawCall[] {
    const g = ctx.graphics, n = this.fi.length, p = this.props;
    if (!n || !this.feat) return [];
    // as many records as places: each write is the whole buffer (fresh storage on WebGL2, nothing copied for frames
    // in flight)
    if (!this.inst || this.cap !== Math.max(64, n)) { this.inst?.destroy(); this.cap = Math.max(64, n); this.inst = g.buffer('instance', this.cap * STRIDE * 4, `${this.id} instances`); this.data = new Float32Array(this.cap * STRIDE); this.key = ''; }
    // the records hold places from the layer's origin (the view's offset is a uniform) and the ground's true height:
    // written again only when the places or the ground under them changed (a moving point: every frame), never for
    // the camera, the exaggeration or a restyle (the colours, sizes and states are the feature's, on the chip)
    const on = p.on ?? 'ground', moving = this.paths.length > 0, gv = ctx.world.groundVersion;
    // the ground under them read again as it sharpens: a slice of the places a frame (within ~2 ms), the records
    // written once the pass is done (10 000 places read in one frame made a long one on a phone)
    const ll = this.ll, own = this.own;
    const ground = (q: number) => { const h0 = own[q]!, gnd = h0 === h0 ? h0 : on === 'ground' ? ctx.world.heightAt(ll[2 * q]!, ll[2 * q + 1]!) : 0; this.hts[q] = Number.isNaN(gnd) ? 0 : gnd; };
    if (this.hts.length !== n) { this.hts = new Float32Array(n); if (!moving) for (let q = 0; q < n; q++) ground(q); this.hVer = gv; this.hAt = ctx.now; this.hNext = -1; this.key = ''; }
    else if (!moving && this.hNext < 0 && gv !== this.hVer && ctx.now - this.hAt > 250) { this.hNext = 0; this.hPass = gv; }
    if (!moving && this.hNext >= 0) {
      const t0 = performance.now();
      while (this.hNext < n) { ground(this.hNext++); if ((this.hNext & 255) === 0 && performance.now() - t0 > 2) break; }
      if (this.hNext >= n) { this.hNext = -1; this.hVer = this.hPass; this.hAt = ctx.now; this.key = ''; }
    }
    const key = `${this.hVer}|${n}|${this.entries.length}|${this.orderVer}`;
    if (moving || key !== this.key || this.placed !== ll) {
      this.key = key; this.placed = ll;
      const f = this.data, o = this.origin;
      const clock = moving ? (() => { const c = p.along!.clock ? p.along!.clock(ctx.s) : ctx.s.time.now; return typeof c === 'number' ? c : c.getTime(); })() : 0;
      // (each feature's own order: its places written in it, drawn in it; else as the data gives them)
      const seq = this.drawOrder(n);
      for (let k = 0; k < n; k++) {
        const q = seq ? seq[k]! : k, path = this.paths[q];
        // a moving point: where its times put it now (a binary search, then between the two points)
        if (path) { const at = this.whereAt(path, clock); ll[2 * q] = at[0]; ll[2 * q + 1] = at[1]; ground(q); }
        const r = k * STRIDE;
        f[r] = o.x(ll[2 * q]!); f[r + 1] = o.y(ll[2 * q + 1]!); f[r + 2] = this.hts[q]!; f[r + 3] = this.fi[q]!;
      }
      this.count = n;
      this.inst.write(f);
    }
    const prog = this.progs[0]!, out: DrawCall[] = [{ ...this.call(prog, { instances: this.inst, count: 6, instanceCount: this.count }, ctx.frame) }];
    const back = this.progs[1];
    if (back) {
      this.lbufB ??= g.buffer('uniform', LFLOATS * 4, `${this.id} layer (behind)`);
      this.LB.set(this.L); this.LB[4] = this.L[4]! * (p.behind ?? BEHIND); this.lbufB.write(this.LB);
      out.push({ ...this.call(back, { instances: this.inst, count: 6, instanceCount: this.count }, ctx.frame, this.lbufB) });
    }
    return out;
  }
  /** the places in their drawing order (feature.order: lower first, the data's between equals); null: as they are */
  private seq: { ver: number; n: number; fi: Float32Array; list: Uint32Array } | null = null;
  private drawOrder(n: number): Uint32Array | null {
    if (!this.props.feature?.order) return null;
    const c = this.seq; if (c && c.ver === this.orderVer && c.n === n && c.fi === this.fi) return c.list;
    const o = this.orders, fi = this.fi, list = new Uint32Array(n); for (let q = 0; q < n; q++) list[q] = q;
    list.sort((a, b) => (o[fi[a]!]! - o[fi[b]!]!) || a - b);
    this.seq = { ver: this.orderVer, n, fi, list };
    return list;
  }
  /** a feature's order changed: its places written again in it (nothing built again) */
  protected override reordered(): void { this.key = ''; }
  /** the places the records were last written from */
  private placed: Float64Array | null = null;
  private at2: [number, number] = [0, 0];
  private whereAt(p: { ll: Float64Array; t: Float64Array }, now: number): [number, number] {
    const t = p.t, n = t.length, o = this.at2;
    if (now <= t[0]! || n === 1) { o[0] = p.ll[0]!; o[1] = p.ll[1]!; return o; }
    if (now >= t[n - 1]!) { o[0] = p.ll[2 * n - 2]!; o[1] = p.ll[2 * n - 1]!; return o; }
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (t[m]! <= now) lo = m; else hi = m; }
    const k = (now - t[lo]!) / Math.max(1e-9, t[hi]! - t[lo]!);
    o[0] = p.ll[2 * lo]! + (p.ll[2 * hi]! - p.ll[2 * lo]!) * k; o[1] = p.ll[2 * lo + 1]! + (p.ll[2 * hi + 1]! - p.ll[2 * lo + 1]!) * k;
    return o;
  }
  /** moving points change on screen by themselves while their clock runs */
  override animating(_s: State): boolean { return this.hNext >= 0 || (!!this.props.along && (!!this.props.along.clock || (this.attached?.world as { timeRunning?: boolean } | undefined)?.timeRunning === true)); }
  override status(): ReturnType<FeatureMark<D, PointsProps<D>>['status']> {
    const st = super.status();
    if (this.hNext >= 0) { st.pending.push('reading the ground under its places'); st.ready = false; }
    return st;
  }
  protected freeGeometry(): void { this.inst?.destroy(); this.inst = null; this.cap = 0; this.placed = null; this.lbufB?.destroy(); this.lbufB = null; }
  /** places shown now (their feature's own gate lets them) */
  override readouts() { return { count: () => this.size, shown: () => { let k = 0; for (let q = 0; q < this.count; q++) if (this.featData[this.at(this.fi[q]!, 2) + 3]! > 0) k++; return k; } }; }
}
export const points = <D = PointDatum>(p: Leveled<PointsProps<D>>) => new Points<D>(p as PointsProps<D>);
