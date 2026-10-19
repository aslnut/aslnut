// The street's frontage, on WebGPU and WebGL2: walk mode at a few spots on residential streets (Rose Street, Clayton,
// where a long dark block stood at the verge; and the worst frontages the bake reports), each frame with what stands
// along the street picked across it (kind, id, the hit's distance from the camera), and an overview over the street.
//   node tools/frontage.mjs [out dir]   (PHASE=before|after names the frames; APIS=webgpu; SPOTS=rose,…; PROBE=1 picks
//   only; SERVE=…/serve.mjs serves another data folder, ASLNUT_DIST other built examples; run `npm run examples`
//   first)
const { serve } = await import(process.env.SERVE ?? './serve.mjs');
import { launch, openDemo, bytesOf } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = process.argv[2] ?? join(import.meta.dirname, '..', '.out', 'frontage'), PHASE = process.env.PHASE ?? 'after', PORT = Number(process.env.PORT ?? 8761);
// [lon, lat, bearing°]: where the person you walk as stands and looks
const ALL = {
  rose: [145.12290, -37.92270, 277],
  // the longest frontages of the street level before (houses by their label: a 71 m, a 55 m and a 45 m front)
  'long-71': [145.144323, -37.907034, 188],
  'long-55': [145.100888, -37.926252, 99],
  'long-45': [145.123386, -37.928088, 99],
  ...JSON.parse(process.env.EXTRA ?? '{}'),
};
const SPOTS = (process.env.SPOTS ?? Object.keys(ALL).join(',')).split(',').filter((k) => ALL[k]);
mkdirSync(OUT, { recursive: true });
const srv = await serve(PORT), browser = await launch(), report = {};
const base = `http://127.0.0.1:${PORT}/examples/healthy-city/`, q0 = '&quality=realistic&dpr=1&clock=30&log=0';
const W = 800, H = 628;
// the frame once the world has settled (not strict: the following camera keeps a tile or two in the making)
const frameOf = (page) => page.evaluate(async () => {
  const { w } = window.aslnutDemo;
  try { await w.settled({ timeout: 240000 }); } catch { /* as it is */ }
  const f = await w.frame();
  let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768));
  return { width: f.width, height: f.height, b64: btoa(bin) };
});
async function shot(page, name, api) { const r = await frameOf(page); const f = `${PHASE}-${name}-${api}.png`; writeFileSync(join(OUT, f), png(r.width, r.height, bytesOf(r))); return f; }
for (const api of (process.env.APIS ?? 'webgpu,webgl2').split(',')) {
  const rows = (report[api] = {});
  const { page, errors } = await openDemo(browser, `${base}?go=walk&graphics=${api}${q0}`, { width: W, height: H });
  try {
    await page.waitForFunction(() => window.aslnutDemo?.av?.mode === 'walk', null, { timeout: 300000 });
    for (const k of SPOTS) {
      const [lon, lat, bearing] = ALL[k];
      await page.evaluate(async ([lon, lat, bearing]) => {
        const { w, av } = window.aslnutDemo, D = Math.PI / 180, me = av.me;
        me.at = [lon, lat, NaN]; me.heading = bearing; me.velocity = [0, 0, 0]; me.speed = 0; av.element.look = bearing * D;
        for (let i = 0; i < 30; i++) { w.step(50); if (i % 10 === 9) await w.frame(); }
        try { await w.settled({ timeout: 120000 }); } catch { /* the frame waits again */ }
      }, [lon, lat, bearing]);
      const f = process.env.PROBE ? null : await shot(page, k, api);
      // what stands along the street: picked on rows across the frame
      const picks = await page.evaluate(async ([W, H]) => {
        const { w } = window.aslnutDemo, out = [];
        for (const fy of [0.3, 0.4, 0.5]) for (let fx = 0.05; fx < 1; fx += 0.1) {
          const p = await w.pick(W * fx, H * fy, { radius: 0 }); if (!p) continue;
          out.push({ fx: +fx.toFixed(2), fy, layer: p.element, id: String(p.id), props: p.props, at: p.at?.map((v) => +v.toFixed(6)) });
        }
        return out;
      }, [W, H]);
      rows[k] = { frame: f, picks };
      const seen = new Map(); for (const p of picks) seen.set(`${p.element}:${p.id}`, p);
      console.log(`${api} ${k}: ${f ?? '(probe)'} · ${[...seen.values()].map((p) => `${p.element}/${p.id} ${JSON.stringify(p.props)}`).join(' | ')}`);
    }
    if (!process.env.PROBE && !process.env.SPOTS) {
      // the overview: over the street, looking along it
      await page.evaluate(async () => { const { w, av } = window.aslnutDemo; av.setMode('map'); await new Promise((r) => setTimeout(r, 1500)); w.go({ lon: 145.1236, lat: -37.9231, zoom: 18.6, tilt: 62, bearing: 100 }); try { await w.settled({ timeout: 120000 }); } catch { /* the frame waits again */ } });
      rows.overview = { frame: await shot(page, 'overview', api) };
      console.log(`${api} overview: ${rows.overview.frame}`);
    }
    console.log(`${api} errors: ${errors.length ? errors.slice(0, 3).join(' | ') : 'none'}`);
  } catch (e) { console.log(`${api}: FAIL ${e.message.slice(0, 400)}`); }
  await page.close();
}
writeFileSync(join(OUT, `${PHASE}${process.env.SPOTS ? `-${SPOTS.join('-')}` : ''}${process.env.PROBE ? '-probe' : ''}.json`), JSON.stringify(report, null, 1));
await browser.close(); srv.close();
