import type { RoadProfile } from '../../../../../../core/geometry/networks/bake-types.ts';
export const CLS: Record<string, number> = { motorway: 0, trunk: 1, primary: 2, secondary: 3, tertiary: 4, unclassified: 5, residential: 5, living_street: 5, road: 5, service: 7 };
/** a road's class (0 freeway … 5 local, 6 tracks, 7 service) from its OSM highway tag */
export const clsOf = (t: Record<string, string>) => CLS[(t.highway ?? '').replace(/_link$/, '')] ?? 6;
const num = (v: string | undefined) => { const n = parseFloat(v ?? ''); return Number.isFinite(n) && n > 0 ? n : null; };
export function profileOfTags(t: Record<string, string>, oneway: boolean): RoadProfile {
  const cls = clsOf(t), link = /_link$/.test(t.highway ?? ''), lw = cls <= 1 ? 3.5 : 3.3;
  const lanes = num(t.lanes) ?? (oneway ? (link ? 1 : cls <= 2 ? 2 : 1) : cls <= 2 ? 4 : 2);
  let cw = num(t.width) ?? (oneway ? lanes * lw + (cls === 0 ? 2.5 : link ? 1.2 : 0.6) : cls >= 5 ? (cls >= 7 ? 5 : 7.3) : lanes * lw + 1);
  if (t.junction === 'roundabout') cw = num(t.width) ?? Math.max(6, lanes * 4.5);
  return { cls, lanes, carriageway: cw, kerb: cls >= 1, oneway, link, seedGrade:cls===0?.06:cls===1?.08:.1, maxGrade:cls===0?.06:cls===1?.08:.2,desirableGrade:cls<=1?.08:.1,minK:cls<=1?20:8,bankable:cls<=1,deckEdge:cls<=1?'viaduct':'deck',promenade:cls>=2&&cls<=4,verge:cls>=1&&cls<=6,plainEdge:cls===0 };
}


export const radiusOf=(cls:number)=>cls<=3?15:cls===4?12.5:cls<=6?7.5:4;
export const VERGE:Record<number,number>={1:6,2:6,3:6,4:5.5,5:4.3,6:3.5};
