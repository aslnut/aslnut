// modules › presets › vehicles: road vehicles as shape packages (core › geometry › shapes › recipes › package). The
// car: its silhouette all params (wheelbase, overhangs, bonnet, rake, roof, tail, clearance, wheels, arches, belt,
// glass, cladding, lamps, a load behind its cab), each type a row of them (hatch, sedan, wagon, pickup, van, bus, truck,
// suv, crossover, tractor, citybus); its presets by name; a tractor's trailer turned by its track (cars.hitch).
//   import { cars } from 'aslnut/modules/presets/vehicles'
//   w.add(entities({ id: 'fleet', shape: cars.van, data: vans, tint: (d) => d.props.colour }))
//   w.shapes.use(cars.package); w.shapes.make('car', 'pickup')
//   log.appendMany(cars.hitch(track, cars.tractor.make())) · entities({ drive: drive.data(log), shape: cars.tractor.make(), joints: { trailer: { value: 'hitch' } } })
import pkg, { car, CAR_TYPES, type CarType } from './car/shape.ts';
import { hitch, type HitchOptions, type TrackRow } from './car/hitch.ts';
import { locomotion } from '../../../core/entities/index.ts';

/** cars: make one by params (a type given brings its row), a preset as a shape (cars.pickup), the shape and its
 *  package, its default locomotion (on wheels on the ground: throttle, brake, steering by speed; top speed km/h), a
 *  tractor's track with its trailer's angle (cars.hitch) */
export const cars = {
  make: (p: Parameters<typeof car.make>[0] = {}, seed = 1) => car.make(p, seed),
  locomotion: (o: { top?: number; boost?: number; blocked?: (lon: number, lat: number) => number } = {}) => locomotion.surface({ wheels: { top: o.top ?? 50, boost: o.boost }, blocked: o.blocked }),
  hitch,
  shape: car, package: pkg, types: CAR_TYPES,
  hatch: pkg.preset('hatch'), sedan: pkg.preset('sedan'), wagon: pkg.preset('wagon'), pickup: pkg.preset('pickup'), van: pkg.preset('van'), bus: pkg.preset('bus'), truck: pkg.preset('truck'),
  suv: pkg.preset('suv'), crossover: pkg.preset('crossover'), tractor: pkg.preset('tractor'), citybus: pkg.preset('citybus'),
};
export { car, pkg as carPackage, CAR_TYPES, hitch, type CarType, type HitchOptions, type TrackRow };
