// modules › world › earth › presets › built › furniture › placement: the bake's stage 15. Street furniture and poles
// from OpenStreetMap nodes, each kind by its rule (where its footprint may not stand), kept, nudged (2 m at most) or
// left out, like the trees:
//   pole, lamp          not on a carriageway, kerb, footpath or path, structure, water or building (0.15 m)
//   bench, bin, …       not on a carriageway, kerb, structure, water or building (0.3 m): footpaths are theirs
//   bollard, hydrant    not on a structure, water or building (0.1 m): they stand in roads and paths
// The kind is placement; how each kind looks is chosen when it is drawn.
import type { Exclusion } from '../../../../../../core/geometry/landform/compose/exclusion.ts';
import type { StagePatches } from '../../../../../../core/runtime/workers/compile/gates.ts';
import { placePoints, type FeaturePatch, type OmittedPiece, type PointRule } from '../../../shared/placement.ts';
import type { SourceFurniture } from '../buildings/inputs.ts';

export interface PlacedFurniture { id: string; kind: string; x: number; z: number; seed: number; name?: string; patches: FeaturePatch[] }
const TAGS: [string, string, string][] = [['power', 'pole', 'pole'], ['highway', 'street_lamp', 'lamp'], ['highway', 'bus_stop', 'bus-stop'], ['amenity', 'bench', 'bench'], ['amenity', 'waste_basket', 'bin'], ['amenity', 'recycling', 'bin'], ['amenity', 'bicycle_parking', 'bicycle-parking'], ['amenity', 'post_box', 'post-box'], ['amenity', 'drinking_water', 'drinking-water'], ['amenity', 'bbq', 'barbecue'], ['amenity', 'telephone', 'telephone'], ['amenity', 'vending_machine', 'vending'], ['leisure', 'picnic_table', 'picnic-table'], ['barrier', 'bollard', 'bollard'], ['emergency', 'fire_hydrant', 'hydrant']];
/** the kind of a node (null: not furniture) */
export const furnitureKind = (tags: Record<string, string>): string | null => TAGS.find(([k, v]) => tags[k] === v)?.[2] ?? null;
const POLE: PointRule = { r: 0.15, block: ['road', 'kerb', 'footpath', 'path', 'structure', 'water'], buildings: true };
const STREET: PointRule = { r: 0.3, block: ['road', 'kerb', 'structure', 'water'], buildings: true };
const IN_ROAD: PointRule = { r: 0.1, block: ['structure', 'water'], buildings: true };
/** each kind's rule (yours to change: a kind not here is placed by `STREET`'s) */
export const FURNITURE_RULES: Record<string, PointRule> = { pole: POLE, lamp: POLE, bollard: IN_ROAD, hydrant: IN_ROAD };
const seedOf = (s: string) => { let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0; };
/** stage 15 (`raw`: as they come, unchecked) */
export function placeFurniture(items: readonly SourceFurniture[], ex: Exclusion | null, bex: Exclusion | null, patches: StagePatches, omitted: OmittedPiece[], limit: number, raw = false, source = 'OpenStreetMap') {
  const typed = items.map((f) => ({ id: f.id, x: f.x, z: f.z, kind: furnitureKind(f.tags), name: f.tags.name, seed: seedOf(f.id) })).filter((f): f is { id: string; x: number; z: number; kind: string; name: string | undefined; seed: number } => !!f.kind);
  const strip = <T extends { name?: string }>(f: T): T => { if (f.name === undefined) delete f.name; return f; };
  if (raw || !ex || !bex) return { furniture: typed.map((f) => strip({ ...f, patches: [] as FeaturePatch[] })), counts: { furniture: typed.length }, worst: {}, errors: [] as string[] };
  const r = placePoints(typed, (f) => FURNITURE_RULES[f.kind] ?? STREET, ex, bex, patches, omitted, { check: 'furniture-collision', kind: 'furniture', limit, source: (f) => `${source} ${f.id}` });
  const kinds: Record<string, number> = {}; for (const f of r.kept) kinds[`kind_${f.kind}`] = (kinds[`kind_${f.kind}`] ?? 0) + 1;
  const counts = { furniture: r.kept.length, source: items.length, kept: r.counts.kept!, nudged: r.counts.nudged!, omitted: r.counts.omitted!, furnitureBlocked: r.counts.unresolved!, nonFinite: r.counts.nonFinite!, ...kinds, ...Object.fromEntries(Object.entries(r.counts).filter(([k]) => k.startsWith('on_'))) };
  return { furniture: r.kept.map(strip) as PlacedFurniture[], counts, worst: r.worst, errors: r.errors };
}
