import { councilFootpathWidth, roadFeatures, pathFeatures, reserveFeatures, waterFeatures } from '../../../src/modules/world/earth/presets/built/roads/inputs.ts';
// tools › compile › run › command: the compile from the command line. Roads: each test place's ways and ground in
// data/packs/roads/<place>.{geojson,ground.json,ground.f32}, its paths (.paths.geojson) and road reserves
// (.reserve.geojson) where it has them, solved (steps › solve) and written as baked tiles (steps › manifest) to
// data/packs/roads/<place>/ (index.json, ix_iz.json, clamp.json, walk.json). Then stages 12–15 (steps › built): the
// buildings and trees of the city's street-level tiles (data/packs/city/tiles, where they cover the place) and the
// place's furniture (.furniture.geojson) placed against the final roads, written as placement tiles to
// data/packs/roads/<place>/built/ (and what stages 11–14 left to data/packs/roads-stages/<place>/<stage>/).
//   node tools/compile/run/command.ts roads [place …]
import { existsSync, readFileSync, readdirSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { solveRoads, BakeGateError, type Ground, type SolveOptions } from '../steps/solve.ts';
import { roadSources } from '../../../src/modules/world/earth/presets/built/roads/sources.ts';
import { writeTiles } from '../steps/manifest.ts';
import { bakeBuilt, builtTiles, cityInputs, furnitureInputs, type BuiltInputs } from '../steps/built.ts';
import { gzipSync } from 'node:zlib';
import { encodeNumbers } from '../../../src/core/data/loading/chunks/numbers.ts';

const DIR = join(import.meta.dirname, '..', '..', '..', '..', '..', 'data', 'packs', 'roads');
const [what = 'roads', ...only] = process.argv.slice(2);
if (what !== 'roads') { console.error(`nothing to compile for '${what}' (roads)`); process.exit(1); }
const places = only.length ? only : readdirSync(DIR).filter((f) => f.endsWith('.geojson') && !/\.(paths|reserve|water|furniture)\.geojson$/.test(f)).map((f) => f.slice(0, -8));
const councilFile=join(DIR,'..','city','councils.geojson');
const footpathWidth=councilFootpathWidth(existsSync(councilFile)?JSON.parse(readFileSync(councilFile,'utf8')).features:[]);
// the street level's tiles (buildings, trees, open space, water) and each place's furniture: stages 12–15's inputs
const CITY=join(DIR,'..','city','tiles'),cityIndex=existsSync(join(CITY,'index.json'))?JSON.parse(readFileSync(join(CITY,'index.json'),'utf8')):null;
const overlaps=(a:number[],b:number[])=>a[0]!<b[2]!&&a[2]!>b[0]!&&a[1]!<b[3]!&&a[3]!>b[1]!;
function builtInputs(place:string,origin:[number,number],bbox:number[]):BuiltInputs{
  const tiles=cityIndex&&overlaps(cityIndex.bbox,bbox)?(cityIndex.tiles as [number,number][]).map(([ix,iz])=>JSON.parse(readFileSync(join(CITY,`${ix}_${iz}.json`),'utf8'))):[];
  const city=tiles.length?cityInputs(cityIndex,tiles,origin,bbox):{buildings:[],trees:[],roads:[],parks:[],water:[],streams:[],sources:{},attribution:''};
  const ff=join(DIR,`${place}.furniture.geojson`),furniture=existsSync(ff)?JSON.parse(readFileSync(ff,'utf8')):null;
  return {...city,furniture:furniture?furnitureInputs(furniture.features,origin):[],sources:{...city.sources,...(furniture?{furniture:{title:'OpenStreetMap street furniture and poles',licence:'ODbL © OpenStreetMap contributors'}}:{})},attribution:[city.attribution,furniture?.attribution].filter(Boolean).join(' · ')};
}
const writeJson=(file:string,o:unknown)=>{const s=JSON.stringify(o);mkdirSync(dirname(file),{recursive:true});writeFileSync(file,s);writeFileSync(`${file}.gz`,gzipSync(s));return Buffer.byteLength(s);};
const writeBuilt=(dir:string,b:ReturnType<typeof builtTiles>)=>{rmSync(dir,{recursive:true,force:true});let bytes=writeJson(join(dir,'index.json'),b.index);for(const [k,t] of b.tiles)bytes+=writeJson(join(dir,`${k}.json`),t);return bytes;};
for (const place of places) {
  const t0 = performance.now();
  const doc = JSON.parse(readFileSync(join(DIR, `${place}.geojson`), 'utf8'));
  const hd = JSON.parse(readFileSync(join(DIR, `${place}.ground.json`), 'utf8')); hd.origin = [hd.origin.lon, hd.origin.lat];
  const buf = readFileSync(join(DIR, `${place}.ground.f32`));
  const ground: Ground = { x0: hd.x0, z0: hd.z0, step: hd.step, nx: hd.nx, nz: hd.nz, data: new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4) };
  const {ways,crossings}=roadFeatures(doc.features);
  const read = (f: string) => (existsSync(join(DIR, f)) ? JSON.parse(readFileSync(join(DIR, f), 'utf8')).features : []);
  const paths=pathFeatures(read(`${place}.paths.geojson`));
  const reserves=reserveFeatures(read(`${place}.reserve.geojson`));
  const waterways=waterFeatures(read(`${place}.water.geojson`));
  const stampsFile=join(DIR,`${place}.stamps.json`),stamps=existsSync(stampsFile)?JSON.parse(readFileSync(stampsFile,'utf8')):[];
  const optionsFile=process.env.BAKE_OPTIONS,options:SolveOptions={place,snapshots:true,...(optionsFile?JSON.parse(readFileSync(optionsFile,'utf8')):{})};
  let solved;
  try { solved=solveRoads(ways,hd.origin,ground,{crossings,paths,reserves,footpathWidth,waterways,stamps,options}); }
  catch(e) { if(e instanceof BakeGateError)writeFileSync(join(DIR,`${place}.failed-report.json`),JSON.stringify({place,stages:e.stages,repairs:e.repairs,error:e.message},null,2)); throw e; }
  // stages 12–15: what stands on the place, against the final roads (the composed ground graded under the pads)
  const inputs=builtInputs(place,hd.origin,doc.bbox);
  let built;
  try { built=bakeBuilt({pieces:solved.pieces,reserve:solved.verge.R,clamp:solved.clamp,inputs,stages:solved.report.stages,options:{...options,place,snapshots:true}}); }
  catch(e) { if(e instanceof BakeGateError)writeFileSync(join(DIR,`${place}.failed-report.json`),JSON.stringify({place,stages:e.stages,error:e.message},null,2)); throw e; }
  // the full record of stages 12–15 (every source id of every patch) beside the place's inputs; the pack's index keeps
  // each patch's counts, worst values and its first 20 ids (every piece carries its own patches in the placement tiles)
  writeFileSync(join(DIR,`${place}.built-report.json`),JSON.stringify({place,stages:built.gates}));
  for(const g of built.gates)for(const p of g.patches??[])if(p.ids.length>20){p.moved={...p.moved,idsListed:20,ids:p.ids.length};p.ids=p.ids.slice(0,20);}
  const out = writeTiles(join(DIR, place), { origin: hd.origin, bbox: doc.bbox, attribution: doc.attribution, ground: hd.source, sources:roadSources(hd.source), solved });
  for(const snap of solved.snapshots??[])writeTiles(join(DIR,'..','roads-stages',place,String(snap.stage)),{origin:hd.origin,bbox:doc.bbox,attribution:doc.attribution,ground:hd.source,sources:roadSources(hd.source),solved:{...solved,snapshots:undefined,pieces:snap.pieces,infos:snap.infos,clamp:snap.clamp,walk:[],report:{...solved.report,stages:snap.gates}}});
  // the placement (stage 15 = the final), what stages 12–14 left, and stage 11's ground (before the pads) over the final clamp's tiles
  const builtArgs={origin:hd.origin,bbox:doc.bbox,attribution:inputs.attribution,sources:inputs.sources,gates:built.gates};
  const builtBytes=writeBuilt(join(DIR,place,'built'),builtTiles({...builtArgs,placement:built,ground:inputs}));
  for(const snap of built.snapshots)writeBuilt(join(DIR,'..','roads-stages',place,String(snap.stage),'built'),builtTiles({...builtArgs,placement:snap.placement,ground:inputs,gates:built.gates.filter(g=>g.stage<=snap.stage)}));
  if(built.terrain11){const s11=join(DIR,'..','roads-stages',place,'11');rmSync(s11,{recursive:true,force:true});const clamp=JSON.parse(readFileSync(join(DIR,place,'clamp.json'),'utf8'));writeJson(join(s11,'clamp.json'),{...clamp,terrain:'terrain.json',tilesFrom:`../../../roads/${place}/`});const g=built.terrain11;writeJson(join(s11,'terrain.json'),{...g,data:undefined,numeric:encodeNumbers([Array.from(g.data,(v)=>Math.round(v*100)/100)],100)});}
  rmSync(join(DIR,`${place}.failed-report.json`),{force:true});
  const gs=built.gates;
  console.log(`${place} built: plots ${gs[0]!.counts.plots} (${gs[0]!.counts.housesWithoutFrontage} houses without a property line) · buildings ${gs[1]!.counts.buildings}/${gs[1]!.counts.source} (clipped ${gs[1]!.counts.clipped}, set back ${gs[1]!.counts.setback}, off paths ${gs[1]!.counts.pathClipped}, off others ${gs[1]!.counts.overlapClipped}, pads raised ${gs[1]!.counts.padsRaised}, left out ${gs[1]!.counts.omittedPieces}) · trees ${gs[2]!.counts.trees}/${gs[2]!.counts.source} (nudged ${gs[2]!.counts.nudged}, left out ${gs[2]!.counts.omittedPieces}) · furniture ${gs[3]!.counts.furniture}/${gs[3]!.counts.source} (nudged ${gs[3]!.counts.nudged}, left out ${gs[3]!.counts.omittedPieces}) → ${(builtBytes/1e6).toFixed(2)} MB`);
  const r = solved.report;
  console.log(`${place}: ${r.roads} roads · ${r.levels} levels (${r.lifted} roads moved half a level) · ${r.zones} junction zones (${r.planar} planar) · ${r.holes} holes · ${r.bridges} on decks · ${r.tunnels} in tunnels (${r.portals} portals) · ${solved.pieces.length} pieces → ${out.tiles} tiles, ${(out.bytes / 1e6).toFixed(2)} MB · invalid ${r.invalid} · slivers ${r.slivers} · kerb ${(r.kerbLength / 1000).toFixed(1)} km, off ${r.kerbOutside}, across ${r.kerbCrossings} · z-fight ${r.zfight} · verges (reserve from ${r.reserveFrom || '—'}; ${r.reserveRules} roads by the rules): footpaths ${(r.footpathArea / 1e4).toFixed(2)} ha (${r.sidewalksMapped} mapped), strips ${(r.vergeArea / 1e4).toFixed(2)} ha, ${r.crossings} crossings, overlaps ${r.vergeOverlap}, slivers ${r.vergeSlivers} · walking graph ${r.walk ? `${r.walk.edges} edges, ${(r.walk.length / 1000).toFixed(1)} km` : '—'} · steep ${r.steep.length} · clearance ${r.clearance.least?.toFixed(1) ?? '—'} m (${r.clearance.short.length} short) · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
}
