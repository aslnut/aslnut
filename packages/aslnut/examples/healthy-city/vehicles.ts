// What moves in this twin, driven by aslnut's entities: the person you walk as (a walker in strides, authored here),
// a hatchback and a quadcopter (aslnut's car and drone presets: Melbourne keeps left, so the driver sits on the right);
// and a few cars of the neighbourhood driving its streets by a script (core › entities: wheels on the ground, a
// script's drive steering along a route on the walk network's roads), each in its own paint.
import { color, controllers, drive, entity, entityElement, locomotion, num, shape, type Entity, type Made, type Network, type World } from '../../src/index.ts';
import { cars as CARS } from '../../src/modules/presets/vehicles/index.ts';
import { drones } from '../../src/modules/presets/drones/index.ts';

type LL = [number, number];
/** the person: a walker in a stride (0 … 1: one leg forward … the other), arms swinging against the legs */
export const walker = shape({
  id: 'walker',
  params: { stride: num(0, 1, 0.5), shirt: color('#2f6fb0'), pants: color('#2b2f3a'), skin: color('#e0b48f') },
  far: 'box',
  build: (b, p) => {
    const sw = (p.stride * 2 - 1) * 0.8;
    b.solid('capsule', { radius: 0.2, size: 0.62, at: [0, 1.17, 0], color: p.shirt, sides: 10 });
    b.solid('sphere', { radius: 0.13, at: [0, 1.64, 0], color: p.skin, sides: 10 });
    const limb = (x: number, top: number, len: number, a: number, r: number, col: string) => b.frame({ at: [x, top, 0] }, (b) => b.within([1, 0, 0, 0, Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a), 0, 0, 0], () => b.solid('capsule', { radius: r, size: len, at: [0, -len / 2, 0], color: col, sides: 8 })));
    limb(-0.1, 0.9, 0.9, sw, 0.075, p.pants); limb(0.1, 0.9, 0.9, -sw, 0.075, p.pants);
    limb(-0.27, 1.42, 0.62, -sw * 0.8, 0.05, p.shirt); limb(0.27, 1.42, 0.62, sw * 0.8, 0.05, p.shirt);
  },
});
/** the avatar kit's shapes from these */
export const AVATAR_SHAPES = { walker: (stride: number): Made => walker.make({ stride }), car: () => CARS.make({ type: 'hatch', paint: '#b8322a', traffic: 'left' }), drone: () => drones.quad.make() };

/** a few neighbourhood cars driving the local streets: each a wheeled entity whose script steers to the next point of
 *  a route on the street network (a new route when it arrives) */
export function traffic(w: World, o: { count?: number; network: () => Network<{ cls: number }> | null; centre: () => LL; obstacle?: (lon: number, lat: number) => number }) {
  const layer = entityElement({ id: 'traffic' }), paints = ['#b8322a', '#2c5aa0', '#e6e6e6', '#2f2f33', '#c9a227', '#3d6b4f'], cars: Entity[] = [];
  const routes = new Map<string, { pts: LL[]; i: number }>();
  const pickRoute = (e: Entity) => {
    const net = o.network(); if (!net) return;
    const [lon, lat] = o.centre(), r = () => (Math.random() - 0.5) * 0.008;
    const rt = net.route([e.at[0], e.at[1]], [lon + r(), lat + r()]); if (rt && rt.line.length > 1) routes.set(e.id, { pts: rt.line, i: 1 });
  };
  const steer = (e: Entity) => {
    let rt = routes.get(e.id); if (!rt) { pickRoute(e); rt = routes.get(e.id); if (!rt) return { forward: 0 }; }
    const kx = 111320 * Math.cos((e.at[1] * Math.PI) / 180);
    let tgt = rt.pts[rt.i]!; let dx = (tgt[0] - e.at[0]) * kx, dz = -(tgt[1] - e.at[1]) * 110574;
    while (Math.hypot(dx, dz) < 6 && rt.i < rt.pts.length - 1) { rt.i++; tgt = rt.pts[rt.i]!; dx = (tgt[0] - e.at[0]) * kx; dz = -(tgt[1] - e.at[1]) * 110574; }
    if (rt.i >= rt.pts.length - 1 && Math.hypot(dx, dz) < 6) { routes.delete(e.id); return { forward: -0.3 }; }
    // the turn to the point: steer into it, slower in a sharp one
    let a = Math.atan2(dx, -dz) - (e.heading * Math.PI) / 180; while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI;
    return { forward: e.speed > (Math.abs(a) > 0.5 ? 4 : 11) ? 0 : 1, right: Math.max(-1, Math.min(1, a * 2.5)) };
  };
  const place = () => {
    const net = o.network(); if (!net || cars.length) return;
    const [lon, lat] = o.centre();
    for (let i = 0; i < (o.count ?? 8); i++) {
      const n = net.nearest([lon + (Math.random() - 0.5) * 0.006, lat + (Math.random() - 0.5) * 0.006], { max: 400 }); if (!n) continue;
      // (its paint in its build: the avatar that gets in drives the same car)
      const made = CARS.make({ type: i % 3 ? 'hatch' : 'sedan', paint: paints[i % paints.length]!, traffic: 'left' });
      const e = entity({ id: `car-${i}`, kind: 'car', at: n.at, heading: Math.random() * 360, shape: made, locomotion: locomotion.surface({ wheels: { top: 40 }, blocked: o.obstacle }), drive: drive.script(steer) });
      cars.push(e); layer.add(e);
    }
  };
  /** a car got into (by the avatar): off the street */
  const take = (id: string) => { const i = cars.findIndex((c) => c.id === id); if (i >= 0) { layer.remove(id); cars.splice(i, 1); routes.delete(id); } };
  /** a car got out of: parked where it stands (no drive) */
  const park = (v: { id: string; at: LL; heading: number; made: Made }) => { const e = entity({ id: v.id, kind: 'car', at: v.at, heading: v.heading, shape: v.made, locomotion: locomotion.surface({ wheels: { top: 40 } }) }); cars.push(e); layer.add(e); };
  return { layer, place, cars, take, park, clear: () => { for (const c of cars) layer.remove(c.id); cars.length = 0; routes.clear(); }, controllers };
}
