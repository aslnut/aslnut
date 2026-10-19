// core › geometry › marks › area: polygons from data (suburbs, zones, concessions, parks), lying on the terrain by
// default, a colour per feature (a scale makes a choropleth: a query's numbers recolour it, the shapes stay), an
// outline, an optional height (a plateau), and the reveal modes trace-fill (the outline runs round, then it fills),
// grow, wipe, radial, sweep and fade. Hover lights a feature or its group; tooltip, tap, selection. The outline is
// built only for what shows it: every feature when it has a width of its own, else only the features hovered or
// selected (with a look that has one), built again when they change; nothing at all while none is.
//   area({ id: 'crime', data: suburbs.join(rows, { on: 'code' }), color: scale.quantile(d => d.props.rate, { range: 'reds' }),
//          outline: { width: 1, color: '#ffffff40' }, hover: { color: '#fff', mix: .3, outline: 3 }, tooltip: d => d.props.name })
import { bboxOf, contains, polygonsOf, type Feature, type Position } from '../../data/features.ts';
import type { FrameContext } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import type { DrawCall, GBuffer } from '../../render/graphics/interface.ts';
import { AREA_GLSL } from '../../render/graphics/shaders/area.glsl.ts';
import { AREA_WGSL } from '../../render/graphics/shaders/area.wgsl.ts';
import { HOOK_POINTS, assemble, type ShaderCode } from '../../render/graphics/shaders/hooks.ts';
import { rgba, type Color } from '../../render/style/color.ts';
import { Grow, polygonMesh, type Origin } from '../../geometry/build/mesh.ts';
import { PIECE, SEG, Segments, type SegmentLine } from '../../geometry/build/segments.ts';
import { FeatureMark, LFLOATS, P_BOX, Prog, type Entry, type FeatureMarkProps, type PerFeature, type Styled } from './features.ts';
import { lineProgram } from './line.ts';
import { areaDrapeProgram, areaTileProgram, fillRanges, GW, IMAGE_TEXTURE, lineDrapeProgram, lineTileProgram, pieceTexture, RangeJob, segmentBox, TilePieces, withImage } from './drape.ts';
import type { GTexture, Program } from '../../render/graphics/interface.ts';

export interface AreaProps<D> extends FeatureMarkProps<D> {
  color?: PerFeature<Color, D>;
  /** px, or { width, color }; 0 = none (hover and selection outlines still show) */
  outline?: number | { width?: number; color?: Color };
  /** metres the area stands above where it lies (0: on the ground) */
  height?: PerFeature<number, D>;
  value?: PerFeature<number, D>;
}
const val = <T, D>(v: PerFeature<T, D> | undefined, d: D, s: State, def: T): T => (v === undefined ? def : typeof v === 'function' ? (v as (d: D, s: State) => T)(d, s) : v);
/** a ring's points without its closing repeat */
const ringN = (r: Position[]) => (r.length > 1 && r[0]![0] === r[r.length - 1]![0] && r[0]![1] === r[r.length - 1]![1] ? r.length - 1 : r.length);
/** the places of a polygon's mesh points: the rings' own (no point added) or each one from the origin */
function meshLonLat(o: Origin, rings: Position[][], xy: Float64Array, out: Grow<Float64Array>): void {
  const n = xy.length / 2, a = out.room(n * 2);
  let total = 0; for (const r of rings) total += ringN(r);
  if (total === n) { for (const r of rings) for (let i = 0, k = ringN(r); i < k; i++) { a[out.n++] = r[i]![0]; a[out.n++] = r[i]![1]; } return; }
  for (let k = 0; k < n; k++) { a[out.n++] = o.lonOf(xy[2 * k]!); a[out.n++] = o.latOf(xy[2 * k + 1]!); }
}

export class Area<D = Feature> extends FeatureMark<D, AreaProps<D>> {
  readonly kind = 'area' as const;
  protected readonly mark = 'area';
  private lonlat: Float64Array = new Float64Array(0); private verts: Float32Array = new Float32Array(0); private vbuf: GBuffer | null = null; private ibuf: GBuffer | null = null; private nIdx = 0;
  private segs = new Segments(); private sbuf: GBuffer | null = null; private sibuf: GBuffer | null = null; private scap = 0; private lbuf2: GBuffer | null = null; private L2 = new Float32Array(LFLOATS);
  /** on the ground with no height: draped (exact on any terrain) */
  protected override drapeable(): boolean { return this.props.height === undefined || this.props.height === 0; }
  protected override drapeMark(): 'area' | 'raster' { return 'area'; }
  /** a picture over its box instead of its colour (an image raster: its texture, and imageAt in its colour hook) */
  protected imaged(): boolean { return false; }
  protected imageTex: GTexture | null = null;
  /** the textures of a fill draw: its own, then the picture's */
  private withPic(t: GTexture[]): GTexture[] { return this.imaged() && this.imageTex ? [...t, this.imageTex] : t; }
  /** its fill's and outline's parts over the twin's solids (made the first time something stands under it), and the
   *  programs they were made for */
  private upperProgs: [Prog, Prog] | null = null; private upperFor: unknown = null; private upperLast = false;
  private uppers(): [Prog, Prog] {
    if (this.upperProgs && this.upperFor === this.progs) return this.upperProgs;
    this.upperProgs?.forEach((p) => p.destroy()); this.upperFor = this.progs;
    const code = this.code();
    return (this.upperProgs = [areaDrapeProgram(this.g!, this.id, code, this.paramBlock!, this.props.blend, false, true, this.imaged()), lineDrapeProgram(this.g!, `${this.id} outline`, { functions: code.functions }, this.paramBlock!, this.props.blend, false, true)]);
  }
  /** its shaders read each feature's box (the reveals grow, wipe, radial) */
  protected override planesWanted(): number { return super.planesWanted() | (1 << P_BOX); }
  private triTex: GTexture | null = null; private segTex: GTexture | null = null; private nTri = 0;
  /** draped: the triangles' records (12 floats: a, b · c, feature · the ground's range), their boxes, the outline's */
  private tri: Float32Array = new Float32Array(0); private triBox: Float64Array = new Float64Array(0); private segPieces: Float32Array = new Float32Array(0);
  private ask = () => (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.();
  private triJob = new RangeJob(this.ask); private segJob = new RangeJob(this.ask);
  /** the pieces' own ranges are measured (else the prisms stand on the layer's range) */
  private triOwn = false; private segOwn = false;
  // on the ground's tiles: the fill's and the outline's programs (made on first need, again when the shader changes),
  // the triangles and segments under a tile
  private tileProgs: [Program, Program] | null = null; private tileOf: unknown = null; private triPieces = new TilePieces(); private segPieces2 = new TilePieces(); private geoGen = 0; private outGen = 0;
  private tilePrograms(): [Program, Program] {
    if (this.tileProgs && this.tileOf === this.progs) return this.tileProgs;
    this.tileProgs?.forEach((p) => p.destroy()); this.tileOf = this.progs;
    const code = this.code();
    this.tileProgs = [areaTileProgram(this.g!, this.id, code, this.paramBlock!, this.imaged()), lineTileProgram(this.g!, `${this.id} outline`, { functions: code.functions }, this.paramBlock!)];
    this.tileProgramsMade(this.tileProgs);
    return this.tileProgs;
  }
  protected override preparePrograms(): void { if (this.onTiles) this.tilePrograms(); if (this.draped && this.solidsAround()) this.uppers(); }
  protected override graphicsBusy(): boolean { return super.graphicsBusy() || (this.onTiles && !this.tileReady) || (this.upperLast && !!this.upperProgs?.some((p) => !p.ok && !p.failed)); }
  private triBoxOf = (i: number, b: Float64Array) => { const tb = this.triBox; b[0] = tb[4 * i]!; b[1] = tb[4 * i + 1]!; b[2] = tb[4 * i + 2]!; b[3] = tb[4 * i + 3]!; };
  /** the pieces' own ranges are worth measuring: drawn as prisms (not into the tiles, not on level ground) */
  // (on the ground's tiles none are: the parts over the solids stand on the layer's range, no job while the view moves)
  private wantRanges(): boolean { return !this.onTiles && this.relief(); }
  protected override rangesStale(): boolean { return this.triJob.busy || !this.triOwn; }
  private stepRanges(ctx: FrameContext): void {
    if (this.wantRanges()) {
      if (!this.triOwn && !this.triJob.busy && this.nTri) this.triJob.start();
      if (this.outlineKey === '*' && !this.segOwn && !this.segJob.busy && this.segs.count) this.segJob.start();
    }
    if (!this.triJob.busy && !this.segJob.busy) return;
    const r = ctx.world.rangeIn?.bind(ctx.world);
    if (this.triJob.step(r, this.nTri, this.triBoxOf, this.tri, 12, 8, this.range) && this.nTri) { this.triTex = pieceTexture(ctx.graphics, this.triTex, this.tri, `${this.id} triangles`); this.triOwn = !this.triJob.busy; }
    if (!this.triJob.busy && this.segJob.step(r, this.segs.count, segmentBox(this.segs), this.segPieces, PIECE, 18, this.range) && this.segs.count) { this.segTex = pieceTexture(ctx.graphics, this.segTex, this.segPieces, `${this.id} outline`); this.segOwn = !this.segJob.busy; }
  }
  // the pieces' own ranges only make the prisms shorter (fewer pixels to fill); the drape is exact with the layer's
  // range meanwhile: never waited for (settled), measured while frames go on (a few ms over the next frames)
  // (frames while a run goes on; a run waiting for its turn asks for one frame when its turn comes)
  override animating(s: State): boolean { return super.animating(s) || this.triJob.running || this.segJob.running; }
  protected programs(code: ShaderCode): Prog[] {
    if (this.draped) {
      const outline = { functions: code.functions };
      return [areaDrapeProgram(this.g!, this.id, code, this.paramBlock!, this.props.blend, false, false, this.imaged()), lineDrapeProgram(this.g!, `${this.id} outline`, outline, this.paramBlock!, this.props.blend),
        areaDrapeProgram(this.g!, this.id, code, this.paramBlock!, this.props.blend, true, false, this.imaged()), lineDrapeProgram(this.g!, `${this.id} outline`, outline, this.paramBlock!, this.props.blend, true)];
    }
    const src = assemble(withImage({ wgsl: AREA_WGSL, glsl: AREA_GLSL }, 1, this.imaged()), HOOK_POINTS.area, code, this.paramBlock!, `layer '${this.id}'`);
    const fill = new Prog(this.g!, {
      label: `area ${this.id}`, wgsl: src.wgsl, glsl: src.glsl, blocks: ['Frame', 'L', 'Params'], textures: [{ name: 'feat', kind: '2d', sample: 'unfilterable' }, ...(this.imaged() ? [IMAGE_TEXTURE] : [])],
      vertex: { stride: 4, attributes: [{ name: 'v', location: 0, size: 4, offset: 0 }] }, blend: this.props.blend ?? 'alpha', depth: { write: false, test: this.sits === 'above' ? 'always' : 'less' },
    });
    return [fill, lineProgram(this.g!, `${this.id} outline`, { functions: code.functions }, this.paramBlock!, this.props.blend, this.sits === 'above')];
  }
  protected styleProps(): unknown[] { return [this.props.color, this.props.height, this.props.value]; }
  protected style(e: Entry<D>, s: State): Styled {
    const st = this.st; this.colourInto(val(this.props.color, e.d, s, '#4e79a7cc' as Color)); st.number = val(this.props.height, e.d, s, 0); st.value = val(this.props.value, e.d, s, 0);
    return st;
  }
  protected build(ctx: FrameContext): void | false {
    // the outline is built again for the new shapes when it next shows
    this.outlineKey = ''; this.outlineOf = null;
    if (this.draped) return this.buildDraped(ctx);
    const o = this.origin, ll = new Grow(new Float64Array(1024)), vs = new Grow(new Float32Array(2048)), idx = new Grow(new Uint32Array(1536));
    for (const e of this.entries) {
      for (const rings of polygonsOf(e.geometry)) {
        const m = polygonMesh(o, rings, this.step), n = m.xy.length / 2, base = vs.n / 4;
        meshLonLat(o, rings, m.xy, ll);
        const v = vs.room(n * 4);
        for (let k = 0; k < n; k++) { v[vs.n++] = m.xy[2 * k]!; v[vs.n++] = m.xy[2 * k + 1]!; v[vs.n++] = 0; v[vs.n++] = e.index; }
        const t = m.tris, x = idx.room(t.length);
        for (let k = 0; k < t.length; k++) x[idx.n++] = base + t[k]!;
      }
    }
    this.lonlat = ll.done(); this.verts = vs.done(); this.nIdx = idx.n;
    this.vbuf?.destroy(); this.ibuf?.destroy(); this.vbuf = this.ibuf = null;
    if (this.nIdx) { this.vbuf = ctx.graphics.buffer('vertex', this.verts, `${this.id} vertices`); this.ibuf = ctx.graphics.buffer('index', idx.done(), `${this.id} triangles`); }
    this.lbuf2 ??= ctx.graphics.buffer('uniform', LFLOATS * 4, `${this.id} outline layer`);
    this.boxes();
  }
  /** draped: the triangles (counter-clockwise, 3 texels each) into a data texture; the ground is never read per vertex
   *  (only its range). Built a few polygons per frame (a few ms each frame: a country's regions never make a long
   *  frame); what was built before draws until it is done */
  private job: { of: unknown; i: number; ll: Grow<Float64Array>; tri: Grow<Float32Array>; boxes: Grow<Float64Array> } | null = null;
  private buildDraped(ctx: FrameContext): void | false {
    // new shapes while a build was under way: it starts again
    if (this.job && this.job.of !== this.entries) this.job = null;
    // sized from the rings at first (a polygon of n corners and h holes is n + 2h - 2 triangles when nothing is split)
    if (!this.job) {
      let pts = 0, tris = 0;
      for (const e of this.entries) for (const rings of polygonsOf(e.geometry)) { let n = 0; for (const r of rings) n += ringN(r); pts += n; tris += Math.max(0, n + 2 * (rings.length - 1) - 2); }
      this.job = { of: this.entries, i: 0, ll: new Grow(new Float64Array(Math.max(64, pts * 2))), tri: new Grow(new Float32Array(Math.max(1, Math.ceil((tris * 12) / (GW * 4))) * GW * 4)), boxes: new Grow(new Float64Array(Math.max(64, tris * 4))) };
    }
    const j = this.job;
    // long edges split for the globe's curve, and so that each piece's prism stands only as tall as the ground under
    // that piece (a few kilometres: little fill even over mountains)
    const step = Math.max(this.step, 2500), t0 = performance.now(), o = this.origin, { ll, tri, boxes } = j;
    for (; j.i < this.entries.length; j.i++) {
      if (performance.now() - t0 > 4) return false;
      const e = this.entries[j.i]!;
      for (const rings of polygonsOf(e.geometry)) {
        const m = polygonMesh(o, rings, step), base = ll.n / 2, xy = m.xy, t = m.tris;
        meshLonLat(o, rings, xy, ll);
        const L = ll.a, T = tri.room((t.length / 3) * 12), B = boxes.room((t.length / 3) * 4);
        for (let k = 0; k + 2 < t.length; k += 3) {
          const a = t[k]!, b = t[k + 1]!, c = t[k + 2]!;
          const ax = xy[2 * a]!, ay = xy[2 * a + 1]!, bx = xy[2 * b]!, by = xy[2 * b + 1]!, cx = xy[2 * c]!, cy = xy[2 * c + 1]!;
          const area2 = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
          if (area2 === 0) continue;
          const q = tri.n;
          T[q] = ax; T[q + 1] = ay;
          if (area2 > 0) { T[q + 2] = bx; T[q + 3] = by; T[q + 4] = cx; T[q + 5] = cy; } else { T[q + 2] = cx; T[q + 3] = cy; T[q + 4] = bx; T[q + 5] = by; }
          T[q + 6] = e.index; T[q + 7] = 0; T[q + 8] = 0; T[q + 9] = 0; T[q + 10] = 0; T[q + 11] = 0; tri.n += 12;
          // its box from its corners' places (already known)
          const la = 2 * (base + a), lb = 2 * (base + b), lc = 2 * (base + c), r = boxes.n;
          B[r] = Math.min(L[la]!, L[lb]!, L[lc]!); B[r + 1] = Math.min(L[la + 1]!, L[lb + 1]!, L[lc + 1]!); B[r + 2] = Math.max(L[la]!, L[lb]!, L[lc]!); B[r + 3] = Math.max(L[la + 1]!, L[lb + 1]!, L[lc + 1]!); boxes.n += 4;
        }
      }
    }
    this.job = null;
    this.lonlat = ll.done(); this.nTri = tri.n / 12; this.triBox = boxes.done();
    // padded to whole texture rows (written as it is): the array itself when it was sized right
    const padded = Math.max(1, Math.ceil(tri.n / (GW * 4))) * GW * 4;
    if (tri.a.length === padded) this.tri = tri.a; else { this.tri = new Float32Array(padded); this.tri.set(tri.a.subarray(0, tri.n)); }
    // the layer's own range at once (the prisms stand from its lowest to its highest ground), each piece's own over
    // the next frames
    this.groundRange(ctx, this.lonlat);
    fillRanges(this.tri, this.nTri, 12, 8, this.range); this.triOwn = false;
    if (this.nTri) this.triTex = pieceTexture(ctx.graphics, this.triTex, this.tri, `${this.id} triangles`);
    this.lbuf2 ??= ctx.graphics.buffer('uniform', LFLOATS * 4, `${this.id} outline layer`);
    this.geoGen++; this.lookGen++;
    this.boxes();
  }
  // ── the outline: built for what shows it ─────────────────────────────────────────────────────────────────────
  /** what the outline is built for: '' nothing, '*' every feature, else the lit features' keys; and for which entries */
  private outlineKey = ''; private outlineOf: unknown = null;
  private outlineWidths(): { own: number; hover: number; selected: number } {
    const p = this.props;
    return { own: typeof p.outline === 'number' ? p.outline : p.outline?.width ?? 0, hover: p.hover ? p.hover.outline ?? 0 : 0, selected: p.selected === false ? 0 : p.selected?.outline ?? 2 };
  }
  /** the outline for what shows it now, built again when that changed */
  private outline(ctx: FrameContext): void {
    const w = this.outlineWidths();
    const keys = w.own > 0 ? null : this.litKeys(w.hover > 0, w.selected > 0);
    const key = keys === null ? '*' : keys.length ? `+${keys.join('\u0001')}` : '';
    if (key === this.outlineKey && this.outlineOf === this.entries) return;
    this.outlineKey = key; this.outlineOf = this.entries;
    const list: Entry<D>[] = keys === null ? this.entries : keys.map((k) => this.entryOf(k)!).filter(Boolean);
    const lines: SegmentLine[] = [];
    for (const e of list) polygonsOf(e.geometry).forEach((rings, pi) => rings.forEach((r, ri) => lines.push({ f: e.index, line: r, closed: true, cuts: e.cuts?.[pi]?.[ri] })));
    const draped = this.draped;
    this.segs.build(this.origin, lines, draped ? Math.max(this.step, 2500) : this.step, draped ? { form: 'pieces', row: GW * 4 } : {});
    // (the look's version moved already: the lit features' states changed, and the ground's tiles draw again where they
    // are; the tiles' lists of outline pieces are made again)
    this.outGen++; this.segOwn = false;
    if (draped) {
      this.segPieces = this.segs.pieces;
      fillRanges(this.segPieces, this.segs.count, PIECE, 18, this.range);
      // (on the ground's tiles an empty one is kept too: its tiles' part stays in the list, so a hover drawn into them
      // is drawn again only where it changed)
      if (this.segs.count || this.onTiles) this.segTex = pieceTexture(ctx.graphics, this.segTex, this.segPieces, `${this.id} outline`);
      return;
    }
    if (this.attached) this.segs.ground((lon, lat) => this.groundAt(ctx, lon, lat));
    const n = this.segs.count;
    if (n && (!this.sbuf || this.scap < n)) {
      this.sbuf?.destroy(); this.sibuf?.destroy(); this.scap = Math.max(64, n);
      this.sbuf = ctx.graphics.buffer('vertex', this.scap * SEG * 4 * 4, `${this.id} outline`); this.sibuf = ctx.graphics.buffer('index', this.scap * 6 * 4, `${this.id} outline triangles`);
    }
    if (n) { this.sbuf!.write(this.segs.data); this.sibuf!.write(this.segs.index); }
  }
  protected ground(ctx: FrameContext): void {
    if (this.draped) {
      this.groundRange(ctx, this.lonlat);
      // the pieces' ranges again (prisms only), else marked stale: measured when they are drawn as prisms again
      if (this.wantRanges()) { this.triJob.start(); if (this.outlineKey === '*') this.segJob.start(); }
      else { this.triOwn = false; this.segOwn = false; }
      return;
    }
    const v = this.verts, ll = this.lonlat;
    for (let i = 0, n = v.length / 4; i < n; i++) v[i * 4 + 2] = this.groundAt(ctx, ll[2 * i]!, ll[2 * i + 1]!);
    this.vbuf?.write(v);
    if (this.segs.count) { this.segs.ground((lon, lat) => this.groundAt(ctx, lon, lat)); this.sbuf?.write(this.segs.data); }
  }
  protected override uniforms(): void {
    const p = this.props, o = typeof p.outline === 'number' ? { width: p.outline } : p.outline ?? {}, oc = rgba(o.color ?? '#ffffff59');
    this.L.set([p.depthBias ?? 1.5, 1, 0, 0], 28);
    this.L.set([0, 0, 0, 0], 32); this.L.set([0, 0, 0, 0], 36);
    // the outline: the same layer block, a width of its own, its colour, in outline mode
    this.L2.set(this.L);
    this.L2.set([o.width ?? 0, 0, 0, 0], 28);
    this.L2.set([0, 0, (p.depthBias ?? 1.5) + 0.5, 1], 32);
    this.L2.set(oc, 36);
    // only the whole outline has its pieces' own ranges measured (the lit features' stand on the layer's range)
    this.L2[43] = this.outlineKey === '*' && this.segOwn && !this.segJob.busy ? 0 : 1;
    this.lbuf2?.write(this.L2);
  }
  protected draws(ctx: FrameContext): DrawCall[] {
    const out: DrawCall[] = [];
    this.outline(ctx);
    if (this.draped) {
      this.stepRanges(ctx);
      if (this.onTiles) this.tilePrograms();
      const k = this.flatNow ? 2 : 0;
      if (this.triTex && this.nTri) {
        const d: DrawCall = { ...this.call(this.progs[k]!, { count: this.nTri * (this.flatNow ? 3 : 24) }, ctx.frame), textures: this.withPic([this.feat!, this.triTex]) };
        if (this.onTiles) d.ground = this.groundDraw('fill', this.L, this.lbuf!, ctx.now, ctx.s, (t, frame, lbuf, o) => this.fillTile(t, frame, lbuf, o));
        out.push(d);
      }
      // on the ground's tiles the outline's part is there whenever a hover or selection could show one (empty while
      // none is lit): a hover then redraws only the tiles where it changed
      const w = this.outlineWidths(), tiles = this.onTiles && (w.own > 0 || w.hover > 0 || w.selected > 0);
      if (tiles && !this.segTex) this.segTex = pieceTexture(ctx.graphics, null, this.segPieces.length ? this.segPieces : new Float32Array(GW * 4), `${this.id} outline`);
      if (this.segTex && this.lbuf2 && ((this.segs.count && this.outlineKey) || tiles)) {
        const d: DrawCall = { ...this.call(this.progs[k + 1]!, { count: this.segs.count * (this.flatNow ? 6 : 36) }, ctx.frame, this.lbuf2), textures: [this.feat!, this.segTex] };
        if (this.onTiles) d.ground = this.groundDraw('outline', this.L2, this.lbuf2, ctx.now, ctx.s, (t, frame, lbuf, o) => this.outlineTile(t, frame, lbuf, o));
        out.push(d);
      }
      // over the twin's solids: its roofs and crowns ('over'), or its roads' and paths' meshes ('ground')
      this.upperLast = this.upperNow(ctx);
      if (this.upperLast) {
        const [uf, uo] = this.uppers();
        const upper = this.sits === 'ground' ? 'ground' as const : true;
        if (this.triTex && this.nTri) out.push({ ...this.call(uf, { count: this.nTri * 24 }, ctx.frame), textures: this.withPic([this.feat!, this.triTex]), upper, pickProgram: undefined });
        if (this.segTex && this.lbuf2 && this.segs.count && this.outlineKey) out.push({ ...this.call(uo, { count: this.segs.count * 36 }, ctx.frame, this.lbuf2), textures: [this.feat!, this.segTex], upper, pickProgram: undefined });
      }
      return out;
    }
    if (this.vbuf && this.ibuf && this.nIdx) { const d = this.call(this.progs[0]!, { vertices: this.vbuf, index: this.ibuf, count: this.nIdx }, ctx.frame); out.push({ ...d, textures: this.withPic(d.textures ?? []) }); }
    if (this.sbuf && this.sibuf && this.segs.count && this.lbuf2 && this.outlineKey) out.push(this.call(this.progs[1]!, { vertices: this.sbuf, index: this.sibuf, count: this.segs.count * 6 }, ctx.frame, this.lbuf2));
    return out;
  }
  /** ahead of being shown on the ground's tiles: the grids that find the pieces under a tile */
  protected override warm(): void {
    if (!this.onTiles || !this.g) return;
    // its programs for the tiles built now (in the background): shown before they are, it is drawn as prisms, every
    // vertex of the layer for a few frames
    this.tilePrograms();
    if (this.nTri) this.triPieces.prepare(this.geoGen, this.nTri, this.triBoxOf);
  }
  /** its triangles under one tile, drawn into it */
  private fillTile(t: { key: number; box: [number, number, number, number]; block: GBuffer }, frame: GBuffer, lbuf: GBuffer, out: DrawCall[]): void {
    const g = this.g; if (!g || !this.triTex || !this.feat || !this.nTri) return;
    this.triPieces.prepare(this.geoGen, this.nTri, this.triBoxOf);
    const l = this.triPieces.select(g, t.key, t.box, 0); if (!l.n) return;
    out.push({ program: this.tilePrograms()[0], blocks: [frame, lbuf, this.pbuf!, t.block], textures: this.withPic([this.feat, this.triTex, this.triPieces.texture!]), count: l.n * 3, first: l.first * 3 });
  }
  /** its outline under one tile, drawn into it */
  private outlineTile(t: { key: number; box: [number, number, number, number]; block: GBuffer }, frame: GBuffer, lbuf: GBuffer, out: DrawCall[]): void {
    const g = this.g, segs = this.segs; if (!g || !this.segTex || !this.feat || !segs.count) return;
    this.segPieces2.prepare(this.outGen, segs.count, segmentBox(segs));
    const l = this.segPieces2.select(g, t.key, t.box, 0.06); if (!l.n) return;
    out.push({ program: this.tilePrograms()[1], blocks: [frame, lbuf, this.pbuf!, t.block], textures: [this.feat, this.segTex, this.segPieces2.texture!], count: l.n * 6, first: l.first * 6 });
  }
  /** on the ground's tiles: the feature under a place, on the CPU (its box, then its polygons), the last drawn on
   *  top. Drawing the layer's prisms into the picking pass cost every vertex of the layer for each pick: 2.4 M for a
   *  country's regencies, every 50 ms while a pointer moves */
  private pickBoxes: Float64Array | null = null; private pickOf: unknown = null;
  override groundPick(lon: number, lat: number): number | null {
    if (!this.onTiles || this.shown <= 0) return null;
    const es = this.entries;
    if (this.pickOf !== es) {
      const b = new Float64Array(es.length * 4);
      es.forEach((e, i) => { const x = bboxOf(e.geometry ?? null); if (x) b.set(x, i * 4); else b.set([1, 1, -1, -1], i * 4); });
      this.pickBoxes = b; this.pickOf = es;
    }
    const b = this.pickBoxes!;
    for (let i = es.length - 1; i >= 0; i--) {
      if (lon < b[4 * i]! || lat < b[4 * i + 1]! || lon > b[4 * i + 2]! || lat > b[4 * i + 3]!) continue;
      if (!this.isShown(es[i]!.index)) continue;
      if (contains(es[i]!.geometry ?? null, [lon, lat])) return es[i]!.index;
    }
    return null;
  }
  protected freeGeometry(): void { this.upperProgs?.forEach((p) => p.destroy()); this.upperProgs = null; this.upperFor = null; this.triPieces.destroy(); this.segPieces2.destroy(); this.tileProgs?.forEach((p) => p.destroy()); this.tileProgs = null; for (const r of [this.vbuf, this.ibuf, this.sbuf, this.sibuf, this.lbuf2, this.triTex, this.segTex]) r?.destroy(); this.vbuf = this.ibuf = this.sbuf = this.sibuf = this.lbuf2 = null; this.triTex = this.segTex = null; this.scap = 0; this.outlineKey = ''; }
  override readouts() { return { count: () => this.size, triangles: () => (this.draped ? this.nTri : this.nIdx / 3), outline: () => this.segs.count }; }
}
export const area = <D = Feature>(p: AreaProps<D>) => new Area<D>(p);
