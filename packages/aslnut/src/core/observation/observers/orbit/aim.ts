// core › observation › observers › orbit › aim: where the camera looks. lookAt(target): a place, or a thing by its
// track (where a log says it is at the world's time), in the air or on the ground; never only the ground under the
// view's centre. The camera still orbits a point on the ground (the view's centre: its levels, its tiles, its zoom are
// the ground's), so a look at a thing is solved as the pose whose line of sight passes through it: the centre is where
// that line meets the ground beyond it.
//   lookAt([144.96, -37.81, 120])                a point (its height: metres over the sea)
//   lookAt({ lon, lat, up: 11000 })              a thing in the air (metres over the ground)
//   lookAt(track(log, 'plane', { up: altAt }))   a thing on a log, wherever the world's time puts it
//   lookAt(() => car.where(), { lead: .3 })      your function, looked at a little ahead of where it goes
import { AslnutError } from '../../../world/errors.ts';
import { D, R, wrap, type LonLatH } from '../../../space/geo.ts';
import type { Pose } from './views.ts';

/** a thing now: where it is, how high over the ground (metres), the way it faces (degrees clockwise from north) */
export interface Subject { lon: number; lat: number; /** metres over the ground (default 0) */ up?: number; heading?: number }
/** a thing on a log (core › data › history): where the log says it is at the world's time */
export interface Track { readonly track: { at(id: string, t: number): { lon: number; lat: number; heading: number; speed?: number } | null }; readonly id: string; readonly up?: number | ((lon: number, lat: number) => number) }
/** what a camera looks at or follows: a place [lon, lat, metres over the sea?], a thing ({ lon, lat, up?, heading? }),
 *  a named point (w.point), a thing on a log (track(log, id)), or your function of the world's time (ms) */
export type Target = LonLatH | Subject | string | Track | ((timeMs: number) => LonLatH | Subject | null | undefined);
/** a thing on a log, by its id: `up` its height over the ground (metres, or your function of where it is) */
export function track(log: Track['track'], id: string, o: { up?: number | ((lon: number, lat: number) => number) } = {}): Track {
  if (!log || typeof log.at !== 'function') throw new AslnutError('E-VIEW-001', 'track: not a log', { where: 'track', fix: 'track(history.log(…), id)' });
  return { track: log, id, up: o.up };
}
/** where a camera looks: its target, and how */
export interface Aim {
  readonly kind: 'look-at';
  readonly target: Target;
  /** seconds ahead of where it goes (its velocity, damped) */
  readonly lead?: number;
  /** where it sits on the screen: up from the middle, a share of half the screen's height (0.2: a little above) */
  readonly raise?: number;
}
/** look at a place or a thing (core › observation › observers › orbit › aim › look-at) */
export function lookAt(target: Target, o: { lead?: number; raise?: number } = {}): Aim {
  checkTarget(target, 'lookAt');
  for (const k of ['lead', 'raise'] as const) { const x = o[k]; if (x !== undefined && !(typeof x === 'number' && Number.isFinite(x))) throw new AslnutError('E-VIEW-001', `lookAt: ${k} is ${x}`, { where: 'lookAt', fix: `give ${k} as a finite number, or leave it out` }); }
  return { kind: 'look-at', target, lead: o.lead, raise: o.raise };
}
export function checkTarget(t: Target, where: string): void {
  const ok = typeof t === 'function' || typeof t === 'string' || (Array.isArray(t) && t.length >= 2 && Number.isFinite(t[0]) && Number.isFinite(t[1])) || (!!t && typeof t === 'object' && (('track' in t && typeof (t as Track).id === 'string') || (Number.isFinite((t as Subject).lon) && Number.isFinite((t as Subject).lat))));
  if (!ok) throw new AslnutError('E-VIEW-001', `${where}: ${JSON.stringify(t)} is not a place or a thing`, { where, fix: 'give [lon, lat, h?], { lon, lat, up?, heading? }, a point\'s name, track(log, id) or a function of the time' });
}
/** what the camera works out a look from: the ground (true metres where known, NaN where not), the exaggeration, named
 *  points (the world gives all three) */
export interface Ground { heightAt(lon: number, lat: number): number; readonly exaggeration?: number; pointAt?(name: string): LonLatH | null }
/** a target now: where it is (lon, lat), its height in the world (metres × the exaggeration, as the camera's ground),
 *  the ground's under it (0 where not known yet) and the way it faces (NaN: not known); null where it is not (yet) */
export interface Where { lon: number; lat: number; y: number; g: number; heading: number }
export function whereOf(t: Target, g: Ground, timeMs: number): Where | null {
  const ex = g.exaggeration ?? 1, ground = (lon: number, lat: number) => { const h = g.heightAt(lon, lat); return Number.isFinite(h) ? h * ex : 0; };
  let v: LonLatH | Subject | null | undefined;
  if (typeof t === 'function') v = t(timeMs);
  else if (typeof t === 'string') v = g.pointAt?.(t) ?? null;
  else if (!Array.isArray(t) && t && typeof t === 'object' && 'track' in t) {
    const s = t.track.at(t.id, timeMs); if (!s) return null;
    const up = typeof t.up === 'function' ? t.up(s.lon, s.lat) : t.up ?? 0;
    v = { lon: s.lon, lat: s.lat, up, heading: s.heading };
  } else v = t as LonLatH | Subject;
  if (!v) return null;
  if (Array.isArray(v)) {
    const [lon, lat, h] = v as LonLatH;
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    const g0 = ground(lon, lat);
    return { lon, lat, y: h !== undefined && Number.isFinite(h) ? h * ex : g0, g: g0, heading: NaN };
  }
  const s = v as Subject;
  if (!Number.isFinite(s.lon) || !Number.isFinite(s.lat)) return null;
  const g0 = ground(s.lon, s.lat);
  return { lon: s.lon, lat: s.lat, y: g0 + (Number.isFinite(s.up) ? s.up! : 0), g: g0, heading: Number.isFinite(s.heading) ? s.heading! : NaN };
}

/** where the eye is, said round what it looks at: how far (m), degrees from straight down, the way it faces (degrees
 *  clockwise from north), where the thing sits on the screen (raise: up from the middle, a share of half its height) */
export interface Rig { dist: number; tilt: number; bearing: number; raise?: number }
/** metres a degree as the world draws them (its flat map: the sphere's, R·D; east × cos lat) */
const KZ = R * D;
const kxOf = (lat: number) => KZ * Math.cos(lat * D);
/** a place `m` metres from another along a bearing (near places: the flat local frame) */
export const ahead = (lon: number, lat: number, brg: number, m: number): [number, number] => [wrap(lon + (Math.sin(brg * D) * m) / kxOf(lat)), lat + (Math.cos(brg * D) * m) / KZ];

/** the camera's pose (and the ground height under its centre, world metres) that sees a point P (its world height y)
 *  from a rig round it: the eye `dist` from P, `tilt` from straight down, facing `bearing`; P at `raise` up the screen.
 *  The centre is where the line of sight meets the ground: found again on the ground there (3 steps). `fov` is the
 *  camera's vertical field of view (radians), `floor` the least pitch it may take (radians over the horizon) for an
 *  eye that high over the centre's ground (the tilt limit by the eye's height: camera.pitchAt) */
export function rigPose(P: { lon: number; lat: number; y: number }, r: Rig, ground: (lon: number, lat: number) => number, fov: number, floor: (h: number) => number = () => 0): { pose: Pose; ground: number } {
  const t = Math.max(0, Math.min(89.99, r.tilt)), p = (90 - t) * D, d = Math.max(0.01, r.dist);
  // the eye: behind P along the bearing, up over it
  const yE = P.y + d * Math.sin(p), xE = -d * Math.cos(p);
  // the line of sight turned down by the raise (P then sits that far up the screen); never flatter than the floor
  const a = Math.atan((r.raise ?? 0) * Math.tan(fov / 2)), p1 = Math.min(Math.PI / 2 - 1e-4, p + a);
  let g = ground(P.lon, P.lat), s = 0, at: [number, number] = [P.lon, P.lat], p2 = Math.max(floor(yE - g), p1);
  for (let i = 0; i < 3; i++) {
    p2 = Math.max(floor(yE - g), p1);
    // (an eye under the ground there: the centre stays on the line at the eye's own height over P's ground)
    s = Math.max(0.01, (yE - g) / Math.sin(p2));
    at = ahead(P.lon, P.lat, r.bearing, xE + s * Math.cos(p2));
    const g2 = ground(at[0], at[1]); if (Math.abs(g2 - g) < 0.01) { g = g2; break; } g = g2;
  }
  s = Math.max(0.01, (yE - g) / Math.sin(p2));
  return { pose: { lon: at[0], lat: at[1], dist: s, bearing: ((r.bearing % 360) + 360) % 360, pitch: p2 }, ground: g };
}
/** the rig of an eye at E looking at P (both lon, lat and a world height; near each other: the flat local frame) */
export function rigFrom(E: { lon: number; lat: number; y: number }, P: { lon: number; lat: number; y: number }, raise?: number): Rig {
  const kx = kxOf(P.lat), dx = wrap(P.lon - E.lon) * kx, dy = (P.lat - E.lat) * KZ, dz = P.y - E.y, h = Math.hypot(dx, dy);
  const dist = Math.max(0.01, Math.hypot(h, dz));
  return { dist, tilt: 90 - Math.atan2(-dz, h) / D, bearing: h > 1e-6 ? ((Math.atan2(dx, dy) / D) + 360) % 360 : 0, raise };
}
/** where the eye of a rig round P is (lon, lat, world height) */
export function eyeOf(P: { lon: number; lat: number; y: number }, r: Rig): { lon: number; lat: number; y: number } {
  const p = (90 - Math.max(0, Math.min(89.99, r.tilt))) * D, at = ahead(P.lon, P.lat, r.bearing, -r.dist * Math.cos(p));
  return { lon: at[0], lat: at[1], y: P.y + r.dist * Math.sin(p) };
}
/** the eye of a camera pose (its centre's ground at `groundY`, world metres) */
export function eyeOfPose(p: Pose, groundY: number): { lon: number; lat: number; y: number } {
  const at = ahead(p.lon, p.lat, p.bearing, -p.dist * Math.cos(p.pitch));
  return { lon: at[0], lat: at[1], y: groundY + p.dist * Math.sin(p.pitch) };
}
