import { earcut } from '../build/earcut.ts';
import type { Piece, P3 } from './bake-types.ts';

/** The same centimetre vertices and diagonal choices as the device triangulator. */
export interface Facet { points:[P3,P3,P3]; piece:Piece; height:(x:number,z:number)=>number; contains:(x:number,z:number)=>boolean }
class TriangleFacet implements Facet {
  points:[P3,P3,P3];piece:Piece;
  private ux:number;private uz:number;private vx:number;private vz:number;
  constructor(piece:Piece,p:[P3,P3,P3],den:number){
    this.piece=piece;this.points=p;const [a,b,c]=p;
    this.ux=(b[1]-c[1])/den;this.uz=(c[0]-b[0])/den;
    this.vx=(c[1]-a[1])/den;this.vz=(a[0]-c[0])/den;
  }
  height(x:number,z:number):number{
    const [a,b,c]=this.points,dx=x-c[0],dz=z-c[1],u=this.ux*dx+this.uz*dz,v=this.vx*dx+this.vz*dz;
    return c[2]+u*(a[2]-c[2])+v*(b[2]-c[2]);
  }
  contains(x:number,z:number):boolean{
    const c=this.points[2],dx=x-c[0],dz=z-c[1],u=this.ux*dx+this.uz*dz,v=this.vx*dx+this.vz*dz;
    return u>=-1e-7&&v>=-1e-7&&u+v<=1+1e-7;
  }
}
export function facetsOf(pieces:readonly Piece[]):Facet[] {
  const out:Facet[]=[];
  // Reuse each quantized polygon vertex across its triangles. Shared methods
  // avoid three closures and three duplicate points per facet in city bakes.
  const quantized=new WeakMap<P3,P3>();
  const point=(q:P3)=>{let p=quantized.get(q);if(!p){p=q.map(v=>Math.round(v*100)/100) as P3;quantized.set(q,p);}return p;};
  const tri=(piece:Piece,raw:readonly P3[])=>{
    const p=raw.map(point) as [P3,P3,P3],[a,b,c]=p,den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1]);
    if(Math.abs(den)>1e-8)out.push(new TriangleFacet(piece,p,den));
  };
  for(const piece of pieces){
    if(piece.t==='poly'&&piece.fan){
      for(let i=1;i<piece.ring.length;i++)tri(piece,[piece.ring[0]!,piece.ring[i]!,piece.ring[i+1<piece.ring.length?i+1:1]!]);
    }else if(piece.t==='area'||piece.t==='poly'){
      const rings=piece.t==='area'?piece.rings:[piece.ring],points=rings.flat(),holes:number[]=[];
      let offset=rings[0]!.length;for(const ring of rings.slice(1)){holes.push(offset);offset+=ring.length;}
      const indices=earcut(points.flatMap(q=>[Math.round(q[0]*100)/100,Math.round(q[1]*100)/100]),holes,2);
      for(let i=0;i<indices.length;i+=3)tri(piece,indices.slice(i,i+3).map(j=>points[j]!));
    }else if(piece.t==='strip'){
      for(let e=1;e<piece.edges.length;e++)for(let i=1;i<piece.edges[e]!.length;i++){
        const a=piece.edges[e-1]![i-1]!,b=piece.edges[e]![i-1]!,c=piece.edges[e]![i]!,d=piece.edges[e-1]![i]!;
        tri(piece,[a,b,c]);tri(piece,[a,c,d]);
      }
    }else if(piece.t==='box'){
      const cs=Math.cos(piece.turn),sn=Math.sin(piece.turn),p=(u:number,v:number):P3=>[piece.at[0]+u*cs-v*sn,piece.at[1]+u*sn+v*cs,piece.top];
      const a=p(-piece.d/2,-piece.w/2),b=p(piece.d/2,-piece.w/2),c=p(piece.d/2,piece.w/2),d=p(-piece.d/2,piece.w/2);
      tri(piece,[a,b,c]);tri(piece,[a,c,d]);
    }
  }
  return out;
}

export class FacetIndex {
  private grid=new Map<string,Facet[]>();
  private size:number;
  constructor(facets:readonly Facet[],size=20){
    this.size=size;this.add(facets);
  }
  add(facets:readonly Facet[]):void{
    const size=this.size;
    for(const facet of facets){const xs=facet.points.map(p=>p[0]),zs=facet.points.map(p=>p[1]);
      for(let x=Math.floor(Math.min(...xs)/size);x<=Math.floor(Math.max(...xs)/size);x++)for(let z=Math.floor(Math.min(...zs)/size);z<=Math.floor(Math.max(...zs)/size);z++){
        const key=`${x}:${z}`,list=this.grid.get(key)??[];list.push(facet);this.grid.set(key,list);
      }
    }
  }
  near(x:number,z:number,reach:number):Facet[]{
    const out=new Set<Facet>();
    for(let i=Math.floor((x-reach)/this.size);i<=Math.floor((x+reach)/this.size);i++)for(let j=Math.floor((z-reach)/this.size);j<=Math.floor((z+reach)/this.size);j++)for(const f of this.grid.get(`${i}:${j}`)??[])out.add(f);
    return [...out];
  }
  at(x:number,z:number):Facet[]{return (this.grid.get(`${Math.floor(x/this.size)}:${Math.floor(z/this.size)}`)??[]).filter(f=>f.contains(x,z));}
}

/** Interior samples catch cover missed by polygon-vertex checks. */
export function carriagewayVisibility(pieces:readonly Piece[],ground:(x:number,z:number)=>number,tolerance=.4){
  const roads=facetsOf(pieces.filter(p=>p.kind==='carriageway')),index=new FacetIndex(roads);
  const covers=pieces.filter(p=>{
    if(p.kind==='carriageway'||p.kind==='marking'||(p.kind==='deck-under'||p.kind==='girder-under'||p.kind==='pier-cap'||p.kind==='pier-cap-under')||((p.t==='area'||p.t==='strip')&&p.overhead))return false;
    const points=p.t==='area'?p.rings.flat():p.t==='poly'?p.ring:p.t==='strip'?p.edges.flat():p.t==='box'?[p.at]:[];
    if(!points.length)return false;
    let x0=Infinity,x1=-Infinity,z0=Infinity,z1=-Infinity;
    for(const q of points){x0=Math.min(x0,q[0]);x1=Math.max(x1,q[0]);z0=Math.min(z0,q[1]);z1=Math.max(z1,q[1]);}
    if(p.t==='box'){const pad=(p.w+p.d)/2;x0-=pad;x1+=pad;z0-=pad;z1+=pad;}
    return index.near((x0+x1)/2,(z0+z1)/2,Math.max(x1-x0,z1-z0)/2+.02).some(f=>{
      const xs=f.points.map(q=>q[0]),zs=f.points.map(q=>q[1]);
      return Math.max(...xs)>=x0-.02&&Math.min(...xs)<=x1+.02&&Math.max(...zs)>=z0-.02&&Math.min(...zs)<=z1+.02;
    });
  });
  index.add(facetsOf(covers));
  let visibilitySamples=0,terrainCoverFailures=0,pieceCoverFailures=0,maxTerrainCoverM=0,maxPieceCoverM=0;
  const ids=new Set<number>(),locations:{at:[number,number];info:number;kind:string;intrusion:number}[]=[];
  const terrainHits:{x:number;z:number;h:number;info:number;intrusion:number}[]=[];
  const pieceHits:{x:number;z:number;h:number;coverH:number;road:Facet;cover:Facet}[]=[];
  for(const f of roads){
    const [a,b,c]=f.points,n=Math.max(1,Math.ceil(Math.max(Math.hypot(a[0]-b[0],a[1]-b[1]),Math.hypot(a[0]-c[0],a[1]-c[1]),Math.hypot(b[0]-c[0],b[1]-c[1]))/4));
    for(let i=0;i<n;i++)for(let j=0;j<n-i;j++){
      const u=(i+1/3)/n,v=(j+1/3)/n,x=a[0]*(1-u-v)+b[0]*u+c[0]*v,z=a[1]*(1-u-v)+b[1]*u+c[1]*v,h=f.height(x,z);
      visibilitySamples++;
      const intrusion=Math.max(0,ground(x,z)-h);maxTerrainCoverM=Math.max(maxTerrainCoverM,intrusion);
      if(intrusion>tolerance){terrainCoverFailures++;ids.add(f.piece.info);terrainHits.push({x,z,h,info:f.piece.info,intrusion});if(locations.length<100)locations.push({at:[x,z],info:f.piece.info,kind:'terrain',intrusion});}
      for(const other of index.at(x,z)){
        if(other.piece===f.piece)continue;
        const delta=other.height(x,z)-h;
        // Certified elevated roads, pedestrian decks and their supports remain
        // overhead. Adjacent road assemblies must not cover asphalt at low height.
        if(delta<=tolerance||(other.piece.kind==='carriageway'&&other.piece.t==='area'&&f.piece.t==='area'&&(other.piece.level??0)>(f.piece.level??0)&&delta>=5.45)||(other.piece.kind==='deck-under'||other.piece.kind==='girder-under'||other.piece.kind==='pier-cap'||other.piece.kind==='pier-cap-under')||((other.piece.t==='area'||other.piece.t==='strip')&&other.piece.overhead)||(other.piece.kind==='pier'&&delta>=5.45))continue;
        pieceCoverFailures++;maxPieceCoverM=Math.max(maxPieceCoverM,delta);ids.add(other.piece.info);
        pieceHits.push({x,z,h,coverH:other.height(x,z),road:f,cover:other});
        if(locations.length<100)locations.push({at:[x,z],info:other.piece.info,kind:other.piece.kind,intrusion:delta});
      }
    }
  }
  return {counts:{visibilitySamples,terrainCoverFailures,pieceCoverFailures},worst:{maxTerrainCoverM,maxPieceCoverM},ids:[...ids],locations,terrainHits,pieceHits};
}
