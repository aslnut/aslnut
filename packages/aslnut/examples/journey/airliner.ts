// This example's own airliner (not a preset of aslnut's: an app's design, made with the shape builder): a neutral
// white twin-jet, 38 m long with a 36 m span, its parts in metres (its front +z, its main gear's foot at the ground).
// Three levels: whole (its fuselage round, its windows, its gear), simple (fewer sides, no windows or gear), and far
// a symbol (its outline seen from above and from the side, flat: it reads at any angle as a plane). Its range on
// screen keeps it 22 px across at the least: far away it stays a plane you can see ("fixed pixel"), near it is its
// metres. Its main gear is where it turns (MAIN_GEAR: the set's attitude pivot): its nose up as it rotates and climbs,
// a little up as it flares, by its log's `pitch`; banked into its turns.
import { num, shape, type V3 } from '../../src/index.ts';

const WHITE = '#f4f6f8', WING = '#d9dde2', DARK = '#3b4249', GLASS = '#1d2733', METAL = '#9aa1a8';
/** the fuselage's middle height over the ground (on its gear), its radius, its nose and tail */
const Y = 3.1, RAD = 1.95, NOSE = 19, TAIL = -19, GEAR_Z = -1.2;
/** where it turns (its main gear's foot, m): what a set's attitude turns it about */
export const MAIN_GEAR: [number, number, number] = [0, 0, GEAR_Z];
/** a flat piece of a wing or a tail: its root and tip (each a leading and a trailing edge point) and its thickness,
 *  both faces and its edges */
function slab(root: [V3, V3], tip: [V3, V3], t: number): V3[] {
  const up = (p: V3, k: number): V3 => [p[0], p[1] + k, p[2]];
  const [a, b] = root, [c, d] = tip, out: V3[] = [];
  for (const k of [t / 2, -t / 2]) { const A = up(a, k), B = up(b, k), C = up(c, k), D = up(d, k); out.push(A, B, D, A, D, C); }
  // its edges: leading, trailing, tip
  for (const [p, q] of [[a, c], [b, d], [c, d]] as [V3, V3][]) { const P1 = up(p, t / 2), P2 = up(p, -t / 2), Q1 = up(q, t / 2), Q2 = up(q, -t / 2); out.push(P1, Q1, Q2, P1, Q2, P2); }
  return out;
}
/** an upright fin: its root (leading, trailing) at y0, its tip (leading, trailing) at y1, its thickness */
function fin(root: [number, number], tip: [number, number], y0: number, y1: number, t: number): V3[] {
  const out: V3[] = [];
  for (const x of [t / 2, -t / 2]) out.push([x, y0, root[0]], [x, y0, root[1]], [x, y1, tip[1]], [x, y0, root[0]], [x, y1, tip[1]], [x, y1, tip[0]]);
  out.push([t / 2, y0, root[0]], [t / 2, y1, tip[0]], [-t / 2, y1, tip[0]], [t / 2, y0, root[0]], [-t / 2, y1, tip[0]], [-t / 2, y0, root[0]]);
  return out;
}
/** the plane's outline seen from above (flat at the fuselage's middle) and from the side (upright along it) */
function symbol(): { top: V3[]; side: V3[] } {
  const y = Y, top: V3[] = [], side: V3[] = [];
  const quad = (o: V3[], a: V3, b: V3, c: V3, d: V3) => o.push(a, b, c, a, c, d);
  quad(top, [-RAD, y, NOSE - 3], [RAD, y, NOSE - 3], [RAD, y, TAIL + 3], [-RAD, y, TAIL + 3]);
  top.push([-RAD, y, NOSE - 3], [0, y, NOSE], [RAD, y, NOSE - 3], [-RAD * 0.5, y, TAIL + 3], [RAD * 0.5, y, TAIL + 3], [0, y, TAIL]);
  for (const s of [-1, 1]) {
    quad(top, [s * RAD, y, 2], [s * 18, y, -8.6], [s * 18, y, -10.6], [s * RAD, y, -5.5]);
    quad(top, [s * 0.5, y, -13.5], [s * 6.8, y, -17.3], [s * 6.8, y, -18.6], [s * 0.5, y, -17.8]);
  }
  quad(side, [0, y - RAD, NOSE - 3], [0, y + RAD, NOSE - 3], [0, y + RAD, TAIL + 4], [0, y - RAD, TAIL + 4]);
  side.push([0, y - RAD * 0.7, NOSE - 3], [0, y, NOSE], [0, y + RAD * 0.8, NOSE - 3]);
  quad(side, [0, y + RAD * 0.6, -11.5], [0, y + 8.6, -16.8], [0, y + 8.6, -18.8], [0, y, -19]);
  return { top, side };
}
export const airliner = shape({
  id: 'airliner',
  params: { white: num(0, 1, 1) },
  simple: true,
  // far away: its outline, flat, from above and from the side
  far: (b) => { const s = symbol(); b.mesh(s.top, { color: WHITE }); b.mesh(s.side, { color: WHITE }); },
  size: { min: 22 },
  budget: { whole: 6000, simple: 1800, far: 64 },
  build: (b) => {
    {
      const ring = (z0: number, z1: number, s0: number, s1: number, y0 = Y, y1 = Y, color = WHITE) => b.sweep({ circle: RAD, sides: 18 }, [[0, y0, z0], [0, y1, z1]], { scale: [s0, s1], color, material: 'painted', caps: false });
      // the fuselage: its nose cone, its long middle, its tail rising to the fin
      ring(NOSE, NOSE - 1.2, 0.05, 0.55); ring(NOSE - 1.2, NOSE - 3.2, 0.55, 0.92); ring(NOSE - 3.2, NOSE - 5, 0.92, 1);
      ring(NOSE - 5, -9, 1, 1); ring(-9, TAIL, 1, 0.22, Y, Y + 1.25);
      // its cockpit windows and a row of cabin windows each side (the whole level only)
      b.sweep({ rect: [2.1, 0.34] }, [[0, Y + 0.95, NOSE - 2.05], [0, Y + 0.92, NOSE - 2.45]], { color: GLASS, detail: 0 });
      for (const s of [-1, 1]) b.sweep({ rect: [0.05, 0.22] }, [[s * (RAD + 0.01), Y + 0.45, NOSE - 6], [s * (RAD + 0.01), Y + 0.45, -8]], { color: GLASS, detail: 0 });
      // the wings: swept back, a little dihedral, under the fuselage
      for (const s of [-1, 1]) {
        b.mesh(slab([[s * 1.2, Y - 1.2, 2.2], [s * 1.2, Y - 1.2, -5.6]], [[s * 17.6, Y - 0.2, -8.4], [s * 17.6, Y - 0.2, -10.4]], 0.45), { color: WING, material: 'painted' });
        // its winglet
        b.mesh(fin([-8.4, -10.4], [-9.6, -10.6], 0, 1.8, 0.12).map(([x, y, z]) => [s * 17.6 + x, Y - 0.2 + y, z] as V3), { color: WHITE });
        // the engine under it: a nacelle, its intake dark, a pylon up to the wing
        b.sweep({ circle: 1.05, sides: 14 }, [[s * 5.9, Y - 2.05, 3.6], [s * 5.9, Y - 2.05, -1.4]], { scale: [1, 0.78], color: WHITE, material: 'painted' });
        b.solid('cylinder', { radius: 0.92, size: 0.1, at: [s * 5.9, Y - 2.05, 3.62], axis: 'z', color: DARK, detail: 1 });
        b.solid('box', { size: [0.35, 0.9, 3.2], at: [s * 5.9, Y - 1.25, 0.6], color: WING });
        // the tailplane
        b.mesh(slab([[s * 0.6, Y + 0.9, -13.6], [s * 0.6, Y + 0.9, -17.6]], [[s * 6.8, Y + 1.2, -17.2], [s * 6.8, Y + 1.2, -18.6]], 0.25), { color: WING, material: 'painted' });
      }
      // the fin
      b.mesh(fin([-11.4, -18.6], [-16.6, -18.8], Y + RAD * 0.6, Y + 8.6, 0.35), { color: WHITE, material: 'painted' });
      // the gear (the whole level): its nose leg and the two main legs, their wheels
      b.solid('box', { size: [0.25, Y - RAD + 0.3, 0.25], at: [0, (Y - RAD + 0.3) / 2, NOSE - 5], color: METAL, detail: 0 });
      b.solid('cylinder', { radius: 0.42, size: 0.5, at: [0, 0.42, NOSE - 5], axis: 'x', color: DARK, detail: 0 });
      for (const s of [-1, 1]) {
        b.solid('box', { size: [0.3, Y - 1.2, 0.3], at: [s * 2.9, (Y - 1.2) / 2, GEAR_Z], color: METAL, detail: 0 });
        b.solid('cylinder', { radius: 0.58, size: 0.9, at: [s * 2.9, 0.58, GEAR_Z], axis: 'x', color: DARK, detail: 0 });
      }
    }
  },
});
