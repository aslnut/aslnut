// The lego bricks checked and measured (examples/lego), on WebGPU AND WebGL2, on a phone's page (390 × 844 CSS px,
// pixel ratio 2): the browser's own numbers (CDP: main-thread busy, the JS heap and typed arrays after a collection)
// and the graphics bytes. Checks fail the run (exit 1); measures are written to .out/lego/<what>.json.
//   size      the size rule: points, a line, ground quads in metres kept within a range of CSS px, each seen at three
//             zooms against the rule's own answer (within 20 % or 1.5 px); a label in metres drawn again in steps
//   levels    the camera wobbling at the levels' edges (± 0.06 zoom): instances (300 turbines) and things (400 cars of
//             a set) changing level, without a margin and with the default .2 (with it: next to none)
//   joints    1,000 turbines whose rotors turn by their joints (each its own rate): the frames change while they turn,
//             not once they are stopped (one write for all); one clone's rate written alone; a set's wheels rolled by
//             its log's travel; main-thread ms a frame
//             with all of them turning, against stopped (CPU ×1, ×4)
//   sorts     the twin's street view (examples/layers ?go=street&twin=1, its mocks) under acrobat's fast camera script, the CPU
//             slowed ×4: the frame where the most sized sets sort their levels again, its main-thread ms and theirs
//   long      the same run: every frame over 50 ms classed by its cause (the main thread's samples inside it: GC, a
//             shader built, labels drawn, uploads, chunks built, ground tiles, levels sorted, …), its worst ms; and the
//             gaps between drawn frames with the main thread busy over 50 ms in them (work between two frames: a
//             worker's answer put from its callback, a terrain tile's heights), classed the same way; the build
//             served is ASLNUT_DIST's (a baseline's dist-examples to compare)
//   emit      smoke attached at stacks' tops (copies over time): the frames change near (the copies rise and loop), not far
//             away (the far level has none); the app's priorities under a budget it cannot meet (the stacks stepped first)
//   cars      every row of the car (each a row of numbers): its triangles at each level within its budget, each drawn
//             alone near and farther; a tractor's trailer turned at its fifth wheel by its log's value (pixels change
//             when its hinge is not driven, not when it is again)
//   measure   bytes per clone (1k, 10k; 10k of 40 seeded builds; 10k of 40 builds that all look different, of 1, 4,
//             40 and 100 forms: draws, frames a second, main-thread ms a frame turning, with the camera moving, stopped,
//             none), builds and cache hits, 1k parts moved by the app
//             per frame (CPU ×1, ×4), a zoom step's cost on 10k points (CSS px restyled by the app vs metres) and on
//             10k clones (rescaled by the app)
//   node tools/lego.mjs [size,measure] [webgpu,webgl2]     (EXAMPLES_KEEP_BUILD=1 npx vite build first)   PORT=8448
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 8448), OUT = join(import.meta.dirname, '..', '.out', 'lego'), MB = 1048576, r2 = (x) => Math.round(x * 100) / 100;
mkdirSync(OUT, { recursive: true });
const what = (process.argv[2] ?? 'size,levels,joints,emit,cars,measure').split(','), apis = (process.argv[3] ?? 'webgpu,webgl2').split(',');
const srv = await serve(PORT), browser = await launch();
let failed = 0;
const check = (api, name, ok, info) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${api.padEnd(6)} ${name}${info !== undefined ? ` · ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`); };
async function open(api, go) {
  const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
  const page = await ctx.newPage(), errors = [];
  page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Performance.enable');
  await page.goto(`http://127.0.0.1:${PORT}/examples/lego/?go=${go}&graphics=${api}`);
  await page.waitForFunction(() => window.lego?.ready, null, { timeout: 120000 });
  const busy = async () => ((await cdp.send('Performance.getMetrics')).metrics.find((m) => m.name === 'TaskDuration')?.value ?? 0) * 1000;
  const heap = async () => { await cdp.send('HeapProfiler.collectGarbage'); await cdp.send('HeapProfiler.collectGarbage'); const u = await cdp.send('Runtime.getHeapUsage'); return { js: u.usedSize / MB, buffers: (u.backingStorageSize ?? 0) / MB }; };
  const timed = async (f, a) => { const b0 = await busy(); const r = await page.evaluate(f, a); return { r, busy: r2((await busy()) - b0) }; };
  return { ctx, page, cdp, errors, busy, heap, timed, gpu: () => page.evaluate(() => window.lego.gpuMB()) };
}

for (const api of apis) {
  if (what.includes('size')) {
    const o = await open(api, 'size'), rows = [];
    try {
      const near = (g, w) => Math.abs(g - w) <= Math.max(1.5, w * 0.2);
      for (const z of [13, 15.5, 18]) {
        const r = await o.page.evaluate((x) => window.lego.sizeAt(x), z); rows.push(r);
        for (const k of ['points', 'line', 'quad']) check(api, `size: ${k} at zoom ${z}`, near(r[k].got, r[k].want), { got: r2(r[k].got), want: r2(r[k].want), mpp: r2(r.mpp) });
      }
      // a label in metres: drawn again a few times over the zooms, never once a frame (its steps keep while within a margin)
      const ls = await o.page.evaluate(() => window.lego.labelSteps());
      check(api, 'size: a label in metres drawn again in steps while the camera zooms in (once a step, 9 to 22 px)', ls.zoomIn >= 5 && ls.zoomIn <= 16, ls);
      check(api, 'size: a label wobbling at a step\'s edge keeps its picture (at most once again)', ls.wobble <= 1, ls);
      check(api, 'size: no page error', !o.errors.length, o.errors.slice(0, 3));
    } catch (e) { check(api, 'size ran', false, String(e).slice(0, 300)); }
    writeFileSync(join(OUT, `size-${api}.json`), JSON.stringify(rows, null, 1));
    await o.ctx.close();
  }
  if (what.includes('levels')) {
    const o = await open(api, 'levels'), rows = [];
    try {
      for (const z of [15.6, 16.3, 17, 18.6, 19.3]) for (const margin of [0, 0.2]) { const r = await o.page.evaluate((a) => window.lego.wobble(a[0], 0.06, 90, a[1]), [z, margin]); rows.push(r); }
      const sum = (m, k) => rows.filter((r) => r.margin === m).reduce((a, r) => a + r[k], 0);
      console.log(api, 'levels', JSON.stringify(rows.map((r) => [r.zoom, r.margin, r.farm, r.cars, r.levels])));
      check(api, 'levels: instances kept within the margin while the camera wobbles', sum(0.2, 'farm') <= Math.max(6, sum(0, 'farm') * 0.1), { without: sum(0, 'farm'), with: sum(0.2, 'farm') });
      check(api, 'levels: a set\'s things kept within the margin while the camera wobbles', sum(0.2, 'cars') <= Math.max(8, sum(0, 'cars') * 0.1), { without: sum(0, 'cars'), with: sum(0.2, 'cars') });
      check(api, 'levels: no page error', !o.errors.length, o.errors.slice(0, 3));
    } catch (e) { check(api, 'levels ran', false, String(e).slice(0, 300)); }
    writeFileSync(join(OUT, `levels-${api}.json`), JSON.stringify(rows, null, 1));
    await o.ctx.close();
  }
  if (what.includes('joints')) {
    const o = await open(api, 'joints'), R = {};
    try {
      const view = { zoom: 17.4, tilt: 58, bearing: 25 };
      R.turning = await o.page.evaluate((v) => window.lego.framesApart(400, v), view);
      check(api, 'joints: rotors turn by their joints (the frames change)', R.turning > 200, { changed: R.turning });
      await o.page.evaluate(() => window.lego.jointRate(0));
      await o.page.waitForTimeout(300);
      R.stopped = await o.page.evaluate(() => window.lego.framesApart(400));
      check(api, 'joints: every rotor stopped by one write (the frames hold)', R.stopped < Math.max(40, R.turning * 0.02), { changed: R.stopped });
      await o.page.evaluate(() => window.lego.jointRate(30, 't5'));
      const one = await o.page.evaluate(() => [window.lego.jointOf('t5'), window.lego.jointOf('t6')]);
      check(api, 'joints: one clone\'s rate written alone', Math.abs(one[0][0] - Math.PI) < 1e-3 && one[1][0] === 0, one);
      // a set's wheels rolled by its log's travel (each sample's metres along its track): unrolled, the frames differ;
      // rolled again, they are the same
      R.rollers = await o.page.evaluate(() => window.lego.rollers());
      check(api, 'joints: a set\'s wheels roll by its log\'s travel (× 0 differs, × 1 again is the same)', R.rollers.unrolled > 30 && R.rollers.again === 0, R.rollers);
      // main-thread ms a frame: every rotor turning, against all stopped (the same frames: everyFrame)
      R.frames = [];
      for (const rate of [1, 4]) {
        await o.cdp.send('Emulation.setCPUThrottlingRate', { rate });
        for (const turning of [false, true]) {
          await o.page.evaluate((t) => window.lego.jointRate(t ? 12 : 0), turning);
          const stop = await o.page.evaluateHandle(() => window.lego.everyFrame());
          await o.page.waitForTimeout(800);
          const f0 = await o.page.evaluate(() => window.lego.frames()), b0 = await o.busy();
          await o.page.waitForTimeout(3000);
          const f1 = await o.page.evaluate(() => window.lego.frames()), b1 = await o.busy();
          await o.page.evaluate((st) => st(), stop);
          const row = { rate, turning, frames: f1 - f0, busyPerFrameMs: r2((b1 - b0) / Math.max(1, f1 - f0)) };
          R.frames.push(row); console.log(api, 'joints', JSON.stringify(row));
        }
      }
      await o.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
      check(api, 'joints: no page error', !o.errors.length, o.errors.slice(0, 3));
    } catch (e) { check(api, 'joints ran', false, String(e).slice(0, 300)); }
    writeFileSync(join(OUT, `joints-${api}.json`), JSON.stringify(R, null, 1));
    await o.ctx.close();
  }
  if (what.includes('emit')) {
    const o = await open(api, 'emit'), R = {};
    try {
      R.near = await o.page.evaluate(() => window.lego.framesApart(500, { zoom: 17.2, tilt: 66, bearing: 25 }));
      check(api, 'emit: smoke at the stacks rises and loops (the frames change)', R.near > 80, { changed: R.near });
      R.far = await o.page.evaluate(() => window.lego.framesApart(500, { zoom: 13, tilt: 30, bearing: 0 }));
      check(api, 'emit: far away none (the far level has no copies)', R.far < 20, { changed: R.far });
      // the app's priorities under a budget it cannot meet: the stacks (and their smoke) stepped first (their own detail: the smoke's share), never hidden;
      // the budget taken away, all of it back
      R.priorities = await o.page.evaluate(() => window.lego.priorities());
      check(api, 'emit: the app\'s drop order first (the stacks ¾, ½, ¼: their smoke\'s share), the world\'s after, never hidden; all back without a budget', R.priorities.dropped.slice(0, 3).join() === 'stacks 0.75,stacks 0.5,stacks 0.25' && R.priorities.share <= 0.25 && R.priorities.shown && R.priorities.back, R.priorities);
      check(api, 'emit: no page error', !o.errors.length, o.errors.slice(0, 3));
    } catch (e) { check(api, 'emit ran', false, String(e).slice(0, 300)); }
    writeFileSync(join(OUT, `emit-${api}.json`), JSON.stringify(R, null, 1));
    await o.ctx.close();
  }
  if (what.includes('sorts')) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // (no network: every host but this one refused, as acrobat's mocks)
    await page.route((u) => !u.href.startsWith(`http://127.0.0.1:${PORT}/`), (r) => r.abort());
    const cdp = await ctx.newCDPSession(page);
    try {
      await page.goto(`http://127.0.0.1:${PORT}/examples/layers/?go=street&twin=1&parity=1&graphics=${api}&dpr=2&log=0`);
      await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 120000 });
      await page.evaluate(async () => { await window.aslnutDemo.w.settled({ timeout: 180000 }).catch(() => {}); });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      const r = await page.evaluate(async () => {
        const w = window.aslnutDemo.w, c = w.camera, v0 = { zoom: c.zoom, tilt: 90 - (c.pitch * 180) / Math.PI, bearing: ((-c.yaw * 180) / Math.PI + 360) % 360, lon: c.lon, lat: c.lat };
        // acrobat's fast script: 8 zoom levels in 2 s, tilt 0 → 80°, a whole turn, back; 5 s still; three cycles
        const keys = [{ at: 0, zoom: v0.zoom, tilt: v0.tilt, turn: 0 }]; let t = 0;
        for (let k = 0; k < 3; k++) { keys.push({ at: (t += 1), zoom: v0.zoom - 4, tilt: 0, turn: 0 }, { at: (t += 2), zoom: v0.zoom + 4, tilt: 0, turn: 0 }, { at: (t += 1.5), zoom: v0.zoom, tilt: 80, turn: 0 }, { at: (t += 2), zoom: v0.zoom, tilt: 80, turn: 1 }, { at: (t += 1.5), zoom: v0.zoom, tilt: v0.tilt, turn: 0 }, { at: (t += 5), zoom: v0.zoom, tilt: v0.tilt, turn: 0 }); }
        const solids = w.list.filter((l) => l.sortStats), rows = [], r = w.renderer;
        let prev = null;
        const off = w.on('frame', ({ n }) => { if (prev) prev.cpuMs = r.cpuMs; let sets = 0, ms = 0; for (const l of solids) { sets += l.sortStats.sets; ms += l.sortStats.ms; } prev = { n, sets, sortMs: ms, cpuMs: NaN }; rows.push(prev); });
        const t0 = performance.now(), D = t;
        await new Promise((done) => { const step = () => { const s = (performance.now() - t0) / 1000; if (s > D) { done(null); return; } let i = 0; while (i + 1 < keys.length - 1 && keys[i + 1].at < s) i++; const a = keys[i], b = keys[i + 1] ?? a, f = Math.max(0, Math.min(1, (s - a.at) / Math.max(1e-6, b.at - a.at))); w.go({ lon: v0.lon, lat: v0.lat, zoom: a.zoom + (b.zoom - a.zoom) * f, tilt: a.tilt + (b.tilt - a.tilt) * f, bearing: v0.bearing + 360 * (a.turn + (b.turn - a.turn) * f) }); requestAnimationFrame(step); }; requestAnimationFrame(step); });
        off();
        const done = rows.filter((x) => Number.isFinite(x.cpuMs)), most = done.reduce((m, x) => (x.sets > m.sets ? x : m), { sets: -1 }), worst = done.reduce((m, x) => (x.cpuMs > m.cpuMs ? x : m), { cpuMs: -1 });
        const sorting = done.filter((x) => x.sets > 0).map((x) => x.sortMs).sort((a, b) => a - b);
        return { frames: done.length, layers: solids.map((l) => l.id), mostSets: most, worstFrame: worst, sortMsP95: sorting.length ? sorting[Math.floor(sorting.length * 0.95)] : 0, sortMsMax: sorting.at(-1) ?? 0, framesSorting: sorting.length };
      });
      console.log(api, 'sorts', JSON.stringify(r));
      writeFileSync(join(OUT, `sorts-${api}.json`), JSON.stringify(r, null, 1));
      check(api, 'sorts: the frame where the most sets sort, under 4 ms of sorting at CPU ×4', r.mostSets.sortMs < 4, { sets: r.mostSets.sets, sortMs: r.mostSets.sortMs, frameMs: r.mostSets.cpuMs });
      check(api, 'sorts: no page error', !errors.length, errors.slice(0, 3));
    } catch (e) { check(api, 'sorts ran', false, String(e).slice(0, 300)); }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    await ctx.close();
  }
  if (what.includes('long')) {
    const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.route((u) => !u.href.startsWith(`http://127.0.0.1:${PORT}/`), (r) => r.abort());
    const cdp = await ctx.newCDPSession(page);
    try {
      await page.goto(`http://127.0.0.1:${PORT}/examples/layers/?go=street&twin=1&parity=1&graphics=${api}&dpr=2&log=0`);
      await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 120000 });
      await page.evaluate(async () => { await window.aslnutDemo.w.settled({ timeout: 180000 }).catch(() => {}); });
      await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
      await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 250 });
      const t0 = await page.evaluate(() => performance.now());
      await cdp.send('Profiler.start');
      const t1 = await page.evaluate(() => performance.now());
      const frames = await page.evaluate(async () => {
        const w = window.aslnutDemo.w, c = w.camera, r = w.renderer, v0 = { zoom: c.zoom, tilt: 90 - (c.pitch * 180) / Math.PI, bearing: ((-c.yaw * 180) / Math.PI + 360) % 360, lon: c.lon, lat: c.lat };
        const keys = [{ at: 0, zoom: v0.zoom, tilt: v0.tilt, turn: 0 }]; let t = 0;
        for (let k = 0; k < 3; k++) { keys.push({ at: (t += 1), zoom: v0.zoom - 4, tilt: 0, turn: 0 }, { at: (t += 2), zoom: v0.zoom + 4, tilt: 0, turn: 0 }, { at: (t += 1.5), zoom: v0.zoom, tilt: 80, turn: 0 }, { at: (t += 2), zoom: v0.zoom, tilt: 80, turn: 1 }, { at: (t += 1.5), zoom: v0.zoom, tilt: v0.tilt, turn: 0 }, { at: (t += 5), zoom: v0.zoom, tilt: v0.tilt, turn: 0 }); }
        const rows = []; let last = -1;
        // each drawn frame's window (its end, its main-thread ms) and its own profile (layers' ms, uploads, the submit)
        const off = w.on('frame', () => { const end = r.drawnAt[(r.drawnN - 1 + r.drawnAt.length) % r.drawnAt.length]; if (r.drawnN && end !== last) { last = end; const p = w.frameProfile(); rows.push({ end, ms: r.cpuMs, tick: r.tickMs, submit: r.submitMs, elements: p.elements, uploads: p.uploads, surface: p.surface }); } });
        const T0 = performance.now(), D = t;
        await new Promise((done) => { const step = () => { const s = (performance.now() - T0) / 1000; if (s > D) { done(null); return; } let i = 0; while (i + 1 < keys.length - 1 && keys[i + 1].at < s) i++; const a = keys[i], b = keys[i + 1] ?? a, f = Math.max(0, Math.min(1, (s - a.at) / Math.max(1e-6, b.at - a.at))); w.go({ lon: v0.lon, lat: v0.lat, zoom: a.zoom + (b.zoom - a.zoom) * f, tilt: a.tilt + (b.tilt - a.tilt) * f, bearing: v0.bearing + 360 * (a.turn + (b.turn - a.turn) * f) }); requestAnimationFrame(step); }; requestAnimationFrame(step); });
        off();
        return rows;
      });
      const { profile } = await cdp.send('Profiler.stop');
      // the samples on the page's clock (the profile started between t0 and t1)
      const nodes = new Map(profile.nodes.map((n) => [n.id, n])), parent = new Map();
      for (const n of profile.nodes) for (const k of n.children ?? []) parent.set(k, n.id);
      const base = (t0 + t1) / 2, at = []; let acc = 0;
      for (let i = 0; i < profile.samples.length; i++) { acc += (profile.timeDeltas[i] ?? 0) / 1000; at.push(base + acc); }
      // a frame's cause: GC, a shader built, uploads or the levels' sorts when their samples take a third of it; else the
      // layer whose frame took the most (its own ms), or the graphics' submit
      const NATIVE = [['GC', /\(garbage collector\)/], ['a shader built', /^(linkProgram|compileShader|getProgramParameter|getShaderParameter|createRenderPipeline|createShaderModule) /], ['uploads', /^(bufferData|bufferSubData|texImage2D|texSubImage2D|texImage3D|texSubImage3D|writeBuffer|writeTexture) /], ['levels sorted', /^(sortStep|levelsOf|keptLevel) /]];
      const LAYER = { roads: 'baked roads (chunks built on the main thread)', streets: 'street tiles (chunks put, their records)', surface: 'ground tiles', water: 'water', sky: 'sky' };
      const chainOf = (k) => { let n = nodes.get(profile.samples[k]); const chain = []; for (let d = 0; n && d < 60; d++) { chain.push(`${n.callFrame.functionName} ${n.callFrame.url.split('/').pop()}`); n = nodes.get(parent.get(n.id)); } return chain; };
      const longs = frames.filter((f) => f.ms > 50), table = {}, iv = 0.25;
      for (const f of longs) {
        const by = {};
        for (let k = 0; k < at.length; k++) {
          if (at[k] < f.end - f.ms || at[k] > f.end) continue;
          const chain = chainOf(k);
          for (const [name, re] of NATIVE) if (chain.some((x) => re.test(x))) { by[name] = (by[name] ?? 0) + iv; break; }
        }
        const nat = Object.entries(by).sort((a, b) => b[1] - a[1])[0], top = f.elements[0];
        const cause = nat && nat[1] >= f.ms / 3 ? nat[0] : f.submit > (top?.[1] ?? 0) ? 'graphics submit' : top ? LAYER[top[0]] ?? `layer ${top[0]}` : 'other';
        const row = (table[cause] ??= { count: 0, worst: 0 }); row.count++; row.worst = Math.max(row.worst, Math.round(f.ms));
      }
      // the gaps between two drawn frames with the main thread busy over 50 ms in them: work between the frames (a
      // worker's answer put from its callback, a terrain tile's heights) never shows in a frame's own ms, yet the page
      // stutters for it; each classed by what took most of its busy samples (idle ones left out)
      const GAP = [['GC', /\(garbage collector\)/], ['the clamp (the ground under the roads)', /^(heights|limit|under) baked/], ['chunks built on the main thread', /^(bakedMesh|cityTile) /], ['chunks put', /^(put|take) solids/], ['the ground read under chunks', /^readGround /], ['a shader built', NATIVE[1][1]], ['uploads', NATIVE[2][1]], ['the rest of a frame', /^tick /]];
      const gapTable = {}; let gapWorst = 0, gapCount = 0;
      for (let i = 1; i < frames.length; i++) {
        const a = frames[i - 1].end, b = frames[i].end; if (b - a <= 50) continue;
        const by = {}; let busy = 0;
        for (let k = 0; k < at.length; k++) {
          if (at[k] <= a || at[k] > b) continue;
          const chain = chainOf(k); if (/^\((idle|program)\) /.test(chain[0] ?? '')) continue;
          busy += iv; const hit = GAP.find(([, re]) => chain.some((x) => re.test(x)));
          by[hit ? hit[0] : 'other'] = (by[hit ? hit[0] : 'other'] ?? 0) + iv;
        }
        if (busy <= 50) continue;
        gapCount++; gapWorst = Math.max(gapWorst, Math.round(busy));
        const cls = Object.entries(by).sort((x, y) => y[1] - x[1])[0][0], row = (gapTable[cls] ??= { count: 0, worst: 0 }); row.count++; row.worst = Math.max(row.worst, Math.round(busy));
      }
      const R = { build: process.env.ASLNUT_DIST ?? 'dist-examples', frames: frames.length, long: longs.length, worst: Math.round(Math.max(0, ...frames.map((f) => f.ms))), table, gaps: { count: gapCount, worst: gapWorst, table: gapTable } };
      console.log(api, 'long', JSON.stringify(R));
      writeFileSync(join(OUT, `long-${api}${process.env.TAG ? `-${process.env.TAG}` : ''}.json`), JSON.stringify({ ...R, frames }, null, 1));
      check(api, 'long: no page error', !errors.length, errors.slice(0, 3));
    } catch (e) { check(api, 'long ran', false, String(e).slice(0, 300)); }
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 }).catch(() => {});
    await ctx.close();
  }
  if (what.includes('cars')) {
    const o = await open(api, 'cars&orbit=0'), big = { bus: 4500, citybus: 4500, truck: 4500, tractor: 6000 };
    try {
      const rows = await o.page.evaluate(() => window.lego.carRows());
      console.log(api, 'cars', JSON.stringify(rows));
      for (const r of rows) check(api, `cars: ${r.type} within its budget (whole, simple, far)`, r.triangles[0] <= (big[r.type] ?? 3500) && r.triangles[1] <= r.triangles[0] * 0.6 && r.triangles[2] <= 80, r);
      const drawn = await o.page.evaluate(() => window.lego.carsDrawn());
      for (const d of drawn) check(api, `cars: ${d.type} drawn alone, near and farther`, d.shares[0] > 0.01 && d.shares[1] > 0.001, d.shares);
      check(api, 'cars: no page error', !o.errors.length, o.errors.slice(0, 3));
      writeFileSync(join(OUT, `cars-${api}.json`), JSON.stringify({ rows, drawn }, null, 1));
    } catch (e) { check(api, 'cars ran', false, String(e).slice(0, 300)); }
    await o.ctx.close();
    const h = await open(api, 'hitch');
    try {
      const r = await h.page.evaluate(() => window.lego.hitchTurn());
      check(api, 'cars: a tractor\'s trailer turned at its fifth wheel by its log (straight when its hinge is not driven)', Math.abs(r.hitch) > 10 && r.straightened > 200 && r.again < 40, r);
      check(api, 'cars: the hitch scene without a page error', !h.errors.length, h.errors.slice(0, 3));
    } catch (e) { check(api, 'hitch ran', false, String(e).slice(0, 300)); }
    await h.ctx.close();
  }
  if (what.includes('measure')) {
    const o = await open(api, 'measure'), R = { errors: o.errors };
    try {
      R.builds = await o.page.evaluate(() => window.lego.builds(40));
      console.log(api, 'builds', JSON.stringify(R.builds));
      R.clones = [];
      for (const [n, builds] of [[1000, 1], [10000, 1], [10000, 40]]) {
        await o.page.evaluate(() => window.lego.clear()); await o.page.evaluate((x) => window.lego.prep(x), n);
        const h0 = await o.heap(), g0 = await o.gpu();
        const t = await o.timed((a) => window.lego.clones(a[0], a[1]), [n, builds]);
        const h1 = await o.heap(), g1 = await o.gpu();
        const row = { n, builds, addBusyMs: t.busy, wallMs: r2(t.r.ms), cached: t.r.cached, jsMB: r2(h1.js - h0.js), typedMB: r2(h1.buffers - h0.buffers), gpuMB: r2(g1 - g0) };
        row.bytesPerClone = { js: Math.round(((h1.js - h0.js) * MB) / n), typed: Math.round(((h1.buffers - h0.buffers) * MB) / n), gpu: Math.round(((g1 - g0) * MB) / n) };
        if (n === 10000 && builds === 1) { row.rescale = []; for (let k = 1; k <= 3; k++) { const s = await o.timed((x) => window.lego.clonesRescale(x), k); row.rescale.push({ busyMs: s.busy, refreshMs: r2(s.r.refreshMs) }); } }
        R.clones.push(row); console.log(api, JSON.stringify(row));
        await o.page.evaluate(() => window.lego.remove('farm'));
      }
      // 10k clones that all look different: 40 seeded builds (they come out the same: one form) and each clone its colour,
      // its nacelle's, size, stretch, heading, rotor's rate; then with 4, 40 and 100 blade lengths besides (a form each):
      // bytes a clone, draws, frames a second and main-thread ms a frame with every rotor turning, the camera moving (chunks
      // in and out of the view, clones changing level), stopped, and with no farm
      R.variety = [];
      for (const forms of [0, 4, 40, 100]) {
        await o.page.evaluate(() => window.lego.clear()); await o.page.evaluate((x) => window.lego.prep(x), 10000);
        const h0 = await o.heap(), g0 = await o.gpu();
        const t = await o.timed((a) => window.lego.variety(10000, 40, a), forms);
        const h1 = await o.heap(), g1 = await o.gpu(), n = 10000, lk = await o.page.evaluate((x) => window.lego.looks(x), n);
        const row = { n, seeds: 40, forms: forms || 1, builds: t.r.makes, looks: lk.looks, texelsAClone: lk.stride, addBusyMs: t.busy, wallMs: r2(t.r.ms), jsMB: r2(h1.js - h0.js), typedMB: r2(h1.buffers - h0.buffers), gpuMB: r2(g1 - g0) };
        row.bytesPerClone = { js: Math.round(((h1.js - h0.js) * MB) / n), typed: Math.round(((h1.buffers - h0.buffers) * MB) / n), gpu: Math.round(((g1 - g0) * MB) / n) };
        check(api, `measure: 10k clones (${forms || 1} forms) all look different (their records)`, lk.looks >= n * 0.98, { looks: lk.looks });
        row.frames = [];
        for (const state of ['turning', 'moving', 'stopped', 'none']) {
          if (state === 'stopped') await o.page.evaluate(() => window.lego.jointRate(0));
          if (state === 'none') await o.page.evaluate(() => window.lego.remove('farm'));
          const stop = await o.page.evaluateHandle((m) => (m ? window.lego.moving() : window.lego.everyFrame()), state === 'moving');
          await o.page.waitForTimeout(800);
          const f0 = await o.page.evaluate(() => window.lego.frames()), b0 = await o.busy(), s0 = Date.now();
          // (the most draws a frame while it moves; else the last frame's)
          const most = state === 'moving' ? await o.page.evaluateHandle(() => { const m = { draws: 0 }; const off = window.w.on('frame', () => { m.draws = Math.max(m.draws, window.w.telemetry().draws); }); return { m, off }; }) : null;
          await o.page.waitForTimeout(3000);
          const f1 = await o.page.evaluate(() => window.lego.frames()), b1 = await o.busy(), tm = await o.page.evaluate((h) => { const t = window.w.telemetry(); if (h) h.off(); return { draws: h ? h.m.draws : t.draws, farm: t.elements.find((e) => e.id === 'farm')?.ms ?? 0 }; }, most);
          await o.page.evaluate((s) => s(), stop);
          if (state === 'moving') await o.page.evaluate(() => window.w.settled({ timeout: 60000 }));
          row.frames.push({ state, fps: r2(((f1 - f0) * 1000) / (Date.now() - s0)), draws: tm.draws, farmMs: tm.farm, busyPerFrameMs: r2((b1 - b0) / Math.max(1, f1 - f0)) });
        }
        R.variety.push(row); console.log(api, 'variety', JSON.stringify(row));
      }
      // a zoom step on 10k points: CSS px restyled by the app, against metres (the size rule: the zoom alone)
      R.zoomStep = {};
      for (const metres of [false, true]) {
        await o.page.evaluate((m) => window.lego.pointsAdd(10000, m), metres);
        const steps = []; for (let k = 1; k <= 7; k++) { const s = await o.timed((a) => window.lego.pointsResize(a[0], a[1]), [k, metres]); steps.push(s.busy); }
        // (the median of 7 zoom steps: busy ms from the step to its frame settled)
        R.zoomStep[metres ? 'metres (the rule)' : 'CSS px restyled by the app'] = { medianBusyMs: [...steps].sort((x, y) => x - y)[3], steps };
        await o.page.evaluate(() => window.lego.remove('pts'));
      }
      console.log(api, 'zoom step', JSON.stringify(R.zoomStep));
      // 1k parts moved by the app each frame, against the same frames with nothing moving
      R.movers = [];
      for (const rate of [1, 4]) {
        await o.cdp.send('Emulation.setCPUThrottlingRate', { rate });
        for (const move of [false, true]) {
          await o.page.evaluate((m) => window.lego.movers(1000, m), move);
          const stop = await o.page.evaluateHandle(() => window.lego.everyFrame());
          await o.page.waitForTimeout(800);
          const f0 = await o.page.evaluate(() => window.lego.frames()), b0 = await o.busy();
          await o.page.waitForTimeout(3000);
          const f1 = await o.page.evaluate(() => window.lego.frames()), b1 = await o.busy();
          await o.page.evaluate((s) => s(), stop);
          const row = { rate, move, frames: f1 - f0, busyPerFrameMs: r2((b1 - b0) / Math.max(1, f1 - f0)) };
          R.movers.push(row); console.log(api, JSON.stringify(row));
          await o.page.evaluate(() => window.lego.remove('movers'));
        }
      }
      await o.cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
    } catch (e) { R.failed = String(e?.stack ?? e); console.log(api, 'FAILED', e); failed++; }
    writeFileSync(join(OUT, `measure-${api}.json`), JSON.stringify(R, null, 1));
    await o.ctx.close();
  }
}
await browser.close(); srv.close();
console.log(`${failed ? 'FAIL' : 'ok  '} lego: ${failed} failed`);
process.exit(failed ? 1 : 0);
