// The React example's smoke check (examples/react: <World> from aslnut/react), on WebGPU AND WebGL2 (a failure on
// either fails the run), at a phone's size, through its own buttons (the React app's state, as a person taps):
//   1. it draws on the graphics asked for, settles, no page errors; one world, one canvas
//   2. the colour button restyles the blocks in the world: the same element, its fill restyled, nothing built again
//      (no shapes built, no element added or removed, no world made), and the picture changes there
//      the same element out of the list and back in (w.remove, w.add of the same object): drawn again
//   3. a tap on a block opens the React panel with its name
//   4. the view button flies to the twin's view: the buildings added (one element), the vans moving (the clock runs)
//   5. (&dev=1, the dev server: React's development build, whose strict mode mounts, unmounts and mounts again) two
//      canvases asked for graphics, one left in the page, its world drawing; the first world disposed
//   node tools/smoke-react.mjs [webgpu,webgl2]     (run `EXAMPLES_KEEP_BUILD=1 npx vite build` first)
//   DEV=1 node tools/smoke-react.mjs              (also 5: starts `vite` on PORT + 1)
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';

const apis = (process.argv[2] ?? 'webgpu,webgl2').split(','), PORT = Number(process.env.PORT ?? 8591), DEV = process.env.DEV === '1';
const srv = await serve(PORT), browser = await launch();
let failed = 0;
const check = (api, name, ok, info) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${api.padEnd(6)} ${name}${info ? ` · ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`); };

/** a page with its errors heard, and the canvases graphics were asked of counted (before any script runs) */
async function open(url) {
  const page = await browser.newPage({ viewport: { width: 390, height: 760 }, deviceScaleFactor: 1 });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.route('**/favicon.ico', (r) => r.fulfill({ status: 204 }));
  await page.addInitScript(() => {
    const asked = new Set(), own = HTMLCanvasElement.prototype.getContext;
    HTMLCanvasElement.prototype.getContext = function (kind, ...a) { if (kind === 'webgpu' || kind === 'webgl2') asked.add(this); return own.call(this, kind, ...a); };
    window.__canvases = () => [...asked].map((c) => ({ inPage: c.isConnected, w: c.width }));
  });
  await page.goto(url);
  await page.waitForFunction(() => window.aslnutDemo?.w || document.querySelector('.err'), null, { timeout: 90000 });
  return { page, errors };
}

for (const api of apis) {
  const { page, errors } = await open(`http://127.0.0.1:${PORT}/examples/react/?graphics=${api}&dpr=1`);
  try {
    // 1 · it draws
    const r1 = await page.evaluate(async () => {
      const { w, worlds } = window.aslnutDemo;
      const ok = await w.settled({ timeout: 120000 }).catch((e) => String(e.message));
      return { api: w.api, ok, worlds, ids: w.list.map((x) => x.id), canvases: document.querySelectorAll('canvas').length, status: document.querySelector('.status')?.textContent };
    });
    check(api, 'it draws on the graphics asked for, settled, no errors; one world, one canvas', r1.api === api && r1.ok === true && r1.worlds === 1 && r1.canvases === 1 && !errors.length && ['blocks', 'streets', 'fleet'].every((id) => r1.ids.includes(id)), { settled: r1.ok, worlds: r1.worlds, canvases: r1.canvases, status: r1.status, errors: errors.slice(0, 2) });

    // 2 · the colour button: a restyle, nothing built again
    await page.evaluate(() => {
      const { w } = window.aslnutDemo, blocks = w.element('blocks'), n = { builds: 0, restyles: 0, added: 0, removed: 0 };
      for (const m of [...blocks.signs, blocks.labels].filter(Boolean)) {
        const build = m.build, restyle = m.restyle;
        m.build = function (...a) { n.builds++; return build.apply(this, a); };
        m.restyle = function (...a) { n.restyles++; return restyle.apply(this, a); };
      }
      w.on('elements', (c) => { if (c.what === 'add') n.added += c.ids.length; if (c.what === 'remove') n.removed += c.ids.length; });
      window.__n = n; window.__blocks = blocks; window.__colour = blocks.props.area.color;
    });
    // (the clock held: the vans stand still while the picture is compared)
    await page.evaluate(() => window.aslnutDemo.w.setTimeRate(0));
    // a place in block 14 off its middle (its label is there)
    const at = await page.evaluate(() => { const { w } = window.aslnutDemo, c = window.__blocks.props.data[14].geometry.coordinates[0]; const lon = c[0][0] + (c[2][0] - c[0][0]) * 0.22, lat = c[0][1] + (c[2][1] - c[0][1]) * 0.22; return w.project([lon, lat, 0]); });
    const pixel = async () => page.evaluate(async ([x, y]) => { const { w } = window.aslnutDemo; await w.settled({ timeout: 60000 }); const f = await w.frame(), k = f.width / w.camera.width, i = (Math.round(y * k) * f.width + Math.round(x * k)) * 4; return [f.pixels[i], f.pixels[i + 1], f.pixels[i + 2]]; }, at);
    const p0 = await pixel();
    await page.click('button[data-colour=rate]');
    await page.waitForFunction(() => window.__blocks.props.area.color !== window.__colour, null, { timeout: 10000 });
    const p1 = await pixel();
    // the new scale's classes read from the data (five, not every block in the first)
    const kinds = await page.evaluate(async () => {
      const { w } = window.aslnutDemo; await w.settled({ timeout: 60000 }); const f = await w.frame(), k = f.width / w.camera.width, seen = new Set();
      for (const b of window.__blocks.props.data) { const c = b.geometry.coordinates[0], s = w.project([c[0][0] + (c[2][0] - c[0][0]) * 0.22, c[0][1] + (c[2][1] - c[0][1]) * 0.22, 0]); if (!s) continue; const i = (Math.round(s[1] * k) * f.width + Math.round(s[0] * k)) * 4; seen.add(`${f.pixels[i] >> 3},${f.pixels[i + 1] >> 3},${f.pixels[i + 2] >> 3}`); }
      return seen.size;
    });
    const r2 = await page.evaluate(() => ({ ...window.__n, same: window.aslnutDemo.w.element('blocks') === window.__blocks, worlds: window.aslnutDemo.worlds, on: document.querySelector('button[data-colour=rate]').className }));
    const moved = Math.abs(p0[0] - p1[0]) + Math.abs(p0[1] - p1[1]) + Math.abs(p0[2] - p1[2]);
    check(api, 'the colour button restyles the blocks: the same element, nothing built, added, removed or made', r2.same && r2.builds === 0 && r2.restyles >= 1 && r2.added === 0 && r2.removed === 0 && r2.worlds === 1 && r2.on === 'on', r2);
    check(api, 'the picture changes there (a block\'s colour); the rate\'s classes from the data', moved > 30 && kinds >= 4, { before: p0, after: p1, colours: kinds });
    // and back: still nothing built
    await page.click('button[data-colour=kind]');
    await page.waitForFunction(() => window.__blocks.props.area.color === window.__colour, null, { timeout: 10000 });
    const r2b = await page.evaluate(() => ({ ...window.__n }));
    check(api, 'and back: nothing built', r2b.builds === 0 && r2b.added === 0, r2b);

    // 2c · the same element out of the list and back (a list keeping its elements: useMemo, module scope): drawn again
    const r2c = await page.evaluate(async ([x, y]) => {
      const { w } = window.aslnutDemo, el = w.element('blocks'), px = async () => { await w.settled({ timeout: 60000 }); const f = await w.frame(), k = f.width / w.camera.width, i = (Math.round(y * k) * f.width + Math.round(x * k)) * 4; return [f.pixels[i], f.pixels[i + 1], f.pixels[i + 2]]; };
      const a = await px(); w.remove('blocks'); const out = await px(); w.add(el); await new Promise((k) => setTimeout(k, 1000)); const back = await px();
      const r = { a, out, back, same: w.element('blocks') === el };
      Object.assign(window.__n, { added: 0, removed: 0 });
      return r;
    }, at);
    const d = (u, v) => Math.abs(u[0] - v[0]) + Math.abs(u[1] - v[1]) + Math.abs(u[2] - v[2]);
    check(api, 'an element out and back in (the same object) is drawn again', r2c.same && d(r2c.a, r2c.out) > 30 && d(r2c.a, r2c.back) < 12, r2c);
    // 3 · a tap on a block opens the panel
    await page.mouse.click(at[0], at[1]);
    const r3 = await page.waitForSelector('.panel b', { timeout: 10000 }).then((h) => h.textContent()).catch(() => null);
    const want = await page.evaluate(() => String(window.__blocks.props.data[14].props.name));
    check(api, 'a tap on a block opens the React panel with its name', r3 === want, { panel: r3, want });

    // 4 · the twin's view: a flight, the buildings added, the vans moving
    await page.evaluate(() => window.aslnutDemo.w.setTimeRate(4));
    const t0 = await page.evaluate(() => window.aslnutDemo.w.time.getTime());
    await page.click('button[data-view=twin]');
    await page.waitForFunction(() => window.aslnutDemo.w.camera.view.tilt > 55, null, { timeout: 15000 });
    const r4 = await page.evaluate(async () => { const { w } = window.aslnutDemo; await w.settled({ timeout: 120000 }); return { ...window.__n, ids: w.list.map((x) => x.id), t: w.time.getTime(), tilt: w.camera.view.tilt, fleet: w.telemetry().elements.find((e) => e.id === 'fleet') }; });
    check(api, 'the view button flies to the twin\'s view: the buildings added, the vans moving', r4.ids.includes('buildings') && r4.added === 1 && r4.removed === 0 && r4.t > t0 && (r4.fleet?.draws ?? 0) > 0, { added: r4.added, tilt: Math.round(r4.tilt), clock: r4.t - t0, fleetDraws: r4.fleet?.draws });
    check(api, 'no page errors', !errors.length, errors.slice(0, 3));
  } finally { await page.close(); }
}

// 5 · the development build: strict mode's mount, unmount, mount
if (DEV) {
  const port = PORT + 1;
  const pkg = join(import.meta.dirname, '..'), bin = join(pkg, '..', '..', 'node_modules', 'vite', 'bin', 'vite.js');
  const vite = spawn(process.execPath, [bin, '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { cwd: pkg, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await new Promise((ok, no) => { const t = setTimeout(() => no(new Error('vite did not start')), 60000); vite.stdout.on('data', (b) => { if (/Local:|ready in/.test(String(b))) { clearTimeout(t); ok(); } }); vite.on('exit', (c) => no(new Error(`vite exited ${c}`))); });
    for (const api of apis) {
      const { page, errors } = await open(`http://127.0.0.1:${port}/examples/react/?graphics=${api}&dpr=1`);
      try {
        const r = await page.evaluate(async () => { const { w, worlds } = window.aslnutDemo; const ok = await w.settled({ timeout: 180000 }).catch((e) => String(e.message)); return { ok, worlds, api: w.api, disposed: w.isDisposed, canvases: window.__canvases(), inPage: document.querySelectorAll('canvas').length }; });
        const asked = r.canvases.length, left = r.canvases.filter((c) => c.inPage).length;
        check(api, 'dev (strict mode): two canvases asked for graphics, one left, its world drawing; onReady once', r.api === api && r.ok === true && !r.disposed && r.worlds === 1 && asked === 2 && left === 1 && r.inPage === 1 && !errors.length, { asked, left, worlds: r.worlds, settled: r.ok, errors: errors.slice(0, 2) });
      } finally { await page.close(); }
    }
  } finally { vite.kill('SIGTERM'); }
}

await browser.close(); srv.close();
console.log(failed ? `${failed} FAILED` : 'all ok');
process.exit(failed ? 1 : 0);
