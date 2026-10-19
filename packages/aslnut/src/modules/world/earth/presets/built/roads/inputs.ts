import { groundAt, type Ground } from '../../../../../../core/geometry/landform/compose/ground.ts';
import type { StampSpec } from '../../../../../../core/geometry/landform/terraform/stamps.ts';
import type { RoadWay, P2 } from '../../../../../../core/geometry/networks/graph.ts';
import type { BakePath } from '../../../../../../core/geometry/networks/bake-types.ts';
export interface WaterWay {
  id: string | number;
  pts: [number, number][];
  tags: Record<string, string>;
}

export function fitSteps(ground:Ground,pathsIn:readonly {pts:P2[];tags:Record<string,string>}[],toLocal:(lon:number,lat:number)=>P2):StampSpec[]{
const specs:StampSpec[]=[];
  for (const p of pathsIn ?? []) {
    const t = p.tags;
    if (t.highway !== 'steps' || t.tunnel === 'yes' || t.bridge === 'yes' || Number(t.layer ?? 0) !== 0 || p.pts.length < 2) continue;
    const a = toLocal(p.pts[0]![0], p.pts[0]![1]), b = toLocal(p.pts[p.pts.length - 1]![0], p.pts[p.pts.length - 1]![1]);
    const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz);
    if (len < 2.5 || len > 60) continue;
    const ya = groundAt(ground, a[0], a[1]), yb = groundAt(ground, b[0], b[1]);
    const yBot = Math.min(ya, yb), yTop = Math.max(ya, yb, yBot + 0.45), flip = ya > yb;
    const w = Number.parseFloat(t.width ?? '');
    specs.push({
      type: 'STAIRS', cx: (a[0] + b[0]) / 2, cz: (a[1] + b[1]) / 2,
      id: t.osm_id, angle: Math.atan2(flip ? dz : -dz, flip ? dx : -dx) - Math.PI / 2,
      halfL: Number.isFinite(w) && w > 0.4 ? w / 2 : 1.1, halfW: len / 2, feather: 2.5, yBot, yTop,
    });
  }

return specs;
}
export const bakePath=(p:{pts:P2[];tags:Record<string,string>}):BakePath=>({pts:p.pts,id:p.tags.osm_id??'unknown',steps:p.tags.highway==='steps',elevated:p.tags.bridge==='yes'||Number(p.tags.layer??0)>0,sidewalk:p.tags.footway==='sidewalk',crossing:p.tags.footway==='crossing',width:parseFloat(p.tags.width??p.tags['sidewalk:width']??'')||undefined,props:{osm:p.tags.osm_id,highway:p.tags.highway,source:'OpenStreetMap (ODbL)'}});
export const bakeWater=(w:WaterWay)=>({...w,kind:w.tags.waterway??'',covered:w.tags.tunnel==='yes'||w.tags.tunnel==='culvert'||Number(w.tags.layer??0)<0,width:parseFloat(w.tags.width??'')||undefined,name:w.tags.name??null});

export function councilFootpathWidth(features:unknown[]):(lon:number,lat:number)=>number{
// a footpath's width where its data says none: the council's default, else Victoria's (Monash: 1.4 m; 1.5 m)
const FOOTPATH = { default: 1.5, councils: { Monash: 1.4 } as Record<string, number> };
const councils = (features as { properties: { name: string }; geometry: { type: string; coordinates: number[][][] | number[][][][] } }[]).filter((c) => FOOTPATH.councils[c.properties.name] !== undefined);
const inRing = (x: number, y: number, r: number[][]) => { let k = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i]!, b = r[j]!; if ((a[1]! > y) !== (b[1]! > y) && x < ((b[0]! - a[0]!) * (y - a[1]!)) / (b[1]! - a[1]!) + a[0]!) k = !k; } return k; };
return  (lon: number, lat: number) => { for (const c of councils) { const polys = (c.geometry.type === 'Polygon' ? [c.geometry.coordinates] : c.geometry.coordinates) as number[][][][]; if (polys.some((p) => inRing(lon, lat, p[0]!))) return FOOTPATH.councils[c.properties.name]!; } return FOOTPATH.default; };

}

export interface RoadFeature {properties:Record<string,unknown>;geometry:{type:string;coordinates:unknown}}
export function roadFeatures(features:RoadFeature[]):{ways:RoadWay[];crossings:{at:P2;tags:Record<string,string>}[]}{
  const ways:RoadWay[]=[],crossings:{at:P2;tags:Record<string,string>}[]=[];
  for(const f of features){
    if(f.geometry.type==='LineString'){const {nodes,osm_id,...tags}=f.properties;ways.push({id:osm_id as string|number,nodes:nodes as number[],pts:f.geometry.coordinates as P2[],tags:tags as Record<string,string>});}
    else if(f.geometry.type==='Point')crossings.push({at:f.geometry.coordinates as P2,tags:f.properties as Record<string,string>});
  }
  return{ways,crossings};
}
export const pathFeatures=(features:RoadFeature[])=>features.map(f=>({pts:f.geometry.coordinates as P2[],tags:f.properties as Record<string,string>}));
export const reserveFeatures=(features:RoadFeature[])=>features.flatMap(f=>f.geometry.type==='Polygon'?[(f.geometry.coordinates as P2[][])[0]!]: (f.geometry.coordinates as P2[][][]).map(p=>p[0]!));
export const waterFeatures=(features:RoadFeature[])=>features.map(f=>({id:(f.properties.osm_id??'') as string|number,pts:f.geometry.coordinates as P2[],tags:f.properties as Record<string,string>}));
