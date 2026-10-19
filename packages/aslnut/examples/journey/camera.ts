// The shots' cameras: the library's moves (core › observation › observers › orbit › moves: chase, track, crane and
// keyed rigs round a thing, damped as they follow it), each shot a plan of them at its own seconds; the beach's eye
// path (up over the wall, down to the sand, along the water) is this example's own, its pose solved by the library's
// look (core › observation › observers › orbit › aim: rigFrom, rigPose).
import { rigFrom, rigPose, type Move, type Pose, type World } from '../../src/index.ts';

const D = Math.PI / 180, KZ = 6378137 * D;
const kxOf = (lat: number) => KZ * Math.cos(lat * D);
/** smoothstep: the shots' ease (their reel's look) */
export const ease = (k: number) => { const t = Math.max(0, Math.min(1, k)); return t * t * (3 - 2 * t); };
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** a point `m` metres from a place along a bearing */
export const offset = (lon: number, lat: number, brg: number, m: number): [number, number] => [lon + (Math.sin(brg * D) * m) / kxOf(lat), lat + (Math.cos(brg * D) * m) / KZ];
/** a move a shot plays from its `at` second, for its `seconds` (unset: until the next one) */
export interface Plan { at: number; move: Move; seconds?: number }
/** the pose from an eye [lon, lat, m over the ground] towards a point [lon, lat, m over the ground]: the eye stays,
 *  the view turns (no flatter than the tilt limit lets an eye that high look) */
export function from(w: World, eye: [number, number, number], at: [number, number, number]): { pose: Pose; ground: number } {
  const ex = w.exaggeration, g = (lon: number, lat: number) => { const h = w.heightAt(lon, lat); return Number.isFinite(h) ? h * ex : 0; };
  const E = { lon: eye[0], lat: eye[1], y: g(eye[0], eye[1]) + eye[2] }, P = { lon: at[0], lat: at[1], y: g(at[0], at[1]) + at[2] };
  return rigPose(P, rigFrom(E, P), g, w.camera.fov, (h) => w.camera.pitchAt(h));
}
