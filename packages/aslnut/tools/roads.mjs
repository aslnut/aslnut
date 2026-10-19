// The roads check: each test place's bake (tools › compile) and its view (examples/roads), on WebGPU and WebGL2.
//   bake    each level's outline a valid set of simple polygons (no edge crosses another); no sliver (nothing an opening
//           by 0.8 m would still take away); the kerb on the surface (its inner edge inside) and never across a road
//           (no crossing with a centre line); no two levels' surfaces within 0.5 m of each other (no z-fighting); every
//           deck 5.5 m clear over what it crosses; grades within the limits or reported; the ground the device draws
//           under every road at every terrain level (and a parent's standing in) never over it by 15 cm
//   view    it settles with no errors and draws; no road surface under the ground near the view (the ground goes under
//           the roads: the clamp) by more than 0.4 m (and how many points by more than 0.15 m); a kerb kept in the tile
//           of its middle and reaching out of it stood on where it is
//   frames  with PERF_CHROME (a real chip): frames while the camera turns, CPU 4 × slower, inside the budget
//   places: the seven test places and the street place (the healthy city's street level: roads with their verges)
//   node tools/roads.mjs   (run `npm run examples` and the compile first) · ONLY=roads,roads-bridge · evidence in .out/roads/
import { serve } from './serve.mjs';
import { launch, bytesOf, settledFrame, launchOptions, playwright } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.ROADS_PORT ?? 8179), OUT = process.env.ROADS_OUT ?? join(import.meta.dirname, '..', '.out', 'roads'), DATA = join(import.meta.dirname, '..', '..', '..', 'data', 'packs', 'roads');
mkdirSync(OUT, { recursive: true });
const PLACES = { roads: 'clayton', 'roads-interchange': 'interchange', 'roads-bridge': 'bridge', 'roads-elevated': 'elevated', 'roads-tunnel': 'tunnel', 'roads-roundabout': 'roundabout', 'roads-arterial': 'arterial', 'roads-street': 'street' };
const GOS = (process.env.ONLY ?? Object.keys(PLACES).join(',')).split(',');
const results = [];
const check = (api, name, ok, detail = '') => { results.push({ api, name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${api} ${name}${detail ? ` · ${detail}` : ''}`); };
// ── the bakes ──
for (const go of GOS) {
  const place = PLACES[go], f = join(DATA, place, 'index.json');
  if (!existsSync(f)) { check('bake', `${go}: baked`, false, 'run: npx tsx tools/compile/run/command.ts roads'); continue; }
  const r = JSON.parse(readFileSync(f, 'utf8')).report;
  check('bake', `${go}: outlines valid, no slivers, the kerb on the surface and never across a road, no z-fighting, footpaths and strips never on the road or each other, decks clear, grades`, r.invalid === 0 && r.slivers === 0 && r.kerbOutside === 0 && r.kerbCrossings === 0 && r.zfight === 0 && r.clearance.short.length === 0 && (r.clearance.least===null||r.clearance.least>=5.5) && (r.vergeOverlap ?? 0) === 0 && (r.vergeSlivers ?? 0) === 0,
    `${r.roads} roads · ${r.levels} levels · ${r.zones} junction zones (${r.planar} planar) · ${r.holes} holes · ${r.bridges} on decks · ${r.tunnels} in tunnels · invalid ${r.invalid} · slivers ${r.slivers} · kerb ${(r.kerbLength / 1000).toFixed(1)} km (off the surface ${r.kerbOutside}, across a road ${r.kerbCrossings}) · z-fighting ${r.zfight} · verges: footpaths ${((r.footpathArea ?? 0) / 1e4).toFixed(1)} ha, strips ${((r.vergeArea ?? 0) / 1e4).toFixed(1)} ha, ${r.crossings ?? 0} crossings, overlaps ${r.vergeOverlap ?? 0}, slivers ${r.vergeSlivers ?? 0} · least clearance ${r.clearance.least?.toFixed(1) ?? '—'} m · ${r.steep.length} steep pieces reported`);
  check('bake',`${go}: all fifteen ordered evaluation gates`,r.stages?.length===15&&r.stages.every((g,i)=>g.stage===i+1&&g.ok&&g.errors.length===0&&Array.isArray(g.patches)&&g.checks?.length&&g.checks.every(c=>c.ok&&['repair','omit','stop'].includes(c.policy))),r.stages?.map(g=>`${g.stage}:${g.ok?'pass':'FAIL'}`).join(' ')??'missing stage records');

  const visible=r.stages?.find(g=>g.stage===11);
  check('bake',`${go}: carriageway interiors visible and support caps seated`,visible?.checks.some(c=>c.check==='carriageway-visible'&&c.ok)&&visible.counts.visibilitySamples>0&&!visible.counts.terrainCoverFailures&&!visible.counts.pieceCoverFailures&&!r.stages.find(g=>g.stage===10)?.counts.capContactFailures,JSON.stringify({samples:visible?.counts.visibilitySamples,terrain:visible?.counts.terrainCoverFailures,pieces:visible?.counts.pieceCoverFailures,seatGapM:r.stages?.find(g=>g.stage===10)?.worst.maxCapGapM}));

  const structure=r.stages?.find(g=>g.stage===11),supports=r.stages?.find(g=>g.stage===10),joints=r.stages?.find(g=>g.stage===8),paths=r.stages?.find(g=>g.stage===9);
  check('bake',`${go}: full-width structural clearance, supports under carried decks, continuous approaches and walkable paths`,structure?.checks.some(c=>c.check==='structure-clearance'&&c.ok)&&structure.counts.structureSamples>0&&structure.counts.structureClearanceFailures===0&&supports?.checks.some(c=>c.check==='support-containment'&&c.ok)&&supports.counts.supportContainmentFailures===0&&supports.counts.supportHeightFailures===0&&joints?.checks.some(c=>c.check==='deck-connection'&&c.ok)&&joints.counts.deckConnectionFailures===0&&paths?.checks.some(c=>c.check==='footpath-grade'&&c.ok)&&paths.counts.footpathGradeFailures===0,JSON.stringify({structure:structure?.counts.structureSamples,clearanceFailures:structure?.counts.structureClearanceFailures,deckJoints:joints?.counts.deckJointSamples,maxJointGapM:joints?.worst.maxDeckJointGapM,supports:supports?.counts.supportFootprintSamples,steepPathsFlagged:paths?.counts.footpathSteepFlagged}));

  check('bake',`${go}: footbridges come down walkably (ramps within 1:14 or steps, no access towers) and the carriageway has no undrivable step`,paths?.checks.some(c=>c.check==='footbridge-approach'&&c.ok)&&paths.counts.footbridgeEndsUnconnected===0&&paths.counts.footbridgeRampGradeFailures===0&&paths.counts.accessTowers===0&&(paths.worst.maxWalkGrade??0)<=1/14+1e-3&&joints?.checks.some(c=>c.check==='carriageway-step'&&c.ok)&&joints.counts.carriagewaySteepFacets===0&&joints.counts.seamFacetsChecked>0,JSON.stringify({ends:paths?.counts.footbridgeEnds,mappedRamps:paths?.counts.mappedRampApproaches,steps:paths?.counts.mappedStepApproaches,generatedRamps:paths?.counts.generatedRamps,generatedStairs:paths?.counts.generatedStairs,maxWalkGrade:paths?.worst.maxWalkGrade,seamFacetsOpened:joints?.counts.seamFacetsOpened,seamAreaM2:joints?.worst.seamAreaRemovedM2}));

  const snapshots=Array.from({length:10},(_,i)=>i+1).map(stage=>{
    const f=join(DATA,'..','roads-stages',place,String(stage),'index.json');
    if(!existsSync(f))return false;
    const index=JSON.parse(readFileSync(f,'utf8'));
    return index.report.stages.length===stage&&index.report.stages.every((g,i)=>g.stage===i+1&&g.ok&&g.checks.every(c=>c.ok));
  });
  check('bake',`${go}: ten build-time snapshots have their ordered gate prefixes`,snapshots.every(Boolean),snapshots.map((ok,i)=>`${i+1}:${ok?'pass':'FAIL'}`).join(' '));
  // stages 12–15: nothing left standing where it may not (the hard results after their patches), the placement written
  const g=(n)=>r.stages?.find(s=>s.stage===n)?.counts??{};
  const left={plotsInReserve:g(12).plotsInReserve,plotsOverBuildings:g(12).plotsOverBuildings,plotOverlaps:g(12).plotOverlaps,buildingsInReserve:g(13).buildingsInReserve,buildingsOnPaths:g(13).buildingsOnPaths,buildingsOnWater:g(13).buildingsOnWater,buildingOverlaps:g(13).buildingOverlaps,buriedWalls:g(13).buriedWalls,floatingPads:g(13).floatingPads,treesBlocked:g(14).treesBlocked,furnitureBlocked:g(15).furnitureBlocked};
  check('bake',`${go}: no plot in the reserve, no building on a road, path, water or another, no buried or floating pad, no trunk or pole where it may not stand`,Object.values(left).every(v=>v===0),JSON.stringify({buildings:g(13).buildings,patched:g(13).patchedPieces,omitted:g(13).omittedPieces,trees:g(14).trees,nudged:g(14).nudged,treesOmitted:g(14).omittedPieces,furniture:g(15).furniture,furnitureOmitted:g(15).omittedPieces}));
  const builtOk=['built',...[12,13,14].map(s=>`../../roads-stages/${place}/${s}/built`)].every(d=>existsSync(join(DATA,place,d,'index.json')))&&existsSync(join(DATA,'..','roads-stages',place,'11','clamp.json'));
  check('bake',`${go}: the placement (stage 15) and what stages 11–14 left are written`,builtOk);
  // the ground the device draws under every carriageway (tools/ground-levels.ts: the runtime's clamp, drawn as the
  // surface's triangles, a point every 4 m), at each level of the terrain and with a parent two levels up standing in
  if (existsSync(join(DATA, place, 'terrain.json'))) {
    const { groundLevels } = await import('./ground-levels.ts');
    const g = await groundLevels({ dir: join(DATA, place), zooms: [13, 14, 15, 16, 17, 18], standIns: [2], step: 4, overhead: false });
    const lv = Object.entries(g.levels);
    check('bake', `${go}: the ground under every road at grade or in a cut at every terrain level, its own tiles and a parent standing in (none over by 15 cm)`, lv.length > 0 && lv.every(([, s]) => s.samples > 0 && s.over15 === 0), lv.map(([k, s]) => `${k} ${s.over15}/${s.samples}${s.over15 ? ` (worst ${s.worst} m at ${s.worstAt})` : ''}`).join(' · '));
    // (a deck's surface: the bake's clearance, not the clamp's; said, not failed)
    const d = Object.entries((await groundLevels({ dir: join(DATA, place), zooms: [16, 18], step: 4 })).levels).filter(([, s]) => s.over15);
    if (d.length) console.log(`·    ${go}: decks the ground rises over (no clamp cell under them): ${d.map(([k, s]) => `${k} ${s.over15} points, worst ${s.worst} m at ${s.worstAt}`).join(' · ')}`);
  }

}
// ── the views ──
const srv = await serve(PORT), browser = await launch();
for (const api of ['webgpu', 'webgl2']) for (const go of GOS) {
  const page = await browser.newPage({ viewport: { width: 390, height: 640 } }); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/examples/roads/?go=${go}&graphics=${api}&dpr=1&clock=30`);
    await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 60000 });
    const r = await page.evaluate(async () => {
      const { w, roads } = window.aslnutDemo; const errs = []; w.on('error', (e) => errs.push(String(e?.message ?? e).slice(0, 300)));
      await w.settled({ timeout: 120000 }).catch(() => {}); const settled = w.report().settled;
      const f = await w.frame(); let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768));
      // every road surface point within 120 m of the view's centre: the ground under it?
      const c = w.camera, kinds = roads.area.kinds, ex = []; let n = 0, under = 0, worst = 0;
      for (const t of roads.tiles()) for (const p of t.tile.pieces) {
        const kind = kinds[p[1]]; if (kind !== 'carriageway' || p[0] !== 4) continue;
        const pts = []; { const nr = p[4]; let o = 5 + nr; for (let r = 0; r < nr; r++) for (let i = 0; i < p[5 + r]; i++) { pts.push([p[o], p[o + 1], p[o + 2]]); o += 3; } }
        for (const [x, z, h] of pts) {
          const [lon, lat] = t.ctx.lonLat(x, z); if (Math.hypot((lon - c.lon) * 88000, (lat - c.lat) * 111000) > 120) continue;
          const g = w.heightAt(lon, lat); if (Number.isNaN(g)) continue;
          n++; if (g > h + 0.15) { under++; worst = Math.max(worst, g - h); if (ex.length < 4) ex.push([kind, +lon.toFixed(6), +lat.toFixed(6), +h.toFixed(2), +g.toFixed(2)]); }
        }
      }
      let pickedAudit=null;
      scan:for(const y of [300,420,540,600])for(const x of [70,195,320]){
        const f=await w.pick(x,y);
        if(f?.props?.patched||f?.props?.omitted){pickedAudit={source:f.props.source,patched:f.props.patched,omitted:f.props.omitted,patches:f.props.patches};break scan;}
      }
      // the placement drawn: built tiles, and a picked building, tree or piece of furniture says what it is and its source
      const st=window.aslnutDemo.street, built=st?.built().length??0; let placed=null;
      scan2:for(const y of [250,350,450,550])for(const x of [60,150,240,330]){const f=await w.pick(x,y),kind=f?.props?.['footprint (m²)']!==undefined?'building':f?.props?.['crown radius (m)']!==undefined?'tree':null;if(kind&&f.props.source){placed={kind,source:f.props.source,placement:f.props.placement??null};break scan2;}}
      // a kerb kept whole in the tile of its middle, reaching more than 20 m out of it: stood on where it is (the middle of
      // a segment's top, a metre long or more, not folded)
      let reach=null;const size=roads.area.size;
      scan3:for(const t of roads.tiles())for(const p of t.tile.pieces){if(kinds[p[1]]!=='kerb'||p[0]!==5)continue;for(let i=0;i+1<p[3];i++){const o=4+i*6,q=o+6,dx=p[q]-p[o],dz=p[q+1]-p[o+1];if(Math.hypot(dx,dz)<1||(dx*p[o+5]-dz*p[o+4])*(dx*p[q+5]-dz*p[q+4])<=0)continue;const x=(p[o]+p[q])/2+(p[o+4]+p[q+4])/4,z=(p[o+1]+p[q+1])/2+(p[o+5]+p[q+5])/4;if(x<-20||z<-20||x>size+20||z>size+20){const [lon,lat]=t.ctx.lonLat(x,z),lv=[];roads.levelsAt(lon,lat,lv);reach={tile:t.key,at:[+lon.toFixed(6),+lat.toFixed(6)],top:+((p[o+2]+p[q+2])/2+0.15).toFixed(3),levels:lv.map((h)=>+h.toFixed(3))};break scan3;}}}
      return { audit:window.aslnutDemo.visibility(120), pickedAudit, built, placed, reach, b64: btoa(bin), w: f.width, h: f.height, errs, settled, n, under, worst, ex, api: w.api, stages: roads.area.report?.stages };
    });
    const px = new Uint8Array(Buffer.from(r.b64, 'base64'));
    writeFileSync(join(OUT, `${go}-${api}.png`), png(r.w, r.h, px));
    let dark = 0; for (let i = 0; i < px.length; i += 4) if (px[i] < 80 && px[i + 1] < 80 && px[i + 2] < 80) dark++;
    check(api, `${go}: settles, draws roads, no errors`, r.settled && r.api === api && !r.errs.length && dark > 2000, JSON.stringify({ settled: r.settled, errs: r.errs.slice(0, 2), roadPx: dark }));
    // (the tolerance: 0.4 m: the ground's samples lie a few metres apart at a distance, a road's edge between two of them)
    check(api, `${go}: no road under the ground near the view (by more than 0.4 m; how many by more than 0.15 m)`, r.n > 50 && r.worst <= 0.4, `${r.under} of ${r.n} points under by more than 0.15 m (worst ${r.worst.toFixed(2)} m)${r.ex.length ? ` e.g. ${JSON.stringify(r.ex)}` : ''}`);
    if (r.reach) check(api, `${go}: a kerb reaching out of the tile it is kept in is stood on where it is`, r.reach.levels.some((h) => Math.abs(h - r.reach.top) < 0.05), JSON.stringify(r.reach));
    check(api, `${go}: the placement loaded (built tiles; a picked building or tree names its source)`, r.built>0&&(['roads-interchange','roads-bridge','roads-elevated','roads-tunnel'].includes(go)||Boolean(r.placed?.source)), JSON.stringify({built:r.built,placed:r.placed}));
    check(api, `${go}: all stage gates loaded with the baked place`,r.stages?.length===15&&r.stages.every((g,i)=>g.stage===i+1&&g.ok&&Array.isArray(g.patches)&&g.checks?.length&&g.checks.every(c=>c.ok)),r.stages?.map(g=>g.stage).join(',')??'missing gates');
    check(api,`${go}: picked feature carries its source and patch audit`,Boolean(r.pickedAudit?.source)&&Array.isArray(r.pickedAudit?.patches)&&r.pickedAudit.patches.every(p=>p.ids.length&&p.algorithm&&Object.keys(p.moved).length),JSON.stringify(r.pickedAudit?{source:r.pickedAudit.source,patches:r.pickedAudit.patches.length,checks:[...new Set(r.pickedAudit.patches.map(p=>p.check))]}:null));
    check(api,`${go}: carriageway interiors visible in the standard view`,r.audit.counts.visibilitySamples>0&&r.audit.counts.terrainCoverFailures===0&&r.audit.counts.pieceCoverFailures===0,JSON.stringify(r.audit));
    await page.evaluate(()=>{const w=window.aslnutDemo.w,v=w.camera.view;w.go({lon:v.lon,lat:v.lat,zoom:v.zoom+2,tilt:v.tilt,bearing:v.bearing});});
    const close=await settledFrame(page);
    writeFileSync(join(OUT,`${go}-close-${api}.png`),png(close.width,close.height,bytesOf(close)));
    const closeAudit=await page.evaluate(()=>window.aslnutDemo.visibility(120));
    check(api,`${go}: carriageway interiors visible at zoom +2`,closeAudit.counts.visibilitySamples>0&&closeAudit.counts.terrainCoverFailures===0&&closeAudit.counts.pieceCoverFailures===0,JSON.stringify(closeAudit));
    const hover=await page.evaluate(async()=>{
      const {w,roads}=window.aslnutDemo;let picked=null;
      for(const y of [300,420,540]){if(picked)break;for(const x of [70,195,320]){const f=await w.pick(x,y);if(f?.props?.highway){picked=f;break;}}}
      if(!picked)return {found:false};
      const a=await w.frame();roads.hovered(new Set([String(picked.id)]));w.invalidate();const b=await w.frame();roads.hovered(null);
      let changed=0;for(let i=0;i<a.pixels.length;i+=4)if(Math.abs(a.pixels[i]-b.pixels[i])+Math.abs(a.pixels[i+1]-b.pixels[i+1])+Math.abs(a.pixels[i+2]-b.pixels[i+2])>6)changed++;
      return {found:true,changed};
    });
    check(api,`${go}: picking keeps asphalt colour and cell boundaries invisible`,hover.found&&hover.changed===0,JSON.stringify(hover));
    check(api, `no page errors (${go})`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, go, false, e.message.slice(0, 300)); }
  await page.close();
}
await browser.close(); srv.close();
// ── frames on a real GPU (PERF_CHROME: a Chrome that draws on the machine's GPU) ──
if (process.env.PERF_CHROME) {
  const { chromium } = await playwright();
  const srv2 = await serve(PORT + 1);
  const { channel, ...gpu } = launchOptions('gpu', ['--disable-gpu-vsync', '--disable-frame-rate-limit']);
  const b = await chromium.launch({ ...gpu, executablePath: process.env.PERF_CHROME });
  for (const go of GOS) {
    const page = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 }); const cdp = await page.context().newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
    await page.goto(`http://127.0.0.1:${PORT + 1}/examples/roads/?go=${go}&graphics=webgl2`);
    await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 60000 });
    const r = await page.evaluate(async () => {
      const { w } = window.aslnutDemo; await w.settled({ timeout: 120000 }).catch(() => {}); await new Promise((ok) => setTimeout(ok, 800));
      const v = w.camera.view, times = []; let last = performance.now(); const t0 = last;
      await new Promise((done) => { const tick = () => { const now = performance.now(); times.push(now - last); last = now; w.go({ lon: v.lon, lat: v.lat, zoom: v.zoom, tilt: v.tilt, bearing: v.bearing + (now - t0) * 0.012 }); if (now - t0 < 5000) requestAnimationFrame(tick); else done(); }; requestAnimationFrame(tick); });
      const s = times.slice(5).sort((a, b) => a - b); return { median: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)], draws: w.stats().draws };
    });
    check('webgl2', `${go}: frames on a real chip, CPU 4 × slower (median < 16.7 ms, p95 < 33 ms)`, r.median < 16.7 && r.p95 < 33, `median ${r.median.toFixed(1)} ms · p95 ${r.p95.toFixed(1)} ms · ${r.draws} draws`);
    await page.close();
  }
  await b.close(); srv2.close();
} else console.log('·    frames on a real GPU: skipped (PERF_CHROME not set)');
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
const failed = results.filter((r) => !r.ok).length;
console.log(`${failed ? 'FAIL' : 'ok  '} roads: ${results.length - failed}/${results.length} checks passed`);
process.exit(failed ? 1 : 0);
