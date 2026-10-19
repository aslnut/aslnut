// The twin dashboard interface's frames (healthy-city ?ui=twin): each panel and effect on a phone (390 × 844) and on a
// desktop (1280 × 800), on WebGPU and WebGL2, the page as seen (the world with its panels over it). Run `npm run
// examples` first.
//   node tools/twin-shots.mjs [only,names]      → .out/twin-ui/<name>-<phone|desktop>-<webgpu|webgl2>.png
import { serve } from './serve.mjs';
import { launch, openDemo } from './browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', '.out', 'twin-ui'), PORT = Number(process.env.PORT ?? 8741);
mkdirSync(OUT, { recursive: true });
const ONLY = process.argv[2] ? process.argv[2].split(',') : null;
const SIZES = { phone: [390, 844], desktop: [1280, 800] };
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
/** the world's own frame (w.frame(): a WebGPU canvas is not in a headless page's screenshot) laid over the canvas, under
 *  the panels, then the page as seen */
async function shoot(page, path) {
  await page.evaluate(async () => {
    const { w } = window.aslnutDemo, f = await w.frame({ attribution: false }), c = document.createElement('canvas');
    c.width = f.width; c.height = f.height; c.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(f.pixels.buffer, f.pixels.byteOffset, f.pixels.length), f.width, f.height), 0, 0);
    let img = document.getElementById('shot-frame');
    if (!img) { img = document.createElement('img'); img.id = 'shot-frame'; Object.assign(img.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '0' }); document.getElementById('view').after(img); }
    await new Promise((ok) => { img.onload = ok; img.src = c.toDataURL('image/png'); });
  });
  await page.screenshot({ path });
  await page.evaluate(() => document.getElementById('shot-frame')?.remove());
}
const click = (sel) => async (page) => { await page.click(sel); await sleep(900); };
/** the world settled (what loads now), or as far as it got */
const settle = (page, ms = 150000) => page.evaluate((ms) => window.aslnutDemo.w.settled({ timeout: ms }).catch(() => false), ms);
/** park access has its numbers (the arcs are in) */
const accessIn = (page) => page.waitForFunction(() => !!document.querySelector('#access table'), null, { timeout: 180000 });
const SHOTS = [
  { name: 'plain-region', go: 'region', ui: 'plain', sizes: ['phone'] },
  { name: 'region', go: 'twin-region' },
  { name: 'tooltip', go: 'twin-region', sizes: ['desktop'], act: async (page) => { const s = page.viewportSize(); await page.mouse.move(s.width * 0.55, s.height * 0.52); await sleep(400); await page.mouse.move(s.width * 0.56, s.height * 0.53); await sleep(1200); } },
  { name: 'stats', go: 'twin-region', act: click('#b-stats') },
  { name: 'environment', go: 'twin-region', act: click('#env') },
  { name: 'layers', go: 'twin-region', act: click('#b-layers') },
  { name: 'council', go: 'council', ui: 'twin' },
  { name: 'arcs', go: 'twin', wait: accessIn },
  { name: 'arcs-flow', go: 'twin-flow', wait: accessIn, twice: true },
  { name: 'routes', go: 'access', ui: 'twin', wait: accessIn },
  { name: 'entity', go: 'street', ui: 'twin', act: async (page) => {
    // a tap on the first thing near the middle that the street level answers for (a building, a tree, a road)
    const s = page.viewportSize();
    for (const [fx, fy] of [[0.5, 0.55], [0.45, 0.6], [0.55, 0.62], [0.5, 0.7], [0.4, 0.5], [0.6, 0.5]]) {
      await page.mouse.click(s.width * fx, s.height * fy); await sleep(1200);
      if (await page.evaluate(() => getComputedStyle(document.getElementById('card')).display !== 'none')) return;
    }
  } },
  { name: 'walk', go: 'walk', ui: 'twin', act: async () => { await sleep(4000); } },
  { name: 'dusk', go: 'dusk', ui: 'twin' },
];

const srv = await serve(PORT), browser = await launch();
const list = [];
for (const shot of SHOTS.filter((x) => !ONLY || ONLY.includes(x.name))) {
  for (const size of shot.sizes ?? ['phone', 'desktop']) {
    for (const api of (process.env.APIS ?? 'webgpu,webgl2').split(',')) {
      const [width, height] = SIZES[size];
      const url = `http://127.0.0.1:${PORT}/examples/healthy-city/?go=${shot.go}&graphics=${api}&quality=realistic&dpr=1&log=0${shot.ui ? `&ui=${shot.ui}` : ''}`;
      const name = `${shot.name}-${size}-${api}`;
      const t0 = Date.now();
      let page, errors = [];
      try {
        ({ page, errors } = await openDemo(browser, url, { width, height }));
        await settle(page);
        if (shot.wait) await shot.wait(page);
        await sleep(1500);
        if (shot.act) await shot.act(page);
        await shoot(page, join(OUT, `${name}.png`));
        if (shot.twice) { await sleep(700); await shoot(page, join(OUT, `${name}-b.png`)); }
        const info = await page.evaluate(() => { const w = window.aslnutDemo.w, s = w.stats(); return { api: s.api, draws: s.draws, gpuMB: Math.round(s.gpuBytes / 1048576), access: document.querySelector('#access td.v')?.textContent ?? null }; });
        list.push({ name, ok: true, s: Math.round((Date.now() - t0) / 1000), ...info, errors: errors.slice(0, 3) });
        console.log(`ok   ${name} · ${info.api} · ${info.draws} draws · ${info.gpuMB} MB · ${Math.round((Date.now() - t0) / 1000)} s${errors.length ? ` · errors: ${errors.slice(0, 2).join(' | ')}` : ''}`);
      } catch (e) {
        list.push({ name, ok: false, error: String(e.message).slice(0, 300), errors: errors.slice(0, 3) });
        console.log(`FAIL ${name} · ${String(e.message).slice(0, 300)}`);
      }
      await page?.close();
    }
  }
}
writeFileSync(join(OUT, 'frames.json'), JSON.stringify(list, null, 1));
await browser.close(); srv.close();
