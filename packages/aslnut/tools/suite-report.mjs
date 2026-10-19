// The performance suite's report: WebGL2 and WebGPU, case by case, the worst cases first.
//   node tools/suite-report.mjs [result.json]      (default: the newest file in .misc/suite/)
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ENGINES = ['webgl2', 'webgpu'];
const NAME = { webgl2: 'aslnut WebGL2', webgpu: 'aslnut WebGPU' };
const f1 = (x) => (x === null || x === undefined ? '–' : typeof x === 'number' ? (Math.abs(x) >= 100 ? Math.round(x) : Math.round(x * 10) / 10) : x);
/** WebGPU against WebGL2 on a case: frame-time p95 ratio (> 1: WebGPU slower) */
const ratio = (g, l) => (g && l && !g.failed && !l.failed && l.frames.p95 > 0 ? g.frames.p95 / l.frames.p95 : null);

export function report(s) {
  const out = [];
  const d = s.device ?? {};
  out.push(`# Suite ${s.sid} · build ${s.build} · ${s.started}${s.quick ? ' · quick' : ''}${s.done ? '' : ' · INCOMPLETE'}`);
  out.push(`${d.renderer || '?'} · ${d.cores ?? '?'} cores · ${d.memory ?? '?'} GB · screen ${d.css?.join('×')} @${d.dpr} · equal pixel ratio ${s.equalPr} · WebGPU ${s.support?.webgpu ? 'yes' : 'no'}${s.headless ? ` · headless ${s.headless.gpu}${s.headless.cpuThrottle ? ` CPU ×${s.headless.cpuThrottle}` : ''}${s.headless.uncapped ? ' uncapped' : ''}` : ''}`);
  out.push(`${s.runs.length} runs${s.ms ? ` in ${Math.round(s.ms / 1000)} s` : ''}${s.data ? ` · data ${Math.round(s.data.bytes / 1024)} KB in ${s.data.ms} ms` : ''}${s.set ? ` · set ${s.set} (each cell: the median of its repeats)` : ''}${s.resumed?.length ? ` · resumed ${s.resumed.length}× after the page died` : ''}`);
  const died = s.runs.filter((r) => r.crashed);
  if (died.length) out.push(`\n**The page died during:** ${died.map((r) => `${r.case} · ${NAME[r.engine]}${r.rep ? ` #${r.rep}` : ''}`).join(', ')}`);
  const cases = [...new Set(s.runs.map((r) => r.case))];
  // a case run several times (a set's repeats): the median run by frame-time p95, of those that did not fail
  const all = (c, e) => s.runs.filter((r) => r.case === c && r.engine === e);
  const get = (c, e) => { const rs = all(c, e), ok = rs.filter((r) => !r.failed); return ok.length ? [...ok].sort((a, b) => a.frames.p95 - b.frames.p95)[Math.floor(ok.length / 2)] : rs[0]; };
  const reps = (c, e) => { const n = all(c, e).length; return n > 1 ? ` (×${n})` : ''; };
  const p95 = (r) => (r && !r.failed ? r.frames.p95 : 0);
  const order = cases.map((c) => ({ c, k: ratio(get(c, 'webgpu'), get(c, 'webgl2')) ?? 0, w: Math.max(p95(get(c, 'webgl2')), p95(get(c, 'webgpu'))) })).sort((a, b) => b.w - a.w);
  out.push('\n## Summary (frame p95 ms · fps · worst 1 s fps), the worst first\n');
  out.push(`| case | ${ENGINES.map((e) => NAME[e]).join(' | ')} | WebGPU ÷ WebGL2 p95 |`);
  out.push(`|---|${ENGINES.map(() => '---:').join('|')}|---:|`);
  for (const { c, k } of order) {
    const cells = ENGINES.map((e) => { const r = get(c, e); return !r ? '–' : r.failed ? `failed: ${r.failed.slice(0, 40)}` : `${f1(r.frames.p95)} · ${f1(r.frames.fps)} · ${f1(r.frames.worst1s)}${reps(c, e)}`; });
    out.push(`| ${c} | ${cells.join(' | ')} | ${k ? `${k.toFixed(2)}×` : '–'} |`);
  }
  out.push('\n## Detail\n');
  out.push('| case | engine | size @pr | ready ms | p50 | p95 | p99 | max | >33 | >50 | >100 | fps | worst 1 s | drawn | gpu ms (p50/p95, n) | cpu ms (p50/p95) | uploads · KB | draws | loading max/end | long tasks | heap MB | errors |');
  out.push('|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|---|---|---:|---|---|---|---:|');
  for (const { c } of order) for (const e of ENGINES) {
    const r = get(c, e); if (!r) continue;
    if (r.failed) { out.push(`| ${c} | ${NAME[e]} | | ${r.readyMs} | failed: ${r.failed} |||||||||||||||||`); continue; }
    const f = r.frames, sz = r.info?.size ? `${r.info.size.join('×')} @${f1(r.info.pr)}` : '';
    out.push(`| ${c} | ${NAME[e]} | ${sz} | ${r.readyMs} | ${f1(f.p50)} | ${f1(f.p95)} | ${f1(f.p99)} | ${f1(f.max)} | ${f.over33} | ${f.over50} | ${f.over100} | ${f1(f.fps)} | ${f1(f.worst1s)} | ${r.drawn} | ${r.gpu.n ? `${f1(r.gpu.median)}/${f1(r.gpu.p95)}, ${r.gpu.n}` : r.gpuEst ? `est ${f1(r.gpuEst.frameLessCpu)} · finish ${f1(r.gpuEst.finish.median)}/${f1(r.gpuEst.finish.p95)}` : '–'} | ${f1(r.cpu.median)}/${f1(r.cpu.p95)} | ${r.uploads} · ${r.uploadKB} | ${f1(r.draws)} | ${r.loadingMax}/${r.loadingEnd} | ${r.longTasks.n} · ${r.longTasks.ms} ms | ${r.heapMB.start ?? '–'}→${r.heapMB.end ?? '–'} | ${r.errors.length}${r.hidden ? ' HIDDEN' : ''} |`);
  }
  const ph = s.runs.filter((r) => r.phases && Object.keys(r.phases).length);
  if (ph.length) {
    out.push('\n## Phases (p95 ms · worst frame ms · frames drawn)\n');
    out.push('| case | engine | ' + [...new Set(ph.flatMap((r) => Object.keys(r.phases)))].join(' | ') + ' |');
    const names = [...new Set(ph.flatMap((r) => Object.keys(r.phases)))];
    out.push(`|---|---|${names.map(() => '---').join('|')}|`);
    for (const r of ph) out.push(`| ${r.case}${r.rep ? ` #${r.rep}` : ''} | ${NAME[r.engine]} | ${names.map((n) => (r.phases[n] ? `${f1(r.phases[n].p95)} · ${f1(r.phases[n].max)} · ${r.phases[n].drawn}` : '–')).join(' | ')} |`);
  }
  const stages = s.runs.filter((r) => r.info?.readyStages);
  if (stages.length) {
    out.push('\n## Ready time (ms)\n\n| case | engine | world creation | settling |\n|---|---|---:|---:|');
    for (const r of stages) out.push(`| ${r.case} | ${NAME[r.engine]} | ${r.info.readyStages.worldMs} | ${r.info.readyStages.settleMs} |`);
  }
  const switches = s.runs.filter((r) => r.case === 'layer-appears' && r.info?.switchFrames?.length);
  if (switches.length) {
    out.push('\n## First-show draw frames (display gaps may follow submission; uploads include preparation since the previous visible frame)\n\n| engine | time ms | display gap ms | collect ms | submit ms | uploads | upload KB |\n|---|---:|---:|---:|---:|---:|---:|');
    for (const r of switches) {
      const start = r.dur * 200;
      for (const f of r.info.switchFrames) if (f.atMs >= start && f.atMs < start + 600 && f.sample.cpuMs != null) {
        const p = f.sample;
        out.push(`| ${NAME[r.engine]} | ${f1(f.atMs)} | ${f1(f.gapMs)} | ${f1(p.tickMs)} | ${f1(p.submitMs)} | ${p.uploads} | ${f1(p.uploadBytes / 1024)} |`);
      }
    }
  }
  // what the page held once each run was torn down: aslnut's graphics (both kinds) and the JS heap; a soak must not grow
  const mem = s.runs.filter((r) => r.mem);
  if (mem.length) {
    const left = mem.filter((r) => r.mem.after.graphics || r.mem.after.buffers || r.mem.after.textures || r.mem.after.programs);
    out.push(`\n## Held after each run\n\n${left.length ? `**${left.length} aslnut runs left graphics behind:** ${left.slice(0, 6).map((r) => `${r.case} · ${NAME[r.engine]} (${r.mem.after.graphics} open, ${r.mem.after.buffers} buffers, ${r.mem.after.textures} textures)`).join('; ')}` : `every aslnut run (${mem.length}) left nothing on the chip after dispose`}`);
    const soak = s.runs.filter((r) => r.case === 'soak' && r.mem);
    if (soak.length) {
      out.push('\n| soak run | open graphics · buffers · textures · MB (after) | JS heap MB (before → after) | worst 1 s fps |');
      out.push('|---|---|---|---:|');
      for (const r of soak) out.push(`| ${NAME[r.engine]} #${r.rep ?? ''} | ${r.mem.after.graphics} · ${r.mem.after.buffers} · ${r.mem.after.textures} · ${r.mem.after.bytes} | ${r.mem.before.heapMB ?? '–'} → ${r.mem.after.heapMB ?? '–'} | ${f1(r.frames.worst1s)} |`);
    }
  }
  const errs = s.runs.filter((r) => r.errors?.length);
  if (errs.length) { out.push('\n## Errors\n'); for (const r of errs) out.push(`- ${r.case} · ${NAME[r.engine]}: ${[...new Set(r.errors)].slice(0, 3).join(' | ')}`); }
  return out.join('\n');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  let file = process.argv[2];
  if (!file) {
    const dir = resolve(import.meta.dirname, '..', '..', '..', '.misc', 'suite');
    file = readdirSync(dir).filter((f) => f.endsWith('.json')).map((f) => join(dir, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
  }
  console.log(report(JSON.parse(readFileSync(file, 'utf8'))));
}
