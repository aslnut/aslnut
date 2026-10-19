import type { StageGate } from '../../runtime/workers/compile/patch-policy.ts';
import { runStage11Earthworks } from '../landform/compose/earthworks.ts';
import { facetsOf, FacetIndex } from './facets.ts';
import { footpathGrade } from './structures/footpath-grade.ts';
import { carriagewaySeams } from './seams.ts';
import { drapePaint } from './paint.ts';
import { patchPolicy, patch, type Patch } from '../../runtime/workers/compile/patch-policy.ts';
// core › geometry › networks › junctions: the polygon stage and the kerb, after the line graph and the
// heights. Three stages, in order:
//   1. the line graph (solve.ts): centre lines with their class and width, chained, their heights solved; kept as the
//      routing graph, never drawn
//   2. the polygons: every road buffered to its carriageway (and kerb), cut where its level changes; the buffers of a
//      level UNIONED into one surface (bridges and elevated roads a level of their own, tunnels too; a ramp in the
//      level it is tagged with along its length, a cap where it changes). Close junctions, short connectors and ramps
//      that leave together merge by themselves: there are no platforms to solve. Each junction's corners rounded by a
//      morphological closing (out by r, back by r) of its arms, r by the smaller road's class (15 / 12.5 / 7.5 m; 4 m
//      on service roads), kept to the corner's sector, so only the concave corners fill (a median or a gore between
//      arms leaving nearly together is never filled). Then a small closing (gaps under 1.5 m), an opening (slivers
//      under 0.8 m wide) and pieces and holes under 20 m² dropped
//   3. the kerb LAST: a band 0.45 m wide inward from the FINAL outline of each level (one continuous kerb round every
//      block; across a cap, where the road goes on at another level, none), a parapet on a deck, a retaining wall in a
//      cut, a plain edge on a freeway. Markings along the centre lines, clipped to the surface and stopped inside the
//      junction zones (where two or more buffers overlap); stop and give-way lines and crossings at a zone's edge
// Heights: every vertex from the solved centre lines near it (inverse distance), a junction zone planar (a plane
// through its outline, blended into its roads over 6 m). Polygons by Clipper2 (clipper2-ts, Boost Software Licence
// 1.0), at bake time only: the device never loads it.
import { unionD, intersectD, differenceD, inflatePathsD, simplifyPathsD, areaD, ellipseD, FillRule, JoinType, EndType, type PathD, type PathsD } from 'clipper2-ts';
import { along, heightAlong, lengthOf } from './sections.ts';
import type { BakePath, BakeCrossing, Chain, P3, Piece, SolveOptions, SolveReport, ClampOut, Ground } from './bake-types.ts';
import type { SolvedWater } from '../landform/terraform/hydrology.ts';
import type { BankedStation } from './vertical.ts';
import { runStage09Footways } from './footways.ts';
import { hRun, runStage10Piers } from './structures/piers.ts';

type P2 = [number, number];
/** a line of the walking graph: a footpath's middle (mapped), a crossing, a link from a kerb ramp to the footpath, a path */
export interface WalkLine { pts: P2[]; kind: 'footpath' | 'crossing' | 'link' | 'path' }
const PREC = 2, ARC = 0.08, CELL = 20, COVER = 5.6, DECK = 1.8, KERB = 0.45, LIFT = 0.035;
/** a sliver: narrower than this (m); a piece or a hole: smaller than this (m²) */
export const SLIVER = 0.8, MIN_AREA = 20, GAP = 1.5;
/** Return radii and verge defaults are supplied by the caller. */

const inflate = (p: PathsD, d: number, end: EndType = EndType.Polygon) => inflatePathsD(p, d, JoinType.Round, end, 2, PREC, ARC);
const union = (p: PathsD) => (p.length ? unionD(p, [], FillRule.NonZero, PREC) : []);
const toPath = (pts: readonly P2[]): PathD => pts.map((p) => ({ x: p[0], y: p[1] }));
const closing = (p: PathsD, r: number) => inflate(inflate(p, r), -r);
const opening = (p: PathsD, r: number) => inflate(inflate(p, -r), r);
export const pip = (x: number, z: number, ring: PathD) => { let inside = false; for (let i = 0, k = ring.length - 1; i < ring.length; k = i++) { const A = ring[i]!, B = ring[k]!; if ((A.y > z) !== (B.y > z) && x < ((B.x - A.x) * (z - A.y)) / (B.y - A.y) + A.x) inside = !inside; } return inside; };
const segDist = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => { const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)); return { d: Math.hypot(x - ax - dx * t, z - az - dz * t), t }; };
const bboxOf = (p: PathD) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const q of p) { x0 = Math.min(x0, q.x); x1 = Math.max(x1, q.x); z0 = Math.min(z0, q.y); z1 = Math.max(z1, q.y); } return { x0, z0, x1, z1 }; };

/** polygons with their holes (outers positive, holes negative, as Clipper gives them) */
export interface Poly { outer: PathD; holes: PathD[] }
export function polysOf(paths: PathsD): Poly[] {
  const outers = paths.filter((p) => areaD(p) > 0).map((outer) => ({ outer, holes: [] as PathD[], box: bboxOf(outer) }));
  for (const h of paths) { if (areaD(h) >= 0) continue; const q = h[0]!; const o = outers.find((o) => q.x >= o.box.x0 && q.x <= o.box.x1 && q.y >= o.box.z0 && q.y <= o.box.z1 && pip(q.x, q.y, o.outer)); if (o) o.holes.push(h); }
  return outers.map(({ outer, holes }) => ({ outer, holes }));
}
export const inPoly = (x: number, z: number, p: Poly) => pip(x, z, p.outer) && !p.holes.some((h) => pip(x, z, h));
/** a surface cut into CELL squares (by 500 m, then 100 m, then the cells: each clip sees only what its parent kept) */
export function cellsOf(paths: PathsD, cell = CELL): Map<string, Poly[]> {
  const out = new Map<string, Poly[]>(); if (!paths.length) return out;
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const p of paths) { const b = bboxOf(p); x0 = Math.min(x0, b.x0); z0 = Math.min(z0, b.z0); x1 = Math.max(x1, b.x1); z1 = Math.max(z1, b.z1); }
  const step = (ps: PathsD, size: number, bx0: number, bz0: number, bx1: number, bz1: number, f: (ps: PathsD, ix: number, iz: number) => void) => {
    const boxes = ps.map(bboxOf);
    for (let ix = Math.floor(bx0 / size); ix * size < bx1; ix++) for (let iz = Math.floor(bz0 / size); iz * size < bz1; iz++) {
      // (a boolean intersection, not Clipper's rectangle clip: that one cut corners where an outline crossed a side)
      // (only the paths whose box touches the square: a strip a kilometre away costs nothing)
      const x0 = ix * size, z0 = iz * size, inSq = ps.filter((p, k) => { const b = boxes[k]!; return b.x1 >= x0 && b.x0 <= x0 + size && b.z1 >= z0 && b.z0 <= z0 + size; });
      if (!inSq.length) continue;
      const r = intersectD(inSq, [[{ x: x0, y: z0 }, { x: x0 + size, y: z0 }, { x: x0 + size, y: z0 + size }, { x: x0, y: z0 + size }]], FillRule.NonZero, PREC);
      const keep = r.filter((p) => p.length >= 3 && Math.abs(areaD(p)) > 1e-4); if (keep.length) f(keep, ix, iz);
    }
  };
  step(paths, 500, x0, z0, x1, z1, (t, tx, tz) => cell > 100 ? step(t, cell, tx * 500, tz * 500, (tx + 1) * 500, (tz + 1) * 500, (c, cx, cz) => { const ps = polysOf(c); if (ps.length) out.set(`${cx},${cz}`, ps); }) : step(t, 100, tx * 500, tz * 500, (tx + 1) * 500, (tz + 1) * 500, (b, bx, bz) => step(b, cell, bx * 100, bz * 100, (bx + 1) * 100, (bz + 1) * 100, (c, cx, cz) => { const ps = polysOf(c); if (ps.length) out.set(`${cx},${cz}`, ps); })));
  return out;
}
/** a region (a surface's cells): is a point inside? */
export class Region {
  readonly cells: Map<string, Poly[]>; readonly cell: number;
  constructor(cells: Map<string, Poly[]>, cell = CELL) { this.cells = cells; this.cell = cell; }
  has(x: number, z: number): boolean { const c = this.cells.get(`${Math.floor(x / this.cell)},${Math.floor(z / this.cell)}`); return !!c && c.some((p) => inPoly(x, z, p)); }
}
/** a grid of things with a box, for nearby queries */
export class Grid<T> {
  private m = new Map<string, T[]>();
  private size: number;
  constructor(size: number) { this.size = size; }
  add(x0: number, z0: number, x1: number, z1: number, v: T) { for (let i = Math.floor(x0 / this.size); i <= Math.floor(x1 / this.size); i++) for (let k = Math.floor(z0 / this.size); k <= Math.floor(z1 / this.size); k++) { const key = `${i},${k}`; let l = this.m.get(key); if (!l) this.m.set(key, (l = [])); l.push(v); } }
  near(x: number, z: number, r = 0): T[] { if (!r) return this.m.get(`${Math.floor(x / this.size)},${Math.floor(z / this.size)}`) ?? []; const out = new Set<T>(); for (let i = Math.floor((x - r) / this.size); i <= Math.floor((x + r) / this.size); i++) for (let k = Math.floor((z - r) / this.size); k <= Math.floor((z + r) / this.size); k++) for (const v of this.m.get(`${i},${k}`) ?? []) out.add(v); return [...out]; }
}

//** a stretch of one chain on one level (cut where the level, the width, or cover changes) */
export interface Run { baseLevel:number; s0:number; chain: Chain; ci: number; level: number; bridge: boolean; pts: P2[]; hs: number[]; banks: number[]; acc: number[]; half: number; outer: number; nodes: [number | null, number | null]; caps: [Cap | null, Cap | null]; prev: Run | null; next: Run | null }
interface Cap { at: P2; t: P2; outer: number; h: number; kind: 'level' | 'portal'; level: number }
interface Seg { ax: number; az: number; ah: number; abank: number; bx: number; bz: number; bh: number; bbank: number; run: Run }
interface Zone { poly: Poly; box: { x0: number; z0: number; x1: number; z1: number }; plane: ((x: number, z: number) => number) | null }

export interface SurfaceInput {
  snapshot?:(stage:number,pieces?:Piece[],terrain?:Ground)=>void; radiusOf:(cls:number)=>number; vergeWidths:Record<number,number>; markings?:(context:MarkingContext)=>void;
  chains: Chain[]; st: Map<Chain, BankedStation[]>; G: (x: number, z: number) => number;
  roadInfo: Map<Chain, number>; info: (kind: string, props: Record<string, unknown>) => number;
  crossings: BakeCrossing[]; jn: Set<number>; degree: (n: number) => number;
  /** roundabouts: each ring (its centre line, closed), its half width and level */
  rings: { ring: P2[]; half: number; level: number }[];
  /** the footpaths, park paths and crossings mapped as their own lines (with their tags) */
  paths?: BakePath[];
  /** the road reserves (the land between the property lines: road casements), where the data has them */
  reserves?: P2[][];
  /** a footpath's width where its data says none: the region's or the council's default (caller defaults) */
  footpathWidth?: (x: number, z: number) => number;
  waters?: readonly SolvedWater[];
  options?: SolveOptions;
  terrain: Ground;
  gate: (gate: StageGate) => void;
  patch: (stage: number, change: Patch, infoIds?: number[]) => void;
}
const bankAlong = (st: readonly BankedStation[], s: number): number => {
  if (!st.length) return 0;
  if (s <= st[0]!.s) return st[0]!.bank ?? 0;
  for (let i = 1; i < st.length; i++) if (st[i]!.s >= s) { const a = st[i - 1]!, b = st[i]!, f = (s - a.s) / (b.s - a.s || 1); return (a.bank ?? 0) + ((b.bank ?? 0) - (a.bank ?? 0)) * f; }
  return st[st.length - 1]!.bank ?? 0;
};
/** the verge where the data has no reserve: from the kerb to the property line by class (caller profiles) */
export function surfaces(I: SurfaceInput, pieces: Piece[], clamp: ClampOut, report: SolveReport): { walk: WalkLine[]; verge: { S0: PathsD; F: PathsD; N: PathsD; R: PathsD }; gates: StageGate[] } {
  const { chains, st, G } = I;
  const radiusOf=I.radiusOf, VERGE=I.vergeWidths;
  const chainNodes=new Map(chains.map(c=>[c,new Set(c.edges.flatMap(e=>e.nodes))]));
  const deckLocations:NonNullable<StageGate["locations"]>=[];
  const policyErrors: string[] = [],footwayPolicyErrors:string[]=[];
  const gates: StageGate[] = [],inferredLevels:Record<string,number>={};
  const runKey=(r:Run)=>`${r.chain.id}:${r.pts[0]!.join(",")}:${r.pts[r.pts.length-1]!.join(",")}:${r.half}`;
  const gate = (stage: number, id: string, counts: Record<string, number>, worst: Record<string, number>, flagged: (string|number)[], errors: string[], corrections?: StageGate["corrections"]) => { const g:StageGate={stage,id,name:id,ok:!errors.length,counts,worst,flagged,errors,...(corrections?{corrections}:{}),...(stage===8&&errors.length?{surfaceLevels:inferredLevels,locations:deckLocations}:{})}; gates.push(g); I.gate(g); };
  const T0 = performance.now(), TIME = !!(globalThis as { process?: { env?: Record<string, string> } }).process?.env?.BAKE_TIMING; let T1 = T0;
  const tick = (what: string) => { if (TIME) { const t = performance.now(); console.log(`  ${what}: ${((t - T1) / 1000).toFixed(1)} s`); T1 = t; } };
  // ── 1. runs: each chain cut where its level, its width or its cover changes ──
  const runs: Run[] = [];
  chains.forEach((c, ci) => {
    const stations = st.get(c)!, L = lengthOf(c.pts);
    if (L < 0.3) return;
    // the chain's points every 4 m at most, each piece's level from the point that carries it
    const dense: { p: P2; d: number; seg: number }[] = [];
    let acc = 0;
    for (let i = 0; i < c.pts.length; i++) {
      if (i) {
        const a = c.pts[i - 1]!, b = c.pts[i]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(l / 4));
        for (let k = 1; k <= n; k++) dense.push({ p: [a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n], d: acc + (l * k) / n, seg: i });
        acc += l;
      } else dense.push({ p: c.pts[0]!, d: 0, seg: 1 });
    }
    const keyOf = (k: number) => { // the piece from dense k − 1 to k
      const a = dense[k - 1]!, b = dense[k]!, pp = c.point[b.seg]!, dm = (a.d + b.d) / 2, mx = (a.p[0] + b.p[0]) / 2, mz = (a.p[1] + b.p[1]) / 2;
      const covered = pp.tunnel && heightAlong(stations, dm) < G(mx, mz) - COVER;
      return { level: covered ? NaN : pp.layer, half: pp.half, bridge: pp.bridge };
    };
    type Key = { level: number; half: number; bridge: boolean };
    let last: Run | null = null;
    let k0 = 1;
    const kerb = c.prof.kerb;
    const flush = (k1: number, key: Key, prev: Key | null, next: Key | null) => {
      if (Number.isNaN(key.level)) { last = null; return; }
      const ps = dense.slice(k0 - 1, k1 + 1);
      const pts = ps.map((q) => q.p), hs = ps.map((q) => heightAlong(stations, q.d)), banks = ps.map((q) => bankAlong(stations, q.d)), accs = ps.map((q) => q.d - ps[0]!.d);
      const promenade=key.bridge && c.prof.promenade ? 1.5 : 0;
      const outer = key.half + (kerb || key.bridge ? KERB : 0) + promenade;
      const capAt = (end: 0 | 1, other: Key | null): Cap | null => {
        if (!other || other.level === key.level) return null;
        const i = end === 0 ? 0 : pts.length - 1, j = end === 0 ? 1 : pts.length - 2, dx = pts[i]![0] - pts[j]![0], dz = pts[i]![1] - pts[j]![1], l = Math.hypot(dx, dz) || 1;
        return { at: pts[i]!, t: [dx / l, dz / l], outer, h: hs[i]!, kind: Number.isNaN(other.level) ? 'portal' : 'level', level: key.level };
      };
      const run: Run = { baseLevel:key.level, s0:ps[0]!.d, chain: c, ci, level: key.level, bridge: key.bridge, pts, hs, banks, acc: accs, half: key.half, outer, nodes: [k0 === 1 ? c.a : null, k1 === dense.length - 1 ? c.b : null], caps: [capAt(0, prev), capAt(1, next)], prev: last, next: null };
      if (last) last.next = run;
      runs.push(run); last = run;
    };
    let prevKey: Key | null = null, cur = keyOf(1);
    for (let k = 2; k <= dense.length; k++) {
      const nk = k < dense.length ? keyOf(k) : null;
      if (nk && (nk.level === cur.level || (Number.isNaN(nk.level) && Number.isNaN(cur.level))) && nk.half === cur.half && nk.bridge === cur.bridge) continue;
      flush(k - 1, cur, prevKey, nk); prevKey = cur; k0 = k; if (nk) cur = nk;
    }
  });
  // ── roads on one level that run over or beside each other at different heights without meeting (no node in common:
  // a street over a cutting, a ramp on its bank beside a street): the one further off the ground moved half a level up
  // or down, a level of its own, capped where it leaves the rest of its road ──
  {
    const hAt = (r: Run, x: number, z: number) => { const pr = project(r, x, z); for (let i = 1; i < r.acc.length; i++) if (r.acc[i]! >= pr.d) { const f = (pr.d - r.acc[i - 1]!) / (r.acc[i]! - r.acc[i - 1]! || 1); return r.hs[i - 1]! + (r.hs[i]! - r.hs[i - 1]!) * f; } return r.hs[r.hs.length - 1]!; };
    const boxOf = (r: Run) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const p of r.pts) { x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); z0 = Math.min(z0, p[1]); z1 = Math.max(z1, p[1]); } return { x0: x0 - r.outer, z0: z0 - r.outer, x1: x1 + r.outer, z1: z1 + r.outer }; };
    const grid = new Grid<{ r: Run; b: ReturnType<typeof boxOf>; i: number }>(50), items = runs.map((r, i) => ({ r, b: boxOf(r), i }));
    for (const it of items) grid.add(it.b.x0, it.b.z0, it.b.x1, it.b.z1, it);
    const moved = new Set<Run>();
    for(const r of runs){const hint=I.options?.surfaceLevels?.[runKey(r)];if(hint!==undefined&&hint!==r.level){r.level=hint;moved.add(r);report.lifted++;}}
    for (const A of items) for (const B of grid.near((A.b.x0 + A.b.x1) / 2, (A.b.z0 + A.b.z1) / 2, Math.max(A.b.x1 - A.b.x0, A.b.z1 - A.b.z0) / 2 + 1)) {
      const a = A.r, b = B.r;
      if (B.i <= A.i || a.chain === b.chain || a.level !== b.level || (a.bridge && b.bridge) || moved.has(a) || moved.has(b)) continue;
      // Ground-layer arms form one surface. Profile disagreement is not
      // evidence of a grade-separated crossing in the measured plan.
      
      if (A.b.x1 < B.b.x0 || B.b.x1 < A.b.x0 || A.b.z1 < B.b.z0 || B.b.z1 < A.b.z0) continue;
      if([...chainNodes.get(a.chain)!].some(n=>chainNodes.get(b.chain)!.has(n)))continue;
      const o = intersectD(inflate([toPath(a.pts)], a.outer, EndType.Butt), inflate([toPath(b.pts)], b.outer, EndType.Butt), FillRule.NonZero, PREC).filter((p) => Math.abs(areaD(p)) > 1);
      if (!o.length) continue;
      let cx = 0, cz = 0, n = 0; for (const p of o) for (const q of p) { cx += q.x; cz += q.y; n++; } cx /= n; cz /= n;
      const ha = hAt(a, cx, cz), hb = hAt(b, cx, cz); if (Math.abs(ha - hb) < 1) continue;
      // Ordinary ground-arm disagreements stay one union (a touching step is opened by seams.ts).
      // Raised approaches with a real multi-metre gap need independent ownership.
      if(!a.bridge&&!b.bridge&&a.baseLevel===0&&b.baseLevel===0&&Math.abs(ha-hb)<4)continue;
      const g = G(cx, cz), m = Math.abs(ha - g) >= Math.abs(hb - g) ? a : b, hm = m === a ? ha : hb, ho = m === a ? hb : ha;
      m.level += hm > ho ? 0.5 : -0.5; moved.add(m); report.lifted++;
    }
    for(const r of moved) {
      const policy = patchPolicy(I.options, 'level-separate', 'repair',[r.chain.id]);
      if (policy === 'stop') policyErrors.push(`level separation required for ${r.chain.id}`);
      if (policy === 'omit') { const i = runs.indexOf(r); if (i >= 0) runs.splice(i, 1); }
      I.patch(7, patch('level-separate', policy, 'level-separate', [r.chain.id], {runs:1},
        {levelDelta:Math.abs(r.level-r.baseLevel)}, {fromLevel:r.baseLevel,toLevel:r.level,sourcePlanMoved:false}), [I.roadInfo.get(r.chain) ?? 0]);
      inferredLevels[runKey(r)] = r.level;
      if(r.level>r.baseLevel&&r.hs.some((h,i)=>h-G(r.pts[i]![0],r.pts[i]![1])>3.5))r.bridge=true;
    }
    for (const r of moved) for (const end of [0, 1] as const) {
      const nb = end === 0 ? r.prev : r.next; if (!nb || nb.level === r.level) continue;
      const capOf = (q: Run, e: 0 | 1): Cap => { const i = e === 0 ? 0 : q.pts.length - 1, j = e === 0 ? 1 : q.pts.length - 2, dx = q.pts[i]![0] - q.pts[j]![0], dz = q.pts[i]![1] - q.pts[j]![1], l = Math.hypot(dx, dz) || 1; return { at: q.pts[i]!, t: [dx / l, dz / l], outer: q.outer, h: q.hs[i]!, kind: 'level', level: q.level }; };
      r.caps[end] = capOf(r, end); const e2 = end === 0 ? 1 : 0; nb.caps[e2] = capOf(nb, e2);
    }
  }
  const levels = [...new Set(runs.map((r) => r.level))].sort((a, b) => a - b);
  const ri = new Map(runs.map((r, i) => [r, i]));
  report.levels = levels.length;
  // ── heights: the runs' segments by level, in a 20 m grid ──
  const segs = new Map<number, Grid<Seg>>();
  for (const r of runs) {
    let g = segs.get(r.level); if (!g) segs.set(r.level, (g = new Grid<Seg>(20)));
    for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1]!, b = r.pts[i]!; g.add(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), { ax: a[0], az: a[1], ah: r.hs[i - 1]!, abank: r.banks[i - 1] ?? 0, bx: b[0], bz: b[1], bh: r.hs[i]!, bbank: r.banks[i] ?? 0, run: r }); }
  }
  /** the roads near a place on a level, each its nearest point's distance and height (with Stage 06 superelevation roll on bridge decks) */
  const nearRoads = (level: number, x: number, z: number, reach = 25) => {
    const best = new Map<Chain, { d: number; h: number; run: Run }>();
    for (const s of segs.get(level)?.near(x, z, reach + 8) ?? []) {
      const { d, t } = segDist(x, z, s.ax, s.az, s.bx, s.bz); if (d > s.run.half + reach) continue;
      let h = s.ah + (s.bh - s.ah) * t;
      const bank = s.abank + (s.bbank - s.abank) * t;
      if (Math.abs(bank) > 1e-4) {
        const dx = s.bx - s.ax, dz = s.bz - s.az, l = Math.hypot(dx, dz) || 1;
        const uLat = Math.max(-s.run.half, Math.min(s.run.half, ((x - s.ax) * -dz + (z - s.az) * dx) / l));
        h -= uLat * Math.tan(bank);
      }
      const b = best.get(s.run.chain); if (!b || d < b.d) best.set(s.run.chain, { d, h, run: s.run });
    }
    return [...best.values()];
  };
  const idw = (level: number, x: number, z: number): number => {
    let near = nearRoads(level, x, z);
    if (!near.length) near = nearRoads(level, x, z, 80);
    if (!near.length) return G(x, z);
    let sw = 0, sh = 0; for (const n of near) { const e = Math.max(0, n.d - n.run.half), w = 1 / (e + 0.3) ** 3; sw += w; sh += w * n.h; }
    return sh / sw;
  };
  const nearestRun = (level: number, x: number, z: number): Run | null => { let best: { d: number; run: Run } | null = null; for (const n of nearRoads(level, x, z, 40)) if (!best || n.d < best.d) best = { d: n.d, run: n.run }; return best?.run ?? null; };

  tick('runs and heights');
  // ── 2. the polygons, level by level ──
  const S = new Map<number, PathsD>(), J = new Map<number, PathsD>(), Jraw = new Map<number, PathsD>(), cells = new Map<number, Map<string, Poly[]>>();
  const capsOf = new Map<number, Cap[]>();
  for (const r of runs) for (const c of r.caps) if (c) { let l = capsOf.get(c.level); if (!l) capsOf.set(c.level, (l = [])); l.push(c); }
  // the nodes where runs end, by level: their arms
  const ends = new Map<string, { node: number; level: number; arms: { run: Run; end: 0 | 1 }[] }>();
  for (const r of runs) for (const end of [0, 1] as const) { const n = r.nodes[end]; if (n === null) continue; const k = `${r.level}:${n}`; let e = ends.get(k); if (!e) ends.set(k, (e = { node: n, level: r.level, arms: [] })); e.arms.push({ run: r, end }); }
  // a node where a road goes on at another level (a bridge or a tunnel starting at a junction's node): on a level
  // where only one road ends there, no round end, a cap instead (no kerb across the road)
  const levelsAt = new Map<number, Set<number>>();
  for (const e of ends.values()) { let l = levelsAt.get(e.node); if (!l) levelsAt.set(e.node, (l = new Set())); l.add(e.level); }
  const crossLevel = new Set<string>();
  for (const [k, e] of ends) {
    if ((levelsAt.get(e.node)?.size ?? 0) < 2 || e.arms.length !== 1) continue;
    crossLevel.add(k);
    const { run, end } = e.arms[0]!; if (run.caps[end]) continue;
    const i = end === 0 ? 0 : run.pts.length - 1, j = end === 0 ? 1 : run.pts.length - 2, dx = run.pts[i]![0] - run.pts[j]![0], dz = run.pts[i]![1] - run.pts[j]![1], l = Math.hypot(dx, dz) || 1;
    const cap: Cap = { at: run.pts[i]!, t: [dx / l, dz / l], outer: run.outer, h: run.hs[i]!, kind: 'level', level: run.level };
    run.caps[end] = cap; let cl = capsOf.get(run.level); if (!cl) capsOf.set(run.level, (cl = [])); cl.push(cap);
  }
  // each run's buffer; where it goes on as a narrower road (the next run of its chain, or the one other road at its end
  // node), it narrows to that width over its last 15 m (a smooth taper, never a step)
  const bufOf = new Map<Run, PathsD>();
  const goesOn = (r: Run, end: 0 | 1): Run | null => {
    const n = r.nodes[end]; if (n === null) return end === 0 ? r.prev : r.next;
    const e = ends.get(`${r.level}:${n}`); if (!e || e.arms.length !== 2) return null;
    return e.arms.find((a) => a.run !== r)?.run ?? null;
  };
  for (const r of runs) {
    const L = r.acc[r.acc.length - 1]!, taper: [number, number] = [0, 0], to: [number, number] = [r.outer, r.outer];
    for (const end of [0, 1] as const) { const nb = goesOn(r, end); if (nb && nb.level === r.level && nb.outer < r.outer - 0.3) { taper[end] = Math.min(15, L * 0.45); to[end] = nb.outer; } }
    if (!taper[0] && !taper[1]) { bufOf.set(r, inflate([toPath(r.pts)], r.outer, EndType.Butt)); continue; }
    const parts: PathsD = [];
    const mid = subLine(r, taper[0], L - taper[1]); if (mid.length > 1) parts.push(...inflate([toPath(mid)], r.outer, EndType.Butt));
    for (const end of [0, 1] as const) {
      if (!taper[end]) continue;
      const d0 = end === 0 ? 0 : L - taper[1], d1 = end === 0 ? taper[0] : L, line = subLine(r, d0, d1);
      const w = (d: number) => { const t = end === 0 ? 1 - (d - d0) / (d1 - d0 || 1) : (d - d0) / (d1 - d0 || 1), u = t * t * (3 - 2 * t); return r.outer + (to[end] - r.outer) * u; };
      let acc = d0; const left: PathD = [], right: PathD = [];
      for (let i = 0; i < line.length; i++) {
        if (i) acc += Math.hypot(line[i]![0] - line[i - 1]![0], line[i]![1] - line[i - 1]![1]);
        const a = line[Math.max(0, i - 1)]!, b = line[Math.min(line.length - 1, i + 1)]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / l, nz = (b[0] - a[0]) / l, hw = w(acc);
        left.push({ x: line[i]![0] + nx * hw, y: line[i]![1] + nz * hw }); right.push({ x: line[i]![0] - nx * hw, y: line[i]![1] - nz * hw });
      }
      parts.push([...left, ...right.reverse()]);
    }
    bufOf.set(r, union(parts));
  }
  const discOf = (e: { arms: { run: Run; end: 0 | 1 }[] }) => { const a = e.arms[0]!, p = a.end === 0 ? a.run.pts[0]! : a.run.pts[a.run.pts.length - 1]!, rad = Math.min(...e.arms.map((x) => x.run.outer)); return ellipseD({ x: p[0], y: p[1] }, rad, rad, 32); };
  let nZones = 0, nPlanar = 0, maxZoneResidualM=0;const nonPlanar:P2[]=[],zoneFlags:string[]=[];
  const zonesByLevel = new Map<number, { grid: Grid<Zone>; list: Zone[] }>();
  for (const level of levels) {
    const lr = runs.filter((r) => r.level === level);
    const parts: PathsD = lr.flatMap((r) => bufOf.get(r)!), junction: PathsD = [];
    // a disc at every node where runs end (a dead end's round end; the wedge outside a bend at a junction filled)
    for (const [k, e] of ends) if (e.level === level && !crossLevel.has(k)) { const d = discOf(e); parts.push(d); if (e.arms.length >= 2) junction.push(d); }
    // each junction's concave corners: its arms two by two, closed by the smaller road's radius, kept to their sector
    const fills: PathsD = [];
    for (const e of ends.values()) {
      if (e.level !== level || e.arms.length < 2) continue;
      const arms = e.arms.map(({ run, end }) => {
        const L = run.acc[run.acc.length - 1]!, rr = radiusOf(run.chain.prof.cls), reach = Math.min(L, 3 * rr + run.outer + 12);
        // the arm's line from the node outward, its direction from the node to 8 m out
        const pts = end === 0 ? run.pts : [...run.pts].reverse(), acc = end === 0 ? run.acc : run.acc.map((a) => L - a).reverse();
        const local: P2[] = []; for (let i = 0; i < pts.length && (i === 0 || acc[i - 1]! < reach); i++) local.push(pts[i]!);
        const q = along(pts, Math.min(L, 8)), o = pts[0]!;
        return { run, local, o, angle: Math.atan2(q.z - o[1], q.x - o[0]) };
      }).sort((a, b) => a.angle - b.angle);
      for (let k = 0; k < arms.length; k++) {
        const A = arms[k]!, B = arms[(k + 1) % arms.length]!; if (A === B) continue;
        let th = B.angle - A.angle; if (th <= 0) th += 2 * Math.PI;
        // (up to a little past straight on: a step where a wider road goes on as narrower ones is smoothed too)
        if (th < (25 * Math.PI) / 180 || th > (195 * Math.PI) / 180) continue;
        // (a roundabout's ring on both sides: its island, never filled)
        if (A.run.chain.roundabout && B.run.chain.roundabout) continue;
        const r = radiusOf(Math.max(A.run.chain.prof.cls, B.run.chain.prof.cls)), R = 3 * r + Math.max(A.run.outer, B.run.outer) + 10;
        const P = union([...inflate([toPath(A.local)], A.run.outer, EndType.Butt), ...inflate([toPath(B.local)], B.run.outer, EndType.Butt), discOf(e)]);
        const fill = differenceD(closing(P, r), P, FillRule.NonZero, PREC);
        if (!fill.length) continue;
        const sector: PathD = [{ x: A.o[0], y: A.o[1] }]; const n = Math.max(2, Math.ceil(th / 0.15)); for (let i = 0; i <= n; i++) { const a = A.angle + (th * i) / n; sector.push({ x: A.o[0] + Math.cos(a) * R, y: A.o[1] + Math.sin(a) * R }); }
        const f = intersectD(fill, [sector], FillRule.NonZero, PREC);
        for (const p of f) if (Math.abs(areaD(p)) > 0.05) { fills.push(p); junction.push(p); }
      }
    }
    // the overlaps of different roads' buffers: the junction zones (with the corners and the discs)
    const bg = new Grid<{ run: Run; box: ReturnType<typeof bboxOf> }>(50);
    const boxes = lr.map((r) => ({ run: r, box: bboxOf(bufOf.get(r)![0] ?? []) }));
    for (const b of boxes) if (Number.isFinite(b.box.x0)) bg.add(b.box.x0, b.box.z0, b.box.x1, b.box.z1, b);
    const seen = new Set<string>();
    for (const a of boxes) for (const b of bg.near((a.box.x0 + a.box.x1) / 2, (a.box.z0 + a.box.z1) / 2, Math.max(a.box.x1 - a.box.x0, a.box.z1 - a.box.z0) / 2 + 1)) {
      if (a.run.chain === b.run.chain || a.run === b.run) continue;
      const ia = ri.get(a.run)!, ib = ri.get(b.run)!, k = ia < ib ? `${ia}:${ib}` : `${ib}:${ia}`; if (seen.has(k)) continue; seen.add(k);
      if (a.box.x1 < b.box.x0 || b.box.x1 < a.box.x0 || a.box.z1 < b.box.z0 || b.box.z1 < a.box.z0) continue;
      for (const p of intersectD(bufOf.get(a.run)!, bufOf.get(b.run)!, FillRule.NonZero, PREC)) if (Math.abs(areaD(p)) > 0.5) junction.push(p);
    }
    // the union, the small closing (gaps under 1.5 m), the opening (slivers), small pieces and holes dropped
    let s = union([...parts, ...fills]);
    s = opening(closing(s, GAP / 2), SLIVER / 2);
    // (the offsets leave micro-steps of a few centimetres: smoothed out, a kerb's direction is read from its outline)
    s = union(simplifyPathsD(s.filter((p) => Math.abs(areaD(p)) >= MIN_AREA), 0.04, true));
    S.set(level, s); Jraw.set(level, junction);
  }
  tick('polygons');
  const connectedMerge=(r:Run,low:Run,x:number,z:number)=>r.chain.edges.some(e=>e.nodes.some((node,j)=>{
    if(!chainNodes.get(low.chain)!.has(node))return false;const at=e.pts[j]!,distance=Math.hypot(x-at[0],z-at[1]),ordinary=r.outer+low.outer+20;
    if(distance<ordinary)return true;
    // Nearly parallel incoming arms share a graded deck; they are not stacked traffic.
    // The overlap length is determined by their widths / sin(angle), rather than a fixed cap radius.
    if(!r.caps.some(c=>c?.kind==='level'&&Math.hypot(c.at[0]-at[0],c.at[1]-at[1])<.1))return false;
    const a=alongRun(r,project(r,at[0],at[1]).d),b=alongRun(low,project(low,at[0],at[1]).d),dot=Math.abs(a.tx*b.tx+a.tz*b.tz);
    if(dot<.82)return false;const sine=Math.sqrt(Math.max(0,1-dot*dot)),extent=Math.min((r.outer+low.outer)/Math.max(.05,sine)+2,7.3/(r.chain.prof.maxGrade));
    return distance<extent;
  }));
  // ── where two levels' surfaces overlap at nearly the same height (a road going on at another level, by its cap): the
  // overlap kept by the lower level only; along the seam no kerb on either (see `open`) ──
  for (let a = 0; a < levels.length; a++) for (let b = a + 1; b < levels.length; b++) {
    const la = levels[a]!, lb = levels[b]!, o = intersectD(S.get(la)!, S.get(lb)!, FillRule.NonZero, PREC);
    const cut: PathsD = [];
    for (const p of polysOf(o)) {
      // (in 2 m squares: where the two lie within 0.75 m of each other)
      const bx = bboxOf(p.outer), sq: PathsD = [];
      for (let x = Math.floor(bx.x0 / 2) * 2; x < bx.x1; x += 2) for (let z = Math.floor(bx.z0 / 2) * 2; z < bx.z1; z += 2) {
        const cx = x + 1, cz = z + 1; if (Math.abs(idw(la, cx, cz) - idw(lb, cx, cz)) >= 1.25) continue;
        sq.push([{ x: x - 0.1, y: z - 0.1 }, { x: x + 2.1, y: z - 0.1 }, { x: x + 2.1, y: z + 2.1 }, { x: x - 0.1, y: z + 2.1 }]);
      }
      if (sq.length) cut.push(...intersectD(union(sq), [p.outer, ...p.holes], FillRule.NonZero, PREC));
    }
    if (cut.length) S.set(lb, union(simplifyPathsD(opening(differenceD(S.get(lb)!, inflate(cut, 0.05), FillRule.NonZero, PREC), SLIVER / 2).filter((p) => Math.abs(areaD(p)) >= MIN_AREA), 0.04, true)));
  }
  // ── each roundabout's island: its ring's centre line moved in by the half width and the kerb (a mini roundabout's,
  // too small for that, a disc of 1.5 m in its middle) ──
  for (const g of I.rings) {
    const s = S.get(g.level); if (!s) continue;
    const ring = toPath(g.ring); if (areaD(ring) < 0) ring.reverse();
    let island = inflate([ring], -(g.half + KERB));
    if (!island.length || Math.abs(island.reduce((a, p) => a + areaD(p), 0)) < 7) {
      let cx = 0, cz = 0, A = 0; for (let i = 0; i < ring.length; i++) { const p = ring[i]!, q = ring[(i + 1) % ring.length]!, c = p.x * q.y - q.x * p.y; A += c; cx += (p.x + q.x) * c; cz += (p.y + q.y) * c; }
      island = [ellipseD({ x: cx / (3 * A), y: cz / (3 * A) }, 1.5, 1.5, 24)];
    }
    S.set(g.level, union(differenceD(s, island, FillRule.NonZero, PREC)));
    report.islands++;
  }
  for (const level of levels) {
    const s = S.get(level)!;
    report.holes += s.filter((p) => areaD(p) < 0).length;
    const j = intersectD(union(Jraw.get(level)!), s, FillRule.NonZero, PREC).filter((p) => Math.abs(areaD(p)) > 2);
    J.set(level, j);
    cells.set(level, cellsOf(s));
    // the junction zones: each a plane through its outline (planar unless its roads disagree by more than 0.35 m)
    const zl: Zone[] = [], zg = new Grid<Zone>(50);
    for (const poly of polysOf(j)) {
      const pts: P3[] = []; const o = poly.outer;
      for (let i = 0; i < o.length; i++) { const a = o[i]!, b = o[(i + 1) % o.length]!, l = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(l / 3)); for (let k = 0; k < n; k++) { const x = a.x + ((b.x - a.x) * k) / n, z = a.y + ((b.y - a.y) * k) / n; pts.push([x, z, idw(level, x, z)]); } }
      const mean=pts.reduce((v,p)=>v+p[2],0)/Math.max(1,pts.length),plane=fitPlane(pts)??(()=>mean),resid=Math.max(0,...pts.map(p=>Math.abs(plane(p[0],p[1])-p[2])));maxZoneResidualM=Math.max(maxZoneResidualM,resid);
      const zone: Zone = { poly, box: bboxOf(o), plane: resid < 0.35 ? plane : null };
      nZones++; if (zone.plane) nPlanar++; else {const x=(zone.box.x0+zone.box.x1)/2,z=(zone.box.z0+zone.box.z1)/2;nonPlanar.push([x,z]);zoneFlags.push(`zone:${level}:${nZones}:${nearestRun(level,x,z)?.chain.id??'unknown'}`);}
      zl.push(zone); zg.add(zone.box.x0 - 6, zone.box.z0 - 6, zone.box.x1 + 6, zone.box.z1 + 6, zone);
    }
    zonesByLevel.set(level, { grid: zg, list: zl });
  }
  report.zones = nZones; report.planar = nPlanar; report.nonPlanarAt = nonPlanar;
  /** the height of the surface of a level at a place: its roads' (inverse distance), a junction zone's plane within it,
   *  blended into the roads over 6 m round it */
  const memo = new Map<string, number>();
  // the two caps of one level joint (each run's end) are one elevation: their mean
  { const all:Cap[]=[];for(const r of runs)for(const c of r.caps)if(c&&c.kind==='level')all.push(c);const groups:Cap[][]=[];
    for(const c of all){const g=groups.find(g=>g.some(o=>o.level===c.level&&Math.hypot(o.at[0]-c.at[0],o.at[1]-c.at[1])<0.5));if(g)g.push(c);else groups.push([c]);}
    for(const cs of groups)if(cs.length>1){const h=cs.reduce((v,c)=>v+c.h,0)/cs.length;for(const c of cs)c.h=h;} }
  const joints=new Map(levels.map(level=>[level,runs.filter(r=>r.level===level&&r.caps.some(c=>c?.kind==='level'))]));
  const H = (level: number, x: number, z: number): number => {
    const key = `${level}:${x.toFixed(2)},${z.toFixed(2)}`; const m = memo.get(key); if (m !== undefined) return m;
    let h = idw(level, x, z);
    let best: { d: number; z: Zone } | null = null;
    for (const zn of zonesByLevel.get(level)?.grid.near(x, z) ?? []) {
      if (!zn.plane || x < zn.box.x0 - 6 || x > zn.box.x1 + 6 || z < zn.box.z0 - 6 || z > zn.box.z1 + 6) continue;
      let d = 0; if (!inPoly(x, z, zn.poly)) { d = Infinity; const o = zn.poly.outer; for (let i = 0; i < o.length; i++) { const a = o[i]!, b = o[(i + 1) % o.length]!; d = Math.min(d, segDist(x, z, a.x, a.y, b.x, b.y).d); } }
      if (d < 6 && (!best || d < best.d)) best = { d, z: zn };
    }
    if (best) { const w = best.d <= 0 ? 1 : 1 - smooth(best.d / 6); h = best.z.plane!(x, z) * w + h * (1 - w); }
    // A level boundary is a joint, with one solved elevation across the full abutment.
    // Blend to the connected profile rather than averaging unrelated nearby approaches.
    // exactly on a joint line: that joint's one solved elevation, before any blend
    let exact=false;
    let nearestCap=Infinity;
    for(const r of joints.get(level)??[])for(const cap of r.caps){if(!cap||cap.kind!=='level')continue;const dx=x-cap.at[0],dz=z-cap.at[1],along=dx*cap.t[0]+dz*cap.t[1],across=Math.abs(-dx*cap.t[1]+dz*cap.t[0]);
      // two joints on one line (side-by-side roads): the one whose road the point is on
      if(Math.abs(along)<.02&&across<=cap.outer+1&&across<nearestCap&&patchPolicy(I.options,'deck-connection','repair',[r.chain.id])==='repair'){h=cap.h;exact=true;nearestCap=across;}}
    if(!exact)joint: for(const r of joints.get(level)??[])for(const cap of r.caps){if(!cap||cap.kind!=='level')continue;const dx=x-cap.at[0],dz=z-cap.at[1],along=dx*cap.t[0]+dz*cap.t[1],across=Math.abs(-dx*cap.t[1]+dz*cap.t[0]);if(Math.abs(along)>6||across>cap.outer+1)continue;
      if(patchPolicy(I.options,'deck-connection','repair',[r.chain.id])!=='repair')continue;
      if(nearestRun(level,x,z)!==r)continue;
      const station=r.caps[0]===cap?Math.max(0,-along):r.acc.at(-1)!+Math.min(0,along),profile=hRun(r,station),weight=1-smooth(Math.abs(along)/6);h=h*(1-weight)+profile*weight;break joint;
    }
    memo.set(key, h); return h;
  };
  // Reconcile the final joint heights with the two-dimensional seam ownership.
  for(let a=0;a<levels.length;a++)for(let b=a+1;b<levels.length;b++){
    const la=levels[a]!,lb=levels[b]!,cut:PathsD=[];
    for(const p of polysOf(intersectD(S.get(la)!,S.get(lb)!,FillRule.NonZero,PREC))){const box=bboxOf(p.outer);
      for(let x=Math.floor(box.x0/2)*2;x<box.x1;x+=2)for(let z=Math.floor(box.z0/2)*2;z<box.z1;z+=2)if(Math.abs(H(la,x+1,z+1)-H(lb,x+1,z+1))<1.25)cut.push([{x:x-.1,y:z-.1},{x:x+2.1,y:z-.1},{x:x+2.1,y:z+2.1},{x:x-.1,y:z+2.1}]);
    }
    if(cut.length){const shape=union(simplifyPathsD(opening(differenceD(S.get(lb)!,union(cut),FillRule.NonZero,PREC),SLIVER/2).filter(p=>Math.abs(areaD(p))>=MIN_AREA),.04,true));S.set(lb,shape);cells.set(lb,cellsOf(shape));}
  }
  tick('overlaps, islands, zones');
  const regionS = new Map<number, Region>(), regionJ = new Map<number, Region>();
  for (const level of levels) { regionS.set(level, new Region(cells.get(level)!)); regionJ.set(level, new Region(cellsOf(J.get(level)!))); }

  // ── valid outlines: no ring crosses itself or another ──
  for (const level of levels) report.invalid += crossingsIn(S.get(level)!);
  // ── slivers: what an opening would still take away ──
  // (a piece of it counts when it is more than half a square metre and more than 10 cm wide on average: the opening's own
  // arcs differ from the outline's by crescents a few centimetres thin, which are not slivers)
  const perim = (p: PathD) => { let l = 0; for (let i = 0; i < p.length; i++) { const a = p[i]!, b = p[(i + 1) % p.length]!; l += Math.hypot(b.x - a.x, b.y - a.y); } return l; };
  for (const level of levels) { const s = S.get(level)!; const left = differenceD(s, opening(s, SLIVER / 2), FillRule.NonZero, PREC); for (const p of left) { const A = Math.abs(areaD(p)); if (A > 0.5 && (2 * A) / perim(p) > 0.1) { report.slivers++; if (report.sliverAt.length < 10) report.sliverAt.push([p[0]!.x, p[0]!.y]); } } }

  tick('checks');
  // ── z-fighting: two levels' surfaces over each other within 0.5 m ──
  for (let a = 0; a < levels.length; a++) for (let b = a + 1; b < levels.length; b++) {
    const o = intersectD(S.get(levels[a]!)!, S.get(levels[b]!)!, FillRule.NonZero, PREC);
    for (const p of polysOf(o)) {
      const bx = bboxOf(p.outer);
      for (let x = bx.x0 + 1; x < bx.x1; x += 4) for (let z = bx.z0 + 1; z < bx.z1; z += 4) {
        if (!inPoly(x, z, p)) continue;
        if (Math.abs(H(levels[a]!, x, z) - H(levels[b]!, x, z)) < 0.5) { report.zfight++; if (report.zfightAt.length < 10) report.zfightAt.push([x, z]); }
      }
    }
  }
  gate(7,'junction-union-per-level',{levels:levels.length,junctionZones:nZones,planarZones:nPlanar,invalid:report.invalid,slivers:report.slivers,zfight:report.zfight},{maxZoneResidualM,areaM2:levels.reduce((v,l)=>v+S.get(l)!.reduce((a,p)=>a+areaD(p),0),0)},zoneFlags,[...policyErrors,...(report.invalid?[`${report.invalid} invalid outlines`]:[]),...(report.slivers?[`${report.slivers} slivers`]:[]),...(report.zfight?[`${report.zfight} overlapping levels within 0.5 m`]:[])]);
  // ── the surfaces: one piece per cell, every vertex at its height; a deck's underside under it ──
  const infoAt = (level: number, x: number, z: number) => { const r = nearestRun(level, x, z); return r ? I.roadInfo.get(r.chain) ?? 0 : 0; };
  const groundCells:PathsD=[];
  for (const level of levels) {
    // A cell whose triangles would span a height step (two touching roads at different heights) is cut into
    // quarters, down to 2.5 m, so the surface follows each road and only a thin seam is left for the step-wall.
    const refine = (p: Poly, size: number): { p: Poly; rings: P3[][] }[] => {
      const rings = [p.outer, ...p.holes].map((r) => r.map((q) => [q.x, q.y, H(level, q.x, q.y)] as P3));
      if (size <= 2.6) return [{ p, rings }];
      const steep = facetsOf([{ t: 'area', kind: 'carriageway', info: 0, rings }]).some((f) => { const [a, b, c] = f.points, hs = [a[2], b[2], c[2]], den = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]); if (Math.abs(den) < 1e-8 || Math.max(...hs) - Math.min(...hs) < 0.75) return false; const gx = ((b[2] - a[2]) * (c[1] - a[1]) - (c[2] - a[2]) * (b[1] - a[1])) / den, gz = ((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / den; return Math.hypot(gx, gz) > 0.25; });
      if (!steep) return [{ p, rings }];
      const box = bboxOf(p.outer), half = size / 2, x0 = Math.floor(box.x0 / half) * half, z0 = Math.floor(box.z0 / half) * half, out: { p: Poly; rings: P3[][] }[] = [];
      for (let x = x0; x < box.x1; x += half) for (let z = z0; z < box.z1; z += half) {
        const q = intersectD([p.outer, ...p.holes], [[{ x, y: z }, { x: x + half, y: z }, { x: x + half, y: z + half }, { x, y: z + half }]], FillRule.NonZero, PREC);
        for (const sub of polysOf(q)) if (Math.abs(areaD(sub.outer)) > 0.01) out.push(...refine(sub, half));
      }
      return out;
    };
    for (const [, ps] of cells.get(level)!) for (const cell of ps) {
      { const o=cell.outer;let cx=0,cz=0;for(const q of o){cx+=q.x/o.length;cz+=q.y/o.length;}const sup=nearestRun(level,cx,cz);if(!(!!sup?.bridge||(sup?.baseLevel??0)>0))groundCells.push(cell.outer,...cell.holes); }
      for (const { p, rings } of refine(cell, CELL)) {
      const r0 = rings[0]!, c: P2 = [0, 0]; for (const q of r0) { c[0] += q[0] / r0.length; c[1] += q[1] / r0.length; } const id = infoAt(level, c[0], c[1]);
      const support=nearestRun(level,c[0],c[1]);
      pieces.push({ t: 'area', kind: 'carriageway', rings, info: id,level,overhead:!!support?.bridge||(support?.baseLevel??0)>0 });

      // the clamp: the ground under the road, at grade and in cuts (and a deck's ends, low over the ground)
      // (every level's: the clamp only lowers, so a deck high over the ground changes nothing under it)
      if(!support?.bridge)clamp.cells.push(rings);
      else if(rings.some(r=>r.some(q=>q[2]-G(q[0],q[1])<3.6)))clamp.cells.push(rings.map(r=>r.map(q=>[q[0],q[1],q[2]-DECK])));
    }
    }
  }
  // One thin slab uses exactly the carriageway facets; no independent tessellation or stacked shell.
  const deckFacets=new FacetIndex(facetsOf(pieces.filter(p=>p.kind==='carriageway')));
  const deckHeight=(level:number,x:number,z:number)=>deckFacets.at(x,z).find(f=>f.piece.t==='area'&&f.piece.level===level)?.height(x,z)??H(level,x,z);
  for(const p of pieces.slice())if(p.t==='area'&&p.kind==='carriageway'&&p.overhead){pieces.push({...p,kind:'deck-under',rings:p.rings.map(r=>r.map(q=>[q[0],q[1],q[2]-.35])),down:true});}
  for(const r of runs.filter(r=>r.bridge))for(const offset of [-r.half*.5,r.half*.5]){
    const left:PathD=[],right:PathD=[];
    for(const d of r.acc){const q=alongRun(r,d);for(const [edge,off]of [[left,offset-.325],[right,offset+.325]] as const)edge.push({x:q.x-q.tz*off,y:q.z+q.tx*off});}
    const shape=[...left,...right.reverse()];if(areaD(shape)<0)shape.reverse();
    const girder=intersectD([shape],S.get(r.level)!,FillRule.NonZero,PREC),info=I.roadInfo.get(r.chain)??0;
    for(const [,ps]of cellsOf(girder))for(const p of ps){const rings=[p.outer,...p.holes].map(ring=>ring.map(q=>[q.x,q.y,deckHeight(r.level,q.x,q.y)-DECK] as P3));pieces.push({t:'area',kind:'girder-under',rings,down:true,info,overhead:true});}
    for(const ring of girder){const line=[...ring,ring[0]!].map(q=>[q.x,q.y,deckHeight(r.level,q.x,q.y)-.35,deckHeight(r.level,q.x,q.y)-DECK] as [number,number,number,number]);pieces.push({t:'wall',kind:'girder',line,info});}
  }
  I.snapshot?.(7,pieces.filter(p=>p.kind!=='deck-under'&&p.kind!=='girder-under'&&p.kind!=='girder'));
  // the ground roads' surface as the union made it (the verges and paths are cut from it, seams included)
  // (from the union's own cells, before their refinement)
  const S0 = union(groundCells);
  const groundRegion = new Region(cellsOf(S0));
  // A union polygon spanning a height step between two touching roads is no road: cut out to the ground.
  const seamRepair=carriagewaySeams(pieces,I.options,(change,ids)=>I.patch(8,change,ids));
  for(let pass=0;pass<2;pass++){const again=carriagewaySeams(pieces,I.options,(change,ids)=>I.patch(8,change,ids));for(const k of Object.keys(again.counts) as (keyof typeof again.counts)[])if(k!=='seamFacetsChecked')seamRepair.counts[k]+=again.counts[k];seamRepair.worst.seamAreaRemovedM2+=again.worst.seamAreaRemovedM2;seamRepair.worst.maxSeamStepM=Math.max(seamRepair.worst.maxSeamStepM,again.worst.maxSeamStepM);}
  const seamCheck=carriagewaySeams(pieces,I.options,()=>{},.25,.75,false);seamRepair.counts.carriagewaySteepFacets=seamCheck.counts.carriagewaySteepFacets;seamRepair.worst.maxCarriagewayGrade=seamCheck.worst.maxCarriagewayGrade;
  tick('surface cells');
  const ramps: P2[] = [], walkLines: WalkLine[] = [], rampGrid = new Grid<P2>(10);
  let F: PathsD = [], N: PathsD = [], Rz: PathsD = [];
  // Half-levels assign height ownership; pedestrian surfaces yield to every ground road.
  const groundLevels = levels.filter(l => runs.some(r => r.level === l && !r.bridge && r.baseLevel <= 0));
  const groundHeight = (x:number,z:number) => {
    const near = groundLevels.flatMap(l => nearRoads(l,x,z,40)).filter(n => !n.run.bridge);
    near.sort((a,b) => Math.max(0,a.d-a.run.half)-Math.max(0,b.d-b.run.half));
    return near[0] ? H(near[0].run.level,x,z) : G(x,z);
  };
  // ── 3. the kerb, last: along each level's final outline, never across a cap ──
  let kerbSeamsOpened=0;
  const centre = new Map<number, Grid<{ a: P2; b: P2 }>>();
  for (const r of runs) { let g = centre.get(r.level); if (!g) centre.set(r.level, (g = new Grid(30))); for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1]!, b = r.pts[i]!; g.add(Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1]), { a, b }); } }
  for (const level of levels) {
    const caps = capsOf.get(level) ?? [], s = S.get(level)!;
    const others = levels.filter((l) => l !== level);
    // open: across a cap, or along a seam with another level's surface at nearly the same height (the road goes on there)
    const seam = (x: number, z: number) => others.some((l) => { const r = regionS.get(l)!; if (![[0, 0], [0.3, 0], [-0.3, 0], [0, 0.3], [0, -0.3]].some(([dx, dz]) => r.has(x + dx!, z + dz!))) return false; return Math.abs(idw(l, x, z) - idw(level, x, z)) < 1.6; });
    const open = (x: number, z: number) => seam(x, z) || caps.some((c) => { const n: P2 = [-c.t[1], c.t[0]]; return segDist(x, z, c.at[0] - n[0] * (c.outer + 1), c.at[1] - n[1] * (c.outer + 1), c.at[0] + n[0] * (c.outer + 1), c.at[1] + n[1] * (c.outer + 1)).d < 0.8; });
    for (const ring0 of s) {
      // (its edges cut to 2 m at most: whether a stretch is open is decided where it is, not by its far ends)
      const hole = areaD(ring0) < 0, ring = densify([...ring0, ring0[0]!].map((q) => [q.x, q.y] as P2), 2).slice(0, -1).map((p) => ({ x: p[0], y: p[1] })), n = ring.length; if (n < 3) continue;
      // which side is inward (into the surface): the left of the ring's way round, or the right
      const a0 = ring[0]!, b0 = ring[1]!, l0 = Math.hypot(b0.x - a0.x, b0.y - a0.y) || 1, mx = (a0.x + b0.x) / 2 + (-(b0.y - a0.y) / l0) * 0.01, mz = (a0.y + b0.y) / 2 + ((b0.x - a0.x) / l0) * 0.01;
      const leftInRing = pip(mx, mz, ring), sign = (leftInRing ? 1 : -1) * (hole ? -1 : 1);
      // the ring's edges, open ones (across a cap) left out: the rest as lines
      const isOpen = ring.map((q) => open(q.x, q.y)), edgeOpen = ring.map((_, i) => isOpen[i]! && isOpen[(i + 1) % n]!);
      const start = edgeOpen.findIndex(Boolean);
      const lines: P2[][] = [];
      if (start < 0) lines.push([...ring, ring[0]!].map((q) => [q.x, q.y] as P2));
      else { let cur: P2[] = []; for (let k = 1; k <= n; k++) { const i = (start + k) % n; if (edgeOpen[i]) { if (cur.length > 1) lines.push(cur); cur = []; continue; } if (!cur.length) cur.push([ring[i]!.x, ring[i]!.y]); const q = ring[(i + 1) % n]!; cur.push([q.x, q.y]); } if (cur.length > 1) lines.push(cur); }
      for (const raw of lines) edgeLine(level, withRamps(densify(rdp(thin(raw, 0.3), 0.03), 6), level === 0 ? rampGrid : null), sign, raw.length > 2 && raw[0]![0] === raw[raw.length - 1]![0] && raw[0]![1] === raw[raw.length - 1]![1]);
    }
  }
  function edgeLine(level: number, line: P2[], sign: number, closed: boolean): void {
    const n = line.length; if (n < 2) return;
    // inward normals (mitred, at most twice as long)
    const N = line.map((p, i) => {
      const a = line[i === 0 ? (closed ? n - 2 : 0) : i - 1]!, b = line[i === n - 1 ? (closed ? 1 : n - 1) : i + 1]!;
      const e1 = i === 0 && !closed ? null : norm2([p[0] - a[0], p[1] - a[1]]), e2 = i === n - 1 && !closed ? null : norm2([b[0] - p[0], b[1] - p[1]]);
      const l1: P2 | null = e1 && [-e1[1], e1[0]], l2: P2 | null = e2 && [-e2[1], e2[0]];
      const m = norm2(l1 && l2 ? [l1[0] + l2[0], l1[1] + l2[1]] : (l1 ?? l2)!), cos = l1 && l2 ? Math.max(0.5, m[0] * l1[0] + m[1] * l1[1]) : 1;
      return [(m[0] * sign) / cos, (m[1] * sign) / cos] as P2;
    });
    const h = line.map((p) => H(level, p[0], p[1])), g = line.map((p) => G(p[0], p[1]));
    const run = line.map((p) => nearestRun(level, p[0], p[1]));
    const ramp = (i: number) => level === 0 && rampGrid.near(line[i]![0], line[i]![1], 1).some((r) => Math.hypot(r[0] - line[i]![0], r[1] - line[i]![1]) < 0.9);
    // Urban kerbs stay kerbs in a cut. Retaining walls belong behind the footway,
    // rather than replacing random stretches of kerb according to the raw DEM.
    const kindAt = (i: number) => (run[i]?.bridge ? (run[i]!.chain.prof.deckEdge) : run[i]?.chain.prof.plainEdge ? 'edge' : ramp(i) ? 'ramp' : 'kerb');
    const inner = line.map((p, i) => [p[0] + N[i]![0] * KERB, p[1] + N[i]![1] * KERB] as P2);
    let k0 = 0;
    const clampLine: P3[] = [];
    const flushClamp = () => { if (clampLine.length > 1) clamp.edges.push(clampLine.slice()); clampLine.length = 0; };
    for (let k = 0; k < n; k++) {
      const kind = kindAt(k);
      if(kind!=='deck'&&kind!=='viaduct') clampLine.push([line[k]![0], line[k]![1], h[k]!]);else if(h[k]!-g[k]!<3.6)clampLine.push([line[k]![0],line[k]![1],h[k]!-DECK]);else flushClamp();
      if (k + 1 < n && kindAt(k + 1) === kind) continue;
      const part = Array.from({ length: k + 1 - Math.max(0, k0 - 1) }, (_, q) => Math.max(0, k0 - 1) + q); k0 = k + 1;
      if (part.length < 2) continue;
      const id = I.roadInfo.get(run[part[0]!]?.chain ?? chains[0]!) ?? 0;
      const O = part.map((j) => line[j]!), In = part.map((j) => inner[j]!);
      // one piece along the edge: each point's place, height, ground and its inward offset; the device builds the
      // kerb's top, face and foot (or a deck's parapet and side, a cut's wall, a freeway's edge) from it
      const groups:number[][]=[];
      if(kind==='kerb'){
        let cur=[part[0]!];
        for(let q=1;q<part.length;q++){const j0=part[q-1]!,j1=part[q]!,a=line[j0]!,b=line[j1]!;const bad=centre.get(level)!.near((a[0]+b[0])/2,(a[1]+b[1])/2,4).some(c=>crosses(a,b,c.a,c.b)||crosses(inner[j0]!,inner[j1]!,c.a,c.b));
          if(bad) {
            const policy = patchPolicy(I.options, 'kerb-clip', 'repair',[String(id)]);
            I.patch(8, patch('kerb-clip', policy, 'kerb-clip', [String(id)], {segments:1}, {removedLengthM:Math.hypot(b[0]-a[0],b[1]-a[1])}, {from:a,to:b,parentComponent:'kerb'}), [id]);
            if(policy==='stop') { cur.push(j1); continue; }
            if(cur.length>1)groups.push(cur);cur=[j1];kerbSeamsOpened++;
            if(policy==='omit'){groups.length=0;cur=[];break;}
          }else cur.push(j1);
        }if(cur.length>1)groups.push(cur);
      }else groups.push(part);
      for(const indices of groups){pieces.push({t:'edge',kind,pts:indices.map(j=>[line[j]![0],line[j]![1],h[j]!,g[j]!,inner[j]![0]-line[j]![0],inner[j]![1]-line[j]![1]]),info:id});
        if(kind==='kerb'){report.kerbLength+=lengthOf(indices.map(j=>line[j]!));for(const j of indices)if(!regionS.get(level)!.has(inner[j]![0],inner[j]![1])){report.kerbOutside++;report.kerbOutsideAt.push(inner[j]!);}
          for(let k=1;k<indices.length;k++){const j0=indices[k-1]!,j1=indices[k]!;for(const L of [line,inner]){const a=L[j0]!,b=L[j1]!;for(const c of centre.get(level)!.near((a[0]+b[0])/2,(a[1]+b[1])/2,4))if(crosses(a,b,c.a,c.b)){report.kerbCrossings++;report.kerbCrossingAt.push(a);}}}
        }
      }

    }
    flushClamp();
  }

  tick('kerbs');
  // Bridge promenades and viaduct safety assemblies use the corridor's solved frames.
  let groundBoulevards=0,urbanPromenades=0,motorwayViaducts=0;
  for(const r of runs){if(!r.bridge){groundBoulevards++;continue;}const id=I.roadInfo.get(r.chain)??0,promenade=r.chain.prof.promenade;if(promenade)urbanPromenades++;else motorwayViaducts++;
    for(const side of [-1,1]){const inner:P3[]=[],outer:P3[]=[],fence:[number,number,number,number][]=[];
      for(let i=0;i<r.pts.length;i++){const q=alongRun(r,r.acc[i]!),off=(u:number,h:number):P3=>[q.x-q.tz*u*side,q.z+q.tx*u*side,H(r.level,q.x-q.tz*u*side,q.z+q.tx*u*side)+h];if(promenade){inner.push(off(r.half+.28,.2));outer.push(off(r.outer-.45,.2));}const f=off(r.outer-.2,promenade?1.15:1.25);fence.push([f[0],f[1],f[2],f[2]-.05]);}
      if(promenade)pieces.push({t:'strip',kind:'footpath',edges:[inner,outer],info:id,overhead:true});pieces.push({t:'wall',kind:'parapet',line:fence,info:id});
    }
  }
  let deckSamplesChecked=0,shortDeckSamples=0,approachSeamSamples=0,leastDeckClearance=Infinity;
  const shortDeckIds=new Set<string>(),deckCorrections:NonNullable<StageGate["corrections"]>=[];
  for(const r of runs){if(!r.bridge)continue;for(let i=0;i<r.pts.length;i++){const p=r.pts[i]!,d=r.acc[i]!;
    // A connected cap is an approach seam, not a stacked crossing.
    if(r.caps.some(c=>c&&Math.hypot(c.at[0]-p[0],c.at[1]-p[1])<Math.max(20,r.outer+8))){approachSeamSamples++;continue;}
    const q=alongRun(r,d);
    for(const u of [-r.half,0,r.half]){const x=q.x-q.tz*u,z=q.z+q.tx*u;for(const [lv,reg] of regionS){if(lv>=r.level||!reg.has(x,z))continue;const low=nearestRun(lv,x,z);if(low&&connectedMerge(r,low,x,z)){approachSeamSamples++;continue;}const clear=H(r.level,x,z)-DECK-H(lv,x,z);deckSamplesChecked++;leastDeckClearance=Math.min(leastDeckClearance,clear);if(clear<5.5-.01){shortDeckSamples++;shortDeckIds.add(r.chain.id);deckLocations.push({at:[x,z],ids:[r.chain.id,low?.chain.id??'unknown'],value:clear,metric:'soffit-clearance-m'});for(const n of nearRoads(r.level,x,z,0)){const pr=project(n.run,x,z),q=alongRun(n.run,pr.d);deckCorrections.push({road:n.run.chain.id,at:[q.x,q.z],s:n.run.s0+pr.d,minimum:n.h+5.5-clear+.8});}}}}
  }}
  let deckJointSamples=0,deckConnectionFailures=0,maxDeckJointGapM=0;
  for(const r of runs)for(const cap of r.caps){if(!cap||cap.kind!=='level')continue;
    const before=idw(r.level,cap.at[0],cap.at[1]),after=H(r.level,cap.at[0],cap.at[1]);
    if(Math.abs(before-cap.h)>.02)I.patch(8,patch('deck-connection','repair','seat-continuous-approach',[r.chain.id],{joints:1},{heightCorrectionM:Math.abs(before-cap.h)},{at:cap.at,fromHeightM:before,toHeightM:after,sourcePlanMoved:false}),[I.roadInfo.get(r.chain)??0]);
    for(const u of [-r.half,0,r.half]){const x=cap.at[0]-cap.t[1]*u,z=cap.at[1]+cap.t[0]*u,gap=Math.abs(H(r.level,x,z)-cap.h);deckJointSamples++;maxDeckJointGapM=Math.max(maxDeckJointGapM,gap);if(gap>.03)deckConnectionFailures++;}
  }
  gate(8,'corridor-templates' ,{...seamRepair.counts,deckJointSamples,deckConnectionFailures,groundBoulevards,urbanPromenades,motorwayViaducts,kerbSeamsOpened,deckSamplesChecked,shortDeckSamples,approachSeamSamples,kerbOutside:report.kerbOutside,kerbCrossings:report.kerbCrossings},{...seamRepair.worst,maxDeckJointGapM,kerbLengthM:report.kerbLength,leastDeckClearanceM:Number.isFinite(leastDeckClearance)?leastDeckClearance:0},[...shortDeckIds],[...seamRepair.errors,...seamCheck.errors,...(deckConnectionFailures?[`${deckConnectionFailures} deck joints detached from approaches`]:[]),...(report.kerbOutside?[`${report.kerbOutside} kerb inner vertices off surface`]:[]),...(report.kerbCrossings?[`${report.kerbCrossings} kerbs across a road`]:[]),...(shortDeckSamples?[`${shortDeckSamples} deck samples below 5.5 m (${[...shortDeckIds].join(', ')})`]:[])],deckCorrections);
  I.snapshot?.(8);
  // ── 2b. the verges (at grade): the reserve less the road is the verge; footpaths from the data first, generated
  // along the property line where the data has none; crossings with kerb ramps at the junctions' arms and the marked
  // crossings, linked to the footpaths across the verge; the nature strip what is left ──
  if (S0 && S0.length) {
    const fid = I.info('footpath', { osm:(I.paths??[]).filter(p=>p.sidewalk).map(p=>p.id), what: 'footpath', source: 'Mapped paths and generated reserve paths' }), nid = I.info('nature strip', { what: 'nature strip', source: 'the road reserve less the road and its footpaths' });
    const w0 = (x: number, z: number) => I.footpathWidth?.(x, z) ?? 1.5;
    const kerbed = runs.filter((r) => r.baseLevel === 0 && !r.bridge && r.chain.prof.kerb && r.chain.prof.verge);
    // the reserve: the data's (and the road surface in it), else each kerbed road's verge by its class
    // (a kerbed road the data's reserves leave out, or leave less than 3 m of verge: its verge by the rules, added)
    const raw = (I.reserves ?? []).map((r) => toPath(r)).map((p) => (areaD(p) < 0 ? p.reverse() : p)), Rd = raw.length ? union(raw) : [];
    const rg = new Grid<PathD>(100); for (const p of raw) { const b = bboxOf(p); rg.add(b.x0, b.z0, b.x1, b.z1, p); }
    const syn = kerbed.filter((r) => {
      if (!raw.length) return true;
      const b = inflate([toPath(r.pts)], r.outer + 3, EndType.Butt), A = Math.abs(b.reduce((a, p) => a + areaD(p), 0)), bb = bboxOf(b[0] ?? []);
      const local = rg.near((bb.x0 + bb.x1) / 2, (bb.z0 + bb.z1) / 2, Math.max(bb.x1 - bb.x0, bb.z1 - bb.z0) / 2 + 1);
      return A > 0 && (!local.length || Math.abs(intersectD(b, union(local), FillRule.NonZero, PREC).reduce((a, p) => a + areaD(p), 0)) / A < 0.8);
    });
    const R = union([...Rd, ...S0, ...syn.flatMap((r) => inflate([toPath(r.pts)], r.outer + (VERGE[r.chain.prof.cls] ?? 4), EndType.Round))]);
    report.reserveRules = syn.length;
    Rz = R;
    tick('  reserve');
    const V = opening(differenceD(R, S0, FillRule.NonZero, PREC), 0.3);
    tick('  verge land');
    // footpaths from the data: mapped sidewalks buffered to their width
    const num = (v: string | undefined) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) && n > 0.5 && n < 8 ? n : null; };
    const side = (I.paths ?? []).filter((p) => p.sidewalk && p.pts.length > 1);
    const Fd = union(side.flatMap((p) => { const m = p.pts[Math.floor(p.pts.length / 2)]!; return inflate([toPath(p.pts)], (p.width ?? w0(m[0], m[1])) / 2, EndType.Round); }));
    for (const p of side) walkLines.push({ pts: p.pts, kind: 'footpath' });
    tick('  mapped footpaths');
    // generated where the data has none: a band along the property line, inside the reserve, beside a kerbed road,
    // away from a mapped sidewalk, not along a road whose tags say it has none
    const wm = (() => { let x = 0, z = 0, n = 0; for (const r of kerbed) { const q = r.pts[0]!; x += q[0]; z += q[1]; n++; } return n ? w0(x / n, z / n) : 1.5; })(), gap = 0.05;
    let Gen = differenceD(inflate(R, -gap), inflate(R, -(gap + wm)), FillRule.NonZero, PREC);
    Gen = intersectD(Gen, V, FillRule.NonZero, PREC);
    Gen = intersectD(Gen, union(kerbed.flatMap((r) => inflate([toPath(r.pts)], r.outer + (VERGE[r.chain.prof.cls] ?? 4) + 6, EndType.Round))), FillRule.NonZero, PREC);
    if (side.length) Gen = differenceD(Gen, union(side.flatMap((p) => inflate([toPath(p.pts)], 3, EndType.Round))), FillRule.NonZero, PREC);
    const none = kerbed.filter((r) => r.chain.noSidewalk);
    if (none.length) Gen = differenceD(Gen, union(none.flatMap((r) => inflate([toPath(r.pts)], r.outer + (VERGE[r.chain.prof.cls] ?? 4) + 2, EndType.Round))), FillRule.NonZero, PREC);
    tick('  generated footpaths');
    // (the generated band's middle line: the walking graph's footpath there)
    { const GenR = new Region(cellsOf(Gen)); for (const ring of inflate(R, -(gap + wm / 2))) { let cur: P2[] = []; for (const p of densify([...ring, ring[0]!].map((q) => [q.x, q.y] as P2), 2)) { if (GenR.has(p[0], p[1])) cur.push(p); else { if (cur.length > 1) walkLines.push({ pts: cur, kind: 'footpath' }); cur = []; } } if (cur.length > 1) walkLines.push({ pts: cur, kind: 'footpath' }); } }
    const clippedMapped=intersectD(Fd,V,FillRule.NonZero,PREC),clippedAreaM2=Math.max(0,Fd.reduce((v,p)=>v+areaD(p),0)-clippedMapped.reduce((v,p)=>v+areaD(p),0));
    if(clippedAreaM2>.1){const policy=patchPolicy(I.options,'path-clip','repair',side.map(p=>p.id));
      I.patch(9,patch('path-clip',policy,'path-clip',side.map(p=>p.id??'unknown'),{paths:side.length},{clippedAreaM2},{removedSurfaceAreaM2:clippedAreaM2,sourcePlanMoved:false}),[fid]);
      if(policy==='stop')footwayPolicyErrors.push(`Mapped sidewalks require ${clippedAreaM2} m² clipping`);
      F=union([...(policy==='omit'?[]:clippedMapped),...Gen]);
    }else F=union([...clippedMapped,...Gen]);
    tick('  footpath middles');
    // crossings: at each kerbed arm of a junction, just outside its zone, where both sides have a footpath near; and
    // where the data has a marked crossing. A kerb ramp at each end, a link of footpath from it across the verge
    const Fcells = new Region(cellsOf(F));
    const toFootpath = (x: number, z: number, nx: number, nz: number) => { for (let d = 0; d <= 14; d += 0.5) if (Fcells.has(x + nx * d, z + nz * d)) return d; return -1; };
    const links: PathsD = [];
    const crossAt = (r: Run, d: number) => {
      const q = alongRun(r, d), nx = -q.tz, nz = q.tx, o = r.outer;
      const ends = [-1, 1].map((sg) => { const x = q.x + nx * o * sg, z = q.z + nz * o * sg; return { x, z, n: [nx * sg, nz * sg] as P2, d: toFootpath(x, z, nx * sg, nz * sg) }; });
      if (ends.some((e) => e.d < 0)) return false;
      for (const e of ends) {
        ramps.push([e.x, e.z]); rampGrid.add(e.x, e.z, e.x, e.z, [e.x, e.z]);
        const fx = e.x + e.n[0] * (e.d + 0.4), fz = e.z + e.n[1] * (e.d + 0.4), tx = -e.n[1] * 0.75, tz = e.n[0] * 0.75;
        if (e.d > 0.05) links.push([{ x: e.x + tx - e.n[0] * 0.05, y: e.z + tz - e.n[1] * 0.05 }, { x: fx + tx, y: fz + tz }, { x: fx - tx, y: fz - tz }, { x: e.x - tx - e.n[0] * 0.05, y: e.z - tz - e.n[1] * 0.05 }]);
        walkLines.push({ pts: [[e.x, e.z], [fx, fz]], kind: 'link' });
      }
      walkLines.push({ pts: [[ends[0]!.x, ends[0]!.z], [ends[1]!.x, ends[1]!.z]], kind: 'crossing' });
      report.crossings++; return true;
    };
    const crossed = new Map<Run, number[]>();
    for (const x of I.crossings) {
      if (x.kind !== 'crossing') continue;
      let best: { r: Run; d: number; dist: number } | null = null;
      for (const n of nearRoads(0, x.at[0], x.at[1], 2)) { const pr = project(n.run, x.at[0], x.at[1]); if (pr.dist < 2 && (!best || pr.dist < best.dist)) best = { r: n.run, d: pr.d, dist: pr.dist }; }
      if (best && best.r.chain.prof.kerb && crossAt(best.r, best.d)) { let l = crossed.get(best.r); if (!l) crossed.set(best.r, (l = [])); l.push(best.d); }
    }
    for (const e of ends.values()) {
      if (e.level !== 0 || e.arms.length < 3) continue;
      for (const { run, end } of e.arms) {
        if (!run.chain.prof.kerb || !run.chain.prof.verge) continue;
        const L = run.acc[run.acc.length - 1]!; let dJ = -1;
        // (out from the node until it leaves the zone, having been in it: a node on a cell's edge may test outside)
        let seen = false; for (let s2 = 0; s2 <= Math.min(L, 60); s2 += 0.5) { const d = end === 0 ? s2 : L - s2, q = alongRun(run, d); if (regionJ.get(0)!.has(q.x, q.z)) seen = true; else if (seen) { dJ = s2; break; } }
        if (dJ < 0) continue;
        // (past the kerb returns too: where the road's own kerbs run straight on both sides, the footpaths beside them)
        let dk = -1; for (let s2 = dJ; s2 <= Math.min(L * 0.5, 60); s2 += 0.5) { const q = alongRun(run, end === 0 ? s2 : L - s2), o = run.outer + 0.3; if (!regionS.get(0)!.has(q.x - q.tz * o, q.z + q.tx * o) && !regionS.get(0)!.has(q.x + q.tz * o, q.z - q.tx * o)) { dk = s2; break; } }
        if (dk < 0 || dk + 2.5 > L * 0.5) continue;
        const d = end === 0 ? dk + 1 : L - dk - 1;
        if ((crossed.get(run) ?? []).some((c) => Math.abs(c - d) < 15)) continue;
        crossAt(run, d);
      }
    }
    tick('  crossings');
    // (opened a little more than the check's 0.6 m: what passes is wider than any sliver)
    F = opening(union([...F, ...intersectD(union(links), V, FillRule.NonZero, PREC)]), 0.36).filter((p) => Math.abs(areaD(p)) >= 2);
    F = union(F);
    N = union(opening(differenceD(V, F, FillRule.NonZero, PREC), 0.36).filter((p) => Math.abs(areaD(p)) >= 2));
    tick('  footpaths and strips');
    // park paths and other paths: the walking graph's too (not drawn here: a park's own ground)
    for (const p of I.paths ?? []) if (!p.sidewalk && !p.crossing && p.pts.length > 1) walkLines.push({ pts: p.pts, kind: 'path' });
    // heights: the kerb's top at the road's edge, rising 1 : 50 away from it (at most 0.4 m)
    const hvMemo = new Map<string, number>();
    const hv = (x: number, z: number) => { const k = `${x.toFixed(2)},${z.toFixed(2)}`; const m = hvMemo.get(k); if (m !== undefined) return m; let e = Infinity; for (const l of groundLevels) for (const n of nearRoads(l, x, z, 12)) if(!n.run.bridge) e = Math.min(e, n.d - n.run.half); if (!Number.isFinite(e)) e = 12; const v = groundHeight(x, z) + 0.15 + Math.min(0.4, 0.02 * Math.max(0, e - KERB)); hvMemo.set(k, v); return v; };
    for (const [kind, A, lift] of [['footpath', F, 0.02], ['verge', N, 0]] as const) {
      // (in 50 m cells: a verge is a narrow band, its heights the kerb's, smooth; the ground under it is the clamp's
      // shoulder beside the kerb and the property line)
      const cA = cellsOf(A, 50); tick(`    cells of ${kind}`);
      for (const [, ps] of cA) for (const p of ps) {
        const rings = [p.outer, ...p.holes].map((r) => r.map((q) => [q.x, q.y, hv(q.x, q.y) + lift] as P3));
        pieces.push({ t: 'area', kind, rings, info: kind === 'footpath' ? fid : nid });
      }
    }
    tick('  verge pieces');
    // the property line: the verge's outer edge, down into the ground (where the reserve ends at no road)
    for (const ring of R) {
      const pts = densify(rdp([...ring, ring[0]!].map((q) => [q.x, q.y] as P2), 0.05), 8);
      let run: [number, number, number, number, number, number][] = [];
      const flush = () => { if (run.length > 1) pieces.push({ t: 'edge', kind: 'edge', pts: run, info: nid }); if (run.length > 1) clamp.edges.push(run.map((q) => [q[0], q[1], q[2]] as P3)); run = []; };
      for (const p of pts) { if (groundRegion.has(p[0], p[1])) { flush(); continue; } run.push([p[0], p[1], hv(p[0], p[1]), G(p[0], p[1]), 0, 0]); }
      flush();
    }
    tick('  property line');
    report.footpathArea = Math.round(F.reduce((a, p) => a + areaD(p), 0)); report.vergeArea = Math.round(N.reduce((a, p) => a + areaD(p), 0)); report.reserveFrom = I.reserves?.length ? (syn.length ? 'data and rules' : 'data') : 'rules';
    report.sidewalksMapped = side.length;
    // the verge's checks: footpaths and strips never on the road, never on each other
    // (an overlap counts when it is more than half a square metre and 10 cm wide on average: the polygons' shared edges
    // differ by a few millimetres along their arcs, which is no overlap)
    const wide = (ps: PathsD) => ps.filter((p) => { const A = Math.abs(areaD(p)); let l = 0; for (let i = 0; i < p.length; i++) { const a = p[i]!, b = p[(i + 1) % p.length]!; l += Math.hypot(b.x - a.x, b.y - a.y); } return A > 0.5 && (2 * A) / l > 0.1; }).length;
    { // (simplified by 5 mm first: duplicate and spike vertices can stall the whole-place clip)
      const t=(ps:PathsD)=>simplifyPathsD(ps,.005,true),FN=union([...t(F),...t(N)]),S0t=t(S0);
      report.vergeOverlap = wide(intersectD(FN, S0t, FillRule.NonZero, PREC)) + wide(intersectD(t(F), t(N), FillRule.NonZero, PREC)); }
    for (const level of [0]) { const s2 = union([...simplifyPathsD(F,.005,true), ...simplifyPathsD(N,.005,true)]); const left = differenceD(s2, opening(s2, 0.3), FillRule.NonZero, PREC); for (const p of left) { const A = Math.abs(areaD(p)); let l = 0; for (let i = 0; i < p.length; i++) { const a = p[i]!, b = p[(i + 1) % p.length]!; l += Math.hypot(b.x - a.x, b.y - a.y); } if (A > 0.5 && (2 * A) / l > 0.1) { report.vergeSlivers++; if (report.vergeSliverAt.length < 10) report.vergeSliverAt.push([p[0]!.x, p[0]!.y]); } } void level; }
  }
  tick('verges');

  const footways=runStage09Footways(I.paths??[],runs,regionS,G,I.info,pieces,clamp,walkLines,I.options,(change,ids)=>I.patch(9,change,ids),groundRegion,groundHeight,I.waters??[]);
  // Crossing ramps split the already validated final kerb at their exact 1.8 m openings.
  const kerbPieces=pieces.filter((p):p is Extract<Piece,{t:'edge'}>=>p.t==='edge'&&p.kind==='kerb');
  for(const p of kerbPieces){
    const out:typeof p.pts=[p.pts[0]!];
    for(let i=1;i<p.pts.length;i++){const a=p.pts[i-1]!,b=p.pts[i]!,L=Math.hypot(b[0]-a[0],b[1]-a[1])||1,ts:number[]=[];
      for(const r of rampGrid.near((a[0]+b[0])/2,(a[1]+b[1])/2,L/2+1)){const q=segDist(r[0],r[1],a[0],a[1],b[0],b[1]);if(q.d<.5)for(const delta of [-1,-.9,.9,1]){const t=q.t+delta/L;if(t>0&&t<1)ts.push(t);}}
      ts.sort((a,b)=>a-b);for(const t of ts)out.push(a.map((v,j)=>v+(b[j]!-v)*t) as typeof a);out.push(b);
    }
    let cur:typeof out=[out[0]!],kind='';
    for(let i=1;i<out.length;i++){const a=out[i-1]!,b=out[i]!,x=(a[0]+b[0])/2,z=(a[1]+b[1])/2,next=rampGrid.near(x,z,1).some(r=>Math.hypot(r[0]-x,r[1]-z)<=.9)?'ramp':'kerb';
      if(kind&&next!==kind){if(cur.length>1)pieces.push({...p,kind,pts:cur});cur=[a];}kind=next;cur.push(b);
    }p.pts=cur;p.kind=kind;
  }

  // the road a footpath belongs to: its direction and grade there (a footpath may take its road's grade along it)
  const follow=(x:number,z:number)=>{let best:{d:number;s:Seg}|null=null;for(const l of levels)for(const s of segs.get(l)?.near(x,z,30)??[]){const {d}=segDist(x,z,s.ax,s.az,s.bx,s.bz);if(d>s.run.half+20)continue;if(!best||d<best.d)best={d,s};}if(!best)return null;const s=best.s,L=Math.hypot(s.bx-s.ax,s.bz-s.az)||1;return {tx:(s.bx-s.ax)/L,tz:(s.bz-s.az)/L,grade:Math.abs(s.bh-s.ah)/L};};
  const walkGrade=footpathGrade(pieces,I.options,(change,ids)=>I.patch(9,change,ids),1/12,follow);
  gate(9,'footways',{...walkGrade.counts,...footways.gate.counts,sidewalksMapped:report.sidewalksMapped,crossings:report.crossings,vergeOverlap:report.vergeOverlap,vergeSlivers:report.vergeSlivers},{...walkGrade.worst,...footways.gate.worst,footpathAreaM2:report.footpathArea,natureStripAreaM2:report.vergeArea},[...walkGrade.flagged,...footways.gate.flagged],[...walkGrade.errors,...footwayPolicyErrors,...footways.gate.errors,...(report.vergeOverlap?[`${report.vergeOverlap} footway/nature strip overlaps`]:[]),...(report.vergeSlivers?[`${report.vergeSlivers} verge slivers`]:[])]);
  I.markings?.({I,pieces,runs,regionS,regionJ,levels,ends,ri,nearRoads,H});
  drapePaint(pieces);
  I.snapshot?.(9);
  const roadFacets=new FacetIndex(facetsOf(pieces.filter(p=>p.kind==='carriageway')));
  const finalHeight=(level:number,x:number,z:number)=>{
    const target=H(level,x,z),candidates=roadFacets.at(x,z).map(f=>f.height(x,z));
    candidates.sort((a,b)=>Math.abs(a-target)-Math.abs(b-target));
    return candidates[0]??target;
  };
  const piers=runStage10Piers(runs,regionS,I.waters??[],G,I.roadInfo,pieces,report,I.options,(change,ids)=>I.patch(10,change,ids),finalHeight,(level,x,z)=>roadFacets.at(x,z).some(f=>f.piece.t==='area'&&f.piece.level===level&&f.piece.overhead));gates.push(piers.gate);I.gate(piers.gate);I.snapshot?.(10);
  const earth=runStage11Earthworks(runs,G,I.roadInfo,pieces,clamp,report,I.terrain,I.options,(change,ids)=>I.patch(11,change,ids));gates.push(earth.gate);I.gate(earth.gate);

  report.area = levels.map((l) => +S.get(l)!.reduce((s, p) => s + areaD(p), 0).toFixed(0));
  tick('z-fighting');
  return { walk: walkLines, verge: { S0: S.get(0) ?? [], F, N, R: Rz }, gates };
}

/** a point along a run (binary search on its distances): where, and its direction */
export function alongRun(r: Run, d: number): { x: number; z: number; tx: number; tz: number } {
  const A = r.acc, n = A.length; let lo = 1, hi = n - 1; const dd = Math.max(0, Math.min(A[n - 1]!, d));
  while (lo < hi) { const m = (lo + hi) >> 1; if (A[m]! < dd) lo = m + 1; else hi = m; }
  const a = r.pts[lo - 1]!, b = r.pts[lo]!, l = A[lo]! - A[lo - 1]! || 1, f = (dd - A[lo - 1]!) / l, tx = (b[0] - a[0]) / l, tz = (b[1] - a[1]) / l;
  return { x: a[0] + (b[0] - a[0]) * f, z: a[1] + (b[1] - a[1]) * f, tx, tz };
}
/** the part of a run's line from d0 to d1 (along it) */
function subLine(r: Run, d0: number, d1: number): P2[] {
  if (d1 - d0 < 0.05) return [];
  const a = alongRun(r, d0), b = alongRun(r, d1), out: P2[] = [[a.x, a.z]];
  for (let i = 1; i < r.pts.length - 1; i++) if (r.acc[i]! > d0 + 0.01 && r.acc[i]! < d1 - 0.01) out.push(r.pts[i]!);
  out.push([b.x, b.z]); return out;
}
/** the nearest point of a run to a place: how far along, how far off */
export function project(r: Run, x: number, z: number): { d: number; dist: number } {
  let best = { d: 0, dist: Infinity };
  for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1]!, b = r.pts[i]!, s = segDist(x, z, a[0], a[1], b[0], b[1]); if (s.d < best.dist) best = { d: r.acc[i - 1]! + (r.acc[i]! - r.acc[i - 1]!) * s.t, dist: s.d }; }
  return best;
}
const smooth = (t: number) => { const u = Math.max(0, Math.min(1, t)); return u * u * (3 - 2 * u); };
const norm2 = (v: P2): P2 => { const l = Math.hypot(v[0], v[1]) || 1; return [v[0] / l, v[1] / l]; };
/** a line without points closer than `gap` to the last one kept (its ends kept) */
function thin(line: P2[], gap: number): P2[] {
  const out: P2[] = [line[0]!];
  for (let i = 1; i < line.length - 1; i++) { const p = line[i]!, q = out[out.length - 1]!; if (Math.hypot(p[0] - q[0], p[1] - q[1]) >= gap) out.push(p); }
  const e = line[line.length - 1]!, q = out[out.length - 1]!; if (out.length > 1 && Math.hypot(e[0] - q[0], e[1] - q[1]) < gap) out.pop(); out.push(e);
  return out;
}
/** a line with points added where a kerb ramp starts and ends (1 m either side of each ramp on it) */
function withRamps(line: P2[], grid: Grid<P2> | null): P2[] {
  if (!grid) return line;
  const out: P2[] = [line[0]!];
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]!, b = line[i]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ts: number[] = [];
    for (const r of grid.near((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, l / 2 + 1)) { const s = segDist(r[0], r[1], a[0], a[1], b[0], b[1]); if (s.d < 0.5) for (const dt of [-1, -0.8, 0.8, 1]) { const t = s.t + dt / l; if (t > 0.01 && t < 0.99) ts.push(t); } }
    ts.sort((x, y) => x - y); for (const t of ts) out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t]);
    out.push(b);
  }
  return out;
}
/** a line with the points it does not need left out (Douglas–Peucker: none moves it more than `eps`) */
function rdp(line: P2[], eps: number): P2[] {
  if (line.length < 3) return line;
  const keep = new Uint8Array(line.length); keep[0] = 1; keep[line.length - 1] = 1;
  const stack: [number, number][] = [[0, line.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!; let best = -1, bd = eps;
    for (let k = i + 1; k < j; k++) { const d = segDist(line[k]![0], line[k]![1], line[i]![0], line[i]![1], line[j]![0], line[j]![1]).d; if (d > bd) { bd = d; best = k; } }
    if (best > 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
  }
  return line.filter((_, k) => keep[k]);
}
function densify(line: P2[], step: number): P2[] {
  const out: P2[] = [line[0]!];
  for (let i = 1; i < line.length; i++) { const a = line[i - 1]!, b = line[i]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(l / step)); for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); }
  return out;
}
/** a plane z = h0 + gx·x + gz·z through points (least squares), its slope at most 12 % */
function fitPlane(pts: P3[]): ((x: number, z: number) => number) | null {
  const n = pts.length; if (n < 3) return null;
  let mx = 0, mz = 0, mh = 0; for (const p of pts) { mx += p[0]; mz += p[1]; mh += p[2]; } mx /= n; mz /= n; mh /= n;
  let A = 0, B = 0, C = 0, P = 0, Q = 0; for (const p of pts) { const x = p[0] - mx, z = p[1] - mz, h = p[2] - mh; A += x * x; B += x * z; C += z * z; P += x * h; Q += z * h; }
  const det = A * C - B * B; let gx = Math.abs(det) > 1e-6 ? (P * C - Q * B) / det : 0, gz = Math.abs(det) > 1e-6 ? (Q * A - P * B) / det : 0;
  const gm = Math.hypot(gx, gz); if (gm > 0.12) { gx *= 0.12 / gm; gz *= 0.12 / gm; }
  return (x, z) => mh + gx * (x - mx) + gz * (z - mz);
}
/** do two segments cross (properly, not at their ends)? */
function crosses(a: P2, b: P2, c: P2, d: P2): boolean {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1], den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) return false;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  return t > 0.001 && t < 0.999 && u > 0.001 && u < 0.999;
}
/** proper crossings between the edges of a set of rings (0 for a valid set of simple polygons) */
function crossingsIn(paths: PathsD): number {
  const g = new Grid<{ a: P2; b: P2; r: number; i: number; n: number }>(20); let k = 0;
  paths.forEach((p, r) => p.forEach((q, i) => { const s = p[(i + 1) % p.length]!; g.add(Math.min(q.x, s.x), Math.min(q.y, s.y), Math.max(q.x, s.x), Math.max(q.y, s.y), { a: [q.x, q.y], b: [s.x, s.y], r, i, n: p.length }); }));
  const seen = new Set<string>();
  paths.forEach((p, r) => p.forEach((q, i) => {
    const s = p[(i + 1) % p.length]!, a: P2 = [q.x, q.y], b: P2 = [s.x, s.y];
    for (const e of g.near((q.x + s.x) / 2, (q.y + s.y) / 2, Math.hypot(s.x - q.x, s.y - q.y) / 2 + 1)) {
      if (e.r === r && (Math.abs(e.i - i) <= 1 || Math.abs(e.i - i) === e.n - 1)) continue;
      const key = r < e.r || (r === e.r && i < e.i) ? `${r}:${i}|${e.r}:${e.i}` : `${e.r}:${e.i}|${r}:${i}`; if (seen.has(key)) continue; seen.add(key);
      if (crosses(a, b, e.a, e.b)) k++;
    }
  }));
  return k;
}

export interface MarkingContext { I:SurfaceInput;pieces:Piece[];runs:Run[];regionS:Map<number,Region>;regionJ:Map<number,Region>;levels:number[];ends:Map<string,{arms:{run:Run;end:0|1}[]}>;ri:Map<Run,number>;nearRoads:(level:number,x:number,z:number,reach:number)=>{run:Run}[];H:(level:number,x:number,z:number)=>number }
