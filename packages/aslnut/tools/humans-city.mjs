// The humans in the healthy-city example, on WebGPU and WebGL2: the walk view (a ready-made person walked by the keys,
// the camera behind, the light crowd round them) and the crowd on the street from a little higher; frames to
// .out/humans/ (run `npm run examples` first).
//   node tools/humans-city.mjs [person] [people] [radius]
import { serve } from './serve.mjs';
import { launch, openDemo, settledFrame, bytesOf } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [person = 'office-worker', count = '40', radius = '60'] = process.argv.slice(2);
const OUT = join(import.meta.dirname, '..', '.out', 'humans'), PORT = Number(process.env.PORT ?? 8734);
mkdirSync(OUT, { recursive: true });
const srv = await serve(PORT), browser = await launch();
const base = `http://127.0.0.1:${PORT}/examples/healthy-city/`;
const frame = (page) => page.evaluate(async () => { const { w } = window.aslnutDemo; const f = await w.frame(); let bin = ''; for (let i = 0; i < f.pixels.length; i += 32768) bin += String.fromCharCode(...f.pixels.subarray(i, i + 32768)); return { width: f.width, height: f.height, b64: btoa(bin) }; });
for (const api of (process.env.APIS ?? 'webgpu,webgl2').split(',')) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-street&graphics=${api}&quality=realistic&dpr=1&clock=30&log=0&person=${person}&people=${count}&radius=${radius}`, { width: 480, height: 640 });
  try {
    await settledFrame(page);
    // walk: the crowd made round the person, a few seconds along the street
    const walk = await page.evaluate(async () => {
      const { w, av, people } = window.aslnutDemo, c = people.crowd, key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
      av.setMode('walk'); await w.settled({ timeout: 60000 });
      const t0 = performance.now(); while (c.figures().made < c.figures().wanted && performance.now() - t0 < 90000) { w.step(33); await w.frame(); }
      for (let i = 0; i < 40; i++) w.step(50);
      key('keydown', 'KeyW'); for (let i = 0; i < 30; i++) { w.step(50); if (i % 6 === 5) await w.frame(); }
      await w.frame();
      return { mode: av.mode, kmh: Math.round(av.kmh), avatar: w.element('avatar').bodyCounts(), crowd: w.element('people').bodyCounts(), far: w.element('people').counts().instances, figures: c.figures() };
    });
    writeFileSync(join(OUT, `city-walk-${api}.png`), png(480, 640, bytesOf(await frame(page))));
    // the crowd from a little higher, round where the person walked
    const crowd = await page.evaluate(async () => {
      const { w, av } = window.aslnutDemo, at = [av.me.at[0], av.me.at[1]], key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
      key('keyup', 'KeyW'); av.setMode('map'); w.camera.minDist = 3;
      w.go({ lon: at[0], lat: at[1], dist: 17 / w.camera.frameK, tilt: 72, bearing: av.me.heading });
      for (let i = 0; i < 20; i++) w.step(50);
      await w.settled({ timeout: 60000 });
      return { skinned: w.element('people').bodyCounts(), far: w.element('people').counts().instances };
    });
    writeFileSync(join(OUT, `city-crowd-${api}.png`), png(480, 640, bytesOf(await frame(page))));
    console.log(`${api}: walk ${JSON.stringify(walk)} · crowd ${JSON.stringify(crowd)} · errors: ${errors.length ? errors.slice(0, 3).join(' | ') : 'none'}`);
  } catch (e) { console.log(`${api}: FAIL ${e.message.slice(0, 400)} · ${errors.slice(0, 3).join(' | ')}`); }
  await page.close();
}
await browser.close(); srv.close();
