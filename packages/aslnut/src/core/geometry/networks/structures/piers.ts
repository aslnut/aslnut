import type { StageGate } from '../../../runtime/workers/compile/patch-policy.ts';
import { patchPolicy, patch, type Patch } from '../../../runtime/workers/compile/patch-policy.ts';
// Structural candidates are checked against the final union at EVERY lower level.
import type { P2 } from '../graph.ts';
import { along } from '../sections.ts';
import { distToPolylineXZ, type SolvedWater } from '../../landform/terraform/hydrology.ts';
import { DECK_DEPTH, ROAD_CLEARANCE } from '../vertical.ts';
import type { Chain, ClampOut, Ground, P3, Piece, SolveOptions, SolveReport } from '../bake-types.ts';
import { groundAt } from '../../landform/compose/ground.ts';
import { clampIndex } from '../clamp-index.ts';
import { Grid, type Region } from '../union.ts';
export interface RunForStructures {baseLevel?:number;chain:Chain;level:number;bridge:boolean;pts:P2[];hs:number[];acc:number[];half:number;outer:number;caps:({at:P2;t:P2;outer:number;h:number;kind:'level'|'portal';level:number}|null)[]}
export function hRun(r:RunForStructures,d:number):number{for(let i=1;i<r.acc.length;i++)if(r.acc[i]!>=d){const f=(d-r.acc[i-1]!)/(r.acc[i]!-r.acc[i-1]!||1);return r.hs[i-1]!+(r.hs[i]!-r.hs[i-1]!)*f;}return r.hs[r.hs.length-1]!;}
const project=(r:RunForStructures,x:number,z:number)=>{let best={x:0,z:0,tx:1,tz:0,d:Infinity,s:0};for(let i=1;i<r.pts.length;i++){const a=r.pts[i-1]!,b=r.pts[i]!,dx=b[0]-a[0],dz=b[1]-a[1],L=Math.hypot(dx,dz),f=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(L*L||1))),px=a[0]+f*dx,pz=a[1]+f*dz,d=Math.hypot(x-px,z-pz);if(d<best.d)best={x:px,z:pz,tx:dx/(L||1),tz:dz/(L||1),d,s:r.acc[i-1]!+L*f};}return best;};
export function runStage10Piers(runs:readonly RunForStructures[],regions:ReadonlyMap<number,Region>,waters:readonly SolvedWater[],G:(x:number,z:number)=>number,roadInfo:ReadonlyMap<Chain,number>,pieces:Piece[],report:SolveReport,opts:SolveOptions={},note:(change:Patch,ids?:number[])=>void=()=>{},surfaceHeight?:(level:number,x:number,z:number)=>number,deckContains?:(level:number,x:number,z:number)=>boolean):{gate:StageGate}{
  const counts={totalPiers:0,hammerheadCount:0,shiftedCount:0,spanSkips:0,medianPiers:0,cantileverCPiers:0,portalBents:0,customSpanExclusions:0,pierRoadCollisions:0,pierWaterCollisions:0,capContactFailures:0,capFootprintSamples:0,capRejectedCandidates:0,supportContainmentFailures:0,supportHeightFailures:0,supportFootprintSamples:0,supportRejectedCandidates:0};
  const columns:{x:number;z:number;level:number;turn:number;w:number;d:number;top:number}[]=[],flagged:(string|number)[]=[],errors:string[]=[];let maxSpanM=0,maxCapGapM=0,maxCapHeightCorrectionM=0;
  const hits=(level:number,x:number,z:number,turn:number,w=1.5,d=1.9,below=-Infinity)=>{
    const cs=Math.cos(turn),sn=Math.sin(turn);
    // Test the whole rectangular footprint on a 0.25 m lattice, plus 0.4 m protection.
    for(let u=-d/2-.4;u<=d/2+.401;u+=.25)for(let v=-w/2-.4;v<=w/2+.401;v+=.25){const px=x+u*cs-v*sn,pz=z+u*sn+v*cs;for(const [lv,reg]of regions)if(reg.has(px,pz)&&(lv<level||(below>-Infinity&&surfaceHeight&&surfaceHeight(lv,px,pz)<=below)))return true;}
    return false;
  };
  const wet=(x:number,z:number)=>waters.some(w=>distToPolylineXZ(x,z,w.pts).dist<w.halfWidth+1.5);
  const counted=new Set<Chain>();
  for(const r of runs){if(!r.bridge)continue;if(!counted.has(r.chain)){counted.add(r.chain);report.bridges++;}const L=r.acc[r.acc.length-1]!,id=roadInfo.get(r.chain)??0,supports=[0];
    const n=Math.floor(L/34),lower=runs.filter(l=>l.level<r.level);
    const nearest=(x:number,z:number)=>{let best:{r:RunForStructures;q:ReturnType<typeof project>}|null=null;for(const l of lower){const q=project(l,x,z);if(q.d<l.outer+2.4&&(!best||q.d-l.outer<best.q.d-best.r.outer))best={r:l,q};}return best;};
    let deckRejected=false;
    const rejectDeck=()=>{deckRejected=true;counts.supportRejectedCandidates++;if(patchPolicy(opts,'support-containment','repair',[r.chain.id])==='stop')errors.push(`Support ${r.chain.id} outside its carried deck; policy stop`);return false;};
    const emit=(s:number,cols:P2[],origin:P2,axis:P2)=>{
      const nominal=hRun(r,s)-DECK_DEPTH,top=(surfaceHeight?.(r.level,origin[0],origin[1])??hRun(r,s))-DECK_DEPTH,turn=Math.atan2(axis[1],axis[0]),capH=.85;
      maxCapHeightCorrectionM=Math.max(maxCapHeightCorrectionM,Math.abs(top-nominal));
      const seat=(x:number,z:number)=>(surfaceHeight?.(r.level,x,z)??top+DECK_DEPTH)-DECK_DEPTH;
      // A support cannot invent a deck outside the published upper footprint.
      if(deckContains&&cols.some(([x,z])=>[-.95,0,.95].some(u=>[-.75,0,.75].some(v=>{counts.supportFootprintSamples++;return !deckContains(r.level,x+u*Math.cos(turn)-v*Math.sin(turn),z+u*Math.sin(turn)+v*Math.cos(turn));}))))return rejectDeck();
      if(cols.some(([x,z])=>seat(x,z)-G(x,z)<1.7||hits(r.level,x,z,turn,1.5,1.9,seat(x,z)-capH+.1)||wet(x,z)))return false;
      // Cross-beams must also leave headroom above the lower road, not only columns outside it.
      for(const l of lower){const q=project(l,origin[0],origin[1]);if(q.d<l.outer&&top-capH-hRun(l,q.s)<ROAD_CLEARANCE-.01)return false;}
      const offsets=cols.map(p=>(p[0]-origin[0])*-axis[1]+(p[1]-origin[1])*axis[0]),lo=Math.min(-r.half*.65,...offsets),hi=Math.max(r.half*.65,...offsets),mid=(lo+hi)/2;
      if(deckContains)for(const u of [-1,0,1])for(const v of [lo-.75,0,hi+.75]){counts.supportFootprintSamples++;if(!deckContains(r.level,origin[0]+u*axis[0]-v*axis[1],origin[1]+u*axis[1]+v*axis[0]))return rejectDeck();}
      // A flat cap must clear every road under its entire footprint, including
      // a lower approach assigned the same level as the supported deck.
      if(surfaceHeight)for(let u=-1.05;u<=1.051;u+=.5)for(let v=lo-.8;v<=hi+.801;v+=.5){
        const x=origin[0]+u*axis[0]-v*axis[1],z=origin[1]+u*axis[1]+v*axis[0];
        for(const [lv,reg]of regions)if(reg.has(x,z)){
          counts.capFootprintSamples++;const road=surfaceHeight(lv,x,z),delta=seat(x,z)-road;
          if(delta>.35&&delta<ROAD_CLEARANCE+capH+.05){counts.capRejectedCandidates++;return false;}
        }
      }
      if(Math.abs(top-nominal)>.02){
        const policy=patchPolicy(opts,'structure-seat','repair',[r.chain.id]);
        if(policy!=='repair'){counts.capContactFailures++;errors.push(`Structure seat ${r.chain.id}: policy ${policy}`);return false;}
        note(patch('structure-seat','repair','seat-on-final-soffit',[r.chain.id],{supports:1},{heightCorrectionM:Math.abs(top-nominal)},{fromHeightM:nominal,toHeightM:top,at:origin,sourcePlanMoved:false}),[id]);
      }
      for(const [x,z]of cols){pieces.push({t:'box',kind:'pier',at:[x,z,G(x,z)-.5],top:Math.min(top,seat(x,z))-capH,w:1.5,d:1.9,turn,info:id});columns.push({x,z,level:r.level,turn,w:1.5,d:1.9,top:Math.min(top,seat(x,z))-capH});}
      const ring:P3[]=[[-1,lo-.75],[1,lo-.75],[1,hi+.75],[-1,hi+.75]].map(([u,v])=>{const x=origin[0]+u!*axis[0]-v!*axis[1],z=origin[1]+u!*axis[1]+v!*axis[0];return [x,z,seat(x,z)] as P3;});
      pieces.push({t:'area',kind:'pier-cap',info:id,rings:[ring]});
      pieces.push({t:'area',kind:'pier-cap-under',info:id,down:true,rings:[ring.map(q=>[q[0],q[1],q[2]-capH])]});
      pieces.push({t:'wall',kind:'pier',info:id,line:[...ring,ring[0]!].map(q=>[q[0],q[1],q[2],q[2]-capH])});
      supports.push(s);counts.totalPiers++;
      const gap=Math.abs(Math.round(top*100)/100-((surfaceHeight?.(r.level,origin[0],origin[1])??hRun(r,s))-DECK_DEPTH));
      for(const q of ring){const seatGap=Math.abs(Math.round(q[2]*100)/100-seat(q[0],q[1]));maxCapGapM=Math.max(maxCapGapM,seatGap);if(seatGap>.02)counts.supportHeightFailures++;}
      maxCapGapM=Math.max(maxCapGapM,gap);if(gap>.02)counts.capContactFailures++;
      return true;
    };
    for(let k=1;k<=n;k++){const s=L*k/(n+1),p=along(r.pts,s),top=hRun(r,s)-DECK_DEPTH,turn=Math.atan2(p.tz,p.tx);if(top-G(p.x,p.z)<1.7)continue;
      const structure=r.chain.structure;
      if(/arch|cable|suspension/.test(structure)){counts.customSpanExclusions++;flagged.push(r.chain.id);continue;}
      const conflict=nearest(p.x,p.z),axis:P2=[p.tx,p.tz],origin:P2=[p.x,p.z];
      if(!conflict&&!hits(r.level,p.x,p.z,turn)&&!wet(p.x,p.z)&&emit(s,[origin],origin,axis)){counts.hammerheadCount++;continue;}
      const policy = patchPolicy(opts,'pier-collision','repair',[r.chain.id]);
      const changed = (algorithm:string,station:number,at:P2,action:'repair'|'omit'='repair') => {
        const movement={from:{at:origin,s},to:{at,s:station},sourcePlanMoved:false},worst={stationShiftM:Math.abs(station-s),columnOffsetM:Math.hypot(at[0]-p.x,at[1]-p.z)};
        note(patch('pier-collision',action,algorithm,[r.chain.id],{supports:1},worst,movement),[id]);
        if(deckRejected)note(patch('support-containment',action,action==='repair'?'move-under-carried-deck':'omit-unresolved-support',[r.chain.id],{supports:1},worst,movement),[id]);deckRejected=false;
      };
      if(policy==='stop'){errors.push(`Pier ${r.chain.id} at ${s} requires conflict repair`);continue;}
      if(policy==='omit'){counts.spanSkips++;flagged.push(r.chain.id);changed('omit-conflicting-support',s,origin,'omit');continue;}
      const dot=conflict?Math.abs(p.tx*conflict.q.tx+p.tz*conflict.q.tz):0;
      // Rule 1: skew station shift, bounded against both neighbouring nominal stations.
      let done=false;if(dot<.82)for(const shift of [-11,11,-16,16,-22,22,-28,28]){const s1=s+shift,prev=Math.max(...supports),next=Math.min(L,L*(k+1)/(n+1));if(s1<=prev+8||s1>=L-8||s1-prev>58||next-s1>58)continue;const a=along(r.pts,s1);if(!nearest(a.x,a.z)&&emit(s1,[[a.x,a.z]],[a.x,a.z],[a.tx,a.tz])){counts.shiftedCount++;changed('skew-station-shift',s1,[a.x,a.z]);done=true;break;}}if(done)continue;
      if(conflict&&dot>=.82&&conflict.r.chain.prof.lanes>=4){
        // Rule 2: only an EXISTING median. The measured carriageway is never widened by default.
        for(const u of [0,-1.5,1.5]){const x=p.x-p.tz*u,z=p.z+p.tx*u;if(!hits(r.level,x,z,turn)&&emit(s,[[x,z]],origin,axis)){counts.medianPiers++;changed('existing-median-placement',s,[x,z]);done=true;break;}}
        if(opts.widenLowerRoads&&!done)errors.push(`Authored median widening needs a reserve override for ${conflict.r.chain.id}`);
      }if(done)continue;
      // Rule 3: eccentric column on the lower road's outside shoulder, bounded cap reach.
      if(conflict&&conflict.q.d>conflict.r.half*.55){const q=conflict.q,sgn=((p.x-q.x)*-q.tz+(p.z-q.z)*q.tx)>=0?1:-1,u=sgn*(conflict.r.outer+3.2),col:P2=[q.x-q.tz*u,q.z+q.tx*u];if(Math.hypot(col[0]-p.x,col[1]-p.z)<r.outer+8&&emit(s,[col],origin,axis)){counts.cantileverCPiers++;changed('shoulder-cantilever',s,col);continue;}}
      // Rule 4: aligned to the LOWER road, expanding until BOTH columns clear ALL lower unions.
      const lowerAxis=conflict?.q??{tx:p.tx,tz:p.tz};
      // The lower road determines the beam's direction, the upper deck its seat.
      const q={x:p.x,z:p.z,tx:lowerAxis.tx,tz:lowerAxis.tz},ax:P2=[q.tx,q.tz];
      for(let half=(conflict?.r.outer??r.outer)+3.6;half<=80;half+=3.5){const cols:P2[]=[[q.x+q.tz*half,q.z-q.tx*half],[q.x-q.tz*half,q.z+q.tx*half]];if(emit(s,cols,[q.x,q.z],ax)){counts.portalBents++;changed('lower-road-aligned-portal',s,cols[0]!);done=true;break;}}
      if(!done){counts.spanSkips++;flagged.push(r.chain.id);changed('omit-unresolved-support',s,origin,'omit');}
    }
    supports.push(L);supports.sort((a,b)=>a-b);for(let i=1;i<supports.length;i++)maxSpanM=Math.max(maxSpanM,supports[i]!-supports[i-1]!);
  }
  for(const p of columns){if(deckContains&&!deckContains(p.level,p.x,p.z))counts.supportContainmentFailures++;if(surfaceHeight&&p.top>surfaceHeight(p.level,p.x,p.z)-DECK_DEPTH+.02)counts.supportHeightFailures++;
if(hits(p.level,p.x,p.z,p.turn,p.w,p.d,p.top+.1))counts.pierRoadCollisions++;if(wet(p.x,p.z))counts.pierWaterCollisions++;}
  if(counts.pierRoadCollisions||counts.pierWaterCollisions)errors.push(`Column footprint collisions: roads ${counts.pierRoadCollisions}, water ${counts.pierWaterCollisions}`);
  return {gate:{stage:10,id:'bridge-piers',name:'Five-rule lower-road-aware pier solver',ok:!errors.length,counts,worst:{maxSpanM,maxCapGapM,maxCapHeightCorrectionM},flagged:[...new Set(flagged)],errors}};
}
