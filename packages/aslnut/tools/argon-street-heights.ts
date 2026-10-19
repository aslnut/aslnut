// Evidence-only camera elevations sampled on the published, quantized road facets.
import {readFileSync,writeFileSync} from 'node:fs';import {join} from 'node:path';
import {bakedPieces,type BakedTile} from '../src/modules/world/earth/presets/built/roads/baked.ts';
import {FacetIndex,facetsOf} from '../src/core/geometry/networks/facets.ts';
const out=join(import.meta.dirname,process.env.OUT??'../.out/argon/v4'),phase=process.env.PHASE??'before',root=phase==='before'?join(out,'baseline'):join(import.meta.dirname,'../../../data/packs/roads');
const cameras=JSON.parse(readFileSync(join(out,'cameras.json'),'utf8')) as {id:string;place:string;eye:[number,number];target:[number,number];bearing?:number;horizontalM?:number;lowerEyeSourceId?:string;lowerId?:string}[],heights:Record<string,unknown>={};
for(const place of new Set(cameras.map(c=>c.place))){const dir=join(root,place),head=JSON.parse(readFileSync(join(dir,'index.json'),'utf8')),infos=new Map<number,Record<string,unknown>>();
 const pieces=head.tiles.flatMap(([ix,iz]:number[])=>{const tile=JSON.parse(readFileSync(join(dir,`${ix}_${iz}.json`),'utf8')) as BakedTile;const ps=bakedPieces(tile,head.kinds);for(const p of ps){const id=infos.size;infos.set(id,tile.infos[p.info]!.props);p.info=id;}return ps.filter(p=>p.kind==='carriageway');});
 const index=new FacetIndex(facetsOf(pieces)),kx=111320*Math.cos(head.origin[1]*Math.PI/180);
 for(const c of cameras.filter(c=>c.place===place)){const x=(c.eye[0]-head.origin[0])*kx,z=-(c.eye[1]-head.origin[1])*110574,candidates=index.at(x,z);const owned=candidates.filter(f=>String(infos.get(f.piece.info)?.osm??'').split(' ').includes(c.lowerEyeSourceId??c.lowerId??''));const selected=owned.length?owned:candidates;
  if(!selected.length&&phase==='before'){
   let closest:{distance:number;x:number;z:number;h:number}|null=null;
   for(const f of index.near(x,z,100))for(let i=0;i<3;i++){const a=f.points[i]!,b=f.points[(i+1)%3]!,dx=b[0]-a[0],dz=b[1]-a[1],u=Math.max(0,Math.min(1,((x-a[0])*dx+(z-a[1])*dz)/(dx*dx+dz*dz||1))),px=a[0]+u*dx,pz=a[1]+u*dz,dist=Math.hypot(x-px,z-pz);
    if(!closest||dist<closest.distance){const cx=f.points.reduce((n,q)=>n+q[0],0)/3,cz=f.points.reduce((n,q)=>n+q[1],0)/3,qx=px*.99+cx*.01,qz=pz*.99+cz*.01;closest={distance:dist,x:qx,z:qz,h:f.height(qx,qz)};}
   }
   if(closest){c.eye=[head.origin[0]+closest.x/kx,head.origin[1]-closest.z/110574];const R=6378137,D=Math.PI/180,cv=R*Math.cos(c.target[1]*D),merc=(lat:number)=>Math.log(Math.tan(Math.PI/4+lat*D/2)),dx=cv*(c.target[0]-c.eye[0])*D,dz=-cv*(merc(c.target[1])-merc(c.eye[1]));c.horizontalM=Math.hypot(dx,dz);c.bearing=(Math.atan2(dx,-dz)/D+360)%360;heights[c.id]={roadHeightM:closest.h,eyeHeightM:closest.h+1.7,cameraMovedM:closest.distance};continue;}
  }
  if(!selected.length)heights[c.id]={error:'No lower-road facet at eye',eye:c.eye};else{const h=Math.min(...selected.map(f=>f.height(x,z)));heights[c.id]={roadHeightM:h,eyeHeightM:h+1.7,source:infos.get(selected.find(f=>f.height(x,z)===h)!.piece.info)?.osm};}
 }
}
if(phase==='before')writeFileSync(join(out,'cameras.json'),JSON.stringify(cameras,null,2));
writeFileSync(join(out,`heights-${phase}.json`),JSON.stringify(heights,null,2));console.log(`${phase}: ${Object.values(heights).filter((h:any)=>!h.error).length}/${cameras.length} eyes on a road`);
