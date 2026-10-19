// The story regression (hello-earth ?go=story): a short scripted scene (terrain, a fault traced with a glowing head, a zone swept, buildings
// rising, a label typing, towns popping, camera keys) stepped frame by frame on a fixed clock, settled strictly at every
// frame without moving the clock (`settled({ hold })`), and captured at four moments with the credits burned in.
// Checked, on WebGPU AND WebGL2:
//   · deterministic: two runs give the same pixels, frame for frame;
//   · WebGPU and WebGL2 agree (the parity thresholds);
//   · the moments differ (the reveals and the camera move), and each capture carries its attribution.
//   node tools/explainer.mjs   (run `npm run examples` first) · evidence in .out/explainer/
import { serve } from './serve.mjs';
import { launch, openDemo, bytesOf } from './browser.mjs';
import { png } from './png.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MEAN = 1.5, BIG = 0.5, MOMENTS = [2.0, 4.0, 6.0, 8.0], W = 480, H = 320;
const PORT = 8093, OUT = join(import.meta.dirname, '..', '.out', 'explainer');
mkdirSync(OUT, { recursive: true });
const srv = await serve(PORT), browser = await launch();
const run = async (api) => {
  const { page, errors } = await openDemo(browser, `http://127.0.0.1:${PORT}/examples/hello-earth/?go=story&graphics=${api}&quality=realistic&dpr=1&clock=30&play=1&paused=1`, { width: W, height: H });
  try {
    const shots = await page.evaluate(async ({ moments }) => {
      const { w } = window.aslnutDemo; w.stop();
      const out = [], t0 = performance.now();
      let frames = 0;
      for (const at of moments) {
        while (w.now < at * 1000 - 1) { w.step(1000 / 30); frames++; await w.settled({ strict: true, hold: true, timeout: 60000 }); }
        const f = await w.frame({ attribution: true });
        let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768));
        out.push({ at, width: f.width, height: f.height, b64: btoa(bin), credits: w.attribution().join(' · '), shown: w.list.filter((l) => l.shown > 0 && l.kind !== 'sky' && l.kind !== 'basemap').map((l) => l.id) });
      }
      return { shots: out, frames, ms: performance.now() - t0, api: w.api };
    }, { moments: MOMENTS });
    if (errors.length) throw new Error(errors.slice(0, 3).join(' | '));
    if (shots.api !== api) throw new Error(`asked ${api}, got ${shots.api}`);
    return shots;
  } finally { await page.close(); }
};
const hash = (b) => createHash('sha256').update(b).digest('hex').slice(0, 12);
const diff = (a, b) => { let sum = 0, big = 0; for (let i = 0; i < a.length; i += 4) { const x = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2])); sum += x; if (x > 32) big++; } const n = a.length / 4; return { mean: sum / n, bigPct: (100 * big) / n }; };
let fail = false; const report = { moments: MOMENTS, threshold: { mean: MEAN, bigPct: BIG }, runs: {} };
const per = {};
for (const api of ['webgpu', 'webgl2']) {
  const a = await run(api), b = await run(api);
  const same = a.shots.every((s, i) => s.b64 === b.shots[i].b64);
  const moved = a.shots.slice(1).every((s, i) => diff(bytesOf(s), bytesOf(a.shots[i])).bigPct > 1);
  per[api] = a.shots.map(bytesOf);
  a.shots.forEach((s, i) => writeFileSync(join(OUT, `${api}-t${s.at}.png`), png(s.width, s.height, per[api][i])));
  report.runs[api] = { deterministic: same, hashes: a.shots.map((s) => hash(bytesOf(s))), momentsDiffer: moved, frames: a.frames, seconds: +(a.ms / 1000).toFixed(1), credits: a.shots[0].credits, shown: a.shots.map((s) => s.shown.join(',')) };
  console.log(`${same ? 'ok  ' : 'FAIL'} ${api} deterministic: two runs, ${MOMENTS.length} moments, the same pixels (${a.frames} frames settled one by one, ${(a.ms / 1000).toFixed(1)} s)`);
  console.log(`${moved ? 'ok  ' : 'FAIL'} ${api} each moment differs from the one before (reveals, camera keys)`);
  const credited = /synthetic terrain/.test(a.shots[0].credits);
  console.log(`${credited ? 'ok  ' : 'FAIL'} ${api} captures carry the credits: ${a.shots[0].credits}`);
  if (!same || !moved || !credited) fail = true;
}
report.parity = MOMENTS.map((at, i) => { const d = diff(per.webgpu[i], per.webgl2[i]), ok = d.mean < MEAN && d.bigPct < BIG; if (!ok) fail = true; console.log(`${ok ? 'ok  ' : 'FAIL'} t=${at}s WebGPU vs WebGL2: mean |Δ| ${d.mean.toFixed(3)} · > 32: ${d.bigPct.toFixed(3)} %`); return { at, mean: +d.mean.toFixed(3), bigPct: +d.bigPct.toFixed(3), ok }; });
writeFileSync(join(OUT, 'results.json'), JSON.stringify(report, null, 1));
await browser.close(); srv.close();
console.log(`${fail ? 'FAIL' : 'ok  '} explainer regression`);
process.exit(fail ? 1 : 0);
