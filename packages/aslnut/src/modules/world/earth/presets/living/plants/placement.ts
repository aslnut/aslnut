// modules › world › earth › presets › living › plants › placement: the bake's stage 14. A real tree (its place, height
// and crown from the data) keeps its place unless its trunk (0.3 m round) stands on a carriageway, a kerb, a footpath,
// a mapped path, a structure, water or a building; then it is nudged (2 m at most) to where it may stand: onto a nature strip if it
// stood in the road reserve, else off the reserve; else it is left out. The crown may overhang anything.
import type { Exclusion } from '../../../../../../core/geometry/landform/compose/exclusion.ts';
import type { StagePatches } from '../../../../../../core/runtime/workers/compile/gates.ts';
import { placePoints, type FeaturePatch, type OmittedPiece } from '../../../shared/placement.ts';
import type { SourceTree } from '../../built/buildings/inputs.ts';

export interface PlacedTree extends SourceTree { patches: FeaturePatch[] }
/** where a trunk may not stand */
export const TREE_BLOCK = ['road', 'kerb', 'footpath', 'path', 'structure', 'water'] as const;
export function placeTrees(all: readonly SourceTree[], ex: Exclusion, bex: Exclusion, patches: StagePatches, omitted: OmittedPiece[], limit: number, source: string) {
  // a tree the data gives no height (0 m) is no tree to draw: left out (tree-valid), or a stop
  const errors: string[] = []; let invalid = 0;
  const trees = all.filter((t) => {
    if (!(t.height <= 0)) return true;
    const pol = patches.policy('tree-valid', 'omit', [t.id]);
    if (pol === 'stop') { invalid++; errors.push(`tree ${t.id} has no height`); return false; }
    if (pol === 'repair') return true;
    patches.add('tree-valid', 'omit', 'omit', t.id); omitted.push({ kind: 'tree', id: t.id, at: [t.x, t.z], check: 'tree-valid', source }); return false;
  });
  const r = placePoints(trees, (t) => {
    const inReserve = ex.has('reserve', t.x, t.z);
    return { r: 0.3, block: TREE_BLOCK, buildings: true, to: (x, z) => (inReserve ? ex.has('verge', x, z) : !ex.has('reserve', x, z)) };
  }, ex, bex, patches, omitted, { check: 'tree-collision', kind: 'tree', limit, source: () => source, finite: (t) => Number.isFinite(t.height) && Number.isFinite(t.crown) });
  const counts = { trees: r.kept.length, source: all.length, noHeight: all.filter((t) => t.height <= 0).length, treesInvalid: invalid, kept: r.counts.kept!, nudged: r.counts.nudged!, omitted: r.counts.omitted!, treesBlocked: r.counts.unresolved!, nonFinite: r.counts.nonFinite!, ...Object.fromEntries(Object.entries(r.counts).filter(([k]) => k.startsWith('on_'))) };
  return { trees: r.kept as PlacedTree[], counts, worst: r.worst, errors: [...errors, ...r.errors] };
}
