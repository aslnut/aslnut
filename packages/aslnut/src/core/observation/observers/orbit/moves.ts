// core › observation › observers › orbit › moves: what a camera operator knows, each a preset of the same four parts
// (not an engine each):
//   path     the rig round what it looks at, at keys over the move: how far (m), how far from straight down (°), the way
//            it faces (° from north, or `turn`: from the subject's own heading), where the subject sits on the screen
//   aim      what it looks at: lookAt(target), a place or a thing by its track (core › … › orbit › aim › look-at)
//   damping  how it follows the thing: a spring per channel (core › … › orbit › follow)
//   speed    an ease into each key (core › … › orbit › speed › easing)
// One engine plays them all: w.play(move, { seconds }). A move that follows another on the same thing carries its
// springs on (no jolt at the change); a key's rig 'now' is where the camera is when the move starts (a crane up from
// the chase's own eye). Close to the ground the eye keeps over what stands under it (`over`, eased: it rises over a
// building it passes, never through it), and the world keeps it over the ground.
//   w.play(moves.chase(track(log, 'car'), { behind: 30, up: 10 }))                 behind it as it goes, until stopped
//   await w.play(moves.crane(car, { up: 400, swing: 30 }), { seconds: 6 })          up and round from where it is
//   w.play(moves.track(plane, { side: 80, up: 4 }), { seconds: 8 })                 alongside, from its left
//   w.play(move({ aim: lookAt(p), keys: [{ at: 0, rig: { dist: 20, tilt: 70, bearing: 0 } }, { at: 1, rig: { bearing: 90 }, ease: 'cinematic' }] }), { seconds: 5 })
import { AslnutError } from '../../../world/errors.ts';
import { D } from '../../../space/geo.ts';
import { ease, easing, type Ease } from './ease.ts';
import { checkDamping, Follower, type Damping, type Place } from './follow.ts';
import { checkTarget, eyeOf, eyeOfPose, lookAt, rigFrom, rigPose, whereOf, type Aim, type Ground, type Rig, type Target } from './aim.ts';
import type { Pose } from './views.ts';

/** a rig at a key: each number unset is the key's before it (the first key's: where the camera is) */
export interface RigSpec {
  /** metres from the eye to what it looks at */
  dist?: number;
  /** degrees from straight down */
  tilt?: number;
  /** the way the camera faces, degrees clockwise from north */
  bearing?: number;
  /** or the way it faces from the subject's heading (0: from straight behind it, looking the way it goes) */
  turn?: number;
  /** where the subject sits on the screen: up from the middle, a share of half the screen's height */
  raise?: number;
}
/** a key of a move's path: at a share of its time (0..1), its rig ('now': where the camera is when it starts), the
 *  ease into it */
export interface RigKey { at: number; rig: RigSpec | 'now'; ease?: Ease }
/** a camera move: its kind, what it looks at, its path's keys, its damping, how far the eye keeps over what stands */
export interface Move {
  readonly kind: string;
  readonly aim: Aim;
  readonly keys: readonly RigKey[];
  readonly damping?: Damping;
  /** metres the eye keeps over what stands near it (the twin's solids: it rises over them, eased); false: none */
  readonly over?: number | false;
  /** seconds it takes when play gives none (unset: it holds its first key until stopped) */
  readonly seconds?: number;
}
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const RIG_KEYS = ['dist', 'tilt', 'bearing', 'turn', 'raise'] as const;
/** a move of your own from the same parts (every preset is one of these) */
export function move(m: { kind?: string; aim: Aim | Target; keys: readonly RigKey[]; damping?: Damping; over?: number | false; seconds?: number }): Move {
  const where = `moves.${m.kind ?? 'move'}`;
  const aim = isAim(m.aim) ? m.aim : lookAt(m.aim as Target);
  if (!Array.isArray(m.keys) || !m.keys.length) throw new AslnutError('E-VIEW-001', `${where}: a move needs keys`, { where, fix: "give keys: [{ at: 0, rig: { dist, tilt, bearing } }, …] (rig 'now': where the camera is)" });
  m.keys.forEach((k, i) => {
    if (!fin(k.at) || k.at < 0 || k.at > 1) throw new AslnutError('E-VIEW-001', `${where}: key ${i}'s at is ${k.at}`, { where, fix: 'give at as a share of the move, 0..1' });
    if (i && k.at < m.keys[i - 1]!.at) throw new AslnutError('E-VIEW-001', `${where}: key ${i} comes before key ${i - 1}`, { where, fix: 'sort the keys by at' });
    if (k.rig !== 'now') for (const f of RIG_KEYS) { const x = k.rig?.[f]; if (x !== undefined && !fin(x)) throw new AslnutError('E-VIEW-001', `${where}: key ${i}'s ${f} is ${x}`, { where, fix: `give ${f} as a finite number, or leave it out` }); }
    if (k.rig !== 'now' && k.rig?.dist !== undefined && !(k.rig.dist > 0)) throw new AslnutError('E-VIEW-001', `${where}: key ${i}'s dist is ${k.rig.dist}`, { where, fix: 'give dist in metres above 0' });
    easing(k.ease);
  });
  checkDamping(m.damping, where);
  if (m.over !== undefined && m.over !== false && !(fin(m.over) && m.over >= 0)) throw new AslnutError('E-VIEW-001', `${where}: over is ${m.over}`, { where, fix: 'give over in metres, 0 or more, false, or leave it out' });
  if (m.seconds !== undefined && !(fin(m.seconds) && m.seconds >= 0)) throw new AslnutError('E-VIEW-001', `${where}: seconds is ${m.seconds}`, { where, fix: 'give seconds as a finite number, 0 or more, or leave it out' });
  return { kind: m.kind ?? 'move', aim, keys: m.keys, damping: m.damping, over: m.over, seconds: m.seconds };
}
const isAim = (a: unknown): a is Aim => !!a && typeof a === 'object' && (a as Aim).kind === 'look-at';
const aimOf = (t: Aim | Target, where: string): Aim => { if (isAim(t)) return t; checkTarget(t, where); return lookAt(t); };
/** a rig said as behind and up (metres): its distance and tilt */
const backUp = (behind: number, up: number) => ({ dist: Math.max(0.01, Math.hypot(behind, up)), tilt: 90 - Math.atan2(up, behind) / D });
interface Common { damping?: Damping; over?: number | false; raise?: number; ease?: Ease; seconds?: number }

/** the presets: chase, track, crane, dolly, arc, reveal (core › observation › observers › orbit › moves) */
export const moves = {
  /** behind a moving thing and over it, looking the way it goes; `turn` swings round it (degrees from straight
   *  behind), `to` the rig it ends at (a chase that drifts round); the eye keeps `over` metres over what stands */
  chase(t: Aim | Target, o: Common & { behind?: number; up?: number; turn?: number; to?: RigSpec } = {}): Move {
    const r = { ...backUp(o.behind ?? 12, o.up ?? 4), turn: o.turn ?? 0, raise: o.raise };
    return move({ kind: 'chase', aim: aimOf(t, 'moves.chase'), keys: o.to ? [{ at: 0, rig: r }, { at: 1, rig: o.to, ease: o.ease ?? 'smooth' }] : [{ at: 0, rig: r }], damping: o.damping, over: o.over ?? 4, seconds: o.seconds });
  },
  /** alongside a moving thing: `side` metres to its left (negative: its right), `up` over it, looking across at it;
   *  `to` the rig it ends at (a track that falls back behind it) */
  track(t: Aim | Target, o: Common & { side?: number; up?: number; to?: RigSpec } = {}): Move {
    const side = o.side ?? 8, r = { ...backUp(Math.abs(side), o.up ?? 2), turn: side >= 0 ? 90 : -90, raise: o.raise };
    return move({ kind: 'track', aim: aimOf(t, 'moves.track'), keys: o.to ? [{ at: 0, rig: r }, { at: 1, rig: o.to, ease: o.ease ?? 'smooth' }] : [{ at: 0, rig: r }], damping: o.damping, over: o.over ?? false, seconds: o.seconds });
  },
  /** up and back as on a crane arm, from where the camera is: `up` metres higher, `back` metres farther along the
   *  ground, `swing` degrees round; or `to` the rig it ends at */
  crane(t: Aim | Target, o: Common & { up?: number; back?: number; swing?: number; to?: RigSpec } = {}): Move {
    return move({ kind: 'crane', aim: aimOf(t, 'moves.crane'), keys: [{ at: 0, rig: 'now' }, { at: 1, rig: o.to ?? { crane: [o.up ?? 30, o.back ?? 0, o.swing ?? 0] } as RigSpec, ease: o.ease ?? 'smooth' }], damping: o.damping, over: o.over ?? false, seconds: o.seconds });
  },
  /** in towards what it looks at, or out from it, along the line of sight, from where the camera is: `in` or `out`
   *  metres, or `to` a distance */
  dolly(t: Aim | Target, o: Common & { in?: number; out?: number; to?: number } = {}): Move {
    if (o.to !== undefined && !(fin(o.to) && o.to > 0)) throw new AslnutError('E-VIEW-001', `moves.dolly: to is ${o.to}`, { where: 'moves.dolly', fix: 'give to as a distance in metres above 0, or in / out' });
    return move({ kind: 'dolly', aim: aimOf(t, 'moves.dolly'), keys: [{ at: 0, rig: 'now' }, { at: 1, rig: o.to !== undefined ? { dist: o.to } : { dolly: (o.out ?? 0) - (o.in ?? 0) } as RigSpec, ease: o.ease ?? 'smooth' }], damping: o.damping, over: o.over ?? false, seconds: o.seconds });
  },
  /** round what it looks at, `degrees` clockwise seen from above (negative: the other way), from where the camera is
   *  (or from `from`), keeping its distance and tilt unless given */
  arc(t: Aim | Target, o: Common & { degrees?: number; dist?: number; tilt?: number; from?: RigSpec } = {}): Move {
    const k0: RigKey = { at: 0, rig: o.from ?? 'now' };
    return move({ kind: 'arc', aim: aimOf(t, 'moves.arc'), keys: [k0, { at: 1, rig: { arc: o.degrees ?? 90, dist: o.dist, tilt: o.tilt } as RigSpec, ease: o.ease ?? 'smooth' }], damping: o.damping, over: o.over ?? false, seconds: o.seconds });
  },
  /** from close in to the whole of it: from 'below' (low and near, rising), 'behind' (near, from behind what it faces,
   *  pulling back and up) or 'side' (near, from its side, coming round); `to` the rig it ends at (default 4 × farther,
   *  55° from straight down) */
  reveal(t: Aim | Target, o: Common & { from?: 'below' | 'behind' | 'side'; dist?: number; to?: RigSpec } = {}): Move {
    const end: RigSpec = { tilt: 55, ...o.to, dist: o.to?.dist ?? (o.dist ?? 40) }, d = end.dist!;
    const f = o.from ?? 'behind', start: RigSpec = f === 'below' ? { dist: d / 4, tilt: 84, turn: end.turn, bearing: end.bearing } : f === 'side' ? { dist: d / 4, tilt: (end.tilt ?? 55) + 15, turn: (end.turn ?? 0) + 90 } : { dist: d / 4, tilt: Math.min(80, (end.tilt ?? 55) + 20), turn: end.turn, bearing: end.bearing };
    return move({ kind: 'reveal', aim: aimOf(t, 'moves.reveal'), keys: [{ at: 0, rig: { ...start, raise: o.raise } }, { at: 1, rig: end, ease: o.ease ?? 'cinematic' }], damping: o.damping, over: o.over ?? false, seconds: o.seconds });
  },
};

/** what a move is played in: the ground and named points (the world), the world's time (ms) and the camera's lens */
export interface MoveWorld extends Ground {
  readonly timeMs: number;
  /** the highest top of what stands in a box (true metres over the sea), null: none known */
  topIn?(w: number, s: number, e: number, n: number): number | null;
}
/** a rig resolved: absolute bearing, or one from the heading */
interface Resolved { dist: number; tilt: number; bearing?: number; turn?: number; raise: number }
const shortWay = (a: number, b: number) => ((((b - a) % 360) + 540) % 360) - 180;

/** a move playing: its time, its springs, the rig it started from (its 'now' keys) */
export class Shot {
  readonly move: Move; readonly seconds: number | undefined; readonly follower: Follower;
  private t = 0; private keys: Resolved[] | null = null; private lift = 0; private liftV = 0; private lifted = false; private ease: Ease | undefined;
  constructor(m: Move, o: { seconds?: number; ease?: Ease } = {}, follower?: Follower) {
    if (o.seconds !== undefined && !(fin(o.seconds) && o.seconds >= 0)) throw new AslnutError('E-VIEW-001', `play: seconds is ${o.seconds}`, { where: `moves.${m.kind}`, fix: 'give seconds as a finite number, 0 or more, or leave it out' });
    easing(o.ease);
    this.move = m; this.seconds = o.seconds ?? m.seconds; this.ease = o.ease;
    this.follower = follower ?? new Follower(m.damping);
    if (follower && m.damping) follower.damping = m.damping;
  }
  /** the move's progress at its time t (seconds): 0..1 (no seconds: 0, it holds its first key) */
  progress(t = this.t): number { const s = this.seconds; return s === undefined ? 0 : s > 0 ? Math.min(1, t / s) : 1; }
  get done(): boolean { return this.seconds !== undefined && this.t >= this.seconds; }
  /** the keys' rigs, the 'now' ones taken from the camera (its eye round the subject) */
  private resolve(cam: { pose: Pose; groundY: number }, P: { lon: number; lat: number; y: number }, heading: number): Resolved[] {
    const out: Resolved[] = [], now = rigFrom(eyeOfPose(cam.pose, cam.groundY), P);
    let prev: Resolved = { dist: now.dist, tilt: now.tilt, raise: 0, ...(Number.isFinite(heading) ? { turn: shortWay(heading, now.bearing) } : { bearing: now.bearing }) };
    for (const k of this.move.keys) {
      if (k.rig === 'now') { out.push(prev = { ...prev }); continue; }
      const r = k.rig as RigSpec & { crane?: [number, number, number]; dolly?: number; arc?: number }, x: Resolved = { ...prev };
      if (r.crane) {
        // up and back: the eye's height and its distance along the ground from the previous key's
        const p = (90 - prev.tilt) * D, v = prev.dist * Math.sin(p) + r.crane[0], h = Math.max(0.01, prev.dist * Math.cos(p) + r.crane[1]);
        x.dist = Math.hypot(v, h); x.tilt = 90 - Math.atan2(v, h) / D;
        if (x.turn !== undefined) x.turn += r.crane[2]; else x.bearing = (x.bearing ?? 0) + r.crane[2];
      }
      if (r.dolly !== undefined) x.dist = Math.max(0.5, prev.dist + r.dolly);
      if (r.arc !== undefined) { if (x.turn !== undefined) x.turn += r.arc; else x.bearing = (x.bearing ?? 0) + r.arc; }
      if (r.dist !== undefined) x.dist = r.dist;
      if (r.tilt !== undefined) x.tilt = r.tilt;
      if (r.raise !== undefined) x.raise = r.raise;
      if (r.bearing !== undefined) { x.bearing = r.bearing; delete x.turn; }
      else if (r.turn !== undefined) { x.turn = r.turn; delete x.bearing; }
      out.push(prev = x);
    }
    return out;
  }
  /** the rig at a progress u (each key's ease into it; bearings the short way; distances on a log scale) */
  private rigAt(keys: Resolved[], u: number, heading: number): Rig {
    const ks = this.move.keys, abs = (r: Resolved) => (r.bearing !== undefined ? r.bearing : (Number.isFinite(heading) ? heading : 0) + (r.turn ?? 0));
    let i = 1; while (i < ks.length && ks[i]!.at < u) i++;
    if (i >= ks.length) { const r = keys[keys.length - 1]!; return { dist: r.dist, tilt: r.tilt, bearing: abs(r), raise: r.raise }; }
    const a = keys[i - 1]!, b = keys[i]!, ka = ks[i - 1]!.at, kb = ks[i]!.at;
    const v = kb > ka ? ease(this.ease ?? ks[i]!.ease ?? 'smooth', (u - ka) / (kb - ka)) : u >= kb ? 1 : 0;
    const ba = abs(a);
    return { dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * v), tilt: a.tilt + (b.tilt - a.tilt) * v, bearing: ba + shortWay(ba, abs(b)) * v, raise: a.raise + (b.raise - a.raise) * v };
  }
  /** the pose a frame `dt` seconds on (its springs stepped) and the ground under its centre; null: the subject is
   *  nowhere yet */
  step(dt: number, w: MoveWorld, cam: { pose: Pose; groundY: number; fov: number; floor: (h: number) => number }): { pose: Pose; ground: number } | null {
    const P = whereOf(this.move.aim.target, w, w.timeMs); if (!P) return null;
    if (this.keys) this.t += dt;
    const f = this.follower, ex = w.exaggeration ?? 1, ground = (lon: number, lat: number) => { const h = w.heightAt(lon, lat); return Number.isFinite(h) ? h * ex : NaN; };
    // (its heading: the way it goes while it moves, a log's heading being its piece's, a step at each sample; else its
    // own; else the one it had: the follower's)
    const d = f.step({ place: [P.lon, P.lat, P.y], aim: [P.lon, P.lat, P.y], heading: Number.isFinite(P.heading) ? P.heading : null }, dt, cam.pose.dist);
    const heading = d.heading ?? NaN, A = d.place!, L = d.aim!, anchor = { lon: A[0], lat: A[1], y: A[2] };
    this.keys ??= this.resolve(cam, anchor, heading);
    const rig = this.rigAt(this.keys, this.progress(), heading);
    let E = eyeOf(anchor, rig);
    // over what stands near the eye and over the ground under it (eased: up quickly, down slowly)
    const want = Math.max(0, this.need(E, w, ground) - E.y);
    // (a move's first frame starts where it must be; steps of no time after it, a recording's holds, move nothing)
    if (dt > 0) { const om = 1.678 / (want > this.lift ? 0.12 : 0.7), a = Math.exp(-om * dt), c = this.liftV + om * (this.lift - want); this.lift = want + (this.lift - want + c * dt) * a; this.liftV = (this.liftV - om * c * dt) * a; this.lifted = true; }
    else if (!this.lifted) this.lift = want;
    if (this.lift > 1e-6) E = { ...E, y: E.y + this.lift };
    const at = { lon: L[0], lat: L[1], y: L[2] }, r2 = rigFrom(E, at, (rig.raise ?? 0) + (this.move.aim.raise ?? 0));
    // (ground not loaded yet: the subject's own)
    return rigPose(at, r2, (lon, lat) => { const g = ground(lon, lat); return Number.isNaN(g) ? P.g : g; }, cam.fov, cam.floor);
  }
  /** how high the eye must stand there (world metres): over what stands near it by `over`, over the ground by 1 m */
  private need(E: { lon: number; lat: number; y: number }, w: MoveWorld, ground: (lon: number, lat: number) => number): number {
    const g = ground(E.lon, E.lat), ex = w.exaggeration ?? 1;
    let need = Number.isFinite(g) ? g + 1 : -Infinity;
    const over = this.move.over;
    if (over !== false && over !== undefined && w.topIn) {
      const r = 14, kz = 111319.49, kx = kz * Math.cos(E.lat * D), top = w.topIn(E.lon - r / kx, E.lat - r / kz, E.lon + r / kx, E.lat + r / kz);
      if (top !== null && Number.isFinite(top)) need = Math.max(need, top * ex + over);
    }
    return need;
  }
  /** the pose at the move's time t (seconds) and the world's time (ms), undamped (what a recording loads ahead: the
   *  springs change it by metres, not by tiles); null: the subject is nowhere then */
  poseAt(t: number, w: MoveWorld, cam: { pose: Pose; groundY: number; fov: number; floor: (h: number) => number }, timeMs = w.timeMs): Pose | null {
    const P = whereOf(this.move.aim.target, w, timeMs); if (!P) return null;
    const keys = this.keys ?? this.resolve(cam, P, P.heading);
    const rig = this.rigAt(keys, this.progress(t), P.heading), ex = w.exaggeration ?? 1;
    const ground = (lon: number, lat: number) => { const h = w.heightAt(lon, lat); return Number.isFinite(h) ? h * ex : P.g; };
    return rigPose(P, { ...rig, raise: (rig.raise ?? 0) + (this.move.aim.raise ?? 0) }, ground, cam.fov, cam.floor).pose;
  }
  /** the same thing looked at (a move after it carries its springs on) */
  sameAim(m: Move): boolean { const a = this.move.aim.target, b = m.aim.target; return a === b || (typeof a === 'object' && typeof b === 'object' && !Array.isArray(a) && !Array.isArray(b) && 'track' in a && 'track' in b && a.track === b.track && a.id === b.id); }
}
export type { Place };
