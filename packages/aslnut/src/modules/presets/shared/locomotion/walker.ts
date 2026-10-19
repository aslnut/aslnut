// modules › presets › shared › locomotion › walker: a body that walks a walking network (footpaths, crossings) on
// its own: along a piece to its end, then on to a neighbouring one (not straight back, unless it is a dead end),
// keeping to one side of the path, turning smoothly, pausing now and then, drawn back toward a place when it wanders
// past a radius. Seeded: the same seed walks the same way. Any walking thing takes it: a person, a dog, a robot.
//   const e = entity({ id: 'p1', at, ...walking({ network: () => net, seed: 7, speed: 1.3 }) })
import { drive, groundOf, type Entity, type GroundWorld, type Locomotion } from '../../../../core/entities/index.ts';
import type { Network } from '../../../../core/geometry/networks/index.ts';

type LL = [number, number];
export interface WalkerOptions {
  /** the walking network (a function: it may come later, or change as the view moves) */
  network: Network<unknown> | (() => Network<unknown> | null);
  /** walking speed, m/s (default 1.35) */
  speed?: number;
  /** metres to the right of the path's middle it keeps (default 0.7; negative: the left) */
  side?: number;
  /** its own random walk (default 1) */
  seed?: number;
  /** a pause at a node now and then: the chance, and how long (s) (default 0.12, [2, 7]) */
  pause?: { chance?: number; seconds?: [number, number] };
  /** stay round a place: past `radius` metres from it, it turns toward it at the next node */
  near?: () => LL; radius?: number;
  /** how fast it turns, rad/s (default 5) */
  turn?: number;
}
interface Walk { net: Network<unknown>; a: number; b: number; s: number; L: number; ox: number; oz: number; wait: number; heading: number }
const KZ = 110574;
/** a seeded random 0…1 (mulberry32) */
export function seeded(seed: number): () => number {
  let a = seed >>> 0 || 1;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
/** the walker: a locomotion that follows the network by itself (its drive asks how fast: forward 0 … 1) */
export function walker(o: WalkerOptions): Locomotion & { /** where it is on the network (null: not on it yet) */ at(e: Entity): { a: number; b: number; s: number } | null; /** start it again on the network nearest its place */ reset(e: Entity): void } {
  const rand = seeded(o.seed ?? 1), state = new WeakMap<Entity, Walk>(), side = o.side ?? 0.7, speed = o.speed ?? 1.35, turnRate = o.turn ?? 5;
  const netOf = () => (typeof o.network === 'function' ? o.network() : o.network);
  const start = (e: Entity, net: Network<unknown>): Walk | null => {
    const n = net.nearest([e.at[0], e.at[1]], { max: 2000 }); if (!n) return null;
    const L = Math.hypot(net.xs[n.b]! - net.xs[n.a]!, net.zs[n.b]! - net.zs[n.a]!) || 1, forward = rand() < 0.5;
    // (costs are the pieces' lengths: the walking network's default)
    return { net, a: forward ? n.a : n.b, b: forward ? n.b : n.a, s: Math.min(L, forward ? n.toA : n.toB), L, ox: 0, oz: 0, wait: 0, heading: (e.heading * Math.PI) / 180 };
  };
  // the next piece from b: any neighbour but where it came from (unless there is no other), toward the place when it
  // has wandered off
  const next = (st: Walk): void => {
    const net = st.net, nb = net.adj[st.b]!, opts: number[] = [];
    for (let k = 0; k < nb.length; k += 2) if (nb[k] !== st.a) opts.push(nb[k]!);
    let to = opts.length ? opts[Math.floor(rand() * opts.length)]! : st.a;
    if (o.near && opts.length > 1) {
      const c = net.local(o.near()), bx = net.xs[st.b]!, bz = net.zs[st.b]!;
      if (Math.hypot(bx - c[0], bz - c[1]) > (o.radius ?? 250)) to = opts.reduce((best, x) => (Math.hypot(net.xs[x]! - c[0], net.zs[x]! - c[1]) < Math.hypot(net.xs[best]! - c[0], net.zs[best]! - c[1]) ? x : best), opts[0]!);
    }
    st.a = st.b; st.b = to; st.s = 0; st.L = Math.hypot(net.xs[to]! - net.xs[st.a]!, net.zs[to]! - net.zs[st.a]!) || 0.01;
    const p = o.pause ?? {}; if (rand() < (p.chance ?? 0.12)) { const [s0, s1] = p.seconds ?? [2, 7]; st.wait = s0 + rand() * (s1 - s0); }
  };
  const loco = {
    kind: 'surface' as const,
    step(e: Entity, want: { forward: number }, dt: number, w: GroundWorld) {
      const net = netOf(); if (!net) { e.speed = 0; return; }
      let st = state.get(e);
      if (!st || st.net !== net) { const s = start(e, net); if (!s) { e.speed = 0; return; } st = s; state.set(e, st); }
      let v = speed * Math.max(0, Math.min(1, want.forward));
      if (st.wait > 0) { st.wait -= dt; v = 0; }
      st.s += v * dt;
      for (let guard = 0; st.s > st.L && guard < 8; guard++) { const over = st.s - st.L; next(st); st.s = over; }
      const ax = net.xs[st.a]!, az = net.zs[st.a]!, dx = net.xs[st.b]! - ax, dz = net.zs[st.b]! - az, L = st.L, t = Math.min(1, st.s / L);
      // its side of the path: to the right of the way it goes, eased round corners (no jump at a node)
      const rx = -dz / L, rz = dx / L, k = Math.min(1, dt * 2.5);
      st.ox += (rx * side - st.ox) * k; st.oz += (rz * side - st.oz) * k;
      const [lon, lat] = net.lonLat(ax + dx * t + st.ox, az + dz * t + st.oz);
      // its heading turns toward the way it goes (degrees clockwise from north; z is south)
      const want_h = Math.atan2(dx, -dz); let d = want_h - st.heading; while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI;
      st.heading += Math.sign(d) * Math.min(Math.abs(d), turnRate * dt);
      e.velocity = [((lon - e.at[0]) * 111320 * Math.cos((lat * Math.PI) / 180)) / Math.max(dt, 1e-3), 0, (-(lat - e.at[1]) * KZ) / Math.max(dt, 1e-3)];
      e.at[0] = lon; e.at[1] = lat;
      // on what is drawn there (a footpath, a kerb, a deck: the level nearest the one it was on; the ground without)
      e.at[2] = groundOf(w, lon, lat, e.at[2]);
      e.heading = (st.heading * 180) / Math.PI; e.speed = v; e.onGround = true; e.gait += v * dt * 2.4;
    },
    at: (e: Entity) => { const st = state.get(e); return st ? { a: st.a, b: st.b, s: st.s } : null; },
    reset: (e: Entity) => { state.delete(e); },
  };
  return loco as unknown as ReturnType<typeof walker>;
}
/** an entity's walking: the walker and a drive that keeps it going (spread into entity({ … })) */
export function walking(o: WalkerOptions): { locomotion: ReturnType<typeof walker>; drive: ReturnType<typeof drive.script> } {
  return { locomotion: walker(o), drive: drive.script(() => ({ forward: 1 })) };
}
