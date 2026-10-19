// Stages 03 & 04 of the 11-stage road bake:
//   Stage 03: OSM Topological Sanitization, Non-Destructive QA Gate & Degree-2 Way-Chaining
//   Stage 04: Horizontal Alignment — Curvature-Continuous Spline Corners, Arc-Length LUT & Curvature κ_xz(s)
import type { P2, RoadEdge, RoadGraph } from './graph.ts';
import type { StageGate } from '../../runtime/workers/compile/patch-policy.ts';
import type { Chain, SolveOptions } from './bake-types.ts';

/** Barry–Goldman centripetal interpolation. End knots extrapolate; measured knots remain on the curve. */
export function centripetal(p0: P2, p1: P2, p2: P2, p3: P2, u: number): P2 {
  const knot = (a: P2, b: P2) => Math.max(1e-6, Math.sqrt(Math.hypot(b[0]-a[0], b[1]-a[1])));
  const t0=0, t1=knot(p0,p1), t2=t1+knot(p1,p2), t3=t2+knot(p2,p3), t=t1+u*(t2-t1);
  const mix = (a:P2,b:P2,ta:number,tb:number):P2 => [(tb-t)/(tb-ta)*a[0]+(t-ta)/(tb-ta)*b[0],(tb-t)/(tb-ta)*a[1]+(t-ta)/(tb-ta)*b[1]];
  const a1=mix(p0,p1,t0,t1),a2=mix(p1,p2,t1,t2),a3=mix(p2,p3,t2,t3);
  return mix(mix(a1,a2,t0,t2),mix(a2,a3,t1,t3),t1,t2);
}
export function runStage04Alignment(chains: Chain[], opts: SolveOptions = {}): { gate: StageGate } {
  let sampledStations=0, maxCurvature=0, totalLen=0, invalidStations=0, selfIntersections=0, interpolatedSegments=0;
  const flagged: string[]=[];
  for(const c of chains) {
    if(opts.smoothAlignment && c.pts.length>2) {
      const src=c.pts, meta=c.point, out:P2[]=[src[0]!], pt:Chain['point']=[meta[0]!];
      for(let i=0;i+1<src.length;i++) {
        const p1=src[i]!,p2=src[i+1]!,p0=src[i-1]??[2*p1[0]-p2[0],2*p1[1]-p2[1]],p3=src[i+2]??[2*p2[0]-p1[0],2*p2[1]-p1[1]];
        const n=Math.max(1,Math.ceil(Math.hypot(p2[0]-p1[0],p2[1]-p1[1])/2));
        for(let j=1;j<=n;j++){out.push(j===n?p2:centripetal(p0,p1,p2,p3,j/n));pt.push(meta[i+1]!);}
        interpolatedSegments++;
      }
      c.pts=out;c.point=pt;
    }
    const n=c.pts.length, s=new Array<number>(n).fill(0), kappa=new Array<number>(n).fill(0);
    for(let i=1;i<n;i++){const a=c.pts[i-1]!,b=c.pts[i]!;s[i]=s[i-1]!+Math.hypot(b[0]-a[0],b[1]-a[1]);if(!Number.isFinite(s[i]!)||s[i]!<=s[i-1]!)invalidStations++;}
    for(let i=1;i+1<n;i++) {
      const a=c.pts[i-1]!,b=c.pts[i]!,d=c.pts[i+1]!,ab=Math.hypot(b[0]-a[0],b[1]-a[1]),bd=Math.hypot(d[0]-b[0],d[1]-b[1]),ad=Math.hypot(d[0]-a[0],d[1]-a[1]);
      kappa[i]=2*((b[0]-a[0])*(d[1]-b[1])-(b[1]-a[1])*(d[0]-b[0]))/Math.max(1e-9,ab*bd*ad);maxCurvature=Math.max(maxCurvature,Math.abs(kappa[i]!));
    }
    // Measured self-crossings are reported. New spline crossings stop the bake.
    for(let i=0;i+1<n;i++) for(let j=i+2;j+1<n;j++){
      if(c.ring&&i===0&&j===n-2)continue;
      const a=c.pts[i]!,b=c.pts[i+1]!,d=c.pts[j]!,e=c.pts[j+1]!,rx=b[0]-a[0],rz=b[1]-a[1],sx=e[0]-d[0],sz=e[1]-d[1],den=rx*sz-rz*sx;
      if(Math.abs(den)<1e-9)continue;const t=((d[0]-a[0])*sz-(d[1]-a[1])*sx)/den,u=((d[0]-a[0])*rz-(d[1]-a[1])*rx)/den;
      if(t>1e-6&&t<1-1e-6&&u>1e-6&&u<1-1e-6){selfIntersections++;flagged.push(c.id);}
    }
    if(kappa.some(k=>Math.abs(k)>1/15))flagged.push(c.id);
    c.s=s;c.kappa=kappa;sampledStations+=n;totalLen+=s[n-1]??0;
  }
  const errors:string[]=[];if(invalidStations)errors.push(`${invalidStations} non-finite or non-increasing stations`);if(opts.smoothAlignment&&selfIntersections)errors.push(`${selfIntersections} spline self-crossings`);
  return {gate:{stage:4,id:'horizontal-alignment',name:'Measured alignment / optional centripetal spline and arc-length LUT',ok:!errors.length,counts:{corridors:chains.length,sampledStations,interpolatedSegments,selfIntersections,invalidStations},worst:{maxCurvature,minRadiusM:maxCurvature?1/maxCurvature:0,totalLengthKm:totalLen/1000},flagged,errors}};
}
