// The performance suite: one URL, START, wait. Every case runs on WebGL2 and WebGPU (where the device has it), the
// same function each time (same data, camera path, duration, pixel ratio), each run built
// fresh and torn down. Frame times come from the display's frames; each run's result is sent as it ends, when the
// build names where (ASLNUT_EXAMPLES_LOG: a line per run; ASLNUT_EXAMPLES_RESULTS: the whole run as JSON), so a run
// that dies midway keeps what it measured. The finished run is also on the page (window.suiteResult).
//   ?quick=1  ?auto=1  ?only=fast-zoom,hover  ?engines=webgl2,webgpu  ?pr=1.5 (the equal pixel ratio)
//   ?set=focus (a set of cases, repeated: see SETS in cases.ts)
//   (cases marked optional run only when ?only= or a set names them)
// A crash shows: each run says 'case-start' before it starts and a heartbeat every 4 s while it runs, so the log names
// the run that died; what the page holds (heap, live graphics) goes with every run; reopened after a crash, the page
// offers to go on from the next run into the same result file.
import { liveGraphics, supported, world, type LiveGraphics, type World } from '../../src/index.ts';
import { CASES, SETS, type Case, type Ctx } from './cases.ts';
import { loadData, type SuiteData } from './data.ts';
import type { PathView } from './path.ts';
import { fpsSeries, median, pct, summarize, type FrameSummary } from './stats.ts';

declare const __BUILD__: number;
declare const __LOG__: string;
declare const __RESULTS__: string;
const BUILD = typeof __BUILD__ === 'number' ? __BUILD__ : 0;
const q = new URLSearchParams(location.search);
let sid = Math.random().toString(36).slice(2, 8);
// where it is sent (the build's ASLNUT_EXAMPLES_LOG / _RESULTS, or the page's &log=/a/path; &log=0: no log)
const logArg = q.get('log');
const LOG_URL = logArg === '0' ? '' : logArg?.startsWith('/') ? logArg : typeof __LOG__ === 'string' ? __LOG__ : '';
const RESULTS_URL = typeof __RESULTS__ === 'string' ? __RESULTS__ : '';
const remote = RESULTS_URL !== '';
const $ = (id: string) => document.getElementById(id)!;
const stage = $('stage');
$('build').textContent = `build ${BUILD}`;
type Engine = 'webgl2' | 'webgpu';
const ENGINE_NAME: Record<Engine, string> = { webgl2: 'aslnut · WebGL2', webgpu: 'aslnut · WebGPU' };

// ── sending: each run to the log (one line), the whole result to the results URL (each only when the build names it)
const post = (url: string, body: string) => (url ? fetch(url, { method: 'POST', body, keepalive: body.length < 60000 }).then((r) => (r.ok && r.headers.get('content-type')?.includes('json') ? r.json() : null)).catch(() => null) : Promise.resolve(null));
const logLine = (ev: string, data: Record<string, unknown>) => post(LOG_URL, JSON.stringify({ sid, page: 'suite', build: BUILD, ev, t: Math.round(performance.now()), ...data }));

// ── what the device is ──────────────────────────────────────────────────────────────────────────────────────────
function deviceInfo() {
  const nav = navigator as Navigator & { deviceMemory?: number };
  let renderer = '', vendor = '';
  try {
    const c = document.createElement('canvas'), gl = c.getContext('webgl2');
    const dbg = gl?.getExtension('WEBGL_debug_renderer_info');
    if (gl && dbg) { renderer = String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)); vendor = String(gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)); }
    gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { /* none */ }
  return { renderer, vendor, memory: nav.deviceMemory ?? null, cores: nav.hardwareConcurrency ?? null, ua: navigator.userAgent, screen: [screen.width, screen.height], css: [innerWidth, innerHeight], dpr: devicePixelRatio, coarse: matchMedia('(pointer: coarse)').matches };
}

// ── an engine running one case ──────────────────────────────────────────────────────────────────────────────────
interface Sample { tickMs?: number; submitMs?: number; uploadMaxMs?: number; drawn: number; gpuMs: number | null; cpuMs: number | null; uploads: number; uploadBytes: number; draws: number; loading: number }
interface Running { api: string; drive(v: PathView): void; sample(): Sample; hover?(x: number, y: number): void; toggle?(on: boolean): void; info(): Record<string, unknown>; dispose(): void }

async function startAslnut(api: 'webgl2' | 'webgpu', c: Case, ctx: Ctx, pr: number | undefined, errors: string[]): Promise<Running> {
  const canvas = document.createElement('canvas'); stage.append(canvas);
  const side = c.aslnut(ctx), v0 = c.path(0);
  const initAt = performance.now();
  let w: World;
  try {
    w = await world(canvas, { body: side.body, view: v0, graphics: api, pixelRatio: pr, resolution: c.pr === 'default' ? undefined : { moving: 0 }, ...(c.groundMarks ? { groundMarks: c.groundMarks } : {}), onError: (e) => errors.push(String((e as Error)?.message ?? e)) });
  } catch (e) { canvas.remove(); throw e; }
  const worldMs = performance.now() - initAt;
  w.add(...side.layers);
  if (c.toggle) w.hide(c.toggle.layer);
  // measuring starts from the first complete image (settled); what it waited for, and until
  // when (ms from the start of the wait), goes with the result
  const waitedFor: Record<string, number> = {}, w0 = performance.now();
  const watch = setInterval(() => { for (const p of w.report().pending) { const k = p.replace(/\d+/g, 'N').slice(0, 70); waitedFor[k] = Math.round(performance.now() - w0); } }, 100);
  const settledOk = await w.settled({ timeout: 25000 }).catch(() => false);
  clearInterval(watch);
  const settleMs = Math.round(performance.now() - w0);
  let lastDrawn = -1, drawn = 0;
  return {
    api: w.api,
    drive: (v) => { w.go(v); },
    sample: () => {
      const s = w.stats(), p = w.frameProfile(), fresh = s.drawn !== lastDrawn; lastDrawn = s.drawn; drawn = s.drawn;
      const t = s.tiles as Record<string, number> | null;
      return { tickMs: fresh ? p.tickMs : undefined, submitMs: fresh ? p.submitMs : undefined, uploadMaxMs: fresh ? p.uploadMaxMs : undefined, drawn, gpuMs: fresh ? p.gpuMs : null, cpuMs: fresh ? +(p.tickMs + p.submitMs).toFixed(2) : null, uploads: fresh ? p.uploads : 0, uploadBytes: fresh ? p.uploadBytes : 0, draws: p.draws, loading: t?.loading ?? 0 };
    },
    hover: (x, y) => { canvas.dispatchEvent(new PointerEvent('pointermove', { clientX: x, clientY: y, pointerType: 'mouse', buttons: 0, bubbles: true })); },
    toggle: (on) => { if (c.toggle) { if (on) w.reveal(c.toggle.layer); else w.hide(c.toggle.layer); } },
    info: () => { const s = w.stats(); return { api: s.api, quality: s.quality, reason: s.reason, device: s.device, size: s.size, pr: s.pixelRatio, gpuMB: Math.round(s.gpuBytes / 1048576), tiles: s.tiles, firstComplete: settledOk, readyStages: { worldMs: Math.round(worldMs), settleMs }, waitedFor, drawnWhy: w.drawnWhy() }; },
    dispose: () => { w.dispose(); if (api === 'webgl2') { try { (canvas.getContext('webgl2') as WebGL2RenderingContext | null)?.getExtension('WEBGL_lose_context')?.loseContext(); } catch { /* gone */ } } canvas.remove(); },
  };
}

// ── one run: build, drive the path for the case's time, measure every frame, tear down ─────────────────────────
interface RunResult {
  case: string; title: string; engine: Engine; api: string; quick: boolean; dur: number; prAsked: number | 'default'; readyMs: number;
  frames: FrameSummary; phases: Record<string, FrameSummary & { drawn: number }>; fps: number[];
  drawn: number; gpu: { median: number | null; p95: number | null; n: number }; cpu: { median: number | null; p95: number | null };
  gpuEst?: { frameLessCpu: number | null; finish: { median: number | null; p95: number | null; n: number } };
  uploads: number; uploadKB: number; draws: number | null; loadingMax: number; loadingEnd: number;
  longTasks: { n: number; ms: number }; heapMB: { start: number | null; end: number | null }; hidden: boolean;
  info: Record<string, unknown>; errors: string[]; failed?: string;
  /** which repeat of the case (1…) in a set */
  rep?: number;
  /** what the page holds: before the run was built, and once it was torn down (aslnut's graphics, both kinds; the JS
   *  heap where the browser tells it, MB) */
  mem?: { before: LiveGraphics & { heapMB: number | null }; after: LiveGraphics & { heapMB: number | null } };
  /** the page died during this run (found when it was opened again) */
  crashed?: boolean;
}
const longTasks: { at: number; ms: number }[] = [];
try { new PerformanceObserver((l) => { for (const e of l.getEntries()) longTasks.push({ at: e.startTime, ms: e.duration }); }).observe({ type: 'longtask', buffered: false }); } catch { /* not here */ }
const heap = () => { const m = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory; return m ? Math.round(m.usedJSHeapSize / 1048576) : null; };
const held = () => ({ ...liveGraphics(), bytes: Math.round(liveGraphics().bytes / 1048576), heapMB: heap() });
const sleep = (ms: number) => new Promise((ok) => setTimeout(ok, ms));
const frame = () => new Promise<number>((ok) => requestAnimationFrame(ok));
const sameView = (a: PathView, b: PathView) => a.lon === b.lon && a.lat === b.lat && a.zoom === b.zoom && a.tilt === b.tilt && a.bearing === b.bearing;

const EQUAL_PR = Number(q.get('pr') ?? Math.min(devicePixelRatio, 1.5));
const prOf = (c: Case): number | undefined => c.pr === 'default' ? undefined : c.pr === 'device' ? devicePixelRatio : typeof c.pr === 'number' ? c.pr : EQUAL_PR;

async function runOne(c: Case, engine: Engine, data: SuiteData, bust: string, quick: boolean, live: (s: string) => void, beat: (o: Record<string, unknown>) => void = () => {}): Promise<RunResult> {
  const errors: string[] = [];
  const onErr = (e: ErrorEvent) => errors.push(String(e.message)); const onRej = (e: PromiseRejectionEvent) => errors.push(String((e.reason as Error)?.message ?? e.reason));
  addEventListener('error', onErr); addEventListener('unhandledrejection', onRej);
  const dur = (quick ? Math.max(4, Math.round(c.dur * 0.6)) : c.dur) * 1000, pr = prOf(c);
  const ctx: Ctx = { data, bust, css: [innerWidth, innerHeight] };
  const base: Omit<RunResult, 'api' | 'readyMs' | 'frames' | 'phases' | 'fps' | 'drawn' | 'gpu' | 'cpu' | 'uploads' | 'uploadKB' | 'draws' | 'loadingMax' | 'loadingEnd' | 'longTasks' | 'heapMB' | 'hidden' | 'info'> = { case: c.id, title: c.title, engine, quick, dur: dur / 1000, prAsked: pr ?? 'default', errors };
  const h0 = heap(), t0 = performance.now(), before = held();
  let run: Running;
  try {
    run = await startAslnut(engine, c, ctx, pr, errors);
  } catch (e) {
    removeEventListener('error', onErr); removeEventListener('unhandledrejection', onRej); stage.innerHTML = '';
    const z: FrameSummary = summarize([]);
    return { ...base, api: engine, readyMs: Math.round(performance.now() - t0), frames: z, phases: {}, fps: [], drawn: 0, gpu: { median: null, p95: null, n: 0 }, cpu: { median: null, p95: null }, uploads: 0, uploadKB: 0, draws: null, loadingMax: 0, loadingEnd: 0, longTasks: { n: 0, ms: 0 }, heapMB: { start: h0, end: heap() }, hidden: document.hidden, info: {}, failed: String((e as Error).message), mem: { before, after: held() } };
  }
  const readyMs = Math.round(performance.now() - t0);
  // measure: drive the path from the case's t = 0 each frame
  const dts: number[] = [], times: number[] = [], drawnAt: [number, number][] = [], gpu: number[] = [], cpu: number[] = [], draws: number[] = [];
  let uploads = 0, uploadBytes = 0, loadingMax = 0, loadingEnd = 0, hidden = false;
  const switchFrames: { atMs: number; gapMs: number; sample: Sample }[] = [];
  const finishMs: number[] = [];
  const start = await frame(); let last = start;
  let lastView = c.path(0); run.drive(lastView);
  const [W, H] = ctx.css;
  const toggles = [...(c.toggle?.at ?? [])].map(([at, on]) => [(at * dur) / c.dur, on] as [number, boolean]);
  let lastBeat = start;
  for (;;) {
    const now = await frame(), t = now - start;
    dts.push(now - last); times.push(t); last = now;
    if (document.hidden) hidden = true;
    if (t >= dur) break;
    const v = c.path(t / 1000); if (!sameView(v, lastView)) { run.drive(v); lastView = v; }
    while (toggles.length && t >= toggles[0]![0]) { run.toggle?.(toggles.shift()![1]); }
    if (now - lastBeat > 4000) { lastBeat = now; beat({ t: Math.round(t), fps: Math.round(1000 / Math.max(1, median(dts.slice(-30)) ?? 16)), ...held() }); }
    if (c.act === 'hover' && run.hover) { const k = t / dur, x = W * (0.15 + 0.7 * (0.5 + 0.5 * Math.sin(k * Math.PI * 6))), y = H * (0.25 + 0.5 * k); run.hover(x, y); }
    const s = run.sample();
    if (c.toggle?.at.some(([at]) => t >= at * dur / c.dur && t < at * dur / c.dur + 600)) switchFrames.push({ atMs: +t.toFixed(2), gapMs: +dts[dts.length - 1]!.toFixed(2), sample: s });
    // the GPU's time where no timer exists (phones): every 30th frame, how long the chip still works after the frame
    // was handed over (gl.finish, the suite only: never in an app)
    if (engine !== 'webgpu' && dts.length % 30 === 0) { const gl = (stage.querySelector('canvas') as HTMLCanvasElement | null)?.getContext('webgl2') as WebGL2RenderingContext | null; if (gl) { const f0 = performance.now(); gl.finish(); finishMs.push(performance.now() - f0); } }
    drawnAt.push([t, s.drawn]);
    if (s.gpuMs !== null && s.gpuMs !== undefined) gpu.push(s.gpuMs);
    if (s.cpuMs !== null) cpu.push(s.cpuMs);
    uploads += s.uploads; uploadBytes += s.uploadBytes; if (s.draws) draws.push(s.draws);
    loadingMax = Math.max(loadingMax, s.loading); loadingEnd = s.loading;
    if (dts.length % 15 === 0) live(`${Math.round(1000 / Math.max(1, median(dts.slice(-15)) ?? 16))} fps`);
  }
  dts.shift(); times.shift();   // the first interval is the start, not a frame of the run
  // one more sample after the last frame, so the GPU timer's late results count
  await frame(); const fin = run.sample(); if (fin.gpuMs !== null && fin.gpuMs !== undefined) gpu.push(fin.gpuMs);
  const info = { ...run.info(), ...(switchFrames.length ? { switchFrames } : {}) };
  const drawnBetween = (a: number, b: number) => { const at = (x: number) => { let v = drawnAt[0]?.[1] ?? 0; for (const [t, d] of drawnAt) { if (t > x) break; v = d; } return v; }; return at(b) - at(a); };
  const phases: RunResult['phases'] = {};
  for (const [name, a, b] of c.phases ?? []) {
    const k = dur / (c.dur * 1000), A = a * 1000 * k, B = b * 1000 * k;
    phases[name] = { ...summarize(dts.filter((_, i) => times[i]! >= A && times[i]! < B)), drawn: drawnBetween(A, B) };
  }
  const lt = longTasks.filter((x) => x.at >= start && x.at <= last);
  try { run.dispose(); } catch (e) { errors.push(`dispose: ${(e as Error).message}`); }
  stage.innerHTML = '';
  const after = held();
  removeEventListener('error', onErr); removeEventListener('unhandledrejection', onRej);
  return {
    ...base, api: run.api, readyMs, frames: summarize(dts), phases, fps: fpsSeries(times, dur), drawn: drawnBetween(0, dur),
    gpu: { median: median(gpu), p95: pct(gpu, 0.95), n: gpu.length }, cpu: { median: median(cpu), p95: pct(cpu, 0.95) },
    // no timer: the frame's time less the main thread's (an estimate), and the chip's work left at gl.finish
    gpuEst: { frameLessCpu: (() => { const a = median(dts), b = median(cpu); return a === null || b === null ? null : +Math.max(0, a - b).toFixed(1); })(), finish: { median: median(finishMs), p95: pct(finishMs, 0.95), n: finishMs.length } },
    uploads, uploadKB: Math.round(uploadBytes / 1024), draws: median(draws), loadingMax, loadingEnd,
    longTasks: { n: lt.length, ms: Math.round(lt.reduce((x, y) => x + y.ms, 0)) }, heapMB: { start: h0, end: heap() }, hidden, info, errors: errors.slice(0, 20),
    mem: { before, after },
  };
}

// ── the whole suite ─────────────────────────────────────────────────────────────────────────────────────────────
interface Plan { set: string | null; only: string[] | null; engines: Engine[]; quick: boolean }
interface Suite { v: 1; sid: string; build: number; started: string; quick: boolean; equalPr: number; device: ReturnType<typeof deviceInfo>; support: unknown; data?: { ms: number; bytes: number }; runs: RunResult[]; done: boolean; ms?: number; partial: boolean; savedAs?: string | null; plan?: Plan; set?: string | null; resumed?: { at: string; after: number }[] }
let wakeLock: { release(): Promise<void> } | null = null;
const keepAwake = async () => { try { wakeLock = await (navigator as Navigator & { wakeLock?: { request(t: string): Promise<{ release(): Promise<void> }> } }).wakeLock?.request('screen') ?? null; } catch { /* not allowed */ } };
document.addEventListener('visibilitychange', () => { if (!document.hidden && running) void keepAwake(); });
let running = false;

const quickBox = $('quick') as HTMLInputElement;
quickBox.checked = q.get('quick') === '1';
const SET = q.get('set') && SETS[q.get('set')!] ? q.get('set')! : null;
const planOf = (quick: boolean): Plan => ({ set: SET, only: q.get('only')?.split(',').filter(Boolean) ?? null, engines: (q.get('engines')?.split(',') ?? ['webgl2', 'webgpu']).filter((e) => e === 'webgl2' || e === 'webgpu') as Engine[], quick });
interface Step { c: Case; e: Engine; rep: number; group: number }
/** the runs, in order: the cases (or a set's groups, each repeated), each on every engine it runs on */
const runsOf = (p: Plan, webgpu: boolean): { steps: Step[]; groups: number } => {
  const engines = p.engines.filter((e) => e !== 'webgpu' || webgpu);
  const on = (c: Case) => engines.filter((e) => !c.engines || c.engines.includes(e)).sort((a, b) => (c.engines ? c.engines.indexOf(a) - c.engines.indexOf(b) : 0));
  if (p.set) {
    const steps: Step[] = [];
    SETS[p.set]!.groups.forEach((g, gi) => {
      const cs = g.cases.map((id) => CASES.find((c) => c.id === id)).filter((c): c is Case => !!c);
      if (g.byEngine) { for (const e of cs[0] ? on(cs[0]) : engines) for (let r = 1; r <= g.reps; r++) for (const c of cs) if (on(c).includes(e)) steps.push({ c, e, rep: r, group: gi }); }
      else for (let r = 1; r <= g.reps; r++) for (const c of cs) for (const e of on(c)) steps.push({ c, e, rep: r, group: gi });
    });
    return { steps, groups: SETS[p.set]!.groups.length };
  }
  const cases = CASES.filter((c) => (p.only ? p.only.includes(c.id) : !c.optional && (!p.quick || c.quick)));
  return { steps: cases.flatMap((c, gi) => on(c).map((e) => ({ c, e, rep: 1, group: gi }))), groups: cases.length };
};
const estimate = (p: Plan, webgpu: boolean) => { const r = runsOf(p, webgpu).steps; return Math.round(r.reduce((a, x) => a + (p.quick ? Math.max(4, Math.round(x.c.dur * 0.6)) : x.c.dur) + 5, 0) / 60 * 10) / 10; };
let sup: { webgpu: boolean; webgl2: boolean } = { webgpu: false, webgl2: true };
void supported().then((s) => { sup = s as typeof sup; showEstimate(); });
const showEstimate = () => { const p = planOf(quickBox.checked); $('est').textContent = `${SET ? `${SETS[SET]!.title} · ` : ''}${runsOf(p, sup.webgpu).steps.length} runs · about ${estimate(p, sup.webgpu)} min · WebGPU here: ${sup.webgpu ? 'yes' : 'no'}`; };
quickBox.onchange = showEstimate; showEstimate();
if (SET) $('title').textContent = `aslnut · ${SET}`;

// ── after a crash: what was saved before each run, offered again when the page opens ────────────────────────────
const SAVE = `aslnut-suite-${SET ?? 'all'}`;
interface Saved { suite: Suite; next: number; running: { i: number; case: string; engine: Engine; rep: number; at: string } | null }
const store = { get(): Saved | null { try { const s = localStorage.getItem(SAVE); return s ? JSON.parse(s) as Saved : null; } catch { return null; } }, set(v: Saved | null) { try { if (v) localStorage.setItem(SAVE, JSON.stringify(v)); else localStorage.removeItem(SAVE); } catch { /* full or blocked: the server still has the runs */ } } };

async function main(resume: Saved | null = null): Promise<void> {
  if (running) return; running = true;
  await keepAwake();
  $('cover').style.display = 'none'; $('top').style.display = 'block';
  const prog = $('prog'), what = $('what'), live = $('live'), bar = $('bar').firstElementChild as HTMLElement;
  const pl = resume?.suite.plan ?? planOf(quickBox.checked), quick = pl.quick;
  const suite: Suite = resume ? resume.suite : { v: 1, sid, build: BUILD, started: new Date().toISOString(), quick, equalPr: EQUAL_PR, device: deviceInfo(), support: sup, runs: [], done: false, partial: true, plan: pl, set: pl.set };
  sid = suite.sid;
  let first = 0;
  if (resume) {
    first = resume.next;
    // the run that was going when the page died: recorded as such, and the suite goes on from the next one
    if (resume.running) {
      const r = resume.running, z = summarize([]);
      suite.runs.push({ case: r.case, title: CASES.find((c) => c.id === r.case)?.title ?? r.case, engine: r.engine, rep: r.rep, quick, dur: 0, prAsked: 'default', api: r.engine, readyMs: 0, frames: z, phases: {}, fps: [], drawn: 0, gpu: { median: null, p95: null, n: 0 }, cpu: { median: null, p95: null }, uploads: 0, uploadKB: 0, draws: null, loadingMax: 0, loadingEnd: 0, longTasks: { n: 0, ms: 0 }, heapMB: { start: null, end: null }, hidden: false, info: {}, errors: [], failed: `the page died during this run (started ${r.at})`, crashed: true });
      first = r.i + 1;
    }
    (suite.resumed ??= []).push({ at: new Date().toISOString(), after: first });
    void logLine('resume', { from: first, died: resume.running });
  } else void logLine('start', { quick, set: pl.set, device: suite.device, support: sup, equalPr: EQUAL_PR });
  prog.textContent = 'loading the data…';
  const data = await loadData();
  suite.data = { ms: data.ms, bytes: data.bytes };
  const { steps, groups } = runsOf(pl, sup.webgpu), t0 = performance.now();
  const cacheKeys = new Map<string, string>();
  for (let i = first; i < steps.length; i++) {
    const { c, e, rep, group } = steps[i]!;
    prog.textContent = `${SET ? 'group' : 'case'} ${group + 1} / ${groups} · ${ENGINE_NAME[e]}${rep > 1 || SET ? ` · #${rep}` : ''}`; what.textContent = c.title; bar.style.width = `${(100 * i) / steps.length}%`; live.textContent = '';
    const bust = !c.cache || c.cache === 'new' ? `${suite.sid}-${i}` : (cacheKeys.get(`${c.cache}-${e}`) ?? (cacheKeys.set(`${c.cache}-${e}`, `${suite.sid}-${c.cache}-${e}`), `${suite.sid}-${c.cache}-${e}`));
    // before the run: saved here (a crash leaves it), and said to the log (the last 'case-start' names the run that died)
    const at = new Date().toISOString();
    store.set({ suite, next: i, running: { i, case: c.id, engine: e, rep, at } });
    const mem = held();
    void logLine('case-start', { i, of: steps.length, case: c.id, engine: e, rep, mem });
    document.body.dataset.phase = 'run';
    const r = await runOne(c, e, data, bust, quick, (s) => { live.textContent = s; }, (o) => { void logLine('beat', { i, case: c.id, engine: e, rep, ...o }); });
    r.rep = rep;
    suite.runs.push(r);
    store.set({ suite, next: i + 1, running: null });
    void logLine('run', { ...r, i, fps: undefined, series: r.fps.length > 160 ? undefined : r.fps });
    void post(RESULTS_URL, JSON.stringify(suite));
    document.body.dataset.phase = 'gap';
    await sleep(1500);   // the garbage collector and the GPU catch up between runs
  }
  document.body.dataset.phase = 'done';
  bar.style.width = '100%';
  suite.done = true; suite.partial = false; suite.ms = Math.round(performance.now() - t0);
  store.set(null);
  const saved = await post(RESULTS_URL, JSON.stringify(suite)) as { file?: string } | null;
  suite.savedAs = saved?.file ?? null;
  void logLine('done', { runs: suite.runs.length, ms: suite.ms, file: suite.savedAs });
  try { await wakeLock?.release(); } catch { /* gone */ }
  running = false;
  showDone(suite);
  (window as unknown as { suiteResult: Suite }).suiteResult = suite;
}

function showDone(s: Suite): void {
  $('top').style.display = 'none';
  const cover = $('cover'); cover.style.display = 'flex';
  $('start').style.display = 'none'; ($('quick').parentElement as HTMLElement).style.display = 'none'; $('est').style.display = 'none'; $('resume').style.display = 'none';
  const cases = [...new Set(s.runs.map((r) => r.case))], engines = [...new Set(s.runs.map((r) => r.engine))];
  // a case run several times: the median run (by frame-time p95)
  const cell = (rs: RunResult[]) => {
    if (!rs.length) return '<td class="dim">–</td>';
    const ok = rs.filter((r) => !r.failed);
    if (!ok.length) return `<td class="bad" title="${(rs[0]!.failed ?? '').replace(/"/g, '')}">${rs.some((r) => r.crashed) ? 'crashed' : 'failed'}</td>`;
    const r = [...ok].sort((a, b) => a.frames.p95 - b.frames.p95)[Math.floor(ok.length / 2)]!, f = r.frames, cls = f.p95 <= 20 ? 'good' : f.p95 > 40 ? 'bad' : '';
    return `<td class="${cls}">${Math.round(f.fps)} · ${f.p95} · ${f.max}${rs.length > 1 ? ` <span class="dim">×${rs.length}</span>` : ''}${rs.length > ok.length ? ' <b class="bad">!</b>' : ''}</td>`;
  };
  const rows = cases.map((id) => `<tr><td>${id}</td>${engines.map((e) => cell(s.runs.filter((r) => r.case === id && r.engine === e))).join('')}</tr>`).join('');
  // what the page held after each soak run (must not grow)
  const soak = s.runs.filter((r) => r.case === 'soak' && r.mem);
  const soakRows = soak.length ? `<p>soak: after each run, live graphics · buffers · textures · MB on the chip · JS heap MB</p><div id="tablewrap2"><table>${soak.map((r) => `<tr><td>${ENGINE_NAME[r.engine]} #${r.rep}</td><td>${r.mem!.after.graphics} · ${r.mem!.after.buffers} · ${r.mem!.after.textures} · ${r.mem!.after.bytes} · ${r.mem!.after.heapMB ?? '–'}</td></tr>`).join('')}</table></div>` : '';
  const done = $('done'); done.style.display = 'block';
  done.innerHTML = `<h1>FINISHED${remote ? ' · results sent' : ''}</h1><p>${s.runs.length} runs in ${Math.round((s.ms ?? 0) / 1000)} s · ${s.savedAs ? `saved as ${s.savedAs}` : remote ? 'not saved (no answer from the server)' : 'local run (not sent)'}${s.resumed?.length ? ` · resumed ${s.resumed.length}× after a crash` : ''}</p>
    <p>fps · p95 ms · worst frame ms</p><div id="tablewrap"><table><tr><th>case</th>${engines.map((e) => `<th>${ENGINE_NAME[e]}</th>`).join('')}</tr>${rows}</table></div>${soakRows}
    <p class="dim">${s.device.renderer} · ${s.device.cores ?? '?'} cores · ${s.device.memory ?? '?'} GB · pixel ratio ${s.equalPr} for the equal cases</p>`;
}

// reopened after the page died midway (same build, same set): go on from the next run, into the same result file
const pendingRun = store.get();
if (pendingRun && pendingRun.suite.build === BUILD && !pendingRun.suite.done) {
  const r = pendingRun.running, n = pendingRun.suite.runs.length;
  const box = $('resume'); box.style.display = 'block';
  $('resume-what').textContent = r ? `The last run stopped during run ${r.i + 1} (${r.case} · ${ENGINE_NAME[r.engine]}${r.rep > 1 ? ` #${r.rep}` : ''}): the page closed or crashed there. ${n} runs were kept.` : `The last run stopped after ${n} runs.`;
  ($('resume-go') as HTMLButtonElement).onclick = () => { box.style.display = 'none'; void main(pendingRun); };
  ($('resume-drop') as HTMLButtonElement).onclick = () => { store.set(null); box.style.display = 'none'; };
} else if (pendingRun) store.set(null);
($('start') as HTMLButtonElement).onclick = () => { store.set(null); void main(); };
if (q.get('auto') === '1') void supported().then((s) => { sup = s as typeof sup; void main(q.get('resume') === '1' && pendingRun && pendingRun.suite.build === BUILD ? pendingRun : null); });
(window as unknown as { aslnutLive: unknown }).aslnutLive = held;
(window as unknown as { suiteMain: unknown }).suiteMain = { cases: CASES.map((c) => c.id), sets: Object.keys(SETS), build: BUILD };
