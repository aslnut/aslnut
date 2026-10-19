// The healthy-city example's smoke test, on WebGPU AND WebGL2 (every check runs on both; a failure on either fails):
//   1. the region renders on the graphics asked for, the statistics are in (a value per council), no page errors
//   2. picking finds a council under its middle; tapping it drills down (its suburbs show)
//   3. another question recolours the map
//   node tools/smoke-city.mjs   (builds nothing: run `npm run examples` first; ASLNUT_DIST for another build)
//   (the whole run takes some 25 minutes on SwiftShader: give it that, or run it in the background; under a shorter
//   `timeout` it is stopped, its browser closed mid-check: "STOP stopped from outside", not a crash)
//   ONLY=fields,flood node tools/smoke-city.mjs   (some parts: region street access twin arcs theme weather heat fields flood scenarios trees authoring traffic clock avatars people budget ready controls rest library)
import { serve } from './serve.mjs';
import { launch, openDemo, settledFrame, bytesOf, browserGone } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

// (each part's name said as it starts, with the time: a part that hangs shows which)
const ONLY = process.env.ONLY ? process.env.ONLY.split(',') : null, want = (k) => { if (ONLY && !ONLY.includes(k)) return []; console.log(`step ${k} · ${new Date().toTimeString().slice(0, 8)}`); return ['webgpu', 'webgl2']; };
const PORT = Number(process.env.PORT ?? 8177), OUT = join(import.meta.dirname, '..', '.out', 'smoke-city');
mkdirSync(OUT, { recursive: true });
const base = `http://127.0.0.1:${PORT}/examples/healthy-city/`;
const srv = await serve(PORT), browser = await launch();
const results = []; let failed = 0;
const t0 = Date.now();
const check = (api, name, ok, detail) => { if (!ok && browserGone()) detail = `${detail ?? ''} · ${browserGone()}`; results.push({ api, name, ok: !!ok, detail }); if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${api.padEnd(6)} ${name}${detail ? ` · ${detail}` : ''}`); };
const changed = (a, b, tol = 24) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > tol) n++; return n; };

for (const api of want('region')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-region&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 480, height: 640 });
  try {
    const r = await settledFrame(page);
    const px = bytesOf(r);
    writeFileSync(join(OUT, `region-${api}.png`), png(r.width, r.height, px));
    let lit = 0; for (let i = 0; i < px.length; i += 4) if (px[i] + px[i + 1] + px[i + 2] > 30) lit++;
    check(api, 'the region renders on the graphics asked for', r.api === api && lit / (px.length / 4) > 0.9, `got ${r.api} · ${((100 * lit) / (px.length / 4)).toFixed(0)} % lit`);
    const st = await page.evaluate(() => { const s = window.aslnutDemo.stats.councils; return { n: s.size, valued: s.rows().filter((x) => x.value !== null).length, top: s.ranked()[0]?.name }; });
    check(api, 'statistics: a value per council (stats kit)', st.n > 30 && st.valued > 30, `${st.valued}/${st.n} councils · highest ${st.top}`);
    // pick the council under Monash's middle, tap it: its suburbs show
    const drill = await page.evaluate(async () => {
      const { w } = window.aslnutDemo, l = w.element('councils-stat'), f = l.entries.find((e) => e.d.props.name === 'Monash').d;
      let x = 0, y = 0, n = 0; for (const p of f.geometry.coordinates.flat(f.geometry.type === 'Polygon' ? 1 : 2)) { x += p[0]; y += p[1]; n++; }
      const xy = w.project([x / n, y / n]); const hit = await w.pick(xy[0], xy[1]);
      l.props.onTap(hit, w.state);
      await w.settled({ timeout: 60000 });
      return { hit: hit && `${hit.element}:${hit.props.name}`, suburbs: w.element('suburbs-stat').shown, crumbs: document.getElementById('crumbs').textContent };
    });
    check(api, 'picking finds the council under the point; a tap drills into its suburbs', drill.hit === 'councils-stat:Monash' && drill.suburbs > 0.99 && /Monash/.test(drill.crumbs), JSON.stringify(drill));
    const a = bytesOf(await settledFrame(page));
    await page.evaluate(async () => { document.getElementById('b-stats').click(); await new Promise((ok) => setTimeout(ok, 50)); document.querySelector('[data-c="population"]').click(); await window.aslnutDemo.w.settled({ timeout: 60000 }); });
    const b = bytesOf(await settledFrame(page));
    check(api, 'another question recolours the suburbs', changed(a, b) > 2000, `${changed(a, b)} px changed`);
    check(api, 'no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'healthy-city', false, e.message.slice(0, 300)); }
  await page.close();
}
// the street level: tiles built round the camera, the sun's shadows, a pick that says what it is and where from
for (const api of want('street')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 480, height: 640 });
  try {
    const r = await settledFrame(page);
    const a = bytesOf(r);
    writeFileSync(join(OUT, `street-${api}.png`), png(r.width, r.height, a));
    const st = await page.evaluate(() => { const { w } = window.aslnutDemo, l = w.element('streets'); return { counts: l.counts(), tiles: l.tileCounts(), sh: w.shadowReport(), light: !!w.light, sun: w.read('sky.sun') }; });
    check(api, 'the street level: tiles built round the camera (solids, instanced trees)', st.counts.chunks >= 4 && st.counts.instances > 1000 && st.tiles.loading === 0, JSON.stringify(st.counts));
    check(api, 'the sky lights the world; the sun casts shadows (shadow map drawn)', st.light && st.sh.on && st.sh.casters > 4, JSON.stringify({ sh: st.sh, sun: st.sun }));
    // shadows off: the frame changes where shadows were
    await page.evaluate(async () => { const { w } = window.aslnutDemo; w.setShadows(false); await w.settled({ timeout: 60000 }); });
    const b = bytesOf(await settledFrame(page));
    check(api, 'shadows show: turning them off changes the frame', changed(a, b) > 800, `${changed(a, b)} px changed`);
    await page.evaluate(async () => { const { w } = window.aslnutDemo; w.setShadows(true); await w.settled({ timeout: 60000 }); });
    // a pick over the frame finds street things that say what they are and where their data is from
    const p = await page.evaluate(async () => { const { w } = window.aslnutDemo, seen = {}; for (let y = 140; y < 640; y += 70) for (let x = 30; x < 480; x += 70) { const f = await w.pick(x, y); if (f && (f.element === 'streets' || f.element === 'roads')) { seen[f.d.kind] = (seen[f.d.kind] ?? 0) + 1; if (!f.props.source && f.d.kind !== 'pole') seen.nosource = (seen.nosource ?? 0) + 1; } } return seen; });
    check(api, 'picking finds roads, buildings and trees, each with its source', p.road > 0 && p.building > 0 && p.tree > 0 && !p.nosource, JSON.stringify(p));
    check(api, 'no page errors (street)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'street level', false, e.message.slice(0, 300)); }
  await page.close();
}
// park access: houses tinted by their walk to a park along the streets (aslnut's networks), the numbers
for (const api of want('access')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 480, height: 640 });
  try {
    const a = bytesOf(await settledFrame(page));
    const st = await page.evaluate(async () => { document.getElementById('b-layers').click(); await new Promise((ok) => setTimeout(ok, 50)); document.getElementById('t-access').click(); const { w } = window.aslnutDemo; await w.settled({ timeout: 60000 }); const t = document.getElementById('access').textContent; return { houses: Number((/Houses([\d,]+)/.exec(t)?.[1] ?? '0').replace(/,/g, '')), median: /Median([\d.]+ k?m)/.exec(t)?.[1], entrances: /entrances([\d,]+)/.exec(t)?.[1], routes: w.element('access-routes').size }; });
    const b = bytesOf(await settledFrame(page));
    writeFileSync(join(OUT, `access-${api}.png`), png(480, 640, b));
    check(api, 'park access: every house to its nearest park along the streets (multi-source shortest paths), tinted, drawn', st.houses > 1000 && st.routes > 500 && st.median && changed(a, b) > 20000, JSON.stringify({ ...st, changed: changed(a, b) }));
    check(api, 'no page errors (park access)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'park access', false, e.message.slice(0, 300)); }
  await page.close();
}
// the twin dashboard's interface (?ui=twin) on a phone: its bar, its dialogs as sheets from the bottom, park access from
// the bar as arcs (brighter at their top) over a darkened sky, the arcs' dashes running (frames only while they do)
for (const api of want('twin')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&ui=twin&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 390, height: 844 });
  try {
    const a = bytesOf(await settledFrame(page));
    const ui = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)), $ = (s) => document.querySelector(s);
      $('#b-stats').click(); await sleep(100); const r = $('#d-stats').getBoundingClientRect(), back = getComputedStyle($('#t-backdrop')).display;
      $('#t-backdrop').click(); await sleep(100);
      return { twin: document.body.classList.contains('twin'), bar: !!$('#b-home') && !!$('#b-access') && !!$('#b-settings'), sheet: Math.abs(r.bottom - innerHeight) < 2 && Math.abs(r.left) < 2 && Math.abs(r.width - innerWidth) < 2, rect: [r.left, r.top, r.width, r.bottom].map(Math.round), backdrop: back, closed: !$('#d-stats').classList.contains('open') };
    });
    check(api, 'twin interface: the bar, a dialog as a sheet from the bottom over a dimmed world, closed by a tap', ui.twin && ui.bar && ui.sheet && ui.backdrop === 'block' && ui.closed, JSON.stringify(ui));
    const st = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)), $ = (s) => document.querySelector(s), { w } = window.aslnutDemo;
      $('#b-access').click(); await sleep(50); $('#access [data-am="straight"]').click();
      await w.settled({ timeout: 60000 }); await sleep(1500); await w.settled({ timeout: 60000 });
      const arcs = w.element('access-arcs');
      return { on: $('#b-access').classList.contains('on'), analysis: !!w.state.user.toggles.analysis, theme: w.theme?.name ?? null, muting: w.themeNow?.amount ?? 0, arcs: arcs.size, hook: !!arcs.props.shader?.color, flowing: arcs.flowing() };
    });
    const b = bytesOf(await settledFrame(page));
    writeFileSync(join(OUT, `twin-arcs-${api}.png`), png(390, 844, b));
    check(api, 'twin interface: park access from the bar, arcs brighter at their top, the analysis view (the dark theme: the world and the sky darkened)', st.on && st.analysis && st.theme === 'dark' && st.muting === 1 && st.arcs > 500 && st.hook && !st.flowing && changed(a, b) > 20000, JSON.stringify({ ...st, changed: changed(a, b) }));
    const fl = await page.evaluate(async () => {
      const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)), $ = (s) => document.querySelector(s), { w } = window.aslnutDemo, arcs = w.element('access-arcs');
      // the arcs ask for frames themselves (other layers may ask for their own reasons: the water's waves), and frames come
      const frames = async () => { const f0 = w.report().frames; await sleep(1500); return arcs.animating(w.state) ? w.report().frames - f0 : 0; };
      await sleep(1500); const still = await frames();
      $('#access [data-flow]').click(); await sleep(300); const flowing = arcs.flowing(), running = await frames();
      $('#access [data-flow]').click(); await sleep(1500); const after = await frames();
      return { still, flowing, running, after, off: !arcs.flowing() };
    });
    check(api, 'twin interface: the arcs\' dashes run (frames keep coming for them), and stop (none)', fl.flowing && fl.running >= 2 && fl.off && fl.after === 0 && fl.still === 0, JSON.stringify(fl));
    check(api, 'no page errors (twin interface)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'twin interface', false, e.message.slice(0, 300)); }
  await page.close();
}
// the arcs as instances (core › geometry › marks › lines › arc): park access's arcs in the twin, each a record drawn as
// an instance of one strip (draws by size class, a few hundred KB, drawn over the world), a still view drawing nothing;
// a layer added to a world at rest shows without any input (its attach asks for a frame)
for (const api of want('arcs')) {
  // (the world's own clock, as a phone runs it: a fixed step would draw every frame)
  const { page, errors } = await openDemo(browser, `${base}?go=twin&ui=twin&graphics=${api}&quality=realistic&dpr=1&log=0`, { width: 390, height: 844 });
  try {
    const st = await page.evaluate(async () => {
      const { w } = window.aslnutDemo, sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)), arcs = w.element('access-arcs');
      await w.settled({ timeout: 420000 }).catch(() => {}); await sleep(1500);
      for (let i = 0; i < 240 && !w.telemetry().frames.resting; i++) await sleep(250);
      const t = w.telemetry(), L = t.elements.find((l) => l.id === 'access-arcs'), f0 = w.stats().drawn;
      await sleep(3000);
      return { arcs: arcs.readouts().arcs(), size: arcs.size, segments: arcs.readouts().segments(), draws: L?.draws ?? 0, MB: t.memory.find((m) => m.id === 'access-arcs')?.MB ?? 0, order: arcs.order, over: !!arcs.props.over, wants: L?.wants ?? -1, resting: t.frames.resting, still: w.stats().drawn - f0 };
    });
    check(api, 'arcs as instances: one record an arc (draws by size class, under 2 MB), drawn over the world (order 4.5), a still view draws nothing', st.arcs > 500 && st.arcs === st.size && st.segments > st.arcs * 7 && st.draws >= 1 && st.draws <= 8 && st.MB < 2 && st.order === 4.5 && st.over && st.wants === 0 && st.resting && st.still === 0, JSON.stringify(st));
    const a = bytesOf(await page.evaluate(async () => { const f = await window.aslnutDemo.w.frame(); let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768)); return { b64: btoa(bin) }; }));
    const late = await page.evaluate(async () => {
      const { w, lib } = window.aslnutDemo, sleep = (ms) => new Promise((ok) => setTimeout(ok, ms)), v = w.camera.view;
      // resting first (no frames asked for), then a layer added with nothing else happening
      for (let i = 0; i < 240 && !w.telemetry().frames.resting; i++) await sleep(250);
      const resting = w.telemetry().frames.resting, f0 = w.stats().drawn, kx = 111320 * Math.cos((v.lat * Math.PI) / 180);
      const rows = Array.from({ length: 24 }, (_, i) => ({ id: i, o: [v.lon - 150 / kx, v.lat + (i - 12) * 4 / 110574], d: [v.lon + 150 / kx, v.lat + (i - 12) * 4 / 110574] }));
      w.add(lib.arc({ id: 'late-arcs', data: rows, from: (d) => d.o, to: (d) => d.d, height: 40, width: 6, color: '#ff00ff', over: true }));
      // (no input: the world must draw it of its own accord; a slow chip takes a while to fade it in)
      const l = w.element('late-arcs'); for (let i = 0; i < 120 && l.shown < 0.99; i++) await sleep(250);
      await w.settled({ timeout: 60000 }).catch(() => {});
      const L = w.telemetry().elements.find((x) => x.id === 'late-arcs');
      return { resting, drawn: w.stats().drawn - f0, shown: l.shown, arcs: l.readouts().arcs(), draws: L?.draws ?? 0 };
    });
    // the same, deterministic: a layer of no programs (its attach settles at once, before the resting loop looks again)
    const probe = await page.evaluate(async () => {
      const { w } = window.aslnutDemo, sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
      for (let i = 0; i < 240 && !w.telemetry().frames.resting; i++) await sleep(250);
      let P = Object.getPrototypeOf(w.element('access-arcs')); while (P && P.constructor.name !== 'Element') P = Object.getPrototypeOf(P);
      class Probe extends P.constructor { kind = 'custom'; frames = 0; frame() { this.frames++; return []; } }
      const resting = w.telemetry().frames.resting, l = new Probe({ id: 'probe-layer' }); w.add(l);
      await sleep(2000);
      return { resting, frames: l.frames, shown: l.shown };
    });
    const b = bytesOf(await settledFrame(page));
    writeFileSync(join(OUT, `arcs-late-${api}.png`), png(390, 844, b));
    check(api, 'a layer whose attach settles at once, added to a resting world, is drawn (its target set) without any input', probe.resting && probe.frames > 0 && probe.shown > 0, JSON.stringify(probe));
    check(api, 'a layer added to a resting world shows without any input (its attach asks for a frame)', late.resting && late.drawn > 0 && late.shown > 0.99 && late.arcs === 24 && late.draws >= 1 && changed(a, b) > 200, JSON.stringify({ ...late, changed: changed(a, b) }));
    check(api, 'no page errors (arcs)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'arcs', false, e.message.slice(0, 300)); }
  await page.close();
}
// the analysis view (core › render › style › theme) on a phone: ?theme=grey greys the world (its colours gone); a
// building tapped is selected in the solids' selected colour (blue), kept under the theme (the selection is a subject);
// the theme off again: the world's colours back, the same draws
for (const api of want('theme')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&ui=twin&theme=grey&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 390, height: 844 });
  try {
    // how far the frame's pixels are from grey, on average (0: all grey)
    const chroma = (p) => { let s = 0; for (let i = 0; i < p.length; i += 4) s += Math.max(p[i], p[i + 1], p[i + 2]) - Math.min(p[i], p[i + 1], p[i + 2]); return s / (p.length / 4); };
    const a = bytesOf(await settledFrame(page));
    const st = await page.evaluate(() => { const { w } = window.aslnutDemo; return { theme: w.theme?.name ?? null, amount: w.themeNow?.amount ?? 0, draws: w.stats().draws }; });
    writeFileSync(join(OUT, `theme-grey-${api}.png`), png(390, 844, a));
    check(api, 'theme: the world grey, eased in (its colours gone)', st.theme === 'grey' && st.amount === 1 && chroma(a) < 8, JSON.stringify({ ...st, chroma: +chroma(a).toFixed(1) }));
    // a building near the middle tapped as a person would: selected, blue at that place under the grey theme
    const at = await page.evaluate(async () => {
      const { w } = window.aslnutDemo;
      for (let r = 0; r < 8; r++) for (let k = 0; k < Math.max(1, r * 8); k++) {
        const x = 195 + Math.cos((k / Math.max(1, r * 8)) * 2 * Math.PI) * r * 22, y = 520 + Math.sin((k / Math.max(1, r * 8)) * 2 * Math.PI) * r * 30;
        const f = await w.pick(x, y, { radius: 0 }); if (f?.element === 'streets' && f.d?.kind === 'building') return { x: Math.round(x), y: Math.round(y), id: f.id };
      }
      return null;
    });
    if (!at) throw new Error('no building near the middle');
    // (the tap picks first: its answer, and the selection, come a moment later)
    await page.mouse.click(at.x, at.y); await page.waitForFunction((id) => window.aslnutDemo.w.user.selection.includes(id), at.id, { timeout: 60000 }); await page.mouse.move(2, 2);
    const b = bytesOf(await settledFrame(page)), sel = await page.evaluate(() => window.aslnutDemo.w.user.selection);
    writeFileSync(join(OUT, `theme-selected-${api}.png`), png(390, 844, b));
    // blue within 12 px of the tap that was not blue before (a tap can land on the building's very edge)
    const blue = (p, i) => p[i + 2] > p[i] + 40;
    let turned = 0; for (let y = at.y - 12; y <= at.y + 12; y++) for (let x = at.x - 12; x <= at.x + 12; x++) { const i = (y * 390 + x) * 4; if (blue(b, i) && !blue(a, i)) turned++; }
    check(api, 'theme: a tapped building is selected in blue, kept under the grey theme', sel.includes(at.id) && turned >= 20, JSON.stringify({ ...at, sel, turned }));
    // off: eased out, the colours back, no theme drawn
    const off = await page.evaluate(async () => { const { w } = window.aslnutDemo; w.select([]); w.setTheme(null); await w.settled({ timeout: 60000 }); return { theme: w.theme, shown: w.themeNow, draws: w.stats().draws }; });
    const c = bytesOf(await settledFrame(page));
    check(api, 'theme: off again, the colours back (nothing of it drawn)', off.theme === null && off.shown === null && chroma(c) > chroma(a) + 8, JSON.stringify({ chroma: +chroma(c).toFixed(1), draws: [st.draws, off.draws] }));
    check(api, 'no page errors (theme)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'theme', false, e.message.slice(0, 300)); }
  await page.close();
}
// the weather: a preset greys the sky and thickens the air; rain falls round the eye
for (const api of want('weather')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 480, height: 640 });
  try {
    const a = bytesOf(await settledFrame(page));
    const st = await page.evaluate(async () => { const { w } = window.aslnutDemo, sky = w.element('sky'); sky.setWeather('rain', { seconds: 0 }); await w.settled({ timeout: 60000 }); return { rain: w.light.rain, vis: w.light.visibility, wet: w.light.wet, rainDrawn: w.stats().elements.find((l) => l.id === 'rain')?.shown }; });
    const b = bytesOf(await settledFrame(page));
    writeFileSync(join(OUT, `rain-${api}.png`), png(480, 640, b));
    check(api, 'weather: rain greys the sky, wets the ground, thickens the air, falls', st.rain > 0.5 && st.wet > 0.5 && st.vis < 40000 && changed(a, b) > 20000, JSON.stringify({ ...st, changed: changed(a, b) }));
    // the clouds' shadows: the same moment with and without them (partly cloudy, the sun up)
    await page.evaluate(async () => { const { w } = window.aslnutDemo, sky = w.element('sky'); sky.setWeather('partly', { seconds: 0 }); await w.settled({ timeout: 60000 }); });
    const c1 = bytesOf(await settledFrame(page));
    const shade = await page.evaluate(async () => { const { w } = window.aslnutDemo, sky = w.element('sky'); const had = w.light.clouds; sky.props = { ...sky.props, clouds: { shadows: false } }; w.invalidate(); await w.settled({ timeout: 60000 }); return { had: !!had, now: !!w.light.clouds }; });
    const c2 = bytesOf(await settledFrame(page));
    check(api, 'clouds: their shadows on the ground (the same picture without them differs), none when turned off', shade.had && !shade.now && changed(c1, c2) > 3000, JSON.stringify({ ...shade, changed: changed(c1, c2) }));
    // weather from observations: the nearest stations' numbers read where the view is, eased in
    const fd = await page.evaluate(async () => {
      const { w } = window.aslnutDemo, sky = w.element('sky'), c = w.camera;
      const pt = (dx, props) => ({ geometry: { type: 'Point', coordinates: [c.lon + dx, c.lat] }, props });
      sky.feed({ data: () => [pt(0.01, { wind: 14, rain: 12, vis: 800, cover: 95 }), pt(0.5, { wind: 2, rain: 0, vis: 40000, cover: 0 })], wind: 'wind', rain: 'rain', visibility: 'vis', cover: 'cover', every: 0.05, seconds: 0 });
      for (let i = 0; i < 6; i++) w.step(100);
      await w.settled({ timeout: 60000 });
      const l = w.light, out = { name: sky.weatherName, rain: l.rain, wind: l.wind, vis: l.visibility, cover: l.cover };
      sky.feed(null); return out;
    });
    check(api, 'weather from a feed: rain, wind, visibility and cover from the nearest stations', fd.name === 'feed' && fd.rain > 0.9 && fd.wind > 12 && fd.wind < 14.5 && fd.vis < 5000 && fd.cover > 0.9, JSON.stringify(fd));
    check(api, 'no page errors (weather)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'weather', false, e.message.slice(0, 300)); }
  await page.close();
}
// the heat lab on the real streets: the field drawn, a person's numbers, a change (street trees) cools the streets
for (const api of want('heat')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 480, height: 640 });
  try {
    const a = bytesOf(await settledFrame(page));
    const st = await page.evaluate(async () => {
      const { w, heat } = window.aslnutDemo; heat.day = { hours: [], source: 'smoke: no network' };
      await heat.setEnabled(true); await w.settled({ timeout: 60000 });
      await heat.setChanges({ streetTrees: true }, true); const base = heat.base;
      return { utci: base?.utci, air: base?.air, shaded: base?.shaded, points: base?.points, trees: heat.variant ? heat.variant.utci - heat.base.utci : null, drawn: w.stats().elements.find((l) => l.id === 'heat-field')?.shown };
    });
    const b = bytesOf(await settledFrame(page));
    writeFileSync(join(OUT, `heat-${api}.png`), png(480, 640, b));
    check(api, 'heat: the field (UTCI at 1.1 m) over the real streets, drawn; street trees cool them', st.points > 5000 && st.utci > 30 && st.utci < 60 && st.trees < -0.05 && changed(a, b) > 20000, JSON.stringify({ ...st, changed: changed(a, b) }));
    check(api, 'no page errors (heat)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'heat', false, e.message.slice(0, 300)); }
  await page.close();
}
// fields: each ready rule and a kernel stepped on the chip (a float target) and on the CPU agree; storm water over the
// streets (shallow water on the terrain with the buildings, rain from the sky) fills the low places and is drawn
for (const api of want('fields')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 480, height: 640 });
  try {
    await settledFrame(page);
    const st = await page.evaluate(async () => {
      const { w, lib } = window.aslnutDemo, area = { centre: [w.camera.lon, w.camera.lat], size: 200 }, out = {};
      const spike = (lon, lat) => (Math.hypot(lon - area.centre[0], lat - area.centre[1]) < 0.0003 ? 10 : 0);
      const cases = { diffusion: [lib.rules.diffusion({ k: 3 }), {}, spike], advection: [lib.rules.advection({ wind: [0.6, 0.4] }), {}, spike], heat: [lib.rules.heat({ k: 1, relax: 0.002, to: 5 }), { source: 0.5 }, spike], water: [lib.rules.shallowWater({ friction: 0.3, rain: 2e-5, openEdges: true }), { ground: 'terrain' }, (lon) => (lon < area.centre[0] ? 0.3 : 0)], kernel: [lib.kernel({ wgsl: 'next = cur + dt * k * laplacian(cur);', params: { k: 2 }, cpu: (c, n, dt, p) => c + dt * p.k * n.laplacian }), {}, spike] };
      for (const [name, [rule, inputs, init]] of Object.entries(cases)) {
        const a = lib.field({ id: `${name}-g`, res: 5, area, rule, inputs, init, draw: false }), b = lib.field({ id: `${name}-c`, res: 5, area, rule, inputs, init, gpu: false, draw: false });
        w.add(a, b);
        for (let t = 0; t < 100 && a.runsOn !== 'gpu'; t++) await new Promise((ok) => setTimeout(ok, 100));
        a.step(40); b.step(40); await a.sync();
        const va = a.values(), vb = b.values(); let d = 0, m = 0; for (let k = 0; k < va.length; k++) { d = Math.max(d, Math.abs(va[k] - vb[k])); m = Math.max(m, Math.abs(vb[k])); }
        out[name] = { on: a.runsOn, diff: d / Math.max(1e-9, m) };
        w.remove(a.id); w.remove(b.id);
      }
      return out;
    });
    const bad = Object.entries(st).filter(([, v]) => v.on !== 'gpu' || !(v.diff < 1e-3));
    check(api, 'fields: diffusion, advection, heat, shallow water and a kernel step on the chip as on the CPU', bad.length === 0, JSON.stringify(st));
    check(api, 'no page errors (fields)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'fields', false, e.message.slice(0, 300)); }
  await page.close();
}
for (const api of want('flood')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 480, height: 640 });
  try {
    const a = bytesOf(await settledFrame(page));
    const st = await page.evaluate(async () => {
      const { w, flood } = window.aslnutDemo;
      document.getElementById('b-layers').click(); await new Promise((ok) => setTimeout(ok, 50)); document.getElementById('t-flood').click();
      for (let t = 0; t < 600 && flood.water?.runsOn !== 'gpu'; t++) await new Promise((ok) => setTimeout(ok, 100));
      flood.water.pause(); flood.water.step(400); await flood.water.sync(); await new Promise((ok) => setTimeout(ok, 700));
      await w.settled({ timeout: 60000 });
      return { on: flood.water.runsOn, ...flood.stats, panel: document.getElementById('flood').textContent.slice(0, 60) };
    });
    const b = bytesOf(await settledFrame(page));
    writeFileSync(join(OUT, `flood-${api}.png`), png(480, 640, b));
    // the water's own pixels: the same moment with the field hidden
    await page.evaluate(async () => { const { w, flood } = window.aslnutDemo; flood.water.setProps({ when: false }); await w.settled({ timeout: 60000 }); });
    const c = bytesOf(await settledFrame(page)); void a;
    check(api, 'storm water: shallow water over the streets fills the low places, probed, drawn as a surface', st.on === 'gpu' && st.low > 0.003 && st.wetShare > 0.05 && changed(b, c) > 150, JSON.stringify({ ...st, water: changed(b, c) }));
    check(api, 'no page errors (storm water)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'storm water', false, e.message.slice(0, 300)); }
  await page.close();
}
// scenarios side by side on one canvas: a field's rule swapped by a scenario, split down the middle, then swiped
for (const api of want('scenarios')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 480, height: 640 });
  try {
    await settledFrame(page);
    const st = await page.evaluate(async () => {
      const { w, lib } = window.aslnutDemo, centre = [w.camera.lon, w.camera.lat];
      const water = (rain) => lib.rules.shallowWater({ rain, openEdges: true, friction: 0.3 });
      const f = lib.field({ id: 'sc-water', res: 4, area: { centre, size: 360 }, rule: water(2e-5), inputs: { ground: 'terrain' }, init: 0, draw: { on: 'surface', ramp: ['#bfdbfe', '#1d4ed8'], domain: [0, 0.03], min: 0.0005, opacity: 0.95 } });
      w.add(f);
      for (let t = 0; t < 600 && f.runsOn !== 'gpu'; t++) await new Promise((ok) => setTimeout(ok, 100));
      w.scenario('downpour', { rules: { 'sc-water': { rule: water(4e-4) } } });
      w.scenario.compare('base', 'downpour', { view: 'split' });
      const twin = w.element('sc-water--downpour');
      for (let t = 0; t < 600 && twin.runsOn !== 'gpu'; t++) await new Promise((ok) => setTimeout(ok, 100));
      f.step(120); twin.step(120); await f.sync(); await twin.sync();
      await w.settled({ timeout: 60000 });
      return { on: [f.runsOn, twin.runsOn], depth: [Math.max(...f.values()), Math.max(...twin.values())], comparing: w.scenario.comparing };
    });
    const grab = async (code) => bytesOf(await page.evaluate(async (code) => { const { w } = window.aslnutDemo; await (new Function('w', `return (async () => { ${code} })()`))(w); await w.settled({ timeout: 60000 }); const fr = await w.frame(); let bin = ''; for (let i = 0; i < fr.pixels.length; i += 32768) bin += String.fromCharCode(...fr.pixels.subarray(i, i + 32768)); return { b64: btoa(bin), width: fr.width, height: fr.height }; }, code));
    const half = (px, x0, x1) => { const out = []; for (let y = 0; y < 640; y++) for (let x = Math.round(x0 * 480); x < Math.round(x1 * 480); x++) { const k = (y * 480 + x) * 4; out.push(px[k], px[k + 1], px[k + 2], 255); } return out; };
    const split = await grab('');
    writeFileSync(join(OUT, `scenario-split-${api}.png`), png(480, 640, split));
    const swiped = await grab('w.scenario.setSplit(0.25);');
    const one = await grab('w.scenario.compare(null);');
    const L = changed(half(split, 0, 0.5), half(one, 0, 0.5)), R = changed(half(split, 0.5, 1), half(one, 0.5, 1)), S = changed(half(swiped, 0.25, 0.5), half(split, 0.25, 0.5));
    check(api, 'scenarios: compare side by side (a field under another rule on the right half), swipe, back to one picture', st.on.every((x) => x === 'gpu') && st.depth[1] > st.depth[0] * 3 && L < 300 && R > 1500 && S > 500, JSON.stringify({ ...st, leftChanged: L, rightChanged: R, swipeChanged: S }));
    check(api, 'no page errors (scenarios)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'scenarios', false, e.message.slice(0, 300)); }
  await page.close();
}
// trees grown from species (procedural branching, leaf cards, impostors far away), as the street level draws them and
// as a layer of your own (points and a planted area)
for (const api of want('trees')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 480, height: 640 });
  try {
    const a = bytesOf(await settledFrame(page));
    const st = await page.evaluate(async () => {
      const { w, street } = window.aslnutDemo, s = w.element('streets');
      const baked = [...s.imps.values()].map((x) => !!x.baked);
      const c = [w.camera.lon, w.camera.lat], d = 0.0012;
      const v = window.aslnutDemo.lib.vegetation({ id: 'planted', data: [{ type: 'Feature', id: 'park', properties: { height: 12 }, geometry: { type: 'Polygon', coordinates: [[[c[0] - d, c[1] - d], [c[0] + d, c[1] - d], [c[0] + d, c[1] + d], [c[0] - d, c[1] + d], [c[0] - d, c[1] - d]]] } }], density: () => 120, species: () => 'eucalypt', look: window.aslnutDemo.lib.trees });
      w.add(v); await w.settled({ timeout: 60000 });
      return { streetTrees: s.counts().instances, impostors: baked, planted: v.counts(), plantedImps: [...v.imps.values()].map((x) => !!x.baked) };
    });
    const b = bytesOf(await settledFrame(page));
    writeFileSync(join(OUT, `trees-${api}.png`), png(480, 640, b));
    check(api, 'trees: grown from species with leaf cards, impostors baked; a planted area of your own drawn', st.streetTrees > 1000 && st.impostors.length >= 6 && st.impostors.every(Boolean) && st.planted.instances > 50 && st.plantedImps.every(Boolean) && changed(a, b) > 1500, JSON.stringify({ ...st, changed: changed(a, b) }));
    check(api, 'no page errors (trees)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'trees', false, e.message.slice(0, 300)); }
  await page.close();
}
// authoring: the example's own houses (a shape of eras, built on every footprint in workers), its bins (a shape placed
// by rules on bin night), and a shape previewed on a canvas of its own (its levels side by side)
for (const api of want('authoring')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 480, height: 640 });
  try {
    await settledFrame(page);
    const st = await page.evaluate(async (api) => {
      const { w, street, lib } = window.aslnutDemo;
      const lane = lib.tileLane.size, check = lib.house.check({ footprint: [[-6, -8], [6, -8], [6, 8], [-6, 8]], height: 4.5, front: [0, 1], seed: 3, props: {} });
      w.setTime(new Date('2026-10-18T07:30:00Z')); await w.settled({ timeout: 60000 });
      // (the furniture is placed 400 ms after the street level's last tile: a fast chip settles before that)
      for (let i = 0; i < 50 && !window.aslnutDemo.furn.places.list().length; i++) await new Promise((ok) => setTimeout(ok, 100));
      await w.settled({ timeout: 60000 });
      const bins = w.element('bins').counts(), furn = window.aslnutDemo.furn, things = furn.places.list().filter((e) => e.kind === 'bench'), inPark = things.filter((e) => e.in).length / Math.max(1, things.length);
      const holder = document.createElement('div'); Object.assign(holder.style, { position: 'fixed', left: '0', top: '0', width: '240px', height: '160px', zIndex: '50' });
      const canvas = document.createElement('canvas'); canvas.style.width = '240px'; canvas.style.height = '160px'; holder.appendChild(canvas); document.body.appendChild(holder);
      const p = await lib.preview(lib.house, { canvas, graphics: api, params: { footprint: [[-6, -8], [6, -8], [6, 8], [-6, 8]], height: 4.5, front: [0, 1], seed: 3, props: {}, era: 'victorian' } });
      await p.world.settled({ timeout: 60000 }); const fr = await p.world.frame(); let lit = 0; for (let i = 0; i < fr.pixels.length; i += 4) if (fr.pixels[i] + fr.pixels[i + 1] + fr.pixels[i + 2] > 40) lit++;
      const out = { benches: things.length, inPark: +inPark.toFixed(2), lane, check: { ok: check.ok, problems: check.problems.slice(0, 2), triangles: check.triangles }, bins, held: street.counts().vertices, preview: { api: p.world.api, lit: +(lit / (fr.pixels.length / 4)).toFixed(3), triangles: p.triangles } };
      p.dispose(); holder.remove();
      return out;
    }, api);
    check(api, 'authoring: houses by era built in workers, bins out on bin night, benches placed in their parks (places and things), a shape previewed by its levels', st.lane > 0 && st.benches > 10 && st.inPark > 0.8 && st.check.ok && st.bins.instances > 500 && st.preview.api === api && st.preview.lit > 0.02 && st.preview.triangles[0] > st.preview.triangles[1], JSON.stringify(st));
    check(api, 'no page errors (authoring)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'authoring', false, e.message.slice(0, 300)); }
  await page.close();
}
// a manual clock: nothing draws by itself; each w.step(ms) advances the world (a playing field with it) and draws a frame
for (const api of want('clock')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-region&graphics=${api}&quality=realistic&dpr=1&clock=manual&log=0`, { width: 480, height: 640 });
  try {
    const st = await page.evaluate(async () => {
      for (let t = 0; t < 600 && !window.aslnutDemo?.w; t++) await new Promise((ok) => setTimeout(ok, 100));
      const { w, lib } = window.aslnutDemo, r = w.renderer, f0 = r.frames;
      await new Promise((ok) => setTimeout(ok, 1000));
      const still = r.frames - f0;
      const f = lib.field({ id: 'clocked', res: 10, area: { centre: [w.camera.lon, w.camera.lat], size: 200 }, rule: lib.rules.diffusion({ k: 1 }), init: 1, rate: 10, gpu: false, draw: false });
      w.add(f); for (let t = 0; t < 100 && !f.attached; t++) await new Promise((ok) => setTimeout(ok, 50));
      const t0 = f.time, f1 = r.frames;
      for (let i = 0; i < 10; i++) w.step(100);
      return { still, stepped: r.frames - f1, fieldSeconds: +(f.time - t0).toFixed(6), running: r.isRunning };
    });
    check(api, 'a manual clock: still until stepped; ten steps of 100 ms draw ten frames and play a field 10 s (rate 10)', st.still === 0 && st.stepped === 10 && Math.abs(st.fieldSeconds - 10) < 1e-6 && !st.running, JSON.stringify(st));
    check(api, 'no page errors (manual clock)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'manual clock', false, e.message.slice(0, 300)); }
  await page.close();
}
// moving things: cars of the neighbourhood (entities on wheels, a script's drive along routes on the street network)
for (const api of want('traffic')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 480, height: 640 });
  try {
    await settledFrame(page);
    const st = await page.evaluate(async () => {
      const { w, cars } = window.aslnutDemo;
      document.getElementById('b-layers').click(); await new Promise((ok) => setTimeout(ok, 50)); document.getElementById('t-traffic').click();
      await new Promise((ok) => setTimeout(ok, 300));
      const at0 = cars.cars.map((c) => [...c.at]);
      // steps of 100 ms; a frame read back every ten (a software chip queues frames: let it catch up)
      for (let i = 0; i < 50; i++) { w.step(100); if (i % 10 === 9) await w.frame(); }
      const moved = cars.cars.map((c, i) => Math.hypot((c.at[0] - at0[i][0]) * 88000, (c.at[1] - at0[i][1]) * 110574));
      const drawn = w.element('traffic').counts();
      // walk up to a car and get in; get out again: it is left parked
      const { av } = window.aslnutDemo, car0 = cars.cars[0];
      av.setMode('walk'); av.me.at = [car0.at[0], car0.at[1], NaN];
      const got = av.enterOrExit(), inCar = { mode: av.mode, riding: av.riding?.id, left: cars.cars.length };
      for (let i = 0; i < 5; i++) { w.step(100); }
      const out = av.enterOrExit(), after = { mode: av.mode, parked: cars.cars.some((c) => c.id === inCar.riding && !c.drive), n: cars.cars.length };
      av.setMode('map');
      const enter = { got, inCar, out, after };
      return { enter, n0: at0.length, n: cars.cars.length, kinds: [...new Set(cars.cars.map((c) => `${c.kind}/${c.locomotion.kind}/${c.drive?.kind}`))], movedMedian: moved.sort((a, b) => a - b)[Math.floor(moved.length / 2)], drawn };
    });
    check(api, 'moving things: cars on wheels driven by a script along the streets (the example\'s own car shape); walk up to one, drive it, leave it parked', st.n0 >= 4 && st.movedMedian > 10 && st.drawn.instances === st.n0 && st.kinds.includes('car/surface/script') && st.enter.got && st.enter.inCar.mode === 'car' && st.enter.inCar.left === st.n0 - 1 && st.enter.out && st.enter.after.mode === 'walk' && st.enter.after.parked && st.enter.after.n === st.n0, JSON.stringify(st));
    check(api, 'no page errors (traffic)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'traffic', false, e.message.slice(0, 300)); }
  await page.close();
}
// walk, drive, fly: an avatar on the ground, moved by the keys, the camera behind it
for (const api of want('avatars')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 480, height: 640 });
  try {
    const a = bytesOf(await settledFrame(page));
    const st = await page.evaluate(async () => {
      const { w, av } = window.aslnutDemo, key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
      av.setMode('walk'); await w.settled({ timeout: 60000 });
      const c0 = [w.camera.lon, w.camera.lat];
      key('keydown', 'KeyW'); for (let i = 0; i < 20; i++) { w.step(100); if (i % 10 === 9) await w.frame(); } key('keyup', 'KeyW'); await w.settled({ timeout: 60000 });
      const moved = Math.hypot((w.camera.lon - c0[0]) * 88000, (w.camera.lat - c0[1]) * 111000);
      const walk = { mode: av.mode, moved, near: w.camera.dist < 40, drawn: w.stats().elements.find((l) => l.id === 'avatar')?.shown };
      const entity = { kind: av.me.kind, locomotion: av.me.locomotion.kind, drive: av.me.drive?.kind };
      av.setCamera('first-person'); w.step(50); await w.settled({ timeout: 60000 });
      const eyes = { view: av.view, tilt: Math.round(w.camera.view.tilt), drawn: w.element('avatar').counts().instances + (w.element('avatar').bodyCounts?.().instances ?? 0) };
      av.setCamera('follow'); w.step(50); await w.settled({ timeout: 60000 }); eyes.back = w.element('avatar').counts().instances + (w.element('avatar').bodyCounts?.().instances ?? 0);
      av.setMode('drone'); await w.settled({ timeout: 60000 }); const drone = { mode: av.mode, tilt: Math.round(w.camera.view.tilt), locomotion: av.me.locomotion.kind };
      av.setMode('map'); await w.settled({ timeout: 60000 });
      return { walk, entity, eyes, drone, back: av.mode };
    });
    const b = bytesOf(await settledFrame(page));
    check(api, 'avatars: walk (the keys move it, the camera follows close behind), first person, drone, back to the map', st.walk.mode === 'walk' && st.eyes.view === 'first-person' && st.eyes.tilt >= 79 && !st.eyes.drawn && st.eyes.back > 0 && st.walk.moved > 0.2 && st.walk.near && st.walk.drawn > 0 && st.drone.mode === 'drone' && st.back === 'map' && st.entity.kind === 'person' && st.entity.locomotion === 'surface' && st.entity.drive === 'player' && st.drone.locomotion === 'air', JSON.stringify({ ...st, changed: changed(a, b) }));
    check(api, 'no page errors (avatars)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'avatars', false, e.message.slice(0, 300)); }
  await page.close();
}
// people: the person walked as (a ready-made one, skinned), a light crowd on the footpaths (seeded figures, each person
// their own colours and pace), the plain walker when asked for
for (const api of want('people')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0&person=grandfather&people=16`, { width: 480, height: 640 });
  try {
    await settledFrame(page);
    const st = await page.evaluate(async () => {
      const { w, av, people } = window.aslnutDemo, c = people.crowd, key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
      w.go({ lon: 145.1203, lat: -37.9238, zoom: 20.6, tilt: 70, bearing: 330 }); await w.settled({ timeout: 60000 });
      const t0 = performance.now(); while (c.figures().made < c.figures().wanted && performance.now() - t0 < 60000) { w.step(33); await w.frame(); }
      const at0 = c.people.map((e) => [e.at[0], e.at[1]]);
      for (let i = 0; i < 40; i++) w.step(50);
      await w.settled({ timeout: 60000 });
      const moved = c.people.map((e, i) => Math.hypot((e.at[0] - at0[i][0]) * 88000, (e.at[1] - at0[i][1]) * 110574)).sort((a, b) => a - b);
      const l = w.element('people'), crowd = { n: c.people.length, figures: c.figures(), skinned: l.bodyCounts().instances, far: l.counts().instances, movedMedian: moved[Math.floor(moved.length / 2)], skins: new Set(c.persons.map((p) => p.skin)).size, ages: [...new Set(c.persons.map((p) => p.age))].sort() };
      av.setMode('walk'); await w.settled({ timeout: 60000 });
      key('keydown', 'KeyW'); for (let i = 0; i < 20; i++) { w.step(100); if (i % 10 === 9) await w.frame(); } key('keyup', 'KeyW'); await w.settled({ timeout: 60000 });
      const walk = { skinned: w.element('avatar').bodyCounts().instances, walked: av.me.walked };
      const pick = document.getElementById('person'); pick.value = 'walker'; pick.dispatchEvent(new Event('change')); await new Promise((ok) => setTimeout(ok, 50)); w.step(50); await w.settled({ timeout: 60000 });
      const plain = { skinned: w.element('avatar').bodyCounts().instances, made: w.element('avatar').counts().instances };
      av.setMode('map'); await w.settled({ timeout: 60000 });
      return { crowd, walk, plain };
    });
    const c = st.crowd;
    check(api, 'people: a light crowd walks the footpaths (seeded figures shared, near ones skinned, far ones plain), diverse', c.n === 16 && c.figures.made === c.figures.wanted && c.figures.wanted >= 4 && c.skinned + c.far === c.n && c.movedMedian > 1 && c.skins >= 6 && c.ages.length >= 3, JSON.stringify(c));
    check(api, 'people: you walk as a ready-made person (skinned, its gait by the ground walked); the plain walker when chosen', st.walk.skinned === 1 && st.walk.walked > 1 && st.plain.skinned === 0 && st.plain.made === 1, JSON.stringify({ walk: st.walk, plain: st.plain }));
    check(api, 'no page errors (people)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'people', false, e.message.slice(0, 300)); }
  await page.close();
}
for (const api of want('controls')) {
  // the map's hands as the app allows them (pan only, a zoom range; then orbit again), an entity driven through
  // w.control, and the credits on screen
  const { page, errors } = await openDemo(browser, `${base}?go=region&graphics=${api}&log=0`, { width: 480, height: 640 });
  try {
    await page.evaluate(async () => { await window.aslnutDemo.w.settled({ timeout: 90000 }); });
    const box = await page.locator('canvas').first().boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    const turnDrag = async () => { await page.mouse.move(cx, cy); await page.mouse.down({ button: 'right' }); for (let i = 1; i <= 6; i++) await page.mouse.move(cx + i * 20, cy + i * 8); await page.mouse.up({ button: 'right' }); await page.waitForTimeout(300); };
    const view = () => page.evaluate(() => { const v = window.aslnutDemo.w.camera.view; return { bearing: v.bearing, tilt: v.tilt, zoom: window.aslnutDemo.w.camera.zoom }; });
    await page.evaluate(() => { const { w, lib } = window.aslnutDemo; w.control(null, lib.controllers.pan({ zoomRange: [8, 12] })); });
    const a0 = await view(); await turnDrag(); const a1 = await view();
    await page.mouse.move(cx, cy); for (let i = 0; i < 8; i++) { await page.mouse.wheel(0, 1500); await page.waitForTimeout(60); }
    await page.waitForTimeout(1200); const a2 = await view();
    const far = await page.evaluate(() => { const { w } = window.aslnutDemo, v = w.camera.view; w.go({ lon: v.lon, lat: v.lat, zoom: 3, tilt: v.tilt, bearing: v.bearing }); w.step(16); const z = w.camera.zoom; w.go({ lon: v.lon, lat: v.lat, zoom: 8.7, tilt: v.tilt, bearing: v.bearing }); return z; });
    await page.evaluate(() => { const { w, lib } = window.aslnutDemo; w.control(null, lib.controllers.orbit()); });
    await turnDrag(); const a3 = await view();
    const ent = await page.evaluate(() => {
      const { w, av, lib } = window.aslnutDemo; let threw = '';
      try { w.control({ id: 'loose' }, lib.controllers.walk()); } catch (e) { threw = e.code; }
      av.setMode('walk'); av.stop?.(); w.control(av.me, lib.controllers.walk()); const driven = av.me.drive?.kind;
      w.control(null); av.setMode('map');
      return { threw, driven, credits: document.querySelector('.aslnut-credits')?.textContent ?? '' };
    });
    const st = { a0, a1, a2, far, a3, ent };
    check(api, 'controls: pan only keeps the bearing, the zoom stays in its range, orbit turns again; w.control drives an entity; credits on screen', Math.abs(a1.bearing - a0.bearing) < 0.01 && Math.abs(a1.tilt - a0.tilt) < 0.01 && a2.zoom > 7.95 && a2.zoom < a0.zoom && far > 7.95 && far < 8.05 && Math.abs(a3.bearing - a2.bearing) > 1 && ent.threw === 'E-WORLD-005' && ent.driven === 'player' && /build \d+/.test(ent.credits), JSON.stringify(st));
    check(api, 'no page errors (controls)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'controls', false, e.message.slice(0, 300)); }
  await page.close();
}
for (const api of want('ready')) {
  // ahead of need: a view a few km away loads while the camera stays still (between frames), then is reached settled
  const { page, errors } = await openDemo(browser, `${base}?go=street&graphics=${api}&log=0`, { width: 480, height: 640 });
  try {
    const st = await page.evaluate(async () => {
      const { w } = window.aslnutDemo; await w.settled({ timeout: 90000 });
      // the street's still view keeps drawing (its clock runs): its own frames a second, so the prefetch is judged by
      // what it adds (on a chip some 60, on SwiftShader 2 or 3)
      const idle0 = w.stats().drawn; await new Promise((ok) => setTimeout(ok, 1000)); const idlePerS = w.stats().drawn - idle0;
      const c = w.camera.view, v = { lon: c.lon + 0.03, lat: c.lat - 0.01, zoom: 15, tilt: 45, bearing: 330 };
      const plan = w.ready.plan([v]).needed.length;
      const drawn0 = w.stats().drawn, t0 = performance.now();
      const pre = await w.prefetch([v], { timeout: 60000 });
      const ms = Math.round(performance.now() - t0), drawnWhile = w.stats().drawn - drawn0;
      const cov = await w.ready.coverage([v]);
      const reh = await w.ready.rehearse([v], { timeout: 60000 });
      const back = Math.hypot(w.camera.view.lon - c.lon, w.camera.view.lat - c.lat) < 1e-9;
      return { plan, pre, ms, drawnWhile, idlePerS, cov: { needed: cov.needed, have: cov.have }, reh: reh.map((r) => ({ settled: r.settled, ms: r.ms })), back };
    });
    check(api, 'ready: a view ahead planned and loaded while the camera stays still, reached settled, the camera put back', st.plan > 0 && st.pre.needed > 0 && st.pre.have >= st.pre.needed && st.drawnWhile < Math.max(st.ms / 100, (1.5 * st.idlePerS * st.ms) / 1000 + 2) && st.cov.needed > 0 && st.reh[0]?.settled && st.back, JSON.stringify(st));
    check(api, 'no page errors (ready)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'ready', false, e.message.slice(0, 300)); }
  await page.close();
}
for (const api of want('budget')) {
  // a budget no frame can keep: the governor steps down rung by rung while the view moves, and gives it all back
  // when the budget is taken away (a real clock: the display's frames are its samples)
  // (and the phone log on: the world's remote log sends its heartbeat and the governor's steps)
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&log=/api/log`, { width: 480, height: 640 });
  const lines = [];
  await page.route('**/api/log', (r) => { for (const l of (r.request().postData() ?? '').split('\n')) { try { lines.push(JSON.parse(l)); } catch { /* not a line */ } } return r.fulfill({ status: 204 }); });
  try {
    const st = await page.evaluate(async () => {
      const { w } = window.aslnutDemo; await w.settled({ timeout: 90000 });
      const before = { shadows: w.shadowReport().size, detail: w.state.render.detail, quality: w.state.render.quality };
      const steps = []; const off = w.on('governor', (e) => steps.push(e.step + ' ' + e.dropped.join(',')));
      w.setBudget({ frameMs: 0.5 });
      const c = w.camera.view;
      for (let i = 0; i < 6 && steps.length < 4; i++) await w.fly({ lon: c.lon + (i % 2 ? 0 : 0.0006), lat: c.lat, zoom: 17.5, tilt: 60, bearing: c.bearing + 20 * (i + 1) }, { seconds: 1.2 });
      await w.settled({ timeout: 90000 });
      const during = { dropped: w.governor?.dropped ?? [], shadows: w.shadowReport(), detail: w.state.render.detail, quality: w.state.render.quality };
      w.setBudget(null); await w.settled({ timeout: 90000 });
      const after = { gov: w.governor, shadows: w.shadowReport().size, detail: w.state.render.detail, quality: w.state.render.quality };
      off?.();
      return { before, steps, during: { ...during, shadows: { on: during.shadows.on, size: during.shadows.size } }, after };
    });
    check(api, 'budget: the governor steps detail down while frames go over, gives it back with no budget', st.steps.length >= 2 && st.during.dropped.length >= 2 && (st.during.shadows.size < st.before.shadows || !st.during.shadows.on) && st.after.gov === null && st.after.detail === 1 && st.after.shadows === st.before.shadows && st.after.quality === st.before.quality, JSON.stringify(st));
    await page.waitForTimeout(2500);
    const evs = [...new Set(lines.map((l) => l.ev))], gov = lines.find((l) => l.ev === 'governor'), hb = lines.find((l) => l.ev === 'hb');
    // (the page's log is on by its &log=, whatever the build's ASLNUT_EXAMPLES_LOG: off here, the build is older)
    const logTo = await page.evaluate(() => window.aslnutDemo.log ?? null);
    check(api, 'remote log: the heartbeat and the governor\'s steps reach the endpoint, with the page\'s fields', logTo === '/api/log' && !!gov && !!hb && gov.page === 'aslnut-city' && typeof hb.fps === 'number' && gov.dropped?.length > 0, logTo !== '/api/log' ? `the page's log goes to ${JSON.stringify(logTo)}, not its &log=/api/log (a build older than the runtime switch? rebuild it)` : JSON.stringify({ evs, gov, hb }).slice(0, 600));
    check(api, 'no page errors (budget)', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'budget', false, e.message.slice(0, 300)); }
  await page.close();
}
// draw on demand: a settled, still view draws nothing (0 frames in 3 s) and its loop rests (no display frames asked
// for), on a phone's view, for the street, the region and the twin dashboard; a nudge of the camera wakes it at once
for (const api of want('rest')) for (const go of ['go=parity-street', 'go=parity-region', 'go=twin&ui=twin']) {
  const { page, errors } = await openDemo(browser, `${base}?${go}&graphics=${api}&dpr=1&log=0`, { width: 390, height: 844 });
  try {
    const st = await page.evaluate(async () => {
      const { w } = window.aslnutDemo, sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
      // (the twin on WebGPU in SwiftShader takes minutes to settle: its ground's tiles come a frame at a time)
      const settled = await w.settled({ timeout: 420000 }).catch(() => false); await sleep(1500);
      w.drawnWhy(); const s0 = w.stats(); await sleep(3000); const s1 = w.stats(), why = w.drawnWhy(), t = w.telemetry();
      const still = { settled, frames: s1.drawn - s0.drawn, asked: s1.skipped - s0.skipped, resting: t.frames.resting, why };
      // a nudge (as a hand would move it): frames come at once, then it rests again
      const v = w.camera.view, f0 = w.stats().drawn, t0 = performance.now();
      w.go({ lon: v.lon, lat: v.lat, zoom: v.zoom, tilt: v.tilt, bearing: v.bearing + 2 });
      while (w.stats().drawn === f0 && performance.now() - t0 < 8000) await sleep(16);
      const woke = Math.round(performance.now() - t0);
      await w.settled({ timeout: 420000 }).catch(() => {}); w.drawnWhy();
      // (it rests half a second after its last frame: a slow chip's last frames come a while after it settled)
      let restsAgain = false; for (let i = 0; i < 40 && !restsAgain; i++) { await sleep(250); restsAgain = w.telemetry().frames.resting; }
      const whyAfter = w.drawnWhy();
      // your own work asks for its frames (w.everyFrame at 10 a second): they come at its rate while it is on, none after
      // (and nothing else: the view is settled and still, so every frame drawn meanwhile is one it asked for)
      w.drawnWhy(); let calls = 0; const d0 = w.stats().drawn, sampleStart = performance.now(), off = w.everyFrame(() => { calls++; }, { fps: 10 });
      await sleep(1500); const during = w.stats().drawn - d0, elapsedMs = performance.now() - sampleStart, whyDuring = w.drawnWhy(); off(); await sleep(1200);
      const d1 = w.stats().drawn; await sleep(1500); const after = w.stats().drawn - d1;
      // the budget's telemetry: every layer's share, its memory adding up to the graphics'
      const tel = w.telemetry(), memSum = tel.memory.reduce((a, m) => a + m.MB, 0);
      return { still, woke, restsAgain, whyAfter, every: { during, calls, after, elapsedMs: Math.round(elapsedMs), why: whyDuring }, telemetry: { elements: tel.elements.length, memoryMB: tel.memoryMB, memSum: +memSum.toFixed(1), quality: tel.quality, budget: tel.budget } };
    });
    check(api, `rest: ${go.slice(3)}: a settled still view draws 0 frames in 3 s and its loop rests; a nudge wakes it, then it rests again`, st.still.frames === 0 && st.still.resting && st.still.asked <= 45 && st.woke < 8000 && st.restsAgain, JSON.stringify({ still: st.still, woke: st.woke, restsAgain: st.restsAgain, whyAfter: st.whyAfter }));
    // its frames: the one its start asks for (an invalidate: 'dirty'), then one whenever 100 − 4 ms have passed since
    // the last frame drawn (the world's beat for a rate of 10: msPer(10) − 4), so at most 1 + elapsed / 96 in the
    // window, however late the timer that ends it comes; and no other reason (another asker on a settled, still view
    // is the fault: the water reading the ground again once drew 26 here, heights that came after the view settled)
    const frameLimit = 1 + Math.floor(st.every.elapsedMs / (1000 / 10 - 4));
    const others = Object.entries(st.every.why).filter(([k, n]) => !/^animating:everyFrame#\d+$/.test(k) && !(k === 'dirty' && n === 1));
    check(api, `rest: ${go.slice(3)}: everyFrame asks for its own frames at its rate (10 a second), nothing else draws, none once off; telemetry counts every layer and the chip's memory`, st.every.during >= 1 && st.every.during <= frameLimit && !others.length && Math.abs(st.every.calls - st.every.during) <= 1 && st.every.after === 0 && st.telemetry.elements > 3 && Math.abs(st.telemetry.memSum - st.telemetry.memoryMB) < 2, JSON.stringify({ every: st.every, frameLimit, telemetry: st.telemetry }));
    check(api, `no page errors (rest ${go.slice(3)})`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, `rest: ${go}`, false, e.message.slice(0, 300)); }
  await page.close();
}
// the library's parts this twin shows, each in its preset: the tree species down a street, the trees counted when
// small, the real stars, buildings from open footprints, lakes, creeks and the sea, streets from OSM ways, the
// materials, the car and drone packages; the clocks in the place's zone
// (every row of the car and drone packages, as many as the library has)
const rows = (f) => Object.keys(JSON.parse(readFileSync(join(import.meta.dirname, '..', 'src', 'modules', 'presets', f, 'presets.json'), 'utf8'))).length;
const CAR_ROWS = rows('vehicles/car'), DRONE_ROWS = rows('drones');
const LIBRARY = {
  trees: ["(()=>{try{return window.aslnutDemo.w.element('species').keys().length>0}catch{return false}})()", "(() => { const { w } = window.aslnutDemo, l = w.element('species'); return { ok: l.keys().length > 0 && w.timeZone === 'Australia/Melbourne', chunks: l.keys().length, zone: w.timeZone }; })()"],
  'trees-counted': ["(()=>{try{return window.aslnutDemo.street.tiles().length>4}catch{return false}})()", "(() => { const { w, street } = window.aslnutDemo, cells = street.cells(); return { ok: street.countedAt(w.state) && cells.length > 50 && w.element('streets-counted').target > 0, cells: cells.length, trees: cells.reduce((n, c) => n + c.count, 0) }; })()"],
  stars: ["!!window.aslnutDemo?.w", "(() => { const { sky } = window.aslnutDemo; return { ok: sky.starsN > 1000, stars: sky.starsN }; })()"],
  buildings: ["(()=>{try{return window.aslnutDemo.w.element('open-buildings').keys().length>0}catch{return false}})()", "(() => { const l = window.aslnutDemo.w.element('open-buildings'); return { ok: l.keys().length > 0 && (l.counts().vertices > 10000 || l.counts().drawnVertices > 10000), ...l.counts() }; })()"],
  water: ["(()=>{try{return window.aslnutDemo.w.element('water').keys().length>0}catch{return false}})()", "(() => { const { w } = window.aslnutDemo, l = w.element('water'); return { ok: l.keys().length > 0 && l.sea(w.state)?.level === 0, chunks: l.keys().length }; })()"],
  'osm-roads': ["(()=>{try{return window.aslnutDemo.w.element('osm-roads').keys().length>0}catch{return false}})()", "(() => { const l = window.aslnutDemo.w.element('osm-roads'); return { ok: l.sections().length > 1000 && l.junctions().length > 100, sections: l.sections().length, junctions: l.junctions().length }; })()"],
  materials: ["(()=>{try{return window.aslnutDemo.w.element('materials').keys().length>0}catch{return false}})()", "(async () => { const { w } = window.aslnutDemo, l = w.element('materials'); for (let i = 0; i < 100 && ![...l.pics.values()].some((p) => typeof p === 'object'); i++) await new Promise((ok) => setTimeout(ok, 100)); return { ok: [...l.pics.values()].some((p) => typeof p === 'object'), pictures: [...l.pics.values()].map((p) => (typeof p === 'object' ? 'made' : p)) }; })()"],
  vehicles: ["(()=>{try{return window.aslnutDemo.w.element('car-presets').keys().length>0}catch{return false}})()", `(() => { const { w } = window.aslnutDemo, n = (id) => w.element(id).counts().instances; return { ok: n('car-presets') === ${CAR_ROWS} && n('car-fleet') === 8 && n('drones') === ${DRONE_ROWS}, presets: n('car-presets'), fleet: n('car-fleet'), drones: n('drones') }; })()`],
};
for (const api of want('library')) for (const [go, [ready, probe]] of Object.entries(LIBRARY)) {
  const { page, errors } = await openDemo(browser, `${base}?go=${go}&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 390, height: 640 });
  try {
    await page.waitForFunction(ready, null, { timeout: 120000 });
    await page.evaluate(() => window.aslnutDemo.w.settled({ timeout: 20000 }).catch(() => {}));
    const st = await page.evaluate(probe);
    check(api, `library: ${go}`, st.ok, JSON.stringify(st).slice(0, 300));
    check(api, `no page errors (${go})`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, `library: ${go}`, false, e.message.slice(0, 300)); }
  await page.close();
}
await browser.close(); srv.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
console.log(`${failed ? 'FAIL' : 'ok  '} smoke-city: ${results.length - failed}/${results.length} checks passed on WebGPU and WebGL2 (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
process.exit(failed ? 1 : 0);
