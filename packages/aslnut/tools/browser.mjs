// The headless browser the tools use, on WebGPU and WebGL2. ASLNUT_GPU picks the graphics it draws on:
//   gpu          Chrome (new headless) with WebGL2 on the machine's own GPU (ANGLE over EGL); where WebGPU has no
//                adapter there, it runs on SwiftShader
//   swiftshader  Chromium's headless shell with WebGPU (SwiftShader / Vulkan) and WebGL2 (ANGLE SwiftShader): any
//                machine, no GPU needed, the slow one (a crowded street frame takes seconds)
//   auto         (default) gpu when it is proven at launch (WebGL2's renderer is a GPU, not SwiftShader), else swiftshader
// (parity compares WebGPU with WebGL2 pixel by pixel: it stays on SwiftShader, both on one rasterizer, unless ASLNUT_GPU
// says otherwise; a GPU's WebGL2 against SwiftShader's WebGPU differs past its thresholds in edges and glyphs)
// At launch the tool prints what each graphics runs on ("graphics: WebGL2 on … · WebGPU on …").
// Where the browsers come from (all optional):
//   PLAYWRIGHT_CORE  playwright-core's entry (default: the package's own devDependency, 'playwright-core')
//   CHROME           a headless shell for swiftshader (default: Playwright's own: npx playwright install chromium-headless-shell)
//   GPU_CHROME       a Chrome for gpu (default: the installed Chrome, Playwright's channel 'chrome')
// A GPU driver that needs its own environment (a driver name, a library path) gets it from the tool's environment,
// passed through as it is.
const PW = process.env.PLAYWRIGHT_CORE || 'playwright-core';
const CHROME = process.env.CHROME || undefined;
const GPU_CHROME = process.env.GPU_CHROME || undefined;
/** playwright-core (from PLAYWRIGHT_CORE, else the package's devDependency) */
export const playwright = () => import(PW);
/** Chromium flags: SwiftShader's WebGPU and WebGL2, and the machine's GPU through ANGLE over EGL */
export const SHELL_ARGS = ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'];
export const GPU_ARGS = ['--headless=new', '--use-angle=gl-egl', '--use-gl=angle', '--ignore-gpu-blocklist'];
/** launch options for a kind of browser ('gpu' or 'swiftshader'), with extra flags */
export function launchOptions(kind, args = []) {
  if (kind === 'gpu') return { ...(GPU_CHROME ? { executablePath: GPU_CHROME } : { channel: 'chrome' }), headless: true, args: [...GPU_ARGS, ...args] };
  return { ...(CHROME ? { executablePath: CHROME } : {}), args: [...SHELL_ARGS, ...args] };
}
const KINDS = {
  swiftshader: () => launchOptions('swiftshader'),
  // (the headless shell finds no EGL config on some GPU drivers: WebGL2 falls back to SwiftShader there, so gpu is Chrome)
  gpu: () => launchOptions('gpu', ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--enable-unsafe-swiftshader']),
};
const SOFT = /SwiftShader|llvmpipe|softpipe|Software/i;
/** what WebGL2 and WebGPU draw on, in this browser (WebGPU wants a secure page: a routed localhost one) */
export async function renderers(browser) {
  const page = await browser.newPage();
  try {
    await page.route('http://localhost/aslnut-renderers', (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>renderers</title>' }));
    await page.goto('http://localhost/aslnut-renderers');
    return await page.evaluate(async () => {
      const gl = document.createElement('canvas').getContext('webgl2'), x = gl?.getExtension('WEBGL_debug_renderer_info');
      const webgl2 = gl ? (x ? gl.getParameter(x.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)) : 'none';
      let webgpu = 'none';
      try {
        const a = await Promise.race([navigator.gpu?.requestAdapter({ powerPreference: 'high-performance' }), new Promise((ok) => setTimeout(ok, 10000))]);
        if (a) webgpu = [a.info.vendor, a.info.architecture, a.info.description].filter(Boolean).join(' ') + (a.info.isFallbackAdapter ? ' (fallback)' : '');
      } catch (e) { webgpu = `failed: ${e.message}`; }
      return { webgl2, webgpu };
    });
  } finally { await page.close(); }
}
// When the browser goes away before the tool closes it, the tool says why at once (not only a page's "Target page,
// context or browser has been closed" later):
//   - a stop from outside: a signal to the tool (`timeout N node tools/…` running out, Ctrl-C, a closed terminal). Playwright
//     then closes the browser itself; the run ends there, failed, saying so. Give a long run its time (smoke-city takes
//     some 25 minutes) or run it in the background, never under a shorter `timeout`;
//   - the browser itself dying (a crash, the GPU process given up), or a page's renderer: said at once, the check fails.
let gone = null;
/** why the browser went away before the tool closed it (null: it did not) */
export const browserGone = () => gone;
/** the tools' browser, on the graphics ASLNUT_GPU picks (auto: the GPU when proven, else SwiftShader) */
export async function launch({ graphics = process.env.ASLNUT_GPU ?? 'auto' } = {}) {
  const { chromium } = await playwright(), MODE = graphics;
  if (!['auto', 'gpu', 'swiftshader'].includes(MODE)) throw new Error(`ASLNUT_GPU=${MODE}: auto, gpu or swiftshader`);
  let b, r, kind = MODE === 'swiftshader' ? 'swiftshader' : 'gpu';
  if (kind === 'gpu') {
    try {
      b = await chromium.launch(KINDS.gpu()); r = await renderers(b);
      if (SOFT.test(r.webgl2) || r.webgl2 === 'none') throw new Error(`WebGL2 on ${r.webgl2}, not a GPU`);
    } catch (e) {
      if (MODE === 'gpu') { await b?.close(); throw new Error(`ASLNUT_GPU=gpu: ${e.message.split('\n')[0]}`); }
      console.log(`graphics: no GPU (${e.message.split('\n')[0]}): SwiftShader`);
      await b?.close().catch(() => {}); b = null; kind = 'swiftshader';
    }
  }
  if (!b) { b = await chromium.launch(KINDS.swiftshader()); r = await renderers(b); }
  console.log(`graphics: ${kind} · WebGL2 on ${r.webgl2} · WebGPU on ${r.webgpu}`);
  const t0 = Date.now(), secs = () => Math.round((Date.now() - t0) / 1000);
  let closing = false; const close = b.close.bind(b);
  b.close = (...a) => { closing = true; return close(...a); };
  for (const [sig, code] of [['SIGTERM', 143], ['SIGHUP', 129]]) process.once(sig, () => {
    gone = `stopped from outside (${sig}) after ${secs()} s: the browser was closed for it, nothing crashed`;
    console.log(`STOP ${gone}`);
    setTimeout(() => process.exit(code), 3000);
  });
  b.on('disconnected', () => {
    if (closing || gone) return;
    gone = `the browser died after ${secs()} s`;
    console.log(`DIED ${gone} (DEBUG=pw:browser node tools/… prints its own output: why)`);
  });
  return b;
}
/** open a hello-earth page and wait for its world */
export async function openDemo(browser, url, { width = 480, height = 320 } = {}) {
  const page = await browser.newPage({ viewport: { width, height } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // a crashed page answers nothing more (an evaluate would wait for ever): closed, so the check fails at once
  page.on('crash', () => { errors.push('the page crashed (its renderer died)'); console.log(`CRASH the page's renderer died: ${url}`); void page.close().catch(() => {}); });
  // (a page of a browser already gone closes quietly: the reason was said once)
  const close = page.close.bind(page); page.close = (...a) => close(...a).catch((e) => { if (!gone) throw e; });
  await page.goto(url);
  await page.waitForFunction(() => window.aslnutDemo?.w || /GraphicsUnavailable|E-GPU/.test(document.getElementById('panel')?.textContent ?? ''), null, { timeout: 60000 });
  return { page, errors };
}
/** the frame as RGBA bytes, after the world settled (strict) */
export async function settledFrame(page, timeout = 180000) {
  return page.evaluate(async (timeout) => {
    const { w } = window.aslnutDemo;
    const t0 = performance.now();
    await w.settled({ strict: true, timeout });
    const f = await w.frame();
    let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768));
    return { width: f.width, height: f.height, b64: btoa(bin), api: w.api, ms: performance.now() - t0, frames: w.report().frames };
  }, timeout);
}
/** base64 → bytes */
export const bytesOf = (r) => new Uint8Array(Buffer.from(r.b64, 'base64'));
