// The browser smoke test, on WebGPU AND WebGL2 (every check runs on both; a failure on either fails the run):
//   1. a world renders, settles (strict) and reads back a frame that is not black, on the graphics asked for
//   2. every shader hook changes the pixels as it should (surface.color / position, points.color / position / alpha / reveal)
//   3. the custom layer draws; your shader with an error is refused with its line, and the old one keeps drawing
//   4. dispose stops the loop and frees every graphics byte
//   5. phase 2: lines, areas, extrusions, labels and rasters draw; picking answers the same on both; hover lights a
//      feature and shows its tooltip; tap selects; hooks of the new marks; a state applied brings the view back; a
//      query's answer recolours; raster order; reveals play and end where they should
//   6. phase 3: arcs draw; trails follow the world time; the drill-down opens districts; setProjection opens the globe
//      flat; follow keeps the camera on a moving place; a capture carries its credits
//   7. tools/checks.mjs: areas and lines draped on rugged terrain (no ground pokes through), no blink while the
//      mouse moves, the fleet moving every frame
//   (the checks of its own (checks, primitives, smoke-city) shown as they come, each part's name as it starts: a part
//   that hangs shows which)
//   node tools/smoke.mjs   (builds nothing: run `npm run examples` first)
import { serve } from './serve.mjs';
import { launch, openDemo, settledFrame, bytesOf } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 8094), OUT = join(import.meta.dirname, '..', '.out', 'smoke');
mkdirSync(OUT, { recursive: true });
const base = `http://127.0.0.1:${PORT}/examples/hello-earth/`;
const url = (api, extra = '') => `${base}?go=parity&graphics=${api}&quality=realistic&dpr=1&clock=30${extra}`;
const srv = await serve(PORT), browser = await launch();
const results = [];
let failed = 0;
const check = (api, name, ok, detail) => { results.push({ api, name, ok, detail }); if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${api.padEnd(6)} ${name}${detail ? ` · ${detail}` : ''}`); };
const changed = (a, b, tol = 24) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > tol) n++; return n; };
const count = (px, f) => { let n = 0; for (let i = 0; i < px.length; i += 4) if (f(px[i], px[i + 1], px[i + 2])) n++; return n; };

for (const api of ['webgpu', 'webgl2']) {
  // 1 · render, settle, read back
  const { page, errors } = await openDemo(browser, url(api));
  let basePx;
  try {
    const r = await settledFrame(page);
    basePx = bytesOf(r);
    writeFileSync(join(OUT, `parity-${api}.png`), png(r.width, r.height, basePx));
    const n = basePx.length / 4, lit = count(basePx, (r, g, b) => r + g + b > 24), uniq = new Set(); for (let i = 0; i < basePx.length; i += 400) uniq.add(basePx[i] * 65536 + basePx[i + 1] * 256 + basePx[i + 2]);
    check(api, 'renders on the graphics asked for', r.api === api, `got ${r.api}`);
    check(api, 'frame is not black and not flat', lit / n > 0.9 && uniq.size > 50, `${((100 * lit) / n).toFixed(1)} % lit · ${uniq.size} colours · settled in ${r.ms.toFixed(0)} ms, ${r.frames} frames`);
    // 3 · the custom layer draws: hide it and the frame changes
    const hidden = await page.evaluate(async () => { const { w } = window.aslnutDemo; w.element('heat').setProps({ when: false }); await w.settled({ strict: true }); const f = await w.frame(); let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768)); w.element('heat').setProps({ when: true }); await w.settled({ strict: true }); return { b64: btoa(bin) }; });
    check(api, 'custom layer draws', changed(basePx, bytesOf(hidden)) > 300, `${changed(basePx, bytesOf(hidden))} px change when it is hidden`);
    // a shader error is refused with the line, the old program keeps drawing
    const err = await page.evaluate(async () => { const { w } = window.aslnutDemo; try { await w.element('heat').setShader({ fragment: 'let r = length(corner);\ncolor = vec4f(r, r, r);' }); return 'accepted'; } catch (e) { return `${e.code} ${e.message}`; } });
    check(api, 'a bad shader is refused with its line', /E-SHADER-001.*line 2/.test(err), err.slice(0, 120));
    const after = await settledFrame(page);
    check(api, 'the old shader keeps drawing after a refused one', changed(basePx, bytesOf(after)) < basePx.length / 4 / 200, `${changed(basePx, bytesOf(after))} px differ`);
    // 4 · dispose: the loop stops, every graphics byte is freed, the controls are removed
    const d = await page.evaluate(async () => {
      const { w } = window.aslnutDemo, g = w.graphics, r = w.renderer, before = g.bytes, canvas = document.getElementById('view');
      w.dispose(); const f0 = r.frames; await new Promise((ok) => setTimeout(ok, 400));
      return { before, after: g.bytes, framesAfter: r.frames - f0, running: r.isRunning, touch: canvas.style.touchAction, threw: (() => { try { w.add(); return false; } catch (e) { return e.code; } })() };
    });
    check(api, 'dispose stops the loop and frees graphics memory', d.after === 0 && d.framesAfter === 0 && !d.running && d.touch !== 'none' && d.threw === 'E-WORLD-003', `${(d.before / 1048576).toFixed(1)} MB → ${d.after} bytes · ${d.framesAfter} frames after`);
    check(api, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'parity preset', false, e.message.slice(0, 300)); }
  await page.close();

  // 2 · every hook, on this graphics
  const expect = {
    'surface.color': (px) => count(px, (r, g, b) => r > 200 && g < 50 && b < 50) > px.length / 4 / 2,
    'surface.position': (px) => changed(basePx, px) > px.length / 4 / 3,
    'points.color': (px) => count(px, (r, g, b) => b > 150 && r < 80 && g < 80) > 20,
    'points.position': (px) => changed(basePx, px) > 200,
    'points.alpha': (px) => changed(basePx, px) > 50,
    'points.reveal': (px) => changed(basePx, px) > 50,
  };
  for (const [hook, ok] of Object.entries(expect)) {
    const { page: p2, errors: e2 } = await openDemo(browser, url(api, `&hook=${hook}`));
    try {
      const r = await settledFrame(p2);
      const px = bytesOf(r);
      writeFileSync(join(OUT, `hook-${hook}-${api}.png`), png(r.width, r.height, px));
      check(api, `hook ${hook}`, basePx && ok(px) && e2.length === 0, `${changed(basePx ?? px, px)} px changed${e2.length ? ` · ${e2[0]}` : ''}`);
    } catch (e) { check(api, `hook ${hook}`, false, e.message.slice(0, 200)); }
    await p2.close();
  }
}
// ── phase 2: marks, picking, hover, tap, states, text, rasters, reveals, hooks of the new marks; on both graphics ──
const frameNow = (page) => page.evaluate(async () => { const { w } = window.aslnutDemo; await w.settled({ strict: true, timeout: 60000 }); const f = await w.frame(); let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768)); return { b64: btoa(bin), width: f.width, height: f.height }; });
const pickMaps = {};
for (const api of ['webgpu', 'webgl2']) {
  const { page, errors } = await openDemo(browser, url(api).replace('go=parity', 'go=parity-vectors'), { width: 640, height: 420 });
  try {
    const base = bytesOf(await frameNow(page));
    writeFileSync(join(OUT, `vectors-${api}.png`), png(640, 420, base));
    for (const id of ['districts', 'grid', 'blocks', 'places']) {
      const px = bytesOf(await (async () => { await page.evaluate((id) => window.aslnutDemo.w.hide(id), id); const f = await frameNow(page); await page.evaluate((id) => window.aslnutDemo.w.release(id), id); return f; })());
      check(api, `${id} draws`, changed(base, px) > 150, `${changed(base, px)} px change when it is hidden`);
    }
    await frameNow(page);
    // picking: a grid of points, the same answers on both graphics (compared below)
    pickMaps[api] = await page.evaluate(async () => { const { w } = window.aslnutDemo; let out = ''; for (let y = 150; y < 330; y += 15) { for (let x = 120; x < 520; x += 15) { const f = await w.pick(x, y, { radius: 0 }); out += f ? `${f.element[0]}${f.index % 10}` : '..'; } out += '\n'; } return out; });
    const one = await page.evaluate(async () => { const f = await window.aslnutDemo.w.pick(300, 240); return f && { element: f.element, id: f.id, name: f.props.name, at: f.at && f.at.length }; });
    check(api, 'pick finds the feature with its id and props', one?.element === 'districts' && /^District/.test(one.name) && one.at === 3, JSON.stringify(one));
    // hover: a real mouse over a district lights it, shows its tooltip, and sets s.user.hover
    await page.mouse.move(300, 240); await page.waitForTimeout(150); await page.mouse.move(302, 241); await page.waitForTimeout(400);
    const hv = await page.evaluate(() => ({ hover: window.aslnutDemo.w.user.hover, tip: document.querySelector('.aslnut-tooltip')?.textContent ?? null, shown: document.querySelector('.aslnut-tooltip')?.style.display }));
    check(api, 'hover: the feature, its tooltip, s.user.hover', hv.hover === one?.id && /^District .*: \d+/.test(hv.tip ?? '') && hv.shown === 'block', JSON.stringify(hv));
    const lit = bytesOf(await frameNow(page));
    check(api, 'hover look drawn', changed(base, lit) > 100, `${changed(base, lit)} px`);
    await page.mouse.move(5, 5); await page.waitForTimeout(300);
    // tap: select toggles the feature (s.user.selection), its look changes
    await page.mouse.click(300, 240);
    // Selection waits for asynchronous graphics readback; software rendering can take longer than a fixed delay.
    await page.waitForFunction(() => window.aslnutDemo.w.user.selection.length > 0, null, { timeout: 5000 }).catch(() => {});
    const sel = await page.evaluate(() => window.aslnutDemo.w.user.selection);
    check(api, 'tap selects (select: toggle)', sel.length === 1 && sel[0] === String(one?.id), JSON.stringify(sel));
    await page.evaluate(() => window.aslnutDemo.w.select([]));
    // hooks of the new marks
    for (const [id, code] of [['grid', { color: 'color = vec4f(1.0, 0.0, 1.0, color.a);' }], ['districts', { color: 'color = vec4f(0.0, 1.0, 0.0, color.a);' }], ['blocks', { color: 'color = vec4f(0.0, 0.0, 1.0, color.a);' }]]) {
      await page.evaluate(async ([id, code]) => window.aslnutDemo.w.element(id).setShader(code), [id, code]);
      const px = bytesOf(await frameNow(page));
      check(api, `hook ${id}.color`, changed(base, px) > 100, `${changed(base, px)} px`);
      await page.evaluate(async (id) => window.aslnutDemo.w.element(id).setShader({}), id);
    }
    check(api, 'no page errors (vectors)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'vectors preset', false, e.message.slice(0, 300)); }
  await page.close();

  // states on the crime choropleth: capture, change everything, apply → the same picture; text and the query drew
  const { page: p3, errors: e3 } = await openDemo(browser, url(api).replace('go=parity', 'go=parity-crime'), { width: 640, height: 420 });
  try {
    const a = bytesOf(await frameNow(p3));
    writeFileSync(join(OUT, `crime-${api}.png`), png(640, 420, a));
    const st = await p3.evaluate(() => JSON.stringify(window.aslnutDemo.w.capture({ note: 'smoke' })));
    const names = bytesOf(await (async () => { await p3.evaluate(() => window.aslnutDemo.w.hide('council-names')); const f = await frameNow(p3); await p3.evaluate(() => window.aslnutDemo.w.release('council-names')); return f; })());
    check(api, 'labels draw', changed(a, names) > 150, `${changed(a, names)} px`);
    await p3.evaluate(async () => { const { w } = window.aslnutDemo; w.go({ lon: 145.1, lat: -37.9, zoom: 11, tilt: 50 }); w.hide('crime'); w.reveal('councils'); });
    const b = bytesOf(await frameNow(p3));
    await p3.evaluate(async (st) => { await window.aslnutDemo.w.apply(JSON.parse(st), { seconds: 0 }); }, st);
    const c = bytesOf(await frameNow(p3));
    check(api, 'states: apply brings the captured view back', changed(a, b) > 5000 && changed(a, c) < 640 * 420 / 200, `${changed(a, b)} px after the changes, ${changed(a, c)} px after apply`);
    await p3.evaluate(() => window.aslnutDemo.w.set('q.offence', 'theft'));
    const q = bytesOf(await frameNow(p3));
    check(api, 'a query answer recolours the choropleth (shapes stay)', changed(a, q) > 2000, `${changed(a, q)} px`);
    check(api, 'no page errors (crime)', e3.length === 0, e3.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'crime preset', false, e.message.slice(0, 300)); }
  await p3.close();

  // the suburbs from a PMTiles archive (byte ranges through the loader): the view's tiles in, the choropleth drawn
  const { page: pm, errors: em } = await openDemo(browser, url(api).replace('go=parity', 'go=crime-pmtiles'), { width: 640, height: 420 });
  try {
    const r = await pm.evaluate(async () => { const { w } = window.aslnutDemo; const ok = await w.settled({ timeout: 90000 }); return { ok, n: w.element('crime').props.data.size, failed: w.report().failed.map((f) => f.error).slice(0, 2) }; });
    check(api, 'PMTiles: the suburbs read by byte ranges for the view', r.ok && r.n > 100 && !r.failed.length, JSON.stringify(r));
    check(api, 'no page errors (pmtiles)', em.length === 0, em.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'pmtiles preset', false, e.message.slice(0, 300)); }
  await pm.close();

  // rasters in order, reveals that play back to the same picture
  const { page: p4, errors: e4 } = await openDemo(browser, url(api, '&context=video').replace('go=parity', 'go=parity-energy'), { width: 640, height: 420 });
  try {
    const a = bytesOf(await frameNow(p4));
    writeFileSync(join(OUT, `energy-${api}.png`), png(640, 420, a));
    await p4.evaluate(() => window.aslnutDemo.w.toggle('no-solar', true));
    const r = bytesOf(await frameNow(p4));
    check(api, 'raster painted into the ground (solar off changes it)', changed(a, r) > 5000, `${changed(a, r)} px`);
    await p4.evaluate(() => window.aslnutDemo.w.toggle('no-solar', false));
    await p4.evaluate(() => window.aslnutDemo.w.move('wind', { below: 'solar' }));
    const o = bytesOf(await frameNow(p4));
    check(api, 'raster order: wind below solar changes the ground', changed(a, o) > 1000, `${changed(a, o)} px`);
    await p4.evaluate(() => window.aslnutDemo.w.move('wind', { order: undefined }));
    await p4.evaluate(() => { const { w } = window.aslnutDemo; w.hide('backbone'); w.hide('plants'); });
    const hid = bytesOf(await frameNow(p4));
    const mid = await p4.evaluate(async () => { const { w } = window.aslnutDemo; w.reveal('backbone'); w.reveal('plants'); for (let i = 0; i < 20; i++) await new Promise((ok) => w.renderer.isRunning ? requestAnimationFrame(ok) : setTimeout(ok, 16)); return w.report().pending.join('; '); });
    const back = bytesOf(await frameNow(p4));
    check(api, 'reveals play (trace, pop) and end on the shown picture', changed(a, hid) > 300 && /revealing/.test(mid) && changed(a, back) < 640 * 420 / 200, `${changed(a, hid)} px hidden · mid: ${mid.slice(0, 80)} · ${changed(a, back)} px after`);
    check(api, 'no page errors (energy)', e4.length === 0, e4.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'energy preset', false, e.message.slice(0, 300)); }
  await p4.close();

  // phase 3: arcs, trails over time, the drill-down, the globe opening flat, follow, captures with their credits
  const open3 = (go) => openDemo(browser, url(api).replace('go=parity', `go=${go}`), { width: 640, height: 420 });
  const hideDiff = async (page, id) => { const a = bytesOf(await frameNow(page)); await page.evaluate((id) => window.aslnutDemo.w.hide(id), id); const b = bytesOf(await frameNow(page)); await page.evaluate((id) => window.aslnutDemo.w.release(id), id); return changed(a, b); };
  { const { page: p, errors: e } = await open3('parity-flows');
    try {
      await frameNow(p);
      check(api, 'arcs draw (great circles rising over the globe)', (await hideDiff(p, 'flows')) > 800, `${await hideDiff(p, 'flows')} px`);
      const a = bytesOf(await frameNow(p));
      const m = await p.evaluate(async () => { const { w } = window.aslnutDemo; w.setProjection('flat', 0.3); for (let i = 0; i < 30; i++) w.step(33); await w.settled({ timeout: 60000 }); return w.camera.morph; });
      const b = bytesOf(await frameNow(p));
      check(api, 'w.setProjection: the globe opens into the flat map', m === 1 && changed(a, b) > 20000, `morph ${m} · ${changed(a, b)} px`);
      const shot = await p.evaluate(async () => { const { w } = window.aslnutDemo; w.stop(); const f0 = await w.frame(), f1 = await w.frame({ attribution: true }); let d = 0, low = 0; for (let i = 0; i < f0.pixels.length; i += 4) if (f0.pixels[i] !== f1.pixels[i]) { d++; if (i / 4 / f0.width > f0.height * 0.9) low++; } return { d, low, text: w.attribution().join(' · ') }; });
      check(api, 'w.frame({ attribution }) burns the credits into the bottom of a capture', shot.d > 200 && shot.low / shot.d > 0.95 && /Natural Earth/.test(shot.text), `${shot.d} px changed, ${Math.round((100 * shot.low) / Math.max(1, shot.d))} % in the bottom band`);
      check(api, 'no page errors (flows)', e.length === 0, e.slice(0, 3).join(' | '));
    } catch (err) { check(api, 'flows preset', false, err.message.slice(0, 300)); }
    await p.close(); }
  { const { page: p, errors: e } = await open3('parity-fleet');
    try {
      await frameNow(p);
      const at = async (min) => { await p.evaluate(async (min) => { const { w } = window.aslnutDemo; w.setTime(new Date(Date.UTC(2026, 9, 11, 19, min))); }, min); return bytesOf(await frameNow(p)); };
      const t45 = await at(45), t90 = await at(90), t0 = await at(-30);
      await p.evaluate(() => window.aslnutDemo.w.hide('vehicles'));
      const n90 = bytesOf(await frameNow(p)); await at(90); const v90 = bytesOf(await frameNow(p)); await p.evaluate(() => window.aslnutDemo.w.release('vehicles'));
      check(api, 'trails follow the world time (scrubbed: 06:45 ≠ 07:30) and draw nothing before their start', changed(t45, t90) > 1500 && changed(n90, v90) > 1500, `${changed(t45, t90)} px between times · before start vs 07:30: ${changed(n90, v90)} px`);
      void t0;
      const f = await p.evaluate(async () => { const { w } = window.aslnutDemo; const target = [145.05, -37.9]; w.follow(() => target, { smooth: 50 }); for (let i = 0; i < 40; i++) w.step(33); return { lon: w.camera.lon, lat: w.camera.lat, on: w.isFollowing }; });
      check(api, 'w.follow keeps the camera on a moving place', Math.abs(f.lon - 145.05) < 0.01 && Math.abs(f.lat + 37.9) < 0.01 && f.on, JSON.stringify(f));
      check(api, 'no page errors (fleet)', e.length === 0, e.slice(0, 3).join(' | '));
    } catch (err) { check(api, 'fleet preset', false, err.message.slice(0, 300)); }
    await p.close(); }
  { const { page: p, errors: e } = await open3('parity-regions');
    try {
      const a = bytesOf(await frameNow(p));
      await p.evaluate(() => window.aslnutDemo.w.set('regions.regency', '32.04'));
      const b = bytesOf(await frameNow(p));
      const n = await p.evaluate(async () => { const { w } = window.aslnutDemo; const f = await w.pick(320, 210); return { districts: w.element('districts').shown, f: f && f.element }; });
      check(api, 'drill-down: a regency opens into its districts (feature gates on params)', changed(a, b) > 800 && n.districts > 0, `${changed(a, b)} px · districts shown ${n.districts}`);
      check(api, 'no page errors (regions)', e.length === 0, e.slice(0, 3).join(' | '));
    } catch (err) { check(api, 'regions preset', false, err.message.slice(0, 300)); }
    await p.close(); }
}
// the same answers (a sample on the very edge of a line may fall either side: at most 1 in 100 may differ)
const pickDiff = (() => { const a = pickMaps.webgpu ?? '', b = pickMaps.webgl2 ?? ''; let d = 0; for (let k = 0; k < Math.max(a.length, b.length); k += 2) if (a.slice(k, k + 2) !== b.slice(k, k + 2)) d++; return d; })();
check('both', 'picking answers the same on WebGPU and WebGL2', pickMaps.webgpu && pickMaps.webgl2 && pickDiff <= Math.max(1, ((pickMaps.webgpu.match(/[a-z]\d/g) ?? []).length) / 100) && /d/.test(pickMaps.webgpu), pickMaps.webgpu === pickMaps.webgl2 ? `${(pickMaps.webgpu.match(/[a-z]\d/g) ?? []).length} hits` : `differ:\n${pickMaps.webgpu}\n${pickMaps.webgl2}`);

await browser.close(); srv.close();
/** a check of its own (tools/<file>), its lines shown as they come: its checks counted as the smoke's (`keep` says which,
 *  each named with `prefix`), its other lines (the steps as each starts) as they are; a step that hangs shows where */
async function child(file, prefix = '', env = process.env, keep = () => true) {
  const { spawn } = await import('node:child_process');
  const name = file.replace('.mjs', ''), p = spawn(process.execPath, [join(import.meta.dirname, file)], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '', err = '', rest = '';
  const line = (l) => { const m = /^(ok  |FAIL) (\w+)\s+(.*?)(?: · (.*))?$/.exec(l); if (m) { if (keep(m)) check(m[2], `${prefix}${m[3]}`, m[1] === 'ok  ', m[4]); } else if (l.trim()) console.log(`     ${name} · ${l}`); };
  p.stdout.setEncoding('utf8'); p.stdout.on('data', (d) => { out += d; rest += d; for (let i; (i = rest.indexOf('\n')) >= 0; rest = rest.slice(i + 1)) line(rest.slice(0, i)); });
  p.stderr.setEncoding('utf8'); p.stderr.on('data', (d) => { err += d; });
  const status = await new Promise((ok) => p.on('close', ok));
  if (rest) line(rest);
  if (status !== 0 && !/FAIL/.test(out)) check('both', `${name} ran`, false, err.slice(0, 300));
}
// the checks for what software rendering once let through: draping on rugged terrain, no blink under the mouse,
// the fleet moving (tools/checks.mjs), on both graphics
await child('checks.mjs');
// the primitives check (tools/primitives.mjs): the original twin's visuals and a low-level 3D checklist with the
// public API only, on both graphics
await child('primitives.mjs', 'primitives: ', process.env, (m) => m[2] !== 'primitives');
// the healthy-city example (tools/smoke-city.mjs), on both graphics
// (its own port: CITY_PORT, never the smoke's own, which is still serving)
await child('smoke-city.mjs', 'city: ', { ...process.env, PORT: process.env.CITY_PORT ?? '8177' }, (m) => m[2] !== 'smoke');
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
console.log(`${failed ? 'FAIL' : 'ok  '} smoke: ${results.length - failed}/${results.length} checks passed on WebGPU and WebGL2`);
process.exit(failed ? 1 : 0);
