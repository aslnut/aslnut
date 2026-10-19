// Roads, alone: the ground's heights (a hillshade over a plain green, no imagery) and the roads baked by the compile
// (tools › compile › steps › solve: carriageways, kerbs, junctions, medians, roundabouts, markings, decks, piers,
// tunnels), the ground lowered under them. A test place per preset:
//   ?go=roads (Clayton's grid) · roads-interchange · roads-bridge · roads-elevated · roads-tunnel · roads-roundabout ·
//   roads-arterial        &graphics=webgpu | webgl2   &clock=30 (the tools)
// &bake=next: the new baker's packs (grid and street only) · ?stage=1..15 | old: what each stage of the bake left (12 plots, 13 buildings on pads, 14 trees, 15 furniture: the
// final); &omitted=0 hides the red posts where the bake left something out, &plots=0 the plots' outlines
import { bakedRoads, clampTerrain, earth, imagery, sky, streets, terrain, world, type View } from '../../src/index.ts';
import { builtLayers } from './built.ts';
import { bakedPieces } from '../../src/modules/world/earth/presets/built/roads/baked.ts';
import { carriagewayVisibility } from '../../src/core/geometry/networks/facets.ts';

declare const __BUILD__: number;
const q = new URLSearchParams(location.search), go = q.get('go') ?? 'roads';
// &bake=next: the new baker's packs (packages/baker; the final stage only, for the places it has baked: grid, street)
const NEXT = q.get('bake') === 'next', PACK = NEXT ? '/aslnut/data/packs/roads-next' : '/aslnut/data/packs/roads';
const LAST = 15, stage = NEXT ? String(LAST) : q.get('stage') === 'old' ? 'old' : String(Math.max(1,Math.min(LAST,Number(q.get('stage')??LAST)||LAST)));
const STAGES=['roads-union-v1','Raw OSM lines / terrain','Terrain stamps','Chained lines / topology QA','Horizontal alignment','Heights and K curves','Frames and banking','Union per level','Corridors and kerbs','Footways and crossings','Piers','Earthworks','Plots / frontage','Buildings on pads','Trees','Furniture / final'];

const PLACES: Record<string, { place: string; title: string; view: View }> = {
  roads: { place: 'clayton', title: "Clayton's suburban grid (T and X junctions)", view: { lon: 145.1205, lat: -37.9245, zoom: 18.2, tilt: 58, bearing: 330 } },
  'roads-interchange': { place: 'interchange', title: 'the Monash Freeway at Warrigal Road (overpasses)', view: { lon: 145.0903, lat: -37.8826, zoom: 17.6, tilt: 60, bearing: 20 } },
  'roads-bridge': { place: 'bridge', title: 'Princes Bridge over the Yarra', view: { lon: 144.9686, lat: -37.8195, zoom: 17.8, tilt: 62, bearing: 300 } },
  'roads-elevated': { place: 'elevated', title: 'the Bolte Bridge and CityLink (elevated)', view: { lon: 144.9322, lat: -37.8172, zoom: 16.8, tilt: 62, bearing: 330 } },
  'roads-tunnel': { place: 'tunnel', title: "the Burnley Tunnel's eastern portal", view: { lon: 145.0040, lat: -37.8297, zoom: 18.2, tilt: 62, bearing: 290 } },
  'roads-roundabout': { place: 'roundabout', title: 'a roundabout (Clayton)', view: { lon: 145.11556, lat: -37.91891, zoom: 19, tilt: 55, bearing: 0 } },
  'roads-arterial': { place: 'arterial', title: 'Princes Highway at Clayton (divided)', view: { lon: 145.1205, lat: -37.9102, zoom: 18, tilt: 58, bearing: 330 } },
  // the healthy city's street level (its whole area): the roads with their footpaths and nature strips
  'roads-street': { place: 'street', title: 'the street level: roads, footpaths, nature strips (Clayton)', view: { lon: 145.1215, lat: -37.9246, zoom: 18.6, tilt: 55, bearing: 20 } },
};
const P = PLACES[go] ?? PLACES.roads!;
const STAGES_PACK='/aslnut/data/packs/roads-stages', N=Number(stage);
// the roads: a stage's own snapshot up to 10, the final pack from 11; the ground: stage 11's (before the pads) for 11–12
const stagePack=stage==='old'?`/aslnut/data/packs/roads-old/${P.place}`:N>=11?`${PACK}/${P.place}`:`${STAGES_PACK}/${P.place}/${stage}`;
const clampUrl=stage!=='old'&&(N===11||N===12)?`${STAGES_PACK}/${P.place}/11/clamp.json`:`${stagePack}/clamp.json`;
// what stands on it: as the stage left it (12–14), the final placement at 15
const builtUrl=stage==='old'||N<12?null:N===LAST?`${PACK}/${P.place}/built/index.json`:`${STAGES_PACK}/${P.place}/${stage}/built/index.json`;
const calm = imagery.custom({ id: 'calm-ground', attribution: '', draw: (g) => { g.fillStyle = '#9cab72'; g.fillRect(0, 0, 256, 256); return true; } });

async function main(): Promise<void> {
  document.querySelector('#bar')!.innerHTML = Object.keys(PLACES).map((k) => `<a href="?go=${k}&stage=${stage}${q.get('graphics') ? `&graphics=${q.get('graphics')}` : ''}${NEXT ? '&bake=next' : ''}${q.get('key') ? `&key=${q.get('key')}` : ''}" class="${k === go ? 'on' : ''}">${k.replace('roads-', '') || 'grid'}</a>`).join('');
  document.querySelector('#note')!.textContent = `${P.title}${NEXT ? ' · new baker' : ''} · build ${typeof __BUILD__ === 'number' ? __BUILD__ : 0}`;
  const loading=document.querySelector<HTMLDivElement>('#loading')!;
  loading.textContent=`Loading ${stage==='old'?'the old result':`stage ${stage}`}…`;
  const slider=document.querySelector<HTMLInputElement>('#stage')!,label=document.querySelector<HTMLOutputElement>('#stage-label')!;
  slider.value=stage==='old'?'0':stage;
  label.textContent=`${stage==='old'?'Old':stage+' / '+LAST} · ${STAGES[Number(slider.value)]} · loading`;
  const index=await fetch(`${stagePack}/index.json`).then(r=>{if(!r.ok)throw new Error(`Stage snapshot unavailable (${r.status})`);return r.json();});
  const gate=index.report?.stages?.find((g:{stage:number})=>g.stage===Number(stage));
  const ok=gate?.ok??(index.report.invalid===0&&index.report.slivers===0&&index.report.zfight===0);
  const pieces=(gate?.patches??[]).reduce((a:number,p:{counts?:{pieces?:number}})=>a+(p.counts?.pieces??1),0);
  label.textContent=`${stage==='old'?'Old':stage+' / '+LAST} · ${STAGES[Number(slider.value)]} · gate ${ok?'pass':'fail'} · ${gate?.patches?.length??0} patches${N>=12?` (${pieces} pieces)`:''}`;
  let initialView=P.view;
  // a kept camera (the slider's reload): dist or zoom, never both (E-VIEW-001)
  if(q.get('view'))try{const v=JSON.parse(q.get('view')!) as View & { dist?: number; zoom?: number };if(v.dist!=null&&v.zoom!=null)delete v.zoom;initialView=v;}catch{}
  const w = await world(document.querySelector<HTMLCanvasElement>('#view')!, {
    observation: { levels: 'default' },
    body: earth({ imagery: [calm], // the place's own ground (the bake's: the radar's roofs taken out) over Mapzen's, the roads' clamp on it
    terrain: [terrain.mapzen(), clampTerrain(terrain.grid({ url: `${PACK}/${P.place}.ground`, blend: 60, attribution: 'Terrain: Mapzen terrain tiles (AWS Open Data), buildings taken out' }), clampUrl,{legacy:stage==='old'})], base: null, sky: sky(), exaggerate: 1, surface: { shade: 0.75 } }),
    view: initialView, graphics: (q.get('graphics') as 'webgpu' | 'webgl2' | null) ?? 'auto',
    clock: q.get('clock') ? { fps: Number(q.get('clock')) } : 'real', time: new Date(Date.UTC(2026, 0, 15, 3, 0, 0)), timeZone: 'Australia/Melbourne',
    pixelRatio: q.get('dpr') ? Number(q.get('dpr')) : undefined, render: { shadows: q.get('shadows') !== '0' ? { strength: Number(q.get('shade') ?? 0.7) } : false }, // a shadow keeps the sky's light (0.7: not the near-black of 1)
    attribution: { format: (c) => `${c.slice(0, 3).join(' · ')} · build ${typeof __BUILD__ === 'number' ? __BUILD__ : 0}` },
  });
  const roads = bakedRoads({ url: `${stagePack}/index.json`, look: Number(stage)<=6?{carriageway:'#eead51'}:undefined, near: 6000, tooltip: (d) => {
    const changes = (d.props.patches ?? []) as {policy:string;algorithm:string;worst:Record<string,number>}[];
    const audit = changes.map(p => `${p.policy === 'omit' ? 'omitted' : 'patched'}: ${p.algorithm} (${Object.entries(p.worst).map(([k,v])=>`${k}=${v.toFixed(2)}`).join(', ')})`).join(' · ');
    return `${d.props.name ?? d.kind}${d.props.highway ? ` · ${d.props.highway}` : ''}${d.props.layer ? ` · level ${d.props.layer}` : ''}${audit ? ` · ${audit}` : ''} · ${d.props.source ?? ''}`;
  } });
  w.add(roads);
  // stages 12–15: the placement drawn with the street level's looks (and the demo's own for the furniture)
  let street: ReturnType<typeof streets> | null = null, extras: ReturnType<typeof builtLayers> | null = null;
  if (builtUrl) {
    let soon = 0;
    extras = builtLayers(w, { plots: q.get('plots') !== '0', omitted: q.get('omitted') !== '0' });
    street = streets({ url: builtUrl, near: 3500, tooltip: (d) => `${d.props.kind ?? d.kind}${d.props.placement ? ` · ${d.props.placement}` : ''} · ${d.props.source ?? ''}`, onTile: () => { clearTimeout(soon); soon = window.setTimeout(() => extras!.update(street!.built()), 150); } });
    w.add(street, ...extras.layers);
  }
  void w.settled({ timeout: 30000 }).catch(() => false).then(() => { loading.hidden = true; });
  slider.addEventListener('input',()=>{label.textContent=`${slider.value==='0'?'Old':slider.value+' / '+LAST} · ${STAGES[Number(slider.value)]}`;});
  slider.addEventListener('change',()=>{loading.textContent=`Loading ${slider.value==='0'?'the old result':`stage ${slider.value}`}…`;loading.hidden=false;const next=new URL(location.href);next.searchParams.set('stage',slider.value==='0'?'old':slider.value);const v={...w.camera.view} as View & { dist?: number; zoom?: number };if(v.dist!=null)delete v.zoom;next.searchParams.set('view',JSON.stringify(v));location.assign(next.href);});
  const visibility=(radius=120)=>{
    const area=roads.area as unknown as {origin:[number,number];kinds:string[]},kx=111320*Math.cos(area.origin[1]*Math.PI/180),cx=(w.camera.lon-area.origin[0])*kx,cz=-(w.camera.lat-area.origin[1])*110574;
    const pieces=roads.tiles().flatMap(t=>bakedPieces(t.tile,area.kinds)).filter(p=>{
      const pts=p.t==='area'?p.rings.flat():p.t==='poly'?p.ring:p.t==='strip'?p.edges.flat():p.t==='box'?[p.at]:p.t==='wall'?p.line:p.pts;
      return pts.some(q=>Math.hypot(q[0]-cx,q[1]-cz)<radius);
    });
    const result=carriagewayVisibility(pieces,(x,z)=>w.heightAt(area.origin[0]+x/kx,area.origin[1]-z/110574));
    return {counts:result.counts,worst:result.worst,locations:result.locations};
  };
  (window as unknown as { aslnutDemo: unknown }).aslnutDemo = { w, roads, street, extras, visibility, go, stage, stageGate: gate, place: P.place, places: Object.keys(PLACES) };
}
void main().catch((e) => { document.querySelector<HTMLDivElement>('#loading')!.hidden = true; document.querySelector('#note')!.textContent = String((e as Error).message ?? e); console.error(e); });
