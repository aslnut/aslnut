// Stage captures at the unchanged phone camera, on both graphics paths.
import {serve} from './serve.mjs';
import {launch,settledFrame} from './browser.mjs';
import {mkdirSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
const port=Number(process.env.PORT??8418),out=join(import.meta.dirname,'../.out/argon/v3/stages');
mkdirSync(out,{recursive:true});
const srv=await serve(port),browser=await launch(),rows=[];
for(const api of ['webgpu','webgl2'])for(const go of (process.env.ONLY??'roads-interchange').split(','))for(let stage=1;stage<=11;stage++){
 const page=await browser.newPage({viewport:{width:390,height:640}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 try{
  await page.goto(`http://127.0.0.1:${port}/examples/roads/?go=${go}&stage=${stage}&graphics=${api}&dpr=1&clock=30`);
  await page.waitForFunction(()=>window.aslnutDemo?.w,null,{timeout:60000});
  const frame=await settledFrame(page);
  await page.screenshot({path:join(out,`${go}-stage-${stage}-${api}.png`)});
  const state=await page.evaluate(()=>({stage:window.aslnutDemo.stage,gate:window.aslnutDemo.stageGate,label:document.querySelector('#stage-label').textContent,tiles:window.aslnutDemo.roads.tiles().length}));
  const ok=frame.api===api&&state.stage===String(stage)&&state.gate?.ok&&state.tiles>0&&!errors.length;
  rows.push({go,api,stage,ok,...state,errors});console.log(`${ok?'ok':'FAIL'} ${go} ${api} stage ${stage}: ${state.label}`);
 }catch(e){rows.push({go,api,stage,ok:false,error:e.message});console.log(`FAIL ${go} ${api} ${stage}: ${e.message}`);}finally{await page.close();}
 writeFileSync(join(out,'results.json'),JSON.stringify(rows,null,2));
}
await browser.close();srv.close();if(rows.some(r=>!r.ok))process.exitCode=1;
