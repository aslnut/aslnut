// The drone's joints (core › entities › kinematics drives them): each rotor spins round the vertical on its motor.
import type { JointSpec } from '../../../core/geometry/shapes/package.ts';

/** the joints of a drone of n rotors (rotor0 … rotor{n−1}) */
export const kinematicsFor = (n: number): Record<string, JointSpec> => Object.fromEntries(Array.from({ length: n }, (_, i) => [`rotor${i}`, { part: `rotor${i}`, kind: 'wheel' as const, axis: 'y' as const, radius: 'span' }]));
/** the default drone's (four rotors): a package's kinematics are its default build's */
export const kinematics = kinematicsFor(4);
