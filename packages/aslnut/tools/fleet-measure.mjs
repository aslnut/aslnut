// The fleet measured at one realistic setting, varying only N: the fleet example on a phone's view (390 × 844 at dpr 2,
// touch) in headless Chrome on the chip (WebGL2), the CPU at ×1 and slowed ×4 (CDP), with the browser's own numbers:
// main-thread busy ms (TaskDuration), the JS heap and the typed arrays' backing stores after a collection, the
// graphics memory the set holds. Per case:
//   build      the fleet added to a settled world (its log loaded, its columns uploaded, its trail pieces counted)
//   playing    main-thread ms a frame while it plays at 4× (and the layer's own ms a frame)
//   rest       paused and settled: frames drawn in 3 s
//   seek       a jump of 10 minutes: busy ms until drawn, bytes uploaded
//   append     a live log of N vehicles: one sample each (a stream's tick), its append ms, the next frame's upload
//   node tools/fleet-measure.mjs [cases=A-2000,A-10000,B-2000,B-10000] [throttles=1,4]   (EXAMPLES_KEEP_BUILD=1 npx
//   vite build first) → .out/fleet-measure/results.json
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 8397), OUT = join(import.meta.dirname, '..', '.out', 'fleet-measure');
mkdirSync(OUT, { recursive: true });
const CASES = (process.argv[2] ?? 'A-2000,A-10000,B-2000,B-10000').split(','), RATES = (process.argv[3] ?? '1,4').split(',').map(Number);
const MB = 1048576, r2 = (x) => Math.round(x * 100) / 100;
const srv = await serve(PORT), browser = await launch({ graphics: process.env.ASLNUT_GPU ?? 'gpu' });
const rows = [];
for (const rate of RATES) for (const c of CASES) {
  const [setting, n] = c.split('-'), twin = setting === 'B';
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/examples/fleet/?graphics=webgl2&n=${n}&defer=1&log=0&panel=0&t=20&speed=4&trail=60${twin ? '&twin=1&go=street' : '&go=city'}`);
    await page.waitForFunction(() => window.aslnutDemo?.start, null, { timeout: 120000 });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const busy = async () => ((await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0) * 1000;
    const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); const u = await cdp.send('Runtime.getHeapUsage'); return { js: u.usedSize / MB, buffers: (u.backingStorageSize ?? 0) / MB }; };
    const timed = async (f, a) => { const b0 = await busy(), t0 = Date.now(); const r = await page.evaluate(f, a); return { r, busy: (await busy()) - b0, wall: Date.now() - t0 }; };
    // the world and (B) the twin loaded and resting first (the CPU slowed only then): only the fleet is measured
    await page.evaluate(async () => { const { w } = window.aslnutDemo; await w.settled({ timeout: 180000 }); for (let i = 0; i < 600; i++) { if (w.telemetry().frames.resting && w.report().settled) { await new Promise((ok) => setTimeout(ok, 1000)); if (w.telemetry().frames.resting) return; } await new Promise((ok) => setTimeout(ok, 200)); } });
    await cdp.send('Emulation.setCPUThrottlingRate', { rate });
    const h0 = await heap();
    const gpu0 = await page.evaluate(() => window.aslnutDemo.w.graphics.bytes / 1048576);
    const build = await timed(() => window.aslnutDemo.start());
    const h1 = await heap();
    const info = await page.evaluate(() => { const { w, fleet } = window.aslnutDemo; const mine = w.graphics.memory().filter((m) => m.label.startsWith('fleet ')).reduce((s, m) => s + m.bytes, 0); return { counts: fleet.counts(), fleetGpuMB: mine / 1048576, gpuTotalMB: w.graphics.bytes / 1048576, renderer: w.stats().device }; });
    // playing at 4× for 4 s
    const play = await timed(async () => {
      const { w, play } = window.aslnutDemo, f0 = w.renderer.frames, ms = [];
      const off = w.on('frame', () => { const l = w.telemetry().elements.find((x) => x.id === 'fleet'); if (l) ms.push(l.ms); });
      play.setSpeed(4); play.play(); await new Promise((ok) => setTimeout(ok, 4000)); play.pause(); off();
      ms.sort((a, b) => a - b);
      return { frames: w.renderer.frames - f0, layerP50: ms[ms.length >> 1] ?? null, layerP95: ms[Math.floor(ms.length * 0.95)] ?? null, gpuMs: w.frameProfile().gpuMs };
    });
    // paused and settled: frames in 3 s
    await page.evaluate(() => window.aslnutDemo.w.settled({ timeout: 60000 }));
    const rest = await timed(async () => { const { w } = window.aslnutDemo, f0 = w.renderer.frames; await new Promise((ok) => setTimeout(ok, 3000)); return { frames: w.renderer.frames - f0 }; });
    // a seek: ten minutes on, until it is drawn
    const seek = await timed(async () => { const { w, play } = window.aslnutDemo; const g = w.graphics; play.seek(play.time.getTime() + 600e3); await new Promise((ok) => w.once('frame', ok)); return { uploadBytes: g.stats.uploadBytes }; });
    await page.evaluate(() => window.aslnutDemo.w.settled({ timeout: 60000 }));
    // a stream's tick: a live log of N vehicles, one new sample each
    const live = await page.evaluate(async (N) => {
      const { w, lib } = window.aslnutDemo, log = lib.history.log({ values: { charge: 'u8' }, keep: 64 });
      const t0 = w.time.getTime(), place = (i, k) => [145.09 + (i % 100) * 7e-4 + k * 2e-5, -37.95 + Math.floor(i / 100) * 5e-4];
      for (let k = 0; k < 8; k++) for (let i = 0; i < N; i++) { const p = place(i, k); log.append(`L${i}`, t0 - 8000 + k * 1000, p[0], p[1], { charge: k / 8 }); }
      w.add(lib.entities({ id: 'live', drive: lib.drive.data(log), color: { value: 'charge', ramp: 'viridis' }, trail: { seconds: 30 } }));
      await w.settled({ timeout: 60000 });
      const g = w.graphics, ticks = [];
      for (let r = 0; r < 3; r++) {
        const a0 = performance.now(); for (let i = 0; i < N; i++) { const p = place(i, 8 + r); log.append(`L${i}`, t0 + 1000 + r * 1000, p[0], p[1], { charge: 1 }); } const appendMs = performance.now() - a0;
        const f0 = performance.now(); w.invalidate(); await new Promise((ok) => w.once('frame', ok)); const frameWall = performance.now() - f0;
        ticks.push({ appendMs, uploadBytes: g.stats.uploadBytes, uploads: g.stats.uploads, liveLayerMs: w.telemetry().elements.find((x) => x.id === 'live')?.ms ?? null, frameWall });
      }
      return ticks;
    }, Number(n));
    const row = {
      case: c, setting, n: Number(n), cpuRate: rate, renderer: info.renderer,
      buildBusyMs: r2(build.busy), buildWallMs: build.wall,
      heapMB: r2(h1.js + h1.buffers - h0.js - h0.buffers), heapJsMB: r2(h1.js - h0.js), heapBuffersMB: r2(h1.buffers - h0.buffers),
      fleetGpuMB: r2(info.fleetGpuMB), gpuAddedMB: r2(info.gpuTotalMB - gpu0), counts: info.counts,
      playFrames: play.r.frames, playBusyPerFrameMs: r2(play.busy / Math.max(1, play.r.frames)), playLayerP50Ms: play.r.layerP50, playLayerP95Ms: play.r.layerP95, gpuMs: play.r.gpuMs,
      restFrames: rest.r.frames, restBusyPerSMs: r2(rest.busy / 3),
      seekBusyMs: r2(seek.busy), seekUploadBytes: seek.r.uploadBytes,
      append: live.map((t) => ({ appendMs: r2(t.appendMs), uploadBytes: t.uploadBytes, uploads: t.uploads, layerMs: t.liveLayerMs })),
      errors: errors.slice(0, 3),
    };
    rows.push(row);
    console.log(JSON.stringify(row));
  } catch (e) { console.log(`FAIL ${c} ×${rate}: ${e.message.slice(0, 300)}`); rows.push({ case: c, cpuRate: rate, error: e.message }); }
  await ctx.close();
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(rows, null, 1));
await browser.close(); srv.close();
