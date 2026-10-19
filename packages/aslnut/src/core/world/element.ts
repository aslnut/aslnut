// core › world › layer: what every element of a world shares. An id; `when` (shown?) eased into `shown` so a change
// plays its reveal; its place in the draw order (kind, `order`, `above`, `below`); params (knobs a person or a timeline
// turns: `w.set('heat.gain', 2)`), readouts (live values) and named points (places others aim at); and its life:
// attach (make graphics resources, load data) → frame (each frame: its draw calls) → detach (free everything).
//   class Heat extends Element { kind = 'custom' as const; frame(ctx) { … return [draw]; } }
import { Joined, Stream } from '../data/sources/index.ts';
import type { Loader } from '../data/loading/loader.ts';
import type { Camera } from '../observation/observers/orbit/camera.ts';
import type { DrawCall, GBuffer, GTexture, Graphics, GroundDraw } from '../render/graphics/interface.ts';
import type { Light } from '../render/look/light.ts';
import type { Profile } from '../render/graphics/caps.ts';
import { paramBlock, type ParamBlock, type ParamValue, type ShaderCode } from '../render/graphics/shaders/hooks.ts';
import type { LonLatH } from '../space/geo.ts';
import { AslnutError } from './errors.ts';
import type { Kind } from './order.ts';
import type { State } from './state.ts';
import type { When } from '../observation/presence.ts';

export interface ParamSpec {
  /** 'text': any string (a code, an id, a name: what a drill-down or a search sets) */
  type: 'number' | 'enum' | 'bool' | 'color' | 'vector' | 'text';
  default: unknown;
  range?: [number, number]; options?: string[]; unit?: string; describe?: string;
}
export interface ParamDef extends ParamSpec { get(): unknown; set(v: unknown): void }

export interface ElementProps {
  /** letters, digits, '-' and '_' (params are `<id>.<name>`) */
  id?: string;
  when?: When;
  order?: number; above?: string; below?: string;
  /** seconds a change of `when` takes to play (fade / reveal); 0 = at once */
  transition?: number;
  /** how opaque it is, 0..1 (default 1): a uniform, changed in one frame with nothing built again (layers that can
   *  fade: `layer.fades`) */
  opacity?: number;
  /** its name for people (a layer list, a legend): default its id */
  label?: string;
  /** values that become uniforms of its shader, by name (`params.gain` in your shader code) and world params */
  params?: Record<string, ParamValue>;
  /** your code at its shader's hook points (the WGSL subset; runs on WebGPU and WebGL2) */
  shader?: ShaderCode;
  /** a 3D form on each selected thing (s.user.selection): your shape for its datum, standing where it stands */
  selected?: FormVisual | false;
  /** what an analysis view is about (core › render › style › theme): under a theme it keeps its colour while the rest
   *  of the world is muted (a theme's `subjects` can name it instead) */
  subject?: boolean;
}
/** a form shown on a thing (hovered, selected): `shape` gives it (a shape's Made, made from the datum: a wire sphere the
 *  size of a tree's crown), standing on the thing's place (its foot on the ground, turned as it is); `material` over
 *  the shape's own; `follow`: it moves with a thing that moves (entities) */
export interface FormVisual {
  shape?: (d: any, place: ThingPlace) => { levels: readonly unknown[] } | null; // eslint-disable-line @typescript-eslint/no-explicit-any
  material?: import('../render/look/materials.ts').MaterialName | import('../render/look/materials.ts').Material;
  follow?: boolean;
}
/** where a picked thing stands: its foot [lon, lat] and height (m over the sea, the world's exaggeration in), its turn
 *  (radians), its scale; and its size when known (m: the radius of its bounds) */
export interface ThingPlace { at: [number, number, number]; turn: number; scale: [number, number, number]; radius?: number }

/** what a layer gets when it joins a world */
export interface AttachContext { graphics: Graphics | null; loader: Loader; profile: Profile | null; camera: Camera; world: WorldLike }
/** what picking found: the layer, the feature's id and props, the datum your functions get, where it was hit */
export interface Picked<D = unknown> { /** the element it was picked from (a sign of a layer: the layer) */ element: string; id: string | number; props: Record<string, unknown>; d: D; index: number; at: LonLatH | null; x: number; y: number }
/** what a layer gets each frame */
/** the sea a layer gives the world (water({ sea }), sea()): its level (m) and colour; the ground drawn under it is
 *  water. Its look (modules › world › earth › water › sea): the block of uniforms and the coast's field the ground's
 *  sea reads (none: the plain sea) */
export interface Sea { level: number; color: readonly [number, number, number]; look?: { block: import('../render/graphics/interface.ts').GBuffer; field: import('../render/graphics/interface.ts').GTexture } | null }
export interface FrameContext { /** the room labels have taken this frame, across every label mark (screen boxes x0, y0, x1, y1): one labelling for the whole stack, the top layer's first */ labelRoom?: [number, number, number, number][]; /** the world's sea this frame (null: none) */ sea?: Sea | null; graphics: Graphics; camera: Camera; s: State; frame: GBuffer; /** the world's clock, ms */ now: number; dt: number; world: WorldLike; /** the frame's number (the world's count; a paused clock keeps `now`): what the layers of one frame share (a budget) */ n?: number; /** the clock loading and fade-ins go by: the world's, plus the time a paused world spent settling (`settled({ hold })`) */ loadNow?: number; /** the sun's shadow map this frame (a 1 × 1 'everything lit' texture when there is none): lit programs bind it */ shadowMap?: GTexture; /** the sun's shadow box this frame (its view-projection: what casts into the map is in it); null: no map drawn */ shadowView?: Float32Array | null }
/** the part of a world a layer may call */
export interface WorldLike {
  readonly id: string; heightAt(lon: number, lat: number): number; readonly exaggeration: number; error(e: unknown): void; readonly graphicsApi: string; /** how marks lying on the ground are drawn */ readonly groundMarks?: 'prisms' | 'tiles'; /** you chose it (WorldOptions.groundMarks): it holds for every layer; else each picks where tiles pay */ readonly groundMarksChosen?: boolean;
  /** the lowest and highest ground drawn in a box (true m); null: unknown */
  rangeIn?(w: number, s: number, e: number, n: number): [number, number] | null;
  /** bumped whenever the ground's heights change (draped layers read the ground again) */
  readonly groundVersion: number;
  /** 'app' or 'video': which reveal a `{ video, app }` reveal plays */
  readonly context: 'app' | 'video';
  /** the world's clock, ms */
  readonly now: number;
  /** the layers of a kind, in draw order (the ground asks for the rasters it paints) */
  elementsOfKind(kind: Kind): readonly Element[];
  /** prepare a configured hidden mark's tile resources within the frame budget */
  prepareGround?(ground: GroundDraw[], ctx: FrameContext): boolean;
  /** the light this frame (a sky's sun, its weather); null without one */
  readonly light?: Light | null;
  /** the twin's solids (buildings, trees, roads' and paths' meshes, water) were drawn over the terrain last frame:
   *  draped marks draw their parts over them (core › geometry › marks › drape) */
  readonly standing?: boolean;
  /** the highest top of what stands in a box (true m over the sea: a building's roof, a tree's crown); null: nothing
   *  known there */
  topIn?(w: number, s: number, e: number, n: number): number | null;
  /** a layer's props changed (setProps): the draw order sorted again where it moved, a layer list told */
  elementChanged?(l: Element, keys: string[]): void;
  /** the layer a selected id was picked from, when the world picked it (undefined: not known) */
  selectedBy?(id: string): string | undefined;
  /** the analysis view's theme now (core › render › style › theme): how much it mutes, the sky's dim; null: none */
  readonly themeNow?: import('../render/style/theme.ts').ThemeNow | null;
}
export interface ElementStatus { ready: boolean; pending: string[]; failed: { what: string; error: string }[]; missing: string[] }

// A source can feed several elements (or worlds). The last attached user closes its stream; the next one opens it again.
const streamUsers = new WeakMap<Stream, Set<Element>>();
function streamsOf(props: ElementProps): Set<Stream> {
  const found = new Set<Stream>();
  const take = (source: unknown): void => {
    if (source instanceof Stream) found.add(source);
    else if (source instanceof Joined) { take(source.shapes); take(source.rows); }
  };
  const p = props as ElementProps & { data?: unknown; drive?: { source?: unknown } };
  take(p.data); take(p.drive?.source);
  return found;
}
let seq = 0;
export abstract class Element<P extends ElementProps = ElementProps> {
  abstract readonly kind: Kind;
  readonly id: string;
  props: P;
  /** set by the world: the add sequence (order within a kind) */
  added = -1;
  /** how much it is shown now (the eased `when`), and where that is going */
  shown = 0; target = 0;
  /** its shader params as a uniform block (null: it has no shader of its own) */
  protected paramBlock: ParamBlock | null = null;
  protected paramValues: Record<string, ParamValue> = {};
  protected paramsDirty = true;
  /** a failure while attaching (settled reports it) */
  failure: Error | null = null;
  /** shown or hidden by hand (w.reveal / w.hide / a state applied): over `when`; null = follow `when` */
  forced: boolean | null = null;
  /** its number in the picking pass (1..255; 0: not pickable) */
  pickNo = 0;
  /** the seconds the next change of `shown` takes, once (w.reveal / w.hide with { seconds }); null: its own */
  once: number | null = null;
  /** its detail as the governor holds it (core › runtime › detail › priorities): `pinned` (a kept element: the world's
   *  detail never reaches it), and its own steps when the app drops it by name (¾, ½, ¼); `detailOf` is what it draws at */
  detailPinned = false; detailOwn = 1;
  /** the detail it draws at now (1: full; lower: coarser levels sooner, fewer copies over time) */
  detailOf(s: State): number { return (this.detailPinned ? 1 : s.render.detail ?? 1) * this.detailOwn; }
  protected attached: AttachContext | null = null;
  private streams = new Set<Stream>();

  constructor(props: P) {
    this.props = props;
    const id = props.id ?? `${this.constructor.name.toLowerCase()}-${++seq}`;
    if (!/^[A-Za-z0-9_-]+$/.test(id)) throw new AslnutError('E-WORLD-001', `layer id '${id}' is not a plain name`, { fix: "use letters, digits, '-' and '_' (no dots: params are '<id>.<name>')" });
    this.id = id;
    if (props.params) { this.paramBlock = paramBlock(props.params); this.paramValues = { ...props.params }; }
  }
  get order(): number | undefined { return this.props.order; }
  /** it can be made see-through (props.opacity: a uniform, one frame, nothing built again) */
  get fades(): boolean { return false; }
  /** where it sits with the twin's terrain, buildings and trees (core › geometry › marks › drape): 'ground', 'over',
   *  'above'; 'free' at heights of its own; null: it is part of the world itself (the ground, the sky, the twin's
   *  solids) */
  get sits(): 'ground' | 'over' | 'above' | 'free' | null { return null; }
  get above(): string | undefined { return this.props.above; }
  get below(): string | undefined { return this.props.below; }

  /** its knobs: its shader params, plus whatever a subclass adds */
  params(): Record<string, ParamDef> {
    const out: Record<string, ParamDef> = {};
    for (const [n, v] of Object.entries(this.props.params ?? {})) {
      out[n] = {
        type: typeof v === 'number' ? 'number' : typeof v === 'string' ? 'color' : 'vector', default: v,
        get: () => this.paramValues[n], set: (x) => this.setParam(n, x as ParamValue),
      };
    }
    return out;
  }
  setParam(name: string, v: ParamValue): void {
    if (!this.props.params || !(name in this.props.params)) throw new AslnutError('E-WORLD-004', `layer '${this.id}' has no param '${name}'`, { where: this.id, fix: `its params: ${Object.keys(this.props.params ?? {}).join(', ') || 'none'}` });
    this.paramBlock?.pack({ ...this.paramValues, [name]: v });   // throws on a wrong type, before anything changes
    this.paramValues[name] = v; this.paramsDirty = true;
  }
  /** seconds a show / hide takes (its reveal's whole length; else `transition`) */
  revealSeconds(): number { return this.props.transition ?? 0.35; }
  /** what feature `index` of the picking pass is (layers with features answer) */
  pickInfo(_index: number): Omit<Picked, 'at' | 'x' | 'y'> | null { return null; }
  /** marks drawn into the ground's tiles answer a pick on the CPU: the feature (its picking index) that covers the
   *  ground at lon / lat, or null. Undefined: the layer is picked by drawing it (the picking pass) */
  groundPick?(lon: number, lat: number): number | null;
  /** the hover / selection state changed (picking found something new under the pointer) */
  hovered(_ids: Set<string> | null): void {}
  /** where a picked thing of this layer stands (forms on hover and selection); null: where the pointer hit it */
  placeOf(_picked: Picked): ThingPlace | null { return null; }
  /** elements it brings with it (added after it, removed with it: an instance set's counts far away, a layer's labels) */
  companions?(): Element[];
  /** its place in a stack (w.reorder): k, a fraction under 1; what it owns elsewhere (a layer's labels) follows */
  restacked?(k: number): void;
  /** the element it belongs to (a layer's labels): shown, faded and stacked with it; null: its own */
  owner?: Element | null;
  /** the sea it gives the world this frame (water({ sea })): the first layer that gives one; the ground under its level
   *  is drawn as water */
  sea?(s: State): Sea | null;
  /** the light it gives the world this frame (a sky with a sun): the first layer that gives one lights every lit mark */
  light?(s: State): Light | null;
  /** does it change on screen by itself (time in its shader, a pulse, the world's clock): the short form of
   *  wantsFrames (true: every display frame) */
  animating(_s: State): boolean { return false; }
  /** the frames a second it needs by itself, nothing else changing (core › runtime › frame: draw on demand). 0: none
   *  (a still layer: the default); Infinity: every display frame; n: n a second, where a lower rate looks the same
   *  (far, small or slow motion). The world asks only while the layer is shown, between frames and as often as it
   *  likes: answer for what the last frame drew (off screen, out of range, too small to see: 0), with no side effects.
   *  The world's `frames.rate` may lower it, `frames.max` caps it */
  wantsFrames(s: State): number { return this.animating(s) ? Infinity : 0; }
  readouts(): Record<string, () => unknown> { return {}; }
  points(): Record<string, () => LonLatH> { return {}; }

  /** make graphics resources and load data (graphics is null in a headless world) */
  async attach(ctx: AttachContext): Promise<void> { this.attached = ctx; this.keepStreams(streamsOf(this.props)); }
  /** while hidden, ahead of being shown (the orbit near a level it is shown at, a swap bringing it in, hidden by
   *  hand): load and build, a slice per call (the world gives it a few ms, in frames or between them); true when there
   *  is nothing (left) to do */
  prepare(_ctx: FrameContext): boolean { return true; }
  /** let go of what it built and loaded for being shown (a level change hid it past the keep: core › observation ›
   *  gates); shown or prepared again, it loads and builds again. Its source keeps the data (the truth). Undefined:
   *  nothing to let go */
  letGo?(): void;
  /** this frame's draw calls (only with graphics) */
  abstract frame(ctx: FrameContext): DrawCall[];
  /** what is still loading or failed (settled reads it) */
  status(): ElementStatus { return { ready: true, pending: [], failed: this.failure ? [{ what: this.id, error: this.failure.message }] : [], missing: [] }; }
  /** free everything it made */
  private keepStreams(next: Set<Stream>): void {
    for (const stream of next) {
      let users = streamUsers.get(stream);
      if (!users) streamUsers.set(stream, (users = new Set()));
      if (!users.size) stream.reopen();
      users.add(this);
    }
    const previous = this.streams; this.streams = next;
    for (const stream of previous) if (!next.has(stream)) {
      const users = streamUsers.get(stream); users?.delete(this);
      if (!users?.size) stream.close();
    }
  }
  detach(): void { this.attached = null; this.keepStreams(new Set()); }
  /** change props; what depends on them is rebuilt (showing, opacity and order: nothing is, the next frame shows them) */
  setProps(p: Partial<P>): this { this.props = { ...this.props, ...p }; if (this.attached) this.keepStreams(streamsOf(this.props)); const w = this.attached?.world; (w as { invalidate?: () => void } | undefined)?.invalidate?.(); w?.elementChanged?.(this, Object.keys(p)); return this; }
  /** names for the attribution line, while shown */
  attribution(): string[] { return []; }
}
