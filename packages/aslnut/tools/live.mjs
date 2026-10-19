// Live recording: a flight from the globe (camera keys, 14 s; LIVE_GO=zoom → Bandung, crime-fly → Melbourne's
// choropleth, energy-fly → the energy map) recorded as it plays, in real time, with
// the real network, at phone size, on WebGPU AND WebGL2. Not settled frames: what a person sees while it moves.
// Each sampled frame is measured: blank (one colour or black), holes (ground with nothing loaded: the `missing`
// colour), pale (the `empty` sea colour where imagery should be). Numbers side by side; evidence in .out/live/.
//   node tools/live.mjs [baseUrl]   (default: the tools' own server on the built examples)
import { serve } from './serve.mjs';
import { launch, openDemo } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const OUT = join(import.meta.dirname, '..', '.out', 'live');
mkdirSync(OUT, { recursive: true });
const PORT = 8096, own = !process.argv[2];
const base = process.argv[2] ?? `http://127.0.0.1:${PORT}/examples/hello-earth/`;
const srv = own ? await serve(PORT) : null, browser = await launch();
const W = 390, H = 844, SECONDS = Number(process.env.LIVE_SECONDS ?? 24), GO = process.env.LIVE_GO ?? 'zoom';
const summary = {};
for (const api of (process.env.LIVE_APIS ?? 'webgpu,webgl2').split(',')) {
  const { page, errors } = await openDemo(browser, `${base}?go=${GO}&graphics=${api}&dpr=1&play=1`, { width: W, height: H });
  const r = await page.evaluate(async ({ seconds, keep }) => {
    const { w } = window.aslnutDemo;
    const MISSING = [13, 20, 31], EMPTY = [201, 227, 242];
    const near = (p, i, c, t) => Math.abs(p[i] - c[0]) <= t && Math.abs(p[i + 1] - c[1]) <= t && Math.abs(p[i + 2] - c[2]) <= t;
    const out = [], shots = [], t0 = performance.now();
    let settledAt = null;
    while (performance.now() - t0 < seconds * 1000) {
      const f = await w.frame(), p = f.pixels, n = p.length / 4, low = Math.floor(f.height / 3) * f.width * 4;
      let miss = 0, pale = 0, dark = 0, lowN = 0; const cols = new Map();
      for (let i = 0; i < p.length; i += 4) {
        if (near(p, i, MISSING, 6)) miss++;
        if (i >= low) { lowN++; if (near(p, i, EMPTY, 8)) pale++; }
        if (p[i] + p[i + 1] + p[i + 2] < 9) dark++;
        if (i % 64 === 0) { const k = (p[i] >> 3) * 1024 + (p[i + 1] >> 3) * 32 + (p[i + 2] >> 3); cols.set(k, (cols.get(k) ?? 0) + 1); }
      }
      const top = Math.max(...cols.values()) / (n / 16);
      const s = w.stats(), t = s.tiles ?? {}, tt = (performance.now() - t0) / 1000;
      out.push({ t: +tt.toFixed(2), zoom: +s.zoom.toFixed(2), fps: +s.fps.toFixed(1), holes: t.holes, standIns: t.standIns, missing: +(100 * miss / n).toFixed(2), pale: +(100 * pale / lowN).toFixed(2), dark: +(100 * dark / n).toFixed(1), oneColour: +(100 * top).toFixed(1), tiles: t.visible, loading: t.loading, failed: t.failed, missed: t.missed });
      if (settledAt === null && tt > 14 && w.report().settled) settledAt = tt;
      if (out.length % keep === 1) { let bin = ''; for (let i = 0; i < p.length; i += 32768) bin += String.fromCharCode(...p.subarray(i, i + 32768)); shots.push({ t: tt, w: f.width, h: f.height, b64: btoa(bin) }); }
      await new Promise((ok) => setTimeout(ok, 200));
    }
    return { samples: out, shots, settledAt, api: w.api, reason: w.reason, loader: w.loader.stats().tiers };
  }, { seconds: SECONDS, keep: 6 });
  for (const s of r.shots) writeFileSync(join(OUT, `${GO === 'zoom' ? '' : `${GO}-`}${api}-t${s.t.toFixed(1).padStart(4, '0')}.png`), png(s.w, s.h, new Uint8Array(Buffer.from(s.b64, 'base64'))));
  const S = r.samples, during = S.filter((x) => x.t <= 14.5);
  const blank = S.filter((x) => x.oneColour > 97 || x.dark > 97).length;
  // the first image: until the base is in, the globe is the `missing` colour (start-up, not a hole in flight)
  const first = S.findIndex((x) => x.holes === 0), after = first < 0 ? [] : S.slice(first);
  const holes = after.filter((x) => x.holes > 0).length, paleF = after.filter((x) => x.pale > 1).length;
  summary[api] = {
    api: r.api, reason: r.reason, samples: S.length, fpsMedian: S.map((x) => x.fps).sort((a, b) => a - b)[S.length >> 1],
    firstImageS: first < 0 ? null : S[first].t, blankFramesAfterFirst: after.filter((x) => x.oneColour > 97 || x.dark > 97).length, blankFrames: blank,
    framesWithHoleTiles: holes, worstHoleTiles: Math.max(0, ...after.map((x) => x.holes)), framesWithPale: paleF, worstPalePct: Math.max(0, ...after.map((x) => x.pale)),
    standInsMax: Math.max(0, ...after.map((x) => x.standIns)),
    duringFlight: { samples: during.length, framesWithHoleTiles: during.filter((x) => S.indexOf(x) >= first && x.holes > 0).length, worstPalePct: Math.max(0, ...during.filter((x) => S.indexOf(x) >= first).map((x) => x.pale)) },
    settledAfterArrivalS: r.settledAt === null ? null : +(r.settledAt - 14).toFixed(1), failedTiles: S.at(-1)?.failed, missedTiles: S.at(-1)?.missed, loader: r.loader, errors: errors.slice(0, 5),
  };
  writeFileSync(join(OUT, `${GO === 'zoom' ? '' : `${GO}-`}${api}.json`), JSON.stringify({ summary: summary[api], samples: S }, null, 1));
  console.log(api, JSON.stringify(summary[api]));
  await page.close();
}
await browser.close(); srv?.close();
writeFileSync(join(OUT, `${GO === 'zoom' ? '' : `${GO}-`}summary.json`), JSON.stringify(summary, null, 1));
