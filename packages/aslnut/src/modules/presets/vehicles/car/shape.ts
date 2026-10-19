// modules › presets › vehicles › car: a road vehicle as a shape package. Its body is its silhouette, all params (body.ts):
// the wheelbase and the overhangs, the bonnet, the windscreen's rake, the roof's height and line, the tail, the
// clearance, the wheels and their arches, the belt, the glass, the cladding, the lamps; what it carries behind its cab
// (a bed, a box, a trailer on a hinge at its fifth wheel) and a bus's door openings and roof pods. Each type is one row
// of those numbers (presets.json: a new body is a row, not code): a type given brings its row, what you give besides
// stands over it. The paint is tinted (a fleet of colours is one build, each instance its own colour); its glass, its
// cladding and its load are groups each clone may tint; a livery on both sides; head and tail lamps that light up from
// dusk. Its wheels, front doors and a trailer are parts (their joints in kinematics.ts), with a seat for the driver
// (on the side away from the kerb: `traffic`), one for a passenger, grips on the door handles and entries beside the
// doors: the vehicle kind's traits (core › entities › identity › kind). Neutral by default (white to grey: a fleet's
// colours are its instances'). It faces +z (its front), its right side is −x, its foot at the ground; a tractor's
// trailer reaches back behind it.
//   cars.make({ type: 'van', paint: '#f2f2f2' }) · cars.suv.make() · entities({ shape: cars.citybus, data, tint: (d) => d.props.colour })
import { shape, num, int, choice, color, flag, text, type ParamsOf } from '../../../../core/geometry/shapes/shape.ts';
import { shapePackage } from '../../../../core/geometry/shapes/package.ts';
import type { Builder, Finish, V2, V3 } from '../../../../core/geometry/shapes/builder.ts';
import { mul, translate, type M } from '../../../../core/geometry/shapes/parts.ts';
import info from './shape.json' with { type: 'json' };
import presets from './presets.json' with { type: 'json' };
import { kinematics } from './kinematics.ts';
import { states } from './states.ts';
import { kinds } from '../../../../core/entities/kinds.ts';
import { silhouette, shell, half, at, beltAt, endAt, screenAt, type BodyParams, type Silhouette } from './body.ts';

export const CAR_TYPES = ['hatch', 'sedan', 'wagon', 'pickup', 'van', 'bus', 'truck', 'suv', 'crossover', 'tractor', 'citybus'] as const;
export type CarType = (typeof CAR_TYPES)[number];
const GLASS = '#2a343d', TYRE = '#141414', HUB = '#9aa0a6', DARK = '#202326', CLAD = '#2c2f32', TRIM = '#3b3e41', LOAD = '#ececea', PLATE = '#e2e2de', HEAD = '#fff6dd', TAIL = '#c01010';
/** a colour's lightness 0..1 (a livery dark on a light paint) */
const light = (c: string) => { const n = parseInt(c.replace('#', '').slice(0, 6), 16) || 0; return (0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)) / 255; };
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** a lathe's axis onto x (a wheel round its axle) */
const AX: M = [0, 1, 0, -1, 0, 0, 0, 0, 1, 0, 0, 0];
const ROWS = presets as Record<string, Record<string, unknown>>;

export const car = shape({
  id: 'car', kind: kinds.vehicle,
  params: {
    /** what it is: its row of numbers (presets.json), brought when it is given */
    type: choice(CAR_TYPES, 'hatch'),
    length: num(3.2, 14, 4.05), width: num(1.45, 2.6, 1.75), height: num(1.2, 4.2, 1.47), wheel: num(0.26, 0.6, 0.31),
    /** its axles: the wheelbase, the overhangs ahead and behind (m; scaled together to the length) */
    wheelbase: num(1.8, 8, 2.56), front: num(0.3, 3.2, 0.84), rear: num(0.3, 4, 0.65),
    /** the bonnet (m from the front to the windscreen's foot; 0: a flat front) and the windscreen's rake (degrees from upright) */
    bonnet: num(0, 2, 0.92), rake: num(0, 75, 60),
    /** the roof's line to its rear and the tail's kind */
    roofline: choice(['flat', 'falling', 'fastback'], 'falling'), tail: choice(['fastback', 'hatch', 'notch', 'box'], 'hatch'),
    /** the rear glass's rake (degrees from upright: a near-upright hatch, a saloon's rear screen, a fastback's slope) */
    tailRake: num(0, 75, 32),
    /** the floor over the ground (m), the arches round the wheels (× their radius) */
    clearance: num(0.1, 0.45, 0.14), arch: num(1.02, 1.5, 1.17),
    /** the belt (the glass's foot: a share of its height), the glass (a share of the height over the belt), the side glass
     *  back from the windscreen (a share of the cabin: a panel van's only its cab's) */
    belt: num(0.3, 0.75, 0.62), glass: num(0.3, 0.92, 0.78), windows: num(0, 1, 0.92),
    /** dark cladding on its arches, sills and bumpers' feet; its lamps' kind */
    cladding: flag(false), lights: choice(['strip', 'round', 'block'], 'block'),
    /** what it carries behind its cab: a bed, a box, a trailer (on a hinge at its fifth wheel); the cab's length (m from
     *  its front), the trailer's length, the box's or the trailer's height, the trailer's axles */
    load: choice(['none', 'tray', 'box', 'trailer'], 'none'), cab: num(1.2, 4, 2.3), loadLength: num(4, 16, 13.6), loadHeight: num(1.5, 4.5, 4), loadAxles: int(1, 4, 3),
    /** its axles (past two: a group round the rear one), a bus's door openings on its kerb side (0: a car's front doors),
     *  a bus's pods on its roof */
    axles: int(2, 4, 2), doors: int(0, 3, 0), pods: flag(false),
    paint: color('#d4d6d8'), livery: text('', 16),
    /** the side of the road it keeps to: its driver sits away from the kerb, a bus's doors open to it */
    traffic: choice(['right', 'left'], 'right'),
  },
  // a type given: its row
  defaults: (g) => (g.type !== undefined ? (ROWS[String(g.type)] as never) : null),
  budget: { whole: 7000, simple: 2600, far: 140 },
  simple: true,
  build: (b, p) => build(b, p, b.level),
  far: (b, p) => far(b, p),
});
type CarParams = ParamsOf<NonNullable<typeof car.spec.params>>;

/** the body's pieces and what is on it, its wheels, doors and load */
function build(b: Builder, p: CarParams, lv: number): void {
  const S = silhouette(p as BodyParams, lv), paint: Finish = { color: p.paint, material: 'painted', tint: true }, kerb = p.traffic === 'left' ? 1 : -1;
  const pcs = shell(S, lv, p.cladding, p.doors > 0 ? null : frontDoor(S, p));
  b.mesh(pcs.paint, { ...paint, smooth: true }); b.mesh(pcs.caps, paint);
  b.mesh(pcs.under, { color: DARK, smooth: true }); if (pcs.bed.length) b.mesh(pcs.bed, { color: TRIM, smooth: true });
  b.group('glass', (b) => { b.mesh(pcs.glass, { color: GLASS, material: 'glass', smooth: true }); glassOn(b, S, p, kerb); });
  if (p.cladding) b.group('cladding', (b) => { b.mesh(pcs.clad, { color: CLAD, smooth: true }); ends(b, S, { color: CLAD }, lv); });
  else ends(b, S, { color: DARK }, lv);
  pillars(b, S, p, kerb);
  lamps(b, S, p);
  dress(b, S, p, paint, lv);
  if (p.load === 'tray') tray(b, S, paint);
  if (p.load === 'box') box(b, S, p, lv);
  if (p.load === 'trailer') trailer(b, S, p, lv);
  wheels(b, S, p, lv);
  doors(b, S, p, paint, kerb, pcs);
  livery(b, S, p);
}

// ── the glass beyond the body's: a box tail's rear window, a bus's door openings ──
function glassOn(b: Builder, S: Silhouette, p: CarParams, kerb: number): void {
  const g: Finish = { color: GLASS, material: 'glass' };
  if (p.tail === 'box' && p.load === 'none') {
    // a rear window (two panes on a van, one on a bus) on its back
    const top = S.Hr - S.crown - S.railH, w = at(S.plan, S.z0) - 0.14, y0 = Math.max(beltAt(S, S.z0) + 0.06, top - 0.95), y1 = top + 0.05, z = S.z0 - 0.004, two = p.doors === 0;
    for (const [x0, x1] of two ? [[-w, -0.04], [0.04, w]] : [[-w, w]]) quad(b, [x0!, y0, z], [x1!, y0, z], [x1!, y1, z], [x0!, y1, z], [0, 0, -1], g);
  }
  // a bus's door openings on its kerb side (the front one is its door: a part), glass down to its floor
  for (const [z0, z1] of busDoors(S, p).slice(1)) panel(b, S, kerb, z0, z1, p.clearance + 0.04, 'glass', 0.006, g);
}
/** a bus's door openings (z from, to): the front one ahead of the front axle, the middle one ahead of the rear axle,
 *  the rear one behind it */
function busDoors(S: Silhouette, p: CarParams): [number, number][] {
  if (p.doors < 1) return [];
  const zF = S.axles[0]!, zR = S.axles[S.axles.length - 1]!, out: [number, number][] = [[zF + S.ra + 0.15, Math.min(S.zf - 0.18, zF + S.ra + 1.35)]];
  if (p.doors >= 2) out.push([zR + S.ra + 0.2, zR + S.ra + 1.4]);
  if (p.doors >= 3 && zR - S.ra - 1.4 > S.z0 + 0.4) out.push([zR - S.ra - 1.4, zR - S.ra - 0.2]);
  return out;
}
/** a flat quad (its corners in order), facing n */
function quad(b: Builder, a: V3, c: V3, d: V3, e: V3, n: V3, f: Finish): void {
  const u = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], v = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
  const k = (u[1]! * v[2]! - u[2]! * v[1]!) * n[0] + (u[2]! * v[0]! - u[0]! * v[2]!) * n[1] + (u[0]! * v[1]! - u[1]! * v[0]!) * n[2];
  b.mesh(k >= 0 ? [a, c, d, a, d, e] : [a, d, c, a, e, d], f);
}
/** a panel on a side (s: +1 its left, −1 its right) over [z0, z1]: from y0 (or the cladding's top) up to the belt or
 *  the glass's top, standing `off` m off the body */
function panel(b: Builder, S: Silhouette, s: number, z0: number, z1: number, y0: number | null, upTo: 'belt' | 'glass', off: number, f: Finish): void {
  const n = 4, tris: V3[] = [];
  const col = (z: number): V3[] => {
    const h = half(S, z), pts: V2[] = upTo === 'belt' ? h.slice(4, 10) : [h[4]!, h[5]!, h[9]!, h[11]!];
    if (y0 !== null) pts[0] = [h[4]![0], Math.min(y0, pts[1]![1] - 0.01)];
    return pts.map((q) => [s * (q[0] + off), q[1], z] as V3);
  };
  for (let i = 0; i < n; i++) {
    const a = col(z0 + ((z1 - z0) * i) / n), c = col(z0 + ((z1 - z0) * (i + 1)) / n);
    for (let j = 0; j + 1 < a.length; j++) { const A = a[j]!, B = a[j + 1]!, C = c[j + 1]!, D = c[j]!; if (s > 0) tris.push(A, B, C, A, C, D); else tris.push(A, C, B, A, D, C); }
  }
  b.mesh(tris, { ...f, smooth: true });
}
/** a strip on the side glass between z0 and z1 (a pillar), on the sides given */
function strip(b: Builder, S: Silhouette, z0: number, z1: number, f: Finish, sides: readonly number[] = [1, -1]): void {
  for (const s of sides) {
    const a = half(S, z0), c = half(S, z1); if (a[11]![1] - a[9]![1] < 0.08 || c[11]![1] - c[9]![1] < 0.08) continue;
    const P = (q: V2, z: number): V3 => [s * (q[0] + 0.004), q[1], z];
    for (const k of [9, 10]) quad(b, P(a[k]!, z0), P(c[k]!, z1), P(c[k + 1]!, z1), P(a[k + 1]!, z0), [s, 0, 0], f);
  }
}
/** the pillars on the side glass: a car's dark one behind its front doors, a bus's between its windows */
function pillars(b: Builder, S: Silhouette, p: CarParams, kerb: number): void {
  const f: Finish = { color: '#16191c', detail: 1 };
  if (p.doors > 0) {
    // a bus: a pillar every 1.4 m or so, none across a door on its kerb side
    const open = busDoors(S, p), z1 = S.band[1] - 0.25, z0 = S.band[0] + 0.25, n = Math.max(1, Math.round((z1 - z0) / 1.4));
    for (let i = 0; i <= n; i++) {
      const z = z0 + ((z1 - z0) * i) / n;
      strip(b, S, z - 0.035, z + 0.035, f, open.some(([a, c]) => z > a - 0.1 && z < c + 0.1) ? [-kerb] : [1, -1]);
    }
    return;
  }
  const d = frontDoor(S, p); if (d[0] > S.band[0] + 0.3 && d[0] < S.band[1] - 0.3) strip(b, S, d[0] - 0.08, d[0], f);
}
/** the front doors' z (from, to): behind the front arch on a car, over the front wheel on a cab over it, a bus's
 *  ahead of its front axle */
function frontDoor(S: Silhouette, p: CarParams): [number, number] {
  const zF = S.axles[0]!;
  if (p.doors > 0) return busDoors(S, p)[0]!;
  if (p.bonnet < 0.25) { const z1 = S.zf - 0.28; return [z1 - Math.min(1.15, (S.zf - S.z0) * 0.5), z1]; }
  const z1 = zF - S.ra - S.cladW - 0.05; return [z1 - clamp(S.L * 0.25, 0.85, 1.2), z1];
}

// ── the ends: an intake low across a car's nose, a dark band across its tail ──
function ends(b: Builder, S: Silhouette, f: Finish, lv: number): void {
  if (lv > 1) return;
  const yb = at(S.bottom, S.zf), wf = at(S.plan, S.zf) - 0.12, wr = at(S.plan, S.z0) - 0.12, zf = S.zf + 0.004, zr = S.z0 - 0.004, h = S.u > 0.5 ? 0.12 : 0.15;
  quad(b, [-wf, yb + 0.05, zf], [wf, yb + 0.05, zf], [wf, yb + 0.05 + h, zf], [-wf, yb + 0.05 + h, zf], [0, 0, 1], f);
  const ybr = at(S.bottom, S.z0);
  quad(b, [-wr, ybr + 0.04, zr], [wr, ybr + 0.04, zr], [wr, ybr + 0.14, zr], [-wr, ybr + 0.14, zr], [0, 0, -1], f);
}
// ── the lamps: strips across its ends, round ones or blocks at its corners (they light up from dusk) ──
function lamps(b: Builder, S: Silhouette, p: CarParams): void {
  const big = S.u > 0.5, boxTail = p.tail === 'box' || p.load !== 'none';
  const yF = big ? Math.max(0.42, p.clearance + 0.3) : S.yN - 0.075;
  const yR = boxTail ? (p.load === 'tray' ? beltAt(S, S.zr) - 0.2 : Math.min(beltAt(S, S.z0) - 0.15, S.H - 0.6)) : at(S.top, S.z0) - 0.1;
  lampSet(b, S, p.lights, true, yF, { color: HEAD, lamps: 'head', detail: 1 });
  // (a box or a trailer carries its own tail lamps)
  if (p.load !== 'box' && p.load !== 'trailer') lampSet(b, S, p.lights, false, yR, { color: TAIL, lamps: 'tail', detail: 1 }, boxTail && big);
}
function lampSet(b: Builder, S: Silhouette, kind: string, front: boolean, y: number, f: Finish, tall = false): void {
  const s = front ? 1 : -1, w = at(S.plan, front ? S.zf : S.z0), edge = (x: number) => endAt(S, Math.abs(x), front) + s * 0.005;
  if (kind === 'strip') {
    // a band across the end, round its corners a little way
    const xs = Math.min(S.hw - 0.04, w + (S.hw - w) * 0.75), h = 0.045, k = 10, tris: V3[] = [];
    for (let i = 0; i < k; i++) {
      const xa = -xs + (2 * xs * i) / k, xb = -xs + (2 * xs * (i + 1)) / k, za = edge(xa), zb = edge(xb);
      const A: V3 = [xa, y - h / 2, za], B: V3 = [xb, y - h / 2, zb], C: V3 = [xb, y + h / 2, zb], D: V3 = [xa, y + h / 2, za];
      if (front) tris.push(A, B, C, A, C, D); else tris.push(A, C, B, A, D, C);
    }
    b.mesh(tris, f); return;
  }
  const x = Math.max(0.2, w - (kind === 'round' ? 0.16 : 0.2)), big = S.u > 0.5;
  for (const sx of [-1, 1]) {
    const z = edge(sx * x);
    if (kind === 'round') b.solid('cylinder', { radius: big ? 0.11 : 0.085, size: 0.03, axis: 'z', at: [sx * x, y, z - s * 0.01], sides: 12, ...f });
    else b.solid('box', { size: tall ? [0.12, 0.42, 0.03] : [big ? 0.34 : 0.3, big ? 0.15 : 0.11, 0.03], at: [sx * (tall ? w - 0.1 : x), tall ? y + 0.1 : y, z - s * 0.01], ...f });
  }
}
// ── what is on it: mirrors, plates, seams; a box's bumper; a bus's roof pods and its sign ──
function dress(b: Builder, S: Silhouette, p: CarParams, paint: Finish, lv: number): void {
  const big = S.u > 0.5, d0: Finish = { detail: 0 };
  // the mirrors: a car's on its doors at the windscreen's foot, a bus's or a truck's on arms
  for (const s of [1, -1]) {
    if (big) {
      const z = S.zf - 0.1, y = beltAt(S, z) + 0.45, x = S.hw + 0.22;
      b.solid('box', { size: [0.26, 0.04, 0.04], at: [s * (S.hw + 0.1), y + 0.32, z], color: DARK, ...d0 });
      b.solid('box', { size: [0.07, 0.36, 0.17], at: [s * x, y, z], color: DARK, ...d0 });
    } else {
      // (on a short dark stalk off the door's top, at the windscreen's foot)
      const z = S.zC - 0.16, y = beltAt(S, z) + 0.07, x0 = half(S, z)[9]![0];
      b.solid('box', { size: [0.09, 0.035, 0.05], at: [s * (x0 + 0.045), y - 0.03, z + 0.01], color: DARK, ...d0 });
      b.solid('box', { size: [0.15, 0.1, 0.07], at: [s * (x0 + 0.13), y, z], ...paint, ...d0 });
    }
  }
  // plates front and back
  const pf = at(S.bottom, S.zf) + 0.24, pr = p.load === 'none' || p.load === 'tray' ? Math.max(at(S.bottom, S.z0) + 0.3, at(S.top, S.z0) - 0.32) : 0;
  quad(b, [-0.26, pf - 0.055, S.zf + 0.006], [0.26, pf - 0.055, S.zf + 0.006], [0.26, pf + 0.055, S.zf + 0.006], [-0.26, pf + 0.055, S.zf + 0.006], [0, 0, 1], { color: PLATE, detail: 0 });
  if (pr) quad(b, [-0.26, pr - 0.055, S.z0 - 0.006], [0.26, pr - 0.055, S.z0 - 0.006], [0.26, pr + 0.055, S.z0 - 0.006], [-0.26, pr + 0.055, S.z0 - 0.006], [0, 0, -1], { color: PLATE, detail: 0 });
  // a box's bumper across its front
  if (big || p.load === 'box' || p.load === 'trailer') b.solid('box', { size: [S.W * 0.97, 0.22, 0.14], at: [0, p.clearance + 0.16, S.zf - 0.03], color: TRIM, detail: 1 });
  // a bus's roof pods (its cooling, its batteries) and its sign over the windscreen
  if (p.pods) {
    const pw = S.W * 0.36, ph = 0.28, rr = 0.1, prof: V2[] = [];
    for (const [cx, cy, a0] of [[pw - rr, ph - rr, 0], [-pw + rr, ph - rr, 90], [-pw + rr, rr, 180], [pw - rr, rr, 270]] as const) for (let k = 0; k <= 2; k++) { const a = ((a0 + k * 45) * Math.PI) / 180; prof.push([-(cx + Math.cos(a) * rr), -(cy + Math.sin(a) * rr)]); }
    const span = S.zf - S.z0;
    for (const [z0, z1] of [[S.zf - span * 0.38, S.zf - span * 0.16], [S.z0 + span * 0.06, S.z0 + span * 0.24]] as const) b.sweep(prof, [[0, S.H, z0], [0, S.H, z1]], { ...paint, detail: 1 });
  }
  if (p.doors > 0) {
    const y0 = S.H - S.railH * 0.55, y1 = S.H - 0.06, w = at(S.plan, S.zf) - 0.2, z0 = screenAt(S, y0) + 0.006, z1 = screenAt(S, y1) + 0.006;
    quad(b, [-w, y0, z0], [w, y0, z0], [w, y1, z1], [-w, y1, z1], [0, 0, 1], { color: '#121416', detail: 1 });
  }
  // the seams round the front doors
  if (lv === 0 && p.doors === 0) for (const z of frontDoor(S, p)) for (const s of [1, -1]) {
    const h = half(S, z), a = h[4]!, c = h[9]!;
    quad(b, [s * (a[0] + 0.003), a[1], z - 0.006], [s * (a[0] + 0.003), a[1], z + 0.006], [s * (c[0] + 0.003), c[1], z + 0.006], [s * (c[0] + 0.003), c[1], z - 0.006], [s, 0, 0], { color: DARK, detail: 0 });
  }
}
// ── a pickup's bed: its walls and its tailgate ──
function tray(b: Builder, S: Silhouette, paint: Finish): void {
  const z1 = S.zEnd, z0 = S.zr, y1 = beltAt(S, S.zr), y0 = at(S.top, (z0 + z1) / 2) - S.crown, l = z1 - z0;
  for (const s of [1, -1]) { const x = at(S.plan, (z0 + z1) / 2) - S.sr - 0.03; b.solid('box', { size: [0.06, y1 - y0, l], at: [s * x, (y0 + y1) / 2, (z0 + z1) / 2], ...paint }); }
  b.solid('box', { size: [at(S.plan, z0 + 0.05) * 2 - 0.08, y1 - y0, 0.06], at: [0, (y0 + y1) / 2, z0 + 0.04], ...paint });
}
/** a rounded rectangle across x (±w) and up (y0 to y1), as a profile swept along +z sees it ([−x, −y]) */
function slab(w: number, y0: number, y1: number, rr: number, n = 1): V2[] {
  const out: V2[] = [], r = Math.min(rr, w * 0.4, (y1 - y0) * 0.4);
  for (const [cx, cy, a0] of [[w - r, y1 - r, 0], [-w + r, y1 - r, 90], [-w + r, y0 + r, 180], [w - r, y0 + r, 270]] as const) for (let k = 0; k <= n; k++) { const a = ((a0 + (n ? (k * 90) / n : 45)) * Math.PI) / 180; out.push([-(cx + Math.cos(a) * r), -(cy + Math.sin(a) * r)]); }
  return out;
}
// ── a truck's box behind its cab, on its chassis ──
function box(b: Builder, S: Silhouette, p: CarParams, lv: number): void {
  const y0 = 2 * S.r + 0.22, y1 = Math.max(y0 + 1, p.loadHeight), z1 = S.z0 - 0.12, z0 = S.zr;
  chassis(b, S, z0 + 0.2, S.z0 + 0.1, lv);
  b.group('load', (b) => b.sweep(slab(S.hw, y0, y1, 0.06, lv ? 0 : 1), [[0, 0, z0], [0, 0, z1]], { color: LOAD }));
  rearOf(b, z0, S.hw, y0);
}
/** the rear of a box or a trailer: its lamps, its bar under it */
function rearOf(b: Builder, z: number, w: number, y0: number): void {
  for (const s of [1, -1]) b.solid('box', { size: [0.3, 0.12, 0.03], at: [s * (w - 0.25), y0 - 0.16, z - 0.02], color: TAIL, lamps: 'tail', detail: 1 });
  b.solid('box', { size: [w * 1.8, 0.1, 0.1], at: [0, y0 - 0.32, z + 0.1], color: TRIM, detail: 1 });
}
/** a truck's chassis behind its cab: its rails, a tank */
function chassis(b: Builder, S: Silhouette, z0: number, z1: number, lv: number): void {
  const y = 2 * S.r - 0.05;
  for (const s of [1, -1]) b.solid('box', { size: [0.1, 0.28, z1 - z0], at: [s * 0.45, y, (z0 + z1) / 2], color: DARK, detail: 1 });
  if (lv === 0) b.solid('cylinder', { radius: 0.3, size: 1.1, axis: 'z', at: [S.hw - 0.42, S.r + 0.12, S.z0 - 0.7], color: '#b9bcbf', material: 'metal', sides: 12 });
}
// ── a tractor's trailer: a box on its axles, hitched at the fifth wheel by a hinge (a part: it turns there) ──
function trailer(b: Builder, S: Silhouette, p: CarParams, lv: number): void {
  const t = hitchOf(S, p), w = Math.min(S.hw + 0.02, 1.3), yF = t.y + 0.06, y1 = Math.max(yF + 1.2, p.loadHeight);
  chassis(b, S, S.zr + 0.1, S.z0 + 0.1, lv);
  // the fifth wheel's plate; where the trailer is pulled from and what follows (core › entities › kinematics: hitch)
  b.solid('cylinder', { radius: 0.42, size: 0.1, at: [0, t.y - 0.05, t.z], color: DARK, sides: 12, detail: 1 });
  b.anchor('hitch', [0, t.y, t.z], { kind: 'hitch' });
  b.anchor('trailerAxle', [0, S.r, t.axle], { kind: 'axle' });
  b.part('trailer', (b) => {
    b.group('load', (b) => b.sweep(slab(w, yF, y1, 0.07, lv ? 0 : 1), [[0, 0, t.rear], [0, 0, t.front]], { color: LOAD }));
    // its frame under the floor, its landing legs, the guards along its sides
    for (const s of [1, -1]) b.solid('box', { size: [0.12, 0.3, t.front - t.rear - 0.3], at: [s * 0.5, yF - 0.15, (t.front + t.rear) / 2], color: DARK, detail: 1 });
    const legs = t.front - 2.4, first = t.wheels[0]!, last = t.wheels[t.wheels.length - 1]!;
    for (const s of [1, -1]) {
      b.solid('box', { size: [0.1, yF - 0.08, 0.14], at: [s * 0.85, (yF - 0.08) / 2 + 0.06, legs], color: TRIM, detail: 0 });
      if (legs - first - S.r > 1) b.solid('box', { size: [0.03, 0.32, legs - first - S.r - 0.6], at: [s * (w - 0.04), yF - 0.42, (legs + first + S.r) / 2], color: TRIM, detail: 0 });
    }
    // its axles: dual tyres each side, under their guards (they turn with it)
    for (const z of t.wheels) for (const s of [1, -1]) tyre(b, [s * (w - 0.32), S.r, z], S.r, 0.56, s, lv);
    for (const s of [1, -1]) b.solid('box', { size: [0.62, 0.04, first - last + 2 * S.r + 0.2], at: [s * (w - 0.32), 2 * S.r + 0.08, (first + last) / 2], color: DARK, detail: 1 });
    rearOf(b, t.rear, w, yF);
    if (p.livery) labelSides(b, p.livery, w + 0.004, (yF + y1) / 2, (t.front + t.rear) / 2, t.front - t.rear - 1.2, Math.min(0.8, (y1 - yF) * 0.3), '#1b1b1b');
  }, { pivot: [0, t.y, t.z], joint: { kind: 'hinge', axis: 'y', limits: [-100, 100] } });
}
/** a tractor's hitch: the fifth wheel (its height, its z: a little ahead of the drive axles), the trailer's front and
 *  rear, its axles' z and their middle (what its hinge turns round, what it is pulled by) */
export function hitchOf(S: Silhouette, p: { loadLength: number; loadAxles: number }): { y: number; z: number; front: number; rear: number; wheels: number[]; axle: number } {
  const drive = S.axles.slice(1), zd = drive.reduce((a, z) => a + z, 0) / Math.max(1, drive.length), z = Math.min(zd + 0.3, S.z0 - 0.4), y = 2 * S.r + 0.2;
  const front = Math.min(z + 1.2, S.z0 - 0.5), rear = front - p.loadLength, n = Math.max(1, Math.round(p.loadAxles));
  const wheels = Array.from({ length: n }, (_, i) => rear + 1.25 + S.r + (n - 1 - i) * 1.31);
  return { y, z, front, rear, wheels, axle: wheels.reduce((a, q) => a + q, 0) / n };
}
// ── the wheels: tyres on their hubs, the rims' spokes (parts: they spin, the front ones steer) ──
function tyre(b: Builder, at: V3, r: number, w: number, s: number, lv: number): void {
  const sides = lv ? 8 : 14, c = Math.min(0.045, w * 0.22), o = (-s * w) / 2;
  b.within(mul(translate(at), AX), () => {
    // (a lathe here turns round x: its height along −x, the outer face at −s·w/2)
    b.lathe([[r * 0.68, -w / 2], [r, -w / 2 + c], [r, w / 2 - c], [r * 0.68, w / 2]], { color: TYRE, segments: sides });
    b.lathe(s > 0 ? [[0, o + 0.03], [r * 0.7, o]] : [[r * 0.7, o], [0, o - 0.03]], { color: HUB, material: 'metal', segments: sides, smooth: false });
    for (const turn of [0, 60, 120]) b.solid('box', { size: [r * 1.2, 0.014, 0.075], at: [0, o - s * 0.006, 0], turn, color: '#c3c7cb', material: 'metal', detail: 0 });
  });
}
function wheels(b: Builder, S: Silhouette, p: CarParams, lv: number): void {
  const n = S.axles.length, behind = p.load === 'box' || p.load === 'trailer';
  S.axles.forEach((z, i) => {
    const name = i === 0 ? 'F' : i === n - 1 ? 'R' : i === 1 ? 'M' : 'N', dual = i > 0 && S.r >= 0.45, w = dual ? S.tw * 1.85 : S.tw;
    const x = (behind && i > 0 ? S.hw - 0.06 : S.hw - 0.03) - w / 2;
    for (const [s, side] of [[1, 'L'], [-1, 'R']] as const) b.part(`wheel${name}${side}`, (b) => tyre(b, [s * x, S.r, z], S.r, w, s, lv), { pivot: [s * x, S.r, z], joint: { kind: 'wheel', axis: 'x', radius: S.r } });
    // (the wheels behind a cab: a guard over them)
    if (behind && i > 0 && i === n - 1) for (const s of [1, -1]) b.solid('box', { size: [w + 0.08, 0.04, S.axles[1]! - z + 2 * S.r + 0.2], at: [s * x, 2 * S.r + 0.08, (S.axles[1]! + z) / 2], color: DARK, detail: 1 });
  });
}
// ── the front doors (parts on hinges at their front edges), a grip on each, an entry beside each; the seats ──
function doors(b: Builder, S: Silhouette, p: CarParams, paint: Finish, kerb: number, pcs: { doorL: V3[]; doorR: V3[] }): void {
  const [dz0, dz1] = frontDoor(S, p), bus = p.doors > 0, mid = (dz0 + dz1) / 2, hm = half(S, mid);
  const dy0 = bus ? p.clearance + 0.04 : hm[4]![1], dy1 = bus ? hm[11]![1] : hm[9]![1], gy = dy0 + (dy1 - dy0) * (bus ? 0.45 : 0.8);
  // (a bus's: its door opening on its kerb side, a narrow one for its driver on the other)
  const from = (s: number) => (bus && s !== kerb ? dz1 - 0.7 : dz0);
  for (const [s, n] of [[1, 'L'], [-1, 'R']] as const) {
    const z0 = from(s), x = at(S.plan, dz1);
    b.part(`door${n}`, (b) => {
      // (a car's: its side's span cut from the body, shaded as it is; a bus's: a glass panel on its side)
      if (bus) panel(b, S, s, z0, dz1, p.clearance + 0.04, 'glass', 0.005, { color: GLASS, material: 'glass' });
      else b.mesh(s > 0 ? pcs.doorL : pcs.doorR, { ...paint, smooth: true });
      b.solid('box', { size: [0.04, 0.04, 0.18], at: [s * (at(S.plan, z0 + 0.2) + 0.03), gy, z0 + 0.2], color: HUB, material: 'metal', detail: 0 });
    }, { pivot: [s * (x + 0.016), (dy0 + dy1) / 2, dz1], joint: { kind: 'hinge', axis: 'y', limits: s > 0 ? [0, 70] : [-70, 0] } });
  }
  for (const [s, n] of [[1, 'L'], [-1, 'R']] as const) {
    const z0 = from(s);
    b.anchor(`grip${n}`, [s * (at(S.plan, z0 + 0.2) + 0.05), gy, z0 + 0.2], { kind: 'grip' });
    b.anchor(`entry${n}`, [s * (S.hw + 0.6), 0, (z0 + dz1) / 2], { kind: 'entry', heading: s > 0 ? -90 : 90 });
  }
  // the seats: the driver's away from the kerb (on the right where traffic keeps left), a passenger beside
  const ds = p.traffic === 'left' ? -1 : 1, seatY = S.u > 0.5 ? Math.max(p.clearance + 0.5, beltAt(S, mid) - 0.55) : p.clearance + 0.38, seatZ = mid - 0.15;
  b.anchor('driver', [ds * S.W * 0.22, seatY, seatZ], { kind: 'seat' });
  b.anchor('passenger', [-ds * S.W * 0.22, seatY, seatZ], { kind: 'seat' });
}
// ── the livery on both sides, in a colour that reads on the paint (on a truck's box; a trailer's on the trailer) ──
function livery(b: Builder, S: Silhouette, p: CarParams): void {
  if (!p.livery || p.load === 'trailer') return;
  const ink = light(p.paint) > 0.55 ? '#1b1b1b' : '#ffffff';
  if (p.load === 'box') { const y0 = 2 * S.r + 0.22, y1 = Math.max(y0 + 1, p.loadHeight); labelSides(b, p.livery, S.hw + 0.004, (y0 + y1) / 2, (S.z0 + S.zr) / 2, S.z0 - S.zr - 0.8, Math.min(0.8, (y1 - y0) * 0.3), '#1b1b1b'); return; }
  const z = p.doors > 0 ? (S.zf + S.z0) / 2 - 0.4 : (S.axles[0]! + S.axles[S.axles.length - 1]!) / 2, h = half(S, z);
  const y = p.doors > 0 ? h[9]![1] - 0.3 : (h[4]![1] + h[6]![1]) / 2, len = p.doors > 0 ? S.L - 2.5 : S.L * 0.5;
  labelSides(b, p.livery, h[5]![0] + 0.02, y, z, len, p.doors > 0 ? 0.42 : 0.26, ink);
}
function labelSides(b: Builder, t: string, x: number, y: number, z: number, len: number, most: number, ink: string): void {
  const h = Math.min(most, (len * 0.9) / Math.max(1, t.length) / (6 / 7));
  for (const s of [1, -1]) b.label(t, { at: [s * x, y, z], facing: [s, 0, 0], height: h, color: ink, detail: 0 });
}

// ── far away: its side's outline across its width (its paint), its glass a dark band each side and its windscreen,
// its head lamps; a box or a trailer's box behind (the trailer on its hinge) ──
function far(b: Builder, p: CarParams): void {
  const S = silhouette(p as BodyParams, 2), w = S.hw * 0.97, paint: Finish = { color: p.paint, material: 'painted', tint: true };
  // (a sweep along +x: the profile's [z, −y])
  const outline: V2[] = [...S.bottom.map(([z, y]) => [z, -y] as V2), ...[...S.top].reverse().map(([z, y]) => [z, -y] as V2)];
  b.sweep(outline, [[-w, 0, 0], [w, 0, 0]], paint);
  const g: Finish = { color: GLASS, material: 'glass' }, be = beltAt(S, S.band[0]) + 0.02, zA = S.zC - 0.1, top = S.H - S.railH - S.crown;
  const zTop = Math.max(S.band[0] + 0.1, screenAt(S, top) - 0.1), back = Math.max(S.band[0], S.zEnd + 0.15);
  if (zA - back > 0.3 && zTop > back + 0.1) for (const s of [1, -1]) quad(b, [s * (w + 0.01), be, back], [s * (w + 0.01), be, zA], [s * (w + 0.01), top, zTop], [s * (w + 0.01), top, back + 0.1], [s, 0, 0], g);
  const y0 = S.yCowl + 0.04, y1 = S.H - S.railH * 0.6, z0 = screenAt(S, y0) + 0.02, z1 = screenAt(S, y1) + 0.02, ww = w * 0.8;
  quad(b, [-ww, y0, z0], [ww, y0, z0], [ww, y1, z1], [-ww, y1, z1], [0, 0.5, 1], g);
  for (const s of [-1, 1]) quad(b, [s * (w - 0.35), S.yN - 0.12, S.zf + 0.01], [s * (w - 0.08), S.yN - 0.12, S.zf + 0.01], [s * (w - 0.08), S.yN - 0.02, S.zf + 0.01], [s * (w - 0.35), S.yN - 0.02, S.zf + 0.01], [0, 0, 1], { color: HEAD, lamps: 'head' });
  // (a box down to its chassis: nothing under it shows far away)
  if (p.load === 'box') { const yb = 2 * S.r + 0.22; b.sweep(slab(S.hw, yb - 0.5, Math.max(yb + 1, p.loadHeight), 0, 0), [[0, 0, S.zr], [0, 0, S.z0 - 0.12]], { color: LOAD }); }
  if (p.load === 'trailer') {
    const t = hitchOf(S, p), yF = t.y + 0.06;
    b.part('trailer', (b) => b.sweep(slab(Math.min(S.hw + 0.02, 1.3), yF - 0.5, Math.max(yF + 1.2, p.loadHeight), 0, 0), [[0, 0, t.rear], [0, 0, t.front]], { color: LOAD }), { pivot: [0, t.y, t.z], joint: { kind: 'hinge', axis: 'y', limits: [-100, 100] } });
  }
}
/** the car as a package: its info (shape.json), presets (presets.json), kinematics and states */
const pkg = shapePackage({ info, shape: car, presets: presets as Record<string, Partial<CarParams>>, kinematics, states });
export default pkg;
