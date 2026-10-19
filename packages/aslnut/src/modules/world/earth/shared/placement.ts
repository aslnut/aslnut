// modules › world › earth › shared › placement: what the bake's placement stages (12–15) record on a piece, and
// placing points (a tree's trunk, a pole, a bench) where they may stand: kept, nudged within a limit to where they
// may (nudge), else left out (omit), by the check's policy.
import { nudge, type Exclusion } from '../../../../core/geometry/landform/compose/exclusion.ts';
import type { StagePatches } from '../../../../core/runtime/workers/compile/gates.ts';
import type { PatchPolicy } from '../../../../core/runtime/workers/compile/patch-policy.ts';

export type P2 = [number, number];
/** a patch on one piece: what was checked, what was done, how much (m, or m² for a clip) */
export interface FeaturePatch { check: string; policy: PatchPolicy; algorithm: string; amount?: number; unit?: string }
/** a piece the bake left out: where, which check, from which source */
export interface OmittedPiece { kind: 'building' | 'plot' | 'tree' | 'furniture'; id: string; at: P2; check: string; source: string }
/** a point's rule: the layers its footprint (a disc of radius `r`) may not touch, in the place's layers and in the
 *  buildings'; and where it may be nudged to (default: anywhere free) */
export interface PointRule { r: number; block: readonly string[]; buildings: boolean; to?: (x: number, z: number, from: { x: number; z: number }) => boolean }
export interface PointResult<T> { kept: (T & { x: number; z: number; patches: FeaturePatch[] })[]; counts: Record<string, number>; worst: Record<string, number>; errors: string[] }
/** points placed by their rules under one check: kept where free, else nudged (`limit` m), else omitted */
export function placePoints<T extends { id: string; x: number; z: number }>(items: readonly T[], rule: (item: T) => PointRule | null, ex: Exclusion, bex: Exclusion, patches: StagePatches, omitted: OmittedPiece[],
  o: { check: string; kind: OmittedPiece['kind']; limit: number; source: (item: T) => string; finite?: (item: T) => boolean }): PointResult<T> {
  const kept: PointResult<T>['kept'] = [], counts: Record<string, number> = { source: items.length, kept: 0, nudged: 0, omitted: 0, blocked: 0, unresolved: 0, nonFinite: 0 }, worst: Record<string, number> = { maxNudgeM: 0 }, errors: string[] = [];
  for (const it of items) {
    const r = rule(it); if (!r) continue;
    if (!Number.isFinite(it.x) || !Number.isFinite(it.z) || (o.finite && !o.finite(it))) { counts.nonFinite!++; errors.push(`${it.id} is not finite`); continue; }
    const hit = (x: number, z: number) => ex.disc(x, z, r.r, r.block) ?? (r.buildings ? bex.disc(x, z, r.r, ['building']) : null);
    const on = hit(it.x, it.z);
    if (!on) { kept.push({ ...it, patches: [] }); counts.kept!++; continue; }
    counts.blocked!++; counts[`on_${on}`] = (counts[`on_${on}`] ?? 0) + 1;
    const pol = patches.policy(o.check, 'repair', [it.id]);
    if (pol === 'stop') { counts.unresolved!++; errors.push(`${it.id} on ${on}`); continue; }
    const to = pol === 'repair' ? nudge(it.x, it.z, (x, z) => !hit(x, z) && (!r.to || r.to(x, z, it)), { limit: o.limit }) : null;
    if (to) {
      counts.nudged!++; worst.maxNudgeM = Math.max(worst.maxNudgeM!, to.moved);
      patches.add(o.check, 'repair', 'nudge', it.id, { nudgeM: to.moved }, { from: on });
      kept.push({ ...it, x: to.at[0], z: to.at[1], patches: [{ check: o.check, policy: 'repair', algorithm: 'nudge', amount: to.moved, unit: 'm' }] });
    } else {
      counts.omitted!++;
      patches.add(o.check, 'omit', pol === 'omit' ? 'omit' : 'nudge', it.id, {}, { on });
      omitted.push({ kind: o.kind, id: it.id, at: [it.x, it.z], check: o.check, source: o.source(it) });
    }
  }
  return { kept, counts, worst, errors };
}
