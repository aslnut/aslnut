// core › geometry › build › segments: lines as the line mark draws them: one record per segment with the points
// before and after (for the joins), the fraction along its line (for trace reveals and dashes), the feature, and the
// ground height under each point (read again when the terrain sharpens). Two forms, each built only for the route
// that draws it:
//   'records'  drawn over the ground (not draped, arcs): four vertex records of 20 floats per segment, their triangles,
//              and what fills them again when the heights change (the points, the segments' ends and neighbours)
//   'pieces'   draped (the ground's own shape under it): five texels per segment, written straight into an array
//              padded to whole texture rows: nothing else is kept but the points' places (for their boxes)
// Built in two passes: the lines are read once (places, lengths, how many pieces each segment is split into), then the
// arrays are made at their size and filled; no array per point, no growing lists.
import type { Position } from '../../data/features.ts';
import { relMetres, unwrapNear, type Origin } from './mesh.ts';

export const SEG = 20;   // floats per vertex: a, b, before, after (4 each), x (feature, line length m, end, side)
/** floats per draped piece: a, b (x, y, 0, along) · before, after (x, y, 0, 1 when there is one) · x (feature, line
 *  length m, the ground's range under it) */
export const PIECE = 20;
/** four vertices per segment (end 0 / 1 × side -1 / 1), two triangles: (0, 1, 2) (2, 1, 3) */
const CORNERS = [[0, -1], [0, 1], [1, -1], [1, 1]] as const;

export interface SegmentLine { f: number; line: Position[]; closed: boolean; cuts?: ArrayLike<number>; reverse?: boolean; along?: (at: number) => number }
export interface SegmentsForm { form?: 'records' | 'pieces'; /** pieces: floats per texture row (the array is padded to whole rows) */ row?: number }

/** pass 1's scratch: the input points (unwrapped x, y), each input segment's metres and pieces, each line's points
 *  and metres; the totals */
interface Read { P: Float64Array; Lm: Float64Array; K: Int32Array; n: Int32Array; len: Float64Array; pts: number; segs: number }
/** pass 2's arrays and where it is in them */
interface Fill { o: Origin; records: boolean; q: number; sq: number; ll: Float64Array; xy: Float32Array; fr: Float32Array; seg: Int32Array; lens: Float32Array; first: Int32Array; pieces: Float32Array }
/** one line read into the scratch from input point `at`: the input points it keeps */
function readLine(o: Origin, L: SegmentLine, step: number, r: Read, at: number, l: number): number {
  const line = L.line, P = r.P;
  let n = line.length;
  if (L.closed && n > 1 && line[0]![0] === line[n - 1]![0] && line[0]![1] === line[n - 1]![1]) n--;
  if (n < 2) { r.n[l] = 0; return 0; }
  r.n[l] = n;
  for (let i = 0; i < n; i++) { const p = line[i]!, j = 2 * (at + i); let x = o.x(p[0]); if (i) x = unwrapNear(x, P[j - 2]!); P[j] = x; P[j + 1] = o.y(p[1]); }
  const segs = L.closed ? n : n - 1, cuts = L.cuts;
  let pts = 1, d = 0, drawn = 0;
  for (let s = 0; s < segs; s++) {
    const a = 2 * (at + s), b = 2 * (at + (s + 1 === n ? 0 : s + 1)), m = relMetres(o, P[a]!, P[a + 1]!, P[b]!, P[b + 1]!);
    const k = Math.max(1, Math.min(256, Math.ceil(m / step)));
    r.Lm[at + s] = m; r.K[at + s] = k; pts += k; d += m;
    if (!(cuts && cuts[s])) drawn += k;
  }
  r.len[l] = d; r.pts += pts; r.segs += drawn;
  return n;
}
/** one line's points and segments written (its input points from `at` in the scratch) */
function fillLine(L: SegmentLine, n: number, length: number, r: Read, at: number, w: Fill): void {
  const o = w.o, xy = w.xy, ll = w.ll, fr = w.fr, P = r.P, Lm = r.Lm, K = r.K, line = L.line, along = L.along, rev = L.reverse;
  const segs = L.closed ? n : n - 1, base = w.q;
  let q = base;
  // its points: the input points where they were given, the points between on the straight piece (Mercator); how far
  // along each is: by distance (trace, dashes), or your measure per input point (a trail's time)
  xy[2 * q] = P[2 * at]!; xy[2 * q + 1] = P[2 * at + 1]!; ll[2 * q] = line[0]![0]; ll[2 * q + 1] = line[0]![1];
  { const t = along ? along(0) : 0; fr[q] = rev ? 1 - t : t; }
  q++;
  let d = 0;
  for (let s = 0; s < segs; s++) {
    const j1 = s + 1 === n ? 0 : s + 1, a = 2 * (at + s), b = 2 * (at + j1), k = K[at + s]!, m = Lm[at + s]!;
    const ax = P[a]!, ay = P[a + 1]!, bx = P[b]!, by = P[b + 1]!;
    for (let j = 1; j <= k; j++) {
      const t = j / k, x = ax + (bx - ax) * t, y = ay + (by - ay) * t;
      xy[2 * q] = x; xy[2 * q + 1] = y;
      if (j < k) { ll[2 * q] = o.lonOf(x); ll[2 * q + 1] = o.latOf(y); } else { const p = line[j1]!; ll[2 * q] = p[0]; ll[2 * q + 1] = p[1]; }
      const f = along ? along(s + t) : length > 0 ? (d + m * t) / length : 0; fr[q] = rev ? 1 - f : f;
      q++;
    }
    d += m;
  }
  w.q = q;
  // its segments: point k to k + 1, the cut ones left out
  const pn = q - base, cuts = L.cuts, closed = L.closed, fi = L.f, records = w.records, seg = w.seg, lens = w.lens, first = w.first, pieces = w.pieces;
  let sq = w.sq;
  for (let s = 0, k0 = 0; s < segs; s++) {
    const k = K[at + s]!;
    if (!(cuts && cuts[s])) for (let j = 0; j < k; j++) {
      const kk = k0 + j, a = base + kk;
      const prev = kk > 0 ? a - 1 : closed ? base + pn - 2 : -1;
      const next = kk + 2 < pn ? a + 2 : closed ? base + 1 : -1;
      if (records) { const i5 = sq * 5; seg[i5] = a; seg[i5 + 1] = a + 1; seg[i5 + 2] = prev; seg[i5 + 3] = next; seg[i5 + 4] = fi; lens[sq] = length; }
      else {
        first[sq] = a;
        const o2 = sq * PIECE;
        pieces[o2] = xy[2 * a]!; pieces[o2 + 1] = xy[2 * a + 1]!; pieces[o2 + 3] = fr[a]!;
        pieces[o2 + 4] = xy[2 * a + 2]!; pieces[o2 + 5] = xy[2 * a + 3]!; pieces[o2 + 7] = fr[a + 1]!;
        if (prev >= 0) { pieces[o2 + 8] = xy[2 * prev]!; pieces[o2 + 9] = xy[2 * prev + 1]!; pieces[o2 + 11] = 1; }
        if (next >= 0) { pieces[o2 + 12] = xy[2 * next]!; pieces[o2 + 13] = xy[2 * next + 1]!; pieces[o2 + 15] = 1; }
        pieces[o2 + 16] = fi; pieces[o2 + 17] = length;
      }
      sq++;
    }
    k0 += k;
  }
  w.sq = sq;
}

/** a build of segments spread over frames: the lines read (pass 1), then the arrays made at their size and filled
 *  (pass 2), a slice at a time; `run(ms)` goes on for about that long and is true when the segments are done (a
 *  layer of thousands of lines never makes a long frame) */
export class SegmentsJob {
  private r: Read; private w: Fill | null = null; private l = 0; private at = 0; private done = false;
  private readonly segs: Segments; private readonly o: Origin; private readonly lines: readonly SegmentLine[]; private readonly step: number; private readonly opts: SegmentsForm;
  constructor(segs: Segments, o: Origin, lines: readonly SegmentLine[], step: number, opts: SegmentsForm = {}) {
    this.segs = segs; this.o = o; this.lines = lines; this.step = step; this.opts = opts;
    let inPts = 0; for (const L of lines) inPts += L.line.length;
    this.r = { P: new Float64Array(inPts * 2), Lm: new Float64Array(inPts), K: new Int32Array(inPts), n: new Int32Array(lines.length), len: new Float64Array(lines.length), pts: 0, segs: 0 };
  }
  /** about `budget` ms of it (all of it by default); true when done */
  run(budget = Infinity): boolean {
    if (this.done) return true;
    const t0 = budget === Infinity ? 0 : performance.now(), lines = this.lines, r = this.r, N = lines.length;
    const over = () => budget !== Infinity && performance.now() - t0 > budget;
    // ── pass 1: every line read once into scratch (unwrapped places, segment metres, pieces per segment) ──────────
    if (!this.w) {
      while (this.l < N) { this.at += readLine(this.o, lines[this.l]!, this.step, r, this.at, this.l); this.l++; if ((this.l & 127) === 0 && over()) return false; }
      // ── pass 2: the arrays at their size ─────────────────────────────────────────────────────────────────────
      const records = (this.opts.form ?? 'records') === 'records', outPts = r.pts, outSegs = r.segs, row = Math.max(4, this.opts.row ?? 4);
      this.w = {
        o: this.o, records, q: 0, sq: 0, ll: new Float64Array(outPts * 2), xy: new Float32Array(outPts * 2), fr: new Float32Array(outPts),
        seg: records ? new Int32Array(outSegs * 5) : new Int32Array(0), lens: records ? new Float32Array(outSegs) : new Float32Array(0),
        first: records ? new Int32Array(0) : new Int32Array(outSegs), pieces: records ? new Float32Array(0) : new Float32Array(Math.max(1, Math.ceil((outSegs * PIECE) / row)) * row),
      };
      this.l = 0; this.at = 0;
      if (over()) return false;
    }
    // ── … filled ──────────────────────────────────────────────────────────────────────────────────────────────────
    const w = this.w;
    while (this.l < N) { const n = r.n[this.l]!; if (n) { fillLine(lines[this.l]!, n, r.len[this.l]!, r, this.at, w); this.at += n; } this.l++; if ((this.l & 127) === 0 && over()) return false; }
    this.segs.finish(w, r.pts);
    this.done = true;
    return true;
  }
}

export class Segments {
  /** lon / lat per point (float64): the segments' boxes, the ground under them */
  lonlat: Float64Array = new Float64Array(0);
  /** records: rel x / y per point, fraction along per point, the ground under each point */
  xy: Float32Array = new Float32Array(0); frac: Float32Array = new Float32Array(0); h: Float32Array = new Float32Array(0);
  /** records: per segment point a, point b, before (-1: none), after (-1: none), feature; its line's length */
  seg: Int32Array = new Int32Array(0); len: Float32Array = new Float32Array(0);
  data: Float32Array = new Float32Array(0);
  index: Uint32Array = new Uint32Array(0);
  /** pieces: per segment its first point (the second is the next); the pieces (rows padded) */
  first: Int32Array = new Int32Array(0); pieces: Float32Array = new Float32Array(0);
  form: 'records' | 'pieces' = 'records';
  count = 0;

  /** lines (each with its feature index, closed or not, its cuts) → segments, at once */
  build(o: Origin, lines: readonly SegmentLine[], step: number, opts: SegmentsForm = {}): this { new SegmentsJob(this, o, lines, step, opts).run(); return this; }
  /** the arrays pass 2 filled, made this one's */
  finish(w: Fill, outPts: number): void {
    const records = w.records;
    this.form = records ? 'records' : 'pieces';
    this.count = w.sq; this.lonlat = w.ll; this.seg = w.seg; this.len = w.lens; this.first = w.first; this.pieces = w.pieces;
    if (records) {
      this.xy = w.xy; this.frac = w.fr; this.h = new Float32Array(outPts);
      this.data = new Float32Array(this.count * SEG * 4);
      this.index = new Uint32Array(this.count * 6);
      for (let i = 0; i < this.count; i++) { const v = i * 4, o6 = i * 6, x = this.index; x[o6] = v; x[o6 + 1] = v + 1; x[o6 + 2] = v + 2; x[o6 + 3] = v + 2; x[o6 + 4] = v + 1; x[o6 + 5] = v + 3; }
      this.fill();
    } else {
      // the pieces hold the places and fractions: nothing else per point but lon / lat
      this.xy = new Float32Array(0); this.frac = new Float32Array(0); this.h = new Float32Array(0); this.data = new Float32Array(0); this.index = new Uint32Array(0);
    }
  }
  /** the box of segment i (its two points: w, s, e, n) into b */
  box(i: number, b: Float64Array): void {
    const a = this.form === 'records' ? this.seg[i * 5]! : this.first[i]!, ll = this.lonlat;
    const x0 = ll[2 * a]!, y0 = ll[2 * a + 1]!, x1 = ll[2 * a + 2]!, y1 = ll[2 * a + 3]!;
    b[0] = Math.min(x0, x1); b[1] = Math.min(y0, y1); b[2] = Math.max(x0, x1); b[3] = Math.max(y0, y1);
  }
  /** records: the ground under every point (true metres), then the records again */
  ground(at: (lon: number, lat: number) => number): void {
    for (let i = 0; i < this.h.length; i++) this.h[i] = at(this.lonlat[2 * i]!, this.lonlat[2 * i + 1]!);
    this.fill();
  }
  /** records: heights from your function per point (arcs) */
  heights(f: (i: number) => number): void { for (let i = 0; i < this.h.length; i++) this.h[i] = f(i); this.fill(); }
  fill(): void {
    if (this.form !== 'records') return;
    const d = this.data, s = this.seg, xy = this.xy, h = this.h, fr = this.frac;
    const put = (o: number, p: number, w: number) => { if (p < 0) { d[o] = 0; d[o + 1] = 0; d[o + 2] = 0; d[o + 3] = 0; return; } d[o] = xy[2 * p]!; d[o + 1] = xy[2 * p + 1]!; d[o + 2] = h[p]!; d[o + 3] = w < 0 ? fr[p]! : w; };
    for (let i = 0; i < this.count; i++) {
      const o = i * SEG * 4, q = i * 5;
      put(o, s[q]!, -1); put(o + 4, s[q + 1]!, -1); put(o + 8, s[q + 2]!, 1); put(o + 12, s[q + 3]!, 1);
      d[o + 16] = s[q + 4]!; d[o + 17] = this.len[i]!;
      // the other three corners: the same segment, another end / side
      for (let k = 0; k < 4; k++) { const c = o + k * SEG; if (k) d.copyWithin(c, o, o + 18); d[c + 18] = CORNERS[k]![0]; d[c + 19] = CORNERS[k]![1]; }
    }
  }
}
