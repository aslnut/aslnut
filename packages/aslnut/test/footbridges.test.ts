import {test} from 'node:test';import assert from 'node:assert/strict';
import {footbridges,rampDrop,RAMP_GRADE} from '../src/core/geometry/networks/structures/footbridges.ts';
import {carriagewaySeams} from '../src/core/geometry/networks/seams.ts';
import {footpathGrade} from '../src/core/geometry/networks/structures/footpath-grade.ts';
import {Region,cellsOf,type WalkLine} from '../src/core/geometry/networks/union.ts';
import type {Piece,BakePath} from '../src/core/geometry/networks/bake-types.ts';
import type {RunForStructures} from '../src/core/geometry/networks/structures/piers.ts';
import type {Patch} from '../src/core/runtime/workers/compile/patch-policy.ts';

// a 20 m wide road along x = 0 (z from -200 to 200) on flat ground at 10 m
const road:RunForStructures={chain:{id:'road'} as never,level:0,baseLevel:0,bridge:false,pts:[[0,-200],[0,200]],hs:[10,10],acc:[0,400],half:10,outer:10,caps:[null,null]};
const regions=new Map([[0,new Region(cellsOf([[{x:-10,y:-200},{x:10,y:-200},{x:10,y:200},{x:-10,y:200}]]))]]);
const G=()=>10,walkHeight=()=>10.18;
const path=(id:string,pts:[number,number][],o:Partial<BakePath>={}):BakePath=>({id,pts,steps:false,elevated:false,sidewalk:false,crossing:false,props:{},...o});
const walkGrades=(pieces:Piece[])=>pieces.filter((p):p is Extract<Piece,{t:'strip'}>=>p.t==='strip'&&p.kind==='footpath').flatMap(p=>{const e=p.edges[0]!;return e.slice(1).map((b,i)=>{const a=e[i]!,L=Math.hypot(b[0]-a[0],b[1]-a[1]);return L>.05?Math.abs(b[2]-a[2])/L:0;});});

test('an accessible ramp loses 1:14 over each 9 m leg and nothing on its 1.5 m landings',()=>{
  assert.ok(Math.abs(rampDrop(9)-9/14)<1e-12);assert.ok(Math.abs(rampDrop(10.5)-9/14)<1e-12);assert.ok(Math.abs(rampDrop(19.5)-18/14)<1e-12);
});
test('a footbridge with no mapped approach comes down by generated switchback ramps, never a box',()=>{
  const pieces:Piece[]=[],walk:WalkLine[]=[],patches:Patch[]=[];
  const out=footbridges([path('bridge',[[-40,0],[40,0]],{elevated:true})],[road],regions,G,walkHeight,()=>1,pieces,walk,[],{},p=>patches.push(p));
  assert.equal(out.counts.footbridgeEnds,2);assert.equal(out.counts.footbridgeEndsUnconnected,0);assert.equal(out.counts.generatedRamps,2);
  assert.equal(pieces.filter(p=>p.t==='box').length,0,'no access tower');
  assert.ok(Math.max(...walkGrades(pieces))<=RAMP_GRADE+1e-9,'every walking line within 1:14');
  assert.ok(out.worst.leastFootbridgeClearanceM!>=5.5);assert.equal(patches.filter(p=>p.check==='footbridge-approach'&&p.algorithm==='generate-switchback-ramp').length,2);
});
test('a mapped approach joined to the deck end is lifted on the ramp profile and kept at grade only past its touchdown',()=>{
  const pieces:Piece[]=[],walk:WalkLine[]=[],approach=path('approach',[[40,0],[200,0]]);
  const out=footbridges([path('bridge',[[-40,0],[40,0]],{elevated:true}),approach,path('west',[[-200,0],[-40,0]])],[road],regions,G,walkHeight,()=>1,pieces,walk);
  assert.equal(out.counts.mappedRampApproaches,2);assert.equal(out.counts.generatedRamps,0);
  const lifted=out.lifted.get(approach)!;assert.ok(lifted[0]>60&&lifted[0]<160,`lifted ${lifted[0]} m`);assert.equal(lifted[1],0);
  assert.ok(Math.max(...walkGrades(pieces))<=RAMP_GRADE+1e-9);
});
test('a sidewalk beside a road deck sits on that deck, not over it',()=>{
  const deck:RunForStructures={...road,chain:{id:'deck'} as never,bridge:true,level:1,pts:[[-200,30],[200,30]],hs:[18,18],half:5,outer:5};
  const pieces:Piece[]=[];const out=footbridges([path('side',[[-30,37],[30,37]],{elevated:true,sidewalk:true})],[road,deck],regions,G,walkHeight,()=>1,pieces,[]);
  assert.equal(out.counts.roadSidewalkDecks,1);const top=pieces.find(p=>p.t==='strip'&&p.kind==='footpath') as Extract<Piece,{t:'strip'}>;
  assert.ok(top.edges[0]!.every(q=>Math.abs(q[2]-18.15)<1e-6));assert.equal(pieces.filter(p=>p.t==='box').length,0);
});
test('a union surface spanning a height step is opened to the ground; the check stops when repair is off',()=>{
  const step:Piece={t:'area',kind:'carriageway',info:3,rings:[[[0,0,10],[10,0,10],[10,4,10],[10,6,18],[10,10,18],[0,10,18],[0,6,18],[0,4,10]]]};
  const stop=carriagewaySeams([structuredClone(step)],{},()=>{},.25,.75,false);assert.ok(stop.counts.carriagewaySteepFacets>0);
  const pieces:Piece[]=[step],patches:Patch[]=[];const fixed=carriagewaySeams(pieces,{},p=>patches.push(p));
  assert.ok(fixed.worst.seamAreaRemovedM2>0&&fixed.worst.seamAreaRemovedM2<100&&pieces.length>0,String(fixed.worst.seamAreaRemovedM2));assert.equal(patches[0]!.algorithm,'open-seam-to-ground');
  assert.equal(carriagewaySeams(pieces,{},()=>{},.25,.75,false).counts.carriagewaySteepFacets,0);
});
test('footpaths: a road-following grade passes, 1:6 is kept and flagged, a bank is omitted',()=>{
  const along={tx:1,tz:0,grade:.1},follow=()=>along;
  const roadside:Piece={t:'area',kind:'footpath',info:1,rings:[[[0,0,0],[10,0,1],[10,2,1],[0,2,0]]]};
  assert.equal(footpathGrade([roadside],{},()=>{},1/12,follow).counts.footpathSteepFlagged,0);
  const steep:Piece={t:'area',kind:'footpath',info:2,rings:[[[0,0,0],[0,6,1],[2,6,1],[2,0,0]]]},kept=[steep];
  const r=footpathGrade(kept,{},()=>{},1/12,follow);assert.equal(r.counts.footpathSteepFlagged,1);assert.equal(r.counts.footpathFacetsOmitted,0);assert.equal(kept.length,1);
});
