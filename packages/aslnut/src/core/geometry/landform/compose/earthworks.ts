import type { StageGate } from '../../../runtime/workers/compile/patch-policy.ts';
import { patchPolicy, patch, type Patch } from '../../../runtime/workers/compile/patch-policy.ts';
// Structural candidates are checked against the final union at EVERY lower level.
import type { P2 } from '../../networks/graph.ts';
import { along } from '../../networks/sections.ts';
import { distToPolylineXZ, type SolvedWater } from '../terraform/hydrology.ts';
import { DECK_DEPTH, ROAD_CLEARANCE } from '../../networks/vertical.ts';
import type { Chain, ClampOut, Ground, P3, Piece, SolveOptions, SolveReport } from '../../networks/bake-types.ts';
import { groundAt } from './ground.ts';
import { clampIndex } from '../../networks/clamp-index.ts';
import { Grid, type Region } from '../../networks/union.ts';
import { hRun, type RunForStructures } from '../../networks/structures/piers.ts';
import { differenceD, unionD, inflatePathsD, areaD, FillRule, JoinType, EndType, type PathsD } from 'clipper2-ts';
import { polysOf } from '../../networks/union.ts';
import { structureEnvelope, abutmentEnvelope } from '../../networks/structures/envelope.ts';
import { carriagewayVisibility, facetsOf, FacetIndex } from '../../networks/facets.ts';
const project=(r:RunForStructures,x:number,z:number)=>{let best={x:0,z:0,tx:1,tz:0,d:Infinity,s:0};for(let i=1;i<r.pts.length;i++){const a=r.pts[i-1]!,b=r.pts[i]!,dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz),f=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(L*L||1))),px=a[0]+f*dx,pz=a[1]+f*dz,d=Math.hypot(x-px,z-pz);if(d<best.d)best={x:px,z:pz,tx:dx/(L||1),tz:dz/(L||1),d,s:r.acc[i-1]!+L*f};}return best;};
export function runStage11Earthworks(runs:readonly RunForStructures[],G:(x:number,z:number)=>number,roadInfo:ReadonlyMap<Chain,number>,pieces:Piece[],clamp:ClampOut,report:SolveReport,terrain:Ground,opts:SolveOptions={},note:(change:Patch,ids?:number[])=>void=()=>{}):{gate:StageGate}{
  const data=new Float32Array(terrain.data),baked:Ground={...terrain,data},grid=new Grid<{r:RunForStructures;i:number}>(50),groundRuns=runs.filter(r=>!r.bridge&&(r.baseLevel??r.level)===0);
  for(const r of groundRuns)for(let i=1;i<r.pts.length;i++){const a=r.pts[i-1]!,b=r.pts[i]!,pad=r.outer+28;grid.add(Math.min(a[0],b[0])-pad,Math.min(a[1],b[1])-pad,Math.max(a[0],b[0])+pad,Math.max(a[1],b[1])+pad,{r,i});}
  let lockedCells=0,cutCells=0,fillCells=0,maxCutM=0,maxFillM=0,retainingWalls=0,blockedPortals=0,abutments=0,oversteepSlopesUnwalled=0,maxBatterSlope=0;
  // Hermite transition's maximum derivative is 1.5 * delta / width.
  const policyErrors:string[]=[];
  const adjustments=new Map<number,{count:number;maxDropM:number}>();
  const wallStations=new Set<string>(),portalContracts:{at:P2;t:P2;half:number;h:number;id:number}[]=[];
  for(let j=0;j<terrain.nz;j++)for(let i=0;i<terrain.nx;i++){const x=terrain.x0+i*terrain.step,z=terrain.z0+j*terrain.step,idx=j*terrain.nx+i,raw=data[idx]!;let best:{r:RunForStructures;q:ReturnType<typeof project>;edge:number}|null=null;
    for(const {r,i} of grid.near(x,z)){const a=r.pts[i-1]!,b=r.pts[i]!,dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz)||1,f=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(L*L))),px=a[0]+f*dx,pz=a[1]+f*dz,q={x:px,z:pz,tx:dx/L,tz:dz/L,d:Math.hypot(x-px,z-pz),s:r.acc[i-1]!+f*L},edge=q.d-r.outer;if(edge<28&&(!best||edge<best.edge))best={r,q,edge};}if(!best)continue;
    const {r,q,edge}=best,road=hRun(r,q.s)-.35,delta=raw-road,slope=1.5*Math.abs(delta)/28,walled=slope>1/1.5;
    if(walled)wallStations.add(`${r.chain.id}:${Math.round(q.s/4)*4}m`);
    const width=walled?1.2:28,t=Math.max(0,Math.min(1,edge/width)),blend=t*t*(3-2*t),target=road+(raw-road)*blend;
    if(edge<=0)lockedCells++;const diff=target-raw;if(diff<0){cutCells++;maxCutM=Math.max(maxCutM,-diff);}if(diff>0){fillCells++;maxFillM=Math.max(maxFillM,diff);}data[idx]=target;if(!walled)maxBatterSlope=Math.max(maxBatterSlope,slope);
  }
  for(const road of new Set([...wallStations].map(station=>station.slice(0,station.lastIndexOf(':'))))) {
    const policy=patchPolicy(opts,'batter-slope','repair');
    if(policy!=='repair')policyErrors.push(`Retaining wall required for ${road}; cannot ${policy} the ground contract`);
    const chain=runs.find(r=>r.chain.id===road)?.chain;
    note(patch('batter-slope',policy,'wall-promote',[road],{roads:1},{limit:1/1.5},{wallTransitionM:1.2,sourcePlanMoved:false}),chain?[roadInfo.get(chain)??0]:[]);
  }
  for(const r of groundRuns){const id=roadInfo.get(r.chain)??0;for(const side of [-1,1]){let line:[number,number,number,number][]=[];const flush=()=>{if(line.length>1){pieces.push({t:'wall',kind:'retaining',line,info:id});retainingWalls++;}line=[];};for(let i=0;i<r.pts.length;i++){const q=along(r.pts,r.acc[i]!),x=q.x-q.tz*r.outer*side,z=q.z+q.tx*r.outer*side,h=r.hs[i]!,raw=G(x,z),needs=Math.abs(raw-h+.35)*1.5/28>1/1.5;if(needs){line.push([x,z,Math.max(raw,h+.15),Math.min(raw,h-.35)]);}else flush();}flush();}}
  for(const r of runs){const id=roadInfo.get(r.chain)??0;for(const c of r.caps){if(!c)continue;const a:P2=[c.at[0]+c.t[1]*c.outer,c.at[1]-c.t[0]*c.outer],b:P2=[c.at[0]-c.t[1]*c.outer,c.at[1]+c.t[0]*c.outer],raw=G(c.at[0],c.at[1]);
    if(c.kind==='portal'){report.portals++;note(patch('portal-open','repair','cut-both-sides-of-mouth',[r.chain.id],{portals:1},{cutDepthM:Math.max(0,raw-c.h+.5)},{at:c.at,cutBackM:8,soffitM:c.h+5.5}),[id]);if(patchPolicy(opts,'portal-open','repair')!=='repair')policyErrors.push(`Portal ${r.chain.id} needs an open-mouth cut`);portalContracts.push({at:c.at,t:c.t,half:c.outer,h:c.h,id});const soffit=c.h+5.5;pieces.push({t:'wall',kind:'portal',line:[[a[0],a[1],Math.max(raw+.8,soffit+.8),soffit],[b[0],b[1],Math.max(raw+.8,soffit+.8),soffit]],info:id});
      for(const p of [a,b]){const far:P2=[p[0]+c.t[0]*8,p[1]+c.t[1]*8];pieces.push({t:'wall',kind:'retaining',line:[[p[0],p[1],soffit,c.h-.35],[far[0],far[1],G(far[0],far[1]),c.h-.35]],info:id});}
      // Cut on BOTH sides of the cover boundary. c.t points OUT of the visible run, INTO the tunnel.
      const mouth:P3[][]=[[[a[0]-c.t[0]*8,a[1]-c.t[1]*8,c.h],[b[0]-c.t[0]*8,b[1]-c.t[1]*8,c.h],[b[0]+c.t[0]*8,b[1]+c.t[1]*8,c.h],[a[0]+c.t[0]*8,a[1]+c.t[1]*8,c.h]]];clamp.cells.push(mouth);clamp.edges.push(mouth[0]!);
      for(let j=0;j<baked.nz;j++)for(let i=0;i<baked.nx;i++){const x=baked.x0+i*baked.step-c.at[0],z=baked.z0+j*baked.step-c.at[1];if(Math.abs(x*c.t[0]+z*c.t[1])<=8+baked.step&&Math.abs(-x*c.t[1]+z*c.t[0])<=c.outer+baked.step)data[j*baked.nx+i]=Math.min(data[j*baked.nx+i]!,c.h-.5);}

    }else if(r.bridge&&c.h-raw>=DECK_DEPTH){abutments++;pieces.push({t:'wall',kind:'abutment',line:[[a[0],a[1],c.h-DECK_DEPTH,raw-.5],[b[0],b[1],c.h-DECK_DEPTH,raw-.5]],info:id});}
  }}
  report.tunnels=new Set(runs.filter(r=>r.caps.some(c=>c?.kind==='portal')).map(r=>r.chain)).size;
  // The final DEM is a compact heightfield. Polygon guard contracts still guarantee clearance at finer LODs.
  clamp.terrain=baked;
  const guard=clampIndex({v:3,origin:[0,0],cells:clamp.cells.map(rs=>[rs.length,...rs.map(r=>r.length),...rs.flatMap(r=>r.flat())]),edges:clamp.edges.map(l=>l.flat())});
  // Evaluate the interior of the centimetre-quantized facets, including the
  // interpolation between terrain samples. A contract vertex alone cannot
  // establish that its carriageway remains visible.
  const composedData=new Float32Array(data),composedGrid={...baked,data:composedData};
  for(let j=0;j<baked.nz;j++)for(let i=0;i<baked.nx;i++){
    const k=j*baked.nx+i,lim=guard.limit(baked.x0+i*baked.step,baked.z0+j*baked.step,.5,14,baked.step);
    if(lim!==null)composedData[k]=Math.min(composedData[k]!,lim);
  }
  const visibleGround=(x:number,z:number)=>{
    if(x<baked.x0||z<baked.z0||x>baked.x0+(baked.nx-1)*baked.step||z>baked.z0+(baked.nz-1)*baked.step)
      return Math.min(G(x,z),guard.limit(x,z,.5,14,baked.step)??Infinity);
    return groundAt(composedGrid,x,z);
  };
  let visibility=carriagewayVisibility(pieces,visibleGround);
  const roadSurfaces=new FacetIndex(facetsOf(pieces.filter(p=>p.kind==='carriageway'&&p.t==='area')));
  const coverByPiece=new Map<Piece,typeof visibility.pieceHits>();
  for(const hit of visibility.pieceHits){const list=coverByPiece.get(hit.cover.piece)??[];list.push(hit);coverByPiece.set(hit.cover.piece,list);}
  for(const [piece,hits]of coverByPiece){
    const policy=patchPolicy(opts,'carriageway-visible','repair',[String(piece.info)]);
    if(policy==='omit'&&((piece.t==='area'&&['verge','footpath','water'].includes(piece.kind))||(piece.t==='strip'&&piece.kind==='water')||(piece.t==='box'&&piece.kind==='ramp'))){
      pieces.splice(pieces.indexOf(piece),1);
      note(patch('carriageway-visible','omit','clamp-facets-and-clip-cover',[String(piece.info)],{pieces:1,samples:hits.length},{maxCoverM:Math.max(...hits.map(h=>h.coverH-h.h))},{omittedKind:piece.kind,sourcePlanMoved:false}),[piece.info]);
      continue;
    }
    if(policy!=='repair'){policyErrors.push(`carriageway-visible ${piece.info}: policy ${policy}`);continue;}
    if((piece.t==='area'&&['verge','footpath','water'].includes(piece.kind))||(piece.t==='strip'&&piece.kind==='water')||(piece.t==='box'&&piece.kind==='ramp')){
      const source=piece.t==='area'?piece.rings.map(r=>r.map(q=>({x:Math.round(q[0]*100)/100,y:Math.round(q[1]*100)/100}))):unionD(facetsOf([piece]).map(f=>{const p=f.points.map(q=>({x:q[0],y:q[1]}));if(areaD(p)<0)p.reverse();return p;}),[],FillRule.NonZero,2);
      const xs=source.flat().map(p=>p.x),zs=source.flat().map(p=>p.y),cx=(Math.min(...xs)+Math.max(...xs))/2,cz=(Math.min(...zs)+Math.max(...zs))/2,reach=Math.max(Math.max(...xs)-Math.min(...xs),Math.max(...zs)-Math.min(...zs))/2+1;
      const cuts:PathsD=roadSurfaces.near(cx,cz,reach).map(f=>f.points.map(q=>({x:q[0],y:q[1]})));
      for(const cut of cuts)if(areaD(cut)<0)cut.reverse();
      const clipped=differenceD(source,inflatePathsD(unionD(cuts,[],FillRule.NonZero,2),.03,JoinType.Round,EndType.Polygon,2,2,.02),FillRule.NonZero,2),height=new FacetIndex(facetsOf([piece]));
      pieces.splice(pieces.indexOf(piece),1);
      for(const poly of polysOf(clipped)){
        const rings=[poly.outer,...poly.holes].map(r=>r.map(q=>[q.x,q.y,height.at(q.x,q.y)[0]?.height(q.x,q.y)??(piece.t==='box'?piece.top:piece.t==='area'?piece.rings[0]![0]![2]:piece.edges[0]![0]![2])] as P3));
        pieces.push({t:'area',kind:piece.kind,info:piece.info,rings});
        if(piece.t==='box')for(const ring of rings)pieces.push({t:'wall',kind:piece.kind,info:piece.info,line:[...ring,ring[0]!].map(q=>[q[0],q[1],q[2],Math.min(piece.at[2],visibleGround(q[0],q[1])-.1)])});
      }
      note(patch('carriageway-visible','repair','clamp-facets-and-clip-cover',[String(piece.info)],{pieces:1,samples:hits.length},{removedAreaM2:Math.max(0,source.reduce((a,p)=>a+areaD(p),0)-clipped.reduce((a,p)=>a+areaD(p),0))},{clippedKind:piece.kind,sourcePlanMoved:false}),[piece.info]);

    }
  }
  if(coverByPiece.size)visibility=carriagewayVisibility(pieces,visibleGround);
  const coverRepairs=new Map<number,{samples:number;cells:Set<number>;maxDropM:number;maxIntrusionM:number}>();
  for(let pass=0;pass<4&&visibility.counts.terrainCoverFailures;pass++){
    for(const hit of visibility.terrainHits){
      const policy=patchPolicy(opts,'carriageway-visible','repair',[String(hit.info)]);
      if(policy!=='repair'){policyErrors.push(`carriageway-visible ${hit.info}: ${policy} cannot leave an exposed road covered`);continue;}
      const change=coverRepairs.get(hit.info)??{samples:0,cells:new Set<number>(),maxDropM:0,maxIntrusionM:0};
      change.samples++;change.maxIntrusionM=Math.max(change.maxIntrusionM,hit.intrusion);
      const i=Math.floor((hit.x-baked.x0)/baked.step),j=Math.floor((hit.z-baked.z0)/baked.step);
      for(const di of [0,1])for(const dj of [0,1]){
        if(i+di<0||j+dj<0||i+di>=baked.nx||j+dj>=baked.nz)continue;
        const k=(j+dj)*baked.nx+i+di,target=hit.h-.5;
        if(composedData[k]!>target){change.cells.add(k);change.maxDropM=Math.max(change.maxDropM,composedData[k]!-target);composedData[k]=target;data[k]=Math.min(data[k]!,target);}
      }
      coverRepairs.set(hit.info,change);
    }
    visibility=carriagewayVisibility(pieces,visibleGround);
  }
  for(const [id,change]of coverRepairs)note(patch('carriageway-visible','repair','clamp-facets-and-clip-cover',[String(id)],{samples:change.samples,cells:change.cells.size},{maxDropM:change.maxDropM,beforeTerrainCoverM:change.maxIntrusionM},{verticalOnly:true,sourcePlanMoved:false,terrainCellSizeM:baked.step}),[id]);
  let terrainSamplesChecked=0,roadUnderGroundOverTol=0,maxTerrainIntrusionM=0;
  for(const rs of clamp.cells)for(const ring of rs)for(const p of ring){const lim=guard.limit(p[0],p[1],.5,14),natural=groundAt(baked,p[0],p[1]),composed=lim===null?natural:Math.min(natural,lim),intrusion=Math.max(0,composed-p[2]);terrainSamplesChecked++;maxTerrainIntrusionM=Math.max(maxTerrainIntrusionM,intrusion);if(intrusion>.4)roadUnderGroundOverTol++;}

  let maxPortalIntrusionM=0;
  for(const p of portalContracts){let blocked=false;for(const u of [-p.half,0,p.half])for(const v of [-6,0,6]){const x=p.at[0]+p.t[0]*v-p.t[1]*u,z=p.at[1]+p.t[1]*v+p.t[0]*u,lim=guard.limit(x,z,.5,14),composed=Math.min(groundAt(baked,x,z),lim??Infinity),intrusion=Math.max(0,composed-p.h);maxPortalIntrusionM=Math.max(maxPortalIntrusionM,intrusion);if(intrusion>.4)blocked=true;}if(blocked)blockedPortals++;}
  const cutRetainingWalls=pieces.filter(p=>p.t==='edge'&&p.kind==='cut'||p.t==='wall'&&p.kind==='retaining').length;
  let foundationsAdjusted=0;
  for(const piece of pieces){if(piece.t!=='box'||!['pier','ramp','portal'].includes(piece.kind)||(piece.kind==='pier'&&piece.top-piece.at[2]<=1.05))continue;let low=Infinity;const cs=Math.cos(piece.turn),sn=Math.sin(piece.turn);for(const u of [-piece.d/2,0,piece.d/2])for(const v of [-piece.w/2,0,piece.w/2]){const x=piece.at[0]+u*cs-v*sn,z=piece.at[1]+u*sn+v*cs;low=Math.min(low,groundAt(baked,x,z),guard.limit(x,z,.5,14,Math.max(terrain.step,8))??Infinity);}const foundation=low-.5;if(foundation<piece.at[2]){const drop=piece.at[2]-foundation,change=adjustments.get(piece.info)??{count:0,maxDropM:0};change.count++;change.maxDropM=Math.max(change.maxDropM,drop);adjustments.set(piece.info,change);piece.at[2]=foundation;foundationsAdjusted++;}}
  let wallBasesAdjusted=0;
  for(const piece of pieces){if(piece.t!=='wall'||!['retaining','abutment'].includes(piece.kind))continue;for(const p of piece.line){if(p[2]-p[3]<.2)continue;const bottom=Math.min(groundAt(baked,p[0],p[1]),guard.limit(p[0],p[1],.5,14,Math.max(terrain.step,8))??Infinity)-.5;if(bottom<p[3]){const change=adjustments.get(piece.info)??{count:0,maxDropM:0};change.count++;change.maxDropM=Math.max(change.maxDropM,p[3]-bottom);adjustments.set(piece.info,change);p[3]=bottom;wallBasesAdjusted++;}}}
  let skirtsAdjusted=0;
  for(const piece of pieces){if(piece.t!=='edge'||!['kerb','ramp','edge'].includes(piece.kind))continue;for(const p of piece.pts){const target=Math.min(groundAt(baked,p[0],p[1]),guard.limit(p[0],p[1],.5,14,Math.max(terrain.step,8))??Infinity);if(target<p[3]){const change=adjustments.get(piece.info)??{count:0,maxDropM:0};change.count++;change.maxDropM=Math.max(change.maxDropM,p[3]-target);adjustments.set(piece.info,change);p[3]=target;skirtsAdjusted++;}}}
  for(const [id,change]of adjustments){const policy=patchPolicy(opts,'terrain-intrusion','repair',[String(id)]);if(policy!=='repair')policyErrors.push(`Composed-ground foundation ${id} requires repair; policy ${policy}`);note(patch('terrain-intrusion',policy,'foundation-and-skirt-to-composed-ground',[String(id)],{vertices:change.count},{maxDropM:change.maxDropM},{verticalOnly:true,sourcePlanMoved:false}),[id]);}
  const abutment=abutmentEnvelope(pieces,visibleGround,opts,note);
  let abutmentCheck=abutmentEnvelope(pieces,visibleGround,opts,()=>{},false);
  // A seat that does not settle after a second pass (no carried deck footprint matches it) is omitted, recorded.
  if(abutmentCheck.counts.abutmentContainmentFailures&&patchPolicy(opts,'support-containment','repair',[])==='repair'){
    abutmentEnvelope(pieces,visibleGround,opts,note);
    const left=new Set(abutmentEnvelope(pieces,visibleGround,opts,()=>{},false).errors.map(e=>Number(/abutment (\d+)/.exec(e)?.[1])));
    for(let i=pieces.length-1;i>=0;i--){const p=pieces[i]!;if(p.t==='wall'&&p.kind==='abutment'&&left.has(p.info)){pieces.splice(i,1);abutment.counts.abutmentsOmitted=(abutment.counts.abutmentsOmitted??0)+1;}}
    for(const id of left)note(patch('support-containment','omit','omit-unseated-abutment',[String(id)],{abutments:1},{passes:2},{sourcePlanMoved:false}),[id]);
    abutmentCheck=abutmentEnvelope(pieces,visibleGround,opts,()=>{},false);
  }
  abutment.counts.abutmentContainmentFailures=abutmentCheck.counts.abutmentContainmentFailures;
  policyErrors.push(...abutment.errors,...abutmentCheck.errors);
  const structure=structureEnvelope(pieces,opts,note);
  const verified=structureEnvelope(pieces,opts,()=>{},false);
  structure.counts.structureClearanceFailures=verified.counts.structureClearanceFailures;
  policyErrors.push(...structure.errors,...verified.errors);
  let nonFinite=0;for(const h of data)if(!Number.isFinite(h))nonFinite++;
  if(maxBatterSlope>1/1.5+1e-6)oversteepSlopesUnwalled++;
  const errors:string[]=[...policyErrors];if(nonFinite||blockedPortals||oversteepSlopesUnwalled||roadUnderGroundOverTol)errors.push(`earthwork failures: heights ${nonFinite}, portals ${blockedPortals}, slopes ${oversteepSlopesUnwalled}, terrain ${roadUnderGroundOverTol}`);
  if(visibility.counts.terrainCoverFailures||visibility.counts.pieceCoverFailures)errors.push(`carriageway-visible: terrain ${visibility.counts.terrainCoverFailures}, pieces ${visibility.counts.pieceCoverFailures}; ${JSON.stringify(visibility.locations.slice(0,8))}`);
  return {gate:{stage:11,id:'earthworks-portals',name:'Roadbed cut/fill, Hermite batters, walls and open tunnel portals',ok:!errors.length,counts:{...abutment.counts,...structure.counts,...visibility.counts,lockedCells,cutCells,fillCells,retainingWalls,cutRetainingWalls,foundationsAdjusted,wallBasesAdjusted,skirtsAdjusted,abutments,portals:report.portals,blockedPortals,oversteepSlopesUnwalled,nonFinite,terrainSamplesChecked,roadUnderGroundOverTol},worst:{...abutment.worst,...structure.worst,...visibility.worst,maxCutM,maxFillM,maxBatterSlope,maxTerrainIntrusionM,maxPortalIntrusionM},locations:[...structure.conflicts.map(p=>({at:p.at as P2,ids:[p.info,p.kind,p.roadInfo,...[...roadInfo].filter(([,id])=>id===p.info||id===p.roadInfo).map(([c])=>c.name+":"+c.id)],value:p.intrusion,metric:"structure-envelope-m"})),...visibility.locations.map(p=>({at:p.at,ids:[p.info,p.kind,...[...roadInfo].filter(([,id])=>id===p.info).map(([c])=>c.name)],value:p.intrusion,metric:"carriageway-cover-m"}))],flagged:[...wallStations,...visibility.ids],errors}};
}
