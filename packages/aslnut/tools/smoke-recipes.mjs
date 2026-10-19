// The authoring guide's recipes (examples/recipes, docs/authoring.md) on WebGPU AND WebGL2, with no network: every
// live service a recipe reads is answered by tools/recipes-mock.mjs (tiles, terrain, the OGC services of
// tools/ows-mock.mjs, the data files, a model) and anything else from outside is refused and named. Each recipe:
//   1. renders on the graphics asked for, settles, draws a frame neither black nor flat, fails no layer, makes no page
//      error and asks nothing from outside that is not mocked
//   2. has what its recipe says: its layers of each kind with their features in, its layer list and legend, its moving
//      things, its query recolouring the map, its own design's traits, its own thing's levels, joints and smoke…
//   node tools/smoke-recipes.mjs [names] [webgpu,webgl2]   (names: gis-view,district-twin,fleet,analysis,own-kind,own-thing, the
//   default; or trials/<name>: a script a model wrote, the generic checks and what it has)   PORT=8411 by default
//   (a test build first: EXAMPLES_KEEP_BUILD=1 npx vite build)
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';
import { route } from './recipes-mock.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const ALL = ['gis-view', 'district-twin', 'fleet', 'analysis', 'own-kind', 'own-thing'];
const names = (process.argv[2] && process.argv[2] !== 'all' ? process.argv[2].split(',') : ALL);
const apis = (process.argv[3] ?? 'webgpu,webgl2').split(','), PORT = Number(process.env.PORT ?? 8411);
const OUT = join(import.meta.dirname, '..', '.out', 'recipes');
mkdirSync(OUT, { recursive: true });
const local = `http://127.0.0.1:${PORT}/`;
const srv = await serve(PORT), browser = await launch();
let fail = 0;
const results = [];
const check = (name, api, what, ok, info) => { results.push({ name, api, what, ok, info }); if (!ok) fail++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${api.padEnd(6)} ${name.padEnd(14)} ${what}${info !== undefined ? ` · ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`); };

/** what each recipe has (in the page; w is its world): { ok, info } */
const FEATURES = {
  'gis-view': async (w) => {
    const kinds = Object.fromEntries(w.list.map((l) => [l.id, l.kind])), n = (id) => w.element(id).props.data?.size ?? 0;
    const pic = w.element('zones').picture, list = document.querySelector('.aslnut-layers'), lg = document.querySelector('.aslnut-legend');
    const geoms = {}; for (const id of ['suburbs', 'sites', 'creeks', 'pipelines', 'places', 'dams']) for (const f of w.element(id).props.data.features()) geoms[f.geometry.type] = (geoms[f.geometry.type] ?? 0) + 1;
    const rows = list ? list.querySelectorAll('[data-id]').length : 0, names = w.element('suburbs').labels;
    return { ok: pic?.asked >= 1 && ['Polygon', 'MultiPolygon', 'LineString', 'MultiLineString', 'MultiPoint', 'Point'].every((g) => geoms[g] > 0) && !!list && rows >= 7 && !!lg && /education|hospital/.test(lg.textContent) && !!names && n('suburbs') > 0,
      info: { kinds, geoms, wms: pic?.asked, listRows: rows, names: !!names, legend: lg?.textContent.slice(0, 60) } };
  },
  'district-twin': async (w) => {
    // the streets, buildings and trees in (their data's features), the sun up and lighting the world, its shadows drawn
    const sizes = Object.fromEntries(w.list.filter((l) => l.props.data?.size !== undefined).map((l) => [l.id, l.props.data.size]));
    const sh = w.shadowReport(), light = w.light;
    return { ok: Object.keys(sizes).length >= 3 && Object.values(sizes).every((n) => n > 0) && !!light && light.daylight > 0.5 && light.shadows && sh.on && sh.casters > 0 && w.level === 'building',
      info: { sizes, level: w.level, daylight: light && +light.daylight.toFixed(2), shadows: sh } };
  },
  fleet: async (w) => {
    const set = w.list.find((l) => typeof l.counts === 'function'), c = set?.counts();
    const a = await w.frame(); const t0 = w.time.getTime();
    w.setTime(new Date(t0 + 120e3), { rate: 0 }); await w.settled({ timeout: 60000 }); const b = await w.frame();
    let d = 0; for (let i = 0; i < a.pixels.length; i += 4) if (Math.abs(a.pixels[i] - b.pixels[i]) + Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) > 30) d++;
    return { ok: !!c && c.things >= 20 && c.trailPieces > 0 && !!set.props.gauge && d > 200, info: { counts: c, gauge: !!set?.props.gauge, moved: d } };
  },
  analysis: async (w) => {
    const params = w.params(), key = Object.keys(params)[0], lg = document.querySelector('.aslnut-legend');
    const area = w.list.find((l) => l.kind === 'area' && l.props.subject), joined = area ? [...area.props.data.features()].filter((f) => Number.isFinite(Number(f.props.rate))).length : 0;
    const a = await w.frame(); const p = params[key];
    const next = p?.options ? p.options.find((o) => o !== p.value) : p?.range ? (p.value === p.range[0] ? p.range[1] : p.range[0]) : null;
    if (key) w.set(key, next); await new Promise((ok) => setTimeout(ok, 600)); await w.settled({ timeout: 60000 });
    const b = await w.frame(); let d = 0; for (let i = 0; i < a.pixels.length; i += 4) if (Math.abs(a.pixels[i] - b.pixels[i]) + Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) + Math.abs(a.pixels[i + 2] - b.pixels[i + 2]) > 30) d++;
    const tip = typeof area?.props.tooltip === 'function';
    return { ok: !!w.theme && !!lg && joined >= 20 && tip && d > 1500, info: { theme: w.theme?.name, param: key, to: next, joined, recoloured: d, legend: lg?.textContent.slice(0, 50) } };
  },
  'own-kind': async (w) => {
    // the design on every plot and the model placed (its check passed: else the page threw), the traits read
    const shapes = w.list.filter((l) => l.kind === 'shape').map((l) => l.id), note = [...document.body.querySelectorAll('div')].map((d) => d.textContent).find((t) => /roof \d+ m²/.test(t ?? ''));
    return { ok: shapes.length >= 2 && !!note, info: { shapes, note } };
  },
  'own-thing': async (w) => {
    // the clones in (every one a record), three levels built, a joint driven, and the picture moving with the camera
    // still (the wheels turning and the smoke rising on the chip)
    const set = w.list.find((l) => l.props.joints), c = set?.counts(), made = set?.props.shape.make({}, 1);
    const levels = made ? made.levels.filter(Boolean).length : 0;
    const a = await w.frame(); await new Promise((ok) => setTimeout(ok, 1500)); const b = await w.frame();
    let d = 0; for (let i = 0; i < a.pixels.length; i += 4) if (Math.abs(a.pixels[i] - b.pixels[i]) + Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) + Math.abs(a.pixels[i + 2] - b.pixels[i + 2]) > 30) d++;
    return { ok: !!c && c.instances >= 200 && levels === 3 && d > 150, info: { counts: c, levels, joints: Object.keys(set?.props.joints ?? {}), moved: d } };
  },
};

for (const name of names) for (const api of apis) {
  const page = await browser.newPage({ viewport: { width: 480, height: 400 } }), errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const outside = await route(page, local);
  const t0 = Date.now();
  try {
    await page.goto(`${local}examples/recipes/?go=${name}&graphics=${api}&dpr=1&nav=0`);
    await page.waitForFunction(() => window.aslnutWorlds?.length > 0, null, { timeout: 90000 }).catch(() => {});
    const r = await page.evaluate(async () => {
      const w = window.aslnutWorlds?.[0]; if (!w) return null;
      const settled = await w.settled({ timeout: 240000 }).catch((e) => `threw: ${e.message}`);
      const f = await w.frame(), px = f.pixels; let lit = 0; const uniq = new Set();
      for (let i = 0; i < px.length; i += 4) { if (px[i] + px[i + 1] + px[i + 2] > 24) lit++; if (i % 400 === 0) uniq.add(px[i] * 65536 + px[i + 1] * 256 + px[i + 2]); }
      let bin = ''; for (let i = 0; i < px.length; i += 32768) bin += String.fromCharCode(...px.subarray(i, i + 32768));
      const rep = w.report();
      return { api: w.api, settled, pending: rep.pending.slice(0, 4), failed: rep.failed.slice(0, 4), lit: lit / (px.length / 4), colours: uniq.size, width: f.width, height: f.height, b64: btoa(bin), layers: w.list.map((l) => `${l.id}:${l.kind}`) };
    });
    if (!r) { check(name, api, 'a world was made', false, errors.slice(0, 3).join(' | ') || 'no world() call finished'); }
    else {
      writeFileSync(join(OUT, `${name.replace(/\//g, '-')}-${api}.png`), png(r.width, r.height, new Uint8Array(Buffer.from(r.b64, 'base64'))));
      check(name, api, 'renders on the graphics asked for', r.api === api, r.api);
      check(name, api, 'settles', r.settled === true, r.settled === true ? `${((Date.now() - t0) / 1000).toFixed(1)} s` : { settled: r.settled, pending: r.pending });
      check(name, api, 'a frame neither black nor flat', r.lit > 0.9 && r.colours > 40, `${(100 * r.lit).toFixed(1)} % lit · ${r.colours} colours`);
      check(name, api, 'no layer failed', !r.failed.length, r.failed);
      const feat = FEATURES[name];
      if (feat) {
        const f = await page.evaluate(`(${feat.toString()})(window.aslnutWorlds[0])`).catch((e) => ({ ok: false, info: e.message.slice(0, 300) }));
        check(name, api, 'has what its recipe says', f.ok, f.info);
      } else {
        // a script of a model's (trials/): what it has, for scoring it against its task
        const has = await page.evaluate(async () => {
          const w = window.aslnutWorlds[0], sh = w.shadowReport();
          // its own things: clones, levels built, joints driven, attachments, per-clone variety; the picture moving
          const things = w.list.filter((l) => l.props.shape && typeof l.counts === 'function' && !l.props.drive).map((l) => {
            let levels = 0; try { levels = l.props.shape.make({}, 1).levels.filter(Boolean).length; } catch { /* a made model */ }
            return { id: l.id, clones: l.counts().instances, levels, joints: Object.keys(l.props.joints ?? {}), attach: (l.props.attach ?? []).length,
              variety: ['tint', 'tints', 'stretch', 'scale', 'heading', 'variation'].filter((k) => l.props[k] !== undefined) };
          });
          // (close to one of its own things first: its moving parts and copies over time are drawn at the whole level)
          const own = w.list.find((l) => l.props.shape && !l.props.drive && (l.props.joints || l.props.attach));
          const feats = own ? (Array.isArray(own.props.data) ? own.props.data : own.props.data?.features?.() ?? []) : [], f = feats[1] ?? feats[0];
          const at = f && (own.props.at?.(f) ?? f.geometry?.coordinates);
          if (at) { w.go({ lon: at[0], lat: at[1], zoom: 20.5, tilt: 55, bearing: 0 }); await w.settled({ timeout: 60000 }); }
          const a = await w.frame(); await new Promise((ok) => setTimeout(ok, 1500)); const b = await w.frame();
          let moved = 0; for (let i = 0; i < a.pixels.length; i += 4) if (Math.abs(a.pixels[i] - b.pixels[i]) + Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) + Math.abs(a.pixels[i + 2] - b.pixels[i + 2]) > 30) moved++;
          return { level: w.level, things, moved, layers: w.list.map((l) => `${l.id}:${l.kind}${l.props.data?.size !== undefined ? `(${l.props.data.size})` : ''}${typeof l.counts === 'function' ? `(${JSON.stringify(l.counts())})` : ''}${l.props.labels ? ' +labels' : ''}${typeof l.props.tooltip === 'function' ? ' tip' : ''}${l.props.when !== undefined ? ' when' : ''}${l.props.subject ? ' subject' : ''}${l.props.label ? ` "${l.props.label}"` : ''}`),
            theme: w.theme?.name ?? null, params: Object.keys(w.params()), shadows: sh.on ? sh.casters : false, daylight: w.light ? +w.light.daylight.toFixed(2) : null,
            list: !!document.querySelector('.aslnut-layers'), legend: document.querySelector('.aslnut-legend')?.textContent.slice(0, 80) ?? null, buttons: [...document.querySelectorAll('button')].map((b) => b.textContent).slice(0, 8) };
        }).catch((e) => ({ error: e.message.slice(0, 200) }));
        check(name, api, 'what it has', true, has);
      }
    }
  } catch (e) { check(name, api, 'opens', false, e.message.slice(0, 300)); }
  check(name, api, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | ').slice(0, 400));
  check(name, api, 'nothing asked from outside unmocked', outside.length === 0, outside.slice(0, 3));
  await page.close();
}
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
await browser.close(); srv.close();
console.log(fail ? `${fail} FAILED` : 'all ok');
process.exit(fail ? 1 : 0);
