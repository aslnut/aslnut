// The houses of this twin, authored here with aslnut's shapes (a scope, its faces, solids, sweeps and copies): built
// on every real house footprint's plan (housePlan: the footprint's own axes, x along its street and z towards it, and
// the rectangles inside it: a main body and its wings), in the eras Melbourne's suburbs were built in. Everything
// stays inside the footprint: the walls are set in under the eaves, the verandas and porches carved from the front of
// the main body, so next-door houses never run into each other. The era comes from the data where it says (a build
// year), else from a seeded mix for the area (Clayton: mostly post-war and later); the roof from the era and the
// plan's shape (ERA_ROOFS: forms by weight, a pitch range; the ridge along the long side; a lean-to on an addition).
//   victorian    single-fronted brick, a hipped iron roof, a bullnose veranda with iron lace, a bay window, chimneys
//   edwardian    red brick, a terracotta hip or dutch roof with a gabled front room (half-timbered), a fretwork veranda
//   interwar     a bungalow: a gable to the street or across it, a porch on tapered piers under its own gable
//   postwar      cream brick, a low hipped tile roof (sometimes gabled or dutch), wide windows, a porch set into a corner
//   modern       render and cladding, a skillion, flat or low hipped steel roof, big glass
import { choice, housePlan, reachInto, rectInside, roofRise, shape, type Builder, type Finish, type HousePlan, type HouseSite, type PlanRect, type RoofForm, type Scope } from '../../src/index.ts';

export const ERAS = ['victorian', 'edwardian', 'interwar', 'postwar', 'modern'] as const;
export type Era = (typeof ERAS)[number];
/** the mix where the data has no year (a suburb built mostly after the war) */
const MIX: Record<Era, number> = { victorian: 1, edwardian: 1, interwar: 2, postwar: 5, modern: 3 };
const eraOfYear = (y: number): Era => (y < 1901 ? 'victorian' : y < 1919 ? 'edwardian' : y < 1945 ? 'interwar' : y < 1985 ? 'postwar' : 'modern');
/** each era's roofs: the main body's forms by weight, its pitch range (degrees), its eaves past the walls (m), its
 *  colours; an addition's lean-to (a skillion no deeper than `lean` m, at `leanPitch`, in `leanColor`) */
export interface EraRoofs { forms: Partial<Record<RoofForm, number>>; pitch: [number, number]; eaves: number; colors: string[]; lean: number; leanPitch: number; leanColor: string }
export const ERA_ROOFS: Record<Era, EraRoofs> = {
  victorian: { forms: { hip: 1 }, pitch: [28, 34], eaves: 0.3, colors: ['#8e9496', '#858b8e', '#979c9e'], lean: 5.5, leanPitch: 8, leanColor: '#7f878b' },
  edwardian: { forms: { hip: 3, dutch: 1 }, pitch: [30, 36], eaves: 0.45, colors: ['#a4553a', '#9a4b33', '#ad5e40'], lean: 5.5, leanPitch: 8, leanColor: '#7f878b' },
  interwar: { forms: { gable: 1 }, pitch: [22, 28], eaves: 0.6, colors: ['#7c3f2f', '#5e5a55', '#6e3a2c'], lean: 5, leanPitch: 7, leanColor: '#6f7376' },
  postwar: { forms: { hip: 7, gable: 2, dutch: 1 }, pitch: [20, 25], eaves: 0.5, colors: ['#9a5b3e', '#6f6a64', '#8b4a36', '#7d4433'], lean: 5, leanPitch: 6, leanColor: '#6f7376' },
  modern: { forms: { skillion: 4, flat: 3, hip: 3 }, pitch: [15, 18], eaves: 0.3, colors: ['#4a4e52', '#55595d', '#3f4347', '#6b6f73'], lean: 5, leanPitch: 5, leanColor: '#4a4e52' },
};

export const house = shape({
  id: 'melbourne-house',
  params: { era: choice(['auto', ...ERAS], 'auto') },
  budget: { whole: 2600, simple: 700 },
  simple: true,
  build: (b: Builder, p: { era: string } & HouseSite, rand) => {
    const year = Number(p.props?.year ?? p.props?.built ?? NaN);
    const era: Era = p.era !== 'auto' ? (p.era as Era) : Number.isFinite(year) ? eraOfYear(year) : pick(MIX, rand);
    // the plan: the footprint's own frame facing its street, the rectangles inside it
    const plan = housePlan(p.footprint, p.front);
    const M = plan.main, w = M.x1 - M.x0, d = M.z1 - M.z0; if (!(w > 2 && d > 2)) return;
    const floors = p.height > 5.6 ? 2 : 1;
    // a big footprint (over 400 m² of floor, or 32 m along a side): built modern, under a flat roof
    const big = plan.area > 400 || Math.max(w, d) > 32;
    b.frame({ turn: plan.turn }, (b) => ERA_BUILD[big ? 'modern' : era](b, { plan, M, floors, rand, big }));
  },
});
interface Plan { plan: HousePlan; M: PlanRect; floors: number; rand: () => number; /** a big footprint: a flat roof (a hip over it would stand like a pyramid) */ big?: boolean }
type Rect = PlanRect;
type Ins = { x0: number; x1: number; z0: number; z1: number };
function pick<T extends string>(w: Record<T, number>, r: () => number): T { const e = Object.entries(w) as [T, number][]; let s = 0; for (const [, v] of e) s += v; let x = r() * s; for (const [k, v] of e) { x -= v; if (x <= 0) return k; } return e[0]![0]; }
const of = <T>(xs: readonly T[], r: () => number) => xs[Math.floor(r() * xs.length) % xs.length]!;
const between = ([a, b]: [number, number], r: () => number) => a + (b - a) * r();
const ins = (k: number): Ins => ({ x0: k, x1: k, z0: k, z1: k });
const cut = (r: Rect, i: Ins): Rect => ({ x0: r.x0 + i.x0, x1: r.x1 - i.x1, z0: r.z0 + i.z0, z1: r.z1 - i.z1 });

/** a body: a box on a rectangle of the plan, `wall` m high, filled (its faces to put windows on) */
function body(b: Builder, r: Rect, wall: number, finish: Finish): Scope {
  const s = b.scope({ size: [Math.max(0.1, r.x1 - r.x0), wall, Math.max(0.1, r.z1 - r.z0)], at: [(r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2] });
  s.solid('box', finish);
  return s;
}
/** a roof whose eaves are a rectangle of the plan, at `y` metres (its overhang: where its gable ends stand in) */
function roofOn(b: Builder, r: Rect, y: number, form: RoofForm, o: Finish & { pitch: number; overhang: number; ridge?: 'long' | 'x' | 'z'; rise?: number; high?: '+z' | '-z' | '+x' | '-x'; ends?: Finish }): void {
  const ov = Math.min(o.overhang, (r.x1 - r.x0) * 0.3, (r.z1 - r.z0) * 0.3);
  b.scope({ size: [Math.max(0.1, r.x1 - r.x0 - 2 * ov), y, Math.max(0.1, r.z1 - r.z0 - 2 * ov)], at: [(r.x0 + r.x1) / 2, 0, (r.z0 + r.z1) / 2] }).roof(form, { ...o, overhang: ov });
}
/** windows along a wall (a face scope): glass set in, a sill, a frame; `every` metres apart, `tall` metres high; `near`:
 *  the glass too only near (a back wall's, a wing's: the far mesh keeps the street's side) */
function windows(face: Scope, o: { every: number; tall: number; sill: number; frame: string; skip?: number[]; width?: number; near?: boolean }): void {
  if (o.tall < 0.5) return;
  face.repeat('x', o.every).forEach((cell, i) => {
    if (o.skip?.includes(i) || cell.width < 0.9) return;
    const iw = Math.min(o.width ?? 1.2, cell.width - 0.5), side = (cell.width - iw) / 2, top = Math.max(0.2, cell.height - o.sill - o.tall);
    const win = cell.inset(side, o.sill, side, top);
    win.panel({ color: '#22303a', material: 'glass', lamps: 'windows', depth: 0.04, out: 0.005, detail: o.near ? 0 : 1, flat: true });
    win.inset(-0.07, -0.07).panel({ color: o.frame, material: 'painted', out: 0.002, detail: 0, flat: true });
    cell.inset(side - 0.1, o.sill - 0.08, side - 0.1, cell.height - o.sill).panel({ color: o.frame, out: 0.004, detail: 0, flat: true });
  });
}
/** a door on a face (a face scope), its middle `at` metres along it */
function door(face: Scope, at: number, color: string): void {
  if (face.width < 1.1 || face.height < 2.4) return;
  const m = Math.max(0.55, Math.min(face.width - 0.55, at));
  face.inset(m - 0.45, 0.25, face.width - m - 0.45, Math.max(0.1, face.height - 2.3)).panel({ color, material: 'painted', depth: 0.08, out: 0.01, detail: 1 });
}
/** a chimney at (x, z) through the roof, its top `top` metres up */
function chimney(b: Builder, x: number, z: number, top: number, brick: string): void {
  b.solid('box', { size: [0.6, top, 0.45], at: [x, top / 2, z], color: brick, detail: 1 });
  b.solid('box', { size: [0.72, 0.12, 0.57], at: [x, top, z], color: '#cfc7b8', detail: 0 });
  for (const dx of [-0.12, 0.12]) b.solid('box', { size: [0.14, 0.32, 0.14], at: [x + dx, top + 0.2, z], color: '#a9603f', detail: 0 });
}
/** the wings of the plan: an addition at the back or a side no deeper than the era's `lean` is a lean-to (a skillion
 *  high under the main eaves); one in front takes `front`'s form (a gable to the street, say); the others as the main
 *  body, their ridge away from it. Each roof reaches into the main one (hidden under it) so the two meet */
function wings(b: Builder, o: { plan: HousePlan; M: Rect; e: number; wall: number; rise: number; pitch: number; form: RoofForm; roof: Finish; walls: Finish; leanRoof: Finish; lean: number; leanPitch: number; front?: RoofForm; frame: string; onFront?: (r: Rect) => void }): void {
  const M = o.M;
  for (const w of o.plan.wings) {
    const ww = w.x1 - w.x0, wd = w.z1 - w.z0, ew = Math.min(o.e, Math.min(ww, wd) * 0.2);
    const at = ({ front: 'z0', back: 'z1', left: 'x1', right: 'x0', apart: null } as const)[w.side], deep = at === 'z0' || at === 'z1' ? wd : ww;
    // its body meets the main one's (set in under its eaves) where that stays inside the footprint
    const joined = { ...w }; if (at) joined[at] += at === 'x0' || at === 'z0' ? -o.e : o.e;
    const meets = !!at && rectInside(o.plan, joined);
    const i = ins(ew); if (at && meets) i[at] = -o.e;
    const lean = !!at && w.side !== 'front' && deep <= o.lean;
    const high = o.wall - 0.15, low = lean ? Math.max(2.3, high - deep * Math.tan((o.leanPitch * Math.PI) / 180)) : o.wall;
    const s = body(b, cut(w, i), low, o.walls), f = s.faces();
    for (const face of [f.front, f.back, f.left, f.right]) if (face.width > 2.4) windows(face, { every: 3.2, tall: Math.min(1.4, low - 1.3), sill: 0.9, frame: o.frame, near: true });
    if (lean && at) {
      roofOn(b, meets ? joined : w, low, 'skillion', { ...o.leanRoof, pitch: o.leanPitch, overhang: ew, rise: high - low, high: at === 'z1' ? '+z' : at === 'z0' ? '-z' : at === 'x1' ? '+x' : '-x', ends: o.walls });
      continue;
    }
    const ridge: 'x' | 'z' = at === 'z0' || at === 'z1' ? 'z' : at ? 'x' : ww >= wd ? 'x' : 'z', half = (ridge === 'x' ? wd : ww) / 2;
    const form: RoofForm = w.side === 'front' && o.front ? o.front : o.form === 'dutch' && half < 2.5 ? 'hip' : o.form;
    const flat = form === 'flat' || form === 'skillion';
    const pitch = flat ? o.pitch : Math.min(o.pitch, (Math.atan((o.rise * 0.92) / Math.max(0.5, half)) * 180) / Math.PI);
    const rr = at && !flat ? reachInto(o.plan, w, at, Math.min(half + 0.3, (at[0] === 'x' ? M.x1 - M.x0 : M.z1 - M.z0) / 2)) : w;
    roofOn(b, rr, o.wall, form, { ...o.roof, pitch, overhang: ew, ridge, ends: o.walls, ...(form === 'skillion' ? { rise: Math.min(1.2, half * 0.2), high: '+z' as const } : {}) });
    if (w.side === 'front') o.onFront?.(rr);
  }
}
/** a veranda across [x0, x1] from the body's front (z0) out to z1: posts, a floor, a roof (a bullnose: a quarter
 *  round of corrugated iron; else a flat skillion), a frieze */
function veranda(b: Builder, o: { x0: number; x1: number; z0: number; z1: number; high: number; posts: number; post: string; roof: string; bullnose?: boolean; frieze?: 'lace' | 'fret' | 'none'; floor?: string }): void {
  const w = o.x1 - o.x0, deep = o.z1 - o.z0, cx = (o.x0 + o.x1) / 2, zp = o.z1 - 0.2; if (w < 1.2 || deep < 0.8) return;
  b.solid('box', { size: [w, 0.25, deep], at: [cx, 0.125, (o.z0 + o.z1) / 2], color: o.floor ?? '#8a7a68', detail: 0 });
  b.copy((b, i) => b.solid('cylinder', { radius: 0.06, size: o.high, at: [o.x0 + 0.2 + (i * (w - 0.4)) / Math.max(1, o.posts - 1), o.high / 2 + 0.25, zp], color: o.post, sides: 6, detail: 0 }), { repeat: o.posts });
  if (o.bullnose) {
    // the bullnose: from the wall nearly level, curving down to the posts (a sweep along +x: its profile across +z,
    // down −y)
    const R = Math.min(0.6, deep * 0.4), y = o.high + 0.25 + R, prof: [number, number][] = [];
    for (let k = 0; k <= 6; k++) { const a = (k / 6) * (Math.PI / 2); prof.push([Math.sin(a) * deep, -Math.cos(a) * R]); }
    for (let k = 6; k >= 0; k--) { const a = (k / 6) * (Math.PI / 2); prof.push([Math.sin(a) * (deep - 0.05), -Math.cos(a) * (R - 0.05)]); }
    b.sweep(prof, [[o.x0, y - R, o.z0], [o.x1, y - R, o.z0]], { color: o.roof, material: 'metal', smooth: true });
  } else b.solid('box', { size: [w, 0.12, deep], at: [cx, o.high + 0.35, (o.z0 + o.z1) / 2], color: o.roof, material: 'metal', detail: 1 });
  if (o.frieze === 'lace') {
    // iron lace between the posts: a rail and a run of small rings and bars along it
    b.solid('box', { size: [w - 0.2, 0.05, 0.05], at: [cx, o.high + 0.05, zp], color: '#2b2b2b', detail: 0 });
    b.copy((b) => { b.solid('box', { size: [0.16, 0.16, 0.02], at: [0, o.high - 0.12, 0], color: '#2b2b2b', detail: 0 }); b.solid('box', { size: [0.02, 0.3, 0.02], at: [0.15, o.high - 0.1, 0], color: '#2b2b2b', detail: 0 }); }, { along: [[o.x0 + 0.3, 0, zp], [o.x1 - 0.3, 0, zp]], every: 0.45 });
  } else if (o.frieze === 'fret') {
    b.copy((b) => b.solid('box', { size: [0.04, 0.35, 0.04], at: [0, o.high - 0.05, 0], color: o.post, detail: 0 }), { along: [[o.x0 + 0.3, 0, zp], [o.x1 - 0.3, 0, zp]], every: 0.32 });
  }
}

const ERA_BUILD: Record<Era, (b: Builder, p: Plan) => void> = {
  victorian(b, { plan, M, rand }) {
    const R = ERA_ROOFS.victorian, brick = of(['#8a4b35', '#7a3f2e', '#9b5b3f'], rand), trim = '#f1ead9', wall = 3.5, e = R.eaves, pitch = between(R.pitch, rand);
    const roof: Finish = { color: of(R.colors, rand), material: 'metal' };
    // the veranda carved from the front of the main body (deep enough: it keeps 6 m of house behind it)
    const vd = M.z1 - M.z0 >= 8 ? 1.9 : 0;
    const core = cut(M, { ...ins(e), z1: e + vd }), w = core.x1 - core.x0;
    const s = body(b, core, wall, { color: brick }), f = s.faces();
    // a bay window on one side of the front, the door under the veranda on the other
    const [bayFace, doorFace] = f.front.split('x', [w * 0.55, '*']);
    if (vd > 0) { const bay = bayFace!.inset(0.5, 0, 0.5, 0.4).extrude(0.9); bay.solid('box', { color: brick, detail: 1 }); windows(bay.faces().front, { every: 1.1, tall: 1.9, sill: 0.8, frame: trim, width: 0.8 }); }
    else windows(bayFace!, { every: 2.2, tall: 1.9, sill: 0.8, frame: trim });
    door(doorFace!, doorFace!.width / 2, '#3a2a22');
    for (const side of [f.left, f.right]) windows(side, { every: 3.2, tall: 1.9, sill: 0.8, frame: trim });
    windows(f.back, { every: 3.2, tall: 1.9, sill: 0.8, frame: trim, near: true });
    const main = { ...M, z1: core.z1 + e }, rise = roofRise('hip', main.x1 - main.x0, main.z1 - main.z0, { pitch }).rise;
    roofOn(b, main, wall, 'hip', { ...roof, pitch, overhang: e });
    if (vd > 0) veranda(b, { x0: core.x0 + w * 0.55, x1: core.x1, z0: core.z1, z1: M.z1, high: 2.7, posts: 3, post: '#ece6d6', roof: '#7f878b', bullnose: true, frieze: 'lace' });
    wings(b, { plan, M, e, wall, rise, pitch, form: 'hip', roof, walls: { color: brick }, leanRoof: { color: R.leanColor, material: 'metal' }, lean: R.lean, leanPitch: R.leanPitch, frame: trim });
    const cz = (core.z0 + core.z1) / 2;
    chimney(b, core.x0 + w * 0.28, cz, wall + rise * 0.8 + 0.5, brick); chimney(b, core.x1 - w * 0.28, cz, wall + rise * 0.8 + 0.5, brick);
  },
  edwardian(b, { plan, M, rand }) {
    const R = ERA_ROOFS.edwardian, brick = of(['#9b3f2a', '#8c3a28'], rand), tile = of(R.colors, rand), trim = '#efe7d6', wall = 3.3, e = R.eaves, pitch = between(R.pitch, rand);
    const form = pick(R.forms as Record<RoofForm, number>, rand), roof: Finish = { color: tile };
    // half-timbering on a gable end to the street (its eaves' rectangle r)
    const halfTimber = (r: Rect) => b.copy((b, i) => b.solid('box', { size: [0.08, 1.3, 0.05], at: [r.x0 + (r.x1 - r.x0) * (0.3 + i * 0.1), wall + 0.6, r.z1 - e + 0.03], color: '#3b2a20', detail: 0 }), { repeat: 5 });
    const front = plan.wings.find((x) => x.side === 'front');
    // no front wing: the front room stands forward under its own gable, the veranda beside it (both carved from the main)
    const vd = !front && M.z1 - M.z0 >= 8 ? 2.2 : 0;
    const core = cut(M, { ...ins(e), z1: e + vd }), w = core.x1 - core.x0;
    const s = body(b, core, wall, { color: brick }), f = s.faces();
    windows(f.front, { every: 2.6, tall: 1.8, sill: 0.9, frame: trim, skip: vd ? [] : [0] });
    for (const side of [f.left, f.right]) windows(side, { every: 3.4, tall: 1.8, sill: 0.9, frame: trim });
    windows(f.back, { every: 3.4, tall: 1.8, sill: 0.9, frame: trim, near: true });
    const main = { ...M, z1: core.z1 + e }, rise = roofRise(form, main.x1 - main.x0, main.z1 - main.z0, { pitch }).rise;
    roofOn(b, main, wall, form, { ...roof, pitch, overhang: e, ends: { color: brick } });
    if (vd > 0) {
      // the gabled front room on the left, a fretwork veranda on the right
      const room: Rect = { x0: core.x0, x1: core.x0 + w * 0.5, z0: core.z1 - 0.2, z1: M.z1 - e };
      const rs = body(b, room, wall, { color: brick });
      windows(rs.faces().front, { every: 2.4, tall: 1.8, sill: 0.9, frame: trim, width: 1.6 });
      const rr = { x0: room.x0 - e, x1: room.x1 + e, z0: room.z0 - Math.min(3, (core.z1 - core.z0) / 2), z1: M.z1 };
      roofOn(b, rr, wall, 'gable', { ...roof, pitch: Math.min(38, pitch + 4), overhang: e, ridge: 'z', ends: { color: '#efe7d6' } });
      halfTimber(rr);
      veranda(b, { x0: room.x1 + 0.1, x1: core.x1, z0: core.z1, z1: M.z1, high: 2.6, posts: 3, post: trim, roof: tile, frieze: 'fret' });
      door(f.front, w * 0.75, '#3a2a22');
    } else door(f.front, Math.min(1.4, w * 0.2), '#3a2a22');
    wings(b, { plan, M, e, wall, rise, pitch, form, roof, walls: { color: brick }, leanRoof: { color: R.leanColor, material: 'metal' }, lean: R.lean, leanPitch: R.leanPitch, front: 'gable', frame: trim, onFront: (r) => halfTimber(r) });
    chimney(b, core.x1 - w * 0.25, (core.z0 + core.z1) / 2, wall + rise * 0.8 + 0.5, brick);
  },
  interwar(b, { plan, M, rand }) {
    const R = ERA_ROOFS.interwar, board = rand() < 0.5, wall = 2.9, clad = board ? of(['#e8dcc0', '#d9e0d0', '#efe4cc'], rand) : '#6b3a2e', trim = board ? '#3f5a4a' : '#e9e2d0', e = R.eaves, pitch = between(R.pitch, rand);
    const roof: Finish = { color: of(R.colors, rand) };
    // the porch carved from the front: a gable over tapered piers, three quarters of the front wide
    const pd = M.z1 - M.z0 >= 8 ? 1.9 : 0;
    const core = cut(M, { ...ins(e), z1: e + pd }), w = core.x1 - core.x0;
    const s = body(b, core, wall, { color: clad }), f = s.faces();
    windows(f.front, { every: 2.4, tall: 1.5, sill: 0.95, frame: trim, width: 1.5, skip: [0] });
    for (const side of [f.left, f.right]) windows(side, { every: 3, tall: 1.4, sill: 1, frame: trim });
    windows(f.back, { every: 3, tall: 1.4, sill: 1, frame: trim, near: true });
    door(f.front, Math.min(1.2, w * 0.2), '#4a3a2a');
    // the main gable: its ridge along the long side (a gable to the street on a deep house, across it on a wide one)
    const main = { ...M, z1: core.z1 + e }, rise = roofRise('gable', main.x1 - main.x0, main.z1 - main.z0, { pitch }).rise;
    roofOn(b, main, wall, 'gable', { ...roof, pitch, overhang: e, ends: { color: clad } });
    if (pd > 0) {
      const px0 = core.x0 + w * 0.125, px1 = core.x1 - w * 0.125, zp = M.z1 - 0.35;
      b.solid('box', { size: [px1 - px0, 0.25, pd], at: [(px0 + px1) / 2, 0.125, core.z1 + pd / 2], color: '#9c8f7a', detail: 1 });
      for (const x of [px0 + 0.35, px1 - 0.35]) b.solid('cone', { radius: 0.3, top: 0.19, size: 1.7, at: [x, 0.85 + 0.25, zp], color: '#7a4a3a', sides: 8, detail: 1 });
      roofOn(b, { x0: px0 - 0.15, x1: px1 + 0.15, z0: core.z1 - 1.5, z1: M.z1 }, 2.2, 'gable', { ...roof, pitch, overhang: 0.15, ridge: 'z', ends: { color: clad } });
    }
    wings(b, { plan, M, e, wall, rise, pitch, form: 'gable', roof, walls: { color: clad }, leanRoof: { color: R.leanColor, material: 'metal' }, lean: R.lean, leanPitch: R.leanPitch, front: 'gable', frame: trim });
    if (!board) chimney(b, core.x1 - w * 0.2, (core.z0 + core.z1) / 2, wall + rise * 0.8 + 0.5, clad);
  },
  postwar(b, { plan, M, floors, rand }) {
    const R = ERA_ROOFS.postwar, brick = of(['#d8c6a0', '#cdb98f', '#bfa985', '#c9b28a'], rand), wall = 2.7 * floors, e = R.eaves, pitch = between(R.pitch, rand);
    const form = pick(R.forms as Record<RoofForm, number>, rand), roof: Finish = { color: of(R.colors, rand) };
    const core = cut(M, ins(e)), w = core.x1 - core.x0, dd = core.z1 - core.z0;
    // a porch set into a front corner (the side away from a front wing): the body two boxes round it, under the main roof
    const front = plan.wings.find((x) => x.side === 'front'), left = front ? (front.x0 + front.x1) / 2 > (M.x0 + M.x1) / 2 : rand() < 0.5;
    const pw = Math.min(2.6, w * 0.3), pd = Math.min(1.6, dd * 0.25), porch = w > 6 && dd > 6;
    const pr: Rect = left ? { x0: core.x0, x1: core.x0 + pw, z0: core.z1 - pd, z1: core.z1 } : { x0: core.x1 - pw, x1: core.x1, z0: core.z1 - pd, z1: core.z1 };
    const back = body(b, porch ? { ...core, z1: core.z1 - pd } : core, wall, { color: brick });
    const fr = porch ? body(b, left ? { x0: pr.x1, x1: core.x1, z0: pr.z0, z1: core.z1 } : { x0: core.x0, x1: pr.x0, z0: pr.z0, z1: core.z1 }, wall, { color: brick }) : back;
    const ff = fr.faces(), fb = back.faces();
    windows(ff.front, { every: 2.8, tall: 1.4, sill: 0.8, frame: '#f2efe7', width: 2.0 });
    for (const side of [fb.left, fb.right]) windows(side, { every: 3.2, tall: 1.2, sill: 1, frame: '#f2efe7' });
    windows(fb.back, { every: 3.2, tall: 1.2, sill: 1, frame: '#f2efe7', near: true });
    if (porch) {
      // the door at the back of the porch, a step, a post at its open corner
      door(fb.front, left ? pw / 2 : w - pw / 2, '#5b3b25');
      b.solid('box', { size: [pw - 0.1, 0.2, pd - 0.1], at: [(pr.x0 + pr.x1) / 2, 0.1, (pr.z0 + pr.z1) / 2], color: '#a59a8a', detail: 1 });
      b.solid('cylinder', { radius: 0.05, size: wall, at: [left ? pr.x0 + 0.12 : pr.x1 - 0.12, wall / 2, pr.z1 - 0.12], color: '#2f2f2f', sides: 6, detail: 0 });
    } else door(ff.front, Math.min(1.4, w * 0.25), '#5b3b25');
    const rise = roofRise(form, M.x1 - M.x0, M.z1 - M.z0, { pitch }).rise;
    roofOn(b, M, wall, form, { ...roof, pitch, overhang: e, ends: { color: brick } });
    wings(b, { plan, M, e, wall, rise, pitch, form, roof, walls: { color: brick }, leanRoof: { color: R.leanColor, material: 'metal' }, lean: R.lean, leanPitch: R.leanPitch, front: rand() < 0.35 ? 'gable' : 'hip', frame: '#f2efe7' });
  },
  modern(b, { plan, M, floors, rand, big }) {
    const R = ERA_ROOFS.modern, floorsN = Math.max(1, floors), wall = 3 * floorsN, render = of(['#cfcac3', '#e6e2da', '#5b5f63', '#3d4247'], rand);
    const form: RoofForm = big ? 'flat' : pick(R.forms as Record<RoofForm, number>, rand), e = form === 'flat' ? 0.15 : R.eaves, pitch = form === 'skillion' ? between([5, 9], rand) : between(R.pitch, rand);
    const roof: Finish = { color: of(R.colors, rand), material: form === 'flat' ? 'matte' : 'metal' };
    const core = cut(M, ins(e)), s = body(b, core, wall, { color: render }), f = s.faces(), w = core.x1 - core.x0;
    // a wide glass front on the ground, a strip window above; cladding on one side
    const [ground, upper] = f.front.split('y', [3, '*']);
    ground!.inset(0.6, 0.2, w * 0.35, 0.4).panel({ color: '#1d2830', material: 'glass', lamps: 'windows', depth: 0.05, out: 0.01, detail: 1 });
    if (upper && upper.height > 1) upper.inset(0.8, 0.8, 0.8, 0.6).panel({ color: '#1d2830', material: 'glass', lamps: 'windows', depth: 0.05, out: 0.01, detail: 1 });
    door(f.front, w - w * 0.2, '#3a3f44');
    f.left.panel({ color: '#6b4f3a', depth: 0.06, out: 0, detail: 1 });
    windows(f.right, { every: 3.6, tall: 1.6, sill: 0.9, frame: '#2c3034' }); windows(f.back, { every: 3.6, tall: 1.6, sill: 0.9, frame: '#2c3034', near: true });
    // a skillion high to the street (a clerestory's), else flat or a low hip
    const rise = form === 'skillion' ? Math.min(1.6, (M.z1 - M.z0) * Math.tan((pitch * Math.PI) / 180)) : roofRise(form, M.x1 - M.x0, M.z1 - M.z0, { pitch }).rise;
    roofOn(b, M, wall, form, { ...roof, pitch, overhang: e, ...(form === 'skillion' ? { rise, high: '+z' as const } : {}), ends: { color: render } });
    wings(b, { plan, M, e, wall, rise: Math.max(rise, 0.6), pitch, form: form === 'skillion' ? 'flat' : form, roof, walls: { color: render }, leanRoof: { color: R.leanColor, material: 'metal' }, lean: R.lean, leanPitch: R.leanPitch, front: 'flat', frame: '#2c3034' });
  },
};
