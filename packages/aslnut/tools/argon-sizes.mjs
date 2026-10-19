// Actual pack bytes and encoded piece bytes, compared with the tag and reviewed bake.
import {readFileSync,readdirSync,statSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {decodeNumbers} from '../src/core/data/loading/chunks/numbers.ts';
const ROOT=join(import.meta.dirname,'../../../data/packs'),OUT=join(import.meta.dirname,'../.out/argon/v2');
const sumFiles=dir=>readdirSync(dir,{withFileTypes:true}).reduce((sum,f)=>sum+(f.isDirectory()?sumFiles(join(dir,f.name)):f.name.endsWith('.gz')?0:statSync(join(dir,f.name)).size),0);
const measure=dir=>{
 const index=JSON.parse(readFileSync(join(dir,'index.json'),'utf8')),kinds={},count={};let infos=0;
 for(const f of readdirSync(dir).filter(f=>/^-?\d+_-?\d+\.json$/.test(f))){
  const tile=JSON.parse(readFileSync(join(dir,f),'utf8')),pieces=tile.numeric?decodeNumbers(tile.numeric,tile.numericScale??1000):tile.pieces;
  infos+=Buffer.byteLength(JSON.stringify(tile.infos));
  pieces.forEach((p,i)=>{const kind=index.kinds[p[1]],bytes=Buffer.byteLength(JSON.stringify(tile.numeric?tile.numeric[i]:p));kinds[kind]=(kinds[kind]??0)+bytes;count[kind]=(count[kind]??0)+1;});
 }
 return{bytes:sumFiles(dir),kinds,pieces:count,infos,clamp:sumFiles(join(dir,'clamp')),terrain:readdirSync(dir).includes('terrain.json')?statSync(join(dir,'terrain.json')).size:0,report:Buffer.byteLength(JSON.stringify(index.report))};
};
const old={},after={};for(const place of ['clayton','interchange','bridge','elevated','tunnel','roundabout','arterial','street']){old[place]=measure(join(ROOT,'roads-old',place));after[place]=measure(join(ROOT,'roads',place));console.log(`${place}: ${(old[place].bytes/1e6).toFixed(3)} -> ${(after[place].bytes/1e6).toFixed(3)} MB`);if(after[place].bytes>old[place].bytes)throw new Error(`${place}: pack exceeds old size`);}
writeFileSync(join(OUT,'sizes-old.json'),JSON.stringify(old,null,2));writeFileSync(join(OUT,'sizes-after.json'),JSON.stringify(after,null,2));
