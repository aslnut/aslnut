// The checks for what headless software rendering once let through (each fails the run), on WebGPU AND WebGL2:
//   drape   areas and lines on rugged terrain: every ground pixel under an area is the area's (no hill pokes through);
//           measured as ground-coloured pixels with terrain minus without (?go=drape vs ?go=drape-flat)
//   blink   the mouse moving over the map for 3 s while frames are read back: no frame comes out dark or empty
//           (the hover pick must never touch what is shown)
//   motion  the fleet playing: every vehicle moves every frame, smoothly (no frame where they stand, no jumps)
//   still   the camera is the person's: every preset opened, nothing moves the camera for 3 s without input
//   holes   the dashboard on real terrain over a flat-coloured ground, at West Java zoom 10.4 and Kab. Bandung's
//           districts zoom 13.8, tilted: ground showing inside the fills (a hole) compared with terrain off, while the
//           terrain loads and settled, with the marks as prisms and on the ground's tiles (network: real terrain)
//   idle    render on change: a still, settled view draws (almost) nothing (≤ 1 frame a second: a `when` of yours
//           may read the clock), so a phone's chip rests
//   rejections  the gesture driven for 24 s (tiles loading and abandoned all the way): no unhandled promise rejection,
//           the phone log gets at most one request every 2 s, and the scripted motion counts as moving
//   whiteholes  a third of the imagery requests failing (500), a fast zoom and a tilted still view over mountains: no
//           part of the ground shows the sky's pale horizon (a tile culled at sea level under high ground, a crack
//           between levels); on WebGPU and WebGL2 in Chromium, and WebGL2 in Firefox (network: real tiles)
//   firefox WebGL2 in Firefox: a world renders, settles and reads back a frame that is not black
//   offscreen a world on an OffscreenCanvas, on the page and in a worker (examples/offscreen): it renders, settles and
//           reads back a frame with its points in it, on the graphics asked for
//   recipes the authoring guide's recipes (tools/smoke-recipes.mjs, its own server, the network mocked): only when named
//   node tools/checks.mjs [drape,blink,motion,still,idle,rejections,holes,whiteholes,firefox,offscreen,recipes]     (run `npm run examples` first) · images in .out/checks/
import { serve } from './serve.mjs';
import { launch, openDemo, playwright } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', '.out', 'checks'); mkdirSync(OUT, { recursive: true });
const PORT = Number(process.env.CHECKS_PORT ?? 8095), base = `http://127.0.0.1:${PORT}/examples/hello-earth/`;
const which = (process.argv[2] ?? 'drape,blink,motion,still,idle,rejections,holes,whiteholes,firefox,offscreen').split(',');
const srv = await serve(PORT), browser = await launch();
let failed = 0;
const check = (api, name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${api.padEnd(6)} ${name}${detail ? ` · ${detail}` : ''}`); };
const grab = (page) => page.evaluate(async () => { const f = await window.aslnutDemo.w.frame(); let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768)); return { w: f.width, h: f.height, b64: btoa(bin) }; });
const bytes = (r) => new Uint8Array(Buffer.from(r.b64, 'base64'));
// the ground's colour (blue-grey, shaded): b well over r, not the areas' warm colours
// fill colours of the dashboard (warm: red over blue)
const fillPct = (px) => { let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i] > px[i + 2] + 25 && px[i] > 90) n++; return (100 * n) / (px.length / 4); };
const groundPct = (px) => { let n = 0; for (let i = 0; i < px.length; i += 4) if (px[i + 2] > px[i] + 12 && px[i + 2] > 30 && px[i + 1] < 140) n++; return (100 * n) / (px.length / 4); };

for (const api of ['webgpu', 'webgl2']) {
  if (which.includes('offscreen')) {
    for (const where of ['page', 'worker']) {
      const page = await browser.newPage({ viewport: { width: 480, height: 320 } }), errs = [];
      page.on('pageerror', (e) => errs.push(e.message)); page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errs.push(m.text()); });
      try {
        await page.goto(`http://127.0.0.1:${PORT}/examples/offscreen/?where=${where}&graphics=${api}`);
        await page.waitForFunction(() => window.aslnutOffscreen, null, { timeout: 120000 });
        const r = await page.evaluate(() => window.aslnutOffscreen);
        check(api, `offscreen: a world on an OffscreenCanvas ${where === 'page' ? 'on the page' : 'in a worker'}`, !r.error && r.api === api && r.red > 500 && r.colours > 10 && !errs.length, r.error ? r.error.slice(0, 300) : `${r.width} × ${r.height} on ${r.api}, ${r.red} px of its points, ${r.colours} colours, ${r.frames} frames${errs.length ? ` · ${errs.slice(0, 2).join(' | ')}` : ''}`);
      } catch (e) { check(api, `offscreen ${where}`, false, e.message.slice(0, 300)); } finally { await page.close(); }
    }
  }
  if (which.includes('drape')) {
    const shot = async (go) => {
      const { page } = await openDemo(browser, `${base}?go=${go}&graphics=${api}&dpr=1&clock=30`, { width: 390, height: 844 });
      await page.evaluate(() => window.aslnutDemo.w.settled({ strict: true, timeout: 120000 }));
      const r = await grab(page); await page.close();
      const px = bytes(r); writeFileSync(join(OUT, `${go}-${api}.png`), png(r.w, r.h, px));
      return groundPct(px);
    };
    const withT = await shot('drape'), flat = await shot('drape-flat');
    check(api, 'drape: no ground shows through areas on rugged terrain', withT - flat < 0.2, `ground pixels ${withT.toFixed(2)} % with terrain, ${flat.toFixed(2)} % flat`);
  }
  if (which.includes('blink')) {
    const { page } = await openDemo(browser, `${base}?go=${process.env.CHECK_BLINK_GO ?? 'drape'}&graphics=${api}&dpr=1`, { width: 390, height: 844 });
    await page.evaluate(() => window.aslnutDemo.w.settled({ timeout: 120000 })).catch(() => {});
    const dark = [];
    for (let k = 0; k < 40; k++) {
      await page.mouse.move(60 + (k * 37) % 280, 300 + (k * 53) % 400, { steps: 3 });
      const px = bytes(await grab(page));
      let d = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] < 24) d++;
      dark.push((100 * d) / (px.length / 4));
      if (dark.at(-1) > 50) writeFileSync(join(OUT, `blink-${api}-${k}.png`), png(390, 844, px));
    }
    // against the view's own dark share (a dark sea is content): a blink is a frame much darker than the others
    const med = [...dark].sort((a, b) => a - b)[dark.length >> 1], worst = Math.max(...dark);
    check(api, 'blink: mouse over the map, no dark or empty frame', worst - med < 5 && med < 50, `worst frame ${worst.toFixed(2)} % black (typical ${med.toFixed(2)} %) over ${dark.length} frames`);
    await page.close();
  }
  if (which.includes('motion')) {
    const { page } = await openDemo(browser, `${base}?go=fleet&graphics=${api}&dpr=1&play=1`, { width: 390, height: 844 });
    const r = await page.evaluate(async () => {
      const { w } = window.aslnutDemo, l = w.element('vehicles');
      await w.settled({ timeout: 120000 }).catch(() => {});
      const frame = () => new Promise((ok) => requestAnimationFrame(ok));
      // (the layer's places: lon, lat pairs in one array)
      const at = () => Array.from({ length: Math.min(40, l.ll.length / 2) }, (_, i) => [l.ll[2 * i], l.ll[2 * i + 1]]);
      let prev = at(); const steps = []; let still = 0;
      for (let k = 0; k < 40; k++) {
        await frame(); const cur = at();
        const d = cur.map((p, i) => Math.hypot(p[0] - prev[i][0], p[1] - prev[i][1]));
        const moving = d.filter((x) => x > 0).length; if (moving < d.length * 0.5) still++;
        steps.push(d); prev = cur;
      }
      // smooth: per vehicle, no frame step over 4× its median step
      let jumps = 0; for (let v = 0; v < (steps[0]?.length ?? 0); v++) { const s = steps.map((x) => x[v]).filter((x) => x > 0).sort((a, b) => a - b); const med = s[s.length >> 1] ?? 0; if (med > 0 && s.at(-1) > 4 * med) jumps++; }
      return { n: l.ll.length / 2, still, jumps };
    });
    check(api, 'motion: the fleet moves every frame, smoothly', r.n > 0 && r.still <= 2 && r.jumps <= Math.max(1, r.n * 0.05), `${r.n} vehicles · frames standing ${r.still}/40 · vehicles with jumps ${r.jumps}`);
    await page.close();
  }
}
// the presets a person opens (not the parity twins, not the flight recordings' own runs)
if (which.includes('still')) {
  const first = await openDemo(browser, `${base}?go=players&dpr=1`, { width: 390, height: 844 });
  const PRESET_NAMES = (await first.page.evaluate(() => window.aslnutDemo.presets)).filter((k) => !k.startsWith('parity-'));
  await first.page.close();
  for (const api of ['webgpu', 'webgl2']) {
    const moved = [];
    for (const go of PRESET_NAMES) {
      const { page } = await openDemo(browser, `${base}?go=${go}&graphics=${api}&dpr=1`, { width: 390, height: 844 });
      const r = await page.evaluate(async () => {
        const { w } = window.aslnutDemo, v = () => { const c = w.camera; return [c.lon, c.lat, c.dist, c.yaw, c.pitch]; };
        await new Promise((ok) => setTimeout(ok, 1500));
        const a = v(); await new Promise((ok) => setTimeout(ok, 3000)); const b = v();
        return { a, b, moving: w.camera.moving, following: w.isFollowing };
      });
      const d = r.a.map((x, i) => Math.abs(x - r.b[i]) / Math.max(1, Math.abs(x)));
      if (d.some((x) => x > 1e-9) || r.following) moved.push(`${go}${r.following ? ' (following)' : ''}`);
      await page.close();
    }
    check(api, 'still: no preset moves the camera without input (3 s)', !moved.length, moved.length ? `moved: ${moved.join(', ')}` : `${PRESET_NAMES.length} presets`);
  }
}
// holes at the views they were seen at: ground pixels (the flat colour) with terrain against terrain off
if (which.includes('holes')) {
  const shot = async (go, api, mode, mid) => {
    const { page } = await openDemo(browser, `${base}?go=${go}&graphics=${api}&dpr=1&log=0&ground=${mode}`, { width: 600, height: 400 });
    const r = await page.evaluate(async (mid) => {
      const { w } = window.aslnutDemo;
      let loading = 0;
      if (mid) {
        // the marks built and shown, the ground still loading: the frame right then
        const marks = w.stats().elements.filter((l) => l.kind === 'area' || l.kind === 'line').map((l) => w.element(l.id));
        const t0 = performance.now();
        while (performance.now() - t0 < 60000 && !marks.every((l) => l.status().ready && l.shown >= 1)) await new Promise((ok) => requestAnimationFrame(ok));
        loading = w.stats().tiles?.loading ?? 0;
      } else await w.settled({ timeout: 120000 }).catch(() => {});
      const f = await w.frame(); let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768));
      return { w: f.width, h: f.height, b64: btoa(bin), loading };
    }, mid);
    await page.close();
    const px = bytes(r); writeFileSync(join(OUT, `${go}-${api}-${mode}${mid ? '-loading' : ''}.png`), png(r.w, r.h, px));
    return { ground: groundPct(px), fill: fillPct(px), loading: r.loading };
  };
  for (const api of ['webgpu', 'webgl2']) for (const mode of ['prisms', 'tiles']) for (const k of ['jb', 'kb']) {
    const ref = await shot(`holes-${k}-flat`, api, mode, false), done = await shot(`holes-${k}`, api, mode, false), mid = await shot(`holes-${k}`, api, mode, true);
    check(api, `holes ${mode} ${k}: settled, no ground inside the fills`, done.ground - ref.ground < 1.5 && ref.fill > 30, `ground ${done.ground.toFixed(2)} % (terrain off ${ref.ground.toFixed(2)} %) · fill ${done.fill.toFixed(1)} %`);
    check(api, `holes ${mode} ${k}: while the terrain loads`, mid.ground - ref.ground < 1.5, `ground ${mid.ground.toFixed(2)} % · ${mid.loading} tile(s) still loading`);
  }
}
// a still, settled view rests: frames drawn in 3 s while nothing changes (the panel's own polling included)
if (which.includes('idle')) {
  for (const api of ['webgpu', 'webgl2']) {
    const busy = [];
    for (const go of ['regions', 'gesture', 'crime', 'energy', 'flows', 'city']) {
      const { page } = await openDemo(browser, `${base}?go=${go}&graphics=${api}&dpr=1&log=0`, { width: 390, height: 844 });
      const r = await page.evaluate(async () => { const { w } = window.aslnutDemo; await w.settled({ timeout: 60000 }).catch(() => {}); await new Promise((ok) => setTimeout(ok, 1500)); w.drawnWhy(); const f0 = w.stats().drawn; await new Promise((ok) => setTimeout(ok, 3000)); return { n: w.stats().drawn - f0, why: w.drawnWhy() }; });
      // frames a layer asked for because it animates (a shader reading the time) are wanted; anything else is not
      const anim = Object.entries(r.why).filter(([k]) => k.startsWith('animating:')).reduce((a, [, v]) => a + v, 0);
      if (r.n - anim > 4) busy.push(`${go} ${r.n - anim} (${Object.entries(r.why).map(([k, v]) => `${k} ${v}`).join(', ')})`);
      await page.close();
    }
    check(api, 'idle: a still, settled view draws ≤ 4 frames in 3 s (besides layers that animate)', !busy.length, busy.length ? busy.join(' · ') : '6 presets');
  }
}
// the gesture driven by script for 24 s: every abandoned load is handled, logging stays cheap, scripted motion is moving
if (which.includes('rejections')) {
  for (const api of ['webgpu', 'webgl2']) {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
    await page.addInitScript(() => { window.__unhandled = 0; addEventListener('unhandledrejection', () => { window.__unhandled++; }); });
    let posts = 0; page.on('request', (r) => { if (r.url().includes('/api/log') && r.method() === 'POST') posts++; });
    await page.goto(`${base}?go=gesture&graphics=${api}&dpr=1&log=/api/log`);
    await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 60000 });
    const postsBefore = posts;
    const r = await page.evaluate(async ({ view, seconds }) => {
      const viewAt = new Function(`return (${view})`)();
      const { w } = window.aslnutDemo, dts = []; let last = performance.now(), movingFrames = 0, frames = 0; const t0 = last;
      await new Promise((done) => { const tick = (now) => { dts.push(now - last); last = now; frames++; if (w.camera.moving) movingFrames++; const s = (now - t0) / 1000; if (s > seconds) return done(); w.go(viewAt(s)); requestAnimationFrame(tick); }; requestAnimationFrame(tick); });
      const a = dts.slice(5).sort((x, y) => x - y);
      return { unhandled: window.__unhandled, aborted: w.stats().tiles?.aborted ?? null, p95: a[Math.floor(a.length * 0.95)], max: a.at(-1), moving: movingFrames / frames };
    }, { view: (await import('../examples/hello-earth/gesture.ts')).gestureView.toString(), seconds: 24 });
    await new Promise((ok) => setTimeout(ok, 2500));
    const sent = posts - postsBefore;
    check(api, 'rejections: no unhandled rejection while loads are abandoned (24 s gesture)', r.unhandled === 0, `${r.unhandled} unhandled · loads abandoned ${r.aborted} · log posts ${sent} · frames p95 ${r.p95?.toFixed(1)} max ${r.max?.toFixed(1)} ms`);
    check(api, 'rejections: the phone log stays cheap (≤ 1 request / 2 s)', sent <= 14, `${sent} posts in ~26 s`);
    check(api, 'rejections: scripted motion counts as moving', r.moving > 0.9, `moving in ${(100 * r.moving).toFixed(0)} % of frames`);
    await page.close();
  }
}
// a third of the imagery failing: the ground never shows the sky's pale horizon through a hole (Chromium and Firefox)
const { firefox } = await playwright();
if (which.includes('whiteholes')) {
  const ff = await firefox.launch({ headless: true }).catch(() => null);
  for (const [name, b, api] of [['webgpu', browser, 'webgpu'], ['webgl2', browser, 'webgl2'], ['ff-gl2', ff, 'webgl2']]) {
    if (!b) { check(name, 'whiteholes: Firefox available', false, 'npx playwright install firefox'); continue; }
    const page = await b.newPage({ viewport: { width: 390, height: 700 } });
    let n = 0, bad = 0;
    await page.route(/eox\.at|s2cloudless/, (r) => { n++; if (n % 3 === 0) { bad++; return r.fulfill({ status: 500, body: 'x' }); } return r.continue(); });
    await page.goto(`http://127.0.0.1:${PORT}/examples/suite/?auto=1&only=fast-zoom,idle&engines=${api}`);
    let worst = 0, at = 0;
    for (let i = 0; i < 36; i++) {
      await page.waitForTimeout(600);
      const shot = await page.screenshot(), px = (await import('./png.mjs')).decode?.(shot) ?? null;
      if (!px) continue;
      // the horizon colour (0.82, 0.88, 0.94) below the top 30 % of the screen: the ground is missing there
      let k = 0, all = 0;
      for (let y = Math.floor(px.height * 0.3); y < px.height; y += 2) for (let x = 0; x < px.width; x += 2) { const q = (y * px.width + x) * 4; all++; if (Math.abs(px.data[q] - 209) < 12 && Math.abs(px.data[q + 1] - 224) < 12 && Math.abs(px.data[q + 2] - 240) < 12) k++; }
      if (k / all > worst) { worst = k / all; at = i; writeFileSync(join(OUT, `whiteholes-${name}.png`), shot); }
    }
    check(name, 'whiteholes: imagery failing (1 in 3): no hole shows the sky through the ground', worst < 0.002, `${(100 * worst).toFixed(3)} % of the lower screen at worst (shot ${at}) · ${bad} of ${n} imagery requests failed`);
    await page.close();
  }
  await ff?.close();
}
if (which.includes('firefox')) {
  const ff = await firefox.launch({ headless: true }).catch(() => null);
  if (!ff) check('ff-gl2', 'firefox: available', false, 'npx playwright install firefox');
  else {
    const { page, errors } = await openDemo(ff, `${base}?go=parity&graphics=webgl2&quality=realistic&dpr=1&clock=30`);
    const r = await page.evaluate(async () => { const { w } = window.aslnutDemo; await w.settled({ timeout: 120000 }); const f = await w.frame(); let lit = 0; for (let i = 0; i < f.pixels.length; i += 4) if (f.pixels[i] + f.pixels[i + 1] + f.pixels[i + 2] > 24) lit++; return { api: w.api, lit: lit / (f.pixels.length / 4) }; });
    check('ff-gl2', 'firefox: WebGL2 renders, settles and reads back a frame', r.api === 'webgl2' && r.lit > 0.5, `${r.api} · ${(100 * r.lit).toFixed(0)} % lit`);
    check('ff-gl2', 'firefox: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
    await ff.close();
  }
}
// the recipes, when named (not in the default list): every recipe on WebGPU and WebGL2, as smoke-recipes runs alone
if (which.includes('recipes')) {
  const { spawnSync } = await import('node:child_process');
  const r = spawnSync(process.execPath, [join(import.meta.dirname, 'smoke-recipes.mjs')], { stdio: 'inherit', env: { ...process.env, PORT: process.env.RECIPES_PORT ?? String(PORT + 1) } });
  check('both', 'recipes: each renders, settles and has what it says, on WebGPU and WebGL2', r.status === 0, r.status === 0 ? '' : `smoke-recipes exit ${r.status}`);
}
await browser.close(); srv.close();
console.log(failed ? `${failed} check(s) failed` : 'all checks passed');
process.exit(failed ? 1 : 0);
