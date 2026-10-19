// modules › world › earth › presets › built › buildings › compile: the bake's stages 12–15 for an Earth place, after
// the roads (stages 1–11), each ending in its gate:
//   12 plots      each house's plot behind the property line (the road reserve's edge): its span along the line,
//                 back to 3 m behind it; clipped out of the reserve and off other buildings, split with a neighbour's
//                 along their bisector. An outline labelled a house but too big for one (a block of units) is not a
//                 house: no plot, no front fence (house-size)
//   13 buildings  every footprint behind the reserve (footprint-clip under 15 % in it, else a setback of 3 m at most,
//                 else left out), off water, off each other (the smaller clipped by the larger, or left out), each on
//                 its own pad on the composed ground (core › geometry › landform › compose › foundation); a house's
//                 foundation shows at most 1 m on its street side (pad-front: set into the slope behind)
//   14 trees      no trunk on a carriageway, kerb, footpath, structure, water or building (living › plants › placement)
//   15 furniture  poles, lamps, benches, bins, bus stops, … by the same rules for their kind (built › furniture)
// The output is placement only, never a look: per building its footprint, pad, front and plot, seed and source
// attributes; per tree its place, height, crown and seed; per piece of furniture its kind, place and seed. Looks are
// chosen when drawn (shape() → entities(), or the street level's presets), so they can change without a re-bake.
// Every patch is recorded on the stage's gate (by check, policy and algorithm, with every source id) and on the piece.
import type { PathsD } from 'clipper2-ts';
import { EndType, inflatePathsD, JoinType } from 'clipper2-ts';
import type { ClampOut, Ground, Piece } from '../../../../../../core/geometry/networks/bake-types.ts';
import { groundAt } from '../../../../../../core/geometry/landform/compose/ground.ts';
import { clampIndex } from '../../../../../../core/geometry/networks/clamp-index.ts';
import { clipBy, Exclusion, layersOfPieces, overlapWith, ringArea } from '../../../../../../core/geometry/landform/compose/exclusion.ts';
import { gradePads, wallSamples, type Pad } from '../../../../../../core/geometry/landform/compose/foundation.ts';
import { centroidOf, clipPlot, fitBehind, FrontLines, frontagePlot, splitPlots, type Inside, type P2 } from '../../../../../../core/geometry/zones/rules/frontage.ts';
import { closeGate, StagePatches } from '../../../../../../core/runtime/workers/compile/gates.ts';
import type { PatchOptions, StageGate } from '../../../../../../core/runtime/workers/compile/patch-policy.ts';
import { isHouse } from './index.ts';
import { orientedBox } from '../../../shared/plan.ts';
import { FRONTAGE, type FrontageRules } from './frontage.ts';
import type { FeaturePatch, OmittedPiece } from '../../../shared/placement.ts';
export type { FeaturePatch, OmittedPiece } from '../../../shared/placement.ts';
import type { BuiltInputs, SourceBuilding } from './inputs.ts';
import { placeTrees, type PlacedTree } from '../../living/plants/placement.ts';
import { placeFurniture, type PlacedFurniture } from '../furniture/placement.ts';

export interface PlacedBuilding extends SourceBuilding {
  house: boolean; pad: Pad | null; patches: FeaturePatch[];
  /** a house's plot: its outline, the point of its front line and the way along it, the frontage's span along it */
  plot: { ring: P2[]; front: { p: P2; t: P2 }; span: [number, number] | null } | null;
}
export interface BuiltPlacement { buildings: PlacedBuilding[]; trees: PlacedTree[]; furniture: PlacedFurniture[]; omitted: OmittedPiece[] }
export interface BuiltBake extends BuiltPlacement {
  gates: StageGate[];
  /** what each stage leaves (12: the plots with everything still as it came; 13: the buildings placed; 14: the trees) */
  snapshots: { stage: number; placement: BuiltPlacement }[];
  /** the composed ground before the pads were graded (stage 11's) */
  terrain11: Ground | null;
}
export interface BuiltOptions extends PatchOptions { place?: string; snapshots?: boolean;
  /** the reserve may hold this share of a footprint for a clip (default 0.15); a setback moves it this far at most (3 m) */
  clipShare?: number; setback?: number;
  /** how far a tree or a piece of furniture may be nudged (m, default 2) */
  nudge?: number;
  /** the plots' rules (default FRONTAGE) */
  frontage?: FrontageRules }

/** the layer of each baked road piece (null: no obstacle): what may not be built on */
export function builtLayerOf(p: Piece): string | null {
  switch (p.kind) {
    case 'carriageway': return 'road';
    case 'kerb': case 'ramp': return 'kerb';
    case 'footpath': return 'footpath';
    case 'verge': return 'verge';
    case 'water': return 'water';
    case 'deck': case 'deck-under': case 'viaduct': case 'parapet': case 'retaining': case 'abutment': case 'portal': case 'pier': return 'structure';
    default: return null;
  }
}
/** what a building may not stand on (the reserve and everything baked in it) */
export const RESERVE = ['reserve', 'road', 'kerb', 'footpath', 'verge', 'structure'] as const;
/** the ground a pad may not grade (the reserve's, paths' and water's cells) */
const KEEP = [...RESERVE, 'path', 'water'];
const path = (r: readonly P2[]) => r.map((p) => ({ x: p[0], y: p[1] }));
const inside2 = (q: P2, r: readonly P2[]) => { let k = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i]!, b = r[j]!; if ((a[1] > q[1]) !== (b[1] > q[1]) && q[0] < ((b[0] - a[0]) * (q[1] - a[1])) / (b[1] - a[1]) + a[0]) k = !k; } return k; };
const middleOf = (p: Piece): P2 => { const pts = p.t === 'strip' ? p.edges.flat() : p.t === 'poly' ? p.ring : p.t === 'area' ? p.rings[0]! : p.t === 'wall' ? p.line : p.t === 'edge' ? p.pts : [p.at]; let x = 0, z = 0; for (const q of pts) { x += q[0]; z += q[1]; } return [x / (pts.length || 1), z / (pts.length || 1)]; };

/** stages 12–15 for an Earth place: `pieces`, `reserve` and `clamp` are the roads' bake (its final pieces, the
 *  reserve's outline, the ground contracts and composed terrain, graded here under the pads); `stages` its gates
 *  (these four are added) */
export function bakeBuilt(o: { pieces: readonly Piece[]; reserve: PathsD; clamp: ClampOut; inputs: BuiltInputs; stages: StageGate[]; options?: BuiltOptions }): BuiltBake {
  const options = o.options ?? {}, F = options.frontage ?? FRONTAGE, place = options.place, inp = o.inputs, nudgeM = options.nudge ?? 2;
  const t0 = performance.now(), tick = (what: string) => { if (process?.env?.BAKE_VERBOSE) console.log(`  ${what} ${((performance.now() - t0) / 1000).toFixed(1)} s`); };
  // the layers: the roads' pieces, the reserve, water (the bake's, the tiles' lakes, their streams by their width)
  const inR = new Exclusion({ reserve: o.reserve });
  const layers = layersOfPieces(o.pieces, (p) => { const l = builtLayerOf(p); if (l !== 'footpath' && l !== 'verge') return l; const [x, z] = middleOf(p); return inR.has('reserve', x, z) ? l : l === 'footpath' ? 'path' : 'infill'; });
  layers.reserve = [...o.reserve];
  layers.water = [...(layers.water ?? []), ...inp.water.filter((w) => w.ring.length >= 3).map((w) => path(w.ring)), ...inp.streams.filter((s) => s.pts.length >= 2).flatMap((s) => inflatePathsD([path(s.pts)], Math.max(0.5, s.width / 2), JoinType.Round, EndType.Round, 2, 2, 0.1))];
  const ex = new Exclusion(layers);
  tick('layers');
  const inside = (names: readonly string[]): Inside => ({ overlap: (r) => ex.overlap(r, names), clip: (r) => ex.clip(r, names) });
  const reserve = inside(RESERVE);
  const snapshots: BuiltBake['snapshots'] = [], omitted: OmittedPiece[] = [];
  const src = (k: string) => { const s = inp.sources[k] as { title?: string } | undefined; return s?.title ?? k; };

  // ── stage 12: plots ───────────────────────────────────────────────────────────────────────────────────────────────
  const p12 = new StagePatches(options), errors12: string[] = [];
  const lines = new FrontLines(o.reserve.flatMap((r) => r.map((a, i) => { const b = r[(i + 1) % r.length]!; return [[a.x, a.y], [b.x, b.y]] as [P2, P2]; })));
  const buildings: PlacedBuilding[] = inp.buildings.map((b) => ({ ...b, ring: b.ring.map((p) => [p[0], p[1]] as P2), house: isHouse(b.cls, ringArea(b.ring), b.height), pad: null, plot: null, patches: [] }));
  const sourceGrid = new Map<string, number[]>(), CELL = 40;
  const boxOf = (r: readonly P2[]) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of r) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } return [x0, z0, x1, z1] as const; };
  const gridAdd = (g: Map<string, number[]>, r: readonly P2[], i: number) => { const [x0, z0, x1, z1] = boxOf(r); for (let a = Math.floor(x0 / CELL); a <= Math.floor(x1 / CELL); a++) for (let b = Math.floor(z0 / CELL); b <= Math.floor(z1 / CELL); b++) { const k = `${a},${b}`; let l = g.get(k); if (!l) g.set(k, (l = [])); l.push(i); } };
  const gridNear = (g: Map<string, number[]>, r: readonly P2[]) => { const [x0, z0, x1, z1] = boxOf(r), out = new Set<number>(); for (let a = Math.floor(x0 / CELL); a <= Math.floor(x1 / CELL); a++) for (let b = Math.floor(z0 / CELL); b <= Math.floor(z1 / CELL); b++) for (const i of g.get(`${a},${b}`) ?? []) out.add(i); return out; };
  buildings.forEach((b, i) => gridAdd(sourceGrid, b.ring, i));
  // a house that is too big for one: a block of units or several houses under one outline (a 40 m front of fence or
  // one box along the street, else): not a house (repair: drawn as a building on its own outline; omit: its plot left
  // out too; stop)
  let housesTooBig = 0, housesTooBigLeft = 0, worstHouseM2 = 0, worstHouseSide = 0;
  for (const b of buildings) {
    if (!b.house) continue;
    const a = ringArea(b.ring), box = orientedBox(b.ring), side = 2 * Math.max(box.a, box.b);
    if (a <= F.house.maxArea && side <= F.house.maxSide) continue;
    housesTooBig++; worstHouseM2 = Math.max(worstHouseM2, a); worstHouseSide = Math.max(worstHouseSide, side);
    const pol = p12.policy('house-size', 'repair', [b.id]);
    if (pol === 'stop') { housesTooBigLeft++; errors12.push(`house ${b.id} too big for one (${a.toFixed(0)} m², ${side.toFixed(1)} m)`); continue; }
    b.house = false;
    if (pol === 'omit') { const [cx, cz] = centroidOf(b.ring); p12.add('house-size', 'omit', 'omit', b.id); omitted.push({ kind: 'plot', id: b.id, at: [cx, cz], check: 'house-size', source: src('buildings') }); b.patches.push({ check: 'house-size', policy: 'omit', algorithm: 'omit' }); }
    else { p12.add('house-size', 'repair', 'not-a-house', b.id, { areaM2: a, sideM: side }); b.patches.push({ check: 'house-size', policy: 'repair', algorithm: 'not-a-house', amount: a, unit: 'm²' }); }
  }
  // the outlines near one (`crossing`: only those crossing its edge; one wholly inside a plot is its own outbuilding)
  const others = (self: number, rings: (i: number) => P2[] | null, grid: Map<string, number[]>, crossing = false): Inside => {
    const near = (r: readonly P2[]) => [...gridNear(grid, r)].filter((i) => i !== self).map(rings).filter((x): x is P2[] => !!x && x.length >= 3 && !(crossing && x.every((q) => inside2(q, r))));
    return { overlap: (r) => overlapWith(r, near(r)), clip: (r) => clipBy(r, near(r)) };
  };
  // the plots are made, not measured: each house's frontage rectangle less the reserve and the other buildings, then
  // split with each neighbour along the bisector of their buildings (frontage-subdivision); the gate then measures
  // what was made, and a check that still fails runs its policy
  let houses = 0, withoutFrontage = 0, plotsUnresolved = 0, plotsClipped = 0;
  buildings.forEach((b, i) => {
    if (!b.house) return; houses++;
    const [cx, cz] = centroidOf(b.ring), front = lines.front(cx, cz, F.reach);
    if (!front) {
      withoutFrontage++;
      const pol = p12.policy('frontage', 'omit', [b.id]);
      if (pol === 'stop') { plotsUnresolved++; errors12.push(`no property line within ${F.reach} m of house ${b.id}`); return; }
      p12.add('frontage', 'omit', 'no-property-line', b.id); omitted.push({ kind: 'plot', id: b.id, at: [cx, cz], check: 'frontage', source: src('buildings') });
      b.patches.push({ check: 'frontage', policy: 'omit', algorithm: 'no-property-line' });
      return;
    }
    const plot = frontagePlot(b.ring, front, { side: F.side, back: F.back }), area0 = ringArea(plot.ring);
    const ring = clipPlot(plot.ring, reserve);
    if (ring && ringArea(ring) < area0 - 0.5) plotsClipped++;
    b.plot = ring ? { ring, front: plot.front, span: plot.span } : null;
  });
  let withPlots = buildings.filter((b) => b.plot); const list = withPlots.map((b) => ({ ring: b.plot!.ring, middle: centroidOf(b.ring) }));
  const split = splitPlots(list);
  withPlots.forEach((b, k) => { b.plot!.ring = list[k]!.ring; });
  // then off the buildings crossing a plot's edge (one wholly inside is the plot's own outbuilding)
  for (const b of withPlots) { const r = clipPlot(b.plot!.ring, others(buildings.indexOf(b), (q) => buildings[q]!.ring, sourceGrid, true)); if (r) b.plot!.ring = r; else b.plot = null; }
  withPlots = withPlots.filter((b) => b.plot);
  // the gate's measures: in the reserve, over another building, overlapping a neighbour (after the subdivision)
  let plotsInReserve = 0, plotsOverBuildings = 0, plotOverlaps = 0, worstReserve = 0, worstOver = 0;
  const plotGrid = new Map<string, number[]>(); withPlots.forEach((b, k) => gridAdd(plotGrid, b.plot!.ring, k));
  withPlots.forEach((b, k) => {
    const i = buildings.indexOf(b), [cx, cz] = centroidOf(b.ring);
    const fix = (check: string, value: number, redo: (r: P2[]) => P2[] | null) => {
      const pol = p12.policy(check, 'repair', [b.id]);
      if (pol === 'repair') { const r = b.plot ? redo(b.plot.ring) : null; p12.add(check, 'repair', 'plot-clip', b.id, { clippedM2: value }); b.patches.push({ check, policy: 'repair', algorithm: 'plot-clip', amount: value, unit: 'm²' }); if (b.plot) { if (r) b.plot.ring = r; else b.plot = null; } }
      else if (pol === 'omit') { p12.add(check, 'omit', 'omit', b.id); omitted.push({ kind: 'plot', id: b.id, at: [cx, cz], check, source: src('buildings') }); b.plot = null; }
      return pol === 'stop';
    };
    const inRes = b.plot ? reserve.overlap(b.plot.ring) : 0;
    if (inRes > 0.5) { worstReserve = Math.max(worstReserve, inRes); if (fix('plot-reserve', inRes, (r) => clipPlot(r, reserve))) { plotsInReserve++; errors12.push(`plot of ${b.id} in the reserve (${inRes.toFixed(1)} m²)`); } }
    const near = others(i, (q) => buildings[q]!.ring, sourceGrid, true), over = b.plot ? near.overlap(b.plot.ring) : 0;
    if (over > 0.5) { worstOver = Math.max(worstOver, over); if (fix('plot-building', over, (r) => clipPlot(r, near))) { plotsOverBuildings++; errors12.push(`plot of ${b.id} over another building (${over.toFixed(1)} m²)`); } }
    const nb = others(k, (q) => withPlots[q]!.plot?.ring ?? null, plotGrid), shared = b.plot ? nb.overlap(b.plot.ring) : 0;
    if (shared > 0.5) { if (fix('plot-overlap', shared, (r) => clipPlot(r, nb))) { plotOverlaps++; errors12.push(`plot of ${b.id} overlaps a neighbour's (${shared.toFixed(1)} m²)`); } }
  });
  // the frontage: the plot's span along its front line (where its edge lies on the line)
  for (const b of withPlots) { if (!b.plot) continue; const { p, t } = b.plot!.front, n: P2 = [-t[1], t[0]]; let s0 = Infinity, s1 = -Infinity; for (const q of b.plot!.ring) { const d = (q[0] - p[0]) * n[0] + (q[1] - p[1]) * n[1]; if (Math.abs(d) > 0.3) continue; const s = (q[0] - p[0]) * t[0] + (q[1] - p[1]) * t[1]; s0 = Math.min(s0, s); s1 = Math.max(s1, s); } b.plot!.span = s1 - s0 > 1 ? [s0, s1] : null; }
  const g12 = closeGate(o.stages, { stage: 12, id: 'plots-frontage', name: 'Plots behind the reserve and their frontage', counts: { buildings: buildings.length, houses, housesTooBig, housesTooBigLeft, plots: buildings.filter((b) => b.plot).length, withFrontage: buildings.filter((b) => b.plot?.span).length, housesWithoutFrontage: withoutFrontage, plotsClipped, plotsSplit: split.pairs, plotsInReserve, plotsOverBuildings, plotOverlaps, plotsUnresolved, propertyLineSegments: o.reserve.reduce((a, r) => a + r.length, 0) }, worst: { houseTooBigM2: +worstHouseM2.toFixed(1), houseTooBigSideM: +worstHouseSide.toFixed(1), plotInReserveM2: +worstReserve.toFixed(2), plotOverBuildingM2: +worstOver.toFixed(2), splitSharedM2: +split.worstM2.toFixed(2) }, flagged: [], errors: errors12 }, p12.list(), options, place);
  tick('stage 12');
  const copyB = (list: PlacedBuilding[]) => list.map((b) => ({ ...b, ring: b.ring.map((p) => [p[0], p[1]] as P2), patches: [...b.patches], plot: b.plot ? { ...b.plot, ring: [...b.plot.ring] } : null }));
  if (options.snapshots) snapshots.push({ stage: 12, placement: { buildings: copyB(buildings), trees: inp.trees.map((t) => ({ ...t, patches: [] })), furniture: placeFurniture(inp.furniture, null, null, new StagePatches(options), [], nudgeM, true).furniture, omitted: [...omitted] } });

  // ── stage 13: buildings ───────────────────────────────────────────────────────────────────────────────────────────
  const p13 = new StagePatches(options), errors13: string[] = [];
  const order = buildings.map((_, i) => i).sort((a, b) => ringArea(buildings[b]!.ring) - ringArea(buildings[a]!.ring) || (buildings[a]!.id < buildings[b]!.id ? -1 : 1));
  const placedGrid = new Map<string, number[]>(), placed = new Set<number>();
  const placedOthers = (self: number) => others(self, (k) => (placed.has(k) ? buildings[k]!.ring : null), placedGrid);
  let inReserveLeft = 0, onPathLeft = 0, pathClipped = 0, onWaterLeft = 0, overlapsLeft = 0, clipped = 0, setback = 0, maxSetback = 0, maxClipM2 = 0, waterClipped = 0, overlapClipped = 0, maxOverlapM2 = 0;
  const drop = (b: PlacedBuilding, check: string, algorithm: string) => { const [cx, cz] = centroidOf(b.ring); p13.add(check, 'omit', algorithm, b.id); omitted.push({ kind: 'building', id: b.id, at: [cx, cz], check, source: src('buildings') }); };
  const gone = new Set<number>();
  for (const i of order) {
    const b = buildings[i]!, area0 = ringArea(b.ring), mine = placedOthers(i);
    // behind the reserve
    const before = mine.overlap(b.ring), fit = fitBehind(b.ring, reserve, { clipShare: options.clipShare ?? 0.15, setback: options.setback ?? 3, clear: (r) => mine.overlap(r) <= before + 0.5 && ex.overlap(r, ['path', 'water']) <= 0.5 });
    if (fit.how !== 'clear') {
      const pol = p13.policy('building-reserve', 'repair', [b.id]);
      if (pol === 'stop') { inReserveLeft++; errors13.push(`building ${b.id} in the road reserve (${(fit.share * 100).toFixed(0)} %)`); }
      else if (pol === 'omit' || fit.how === 'omit') { drop(b, 'building-reserve', pol === 'omit' ? 'omit' : 'footprint-clip / setback'); gone.add(i); continue; }
      else if (fit.how === 'footprint-clip') { clipped++; maxClipM2 = Math.max(maxClipM2, fit.clippedM2); b.ring = fit.ring; p13.add('building-reserve', 'repair', 'footprint-clip', b.id, { clippedM2: fit.clippedM2, shareInReserve: fit.share }); b.patches.push({ check: 'building-reserve', policy: 'repair', algorithm: 'footprint-clip', amount: fit.clippedM2, unit: 'm²' }); }
      else { setback++; maxSetback = Math.max(maxSetback, fit.moved); b.ring = fit.ring; p13.add('building-reserve', 'repair', 'setback', b.id, { setbackM: fit.moved, shareInReserve: fit.share }, { setbackM: fit.moved }); b.patches.push({ check: 'building-reserve', policy: 'repair', algorithm: 'setback', amount: fit.moved, unit: 'm' }); }
    }
    // off the paths mapped outside the reserve (a building open at the ground may stand over one)
    const onPath = F.covered.has(b.cls) ? 0 : ex.overlap(b.ring, ['path']);
    if (onPath > 0.5) {
      const pol = p13.policy('building-path', 'repair', [b.id]), share = onPath / (ringArea(b.ring) || 1), [kept] = ex.clip(b.ring, ['path']);
      if (pol === 'stop') { onPathLeft++; errors13.push(`building ${b.id} on a path (${onPath.toFixed(1)} m²)`); }
      else if (pol === 'repair' && share < (options.clipShare ?? 0.15) && kept && kept.length >= 3) { pathClipped++; b.ring = kept; p13.add('building-path', 'repair', 'footprint-clip', b.id, { clippedM2: onPath }); b.patches.push({ check: 'building-path', policy: 'repair', algorithm: 'footprint-clip', amount: onPath, unit: 'm²' }); }
      else { drop(b, 'building-path', pol === 'omit' ? 'omit' : 'footprint-clip'); gone.add(i); continue; }
    }
    // off water
    const wet = ex.overlap(b.ring, ['water']);
    if (wet > 0.5) {
      const pol = p13.policy('building-water', 'repair', [b.id]), share = wet / (ringArea(b.ring) || 1), [kept] = ex.clip(b.ring, ['water']);
      if (pol === 'stop') { onWaterLeft++; errors13.push(`building ${b.id} on water (${wet.toFixed(1)} m²)`); }
      else if (pol === 'repair' && share < (options.clipShare ?? 0.15) && kept && kept.length >= 3) { waterClipped++; b.ring = kept; p13.add('building-water', 'repair', 'footprint-clip', b.id, { clippedM2: wet }); b.patches.push({ check: 'building-water', policy: 'repair', algorithm: 'footprint-clip', amount: wet, unit: 'm²' }); }
      else { drop(b, 'building-water', 'footprint-clip'); gone.add(i); continue; }
    }
    // off the buildings already standing (larger first)
    const over = mine.overlap(b.ring);
    if (over > 0.5) {
      const pol = p13.policy('building-overlap', 'repair', [b.id]), [kept] = mine.clip(b.ring);
      maxOverlapM2 = Math.max(maxOverlapM2, over);
      if (pol === 'stop') { overlapsLeft++; errors13.push(`building ${b.id} overlaps another (${over.toFixed(1)} m²)`); }
      else if (pol === 'repair' && kept && kept.length >= 3 && ringArea(kept) >= area0 * 0.5) { overlapClipped++; b.ring = kept; p13.add('building-overlap', 'repair', 'overlap-clip', b.id, { clippedM2: over }); b.patches.push({ check: 'building-overlap', policy: 'repair', algorithm: 'overlap-clip', amount: over, unit: 'm²' }); }
      else { drop(b, 'building-overlap', 'overlap-clip'); gone.add(i); continue; }
    }
    placed.add(i); gridAdd(placedGrid, b.ring, i);
  }
  const kept = buildings.filter((_, i) => !gone.has(i));
  for (const b of buildings.filter((_, i) => gone.has(i))) if (b.plot) b.plot = null;
  tick('stage 13 fit');
  // the pads on the composed ground (the guard's contracts too, as the device composes them)
  const terrain = o.clamp.terrain ?? null, terrain11 = terrain ? { ...terrain, data: new Float32Array(terrain.data) } : null;
  const guard = clampIndex({ v: 3, origin: [0, 0], cells: o.clamp.cells.map((rs) => [rs.length, ...rs.map((r) => r.length), ...rs.flatMap((r) => r.flat())]), edges: o.clamp.edges.map((l) => l.flat()) });
  const ground = (x: number, z: number) => { const g = terrain ? groundAt(terrain, x, z) : 0, lim = guard.limit(x, z, 0.5, 14, 0); return lim === null ? g : Math.min(g, lim); };
  const keep = (x0: number, z0: number, x1: number, z1: number) => { for (let a = 0; a <= 4; a++) for (let c = 0; c <= 4; c++) if (ex.at(x0 + ((x1 - x0) * a) / 4, z0 + ((z1 - z0) * c) / 4, KEEP).length) return true; return false; };
  const raisePol = p13.policy('pad-buried', 'repair'), floatPol = p13.policy('pad-floating', 'stop'), frontPol = p13.policy('pad-front', 'repair');
  let pads: Pad[] = [];
  // a house's street side: its walls facing the property line (where the foundation is seen from the street)
  if (terrain) pads = gradePads(kept.map((b) => ({ ring: b.ring, door: b.plot ? nearestWall(b.ring, b.plot.front.p) : null, front: b.plot ? streetWalls(b.ring, b.plot.front) : null })), terrain, ground, { raise: raisePol === 'repair', keep, ...(frontPol === 'repair' ? { frontWall: F.frontWall } : {}) });
  let buriedWalls = 0, floatingPads = 0, nonFinite = 0, raised = 0, maxRaise = 0, maxCut = 0, maxPlinth = 0, cutPads = 0, frontWalls = 0, frontWallsLowered = 0, frontWallsKept = 0, frontWallsLeft = 0, maxFront = 0, maxLowered = 0;
  const keptAt: NonNullable<StageGate['locations']> = [];
  kept.forEach((b, k) => {
    const pad = pads[k] ?? null; b.pad = pad; if (!pad) return;
    if (![pad.pad, pad.bottom, pad.anchorGround].every(Number.isFinite)) { nonFinite++; errors13.push(`pad of ${b.id} is not finite`); return; }
    if (pad.cutM > 0) { cutPads++; maxCut = Math.max(maxCut, pad.cutM); }
    maxPlinth = Math.max(maxPlinth, pad.plinthM);
    if (pad.buriedM > 0) {
      if (raisePol === 'repair') { raised++; maxRaise = Math.max(maxRaise, pad.raisedM); p13.add('pad-buried', 'repair', 'pad-raise', b.id, { raisedM: pad.raisedM }); b.patches.push({ check: 'pad-buried', policy: 'repair', algorithm: 'pad-raise', amount: pad.raisedM, unit: 'm' }); }
      else if (raisePol === 'omit') { drop(b, 'pad-buried', 'omit'); b.pad = null; }
      else { buriedWalls++; errors13.push(`walls of ${b.id} buried ${pad.buriedM.toFixed(2)} m`); }
    }
    if (pad.bottom > pad.low + 1e-6) { if (floatPol === 'stop') { floatingPads++; errors13.push(`foundation of ${b.id} above the ground`); } }
    // the street side: a foundation over `frontWall` there is a wall along the street (set into the slope instead)
    maxFront = Math.max(maxFront, pad.frontM);
    if (pad.loweredM > 0.01 && frontPol === 'repair') { frontWalls++; frontWallsLowered++; maxLowered = Math.max(maxLowered, pad.loweredM); p13.add('pad-front', 'repair', 'set-into-slope', b.id, { loweredM: pad.loweredM, frontM: pad.frontM }); b.patches.push({ check: 'pad-front', policy: 'repair', algorithm: 'set-into-slope', amount: pad.loweredM, unit: 'm' }); }
    // (still over it where the cut may not reach: ground kept for the reserve or a path, as on a street climbing past
    // the house, raises the floor back: counted, its worst on the gate)
    else if (pad.frontM > F.frontWall + 0.05) { frontWalls++; if (frontPol === 'repair') { frontWallsKept++; keptAt.push({ at: centroidOf(b.ring), ids: [b.id], value: +pad.frontM.toFixed(2), metric: 'frontWallM' }); } if (frontPol === 'stop') { frontWallsLeft++; errors13.push(`foundation of ${b.id} ${pad.frontM.toFixed(2)} m high on its street side`); } }
  });
  const standing = kept.filter((b) => b.pad || !terrain);
  for (const b of kept) if (terrain && !b.pad && b.plot) b.plot = null;
  const g13 = closeGate(o.stages, { stage: 13, id: 'buildings', name: 'Buildings behind the reserve, each on its own pad', counts: { buildings: standing.length, source: buildings.length, houses: standing.filter((b) => b.house).length, clipped, setback, waterClipped, overlapClipped, omitted: buildings.length - standing.length, buildingsInReserve: inReserveLeft, buildingsOnPaths: onPathLeft, pathClipped, buildingsOnWater: onWaterLeft, buildingOverlaps: overlapsLeft, pads: pads.length, padsCut: cutPads, padsRaised: raised, buriedWalls, floatingPads, frontWalls, frontWallsLowered, frontWallsKept, frontWallsLeft, nonFinite }, worst: { maxFrontWallM: +maxFront.toFixed(3), maxLoweredM: +maxLowered.toFixed(3), maxSetbackM: maxSetback, maxClipM2: +maxClipM2.toFixed(2), maxOverlapM2: +maxOverlapM2.toFixed(2), maxCutM: +maxCut.toFixed(3), maxRaiseM: +maxRaise.toFixed(3), maxPlinthM: +maxPlinth.toFixed(3) }, flagged: [], errors: errors13, locations: keptAt.sort((a, b) => b.value - a.value).slice(0, 20) }, p13.list(), options, place);
  tick('stage 13 pads');
  if (options.snapshots) snapshots.push({ stage: 13, placement: { buildings: copyB(standing), trees: inp.trees.map((t) => ({ ...t, patches: [] })), furniture: placeFurniture(inp.furniture, null, null, new StagePatches(options), [], nudgeM, true).furniture, omitted: [...omitted] } });

  // ── stage 14: trees · stage 15: furniture ─────────────────────────────────────────────────────────────────────────
  const bex = new Exclusion({ building: standing.map((b) => path(b.ring)) });
  const p14 = new StagePatches(options), trees = placeTrees(inp.trees, ex, bex, p14, omitted, nudgeM, src('trees'));
  const g14 = closeGate(o.stages, { stage: 14, id: 'trees', name: 'Trees off the roads, paths and buildings', counts: trees.counts, worst: trees.worst, flagged: [], errors: trees.errors }, p14.list(), options, place);
  tick('stage 14');
  if (options.snapshots) snapshots.push({ stage: 14, placement: { buildings: copyB(standing), trees: trees.trees, furniture: placeFurniture(inp.furniture, null, null, new StagePatches(options), [], nudgeM, true).furniture, omitted: [...omitted] } });
  const p15 = new StagePatches(options), furn = placeFurniture(inp.furniture, ex, bex, p15, omitted, nudgeM, false, 'OpenStreetMap');
  const g15 = closeGate(o.stages, { stage: 15, id: 'furniture', name: 'Street furniture and poles', counts: furn.counts, worst: furn.worst, flagged: [], errors: furn.errors }, p15.list(), options, place);
  tick('stage 15');
  return { buildings: standing, trees: trees.trees, furniture: furn.furniture, omitted, gates: [g12, g13, g14, g15], snapshots, terrain11 };
}
/** points along the walls of a footprint that face its property line (`front`: a point of the line and the way
 *  along it), half a metre apart */
function streetWalls(ring: readonly P2[], front: { p: P2; t: P2 }): P2[] {
  const [cx, cz] = centroidOf(ring), { p, t } = front;
  let nx = -t[1], nz = t[0]; if ((p[0] - cx) * nx + (p[1] - cz) * nz < 0) { nx = -nx; nz = -nz; }
  let s = 0; for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!; s += a[0] * b[1] - b[0] * a[1]; }
  const out: P2[] = [];
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!, b = ring[(i + 1) % ring.length]!, len = Math.hypot(b[0] - a[0], b[1] - a[1]); if (len < 0.5) continue;
    // the edge's outward normal (the ring's turn known) towards the street
    const ox = (s > 0 ? b[1] - a[1] : a[1] - b[1]) / len, oz = (s > 0 ? a[0] - b[0] : b[0] - a[0]) / len;
    if (ox * nx + oz * nz < 0.5) continue;
    const n = Math.ceil(len / 0.5); for (let k = 0; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}
/** the point of a footprint's walls nearest a point (its door, on the street side) */
function nearestWall(ring: readonly P2[], p: P2): P2 { let best: P2 = ring[0]!, d = Infinity; for (const q of wallSamples(ring, 0.5)) { const e = Math.hypot(q[0] - p[0], q[1] - p[1]); if (e < d) { d = e; best = q; } } return best; }
