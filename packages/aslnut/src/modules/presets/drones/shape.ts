// modules › presets › drones: a multirotor drone as a shape package. Its rotors (4 to 8) stand on arms round a body
// sized by its span (rotor tip to rotor tip, across); each rotor is a part on its motor (blades and a blurred disc:
// they spin, their joints in kinematics.ts); landing legs with feet; a camera on a gimbal under its nose (an anchor
// a view can ride: 'camera'); a payload box below when it carries one ('payload', a grip). It faces +z, its foot at
// the ground.
//   drones.make({ rotors: 6 }) · drones.cargo.make() · entity({ shape: drones.make({ rotors: 6 }), locomotion: air() })
import { shape, int, num, flag, color, type ParamsOf } from '../../../core/geometry/shapes/shape.ts';
import { shapePackage } from '../../../core/geometry/shapes/package.ts';
import info from './shape.json' with { type: 'json' };
import presets from './presets.json' with { type: 'json' };
import { kinematics } from './kinematics.ts';
import { states } from './states.ts';

export const drone = shape({
  id: 'drone',
  params: { rotors: int(4, 8, 4), span: num(0.3, 2, 0.6), payload: flag(false), body: color('#e5e7eb'), arms: color('#374151') },
  budget: { whole: 2400, simple: 1000 },
  simple: true, far: 'box',
  build: (b, p) => {
    // an odd count would stand lopsided: 4, 6 or 8
    const n = Math.max(4, Math.min(8, Math.round(p.rotors / 2) * 2)), S = p.span, R = S / 2, prop = Math.min(R * Math.sin(Math.PI / n) * 0.95, R * 0.45), arm = R - prop * 0.15;
    const legH = S * 0.22, bodyY = legH + S * 0.06, bw = S * 0.36, bl = S * 0.48, bh = S * 0.13, armY = bodyY + bh * 0.25;
    b.solid('box', { size: [bw, bh, bl], at: [0, bodyY, 0], color: p.body, material: 'painted', round: Math.min(bw, bh) * 0.3, tint: true });
    b.solid('box', { size: [bw * 0.7, bh * 0.25, bl * 0.6], at: [0, bodyY + bh * 0.6, -bl * 0.05], color: p.arms, detail: 1 });
    // a lamp at each arm's end (green right, red left, white behind: lit from dusk)
    for (let i = 0; i < n; i++) {
      const a = ((i + 0.5) / n) * Math.PI * 2, x = Math.sin(a) * arm, z = Math.cos(a) * arm, mx = Math.sin(a) * R * 0.98, mz = Math.cos(a) * R * 0.98;
      b.sweep({ circle: S * 0.022, sides: 6 }, [[Math.sin(a) * bw * 0.3, armY, Math.cos(a) * bl * 0.3], [x, armY + S * 0.02, z]], { color: p.arms });
      b.solid('cylinder', { radius: S * 0.05, size: S * 0.08, at: [x, armY + S * 0.05, z], color: '#1f2937', detail: 1 });
      b.solid('box', { size: [S * 0.03, S * 0.02, S * 0.03], at: [x, armY - S * 0.012, z], color: z < -0.2 * R ? '#ffffff' : x > 0 ? '#c01010' : '#10c040', lamps: 'tail', detail: 0 });
      // the rotor: two blades and its disc (seen spinning), a part on its motor
      const hub: [number, number, number] = [x, armY + S * 0.1, z];
      b.part(`rotor${i}`, (b) => {
        b.solid('box', { size: [prop * 2, S * 0.006, S * 0.035], at: hub, turn: (i * 47) % 180, color: '#111827', detail: 1 });
        b.solid('cylinder', { radius: prop, size: S * 0.004, at: [hub[0], hub[1] + S * 0.004, hub[2]], color: '#9ca3af', material: 'glass', detail: 1 });
      }, { pivot: hub, joint: { kind: 'wheel', axis: 'y', radius: prop } });
      void mx; void mz;
    }
    // the legs and their feet
    for (const s of [-1, 1]) {
      b.sweep({ circle: S * 0.014, sides: 5 }, [[s * bw * 0.3, bodyY - bh * 0.4, bl * 0.2], [s * bw * 0.55, 0.01, bl * 0.28]], { color: p.arms, detail: 1 });
      b.sweep({ circle: S * 0.014, sides: 5 }, [[s * bw * 0.3, bodyY - bh * 0.4, -bl * 0.2], [s * bw * 0.55, 0.01, -bl * 0.28]], { color: p.arms, detail: 1 });
      b.sweep({ circle: S * 0.016, sides: 5 }, [[s * bw * 0.55, 0.01, bl * 0.36], [s * bw * 0.55, 0.01, -bl * 0.36]], { color: p.arms, detail: 0 });
      b.anchor(`foot${s > 0 ? 'L' : 'R'}`, [s * bw * 0.55, 0, 0], { kind: 'foot' });
    }
    // the camera on its gimbal under the nose
    const cam: [number, number, number] = [0, bodyY - bh * 0.62, bl * 0.42];
    b.solid('sphere', { radius: S * 0.045, at: cam, color: '#111111', material: 'glass', sides: 10 });
    b.solid('box', { size: [S * 0.03, bh * 0.4, S * 0.03], at: [0, bodyY - bh * 0.42, bl * 0.42], color: p.arms, detail: 0 });
    b.anchor('camera', cam);
    if (p.payload) {
      b.solid('box', { size: [bw * 0.8, legH * 0.55, bl * 0.6], at: [0, legH * 0.42, 0], color: '#a0743f', round: S * 0.01 });
      b.anchor('payload', [0, legH * 0.15, 0], { kind: 'grip' });
    }
  },
});
/** the drone as a package: its info (shape.json), presets (presets.json), kinematics (the default four rotors) and states */
const pkg = shapePackage({ info, shape: drone, presets: presets as Record<string, Partial<ParamsOf<NonNullable<typeof drone.spec.params>>>>, kinematics, states });
export default pkg;
