// Review evidence: identical saved cameras before and after each bake.
import {serve} from './serve.mjs';
import {launch,settledFrame,bytesOf} from './browser.mjs';
import {png} from './png.mjs';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {join} from 'node:path';
const out=join(import.meta.dirname,'../.out/argon/v3'),phase=process.env.PHASE??'before';
mkdirSync(out,{recursive:true});
const port=Number(process.env.PORT??8412),srv=await serve(port),browser=await launch(),rows=[];
const gos=['roads','roads-interchange','roads-bridge','roads-elevated','roads-tunnel','roads-roundabout','roads-arterial','roads-street'];
const camerasFile=join(out,'cameras.json');
let cameras=existsSync(camerasFile)?JSON.parse(readFileSync(camerasFile,'utf8')):{};
for(const api of ['webgpu','webgl2'])for(const go of (process.env.ONLY??gos.join(',')).split(',')){
 const page=await browser.newPage({viewport:{width:800,height:500}});
 if(phase==='before')await page.route('**/packs/roads/*/**',async route=>{const parts=new URL(route.request().url()).pathname.split('/packs/roads/')[1],file=join(out,'baseline',parts);if(existsSync(file)&&!parts.includes('..'))await route.fulfill({path:file});else await route.continue();});
 try{
  await page.goto(`http://127.0.0.1:${port}/examples/roads/?go=${go}&stage=11&graphics=${api}&dpr=1&clock=30`);
  await page.waitForFunction(()=>window.aslnutDemo?.w,null,{timeout:60000});
  if(!cameras[go])cameras[go]=await page.evaluate(()=>{const v=window.aslnutDemo.w.camera.view;return {lon:v.lon,lat:v.lat,zoom:v.zoom,tilt:v.tilt,bearing:v.bearing};});
  const views={standard:cameras[go],close:{...cameras[go],zoom:cameras[go].zoom+2}};
  if(go==='roads-interchange'){
   views.review={lon:145.0870,lat:-37.8867,zoom:19.5,tilt:25,bearing:60};
   views.merge={lon:145.0897,lat:-37.88365,zoom:19.8,tilt:25,bearing:330};
   views.capon={lon:145.0870,lat:-37.8867,zoom:19.5,tilt:25,bearing:330};
  }
  if(process.env.FOCUS==='1')for(const key of Object.keys(views))if(!['review','merge','capon'].includes(key))delete views[key];
  for(const [name,view]of Object.entries(views)){
   await page.evaluate(v=>window.aslnutDemo.w.go(v),view);
   const f=await settledFrame(page);
   writeFileSync(join(out,`${phase}-${go}-${name}-${api}.png`),png(f.width,f.height,bytesOf(f)));
   const state=await page.evaluate(()=>({view:window.aslnutDemo.w.camera.view,report:window.aslnutDemo.w.report(),gates:window.aslnutDemo.roads.area.report.stages}));
   rows.push({go,api,name,view:state.view,settled:state.report.settled});
   console.log(`${phase} ${go} ${name} ${api}`);
   if(go==='roads-interchange'&&['review','merge','capon'].includes(name)){
    const picked=await page.evaluate(async()=>{const {w,roads}=window.aslnutDemo;
     for(const t of roads.tiles())for(const p of t.tile.pieces){if(p[0]!==4||roads.area.kinds[p[1]]!=='carriageway')continue;
      const props=t.tile.infos[p[2]].props;if(!String(props.osm??'').split(' ').includes('787306311'))continue;
      if(props.patches?.some(p=>p.check==='k-value')&&!props.patches.some(p=>p.ids.includes('787306311:2')))continue;
      const n=p[5],offset=5+p[4];let x=0,z=0,h=0;for(let i=0;i<n;i++){x+=p[offset+i*3]/n;z+=p[offset+i*3+1]/n;h+=p[offset+i*3+2]/n;}
      const ll=t.ctx.lonLat(x,z),xy=w.project([ll[0],ll[1],h]);if(!xy||xy[0]<10||xy[1]<10||xy[0]>790||xy[1]>490)continue;
      const f=await w.pick(...xy);if(f?.props?.osm&&String(f.props.osm).includes('787306311'))return {f,x:xy[0],y:xy[1]};
     }
     for(const y of [250,350,150,450])for(const x of [400,300,500,200,600]){const f=await w.pick(x,y);if(f?.props?.name==='Capon Street'||f?.props?.highway)return{f,x,y};}return null;});
    if(picked){
     await page.mouse.move(picked.x,picked.y);
     await page.waitForFunction(id=>window.aslnutDemo.w.user.hover===id,String(picked.f.id),{timeout:10000}).catch(()=>{});
     await page.evaluate(id=>{const {w,roads}=window.aslnutDemo;roads.hovered(new Set([String(id)]));w.invalidate();},picked.f.id);
     const hf=await settledFrame(page);
     writeFileSync(join(out,`${phase}-${go}-${name}-hover-${api}.png`),png(hf.width,hf.height,bytesOf(hf)));
     rows.push({go,api,name:`${name}-hover`,view:state.view,picked:picked.f});
     await page.evaluate(()=>{const {w,roads}=window.aslnutDemo;roads.hovered(null);w.invalidate();});
     await page.mouse.move(0,0);
    }
   }
   if(phase==='before')writeFileSync(join(out,`${go}-report-before.json`),JSON.stringify(state.gates,null,2));
  }
 }finally{await page.close();}
 writeFileSync(camerasFile,JSON.stringify(cameras,null,2));
 writeFileSync(join(out,`${phase}${process.env.CAPTURE_SET?'-'+process.env.CAPTURE_SET:''}${process.env.FOCUS==='1'?'-focus':''}-captures.json`),JSON.stringify(rows,null,2));
}
await browser.close();srv.close();
