// The car's joints (core › entities › kinematics drives them): its wheels spin (the front ones steer) on their hubs, a
// radius from the wheel param, a third axle's too (a truck's, a tractor's); the front doors on hinges at their front
// edges; a tractor's trailer on a hinge at its fifth wheel (its angle: the trailer pulled along its track, hitch.ts).
import type { JointSpec } from '../../../../core/geometry/shapes/package.ts';

export const kinematics: Record<string, JointSpec> = {
  wheelFL: { part: 'wheelFL', kind: 'wheel', axis: 'x', radius: 'wheel', steer: true },
  wheelFR: { part: 'wheelFR', kind: 'wheel', axis: 'x', radius: 'wheel', steer: true },
  wheelRL: { part: 'wheelRL', kind: 'wheel', axis: 'x', radius: 'wheel' },
  wheelRR: { part: 'wheelRR', kind: 'wheel', axis: 'x', radius: 'wheel' },
  wheelML: { part: 'wheelML', kind: 'wheel', axis: 'x', radius: 'wheel' },
  wheelMR: { part: 'wheelMR', kind: 'wheel', axis: 'x', radius: 'wheel' },
  doorL: { part: 'doorL', kind: 'hinge', axis: 'y', limits: [0, 70] },
  doorR: { part: 'doorR', kind: 'hinge', axis: 'y', limits: [-70, 0] },
  trailer: { part: 'trailer', kind: 'hinge', axis: 'y', limits: [-100, 100] },
};
