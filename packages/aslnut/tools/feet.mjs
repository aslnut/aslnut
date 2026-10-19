// Where people stand, on WebGPU and WebGL2: each person's height against the street surface drawn under them (the
// baked roads' own mesh, read here on the CPU: every face that looks up, at the person's place), and close frames of
// their feet: the lineup close and far, a walker of the crowd beside a kerb, the person you walk as, someone on the
// footbridge (and one under it, on the road), and the person you walk as on Haughton Road by a zebra crossing, where
// the road lies highest over the ground.
//   node tools/feet.mjs [out dir]   (PHASE=before|after names the frames; APIS=webgpu; ONLY=lineup or street; run
//   `npm run examples` first)
import { serve } from './serve.mjs';
import { launch, openDemo, settledFrame, bytesOf } from './browser.mjs';
import { png } from './png.mjs';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { bakedMesh, bakedPieces, BAKED_LOOK } from '../src/modules/world/earth/presets/built/roads/baked.ts';
import { MESH_FLOATS } from '../src/core/geometry/shapes/mesh.ts';
import { facetsOf } from '../src/core/geometry/networks/facets.ts';

const ONLY = process.env.ONLY ?? '', OUT = process.argv[2] ?? join(import.meta.dirname, '..', '.out', 'feet'), PHASE = process.env.PHASE ?? 'after', PORT = Number(process.env.PORT ?? 8742);
const ROADS = join(import.meta.dirname, '..', '..', '..', 'data', 'packs', 'roads', 'street'), IDX = JSON.parse(readFileSync(join(ROADS, 'index.json'), 'utf8'));
const KX = 111320 * Math.cos((IDX.origin[1] * Math.PI) / 180), KZ = 110574;
mkdirSync(OUT, { recursive: true });

// ── the drawn surface: the up-facing triangles of a baked tile's mesh (as drawn), at a place (not a parapet's top
// nor a pier's: their colours) ──
const meshes = new Map(), NOT_STOOD = new Set([BAKED_LOOK['parapet-top'], BAKED_LOOK['pier-cap']].map((c) => parseInt(c.slice(1), 16)));
const meshOf = (ix, iz) => { const k = `${ix}_${iz}`; if (!meshes.has(k)) { const f = join(ROADS, `${k}.json`); meshes.set(k, existsSync(f) ? bakedMesh(JSON.parse(readFileSync(f, 'utf8')), IDX.kinds, BAKED_LOOK).mesh : null); } return meshes.get(k); };
/** the heights of every drawn face looking up at [lon, lat] (true m, highest first) */
function drawnAt(lon, lat) {
  const X = (lon - IDX.origin[0]) * KX, Z = -(lat - IDX.origin[1]) * KZ, out = [];
  for (let ix = Math.floor((X - 2) / IDX.size); ix <= Math.floor((X + 2) / IDX.size); ix++) for (let iz = Math.floor((Z - 2) / IDX.size); iz <= Math.floor((Z + 2) / IDX.size); iz++) {
    const m = meshOf(ix, iz); if (!m) continue;
    const x = X - ix * IDX.size, z = Z - iz * IDX.size, F = MESH_FLOATS;
    for (let i = 0; i < m.length; i += 3 * F) {
      const ax = m[i], ay = m[i + 1], az = m[i + 2], bx = m[i + F], by = m[i + F + 1], bz = m[i + F + 2], cx = m[i + 2 * F], cy = m[i + 2 * F + 1], cz = m[i + 2 * F + 2];
      if (x < Math.min(ax, bx, cx) || x > Math.max(ax, bx, cx) || z < Math.min(az, bz, cz) || z > Math.max(az, bz, cz)) continue;
      const ux = bx - ax, uy = by - ay, uz = bz - az, vx = cx - ax, vy = cy - ay, vz = cz - az, nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      if (ny < 0.7 * Math.hypot(nx, ny, nz) || NOT_STOOD.has(m[i + 3])) continue;
      const d = ux * vz - uz * vx; if (!d) continue;
      const s = ((x - ax) * vz - (z - az) * vx) / d, t = ((z - az) * ux - (x - ax) * uz) / d;
      if (s < -1e-6 || t < -1e-6 || s + t > 1 + 1e-6) continue;
      const h = ay + s * uy + t * vy; if (!out.some((q) => Math.abs(q - h) < 0.005)) out.push(h);
    }
  }
  return out.sort((a, b) => b - a);
}
/** a person against the drawn surface: its height, the ground's, the drawn levels; how far its soles are from the
 *  level it stands on (the nearest one from 3 m under its soles to 1.5 m over them: a deck higher over it is a roof) */
function measure(p) {
  const levels = drawnAt(p.lon, p.lat), h = p.h, on = levels.filter((l) => l <= h + 1.5 && l >= h - 3).sort((a, b) => Math.abs(a - h) - Math.abs(b - h))[0];
  const surface = on ?? p.ground;
  return { id: p.id, h: +h.toFixed(3), ground: +p.ground.toFixed(3), levels: levels.map((l) => +l.toFixed(3)), surface: +surface.toFixed(3), off: +(h - surface).toFixed(3) };
}

/** places on a road's carriageway in a tile (the middles of its triangles), each with how near a zebra's bar is (m) */
function roadSpots(tile, name) {
  const t = JSON.parse(readFileSync(join(ROADS, `${tile}.json`), 'utf8')), [ix, iz] = tile.split('_').map(Number), ids = new Set(t.infos.map((i, k) => (i.props?.name === name ? k : -1)).filter((k) => k >= 0)), ps = bakedPieces(t, IDX.kinds);
  // a zebra's bar: a marking of four corners, about 0.6 m by 2.5 m or more
  const bars = ps.filter((p) => p.t === 'poly' && p.kind === 'marking' && p.ring.length === 4).filter((p) => { const [a, b, c] = p.ring, s1 = Math.hypot(a[0] - b[0], a[1] - b[1]), s2 = Math.hypot(b[0] - c[0], b[1] - c[1]); return Math.min(s1, s2) > 0.45 && Math.min(s1, s2) < 0.75 && Math.max(s1, s2) > 2.4; }).map((p) => [(p.ring[0][0] + p.ring[2][0]) / 2, (p.ring[0][1] + p.ring[2][1]) / 2]);
  return facetsOf(ps.filter((p) => ids.has(p.info) && p.kind === 'carriageway' && p.t === 'area' && !p.overhead)).map((f) => { const x = (f.points[0][0] + f.points[1][0] + f.points[2][0]) / 3, z = (f.points[0][1] + f.points[1][1] + f.points[2][1]) / 3; return { lon: IDX.origin[0] + x / KX, lat: IDX.origin[1] - z / KZ, zebra: Math.min(Infinity, ...bars.map((b) => Math.hypot(b[0] - x, b[1] - z))) }; });
}
const HAUGHTON = roadSpots('5_5', 'Haughton Road');
const srv = await serve(PORT), browser = await launch(), report = {};
const base = `http://127.0.0.1:${PORT}/examples/healthy-city/`;
const FOOTBRIDGE = [145.1292777, -37.9111535], q0 = '&quality=realistic&dpr=1&clock=30&log=0';
// the people of a layer: id, place, height (true m), the ground's height there
const PEOPLE_OF = (ids) => { const { w } = window.aslnutDemo, ex = w.exaggeration, out = []; for (const id of ids) { let l = null; try { l = w.element(id); } catch { /* none */ } for (const e of l?.list?.() ?? []) out.push({ id: e.id, lon: e.at[0], lat: e.at[1], h: e.at[2] / ex, ground: w.heightAt(e.at[0], e.at[1]) }); } return out; };
async function shot(page, name, api) { const r = await settledFrame(page); const f = `${PHASE}-${name}-${api}.png`; writeFileSync(join(OUT, f), png(r.width, r.height, bytesOf(r))); return f; }
// a close view of the feet of someone at [lon, lat] (the view's centre a little behind them, the camera low)
const close = (page, at, o = {}) => page.evaluate(async ([at, o]) => {
  const { w } = window.aslnutDemo, D = Math.PI / 180, b = (o.bearing ?? 330) * D, kx = 111320 * Math.cos(at[1] * D), back = o.back ?? 0;
  w.camera.minDist = 1; w.go({ lon: at[0] + (Math.sin(b) * back) / kx, lat: at[1] + (Math.cos(b) * back) / 110574, dist: (o.dist ?? 3.2) / w.camera.frameK, tilt: o.tilt ?? 76, bearing: o.bearing ?? 330 });
  await w.settled({ timeout: 120000 });
}, [at, o]);

for (const api of (process.env.APIS ?? 'webgpu,webgl2').split(',')) {
  const rows = (report[api] = {});
  const open = async (go, extra = '') => openDemo(browser, `${base}?go=${go}&graphics=${api}${q0}${extra}`, { width: 640, height: 480 });
  // 1. the lineup close (people-close) and far (people): as the preset frames them, then each one's feet close
  for (const [go, name] of ONLY === 'street' ? [] : [['people-close', 'people-close'], ['people', 'lineup']]) {
    const { page, errors } = await open(go);
    try {
      await page.waitForFunction(() => { try { return !!window.aslnutDemo.w.element('lineup'); } catch { return false; } }, null, { timeout: 300000 });
      const frames = [await shot(page, name, api)];
      const ps = await page.evaluate(PEOPLE_OF, ['lineup']), m = ps.map(measure); rows[name] = m;
      const kid = ps.find((p) => /boy|girl/.test(p.id)) ?? ps[0];
      if (go === 'people-close' && kid) { await close(page, [kid.lon, kid.lat], { bearing: 150, back: 1.2, dist: 3, tilt: 80 }); frames.push(await shot(page, `${name}-feet`, api)); }
      console.log(`${api} ${name}: ${frames.join(', ')} · ${m.map((x) => `${x.id.replace('lineup-', '')} ${x.off >= 0 ? '+' : ''}${(x.off * 100).toFixed(1)} cm`).join(' · ')} · errors: ${errors.length ? errors.slice(0, 2).join(' | ') : 'none'}`);
    } catch (e) { console.log(`${api} ${name}: FAIL ${e.message.slice(0, 300)}`); }
    await page.close();
  }
  // 2. the crowd on the footpaths: everyone measured; the one nearest a kerb seen close
  if (ONLY !== 'lineup') {
    const { page, errors } = await open('parity-street', '&people=16&person=father');
    try {
      await settledFrame(page);
      await page.evaluate(async () => {
        const { w, people } = window.aslnutDemo, c = people.crowd;
        w.go({ lon: 145.1203, lat: -37.9238, zoom: 20.6, tilt: 70, bearing: 330 }); await w.settled({ timeout: 60000 });
        const t0 = performance.now(); while (c.figures().made < c.figures().wanted && performance.now() - t0 < 60000) { w.step(33); await w.frame(); }
        for (let i = 0; i < 40; i++) w.step(50);
        await w.settled({ timeout: 60000 });
      });
      const ps = await page.evaluate(PEOPLE_OF, ['people']), m = ps.map(measure); rows.crowd = m;
      // beside a kerb: a drawn step of 10 … 20 cm within a metre of them
      const step = (p) => { let best = 0; for (let a = 0; a < 8; a++) { const dx = Math.cos((a * Math.PI) / 4) / KX, dz = Math.sin((a * Math.PI) / 4) / KZ, l0 = drawnAt(p.lon, p.lat)[0], l1 = drawnAt(p.lon + dx, p.lat + dz)[0]; if (l0 !== undefined && l1 !== undefined) { const d = Math.abs(l0 - l1); if (d > 0.1 && d < 0.25) best = Math.max(best, d); } } return best; };
      const kerbside = ps.map((p) => ({ p, s: step(p) })).filter((x) => x.s > 0).sort((a, b) => b.s - a.s)[0]?.p ?? ps[0];
      if (kerbside) {
        await page.evaluate(() => { window.aslnutDemo.w.element('people').props.when = () => 1; });
        await close(page, [kerbside.lon, kerbside.lat], { bearing: 330, back: 2, dist: 4.6, tilt: 64 });
        const f = await shot(page, 'kerb', api), mk = measure((await page.evaluate(PEOPLE_OF, ['people'])).find((x) => x.id === kerbside.id));
        rows.kerb = mk;
        console.log(`${api} kerb: ${f} · ${mk.id} ${(mk.off * 100).toFixed(1)} cm off the drawn ${mk.surface} (levels ${mk.levels.join(', ')}, ground ${mk.ground})`);
      }
      const offs = m.map((x) => x.off).sort((a, b) => a - b);
      console.log(`${api} crowd: ${m.length} people · off the drawn surface: min ${(offs[0] * 100).toFixed(1)} median ${(offs[offs.length >> 1] * 100).toFixed(1)} max ${(offs[offs.length - 1] * 100).toFixed(1)} cm · errors: ${errors.length ? errors.slice(0, 2).join(' | ') : 'none'}`);
      // 3. the person you walk as: walk mode, a few steps
      const av = await page.evaluate(async () => {
        const { w, av } = window.aslnutDemo, key = (type, code) => window.dispatchEvent(new KeyboardEvent(type, { code, bubbles: true }));
        w.go({ lon: 145.1203, lat: -37.9238, zoom: 19, tilt: 60, bearing: 330 }); await w.settled({ timeout: 60000 });
        av.setMode('walk'); await w.settled({ timeout: 60000 });
        key('keydown', 'KeyW'); for (let i = 0; i < 20; i++) { w.step(100); if (i % 10 === 9) await w.frame(); } key('keyup', 'KeyW'); for (let i = 0; i < 10; i++) w.step(100); await w.settled({ timeout: 60000 });
        const e = av.me; return { id: 'me', lon: e.at[0], lat: e.at[1], h: e.at[2] / w.exaggeration, ground: w.heightAt(e.at[0], e.at[1]) };
      });
      const f3 = await shot(page, 'walk', api), ma = measure(av); rows.walk = ma;
      console.log(`${api} walk: ${f3} · me ${(ma.off * 100).toFixed(1)} cm off the drawn ${ma.surface} (levels ${ma.levels.join(', ')}, ground ${ma.ground})`);
      // 4. the footbridge: the person you walk as put on its deck (dropped a little over it), and one of the crowd
      // put on the road under it
      const fb = await page.evaluate(async ([at, deck]) => {
        const { w, av, people } = window.aslnutDemo, ex = w.exaggeration;
        w.go({ lon: at[0], lat: at[1], zoom: 19.5, tilt: 60, bearing: 330 }); await w.settled({ timeout: 60000 });
        const me = av.me; me.at = [at[0], at[1], (deck + 0.25) * ex]; me.velocity = [0, 0, 0];
        for (let i = 0; i < 20; i++) w.step(50);
        await w.settled({ timeout: 60000 });
        const under = people.crowd?.people?.[0]; if (under) { under.drive = null; under.speed = 0; under.at = [at[0], at[1], NaN]; }
        for (let i = 0; i < 4; i++) w.step(50);
        await w.settled({ timeout: 60000 });
        const of = (e, id) => ({ id, lon: e.at[0], lat: e.at[1], h: e.at[2] / ex, ground: w.heightAt(e.at[0], e.at[1]) });
        return [of(me, 'on the deck'), ...(under ? [of(under, 'under it')] : [])];
      }, [FOOTBRIDGE, drawnAt(...FOOTBRIDGE)[0]]);
      // seen from the side (the bridge runs north–south), the eye over the deck, the view's centre on the ground beyond it
      // so the deck's walkers are in the middle; the street's trees and buildings hidden for it (they stand in the way); then the follow camera again
      await page.evaluate(async (at) => { const { w, av, street } = window.aslnutDemo; av.stop?.(); av.stop = null; const was = street.props.when; street.props.when = () => 0; window.feetStreetWhen = was; const D = Math.PI / 180, b = 84 * D, beyond = 6.5 * Math.tan(35 * D); w.go({ lon: at[0] + (Math.sin(b) * beyond) / (111320 * Math.cos(at[1] * D)), lat: at[1] + (Math.cos(b) * beyond) / 110574, dist: 18 / w.camera.frameK, tilt: 35, bearing: 84 }); await w.settled({ timeout: 60000 }); }, FOOTBRIDGE);
      const f4 = await shot(page, 'footbridge', api), mf = fb.map(measure); rows.footbridge = mf;
      await page.evaluate(() => { const { av, street } = window.aslnutDemo; street.props.when = window.feetStreetWhen; av.drive?.(av.mode); });
      console.log(`${api} footbridge: ${f4} · ${mf.map((x) => `${x.id} ${(x.off * 100).toFixed(1)} cm off ${x.surface} (levels ${x.levels.join(', ')}, ground ${x.ground})`).join(' · ')} · errors: ${errors.length ? errors.slice(0, 2).join(' | ') : 'none'}`);
      // 5. Haughton Road by a zebra crossing: the spot (within 15 m of a bar) where the road lies highest over the
      // ground; the person you walk as put down there
      // (the ground sampled with the camera close over each crossing: what the page knows there)
      const near = HAUGHTON.filter((p) => p.zebra < 15), groups = new Map();
      for (const p of near) { const k = `${Math.round(p.lon * 1500)}_${Math.round(p.lat * 1800)}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(p); }
      const sampled = [];
      for (const g of groups.values()) {
        const hs = await page.evaluate(async (spots) => { const { w, av } = window.aslnutDemo; av.stop?.(); av.stop = null; const c = spots[Math.floor(spots.length / 2)]; w.go({ lon: c.lon, lat: c.lat, zoom: 19.5, tilt: 60, bearing: 330 }); await w.settled({ timeout: 60000 }); return spots.map((p) => w.heightAt(p.lon, p.lat)); }, g);
        g.forEach((p, i) => sampled.push({ ...p, gap: (drawnAt(p.lon, p.lat).at(-1) ?? NaN) - hs[i] }));
      }
      const spot = sampled.filter((p) => Number.isFinite(p.gap)).sort((a, b) => b.gap - a.gap)[0];
      if (spot) {
        const hg = await page.evaluate(async (at) => {
          const { w, av } = window.aslnutDemo;
          w.go({ lon: at[0], lat: at[1], zoom: 19.5, tilt: 60, bearing: 330 }); await w.settled({ timeout: 60000 });
          const me = av.me; me.at = [at[0], at[1], NaN]; me.velocity = [0, 0, 0]; av.drive(av.mode);
          for (let i = 0; i < 10; i++) w.step(100); await w.settled({ timeout: 60000 });
          return { id: 'me', lon: me.at[0], lat: me.at[1], h: me.at[2] / w.exaggeration, ground: w.heightAt(me.at[0], me.at[1]) };
        }, [spot.lon, spot.lat]);
        const f5 = await shot(page, 'haughton', api), mh = measure(hg); rows.haughton = { ...mh, spot: { lon: +spot.lon.toFixed(7), lat: +spot.lat.toFixed(7), roadOverGround: +spot.gap.toFixed(3), zebra: +spot.zebra.toFixed(1) } };
        console.log(`${api} haughton: ${f5} · the road ${(spot.gap * 100).toFixed(0)} cm over the ground at ${spot.lon.toFixed(6)}, ${spot.lat.toFixed(6)} (${spot.zebra.toFixed(0)} m from a zebra) · me ${(mh.off * 100).toFixed(1)} cm off the drawn ${mh.surface} (levels ${mh.levels.join(', ')}, ground ${mh.ground})`);
      }
    } catch (e) { console.log(`${api} crowd/walk/footbridge: FAIL ${e.message.slice(0, 400)}`); }
    await page.close();
  }
}
writeFileSync(join(OUT, `${PHASE}${ONLY ? `-${ONLY}` : ''}.json`), JSON.stringify(report, null, 1));
await browser.close(); srv.close();
