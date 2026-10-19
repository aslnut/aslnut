import type { StageGate } from '../../runtime/workers/compile/patch-policy.ts';
import { patchPolicy, patch, type Patch } from '../../runtime/workers/compile/patch-policy.ts';
// Vertical constraints are solved on the connected station graph, before any surface is built.
// Source plan coordinates stay fixed. K uses grades in percent (metres per percentage point).
import type { Station } from './sections.ts';
import { solveHeights, along } from './sections.ts';
import { distToPolylineXZ, type SolvedWater } from '../landform/terraform/hydrology.ts';
import type { Chain, SolveOptions, SolveReport } from './bake-types.ts';
export interface BankedStation extends Station { kappa?: number; bank?: number; tx?: number; ty?: number; tz?: number; rx?: number; ry?: number; rz?: number; ux?: number; uy?: number; uz?: number }
export const DECK_DEPTH = 1.8, ROAD_CLEARANCE = 5.5;
export function segHit(a:{x:number;z:number},b:{x:number;z:number},c:{x:number;z:number},d:{x:number;z:number}):{t:number;u:number}|null {
  const rx=b.x-a.x,rz=b.z-a.z,sx=d.x-c.x,sz=d.z-c.z,den=rx*sz-rz*sx;if(Math.abs(den)<1e-9)return null;
  const t=((c.x-a.x)*sz-(c.z-a.z)*sx)/den,u=((c.x-a.x)*rz-(c.z-a.z)*rx)/den;
  return t>=0&&t<=1&&u>=0&&u<=1?{t,u}:null;
}
interface Constraint { ids:number[]; weights:number[]; lo:number; hi:number }
export function runStage05Vertical(chains:readonly Chain[],jn:ReadonlySet<number>,G:(x:number,z:number)=>number,waters:readonly SolvedWater[],opts:SolveOptions={}):{st:Map<Chain,BankedStation[]>;steep:SolveReport['steep'];clearance:SolveReport['clearance'];gate:StageGate} {
  const st=new Map<Chain,BankedStation[]>();
  for(const c of chains){
    const out:BankedStation[]=[];
    // Elevation PVIs use a metric control spacing, independent of raw OSM knot density.
    // Horizontal vertices remain untouched and the emitted surface samples the profile every 4 m.
    const total=c.s[c.s.length-1]!,n=Math.max(1,Math.ceil(total/20));
    for(let j=0;j<=n;j++){
      const dist=total*j/n,q=along(c.pts,dist);let i=1;while(i<c.s.length-1&&c.s[i]!<dist)i++;
      const pp=c.point[i]!,f=(dist-c.s[i-1]!)/(c.s[i]!-c.s[i-1]!||1);
      out.push({x:q.x,z:q.z,s:dist,ground:G(q.x,q.z),h:0,bridge:pp.bridge,tunnel:pp.tunnel,layer:pp.layer,kappa:(c.kappa[i-1]??0)*(1-f)+(c.kappa[i]??0)*f});
    }
    for(const key of ['bridge','tunnel'] as const){let i=0;while(i<out.length){if(!out[i]![key]){i++;continue;}let j=i;while(j+1<out.length&&out[j+1]![key])j++;for(let k=i;k<=j;k++)out[k]!.dEnd=Math.min(i>0||!jn.has(c.a)?out[k]!.s-out[i]!.s:Infinity,j+1<out.length||!jn.has(c.b)?out[j]!.s-out[k]!.s:Infinity);i=j+1;}}
    st.set(c,out);
  }
  const roads=chains.map(c=>({stations:st.get(c)!,a:c.a,b:c.b,grade:c.prof.seedGrade}));
  const over=new Map<Station,number>();
  for(const c of chains){const s=st.get(c)!;let i=0;while(i<s.length){if(!s[i]!.bridge){i++;continue;}let j=i;while(j+1<s.length&&s[j+1]!.bridge)j++;const ya=s[Math.max(0,i-1)]!.ground,yb=s[Math.min(s.length-1,j+1)]!.ground,L=Math.max(1,s[j]!.s-s[i]!.s);for(let k=i;k<=j;k++){const p=s[k]!,f=(p.s-s[i]!.s)/L;let y=ya+(yb-ya)*f;for(const w of waters)if(distToPolylineXZ(p.x,p.z,w.pts).dist<w.halfWidth+w.bankWidth)y=Math.max(y,w.waterY+ROAD_CLEARANCE+DECK_DEPTH);over.set(p,y);}i=j+1;}}
  solveHeights(roads,{deck:l=>7.3*Math.max(1,l),smooth:80,over});
  // Shared nodes are one unknown, including connections between tagged layers.
  const values:number[]=[],index=new Map<BankedStation,number>(),nodes=new Map<number,number>(),members:BankedStation[][]=[];
  for(const c of chains){const s=st.get(c)!;for(let k=0;k<s.length;k++){const node=k===0?c.a:k===s.length-1?c.b:null;let id=node===null?undefined:nodes.get(node);if(id===undefined){id=values.length;values.push(s[k]!.h);members.push([]);if(node!==null)nodes.set(node,id);}index.set(s[k]!,id);members[id]!.push(s[k]!);}}
  for(let i=0;i<values.length;i++)values[i]=members[i]!.reduce((v,p)=>v+p.h,0)/members[i]!.length;
  const constraints:Constraint[]=[],add=(ps:BankedStation[],weights:number[],lo:number,hi:number)=>{const merged=new Map<number,number>();ps.forEach((p,i)=>{const id=index.get(p)!;merged.set(id,(merged.get(id)??0)+weights[i]!);});constraints.push({ids:[...merged.keys()],weights:[...merged.values()],lo,hi});};
  const kMin=(c:Chain)=>opts.minK??c.prof.minK;
  let pviCount=0;
  for(const c of chains){const s=st.get(c)!,grade=c.prof.maxGrade;
    for(let i=1;i<s.length;i++){const ds=s[i]!.s-s[i-1]!.s;add([s[i-1]!,s[i]!],[-1,1],-grade*ds,grade*ds);}
    for(let i=1;i+1<s.length;i++){const d1=s[i]!.s-s[i-1]!.s,d2=s[i+1]!.s-s[i]!.s,L=0.9*Math.min(d1,d2);add([s[i-1]!,s[i]!,s[i+1]!],[1/d1,-1/d1-1/d2,1/d2],-L/(110*kMin(c)),L/(110*kMin(c)));pviCount++;}
    for(const p of s){const bound=over.get(p);if(bound!==undefined)add([p],[1],bound,Infinity);}
  }
  for(const floor of opts.verticalFloors??[]){const c=chains.find(c=>c.id===floor.road);if(!c)continue;const s=st.get(c)!;let best=1,dist=Infinity;for(let i=1;i<s.length;i++){if(floor.s!==undefined){if(floor.s>=s[i-1]!.s&&floor.s<=s[i]!.s){best=i;break;}continue;}const a=s[i-1]!,b=s[i]!,dx=b.x-a.x,dz=b.z-a.z,t=Math.max(0,Math.min(1,((floor.at[0]-a.x)*dx+(floor.at[1]-a.z)*dz)/(dx*dx+dz*dz||1))),d=Math.hypot(floor.at[0]-a.x-dx*t,floor.at[1]-a.z-dz*t);if(d<dist){dist=d;best=i;}}for(const p of [s[best-1]!,s[best]!])add([p],[1],floor.minimum,Infinity);}
  const segs=chains.flatMap(c=>{const s=st.get(c)!;return s.slice(1).map((b,i)=>({c,a:s[i]!,b}));}),grid=new Map<string,typeof segs>();
  for(const sg of segs){const key=`${Math.floor((sg.a.x+sg.b.x)/100)},${Math.floor((sg.a.z+sg.b.z)/100)}`;let bin=grid.get(key);if(!bin)grid.set(key,bin=[]);bin.push(sg);}
  const crossings:{up:typeof segs[number];low:typeof segs[number];t:number;u:number;need:number}[]=[];
  for(const sg of segs){const cx=Math.floor((sg.a.x+sg.b.x)/100),cz=Math.floor((sg.a.z+sg.b.z)/100);for(let dx=-1;dx<=1;dx++)for(let dz=-1;dz<=1;dz++)for(const o of grid.get(`${cx+dx},${cz+dz}`)??[]){
    if(o.a.layer>=sg.a.layer||(o.c===sg.c&&Math.abs(o.a.s-sg.a.s)<sg.c.prof.carriageway+8))continue;
    if([sg.c.a,sg.c.b].some(n=>n===o.c.a||n===o.c.b)&&Math.min(Math.hypot(sg.a.x-o.a.x,sg.a.z-o.a.z),Math.hypot(sg.b.x-o.b.x,sg.b.z-o.b.z))<12)continue;
    const hit=segHit(sg.a,sg.b,o.a,o.b);if(!hit)continue;
    const same=new Map<number,number>();[sg.a,sg.b,o.a,o.b].forEach((p,i)=>{const weights=[1-hit.t,hit.t,-(1-hit.u),-hit.u];const id=index.get(p)!;same.set(id,(same.get(id)??0)+weights[i]!);});if([...same.values()].every(v=>Math.abs(v)<1e-6))continue;
    const need=(sg.a.layer-o.a.layer)*ROAD_CLEARANCE+DECK_DEPTH+2.0;
    crossings.push({up:sg,low:o,...hit,need});add([sg.a,sg.b,o.a,o.b],[1-hit.t,hit.t,-(1-hit.u),-hit.u],need,Infinity);
  }}
  // A crossing envelope covers the full widths of both corridors. Hold the adjacent
  // control stations above the crossing; curvature constraints spread the approach smoothly.
  let footprintConstraints=0;
  for(const x of crossings){const distance=x.up.a.s+(x.up.b.s-x.up.a.s)*x.t,reach=x.up.c.prof.carriageway/2+x.low.c.prof.carriageway/2+8;
    const px=x.up.a.x+(x.up.b.x-x.up.a.x)*x.t,pz=x.up.a.z+(x.up.b.z-x.up.a.z)*x.t;
    for(const c of chains){if(c===x.low.c||c!==x.up.c&&!c.point.some(p=>p.bridge))continue;for(const p of st.get(c)!)if(index.get(p)!==index.get(x.low.a)&&index.get(p)!==index.get(x.low.b)&&p.layer===x.up.a.layer&&Math.hypot(p.x-px,p.z-pz)<reach+c.prof.carriageway/2){add([p,x.low.a,x.low.b],[1,-(1-x.u),-x.u],x.need,Infinity);footprintConstraints++;}}
  }
  // Seed the same metric ramp envelopes before projection. This avoids asking local
  // curvature projections to drag a large connected interchange up one station at a time.
  for(const q of constraints){if(q.lo===-Infinity||q.hi!==Infinity)continue;let lower=q.lo;for(let k=0;k<q.ids.length;k++)if(q.weights[k]!<0)lower-=values[q.ids[k]!]!*q.weights[k]!;
    for(let k=0;k<q.ids.length;k++)if(q.weights[k]!>0)for(const p of members[q.ids[k]!]!)if(p.bridge)over.set(p,Math.max(over.get(p)??-Infinity,lower));
  }
  solveHeights(roads,{deck:l=>7.3*Math.max(1,l),smooth:80,over});
  for(let i=0;i<values.length;i++)values[i]=members[i]!.reduce((v,p)=>v+p.h,0)/members[i]!.length;
  // Cyclic projections onto linear grade, curvature, hydrology and clearance constraints.
  // Corrections use metric station spacing, never a fixed station-count window.
  const seeds = new Map([...index].map(([p,i])=>[p,values[i]!]));
  const patches:Patch[]=[];
  for(const x of crossings){
    const before=x.up.a.h*(1-x.t)+x.up.b.h*x.t-DECK_DEPTH-x.low.a.h*(1-x.u)-x.low.b.h*x.u;
    if(before>=ROAD_CLEARANCE)continue;
    const policy=patchPolicy(opts,'deck-clearance','repair',[x.up.c.id]);
    patches.push(patch('deck-clearance',policy,'clearance-raise',[x.up.c.id],{crossings:1},{beforeClearanceM:before},{addedClearanceConstraintM:x.need,sourcePlanMoved:false}));
  }
  const kBefore=new Map<Chain,number>();
  for(const c of chains){const src=st.get(c)!;let least=Infinity;for(let i=1;i+1<src.length;i++){
    const a=src[i-1]!,p=src[i]!,b=src[i+1]!,d1=p.s-a.s,d2=b.s-p.s;
    const delta=Math.abs((seeds.get(b)!-seeds.get(p)!)/d2-(seeds.get(p)!-seeds.get(a)!)/d1);
    if(delta>1e-10)least=Math.min(least,.9*Math.min(d1,d2)/(delta*100));
  }kBefore.set(c,least);}
  let residual=Infinity,passes=0;
  const projectConstraints=()=>{
    for(let iteration=0;iteration<200000;iteration++,passes++){
      residual=0;
      for(const q of constraints){let v=0,norm=0;for(let k=0;k<q.ids.length;k++){v+=values[q.ids[k]!]!*q.weights[k]!;norm+=q.weights[k]!**2;}const err=v<q.lo?q.lo-v:v>q.hi?q.hi-v:0;residual=Math.max(residual,Math.abs(err));if(err&&norm>1e-15)for(let k=0;k<q.ids.length;k++)values[q.ids[k]!]=values[q.ids[k]!]!+err*q.weights[k]!/norm;}
      if(residual<1e-7)break;
    }
  };
  projectConstraints();
  // Ground-following and grade preference are soft seeds, never hard limits.
  // Discard them in this order; conflicting hard envelopes still fail the gate.
  if(residual>1e-3&&patchPolicy(opts,'profile-convergence','repair',chains.map(c=>c.id))==='repair'){
    const before=residual;
    for(const target of ['ground-following','grade-preference'] as const){
      if(target==='ground-following'){
        const straight=new Map<BankedStation,number>();
        for(const c of chains){const stations=st.get(c)!,first=stations[0]!,last=stations[stations.length-1]!;for(const p of stations)straight.set(p,first.h+(last.h-first.h)*p.s/(last.s||1));}
        for(let i=0;i<values.length;i++)values[i]=members[i]!.reduce((sum,p)=>sum+(p.bridge?(over.get(p)??straight.get(p)!):straight.get(p)!),0)/members[i]!.length;
      }
      else{const mean=values.reduce((sum,y)=>sum+y,0)/(values.length||1);values.fill(mean);}
      projectConstraints();
      patches.push(patch('profile-convergence','repair','relax-in-order',chains.map(c=>c.id),{attempts:1},{beforeResidual:before,afterResidual:residual},{droppedSoftTarget:target,sourcePlanMoved:false}));
      if(residual<=1e-3)break;
    }
  }
  for(const [p,i] of index)p.h=values[i]!;
  for(const c of chains){const before=kBefore.get(c)!;if(before<kMin(c)-.01){
    const src=st.get(c)!,maxHeightDeltaM=Math.max(...src.map(p=>Math.abs(p.h-seeds.get(p)!)));
    const policy=patchPolicy(opts,'k-value','repair',[c.id]);
    patches.push(patch('k-value',policy,'curve-lengthen',[c.id],{profiles:1},{beforeK:before,maxHeightDeltaM},{verticalOnly:true,sourcePlanMoved:false}));
  }}
  // Round each PVI with the spec's quadratic, tangent to the neighbouring grades.
  let minK=Infinity,maxGrade=0,kViolations=0,gradeViolations=0,curvesBuilt=0;const steep:SolveReport["steep"]=[];const designFlags=new Set<string>();
  for(const c of chains){const src=st.get(c)!,curves:{s0:number;s1:number;y0:number;g0:number;a:number}[]=[];
    for(let i=1;i+1<src.length;i++){
      const p=src[i]!,a=src[i-1]!,b=src[i+1]!,g0=(p.h-a.h)/(p.s-a.s),g1=(b.h-p.h)/(b.s-p.s),L=.9*Math.min(p.s-a.s,b.s-p.s);
      if(Math.abs(g1-g0)>1e-10){const K=L/(Math.abs(g1-g0)*100);minK=Math.min(minK,K);if(K<kMin(c)-.01){kViolations++;designFlags.add(c.id);}curvesBuilt++;curves.push({s0:p.s-L/2,s1:p.s+L/2,y0:p.h-g0*L/2,g0,a:(g1-g0)/(2*L)});}
      maxGrade=Math.max(maxGrade,Math.abs(g0),Math.abs(g1));if(Math.abs(g0)>c.prof.desirableGrade+1e-4){steep.push({at:[p.x,p.z],grade:Math.abs(g0),road:c.id});designFlags.add(c.id);}const limit=c.prof.maxGrade;if(Math.abs(g0)>limit+1e-4||Math.abs(g1)>limit+1e-4){gradeViolations++;designFlags.add(c.id);}
    }
    const out:BankedStation[]=[];
    for(const p of src){const curve=curves.find(q=>p.s>=q.s0&&p.s<=q.s1);out.push({...p,h:curve?curve.y0+curve.g0*(p.s-curve.s0)+curve.a*(p.s-curve.s0)**2:p.h});}
    for(let i=1;i<src.length;i++){const a=src[i-1]!,b=src[i]!,n=Math.ceil((b.s-a.s)/4);for(let j=1;j<n;j++){const dist=a.s+(b.s-a.s)*j/n,q=along(c.pts,dist),curve=curves.find(c=>dist>=c.s0&&dist<=c.s1);out.push({...a,x:q.x,z:q.z,s:dist,h:curve?curve.y0+curve.g0*(dist-curve.s0)+curve.a*(dist-curve.s0)**2:a.h+(b.h-a.h)*j/n});}}
    // Keep PVC/PVT samples so interpolation never cuts across a quadratic's tangent limits.
    for(const q of curves)for(const s0 of [q.s0,q.s1]){let i=1;while(i<src.length&&src[i]!.s<s0)i++;const a=src[i-1]!,b=src[i]!,f=(s0-a.s)/(b.s-a.s);const plan=along(c.pts,s0);out.push({...a,x:plan.x,z:plan.z,s:s0,h:q.y0+q.g0*(s0-q.s0)+q.a*(s0-q.s0)**2,kappa:(a.kappa??0)+((b.kappa??0)-(a.kappa??0))*f});}
    out.sort((a,b)=>a.s-b.s);st.set(c,out);
  }
  const clearance:SolveReport['clearance']={least:null,short:[]};
  for(const x of crossings){const sU=st.get(x.up.c)!,sL=st.get(x.low.c)!,hAt=(s:BankedStation[],v:number)=>{let i=1;while(i<s.length&&s[i]!.s<v)i++;const a=s[i-1]!,b=s[Math.min(i,s.length-1)]!;return a.h+(b.h-a.h)*(v-a.s)/(b.s-a.s||1);};const clear=hAt(sU,x.up.a.s+(x.up.b.s-x.up.a.s)*x.t)-DECK_DEPTH-hAt(sL,x.low.a.s+(x.low.b.s-x.low.a.s)*x.u);clearance.least=Math.min(clearance.least??Infinity,clear);if(clear<ROAD_CLEARANCE-1e-4)clearance.short.push({at:[x.up.a.x,x.up.a.z],clear,over:x.up.c.name,under:x.low.c.name});}
  const errors:string[]=patches.filter(p=>p.policy!=='repair').map(p=>`${p.check} repair required for ${p.ids.join(' ')}; policy ${p.policy}`);if(kViolations||gradeViolations)errors.push(`Design limits: K ${kViolations}, grade ${gradeViolations}`);if(residual>1e-3)errors.push(`vertical solver did not converge: residual ${residual}`);if(clearance.short.length)errors.push(`${clearance.short.length} crossings below ${ROAD_CLEARANCE} m`);if(Number.isFinite(minK)&&minK<Math.min(opts.minK??8,8)-0.01)errors.push(`K ${minK} below limit`);
  return {st,steep,clearance,gate:{patches,stage:5,id:'vertical-alignment',name:'Connected grade constraints and tangent parabolic PVI curves',ok:!errors.length,counts:{stations:index.size,seedSmoothingM:80,repairPasses:opts.repairPass??0,verticalFloorConstraints:opts.verticalFloors?.length??0,crossingsChecked:crossings.length,footprintConstraints,shortClearances:clearance.short.length,pviCount:curvesBuilt,kConstraints:pviCount,kViolations,gradeViolations,solverPasses:passes,steepReported:steep.length},worst:{leastClearanceM:clearance.least??0,minKValue:Number.isFinite(minK)?minK:0,maxGradePct:maxGrade*100,residual},flagged:[...designFlags,...clearance.short.map(x=>x.over)],errors}};
}
export function runStage06Banking(chains:readonly Chain[],st:Map<Chain,BankedStation[]>,opts:SolveOptions={}):{gate:StageGate}{
  let framesComputed=0,bankedSections=0,invertedNormals=0,maxBankDeg=0,maxRollRateDegPerM=0,maxFrameError=0;
  for(const c of chains){const s=st.get(c)!,L=s[s.length-1]!.s;let prev=0;
    for(let i=0;i<s.length;i++){const p=s[i]!,a=s[Math.max(0,i-1)]!,b=s[Math.min(s.length-1,i+1)]!,dx=b.x-a.x,dy=b.h-a.h,dz=b.z-a.z,l=Math.hypot(dx,dy,dz)||1,tx=dx/l,ty=dy/l,tz=dz/l,hl=Math.hypot(tx,tz)||1,rx=-tz/hl,rz=tx/hl,ux=-rz*ty,uy=rz*tx-rx*tz,uz=rx*ty;
      // Unset banking costs no roll. Enabled high-speed roads get eased roll with a metric rate limit.
      const d=Math.min(p.s,L-p.s),t=Math.min(1,Math.max(0,d/30)),env=t*t*(3-2*t),v=c.speed/3.6;
      let bank=opts.banking&&c.prof.bankable&&!c.ring?env*Math.max(-.07,Math.min(.07,Math.atan((p.kappa??0)*v*v/9.81))):0;
      if(i){const rate=.002*(p.s-s[i-1]!.s);bank=Math.max(prev-rate,Math.min(prev+rate,bank));}prev=bank;
      const cs=Math.cos(bank),sn=Math.sin(bank);Object.assign(p,{tx,ty,tz,rx:rx*cs-ux*sn,ry:-uy*sn,rz:rz*cs-uz*sn,ux:ux*cs+rx*sn,uy:uy*cs,uz:uz*cs+rz*sn});if(opts.banking)p.bank=bank;
      const err=Math.max(Math.abs(tx*p.rx!+ty*p.ry!+tz*p.rz!),Math.abs(Math.hypot(p.rx!,p.ry!,p.rz!)-1),Math.abs(Math.hypot(p.ux!,p.uy!,p.uz!)-1));maxFrameError=Math.max(maxFrameError,err);if(p.uy!<=0)invertedNormals++;
      framesComputed++;if(Math.abs(bank)>1e-6)bankedSections++;maxBankDeg=Math.max(maxBankDeg,Math.abs(bank)*180/Math.PI);if(i)maxRollRateDegPerM=Math.max(maxRollRateDegPerM,Math.abs(bank-(s[i-1]!.bank??0))*180/Math.PI/(p.s-s[i-1]!.s));
    }
  }
  const errors:string[]=[];if(invertedNormals||maxFrameError>1e-6)errors.push(`invalid frames: normals ${invertedNormals}, orthogonality ${maxFrameError}`);
  return {gate:{stage:6,id:'frame-banking',name:'Upward orthonormal corridor frames and optional eased roll',ok:!errors.length,counts:{framesComputed,bankedSections,invertedNormals},worst:{maxBankDeg,maxRollRateDegPerM,maxFrameError},flagged:[],errors}};
}
