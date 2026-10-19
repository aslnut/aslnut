// The regions demo's answer flight ("Which regency of West Java has the most stunting?"), measured on a phone
// emulation (CPU 4× slower, 390 × 844, DPR 3): frame times while it flies and draws West Java's regencies, and the
// breakdown of every long frame (w.frameProfile). WebGL2 on the machine's GPU where there is one, and SwiftShader.
//   node tools/answer-flight.mjs [q=0]
import { serve } from './serve.mjs';
import { frameStats } from '../examples/hello-earth/gesture.ts';
import { launchOptions, playwright } from './browser.mjs';
const { chromium } = await playwright();
const PORT = 8099, srv = await serve(PORT), Q = process.argv[2] ?? '0';
const kinds = [
  ['real', () => chromium.launch(launchOptions('gpu'))],
  ['swiftshader', () => chromium.launch(launchOptions('swiftshader'))],
];
for (const [kind, open] of kinds) {
  const b = await open(), ctx = await b.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }), page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
  await page.goto(`http://127.0.0.1:${PORT}/examples/hello-earth/?go=regions&graphics=webgl2`);
  await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 60000 });
  const r = await page.evaluate(async (q) => {
    const { w } = window.aslnutDemo; await w.settled({ timeout: 60000 }).catch(() => {});
    const longs = []; w.on('long', (e) => longs.push({ gap: Math.round(e.gapMs), ...e.profile }));
    const dts = []; let last = 0, run = true; const tick = (t) => { if (last) dts.push(t - last); last = t; if (run) requestAnimationFrame(tick); }; requestAnimationFrame(tick);
    document.querySelector(`[data-q="${q}"]`).click();
    await new Promise((ok) => setTimeout(ok, 7000)); run = false;
    return { dts, longs: longs.slice(0, 12), device: w.stats().device };
  }, Q);
  const f = frameStats(r.dts);
  console.log(`${kind.padEnd(11)} answer ${Q}: frames p50 ${f.p50} p95 ${f.p95} max ${f.max} >33:${f.over33} >100:${f.over100} · ${r.device}`);
  for (const l of r.longs.slice(0, 6)) console.log(`   long ${l.gap} ms · tick ${l.tickMs.toFixed(1)} submit ${l.submitMs.toFixed(1)} · ${l.layers.map(([k, v]) => `${k} ${v}`).join(', ')} · surface ${JSON.stringify(l.surface)} · up ${l.uploads}/${Math.round(l.uploadBytes / 1024)} KB · draws ${l.draws} · ${l.size.join('×')}@${l.pixelRatio} · longTasks ${l.longTasks}/${l.longTaskMs} ms`);
  await b.close();
}
srv.close();
