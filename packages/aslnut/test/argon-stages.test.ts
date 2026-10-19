import { test } from 'node:test';
import assert from 'node:assert/strict';
import { solveRoads, BakeGateError, type Ground } from '../tools/compile/steps/solve.ts';
import { runStage01Terrain } from '../src/core/geometry/landform/terraform/hydrology.ts';
import { runStage02Stamps } from '../src/core/geometry/landform/terraform/stamps.ts';
import { runStage03Topology } from '../src/modules/world/earth/presets/built/roads/chaining.ts';
import { runStage04Alignment } from '../src/core/geometry/networks/alignment.ts';
import { runStage05Vertical, runStage06Banking } from '../src/core/geometry/networks/vertical.ts';
import { roadGraph } from '../src/modules/world/earth/presets/built/roads/graph.ts';
import type { RoadWay } from '../src/core/geometry/networks/graph.ts';
import { clampIndex } from '../src/modules/world/earth/presets/built/roads/baked.ts';
const origin:[number,number]=[145,-38],kx=111320*Math.cos(origin[1]*Math.PI/180);
const ll=(x:number,z:number):[number,number]=>[origin[0]+x/kx,origin[1]-z/110574];
const ground:Ground={x0:-400,z0:-400,step:4,nx:201,nz:201,data:new Float32Array(201*201).fill(20)};
const way=(id:number,nodes:number[],pts:[number,number][],tags:Record<string,string>):RoadWay=>({id,nodes,pts:pts.map(p=>ll(...p)),tags});
test('stages: measured knots, acute kinks and dangling service stubs survive default QA',()=>{
  const ways=[way(1,[1,2,3],[[-60,0],[0,0],[0,70]],{highway:'residential'}),way(2,[4,5],[[100,0],[110,0]],{highway:'service'})],g=roadGraph(ways,origin),qa=runStage03Topology(g),before=qa.chains.map(c=>structuredClone(c.pts));
  assert.equal(qa.gate.counts.prunedStubs,0);assert.ok(qa.gate.counts.flaggedDanglingStubs!>0);assert.ok(qa.gate.counts.flaggedAcuteKinks!>0);
  assert.ok(runStage04Alignment(qa.chains).gate.ok);assert.deepEqual(qa.chains.map(c=>c.pts),before);assert.equal(g.edges.size,2);
});
test('stages: incompatible class or lane count never chains through a degree-two node',()=>{
  const g=roadGraph([way(1,[1,2],[[-40,0],[0,0]],{highway:'residential',lanes:'2'}),way(2,[2,3],[[0,0],[40,0]],{highway:'primary',lanes:'4'})],origin);
  assert.equal(runStage03Topology(g).chains.length,2);
});
test('stages: upward orthonormal frames and null banking on town bridges',()=>{
  const g=roadGraph([way(1,[1,2,3],[[-100,0],[0,20],[100,0]],{highway:'secondary',bridge:'yes',layer:'1'})],origin),qa=runStage03Topology(g);runStage04Alignment(qa.chains);
  const v=runStage05Vertical(qa.chains,qa.jn,()=>20,[]);assert.ok(v.gate.ok);const f=runStage06Banking(qa.chains,v.st);assert.ok(f.gate.ok);assert.equal(f.gate.counts.bankedSections,0);
  for(const s of v.st.values())for(const p of s){assert.ok(p.uy!>0);assert.equal(p.bank,undefined);assert.ok(Math.abs(Math.hypot(p.rx!,p.ry!,p.rz!)-1)<1e-9);}
});
test('stages: hydro is derived and authored stairs have discrete treads, no invented quays',()=>{
  const raw=Array.from(ground.data),clamp={cells:[],edges:[]},hydro=runStage01Terrain(ground,[{id:1,pts:[[-40,0],[40,0]],kind:'river',width:20,covered:false,name:null}],(x,z)=>[x,z],clamp);
  assert.ok(hydro.gate.ok&&hydro.gate.counts.carvedCells!>0);assert.deepEqual(Array.from(ground.data),raw);const pieces:Parameters<typeof runStage02Stamps>[5]=[];
  const stamp=runStage02Stamps(hydro.ground,[{type:'STAIRS',cx:0,cz:40,angle:0,halfL:5,halfW:1,yBot:20,yTop:21}],[],hydro.waters,(x,z)=>[x,z],pieces,()=>0);
  assert.ok(stamp.gate.ok);assert.equal(stamp.gate.counts.quays,0);assert.ok(pieces.filter(p=>p.t==='box').length>=6);
});
test('stages: invalid DEM stops at Stage 01 and carries its failed QA record',()=>{
  assert.throws(()=>solveRoads([],origin,{...ground,data:new Float32Array(3)}),e=>e instanceof BakeGateError&&e.gate.stage===1&&e.stages.length===1);
});
test('terrain guard includes cell vertices and borders at fine and coarse samples',()=>{
  const ix=clampIndex({v:3,origin,cells:[[1,4,0,0,20,20,0,22,20,20,22,0,20,20]],edges:[]});
  for(const [x,z] of [[0,0],[20,0],[20,20],[0,20],[10,0],[20,10],[10,10]])assert.ok(ix.limit(x!,z!,.5,14)!<=22-.3,`guard misses ${x},${z}`);
});

test('banking: positive right-turn curvature lowers the inside right edge',()=>{
  const g=roadGraph([way(1,[1,2,3],[[-140,-40],[0,0],[140,100]],{highway:'motorway',bridge:'yes',layer:'1',maxspeed:'80'})],origin),qa=runStage03Topology(g);runStage04Alignment(qa.chains);
  const v=runStage05Vertical(qa.chains,qa.jn,()=>20,[]);assert.ok(v.gate.ok);const f=runStage06Banking(qa.chains,v.st,{banking:true});assert.ok(f.gate.ok);
  const rolled=[...v.st.values()].flat().filter(p=>(p.bank??0)>.001);assert.ok(rolled.length>0);for(const p of rolled)assert.ok(p.ry!<0&&p.uy!>0);
});

test('patch policies: path clipping preserves raw geometry and survives in feature properties',()=>{
  const paths=[{pts:[ll(-30,0),ll(30,20)],tags:{highway:'footway',osm_id:'path-1'}}],raw=structuredClone(paths);
  const s=solveRoads([way(1,[1,2],[[-80,0],[80,0]],{highway:'residential'})],origin,ground,{paths});
  assert.deepEqual(paths,raw);
  const gate=s.report.stages.find(g=>g.stage===9)!;
  assert.ok(gate.patches?.some(p=>p.check==='path-clip'&&p.ids.includes('path-1')&&p.policy==='repair'));
  const i=s.infos.find(i=>i.props.patched&&(i.props.osm==='path-1'||Array.isArray(i.props.osm)&&i.props.osm.includes('path-1')));
  assert.ok(i&&i.props.source);assert.ok(s.pieces.some(p=>p.info===s.infos.indexOf(i)));
});
test('patch policies: stop rejects a needed path repair, omit excludes its surface explicitly',()=>{
  const ways=[way(1,[1,2],[[-80,0],[80,0]],{highway:'residential'})],paths=[{pts:[ll(-30,0),ll(30,20)],tags:{highway:'footway',osm_id:'path-1'}},{pts:[ll(-30,40),ll(30,40)],tags:{highway:'footway',osm_id:'path-2'}}];
  assert.throws(()=>solveRoads(ways,origin,ground,{paths,options:{patches:{'path-clip':'stop'}}}),e=>e instanceof BakeGateError&&e.gate.stage===9&&e.gate.checks!.some(c=>c.check==='path-clip'&&c.policy==='stop'));
  const s=solveRoads(ways,origin,ground,{paths,options:{patches:{'path-clip':'omit'}}});
  assert.ok(s.report.stages[8]!.patches?.some(p=>p.ids.includes('path-1')&&p.policy==='omit'));
  assert.ok(s.infos.some(i=>i.props.omitted&&i.props.source));
});

test('terrain guard bounds coarse-sample margins across a height seam',()=>{
  const ix=clampIndex({v:3,origin,cells:[[1,4,0,0,20,.06,0,21,.06,10,21,0,10,20]],edges:[[0,0,20,.06,0,21]]});
  const limit=ix.limit(.03,5,.5,14,8);
  assert.ok(limit!==null&&limit>14,`unbounded seam guard ${limit}`);
});

test('review: documented defaults and public compile patch overrides',async()=>{
  const {DEFAULT_PATCHES,patchPolicy,gateChecks}=await import('../src/core/runtime/workers/compile/patch-policy.ts');
  const {compile}=await import('../src/tools.ts');
  // stages 1–11 repair by default; stages 12–15 as the documented table: omit for no frontage or no height, stop for a floating foundation
  const D=DEFAULT_PATCHES as Record<string,{policy:string}>;
  assert.deepEqual(Object.entries(D).filter(([,p])=>p.policy!=='repair').map(([k,p])=>`${k}:${p.policy}`),['frontage:omit','pad-floating:stop','tree-valid:omit']);
  assert.equal(Object.keys(D).length,31);
  assert.equal(DEFAULT_PATCHES['profile-convergence'].algorithm,'relax-in-order');
  assert.equal(DEFAULT_PATCHES['profile-convergence'].fallback,'stop');
  assert.equal(patchPolicy({patch:{'deck-clearance':'stop'}},'deck-clearance','repair'),'stop');
  assert.equal(patchPolicy({patch:{'path-clip':p=>p.ids.includes('path-1')?'omit':'repair'}},'path-clip','repair',['path-1']),'omit');
  const ways=[way(1,[1,2],[[-80,0],[80,0]],{highway:'residential'})],paths=[{pts:[ll(-30,0),ll(30,20)],tags:{highway:'footway',osm_id:'path-1'}}];
  assert.throws(()=>compile({ways,origin,ground,patch:{'path-clip':'stop'},extras:{paths}}),e=>e instanceof BakeGateError&&e.gate.stage===9);
  const gate={stage:5,id:'vertical',name:'vertical',ok:true,counts:{},worst:{residual:0},flagged:[],errors:[]};
  assert.equal(gateChecks(gate).find(c=>c.check==='profile-convergence')!.policy,'repair');
});

test('review: visibility samples interiors and detects low cover while allowing an overpass',async()=>{
  const {carriagewayVisibility}=await import('../src/core/geometry/networks/facets.ts');
  const road:import('../src/core/geometry/networks/bake-types.ts').Piece={t:'area',kind:'carriageway',info:1,rings:[[[0,0,10],[20,0,10],[20,20,10],[0,20,10]]]};
  const path:import('../src/core/geometry/networks/bake-types.ts').Piece={t:'area',kind:'footpath',info:2,rings:[[[5,5,11],[15,5,11],[15,15,11],[5,15,11]]]};
  const covered=carriagewayVisibility([road,path],(x,z)=>x>4&&x<16&&z>4&&z<16?11:9);
  assert.ok(covered.counts.terrainCoverFailures>0);
  assert.ok(covered.counts.pieceCoverFailures>0);
  assert.ok(covered.ids.includes(1)&&covered.ids.includes(2));
  assert.ok(carriagewayVisibility([road,{...path,kind:'cut-top'}],()=>9).counts.pieceCoverFailures>0,'the check covers arbitrary physical piece kinds');
  const {FacetIndex,facetsOf}=await import('../src/core/geometry/networks/facets.ts');
  const fan:import('../src/core/geometry/networks/bake-types.ts').Piece={t:'poly',kind:'cut-top',info:3,fan:true,ring:[[10,10,11],[5,5,11],[15,5,11],[15,15,11],[5,15,11]]};
  assert.ok(new FacetIndex(facetsOf([fan])).at(5.5,10).length>0,'the left fan wedge is present just as in the device mesh');
  const deck={...path,overhead:true,kind:'carriageway',rings:path.rings.map(r=>r.map(p=>[p[0],p[1],18] as [number,number,number]))};
  assert.equal(carriagewayVisibility([road,deck],()=>9).counts.pieceCoverFailures,0);
});

test('review: numeric tiles preserve declared levels and overhead footprints for geometry checks',async()=>{
  const {bakedPieces}=await import('../src/modules/world/earth/presets/built/roads/baked.ts');
  const {encodeNumbers}=await import('../src/core/data/loading/chunks/numbers.ts');
  const row=[4,0,0,0,1,4,0,0,20,10,0,20,10,10,20,0,10,20];
  const pieces=bakedPieces({v:3,ix:1,iz:-2,size:500,infos:[{kind:'road',props:{}}],pieces:[],numeric:encodeNumbers([row,row],100),numericScale:100,levels:[[0,-1],[1,1]],overhead:[1]},['carriageway']);
  assert.ok(pieces[0]?.t==='area'&&pieces[1]?.t==='area');
  assert.equal(pieces[0].level,-1);assert.equal(pieces[1].level,1);
  assert.equal(pieces[0].overhead,false);assert.equal(pieces[1].overhead,true);
  assert.deepEqual(pieces[0].rings[0]![0],[500,-1000,20]);
});

test('review: terrain cover repair is audited, and stop refuses to publish',async()=>{
  const {runStage11Earthworks}=await import('../src/core/geometry/landform/compose/earthworks.ts');
  const pieces:import('../src/core/geometry/networks/bake-types.ts').Piece[]=[{t:'area',kind:'carriageway',info:1,rings:[[[0,0,10],[20,0,10],[20,20,10],[0,20,10]]]}];
  const dem={x0:0,z0:0,step:10,nx:3,nz:3,data:new Float32Array(9).fill(11)};
  const report={portals:0} as import('../src/core/geometry/networks/bake-types.ts').SolveReport;
  const changes:import('../src/core/runtime/workers/compile/patch-policy.ts').Patch[]=[];
  const repaired=runStage11Earthworks([],()=>11,new Map(),pieces,{cells:[],edges:[]},report,dem,{},p=>changes.push(p));
  assert.ok(repaired.gate.ok);
  assert.ok(changes.some(p=>p.check==='carriageway-visible'&&p.counts.cells!>0&&p.ids.includes('1')));
  const stopped=runStage11Earthworks([],()=>11,new Map(),pieces,{cells:[],edges:[]},report,dem,{patch:{'carriageway-visible':'stop'}});
  assert.equal(stopped.gate.ok,false);
  assert.ok(stopped.gate.counts.terrainCoverFailures!>0);
});

test('review: visibility omission removes an optional covering path and records its source',async()=>{
  const {runStage11Earthworks}=await import('../src/core/geometry/landform/compose/earthworks.ts');
  const pieces:import('../src/core/geometry/networks/bake-types.ts').Piece[]=[
    {t:'area',kind:'carriageway',info:1,rings:[[[0,0,10],[20,0,10],[20,20,10],[0,20,10]]]},
    {t:'area',kind:'footpath',info:2,rings:[[[5,5,11],[15,5,11],[15,15,11],[5,15,11]]]},
  ];
  const dem={x0:0,z0:0,step:10,nx:3,nz:3,data:new Float32Array(9).fill(9)};
  const changes:import('../src/core/runtime/workers/compile/patch-policy.ts').Patch[]=[];
  const result=runStage11Earthworks([],()=>9,new Map(),pieces,{cells:[],edges:[]},{portals:0} as import('../src/core/geometry/networks/bake-types.ts').SolveReport,dem,{patch:{'carriageway-visible':'omit'}},p=>changes.push(p));
  assert.ok(result.gate.ok);
  assert.equal(pieces.length,1);
  assert.ok(changes.some(p=>p.policy==='omit'&&p.ids.includes('2')));
});
test('review: compact numeric rows round-trip signed positions, headers and milliradian turns',async()=>{
  const {encodeNumbers,decodeNumbers}=await import('../src/core/data/loading/chunks/numbers.ts');
  const rows=[[3,1,7,-40.01,200.02,35.5,46,1.5,1.9,-.731],[],[1,2,3,1,2,3]];
  assert.deepEqual(decodeNumbers(encodeNumbers(rows)),rows);
  assert.throws(()=>decodeNumbers([btoa(String.fromCharCode(128))]),/Truncated/);
});
test('review: paint follows road facets rather than cutting through a curved height field',async()=>{
  const {drapePaint}=await import('../src/core/geometry/networks/paint.ts');
  const pieces:import('../src/core/geometry/networks/bake-types.ts').Piece[]=[
    {t:'area',kind:'carriageway',info:0,rings:[[[0,0,10],[10,0,12],[10,10,11],[0,10,10]]]},
    {t:'strip',kind:'marking',info:0,edges:[[[1,4,10],[9,4,10]],[[1,4.1,10],[9,4.1,10]]]},
  ];
  drapePaint(pieces);const paint=pieces.filter(p=>p.kind==='marking');assert.ok(paint.length>=2);
  for(const p of paint){assert.equal(p.t,'poly');if(p.t==='poly')for(const q of p.ring)assert.ok(q[2]>10&&q[2]<12.1);}
});
test('review: snapshots contain real intermediate stages before later structures exist',()=>{
  const s=solveRoads([way(1,[1,2],[[-100,0],[100,0]],{highway:'primary',bridge:'yes',layer:'1'})],origin,ground,{options:{snapshots:true}});
  assert.deepEqual(s.snapshots!.map(s=>s.stage),[1,2,3,4,5,6,7,8,9,10]);
  for(const snap of s.snapshots!)assert.deepEqual(snap.gates.map(g=>g.stage),Array.from({length:snap.stage},(_,i)=>i+1));
  assert.ok(s.snapshots![0]!.pieces.some(p=>p.t==='strip'));
  assert.ok(!s.snapshots![6]!.pieces.some(p=>['pier','deck','kerb'].includes(p.kind)));
  assert.ok(s.snapshots![7]!.pieces.some(p=>p.kind==='deck'));
  assert.ok(!s.snapshots![8]!.pieces.some(p=>p.kind==='pier'));
  assert.ok(s.snapshots![9]!.pieces.some(p=>p.kind==='pier'));
  assert.notEqual(s.snapshots![9]!.clamp.terrain!.data,s.clamp.terrain!.data);
  assert.notEqual(s.snapshots![8]!.pieces,s.pieces);
});
test('review: motorway markings stay on lanes, and old crossing tags keep their zebra bars',()=>{
  const motorway=solveRoads([way(1,[1,2],[[-100,0],[100,0]],{highway:'motorway',oneway:'yes',lanes:'2'})],origin,ground);
  const lanePaint=motorway.pieces.filter(p=>p.kind==='marking');assert.ok(lanePaint.length>0);
  for(const p of lanePaint){assert.equal(p.t,'poly');if(p.t==='poly')for(const q of p.ring)assert.ok(Math.abs(q[1])<.15,'carriageway edge was painted');}
  const crossing=solveRoads([way(1,[1,2],[[-100,0],[100,0]],{highway:'residential'})],origin,ground,{crossings:[{at:ll(0,0),tags:{highway:'crossing',crossing:'uncontrolled'}}]});
  const zebra=crossing.pieces.filter(p=>p.kind==='marking');assert.ok(zebra.length>=5);
  for(const p of zebra)if(p.t==='poly')assert.ok(Math.max(...p.ring.map(q=>q[0]))-Math.min(...p.ring.map(q=>q[0]))<=3.1);
});
test('review: centimetre tile rows retain milliradian box turns',async()=>{
  const {encodeNumbers,decodeTile}=await import('../src/core/data/loading/chunks/numbers.ts');
  const row=[3,1,7,-40.01,200.02,35.5,46,1.5,1.9,-.731];
  const tile={pieces:[] as number[][],numericScale:100,turnUnits:10,numeric:encodeNumbers([row.map((v,i)=>i===9?v*10:v)],100)};
  const decoded=decodeTile(tile).pieces[0]!;for(let i=0;i<row.length;i++)assert.ok(Math.abs(row[i]!-decoded[i]!)<1e-12);
});
