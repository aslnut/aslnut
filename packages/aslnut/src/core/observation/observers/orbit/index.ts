// core › observation › observers › orbit: views, keys, easing, paths, aim, follow (its damping), moves
export { Camera } from './camera.ts';
export type { FlyOptions } from './camera.ts';
export { Flight, leg, legCost, poseOf, viewOf, checkView, TILT_MAX, TILT_LIMIT, tiltMaxAt, pitchFloor } from './views.ts';
export type { View, Pose, TiltLimit } from './views.ts';
export { keys, PATHS } from './keys.ts';
export type { Key, Keys, Path } from './keys.ts';
export { ease, easing, cubicBezier, spring, presetCurve, EASES, EASE_PRESETS, PRESET_NOTES } from './ease.ts';
export type { Ease } from './ease.ts';
export { Follower, DAMPING, HALF_LIFE_K, springStep, checkDamping } from './follow.ts';
export type { Damping, Spring, FollowTargets, Followed } from './follow.ts';
export { lookAt, track, rigPose, rigFrom, whereOf } from './aim.ts';
export type { Aim, Target, Track, Subject, Rig } from './aim.ts';
export { moves, move, Shot } from './moves.ts';
export type { Move, RigKey, RigSpec, MoveWorld } from './moves.ts';
