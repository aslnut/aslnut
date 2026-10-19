// The analysis view's frames (core › render › style › theme) and the solids' selected colour, on the healthy-city
// example: the street level as it is, dark, grey and light; park access coloured on a grey world; the region's
// statistic on a grey world; a selected building and a selected road (in the twin interface, and under the dark
// theme: the selection is a subject). Each on a phone (390 × 844) and a desktop (1280 × 800), on WebGPU and WebGL2.
// A summer afternoon (15:00 on the place's clocks). Run `EXAMPLES_KEEP_BUILD=1 npm run examples` first.
//   node tools/theme-shots.mjs [only,names]      → .out/theme/<name>-<phone|desktop>-<webgpu|webgl2>.png, frames.json
//   SIZES=phone APIS=webgl2 node tools/theme-shots.mjs dark,grey      (only these; frames-<names>.json)
import { serve } from './serve.mjs';
import { launch, openDemo } from './browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', '.out', 'theme'), PORT = Number(process.env.PORT ?? 8761);
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
  // (a busy machine: SwiftShader's WebGPU page takes its time to give a screenshot)
  await page.screenshot({ path, timeout: 240000 });
  await page.evaluate(() => document.getElementById('shot-frame')?.remove());
}
/** the world settled (what loads now), or as far as it got */
const settle = (page, ms = 150000) => page.evaluate((ms) => window.aslnutDemo.w.settled({ timeout: ms }).catch(() => false), ms);
/** park access has its numbers (the arcs are in) */
const accessIn = (page) => page.waitForFunction(() => !!document.querySelector('#access table'), null, { timeout: 180000 });
/** a thing of a layer (and a kind) picked near the middle of the view, tapped as a person would (its card, its
 *  selection), then the camera closer over it (`zoom`): the first of a ring of points round the middle that finds one */
const tapOn = (layer, kinds, zoom = 19.4) => async (page) => {
  const s = page.viewportSize();
  const at = await page.evaluate(async ({ layer, kinds, W, H }) => {
    const { w } = window.aslnutDemo;
    for (let r = 0; r < 7; r++) for (let a = 0; a < Math.max(1, r * 6); a++) {
      const x = W * 0.5 + Math.cos((a / Math.max(1, r * 6)) * 2 * Math.PI) * r * W * 0.06, y = H * 0.58 + Math.sin((a / Math.max(1, r * 6)) * 2 * Math.PI) * r * H * 0.04;
      const f = await w.pick(x, y, { radius: 1 });
      if (f && f.element === layer && (!kinds || kinds.includes(f.d?.kind))) return { x, y, id: f.id, kind: f.d?.kind, at: f.at };
    }
    return null;
  }, { layer, kinds, W: s.width, H: s.height });
  if (!at) throw new Error(`nothing of '${layer}'${kinds ? ` (${kinds.join(', ')})` : ''} near the middle`);
  // (the tap picks first: its answer, and the selection, come a moment later; longer on a busy software WebGPU)
  await page.mouse.click(at.x, at.y);
  const ok = await page.waitForFunction(() => window.aslnutDemo.w.user.selection.length > 0, null, { timeout: 120000 }).then(() => true, () => false);
  if (!ok) throw new Error(`tapped ${at.kind} ${at.id}: nothing selected`);
  // closer, the selected thing a little above the middle (the card covers the bottom on a phone)
  await page.evaluate(({ at, zoom }) => { const { w } = window.aslnutDemo, c = w.camera.view; w.go({ lon: at[0], lat: at[1] - 0.00012, zoom, tilt: 55, bearing: c.bearing }); }, { at: at.at, zoom });
  await settle(page, 60000); await sleep(800);
  return `${at.kind} ${at.id}`;
};
const SHOTS = [
  { name: 'plain', go: 'street' },
  { name: 'dark', go: 'street', theme: 'dark' },
  { name: 'grey', go: 'street', theme: 'grey' },
  { name: 'light', go: 'street', theme: 'light' },
  // data on a grey world: park access in its one colour scale (the houses, the arcs), the rest muted
  { name: 'access-grey', go: 'theme-grey', wait: accessIn },
  // the twin interface's analysis look, now the dark theme while park access is on
  { name: 'access-dark', go: 'twin', wait: accessIn },
  // the region's statistic (a subject) on a grey world
  { name: 'region-grey', go: 'region', theme: 'grey' },
  // the walk to a park (routes and the 400 / 800 m bands) on a grey world, the marks on the ground drawn into its tiles
  // (a phone's way): the subjects' marks in colour, the theme's muting in the tiles' look
  { name: 'access-roads-grey-tiles', go: 'access', theme: 'grey', q: '&ground=tiles', wait: accessIn },
  // a tap selects: the building, the road in the selected colour (blue)
  { name: 'selected-building', go: 'street', ui: 'twin', act: tapOn('streets', ['building']) },
  { name: 'selected-road', go: 'street', ui: 'twin', act: tapOn('roads', ['road'], 19) },
  // the selection is a theme's subject: it keeps its blue on the dark world
  { name: 'selected-building-dark', go: 'street', ui: 'twin', theme: 'dark', act: tapOn('streets', ['building']) },
];

const srv = await serve(PORT), browser = await launch();
const list = [];
for (const shot of SHOTS.filter((x) => !ONLY || ONLY.includes(x.name))) {
  for (const size of (process.env.SIZES ?? 'phone,desktop').split(',')) {
    for (const api of (process.env.APIS ?? 'webgpu,webgl2').split(',')) {
      const [width, height] = SIZES[size];
      const url = `http://127.0.0.1:${PORT}/examples/healthy-city/?go=${shot.go}&graphics=${api}&quality=realistic&dpr=1&log=0&t=${shot.t ?? '2026-01-15T15:00'}${shot.ui ? `&ui=${shot.ui}` : ''}${shot.theme ? `&theme=${shot.theme}` : ''}${shot.q ?? ''}`;
      const name = `${shot.name}-${size}-${api}`;
      const t0 = Date.now();
      let page, errors = [];
      try {
        ({ page, errors } = await openDemo(browser, url, { width, height }));
        await settle(page);
        if (shot.wait) await shot.wait(page);
        await sleep(1500);
        const what = shot.act ? await shot.act(page) : null;
        await settle(page, 20000);
        await shoot(page, join(OUT, `${name}.png`));
        const info = await page.evaluate(() => { const w = window.aslnutDemo.w, s = w.stats(); return { api: s.api, draws: s.draws, gpuMB: Math.round(s.gpuBytes / 1048576), theme: w.theme?.name ?? null, muting: +(w.themeNow?.amount ?? 0).toFixed(3), selection: w.user.selection }; });
        list.push({ name, ok: true, s: Math.round((Date.now() - t0) / 1000), url, what, ...info, errors: errors.slice(0, 3) });
        console.log(`ok   ${name} · ${info.api} · ${info.draws} draws · ${info.gpuMB} MB · theme ${info.theme ?? 'none'} ${info.muting}${what ? ` · ${what}` : ''} · ${Math.round((Date.now() - t0) / 1000)} s${errors.length ? ` · errors: ${errors.slice(0, 2).join(' | ')}` : ''}`);
      } catch (e) {
        list.push({ name, ok: false, url, error: String(e.message).slice(0, 300), errors: errors.slice(0, 3) });
        console.log(`FAIL ${name} · ${String(e.message).slice(0, 300)}`);
      }
      await page?.close();
    }
  }
}
writeFileSync(join(OUT, ONLY ? `frames-${ONLY.join('-')}.json` : 'frames.json'), JSON.stringify(list, null, 1));
await browser.close(); srv.close();
