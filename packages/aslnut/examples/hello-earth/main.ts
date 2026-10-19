import { presetOf } from '../preset.ts';
// hello-earth: a world on the page, which graphics runs and why, and what it is doing (the observation panel).
//   ?go=globe | bandung | flat | webgl2 | zoom | plane | vectors | crime | crime-pmtiles | answer | energy
//       | parity | parity-globe | parity-flat | parity-plane | parity-vectors | parity-crime | parity-energy | parity-answer
//   &graphics=auto | webgpu | webgl2   &quality=lite | realistic   &clock=30 (a fixed step per frame)   &play=1 (camera keys)
//   &paused=1 (nothing draws until stepped: the explainer regression steps it)
import { AslnutError, GraphicsUnavailable, keys, supported, world, type Custom, type World } from '../../src/index.ts';
import { HOOK_TESTS, PRESETS } from './presets.ts';
import * as heatShader from './heat.shader.ts';
import { frameStats, gestureView } from './gesture.ts';

declare const __BUILD__: number;
declare const __LOG__: string;
const BUILD = typeof __BUILD__ === 'number' ? __BUILD__ : 0;
const q = new URLSearchParams(location.search);
const go = presetOf(q, Object.keys(PRESETS), 'bandung');
const preset = PRESETS[go]!;
const want = (q.get('graphics') ?? preset.graphics ?? 'auto') as 'auto' | 'webgpu' | 'webgl2';
const panel = document.getElementById('panel')!;
const errors: string[] = [];
const sid = Math.random().toString(36).slice(2, 8);
// the phone log: to the URL the build names (ASLNUT_EXAMPLES_LOG) or the page's &log=/a/path (the tools'); &log=0:
// off, for the tools that read the world's own counters
const logArg = q.get('log');
const LOG_URL = logArg === '0' ? '' : logArg?.startsWith('/') ? logArg : typeof __LOG__ === 'string' ? __LOG__ : '';
const remote = LOG_URL !== '';
// the phone log never costs a frame: events queue up and go together (one JSON line each), at most one request every
// 2 s; a burst of long frames keeps its first 20 per batch and counts the rest
const queued: string[] = [];
let logTimer = 0, longsInBatch = 0, longsDropped = 0;
const flushLog = () => {
  logTimer = 0;
  if (longsDropped) { queued.push(JSON.stringify({ sid, page: 'aslnut-hello', build: BUILD, go, ev: 'long-dropped', n: longsDropped, t: Math.round(performance.now()) })); longsDropped = 0; }
  longsInBatch = 0;
  if (!queued.length) return;
  const body = queued.splice(0).join('\n');
  void fetch(LOG_URL, { method: 'POST', body, keepalive: body.length < 60000 }).catch(() => {});
};
const log = (ev: string, data: Record<string, unknown> = {}) => {
  if (!remote) return;
  if (ev === 'long' && ++longsInBatch > 20) { longsDropped++; return; }
  queued.push(JSON.stringify({ sid, page: 'aslnut-hello', build: BUILD, go, ev, t: Math.round(performance.now()), ...data }));
  if (!logTimer) logTimer = setTimeout(flushLog, 2000) as unknown as number;
};
// errors never cost a frame: counted by message and sent together, at most one request every 2 s (a burst of the
// same error is one line with its count); the panel keeps the last few
const errCounts = new Map<string, number>();
let errUnsent = 0, errTimer = 0;
const flushErrors = () => {
  errTimer = 0; if (!errUnsent) return;
  const list = [...errCounts].map(([msg, n]) => ({ msg, n })); errCounts.clear(); errUnsent = 0;
  log('errors', { list });
};
const noteError = (msg: string) => {
  errors.push(msg); if (errors.length > 50) errors.shift();
  errCounts.set(msg, (errCounts.get(msg) ?? 0) + 1); errUnsent++;
  if (!errTimer) errTimer = setTimeout(flushErrors, 2000) as unknown as number;
};
addEventListener('error', (e) => noteError(String(e.message)));
addEventListener('unhandledrejection', (e) => noteError(String((e.reason as Error)?.message ?? e.reason)));
addEventListener('pagehide', () => { flushErrors(); flushLog(); });

const link = (k: string, g?: string) => { const u = new URLSearchParams(q); u.set('go', k); if (g) u.set('graphics', g); else u.delete('graphics'); return `?${u}`; };
const presetLinks = () => Object.keys(PRESETS).filter((k) => !k.startsWith('parity-')).map((k) => `<a href="${link(k)}" class="${k === go ? 'on' : ''}">${k}</a>`).join('')
  + ` <a href="${link(go, 'webgpu')}" class="${want === 'webgpu' ? 'on' : ''}">webgpu</a><a href="${link(go, 'webgl2')}" class="${want === 'webgl2' ? 'on' : ''}">webgl2</a>`;

async function main(): Promise<void> {
  const canvas = document.getElementById('view') as HTMLCanvasElement;
  const sup = await supported();
  const nav = navigator as Navigator & { deviceMemory?: number };
  log('start', { want, support: sup, dpr: devicePixelRatio, screen: [screen.width, screen.height], css: [innerWidth, innerHeight], memory: nav.deviceMemory ?? null, cores: nav.hardwareConcurrency ?? null, ua: navigator.userAgent });
  let w: World;
  try {
    w = await world(canvas, {
      body: preset.body(), view: preset.view, graphics: want,
      // a globe to street world: looked at by levels (its imagery, terrain and parts by level)
      observation: { levels: 'default' },
      quality: (q.get('quality') as 'lite' | 'realistic' | null) ?? undefined,
      clock: q.get('clock') ? { fps: Number(q.get('clock')) } : 'real',
      time: preset.deterministic ? new Date(Date.UTC(2026, 9, 12, 4, 0, 0)) : 'now',
      pixelRatio: q.get('dpr') ? Number(q.get('dpr')) : undefined,
      autostart: q.get('paused') !== '1',
      // &ground=tiles | prisms: how marks on the ground are drawn (default: aslnut's own choice for the quality)
      groundMarks: q.get('ground') === 'tiles' ? 'tiles' : q.get('ground') === 'prisms' ? 'prisms' : undefined,   // &paused=1: the tools step it frame by frame
      // &context=video: the full reveals (a recorded scene); an app fades
      context: q.get('context') === 'video' || preset.context === 'video' ? 'video' : 'app',
      onError: (e) => { const m = e instanceof AslnutError ? `${e.message}` : String((e as Error)?.message ?? e); noteError(m); },
    });
  } catch (e) {
    // speak plainly about which graphics could run and why
    const why = e instanceof GraphicsUnavailable ? `${e.message}<br>WebGPU here: ${sup.webgpu ? 'yes' : 'no'} · WebGL2 here: ${sup.webgl2 ? 'yes' : 'no'}` : String((e as Error).message);
    panel.innerHTML = `<b>aslnut · build ${BUILD}</b><div class="err">${why.replace(/</g, '&lt;').replace(/&lt;br>/g, '<br>')}</div><div id="presets">${presetLinks()}</div>`;
    log('fail', { msg: String((e as Error).message) }); flushLog();
    return;
  }
  log('device', { api: w.api, renderer: w.stats().device, reason: w.stats().reason });
  w.add(...preset.layers());
  const ui = document.getElementById('ui')!;
  if (preset.ui) { ui.style.display = 'block'; preset.ui(w, ui.querySelector('.body') as HTMLElement); (ui.querySelector('.head') as HTMLElement).onclick = () => ui.classList.toggle('closed'); (ui.querySelector('.title') as HTMLElement).textContent = preset.title; }
  if (preset.ready) await preset.ready(w);
  // the camera is the person's: nothing moves it when the page opens. A flight (camera keys) plays from its button
  // (&play=1: the tools), the gesture test from "Run auto test" (&gesture=1: at once); a touch stops either
  const bar = document.getElementById('auto')!, barText = document.getElementById('auto-text')!, barBtn = document.getElementById('auto-btn') as HTMLButtonElement;
  const playFlight = () => { const k = keys(preset.keys!.map((x) => ({ ...x }))); (w.element('surface') as unknown as { prefetch?(v: unknown[]): void } | undefined)?.prefetch?.(preset.keys!.map((x) => x.view)); void w.play(k); };
  if (preset.keys && q.get('play') === '1') playFlight();
  let gesture = q.get('gesture') === '1', gt0 = 0;
  const showBar = () => {
    if (!preset.keys && go !== 'gesture' && !gesture) { bar.style.display = 'none'; return; }
    bar.style.display = 'flex'; bar.classList.toggle('playing', gesture);
    barText.textContent = gesture ? 'auto test playing' : go === 'gesture' ? 'the camera is yours' : 'a flight is ready';
    barBtn.textContent = gesture ? 'Stop' : go === 'gesture' ? 'Run auto test' : 'Play flight';
  };
  barBtn.onclick = () => {
    if (gesture) { gesture = false; log('auto', { on: false, why: 'stop' }); }
    else if (go === 'gesture') { gesture = true; gt0 = performance.now(); log('auto', { on: true }); }
    else if (preset.keys) playFlight();
    showBar();
  };
  // a touch anywhere on the map stops the auto test (the library already ends flights, keys and follow)
  canvas.addEventListener('pointerdown', () => { if (gesture) { gesture = false; log('auto', { on: false, why: 'touch' }); showBar(); } }, true);
  canvas.addEventListener('wheel', () => { if (gesture) { gesture = false; showBar(); } }, { capture: true, passive: true });
  showBar();
  const dts: number[] = [];
  { let last = 0; const tick = (t: number) => { if (w.isDisposed) return; if (last) { dts.push(t - last); if (dts.length > 720) dts.shift(); } last = t; if (gesture) w.go(gestureView((t - gt0) / 1000)); requestAnimationFrame(tick); }; requestAnimationFrame(tick); }
  // hook tests (?hook=points.color …): the tools check each one's effect in the pixels, on both graphics
  const hook = q.get('hook');
  if (hook && HOOK_TESTS[hook]) { const h = HOOK_TESTS[hook]!; const l = w.element(h.layer === 'surface' ? 'surface' : 'places') as unknown as { setShader(c: unknown): Promise<void> }; await l.setShader(h.code); }

  // the shader editor: change the heat layer's fragment code live; errors name your line
  const heat = (() => { try { return w.element('heat') as Custom; } catch { return null; } })();
  if (heat && preset.editor) {
    const ed = document.getElementById('editor')!, ta = document.getElementById('sh') as HTMLTextAreaElement, st = document.getElementById('sh-state')!;
    const gain = document.getElementById('gain') as HTMLInputElement, gv = document.getElementById('gain-v')!;
    ed.style.display = innerWidth > 700 || q.get('editor') === '1' ? 'block' : 'none';
    ta.value = heatShader.fragment.trim();
    let t: ReturnType<typeof setTimeout> | undefined;
    const apply = (fragment: string) => heat.setShader({ fragment }).then(() => { st.textContent = `ok on ${w.api === 'webgpu' ? 'WebGPU' : 'WebGL2'}`; st.className = 'why'; }, (e: Error) => { st.textContent = e.message.replace(/^aslnut /, ''); st.className = 'err'; });
    ta.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => void apply(ta.value), 350); });
    gain.value = String(w.get('heat.gain')); gv.textContent = gain.value;
    gain.addEventListener('input', () => { w.set('heat.gain', Number(gain.value)); gv.textContent = gain.value; });
    if (import.meta.hot) import.meta.hot.accept('./heat.shader.ts', (m) => { if (m) { ta.value = (m.fragment as string).trim(); void heat.setShader({ vertex: m.vertex as string, fragment: m.fragment as string }); } });
  }

  // the preset links fold away (the panel is redrawn often: remember whether they are open)
  let presetsOpen = false;
  panel.addEventListener('toggle', (e) => { if ((e.target as HTMLElement).id === 'presets') presetsOpen = (e.target as HTMLDetailsElement).open; }, true);
  const pr = (n: number) => (n / 1048576).toFixed(0);
  const draw = () => {
    if (w.isDisposed) return;
    const s = w.stats(), t = s.tiles as Record<string, number> | null, l = s.loader;
    const rep = w.report();
    panel.innerHTML = `<div class="row"><b>aslnut · hello earth</b><span>build ${BUILD}</span></div>
      <div class="row"><span class="api ${s.api}">${s.api === 'webgpu' ? 'WebGPU' : s.api === 'webgl2' ? 'WebGL2' : s.api}</span><span>${s.fps.toFixed(0)} fps · ${s.cpuMs.toFixed(1)} ms cpu</span></div>
      <div class="row"><span>${s.draws} draws · ${(s.uploadBytes / 1024).toFixed(0)} KB up${(() => { const p = w.frameProfile(); return p.gpuMs !== null ? ` · gpu ${p.gpuMs.toFixed(1)} ms` : ''; })()}</span><span>${s.heapBytes ? `heap ${(s.heapBytes / 1048576).toFixed(0)} MB` : ''}${s.skipped ? ` · idle ${Math.round((100 * s.skipped) / Math.max(1, s.skipped + s.drawn))} %` : ''}</span></div>
      ${(() => { const f = frameStats(dts); return `<div class="row"><span>frames p50 ${f.p50} · p95 ${f.p95} · max ${f.max} ms</span><span>${f.over33} long</span></div>`; })()}
      <div class="why">${s.reason} · quality ${s.quality} · ${s.size[0]}×${s.size[1]} @${s.pixelRatio}</div>
      <div class="row"><span>zoom ${s.zoom.toFixed(1)}</span><span>${t ? `tiles ${t.visible} · z${t.zMin}–${t.zMax}` : ''}</span></div>
      ${t ? `<div class="row"><span>loading ${t.loading} · in flight ${t.inflight}</span><span>cached ${t.cached}/${t.layers}</span></div><div class="row"><span>failed ${t.failed} · missed ${t.missed} · stopped ${t.aborted ?? 0}</span><span>${rep.settled ? '<span class="webgpu">settled</span>' : 'settling'}</span></div>` : ''}
      <div class="row"><span>net ${l.tiers.network} · mem ${l.tiers.memory} · ${pr(l.bytesNetwork)} MB</span><span>gpu ${pr(s.gpuBytes)} MB</span></div>
      <div class="why">${s.elements.filter((x) => x.kind !== 'sky').map((x) => `${x.id} ${x.shown >= 1 ? '●' : x.shown > 0 ? '◐' : '○'}`).join(' · ')}</div>
      ${errors.length ? `<details><summary>${errors.length} error(s)</summary><div class="err">${errors.slice(-6).map((e) => e.replace(/</g, '&lt;')).join('\n')}</div></details>` : ''}
      <details id="presets"${presetsOpen ? ' open' : ''}><summary>presets · ${go}</summary>${presetLinks()}</details>`;
  };
  setInterval(draw, 300); draw();
  // telemetry for the phone log: a heartbeat a second (frame times of that second, where the last frame's time went),
  // and every long frame (> 50 ms after the one before) with its breakdown, at most 4 a second
  let hbFrom = 0, longN = 0, longSec = 0, upMaxSec = 0, drawnAt = 0;
  // the longest single upload of each second (the graphics keep the last frame's)
  w.on('frame', () => { const m = w.frameProfile().uploadMaxMs; if (m > upMaxSec) upMaxSec = m; });
  setInterval(() => {
    if (w.isDisposed) return;
    const s = w.stats(), t = s.tiles as Record<string, number> | null, p = w.frameProfile(), f = frameStats(dts.slice(hbFrom)); hbFrom = dts.length;
    log('hb', { api: s.api, fps: Math.round(s.fps), zoom: +s.zoom.toFixed(2), moving: w.camera.moving || gesture, auto: gesture, p50: f.p50, p95: f.p95, max: f.max, long: f.over33, tiles: t?.visible, loading: t?.loading, inflight: t?.inflight, queued: p.surface?.queued, stopped: t?.aborted, failed: t?.failed, gpuMB: Math.round(s.gpuBytes / 1048576), heapMB: s.heapBytes ? Math.round(s.heapBytes / 1048576) : null, size: p.size, pr: p.pixelRatio, draws: p.draws, longTasks: p.longTasks, longTaskMs: p.longTaskMs, errors: errors.length, gpuMs: p.gpuMs, passes: p.passes, upMax: upMaxSec, drawn: s.drawn - drawnAt, why: remote ? w.drawnWhy() : undefined }); upMaxSec = 0; drawnAt = s.drawn;
    if (hbFrom > 600) { dts.splice(0, hbFrom); hbFrom = 0; }
  }, 1000);
  w.on('long', ({ gapMs, profile }) => {
    const sec = Math.floor(performance.now() / 1000); if (sec !== longSec) { longSec = sec; longN = 0; } if (++longN > 4) return;
    const t = w.stats().tiles as Record<string, number> | null;
    log('long', { gap: Math.round(gapMs), zoom: +w.camera.zoom.toFixed(2), moving: w.camera.moving || gesture, ...profile, loading: t?.loading, inflight: t?.inflight });
  });
  (window as unknown as { aslnutDemo: unknown }).aslnutDemo = { w, go, preset, errors, build: BUILD, presets: Object.keys(PRESETS) };
}
void main();
