// core › geometry › networks › junctions: where sections meet. A junction is solved from its arms: each arm is cut back
// far enough that neighbouring arms stop overlapping (the angle between them decides how far), the platform is the
// carriageway between the arms' mouths with a kerb return at every corner (a curve from one arm's kerb line to the
// next's), and each verge band (kerb, nature strip, footpath) follows the corner round, so the footpaths join. Arms of
// the bigger roads get pedestrian crossings at their mouths; a smaller road meeting a bigger one gets a give-way line.
// Places are metres in one plane (x east, z south).
//   const js = solveJunctions(sections)   (each section's `trim` is set for its ends)
import { along, lengthOf, vergeWidth, type P2, type Section, type Verge } from './sections.ts';

/** an arm: a section leaving the junction (its mouth, its direction outward, its half carriageway, its verges on the
 *  side towards the previous and the next arm) */
export interface Arm { section: Section; end: 0 | 1; at: P2; dir: P2; angle: number; half: number; cls: number; before: Verge; after: Verge }
/** a corner between two neighbouring arms: the kerb return (the carriageway's edge round the corner) and the verge
 *  bands' outer lines round it (kerb, strip, footpath: each a curve, from the corner outward) */
export interface Corner { curve: P2[]; bands: { kind: 'kerb' | 'strip' | 'footpath'; inner: P2[]; outer: P2[] }[]; from: number; to: number }
/** a crossing on an arm: a band across its carriageway at its mouth (zebra stripes run along the arm) */
export interface Crossing { arm: number; a: P2; b: P2; dir: P2; width: number }
export interface Junction { key: string; at: P2; arms: Arm[]; trim: number; platform: P2[]; corners: Corner[]; crossings: Crossing[]; giveWay: { a: P2; b: P2 }[] }

const sub = (a: P2, b: P2): P2 => [a[0] - b[0], a[1] - b[1]];
const norm = (a: P2): P2 => { const l = Math.hypot(a[0], a[1]) || 1; return [a[0] / l, a[1] / l]; };
/** left of a direction (x east, z south): (dz, −dx) */
const leftOf = (d: P2): P2 => [d[1], -d[0]];
const keyOf = (p: P2) => `${Math.round(p[0] * 5)},${Math.round(p[1] * 5)}`;

/** the junctions of a set of sections: ends that meet (within 0.2 m) where three or more meet, or two at an angle */
export function solveJunctions(sections: Section[], o: { radius?: (cls: number) => number; crossings?: (cls: number) => boolean } = {}): Junction[] {
  // kerb return radii (IDM §12.5.6): residential 7.5 m, collector 12.5 m, arterial 15 m
  const radius = o.radius ?? ((c: number) => (c <= 3 ? 15 : c === 4 ? 12.5 : 7.5));
  const crossingOn = o.crossings ?? ((c: number) => c <= 4);
  const at = new Map<string, { p: P2; ends: { s: Section; end: 0 | 1 }[] }>();
  for (const s of sections) for (const end of [0, 1] as const) {
    const p = s.pts[end === 0 ? 0 : s.pts.length - 1]!, k = keyOf(p);
    let n = at.get(k); if (!n) at.set(k, (n = { p: [p[0], p[1]], ends: [] }));
    n.ends.push({ s, end });
  }
  const out: Junction[] = [];
  for (const [key, n] of at) {
    if (n.ends.length < 2) continue;
    const c = n.p;
    // each arm's direction from a few metres along it (the first metres of a line can wobble)
    const raw = n.ends.map(({ s, end }) => {
      const L = lengthOf(s.pts), q = along(s.pts, end === 0 ? Math.min(L, 6) : Math.max(0, L - 6)), d = norm(sub([q.x, q.z], c));
      return { s, end, d, angle: Math.atan2(d[1], d[0]), L };
    }).sort((a, b) => a.angle - b.angle);
    if (raw.length === 2) { let g = Math.abs(raw[1]!.angle - raw[0]!.angle); if (g > Math.PI) g = 2 * Math.PI - g; if (g > Math.PI * 0.8) continue; } // a road going on: no junction
    // its verges on the side towards the previous and the next arm (an arm runs outward: its points from the junction or towards it)
    const arms: Arm[] = raw.map(({ s, end, d, angle }) => {
      const p = s.profile, outward = end === 0;
      // leaving the junction, the arm's left is the section's left when its points run outward
      const L = outward ? p.left : p.right, R = outward ? p.right : p.left;
      return { section: s, end, at: c, dir: d, angle, half: p.carriageway / 2, cls: s.cls, before: R, after: L };
    });
    // how far back: neighbours at an angle θ stop overlapping once r·sin θ ≥ their widths together (and the kerb
    // return fits)
    const outerOf = (a: Arm) => a.half + Math.max(vergeWidth(a.before), vergeWidth(a.after));
    let need = Math.max(...arms.map((a) => a.half + 1));
    for (let k = 0; k < arms.length; k++) {
      const A = arms[k]!, B = arms[(k + 1) % arms.length]!; let th = B.angle - A.angle; if (th <= 0) th += Math.PI * 2;
      const r = Math.min(radius(A.cls), radius(B.cls));
      if (th < Math.PI * 0.95) need = Math.max(need, (A.half + B.half + 0.5) / Math.max(0.2, Math.sin(Math.min(th, Math.PI / 2))) + r * 0.4);
      void outerOf;
    }
    const cap = Math.min(...raw.map((r) => r.L * 0.45));
    const trim = Math.min(need, cap);
    for (const a of arms) a.section.trim[a.end] = Math.max(a.section.trim[a.end], trim);
    // the platform: each arm's mouth (its two kerb points at the cut), and a kerb return to the next arm
    const mouth = (a: Arm, side: 1 | -1): P2 => { const l = leftOf(a.dir); return [c[0] + a.dir[0] * trim + l[0] * a.half * side, c[1] + a.dir[1] * trim + l[1] * a.half * side]; };
    const platform: P2[] = [], corners: Corner[] = [], crossings: Crossing[] = [], giveWay: { a: P2; b: P2 }[] = [];
    const big = Math.min(...arms.map((a) => a.cls));
    for (let k = 0; k < arms.length; k++) {
      const A = arms[k]!, B = arms[(k + 1) % arms.length]!;
      // A's left side faces B (B lies at a greater angle: turning left from A's direction, in this frame's sense)
      const pa = mouth(A, -1), pb = mouth(B, 1);
      platform.push(mouth(A, 1), pa);
      let gap = B.angle - A.angle; if (gap <= 0) gap += Math.PI * 2;
      // (a corner whose kerb lines meet far behind the mouths: nearly opposite arms; it stays straight)
      const curve = cornerCurve(pa, A.dir, pb, B.dir, gap, trim * 1.5 + 4);
      for (let q = 1; q < curve.length - 1; q++) platform.push(curve[q]!);
      // the verge bands round the corner: offset outward from the kerb return, band by band (the thinner side wins)
      const va = A.before, vb = B.after, bands: Corner['bands'] = [];
      let off = 0;
      for (const kind of ['kerb', 'strip', 'footpath'] as const) {
        const w = Math.min(va[kind], vb[kind]) || Math.max(va[kind], vb[kind]) * 0; if (!(w > 0.05)) continue;
        bands.push({ kind, inner: offsetCurve(curve, c, off), outer: offsetCurve(curve, c, off + w) }); off += w;
      }
      corners.push({ curve, bands, from: k, to: (k + 1) % arms.length });
    }
    // crossings at the mouths of the bigger roads' arms; a give-way line where a smaller road meets a bigger one
    arms.forEach((a, i) => {
      if (crossingOn(a.cls) || crossingOn(big) && a.cls > big) {
        const l = leftOf(a.dir), s = trim + 1.6;
        crossings.push({ arm: i, a: [c[0] + a.dir[0] * s - l[0] * a.half, c[1] + a.dir[1] * s - l[1] * a.half], b: [c[0] + a.dir[0] * s + l[0] * a.half, c[1] + a.dir[1] * s + l[1] * a.half], dir: a.dir, width: 3 });
      }
      if (a.cls > big) { const l = leftOf(a.dir), s = trim + (crossingOn(a.cls) || crossingOn(big) ? 3.6 : 0.4); giveWay.push({ a: [c[0] + a.dir[0] * s, c[1] + a.dir[1] * s], b: [c[0] + a.dir[0] * s + l[0] * a.half, c[1] + a.dir[1] * s + l[1] * a.half] }); }
    });
    out.push({ key, at: c, arms, trim, platform, corners, crossings, giveWay });
  }
  return out;
}
/** the kerb return from one arm's kerb point to the next's: a curve through the point where their kerb lines meet
 *  (a quadratic Bézier, as the old studio's), straight when they run on nearly in line */
function cornerCurve(pa: P2, da: P2, pb: P2, db: P2, gap: number, reach = 30): P2[] {
  const out: P2[] = [];
  let ctrl: P2 | null = null;
  if (gap < Math.PI * 0.95) {
    // pa + da·t = pb + db·u, both behind their mouths (t, u < 0: towards the junction)
    const det = da[0] * -db[1] - da[1] * -db[0];
    if (Math.abs(det) > 1e-6) { const rx = pb[0] - pa[0], rz = pb[1] - pa[1], t = (rx * -db[1] - rz * -db[0]) / det, u = (da[0] * rz - da[1] * rx) / det; if (t < 0 && u < 0 && -t < reach && -u < reach) ctrl = [pa[0] + da[0] * t, pa[1] + da[1] * t]; }
  }
  for (let q = 0; q <= 10; q++) { const t = q / 10, s = 1 - t; out.push(ctrl ? [s * s * pa[0] + 2 * s * t * ctrl[0] + t * t * pb[0], s * s * pa[1] + 2 * s * t * ctrl[1] + t * t * pb[1]] : [pa[0] + (pb[0] - pa[0]) * t, pa[1] + (pb[1] - pa[1]) * t]); }
  return out;
}
/** a curve moved `d` metres away from a point (outward from the junction) along its normals */
function offsetCurve(pts: P2[], c: P2, d: number): P2[] {
  if (!d) return pts.map((p) => [p[0], p[1]]);
  return pts.map((p, q) => {
    const a = pts[Math.max(0, q - 1)]!, b = pts[Math.min(pts.length - 1, q + 1)]!;
    let n: P2 = norm([b[1] - a[1], -(b[0] - a[0])]);
    if (n[0] * (p[0] - c[0]) + n[1] * (p[1] - c[1]) < 0) n = [-n[0], -n[1]];
    return [p[0] + n[0] * d, p[1] + n[1] * d];
  });
}

// ── a junction from its arms, wherever they start (one node, or a cluster of nodes merged because their platforms
// overlapped): trim and fill with real kerb returns. Each pair of neighbouring arms: their kerb lines intersected, an
// arc of the kerb return radius tangent to both (the smaller road's radius), each arm cut back past its tangent point;
// the platform runs mouth → back along the kerb line → the arc → out along the next kerb line → its mouth. Arms meeting
// at a small angle (the two carriageways of a divided road: a median's nose) or nearly opposite meet straight.
export interface ArmIn { s: Section; end: 0 | 1; node: P2 }
export interface ClusterJunction {
  centre: P2;
  arms: { s: Section; end: 0 | 1; node: P2; dir: P2; half: number; trim: number; angle: number; mouth: [P2, P2] }[];
  /** the platform's outline (the carriageway's edge: mouths, kerb lines, kerb returns) */
  platform: P2[];
  /** the kerb round each corner (the edge from one arm's mouth to the next's), outward from the platform */
  kerbs: P2[][];
}
export function junctionOf(input: readonly ArmIn[], centre: P2, o: { radius?: (cls: number) => number; maxTrim?: (a: ArmIn) => number } = {}): ClusterJunction | null {
  const radius = o.radius ?? ((c: number) => (c <= 3 ? 15 : c === 4 ? 12.5 : 7.5));
  const arms = input.map((a) => {
    const L = lengthOf(a.s.pts), q = along(a.s.pts, a.end === 0 ? Math.min(L, 6) : Math.max(0, L - 6)), d = norm(sub([q.x, q.z], a.node));
    const tip: P2 = [a.node[0] + d[0] * 12, a.node[1] + d[1] * 12];
    return { ...a, dir: d, half: a.s.profile.carriageway / 2, trim: 0, angle: Math.atan2(tip[1] - centre[1], tip[0] - centre[0]), mouth: [[0, 0], [0, 0]] as [P2, P2], L };
  }).sort((a, b) => a.angle - b.angle);
  if (arms.length < 2) return null;
  // the corners: each pair's kerb lines, where they meet, the arc's tangent points
  // how far an arm's road lies off its straight line (from its node along its first direction), `t` along it
  const off = (a: (typeof arms)[number], t: number) => { const q = along(a.s.pts, a.end === 0 ? Math.min(a.L, t) : Math.max(0, a.L - t)), x = q.x - a.node[0], z = q.z - a.node[1]; return Math.abs(x * a.dir[1] - z * a.dir[0]); };
  // how far apart two arms' roads are, `d` along the first (from it to the nearest point of the other's line)
  const apart = (a: (typeof arms)[number], b: (typeof arms)[number], d: number) => { const q = along(a.s.pts, a.end === 0 ? d : a.L - d), P = b.s.pts; let best = Infinity; for (let i = 1; i < P.length; i++) { const p0 = P[i - 1]!, p1 = P[i]!, dx = p1[0] - p0[0], dz = p1[1] - p0[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((q.x - p0[0]) * dx + (q.z - p0[1]) * dz) / L2)); best = Math.min(best, Math.hypot(q.x - p0[0] - dx * t, q.z - p0[1] - dz * t)); } return best; };
  const corners = arms.map((A, k) => {
    const B = arms[(k + 1) % arms.length]!;
    const la = leftOf(A.dir), lb = leftOf(B.dir);
    const pa0: P2 = [A.node[0] - la[0] * A.half, A.node[1] - la[1] * A.half], pb0: P2 = [B.node[0] + lb[0] * B.half, B.node[1] + lb[1] * B.half];
    const cos = A.dir[0] * B.dir[0] + A.dir[1] * B.dir[1], th = Math.acos(Math.max(-1, Math.min(1, cos)));
    const det = A.dir[0] * -B.dir[1] - A.dir[1] * -B.dir[0];
    let fillet: { ta: number; tb: number; X: P2; T: number; r: number } | null = null;
    if (Math.abs(det) > 1e-6 && th > (25 * Math.PI) / 180 && th < (170 * Math.PI) / 180) {
      const rx = pb0[0] - pa0[0], rz = pb0[1] - pa0[1], t = (rx * -B.dir[1] - rz * -B.dir[0]) / det, u = (A.dir[0] * rz - A.dir[1] * rx) / det;
      if (t > -A.half * 4 && u > -B.half * 4 && t < 80 && u < 80) {
        // the class's radius, smaller where an arm bends away from its straight line before the tangent point (the
        // arc drawn off the road): r, r/2, r/4, then a sharp corner
        const r0 = Math.min(radius(A.s.cls), radius(B.s.cls));
        for (const r of [r0, r0 / 2, r0 / 4, 0]) {
          const T = r / Math.tan(th / 2);
          if (r && (off(A, t + T) > 0.6 || off(B, u + T) > 0.6)) continue;
          fillet = { ta: t + T, tb: u + T, X: [pa0[0] + A.dir[0] * t, pa0[1] + A.dir[1] * t], T, r };
          break;
        }
      }
    }
    return { A, B, pa0, pb0, fillet };
  });
  // each arm cut back past both its corners' tangent points (and at least a little past the other arms' kerbs)
  for (const a of arms) a.trim = Math.max(a.half * 0.5, 1);
  for (const c of corners) if (c.fillet) { c.A.trim = Math.max(c.A.trim, c.fillet.ta + 0.3); c.B.trim = Math.max(c.B.trim, c.fillet.tb + 0.3); }
  // arms leaving nearly together (a slip lane, a merge): cut back until they have parted (the asphalt between them is
  // one: the platform's)
  for (const c of corners) {
    const th = Math.acos(Math.max(-1, Math.min(1, c.A.dir[0] * c.B.dir[0] + c.A.dir[1] * c.B.dir[1])));
    if (th >= (25 * Math.PI) / 180) continue;
    // along their own lines (a ramp curving away parts sooner than its first direction says, a long taper later)
    const gap = c.A.half + c.B.half + 0.6, limA = o.maxTrim ? o.maxTrim(c.A) : c.A.L * 0.48, limB = o.maxTrim ? o.maxTrim(c.B) : c.B.L * 0.48;
    let need = Infinity;
    for (let d = 1; d <= Math.min(limA, limB) + 0.5; d += 1) if (apart(c.A, c.B, Math.min(d, limA)) >= gap && apart(c.B, c.A, Math.min(d, limB)) >= gap) { need = d; break; }
    if (need === Infinity) need = (c.A.half + c.B.half + 0.6) / Math.max(0.08, Math.sin(th));
    c.A.trim = Math.max(c.A.trim, need); c.B.trim = Math.max(c.B.trim, need);
  }
  for (const a of arms) a.trim = Math.min(a.trim, o.maxTrim ? o.maxTrim(a) : a.L * 0.48);
  // each mouth on the arm's own line at its cut (a curving arm: where the road really is), across it at its direction there
  for (const a of arms) {
    const L = lengthOf(a.s.pts), q = along(a.s.pts, a.end === 0 ? a.trim : L - a.trim), sg = a.end === 0 ? 1 : -1, d: P2 = [q.tx * sg, q.tz * sg], l = leftOf(d);
    a.mouth = [[q.x + l[0] * a.half, q.z + l[1] * a.half], [q.x - l[0] * a.half, q.z - l[1] * a.half]];
  }
  const platform: P2[] = [], kerbs: P2[][] = [];
  for (const c of corners) {
    const { A, B } = c;
    platform.push(A.mouth[0], A.mouth[1]);
    const edge: P2[] = [A.mouth[1]];
    if (c.fillet && c.fillet.ta <= A.trim + 0.01 && c.fillet.tb <= B.trim + 0.01) {
      const f = c.fillet, TA: P2 = [c.pa0[0] + A.dir[0] * f.ta, c.pa0[1] + A.dir[1] * f.ta], TB: P2 = [c.pb0[0] + B.dir[0] * f.tb, c.pb0[1] + B.dir[1] * f.tb];
      // the arc's centre: on the bisector of the two outward directions, r / sin(θ/2) from where the lines meet
      const bis = norm([A.dir[0] + B.dir[0], A.dir[1] + B.dir[1]]), th = Math.acos(Math.max(-1, Math.min(1, A.dir[0] * B.dir[0] + A.dir[1] * B.dir[1])));
      const C: P2 = [f.X[0] + bis[0] * (f.r / Math.sin(th / 2)), f.X[1] + bis[1] * (f.r / Math.sin(th / 2))];
      let a0 = Math.atan2(TA[1] - C[1], TA[0] - C[0]), a1 = Math.atan2(TB[1] - C[1], TB[0] - C[0]);
      // the short way round
      let da = a1 - a0; while (da > Math.PI) da -= 2 * Math.PI; while (da < -Math.PI) da += 2 * Math.PI;
      edge.push(TA);
      if (f.r > 0) {
        const n = Math.max(3, Math.ceil(Math.abs(da) * f.r / 1.5));
        for (let q = 1; q < n; q++) { const a = a0 + (da * q) / n; edge.push([C[0] + Math.cos(a) * f.r, C[1] + Math.sin(a) * f.r]); }
        edge.push(TB);
      }
      void a1;
    }
    edge.push(B.mouth[0]);
    for (let q = 1; q < edge.length - 1; q++) platform.push(edge[q]!);
    kerbs.push(edge);
  }
  return { centre, arms: arms.map(({ s, end, node, dir, half, trim, angle, mouth }) => ({ s, end, node, dir, half, trim, angle, mouth })), platform, kerbs };
}
