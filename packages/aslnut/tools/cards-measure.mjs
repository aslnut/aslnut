// The cards measured at one realistic setting (kits › dashboard › markers): the fleet example's cards bench
// (?go=parity&n=500&bench=cards: 400 cards on still places round the view, 100 on moving vehicles, collision on) on a
// phone's page (390 × 844 CSS px, pixel ratio 2), on WebGPU AND WebGL2, the clock playing at 4×:
//   fps        frames drawn a second while the camera turns slowly for 5 s (every display frame asked for)
//   cards ms   the main thread's ms a frame inside the card sets' own frame (their uniforms, their passes handed over),
//              the median and the most, and the world's whole CPU ms a frame (median)
//   seek       a jump of 10 minutes: the uploads and bytes of the next frame (a scrub is the clock's one write: the
//              cards' block, the set's block, nothing else)
//   rest       paused and still: frames drawn in 3 s once settled (0: nothing changes while still)
//   node tools/cards-measure.mjs [webgpu,webgl2]   (EXAMPLES_KEEP_BUILD=1 npx vite build first) → .out/cards-measure/
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 8494), OUT = join(import.meta.dirname, '..', '.out', 'cards-measure');
mkdirSync(OUT, { recursive: true });
const APIS = (process.argv[2] ?? 'webgpu,webgl2').split(',');
const srv = await serve(PORT), browser = await launch();
const rows = [];
for (const api of APIS) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/examples/fleet/?go=parity&n=500&bench=cards&graphics=${api}&dpr=2&log=0&panel=0&t=20&speed=4`);
    await page.waitForFunction(() => window.aslnutDemo?.bench, null, { timeout: 120000 });
    const r = await page.evaluate(async () => {
      const { w, play, bench } = window.aslnutDemo, g = w.graphics, sets = [bench.still, bench.moving];
      await w.settled({ timeout: 120000 });
      // at rest: paused and settled, 3 s (nothing changes while still: no frame drawn)
      play.pause(); await w.settled({ timeout: 30000 }); await new Promise((ok) => setTimeout(ok, 800));
      const f0 = w.report().frames; await new Promise((ok) => setTimeout(ok, 3000)); const rest = w.report().frames - f0;
      // a seek: the next frame's uploads
      play.seek(w.time.getTime() + 600e3); await new Promise((ok) => w.once('frame', ok));
      const seek = { uploads: g.stats.uploads, bytes: g.stats.uploadBytes };
      await w.settled({ timeout: 30000 });
      // the card sets' own frame, timed (the same call, a clock round it)
      const ms = []; let cur = 0;
      for (const c of sets) { const f = c.frame.bind(c); c.frame = (ctx) => { const t0 = performance.now(); try { return f(ctx); } finally { cur += performance.now() - t0; } }; }
      const cpu = [];
      const off = w.on('frame', () => { ms.push(cur); cur = 0; cpu.push(w.telemetry().cpuMs); });
      // playing at 4×, the camera turning slowly (every display frame drawn) for 5 s
      play.play();
      const v = w.camera, n0 = w.report().frames, t0 = performance.now();
      await w.fly({ lon: v.lon, lat: v.lat, zoom: v.zoom, tilt: 40, bearing: (v.pose.bearing + 25) % 360 }, { seconds: 5 });
      const fps = (w.report().frames - n0) / ((performance.now() - t0) / 1000);
      off();
      const q = (a, k) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))] : 0; };
      return { api: w.api, cards: sets.reduce((a, c) => a + c.readouts().cards(), 0), moving: bench.movers.readouts().things(), fps: +fps.toFixed(1), frames: ms.length, cardsMs: { median: +q(ms, 0.5).toFixed(3), p95: +q(ms, 0.95).toFixed(3), most: +Math.max(...ms).toFixed(3) }, cpuMs: +q(cpu, 0.5).toFixed(2), seek, rest, gpuMs: g.stats.gpuMs };
    });
    r.errors = errors.slice(0, 4);
    rows.push(r);
    console.log(JSON.stringify(r));
  } catch (e) { console.log(`FAIL ${api}: ${String(e).slice(0, 300)}`); rows.push({ api, error: String(e).slice(0, 300) }); }
  await ctx.close();
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(rows, null, 1));
await browser.close(); srv.close();
