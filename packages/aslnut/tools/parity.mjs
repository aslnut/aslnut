// The parity check: the same frame on WebGPU and on WebGL2, pixel-diffed, for every deterministic example preset
// (no network: procedural imagery, synthetic terrain, the points with hooks, the custom layer, the plane). A mirrored
// shader bug shows as whole regions; float differences between the APIs stay tiny. Over the threshold, the run fails.
//   node tools/parity.mjs   (run `npm run examples` first) · evidence in .out/parity/
//   ('example/preset&more=query' adds to the page's query: healthy-city/parity-street&theme=dark is the analysis view)
import { serve } from './serve.mjs';
import { launch, openDemo, settledFrame, bytesOf } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const MEAN = 1.5, BIG = 0.5;   // mean |Δ| per pixel (of 255), % of pixels off by more than 32
const PORT = Number(process.env.PORT ?? 8095), OUT = join(import.meta.dirname, '..', '.out', 'parity');
mkdirSync(OUT, { recursive: true });
const PRESETS = (process.argv[2] ?? 'parity,parity-globe,parity-flat,parity-plane,parity-vectors,parity-crime,parity-energy,parity-answer,parity-regions,parity-fleet,parity-flows,parity-flows-flat,parity-story,parity-city,parity-players,parity-drape,parity-people,healthy-city/parity-region,healthy-city/parity-street,healthy-city/parity-rain,healthy-city/parity-street&theme=dark,fleet/parity,fleet/parity-close,fleet/parity-charge,fleet/parity-charge&houses=neutral,fleet/parity-charge&houses=raised,tile-lines&ground=tiles,layers/top&parity=1,layers/tilt&parity=1,layers/street&parity=1&twin=1,layers/street&parity=1&twin=1&areas=ground,layers/groups&parity=1,journey/parity,journey/parity&tier=displaced').split(',');
// both graphics on one rasterizer (SwiftShader): the chip's WebGL2 against SwiftShader's WebGPU differs in edges and glyphs
const srv = await serve(PORT), browser = await launch({ graphics: process.env.ASLNUT_GPU ?? 'swiftshader' });
let fail = false; const rows = [];
const shot = async (go, api) => {
  // 'example/preset' for another example's presets (default hello-earth)
  const [ex, g] = go.includes('/') ? go.split('/') : ['hello-earth', go];
  const { page, errors } = await openDemo(browser, `http://127.0.0.1:${PORT}/examples/${ex}/?go=${g}&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0`, { width: 480, height: 320 });
  try { const r = await settledFrame(page); if (r.api !== api) throw new Error(`asked ${api}, got ${r.api}`); if (errors.length) throw new Error(errors.join('; ')); return r; } finally { await page.close(); }
};
for (const go of PRESETS) {
  try {
    const g = await shot(go, 'webgpu'), l = await shot(go, 'webgl2');
    const a = bytesOf(g), b = bytesOf(l), d = new Uint8Array(a.length);
    let sum = 0, big = 0;
    for (let i = 0; i < a.length; i += 4) {
      const x = Math.max(Math.abs(a[i] - b[i]), Math.abs(a[i + 1] - b[i + 1]), Math.abs(a[i + 2] - b[i + 2]));
      sum += x; if (x > 32) big++;
      d[i] = d[i + 1] = d[i + 2] = Math.min(255, x * 8); d[i + 3] = 255;
    }
    const n = a.length / 4, mean = sum / n, bigPct = (100 * big) / n, ok = mean < MEAN && bigPct < BIG;
    if (!ok) fail = true;
    const f = go.replace('/', '-').replace(/[&=]/g, '-'); writeFileSync(join(OUT, `${f}-webgpu.png`), png(g.width, g.height, a)); writeFileSync(join(OUT, `${f}-webgl2.png`), png(l.width, l.height, b)); writeFileSync(join(OUT, `${f}-diff.png`), png(g.width, g.height, d));
    rows.push({ go, mean: +mean.toFixed(3), bigPct: +bigPct.toFixed(3), ok });
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${go.padEnd(14)} mean |Δ| ${mean.toFixed(3)} / 255 · pixels off by > 32: ${bigPct.toFixed(3)} %`);
  } catch (e) { fail = true; rows.push({ go, error: e.message }); console.log(`FAIL ${go.padEnd(14)} ${e.message.slice(0, 300)}`); }
}
await browser.close(); srv.close();
writeFileSync(join(OUT, 'results.json'), JSON.stringify({ threshold: { mean: MEAN, bigPct: BIG }, rows }, null, 1));
process.exit(fail ? 1 : 0);
