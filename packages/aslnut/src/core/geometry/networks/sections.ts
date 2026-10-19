// core › geometry › networks › sections: a road between junctions as a section: its centre line and its profile, the
// carriageway (lanes, a median), and each side's verge out to the property line: kerb and channel, nature strip,
// footpath. The profile comes from data first (the road reserve between the property boundaries: Vicmap's road
// casements, a cadastre's parcel edges), then tags (sidewalk, sidewalk:width, lanes, width), then the rules by class;
// your own function has the last word. A road with only a width is a ribbon (nothing else is worked out for it).
// Places are metres in one plane (x east, z south).
//   const p = fitProfile(5, { reserve: reserveAcross(pts, casements) }, rules)
export type P2 = [number, number];

/** one side of a road, from its kerb out: metres */
export interface Verge {
  /** the kerb and channel */
  kerb: number;
  /** the nature strip (grass) between the kerb and the footpath; 0: none */
  strip: number;
  /** the footpath; 0: none */
  footpath: number;
  /** from the footpath to the property line (a gap the council keeps; 0 on most streets) */
  gap: number;
}
/** a road's cross-section: its carriageway and the two verges (left, right of the direction its points run) */
export interface Profile {
  /** the carriageway's width, m (kerb face to kerb face) */
  carriageway: number;
  lanes: number;
  /** a median down its middle, m (0: none) */
  median: number;
  left: Verge; right: Verge;
  /** what each side's property line is: half the reserve, m from the centre line (null: not known) */
  reserve: { left: number | null; right: number | null };
  /** where the profile came from, for the tooltip and the docs: 'reserve' (data), 'tags', 'class' */
  from: 'reserve' | 'tags' | 'class';
}
/** the rules a profile is made by when data says less: per road class (0 freeway … 5 local, 6+ tracks) */
export interface ProfileRules {
  carriageway(cls: number): number;
  lanes(cls: number): number;
  /** the reserve's usual width (when no data gives it) */
  reserve(cls: number): number;
  footpath(cls: number): number;
  kerb: number;
  /** the least nature strip worth keeping (narrower: the footpath runs to the kerb) */
  minStrip: number;
  /** footpath to property line, by class */
  gap(cls: number): number;
  /** a median down the middle, by class (m; 0: none) */
  median(cls: number): number;
  /** classes with no verge (freeways, highways, tracks) */
  noVerge(cls: number): boolean;
}
/** Fit a section to measured reserve widths and normalized side settings. */
export function fitProfile(cls:number,o:{width?:number;lanes?:number;reserve?:{left:number|null;right:number|null};sidewalk?:{left:boolean;right:boolean};footpath?:{left?:number;right?:number};fromTags?:boolean},rules:ProfileRules):Profile{
  const lanes=o.lanes??rules.lanes(cls);let cw=o.width??rules.carriageway(cls);
  const res = o.reserve ?? { left: null, right: null }, fromData = res.left !== null || res.right !== null;
  const half = (side: 'left' | 'right') => res[side] ?? (res[side === 'left' ? 'right' : 'left'] ?? rules.reserve(cls) / 2);
  // a reserve too narrow for the carriageway and two kerbs: the carriageway gives way
  const narrow = Math.min(half('left'), half('right'));
  if (!rules.noVerge(cls) && narrow - rules.kerb - 0.3 < cw / 2) cw = Math.max(3, 2 * (narrow - rules.kerb - 0.3));

  const verge = (side: 'left' | 'right'): Verge => {
    if (rules.noVerge(cls)) return { kerb: 0, strip: 0, footpath: 0, gap: 0 };
    const room = half(side) - cw / 2, kerb = rules.kerb;
    const fp = o.sidewalk?.[side]!==false ? (o.footpath?.[side] ?? rules.footpath(cls)) : 0;
    let gap = rules.gap(cls), strip = room - kerb - fp - gap, foot = fp;
    if (strip < rules.minStrip) { gap = Math.max(0, Math.min(gap, room - kerb - fp)); strip = Math.max(0, room - kerb - foot - gap); if (strip < rules.minStrip) { foot = Math.max(0, room - kerb - gap); strip = 0; } }
    return { kerb, strip, footpath: foot, gap };
  };
  return { carriageway: cw, lanes, median: Math.min(rules.median(cls), Math.max(0, cw - 2 * 3.3 * Math.max(1, Math.floor(lanes / 2)))), left: verge('left'), right: verge('right'), reserve: { left: res.left, right: res.right }, from: fromData ? 'reserve' : o.fromTags ? 'tags' : 'class' };
}
/** the reserve each side of a centre line: the property lines (the reserve polygons' edges) found by rays across it
 *  at its points, the middle value of each side (null: no reserve polygon there) */
export function reserveAcross(pts: readonly P2[], reserves: readonly (readonly P2[])[], o: { reach?: number } = {}): { left: number | null; right: number | null } {
  const reach = o.reach ?? 40, L: number[] = [], R: number[] = [];
  // the polygons near the line (by their boxes)
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of pts) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const near = reserves.filter((r) => { let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity; for (const [x, z] of r) { a = Math.min(a, x); b = Math.max(b, x); c = Math.min(c, z); d = Math.max(d, z); } return b >= x0 - reach && a <= x1 + reach && d >= z0 - reach && c <= z1 + reach; });
  if (!near.length) return { left: null, right: null };
  const step = Math.max(1, Math.floor(pts.length / 12));
  for (let i = 0; i + 1 < pts.length; i += step) {
    const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!, l = Math.hypot(bx - ax, bz - az); if (l < 0.5) continue;
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, tx = (bx - ax) / l, tz = (bz - az) / l;
    // the polygon the road runs in: the one holding this point (its edges are the property lines here)
    const home = near.find((r) => insideRing(mx, mz, r)); if (!home) continue;
    // left of the direction of travel (x east, z south): (tz, −tx)
    for (const [nx, nz, out] of [[tz, -tx, L], [-tz, tx, R]] as const) { const d = rayToRing(mx, mz, nx, nz, home, reach); if (d !== null) out.push(d); }
  }
  const mid = (a: number[]) => (a.length ? a.sort((p, q) => p - q)[a.length >> 1]! : null);
  return { left: mid(L), right: mid(R) };
}
export function insideRing(x: number, z: number, ring: readonly P2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i]!, [xj, zj] = ring[j]!; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; }
  return c;
}
/** the nearest edge of a ring along a ray (null: none within reach) */
function rayToRing(x: number, z: number, dx: number, dz: number, ring: readonly P2[], reach: number): number | null {
  let best: number | null = null;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [ax, az] = ring[j]!, [bx, bz] = ring[i]!, ex = bx - ax, ez = bz - az, den = dx * ez - dz * ex; if (Math.abs(den) < 1e-9) continue;
    const t = ((ax - x) * ez - (az - z) * ex) / den, u = ((ax - x) * dz - (az - z) * dx) / den;
    if (t > 0.3 && t < reach && u >= 0 && u <= 1 && (best === null || t < best)) best = t;
  }
  return best;
}
/** a section: a road between junctions (or an open end), its centre line, its profile, and how far each end is cut
 *  back for a junction's platform */
export interface Section { id: string; cls: number; name: string; pts: P2[]; profile: Profile; trim: [number, number]; ends: [string | null, string | null] }
/** the width across a whole side: kerb, strip, footpath, gap (to the property line) */
export const vergeWidth = (v: Verge) => v.kerb + v.strip + v.footpath + v.gap;
/** a point and the direction at a distance along a line */
export function along(pts: readonly P2[], s: number): { x: number; z: number; tx: number; tz: number } {
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!, l = Math.hypot(bx - ax, bz - az);
    if (acc + l >= s || i + 2 === pts.length) { const f = l > 0 ? Math.max(0, Math.min(1, (s - acc) / l)) : 0; return { x: ax + (bx - ax) * f, z: az + (bz - az) * f, tx: l ? (bx - ax) / l : 1, tz: l ? (bz - az) / l : 0 }; }
    acc += l;
  }
  const p = pts[0] ?? [0, 0]; return { x: p[0], z: p[1], tx: 1, tz: 0 };
}
export const lengthOf = (pts: readonly P2[]) => { let l = 0; for (let i = 0; i + 1 < pts.length; i++) l += Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]); return l; };
/** the part of a line between two distances along it */
export function cut(pts: readonly P2[], s0: number, s1: number): P2[] {
  const out: P2[] = []; if (s1 <= s0) return out;
  const a = along(pts, s0); out.push([a.x, a.z]);
  let acc = 0;
  for (let i = 0; i + 1 < pts.length; i++) { acc += Math.hypot(pts[i + 1]![0] - pts[i]![0], pts[i + 1]![1] - pts[i]![1]); if (acc > s0 + 1e-6 && acc < s1 - 1e-6) out.push([pts[i + 1]![0], pts[i + 1]![1]]); }
  const b = along(pts, s1); out.push([b.x, b.z]);
  return out;
}

// ── heights: each road's height along it, solved over the whole network at once ────────────────────────────────
// Stations every few metres along every road (its own vertices kept), joined at the nodes. Each station's target:
// the ground under it, smoothed along the road (at grade); a bridge's deck over the ground by its level (and over
// what it crosses by the clearance); a tunnel's floor under the ground. Ramps: a bridge pulls the road up to it and a
// tunnel down, no steeper than the ramp grade, across junctions too (the targets spread through the network as cones,
// highest and lowest first). Then smoothed along each road; nodes share one height.
export interface Station { x: number; z: number; s: number; ground: number; bridge: boolean; tunnel: boolean; layer: number; h: number; /** metres to the nearest end of its deck or tunnel (a short one stays low: a culvert's deck, a passage under a building) */ dEnd?: number }
export interface HeightRoad { stations: Station[]; a: number; b: number; /** its own steepest grade at grade (a freeway's 6 %) */ grade?: number }
export interface HeightOptions {
  /** steepest ramp up to a bridge or down into a tunnel (default 0.06) */
  ramp?: number;
  /** a bridge's deck over the ground: m (default 6 at level 1, 5.5 more for each level over it: an elevated road's
   *  levels stack; decks over each other are also kept apart by `over`; a short deck stays as low as its ramps let it) */
  deck?: (layer: number) => number;
  /** a tunnel's road under the ground: m (default 9) */
  depth?: number;
  /** metres the ground is smoothed over along a road at grade (default 24) */
  smooth?: number;
  /** extra targets (a deck kept over what it crosses): station → least height */
  over?: Map<Station, number>;
  /** extra targets the other way (a tunnel kept under what crosses over it): station → greatest height */
  under?: Map<Station, number>;
  /** the steepest a road at grade gets (default 0.1: the ground's own steps evened out) */
  grade?: number;
}
export function solveHeights(roads: readonly HeightRoad[], o: HeightOptions = {}): void {
  const ramp = o.ramp ?? 0.06, deck = o.deck ?? ((l: number) => 6 + 5.5 * (Math.max(1, l) - 1)), depth = o.depth ?? 9, win = o.smooth ?? 24;
  // the ground smoothed along each road (a moving average over ±win/2)
  for (const r of roads) {
    const st = r.stations, n = st.length, base = st.map((p) => p.ground);
    for (let i = 0; i < n; i++) { let sw = 0, sv = 0; for (let j = i; j >= 0 && st[i]!.s - st[j]!.s <= win / 2; j--) { const w = 1 - (st[i]!.s - st[j]!.s) / win; sw += w; sv += w * base[j]!; } for (let j = i + 1; j < n && st[j]!.s - st[i]!.s <= win / 2; j++) { const w = 1 - (st[j]!.s - st[i]!.s) / win; sw += w; sv += w * base[j]!; } st[i]!.h = sv / sw; }
  }
  // the stations as one graph: neighbours along each road; the ends of roads meeting at a node joined
  const all: Station[] = [], idx = new Map<Station, number>(), adj: [number, number][][] = [];
  const add = (p: Station) => { idx.set(p, all.length); all.push(p); adj.push([]); };
  for (const r of roads) for (const p of r.stations) add(p);
  const link = (a: Station, b: Station, d: number) => { const i = idx.get(a)!, j = idx.get(b)!; adj[i]!.push([j, d]); adj[j]!.push([i, d]); };
  const ends = new Map<number, Station[]>();
  for (const r of roads) {
    for (let i = 0; i + 1 < r.stations.length; i++) link(r.stations[i]!, r.stations[i + 1]!, r.stations[i + 1]!.s - r.stations[i]!.s);
    for (const [node, p] of [[r.a, r.stations[0]!], [r.b, r.stations[r.stations.length - 1]!]] as const) { let e = ends.get(node); if (!e) ends.set(node, (e = [])); e.push(p); }
  }
  for (const e of ends.values()) for (let i = 1; i < e.length; i++) link(e[0]!, e[i]!, 0);
  // targets: decks up, tunnels down; spread as cones (a priority queue by value, highest first for decks)
  const spread = (seed: (p: Station) => number, sign: 1 | -1): Float64Array => {
    const v = new Float64Array(all.length).fill(sign > 0 ? -Infinity : Infinity), heap: [number, number][] = [];
    const push = (i: number, val: number) => { heap.push([val * sign, i]); let k = heap.length - 1; while (k > 0) { const p = (k - 1) >> 1; if (heap[p]![0] >= heap[k]![0]) break; [heap[p], heap[k]] = [heap[k]!, heap[p]!]; k = p; } };
    const pop = (): [number, number] => { const top = heap[0]!, last = heap.pop()!; if (heap.length) { heap[0] = last; let k = 0; for (;;) { const l = 2 * k + 1, r = l + 1; let m = k; if (l < heap.length && heap[l]![0] > heap[m]![0]) m = l; if (r < heap.length && heap[r]![0] > heap[m]![0]) m = r; if (m === k) break; [heap[m], heap[k]] = [heap[k]!, heap[m]!]; k = m; } } return top; };
    all.forEach((p, i) => { const t = seed(p); if (Number.isFinite(t)) { v[i] = t; push(i, t); } });
    while (heap.length) {
      const [sv, i] = pop(), val = sv * sign; if (val * sign < v[i]! * sign) continue;
      for (const [j, d] of adj[i]!) { const nv = val - sign * ramp * d; if (nv * sign > v[j]! * sign) { v[j] = nv; push(j, nv); } }
    }
    return v;
  };
  const up = spread((p) => { const t = o.over?.get(p); const b = p.bridge ? p.ground + Math.min(deck(Math.max(1, p.layer)), 0.8 + ramp * (p.dEnd ?? Infinity)) : -Infinity; return Math.max(b, t ?? -Infinity); }, 1);
  // a tunnel's road `depth` under the ground (its level orders it; tunnels under each other kept apart by `under`)
  const down = spread((p) => Math.min(p.tunnel ? p.ground - Math.min(depth, ramp * (p.dEnd ?? Infinity)) : Infinity, o.under?.get(p) ?? Infinity), -1);
  // the ground (already smoothed) under the cones: a deck holds the road up to it, a tunnel down
  const hard = new Float64Array(all.length).fill(NaN);
  all.forEach((p, i) => { let h = p.h; if (Number.isFinite(up[i]!) && up[i]! > h) { h = up[i]!; hard[i] = h; } if (Number.isFinite(down[i]!) && down[i]! < h) { h = down[i]!; hard[i] = h; } p.h = h; });
  // no steeper than `grade` at grade (the ground's own steps evened out), the nodes one height; the cones kept
  const grade = o.grade ?? 0.1;
  for (let pass = 0; pass < 300; pass++) {
    let moved = 0;
    for (const r of roads) { const st = r.stations, gr = r.grade ?? grade; for (let i = 1; i < st.length; i++) { const a = st[i - 1]!, b = st[i]!, d = Math.max(0.5, b.s - a.s), ex = Math.abs(b.h - a.h) - gr * d; if (ex > 0.001) { const m = (ex / 2) * Math.sign(b.h - a.h); a.h += m; b.h -= m; moved++; } } }
    for (const e of ends.values()) { const m = e.reduce((s2, p) => s2 + p.h, 0) / e.length; for (const p of e) p.h = m; }
    all.forEach((p, i) => { if (!Number.isNaN(hard[i]!)) p.h = up[i]! > -Infinity && hard[i] === up[i] ? Math.max(p.h, hard[i]!) : Math.min(p.h, hard[i]!); });
    if (!moved) break;
  }
}
/** a road's height at a distance along it (between its stations) */
export function heightAlong(st: readonly Station[], s: number): number {
  if (s <= st[0]!.s) return st[0]!.h;
  for (let i = 1; i < st.length; i++) if (st[i]!.s >= s) { const a = st[i - 1]!, b = st[i]!, f = (s - a.s) / (b.s - a.s || 1); return a.h + (b.h - a.h) * f; }
  return st[st.length - 1]!.h;
}
