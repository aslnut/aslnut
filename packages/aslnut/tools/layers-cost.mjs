// What GIS layers cost (examples/layers: the map, or with the twin) on a phone-sized view (390 × 844 at dpr 2: 780 × 1688
// px), as a phone picks its quality (auto): graphics memory and the page's heap; CPU and chip ms a frame while the view
// moves (a 3 s flight, every frame drawn); render passes a frame; frames drawn at rest (3 s of a still, settled view);
// and what one change costs: a layer hidden and shown, its opacity changed, the stack reordered. For each change: the
// frames drawn and display frames asked in the second after it, the main thread's busy ms over a quiet second, the
// ground tiles' overlays drawn again, and whether anything was built again (a layer's geometry, its features styled).
// The map's services as well: the first load (from the page opening to settled: requests, the answers' bytes as read
// and as sent over the wire, ms), a pan to new ground and a pan back (what each asked for).
//   node tools/layers-cost.mjs [n=6] [areas=ground|over|both|-] [cpu=1,4] [webgl2] [map|twin]   (run the examples' build first)
//   e.g. node tools/layers-cost.mjs 3,6,8 - 1 webgl2 map        node tools/layers-cost.mjs 6 both 1 webgl2 twin
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';

const [nArg = '6', areasArg = 'both', cpuArg = '1,4', apiArg = 'webgl2', sceneArg = 'map'] = process.argv.slice(2), PORT = Number(process.env.PORT ?? 8781);
const AREAS = areasArg === 'both' ? ['ground', 'over'] : areasArg === '-' ? [''] : areasArg.split(',');
const SCENE = sceneArg === 'twin' ? 'go=street&twin=1' : 'go=map';
const srv = await serve(PORT), browser = await launch();
const rows = [];
for (const api of apiArg.split(',')) for (const n of nArg.split(',')) for (const areas of AREAS) for (const cpu of cpuArg.split(',').map(Number)) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    // the bytes over the wire, by host (the services', the base map's)
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable'); await cdp.send('Network.enable');
    const urls = new Map(), wire = new Map();
    cdp.on('Network.requestWillBeSent', (e) => urls.set(e.requestId, e.request.url));
    cdp.on('Network.loadingFinished', (e) => { const u = urls.get(e.requestId); if (!u) return; const h = /\/(wfs|wms)\?/.test(u) ? (u.includes('/wfs') ? 'wfs' : 'wms') : new URL(u).host; wire.set(h, (wire.get(h) ?? 0) + e.encodedDataLength); });
    const t0 = Date.now();
    await page.goto(`http://127.0.0.1:${PORT}/examples/layers/?${SCENE}&n=${n}${areas ? `&areas=${areas}` : ''}&graphics=${api}&dpr=2&list=0`);
    await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 120000 });
    const busy = async () => { const m = (await cdp.send('Performance.getMetrics')).metrics; return (m.find((x) => x.name === 'TaskDuration')?.value ?? 0) * 1000; };
    const svc = () => page.evaluate(() => { const o = { requests: 0, bytes: 0, features: 0 }; for (const s of Object.values(window.aslnutDemo.sources)) if (s?.info) { o.requests += s.info.requests; o.bytes += s.info.bytes; o.features += s.info.features; } return o; });
    const kb = (m) => Object.fromEntries([...m].filter(([, v]) => v > 0).map(([k, v]) => [k, Math.round(v / 1024)]));
    await page.evaluate(async () => { const { w } = window.aslnutDemo; await w.settled({ timeout: 150000 }).catch(() => {}); });
    const first = { ms: Date.now() - t0, ...(await svc()), wireKB: kb(wire) };
    await page.evaluate(async () => { await new Promise((ok) => setTimeout(ok, 3000)); window.aslnutDemo.w.drawnWhy(); });
    if (cpu !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpu });
    // at rest: 3 s of a settled, still view
    const b0 = await busy();
    const rest = await page.evaluate(async () => { const { w } = window.aslnutDemo, s0 = w.stats(); await new Promise((ok) => setTimeout(ok, 3000)); const s1 = w.stats(); return { drawn: s1.drawn - s0.drawn, asked: s1.skipped - s0.skipped + (s1.drawn - s0.drawn) }; });
    const restBusy = ((await busy()) - b0) / 3;
    // moving: a 3 s flight (pan, turn, a little zoom), each frame's own numbers
    const move = await page.evaluate(async () => {
      const { w } = window.aslnutDemo, v = w.camera, from = { lon: v.lon, lat: v.lat, zoom: v.zoom, tilt: 62, bearing: 330 }, cpu = [], gpu = [], passes = [], draws = [];
      const mine = new Set(window.aslnutDemo.layers), own = [];
      const off = w.on('frame', () => { const p = w.frameProfile(); cpu.push(p.tickMs + p.submitMs); if (p.gpuMs !== null) gpu.push(p.gpuMs); passes.push(p.passes); draws.push(p.draws); let m = 0; for (const [id, ms] of w.layerMs) if (mine.has(id)) m += ms; own.push(m); });
      await w.fly({ ...from, lon: from.lon + 0.004, lat: from.lat - 0.002, bearing: 350, zoom: from.zoom + 0.3 }, { seconds: 3 });
      off();
      const med = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length / 2)] : null), p95 = (a) => (a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length * 0.95)] : null);
      const t = w.telemetry(), s = w.stats();
      return { frames: cpu.length, cpu: med(cpu), cpu95: p95(cpu), layersMs: med(own), gpu: med(gpu), passes: med(passes), draws: med(draws), gpuMB: t.memoryMB, heapMB: s.heapBytes ? +(s.heapBytes / 1048576).toFixed(1) : null };
    });
    await page.evaluate(async () => { const { w } = window.aslnutDemo; w.go({ lon: 145.1205, lat: -37.9245, zoom: 17.3, tilt: 62, bearing: 330 }); await w.settled({ timeout: 150000 }).catch(() => {}); await new Promise((ok) => setTimeout(ok, 2000)); });
    // one change: frames, display frames asked, main-thread ms over a quiet second, overlays drawn, what was built again
    const change = async (what) => {
      const q0 = await busy(); await page.evaluate(() => new Promise((ok) => setTimeout(ok, 1000))); const quiet = (await busy()) - q0;
      const c0 = await busy();
      const r = await page.evaluate(async (what) => {
        const { w } = window.aslnutDemo, g = w.graphics, orig = g.frame.bind(g);
        let overlays = 0, uploadBytes = 0;
        g.frame = (d, o) => { if (o.target) overlays++; return orig(d, o); };
        const ls = w.list.filter((l) => window.aslnutDemo.layers.includes(l.id));
        const gen = () => ls.map((l) => `${l.geoGen ?? ''}:${l.seen?.scales ?? ''}:${l.segs?.count ?? ''}`).join('|');
        let frameMs = 0;
        const g0 = gen(), s0 = w.stats(), off = w.on('frame', () => { const p = w.frameProfile(); uploadBytes += p.uploadBytes; frameMs = Math.max(frameMs, p.tickMs + p.submitMs); });
        if (what === 'hide') w.hide('suburbs', { seconds: 0 });
        else if (what === 'show') w.release('suburbs', { seconds: 0 });
        else if (what === 'opacity') w.setOpacity('suburbs', w.element('suburbs').props.opacity === 0.3 ? 0.55 : 0.3);
        // (the stack's last draped layer moved to its bottom: a line under the areas)
        else if (what === 'reorder') { const ids = ls.filter((l) => l.kind === 'area' || l.kind === 'line').map((l) => l.id); ids.unshift(ids.pop()); w.reorder([...ids, ...ls.filter((l) => !ids.includes(l.id)).map((l) => l.id)]); }
        await new Promise((ok) => setTimeout(ok, 1000));
        off(); g.frame = orig;
        const s1 = w.stats();
        return { drawn: s1.drawn - s0.drawn, asked: s1.skipped - s0.skipped + (s1.drawn - s0.drawn), overlays, uploadKB: Math.round(uploadBytes / 1024), rebuilt: gen() !== g0, frameMs: +frameMs.toFixed(2) };
      }, what);
      return { ...r, ms: +((await busy()) - c0 - quiet).toFixed(1) };
    };
    // the services: a pan to new ground (half a screen's width and more), and back
    const pans = {};
    for (const [k, d] of [['pan', 0.03], ['back', 0]]) {
      wire.clear(); const s0 = await svc(), t1 = Date.now();
      await page.evaluate(async (d) => { const { w } = window.aslnutDemo, c = w.camera; w.go({ lon: 145.1215 + d, lat: c.lat, zoom: c.zoom, tilt: w.state.view.tilt, bearing: w.state.view.bearing }); await w.settled({ timeout: 120000 }).catch(() => {}); }, d);
      const s1 = await svc(); pans[k] = { ms: Date.now() - t1, requests: s1.requests - s0.requests, kB: Math.round((s1.bytes - s0.bytes) / 1024), wireKB: kb(wire) };
    }
    await page.evaluate(async () => { const { w } = window.aslnutDemo, c = w.camera; w.go({ lon: 145.1215, lat: c.lat, zoom: c.zoom, tilt: w.state.view.tilt, bearing: w.state.view.bearing }); await w.settled({ timeout: 60000 }).catch(() => {}); });
    const has = await page.evaluate(() => window.aslnutDemo.layers.includes('suburbs'));
    const none = { drawn: 0, asked: 0, overlays: 0, uploadKB: 0, rebuilt: false, ms: 0 };
    // each change three times (hidden and shown, the opacity there and back, the stack turned): the median by its ms
    const thrice = async (a, b = a) => { if (!has) return [none, none]; const xs = [await change(a), await change(b), await change(a), await change(b), await change(a), await change(b)]; const pick = (k) => xs.filter((_, i) => i % 2 === k).sort((x, y) => x.ms - y.ms)[1]; return [pick(0), pick(1)]; };
    const [hide, show] = await thrice('hide', 'show'), [opacity] = await thrice('opacity'), [reorder] = await thrice('reorder');
    if (cpu !== 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    const row = { api, scene: sceneArg, n: Number(n), areas, cpu, first, pans, ...move, restFps: +(rest.drawn / 3).toFixed(1), restAsked: +(rest.asked / 3).toFixed(1), restBusy: +restBusy.toFixed(1), hide, show, opacity, reorder, errors: errors.slice(0, 2) };
    rows.push(row);
    const ch = (c) => `${c.drawn}f/${c.asked}a ${c.frameMs}ms frame, ${c.ms}ms busy, ov${c.overlays} up${c.uploadKB}KB${c.rebuilt ? ' REBUILT' : ''}`;
    console.log(`${api} ${sceneArg} n=${n} ${(areas || '-').padEnd(6)} cpu×${cpu}: first load ${first.ms} ms, ${first.requests} WFS requests, ${Math.round(first.bytes / 1024)} kB read (wire ${JSON.stringify(first.wireKB)}) | pan ${JSON.stringify(pans.pan)} | back ${JSON.stringify(pans.back)} | moving cpu ${move.cpu?.toFixed(2)} (p95 ${move.cpu95?.toFixed(2)}; the data layers' own ${move.layersMs?.toFixed(2)}) ms · chip ${move.gpu ?? '–'} ms · ${move.passes} passes · ${move.draws} draws · ${move.frames} frames · gpu ${move.gpuMB} MB · heap ${move.heapMB} MB · rest ${row.restFps} f/s (${row.restAsked} asked, ${row.restBusy} ms/s) | hide ${ch(hide)} | show ${ch(show)} | opacity ${ch(opacity)} | reorder ${ch(reorder)}${errors.length ? ` · ERR ${errors[0].slice(0, 120)}` : ''}`);
  } catch (e) { console.log(`${api} ${sceneArg} n=${n} ${areas} cpu×${cpu} FAIL ${String(e.message).slice(0, 300)}`); }
  await page.close();
}
if (process.env.JSON) console.log(JSON.stringify(rows));
await browser.close(); srv.close();
