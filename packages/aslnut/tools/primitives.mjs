// The primitives check: every visual a city twin's five screens need (and the tree's wire-sphere hover) and a
// low-level 3D checklist, built with the public API only (examples/primitives), on WebGPU and WebGL2.
// Each scene settles with no errors and draws something; the wire scene shows the net when a tree is hovered (and
// takes it away when the pointer leaves); the three scene draws every one of its layers; the surface scene colours the
// walls by their orientation (a surface field: two walls of one building differ, in the ramp's colours); the epochs
// scene's frame at 07:30 lies between its 07:00 and 08:00 frames (the field's values half way, its pixels between); the
// levels scene's props by level apply once a level change across an acrobatic zoom (in and out, overshooting), the
// points' size and the field's grid follow the level, its state carried over.
//   node tools/primitives.mjs   (run `npm run examples` first; ASLNUT_DIST for another build) · evidence in .out/primitives/
import { serve } from './serve.mjs';
import { launch, bytesOf } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PRIM_PORT ?? 8178), OUT = join(import.meta.dirname, '..', '.out', 'primitives');
mkdirSync(OUT, { recursive: true });
const SCENES = (process.env.ONLY ?? 'region,studio,heatlab,clayton,access,wire,three,extend,surface,epochs,levels').split(',');
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
    if (go === 'surface') {
      // the middle of two walls of one building (its south face, its east face): different colours of the ramp
      const pts = await page.evaluate(() => { const { w, extra } = window.aslnutDemo; return { s: w.project(extra.walls.south), e: w.project(extra.walls.east), st: w.element('block').surfaceStats() }; });
      const at = (p) => { let r = 0, g = 0, b = 0, n = 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const o = ((Math.round(p[1]) + dy) * f.w + Math.round(p[0]) + dx) * 4; r += px[o]; g += px[o + 1]; b += px[o + 2]; n++; } return [r / n, g / n, b / n].map(Math.round); };
      const cs = at(pts.s), ce = at(pts.e), chroma = (c) => Math.max(...c) - Math.min(...c), diff = Math.abs(cs[0] - ce[0]) + Math.abs(cs[1] - ce[1]) + Math.abs(cs[2] - ce[2]);
      check(api, 'surface: walls coloured by their orientation (the south and east faces of one building differ, in the ramp\'s colours)', pts.st.textures > 0 && diff > 40 && Math.max(chroma(cs), chroma(ce)) > 40, JSON.stringify({ south: cs, east: ce, diff, field: pts.st }));
    }
    if (go === 'epochs') {
      // the frames at 07:00, 08:00 and 07:30: the field's value and the pixels half way between
      const shot = async (h) => {
        const v = await page.evaluate(async (h) => { const { w, extra } = window.aslnutDemo, e = extra.epochs; e.playback.seek(e.day + h * e.H); await w.settled({ timeout: 60000 }).catch(() => {}); const hot = e.hotAt(9); return { ground: w.element('warm').at(hot), walls: w.element('warm-walls').at([...hot, 0]) }; }, h);
        const g = await frameOf(page); return { v, px: bytesOf(g), g };
      };
      const a = await shot(7), b = await shot(8), m = await shot(7.5);
      writeFileSync(join(OUT, `epochs-0730-${api}.png`), png(m.g.w, m.g.h, m.px));
      const lum = (p, i) => 0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2];
      let moved = 0, between = 0;
      for (let i = 0; i < m.px.length; i += 4) { const la = lum(a.px, i), lb = lum(b.px, i); if (Math.abs(la - lb) < 12) continue; moved++; const lm = lum(m.px, i); if (lm >= Math.min(la, lb) - 6 && lm <= Math.max(la, lb) + 6) between++; }
      const half = (x, y, z) => Math.abs(z - (x + y) / 2) < 0.05;
      check(api, 'epochs: the frame at 07:30 lies between 07:00 and 08:00 (the values half way on the ground and the walls, the pixels between)', half(a.v.ground, b.v.ground, m.v.ground) && half(a.v.walls, b.v.walls, m.v.walls) && moved > 500 && between / moved > 0.85, JSON.stringify({ a: a.v, b: b.v, m: m.v, moved, between: +(between / Math.max(1, moved)).toFixed(3) }));
    }
    if (go === 'levels') {
      // an acrobatic zoom: a pinch overshooting the street edge and back faster than the dwell, then in and held, out
      // past building, out to city, back to district. Each step: the zoom, then frames on the world's fixed clock
      const run = await page.evaluate(async () => {
        const { w, extra } = window.aslnutDemo, L = extra.levels, f = w.element('flood'), c = w.element('clinics');
        const frames = (n) => new Promise((k) => { let i = 0; const t = () => (++i >= n ? k() : requestAnimationFrame(t)); requestAnimationFrame(t); });
        const at = async (zoom, n) => { const v = w.camera.view; w.go({ lon: v.lon, lat: v.lat, tilt: v.tilt, bearing: v.bearing, zoom }); await frames(n); };
        const look = () => ({ level: w.level, size: c.props.size, color: c.props.color, cell: f.cell, cells: [f.w, f.h], runsOn: f.runsOn });
        await f.sync(); const v0 = f.at(L.centre), start = look();
        const seen = [];
        for (const z of [14.2, 14.9, 15.3, 14.6, 14.1, 13.6]) await at(z, 3);           // overshoot and back: no change
        const afterOvershoot = { ...L.applies, changes: w.observation.counts.changes };
        await at(15.5, 40); await w.settled({ timeout: 30000 }).catch(() => {}); await f.sync(); seen.push(look());
        const v1 = f.at(L.centre);
        for (const z of [14.6, 14.3, 14.7, 14.4]) await at(z, 6);                         // hovering on the edge
        await at(18, 40); seen.push(look());
        await at(10, 40); await w.settled({ timeout: 30000 }).catch(() => {}); await f.sync(); seen.push(look());
        await at(13.5, 40); await w.settled({ timeout: 30000 }).catch(() => {}); await f.sync(); seen.push(look());
        const o = w.observation.counts;
        return { start, seen, afterOvershoot, applies: { ...L.applies }, changes: o.changes, applied: o.applied, v0, v1, v2: f.at(L.centre) };
      });
      const g = await frameOf(page), gx = bytesOf(g); writeFileSync(join(OUT, `levels-back-${api}.png`), png(g.w, g.h, gx));
      // at rest, on the real clock (as the smoke's rest step): after a level change (in to street, the field a new
      // grid), a settled, still view draws nothing in 3 s (props by level ask for no frames of their own)
      const rp = await browser.newPage({ viewport: { width: 480, height: 640 } });
      await rp.goto(`http://127.0.0.1:${PORT}/examples/primitives/?go=levels&graphics=${api}&dpr=1`);
      await rp.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 60000 });
      run.still = await rp.evaluate(async () => {
        const { w } = window.aslnutDemo, sleep = (ms) => new Promise((k) => setTimeout(k, ms));
        await w.settled({ timeout: 90000 }).catch(() => {});
        const v = w.camera.view; w.go({ lon: v.lon, lat: v.lat, tilt: v.tilt, bearing: v.bearing, zoom: 15.6 });
        for (let i = 0; i < 40 && w.level !== 'street'; i++) await sleep(100);
        await w.settled({ timeout: 90000 }).catch(() => {}); await sleep(1500);
        const d0 = w.stats().drawn; await sleep(3000);
        return { level: w.level, cell: w.element('flood').cell, frames: w.stats().drawn - d0, resting: w.telemetry().frames.resting };
      });
      await rp.close();
      const [st, bu, ci, di] = run.seen;
      check(api, 'levels: props by level apply once a level change across an acrobatic zoom (none on an overshoot), only where they changed', run.afterOvershoot.clinics === 0 && run.afterOvershoot.flood === 0 && run.afterOvershoot.changes === 0
        && run.changes === 4 && run.applies.clinics === 2 && run.applies.flood === 3 && run.applied === 5 && run.still.level === 'street' && run.still.cell === 2 && run.still.frames === 0 && run.still.resting, JSON.stringify({ afterOvershoot: run.afterOvershoot, applies: run.applies, changes: run.changes, applied: run.applied, still: run.still }));
      check(api, 'levels: the points\' size and colour and the field\'s grid follow the level, the field\'s state carried over', run.start.level === 'district' && run.start.size === 6 && run.start.cell === 8 && st.level === 'street' && st.size === 14 && st.color === '#ef476f' && st.cell === 2 && st.cells[0] === 300
        && bu.level === 'building' && bu.cell === 2 && ci.level === 'city' && ci.cell === 32 && ci.size === 6 && di.level === 'district' && di.cell === 8 && Math.abs(run.v1 - run.v0) < 0.02 && Math.abs(run.v2 - run.v0) < 0.05 && drawnPx(gx) > 2000,
        JSON.stringify({ start: run.start, seen: run.seen, v: [run.v0, run.v1, run.v2].map((x) => +x.toFixed(4)), drawn: drawnPx(gx) }));
    }
    check(api, `no page errors (${go})`, errors.filter((e) => !/GPU stall/.test(e)).length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, go, false, e.message.slice(0, 300)); }
  await page.close();
}
await browser.close(); srv.close();
const failed = results.filter((r) => !r.ok).length;
console.log(`${failed ? 'FAIL' : 'ok  '} primitives: ${results.length - failed}/${results.length} checks passed on WebGPU and WebGL2`);
process.exit(failed ? 1 : 0);
