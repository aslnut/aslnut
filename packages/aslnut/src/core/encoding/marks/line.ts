// core › geometry › marks › line: lines from data (routes, power lines, faults, rivers, a polygon's boundary), on the
// ground by default (they follow the terrain and the globe), a width in screen pixels, a colour per feature, dashes
// (still, or flowing along: `flow`), and the reveal modes trace (from the start, or from the end nearest a place, with
// a soft front and a glowing head), pulse and fade. Hover, tooltip, tap and selection as every feature layer.
//   line({ id: 'grid', data: data.geojson('/data/power.geojson'), width: d => d.props.kv / 100,
//          color: scale.category(d => d.props.operator), reveal: { mode: 'trace', from: [107.6, -6.9], head: { glow: .8 } } })
import { linesOf, type Feature } from '../../data/features.ts';
import type { FrameContext } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import type { DrawCall, GBuffer, Graphics } from '../../render/graphics/interface.ts';
import { HOOK_POINTS, assemble, type ParamBlock, type ShaderCode } from '../../render/graphics/shaders/hooks.ts';
import { LINE_GLSL } from '../../render/graphics/shaders/line.glsl.ts';
import { LINE_WGSL } from '../../render/graphics/shaders/line.wgsl.ts';
import { rgba, type Color } from '../../render/style/color.ts';
import { PIECE, SEG, Segments, SegmentsJob, type SegmentLine } from '../../geometry/build/segments.ts';
import { FeatureMark, Prog, type Entry, type FeatureMarkProps, type PerFeature, type Styled } from './features.ts';
import { fillRanges, GW, lineDrapeProgram, lineTileProgram, pieceTexture, RangeJob, segmentBox, TilePieces } from './drape.ts';
import type { GTexture, Program } from '../../render/graphics/interface.ts';
import { motionFrames } from '../../runtime/frame.ts';
import { sizeUnits, sizeValue, type SizeOf, type SizeUnits } from '../../render/drawing/size.ts';
import type { Leveled } from '../../observation/presence.ts';

export interface LineProps<D> extends FeatureMarkProps<D> {
  /** CSS px (default 2), or `{ m, min, max }` metres kept within a range of CSS px (core › render › drawing › size) */
  width?: SizeOf<PerFeature<number, D>>;
  color?: PerFeature<Color, D>;
  /** the number hooks read as `value` */
  value?: PerFeature<number, D>;
  /** dashes: [on, off] CSS px, or [on, off, on, off] (an odd list is doubled, as SVG's is, then its first four); one
   *  for every line or each feature's own (a restyle: nothing built again) */
  dashes?: PerFeature<readonly number[], D>;
  /** CSS px the dash pattern starts into the line (default 0); one for all or each feature's own */
  dashOffset?: PerFeature<number, D>;
  /** the dashes move along the line, CSS px a second (from its start towards its end; negative: back); 0 or unset:
   *  they hold still and nothing is redrawn for them. Needs `dashes`. */
  flow?: number;
  /** its ends, drawn on the ground: 'round' (default), 'butt' (flat at the end) or 'square' (half its width past it)
   *  (a line floating free of the ground: flat ends) */
  caps?: 'round' | 'butt' | 'square';
  /** its bends, drawn on the ground: 'bevel' (default: cut at the corner) or 'round' ('miter' is drawn as 'bevel'
   *  there) (a line floating free of the ground: mitred) */
  joins?: 'bevel' | 'round' | 'miter';
  /** pulse brightness */
  glow?: number;
  /** drawn over the world: nothing in front hides it (flows between places, a route to follow); the same as
   *  drape: 'above' (an older name; `drape` wins when both are set) */
  over?: boolean;
}
export const lineProgram = (g: Graphics, label: string, code: ShaderCode, params: ParamBlock, blend: FeatureMarkProps<unknown>['blend'] = 'alpha', over = false) => {
  const src = assemble({ wgsl: LINE_WGSL, glsl: LINE_GLSL }, HOOK_POINTS.line, code, params, `layer '${label}'`);
  return new Prog(g, {
    label: `line ${label}`, wgsl: src.wgsl, glsl: src.glsl, blocks: ['Frame', 'L', 'Params'], textures: [{ name: 'feat', kind: '2d', sample: 'unfilterable' }],
    vertex: { stride: SEG, attributes: [{ name: 'a', location: 0, size: 4, offset: 0 }, { name: 'b', location: 1, size: 4, offset: 4 }, { name: 'p0', location: 2, size: 4, offset: 8 }, { name: 'p3', location: 3, size: 4, offset: 12 }, { name: 'x', location: 4, size: 4, offset: 16 }] },
    blend: blend ?? 'alpha', depth: { write: false, test: over ? 'always' : 'less' },
  });
};
const val = <T, D>(v: PerFeature<T, D> | undefined, d: D, s: State, def: T): T => (v === undefined ? def : typeof v === 'function' ? (v as (d: D, s: State) => T)(d, s) : v);

export class Line<D = Feature> extends FeatureMark<D, LineProps<D>> {
  readonly kind = 'line' as const;
  protected readonly mark = 'line';
  protected segs = new Segments(); private inst: GBuffer | null = null; private ibuf: GBuffer | null = null; private cap = 0;
  protected override drapeable(): boolean { return true; }
  protected override drapeMark(): 'line' { return 'line'; }
  protected override legacySits(): 'above' | undefined { return this.props.over ? 'above' : undefined; }
  /** drawn over the world: after the buildings and shapes (4), under the points (5), unless placed */
  override get order(): number | undefined { return this.props.order ?? (this.sits === 'above' || (this.props.over && !this.draped) ? 4.5 : undefined); }
  /** its part over the twin's solids (made the first time something stands under it), and the programs it was made for */
  private upperProg: Prog | null = null; private upperFor: unknown = null; private upperLast = false;
  private segTex: GTexture | null = null; private pieces: Float32Array = new Float32Array(0); private rangeJob = new RangeJob(() => (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.());
  /** the pieces' own ground ranges are measured (else the prisms stand on the layer's range) */
  private piecesOwn = false;
  // on the ground's tiles: its program (made on first need, again when the shader changes), the segments under a tile
  private tileProg: Program | null = null; private tileOf: unknown = null; private tilePieces = new TilePieces(); private geoGen = 0;
  private tileProgram(): Program {
    if (this.tileProg && this.tileOf === this.progs) return this.tileProg;
    this.tileProg?.destroy(); this.tileOf = this.progs;
    this.tileProg = lineTileProgram(this.g!, this.id, this.code(), this.paramBlock!); this.tileProgramsMade([this.tileProg]);
    return this.tileProg;
  }
  // the pieces' own ranges only make the prisms shorter (fewer pixels to fill); the drape is exact with the layer's
  // range meanwhile: measured while frames go on (a few ms over the next frames), and waited for (settled: its frames
  // come by themselves, a still view that settled draws none)
  // (frames while a run goes on; a run waiting for its turn asks for one frame when its turn comes)
  override animating(s: State): boolean { return super.animating(s) || this.rangeJob.running || this.flowing(); }
  protected override measuring(): boolean { return this.draped && this.rangeJob.busy; }
  /** its frames (core › runtime › frame): the ranges being measured, a shader reading the clock every display frame;
   *  dashes that flow by their pace (at most a pixel a frame: 28 px a second, 30 frames a second) */
  override wantsFrames(s: State): number { return super.animating(s) || this.rangeJob.running ? Infinity : this.flowing() ? motionFrames(Math.abs(this.props.flow!)) : 0; }
  /** dashes that move: the frames keep coming while it is shown and has something to draw (hidden or empty: none) */
  flowing(): boolean { return this.flows() && this.shown > 0 && this.entries.length > 0; }
  private flows(): boolean { const p = this.props; return !!p.dashes && (typeof p.dashes === 'function' || (p.dashes[0] ?? 0) > 0) && !!p.flow; }
  /** flowing dashes change it every frame: never into the ground's tiles */
  protected override selfMoving(): boolean { return super.selfMoving() || this.flows(); }
  protected override rangesStale(): boolean { return this.rangeJob.busy || !this.piecesOwn; }
  /** the pieces' own ranges are worth measuring: drawn as prisms (not into the tiles, not on level ground) */
  // (on the ground's tiles none are: the parts over the solids stand on the layer's range, no job while the view moves)
  private wantRanges(): boolean { return !this.onTiles && this.relief(); }
  protected programs(code: ShaderCode): Prog[] { return this.draped ? [lineDrapeProgram(this.g!, this.id, code, this.paramBlock!, this.props.blend), lineDrapeProgram(this.g!, this.id, code, this.paramBlock!, this.props.blend, true)] : [lineProgram(this.g!, this.id, code, this.paramBlock!, this.props.blend, this.props.over || this.sits === 'above')]; }
  /** the program of its part over the twin's solids (made again when its own are) */
  private upper(): Prog {
    if (this.upperProg && this.upperFor === this.progs) return this.upperProg;
    this.upperProg?.destroy(); this.upperFor = this.progs;
    return (this.upperProg = lineDrapeProgram(this.g!, this.id, this.code(), this.paramBlock!, this.props.blend, false, true));
  }
  protected styleProps(): unknown[] { return [this.props.color, sizeValue(this.props.width), this.props.value, this.props.dashes, this.props.dashOffset]; }
  /** a feature's dashes (on, off, on, off), read into one array */
  private dash: [number, number, number, number] = [0, 0, 0, 0];
  protected override sizeUnits(): SizeUnits { return sizeUnits(this.props.width, `${this.mark} '${this.id}' width`); }
  protected style(e: Entry<D>, s: State): Styled {
    const st = this.st; this.colourInto(val(this.props.color, e.d, s, '#ffb000' as Color)); st.number = val(sizeValue(this.props.width), e.d, s, 2); st.value = val(this.props.value, e.d, s, 0);
    // its dashes (the mark's own plane) and their offset (the numbers' fourth): each feature's, or uniforms when the same
    const ds = val(this.props.dashes, e.d, s, null as readonly number[] | null), dash = this.dash;
    const list = ds && ds.length % 2 ? [...ds, ...ds] : ds ?? [];
    for (let k = 0; k < 4; k++) { const x = Number(list[k]); dash[k] = Number.isFinite(x) && x > 0 ? x : 0; }
    st.extra = dash; st.base = val(this.props.dashOffset, e.d, s, 0);
    return st;
  }
  /** a build under way (its lines read, then its arrays filled, a slice a frame) and the entries it is for */
  private job: { of: unknown; next: Segments; run: SegmentsJob } | null = null;
  /** ms of a frame a build may take (the rest of it goes on in the next frames; what was built before draws meanwhile) */
  static buildSliceMs = 8;
  protected build(ctx: FrameContext): void | false {
    const list = this.buildList();
    if (this.job && this.job.of !== list) this.job = null;
    if (!this.job) { const next = new Segments(); this.job = { of: list, next, run: this.startBuild(next) }; }
    if (!this.job.run.run(Line.buildSliceMs)) return false;
    this.segs = this.job.next; this.job = null;
    this.built2();
    this.boxes();
    this.upload(ctx);
  }
  /** the lines to build, once per build (a subclass measures what it needs first: a trail its times' span) */
  protected startBuild(next: Segments): SegmentsJob {
    const from = typeof this.props.reveal === 'object' ? this.props.reveal.from : undefined;
    const lines: SegmentLine[] = [];
    for (const e of this.buildList()) {
      const g = e.geometry, closed = g?.type === 'Polygon' || g?.type === 'MultiPolygon';
      const cuts = e.cuts?.flat(), parts = linesOf(g);
      for (let k = 0; k < parts.length; k++) {
        const line = parts[k]!;
        let reverse = false;
        if (from && line.length > 1) { const a = line[0]!, b = line[line.length - 1]!; reverse = (b[0] - from[0]) ** 2 + (b[1] - from[1]) ** 2 < (a[0] - from[0]) ** 2 + (a[1] - from[1]) ** 2; }
        lines.push({ f: e.index, line, closed, cuts: cuts?.[k], reverse, along: this.alongOf(e, k) });
      }
    }
    // draped: the pieces alone, written straight into rows of a data texture; else the vertex records
    return new SegmentsJob(next, this.origin, lines, this.step, this.draped ? { form: 'pieces', row: GW * 4 } : {});
  }
  /** a subclass's own measure along a line (by input point), instead of the distance */
  protected alongOf(_e: Entry<D>, _k: number): ((at: number) => number) | undefined { return undefined; }
  /** after the segments are built */
  protected built2(): void {}
  protected upload(ctx: FrameContext): void {
    const n = this.segs.count;
    if (this.draped) {
      if (!n) return;
      this.pieces = this.segs.pieces;
      // the layer's range at once, each segment's own over the next frames (drawn as prisms)
      this.groundRange(ctx, this.segs.lonlat); fillRanges(this.pieces, n, PIECE, 18, this.range); this.piecesOwn = false;
      if (this.wantRanges()) this.rangeJob.start();
      this.segTex = pieceTexture(ctx.graphics, this.segTex, this.pieces, `${this.id} segments`); this.geoGen++; this.lookGen++; return;
    }
    if (!this.inst || this.cap < n) {
      // (exactly what it needs the first time; room to grow only once it has grown: a layer set once holds no spare)
      this.inst?.destroy(); this.ibuf?.destroy(); this.cap = Math.max(64, this.cap ? Math.ceil(n * 1.25) : n);
      this.inst = ctx.graphics.buffer('vertex', this.cap * SEG * 4 * 4, `${this.id} segments`); this.ibuf = ctx.graphics.buffer('index', this.cap * 6 * 4, `${this.id} segment triangles`);
    }
    if (n) { this.inst.write(this.segs.data); this.ibuf!.write(this.segs.index); }
  }
  protected ground(ctx: FrameContext): void {
    // draped: only the range of the ground under it (nothing per vertex)
    if (this.draped) {
      this.groundRange(ctx, this.segs.lonlat);
      // the pieces' ranges again, a slice per frame (draws() goes on with it); else stale until drawn as prisms again
      if (this.segs.count && this.pieces.length >= this.segs.count * PIECE && this.wantRanges()) this.rangeJob.start(); else this.piecesOwn = false;
      return;
    }
    this.segs.ground((lon, lat) => this.groundAt(ctx, lon, lat)); this.upload(ctx);
  }
  protected override uniforms(_ctx: FrameContext): void {
    const p = this.props, d = p.dashes;
    // a (width from the feature, its caps and joins: 0 round / 1 butt / 2 square, 0 bevel / 1 round)
    this.L.set([1, 1, p.caps === 'butt' ? 1 : p.caps === 'square' ? 2 : 0, p.joins === 'round' ? 1 : 0], 28);
    this.L.set([p.glow ?? 0.5, d ? p.flow ?? 0 : 0, p.depthBias ?? 2, 0], 32);
    this.L.set([0, 0, 0, 0], 36);
  }
  protected draws(ctx: FrameContext): DrawCall[] {
    if (this.draped && !this.piecesOwn && !this.rangeJob.busy && this.segs.count && this.wantRanges()) this.rangeJob.start();
    if (this.draped && this.rangeJob.step(ctx.world.rangeIn?.bind(ctx.world), this.segs.count, segmentBox(this.segs), this.pieces, PIECE, 18, this.range)) { this.segTex = pieceTexture(ctx.graphics, this.segTex, this.pieces, `${this.id} segments`); this.piecesOwn = !this.rangeJob.busy; }
    if (this.draped) {
      if (!this.segTex || !this.segs.count) return [];
      const d: DrawCall = { ...this.call(this.progs[this.flatNow ? 1 : 0]!, { count: this.segs.count * (this.flatNow ? 6 : 36) }, ctx.frame), textures: [this.feat!, this.segTex] };
      if (this.onTiles) { this.tileProgram(); d.ground = this.groundDraw('line', this.L, this.lbuf!, ctx.now, ctx.s, (t, frame, lbuf, out) => this.tileDraws(t, frame, lbuf, out)); }
      // over the twin's solids: on the ground its roads and paths, over everything its roofs and crowns too
      this.upperLast = this.upperNow(ctx);
      if (!this.upperLast) return [d];
      return [d, { ...this.call(this.upper(), { count: this.segs.count * 36 }, ctx.frame), textures: [this.feat!, this.segTex], upper: this.sits === 'ground' ? 'ground' : true, pickProgram: undefined }];
    }
    if (!this.inst || !this.segs.count) return [];
    return [this.call(this.progs[0]!, { vertices: this.inst, index: this.ibuf!, count: this.segs.count * 6 }, ctx.frame)];
  }
  /** ahead of being shown on the ground's tiles: its program for them and the grid that finds its segments */
  protected override preparePrograms(): void { if (this.onTiles) this.tileProgram(); if (this.draped && this.solidsAround()) this.upper(); }
  protected override graphicsBusy(): boolean { const u = this.upperProg; return super.graphicsBusy() || (this.onTiles && !this.tileReady) || (this.upperLast && !!u && !u.ok && !u.failed); }
  protected override warm(): void {
    if (!this.onTiles || !this.g) return;
    this.tileProgram();
    if (this.segs.count) this.tilePieces.prepare(this.geoGen, this.segs.count, segmentBox(this.segs));
  }
  /** its segments under one tile, drawn into it */
  private tileDraws(t: { key: number; box: [number, number, number, number]; block: GBuffer }, frame: GBuffer, lbuf: GBuffer, out: DrawCall[]): void {
    const g = this.g, segs = this.segs; if (!g || !this.segTex || !this.feat || !segs.count) return;
    this.tilePieces.prepare(this.geoGen, segs.count, segmentBox(segs));
    const l = this.tilePieces.select(g, t.key, t.box, 0.06); if (!l.n) return;
    out.push({ program: this.tileProgram(), blocks: [frame, lbuf, this.pbuf!, t.block], textures: [this.feat, this.segTex, this.tilePieces.texture!], count: l.n * 6, first: l.first * 6 });
  }
  protected freeGeometry(): void { this.job = null; this.inst?.destroy(); this.ibuf?.destroy(); this.segTex?.destroy(); this.inst = this.ibuf = null; this.segTex = null; this.cap = 0; this.tilePieces.destroy(); this.tileProg?.destroy(); this.tileProg = null; this.upperProg?.destroy(); this.upperProg = null; this.upperFor = null; }
  override readouts() { return { count: () => this.size, segments: () => this.segs.count }; }
}
export const line = <D = Feature>(p: Leveled<LineProps<D>>) => new Line<D>(p as LineProps<D>);
