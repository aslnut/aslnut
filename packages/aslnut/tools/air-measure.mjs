// What things in the air cost a frame: the fleet example's drones (go=drones: N of aslnut's quadcopters flying their
// loops over the suburb) on a phone's view (390 × 844 at dpr 2), on WebGL2 (this machine's chip) and WebGPU, in the air
// (&air=1: each sample's height from the log, banked into their turns, their shadows on the ground under them fading
// with height) and the same drones on the ground (&air=0). Per case, while it plays at 4× for 5 s: frames drawn, the
// main thread's busy ms a frame (the browser's TaskDuration), the set's own ms a frame, the chip's ms a frame (its timer,
// where the graphics has one), the shapes near; the bytes the set holds on the chip; a picture of the last frame.
// scene=cars: the fleet's own cars on a plain ground (go=parity) instead: what a set with no altitude costs (one build
// against another: nothing of the air's is paid when not set).
//   node tools/air-measure.mjs [n=10000] [air=0,1] [graphics=webgl2,webgpu] [tag=after] [scene=drones|cars]
//   (EXAMPLES_KEEP_BUILD=1 npx vite build first; ASLNUT_DIST=… measures another build: the "before") →
//   .out/air-measure/<tag>.json
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [nArg = '10000', airArg = '0,1', apiArg = 'webgl2,webgpu', TAG = 'after', SCENE = 'drones'] = process.argv.slice(2);
const PORT = Number(process.env.PORT ?? 8553), OUT = join(import.meta.dirname, '..', '.out', 'air-measure');
mkdirSync(OUT, { recursive: true });
const r2 = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
const med = (a) => { const s = a.filter((x) => typeof x === 'number').sort((x, y) => x - y); return s.length ? s[s.length >> 1] : null; };
const srv = await serve(PORT), browser = await launch();
const rows = [];
for (const api of apiArg.split(',')) for (const n of nArg.split(',')) for (const air of airArg.split(',')) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const name = `${TAG}-${SCENE}-${api}-${n}-air${air}`;
  try {
    await page.goto(`http://127.0.0.1:${PORT}/examples/fleet/?go=${SCENE === 'cars' ? 'parity' : 'drones'}&n=${n}&air=${air}&graphics=${api}&log=0&panel=0&speed=4&trail=12`);
    await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 120000 });
    const cdp = await ctx.newCDPSession(page);
    await cdp.send('Performance.enable');
    const busy = async () => ((await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0) * 1000;
    await page.evaluate(async () => { const { w } = window.aslnutDemo; await w.settled({ timeout: 180000 }); });
    const info0 = await page.evaluate(() => { const { w, fleet } = window.aslnutDemo; const mine = w.graphics.memory().filter((m) => m.label.startsWith('fleet ')).reduce((s, m) => s + m.bytes, 0); return { api: w.api, renderer: w.stats().device, fleetGpuMB: mine / 1048576, logMB: fleet.log.bytes / 1048576, counts: fleet.counts() }; });
    const b0 = await busy();
    const play = await page.evaluate(async () => {
      const { w, play } = window.aslnutDemo, f0 = w.renderer.frames, layer = [], gpu = [], near = [];
      const off = w.on('frame', () => { const l = w.telemetry().elements.find((x) => x.id === 'fleet'); if (l) layer.push(l.ms); gpu.push(w.frameProfile().gpuMs); near.push(window.aslnutDemo.fleet.counts().shapes); });
      play.setSpeed(4); play.play(); await new Promise((ok) => setTimeout(ok, 5000)); play.pause(); off();
      return { frames: w.renderer.frames - f0, layer, gpu, near };
    });
    const b1 = await busy();
    await page.evaluate(() => window.aslnutDemo.w.settled({ timeout: 60000 }));
    const f = await page.evaluate(async () => { const fr = await window.aslnutDemo.w.frame(); let b = ''; for (let i = 0; i < fr.pixels.length; i += 32768) b += String.fromCharCode(...fr.pixels.subarray(i, i + 32768)); return { width: fr.width, height: fr.height, b64: btoa(b) }; });
    writeFileSync(join(OUT, `${name}.png`), png(f.width, f.height, new Uint8Array(Buffer.from(f.b64, 'base64'))));
    const row = {
      case: name, scene: SCENE, api: info0.api, renderer: info0.renderer, n: Number(n), air: Number(air), frames: play.frames,
      busyPerFrameMs: r2((b1 - b0) / Math.max(1, play.frames)), layerP50Ms: r2(med(play.layer)), gpuP50Ms: r2(med(play.gpu)), nearP50: med(play.near),
      fleetGpuMB: r2(info0.fleetGpuMB), logMB: r2(info0.logMB), samples: info0.counts.samples, errors: errors.slice(0, 3),
    };
    rows.push(row); console.log(JSON.stringify(row));
  } catch (e) { console.log(`FAIL ${name}: ${e.message.slice(0, 300)}`); rows.push({ case: name, error: e.message }); }
  await ctx.close();
}
writeFileSync(join(OUT, `${TAG}.json`), JSON.stringify(rows, null, 1));
await browser.close(); srv.close();
