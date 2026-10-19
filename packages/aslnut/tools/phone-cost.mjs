// What a preset costs on a phone-sized view (390 × 844 at dpr 2: 780 × 1688 px): CPU ms a frame (the median of 120
// frames drawn back to back with the view still: collecting and handing over the draw calls), draws, GPU memory, and at rest (3 s of a
// settled, still view): frames drawn a second (0: the page rests), the display frames still asked for a second, the
// main thread's busy ms a second, and why frames were drawn. Healthy-city presets on WebGL2 (the chip) and WebGPU.
// Run `npm run examples` first; ASLNUT_DIST=<another build's dist-examples> measures that build (the "before").
//   node tools/phone-cost.mjs parity-street,twin [webgl2,webgpu] [realistic|auto|lite]
//   (quality: realistic (default, as earlier reports measured), lite, or auto: no &quality=, a touch screen emulated:
//    what a phone picks for itself)
//   MEMORY=1 lists the graphics memory by layer and the largest holdings by label
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';

const [goArg = 'parity-street', apiArg = 'webgl2,webgpu', quality = 'realistic'] = process.argv.slice(2), PORT = Number(process.env.PORT ?? 8751);
const srv = await serve(PORT), browser = await launch();
for (const go of goArg.split(',')) for (const api of apiArg.split(',')) {
  const touch = quality === 'auto';
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, hasTouch: touch });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  try {
    await page.goto(`http://127.0.0.1:${PORT}/examples/healthy-city/?${go.includes('=') ? go : `go=${go}`}&graphics=${api}${touch ? '' : `&quality=${quality}`}&dpr=2&log=0`);
    await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 120000 });
    const cdp = await page.context().newCDPSession(page); await cdp.send('Performance.enable');
    const busy = async () => { const m = (await cdp.send('Performance.getMetrics')).metrics; return (m.find((x) => x.name === 'TaskDuration')?.value ?? 0) * 1000; };
    await page.evaluate(async () => { const { w } = window.aslnutDemo; await w.settled({ timeout: 150000 }).catch(() => {}); await new Promise((ok) => setTimeout(ok, 4000)); w.drawnWhy(); });
    // at rest: 3 s of a settled, still view
    const b0 = await busy(), t0 = Date.now();
    const rest = await page.evaluate(async () => {
      const { w } = window.aslnutDemo, s0 = w.stats(), f0 = w.report().frames;
      await new Promise((ok) => setTimeout(ok, 3000));
      const s1 = w.stats(), why = Object.entries(w.drawnWhy()).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([k, v]) => `${k} ${v}`).join(', ');
      return { frames: w.report().frames - f0, asked: (s1.skipped - s0.skipped) + (s1.drawn - s0.drawn), why };
    });
    const secs = (Date.now() - t0) / 1000, busyMs = (await busy()) - b0;
    const r = await page.evaluate(async (wantMemory) => {
      const { w } = window.aslnutDemo;
      // (frames drawn back to back, as while the view moves: a frame drawn after a rest runs on a cooled-down CPU, some
      // 10 to 30 % slower on this machine; everyFrame keeps them coming where the build has it)
      const cpu = [], off = w.everyFrame?.(() => {});
      for (let i = 0; i < 120; i++) { w.invalidate(); await new Promise((ok) => requestAnimationFrame(() => requestAnimationFrame(ok))); const p = w.frameProfile(); cpu.push(p.tickMs + p.submitMs); }
      off?.(); cpu.sort((a, b) => a - b);
      const s = w.stats(), p = w.frameProfile(), t = w.telemetry?.();
      return { api: s.api, cpuMs: +cpu[60].toFixed(2), draws: p.draws, gpuMB: Math.round(s.gpuBytes / 1048576), heapMB: s.heapBytes ? Math.round(s.heapBytes / 1048576) : null, size: p.size, quality: s.quality, pr: s.pixelRatio,
        memory: wantMemory && t ? t.memory.slice(0, 8).map((m) => `${m.id} ${m.MB}`).join(' · ') : '', held: wantMemory && w.graphics.memory ? w.graphics.memory().slice(0, 10).map((h) => `${h.label} ${(h.bytes / 1048576).toFixed(1)}${h.count > 1 ? ` ×${h.count}` : ''}`).join(' · ') : '' };
    }, !!process.env.MEMORY);
    console.log(`${go.padEnd(24)} ${r.api.padEnd(6)} ${r.quality}@${r.pr} ${r.cpuMs} ms · ${r.draws} draws · ${r.gpuMB} MB gpu${r.heapMB ? ` · ${r.heapMB} MB heap` : ''} · at rest: ${(rest.frames / secs).toFixed(1)} frames/s drawn (${rest.why || 'none'}), ${(rest.asked / secs).toFixed(1)} display frames/s asked, ${(busyMs / secs).toFixed(1)} ms/s main thread · ${r.size.join('×')}${errors.length ? ` · errors: ${errors.slice(0, 2).join(' | ')}` : ''}`);
    if (r.memory) console.log(`   memory by layer (MB): ${r.memory}\n   largest: ${r.held}`);
  } catch (e) { console.log(`${go} ${api} FAIL ${String(e.message).slice(0, 300)}`); }
  await page.close();
}
await browser.close(); srv.close();
