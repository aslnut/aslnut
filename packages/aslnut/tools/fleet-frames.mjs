// The fleet's motion as frames: consecutive frames at 4× on a fixed 60-a-second step (the time set by hand each frame), cropped round a
// moving vehicle and laid side by side, with how far the tracked vehicles moved on screen each frame (steady steps:
// no stepping; every frame on its path: no jitter). WebGL2 on the chip (ASLNUT_GPU=gpu), a phone's view.
//   node tools/fleet-frames.mjs   (EXAMPLES_KEEP_BUILD=1 npx vite build first) → .out/fleet-frames/*.png, steps.json
import { serve } from './serve.mjs';
import { launch, openDemo, settledFrame } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 8398), OUT = join(import.meta.dirname, '..', '.out', 'fleet-frames');
mkdirSync(OUT, { recursive: true });
const srv = await serve(PORT), browser = await launch({ graphics: process.env.ASLNUT_GPU ?? 'gpu' });
const CASES = [
  { name: 'map-dots-trails', q: 'go=city&n=2000&dpr=2', zoom: 16.4, crop: 150 },
  { name: 'twin-cars', q: 'go=close&twin=1&n=10000&dpr=2', crop: 150 },
];
const steps = {};
for (const c of CASES) {
  const api = process.env.API ?? 'webgl2';
  const { page, errors } = await openDemo(browser, `http://127.0.0.1:${PORT}/examples/fleet/?${c.q}&graphics=${api}&clock=60&log=0&t=20`, { width: 390, height: 844 });
  try {
    if (c.zoom) await page.evaluate((z) => { const { w } = window.aslnutDemo, v = w.camera.view; w.go({ lon: v.lon, lat: v.lat, tilt: v.tilt, bearing: v.bearing, zoom: z }); }, c.zoom);
    await settledFrame(page);
    const r = await page.evaluate(async ({ crop }) => {
      const { w, log, fleet, play } = window.aslnutDemo, cam = w.camera, dpr = w.renderer.pixelRatio;
      const at = (s) => cam.project(s.lon, s.lat, (w.heightAt(s.lon, s.lat) || 0) * w.exaggeration + 0.3);
      const now = () => w.time.getTime() - fleet.drive.smooth;
      // a moving vehicle near the middle of the view
      const mid = [cam.width / 2, cam.height * 0.55];
      const cands = log.stateAt(now()).filter((s) => s.speed > 6).map((s) => ({ s, p: at(s) })).filter((x) => x.p).sort((a, b) => Math.hypot(a.p[0] - mid[0], a.p[1] - mid[1]) - Math.hypot(b.p[0] - mid[0], b.p[1] - mid[1]));
      const track = cands.slice(0, 6).map((x) => x.s.id), centre = cands[0].p;
      const frames = [], paths = Object.fromEntries(track.map((id) => [id, []]));
      for (let f = 0; f < 8; f++) {
        play.seek(w.time.getTime() + 4000 / 60);
        // (copied: a read's buffer is not kept past the next read)
        const px = await w.frame();
        frames.push({ width: px.width, height: px.height, pixels: px.pixels.slice() });
        for (const id of track) { const p = at(log.at(id, now())); paths[id].push(p ? [+p[0].toFixed(2), +p[1].toFixed(2)] : null); }
      }
      // crops round the first vehicle's place at the start, device px, side by side
      const W = px0(frames), H = frames[0].height, side = Math.round(crop * dpr), x0 = Math.max(0, Math.min(W - side, Math.round(centre[0] * dpr - side / 2))), y0 = Math.max(0, Math.min(H - side, Math.round(centre[1] * dpr - side / 2)));
      function px0(fs) { return fs[0].width; }
      const out = new Uint8Array(side * frames.length * side * 4);
      frames.forEach((fr, k) => { for (let y = 0; y < side; y++) { const src = ((y0 + y) * W + x0) * 4; out.set(fr.pixels.subarray(src, src + side * 4), (y * side * frames.length + k * side) * 4); } });
      let b = ''; for (let i = 0; i < out.length; i += 32768) b += String.fromCharCode(...out.subarray(i, i + 32768));
      const stepsPx = Object.fromEntries(Object.entries(paths).map(([id, ps]) => [id, ps.slice(1).map((p, i) => (p && ps[i] ? +Math.hypot(p[0] - ps[i][0], p[1] - ps[i][1]).toFixed(2) : null))]));
      return { w: side * frames.length, h: side, b64: btoa(b), stepsPx };
    }, c);
    writeFileSync(join(OUT, `${c.name}-${api}.png`), png(r.w, r.h, new Uint8Array(Buffer.from(r.b64, 'base64'))));
    steps[c.name] = r.stepsPx;
    console.log(c.name, JSON.stringify(r.stepsPx), errors.slice(0, 2));
  } catch (e) { console.log(c.name, 'FAIL', String(e.stack).slice(0, 600)); }
  await page.close();
}
writeFileSync(join(OUT, 'steps.json'), JSON.stringify(steps, null, 1));
await browser.close(); srv.close();
