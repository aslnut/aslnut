import { earcut } from '../build/earcut.ts';
import type { Piece, P3 } from './bake-types.ts';
/** Clip paint to the exact road facets and interpolate their quantized heights.
 * Sampling the height field alone lets long paint quads cut through curved roads. */
export function drapePaint(pieces: Piece[]): void {
  type Tri = { p: P3[]; height: (x: number, z: number) => number };
  const grid = new Map<string, Tri[]>(), size = 20;
  for (const piece of pieces) {
    if (piece.t !== 'area' || piece.kind !== 'carriageway') continue;
    const points = piece.rings.flat().map(p => p.map(v => Math.round(v * 100) / 100) as P3), holes: number[] = [];
    let offset = piece.rings[0]!.length; for (const ring of piece.rings.slice(1)) { holes.push(offset); offset += ring.length; }
    const indices = earcut(points.flatMap(p => [p[0], p[1]]), holes, 2);
    for (let i = 0; i < indices.length; i += 3) {
      let p = indices.slice(i, i + 3).map(j => points[j]!);
      const cross = (a:P3,b:P3,c:P3) => (b[0]-a[0])*(c[1]-a[1])-(b[1]-a[1])*(c[0]-a[0]);
      if (cross(p[0]!,p[1]!,p[2]!) < 0) p = [p[0]!,p[2]!,p[1]!];
      const [a,b,c] = p as [P3,P3,P3], den = cross(a,b,c); if (den < 1e-9) continue;
      const tri:Tri = {p,height:(x,z)=>{const u=((b[0]-x)*(c[1]-z)-(b[1]-z)*(c[0]-x))/den,v=((c[0]-x)*(a[1]-z)-(c[1]-z)*(a[0]-x))/den;return u*a[2]+v*b[2]+(1-u-v)*c[2];}};
      for(let x=Math.floor(Math.min(...p.map(q=>q[0]))/size);x<=Math.floor(Math.max(...p.map(q=>q[0]))/size);x++)for(let z=Math.floor(Math.min(...p.map(q=>q[1]))/size);z<=Math.floor(Math.max(...p.map(q=>q[1]))/size);z++){const key=`${x}:${z}`,list=grid.get(key)??[];list.push(tri);grid.set(key,list);}
    }
  }
  const output:Piece[]=[];
  for(const piece of pieces){
    if(piece.kind!=='marking'||piece.t!=='strip'){output.push(piece);continue;}
    for(let i=1;i<piece.edges[0]!.length;i++){
      const polygon=[piece.edges[0]![i-1]!,piece.edges[0]![i]!,piece.edges[1]![i]!,piece.edges[1]![i-1]!];
      const candidates=new Set<Tri>();for(let x=Math.floor(Math.min(...polygon.map(q=>q[0]))/size);x<=Math.floor(Math.max(...polygon.map(q=>q[0]))/size);x++)for(let z=Math.floor(Math.min(...polygon.map(q=>q[1]))/size);z<=Math.floor(Math.max(...polygon.map(q=>q[1]))/size);z++)for(const tri of grid.get(`${x}:${z}`)??[])candidates.add(tri);
      const cx=polygon.reduce((s,p)=>s+p[0],0)/4,cz=polygon.reduce((s,p)=>s+p[1],0)/4,h=polygon.reduce((s,p)=>s+p[2],0)/4;
      for(const tri of candidates){if(Math.abs(tri.height(cx,cz)-h)>2)continue;let clipped=polygon;
        for(let j=0;j<3&&clipped.length;j++){
          const a=tri.p[j]!,b=tri.p[(j+1)%3]!,side=(p:P3)=>(b[0]-a[0])*(p[1]-a[1])-(b[1]-a[1])*(p[0]-a[0]),next:P3[]=[];
          for(let k=0;k<clipped.length;k++){const p=clipped[k]!,q=clipped[(k+1)%clipped.length]!,sp=side(p),sq=side(q);if(sp>=-1e-9)next.push(p);if((sp>=0)!==(sq>=0)){const t=sp/(sp-sq);next.push([p[0]+(q[0]-p[0])*t,p[1]+(q[1]-p[1])*t,0]);}}clipped=next;
        }
        if(clipped.length<3)continue;let area=0;for(let j=0;j<clipped.length;j++){const a=clipped[j]!,b=clipped[(j+1)%clipped.length]!;area+=a[0]*b[1]-b[0]*a[1];}if(Math.abs(area)<.0002)continue;
        output.push({t:'poly',kind:'marking',info:piece.info,ring:clipped.map(p=>[p[0],p[1],tri.height(p[0],p[1])+.045])});
      }
    }
  }
  pieces.length=0;
  for(const piece of output)pieces.push(piece);
}
