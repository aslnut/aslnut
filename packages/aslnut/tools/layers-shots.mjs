// The layers example's frames (examples/layers: a GIS map in the world): each case on a phone-sized view, on WebGPU
// and WebGL2, the world's own frame after it settles (no page over it). The map from above and tilted, on each base;
// with the twin (&twin=1), the places the layers sit side by side: the filled layers on the ground ('ground') or
// painted over everything ('over'), from above and tilted, close enough to see roofs and tree crowns.
//   node tools/layers-shots.mjs [case,case] [webgl2,webgpu] [390x844]     (run the examples' build first)
//   cases: map-top map-tilt map-osm map-imagery ground-top over-top ground-tilt over-tilt ground-close over-close (default all), or
//   name=query (your own: 'bike=go=street&only=bike')       out: .out/layers/<case>-<api>.png
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CASES = {
  'map-top': 'go=top', 'map-tilt': 'go=tilt', 'map-osm': 'go=map&base=osm', 'map-imagery': 'go=map&base=imagery',
  'ground-top': 'go=top&twin=1&areas=ground', 'over-top': 'go=top&twin=1&areas=over',
  'ground-tilt': 'go=tilt&twin=1&areas=ground', 'over-tilt': 'go=tilt&twin=1&areas=over',
  'ground-close': 'go=street&twin=1&areas=ground', 'over-close': 'go=street&twin=1&areas=over',
};
const [list = Object.keys(CASES).join(','), apis = 'webgl2,webgpu', size = '390x844'] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number), dpr = Number(process.env.DPR ?? 2);
const PORT = Number(process.env.PORT ?? 8761), OUT = join(import.meta.dirname, '..', '.out', 'layers');
mkdirSync(OUT, { recursive: true });
const srv = await serve(PORT), browser = await launch();
for (const c of list.split(',')) for (const api of apis.split(',')) {
  const [name, query] = c.includes('=') && !CASES[c] ? [c.slice(0, c.indexOf('=')), c.slice(c.indexOf('=') + 1)] : [c, CASES[c]];
  if (query === undefined) { console.log(`${c}: no such case`); continue; }
  const page = await browser.newPage({ viewport: { width, height } }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const t0 = Date.now();
  try {
    await page.goto(`http://127.0.0.1:${PORT}/examples/layers/?${query}&graphics=${api}&dpr=${dpr}&list=0`);
    await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 120000 });
    const r = await page.evaluate(async () => {
      const { w } = window.aslnutDemo, ok = await w.settled({ timeout: 120000 }).catch((e) => String(e.message));
      await new Promise((k) => setTimeout(k, 1500));
      const f = await w.frame({ attribution: true });
      let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768));
      const t = w.telemetry();
      return { ok, api: w.api, width: f.width, height: f.height, b64: btoa(bin), draws: t.draws, passes: w.frameProfile().passes, upper: w.standing };
    });
    writeFileSync(join(OUT, `${name}-${api}.png`), png(r.width, r.height, new Uint8Array(Buffer.from(r.b64, 'base64'))));
    console.log(`${name.padEnd(14)} ${r.api.padEnd(6)} settled ${String(r.ok).padEnd(5)} ${((Date.now() - t0) / 1000).toFixed(1)} s · ${r.draws} draws · ${r.passes} passes · solids ${r.upper}${errors.length ? ` · ERRORS ${errors.slice(0, 2).join(' | ').slice(0, 300)}` : ''}`);
  } catch (e) { console.log(`${name} ${api} FAIL ${String(e.message).slice(0, 300)}`); }
  await page.close();
}
await browser.close(); srv.close();
