import type {Piece} from '../bake-types.ts';
import {facetsOf} from '../facets.ts';
import {rejoinFacets} from '../seams.ts';
import {patch,patchPolicy,type Patch,type PatchOptions} from '../../../runtime/workers/compile/patch-policy.ts';
/** The walking facets at grade, each in its steepest direction (crossfall included), in three bands:
 *  - walkable: at most `limit` (1:12), or beside a road taking that road's grade along it (it belongs to the road);
 *  - steep: up to `bank` (1:4): kept and flagged for route design (a steep path, not a bank);
 *  - a bank: steeper than `bank`: the facet is omitted (split-at-unwalkable-grade), recorded: no path climbs straight
 *    up an embankment or a cutting's side. Elevated walkways are checked by the footbridge gate (1:14). */
export function footpathGrade(pieces:Piece[],options:PatchOptions={},note:(p:Patch,ids:number[])=>void=()=>{},limit=1/12,follow?:(x:number,z:number)=>{tx:number;tz:number;grade:number}|null,bank=1/4){
 let footpathFacetsChecked=0,footpathGradeFailures=0,footpathSteepFlagged=0,footpathFacetsOmitted=0,maxFootpathGrade=0,maxFlaggedFootpathGrade=0;
 let footpathAreaCheckedM2=0,footpathRoadGradeM2=0,footpathSteepKeptM2=0,footpathAreaOmittedM2=0;
 const flagged:number[]=[],errors:string[]=[],changes=new Map<string,{info:number;policy:'repair'|'omit';pieces:number;flaggedFacets:number;keptFacets:number}>();
 for(let i=pieces.length-1;i>=0;i--){const p=pieces[i]!;if(p.kind!=='footpath'||((p.t==='area'||p.t==='strip')&&p.overhead))continue;
  const facets=facetsOf([p]),bad=new Set();let steep=false;
  for(const f of facets){const [a,b,c]=f.points,den=(b[0]-a[0])*(c[1]-a[1])-(c[0]-a[0])*(b[1]-a[1]);if(Math.abs(den)<1e-8)continue;
   const gx=((b[2]-a[2])*(c[1]-a[1])-(c[2]-a[2])*(b[1]-a[1]))/den,gz=((b[0]-a[0])*(c[2]-a[2])-(c[0]-a[0])*(b[2]-a[2]))/den,grade=Math.hypot(gx,gz),area=Math.abs(den)/2;
   footpathFacetsChecked++;footpathAreaCheckedM2+=area;
   if(grade<=limit+.001){maxFootpathGrade=Math.max(maxFootpathGrade,grade);continue;}
   const road=follow?follow((a[0]+b[0]+c[0])/3,(a[1]+b[1]+c[1])/3):null;
   if(road&&Math.abs(gx*road.tx+gz*road.tz)<=Math.max(limit,road.grade*1.15+.01)+.001&&Math.abs(-gx*road.tz+gz*road.tx)<=limit+.001){footpathRoadGradeM2+=area;maxFootpathGrade=Math.max(maxFootpathGrade,grade);continue;}
   maxFlaggedFootpathGrade=Math.max(maxFlaggedFootpathGrade,grade);
   if(grade<=bank+.001){steep=true;footpathSteepKeptM2+=area;continue;}
   bad.add(f);footpathAreaOmittedM2+=area;
  }
  if(steep||bad.size){flagged.push(p.info);footpathSteepFlagged++;}
  if(!bad.size)continue;
  const policy=patchPolicy(options,'footpath-grade','repair',[String(p.info)]);
  if(policy==='stop'){footpathGradeFailures+=bad.size;errors.push(`footpath-grade ${p.info}: ${bad.size} unwalkable facets`);continue;}
  pieces.splice(i,1);
  if(policy==='repair')pieces.push(...rejoinFacets(facets.filter(f=>!bad.has(f)),{t:'area',kind:'footpath',info:p.info,rings:[]}));
  footpathFacetsOmitted+=policy==='omit'?facets.length:bad.size;
  const key=`${p.info}:${policy}`,change=changes.get(key)??{info:p.info,policy,pieces:0,flaggedFacets:0,keptFacets:0};change.pieces++;change.flaggedFacets+=bad.size;change.keptFacets+=policy==='omit'?0:facets.length-bad.size;changes.set(key,change);
 }
 for(const c of changes.values())note(patch('footpath-grade',c.policy,'split-at-unwalkable-grade',[String(c.info)],{pieces:c.pieces,flaggedFacets:c.flaggedFacets,keptFacets:c.keptFacets},{gradeLimit:limit,bankLimit:bank},{omittedFacets:c.flaggedFacets,sourcePlanMoved:false,reason:'path climbs a bank steeper than 1:4; no invented straight climb'}),[c.info]);
 return {counts:{footpathFacetsChecked,footpathGradeFailures,footpathSteepFlagged,footpathFacetsOmitted},worst:{maxFootpathGrade,maxFlaggedFootpathGrade,footpathAreaCheckedM2,footpathRoadGradeM2,footpathSteepKeptM2,footpathAreaOmittedM2},flagged,errors};
}
