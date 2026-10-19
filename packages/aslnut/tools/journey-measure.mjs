// The journey's cost, shot by shot, at a phone's size (390 × 844 CSS px, pixel ratio 2, quality auto, the real clock):
// for each shot (after its loading hold) its frames a second, the main thread's ms a frame (the world's tick: p50 and
// p95), the frames over 33 ms, the chip's ms where the graphics can time it, the sea's own ms a frame and its tier;
// on the machine's GPU (WebGL2) and, with CPU 4 × slower (a mid-range phone's main thread), again. Where WebGPU has no
// adapter, it runs on SwiftShader: its frames a second are then the software's, not a phone's.
//   node tools/journey-measure.mjs [shots=melbourne,takeoff,flight,landing,kuta,beach] [graphics=webgl2] [cpu=1,4]
//   (serve the build: ASLNUT_DIST=… · PORT=8539) → .out/journey-measure/results.json
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [shotsArg = 'melbourne,takeoff,flight,landing,kuta,beach', apiArg = 'webgl2', cpuArg = '1,4'] = process.argv.slice(2);
const PORT = Number(process.env.PORT ?? 8539), OUT = join(import.meta.dirname, '..', '.out', 'journey-measure');
mkdirSync(OUT, { recursive: true });
const srv = await serve(PORT), browser = await launch();
const rows = [];
for (const api of apiArg.split(',')) for (const cpu of cpuArg.split(',').map(Number)) for (const shot of shotsArg.split(',')) {
  // (the beach: the second shot of go=kuta, started in at its own first second)
  const go = shot === 'beach' ? 'kuta&at=40.5' : shot;
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${PORT}/examples/journey/?go=${go}&graphics=${api}&log=0`);
    await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 120000 });
    await page.waitForFunction(() => !window.aslnutDemo.holding, null, { timeout: 180000 });
    if (cpu > 1) { const c = await page.context().newCDPSession(page); await c.send('Emulation.setCPUThrottlingRate', { rate: cpu }); }
    const r = await page.evaluate(async (shot) => {
      const d = window.aslnutDemo, w = d.w, s = d.shots.find((x) => x.name === (shot === 'beach' ? 'beach' : shot)) ?? d.shots[0];
      // (a shot started part-way: what is left of it)
      const secs = Math.min(s.seconds, shot === 'beach' ? 25 : s.seconds), tick = [], gaps = [], gpu = [], sea = [];
      let last = performance.now(), n = 0;
      const off = w.on('frame', () => {
        const t = performance.now(), p = w.frameProfile(); n++;
        if (n > 2) { gaps.push(t - last); tick.push(p.tickMs + p.submitMs); if (p.gpuMs !== null) gpu.push(p.gpuMs); }
        last = t;
      });
      const t0 = performance.now();
      while (performance.now() - t0 < secs * 1000) { await new Promise((ok) => setTimeout(ok, 500)); const tel = w.telemetry(); const e = tel.elements.find((x) => x.id === 'sea'); if (e) sea.push(e.ms); }
      off();
      const q = (a, k) => { const b = [...a].sort((x, y) => x - y); return b.length ? +b[Math.min(b.length - 1, Math.floor(b.length * k))].toFixed(2) : null; };
      const tel = w.telemetry(), seaEl = w.list.find((l) => l.id === 'sea');
      return { frames: gaps.length, fps: +(gaps.length / ((performance.now() - t0) / 1000)).toFixed(1), frameP50: q(gaps, 0.5), frameP95: q(gaps, 0.95), over33: +((100 * gaps.filter((g) => g > 33.4).length) / Math.max(1, gaps.length)).toFixed(1), mainP50: q(tick, 0.5), mainP95: q(tick, 0.95), gpuP50: q(gpu, 0.5), seaMs: q(sea, 0.5), quality: tel.quality.now, displaced: seaEl ? +(seaEl.share ?? 0).toFixed(2) : null, dropped: tel.dropped, draws: tel.draws, triangles: tel.triangles, memoryMB: tel.memoryMB, level: w.level };
    }, shot);
    rows.push({ api, cpu, shot, ...r, errors: errors.slice(0, 3) });
    console.log(`${api} cpu ×${cpu} ${shot.padEnd(9)} ${r.fps} fps · frame p50 ${r.frameP50} p95 ${r.frameP95} ms (${r.over33} % over 33) · main thread p50 ${r.mainP50} p95 ${r.mainP95} ms · chip ${r.gpuP50 ?? '—'} ms · sea ${r.seaMs} ms · ${r.quality}${r.displaced ? ' displaced' : ' flat'} · ${r.draws} draws ${r.triangles} triangles ${r.memoryMB} MB${r.dropped.length ? ` · dropped ${r.dropped.join(',')}` : ''}`);
  } catch (e) { rows.push({ api, cpu, shot, error: e.message }); console.log(`FAIL ${api} cpu ×${cpu} ${shot}: ${e.message.split('\n')[0]}`); }
  await page.close();
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(rows, null, 1));
await browser.close(); srv.close();
