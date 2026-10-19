// core › observation › observers › orbit › follow: the damping a camera follows a moving thing by. One critically
// damped spring per channel (the place followed, the aim, the distance, the heading), each its own half-life (or
// stiffness), integrated exactly over each step on the world's clock (the target taken as moving straight between two
// frames): the same camera at 30, 60 or 144 frames a second, and in a capture that steps the clock. Per channel a dead
// zone (a target's small moves do not move the camera), a look-ahead along its velocity (the place), a top speed; the
// heading wraps (the short way round); a jump farther than `snap` in one step (a teleport, a cut) is taken at once,
// never swung through.
//   const f = new Follower({ place: { halfLife: .3, lead: .2 }, heading: { halfLife: .6, deadZone: 1 } })
//   const d = f.step({ place: [lon, lat, h], heading: 87 }, dt)   → d.place, d.heading (damped)
// w.follow(target, { damping }) and every camera move (core › observation › observers › orbit › moves) use it.
import { AslnutError } from '../../../world/errors.ts';
import { D, R, wrap } from '../../../space/geo.ts';

/** ω·t at which a critically damped spring let go from rest has closed half its gap: (1 + x) e^-x = ½ */
export const HALF_LIFE_K = 1.6783469900166608;
/** one channel's damping (each unset part costs nothing) */
export interface Spring {
  /** seconds the camera takes to close half the gap to a target that stopped (critically damped: no overshoot); 0:
   *  none, the camera takes the target as it is */
  halfLife?: number;
  /** the spring's stiffness ω² (1/s², critically damped) in place of a half-life: halfLife = 1.678 / √stiffness */
  stiffness?: number;
  /** a move of the target smaller than this does not move the camera (metres; degrees for the heading) */
  deadZone?: number;
  /** the fastest the camera follows (metres a second; degrees a second for the heading); unset: no limit */
  maxSpeed?: number;
}
/** how a camera follows a moving thing: a spring per channel, and when it cuts instead */
export interface Damping {
  /** where the camera stands round what it follows (w.follow: the view's centre); `lead`: seconds ahead along the
   *  target's velocity (its velocity damped as the place is; default: the spring's own lag, 1.19 × its half-life, so a
   *  thing going steadily is followed with no lag at all, and only its bumps and turns are smoothed; 0: it lags) */
  place?: Spring & { lead?: number };
  /** where it looks (a thing in the air: that point, not the ground under it); `lead` as the place's. Unset: the
   *  place's own spring, so where the camera stands and where it looks move as one (a rig held round the thing: only
   *  its heading turns the view; two springs apart would swing the view at every bump between them) */
  aim?: Spring & { lead?: number };
  /** how far it stands (damped on a log scale: a zoom feels even) */
  dist?: Spring;
  /** the way it faces (degrees, the short way round); `from`: 'motion' (default: the way the thing goes, its damped
   *  velocity's, while it moves faster than 0.5 m/s; the thing's own heading while it stands) or 'thing' (always its
   *  own heading: a thing that goes sideways, a car reversing seen from its front) */
  heading?: Spring & { from?: 'motion' | 'thing' };
  /** a target that jumps farther than this in one step (metres): the camera cuts to it instead of swinging (default
   *  twice the camera's distance from what it follows; false: never) */
  snap?: number | false;
}
/** the damping a follow and the moves use when none is given (one realistic setting, measured on a chased car and a
 *  plane: tools/camera-jitter.mjs) */
export const DAMPING: Readonly<{ place: Spring & { lead?: number }; aim: Spring & { lead?: number }; dist: Spring; heading: Spring & { from: 'motion' | 'thing' } }> = Object.freeze({
  place: Object.freeze({ halfLife: 0.35 }),
  aim: Object.freeze({ halfLife: 0.35 }),
  dist: Object.freeze({ halfLife: 0.4 }),
  heading: Object.freeze({ halfLife: 0.7, deadZone: 0.5, from: 'motion' as const }),
});

const fin = (x: unknown) => typeof x === 'number' && Number.isFinite(x);
/** a damping's numbers checked once (where it comes in): a NaN in a spring would be a NaN camera every frame */
export function checkDamping(d: Damping | undefined, where = 'damping'): void {
  if (d === undefined) return;
  if (!d || typeof d !== 'object') throw new AslnutError('E-VIEW-001', `${where}: ${JSON.stringify(d)} is not a damping`, { where, fix: 'give { place, aim, dist, heading } springs ({ halfLife: seconds }), or leave it out' });
  for (const k of ['place', 'aim', 'dist', 'heading'] as const) {
    const s = d[k] as (Spring & { lead?: number }) | undefined; if (s === undefined) continue;
    for (const p of ['halfLife', 'stiffness', 'deadZone', 'maxSpeed', 'lead'] as const) {
      const x = s[p]; if (x === undefined) continue;
      if (!(fin(x) && x >= 0)) throw new AslnutError('E-VIEW-001', `${where}: ${k}.${p} is ${x}`, { where, fix: `give ${k}.${p} as a finite number, 0 or more, or leave it out` });
    }
  }
  if (d.heading?.from !== undefined && d.heading.from !== 'motion' && d.heading.from !== 'thing') throw new AslnutError('E-VIEW-001', `${where}: heading.from is ${JSON.stringify(d.heading.from)}`, { where, fix: "give heading.from as 'motion' (the way it goes) or 'thing' (its own heading), or leave it out" });
  if (d.snap !== undefined && d.snap !== false && !(fin(d.snap) && d.snap > 0)) throw new AslnutError('E-VIEW-001', `${where}: snap is ${d.snap}`, { where, fix: 'give snap in metres above 0, false (never), or leave it out' });
}
/** ω of a spring (0: no damping) */
export function omegaOf(s: Spring | undefined): number {
  if (!s) return 0;
  if (s.stiffness !== undefined) return Math.sqrt(s.stiffness);
  return s.halfLife ? HALF_LIFE_K / s.halfLife : 0;
}

/** one step of a critically damped spring (x, v) towards a target moving straight from g0 to g1 over dt seconds:
 *  exact (x'' = ω²(g − x) − 2ωx'), so many small steps land where one long step does. Returns [x, v] */
export function springStep(x: number, v: number, g0: number, g1: number, dt: number, w: number): [number, number] {
  if (!(dt > 0)) return [x, v];
  const gv = (g1 - g0) / dt;
  if (!(w > 0)) return [g1, gv];
  // the error from where a spring chasing a steady target settles (2·gv/ω behind it)
  const e0 = x - (g0 - (2 * gv) / w), de0 = v - gv, a = Math.exp(-w * dt), c = de0 + w * e0;
  return [g1 - (2 * gv) / w + (e0 + c * dt) * a, gv + (de0 - w * c * dt) * a];
}

/** a damped value of n numbers (a place in metres, an angle, a log distance): its spring, dead zone and top speed */
class Channel {
  x: number[] = []; v: number[] = []; goal: number[] = []; on = false;
  /** n numbers; `eps`: how near its goal (and how slow) counts as there (it rests there: a still target draws nothing
   *  more once the camera has arrived) */
  readonly n: number; readonly eps: number;
  constructor(n: number, eps = 1e-3) { this.n = n; this.eps = eps; }
  reset(): void { this.on = false; }
  /** start at a value, at rest (or moving at `v`) */
  start(g: readonly number[], v?: readonly number[]): void { this.x = [...g]; this.goal = [...g]; this.v = v ? [...v] : g.map(() => 0); this.on = true; }
  /** a step towards `g` (in the channel's own units, relative to nothing: the caller gives a frame); returns x */
  step(g: readonly number[], dt: number, s: Spring | undefined, w: number): number[] {
    if (!this.on) { this.start(g); return this.x; }
    // the dead zone: the goal moves only when the target leaves its circle round it (then the target is on its edge)
    const g0 = this.goal, dz = s?.deadZone ?? 0;
    let g1 = [...g];
    if (dz > 0) {
      let d2 = 0; for (let i = 0; i < this.n; i++) d2 += (g[i]! - g0[i]!) ** 2;
      const d = Math.sqrt(d2);
      g1 = d <= dz ? [...g0] : g0.map((a, i) => a + ((g[i]! - a) * (d - dz)) / d);
    }
    const x0 = [...this.x];
    for (let i = 0; i < this.n; i++) [this.x[i], this.v[i]] = springStep(this.x[i]!, this.v[i]!, g0[i]!, g1[i]!, dt, w);
    // the top speed: no faster than it over the step (and its velocity kept under it)
    const top = s?.maxSpeed;
    if (top !== undefined && dt > 0) {
      let m2 = 0; for (let i = 0; i < this.n; i++) m2 += (this.x[i]! - x0[i]!) ** 2;
      const m = Math.sqrt(m2), most = top * dt;
      if (m > most) for (let i = 0; i < this.n; i++) this.x[i] = x0[i]! + ((this.x[i]! - x0[i]!) * most) / m;
      let s2 = 0; for (let i = 0; i < this.n; i++) s2 += this.v[i]! ** 2;
      const sp = Math.sqrt(s2); if (sp > top) for (let i = 0; i < this.n; i++) this.v[i] = (this.v[i]! * top) / sp;
    }
    this.goal = g1;
    // arrived: at its goal and still (a spring never quite gets there; the camera rests once it is within eps)
    let far = 0, fast = 0; for (let i = 0; i < this.n; i++) { far = Math.max(far, Math.abs(this.x[i]! - g1[i]!)); fast = Math.max(fast, Math.abs(this.v[i]!)); }
    if (far < this.eps && fast < this.eps * 4 && g1.every((a, i) => a === g0[i])) { this.x = [...g1]; this.v = this.v.map(() => 0); }
    return this.x;
  }
  /** move the whole channel by d (its frame moved: the place's metres re-centred on where it is now) */
  shift(d: readonly number[]): void { for (let i = 0; i < this.n; i++) { this.x[i] = this.x[i]! - d[i]!; this.goal[i] = this.goal[i]! - d[i]!; } }
}

/** a place: lon, lat (degrees) and a height (metres: over the sea or over the ground, as the caller keeps it) */
export type Place = readonly [number, number, number];
/** what a follower is given each step: any of its channels (what is left out keeps no state). `heading`: the thing's
 *  own heading, or null (a heading is wanted, the thing has none of its own: the way it goes, else the last) */
export interface FollowTargets { place?: Place; aim?: Place; dist?: number; heading?: number | null }
/** what it gives back: each channel given, damped; `cut` when this step snapped (a jump: the camera cut to it) */
export interface Followed { place?: [number, number, number]; aim?: [number, number, number]; dist?: number; heading?: number; cut: boolean; /** the place's damped velocity, metres a second east, north, up */ velocity: [number, number, number] }

/** metres a degree as the world draws them (its flat map: the sphere's, R·D; east × cos lat) */
const KZ = R * D;
const kxOf = (lat: number) => KZ * Math.cos(lat * D);
/** metres east, north, up from a to b */
const metresTo = (a: Place, b: Place): [number, number, number] => [wrap(b[0] - a[0]) * kxOf(a[1]), (b[1] - a[1]) * KZ, b[2] - a[2]];

/** the springs of a follow: each step, the targets in, the camera's damped values out (core › observation › observers
 *  › orbit › follow). `scale` is the camera's distance from what it follows (metres): the snap's default */
export class Follower {
  damping: Damping;
  private place = new Channel(3); private aim = new Channel(3); private dist = new Channel(1, 1e-5); private heading = new Channel(1, 1e-3);
  /** each place channel's frame: the place (lon, lat, h) its metres are counted from */
  private origin: { place: Place | null; aim: Place | null } = { place: null, aim: null };
  /** the place's target velocity (metres a second), damped as the place is: what `lead` looks ahead along */
  private vel = new Channel(3, 1e-3); private trackAt: Place | null = null; private lastTarget: { place: Place | null; aim: Place | null } = { place: null, aim: null };
  constructor(d: Damping = {}) { checkDamping(d, 'damping'); this.damping = d; }
  /** forget every channel: the next step starts on its targets, at rest */
  reset(): void { this.place.reset(); this.aim.reset(); this.dist.reset(); this.heading.reset(); this.vel.reset(); this.trackAt = null; this.origin = { place: null, aim: null }; this.lastTarget = { place: null, aim: null }; }
  /** start channels where the camera is now (at rest): the first step goes from there to the targets on the springs
   *  (a follow that begins away from its thing glides over, never cut; a gap past the snap still is) */
  seed(t: FollowTargets): void {
    for (const k of ['place', 'aim'] as const) { const g = t[k]; if (g) { this.origin[k] = g; this[k].start([0, 0, 0]); this.lastTarget[k] = null; } }
    if (t.dist !== undefined) this.dist.start([Math.log(Math.max(1e-3, t.dist))]);
    if (typeof t.heading === 'number') this.heading.start([t.heading]);
  }
  /** is a channel under way (started) */
  has(k: 'place' | 'aim' | 'dist' | 'heading'): boolean { return this[k].on; }
  /** where the heading comes from: the thing's motion, or its own */
  get headingFrom(): 'motion' | 'thing' { return this.damping.heading?.from ?? DAMPING.heading.from; }
  private spring<K extends 'place' | 'aim' | 'dist' | 'heading'>(k: K): Spring & { lead?: number } {
    // (the aim unset: the place's, given or not)
    if (k === 'aim' && !this.damping.aim) return this.spring('place');
    const own = this.damping[k] as (Spring & { lead?: number }) | undefined, def = DAMPING[k] as Spring & { lead?: number };
    // (a spring given in part: its unset parts are the default's; a stiffness given wins over the default half-life)
    return own ? { ...def, ...(own.stiffness !== undefined && own.halfLife === undefined ? { halfLife: undefined } : {}), ...own } : def;
  }
  /** one step of `dt` seconds (0: nothing moves) */
  step(t: FollowTargets, dt: number, scale = 100): Followed {
    const out: Followed = { cut: false, velocity: [0, 0, 0] };
    const snapAt = this.damping.snap === false ? Infinity : this.damping.snap ?? Math.max(1, 2 * scale);
    // the target's velocity (metres a second), damped as the place is: the velocity of a spring that tracks the target
    // itself (exact as the place's, so the same at any frame rate); what a look ahead and a heading from the motion
    // go by (it never jumps; after a start or a cut it grows from 0)
    const g0 = t.place ?? t.aim, last0 = t.place ? this.lastTarget.place : this.lastTarget.aim, trk = this.vel;
    if (!g0) { trk.reset(); this.trackAt = null; }
    else if (!trk.on || !last0 || !this.trackAt || Math.hypot(...metresTo(last0, g0)) > snapAt) { trk.start([0, 0, 0]); this.trackAt = g0; }
    else {
      const o = this.trackAt, at: Place = [o[0] + trk.x[0]! / kxOf(o[1]), o[1] + trk.x[1]! / KZ, o[2] + trk.x[2]!];
      trk.shift(trk.x.slice()); this.trackAt = at;
      const rel = metresTo(at, g0);
      trk.step(rel, dt, undefined, omegaOf(this.spring(t.place ? 'place' : 'aim')) || HALF_LIFE_K / 0.25);
    }
    const v = trk.on ? trk.v : [0, 0, 0];
    out.velocity = [v[0]!, v[1]!, v[2]!];
    for (const k of ['place', 'aim'] as const) {
      const g = t[k]; if (!g) { if (this[k].on) { this[k].reset(); this.origin[k] = null; this.lastTarget[k] = null; } continue; }
      const sp = this.spring(k), ch = this[k], last = this.lastTarget[k];
      // a jump: the camera cuts to it (a seeded start: the gap from where the camera is, unless it is past the snap)
      const jump = last ? Math.hypot(...metresTo(last, g)) : ch.on && this.origin[k] ? Math.hypot(...metresTo(this.origin[k]!, g)) : 0;
      if (!ch.on || jump > snapAt) { if (ch.on) out.cut = true; this.origin[k] = g; ch.start([0, 0, 0]); this.lastTarget[k] = g; out[k] = [g[0], g[1], g[2]]; continue; }
      // the frame: metres from where the channel is now (re-centred every step, so its numbers stay small anywhere)
      const o = this.origin[k]!, at: Place = [o[0] + ch.x[0]! / kxOf(o[1]), o[1] + ch.x[1]! / KZ, o[2] + ch.x[2]!];
      ch.shift(ch.x.slice()); this.origin[k] = at;
      // (unset: the spring's own lag, 2 / ω: a steady target is followed exactly)
      const om = omegaOf(sp), ahead = sp.lead ?? (om > 0 ? 2 / om : 0), rel = metresTo(at, g);
      const x = ch.step([rel[0] + v[0]! * ahead, rel[1] + v[1]! * ahead, rel[2] + v[2]! * ahead], dt, sp, om);
      out[k] = [at[0] + x[0]! / kxOf(at[1]), at[1] + x[1]! / KZ, at[2] + x[2]!];
      this.lastTarget[k] = g;
    }
    if (t.dist !== undefined) {
      const sp = this.spring('dist'), ch = this.dist, l = Math.log(Math.max(1e-3, t.dist));
      if (!ch.on || (out.cut && this.damping.snap !== false)) ch.start([l]);
      else {
        // (the dead zone and the top speed in metres, the spring on the log scale)
        const at = Math.exp(ch.x[0]!), dz = sp.deadZone, top = sp.maxSpeed;
        ch.step([l], dt, { deadZone: dz ? dz / at : 0, maxSpeed: top !== undefined ? top / at : undefined }, omegaOf(sp));
      }
      out.dist = Math.exp(ch.x[0]!);
    } else this.dist.reset();
    // the heading: the way the thing goes while it moves (this step's damped velocity: no frame's delay), else its own,
    // else the one it had
    const moving = Math.hypot(v[0]!, v[1]!) > 0.5, hd = t.heading === undefined ? undefined
      : moving && (this.headingFrom === 'motion' || t.heading === null) ? ((Math.atan2(v[0]!, v[1]!) / D) + 360) % 360
      : t.heading !== null ? t.heading : this.heading.on ? this.heading.goal[0]! : undefined;
    if (hd !== undefined) {
      const sp = this.spring('heading'), ch = this.heading;
      if (!ch.on || out.cut) ch.start([hd]);
      // (the target the short way round from where the camera faces: the spring never turns the long way)
      else ch.step([ch.x[0]! + (((hd - ch.x[0]!) % 360) + 540) % 360 - 180], dt, sp, omegaOf(sp));
      // (kept near 0..360: an endless turn never loses precision)
      if (Math.abs(ch.x[0]!) > 3600) { const k = Math.round(ch.x[0]! / 360) * 360; ch.shift([k]); }
      out.heading = ((ch.x[0]! % 360) + 360) % 360;
    } else if (t.heading === undefined) this.heading.reset();
    return out;
  }
}
