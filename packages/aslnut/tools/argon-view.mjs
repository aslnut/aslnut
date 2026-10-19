// Evidence frames for reviews: named oblique and street views of the stage demo, both graphics.
//   VIEWS=views.json OUT=../.out/argon/v5 PHASE=after node tools/argon-view.mjs
// views.json: [{id, place, lon, lat, dist, tilt, bearing, hide?}] (place as in ?go=roads-<place>, 'clayton' = roads)
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {serve} from './serve.mjs';import {launch,settledFrame,bytesOf} from './browser.mjs';import {png} from './png.mjs';
const out=resolve(import.meta.dirname,process.env.OUT??'../.out/argon/v5'),phase=process.env.PHASE??'after';mkdirSync(out,{recursive:true});
const views=JSON.parse(readFileSync(resolve(process.env.VIEWS),'utf8')).filter(v=>!process.env.IDS||process.env.IDS.split(',').includes(v.id));
const baseline=process.env.BASELINE?resolve(process.env.BASELINE):null;
const port=Number(process.env.PORT??8431),srv=await serve(port),browser=await launch(),rows=[];
try{
for(const api of (process.env.GRAPHICS??'webgpu,webgl2').split(','))for(const place of [...new Set(views.map(v=>v.place))]){
 const page=await browser.newPage({viewport:{width:Number(process.env.WIDTH??960),height:Number(process.env.HEIGHT??540)}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 if(baseline)await page.route('**/packs/roads/*/**',async route=>{const p=new URL(route.request().url()).pathname.split('/packs/roads/')[1],f=join(baseline,p);if(existsSync(f)&&!p.includes('..'))await route.fulfill({path:f});else await route.continue();});
 try{
  const go=place==='clayton'?'roads':`roads-${place}`;
  await page.goto(`http://127.0.0.1:${port}/examples/roads/?go=${go}&stage=11&graphics=${api}&dpr=1&clock=30&shadows=${process.env.SHADOWS??1}`);
  await page.waitForFunction(()=>window.aslnutDemo?.w,null,{timeout:60000});await settledFrame(page);
  if(process.env.HIDE)await page.evaluate(async hide=>{const demo=window.aslnutDemo,old=demo.roads,next=new old.constructor({...old.props,id:old.id,hide:hide.split(',')});demo.w.remove(old.id);demo.w.add(next);demo.roads=next;await demo.w.settled({strict:true,timeout:180000});},process.env.HIDE);
  for(const v of views.filter(v=>v.place===place)){
   await page.evaluate(async v=>{const {w}=window.aslnutDemo;w.go({lon:v.lon,lat:v.lat,dist:v.dist,tilt:v.tilt,bearing:v.bearing});await w.settled({strict:true,timeout:180000});},v);
   const frame=await page.evaluate(async()=>{const f=await window.aslnutDemo.w.frame();let bin='';for(let i=0;i<f.pixels.length;i+=32768)bin+=String.fromCharCode(...f.pixels.subarray(i,i+32768));return {width:f.width,height:f.height,b64:btoa(bin)};});
   const name=`${phase}-${v.id}-${api}${process.env.HIDE?'-hide-'+process.env.HIDE.replaceAll(',','-'):''}${process.env.SHADOWS==='0'?'-noshadow':''}.png`;writeFileSync(join(out,name),png(frame.width,frame.height,bytesOf(frame)));rows.push({...v,api,phase,file:name,errors:[...errors]});console.log(name);
  }
 }finally{await page.close();}
}
}finally{await browser.close();srv.close();}
writeFileSync(join(out,`${phase}-views${process.env.IDS?'-'+process.env.IDS.replaceAll(',','_').slice(0,60):''}.json`),JSON.stringify(rows,null,2));
