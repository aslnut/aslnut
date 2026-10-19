// Compile-time solids against the complete triangulated road footprint, including holes.
// Segment/triangle clipping tests boundaries exactly; interiors are not reduced to centre lines.
import {differenceD,unionD,inflatePathsD,JoinType,EndType,areaD,FillRule,type PathsD} from 'clipper2-ts';
import {polysOf} from '../union.ts';
import type {Piece} from '../bake-types.ts';
import {FacetIndex,facetsOf,type Facet} from '../facets.ts';
import {patch,patchPolicy,type Patch,type PatchOptions} from '../../../runtime/workers/compile/patch-policy.ts';
export function triangleInterval(f:Facet,a:readonly number[],b:readonly number[]):[number,number]|null{
 const p=f.points;let lo=0,hi=1;
 const cross=(u:readonly number[],v:readonly number[],q:readonly number[])=>(v[0]!-u[0]!)*(q[1]!-u[1]!)-(v[1]!-u[1]!)*(q[0]!-u[0]!);
 const sign=cross(p[0],p[1],p[2])>=0?1:-1;
 for(let i=0;i<3;i++){const u=p[i]!,v=p[(i+1)%3]!,s=sign*cross(u,v,a),e=sign*cross(u,v,b),d=e-s;if(Math.abs(d)<1e-10){if(s< -1e-7)return null;}else if(d>0)lo=Math.max(lo,-s/d);else hi=Math.min(hi,-s/d);if(lo>hi+1e-8)return null;}
 return hi-lo>1e-7?[Math.max(0,lo),Math.min(1,hi)]:null;
}
type LinePoint=[number,number,number,number];
const mix=(a:readonly number[],b:readonly number[],t:number)=>a.map((v,i)=>v+(b[i]!-v)*t);
const merge=(ranges:[number,number][])=>{ranges.sort((a,b)=>a[0]-b[0]);const out:[number,number][]=[];for(const r of ranges){const last=out.at(-1);if(last&&r[0]<=last[1]+1e-7)last[1]=Math.max(last[1],r[1]);else out.push([...r]);}return out;};
const solids=new Set(['abutment','retaining','portal','pier','pier-cap','pier-cap-under','parapet','deck-side','deck-under','girder','girder-under','skirt','cut','deck','viaduct','kerb','edge','ramp-wall']);
/** Repair only walls/skirts by shortening or splitting their span. Essential overhead solids stop. */
export function structureEnvelope(pieces:Piece[],options:PatchOptions={},note:(p:Patch,ids:number[])=>void=()=>{},repair=true){
 const roads=new FacetIndex(facetsOf(pieces.filter(p=>p.kind==='carriageway')));
 let structureSamples=0,structureClearanceFailures=0,structurePiecesRepaired=0,structureSegmentsSplit=0,maxStructureIntrusionM=0;
 const errors:string[]=[],conflicts:{info:number;kind:string;roadInfo:number;at:number[];intrusion:number}[]=[];
 const blocked=(piece:Piece,a:LinePoint,b:LinePoint)=>{
  const ranges:[number,number][]=[];
  for(const f of roads.near((a[0]+b[0])/2,(a[1]+b[1])/2,Math.hypot(b[0]-a[0],b[1]-a[1])/2+.05)){
   const range=triangleInterval(f,a,b);if(!range)continue;
   // Both solid bounds and the road facet are linear: intersect their vertical inequalities.
   let [lo,hi]=range;
   const clip=(s:number,e:number)=>{const d=e-s;if(Math.abs(d)<1e-10){if(s<0)hi=-1;}else if(d>0)lo=Math.max(lo,-s/d);else hi=Math.min(hi,-s/d);};
   const ha=f.height(a[0],a[1]),hb=f.height(b[0],b[1]);

   const ownEdge=piece.t==='edge'&&!['deck','viaduct','cut'].includes(piece.kind);
   clip(a[2]-ha-(ownEdge?.4:.02),b[2]-hb-(ownEdge?.4:.02));
   clip(ha+5.5-a[3]-.02,hb+5.5-b[3]-.02);
   structureSamples++;
   if(hi-lo<1e-6)continue;
   const t=(lo+hi)/2,q=mix(a,b,t),h=f.height(q[0]!,q[1]!);
   const intrusion=h+5.5-q[3]!;maxStructureIntrusionM=Math.max(maxStructureIntrusionM,intrusion);
   ranges.push([Math.max(0,lo-.03/Math.max(.03,Math.hypot(b[0]-a[0],b[1]-a[1]))),Math.min(1,hi+.03/Math.max(.03,Math.hypot(b[0]-a[0],b[1]-a[1])))]);
   if(conflicts.length<200)conflicts.push({info:piece.info,kind:piece.kind,roadInfo:f.piece.info,at:q.slice(0,2),intrusion});
  }
  return merge(ranges);
 };
 for(let k=pieces.length-1;k>=0;k--){const piece=pieces[k]!;if(!solids.has(piece.kind))continue;
  if(piece.t==='wall'||piece.t==='edge'){
   const line:LinePoint[]=piece.t==='wall'?piece.line:piece.pts.map(q=>[q[0],q[1],q[2]+(['deck','viaduct'].includes(piece.kind)?1:['kerb','ramp'].includes(piece.kind)?.15:0),['deck','viaduct'].includes(piece.kind)?q[2]-.35:piece.kind==='cut'?q[2]-.05:Math.min(q[3],q[2])-.6]);
   const kept:typeof line[]=[],parts:number[][][]=[];let removedM=0;
   for(let i=1;i<line.length;i++){const a=line[i-1]!,b=line[i]!,cuts=blocked(piece,a,b);if(!cuts.length){parts.push([piece.t==='wall'?a:piece.pts[i-1]!,piece.t==='wall'?b:piece.pts[i]!]);continue;}
    let from=0;for(const [lo,hi]of [...cuts,[1,1] as [number,number]]){if(lo>from+1e-6){const rawA=piece.t==='wall'?a:piece.pts[i-1]!,rawB=piece.t==='wall'?b:piece.pts[i]!;parts.push([mix(rawA,rawB,from),mix(rawA,rawB,lo)]);}removedM+=(hi-lo)*Math.hypot(b[0]-a[0],b[1]-a[1]);from=Math.max(from,hi);}
   }
   if(removedM<=0)continue;
   const policy=patchPolicy(options,'structure-clearance','repair',[String(piece.info)]);
   if(!repair||policy==='stop'){structureClearanceFailures++;errors.push(`structure-clearance ${piece.kind} ${piece.info}: ${removedM.toFixed(2)} m in lower-road envelope`);continue;}
   pieces.splice(k,1);
   if(policy==='repair')for(const part of parts){if(piece.t==='wall')kept.push(part as LinePoint[]);else pieces.push({...piece,pts:part as typeof piece.pts});}
   for(const line of kept)pieces.push({...piece,t:'wall',line});
   structurePiecesRepaired++;structureSegmentsSplit+=parts.length;
   note(patch('structure-clearance',policy,'shorten-or-split-span',[String(piece.info)],{pieces:1,segments:parts.length},{removedLengthM:removedM},{kind:piece.kind,removedLengthM:removedM,clearanceM:5.5,sourcePlanMoved:false}),[piece.info]);
  }else if(piece.t==='box'){
   // Entire box footprint, including road slivers intersecting its interior.
   for(const f of facetsOf([piece]))for(const road of roads.near(f.points[0][0],f.points[0][1],piece.w+piece.d)){
    const edges=f.points.map((a,i)=>[a,f.points[(i+1)%3]!] as const);
    const hit=edges.some(([a,b])=>blocked(piece,[a[0],a[1],piece.top,piece.at[2]],[b[0],b[1],piece.top,piece.at[2]]).length)||road.points.some(q=>f.contains(q[0],q[1])&&piece.top>q[2]+.02&&piece.at[2]<q[2]+5.48);
    if(hit){structureClearanceFailures++;errors.push(`structure-clearance ${piece.kind} box ${piece.info}`);break;}
   }
  }else if(piece.kind==='deck-under'||piece.kind==='girder-under'||piece.kind==='pier-cap-under'){
   const sourceFacets=facetsOf([piece]),cuts:PathsD=[];
   for(const f of sourceFacets){const [a,b,c]=f.points,x=(a[0]+b[0]+c[0])/3,z=(a[1]+b[1]+c[1])/3,reach=Math.max(...f.points.map(q=>Math.hypot(q[0]-x,q[1]-z)));
    for(const road of roads.near(x,z,reach+.02)){
     let poly=f.points.map(q=>[q[0],q[1]]);
     const clip=(value:(p:number[])=>number)=>{const out:number[][]=[];for(let i=0;i<poly.length;i++){const a=poly[i]!,b=poly[(i+1)%poly.length]!,va=value(a),vb=value(b);if(va>=0)out.push(a);if((va>=0)!==(vb>=0))out.push(mix(a,b,va/(va-vb)));}poly=out;};
     const sign=areaD(road.points.map(q=>({x:q[0],y:q[1]})))>=0?1:-1;
     for(let i=0;i<3;i++){const a=road.points[i]!,b=road.points[(i+1)%3]!;clip(q=>sign*((b[0]-a[0])*(q[1]!-a[1])-(b[1]-a[1])*(q[0]!-a[0])));}
     clip(q=>f.height(q[0]!,q[1]!)-road.height(q[0]!,q[1]!)-.02);
     clip(q=>road.height(q[0]!,q[1]!)+5.48-f.height(q[0]!,q[1]!));
     structureSamples++;if(poly.length>=3){const path=poly.map(q=>({x:q[0]!,y:q[1]!}));if(Math.abs(areaD(path))>.0001){if(areaD(path)<0)path.reverse();cuts.push(path);}}
    }
   }
   if(!cuts.length)continue;
   const policy=patchPolicy(options,'structure-clearance','repair',[String(piece.info)]);
   if(!repair||policy==='stop'){structureClearanceFailures++;errors.push(`structure-clearance ${piece.kind} ${piece.info}: shorten span or re-solve vertical envelope`);continue;}
   const remove=inflatePathsD(unionD(cuts,[],FillRule.NonZero,2),.08,JoinType.Round,EndType.Polygon,2,2,.01);
   pieces.splice(k,1);let removedAreaM2=0;
   for(const f of sourceFacets){const source=f.points.map(q=>({x:q[0],y:q[1]}));if(areaD(source)<0)source.reverse();const shape=differenceD([source],remove,FillRule.NonZero,2);removedAreaM2+=Math.abs(areaD(source))-shape.reduce((n,p)=>n+areaD(p),0);
    if(policy==='repair')for(const poly of polysOf(shape))pieces.push({t:'area',kind:piece.kind,info:piece.info,down:true,overhead:true,rings:[poly.outer,...poly.holes].map(r=>r.map(q=>[q.x,q.y,f.height(q.x,q.y)]))});
   }

   structurePiecesRepaired++;
   note(patch('structure-clearance',policy,'shorten-or-split-span',[String(piece.info)],{pieces:1},{removedAreaM2},{kind:piece.kind,clearanceM:5.5,sourcePlanMoved:false}),[piece.info]);

  }
 }
 return {counts:{structureSamples,structureClearanceFailures,structurePiecesRepaired,structureSegmentsSplit},worst:{maxStructureIntrusionM},errors,conflicts};
}

/** Abutments must occupy the footprint of the deck they carry, seated on its final soffit. */
export function abutmentEnvelope(pieces:Piece[],ground:(x:number,z:number)=>number,options:PatchOptions={},note:(p:Patch,ids:number[])=>void=()=>{},repair=true){
 const decks=new FacetIndex(facetsOf(pieces.filter(p=>p.kind==='deck-under')));
 let abutmentSamples=0,abutmentContainmentFailures=0,abutmentsSeated=0,abutmentsOmitted=0,maxAbutmentSeatCorrectionM=0;
 const errors:string[]=[];
 for(let i=pieces.length-1;i>=0;i--){const piece=pieces[i]!;if(piece.t!=='wall'||piece.kind!=='abutment')continue;
  const out:Piece[]= [];let changed=false,shiftM=0;
  for(let j=1;j<piece.line.length;j++){
   const rawA=piece.line[j-1]!,rawB=piece.line[j]!,length=Math.hypot(rawB[0]-rawA[0],rawB[1]-rawA[1]);
   let a=rawA,b=rawB,ranges:{f:Facet;range:[number,number]}[]=[];
   const find=(a:LinePoint,b:LinePoint)=>decks.near((a[0]+b[0])/2,(a[1]+b[1])/2,length/2+3).flatMap(f=>{const range=triangleInterval(f,a,b);abutmentSamples++;return range&&Math.abs(f.height((a[0]+b[0])/2,(a[1]+b[1])/2)-Math.max(a[2],b[2]))<3?[{f,range}]:[];});
   ranges=find(a,b);
   if(!ranges.length)for(const distance of [.05,.2,.5,1,2,3,4,6,8,12,16,20,24,32]){if(ranges.length)break;for(const side of [-1,1]){const dx=(rawB[1]-rawA[1])/length*distance*side,dz=-(rawB[0]-rawA[0])/length*distance*side;a=[rawA[0]+dx,rawA[1]+dz,rawA[2],ground(rawA[0]+dx,rawA[1]+dz)-.5];b=[rawB[0]+dx,rawB[1]+dz,rawB[2],ground(rawB[0]+dx,rawB[1]+dz)-.5];ranges=find(a,b);if(ranges.length){shiftM=Math.max(shiftM,distance);changed=true;break;}}}
   const covered=merge(ranges.map(r=>r.range)),kept=covered.reduce((n,[lo,hi])=>n+hi-lo,0);
   if(kept<.999||shiftM>0)changed=true;
   for(const {f,range:[lo,hi]}of ranges){const A=mix(a,b,lo) as LinePoint,B=mix(a,b,hi) as LinePoint;
    for(const q of [A,B]){const h=f.height(q[0],q[1]),delta=Math.abs(q[2]-h);if(delta>.02)changed=true;maxAbutmentSeatCorrectionM=Math.max(maxAbutmentSeatCorrectionM,delta);q[2]=h;}
    out.push({t:'wall',kind:'abutment',info:piece.info,line:[A,B]});
   }
  }
  if(!changed)continue;
  const policy=patchPolicy(options,'support-containment','repair',[String(piece.info)]);
  if(!repair||policy==='stop'){abutmentContainmentFailures++;errors.push(`support-containment abutment ${piece.info}: no carried deck or seat mismatch`);continue;}
  // an abutment with no deck to carry anywhere near is no abutment: omitted and recorded
  if(!out.length){pieces.splice(i,1);abutmentsOmitted++;note(patch('support-containment','omit','omit-abutment-without-deck',[String(piece.info)],{abutments:1},{searchedM:32},{sourcePlanMoved:false}),[piece.info]);continue;}
  pieces.splice(i,1);if(policy==='repair')for(const p of out)pieces.push(p);abutmentsSeated++;
  note(patch('support-containment',policy,'move-under-carried-deck',[String(piece.info)],{abutments:1},{shiftM},{shiftM,seatedOnFinalSoffit:true,sourcePlanMoved:false}),[piece.info]);
 }
 return {counts:{abutmentSamples,abutmentContainmentFailures,abutmentsSeated,abutmentsOmitted},worst:{maxAbutmentSeatCorrectionM},errors};
}
