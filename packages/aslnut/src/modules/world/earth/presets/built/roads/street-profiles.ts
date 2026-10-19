import { fitProfile, type Profile, type ProfileRules } from '../../../../../../core/geometry/networks/sections.ts';
/** Victoria's street types by road class (Vicmap: 2 arterial, 3 sub-arterial, 4 collector, 5 local), after the
 *  Infrastructure Design Manual and Clause 56 (the Victorian and Australian street standards): an access street 16 m with 7.3 m between kerbs and 1.5 m footpaths 0.05 m off the boundary; a
 *  collector 24 m with 11.6 m and a 2.5 m shared path 0.5 m off; arterials 34 to 41 m, divided by a 6 m median, 3 m
 *  shared paths; B2 kerb and channel 0.45 m. Defaults only: a reserve from data, a footpath from tags, win */
export const VIC_STREETS: ProfileRules = {
  carriageway: (c) => [24, 21, 20, 14, 11.6, 7.3, 4, 4, 3, 3][Math.max(0, Math.min(9, c))]!,
  lanes: (c) => [6, 4, 4, 4, 2, 2, 1, 1, 1, 1][Math.max(0, Math.min(9, c))]!,
  reserve: (c) => [60, 45, 41, 34, 24, 16, 8, 8, 6, 6][Math.max(0, Math.min(9, c))]!,
  footpath: (c) => (c <= 2 ? 3.0 : c <= 4 ? 2.5 : 1.5),
  median: (c) => (c === 2 ? 6 : 0),
  kerb: 0.45, minStrip: 0.6, gap: (c) => (c <= 4 ? 0.5 : 0.05),
  noVerge: (c) => c <= 1 || c >= 6,
};
/** Earth tags are interpreted before calling the generic section fitter. */
export function profileFor(cls:number,o:{width?:number;lanes?:number;reserve?:{left:number|null;right:number|null};tags?:Record<string,string|undefined>}={},rules:ProfileRules=VIC_STREETS):Profile{
  const t=o.tags??{},num=(v:string|undefined)=>{const n=parseFloat(v??'');return Number.isFinite(n)&&n>0?n:undefined;},sw=t.sidewalk??t['sidewalk:both'];
  const has=(side:'left'|'right')=>{const v=t[`sidewalk:${side}`]??(sw==='both'?'yes':sw===side?'yes':sw==='no'||sw==='none'||(sw&&sw!==side&&sw!=='both'&&sw!=='separate')?'no':undefined);return v!=='no';};
  const lanes=o.lanes??num(t.lanes);
  return fitProfile(cls,{width:o.width??num(t.width)??(num(t.lanes)?lanes!*3.3:undefined),lanes,reserve:o.reserve,sidewalk:{left:has('left'),right:has('right')},footpath:{left:num(t['sidewalk:left:width'])??num(t['sidewalk:width']),right:num(t['sidewalk:right:width'])??num(t['sidewalk:width'])},fromTags:Boolean(t.lanes||t.width||sw||t['sidewalk:left']||t['sidewalk:right'])},rules);
}
