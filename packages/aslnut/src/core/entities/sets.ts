// core › entities › sets: many entities as one set, one draw; drive › data: moved by data over time. The set keeps
// data, not geometry: each thing's samples (a place, a time, the values it carries) live in a history log's columns
// (core › data › history), and go to the graphics chip once, as they are. The world's time is a uniform: the chip finds
// each thing's sample at that time (a binary search over its slots), places it between that sample and the next on
// the ground under it, turns it along its path, and fades its trail behind it. Nothing is done per thing per frame on
// the main thread; a live source only appends (its new samples are the only new bytes); a seek is one uniform.
// Drawn as a dot each (sized in CSS px, an outline) or, given a shape, that shape near the camera (as many as are big
// enough on screen, chosen once per view change; the dots give way to them on the chip). Colour, size: one for all,
// each thing's own (a function of its props), or its value over time through a ramp. Hover, tooltip, tap as a mark.
// A thing in the air (its log's altitude: each sample's height) is drawn that high, read on the chip between its
// samples as its place is; its shape turned by its pose (pitch from its climb, bank into its turns, eased; or the log's
// own columns), its contact shadow on the ground under it, shrinking and fading as it rises.
//   const fleet = history.log({ url: '/data/fleet.hist' })
//   w.add(entities({ id: 'fleet', drive: drive.data(fleet), shape: cars.make({ paint: '#ffffff' }),
//     color: { value: 'charge', ramp: 'rdylgn', domain: [0, 1] }, trail: { seconds: 60 } }))
//   drive.data(data.stream('wss://…/fleet'))        a live source: each row's change is a sample
//   entities({ drive: drive.data(history.log({ url, altitude: 'ground' })), shape: drones.quad, attitude: { bank: true },
//     near: { shadow: { fade: 40 } } })              in the air: banked into its turns, its shadow fading by 40 m up
import { AslnutError } from '../world/errors.ts';
import { Element, type AttachContext, type FrameContext, type ElementProps, type ElementStatus, type Picked } from '../world/element.ts';
import type { State } from '../world/state.ts';
import type { DrawCall, GBuffer, GTarget, GTexture, Graphics, Program, ProgramDesc } from '../render/graphics/interface.ts';
import { Log, type LogChange, type LogOptions, type Relations, type StateAt } from '../data/history.ts';
import { Source } from '../data/sources/source.ts';
import type { Feature } from '../data/features.ts';
import { setsGLSL } from '../render/graphics/shaders/sets.glsl.ts';
import { setsWGSL, SET_TEXTURES, type SetsVariant } from '../render/graphics/shaders/sets.wgsl.ts';
import { ramp as rampOf, type Ramp } from '../render/style/ramp.ts';
import { rgba, type Color } from '../render/style/color.ts';
import { rgbOf, SHAPE_FLOATS } from '../geometry/shapes/mesh.ts';
import { Entities, type EntitiesProps } from '../geometry/shapes/instances.ts';
import { jointFormulas, keptLevel, LEVEL_MARGIN, type SetJoint } from '../geometry/shapes/solids.ts';
import { rateOf, type JointDriver } from '../geometry/shapes/instances.ts';
import type { Made } from '../geometry/shapes/shape.ts';
import { motionFrames } from '../runtime/frame.ts';
import { D, R, mercY, latOfMercY, wrap } from '../space/geo.ts';
import { rangeUnits, sizeUnits, sizeValue, type SizeOf, type SizeRange } from '../render/drawing/size.ts';

// ── drive › data ───────────────────────────────────────────────────────────────────────────────────────────────
export interface DataDriveOptions {
  /** ms the drawing runs behind the data: a live thing always has its next sample to move towards (default 250 for a
   *  live source, 0 for a log) */
  smooth?: number;
  /** a source's sample time from its feature (default its props `t` or `time`, else when the change arrived) */
  time?: (d: Feature) => number | Date | string | null | undefined;
  /** a source's values from its feature (default the props named as the log's values; a log's altitude: its point's
   *  third coordinate when its props have none) */
  values?: Record<string, (d: Feature) => number>;
  /** the log made for a source (its values, what it keeps) */
  log?: LogOptions;
}
/** why a set moves: data over time, a log (recorded, or filled by you) or a live source recorded into one */
export class DataDrive {
  readonly kind = 'data' as const;
  readonly log: Log; readonly source: Source | null;
  /** ms behind the data */
  smooth: number;
  private o: DataDriveOptions; private seen = new Map<string | number, Feature>(); private off: (() => void) | null = null; private started: Promise<void> | null = null;
  constructor(from: Log | Source<any>, o: DataDriveOptions = {}) {   // eslint-disable-line @typescript-eslint/no-explicit-any
    if (!(from instanceof Log) && !(from instanceof Source)) throw new AslnutError('E-DATA-001', 'drive.data takes a log (history.log) or a source (data.stream, data.rows…)', { fix: "drive.data(history.log({ url: '/data/fleet.hist' })) · drive.data(data.stream('wss://…'))" });
    this.o = o;
    this.source = from instanceof Source ? from : null;
    this.log = from instanceof Log ? from : new Log({ ...o.log, attribution: o.log?.attribution ?? from.attribution });
    this.smooth = o.smooth ?? (this.source ? 250 : 0);
  }
  /** load the log (a saved one) or start the source and record its changes */
  start(ctx: { loader: AttachContext['loader']; error: (e: unknown) => void }): Promise<void> {
    this.started ??= (async () => {
      await this.log.start(ctx);
      const src = this.source; if (!src) return;
      // (every row a sample: told of each change at once)
      this.off = src.watch(() => this.take(src), { now: true });
      await src.start(ctx);
      this.take(src);
    })();
    return this.started;
  }
  /** each feature changed since the last look is a sample (a stream's upsert makes new feature objects: only those) */
  private take(src: Source): void {
    const o = this.o, now = Date.now(), log = this.log, rows: { id: string | number; t: number | Date | string; lon: number; lat: number; values: Record<string, number>; props: Record<string, unknown> }[] = [];
    for (const f of src.features()) {
      if (this.seen.get(f.id) === f) continue;
      this.seen.set(f.id, f);
      const g = f.geometry; if (!g || g.type !== 'Point') continue;
      const [lon, lat, up] = g.coordinates as [number, number, number?];
      const tv = o.time ? o.time(f) : (f.props.t ?? f.props.time) as number | string | undefined;
      const values: Record<string, number> = {}, an = log.altitude?.value;
      // (a log with an altitude: a point's third coordinate, unless its props or your function say)
      for (const v of log.values) { const fn = o.values?.[v.name]; let x = fn ? fn(f) : Number(f.props[v.name]); if (!Number.isFinite(x) && !fn && v.name === an) x = Number(up); if (Number.isFinite(x)) values[v.name] = x; }
      rows.push({ id: f.id, t: tv ?? now, lon, lat, values, props: f.props as Record<string, unknown> });
    }
    if (rows.length) log.appendMany(rows);
  }
  stop(): void { this.off?.(); this.off = null; }
}
export const dataDrive = (from: Log | Source<any>, o?: DataDriveOptions) => new DataDrive(from, o);   // eslint-disable-line @typescript-eslint/no-explicit-any

// ── the set ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** a thing as your functions see it: its id, its props, and (picked, tooltip) its state now */
export interface Thing { id: string; props: Record<string, unknown>; index: number; state?: StateAt | null }
/** a colour from a value the samples carry: its domain through a ramp */
export interface ValueColor { value: string; ramp?: Ramp; domain?: [number, number] }
/** a size from a value the samples carry: its domain to a range of CSS px */
export interface ValueSize { value: string; range: [number, number]; domain?: [number, number] }
export interface EntitySetProps extends ElementProps {
  /** why it moves: drive.data(log | source) */
  drive: DataDrive;
  /** a shape drawn near the camera (a car), dots farther away; none: dots everywhere */
  shape?: Made | { make(): Made };
  /** the shapes: drawn while at least `pixels` long on screen (default 12; 0 when the shape keeps a range on screen),
   *  each thing in the shape's level for the pixels it covers (whole, simple, far: `levels`; or one, `level`), at most
   *  `max` whole or simple at once (default 200, the nearest; the rest far, or dots), its size, the seconds a turn
   *  through a corner takes (default
   *  1.2); a soft contact `shadow` on the ground under each (one quad each, placed on the chip: true, or its
   *  `opacity` (default .5) and `spread`, how far past the shape's sides it fades (default 1.3×); a thing in the air
   *  casts it on the ground under it, shrunk to half and faded away by `fade` metres up (default 6 × the shape's size
   *  across; false: the same at any height), none past `off` metres (default: no such height); none by default) */
  near?: { pixels?: number; max?: number; level?: 0 | 1 | 2; /** the shape's levels by the pixels each thing covers: whole above `full`, simple above `simple` (default 120, 25), far below; each kept until past an edge by `margin` (default .2: core › runtime › detail); `level` pins one instead */ levels?: { full?: number; simple?: number; margin?: number }; /** at most this many in the far form (default 4000, the nearest): the rest dots */ farMax?: number; scale?: number; /** the shapes kept within a range of CSS px across (default the shape's own `size`: core › render › drawing › size) */ size?: SizeRange; turn?: number; shadow?: boolean | { opacity?: number; spread?: number; fade?: number | false; off?: number } };
  /** how its shapes are turned in the air: `pitch` (nose up) from its climb (true: the angle its path rises or falls
   *  at) or a value its log carries (its name: degrees), `bank` into its turns (true: the angle a turn at its speed
   *  takes, a plane's or a drone's: atan(speed × turn rate / g)) or a value (degrees); from its path, each the mean over
   *  `damp` seconds of it either side (default 2: they ease in and out), at most `max` degrees (default [30, 45]); a
   *  thing with an altitude banks only off the ground (fully once as high over it as its shape is tall: a plane
   *  taxiing does not; without one, on the ground too: a motorbike leaning into its turns); turned about `pivot` (its shape's metres; default its foot, [0, 0, 0]). Found once a change of the time for the
   *  things drawn as shapes (a pass of its own on the chip); none by default (level) */
  attitude?: { pitch?: boolean | string; bank?: boolean | string; damp?: number; max?: [number, number]; pivot?: [number, number, number] };
  /** its shape's parts' drivers (core › entities › kinematics), by part name (or a joint's kind: `wheel`, every wheel): a rate for every thing (each its phase by
   *  its place in the set; `unit` 'rpm', 'deg/s', 'rad/s', a slider's 'm/s'), or your formula (statements in the WGSL
   *  subset setting `value`, degrees or a slider's metres, of `time` s and `seed`), or a value of its log (`{ value:
   *  'travel' }`: a wheel rolls by the metres each thing has gone, history.log({ travel: true }); a hinge by degrees, a
   *  slider by metres; × `per`; one value for all its joints, a 32-bit one); `joint(name, driver)` changes one */
  joints?: Record<string, JointDriver>;
  /** each thing's link (core › entities › placement: a reference read on the chip): an arc from where it is now (its own
   *  track, at the clock: nothing written per frame) to a place of its own (`to`: a car's home), rising `height` m at its
   *  middle (default a quarter of its length, at most 400), `pieces` a link (24), its `width` (CSS px, or `{ m, min, max }`;
   *  default 1.5) and `color`; faint (`opacity`, default .15) but for the hovered and the selected things (`focus`, 1) */
  links?: { to: (d: Thing) => [number, number] | [number, number, number] | null | undefined; height?: number; pieces?: number; width?: SizeOf<number>; color?: Color; opacity?: number; focus?: number };
  /** the dot's diameter, CSS px (default 7): a number, each thing's own, or its value over time (its `domain` → the
   *  `range` of sizes; the same value as a value colour's, when both are) */
  size?: SizeOf<number | ((d: Thing) => number)> | ValueSize;
  /** one colour, each thing's own (a function of it), or its value over time through a ramp */
  color?: Color | ((d: Thing) => Color) | ValueColor;
  /** the dot's outline (default a dark 1.5 px; false: none) */
  outline?: { color?: Color; width?: number } | false;
  /** where it has been: `seconds` behind it (default 60), `width` CSS px (2.5), `opacity` (.9), its own `color`
   *  (default each thing's), a `head` glow (.5), and how it `fade`s from the head to the tail: its opacity
   *  (1 − age / seconds) ^ k, 'linear' (k 1), 'ease' (k 2: the default) or your k; false: none */
  trail?: { seconds?: number; width?: number; opacity?: number; color?: Color; head?: number; fade?: 'linear' | 'ease' | number } | false;
  /** a gauge over each thing: a bar facing the screen, a fixed size in CSS px (default 28 × 6), filled to a value
   *  the samples carry (`value`, default the colour's or size's; its `domain`, default the column's) and coloured by it
   *  (`colors`: empty, half, full; default red, amber, green), with an `outline`; `lift` metres over the ground
   *  (default over its shape), seen within `within` metres (default: where its shape is drawn; no shape: everywhere);
   *  drawn `over` what stands within that many metres in front of it (a canopy over a car; default 0: hidden by
   *  anything in front); its `label`: the value in per cent of the domain across the bar ('72%': true, or its height
   *  in CSS px (default the bar's), its colour (white) and its halo's (a dark one)), drawn on the chip from a glyph
   *  atlas */
  gauge?: { value?: string; size?: [number, number]; domain?: [number, number]; colors?: [Color, Color, Color]; outline?: Color; lift?: number; within?: number; over?: number; label?: boolean | { size?: number; color?: Color; halo?: Color } } | false;
  /** its things held by others for a while (core › data › history: relations, by the things' ids): hidden while held,
   *  every drawing of them (dot, trail, shape, gauge, link, a card or an icon placed on them), on the chip; the host's
   *  card counts them (`relations.count`) */
  fold?: Relations;
  /** a dot for each thing far away (default true); false: none (an icon placed on the set draws them instead) */
  dots?: boolean;
  /** what it stands on (and what a log's altitude over the ground is over): 'stand' (the top of what is drawn: a road,
   *  a deck; the terrain elsewhere: default), 'ground' (the terrain), 'surface' (the terrain, or the sea's surface where
   *  the terrain is under it: what a plane flies over), 'sea' (height 0), or your function of the place (m) */
  on?: 'stand' | 'ground' | 'surface' | 'sea' | ((lon: number, lat: number) => number);
  /** metres over it (dots and trails; default .3) */
  lift?: number;
  opacity?: number;
  /** pixels the dots and trails are drawn in front of what they stand on (default 2) */
  depthBias?: number;
  /** before a thing's first sample: 'hide' (default) or 'hold' at its first place; after its last it holds */
  before?: 'hide' | 'hold';
  tooltip?: (d: Thing, s: State) => string | null | undefined;
  onTap?: (f: Picked<Thing>, s: State) => void;
  onHover?: (f: Picked<Thing> | null, s: State) => void;
  select?: 'tap' | 'toggle' | false;
  pickable?: boolean;
}
const S_FLOATS = 272, GRID = 96, MAX_K = 96;
const FADE = { linear: 1, ease: 2 } as const;
const isValueColor = (c: unknown): c is ValueColor => !!c && typeof c === 'object' && !Array.isArray(c) && typeof (c as ValueColor).value === 'string';
const isValueSize = (c: unknown): c is ValueSize => !!c && typeof c === 'object' && typeof (c as ValueSize).value === 'string';
/** a program and its picking twin (made on first need) */
class Pair {
  main: Program; private p: Program | null = null; private g: Graphics; private d: ProgramDesc;
  /** built (it draws), or failed (it never will) */
  ok = false; failed = false;
  constructor(g: Graphics, d: ProgramDesc, built?: () => void) { this.g = g; this.d = d; this.main = g.program(d); this.main.ready.then(() => { this.ok = true; built?.(); }, () => { this.failed = true; }); }
  pick(): Program { return (this.p ??= this.g.program({ ...this.d, label: `${this.d.label} pick`, blend: 'none' })); }
  destroy(): void { this.main.destroy(); this.p?.destroy(); this.p = null; }
}
/** a column's texture: slots a texel, its data for slots [a, b) */
interface Col { tex: GTexture; spt: number; view(a: number, b: number): ArrayBufferView }

export class EntitySet extends Element<EntitySetProps> {
  readonly kind = 'point' as const;
  readonly drive: DataDrive;
  private g: Graphics | null = null;
  private progs: { found?: Pair; pose?: Pair; dots?: Pair; trails?: Pair; models?: Pair; gauge?: Pair; shadow?: Pair; links?: Pair } = {}; private variantKey = '';
  /** each thing's sample at the time (a texel a thing: the found pass), the target it is drawn into, what it was drawn
   *  for (the time, the log's version, the things) */
  private found: GTexture | null = null; private foundTarget: GTarget | null = null; private foundRows = 0; private foundKey = '';
  /** each shaped thing's pose at the time (a texel a thing: the pose pass, in the air), its target, what it was drawn for */
  private poseTex: GTexture | null = null; private poseTarget: GTarget | null = null; private poseRows = 0; private poseKey = '';
  /** bumped when the things drawn as shapes change (their pose is found again) */
  private shapedVersion = 0;
  private ubuf: GBuffer | null = null; private u = new Float32Array(S_FLOATS);
  /** a quad's two triangles over its four corners (the dots' and the trail pieces': four vertices each, not six) */
  private quad: GBuffer | null = null;
  private things: GTexture | null = null; private thingsData = new Float32Array(0); private thingsCap = 0;
  /** the columns on the chip: times, places, the value its colour or size reads, its joints' value, its altitude, its
   *  pose's own columns (a pitch, a bank) */
  private cols: { t: Col; p: Col; v: Col | null; j: Col | null; a: Col | null; xp: Col | null; xb: Col | null } | null = null; private colRows = 0; private colKey = ''; private row = 4096;
  private ground: GTexture | null = null; private rampTex: GTexture | null = null; private dummy: GTexture | null = null;
  /** the gauge label's glyphs (made when a label is first wanted) */
  private glyphs: Glyphs | null = null; private labelled = false;
  private nearN = 0;
  private offLog: (() => void) | null = null;
  // what changed since the last upload: everything, slot ranges, things
  private dirtyAll = true; private ranges: number[] = []; private dirtyThings = new Set<number>(); private allThings = true;
  private valueCol = -1; private jointCol = -1; private altCol = -1; private pitchCol = -1; private bankCol = -1;
  private nowMs = 0; private sec = 0;
  constructor(p: EntitySetProps) {
    super(p);
    if (!(p.drive instanceof DataDrive)) throw new AslnutError('E-DATA-001', `entities '${this.id}': a set moved by data needs drive: drive.data(…)`, { where: this.id, fix: 'entities({ drive: drive.data(history.log({ url })) })' });
    this.drive = p.drive;
  }
  get log(): Log { return this.drive.log; }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    this.g = ctx.graphics;
    this.offLog = this.log.watch((c) => this.changed(c));
    if (this.g) {
      this.row = this.g.caps.maxTex >= 4096 ? 4096 : 2048;
      this.ubuf = this.g.buffer('uniform', S_FLOATS * 4, `${this.id} set`);
      this.quad = this.g.buffer('index', Uint32Array.from([0, 1, 2, 2, 1, 3]), `${this.id} quad`);
      this.dummy = this.g.texture({ label: `${this.id} none`, width: 1, height: 1, format: 'rgba8', filter: 'nearest' });
      this.dummy.write(new Uint8Array(4));
      this.ground = this.g.texture({ label: `${this.id} ground`, width: GRID, height: 2 * GRID, format: 'r32f', filter: 'nearest' });
    }
    void this.drive.start({ loader: ctx.loader, error: (e) => ctx.world.error(e) }).then(() => (ctx.world as { invalidate?: () => void }).invalidate?.());
  }
  /** what the log's change asks of the chip: the slots appended (their bytes only), the things touched (their slots'
   *  texels), the trail's pieces (one thing's own count: a binary search), the near set (soon); nothing scans the log */
  private changed(c: LogChange): void {
    if (c.kind === 'all') { this.dirtyAll = true; this.allThings = true; this.kDirty = true; }
    else if (c.kind === 'samples') this.ranges.push(c.lo, c.hi);
    else if (c.index < 0) { this.allThings = true; this.kDirty = true; }
    else {
      this.dirtyThings.add(c.index);
      if (this.kSeconds > 0 && !this.kDirty) this.K = Math.min(MAX_K, Math.max(this.K, this.log.densestOf(c.index, this.kSeconds) + 1));
    }
    this.nearLog = true;
    (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.();
  }
  override setProps(p: Partial<EntitySetProps>): this {
    const before = this.props;
    super.setProps(p);
    if ('trail' in p && (p.trail ? p.trail.seconds : 0) !== (before.trail ? before.trail.seconds : 0)) this.kDirty = true;
    if ('color' in p || 'size' in p) { this.allThings = true; this.variantKey = ''; this.rampKey = ''; }
    if ('shape' in p || 'near' in p) { this.shapeOf = null; this.nearDirty = true; if (!!(p.near?.shadow) !== !!(before.near?.shadow)) this.variantKey = ''; }
    if ('gauge' in p || 'fold' in p) this.variantKey = '';
    if ('fold' in p) this.foldSeen = '';
    if ('joints' in p || 'shape' in p) { this.jointsMade = null; this.variantKey = ''; }
    if ('attitude' in p || 'on' in p) { this.variantKey = ''; this.poseKey = ''; }
    return this;
  }

  // ── the columns on the chip ──
  /** what the programs are built for: the columns' types, and what colour and size come from (one value column, the
   *  one a value colour or size reads: pay only for what is set) */
  private variant(): SetsVariant {
    const c = this.props.color, z = sizeValue(this.props.size), gz = this.props.gauge || null, log = this.log;
    const names = [isValueColor(c) ? c.value : null, isValueSize(z) ? z.value : null, gz ? gz.value ?? (isValueColor(c) ? c.value : isValueSize(z) ? z.value : log.values[0]?.name ?? null) : null].filter((x): x is string => !!x);
    const name = names[0] ?? null;
    if (names.some((x) => x !== name)) throw new AslnutError('E-DATA-001', `entities '${this.id}': its colour, size and gauge read one value (here ${[...new Set(names)].map((x) => `'${x}'`).join(', ')})`, { where: this.id, fix: 'the same value for each, or a colour or size of each thing (a function)' });
    const vi = name === null ? -1 : log.values.findIndex((v) => v.name === name);
    if (name !== null && vi < 0 && !log.loading && log.values.length + log.size > 0) throw new AslnutError('E-DATA-001', `entities '${this.id}': the log has no value '${name}'`, { where: this.id, fix: `its values: ${log.values.map((v) => v.name).join(', ') || 'none'}` });
    this.valueCol = vi;
    // (the gauge's label: where a canvas draws its glyphs)
    const label = !!gz?.label && typeof OffscreenCanvas !== 'undefined';
    const js = this.setJoints(), fm = js.some((j) => j.formula) ? jointFormulas(js, `entities '${this.id}'`) : undefined;
    // (the log value its joints read: one, a 32-bit float)
    const jn = [...new Set(js.filter((j) => j.value !== undefined).map((j) => j.value!))];
    if (jn.length > 1) throw new AslnutError('E-DATA-001', `entities '${this.id}': its joints read one log value (here ${jn.map((x) => `'${x}'`).join(', ')})`, { where: this.id, fix: 'the same value for each, with its own `per`' });
    const jk = jn.length ? log.values.findIndex((x) => x.name === jn[0]) : -1;
    if (jn.length && !log.loading && log.values.length + log.size > 0 && (jk < 0 || log.values[jk]!.type !== 'f32')) throw new AslnutError('E-DATA-001', `entities '${this.id}': its joints read '${jn[0]}', ${jk < 0 ? 'a value its log has not' : 'a byte value (a joint reads a 32-bit one)'}`, { where: this.id, fix: jn[0] === 'travel' ? 'history.log({ travel: true }): the log keeps each sample\'s metres along its track' : `history.log({ values: { ${jn[0]}: 'f32' } })` });
    this.jointCol = jk;
    // (in the air: its altitude's column; its shapes' pose, from its path or the log's own columns: degrees)
    const ak = log.altK(); this.altCol = ak;
    const at = this.props.attitude, colOf = (name: string, what: string) => {
      const k = log.values.findIndex((x) => x.name === name);
      if (k < 0 && !log.loading && log.values.length + log.size > 0) throw new AslnutError('E-DATA-001', `entities '${this.id}': its ${what} reads '${name}', a value its log has not`, { where: this.id, fix: `its values: ${log.values.map((x) => x.name).join(', ') || 'none'} · history.log({ values: { ${name}: 'f32' } }) (degrees)` });
      return k;
    };
    const pk = typeof at?.pitch === 'string' ? colOf(at.pitch, 'pitch') : -1, bk = typeof at?.bank === 'string' ? colOf(at.bank, 'bank') : -1;
    this.pitchCol = pk; this.bankCol = bk;
    const pitch = pk >= 0 ? log.values[pk]!.type : at?.pitch === true && ak >= 0 ? 'climb' as const : 'none' as const, bank = bk >= 0 ? log.values[bk]!.type : at?.bank === true ? 'turn' as const : 'none' as const;
    const pose = this.props.shape && (pitch !== 'none' || bank !== 'none') ? { pose: { pitch, bank } } : {};
    return { ...(fm ? { formula: fm } : {}), ...(jk >= 0 ? { joint: 'f32' as const } : {}), time: log.timeType, place: log.placeType, ...(this.props.fold ? { fold: true } : {}), value: vi < 0 ? 'none' : log.values[vi]!.type, ...(vi >= 0 && log.values[vi]!.step ? { step: true } : {}), color: isValueColor(c) && vi >= 0 ? 'ramp' : typeof c === 'function' ? 'thing' : 'one', size: isValueSize(z) && vi >= 0 ? 'value' : typeof z === 'function' ? 'thing' : 'one', row: this.row, grid: GRID, ...(label ? { label } : {}), ...(ak >= 0 ? { alt: log.values[ak]!.type, over: log.altitude!.over } : {}), ...pose };
  }
  private programs(v: SetsVariant): void {
    const key = JSON.stringify(v) + (this.props.shape ? 'm' : '') + (this.props.gauge ? 'g' : '') + (this.props.shape && this.props.near?.shadow ? 's' : '') + (this.props.links ? 'l' : '');
    if (key === this.variantKey) return;
    this.variantKey = key;
    const g = this.g!; for (const p of Object.values(this.progs)) p?.destroy(); this.progs = {};
    const tex = (names: readonly string[]) => names.map((name) => ({ name, kind: '2d' as const, sample: 'unfilterable' as const })), textures = tex(SET_TEXTURES);
    // (each built in the background: once built, a frame is drawn, the found pass first)
    const built = () => { this.foundKey = ''; (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); };
    const make = (kind: 'found' | 'pose' | 'dots' | 'trails' | 'models' | 'gauge' | 'shadow' | 'links', extra: Partial<ProgramDesc>, vv: SetsVariant = v) => new Pair(g, { label: `set ${this.id} ${kind}`, wgsl: setsWGSL(kind, vv), glsl: setsGLSL(kind, vv), blocks: ['Frame', 'S'], textures, ...extra }, built);
    // the found pass reads the things and their times only (it draws into the found texture: never one it reads); in
    // the air, their altitudes too (binding 7: each thing's height now, under its samples' rows); a set that folds its
    // things into others, their windows too (after them: the slots between stand empty)
    this.progs.found = make('found', { textures: v.fold || v.alt ? [...textures, ...tex([...(v.alt ? ['acol'] : []), ...(v.fold ? ['fold'] : [])])] : tex(['things', 'tcol']), overlay: true, blend: 'none' });
    this.foundKey = ''; this.poseKey = '';
    // the pose pass (its shapes turned in the air): the set's textures, then its pose's own columns
    if (v.pose) this.progs.pose = make('pose', { textures: [...textures, ...tex([...(v.alt ? ['acol'] : []), ...(this.pitchCol >= 0 ? ['pitchCol'] : []), ...(this.bankCol >= 0 ? ['bankCol'] : [])])], overlay: true, blend: 'none' });
    this.progs.dots = make('dots', { blend: 'alpha', depth: { write: false, test: 'less' } });
    if (this.props.links) this.progs.links = make('links', { blend: 'alpha', depth: { write: false, test: 'less' }, textures: [...textures, { name: 'links', kind: '2d' as const, sample: 'unfilterable' as const }] });
    // (the trails read each sample's altitude: its column after the set's textures)
    this.progs.trails = make('trails', { blend: 'alpha', depth: { write: false, test: 'less' }, ...(v.alt ? { textures: [...textures, ...tex(['acol'])] } : {}) });
    if (this.props.gauge) {
      // (its label reads the glyphs too: filtered, the sampler after them; none where they could not be drawn)
      if (v.label) this.glyphs ??= glyphAtlas(g, `${this.id} glyphs`);
      this.labelled = !!(v.label && this.glyphs);
      this.progs.gauge = make('gauge', { blend: 'alpha', depth: { write: false, test: 'less' }, ...(this.labelled ? { textures: [...textures, { name: 'glyphs', kind: '2d' as const, sample: 'float' as const }] } : {}) }, { ...v, label: this.labelled });
    }
    // (the shapes' soft contact shadow: only when asked for)
    if (this.props.shape && this.props.near?.shadow) this.progs.shadow = make('shadow', { blend: 'alpha', depth: { write: false, test: 'less' }, cull: 'none', instance: { stride: 1, attributes: [{ name: 'ent', location: 0, size: 1, offset: 0 }] } });
    if (this.props.shape) this.progs.models = make('models', {
      depth: { write: true, test: 'less' }, cull: 'none', ...(v.joint === 'f32' || v.pose ? { textures: [...textures, ...tex([...(v.joint === 'f32' ? ['jcol'] : []), ...(v.pose ? ['pose'] : [])])] } : {}),
      instance: { stride: 1, attributes: [{ name: 'ent', location: 0, size: 1, offset: 0 }] },
      vertex: { stride: SHAPE_FLOATS, attributes: [{ name: 'v', location: 3, size: 4, offset: 0 }, { name: 'vc', location: 4, size: 1, offset: 4 }, { name: 'card', location: 5, size: 1, offset: 5 }] },
    });
  }
  /** the column textures made for the log's slots (again when they grow), their bytes written whole */
  private columns(): void {
    const g = this.g!, log = this.log, R = this.row, rows = Math.max(1, Math.ceil(log.slots / R));
    const key = [this.valueCol, this.jointCol, this.altCol, this.pitchCol, this.bankCol].join();
    if (this.cols && rows === this.colRows && this.colKey === key && !this.dirtyAll) return;
    // (made again when the log's slots outgrow them, or when a style, a joint, its altitude or its pose reads another
    // value column)
    const fresh = !this.cols || rows !== this.colRows || this.colKey !== key;
    if (fresh) {
      this.dropColumns();
      const u8 = (a: ArrayBufferView, per: number) => (s0: number, s1: number) => new Uint8Array(a.buffer, a.byteOffset + s0 * per, (s1 - s0) * per);
      const f32 = (a: Float32Array, per: number) => (s0: number, s1: number) => a.subarray(s0 * per, s1 * per);
      const tex = (label: string, spt: number, format: 'rgba8' | 'rgba32f' | 'r32f') => g.texture({ label: `${this.id} ${label}`, width: R / spt, height: rows, format, filter: 'nearest' });
      const t: Col = log.timeType === 'u16' ? { tex: tex('times', 2, 'rgba8'), spt: 2, view: (a, b) => u8(log.time, 2)(a, b) } : { tex: tex('times', 1, 'r32f'), spt: 1, view: (a, b) => f32(log.time as Float32Array, 1)(a, b) };
      const p: Col = log.placeType === 'u16' ? { tex: tex('places', 1, 'rgba8'), spt: 1, view: (a, b) => u8(log.place, 4)(a, b) } : { tex: tex('places', 2, 'rgba32f'), spt: 2, view: (a, b) => f32(log.place as Float32Array, 2)(a, b) };
      // a value column (a byte four a texel, or a 32-bit float): read through the log's arrays as they are now
      const valueCol = (k: number, label: string): Col | null => {
        const vt = k >= 0 ? log.values[k]!.type : null;
        return vt === 'u8' ? { tex: tex(label, 4, 'rgba8'), spt: 4, view: (a, b) => u8(log.cols[k]!, 1)(a, b) } : vt === 'f32' ? { tex: tex(label, 1, 'r32f'), spt: 1, view: (a, b) => f32(log.cols[k] as Float32Array, 1)(a, b) } : null;
      };
      const v = valueCol(this.valueCol, 'values');
      const jk = this.jointCol, j: Col | null = jk >= 0 ? { tex: tex('joint values', 1, 'r32f'), spt: 1, view: (a, b) => f32(log.cols[jk] as Float32Array, 1)(a, b) } : null;
      this.cols = { t, p, v, j, a: valueCol(this.altCol, 'altitudes'), xp: valueCol(this.pitchCol, 'pitches'), xb: valueCol(this.bankCol, 'banks') }; this.colRows = rows; this.colKey = key;
    }
    // the columns' views follow the log's arrays (they are replaced when the log grows): written whole again, a
    // slice a frame (~3 ms of writes: 30 MB is never one long frame); drawn once they are all there
    this.sweep = { next: 0, end: Math.min(log.slots, rows * R) };
    this.dirtyAll = false; this.ranges.length = 0;
  }
  private dropColumns(): void { const c = this.cols; if (!c) return; for (const x of [c.t, c.p, c.v, c.j, c.a, c.xp, c.xb]) x?.tex.destroy(); this.cols = null; }
  /** the columns being written whole (after a load or a growth): the next slot, the end */
  private sweep: { next: number; end: number } | null = null;
  /** a slice of the sweep: whole rows until ~3 ms have gone; true when it is done */
  private sweepStep(): boolean {
    const sw = this.sweep; if (!sw) return true;
    const R = this.row, t0 = performance.now();
    while (sw.next < sw.end) { const e = Math.min(sw.end, sw.next + 32 * R); this.upload(sw.next, e); sw.next = e; if (performance.now() - t0 > 3) break; }
    if (sw.next >= sw.end) { this.sweep = null; this.foundKey = ''; return true; }
    return false;
  }
  /** slots [a, b) of every column, whole texels, row by row (the new bytes only) */
  private upload(a: number, b: number): void {
    const c = this.cols!, R = this.row;
    for (const col of [c.t, c.p, c.v, c.j, c.a, c.xp, c.xb]) {
      if (!col) continue;
      const s0 = Math.floor(a / col.spt) * col.spt, s1 = Math.min(this.colRows * R, Math.ceil(b / col.spt) * col.spt);
      let s = s0;
      while (s < s1) {
        const row = Math.floor(s / R), x = s - row * R;
        // whole rows at once when it starts on one
        if (x === 0 && s1 - s >= R) { const n = Math.floor((s1 - s) / R); col.tex.write(col.view(s, s + n * R), { x: 0, y: row, width: R / col.spt, height: n }); s += n * R; continue; }
        const e = Math.min(s1, (row + 1) * R);
        col.tex.write(col.view(s, e), { x: x / col.spt, y: row, width: (e - s) / col.spt, height: 1 });
        s = e;
      }
    }
  }
  /** what was appended: the slot ranges, merged when close, written */
  private uploadRanges(): void {
    const r = this.ranges; if (!r.length || !this.cols) return;
    const pairs: [number, number][] = []; for (let i = 0; i < r.length; i += 2) pairs.push([r[i]!, r[i + 1]!]);
    pairs.sort((x, y) => x[0] - y[0]);
    let [a, b] = pairs[0]!;
    for (let i = 1; i < pairs.length; i++) { const [c, d] = pairs[i]!; if (c <= b + 16) b = Math.max(b, d); else { this.upload(a, b); a = c; b = d; } }
    this.upload(a, b);
    r.length = 0;
  }
  /** each thing's slots and look (2 texels: first slot, count, slots (a group's member: −(slots + 8192 × its
   *  stride)), head · colour, size) */
  private thingsUpload(): void {
    const g = this.g!, log = this.log, N = log.size, need = Math.max(1, Math.ceil((2 * N) / 4096));
    if (!this.things || need > this.thingsCap) {
      this.things?.destroy(); this.thingsCap = Math.max(need, this.thingsCap * 2 || 1);
      this.things = g.texture({ label: `${this.id} things`, width: 4096, height: this.thingsCap, format: 'rgba32f', filter: 'nearest' });
      this.thingsData = new Float32Array(this.thingsCap * 4096 * 4); this.allThings = true; this.nearDirty = true;
    }
    const d = this.thingsData, put = (i: number) => {
      // (a live group's member: its slots and the group's size in one number, negative: −(slots + 8192 × size))
      const o = i * 8, st = log.stride[i]!; d[o] = log.first[i]!; d[o + 1] = log.count[i]!; d[o + 2] = st > 1 ? -(log.cap[i]! + st * 8192) : log.cap[i]!; d[o + 3] = log.head[i]!;
      const th = this.thingOf(i), c = this.props.color, sz = sizeValue(this.props.size);
      d[o + 4] = typeof c === 'function' ? rgbOf(hexOf(c(th))) : 0; d[o + 5] = typeof sz === 'function' ? sz(th) : typeof sz === 'number' ? sz : 7;
    };
    // every thing (loaded, restyled), the span of those touched (a stream's tick: its things), or each one
    let lo = 0, hi = N;
    if (!this.allThings) { lo = Infinity; hi = -Infinity; for (const i of this.dirtyThings) if (i < N) { lo = Math.min(lo, i); hi = Math.max(hi, i + 1); } }
    if (hi > lo) {
      if (!this.allThings && this.dirtyThings.size <= 16) for (const i of this.dirtyThings) { if (i >= N) continue; put(i); const t = 2 * i; this.things!.write(d.subarray(i * 8, i * 8 + 8), { x: t % 4096, y: Math.floor(t / 4096), width: 2, height: 1 }); }
      else {
        for (let i = lo; i < hi; i++) put(i);
        // texels [2 lo, 2 hi) row by row
        let t = 2 * lo; const t1 = 2 * hi;
        while (t < t1) { const row = Math.floor(t / 4096), x = t - row * 4096, e = Math.min(t1, (row + 1) * 4096); if (x === 0 && t1 - t >= 4096) { const n = Math.floor((t1 - t) / 4096); this.things!.write(d.subarray(t * 4, (t + n * 4096) * 4), { x: 0, y: row, width: 4096, height: n }); t += n * 4096; continue; } this.things!.write(d.subarray(t * 4, e * 4), { x, y: row, width: e - t, height: 1 }); t = e; }
      }
    }
    this.allThings = false; this.dirtyThings.clear();
  }
  private thingOf(i: number): Thing { return { id: this.log.ids[i]!, props: this.log.props[i] ?? {}, index: i }; }
  /** the links' places (a texel a thing: the place as the log keeps places, its height m, 1 when it has one): every
   *  thing's, or those changed */
  private linkTex: GTexture | null = null; private linkData = new Float32Array(0); private linkCap = 0;
  private linksUpload(only: Set<number> | null): void {
    const g = this.g!, log = this.log, N = log.size, to = this.props.links!.to, rows = Math.max(1, Math.ceil(N / 4096));
    if (!this.linkTex || rows > this.linkCap) { this.linkTex?.destroy(); this.linkCap = Math.max(rows, this.linkCap * 2 || 1); this.linkTex = g.texture({ label: `${this.id} links`, width: 4096, height: this.linkCap, format: 'rgba32f', filter: 'nearest' }); this.linkData = new Float32Array(this.linkCap * 4096 * 4); only = null; }
    const d = this.linkData, put = (i: number) => { const t = to(this.thingOf(i)); if (!t) { d.fill(0, i * 4, i * 4 + 4); return; } const r = log.rel(t[0], t[1]); d[i * 4] = r[0]; d[i * 4 + 1] = r[1]; d[i * 4 + 2] = t[2] ?? 0; d[i * 4 + 3] = 1; };
    if (only && only.size <= 16) { for (const i of only) if (i < N) { put(i); this.linkTex.write(d.subarray(i * 4, i * 4 + 4), { x: i % 4096, y: Math.floor(i / 4096), width: 1, height: 1 }); } return; }
    for (let i = 0; i < N; i++) put(i);
    this.linkTex.write(d.subarray(0, rows * 4096 * 4), { x: 0, y: 0, width: 4096, height: rows });
  }
  /** each thing's windows held by another (its relations', seconds from the log's epoch, joined), and their texture:
   *  a texel a thing (its first window's texel, how many), then a texel a window (from, until); made again when the
   *  relations or the things change */
  private foldTex: GTexture | null = null; private foldSeen = ''; private foldWin: Float64Array[] = [];
  private foldUpload(): void {
    const r = this.props.fold, log = this.log; if (!r || !this.g) return;
    const key = `${r.version}|${log.size}|${log.epoch}`; if (key === this.foldSeen && this.foldTex) return;
    this.foldSeen = key;
    const N = log.size, wins = log.ids.map((id) => r.windowsOf(id).map(([a, b]) => [(a - log.epoch) / 1000, (b - log.epoch) / 1000] as const));
    this.foldWin = wins.map((ws) => Float64Array.from(ws.flat()));
    const total = N + wins.reduce((a, w) => a + w.length, 0), rows = Math.max(1, Math.ceil(total / 4096)), d = new Float32Array(rows * 4096 * 4);
    let k = N;
    wins.forEach((ws, i) => { d[i * 4] = k; d[i * 4 + 1] = ws.length; for (const [a, b] of ws) { d[k * 4] = a; d[k * 4 + 1] = b; k++; } });
    this.foldTex?.destroy();
    this.foldTex = this.g.texture({ label: `${this.id} fold`, width: 4096, height: rows, format: 'rgba32f', filter: 'nearest' });
    this.foldTex.write(d);
    this.foundKey = '';
  }
  /** a thing held by another at `sec` (s from the log's epoch): hidden on the chip then (the tools' check) */
  foldedNow(i: number, sec: number): boolean { const w = this.foldWin[i]; if (!w) return false; for (let k = 0; k < w.length; k += 2) if (sec >= w[k]! && sec < w[k + 1]!) return true; return false; }
  /** the things focused (hovered, selected): a flag in their look (w), written when it changes */
  private hoverIndex = -1; private focusKey = ''; private focused = new Set<number>();
  override hovered(ids: Set<string> | null): void { const id = ids && ids.size ? [...ids][0]! : null; this.hoverIndex = id === null ? -1 : this.log.ids.indexOf(id); (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); }
  private focusSync(ctx: FrameContext): void {
    const sel = ctx.s.user.selection, key = `${this.hoverIndex}|${sel.join('\u0001')}`;
    if (key === this.focusKey || !this.things) return;
    this.focusKey = key;
    const now = new Set<number>(); if (this.hoverIndex >= 0) now.add(this.hoverIndex);
    for (const id of sel) { const i = this.log.ids.indexOf(id); if (i >= 0) now.add(i); }
    const d = this.thingsData;
    for (const i of new Set([...this.focused, ...now])) { if (i * 8 + 8 > d.length) continue; d[i * 8 + 7] = now.has(i) ? 1 : 0; const t = 2 * i + 1; this.things.write(d.subarray(t * 4, t * 4 + 4), { x: t % 4096, y: Math.floor(t / 4096), width: 1, height: 1 }); }
    this.focused = now;
  }
  private rampKey = '';
  private rampUpload(): void {
    const c = this.props.color;
    if (!isValueColor(c)) return;
    const key = JSON.stringify([c.ramp ?? 'rdylgn', c.domain]);
    if (key === this.rampKey && this.rampTex) return;
    this.rampKey = key;
    const f = rampOf(c.ramp ?? 'rdylgn'), px = new Uint8Array(256 * 4);
    for (let i = 0; i < 256; i++) { const q = rgba(f(i / 255)); px.set([q[0] * 255, q[1] * 255, q[2] * 255, q[3] * 255].map(Math.round), i * 4); }
    this.rampTex ??= this.g!.texture({ label: `${this.id} ramp`, width: 256, height: 1, format: 'rgba8', filter: 'nearest' });
    this.rampTex.write(px);
  }

  // ── the ground under them: a grid over the whole set, a grid round the view (read a slice a frame) ──
  private gridData = new Float32Array(GRID * GRID * 2);
  private gridBox: ([number, number, number, number] | null)[] = [null, null];
  private gridJob: { level: 0 | 1; box: [number, number, number, number]; row: number; data: Float32Array; fn: (lon: number, lat: number) => number } | null = null;
  private gridSeen = [-1, -1]; private gridAt = [-1e9, -1e9]; private setBox: [number, number, number, number] | null = null;
  /** the heights a grid reads: the terrain; 'stand': the top of what is drawn (a road, a deck), only for a grid at
   *  most 1.5 km across (the street level builds what it stands on tile by tile as it is asked: a city's worth of
   *  questions would build a city's worth; farther than that a road's few centimetres over its ground are not seen) */
  private heightFn(ctx: FrameContext, side = Infinity): ((lon: number, lat: number) => number) | null {
    const on = this.props.on ?? 'stand', w = ctx.world as FrameContext['world'] & { standAt?: (lon: number, lat: number) => number };
    if (on === 'sea') return null;
    if (typeof on === 'function') return on;
    // (the sea's surface where the terrain is under it: what a thing over the sea flies over)
    if (on === 'surface') return (lon, lat) => { const h = w.heightAt(lon, lat); return Number.isNaN(h) ? h : Math.max(h, 0); };
    if (on === 'stand' && w.standAt && side <= 1500) return (lon, lat) => w.standAt!(lon, lat);
    return (lon, lat) => w.heightAt(lon, lat);
  }
  /** the grids wanted now; a slice of the one being read (within ~2 ms) */
  private groundStep(ctx: FrameContext): void {
    const log = this.log;
    if (!this.heightFn(ctx) || !this.ground) return;
    // (the whole set's grid reads the terrain: its version; the view's the stands too)
    const g0 = ctx.world.groundVersion, gv = g0 + ((ctx.world as { standVersion?: number }).standVersion ?? 0);
    // the whole set's box (kept by the log as samples come): read again only when its things leave the box (padded a
    // tenth: a live set does not read its ground again each tick)
    const b = log.bounds(), sb0 = this.setBox;
    if (b && (!sb0 || b[0] < sb0[0] || b[1] < sb0[1] || b[2] > sb0[2] || b[3] > sb0[3])) { const px = (b[2] - b[0]) * 0.1 + 2e-5, py = (b[3] - b[1]) * 0.1 + 2e-5; this.setBox = [b[0] - px, b[1] - py, b[2] + px, b[3] + py]; }
    if (!this.gridJob) {
      // the view's grid: a square round the centre, four times the camera's distance across (600 m … 40 km)
      const cam = ctx.camera, k = R * Math.cos(cam.lat * D), side = Math.max(600, Math.min(40000, cam.dist * 4)) / k;
      const c = log.rel(cam.lon, cam.lat), vb = this.gridBox[1];
      const moved = !vb || Math.abs(c[0] - (vb[0] + vb[2]) / 2) > (vb[2] - vb[0]) / 4 || Math.abs(c[1] - (vb[1] + vb[3]) / 2) > (vb[3] - vb[1]) / 4;
      const scaled = !vb || (vb[2] - vb[0]) / side > 1.6 || side / (vb[2] - vb[0]) > 1.6;
      const sb = this.setBox;
      if (sb && (!this.gridBox[0] || this.gridBox[0].some((x, i) => x !== sb[i]) || (g0 !== this.gridSeen[0] && ctx.now - this.gridAt[0]! > 1000))) this.gridJob = { level: 0, box: sb, row: 0, data: new Float32Array(GRID * GRID), fn: this.heightFn(ctx)! };
      else if (moved || scaled || (gv !== this.gridSeen[1] && ctx.now - this.gridAt[1]! > 300)) this.gridJob = { level: 1, box: [c[0] - side / 2, c[1] - side / 2, c[0] + side / 2, c[1] + side / 2], row: 0, data: new Float32Array(GRID * GRID), fn: this.heightFn(ctx, side * k)! };
      if (this.gridJob) this.gridSeen[this.gridJob.level] = this.gridJob.level ? gv : g0;
    }
    const j = this.gridJob; if (!j) return;
    const t0 = performance.now(), old = this.gridData.subarray(j.level * GRID * GRID, (j.level + 1) * GRID * GRID);
    while (j.row < GRID) {
      const y = j.box[1] + ((j.box[3] - j.box[1]) * j.row) / (GRID - 1);
      for (let i = 0; i < GRID; i++) {
        const x = j.box[0] + ((j.box[2] - j.box[0]) * i) / (GRID - 1), ll = log.lonLat(x, y), h = j.fn(ll[0], ll[1]);
        j.data[j.row * GRID + i] = Number.isFinite(h) ? h : old[j.row * GRID + i] ?? 0;
      }
      j.row++;
      if (performance.now() - t0 > 2) break;
    }
    if (j.row >= GRID) {
      this.gridData.set(j.data, j.level * GRID * GRID);
      this.ground.write(j.data, { x: 0, y: j.level * GRID, width: GRID, height: GRID });
      this.gridBox[j.level] = j.box; this.gridAt[j.level] = ctx.now; this.gridJob = null;
    }
  }

  // ── the trail's pieces a thing: the most samples any thing has within the window, and one more ──
  private K = 1; private kDirty = true; private kAt = -1e9; private kSeconds = -1;
  private pieces(now: number): number {
    const tr = this.props.trail; if (tr === false) return 0;
    const sec = tr?.seconds ?? 60;
    // (a saved log's table: at once; a live log counted once, then kept up per sample as they come)
    if (this.kDirty || sec !== this.kSeconds) { this.K = Math.min(MAX_K, this.log.densest(sec) + 1); this.kSeconds = sec; this.kAt = now; this.kDirty = false; }
    return this.K;
  }

  // ── the shapes near the camera: chosen once per view change (and as time moves them), checked on the chip ──
  private shapeOf: Made | null = null; private nearDirty = true; private nearLog = false; private nearAt = -1e9; private nearKey = ''; private nearD = 0; private nearSec = NaN; private nearEye: [number, number, number] = [0, 0, 0];
  private made(): Made | null {
    const s = this.props.shape; if (!s) return null;
    // (a shape to make: anything with make(), a Shape or a preset of one; a Shape keeps a field named levels of its own,
    // so it is told by its make, never by its levels)
    if (!this.shapeOf) this.shapeOf = typeof (s as { make?: unknown }).make === 'function' ? (s as { make(): Made }).make() : s as Made;
    return this.shapeOf;
  }
  /** its shape's joints with their drivers (made once a shape; a change of driver: joint()) */
  private jointsMade: Made | null = null; private jointsNow: SetJoint[] = []; private jointClock = 0; private jointOffsets: number[] = [];
  private setJoints(): SetJoint[] {
    const m = this.made(); if (!m) return [];
    if (m === this.jointsMade) return this.jointsNow;
    this.jointsMade = m; this.jointClock = this.clockS; this.jointOffsets = [];
    const out: SetJoint[] = [], drivers = this.props.joints ?? {};
    (m.pieces?.parts ?? []).forEach((pt, i) => {
      // (by its part's name, else by its joint's kind: `wheel` drives every wheel)
      const d = pt.joint ? drivers[pt.name] ?? drivers[pt.joint.kind] : undefined; if (!pt.joint || !d || out.length >= 8) return;
      const sl = pt.joint.kind === 'slider', lim = pt.joint.limits ? (sl ? pt.joint.limits : [pt.joint.limits[0] * Math.PI / 180, pt.joint.limits[1] * Math.PI / 180]) as [number, number] : undefined;
      out.push({ name: pt.name, part: i + 1, kind: pt.joint.kind, pivot: pt.pivot, axis: pt.joint.axis, radius: pt.joint.radius, limits: lim, ...('formula' in d ? { formula: d.formula } : 'value' in d ? { value: d.value, per: d.per ?? 1 } : { rate: rateOf(d, sl) }) });
    });
    this.jointsNow = out;
    return out;
  }
  /** the clock its joints count from (s: the frame block's) */
  private clockS = 0;
  /** a joint driven anew for every thing, by its part's name or its kind (a rate: its value kept where it is now; a
   *  formula or a log value: its programs made again) */
  joint(name: string, d: JointDriver): this {
    const js = this.setJoints(), ks = js.flatMap((j, k) => (j.name === name || j.kind === name ? [k] : [])); if (!ks.length || !d) return this;
    const inv = () => (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.();
    // (the same log value, another factor: its block only)
    if ('value' in d && ks.every((k) => js[k]!.value === d.value)) { for (const k of ks) js[k]!.per = d.per ?? 1; this.props = { ...this.props, joints: { ...this.props.joints, ...Object.fromEntries(ks.map((k) => [js[k]!.name!, d])) } }; inv(); return this; }
    if ('formula' in d || 'value' in d || ks.some((k) => js[k]!.formula || js[k]!.value !== undefined)) { this.props = { ...this.props, joints: { ...this.props.joints, ...Object.fromEntries(ks.map((k) => [js[k]!.name!, d])) } }; this.jointsMade = null; this.variantKey = ''; inv(); return this; }
    const now = this.clockS;
    for (const k of ks) { const j = js[k]!, rate = rateOf(d, j.kind === 'slider'); this.jointOffsets[k] = (this.jointOffsets[k] ?? 0) + (j.rate ?? 0) * (now - this.jointClock) - rate * (now - this.jointClock); j.rate = rate; }
    inv();
    return this;
  }
  /** the shapes' levels: each level's vertices (the shape's whole, simple and far forms; one pinned by `near.level`) */
  private lv: ({ buf: GBuffer; n: number; arr: Float32Array } | null)[] = [null, null, null];
  /** each level's things (their indices, a buffer each) and how many */
  private nearBufs: { buf: GBuffer | null; cap: number }[] = [{ buf: null, cap: 0 }, { buf: null, cap: 0 }, { buf: null, cap: 0 }];
  private nearNs = [0, 0, 0];
  /** each thing's level as last chosen (0 whole, 1 simple, 2 far, 3 a dot): the margin keeps it */
  private lvOf = new Uint8Array(0);
  private detailSeen = 1;
  /** things that changed level (or to and from a dot) since the start: the measures read it */
  levelChanges = 0;
  private nearSet(ctx: FrameContext): void {
    const m = this.made(); if (!m || !this.g) { this.nearNs.fill(0); this.nearN = 0; return; }
    const o = this.props.near ?? {}, pinned = o.level !== undefined;
    // each level's vertices: the shape's own (an impostor or a missing far form: the level before stands in)
    for (let L = 0; L < 3; L++) {
      let a: unknown = pinned ? m.levels[o.level!] ?? m.levels[0] : m.levels[L];
      for (let k = L; !(a instanceof Float32Array) && k > 0; k--) a = m.levels[k - 1];
      const arr = a instanceof Float32Array ? a : null, cur = this.lv[L];
      if (cur && cur.arr === arr) continue;
      if (cur && !this.lv.some((x, j) => j !== L && x?.buf === cur.buf)) cur.buf.destroy();
      const same = arr ? this.lv.find((x) => x?.arr === arr) : null;
      this.lv[L] = arr ? same ?? { buf: this.g.buffer('vertex', arr, `${this.id} shape ${L}`), n: arr.length / SHAPE_FLOATS, arr } : null;
    }
    const cam = ctx.camera, log = this.log, scale = o.scale ?? 1, b = m.bounds;
    const len = Math.max(b[1][0] - b[0][0], b[1][2] - b[0][2]) * scale, k = cam.height / (2 * Math.tan(cam.fov / 2));
    // its range on screen (a symbol kept readable far away), the dot's edge (none by default when it has a range), the
    // levels' edges with the governor's detail, the margin (core › runtime › detail)
    const sr = o.size ?? m.size, ru = sr ? rangeUnits(sr) : null, dotPx = o.pixels ?? (ru ? 0 : 12);
    const dl = Math.max(0.25, Math.min(1, this.detailOf(ctx.s))), lv = o.levels ?? {}, full = (lv.full ?? 120) / dl, simple = (lv.simple ?? 25) / dl, mg = 1 + (lv.margin ?? LEVEL_MARGIN);
    const eye = cam.eye, above = eye[1]! - cam.groundY, pxAt = (d: number) => { const px = (len * k) / Math.max(d, 0.01); return ru ? Math.min(ru[2], Math.max(ru[1], px)) : px; };
    // (in the air: as near the eye as its highest thing flies; each thing's height read with its place)
    const ak = log.altK(), sea = log.altitude?.over === 'sea', top = ak < 0 || !Number.isFinite(log.altMax) ? 0 : Math.max(0, sea ? log.altMax - cam.groundY : log.altMax);
    // nothing can be seen as more than a dot from up here (on the globe: none): none, and nothing asked of the things
    if ((pxAt(above - top) < dotPx / mg) || cam.morph < 0.98) { if (this.nearN) this.flagShaped(null); this.nearNs.fill(0); this.nearN = 0; this.nearD = 0; this.nearKey = ''; return; }
    // chosen again when the eye has moved a few metres (5 % of its height: the dwell), the things by as much, the
    // governor's detail changed, or the log changed (at most 4 times a second)
    const gate = Math.max(3, above * 0.05), speed = Math.max(1, log.maxSpeed);
    const moved = Math.hypot(eye[0]! - this.nearEye[0], eye[1]! - this.nearEye[1], eye[2]! - this.nearEye[2]);
    if (this.nearLog && performance.now() - this.nearAt > 250) { this.nearLog = false; this.nearDirty = true; }
    if (dl !== this.detailSeen) { this.detailSeen = dl; this.nearDirty = true; }
    if (!this.nearDirty && moved < gate && Math.abs(this.sec - this.nearSec) * speed < gate) return;
    this.nearDirty = false; this.nearAt = performance.now(); this.nearSec = this.sec; this.nearEye = [eye[0] ?? 0, eye[1] ?? 0, eye[2] ?? 0];
    const kx = R * Math.cos(cam.lat * D), c = log.rel(cam.lon, cam.lat), p: [number, number, number] = [0, 0, 0], hold = this.props.before === 'hold', N = log.size;
    if (this.lvOf.length < N) { const a = new Uint8Array(Math.max(64, N * 2)).fill(255); a.set(this.lvOf); this.lvOf = a; }
    const lvs = this.lvOf, near: number[] = [], dist = new Float32Array(N), ids: number[][] = [[], [], []];
    for (let i = 0; i < N; i++) {
      // (a thing folded into another now stays in it: the chip hides it while it is held, and it stands up drawn the
      // moment its window ends, never waiting for the next choice)
      if (!log.relOf(i, this.sec, p, hold, ak)) { lvs[i] = 255; continue; }
      const y = ak < 0 ? cam.groundY : sea ? Math.max(cam.groundY, p[2]) : cam.groundY + Math.max(0, p[2]);
      const x = (p[0] - c[0]) * kx, z = -(p[1] - c[1]) * kx, d = Math.hypot(x - eye[0]!, y - eye[1]!, z - eye[2]!), px = pxAt(d), prev = lvs[i]!;
      dist[i] = d;
      // a dot below its edge (kept past it by the margin); else the shape's level by the pixels it covers
      const wasDot = prev === 3, dot = wasDot ? px < dotPx * mg : px < dotPx / mg;
      if (dot) { if (prev !== 255 && prev !== 3) this.levelChanges++; lvs[i] = 3; continue; }
      const L = pinned ? 0 : keptLevel(px, prev > 2 ? -1 : prev, full, simple, mg, false);
      if (prev !== 255 && prev !== L) this.levelChanges++;
      lvs[i] = L; if (L < 2 || pinned) near.push(i); else ids[2]!.push(i);
    }
    // at most `max` shapes in their whole or simple form (the nearest; pinned: at most `max` shapes): the rest far, or dots
    const max = o.max ?? 200, farMax = o.farMax ?? 4000;
    if (near.length > max) { near.sort((a, b2) => dist[a]! - dist[b2]!); for (const i of near.splice(max)) { if (pinned || !this.lv[2]) lvs[i] = 3; else { lvs[i] = 2; ids[2]!.push(i); } } }
    for (const i of near) ids[pinned ? 0 : lvs[i]!]!.push(i);
    if (ids[2]!.length > farMax) { ids[2]!.sort((a, b2) => dist[a]! - dist[b2]!); for (const i of ids[2]!.splice(farMax)) lvs[i] = 3; }
    let far = 0;
    for (let L = 0; L < 3; L++) {
      const list = ids[L]!, nb = this.nearBufs[L]!, a = Float32Array.from(list);
      for (const i of list) if (dist[i]! > far) far = dist[i]!;
      if (!nb.buf || nb.cap < list.length) { nb.buf?.destroy(); nb.cap = Math.max(64, list.length * 2); nb.buf = this.g.buffer('instance', nb.cap * 4, `${this.id} level ${L}`); }
      if (list.length) nb.buf.write(a);
      this.nearNs[L] = list.length;
    }
    this.nearD = far; this.nearN = this.nearNs[0]! + this.nearNs[1]! + this.nearNs[2]!;
    this.flagShaped(lvs);
  }
  /** each thing drawn as a shape is flagged in its look (its dot gives way to it on the chip): the things that changed */
  private flagShaped(lvs: Uint8Array | null): void {
    const d = this.thingsData, N = Math.min(this.log.size, d.length / 8), changed: number[] = [];
    for (let i = 0; i < N; i++) { const on = lvs && lvs[i]! < 3 ? 1 : 0; if (d[i * 8 + 6] !== on) { d[i * 8 + 6] = on; changed.push(i); } }
    if (!changed.length || !this.things) return;
    this.shapedVersion++;
    // the changed things' runs (close ones joined, the gap allowed growing until there are at most 16 writes): a seek
    // writes the few that changed, never the whole texture
    let runs: [number, number][] = [];
    for (let gap = 16; ; gap *= 4) {
      runs = []; for (const i of changed) { const r = runs[runs.length - 1]; if (r && i - r[1] <= gap) r[1] = i; else runs.push([i, i]); }
      if (runs.length <= 16) break;
    }
    // each run's texels [2 lo, 2 hi + 2), row by row
    for (const [lo, hi] of runs) {
      let t = 2 * lo; const t1 = 2 * hi + 2;
      while (t < t1) { const row = Math.floor(t / 4096), x = t - row * 4096, e = Math.min(t1, (row + 1) * 4096); this.things.write(d.subarray(t * 4, e * 4), { x, y: row, width: e - t, height: 1 }); t = e; }
    }
  }

  // ── each frame ──
  frame(ctx: FrameContext): DrawCall[] {
    const log = this.log, p = this.props; this.clockS = ctx.now / 1000;
    if (!this.ubuf || log.loading || this.log.failure || !log.size) return [];
    const variant = this.variant();
    this.programs(variant);
    this.rampUpload(); this.foldUpload();
    this.columns(); this.uploadRanges();
    if (!this.sweepStep()) return [];
    if (this.allThings || this.dirtyThings.size) { if (p.links) this.linksUpload(this.allThings ? null : this.dirtyThings); this.thingsUpload(); }
    if (p.links) this.focusSync(ctx);
    this.groundStep(ctx);
    this.nowMs = ctx.s.time.now.getTime();
    this.sec = (this.nowMs - log.epoch) / 1000 - this.drive.smooth / 1000;
    const K = this.pieces(ctx.now);
    if (p.shape) this.nearSet(ctx); else this.nearN = 0;
    // the uniforms
    const u = this.u, cam = ctx.camera, tr = p.trail === false ? null : p.trail ?? {};
    const vc = isValueColor(p.color) ? p.color : null, col = rgba(vc || typeof p.color === 'function' ? '#ffffff' : (p.color as Color | undefined) ?? '#38bdf8');
    const ol = p.outline === false ? null : p.outline ?? {}, oc = rgba(ol?.color ?? '#0b1220cc');
    const vk = this.valueCol, vdom: [number, number] = vk >= 0 ? log.values[vk]!.domain : [0, 1], rdom: [number, number] = vc?.domain ?? vdom;
    const gA = this.gridBox[0], gB = this.gridBox[1];
    u.set([this.sec, tr ? tr.seconds ?? 60 : 0, K, tr ? tr.head ?? 0.5 : 0], 0);
    u.set([wrap(log.lon0 - cam.lon) * D, log.m0 - mercY(Math.max(-85.0511, Math.min(85.0511, cam.lat))), ctx.world.exaggeration, p.lift ?? 0.3], 4);
    u.set([log.box[0], log.box[1], log.box[2] - log.box[0], log.box[3] - log.box[1]], 8);
    u.set(gA ? [gA[0], gA[1], 1 / (gA[2] - gA[0]), 1 / (gA[3] - gA[1])] : [0, 0, 0, 0], 12);
    u.set(gB ? [gB[0], gB[1], 1 / (gB[2] - gB[0]), 1 / (gB[3] - gB[1])] : [0, 0, 0, 0], 16);
    const zv = sizeValue(p.size);
    u.set([typeof zv === 'number' ? zv : isValueSize(zv) ? Math.max(...zv.range) : 7, ol ? ol.width ?? 1.5 : 0, (p.opacity ?? 1) * this.shown, (p.depthBias ?? 2) * 1e-5], 20);
    u.set(col, 24); u.set(oc, 28);
    u.set([tr?.width ?? 2.5, (tr?.opacity ?? 0.9) * this.shown, 2, tr?.color ? 1 : 0], 32);
    u.set(rgba(tr?.color ?? '#ffffff'), 36);
    u.set([vdom[0], vdom[1], rdom[0], rdom[1]], 40);
    u.set([this.nearD, p.near?.scale ?? 1, this.nearN > 0 ? 1 : 0, p.near?.turn ?? 1.2], 44);
    u.set([log.timeStep, this.pickNo, log.size, p.before === 'hold' ? 1 : 0], 48);
    u.set([gA ? 1 : 0, gB ? 1 : 0, 0, 0], 52);
    const vz = isValueSize(p.size) ? p.size : null, zdom = vz?.domain ?? vdom;
    u.set(vz ? [zdom[0], zdom[1], vz.range[0], vz.range[1]] : [0, 1, 7, 7], 56);
    // the trail's fade; the gauge: its domain, size, height, reach, colours
    const fade = tr ? (typeof tr.fade === 'number' ? tr.fade : FADE[tr.fade ?? 'ease']) : 2, gz = p.gauge || null, gdom = gz?.domain ?? vdom;
    const m = this.made(), tall = m ? m.bounds[1][1] * (p.near?.scale ?? 1) : 0;
    u.set([Math.max(0.05, fade), gz?.over ?? 0, gdom[0], gdom[1]], 60);
    u.set(gz ? [gz.size?.[0] ?? 28, gz.size?.[1] ?? 6, gz.lift ?? (m ? tall + 0.9 : 3), gz.within ?? (m ? this.nearD : 1e9)] : [0, 0, 0, 0], 64);
    const gc = gz?.colors ?? ['#d73027', '#f6b93b', '#1a9850'];
    u.set(rgba(gc[0]), 68); u.set(rgba(gc[1]), 72); u.set(rgba(gc[2]), 76); u.set(rgba(gz?.outline ?? '#0b1220e6'), 80);
    // its label: the glyphs' measures, its colour and height, its halo
    const lb = gz?.label ? (gz.label === true ? {} : gz.label) : null, lc = rgba(lb?.color ?? '#ffffff');
    u.set(this.glyphs?.m ?? [0.5, 0.8, 0.1, 1], 84); u.set([lc[0], lc[1], lc[2], lb ? lb.size ?? gz?.size?.[1] ?? 6 : 0], 88); u.set(rgba(lb?.halo ?? '#05070cd9'), 92);
    // the contact shadow: the shape's footprint spread past its sides, its middle; its opacity and its fully dark core
    const sh = p.near?.shadow, so = sh ? (sh === true ? {} : sh) : null, sp = Math.max(1, so?.spread ?? 1.3);
    // (in the air: on the ground under it, shrunk and faded away by `fade` m up: default six times its size across; none
    // past `off` m)
    if (m && so) { const b = m.bounds, across = Math.max(b[1][0] - b[0][0], b[1][2] - b[0][2]) * (p.near?.scale ?? 1); u.set([((b[1][0] - b[0][0]) / 2) * sp, ((b[1][2] - b[0][2]) / 2) * sp, (b[0][0] + b[1][0]) / 2, (b[0][2] + b[1][2]) / 2], 96); u.set([so.opacity ?? 0.5, 0.75 / sp, so.fade === false ? 0 : Math.max(0.01, so.fade ?? 6 * across), Math.max(0, so.off ?? 0)], 100); }
    // its links: width, rise, the faint and the focused opacity, colour, pieces and the width's units
    const lk = p.links;
    if (lk) { const wv = sizeValue(lk.width) ?? 1.5, wu = sizeUnits(lk.width, `entities '${this.id}' links.width`); u.set([typeof wv === 'number' ? wv : 1.5, lk.height ?? 0, lk.opacity ?? 0.15, lk.focus ?? 1], 244); u.set(rgba(lk.color ?? '#9ad1ff'), 248); u.set([Math.max(1, Math.round(lk.pieces ?? 24)), wu[0], wu[1], wu[2]], 252); }
    // how its dots' size is drawn, and its shapes' range on screen (core › render › drawing › size): the near prop's,
    // else the shape's own
    u.set(sizeUnits(p.size, `entities '${this.id}' size`), 104);
    const sr = p.near?.size ?? m?.size, ru = rangeUnits(sr, `entities '${this.id}' near.size`);
    u.set([m ? Math.max(m.bounds[1][0] - m.bounds[0][0], m.bounds[1][2] - m.bounds[0][2]) : 0, ru[1], ru[2], sr ? 1 : 0], 108);
    // its shape's joints and their drivers (core › entities › kinematics: as an instance set's)
    const js = this.setJoints(), KIND = { hinge: 1, wheel: 2, slider: 3 } as const;
    u.set([js.length, this.jointClock, 0, 0], 112);
    js.forEach((j, k) => { const o = 116 + k * 16, lim = j.limits; u.set([j.pivot[0], j.pivot[1], j.pivot[2], KIND[j.kind], j.axis[0], j.axis[1], j.axis[2], j.radius ?? 0, j.formula ? 2 : j.value !== undefined ? 3 : j.rate !== undefined ? 1 : 0, j.value !== undefined ? j.per ?? 1 : j.rate ?? 0, lim ? lim[0] : 0, lim ? lim[1] : 0, j.part, -1, this.jointOffsets[k] ?? 0, 0], o); });
    // in the air: its altitude's domain (a byte's); its pose: the seconds it eases over, its most pitch and bank, what
    // it turns about, its own columns' domains
    const domainOf = (k: number): [number, number] => (k >= 0 ? log.values[k]!.domain : [0, 1]), at = p.attitude, mx = at?.max ?? [30, 45], pv = at?.pivot ?? [0, 0, 0];
    u.set([...domainOf(this.altCol), 0, 0], 256);
    u.set([Math.max(0.05, at?.damp ?? 2), mx[0] * D, mx[1] * D, this.offGround()], 260);
    u.set([pv[0], pv[1], pv[2], 0], 264);
    u.set([...domainOf(this.pitchCol), ...domainOf(this.bankCol)], 268);
    this.ubuf.write(u);
    // each thing's sample at the time: found once a change of the time (or of the log), not once a vertex
    const N = log.size, rows = Math.max(1, Math.ceil(N / 4096));
    const fh = rows * (variant.alt ? 2 : 1);
    if (!this.found || fh !== this.foundRows) { this.foundTarget?.destroy(); this.found?.destroy(); this.found = ctx.graphics.texture({ label: `${this.id} found`, width: 4096, height: fh, format: 'rgba8', filter: 'nearest' }); this.foundTarget = ctx.graphics.layerTarget(this.found, 0); this.foundRows = fh; this.foundKey = ''; }
    const fk = `${this.sec}|${log.version}|${N}|${this.variantKey}|${this.foldSeen}`, dm = this.dummy!;
    if (fk !== this.foundKey && this.progs.found!.ok) { ctx.graphics.frame([{ program: this.progs.found!.main, blocks: [ctx.frame, this.ubuf], textures: (variant.fold && this.foldTex) || variant.alt ? [this.things!, this.cols!.t.tex, dm, dm, dm, dm, dm, ...(variant.alt ? [this.cols!.a?.tex ?? dm] : []), ...(variant.fold && this.foldTex ? [this.foldTex] : [])] : [this.things!, this.cols!.t.tex], count: 3 }], { target: this.foundTarget!, clear: [0, 0, 0, 0] }); this.foundKey = fk; }
    const tex = [this.things!, this.cols!.t.tex, this.cols!.p.tex, this.cols!.v?.tex ?? this.dummy!, this.ground!, this.rampTex ?? this.dummy!, this.found!], byAlt = variant.alt ? [this.cols!.a?.tex ?? this.dummy!] : [];
    // each shaped thing's pose (in the air): found once a change of the time, of the log or of the things shaped
    if (variant.pose) {
      if (!this.poseTex || rows !== this.poseRows) {
        this.poseTarget?.destroy(); this.poseTex?.destroy();
        // (renderable: drawn into, and read back: a check holds the chip's pose against the set's own)
        this.poseTex = ctx.graphics.texture({ label: `${this.id} pose`, width: 4096, height: rows, format: 'rgba8', filter: 'nearest', renderable: true });
        // (level until it is found: each angle's middle, 32768)
        const lv = new Uint8Array(4096 * rows * 4); for (let i = 1; i < lv.length; i += 2) lv[i] = 128; this.poseTex.write(lv);
        this.poseTarget = ctx.graphics.layerTarget(this.poseTex, 0); this.poseRows = rows; this.poseKey = '';
      }
      const pk = `${fk}|${this.shapedVersion}|${JSON.stringify(p.attitude)}|${p.near?.turn ?? 1.2}`, pp = this.progs.pose;
      if (pp?.ok && this.nearN > 0 && pk !== this.poseKey && this.foundKey === fk) {
        const own = [...(this.cols!.xp ? [this.cols!.xp.tex] : []), ...(this.cols!.xb ? [this.cols!.xb.tex] : [])];
        ctx.graphics.frame([{ program: pp.main, blocks: [ctx.frame, this.ubuf], textures: [...tex, ...byAlt, ...own], count: 3 }], { target: this.poseTarget!, clear: [0, 128 / 255, 0, 128 / 255] });
        this.poseKey = pk;
      }
    }
    // what a thing placed on these reads on the chip (core › entities › placement: an icon, a card), this frame
    this.trackNow = { block: this.ubuf, textures: tex, variant, at: ctx.now, things: N };
    const out: DrawCall[] = [], pick = p.pickable !== false;
    // the shapes by level (each its things' indices), their contact shadows under the whole and simple ones
    for (let L = 0; L < 3; L++) {
      const n = this.nearNs[L]!, nb = this.nearBufs[L]!.buf, lv = this.lv[L]; if (!n || !nb || !lv) continue;
      if (this.progs.shadow?.ok && L < 2) out.push({ program: this.progs.shadow.main, blocks: [ctx.frame, this.ubuf], textures: tex, instances: nb, index: this.quad!, count: 6, instanceCount: n });
      if (this.progs.models) { const pm = this.progs.models, mt = this.cols!.j || variant.pose ? [...tex, ...(this.cols!.j ? [this.cols!.j.tex] : []), ...(variant.pose ? [this.poseTex!] : [])] : tex; out.push({ program: pm.main, blocks: [ctx.frame, this.ubuf], textures: mt, instances: nb, vertices: lv.buf, count: lv.n, instanceCount: n, pickProgram: pick ? () => pm.pick() : undefined }); }
    }
    if (tr && K > 0) out.push({ program: this.progs.trails!.main, blocks: [ctx.frame, this.ubuf], textures: byAlt.length ? [...tex, ...byAlt] : tex, index: this.quad!, count: 6, instanceCount: N * K });
    // each thing's link to its own place (core › entities › placement), its pieces drawn as the trails are
    const pl = this.progs.links, lseg = Math.max(1, Math.round(p.links?.pieces ?? 24));
    if (pl?.ok && this.linkTex) out.push({ program: pl.main, blocks: [ctx.frame, this.ubuf], textures: [...tex, this.linkTex], index: this.quad!, count: 6, instanceCount: N * lseg });
    const pd = this.progs.dots!;
    if (p.dots !== false) out.push({ program: pd.main, blocks: [ctx.frame, this.ubuf], textures: tex, index: this.quad!, count: 6, instanceCount: N, pickProgram: pick ? () => pd.pick() : undefined });
    const pg = this.progs.gauge;
    if (pg) out.push({ program: pg.main, blocks: [ctx.frame, this.ubuf], textures: this.labelled && this.glyphs ? [...tex, this.glyphs.tex] : tex, index: this.quad!, count: 6, instanceCount: N, pickProgram: pick ? () => pg.pick() : undefined });
    return out;
  }
  /** the pose a thing's shape is drawn with at a time (ms, a Date; default the time last drawn): its pitch (nose up)
   *  and its bank (its right side down), degrees: the chip's pose pass, worked out here the same way; null: no such
   *  thing or no samples (level: no attitude asked for) */
  attitude(id: string | number, t?: number | Date): { pitch: number; bank: number } | null {
    const log = this.log, i = log.indexOf(id); if (i < 0 || !log.count[i]) return null;
    if (!this.props.attitude) return { pitch: 0, bank: 0 };
    if (!this.attached || this.variantKey === '') this.variant();
    const ms = t === undefined ? this.nowMs - this.drive.smooth : typeof t === 'number' ? t : t.getTime();
    const [a, b] = this.poseAt(i, (ms - log.epoch) / 1000);
    return { pitch: a / D, bank: b / D };
  }
  /** the height over the ground a thing with an altitude banks fully from (m): as high as its shape is tall (0.5 m at
   *  the least); on the ground, none (a plane taxiing does not bank) */
  private offGround(): number { const m = this.made(); return Math.max(0.5, m ? m.bounds[1][1] * (this.props.near?.scale ?? 1) : 0.5); }
  /** the ground under a place as the chip reads it (its grids: the view's, else the whole set's; m, true) */
  private groundRel(x: number, y: number): number {
    const lv = (b: [number, number, number, number], base: number) => {
      const u = Math.max(0, Math.min(1, (x - b[0]) / (b[2] - b[0]))) * (GRID - 1), v = Math.max(0, Math.min(1, (y - b[1]) / (b[3] - b[1]))) * (GRID - 1);
      const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, i1 = Math.min(i + 1, GRID - 1), j1 = Math.min(j + 1, GRID - 1), g = (a: number, c: number) => this.gridData[(base + c) * GRID + a]!;
      return (g(i, j) * (1 - fu) + g(i1, j) * fu) * (1 - fv) + (g(i, j1) * (1 - fu) + g(i1, j1) * fu) * fv;
    };
    const A = this.gridBox[0], B = this.gridBox[1];
    if (B && x >= B[0] && y >= B[1] && x <= B[2] && y <= B[3]) return lv(B, GRID);
    return A ? lv(A, 0) : 0;
  }
  /** thing i's pose at `sec` (s from the log's epoch; radians): as the pose pass finds it (sets.wgsl.ts' poseAt) */
  private poseAt(i: number, t: number): [number, number] {
    const log = this.log, at = this.props.attitude ?? {}, n = log.count[i]!, ak = log.altK();
    const sl = (k: number) => log.slot(i, k), tA = (k: number) => log.secAt(sl(k)), aA = (k: number) => (ak >= 0 ? log.valueAt(ak, sl(k)) : 0);
    const P = [0, 0] as [number, number], Q = [0, 0] as [number, number], rel = (k: number, o: [number, number]) => log.relAt(sl(k), o);
    // (its piece's heading: the piece before where it stands, 6 back: as pieceHeading)
    const pieceHeading = (k: number) => { for (let back = 0; back < 6; back++) { const x = k - back; if (x >= 0 && x + 1 < n) { rel(x, P); rel(x + 1, Q); const dx = Q[0] - P[0], dy = Q[1] - P[1]; if (dx * dx + dy * dy > 1e-20) return Math.atan2(dx, dy); } } return 0; };
    const angleDiff = (a: number, b: number) => { const d = b - a; return d - 2 * Math.PI * Math.floor((d + Math.PI) / (2 * Math.PI)); };
    const clamp = (x: number, a: number, b: number) => Math.max(a, Math.min(b, x));
    const turnShare = (x: number, tk: number, tl: number, tr: number) => (x < tk ? 0.5 * clamp(1 - (tk - x) / Math.max(tl, 0.001), 0, 1) : 0.5 + 0.5 * clamp((x - tk) / Math.max(tr, 0.001), 0, 1));
    const j = log.sampleAt(i, t);
    let f = 0; if (j >= 0 && j < n - 1) { const ta = tA(j), tb = tA(j + 1); f = tb > ta ? clamp((t - ta) / (tb - ta), 0, 1) : 0; }
    const fromPath = (at.pitch === true && ak >= 0) || at.bank === true;
    let pb: [number, number] = [0, 0];
    if (fromPath && n >= 2) {
      const D0 = Math.max(at.damp ?? 2, 0.05), turnS = this.props.near?.turn ?? 1.2, tw = turnS <= 0 ? D0 : turnS;
      const t0 = Math.max(t - D0, tA(0)), t1 = Math.min(t + D0, tA(n - 1));
      let k0 = clamp(j, 0, n - 2); for (let x = 0; x < 24; x++) { if (k0 <= 0 || tA(k0) <= t0 - tw) break; k0--; }
      let k1 = clamp(j, 0, n - 2); for (let x = 0; x < 24; x++) { if (k1 >= n - 2 || tA(k1 + 1) >= t1 + tw) break; k1++; }
      let len = 0, turn = 0, a0 = aA(k0), a1 = a0, tp = tA(Math.max(k0 - 1, 0));
      for (let k = k0; k <= k1; k++) {
        const ta = tA(k), tb = tA(k + 1), dt = Math.max(tb - ta, 0.0001);
        rel(k, P); rel(k + 1, Q);
        const inside = Math.max(Math.min(tb, t1) - Math.max(ta, t0), 0), metres = R * Math.cos(latOfMercY(log.m0 + P[1]) * D);
        len += Math.hypot(Q[0] - P[0], Q[1] - P[1]) * metres * inside / dt;
        if (t0 >= ta && t0 <= tb) a0 = aA(k) + (aA(k + 1) - aA(k)) * clamp((t0 - ta) / dt, 0, 1);
        if (t1 >= ta && t1 <= tb) a1 = aA(k) + (aA(k + 1) - aA(k)) * clamp((t1 - ta) / dt, 0, 1);
        if (k > 0) { const d = angleDiff(pieceHeading(k - 1), pieceHeading(k)), tl = Math.min(tw, Math.max(ta - tp, 0.001) * 0.5), tr = Math.min(tw, dt * 0.5); turn += d * (turnShare(t1, ta, tl, tr) - turnShare(t0, ta, tl, tr)); }
        tp = ta;
      }
      const span = Math.max(t1 - t0, 0.001);
      pb = [Math.atan2(a1 - a0, Math.max(len, 0.001)), Math.atan(((len / span) * (turn / span)) / 9.80665)];
    }
    const mx = at.max ?? [30, 45];
    // (with an altitude: banked only off the ground, fully once as high over it as it is tall)
    let off = 1;
    if (ak >= 0) {
      const here: [number, number, number] = [0, 0, 0]; log.relOf(i, t, here, true, ak);
      const up = log.altitude!.over === 'sea' ? Math.max(here[2] - this.groundRel(here[0], here[1]), 0) : Math.max(here[2], 0), k = clamp(up / Math.max(this.offGround(), 0.001), 0, 1);
      off = k * k * (3 - 2 * k);
    }
    let pitch = at.pitch === true && ak >= 0 ? clamp(pb[0], -mx[0] * D, mx[0] * D) : 0, bank = at.bank === true ? clamp(pb[1], -mx[1] * D, mx[1] * D) * off : 0;
    const a = sl(clamp(j, 0, Math.max(n - 1, 0))), b = sl(Math.min(clamp(j, 0, Math.max(n - 1, 0)) + 1, Math.max(n - 1, 0)));
    const col = (k: number) => log.valueAt(k, a) + (log.valueAt(k, b) - log.valueAt(k, a)) * f;
    if (typeof at.pitch === 'string' && this.pitchCol >= 0) pitch = col(this.pitchCol) * D;
    if (typeof at.bank === 'string' && this.bankCol >= 0) bank = col(this.bankCol) * D;
    // (as the pose texture keeps them: within a half turn up or down)
    return [clamp(pitch, -Math.PI / 2, Math.PI / 2), clamp(bank, -Math.PI / 2, Math.PI / 2)];
  }
  private trackNow: SetTrack | null = null;
  /** what a thing placed on its things by reference reads on the chip (core › entities › placement: an icon, a card,
   *  in the same frame, drawn after it): its block and textures (setsTrackWGSL / setsTrackGLSL's bindings), the variant
   *  they were made for, the frame (its clock, ms) and its things; null until its columns are on the chip */
  track(): SetTrack | null { return this.trackNow; }
  /** what it needs by itself: while the clock runs, as fast as its fastest thing crosses the screen (a whole city far
   *  away at real time: a few frames a second; close, or a time-lapse: every display frame); the ground being read;
   *  a paused world: none */
  override wantsFrames(s: State): number {
    if (this.gridJob || this.sweep) return Infinity;
    // its shapes' parts turning by themselves (rates, formulas) while shapes are drawn
    if (this.nearNs[0]! + this.nearNs[1]! > 0 && this.jointsNow.some((j) => j.formula || (j.rate ?? 0) !== 0)) return Infinity;
    const log = this.log; if (!log.size) return 0;
    const live = (this.attached?.world as { timeRunning?: boolean } | undefined)?.timeRunning === true, rate = live ? 1 : s.time.rate;
    if (!rate) return 0;
    const mpp = Math.max(1e-3, (s.view.pixelSize ?? 1) * 0.5);
    return motionFrames((Math.max(1, log.maxSpeed) * Math.abs(rate)) / mpp);
  }
  override status(): ElementStatus {
    const st = super.status();
    if (this.log.loading) st.pending.push(`${this.id}: its log loading`);
    if (this.log.failure) st.failed.push({ what: this.id, error: this.log.failure.message });
    // (work done a slice a frame waits while it is hidden: pending only while it is shown, or being shown)
    const active = this.shown > 0 || this.target > 0;
    if (active && this.gridJob) st.pending.push(`${this.id}: reading the ground under its things`);
    if (active && this.sweep) st.pending.push(`${this.id}: uploading its columns (${Math.round((100 * this.sweep.next) / Math.max(1, this.sweep.end))} %)`);
    if (this.log.size && Object.values(this.progs).some((x) => x && !x.ok && !x.failed)) st.pending.push(`${this.id}: its programs building`);
    for (const [k, x] of Object.entries(this.progs)) if (x?.failed) st.failed.push({ what: `${this.id} ${k}`, error: 'its program could not be built' });
    st.ready = !st.pending.length;
    return st;
  }
  override pickInfo(index: number): Omit<Picked, 'at' | 'x' | 'y'> | null {
    const log = this.log; if (index < 0 || index >= log.size) return null;
    const th = this.thingOf(index); th.state = log.at(index, this.nowMs - this.drive.smooth, true);
    return { element: this.id, id: th.id, props: { ...th.props, ...(th.state?.values ?? {}) }, d: th, index };
  }
  override readouts() {
    return { things: () => this.log.size, samples: () => this.log.samples, pieces: () => this.K, near: () => this.nearN, bytes: () => this.log.bytes, levels: () => this.nearNs.join('/'), levelChanges: () => this.levelChanges };
  }
  /** what it drew last frame and holds on the chip */
  counts(): { things: number; samples: number; trailPieces: number; shapes: number; vertices: number } {
    const N = this.log.size; return { things: N, samples: this.log.samples, trailPieces: this.props.trail === false ? 0 : N * this.K, shapes: this.nearN, vertices: N * 4 + (this.props.trail === false ? 0 : N * this.K * 4) + this.nearNs.reduce((a, n, L) => a + n * (this.lv[L]?.n ?? 0), 0) };
  }
  override attribution(): string[] { return this.log.attribution ? [this.log.attribution] : []; }
  override detach(): void {
    this.offLog?.(); this.offLog = null; this.drive.stop();
    for (const p of Object.values(this.progs)) p?.destroy(); this.progs = {}; this.variantKey = '';
    this.ubuf?.destroy(); this.quad?.destroy(); this.quad = null; this.things?.destroy(); this.dropColumns();
    this.poseTarget?.destroy(); this.poseTex?.destroy(); this.poseTarget = null; this.poseTex = null; this.poseRows = 0; this.poseKey = '';
    this.linkTex?.destroy(); this.linkTex = null; this.linkCap = 0; this.focusKey = '';
    this.ground?.destroy(); this.rampTex?.destroy(); this.dummy?.destroy(); for (const x of new Set(this.lv)) x?.buf.destroy(); this.lv = [null, null, null]; for (const nb of this.nearBufs) { nb.buf?.destroy(); nb.buf = null; nb.cap = 0; } this.nearNs.fill(0); this.glyphs?.tex.destroy(); this.glyphs = null;
    this.foundTarget?.destroy(); this.found?.destroy(); this.foundTarget = null; this.found = null; this.foundRows = 0; this.foundKey = '';
    this.foldTex?.destroy(); this.foldTex = null; this.foldSeen = ''; this.trackNow = null;
    this.ubuf = this.things = this.ground = this.rampTex = this.dummy = null; this.cols = null;
    this.thingsCap = 0; this.colRows = 0; this.dirtyAll = true; this.sweep = null; this.allThings = true; this.gridBox = [null, null]; this.gridJob = null; this.rampKey = '';
    super.detach();
  }
}
/** a set's track as a thing placed on it reads it on the chip (EntitySet.track()) */
export interface SetTrack { block: GBuffer; textures: GTexture[]; variant: SetsVariant; /** the frame it was drawn for (the world's clock, ms) */ at: number; things: number }
/** the gauge label's glyphs: 0–9 and the per cent sign a cell each (as tall as the label), the fill in red, its halo
 *  in green; their measures in label heights: a digit's advance, the sign's, the pad before a glyph, a cell's width */
interface Glyphs { tex: GTexture; m: [number, number, number, number] }
function glyphAtlas(g: Graphics, label: string): Glyphs | null {
  if (typeof OffscreenCanvas === 'undefined') return null;
  const CH = 34, FS = 30, HP = 3, font = `700 ${FS}px system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif`;
  const probe = new OffscreenCanvas(8, 8).getContext('2d'); if (!probe) return null;
  probe.font = font;
  const advD = Math.max(...[...'0123456789'].map((c) => probe.measureText(c).width)), advP = probe.measureText('%').width;
  const CW = Math.ceil(Math.max(advD, advP) + 2 * HP + 2), W = CW * 11, m0 = probe.measureText('0');
  const fill = new OffscreenCanvas(W, CH).getContext('2d', { willReadFrequently: true }), halo = new OffscreenCanvas(W, CH).getContext('2d', { willReadFrequently: true });
  if (!fill || !halo) return null;
  const y = CH / 2 + (m0.actualBoundingBoxAscent - m0.actualBoundingBoxDescent) / 2;
  for (const c of [fill, halo]) { c.font = font; c.textBaseline = 'alphabetic'; c.fillStyle = '#ffffff'; }
  halo.strokeStyle = '#ffffff'; halo.lineWidth = 2 * HP; halo.lineJoin = 'round';
  [...'0123456789%'].forEach((ch, i) => { const x = i * CW + HP + 1; fill.fillText(ch, x, y); halo.strokeText(ch, x, y); halo.fillText(ch, x, y); });
  const a = fill.getImageData(0, 0, W, CH).data, b = halo.getImageData(0, 0, W, CH).data, px = new Uint8Array(W * CH * 4);
  for (let i = 0; i < W * CH; i++) { px[i * 4] = a[i * 4 + 3]!; px[i * 4 + 1] = b[i * 4 + 3]!; px[i * 4 + 3] = 255; }
  const tex = g.texture({ label, width: W, height: CH, format: 'rgba8', filter: 'linear' }); tex.write(px);
  return { tex, m: [advD / CH, advP / CH, (HP + 1) / CH, CW / CH] };
}
const hexOf = (c: Color): string => { const q = rgba(c); return `#${q.slice(0, 3).map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('')}`; };

/** many entities as one set: moved by data (drive: drive.data(…): drawn on the chip from their samples), or a shape
 *  placed for each feature of your data (core › geometry › shapes › instances) */
export function entities(p: EntitySetProps): EntitySet;
export function entities<P = Record<string, unknown>>(p: EntitiesProps<P>): Entities<P>;
export function entities<P>(p: EntitySetProps | EntitiesProps<P>): EntitySet | Entities<P> {
  return (p as EntitySetProps).drive instanceof DataDrive ? new EntitySet(p as EntitySetProps) : new Entities<P>(p as EntitiesProps<P>);
}
