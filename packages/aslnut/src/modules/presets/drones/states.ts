// The drone's poses: rotors still (landed); flying is their spin, which the entity drives.
import type { StateSpec } from '../../../core/geometry/shapes/package.ts';

export const states: Record<string, StateSpec> = { landed: { rotor0: 0, rotor1: 0, rotor2: 0, rotor3: 0 } };
