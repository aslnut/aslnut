// The layers example's smoke test (examples/layers: a GIS map in the world), on WebGPU AND WebGL2 (every check on
// both; a failure on either fails the run). No network: &parity=1 (a procedural ground on the street level's own
// terrain; the tools' own map and feature service, tools/ows-mock.mjs, answering what the example asks).
//   1. the map renders its layers (WMS pictures, WFS features), settles, no page errors; the list's groups; on a map
//      nothing stands, nothing is drawn over solids
//   2. WFS: each layer's features in, loaded once over its area: a pan, a zoom out and in, a tilt and a turn ask for
//      nothing and change no feature (data is never changed by looking)
//   3. every kind of shape drawn as its kind: a polygon's hole left open, a multipolygon's pieces and the gap between
//      them, a multiline's pieces and its gap, every point of a multipoint, points, lines, a WMS picture, labels
//   4. the list: hidden, shown, faded, a WMS picture dragged over the vectors: one frame each, nothing built again;
//      the WMS layers' legends their pictures; the WMS picture asked again for new ground
//   5. a tap: the feature's attributes and what the WMS says is there; a layer added from the service's capabilities
//   6. a feature born just before a late frame is drawn whole (its reveal ends written, not left part-way)
//   7. lines drawn alike on the ground's tiles and as prisms (a phone's route and a desktop's)
//   8. with the twin (&twin=1): the draped layers' parts over the solids drawn after them, the terrain's depth kept
//      once, the points' part behind things drawn; a layer's place changed changes the picture
//   9. groups (&go=groups: the places counted per suburb, core › space › regions › rollup): at the district's level a
//      card each (its count: the places inside it), the places hidden; at the street's, the places, the cards gone; the
//      levels changed only through their gates; still, nothing drawn
//   node tools/smoke-layers.mjs [webgl2,webgpu]      (run the examples' build first)
import { serve } from './serve.mjs';
import { launch, openDemo } from './browser.mjs';
import { MIDDLE } from './ows-mock.mjs';

const apis = (process.argv[2] ?? 'webgpu,webgl2').split(','), PORT = Number(process.env.PORT ?? 8791);
const srv = await serve(PORT), browser = await launch();
let fail = 0;
const check = (api, name, ok, info) => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${api.padEnd(6)} ${name}${info ? ` · ${typeof info === 'string' ? info : JSON.stringify(info)}` : ''}`); if (!ok) fail++; };
const URL0 = (api, q) => `http://127.0.0.1:${PORT}/examples/layers/?parity=1&graphics=${api}&dpr=1&log=0&${q}`;
/** in the page: helpers on window (frames, pixels where a place is, one change measured) */
const HELPERS = () => {
  const { w } = window.aslnutDemo;
  const sleep = (ms) => new Promise((k) => setTimeout(k, ms));
  const grab = async () => { const f = await w.frame(); return f; };
  /** a place's pixel neighbourhood differs between two frames (r px round it) */
  const differs = (a, b, lon, lat, r = 3) => {
    const s = w.camera.project(lon, lat, w.heightAt(lon, lat)); if (!s) return null;
    const k = a.width / w.camera.width, cx = Math.round(s[0] * k), cy = Math.round(s[1] * k); let n = 0;
    for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { if (x < 0 || y < 0 || x >= a.width || y >= a.height) continue; const i = (y * a.width + x) * 4; if (Math.abs(a.pixels[i] - b.pixels[i]) + Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) + Math.abs(a.pixels[i + 2] - b.pixels[i + 2]) > 30) n++; }
    return n;
  };
  const only = async (ids) => { for (const id of window.aslnutDemo.layers) { if (ids.includes(id)) w.release(id, { seconds: 0 }); else w.hide(id, { seconds: 0 }); } await w.settled({ timeout: 240000 }).catch(() => {}); await sleep(300); return grab(); };
  window.__h = { sleep, grab, differs, only };
};

for (const api of apis) {
  // ── 1–7: the map ──
  let { page, errors } = await openDemo(browser, URL0(api, 'go=top'), { width: 390, height: 640 });
  try {
    await page.evaluate(HELPERS);
    const r = await page.evaluate(async () => {
      const { w, list, sources } = window.aslnutDemo;
      const ok = await w.settled({ timeout: 300000 }).catch((e) => String(e.message));
      const g = w.graphics, orig = g.frame.bind(g); let got = null;
      g.frame = (d, o) => { if (!o.target && !got) got = d.map((x) => ({ upper: !!x.upper, keep: !!x.keepDepth })); return orig(d, o); };
      w.invalidate(); for (let t = 0; !got && t < 600; t++) await window.__h.sleep(50); g.frame = orig;
      const wfs = Object.fromEntries(Object.entries(sources).filter(([, s]) => s?.info).map(([id, s]) => [id, { n: s.size, req: s.info.requests }]));
      return { ok, api: w.api, standing: w.standing, uppers: (got ?? []).filter((x) => x.upper).length, keeps: (got ?? []).filter((x) => x.keep).length, groups: list.describe().groups.map((x) => [x.name, x.items.length]), wfs, pics: ['zones', 'bushfire'].map((id) => w.element(id).picture) };
    });
    check(api, 'the map renders its layers, settled, no errors; nothing stands, nothing drawn over solids', r.api === api && r.ok === true && !r.standing && r.uppers === 0 && r.keeps === 0 && !errors.length, { settled: r.ok, uppers: r.uppers, keeps: r.keeps, errors: errors.slice(0, 2) });
    check(api, 'the list: Data 9 (the suburbs\' and the councils\' names inside their layers), Base 1 (the terrain)', JSON.stringify(r.groups) === JSON.stringify([['Data', 9], ['Base', 1]]), r.groups);
    // (what the screen's own tiles hold: the suburbs and councils round the middle, every site, the creeks and
    // pipelines through it, the places and dams near it)
    check(api, 'WFS: every layer\'s features in for the view', ['suburbs:4', 'sites:4', 'councils:2', 'creeks:2', 'pipelines:1', 'places:20', 'dams:2'].every((x) => { const [id, n] = x.split(':'); return r.wfs[id]?.n >= Number(n); }), r.wfs);
    check(api, 'WMS: one picture of the view each, its box round the view', r.pics.every((p) => p?.asked === 1 && p.box && p.box[0] < MIDDLE[0] && p.box[2] > MIDDLE[0] && p.box[1] < MIDDLE[1] && p.box[3] > MIDDLE[1]), r.pics);

    // ── 2: loaded once: a pan, a zoom out and in, a tilt and a turn ──
    const pan = await page.evaluate(async () => {
      const { w, sources } = window.aslnutDemo, all = [...new Set(Object.values(sources).filter((s) => s?.info))], req = () => all.reduce((n, s) => n + s.info.requests, 0), c = w.camera, v = { lon: c.lon, lat: c.lat, zoom: c.zoom, tilt: w.state.view.tilt, bearing: w.state.view.bearing };
      const vers = () => all.map((s) => s.version).join(','), r0 = req(), v0 = vers(), n0 = all.reduce((n, s) => n + s.size, 0);
      w.go({ ...v, lon: v.lon + 0.012 }); await w.settled({ timeout: 240000 }).catch(() => {});
      const r1 = req(), pic = w.element('zones').picture;
      for (const x of [{ ...v, zoom: v.zoom - 3 }, { ...v, zoom: v.zoom + 2, tilt: 70, bearing: 200 }, v]) { w.go(x); await w.settled({ timeout: 240000 }).catch(() => {}); }
      return { sources: all.length, first: r0, pan: r1 - r0, after: req() - r1, handedAgain: vers() !== v0, features: [n0, all.reduce((n, s) => n + s.size, 0)], pic };
    });
    check(api, 'loaded once: a pan, a zoom out and in, a tilt and a turn ask for nothing, hand nothing again', pan.first >= pan.sources && pan.pan === 0 && pan.after === 0 && !pan.handedAgain && pan.features[0] === pan.features[1], pan);
    check(api, 'the WMS picture asked again for the new ground (and covers it)', pan.pic.asked >= 2 && pan.pic.box[0] < MIDDLE[0] + 0.012 && pan.pic.box[2] > MIDDLE[0] + 0.012, pan.pic);

    // ── 3: every kind of shape ──
    const shapes = await page.evaluate(async (M) => {
      const { w } = window.aslnutDemo, h = window.__h;
      const none = await h.only([]);
      const at = async (ids, probes) => { const f = await h.only(ids); return probes.map(([lon, lat, r]) => h.differs(f, none, lon, lat, r ?? 3)); };
      const out = {};
      // a polygon with a hole: the hole open, round it painted (its fill made strong for the look)
      w.element('suburbs').setProps({ area: { opacity: 1 } });
      out.hole = await at(['suburbs'], [[M[0], M[1]], [M[0] + 0.0011, M[1]], [M[0] - 0.0011, M[1] + 0.0003]]);
      w.element('suburbs').setProps({ area: { opacity: 0.35 } });
      // a multipolygon: both pieces painted, the gap between them not
      const site = [M[0] - 0.0024, M[1] - 0.0024];
      out.multipolygon = await at(['sites'], [[site[0] - 0.00055, site[1]], [site[0] + 0.00055, site[1]], [site[0], site[1], 2]]);
      // a multiline: both pieces drawn, the gap between them not
      const px = M[0] + 0.0009, p2 = (t) => [px + 0.004 * t, (M[1] + 0.0015) + (-37.89 - (M[1] + 0.0015)) * t];
      out.multiline = await at(['pipelines'], [[px, M[1] - 0.0025, 5], [...p2(0.03), 5], [px, M[1], 3]]);
      // a line: along a creek's own points
      const creek = w.element('creeks').source.features().find((f) => f.id === 'hy_watercourse.2').geometry.coordinates;
      out.line = await at(['creeks'], creek.filter((p) => Math.abs(p[0] - M[0]) < 0.0015).slice(0, 4).map((p) => [p[0], p[1], 2]));
      // a multipoint: every point of the ones near the middle; points
      const places = w.element('places').source.features().filter((f) => Math.abs(f.geometry.coordinates[0][0] - M[0]) < 0.0015 && Math.abs(f.geometry.coordinates[0][1] - M[1]) < 0.002);
      const pp = places.flatMap((f) => f.geometry.coordinates);
      out.multipoint = await at(['places'], pp.map((p) => [p[0], p[1], 2]));
      out.multipointCount = { features: places.length, points: pp.length, shown: w.element('places').readouts().shown(), total: w.element('places').source.features().reduce((n, f) => n + f.geometry.coordinates.length, 0) };
      const dams = w.element('dams').source.features().map((f) => f.geometry.coordinates).filter((p) => Math.abs(p[0] - M[0]) < 0.003 && Math.abs(p[1] - M[1]) < 0.003);
      out.point = await at(['dams'], dams.map((p) => [p[0], p[1], 2]));
      out.picture = await at(['zones'], [[M[0], M[1]], [M[0] + 0.0013, M[1] - 0.0017]]);
      // labels: the suburbs' names a little further out (their middles on the screen)
      const c = w.camera, v0 = { lon: c.lon, lat: c.lat, zoom: c.zoom, tilt: w.state.view.tilt, bearing: w.state.view.bearing };
      // (the suburbs' names are inside the suburbs' layer: its fill with and without them)
      w.go({ ...v0, zoom: 14.6 }); const nf = await h.only(['suburbs']); w.hide('suburbs-labels', { seconds: 0 }); await w.settled({ timeout: 240000 }).catch(() => {});
      const none2 = await h.grab(); w.release('suburbs-labels', { seconds: 0 });
      let lab = 0; for (let i = 0; i < nf.pixels.length; i += 4) if (Math.abs(nf.pixels[i] - none2.pixels[i]) > 40) lab++;
      out.labels = lab; out.labelCount = w.element('suburbs-labels').readouts().shown();
      w.go(v0);
      await h.only(window.aslnutDemo.layers);
      return out;
    }, MIDDLE);
    const on = (n) => n > 0, off = (n) => n === 0;
    check(api, 'a polygon with a hole: the hole open, round it painted', off(shapes.hole[0]) && on(shapes.hole[1]) && on(shapes.hole[2]), shapes.hole);
    check(api, 'a multipolygon: both pieces painted, the gap between them not', on(shapes.multipolygon[0]) && on(shapes.multipolygon[1]) && off(shapes.multipolygon[2]), shapes.multipolygon);
    check(api, 'a multiline: both pieces drawn, the gap between them not', on(shapes.multiline[0]) && on(shapes.multiline[1]) && off(shapes.multiline[2]), shapes.multiline);
    check(api, 'a line: drawn along its own points', shapes.line.length >= 2 && shapes.line.every(on), shapes.line);
    check(api, 'a multipoint: every point drawn (one place per point)', shapes.multipoint.length >= 4 && shapes.multipoint.every(on) && shapes.multipointCount.shown === shapes.multipointCount.total, { at: shapes.multipoint, ...shapes.multipointCount });
    check(api, 'points drawn', shapes.point.length >= 2 && shapes.point.every(on), shapes.point);
    check(api, 'a WMS picture drawn over the ground', shapes.picture.every(on), shapes.picture);
    check(api, 'labels drawn', shapes.labels > 60 && shapes.labelCount >= 2, { px: shapes.labels, labels: shapes.labelCount });

    // ── 4: the list ──
    const change = async (code) => page.evaluate(async (code) => {
      const { w, list } = window.aslnutDemo, h = window.__h;
      const ls = w.list.filter((l) => window.aslnutDemo.layers.includes(l.id));
      const gen = () => ls.map((l) => `${l.geoGen ?? ''}:${l.seen?.scales ?? ''}`).join('|');
      await h.sleep(800); const a = (await h.grab()).pixels; await h.sleep(800);
      const g0 = gen(), s0 = w.stats();
      new Function('w', 'list', code)(w, list);
      await h.sleep(1200);
      const s1 = w.stats(), drawn = s1.drawn - s0.drawn, asked = s1.drawn - s0.drawn + s1.skipped - s0.skipped;
      const b = (await h.grab()).pixels; let diff = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) diff++;
      return { drawn, asked, changed: +(diff / (a.length / 4)).toFixed(4), rebuilt: gen() !== g0, order: w.list.map((l) => l.id).filter((id) => window.aslnutDemo.layers.includes(id)) };
    }, code);
    const one = (c) => c.drawn === 1 && c.asked <= 2 && !c.rebuilt;
    let c = await change("list.show('suburbs', false)");
    check(api, 'the list hides a layer: one frame, the picture changes, nothing built again', one(c) && c.changed > 0.02, { ...c, order: undefined });
    c = await change("list.show('suburbs', true)");
    check(api, 'and shows it again: one frame', one(c) && c.changed > 0.02, { ...c, order: undefined });
    c = await change("list.setOpacity('zones', 0.15)");
    check(api, 'a WMS picture\'s opacity: one frame, the picture changes, nothing built again', one(c) && c.changed > 0.01, { ...c, order: undefined });
    c = await change("list.setOpacity('zones', 0.45)");
    check(api, 'and back', one(c), { ...c, order: undefined });
    c = await change("list.restack('Data', ['dams', 'places', 'zones', 'pipelines', 'creeks', 'councils', 'sites', 'suburbs', 'bushfire'])");
    const at = (id) => c.order.indexOf(id);
    check(api, 'the list drags the WMS picture over the vector layers: one frame, nothing built again', one(c) && c.changed > 0.01 && at('zones') > at('suburbs') && at('zones') > at('pipelines'), { ...c, order: c.order.join(' ') });
    const legends = await page.evaluate(() => window.aslnutDemo.list.describe().groups[0].items.filter((i) => i.legend?.kind === 'image').map((i) => [i.id, /GetLegendGraphic/.test(i.legend.image)]));
    check(api, 'the WMS layers\' legends: their own pictures (GetLegendGraphic)', legends.length === 2 && legends.every((x) => x[1]), legends);

    // ── 5: a tap, and a layer added from the service ──
    const tap = await page.evaluate(async (M) => {
      const { w } = window.aslnutDemo, h = window.__h;
      const f = w.element('places').source.features().find((x) => Math.abs(x.geometry.coordinates[0][0] - M[0]) < 0.002 && Math.abs(x.geometry.coordinates[0][1] - M[1]) < 0.002);
      const p = f.geometry.coordinates[0], s = w.camera.project(p[0], p[1], w.heightAt(p[0], p[1])), r = w.renderer.canvas.getBoundingClientRect();
      return { x: r.left + s[0], y: r.top + s[1], name: f.props.name_label };
    }, MIDDLE);
    await page.mouse.click(tap.x, tap.y); await page.waitForFunction(() => /zone code/.test(document.getElementById('identify').innerText), null, { timeout: 60000 }).catch(() => {});
    const said = await page.evaluate(() => document.getElementById('identify').innerText);
    check(api, 'a tap: the feature\'s attributes and what the WMS says is there', said.includes(tap.name) && /zone code/.test(said) && /Planning zones/.test(said), said.replace(/\s+/g, ' ').slice(0, 160));
    const added = await page.evaluate(async () => {
      const { w, list, ows } = window.aslnutDemo;
      const wf = await list.listService(`${ows}/wfs`, 'wfs'), wm = await list.listService(`${ows}/wms`, 'wms');
      const a = await list.addFrom(wf.find((p) => p.name.endsWith(':hy_watercourse'))), b = await list.addFrom(wm.find((p) => p.name.endsWith(':plan_zone')));
      await w.settled({ timeout: 240000 }).catch(() => {});
      const d = list.describe().groups[0].items.map((i) => i.id);
      return { wfs: wf.length, wms: wm.length, a: [a.id, a.kind, a.size], b: [b.id, b.kind, b.picture?.asked], listed: d.includes(a.id) && d.includes(b.id) };
    });
    check(api, 'a layer added from the service\'s capabilities (WFS lines, a WMS picture), listed with the data', added.wfs === 7 && added.wms === 2 && added.a[1] === 'line' && added.a[2] >= 2 && added.b[1] === 'area' && added.b[2] >= 1 && added.listed, added);

    // ── 6: a feature born just before a late frame is drawn whole ──
    const late = await page.evaluate(async (M) => {
      const { w } = window.aslnutDemo, h = window.__h, P = w.element('dams').constructor;
      const l = new P({ id: 'late', data: [], size: 40, color: '#ff00ff' }); w.add(l);
      await w.settled({ timeout: 120000 }).catch(() => {});
      // the world's frames by hand: the feature born in one frame, the next a second late (a slow device)
      w.stop();
      l.setProps({ data: [{ id: 'one', props: {}, geometry: { type: 'Point', coordinates: [M[0], M[1]] } }] });
      for (let i = 0; i < 60 && !l.entries?.length; i++) w.step(16);
      const pr = () => l.entries.map((e) => +l.featData[l.at(e.index, 2) + 2].toFixed(3));
      const first = pr();
      w.step(1000); w.step(16);
      const after = pr(), f = await w.frame();
      const s = w.camera.project(M[0], M[1], w.heightAt(M[0], M[1])), k = f.width / w.camera.width, i = (Math.round(s[1] * k) * f.width + Math.round(s[0] * k)) * 4;
      const px = [f.pixels[i], f.pixels[i + 1], f.pixels[i + 2]];
      w.start(); w.remove('late');
      return { first, after, px };
    }, MIDDLE);
    check(api, 'a feature born just before a late frame: its reveal ends whole, drawn at full strength', late.first.length === 1 && late.first[0] < 0.5 && late.after[0] === 1 && late.px[0] > 200 && late.px[1] < 80 && late.px[2] > 200, late);
  } catch (e) { check(api, 'the map', false, String(e.message).slice(0, 300)); }
  await page.close();

  // ── 7: lines on the ground's tiles as on prisms ──
  const lines = {};
  for (const route of ['tiles', 'prisms']) {
    ({ page, errors } = await openDemo(browser, URL0(api, `go=top&only=creeks,pipelines,councils&ground=${route}`), { width: 390, height: 640 }));
    try {
      lines[route] = await page.evaluate(async () => {
        const { w } = window.aslnutDemo; await w.settled({ timeout: 240000 }).catch(() => {}); await new Promise((k) => setTimeout(k, 500));
        const a = await w.frame(); for (const id of ['creeks', 'pipelines', 'councils']) w.hide(id, { seconds: 0 });
        await w.settled({ timeout: 60000 }).catch(() => {}); await new Promise((k) => setTimeout(k, 300)); const b = await w.frame();
        let n = 0, sum = 0; for (let i = 0; i < a.pixels.length; i += 4) { const d = Math.abs(a.pixels[i] - b.pixels[i]) + Math.abs(a.pixels[i + 1] - b.pixels[i + 1]) + Math.abs(a.pixels[i + 2] - b.pixels[i + 2]); if (d > 24) { n++; sum += d; } }
        return { n, mean: n ? +(sum / n).toFixed(1) : 0, route: w.groundMarks };
      });
    } catch (e) { lines[route] = { error: String(e.message).slice(0, 200) }; }
    await page.close();
  }
  const lt = lines.tiles, lp = lines.prisms;
  check(api, 'lines drawn alike on the ground\'s tiles and as prisms (pixels within 12 %, strength within 10 %)', lt?.n > 500 && lp?.n > 500 && Math.abs(lt.n - lp.n) / lp.n < 0.12 && Math.abs(lt.mean - lp.mean) / lp.mean < 0.1, lines);

  // ── 8: with the twin ──
  ({ page, errors } = await openDemo(browser, URL0(api, 'go=street&twin=1'), { width: 390, height: 640 }));
  try {
    await page.evaluate(HELPERS);
    const r = await page.evaluate(async () => {
      const { w, list } = window.aslnutDemo;
      const ok = await w.settled({ timeout: 300000, strict: true }).catch((e) => String(e.message).slice(0, 300));
      await window.__h.sleep(1000);
      const g = w.graphics, orig = g.frame.bind(g); let got = null;
      g.frame = (d, o) => { if (!o.target && !got) got = d.map((x) => ({ label: x.program.label, upper: !!x.upper, keep: !!x.keepDepth })); return orig(d, o); };
      w.invalidate(); for (let t = 0; !got && t < 600; t++) await window.__h.sleep(50); g.frame = orig;
      return { ok, pending: w.report().pending.slice(0, 4), standing: w.standing, groups: list.describe().groups.map((x) => [x.name, x.items.length]), uppers: (got ?? []).filter((x) => x.upper).map((x) => x.label), keeps: (got ?? []).filter((x) => x.keep).length, behind: (got ?? []).some((x) => /points (places|dams) \(behind\)/.test(x.label)) };
    });
    check(api, 'with the twin: settled, no errors; the list: Data 9, Base 6', r.ok === true && !errors.length && JSON.stringify(r.groups) === JSON.stringify([['Data', 9], ['Base', 6]]), { settled: r.ok, pending: r.pending, groups: r.groups, errors: errors.slice(0, 2) });
    check(api, 'solids drawn: the draped layers\' parts over them, the terrain kept once, points behind', r.standing && r.uppers.length >= 4 && r.keeps === 1 && r.behind, { uppers: r.uppers.length, keeps: r.keeps, behind: r.behind });
    const place = async (code) => page.evaluate(async (code) => {
      const { w } = window.aslnutDemo, h = window.__h;
      const a = (await h.grab()).pixels; new Function('w', code)(w); await w.settled({ timeout: 120000 }).catch(() => {}); await h.sleep(600);
      const b = (await h.grab()).pixels; let diff = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 24) diff++;
      return +(diff / (a.length / 4)).toFixed(3);
    }, code);
    const g1 = await place("w.element('suburbs').setProps({ drape: 'ground' })"), g2 = await place("w.element('suburbs').setProps({ drape: 'over' })");
    check(api, 'the suburbs on the ground (the roofs left as they are), then over everything again: the picture changes', g1 > 0.01 && g2 > 0.01, { ground: g1, over: g2 });
  } catch (e) { check(api, 'with the twin', false, String(e.message).slice(0, 300)); }
  await page.close();
}
// ── 9: groups per level ──
for (const api of apis) {
  // (the display's clock: a fixed one draws every frame, and a still view is what is checked)
  const { page, errors } = await openDemo(browser, URL0(api, 'go=groups'), { width: 390, height: 844 });
  try {
    const r = await page.evaluate(async () => {
      const { w, groups } = window.aslnutDemo;
      const ok = await w.settled({ timeout: 300000 }).catch((e) => String(e.message).slice(0, 200));
      const places = w.element('places'), cards = w.element('suburb-cards'), src = groups.sources[0];
      // (the places from their source: the layer itself is hidden at this level, and builds nothing while hidden)
      const pts = window.aslnutDemo.sources.places?.size ?? 0, sum = src.features().reduce((a, f) => a + f.props.n, 0);
      const at = (lv) => ({ level: w.level, cards: cards.target, places: places.target });
      const district = at();
      // to the street: the level changes past its edge by the margin, after the dwell; the gates swap them
      const v = w.camera; await w.fly({ lon: v.lon, lat: v.lat, zoom: 15.6, tilt: 20, bearing: 0 }, { seconds: 0 });
      await w.settled({ timeout: 120000 }).catch(() => {}); await new Promise((k) => setTimeout(k, 1200)); await w.settled({ timeout: 60000 }).catch(() => {});
      const street = at();
      await w.fly({ lon: v.lon, lat: v.lat, zoom: 12.9, tilt: 20, bearing: 0 }, { seconds: 0 });
      await w.settled({ timeout: 120000 }).catch(() => {}); await new Promise((k) => setTimeout(k, 1200)); await w.settled({ timeout: 60000 }).catch(() => {});
      const back = at();
      const n0 = w.renderer.frames; await new Promise((k) => setTimeout(k, 1500)); const still = w.renderer.frames - n0;
      return { ok, groups: src.size, sum, pts, district, street, back, still, changes: w.gates?.counts };
    });
    check(api, 'groups: settled, no errors; the places counted per suburb (made once, in a worker)', r.ok === true && !errors.length && r.groups >= 2 && r.sum > 0 && r.sum <= r.pts, { settled: r.ok, groups: r.groups, counted: r.sum, places: r.pts, errors: errors.slice(0, 2) });
    check(api, 'groups: at the district\'s level a card each, the places hidden', r.district.level === 'district' && r.district.cards > 0 && r.district.places === 0, r.district);
    check(api, 'groups: at the street\'s, the places, the cards gone (through the gates); back again', r.street.level === 'street' && r.street.places > 0 && r.street.cards === 0 && r.back.cards > 0 && r.back.places === 0, { street: r.street, back: r.back, gates: r.changes });
    check(api, 'groups: still, nothing drawn', r.still === 0, `${r.still} frames in 1.5 s`);
  } catch (e) { check(api, 'groups', false, String(e.message).slice(0, 300)); }
  await page.close();
}
await browser.close(); srv.close();
console.log(fail ? `FAIL ${fail} check(s)` : 'ok   every check');
process.exit(fail ? 1 : 0);
