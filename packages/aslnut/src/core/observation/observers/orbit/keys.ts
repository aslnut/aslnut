// core › render › camera › keys: views a person sets at times, with an easing preset and a path into each. Pure: the view at t
// depends only on t and the keys, so frames can be computed in any order and a capture is exact. (Shots, the
// composed moves of a storyteller, are built on top of this by tools that use aslnut.)
//   const k = keys([{ at: 0, view: globe }, { at: 6, view: bandung, ease: 'cinematic', path: 'arc' }]);
//   k.at(3.2) → a view · k.duration → 6 · w.camera.play(k)
import { AslnutError } from '../../../world/errors.ts';
import { ease, type Ease } from './ease.ts';
import { leg, poseOf, viewOf, type Pose, type View } from './views.ts';

export const PATHS = ['direct', 'arc', 'around'] as const;
export type Path = (typeof PATHS)[number];
export interface Key {
  /** seconds */
  at: number;
  view: View;
  /** how the camera arrives at this key (default smooth) */
  ease?: Ease;
  /** the way it travels from the previous key (default arc: up and over when far) */
  path?: Path;
  /** for path 'around': whole turns round the centre on the way */
  turns?: number;
}
export interface Keys {
  readonly list: readonly Key[];
  readonly duration: number;
  /** the camera pose at t seconds (clamped to the first / last key) */
  pose(t: number): Pose;
  /** the view at t seconds */
  at(t: number): Required<View>;
}

export function keys(list: Key[]): Keys {
  if (!list.length) throw new AslnutError('E-VIEW-001', 'camera keys: the list is empty', { fix: 'give at least one { at, view }' });
  list.forEach((k, i) => {
    if (typeof k.at !== 'number' || !Number.isFinite(k.at)) throw new AslnutError('E-VIEW-001', `camera key ${i}: 'at' must be seconds (a number)`, { where: `keys[${i}]` });
    if (i && k.at < list[i - 1]!.at) throw new AslnutError('E-VIEW-001', `camera key ${i} (at ${k.at}) comes before key ${i - 1} (at ${list[i - 1]!.at})`, { where: `keys[${i}]`, fix: 'sort the keys by time' });
    if (k.path && !PATHS.includes(k.path)) throw new AslnutError('E-VIEW-001', `camera key ${i}: unknown path '${k.path}'`, { where: `keys[${i}]`, fix: `use ${PATHS.join(', ')}` });
    if (k.turns !== undefined && !(typeof k.turns === 'number' && Number.isFinite(k.turns))) throw new AslnutError('E-VIEW-001', `camera key ${i}: turns is ${k.turns}`, { where: `keys[${i}]`, fix: 'give whole turns round the centre as a finite number (1, -2), or leave it out' });
    ease(k.ease, 0.5);   // an unknown ease throws here, not mid-flight
  });
  const poses = list.map((k, i) => { try { return poseOf(k.view); } catch (e) { throw new AslnutError('E-VIEW-001', `camera key ${i}: ${(e as Error).message}`, { where: `keys[${i}]`, cause: e }); } });
  const pose = (t: number): Pose => {
    if (t <= list[0]!.at) return poses[0]!;
    const n = list.length - 1;
    if (t >= list[n]!.at) return poses[n]!;
    let i = 1; while (list[i]!.at < t) i++;
    const a = list[i - 1]!, b = list[i]!, u = b.at > a.at ? (t - a.at) / (b.at - a.at) : 1;
    return leg(poses[i - 1]!, poses[i]!, ease(b.ease, u), b.path ?? 'arc', b.turns ?? 1);
  };
  return { list, duration: list[list.length - 1]!.at - list[0]!.at, pose, at: (t) => viewOf(pose(t)) };
}
