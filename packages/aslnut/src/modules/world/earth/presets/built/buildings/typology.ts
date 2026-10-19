// modules › world › earth › presets › built › buildings › typology: buildings by kind, neutral. A house and an office as
// simple shapes in white to grey, every measure a param (size, levels, floor height, roof, garage, driveway; an
// office's doors and car park), carrying their kind's traits (core › entities › identity › kind): the entries at the
// front, the parking where a car stands, the service points where a charger or a meter goes, the roof as a group (its
// surface and tilt measured). They stand in for any design of their kind: an app's own house (a terrace, a house on
// stilts, a brand's store) is the app's, made with the same tools and carrying the same traits, and whatever uses a
// house (cars parking, people going in, the sun on its roof) reads only the traits. Whole, simple and box levels, as
// the car's. Its front (+z) faces its street; x across its front, its own left +x.
//   entities({ id: 'homes', shape: typology.house, data, params: (d) => ({ width: d.props.w, garage: 'left' }), heading: (d) => d.props.heading })
//   traits(typology.house.make({ levels: 2 }), kinds.house).parking → where its cars stand
import { shape, num, int, choice, flag, color } from '../../../../../../core/geometry/shapes/shape.ts';
import type { Builder, V3 } from '../../../../../../core/geometry/shapes/builder.ts';
import { roofFaces, type RoofForm } from '../../../../../../core/geometry/shapes/roofs.ts';
import { kinds } from '../../../../../../core/entities/kinds.ts';

const WHITE = '#f2f2f0', TRIM = '#d6d7d9', ROOF = '#9b9fa4', DOOR = '#6a6e73', GLASS = '#3c4248', PAVED = '#cfd0d1', LINE = '#f7f7f5';
/** a roof over a w × d rectangle at height y (its slopes in the group 'roof': their surface and tilt are the trait's) */
function roofOn(b: Builder, form: RoofForm, w: number, d: number, y: number, o: { pitch: number; eaves: number; roof: string; wall: string; trim: string; cx?: number; cz?: number }): void {
  const e = o.eaves, F = roofFaces(form, w + 2 * e, d + 2 * e, { pitch: o.pitch, ridge: 'long', endInset: e, ...(form === 'flat' ? { thick: 0.3 } : {}) }), cx = o.cx ?? 0, cz = o.cz ?? 0;
  const at = (pts: V3[]) => pts.map((p) => [p[0] + cx, p[1] + y, p[2] + cz] as V3);
  b.group('roof', (b) => b.mesh(at(F.slopes), { color: o.roof }));
  b.mesh(at(F.ends), { color: o.wall });
  b.mesh(at(F.under), { color: o.trim, detail: 0 });
}
/** windows along a face (its middle `c`, its way along `t`, its outward normal `n`), a row a floor up each level */
function windowsOn(b: Builder, c: V3, t: V3, n: V3, len: number, levels: number, floor: number, skip: (level: number, x: number) => boolean, glass: string): void {
  const k = Math.max(1, Math.floor(len / 3.1)), wh = Math.min(1.35, floor - 1.3), turn = (Math.atan2(n[0], n[2]) * 180) / Math.PI;
  if (len < 2.4 || wh < 0.5) return;
  for (let lv = 0; lv < levels; lv++) for (let j = 0; j < k; j++) {
    const s = ((j + 0.5) / k - 0.5) * len; if (skip(lv, s)) continue;
    b.solid('box', { size: [Math.min(1.2, len / k - 0.8), wh, 0.06], at: [c[0] + t[0] * s + n[0] * 0.02, lv * floor + 0.9 + wh / 2, c[2] + t[2] * s + n[2] * 0.02], turn, color: glass, material: 'glass', lamps: 'windows', detail: 1 });
  }
}

/** a house: a body of `levels` floors under a roof (gable, hip, dutch, pyramidal, skillion, flat), a door at its
 *  front, windows on each face, a garage at one side (its own right −x or left +x) with a driveway in front of it.
 *  Anchors: `entry-1` (at the door, facing it), `parking-1` and `parking-2` (on the driveway, facing the garage; one
 *  without a garage), `service-1` (a charger or a meter on the garage's front wall, beside its door; on the house's
 *  without one: a wall charger placed there charges the car at `parking-1`) */
export const house = shape({
  id: 'house', kind: kinds.house,
  params: {
    /** across its front, m */
    width: num(6, 20, 10),
    /** front to back, m */
    depth: num(6, 20, 11),
    levels: int(1, 3, 1),
    /** a floor's height, m */
    floor: num(2.7, 3.6, 3),
    roof: choice(['gable', 'hip', 'dutch', 'pyramidal', 'skillion', 'flat'], 'gable'),
    /** degrees */
    pitch: num(8, 50, 25),
    /** the roof past the walls, m */
    eaves: num(0, 0.8, 0.45),
    /** its garage: at its own right (−x), its left (+x), or none */
    garage: choice(['right', 'left', 'none'], 'right'),
    /** the driveway in front of the garage, m (the parking on it) */
    driveway: num(0, 20, 6),
    /** the driveway drawn (false: only its parking, where a lot of yours draws the ground) */
    paved: flag(true),
    wall: color(WHITE), roofing: color(ROOF), trim: color(TRIM), glass: color(GLASS), door: color(DOOR),
  },
  budget: { whole: 1600, simple: 900 },
  simple: true,
  // (far: its body and garage as boxes in their colours: the driveway is not one)
  far: (b, p) => {
    const H = p.levels * p.floor, s = p.garage === 'left' ? 1 : -1;
    b.solid('box', { size: [p.width, H + (p.roof === 'flat' ? 0.3 : p.width * 0.18), p.depth], at: [0, (H + (p.roof === 'flat' ? 0.3 : p.width * 0.18)) / 2, 0], color: p.wall });
    if (p.garage !== 'none') b.solid('box', { size: [3.8, 3, 6.4], at: [s * (p.width / 2 + 2.1), 1.5, p.depth / 2 - 3.2], color: p.wall });
  },
  build: (b: Builder, p) => {
    const w = p.width, d = p.depth, H = p.levels * p.floor, fz = d / 2, G = p.garage !== 'none', s = p.garage === 'left' ? 1 : -1;
    const gx = s * (w / 2 + 0.2 + 1.9), doorX = G ? -s * Math.min(w * 0.2, w / 2 - 1.5) : 0;
    // its body on a plinth, its roof
    b.solid('box', { size: [w + 0.14, 0.42, d + 0.14], at: [0, -0.09, 0], color: p.trim });
    b.solid('box', { size: [w, H, d], at: [0, H / 2, 0], color: p.wall });
    roofOn(b, p.roof as RoofForm, w, d, H, { pitch: p.roof === 'skillion' ? Math.min(p.pitch, 15) : p.pitch, eaves: p.eaves, roof: p.roofing, wall: p.wall, trim: p.trim });
    // its door at the front (a step before it), windows on every face (none over the door)
    b.solid('box', { size: [1.0, 2.1, 0.08], at: [doorX, 1.05, fz + 0.03], color: p.door });
    b.solid('box', { size: [1.5, 0.16, 0.7], at: [doorX, 0.08, fz + 0.35], color: p.trim, detail: 1 });
    windowsOn(b, [0, 0, fz], [1, 0, 0], [0, 0, 1], w, p.levels, p.floor, (lv, x) => lv === 0 && Math.abs(x - doorX) < 1.4, p.glass);
    windowsOn(b, [0, 0, -fz], [-1, 0, 0], [0, 0, -1], w, p.levels, p.floor, () => false, p.glass);
    windowsOn(b, [w / 2, 0, 0], [0, 0, -1], [1, 0, 0], d, p.levels, p.floor, () => false, p.glass);
    windowsOn(b, [-w / 2, 0, 0], [0, 0, 1], [-1, 0, 0], d, p.levels, p.floor, () => false, p.glass);
    b.anchor('entry-1', [doorX, 0, fz + 0.9], { kind: 'entry', heading: 180 });
    if (G) {
      // the garage: a flat roof, its door to the street (off its middle: a charger's place on the wall beside it)
      b.solid('box', { size: [3.8, 2.8, 6.4], at: [gx, 1.4, fz - 3.2], color: p.wall });
      b.group('roof', (b) => b.solid('box', { size: [4.0, 0.2, 6.6], at: [gx, 2.9, fz - 3.2], color: p.roofing }));
      b.solid('box', { size: [2.2, 2.2, 0.06], at: [gx - s * 0.4, 1.1, fz + 0.02], color: p.trim });
      // the driveway (both cars side by side), its parking, the service point
      if (p.paved && p.driveway > 0) b.solid('box', { size: [6.2, 0.04, p.driveway], at: [gx - s * 1.2, 0.02, fz + p.driveway / 2], color: PAVED, detail: 1 });
      b.anchor('service-1', [gx + s * 0.9, 0, fz + 0.25], { kind: 'service', heading: 0 });
      b.anchor('parking-1', [gx + s * 0.9, 0, fz + 3.15], { kind: 'parking', heading: 180 });
      b.anchor('parking-2', [gx - s * 1.9, 0, fz + 3.15], { kind: 'parking', heading: 180 });
    } else {
      // no garage: a parking pad beside the house, the service point on its front wall's corner
      const px = w / 2 + 1.6;
      if (p.paved && p.driveway > 0) b.solid('box', { size: [3, 0.04, p.driveway + 2], at: [px, 0.02, fz + p.driveway / 2 - 1], color: PAVED, detail: 1 });
      b.anchor('service-1', [w / 2 - 0.5, 0, fz + 0.25], { kind: 'service', heading: 0 });
      b.anchor('parking-1', [px, 0, fz + 3.15], { kind: 'parking', heading: 180 });
    }
  },
});

/** an office: a block of `levels` floors (ribbon windows, a flat roof with a parapet, or a pitched one), doors along
 *  its front under a canopy, a car park in front (rows of bays, white lines). Anchors: `entry-k` (each door, facing
 *  it), `parking-k` (the bays: the row by the building first, facing it; then the far row, facing the street),
 *  `service-k` (at the head of each bay of the first row: a charger there charges the car in that bay) */
export const office = shape({
  id: 'office', kind: kinds.office,
  params: {
    width: num(12, 60, 24), depth: num(8, 30, 14),
    levels: int(1, 12, 4),
    floor: num(3, 4.5, 3.4),
    roof: choice(['flat', 'skillion', 'gable', 'hip'], 'flat'),
    pitch: num(5, 35, 12),
    /** its doors along the front */
    entries: int(2, 6, 2),
    /** rows of bays in front: the row by the building, or both */
    carpark: int(1, 2, 2),
    /** bays a row */
    bays: int(4, 20, 9),
    /** a bay's width, m */
    bay: num(2.4, 3.2, 2.7),
    /** the car park drawn (false: only its bays' anchors, where a lot of yours draws the ground) */
    paved: flag(true),
    wall: color('#e6e7e8'), roofing: color('#a9adb1'), trim: color('#c5c8cb'), glass: color('#5d6268'), asphalt: color('#64686d'),
  },
  budget: { whole: 2600, simple: 1300 },
  simple: true,
  far: (b, p) => { const H = p.levels * p.floor; b.solid('box', { size: [p.width, H + 0.6, p.depth], at: [0, (H + 0.6) / 2, 0], color: p.wall }); },
  build: (b: Builder, p) => {
    const w = p.width, d = p.depth, H = p.levels * p.floor, fz = d / 2, bw = p.bay, n = p.bays, rows = p.carpark;
    b.solid('box', { size: [w, H, d], at: [0, H / 2, 0], color: p.wall });
    // a band of glass round each floor (on its four faces), a slab between
    for (let lv = 0; lv < p.levels; lv++) {
      const y = lv * p.floor + p.floor * 0.55, h = p.floor * 0.5;
      for (const [sz, at, turn] of [[w - 0.8, [0, y, fz + 0.03], 0], [w - 0.8, [0, y, -fz - 0.03], 0], [d - 0.8, [w / 2 + 0.03, y, 0], 90], [d - 0.8, [-w / 2 - 0.03, y, 0], 90]] as [number, V3, number][]) {
        if (lv === 0 && at[2] > 0) continue;
        b.solid('box', { size: [sz, h, 0.06], at, turn, color: p.glass, material: 'glass', lamps: 'windows', detail: 1 });
      }
    }
    // the ground floor's front: glass between the doors
    b.solid('box', { size: [w - 0.8, p.floor * 0.75, 0.06], at: [0, p.floor * 0.4, fz + 0.03], color: p.glass, material: 'glass', detail: 1 });
    if (p.roof === 'flat') {
      // a flat roof: its slab (the roof's surface), a parapet round it
      b.group('roof', (b) => b.solid('box', { size: [w, 0.2, d], at: [0, H + 0.1, 0], color: p.roofing }));
      for (const [size, at] of [[[w + 0.1, 0.7, 0.2], [0, H + 0.35, fz - 0.05]], [[w + 0.1, 0.7, 0.2], [0, H + 0.35, -fz + 0.05]], [[0.2, 0.7, d], [w / 2 - 0.05, H + 0.35, 0]], [[0.2, 0.7, d], [-w / 2 + 0.05, H + 0.35, 0]]] as [V3, V3][]) b.solid('box', { size, at, color: p.trim });
    } else roofOn(b, p.roof as RoofForm, w, d, H, { pitch: p.pitch, eaves: 0.4, roof: p.roofing, wall: p.wall, trim: p.trim });
    // the doors along the front under one canopy
    const ex = Array.from({ length: p.entries }, (_, i) => (p.entries === 1 ? 0 : (i / (p.entries - 1) - 0.5) * (w * 0.6)));
    b.solid('box', { size: [w * 0.6 + 3, 0.18, 1.8], at: [0, 3.0, fz + 0.9], color: p.trim, detail: 1 });
    ex.forEach((x, i) => {
      b.solid('box', { size: [1.8, 2.3, 0.08], at: [x, 1.15, fz + 0.06], color: '#454b51', material: 'glass' });
      b.anchor(`entry-${i + 1}`, [x, 0, fz + 0.9], { kind: 'entry', heading: 180 });
    });
    // the car park: the row by the building (cars facing it), an aisle, the far row (facing the street); the bays'
    // lines; a service point at the head of each bay of the first row
    const xs = Array.from({ length: n }, (_, j) => (j - (n - 1) / 2) * bw), z1 = fz + 3.8, z2 = fz + 15.7;
    if (rows > 0 && p.paved) {
      const z0 = fz + 0.6, zEnd = rows === 2 ? fz + 20.5 : fz + 6.6;
      b.solid('box', { size: [n * bw + 1.5, 0.04, zEnd - z0], at: [0, 0.02, (z0 + zEnd) / 2], color: p.asphalt, detail: 1 });
      for (const zr of rows === 2 ? [z1, z2] : [z1]) for (let j = 0; j <= n; j++) b.solid('box', { size: [0.12, 0.02, 5], at: [(j - n / 2) * bw, 0.045, zr], color: LINE, detail: 1 });
    }
    let k = 0;
    if (rows > 0) xs.forEach((x, j) => { b.anchor(`parking-${++k}`, [x, 0, z1], { kind: 'parking', heading: 180 }); b.anchor(`service-${j + 1}`, [x, 0, fz + 0.9], { kind: 'service', heading: 0 }); });
    if (rows > 1) xs.forEach((x) => b.anchor(`parking-${++k}`, [x, 0, z2], { kind: 'parking', heading: 0 }));
  },
});
/** the neutral buildings by kind: a house, an office (each a shape: make(params), check(), its anchors its traits) */
export const typology = {
  house, office,
  make: (k: 'house' | 'office', p: Record<string, unknown> = {}, seed = 1) => (k === 'house' ? house.make(p as never, seed) : office.make(p as never, seed)),
};
