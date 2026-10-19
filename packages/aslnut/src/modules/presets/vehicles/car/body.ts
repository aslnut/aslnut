// modules › presets › vehicles › car › body: a road vehicle's body from its silhouette params. Its side view is lines
// along its length (z: its rear −, its front +): its top (the front's face, the bonnet, the windscreen at its rake, the
// roof by its roofline, the tail by its kind), its floor (the clearance, rising at the bumpers) and its belt (the
// glass's foot); its plan narrows to round its ends. The body is that profile swept across its width: at each station
// along it a section (the floor, a well over each tyre, the sill, the side, the shoulder rounded, the glass leaning
// in, the roof's rail and its crown), joined station to station as smooth panels (two lofts meeting at the shoulder,
// each with the stations it needs: the wells' below, the glass's above). Its pieces: the paint, the glass (the
// windscreen, the side glass and the rear glass wrapping round between the pillars), the cladding (the sills, the
// arches' lips, the bumpers' feet), the underside and a pickup's bed.
import { triangulate, type V2, type V3 } from '../../../../core/geometry/shapes/builder.ts';

/** the params the body is made from (the car's: shape.ts) */
export interface BodyParams {
  length: number; width: number; height: number; wheel: number; wheelbase: number; front: number; rear: number;
  bonnet: number; rake: number; roofline: string; tail: string; tailRake: number; clearance: number; arch: number; belt: number; glass: number;
  windows: number; cladding: boolean; load: string; cab: number; axles: number; doors: number;
}
/** a line in the side view: [z, y] points, rear to front (each z once) */
export type Line = [number, number][];
/** a piece of the body: what its panels are made of */
export type Piece = 'paint' | 'glass' | 'clad' | 'under' | 'bed';
/** the body's silhouette: its measures, its lines and its plan, what its section is made of along it */
export interface Silhouette {
  L: number; W: number; H: number; r: number; hw: number;
  /** its front, its rear, the body's rear end (a cab's back, a box or a trailer behind), the cabin's rear end */
  zf: number; zr: number; z0: number; zEnd: number;
  /** its axles (z, front first), the arches' radius, the tyres' width, the wells' depth in from the side */
  axles: number[]; ra: number; tw: number; archIn: number;
  /** how upright its front is (0: a car's raked windscreen; 1: a bus's, a truck's) */
  u: number;
  /** the windscreen's foot (the cowl): where, how high; the front face's top; the roof's front and rear (where the
   *  windscreen meets it, where the tail leaves it) and its height there */
  zC: number; yCowl: number; yN: number; zRF: number; zRR: number; Hf: number; Hr: number;
  top: Line; bottom: Line; plan: Line;
  /** the belt: its height at the cowl, its rise to the rear (m a metre) */
  belt0: number; rise: number;
  /** the section's measures: the glass's lean (its tangent), the ledge at its foot, the rail's rounding, the roof's
   *  crown, the shoulder's rounding, the sill's tuck under, the cladding round the arches and along the sills, the rail
   *  (from the glass's top to the roof), the pillars round the side glass (its front and back edges behind the
   *  windscreen's and the tail's lines) */
  lean: number; ledge: number; rr: number; crown: number; sr: number; tuck: number; cladW: number; cladH: number; railH: number; pillar: number;
  /** the side's shape: the sill tucked in under it (m), the shoulder line under the belt (m), the glass bowed out (m) */
  tuckIn: number; line: number; bow: number;
  /** the stretches of the top that are glass (the windscreen, the rear glass), the side glass's (z from, to): its back
   *  edge a slanted pillar, the glass's top coming down to its foot over `slant` m (none: it runs to the tail) */
  topGlass: [number, number][]; band: [number, number]; slant: number;
  /** a pickup's bed: the stretch of the top that is its floor */
  bed: [number, number] | null;
  /** the stations a loft must share (the shoulder's line curves there) */
  shared: number[];
  /** the level it is made for (0 whole, 1 simple: a lighter section, 2 far) */
  level: number;
}

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** a line's height at z (between its points; held past its ends) */
export function at(l: Line, z: number): number {
  if (z <= l[0]![0]) return l[0]![1];
  const n = l.length; if (z >= l[n - 1]![0]) return l[n - 1]![1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (l[m]![0] <= z) lo = m; else hi = m; }
  const a = l[lo]!, b = l[hi]!, f = (z - a[0]) / (b[0] - a[0] || 1);
  return a[1] + (b[1] - a[1]) * f;
}
/** the places along z where a line crosses a height (between its points) */
function crossings(l: Line, y: number): number[] {
  const out: number[] = [];
  for (let i = 0; i + 1 < l.length; i++) { const a = l[i]!, b = l[i + 1]!; if ((a[1] - y) * (b[1] - y) < 0) out.push(a[0] + ((y - a[1]) / (b[1] - a[1])) * (b[0] - a[0])); }
  return out;
}
/** a line through control points [z, y, round] (front to rear), each corner rounded over `round` m either side (a
 *  quadratic curve of `n` pieces): its points rear to front */
function rounded(cp: readonly [number, number, number][], n: number): Line {
  const out: [number, number][] = [];
  for (let i = 0; i < cp.length; i++) {
    const [z, y, rd] = cp[i]!;
    if (i === 0 || i === cp.length - 1 || rd <= 0 || n < 1) { out.push([z, y]); continue; }
    const a = cp[i - 1]!, c = cp[i + 1]!, la = Math.hypot(a[0] - z, a[1] - y) || 1, lc = Math.hypot(c[0] - z, c[1] - y) || 1, d = Math.min(rd, la * 0.45, lc * 0.45);
    const A = [z + ((a[0] - z) * d) / la, y + ((a[1] - y) * d) / la], C = [z + ((c[0] - z) * d) / lc, y + ((c[1] - y) * d) / lc];
    for (let k = 0; k <= n; k++) { const t = k / n, s = 1 - t; out.push([s * s * A[0]! + 2 * s * t * z + t * t * C[0]!, s * s * A[1]! + 2 * s * t * y + t * t * C[1]!]); }
  }
  out.reverse();
  const line: Line = [];
  for (const p of out) if (!line.length || p[0] > line[line.length - 1]![0] + 1e-4) line.push(p);
  return line;
}

/** the silhouette from the params, its curves in pieces for a level (0 whole, 1 simple, 2 far) */
export function silhouette(p: BodyParams, level = 0): Silhouette {
  const L = p.length, W = p.width, H = p.height, r = p.wheel, hw = W / 2, zf = L / 2, zr = -L / 2;
  const u = clamp((55 - p.rake) / 45, 0, 1), n = level === 0 ? 4 : level === 1 ? 2 : 0;
  // the axles: the overhangs and the wheelbase scaled to the length; past two, a group round the rear axle's place
  const k = L / Math.max(0.1, p.front + p.wheelbase + p.rear), zFA = zf - p.front * k, zRA = zFA - p.wheelbase * k;
  const rest = Math.max(1, Math.round(p.axles) - 1), axles = [zFA, ...Array.from({ length: rest }, (_, i) => zRA + (((rest - 1) / 2) - i) * 1.35)];
  // with a box or a trailer behind, the body is its cab; with a bed, the cabin ends where the bed starts
  const load = p.load, cab = clamp(p.cab, 1, L - 0.5), z0 = load === 'box' || load === 'trailer' ? zf - cab : zr, zEnd = load === 'none' ? zr : zf - cab;
  const ra = r * p.arch, tw = clamp(0.12 + r * 0.32, 0.16, 0.34), archIn = Math.min(tw + 0.1, hw * 0.45);
  // the section's measures, rounder on a car than on a bus
  const lean = Math.tan(((24 - 21 * u) * Math.PI) / 180), ledge = 0.03 - 0.018 * u, rr = 0.12 - 0.085 * u, crown = W * (0.03 - 0.024 * u), sr = 0.075 - 0.05 * u;
  const tuck = 0.05, cladW = 0.055, cladH = p.cladding ? 0.1 : 0.06, tuckIn = 0.012 + 0.055 * (1 - u), line = 0.03 + 0.08 * (1 - u), bow = 0.004 + 0.016 * (1 - u);
  // the belt, rising a little to the rear on a car; the cowl at it; the front's face below a bonnet
  const belt0 = clamp(p.belt * H, p.clearance + 0.25, H - 0.2), bonnet = clamp(p.bonnet, 0, L * 0.45), hasBonnet = bonnet >= 0.25;
  const zC = zf - bonnet, rise = (1 - u) * 0.012, yCowl = belt0 - 0.02 * (1 - u);
  const yN = hasBonnet ? yCowl - Math.min(0.2, 0.07 + 0.06 * bonnet) : yCowl;
  const railH = Math.max(0.05, (1 - clamp(p.glass, 0.2, 0.95)) * (H - belt0));
  const beltAt = (z: number) => belt0 + (z < zC ? (zC - z) * rise : 0);
  // ── the top: the front's face, the bonnet, the windscreen, the roof, the tail ──
  const cp: [number, number, number][] = [[zf, yN, 0]];
  // (the bonnet's leading edge curving down into the front's face: rounder on a car)
  if (hasBonnet) { const lead = 0.1 + 0.1 * bonnet * (1 - u); cp.push([zf - lead, yN + 0.045 + 0.03 * bonnet, 0.09 + 0.08 * (1 - u)]); }
  const rake = (clamp(p.rake, 0, 80) * Math.PI) / 180, fast = p.roofline === 'fastback', Hf = fast ? H - 0.012 : H;
  const zRF = zC - (Hf - yCowl) * Math.tan(rake);
  cp.push([zC, yCowl, hasBonnet ? 0.05 + 0.08 * (1 - u) : 0.02]);
  cp.push([zRF, Hf, 0.06 + 0.3 * (1 - u)]);
  const tail = load === 'box' || load === 'trailer' ? 'box' : p.tail, rear = load === 'tray' ? zEnd : z0;
  // where the roof ends and the tail begins, by the tail's kind
  const yLip = beltAt(rear) + (tail === 'fastback' ? 0.1 : 0.05), deck = Math.min(0.9, L * 0.19);
  const zDeck = rear + deck, yDeck = beltAt(zDeck) + 0.05;
  const tr = Math.tan((clamp(p.tailRake, 0, 80) * Math.PI) / 180);
  let zRR = tail === 'hatch' ? rear + 0.06 + (H - yLip) * tr : tail === 'notch' ? zDeck + (H - yDeck) * tr : tail === 'fastback' ? rear + 0.12 + (H - yLip) * tr : rear + 0.03;
  if (fast) zRR = Math.max(zRR, zRF - (zRF - rear) * 0.32);
  zRR = Math.min(zRR, zRF - 0.3);
  const Hr = p.roofline === 'falling' ? H - 0.012 - 0.045 * (zRF - zRR) : fast ? H - 0.006 : H;
  if (fast) cp.push([zRF - (zRF - zRR) * 0.5, H, 0.4]);
  if (tail === 'box') {
    const rt = 0.04 + 0.1 * (1 - u);
    if (load === 'tray') { cp.push([rear + 0.03, Hr, rt]); cp.push([rear + 0.015, beltAt(rear) + 0.01, 0]); cp.push([rear, beltAt(rear) - 0.42, 0]); cp.push([zr, beltAt(zr) - 0.42, 0]); }
    else { cp.push([rear + rt, Hr, rt]); cp.push([rear, Hr - rt * 0.7, 0]); }
  } else if (tail === 'hatch') { cp.push([zRR, Hr, 0.16]); cp.push([rear + 0.07, yLip, 0.05]); cp.push([rear, yLip - 0.14, 0]); }
  else if (tail === 'notch') { cp.push([zRR, Hr, 0.18]); cp.push([zDeck, yDeck, 0.08]); cp.push([rear + 0.05, yDeck - 0.01, 0.04]); cp.push([rear, yDeck - 0.13, 0]); }
  else { cp.push([zRR, Hr, fast ? 0.5 : 0.35]); cp.push([rear + 0.09, yLip + 0.045, 0.05]); cp.push([rear, yLip - 0.1, 0]); }
  const top = rounded(cp, n);
  // ── the floor: the clearance between the axles, rising to the bumpers ──
  // (the axles under the body: a cab's with a load behind it, its front one)
  const under = axles.filter((z) => z >= z0), back = Math.max(0.05, Math.min(0.3, (under[under.length - 1]! - ra - z0) * 0.7)), ahead = Math.max(0.05, Math.min(0.28, (zf - zFA - ra) * 0.7));
  const cl = p.clearance, bottom: Line = [[z0, cl + 0.12 + 0.06 * (1 - u)], [z0 + back, cl + 0.03], [Math.max(z0 + back + 0.01, zf - ahead), cl + 0.03], [zf, cl + 0.1 + 0.05 * (1 - u)]];
  // ── the plan: the ends rounded (round at a car's nose, near square at a bus's) ──
  const rpF = Math.min(W * (0.15 - 0.1 * u), (zf - z0) * 0.3), rpR = Math.min(W * (tail === 'box' ? 0.05 + 0.03 * (1 - u) : 0.13), (zf - z0) * 0.3), m = level === 0 ? 4 : level === 1 ? 2 : 1;
  const plan: Line = [];
  for (let i = m; i >= 1; i--) { const a = (i / m) * (Math.PI / 2); plan.push([z0 + rpR * (1 - Math.sin(a)), hw - rpR * (1 - Math.cos(a))]); }
  plan.push([z0 + rpR, hw], [zf - rpF, hw]);
  for (let i = 1; i <= m; i++) { const a = (i / m) * (Math.PI / 2); plan.push([zf - rpF * (1 - Math.sin(a)), hw - rpF * (1 - Math.cos(a))]); }
  const planLine: Line = []; for (const q of plan) if (!planLine.length || q[0] > planLine[planLine.length - 1]![0] + 1e-4) planLine.push(q);
  // ── the glass along it: the windscreen (from the cowl to just under the roof's front edge), the rear glass by the
  // tail's kind, a cab's back glass over a bed; the side glass from the windscreen back by `windows` of the cabin ──
  const below = (y: number, lo: number, hi: number) => crossings(top, y).filter((z) => z > lo - 1e-6 && z < hi + 1e-6);
  const yWs = Math.min(H - railH * 0.6, H - crown - railH + 0.12), zWs = below(yWs, zRF, zC)[0] ?? zRF, topGlass: [number, number][] = [[zWs, zC]];
  const zRG = below(Hr - railH * 0.6, rear, zRR + 0.02).pop() ?? zRR;
  if (load === 'tray') topGlass.push([rear + 0.022, rear + 0.03]);
  else if (tail === 'hatch') topGlass.push([rear + 0.1, zRG]);
  else if (tail === 'notch') topGlass.push([zDeck + 0.03, zRG]);
  else if (tail === 'fastback') topGlass.push([rear + 0.15, zRG]);
  const zWin = zC - clamp(p.windows, 0, 1) * (zC - zEnd);
  // the stations both lofts share: where the shoulder's line bends (the top's points off the cabin, where the bonnet
  // or the tail is the shoulder; the plan's; where the bonnet meets the belt and the glass's ledge begins)
  const shared = [z0, zf, ...top.filter(([z, y]) => y - crown <= beltAt(z) + 0.035).map((q) => q[0]), ...planLine.map((q) => q[0])];
  for (const y of [crown, crown + 0.03]) for (let i = 0; i + 1 < top.length; i++) {
    const a = top[i]!, b = top[i + 1]!, fa = a[1] - y - beltAt(a[0]), fb = b[1] - y - beltAt(b[0]);
    if (fa * fb < 0) shared.push(a[0] + (fa / (fa - fb)) * (b[0] - a[0]));
  }
  return {
    L, W, H, r, hw, zf, zr, z0, zEnd, axles, ra, tw, archIn, u, zC, yCowl, yN, zRF, zRR, Hf, Hr, top, bottom, plan: planLine, belt0, rise,
    lean, ledge, rr, crown, sr, tuck, cladW, cladH, railH, pillar: 0.07 + 0.03 * (1 - u), tuckIn, line, bow, topGlass, band: [zWin, zC], slant: p.windows < 0.99 ? 0.3 * (1 - u) : 0, bed: load === 'tray' ? [zr, rear + 0.015] : null,
    shared: shared.filter((z) => z >= z0 - 1e-6 && z <= zf + 1e-6), level,
  };
}

/** the belt's height at z */
export const beltAt = (S: Silhouette, z: number) => S.belt0 + (z < S.zC ? (S.zC - z) * S.rise : 0);
/** the arch's line over an axle at z (an arch of radius R round each axle; −∞ where there is none) */
export function archAt(S: Silhouette, z: number, R = S.ra): number {
  let y = -Infinity;
  for (const za of S.axles) { const d = Math.abs(z - za); if (d <= R) y = Math.max(y, S.r + Math.sqrt(R * R - d * d)); }
  return y;
}
/** half a section at z (its +x side, the car's left): 16 points from the floor's middle: the well, the sill tucked in,
 *  the side bulging out to its widest, the shoulder line (a step of a few millimetres: a line in the light), the
 *  shoulder rounded over to the belt, the glass leaning in and bowed out, the rail rounded into the roof, its crown,
 *  its middle */
export function half(S: Silhouette, z: number): V2[] {
  const t = at(S.top, z), yb = at(S.bottom, z), w = at(S.plan, z), be = beltAt(S, z);
  // the side glass: up to the rail under the roof, its front and back edges a pillar behind the windscreen and the tail
  const roof = z >= S.zRF ? S.Hf : z <= S.zRR ? S.Hr : t, sh = Math.min(be, t - S.crown), gh = Math.max(0, t - S.crown - sh);
  // (behind the side glass's back edge, a slanted pillar: the glass's top comes down to its foot over `slant`)
  const cut = S.slant > 0 ? Math.max(0, Math.min(1, (z - S.band[0]) / S.slant)) : 1;
  const band = cut * Math.max(0, Math.min(roof - S.crown - S.railH, t - S.crown - S.pillar) - sh), rail = gh - band, f = Math.min(1, rail / S.railH);
  const yIn = Math.max(yb, archAt(S, z)), yLow = Math.max(yb + S.tuck, archAt(S, z)), top = sh - S.sr - S.line - 0.01;
  const yClad = Math.min(top, Math.max(yLow + S.cladH, archAt(S, z, S.ra + S.cladW)));
  // the side: in at the sill, widest a little under its middle, in a little to the shoulder line, the shoulder over it
  const yWide = Math.min(top, yClad + (sh - yClad) * 0.4), yS = Math.max(yWide + 0.01, sh - S.line), xS = w - 0.004 - S.tuckIn * 0.2, step = S.line > 0.05 ? 0.007 : 0;
  const x9 = xS - step - S.sr - S.ledge * Math.min(1, gh / 0.03), xg = (y: number) => Math.max(0.05, x9 - (y - sh) * S.lean);
  // the rail: a curve from the glass's line into the roof's (their corner its middle's pull)
  const g11: V2 = [xg(sh + band), sh + band], corner: V2 = [xg(sh + gh), t - S.crown], g13: V2 = [Math.max(0.04, corner[0] - S.rr * f), t - S.crown];
  const g12: V2 = [0.25 * g11[0] + 0.5 * corner[0] + 0.25 * g13[0], 0.25 * g11[1] + 0.5 * corner[1] + 0.25 * g13[1]], bow = S.bow * Math.min(1, band / 0.35);
  const lo: V2[] = [[0, yb], [w - S.archIn, yb], [w - S.archIn, Math.min(yIn, top)], [w - S.tuckIn, Math.min(yLow, top)], [w - S.tuckIn * 0.35, yClad], [w, yWide], [xS, yS]];
  const sh8: V2 = [xS - step - S.sr * 0.62, sh - S.sr * 0.38], g9: V2 = [x9, sh], crown: V2 = [g13[0] * 0.55, t - S.crown * 0.3];
  // (the simple level: the side, the shoulder, the glass and the rail each one face, not two; no line, no crown)
  if (S.level > 0) return [...lo.slice(0, 5), lo[4]!, lo[6]!, lo[6]!, g9, g9, g11, g11, g13, g13, g13, [0, t]];
  return [...lo, [xS - step, yS + step * 0.8], sh8, g9, [xg(sh + band * 0.5) + bow, sh + band * 0.5], g11, g12, g13, crown, [0, t]];
}
/** what each of half a section's segments is: the floor, the well, the sill, the cladding, the side (two), its line,
 *  the shoulder (two), the glass (two), the rail (two), the top (two) */
const SEG = ['floor', 'well', 'sill', 'clad', 'side', 'side', 'line', 'shoulder', 'shoulder', 'band', 'band', 'rail', 'rail', 'top', 'top'] as const;
const inAny = (z: number, spans: readonly [number, number][]) => spans.some(([a, b]) => z > a && z < b);
/** what a segment is made of at z */
function pieceOf(S: Silhouette, seg: number, z: number, cladding: boolean): Piece {
  const s = SEG[seg]!;
  if (s === 'floor' || s === 'well' || s === 'sill') return 'under';
  if (s === 'clad') return cladding ? 'clad' : 'paint';
  if (s === 'band') return z > S.band[0] && z < S.band[1] ? 'glass' : 'paint';
  if (s === 'top') return inAny(z, S.topGlass) ? 'glass' : S.bed && z > S.bed[0] && z < S.bed[1] ? 'bed' : 'paint';
  return 'paint';
}
/** stations sorted, those within 6 mm of another dropped (the shared ones kept as they are) */
function stationsOf(S: Silhouette, own: number[]): number[] {
  const keep = [...new Set(S.shared.map((z) => Math.round(z * 1e6) / 1e6))].sort((a, b) => a - b), out = [...keep];
  for (const z of own) { if (z < S.z0 || z > S.zf) continue; if (out.every((q) => Math.abs(q - z) > 0.006)) out.push(z); }
  return out.sort((a, b) => a - b);
}
/** the body's panels for a level: triangles by piece (each three points a face, facing out); a front door's span
 *  (z from, to) cut out of its sides as the doors' own (from the cladding's top to the belt: each its side's) */
export function shell(S: Silhouette, level: number, cladding: boolean, door: [number, number] | null = null): Record<Piece | 'caps' | 'doorL' | 'doorR', V3[]> {
  const out: Record<Piece | 'caps' | 'doorL' | 'doorR', V3[]> = { paint: [], glass: [], clad: [], under: [], bed: [], caps: [], doorL: [], doorR: [] };
  // the lower loft's own stations: the floor's points, each arch round (its ends sharp: the well's front and back
  // walls), the cladding round it; the upper's: where the glass begins and ends
  const segs = level === 0 ? 6 : level === 1 ? 3 : 2, low: number[] = [...S.bottom.map((q) => q[0])];
  for (const za of S.axles) {
    for (let i = 0; i <= segs; i++) low.push(za + S.ra * Math.cos((i / segs) * Math.PI));
    low.push(za - S.ra - 0.012, za + S.ra + 0.012); if (cladding) low.push(za - S.ra - S.cladW, za + S.ra + S.cladW);
  }
  if (door) low.push(...door);
  const up = [...S.top.map((q) => q[0]), ...S.topGlass.flat(), ...S.band, S.band[0] + S.slant * 0.5, S.band[0] + S.slant, ...(S.bed ?? [])];
  const lower = stationsOf(S, low), upper = stationsOf(S, up);
  const mir = (q: V2): V2 => [-q[0], q[1]];
  // each loft's sections as open lines: the lower from the right shoulder down, across the floor, up to the left; the
  // upper from the left shoulder over the roof to the right (each point its half's segment number)
  const lowerLine = (h: V2[]) => [...h.slice(1, 10).reverse().map(mir), ...h.slice(1, 10)];
  const upperLine = (h: V2[]) => [...h.slice(9), ...h.slice(9, 15).reverse().map(mir)];
  const lowerSeg = (m: number) => (m < 8 ? 8 - m : m - 8), upperSeg = (m: number) => (m < 6 ? 9 + m : 9 + (11 - m));
  const loft = (zs: number[], line: (h: V2[]) => V2[], seg: (m: number) => number, lower = false) => {
    const rings = zs.map((z) => line(half(S, z)));
    for (let i = 0; i + 1 < zs.length; i++) {
      const za = zs[i]!, zb = zs[i + 1]!, ra = rings[i]!, rb = rings[i + 1]!, zm = (za + zb) / 2;
      for (let j = 0; j + 1 < ra.length; j++) {
        const A: V3 = [ra[j]![0], ra[j]![1], za], B: V3 = [ra[j + 1]![0], ra[j + 1]![1], za], C: V3 = [rb[j + 1]![0], rb[j + 1]![1], zb], D: V3 = [rb[j]![0], rb[j]![1], zb];
        // (a front door's span of the side: its own; the lower loft's first half its right side)
        const sj = seg(j), inDoor = lower && door && sj >= 4 && sj <= 8 && zm > door[0] && zm < door[1];
        const pc = inDoor ? out[j < 8 ? 'doorR' : 'doorL'] : out[pieceOf(S, sj, zm, cladding)];
        if (Math.hypot(B[0] - A[0], B[1] - A[1]) + Math.hypot(C[0] - D[0], C[1] - D[1]) < 1e-5) continue;
        pc.push(A, B, C, A, C, D);
      }
    }
  };
  loft(lower, lowerLine, lowerSeg, true);
  loft(upper, upperLine, upperSeg);
  // its ends: the whole section at the front and at the back, closed
  for (const [z, s] of [[S.zf, 1], [S.z0, -1]] as const) {
    const h = half(S, z), ring: V2[] = [];
    for (const q of [...lowerLine(h), ...upperLine(h).slice(1, -1)]) { const l = ring[ring.length - 1]; if (!l || Math.hypot(q[0] - l[0], q[1] - l[1]) > 1e-5) ring.push(q); }
    while (ring.length > 3 && Math.hypot(ring[0]![0] - ring[ring.length - 1]![0], ring[0]![1] - ring[ring.length - 1]![1]) < 1e-5) ring.pop();
    const tri = triangulate(ring);
    for (let k = 0; k + 2 < tri.length; k += 3) {
      const a = ring[tri[k]!]!, b = ring[tri[k + 1]!]!, c = ring[tri[k + 2]!]!, cz = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
      const P = (q: V2): V3 => [q[0], q[1], z];
      if (cz * s > 0) out.caps.push(P(a), P(b), P(c)); else out.caps.push(P(a), P(c), P(b));
    }
  }
  return out;
}
/** the body's front (or rear) at half-width x: z where the plan reaches x (its ends' rounding) */
export function endAt(S: Silhouette, x: number, front: boolean): number {
  const pl = S.plan;
  if (front) { for (let i = pl.length - 1; i > 0; i--) { const a = pl[i]!, b = pl[i - 1]!; if (x >= a[1] - 1e-9 && x <= b[1] + 1e-9) return a[0] + ((x - a[1]) / ((b[1] - a[1]) || 1)) * (b[0] - a[0]); } return S.zf; }
  for (let i = 0; i + 1 < pl.length; i++) { const a = pl[i]!, b = pl[i + 1]!; if (x >= a[1] - 1e-9 && x <= b[1] + 1e-9) return a[0] + ((x - a[1]) / ((b[1] - a[1]) || 1)) * (b[0] - a[0]); }
  return S.z0;
}
/** where the windscreen reaches a height (its surface's z there) */
export function screenAt(S: Silhouette, y: number): number {
  for (let i = S.top.length - 1; i > 0; i--) {
    const a = S.top[i - 1]!, b = S.top[i]!;
    if (b[0] <= S.zC + 1e-6 && (a[1] - y) * (b[1] - y) <= 0) return a[0] + ((y - a[1]) / ((b[1] - a[1]) || 1)) * (b[0] - a[0]);
  }
  return S.zC;
}
