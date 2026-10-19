// core › entities: the things in a world that are someone or something: who each is (id, kind, data), a place that
// holds things or a thing in a place, how its whole body moves (locomotion), why it moves (drive: a person's controller,
// your script). Drawn with their shape's levels as instances of one solids layer; a camera can follow one, a person can
// drive one.
//   const me = w.add(entityElement()).add(entity({ id: 'me', kind: 'person', shape: walker, at: [145.12, -37.92],
//     locomotion: surface({ on: 'walkable', speed: 1.4, blocked: collisionOf(w) }), drive: drive.player(controllers.walk()) }))
//   w.control(me, controllers.walk())  ·  follow(w, me, { offset: [0, 3, -8] })
import { AslnutError } from '../world/errors.ts';
import type { World } from '../world/world.ts';
import { Solids, type SolidsProps } from '../geometry/shapes/solids.ts';
import { INSTANCE_FLOATS, rgbOf } from '../geometry/shapes/mesh.ts';
import type { Made } from '../geometry/shapes/shape.ts';
import type { Network } from '../geometry/networks/index.ts';
import { D, mercY, R } from '../space/geo.ts';
import { TILT_MAX } from '../observation/observers/orbit/views.ts';
import type { GBuffer } from '../render/graphics/interface.ts';
import { SkinDraw } from './body/draw.ts';
import { motionFrames } from '../runtime/frame.ts';
import { SKIN_INSTANCE_FLOATS, type Figure, type Motion } from './body/skin.ts';
import { dataDrive } from './sets.ts';
import type { Leveled } from '../observation/presence.ts';

type LonLat = [number, number];
const KZ = 110574, kxOf = (lat: number) => 111320 * Math.cos(lat * D), clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/** what a drive asks of the body this frame: −1 … 1 forward / right / up, a turn (rad, + clockwise seen from above),
 *  faster, a jump; or a place to go to */
export interface Want { forward: number; right: number; up: number; turn: number; fast: boolean; jump: boolean; to?: LonLat }
export const still = (): Want => ({ forward: 0, right: 0, up: 0, turn: 0, fast: false, jump: false });
/** how a whole body moves through the world (its parts' joints are kinematics) */
export interface Locomotion {
  readonly kind: 'none' | 'surface' | 'air';
  /** move the entity by what is wanted for dt seconds; `look` is the heading the view faces (rad) */
  step(e: Entity, want: Want, dt: number, w: GroundWorld, look: number): void;
}
/** what a locomotion reads of the world: the ground's height (m, NaN unknown) and its exaggeration; where something
 *  stands, the top of what is drawn there nearest the height it had (core › space › stands; without it: the ground) */
export interface GroundWorld { heightAt(lon: number, lat: number): number; readonly exaggeration: number; standAt?(lon: number, lat: number, near?: number): number; readonly standVersion?: number }
/** never moves (a building, a pylon) */
export const none = (): Locomotion => ({ kind: 'none', step() {} });
/** on the ground: free on walkable ground ('walkable', not through what `blocked` says stands there), along a network,
 *  or inside an area; turns on the spot; jumps */
export function surface(o: { on?: 'walkable' | Network | LonLat[]; speed?: number; run?: number; blocked?: (lon: number, lat: number) => number; jump?: number; /** on wheels: throttle and brake, steering by speed, top and boost speeds in km/h (a car, a bike) */ wheels?: { top?: number; boost?: number } } = {}): Locomotion {
  if (o.wheels) return wheels({ ...o.wheels, blocked: o.blocked });
  return {
    kind: 'surface',
    step(e, want, dt, w, look) {
      const speed = (want.fast ? o.run ?? (o.speed ?? 1.4) * 3.5 : o.speed ?? 1.4);
      const fx = Math.sin(look), fz = -Math.cos(look), rx = -fz, rz = fx;
      let mx = fx * want.forward + rx * want.right, mz = fz * want.forward + rz * want.right; const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
      const k = Math.min(1, (e.onGround ? 12 : 2) * dt);
      e.velocity[0] += (mx * speed - e.velocity[0]) * k; e.velocity[2] += (mz * speed - e.velocity[2]) * k;
      if (want.jump && e.onGround) { e.velocity[1] = o.jump ?? 5.2; e.onGround = false; }
      e.velocity[1] -= 22 * dt;
      let dx = e.velocity[0] * dt, dz = e.velocity[2] * dt;
      const kx = kxOf(e.at[1]), free = (ddx: number, ddz: number) => !o.blocked || o.blocked(e.at[0] + ddx / kx, e.at[1] - ddz / KZ) < 0.5;
      // a building stops it; it slides along the wall
      if ((dx || dz) && !free(dx, dz)) { if (free(dx, 0)) dz = 0; else if (free(0, dz)) dx = 0; else { dx = 0; dz = 0; } }
      let lon = e.at[0] + dx / kx, lat = e.at[1] - dz / KZ;
      const on = o.on;
      if (on && on !== 'walkable') {
        if (Array.isArray(on)) { if (!inRing(on, lon, lat)) { lon = e.at[0]; lat = e.at[1]; } }
        else { const n = (on as Network).nearest([lon, lat], { max: 50 }); if (n) [lon, lat] = n.at; }
      }
      e.at[0] = lon; e.at[1] = lat;
      const g = groundOf(w, lon, lat, e.at[2]);
      e.at[2] += e.velocity[1] * dt;
      if (e.at[2] <= g || (e.at[2] - g < 0.3 && e.velocity[1] <= 0)) { e.at[2] = g; e.velocity[1] = 0; e.onGround = true; } else e.onGround = false;
      const hs = Math.hypot(e.velocity[0], e.velocity[2]); if (hs > 0.2) e.heading = Math.atan2(e.velocity[0], -e.velocity[2]) / D;
      e.speed = hs; e.gait += Math.min(hs, 8) * dt * 2.4;
    },
  };
}
/** surface({ wheels }): a body on wheels on the ground: throttle and brake, steering by speed; it keeps to the ground */
function wheels(o: { top?: number; boost?: number; blocked?: (lon: number, lat: number) => number } = {}): Locomotion {
  return {
    kind: 'surface',
    step(e, want, dt, w) {
      const max = (want.fast ? o.boost ?? 100 : o.top ?? 60) / 3.6, f = want.forward;
      let v = e.speed * Math.sign(e.reverse ? -1 : 1);
      if (f > 0) v = Math.min(max, v + 5 * dt * f); else if (f < 0) v = Math.max(-5, v - (v > 0 ? 9 : 3) * dt); else v *= Math.exp(-0.6 * dt);
      const h = e.heading * D + want.right * dt * clamp(Math.abs(v) / 6, 0, 1) * 1.2 * Math.sign(v || 1);
      let dx = Math.sin(h) * v * dt, dz = -Math.cos(h) * v * dt;
      const kx = kxOf(e.at[1]), free = (ddx: number, ddz: number) => !o.blocked || o.blocked(e.at[0] + ddx / kx, e.at[1] - ddz / KZ) < 0.5;
      if ((dx || dz) && !free(dx, dz)) { if (free(dx, 0)) dz = 0; else if (free(0, dz)) dx = 0; else { dx = 0; dz = 0; v *= -0.2; } }
      e.at[0] += dx / kx; e.at[1] -= dz / KZ; e.at[2] = groundOf(w, e.at[0], e.at[1], e.at[2]);
      e.heading = h / D; e.speed = Math.abs(v); e.reverse = v < 0; e.onGround = true;
    },
  };
}
/** free in three dimensions (a drone, a bird, a plane): its height over the ground kept between 2 m and the ceiling as
 *  the ground under it changes; or (`over: 'sea'`) its height over the sea, kept as it flies over hills and valleys,
 *  never under 2 m over the ground (the ceiling then over the sea too). (A set moved by data flies by its log: each
 *  sample's altitude, its pose from its path: core › entities › sets) */
export function air(o: { ceiling?: number; speed?: number; fast?: number; /** it can stay in one place (a drone; default); false: it keeps flying, at least `glide` of its speed (a bird, a plane) */ hover?: boolean; glide?: number; /** what its height (`altitude`) is over: 'ground' (default) or 'sea' */ over?: 'ground' | 'sea' } = {}): Locomotion {
  return {
    kind: 'air',
    step(e, want, dt, w, look) {
      const speed = (want.fast ? o.fast ?? 120 : o.speed ?? 40) / 3.6, fx = Math.sin(look), fz = -Math.cos(look), rx = -fz, rz = fx;
      const forward = o.hover === false ? Math.max(o.glide ?? 0.4, want.forward) : want.forward;
      let mx = fx * forward + rx * want.right, mz = fz * forward + rz * want.right; const ml = Math.hypot(mx, mz); if (ml > 1) { mx /= ml; mz /= ml; }
      const k = Math.min(1, 3 * dt);
      e.velocity[0] += (mx * speed - e.velocity[0]) * k; e.velocity[2] += (mz * speed - e.velocity[2]) * k; e.velocity[1] += (want.up * speed * 0.6 - e.velocity[1]) * k;
      const kx = kxOf(e.at[1]); e.at[0] += (e.velocity[0] * dt) / kx; e.at[1] -= (e.velocity[2] * dt) / KZ;
      const g = groundOf(w, e.at[0], e.at[1]);
      if (o.over === 'sea') {
        // (over the sea: its clearance over the ground under it kept, as a set's in the air: the ground's own height,
        // not exaggerated, under it)
        const gt = g / (w.exaggeration || 1);
        e.altitude = clamp(e.altitude + e.velocity[1] * dt, gt + 2, Math.max(gt + 2, o.ceiling ?? 400));
        e.at[2] = g + (e.altitude - gt);
      } else {
        e.altitude = clamp(e.altitude + e.velocity[1] * dt, 2, o.ceiling ?? 400);
        e.at[2] = g + e.altitude;
      }
      e.heading = look / D; e.speed = Math.hypot(e.velocity[0], e.velocity[1], e.velocity[2]); e.onGround = false;
    },
  };
}
/** how a whole body moves: none, surface (walking), wheels (a car), air (a drone, a plane) */
export const locomotion = { none: () => none(), surface: (o?: Parameters<typeof surface>[0]) => surface(o), air: (o?: Parameters<typeof air>[0]) => air(o) };
/** where a thing stands at a place (m, exaggerated, as its `at[2]`): the top of what is drawn there, the level nearest
 *  `near` (its own height now, exaggerated; NaN: the lowest drawn); the ground where the world knows only it */
export const groundOf = (w: GroundWorld, lon: number, lat: number, near = NaN) => { const ex = w.exaggeration, g = w.standAt ? w.standAt(lon, lat, near / ex) : w.heightAt(lon, lat); return (Number.isNaN(g) ? 0 : g) * ex; };
/** the bare ground's height (m, exaggerated): where a view's centre lies (the camera's, not what stands on it) */
const terrainOf = (w: GroundWorld, lon: number, lat: number) => { const g = w.heightAt(lon, lat); return (Number.isNaN(g) ? 0 : g) * w.exaggeration; };
const inRing = (r: LonLat[], x: number, y: number) => { let c = false; for (let a = 0, b = r.length - 1; a < r.length; b = a++) { const [xa, ya] = r[a]!, [xb, yb] = r[b]!; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c; } return c; };

// ── input and controllers ───────────────────────────────────────────────────────────────────────────────────────
/** what a person is doing with the keys and the touch stick */
export interface InputState { keys: Set<string>; stick: [number, number]; up: number }
/** a person's way of moving something: keys and the touch stick → what is wanted */
export interface Controller { readonly kind: 'walk' | 'ride' | 'fly' | 'custom'; read(i: InputState): Want; readonly help: string }
const has = (i: InputState, ...k: string[]) => k.some((x) => i.keys.has(x));
export const controllers = {
  /** W A S D or the stick: forward, back, sideways (as the view faces); Shift runs; Space jumps */
  walk(): Controller { return { kind: 'walk', help: 'W A S D or the stick · Shift run · Space jump · drag to look · Esc map', read: (i) => ({ ...still(), forward: clamp((has(i, 'KeyW', 'ArrowUp') ? 1 : 0) - (has(i, 'KeyS', 'ArrowDown') ? 1 : 0) - i.stick[1], -1, 1), right: clamp((has(i, 'KeyD', 'ArrowRight') ? 1 : 0) - (has(i, 'KeyA', 'ArrowLeft') ? 1 : 0) + i.stick[0], -1, 1), fast: has(i, 'ShiftLeft', 'ShiftRight'), jump: has(i, 'Space') || i.up > 0 }) }; },
  /** W throttle, S brake, A D steer, Shift boost (a car, a bike) */
  ride(): Controller { return { kind: 'ride', help: 'W throttle · S brake · A D steer · Shift boost · Esc map', read: (i) => ({ ...still(), forward: clamp((has(i, 'KeyW', 'ArrowUp') ? 1 : 0) - (has(i, 'KeyS', 'ArrowDown') ? 1 : 0) - i.stick[1], -1, 1), right: clamp((has(i, 'KeyD', 'ArrowRight') ? 1 : 0) - (has(i, 'KeyA', 'ArrowLeft') ? 1 : 0) + i.stick[0], -1, 1), fast: has(i, 'ShiftLeft', 'ShiftRight') }) }; },
  /** W A S D or the stick, E / Space up, Q / C down, Shift fast */
  fly(): Controller { return { kind: 'fly', help: 'W A S D or the stick · E / ▲ up · Q / ▼ down · Shift fast · Esc map', read: (i) => ({ ...still(), forward: clamp((has(i, 'KeyW', 'ArrowUp') ? 1 : 0) - (has(i, 'KeyS', 'ArrowDown') ? 1 : 0) - i.stick[1], -1, 1), right: clamp((has(i, 'KeyD', 'ArrowRight') ? 1 : 0) - (has(i, 'KeyA', 'ArrowLeft') ? 1 : 0) + i.stick[0], -1, 1), up: clamp((has(i, 'KeyE', 'Space') ? 1 : 0) - (has(i, 'KeyQ', 'KeyC') ? 1 : 0) + i.up, -1, 1), fast: has(i, 'ShiftLeft', 'ShiftRight') }) }; },
  /** your own: what is wanted from the keys and the stick */
  custom(read: (i: InputState) => Partial<Want>, help = ''): Controller { return { kind: 'custom', help, read: (i) => ({ ...still(), ...read(i) }) }; },
  /** the map's own hands (no entity): drag to move, turn and tilt, pinch and wheel to zoom; each can be turned off,
   *  the zoom and the tilt kept within a range */
  orbit(o: CameraControlOptions = {}): CameraController {
    if (o.drag !== undefined && o.drag !== 'pan' && o.drag !== 'orbit') throw new AslnutError('E-VIEW-001', `controllers.orbit: drag is ${JSON.stringify(o.drag)}`, { where: 'controllers.orbit', fix: "drag: 'pan' (a one-finger drag moves the map) or 'orbit' (it turns and tilts round the centre)" });
    const b = o.bounds;
    if (b !== undefined && !(Array.isArray(b) && b.length === 4 && b.every(Number.isFinite) && b[2] > b[0] && b[3] > b[1])) throw new AslnutError('E-VIEW-001', `controllers.orbit: bounds is ${JSON.stringify(b)}`, { where: 'controllers.orbit', fix: 'give bounds as [west, south, east, north] degrees, west < east and south < north' });
    for (const [k, v, lo, hi] of [['viscosity', o.viscosity, 0, 1], ['snap', o.snap, 0, 8], ['step', o.step, 0, 8]] as const) if (v !== undefined && !(Number.isFinite(v) && v >= lo && v <= hi)) throw new AslnutError('E-VIEW-001', `controllers.orbit: ${k} is ${v}`, { where: 'controllers.orbit', fix: `give ${k} as a number from ${lo} to ${hi}, or leave it out` });
    const z = o.zoom, zoom = typeof z === 'object' && z !== null ? { wheel: z.wheel ?? true, pinch: z.pinch ?? true, keys: z.keys ?? true } : { wheel: z ?? true, pinch: z ?? true, keys: z ?? true };
    return {
      kind: 'orbit', help: o.drag === 'orbit' ? 'drag to turn and tilt · right-drag or Shift to move · scroll to zoom' : 'drag to move · two fingers to turn and tilt · scroll to zoom',
      gestures: { pan: o.pan ?? true, rotate: o.rotate ?? true, tilt: o.tilt ?? true, zoom: zoom.wheel || zoom.pinch || zoom.keys }, zoomInputs: zoom, zoomRange: o.zoomRange, tiltRange: o.tiltRange, drag: o.drag ?? 'pan',
      bounds: b ? [b[0], b[1], b[2], b[3]] : undefined, viscosity: o.viscosity ?? 1, snap: o.snap ?? 0, step: o.step ?? 1, keys: o.keys ?? false,
    };
  },
  /** a flat map's hands: move and zoom, never turned or tilted */
  pan(o: Omit<CameraControlOptions, 'rotate' | 'tilt' | 'drag'> = {}): CameraController { return { ...controllers.orbit({ ...o, rotate: false, tilt: false }), kind: 'pan', help: 'drag to move · scroll or pinch to zoom' }; },
};
export interface CameraControlOptions {
  pan?: boolean; rotate?: boolean; tilt?: boolean;
  /** zoom by hand: true / false for every input, or each its own (the wheel, a pinch, the + and - keys) */
  zoom?: boolean | { wheel?: boolean; pinch?: boolean; keys?: boolean };
  /** zoom levels a person may reach [out, in] */ zoomRange?: [number, number];
  /** tilts a person may reach, degrees [least, most] */ tiltRange?: [number, number];
  /** a one-finger drag moves the map ('pan', default) or turns and tilts round the centre ('orbit'); the other button or Shift does the other */ drag?: 'pan' | 'orbit';
  /** the box the view's centre is kept in by hand, [west, south, east, north] degrees (default none) */
  bounds?: [number, number, number, number];
  /** how hard the box holds while it is dragged past: 1 (default) never past it; less lets the drag go past by that
   *  share less, and the view eases back inside when it is let go */
  viscosity?: number;
  /** a zoom by hand ends on a multiple of these levels (1: whole levels, .5 halves; default 0: where it stops) */
  snap?: number;
  /** levels a + or - key zooms (default 1) */
  step?: number;
  /** the arrow keys move the view and + / - zoom it, the canvas focused (default false) */
  keys?: boolean;
}
/** what a person's hands may do to the camera itself (w.control(null, controllers.orbit())) */
export interface CameraController {
  readonly kind: 'orbit' | 'pan'; readonly help: string; readonly gestures: { pan: boolean; rotate: boolean; tilt: boolean; zoom: boolean };
  /** the inputs that zoom */ readonly zoomInputs?: { wheel: boolean; pinch: boolean; keys: boolean };
  readonly zoomRange?: [number, number]; readonly tiltRange?: [number, number]; readonly drag?: 'pan' | 'orbit';
  readonly bounds?: [number, number, number, number]; readonly viscosity?: number; readonly snap?: number; readonly step?: number; readonly keys?: boolean;
}
/** why something moves */
export interface Drive { readonly kind: 'player' | 'script' | 'none'; want(e: Entity, input: InputState, dt: number): Want }
export const drive = {
  /** a person controls it (keys and the touch stick, as the controller reads them) */
  player(c: Controller): Drive & { controller: Controller } { return { kind: 'player', controller: c, want: (_e, i) => c.read(i) }; },
  /** your code: what it wants each frame */
  script(fn: (e: Entity, dt: number) => Partial<Want>): Drive { return { kind: 'script', want: (e, _i, dt) => ({ ...still(), ...fn(e, dt) }) }; },
  /** data over time moves a set (core › entities › sets): a log (history.log: recorded, or filled by you), or a live
   *  source (data.stream, data.rows) recorded into one; `smooth` ms behind the data */
  data: dataDrive,
};

// ── entities ────────────────────────────────────────────────────────────────────────────────────────────────────
export interface EntityOptions {
  id: string; kind?: string; data?: Record<string, unknown>;
  /** its levels (a made shape, or a function of the entity: a walker's stride; null: not drawn now) */
  shape?: Made | ((e: Entity) => Made | null); color?: string;
  /** [lon, lat] (standing on the ground) or [lon, lat, metres] */
  at: LonLat | [number, number, number];
  /** degrees clockwise from north */
  heading?: number;
  /** a place holds things (a park, a building: its footprint); a thing sits in a place ('auto': the one under it) */
  placement?: 'place' | 'thing';
  in?: Entity | 'auto';
  footprint?: LonLat[];
  locomotion?: Locomotion;
  drive?: Drive;
  /** a skinned body (core › entities › body): drawn near with its skeleton posed by `motion`; its `shape` (when it
   *  has one) farther away, past the layer's budget of bodies, or until the body's program is built */
  body?: Figure | ((e: Entity) => Figure | null);
  /** what the body does now (default: motion.auto: its 'idle', 'walk' or 'run' clip by its speed, the phase following
   *  the ground walked) */
  motion?: (e: Entity, figure: Figure) => Motion;
  /** the body's 8 palette colours (its skin, clothes, hair: the slots its figure's vertices take) */
  palette?: readonly (string | number)[];
  /** the numbers its figure's decal reads (a face) */
  decal?: readonly [number, number, number];
  /** its body's size (1: as made) */
  scale?: number;
}
/** what a body does by default: standing ('idle'), walking or running by its speed, mixed across the change; its
 *  cycle follows the ground walked (a clip's metres a cycle; without them, the gait's phase) */
export const motions = {
  auto(o: { run?: number; idle?: number } = {}) {
    const runAt = o.run ?? 2.6, still = o.idle ?? 0.15, seen = new WeakMap<Entity, { walked: number; phase: number }>();
    return (e: Entity, f: Figure): Motion => {
      const clips = f.clips, walk = clips.walk, run = clips.run;
      const m = run ? Math.max(0, Math.min(1, (e.speed - runAt * 0.8) / (runAt * 0.4))) : 0;
      // one phase for both clips: each metre walked moves it by the share of a cycle the mix covers in a metre
      let s = seen.get(e); if (!s) seen.set(e, (s = { walked: e.walked, phase: 0 }));
      const dist = (walk?.distance ?? 0) * (1 - m) + (run?.distance ?? walk?.distance ?? 0) * m;
      s.phase = dist > 0 ? s.phase + (e.walked - s.walked) / dist : e.gait / (2 * Math.PI); s.walked = e.walked;
      if (e.speed < still || !walk) return { clip: clips.idle ? 'idle' : 'walk', at: clips.idle ? 0 : s.phase };
      return m <= 0 ? { clip: 'walk', at: s.phase } : m >= 1 ? { clip: 'run', at: s.phase } : { clip: 'walk', at: s.phase, to: { clip: 'run', at: s.phase, mix: m } };
    };
  },
};
const AUTO = motions.auto();
export class Entity {
  readonly id: string; kind: string; data: Record<string, unknown>;
  readonly placement: 'place' | 'thing'; footprint: LonLat[] | null;
  /** [lon, lat, metres up] */
  at: [number, number, number];
  heading: number; velocity: [number, number, number] = [0, 0, 0]; speed = 0; onGround = true; reverse = false;
  /** metres over the ground (in the air) */
  altitude = 25;
  /** a gait's phase (a walker's stride) */
  gait = 0;
  locomotion: Locomotion; drive: Drive | null; shape: EntityOptions['shape']; color: number;
  body: EntityOptions['body']; motion: (e: Entity, figure: Figure) => Motion; scale: number;
  /** its palette (8 colours 0xRRGGBB) and decal numbers */
  palette = new Float32Array(8).fill(0xffffff); decal: [number, number, number] = [0, 0, 0];
  /** metres walked (a body's gait follows it) */
  walked = 0;
  private inOpt: Entity | 'auto' | undefined; private layer: EntityElement | null = null;
  constructor(o: EntityOptions) {
    if (!o?.id) throw new AslnutError('E-DATA-001', 'an entity needs an id', { fix: "entity({ id: 'bus-12', at: [lon, lat] })" });
    this.id = o.id; this.kind = o.kind ?? 'thing'; this.data = o.data ?? {}; this.placement = o.placement ?? 'thing'; this.footprint = o.footprint ?? null;
    this.at = [o.at[0], o.at[1], o.at[2] ?? NaN]; this.heading = o.heading ?? 0;
    this.locomotion = o.locomotion ?? none(); this.drive = o.drive ?? null; this.shape = o.shape; this.color = rgbOf(o.color ?? '#ffffff'); this.inOpt = o.in;
    this.body = o.body; this.motion = o.motion ?? AUTO; this.scale = o.scale ?? 1;
    if (o.palette) this.setPalette(o.palette);
    if (o.decal) this.decal = [o.decal[0], o.decal[1], o.decal[2]];
  }
  /** new palette colours (its figure's slots, in order) */
  setPalette(p: readonly (string | number)[]): this { p.slice(0, 8).forEach((c, i) => (this.palette[i] = rgbOf(c))); return this; }
  /** the place it sits in: given, or the place whose footprint is under it ('auto') */
  get in(): Entity | null {
    if (this.inOpt instanceof Entity) return this.inOpt;
    if (this.placement !== 'thing' || !this.layer) return null;
    return this.layer.list().find((p) => p.placement === 'place' && p.footprint && inRing(p.footprint, this.at[0], this.at[1])) ?? null;
  }
  /** a place's things (those that sit in it), filtered by kind */
  contents(filter: { kind?: string } = {}): Entity[] {
    if (this.placement !== 'place' || !this.layer) return [];
    return this.layer.list().filter((t) => t !== this && t.placement === 'thing' && t.in === this && (!filter.kind || t.kind === filter.kind));
  }
  /** (the layer it is in) */
  joined(l: EntityElement | null): void { this.layer = l; }
}
export const entity = (o: EntityOptions) => new Entity(o);

/** entities drawn and moved: one solids layer (instances of their shapes, a chunk round them), their drives and
 *  locomotion stepped each frame, the keys and the touch stick read for the ones a person drives */
export class EntityElement extends Solids {
  readonly input: InputState = { keys: new Set(), stick: [0, 0], up: 0 };
  /** the heading the view faces (rad): a person's controls move things as they see them */
  look = 0;
  private items = new Map<string, Entity>(); private offs: (() => void)[] = [];
  /** the things it put down (no height given): stood again when what is stood on changes */
  private grounded = new WeakSet<Entity>(); private standSeen = -1;
  private bodyOpts: Required<BodiesOptions>; private waitsFor: (() => string[]) | null;
  private framesOpts: NonNullable<EntityElementProps['frames']>;
  constructor(p: EntityElementProps = {}) {
    super({ id: p.id ?? 'entities', hover: false, fade: 0, when: p.when });
    this.framesOpts = p.frames ?? {};
    this.waitsFor = p.pending ?? null;
    this.bodyOpts = { pixels: 28, budget: 32, shadows: true, ...p.bodies };
  }
  add(...es: Entity[]): this { for (const e of es) { this.items.set(e.id, e); e.joined(this); } (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); return this; }
  remove(id: string): this { const e = this.items.get(id); if (e) { e.joined(null); this.items.delete(id); } return this; }
  get(id: string): Entity | undefined { return this.items.get(id); }
  list(): Entity[] { return [...this.items.values()]; }
  /** a person drives one of these (w.control(entity, controller) comes here) */
  control(w: World, e: Entity, c?: Controller, o?: Parameters<typeof control>[4]): () => void { return control(w, this, e, c, o); }
  /** listen to the keys (a person drives something here) */
  listen(on: boolean): this {
    for (const f of this.offs) f(); this.offs = [];
    if (!on || typeof window === 'undefined') return this;
    const kd = (e: KeyboardEvent) => { const t = e.target as HTMLElement; if (t && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) return; this.input.keys.add(e.code); if (['Space', 'ArrowUp', 'ArrowDown'].includes(e.code)) e.preventDefault(); (this.attached?.world as { invalidate?: () => void } | undefined)?.invalidate?.(); };
    const ku = (e: KeyboardEvent) => this.input.keys.delete(e.code);
    addEventListener('keydown', kd); addEventListener('keyup', ku);
    this.offs.push(() => { removeEventListener('keydown', kd); removeEventListener('keyup', ku); this.input.keys.clear(); });
    return this;
  }
  /** each frame: what each drive wants, its locomotion, then its instance */
  override frame(ctx: Parameters<Solids['frame']>[0]) {
    const dt = Math.min(0.1, Math.max(0, (ctx.dt || 16) / 1000)), w = ctx.world as unknown as GroundWorld, sv = w.standVersion ?? 0;
    for (const e of this.items.values()) {
      // put down without a height: on what is stood on there, and again when that changes (a street tile built)
      if (Number.isNaN(e.at[2])) { e.at[2] = groundOf(w, e.at[0], e.at[1]); this.grounded.add(e); }
      else if (sv !== this.standSeen && !e.drive && this.grounded.has(e)) e.at[2] = groundOf(w, e.at[0], e.at[1], e.at[2]);
      if (e.drive) { e.locomotion.step(e, e.drive.want(e, this.input, dt), dt, w, e.drive.kind === 'player' ? this.look : e.heading * D); e.walked += e.speed * dt; }
    }
    this.standSeen = sv;
    this.moverRate = this.moversOnScreen(ctx);
    const bodies = this.bodies(ctx);
    // (the instances written here are drawn by this very frame: no other frame is asked for them)
    this.framing = true; try { this.place(bodies?.drawn); } finally { this.framing = false; }
    const out = super.frame(ctx);
    if (bodies) out.push(...bodies.draws);
    return out;
  }
  // ── skinned bodies ──
  private skin: SkinDraw | null = null; private skinBlock: GBuffer | null = null; private skinT = new Float32Array(16);
  private skinData = new Map<Figure, { data: Float32Array; n: number; b: number[] }>();
  /** the bodies drawn skinned this frame: those at least `pixels` tall on screen, the nearest `budget` of them, whose
   *  program is built; their draws (the rest keep their far shape) */
  private bodies(ctx: Parameters<Solids['frame']>[0]): { drawn: Set<Entity>; draws: ReturnType<SkinDraw['draws']> } | null {
    const base = this.solidsBase(ctx); if (!base) return null;
    const cam = ctx.camera, kx = kxOf(cam.lat), o = this.bodyOpts, cand: { e: Entity; f: Figure; d: number }[] = [];
    // the governor's detail (0…1 when the frame is over its budget) raises the size a body must have to be skinned
    const k = cam.height / (2 * Math.tan(cam.fov / 2)), ex = cam.eye[0]!, ey = cam.eye[1]!, ez = cam.eye[2]!, minPx = o.pixels / Math.max(0.25, Math.min(1, this.detailOf(ctx.s)));
    for (const e of this.items.values()) {
      if (!e.body) continue;
      const f = typeof e.body === 'function' ? e.body(e) : e.body; if (!f) continue;
      const x = (e.at[0] - cam.lon) * kx, z = -(e.at[1] - cam.lat) * KZ, d = Math.hypot(x - ex, e.at[2] + f.height * 0.5 * e.scale - ey, z - ez);
      if ((f.height * e.scale * k) / Math.max(d, 0.1) < minPx) continue;
      cand.push({ e, f, d });
    }
    const drawn = new Set<Entity>();
    if (!cand.length && !this.skin) return { drawn, draws: [] };
    const sd = (this.skin ??= new SkinDraw(base.g, this.id));
    cand.sort((a, b) => a.d - b.d);
    for (const x of this.skinData.values()) { x.n = 0; x.b = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity]; }
    this.bodiesWaiting = 0;
    for (const { e, f } of cand) {
      if (drawn.size >= o.budget) break;
      if (!sd.ready(f)) { this.bodiesWaiting++; continue; }
      const [ra, rb, t] = sd.rows(f, e.motion(e, f), e);
      let set = this.skinData.get(f);
      if (!set) this.skinData.set(f, (set = { data: new Float32Array(SKIN_INSTANCE_FLOATS * 8), n: 0, b: [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity] }));
      if ((set.n + 1) * SKIN_INSTANCE_FLOATS > set.data.length) { const d = new Float32Array(set.data.length * 2); d.set(set.data); set.data = d; }
      const x = (e.at[0] - cam.lon) * kx, z = -(e.at[1] - cam.lat) * KZ, i = set.n * SKIN_INSTANCE_FLOATS, a = set.data;
      // the figure's front is its +z: turned half round, it faces north at heading 0 (as the solids' shapes)
      a[i] = x; a[i + 1] = z; a[i + 2] = e.at[2]; a[i + 3] = e.heading * D + Math.PI;
      a[i + 4] = ra; a[i + 5] = rb; a[i + 6] = t; a[i + 7] = e.scale;
      a.set(e.palette, i + 8);
      a[i + 16] = drawn.size; a[i + 17] = e.decal[0]; a[i + 18] = e.decal[1]; a[i + 19] = e.decal[2];
      set.n++; drawn.add(e);
      const r = f.height * e.scale, b = set.b;
      b[0] = Math.min(b[0]!, x - r); b[1] = Math.min(b[1]!, e.at[2] - 0.2); b[2] = Math.min(b[2]!, z - r); b[3] = Math.max(b[3]!, x + r); b[4] = Math.max(b[4]!, e.at[2] + r); b[5] = Math.max(b[5]!, z + r);
    }
    // the bodies' frame: the view's centre (their places are metres from it); slot 255: no chunk's (picking); no tints
    const lat = cam.lat, cv = R * Math.cos(lat * D), t = this.skinT;
    t[0] = 0; t[1] = 0; t[2] = (cv * D) / kx; t[3] = (cv * D) / (KZ * Math.cos(lat * D));
    t[4] = ctx.world.exaggeration; t[5] = this.pickNo; t[6] = -1; t[7] = 1; t[8] = t[9] = t[10] = 1; t[11] = 255; t[14] = -1;
    (this.skinBlock ??= base.g.buffer('uniform', 64, `${this.id} bodies block`)).write(t);
    const sets = [...this.skinData].filter(([, x]) => x.n).map(([figure, x]) => ({ figure, data: x.data, n: x.n, bounds: x.b.map((v, j) => (j === 0 || j === 3 ? v * t[2]! : j === 2 || j === 5 ? v * t[3]! : v)) }));
    const draws = sd.draws(ctx, sets, this.skinBlock, base.textures);
    if (!o.shadows) for (const d of draws) d.cast = false;
    return { drawn, draws };
  }
  private bodiesWaiting = 0;
  override status(): ReturnType<Solids['status']> {
    const st = super.status();
    if (this.bodiesWaiting) st.pending.push(`${this.bodiesWaiting} bodies waiting for their program`);
    if (this.waitsFor && (this.shown > 0 || this.target > 0)) st.pending.push(...this.waitsFor());
    st.ready = !st.pending.length;
    return st;
  }
  /** what the skinned bodies drew last frame (figures, instances, vertices) and hold on the chip */
  bodyCounts(): { figures: number; instances: number; vertices: number; bytes: number } { return { ...(this.skin?.drawn ?? { figures: 0, instances: 0, vertices: 0 }), bytes: this.skin?.bytes ?? 0 }; }
  override animating(): boolean { if (super.animating() || this.bodiesWaiting) return true; for (const e of this.items.values()) if (e.drive && (e.speed > 0.01 || this.input.keys.size || this.input.stick[0] || this.input.stick[1] || this.input.up)) return true; return false; }
  /** what its moving things need (core › runtime › frame), from the last frame: a person's keys or stick held, every
   *  display frame; else the things moving on screen, each by how fast it crosses the screen (at most a pixel a frame:
   *  a walker far away a few frames a second, near every display frame; a skinned body's limbs count three times its
   *  pace); off screen or too small to see move (under 3 px tall), none: they wait where they are until frames come */
  override wantsFrames(): number {
    if (this.fading() || this.bodiesWaiting) return Infinity;
    for (const e of this.items.values()) if (e.drive && (this.input.keys.size || this.input.stick[0] || this.input.stick[1] || this.input.up)) return Infinity;
    return Math.max(this.clockRate(), this.moverRate, this.framesOpts.fps && this.skin?.drawn?.instances ? this.framesOpts.fps : 0);
  }
  private moverRate = 0;
  /** the frames a second its moving things on screen need (0: none on screen) */
  private moversOnScreen(ctx: Parameters<Solids['frame']>[0]): number {
    const cam = ctx.camera, vp = cam.viewProj, kx = kxOf(cam.lat), k = cam.height / (2 * Math.tan(cam.fov / 2)), ex = cam.eye[0]!, ey = cam.eye[1]!, ez = cam.eye[2]!, globe = cam.morph < 0.98;
    let px = 0;
    for (const e of this.items.values()) {
      if (!e.drive || e.speed <= 0.01) continue;
      const x = (e.at[0] - cam.lon) * kx, z = -(e.at[1] - cam.lat) * KZ, y = Number.isFinite(e.at[2]) ? e.at[2] : cam.groundY;
      const d = Math.max(0.5, Math.hypot(x - ex, y - ey, z - ez));
      // in the camera's view (with a margin: things about to come in), flat views only (on the globe: by distance)
      if (!globe) {
        const cw = vp[3]! * x + vp[7]! * y + vp[11]! * z + vp[15]!; if (cw <= 0) continue;
        const cx = (vp[0]! * x + vp[4]! * y + vp[8]! * z + vp[12]!) / cw, cy = (vp[1]! * x + vp[5]! * y + vp[9]! * z + vp[13]!) / cw;
        if (Math.abs(cx) > 1.15 || Math.abs(cy) > 1.15) continue;
      }
      const fig = e.body ? (typeof e.body === 'function' ? e.body(e) : e.body) : null, tall = (fig?.height ?? 1.7) * e.scale;
      if ((tall * k) / d < (this.framesOpts.below ?? 3)) continue;
      const limbs = fig ? 3 : 1;
      px = Math.max(px, (e.speed * limbs * k) / d);
    }
    return motionFrames(px, { stepPx: this.framesOpts.step ?? 1 });
  }
  /** the instances: free chunks of 500 m from a fixed origin (the first entity's place), each holding the entities on
   *  its square; a chunk whose members and shapes stay the same only has its numbers written again */
  private place(skinned?: Set<Entity>): void {
    const es = [...this.items.values()].filter((e) => e.shape && !skinned?.has(e));
    if (!es.length) { for (const k of this.sigs.keys()) this.drop(k); this.sigs.clear(); return; }
    this.origin ??= [es[0]!.at[0], es[0]!.at[1]];
    const o = this.origin, kx = kxOf(o[1]), chunks = new Map<string, Map<Made, number[]>>();
    for (const e of es) {
      const x = (e.at[0] - o[0]) * kx, z = -(e.at[1] - o[1]) * KZ, ix = Math.floor(x / 500), iz = Math.floor(z / 500), key = `e:${ix}_${iz}`;
      let c = chunks.get(key); if (!c) chunks.set(key, (c = new Map()));
      const made = typeof e.shape === 'function' ? e.shape(e) : e.shape!; if (!made) continue;
      let g = c.get(made); if (!g) c.set(made, (g = []));
      // the shape's front is its +z: turned half round, it faces north at heading 0
      g.push(x - ix * 500, z - iz * 500, e.at[2], 0, 1, 1, 1, e.heading * D + Math.PI, e.color, 0);
    }
    for (const k of [...this.sigs.keys()]) if (!chunks.has(k)) { this.drop(k); this.sigs.delete(k); }
    for (const [key, c] of chunks) {
      const sets = [...c].map(([m, v]) => ({ shape: m.levels as never, data: Float32Array.from(v), m })), sig = sets.map((x) => `${this.shapeNo(x.m)}:${x.data.length}`).join(',');
      if (this.sigs.get(key) !== sig) {
        const [ix, iz] = key.slice(2).split('_').map(Number) as [number, number];
        this.put(key, { origin: o, at: [ix * 500, iz * 500], free: true, instances: sets.map(({ shape, data, m }) => (m.size ? { shape, data, size: m.size, radius: Math.hypot(m.bounds[1][0] - m.bounds[0][0], m.bounds[1][1] - m.bounds[0][1], m.bounds[1][2] - m.bounds[0][2]) / 2 } : { shape, data })), info: () => null });
        this.sigs.set(key, sig);
      } else sets.forEach((x, i) => this.moveInstances(key, i, x.data));
    }
  }
  private origin: LonLat | null = null; private sigs = new Map<string, string>(); private shapeNos = new WeakMap<Made, number>(); private nextNo = 0;
  private shapeNo(m: Made): number { let n = this.shapeNos.get(m); if (n === undefined) { n = ++this.nextNo; this.shapeNos.set(m, n); } return n; }
  override detach(): void { this.listen(false); this.skin?.dispose(); this.skin = null; this.skinBlock?.destroy(); this.skinBlock = null; this.skinData.clear(); super.detach(); }
}
/** how an entity layer draws skinned bodies */
export interface BodiesOptions {
  /** drawn skinned while at least this many pixels tall on screen (default 28); smaller: their far shape */
  pixels?: number;
  /** at most this many skinned at once, the nearest first (default 32) */
  budget?: number;
  /** they cast the sun's shadow (default true) */
  shadows?: boolean;
}
export interface EntityElementProps {
  id?: string;
  /** skinned bodies (entities with a `body`) */
  bodies?: BodiesOptions;
  /** when it is shown (core › world: when) */
  when?: SolidsProps['when'];
  /** what else it is waiting for (bodies still being made…): it is not settled while there is any */
  pending?: () => string[];
  /** the frames its moving things ask for (core › runtime › frame): `below` px tall on screen they ask for none (too
   *  small to see move; default 3), `step` px is the most they may move between frames (default 1); `fps` the frames a
   *  second it asks for while any skinned body is drawn, moving or not (bodies moving in place: a lineup, a gallery;
   *  default 0: only the things that move ask) */
  frames?: { below?: number; step?: number; fps?: number };
}
export const entityElement = (p: Leveled<EntityElementProps> = {}) => new EntityElement(p as EntityElementProps);

/** the camera behind an entity: `offset` [right, up, behind] metres, easing over `lag` seconds, looking at it or ahead
 *  of it; pulled in where `blocked` says something stands between (a wall). Returns the stop function */
/** the lowest the camera looks (the world's camera tilts to TILT_MAX at most): level with the eyes, a little down */
const PITCH_LOW = (90 - TILT_MAX) * D;
export function follow(w: World, e: Entity, o: { offset?: [number, number, number]; lag?: number; look?: 'target' | 'ahead'; yaw?: () => number; pitch?: () => number; blocked?: (lon: number, lat: number) => number; /** metres over its foot the camera looks from (its eyes: first person, with offset [0, 0, 0]), or looks at (default 1.3) */ eye?: number | (() => number) } = {}): () => void {
  const off = o.offset ?? [0, 3, -8];
  // (the camera's numbers checked once, here: a NaN in them would be a NaN view every frame)
  const fin = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
  if (!(Array.isArray(off) && off.length === 3 && off.every(fin))) throw new AslnutError('E-VIEW-001', `follow: offset is ${JSON.stringify(off)}`, { where: `follow '${e.id}'`, fix: 'give offset as three finite metres [right, up, behind] (default [0, 3, -8])' });
  if (o.lag !== undefined && !(fin(o.lag) && o.lag >= 0)) throw new AslnutError('E-VIEW-001', `follow: lag is ${o.lag}`, { where: `follow '${e.id}'`, fix: 'give lag in seconds, a finite number 0 or more, or leave it out' });
  if (typeof o.eye === 'number' && !fin(o.eye)) throw new AslnutError('E-VIEW-001', `follow: eye is ${o.eye}`, { where: `follow '${e.id}'`, fix: 'give eye in metres over its foot, a finite number, or leave it out' });
  let cur: [number, number] | null = null;
  const stop = w.on('frame', ({ dt }) => {
    const yaw = o.yaw ? o.yaw() : e.heading * D, kx = kxOf(e.at[1]), g = terrainOf(w as unknown as GroundWorld, e.at[0], e.at[1]);
    let dist = Math.hypot(off[1], off[2]); const pitch = o.pitch ? o.pitch() : dist ? Math.atan2(off[1], -off[2]) : PITCH_LOW;
    const eyeH = typeof o.eye === 'function' ? o.eye() : o.eye ?? 1.3;
    // the line from the eye to it: pulled in before a wall
    if (o.blocked && dist > 0) { const bx = -Math.sin(yaw), bz = Math.cos(yaw); for (let s = 1.5; s < dist; s += 1) { const hy = e.at[2] - g + 1.3 + Math.sin(pitch) * s; if (o.blocked(e.at[0] + (bx * Math.cos(pitch) * s) / kx, e.at[1] - (bz * Math.cos(pitch) * s) / KZ) > hy - 0.5) { dist = Math.max(1.5, s - 1); break; } } }
    const above = e.at[2] - g + eyeH, p = Math.max(PITCH_LOW, pitch), ahead = above / Math.tan(p) + (o.look === 'ahead' ? e.speed * 0.8 : 0);
    const tx = e.at[0] + (Math.sin(yaw) * ahead) / kx, ty = e.at[1] - (-Math.cos(yaw) * ahead) / KZ, k = o.lag ? 1 - Math.exp(-(dt / 1000) / o.lag) : 1;
    cur = cur ? [cur[0] + (tx - cur[0]) * k, cur[1] + (ty - cur[1]) * k] : [tx, ty];
    w.go({ lon: cur[0], lat: cur[1], dist: (dist + above / Math.sin(p)) / w.camera.frameK, tilt: clamp(90 - p / D, 5, 88), bearing: yaw / D } as never);
  });
  return stop;
}
export { INSTANCE_FLOATS };

/** a person drives an entity: its drive the controller's, the keys and the touch stick read, the camera behind it
 *  (drag to look round it: right turns it right, as in games); null hands the view back to the map. Returns the stop function */
export function control(w: World, layer: EntityElement, e: Entity | null, c: Controller = controllers.walk(), o: { offset?: [number, number, number]; blocked?: (lon: number, lat: number) => number; /** first person: the camera at these metres over its foot (its eyes), looking where a drag turns it */ eye?: number } = {}): () => void {
  if (!e) { layer.listen(false); return () => {}; }
  e.drive = drive.player(c); layer.listen(true); layer.look = e.heading * D;
  const first = o.eye !== undefined, off = first ? [0, 0, 0] as [number, number, number] : o.offset ?? [0, 3, -8];
  let pitch = first ? PITCH_LOW : Math.atan2(off[1], -off[2]);
  const stopFollow = follow(w, e, { offset: off, blocked: first ? undefined : o.blocked, yaw: () => layer.look, pitch: () => pitch, eye: first ? o.eye : undefined });
  const el = (w as unknown as { renderer?: { canvas?: HTMLCanvasElement } }).renderer?.canvas, offs: (() => void)[] = [stopFollow];
  if (el && typeof el.addEventListener === 'function') {
    let drag: { id: number; x: number; y: number } | null = null;
    const down = (ev: PointerEvent) => { if (drag) return; drag = { id: ev.pointerId, x: ev.clientX, y: ev.clientY }; ev.stopPropagation(); };
    const move = (ev: PointerEvent) => { if (!drag || ev.pointerId !== drag.id) return; layer.look += (ev.clientX - drag.x) * 0.0045; pitch = clamp(pitch + (ev.clientY - drag.y) * 0.0035, PITCH_LOW, 1.3); drag.x = ev.clientX; drag.y = ev.clientY; ev.stopPropagation(); w.invalidate(); };
    const up = (ev: PointerEvent) => { if (drag && ev.pointerId === drag.id) drag = null; };
    el.addEventListener('pointerdown', down, true); el.addEventListener('pointermove', move, true); el.addEventListener('pointerup', up, true); el.addEventListener('pointercancel', up, true);
    offs.push(() => { el.removeEventListener('pointerdown', down, true); el.removeEventListener('pointermove', move, true); el.removeEventListener('pointerup', up, true); el.removeEventListener('pointercancel', up, true); });
  }
  // the camera's own gestures are off while a person drives: a drag looks round
  w.camera.stop();
  return () => { for (const f of offs) f(); layer.listen(false); if (e.drive?.kind === 'player') e.drive = null; };
}
