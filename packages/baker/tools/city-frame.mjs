// The healthy-city example on a street pack (old or new), unchanged: the browser's requests for the street pack are
// answered from the pack under test. One WebGL2 frame each, and what the page logged about its walking graph.
//   node packages/baker/tools/city-frame.mjs <old street pack> <new street pack> <out dir> [query]
import { serve } from '../../aslnut/tools/serve.mjs';
import { launch } from '../../aslnut/tools/browser.mjs';
import { png } from '../../aslnut/tools/png.mjs';
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [OLD, NEW, OUT, QUERY = 'graphics=webgl2&dpr=1'] = process.argv.slice(2);
mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.PORT ?? 8393);
const srv = await serve(PORT);
const browser = await launch();
for (const [which, dir] of [['old', OLD], ['new', NEW]]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 1 });
  const logs = [], errors = [];
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error') errors.push(t.slice(0, 200)); else if (/walk/.test(t)) logs.push(t.slice(0, 200)); });
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 200)));
  await page.route('**/aslnut/data/packs/roads/street/**', async (route) => {
    const rel = decodeURIComponent(new URL(route.request().url()).pathname).split('/packs/roads/street/')[1];
    const f = join(dir, rel);
    if (!existsSync(f)) return route.fulfill({ status: 404, body: '' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: readFileSync(f) });
  });
  const t0 = Date.now();
  try {
    await page.goto(`http://127.0.0.1:${PORT}/examples/healthy-city/?${QUERY}`);
    await page.waitForFunction(() => window.aslnutDemo?.w ?? window.aslnut?.w ?? document.querySelector('canvas'), null, { timeout: 90000 });
    await page.waitForTimeout(45000);
    const file = join(OUT, `healthy-city-${which}-webgl2.png`);
    await page.screenshot({ path: file });
    console.log(`${which}: ${Date.now() - t0} ms · errors ${errors.length}${errors.length ? ': ' + errors[0] : ''} · ${logs.slice(0, 2).join(' | ')}`);
  } catch (e) { console.log(`${which}: FAIL ${e.message.slice(0, 200)}`); }
  await page.close();
}
await browser.close(); srv.close();
