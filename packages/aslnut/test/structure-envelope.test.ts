import {test} from 'node:test';import assert from 'node:assert/strict';
import {structureEnvelope} from '../src/core/geometry/networks/structures/envelope.ts';
import {footpathGrade} from '../src/core/geometry/networks/structures/footpath-grade.ts';
import type {Piece} from '../src/core/geometry/networks/bake-types.ts';
import type {Patch} from '../src/core/runtime/workers/compile/patch-policy.ts';
const road:Piece={t:'area',kind:'carriageway',info:0,rings:[[[-20,-6,20],[20,-6,20],[20,6,20],[-20,6,20]]]};
test('a full abutment is split around the complete lower carriageway, including its outside lanes',()=>{
 const pieces:Piece[]=[structuredClone(road),{t:'wall',kind:'abutment',info:1,line:[[0,-12,29,18],[0,12,29,18]]}],patches:Patch[]=[];
 const result=structureEnvelope(pieces,{},p=>patches.push(p));assert.equal(result.counts.structureClearanceFailures,0);assert.equal(patches.length,1);assert.ok(patches[0]!.worst.removedLengthM!>=12);
 const check=structureEnvelope(pieces,{},()=>{},false);assert.equal(check.counts.structureClearanceFailures,0);assert.equal(check.errors.length,0);
 const walls=pieces.filter(p=>p.t==='wall');assert.equal(walls.length,2);for(const w of walls)assert.ok(w.line.every(q=>Math.abs(q[1])>=6));
});
test('stop preserves a clearance conflict, and a solid above 5.5 metres passes',()=>{
 const bad:Piece={t:'box',kind:'pier',info:1,at:[0,0,18],top:29,w:2,d:2,turn:.65};
 assert.ok(structureEnvelope([road,bad],{patch:{'structure-clearance':'stop'}}).counts.structureClearanceFailures>0);
 const good={...bad,at:[0,0,25.5] as [number,number,number]};assert.equal(structureEnvelope([road,good]).counts.structureClearanceFailures,0);
});
test('a sloping slab cannot leave a low corner inside the lower road envelope',()=>{
 const slab:Piece={t:'area',kind:'deck-under',info:1,down:true,rings:[[[-2,-12,24],[2,-12,24],[2,12,29],[-2,12,29]]]};
 const pieces=[road,slab];const changes:Patch[]=[];structureEnvelope(pieces,{},p=>changes.push(p));assert.equal(changes.length,1);
 assert.equal(structureEnvelope(pieces,{},()=>{},false).counts.structureClearanceFailures,0);
});
test('a path climbing a bank is flagged and its unsafe walking facets are omitted; stop leaves the failure',()=>{
 const p:Piece={t:'area',kind:'footpath',info:1,rings:[[[0,0,20],[10,0,25],[10,2,25],[0,2,20]]]};const pieces=[p];const changes:Patch[]=[];
 const result=footpathGrade(pieces,{},c=>changes.push(c));assert.equal(result.counts.footpathSteepFlagged,1);assert.equal(result.counts.footpathGradeFailures,0);assert.equal(pieces.length,0);assert.equal(changes[0]!.check,'footpath-grade');
 assert.ok(footpathGrade([p],{patch:{'footpath-grade':'stop'}}).counts.footpathGradeFailures>0);
});
