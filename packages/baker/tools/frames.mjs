// Phone-size frames (390 x 844) of the roads example, old pack against new, on WebGPU and WebGL2. The example and
// aslnut are unchanged: the browser's requests for the place's pack are answered from the pack under test.
//   node packages/baker/tools/frames.mjs <place> <old pack dir> <new pack dir> <out dir> [view names…]
// (serve the built examples with ASLNUT_DIST; the data folder as the dataset)
import { serve } from '../../aslnut/tools/serve.mjs';
import { launch } from '../../aslnut/tools/browser.mjs';
import { png } from '../../aslnut/tools/png.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [place = 'clayton', OLD, NEW, OUT, ...only] = process.argv.slice(2);
const VIEWS = JSON.parse(readFileSync(join(import.meta.dirname, 'views.json'), 'utf8'))[place];
const GO = { clayton: 'roads', street: 'roads-street' }[place];
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT ?? 8191);
const srv = await serve(PORT);
const browser = await launch();
const names = only.length ? only : Object.keys(VIEWS);
const results = [];
for (const name of names) {
  const v = VIEWS[name];
  for (const api of (process.env.APIS ?? 'webgpu,webgl2').split(',')) {
    for (const [which, dir] of [['old', OLD], ['new', NEW]].filter(([w]) => (process.env.WHICH ?? 'old,new').split(',').includes(w))) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
      // the place's pack, from the pack under test
      await page.route(`**/aslnut/data/packs/roads/${place}/**`, async (route) => {
        const rel = decodeURIComponent(new URL(route.request().url()).pathname).split(`/packs/roads/${place}/`)[1];
        const f = join(dir, rel);
        if (!existsSync(f)) return route.fulfill({ status: 404, body: '' });
        return route.fulfill({ status: 200, contentType: f.endsWith('.json') ? 'application/json' : 'application/octet-stream', body: readFileSync(f) });
      });
      const view = JSON.stringify({ lon: v.lon, lat: v.lat, zoom: v.zoom, tilt: v.tilt, bearing: v.bearing });
      const url = `http://127.0.0.1:${PORT}/examples/roads/?go=${GO}&graphics=${api}&dpr=1&clock=30&view=${encodeURIComponent(view)}`;
      const t0 = Date.now();
      try {
        await page.goto(url);
        await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 90000 });
        // the canvas's own frame (WebGPU's canvas is not in a page screenshot)
        const r = await page.evaluate(async (settleMs) => {
          const { w } = window.aslnutDemo; await w.settled({ timeout: settleMs }).catch(() => {});
          const f = await w.frame(); let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768));
          return { api: w.api, settled: w.report().settled, w: f.width, h: f.height, b64: btoa(bin) };
        }, Number(process.env.SETTLE_MS ?? 300000));
        const file = join(OUT, `${place}-${name}-${which}-${api}.png`);
        writeFileSync(file, png(r.w, r.h, new Uint8Array(Buffer.from(r.b64, 'base64'))));
        delete r.b64;
        results.push({ name, api, which, file, ms: Date.now() - t0, ...r, errors: errors.slice(0, 3) });
        console.log(`${name} ${which} ${api}: ${r.api} settled ${r.settled} ${Date.now() - t0} ms${errors.length ? ' errors: ' + errors[0] : ''}`);
      } catch (e) { results.push({ name, api, which, error: e.message.slice(0, 200) }); console.log(`${name} ${which} ${api}: FAIL ${e.message.slice(0, 200)}`); }
      await page.close();
    }
  }
}
writeFileSync(join(OUT, `${place}-frames.json`), JSON.stringify(results, null, 1));
await browser.close(); srv.close();
