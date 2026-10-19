// modules › presets › drones: multirotor drones as a shape package (core › geometry › shapes › recipes › package):
// rotors (4 to 8), span, a payload; presets quad, survey, hexa, cargo.
//   import { drones } from 'aslnut/modules/presets/drones'
//   w.add(entityElement({ id: 'air' })).add(entity({ id: 'd1', shape: drones.make({ rotors: 6 }), locomotion: air() }))
import pkg, { drone } from './shape.ts';
import { kinematicsFor } from './kinematics.ts';
import { locomotion } from '../../../core/entities/index.ts';

/** drones: make one by params, a preset as a shape (drones.hexa), the shape and its package; a drone of n rotors'
 *  joints (kinematicsFor(n)); its default locomotion (in the air, hovering, under a ceiling: m) */
export const drones = {
  make: (p: Parameters<typeof drone.make>[0] = {}, seed = 1) => drone.make(p, seed),
  locomotion: (o: { ceiling?: number; speed?: number } = {}) => locomotion.air({ ceiling: o.ceiling ?? 120, speed: o.speed, hover: true }),
  shape: drone, package: pkg, kinematicsFor,
  quad: pkg.preset('quad'), survey: pkg.preset('survey'), hexa: pkg.preset('hexa'), cargo: pkg.preset('cargo'),
};
export { drone, pkg as dronePackage };
