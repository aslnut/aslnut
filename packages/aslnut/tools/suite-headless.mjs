// Run the performance suite (examples/suite) headless at phone size, as a phone would: the page holds its result
// (window.suiteResult); this writes it to --out and prints the report.
//   node tools/suite-headless.mjs [--gpu real|swiftshader] [--quick] [--only a,b] [--engines webgl2,webgpu]
//                                 [--set focus|soak] [--base <url>] [--cpu 4] [--uncapped] [--out file.json]
// --base: where the built examples are (their root, holding examples/); default: served here by tools/serve.mjs
// real: WebGL2 on the machine's GPU (Chrome: GPU_CHROME, else the installed one; where WebGPU has no adapter, it is
// skipped); swiftshader: software WebGL2 and WebGPU (a weak-GPU stand-in).
// --uncapped: frames as fast as they can be drawn (no vsync): a frame's time is its cost, where at 60 Hz most cases
// read 16.7 ms on a desktop GPU whatever they cost.
import { writeFileSync } from 'node:fs';
import { report } from './suite-report.mjs';
import { launchOptions, playwright } from './browser.mjs';
import { serve } from './serve.mjs';

const arg = (k, d) => { const i = process.argv.indexOf(`--${k}`); return i < 0 ? d : process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : true; };
const PORT = 8098, srv = arg('base', null) ? null : await serve(PORT);
const gpu = arg('gpu', 'real'), base = String(arg('base', `http://127.0.0.1:${PORT}`)).replace(/\/$/, ''), free = arg('uncapped', false) ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [];
const { chromium } = await playwright();
const browser = await chromium.launch(launchOptions(gpu === 'real' ? 'gpu' : 'swiftshader', ['--enable-precise-memory-info', ...free]));
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
if (arg('cpu', null)) { const cdp = await ctx.newCDPSession(page); await cdp.send('Emulation.setCPUThrottlingRate', { rate: Number(arg('cpu')) }); }
const qs = new URLSearchParams({ auto: '1' });
if (arg('quick', false)) qs.set('quick', '1');
if (arg('only', null)) qs.set('only', arg('only'));
if (arg('engines', null)) qs.set('engines', arg('engines'));
if (arg('set', null)) qs.set('set', arg('set'));
const t0 = Date.now();
await page.goto(`${base}/examples/suite/?${qs}`);
let lastProg = '';
const timer = setInterval(async () => { try { const p = await page.textContent('#prog'); if (p && p !== lastProg) { lastProg = p; process.stderr.write(`[${Math.round((Date.now() - t0) / 1000)} s] ${p} · ${await page.textContent('#what')}\n`); } } catch { /* navigating */ } }, 2000);
await page.waitForFunction(() => window.suiteResult?.done, null, { timeout: 90 * 60 * 1000, polling: 2000 });
clearInterval(timer);
const result = await page.evaluate(() => window.suiteResult);
result.headless = { gpu, cpuThrottle: arg('cpu', null), uncapped: free.length > 0, wallS: Math.round((Date.now() - t0) / 1000), pageErrors: errors.slice(0, 20) };
const out = arg('out', null);
if (out) writeFileSync(out, JSON.stringify(result, null, 1));
console.log(report(result));
await browser.close();
srv?.close();
