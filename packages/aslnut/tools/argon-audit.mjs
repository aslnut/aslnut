// Patch distributions and published-pack measurements for review 2.
import {readFileSync,readdirSync,statSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
const out=join(import.meta.dirname,'../.out/argon/v3'),root=join(import.meta.dirname,'../../../data/packs/roads');
mkdirSync(out,{recursive:true});
const places=['clayton','interchange','bridge','elevated','tunnel','roundabout','arterial','street'];
const bytes=dir=>readdirSync(dir,{withFileTypes:true}).reduce((n,f)=>n+(f.isDirectory()?bytes(join(dir,f.name)):f.name.endsWith('.gz')?0:statSync(join(dir,f.name)).size),0);
const summary={},reports={};
for(const place of places){
 const source=JSON.parse(readFileSync(join(root,`${place}.geojson`),'utf8')),classes=new Map(source.features.map(f=>[String(f.properties.osm_id),f.properties.highway]));
 const before=JSON.parse(readFileSync(join(out,'baseline',place,'index.json'),'utf8')).report,after=JSON.parse(readFileSync(join(root,place,'index.json'),'utf8')).report;
 const breakdown=report=>report.stages.flatMap(g=>g.patches.map(p=>({stage:g.stage,...p}))).reduce((n,p)=>{
  const key=`${p.stage}:${p.check}:${p.algorithm}:${p.policy}`,r=n[key]??{patches:0,counts:{},worst:{}};r.patches++;
  for(const [k,v]of Object.entries(p.counts))r.counts[k]=(r.counts[k]??0)+v;
  for(const [k,v]of Object.entries(p.worst))r.worst[k]=Math.max(r.worst[k]??-Infinity,v);n[key]=r;return n;
 },{});
 const curves=report=>{
  const rows=report.stages[4].patches.filter(p=>p.check==='k-value'),byClass={},bins={'<0.15m':0,'0.15-0.4m':0,'0.4-1m':0,'>=1m':0};
  for(const p of rows){const cls=classes.get(String(p.ids[0]).split(':')[0])??'unknown';byClass[cls]=(byClass[cls]??0)+1;const v=p.worst.maxHeightDeltaM;bins[v<.15?'<0.15m':v<.4?'0.15-0.4m':v<1?'0.4-1m':'>=1m']++;}
  const values=rows.map(p=>p.worst.maxHeightDeltaM).sort((a,b)=>a-b);
  return {count:rows.length,byClass,bins,medianHeightDeltaM:values[values.length>>1]??0,maxHeightDeltaM:values.at(-1)??0};
 };
 summary[place]={beforeBytes:bytes(join(out,'baseline',place)),afterBytes:bytes(join(root,place)),before:breakdown(before),after:breakdown(after),curvesBefore:curves(before),curvesAfter:curves(after),visibility:after.stages[10].counts,visibilityWorst:after.stages[10].worst,supports:after.stages[9].counts,supportWorst:after.stages[9].worst,linksBefore:before.stages[8].counts.endpointLinks,linksAfter:after.stages[8].counts.endpointLinks,gates:after.stages.map(g=>({stage:g.stage,ok:g.ok,checks:g.checks}))};
 reports[place]=after;
 console.log(`${place}: ${(summary[place].beforeBytes/1e6).toFixed(3)} → ${(summary[place].afterBytes/1e6).toFixed(3)} MB; curves ${curves(before).count} → ${curves(after).count}; visibility ${after.stages[10].counts.visibilitySamples}; all gates ${after.stages.every(g=>g.ok)}`);
}
writeFileSync(join(out,'audit.json'),JSON.stringify(summary,null,2));
writeFileSync(join(out,'reports.json'),JSON.stringify(reports,null,2));
