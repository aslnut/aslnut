import { patchPolicy, patch, type Patch } from '../../runtime/workers/compile/patch-policy.ts';
// Separate mapped footways are immutable. Derived connectors terminate at the outer assembly,
// and ground polygons are clipped to the final road unions rather than moving surveyed geometry.
import { inflatePathsD, unionD, differenceD, intersectD, areaD, JoinType, EndType, FillRule, type PathsD } from 'clipper2-ts';
import { cellsOf, Grid, Region, type WalkLine } from './union.ts';
import type { P2 } from './graph.ts';
import type { BakePath, Piece, P3, ClampOut, SolveOptions } from './bake-types.ts';
import { hRun, type RunForStructures } from './structures/piers.ts';
import { footbridges } from './structures/footbridges.ts';
import type { SolvedWater } from '../landform/terraform/hydrology.ts';
/** a polyline between two distances along it */
const slice=(pts:readonly P2[],a:number,b:number):P2[]=>{const out:P2[]=[];let acc=0;for(let i=1;i<pts.length;i++){const p=pts[i-1]!,q=pts[i]!,L=Math.hypot(q[0]-p[0],q[1]-p[1]);const at=(d:number):P2=>{const t=L?Math.max(0,Math.min(1,(d-acc)/L)):0;return [p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t];};if(acc+L>=a&&acc<=b){if(!out.length)out.push(at(a));if(acc+L<=b)out.push(q);else{out.push(at(b));break;}}acc+=L;}return out;};
import type { StageGate } from '../../runtime/workers/compile/patch-policy.ts';
const buffer=(pts:P2[],w:number):PathsD=>inflatePathsD([pts.map(p=>({x:p[0],y:p[1]}))],w,JoinType.Round,EndType.Round,2,2,.08);
type Near = {r:RunForStructures;x:number;z:number;tx:number;tz:number;s:number;d:number;side:number};
const singles=new WeakMap<RunForStructures,readonly RunForStructures[]>();
const oneRun=(r:RunForStructures)=>{let a=singles.get(r);if(!a){a=[r];singles.set(r,a);}return a;};
const indexes=new WeakMap<readonly RunForStructures[],Grid<{r:RunForStructures;i:number}>>();
const nearest=(runs:readonly RunForStructures[],x:number,z:number,groundOnly=false):Near|null=>{
  let grid=indexes.get(runs);if(!grid){grid=new Grid(40);for(const r of runs)for(let i=1;i<r.pts.length;i++){const a=r.pts[i-1]!,b=r.pts[i]!;grid.add(Math.min(a[0],b[0])-40,Math.min(a[1],b[1])-40,Math.max(a[0],b[0])+40,Math.max(a[1],b[1])+40,{r,i});}indexes.set(runs,grid);}
  let best:Near|null=null;
  for(const {r,i} of grid.near(x,z)){if(groundOnly&&((r.baseLevel??r.level)!==0||r.bridge))continue;const a=r.pts[i-1]!,b=r.pts[i]!,dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz)||1,f=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(L*L))),px=a[0]+f*dx,pz=a[1]+f*dz,d=Math.hypot(px-x,pz-z);if(!best||d<best.d)best={r,x:px,z:pz,tx:dx/L,tz:dz/L,s:r.acc[i-1]!+f*L,d,side:(x-px)*-dz+(z-pz)*dx>=0?1:-1};}
  return best;
};
export function runStage09Footways(paths:readonly BakePath[],runs:readonly RunForStructures[],regions:ReadonlyMap<number,Region>,G:(x:number,z:number)=>number,info:(kind:string,props:Record<string,unknown>)=>number,pieces:Piece[],clamp:ClampOut,walk:WalkLine[],opts:SolveOptions={},note:(change:Patch,ids?:number[])=>void=()=>{},groundRegion:Region|undefined=regions.get(0),surfaceHeight?:(x:number,z:number)=>number,waters:readonly SolvedWater[]=[]):{gate:StageGate}{
  let groundPaths=0,elevatedPaths=0,endpointLinks=0,roadIntrusionsFlagged=0,clearanceFailures=0,infillPolygons=0;let leastFootbridgeClearanceM=Infinity;
  const groundChanges:Patch[]=[];
  const sourceIds:(string|number)[]=[];
  const owners=new Grid<{a:P2;b:P2;id:number}>(50);
  const own=(pts:P2[],id:number)=>{for(let i=1;i<pts.length;i++){const a=pts[i-1]!,b=pts[i]!;owners.add(Math.min(a[0],b[0])-25,Math.min(a[1],b[1])-25,Math.max(a[0],b[0])+25,Math.max(a[1],b[1])+25,{a,b,id});}};
  const ownerAt=(x:number,z:number,fallback:number)=>{let best=fallback,distance=Infinity;for(const p of owners.near(x,z,25)){const dx=p.b[0]-p.a[0],dz=p.b[1]-p.a[1],t=Math.max(0,Math.min(1,((x-p.a[0])*dx+(z-p.a[1])*dz)/(dx*dx+dz*dz||1))),d=Math.hypot(x-p.a[0]-t*dx,z-p.a[1]-t*dz);if(d<distance){distance=d;best=p.id;}}return best;};
  const flagged:(string|number)[]=[],errors:string[]=[],groundPolys:PathsD=[],infill:PathsD=[];
  const occupied=pieces.filter((p):p is Extract<Piece,{t:'area'}>=>p.t==='area'&&p.kind==='footpath').flatMap(p=>p.rings.map(r=>r.map(q=>({x:q[0],y:q[1]}))));
  const footpathRegion=new Region(cellsOf(unionD(occupied,[],FillRule.NonZero,2)));
  const roadPolys:PathsD=[];for(const [,ps]of groundRegion?.cells??[])for(const p of ps)roadPolys.push(p.outer,...p.holes);
  const groundRoad=unionD(roadPolys,[],FillRule.NonZero,2);
  // Audit each source against only nearby union cells; a whole-city union per path is quadratic.
  const roadIndex=new Grid<PathsD>(100);
  for(const [,ps]of groundRegion?.cells??[])for(const p of ps){const xs=p.outer.map(q=>q.x),zs=p.outer.map(q=>q.y);roadIndex.add(Math.min(...xs),Math.min(...zs),Math.max(...xs),Math.max(...zs),[p.outer,...p.holes]);}
  // Elevated walkways first: their decks, and the mapped ground approaches lifted onto ramps (built there, not here).
  const walkHeight=(x:number,z:number)=>{const n=nearest(runs,x,z,true);return n&&n.d<n.r.outer+18?(surfaceHeight?.(x,z)??hRun(n.r,n.s))+.18+Math.min(.4,.02*Math.max(0,n.d-n.r.outer)):G(x,z)+.18;};
  const bridges=footbridges(paths,runs,regions,G,walkHeight,info,pieces,walk,waters,opts,note);
  elevatedPaths=bridges.counts.elevatedPaths??0;clearanceFailures=bridges.counts.clearanceFailures??0;leastFootbridgeClearanceM=bridges.worst.leastFootbridgeClearanceM||Infinity;errors.push(...bridges.errors);flagged.push(...bridges.flagged);
  for(const mapped of paths){if(mapped.pts.length<2||mapped.steps||mapped.elevated)continue;
    // a mapped approach lifted onto a ramp keeps only its part at grade here
    let path=mapped;const cut=bridges.lifted.get(mapped);
    if(cut){const L=mapped.pts.reduce((v,p,i)=>i?v+Math.hypot(p[0]-mapped.pts[i-1]![0],p[1]-mapped.pts[i-1]![1]):0,0);if(cut[0]+cut[1]>=L-.5)continue;path={...mapped,pts:slice(mapped.pts,cut[0],L-cut[1])};}
    const width=Math.max(.7,Math.min(6,path.width??1.5)),id=info('footpath',{...path.props});
    if(path.sidewalk||path.crossing)continue;
    groundPaths++;
    const source = buffer(path.pts,width/2),points=source.flat(),xs=points.map(q=>q.x),zs=points.map(q=>q.y),x0=Math.min(...xs),x1=Math.max(...xs),z0=Math.min(...zs),z1=Math.max(...zs),localRoad=unionD(roadIndex.near((x0+x1)/2,(z0+z1)/2,Math.max(x1-x0,z1-z0)/2+1).flat(),[],FillRule.NonZero,2),overlap = intersectD(source, localRoad, FillRule.NonZero, 2).reduce((v,p)=>v+Math.abs(areaD(p)),0);
    sourceIds.push(path.id ?? id);
    if(overlap > .1) {
      const policy = patchPolicy(opts, 'path-clip', 'repair',[path.id]);
      const change = patch('path-clip', policy, 'path-clip', [path.id ?? id], {paths:1}, {clippedAreaM2:overlap}, {removedSurfaceAreaM2:overlap,sourcePlanMoved:false});
      groundChanges.push(change);note(change,[id]);
      if(policy==='stop')errors.push(`Path ${path.id ?? id} requires ${overlap} m² clipping`);
      if(policy==='omit'){for(let k=walk.length-1;k>=0;k--)if(walk[k]!.pts===mapped.pts)walk.splice(k,1);continue;}
    }
    const remainder=differenceD(source,localRoad,FillRule.NonZero,2).reduce((sum,p)=>sum+areaD(p),0);
    if(overlap>.1&&remainder<1){
      note(patch('path-clip','omit','path-clip',[path.id],{paths:1},{remainingAreaM2:Math.max(0,remainder)},{removedSurfaceAreaM2:overlap,sourcePlanMoved:false}),[id]);
      for(let k=walk.length-1;k>=0;k--)if(walk[k]!.pts===mapped.pts)walk.splice(k,1);
      continue;
    }
    groundPolys.push(...source);own(path.pts,id);
    for(const p of path.pts)if(groundRegion?.has(p[0],p[1])){roadIntrusionsFlagged++;flagged.push(path.id??id);}
    for(const i of [0,path.pts.length-1]){
      const p=path.pts[i]!,n=nearest(runs,p[0],p[1],true);
      // A derived link is needed at an intrusive/kerb endpoint. An endpoint
      // already behind the kerb must not grow a perpendicular spur.
      if(!n||(!groundRegion?.has(p[0],p[1])&&n.d>n.r.outer+.5))continue;
      let edge:P2|null=null;
      for(let off=n.r.outer;off<=n.r.outer+10;off+=.25){
        const q:P2=[n.x-n.tz*n.side*off,n.z+n.tx*n.side*off];
        if(!groundRegion?.has(q[0],q[1])&&footpathRegion.has(q[0],q[1])){edge=q;break;}
      }
      if(edge){walk.push({pts:[p,edge],kind:'link'});groundPolys.push(...buffer([p,edge],width/2));own([p,edge],id);endpointLinks++;}
    }
    // Variable-width infill only for approximately parallel segments within the stated envelope.
    for(let i=1;i<path.pts.length;i++){const a=path.pts[i-1]!,b=path.pts[i]!,na=nearest(runs,a[0],a[1],true),nb=nearest(runs,b[0],b[1],true),L=Math.hypot(b[0]-a[0],b[1]-a[1]);if(!na||!nb||na.r!==nb.r||na.side!==nb.side||na.d-na.r.outer<1.5||nb.d-nb.r.outer<1.5||na.d-na.r.outer>18||nb.d-nb.r.outer>18||L<.5)continue;if(Math.abs((b[0]-a[0])*na.tx+(b[1]-a[1])*na.tz)/L<.9)continue;
      const pa={x:na.x-na.tz*na.side*na.r.outer,y:na.z+na.tx*na.side*na.r.outer},pb={x:nb.x-nb.tz*nb.side*nb.r.outer,y:nb.z+nb.tx*nb.side*nb.r.outer};const ring=[pa,pb,{x:b[0]+nb.tz*nb.side*width/2,y:b[1]-nb.tx*nb.side*width/2},{x:a[0]+na.tz*na.side*width/2,y:a[1]-na.tx*na.side*width/2}];if(areaD(ring)<0)ring.reverse();infill.push(ring);
    }
  }
  const pathUnion=differenceD(unionD(groundPolys,[],FillRule.NonZero,2),unionD([...inflatePathsD(groundRoad,.05,JoinType.Round,EndType.Polygon,2,2,.08),...occupied],[],FillRule.NonZero,2),FillRule.NonZero,2);
  // Generated nature strips yield to mapped paths. Clip each stored polygon so the render output
  // and the gate see the same surfaces, including the newly added separate paths.
  const pathsIndex=new Grid<PathsD>(100);for(const [,ps] of cellsOf(pathUnion,100))for(const p of ps){const xs=p.outer.map(q=>q.x),ys=p.outer.map(q=>q.y);pathsIndex.add(Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys),[p.outer,...p.holes]);}
  for(let k=pieces.length-1;k>=0;k--){const piece=pieces[k]!;if(piece.t!=='area'||piece.kind!=='verge')continue;const source=piece.rings.map(r=>r.map(q=>({x:q[0],y:q[1]}))),ring=source[0]!,cx=ring.reduce((v,q)=>v+q.x,0)/ring.length,cz=ring.reduce((v,q)=>v+q.y,0)/ring.length,near=pathsIndex.near(cx,cz,80).flat();if(!near.length)continue;const clipped=differenceD(source,unionD(near,[],FillRule.NonZero,2),FillRule.NonZero,2),h=(x:number,z:number)=>{const n=nearest(runs,x,z,true);return n?(surfaceHeight?.(x,z)??hRun(n.r,n.s))+.18+Math.min(.4,.02*Math.max(0,n.d-n.r.outer)):G(x,z)+.18;};pieces.splice(k,1);for(const [,ps]of cellsOf(clipped,50))for(const p of ps)pieces.push({...piece,rings:[p.outer,...p.holes].map(r=>r.map(q=>[q.x,q.y,h(q.x,q.y)]))});}
  const otherVerge=pieces.filter((p):p is Extract<Piece,{t:'area'}>=>p.t==='area'&&p.kind==='verge').flatMap(p=>p.rings.map(r=>r.map(q=>({x:q[0],y:q[1]}))));
  // (the infill is clipped by only what lies near it, unioned by the clip's own fill rule: a whole-place union of every
  // road, path and strip is not needed and can stall)
  const infillU=unionD(infill,[],FillRule.NonZero,2),infillGrid=new Grid<boolean>(50);
  for(const p of infillU){const xs=p.map(q=>q.x),ys=p.map(q=>q.y);infillGrid.add(Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys),true);}
  const nearInfill=(p:PathsD[number])=>{if(!p.length)return false;let x0=Infinity,x1=-Infinity,y0=Infinity,y1=-Infinity;for(const q of p){x0=Math.min(x0,q.x);x1=Math.max(x1,q.x);y0=Math.min(y0,q.y);y1=Math.max(y1,q.y);}return infillGrid.near((x0+x1)/2,(y0+y1)/2,Math.max(x1-x0,y1-y0)/2+1).length>0;};
  const turf=infillU.length?differenceD(infillU,[...groundRoad,...occupied,...pathUnion,...otherVerge].filter(nearInfill),FillRule.NonZero,2):[];
  const fid=info('footpath',{source:'Derived outer-edge link'}),nid=info('nature strip',{source:'Stage 09 parallel footway infill'});
  for(const [polys,kind,id]of [[pathUnion,'footpath',fid],[turf,'verge',nid]] as const)for(const [,ps]of cellsOf(polys,20))for(const p of ps){if(areaD(p.outer)<(kind==='footpath'?1:2))continue;const rings=[p.outer,...p.holes].map(r=>r.map(q=>{const n=nearest(runs,q.x,q.y,true),near=n&&n.d<n.r.outer+18;return [q.x,q.y,near?(surfaceHeight?.(q.x,q.y)??hRun(n.r,n.s))+.18+Math.min(.4,.02*Math.max(0,n.d-n.r.outer)):G(q.x,q.y)+.18] as P3;}));const cx=p.outer.reduce((v,q)=>v+q.x,0)/p.outer.length,cz=p.outer.reduce((v,q)=>v+q.y,0)/p.outer.length;pieces.push({t:'area',kind,rings,info:kind==='footpath'?ownerAt(cx,cz,id):id});clamp.cells.push(rings.map(r=>r.map(q=>[q[0],q[1],q[2]-.15])));if(kind==='verge')infillPolygons++;}
  const roadOverlapM2=intersectD(pathUnion,groundRoad,FillRule.NonZero,2).reduce((v,p)=>v+Math.abs(areaD(p)),0);if(roadOverlapM2>.1)errors.push(`Separate path road overlap ${roadOverlapM2} m²`);if(clearanceFailures)errors.push(`${clearanceFailures} footbridge samples below clearance`);
  return {gate:{stage:9,id:'hybrid-footways',name:'Measured footways, outer-edge links and overpass access',ok:!errors.length,counts:{...bridges.counts,groundPaths,elevatedPaths,endpointLinks,roadIntrusionsFlagged,clearanceFailures,infillPolygons},worst:{...bridges.worst,leastFootbridgeClearanceM:Number.isFinite(leastFootbridgeClearanceM)?leastFootbridgeClearanceM:0,roadOverlapM2},flagged:[...new Set(flagged)],errors}};
}
