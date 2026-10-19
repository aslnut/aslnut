// Bake-only gate policies and provenance. A patch never changes a raw input file.
import type { P2 } from '../../../geometry/networks/graph.ts';
export interface StageGate {
  stage: number;
  id: string;
  name: string;
  ok: boolean;
  counts: Record<string, number>;
  worst: Record<string, number>;
  flagged: (string | number)[];
  errors: string[];
  patches?: Patch[];
  checks?: { check: string; policy: 'repair' | 'omit' | 'stop'; algorithm: string; ok: boolean }[];
  locations?: {at:P2;ids:(string|number)[];value:number;metric:string}[];
  surfaceLevels?: Record<string,number>;
  corrections?: {road:string;at:P2;s?:number;minimum:number}[];
}

export type PatchPolicy = 'repair' | 'omit' | 'stop';
export interface Patch {
  check: string;
  policy: PatchPolicy;
  algorithm: string;
  ids: (string | number)[];
  counts: Record<string, number>;
  worst: Record<string, number>;
  moved: Record<string, unknown>;
}
export type PatchRule = PatchPolicy | ((piece: { check: string; ids: readonly (string | number)[] }) => PatchPolicy);
export interface PatchOptions { patch?: Record<string, PatchRule>; /** Compatibility for earlier callers. */ patches?: Record<string, PatchPolicy> }
/** Names used by compile({ patch: { 'deck-clearance': 'stop' } }). */
export const DEFAULT_PATCHES = {
  'deck-clearance': {policy:'repair',algorithm:'clearance-raise'},
  'k-value': {policy:'repair',algorithm:'curve-lengthen'},
  'profile-convergence': {policy:'repair',algorithm:'relax-in-order',fallback:'stop'},
  'level-separate': {policy:'repair',algorithm:'level-separate'},
  'kerb-clip': {policy:'repair',algorithm:'kerb-clip'},
  'path-clip': {policy:'repair',algorithm:'path-clip',fallback:'omit'},
  'deck-connection': {policy:'repair',algorithm:'seat-continuous-approach',fallback:'stop'},
  'structure-clearance': {policy:'repair',algorithm:'shorten-or-split-span',fallback:'stop'},
  'support-containment': {policy:'repair',algorithm:'move-under-carried-deck',fallback:'stop'},
  'footpath-grade': {policy:'repair',algorithm:'follow-road-or-walkable-terrain',fallback:'omit'},
  'carriageway-step': {policy:'repair',algorithm:'open-seam-to-ground',fallback:'stop'},
  'footbridge-approach': {policy:'repair',algorithm:'lift-mapped-approach-or-generate-switchback',fallback:'stop'},
  'structure-seat': {policy:'repair',algorithm:'seat-on-final-soffit'},
  'pier-collision': {policy:'repair',algorithm:'five-rule-pier-solver'},
  'batter-slope': {policy:'repair',algorithm:'wall-promote'},
  'carriageway-visible': {policy:'repair',algorithm:'clamp-facets-and-clip-cover'},
  'plot-reserve': {policy:'repair',algorithm:'plot-clip'},
  'plot-building': {policy:'repair',algorithm:'plot-clip'},
  'plot-overlap': {policy:'repair',algorithm:'bisector-split'},
  'frontage': {policy:'omit',algorithm:'no-property-line'},
  'house-size': {policy:'repair',algorithm:'not-a-house'},
  'building-reserve': {policy:'repair',algorithm:'footprint-clip / setback',fallback:'omit'},
  'building-path': {policy:'repair',algorithm:'footprint-clip',fallback:'omit'},
  'building-water': {policy:'repair',algorithm:'footprint-clip',fallback:'omit'},
  'building-overlap': {policy:'repair',algorithm:'overlap-clip',fallback:'omit'},
  'pad-buried': {policy:'repair',algorithm:'pad-raise'},
  'pad-floating': {policy:'stop',algorithm:'skirt-to-lowest-ground'},
  'pad-front': {policy:'repair',algorithm:'set-into-slope'},
  'tree-collision': {policy:'repair',algorithm:'nudge',fallback:'omit'},
  'tree-valid': {policy:'omit',algorithm:'omit'},
  'furniture-collision': {policy:'repair',algorithm:'nudge',fallback:'omit'},
} as const;
type Check = [string, PatchPolicy, string, (gate: StageGate) => boolean];
const zero = (...keys: string[]) => (g: StageGate) => keys.every(k => !(g.counts[k] ?? 0));
const CHECKS: Record<number, Check[]> = {
  1: [['dem-valid','stop','validate-grid',g=>g.counts.nanHeights!==undefined],['non-finite','stop','validate-finite',zero('nanHeights','invalidWaterways')],['downstream','stop','validate-downstream',g=>(g.worst.maxDownstreamRiseM??0)<=1e-6]],
  2: [['stamp-valid','stop','validate-stamp',zero('invalidStamps','nanHeights')]],
  3: [['duplicate-vertices','stop','validate-source-topology',zero('duplicateNodes')]],
  4: [['alignment-valid','stop','validate-stations-and-crossings',g=>g.ok]],
  5: [['k-value','repair','curve-lengthen',zero('kViolations')],['grade','repair','metric-profile-projection',zero('gradeViolations')],['deck-clearance','repair','clearance-raise',zero('shortClearances')],['profile-convergence','repair','relax-in-order',g=>(g.worst.residual??0)<=1e-3]],
  6: [['frame-valid','stop','validate-orthonormal-basis',g=>!(g.counts.invertedNormals??0)&&(g.worst.maxFrameError??0)<=1e-6]],
  7: [['outline-valid','repair','union-and-opening',zero('invalid')],['sliver','repair','morphological-opening',zero('slivers')],['level-separate','repair','level-separate',zero('zfight')]],
  8: [['carriageway-step','repair','open-seam-to-ground',zero('carriagewaySteepFacets')],['deck-connection','repair','seat-continuous-approach',zero('deckConnectionFailures')],['kerb-clip','repair','kerb-clip',zero('kerbCrossings','kerbOutside')],['deck-clearance','repair','clearance-raise',zero('shortDeckSamples')]],
  9: [['footpath-grade','repair','split-at-unwalkable-grade',zero('footpathGradeFailures')],['path-clip','repair','path-clip',zero('vergeOverlap')],['footbridge-clearance','repair','propagate-height-envelope',zero('clearanceFailures')],['verge-sliver','repair','morphological-opening',zero('vergeSlivers')],['access-tower','repair','road-free-landing-search',g=>!g.errors.some(e=>e.includes('road-free landing'))],['footbridge-approach','repair','lift-mapped-approach-or-generate-switchback',g=>(g.counts.footbridgeEnds??0)>=0&&zero('footbridgeEndsUnconnected','footbridgeRampGradeFailures','accessTowers')(g)]],
  10: [['support-containment','repair','move-under-carried-deck',zero('supportContainmentFailures','supportHeightFailures')],['structure-seat','repair','seat-on-final-soffit',zero('capContactFailures')],['pier-collision','repair','five-rule-pier-solver',zero('pierRoadCollisions','pierWaterCollisions')],['median-widening','stop','require-authored-reserve',g=>!g.errors.some(e=>e.includes('widening'))]],
  11: [['support-containment','repair','move-under-carried-deck',zero('abutmentContainmentFailures')],['structure-clearance','repair','shorten-or-split-span',zero('structureClearanceFailures')],['batter-slope','repair','wall-promote',zero('oversteepSlopesUnwalled')],['portal-open','repair','cut-both-sides-of-mouth',zero('blockedPortals')],['terrain-intrusion','repair','clamp-to-composed-ground',zero('roadUnderGroundOverTol')],['carriageway-visible','repair','clamp-facets-and-clip-cover',g=>(g.counts.visibilitySamples??0)>0&&zero('terrainCoverFailures','pieceCoverFailures')(g)],['non-finite','stop','validate-finite',zero('nonFinite')]],
  12: [['house-size','repair','not-a-house',zero('housesTooBigLeft')],['plot-reserve','repair','plot-clip',zero('plotsInReserve')],['plot-building','repair','plot-clip',zero('plotsOverBuildings')],['plot-overlap','repair','bisector-split',zero('plotOverlaps')],['frontage','omit','no-property-line',zero('plotsUnresolved')]],
  13: [['building-reserve','repair','footprint-clip / setback',zero('buildingsInReserve')],['building-path','repair','footprint-clip',zero('buildingsOnPaths')],['building-water','repair','footprint-clip',zero('buildingsOnWater')],['building-overlap','repair','overlap-clip',zero('buildingOverlaps')],['pad-buried','repair','pad-raise',zero('buriedWalls')],['pad-floating','stop','skirt-to-lowest-ground',zero('floatingPads')],['pad-front','repair','set-into-slope',zero('frontWallsLeft')],['non-finite','stop','validate-finite',zero('nonFinite')]],
  14: [['tree-collision','repair','nudge',zero('treesBlocked')],['tree-valid','omit','omit',zero('treesInvalid')],['non-finite','stop','validate-finite',zero('nonFinite')]],
  15: [['furniture-collision','repair','nudge',zero('furnitureBlocked')],['non-finite','stop','validate-finite',zero('nonFinite')]],
};
export function gateChecks(gate: StageGate, options?: PatchOptions): NonNullable<StageGate['checks']> {
  return (CHECKS[gate.stage] ?? []).map(([check,fallback,algorithm,valid])=>({check,policy:patchPolicy(options,check,fallback,gate.flagged),algorithm,ok:valid(gate)}));
}
/** Overrides apply per check and never bypass a failed evaluation. */
export function patchPolicy(options: PatchOptions | undefined, check: string, fallback: PatchPolicy, ids: readonly (string | number)[] = []): PatchPolicy {
  const rule = options?.patch?.[check] ?? options?.patches?.[check] ?? fallback;
  const policy = typeof rule === 'function' ? rule({ check, ids }) : rule;
  if (!['repair', 'omit', 'stop'].includes(policy)) throw new Error(`Unknown patch policy '${policy}' for ${check}`);
  return policy;
}
export function patch(check: string, policy: PatchPolicy, algorithm: string, ids: (string | number)[],
  counts: Record<string, number>, worst: Record<string, number>, moved: Record<string, unknown>): Patch {
  return { check, policy, algorithm, ids: [...new Set(ids)], counts, worst, moved };
}
/** These properties survive the typed tile writer and both graphics' pick path. */
export function markPatched(props: Record<string, unknown>, change: Patch): void {
  if(change.policy==='stop')return;
  props[change.policy === 'omit' ? 'omitted' : 'patched'] = change.policy === 'omit' ? change.check : change.algorithm;
  ((props.patches ??= []) as Patch[]).push(change);
}
export function recordPatches(gate: StageGate, patches: Patch[]): void {
  gate.patches = patches;
  for(const k of Object.keys(gate.counts))if(k.startsWith('patch_'))delete gate.counts[k];
  for(const k of Object.keys(gate.worst))if(k.startsWith('patch_'))delete gate.worst[k];
  for(const p of patches){
    const key=`patch_${p.check.replaceAll('-','_')}`;
    gate.counts[key]=(gate.counts[key]??0)+1;
    for(const [metric,value]of Object.entries(p.worst))if(Number.isFinite(value)){
      const k=`patch_${metric}`;gate.worst[k]=Math.max(gate.worst[k]??-Infinity,value);
    }
  }
  gate.counts.patched = patches.filter(p => p.policy === 'repair').length;
  gate.counts.omitted = patches.filter(p => p.policy === 'omit').length;
}
