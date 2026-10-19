// The humans' frames: a preset of an example on WebGPU and WebGL2, saved as PNG (run `npm run examples` first).
//   node tools/humans-shots.mjs <example/preset> [out dir] [width height] [extra query]   (WAIT=<layer id>: wait for it)
import { serve } from './serve.mjs';
import { launch, openDemo, settledFrame, bytesOf } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [go = 'hello-earth/people', outArg, wArg, hArg, extra = ''] = process.argv.slice(2);
const OUT = outArg || join(import.meta.dirname, '..', '.out', 'humans'), W = Number(wArg ?? 640), H = Number(hArg ?? 480), PORT = Number(process.env.PORT ?? 8731);
mkdirSync(OUT, { recursive: true });
const srv = await serve(PORT), browser = await launch();
const [ex, g] = go.split('/');
for (const api of (process.env.APIS ?? 'webgpu,webgl2').split(',')) {
  const { page, errors } = await openDemo(browser, `http://127.0.0.1:${PORT}/examples/${ex}/?go=${g}&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0${extra}`, { width: W, height: H });
  try {
    // a layer the page adds later (WAIT=lineup): there before the frame is taken
    if (process.env.WAIT) await page.waitForFunction((id) => { try { return !!window.aslnutDemo.w.element(id); } catch { return false; } }, process.env.WAIT, { timeout: 120000 });
    const r = await settledFrame(page);
    const name = `${g}-${api}.png`; writeFileSync(join(OUT, name), png(r.width, r.height, bytesOf(r)));
    const info = await page.evaluate(() => { const w = window.aslnutDemo.w; const get = (id) => { try { return w.element(id)?.bodyCounts?.(); } catch { return undefined; } }; return Object.fromEntries(['people', 'crowd', 'avatar', 'lineup'].map((id) => [id, get(id)]).filter(([, v]) => v)); }).catch((e) => ({ err: String(e).slice(0, 200) }));
    console.log(`${api}: ${name} · ${r.ms.toFixed(0)} ms · ${JSON.stringify(info)} · errors: ${errors.length ? errors.slice(0, 3).join(' | ') : 'none'}`);
  } catch (e) { console.log(`${api}: FAIL ${e.message.slice(0, 400)} · errors: ${errors.slice(0, 3).join(' | ')}`); }
  await page.close();
}
await browser.close(); srv.close();
