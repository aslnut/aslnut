// acrobat: the blinks an acrobatic camera makes, counted and sorted by their cause, on WebGPU AND WebGL2, at a phone's
// size (390 × 844 CSS px, pixel ratio 2, quality auto). The camera flies a script on the world's clock (a fixed 30 a
// second: both graphics get the same frames however long one takes to draw): 8 zoom levels in 2 s, tilt 0 → 80°, a
// whole turn, back, then 5 s held still; a few cycles fast, one slow (4 × longer moves).
//   per scene, graphics and phase (moving · still · per level crossed) it counts, from the lib's own state:
//     data      requests (the loader's loads by kind; a WFS's own count), features added, removed and handed again
//     restyles  a scale's domain re-read (its version), the features' columns written again, features recoloured
//     labels    shown, hidden (the labels drawn, frame to frame)
//     fades     a layer's gate turning, features born (revealed), labels starting to fade in or out
//     blinks    a feature (a shape, a label, a street tile) seen, then gone while on screen, then seen again within 1 s;
//               a colour that changes and comes back within 1 s. Each sorted by its cause at the moment it went:
//               a data replaced · b a scale's domain re-read · c label placement · d a fade restarted · e a zoom gate
//               (when / minZoom) · f a tile or detail level switching · g the camera still (a loop) · h other (named)
//               and checked against the frames (the pixels where the feature is, seen / gone / back)
//   nothing in the lib changes: the probe reads its state each drawn frame and counts calls to a few of its methods
//   (a layer's restyle, build and read; a source's replace; a solids layer's put and drop) without changing them.
//   node tools/acrobat.mjs [--scenes=map,tilt,street,city,fleet] [--graphics=webgpu,webgl2] [--speeds=fast,slow]
//        [--cycles=3] [--live] [--frames=0] [--port=8421] [--out=.out/acrobat]     (run the examples' build first)
//   node tools/acrobat.mjs --handoff --scenes=map --live      a data hand-off in the frames: pan away and back, still
//   node tools/acrobat.mjs --table      the table of every run in the out folder (.out/acrobat/table.md)
//   node tools/acrobat.mjs --hold --scenes=tilt --live --at=13:70,13.5:40 --seconds=6    a still camera at views
//        (zoom:tilt), traced frame by frame: what the suburb names do while nothing moves
// Scenes (no network, the smoke tools' mocks: tools/serve.mjs, tools/ows-mock.mjs; every other host refused):
//   groups  examples/layers ?go=groups (the places counted per suburb: a card each at the city's and the district's
//           levels, the places at the street's; cards decided on the chip, read back each frame: cardFlips)
//   map     examples/layers ?go=map              tilt   examples/layers ?go=tilt
//   street  examples/layers ?go=street&twin=1    city   examples/healthy-city at its first view (the region; the
//   fleet   examples/fleet ?go=charge's view            no-network ground: go=parity-region, the region's own view)
//           (the no-network ground: go=parity-charge, playing from 12:05)
//   journey examples/journey ?go=flight: the page's own camera (a scene with `own`: its shot played, no script of
//           this tool's; its phases the shot's seconds, then still)
//   --live: the layers scenes on the State of Victoria's services (the network), marked live.
import { serve } from './serve.mjs';
import { launch } from './browser.mjs';
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const arg = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const list = (k, d) => (arg[k] ?? d).split(',').filter(Boolean);
const CLOCK = arg.clock === 'real' ? '' : '&clock=30', LIVE = arg.live === '1', PORT = Number(arg.port ?? 8421), FRAMES = arg.frames !== '0', CYCLES = Number(arg.cycles ?? 3);
// (a relative --out is the package's; an absolute one is taken as it is)
const OUT = resolve(import.meta.dirname, '..', arg.out ?? '.out/acrobat');
mkdirSync(OUT, { recursive: true });
const W = 390, H = 844;

/** the scenes: the example, its query, and the view the script starts from (null: the example's own) */
const SCENES = {
  map: { page: 'layers', q: LIVE ? 'go=map' : 'go=map&parity=1', live: true },
  tilt: { page: 'layers', q: LIVE ? 'go=tilt' : 'go=tilt&parity=1', live: true },
  street: { page: 'layers', q: LIVE ? 'go=street&twin=1' : 'go=street&twin=1&parity=1', live: true },
  city: { page: 'healthy-city', q: 'go=parity-region', start: () => ({ lon: 145.0, lat: -37.86, zoom: 9.3, tilt: 25, bearing: 0 }) },
  fleet: { page: 'fleet', q: 'go=parity-charge&play=1&t=725', start: 'charge' },
  groups: { page: 'layers', q: LIVE ? 'go=groups' : 'go=groups&parity=1', live: true },
  // the journey's flight: its own camera (the page's director: up from the city to the globe and down to Bali, the
  // levels crossed both ways), 12 s moving then 5 s still; on the network (--live: the imagery and terrain it flies over)
  journey: { page: 'journey', q: 'go=flight', live: true, own: { shot: 0, seconds: 12, still: 5 } },
};

/** the script: [{ at, view: { zoom, tilt, bearing, turn } }] and its phases (seconds from its start) */
function script(v0, speed, cycles) {
  const k = speed === 'slow' ? 4 : 1, HOLD = 5, keys = [{ at: 0, zoom: v0.zoom, tilt: v0.tilt, bearing: v0.bearing, turn: 0 }], phases = [];
  let t = 0;
  for (let c = 0; c < cycles; c++) {
    const t0 = t;
    t += 1 * k; keys.push({ at: t, zoom: v0.zoom - 4, tilt: 0, bearing: v0.bearing, turn: 0 });
    t += 2 * k; keys.push({ at: t, zoom: v0.zoom + 4, tilt: 0, bearing: v0.bearing, turn: 0 });
    t += 1.5 * k; keys.push({ at: t, zoom: v0.zoom, tilt: 80, bearing: v0.bearing, turn: 0 });
    t += 2 * k; keys.push({ at: t, zoom: v0.zoom, tilt: 80, bearing: v0.bearing, turn: 1 });
    t += 1.5 * k; keys.push({ at: t, zoom: v0.zoom, tilt: v0.tilt, bearing: v0.bearing, turn: 0 });
    phases.push({ cycle: c, kind: 'moving', from: t0, to: t });
    t += HOLD; keys.push({ at: t, zoom: v0.zoom, tilt: v0.tilt, bearing: v0.bearing, turn: 0 });
    phases.push({ cycle: c, kind: 'still', from: t - HOLD, to: t });
  }
  return { keys, phases, duration: t };
}

// ── in the page: the probe ───────────────────────────────────────────────────────────────────────────────────────
/** installed once the world settled: reads the lib's state each drawn frame, counts by phase, finds the blinks */
const PROBE = (cfg) => {
  const { w } = window.aslnutDemo, cam = w.camera, D = Math.PI / 180, FW = 512, WIN = 1.0;
  const A = (window.__acro = { cfg, done: false, t: 0, frames: 0, err: [], counts: {}, blinks: [], trace: [], started: performance.now() });
  const phaseOf = (t) => cfg.phases.find((p) => t >= p.from && t < p.to) ?? null;
  const bucket = (ph) => {
    const k = ph ? `${ph.kind}#${ph.cycle}` : 'after';
    return (A.counts[k] ??= { kind: ph?.kind ?? 'after', cycle: ph?.cycle ?? -1, frames: 0, crossings: 0, req: {}, memoryHits: 0, wfsReq: 0, replaces: 0, added: 0, removed: 0, rehanded: 0, builds: 0, reads: 0, restyles: 0, scaleBumps: 0, recolours: 0, labelsShown: 0, labelsHidden: 0, layerFades: 0, births: 0, labelFades: 0, chunkPuts: 0, chunkDrops: 0, holes: 0, stale: 0, cardFlips: 0, blinks: {}, why: {} });
  };
  let cur = bucket(null);
  const add = (k, n = 1) => { cur[k] += n; };
  // ── the calls counted (the instance's own method wrapped: the same call, a count beside it) ──
  const wrap = (o, name, fn) => { const f = o[name]; if (typeof f !== 'function') return; o[name] = function (...a) { try { fn.apply(this, a); } catch (e) { A.err.push(String(e)); } return f.apply(this, a); }; };
  const isScale = (v) => typeof v === 'function' && typeof v.prepare === 'function' && typeof v.legend === 'function';
  const L = new Map(), sources = new Map();
  // (an encoding layer's signs are not in the world's list: they are counted as the layer draws them)
  const everything = []; for (const l of w.list) { everything.push(l); for (const sg of l.signs ?? []) everything.push(sg); }
  for (const l of everything) {
    const st = { l, feat: Array.isArray(l.entries) && l.featData instanceof Float32Array, text: l.kind === 'label', solids: l.chunks instanceof Map, cards: typeof l.decisions === 'function', flips: null, targetPrev: l.target, gateAt: -1e9, buildAt: -1e9, scaleAt: -1e9, atlasGen: -1, atlasAt: -1e9, resets: 0, drawn: new Map(), fadePrev: new Map(), scales: [], dropped: new Map(), keys: new Set(), last: new Map() };
    L.set(l.id, st);
    if (st.feat) {
      wrap(l, 'restyle', () => { add('restyles'); });
      wrap(l, 'build', () => { add('builds'); st.buildAt = A.t; });
      wrap(l, 'read', () => { add('reads'); });
      const s = l.source;
      if (s && !sources.has(s)) {
        const ss = { s, v: s.version, z: s.z ?? null, zAt: -1e9, at: -1e9, wfs: s.info?.requests ?? null };
        sources.set(s, ss);
        wrap(s, 'replace', function (list) {
          const before = this.byId; let kept = 0, added = 0;
          for (const f of list) { if (before.has(f.id)) kept++; else added++; }
          add('replaces'); add('added', added); add('removed', before.size - kept); add('rehanded', kept); ss.at = A.t;
        });
      }
    }
    if (st.solids) {
      wrap(l, 'put', () => { add('chunkPuts'); });
      wrap(l, 'drop', (key) => { add('chunkDrops'); st.dropped.set(key, A.t); });
    }
  }
  const srcOf = (st) => (st.l.source ? sources.get(st.l.source) : null);
  // ── the loads (the loader's: by kind and where they came from; memory hits apart) ──
  const kindOf = (u) => (/\/wfs/i.test(u) ? 'wfs' : /\/wms/i.test(u) ? 'wms' : /\.ground|clamp\.json/.test(u) ? 'ground' : /\/built\//.test(u) ? 'street tiles' : /\/packs\//.test(u) ? 'packs' : /tile|terrain|\.png|\.jpg|\.webp|\.f32/i.test(u) ? 'tiles' : 'other');
  w.loader.on('load', (e) => { if (e.tier === 'memory') return; const k = `${kindOf(e.url)}:${e.tier}`; cur.req[k] = (cur.req[k] ?? 0) + 1; });
  let mem0 = w.loader.stats().tiers.memory;
  const surface = w.list.find((l) => typeof l.tileStats === 'function');
  let holesPrev = 0;
  // ── where a thing is on the screen ──
  const boxOf = new WeakMap();
  const bbox = (g) => {
    if (!g) return null;
    let b = boxOf.get(g); if (b) return b;
    b = [Infinity, Infinity, -Infinity, -Infinity];
    const walk = (c) => { if (typeof c[0] === 'number') { if (c[0] < b[0]) b[0] = c[0]; if (c[0] > b[2]) b[2] = c[0]; if (c[1] < b[1]) b[1] = c[1]; if (c[1] > b[3]) b[3] = c[1]; } else for (const x of c) walk(x); };
    walk(g.coordinates); boxOf.set(g, b); return b;
  };
  let Wc = cam.width, Hc = cam.height, gy = 0;
  const proj = (lon, lat) => cam.project(lon, lat, gy);
  const inside = (p) => !!p && p[0] >= 0 && p[1] >= 0 && p[0] <= Wc && p[1] <= Hc;
  /** on the screen (where): a corner or the middle of its box projects inside, or the box holds the view's centre */
  const onScreenBox = (b) => {
    if (!b) return null;
    const pm = proj((b[0] + b[2]) / 2, (b[1] + b[3]) / 2);
    if (inside(pm)) return pm;
    for (const [x, y] of [[b[0], b[1]], [b[2], b[1]], [b[0], b[3]], [b[2], b[3]]]) { const p = proj(x, y); if (inside(p)) return p; }
    if (cam.lon >= b[0] && cam.lon <= b[2] && cam.lat >= b[1] && cam.lat <= b[3]) return [Wc / 2, Hc / 2];
    return null;
  };
  // ── the blink machine: per thing (layer:key) seen (≥ .9) → gone (≤ .1) while on screen → seen again within WIN ──
  const vis = new Map(), col = new Map();
  const ring = new Map(); let pend = [];
  let stillSince = 0;
  const still = (t) => !cam.moving && t - stillSince >= 0.5;
  const note = (cls, why) => { cur.blinks[cls] = (cur.blinks[cls] ?? 0) + 1; const wk = `${cls}: ${why}`; cur.why[wk] = (cur.why[wk] ?? 0) + 1; };
  const record = (b) => { if (A.blinks.length < 4000) A.blinks.push(b); if (cfg.frames) pend.push(b); };
  const view = () => ({ zoom: +cam.zoom.toFixed(2), tilt: +(90 - cam.pitch / D).toFixed(1) });
  /** cause(): [class, why] asked at the moment it went */
  const step = (st, key, a, xy, cause, t, n) => {
    let v = vis.get(key);
    if (!v) { v = { st: 'none' }; vis.set(key, v); st.keys.add(key); }
    if (a >= 0.9 && xy) {
      if (v.st === 'off' && t - v.tOff <= WIN) {
        const [cls, why] = v.why; note(cls, why);
        record({ t: +t.toFixed(3), key, cls, why, gap: +(t - v.tOff).toFixed(3), ...view(), xyOn: v.xyOn, xyOff: v.xyOff, xyBack: xy, nOn: v.nOn, nOff: v.nOff, nBack: n, phase: cur.kind, cycle: cur.cycle });
      }
      v.st = 'on'; v.xyOn = xy; v.nOn = n;
    } else if (a <= 0.1) {
      if (v.st === 'on' && xy) { v.st = 'off'; v.tOff = t; v.xyOff = xy; v.nOff = n; let c; try { c = cause(); } catch (e) { c = ['h', `cause unknown (${e.message})`]; } v.why = still(t) ? ['g', `still camera: ${c[1]}`] : c; }
      else if (v.st === 'on') v.st = 'none';
      else if (v.st === 'off' && (!xy || t - v.tOff > WIN)) v.st = 'none';
    }
  };
  /** a colour that changes and comes back within WIN (why: [class, why] of the change) */
  const colour = (key, c, why, t, xy, n) => {
    const v = col.get(key);
    if (!v) { col.set(key, { c, prev: null, at: -1e9, why: null, n: n }); return; }
    if (c === v.c) return;
    add('recolours');
    if (v.prev === c && t - v.at <= WIN && xy) {
      const [cls, w2] = v.why, w3 = still(t) ? ['g', `still camera: colour: ${w2}`] : [cls, `colour: ${w2}`]; note(w3[0], w3[1]);
      record({ t: +t.toFixed(3), key, cls: w3[0], why: w3[1], gap: +(t - v.at).toFixed(3), ...view(), xyOn: xy, xyOff: xy, xyBack: xy, nOn: v.n - 1, nOff: v.n, nBack: n, colour: true, phase: cur.kind, cycle: cur.cycle });
    }
    v.prev = v.c; v.c = c; v.at = t; v.why = why; v.n = n;
  };
  // ── the frames (a ring of the last ones, a quarter of each side) to check each blink against ──
  const keepFrame = (n) => w.frame().then((f) => {
    const k = 4, sw = Math.floor(f.width / k), sh = Math.floor(f.height / k), px = new Uint8Array(sw * sh * 3);
    for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) { const i = ((y * k) * f.width + x * k) * 4, o = (y * sw + x) * 3; px[o] = f.pixels[i]; px[o + 1] = f.pixels[i + 1]; px[o + 2] = f.pixels[i + 2]; }
    ring.set(n, { sw, sh, px, sx: sw / Wc }); for (const m of ring.keys()) if (m < n - 45) ring.delete(m);
    // the blinks whose frames are all in now: the pixels where the thing is, seen / gone / back
    const left = [];
    for (const b of pend) {
      if (b.nBack > n) { left.push(b); continue; }
      // (the 'seen' frame: the last one the lib drew it in, or the one before: a label atlas that starts over inside a
      // frame leaves that frame's earlier pictures blank)
      const fb = ring.get(b.nOff), fc = ring.get(b.nBack), fa0 = ring.get(b.nOn), fa1 = ring.get(b.nOn - 1);
      if (!fa0 || !fb || !fc) { b.frames = 'missing'; continue; }
      // (a block round the place: its mean colour and its contrast, the spread of its brightness: a label's dark letters
      // in a white halo average out near a light ground, its contrast does not)
      const at = (F, xy) => { const r = 3, cx = Math.round(xy[0] * F.sx), cy = Math.round(xy[1] * F.sx), s = [0, 0, 0]; let m = 0, l1 = 0, l2 = 0; for (let y = cy - r; y <= cy + r; y++) for (let x = cx - r; x <= cx + r; x++) { if (x < 0 || y < 0 || x >= F.sw || y >= F.sh) continue; const o = (y * F.sw + x) * 3, L = 0.3 * F.px[o] + 0.59 * F.px[o + 1] + 0.11 * F.px[o + 2]; s[0] += F.px[o]; s[1] += F.px[o + 1]; s[2] += F.px[o + 2]; l1 += L; l2 += L * L; m++; } return m ? [...s.map((v) => v / m), Math.sqrt(Math.max(0, l2 / m - (l1 / m) ** 2))] : null; };
      const q = at(fb, b.xyOff), r = at(fc, b.xyBack), ps = [at(fa0, b.xyOn), fa1 ? at(fa1, b.xyOn) : null].filter(Boolean);
      if (!ps.length || !q || !r) { b.frames = 'off-frame'; continue; }
      const d = (u, v) => Math.max((Math.abs(u[0] - v[0]) + Math.abs(u[1] - v[1]) + Math.abs(u[2] - v[2])) / 3, Math.abs(u[3] - v[3]));
      const p = ps.reduce((a, x) => (d(x, q) > d(a, q) ? x : a)), gone = d(p, q), back = d(p, r);
      b.px = [+gone.toFixed(1), +back.toFixed(1)]; b.frames = gone > 8 && back < gone * 0.6 ? 'seen' : 'not seen';
    }
    pend = left;
  }).catch((e) => { A.err.push(`frame: ${e.message}`); });
  // ── the camera's script: each moving phase played as camera keys (a pose a time: the view's zoom as a distance);
  // the still phases play nothing (the camera truly still) ──
  const k0 = cam.frameK, d0 = cam.dist / k0, z00 = cam.zoom, v0 = { lon: cam.lon, lat: cam.lat };
  const poses = cfg.keys.map((k) => ({ at: k.at, dist: d0 * 2 ** (z00 - k.zoom), pitch: Math.max(10 * D, Math.min(Math.PI / 2 - 1e-4, (90 - k.tilt) * D)), bearing: k.bearing, turn: k.turn }));
  const pose = (t) => {
    let i = 1; while (i < poses.length - 1 && poses[i].at < t) i++;
    const a = poses[i - 1], b = poses[i], u = Math.max(0, Math.min(1, b.at > a.at ? (t - a.at) / (b.at - a.at) : 1));
    return { lon: v0.lon, lat: v0.lat, dist: Math.exp(Math.log(a.dist) + (Math.log(b.dist) - Math.log(a.dist)) * u), bearing: a.bearing + (b.bearing - a.bearing) * u + 360 * b.turn * u, pitch: a.pitch + (b.pitch - a.pitch) * u };
  };
  let played = -1;
  const playPhase = (ph) => { played = ph.cycle; const len = ph.to - ph.from, at = (tc) => pose(ph.from + Math.min(len, tc)); void w.play({ list: [{ at: 0 }, { at: len }], duration: len, pose: at, at }); };
  // ── each drawn frame ──
  let t0 = null, zPrev = cam.zoom;
  const off = w.on('frame', () => {
    try {
      if (t0 === null) return;
      const t = cam.clock - t0, n = ++A.frames; A.t = t;
      const ph = phaseOf(t); cur = bucket(ph); add('frames');
      if (ph && ph.kind === 'moving' && played !== ph.cycle && !cfg.own) playPhase(ph);
      Wc = cam.width; Hc = cam.height; gy = cam.groundY;
      if (cam.moving) stillSince = t;
      const z = cam.zoom; if (Math.floor(z) !== Math.floor(zPrev)) add('crossings', Math.abs(Math.floor(z) - Math.floor(zPrev))); zPrev = z;
      const m = w.loader.stats().tiers.memory; add('memoryHits', m - mem0); mem0 = m;
      if (surface) { const hs = surface.tileStats()?.holes ?? 0; if (hs > holesPrev) add('holes', hs - holesPrev); holesPrev = hs; }
      for (const ss of sources.values()) {
        const s = ss.s;
        if (ss.wfs !== null) { const r = s.info.requests; add('wfsReq', r - ss.wfs); ss.wfs = r; }
        if (s.z !== undefined && s.z !== ss.z) { ss.z = s.z; ss.zAt = t; }
      }
      for (const st of L.values()) {
        const l = st.l;
        // a layer's gate turning (its fade starts)
        if ((l.target > 0) !== (st.targetPrev > 0)) { add('layerFades'); st.gateAt = t; }
        st.targetPrev = l.target;
        const gone = l.shown <= 0 && l.target <= 0, gateWhy = ['e', 'the layer\'s gate turned (a zoom range; on a twin, its observation level)'];
        if (st.feat) {
          // the scales' domains
          let bump = 0;
          try { l.styleProps().filter(isScale).forEach((x, i) => { const v = x.version; if (st.scales[i] !== undefined && v !== st.scales[i]) bump += v - st.scales[i]; st.scales[i] = v; }); } catch { /* none */ }
          if (bump) { add('scaleBumps', bump); st.scaleAt = t; }
          const ss = srcOf(st), es = l.entries, f = l.featData, rows = l.rows, now = w.now;
          // a frame drawn while its shapes are still being built for a newer list (the old shapes, the new features' rows)
          if (!gone && l.building) add('stale');
          const at = (i, k) => ((k * rows + Math.floor(i / FW)) * FW + (i % FW)) * 4;
          for (const e of es) if (e.born === now) add('births');
          const seen = new Set();
          if (st.text) {
            // the labels drawn this frame (the instances written: entry index, alpha)
            const drawn = new Map(), data = l.data, cnt = gone ? 0 : l.count ?? 0, bySlot = l.bySlot ?? es;
            for (let k = 0; k < cnt; k++) { const e = bySlot[data[k * 16 + 14]]; if (e) drawn.set(e.key, data[k * 16 + 12] * Math.min(1, data[k * 16 + 13] || 0)); }
            for (const k of drawn.keys()) if (!st.drawn.has(k)) add('labelsShown');
            for (const k of st.drawn.keys()) if (!drawn.has(k)) add('labelsHidden');
            st.drawn = drawn;
            // a label's fade starting (in from nothing, out from whole)
            const fade = l.fade ?? new Map(), fp = st.fadePrev;
            for (const [k, v] of fade) { const p = fp.get(k) ?? 0; if ((p === 0 && v > 0) || (p === 1 && v < 1)) add('labelFades'); }
            st.fadePrev = new Map(fade);
            const gen = l.atlas?.gen ?? -1; if (gen !== st.atlasGen) { if (st.atlasGen >= 0) { st.atlasAt = t; st.resets++; } st.atlasGen = gen; }
            // (a place: [lon, lat, h, slot], or decided once: { lon, lat, h, i })
            const byIndex = new Map(); for (const p0 of l.places ?? []) { const p = Array.isArray(p0) ? p0 : [p0.lon, p0.lat, p0.h, p0.i]; byIndex.set(p[3], p); }
            for (const e of es) {
              const p = byIndex.get(e.index); if (!p) continue;
              const key = `${l.id}:${e.key}`; seen.add(key); st.last.set(key, p);
              const xy = proj(p[0], p[1]), on = inside(xy) && cam.facing(p[0], p[1]) ? xy : null;
              step(st, key, drawn.get(e.key) ?? 0, on, () => {
                const q = at(e.index, 2), pr = f[q + 2], fw = f[q + 3], fd = fade.get(e.key), fd0 = fp.get(e.key);
                return gone || l.target <= 0 || t - st.gateAt < 1 ? gateWhy : pr <= 0.05 ? ['d', 'its reveal began again'] : fw <= 0.05 ? ['h', 'its own gate']
                  : t - st.atlasAt < 0.2 ? ['h', 'the label atlas started over: its picture dropped']
                  : fd !== undefined && fd0 !== undefined && fd < fd0 ? ['c', 'no room: another label took its place']
                  : fd === undefined ? ['h', 'not a candidate (hidden behind the ground)'] : ['h', 'its picture not drawn yet (12 a frame)'];
              }, t, n);
            }
          } else if (l.built && es.length) {
            // shapes: seen = its reveal (the layer's fade in it) × its own gate; colour = plane 0
            for (const e of es) {
              const key = `${l.id}:${e.key}`, b = bbox(e.geometry); seen.add(key);
              if (b) st.last.set(key, b);
              const xy = onScreenBox(b), q = at(e.index, 2), pr = f[q + 2], fw = f[q + 3], a = gone ? 0 : pr * Math.min(1, fw);
              step(st, key, a, xy, () => (gone || l.target <= 0 || t - st.gateAt < 1 ? gateWhy : pr <= 0.05 ? ['d', 'its reveal began again'] : fw <= 0.05 ? ['h', 'its own gate'] : ['h', 'faint for another reason']), t, n);
              if (!gone && a >= 0.9) { const c = at(e.index, 0); colour(key, `${f[c].toFixed(3)},${f[c + 1].toFixed(3)},${f[c + 2].toFixed(3)}`, t - st.scaleAt < 0.05 ? ['b', 'the scale\'s domain read again'] : ss && t - ss.at < 0.05 ? ['a', 'the data handed again'] : ['h', 'restyled'], t, xy, n); }
            }
          }
          // the things no longer in the data (or the layer not built): gone, where they were
          for (const key of st.keys) {
            if (seen.has(key) || vis.get(key)?.st !== 'on') continue;
            const b = st.last.get(key), xy = st.text ? (b && inside(proj(b[0], b[1])) ? proj(b[0], b[1]) : null) : onScreenBox(b);
            step(st, key, 0, xy, () => (gone || t - st.gateAt < 1 ? gateWhy : ss && t - ss.zAt < 1 ? ['f', 'the source\'s grid level switched'] : ss && t - ss.at < 1 ? ['a', 'the data handed again without it'] : !l.built ? ['a', 'the layer building again'] : ['a', 'left the data']), t, n);
          }
          continue;
        }
        if (st.cards) {
          // cards (kits › dashboard › markers): each one's decision read back from the chip (a frame late: it is drawn),
          // seen as its fade; a flip of its shown counted (cardFlips: none while still)
          const tc = t, nc = n, ph0 = phaseOf(t);
          l.decisions().then((d) => {
            if (!d) return;
            const was = cur; cur = bucket(ph0);
            try {
              const ids = l.ids, prev = st.flips;
              for (let i = 0; i < ids.length; i++) {
                const key = `${l.id}:${ids[i]}`, p = l.cardPlace(i), xy = p ? proj(p[0], p[1]) : null, on = inside(xy) && cam.facing(p[0], p[1]) ? xy : null;
                if (prev && prev[2 * i] !== d[2 * i] && !gone) add('cardFlips');
                step(st, key, gone ? 0 : d[2 * i + 1] * Math.min(1, l.shown), on, () => (gone || l.target <= 0 || tc - st.gateAt < 1 ? gateWhy : ['c', 'no room: another card took its place']), tc, nc);
              }
              st.flips = d;
            } finally { cur = was; }
          }).catch((e) => A.err.push(`cards: ${e.message}`));
          continue;
        }
        if (st.solids) {
          // street tiles (and other chunks): seen as their fade in; gone when let go
          const fade = (l.props.fade ?? 0.25) * 1000, seen = new Set(), KZ = 110574;
          for (const c of l.chunks.values()) {
            if (c.spec?.free) continue;
            const key = `${l.id}:${c.key}`, side = Math.min(500, c.spec.side ?? 500), kx = 111320 * Math.cos(c.spec.origin[1] * D), b = [c.corner[0], c.corner[1] - side / KZ, c.corner[0] + side / kx, c.corner[1]];
            seen.add(key); st.last.set(key, b);
            const a = gone ? 0 : Math.min(1, Math.max(0, (w.now - c.born) / Math.max(1, fade))) * Math.min(1, l.shown);
            step(st, key, a, onScreenBox(b), () => (gone || t - st.gateAt < 1 ? gateWhy : ['d', 'its fade began again']), t, n);
          }
          for (const key of st.keys) {
            if (seen.has(key) || vis.get(key)?.st !== 'on') continue;
            const dropped = st.dropped.get(key.slice(l.id.length + 1));
            step(st, key, 0, onScreenBox(st.last.get(key)), () => (gone || t - st.gateAt < 1 ? gateWhy : dropped !== undefined && t - dropped < 1 ? ['f', 'street tile let go (the camera far)'] : ['a', 'chunk taken away']), t, n);
          }
        }
      }
      if (cfg.trace && A.trace.length < 3000) {
        const nm = (L.get('names') ?? L.get('suburbs-labels'))?.l;
        if (nm) A.trace.push({ n, t: +t.toFixed(3), ...view(), moving: cam.moving, held: nm.atlas?.map?.size ?? 0, candidates: (nm.places ?? []).map((p0) => (Array.isArray(p0) ? p0 : [p0.lon, p0.lat, p0.h, p0.i])).filter((p) => { const q = (nm.bySlot ?? nm.entries)[p[3]] && cam.project(p[0], p[1], gy); return q && q[0] >= -200 && q[1] >= -100 && q[0] <= Wc + 200 && q[1] <= Hc + 100 && cam.facing(p[0], p[1]); }).length, entries: nm.entries.length, places: nm.places?.length ?? 0, drawn: nm.count ?? 0, gen: nm.atlas?.gen ?? -1, top: nm.atlas?.top ?? 0, picsNew: nm.picsNew ?? 0, fading: [...(nm.fade?.values() ?? [])].filter((v) => v > 0 && v < 1).length, faded: [...(nm.fade?.values() ?? [])].filter((v) => v >= 1).length, src: nm.source?.version ?? -1, shown: +nm.shown.toFixed(3) });
      }
      if (cfg.frames) keepFrame(n);
      if (t >= cfg.duration) { off(); A.done = true; A.realMs = performance.now() - A.started; A.resets = Object.fromEntries([...L.values()].filter((s) => s.text).map((s) => [s.l.id, s.resets])); }
    } catch (e) { A.err.push(String(e.stack ?? e).slice(0, 400)); }
  });
  // (a scene with its own camera: its shot started now, without its loading hold: the probe's time is the shot's)
  if (cfg.own) window.aslnutDemo.startShot(cfg.own.shot ?? 0, 0, false);
  t0 = cam.clock;
  const first = cfg.phases[0]; if (first?.kind === 'moving' && !cfg.own) playPhase(first);
  w.invalidate();
  return { frameK: k0, zoom: z00 };
};

// ── in Node ──────────────────────────────────────────────────────────────────────────────────────────────────────
const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));
const srv = arg.table ? null : await serve(PORT), browser = arg.table ? null : await launch();
if (!arg.table) console.log(`acrobat · ${LIVE ? 'LIVE services (network)' : 'mocks (no network)'} · ${W}×${H} CSS px, pixel ratio 2, quality auto, clock 30 a second`);
const runs = [];
async function run(name, api, speed) {
  const sc = SCENES[name], live = LIVE && sc.live;
  const url = `http://127.0.0.1:${PORT}/examples/${sc.page}/?${sc.q}&graphics=${api}&dpr=2${CLOCK}&log=0`;
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  const errors = [], refused = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  // no network for the mocks: every host but this one refused (and counted)
  if (!live) await page.route((u) => !u.href.startsWith(`http://127.0.0.1:${PORT}/`), (r) => { refused.push(r.request().url()); return r.abort(); });
  const t0 = Date.now();
  try {
    await page.goto(url);
    await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 120000 });
    const start = await page.evaluate(async (s) => {
      const d = window.aslnutDemo, w = d.w;
      await w.settled({ timeout: 180000 }).catch(() => {});
      const v = s === 'charge' ? d.views.charge : s;
      if (v) { w.go(v); await w.settled({ timeout: 180000 }).catch(() => {}); }
      const c = w.camera; return { lon: c.lon, lat: c.lat, zoom: c.zoom, tilt: 90 - (c.pitch * 180) / Math.PI, bearing: ((-c.yaw * 180) / Math.PI + 360) % 360, api: w.api };
    }, typeof sc.start === 'function' ? sc.start() : sc.start ?? null);
    // (its own camera: wait for its first shot's loading hold, then its phases are the shot's)
    if (sc.own) await page.waitForFunction(() => !window.aslnutDemo.holding, null, { timeout: 180000 });
    const scr = sc.own ? { keys: [{ at: 0, zoom: start.zoom, tilt: start.tilt, bearing: start.bearing, turn: 0 }, { at: sc.own.seconds + sc.own.still, zoom: start.zoom, tilt: start.tilt, bearing: start.bearing, turn: 0 }], phases: [{ cycle: 0, kind: 'moving', from: 0, to: sc.own.seconds }, { cycle: 0, kind: 'still', from: sc.own.seconds, to: sc.own.seconds + sc.own.still }], duration: sc.own.seconds + sc.own.still } : script(start, speed, speed === 'slow' ? 1 : CYCLES);
    console.log(`  ${name} ${api} ${speed}${live ? ' LIVE' : ''}: from zoom ${start.zoom.toFixed(2)} tilt ${start.tilt.toFixed(0)} · ${scr.duration} s on the world's clock · ready in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    await page.evaluate(PROBE, { phases: scr.phases, keys: scr.keys, duration: scr.duration, frames: FRAMES, trace: !!arg.trace, own: sc.own ?? null });
    // (a slow graphics, SwiftShader's WebGPU drawing a twin, takes seconds a frame: only no frame for two minutes fails)
    let last = -1, lastAt = Date.now(), said = Date.now();
    for (;;) {
      await sleep(3000);
      const p = await page.evaluate(() => ({ done: window.__acro.done, t: window.__acro.t, frames: window.__acro.frames }));
      if (p.done) break;
      if (p.frames !== last) { last = p.frames; lastAt = Date.now(); }
      else if (Date.now() - lastAt > 120000) throw new Error(`no frame drawn for 2 minutes (at ${p.frames} frames, ${p.t.toFixed(1)} s)`);
      if (Date.now() - said > 300000) { said = Date.now(); console.log(`    … ${p.frames} frames, ${p.t.toFixed(1)} of ${scr.duration} s, ${((Date.now() - t0) / 60000).toFixed(0)} min`); }
    }
    await sleep(1500);
    const r = await page.evaluate(() => { const A = window.__acro; return { counts: A.counts, blinks: A.blinks, err: A.err.slice(0, 5), frames: A.frames, realMs: A.realMs, trace: A.trace, resets: A.resets, api: window.aslnutDemo.w.api, telemetry: { quality: window.aslnutDemo.w.telemetry().quality, dropped: window.aslnutDemo.w.telemetry().dropped } }; });
    const res = { scene: name, api, speed, live, start, script: scr, ...r, errors: errors.slice(0, 5), refused: refused.length, refusedHosts: [...new Set(refused.map((u) => new URL(u).host))] };
    writeFileSync(join(OUT, `${name}-${api}-${speed}${live ? '-live' : ''}.json`), JSON.stringify(res));
    runs.push(res);
    console.log(`    ${r.frames} frames in ${(r.realMs / 1000).toFixed(0)} s · atlas restarts ${JSON.stringify(r.resets ?? {})} · ${summary(res)}${r.err.length ? ` · probe errors: ${r.err[0]}` : ''}${errors.length ? ` · page errors: ${errors[0].slice(0, 120)}` : ''}${refused.length ? ` · refused ${refused.length} (${res.refusedHosts.join(', ')})` : ''}`);
  } catch (e) { console.log(`  FAIL ${name} ${api} ${speed}: ${e.message.split('\n')[0]}`); }
  await page.close();
}
/** the counts of a run's phases of one kind, summed over its cycles */
function sum(res, kind) {
  const out = { stale: 0, frames: 0, crossings: 0, req: 0, reqKinds: {}, memoryHits: 0, wfsReq: 0, replaces: 0, added: 0, removed: 0, rehanded: 0, builds: 0, reads: 0, restyles: 0, scaleBumps: 0, recolours: 0, labelsShown: 0, labelsHidden: 0, layerFades: 0, births: 0, labelFades: 0, chunkPuts: 0, chunkDrops: 0, holes: 0, cardFlips: 0, blinks: {}, why: {}, seen: {}, checked: {} };
  for (const c of Object.values(res.counts)) {
    if (c.kind !== kind) continue;
    for (const k of Object.keys(out)) if (typeof out[k] === 'number' && typeof c[k] === 'number') out[k] += c[k];
    for (const [k, v] of Object.entries(c.req)) { out.req += v; out.reqKinds[k] = (out.reqKinds[k] ?? 0) + v; }
    for (const [k, v] of Object.entries(c.blinks)) out.blinks[k] = (out.blinks[k] ?? 0) + v;
    for (const [k, v] of Object.entries(c.why)) out.why[k] = (out.why[k] ?? 0) + v;
  }
  for (const b of res.blinks) if (b.phase === kind && b.frames) { out.checked[b.cls] = (out.checked[b.cls] ?? 0) + 1; if (b.frames === 'seen') out.seen[b.cls] = (out.seen[b.cls] ?? 0) + 1; }
  return out;
}
const CLS = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'];
function summary(res) { const m = sum(res, 'moving'), s = sum(res, 'still'); const b = (x) => CLS.map((k) => x.blinks[k] ?? 0).join('/'); return `moving: req ${m.req} · replaces ${m.replaces} · restyles ${m.restyles} · card flips ${m.cardFlips} · blinks ${b(m)} | still: req ${s.req} · replaces ${s.replaces} · restyles ${s.restyles} · labels +${s.labelsShown}/-${s.labelsHidden} · fades ${s.layerFades}/${s.births}/${s.labelFades} · card flips ${s.cardFlips} · blinks ${b(s)}`; }

// ── a still camera at given views, traced (the endless suburb-name blink) ──
async function hold(name, api) {
  const sc = SCENES[name], live = LIVE && sc.live;
  const url = `http://127.0.0.1:${PORT}/examples/${sc.page}/?${sc.q}&graphics=${api}&dpr=2${CLOCK}&log=0`;
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  if (!live) await page.route((u) => !u.href.startsWith(`http://127.0.0.1:${PORT}/`), (r) => r.abort());
  await page.goto(url);
  await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 120000 });
  const out = [];
  for (const zt of list('at', '13:60')) {
    const [zoom, tilt] = zt.split(':').map(Number), secs = Number(arg.seconds ?? 6);
    const r = await page.evaluate(async ({ zoom, tilt, secs, PROBE_SRC, REAL }) => {
      const { w } = window.aslnutDemo, c = w.camera;
      w.go({ lon: c.lon, lat: c.lat, zoom, tilt, bearing: ((-c.yaw * 180) / Math.PI + 360) % 360 });
      await w.settled({ timeout: 60000 }).catch(() => {});
      await new Promise((ok) => setTimeout(ok, 500));
      // eslint-disable-next-line no-new-func
      const probe = new Function(`return (${PROBE_SRC})`)();
      w.drawnWhy();
      probe({ phases: [{ cycle: 0, kind: 'still', from: 0, to: secs }], keys: [{ at: 0, zoom, tilt, bearing: ((-c.yaw * 180) / Math.PI + 360) % 360, turn: 0 }, { at: secs, zoom, tilt, bearing: ((-c.yaw * 180) / Math.PI + 360) % 360, turn: 0 }], duration: secs, frames: false, trace: true });
      // (a real clock may rest: no frame drawn, the world's clock still: the hold ends by the wall clock too)
      const end = performance.now() + (REAL ? secs * 1000 + 1500 : 30 * 60000);
      while (!window.__acro.done && performance.now() < end) await new Promise((ok) => setTimeout(ok, 250));
      const A = window.__acro, nm = (w.element ?? w.layer).call(w, w.list.some((l) => l.id === 'names') ? 'names' : 'suburbs-labels'), why = w.drawnWhy();
      return { zoom, tilt, why, realMs: performance.now() - A.started, frames: A.frames, counts: A.counts, blinks: A.blinks.slice(0, 50), trace: A.trace, names: { entries: nm.entries.length, places: nm.places?.length, atlas: nm.atlas ? { gen: nm.atlas.gen, top: nm.atlas.top, shelves: nm.atlas.shelves.length, size: nm.atlas.size } : null }, err: A.err.slice(0, 3) };
    }, { zoom, tilt, secs, PROBE_SRC: PROBE.toString(), REAL: !CLOCK });
    const c = Object.values(r.counts).find((x) => x.kind === 'still') ?? {};
    console.log(`  hold ${name} ${api} zoom ${zoom} tilt ${tilt}: ${r.frames} frames in ${(r.realMs / 1000).toFixed(1)} s (drawn for ${JSON.stringify(r.why)}) · names ${r.names.entries} (places ${r.names.places}) · atlas ${JSON.stringify(r.names.atlas)} · labels +${c.labelsShown ?? 0}/-${c.labelsHidden ?? 0} · blinks ${JSON.stringify(c.blinks ?? {})} · ${JSON.stringify(c.why ?? {})}${r.err.length ? ` · ${r.err[0]}` : ''}`);
    out.push(r);
  }
  writeFileSync(join(OUT, `hold-${name}-${api}${live ? '-live' : ''}${CLOCK ? '' : '-realclock'}.json`), JSON.stringify(out));
  await page.close();
}

/** a data hand-off seen in the frames: at a still view the camera pans away (other WFS tiles) and straight back; each
 *  frame after the return is compared with the settled frame of the same pose taken before (pixels off by more than
 *  30). The suburbs alone (the layers scenes' &only=suburbs). Frames far off right after the return: shapes built for
 *  the list before, drawn with the new list's rows (a); off for good once settled: the same view in other colours (b) */
async function handoff(name, api) {
  const sc = SCENES[name], live = LIVE && sc.live;
  const page = await browser.newPage({ viewport: { width: W, height: H } });
  if (!live) await page.route((u) => !u.href.startsWith(`http://127.0.0.1:${PORT}/`), (r) => r.abort());
  await page.goto(`http://127.0.0.1:${PORT}/examples/${sc.page}/?${sc.q}&graphics=${api}&dpr=2&clock=30&log=0&only=suburbs`);
  await page.waitForFunction(() => window.aslnutDemo?.w, null, { timeout: 120000 });
  const r = await page.evaluate(async (pans) => {
    const { w } = window.aslnutDemo, c = w.camera, v = { lon: c.lon, lat: c.lat, zoom: 13.2, tilt: 25, bearing: 0 }, l0 = (w.element ?? w.layer).call(w, 'suburbs'), l = l0.signs?.[0] ?? l0;
    w.go(v); await w.settled({ timeout: 120000 }).catch(() => {});
    const grab = async () => (await w.frame()).pixels.slice();
    const diff = (a, b) => { let n = 0; for (let i = 0; i < a.length; i += 4) if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 30) n++; return n; };
    let ref = await grab(); const out = [];
    for (const dx of pans) {
      w.go({ ...v, lon: v.lon + dx }); await grab(); await grab();
      w.go(v);
      const seq = []; for (let k = 0; k < 6; k++) seq.push(diff(await grab(), ref));
      await w.settled({ timeout: 60000 }).catch(() => {});
      const fin = await grab(), kept = diff(fin, ref);
      out.push({ dx, seq, kept, n: l.entries.length });
      ref = fin;
    }
    return { out, px: ref.length / 4 };
  }, [0.02, -0.02, 0.04, -0.04, 0.03, -0.03, 0.05, -0.05, 0.015, -0.015]);
  for (const o of r.out) console.log(`  ${name} ${api}: pan ${o.dx}° and back (${o.n} suburbs): frames after the return off the picture before: ${o.seq.join(' ')} · settled: ${o.kept} of ${r.px} off`);
  const a = r.out.filter((o) => o.seq.some((x) => x > Math.max(o.kept, 0) + r.px * 0.05)).length, b = r.out.filter((o) => o.kept > r.px * 0.01).length;
  console.log(`  ${name} ${api}${live ? ' LIVE' : ''}: ${a} of ${r.out.length} hand-offs drew a frame with over 5 % of the pixels off (a) · ${b} left the same view in other colours (b)`);
  writeFileSync(join(OUT, `handoff-${name}-${api}${live ? '-live' : ''}.json`), JSON.stringify(r));
  await page.close();
}
/** the table of every run in the out folder: scene × graphics × speed × phase, the blink classes */
function table(runs) {
  const rows = [];
  const order = (r) => `${r.live ? 1 : 0}${['map', 'tilt', 'street', 'city', 'fleet', 'groups'].indexOf(r.scene)}${r.speed === 'fast' ? 0 : 1}${r.api}`;
  for (const r of [...runs].sort((a, b) => (order(a) < order(b) ? -1 : 1))) for (const kind of ['moving', 'still']) {
    const s = sum(r, kind), per = kind === 'moving' && s.crossings ? (x) => +(x / s.crossings).toFixed(1) : () => null;
    rows.push({ scene: `${r.scene}${r.live ? ' LIVE' : ''}`, api: r.api, speed: r.speed, phase: kind, frames: s.frames, crossings: s.crossings, req: s.req, reqKinds: s.reqKinds, memoryHits: s.memoryHits, wfsReq: s.wfsReq, replaces: s.replaces, added: s.added, removed: s.removed, rehanded: s.rehanded, builds: s.builds, restyles: s.restyles, scaleBumps: s.scaleBumps, recolours: s.recolours, cardFlips: s.cardFlips, labelsShown: s.labelsShown, labelsHidden: s.labelsHidden, layerFades: s.layerFades, births: s.births, labelFades: s.labelFades, chunkPuts: s.chunkPuts, chunkDrops: s.chunkDrops, holes: s.holes, stale: s.stale, blinks: s.blinks, seen: s.seen, checked: s.checked, why: s.why, resets: r.resets, perCrossing: { req: per(s.req), replaces: per(s.replaces), restyles: per(s.restyles), blinks: per(CLS.reduce((n, k) => n + (s.blinks[k] ?? 0), 0)) } });
  }
  writeFileSync(join(OUT, 'table.json'), JSON.stringify(rows, null, 1));
  const md = ['| scene | graphics | speed | phase | frames | levels crossed | requests (WFS) | replaced (+added −removed) | shape builds · restyles · scale bumps · recoloured | labels +shown −hidden | fades: layer · feature · label | street tiles +put −dropped | ground holes | frames drawn mid-rebuild (a) | a | b | c | d | e | f | g | h | seen in frames |', '|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|'];
  for (const x of rows) md.push(`| ${x.scene} | ${x.api} | ${x.speed} | ${x.phase} | ${x.frames} | ${x.crossings} | ${x.req} (${x.wfsReq}) | ${x.replaces} (+${x.added} −${x.removed}) | ${x.builds} · ${x.restyles} · ${x.scaleBumps} · ${x.recolours} | +${x.labelsShown} −${x.labelsHidden} | ${x.layerFades} · ${x.births} · ${x.labelFades} | +${x.chunkPuts} −${x.chunkDrops} | ${x.holes} | ${x.stale} | ${CLS.map((k) => x.blinks[k] ?? 0).join(' | ')} | ${Object.values(x.seen).reduce((a, b) => a + b, 0)}/${Object.values(x.checked).reduce((a, b) => a + b, 0)} |`);
  writeFileSync(join(OUT, 'table.md'), md.join('\n') + '\n');
  return md.join('\n');
}
if (arg.table) {
  const runs = readdirSync(OUT).filter((f) => /^(map|tilt|street|city|fleet|groups)-(webgpu|webgl2)-(fast|slow)(-live)?\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(OUT, f), 'utf8')));
  console.log(table(runs));
} else if (arg.handoff) { for (const name of list('scenes', 'map')) for (const api of list('graphics', 'webgpu,webgl2')) await handoff(name, api); }
else if (arg.hold) { for (const name of list('scenes', 'tilt')) for (const api of list('graphics', 'webgl2')) await hold(name, api); }
else {
  for (const speed of list('speeds', 'fast')) for (const name of list('scenes', LIVE ? 'map,tilt,street' : 'map,tilt,street,city,fleet')) for (const api of list('graphics', 'webgpu,webgl2')) {
    if (LIVE && !SCENES[name].live) continue;
    await run(name, api, speed);
  }
  console.log(table(runs));
}
if (browser) await browser.close();
srv?.close();
