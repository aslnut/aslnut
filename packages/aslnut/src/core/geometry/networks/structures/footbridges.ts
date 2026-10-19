// core › geometry › networks › structures › footbridges: elevated walkways and how people get onto them.
// A deck is lifted only where something under it needs clearance (a road, water); elsewhere it follows the
// ground between its ends. Its ends come down to the ground on a walkable profile, never by a vertical box:
//   1. a walkway beside a road deck (a mapped sidewalk of the bridge) is that deck's sidewalk: the road's height;
//   2. a mapped approach joined to the deck end (a footway, path, cycleway) is lifted on an accessible ramp profile
//      (AS 1428.1: at most 1:14, a level landing after every 9 m) until it meets the ground;
//   3. mapped steps joined to the deck end are built as steps from the deck down to their far end;
//   4. where nothing is mapped (or the mapped approach ends in the air), a switchback ramp within the same rule is
//      generated on road-free land as a named repair (recorded), else a straight flight of steps (flagged).
// Source plan coordinates never move; only heights are derived, and generated ramps are recorded patches.
import { patchPolicy, patch, type Patch } from '../../../runtime/workers/compile/patch-policy.ts';
import type { P2 } from '../graph.ts';
import type { BakePath, Piece, P3, SolveOptions } from '../bake-types.ts';
import { Grid, type Region, type WalkLine } from '../union.ts';
import { hRun, type RunForStructures } from './piers.ts';
import { distToPolylineXZ, type SolvedWater } from '../../landform/terraform/hydrology.ts';

export const RAMP_GRADE = 1 / 14, RAMP_LEG = 9, RAMP_LANDING = 1.5, STEP_RISE = 0.16, STEP_RUN = 0.3, FOOTBRIDGE_CLEARANCE = 5.5;
/** the height an accessible ramp loses over d horizontal metres: 9 m legs at 1:14 with 1.5 m level landings between */
export function rampDrop(d: number): number { const leg = RAMP_LEG + RAMP_LANDING, n = Math.floor(d / leg), r = d - n * leg; return (n * RAMP_LEG + Math.min(r, RAMP_LEG)) * RAMP_GRADE; }
type Near = { r: RunForStructures; x: number; z: number; tx: number; tz: number; s: number; d: number };
export interface FootbridgeOut {
  counts: Record<string, number>; worst: Record<string, number>; flagged: (string | number)[]; errors: string[];
  /** lengths lifted off the start and the end of mapped ground paths (they are built here, not at grade) */
  lifted: Map<BakePath, [number, number]>;
}
const lengthOf = (pts: readonly P2[]) => { let L = 0; for (let i = 1; i < pts.length; i++) L += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]); return L; };
/** a polyline resampled every `step` m (and at its vertices): [x, z, distance] */
const resample = (pts: readonly P2[], step = 1) => { const out: [number, number, number][] = [[pts[0]![0], pts[0]![1], 0]]; let acc = 0; for (let i = 1; i < pts.length; i++) { const a = pts[i - 1]!, b = pts[i]!, L = Math.hypot(b[0] - a[0], b[1] - a[1]), n = Math.max(1, Math.ceil(L / step)); for (let k = 1; k <= n; k++) out.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n, acc + L * k / n]); acc += L; } return out; };

export function footbridges(paths: readonly BakePath[], runs: readonly RunForStructures[], regions: ReadonlyMap<number, Region>, G: (x: number, z: number) => number,
  walkHeight: (x: number, z: number) => number, info: (kind: string, props: Record<string, unknown>) => number, pieces: Piece[], walk: WalkLine[],
  waters: readonly SolvedWater[] = [], opts: SolveOptions = {}, note: (change: Patch, ids?: number[]) => void = () => {}): FootbridgeOut {
  const counts = { elevatedPaths: 0, roadSidewalkDecks: 0, footbridgeEnds: 0, endsAtGrade: 0, mappedRampApproaches: 0, mappedStepApproaches: 0, generatedRamps: 0, generatedStairs: 0, footbridgeEndsUnconnected: 0, accessTowers: 0, clearanceFailures: 0, footbridgeRampGradeFailures: 0, walkGradeSamples: 0, rampFootprintSamples: 0 };
  let leastFootbridgeClearanceM = Infinity, maxWalkGrade = 0, maxRampLengthM = 0, maxGeneratedRiseM = 0;
  const flagged: (string | number)[] = [], errors: string[] = [], lifted = new Map<BakePath, [number, number]>();
  // the roads' centre lines, binned (one segment per entry)
  const grid = new Grid<{ r: RunForStructures; i: number }>(40);
  for (const r of runs) for (let i = 1; i < r.pts.length; i++) { const a = r.pts[i - 1]!, b = r.pts[i]!; grid.add(Math.min(a[0], b[0]) - 40, Math.min(a[1], b[1]) - 40, Math.max(a[0], b[0]) + 40, Math.max(a[1], b[1]) + 40, { r, i }); }
  const nearAll = (x: number, z: number): Near[] => { const best = new Map<RunForStructures, Near>(); for (const { r, i } of grid.near(x, z)) { const a = r.pts[i - 1]!, b = r.pts[i]!, dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz) || 1, f = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (L * L))), px = a[0] + f * dx, pz = a[1] + f * dz, d = Math.hypot(px - x, pz - z), o = best.get(r); if (!o || d < o.d) best.set(r, { r, x: px, z: pz, tx: dx / L, tz: dz / L, s: r.acc[i - 1]! + f * L, d }); } return [...best.values()]; };
  const onRoad = (x: number, z: number) => [...regions.values()].some((reg) => reg.has(x, z));
  const wet = (x: number, z: number) => waters.some((w) => distToPolylineXZ(x, z, w.pts).dist < w.halfWidth + 1);
  const free = (x: number, z: number) => !onRoad(x, z) && !wet(x, z);
  // path ends, by their (shared) points
  const key = (p: P2) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`, ends = new Map<string, BakePath[]>();
  for (const path of paths) if (path.pts.length > 1) for (const p of [path.pts[0]!, path.pts[path.pts.length - 1]!]) { const k = key(p); let l = ends.get(k); if (!l) ends.set(k, (l = [])); l.push(path); }

  /** a walking surface along a 3D line: its top, a fascia or a solid side wall to the ground, parapets */
  const emit = (line: P3[], width: number, id: number, sides: 'deck' | 'ramp' | 'flush', rails: 'both' | 'left' | 'right' = 'both') => {
    if (line.length < 2) return;
    const left: P3[] = [], right: P3[] = [];
    for (let i = 0; i < line.length; i++) { const a = line[Math.max(0, i - 1)]!, b = line[Math.min(line.length - 1, i + 1)]!, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, nx = -(b[1] - a[1]) / L, nz = (b[0] - a[0]) / L, p = line[i]!; left.push([p[0] - nx * width / 2, p[1] - nz * width / 2, p[2]]); right.push([p[0] + nx * width / 2, p[1] + nz * width / 2, p[2]]); }
    pieces.push({ t: 'strip', kind: 'footpath', edges: [left, right], info: id, overhead: true });
    if (sides === 'flush') return;
    if (sides === 'deck') pieces.push({ t: 'strip', kind: 'deck-under', edges: [left.map((p) => [p[0], p[1], p[2] - 0.5] as P3), right.map((p) => [p[0], p[1], p[2] - 0.5] as P3)], info: id });
    for (const edge of [left, right]) {
      if (rails === 'both' || (rails === 'left') === (edge === left)) pieces.push({ t: 'wall', kind: 'parapet', line: edge.map((p) => [p[0], p[1], p[2] + 1.1, p[2]]), info: id });
      pieces.push({ t: 'wall', kind: sides === 'deck' ? 'deck-side' : 'ramp-wall', line: edge.map((p) => [p[0], p[1], p[2], sides === 'deck' ? p[2] - 0.5 : Math.min(p[2], G(p[0], p[1])) - 0.3]), info: id });
    }
  };
  const gradeOf = (line: readonly P3[]) => { let worst = 0; for (let i = 1; i < line.length; i++) { const a = line[i - 1]!, b = line[i]!, L = Math.hypot(b[0] - a[0], b[1] - a[1]); if (L < 0.05) continue; counts.walkGradeSamples++; worst = Math.max(worst, Math.abs(b[2] - a[2]) / L); } maxWalkGrade = Math.max(maxWalkGrade, worst); if (worst > RAMP_GRADE + 1e-3) { counts.footbridgeRampGradeFailures++; } return worst; };

  /** a generated switchback ramp (or, where none fits, a flight of steps) from S at height h0 down to the ground */
  const generate = (S: P2, h0: number, out: P2, width: number, id: number, sourceId: string): boolean => {
    const rise = h0 - walkHeight(S[0], S[1]); if (rise <= 0.05) return true;
    if (!Number.isFinite(rise) || rise > 40) { counts.footbridgeEndsUnconnected++; errors.push(`footbridge-approach ${sourceId}: a ${rise} m descent is no footbridge end`); return false; }
    const per = RAMP_LEG * RAMP_GRADE, legs = Math.ceil(rise / per - 1e-9), pitch = width + 0.3;
    const rot = (v: P2, s: number): P2 => [-v[1] * s, v[0] * s];
    const options: { u: P2; n: P2 }[] = [];
    for (const u of [out, rot(out, 1), rot(out, -1)]) for (const side of [1, -1]) { const n = rot(u, side); if (u !== out && n[0] * out[0] + n[1] * out[1] < -0.1) continue; options.push({ u, n }); }
    const fits = (u: P2, n: P2, a0: number, a1: number, b1: number) => { for (let a = a0; a <= a1 + 1e-6; a += 1) for (let b = -width / 2 - 0.3; b <= b1 + 1e-6; b += 1) { counts.rampFootprintSamples++; if (!free(S[0] + u[0] * a + n[0] * b, S[1] + u[1] * a + n[1] * b)) return false; } return true; };
    const policy = patchPolicy(opts, 'footbridge-approach', 'repair', [sourceId]);
    if (policy !== 'repair') { counts.footbridgeEndsUnconnected++; errors.push(`footbridge-approach ${sourceId}: no walkable approach; policy ${policy}`); return false; }
    for (const { u, n } of options) {
      if (!fits(u, n, legs > 2 ? -RAMP_LANDING : 0, RAMP_LEG + RAMP_LANDING, (legs - 1) * pitch + width / 2 + 0.3)) continue;
      let h = h0;
      for (let k = 0; k < legs; k++) {
        const drop = Math.min(per, h - walkHeight(S[0], S[1])), L = drop / RAMP_GRADE, o: P2 = [S[0] + n[0] * k * pitch, S[1] + n[1] * k * pitch];
        const from = k % 2 ? RAMP_LEG : 0, dir = k % 2 ? -1 : 1, steps = Math.max(1, Math.ceil(L));
        const line: P3[] = Array.from({ length: steps + 1 }, (_, j) => { const a = from + dir * L * j / steps; return [o[0] + u[0] * a, o[1] + u[1] * a, h - drop * j / steps] as P3; });
        emit(line, width, id, 'ramp'); gradeOf(line); walk.push({ pts: line.map((q) => [q[0], q[1]] as P2), kind: 'path' });
        h -= drop;
        if (k + 1 < legs) { // the level landing of the turn: across both legs, 1.5 m deep
          const a0 = k % 2 ? -RAMP_LANDING : RAMP_LEG, a1 = a0 + RAMP_LANDING, b0 = k * pitch - width / 2, b1 = (k + 1) * pitch + width / 2;
          const P = (a: number, b: number): P3 => [S[0] + u[0] * a + n[0] * b, S[1] + u[1] * a + n[1] * b, h];
          pieces.push({ t: 'strip', kind: 'footpath', overhead: true, info: id, edges: [[P(a0, b0), P(a0, b1)], [P(a1, b0), P(a1, b1)]] });
          const outer = k % 2 ? a0 : a1;
          pieces.push({ t: 'wall', kind: 'ramp-wall', info: id, line: [P(outer, b0), P(outer, b1)].map((q) => [q[0], q[1], q[2], Math.min(q[2], G(q[0], q[1])) - 0.3] as [number, number, number, number]) });
          pieces.push({ t: 'wall', kind: 'parapet', info: id, line: [P(outer, b0), P(outer, b1)].map((q) => [q[0], q[1], q[2] + 1.1, q[2]] as [number, number, number, number]) });
        }
      }
      counts.generatedRamps++; maxGeneratedRiseM = Math.max(maxGeneratedRiseM, rise);
      note(patch('footbridge-approach', 'repair', 'generate-switchback-ramp', [sourceId], { ramps: 1, legs }, { riseM: rise, gradeLimit: RAMP_GRADE }, { at: S, legLengthM: RAMP_LEG, landingM: RAMP_LANDING, sourcePlanMoved: false }), [id]);
      return true;
    }
    // no room for a ramp: a straight flight of steps (landings every 18 risers), the most compact walkable descent
    const risers = Math.ceil(rise / STEP_RISE), run = risers * STEP_RUN + Math.floor((risers - 1) / 18) * 1.2;
    let best = options[0]!; for (const o of options) if (fits(o.u, o.n, 0, run, width / 2 + 0.3)) { best = o; break; }
    const fitted = fits(best.u, best.n, 0, run, width / 2 + 0.3), rh = rise / risers;
    let a = 0, h = h0; const side: [number, number, number, number][][] = [[], []];
    for (let k = 0; k < risers; k++) {
      const a1 = a + STEP_RUN + ((k + 1) % 18 === 0 && k + 1 < risers ? 1.2 : 0), P = (aa: number, b: number, hh: number): P3 => [S[0] + best.u[0] * aa + best.n[0] * b, S[1] + best.u[1] * aa + best.n[1] * b, hh];
      h -= rh;
      pieces.push({ t: 'wall', kind: 'ramp-wall', info: id, line: [P(a, -width / 2, h), P(a, width / 2, h)].map((q) => [q[0], q[1], q[2] + rh, q[2]] as [number, number, number, number]) });
      pieces.push({ t: 'strip', kind: 'footpath', overhead: true, info: id, edges: [[P(a, -width / 2, h), P(a, width / 2, h)], [P(a1, -width / 2, h), P(a1, width / 2, h)]] });
      for (const [j, b] of [[0, -width / 2], [1, width / 2]] as const) for (const aa of [a, a1]) { const q = P(aa, b, h); side[j]!.push([q[0], q[1], q[2], Math.min(q[2], G(q[0], q[1])) - 0.3]); }
      a = a1;
    }
    for (const line of side) pieces.push({ t: 'wall', kind: 'ramp-wall', info: id, line });
    walk.push({ pts: [S, [S[0] + best.u[0] * a, S[1] + best.u[1] * a]], kind: 'path' });
    counts.generatedStairs++; maxGeneratedRiseM = Math.max(maxGeneratedRiseM, rise);
    if (!fitted) flagged.push(sourceId);
    note(patch('footbridge-approach', 'repair', 'generate-steps', [sourceId], { flights: 1, risers }, { riseM: rise }, { at: S, roadFree: fitted, sourcePlanMoved: false }), [id]);
    return true;
  };

  /** come down from a deck end at (p, h): mapped steps, a mapped approach lifted on the ramp profile, or generated */
  const descend = (path: BakePath, p: P2, h: number, out: P2, width: number, id: number) => {
    counts.footbridgeEnds++;
    if (h - walkHeight(p[0], p[1]) <= 0.3) { counts.endsAtGrade++; return; }
    const joined = (ends.get(key(p)) ?? []).filter((q) => q !== path && !q.elevated && !q.crossing);
    const steps = joined.find((q) => q.steps);
    if (steps) {
      const pts = key(steps.pts[0]!) === key(p) ? steps.pts : [...steps.pts].reverse(), samples = resample(pts, 0.3), L = samples[samples.length - 1]![2];
      const far = samples[samples.length - 1]!, g = walkHeight(far[0], far[1]), rise = h - g, risers = Math.max(1, Math.round(rise / STEP_RISE));
      if (L > 0.5 && rise / L < 1) {
        const line: P3[] = samples.map((q) => [q[0], q[1], h - rise * Math.min(1, Math.floor(q[2] / L * risers + 1e-6) / risers)] as P3);
        emit(line, width, id, 'ramp'); counts.mappedStepApproaches++;
        const prior = lifted.get(steps) ?? [0, 0]; lifted.set(steps, pts === steps.pts ? [L, prior[1]] : [prior[0], L]);
        return;
      }
    }
    // a mapped approach: follow joined ground paths (through simple joins) on the ramp profile until the ground
    let at = p, dir = out, d0 = 0, prev: BakePath = path; const seen = new Set<BakePath>([path]);
    for (let hop = 0; hop < 6; hop++) {
      const next = (ends.get(key(at)) ?? []).filter((q) => !seen.has(q) && !q.elevated && !q.steps && !q.crossing);
      if (next.length !== 1 && !(hop === 0 && next.length)) break;
      // at the deck end, prefer the joined path that leaves straightest
      const q = next.sort((a, b) => { const dirOf = (x: BakePath) => { const ps = key(x.pts[0]!) === key(at) ? x.pts : [...x.pts].reverse(), b1 = ps[1]!, L = Math.hypot(b1[0] - at[0], b1[1] - at[1]) || 1; return ((b1[0] - at[0]) * dir[0] + (b1[1] - at[1]) * dir[1]) / L; }; return dirOf(b) - dirOf(a); })[0]!;
      seen.add(q); prev = q;
      const forward = key(q.pts[0]!) === key(at), pts = forward ? q.pts : [...q.pts].reverse(), samples = resample(pts, 1), L = samples[samples.length - 1]![2];
      const line: P3[] = []; let touched = -1, blocked = false, done = 0;
      for (const s of samples) {
        const hh = h - rampDrop(d0 + s[2]), g = walkHeight(s[0], s[1]);
        if (s[2] > 0 && onRoad(s[0], s[1])) { blocked = true; break; }
        line.push([s[0], s[1], hh]); done = s[2];
        if (hh <= g + 0.02) { touched = s[2]; break; }
      }
      if (line.length > 1) { emit(line, Math.max(1.2, q.width ?? width), id, 'ramp'); gradeOf(line); maxRampLengthM = Math.max(maxRampLengthM, d0 + done); }
      const prior = lifted.get(q) ?? [0, 0]; lifted.set(q, forward ? [Math.max(prior[0], done), prior[1]] : [prior[0], Math.max(prior[1], done)]);
      if (touched >= 0) { counts.mappedRampApproaches++; maxRampLengthM = Math.max(maxRampLengthM, d0 + touched); return; }
      const last = line[line.length - 1] ?? [at[0], at[1], h];
      if (blocked || done < L - 1e-6) { // the approach runs onto a road while still up: generate the rest beside it
        const b = line[Math.max(0, line.length - 2)] ?? last, Lb = Math.hypot(last[0] - b[0], last[1] - b[1]) || 1;
        counts.mappedRampApproaches++;
        if (!generate([last[0], last[1]], last[2], [(last[0] - b[0]) / Lb, (last[1] - b[1]) / Lb], width, id, String(path.id))) return;
        return;
      }
      const tail = pts[pts.length - 1]!, b = pts[pts.length - 2]!, Lt = Math.hypot(tail[0] - b[0], tail[1] - b[1]) || 1;
      at = tail; dir = [(tail[0] - b[0]) / Lt, (tail[1] - b[1]) / Lt]; d0 += L;
    }
    // nothing (more) mapped: generate a switchback from where the walk now stands
    const hh = prev === path ? h : h - rampDrop(d0);
    if (prev !== path) counts.mappedRampApproaches++;
    generate(at, hh, dir, width, id, String(path.id));
  };

  for (const path of paths) {
    if (path.pts.length < 2 || !path.elevated || path.steps) continue;
    counts.elevatedPaths++;
    const width = Math.max(1.2, Math.min(6, path.width ?? 2)), id = info('footpath', { ...path.props }), samples = resample(path.pts, 2), n = samples.length;
    const dirAt = (i: number): P2 => { const a = samples[Math.max(0, i - 1)]!, b = samples[Math.min(n - 1, i + 1)]!, L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [(b[0] - a[0]) / L, (b[1] - a[1]) / L]; };
    // 1. a sidewalk of a road deck: beside, parallel to, a bridge run for most of its length
    const beside = samples.map((s, i) => { const t = dirAt(i); return nearAll(s[0], s[1]).filter((q) => q.d < q.r.half + width + 4 && Math.abs(q.tx * t[0] + q.tz * t[1]) > 0.85).sort((a, b) => a.d - b.d)[0] ?? null; });
    const besideBridge = beside.filter((q) => q && (q.r.bridge || q.r.level > 0)).length;
    if (besideBridge >= 0.6 * n) {
      counts.roadSidewalkDecks++;
      const line: P3[] = samples.map((s, i) => [s[0], s[1], beside[i] ? hRun(beside[i]!.r, beside[i]!.s) + 0.15 : walkHeight(s[0], s[1])] as P3);
      const mid = Math.floor(n / 2), road = beside[mid] ?? beside.find((q) => q)!, t = dirAt(mid), side = (road.x - samples[mid]![0]) * -t[1] + (road.z - samples[mid]![1]) * t[0];
      emit(line, width, id, 'deck', side > 0 ? 'left' : 'right');
      // an end still beside its road joins that road's footpath at the road's height; one past it comes down
      for (const k of [0, n - 1]) { if (beside[k]) { counts.footbridgeEnds++; counts.endsAtGrade++; continue; } descend(path, [samples[k]![0], samples[k]![1]], line[k]![2], k ? dirAt(k) : [-dirAt(0)[0], -dirAt(0)[1]], width, id); }
      // a sidewalk keeps the road's grade (it is the road's), so it is not a ramp: reported, not gated
      continue;
    }
    // 2. a footbridge: what must clear under it, then the ramp profile between those controls
    const g0 = G(samples[0]![0], samples[0]![1]), g1 = G(samples[n - 1]![0], samples[n - 1]![1]), L = samples[n - 1]![2] || 1;
    const need = samples.map((s) => {
      let y = Math.max(G(s[0], s[1]), g0 + (g1 - g0) * s[2] / L) + 0.3;
      for (const w of waters) if (distToPolylineXZ(s[0], s[1], w.pts).dist < w.halfWidth + w.bankWidth * 0.5) y = Math.max(y, w.waterY + 3);
      for (const q of nearAll(s[0], s[1])) if (q.d < q.r.outer + width / 2 + 2) y = Math.max(y, hRun(q.r, q.s) + FOOTBRIDGE_CLEARANCE + 1);
      return y;
    });
    const targets = samples.map((s) => { let y = -Infinity; for (let j = 0; j < n; j++) y = Math.max(y, need[j]! - rampDrop(Math.abs(s[2] - samples[j]![2]))); return y; });
    const raise = Math.max(...targets.map((h, i) => h - G(samples[i]![0], samples[i]![1])));
    if (raise > 0.5) {
      const policy = patchPolicy(opts, 'footbridge-clearance', 'repair', [path.id]);
      note(patch('footbridge-clearance', policy, 'propagate-height-envelope', [path.id ?? id], { samples: n }, { maxRaiseM: raise }, { verticalOnly: true, rampGrade: RAMP_GRADE, sourcePlanMoved: false }), [id]);
      if (policy === 'stop') errors.push(`Footbridge ${path.id ?? id} needs ${raise} m envelope raise`);
      if (policy === 'omit') continue;
    }
    const line: P3[] = samples.map((s, i) => [s[0], s[1], targets[i]!] as P3);
    emit(line, width, id, 'deck'); gradeOf(line);
    for (let i = 0; i < n; i++) for (const q of nearAll(samples[i]![0], samples[i]![1])) { const low = hRun(q.r, q.s); if (q.d < q.r.outer + width / 2 && low < targets[i]! - 3) { const clear = targets[i]! - 0.5 - low; leastFootbridgeClearanceM = Math.min(leastFootbridgeClearanceM, clear); if (clear < FOOTBRIDGE_CLEARANCE - 0.01) counts.clearanceFailures++; } }
    // 3. each end down to the ground; an end over a road first walks level to the nearest road-free land
    for (const k of [0, n - 1]) {
      const s = samples[k]!, t = k ? dirAt(k) : [-dirAt(0)[0], -dirAt(0)[1]] as P2; let p: P2 = [s[0], s[1]], out: P2 = t;
      if (onRoad(p[0], p[1])) {
        let land: P2 | null = null;
        for (let extra = 2; extra <= 80 && !land; extra += 2) for (const v of [t, [-t[1], t[0]] as P2, [t[1], -t[0]] as P2]) { const q: P2 = [p[0] + v[0] * extra, p[1] + v[1] * extra]; if ([-1, 0, 1].every((a) => [-1, 0, 1].every((b) => free(q[0] + a, q[1] + b)))) { land = q; out = v; break; } }
        if (land) {
          emit([[p[0], p[1], targets[k]!], [land[0], land[1], targets[k]!]], width, id, 'deck');
          note(patch('access-tower', 'repair', 'road-free-landing-search', [path.id ?? id], { landings: 1 }, { offsetM: Math.hypot(land[0] - p[0], land[1] - p[1]) }, { from: p, to: land, level: true, sourcePlanMoved: false }), [id]);
          p = land;
        } else { counts.footbridgeEndsUnconnected++; errors.push(`Footbridge ${path.id ?? id}: no road-free landing`); continue; }
      }
      descend(path, p, targets[k]!, out, width, id);
    }
    walk.push({ pts: path.pts, kind: 'path' });
  }
  if (counts.footbridgeRampGradeFailures) errors.push(`footbridge-approach: ${counts.footbridgeRampGradeFailures} walkways steeper than 1:14 (worst ${maxWalkGrade.toFixed(3)})`);
  return { counts, worst: { leastFootbridgeClearanceM: Number.isFinite(leastFootbridgeClearanceM) ? leastFootbridgeClearanceM : 0, maxWalkGrade, maxRampLengthM, maxGeneratedRiseM }, flagged: [...new Set(flagged)], errors, lifted };
}
