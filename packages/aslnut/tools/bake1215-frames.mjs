// Evidence for the bake's stages 12–15: the same saved cameras before and after, on WebGPU and WebGL2, where houses or
// trees used to stand on roads and paths (close street level and oblique).
//   PHASE=before|after [WHAT=city,stages] [APIS=webgpu,webgl2] node tools/bake1215-frames.mjs
//   city: the healthy city's street level · stages: the stage demo (Clayton) at stage 12 (as the data came, with the
//   plots) and 15 (placed), the same cameras
import { serve } from './serve.mjs';
import { launch, settledFrame, bytesOf } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const out = join(import.meta.dirname, '../.out/bake1215'), phase = process.env.PHASE ?? 'after';
mkdirSync(out, { recursive: true });
export const VIEWS = {
  'houses-on-road': { lon: 145.12915, lat: -37.92300, zoom: 19.6, tilt: 58, bearing: 330 },
  'houses-on-road-street': { lon: 145.12925, lat: -37.92290, zoom: 20.4, tilt: 74, bearing: 300 },
  'trees-on-path': { lon: 145.11638, lat: -37.91505, zoom: 19.8, tilt: 62, bearing: 20 },
  'trees-street': { lon: 145.12799, lat: -37.92264, zoom: 20.4, tilt: 74, bearing: 90 },
  'setback': { lon: 145.11745, lat: -37.93481, zoom: 20, tilt: 55, bearing: 0 },
  'clip': { lon: 145.10979, lat: -37.91490, zoom: 19.6, tilt: 58, bearing: 0 },
  'oblique': { lon: 145.1225, lat: -37.9240, zoom: 18.3, tilt: 62, bearing: 330 },
};
const port = Number(process.env.PORT ?? 8520), srv = await serve(port), browser = await launch(), rows = [];
const what = (process.env.WHAT ?? 'city,stages').split(','), apis = (process.env.APIS ?? 'webgpu,webgl2').split(','), only = process.env.ONLY?.split(',');
const pages = [];
if (what.includes('city')) pages.push(['city', `/examples/healthy-city/?go=street`]);
if (what.includes('stages')) for (const s of ['12', '15']) pages.push([`stage${s}`, `/examples/roads/?go=roads&stage=${s}`]);
for (const api of apis) for (const [tag, path] of pages) {
  const page = await browser.newPage({ viewport: { width: 800, height: 500 } });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  try {
    await page.goto(`http://127.0.0.1:${port}${path}&graphics=${api}&dpr=1&clock=30&log=0`);
    await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 90000 });
    for (const [name, view] of Object.entries(VIEWS)) {
      if (only && !only.includes(name)) continue;
      await page.evaluate((v) => window.aslnutDemo.w.go(v), view);
      // (a camera still easing onto the ground after 4 minutes on SwiftShader: the frame taken holding it, and noted)
      let f, held = false;
      try { f = await settledFrame(page, 240000); }
      catch { held = true; f = await page.evaluate(async () => { const { w } = window.aslnutDemo; await w.settled({ strict: true, hold: true, timeout: 120000 }); const f = await w.frame(); let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768)); return { width: f.width, height: f.height, b64: btoa(bin), ms: 0 }; }); }
      const file = `${tag === 'city' ? phase + '-city' : tag}-${name}-${api}.png`;
      writeFileSync(join(out, file), png(f.width, f.height, bytesOf(f)));
      rows.push({ tag, phase, name, api, file, ms: Math.round(f.ms), held, errors: errors.length });
      console.log(file, Math.round(f.ms), 'ms');
    }
  } catch (e) { console.log(tag, api, 'FAILED', String(e).slice(0, 300)); rows.push({ tag, api, failed: String(e).slice(0, 300) }); }
  await page.close();
}
writeFileSync(join(out, `frames-${phase}-${what.join('-')}.json`), JSON.stringify(rows, null, 1));
await browser.close(); srv.close();
