// modules › world › earth › presets › built › buildings: buildings as built solids, from their real footprints. A footprint raised to
// its height (measured, from floors, or a default) with a flat roof and rows of windows on taller ones; a detached
// house on its plan (plan.ts: rectangles inside its footprint, facing its street): brick or weatherboard walls set in
// under the eaves, so the eaves end at the footprint's edge; the main body under a hip, gable or dutch roof (its ridge
// along the long side, its pitch in a range), a wing as a gable to the street or a lean-to addition; windows on every
// long wall, a door facing its street, maybe a chimney; its front fence, bins and driveway on the lot. A house look of
// your own: a roof of your own shape over the main body and each wing (`roof`), a floor raised on posts with steps up to
// its door (`raise`): a house on stilts under a steep roof is a look, not a new house.
//   footprint(mb, ring, 18, rng)            house(mb, { ring, height: 6.5, front }, HOUSE, rng)
//   house(mb, { ring, height: 9, front }, { ...HOUSE, roof: steepRoof, raise: 1.8 }, rng)
import { earcut } from '../../../../../../core/geometry/build/earcut.ts';
import { vary, type MeshBuilder, type V3 } from '../../../../../../core/geometry/shapes/mesh.ts';
import { inside, signedArea, type P2, type Rng } from '../../../shared/plan.ts';
import { LAMP_CODES } from '../../../../../../core/render/look/materials.ts';
import { roofFaces, roofRise, type RoofForm } from '../../../../../../core/geometry/shapes/roofs.ts';
import { housePlan, reachInto, rectInside, type PlanOptions, type Rect, type WingSide } from './plan.ts';

/** a shape as a roof: anything built into a mesh with its width (along its ridge: its x), depth and height (m), its
 *  foot at the eaves (a Shape: shape({ params: { width, depth, height }, build })) */
export interface RoofShape { into(mb: MeshBuilder, p: { width: number; depth: number; height: number }, o: { at: V3; turn: number; level?: number }): unknown }

export interface HouseLook {
  /** the roof's pitch: its middle and how far either way it varies (degrees) */
  roofPitch: number; pitchVary: number;
  /** the eaves past the walls (m; the walls are set in by it: the eaves end at the footprint's edge), the lowest eave */
  eaves: number; minEave: number;
  /** the main body's roof forms by weight (a body squarer than `squareHip`, long side over short, is hipped) */
  forms: Partial<Record<RoofForm, number>>; squareHip: number;
  /** a wing: in front (towards the street) a gable to the street by `frontGable`'s chance, else as the main body; at
   *  the back or a side and no deeper than `lean.depth` m, a lean-to (a skillion under the main eaves, at `lean.pitch`
   *  degrees, its low side not under `lean.low` m) by `lean.chance` */
  frontGable: number; lean: { chance: number; depth: number; pitch: number; low: number };
  chimneyChance: number; windowSpacing: number; windowHeight: number;
  walls: Record<string, number>; roofs: Record<string, number>; windowColor: string; doorColor: string; soffit: string;
  /** how the plan is found (plan.ts) */
  plan?: PlanOptions;
  /** a roof of your own over the main body and each wing that is not a lean-to (its width along the ridge, its depth,
   *  its height from the pitch: the gable's rise), in place of the forms */
  roof?: RoofShape;
  /** a raised floor: its walls this many metres over the ground (the house's height counts from the ground), on posts
   *  under its floor, steps up to its door (default 0: on the ground) */
  raise?: number;
  /** the raised floor's posts: colour, side (m), spacing (m); its floor's colour */
  posts?: { color?: string; size?: number; spacing?: number; floor?: string };
}
export const HOUSE: HouseLook = {
  roofPitch: 23, pitchVary: 4, eaves: 0.5, minEave: 2.5, forms: { hip: 6, gable: 2.5, dutch: 1 }, squareHip: 1.15,
  frontGable: 0.7, lean: { chance: 0.75, depth: 5, pitch: 8, low: 2.2 },
  chimneyChance: 0.35, windowSpacing: 4.0, windowHeight: 1.2,
  // red brick, orange brick, cream brick, weatherboard, render
  walls: { '#9a4a32': 3, '#b8693f': 2, '#d7c19a': 2, '#ece7dc': 2, '#cfc8b8': 1 },
  // terracotta, brown tile, charcoal, light grey steel, dark tile
  roofs: { '#a5502f': 3, '#7a4a35': 2, '#4a4d52': 2, '#8f9399': 1, '#5b3a2c': 1 },
  windowColor: '#273240', doorColor: '#5b3b25', soffit: '#6d6a64',
};
export interface BlockLook { walls: string[]; roofs: string[]; window: string }
export const BLOCK: BlockLook = { walls: ['#e8e2d4', '#d9d0bf', '#cdbfa8', '#bfa58b', '#c9c6bf', '#b9b4ab'], roofs: ['#7b7d80', '#6a6d70', '#a4a7a9', '#5e6266'], window: '#4a5a6c' };
export const HOUSE_CLASSES = new Set(['house', 'residential', 'detached', 'semidetached_house', 'terrace', 'bungalow', 'farm']);
/** a house, by its class or (unlabelled) by being small and low */
export const isHouse = (cls: string, area: number, height: number) => HOUSE_CLASSES.has(cls) || (!cls && area < 450 && height < 10 && area > 40);

/** the walls go round counter-clockwise on the map: their fronts face out */
const outward = (ring: readonly P2[]): P2[] => (signedArea(ring) > 0 ? [...ring] : [...ring].reverse());
const tris = (ring: readonly P2[]) => earcut(ring.flat(), [], 2);

/** a footprint raised to `height` metres, a flat roof, windows a floor apart on buildings over 6 m. `base`: where the
 *  walls start (1 m under the ground: a slope shows no gap; 0 on a pad: its foundation is below, never two faces in
 *  one place) */
export function footprint(mb: MeshBuilder, ring0: readonly P2[], height: number, rnd: Rng, look: BlockLook = BLOCK, far = false, base = -1): void {
  const ring = outward(ring0), n = ring.length;
  const wall = vary(rnd.pick(look.walls), rnd.next(), 0.06), roof = rnd.pick(look.roofs);
  mb.prism(ring, base, height, wall, roof, tris(ring));
  if (height <= 6 || far) return;
  // the windows: glass by day, a share of them lit at night (lamps 'windows': the layer's share)
  mb.material(LAMP_CODES.windows);
  for (let i = 0; i < n; i++) {
    const [ax, az] = ring[i]!, [bx, bz] = ring[(i + 1) % n]!, len = Math.hypot(bx - ax, bz - az); if (len < 3) continue;
    const tx = (bx - ax) / len, tz = (bz - az) / len, nx = -tz * 0.06, nz = tx * 0.06;
    const k = Math.max(1, Math.floor(len / 3.2)), w = Math.min(1.8, len / k - 0.8);
    for (let y = 1.1; y + 1.4 < height - 0.6; y += 3.4) for (let j = 0; j < k; j++) {
      const c = ((j + 0.5) / k) * len;
      mb.wall(ax + tx * (c - w / 2) + nx, az + tz * (c - w / 2) + nz, ax + tx * (c + w / 2) + nx, az + tz * (c + w / 2) + nz, y, y + 1.4, look.window);
    }
  }
  mb.material(0);
}
/** a detached house from its footprint; `front` is the unit direction from it to its street. Gives its eave and top.
 *  `far`: the walls and the roofs only (far away, and for the sun's shadow map); `base`: where the walls start (as a
 *  footprint's: 0 on a pad); `lit`: its windows glass that lights up at night (lamps 'windows'; false: painted) */
export function house(mb: MeshBuilder, input: { ring: readonly P2[]; height: number; front?: { x: number; z: number } }, p: HouseLook, rnd: Rng, far = false, base = -0.3, lit = true): { eave: number; top: number } | null {
  const ring = outward(input.ring); if (ring.length < 3) return null;
  const plan = housePlan(input.ring, input.front ? [input.front.x, input.front.z] : null, p.plan), M = plan.main;
  const mw = M.x1 - M.x0, md = M.z1 - M.z0; if (!(mw > 1 && md > 1)) return null;
  // the house's frame on the map: u along its street, v towards it
  const W = (u: number, y: number, v: number): V3 => [u * plan.x[0] + v * plan.z[0], y, u * plan.x[1] + v * plan.z[1]];
  const e = Math.min(p.eaves, Math.min(mw, md) * 0.2), pitch = p.roofPitch + (rnd.next() * 2 - 1) * p.pitchVary;
  const long = Math.max(mw, md) / Math.max(0.1, Math.min(mw, md));
  const weights = Object.entries(p.forms).filter(([, v]) => (v ?? 0) > 0), any = weights.length ? rnd.weighted(Object.fromEntries(weights) as Record<RoofForm, number>) : 'hip';
  // (a roof of yours: its height a gable's at the pitch)
  const own = p.roof ?? null, form: RoofForm = own ? 'gable' : long < p.squareHip ? 'hip' : any;
  // (a skillion in the forms: as low as a lean-to's, not a gable's pitch across the whole body)
  const mainPitch = form === 'skillion' ? Math.min(pitch, p.lean.pitch) : pitch, rise = roofRise(form, mw, md, { pitch: mainPitch }).rise;
  // a raised floor: the walls from `lift` (everything over it as on the ground: the height counts from the ground)
  const lift = Math.max(0, p.raise ?? 0), height = input.height - lift;
  const storeys = height - rise > 4.6 ? 2 : 1;
  const eave = Math.max(p.minEave, storeys === 2 ? Math.min(6.2, height - rise) : Math.min(3.2, height - rise));
  const wall = vary(rnd.weighted(p.walls), rnd.next(), 0.06), roof = vary(rnd.weighted(p.roofs), rnd.next(), 0.06), soffit = vary(p.soffit, rnd.next(), 0.05);
  // a box of walls: a rectangle of the plan set in by `inset` on each side, `y0`..`y1`; `skip`: a side not drawn (against
  // the main body); windows on its long walls, the door on the main body's front
  const walls = (r: Rect, ins: Record<'x0' | 'x1' | 'z0' | 'z1', number>, y1: number, skip: string | null, door: boolean) => {
    const x0 = r.x0 + ins.x0, x1 = r.x1 - ins.x1, z0 = r.z0 + ins.z0, z1 = r.z1 - ins.z1; if (x1 - x0 < 0.5 || z1 - z0 < 0.5) return;
    // counter-clockwise on the map (the frame turns as the map does): front (z1), right (x1), back (z0), left (x0)
    const sides: [string, number, number, number, number][] = [['front', x0, z1, x1, z1], ['right', x1, z1, x1, z0], ['back', x1, z0, x0, z0], ['left', x0, z0, x0, z1]];
    for (const [name, au, av, bu, bv] of sides) {
      if (name === skip) continue;
      // a wall's front is to the right of a → b seen from above: these run round the frame so each looks out
      const a = W(au, 0, av), b = W(bu, 0, bv);
      mb.wall(a[0], a[2], b[0], b[2], lift > 0 ? lift : base, lift + y1, wall);
      const len = Math.hypot(b[0] - a[0], b[2] - a[2]); if (far || len < 2.2) continue;
      // windows a `windowSpacing` apart; on the main body's front the first bay is the door's
      const front = door && name === 'front', k = Math.max(front ? 2 : 1, Math.floor(len / p.windowSpacing)), tx = (b[0] - a[0]) / len, tz = (b[2] - a[2]) / len, nx = -tz, nz = tx;
      for (let s = 0; s < (y1 > 4.6 ? 2 : 1); s++) for (let j = 0; j < k; j++) {
        if (front && j === 0 && s === 0) continue;
        const c = ((j + 0.5) / k) * len, hw = Math.min(0.75, len / k / 3), wy0 = 0.9 + s * 2.9, wy1 = Math.min(y1 - 0.25, wy0 + p.windowHeight), o = 0.03; if (wy1 - wy0 < 0.4) continue;
        if (lit) mb.material(LAMP_CODES.windows);
        mb.wall(a[0] + tx * (c - hw) + nx * o, a[2] + tz * (c - hw) + nz * o, a[0] + tx * (c + hw) + nx * o, a[2] + tz * (c + hw) + nz * o, lift + wy0, lift + wy1, p.windowColor);
        if (lit) mb.material(0);
      }
      if (front) {
        const c = (0.5 / k) * len, dw = Math.min(0.45, len / k / 2.5), o = 0.05; mb.wall(a[0] + tx * (c - dw) + nx * o, a[2] + tz * (c - dw) + nz * o, a[0] + tx * (c + dw) + nx * o, a[2] + tz * (c + dw) + nz * o, lift, lift + Math.min(2.1, y1 - 0.2), p.doorColor);
        // (raised: steps down from the door to the ground, straight out from the wall)
        if (lift > 0) steps(a[0] + tx * c, a[2] + tz * c, nx, nz, dw * 2 + 0.3);
      }
    }
  };
  // steps from a door (its middle on the wall, the way out) down to the ground, `w` m wide: a tread each ~18 cm
  const steps = (x: number, z: number, nx: number, nz: number, w: number) => {
    const n = Math.max(1, Math.ceil(lift / 0.18)), h = lift / n, run = 0.27, ang = Math.atan2(nz, nx) + Math.PI / 2;
    for (let i = 0; i < n; i++) { const d = 0.05 + run * (i + 0.5), top = lift - h * i; mb.box(x + nx * d, z + nz * d, base, w, top - base, run, ang, p.posts?.floor ?? wall); }
  };
  // a raised floor under a rectangle of the plan (set in by `ins`): its slab, posts round its edge and across it
  const floorOn = (r: Rect, ins: Record<'x0' | 'x1' | 'z0' | 'z1', number>) => {
    const x0 = r.x0 + ins.x0, x1 = r.x1 - ins.x1, z0 = r.z0 + ins.z0, z1 = r.z1 - ins.z1; if (x1 - x0 < 0.5 || z1 - z0 < 0.5) return;
    const ang = Math.atan2(plan.x[1], plan.x[0]), c = W((x0 + x1) / 2, 0, (z0 + z1) / 2), slab = 0.22, col = p.posts?.color ?? '#6b5b4b';
    mb.box(c[0], c[2], lift - slab, x1 - x0, slab, z1 - z0, ang, p.posts?.floor ?? wall);
    if (far) return;
    const sp = p.posts?.spacing ?? 2.4, sz = p.posts?.size ?? 0.22, nu = Math.max(1, Math.round((x1 - x0) / sp)), nv = Math.max(1, Math.round((z1 - z0) / sp));
    for (let i = 0; i <= nu; i++) for (let j = 0; j <= nv; j++) {
      const q = W(x0 + sz / 2 + ((x1 - x0 - sz) * i) / nu, 0, z0 + sz / 2 + ((z1 - z0 - sz) * j) / nv);
      mb.box(q[0], q[2], base, sz, lift - slab - base, sz, ang, col);
    }
  };
  // a roof over a rectangle of the plan (its eaves its edges), its eaves at `y`
  const roofOver = (r: Rect, f: RoofForm, y0: number, o: Parameters<typeof roofFaces>[3]) => {
    const y = lift + y0;
    if (own && f !== 'skillion') {
      // yours: its width along the ridge (the plan's x or z), its height a gable's at the pitch; its x on the ridge
      const w = r.x1 - r.x0, d = r.z1 - r.z0, along = roofRise('gable', w, d, o).ridge, R = roofRise('gable', w, d, o).rise;
      const c = W((r.x0 + r.x1) / 2, y, (r.z0 + r.z1) / 2), dir = along === 'x' ? plan.x : plan.z;
      own.into(mb, { width: along === 'x' ? w : d, depth: along === 'x' ? d : w, height: R }, { at: c, turn: (Math.atan2(dir[1], dir[0]) * 180) / Math.PI, level: far ? 2 : 0 });
      return R;
    }
    const cu = (r.x0 + r.x1) / 2, cv = (r.z0 + r.z1) / 2, F = roofFaces(f, r.x1 - r.x0, r.z1 - r.z0, o), put = (pt: V3) => W(cu + pt[0], y + pt[1], cv + pt[2]);
    for (let i = 0; i + 2 < F.slopes.length; i += 3) mb.tri(put(F.slopes[i]!), put(F.slopes[i + 1]!), put(F.slopes[i + 2]!), roof);
    for (let i = 0; i + 2 < F.ends.length; i += 3) mb.tri(put(F.ends[i]!), put(F.ends[i + 1]!), put(F.ends[i + 2]!), wall);
    if (!far) for (let i = 0; i + 2 < F.under.length; i += 3) mb.tri(put(F.under[i]!), put(F.under[i + 1]!), put(F.under[i + 2]!), soffit);
    return F.rise;
  };
  const all = { x0: e, x1: e, z0: e, z1: e };
  if (lift > 0) floorOn(M, all);
  walls(M, all, eave, null, true);
  roofOver(M, form, eave, { pitch: mainPitch, ridge: 'long', endInset: e });
  // the wings: a lean-to at the back or a side, a gable to the street in front, else as the main body; each roof
  // reaches into the main one (hidden under it) so the two meet
  for (const w of plan.wings) {
    const ww = w.x1 - w.x0, wd = w.z1 - w.z0, ew = Math.min(e, Math.min(ww, wd) * 0.2);
    const toMain: Record<WingSide, 'x0' | 'x1' | 'z0' | 'z1' | null> = { front: 'z0', back: 'z1', left: 'x1', right: 'x0', apart: null };
    const at = toMain[w.side], deep = at === 'z0' || at === 'z1' ? wd : ww;
    // its walls meet the main body's (set in under its eaves) where that stays inside the footprint
    const joined = { ...w }; if (at) joined[at] += at === 'x0' || at === 'z0' ? -e : e;
    const meets = !!at && rectInside(plan, joined);
    const ins = { x0: ew, x1: ew, z0: ew, z1: ew }; if (at && meets) ins[at] = -e;
    const skip = meets ? FACING_MAIN[w.side] : null;
    if (at && w.side !== 'front' && deep <= p.lean.depth && rnd.chance(p.lean.chance)) {
      // a lean-to: high against the main body under its eaves, sloping away
      const high = eave - 0.15, low = Math.max(p.lean.low, high - deep * Math.tan((p.lean.pitch * Math.PI) / 180));
      if (lift > 0) floorOn(w, ins);
      walls(w, ins, low, skip, false);
      const rr = meets ? joined : w;
      roofOver(rr, 'skillion', low, { rise: high - low, high: at === 'z1' ? '+z' : at === 'z0' ? '-z' : at === 'x1' ? '+x' : '-x', endInset: ew });
      continue;
    }
    // its ridge away from the main body (along its length), no higher than the main one's
    const ridge: 'x' | 'z' = at === 'z0' || at === 'z1' ? 'z' : at ? 'x' : (ww >= wd ? 'x' : 'z'), half = (ridge === 'x' ? wd : ww) / 2;
    const f: RoofForm = w.side === 'front' && rnd.chance(p.frontGable) ? 'gable' : form === 'dutch' && half < 2.5 ? 'gable' : form;
    const wp = Math.min(pitch, (Math.atan((rise * 0.92) / Math.max(0.5, half)) * 180) / Math.PI);
    if (lift > 0) floorOn(w, ins);
    walls(w, ins, eave, skip, false);
    const rr = at ? reachInto(plan, w, at, Math.min(half + 0.3, (at[0] === 'x' ? mw : md) / 2)) : w;
    roofOver(rr, f, eave, { pitch: wp, ridge, endInset: ew });
  }
  if (!far && rnd.chance(p.chimneyChance)) {
    const u = (M.x0 + M.x1) / 2 + rnd.range(-0.25, 0.25) * mw, v = (M.z0 + M.z1) / 2 + rnd.range(-0.15, 0.15) * md, [x, , z] = W(u, 0, v);
    mb.box(x, z, lift + eave + rise * 0.4, 0.6, rise * 0.6 + 0.9, 0.6, Math.atan2(plan.x[1], plan.x[0]), wall, '#5a4a40');
  }
  return { eave: lift + eave, top: lift + eave + rise };
}
/** a wing's own side that faces the main body (its wall there is not drawn: the main body's stands there) */
const FACING_MAIN: Record<WingSide, string | null> = { front: 'back', back: 'front', left: 'right', right: 'left', apart: null };

export interface LotLook {
  /** the front fence: its kinds by weight, heights, colours, and the gap left in it for the driveway (m) */
  fence: { chance: number; types: Record<string, number>; brickHeight: number; picketHeight: number; palingHeight: number; driveway: number; brickColor: string; picketColor: string; palingColor: string };
  bins: { chance: number; body: string; general: string; recycling: string; garden: string };
  /** a paved driveway from the fence's gap to the house (alongside it to its back where its side is clear), inside
   *  the plot, `lift` m over the ground, each `step` m on its own ground; unset or chance 0: none */
  driveway?: { chance: number; width: number; color: string; lift: number; step: number };
}
export const LOT: LotLook = {
  fence: { chance: 0.85, types: { brick: 3, picket: 3, paling: 2, none: 1 }, brickHeight: 0.7, picketHeight: 1.1, palingHeight: 1.7, driveway: 3.2, brickColor: '#a9583c', picketColor: '#efede6', palingColor: '#8a6b4f' },
  bins: { chance: 0.95, body: '#2f3a32', general: '#c0392b', recycling: '#f1c40f', garden: '#27ae60' },
  driveway: { chance: 0.85, width: 2.8, color: '#a6a299', lift: 0.06, step: 4 },
};
/** a driveway: a paved strip from the property line (a point on it, its direction t, the way n into the plot) at `at`
 *  m along it, in to the house's front (a step short), or alongside it to its back when the strip's lane is clear of
 *  it; shortened to stay inside the plot (none without one: a plot keeps it off the neighbours) */
export function driveway(mb: MeshBuilder, line: { px: number; pz: number; tx: number; tz: number; nx: number; nz: number }, at: number, ring: readonly P2[], lot: readonly P2[] | null, d: NonNullable<LotLook['driveway']>): void {
  if (!lot || lot.length < 3) return;
  const { px, pz, tx, tz, nx, nz } = line, hw = d.width / 2, L = (s: number, o: number): P2 => [px + tx * s + nx * o, pz + tz * s + nz * o];
  // the footprint's nearest depth (along n) across the strip's lane, and its back
  let stop = Infinity, back = -Infinity;
  const n = ring.length, S = ring.map(([x, z]) => (x - px) * tx + (z - pz) * tz), O = ring.map(([x, z]) => (x - px) * nx + (z - pz) * nz);
  for (let i = 0; i < n; i++) {
    back = Math.max(back, O[i]!);
    if (S[i]! >= at - hw && S[i]! <= at + hw) stop = Math.min(stop, O[i]!);
    const j = (i + 1) % n; for (const s of [at - hw, at, at + hw]) if ((S[i]! - s) * (S[j]! - s) < 0) stop = Math.min(stop, O[i]! + ((O[j]! - O[i]!) * (s - S[i]!)) / (S[j]! - S[i]!));
  }
  let len = Number.isFinite(stop) ? stop - 0.3 : back + 1;
  const ok = (o: number) => inside(...L(at - hw, o), lot) && inside(...L(at + hw, o), lot);
  if (!ok(0.3)) return;
  while (len > 2 && !ok(len)) len -= 1;
  if (len <= 2) return;
  const k = Math.max(1, Math.ceil((len - 0.3) / d.step)), pts: P2[] = [];
  for (let i = 0; i <= k; i++) pts.push(L(at, 0.3 + ((len - 0.3) * i) / k));
  mb.ribbon(pts, -hw, hw, d.lift, d.color);
}
/** a front fence from a to b (each post on its own ground), of a kind */
export function fence(mb: MeshBuilder, a: P2, b: P2, kind: string, l: LotLook['fence']): void {
  if (kind === 'none') return;
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.5) return;
  const h = kind === 'brick' ? l.brickHeight : kind === 'picket' ? l.picketHeight : l.palingHeight, col = kind === 'brick' ? l.brickColor : kind === 'picket' ? l.picketColor : l.palingColor;
  const tx = (b[0] - a[0]) / len, tz = (b[1] - a[1]) / len, nx = -tz * 0.06, nz = tx * 0.06, n = Math.max(1, Math.ceil(len / 3));
  for (let k = 0; k < n; k++) {
    const t0 = (k / n) * len, t1 = ((k + 1) / n) * len, m: P2 = [a[0] + tx * (t0 + t1) / 2, a[1] + tz * (t0 + t1) / 2];
    mb.on(m);
    // both faces of the panel (a fence is seen from the street and the garden)
    mb.wall(a[0] + tx * t0 + nx, a[1] + tz * t0 + nz, a[0] + tx * t1 + nx, a[1] + tz * t1 + nz, 0, h, col);
    mb.wall(a[0] + tx * t1 - nx, a[1] + tz * t1 - nz, a[0] + tx * t0 - nx, a[1] + tz * t0 - nz, 0, h, col);
  }
}
/** three wheelie bins side by side at (x, z), lined up along (ax, az) */
export function bins(mb: MeshBuilder, x: number, z: number, along: { x: number; z: number }, l: LotLook['bins']): void {
  const ang = Math.atan2(along.z, along.x);
  [l.general, l.recycling, l.garden].forEach((lid, i) => {
    const o = (i - 1) * 0.65, bx = x + along.x * o, bz = z + along.z * o;
    mb.on([bx, bz]); mb.box(bx, bz, 0, 0.55, 1.0, 0.6, ang, l.body, lid);
  });
}
