// The arcs alone, measured (why the twin's park access arcs are heavy), and the twin's park access mode switch,
// profiled. On a phone's view: 390 × 844 at dpr 2 (780 × 1688 px), WebGL2 (the chip) and WebGPU (SwiftShader here: its
// CPU ms only indicative).
//   node tools/arc-bench.mjs dump                       the twin's real arc set (its houses → nearest park edge, the
//                                                       same heights) → .out/arc-bench/twin-arcs.json
//   node tools/arc-bench.mjs bench [points] [grounds] [apis]
//        the twin's set alone. points: auto (the arc's default, by length),8,64 · grounds: flat,terrain (the twin's
//        ground: its tiles arrive) · apis: webgl2 (default), webgpu. The bench page (tools/arc-bench) is built apart
//        into .out/arc-bench/dist; nothing else is drawn but the plain ground. Each: the build (main thread), GPU MB,
//        the chip's and the CPU's ms a frame (still, and while the camera moves), frames at rest, and what a ground
//        change does (the arcs' heights read again and uploaded)
//   node tools/arc-bench.mjs twin [apis] [throttle]     the twin (`?go=twin&ui=twin`): tap "Along footpaths" and
//                                                       "Straight line" (twice each), then pan: long tasks, the runs,
//                                                       where the ms go (each step timed from outside, and a CPU
//                                                       profile: inclusive ms by function); throttle 4: a mid phone
//   ASLNUT_DIST=<a build's dist-examples> measures that build's twin; PORT=…
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { launch, bytesOf } from './browser.mjs';
import { png } from './png.mjs';

const PKG = resolve(import.meta.dirname, '..'), OUT = join(PKG, '.out', 'arc-bench');
mkdirSync(OUT, { recursive: true });
const [cmd = 'bench', a1, a2, a3] = process.argv.slice(2), PORT = Number(process.env.PORT ?? 8761);
const VIEWPORT = { width: 390, height: 844 };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : 0; };
const pct = (a, k) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))] : 0; };
const r2 = (x) => Math.round(x * 100) / 100;

async function servePkg(dist) {
  if (dist) process.env.ASLNUT_DIST = dist;
  const { serve } = await import('./serve.mjs');
  return serve(PORT);
}
async function cdpOf(page) { const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable'); return cdp; }
const busyMs = async (cdp) => ((await cdp.send('Performance.getMetrics')).metrics.find((x) => x.name === 'TaskDuration')?.value ?? 0) * 1000;

// ── dump: the twin's arcs ──────────────────────────────────────────────────────────────────────────────────────────
if (cmd === 'dump') {
  const srv = await servePkg(), browser = await launch();
  const page = await browser.newPage({ viewport: VIEWPORT });
  await page.goto(`http://127.0.0.1:${PORT}/examples/healthy-city/?go=twin&ui=twin&graphics=webgl2&quality=realistic&dpr=2&log=0`);
  await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 120000 });
  const r = await page.evaluate(async () => {
    const { w, access } = window.aslnutDemo;
    await w.settled({ timeout: 150000 }).catch(() => {});
    await new Promise((ok) => setTimeout(ok, 3000));
    const arcs = w.element('access-arcs'), fs = arcs.source.features(), t = w.telemetry();
    return {
      arcs: fs.map((f) => [f.props.from[0], f.props.from[1], f.props.to[0], f.props.to[1], f.props.top ?? 0, f.props.dist, f.props.t]),
      segments: arcs.readouts().segments(), points: arcs.readouts().segments() + arcs.size, MB: t.memory.find((m) => m.id === 'access-arcs')?.MB, total: t.memoryMB, view: w.camera.view,
      tiles: window.aslnutDemo.street.built().length,
    };
  });
  writeFileSync(join(OUT, 'twin-arcs.json'), JSON.stringify(r.arcs));
  const lens = r.arcs.map((a) => a[5]).sort((x, y) => x - y);
  console.log(`twin arcs: ${r.arcs.length} (street tiles built ${r.tiles}) · in the twin: ${r.segments} segments, ${r.points} points, ${r.MB} MB of ${r.total} MB · distance median ${Math.round(med(lens))} m, p95 ${Math.round(pct(lens, 0.95))} m, max ${Math.round(lens[lens.length - 1])} m → ${join(OUT, 'twin-arcs.json')}`);
  await browser.close(); srv.close();
}

// ── bench: the arcs alone ──────────────────────────────────────────────────────────────────────────────────────────
if (cmd === 'bench') {
  const sets = (a1 ?? 'auto,8,64').split(','), grounds = (a2 ?? 'flat,terrain').split(','), apis = (a3 ?? 'webgl2').split(',');
  const dist = join(OUT, 'dist');
  const { build } = await import('vite');
  await build({ root: join(PKG, 'tools', 'arc-bench'), base: './', configFile: false, logLevel: 'warn', define: { __BUILD__: '0' }, build: { outDir: dist, emptyOutDir: true, target: 'es2022', minify: false, sourcemap: false } });
  if (!existsSync(join(OUT, 'twin-arcs.json'))) throw new Error('no twin set: run `node tools/arc-bench.mjs dump` first');
  const twin = JSON.parse(readFileSync(join(OUT, 'twin-arcs.json'), 'utf8'));
  const srv = await servePkg(dist), browser = await launch(), results = [];
  for (const api of apis) for (const ground of grounds) for (const set of sets) {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await page.goto(`http://127.0.0.1:${PORT}/?graphics=${api}&dpr=2&ground=${ground}&quality=realistic${set !== 'auto' ? `&points=${set}` : ''}`);
      await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 120000 });
      const cdp = await cdpOf(page);
      // 1. the build: set → the first frame that drew them (the main thread's ms, and the arc layer's own steps)
      const b = await page.evaluate(async ({ list }) => {
        const D = window.aslnutDemo, { w, times } = D;
        await w.settled({ timeout: 120000 }).catch(() => {});
        await new Promise((ok) => setTimeout(ok, 1500));
        // the chip's ms a frame, 60 frames drawn back to back with the view still (the plain ground alone, then with the arcs)
        const still = async () => { const g = [], c = [], off = w.everyFrame?.(() => {}), f0 = w.report().frames, t0 = performance.now(); for (let i = 0; i < 60; i++) { w.invalidate(); await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))); const p = w.frameProfile(); c.push(p.tickMs + p.submitMs); if (p.gpuMs != null) g.push(p.gpuMs); } const wall = (performance.now() - t0) / Math.max(1, w.report().frames - f0); off?.(); const m = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; }; return { gpu: m(g), cpu: m(c), wall }; };
        const still0 = await still();
        const base = w.stats().gpuBytes, gv0 = w.groundVersion;
        for (const k in times) times[k].length = 0;
        const arcs = list;
        const ticks = [], off = w.on('frame', () => { const p = w.frameProfile(); ticks.push({ ms: p.tickMs + p.submitMs, up: p.uploadBytes }); });
        const long = [], obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(e.duration); }); obs.observe({ type: 'longtask' });
        const t0 = performance.now(); D.set(arcs); const setMs = performance.now() - t0;
        for (let i = 0; i < 600 && !times.build.length; i++) await new Promise((ok) => { const o = w.on('frame', () => { o(); ok(); }); setTimeout(ok, 200); });
        const firstMs = performance.now() - t0;
        // (a frame's profile is read in the next frame's event: the build's frame is among the first few)
        for (let i = 0; i < 3; i++) await new Promise((ok) => requestAnimationFrame(ok));
        await new Promise((ok) => setTimeout(ok, 300)); obs.disconnect();
        const firstTick = Math.max(0, ...ticks.slice(0, 4).map((x) => x.ms)), longMax = Math.max(0, ...long);
        await w.settled({ timeout: 120000 }).catch(() => {});
        off();
        const still1 = await still();
        const t = w.telemetry(), L = t.elements.find((l) => l.id === 'arcs');
        const sum = (a) => a.reduce((x, y) => x + y, 0);
        return {
          arcs: arcs.length, segments: D.layer.readouts().segments(), points: D.layer.readouts().segments() + arcs.length, setMs, firstMs, firstTick, longMax,
          read: sum(times.read), build: sum(times.build), ground: sum(times.ground), groundCalls: times.ground.length, upload: sum(times.upload), uploads: times.upload.length,
          arcMB: t.memory.find((m) => m.id === 'arcs')?.MB ?? 0, gpuDeltaMB: (w.stats().gpuBytes - base) / 1048576, totalMB: t.memoryMB,
          still0, still1, draws: L?.draws ?? 0, triangles: L?.triangles ?? 0, groundChanged: w.groundVersion !== gv0, api: w.graphicsApi,
          heapMB: performance.memory ? performance.memory.usedJSHeapSize / 1048576 : null,
        };
      }, { list: twin });
      // the picture (the arcs at the twin's view), to set beside another build's
      const shot = await page.evaluate(async () => { const { w } = window.aslnutDemo; const f = await w.frame(); let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768)); return { width: f.width, height: f.height, b64: btoa(bin) }; });
      writeFileSync(join(OUT, `arcs-${process.env.LABEL ?? 'now'}-${api}-${ground}-${set}.png`), png(shot.width, shot.height, bytesOf(shot)));
      // 2. at rest: 3 s of a settled, still view
      await page.evaluate(() => new Promise((ok) => setTimeout(ok, 1000)));
      const b0 = await busyMs(cdp), t0 = Date.now();
      const rest = await page.evaluate(async () => {
        const { w, times } = window.aslnutDemo, f0 = w.report().frames, g0 = times.ground.length;
        await new Promise((ok) => setTimeout(ok, 3000));
        const t = w.telemetry();
        return { frames: w.report().frames - f0, wants: t.elements.find((l) => l.id === 'arcs')?.wants ?? 0, resting: t.frames.resting, ground: times.ground.length - g0 };
      });
      const restSecs = (Date.now() - t0) / 1000, restBusy = ((await busyMs(cdp)) - b0) / restSecs;
      // 3. the camera moving: an orbit and a zoom for 3 s (no ground arrives on the flat ground)
      const m0 = await busyMs(cdp);
      const mv = await page.evaluate(async () => {
        const { w, times } = window.aslnutDemo, v0 = (({ lon, lat, zoom, tilt, bearing }) => ({ lon, lat, zoom, tilt, bearing }))(w.camera.view), cpu = [], arcMs = [], g0 = times.ground.length, gm0 = times.ground.reduce((a, b) => a + b, 0), f0 = w.report().frames, ub = [];
        const off = w.on('frame', () => { const p = w.frameProfile(); cpu.push(p.tickMs + p.submitMs); const a = p.elements.find((l) => l[0] === 'arcs'); arcMs.push(a ? a[1] : 0); ub.push(p.uploadBytes); });
        const start = performance.now();
        await new Promise((done) => { const step = () => { const s = (performance.now() - start) / 1000; w.go({ lon: v0.lon, lat: v0.lat, zoom: v0.zoom - 0.4 * Math.sin(s * 1.3), tilt: v0.tilt, bearing: v0.bearing + 30 * s }); if (s < 3) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
        off(); const gpuMs = w.telemetry().gpuMs; w.go(v0);
        return { gpuMs, frames: w.report().frames - f0, cpuMed: 0, cpu, arcMs, ground: times.ground.length - g0, groundMs: times.ground.reduce((a, b) => a + b, 0) - gm0, upMB: ub.reduce((a, b) => a + b, 0) / 1048576 };
      });
      const moveBusy = ((await busyMs(cdp)) - m0) / Math.max(1, mv.frames);
      // 4. a ground change: pan 600 m east over 4 s (new ground tiles arrive on the twin's ground): the arcs' heights
      //    read again and uploaded, how often and how long
      const pan = await page.evaluate(async () => {
        const { w, times } = window.aslnutDemo, v0 = (({ lon, lat, zoom, tilt, bearing }) => ({ lon, lat, zoom, tilt, bearing }))(w.camera.view), kx = 111320 * Math.cos((v0.lat * Math.PI) / 180);
        const g0 = times.ground.length, gm0 = times.ground.reduce((a, b) => a + b, 0), u0 = times.uploadBytes.reduce((a, b) => a + b, 0), gv0 = w.groundVersion, cpu = [], long = [];
        const obs = new PerformanceObserver((l) => { for (const e of l.getEntries()) long.push(e.duration); }); obs.observe({ type: 'longtask' });
        const off = w.on('frame', () => { const p = w.frameProfile(); cpu.push(p.tickMs + p.submitMs); });
        const start = performance.now();
        await new Promise((done) => { const step = () => { const s = (performance.now() - start) / 1000; w.go({ ...v0, lon: v0.lon + (Math.min(s, 4) * 150) / kx }); if (s < 4) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
        await new Promise((ok) => setTimeout(ok, 1500));
        off(); obs.disconnect();
        const gs = times.ground.slice(g0);
        return { groundVersions: w.groundVersion - gv0, ground: gs.length, groundMs: gs.reduce((a, b) => a + b, 0), groundMax: Math.max(0, ...gs), upMB: (times.uploadBytes.reduce((a, b) => a + b, 0) - u0) / 1048576, cpu, long };
      });
      const row = {
        api: b.api, ground, points: set, arcs: b.arcs, segments: b.segments, points: b.points,
        buildMs: r2(b.firstTick), buildLongTask: r2(b.longMax), setMs: r2(b.setMs), readMs: r2(b.read), buildStepMs: r2(b.build), groundMs: r2(b.ground), uploadMs: r2(b.upload), uploads: b.uploads, groundCalls: b.groundCalls, firstFrameMs: r2(b.firstMs),
        stillGpu0: b.still0.gpu, stillGpu1: b.still1.gpu, stillCpu0: b.still0.cpu, stillCpu1: b.still1.cpu, stillWall0: r2(b.still0.wall), stillWall1: r2(b.still1.wall), arcMB: b.arcMB, gpuDeltaMB: r2(b.gpuDeltaMB), totalMB: b.totalMB, draws: b.draws, triangles: b.triangles, heapMB: b.heapMB && r2(b.heapMB),
        restFrames: rest.frames, restWants: rest.wants, resting: rest.resting, restBusyMsPerS: r2(restBusy), restGround: rest.ground,
        moveFrames: mv.frames, moveGpuMs: mv.gpuMs, moveCpuMed: r2(med(mv.cpu)), moveCpuP95: r2(pct(mv.cpu, 0.95)), moveArcMsMed: r2(med(mv.arcMs)), moveBusyPerFrame: r2(moveBusy), moveGround: mv.ground, moveUpMB: r2(mv.upMB),
        panGroundVersions: pan.groundVersions, panGround: pan.ground, panGroundMs: r2(pan.groundMs), panGroundMax: r2(pan.groundMax), panUpMB: r2(pan.upMB), panCpuMed: r2(med(pan.cpu)), panCpuP95: r2(pct(pan.cpu, 0.95)), panLong: pan.long.length, panLongMax: r2(Math.max(0, ...pan.long)),
        errors: errors.slice(0, 2),
      };
      results.push(row);
      console.log(`${row.api.padEnd(6)} ${ground.padEnd(7)} points ${String(set).padEnd(4)} ${row.arcs} arcs, ${row.segments} segs · build ${row.buildMs} ms (long task ${row.buildLongTask}; read ${row.readMs}, build ${row.buildStepMs}, ground ${row.groundMs}, upload ${row.uploadMs}; set ${row.setMs}) · ${row.arcMB} MB (gpu +${row.gpuDeltaMB}) · ${row.draws} draws ${row.triangles} tri · still: chip ${row.stillGpu0} → ${row.stillGpu1} ms, CPU ${row.stillCpu0} → ${row.stillCpu1} ms, wall ${row.stillWall0} → ${row.stillWall1} ms a frame · moving: ${row.moveCpuMed} ms/frame (gpu ${row.moveGpuMs}, p95 ${row.moveCpuP95}, arcs ${row.moveArcMsMed}), busy ${row.moveBusyPerFrame} ms/frame, ${row.moveFrames} frames · rest: ${row.restFrames} frames, wants ${row.restWants}, ${row.restBusyMsPerS} ms/s · pan: ${row.panGroundVersions} ground versions → ${row.panGround} re-heights, ${row.panGroundMs} ms (max ${row.panGroundMax}), ${row.panUpMB} MB uploaded, frame p95 ${row.panCpuP95} ms, long tasks ${row.panLong} (max ${row.panLongMax})${errors.length ? ` · errors: ${errors.slice(0, 2).join(' | ')}` : ''}`);
    } catch (e) { console.log(`${api} ${ground} ${set} FAIL ${String(e.message).slice(0, 300)}`); }
    await page.close();
  }
  writeFileSync(join(OUT, `bench-${Date.now()}.json`), JSON.stringify(results, null, 1));
  await browser.close(); srv.close();
}

// ── twin: the park access mode switch ──────────────────────────────────────────────────────────────────────────────
if (cmd === 'twin') {
  const apis = (a1 ?? 'webgl2').split(','), throttle = Number(a2 ?? 1);
  const srv = await servePkg(), browser = await launch();
  for (const api of apis) {
    const page = await browser.newPage({ viewport: VIEWPORT });
    const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    try {
      await page.goto(`http://127.0.0.1:${PORT}/examples/healthy-city/?go=twin&ui=twin&graphics=${api}&quality=realistic&dpr=2&log=0`);
      await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 120000 });
      const cdp = await cdpOf(page);
      const ready = await page.evaluate(async () => {
        const { w, access, street } = window.aslnutDemo;
        await w.settled({ timeout: 150000 }).catch(() => {});
        await new Promise((ok) => setTimeout(ok, 3000));
        // timed from outside (the example and the library are not changed for this): the runs, the network's passes,
        // the rows handed to the layers, the tint, the panel, and the three layers' own steps
        const T = (window.__T = {}), stack = [];
        const add = (k, ms) => { const e = (T[k] ??= { n: 0, ms: 0 }); e.n++; e.ms += ms; };
        const wrap = (obj, m, key, after) => {
          const f = obj?.[m]; if (typeof f !== 'function' || f.__timed) return false;
          const g = function (...args) { const k = stack.length ? `${key} (in ${stack[stack.length - 1]})` : key; stack.push(key); const t0 = performance.now(); try { const r = f.apply(this, args); return after ? after(r) : r; } finally { stack.pop(); add(k, performance.now() - t0); } };
          g.__timed = true; obj[m] = g; return true;
        };
        const log = (window.__runs = []), run = access.run;
        access.run = function () { const t0 = performance.now(); try { return run.call(this); } finally { log.push({ at: t0, ms: performance.now() - t0, mode: access.mode }); } };
        wrap(access, 'run', 'run');
        const net = access.walkNet;
        if (net) {
          wrap(net, 'shortest', 'shortest', (sp) => { wrap(sp, 'costAt', 'costAt'); wrap(sp, 'pathFrom', 'pathFrom'); return sp; });
          wrap(net, 'isochrone', 'isochrone'); wrap(net, 'nearest', 'nearest');
        }
        // the walk pass made earlier keeps its own costAt: timed too
        if (access.walk?.sp) wrap(access.walk.sp, 'costAt', 'costAt');
        wrap(access.routes, 'set', 'routes.set'); wrap(access.bands, 'set', 'bands.set'); wrap(street, 'tint', 'tint'); wrap(access, 'onStats', 'panel');
        // (the place worked out once, off the page: what is left here)
        for (const m of ['scan', 'apply', 'rescale', 'stats', 'show']) wrap(access, m, m);
        if (access.routes && typeof access.routes.append === 'function') wrap(access.routes, 'append', 'routes.append');
        if (access.arcRows) wrap(access.arcRows, 'upsert', 'arcRows.upsert');
        for (const id of ['access-arcs', 'access-routes', 'access-bands']) { const l = w.element(id); for (const m of ['read', 'build', 'ground', 'upload', 'boxes']) wrap(l, m, `${id}.${m}`); }
        window.__long = []; new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__long.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask' });
        window.__ticks = []; w.on('frame', () => { const p = w.frameProfile(); window.__ticks.push({ at: performance.now(), ms: p.tickMs + p.submitMs }); });
        const place = access.info;  // (the place worked out once in a worker, when it is)
        return { walkNet: !!net || !!place, nodes: net?.size.nodes ?? place?.nodes ?? 0, pieces: net?.size.pieces ?? place?.pieces ?? 0, tiles: street.built().length, place: place ? `${place.entrances} entrances, ${place.parks} parks, worked out in ${Object.entries(place.ms).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ')} ms (off the page)` : '' };
      });
      console.log(`${api} ×${throttle} the twin settled: walking graph ${ready.walkNet ? `${ready.nodes} nodes, ${ready.pieces} pieces` : 'none (streets)'} · ${ready.tiles} street tiles${ready.place ? ` · ${ready.place}` : ''}`);
      if (throttle > 1) await cdp.send('Emulation.setCPUThrottlingRate', { rate: throttle });
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
      const snap = () => page.evaluate(() => JSON.parse(JSON.stringify(window.__T)));
      const diff = (a, b) => Object.entries(b).map(([k, v]) => [k, { n: v.n - (a[k]?.n ?? 0), ms: v.ms - (a[k]?.ms ?? 0) }]).filter(([, v]) => v.n > 0).sort((x, y) => y[1].ms - x[1].ms).map(([k, v]) => `${k} ${Math.round(v.ms)}${v.n > 1 ? ` (×${v.n})` : ''}`).join(' · ');
      const tap = async (mode, label) => {
        const s0 = await snap(); await cdp.send('Profiler.start');
        const r = await page.evaluate(async (mode) => {
          const { w } = window.aslnutDemo, b = document.querySelector(`#access [data-am="${mode}"]`), runs0 = window.__runs.length, long0 = window.__long.length;
          const next = () => new Promise((ok) => { const o = w.on('frame', () => { o(); ok(performance.now()); }); setTimeout(() => ok(NaN), 5000); });
          const t0 = performance.now(); b.click(); const handler = performance.now() - t0;
          const frame = (await next()) - t0;
          await new Promise((ok) => setTimeout(ok, 5000));
          await w.settled({ timeout: 60000 }).catch(() => {});
          const runs = window.__runs.slice(runs0), long = window.__long.slice(long0).filter((l) => l.at >= t0 - 1), ticks = window.__ticks.filter((x) => x.at >= t0).map((x) => x.ms);
          return { handler, frame, runs: runs.map((x) => Math.round(x.ms)), long: long.map((l) => Math.round(l.ms)), tickMax: Math.max(0, ...ticks), stats: document.getElementById('access').textContent.match(/Houses[\d,]+/)?.[0] };
        }, mode);
        const { profile } = await cdp.send('Profiler.stop');
        console.log(`${api} ×${throttle} ${label}: handler ${Math.round(r.handler)} ms, tap → next frame ${Math.round(r.frame)} ms · runs ${r.runs.length} (${r.runs.join(', ')} ms) · long tasks ${r.long.length} (${r.long.join(', ')} ms) · the slowest frame after ${Math.round(r.tickMax)} ms · ${r.stats}`);
        console.log(`   timed: ${diff(s0, await snap())}`);
        console.log(`   profile: ${inclusive(profile)}`);
        return r;
      };
      // the twin's frame drawn back to back (60 frames, the view still): CPU and the chip's ms
      const frameCost = (label) => page.evaluate(async (label) => {
        const { w } = window.aslnutDemo, cpu = [], gpu = [], off = w.everyFrame?.(() => {});
        for (let i = 0; i < 60; i++) { w.invalidate(); await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))); const p = w.frameProfile(); cpu.push(p.tickMs + p.submitMs); if (p.gpuMs != null) gpu.push(p.gpuMs); }
        off?.(); const m = (a) => { const s = [...a].sort((x, y) => x - y); return s.length ? +s[s.length >> 1].toFixed(2) : null; };
        const t = w.telemetry(), L = (id) => t.elements.find((l) => l.id === id), M = (id) => t.memory.find((x) => x.id === id)?.MB ?? 0;
        return `${label}: CPU ${m(cpu)} ms, chip ${m(gpu)} ms a frame · ${t.memoryMB} MB (arcs ${M('access-arcs')}, routes ${M('access-routes')}, bands ${M('access-bands')}) · arcs ${L('access-arcs')?.draws ?? 0} draws ${L('access-arcs')?.triangles ?? 0} tri, routes ${L('access-routes')?.draws ?? 0} draws ${L('access-routes')?.triangles ?? 0} tri`;
      }, label);
      // PAN=off: the same pan with park access off (what the twin itself costs: the baseline), nothing else
      const panOnly = process.env.PAN === 'off';
      if (panOnly) await page.evaluate(async () => { document.querySelector('#b-access').click(); await window.aslnutDemo.w.settled({ timeout: 60000 }).catch(() => {}); await new Promise((ok) => setTimeout(ok, 2000)); });
      if (!panOnly) {
        console.log(`${api} ×${throttle} ${await frameCost('straight line (arcs)')}`);
        await tap('roads', 'straight → along footpaths (first: the walk pass not made yet)');
        console.log(`${api} ×${throttle} ${await frameCost('along footpaths (routes, bands)')}`);
        await tap('straight', 'along footpaths → straight line');
        await tap('roads', 'straight → along footpaths (again)');
      }
      // a pan along footpaths: new street tiles and ground → what runs again
      const s0 = await snap(); await cdp.send('Profiler.start');
      const pan = await page.evaluate(async () => {
        const { w } = window.aslnutDemo, v0 = (({ lon, lat, zoom, tilt, bearing }) => ({ lon, lat, zoom, tilt, bearing }))(w.camera.view), kx = 111320 * Math.cos((v0.lat * Math.PI) / 180), runs0 = window.__runs.length, long0 = window.__long.length, t0 = performance.now(), f0 = w.report().frames, gv0 = w.groundVersion;
        await new Promise((done) => { const step = () => { const s = (performance.now() - t0) / 1000; w.go({ ...v0, lon: v0.lon + (Math.min(s, 6) * 100) / kx }); if (s < 6) requestAnimationFrame(step); else done(); }; requestAnimationFrame(step); });
        await new Promise((ok) => setTimeout(ok, 3000));
        await w.settled({ timeout: 60000 }).catch(() => {});
        // the watcher's own work each drawn frame (street.built() keys sorted and joined)
        const s = window.aslnutDemo.street, k0 = performance.now(); for (let i = 0; i < 50; i++) s.built().map((b) => b.key).sort().join(','); const watch = (performance.now() - k0) / 50;
        const ticks = window.__ticks.filter((x) => x.at >= t0).map((x) => x.ms).sort((a, b) => a - b);
        return { frames: w.report().frames - f0, groundVersions: w.groundVersion - gv0, runs: window.__runs.slice(runs0).map((x) => Math.round(x.ms)), long: window.__long.slice(long0).map((l) => Math.round(l.ms)), watch, tiles: s.built().length, p95: ticks[Math.floor(ticks.length * 0.95)] ?? 0 };
      });
      const { profile } = await cdp.send('Profiler.stop');
      console.log(`${api} ×${throttle} pan 600 m ${panOnly ? 'with park access off' : 'along footpaths'}: ${pan.frames} frames (p95 ${Math.round(pan.p95)} ms), ${pan.groundVersions} ground versions, runs ${pan.runs.length} (${pan.runs.join(', ')} ms), long tasks ${pan.long.length} (max ${Math.max(0, ...pan.long)}, sum ${pan.long.reduce((a, b) => a + b, 0)} ms) · the watcher ${pan.watch.toFixed(3)} ms a frame over ${pan.tiles} tiles`);
      console.log(`   timed: ${diff(s0, await snap())}`);
      console.log(`   profile: ${inclusive(profile)}`);
      if (!panOnly) await tap('straight', 'along footpaths → straight line (after the pan)');
      if (errors.length) console.log(`   errors: ${errors.slice(0, 3).join(' | ')}`);
    } catch (e) { console.log(`${api} twin FAIL ${String(e.message).slice(0, 300)}`); }
    await page.close();
  }
  await browser.close(); srv.close();
}

/** a CPU profile → the functions of interest with their inclusive ms (each sample counted once per function on its
 *  stack) */
function inclusive(profile, want = /^(run|nearestPark|shortest|isochrone|contour|splat|nearest|costAt|sameShape|stringify|accessPanel|tick|earcut|triangulate|lineStrip|fill|bufferSubData|writeBuffer)$/) {
  const byId = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map();
  for (const n of profile.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const ms = new Map(); let total = 0, idle = 0;
  profile.samples.forEach((id, i) => {
    const dt = (profile.timeDeltas[i] ?? 0) / 1000; total += dt;
    const leaf = byId.get(id); if (leaf.callFrame.functionName === '(idle)' || leaf.callFrame.functionName === '(program)') { idle += dt; return; }
    const seen = new Set();
    for (let n = id; n !== undefined; n = parent.get(n)) {
      const cf = byId.get(n).callFrame, name = cf.functionName; if (!name || seen.has(name)) continue; seen.add(name);
      const key = `${name}`; if (want.test(name)) ms.set(key, (ms.get(key) ?? 0) + dt);
    }
  });
  const busy = total - idle;
  // and the functions the time was spent in (self, top 8)
  const self = new Map(); profile.samples.forEach((id, i) => { const cf = byId.get(id).callFrame; if (cf.functionName === '(idle)' || cf.functionName === '(program)') return; const k = `${cf.functionName || '(anonymous)'}:${cf.lineNumber}`; self.set(k, (self.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000); });
  // who calls the hottest one (its callers, by the ms spent in it under them)
  const top = [...self].sort((a, b) => b[1] - a[1])[0]?.[0], callers = new Map();
  if (top) profile.samples.forEach((id, i) => { const cf = byId.get(id).callFrame; if (`${cf.functionName || '(anonymous)'}:${cf.lineNumber}` !== top) return; let up = parent.get(id); while (up !== undefined && byId.get(up).callFrame.functionName === cf.functionName) up = parent.get(up); const pc = up !== undefined ? byId.get(up).callFrame : null; let up2 = up !== undefined ? parent.get(up) : undefined; const gp = up2 !== undefined ? byId.get(up2).callFrame : null; const k = pc ? `${pc.functionName || '(anonymous)'}:${pc.lineNumber}${gp ? ` < ${gp.functionName || '(anonymous)'}:${gp.lineNumber}` : ''}` : '(root)'; callers.set(k, (callers.get(k) ?? 0) + (profile.timeDeltas[i] ?? 0) / 1000); });
  const who = top ? `\n   ${top} called from: ${[...callers].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ')}` : '';
  return `busy ${Math.round(busy)} ms of ${Math.round(total)} · ` + [...ms].sort((a, b) => b[1] - a[1]).slice(0, 22).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ') + `\n   self: ${[...self].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([k, v]) => `${k} ${Math.round(v)}`).join(' · ')}${who}`;
}
