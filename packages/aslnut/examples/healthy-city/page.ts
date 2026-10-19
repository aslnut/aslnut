// The page's own plumbing: the phone log (the world's: `world({ log })` batches every event, sends a heartbeat a
// second and the governor's steps; before the world, the page's own), errors counted, the build number, and the
// observation panel (which graphics runs and why, frames, tiles, loading, what the budget dropped).
import type { World } from '../../src/index.ts';

declare const __BUILD__: number;
declare const __LOG__: string;
export const BUILD = typeof __BUILD__ === 'number' ? __BUILD__ : 0;
export const q = new URLSearchParams(location.search);
const sid = Math.random().toString(36).slice(2, 8);
// the phone log: to the URL the build names (ASLNUT_EXAMPLES_LOG) or the page's &log=/a/path (the tools'); &log=0: off
const logArg = q.get('log');
const LOG_URL = logArg === '0' ? '' : logArg?.startsWith('/') ? logArg : typeof __LOG__ === 'string' ? __LOG__ : '';
const remote = LOG_URL !== '';
/** the world's log for the phone log (null: none here) */
export const LOG = remote ? { url: LOG_URL, level: 'info' as const, fields: () => ({ sid, page: 'aslnut-city', build: BUILD, go: q.get('go') ?? 'region' }) } : undefined;
let logWorld: World | null = null;
const queued: string[] = [];
let timer = 0;
const flush = () => { timer = 0; if (!queued.length) return; const body = queued.splice(0).join('\n'); void fetch(LOG_URL, { method: 'POST', body, keepalive: body.length < 60000 }).catch(() => {}); };
export function log(ev: string, data: Record<string, unknown> = {}): void {
  if (!remote) return;
  if (logWorld && !logWorld.isDisposed) { logWorld.log(ev, data); return; }
  queued.push(JSON.stringify({ sid, page: 'aslnut-city', build: BUILD, go: q.get('go') ?? 'region', ev, t: Math.round(performance.now()), ...data }));
  if (!timer) timer = setTimeout(flush, 2000) as unknown as number;
}
export const errors: string[] = [];
const counts = new Map<string, number>(); let errT = 0;
export function noteError(msg: string): void {
  errors.push(msg); if (errors.length > 40) errors.shift();
  counts.set(msg, (counts.get(msg) ?? 0) + 1);
  if (!errT) errT = setTimeout(() => { errT = 0; log('errors', { list: [...counts].map(([m, n]) => ({ msg: m, n })) }); counts.clear(); }, 2000) as unknown as number;
}
addEventListener('error', (e) => noteError(String(e.message)));
addEventListener('unhandledrejection', (e) => noteError(String((e.reason as Error)?.message ?? e.reason)));
addEventListener('pagehide', flush);

/** frame times of the last seconds (the gaps between drawn frames, for the panel) */
const dts: number[] = [];
export function watchFrames(w: World): void {
  logWorld = w; flush();
  // the world's drawn frames, not a loop of the page's own (a still view draws nothing and the page rests with it);
  // a gap longer than a quarter of a second is a rest, not a slow frame
  let last = 0;
  w.on('frame', () => { const t = performance.now(); if (last && t - last < 250) { dts.push(t - last); if (dts.length > 600) dts.shift(); } last = t; });
}
export function frameStats(xs: number[]): { p50: number; p95: number; max: number; over33: number } {
  if (!xs.length) return { p50: 0, p95: 0, max: 0, over33: 0 };
  const s = [...xs].sort((a, b) => a - b);
  return { p50: Math.round(s[s.length >> 1]!), p95: Math.round(s[Math.floor(s.length * 0.95)]!), max: Math.round(s[s.length - 1]!), over33: xs.filter((x) => x > 33.4).length };
}

/** a rate in words: every display frame, n a second */
const rate = (r: number) => (r === Infinity ? 'every frame' : `${Math.round(r)}/s`);
/** the observation panel's content: which graphics and why, the quality (the device's pick, the governor's drops), the
 *  budget and what each layer costs against it, frames drawn on demand (resting: none) */
export function panelHTML(w: World, links: string): string {
  const s = w.stats(), t = s.tiles as Record<string, number> | null, p = w.frameProfile(), f = frameStats(dts.slice(-120)), rep = w.report(), tm = w.telemetry(), ob = w.observation;
  const api = s.api === 'webgpu' ? 'WebGPU' : s.api === 'webgl2' ? 'WebGL2' : s.api, b = tm.budget;
  const fr = tm.frames, frames = fr.resting ? '<span class="webgpu">resting</span> · 0 fps' : `${fr.fps} fps${fr.wants ? ` · ${esc(fr.who)} ${rate(fr.wants)}` : ''}`;
  const costly = tm.elements.filter((x) => x.draws || x.gpuMB >= 1 || x.wants).sort((a, c) => c.ms + c.gpuMB / 20 - (a.ms + a.gpuMB / 20)).slice(0, 6);
  return `<div class="row"><b>healthy city · build ${BUILD}</b><span class="${s.api}">${api}</span></div>
    <div class="row"><span>${frames} · p95 ${f.p95} ms · ${f.over33} long</span><span>${s.draws} draws${p.gpuMs !== null ? ` · gpu ${p.gpuMs.toFixed(1)} ms` : ''}</span></div>
    <div class="why">quality ${tm.quality.now} (${esc(tm.quality.why)}${tm.quality.tier ? `, ${tm.quality.tier} tier` : ''}) · ${s.size[0]}×${s.size[1]} @${s.pixelRatio}</div>
    <div class="why">${b ? `budget ${b.frameMs ?? '–'} ms${b.memoryMB ? ` · ${b.memoryMB} MB` : ''}: frames ${tm.frameMs} ms (p95 ${tm.frameP95})${tm.dropped.length ? ` · dropped ${tm.dropped.join(', ')}` : ' · nothing dropped'}` : `no budget · frames ${tm.frameMs} ms (p95 ${tm.frameP95})`}</div>
    <div class="row"><span>zoom ${s.zoom.toFixed(1)}${ob ? ` · level <b>${esc(ob.level)}</b>${ob.waiting ? ' …' : ''}${ob.swapping ? ' (swapping)' : ''}` : ''}</span><span>${t ? `tiles ${t.visible} · loading ${t.loading}` : ''}</span></div>
    ${ob ? `<div class="why">observation: ${ob.ladder.map((r) => (r.name === ob.level ? `<b>${esc(r.name)}</b>` : esc(r.name))).join(' › ')} · changes ${ob.counts.changes} · swaps ${ob.counts.swaps} (waited ${Math.round(ob.counts.waitedMs)} ms) · let go ${ob.counts.released}</div>` : ''}
    <div class="row"><span>gpu ${tm.memoryMB.toFixed(0)} MB · ${(tm.triangles / 1000).toFixed(0)}k tri${s.heapBytes ? ` · heap ${(s.heapBytes / 1048576).toFixed(0)} MB` : ''}</span><span>${rep.settled ? '<span class="webgpu">settled</span>' : 'settling'}</span></div>
    <div class="why">${costly.map((x) => `${esc(x.id)} ${x.draws}d ${x.ms}ms ${x.gpuMB}MB${x.wants ? ` ${rate(x.wants)}` : ''}`).join(' · ')}</div>
    <div class="why">${s.elements.filter((x) => x.kind !== 'sky').map((x) => `${x.id} ${x.shown >= 1 ? '●' : x.shown > 0 ? '◐' : '○'}`).join(' · ')}</div>
    ${errors.length ? `<div class="err">${errors.slice(-5).map((e) => e.replace(/</g, '&lt;')).join('\n')}</div>` : ''}
    <div>${links}</div>`;
}
const esc = (x: unknown) => String(x ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
