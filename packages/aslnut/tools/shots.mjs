// Phone-size screenshots of example presets on both graphics (the page as a person sees it: panels, legends, the world
// after it settles), with the time to settle and any errors. Real network for presets that use it.
//   node tools/shots.mjs regions,fleet,flows [webgpu,webgl2] [390x844]   (run `npm run examples` first) · out in .out/shots/
//   EXAMPLE=healthy-city node tools/shots.mjs region,suburb        another example's presets
import { serve } from './serve.mjs';
import { launch, openDemo } from './browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [list = 'regions,fleet,flows', apis = 'webgpu,webgl2', size = '390x844', extra = ''] = process.argv.slice(2);
const [width, height] = size.split('x').map(Number);
const PORT = Number(process.env.PORT ?? 8096), OUT = join(import.meta.dirname, '..', '.out', 'shots'), EX = process.env.EXAMPLE ?? 'hello-earth';
mkdirSync(OUT, { recursive: true });
const srv = await serve(PORT), browser = await launch();
const rows = [];
for (const go of list.split(',')) for (const api of apis.split(',')) {
  const t0 = Date.now();
  const { page, errors } = await openDemo(browser, `http://127.0.0.1:${PORT}/examples/${EX}/?go=${go}&graphics=${api}&dpr=1${extra}`, { width, height });
  try {
    const r = await page.evaluate(async () => { const { w } = window.aslnutDemo; const ok = await w.settled({ timeout: 90000 }).catch((e) => String(e.message)); const s = w.stats(); return { ok, api: s.api, fps: Math.round(s.fps), layers: s.layers.map((l) => `${l.id}${l.shown >= 1 ? '' : l.shown > 0 ? '◐' : '○'}`).join(' ') }; });
    await new Promise((ok) => setTimeout(ok, 1200));
    // the headless browser does not composite a WebGPU canvas into screenshots: the world's own frame is laid over it
    await page.evaluate(async () => {
      const { w } = window.aslnutDemo, f = await w.frame(), c = document.createElement('canvas'), v = w.renderer.canvas, r = v.getBoundingClientRect();
      c.width = f.width; c.height = f.height; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(f.pixels), f.width, f.height), 0, 0);
      Object.assign(c.style, { position: 'fixed', left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, zIndex: '0', pointerEvents: 'none' }); v.after(c);
    });
    writeFileSync(join(OUT, `${EX === 'hello-earth' ? '' : `${EX}-`}${go}-${api}.png`), await page.screenshot());
    rows.push({ go, api: r.api, settled: r.ok, seconds: +((Date.now() - t0) / 1000).toFixed(1), fps: r.fps, errors: errors.slice(0, 3), layers: r.layers });
    console.log(`${go.padEnd(10)} ${String(r.api).padEnd(7)} settled ${String(r.ok).padEnd(5)} ${((Date.now() - t0) / 1000).toFixed(1)} s · ${r.fps} fps${errors.length ? ` · ERRORS ${errors.slice(0, 2).join(' | ').slice(0, 200)}` : ''}`);
  } catch (e) { rows.push({ go, api, error: e.message }); console.log(`${go} ${api} FAIL ${e.message.slice(0, 200)}`); }
  finally { await page.close(); }
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(rows, null, 1));
await browser.close(); srv.close();
