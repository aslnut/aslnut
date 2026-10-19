import type { P2, RoadEdge } from './graph.ts';
import type { PathsD } from 'clipper2-ts';
import type { Ground } from '../landform/compose/ground.ts';
import type { StageGate, PatchOptions } from '../../runtime/workers/compile/patch-policy.ts';
import type { WalkEdge, WalkReport } from './walk-bake.ts';
export type { Ground } from '../landform/compose/ground.ts';
/** a piece of the streetscape. strip: lines side by side (quads between neighbours: a carriageway left, middle, right);
 *  poly: an outline (fanned from its first point when `fan`); wall: a line with a top and a bottom height per point;
 *  box: a column. Every point is [x, z, h] (metres, h over the sea) */
export type P3 = [number, number, number];
export type Piece =
  | { t: 'strip'; kind: string; edges: P3[][]; info: number; overhead?:boolean }
  | { t: 'poly'; kind: string; ring: P3[]; fan?: boolean; info: number }
  | { t: 'wall'; kind: string; line: [number, number, number, number][]; info: number }
  | { t: 'box'; kind: string; at: P3; top: number; w: number; d: number; turn: number; info: number }
  /** an area: an outline and its holes, every point at its own height (facing down: a deck's underside) */
  | { t: 'area'; kind: string; rings: P3[][]; down?: boolean; info: number; overhead?:boolean; level?:number }
  /** an edge of a road's surface: each point [x, z, h, ground, dx, dz] (its inward offset across the kerb); the kind
   *  says what stands on it: 'kerb' (top, face, foot), 'deck' (parapet, deck side), 'cut' (retaining wall), 'edge' */
  | { t: 'edge'; kind: string; pts: [number, number, number, number, number, number][]; info: number };
/** where the ground goes down for the roads: the surfaces' cells (each an outline and holes with heights) and the
 *  outlines' lines (the kerb's foot, with heights) */
export interface ClampOut { cells: P3[][][]; edges: P3[][]; terrain?: Ground }
export interface SolveOptions extends PatchOptions { place?:string; snapshots?: boolean; /** the verge a kerbed road's reserve takes past its kerb where the data gives no reserve, m by road class (default Victoria's: 6 m on arterials, 4.3 m on local streets): a place's own streets (narrow lanes, no nature strips) */ verges?: Record<number,number>; pruneDanglingStubs?: boolean; simplifyShortSegments?: boolean; relaxHairpins?: boolean; smoothAlignment?: boolean; banking?: boolean; minK?: number; verticalFloors?: {road:string;at:P2;s?:number;minimum:number}[]; repairPass?:number; surfaceLevels?:Record<string,number>; widenLowerRoads?: boolean }
export interface SolveReport {
  stages: StageGate[];
  repairs?: {stage:number;flagged:(string|number)[];counts:Record<string,number>;worst?:Record<string,number>;locations?:StageGate["locations"]}[];
  roads: number; levels: number; bridges: number; tunnels: number; portals: number;
  /** roads moved half a level (over or beside another on the same level, at another height, not meeting it) */
  lifted: number;
  /** junction zones (where buffers overlap), how many planar, where the others are */
  zones: number; planar: number; nonPlanarAt: P2[];
  /** roundabout islands */
  islands: number;
  /** holes in the surfaces (medians, islands, blocks) */
  holes: number;
  /** proper crossings between the surfaces' outline edges (0: a valid set of simple polygons) */
  invalid: number;
  /** pieces an opening by the sliver width would still take away (0: no slivers) */
  slivers: number; sliverAt: P2[];
  /** the kerb: its length (m), points of its inner edge off the surface, places it crosses a road's centre line */
  kerbLength: number; kerbOutside: number; kerbOutsideAt: P2[]; kerbCrossings: number; kerbCrossingAt: P2[];
  /** places where two levels' surfaces lie within 0.5 m of each other (z-fighting) */
  zfight: number; zfightAt: P2[];
  /** each level's surface area (m²) */
  area: number[];
  /** the verges: where the reserve came from, the footpaths' and nature strips' areas (m²), sidewalks mapped in the
   *  data, crossings made (each with two kerb ramps), pieces of footpath or strip on the road or on each other, slivers */
  /** the walking graph: its lines, edges, crossings cut, ends joined, length (m) */
  walk?: WalkReport;
  reserveFrom: string; reserveRules: number; footpathArea: number; vergeArea: number; sidewalksMapped: number; crossings: number; vergeOverlap: number; vergeSlivers: number; vergeSliverAt: P2[];
  /** roads steeper than the limit (12 %, or 8 % on freeways), with where */
  steep: { at: P2; grade: number; road: string }[];
  /** decks over what they cross: the least clearance found (m) and any under 4.5 m */
  clearance: { least: number | null; short: { at: P2; clear: number; over: string; under: string }[] };
}
export interface StageSnapshot { stage:number;pieces:Piece[];infos:{kind:string;props:Record<string,unknown>}[];clamp:ClampOut;gates:StageGate[] }
export interface Solved { snapshots?: StageSnapshot[]; pieces: Piece[]; infos: { kind: string; props: Record<string, unknown> }[]; clamp: ClampOut; report: SolveReport; walk: WalkEdge[];
  /** the at-grade polygons (place metres): the road surface, footpaths, nature strips, the reserve (for steps › street) */
  verge: { S0: PathsD; F: PathsD; N: PathsD; R: PathsD } }

export interface RoadProfile { cls: number; lanes: number; carriageway: number; kerb: boolean; oneway: boolean; link: boolean; seedGrade:number; maxGrade:number; desirableGrade:number; minK:number; bankable:boolean; deckEdge:string; promenade:boolean; verge:boolean; plainEdge:boolean }
export interface Chain { id: string; edges: RoadEdge[]; pts: P2[]; prof: RoadProfile; a: number; b: number; name: string; ring: boolean; tags: Record<string, string>; roundabout: boolean; noSidewalk: boolean; structure: string; speed: number; s: number[]; kappa: number[]; point: { bridge: boolean; tunnel: boolean; layer: number; half: number }[] }

export interface BakePath {pts:P2[];id:string;steps:boolean;elevated:boolean;sidewalk:boolean;crossing:boolean;width?:number;props:Record<string,unknown>}
export interface BakeCrossing {at:P2;kind:string;marked:boolean}
