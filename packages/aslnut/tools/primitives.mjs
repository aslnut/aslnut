// The primitives check: every visual a city twin's five screens need (and the tree's wire-sphere hover) and a
// low-level 3D checklist, built with the public API only (examples/primitives), on WebGPU and WebGL2.
// Each scene settles with no errors and draws something; the wire scene shows the net when a tree is hovered (and
// takes it away when the pointer leaves); the three scene draws every one of its layers.
//   node tools/primitives.mjs   (run `npm run examples` first; ASLNUT_DIST for another build) · evidence in .out/primitives/
import { serve } from './serve.mjs';
import { launch, bytesOf } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PRIM_PORT ?? 8178), OUT = join(import.meta.dirname, '..', '.out', 'primitives');
mkdirSync(OUT, { recursive: true });
const SCENES = (process.env.ONLY ?? 'region,studio,heatlab,clayton,access,wire,three,extend').split(',');
const srv = await serve(PORT), browser = await launch();
const results = [];
const check = (api, name, ok, detail = '') => { results.push({ api, name, ok, detail }); console.log(`${ok ? 'ok  ' : 'FAIL'} ${api} ${name}${detail ? ` · ${detail}` : ''}`); };
const frameOf = (page) => page.evaluate(async () => { const { w } = window.aslnutDemo; await w.settled({ timeout: 90000 }).catch(() => {}); const f = await w.frame(); let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768)); return { b64: btoa(bin), w: f.width, h: f.height }; });
/** how many pixels differ from the most common colour (the background): something was drawn */
const drawnPx = (px) => { const n = new Map(); for (let i = 0; i < px.length; i += 4) { const k = (px[i] >> 3) << 10 | (px[i + 1] >> 3) << 5 | px[i + 2] >> 3; n.set(k, (n.get(k) ?? 0) + 1); } return px.length / 4 - Math.max(...n.values()); };
for (const api of ['webgpu', 'webgl2']) for (const go of SCENES) {
  const page = await browser.newPage({ viewport: { width: 480, height: 640 } }); const errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/examples/primitives/?go=${go}&graphics=${api}&dpr=1&clock=30`);
    await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 60000 });
    await page.evaluate(() => { const { w } = window.aslnutDemo; window.__errs = []; w.on('error', (e) => window.__errs.push(String(e?.message ?? e).slice(0, 300))); });
    const f = await frameOf(page), px = bytesOf(f);
    writeFileSync(join(OUT, `${go}-${api}.png`), png(f.w, f.h, px));
    const st = await page.evaluate(() => { const { w } = window.aslnutDemo; return { settled: w.report().settled, failed: w.report().failed.slice(0, 2), errs: window.__errs, layers: w.stats().elements.map((l) => l.id), api: w.api }; });
    check(api, `${go}: settles, draws, no errors`, st.settled && st.api === api && !st.failed.length && !st.errs.length && drawnPx(px) > 2000, JSON.stringify({ drawn: drawnPx(px), ...st }).slice(0, 400));
    if (go === 'wire') {
      // hover a tree: the forms layer shows its net; away: gone
      const at = await page.evaluate(() => { const { w, extra } = window.aslnutDemo; const t = extra.trees[2]; return w.project(t); });
      const box = await page.locator('canvas').first().boundingBox();
      await page.mouse.move(box.x + at[0], box.y + at[1]); await page.waitForTimeout(600);
      const on = await page.evaluate(async () => { const { w } = window.aslnutDemo; await w.settled({ timeout: 30000 }).catch(() => {}); const l = w.list.find((x) => x.id === 'forms'); return { hover: w.user.hover, forms: l ? l.counts().instances : 0 }; });
      const g = await frameOf(page), gx = bytesOf(g);
      writeFileSync(join(OUT, `wire-hover-${api}.png`), png(g.w, g.h, gx));
      let diff = 0; for (let i = 0; i < gx.length; i += 4) if (Math.abs(gx[i] - px[i]) + Math.abs(gx[i + 1] - px[i + 1]) + Math.abs(gx[i + 2] - px[i + 2]) > 30) diff++;
      await page.mouse.move(box.x + 5, box.y + box.height - 5); await page.waitForTimeout(600);
      const off = await page.evaluate(async () => { const { w } = window.aslnutDemo; await w.settled({ timeout: 30000 }).catch(() => {}); const l = w.list.find((x) => x.id === 'forms'); return { hover: w.user.hover, forms: l ? l.counts().instances : 0 }; });
      check(api, 'wire: hovering a tree shows the wire net round its crown, leaving takes it away', on.forms === 1 && diff > 200 && off.forms === 0, JSON.stringify({ on, off, diff }));
    }
    if (go === 'three') {
      const ids = ['cubes', 'grid', 'spiral', 'blend-alpha', 'blend-add', 'blend-multiply', 'on-top', 'kit'];
      const got = await page.evaluate((ids) => { const { w } = window.aslnutDemo; return ids.filter((id) => w.list.some((l) => l.id === id && l.shown > 0)); }, ids);
      check(api, 'three: your geometry (textured, lit, instanced), lines, points, three blends, no depth test, a shape in every material', got.length === ids.length, JSON.stringify(got));
    }
    check(api, `no page errors (${go})`, errors.filter((e) => !/GPU stall/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, go, false, e.message.slice(0, 300)); }
  await page.close();
}
await browser.close(); srv.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${failed ? 'FAIL' : 'ok  '} primitives: ${results.length - failed}/${results.length} checks passed on WebGPU and WebGL2`);
process.exit(failed ? 1 : 0);
