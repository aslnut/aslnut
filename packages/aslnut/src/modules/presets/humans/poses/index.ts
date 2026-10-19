// modules › presets › humans › poses: still poses in anatomical words (poses › ops), the same on every body. Each is a
// function of the ops, so your own is one line: (o) => { o.armTo('Right', 140); o.flex('RightForeArm', 30) }.
//   rig.begin() → POSES.wave(ops) → rig.end()
import type { PoseOps } from './ops.ts';
export { HumanRig, type PoseOps } from './ops.ts';

export type Pose = (o: PoseOps) => void;
export const POSES: Readonly<Record<string, Pose>> = {
  rest: () => {},
  relaxed: (o) => { o.armTo('Left', 8); o.armTo('Right', 8); o.both(o.flex, 'ForeArm', 12); o.curl('Left', 15); o.curl('Right', 15); },
  squat: (o) => { o.both(o.abduct, 'UpLeg', 22); o.both(o.flex, 'UpLeg', 120); o.both(o.flex, 'Leg', -150); o.both(o.flex, 'Foot', -35); o.flex('Spine', 22); o.flex('Spine1', 12); o.armTo('Left', 10); o.armTo('Right', 10); o.both(o.flex, 'Arm', 55); o.both(o.flex, 'ForeArm', 55); o.flex('Neck', -15); },
  'cross-legged': (o) => { o.both(o.abduct, 'UpLeg', 45); o.both(o.flex, 'UpLeg', 80); o.both(o.twistCur, 'UpLeg', 80); o.both(o.flex, 'Leg', -145); o.both(o.flex, 'Foot', 20); o.armTo('Left', 15); o.armTo('Right', 15); o.both(o.flex, 'Arm', 35); o.both(o.flex, 'ForeArm', 45); o.flex('Spine', 6); },
  'ride-bike': (o) => { o.both(o.flex, 'UpLeg', 75); o.both(o.abduct, 'UpLeg', 14); o.both(o.flex, 'Leg', -80); o.flex('Spine', 18); o.armTo('Left', 25); o.armTo('Right', 25); o.both(o.flex, 'Arm', 62); o.both(o.flex, 'ForeArm', 25); o.curl('Left', 75, undefined, 40); o.curl('Right', 75, undefined, 40); },
  sit: (o) => { o.both(o.flex, 'UpLeg', 90); o.both(o.flex, 'Leg', -90); o.both(o.abduct, 'UpLeg', 6); o.armTo('Left', 10); o.armTo('Right', 10); o.both(o.flex, 'Arm', 35); o.both(o.flex, 'ForeArm', 45); },
  kneel: (o) => { o.both(o.flex, 'Leg', -95); o.flex('LeftUpLeg', 5); o.armTo('Left', 8); o.armTo('Right', 8); o.both(o.flex, 'ForeArm', 20); },
  'arms-up': (o) => { o.armTo('Left', 170); o.armTo('Right', 170); o.both(o.flex, 'ForeArm', 8); o.flex('Head', -10); },
  wave: (o) => { o.armTo('Left', 8); o.flex('LeftForeArm', 10); o.armTo('Right', 145); o.flex('RightForeArm', 35); o.lean('Spine1', 4); o.lean('Head', -8); },
  shy: (o) => { o.flex('Head', 22); o.lean('Head', -12); o.turn('Head', -10); o.armTo('Right', 70); o.flex('RightArm', 70); o.flex('RightForeArm', 140); o.twist('RightArm', -30); o.armTo('Left', 5); o.flex('LeftArm', 25); o.flex('LeftForeArm', 95); o.twist('LeftArm', 40); o.flex('LeftUpLeg', 8); o.abduct('LeftUpLeg', -6); o.flex('LeftLeg', -18); o.flex('Spine1', 6); },
  greet: (o) => { o.armTo('Left', 18); o.armTo('Right', 18); o.both(o.flex, 'Arm', 35); o.both(o.twist, 'Arm', 50); o.both(o.flex, 'ForeArm', 115); o.flex('Spine1', 6); o.flex('Head', 10); },
  'phone': (o) => { o.armTo('Left', 8); o.flex('LeftForeArm', 12); o.armTo('Right', 22); o.flex('RightArm', 40); o.flex('RightForeArm', 95); o.twist('RightArm', 20); o.flex('Head', 18); o.curl('Right', 40, undefined, 20); },
  'look-back': (o) => { o.turn('Spine', 15); o.turn('Spine1', 20); o.turn('Spine2', 20); o.turn('Neck', 25); o.turn('Head', 25); o.armTo('Left', 8); o.armTo('Right', 8); },
};
