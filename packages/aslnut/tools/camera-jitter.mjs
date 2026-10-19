// camera-jitter: how steady a camera chasing a moving thing is, before → after the follow's damping (core › observation
// › observers › orbit › follow, moves). Two things, sampled as real logs are (once a second, bumpy):
//   car    a curvy road (bends of 120 m, a hill), 13–19 m/s in steps, each sample up to 0.8 m off the road sideways
//   plane  a climbing turn after take-off (75 → 120 m/s, 3° a second, 10 m/s up), each sample up to 2 m off
// and two cameras on each:
//   before  the camera as the demos scripted it (examples/journey before the moves were the library's): the subject
//           where its log says, its heading eased (first order, 0.9 s; the plane's taken as it is), the view set each
//           frame from the subject (w.go), the ground under the centre eased as the world does
//   after   the library's moves.chase, its default damping
// Measured each frame (the world's fixed clock, 30 a second; 60 too for the after): the view's angular acceleration
// (frame to frame: the jitter, °/s²: RMS, p95, max), the eye's acceleration (m/s², RMS), the subject's place on the
// screen frame to frame (its second difference, px: p95). Then the after at 30, 60 and 144 frames a second against
// itself: the same camera (frame-rate independent damping), its largest difference at the same moments.
//   node tools/camera-jitter.mjs                  headless (no graphics: the camera's own numbers)
//   node tools/camera-jitter.mjs --browser [--graphics=webgpu,webgl2] [--port=8541]   the journey's no-network page
//        (go=parity: a mock coast, its terrain), on each graphics (run the examples' build first)
//   → .out/camera-jitter/results.json
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const OUT = join(import.meta.dirname, '..', '.out', 'camera-jitter');
mkdirSync(OUT, { recursive: true });

/** the scene, run where the world is (node or the page): (w, lib, cfg) → the measures. Pure JS: it is sent to the page */
async function scene(w, lib, cfg) {
  const D = Math.PI / 180, KZ = 110574, LON0 = cfg.samples ? cfg.samples[0][1] : 115.1705, LAT0 = cfg.samples ? cfg.samples[0][2] : -8.7230, kx = 111320 * Math.cos(LAT0 * D);
  // (a seeded noise: the same bumps on every run)
  let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 - 0.5; };
  const t0 = cfg.samples ? cfg.samples[0][0] : Date.UTC(2026, 9, 19, 2, 0, 0), start = cfg.start ?? t0 + 1000, rate = cfg.rate ?? 1;
  /** samples: [t ms, x m east, y m north, up m over the ground, the true heading there (no bumps; NaN: not known)] */
  const samples = [];
  if (cfg.samples) for (const [t, lon, lat, up] of cfg.samples) samples.push([t, (lon - LON0) * kx, (lat - LAT0) * KZ, up, NaN]);
  else if (cfg.subject === 'car') {
    let s = 0, x = 0;
    for (let i = 0; i <= cfg.seconds + 2; i++) {
      const v = 13 + 6 * ((Math.floor(i / 4) * 7) % 5) / 4;   // speed steps every 4 s
      // along a curvy road: y = 60 sin(x / 120); x advanced by the arc length
      const y = 60 * Math.sin(x / 120), nx = -Math.cos(x / 120) * 0.5, n = Math.hypot(nx, 1);
      const dydx = 0.5 * Math.cos(x / 120);
      samples.push([t0 + i * 1000, x + (nx / n) * 0.8 * 2 * rnd(), y + (1 / n) * 0.8 * 2 * rnd(), 1, ((Math.atan2(1, dydx) / D) + 360) % 360]);
      x += v / Math.hypot(1, dydx); s += v;
    }
  } else {
    let x = 0, y = 0, h = 90, v = 75, up = 15;
    for (let i = 0; i <= cfg.seconds + 2; i++) {
      samples.push([t0 + i * 1000, x + 1.5 * 2 * rnd(), y + 1.5 * 2 * rnd(), up + 2 * 2 * rnd(), (h + 1.5) % 360]);
      h += 3; v = Math.min(120, v + 1.5); up += 10;
      x += Math.sin(h * D) * v; y += Math.cos(h * D) * v;
    }
  }
  // the subject at a time, as a log answers: between two samples straight, its heading its piece's
  const at = (ms) => {
    let lo = 0, hi = samples.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (samples[m][0] <= ms) lo = m; else hi = m; }
    const i = Math.max(0, Math.min(samples.length - 2, lo));
    const a = samples[i], b = samples[i + 1], f = Math.max(0, Math.min(1, (ms - a[0]) / (b[0] - a[0])));
    const x = a[1] + (b[1] - a[1]) * f, y = a[2] + (b[2] - a[2]) * f, up = a[3] + (b[3] - a[3]) * f;
    return { lon: LON0 + x / kx, lat: LAT0 + y / KZ, up, heading: ((Math.atan2(b[1] - a[1], b[2] - a[2]) / D) + 360) % 360, truth: a[4] + ((((b[4] - a[4]) % 360) + 540) % 360 - 180) * f };
  };
  const rig = cfg.rig ?? (cfg.subject === 'car' ? { behind: 30, up: 10 } : { behind: 120, up: 30 });
  // ── before: the journey's own scripted chase (examples/journey/camera.ts before the moves were the library's)
  const look = (s) => {
    const t = Math.max(0.5, Math.min(88, s.tilt)) * D, b = s.bearing * D, ground = w.heightAt(s.at.lon, s.at.lat);
    const h = Math.max(0, s.at.up) + (s.raise ?? 0) * s.dist * Math.tan(w.camera.fov / 2) * 0.9, ahead = h * Math.tan(t), lon = s.at.lon + (Math.sin(b) * ahead) / kx, lat = s.at.lat + (Math.cos(b) * ahead) / KZ;
    const g2 = w.heightAt(lon, lat), dg = (Number.isFinite(ground) ? ground : 0) - (Number.isFinite(g2) ? g2 : 0);
    const dist = s.dist + (h + dg) / Math.cos(t);
    w.go({ lon, lat, dist: dist / w.camera.frameK, tilt: s.tilt, bearing: ((s.bearing % 360) + 360) % 360 });
  };
  const turnLerp = (a, b, k) => a + ((((b - a) % 360) + 540) % 360 - 180) * k;
  let hd = NaN;
  const before = (dt) => {
    const s = at(w.time.getTime());
    // (the car: its heading eased; the plane: its heading as the log gives it, as the take-off shot had it)
    hd = cfg.subject === 'plane' ? s.heading : Number.isNaN(hd) ? s.heading : turnLerp(hd, s.heading, 1 - Math.exp(-dt / 900));
    if (rig.side !== undefined) look({ at: s, dist: Math.hypot(rig.side, rig.up), tilt: 90 - Math.atan2(rig.up, rig.side) / D, bearing: hd + 90, raise: rig.raise });
    else look({ at: s, dist: Math.hypot(rig.behind, rig.up), tilt: 90 - Math.atan2(rig.up, rig.behind) / D, bearing: hd });
  };
  // ── the run: the world's clock stepped `fps` a second; each frame the camera's numbers
  const run = async (camera, fps) => {
    w.stop(); w.setTime(new Date(start), { rate }); hd = NaN;
    const thing = cfg.motion ? (ms) => { const s = at(ms); return { lon: s.lon, lat: s.lat, up: s.up }; } : (ms) => at(ms);
    if (camera === 'after') void w.play(rig.side !== undefined ? lib.moves.track(thing, { ...rig, damping: cfg.damping }) : lib.moves.chase(thing, { ...rig, damping: cfg.damping }));
    else w.go({ lon: LON0, lat: LAT0, zoom: 17, tilt: 70 });
    const dt = 1000 / fps, frames = [], n = Math.round(cfg.seconds * fps);
    for (let i = 0; i < n; i++) {
      if (camera === 'before') before(i ? dt : 0);
      w.step(i ? dt : 0);
      const c = w.camera, p = c.pitch, b = -c.yaw, e = c.eye, s = at(w.time.getTime());
      // (the eye in metres east, north, up of a fixed place: the centre's lon, lat plus the eye's offset from it)
      const ex = (c.lon - LON0) * kx + e[0], ey = (c.lat - LAT0) * KZ - e[2], ez = e[1];
      const g = w.heightAt(s.lon, s.lat), xy = c.projectWorld(...[(s.lon - c.lon) * kx, (Number.isFinite(g) ? g * w.exaggeration : 0) + s.up, -(s.lat - c.lat) * KZ]);
      frames.push({ t: w.now / 1000, f: [Math.sin(b) * Math.cos(p), Math.cos(b) * Math.cos(p), -Math.sin(p)], e: [ex, ey, ez], px: xy, behind: Math.abs(((((b / D) - s.truth) % 360) + 540) % 360 - 180) });
    }
    w.camera.stop();
    return frames;
  };
  const measure = (fr, fps) => {
    const dt = 1 / fps, skip = fps, ang = [], acc = [], px = [];
    const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
    const w_ = [];
    for (let i = 1; i < fr.length; i++) { const c = cross(fr[i - 1].f, fr[i].f), s = Math.hypot(...c), dot = fr[i - 1].f.reduce((a, x, k) => a + x * fr[i].f[k], 0), th = Math.atan2(s, dot); w_.push(s > 1e-12 ? c.map((x) => (x / s) * th / dt) : [0, 0, 0]); }
    for (let i = skip; i < w_.length; i++) ang.push(Math.hypot(...w_[i].map((x, k) => x - w_[i - 1][k])) / dt / D);
    for (let i = skip; i + 1 < fr.length; i++) acc.push(Math.hypot(...[0, 1, 2].map((k) => fr[i + 1].e[k] - 2 * fr[i].e[k] + fr[i - 1].e[k])) / dt / dt);
    for (let i = skip; i + 1 < fr.length; i++) { const a = fr[i - 1].px, b = fr[i].px, c = fr[i + 1].px; if (a && b && c) px.push(Math.hypot(c[0] - 2 * b[0] + a[0], c[1] - 2 * b[1] + a[1])); }
    const q = (a, k) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor(s.length * k))] : 0; };
    const rms = (a) => Math.sqrt(a.reduce((x, y) => x + y * y, 0) / Math.max(1, a.length));
    const r = (x, d = 2) => +x.toFixed(d);
    const bh = fr.slice(skip).map((x) => x.behind).filter(Number.isFinite);
    return { angularRms: r(rms(ang)), angularP95: r(q(ang, 0.95)), angularMax: r(Math.max(...ang)), eyeAccRms: r(rms(acc)), subjectPxP95: r(q(px, 0.95), 3), behindRms: bh.length ? r(rms(bh)) : null };
  };
  const out = { subject: cfg.name ?? cfg.subject, api: w.graphicsApi ?? 'none' };
  if (cfg.only === 'after') { out.after = measure(await run('after', 30), 30); return out; }
  out.before = measure(await run('before', 30), 30);
  const a30 = await run('after', 30);
  out.after = measure(a30, 30);
  // frame-rate independence: the after at 60 and 144 frames a second, the same moments as at 30
  const same = (hi, k) => { let de = 0, da = 0; for (let i = 0; i < a30.length; i++) { const j = i * k; if (j >= hi.length) break; de = Math.max(de, Math.hypot(...[0, 1, 2].map((m) => hi[j].e[m] - a30[i].e[m]))); const dot = a30[i].f.reduce((s, x, m) => s + x * hi[j].f[m], 0); da = Math.max(da, Math.acos(Math.min(1, dot)) / D); } return { eyeM: +de.toFixed(3), viewDeg: +da.toFixed(3) }; };
  const a60 = await run('after', 60); out.after60 = measure(a60, 60); out.sameAt60 = same(a60, 2);
  if (cfg.rates) { const a120 = await run('after', 120); out.sameAt120 = same(a120, 4); }
  return out;
}

const SUBJECTS = ['car', 'plane'], SECONDS = Number(arg.seconds ?? 30);
const rows = [];
const show = (r, where) => {
  console.log(`${where.padEnd(14)} ${r.subject.padEnd(5)} before: ${r.before.angularRms} °/s² RMS · p95 ${r.before.angularP95} · max ${r.before.angularMax} · eye ${r.before.eyeAccRms} m/s² · subject ${r.before.subjectPxP95} px · behind ${r.before.behindRms}°`);
  console.log(`${''.padEnd(14)} ${''.padEnd(5)} after:  ${r.after.angularRms} °/s² RMS · p95 ${r.after.angularP95} · max ${r.after.angularMax} · eye ${r.after.eyeAccRms} m/s² · subject ${r.after.subjectPxP95} px · behind ${r.after.behindRms}° · 60 fps ${r.after60.angularRms} RMS · the same at 60 fps: eye ${r.sameAt60.eyeM} m, view ${r.sameAt60.viewDeg}°${r.sameAt120 ? ` · at 120 fps: eye ${r.sameAt120.eyeM} m, view ${r.sameAt120.viewDeg}°` : ''}`);
};
if (arg.journey === '1') {
  // the journey's own logs (its pack: tools/journey-data.mjs): the car on Melbourne's roads to the airport (the chase,
  // a sample at each corner of the route, 8 × the trip's time) and the plane's take-off roll (the track from its left,
  // 1.6 ×); before: the example's scripted cameras as they were, after: the library's moves
  const lib = await import('../src/index.ts'), { timeline, heightAt } = await import('../examples/journey/story.ts');
  const J = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', '..', 'data', 'packs', 'journey', 'journey.json'), 'utf8')), TL = timeline(J), alt = heightAt(TL.plane.samples);
  const runs = [
    { name: 'journey car', samples: TL.cars.mel.map((x) => [x.t, x.lon, x.lat, 1]), start: TL.t.melArrive - 7.5 * 60e3, rate: 8, rig: { behind: 42, up: 16 } },
    { name: 'journey plane', subject: 'plane', samples: TL.plane.samples.map((x) => [x.t, x.lon, x.lat, alt(x.lon, x.lat)]), start: TL.t.roll - 6e3, rate: 1.6, rig: { side: 78 * Math.sin(80 * Math.PI / 180), up: 78 * Math.cos(80 * Math.PI / 180), raise: 0.15 } },
  ];
  for (const c of runs) {
    const w = await lib.world(null, { body: lib.earth({ imagery: [], terrain: [] }), view: { lon: c.samples[0][1], lat: c.samples[0][2], zoom: 17, tilt: 60 }, time: new Date(c.start) });
    const r = await scene(w, lib, { ...c, subject: c.subject ?? 'car', seconds: SECONDS, damping: arg.damping ? JSON.parse(arg.damping) : undefined }); w.dispose();
    rows.push({ where: 'headless', ...r }); show(r, 'headless');
  }
  writeFileSync(join(OUT, 'results-journey.json'), JSON.stringify(rows, null, 1));
  process.exit(0);
}
if (arg.variants === '1') {
  // (the damping's settings near the default, one at a time: what each buys and costs)
  const lib = await import('../src/index.ts');
  for (const subject of SUBJECTS) for (const v of [{ name: 'default' }, { name: 'heading 0.7', damping: { heading: { halfLife: 0.7 } } }, { name: 'heading 0.35', damping: { heading: { halfLife: 0.35 } } }, { name: "heading from 'thing'", damping: { heading: { from: 'thing' } } }, { name: 'place 0.25', damping: { place: { halfLife: 0.25, lead: 0.25 } } }, { name: 'aim 0.25', damping: { aim: { halfLife: 0.25 } } }]) {
    const w = await lib.world(null, { body: lib.earth({ imagery: [], terrain: [] }), view: { lon: 115.1705, lat: -8.723, zoom: 17, tilt: 60 }, time: new Date(Date.UTC(2026, 9, 19, 2)) });
    const r = await scene(w, lib, { subject, seconds: SECONDS, only: 'after', damping: v.damping, motion: v.motion }); w.dispose();
    console.log(`${subject.padEnd(5)} ${v.name.padEnd(20)} ${r.after.angularRms} °/s² RMS · p95 ${r.after.angularP95} · max ${r.after.angularMax} · eye ${r.after.eyeAccRms} m/s² · behind ${r.after.behindRms}°`);
  }
  process.exit(0);
}
if (arg.browser !== '1') {
  const lib = await import('../src/index.ts');
  for (const subject of SUBJECTS) {
    const w = await lib.world(null, { body: lib.earth({ imagery: [], terrain: [] }), view: { lon: 115.1705, lat: -8.723, zoom: 17, tilt: 60 }, time: new Date(Date.UTC(2026, 9, 19, 2)) });
    const r = await scene(w, lib, { subject, seconds: SECONDS, rates: true, damping: arg.damping ? JSON.parse(arg.damping) : undefined }); w.dispose();
    rows.push({ where: 'headless', ...r }); show(r, 'headless');
  }
} else {
  const { serve } = await import('./serve.mjs'), { launch, openDemo } = await import('./browser.mjs');
  const PORT = Number(arg.port ?? process.env.PORT ?? 8541), srv = await serve(PORT), browser = await launch();
  for (const api of (arg.graphics ?? 'webgpu,webgl2').split(',')) for (const subject of SUBJECTS) {
    const { page, errors } = await openDemo(browser, `http://127.0.0.1:${PORT}/examples/journey/?go=parity&graphics=${api}&dpr=1&clock=manual&log=0&panel=0`, { width: 320, height: 240 });
    try {
      await page.evaluate(async () => { await window.aslnutDemo.w.settled({ timeout: 60000 }); });
      const r = await page.evaluate(`(${scene.toString()})(window.aslnutDemo.w, window.aslnutDemo.lib, ${JSON.stringify({ subject, seconds: SECONDS })})`);
      if (r.api !== api) throw new Error(`asked ${api}, got ${r.api}`);
      rows.push({ where: api, ...r, errors: errors.slice(0, 3) }); show(r, api);
    } catch (e) { rows.push({ where: api, subject, error: e.message }); console.log(`FAIL ${api} ${subject}: ${e.message.split('\n')[0]}`); }
    await page.close();
  }
  await browser.close(); srv.close();
}
writeFileSync(join(OUT, `results${arg.browser === '1' ? '-browser' : ''}.json`), JSON.stringify(rows, null, 1));
