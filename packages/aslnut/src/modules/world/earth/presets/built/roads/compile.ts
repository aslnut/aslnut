import { runStage02Stamps, type StampSpec } from '../../../../../../core/geometry/landform/terraform/stamps.ts';
// Eleven ordered stages: terrain, stamps, topology QA, alignment, vertical design, frames,
// union per level, corridor templates, footways, piers and earthworks. Every stage has a
// hard evaluation gate. Failed deck envelopes retry from raw inputs with explicit height
// constraints; unresolved failures stop before publication. Measured plan coordinates stay fixed.
// Output: typed polygons with heights, structure descriptors, terrain contracts and a walking graph.
import { roadGraph } from './graph.ts';
import type { RoadEdge, RoadWay, P2 } from '../../../../../../core/geometry/networks/graph.ts';
import { runStage01Terrain } from '../../../../../../core/geometry/landform/terraform/hydrology.ts';
import type { StageGate } from '../../../../../../core/runtime/workers/compile/patch-policy.ts';
import { runStage03Topology } from './chaining.ts';
import { runStage04Alignment } from '../../../../../../core/geometry/networks/alignment.ts';
import { runStage05Vertical, runStage06Banking } from '../../../../../../core/geometry/networks/vertical.ts';
import { surfaces } from '../../../../../../core/geometry/networks/union.ts';
import type { PathsD } from 'clipper2-ts';
import { gateChecks, patchPolicy, patch, markPatched, recordPatches, type Patch, type PatchOptions } from '../../../../../../core/runtime/workers/compile/patch-policy.ts';
import { walkGraph, type WalkEdge, type WalkReport } from '../../../../../../core/geometry/networks/walk-bake.ts';

import { groundAt } from '../../../../../../core/geometry/landform/compose/ground.ts';
import { BakeGateError, evaluateGate } from '../../../../../../core/runtime/workers/compile/gates.ts';
import type { StageSnapshot, Chain, Ground, P3, Piece, ClampOut, SolveOptions, SolveReport, Solved } from '../../../../../../core/geometry/networks/bake-types.ts';
import { profileOfTags, radiusOf, VERGE } from './profiles.ts';
import { fitSteps, bakePath, bakeWater, type WaterWay } from './inputs.ts';
import { roadMarkings } from './markings.ts';
export function solveRoads(ways: readonly RoadWay[], origin: [number, number], ground: Ground, extras: { crossings?: { at: [number, number]; tags: Record<string, string> }[]; paths?: { pts: [number, number][]; tags: Record<string, string> }[]; waterways?: WaterWay[]; stamps?: StampSpec[]; reserves?: [number, number][][]; footpathWidth?: (lon: number, lat: number) => number; options?: SolveOptions } = {}): Solved {
  const pieces: Piece[] = [], infos: Solved['infos'] = [], clamp: ClampOut = { cells: [], edges: [] }, stages: StageGate[] = [];
  const info = (kind: string, props: Record<string, unknown>) => { infos.push({ kind, props }); return infos.length - 1; };
  const g = roadGraph(ways, origin), options = extras.options ?? {};
  const snapshots:StageSnapshot[]=[];
  const snapshot=(stage:number,draw:Piece[]=pieces,terrain:Ground=t.ground)=>{
    if(!options.snapshots)return;
    snapshots.push({stage,pieces:structuredClone(draw),infos:structuredClone(infos),clamp:{cells:structuredClone(clamp.cells),edges:structuredClone(clamp.edges),terrain:{...terrain,data:new Float32Array(terrain.data)}},gates:structuredClone(stages)});
  };
  const lines=(rows:readonly {pts:P2[];id:string|number;name?:string}[],height:(x:number,z:number,row:number)=>number):Piece[]=>rows.flatMap((row,index)=>{
    const id=info('road',{osm:row.id,name:row.name??'raw road',source:'OpenStreetMap (ODbL)'}),left:P3[]=[],right:P3[]=[];
    for(const change of stages.flatMap(g=>g.patches??[]))if(change.ids.includes(row.id))markPatched(infos[id]!.props,change);
    for(let i=0;i<row.pts.length;i++){const p=row.pts[i]!,a=row.pts[Math.max(0,i-1)]!,b=row.pts[Math.min(row.pts.length-1,i+1)]!,L=Math.hypot(b[0]-a[0],b[1]-a[1])||1,h=height(p[0],p[1],index);left.push([p[0]+(b[1]-a[1])/L*.4,p[1]-(b[0]-a[0])/L*.4,h+.1]);right.push([p[0]-(b[1]-a[1])/L*.4,p[1]+(b[0]-a[0])/L*.4,h+.1]);}
    return [{t:'strip',kind:'carriageway',edges:[left,right],info:id}];
  });
  const changes = new Map<number, Patch[]>();
  const notePatch = (stage: number, change: Patch, infoIds: number[] = []) => {
    change.ids = [...new Set([...change.ids, ...infoIds.flatMap(id => {
      const source=infos[id]?.props.osm;
      return Array.isArray(source)?source as (string|number)[]:typeof source==='string'?source.split(' '):source===undefined?[]:[String(source)];
    })])];
    const list = changes.get(stage) ?? []; list.push(change); changes.set(stage, list);
    for (const id of infoIds) if (infos[id]) markPatched(infos[id]!.props, change);
  };
  const gate = (value: StageGate) => {
    recordPatches(value, [...(value.patches ?? []), ...(changes.get(value.stage) ?? [])]);
    value.checks=gateChecks(value,options);
    evaluateGate(stages, value, options.place??`roads at ${origin.join(',')}`);
  };
  const t = runStage01Terrain(ground, extras.waterways?.map(bakeWater), g.toLocal, clamp); gate(t.gate);
  for(const water of t.waters){const id=info('water',{osm:water.id,name:water.name,source:'OpenStreetMap (ODbL), Gaussian DEM basin'}),left:P3[]=[],right:P3[]=[];
    for(let i=0;i<water.pts.length;i++){const p=water.pts[i]!,a=water.pts[Math.max(0,i-1)]!,b=water.pts[Math.min(water.pts.length-1,i+1)]!,l=Math.hypot(b[0]-a[0],b[1]-a[1])||1,nx=-(b[1]-a[1])/l,nz=(b[0]-a[0])/l;left.push([p[0]-nx*water.halfWidth,p[1]-nz*water.halfWidth,p[2]]);right.push([p[0]+nx*water.halfWidth,p[1]+nz*water.halfWidth,p[2]]);}pieces.push({t:'strip',kind:'water',edges:[left,right],info:id});
  }
  if(options.snapshots)snapshot(1,[...pieces,...lines(ways.map(w=>({id:w.id,pts:w.pts.map(p=>g.toLocal(...p))})),(x,z)=>groundAt(t.ground,x,z))]);
  const stamp = runStage02Stamps(t.ground, [...(extras.stamps??[]),...fitSteps(t.ground,extras.paths??[],g.toLocal)], [], t.waters, g.toLocal, pieces, info, clamp); gate(stamp.gate);
  if(options.snapshots)snapshot(2,[...pieces,...lines(ways.map(w=>({id:w.id,pts:w.pts.map(p=>g.toLocal(...p))})),(x,z)=>groundAt(t.ground,x,z))]);
  const G = (x: number, z: number) => groundAt(t.ground, x, z);
  const topology = runStage03Topology(g, options); gate(topology.gate);
  const { chains, jn } = topology;
  if(options.snapshots)snapshot(3,[...pieces,...lines(chains,G)]);
  gate(runStage04Alignment(chains, options).gate);
  if(options.snapshots)snapshot(4,[...pieces,...lines(chains,G)]);
  const v = runStage05Vertical(chains, jn, G, t.waters, options); gate(v.gate);
  const { st } = v;
  const profileLines=()=>lines(chains.map(c=>({id:c.id,name:c.name,pts:st.get(c)!.map(p=>[p.x,p.z] as P2)})),(x,z,i)=>{const stations=st.get(chains[i]!)!;return stations.find(p=>p.x===x&&p.z===z)!.h;});
  if(options.snapshots)snapshot(5,[...pieces,...profileLines()]);
  gate(runStage06Banking(chains, st, options).gate);
  if(options.snapshots)snapshot(6,[...pieces,...profileLines()]);
  const report: SolveReport = { stages, roads: chains.length, levels: 0, lifted: 0, bridges: 0, tunnels: 0, portals: 0, zones: 0, planar: 0, nonPlanarAt: [], islands: 0, holes: 0, invalid: 0, slivers: 0, sliverAt: [], kerbLength: 0, kerbOutside: 0, kerbOutsideAt: [], kerbCrossings: 0, kerbCrossingAt: [], zfight: 0, zfightAt: [], area: [], reserveFrom: '', reserveRules: 0, footpathArea: 0, vergeArea: 0, sidewalksMapped: 0, crossings: 0, vergeOverlap: 0, vergeSlivers: 0, vergeSliverAt: [], steep: v.steep, clearance: v.clearance };
  const roadInfo = new Map<Chain, number>();
  for (const c of chains) roadInfo.set(c, info('road', { name: c.name || 'unnamed road', highway: c.tags.highway, lanes: c.prof.lanes, 'carriageway (m)': +c.prof.carriageway.toFixed(1), oneway: c.prof.oneway, layer: c.point[0]?.layer ?? 0, osm: c.edges.map((e) => e.way).join(' '), source: 'OpenStreetMap (ODbL), baked (tools › compile)' }));
  for(const stage of stages)for(const change of stage.patches??[])for(const c of chains)if(change.ids.includes(c.id))markPatched(infos[roadInfo.get(c)!]!.props,change);
  // roundabouts: each closed ring
  const rings: { ring: P2[]; half: number; level: number }[] = [];
  for (const w of ways) {
    if (w.tags.junction !== 'roundabout' || w.nodes[0] !== w.nodes[w.nodes.length - 1] || w.pts.length < 5) continue;
    rings.push({ ring: w.pts.slice(0, -1).map(([lo, la]) => g.toLocal(lo, la)), half: profileOfTags(w.tags, true).carriageway / 2, level: Number.parseInt(w.tags.layer ?? '0', 10) || 0 });
  }
  let surfaceResult:ReturnType<typeof surfaces>;
  try { surfaceResult=surfaces({ snapshot:options.snapshots?snapshot:undefined, radiusOf,vergeWidths:options.verges?{...VERGE,...options.verges}:VERGE,markings:roadMarkings, terrain: t.ground, waters: t.waters, options, gate, patch: notePatch, rings, paths: (extras.paths ?? []).map((p) => bakePath({pts:p.pts.map(([lo,la])=>g.toLocal(lo,la)),tags:p.tags})), reserves: (extras.reserves ?? []).map((r) => r.map(([lo, la]) => g.toLocal(lo, la))), footpathWidth: extras.footpathWidth ? (x, z) => { const [lo, la] = g.toLonLat(x, z); return extras.footpathWidth!(lo, la); } : undefined, chains, st, G, roadInfo, info, crossings: (extras.crossings ?? []).map((x) => ({at:g.toLocal(x.at[0],x.at[1]),kind:x.tags.highway??'',marked:/zebra|marked|uncontrolled|traffic_signals/.test(`${x.tags.crossing??''} ${x.tags['crossing:markings']??''}`)})), jn, degree: (n) => g.nodes.get(n)?.edges.length ?? 0 }, pieces, clamp, report); }
  catch(e){if(e instanceof BakeGateError&&e.gate.stage===8&&e.gate.corrections?.length&&patchPolicy(options,'deck-clearance','repair')==='repair'&&(options.repairPass??0)<12){
      let retry:Solved;try{retry=solveRoads(ways,origin,ground,{...extras,options:{...options,repairPass:(options.repairPass??0)+1,surfaceLevels:{...(options.surfaceLevels??{}),...(e.gate.surfaceLevels??{})},verticalFloors:[...(options.verticalFloors??[]),...e.gate.corrections]}});}catch(nested){if(nested instanceof BakeGateError)nested.repairs.unshift(e.gate);throw nested;}
      const change = patch('deck-clearance', 'repair', 'clearance-raise / curve-lengthen', e.gate.flagged,
        {stations: e.gate.corrections.length, failedSamples: e.gate.counts.shortDeckSamples ?? 0},
        {beforeClearanceM: e.gate.worst.leastDeckClearanceM ?? 0},
        {verticalFloors: e.gate.corrections, sourcePlanMoved: false});
      const target = retry.report.stages.find(g => g.stage === 8)!;
      recordPatches(target, [change, ...(target.patches ?? [])]);
      for (const c of chains) if (e.gate.corrections.some(f => f.road === c.id)) {
        const sourceIds = new Set(c.edges.map(e => String(e.way)));
        for (const i of retry.infos) if (String(i.props.osm ?? '').split(' ').some(id => sourceIds.has(id))) markPatched(i.props, change);
      }
      retry.report.repairs=[{stage:8,flagged:e.gate.flagged,counts:e.gate.counts,worst:e.gate.worst,locations:e.gate.locations},...(retry.report.repairs??[])];return retry;
    }throw e;}
  const {walk:walkLines,verge}=surfaceResult;
  // the walking graph: the verges' lines joined (steps › walk)
  const wg = walkGraph(walkLines); report.walk = wg.report;
  return { snapshots, pieces, infos, clamp, report, walk: wg.edges, verge };
}

export interface RoadCompileOptions extends SolveOptions { ways:readonly RoadWay[]; origin:[number,number]; ground:Ground; extras?:Parameters<typeof solveRoads>[3] }
export function compile({ways,origin,ground,extras={},...options}:RoadCompileOptions):Solved {
  return solveRoads(ways,origin,ground,{...extras,options:{...extras.options,...options}});
}
