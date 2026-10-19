// core › world › world: the first word. A world on a body, seen through a camera, with layers added to it, the
// knobs (params) people and timelines turn, live readouts, named places, and one state `s` every `when` reads.
// With a canvas it draws (WebGPU or WebGL2, chosen once: 'auto' prefers WebGPU and always says why); with null it is
// headless (views, flights, projection, params, readouts, `when`: the same results, no graphics).
//   const w = await world(canvas, { body: earth({ terrain: [terrain.mapzen()] }), view: { lon: 107.6, lat: -6.9, zoom: 11 } });
//   w.add(points({ id: 'cities', data, when: { zoom: [4, 22] } }));
//   await w.fly({ lon: 107.6, lat: -6.9, zoom: 13, tilt: 60 }); await w.settled({ strict: true });
//   w.dispose();
import { Camera, type FlyOptions } from '../observation/observers/orbit/camera.ts';
import { TILT_MAX, checkPose, checkView, poseOf, viewOf, type Pose, type View } from '../observation/observers/orbit/views.ts';
import type { Keys } from '../observation/observers/orbit/keys.ts';
import type { Ease } from '../observation/observers/orbit/ease.ts';
import { checkDamping, Follower, type Damping } from '../observation/observers/orbit/follow.ts';
import { checkTarget, rigPose, whereOf, type Target } from '../observation/observers/orbit/aim.ts';
import { Shot, type Move, type MoveWorld } from '../observation/observers/orbit/moves.ts';
import { Loader, LoaderMiss, type EnsureResult, type LoaderOptions } from '../data/loading/loader.ts';
import { isTouch, openGraphics, profileOf, type Profile } from '../render/graphics/caps.ts';
import { FRAME_FLOATS, type Api, type DrawCall, type GBuffer, type GTexture, type Graphics, type GroundDraw } from '../render/graphics/interface.ts';
import { inView, shadowBox, type Light, type ShadowOptions } from '../render/look/light.ts';
import { Renderer } from '../render/drawing/renderer.ts';
import type { Clock } from '../time/clock.ts';
import { D, R, lonLatOf, mercY, worldOf, wrap, type BBox, type LonLatH } from '../space/geo.ts';
import { bboxOf, type Feature } from '../data/features.ts';
import { distForZoom, zoomForDist } from './state.ts';
import { AslnutError } from './errors.ts';
import type { FormVisual, FrameContext, Element, ElementStatus, ParamDef, ParamSpec, Picked, Sea, WorldLike } from './element.ts';
import type { GTarget } from '../render/graphics/interface.ts';
import { KIND_ORDER, sortElements } from './order.ts';
import { apply, capture, type ApplyOptions, type ApplyReport, type CaptureOptions, type WorldState } from './states.ts';
import { makeState, type Quality, type State, type UserState } from './state.ts';
import { timeState } from '../time/clock.ts';
import { localTime, ZoneTracker, type TimeZoneOption } from '../time/zones.ts';
import { ShapeShelf } from '../geometry/shapes/package.ts';
import { shown } from '../observation/presence.ts';
import { Levels, NO_OBSERVATION, type LevelChange, type ObservationOptions, type Rung } from '../observation/levels.ts';
import { Gates } from '../observation/gates.ts';
import { Governor, type Budget, type GovernorEvent, type GovernorOptions, type GovernorRung, type MemoryOptions, type Priorities } from '../runtime/budget/index.ts';
import { RemoteLog, type RemoteLogOptions } from '../runtime/telemetry/index.ts';
import { msPer, sunFrames, type FrameWant, type FramesOptions } from '../runtime/frame.ts';
import type { CameraController, Controller, Entity } from '../entities/index.ts';
import { scenarioApi, type ScenarioApi } from '../data/scenarios.ts';
import { standOn, type Stands } from '../space/stands.ts';
import { ThemeState, type Theme, type ThemeNow } from '../render/style/theme.ts';

/** what a body gives a world: its elements (the surface, the sky), whether it is flat, where a view starts */
export interface Body {
  readonly kind: string;
  readonly flat: boolean;
  readonly view: View;
  elements(): Element[];
  /** the exaggeration this frame (a body may make it a function of the view) */
  exaggeration?(s: State): number;
  /** a flat body's extent [w, s, e, n] */
  readonly bounds?: [number, number, number, number];
}
export interface WorldOptions {
  body?: Body;
  /** where the camera starts: a view, or the name of one in `views` */
  view?: View | string;
  views?: Record<string, View>;
  /** a loader to share, or options for the world's own */
  loader?: Loader | LoaderOptions;
  graphics?: 'auto' | Api;
  /** lite or realistic: a value, or your function of the state (asked as the state changes: a phone's tier, the
   *  zoom, a toggle); 'auto' (the default): the device's (lite on WebGL2, touch screens and low tiers), then held to
   *  the budget by the governor */
  quality?: Quality | 'auto' | ((s: State) => Quality);
  /** how a zoom frames a portrait screen: 'auto' (default) sees as much across as a landscape screen; 'height' the same height on every screen */
  frame?: 'auto' | 'height';
  /** the world's time: a date, or 'now' */
  time?: Date | 'now';
  /** the time zone of the world's clocks (s.time.local): an IANA name ('Australia/Melbourne'), 'auto' (the place's
   *  under the camera, by the nearest zone's principal place) or your lookup ((lon, lat) => name); default solar time */
  timeZone?: TimeZoneOption;
  /** 'real' (the display's frames) or { fps } (a fixed step per frame: captures) */
  clock?: Clock;
  pixelRatio?: number;
  /** pointer, touch and wheel on the canvas (default true). The camera is the person's: nothing moves it unless your
   *  code asks (a flight, keys, follow), and their input stops any of those (`{ interrupt: false }`: they play on) */
  controls?: boolean | { interrupt?: boolean };
  /** start drawing at once (default true) */
  autostart?: boolean;
  user?: Partial<UserState>;
  onError?: (e: unknown) => void;
  /** 'app' (default) or 'video': which mode a `reveal: { video, app }` plays */
  context?: 'app' | 'video';
  /** hover picking with a mouse (default true; touch picks on tap) */
  hover?: boolean;
  /** draw only when something would change on screen (default true): a still, settled view costs nothing (it is
   *  looked at 4 times a second for what its data streams bring) */
  renderOnChange?: boolean;
  /** draw on demand (core › runtime › frame): the most frames a second an animation gets, your rule per layer, when
   *  the loop rests, how often the light of the time 'now' is looked at */
  frames?: FramesOptions;
  /** dynamic resolution: the pixel ratio while the view moves, back to full when it is still (default off: each
   *  switch resizes the canvas; 0 = off) */
  resolution?: {
    moving?: number;
    /** the lowest pixel ratio the governor steps the picture down to (default: 1.5, or the screen's when it is less) */
    floor?: number;
    /** smooth the picture's edges (FXAA): 'auto' (the default: while it is drawn smaller than the screen), true, false */
    antialias?: 'auto' | boolean;
  };
  /** how marks lying on the ground are drawn: 'prisms' (each piece a prism, every pixel finds the ground under it;
   *  exact, draws every frame; one face per piece on level ground) or 'tiles' (drawn into the ground's tiles and shown
   *  with them: one pass for the frame, drawn again only when something changes). Chosen here, it holds for every
   *  ground mark. Unset: prisms at quality realistic; at quality lite (the WebGL2 default) and on phones each mark goes
   *  into the tiles only where they pay (relief under it, and it holds still: a trail's clock or flowing dashes would
   *  draw its tiles again every frame), else the flat or prism route. A layer's own `groundMarks` wins over both */
  groundMarks?: 'prisms' | 'tiles';
  /** tooltips: a class for the box aslnut draws, or your own function placing them (null hides) */
  tooltip?: { className?: string; show?: (text: string | HTMLElement | null, x: number, y: number) => void };
  /** how it is drawn: the sun's shadows (with a sky that gives a light; off by default) */
  render?: { shadows?: boolean | ShadowOptions; /** the same as `quality` (here with the rest of how it is drawn) */ quality?: Quality | 'auto' | ((s: State) => Quality) };
  /** what a frame may cost (ms between frames, graphics memory, triangles, draw calls): with one, the governor steps
   *  detail down before it breaks and back up when there is room. 'auto' (the default): the device's (phones, tablets
   *  and low tiers: { frameMs: 22 }, at least 30 frames a second; elsewhere none); false: none, nothing stepped */
  budget?: Budget | 'auto' | false;
  /** how the governor steps (it runs only with a budget); false: a budget measured, nothing stepped */
  governor?: GovernorOptions | false;
  /** what the governor drops first and what never: a rung of the world's ('detail', 'shadows', 'quality',
   *  'resolution') or an element by id (core › runtime › detail › priorities; w.setPriorities changes them) */
  priorities?: Priorities;
  /** the loader's memory for decoded values (tiles, data): its limit and what goes first */
  memory?: MemoryOptions;
  /** the credits of what is shown, on screen in a corner of the canvas (default bottom-right; false: the app shows
   *  them itself, from w.attribution()): `format` writes the line (default the credits joined by ' · ') */
  attribution?: false | { position?: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left'; className?: string; format?: (credits: string[]) => string };
  /** events from this page to an endpoint (a phone's errors, budget steps, long frames; a heartbeat at 'info') */
  log?: string | RemoteLogOptions;
  /** an analysis view (core › render › style › theme): theme.dark(), .grey(), .light(), your own; the world muted but
   *  its subjects. Unset: none, nothing of it worked out (w.setTheme changes it, eased) */
  theme?: Theme | null;
  /** the levels it is looked at (core › observation): a ladder, the binding from the orbit through a margin and a
   *  dwell, the data kept. Unset: no levels (a GIS map: nothing gated, nothing measured); an element asking for a
   *  level (`when: { level }`) turns the default ladder on */
  observation?: ObservationOptions;
}
/** the layer that takes ground marks into its tiles (the surface) */
interface OverlayHost { overlays(ground: GroundDraw[], ctx: FrameContext, pixelRatio: number, all: boolean): boolean; prepareOverlays?(ground: GroundDraw[], ctx: FrameContext, pixelRatio: number): boolean }
export interface SettleOptions { strict?: boolean; /** ms; a limit on waiting, not part of the condition */ timeout?: number; /** a paused world settles without moving its clock (frames at dt 0): a capture's moment stays put */ hold?: boolean }
export interface SettleReport { settled: boolean; pending: string[]; failed: { what: string; error: string }[]; missing: string[]; frames: number }
/** a recording (w.record): its frames, how many, its frame's size, the camera's way when it is known */
export interface RecordOptions {
  /** frames a second (the world's clock steps 1000 / fps ms a frame; default 30) */
  fps?: number;
  /** how many frames (or `seconds` of them; unset: until the loop is left) */
  frames?: number; seconds?: number;
  /** the frame's pixels [width, height] (unset: the canvas's own) */
  size?: [number, number];
  /** the camera's way, when it is known: camera keys, a move, or your function of the recording's seconds giving a
   *  view (unset: the move playing, else nothing loads ahead and each frame waits for what it needs) */
  path?: Keys | Move | ((t: number) => View | Pose | null | undefined);
  /** seconds of the way loaded ahead as it records (default 2) */
  ahead?: number;
  /** the most a frame waits to be complete (ms, default 60000): past it the frame is taken as it is, said */
  timeout?: number;
  /** the credits burned into each frame (as w.frame) */
  attribution?: boolean | string;
}
/** a frame recorded: its number, its time (seconds from the first), its pixels (RGBA, top row first), whether it was
 *  complete (else what was still pending), how long it waited (real ms) */
export interface RecordedFrame { index: number; t: number; width: number; height: number; pixels: Uint8Array; settled: boolean; pending: string[]; waitedMs: number }
/** where the pointer was: CSS px on the canvas, and the ground there */
export interface PointerInfo { x: number; y: number; lon: number | null; lat: number | null }
export interface PickOptions { /** CSS px round the point that still count (default 4; taps 12) */ radius?: number; /** only these elements */ elements?: string[] }
/** what changed in the world's layers (a layer list keeps in step with it): added, removed, the draw order, shown or
 *  hidden (by hand or by its `when`), its opacity or other props */
export interface ElementChange { what: 'add' | 'remove' | 'order' | 'shown' | 'opacity' | 'props'; ids: string[] }
type Events = { /** the elements changed (core › world › elements: a layer list keeps in step) */ elements: [ElementChange]; /** the observation level changed (core › observation › levels) */ level: [LevelChange]; tap: [Picked | null, PointerInfo]; hover: [Picked | null, PointerInfo | null]; select: [string[]]; frame: [{ n: number; dt: number }]; error: [unknown]; /** a frame came late (> 50 ms after the one before): the gap, and what the last frame did */ long: [{ gapMs: number; profile: FrameProfile }]; /** the governor stepped detail down or up (a budget is set) */ governor: [GovernorEvent] };
/** where a frame's time went (`w.profile()`, the 'long' event): the main thread's ms by part, and what reached the graphics */
export interface FrameProfile {
  /** ms of the last frame: collecting draw calls (the layers' own work: tiles, uploads, labels…), handing them to the graphics */
  tickMs: number; submitMs: number;
  /** ms per layer in the last frame, the costliest first */
  elements: [string, number][];
  /** the ground's part: ms of uploads inside the frame and how many, ms choosing tiles */
  surface: { uploadMs: number; uploads: number; tilesMs: number; queued: number } | null;
  /** ms of the last hover pick (it runs after a frame) */
  pickMs: number;
  /** textures and buffers written in the last frame, bytes, draw calls */
  uploads: number; uploadBytes: number; draws: number;
  /** device pixels drawn, the pixel ratio now (lower while moving on phones) */
  size: [number, number]; pixelRatio: number;
  /** main-thread tasks over 50 ms in the last second, and their ms (the browser's own count: GC, decode, scripts) */
  longTasks: number; longTaskMs: number;
  /** the chip's ms for a recent frame (null where the graphics cannot measure it), the longest single texture write of the
   *  last frame (ms), the passes (render targets) of the last frame */
  gpuMs: number | null; uploadMaxMs: number; passes: number;
}

/** what the world costs now (w.telemetry()), against its budget */
export interface Telemetry {
  /** ms between drawn frames (median and p95 of the last 120 drawn after a drawn one), the main thread's ms for the last
   *  frame, the chip's (null: not measured here) */
  frameMs: number; frameP95: number; cpuMs: number; gpuMs: number | null;
  /** the last frame's draw calls and triangles; graphics memory (MB) */
  draws: number; triangles: number; memoryMB: number;
  /** the ground's tiles; things still pending; what the governor dropped to hold the budget */
  tiles: Record<string, number> | null; loading: number; dropped: string[];
  budget: Budget | null;
  /** the quality now, what the device picked, its tier, and why */
  quality: { now: Quality; auto: Quality | null; tier: 'low' | 'mid' | 'high' | null; why: string };
  /** draw on demand: frames drawn in the last second, the highest rate wanted and by whom, resting, ms rested in all */
  frames: { fps: number; wants: number; who: string; resting: boolean; restedMs: number; drawn: number; /** your everyFrame work: its rate, its ms last frame against its budget */ every: { id: number; fps: number; ms: number; budgetMs: number }[] };
  /** each layer's share of the last frame (draws, triangles, ms), its graphics memory, the frames it wants */
  elements: { id: string; kind: string; shown: number; draws: number; triangles: number; ms: number; gpuMB: number; wants: number }[];
  /** graphics memory by layer (and '(world)': the world's own and what no layer names), the largest first */
  memory: { id: string; MB: number }[];
}
const ID = /^[A-Za-z0-9_-]+$/;
const IDENTITY = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
let worlds = 0;

export class World implements WorldLike {
  readonly id = `world-${++worlds}`;
  readonly camera: Camera;
  readonly body: Body | null;
  readonly loader: Loader;
  readonly renderer: Renderer | null;
  readonly graphics: Graphics | null;
  readonly profile: Profile | null;
  /** which graphics runs, and why */
  readonly api: Api | 'none'; readonly reason: string;
  readonly views = new Map<string, View>();
  /** the shape packages this world uses (core › geometry › shapes › recipes › package): use, make, load a catalogue */
  readonly shapes = new ShapeShelf();
  user: UserState;
  time: Date;
  private timeIsNow: boolean;
  /** seconds of world time per second (0: it stands still) */
  private clockRate = 1; private zones: ZoneTracker; private lastTimeLook = 0;
  /** the part of a ms the world's time has run past `time` (a Date holds whole ms) */
  private timeRest = 0;
  /** the world's time in ms, to the fraction (what a move's subject and a follow are taken at) */
  get timeMs(): number { return this.time.getTime() + this.timeRest; }
  private qualityNow: Quality | null = null; private qualityFn: ((s: State) => Quality) | null = null;
  private elements: Element[] = [];
  private sorted: Element[] = [];
  private seq = 0;
  /** the observation levels (null: none, a GIS map) and the gates a level change passes */
  private levelsObj: Levels | null = null; private gates: Gates | null = null;
  private paramDefs = new Map<string, ParamDef>();
  private readDefs = new Map<string, () => unknown>();
  private pointDefs = new Map<string, () => LonLatH>();
  private ev: { [K in keyof Events]?: Set<(...e: Events[K]) => void> } = {};
  readonly context: 'app' | 'video';
  private lastDraws: DrawCall[] = [];
  private pickTarget: GTarget | null = null; private picking = false; private pointer: { x: number; y: number; cx: number; cy: number } | null = null; private hoverWanted = false;
  /** two scenarios side by side (core › data › scenarios: compare): the layers hidden left of `at` (0..1 of the width)
   *  and right of it; null: one picture */
  compareView: { at: number; leftHides: Set<Element>; rightHides: Set<Element> } | null = null;
  /** scenarios (core › data › scenarios): w.scenario(name, { set, params, rules }) · .use · .diff · .compare */
  readonly scenario: ScenarioApi = ((w: World) => scenarioApi({
    get elements() { return w.elements; }, get loader() { return w.loader; },
    add: (...l) => w.add(...l), remove: (id) => w.remove(id), element: (id) => w.elements.find((l) => l.id === id),
    get: (k) => w.get(k), set: (k, v) => w.set(k, v), invalidate: () => w.invalidate(), error: (e) => w.error(e),
    get compareView() { return w.compareView; }, set compareView(v) { w.compareView = v; },
    get canvasElement() { return w.canvasEl; },
  }))(this);
  private hoverNow: Picked | null = null; private tip: HTMLElement | null = null; private canvasEl: HTMLCanvasElement | null = null;
  private tipOpts: WorldOptions['tooltip'];
  private nowMs = 0; private frameN = 0; private groundTarget = 0; private disposed = false; private ownLoader: boolean;
  private detachControls: (() => void) | null = null;
  private stateCache: State | null = null;
  /** time a paused world spent settling without moving its clock (loading and fade-ins go on by it) */
  private holdMs = 0;
  /** a follow (core › observation › observers › orbit › follow): its target, what it keeps (the centre always; the
   *  heading and the distance when asked), its springs, the hands' counts when it started, the eye's distance from
   *  the target and the target's height over the ground last frame */
  private following: { target: Target; heading: number | null; dist: number | null; f: Follower; hands: { pan: number; turn: number; zoom: number }; eye: number; up: number; seen: boolean; last: [number, number, number] | null } | null = null;
  /** the move playing or played last (a move after it on the same thing carries its springs on) */
  private shot: Shot | null = null;
  private loading = new Set<Promise<void>>();
  private errorHandler: (e: unknown) => void;
  /** how marks lying on the ground are drawn (WorldOptions.groundMarks) */
  readonly groundMarks: 'prisms' | 'tiles';
  /** groundMarks was chosen (WorldOptions.groundMarks): it holds for every ground mark; else each draws into the
   *  ground's tiles only where they pay (relief under it, and it holds still) */
  readonly groundMarksChosen: boolean;
  /** the light this frame (from the first layer that gives one: a sky with a sun); null: every mark keeps its own shading */
  private lightNow: Light | null = null;
  private shadowOpts: ShadowOptions | null = null;
  private shadowTarget: import('../render/graphics/interface.ts').GTarget | null = null; private shadowBuf: GBuffer | null = null; private noShadow: GTexture | null = null;
  private shadowData = new Float32Array(FRAME_FLOATS);
  /** the shadow map drawn last frame: its size, the casters drawn, ms on the main thread */
  private shadowStats = { on: false, size: 0, casters: 0, ms: 0, radius: 0, kept: false };
  /** what the sun's shadow map was last drawn from (the same: it is kept) */
  // ── the credits on screen ──
  private creditsOpts: Exclude<WorldOptions['attribution'], false | undefined> | null = null; private creditsEl: HTMLElement | null = null; private creditsText = ''; private creditsAt = -1e9;
  /** the credits box brought up to date (twice a second at most; only when its text changed) */
  private credits(): void {
    const o = this.creditsOpts, cv = this.canvasEl; if (!o || !cv || typeof document === 'undefined') return;
    // (a recording's frames each carry their own credits: not held to the real clock's twice a second)
    const now = this.nowReal(); if (now - this.creditsAt < 500 && !this.recordingNow) return; this.creditsAt = now;
    const list = this.attribution(), text = o.format ? o.format(list) : list.join(' · ');
    if (text === this.creditsText) return; this.creditsText = text;
    if (!this.creditsEl) {
      const el = document.createElement('div'), pos = o.position ?? 'bottom-right', parent = cv.parentElement;
      if (!parent) return;
      if (getComputedStyle(parent).position === 'static') parent.style.position = 'relative';
      el.className = o.className ?? 'aslnut-credits';
      // one line, cut with an ellipsis (on a phone the full list ran over the page's own controls); a tap shows it all
      if (!o.className) {
        Object.assign(el.style, { font: '10px/1.3 system-ui, sans-serif', color: 'rgba(255,255,255,.8)', textShadow: '0 0 3px #000', maxWidth: '72%', pointerEvents: 'auto', cursor: 'pointer', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', textAlign: pos.endsWith('right') ? 'right' : 'left' });
        el.addEventListener('click', () => { const open = el.style.whiteSpace === 'nowrap'; el.style.whiteSpace = open ? 'normal' : 'nowrap'; el.style.background = open ? 'rgba(0,0,0,.55)' : ''; el.style.padding = open ? '4px 6px' : ''; el.style.borderRadius = open ? '6px' : ''; });
      }
      Object.assign(el.style, { position: 'absolute', zIndex: '5', [pos.startsWith('bottom') ? 'bottom' : 'top']: pos.startsWith('bottom') ? 'calc(3px + env(safe-area-inset-bottom, 0px))' : '3px', [pos.endsWith('right') ? 'right' : 'left']: '6px' });
      parent.insertBefore(el, cv.nextSibling); this.creditsEl = el;
    }
    this.creditsEl.textContent = text; this.creditsEl.title = text;
  }
  // ── forms on the hovered and the selected things (core › interaction › picking › hover; signals › selection) ──
  private formLayer: import('../interaction/picking/forms.ts').FormMarks | null = null; private pickedById = new Map<string, Picked>();
  /** a thing picked (its place for a selected form later): the last few hundred kept */
  private remember(f: Picked): void { const k = String(f.id); this.pickedById.delete(k); this.pickedById.set(k, f); if (this.pickedById.size > 400) this.pickedById.delete(this.pickedById.keys().next().value!); }
  /** show a layer's form on a thing (the forms' layer made on first need: none asked, nothing made) */
  private async formFor(key: string, f: Picked | null, vis: FormVisual | false | undefined): Promise<void> {
    if (!this.formLayer) {
      if (!f || !vis || !vis.shape) return;
      const { FormMarks } = await import('../interaction/picking/forms.ts');
      if (this.disposed) return;
      if (!this.formLayer) { this.formLayer = new FormMarks(); this.add(this.formLayer); }
    }
    const layerOf = (x: Picked) => { try { return this.element(x.element); } catch { return null; } };
    this.formLayer.set(key, f, vis, (x) => layerOf(x)?.placeOf(x) ?? (x.at ? { at: [x.at[0], x.at[1], (x.at[2] ?? 0) * this.exaggeration], turn: 0, scale: [1, 1, 1] } : null));
    this.invalidate();
  }
  // ── ahead of need: views the camera will reach ──
  /** the poses of views (named or given), as the camera would frame them */
  private posesOf(views: readonly (View | string)[]): Pose[] { return views.map((v) => this.camera.framed(poseOf(this.resolve(v)))); }
  /** layers that know what views will load (the ground: its tiles) */
  private planners(): { l: Element; plan: (p: Pose[]) => string[] }[] { return this.sorted.flatMap((l) => { const f = (l as unknown as { plan?: (p: Pose[]) => string[] }).plan; return typeof f === 'function' ? [{ l, plan: f.bind(l) }] : []; }); }
  private prefetchN = 0;
  /** views the camera will reach soon: their ground loads ahead with room left (between frames too: a still view's
   *  idle time), the coarser levels first (`depth`). Resolves when they are in, or at `timeout` (ms, default 30000);
   *  a new call replaces the views */
  prefetch(views: readonly (View | string | Pose)[], o: { depth?: number; timeout?: number } = {}): Promise<{ needed: number; have: number }> {
    const poses = views.map((v) => (typeof v === 'object' && 'pitch' in v ? (checkPose(v, 'prefetch'), v) : this.posesOf([v])[0]!)), n = ++this.prefetchN, t0 = this.nowReal();
    // the levels these views are looked at: their elements get ready too (between frames, a few ms at a time)
    this.aheadLevels = this.levelsOf(poses); this.soonAt = -1e9;
    type Ahead = { prefetch(v: Pose[], o?: { depth?: number }): void; pumpAhead(): { needed: number; have: number } | null };
    const ls = this.sorted.filter((l) => typeof (l as unknown as Partial<Ahead>).pumpAhead === 'function') as unknown as Ahead[];
    for (const l of ls) l.prefetch(poses, { depth: o.depth });
    return new Promise((done) => {
      let had = -1, since = t0;
      const pump = () => {
        if (this.disposed || n !== this.prefetchN) { done({ needed: 0, have: 0 }); return; }
        let needed = 0, have = 0; for (const l of ls) { const r = l.pumpAhead(); if (r) { needed += r.needed; have += r.have; } }
        if ((needed > 0 && have >= needed) || this.nowReal() - t0 > (o.timeout ?? 30000) || !ls.length) { for (const l of ls) l.prefetch([]); if (!this.recordingNow) this.aheadLevels = null; done({ needed, have }); return; }
        // no progress for a second while the view rests: one frame (the ground's tiles make room, retry what failed and
        // take in what arrived on their own clock, which moves with frames)
        if (have !== had) { had = have; since = this.nowReal(); } else if (this.nowReal() - since > 1000) { since = this.nowReal(); this.invalidate(); }
        setTimeout(pump, 100);
      };
      pump();
    });
  }
  /** the levels poses are looked at, other than the one now (null: none, or no levels) */
  private levelsOf(poses: readonly Pose[]): Set<number> | null {
    const L = this.levelsObj; if (!L) return null;
    const here = L.index, lv = new Set(poses.map((p) => L.rungOf(zoomForDist(p.dist / this.camera.frameK, p.lat))).filter((i) => i !== here));
    return lv.size ? lv : null;
  }
  /** what views need, before the camera goes there: the URLs they will load, how many are kept (packs, the
   *  loader's stores), fetching and keeping them, and going through them one by one */
  readonly ready = {
    /** every URL these views will fetch (the ground's tiles, their fallbacks) */
    plan: (views: readonly (View | string)[]): { needed: string[] } => { const p = this.posesOf(views), u = new Set<string>(); for (const x of this.planners()) for (const url of x.plan(p)) u.add(url); return { needed: [...u] }; },
    /** how much of it is kept already (packs, the scope's store), and what is missing */
    coverage: async (views: readonly (View | string)[], o: { scope?: string } = {}): Promise<{ needed: number; have: number; missing: string[]; fraction: number }> => {
      const c = await this.loader.coverage(this.ready.plan(views).needed, o.scope);
      return { needed: c.total, have: c.have, missing: [...c.missing, ...c.absent], fraction: c.fraction };
    },
    /** fetch and keep what is missing (where the terms allow keeping) */
    ensure: (views: readonly (View | string)[], o: { scope?: string; concurrency?: number; onProgress?: (done: number, total: number, bytes: number) => void } = {}): Promise<EnsureResult> => this.loader.ensure(this.ready.plan(views).needed, o),
    /** go to each view and wait for it to settle: how long, and what was missing (the camera put back after) */
    rehearse: async (views: readonly (View | string)[], o: { timeout?: number } = {}): Promise<{ view: string; settled: boolean; ms: number; frames: number; pending: string[]; missing: string[] }[]> => {
      const back = this.camera.pose, out = [];
      for (const v of views) {
        const t0 = this.nowReal(); this.go(v); const ok = await this.settled({ timeout: o.timeout ?? 60000 }), r = this.report();
        out.push({ view: typeof v === 'string' ? v : `${v.lon.toFixed(4)},${v.lat.toFixed(4)}`, settled: ok, ms: Math.round(this.nowReal() - t0), frames: r.frames, pending: r.pending, missing: r.missing });
      }
      this.camera.jump(back); this.invalidate();
      return out;
    },
  };
  // ── the budget: the governor's rungs, and the page's log ──
  private gov: Governor | null = null; private governorOpts: GovernorOptions | false | undefined;
  /** the lowest pixel ratio the governor steps the picture down to */
  private resolutionFloor = 1.5;
  /** the governor's drops: the pixel ratio caps taken, the shadow map halved (3: off), the detail, quality lite */
  private ratioCaps: (number | null)[] = []; private shadowDrop = 0; private detailNow = 1; private qualityDrop = false;
  private remote: RemoteLog | null = null; private heartbeat: ReturnType<typeof setInterval> | null = null; private gaps: number[] = [];
  /** what a frame may cost now (null: no budget), and what the governor has dropped to hold it */
  get governor(): { budget: Budget; dropped: string[] } | null { return this.gov ? { budget: { ...this.gov.budget }, dropped: this.gov.drops } : null; }
  /** a new budget, or none (null: everything dropped comes back) */
  setBudget(b: Budget | null): this {
    if (!b) { this.gov?.reset(); this.gov = null; this.stateCache = null; this.invalidate(); return this; }
    if (this.gov) { this.gov.budget = { ...b }; return this; }
    const go = this.governorOpts;
    this.gov = new Governor({ ...b }, go === false ? { ladder: [] } : go ?? {}, this.rungs());
    return this;
  }
  /** the app's priorities (core › runtime › detail › priorities) */
  private prio: Priorities = {};
  /** what the governor drops first and what never (each a rung of the world's or an element by id): the ladder made
   *  again, everything dropped given back first; the kept elements pinned */
  setPriorities(p: Priorities): this {
    this.prio = { ...p }; for (const l of this.elements) { l.detailPinned = !!p.keep?.includes(l.id); }
    this.gov?.setLadder(this.rungs()); this.stateCache = null; this.invalidate();
    return this;
  }
  /** an event of your own to the page's log (`log` set; level 'info') */
  log(ev: string, data: Record<string, unknown> = {}): void { this.remote?.send(ev, data, 'info'); }
  /** the world's ladder: detail first (¾, ½), the sun's shadow map (half, a quarter, off), quality lite, and only then
   *  the pixel ratio, down to a floor (1.5, or the screen's when it is less; smoothed by FXAA while it is cut) */
  private rungs(): GovernorRung[] {
    const r = this.renderer, changed = () => { this.stateCache = null; this.invalidate(); };
    const floor = this.resolutionFloor;
    // the app's order first (a rung of the world's, or an element by id: its own detail ¾, ½, ¼), then the
    // world's in its own; a kept rung never
    const own = this.worldRungs(r, changed, floor), drop = this.prio.drop ?? [], keep = new Set(this.prio.keep ?? []);
    const byName = new Map(own.map((x) => [x.name, x]));
    const first = drop.filter((n) => !keep.has(n)).map((n) => byName.get(n) ?? this.elementRung(n, changed));
    return [...first, ...own.filter((x) => !drop.includes(x.name) && !keep.has(x.name))];
  }
  /** an element's own rung: its detail ¾, ½, ¼ (coarser levels sooner, fewer copies over time; never hidden: hiding
   *  one is the app's own call, on the governor's event) */
  private elementRung(id: string, changed: () => void): GovernorRung {
    return {
      name: id,
      down: () => { const l = this.elements.find((x) => x.id === id); if (!l || l.detailPinned || l.detailOwn <= 0.25) return null; l.detailOwn -= 0.25; changed(); return `${id} ${l.detailOwn}`; },
      up: () => { const l = this.elements.find((x) => x.id === id); if (!l) return; l.detailOwn = Math.min(1, l.detailOwn + 0.25); changed(); },
    };
  }
  private worldRungs(r: World['renderer'], changed: () => void, floor: number): GovernorRung[] {
    return [
      { name: 'detail', down: () => { if (this.detailNow <= 0.5) return null; this.detailNow -= 0.25; changed(); return `detail ${this.detailNow}`; }, up: () => { this.detailNow = Math.min(1, this.detailNow + 0.25); changed(); } },
      { name: 'shadows', down: () => { if (!this.shadowOpts || this.shadowDrop >= 3) return null; this.shadowDrop++; changed(); return this.shadowDrop >= 3 ? 'shadows off' : `shadows ${this.shadowDrop === 1 ? 'half' : 'quarter'}`; }, up: () => { this.shadowDrop = Math.max(0, this.shadowDrop - 1); changed(); } },
      { name: 'quality', down: () => { if (this.qualityDrop || this.state.render.quality === 'lite') return null; this.qualityDrop = true; changed(); return 'quality lite'; }, up: () => { this.qualityDrop = false; changed(); } },
      { name: 'resolution', down: () => {
        if (!r) return null; const full = r.fullRatio, lo = Math.min(floor, full); if (full <= lo + 0.01) return null;
        const next = Math.max(lo, Math.floor((full - 0.5) * 4) / 4); this.ratioCaps.push(r.cap); r.setCap(next); changed(); return `resolution ${next}`;
      }, up: () => { r?.setCap(this.ratioCaps.pop() ?? null); changed(); } },
    ];
  }
  /** a drawn frame after a drawn frame: the governor's sample, the heartbeat's frame times */
  private sample(gapMs: number): void {
    this.recentGaps.push(gapMs); if (this.recentGaps.length > 120) this.recentGaps.shift();
    if (this.remote?.level === 'info') { this.gaps.push(gapMs); if (this.gaps.length > 240) this.gaps.splice(0, 120); }
    const gv = this.gov; if (!gv) return;
    const b = gv.budget, g = this.graphics;
    let tris = 0; if (b.triangles !== undefined) for (const d of this.lastDraws) tris += (d.count * (d.instanceCount ?? 1)) / 3;
    const e = gv.frame({ gapMs, cpuMs: this.renderer?.cpuMs ?? 0, gpuMs: g?.stats.gpuMs ?? null, draws: g?.stats.draws ?? 0, triangles: tris, gpuMB: b.memoryMB !== undefined ? (g?.bytes ?? 0) / 1048576 : 0 });
    if (!e) return;
    this.emit('governor', e);
    this.remote?.send('governor', { ...e }, 'warn');
  }
  /** a heartbeat a second for the page's log (level 'info') */
  private beat(): void {
    if (this.disposed || !this.remote) return;
    const xs = this.gaps.splice(0).sort((a, b) => a - b), q = (k: number) => (xs.length ? Math.round(xs[Math.min(xs.length - 1, Math.floor(xs.length * k))]!) : 0);
    const st = this.stats(), p = this.frameProfile(), t = st.tiles as Record<string, number> | null;
    this.remote.send('hb', { api: this.api, fps: Math.round(st.fps), zoom: +st.zoom.toFixed(2), p50: q(0.5), p95: q(0.95), max: q(1), long: xs.filter((x) => x > 33.4).length, draws: p.draws, gpuMs: p.gpuMs, size: p.size, pr: p.pixelRatio, gpuMB: Math.round(st.gpuBytes / 1048576), tiles: t?.visible, loading: t?.loading, dropped: this.gov?.drops ?? [] });
  }
  // ── the analysis view (core › render › style › theme) ──
  private themeS = new ThemeState(); private subjectBlock: GBuffer | null = null; private subjectData = new Float32Array(FRAME_FLOATS);
  /** this frame's draws of a theme's subject layers (their marks on the ground's tiles are never muted) */
  private subjectDraws = new Set<DrawCall>();
  /** the analysis view: a theme (theme.dark(), .grey(), .light(), your own) eased in over its `seconds` (or yours; 0:
   *  at once), from the one shown to it; null (or theme.none()) eases it out */
  setTheme(t: Theme | null, o: { seconds?: number } = {}): this { this.themeS.set(t, o.seconds); this.invalidate(); return this; }
  /** the theme asked for (null: none) */
  get theme(): Theme | null { return this.themeS.asked; }
  /** what the theme does now: how much it mutes (eased), the sky's dim; null: no theme shown */
  get themeNow(): ThemeNow | null { return this.themeS.shownTheme ? this.themeS : null; }
  /** the frame block for a theme's subjects: this frame's, with nothing muted */
  private subjectFrame(f: Float32Array): GBuffer {
    const d = this.subjectData; d.set(f); this.themeS.write(d, 100, 0);
    this.subjectBlock ??= this.graphics!.buffer('uniform', FRAME_FLOATS * 4, 'frame (a theme\'s subjects)');
    this.subjectBlock.write(d);
    return this.subjectBlock;
  }
  private shadowSig = ''; private progNos = new WeakMap<object, number>(); private progN = 0;
  private progNo(p: object): number { let n = this.progNos.get(p); if (n === undefined) { n = ++this.progN; this.progNos.set(p, n); } return n; }

  constructor(o: { body: Body | null; camera: Camera; loader: Loader; ownLoader: boolean; graphics: Graphics | null; reason: string; profile: Profile | null; canvas: HTMLCanvasElement | OffscreenCanvas | null; opts: WorldOptions }) {
    this.body = o.body; this.camera = o.camera; this.loader = o.loader; this.ownLoader = o.ownLoader;
    this.graphics = o.graphics; this.profile = o.profile; this.api = o.graphics?.api ?? 'none'; this.reason = o.reason;
    this.user = { selection: [], hover: null, toggles: {}, role: 'viewer', ...o.opts.user };
    this.timeIsNow = o.opts.time === undefined || o.opts.time === 'now';
    this.time = o.opts.time instanceof Date ? o.opts.time : new Date();
    this.clockRate = this.timeIsNow ? 1 : 0; this.zones = this.zoneTracker(o.opts.timeZone);
    this.errorHandler = o.opts.onError ?? ((e) => console.error(e));
    // lite (WebGL2's and every phone's default) and touch devices (on either graphics): into the ground's tiles (one
    // pass a frame, the marks drawn again only when they change) where that pays: relief under the mark, and the mark
    // holding still (each layer decides; on level ground the flat route, one face per piece); else exact prisms over
    // the frame. Measured on two mid-range phones' WebGL2: tiles 66 / 57 fps, prisms 52 / 43 (against the
    // prisms on terrain, not the flat route)
    const phone = o.profile?.touch ?? isTouch();
    const qo = o.opts.render?.quality ?? o.opts.quality; this.qualityFn = typeof qo === 'function' ? qo : null;
    this.groundMarksChosen = o.opts.groundMarks !== undefined;
    this.groundMarks = o.opts.groundMarks ?? (((typeof qo === 'string' && qo !== 'auto' ? qo : undefined) ?? o.profile?.quality) === 'lite' || phone ? 'tiles' : 'prisms');
    this.context = o.opts.context ?? 'app'; this.tipOpts = o.opts.tooltip;
    const sh = o.opts.render?.shadows; this.shadowOpts = sh ? (sh === true ? {} : sh) : null;
    for (const [k, v] of Object.entries(o.opts.views ?? {})) this.addView(k, v);
    this.renderer = o.graphics && o.canvas ? new Renderer(o.canvas, o.graphics, {
      maxPixelRatio: o.profile?.maxPixelRatio ?? 2, pixelRatio: o.opts.pixelRatio, clock: o.opts.clock,
      tick: (dt) => this.tick(dt), onError: (e) => this.error(e),
      onLong: (gapMs) => {
        if (this.ev.long?.size) this.emit('long', { gapMs, profile: this.frameProfile() });
        if (this.remote) { const p = this.frameProfile(); this.remote.send('long', { gapMs: Math.round(gapMs), tickMs: +p.tickMs.toFixed(1), submitMs: +p.submitMs.toFixed(1), elements: p.elements.slice(0, 3), draws: p.draws, gpuMs: p.gpuMs }, gapMs > 100 ? 'warn' : 'info'); }
      },
      onFrame: (gapMs) => this.sample(gapMs),
      needsFrame: o.opts.renderOnChange === false ? undefined : () => this.needsFrame(),
      rest: o.opts.frames?.rest === false ? false : { after: o.opts.frames?.rest ?? 500, look: 250 },
      nextIn: () => this.nextIn(), busy: () => this.preparing, restNow: () => this.restNow(),
      moving: () => this.camera.moving || this.following !== null,
      // off unless asked: every switch resizes the canvas (its buffers made again, the ground's tiles' marks drawn
      // again), a hitch at the start and the end of each gesture; measured on phones, a steady 1.5 is smoother
      movingPixelRatio: o.opts.resolution?.moving ?? 0,
      antialias: o.opts.resolution?.antialias ?? 'auto',
    }) : null;
    // draw on demand: anything that moves the camera (a flight, a jump, a hand on it) wakes a resting loop
    this.framesOpts = o.opts.frames ?? {}; this.lastTimeLook = this.nowReal();
    this.camera.changed = () => this.renderer?.wake();
    // the eye kept over the ground under it and what is stood on there (the level nearest the eye)
    this.camera.under = (lon, lat, y) => { const ex = this.exaggeration, g = this.standAt(lon, lat, y / ex); return Number.isFinite(g) ? g * ex : NaN; };
    this.creditsOpts = o.opts.attribution === false ? null : o.opts.attribution ?? {};
    const lg = o.opts.log; if (lg) this.remote = new RemoteLog(typeof lg === 'string' ? { url: lg } : lg);
    if (this.remote?.level === 'info') this.heartbeat = setInterval(() => this.beat(), 1000);
    this.resolutionFloor = o.opts.resolution?.floor ?? 1.5;
    // the budget: yours, or the device's (auto, the default: a phone is held to 30 frames a second at the least)
    const bo = o.opts.budget ?? 'auto', budget = bo === 'auto' ? o.profile?.budget ?? null : bo === false ? null : bo;
    this.governorOpts = o.opts.governor; this.prio = o.opts.priorities ?? {}; if (budget) this.setBudget(budget);
    if (o.opts.theme) this.themeS.set(o.opts.theme, 0);
    if (o.graphics) void o.graphics.lost.then((why) => { if (!this.disposed) this.error(new AslnutError('E-GPU-004', `${this.api === 'webgpu' ? 'WebGPU' : 'WebGL2'}: ${why}`, { fix: 'reload the page' })); });
    if (o.canvas && 'addEventListener' in o.canvas && o.opts.controls !== false && typeof window !== 'undefined') {
      const el = o.canvas as HTMLCanvasElement; this.canvasEl = el;
      if (typeof o.opts.controls === 'object') this.camera.interrupt = o.opts.controls.interrupt ?? true;
      let touch = false;
      const off = this.camera.attach(el, (x, y) => { this.tapAt(x, y, touch).catch((e: unknown) => { if (!this.disposed) this.error(e); }); });
      const down = (e: PointerEvent) => { touch = e.pointerType !== 'mouse'; this.movedAt = this.nowReal(); this.renderer?.wake(); };
      const move = (e: PointerEvent) => {
        if (e.buttons !== 0) { this.movedAt = this.nowReal(); this.renderer?.wake(); }
        if (e.pointerType !== 'mouse' || e.buttons !== 0 || o.opts.hover === false) return;
        this.renderer?.wake();
        const r = el.getBoundingClientRect(); this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top, cx: e.clientX, cy: e.clientY }; this.hoverWanted = true;
      };
      const leave = () => { this.pointer = null; this.hoverWanted = false; this.setHover(null, null).catch(() => {}); };
      el.addEventListener('pointerdown', down); el.addEventListener('pointermove', move); el.addEventListener('pointerleave', leave);
      this.detachControls = () => { off(); el.removeEventListener('pointerdown', down); el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); };
    }
  }

  // ── the body and layers ─────────────────────────────────────────────────────────────────────────────────────
  get graphicsApi(): string { return this.api; }
  /** bumped whenever the ground's heights change (draped layers read the ground again) */
  get groundVersion(): number { let v = 0; for (const l of this.elements) { const g = (l as unknown as { groundVersion?: number }).groundVersion; if (typeof g === 'number') v += g; } return v; }
  get exaggeration(): number { return this.body?.exaggeration?.(this.state) ?? 1; }
  /** the ground's height (m, true) where the surface knows it; NaN where it does not (yet) */
  heightAt(lon: number, lat: number): number {
    // the layers that know the ground, found once per change of the layer list (this is called very often)
    if (this.grounds === null) { this.grounds = []; for (const l of this.elements) { const f = (l as unknown as { heightAt?: (lon: number, lat: number) => number }).heightAt; if (f) this.grounds.push(f.bind(l)); } }
    for (let i = 0; i < this.grounds.length; i++) { const h = this.grounds[i]!(lon, lat); if (!Number.isNaN(h)) return h; }
    return NaN;
  }
  private grounds: ((lon: number, lat: number) => number)[] | null = null;
  /** where something stands (m, true): the top of what is drawn there (a road, a kerb, a footpath, a deck: the layers
   *  that draw surfaces to stand on, core › space › stands), the level nearest `near` (the height it had, true m; NaN:
   *  the lowest drawn); the ground where nothing is drawn; NaN where neither is known (yet) */
  standAt(lon: number, lat: number, near = NaN): number {
    if (this.stands === null) { this.stands = []; for (const l of this.elements) { const f = (l as unknown as Partial<Stands>).levelsAt; if (f) this.stands.push(f.bind(l)); } }
    const g = this.heightAt(lon, lat); if (!this.stands.length) return g;
    const out = this.standLevels; out.length = 0;
    for (let i = 0; i < this.stands.length; i++) this.stands[i]!(lon, lat, out);
    return standOn(out, g, near);
  }
  private stands: Stands['levelsAt'][] | null = null; private standLevels: number[] = [];
  /** bumped whenever what is stood on changes (a street tile built or let go): things put down stand again */
  get standVersion(): number { let v = this.groundVersion; for (const l of this.elements) { const g = (l as unknown as Partial<Stands>).standVersion; if (typeof g === 'number') v += g; } return v; }
  /** the lowest and highest ground drawn in a box (true m), from the surface's tiles; null where no layer knows */
  rangeIn(w: number, s: number, e: number, n: number): [number, number] | null {
    for (const l of this.elements) { const f = (l as unknown as { rangeIn?: (w: number, s: number, e: number, n: number) => [number, number] | null }).rangeIn; if (f) { const r = f.call(l, w, s, e, n); if (r) return r; } }
    return null;
  }
  /** add layers: params become `<id>.<name>`, readouts `<id>.<name>`, points `<id>.<name>` */
  add(...ls: Element[]): this {
    this.alive();
    for (const l of ls) {
      if (!l || typeof l.frame !== 'function') throw new AslnutError('E-WORLD-001', 'w.add() takes elements', { fix: 'pass points({ … }), layer({ … }), custom({ … }) or your own Element' });
      if (this.elements.some((x) => x.id === l.id)) throw new AslnutError('E-WORLD-001', `two elements with id '${l.id}'`, { where: l.id, fix: 'give each element its own id' });
      // an element asking for a level turns the default ladder on (a world with none had nothing to ask)
      const wl = l.props.when as { level?: unknown } | undefined;
      if (!this.levelsObj && wl && typeof wl === 'object' && wl.level !== undefined) this.observe({ levels: 'default' });
      l.added = this.seq++; l.detailPinned = !!this.prio.keep?.includes(l.id);
      const used = new Set(this.elements.map((x) => x.pickNo));
      l.pickNo = 0; for (let k = 1; k < 256; k++) if (!used.has(k)) { l.pickNo = k; break; }
      this.elements.push(l);
      for (const [k, d] of Object.entries(l.params())) this.paramDefs.set(`${l.id}.${k}`, d);
      for (const [k, f] of Object.entries(l.readouts())) this.readDefs.set(`${l.id}.${k}`, f);
      for (const [k, f] of Object.entries(l.points())) this.pointDefs.set(`${l.id}.${k}`, f);
      // a frame when it is added and another when its attach settles (its programs ready): a world at rest asks for
      // no frames, and a layer whose programs compile before the loop looks again would otherwise never be drawn
      const p = l.attach({ graphics: this.graphics, loader: this.loader, profile: this.profile, camera: this.camera, world: this })
        .catch((e: unknown) => { l.failure = e instanceof Error ? e : new Error(String(e)); this.error(e); })
        .finally(() => { this.loading.delete(p); if (!this.disposed) this.invalidate(); });
      this.loading.add(p);
      // the layers it brings (an instance set's counts): added after it
      const more = l.companions?.() ?? []; if (more.length) this.add(...more);
    }
    this.resort();
    this.invalidate();
    this.emit('elements', { what: 'add', ids: ls.map((l) => l.id) });
    return this;
  }
  remove(id: string): this {
    const l = this.element(id);
    for (const x of this.elements) if (x.above === id || x.below === id) throw new AslnutError('E-WORLD-002', `'${x.id}' is placed ${x.above === id ? 'above' : 'below'} '${id}'`, { where: id, fix: `move '${x.id}' first` });
    this.elements = this.elements.filter((x) => x !== l);
    for (const m of [this.paramDefs, this.readDefs, this.pointDefs]) for (const k of [...m.keys()]) if (k.startsWith(`${id}.`)) m.delete(k);
    l.detach(); this.gates?.forget(l); this.resort();
    for (const c of l.companions?.() ?? []) if (this.elements.includes(c)) this.remove(c.id);
    this.invalidate();
    this.emit('elements', { what: 'remove', ids: [id] });
    return this;
  }
  /** a layer by id (a dotted key reads a param instead: w.get('heat.gain')) */
  get(idOrKey: string): unknown { return idOrKey.includes('.') ? this.paramOf(idOrKey).get() : this.element(idOrKey); }
  element(id: string): Element {
    const l = this.elements.find((x) => x.id === id);
    if (!l) throw new AslnutError('E-WORLD-002', `no element '${id}'`, { fix: `the elements: ${this.elements.map((x) => x.id).join(', ') || 'none'}` });
    return l;
  }
  get list(): readonly Element[] { return this.sorted; }

  // ── observation (core › observation): the level looked at ─────────────────────────────────────────────────────
  /** the level looked at now (null: no levels) */
  get level(): string | null { return this.levelsObj?.level ?? null; }
  /** the ladder (null: no levels) */
  get levels(): readonly Rung[] | null { return this.levelsObj?.ladder ?? null; }
  /** the observation: its levels, gates and what they did (null: none) */
  get observation(): { level: string; by: string; ladder: readonly Rung[]; margin: number; dwell: number; ahead: number; keep: { levels: number; seconds: number }; waiting: boolean; swapping: boolean; counts: Gates['counts'] } | null {
    const L = this.levelsObj, g = this.gates; if (!L || !g) return null;
    return { level: L.level, by: L.by, ladder: L.ladder, margin: L.margin, dwell: L.dwell, ahead: L.ahead, keep: L.keep, waiting: L.waiting !== null, swapping: g.swap !== null, counts: g.counts };
  }
  /** look at this world by levels (a ladder, the binding, the gates); null: no levels again (everything shown as its
   *  own `when` says, with no level) */
  observe(o: ObservationOptions | null): this {
    if (o === null) { this.levelsObj = null; this.gates = null; }
    else { this.levelsObj = new Levels(o, this.camera.zoom, this.levelsObj ? undefined : undefined); this.gates = new Gates(this.levelsObj); }
    this.stateCache = null; this.invalidate();
    return this;
  }
  /** the app sets the level (the orbit drives it again once it crosses its next edge, past the margin) */
  setLevel(name: string): this {
    if (!this.levelsObj) this.observe({ levels: 'default' });
    const ch = this.levelsObj!.set(name);
    if (ch) this.levelChanged(ch);
    return this;
  }
  private levelChanged(ch: LevelChange): void {
    this.stateCache = null;
    this.gates!.begin(ch, this.sorted, this.state, this.nowMs);
    this.invalidate();
    this.emit('level', ch);
  }
  /** what work between frames is given (prepare, a swap): the frame's context without a frame drawn */
  private prepCtx(s: State, dt: number): FrameContext {
    return { graphics: this.graphics!, camera: this.camera, s, frame: this.renderer?.frameBlock as GBuffer, now: this.nowMs, loadNow: this.nowMs + this.holdMs, dt, world: this as WorldLike };
  }
  /** a step of the binding: the orbit's zoom through the margin and the dwell (each frame, and between frames while a
   *  change waits out its dwell) */
  private observeStep(): void {
    const L = this.levelsObj; if (!L) return;
    const ch = L.step(this.camera.zoom, this.nowMs, typeof L.bind === 'function' ? this.state : undefined);
    if (ch) this.levelChanged(ch);
  }
  elementsOfKind(kind: Element['kind']): readonly Element[] { return this.sorted.filter((l) => l.kind === kind); }
  /** change a layer's place in the draw order */
  move(id: string, to: { above?: string; below?: string; order?: number }): this {
    const l = this.element(id);
    l.setProps({ above: to.above, below: to.below, order: to.order } as never);
    this.resort();
    return this;
  }
  /** draw these layers in this order, bottom first (a layer list's stack): each keeps its band (a mark lying on the
   *  ground under the twin's solids, one floating over everything over them) and its place in the band is its place
   *  here. One frame, nothing built again: the order is a number on each */
  reorder(ids: readonly string[]): this {
    const ls = ids.map((id) => this.element(id));
    // the band: the draped marks (pictures, areas, lines: 1..3) are one band, so a line can go under an area
    // (by the layer's kind and where it sits, never by an order a stack gave it before)
    const band = (l: Element) => { if (l.sits === 'above' && (l.kind === 'area' || l.kind === 'line')) return 4.5; const r = KIND_ORDER[l.kind]; return r >= 1 && r < 4 ? 2 : r; };
    ls.forEach((l, k) => { l.props = { ...l.props, order: band(l) + (k + 1) / 1000, above: undefined, below: undefined }; l.restacked?.((k + 1) / 1000); });
    this.resort(); this.invalidate();
    this.emit('elements', { what: 'order', ids: ls.map((l) => l.id) });
    return this;
  }
  /** a layer's opacity (0..1): a uniform, one frame, nothing built again (a layer that cannot fade says so) */
  setOpacity(id: string, v: number): this {
    const l = this.element(id);
    if (!l.fades) throw new AslnutError('E-WORLD-004', `layer '${id}' cannot be made see-through`, { where: id, fix: 'only marks drawn from data and pictures fade (layer.fades)' });
    l.setProps({ opacity: Math.max(0, Math.min(1, v)) } as never);
    return this;
  }
  /** what an element owns (a layer's labels) shows and hides in the same time as it */
  private ownedOnce(l: Element, seconds: number | undefined): void { if (seconds === undefined) return; for (const x of this.elements) if (x.owner === l) x.once = seconds; }
  /** a layer's props changed (its setProps): sorted again where its place may have moved; a layer list told */
  elementChanged(l: Element, keys: string[]): void {
    if (!this.elements.includes(l)) return;
    if (keys.some((k) => k === 'order' || k === 'above' || k === 'below' || k === 'drape' || k === 'over' || k === 'occlude')) this.resort();
    this.emit('elements', { what: keys.length === 1 && keys[0] === 'opacity' ? 'opacity' : 'props', ids: [l.id] });
  }
  private resort(): void { this.sorted = sortElements(this.elements); this.grounds = null; this.stands = null; }

  // ── params, readouts, points ────────────────────────────────────────────────────────────────────────────────
  /** a knob of your own: a key, a spec, what setting it does */
  param(key: string, spec: ParamSpec, set: (v: unknown) => void, get?: () => unknown): this {
    if (!/^[A-Za-z0-9_-]+(\.[A-Za-z0-9_-]+)+$/.test(key)) throw new AslnutError('E-WORLD-004', `param key '${key}' must be dotted, like 'fault.glow'`, { fix: 'write <group>.<name>' });
    let val = spec.default;
    this.paramDefs.set(key, { ...spec, get: get ?? (() => val), set: (v) => { val = v; set(v); } });
    return this;
  }
  private paramOf(key: string): ParamDef {
    const d = this.paramDefs.get(key);
    if (!d) throw new AslnutError('E-WORLD-004', `no param '${key}'`, { fix: `the params: ${[...this.paramDefs.keys()].join(', ') || 'none'}` });
    return d;
  }
  set(key: string, v: unknown): this { this.paramOf(key).set(v); this.stateCache = null; this.invalidate(); return this; }
  /** every knob, for editors and assistants */
  params(): Record<string, ParamSpec & { value: unknown }> {
    const out: Record<string, ParamSpec & { value: unknown }> = {};
    for (const [k, d] of this.paramDefs) out[k] = { type: d.type, default: d.default, range: d.range, options: d.options, unit: d.unit, describe: d.describe, value: d.get() };
    return out;
  }
  readout(key: string, fn: () => unknown): this { this.readDefs.set(key, fn); return this; }
  read(key: string): unknown { const f = this.readDefs.get(key); if (!f) throw new AslnutError('E-WORLD-004', `no readout '${key}'`, { fix: `the readouts: ${[...this.readDefs.keys()].join(', ') || 'none'}` }); return f(); }
  point(name: string, fn: () => LonLatH): this { this.pointDefs.set(name, fn); return this; }
  pointAt(name: string): LonLatH | null { return this.pointDefs.get(name)?.() ?? null; }

  // ── views and the camera ────────────────────────────────────────────────────────────────────────────────────
  addView(name: string, v: View): this { checkView(v, `view '${name}'`); this.views.set(name, v); return this; }
  private resolve(v: View | string): View {
    if (typeof v === 'string') { const x = this.views.get(v); if (!x) throw new AslnutError('E-VIEW-001', `no view '${v}'`, { fix: `the views: ${[...this.views.keys()].join(', ') || 'none'}` }); return x; }
    checkView(v); return v;
  }
  /** jump to a view */
  go(v: View | string): this { this.camera.jump(this.resolve(v)); return this; }
  /** fly to a view; resolves on arrival */
  fly(v: View | string, o?: FlyOptions): Promise<void> {
    const p = this.camera.fly(this.resolve(v), o);
    // where it is going loads ahead, with room left (a flight of a second or more: a jump has no time for it; a
    // recording loads its own way ahead)
    if ((o?.seconds ?? 1) >= 1 && !this.recordingNow && this.sorted.some((l) => typeof (l as unknown as { pumpAhead?: unknown }).pumpAhead === 'function')) void this.prefetch([v], { timeout: ((o?.seconds ?? 6) + 2) * 1000 });
    return p;
  }
  /** play camera keys, or a camera move (core › observation › observers › orbit › moves: chase, crane, dolly, arc,
   *  reveal, track, your own): `seconds` it takes (a move without: it holds its first key until stopped), `ease` over
   *  its keys. A move ends a follow; a move after another on the same thing carries its springs on. Resolves when it
   *  ends (its time, a new move, a flight, a jump, a person's hands moving the camera). What a move or keys of a
   *  second or more will see loads ahead (where the terms allow) */
  play(k: Keys | Move, o: { loop?: boolean; seconds?: number; ease?: Ease } = {}): Promise<void> {
    if (!('aim' in k)) {
      const p = this.camera.play(k, o);
      if (k.duration >= 1 && !this.recordingNow && this.aheadAble()) { const n = 8, t0 = k.list[0]!.at; void this.prefetch(Array.from({ length: n + 1 }, (_, i) => viewOf(k.pose(t0 + (k.duration * i) / n))), { timeout: (k.duration + 2) * 1000 }); }
      return p;
    }
    const prev = this.shot, shot = new Shot(k, o, prev && prev.sameAim(k) ? prev.follower : undefined);
    this.shot = shot; this.following = null;
    const mw = this.moveWorld(), cam = this.camera;
    const p = cam.drive((dt) => {
      const r = shot.step(dt, mw, this.camInfo());
      if (r) cam.place(r.pose, r.ground);
      return shot.done;
    });
    // (its way ahead: the pose undamped at a few moments, the world's time running at its rate)
    if ((shot.seconds ?? 0) >= 1 && !this.recordingNow && this.aheadAble()) {
      const S = shot.seconds!, rate = this.clockRate, t0 = this.timeMs, n = Math.max(2, Math.min(12, Math.ceil(S)));
      const views = Array.from({ length: n + 1 }, (_, i) => shot.poseAt((S * i) / n, mw, this.camInfo(), t0 + ((S * i) / n) * rate * 1000)).filter((x): x is Pose => !!x);
      if (views.length) void this.prefetch(views, { timeout: (S + 2) * 1000 });
    }
    return p;
  }
  /** the move playing (null: none) */
  get playing(): Move | null { return this.camera.driving && this.shot ? this.shot.move : null; }
  /** what a move is played in: the ground, the named points, the world's time, what stands */
  moveWorld(): MoveWorld {
    const w = this;
    return { heightAt: (lon, lat) => w.heightAt(lon, lat), get exaggeration() { return w.exaggeration; }, pointAt: (n) => w.pointAt(n), get timeMs() { return w.timeMs; }, topIn: (a, b, c, d) => w.topIn(a, b, c, d) };
  }
  private camInfo() { const c = this.camera; return { pose: c.pose, groundY: c.groundY, fov: c.fov, floor: (h: number) => c.pitchAt(h) }; }
  /** some layer loads views ahead (the ground's tiles) */
  private aheadAble(): boolean { return this.sorted.some((l) => typeof (l as unknown as { pumpAhead?: unknown }).pumpAhead === 'function'); }
  /** the view that shows a box [w, s, e, n] (or features, or a feature) whole on this canvas, with a margin */
  viewToFit(target: BBox | Feature | readonly Feature[], o: FitOptions = {}): { lon: number; lat: number; zoom: number; tilt: number; bearing: number } {
    const b = Array.isArray(target) && typeof target[0] === 'number' ? target as BBox
      : (Array.isArray(target) ? target as unknown as readonly Feature[] : [target as Feature]).reduce<BBox | null>((acc, f) => bboxOf(f.geometry, acc ?? undefined) ?? acc, null);
    if (!b || !Number.isFinite(b[0])) throw new AslnutError('E-VIEW-001', 'nothing to fit: the box or features have no extent', { fix: 'fit a [w, s, e, n] box or features with geometry' });
    for (const k of ['padding', 'maxZoom'] as const) { const x = o[k]; if (x !== undefined && !(typeof x === 'number' && Number.isFinite(x))) throw new AslnutError('E-VIEW-001', `fit: ${k} is ${x}`, { where: 'fit', fix: `give ${k} as a finite number, or leave it out` }); }
    const lat = Math.max(-85, Math.min(85, (b[1] + b[3]) / 2)), lon = (b[0] + b[2]) / 2, c = this.camera;
    const wM = Math.max(1, (b[2] - b[0]) * 111320 * Math.cos(lat * D)), hM = Math.max(1, (b[3] - b[1]) * 110574);
    const aspect = Math.max(0.2, c.width / Math.max(1, c.height)), pad = 1 + 2 * (o.padding ?? 0.08);
    let dist = (Math.max(hM, wM / aspect) * pad) / (2 * Math.tan(c.fov / 2));
    if (o.maxZoom !== undefined) dist = Math.max(dist, distForZoom(o.maxZoom, lat) * c.frameK);
    // a view's zoom is the screen-shape-free one (the camera frames it again for this screen)
    return { lon, lat, zoom: zoomForDist(dist / c.frameK, lat), tilt: o.tilt ?? 0, bearing: o.bearing ?? 0 };
  }
  /** fly to show a box or features whole */
  fit(target: BBox | Feature | readonly Feature[], o: FitOptions & FlyOptions = {}): Promise<void> { return this.camera.fly(this.viewToFit(target, o), o); }
  /** keep the camera on a moving place or thing (a named point, [lon, lat, h], { lon, lat, up, heading }, a thing on
   *  a log: track(log, id), or your function of the world's time); null stops. It keeps the view's centre on it (a
   *  thing in the air: its point at the middle of the screen), the camera's distance and tilt as they are; `heading`
   *  turns the view with the thing (degrees from straight behind it; true: 0), `dist` keeps the eye that far from it.
   *  Each channel follows on a critically damped spring (`damping`: half-lives, dead zones, a look ahead, top speeds,
   *  the snap of a jump; `smooth`: the place's in ms, the old knob). A person's hands end it only when they move what
   *  it keeps (a pan; a turn when it keeps the heading; a zoom when it keeps the distance): a zoom round it goes on.
   *  Asked again while it follows (an app re-arming it each frame), it keeps its springs */
  follow(target: Target | null, o: { smooth?: number; damping?: Damping; heading?: boolean | number; dist?: number } = {}): this {
    if (o.smooth !== undefined && !(Number.isFinite(o.smooth) && o.smooth >= 0)) throw new AslnutError('E-VIEW-001', `follow: smooth is ${o.smooth}`, { where: 'follow', fix: 'give smooth in ms, a finite number 0 or more (default 250), or leave it out' });
    if (o.dist !== undefined && !(Number.isFinite(o.dist) && o.dist > 0)) throw new AslnutError('E-VIEW-001', `follow: dist is ${o.dist}`, { where: 'follow', fix: 'give dist in metres above 0, or leave it out' });
    if (typeof o.heading === 'number' && !Number.isFinite(o.heading)) throw new AslnutError('E-VIEW-001', `follow: heading is ${o.heading}`, { where: 'follow', fix: 'give heading as degrees from straight behind it (a finite number), true, or leave it out' });
    checkDamping(o.damping, 'follow');
    if (target === null) { this.following = null; return this; }
    checkTarget(target, 'follow');
    // (the old knob: smooth ms, the time a first-order follow lagged by; the place's half-life that lags as much)
    const damping: Damping = o.damping ?? (o.smooth !== undefined ? { place: { halfLife: (0.84 * o.smooth) / 1000, lead: 0 } } : {});
    const heading = o.heading === undefined || o.heading === false ? null : o.heading === true ? 0 : o.heading, c = this.camera, was = this.following;
    if (was) { was.target = target; was.f.damping = damping; was.heading = heading; was.dist = o.dist ?? null; return this; }
    if (c.driving) c.stop();
    this.following = { target, heading, dist: o.dist ?? null, f: new Follower(damping), hands: { ...c.hands }, eye: c.dist, up: 0, seen: false, last: null };
    return this;
  }
  /** a frame of the follow (before the camera's own update): its springs stepped, the camera set round the target */
  private followStep(dtMs: number): void {
    const fo = this.following!, c = this.camera, h = c.hands;
    // a person's hands moving what it keeps: it ends (a zoom alone, a turn alone: it goes on round them)
    if (h.pan !== fo.hands.pan || (fo.heading !== null && h.turn !== fo.hands.turn) || (fo.dist !== null && h.zoom !== fo.hands.zoom)) { this.following = null; c.held = false; return; }
    if (h.zoom !== fo.hands.zoom) { fo.eye = Math.max(0.01, c.dist - fo.up / Math.max(0.05, Math.sin(c.pitch))); fo.hands.zoom = h.zoom; }
    fo.hands.turn = h.turn;
    const P = whereOf(fo.target, this, this.timeMs); if (!P) return;
    fo.last = [P.lon, P.lat, P.y];
    // (the eye's distance from the target: as the camera stands when it starts, or as asked; the springs start where
    // the camera is: a follow begun away from its thing glides over)
    if (!fo.seen) { fo.seen = true; fo.eye = c.dist; fo.f.seed({ place: [c.lon, c.lat, P.y], dist: fo.dist !== null ? c.dist : undefined, heading: fo.heading !== null ? c.pose.bearing - fo.heading : undefined }); }
    const d = fo.f.step({ place: [P.lon, P.lat, P.y], heading: fo.heading === null ? undefined : Number.isFinite(P.heading) ? P.heading : null, dist: fo.dist ?? undefined }, dtMs / 1000, fo.eye);
    const at = d.place!, eye = d.dist ?? fo.eye, up = at[2] - P.g;
    const bearing = d.heading !== undefined ? d.heading + fo.heading! : c.pose.bearing;
    if (P.y - P.g < 0.05 && d.dist === undefined) { c.lon = wrap(at[0]); c.lat = at[1]; if (d.heading !== undefined) c.yaw = -bearing * D; }
    else {
      // (in the air, or kept at a distance: the pose whose line of sight passes through it, at the eye's distance)
      const ex = this.exaggeration, r = rigPose({ lon: at[0], lat: at[1], y: at[2] }, { dist: eye, tilt: 90 - c.pitch / D, bearing }, (lon, lat) => { const g = this.heightAt(lon, lat); return Number.isFinite(g) ? g * ex : P.g; }, c.fov, (h) => c.pitchAt(h));
      c.place(r.pose, r.ground);
    }
    fo.eye = eye; fo.up = Math.max(0, up);
    c.held = true;
  }
  get isFollowing(): boolean { return this.following !== null; }
  private controlStop: (() => void) | null = null; private camLimits: { minDist: number; maxDist: number } | null = null;
  /** who a person's hands and keys move: an entity (in an entity layer) with a controller (walk, ride, fly, yours), or
   *  the map itself (null) with what its gestures may do (controllers.orbit({ rotate, tilt, zoomRange, tiltRange }),
   *  controllers.pan()); null with no controller: the map's default hands back */
  control(target: Entity | null, c?: Controller | CameraController, o?: { offset?: [number, number, number]; eye?: number; blocked?: (lon: number, lat: number) => number }): this {
    // (a map controller's ranges checked before anything changes)
    const cc = !target && c && 'gestures' in c ? c : null;
    for (const [k, r] of [['zoomRange', cc?.zoomRange], ['tiltRange', cc?.tiltRange]] as const) if (r && !(r.length === 2 && r.every((x) => typeof x === 'number' && Number.isFinite(x)))) throw new AslnutError('E-VIEW-001', `control: ${k} is ${JSON.stringify(r)}`, { where: 'control', fix: `give ${k} as two finite numbers [${k === 'zoomRange' ? 'out, in' : 'least, most'}], or leave it out` });
    this.controlStop?.(); this.controlStop = null;
    const cam = this.camera;
    this.camLimits ??= { minDist: cam.minDist, maxDist: cam.maxDist };
    if (target) {
      const layer = (target as unknown as { layer?: { control?: (w: World, e: Entity, c?: Controller, o?: unknown) => () => void } | null }).layer;
      if (!layer?.control) throw new AslnutError('E-WORLD-005', `entity '${target.id}' is in no entity layer`, { fix: 'add it to an entityElement, and that layer to the world, first' });
      this.controlStop = layer.control(this, target, c as Controller | undefined, o);
      return this;
    }
    cam.gestures = { ...(cc?.gestures ?? { pan: true, rotate: true, tilt: true, zoom: true }) }; cam.drag = cc?.drag ?? 'pan';
    const z = cc?.zoomRange, t = cc?.tiltRange;
    cam.minDist = z ? distForZoom(z[1], cam.lat) * cam.frameK : this.camLimits.minDist; cam.maxDist = z ? distForZoom(z[0], cam.lat) * cam.frameK : this.camLimits.maxDist; cam.zoomLimited = !!z;
    cam.pitchRange = t ? [(90 - Math.min(TILT_MAX, t[1])) * D, Math.min(Math.PI / 2 - 1e-4, (90 - t[0]) * D)] : [(90 - TILT_MAX) * D, Math.PI / 2 - 1e-4];
    // the view now within them
    cam.dist = Math.min(cam.maxDist, Math.max(cam.minDist, cam.dist)); cam.pitch = Math.min(cam.pitchRange[1], Math.max(cam.pitchRange[0], cam.pitch));
    this.invalidate();
    return this;
  }
  /** the globe, the flat map, or each by distance (default 'auto'); changes ease over `seconds` */
  setProjection(p: 'auto' | 'globe' | 'flat', seconds = 1.2): this { this.camera.setProjection(p, seconds); this.stateCache = null; return this; }
  /** a place (or a named point) → CSS px on the canvas; null behind the camera or the globe */
  project(at: LonLatH | string): [number, number] | null {
    const p = typeof at === 'string' ? this.pointAt(at) : at; if (!p) return null;
    const h = this.groundOf(p);
    if (!this.camera.facing(p[0], p[1], h)) return null;
    return this.camera.project(p[0], p[1], h);
  }
  /** on screen, on this side of the globe, and not hidden by the terrain between it and the camera */
  visible(at: LonLatH | string): boolean {
    const p = typeof at === 'string' ? this.pointAt(at) : at; if (!p) return false;
    const h = this.groundOf(p), xy = this.project(p);
    if (!xy || xy[0] < 0 || xy[1] < 0 || xy[0] > this.camera.width || xy[1] > this.camera.height) return false;
    // march from the place to the eye: the ground must stay below the line
    const c = this.camera, P = worldOf(c, p[0], p[1], h), E = c.eye, ex = this.exaggeration;
    for (let i = 1; i < 24; i++) {
      const t = i / 24, x = P[0] + (E[0]! - P[0]) * t, y = P[1] + (E[1]! - P[1]) * t, z = P[2] + (E[2]! - P[2]) * t;
      const ll = c.morph > 0.5 ? [c.lon + x / (R * Math.cos(c.lat * D)) / D, c.lat - z / R / D] : null;
      if (!ll) break;
      const g = this.heightAt(ll[0]!, ll[1]!) * ex;
      if (!Number.isNaN(g) && g > y + 2) return false;
    }
    return true;
  }
  private groundOf(p: LonLatH): number { if (p[2] !== undefined) return p[2] * this.exaggeration; const g = this.heightAt(p[0], p[1]); return Number.isNaN(g) ? 0 : g * this.exaggeration; }

  // ── the state ───────────────────────────────────────────────────────────────────────────────────────────────
  /** the state every `when` reads, this frame */
  get state(): State {
    if (this.stateCache) return this.stateCache;
    const c = this.camera, v = c.view;
    const readouts: Record<string, unknown> = {}, params: Record<string, unknown> = {};
    for (const [k, f] of this.readDefs) Object.defineProperty(readouts, k, { get: f, enumerable: true });
    for (const [k, d] of this.paramDefs) Object.defineProperty(params, k, { get: () => d.get(), enumerable: true });
    const s = makeState({
      observation: this.levelsObj?.state ?? NO_OBSERVATION,
      view: { lon: v.lon, lat: v.lat, zoom: c.zoom, dist: c.dist, tilt: v.tilt, bearing: v.bearing, altitude: c.dist * Math.sin(c.pitch), pixelSize: c.pixelSize, width: c.width, height: c.height, morph: c.morph },
      params, readouts, user: this.user,
      device: { api: this.api, tier: this.profile?.tier ?? 'mid', reason: this.reason },
      quality: this.qualityDrop ? 'lite' : this.qualityNow ?? this.profile?.quality ?? 'realistic', detail: this.detailNow,
    });
    // your function of the state (below the governor's drop and setQuality)
    if (this.qualityFn && !this.qualityDrop && this.qualityNow === null) { try { const q = this.qualityFn(s); if (q === 'lite' || q === 'realistic') s.render.quality = q; } catch (e) { this.error(e); } }
    s.time = timeState(this.time, v.lon, v.lat, this.nowMs / 1000);
    s.time.rate = this.clockRate; s.time.local = localTime(this.time, v.lon, this.zones.zoneAt(v.lon, v.lat));
    this.stateCache = s;
    return s;
  }
  /** the world's time runs by itself (time 'now'): what depends on it keeps changing */
  get timeRunning(): boolean { return this.timeIsNow; }
  /** the world's clock, ms since it started (frames × step in a fixed clock) */
  get now(): number { return this.nowMs; }

  // ── each frame ──────────────────────────────────────────────────────────────────────────────────────────────
  /** advance the clock, move the camera, ease every `when`, and collect the draw calls in order */
  private tick(dtMs: number): DrawCall[] {
    this.nowMs += dtMs; this.frameN++; this.dirtySincePick = true;
    // (each drawn frame is a look at the light; the time 'now' on the display's clock is the wall clock's: a world that
    // rested for a minute shows the sun of now)
    const real = this.nowReal(); this.drawnAt = real; this.lastTimeLook = real;
    // (a Date holds whole ms: the rest of each step is carried, so the world's time never runs slow by its frames: a
    // step of 16.67 ms once lost 0.67 ms, a world at 60 frames a second ran 4 % slow)
    if (this.timeIsNow && this.renderer?.isRunning && typeof this.renderer.clock !== 'object') { this.time = new Date(); this.timeRest = 0; }
    else if (this.timeIsNow || this.clockRate) { const t = this.time.getTime() + this.timeRest + dtMs * (this.timeIsNow ? 1 : this.clockRate), whole = Math.floor(t); this.time = new Date(whole); this.timeRest = t - whole; }
    const c = this.camera, r = this.renderer;
    // your work that sets the camera for this frame (w.everyFrame(fn, { before: true })): after the clock moved, before
    // the camera's own update and the draws (a camera set here is this frame's, not the next one's)
    if (this.befores.length) { this.stateCache = null; this.runEvery(this.befores, this.state, dtMs); }
    if (this.following) this.followStep(dtMs);
    c.held = this.following !== null || c.driving;
    c.update(r ? r.cssWidth : c.width, r ? r.cssHeight : c.height, dtMs);
    // the camera orbits the ground under the centre (eased: no jumps as finer heights arrive)
    const g = this.heightAt(c.lon, c.lat), ex = this.exaggeration;
    if (!Number.isNaN(g)) { this.groundTarget = g * ex; c.groundY += (this.groundTarget - c.groundY) * Math.min(1, dtMs / 250); if (Math.abs(this.groundTarget - c.groundY) < this.groundTol()) c.groundY = this.groundTarget; }
    // the eye's clearance over the ground (under it and under the centre, the higher): the near plane stands a part of
    // it out (next frame's depth precision); on the globe not known
    if (c.morph > 0.5) { const e = c.eye, ll = lonLatOf(c, e[0]!, e[1]!, e[2]!), ge = this.heightAt(ll[0], ll[1]) * ex; c.clearance = Math.max(0, e[1]! - (Number.isNaN(ge) ? c.groundY : Math.max(c.groundY, ge))); }
    else c.clearance = 0;
    this.poseCheck();
    this.stateCache = null;
    // the observation level: the orbit through the margin and the dwell; a change swaps once (core › observation)
    this.observeStep();
    const s = this.state, gates = this.gates;
    if (gates) { gates.keep(this.nowMs); gates.work(this.prepCtx(s, dtMs), 4, this.nowMs, () => this.nowReal()); }
    let turned: string[] | null = null;
    for (const l of this.sorted) {
      const was = l.target;
      try { l.target = l.forced !== null ? (l.forced ? 1 : 0) : shown(l.props.when, s, `element '${l.id}'`); } catch (e) { l.target = 0; this.error(e); }
      // (a swap under way: what comes in waits until all of it is ready, what goes stays until then)
      const held = gates?.hold(l); if (held !== undefined && l.forced === null) l.target = held;
      // (what an element owns, a layer's labels, shows as it does)
      if (l.owner) l.target = Math.min(l.owner.forced === false ? 0 : l.owner.target, l.target);
      if ((was > 0) !== (l.target > 0)) (turned ??= []).push(l.id);
      // (a change asked with its own seconds, once: a layer list's toggle shows in one frame)
      const tr = l.once ?? l.revealSeconds(), step = tr > 0 ? dtMs / 1000 / tr : 1;
      l.shown = l.shown < l.target ? Math.min(l.target, l.shown + step) : Math.max(l.target, l.shown - step);
      if (l.shown === l.target) l.once = null;
    }
    if (turned) this.emit('elements', { what: 'shown', ids: turned });
    const draws: DrawCall[] = [];
    if (r) {
      const f = r.frameData, e = c.eye;
      f.set(c.viewProj, 0);
      f.set([e[0]!, e[1]!, e[2]!, this.nowMs / 1000], 16);
      f.set([this.graphics!.width, this.graphics!.height, r.pixelRatio, c.morph], 20);
      // the light: the sun (or the moon) from the sky, and the sun's shadow box near the camera
      const light = this.lightNow = this.lightOf(s);
      f.set(light ? [light.dir[0], light.dir[1], light.dir[2], light.daylight] : [0.4, 0.8, 0.45, 1], 24);
      f.set([c.lat * D, Math.cos(c.lat * D), Math.tan(c.fov / 2), R], 28);
      // geo.zw and pick.z: the cloud deck's pattern place and its base (its shadows on the ground; 0: none)
      const cl = light?.clouds && (light.cover ?? 0) > 0.01 ? light.clouds : null;
      f.set([mercY(Math.max(-85.0511, Math.min(85.0511, c.lat))), Math.sin(c.lat * D), cl ? cl.x : 0, cl ? cl.z : 0], 32);
      f.set([0, 0, cl ? cl.base : 0, 0], 36);
      f.set([1, 1, 0, 0], 40);
      f.set(c.inv, 44);
      const box = this.shadowsFor(light);
      f[60] = this.graphics!.width; f[61] = this.graphics!.height; f[62] = box ? 0.8 * box.texel * box.depthPerMetre : 0; f[63] = c.height;
      f.set(box ? box.viewProj : IDENTITY, 64);
      f.set(light ? [light.color[0], light.color[1], light.color[2], 1] : [0, 0, 0, 0], 80);
      f.set(light ? [light.ambient[0], light.ambient[1], light.ambient[2], light.bounce] : [0, 0, 0, 0], 84);
      f.set(box ? [this.shadowOpts?.strength ?? 1, 1 / box.size, 1.5 * box.texel, 0.25 * box.depthPerMetre + 1.5 / 16777216] : [0, 0, 0, 0], 88);
      f.set(light?.haze ? [light.haze[0], light.haze[1], light.haze[2], light.visibility ?? 0] : [0, 0, 0, 0], 92);
      f.set([light?.wet ?? 0, light?.flash ?? 0, light?.cover ?? 0, light?.wind ?? 0], 96);
      // the analysis view: its muting (eased) into the frame block; its subjects draw with a copy that mutes nothing
      // (made the first time one draws: no theme, none)
      const th = this.themeS; th.step(dtMs, s); th.write(f, 100);
      r.frameBlock.write(f);
      const ctx = { graphics: this.graphics!, camera: c, s, frame: r.frameBlock, now: this.nowMs, n: this.frameN, loadNow: this.nowMs + this.holdMs, dt: dtMs, world: this as WorldLike, shadowMap: (box ? this.shadowTarget?.texture : null) ?? this.blankShadow(), shadowView: box ? box.viewProj : null, sea: this.seaOf(s) };
      let sctx: typeof ctx | null = null; this.subjectDraws.clear();
      this.drawsOf.clear();
      const lm = this.layerMs; lm.clear();
      // labels make room across every label mark, the top of the stack first (their order among themselves only)
      (ctx as FrameContext).labelRoom = [];
      for (const l of this.labelsTopFirst()) {
        if (l.shown <= 0 && l.target <= 0 && l.kind !== 'basemap' && l.kind !== 'sky') continue;
        const t0 = this.nowReal(), subj = th.active && th.subject(l);
        try { const ds = l.frame(subj ? (sctx ??= { ...ctx, frame: this.subjectFrame(f) }) : ctx); this.drawsOf.set(l, ds); draws.push(...ds); if (subj) for (const d of ds) this.subjectDraws.add(d); } catch (e) { this.error(e); }
        lm.set(l.id, this.nowReal() - t0);
      }
      // the sun's shadow map: what casts, drawn from the sun with its picking twin (depth, packed), before the frame
      if (box) this.drawShadows(draws, f, box);
      else this.shadowStats.on = false;
      // what is only a caster (out of the camera's view) is neither drawn nor picked
      if (draws.some((d) => d.shadowOnly)) { const keep = draws.filter((d) => !d.shadowOnly); draws.length = 0; draws.push(...keep); for (const [l, ds] of this.drawsOf) if (ds.some((d) => d.shadowOnly)) this.drawsOf.set(l, ds.filter((d) => !d.shadowOnly)); }
    }
    this.lastDraws = draws;
    // your own work each frame (w.everyFrame): its time measured against its budget
    this.runEvery(this.everies.filter((e) => !e.before), s, dtMs);
    if (this.creditsOpts) this.credits();
    if (r) this.prepareSoon({ graphics: this.graphics!, camera: c, s, frame: r.frameBlock, now: this.nowMs, loadNow: this.nowMs + this.holdMs, dt: dtMs, world: this as WorldLike }, 3);
    // marks lying on the ground go into the ground's tiles (one pass for the frame, exact on any terrain); their
    // calls stay in lastDraws for picking
    let shownDraws = draws;
    // two scenarios side by side: what differs is drawn on its side only (never into the shared ground's tiles)
    const cv = this.compareView, split = new Set<DrawCall>(), hideL = new Set<DrawCall>(), hideR = new Set<DrawCall>();
    if (cv) { for (const l of cv.leftHides) for (const d of this.drawsOf.get(l) ?? []) { hideL.add(d); split.add(d); } for (const l of cv.rightHides) for (const d of this.drawsOf.get(l) ?? []) { hideR.add(d); split.add(d); } }
    if (r) {
      const host = this.groundMarks !== 'tiles' ? undefined : this.sorted.find((l) => l.kind === 'basemap' && typeof (l as unknown as OverlayHost).overlays === 'function' && (this.drawsOf.get(l)?.length ?? 0) > 0) as unknown as OverlayHost | undefined;
      if (host) {
        const ground = draws.filter((d) => d.ground && !split.has(d));
        // a fixed clock (captures, the tools) draws every tile's marks in the frame they change; not taken (their
        // programs still being built): drawn as prisms meanwhile
        const all = typeof r.clock === 'object';
        // a theme's muting is drawn into the tiles with the marks: their look changes with it (not a subject's)
        const tk = this.themeS.key(), gds = tk ? ground.map((d) => (this.subjectDraws.has(d) ? d.ground! : { ...d.ground!, version: d.ground!.version + tk, since: d.ground!.since && { ...d.ground!.since, version: d.ground!.since.version + tk } })) : ground.map((d) => d.ground!);
        try { if (host.overlays(gds, { graphics: this.graphics!, camera: c, s, frame: r.frameBlock, now: this.nowMs, loadNow: this.nowMs + this.holdMs, dt: dtMs, world: this as WorldLike }, r.pixelRatio, all) && ground.length) shownDraws = draws.filter((d) => !d.ground || split.has(d)); } catch (e) { this.error(e); }
      }
    }
    // the twin's solids drawn over the terrain this frame (draped marks draw their parts over them from the next)
    this.standingNow = this.standsOver();
    // draped marks' parts over the twin's solids: after them, in their layers' order, the terrain's depth kept before
    // them; a frame without such parts is as it was
    if (shownDraws.some((d) => d.upper)) shownDraws = this.banded(shownDraws);
    if (this.renderer) this.renderer.split = cv ? { at: cv.at, left: shownDraws.filter((d) => !hideL.has(d)), right: shownDraws.filter((d) => !hideR.has(d)) } : null;
    this.emit('frame', { n: this.frameN, dt: dtMs });
    // hover: at most every 50 ms, never while the camera moves, and after this frame was handed to the graphics
    // (the picking pass rewrites the frame block; it never runs inside a frame)
    if (!c.moving) this.pickSoon();
    return shownDraws;
  }
  /** the draw order with the label marks among themselves top first (one labelling for the stack: the top layer's
   *  names take their room first; labels never overlap, so their own drawing order shows nothing) */
  private labelsTopFirst(): readonly Element[] {
    const s = this.sorted, at: number[] = [];
    for (let i = 0; i < s.length; i++) if (s[i]!.kind === 'label') at.push(i);
    if (at.length < 2) return s;
    const out = s.slice();
    for (let k = 0; k < at.length; k++) out[at[k]!] = s[at[at.length - 1 - k]!]!;
    return out;
  }
  // ── draped marks over the twin's solids (core › geometry › marks › drape) ──────────────────────────────────────
  private standingNow = false;
  /** the twin's solids (buildings, trees, roads' and paths' meshes, water) were drawn over the terrain last frame */
  get standing(): boolean { return this.standingNow; }
  /** anything but the ground and the sky drew depth this frame (what stands, or lies, over the terrain) */
  private standsOver(): boolean {
    for (const [l, ds] of this.drawsOf) {
      if (l.kind === 'basemap' || l.kind === 'sky' || (l.shown <= 0 && l.target <= 0)) continue;
      for (const d of ds) { const p = d.program?.desc; if (p && !d.shadowOnly && !p.overlay && !p.sceneDepth && (p.depth?.write ?? true)) return true; }
    }
    return false;
  }
  /** the highest top of what stands in a box (true m over the sea), from the layers that know (the twin's solids) */
  topIn(w: number, s: number, e: number, n: number): number | null {
    let top: number | null = null;
    for (const l of this.sorted) { const f = (l as unknown as { topIn?: (w: number, s: number, e: number, n: number) => number | null }).topIn; if (!f || (l.shown <= 0 && l.target <= 0)) continue; const t = f.call(l, w, s, e, n); if (t !== null && (top === null || t > top)) top = t; }
    return top;
  }
  /** the frame's draws with the draped marks' parts over the solids moved after them (before the first layer drawn
   *  over everything: points, labels, what floats), and the terrain's depth kept at the first draw after the ground */
  private banded(list: DrawCall[]): DrawCall[] {
    const ground = new Set<DrawCall>(), after = new Set<DrawCall>();
    let over = false;
    for (const l of this.sorted) {
      const ds = this.drawsOf.get(l) ?? [];
      if (l.kind === 'basemap' || l.kind === 'sky') for (const d of ds) ground.add(d);
      if (!over && (l.order ?? KIND_ORDER[l.kind]) > 4) over = true;
      if (over) for (const d of ds) after.add(d);
    }
    const ups = list.filter((d) => d.upper), out: DrawCall[] = [];
    let kept = false, placed = false;
    const place = () => { placed = true; for (const u of ups) { if (!kept) { out.push({ ...u, keepDepth: true }); kept = true; } else out.push(u); } };
    for (const d of list) {
      if (d.upper) continue;
      if (!placed && after.has(d)) place();
      if (!kept && !ground.has(d)) { out.push({ ...d, keepDepth: true }); kept = true; continue; }
      out.push(d);
    }
    if (!placed) place();
    return out;
  }
  // ── light and shadows ───────────────────────────────────────────────────────────────────────────────────────
  /** the light this frame: the first layer (in draw order) that gives one */
  private lightOf(s: State): Light | null {
    for (const l of this.sorted) { if (!l.light || (l.shown <= 0 && l.target <= 0 && l.kind !== 'sky')) continue; try { const x = l.light(s); if (x) return x; } catch (e) { this.error(e); } }
    return null;
  }
  /** the sea this frame: the first layer (in draw order) that gives one */
  private seaOf(s: State): Sea | null {
    for (const l of this.sorted) { if (!l.sea || (l.shown <= 0 && l.target <= 0)) continue; try { const x = l.sea(s); if (x) return x; } catch (e) { this.error(e); } }
    return null;
  }
  /** the light lighting the world now (null: none; every mark keeps its own shading) */
  get light(): Light | null { return this.lightNow; }
  /** turn the sun's shadows on (options) or off (false) */
  setShadows(o: boolean | ShadowOptions): this { this.shadowOpts = o ? (o === true ? {} : o) : null; this.invalidate(); return this; }
  /** the shadow map's last frame: on, its size, casters drawn, ms on the main thread, the box's half side (m) */
  shadowReport(): { on: boolean; size: number; casters: number; ms: number; radius: number } { return { ...this.shadowStats }; }
  private shadowsFor(light: Light | null): (ReturnType<typeof shadowBox> & { size: number }) | null {
    const o = this.shadowOpts; if (!o || !light || !light.shadows || light.dir[1] < 0.03 || !this.graphics || this.camera.morph < 0.98) return null;
    if (this.shadowDrop >= 3) return null;
    const lite = this.state.render.quality === 'lite', size = Math.max(256, (o.size ?? (lite ? 1024 : 2048)) >> this.shadowDrop);
    const c = this.camera, k = R * Math.cos(c.lat * D);
    const box = shadowBox(c, light.dir, size, o.distance ?? (lite ? 700 : 1500), [k * c.lon * D, 0, -k * mercY(Math.max(-85.0511, Math.min(85.0511, c.lat)))]);
    if (!box) return null;
    if (!this.shadowTarget || this.shadowTarget.width !== size) { this.shadowTarget?.destroy(); this.shadowTarget = this.graphics.target(size, size, { sampled: true, label: 'shadow map' }); this.shadowSig = ''; }
    this.shadowStats.radius = box.texel * size / 2;
    return { ...box, size };
  }
  /** a 1 × 1 shadow map where everything is lit (lit programs always bind one) */
  private blankShadow(): GTexture {
    if (!this.noShadow && this.graphics) { this.noShadow = this.graphics.texture({ label: 'no shadow', width: 1, height: 1, format: 'rgba8', filter: 'nearest' }); this.noShadow.write(new Uint8Array([255, 255, 255, 255])); }
    return this.noShadow!;
  }
  private drawShadows(draws: DrawCall[], f: Float32Array, box: NonNullable<ReturnType<typeof shadowBox>> & { size: number }): void {
    const g = this.graphics!, t0 = this.nowReal(), tg = this.shadowTarget!, real = tg.texture, blank = this.blankShadow();
    const sf = this.shadowData; sf.set(f);
    sf.set(box.viewProj, 0); sf.set([box.eye[0], box.eye[1], box.eye[2], f[19]!], 16); sf.set([box.size, box.size, 1, f[23]!], 20);
    sf.set([0, 1, 0, 0], 36); sf.set([1, 1, 0, 0], 40); sf[60] = box.size; sf[61] = box.size;
    this.shadowBuf ??= g.buffer('uniform', FRAME_FLOATS * 4, 'shadow frame');
    this.shadowBuf.write(sf);
    const list: DrawCall[] = [];
    // what the map is drawn from: the box, the light, and each caster's buffers as written (a view turning round its
    // centre, nothing moving, draws it once)
    let sig = `${box.size}|${Array.prototype.join.call(box.viewProj, ',')}|${f[24]},${f[25]},${f[26]}`;
    const bv = (b: GBuffer | undefined) => (b ? `${b.uid}.${b.version}` : '-');
    for (const d of draws) {
      if (!d.cast || !d.pickProgram) continue;
      if (d.bounds && !inView(box.viewProj, d.bounds)) continue;
      const pg = d.pickProgram();
      list.push({ ...d, program: pg, blocks: [this.shadowBuf, ...d.blocks.slice(1)], textures: d.textures?.map((x) => (x === real ? blank : x)), pickProgram: undefined });
      sig += `;${this.progNo(pg)}:${d.blocks.slice(1).map(bv).join(',')}:${bv(d.instances)}:${bv(d.vertices)}:${d.count}:${d.instanceCount ?? 1}:${d.first ?? 0}`;
    }
    if (sig === this.shadowSig && this.shadowTarget === tg) { this.shadowStats = { ...this.shadowStats, on: true, ms: 0, kept: true }; return; }
    this.shadowSig = sig;
    try { g.frame(list, { clear: [1, 1, 1, 1], target: tg }); } catch (e) { this.error(e); }
    this.shadowStats = { on: true, size: box.size, casters: list.length, ms: +(this.nowReal() - t0).toFixed(2), radius: this.shadowStats.radius, kept: false };
  }
  /** prepare tile resources for marks that are eligible to appear soon */
  prepareGround(ground: GroundDraw[], ctx: FrameContext): boolean {
    const host = this.sorted.find((l) => l.kind === 'basemap' && 'prepareOverlays' in l) as unknown as OverlayHost | undefined;
    return host?.prepareOverlays?.(ground, ctx, this.renderer?.pixelRatio ?? 1) ?? true;
  }

  // ── ahead of need ───────────────────────────────────────────────────────────────────────────────────────────
  /** ahead of need (core › observation › gates: ahead): hidden elements the next level shows, while the orbit is near
   *  its edge, and elements hidden by hand: they load and build ahead, a few ms a frame, or between frames when none
   *  is drawn (a still view stays still: nothing is drawn for it). A world with no levels prepares only what is
   *  hidden by hand */
  private soon: Element[] = []; private soonAt = -1e9; private soonDone = new WeakSet<Element>();
  /** the levels a known way ahead will be looked at (w.prefetch, a recording): their elements get ready too */
  private aheadLevels: Set<number> | null = null;
  private prepareSoon(ctx: FrameContext, budgetMs: number): void {
    const t0 = this.nowReal();
    if (t0 - this.soonAt > 250) {
      this.soonAt = t0; this.soon.length = 0;
      const s = ctx.s, L = this.levelsObj, next = L ? L.near(this.camera.zoom) : null;
      // (the level the orbit nears, and the levels a known way ahead will cross)
      const ats: State[] = [];
      for (const i of new Set([...(next !== null ? [next] : []), ...(this.aheadLevels ?? [])])) { if (!L) break; const at = Object.create(s) as State; Object.defineProperty(at, 'observation', { value: L.stateAt(i) }); ats.push(at); }
      for (const l of this.sorted) {
        const w = l.props.when;
        if (l.target > 0 || l.shown > 0 || l.forced === true || this.soonDone.has(l)) continue;
        // hidden by hand (w.hide): shown again by hand at any moment, so made ready too
        if (l.forced === false) { this.soon.push(l); continue; }
        if (!ats.length || w === undefined || typeof w === 'boolean') continue;
        try { if (ats.some((at) => shown(w, at) > 0)) this.soon.push(l); } catch { /* its own gate errs when it is asked for real */ }
      }
    }
    for (const l of this.soon) {
      if (this.nowReal() - t0 > budgetMs) break;
      if (this.soonDone.has(l) || l.target > 0) continue;
      try { if (l.prepare(ctx)) this.soonDone.add(l); } catch (e) { this.soonDone.add(l); this.error(e); }
    }
    this.preparing = this.soon.some((l) => !this.soonDone.has(l) && l.target <= 0);
  }
  /** how near the camera's ground must be to the ground under it to count as there: a tenth of a pixel at the centre
   *  (5 cm at the least). The last metres of an easing never held a view back from settling (seconds, from afar) */
  private groundTol(): number { const c = this.camera; return Math.max(0.05, 0.1 * c.pixelSize); }
  // ── render on change ────────────────────────────────────────────────────────────────────────────────────────
  private sig = new Float64Array(10); private idleSince = -1; private settledSeen = false; private dirty = true;
  /** a number that is not finite written straight into the camera (its fields are its pose: w.go and w.fly check what
   *  they are given, nothing checks a field): said once (E-VIEW-001), never repaired; nothing more is drawn until a view
   *  is set (the loop rests) */
  private poseBad = false;
  private poseCheck(): void {
    const c = this.camera, k = (['lon', 'lat', 'dist', 'yaw', 'pitch', 'groundY'] as const).find((f) => !Number.isFinite(c[f]));
    if (k && !this.poseBad) this.error(new AslnutError('E-VIEW-001', `the camera's ${k} is ${c[k]} (written into the camera itself: nothing there checks it)`, { where: 'camera', fix: "set the view with w.go or w.fly, which check it (the camera's own yaw and pitch are radians; the view in degrees is w.camera.view)" }));
    this.poseBad = k !== undefined;
  }
  /** when the view last moved (a gesture, a flight, a follow, a hand on the canvas): real ms */
  private movedAt = -1e9;
  /** the loop may rest at once (core › runtime › frame): the frame drawn was a change of its own (a layer shown,
   *  its opacity), the view settled and still for longer than the wind-down after motion; a gesture keeps its wind-down
   *  (the next touch comes soon), and a hover pick waiting for its turn (at most one each 50 ms) keeps the loop awake */
  private restNow(): boolean { return this.idleSince >= 0 && this.settledSeen && !this.hoverWanted && !this.picking && this.nowReal() - this.movedAt > (this.framesOpts.rest === false ? Infinity : this.framesOpts.rest ?? 500); }
  /** something changed that the view must show (the next frame is drawn) */
  invalidate(): void { this.dirty = true; this.renderer?.wake(); }
  private needsFrame(): boolean {
    const c = this.camera, r = this.renderer!, now = this.nowReal();
    const v = [c.lon, c.lat, c.dist, c.pitch, c.yaw, c.groundY, c.morph, r.cssWidth, r.cssHeight, r.pixelRatio];
    // (a NaN is the same as the NaN before it: one written into the camera is one change, never one every frame)
    let changed = false; for (let i = 0; i < 10; i++) if (this.sig[i] !== v[i] && !(Number.isNaN(this.sig[i]!) && Number.isNaN(v[i]!))) { changed = true; this.sig[i] = v[i]!; }
    // a 'frame' listener watches the frames that are drawn; it never keeps a still view drawing (a dashboard legend
    // listening for its scale's changes once made every still view draw 60 times a second): w.invalidate() asks for one
    // a pointer moving over a still view is answered by the picking pass over the last frame's calls: no frame is
    // drawn for it (one is drawn only when what is hovered changes)
    if (this.hoverWanted && !changed && !this.dirty && !c.moving && !this.following) this.pickSoon();
    // a camera that is not one (a number not finite written into it: said once, E-VIEW-001) draws nothing by itself
    // until a view is set: no frame of it can be right, and what waits for one (the ground's tiles) would ask every
    // frame; a frame asked for (w.invalidate(): a settled() waiting) is still drawn
    if (this.poseBad && !changed && !this.dirty) return false;
    const why = changed ? 'view' : this.dirty ? 'dirty' : c.moving ? 'moving' : this.followMoves() ? 'follow' : this.loading.size ? 'loading' : '';
    if (why === 'view' || why === 'moving' || why === 'follow') this.movedAt = now;
    if (why) { this.dirty = false; this.idleSince = -1; return this.drawFor(why); }
    if (this.themeS.easing) { this.idleSince = -1; return this.drawFor('theme'); }
    // the observation: a level change waiting out its dwell, or a swap under way (both short: the dwell's half second,
    // what comes in getting ready); each is a frame on the world's clock, so a fixed clock sees the same changes
    if (this.levelsObj && (this.levelsObj.waiting !== null || this.gates?.swap)) { this.idleSince = -1; return this.drawFor(this.gates?.swap ? 'swap' : 'level'); }
    // what animates asks for frames itself, at its own rate (core › runtime › frame): a layer shown (a hidden one is not
    // drawn: nothing of it can change on screen), your everyFrame work, a time-lapse's light; a rate lower than the
    // display's draws on a steady beat of it (30, 20, 15 … a second)
    const want = this.wanted(now);
    if (want.rate > 0) {
      this.idleSince = -1;
      if (now - this.drawnAt >= msPer(want.rate) - 4) return this.drawFor(`animating:${want.who}`);
      return false;
    }
    // the world's time 'now' under a sky that lights it: a look at the light now and then (each drawn frame has it too)
    const lightMs = this.framesOpts.light ?? 60000;
    if (this.timeIsNow && now - this.lastTimeLook > lightMs && this.sorted.some((l) => l.light)) { this.lastTimeLook = now; this.stateCache = null; return this.drawFor('time'); }
    // settled? (asked again only while it was not)
    if (this.idleSince < 0) { this.settledSeen = this.report().settled; if (!this.settledSeen) return this.drawFor(`unsettled:${this.report().pending[0] ?? ''}`.slice(0, 60)); this.idleSince = now; }
    // still and settled: a look 4 times a second (data streams, late tiles, a layer restyling) that draws only when
    // something is no longer settled; a still, settled view draws nothing at all (a phone's GPU rests)
    if (now - this.idleSince > 250) {
      this.idleSince = now;
      const r = this.report();
      if (!r.settled) { this.idleSince = -1; return this.drawFor(`look:${r.pending[0] ?? ''}`.slice(0, 60)); }
      // a `when` that is your function reads what it likes (your app's own state): it is asked again once a second,
      // and a frame is drawn only when its answer changed (a still view with such layers once drew every second)
      if (now - this.lastWhenLook > 1000) {
        this.lastWhenLook = now;
        let s: State | null = null;
        for (const l of this.sorted) {
          const w = (l.props as { when?: unknown }).when; if (typeof w !== 'function' || l.forced !== null) continue;
          s ??= (this.stateCache = null, this.state);
          let t = 0; try { t = shown(l.props.when, s, `layer '${l.id}'`); } catch { t = 0; }
          if (t !== l.target) return this.drawFor('look:when');
        }
      }
    }
    // no frame: the time goes to layers a zoom away (nothing is drawn for it)
    if (this.graphics && r) this.prepareSoon({ graphics: this.graphics, camera: c, s: this.state, frame: r.frameBlock, now: this.nowMs, loadNow: this.nowMs + this.holdMs, dt: 0, world: this as WorldLike }, 4);
    return false;
  }
  /** following a place that is not where the camera's centre is (more than a tenth of a pixel away): a followed thing
   *  standing still draws nothing */
  private followMoves(): boolean {
    const f = this.following; if (!f) return false;
    const p = whereOf(f.target, this, this.timeMs), c = this.camera; if (!p) return false;
    // (it moved since the last frame looked at it; the springs moving the camera are a change of the view themselves)
    if (!f.last) return true;
    const dx = wrap(p.lon - f.last[0]) * 111320 * Math.cos(c.lat * D), dz = (p.lat - f.last[1]) * 110574;
    return Math.hypot(dx, dz, p.y - f.last[2]) > 0.1 * c.pixelSize;
  }
  // ── draw on demand: who wants frames ──
  private framesOpts: FramesOptions = {}; private drawnAt = -1e9; private wantNow: FrameWant = { rate: 0, who: '' };
  private everies: { fn: (s: State, dt: number) => void; fps: number; budgetMs: number; ms: number; over: number; id: number; before: boolean }[] = []; private everyN = 0;
  /** the everyFrame work that runs before the frame is drawn */
  private befores: World['everies'] = [];
  /** layers prepared ahead between frames (a zoom away, hidden by hand) still have work: a resting loop looks sooner */
  private preparing = false;
  /** the highest rate anything wants now (frames a second; 0: none) and who: the layers shown (their wantsFrames,
   *  through your frames.rate and capped by frames.max), your everyFrame work, a time-lapse's light */
  private wanted(_now: number): FrameWant {
    const o = this.framesOpts, s = this.state, w = this.wantNow; w.rate = 0; w.who = '';
    const take = (rate: number, who: string) => { if (rate > w.rate) { w.rate = rate; w.who = who; } };
    for (const l of this.sorted) {
      if (l.shown <= 0 && l.target <= 0) continue;
      let r = 0;
      try { r = l.wantsFrames(s); if (o.rate && r > 0) r = o.rate(l, r, s); } catch (e) { this.error(e); }
      if (r > 0) take(r, l.id);
    }
    for (const e of this.everies) if (e.fps > 0) take(e.fps, `everyFrame#${e.id}`);
    // the light of a clock running by itself (not 'now'): the sun moves at most 0.02° a frame
    if (!this.timeIsNow && this.clockRate !== 0 && this.sorted.some((l) => l.light)) take(sunFrames(this.clockRate), 'time-lapse');
    if (o.max !== undefined && w.rate > o.max) w.rate = Math.max(0, o.max);
    return w;
  }
  /** ms until a frame is due by itself (a slow animation's next): a resting loop looks then */
  private nextIn(): number { const now = this.nowReal(), w = this.wanted(now); return w.rate > 0 ? Math.max(0, msPer(w.rate) - (now - this.drawnAt)) : Infinity; }
  /** your own work each drawn frame (a HUD, a counter, a moving marker of yours): `fn(s, dt)` after the layers'
   *  frames; while it is on, frames come at `fps` a second (default every display frame; 0: none asked, it runs on the
   *  frames drawn anyway). Its time is measured against `budgetMs` (default 1) and shown in w.telemetry(); a run of
   *  frames over it goes to the page's log. Returns the function that turns it off */
  everyFrame(fn: (s: State, dt: number) => void, o: { fps?: number; budgetMs?: number; /** run before the frame is drawn (after the clock moved, before the camera's update): a camera set there is this frame's (a reel's script, a recording) */ before?: boolean } = {}): () => void {
    const e = { fn, fps: o.fps ?? Infinity, budgetMs: o.budgetMs ?? 1, ms: 0, over: 0, id: ++this.everyN, before: !!o.before };
    this.everies.push(e); if (e.before) this.befores.push(e); this.invalidate();
    return () => { for (const l of [this.everies, this.befores]) { const i = l.indexOf(e); if (i >= 0) l.splice(i, 1); } };
  }
  /** the everyFrame work given, each measured against its budget */
  private runEvery(list: World['everies'], s: State, dtMs: number): void {
    for (const e of list) {
      const t0 = this.nowReal();
      try { e.fn(s, dtMs); } catch (err) { this.error(err); }
      e.ms = this.nowReal() - t0;
      if (e.ms > e.budgetMs) { if (++e.over === 30) this.remote?.send('everyFrame', { id: e.id, ms: +e.ms.toFixed(2), budgetMs: e.budgetMs }, 'warn'); } else e.over = 0;
    }
  }
  /** why frames were drawn since the last read (render on change): reason → count */
  private drawReasons = new Map<string, number>(); private lastWhenLook = 0;
  private drawFor(why: string): true { this.drawReasons.set(why, (this.drawReasons.get(why) ?? 0) + 1); return true; }
  /** why frames were drawn since the last call (and reset): what keeps a still view drawing */
  drawnWhy(): Record<string, number> { const o = Object.fromEntries(this.drawReasons); this.drawReasons.clear(); return o; }

  /** advance the world by dtMs and draw one frame (headless: advance only). With clock: 'manual' this is the only clock:
   *  the same steps give the same world (await w.settled({ hold: true }) for what loads meanwhile) */
  step(dtMs = 1000 / 60): this { if (this.renderer) this.renderer.step(dtMs); else this.tick(dtMs); return this; }
  start(): this { this.renderer?.start(); return this; }
  stop(): this { this.renderer?.stop(); return this; }

  // ── readiness ───────────────────────────────────────────────────────────────────────────────────────────────
  /** where the view stands: every layer attached, every tile in and faded, every reveal done, the camera still */
  /** what is not done yet; `hold`: only loading (a paused moment: motion and reveals are part of it, not pending) */
  report(o: { hold?: boolean } = {}): SettleReport {
    const pending: string[] = [], failed: ElementStatus['failed'] = [], missing: string[] = [];
    if (this.loading.size) pending.push(`${this.loading.size} layer(s) attaching`);
    if (!o.hold && this.camera.moving) pending.push('the camera is moving');
    if (!o.hold && Math.abs(this.groundTarget - this.camera.groundY) > this.groundTol()) pending.push('the camera is settling onto the ground');
    if (!o.hold && this.renderer && this.themeS.easing) pending.push('the theme is easing');
    // the observation: a level change waiting out its dwell, or a swap under way (a capture never shows half of one)
    if (!o.hold && this.levelsObj?.waiting != null) pending.push('the observation level is about to change (its dwell)');
    if (!o.hold && this.gates?.swap) pending.push(`the observation level's swap to '${this.gates.swap.to}' is under way`);
    for (const l of this.elements) {
      if (!o.hold && l.shown !== l.target) pending.push(`'${l.id}' is ${l.shown < l.target ? 'revealing' : 'hiding'}`);
      if (l.failure) { failed.push({ what: l.id, error: l.failure.message }); continue; }
      const st = l.status();
      pending.push(...st.pending.map((p) => `${l.id}: ${p}`)); failed.push(...st.failed); missing.push(...st.missing.map((m) => `${l.id}: ${m}`));
    }
    return { settled: pending.length === 0, pending, failed, missing, frames: this.frameN };
  }
  /** resolves when the view is complete. Strict: rejects (E-SETTLE-001 / 002) with what is pending, failed or
   *  missing; otherwise resolves false. The condition is the state alone; `timeout` (ms) only limits the wait */
  settled(o: SettleOptions = {}): Promise<boolean> {
    const timeout = o.timeout ?? 30000, t0 = Date.now();
    return new Promise((ok, bad) => {
      let first = true;
      const check = () => {
        if (this.disposed) { bad(new AslnutError('E-WORLD-003', 'the world was disposed while settling', { fix: 'await settled() before dispose()' })); return; }
        const r = this.report({ hold: o.hold });
        // at least one frame after the call: what the call itself changed is seen
        if (r.settled && !first) {
          const bad2 = r.failed.length || (o.strict && r.missing.length);
          if (bad2 && o.strict) { bad(new AslnutError('E-SETTLE-002', `the view settled with ${r.failed.length} failure(s) and ${r.missing.length} missing: ${[...r.failed.map((f) => `${f.what} (${f.error})`), ...r.missing].slice(0, 8).join('; ')}`, { fix: 'check the network and the sources; in replay / offline, prepare the view first (loader.ensure)', details: r })); return; }
          ok(!bad2); return;
        }
        first = false;
        if (Date.now() - t0 > timeout) {
          if (o.strict) bad(new AslnutError('E-SETTLE-001', `not settled after ${timeout} ms: ${r.pending.slice(0, 8).join('; ')}${r.pending.length > 8 ? ` … (${r.pending.length})` : ''}`, { fix: 'give it longer (timeout), check the network, or stop the camera', details: r }));
          else ok(false);
          return;
        }
        if (this.renderer?.isRunning) { this.once('frame', check); this.invalidate(); }
        else { if (o.hold) this.holdMs += 1000 / 30; this.step(o.hold ? 0 : this.renderer?.clock && typeof this.renderer.clock === 'object' ? 1000 / this.renderer.clock.fps : 16.7); setTimeout(check, o.hold ? 4 : 0); }
      };
      check();
    });
  }
  // ── recording (core › render › capture › capture) ──────────────────────────────────────────────────────────────
  private recordingNow = false;
  /** a recording is stepping the world (its clock is the recorder's) */
  get recording(): boolean { return this.recordingNow; }
  /** record frames: the world's clock stepped 1 / fps a frame, each frame held at its moment until it is complete (its
   *  tiles in and faded, a level's swap done: the clock does not move meanwhile), then read back (w.frame). The same
   *  steps give the same frames on every run. What the camera's way will see loads ahead (`path`: camera keys, a
   *  move, or your function of the recording's seconds; unset: the move playing): before the first frame the whole
   *  way's coarser levels, then `ahead` seconds of it as it goes, and the elements of the levels it will cross get
   *  ready. A provider whose terms allow no prefetching (show only) is never loaded ahead: a frame that needs it waits
   *  for it. The loop stops while it records (and starts again after, if it ran); the governor holds still (what it
   *  had dropped comes back first: every run draws the same). Your code that sets the camera each frame runs before
   *  the frame is drawn: w.everyFrame(fn, { before: true }). Use: for await (const f of w.record({ seconds: 8 })) … */
  async *record(o: RecordOptions = {}): AsyncGenerator<RecordedFrame, void, void> {
    const r = this.renderer;
    if (!r) throw new AslnutError('E-WORLD-003', 'a headless world has no frames to record', { fix: 'give world() a canvas' });
    const fps = o.fps ?? 30, ahead = o.ahead ?? 2, timeout = o.timeout ?? 60000;
    for (const [k, x, lo] of [['fps', fps, 0], ['ahead', ahead, -1e-9], ['timeout', timeout, 0]] as const) if (!(Number.isFinite(x) && x > lo)) throw new AslnutError('E-WORLD-006', `record: ${k} is ${x}`, { where: 'record', fix: `give ${k} as a finite number above ${lo > 0 ? lo : 0}, or leave it out` });
    if (o.frames !== undefined && !(Number.isInteger(o.frames) && o.frames >= 0)) throw new AslnutError('E-WORLD-006', `record: frames is ${o.frames}`, { where: 'record', fix: 'give frames as a whole number, 0 or more' });
    if (o.seconds !== undefined && !(Number.isFinite(o.seconds) && o.seconds >= 0)) throw new AslnutError('E-WORLD-006', `record: seconds is ${o.seconds}`, { where: 'record', fix: 'give seconds as a finite number, 0 or more' });
    if (o.size !== undefined && !(Array.isArray(o.size) && o.size.length === 2 && o.size.every((x) => Number.isInteger(x) && x > 0 && x <= 8192))) throw new AslnutError('E-WORLD-006', `record: size is ${JSON.stringify(o.size)}`, { where: 'record', fix: 'give size as [width, height] in whole pixels (1..8192), or leave it out' });
    if (this.recordingNow) throw new AslnutError('E-WORLD-006', 'record: a recording is under way', { where: 'record', fix: 'finish it (or break out of its loop) first' });
    const n = o.frames ?? (o.seconds !== undefined ? Math.round(o.seconds * fps) : Infinity), dt = 1000 / fps;
    const path = this.pathOf(o.path, fps);
    const was = r.isRunning; this.stop(); this.recordingNow = true;
    this.gov?.reset();
    if (o.size) r.pin(o.size);
    try {
      // before the first frame: its first seconds whole, and the whole way two levels coarser (a sample every two
      // seconds, at most 60: what every frame of it falls back on), the elements of the levels it crosses
      if (path) {
        const S = Number.isFinite(n) ? n / fps : ahead, views: Pose[] = [];
        for (let t = 0; t <= Math.min(ahead, S) + 1e-9; t += 0.5) { const v = path(t); if (v) views.push(v); }
        const real: Pose[] = [];
        for (let t = 0, k = Math.max(2, S / 60); t <= S + 1e-9; t += k) { const v = path(t); if (v) { real.push(v); views.push({ ...v, dist: v.dist * 4 }); } }
        if (views.length) { const p = this.prefetch(views, { depth: 2, timeout: Math.min(timeout, 120000) }); this.aheadLevels = this.levelsOf(real); await p; }
        this.aheadLevels = this.levelsOf(real);
      }
      let aheadAt = -Infinity;
      for (let i = 0; i < n; i++) {
        if (i > 0) this.step(dt);
        const t = i / fps;
        // what the next seconds will see, loading while this frame waits (a new look each half second)
        if (path && t - aheadAt >= 0.5 - 1e-9) {
          aheadAt = t; const views: Pose[] = [];
          for (let u = 0.5; u <= ahead + 1e-9; u += 0.5) { if (Number.isFinite(n) && t + u > n / fps) break; const v = path(t + u); if (v) views.push(v); }
          if (views.length) { const keep = this.aheadLevels; void this.prefetch(views, { timeout: (ahead + 1) * 4000 }); if (keep) this.aheadLevels = new Set([...keep, ...(this.aheadLevels ?? [])]); }
        }
        const w0 = this.nowReal(), rep = await this.holdStill(timeout);
        const f = await this.frame({ attribution: o.attribution });
        yield { index: i, t, width: f.width, height: f.height, pixels: f.pixels, settled: rep.settled, pending: rep.pending, waitedMs: Math.round(this.nowReal() - w0) };
      }
    } finally {
      this.recordingNow = false; this.aheadLevels = null;
      if (o.size) r.pin(null);
      if (was && !this.disposed) this.start();
    }
  }
  /** a way the camera will go, as poses at the recording's seconds (null: none known) */
  private pathOf(p: RecordOptions['path'], fps: number): ((t: number) => Pose | null) | null {
    void fps;
    if (p === undefined) {
      // (unset: the move playing, from where it is now, the world's time at its rate)
      const sh = this.shot; if (!sh || !this.camera.driving) return null;
      const t0 = sh.progress() * (sh.seconds ?? 0), mw = this.moveWorld(), T0 = this.timeMs, rate = this.clockRate;
      return (t) => sh.poseAt(t0 + t, mw, this.camInfo(), T0 + t * rate * 1000);
    }
    if (typeof p === 'function') return (t) => { const v = p(t); if (!v) return null; return 'pitch' in v ? v : this.camera.framed(poseOf(v)); };
    if ('aim' in p) {
      const sh = new Shot(p), mw = this.moveWorld(), T0 = this.timeMs, rate = this.clockRate;
      return (t) => sh.poseAt(t, mw, this.camInfo(), T0 + t * rate * 1000);
    }
    const k = p as Keys, t0 = k.list[0]!.at;
    return (t) => this.camera.framed(k.pose(t0 + t));
  }
  /** the world held at its moment until it is complete (only loading: its clock does not move, steps of no time) and a
   *  level's swap done; or until `timeout` ms */
  private async holdStill(timeout: number): Promise<SettleReport> {
    const t0 = Date.now();
    for (let first = true; ; first = false) {
      const rep = this.report({ hold: true });
      if (!first && rep.settled && !this.gates?.swap) return rep;
      if (this.disposed) throw new AslnutError('E-WORLD-003', 'the world was disposed while recording', { fix: 'finish the recording before dispose()' });
      if (Date.now() - t0 > timeout) return { ...rep, settled: false };
      this.holdMs += 1000 / 30; this.step(0);
      await new Promise((ok) => setTimeout(ok, 4));
    }
  }
  /** the next frame's pixels (RGBA, top row first) */
  async frame(o: { attribution?: boolean | string } = {}): Promise<{ width: number; height: number; pixels: Uint8Array }> {
    if (!this.renderer) throw new AslnutError('E-WORLD-003', 'a headless world has no frames', { fix: 'give world() a canvas' });
    const f = await this.renderer.read();
    const text = o.attribution === true ? this.attribution().join(' · ') : typeof o.attribution === 'string' ? o.attribution : '';
    return text ? burn(f, text) : f;
  }

  // ── what is happening ───────────────────────────────────────────────────────────────────────────────────────
  stats() {
    const surf = this.elements.map((l) => (l as unknown as { tileStats?: () => unknown }).tileStats?.()).find(Boolean) as Record<string, number> | undefined;
    const r = this.renderer;
    return {
      api: this.api, reason: this.reason, quality: this.profile?.quality ?? null, device: this.graphics?.caps.device ?? '',
      fps: r?.fps ?? 0, cpuMs: r?.cpuMs ?? 0, frames: this.frameN, draws: this.graphics?.stats.draws ?? 0, passes: this.graphics?.stats.passes ?? 0, uploadBytes: this.graphics?.stats.uploadBytes ?? 0,
      heapBytes: (typeof performance !== 'undefined' ? (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize : 0) ?? 0, drawn: r?.drawn ?? 0, skipped: r?.skipped ?? 0, pixelRatio: r?.pixelRatio ?? 0, size: this.graphics ? [this.graphics.width, this.graphics.height] : [0, 0],
      gpuBytes: this.graphics?.bytes ?? 0, tiles: surf ?? null, loader: this.loader.stats(),
      zoom: this.camera.zoom, elements: this.sorted.map((l) => ({ id: l.id, kind: l.kind, shown: l.shown })),
    };
  }
  /** what the world costs now, against its budget (core › runtime › telemetry): frame times (ms between drawn frames,
   *  p50 / p95 of the last ones), the chip's ms, draws, triangles, graphics memory, tiles, what is loading and dropped;
   *  the quality and why; the frames (drawn a second, who wants them, resting); and each layer's share: its draws,
   *  triangles and ms in the last frame, the graphics memory under its name, the frames it wants. The observation
   *  panel shows it; a layer's cost is never hidden */
  telemetry(): Telemetry {
    const g = this.graphics, r = this.renderer, gaps = [...this.recentGaps].sort((a, b) => a - b), q = (k: number) => (gaps.length ? +gaps[Math.min(gaps.length - 1, Math.floor(gaps.length * k))]!.toFixed(1) : 0);
    const held = g?.memory() ?? [], MB = 1048576, byLayer = new Map<string, number>();
    const ids = this.elements.map((l) => l.id).sort((a, b) => b.length - a.length);
    for (const h of held) {
      const lab = h.label.startsWith('solids ') ? h.label.slice(7) : h.label;
      const id = ids.find((x) => lab === x || lab.startsWith(`${x} `)) ?? '(world)';
      byLayer.set(id, (byLayer.get(id) ?? 0) + h.bytes);
    }
    const tri = (ds: readonly DrawCall[]) => { let n = 0; for (const d of ds) n += (d.count * (d.instanceCount ?? 1)) / (d.program?.desc?.topology === 'lines' ? 2 : 3); return Math.round(n); };
    const s = this.state, fo = this.framesOpts, surf = this.elements.map((l) => (l as unknown as { tileStats?: () => Record<string, number> }).tileStats?.()).find(Boolean) ?? null;
    const elements = this.sorted.map((l) => {
      const ds = this.drawsOf.get(l) ?? [], on = l.shown > 0 || l.target > 0;
      let wants = 0; if (on) { try { wants = l.wantsFrames(s); if (fo.rate && wants > 0) wants = fo.rate(l, wants, s); } catch { wants = 0; } }
      return { id: l.id, kind: l.kind, shown: l.shown, draws: on ? ds.length : 0, triangles: on ? tri(ds) : 0, ms: +(this.layerMs.get(l.id) ?? 0).toFixed(2), gpuMB: +((byLayer.get(l.id) ?? 0) / MB).toFixed(1), wants: Math.min(wants, fo.max ?? Infinity) };
    });
    const want = r ? this.wanted(this.nowReal()) : { rate: 0, who: '' };
    return {
      frameMs: q(0.5), frameP95: q(0.95), cpuMs: +(r?.cpuMs ?? 0).toFixed(2), gpuMs: g?.stats.gpuMs ?? null,
      draws: g?.stats.draws ?? 0, triangles: tri(this.lastDraws), memoryMB: +((g?.bytes ?? 0) / MB).toFixed(1),
      tiles: surf, loading: this.report().pending.length, dropped: this.gov?.drops ?? [],
      budget: this.gov ? { ...this.gov.budget } : null,
      quality: { now: s.render.quality, auto: this.profile?.quality ?? null, tier: this.profile?.tier ?? null, why: this.qualityWhy() },
      frames: { fps: r?.fps ?? 0, wants: want.rate, who: want.who, resting: r?.resting ?? false, restedMs: Math.round(r?.rested ?? 0), drawn: r?.drawn ?? 0, every: this.everies.map((e) => ({ id: e.id, fps: e.fps, ms: +e.ms.toFixed(2), budgetMs: e.budgetMs })) },
      elements, memory: [...byLayer].map(([id, b]) => ({ id, MB: +(b / MB).toFixed(1) })).sort((a, b) => b.MB - a.MB),
    };
  }
  /** why the quality is what it is now, in words */
  private qualityWhy(): string {
    if (this.qualityDrop) return 'the governor dropped it (frames over the budget)';
    if (this.qualityNow !== null) return 'set (w.setQuality)';
    if (this.qualityFn) return 'your function';
    return this.profile?.why === 'as asked' ? 'set (the quality option)' : this.profile?.why ? `auto: ${this.profile.why}` : 'auto: this device';
  }
  /** the gaps between the last drawn frames (ms) */
  private recentGaps: number[] = [];
  private layerMs = new Map<string, number>(); private pickMs = 0;
  private longTasks: { at: number; ms: number }[] = []; private longObs: PerformanceObserver | null = null;
  /** where the last frame's time went (and the browser's long tasks in the last second) */
  frameProfile(): FrameProfile {
    if (!this.longObs && !this.disposed && typeof PerformanceObserver !== 'undefined' && PerformanceObserver.supportedEntryTypes?.includes('longtask')) {
      try { this.longObs = new PerformanceObserver((l) => { for (const e of l.getEntries()) this.longTasks.push({ at: e.startTime, ms: e.duration }); if (this.longTasks.length > 200) this.longTasks.splice(0, 100); }); this.longObs.observe({ type: 'longtask', buffered: true }); } catch { /* not here */ }
    }
    const r = this.renderer, g = this.graphics, now = this.nowReal(), lt = this.longTasks.filter((t) => now - t.at < 1000);
    const surf = this.elements.map((l) => (l as unknown as { frameCost?: () => FrameProfile['surface'] }).frameCost?.()).find(Boolean) ?? null;
    return {
      tickMs: r?.tickMs ?? 0, submitMs: r?.submitMs ?? 0, elements: [...this.layerMs].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => [k, +v.toFixed(2)]),
      surface: surf, pickMs: +this.pickMs.toFixed(2), uploads: g?.stats.uploads ?? 0, uploadBytes: g?.stats.uploadBytes ?? 0, draws: g?.stats.draws ?? 0,
      size: g ? [g.width, g.height] : [0, 0], pixelRatio: r?.pixelRatio ?? 0, longTasks: lt.length, longTaskMs: Math.round(lt.reduce((a, t) => a + t.ms, 0)),
      gpuMs: g?.stats.gpuMs ?? null, uploadMaxMs: g?.stats.uploadMaxMs ?? 0, passes: g?.stats.passes ?? 0,
    };
  }
  /** the attribution of what is shown */
  attribution(): string[] { return [...new Set(this.sorted.filter((l) => l.shown > 0 || l.kind === 'basemap').flatMap((l) => l.attribution()).filter(Boolean))]; }
  on<K extends keyof Events>(ev: K, f: (...e: Events[K]) => void): () => void {
    const m = this.ev as Record<string, unknown>, set = (m[ev] ??= new Set()) as Set<(...e: Events[K]) => void>;
    set.add(f); return () => set.delete(f);
  }
  private once<K extends keyof Events>(ev: K, f: (...e: Events[K]) => void): void { const off = this.on(ev, (...e) => { off(); f(...e); }); }
  private emit<K extends keyof Events>(ev: K, ...e: Events[K]): void { const set = this.ev[ev] as Set<(...e: Events[K]) => void> | undefined; if (set) for (const f of [...set]) { try { f(...e); } catch (err) { if (ev !== 'error') this.error(err); } } }
  error(e: unknown): void { this.remote?.send('error', { msg: String((e as Error)?.message ?? e).slice(0, 500), code: (e as { code?: string })?.code }, 'warn'); if (this.ev.error?.size) this.emit('error', e); else this.errorHandler(e); }

  // ── picking, hover, tap, selection ──────────────────────────────────────────────────────────────────────────
  /** what is under a point (CSS px on the canvas): the top-most shown feature, on WebGPU and WebGL2 alike (an id
   *  pass over a few pixels round the point; the ground hides what is behind it) */
  async pick(x: number, y: number, o: PickOptions = {}): Promise<Picked | null> {
    const r = this.renderer, g = this.graphics;
    if (!r || !g || this.disposed) return null;
    const dpr = r.pixelRatio, rad = Math.max(0, Math.round((o.radius ?? 4) * dpr)), T = 2 * rad + 1;
    if (!this.pickTarget || this.pickTarget.width !== T) { this.pickTarget?.destroy(); this.pickTarget = g.target(T, T, { label: 'picking' }); }
    // (a layer named answers for what it owns: its labels)
    const only = o.elements ? new Set([...o.elements, ...this.elements.filter((x) => x.owner && o.elements!.includes(x.owner.id)).map((x) => x.id)]) : null;
    // marks drawn into the ground's tiles that answer on the CPU (areas): not drawn into the picking pass, asked at
    // the ground under the point when nothing above the ground is there
    const cpu: Element[] = [];
    for (const l of this.sorted) if (l.groundPick && (this.drawsOf.get(l) ?? []).some((d) => d.ground) && (!only || only.has(l.id))) cpu.push(l);
    const byCpu = new Set<DrawCall>(); for (const l of cpu) for (const d of this.drawsOf.get(l) ?? []) if (d.ground) byCpu.add(d);
    const collect = () => {
      const elementOf = new Map<DrawCall, Element>();
      for (const l of this.sorted) for (const d of this.drawsOf.get(l) ?? []) elementOf.set(d, l);
      // two scenarios side by side: only what is drawn on the pointer's side
      const cv = this.compareView, hidden = cv ? (x < cv.at * (this.renderer?.cssWidth ?? 1) ? cv.leftHides : cv.rightHides) : null;
      return this.lastDraws.filter((d) => d.pickProgram && !byCpu.has(d) && !(hidden && elementOf.get(d) && hidden.has(elementOf.get(d)!)) && (!only || !elementOf.get(d) || elementOf.get(d)!.kind === 'basemap' || only.has(elementOf.get(d)!.id))).map((d) => ({ ...d, program: d.pickProgram!(), blocks: d.blocks[0] === this.subjectBlock ? [r.frameBlock, ...d.blocks.slice(1)] : d.blocks }));
    };
    const onGround = (): Picked | null => {
      if (!cpu.length) return null;
      const ll = this.groundUnder(x, y); if (!ll) return null;
      for (let i = cpu.length - 1; i >= 0; i--) {
        const l = cpu[i]!, index = l.groundPick!(ll[0], ll[1]); if (index === null) continue;
        const info = l.pickInfo(index); if (!info) continue;
        const h = this.heightAt(ll[0], ll[1]);
        return { ...info, at: [ll[0], ll[1], Number.isNaN(h) ? 0 : h], x, y };
      }
      return null;
    };
    // nothing to draw but the ground itself (every mark answers on the CPU): no picking pass at all
    const ground = new Set<DrawCall>(); for (const l of this.sorted) if (l.kind === 'basemap' || l.kind === 'sky') for (const d of this.drawsOf.get(l) ?? []) ground.add(d);
    if (!this.lastDraws.some((d) => d.pickProgram && !byCpu.has(d) && !ground.has(d))) return onGround();
    let draws = collect();
    if (!draws.length) return onGround();
    this.picking = true;
    let px: Uint8Array;
    try {
      // the picking twins are built on first need (WebGPU builds them in the background): wait for them once, then
      // draw the latest frame's calls (their buffers hold that frame) with that frame's camera
      if (draws.some((d) => !(d.program as { ok?: boolean }).ok)) { await Promise.all(draws.map((d) => d.program.ready.catch(() => {}))); draws = collect(); }
      if (this.disposed || !this.pickTarget) { this.picking = false; return null; }
      const W = g.width, H = g.height, nx = ((x * dpr) / W) * 2 - 1, ny = 1 - ((y * dpr) / H) * 2, sx = W / T, sy = H / T;
      const f = this.pickFrame; f.set(r.frameData); f[36] = 1; f.set([sx, sy, -nx * sx, -ny * sy], 40); f[60] = T; f[61] = T;
      this.lastPick = this.nowReal();
      r.frameBlock.write(f);
      const read = g.frame(draws, { clear: [0, 0, 0, 0], target: this.pickTarget, read: true })!;
      // the frame block back at once: the picking pass is already recorded, the next frame must see its own
      r.frameBlock.write(r.frameData);
      px = await read;
    } catch (e) { this.picking = false; this.error(e); return null; }
    this.picking = false;
    // the nearest id to the middle
    let best = -1, bestD = Infinity;
    for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) {
      const q = (j * T + i) * 4; if (!px[q]) continue;
      const d = (i - rad) ** 2 + (j - rad) ** 2; if (d < bestD) { bestD = d; best = q; }
    }
    if (best < 0) return onGround();
    const no = px[best]!, index = px[best + 1]! + px[best + 2]! * 256 + px[best + 3]! * 65536;
    const l = this.elements.find((x2) => x2.pickNo === no); if (!l) return null;
    const info = l.pickInfo(index); if (!info) return null;
    const ll = this.camera.lonLatAt(x, y), h = ll ? this.heightAt(ll[0], ll[1]) : NaN;
    return { ...info, at: ll ? [ll[0], ll[1], Number.isNaN(h) ? 0 : h] : null, x, y };
  }
  /** the place on the ground under a point (CSS px): the camera's ray down to the terrain (a few steps from the
   *  camera's ground height to the heights found there); null: the sky */
  private groundUnder(x: number, y: number): [number, number] | null {
    const c = this.camera, ex = this.exaggeration;
    let h = c.groundY, ll: [number, number] | null = null;
    for (let k = 0; k < 6; k++) {
      const p = c.groundHit(x, y, h); if (!p) return ll;
      ll = lonLatOf(c, p[0], p[1], p[2]);
      const g = this.heightAt(ll[0], ll[1]); if (Number.isNaN(g)) break;
      const next = g * ex; if (Math.abs(next - h) < 0.5) break;
      h = next;
    }
    return ll;
  }
  private drawsOf = new Map<Element, DrawCall[]>();
  private pickFrame = new Float32Array(FRAME_FLOATS); private lastPick = -1e9; private pickedAt: { x: number; y: number } | null = null;
  /** the hover pick, at most every 50 ms, never inside a frame (it rewrites the frame block), and not again for a
   *  pointer that has not moved a pixel */
  private pickSoon(): void {
    if (!this.hoverWanted || this.picking || !this.pointer || this.nowReal() - this.lastPick <= 50) return;
    const p = this.pointer, was = this.pickedAt;
    this.hoverWanted = false;
    if (was && Math.abs(was.x - p.x) < 1 && Math.abs(was.y - p.y) < 1 && !this.dirtySincePick) return;
    this.pickedAt = { x: p.x, y: p.y }; this.dirtySincePick = false;
    queueMicrotask(() => { this.hoverAt(p).catch(() => { this.picking = false; }); });
  }
  private dirtySincePick = true;
  private nowReal(): number { return typeof performance !== 'undefined' ? performance.now() : Date.now(); }
  private async hoverAt(p: { x: number; y: number; cx: number; cy: number }): Promise<void> {
    const t0 = this.nowReal();
    const f = await this.pick(p.x, p.y, { radius: 3 });
    this.pickMs = this.nowReal() - t0;
    const ll = this.camera.lonLatAt(p.x, p.y);
    await this.setHover(f, { x: p.x, y: p.y, lon: ll?.[0] ?? null, lat: ll?.[1] ?? null }, p.cx, p.cy);
  }
  private async setHover(f: Picked | null, info: PointerInfo | null, cx = 0, cy = 0): Promise<void> {
    const was = this.hoverNow, same = (!was && !f) || (was && f && was.element === f.element && String(was.id) === String(f.id));
    if (!same) {
      this.invalidate();
      if (was) { try { this.element(was.element).hovered(null); } catch { /* removed */ } }
      if (f) { const l = this.element(f.element) as Element & { groupOf?: (k: string) => Set<string> }; l.hovered(l.groupOf ? l.groupOf(String(f.id)) : new Set([String(f.id)])); }
      this.hoverNow = f; this.user.hover = f ? String(f.id) : null; this.stateCache = null;
      const lp = f ? (this.element(f.element).props as { onHover?: (f: Picked | null, s: State) => void; hover?: { cursor?: string } | false }) : null;
      if (was && (!f || was.element !== f.element)) { try { (this.element(was.element).props as { onHover?: (f: null, s: State) => void }).onHover?.(null, this.state); } catch { /* removed */ } }
      lp?.onHover?.(f, this.state);
      void this.formFor('hover', f, f ? (lp?.hover as FormVisual | false | undefined) : undefined);
      if (f) this.remember(f);
      if (this.canvasEl) this.canvasEl.style.cursor = f ? ((lp?.hover && lp.hover.cursor) || ((lp as { onTap?: unknown; select?: unknown } | null)?.onTap || (lp as { select?: unknown } | null)?.select ? 'pointer' : '')) : '';
      this.emit('hover', f, info);
    }
    this.tooltip(f, cx, cy);
  }
  private tooltip(f: Picked | null, cx: number, cy: number): void {
    const fn = f ? (this.element(f.element).props as { tooltip?: (d: unknown, s: State) => string | HTMLElement | null | undefined }).tooltip : undefined;
    const text = f && fn ? fn(f.d, this.state) ?? null : null;
    if (this.tipOpts?.show) { this.tipOpts.show(text, cx, cy); return; }
    if (typeof document === 'undefined') return;
    if (!text) { if (this.tip) this.tip.style.display = 'none'; return; }
    if (!this.tip) {
      const t = document.createElement('div'); t.className = this.tipOpts?.className ?? 'aslnut-tooltip';
      if (!this.tipOpts?.className) Object.assign(t.style, { position: 'fixed', zIndex: '20', pointerEvents: 'none', background: 'rgba(12,16,24,.92)', color: '#eef2f6', font: '12px/1.35 system-ui, sans-serif', padding: '5px 8px', borderRadius: '6px', border: '1px solid rgba(255,255,255,.14)', maxWidth: '260px', whiteSpace: 'pre-line', boxShadow: '0 4px 14px rgba(0,0,0,.35)' });
      document.body.appendChild(t); this.tip = t;
    }
    const t = this.tip; if (typeof text === 'string') t.textContent = text; else { t.textContent = ''; t.appendChild(text); }
    t.style.display = 'block';
    const w = t.offsetWidth, h = t.offsetHeight, vw = innerWidth;
    t.style.left = `${Math.max(4, Math.min(vw - w - 4, cx + 14))}px`; t.style.top = `${Math.max(4, cy - h - 12 < 4 ? cy + 18 : cy - h - 12)}px`;
  }
  private async tapAt(x: number, y: number, touch: boolean): Promise<void> {
    const f = await this.pick(x, y, { radius: touch ? 12 : 4 });
    const ll = this.camera.lonLatAt(x, y), info: PointerInfo = { x, y, lon: ll?.[0] ?? null, lat: ll?.[1] ?? null };
    if (touch) { const r = this.canvasEl?.getBoundingClientRect(); await this.setHover(f, info, x + (r?.left ?? 0), y + (r?.top ?? 0)); }
    if (f) {
      const lp = this.element(f.element).props as { onTap?: (f: Picked, s: State) => void; select?: 'tap' | 'toggle' | false };
      this.remember(f);
      if (lp.select === 'tap') this.select([f.id]);
      else if (lp.select === 'toggle') { const k = String(f.id), cur = this.user.selection; this.select(cur.includes(k) ? cur.filter((x2) => x2 !== k) : [...cur, k]); }
      lp.onTap?.(f, this.state);
    }
    this.emit('tap', f, info);
  }
  /** the layer a selected (or hovered) id was picked from, when this world picked it (ids are only unique within their
   *  layer: two layers' things may share one); undefined: not known */
  selectedBy(id: string): string | undefined { return this.pickedById.get(id)?.element; }
  /** select features by id: every style and `when` reads s.user.selection */
  select(ids: readonly (string | number)[] | null): this {
    this.invalidate();
    this.user.selection = (ids ?? []).map(String); this.stateCache = null;
    // a form on each selected thing whose layer asks for one (things picked before: their place is known)
    if (this.formLayer || this.sorted.some((l) => (l.props as { selected?: FormVisual | false }).selected && ((l.props as { selected?: FormVisual }).selected as FormVisual).shape)) {
      const want = new Set(this.user.selection.map((id) => `sel:${id}`));
      for (const k of this.formLayer?.keysShown() ?? []) if (k.startsWith('sel:') && !want.has(k)) void this.formFor(k, null, undefined);
      for (const id of this.user.selection) { const f = this.pickedById.get(id); if (f) { try { void this.formFor(`sel:${id}`, f, (this.element(f.element).props as { selected?: FormVisual | false }).selected); } catch { /* its layer went */ } } }
    }
    this.emit('select', this.user.selection);
    return this;
  }
  /** turn a named toggle on or off (s.user.toggles) */
  toggle(name: string, on?: boolean): this { this.invalidate(); this.user.toggles = { ...this.user.toggles, [name]: on ?? !this.user.toggles[name] }; this.stateCache = null; return this; }
  /** show a layer by hand (its reveal plays), over its `when` (a still view draws for it: render on change);
   *  `seconds`: this change's own length (0: at once, one frame: a layer list's toggle) */
  reveal(id: string, o: { seconds?: number } = {}): this { const l = this.element(id); l.forced = true; if (o.seconds !== undefined) l.once = o.seconds; this.ownedOnce(l, o.seconds); this.invalidate(); this.emit('elements', { what: 'shown', ids: [id] }); return this; }
  /** hide a layer by hand (its reveal plays backwards), over its `when`; `seconds` as reveal's */
  hide(id: string, o: { seconds?: number } = {}): this { const l = this.element(id); l.forced = false; if (o.seconds !== undefined) l.once = o.seconds; this.ownedOnce(l, o.seconds); this.invalidate(); this.emit('elements', { what: 'shown', ids: [id] }); return this; }
  /** set the world's time (it stands still there until you set 'now') */
  setTime(t: Date | 'now', o: { rate?: number } = {}): this { this.invalidate(); this.timeRest = 0; if (t === 'now') { this.timeIsNow = true; this.time = new Date(); this.clockRate = 1; } else { this.timeIsNow = false; this.time = new Date(t.getTime()); this.clockRate = o.rate ?? 0; } this.stateCache = null; return this; }
  /** how fast the world's time runs, seconds per second (0: still; 600: ten minutes a second); setting it leaves 'now' */
  get timeRate(): number { return this.clockRate; }
  setTimeRate(rate: number): this { if (this.timeIsNow && rate === 1) return this; this.timeIsNow = false; this.clockRate = rate; this.invalidate(); this.stateCache = null; return this; }
  /** the zone of the world's clocks: an IANA name, 'auto' (the place's), your lookup, or undefined for solar time */
  setTimeZone(zone: TimeZoneOption | undefined): this { this.zones = this.zoneTracker(zone); this.stateCache = null; this.invalidate(); return this; }
  /** the zone the world's clocks keep now (an IANA name; null: solar time) */
  get timeZone(): string | null { return this.zones.zoneAt(this.camera.lon, this.camera.lat); }
  private zoneTracker(o: TimeZoneOption | undefined): ZoneTracker { return new ZoneTracker(o, () => { this.stateCache = null; this.invalidate(); }); }
  /** the quality every `when` and look reads (s.render.quality); null: the device's */
  setQuality(q: Quality | null): this { this.invalidate(); this.qualityNow = q; this.stateCache = null; return this; }
  /** the world now as a state: camera, time, observation, layers (shown, params, filter), selection, toggles */
  capture(o?: CaptureOptions): WorldState { return capture(this, o); }
  /** show a state: the camera flies there with an easing preset, layers reveal or hide; resolves on arrival */
  apply(s: WorldState | unknown, o?: ApplyOptions): Promise<ApplyReport> { return apply(this, s, o); }
  /** give the layer back to its `when` */
  release(id: string, o: { seconds?: number } = {}): this { const l = this.element(id); l.forced = null; if (o.seconds !== undefined) l.once = o.seconds; this.ownedOnce(l, o.seconds); this.invalidate(); this.emit('elements', { what: 'shown', ids: [id] }); return this; }
  private alive(): void { if (this.disposed) throw new AslnutError('E-WORLD-003', 'the world was disposed', { fix: 'make a new world' }); }
  get isDisposed(): boolean { return this.disposed; }

  /** stop the clock, remove the controls and observers, detach every layer and free all graphics memory */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.renderer?.stop();
    if (this.heartbeat) clearInterval(this.heartbeat); this.heartbeat = null; this.remote?.dispose(); this.remote = null; this.gov = null;
    // the long-task observer is held by the browser while it observes: left on, it kept the whole world (its graphics
    // device, canvas, tiles and data) alive after dispose, one more for every world made in the page
    this.longObs?.disconnect(); this.longObs = null; this.longTasks = [];
    this.detachControls?.(); this.detachControls = null;
    this.tip?.remove(); this.tip = null; this.pickTarget = null; this.creditsEl?.remove(); this.creditsEl = null;
    this.shadowTarget = null; this.shadowBuf = null; this.noShadow = null; this.subjectBlock = null; this.subjectDraws.clear();
    this.camera.stop();
    for (const l of this.elements) { try { l.detach(); } catch (e) { this.errorHandler(e); } }
    this.elements = []; this.sorted = [];
    this.renderer?.dispose();
    if (this.ownLoader) this.loader.dispose();
    this.ev = {}; this.paramDefs.clear(); this.readDefs.clear(); this.pointDefs.clear();
  }
}

/** make a world on a canvas (null: headless) */
export async function world(canvas: HTMLCanvasElement | OffscreenCanvas | null, o: WorldOptions = {}): Promise<World> {
  const body = o.body ?? null;
  const own = !(o.loader instanceof Loader);
  const mem = o.memory, memOpts = mem ? { ...(mem.limitMB !== undefined ? { memory: mem.limitMB * 1048576 } : {}), ...(mem.evict !== undefined ? { evict: mem.evict } : {}) } : {};
  const loader = o.loader instanceof Loader ? o.loader : new Loader({ ...o.loader, ...memOpts });
  if (mem && o.loader instanceof Loader) o.loader.setMemory(mem.limitMB !== undefined ? mem.limitMB * 1048576 : o.loader.budget, mem.evict);
  const camera = new Camera();
  // (a flat body: a floor, a room; the camera may come as near as a person's eye)
  if (body?.flat) { camera.flat = true; camera.minDist = 1; }
  if (o.frame) camera.frame = o.frame;
  let graphics: Graphics | null = null, reason = 'headless (no canvas)', profile: Profile | null = null;
  if (canvas) {
    const g = await openGraphics(canvas, o.graphics ?? 'auto');
    graphics = g.graphics; reason = g.reason;
    const q0 = o.render?.quality ?? o.quality, qv = typeof q0 === 'string' && q0 !== 'auto' ? q0 : undefined;
    profile = profileOf(graphics.caps, { quality: qv });
    if (qv === undefined && profile.why) reason += ` · quality ${profile.quality} (${profile.why})`;
  }
  const w = new World({ body, camera, loader, ownLoader: own, graphics, reason, profile, canvas, opts: o });
  if (canvas && 'getBoundingClientRect' in canvas) { const r = (canvas as HTMLCanvasElement).getBoundingClientRect(); camera.width = Math.max(1, r.width); camera.height = Math.max(1, r.height); }
  // the first view as it is asked: nearer than the default nearest distance, that is the nearest (an app's own
  // controllers.orbit({ zoomRange }) sets its own after)
  const v0 = o.view ?? body?.view ?? { lon: 0, lat: 0, zoom: 1.5 }, first = typeof v0 === 'string' ? w.views.get(v0) : v0;
  if (first) { checkView(first, 'view'); const d = camera.framed(poseOf(first)).dist; if (d < camera.minDist) camera.minDist = d; }
  w.go(v0);
  if (o.observation) w.observe(o.observation);
  if (body) w.add(...body.elements());
  if (graphics && o.autostart !== false) w.start();
  return w;
}

/** is a load error "not to be had now" (replay / offline), as opposed to a failure */
export const isMiss = (e: unknown) => e instanceof LoaderMiss;
export interface FitOptions { /** the margin, a fraction of the canvas each side (default .08) */ padding?: number; tilt?: number; bearing?: number; /** never closer than this zoom */ maxZoom?: number }
/** the attribution written into a frame's pixels (bottom right, on a dark band): captures keep their credits */
function burn(f: { width: number; height: number; pixels: Uint8Array }, text: string): { width: number; height: number; pixels: Uint8Array } {
  if (typeof OffscreenCanvas === 'undefined') return f;
  const cv = new OffscreenCanvas(f.width, f.height), g = cv.getContext('2d') as OffscreenCanvasRenderingContext2D | null;
  if (!g) return f;
  g.putImageData(new ImageData(new Uint8ClampedArray(f.pixels) as Uint8ClampedArray<ArrayBuffer>, f.width, f.height), 0, 0);
  const size = Math.max(10, Math.round(f.height * 0.016)), pad = Math.round(size * 0.5);
  g.font = `500 ${size}px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif`;
  let t = text; while (t.length > 8 && g.measureText(t).width > f.width - 4 * pad) t = `${t.slice(0, -2)}`;
  if (t !== text) t = `${t.slice(0, -1)}…`;
  const tw = g.measureText(t).width;
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.fillRect(f.width - tw - 2 * pad, f.height - size - 2 * pad, tw + 2 * pad, size + 2 * pad);
  g.fillStyle = 'rgba(255,255,255,0.92)'; g.textBaseline = 'bottom'; g.fillText(t, f.width - tw - pad, f.height - pad);
  const out = g.getImageData(0, 0, f.width, f.height);
  return { width: f.width, height: f.height, pixels: new Uint8Array(out.data.buffer) };
}
