// Reproducible close-ups and software frame measurements for the road bake review.
import {serve} from './serve.mjs';
import {launch,settledFrame,bytesOf} from './browser.mjs';
import {png} from './png.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const PORT=Number(process.env.PORT??8410),OUT=join(import.meta.dirname,'../.out/argon/v2');
mkdirSync(OUT,{recursive:true});
const srv=await serve(PORT),browser=await launch(),rows=[];
const closeups={'arterial':'roads-arterial','interchange':'roads-interchange','deck-piers':'roads-elevated','tunnel-portal':'roads-tunnel'};
for(const api of (process.env.ARGON_EVIDENCE==='frames'?[]:['webgpu','webgl2']))for(const [name,go]of Object.entries(closeups)){
 const page=await browser.newPage({viewport:{width:800,height:500}});
 try{await page.goto(`http://127.0.0.1:${PORT}/examples/roads/?go=${go}&graphics=${api}&dpr=1&clock=30`);await page.waitForFunction(()=>window.aslnutDemo?.w,null,{timeout:60000});await page.evaluate(name=>{const w=window.aslnutDemo.w,v=w.camera.view;w.go({lon:v.lon,lat:v.lat,zoom:v.zoom+(name==='interchange'?.8:1.2),tilt:v.tilt,bearing:v.bearing});},name);const f=await settledFrame(page);writeFileSync(join(OUT,`after-closeup-${name}-${api}.png`),png(f.width,f.height,bytesOf(f)));if(api==='webgl2')writeFileSync(join(OUT,`after-closeup-${name}.png`),png(f.width,f.height,bytesOf(f)));}
 finally{await page.close();}
}
for(const go of (process.env.ARGON_EVIDENCE==='shots'?[]:['roads','roads-interchange','roads-bridge','roads-elevated','roads-tunnel','roads-roundabout','roads-arterial'])){
 const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2}),cdp=await page.context().newCDPSession(page);
 try{await page.goto(`http://127.0.0.1:${PORT}/examples/roads/?go=${go}&graphics=webgl2&dpr=2`);await page.waitForFunction(()=>window.aslnutDemo?.w,null,{timeout:60000});
  await page.evaluate(()=>window.aslnutDemo.w.settled({strict:true,timeout:120000}));await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});
  const r=await page.evaluate(async()=>{const {w}=window.aslnutDemo;const canvas=document.querySelector('#view'),gl=canvas.getContext('webgl2'),ext=gl?.getExtension('WEBGL_debug_renderer_info'),renderer=ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown';const v=w.camera.view,times=[];let last=performance.now();const start=last;await new Promise(done=>{const timeout=setTimeout(done,15000);const tick=()=>{const now=performance.now();times.push(now-last);last=now;w.go({lon:v.lon,lat:v.lat,zoom:v.zoom,tilt:v.tilt,bearing:v.bearing+(now-start)*.012});if(now-start<5000)requestAnimationFrame(tick);else {clearTimeout(timeout);done();}};requestAnimationFrame(tick);});const values=times.slice(5).sort((a,b)=>a-b);return{renderer,median:values[values.length>>1]??null,p95:values[Math.floor(values.length*.95)]??null,samples:values.length,draws:w.stats().draws,pixelRatio:w.stats().pixelRatio,size:w.stats().size,quality:w.stats().quality,api:w.api};});
  const row={go,cpuRate:4,viewport:[390,844],dpr:2,...r,hardware:!/SwiftShader|llvmpipe|software|unknown/i.test(r.renderer)};rows.push(row);console.log(JSON.stringify(row));writeFileSync(join(OUT,'frame-times.json'),JSON.stringify(rows,null,2));
 }finally{await page.close();}
}
const stageResults=[];
if(process.env.ARGON_EVIDENCE!=='frames')for(const api of ['webgpu','webgl2'])for(const stage of ['old',...Array.from({length:11},(_,i)=>String(i+1))]){
 const page=await browser.newPage({viewport:{width:390,height:640}}),errors=[];
 page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`http://127.0.0.1:${PORT}/examples/roads/?go=roads-interchange&stage=${stage}&graphics=${api}&dpr=1&clock=30`);
  await page.waitForFunction(()=>window.aslnutDemo?.w,null,{timeout:60000});
  const f=await settledFrame(page);
  await page.screenshot({path:join(OUT,`stage-${stage}-interchange-${api}.png`)});
  const state=await page.evaluate(()=>({stage:window.aslnutDemo.stage,gate:window.aslnutDemo.stageGate,loaded:window.aslnutDemo.roads.tiles().length,label:document.querySelector('#stage-label').textContent}));
  const ok=f.api===api&&!errors.length&&state.stage===stage&&state.loaded>0&&(stage==='old'||state.gate?.ok)&&/gate pass/.test(state.label);
  stageResults.push({api,stage,ok,label:state.label,tiles:state.loaded,errors});console.log(`${ok?'ok':'FAIL'} ${api} stage ${stage}: ${state.label}`);
 }catch(e){stageResults.push({api,stage,ok:false,error:e.message});console.log(`FAIL ${api} stage ${stage}: ${e.message}`);}finally{await page.close();}
 writeFileSync(join(OUT,'stage-results.json'),JSON.stringify(stageResults,null,2));
}
await browser.close();srv.close();
if(stageResults.some(r=>!r.ok))process.exitCode=1;
