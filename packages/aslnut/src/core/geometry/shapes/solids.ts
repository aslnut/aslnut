// core › geometry › shapes › solids: solids made by code, drawn in square chunks of 500 m (a city's streets, buildings
// and trees, a tile at a time). Each chunk is a mesh (MeshBuilder) and sets of instances (one shape, many places: a
// form's sets in every chunk drawn together, one draw a level); it stands on the ground of its square (a 10 m height
// grid read from the world's terrain, read again when the terrain sharpens); lit by the sun with its shadows (it casts
// them too); every vertex carries an id, so picking finds the very thing under the pointer and asks the chunk what it
// is (fields, source); the hovered one lights up; a new chunk dissolves in over a quarter of a second (no blending: its
// depth stays exact).
//   const s = solids({ id: 'city', hover: { color: '#ffd166' }, tooltip: (d) => d.props.name })
//   s.put('3_4', { origin: [145.09, -37.9], at: [1500, 2000], mesh: mb.build(), instances: [{ shape: crown, data }], info: (id) => … })
//   s.drop('3_4')
import { AslnutError } from '../../world/errors.ts';
import { Element, type AttachContext, type FormVisual, type FrameContext, type ElementProps, type ElementStatus, type Picked, type ThingPlace } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import { inLevels, type LevelSpec } from '../../observation/levels.ts';
import type { DrawCall, GBuffer, GTexture, Graphics, Program } from '../../render/graphics/interface.ts';
import { SOLID_GLSL } from '../../render/graphics/shaders/solid.glsl.ts';
import { SOLID_WGSL } from '../../render/graphics/shaders/solid.wgsl.ts';
import { SOLID_INST_GLSL } from '../../render/graphics/shaders/solid-inst.glsl.ts';
import { EMIT_GLSL } from '../../render/graphics/shaders/emit.glsl.ts';
import { EMIT_WGSL } from '../../render/graphics/shaders/emit.wgsl.ts';
import { SOLID_INST_WGSL } from '../../render/graphics/shaders/solid-inst.wgsl.ts';
import { rgba, type Color } from '../../render/style/color.ts';
import { D, mercY, R } from '../../space/geo.ts';
import { INSTANCE_FLOATS, MESH_FLOATS, SHAPE_FLOATS } from './mesh.ts';
import { inView } from '../../render/look/light.ts';
import { IMPOSTOR_GLSL } from '../../render/graphics/shaders/impostor.glsl.ts';
import { IMPOSTOR_WGSL } from '../../render/graphics/shaders/impostor.wgsl.ts';
import { bakeImpostor, isImpostor, type BakedImpostor, type ImpostorLevel } from './levels.ts';
import { MATERIAL_CODES, customOf, meshCode, shapeCode, splitParts, type CustomMaterial } from '../../render/look/materials.ts';
import { text as textMark } from '../../encoding/marks/text.ts';
import { tileBBox, tileOf } from '../../space/geo.ts';
import type { RasterSource } from '../../data/sources/raster.ts';
import type { Feature } from '../../data/features.ts';
import { assembleMaterial, paramBlock, type ParamBlock } from '../../render/graphics/shaders/hooks.ts';
import { rangeUnits, type SizeRange, type SizeUnits } from '../../render/drawing/size.ts';
import type { Emitter } from './parts.ts';
import { translateStatements } from '../../render/graphics/shaders/translate.ts';

/** what a chunk's id is: picking answers with it */
export interface SolidInfo { kind: string; id: string | number; props: Record<string, unknown> }
export interface SolidsChunk {
  /** the origin [lon, lat] of the chunk's metric frame, and the chunk's corner in it (metres east, south) */
  origin: [number, number]; at: [number, number];
  /** the mesh: MESH_FLOATS numbers per vertex (MeshBuilder.build()); or a function that builds it, called when the
   *  chunk comes near (within the far distance) and let go when it is far again: only the near chunks hold their
   *  whole mesh (the far one draws farther) */
  mesh?: Float32Array | (() => Float32Array | Promise<Float32Array>);
  /** a lighter mesh for far away and for the sun's shadow map (no windows, no small things); the mesh when absent */
  far?: Float32Array;
  /** shapes repeated: the shape (shapeOf), or its levels of detail [near, middle, far] (null: not drawn that far),
   *  and INSTANCE_FLOATS numbers per instance */
  instances?: SolidsSet[];
  /** what id N of the chunk is (picking, tooltips) */
  info?: (id: number) => SolidInfo | null;
  /** heights are given as they are (sea level 0): the chunk does not stand on its ground (things that move, placed
   *  each frame) */
  free?: boolean;
  /** its square's side, m (default 500; at most 500: its ground grid covers that) */
  side?: number;
  /** false: shown at once, not dissolved in (a live source's rows that come and go; default true for a new chunk) */
  fade?: boolean;
}
/** an instance set of a chunk: one shape (or its levels), each clone only its record (core › geometry › shapes ›
 *  instances): INSTANCE_FLOATS numbers each (`data`), or records of `stride` texels (`records`: RECORD_FLOATS a texel;
 *  the first three as RECORD says, then its groups' colours when `groups`, then its joints' rates) */
export interface SolidsSet {
  shape: Float32Array | readonly (Float32Array | ImpostorLevel | null)[];
  data?: Float32Array;
  records?: Float32Array; stride?: number;
  /** the shape's size (its bounding radius, m): its level by how many pixels it covers */
  radius?: number;
  /** kept within a range of CSS px across (core › render › drawing › size: a shape's own `size`) */
  size?: SizeRange;
  /** its clones tint its groups (a record's fourth texel: groups 1…4, −1 their own colour) */
  groups?: boolean;
  /** its shape's joints and their drivers (core › entities › kinematics) */
  joints?: SetJoint[];
  /** its shape's copies over time (copy: emit): each emitter's place and motion */
  emitters?: Emitter[];
}
/** a joint of a set's shape with its driver (core › entities › kinematics): its part's number (in its vertices' code),
 *  kind, pivot and axis (the shape's frame), limits (radians, a slider's metres); its driver: a rate for the whole set
 *  (radians or metres a second; each clone's phase by its seed), each clone's own (`own`: the float of its record its
 *  rate and phase start at), or your formula (statements in the WGSL subset setting `value`, degrees or a slider's
 *  metres, of `time` (s) and `seed` (0..1, the clone's)) */
export interface SetJoint { /** its part's name */ name?: string; part: number; kind: 'hinge' | 'wheel' | 'slider'; pivot: V3; axis: V3; radius?: number; limits?: [number, number]; rate?: number; own?: number; formula?: string; /** a set's: the log value it reads, × this */ value?: string; per?: number }
/** a record: (x, z, height, id) · (scale x, y, z, turn rad) · (colour, the share of its leaf cards kept out, seed 0..1,
 *  its chunk's slot: written by the layer) */
export const RECORD = 3;
export const RECORD_FLOATS = 4;
type V3 = [number, number, number];
export interface SolidsProps extends ElementProps {
  /** casts the sun's shadow (default true; it always takes shadows) */
  shadows?: boolean;
  /** its repeated shapes (a street level's trees) drawn (default true); false: left out from the next frame, nothing
   *  built again (a layer list switches the trees off) */
  instances?: boolean;
  /** the hovered thing lights up in this colour (false: no hover) */
  hover?: ({ color?: Color } & FormVisual) | false;
  /** the selected things (s.user.selection: a tap on a layer with `select`, w.select) in this colour (default blue
   *  '#38bdf8'), mixed into their own by `mix` (0..1, default .65), and a form on each with `shape` (as every layer's
   *  `selected`); false: no colour. A theme keeps them: they are its subjects */
  selected?: ({ color?: Color; mix?: number } & FormVisual) | false;
  tooltip?: (d: SolidPicked, s: State) => string | null | undefined;
  onTap?: (f: Picked<SolidPicked>, s: State) => void;
  /** seconds a new chunk takes to appear (default .25) */
  fade?: number;
  /** chunks held at once (default 96; an entities layer's 256: every chunk its data reaches, 8 × 8 km at 500 m; at most
   *  256, what a ground grid's layer and a pick's number can tell apart) */
  maxChunks?: number;
  /** metres from the camera's ground point where instances change to their middle and far shapes (default 350, 800) */
  lod?: [number, number];
  /** ms a frame of reading the ground again under its chunks when the terrain changed (default 3): those in view and
   *  near first (up to three of them read whole a frame whatever it takes), then the rest */
  groundMs?: number;
  /** instances with a size (radius) change level by the pixels they cover instead: whole above `full`, simple above
   *  `simple`, far below (default 120, 25); each changes only past an edge by `margin`, a share of it (default .2: an
   *  acrobatic camera never flips one back and forth; core › runtime › detail), and only when the eye has moved a few
   *  metres (the dwell). The governor's detail (¾, ½) raises the edges: coarser levels sooner */
  pixels?: { full?: number; simple?: number; margin?: number };
  /** the counted level (levels › counted): at the observation levels given (presence: core › observation; it changes
   *  once, at a level change, never with the camera), nothing is drawn per copy: a number per cell of `cell` metres
   *  instead (a label layer it brings, '<id>-counted'); pay only for what you set: unset, none */
  counted?: { cell?: number; level: LevelSpec; size?: number; color?: Color; format?: (n: number) => string };
  /** the imagery its 'imagery' material shows (a roof's satellite photo): a raster source seen from above, read at
   *  `zoom` (default 17) into a picture of each chunk that has such pieces; unset: none (they are drawn as matte) */
  imagery?: { source: RasterSource; zoom?: number; size?: number };
  /** its windows (pieces finished as lamps: 'windows'): the share of them lit at night, 0..1 (default .45), or your
   *  function of the state (later in the evening fewer); rooms seen through them (`interior`: a floor, a ceiling and
   *  walls behind the glass, by day and night) */
  windows?: { lit?: number | ((s: State) => number); interior?: boolean };
}
/** a cell's count (levels › counted): its middle (the mean of its copies) and how many */
export interface CountedCell { lon: number; lat: number; count: number }
/** what a pick of a solid gives as its datum */
export interface SolidPicked extends SolidInfo { chunk: string; local: number }

const GN = 51, STEP = 10, KZ = 110574;
/** a chunk in view nearer than this (m) has its ground read first, up to three a frame whatever it takes: a metre of
 *  ground is a pixel or more there on a phone */
const GROUND_NEAR = 1500;
/** a flat ground's grid (every chunk on flat ground shares it: never written) and the grid a read is made in */
const FLAT = new Float32Array(GN * GN), READ = new Float32Array(GN * GN);
/** a box in the world (m from the view's centre): least x, y, z, then most */
type Bounds = [number, number, number, number, number, number];
/** a level of an instance set: a shape's buffer, or an impostor (its atlases baked on first need) */
type Level = { buf: GBuffer; nv: number; imp?: undefined; parts?: Parts | null } | { imp: Imp; buf?: undefined; nv?: undefined; parts?: undefined };
/** a shape's level on the chip, shared by every solids layer of its graphics: the chunk sets drawing it, its bytes, when
 *  it was last let go */
interface Stored { buf: GBuffer; nv: number; parts: Parts | null; refs: number; bytes: number; used: number }
const STORES = new WeakMap<Graphics, Map<Float32Array, Stored>>();
const storeOf = (g: Graphics) => { let s = STORES.get(g); if (!s) STORES.set(g, (s = new Map())); return s; };
/** MB of shapes' levels no set draws kept on the chip (going back to them costs nothing) */
export const SHAPE_SPARE_MB = 24;
/** what of a mesh or a shape is drawn apart (core › render › look › materials): lines (wire edges, raw segments),
 *  ghosts (blended), your own materials (by code); n: their floats. null: nothing (the common case: one draw as before) */
interface Parts { lines: { buf: GBuffer; n: number } | null; ghost: { buf: GBuffer; n: number } | null; custom: { code: number; buf: GBuffer; n: number }[]; /** copies over time (instances only) */ emit: { buf: GBuffer; n: number } | null }
/** a special part's programs: for meshes and for instances */
interface Variant { mesh: Program | null; inst: Program | null; params?: { block: ParamBlock; buf: GBuffer; version: number; m: CustomMaterial } }
interface Imp { level: ImpostorLevel; baked: BakedImpostor | null; block: GBuffer | null; failed: boolean }
/** an instance set of a chunk: its levels, its records; a sized set is sorted each time the eye moves a few metres
 *  (each instance at the level its own size on screen asks). Drawn with its form's sets in every chunk (its group) */
interface Inst { /** its chunk */ chunk: Chunk; /** distinct forms among its levels (one: never sorted by level) */ forms: number; shapes: (Level | null)[]; ni: number; radius: number; /** its records (a view of its chunk's): R texels each, from texel `base` of its chunk's */ rec: Float32Array; R: number; base: number; eye: [number, number, number] | null; /** its range on screen (CSS px; null: none) */ range: SizeUnits | null; /** each instance's level as last sorted (the margin keeps it: core › runtime › detail), how many at each, the sorts done */ lv: Uint8Array | null; counts: number[]; sorts: number; /** even its nearest clone is far: every one at the far level */ far: boolean; /** its joints, their drivers; a formula's program key ('': none) */ joints: SetJoint[]; formula: string; moving: boolean; /** its sort under way: the eye captured at its gate, the pixels' factor and edges then, the clone it is at, the levels so far */ job: { eye: [number, number, number]; k: number; edges: [number, number, number]; next: number; lv: Uint8Array; counts: number[] } | null; /** its chunk's level by distance (until its first sort) */ lodNow: number;
  /** its form's sets in every chunk (one draw a level); its pieces show the imagery (its chunk's picture: its sets apart) */ group: Group | null; pic: boolean;
  /** how it is drawn and how it casts as its group last listed it (−1: not; 0…2: every clone at that level; 3: each
   *  at its own, as sorted) and the sort listed */ drawn: number; cast: number; drawnAt: number; castAt: number }
/** a form's sets across the chunks of a layer (the same levels, block and drivers: core › geometry › shapes › instances):
 *  one draw a level for every chunk's clones, its lists (each clone's record by its first texel in the layer's records)
 *  made again only when one of its sets changes level or comes into view or out of it */
interface Group {
  key: string; members: Set<Inst>; shapes: (Level | null)[]; S: Float32Array; sbuf: GBuffer; sized: boolean; joints: SetJoint[]; formula: string; moving: boolean;
  /** the chunk whose picture it draws (its pieces show the imagery); null: none */ pic: Chunk | null;
  /** its lists: drawn by level (whole, simple, far), casting (the simple level, the far) */ lists: List[]; casts: List[]; dirty: boolean; castDirty: boolean;
  /** where its drawn and casting chunks are this frame (world m) */ box: Bounds; castBox: Bounds;
  /** the levels whose pieces change by themselves (copies over time, a clock-reading material): bits 0…2 */ clocky: number;
}
interface List { buf: GBuffer | null; n: number; cap: number }
/** texels a row of a layer's records (row 0: its chunks' tiles, TILE_TEXELS a slot) */
const REC_W = 2048, TILE_TEXELS = 2;
const kxOf = (lat0: number) => 111320 * Math.cos(lat0 * D);
interface Chunk {
  key: string; slot: number; spec: SolidsChunk; born: number;
  vbuf: GBuffer | null; n: number; fbuf: GBuffer | null; fn: number; parts: Parts | null;
  /** the whole mesh built on demand (near), dropped when far */
  lazy: (() => Float32Array | Promise<Float32Array>) | null; lazyPending: boolean;
  inst: Inst[];
  /** the tallest thing in it over its ground (m): its box for culling */
  top: number;
  /** where its meshes reach (m of its frame: least x, height, z, then most; null: not known): a piece kept in the chunk
   *  of its middle reaches out of the square, and is culled, picked and cast by where it is */
  ext: number[] | null;
  tbuf: GBuffer; t: Float32Array; tw: Float32Array; ground: Float32Array; groundSeen: number; groundFull: boolean;
  /** its ground grid's layer (−1: none, its ground flat) */
  glayer: number;
  /** the ground version its grid was last read whole at (groundSeen: checked, a probe may have held it since) */
  groundRead: number;
  /** in view last frame, and how far (m, from the camera's ground point to its square): its ground read in that order;
   *  the frame since it waits for its ground to be checked (its wait over its distance orders those in view: none waits
   *  long behind nearer ones whose ground keeps moving) */
  inView: boolean; away: number; waits: number;
  /** the highest ground under it as last read (true m; NaN: not read yet) */
  groundTop: number;
  /** its levels by distance as last drawn (its meshes', its instances'): kept within the margin */
  lodNow: [number, number];
  /** its sets' records (their numbers) and where they are in the layer's: from texel `rbase`, `rn` texels */
  rdata: Float32Array; rbase: number; rn: number;
  corner: [number, number];
  /** its square this frame (world m: its instances' box) */
  square: Bounds;
  /** the first row of its tints in the layer's (−1: none) and how many */
  tintRow: number; tintRows: number;
}

export class Solids extends Element<SolidsProps> {
  readonly kind = 'shape' as const;
  /** what it holds stands on the ground (buildings, trees, benches, bodies): a mark draped on the ground never paints
   *  it; what lies on the ground (roads, paths, water) says false */
  readonly stands: boolean = true;
  private g: Graphics | null = null;
  private prog: Program | null = null; private progI: Program | null = null; private progImp: Program | null = null;
  /** impostors baked here (shared by every chunk) */
  private imps = new Map<ImpostorLevel, Imp>(); private impReady = false;
  /** near chunks still waiting for their whole mesh */
  private lazyWaiting = 0;
  /** the ground grids: a layer each for the chunks whose ground is not flat (one on flat ground, or a free one, has
   *  none: its ground is 0), the layers taken and those free again */
  private groundTex: GTexture | null = null; private groundLayers = 0; private groundTop = 0; private groundFree: number[] = [];
  /** the ground grids' texture made with room for a layer (every chunk's grid that has one written into it again) */
  private growGround(layer: number): void {
    const g = this.g; if (!g) return;
    this.groundTex?.destroy(); this.groundLayers = Math.min(this.maxChunks, Math.max(layer + 1, this.groundLayers * 2));
    this.groundTex = g.texture({ label: `solids ${this.id} ground`, width: GN, height: GN, layers: this.groundLayers, format: 'r32f', filter: 'nearest' });
    // (each chunk's grid as last read, written into the new texture)
    for (const c of this.chunks.values()) if (c.glayer >= 0) this.groundTex.write(c.ground, { layer: c.glayer });
  }
  /** a chunk's ground grid as read: a layer of its own written (taken when it had none), or, flat, none (its layer free) */
  private groundInto(c: Chunk): void {
    if (c.ground === FLAT) { if (c.glayer >= 0) { this.groundFree.push(c.glayer); c.glayer = -1; } return; }
    if (c.glayer < 0) { c.glayer = this.groundFree.pop() ?? this.groundTop++; if (c.glayer >= this.groundLayers) this.growGround(c.glayer); }
    this.groundTex!.write(c.ground, { layer: c.glayer });
  }
  private chunks = new Map<string, Chunk>(); private free: number[] = [];
  private pending = new Map<string, SolidsChunk>();
  private hoverKey: string | null = null;
  /** shapes are shared by every chunk: one buffer each */
  private shapeBufs = new Map<Float32Array, GBuffer>();
  /** tints per id (an analysis, the selected): your function, the shared 'no tint'; every chunk's rows in one texture
   *  (256 ids a row, a chunk's from its first row: tintRow), each chunk's as made */
  private tintFn: ((info: SolidInfo, chunk: string, id: number) => readonly [number, number, number, number] | null) | null = null;
  private noTint: GTexture | null = null; private tintAtlas: GTexture | null = null; private tintPx = new Map<string, Uint8Array>();
  /** the layer's records: every chunk's in one texture of REC_W texels a row (row 0: the chunks' tiles; then each
   *  chunk's records from its own first texel), its rows, the top of what is taken and the runs free below it; made
   *  again (more rows, or packed) before the next draw */
  private recTex: GTexture | null = null; private recRows = 0; private recTop = REC_W; private recFree: [number, number][] = []; private recRemake = false;
  /** the chunks' tiles as last written (TILE_TEXELS a slot) and the slots changed since */
  private tileRow = new Float32Array(0); private tilesLo = Infinity; private tilesHi = -1;
  /** each form's sets across the chunks, drawn together (by their key: levels, block and drivers) */
  private groups = new Map<string, Group>();
  /** the block every instance draw binds (what all its chunks share: exaggeration, pick number, highlight, windows) */
  private lbuf: GBuffer | null = null; private lt = new Float32Array(16); private ltw = new Float32Array(16).fill(NaN);
  /** what the last frame drew: chunks in view, vertices */
  private drawn = { chunks: 0, vertices: 0 };
  private nowMs = 0;
  constructor(p: SolidsProps = {}) { super(p); }
  get maxChunks(): number { return Math.min(256, this.props.maxChunks ?? this.chunksByDefault); }
  /** chunks held at once unless set (a streamed layer's: those round the view) */
  protected chunksByDefault = 96;
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    const g = ctx.graphics; if (!g) return;
    this.g = g;
    const textures = [{ name: 'ground', kind: '2d-array' as const, sample: 'unfilterable' as const }, { name: 'shadowMap', kind: '2d' as const, sample: 'float' as const }, { name: 'tints', kind: '2d' as const, sample: 'float' as const }, { name: 'picture', kind: '2d' as const, sample: 'float' as const }];
    this.prog = g.program({ label: `solids ${this.id}`, wgsl: SOLID_WGSL, glsl: SOLID_GLSL, blocks: ['Frame', 'T'], textures,
      vertex: { stride: MESH_FLOATS, attributes: [{ name: 'a', location: 0, size: 4, offset: 0 }, { name: 'b', location: 1, size: 4, offset: 4 }] }, depth: { write: true, test: 'less' }, cull: 'none' });
    this.progI = g.program({ label: `solids ${this.id} instances`, wgsl: SOLID_INST_WGSL, glsl: SOLID_INST_GLSL, blocks: ['Frame', 'T', 'S'], textures: [...textures, REC_TEX],
      instance: INST_LAYOUT,
      vertex: { stride: SHAPE_FLOATS, attributes: [{ name: 'v', location: 3, size: 4, offset: 0 }, { name: 'vc', location: 4, size: 1, offset: 4 }, { name: 'card', location: 5, size: 1, offset: 5 }] }, depth: { write: true, test: 'less' }, cull: 'none' });
    // (its layers grown by need: a layer of a few chunks pays for those only; on flat ground, or of moving things on no
    // ground, for one)
    this.groundLayers = 1;
    this.groundTex = g.texture({ label: `solids ${this.id} ground`, width: GN, height: GN, layers: this.groundLayers, format: 'r32f', filter: 'nearest' });
    for (let i = this.maxChunks - 1; i >= 0; i--) this.free.push(i);
    this.tileRow = new Float32Array(this.maxChunks * TILE_TEXELS * 4).fill(NaN);
    this.progImp = g.program({ label: `solids ${this.id} impostors`, wgsl: IMPOSTOR_WGSL, glsl: IMPOSTOR_GLSL, blocks: ['Frame', 'T', 'S', 'IM'],
      textures: [...textures, REC_TEX, { name: 'atlas', kind: '2d' as const, sample: 'float' as const }, { name: 'normals', kind: '2d' as const, sample: 'float' as const }],
      instance: INST_LAYOUT, depth: { write: true, test: 'less' }, cull: 'none' });
    this.progImp.ready.then(() => { this.impReady = true; }, (e) => ctx.world.error(e));
    await Promise.all([this.prog.ready, this.progI.ready]);
    for (const [k, c] of this.pending) this.put(k, c);
    this.pending.clear();
  }
  override detach(): void {
    for (const k of [...this.chunks.keys()]) this.drop(k);
    this.prog?.destroy(); this.progI?.destroy(); this.progImp?.destroy(); this.groundTex?.destroy();
    for (const x of this.imps.values()) { x.block?.destroy(); for (const t of x.baked?.targets ?? []) t.destroy(); for (const b of x.baked?.buffers ?? []) b.destroy(); }
    this.imps.clear(); this.progImp = null; this.impReady = false;
    for (const b of this.shapeBufs.values()) b.destroy(); this.shapeBufs.clear();
    for (const v of this.variants.values()) { v.mesh?.destroy(); v.inst?.destroy(); v.params?.buf.destroy(); } this.variants.clear();
    for (const fp of this.formulaProgs.values()) fp.destroy(); this.formulaProgs.clear();
    this.tintAtlas?.destroy(); this.tintAtlas = null; this.tintPx.clear(); this.noTint?.destroy(); this.noTint = null;
    this.recTex?.destroy(); this.recTex = null; this.recRows = 0; this.recTop = REC_W; this.recFree = []; this.lbuf?.destroy(); this.lbuf = null; this.ltw.fill(NaN);
    for (const t of this.pics.values()) if (typeof t === 'object') t.destroy(); this.pics.clear(); this.noPic?.destroy(); this.noPic = null;
    this.prog = this.progI = null; this.groundTex = null; this.groundTop = 0; this.groundFree = []; this.g = null; this.free = [];
    super.detach();
  }
  /** add or replace a chunk */
  put(key: string, spec: SolidsChunk): this {
    const g = this.g; this.placesV++;
    if (!g || !this.prog) { this.pending.set(key, spec); return this; }
    // (a chunk put again keeps its slot and its ground's layer)
    const old = this.chunks.get(key), glayer = old ? old.glayer : -1;
    if (old) { old.glayer = -1; this.release(old); }
    const slot = old ? old.slot : this.free.pop();
    if (slot === undefined) { this.attached?.world.error(new AslnutError('E-DATA-001', `solids '${this.id}': more than ${this.maxChunks} chunks of 500 m at once`, { where: this.id, fix: this.maxChunks < 256 ? 'maxChunks: up to 256' : 'its things within 8 × 8 km, or split into layers by area' })); return this; }
    const lazy = typeof spec.mesh === 'function' ? spec.mesh : null;
    // the special parts apart (lines, ghosts, your materials): the mesh's solid triangles as before
    const sp = spec.mesh && !lazy ? splitParts(spec.mesh as Float32Array, MESH_FLOATS, meshCode) : null, whole = sp ? sp.solid : (spec.mesh as Float32Array | undefined);
    const n = whole && !lazy ? whole.length / MESH_FLOATS : 0;
    const kx = kxOf(spec.origin[1]);
    const c: Chunk = {
      key, slot, spec, born: old ? old.born : spec.fade === false ? -1e9 : this.nowMs, n,
      vbuf: n ? g.buffer('vertex', whole!, `${this.id} ${key}`) : null, lazy, lazyPending: false, parts: sp ? this.partsOf(sp, `${key}`) : null,
      fn: spec.far ? spec.far.length / MESH_FLOATS : 0, fbuf: spec.far && spec.far.length >= MESH_FLOATS ? g.buffer('vertex', spec.far, `${this.id} ${key} far`) : null,
      inst: [], rdata: new Float32Array(0), rbase: 0, rn: 0, square: [0, 0, 0, 0, 0, 0], tintRow: -1, tintRows: 0,
      top: spec.free ? 1e5 : topOf(spec), ext: extentOf(lazy ? null : (spec.mesh as Float32Array | undefined), extentOf(spec.far, null)),
      tbuf: g.buffer('uniform', 16 * 4, `${this.id} ${key} block`), t: new Float32Array(16), tw: new Float32Array(16).fill(NaN),
      ground: old?.ground ?? FLAT, glayer, groundSeen: old ? old.groundSeen : -1, groundFull: old?.groundFull ?? false, groundRead: old ? old.groundRead : -1, groundTop: old?.groundTop ?? NaN, inView: old?.inView ?? true, away: old?.away ?? 0, waits: old?.waits ?? 0,
      corner: [spec.origin[0] + spec.at[0] / kx, spec.origin[1] - spec.at[1] / KZ], lodNow: old?.lodNow ?? [-1, -1],
    };
    this.records(c, spec.instances ?? []);
    // (its clones' numbers are its records now: the spec keeps none of them, nothing is held twice)
    if (spec.instances?.length) c.spec = { ...spec, instances: spec.instances.map((x) => ({ ...x, data: undefined, records: undefined })) };
    this.chunks.set(key, c);
    this.changed();
    return this;
  }
  has(key: string): boolean { return this.chunks.has(key) || this.pending.has(key); }
  /** the highest top of what it holds in a box (true m over the sea: a chunk's highest ground and the tallest thing on
   *  it); null: none of its chunks there (core › geometry › marks › drape: how tall a mark's part over them stands) */
  topIn(w: number, s: number, e: number, n: number): number | null {
    let top: number | null = null;
    for (const c of this.chunks.values()) {
      if (c.spec.free) continue;
      const side = Math.min(500, c.spec.side ?? 500), kx = kxOf(c.spec.origin[1]), cw = c.corner[0], cn = c.corner[1];
      if (cw > e || cw + side / kx < w || cn < s || cn - side / KZ > n) continue;
      const t = (Number.isFinite(c.groundTop) ? c.groundTop : 0) + c.top;
      if (top === null || t > top) top = t;
    }
    return top;
  }
  /** where a chunk's meshes reach (m of its frame: least x, height, z, then most); null: not known (no mesh yet) */
  reachOf(key: string): readonly number[] | null { return this.chunks.get(key)?.ext ?? null; }
  keys(): string[] { return [...this.chunks.keys(), ...this.pending.keys()]; }
  /** new numbers for a chunk's instances (things that move: INSTANCE_FLOATS each): their records written in place
   *  (as many as before, else the chunk's records made again), no fade */
  moveInstances(key: string, set: number, data: Float32Array): this {
    const c = this.chunks.get(key), x = c?.inst[set]; if (!c || !x) return this;
    const n = Math.floor(data.length / INSTANCE_FLOATS);
    if (n !== x.ni) { const sets = c.inst.map((y, k) => (k === set ? { ...c.spec.instances![k]!, data, records: undefined } : { ...c.spec.instances![k]!, data: undefined, records: y.rec.slice(), stride: y.R })); this.releaseSets(c); this.records(c, sets); }
    else { legacyInto(data, x.rec, x.R, c.slot); this.writeRecords(c, x.base, x.ni * x.R); x.eye = null; x.job = null; }
    this.changed();
    return this;
  }
  /** a chunk's sets' records: each set's (given, or made from INSTANCE_FLOATS numbers), each record naming its chunk
   *  (its slot), laid in the layer's records from the chunk's first texel; each set with its form's in other chunks */
  private records(c: Chunk, sets: readonly SolidsSet[]): void {
    const list = sets.map((x) => { const R = x.records ? Math.max(RECORD, x.stride ?? RECORD) : RECORD, n = x.records ? Math.floor(x.records.length / (R * RECORD_FLOATS)) : Math.floor((x.data?.length ?? 0) / INSTANCE_FLOATS); return { x, R, n }; }).filter((q) => q.n > 0);
    let texels = 0; for (const q of list) texels += q.n * q.R;
    const data = new Float32Array(texels * RECORD_FLOATS);
    c.rdata = data; c.rn = texels; c.rbase = texels ? this.allot(texels) : 0; c.inst = [];
    let base = 0;
    for (const { x, R, n } of list) {
      const rec = data.subarray(base * RECORD_FLOATS, (base + n * R) * RECORD_FLOATS);
      if (x.records) { rec.set(x.records.subarray(0, n * R * RECORD_FLOATS)); for (let i = 0; i < n; i++) rec[i * R * RECORD_FLOATS + 11] = c.slot; }
      else legacyInto(x.data!, rec, R, c.slot);
      const joints = (x.joints ?? []).slice(0, 8), formula = joints.filter((j) => j.formula).map((j) => `${j.part}:${j.formula}`).join('|');
      const shapes = (Array.isArray(x.shape) ? x.shape : [x.shape]).map((sh: Float32Array | ImpostorLevel | null): Level | null => (isImpostor(sh) ? { imp: this.impOf(sh) } : sh && sh.length >= SHAPE_FLOATS ? this.shapeLevel(sh) : null));
      const inst: Inst = {
        chunk: c, shapes, ni: n, radius: x.radius ?? 0, rec, R, base, eye: null, forms: new Set(Array.isArray(x.shape) ? x.shape : [x.shape]).size,
        range: x.size ? rangeUnits(x.size, `solids '${this.id}' size`) : null, lv: null, counts: [0, 0, 0], sorts: 0, far: false,
        joints, formula, moving: joints.some((j) => j.formula || j.own !== undefined || (j.rate ?? 0) !== 0) || !!x.emitters?.length, job: null, lodNow: 1,
        group: null, pic: !!this.props.imagery && hasImagery(Array.isArray(x.shape) ? x.shape : [x.shape]), drawn: -1, cast: -1, drawnAt: -1, castAt: -1,
      };
      c.inst.push(inst); this.join(inst, this.setData(R, x, joints));
      base += n * R;
    }
    this.writeRecords(c, 0, texels);
  }
  // ── the layer's records: one texture for every chunk's (its first row the chunks' tiles) ───────────────────────
  /** `n` texels of the layer's records taken: the first free run they fit in, else at the top (more rows: the texture
   *  made again before the next draw) */
  private allot(n: number): number {
    for (let k = 0; k < this.recFree.length; k++) {
      const [a, m] = this.recFree[k]!; if (m < n) continue;
      if (m === n) this.recFree.splice(k, 1); else this.recFree[k] = [a + n, m - n];
      return a;
    }
    const a = this.recTop; this.recTop += n;
    if (Math.ceil(this.recTop / REC_W) > this.recRows) this.recRemake = true;
    return a;
  }
  /** texels [a, a + n) of the layer's records free again (joined to the runs either side; the top comes down) */
  private unallot(a: number, n: number): void {
    if (n <= 0) return;
    const f = this.recFree; let k = 0; while (k < f.length && f[k]![0] < a) k++;
    f.splice(k, 0, [a, n]);
    if (k + 1 < f.length && f[k]![0] + f[k]![1] === f[k + 1]![0]) { f[k]![1] += f[k + 1]![1]; f.splice(k + 1, 1); }
    if (k > 0 && f[k - 1]![0] + f[k - 1]![1] === f[k]![0]) { f[k - 1]![1] += f[k]![1]; f.splice(k, 1); k--; }
    const last = f.at(-1); if (last && last[0] + last[1] === this.recTop) { this.recTop = last[0]; f.pop(); }
  }
  /** the layer's records made ready for this frame's draws: made again when they outgrew it (or a third of it is all
   *  that is taken), packed first when half of what is taken is free runs (every set's place moves: its group lists
   *  again), every chunk's records written; then the chunks' tiles changed since the last frame */
  private syncRecords(): void {
    const g = this.g!, low = this.recTex && this.recRows > 8 && Math.ceil(this.recTop / REC_W) * 3 < this.recRows;
    if (this.recRemake || !this.recTex || low) {
      let free = 0; for (const [, m] of this.recFree) free += m;
      if (free * 2 > this.recTop - REC_W) {
        let at = REC_W;
        for (const c of this.chunks.values()) { c.rbase = at; at += c.rn; }
        this.recTop = at; this.recFree = [];
        for (const G of this.groups.values()) { G.dirty = true; G.castDirty = true; }
      }
      // (the first time exactly what is taken: a layer made in one pass pays for its records only; then half as much again)
      const need = Math.max(1, Math.ceil(this.recTop / REC_W)), rows = !this.recTex || low ? need : Math.max(need, Math.ceil(this.recRows * 1.5));
      if (rows > g.caps.maxTex) { this.attached?.world.error(new AslnutError('E-DATA-001', `solids '${this.id}': its clones' records need ${rows} rows of ${REC_W} texels, more than the graphics' ${g.caps.maxTex}`, { where: this.id, fix: 'fewer clones in one layer (split it by area), or fewer texels a record' })); this.recRemake = false; return; }
      if (rows !== this.recRows || !this.recTex) {
        this.recTex?.destroy();
        this.recTex = g.texture({ label: `${this.id} records`, width: REC_W, height: rows, format: 'rgba32f', filter: 'nearest' }); this.recRows = rows;
      }
      this.recRemake = false;
      for (const c of this.chunks.values()) if (c.rn) this.recWrite(c.rbase, c.rdata);
      this.tilesLo = 0; this.tilesHi = this.maxChunks - 1;
    }
  }
  /** the chunks' tiles changed this frame written (the records' first row) */
  private syncTiles(): void {
    if (!this.recTex || this.tilesHi < this.tilesLo) return;
    const lo = this.tilesLo, hi = this.tilesHi, T4 = TILE_TEXELS * 4;
    this.recTex.write(this.tileRow.subarray(lo * T4, (hi + 1) * T4), { x: lo * TILE_TEXELS, y: 0, width: (hi - lo + 1) * TILE_TEXELS, height: 1 });
    this.tilesLo = Infinity; this.tilesHi = -1;
  }
  /** a chunk's tile (its corner and scales from its block; its hovered id, how far shown, its ground's layer, its first
   *  tints row): kept, and marked to be written when it changed */
  private tileOf(c: Chunk): void {
    const t = c.t, a = this.tileRow, o = c.slot * TILE_TEXELS * 4;
    const v = [t[0]!, t[1]!, t[2]!, t[3]!, t[6]!, t[7]!, t[15]!, t[14]!];
    let same = true; for (let i = 0; i < 8; i++) if (a[o + i] !== v[i]) { same = false; a[o + i] = v[i]!; }
    if (!same) { if (c.slot < this.tilesLo) this.tilesLo = c.slot; if (c.slot > this.tilesHi) this.tilesHi = c.slot; }
  }
  /** texels from `at` of the layer's records written (a run within a row, whole rows, a run: at most three writes) */
  private recWrite(at: number, data: Float32Array): void {
    const t = this.recTex!, n = data.length / RECORD_FLOATS;
    for (let i = 0; i < n;) {
      const a = at + i, y = Math.floor(a / REC_W), x = a - y * REC_W;
      if (x === 0 && n - i >= REC_W) { const rows = Math.floor((n - i) / REC_W); t.write(data.subarray(i * RECORD_FLOATS, (i + rows * REC_W) * RECORD_FLOATS), { x: 0, y, width: REC_W, height: rows }); i += rows * REC_W; }
      else { const w = Math.min(REC_W - x, n - i); t.write(data.subarray(i * RECORD_FLOATS, (i + w) * RECORD_FLOATS), { x, y, width: w, height: 1 }); i += w; }
    }
  }
  /** texels [from, from + n) of a chunk's records written again (none while the texture is to be made again: it writes
   *  them all) */
  private writeRecords(c: Chunk, from: number, n: number): void {
    if (!this.recTex || this.recRemake || n <= 0) return;
    this.recWrite(c.rbase + from, c.rdata.subarray(from * RECORD_FLOATS, (from + n) * RECORD_FLOATS));
  }
  /** a clone's record changed (its colour, its joints' rates: one texel each, written at once; its chunk's slot kept) */
  writeRecord(key: string, set: number, index: number, texel: number, v: readonly number[]): this {
    const c = this.chunks.get(key), x = c?.inst[set]; if (!c || !x || index < 0 || index >= x.ni || texel >= x.R) return this;
    const at = x.base + index * x.R + texel; c.rdata.set(v.slice(0, RECORD_FLOATS), at * RECORD_FLOATS);
    if (texel === 2) c.rdata[at * RECORD_FLOATS + 3] = c.slot;
    this.writeRecords(c, at, 1); this.changed();
    return this;
  }
  /** a set's records (read them; write through writeRecord) */
  recordsOf(key: string, set: number): { rec: Float32Array; stride: number; n: number } | null { const x = this.chunks.get(key)?.inst[set]; return x ? { rec: x.rec, stride: x.R, n: x.ni } : null; }
  /** the clock a set's joints count from (s: its group's) */
  setClock(key: string, set: number): number { return this.chunks.get(key)?.inst[set]?.group?.S[8] ?? 0; }
  /** the clock its joints' rates count from (s: the frame block's): a change of rate keeps the joint where it is */
  clockS(): number { return this.clockMs / 1000; }
  private clockMs = 0;
  /** a set's joint driven at a new rate for every clone (radians or metres a second): its value kept where it is now.
   *  It moves to the group of its form at that rate (made, from its group's block, when there is none) */
  setJointRate(key: string, set: number, joint: number, rate: number): this {
    const x = this.chunks.get(key)?.inst[set], j = x?.joints[joint], G = x?.group; if (!x || !j || !G) return this;
    const now = this.clockS(), o = 16 + joint * 16, S = G.S.slice(), old = S[o + 9]!, t0 = S[8]!;
    if (old === rate) return this;
    // (the value at now kept: its offset takes what the old rate had turned since the group's clock began)
    S[o + 14] = S[o + 14]! + old * (now - t0) - rate * (now - t0); S[o + 9] = rate; j.rate = rate; x.moving = x.joints.some((q) => q.formula || q.own !== undefined || (q.rate ?? 0) !== 0);
    this.leave(x); this.join(x, S, true);
    this.changed();
    return this;
  }
  // ── a form's sets across the chunks (one draw a level for all of them) ─────────────────────────────────────────
  /** a set into the group of its form (its levels, its block but its clock and joints' offsets, its chunk when it shows
   *  its picture): made with this block when there is none (its clock now; or as given) */
  private join(x: Inst, S: Float32Array, kept = false): void {
    const key = `${x.shapes.map(levelNo).join(',')}|${x.pic ? x.chunk.key : ''}|${blockKey(S)}`;
    let G = this.groups.get(key);
    if (!G) {
      const B = S.slice(); if (!kept) B[8] = this.clockS();
      B[12] = Math.max(0.25, Math.min(1, this.detailSeen));
      const empty = (): List => ({ buf: null, n: 0, cap: 0 }), none = (): Bounds => [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      G = { key, members: new Set(), shapes: x.shapes, S: B, sbuf: this.g!.buffer('uniform', B, `${this.id} set`), sized: x.radius > 0 && x.forms > 1, joints: x.joints, formula: x.formula, moving: x.moving,
        pic: x.pic ? x.chunk : null, lists: [empty(), empty(), empty()], casts: [empty(), empty()], dirty: true, castDirty: true, box: none(), castBox: none(), clocky: 0 };
      this.groups.set(key, G);
    }
    G.members.add(x); x.group = G; G.dirty = true; G.castDirty = true;
  }
  /** a set out of its group (the last one out: its buffers let go) */
  private leave(x: Inst): void {
    const G = x.group; if (!G) return;
    G.members.delete(x); x.group = null; G.dirty = true; G.castDirty = true;
    if (!G.members.size) { G.sbuf.destroy(); for (const l of [...G.lists, ...G.casts]) l.buf?.destroy(); this.groups.delete(G.key); }
  }
  /** a group's lists (drawn by level, or casting: the simple level, the far) made again from its sets as they are:
   *  each clone by its record's first texel in the layer's records */
  private listsOf(G: Group, cast: boolean): void {
    const lists = cast ? G.casts : G.lists, hasImp = G.shapes.some((y) => y?.imp), counts = lists.map(() => 0);
    // casting: near, the simple level (its cut-outs dapple the shade); farther, an impostor when there is one
    const to = (L: number) => (!cast ? L : (G.sized ? L < 2 : L === 0) || !hasImp ? 0 : 1);
    for (const x of G.members) { const s = cast ? x.cast : x.drawn; if (s < 0) continue; if (s < 3) counts[to(s)]! += x.ni; else for (let L = 0; L < 3; L++) counts[to(L)]! += x.counts[L]!; }
    const outs = counts.map((n) => new Float32Array(n)), at = counts.map(() => 0);
    for (const x of G.members) {
      const s = cast ? x.cast : x.drawn, a0 = x.chunk.rbase + x.base, R = x.R; if (s < 0) continue;
      if (s < 3) { const L = to(s), o = outs[L]!, j = at[L]!; for (let q = 0; q < x.ni; q++) o[j + q] = a0 + q * R; at[L]! += x.ni; continue; }
      const lv = x.lv!; for (let q = 0; q < x.ni; q++) { const L = to(lv[q]!); outs[L]![at[L]!++] = a0 + q * R; }
    }
    outs.forEach((a, L) => {
      const b = lists[L]!, n = a.length; b.n = n; if (!n) return;
      // (room for a quarter more; made smaller when it holds under a third of it)
      if (!b.buf || n > b.cap || n * 3 < b.cap) { b.buf?.destroy(); b.cap = Math.ceil(n * 1.25); const pad = new Float32Array(b.cap); pad.set(a); b.buf = this.g!.buffer('instance', pad, `${this.id} ${cast ? 'casting' : 'level'} ${L}`); }
      else b.buf.write(a);
    });
  }
  /** take a chunk away */
  drop(key: string): this {
    this.pending.delete(key); this.placesV++;
    const c = this.chunks.get(key); if (!c) return this;
    this.release(c); this.chunks.delete(key); this.free.push(c.slot);
    this.changed();
    return this;
  }
  /** a change to show: one frame asked for (none while a subclass writes its chunks inside its own frame: that frame
   *  draws them) */
  protected framing = false;
  protected changed(): void { if (!this.framing) (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); }
  private release(c: Chunk): void { if (c.glayer >= 0) this.groundFree.push(c.glayer); const pic = this.pics.get(c.key); if (typeof pic === 'object') pic.destroy(); this.pics.delete(c.key); this.tintPx.delete(c.key); c.vbuf?.destroy(); c.fbuf?.destroy(); this.dropParts(c.parts); c.parts = null; this.releaseSets(c); c.tbuf.destroy(); }
  /** a chunk's instance sets let go: out of their groups, their levels counted down, its records' texels free */
  private releaseSets(c: Chunk): void { for (const x of c.inst) { this.leave(x); this.letGoLevels(x); } c.inst = []; this.unallot(c.rbase, c.rn); c.rn = 0; }
  /** an instance set's block (S): its shape's size across (m) and its range on screen (core › render › drawing ›
   *  size), texels a record, its groups tinted, its clock's start (its group's) and its joints (core › entities ›
   *  kinematics: each its pivot and kind, axis and radius, driver, part) */
  private setData(R: number, x: SolidsSet, joints: readonly SetJoint[]): Float32Array {
    const S = new Float32Array(16 + 32 * 4 + 6 * 4), r = x.size ? rangeUnits(x.size, `solids '${this.id}' size`) : null, KIND = { hinge: 1, wheel: 2, slider: 3 } as const;
    S.set([(x.radius ?? 0) * 2, r ? 1 : 0, r ? r[1] : 0, r ? r[2] : 1e6, 0, R, 0, x.groups ? 1 : 0, 0, joints.length, 0, 0, Math.max(0.25, Math.min(1, this.detailSeen)), 0, 0, 0], 0);
    (x.emitters ?? []).slice(0, 2).forEach((e, k) => S.set([e.at[0], e.at[1], e.at[2], e.life, e.rise, e.spread, e.grow, e.count, e.fade[0], e.fade[1], e.drift[0], e.drift[1]], 16 + 32 * 4 + k * 12));
    joints.forEach((j, k) => {
      const o = 16 + k * 16, lim = j.limits;
      S.set([j.pivot[0], j.pivot[1], j.pivot[2], KIND[j.kind], j.axis[0], j.axis[1], j.axis[2], j.radius ?? 0, j.formula ? 2 : j.rate !== undefined || j.own !== undefined ? 1 : 0, j.rate ?? 0, lim ? lim[0] : 0, lim ? lim[1] : 0, j.part, j.own ?? -1, 0, 0], o);
    });
    return S;
  }
  /** an impostor's atlases: baked once, in the background (until then its instances take the level before) */
  private impOf(lv: ImpostorLevel): Imp {
    let x = this.imps.get(lv);
    if (!x) {
      const g = this.g!, imp: Imp = { level: lv, baked: null, block: null, failed: false }; x = imp;
      this.imps.set(lv, imp);
      void bakeImpostor(g, lv, this.shapeBuf(lv.shape)).then((b) => {
        if (this.g !== g) { for (const t of b.targets) t.destroy(); return; }
        imp.baked = b; imp.block = g.buffer('uniform', Float32Array.from([lv.radius, lv.centreY, lv.views, lv.size]), `${this.id} impostor`);
        (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.();
      }, (e) => { imp.failed = true; this.attached?.world.error(e); });
    }
    return x;
  }
  private shapeBuf(sh: Float32Array): GBuffer { let b = this.shapeBufs.get(sh); if (!b) { b = this.g!.buffer('vertex', sh, `${this.id} shape`); this.shapeBufs.set(sh, b); } return b; }
  /** a shape's level on the chip (its solid triangles, its special parts): one upload for every solids layer of the
   *  graphics, counted by the chunk sets that draw it (core › geometry › shapes › instances: the cache) */
  private shapeLevel(sh: Float32Array): Stored {
    const store = storeOf(this.g!); let L = store.get(sh);
    if (!L) {
      const sp = splitParts(sh, SHAPE_FLOATS, shapeCode), g = this.g!;
      L = sp ? { buf: g.buffer('vertex', sp.solid.length ? sp.solid : new Float32Array(SHAPE_FLOATS * 3), 'shapes'), nv: sp.solid.length / SHAPE_FLOATS, parts: this.partsOf(sp, 'shape'), refs: 0, bytes: sh.byteLength, used: 0 } : { buf: g.buffer('vertex', sh, 'shapes'), nv: sh.length / SHAPE_FLOATS, parts: null, refs: 0, bytes: sh.byteLength, used: 0 };
      store.set(sh, L);
    }
    L.refs++;
    return L;
  }
  /** a set's levels let go: each counted down; one no set draws is kept (going back is free) until the store's spares
   *  pass SHAPE_SPARE_MB, the least lately used out first */
  private letGoLevels(x: Inst): void {
    const store = storeOf(this.g!), now = performance.now();
    for (const L of x.shapes) if (L && !L.imp) { const st = L as Stored; st.refs = Math.max(0, st.refs - 1); if (!st.refs) st.used = now; }
    let spare = 0; const idle: [Float32Array, Stored][] = [];
    for (const e of store) if (!e[1].refs) { spare += e[1].bytes; idle.push(e); }
    if (spare <= SHAPE_SPARE_MB * 1048576) return;
    idle.sort((a, b) => a[1].used - b[1].used);
    for (const [k, st] of idle) { if (spare <= SHAPE_SPARE_MB * 1048576) break; st.buf.destroy(); this.dropParts(st.parts); store.delete(k); spare -= st.bytes; }
  }
  /** the special parts' buffers */
  private partsOf(sp: NonNullable<ReturnType<typeof splitParts>>, label: string): Parts {
    const g = this.g!, buf = (a: Float32Array, what: string) => g.buffer('vertex', a, `${this.id} ${label} ${what}`);
    return {
      lines: sp.lines ? { buf: buf(sp.lines, 'lines'), n: sp.lines.length } : null, ghost: sp.ghost ? { buf: buf(sp.ghost, 'ghost'), n: sp.ghost.length } : null,
      custom: [...sp.custom].map(([code, a]) => ({ code, buf: buf(a, `material ${code}`), n: a.length })),
      emit: sp.emit ? { buf: buf(sp.emit, 'copies over time'), n: sp.emit.length } : null,
    };
  }
  private dropParts(p: Parts | null): void { if (!p) return; p.lines?.buf.destroy(); p.ghost?.buf.destroy(); p.emit?.buf.destroy(); for (const c of p.custom) c.buf.destroy(); }
  // ── the special parts' programs: made the first time something of that kind is drawn ──
  private variants = new Map<string, Variant>();
  private variant(kind: 'lines' | 'ghost' | 'emit' | number): Variant | null {
    const key = String(kind); let v = this.variants.get(key);
    if (v) return v;
    const g = this.g; if (!g) return null;
    const textures = [{ name: 'ground', kind: '2d-array' as const, sample: 'unfilterable' as const }, { name: 'shadowMap', kind: '2d' as const, sample: 'float' as const }, { name: 'tints', kind: '2d' as const, sample: 'float' as const }, { name: 'picture', kind: '2d' as const, sample: 'float' as const }];
    const meshVx = { stride: MESH_FLOATS, attributes: [{ name: 'a', location: 0, size: 4 as const, offset: 0 }, { name: 'b', location: 1, size: 4 as const, offset: 4 }] };
    const inst = INST_LAYOUT;
    const shapeVx = { stride: SHAPE_FLOATS, attributes: [{ name: 'v', location: 3, size: 4 as const, offset: 0 }, { name: 'vc', location: 4, size: 1 as const, offset: 4 }, { name: 'card', location: 5, size: 1 as const, offset: 5 }] };
    let state: { blend?: 'alpha' | 'add' | 'none'; depth: { write: boolean; test: 'less' }; topology?: 'lines' } = { depth: { write: true, test: 'less' } };
    let src = { mesh: { wgsl: SOLID_WGSL, glsl: SOLID_GLSL }, inst: { wgsl: SOLID_INST_WGSL, glsl: SOLID_INST_GLSL } }, blocks = ['Frame', 'T'], params: Variant['params'];
    // (the instances' programs take their set's block S at binding 2: your material's params come after it)
    if (kind === 'lines') state = { ...state, topology: 'lines' };
    else if (kind === 'ghost') state = { blend: 'alpha', depth: { write: false, test: 'less' } };
    else if (kind === 'emit') { state = { blend: 'alpha', depth: { write: false, test: 'less' } }; src = { mesh: { wgsl: EMIT_WGSL, glsl: EMIT_GLSL }, inst: { wgsl: EMIT_WGSL, glsl: EMIT_GLSL } }; }
    else {
      const m = customOf(kind); if (!m) return null;
      const block = paramBlock(m.values), where = `material ${kind}`;
      try { src = { mesh: assembleMaterial(src.mesh, m.spec, block, where), inst: assembleMaterial(src.inst, m.spec, block, where, 3) }; }
      catch (e) { this.attached?.world.error(e); this.variants.set(key, (v = { mesh: null, inst: null })); return v; }
      blocks = ['Frame', 'T', 'MP'];
      params = { block, buf: g.buffer('uniform', block.size, `${this.id} ${where} params`), version: -1, m };
      const b = m.spec.blend ?? 'none'; state = b === 'none' ? state : { blend: b, depth: { write: false, test: 'less' } };
    }
    v = {
      mesh: kind === 'emit' ? null : g.program({ label: `solids ${this.id} ${key}`, ...src.mesh, blocks, textures, vertex: meshVx, cull: 'none', ...state }),
      inst: g.program({ label: `solids ${this.id} ${key} instances`, ...src.inst, blocks: [...blocks.slice(0, 2), 'S', ...blocks.slice(2)], textures: [...textures, REC_TEX], instance: inst, vertex: shapeVx, cull: 'none', ...state }),
      params,
    };
    for (const p of [v.mesh, v.inst]) p?.ready.catch((e) => this.attached?.world.error(e));
    this.variants.set(key, v);
    return v;
  }
  /** the special parts' draws (a mesh's, or an instance set's with its instances) */
  private partDraws(parts: Parts, out: DrawCall[], base: Omit<DrawCall, 'program' | 'vertices' | 'count'>, inst: boolean, stride: number): void {
    const add = (vr: Variant | null, buf: GBuffer, floats: number, pick: boolean) => {
      const prog = vr ? (inst ? vr.inst : vr.mesh) : null; if (!prog) return;
      const blocks = vr!.params ? [...base.blocks, vr!.params.buf] : base.blocks;
      if (vr!.params && vr!.params.version !== vr!.params.m.version) { vr!.params.buf.write(vr!.params.block.pack(vr!.params.m.values)); vr!.params.version = vr!.params.m.version; }
      // what is blended goes after everything opaque of the layer (what stands behind it is drawn first)
      (prog.desc.blend && prog.desc.blend !== 'none' ? this.late : out).push({ ...base, blocks, program: prog, vertices: buf, count: floats / stride, pickProgram: pick ? () => prog : undefined });
    };
    if (parts.lines) add(this.variant('lines'), parts.lines.buf, parts.lines.n, false);
    if (parts.ghost) add(this.variant('ghost'), parts.ghost.buf, parts.ghost.n, true);
    // copies over time: instances only (a mesh's are left out), never picked; their frames by distance as a clock's (an
    // instance set's by each chunk it is drawn in: the frame's loop)
    if (parts.emit && inst) add(this.variant('emit'), parts.emit.buf, parts.emit.n, false);
    for (const c of parts.custom) { add(this.variant(c.code), c.buf, c.n, true); if (!inst && customOf(c.code)?.animated) this.clockAt = Math.min(this.clockAt, awayFrom(this.eyeXZ, base.bounds)); }
  }
  /** a custom material that reads the clock was drawn last frame: how far its nearest chunk is (m; Infinity: none drawn) */
  private clockAt = Infinity; private eyeXZ: [number, number] = [0, 0];
  /** this frame's blended draws (ghosts, blended materials): after the layer's opaque ones */
  private late: DrawCall[] = [];
  /** the ground under a chunk's place (true m), from its grid; NaN before it is read */
  groundOf(key: string, x: number, z: number): number {
    const c = this.chunks.get(key); if (!c || !c.groundFull) return NaN;
    const gx = Math.max(0, Math.min(GN - 1.001, x / STEP)), gz = Math.max(0, Math.min(GN - 1.001, z / STEP)), x0 = Math.floor(gx), z0 = Math.floor(gz), fx = gx - x0, fz = gz - z0, gr = c.ground;
    const at = (i: number, j: number) => gr[j * GN + i]!;
    return (at(x0, z0) * (1 - fx) + at(x0 + 1, z0) * fx) * (1 - fz) + (at(x0, z0 + 1) * (1 - fx) + at(x0 + 1, z0 + 1) * fx) * fz;
  }
  /** whether a chunk's ground read before still holds: 25 of its grid points asked again (the terrain changes
   *  somewhere every time a tile arrives; mostly not under this chunk) */
  private groundHolds(ctx: FrameContext, c: Chunk): boolean {
    if (!c.groundFull) return false;
    const kx = kxOf(c.spec.origin[1]), gr = c.ground;
    const n = Math.min(GN, Math.ceil(Math.min(500, c.spec.side ?? 500) / STEP) + 2), q = (n - 1) / 4;
    for (let j = 0; j < n; j += q) for (let i = 0; i < n; i += q) {
      const gi = Math.round(i), gj = Math.round(j);
      const h = ctx.world.heightAt(c.spec.origin[0] + (c.spec.at[0] + gi * STEP) / kx, c.spec.origin[1] - (c.spec.at[1] + gj * STEP) / KZ);
      if (!(Math.abs(h - gr[gj * GN + gi]!) < 1e-3)) return false;
    }
    return true;
  }
  /** the ground under each chunk, read again when the terrain changed. In view and near first: each one probed (25
   *  questions, not 2,601: its ground still holds), up to three of those whose ground moved read whole a frame (more
   *  within `groundMs`), so none near in view stands on old ground for more than a few frames; then the rest (in view
   *  farther, then out of view) within what is left of `groundMs` (one at least when none near waited). A chunk a probe held is read whole
   *  later, when nothing else waits: every chunk ends on its ground read whole at the same terrain, however many frames
   *  it took (until then its status says it is reading) */
  private groundFrame = 0;
  private groundUnder(ctx: FrameContext, gv: number): void {
    let pend: Chunk[] | null = null;
    for (const c of this.chunks.values()) {
      if (c.groundRead === gv) continue;
      if (c.spec.free) { c.groundSeen = c.groundRead = gv; c.groundFull = true; continue; }
      (pend ??= []).push(c);
    }
    if (!pend) return;
    // not checked yet before only held by a probe; in view and near (within GROUND_NEAR: a metre of ground a pixel or
    // more on a phone) first, then in view, then the rest; in view, by the frames it has waited over how far it is (a
    // nearer one first, a farther one not left behind for long: its wait grows); else the nearest first
    const f = ++this.groundFrame;
    for (const c of pend) if (c.groundSeen !== gv && !c.waits) c.waits = f;
    const rank = (c: Chunk) => (c.groundSeen === gv ? 3 : 0) + (c.inView ? (c.away < GROUND_NEAR ? 0 : 1) : 2), due = (c: Chunk) => (f - c.waits + 1) / Math.max(200, c.away);
    const order = (a: Chunk, b: Chunk) => { const ra = rank(a), rb = rank(b); return ra - rb || (ra < 2 ? due(b) - due(a) : a.away - b.away); };
    pend.sort(order);
    const t0 = performance.now(), ms = this.props.groundMs ?? 3;
    let reads = 0;
    for (const c of pend) {
      if (rank(c) !== 0) break;
      if (this.groundHolds(ctx, c)) { c.groundSeen = gv; c.waits = 0; continue; }
      if (reads >= 3 && performance.now() - t0 > ms) continue;
      c.groundSeen = c.groundRead = gv; c.waits = 0; this.readGround(ctx, c); reads++;
    }
    let done = 0;
    // (in their order now: one a probe just held is read whole after those still unchecked)
    for (const c of pend.filter((x) => x.groundRead !== gv && rank(x) !== 0).sort(order)) {
      if ((done || reads) && performance.now() - t0 > ms) break;
      done++;
      if (c.groundSeen !== gv && this.groundHolds(ctx, c)) { c.groundSeen = gv; c.waits = 0; continue; }
      c.groundSeen = c.groundRead = gv; c.waits = 0; this.readGround(ctx, c);
    }
  }
  /** read a chunk's ground grid from the world's terrain (NaN where it is not known yet: kept from before, or 0) */
  private readGround(ctx: FrameContext, c: Chunk): void {
    const kx = kxOf(c.spec.origin[1]), gr = READ; let full = true;
    gr.set(c.ground);
    // only the part of the grid its square covers (a small chunk: a corner of the grid)
    const n = Math.min(GN, Math.ceil(Math.min(500, c.spec.side ?? 500) / STEP) + 2);
    let top = -Infinity;
    for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
      const lon = c.spec.origin[0] + (c.spec.at[0] + i * STEP) / kx, lat = c.spec.origin[1] - (c.spec.at[1] + j * STEP) / KZ;
      const h = ctx.world.heightAt(lon, lat);
      if (Number.isNaN(h)) { full = false; if (!c.groundFull) gr[j * GN + i] = 0; } else gr[j * GN + i] = h;
      if (gr[j * GN + i]! > top) top = gr[j * GN + i]!;
    }
    c.groundFull = full; c.groundTop = top;
    // (flat ground: the shared grid, no grid of its own)
    let flat = true; for (let i = 0; i < gr.length; i++) if (gr[i] !== 0) { flat = false; break; }
    if (flat) c.ground = FLAT; else { if (c.ground === FLAT) c.ground = new Float32Array(GN * GN); c.ground.set(gr); }
    this.groundInto(c);
  }
  // ── the counted level ─────────────────────────────────────────────────────────────────────────────────────────
  private placesV = 0; private cellsV = -1; private cellsNow: CountedCell[] = []; private countLayer: Element | null = null;
  /** counted now: the observation level is one it is counted at (no levels: never) */
  countedAt(s: State): boolean {
    const o = this.props.counted; if (!o) return false;
    const ob = s.observation; if (!ob || ob.level === null) return false;
    return inLevels(o.level, ob.levels, ob.index, `${this.id} counted`);
  }
  /** the copies counted in cells of `cell` metres (made again when chunks come and go) */
  cells(): CountedCell[] {
    if (this.cellsV === this.placesV) return this.cellsNow;
    this.cellsV = this.placesV;
    const cell = Math.max(1, this.props.counted?.cell ?? 1000), by = new Map<string, CountedCell>();
    let k0 = 0;
    // (a chunk's clones from its records, a pending one's from its spec)
    const each = [...[...this.chunks.values()].map((c) => ({ sp: c.spec, sets: c.inst.map((x) => ({ shape: x.shapes as never, records: x.rec, stride: x.R }) as SolidsSet) })), ...[...this.pending.values()].map((sp) => ({ sp, sets: sp.instances ?? [] }))];
    for (const { sp, sets } of each) {
      const kx = kxOf(sp.origin[1]); if (!k0) k0 = kx;
      for (const x of sets) for (const [px, pz] of placesOf(x)) {
        const lon = sp.origin[0] + (sp.at[0] + px) / kx, lat = sp.origin[1] - (sp.at[1] + pz) / KZ, key = `${Math.floor((lon * k0) / cell)}_${Math.floor((lat * KZ) / cell)}`;
        let c = by.get(key); if (!c) by.set(key, (c = { lon: 0, lat: 0, count: 0 }));
        c.lon += lon; c.lat += lat; c.count++;
      }
    }
    this.cellsNow = [...by.values()].map((c) => ({ lon: c.lon / c.count, lat: c.lat / c.count, count: c.count }));
    (this.countLayer as { setProps?: (p: object) => void } | null)?.setProps?.({ data: this.cellFeatures() });
    return this.cellsNow;
  }
  private cellFeatures(): Feature[] { return this.cellsNow.map((c, i) => ({ id: `${this.id}-cell-${i}`, geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, props: { count: c.count } }) as unknown as Feature); }
  /** with `counted`: its label layer (the numbers per cell), shown while counted */
  override companions(): Element[] {
    const o = this.props.counted; if (!o) return [];
    const fmt = o.format ?? ((n: number) => (n < 1000 ? String(n) : n < 1e6 ? `${(n / 1000).toFixed(n < 1e4 ? 1 : 0)}k` : `${(n / 1e6).toFixed(1)}M`));
    this.countLayer ??= textMark<Feature>({ id: `${this.id}-counted`, data: this.cellFeatures(), text: (d: Feature) => fmt(Number(d.props.count)), size: o.size ?? 13, color: o.color ?? '#ffffff', priority: (d: Feature) => Number(d.props.count), occlude: false, when: (s: State) => { if (this.target <= 0 || this.props.instances === false || !this.countedAt(s)) return false; this.cells(); return true; } } as never) as unknown as Element;
    return [this.countLayer];
  }
  frame(ctx: FrameContext): DrawCall[] {
    this.nowMs = ctx.loadNow ?? ctx.now; this.clockMs = ctx.now; this.sortStats.sets = 0; this.sortStats.ms = 0; this.clockAt = Infinity; this.eyeXZ[0] = ctx.camera.eye[0]!; this.eyeXZ[1] = ctx.camera.eye[2]!;
    if (!this.g || !this.prog?.ready || !this.groundTex || !this.chunks.size) return [];
    this.syncSelection(ctx);
    const tints = this.syncTints();
    // (no instances left: their records let go)
    if (this.groups.size) this.syncRecords(); else if (this.recTex) { this.recTex.destroy(); this.recTex = null; this.recRows = 0; }
    const cam = ctx.camera, gv = ctx.world.groundVersion, ex = ctx.world.exaggeration;
    this.groundUnder(ctx, gv);
    const latV = cam.lat, cv = R * Math.cos(latV * D), mV = mercY(latV);
    const hv = this.props.hover === false ? null : rgba(this.props.hover?.color ?? '#ffd166');
    const fade = (this.props.fade ?? 0.25) * 1000, cast = this.props.shadows !== false;
    const shadow = ctx.shadowMap!, out: DrawCall[] = [];
    const dl = this.detailOf(ctx.s), [lod1, lod2] = (this.props.lod ?? [350, 800]).map((x) => x * dl) as [number, number], ex0 = cam.eye[0]!, ez0 = cam.eye[2]!, vp = cam.viewProj;
    let nDrawn = 0, vDrawn = 0, lazyBudget = 2; this.lazyWaiting = 0;
    // the governor's detail changed: every sized set sorted again (its edges moved), every group's block told
    if (dl !== this.detailSeen) {
      this.detailSeen = dl; for (const c of this.chunks.values()) for (const x of c.inst) { x.eye = null; x.job = null; }
      for (const G of this.groups.values()) { G.S[12] = Math.max(0.25, Math.min(1, dl)); G.sbuf.write(G.S); }
    }
    // counted (far enough): nothing drawn per copy
    const counted = this.countedAt(ctx.s), sets = !counted && this.props.instances !== false;
    // the sun's shadow map this frame: the instances cast from the chunks in its box (none drawn: none cast)
    const sun = cast && sets ? ctx.shadowView ?? null : null;
    // the share of its windows (lamps: 'windows') lit at night: yours, or some
    const wl = this.props.windows?.lit, lit = Math.max(0, Math.min(1, typeof wl === 'function' ? wl(ctx.s) : wl ?? 0.45));
    const hoverChunk = this.hoverKey ? this.hoverKey.slice(0, this.hoverKey.lastIndexOf(':')) : null, hoverId = this.hoverKey ? Number(this.hoverKey.slice(this.hoverKey.lastIndexOf(':') + 1)) : -1;
    for (const G of this.groups.values()) { emptyBox(G.box); emptyBox(G.castBox); G.clocky = this.clockyOf(G); }
    for (const c of this.chunks.values()) {
      const kx = kxOf(c.spec.origin[1]), latC = c.corner[1];
      const t = c.t;
      t[0] = cv * ((c.corner[0] - cam.lon + 540) % 360 - 180) * D; t[1] = -cv * (mercY(latC) - mV);
      t[2] = (cv * D) / kx; t[3] = (cv * D) / (KZ * Math.cos(latC * D));
      t[4] = ex; t[5] = this.pickNo; t[6] = hv && c.key === hoverChunk && !this.selBy.get(c.key)?.has(hoverId) ? hoverId : -1; t[7] = Math.min(1, Math.max(0.001, (this.nowMs - c.born) / Math.max(1, fade)));
      t[8] = hv ? hv[0]! : 1; t[9] = hv ? hv[1]! : 1; t[10] = hv ? hv[2]! : 1; t[11] = c.slot;
      t[12] = lit; t[13] = this.props.windows?.interior ? 1 : 0; t[14] = c.tintRow; t[15] = c.glayer;
      // its boxes in the world (the camera's view culls by them, so do picking and the sun's shadow map): its meshes by
      // where they reach (a piece is kept whole in the chunk of its middle: culled by the square, a street's kerb
      // vanished when the camera moved off that square; a free chunk's heights its own), its instances by its square
      const side = Math.min(500, c.spec.side ?? 500), e = c.ext, M = 2;
      let g0 = Infinity, g1 = -Infinity; for (let i = 0; i < c.ground.length; i += 13) { const h = c.ground[i]!; if (h < g0) g0 = h; if (h > g1) g1 = h; }
      if (!Number.isFinite(g0)) { g0 = 0; g1 = 0; }
      const box = (a0: number, b0: number, a1: number, b1: number, y0: number, y1: number): Bounds => { const x0 = t[0]! + a0 * t[2]!, x1 = t[0]! + a1 * t[2]!, z0 = t[1]! + b0 * t[3]!, z1 = t[1]! + b1 * t[3]!; return [Math.min(x0, x1), y0, Math.min(z0, z1), Math.max(x0, x1), y1, Math.max(z0, z1)]; };
      const gy0 = g0 * ex - 40, gy1 = g1 * ex + c.top + 5, square = box(0, 0, side, side, gy0, gy1);
      const meshes = e ? box(e[0]! - M, e[2]! - M, e[3]! + M, e[5]! + M, c.spec.free ? e[1]! - M : gy0, c.spec.free ? e[4]! + M : gy1) : square;
      const seenM = inView(vp, meshes), seenI = c.inst.length > 0 && inView(vp, square), seen = seenM || seenI;
      c.square = square;
      // how far: from the camera's ground point to its meshes' box (the far mesh or the whole one), to its square (its
      // instances' levels; and its whole mesh made on demand by it, as before: a chunk whose lots reach out made it
      // far sooner, 6 to 9 MB more on a phone)
      const away = (b: Bounds) => Math.hypot(Math.max(b[0] - ex0, 0, ex0 - b[3]), Math.max(b[2] - ez0, 0, ez0 - b[5]));
      const distM = away(meshes), distS = e ? away(square) : distM, dist = c.inst.length ? distS : distM;
      c.inView = seen; c.away = distS;
      // its levels by distance, each kept until past its edge by the margin (a camera hovering at an edge never flips it)
      const mg = 1 + (this.props.pixels?.margin ?? LEVEL_MARGIN), lodM = keptLevel(distM, c.lodNow[0], lod1, lod2, mg, true), lod = keptLevel(dist, c.lodNow[1], lod1, lod2, mg, true);
      c.lodNow[0] = lodM; c.lodNow[1] = lod;
      // a whole mesh built on demand: made when the chunk comes within the far distance (one a frame), let go past
      // twice that
      if (c.lazy && !c.vbuf && distS < lod2 * 1.15) this.lazyWaiting++;
      if (c.lazy && !c.vbuf && !c.lazyPending && distS < lod2 * 1.15 && lazyBudget-- > 0) {
        const take = (m: Float32Array) => { c.lazyPending = false; if (this.chunks.get(c.key) !== c || c.vbuf || !this.g) return; c.ext = extentOf(m, c.ext); const sp = splitParts(m, MESH_FLOATS, meshCode), wm = sp ? sp.solid : m; this.dropParts(c.parts); c.parts = sp ? this.partsOf(sp, c.key) : null; c.n = wm.length / MESH_FLOATS; c.vbuf = c.n ? this.g.buffer('vertex', wm, `${this.id} ${c.key}`) : null; if (!c.n && !c.parts) c.lazy = null; /* (an empty whole mesh: nothing to wait for, nothing to make again) */ (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); };
        try { const m = c.lazy(); if (m instanceof Promise) { c.lazyPending = true; m.then(take, (e) => { c.lazyPending = false; c.lazy = null; ctx.world.error(e); }); } else take(m); } catch (e) { c.lazy = null; ctx.world.error(e); }
      } else if (c.lazy && c.vbuf && distS > lod2 * 2) { c.vbuf.destroy(); c.vbuf = null; c.n = 0; this.dropParts(c.parts); c.parts = null; }
      // written only when it changed (a turning view keeps the same numbers: the sun's shadow map is kept too)
      let same = true; for (let i = 0; i < 16; i++) if (t[i] !== c.tw[i]) { same = false; c.tw[i] = t[i]!; }
      if (!same) c.tbuf.write(t);
      // (its instances' tile: the same numbers, in the records' first row)
      if (c.inst.length) this.tileOf(c);
      const textures = [this.groundTex, shadow, tints, this.pictureOf(c)], blocks = [ctx.frame, c.tbuf], p = this.prog;
      // in view: the level of detail for its distance; the sun's shadow map always takes the light one (its own draws,
      // casters only: out of view they still cast, their shadow may fall into view)
      if (seen) nDrawn++;
      if (seenM) {
        const far = (lodM === 2 || !c.vbuf) && c.fbuf;
        const vb = far ? c.fbuf! : c.vbuf, vn = far ? c.fn : c.n;
        if (vb && vn) { out.push({ program: p, blocks, textures, vertices: vb, count: vn, pickProgram: () => p, bounds: meshes }); vDrawn += vn; }
        if (c.parts && !far) this.partDraws(c.parts, out, { blocks, textures, bounds: meshes }, false, MESH_FLOATS);
      }
      if (cast) {
        const vb = c.fbuf ?? c.vbuf, vn = c.fbuf ? c.fn : c.n;
        if (vb && vn) out.push({ program: p, blocks, textures, vertices: vb, count: vn, pickProgram: () => p, cast, bounds: meshes, shadowOnly: true });
      }
      // its instance sets: each drawn with its form's in every chunk (its group's lists, made again only when a set's
      // level, or whether it is drawn or casts, changed): here only how each is drawn now
      const casts = !!sun && inView(sun, square);
      for (const x of c.inst) {
        const G = x.group!;
        // a sized set: each clone its level (sorted when the eye has moved past the set's gate); else the chunk's for all
        if (seenI && sets) x.lodNow = lod;
        if (sets && (seenI || casts) && G.sized) this.levelsOf(x, c, cam, dist);
        const L = !G.sized ? lod : x.far ? 2 : x.lv ? 3 : x.lodNow, drawn = seenI && sets ? L : -1, casting = casts ? L : -1;
        if (drawn !== x.drawn || (drawn === 3 && x.drawnAt !== x.sorts)) { x.drawn = drawn; x.drawnAt = x.sorts; G.dirty = true; }
        if (casting !== x.cast || (casting === 3 && x.castAt !== x.sorts)) { x.cast = casting; x.castAt = x.sorts; G.castDirty = true; }
        if (drawn >= 0) {
          growBox(G.box, square);
          // its parts change by themselves (joints turning; copies over time, a clock-reading material at a level it
          // draws): frames by how far it is
          if (G.moving || G.clocky) {
            const levels = drawn < 3 ? 1 << drawn : (x.counts[0]! ? 1 : 0) | (x.counts[1]! ? 2 : 0) | (x.counts[2]! ? 4 : 0);
            if ((G.moving && levels & 3) || levels & G.clocky) this.clockAt = Math.min(this.clockAt, awayFrom(this.eyeXZ, square));
          }
        }
        if (casting >= 0) growBox(G.castBox, square);
      }
    }
    if (this.groups.size) this.syncTiles();
    // each form's draws: one a level for its clones in every chunk (and, casting, one for the simple level, one far)
    const recs = this.recTex, pi = this.progI!, lb = recs && this.groups.size ? this.layerBlock(ex, hv, lit) : null;
    if (recs && lb) for (const G of this.groups.values()) {
      if (G.dirty) { this.listsOf(G, false); G.dirty = false; }
      if (sun && G.castDirty) { this.listsOf(G, true); G.castDirty = false; }
      const itex = [this.groundTex, shadow, tints, G.pic ? this.pictureOf(G.pic) : this.noPicture(), recs], ib = [ctx.frame, lb, G.sbuf], px = this.setProgram(G) ?? pi;
      for (let L = 0; L < 3; L++) {
        const li = G.lists[L]!; if (!li.n || !li.buf) continue;
        const sh = this.levelAt(G.shapes, L); if (!sh) continue;
        if (sh.imp) { const d = this.impostorCall(sh.imp, ib, itex, G.box, li.buf, li.n); if (d) { out.push(d); vDrawn += 6 * li.n; } continue; }
        if (sh.nv) out.push({ program: px, blocks: ib, textures: itex, instances: li.buf, vertices: sh.buf, count: sh.nv, instanceCount: li.n, pickProgram: () => px, bounds: G.box });
        if (sh.parts) this.partDraws(sh.parts, out, { blocks: ib, textures: itex, instances: li.buf, instanceCount: li.n, bounds: G.box }, true, SHAPE_FLOATS);
        vDrawn += sh.nv * li.n;
      }
      if (sun) for (let C = 0; C < 2; C++) {
        const li = G.casts[C]!; if (!li.n || !li.buf) continue;
        const sh = this.levelAt(G.shapes, C === 0 ? 1 : G.shapes.length - 1); if (!sh) continue;
        if (sh.imp) { const d = this.impostorCall(sh.imp, ib, itex, G.castBox, li.buf, li.n); if (d) out.push({ ...d, cast, shadowOnly: true }); continue; }
        if (sh.nv) out.push({ program: px, blocks: ib, textures: itex, instances: li.buf, vertices: sh.buf, count: sh.nv, instanceCount: li.n, pickProgram: () => px, cast, bounds: G.castBox, shadowOnly: true });
      }
    }
    this.drawn = { chunks: nDrawn, vertices: vDrawn };
    if (this.late.length) { out.push(...this.late); this.late = []; }
    return out;
  }
  /** the block every instance draw binds: what all the layer's chunks share (its place is each chunk's tile) */
  private layerBlock(ex: number, hv: readonly number[] | null, lit: number): GBuffer {
    const t = this.lt; t[4] = ex; t[5] = this.pickNo; t[6] = -1; t[7] = 1; t[8] = hv ? hv[0]! : 1; t[9] = hv ? hv[1]! : 1; t[10] = hv ? hv[2]! : 1; t[12] = lit; t[13] = this.props.windows?.interior ? 1 : 0;
    const b = (this.lbuf ??= this.g!.buffer('uniform', 16 * 4, `${this.id} layer block`));
    let same = true; for (let i = 0; i < 16; i++) if (t[i] !== this.ltw[i]) { same = false; this.ltw[i] = t[i]!; }
    if (!same) b.write(t);
    return b;
  }
  /** a group's levels whose pieces change by themselves (copies over time; a material that reads the clock): bits */
  private clockyOf(G: Group): number {
    let m = 0;
    for (let L = 0; L < 3; L++) { const p = this.levelAt(G.shapes, L)?.parts; if (p && (p.emit || p.custom.some((q) => customOf(q.code)?.animated))) m |= 1 << L; }
    return m;
  }
  /** a level by the pixels a thing of this radius covers at this distance (its nearest in the chunk) */
  private lodByPixels(radius: number, dist: number, cam: FrameContext['camera'], range: SizeUnits | null = null): number {
    const h = Math.max(1, cam.eye[1]! - cam.groundY), d = Math.hypot(dist, h), px0 = (radius * 2 * cam.height) / (2 * Math.tan(cam.fov / 2) * d), px = range ? Math.min(range[2], Math.max(range[1], px0)) : px0;
    const [full, simple, mg] = this.edges();
    // (sure only past the margin: below the far edge by it, every instance of the set is far)
    return px * mg > full ? 0 : px * mg > simple ? 1 : 2;
  }
  /** the pixel edges of the levels (whole, simple) with the governor's detail, and 1 + the margin */
  private edges(): [number, number, number] {
    const o = this.props.pixels ?? {}, dl = Math.max(0.25, Math.min(1, this.detailSeen));
    return [(o.full ?? 120) / dl, (o.simple ?? 25) / dl, 1 + (o.margin ?? LEVEL_MARGIN)];
  }
  private detailSeen = 1;
  /** this frame's sorts by level: the sets sorted again and the main thread's ms in them (the measures read it) */
  readonly sortStats = { sets: 0, ms: 0 };
  /** instances that changed level since the start (an acrobatic camera's flips show here: the measures read it) */
  levelChanges = 0;
  /** a set whose joints follow your formulas: its own instances' program (made once per formulas; until it is built,
   *  none: the layer's own draws it, its parts still) */
  private formulaProgs = new Map<string, Program>();
  private setProgram(x: { formula: string; joints: SetJoint[] }): Program | null {
    if (!x.formula || !this.g) return null;
    let p = this.formulaProgs.get(x.formula);
    if (!p) {
      const src = { wgsl: SOLID_INST_WGSL, glsl: SOLID_INST_GLSL.vertex }, code = jointFormulas(x.joints, `solids '${this.id}'`);
      const textures = [{ name: 'ground', kind: '2d-array' as const, sample: 'unfilterable' as const }, { name: 'shadowMap', kind: '2d' as const, sample: 'float' as const }, { name: 'tints', kind: '2d' as const, sample: 'float' as const }, { name: 'picture', kind: '2d' as const, sample: 'float' as const }, REC_TEX];
      p = this.g.program({ label: `solids ${this.id} instances (formulas)`, wgsl: src.wgsl.replace('/*@jointFormula*/', code.wgsl), glsl: { vertex: src.glsl.replace('/*@jointFormula*/', code.glsl), fragment: SOLID_INST_GLSL.fragment }, blocks: ['Frame', 'T', 'S'], textures, instance: INST_LAYOUT,
        vertex: { stride: SHAPE_FLOATS, attributes: [{ name: 'v', location: 3, size: 4, offset: 0 }, { name: 'vc', location: 4, size: 1, offset: 4 }, { name: 'card', location: 5, size: 1, offset: 5 }] }, depth: { write: true, test: 'less' }, cull: 'none' });
      const key = x.formula;
      p.ready.then(() => { this.formulaReady.add(key); (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); }, (e) => this.attached?.world.error(e));
      this.formulaProgs.set(x.formula, p);
    }
    return this.formulaReady.has(x.formula) ? p : null;
  }
  private formulaReady = new Set<string>();
  /** the level for a distance: an impostor not baked yet gives way to the level before it */
  private levelAt(shapes: (Level | null)[], lod: number): Level | null {
    for (let k = Math.min(lod, shapes.length - 1); k >= 0; k--) { const sh = shapes[k]; if (!sh) return null; if (!sh.imp || (sh.imp.baked && this.impReady)) return sh; }
    return null;
  }
  private impostorCall(imp: Imp, blocks: GBuffer[], textures: GTexture[], bounds: readonly number[], buf: GBuffer, n: number): DrawCall | null {
    const p = this.progImp; if (!p || !imp.baked || !imp.block) return null;
    return { program: p, blocks: [...blocks, imp.block], textures: [...textures, imp.baked.color, imp.baked.normals], instances: buf, count: 6, instanceCount: n, pickProgram: () => p, bounds };
  }
  /** a sized set's levels: all far (even its nearest one is small on screen): one draw; else each clone at its level,
   *  sorted again when the eye has moved past the set's gate. The eye is captured when the gate passes and the sort is
   *  done against that eye, a slice a frame within the frame's budget (SORT_MS, shared by every solids layer): the
   *  levels never depend on which frame does the work, nor a fast flight's frame on how many sets it moves */
  private levelsOf(x: Inst, c: Chunk, cam: FrameContext['camera'], dist: number): void {
    const nearest = this.lodByPixels(x.radius * 1.6, dist, cam, x.range);
    // all far: every clone at the far level (sorted again from there once one is not: its margin from the far level)
    if (nearest === 2) { if (!x.far) { x.far = true; x.job = null; x.eye = null; if (x.lv) { x.lv.fill(2); x.counts = [0, 0, x.ni]; x.sorts++; } } return; }
    x.far = false;
    const t = c.t, ex = (cam.eye[0]! - t[0]!) / t[2]!, ez = (cam.eye[2]! - t[1]!) / t[3]!, eh = cam.eye[1]! - cam.groundY;
    // the gate: the eye moved past it since the eye of the last sort (begun or done): this eye captured, a sort begun
    if (!x.job && (!x.eye || Math.hypot(ex - x.eye[0], ez - x.eye[1], eh - x.eye[2]) > Math.max(3, eh * 0.05))) {
      x.eye = [ex, ez, eh];
      x.job = { eye: [ex, ez, eh], k: (x.radius * 2 * cam.height) / (2 * Math.tan(cam.fov / 2)), edges: this.edges(), next: 0, lv: new Uint8Array(x.ni), counts: [0, 0, 0] };
    }
    // (before its first sort: every clone at the chunk's level by distance, never none)
    if (x.job) this.sortStep(x);
  }
  /** a slice of a set's sort (its clones from `next`) within what is left of the frame's budget; done, its levels
   *  swapped in at once (its group lists its clones again: their records stay where they are) */
  private sortStep(x: Inst): void {
    const job = x.job!, t0 = performance.now(), frame = this.clockMs;
    if (sortFrame !== frame) { sortFrame = frame; sortSpent = 0; }
    // (a set not sorted yet is drawn at its chunk's level by distance meanwhile: never none)
    if (sortSpent >= SORT_MS) return;
    const [ex, ez, eh] = job.eye, k = job.k, [full, simple, mg] = job.edges, d = x.rec, F = x.R * RECORD_FLOATS, n0 = x.ni, rg = x.range, prev = x.lv && x.lv.length === n0 ? x.lv : null, lv = job.lv;
    let j = job.next;
    for (; j < n0; j++) {
      if ((j & 127) === 0 && j > job.next && sortSpent + performance.now() - t0 >= SORT_MS) break;
      const i = j * F, dx = d[i]! - ex, dz = d[i + 1]! - ez, dy = eh - d[i + 2]!, s = Math.max(d[i + 4]!, d[i + 5]!), lim = k * s;
      // the pixels it covers (as shown: within its set's range), its level kept until past an edge by the margin
      const px0 = lim / Math.sqrt(Math.max(dx * dx + dz * dz + dy * dy, 1e-6)), px = rg ? Math.min(rg[2], Math.max(rg[1], px0)) : px0;
      const L = keptLevel(px, prev ? prev[j]! : -1, full, simple, mg, false);
      lv[j] = L; job.counts[L]!++;
    }
    job.next = j;
    // done: its levels swapped in, within the budget too (else next frame)
    if (j >= n0 && sortSpent + performance.now() - t0 < SORT_MS) {
      if (prev) for (let q = 0; q < n0; q++) if (prev[q] !== lv[q]) this.levelChanges++;
      x.lv = lv; x.counts = job.counts; x.job = null; x.sorts++;
      this.sortStats.sets++;
    }
    const spent = performance.now() - t0; sortSpent += spent; this.sortStats.ms += spent;
  }
  /** tint the solids by id: your function gives each thing's colour and how much (0..1), or null for its own; null
   *  ends the tint (an analysis view: houses by their walk to a park, everything else quiet) */
  tint(fn: ((info: SolidInfo, chunk: string, id: number) => readonly [number, number, number, number] | null) | null): this {
    this.tintFn = fn; this.tintPx.clear();
    (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.();
    return this;
  }
  /** what a subclass's own programs bind like the solids' (the graphics; the ground grids, this frame's shadow map, no
   *  tint): null before the layer is attached */
  protected solidsBase(ctx: FrameContext): { g: Graphics; textures: GTexture[] } | null {
    const g = this.g; if (!g || !this.groundTex) return null;
    return { g, textures: [this.groundTex, ctx.shadowMap!, this.noTintTex(), this.noPicture()] };
  }
  // ── the imagery material's pictures: a chunk's square from above, made when it has such pieces ──────────────────
  private noPic: GTexture | null = null; private pics = new Map<string, GTexture | 'loading' | 'none'>();
  private noPicture(): GTexture { const g = this.g!; return (this.noPic ??= (() => { const t = g.texture({ label: 'no picture', width: 1, height: 1, format: 'rgba8', filter: 'nearest' }); t.write(new Uint8Array(4)); return t; })()); }
  private pictureOf(c: Chunk): GTexture {
    const im = this.props.imagery; if (!im) return this.noPicture();
    const p = this.pics.get(c.key);
    if (p && p !== 'loading' && p !== 'none') return p;
    if (!p) {
      // pay only for what is there: a chunk without imagery pieces gets none
      const m = c.spec.mesh instanceof Float32Array ? c.spec.mesh : null; let has = false;
      if (m) for (let i = 0; i < m.length / MESH_FLOATS; i += 3) if (meshCode(m, i) === MATERIAL_CODES.imagery) { has = true; break; }
      if (!has) for (const x of c.spec.instances ?? []) for (const sh of Array.isArray(x.shape) ? x.shape : [x.shape]) if (sh instanceof Float32Array) for (let i = 0; i < sh.length / SHAPE_FLOATS && !has; i += 3) if (shapeCode(sh, i) === MATERIAL_CODES.imagery) has = true;
      this.pics.set(c.key, has ? 'loading' : 'none');
      if (has) void this.paint(c, im).then((t) => { if (this.chunks.get(c.key) === c && t) { this.pics.set(c.key, t); (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); } else t?.destroy(); }, (e: unknown) => { this.pics.set(c.key, 'none'); this.attached?.world.error(e); });
    }
    return this.noPicture();
  }
  /** a chunk's square drawn from the source's tiles at its zoom (each tile's part of it placed by its bounds) */
  private async paint(c: Chunk, im: NonNullable<SolidsProps['imagery']>): Promise<GTexture | null> {
    if (typeof OffscreenCanvas === 'undefined' || !this.g || !this.attached) return null;
    const side = Math.min(500, c.spec.side ?? 500), size = im.size ?? 512, z = Math.max(im.source.minZoom, Math.min(im.source.maxZoom, im.zoom ?? 17));
    const kx = kxOf(c.corner[1]), w = c.corner[0], n = c.corner[1], e = w + side / kx, s0 = n - side / KZ;
    const canvas = new OffscreenCanvas(size, size), g2 = canvas.getContext('2d'); if (!g2) return null;
    const [x0, y0] = tileOf(w, n, z), [x1, y1] = tileOf(e, s0, z), tile = new OffscreenCanvas(256, 256), tg = tile.getContext('2d', { willReadFrequently: false })!;
    for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
      tg.clearRect(0, 0, 256, 256);
      if (!(await im.source.draw(tg, { z, x: tx, y: ty }, { loader: this.attached.loader, priority: 'later', prefetch: false }))) continue;
      const b = tileBBox(z, tx, ty), px = (lon: number) => ((lon - w) / (e - w)) * size, py = (lat: number) => ((n - lat) / (n - s0)) * size;
      g2.drawImage(tile, px(b[0]), py(b[3]), px(b[2]) - px(b[0]), py(b[1]) - py(b[3]));
    }
    if (!this.g) return null;
    const t = this.g.texture({ label: `${this.id} ${c.key} picture`, width: size, height: size, format: 'rgba8', filter: 'linear' });
    t.writeImage(canvas);
    return t;
  }
  /** the tints' texture this frame: none set (no analysis, nothing selected), the shared empty one (every chunk's first
   *  row −1: none read); else every tinted chunk's rows in one (an analysis tints every chunk, the selected their own):
   *  a chunk's made again in its rows, a new one after the last, all of them packed again only when it is full */
  private syncTints(): GTexture {
    const g = this.g!;
    if (!this.tintFn && !this.selBy.size) {
      if (this.tintAtlas || this.tintPx.size) { this.tintAtlas?.destroy(); this.tintAtlas = null; this.tintPx.clear(); this.tintRows = 0; this.tintTop = 0; }
      for (const c of this.chunks.values()) c.tintRow = -1;
      return this.noTintTex();
    }
    const made: Chunk[] = []; let pack = !this.tintAtlas;
    for (const c of this.chunks.values()) {
      if (!this.tintFn && !this.selBy.has(c.key)) { this.tintPx.delete(c.key); c.tintRow = -1; continue; }
      const old = this.tintPx.get(c.key); if (old) continue;
      const px = this.tintPixels(c); this.tintPx.set(c.key, px); made.push(c);
      // (in its rows when as many as before; else after the last, when there is room)
      const rows = px.length / 1024;
      if (c.tintRow >= 0 && c.tintRows === rows) continue;
      if (this.tintTop + rows <= this.tintRows) { c.tintRow = this.tintTop; c.tintRows = rows; this.tintTop += rows; } else pack = true;
    }
    for (const k of [...this.tintPx.keys()]) if (!this.chunks.has(k)) this.tintPx.delete(k);
    if (pack) {
      let rows = 0; for (const px of this.tintPx.values()) rows += px.length / 1024;
      this.tintAtlas?.destroy(); this.tintRows = Math.max(1, Math.ceil(rows * 1.5)); this.tintTop = 0;
      this.tintAtlas = g.texture({ label: `${this.id} tints`, width: 256, height: this.tintRows, format: 'rgba8', filter: 'nearest' });
      for (const c of this.chunks.values()) {
        const px = this.tintPx.get(c.key); if (!px) { c.tintRow = -1; continue; }
        c.tintRow = this.tintTop; c.tintRows = px.length / 1024; this.tintTop += c.tintRows;
        this.tintAtlas.write(px, { y: c.tintRow, width: 256, height: c.tintRows });
      }
    } else for (const c of made) this.tintAtlas!.write(this.tintPx.get(c.key)!, { y: c.tintRow, width: 256, height: c.tintRows });
    return this.tintAtlas!;
  }
  private tintRows = 0; private tintTop = 0;
  /** the shared 'no tint' (1 × 1, nothing) */
  private noTintTex(): GTexture { const g = this.g!; return (this.noTint ??= (() => { const t = g.texture({ label: 'no tint', width: 1, height: 1, format: 'rgba8', filter: 'nearest' }); t.write(new Uint8Array(4)); return t; })()); }
  /** a chunk's tints: 256 ids a row, each your function's colour and how much, the selected over them */
  private tintPixels(c: Chunk): Uint8Array {
    const sel = this.selBy.get(c.key);
    let n = 0; while (c.spec.info?.(n)) n++;
    if (sel) for (const k of sel) n = Math.max(n, k + 1);
    const rows = Math.max(1, Math.ceil(n / 256)), px = new Uint8Array(256 * rows * 4);
    if (this.tintFn) for (let i = 0; i < n; i++) { const info = c.spec.info?.(i), v = info ? this.tintFn(info, c.key, i) : null; if (v) px.set([v[0] * 255, v[1] * 255, v[2] * 255, v[3] * 255], i * 4); }
    // the selected things over their tint, in the selected colour
    if (sel) { const sc = this.selLook!; for (const k of sel) px.set(sc, k * 4); }
    return px;
  }
  // ── the selected things' colour (core › interaction › signals › selection): a tint of their chunk's ──────────────
  /** the selection as last read, the selected things by chunk, their colour (rgba 0..255: the colour, the mix) */
  private selKey = ''; private selBy = new Map<string, Set<number>>(); private selLook: number[] | null = null;
  /** the selection read (s.user.selection: '<chunk>:<n>' ids; one the world knows came from another layer is not
   *  this layer's): the chunks whose selected things changed draw their tints again */
  private syncSelection(ctx: FrameContext): void {
    const o = this.props.selected, ids = ctx.s.user.selection;
    if (o === false || !ids.length) { if (this.selBy.size) { for (const k of this.selBy.keys()) this.tintPx.delete(k); this.selBy = new Map(); } this.selKey = ''; return; }
    const c = rgba(o?.color ?? '#38bdf8'), look = [c[0] * 255, c[1] * 255, c[2] * 255, Math.max(0, Math.min(1, o?.mix ?? 0.65)) * 255].map(Math.round), key = `${look.join(',')}|${ids.join('\u0001')}`;
    if (key === this.selKey) return;
    const restyled = this.selLook?.join(',') !== look.join(','); this.selKey = key; this.selLook = look;
    const by = new Map<string, Set<number>>(), wl = ctx.world;
    for (const id of ids) {
      const at = id.lastIndexOf(':'), n = Number(id.slice(at + 1)); if (at < 1 || !Number.isInteger(n) || n < 0) continue;
      const by0 = wl.selectedBy?.(id); if (by0 !== undefined && by0 !== this.id) continue;
      const ck = id.slice(0, at); let set = by.get(ck); if (!set) by.set(ck, (set = new Set())); set.add(n);
    }
    for (const k of new Set([...this.selBy.keys(), ...by.keys()])) {
      const a = this.selBy.get(k), b = by.get(k);
      if (restyled || !a || !b || a.size !== b.size || [...a].some((x) => !b.has(x))) this.tintPx.delete(k);
    }
    this.selBy = by;
  }
  /** chunks fading in (they change on screen by themselves for `fade` seconds) */
  protected fading(): boolean { const f = (this.props.fade ?? 0.25) * 1000; for (const c of this.chunks.values()) if (this.nowMs - c.born < f) return true; return false; }
  /** what the last frame drew of clock-reading materials wants (core › runtime › frame): near (within the first level's
   *  distance) every display frame, within the far one 30 a second, beyond it 10 (a far shimmer needs no more), none
   *  drawn 0 */
  protected clockRate(): number { const c = this.clockAt; if (c === Infinity) return 0; const [l1, l2] = this.props.lod ?? [350, 800]; return c < l1 ? Infinity : c < l2 ? 30 : 10; }
  /** a sort of levels under way (frames come until it is done) */
  protected sorting(): boolean { for (const c of this.chunks.values()) for (const x of c.inst) if (x.job) return true; return false; }
  override animating(_s?: State): boolean { return this.fading() || this.sorting() || this.groundWaits(); }
  /** a chunk waits for its ground to be read again (a slice of them a frame): frames until none does */
  private groundWaits(): boolean { const gv = this.attached?.world.groundVersion; for (const c of this.chunks.values()) if (c.groundRead !== gv && !c.spec.free) return true; return false; }
  /** frames (core › runtime › frame): every display frame while chunks fade in (or a subclass's animating() says so),
   *  its clock-reading materials by how far the nearest drawn is */
  override wantsFrames(s: State): number { return this.animating(s) ? Infinity : this.clockRate(); }
  override status(): ElementStatus {
    const st = super.status();
    if (this.shown <= 0 && this.target <= 0) return st;
    if (this.pending.size) st.pending.push(`${this.pending.size} chunk(s) waiting for the graphics`);
    const f = (this.props.fade ?? 0.25) * 1000, gv = this.attached?.world.groundVersion;
    for (const c of this.chunks.values()) { if (this.nowMs - c.born < f) { st.pending.push('chunks appearing'); break; } }
    for (const c of this.chunks.values()) { if (c.groundRead !== gv) { st.pending.push('reading the ground'); break; } }
    if (this.lazyWaiting > 0) st.pending.push(`${this.lazyWaiting} near chunk(s) building their whole mesh`);
    { let jobs = 0; for (const c of this.chunks.values()) for (const x of c.inst) if (x.job) jobs++; if (jobs) st.pending.push(`${jobs} instance set(s) choosing their levels`); }
    st.ready = !st.pending.length;
    return st;
  }
  override pickInfo(index: number): Omit<Picked, 'at' | 'x' | 'y'> | null {
    const slot = Math.floor(index / 65536), local = index % 65536;
    for (const c of this.chunks.values()) if (c.slot === slot) {
      const info = c.spec.info?.(local); if (!info) return null;
      const d: SolidPicked = { ...info, chunk: c.key, local };
      return { element: this.id, id: `${c.key}:${local}`, props: info.props, d, index };
    }
    return null;
  }
  override hovered(ids: Set<string> | null): void { this.hoverKey = ids && ids.size ? [...ids][0]! : null; }
  /** where a picked thing stands: an instance's place, turn and scale (its shape's size × its scale), or the middle of
   *  a mesh id's vertices on the ground (its whole mesh held: else null) */
  override placeOf(f: Picked): ThingPlace | null {
    const d = f.d as SolidPicked | undefined; if (!d || d.chunk === undefined) return null;
    const c = this.chunks.get(d.chunk); if (!c) return null;
    const kx = kxOf(c.spec.origin[1]), w = this.attached?.world, ex = w?.exaggeration ?? 1;
    const ll = (x: number, z: number): [number, number] => [c.spec.origin[0] + (c.spec.at[0] + x) / kx, c.spec.origin[1] - (c.spec.at[1] + z) / KZ];
    const ground = (lon: number, lat: number) => { const h = w?.heightAt(lon, lat) ?? 0; return Number.isNaN(h) ? 0 : h * ex; };
    for (const x of c.inst) {
      const a = x.rec, F = x.R * RECORD_FLOATS;
      for (let i = 0; i + F <= a.length; i += F) {
        if (a[i + 3] !== d.local) continue;
        const [lon, lat] = ll(a[i]!, a[i + 1]!), h = c.spec.free ? a[i + 2]! : ground(lon, lat) + a[i + 2]!;
        return { at: [lon, lat, h], turn: a[i + 7]!, scale: [a[i + 4]!, a[i + 5]!, a[i + 6]!], radius: x.radius > 0 ? x.radius * Math.max(a[i + 4]!, a[i + 6]!) : undefined };
      }
    }
    const m = c.spec.mesh instanceof Float32Array ? c.spec.mesh : c.spec.far;
    if (m) {
      let sx = 0, sz = 0, n = 0, x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
      for (let i = 0; i + MESH_FLOATS <= m.length; i += MESH_FLOATS) { if (m[i + 7]! % 65536 !== d.local) continue; const x = m[i]!, z = m[i + 2]!; sx += x; sz += z; n++; x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      if (n) { const [lon, lat] = ll(sx / n, sz / n); return { at: [lon, lat, ground(lon, lat)], turn: 0, scale: [1, 1, 1], radius: Math.hypot(x1 - x0, z1 - z0) / 2 }; }
    }
    return null;
  }
  /** chunks held, their mesh vertices and instances; what the last frame drew (chunks in view, vertices) */
  counts(): { chunks: number; vertices: number; instances: number; drawnChunks: number; drawnVertices: number } {
    let v = 0, i = 0; for (const c of this.chunks.values()) { v += c.n; for (const x of c.inst) i += x.ni; }
    return { chunks: this.chunks.size, vertices: v, instances: i, drawnChunks: this.drawn.chunks, drawnVertices: this.drawn.vertices };
  }
  override readouts() { return { chunks: () => this.chunks.size, levelChanges: () => this.levelChanges }; }
}
/** where a mesh reaches in its chunk's frame (m: least x, height, z, then most), joined to `e` (null: nothing yet) */
function extentOf(m: Float32Array | null | undefined, e: number[] | null): number[] | null {
  if (!m || m.length < MESH_FLOATS) return e;
  const o = e ?? [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 2 < m.length; i += MESH_FLOATS) {
    const x = m[i]!, y = m[i + 1]!, z = m[i + 2]!;
    if (x < o[0]!) o[0] = x; if (y < o[1]!) o[1] = y; if (z < o[2]!) o[2] = z; if (x > o[3]!) o[3] = x; if (y > o[4]!) o[4] = y; if (z > o[5]!) o[5] = z;
  }
  return o;
}
/** the tallest thing of a chunk over its ground: its mesh's heights, its instances' (scale y + height) */
function topOf(spec: SolidsChunk): number {
  let top = 0;
  const m = typeof spec.mesh === 'function' ? spec.far : spec.mesh; if (m) for (let i = 1; i < m.length; i += MESH_FLOATS) if (m[i]! > top) top = m[i]!;
  for (const x of spec.instances ?? []) for (const [, , h, sy] of placesOf(x)) { const t = h + sy * 1.4; if (t > top) top = t; }
  return top;
}
/** each clone of a set (its numbers or its records): its place in the chunk (x, z, height) and its height's scale */
function* placesOf(x: SolidsSet): Generator<[number, number, number, number]> {
  const d = x.records ?? x.data; if (!d) return;
  const F = x.records ? Math.max(RECORD, x.stride ?? RECORD) * RECORD_FLOATS : INSTANCE_FLOATS;
  for (let i = 0; i + F <= d.length; i += F) yield [d[i]!, d[i + 1]!, d[i + 2]!, d[i + 5]!];
}
/** an instance set's draws: each clone its record's first texel in the layer's records (the record holds the rest) */
const INST_LAYOUT = { stride: 1, attributes: [{ name: 'r', location: 0, size: 1 as const, offset: 0 }] };
/** the records' texture (the instance programs' fifth) */
const REC_TEX = { name: 'recs', kind: '2d' as const, sample: 'unfilterable' as const };
/** a set's formulas as the instance shader's jointFormula: joint k's statements setting \`value\` (degrees, or a slider's
 *  metres) of \`time\` (s) and \`seed\` (0..1), in the WGSL subset and translated for GLSL */
export function jointFormulas(joints: readonly SetJoint[], where: string): { wgsl: string; glsl: string } {
  let wgsl = '', glsl = '';
  joints.forEach((j, k) => {
    if (!j.formula) return;
    const t = translateStatements(j.formula, { values: { value: { type: 'f32', mutable: true }, time: { type: 'f32' }, seed: { type: 'f32' } } } as never, { where: `${where} joint ${k}` });
    wgsl += `if (k == ${k}) {\n    var value = 0.0;\n    ${j.formula}\n    return value;\n  }\n  `;
    glsl += `if (k == ${k}) {\n    float value = 0.0;\n    ${t.glsl.trim()}\n    return value;\n  }\n  `;
  });
  return { wgsl, glsl };
}
/** INSTANCE_FLOATS numbers each (x, z, height, id · scale x, y, z, turn · colour, its leaf share) into records of R texels:
 *  the same, a seed from its id and its chunk's slot (no group colours, no joints' rates) */
function legacyInto(d: Float32Array, rec: Float32Array, R: number, slot: number): void {
  const n = Math.min(Math.floor(d.length / INSTANCE_FLOATS), Math.floor(rec.length / (R * RECORD_FLOATS)));
  for (let i = 0; i < n; i++) {
    const a = i * INSTANCE_FLOATS, o = i * R * RECORD_FLOATS;
    for (let k = 0; k < 10; k++) rec[o + k] = d[a + k]!;
    rec[o + 10] = ((d[a + 3]! * 0.6180339887) % 1 + 1) % 1; rec[o + 11] = slot;
    for (let k = RECORD * RECORD_FLOATS; k < R * RECORD_FLOATS; k++) rec[o + k] = R > RECORD ? -1 : 0;
  }
}
/** ms of the main thread a frame the levels' sorts may take (every solids layer's together); the frame they share */
export const SORT_MS = 1.5;
let sortFrame = -1, sortSpent = 0;
/** the share of an edge a level is kept past it (core › runtime › detail: a size on screen's hysteresis) */
export const LEVEL_MARGIN = 0.2;
/** a level (0 whole, 1 simple, 2 far) kept within a margin: by pixels (more is finer: v > a whole, v > b simple) or by
 *  distance (less is finer: v < a whole, v < b simple); the level before (−1: none) stays until v is past the edge by
 *  the margin (mg = 1 + margin): the levels sure at v / mg and v × mg bound it */
export function keptLevel(v: number, prev: number, a: number, b: number, mg: number, byDistance: boolean): number {
  const at = (x: number) => (byDistance ? (x < a ? 0 : x < b ? 1 : 2) : x > a ? 0 : x > b ? 1 : 2);
  if (prev < 0) return at(v);
  // the finest level it could be within the margin (lo) and the coarsest (hi): the level before kept between them
  const lo = byDistance ? at(v / mg) : at(v * mg), hi = byDistance ? at(v * mg) : at(v / mg);
  return Math.min(Math.max(prev, lo), hi);
}
/** solids made by code, in 500 m chunks on the ground: lit, shadowed, picked by id */
export const solids = (p: SolidsProps = {}) => new Solids(p);
/** how far a box is from the eye on the ground (m): 0 inside it; no box: 0 */
function awayFrom(eye: readonly [number, number], b: readonly number[] | undefined): number { return b ? Math.hypot(Math.max(b[0]! - eye[0], 0, eye[0] - b[3]!), Math.max(b[2]! - eye[1], 0, eye[1] - b[5]!)) : 0; }
/** a box made empty, a box grown to take another (world m: least x, y, z, then most) */
function emptyBox(b: Bounds): void { b[0] = b[1] = b[2] = Infinity; b[3] = b[4] = b[5] = -Infinity; }
function growBox(b: Bounds, o: Bounds): void { for (let i = 0; i < 3; i++) { if (o[i]! < b[i]!) b[i] = o[i]!; if (o[i + 3]! > b[i + 3]!) b[i + 3] = o[i + 3]!; } }
/** a level's number (a shape's level on the chip, an impostor: the same for every set that draws it; none: 0) */
const LEVEL_NOS = new WeakMap<object, number>();
let levelNos = 0;
function levelNo(l: Level | null): number {
  const o = l ? l.imp ?? l : null; if (!o) return 0;
  let n = LEVEL_NOS.get(o); if (n === undefined) LEVEL_NOS.set(o, (n = ++levelNos));
  return n;
}
/** an instance set's block as its group's key: all of it but its clock's start, its joints' offsets (its group's) and
 *  the governor's detail (the layer's) */
function blockKey(S: Float32Array): string {
  let k = '';
  for (let i = 0; i < S.length; i++) { if (i === 8 || i === 12 || (i >= 16 && i < 16 + 32 * 4 && (i - 16) % 16 === 14)) continue; k += `${S[i]},`; }
  return k;
}
/** whether a set's levels have pieces that show the imagery (its chunk's picture: drawn apart) */
const IMAGERY = new WeakMap<Float32Array, boolean>();
function hasImagery(levels: readonly (Float32Array | ImpostorLevel | null)[]): boolean {
  return levels.some((sh) => {
    if (!(sh instanceof Float32Array)) return false;
    let v = IMAGERY.get(sh);
    if (v === undefined) { v = false; for (let i = 0; i < sh.length / SHAPE_FLOATS; i += 3) if (shapeCode(sh, i) === MATERIAL_CODES.imagery) { v = true; break; } IMAGERY.set(sh, v); }
    return v;
  });
}
