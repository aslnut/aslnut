// core › geometry › marks › features: what every mark drawn from features shares (line, area, extrusion; points
// and text take the same props). Data is an array or a source (data.geojson …, rows, a join, a query, a stream);
// every feature keeps a stable id. Shapes are built once per shape change; numbers (a query's answer) only restyle,
// at once (or eased on the chip, when asked). Per feature, on the graphics chip: its colour (and the one before),
// hovered / selected, its reveal progress, shown (feature.when, filter), its numbers, its middle and size, its motion.
// Only what differs between features takes room there: a prop the same for every feature is a uniform (pay only for
// what you set). Picking reads the same features back. Everything is a prop; every prop a constant, a function of the
// feature, or a scale.
//   area({ id: 'crime', data: suburbs.join(rows, { on: 'code' }), color: scale.quantile(d => d.props.rate),
//          hover: { color: '#fff', mix: .35, outline: 3 }, tooltip: d => d.props.name, reveal: 'wipe' })
import type { Feature, Geometry } from '../../data/features.ts';
import { bboxOf } from '../../data/features.ts';
import { Source, type SourceContext } from '../../data/sources/source.ts';
import { AslnutError } from '../../world/errors.ts';
import { Element, type AttachContext, type FormVisual, type FrameContext, type ElementProps, type ElementStatus, type Picked } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import { gateValue, readsOf, tracked } from '../../observation/presence.ts';
import type { DrawCall, GBuffer, GroundDraw, GTexture, Graphics, Program, ProgramDesc } from '../../render/graphics/interface.ts';
import { paramBlock, type ShaderCode } from '../../render/graphics/shaders/hooks.ts';
import { plan, progress, reveal as reveals, type ModeName, type Plan, type RevealSpec } from '../../render/reveal/index.ts';
import { rgba, type Color, type RGBA } from '../../render/style/color.ts';
import { isScale } from '../scales.ts';
import { stepFor, Origin, relMetres } from '../../geometry/build/mesh.ts';
import { DRAPE_DEFAULTS, drapeOf, GROUND_WITHIN, type DrapeMark, type DrapeMode } from './drape.ts';
import { Join, type JoinCounts } from '../join.ts';
import { PX, type SizeUnits } from '../../render/drawing/size.ts';
import type { Leveled } from '../../observation/presence.ts';

export type Data<D> = readonly D[] | Source<never> | Source<any>;   // eslint-disable-line @typescript-eslint/no-explicit-any
export type PerFeature<T, D> = T | ((d: D, s: State) => T);
/** a look for hovered or selected features */
export interface Look extends FormVisual { color?: Color; /** how much of `color` (0..1, default .45) */ mix?: number; /** outline px (areas, lines: wider) */ outline?: number; /** metres up */ raise?: number; /** the pointer over it */ cursor?: string }
/** keep features where: a function, or props to match ({ type: 'school' } · { type: ['a', 'b'] } · { pop: { min: 1000 } }) */
export type Filter<D> = ((d: D, s: State) => boolean) | Record<string, unknown>;
export interface FeatureMarkProps<D> extends ElementProps {
  data: Data<D>;
  /** where it stands: on the terrain (default), at sea level, or at the heights given */
  on?: 'ground' | 'sea' | 'absolute';
  /** metres over where it stands */
  lift?: number;
  /** where it sits with the twin's terrain, buildings and trees (core › geometry › marks › drape):
   *  'ground' on the terrain and the twin's ground (roads, paths): the buildings and trees stand on it · 'over' painted
   *  onto everything under it (terrain, roofs, tree crowns) · 'above' floating over everything, never hidden · true or
   *  unset: the mark's own default (DRAPE_DEFAULTS: areas 'over', lines 'ground', points, labels and arcs 'above') ·
   *  false: each vertex at the ground's height plus `lift`, hidden by what is in front (a route floating over streets) */
  drape?: boolean | DrapeMode;
  opacity?: number;
  /** each feature's own gate (`when`), and its own order in the layer (`order`: higher drawn over lower, the data's
   *  order between equals; core › encoding › layers › stack) */
  feature?: { when?: (d: D, s: State) => boolean | number; order?: (d: D, s: State) => number };
  filter?: Filter<D> | null;
  reveal?: RevealSpec | ModeName;
  hover?: Look | false;
  selected?: Look | false;
  /** light up a whole group (all suburbs of one district) instead of one feature */
  hoverGroup?: (d: D) => unknown;
  tooltip?: (d: D, s: State) => string | null | undefined;
  onHover?: (f: Picked<D> | null, s: State) => void;
  onTap?: (f: Picked<D>, s: State) => void;
  /** tapping selects (or toggles) the feature */
  select?: 'tap' | 'toggle' | false;
  /** in the picking pass (default true) */
  pickable?: boolean;
  /** metres: the longest edge before it is split to follow the terrain (default from the data's size) */
  detail?: { step?: number };
  /** pixels it is drawn in front of the ground under it */
  depthBias?: number;
  /** seconds a restyle (new colours or numbers: a scale's new domain, a query's answer, a new colour prop) eases from
   *  the look before, on the chip. Default: `transition` when you set one, else 0: a data-driven restyle shows in
   *  the next frame, as a chart does (an ease costs a frame of the whole world each display frame it plays) */
  restyle?: number;
  /** draped on the ground, how: 'tiles' (drawn into the ground's tiles: one pass, nothing per frame while it holds
   *  still), 'prisms' (each piece over the frame: one face per piece on level ground), or 'auto' (the default: the
   *  world's `groundMarks` when you chose one; else into the tiles only where they pay: the ground under the layer
   *  has relief and the mark holds still (a trail's clock, flowing dashes or a pulse would draw every tile under it
   *  again each frame)) */
  groundMarks?: 'tiles' | 'prisms' | 'auto';
  /** how it mixes with what is under it (default 'alpha'); 'multiply' darkens, 'screen' lightens, 'add' glows */
  blend?: 'alpha' | 'add' | 'multiply' | 'screen';
}
/** a feature as a mark keeps it: its id and key, the datum your functions get, its shape, its slot (`index`: its row on
 *  the chip, kept while it is in the data: core › encoding › join) and when it was born */
export interface Entry<D> { id: string | number; key: string; d: D; geometry: Geometry | null; cuts?: Uint8Array[][]; index: number; born: number }
export interface Styled {
  color: RGBA; /** the mark's number: line width px, area height m, extrusion height m */ number: number; value: number;
  /** the mark's second number (the numbers' fourth: a point's outline px; an extrusion writes its base there itself) */
  base?: number;
  /** the mark's own four values (plane 6: a point's outline colour, a line's dashes); unset: the mark has none */
  extra?: RGBA;
}

export const FW = 512, PLANES = 7;
/** floats in the layer block (L): see feature.wgsl.ts */
export const LFLOATS = 72;
/** the planes of the features texture: colour, colour before, state, numbers, centre and half size, motion, the mark's own */
export const P_COLOR = 0, P_BEFORE = 1, P_STATE = 2, P_NUMBERS = 3, P_BOX = 4, P_MOTION = 5, P_EXTRA = 6;
/** ms between two drawings of the ground's tiles while a layer on them fades or restyles */
const FADE_STEP = 80;
const HOVER: Look = { color: '#ffffff', mix: 0.45 };
/** the props the features' states come from (the rest only restyle) */
const STATE_PROPS = new Set(['data', 'feature', 'filter', 'reveal', 'hover', 'selected', 'hoverGroup', 'select', 'when', 'transition']);
/** the props that are uniforms or the draw order alone: changed in one frame, nothing styled or built again (core ›
 *  world › elements › props: showing, opacity and order) */
const UNIFORM_PROPS = new Set(['opacity', 'order', 'above', 'below', 'when', 'transition', 'label', 'lift', 'depthBias']);

/** a program and, on first need, its twin for the picking pass (the same code, no blending) */
export class Prog {
  main: Program; private pickP: Program | null = null; readonly desc: ProgramDesc; private g: Graphics;
  /** built (its frames draw it; settled waits for it), or failed (it never will) */
  ok = false; failed = false;
  constructor(g: Graphics, desc: ProgramDesc) { this.g = g; this.desc = desc; this.main = g.program(desc); this.main.ready.then(() => { this.ok = true; }, () => { this.failed = true; }); }
  get ready(): Promise<void> { return this.main.ready; }
  pick(): Program { return (this.pickP ??= this.g.program({ ...this.desc, label: `${this.desc.label} pick`, blend: 'none' })); }
  destroy(): void { this.main.destroy(); this.pickP?.destroy(); this.pickP = null; }
}

/** a geometry's box grown into b (w, s, e, n): plain loops, nothing made per point */
export function extendBox(g: Geometry | null, b: [number, number, number, number]): void {
  if (!g) return;
  const pts = (r: readonly (readonly number[])[]) => {
    let w = b[0], s = b[1], e = b[2], n = b[3];
    for (let i = 0; i < r.length; i++) { const p = r[i]!, x = p[0]!, y = p[1]!; if (x < w) w = x; if (x > e) e = x; if (y < s) s = y; if (y > n) n = y; }
    b[0] = w; b[1] = s; b[2] = e; b[3] = n;
  };
  switch (g.type) {
    case 'Point': { const x = g.coordinates[0], y = g.coordinates[1]; if (x < b[0]) b[0] = x; if (x > b[2]) b[2] = x; if (y < b[1]) b[1] = y; if (y > b[3]) b[3] = y; break; }
    case 'MultiPoint': case 'LineString': pts(g.coordinates); break;
    case 'MultiLineString': case 'Polygon': for (const r of g.coordinates) pts(r); break;
    case 'MultiPolygon': for (const p of g.coordinates) for (const r of p) pts(r); break;
  }
}
const matches = (v: unknown, rule: unknown): boolean => {
  if (Array.isArray(rule)) return rule.some((r) => matches(v, r));
  if (rule && typeof rule === 'object') { const r = rule as { min?: number; max?: number }; const x = Number(v); return (r.min === undefined || x >= r.min) && (r.max === undefined || x <= r.max); }
  return v === rule || (v !== undefined && v !== null && String(v) === String(rule));
};
export function keep<D>(f: Filter<D> | null | undefined, d: D, s: State): boolean {
  if (!f) return true;
  if (typeof f === 'function') return !!f(d, s);
  const props = ((d as Feature).props ?? d) as Record<string, unknown>;
  for (const [k, rule] of Object.entries(f)) if (!matches(props?.[k], rule)) return false;
  return true;
}

export abstract class FeatureMark<D, P extends FeatureMarkProps<D>> extends Element<P> {
  /** the mark, for its reveal modes */
  protected abstract readonly mark: string;
  /** the features now, in the data's order (each at its slot: `index`) */
  entries: Entry<D>[] = [];
  protected byKey = new Map<string, Entry<D>>();
  /** the features by slot (a slot a gone feature left: empty until taken again) */
  protected bySlot: (Entry<D> | undefined)[] = [];
  /** the features joined to the ones drawn, by id (core › encoding › join): each keeps its slot */
  protected join = new Join();
  /** what the last data change did: features new, changed, gone, stayed */
  get joined(): JoinCounts { return this.join.last; }
  protected origin = new Origin(0, 0);
  protected g: Graphics | null = null;
  protected feat: GTexture | null = null; protected featData = new Float32Array(0); protected rows = 0;
  protected L = new Float32Array(LFLOATS); protected lbuf: GBuffer | null = null; protected pbuf: GBuffer | null = null;
  /** the planes on the chip (bit k: plane k), each one's row block there (-1: not there, its value a uniform), the
   *  planes changed since last written, and the values of the planes that are the same for every feature */
  protected planes = 1 << P_STATE; private slots = new Int8Array(PLANES).fill(-1); private dirtyPlanes = 0; private k0 = new Float32Array(4); private k3 = new Float32Array(4); private k6 = new Float32Array(4);
  /** the planes this mark always keeps on the chip (the state; areas and extrusions their boxes, …) */
  protected planesWanted(): number { return 1 << P_STATE; }
  /** this mark's shaders read the features texture (labels read the features on the CPU: none made) */
  protected featureTexture = true;
  protected progs: Prog[] = [];
  protected step = 250;
  protected plan: Plan | null = null;
  private src: Source | null = null; private seen = { v: -1, sv: -1, arr: null as unknown, len: -1, scales: '' };
  protected mixT = 1; private mixFrom = 0; private hoverSet: Set<string> | null = null; private selKey = '\u0000'; private sel = new Set<string>();
  private building = false;
  /** when its newest feature was born (none revealing once the reveal's length has passed since) */
  private newest = -1e9;
  /** features that left the data, with their births (a feature coming back is not revealed again) */
  private left = new Map<string, number>();
  /** how many such features are remembered (the oldest forgotten first) */
  static rememberLeft = 5000;
  private groundSeen = -1; private groundTime = -1e9; private stateDirty = true; private stateWide = true; private born = false; private built = false;
  private sctx: SourceContext | null = null;
  private motionUsed = false;

  constructor(p: P) {
    super(p);
    const d = p.data as unknown;
    if (!(Array.isArray(d) || d instanceof Source)) throw new AslnutError('E-DATA-001', `${this.constructor.name.toLowerCase()} '${this.id}': data must be an array or a source`, { where: this.id, fix: "pass data: [...] or data.geojson('…')" });
    this.paramBlock ??= paramBlock({});
  }
  get source(): Source | null { return this.props.data instanceof Source ? this.props.data as Source : null; }
  override get fades(): boolean { return true; }
  /** the mark's kind for its place with the twin (its `drape`; null: it has none: a standing mark) */
  protected drapeMark(): DrapeMark | null { return null; }
  /** an older prop that says where it sits (a line's or an arc's `over`, a label's `occlude`), when `drape` is unset */
  protected legacySits(): DrapeMode | undefined { return undefined; }
  /** where it sits with the twin now: its own `drape`, an older prop, else its mark's default (core › geometry › marks ›
   *  drape); 'free': at heights of its own */
  override get sits(): DrapeMode | 'free' {
    const m = this.drapeMark(); if (!m) return 'free';
    const own = this.props.drape;
    if (own === undefined) return this.legacySits() ?? DRAPE_DEFAULTS[m];
    return drapeOf(own, m);
  }
  /** floating over everything (above): drawn after the buildings and shapes (4), under the points (5), unless placed */
  override get order(): number | undefined { const m = this.drapeMark(); return this.props.order ?? ((m === 'area' || m === 'line') && this.sits === 'above' ? 4.5 : undefined); }
  /** the data's credits (a joined source: its shapes' and its rows'), shown while the layer is */
  override attribution(): string[] {
    const s = this.source; if (!s) return [];
    const j = s as unknown as { shapes?: Source; rows?: Source };
    return (j.shapes || j.rows ? [j.shapes?.attribution, j.rows?.attribution] : [s.attribution]).filter((x): x is string => !!x);
  }

  // ── life ────────────────────────────────────────────────────────────────────────────────────────────────────
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    this.checkScales();
    this.sctx = { loader: ctx.loader, error: (e) => ctx.world.error(e) };
    this.src = this.source;
    // the data loads when the layer is first wanted (its `when`) or the view comes within a zoom of it (prepare), not
    // before: a layer for close zooms costs nothing on the globe
    if (!ctx.graphics) return;
    this.g = ctx.graphics;
    this.lbuf = ctx.graphics.buffer('uniform', LFLOATS * 4, `${this.id} layer`);
    this.pbuf = ctx.graphics.buffer('uniform', this.paramBlock!.size, `${this.id} params`);
    this.progs = this.programs(this.code());
    this.preparePrograms();
    await Promise.all(this.progs.map((p) => p.ready));
    // the picking twins too, now (in the background): never a compile in the middle of a gesture
    if (this.props.pickable !== false) for (const p of this.progs) p.pick();
  }
  /** the shader code: yours, with a defined reveal's shader line at the reveal hook */
  protected code(): ShaderCode {
    // the mode this context plays (an app: only one asked for an app; see reveal.plan)
    const r = this.props.reveal, video = this.attached?.world.context === 'video';
    const name = typeof r === 'string' ? (video ? r : undefined) : r ? (video ? r.video ?? r.mode : r.app) : undefined;
    const def = name ? reveals.get(String(name)) : undefined;
    return { ...(this.props.shader ?? {}), ...(def?.wgsl ? { reveal: def.wgsl } : {}) };
  }
  /** the mark's programs (built with your hooks) */
  protected abstract programs(code: ShaderCode): Prog[];
  /** swap your shader code (hot reload): the old programs stay if the new ones fail, and the error (with your line) is
   *  thrown */
  async setShader(code: ShaderCode): Promise<void> {
    const keep0 = this.props; this.props = { ...this.props, shader: code };
    if (!this.g) return;
    let next: Prog[] = [];
    try { next = this.programs(this.code()); await Promise.all(next.map((p) => p.ready)); } catch (e) { next.forEach((p) => p.destroy()); this.props = keep0; throw e; }
    this.progs.forEach((p) => p.destroy()); this.progs = next; this.preparePrograms();
  }
  override setProps(given: Partial<Leveled<P>>): this { const p = given as Partial<P>;
    const dataChanged = 'data' in p && p.data !== this.props.data, was = this.sits, wasDraped = this.draped;
    super.setProps(p);
    // a new place with the twin (its drape): its programs made again (draped or not, the part behind things or not), its
    // shapes built again when draping changed (pieces on the chip, or vertices at heights)
    if (this.sits !== was && this.g && this.progs.length) {
      this.progs.forEach((x) => x.destroy()); this.progs = this.programs(this.code()); this.preparePrograms();
      if (this.draped !== wasDraped) { this.freeGeometry(); this.built = false; this.building = false; this.seen.sv = -2; this.seen.v = -2; this.seen.arr = null; }
    }
    if (dataChanged) { this.src = this.source; this.seen.v = -2; }
    // showing, opacity and order are uniforms or the draw order: nothing styled again (a restyle reads every feature)
    if (Object.keys(p).some((k) => !UNIFORM_PROPS.has(k))) this.seen.scales = '\u0000';
    // the states (hovered, selected, revealed, shown) asked again only when a prop they come from changed: a new colour
    // restyles alone
    if (Object.keys(p).some((k) => STATE_PROPS.has(k))) { this.stateDirty = true; this.stateWide = true; }
    if ('reveal' in p) this.plan = null;
    return this;
  }
  override detach(): void {
    this.progs.forEach((p) => p.destroy()); this.progs = [];
    for (const r of [this.feat, this.lbuf, this.pbuf]) r?.destroy();
    this.feat = null; this.lbuf = this.pbuf = null; this.g = null;
    this.freeGeometry();
    // added again later (w.remove, then w.add of the same element: a shell's list), it starts over: its data read, its
    // shapes built and styled anew (as after letGo), its features revealed as new ones
    this.built = false; this.building = false; this.seen = { v: -1, sv: -1, arr: null, len: -1, scales: '' };
    this.join.clear(); this.entries = []; this.bySlot = []; this.byKey = new Map(); this.scalesRead = []; this.plan = null;
    this.featData = new Float32Array(0); this.rows = 0; this.layoutKey = -1; this.born = false; this.stateDirty = true; this.stateWide = true;
    super.detach();
  }
  protected abstract freeGeometry(): void;
  /** a level change hid it past the keep (core › observation › gates): its built shapes and features let go (its
   *  source keeps the data; the features' births remembered: back again, none is revealed from nothing) */
  override letGo(): void {
    for (const [k, e] of this.byKey) this.left.set(k, e.born);
    this.freeGeometry();
    this.built = false; this.building = false; this.seen = { v: -1, sv: -1, arr: null, len: -1, scales: '' };
    this.join.clear(); this.entries = []; this.bySlot = []; this.byKey = new Map();
    this.feat?.destroy(); this.feat = null; this.featData = new Float32Array(0); this.rows = 0; this.layoutKey = -1;
  }

  // ── data ────────────────────────────────────────────────────────────────────────────────────────────────────
  /** the features as entries: the datum your functions get, its id, its geometry */
  protected read(now: number): Entry<D>[] {
    const old = this.byKey, src = this.src, fresh = this.born ? now : -1e9, left = this.left;
    let newest = -1e9;
    // the features in the data's order: key, datum, shape
    type Item = { id: string | number; key: string; d: D; geometry: Geometry | null; cuts?: Uint8Array[][] };
    const items: Item[] = [];
    if (src) {
      const fs = src.features();
      for (let i = 0; i < fs.length; i++) { const f = fs[i]!; items.push({ id: f.id, key: String(f.id), d: f as unknown as D, geometry: f.geometry, cuts: f.cuts }); }
    } else {
      const arr = this.props.data as readonly D[];
      for (let i = 0; i < arr.length; i++) {
        const x = arr[i]!, o = x as unknown as { id?: string | number; at?: [number, number, number?]; geometry?: Geometry | null };
        const g = o.geometry !== undefined ? o.geometry : Array.isArray(o.at) ? { type: 'Point' as const, coordinates: [o.at[0], o.at[1]] as [number, number] } : null;
        const id = o.id ?? i; items.push({ id, key: String(id), d: x, geometry: g ?? null });
      }
    }
    // each feature at its slot (kept while it is in the data, whatever order it comes in: core › encoding › join), born
    // when first seen (kept for a feature seen before, also one that left a while and came back: a feature that was
    // on screen is never revealed from nothing again)
    const slots = this.join.next(items), out: Entry<D>[] = new Array(items.length);
    for (let i = 0; i < items.length; i++) {
      const it = items[i]!, was = old.get(it.key), born = was ? was.born : left.get(it.key) ?? fresh;
      if (born > newest) newest = born;
      out[i] = { id: it.id, key: it.key, d: it.d, geometry: it.geometry, cuts: it.cuts, index: slots[i]!, born };
    }
    this.newest = newest;
    // (the ones that left now remembered with their birth; a few thousand at most, the oldest forgotten first)
    if (old.size) { const here = new Set(out.map((e) => e.key)); for (const [k, e] of old) if (!here.has(k)) { left.delete(k); left.set(k, e.born); } }
    for (const e of out) left.delete(e.key);
    if (left.size > FeatureMark.rememberLeft) { let n = left.size - FeatureMark.rememberLeft; for (const k of left.keys()) { if (n-- <= 0) break; left.delete(k); } }
    const by: (Entry<D> | undefined)[] = new Array(this.join.size);
    for (const e of out) by[e.index] = e;
    this.bySlot = by;
    return out;
  }
  /** one feature's style, written into this one object (a restyle of 10,000 features makes no object per feature) */
  protected st: Styled = { color: [1, 1, 1, 1], number: 0, value: 0 };
  /** a colour into st.color: an array's numbers copied, a string's read once (and remembered) */
  protected colourInto(c: Color): RGBA {
    const o = this.st.color as RGBA;
    if (typeof c === 'string' || c == null) { const r = rgba(c); o[0] = r[0]; o[1] = r[1]; o[2] = r[2]; o[3] = r[3]; }
    else { o[0] = c[0] ?? 1; o[1] = c[1] ?? 1; o[2] = c[2] ?? 1; o[3] = c[3] ?? 1; }
    return o;
  }
  /** the data's values changed, its shapes not (a join's rows came, a simulation step): what a mark decides from the
   *  values once (a label's text and priority) is decided again */
  protected valuesChanged(): void {}
  /** the props each mark styles with (scales among them read their domain from the data) */
  protected abstract styleProps(): unknown[];
  /** a feature's colour, number and value */
  protected abstract style(e: Entry<D>, s: State): Styled;
  /** build the mark's geometry for these entries (graphics resources included) */
  /** build the shapes; false: not done yet, called again next frame (a big build spread over frames: never a long one) */
  protected abstract build(ctx: FrameContext): void | false;
  /** read the ground again under every vertex */
  protected abstract ground(ctx: FrameContext): void;
  /** the draw calls */
  protected abstract draws(ctx: FrameContext): DrawCall[];
  /** the mark's own uniforms (L.a, L.b, L.c: floats 28..39) */
  protected uniforms(_ctx: FrameContext): void {}
  /** how its size or width is drawn (core › render › drawing › size): CSS px as given unless the mark says */
  protected sizeUnits(): SizeUnits { return PX; }

  /** drawn draped on the ground, exactly whatever the terrain does (a mark that can, on the ground, without your
   *  position hook) */
  get draped(): boolean { const at = this.sits; return this.drapeable() && (at === 'ground' || at === 'over') && (this.props.on ?? 'ground') === 'ground' && !this.props.shader?.position; }
  /** its parts over the twin's solids are drawn this frame: draped, and something stands over the terrain (the
   *  world's buildings, trees, roads' meshes); none on bare terrain (pay only for what is there) */
  protected upperNow(ctx: FrameContext): boolean { return this.draped && !!ctx.world.standing; }
  /** the layer's box (w, s, e, n degrees) as last built; null: none */
  protected bbox: [number, number, number, number] | null = null;
  protected drapeable(): boolean { return false; }
  /** its pieces' own ground ranges are being measured again: the prisms stand on the layer's range meanwhile (a
   *  settled view once showed the ground through prisms measured on heights that had risen since) */
  protected rangesStale(): boolean { return false; }
  /** its pieces' own ground ranges are being measured (a run under way, or one waiting for its turn): frames come
   *  for it, so the view is not settled until it is done (it once ran up to a second after the view settled, its
   *  frames on a still view that had rested) */
  protected measuring(): boolean { return false; }
  /** the lowest and highest ground under the layer (true metres): where its draped prisms stand */
  protected range: [number, number] = [0, 0];
  /** the last reading found no ground under the layer at all (nothing loaded there yet) */
  private groundEmpty = false;
  /** the ground's range as sampled (no margin) */
  protected sampled: [number, number] = [0, 0];
  /** drawn flat this frame: the ground under it is level (no terrain, a plain) or its relief is under a third of a
   *  pixel from the nearest the eye can be; one face per piece (3 / 6 vertices, not 24 / 36), the same pixels */
  protected flatNow = false;
  /** read the range again: the places given (a sample of them), and a grid over the layer's box */
  protected groundRange(ctx: FrameContext, lonlat: ArrayLike<number>): void {
    let lo = Infinity, hi = -Infinity, w = 180, so = 90, e = -180, n = -90;
    const n2 = lonlat.length / 2, every = Math.max(1, Math.floor(n2 / 3000));
    for (let i = 0; i < n2; i += every) {
      const lon = lonlat[2 * i]!, lat = lonlat[2 * i + 1]!, h = ctx.world.heightAt(lon, lat);
      if (lon < w) w = lon; if (lon > e) e = lon; if (lat < so) so = lat; if (lat > n) n = lat;
      if (!Number.isNaN(h)) { if (h < lo) lo = h; if (h > hi) hi = h; }
    }
    for (let j = 0; j <= 24; j++) for (let i = 0; i <= 24; i++) { const h = ctx.world.heightAt(w + ((e - w) * i) / 24, so + ((n - so) * j) / 24); if (!Number.isNaN(h)) { if (h < lo) lo = h; if (h > hi) hi = h; } }
    this.groundEmpty = !Number.isFinite(lo);
    if (!Number.isFinite(lo)) { lo = 0; hi = 0; }
    this.sampled = [lo, hi];
    // the peaks between the samples: a margin over the highest
    this.range = [Math.min(0, lo) - 20, hi + Math.max(150, 0.3 * (hi - Math.min(0, lo)))];
  }
  /** the ground under a place, as this layer stands (true metres) */
  protected groundAt(ctx: FrameContext, lon: number, lat: number): number {
    if ((this.props.on ?? 'ground') !== 'ground') return 0;
    const h = ctx.world.heightAt(lon, lat); return Number.isNaN(h) ? 0 : h;
  }

  private sync(ctx: FrameContext): void {
    const src = this.src, s = ctx.s, now = ctx.now;
    if (src && this.sctx) { void src.start(this.sctx); this.srcStarted = true; }
    if (src) src.frame(s, this.sctx!);
    let shapes = false, values = false;
    if (src) {
      if (src.shapeVersion !== this.seen.sv) { shapes = true; this.seen.sv = src.shapeVersion; }
      if (src.version !== this.seen.v) { values = true; this.seen.v = src.version; }
    } else {
      const arr = this.props.data as readonly D[];
      if (arr !== this.seen.arr || arr.length !== this.seen.len || this.seen.v === -2) { shapes = true; values = true; this.seen.arr = arr; this.seen.len = arr.length; this.seen.v = 0; }
    }
    const readNow = shapes || values;
    if (shapes || values) {
      this.entries = this.read(now);
      const byKey = new Map<string, Entry<D>>(); for (const e of this.entries) byKey.set(e.key, e); this.byKey = byKey;
      // each feature's own order: a change of it alone draws them again in the new order (no new shapes asked for)
      if (this.readOrders(s) && !shapes && this.built) this.reordered();
      // the join says what changed: the same features handed over again (a source re-handing what it has) build and
      // restyle nothing; new, changed or gone ones do (stayed ones keep their slots: never another's look meanwhile)
      const j = this.join.last;
      shapes = this.join.shapes || (!this.built && this.entries.length > 0);
      values = shapes || j.changed > 0;
      if (shapes || values) {
        // new features or new values: their gates and states asked again
        this.stateDirty = true; this.stateWide = true;
        this.plan = null;
        // a gone feature's slot drawn empty from now (its old shape may be drawn until the next build)
        if (this.join.gone.length) this.clearSlots(this.join.gone);
        if (!shapes) this.valuesChanged();
      }
    }
    const first = !this.built;
    if (shapes && this.entries.length) {
      this.originFor();
      this.ensureTexture();
      this.building = true;
    }
    // a build goes on over frames until done; what was built before keeps drawing meanwhile
    if (this.building && this.entries.length) {
      if (this.build(ctx) !== false) { this.building = false; this.built = true; this.groundSeen = -1; this.join.built(); }
    }
    // (once its data was read, even empty: features that come later are new, revealed)
    if (readNow) this.born = true;
    // scales re-read their domain when the data changed, or when one is new to it (a colour given a scale by
    // setProps: its classes come from this data before it styles a feature); a changed domain restyles
    const sp = this.styleProps().filter(isScale) as unknown as { prepare(d: readonly unknown[], key?: string): void; version: number; auto?: boolean; kind: string }[];
    const fresh = sp.length !== this.scalesRead.length || sp.some((x, i) => x !== this.scalesRead[i]);
    if (values || shapes || (fresh && this.entries.length)) { this.prepareScales(sp); this.scalesRead = sp; }
    const sk = sp.map((x) => x.version).join(',');
    if (values || shapes || sk !== this.seen.scales) { this.seen.scales = sk; this.restyle(ctx, !first); }
    this.flushPlanes();
  }
  /** each feature's own order (feature.order) by slot, and its version (bumped when one changed) */
  protected orders = new Float64Array(0); protected orderVer = 0;
  private sortedOf: { of: Entry<D>[]; ver: number; list: Entry<D>[] } | null = null;
  /** read every feature's order again; true when one changed */
  private readOrders(s: State): boolean {
    const fo = this.props.feature?.order; if (!fo) return false;
    if (this.orders.length < this.bySlot.length) { const o = new Float64Array(Math.max(64, this.bySlot.length * 2)).fill(NaN); o.set(this.orders); this.orders = o; }
    let changed = false;
    for (const e of this.entries) { const v = Number(fo(e.d, s)) || 0; if (this.orders[e.index] !== v) { this.orders[e.index] = v; changed = true; } }
    if (changed) this.orderVer++;
    return changed;
  }
  /** the features in their drawing order: by their own order (feature.order: lower first, the data's order between
   *  equals), else as the data gives them; the same array until either changes */
  protected buildList(): Entry<D>[] {
    if (!this.props.feature?.order) return this.entries;
    const c = this.sortedOf; if (c && c.of === this.entries && c.ver === this.orderVer) return c.list;
    const o = this.orders, idx = this.entries.map((_, i) => i);
    idx.sort((a, b) => (o[this.entries[a]!.index]! - o[this.entries[b]!.index]!) || a - b);
    const list = idx.map((i) => this.entries[i]!);
    this.sortedOf = { of: this.entries, ver: this.orderVer, list };
    return list;
  }
  /** a feature's order changed and nothing else of its shape: what the mark draws in order is made again (default:
   *  its shapes built again in the new order; points write their places again) */
  protected reordered(): void { this.building = true; }
  /** gone features' slots written empty (no colour, not shown): an old shape still drawn there until the next build
   *  draws nothing */
  private clearSlots(slots: readonly number[]): void {
    const f = this.featData;
    for (const i of slots) for (const k of [P_COLOR, P_BEFORE, P_STATE, P_NUMBERS]) { const q = this.at(i, k); if (q + 3 < f.length) { f[q] = 0; f[q + 1] = 0; f[q + 2] = 0; f[q + 3] = 0; } }
    this.touch(P_COLOR); this.touch(P_BEFORE); this.touch(P_STATE); this.touch(P_NUMBERS); this.lookGen++;
  }
  /** the scales read their domain from the whole data (core › encoding › scales), once per change of it: never from
   *  what a view has loaded. A source that follows the view has no whole on the device: a scale over it with 'auto'
   *  is an error with its fix */
  private prepareScales(sp: readonly { prepare(d: readonly unknown[], key?: string): void; auto?: boolean; kind: string }[]): void {
    if (!sp.length) return;
    const src = this.src;
    const key = src ? `${src.id}:${src.version}` : `${this.id}:${++this.readGen}`;
    const data = this.entries.map((e) => e.d);
    for (const sc of sp) sc.prepare(data, key);
  }
  private readGen = 0; private srcStarted = false;
  /** the scales its classes were last read for (a new one is read before it styles) */
  private scalesRead: readonly object[] = [];
  /** a scale with an 'auto' domain over a source that follows the view: an error with its fix (its classes would
   *  change as the view moves) */
  protected checkScales(): void {
    const src = this.source; if (!src?.byView) return;
    const bad = (this.styleProps().filter(isScale) as unknown as { auto?: boolean; kind: string }[]).find((x) => x.auto);
    if (bad) throw new AslnutError('E-DATA-003', `scale.${bad.kind} over '${src.id}' (a source that follows the view) has no domain: its classes would change as the view moves`, { where: this.id, fix: bad.kind === 'category' ? "give its categories: scale.category(d => d.props.kind, { domain: ['a', 'b', 'c'] })" : `give its domain: scale.${bad.kind}(d => d.props.value, { domain: [10, 20, 40, 80] }) (or a threshold scale with your breaks)` });
  }
  private originFor(): void {
    let b: [number, number, number, number] | null = null;
    const x: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const e of this.entries) extendBox(e.geometry, x);
    if (Number.isFinite(x[0])) b = x;
    this.bbox = b && Number.isFinite(b[0]) ? [b[0], b[1], b[2], b[3]] : null;
    if (!b || !Number.isFinite(b[0])) { this.origin = new Origin(0, 0); this.step = 1000; return; }
    this.origin = new Origin((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    const lo = this.origin.rel(b[0], b[1]), hi = this.origin.rel(b[2], b[3]);
    this.step = this.props.detail?.step ?? stepFor(relMetres(this.origin, lo[0], lo[1], hi[0], hi[1]));
  }
  protected ensureTexture(): void {
    const rows = Math.max(1, Math.ceil(this.bySlot.length / FW));
    if (rows !== this.rows) {
      const old = this.featData, oldRows = this.rows;
      this.rows = rows;
      this.featData = new Float32Array(FW * rows * PLANES * 4);
      // keep what is known per feature (planes of the old size, copied plane by plane)
      if (oldRows) for (let k = 0; k < PLANES; k++) this.featData.set(old.subarray(k * oldRows * FW * 4, Math.min((k + 1) * oldRows * FW * 4, k * oldRows * FW * 4 + rows * FW * 4)), k * rows * FW * 4);
      // a new texture starts empty on the chip: every plane is written again (the states too, even if unchanged here)
      this.lookGen++; this.stateDirty = true; this.stateWide = true; this.layoutKey = -1;
    }
    this.layout(this.planes);
  }
  /** the planes on the chip as last laid out (-1: none yet) */
  private layoutKey = -1;
  /** keep these planes on the chip (with the mark's own): the texture is made again when they change, and every plane
   *  it holds is written from the copy here. A plane left out is the same for every feature: a uniform */
  protected layout(planes: number): void {
    planes |= this.planesWanted();
    if (planes === this.layoutKey) return;
    this.planes = planes; this.layoutKey = planes;
    let n = 0; for (let k = 0; k < PLANES; k++) this.slots[k] = planes & (1 << k) ? n++ : -1;
    if (this.g && this.featureTexture && this.rows) { this.feat?.destroy(); this.feat = this.g.texture({ label: `${this.id} features`, width: FW, height: this.rows * n, format: 'rgba32f', filter: 'nearest' }); }
    this.dirtyPlanes = planes; this.lookGen++;
  }
  /** plane k changed here: written to the chip at the next flush */
  protected touch(k: number): void { this.dirtyPlanes |= 1 << k; }
  /** the planes changed since the last flush, onto the chip (those it holds) */
  protected flushPlanes(): void {
    const d = this.dirtyPlanes & this.planes; this.dirtyPlanes = 0;
    if (!d || !this.feat) return;
    const W = FW * this.rows * 4, f = this.featData;
    for (let k = 0; k < PLANES; k++) if (d & (1 << k)) this.feat.write(f.subarray(k * W, (k + 1) * W), { y: this.slots[k]! * this.rows, height: this.rows });
  }
  /** seconds a restyle eases (see FeatureMarkProps.restyle) */
  protected restyleSeconds(): number { return this.props.restyle ?? this.props.transition ?? 0; }
  /** feature i shows now: its own gate (feature.when, filter) lets it and its reveal has begun (plane 2) */
  protected isShown(i: number): boolean { const q = this.at(i, 2); return this.featData.length > q + 3 && this.featData[q + 3]! > 0 && this.featData[q + 2]! > 0; }
  /** texel offset (floats) of feature i in plane k */
  protected at(i: number, k: number): number { return ((k * this.rows + Math.floor(i / FW)) * FW + (i % FW)) * 4; }
  private restyle(ctx: FrameContext, animate: boolean): void {
    if (!this.entries.length) return;
    this.ensureTexture();
    const f = this.featData, s = ctx.s, k0 = this.k0, k3 = this.k3, k6 = this.k6;
    // the colour and number shown now become "before"; the new ones ease in over `restyle` seconds, on the chip (on
    // the ground's tiles they show at once: the tiles are drawn again once, not at every step of an ease)
    const tr = this.restyleSeconds(), eases = animate && tr > 0 && !this.onTiles, t = this.mixT;
    // a colour or numbers the same for every feature take no room on the chip (a uniform)
    let colours = false, numbers = false, extras = false, firstOne = true;
    for (const e of this.entries) {
      const i = e.index, c0 = this.at(i, 0), c1 = this.at(i, 1), n = this.at(i, 3), x = this.at(i, P_EXTRA);
      for (let k = 0; k < 4; k++) f[c1 + k] = f[c1 + k]! + (f[c0 + k]! - f[c1 + k]!) * t;
      f[n + 1] = f[n + 1]! + (f[n]! - f[n + 1]!) * t;
      const st = this.style(e, s), c = st.color, ex = st.extra;
      f[c0] = c[0]; f[c0 + 1] = c[1]; f[c0 + 2] = c[2]; f[c0 + 3] = c[3]; f[n] = st.number; f[n + 2] = st.value;
      if (st.base !== undefined) f[n + 3] = st.base;
      if (ex) { f[x] = ex[0]; f[x + 1] = ex[1]; f[x + 2] = ex[2]; f[x + 3] = ex[3]; }
      if (!eases || e.born === ctx.now) { f[c1] = c[0]; f[c1 + 1] = c[1]; f[c1 + 2] = c[2]; f[c1 + 3] = c[3]; f[n + 1] = st.number; }
      if (firstOne) { firstOne = false; for (let k = 0; k < 4; k++) { k0[k] = f[c0 + k]!; k3[k] = f[n + k]!; k6[k] = ex ? f[x + k]! : 0; } continue; }
      if (!colours && (f[c0] !== k0[0] || f[c0 + 1] !== k0[1] || f[c0 + 2] !== k0[2] || f[c0 + 3] !== k0[3])) colours = true;
      if (!numbers && (f[n] !== k3[0] || f[n + 1] !== k3[1] || f[n + 2] !== k3[2] || f[n + 3] !== k3[3])) numbers = true;
      if (ex && !extras && (f[x] !== k6[0] || f[x + 1] !== k6[1] || f[x + 2] !== k6[2] || f[x + 3] !== k6[3])) extras = true;
    }
    this.mixT = eases ? 0 : 1; this.mixFrom = ctx.now;
    const keep = this.planes & ~((1 << P_COLOR) | (1 << P_BEFORE) | (1 << P_NUMBERS) | (1 << P_EXTRA));
    this.layout(keep | (colours ? 1 << P_COLOR : 0) | (tr > 0 ? 1 << P_BEFORE : 0) | (numbers ? 1 << P_NUMBERS : 0) | (extras ? 1 << P_EXTRA : 0));
    // (a texture made again is written whole from the copy here, the states too: nothing else to ask)
    this.touch(P_COLOR); this.touch(P_BEFORE); this.touch(P_NUMBERS); this.touch(P_EXTRA); this.lookGen++;
  }
  /** centre and half size (planes 4) per feature, relative to the origin */
  protected boxes(): void {
    // only for a mark whose shaders read them (areas, extrusions)
    if (!(this.planesWanted() & (1 << P_BOX))) return;
    const f = this.featData, o = this.origin, b: [number, number, number, number] = [0, 0, 0, 0];
    for (const e of this.entries) {
      b[0] = b[1] = Infinity; b[2] = b[3] = -Infinity; extendBox(e.geometry, b);
      const q = this.at(e.index, 4);
      if (!Number.isFinite(b[0])) { f[q] = 0; f[q + 1] = 0; f[q + 2] = 1e-6; f[q + 3] = 1e-6; continue; }
      const x0 = o.x(b[0]), y0 = o.y(b[1]), x1 = o.x(b[2]), y1 = o.y(b[3]);
      f[q] = (x0 + x1) / 2; f[q + 1] = (y0 + y1) / 2; f[q + 2] = Math.max(1e-9, (x1 - x0) / 2); f[q + 3] = Math.max(1e-9, (y1 - y0) / 2);
    }
    // onto the chip at once: a build spread over frames ends after the features were written (the reveals that read
    // the boxes, radial, wipe, grow, would hide every pixel)
    this.touch(P_BOX); this.flushPlanes(); this.lookGen++;
  }

  // ── each frame ──────────────────────────────────────────────────────────────────────────────────────────────
  /** a pulse plays forever; your shader code reading the clock changes by itself */
  override animating(_s: State): boolean { return this.plan?.mode === 2 || /\btime\b/.test(Object.values(this.props.shader ?? {}).join(' ')); }
  override revealSeconds(): number { return this.plan?.total ?? this.props.transition ?? 0.35; }
  frame(ctx: FrameContext): DrawCall[] {
    if (!this.g || !this.progs.length || !this.lbuf) return [];
    this.sync(ctx);
    // nothing left to show: no restyle under way either (it would wait for frames that never come)
    if (!this.entries.length) this.mixT = 1;
    if (!this.entries.length || !this.built || (!this.feat && this.featureTexture)) return [];
    // a stagger spreads over the features shown now (their own gates), not the hidden ones
    const gated = !!(this.props.feature?.when || this.props.filter);
    this.plan ??= plan(this.props.reveal, this.bySlot.map((e) => (e ? e.d : null)), { mark: this.mark, context: ctx.world.context, s: ctx.s, fallback: this.props.transition ?? 0.35, centreOf: (d) => { const b = bboxOf((d as unknown as Feature | null)?.geometry ?? null); return b ? [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2] : null; }, shownOnly: (i) => { const e = this.bySlot[i]; if (!e) return false; if (!gated) return true; try { return this.gateOf(e, ctx.s) > 0; } catch { return true; } } });
    const ln = ctx.loadNow ?? ctx.now;
    // read again at most every groundEvery ms while the ground sharpens, at once when it had nothing under the layer
    // (a view's first heights land at full height: drawn on sea level meanwhile, the ground covered the marks)
    // (a third as often while the camera moves: each read samples the ground under thousands of its points, and a
    // view in motion sharpens its ground every few frames; a still view reads it at once, settled waits for it)
    const every = ctx.camera.moving ? this.groundEvery * 3 : this.groundEvery;
    if (ctx.world.groundVersion !== this.groundSeen && (ln - this.groundTime > every || this.groundEmpty)) { this.groundSeen = ctx.world.groundVersion; this.groundTime = ln; this.ground(ctx); }
    const tr = this.restyleSeconds();
    if (this.mixT < 1) { this.mixT = tr > 0 && !this.onTiles ? Math.min(1, (ctx.now - this.mixFrom) / 1000 / tr) : 1; }
    this.updateState(ctx);
    this.flushPlanes();
    this.writeUniforms(ctx);
    if (this.paramsDirty) { this.pbuf!.write(this.paramBlock!.pack(this.paramValues)); this.paramsDirty = false; this.lookGen++; }
    this.frameBlock = ctx.frame;
    return this.draws(ctx);
  }
  /** ahead of being shown (the view is near its `when`): its data loaded and its shapes built, a slice at a time,
   *  so it shows at once when the view gets there (a country's regions built in the middle of a zoom stalled it).
   *  True when there is nothing left to do */
  override prepare(ctx: FrameContext): boolean {
    if (!this.g || !this.progs.length || !this.lbuf) return true;
    this.sync(ctx);
    // nothing to show (its data in, and empty): nothing left to do
    if (!this.entries.length) return !this.src || (this.srcStarted && this.src.status().pending.length === 0);
    if (!this.built || this.building) return false;
    this.warm(ctx);
    if (this.onTiles && ctx.world.prepareGround) {
      const ground = this.frame(ctx).flatMap((d) => d.ground ? [d.ground] : []);
      return ctx.world.prepareGround(ground, ctx);
    }
    return true;
  }
  /** additional programs used by a configured mark, compiled as soon as it is attached */
  protected preparePrograms(): void {}
  /** a program it draws with now is still being built (its own, its tiles', its parts over the solids) */
  protected graphicsBusy(): boolean { return this.progs.some((p) => !p.ok && !p.failed); }
  /** the world has solids its parts would be drawn over (made ahead of their first frame: no pop-in when the twin's
   *  buildings come in) */
  protected solidsAround(): boolean { const w = this.attached?.world; return !!w && (w.standing === true || w.elementsOfKind('shape').length > 0 || w.elementsOfKind('extrusion').length > 0); }
  /** what the mark can make ahead once its shapes are built (the pieces' grid for the ground's tiles) */
  protected warm(_ctx: FrameContext): void {}
  /** ms between two readings of the ground while it sharpens (a mark reading it per vertex reads it less often) */
  protected groundEvery = 200;
  private lastShown = -1; private birthsLast = false;
  /** each feature's own gate (feature.when, filter) as last asked, the state fields they read, and their values then */
  private gates = new Float32Array(0); private gatePaths: string[] | null = null; private gateReads = ''; private gateAt = -1e9;
  /** a feature's gate now (feature.when and filter), asked with the state given */
  private gateOf(e: Entry<D>, s: State): number {
    const p = this.props;
    let fw = 1;
    if (p.feature?.when) {
      let r: unknown;
      try { r = p.feature.when(e.d, s); } catch (err) { throw new AslnutError('E-WHEN-001', `a feature 'when' threw: ${(err as Error).message}`, { where: `layer '${this.id}' feature`, fix: 'check the fields it reads exist on the feature and on s', cause: err }); }
      fw = gateValue(r, `layer '${this.id}' feature`);
    }
    if (p.filter && !keep(p.filter, e.d, s)) fw = 0;
    return fw;
  }
  /** planes 2 (hovered, selected, progress, shown) and 5 (motion), when anything in them moves. A still view costs
   *  nothing here: features' gates are asked again only when a state field they read changed (they are watched:
   *  s.world.params, s.view, s.user …), the data changed, or once a second (a gate reading your own variables) */
  private updateState(ctx: FrameContext): void {
    const s = ctx.s, p = this.props, pl = this.plan!, now = ctx.now;
    const selection = s.user.selection, sk = selection.join('\u0001');
    if (sk !== this.selKey) { this.selKey = sk; this.sel = new Set(selection.map(String)); this.stateDirty = true; }
    const dur = pl.dur * 1000;
    const births = now - this.newest < dur && this.entries.some((e) => now - e.born < dur);
    const gated = !!(p.feature?.when || p.filter);
    // (the frame after the births' fade ended writes them once more: a fade whose end fell between two frames, the
    // clock having jumped (a frame after a rest), was left part-way, the features drawn faint for good)
    const moving = this.shown !== this.lastShown || births || this.birthsLast;
    this.birthsLast = births;
    let ask = false;
    if (gated) {
      const t = typeof performance !== 'undefined' ? performance.now() : Date.now();
      if (this.gatePaths === null || this.gates.length !== this.bySlot.length || this.stateDirty || t - this.gateAt > 1000 || readsOf(s, this.gatePaths) !== this.gateReads) { ask = true; this.gateAt = t; }
    } else if (this.gates.length !== this.bySlot.length) this.gates = new Float32Array(this.bySlot.length).fill(1);
    if (!(this.stateDirty || moving || ask)) return;
    const dirty = this.stateDirty;
    this.lastShown = this.shown; this.stateDirty = false;
    const f = this.featData, hov = this.hoverSet, look = pl.spec?.feature;
    let motion = false, changed = dirty;
    // the features whose hovered / selected state alone changed (their places are where the look changed); a state
    // written whole (new features, a new look, a new texture) changes it everywhere
    const only: number[] = []; let wide = this.stateWide; this.stateWide = false;
    // a change other than the features' reveal progress (which moves every frame of a fade)
    let others = dirty;
    let rec: Set<string> | null = null, ts = s;
    if (ask) { if (this.gates.length !== this.bySlot.length) this.gates = new Float32Array(this.bySlot.length).fill(1); rec = new Set(); ts = tracked(s, rec); }
    for (const e of this.entries) {
      const i = e.index, q = this.at(i, 2);
      let pr = progress(pl, i, this.shown);
      if (now - e.born < dur && dur > 0) pr *= pl.easeFn(Math.max(0, Math.min(1, (now - e.born) / dur)));
      if (ask) this.gates[i] = gated ? this.gateOf(e, ts) : 1;
      let fw = this.gates[i] ?? 1;
      const m = this.at(i, 5);
      if (look) {
        const l = look(e.d, pr, s); fw *= l.opacity ?? 1;
        f[m] = l.offset?.[0] ?? 0; f[m + 1] = l.offset?.[1] ?? 0; f[m + 2] = l.offset?.[2] ?? 0; f[m + 3] = l.scale ?? 1; motion = true;
      } else if (f[m + 3] !== 1 || this.motionUsed) { f[m] = 0; f[m + 1] = 0; f[m + 2] = 0; f[m + 3] = 1; motion = true; }
      const h = hov?.has(e.key) ? 1 : 0, sl = this.sel.has(e.key) ? 1 : 0;
      if (f[q] !== h || f[q + 1] !== sl || f[q + 2] !== pr || f[q + 3] !== fw) {
        if (f[q + 2] !== pr || f[q + 3] !== fw) wide = true; else if (only.length < 64) only.push(i); else wide = true;
        if (f[q] !== h || f[q + 1] !== sl || f[q + 3] !== fw) others = true;
        f[q] = h; f[q + 1] = sl; f[q + 2] = pr; f[q + 3] = fw; changed = true;
      }
    }
    this.motionUsed = !!look;
    // motion per feature (your reveal's offsets and scales): its plane on the chip from the first time
    if (look && !(this.planes & (1 << P_MOTION))) this.layout(this.planes | (1 << P_MOTION));
    if (rec) { this.gatePaths = [...rec]; this.gateReads = readsOf(s, this.gatePaths); }
    // written (and the look's version bumped) only when a state changed: a layer whose features are asked every frame
    // (a feature `when`, a filter function) costs nothing while they answer the same
    if (!changed && !motion) return;
    const gen0 = this.lookGen;
    // while the layer fades in or out, the progress alone does not make a new look: the look's version follows the
    // fade in quarter steps (groundDraw), so the ground's tiles are drawn again 4 times over a fade, not every frame
    const fading = !others && !motion && this.shown > 0 && this.shown < 1;
    if (changed) { this.touch(P_STATE); if (!fading) this.lookGen++; }
    if (motion) { this.touch(P_MOTION); this.lookGen++; }
    // hover / selection only: where it changed (the ground's tiles elsewhere keep what they show)
    if (changed && !motion && !wide) {
      const boxes: number[] = [];
      for (const i of only) { const b = bboxOf(this.bySlot[i]?.geometry ?? null); if (b) boxes.push(b[0], b[1], b[2], b[3]); }
      this.partial = { from: gen0, to: this.lookGen, boxes };
    }
  }
  private writeUniforms(ctx: FrameContext): void {
    const L = this.L, p = this.props, cam = ctx.camera, pl = this.plan!;
    const off = this.origin.offset(cam.lon, cam.lat), on = p.on ?? 'ground';
    const hv = p.hover === false ? null : p.hover ?? (p.tooltip || p.onHover || p.hoverGroup ? HOVER : null), sl = p.selected === false ? null : p.selected ?? { color: '#ffd166', mix: 0.55, outline: 2 };
    const hc = hv ? rgba(hv.color ?? '#ffffff') : [1, 1, 1, 1], sc = sl ? rgba(sl.color ?? '#ffd166') : [1, 1, 1, 1];
    const spec = typeof p.reveal === 'object' ? p.reveal : {};
    L.set([off[0], off[1], on === 'ground' ? ctx.world.exaggeration : 1, p.lift ?? 0], 0);
    L.set([p.opacity ?? 1, this.shown, this.mixT, this.rows], 4);
    L.set([pl.mode, this.motionUsed ? 1 : 0, spec.soft ?? 0.06, spec.head?.glow ?? 0], 8);
    L.set([hc[0]!, hc[1]!, hc[2]!, hv ? (hv.color ? hv.mix ?? 0.45 : 0) : 0], 12);
    L.set([hv?.raise ?? 0, hv?.outline ?? 0, p.blend === 'multiply' || p.blend === 'screen' ? 1 : 0, this.pickNo], 16);
    L.set([sc[0]!, sc[1]!, sc[2]!, sl ? (sl.color ? sl.mix ?? 0.55 : 0) : 0], 20);
    L.set([sl?.raise ?? 0, sl?.outline ?? 0, 0, 0], 24);
    L[40] = this.range[0]; L[41] = this.range[1]; L[42] = 0; L[43] = this.rangesStale() ? 1 : 0;
    // where each plane of the features texture is (-1: the same for every feature, the value below)
    const at = this.slots, k0 = this.k0, k3 = this.k3;
    L[44] = at[P_COLOR]!; L[45] = at[P_BEFORE]!; L[46] = at[P_NUMBERS]!; L[47] = at[P_BOX]!; L[48] = at[P_STATE]!; L[49] = at[P_MOTION]!;
    // its parts over the twin's solids (upper): on the ground, what lies within GROUND_WITHIN m of the terrain; over
    // everything, all of it, its prisms as tall as the highest thing standing under it (80 m where none is known)
    L[50] = 0; L[51] = 0;
    if (this.draped && ctx.world.standing) {
      const over = this.sits === 'over', b = this.bbox, top = over && b ? ctx.world.topIn?.(b[0], b[1], b[2], b[3]) ?? null : null;
      L[50] = over ? 0 : GROUND_WITHIN; L[51] = over ? Math.max(GROUND_WITHIN + 2, top !== null ? top - this.sampled[0] + 5 : 80) : GROUND_WITHIN + 2;
    }
    L[52] = k0[0]!; L[53] = k0[1]!; L[54] = k0[2]!; L[55] = k0[3]!; L[56] = k3[0]!; L[57] = k3[1]!; L[58] = k3[2]!; L[59] = k3[3]!;
    // how its size (points) or width (lines) is drawn: CSS px, or metres, within a range (core › render › drawing › size)
    L.set(this.sizeUnits(), 60);
    // the mark's own plane: where it is (-1: the same for every feature, k6)
    L[64] = at[P_EXTRA]!; L[65] = 0; L[66] = 0; L[67] = 0; L[68] = this.k6[0]!; L[69] = this.k6[1]!; L[70] = this.k6[2]!; L[71] = this.k6[3]!;
    this.flatNow = false;
    if (this.draped) {
      const ex = ctx.world.exaggeration, level = (this.sampled[1] - this.sampled[0]) * ex < 1;
      // the nearest any ground under it can be to the eye, and a pixel's metres there
      const near = Math.max(1, cam.groundY + cam.dist * Math.sin(cam.pitch) - this.range[1] * ex);
      const px = (2 * near * Math.tan(cam.fov / 2)) / Math.max(1, cam.height);
      if (level || ((this.range[1] - this.range[0]) * ex) / px < 0.33) {
        this.flatNow = true;
        L[40] = L[41] = level ? this.sampled[0] : (this.range[0] + this.range[1]) / 2; L[42] = 1;
      }
    }
    this.uniforms(ctx);
    this.lbuf!.write(L);
  }
  // ── on the ground's tiles (the surface draws ground marks into its tiles' overlays: one pass, exact) ────────────
  /** bumped whenever what the layer looks like changes (features, states, params, geometry) */
  protected lookGen = 0;
  protected frameBlock: GBuffer | null = null;
  /** drawn into the ground's tiles: draped, with a blend the tiles can hold (multiply / screen / add need what is
   *  under them: drawn over the frame instead) */
  protected get onTiles(): boolean {
    const w = this.attached?.world;
    if (!w || !this.draped || (this.props.blend ?? 'alpha') !== 'alpha') return false;
    // chosen (the layer's own, else the world's): it holds
    const own = this.props.groundMarks, chosen = own && own !== 'auto' ? own : w.groundMarksChosen ? w.groundMarks : undefined;
    if (chosen) return chosen === 'tiles';
    // automatic: where the world draws ground marks into its tiles (lite, phones), only where they pay. Level ground
    // takes the flat route (one face per piece on the ground, the same pixels, nothing drawn ahead); a mark that
    // changes by itself every frame would draw every tile under it again each frame
    return w.groundMarks === 'tiles' && this.relief() && !this.selfMoving();
  }
  /** the ground under the layer has relief (at least a metre between its lowest and highest, as last read) */
  protected relief(): boolean { return (this.sampled[1] - this.sampled[0]) * (this.attached?.world.exaggeration ?? 1) >= 1; }
  /** its look changes by itself every frame: a pulse, your shader reading the clock (a line: flowing dashes; a trail:
   *  its clock) */
  protected selfMoving(): boolean { return this.plan?.mode === 2 || /\btime\b/.test(Object.values(this.props.shader ?? {}).join(' ')); }
  /** this layer's part in the tiles: its version (the look: block L without its origin, which moves with the view,
   *  the features, the params, the clock when it animates) and its draws for one tile */
  /** the tile programs are built (set by the subclass when they are) */
  protected tileReady = false;
  /** wait for tile programs, then draw the tiles again */
  protected tileProgramsMade(ps: Program[]): void {
    this.tileReady = false;
    void Promise.all(ps.map((p) => p.ready)).then(() => { this.tileReady = true; this.lookGen++; (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); }, (e: unknown) => this.attached?.world.error?.(e));
  }
  protected groundDraw(part: string, block: Float32Array, lbuf: GBuffer, now: number, s: State, tileDraw: (t: { key: number; bounds: [number, number, number, number]; box: [number, number, number, number]; block: GBuffer }, frame: GBuffer, lbuf: GBuffer, out: DrawCall[]) => void): GroundDraw {
    // the look's version: a fade (shown, block[5]) or a restyle (mixT, block[6]) under way counts in steps of the
    // world's clock (FADE_STEP ms, the same for every layer: two layers crossfading step together), so the tiles under
    // the layer are drawn again 3 or 4 times over a fade, not every frame of it (a country's regions faded in drew
    // every tile again for 20 frames running: over a second of the chip's time on a phone); its end is drawn exactly
    const fade = (block[5]! > 0 && block[5]! < 1) || (block[6]! > 0 && block[6]! < 1);
    let h = 0; for (let i = 4; i < 40; i++) { const v = fade && (i === 5 || i === 6) ? 0 : block[i]!; h = (Math.imul(h, 31) + Math.round(v * 4096)) | 0; }
    // (its look changes by itself: a pulse, the clock in its shader, flowing dashes; not the frames a job of its own
    // asks for: the prisms' ranges measured while the view moves left the tiles drawn again every frame)
    const anim = this.selfMoving(), version = `${this.id}/${part}/${this.lookGen}/${h}${anim ? `/${now}` : fade ? `/f${Math.floor(now / FADE_STEP)}` : ''}`;
    const frame = this.frameBlock!, pt = this.partial;
    const since = pt && pt.to === this.lookGen && !anim ? { version: `${this.id}/${part}/${pt.from}/${h}`, boxes: pt.boxes } : undefined;
    return { version, since, ready: this.tileReady, where: this.bbox, tile: (t, out) => tileDraw(t, frame, lbuf, out) };
  }
  /** the last change of look that was hover / selection only: from which look version to which, and where */
  private partial: { from: number; to: number; boxes: number[] } | null = null;
  /** the draw call of a program over this layer's blocks and feature texture */
  protected call(prog: Prog, o: Omit<DrawCall, 'program' | 'blocks' | 'textures'>, frame: GBuffer, lbuf: GBuffer = this.lbuf!): DrawCall & { pickProgram?: () => Program } {
    return { program: prog.main, blocks: [frame, lbuf, this.pbuf!], textures: [this.feat!], ...o, pickProgram: this.props.pickable === false ? undefined : () => prog.pick() };
  }

  // ── interaction ─────────────────────────────────────────────────────────────────────────────────────────────
  override pickInfo(index: number): Omit<Picked, 'at' | 'x' | 'y'> | null {
    const e = this.bySlot[index]; if (!e) return null;
    const props = ((e.d as unknown as Feature).props ?? e.d) as Record<string, unknown>;
    // (a sign of a layer answers for its layer: core › encoding › layers)
    return { element: (this as unknown as { owner?: { id: string } | null }).owner?.id ?? this.id, id: e.id, props, d: e.d, index };
  }
  override hovered(ids: Set<string> | null): void { this.hoverSet = ids; this.stateDirty = true; }
  /** the features lit now (hovered, selected, or both asked for), as their states were last written: their keys */
  protected litKeys(hovered = true, selected = true): string[] {
    const out: string[] = [], h = hovered ? this.hoverSet : null;
    if (h) for (const k of h) if (this.byKey.has(k)) out.push(k);
    if (selected) for (const k of this.sel) if (this.byKey.has(k) && !h?.has(k)) out.push(k);
    return out;
  }
  /** the keys lit together with feature `key` (its hover group) */
  groupOf(key: string): Set<string> {
    const g = this.props.hoverGroup, e = this.byKey.get(key);
    if (!g || !e) return new Set([key]);
    const k = g(e.d), out = new Set<string>();
    for (const x of this.entries) if (g(x.d) === k) out.add(x.key);
    return out;
  }
  entryOf(id: string | number): Entry<D> | undefined { return this.byKey.get(String(id)); }

  override status(): ElementStatus {
    const st = super.status();
    if (!this.attached) return { ...st, ready: false, pending: ['attaching'] };
    const src = this.src?.status();
    if (src) st.failed.push(...src.failed);
    // hidden: nothing of it is on screen (what it prepares ahead never holds the view back, nor keeps frames coming)
    if (this.target <= 0 && this.shown <= 0) return st;
    if (src) st.pending.push(...src.pending);
    // the ground is read again only while shown (a hidden layer reads it when it shows)
    if (this.attached.graphics && (this.target > 0 || this.shown > 0) && this.attached.world.groundVersion !== this.groundSeen && this.entries.length && this.built) st.pending.push('reading the ground');
    if (this.building) st.pending.push('building its shapes');
    // the programs it draws with this frame still being built (a view is complete when they draw)
    if (this.built && this.entries.length && this.graphicsBusy()) st.pending.push('building its programs');
    if (this.mixT < 1) st.pending.push('restyling');
    if (this.built && this.entries.length && this.measuring()) st.pending.push("measuring its pieces' ground ranges");
    const dur = (this.plan?.dur ?? 0) * 1000, now = this.attached.world.now;
    if (now - this.newest < dur && this.entries.some((e) => now - e.born < dur)) st.pending.push('new features revealing');
    st.ready = !st.pending.length;
    return st;
  }
  /** how many features its data has (also headless) */
  get size(): number { return this.src ? this.src.size : (this.props.data as readonly D[]).length; }
  override readouts() { return { count: () => this.size }; }
}
