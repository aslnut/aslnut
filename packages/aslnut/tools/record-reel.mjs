// record-reel: an example's reel recorded frame by frame by the library's recorder (w.record, through the page's
// aslnutDemo.next(): the world's clock one step a frame, each frame held at its moment until it is complete, the way
// ahead loaded; providers that allow no prefetching waited for), with the page's own captions and credits on it (the
// page captured after each frame). `--twice`: recorded again, frame for frame the same (each frame's pixels hashed, the
// world's and the page's). A reel can be recorded a shot at a time (`--at` its second in the reel, `--frames` its
// length: one short run each on a shared machine), then joined: an MP4 of the whole and, per shot, a GIF and a still.
//   node tools/record-reel.mjs [--page=journey] [--go=reel] [--size=960x540] [--graphics=webgl2] [--fps=30]
//        [--at=seconds] [--frames=N] [--tag=name] [--twice] [--keep] [--port=8542]   → frames in .out/record/<tag>/
//   node tools/record-reel.mjs --join=tagA,tagB,… --out=/path/to/media [--page=journey]   (no browser)
//   node tools/record-reel.mjs --compare=tagA,tagB      two recordings of the same frame for frame (no browser)
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const arg = Object.fromEntries(process.argv.slice(2).map((a) => { const m = /^--([^=]+)(?:=(.*))?$/.exec(a); return m ? [m[1], m[2] ?? '1'] : [a, '1']; }));
const PAGE = arg.page ?? 'journey', GO = arg.go ?? 'reel', API = arg.graphics ?? 'webgl2', FPS = Number(arg.fps ?? 30), PORT = Number(arg.port ?? process.env.PORT ?? 8542);
const [W, H] = (arg.size ?? '960x540').split('x').map(Number), LIMIT = arg.frames ? Number(arg.frames) : Infinity, AT = Number(arg.at ?? 0);
const OUT = join(import.meta.dirname, '..', '.out', 'record'), TAG = arg.tag ?? `${PAGE}-${GO}-${API}${AT ? `-at${AT}` : ''}`;
mkdirSync(OUT, { recursive: true });

if (arg.compare) {
  const [x, y] = arg.compare.split(',').map((t) => JSON.parse(readFileSync(join(OUT, `${t}.json`), 'utf8')));
  const n = Math.min(x.hashes.length, y.hashes.length), differ = [];
  for (let i = 0; i < n; i++) if (x.hashes[i] !== y.hashes[i]) differ.push(i);
  console.log(`${arg.compare}: ${x.hashes.length} and ${y.hashes.length} frames · the world's pixels differ in ${differ.length}${differ.length ? ` (first ${differ.slice(0, 8).join(', ')})` : ''}`);
  process.exit(differ.length || x.hashes.length !== y.hashes.length ? 1 : 0);
}
if (arg.join) {
  // ── the media from recorded parts: their frames one after another, the shots as they played ──
  const MEDIA = arg.out; if (!MEDIA) throw new Error('--join needs --out');
  const parts = arg.join.split(','), all = join(OUT, `${PAGE}-joined`); rmSync(all, { recursive: true, force: true }); mkdirSync(all, { recursive: true });
  const shots = [], twice = []; let n = 0;
  for (const p of parts) {
    const meta = JSON.parse(readFileSync(join(OUT, `${p}.json`), 'utf8')), dir = join(OUT, p), n0 = n;
    for (const s of meta.shots) shots.push({ name: s.name, from: +(n0 / FPS + s.from).toFixed(3), to: +(n0 / FPS + s.to).toFixed(3) });
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.png')).sort()) copyFileSync(join(dir, f), join(all, `f${String(n++).padStart(5, '0')}.png`));
    if (meta.twice) twice.push({ part: p, ...meta.twice });
  }
  mkdirSync(MEDIA, { recursive: true });
  const ff = (...x) => execFileSync('ffmpeg', ['-y', '-loglevel', 'error', ...x], { stdio: 'inherit' });
  const reel = join(MEDIA, `${PAGE}-reel.mp4`);
  ff('-framerate', String(FPS), '-i', join(all, 'f%05d.png'), '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-preset', 'slow', reel);
  const gifs = [];
  for (const s of shots) {
    const name = `${PAGE}-${s.name}`, dur = s.to - s.from, fps = dur <= 7 ? 8 : 10;
    ff('-ss', s.from.toFixed(3), '-t', dur.toFixed(3), '-i', reel, '-vf', `fps=${fps},scale=800:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:diff_mode=rectangle`, join(MEDIA, `${name}.gif`));
    const mid = Math.min(n - 1, Math.round(((s.from + s.to) / 2) * FPS));
    ff('-i', join(all, `f${String(mid).padStart(5, '0')}.png`), join(MEDIA, `${name}.png`));
    gifs.push({ name: s.name, from: s.from, to: s.to, used: `${fps} fps, 800 wide, 64 colours, its own palette` });
  }
  writeFileSync(join(MEDIA, 'gifs.json'), JSON.stringify(gifs, null, 1));
  writeFileSync(join(MEDIA, 'shots.json'), JSON.stringify({ size: `${W}x${H}`, graphics: API, frames: n, duration: n / FPS, shots, recorder: 'w.record (aslnut), a shot a run', twice }, null, 1));
  rmSync(all, { recursive: true, force: true });
  console.log(`media: ${reel} (${n} frames) · ${gifs.length} GIFs and stills in ${MEDIA}`);
  process.exit(0);
}

const { serve } = await import('./serve.mjs'), { launch } = await import('./browser.mjs');
const srv = await serve(PORT), browser = await launch();
/** one recording: its frames' hashes (the world's pixels, the page's), the shots and when each played */
async function record(run) {
  const dir = join(OUT, run); rmSync(dir, { recursive: true, force: true }); mkdirSync(dir, { recursive: true });
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  const errors = []; page.on('pageerror', (e) => errors.push(e.message)); page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  const t0 = Date.now();
  await page.goto(`http://127.0.0.1:${PORT}/examples/${PAGE}/?go=${GO}&graphics=${API}&clock=${FPS}&dpr=1&log=0&record=1${AT ? `&at=${AT}` : ''}`);
  await page.waitForFunction(() => window.aslnutDemo?.w && !window.aslnutDemo.holding, null, { timeout: 300000 });
  const api = await page.evaluate(() => window.aslnutDemo.w.graphicsApi);
  if (api !== API) throw new Error(`asked ${API}, got ${api}`);
  const hashes = [], shots = [], ms = { world: 0, page: 0, waited: 0 };
  for (let i = 0; i < LIMIT; i++) {
    const a = Date.now();
    const f = await page.evaluate(async () => {
      const r = await window.aslnutDemo.next(); if (!r) return null;
      const h = new Uint8Array(await crypto.subtle.digest('SHA-256', r.pixels));
      return { hash: [...h.slice(0, 12)].map((x) => x.toString(16).padStart(2, '0')).join(''), shot: r.shot, settled: r.settled, pending: r.pending.slice(0, 2), waited: r.waitedMs };
    });
    if (!f) break;
    const b = Date.now();
    // (the page as it shows the frame: its captions and its credits over the picture)
    const png = await page.screenshot({ type: 'png' });
    writeFileSync(join(dir, `f${String(i).padStart(5, '0')}.png`), png);
    ms.world += b - a; ms.page += Date.now() - b; ms.waited += f.waited;
    hashes.push({ world: f.hash, page: createHash('sha256').update(png).digest('hex').slice(0, 24), settled: f.settled, pending: f.pending });
    const last = shots.at(-1); if (!last || last.name !== f.shot) shots.push({ name: f.shot, from: i / FPS, to: (i + 1) / FPS }); else last.to = (i + 1) / FPS;
    if (i % 60 === 0) console.log(`${run} · frame ${i} · ${f.shot} · ${f.settled ? 'complete' : `not complete: ${f.pending.join('; ')}`} · waited ${f.waited} ms`);
  }
  await page.close();
  const n = hashes.length, unsettled = hashes.filter((h) => !h.settled).length;
  console.log(`${run}: ${n} frames in ${Math.round((Date.now() - t0) / 1000)} s · ${unsettled} taken not complete · a frame: ${Math.round(ms.world / Math.max(1, n))} ms the recorder's (of it ${Math.round(ms.waited / Math.max(1, n))} ms waiting to be complete), ${Math.round(ms.page / Math.max(1, n))} ms the page's capture · errors ${errors.length}${errors.length ? `: ${errors.slice(0, 2).join(' | ')}` : ''}`);
  return { dir, hashes, shots, errors, unsettled };
}
const a = await record(TAG);
const report = { page: PAGE, go: GO, graphics: API, size: `${W}x${H}`, fps: FPS, at: AT, frames: a.hashes.length, shots: a.shots, unsettled: a.unsettled, errors: a.errors.slice(0, 5) };
if (arg.twice === '1') {
  const b = await record(`${TAG}-again`), n = Math.min(a.hashes.length, b.hashes.length), world = [], pageDiff = [];
  for (let i = 0; i < n; i++) { if (a.hashes[i].world !== b.hashes[i].world) world.push(i); if (a.hashes[i].page !== b.hashes[i].page) pageDiff.push(i); }
  report.twice = { frames: [a.hashes.length, b.hashes.length], worldDiffer: world.length, pageDiffer: pageDiff.length, firstWorld: world.slice(0, 10), firstPage: pageDiff.slice(0, 10) };
  console.log(`twice: ${a.hashes.length} and ${b.hashes.length} frames · the world's pixels differ in ${world.length} · the page's in ${pageDiff.length}${world.length ? ` (first ${world.slice(0, 6).join(', ')})` : ''}`);
  if (!arg.keep) rmSync(b.dir, { recursive: true, force: true });
}
writeFileSync(join(OUT, `${TAG}.json`), JSON.stringify({ ...report, hashes: a.hashes.map((h) => h.world) }, null, 1));
await browser.close(); srv.close();
