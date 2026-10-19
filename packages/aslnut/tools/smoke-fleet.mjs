// The fleet's smoke check, on WebGPU AND WebGL2 (a failure on either fails the run): the fleet example's checks
// presets (no network: a plain ground; the twin's own packs), a fixed 30-a-second clock, the time stepped by hand:
//   1. it draws: the frame changes when the fleet is hidden; dots, trails and (near the camera) car shapes
//   2. the chip puts each vehicle where its log says: a pick at the place the log gives answers that vehicle, frame
//      after frame while it plays at 4× (no stepping, no jitter: every frame on the log's line, moving every frame)
//   3. a paused world rests: no frame drawn for the fleet once settled; after a flight that tilts and turns too (0 frames
//      in 3 s), and a flight asked a bearing that is not a number (NaN: read from the camera, which has none) is refused;
//      a flight from rest takes its seconds; a NaN written into the camera itself is said once, and the world rests
//   4. a seek is one change: the next frame moves, and uploads only the uniforms (no columns again)
//   5. a live log only appends: a new sample per vehicle uploads its new bytes (and the vehicles' slots), not the log
//   6. the charge scene's houses by their traits: the neutral presets, a kit's models given the traits, aslnut's
//      buildings, the example's own raised house: each place's traits in place (its kind's check), every standing car
//      at a parking point of the design drawn, a charger at each service point used; the cars' soft shadows draw
//   7. the charge scene's cards (kits › dashboard › markers): a card over each place with chargers draws, its values
//      the ports' logs' at the time (its chargers in use), a tap on it picks its place; the cars plugged in folded into
//      their places (core › data › history: relations; core › entities › sets: fold): not drawn, not picked, counted
//      by their place's card; under the governor a card steps down (rows, header, a dot); a still view settled draws
//      nothing; &icons=1: each car far away its icon
//   8. the drones (go=drones: things in the air, each sample's height from their log): each drone where its log says,
//      at its height (a pick there answers it), on the ground with &air=0; their shapes' pose on the chip (the pose
//      pass's pitch and bank) as the set works it out (set.attitude), within a tenth of a degree; no errors
//   (the same frame on both graphics: tools/parity.mjs, fleet/parity and fleet/parity-close, both on one rasterizer)
//   node tools/smoke-fleet.mjs   (run `EXAMPLES_KEEP_BUILD=1 npx vite build` first) · evidence in .out/smoke-fleet/
//   PARTS=draws,drones,charge,cards,houses,rest,live (default all): some of them only (a run in short parts on a shared machine)
import { serve } from './serve.mjs';
import { launch, openDemo, settledFrame, bytesOf } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PORT = Number(process.env.PORT ?? 8096), OUT = join(import.meta.dirname, '..', '.out', 'smoke-fleet');
mkdirSync(OUT, { recursive: true });
const base = `http://127.0.0.1:${PORT}/examples/fleet/`;
const srv = await serve(PORT), browser = await launch();
let failed = 0;
const check = (api, name, ok, detail) => { if (!ok) failed++; console.log(`${ok ? 'ok  ' : 'FAIL'} ${api.padEnd(6)} ${name}${detail ? ` · ${detail}` : ''}`); };
const changed = (a, b, tol = 24) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > tol) n++; return n; };
const frames = {};
const PARTS = new Set((process.env.PARTS ?? 'draws,drones,charge,cards,houses,rest,live').split(',')), part = (k) => PARTS.has(k);

if (part('draws')) for (const api of ['webgpu', 'webgl2']) for (const go of ['parity', 'parity-close']) {
  const { page, errors } = await openDemo(browser, `${base}?go=${go}&graphics=${api}&n=2000&dpr=1&clock=30&log=0&t=20`, { width: 390, height: 844 });
  try {
    const r = await settledFrame(page); const px = bytesOf(r); frames[`${go}-${api}`] = r;
    writeFileSync(join(OUT, `${go}-${api}.png`), png(r.width, r.height, px));
    check(api, `${go}: on the graphics asked for`, r.api === api, `got ${r.api}`);
    // 1 · it draws
    // (the pixels read at once: a read's buffer is not kept past the next frames)
    const hid = await page.evaluate(async () => { const { w } = window.aslnutDemo; w.hide('fleet'); await w.settled({ strict: true }); const f = await w.frame(); let b = ''; for (let i = 0; i < f.pixels.length; i += 32768) b += String.fromCharCode(...f.pixels.subarray(i, i + 32768)); w.reveal('fleet'); await w.settled({ strict: true }); return { b64: btoa(b) }; });
    const c = await page.evaluate(() => window.aslnutDemo.fleet.counts());
    check(api, `${go}: the fleet draws`, changed(px, bytesOf(hid)) > 400, `${changed(px, bytesOf(hid))} px change when hidden · ${c.things} vehicles · ${c.trailPieces / c.things} trail pieces each · ${c.shapes} cars near`);
    if (go === 'parity-close') check(api, `${go}: car shapes near the camera`, c.shapes > 0, `${c.shapes}`);
    // 2 · where the log says, frame after frame, at 4×
    const track = await page.evaluate(async () => {
      const { w, fleet, log, play } = window.aslnutDemo, cam = w.camera;
      // 4× at 30 frames a second: the time 133 ms on a frame, set by hand (every frame drawn at an exact step)
      const frame = () => new Promise((ok) => w.once('frame', ok));
      const W = cam.width, H = cam.height, out = { frames: 0, hits: 0, asked: 0, moved: 0, still: 0, jumps: 0, steps: [] };
      // vehicles on screen, apart from the others (a pick there can only be them), the same ones every frame
      const pickable = () => { const now = w.time.getTime() - fleet.drive.smooth, st = log.stateAt(now), pts = st.map((s) => ({ s, p: cam.project(s.lon, s.lat, (w.heightAt(s.lon, s.lat) || 0) * w.exaggeration + 0.3) })).filter((x) => x.p && x.p[0] > 20 && x.p[1] > 20 && x.p[0] < W - 20 && x.p[1] < H - 180);
        return pts.filter((a) => pts.every((b) => a === b || Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) > 18)); };
      const chosen = pickable().filter((x) => x.s.speed > 3).slice(0, 12).map((x) => x.s.id);
      let last = new Map();
      for (let f = 0; f < (window.aslnutDemo.twin ? 10 : 24); f++) {
        play.seek(w.time.getTime() + 4000 / 30); await frame();
        const now = w.time.getTime() - fleet.drive.smooth;
        for (const id of chosen) {
          const s = log.at(id, now); const p = s && cam.project(s.lon, s.lat, (w.heightAt(s.lon, s.lat) || 0) * w.exaggeration + 0.3); if (!p) continue;
          const hit = await w.pick(p[0], p[1], { radius: 1, elements: ['fleet'] }); out.asked++; if (hit && String(hit.id) === id) out.hits++;
          const was = last.get(id); if (was) { const d = Math.hypot(p[0] - was[0], p[1] - was[1]); out.steps.push(d); if (d < 0.05 && s.speed > 1) out.still++; }
          last.set(id, p);
        }
        out.frames++;
      }
      const s = [...out.steps].sort((a, b) => a - b), med = s[s.length >> 1] ?? 0;
      out.jumps = out.steps.filter((d) => d > 4 * med + 1).length; out.median = med; out.steps = undefined; out.vehicles = chosen.length;
      return out;
    });
    check(api, `${go}: each vehicle where its log says, every frame at 4×`, track.vehicles >= 3 && track.hits >= track.asked * 0.9, `${track.hits}/${track.asked} picks hit (${track.vehicles} vehicles × ${track.frames} frames)`);
    check(api, `${go}: smooth (moving every frame, no jumps)`, track.still === 0 && track.jumps <= 1, `median ${track.median.toFixed(2)} px a frame · ${track.still} frames standing · ${track.jumps} jumps`);
    // 4 · a seek: one change
    const seek = await page.evaluate(async () => {
      const { w, play } = window.aslnutDemo, g = w.graphics;
      const a = await w.frame(); play.seek(w.time.getTime() + 20e3); await new Promise((ok) => w.once('frame', ok)); const up = g.stats.uploadBytes, n = g.stats.uploads; const b = await w.frame();
      let d = 0; for (let i = 0; i < a.pixels.length; i += 4) if (Math.abs(a.pixels[i] - b.pixels[i]) + Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) + Math.abs(a.pixels[i + 2] - b.pixels[i + 2]) > 24) d++;
      return { changed: d, uploadBytes: up, uploads: n };
    });
    check(api, `${go}: a seek moves the fleet in one frame, uploading no columns`, seek.changed > 100 && seek.uploadBytes < 64 * 1024, `${seek.changed} px moved · ${seek.uploadBytes} bytes in ${seek.uploads} uploads that frame`);
    check(api, `${go}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, `${go}`, false, e.message.slice(0, 300)); }
  await page.close();
}
// 8 · the drones in the air (and on the ground: &air=0)
if (part('drones')) for (const api of ['webgpu', 'webgl2']) for (const air of [1, 0]) {
  const { page, errors } = await openDemo(browser, `${base}?go=drones&air=${air}&graphics=${api}&n=2000&dpr=1&clock=30&log=0&t=1.5`, { width: 390, height: 844 });
  try {
    const r0 = await settledFrame(page);
    writeFileSync(join(OUT, `drones-air${air}-${api}.png`), png(r0.width, r0.height, bytesOf(r0)));
    const r = await page.evaluate(async () => {
      const { w, fleet, log } = window.aslnutDemo, cam = w.camera, now = w.time.getTime() - fleet.drive.smooth, ex = w.exaggeration;
      // drones on screen apart from the others, at their height over the ground under them
      const st = log.stateAt(now), at = (s) => cam.project(s.lon, s.lat, (w.heightAt(s.lon, s.lat) || 0) * ex + (s.alt ?? 0) + 0.3);
      const pts = st.map((s) => ({ s, p: at(s) })).filter((x) => x.p && x.p[0] > 20 && x.p[1] > 20 && x.p[0] < cam.width - 20 && x.p[1] < cam.height - 180);
      const apart = pts.filter((a) => pts.every((b) => a === b || Math.hypot(a.p[0] - b.p[0], a.p[1] - b.p[1]) > 18)).slice(0, 16);
      let hits = 0, up = 0; for (const { s, p } of apart) { const h = await w.pick(p[0], p[1], { radius: 1, elements: ['fleet'] }); if (h && String(h.id) === s.id) hits++; if ((s.alt ?? 0) > 20) up++; }
      // their shapes' pose on the chip against the set's own: each shaped thing's texel (16 bits an angle)
      let worst = 0, posed = 0, banked = 0;
      if (fleet.poseTex) {
        const px = await w.graphics.readTexture(fleet.poseTex), d = fleet.thingsData;
        for (let e = 0; e < log.size; e++) {
          if (d[e * 8 + 6] !== 1) continue;
          const a = fleet.attitude(log.ids[e]), q = (lo, hi) => ((lo + hi * 256) / 65535 - 0.5) * 180;
          const gp = q(px[e * 4], px[e * 4 + 1]), gb = q(px[e * 4 + 2], px[e * 4 + 3]);
          worst = Math.max(worst, Math.abs(gp - a.pitch), Math.abs(gb - a.bank)); posed++; if (Math.abs(a.bank) > 2) banked++;
        }
      }
      // (what the world said went wrong: a layer failing each frame says so there, never in the console)
      const failed = w.report().failed ?? [], said = window.aslnutDemo.errors ?? [];
      return { asked: apart.length, hits, up, posed, banked, worst, shapes: fleet.counts().shapes, failed: [...failed.map((f) => f.what ?? f), ...said] };
    });
    if (air) {
      check(api, 'drones: each where its log says, at its height (picked there)', r.asked >= 6 && r.up >= 3 && r.hits >= r.asked * 0.9, `${r.hits}/${r.asked} picks hit · ${r.up} of them over 20 m up`);
      check(api, 'drones: their pose on the chip as the set works it out', r.posed >= 10 && r.banked >= 3 && r.worst < 0.1, `${r.posed} shaped (${r.banked} banked over 2°) · worst ${r.worst.toFixed(4)}°`);
    } else check(api, 'drones on the ground (&air=0): each where its log says', r.asked >= 6 && r.up === 0 && r.hits >= r.asked * 0.9, `${r.hits}/${r.asked} picks hit`);
    check(api, `drones${air ? '' : ' (&air=0)'}: no errors, every program built`, errors.length === 0 && !r.failed.length, [...errors.slice(0, 3), ...r.failed].join(' | '));
  } catch (e) { check(api, `drones air=${air}`, false, e.message.slice(0, 300)); }
  await page.close();
}
// 2b · the charge scene: a bar over each car (its battery, from its log, on the chip) with its per cent ('72%': a glyph
// atlas, on the chip), a tap on it picks the car; the placed buildings, the chargers (the preset) and their bays' lights
// (the ports' logs: blue while a car charges); what a tap on a car and on a building tells
if (part('charge')) for (const api of ['webgpu', 'webgl2']) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-charge&graphics=${api}&dpr=1&clock=30&log=0`, { width: 390, height: 844 });
  try {
    await settledFrame(page);
    const r = await page.evaluate(async () => {
      const { w, fleet, log, portLogs, scenario, tips } = window.aslnutDemo, cam = w.camera, enc = (f) => { let b = ''; for (let i = 0; i < f.pixels.length; i += 32768) b += String.fromCharCode(...f.pixels.subarray(i, i + 32768)); return b; };
      const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a.charCodeAt(i) - b.charCodeAt(i)) + Math.abs(a.charCodeAt(i + 1) - b.charCodeAt(i + 1)) + Math.abs(a.charCodeAt(i + 2) - b.charCodeAt(i + 2)) > 24) d++; return d; };
      const g0 = fleet.props.gauge, on = enc(await w.frame());
      fleet.setProps({ gauge: { ...g0, label: false } }); await w.settled({ strict: true }); const unlabelled = enc(await w.frame());
      fleet.setProps({ gauge: false }); await w.settled({ strict: true }); const off = enc(await w.frame());
      fleet.setProps({ gauge: g0 }); await w.settled({ strict: true });
      // a tap on a car's bar (its place, the bar's height over it)
      const now = w.time.getTime() - fleet.drive.smooth, lift = fleet.made().bounds[1][1] + 0.9;
      let hits = 0, asked = 0;
      for (const s of log.stateAt(now)) {
        // (a car plugged in is folded into its place's card: not drawn, not picked)
        if (window.aslnutDemo.plugged?.hostOf(s.id, now)) continue;
        const p = cam.project(s.lon, s.lat, (w.heightAt(s.lon, s.lat) || 0) * w.exaggeration + lift); if (!p || p[0] < 20 || p[1] < 20 || p[0] > cam.width - 20 || p[1] > cam.height - 180 || asked >= 6) continue;
        asked++; const hit = await w.pick(p[0], p[1], { radius: 1, elements: ['fleet'] }); if (hit && String(hit.id) === s.id) hits++;
      }
      // the bays charging now (both logs), the layers placed, what the taps tell
      const busy = [...portLogs.wall.stateAt(now), ...portLogs.station.stateAt(now)].filter((s) => s.values.busy > 0.5).length;
      const layers = ['buildings', 'chargers', 'lots', 'lights-wall', 'lights-station', 'traffic'].filter((id) => w.list.some((l) => l.id === id));
      const office = scenario.find((f) => f.properties.kind === 'office'), car = log.stateAt(now)[0];
      return { bars: diff(on, off), label: diff(on, unlabelled), hits, asked, shapes: fleet.counts().shapes, busy, layers, traffic: w.list.find((l) => l.id === 'traffic')?.log?.size ?? 0, placeTip: tips.place(office.id), carTip: tips.car({ id: car.id, props: car.props, index: car.index, state: car }) };
    });
    check(api, 'charge: a bar over each car draws', r.bars > 200, `${r.bars} px change without the bars · ${r.shapes} cars drawn as shapes`);
    check(api, "charge: each bar's per cent draws ('72%')", r.label > 40, `${r.label} px change without the labels`);
    check(api, 'charge: a tap on a bar picks its car', r.asked >= 3 && r.hits >= r.asked - 1, `${r.hits}/${r.asked}`);
    check(api, 'charge: the buildings, lots, chargers and lights are placed', r.layers.length === 6, r.layers.join(', '));
    check(api, 'charge: bays charging at 12:30 (the ports\' logs)', r.busy >= 6, `${r.busy} bays busy`);
    check(api, 'charge: the other traffic passes through', r.traffic > 10, `${r.traffic} vehicles`);
    check(api, 'charge: a tap on a building tells its chargers and cars', /chargers: \d+ in use · \d+ free/.test(r.placeTip ?? '') && /cars: car-/.test(r.placeTip ?? ''), JSON.stringify(r.placeTip));
    check(api, 'charge: a tap on a car tells its habit, battery and state', /charges .*\n?battery \d+ %/.test(r.carTip ?? ''), JSON.stringify(r.carTip));
    check(api, 'charge: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'charge', false, e.message.slice(0, 300)); }
  await page.close();
}
// 7 · the charge scene's cards, the cars folded into their places, the icons
if (part('cards')) for (const api of ['webgpu', 'webgl2']) for (const icons of [false, true]) {
  // (the display's clock: a still view is what is checked last)
  const { page, errors } = await openDemo(browser, `${base}?go=parity-charge&graphics=${api}&dpr=1&log=0${icons ? '&icons=1' : ''}`, { width: 390, height: 844 });
  try {
    await settledFrame(page);
    const r = await page.evaluate(async (icons) => {
      const { w, fleet, log, plugged, portLogs, scenario, views } = window.aslnutDemo, cam = w.camera;
      const enc = (f) => { let b = ''; for (let i = 0; i < f.pixels.length; i += 32768) b += String.fromCharCode(...f.pixels.subarray(i, i + 32768)); return b; };
      const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a.charCodeAt(i) - b.charCodeAt(i)) + Math.abs(a.charCodeAt(i + 1) - b.charCodeAt(i + 1)) + Math.abs(a.charCodeAt(i + 2) - b.charCodeAt(i + 2)) > 24) d++; return d; };
      const out = { icons };
      if (icons) {
        // farther: each car an icon (the set's dots off), turned along its path
        await w.fly({ ...views.charge, zoom: 16.4, tilt: 30 }, { seconds: 0 }); await w.settled({ strict: true, timeout: 60000 });
        const on = enc(await w.frame()); w.hide('fleet-icons', { seconds: 0 }); await w.settled({ strict: true }); const off = enc(await w.frame()); w.release('fleet-icons', { seconds: 0 }); await w.settled({ strict: true });
        out.iconPx = diff(on, off); out.dots = fleet.props.dots;
        return out;
      }
      const cards = w.element('place-cards'), now = w.time.getTime() - fleet.drive.smooth;
      // the cards draw (the frame with them, without)
      const on = enc(await w.frame()); w.hide('place-cards', { seconds: 0 }); await w.settled({ strict: true }); const off = enc(await w.frame()); w.release('place-cards', { seconds: 0 }); await w.settled({ strict: true });
      out.cardsPx = diff(on, off);
      // a place's card holds its ports' logs' values at the time (in use), its count of the cars plugged in
      const t = w.time.getTime(), checks = scenario.slice(0, 29).map((f, i) => {
        const lg = f.properties.kind === 'charger' ? portLogs.station : portLogs.wall; let busy = 0;
        for (let k = 1; k <= Number(f.properties.charger.ports); k++) busy += lg.at(`${f.id}-p${k}`, t)?.values.busy ?? 0;
        const v = cards.valuesOf(i, t); return { busy, shown: v.r0, cars: plugged.heldBy(f.id, t).length, badge: v.badge };
      });
      out.values = checks.filter((c) => Math.abs(c.busy - c.shown) < 0.01 && c.cars === c.badge).length; out.places = checks.length;
      // the cars plugged in now: folded (a pick where each is answers another, or none)
      const held = log.stateAt(now).filter((s) => plugged.hostOf(s.id, now)); let picked = 0, asked = 0;
      for (const s of held) { const p = cam.project(s.lon, s.lat, (w.heightAt(s.lon, s.lat) || 0) * w.exaggeration + 0.5); if (!p || p[0] < 0 || p[1] < 0 || p[0] > cam.width || p[1] > cam.height || asked >= 8) continue; asked++; const hit = await w.pick(p[0], p[1], { radius: 1, elements: ['fleet'] }); if (hit && String(hit.id) === s.id) picked++; }
      out.folded = { held: held.length, asked, picked, rows: plugged.rows.length };
      // a tap on a card: its place (the card's middle: over its place, by its lift and pointer)
      // (the office nearest the middle of the view)
      const mid = (f) => { const c = f.geometry.coordinates, q = cam.project(c[0], c[1], 0); return q ? Math.hypot(q[0] - cam.width / 2, q[1] - cam.height / 2) : Infinity; };
      const f = scenario.filter((x) => x.properties.kind === 'office').sort((a, b) => mid(a) - mid(b))[0], at = f.geometry.coordinates, lift = Number(f.properties.levels) * 3.4 + 2;
      const p = cam.project(at[0], at[1], (w.heightAt(at[0], at[1]) || 0) * w.exaggeration + lift); let tap = null;
      if (p) for (const dy of [-30, -38, -46, -24]) { const hit = await w.pick(p[0], p[1] + dy, { radius: 1, elements: ['place-cards'] }); if (hit) { tap = String(hit.id); break; } }
      out.tap = { want: f.id, got: tap };
      // under the governor a card steps down: its rows go (its header only), then it is a dot (its own detail set)
      const full = enc(await w.frame()); cards.detailOwn = 0.6; w.invalidate(); await w.settled({ strict: true }); const head = enc(await w.frame());
      cards.detailOwn = 0.4; w.invalidate(); await w.settled({ strict: true }); const dots = enc(await w.frame()); cards.detailOwn = 1; w.invalidate(); await w.settled({ strict: true });
      out.steps = { header: diff(full, head), dot: diff(head, dots) };
      // a still view, settled: nothing drawn (the cards' room settled too)
      const n0 = w.renderer.frames; await new Promise((ok) => setTimeout(ok, 1200)); out.still = w.renderer.frames - n0;
      return out;
    }, icons);
    if (icons) {
      check(api, 'charge &icons=1: each car far away its icon (the set\'s dots off)', r.iconPx > 40 && r.dots === false, `${r.iconPx} px change without the icons`);
    } else {
      check(api, 'charge: a card over each place with chargers draws', r.cardsPx > 2000, `${r.cardsPx} px change without the cards`);
      check(api, 'charge: each card its ports\' logs\' values at the time and its cars plugged in', r.values === r.places, `${r.values}/${r.places} places`);
      check(api, 'charge: the cars plugged in folded into their places (not drawn, not picked)', r.folded.rows > 20 && r.folded.held > 3 && r.folded.asked >= 2 && r.folded.picked === 0, JSON.stringify(r.folded));
      check(api, 'charge: a tap on a card picks its place', r.tap.got === r.tap.want, JSON.stringify(r.tap));
      check(api, 'charge: under the governor a card steps down (its rows, then its header: a dot)', r.steps.header > 300 && r.steps.dot > 300, JSON.stringify(r.steps));
      check(api, 'charge: a still view settled draws nothing (the cards\' room settled)', r.still === 0, `${r.still} frames in 1.2 s`);
    }
    check(api, `charge${icons ? ' &icons=1' : ''} cards: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, `charge cards${icons ? ' icons' : ''}`, false, e.message.slice(0, 300)); }
  await page.close();
}
// 6 · the houses by their traits: the same scenario whatever is drawn
if (part('houses')) for (const api of ['webgpu', 'webgl2']) for (const houses of ['neutral', 'kit', 'built', 'raised']) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity-charge&houses=${houses}&graphics=${api}&dpr=1&clock=30&log=0`, { width: 390, height: 844 });
  try {
    await settledFrame(page);
    const r = await page.evaluate(async () => {
      const { w, fleet, scenario, traitsOf, traitProblems, parkingFit, houses } = window.aslnutDemo;
      const enc = (f) => { let b = ''; for (let i = 0; i < f.pixels.length; i += 32768) b += String.fromCharCode(...f.pixels.subarray(i, i + 32768)); return b; };
      const diff = (a, b) => { let d = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a.charCodeAt(i) - b.charCodeAt(i)) + Math.abs(a.charCodeAt(i + 1) - b.charCodeAt(i + 1)) + Math.abs(a.charCodeAt(i + 2) - b.charCodeAt(i + 2)) > 12) d++; return d; };
      const want = scenario.filter((f) => f.properties.kind !== 'charger').reduce((n, f) => n + Number(f.properties.charger.ports), 0) + scenario.filter((f) => f.properties.kind === 'charger').length;
      const chargersLayer = w.list.find((l) => l.id === 'chargers'), placed = chargersLayer?.ep?.data?.length ?? -1;
      // the shadows: the frame with them, without
      const n0 = fleet.props.near, on = enc(await w.frame()); fleet.setProps({ near: { ...n0, shadow: false } }); await w.settled({ strict: true }); const off = enc(await w.frame()); fleet.setProps({ near: n0 }); await w.settled({ strict: true });
      return { houses, traits: traitsOf.size, problems: traitProblems.slice(0, 3), fit: parkingFit(), want, placed, shadow: diff(on, off), shapes: fleet.counts().shapes, buildings: w.list.some((l) => l.id === 'buildings') };
    });
    check(api, `houses=${houses}: each place's traits in place (its kind's check)`, r.houses === houses && r.traits === 29 && r.problems.length === 0, `${r.traits} places · ${r.problems.join(' | ') || 'no problems'}`);
    check(api, `houses=${houses}: every standing car at a parking point of the design drawn`, r.fit.standing >= 40 && r.fit.worst < 0.3, `${r.fit.standing} cars standing · the farthest ${r.fit.worst} m from one (${r.fit.spots} points)`);
    check(api, `houses=${houses}: a charger at each service point used, the buildings drawn`, r.placed === r.want && r.buildings, `${r.placed} chargers (${r.want} wanted)`);
    check(api, `houses=${houses}: the cars' soft shadows draw`, r.shadow > 30 && r.shapes > 0, `${r.shadow} px change without them · ${r.shapes} cars near`);
    check(api, `houses=${houses}: no page errors`, errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, `houses=${houses}`, false, e.message.slice(0, 300)); }
  await page.close();
}
// 3 · on the display's clock: playing draws, paused rests
if (part('rest')) for (const api of ['webgpu', 'webgl2']) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity&graphics=${api}&n=2000&dpr=1&log=0`, { width: 390, height: 844 });
  try {
    await settledFrame(page);
    const r = await page.evaluate(async () => {
      const { w, play } = window.aslnutDemo, count = async (ms) => { const n0 = w.renderer.frames; await new Promise((ok) => setTimeout(ok, ms)); return w.renderer.frames - n0; };
      play.setSpeed(4); play.play(); const playing = await count(1000), wants = w.telemetry().frames;
      play.pause(); await w.settled({ strict: true }); const paused = await count(1500);
      return { playing, paused, who: wants.who, wants: wants.wants };
    });
    // (SwiftShader draws a few frames a second: playing, the fleet is what asks for them)
    check(api, 'playing draws; paused, it rests', r.playing > 0 && r.who === 'fleet' && r.paused === 0, `${r.playing} frames in 1 s playing (wanted by ${r.who}: ${r.wants}) · ${r.paused} in 1.5 s paused`);
    // after a flight the world rests: a NaN in the view once drew every frame for ever (the view never the same twice)
    const fly = await page.evaluate(async () => {
      const { w } = window.aslnutDemo, c = w.camera, sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
      const after = async (settle = true) => {
        if (settle) await w.settled({ timeout: 60000 }).catch(() => {});
        for (let i = 0; i < 40 && !w.telemetry().frames.resting; i++) await sleep(250);
        w.drawnWhy(); const n0 = w.stats().drawn; await sleep(3000); return { frames: w.stats().drawn - n0, resting: w.telemetry().frames.resting, why: w.drawnWhy() };
      };
      const v = c.view, at = { lon: v.lon, lat: v.lat, zoom: v.zoom };
      // (the case found: a bearing read from the camera itself, which has none: its yaw is radians, the view is c.view)
      let refused = ''; try { await w.fly({ ...at, tilt: 40, bearing: (c.bearing + 25) % 360 }, { seconds: 1 }); } catch (e) { refused = e.code; }
      const nan = { refused, same: c.view.bearing === v.bearing && c.view.tilt === v.tilt, ...(await after()) };
      // the view read written back as it is (its dist and zoom agree), from a resting world: it takes its second
      const t0 = performance.now(); await w.fly({ ...c.view, tilt: 15, bearing: (v.bearing + 25) % 360 }, { seconds: 1 }); const ms = Math.round(performance.now() - t0);
      const real = { ms, tilt: Math.round(c.view.tilt), bearing: Math.round(c.view.bearing), ...(await after()) };
      // a NaN written straight into the camera: said once (E-VIEW-001), not repaired, and the world rests all the same
      const said = [], off = w.on('error', (e) => said.push(e.code)); c.yaw = NaN; w.invalidate();
      // (no settling for it: a camera that is not one never settles)
      const field = { said, kept: Number.isNaN(c.yaw), ...(await after(false)) }; off(); w.go({ ...at, tilt: v.tilt, bearing: v.bearing });
      return { nan, real, field };
    });
    check(api, 'after a flight it rests: a NaN bearing refused (E-VIEW-001, nothing changes), a flight that tilts and turns arrives, then 0 frames in 3 s', fly.nan.refused === 'E-VIEW-001' && fly.nan.same && fly.nan.frames === 0 && fly.nan.resting && fly.real.tilt === 15 && fly.real.frames === 0 && fly.real.resting, JSON.stringify({ nan: fly.nan, real: fly.real }));
    check(api, 'a flight from a resting world takes its seconds (w.camera.view flown back as it is); a NaN written into the camera is said once and the world rests', fly.real.ms >= 990 && fly.field.said.length === 1 && fly.field.said[0] === 'E-VIEW-001' && fly.field.kept && fly.field.frames === 0 && fly.field.resting, JSON.stringify({ ms: fly.real.ms, field: fly.field }));
    check(api, 'rest: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'rest', false, e.message.slice(0, 300)); }
  await page.close();
}
// 5 · a live log: appends only (one page, both graphics)
if (part('live')) for (const api of ['webgpu', 'webgl2']) {
  const { page, errors } = await openDemo(browser, `${base}?go=parity&graphics=${api}&n=500&dpr=1&clock=30&log=0`, { width: 390, height: 844 });
  try {
    await settledFrame(page);
    const r = await page.evaluate(async () => {
      const { w } = window.aslnutDemo, a = window.aslnutDemo.lib;
      const live = a.history.log({ values: { charge: 'u8' }, keep: 64 }), set = a.entities({ id: 'live', drive: a.drive.data(live), color: { value: 'charge', ramp: 'viridis' }, trail: { seconds: 30 } });
      const t0 = w.time.getTime(), N = 500;
      for (let i = 0; i < N; i++) for (let k = 0; k < 8; k++) live.append(`L${i}`, t0 - 8000 + k * 1000, 145.10 + (i % 25) * 0.002 + k * 1e-4, -37.93 + Math.floor(i / 25) * 0.0015, { charge: k / 8 });
      w.add(set); await w.settled({ strict: true });
      const g = w.graphics, out = [], frame = () => new Promise((ok) => { w.invalidate(); w.once('frame', ok); });
      // a frame with nothing appended: what every frame uploads (the frame block, the uniforms)
      await frame(); const base = g.stats.uploadBytes;
      for (const n of [1, 50, 500]) {
        const tick = w.time.getTime() + 1000;
        const ms0 = performance.now(); for (let i = 0; i < n; i++) live.append(`L${i}`, tick, 145.10 + (i % 25) * 0.002 + 9e-4, -37.93 + Math.floor(i / 25) * 0.0015, { charge: 1 }); const appendMs = performance.now() - ms0;
        await frame(); out.push({ n, bytes: g.stats.uploadBytes - base, uploads: g.stats.uploads, appendMs: +appendMs.toFixed(3), frameMs: +w.frameProfile().ms?.toFixed?.(2) });
      }
      return { out, logBytes: live.bytes };
    });
    // a sample: 4 bytes of time (f32), 8 of place (f32), 1 of charge (its texel: 4), its vehicle's slots and look (32)
    const ok = r.out.every((x) => x.bytes <= x.n * (4 + 8 + 4 + 32) + 256);
    check(api, 'a live log uploads only what was appended', ok, r.out.map((x) => `${x.n} new: +${x.bytes} bytes in ${x.uploads} uploads (append ${x.appendMs} ms)`).join(' · ') + ` · the log holds ${(r.logBytes / 1024).toFixed(0)} KB`);
    check(api, 'live: no page errors', errors.length === 0, errors.slice(0, 3).join(' | '));
  } catch (e) { check(api, 'live log', false, e.message.slice(0, 300)); }
  await page.close();
}
await browser.close(); srv.close();
console.log(failed ? `${failed} FAILED` : 'all passed');
process.exit(failed ? 1 : 0);
