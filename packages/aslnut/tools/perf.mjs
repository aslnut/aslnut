// Performance: frame times, CPU per frame, GC, uploads, draw calls, heap, time to first image and to settled, per demo,
// on WebGPU AND WebGL2, with a profile of the main thread attributed by area; and the gesture test (fast zoom in, out,
// pan) on a phone emulation (CPU 4× slower, 390 × 844 at DPR 3).
// Budgets fail the run (exit 1).
//   node tools/perf.mjs [suite]      suite: demos | gesture | heap | all (default all)
//   PERF_GPU=real    WebGL2 on the machine's own GPU (Chrome: GPU_CHROME, else the installed one); WebGPU runs on
//                    SwiftShader where it has no adapter there; default: real when it is found
//   ASLNUT_DIST=…    serve another build (the "before" numbers)   PERF_TAG=before|after   PERF_DEMOS=regions,fleet
import { serve } from './serve.mjs';
import { launchOptions, playwright } from './browser.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gestureView, frameStats } from '../examples/hello-earth/gesture.ts';

const TAG = process.env.PERF_TAG ?? 'after', SUITE = process.argv[2] ?? 'all';
const OUT = join(import.meta.dirname, '..', '.out', 'perf', TAG); mkdirSync(OUT, { recursive: true });
const PORT = 8097, base = `http://127.0.0.1:${PORT}`;
const { chromium } = await playwright();
const srv = await serve(PORT);

// ── budgets (fail the run) ─────────────────────────────────────────────────────────────────────────────────────
export const BUDGET = {
  gesture: { p95: 33.4, max: 100 },            // phone emulation, real chip, WebGL2 (and WebGPU where a chip runs it)
  cpuMedian: 4, cpuP95: 8,                      // ms of main-thread work per frame (desktop CPU), any demo
  longFramesPct: 2,                             // % frames over 16.7 ms while moving, real chip
  draws: 250, gpuMB: 400, heapGrowthMB: 6,      // heap growth after GC over the run
  firstImageS: 2, settledS: 12,
};

async function browserFor(kind) {
  const extra = ['--enable-precise-memory-info', '--js-flags=--expose-gc'];
  return chromium.launch(launchOptions(kind === 'real' ? 'gpu' : 'swiftshader', extra));
}
let realOk = null;
async function hasReal() {
  if (realOk !== null) return realOk;
  if (process.env.PERF_GPU === 'swiftshader') return (realOk = false);
  try { const b = await browserFor('real'); const p = await b.newPage(); const r = await p.evaluate(() => { const gl = document.createElement('canvas').getContext('webgl2'); const e = gl?.getExtension('WEBGL_debug_renderer_info'); return e ? gl.getParameter(e.UNMASKED_RENDERER_WEBGL) : ''; }); await b.close(); realOk = r && !/llvmpipe|softpipe|SwiftShader|Software/i.test(r) ? r : false; } catch { realOk = false; }
  return realOk;
}

/** the main thread's time by area, from a CPU profile (self time) */
function attribute(profile) {
  const nodes = new Map(profile.nodes.map((n) => [n.id, n])), self = new Map();
  const dt = profile.timeDeltas; let total = 0;
  for (let i = 0; i < profile.samples.length; i++) { const id = profile.samples[i], d = (dt[i + 1] ?? dt[i] ?? 0) / 1000; self.set(id, (self.get(id) ?? 0) + d); total += d; }
  const AREAS = [
    ['GC', /\(garbage collector\)/], ['idle', /\(idle\)/], ['program (native, browser)', /\(program\)|\(root\)/],
    ['tiles: decode + compose (surface)', /surface\.ts|drawImage|getImageData|createImageBitmap|decode/], ['tiles: schedule (quadtree, tileset, loader)', /tiles\.ts|quadtree\.ts|loader|sources\.ts|cache/],
    ['vectors: build + ground', /segments\.ts|mesh\.ts|area\.ts|line\.ts|extrusion\.ts|arc\.ts|trail\.ts|features\.ts|earcut|drape/],
    ['points + labels', /points\.ts|text\.ts|custom\.ts/], ['draw submission (graphics)', /webgpu\.ts|webgl2\.ts|renderer\.ts/],
    ['picking', /pick/], ['frame (world, camera, state, when)', /world\.ts|camera|state\.ts|when\.ts|order\.ts|scheduler/],
    ['demo + page', /hello-earth|products\.ts|demos\.ts|main\.ts|presets\.ts/],
  ];
  const by = {}, fns = new Map();
  for (const [id, ms] of self) {
    const n = nodes.get(id), cf = n.callFrame, key = `${cf.functionName || '(anon)'} ${cf.url.split('/').pop()}:${cf.lineNumber + 1}`;
    const s = `${cf.functionName} ${cf.url}`;
    const area = AREAS.find(([, re]) => re.test(s))?.[0] ?? (cf.url ? 'other JS' : 'other native');
    by[area] = (by[area] ?? 0) + ms; fns.set(key, (fns.get(key) ?? 0) + ms);
  }
  const top = [...fns].sort((a, b) => b[1] - a[1]).slice(0, 14).map(([k, v]) => [k, +v.toFixed(1)]);
  return { totalMs: +total.toFixed(0), areas: Object.fromEntries(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([k, v]) => [k, +v.toFixed(1)])), top };
}

/** one run: a page, measured while it moves (the gesture) or sits (a demo), profiled */
async function run({ kind, api, go, gesture = false, phone = false, seconds = 12, extra = '' }) {
  const b = await browserFor(kind);
  const ctx = await b.newContext(phone ? { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } : { viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage(), cdp = await ctx.newCDPSession(page);
  const errors = []; page.on('pageerror', (e) => errors.push(e.message));
  if (phone) await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  const url = `${base}/examples/hello-earth/?go=${go}&graphics=${api}${phone ? '' : '&dpr=1'}${extra}`;
  const t0 = Date.now();
  await page.goto(url);
  await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 90000 });
  // first image and settled (no hole tiles)
  const ready = await page.evaluate(async ({ gestureStart }) => {
    const until = (f, ms) => new Promise((ok) => { const s = performance.now(); const t = () => (f() || performance.now() - s > ms ? ok(performance.now()) : requestAnimationFrame(t)); t(); });
    const { w } = window.aslnutDemo; if (gestureStart) w.go(gestureStart);
    const first = await until(() => { const t = w.stats().tiles; return !t || (t.visible > 0 && t.holes === 0); }, 30000);
    const settled = await until(() => w.report().settled, 30000);
    return { first, settled };
  }, { gestureStart: gesture ? gestureView(0) : null });
  await page.evaluate(() => globalThis.gc?.());
  const heap0 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  await cdp.send('Profiler.enable'); await cdp.send('Profiler.setSamplingInterval', { interval: 200 }); await cdp.send('Profiler.start');
  const m = await page.evaluate(async ({ gesture, seconds, view }) => {
    const viewAt = new Function(`return (${view})`)();
    const dts = [], cpu = [], draws = [], uploads = [], gpu = []; let last = 0;
    const w = window.aslnutDemo.w, g = w.graphics ?? null;
    const t0 = performance.now();
    await new Promise((done) => {
      const tick = (t) => {
        if (last) dts.push(t - last); last = t;
        const s = (t - t0) / 1000;
        if (gesture) w.go(viewAt(s));
        if (w) { const st = w.stats(); cpu.push(st.cpuMs); draws.push(st.draws ?? w.lastDraws?.length ?? 0); uploads.push(st.uploadBytes ?? 0); gpu.push(st.gpuBytes); }
        if (s < seconds) requestAnimationFrame(tick); else done();
      };
      requestAnimationFrame(tick);
    });
    return { dts, cpu, draws, uploads, gpu, api: w.api, size: w.stats().size };
  }, { gesture, seconds, view: gestureView.toString() });
  const { profile } = await cdp.send('Profiler.stop');
  await page.evaluate(() => globalThis.gc?.());
  const heap1 = (await cdp.send('Runtime.getHeapUsage')).usedSize;
  await b.close();
  const q = (a, p) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(p * s.length))] : 0; };
  const fs = frameStats(m.dts.slice(2));
  return {
    kind, api: m.api, go, gesture, phone, size: m.size,
    frames: { ...fs, fps: +(1000 / (m.dts.reduce((a, b) => a + b, 0) / Math.max(1, m.dts.length))).toFixed(1), over16: m.dts.filter((x) => x > 17.5).length },
    cpuMs: { p50: +q(m.cpu, 0.5).toFixed(2), p95: +q(m.cpu, 0.95).toFixed(2), max: +Math.max(0, ...m.cpu).toFixed(1) },
    draws: { p50: q(m.draws, 0.5), max: Math.max(0, ...m.draws) }, uploadKB: { p50: +(q(m.uploads, 0.5) / 1024).toFixed(1), max: +(Math.max(0, ...m.uploads) / 1024).toFixed(0) },
    gpuMB: +(Math.max(0, ...m.gpu) / 1048576).toFixed(0), heapMB: { start: +(heap0 / 1048576).toFixed(1), growth: +((heap1 - heap0) / 1048576).toFixed(2) },
    firstImageS: +(ready.first / 1000).toFixed(2), settledS: +(ready.settled / 1000).toFixed(2), wallS: +((Date.now() - t0) / 1000).toFixed(0),
    main: attribute(profile), errors: errors.slice(0, 4),
  };
}

const results = []; let failed = 0;
const fail = (r, what) => { failed++; (r.fails ??= []).push(what); };
const save = (r) => { results.push(r); writeFileSync(join(OUT, `${r.go}-${r.api.split(' ')[0]}-${r.kind}${r.phone ? '-phone' : ''}.json`), JSON.stringify(r, null, 1)); console.log(`${r.go.padEnd(9)} ${r.api.padEnd(18)} ${r.kind.padEnd(11)} ${r.phone ? 'phone' : 'desk '} frames p50 ${r.frames.p50} p95 ${r.frames.p95} max ${r.frames.max} >33:${r.frames.over33} >100:${r.frames.over100} · cpu ${r.cpuMs.p50}/${r.cpuMs.p95} · draws ${r.draws.p50} · up ${r.uploadKB.p50}/${r.uploadKB.max} KB · gpu ${r.gpuMB} MB · heap +${r.heapMB.growth} MB · first ${r.firstImageS}s settled ${r.settledS}s · GC ${r.main.areas.GC ?? 0} ms${r.fails ? ` · FAIL ${r.fails.join(', ')}` : ''}`); };
const real = await hasReal();
console.log(`real chip: ${real || 'none (SwiftShader only)'}`);

if (SUITE === 'gesture' || SUITE === 'all') {
  // the gesture on a phone emulation: both graphics, on the real chip where there is one
  const runs = [
    ...(real ? [{ kind: 'real', api: 'webgl2', go: 'gesture' }] : []),
    { kind: 'swiftshader', api: 'webgpu', go: 'gesture' }, { kind: 'swiftshader', api: 'webgl2', go: 'gesture' },
  ];
  for (const o of runs) {
    const r = await run({ ...o, go: process.env.PERF_GESTURE_GO ?? 'gesture', gesture: true, phone: true, seconds: 24, extra: '&gesture=0' });
    if (o.kind === 'real') { if (r.frames.p95 > BUDGET.gesture.p95) fail(r, `gesture p95 ${r.frames.p95} > ${BUDGET.gesture.p95}`); if (r.frames.max > BUDGET.gesture.max) fail(r, `gesture max ${r.frames.max} > ${BUDGET.gesture.max}`); }
    save(r);
  }
}
if (SUITE === 'demos' || SUITE === 'all') {
  for (const go of (process.env.PERF_DEMOS ?? 'regions,fleet,crime,energy,flows,story').split(',')) for (const api of ['webgpu', 'webgl2']) {
    const kind = api === 'webgl2' && real ? 'real' : 'swiftshader';
    const r = await run({ kind, api, go, seconds: 10, extra: go === 'story' ? '&play=1' : '' });
    // CPU budgets on the real chip's run (SwiftShader's WebGPU spends the same CPU threads drawing: not comparable)
    if (kind === 'real' && r.cpuMs.p50 > BUDGET.cpuMedian) fail(r, `cpu p50 ${r.cpuMs.p50} > ${BUDGET.cpuMedian}`);
    if (kind === 'real' && r.cpuMs.p95 > BUDGET.cpuP95) fail(r, `cpu p95 ${r.cpuMs.p95} > ${BUDGET.cpuP95}`);
    if (r.draws.max > BUDGET.draws) fail(r, `draws ${r.draws.max} > ${BUDGET.draws}`);
    if (r.gpuMB > BUDGET.gpuMB) fail(r, `gpu ${r.gpuMB} MB > ${BUDGET.gpuMB}`);
    if (go !== 'story' && r.firstImageS > BUDGET.firstImageS + 1) fail(r, `first image ${r.firstImageS} s`);
    if (go !== 'story' && r.settledS > BUDGET.settledS + 2) fail(r, `settled ${r.settledS} s`);   // the story plays 30 s of camera keys first
    if (kind === 'real' && r.frames.over16 / Math.max(1, r.frames.n) * 100 > BUDGET.longFramesPct * 5) fail(r, `long frames ${r.frames.over16}`);
    save(r);
  }
}
if (SUITE === 'heap' || SUITE === 'all') {
  // 60 s of the gesture: the heap after GC may not keep growing
  for (const api of ['webgpu', 'webgl2']) {
    const kind = api === 'webgl2' && real ? 'real' : 'swiftshader';
    const r = await run({ kind, api, go: process.env.PERF_GESTURE_GO ?? 'gesture', gesture: true, seconds: 60, extra: '&gesture=0' });
    r.go = 'heap60';
    if (r.heapMB.growth > BUDGET.heapGrowthMB) fail(r, `heap +${r.heapMB.growth} MB over 60 s`);
    save(r);
  }
}
writeFileSync(join(OUT, `summary-${SUITE}.json`), JSON.stringify({ real, budget: BUDGET, results }, null, 1));
srv.close();
console.log(failed ? `${failed} budget failure(s)` : 'all budgets met');
process.exit(failed ? 1 : 0);
