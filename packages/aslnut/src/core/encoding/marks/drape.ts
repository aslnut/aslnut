// core › geometry › marks › drape: marks draped on the ground, exactly (see render/graphics/shaders/drape.wgsl.ts): the
// programs, and the data textures their pieces are read from by vertex number (no vertex buffers: an area's triangle
// is 2 texels, a line's segment 5).
import type { FeatureMarkProps } from './features.ts';
import { Prog } from './features.ts';
import type { GTexture, Graphics } from '../../render/graphics/interface.ts';
import { AREA_DRAPE_GLSL } from '../../render/graphics/shaders/area-drape.glsl.ts';
import { AREA_DRAPE_WGSL } from '../../render/graphics/shaders/area-drape.wgsl.ts';
import { LINE_DRAPE_GLSL } from '../../render/graphics/shaders/line-drape.glsl.ts';
import { LINE_DRAPE_WGSL } from '../../render/graphics/shaders/line-drape.wgsl.ts';
import { AREA_TILE_GLSL } from '../../render/graphics/shaders/area-tile.glsl.ts';
import { AREA_TILE_WGSL } from '../../render/graphics/shaders/area-tile.wgsl.ts';
import { LINE_TILE_GLSL } from '../../render/graphics/shaders/line-tile.glsl.ts';
import { LINE_TILE_WGSL } from '../../render/graphics/shaders/line-tile.wgsl.ts';
import { UPPER_WGSL } from '../../render/graphics/shaders/drape.wgsl.ts';
import { AREA_IMAGE_WGSL } from '../../render/graphics/shaders/area.wgsl.ts';
import { AREA_IMAGE_GLSL } from '../../render/graphics/shaders/area.glsl.ts';
import { UPPER_GLSL } from '../../render/graphics/shaders/drape.glsl.ts';
import type { Program } from '../../render/graphics/interface.ts';
import type { Segments } from '../../geometry/build/segments.ts';
import { HOOK_POINTS, assemble, type ParamBlock, type ShaderCode } from '../../render/graphics/shaders/hooks.ts';

// ── where a mark sits with the twin (its `drape`) ──────────────────────────────────────────────────────────────
/** where a mark sits with the twin's terrain, buildings and trees:
 *  - 'ground': on the terrain and the twin's own ground (roads, paths, kerbs): the buildings and trees stand on it
 *  - 'over': painted onto everything under it (the terrain, roofs, walls, tree crowns); on bare terrain the same as 'ground'
 *  - 'above': floating over everything, never hidden (a point behind something shows dimmed) */
export type DrapeMode = 'ground' | 'over' | 'above';
/** the marks that take a `drape` */
export type DrapeMark = 'area' | 'line' | 'raster' | 'point' | 'label' | 'arc';
/** each mark's own place when it says nothing (`drape` unset or true). THE ONE PLACE these defaults live: a filled
 *  area (and a picture) paints over everything, so a choropleth still reads in a dense twin; a line (a road, a route, a
 *  boundary) lies on the ground under the buildings and trees; a point, a label and an arc float over everything */
export const DRAPE_DEFAULTS: Readonly<Record<DrapeMark, DrapeMode>> = { area: 'over', line: 'ground', raster: 'over', point: 'above', label: 'above', arc: 'above' };
/** what 'ground' counts as the twin's ground: what lies within this many metres of the terrain (roads, paths, kerbs;
 *  the Clayton street level's road and path meshes stand 0 to 1.34 m over its terrain, 0.61 at the 90th percentile) */
export const GROUND_WITHIN = 1.5;
/** a point or symbol hidden behind something ('above'): drawn at this share of its opacity (a facility behind a
 *  building is still found, and the dimming says it is behind) */
export const BEHIND = 0.35;
/** a mark's place: its own `drape`, else its mark's default; 'free': drape: false (each vertex at the ground's height
 *  plus `lift`, hidden by what is in front) */
export function drapeOf(own: boolean | DrapeMode | undefined, mark: DrapeMark): DrapeMode | 'free' {
  if (own === false) return 'free';
  if (own === undefined || own === true) return DRAPE_DEFAULTS[mark];
  return own;
}
/** a draped program's part over the twin's solids (the upper variant): the terrain's kept depth read, the prism always
 *  standing (no flat route), only what stands over the terrain painted (see UPPER_WGSL) */
function upperOf(src: { wgsl: string; glsl: { vertex: string; fragment: string } }, upper: boolean): { wgsl: string; glsl: { vertex: string; fragment: string } } {
  const one = (t: string, U: typeof UPPER_WGSL, need: boolean) => {
    if (!upper) return t;
    for (const m of ['upperDecl', 'upperFn', 'upperPrism', 'flat']) if (need && !t.includes(`/*@${m}*/`)) throw new Error(`drape: the upper variant's marker /*@${m}*/ is missing`);
    return t.split('/*@upperDecl*/').join(U.decl).split('/*@upperFn*/').join(U.fn).split('/*@upperPrism*/').join(U.prism).split('/*@flat*/').join(' && false').split('/*@upper*/').join(U.fs);
  };
  return { wgsl: one(src.wgsl, UPPER_WGSL, true), glsl: { vertex: one(src.glsl.vertex, UPPER_GLSL, true), fragment: one(src.glsl.fragment, UPPER_GLSL, true) } };
}

/** an area program's image variant (a picture over its box: an image raster): the picture's texture bound after the
 *  program's own (`n` of them), imageAt(uv) for its colour hook; nothing for an area without one */
export function withImage<T extends { wgsl: string; glsl: { vertex: string; fragment: string } }>(src: T, n: number, image: boolean): T {
  if (!image) return src;
  // the picture's colour where the pixel falls, before your colour hook (the same two statements in WGSL and GLSL)
  const colour = 'color = imageAt(uv);\n  alpha = alpha * color.a;\n  /*@color*/';
  const put = (t: string, code: string) => { if (!t.includes('/*@functions*/')) throw new Error('an image variant needs the /*@functions*/ marker'); return t.split('/*@functions*/').join(`${code}/*@functions*/`).split('/*@color*/').join(colour); };
  return { ...src, wgsl: put(src.wgsl, AREA_IMAGE_WGSL(n)), glsl: { vertex: put(src.glsl.vertex, AREA_IMAGE_GLSL), fragment: put(src.glsl.fragment, AREA_IMAGE_GLSL) } };
}
/** the picture's texture in a program's list (filtered: a picture shown larger than its pixels is smooth) */
export const IMAGE_TEXTURE = { name: 'img', kind: '2d' as const, sample: 'float' as const };

/** texels per row of the pieces' data textures */
export const GW = 2048;
const TEXTURES = [{ name: 'feat', kind: '2d' as const, sample: 'unfilterable' as const }, { name: 'geo', kind: '2d' as const, sample: 'unfilterable' as const }];
// The prisms' back faces are drawn only where they lie behind the ground already drawn (depth test greater-equal, no
// write): a pixel whose ground is beyond the prism never runs the program (a phone's chip fills far fewer pixels).
// Flat (one face per piece on the ground itself): no depth test, the program alone decides.
const depthOf = (flat: boolean) => ({ write: false, test: flat ? 'always' as const : 'greater-equal' as const });
/** the program of an area draped on the ground: a prism per triangle, its back faces, the ground read per pixel;
 *  `upper`: its part over the twin's solids (drawn after them; see UPPER_WGSL) */
export const areaDrapeProgram = (g: Graphics, label: string, code: ShaderCode, params: ParamBlock, blend: FeatureMarkProps<unknown>['blend'] = 'alpha', flat = false, upper = false, image = false) => {
  const src = upperOf(assemble(withImage({ wgsl: AREA_DRAPE_WGSL, glsl: AREA_DRAPE_GLSL }, TEXTURES.length, image), { color: HOOK_POINTS.area.color, alpha: HOOK_POINTS.area.alpha, reveal: HOOK_POINTS.area.reveal }, (({ position: _p, ...rest }) => rest)(code), params, `layer '${label}'`), upper);
  return new Prog(g, { label: `area ${label} (draped${flat ? ', flat' : ''}${upper ? ', over the solids' : ''})`, wgsl: src.wgsl, glsl: src.glsl, blocks: ['Frame', 'L', 'Params'], textures: image ? [...TEXTURES, IMAGE_TEXTURE] : TEXTURES, sceneDepth: true, groundDepth: upper, cull: 'front', blend: blend ?? 'alpha', depth: depthOf(flat && !upper) });
};
/** the program of a line draped on the ground: a box per segment, as wide as the line where it lies; `upper`: its
 *  part over the twin's solids */
export const lineDrapeProgram = (g: Graphics, label: string, code: ShaderCode, params: ParamBlock, blend: FeatureMarkProps<unknown>['blend'] = 'alpha', flat = false, upper = false) => {
  const src = upperOf(assemble({ wgsl: LINE_DRAPE_WGSL, glsl: LINE_DRAPE_GLSL }, HOOK_POINTS.line, code, params, `layer '${label}'`), upper);
  return new Prog(g, { label: `line ${label} (draped${flat ? ', flat' : ''}${upper ? ', over the solids' : ''})`, wgsl: src.wgsl, glsl: src.glsl, blocks: ['Frame', 'L', 'Params'], textures: TEXTURES, sceneDepth: true, groundDepth: upper, cull: 'front', blend: blend ?? 'alpha', depth: depthOf(flat && !upper) });
};
// ── the same marks drawn into the ground's tiles (one pass for the frame, nothing read back: see tile.wgsl.ts) ─────
const TILE_TEXTURES = [...TEXTURES, { name: 'ids', kind: '2d' as const, sample: 'unfilterable' as const }];
const tileDesc = (label: string, src: { wgsl: string; glsl: { vertex: string; fragment: string } }, image = false) => ({ label, wgsl: src.wgsl, glsl: src.glsl, blocks: ['Frame', 'L', 'Params', 'T'], textures: image ? [...TILE_TEXTURES, IMAGE_TEXTURE] : TILE_TEXTURES, cull: 'none' as const, blend: 'alpha' as const, depth: { write: false, test: 'always' as const }, overlay: true });
/** the program of an area drawn into a ground tile */
export const areaTileProgram = (g: Graphics, label: string, code: ShaderCode, params: ParamBlock, image = false): Program => {
  const src = assemble(withImage({ wgsl: AREA_TILE_WGSL, glsl: AREA_TILE_GLSL }, TILE_TEXTURES.length, image), { color: HOOK_POINTS.area.color, alpha: HOOK_POINTS.area.alpha, reveal: HOOK_POINTS.area.reveal }, (({ position: _p, ...rest }) => rest)(code), params, `layer '${label}'`);
  return g.program(tileDesc(`area ${label} (tiles)`, src, image));
};
/** the program of a line (or an area's outline) drawn into a ground tile */
export const lineTileProgram = (g: Graphics, label: string, code: ShaderCode, params: ParamBlock): Program => {
  const src = assemble({ wgsl: LINE_TILE_WGSL, glsl: LINE_TILE_GLSL }, HOOK_POINTS.line, code, params, `layer '${label}'`);
  return g.program(tileDesc(`line ${label} (tiles)`, src));
};
/** the pieces under each tile: found through a grid over the layer's pieces, their numbers kept in one texture per
 *  layer (a tile's list is written once, then drawn from its first vertex on), all of it again when the pieces change */
export class TilePieces {
  private tex: GTexture | null = null; private pool = new Float32Array(GW * 4); private used = 0; private of: unknown = null;
  private boxes = new Float64Array(0); private lists = new Map<number, { first: number; n: number }>();
  // the grid: G × G cells over the pieces' extent, each cell's pieces in `cellIds` from `cellAt[c]`
  private G = 1; private ext = [0, 0, 1, 1]; private cellAt = new Int32Array(2); private cellIds = new Int32Array(0); private stamp = new Uint32Array(0); private mark = 0;
  /** the pieces' boxes (w, s, e, n degrees each) and their grid, made again when `of` changes */
  prepare(of: unknown, count: number, box: (i: number, b: Float64Array) => void): void {
    if (this.of === of && this.boxes.length === count * 4) return;
    const out = new Float64Array(count * 4), b = new Float64Array(4);
    let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
    for (let i = 0; i < count; i++) {
      box(i, b); out[4 * i] = b[0]!; out[4 * i + 1] = b[1]!; out[4 * i + 2] = b[2]!; out[4 * i + 3] = b[3]!;
      if (b[0]! < w) w = b[0]!; if (b[1]! < s) s = b[1]!; if (b[2]! > e) e = b[2]!; if (b[3]! > n) n = b[3]!;
    }
    this.of = of; this.boxes = out; this.lists.clear(); this.used = 0;
    const G = (this.G = Math.max(1, Math.min(256, Math.round(Math.sqrt(count / 4)))));
    this.ext = [w, s, Math.max(e - w, 1e-9), Math.max(n - s, 1e-9)];
    const at = new Int32Array(G * G + 1);
    const cells = (i: number, f: (c: number) => void) => {
      const x0 = this.cx(out[4 * i]!), x1 = this.cx(out[4 * i + 2]!), y0 = this.cy(out[4 * i + 1]!), y1 = this.cy(out[4 * i + 3]!);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) f(y * G + x);
    };
    for (let i = 0; i < count; i++) cells(i, (c) => { at[c + 1]!++; });
    for (let c = 0; c < G * G; c++) at[c + 1]! += at[c]!;
    const ids = new Int32Array(at[G * G]!), fill = at.slice(0, G * G);
    for (let i = 0; i < count; i++) cells(i, (c) => { ids[fill[c]!++] = i; });
    this.cellAt = at; this.cellIds = ids; this.stamp = new Uint32Array(count); this.mark = 0;
  }
  private cx(lon: number): number { return Math.max(0, Math.min(this.G - 1, Math.floor(((lon - this.ext[0]!) / this.ext[2]!) * this.G))); }
  private cy(lat: number): number { return Math.max(0, Math.min(this.G - 1, Math.floor(((lat - this.ext[1]!) / this.ext[3]!) * this.G))); }
  /** the pieces whose boxes meet the tile's box (grown by `margin` of its size): where their list starts in the
   *  texture and how many (written on first need) */
  select(g: Graphics, key: number, t: readonly [number, number, number, number], margin = 0): { first: number; n: number } {
    const had = this.lists.get(key); if (had) return had;
    const mx = (t[2] - t[0]) * margin, my = (t[3] - t[1]) * margin, w = t[0] - mx, s = t[1] - my, e = t[2] + mx, n = t[3] + my;
    const boxes = this.boxes, ids = this.cellIds, at = this.cellAt, st = this.stamp, G = this.G;
    if (++this.mark === 0xffffffff) { st.fill(0); this.mark = 1; }
    const m = this.mark;
    // the pool: grown (or begun again, lists forgotten, when it has become large)
    if (this.used > 1 << 22) { this.lists.clear(); this.used = 0; }
    const first = this.used;
    if (e >= this.ext[0]! && w <= this.ext[0]! + this.ext[2]! && n >= this.ext[1]! && s <= this.ext[1]! + this.ext[3]!) {
      const x0 = this.cx(w), x1 = this.cx(e), y0 = this.cy(s), y1 = this.cy(n);
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
        const c = y * G + x;
        for (let k = at[c]!; k < at[c + 1]!; k++) {
          const i = ids[k]!; if (st[i] === m) continue; st[i] = m;
          const q = 4 * i;
          if (boxes[q]! > e || boxes[q + 2]! < w || boxes[q + 1]! > n || boxes[q + 3]! < s) continue;
          if (this.used === this.pool.length) { const bigger = new Float32Array(this.pool.length * 2); bigger.set(this.pool); this.pool = bigger; }
          this.pool[this.used++] = i;
        }
      }
    }
    const list = { first, n: this.used - first };
    this.lists.set(key, list);
    if (list.n) {
      // the rows the new list touches, written whole (the pool holds what was there before them)
      const r0 = Math.floor(first / GW), r1 = Math.ceil(this.used / GW), rows = Math.ceil(this.used / GW);
      if (!this.tex || this.tex.desc.height < rows) {
        this.tex?.destroy();
        this.tex = g.texture({ label: 'tile pieces', width: GW, height: Math.max(rows, Math.ceil((this.tex?.desc.height ?? 0) * 1.5), 4), format: 'r32f', filter: 'nearest' });
        if (this.pool.length < this.tex.desc.height * GW) { const bigger = new Float32Array(this.tex.desc.height * GW); bigger.set(this.pool); this.pool = bigger; }
        this.tex.write(this.pool.subarray(0, rows * GW), { width: GW, height: rows });
      } else {
        if (this.pool.length < r1 * GW) { const bigger = new Float32Array(r1 * GW); bigger.set(this.pool); this.pool = bigger; }
        this.tex.write(this.pool.subarray(r0 * GW, r1 * GW), { y: r0, width: GW, height: r1 - r0 });
      }
    }
    return list;
  }
  get texture(): GTexture | null { return this.tex; }
  destroy(): void { this.tex?.destroy(); this.tex = null; this.lists.clear(); this.used = 0; this.of = null; }
}
/** pieces into a data texture, `texels` per piece (rgba32f, 2048 wide); the old one is reused when big enough. Data
 *  padded to whole rows (as the builders make it) is written as it is (no copy) */
export function pieceTexture(g: Graphics, old: GTexture | null, data: Float32Array, label: string): GTexture {
  const texels = Math.max(1, data.length / 4), rows = Math.max(1, Math.ceil(texels / GW));
  let t = old;
  if (!t || t.desc.height < rows) { t?.destroy(); t = g.texture({ label, width: GW, height: Math.max(rows, Math.ceil((t?.desc.height ?? 0) * 1.25)), format: 'rgba32f', filter: 'nearest' }); }
  let full = data;
  if (data.length !== rows * GW * 4) { full = new Float32Array(rows * GW * 4); full.set(data); }
  t.write(full, { width: GW, height: rows });
  return t;
}
/** the pieces' ground ranges measured a slice per frame (a mark of thousands of pieces never makes a long frame);
 *  done: the texture is written once */
export class RangeJob {
  // Three steps, each a slice per frame: the pieces' boxes (and their extent) → the ground's range in each cell of a
  // grid over that extent (one question per cell, not per piece: a layer of 70 000 triangles asks a few thousand)
  // → each piece the widest range of the cells its box touches. A piece's prism is a little taller than its own
  // range would make it, never shorter; the pixels drawn are the same (the drape is exact either way)
  private i = -1; private phase = 0; private again = false; private b = new Float64Array(4);
  private boxes = new Float64Array(0); private ext = [0, 0, 1, 1]; private G = 1; private cells = new Float32Array(0);
  // a run starts at most once a second (the ground sharpens tile by tile while a view loads: each new run ends in a
  // texture written again, megabytes for a big layer)
  private want = false; private ended = -1e9; private timer: ReturnType<typeof setTimeout> | 0 = 0;
  /** the pieces' ranges are stale (a run under way, or one waiting for its turn): the layer's own range meanwhile */
  get busy(): boolean { return this.i >= 0 || this.want; }
  /** a run is under way or may start now: it needs frames (a slice in each). Waiting for its turn it needs none: `wake`
   *  is called when its turn comes (its layer asks for one frame then) */
  get running(): boolean { return this.i >= 0 || (this.want && performance.now() - this.ended > 1000); }
  wake: (() => void) | null;
  /** `wake`: called when a run waiting for its turn may start (its layer asks the world for a frame) */
  constructor(wake: (() => void) | null = null) { this.wake = wake; }
  private later(): void {
    if (this.timer || !this.want || performance.now() - this.ended > 1000) return;
    this.timer = setTimeout(() => { this.timer = 0; this.wake?.(); }, 1005 - (performance.now() - this.ended));
    (this.timer as unknown as { unref?: () => void }).unref?.();
  }
  /** measure again (a run under way finishes first, then one more: the ground keeps sharpening while it runs) */
  start(): void { if (this.i >= 0) this.again = true; else { this.want = true; this.later(); } }
  /** within `budget` ms; true when the last piece was measured in this call */
  step(rangeIn: RangeIn, count: number, box: (i: number, b: Float64Array) => void, out: Float32Array, stride: number, at: number, fallback: readonly [number, number], budget = 1): boolean {
    if (this.i < 0 && this.want && performance.now() - this.ended > 1000) { this.want = false; this.i = 0; this.phase = 0; }
    if (this.i < 0) return false;
    const t0 = performance.now(), b = this.b;
    if (this.phase === 0) {
      if (this.boxes.length < count * 4) this.boxes = new Float64Array(count * 4);
      if (this.i === 0) this.ext = [Infinity, Infinity, -Infinity, -Infinity];
      const B = this.boxes, E = this.ext;
      while (this.i < count) {
        box(this.i, b); const q = 4 * this.i;
        B[q] = b[0]!; B[q + 1] = b[1]!; B[q + 2] = b[2]!; B[q + 3] = b[3]!;
        if (b[0]! < E[0]!) E[0] = b[0]!; if (b[1]! < E[1]!) E[1] = b[1]!; if (b[2]! > E[2]!) E[2] = b[2]!; if (b[3]! > E[3]!) E[3] = b[3]!;
        this.i++;
        if ((this.i & 1023) === 0 && performance.now() - t0 > budget) return false;
      }
      this.G = Math.max(1, Math.min(64, Math.round(Math.sqrt(count / 6))));
      this.cells = new Float32Array(this.G * this.G * 2); this.phase = 1; this.i = 0;
    }
    const G = this.G, E = this.ext, cw = Math.max(1e-9, (E[2]! - E[0]!) / G), ch = Math.max(1e-9, (E[3]! - E[1]!) / G);
    if (this.phase === 1) {
      while (this.i < G * G) {
        const cx = this.i % G, cy = (this.i / G) | 0;
        const r = rangeIn?.(E[0]! + cx * cw, E[1]! + cy * ch, E[0]! + (cx + 1) * cw, E[1]! + (cy + 1) * ch);
        this.cells[2 * this.i] = r ? r[0] : NaN; this.cells[2 * this.i + 1] = r ? r[1] : NaN;
        this.i++;
        if ((this.i & 15) === 0 && performance.now() - t0 > budget) return false;
      }
      this.phase = 2; this.i = 0;
    }
    const B = this.boxes, C = this.cells, cxOf = (lon: number) => Math.max(0, Math.min(G - 1, Math.floor((lon - E[0]!) / cw))), cyOf = (lat: number) => Math.max(0, Math.min(G - 1, Math.floor((lat - E[1]!) / ch)));
    while (this.i < count) {
      const q = 4 * this.i, x0 = cxOf(B[q]!), x1 = cxOf(B[q + 2]!), y0 = cyOf(B[q + 1]!), y1 = cyOf(B[q + 3]!);
      let lo = Infinity, hi = -Infinity;
      for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const c = 2 * (y * G + x), a = C[c]!, z = C[c + 1]!; if (a === a) { if (a < lo) lo = a; if (z > hi) hi = z; } }
      const o = this.i * stride + at;
      if (lo === Infinity) { out[o] = fallback[0]; out[o + 1] = fallback[1]; } else { out[o] = lo - 20; out[o + 1] = hi + Math.max(60, 0.15 * (hi - lo)); }
      this.i++;
      if ((this.i & 1023) === 0 && performance.now() - t0 > budget) return false;
    }
    this.i = -1; this.ended = performance.now();
    if (this.again) { this.again = false; this.want = true; this.later(); }
    return true;
  }
}
/** the ground's range under each piece (true m, with margins), into its record at `at` (stride floats apart): a
 *  prism stands only as tall as the ground under its own piece. `box(i)` gives piece i's box (w, s, e, n) into b;
 *  without the surface's ranges, the layer's own */
export type RangeIn = ((w: number, s: number, e: number, n: number) => [number, number] | null) | undefined;
export function pieceRanges(rangeIn: RangeIn, count: number, box: (i: number, b: Float64Array) => void, out: Float32Array, stride: number, at: number, fallback: readonly [number, number]): void {
  const b = new Float64Array(4);
  for (let i = 0; i < count; i++) {
    box(i, b);
    const r = rangeIn?.(b[0]!, b[1]!, b[2]!, b[3]!);
    const o = i * stride + at;
    if (!r) { out[o] = fallback[0]; out[o + 1] = fallback[1]; continue; }
    out[o] = r[0] - 20; out[o + 1] = r[1] + Math.max(60, 0.15 * (r[1] - r[0]));
  }
}
/** every piece's range the layer's own (before each piece's own is measured) */
export function fillRanges(out: Float32Array, count: number, stride: number, at: number, r: readonly [number, number]): void {
  for (let i = 0; i < count; i++) { out[i * stride + at] = r[0]; out[i * stride + at + 1] = r[1]; }
}
/** the box of segment i (its two points) */
export const segmentBox = (segs: Segments) => (i: number, b: Float64Array) => segs.box(i, b);
