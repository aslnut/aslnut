// Review 3: connected measured decks, street cameras and unmodified graphics readbacks.
import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {serve} from './serve.mjs';import {launch,settledFrame,bytesOf} from './browser.mjs';import {png} from './png.mjs';
const out=join(import.meta.dirname,process.env.OUT??'../.out/argon/v4'),root=join(import.meta.dirname,'../../../data/packs/roads'),phase=process.env.PHASE??'before';
mkdirSync(out,{recursive:true});
const places=['clayton','interchange','bridge','elevated','tunnel','roundabout','arterial','street'];
const file=join(out,'cameras.json');let cameras=[];
if(existsSync(file)&&process.env.REINVENTORY!=='1')cameras=JSON.parse(readFileSync(file,'utf8'));else for(const place of places){
 const doc=JSON.parse(readFileSync(join(root,`${place}.geojson`),'utf8')),origin=JSON.parse(readFileSync(join(root,place,'index.json'),'utf8')).origin,kx=111320*Math.cos(origin[1]*Math.PI/180);
 const local=q=>[(q[0]-origin[0])*kx,-(q[1]-origin[1])*110574],ll=q=>[origin[0]+q[0]/kx,origin[1]-q[1]/110574];
 let paths=[];const pf=join(root,`${place}.paths.geojson`);if(existsSync(pf))paths=JSON.parse(readFileSync(pf,'utf8')).features;
 const fs=[...doc.features,...paths].filter(f=>f.geometry.type==='LineString').map(f=>({...f,pts:f.geometry.coordinates.map(local)}));
 const bs=fs.filter(f=>f.properties.bridge&&f.properties.bridge!=='no');const visited=new Set();let serial=0;
 for(const first of bs){if(visited.has(first))continue;const group=[first];visited.add(first);for(let i=0;i<group.length;i++)for(const next of bs){if(visited.has(next))continue;const ends=[group[i].pts[0],group[i].pts.at(-1)],ne=[next.pts[0],next.pts.at(-1)];if(ends.some(a=>ne.some(b=>Math.hypot(a[0]-b[0],a[1]-b[1])<.1))){group.push(next);visited.add(next);}}
 const ids=group.map(f=>String(f.properties.osm_id??f.id)),crossings=[];
 for(const upper of group)for(let i=1;i<upper.pts.length;i++)for(const lower of fs){if(group.includes(lower)||Number(lower.properties.layer??0)>=Number(upper.properties.layer??1)||lower.properties.highway==='footway'||lower.properties.highway==='cycleway')continue;
  for(let j=1;j<lower.pts.length;j++){const a=upper.pts[i-1],b=upper.pts[i],c=lower.pts[j-1],d=lower.pts[j],rx=b[0]-a[0],rz=b[1]-a[1],sx=d[0]-c[0],sz=d[1]-c[1],den=rx*sz-rz*sx;if(Math.abs(den)<1e-8)continue;const t=((c[0]-a[0])*sz-(c[1]-a[1])*sx)/den,u=((c[0]-a[0])*rz-(c[1]-a[1])*rx)/den;
   if(t<.01||t>.99||u<.01||u>.99)continue;const at=[a[0]+t*rx,a[1]+t*rz];if(crossings.some(q=>Math.hypot(q.at[0]-at[0],q.at[1]-at[1])<25))continue;const L=Math.hypot(sx,sz);crossings.push({at,dir:[sx/L,sz/L],lowerId:String(lower.properties.osm_id??lower.id),lowerName:lower.properties.name});
  }
 }
 // Decks over water/rail have no lower carriageway. Still inspect their approaches from road eye height.
 if(!crossings.length){const f=group[Math.floor(group.length/2)],a=f.pts[0],b=f.pts.at(-1),L=Math.hypot(b[0]-a[0],b[1]-a[1]);crossings.push({at:[(a[0]+b[0])/2,(a[1]+b[1])/2],dir:[(b[0]-a[0])/L,(b[1]-a[1])/L],approach:true});}
 for(const c of crossings){const target=ll(c.at),eye=ll([c.at[0]-c.dir[0]*65,c.at[1]-c.dir[1]*65]);cameras.push({place,id:`${place}-${++serial}`,sourceIds:ids,...c,target,eye,bearing:(Math.atan2(c.dir[0],-c.dir[1])*180/Math.PI+360)%360});}
 }
 // Visible tunnel mouths are reviewed as road approaches too.
 if(place==='tunnel')cameras.push({place,id:'tunnel-mouth',sourceIds:[],target:[145.0039,-37.8297],eye:[145.0045,-37.8295],bearing:250,portal:true});
}
cameras=cameras.filter(c=>!c.approach);writeFileSync(file,JSON.stringify(cameras,null,2));
if(process.env.INVENTORY==='1'){console.log(cameras.reduce((n,c)=>(n[c.place]=(n[c.place]??0)+1,n),{}));process.exit(0);}
const heights=JSON.parse(readFileSync(join(out,`heights-${phase}.json`),'utf8'));
const port=Number(process.env.PORT??8420),srv=await serve(port),browser=await launch(),rows=[];
for(const api of (process.env.GRAPHICS??'webgpu,webgl2').split(','))for(const place of (process.env.ONLY??places.join(',')).split(',')){
 const page=await browser.newPage({viewport:{width:Number(process.env.WIDTH??800),height:Number(process.env.HEIGHT??480)}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 if(phase==='before')await page.route('**/packs/roads/*/**',async route=>{const p=new URL(route.request().url()).pathname.split('/packs/roads/')[1],f=join(out,'baseline',p);if(existsSync(f)&&!p.includes('..'))await route.fulfill({path:f});else await route.continue();});
 try{
  const go=place==='clayton'?'roads':`roads-${place}`;
  await page.goto(`http://127.0.0.1:${port}/examples/roads/?go=${go}&stage=11&graphics=${api}&dpr=1&clock=30&shadows=${process.env.SHADOWS??1}`);
  await page.waitForFunction(()=>window.aslnutDemo?.w,null,{timeout:60000});await settledFrame(page);
  if(process.env.HIDE)await page.evaluate(async hide=>{const demo=window.aslnutDemo,old=demo.roads,next=new old.constructor({...old.props,id:old.id,hide:hide.split(',')});demo.w.remove(old.id);demo.w.add(next);demo.roads=next;await demo.w.settled({strict:true,timeout:180000});},process.env.HIDE);
  for(const c of cameras.filter(c=>c.place===place&&(!process.env.IDS||process.env.IDS.split(',').includes(c.id)))){
   const state=await page.evaluate(async c=>{
    const {w,roads}=window.aslnutDemo;w.go({lon:c.target[0],lat:c.target[1],dist:65,tilt:80,bearing:c.bearing});await w.settled({strict:true,timeout:180000});
    // Keep the target 65 m ahead, lowering the orbit pitch to the measured road-eye elevation.
    const roadH=c.height.roadHeightM,eyeH=roadH+1.7,g=w.heightAt(...c.eye),horizontal=c.horizontalM??65;
    if(!Number.isFinite(eyeH))throw new Error(`Missing road eye height for ${c.id}`);
    const rise=eyeH-w.camera.groundY;w.camera.dist=Math.hypot(horizontal,rise);w.camera.pitch=Math.atan2(rise,horizontal);w.invalidate();
    return {eyeHeightM:eyeH,roadHeightM:roadH,terrainHeightM:g,aboveRoadM:eyeH-(roadH??g),pitch:w.camera.pitch,groundY:w.camera.groundY,view:w.camera.view};
   },{...c,height:heights[c.id]});
   const frame=await page.evaluate(async()=>{const f=await window.aslnutDemo.w.frame();let bin='';for(let i=0;i<f.pixels.length;i+=32768)bin+=String.fromCharCode(...f.pixels.subarray(i,i+32768));return {width:f.width,height:f.height,b64:btoa(bin)};});const name=`${phase}-${c.id}-${api}${process.env.HIDE?'-hide-'+process.env.HIDE.replaceAll(',','-'):''}${process.env.SHADOWS==='0'?'-no-shadows':''}.png`;writeFileSync(join(out,name),png(frame.width,frame.height,bytesOf(frame)));
   rows.push({...c,api,phase,file:name,...state,width:frame.width,height:frame.height,shadows:process.env.SHADOWS!=='0',hide:process.env.HIDE??null,eyeSample:'published-quantized-facet',errors:[...errors]});writeFileSync(join(out,`${phase}-${process.env.ONLY??'all'}${process.env.IDS?'-focus':''}${process.env.HIDE?'-hide-'+process.env.HIDE.replaceAll(',','-'):''}${process.env.SHADOWS==='0'?'-no-shadows':''}-captures.json`),JSON.stringify(rows,null,2));console.log(`${phase} ${c.id} ${api}`);
  }
 }finally{await page.close();}
}
await browser.close();srv.close();
