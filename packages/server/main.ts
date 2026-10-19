// aslnut server: serve or bake map and twin tiles. The reference host for aslnut's formats: any host (Zebflow, a
// static CDN for the archives, your own server) can take the same role. Node 24 runs it as is:
//   node packages/server/main.ts              (PORT, default 8091; ASLNUT_DATA: the data folder, default <repo>/data)
//   GET  /serve/                                  what is here
//   GET  /serve/tiles/<set>/meta.json             bounds, zooms, version, the archive
//   GET  /serve/tiles/<set>/<z>/<x>/<y>.mesh      one mesh tile: from the cache, the archive, or baked now
//   GET  /serve/tiles/<set>.pmtiles               the prebuilt archive (byte ranges: read directly by a browser / CDN)
//   POST /serve/tiles/<set>/bake?min=0&max=6      bake a pyramid into a new archive (a job)
//   POST /serve/tiles/<set>/edit                  { layer, gid | name, props?, rings? }: change a feature, rebake its tiles
//   GET  /serve/jobs · /serve/events (server-sent: edits, jobs)
// Your own routes: ASLNUT_SERVER_ROUTES=a.ts,b.ts (paths from the working directory). Each module's default export
// (or `route`) is `(req, res, path, send, cors) => Promise<boolean>`, asked first with the path after /serve; true: it
// answered.
import { createReadStream, statSync } from 'node:fs';
import { createServer, type ServerResponse } from 'node:http';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { apply, DEFS, set } from './sets.ts';
import { archiveFile, bakeArchive, info, serve, tilesIn } from './tiles.ts';

const PORT = Number(process.env.PORT ?? 8091);
type Send = (res: ServerResponse, code: number, body: unknown) => void;
type Route = (req: import('node:http').IncomingMessage, res: ServerResponse, path: string, send: Send, cors: Record<string, string>) => Promise<boolean>;
const routes: Route[] = [];
for (const file of (process.env.ASLNUT_SERVER_ROUTES ?? '').split(',').map((f) => f.trim()).filter(Boolean)) {
  const m = await import(pathToFileURL(resolve(file)).href) as { default?: Route; route?: Route };
  const r = m.default ?? m.route;
  if (typeof r !== 'function') throw new Error(`ASLNUT_SERVER_ROUTES: ${file} exports no route (a default export or \`route\`)`);
  routes.push(r);
}
const listeners = new Set<ServerResponse>();
const emit = (ev: string, data: unknown) => { for (const r of listeners) r.write(`event: ${ev}\ndata: ${JSON.stringify(data)}\n\n`); };
interface Job { id: number; set: string; min: number; max: number; state: 'running' | 'done' | 'failed'; done: number; total: number; result?: unknown; error?: string; started: string }
const jobs: Job[] = [];

const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Range', 'Access-Control-Expose-Headers': 'X-From, X-Bake-Ms, X-Version, Content-Range' };
const send: Send = (res, code, body) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS }); res.end(JSON.stringify(body, null, 1)); };
const body = (req: import('node:http').IncomingMessage) => new Promise<any>((ok, no) => { let s = ''; req.on('data', (c) => (s += c)); req.on('end', () => { try { ok(s ? JSON.parse(s) : {}); } catch (e) { no(e); } }); });

createServer(async (req, res) => {
  try {
    const url = new URL(req.url ?? '/', 'http://x'), p = url.pathname.replace(/^\/serve/, '') || '/';
    if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }
    for (const r of routes) if (await r(req, res, p, send, CORS)) return;
    if (p === '/' || p === '/sets') return send(res, 200, { server: 'aslnut server', sets: await Promise.all(DEFS.map((d) => info(d.id))), jobs: jobs.slice(-10) });
    if (p === '/jobs') return send(res, 200, jobs);
    if (p === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive', ...CORS }); res.write(': hello\n\n');
      listeners.add(res); const ping = setInterval(() => res.write(': ping\n\n'), 20000);
      req.on('close', () => { listeners.delete(res); clearInterval(ping); });
      return;
    }
    let m = /^\/tiles\/([\w-]+)\/(\d+)\/(\d+)\/(\d+)\.mesh$/.exec(p);
    if (m) {
      const r = await serve(m[1]!, +m[2]!, +m[3]!, +m[4]!);
      if (!r) return send(res, 404, { error: 'no such set' });
      const h = { 'Content-Type': 'application/vnd.aslnut.mesh', 'X-From': r.from, 'X-Bake-Ms': r.ms.toFixed(1), 'X-Version': String(r.v), 'Cache-Control': 'no-cache', ETag: `"${m[1]}-${r.v}"`, ...CORS };
      if (req.headers['if-none-match'] === h.ETag) { res.writeHead(304, h); return res.end(); }
      if (!r.bytes) { res.writeHead(204, h); return res.end(); }
      res.writeHead(200, { ...h, 'Content-Encoding': 'gzip', 'Content-Length': r.bytes.length }); return res.end(r.bytes);
    }
    m = /^\/tiles\/([\w-]+)\/meta\.json$/.exec(p);
    if (m) { const i = await info(m[1]!); return i ? send(res, 200, i) : send(res, 404, { error: 'no such set' }); }
    m = /^\/tiles\/([\w-]+)\.pmtiles$/.exec(p);
    if (m) {
      const file = archiveFile(m[1]!); let st; try { st = statSync(file); } catch { return send(res, 404, { error: 'not baked yet: POST /serve/tiles/' + m[1] + '/bake' }); }
      const rg = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? ''), h = { 'Content-Type': 'application/vnd.pmtiles', 'Accept-Ranges': 'bytes', 'Cache-Control': 'public, max-age=300', ETag: `"${st.mtimeMs}"`, ...CORS };
      if (!rg) { res.writeHead(200, { ...h, 'Content-Length': st.size }); return createReadStream(file).pipe(res); }
      const a = +rg[1]!, b = Math.min(st.size - 1, rg[2] ? +rg[2] : st.size - 1);
      res.writeHead(206, { ...h, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 }); return createReadStream(file, { start: a, end: b }).pipe(res);
    }
    m = /^\/tiles\/([\w-]+)\/bake$/.exec(p);
    if (m && req.method === 'POST') {
      const id = m[1]!; if (!set(id)) return send(res, 404, { error: 'no such set' });
      const job: Job = { id: jobs.length + 1, set: id, min: +(url.searchParams.get('min') ?? 0), max: +(url.searchParams.get('max') ?? 6), state: 'running', done: 0, total: 0, started: new Date().toISOString() };
      jobs.push(job);
      void bakeArchive(id, job.min, job.max, (d, t) => { job.done = d; job.total = t; emit('job', job); })
        .then((r) => { job.state = 'done'; job.result = r; emit('job', job); emit('archive', { set: id }); }, (e: Error) => { job.state = 'failed'; job.error = e.message; emit('job', job); });
      return send(res, 202, job);
    }
    m = /^\/tiles\/([\w-]+)\/edit$/.exec(p);
    if (m && req.method === 'POST') {
      const s = set(m[1]!); if (!s) return send(res, 404, { error: 'no such set' });
      const e = await body(req), layer = e.layer ?? s.baker.names[0]!;
      const gid = e.gid ?? s.baker.find(layer, (o) => o.name === e.name);
      if (gid < 0) return send(res, 404, { error: `no feature named ${e.name}` });
      const box = apply(s, { at: new Date().toISOString(), layer, gid, props: e.props, rings: e.rings });
      // tell open maps which tiles to fetch again (the area, from the set's lowest level)
      const ev = { set: s.def.id, version: s.version, box, gid, layer, tiles: Array.from({ length: 4 }, (_, k) => tilesIn(box, s.def.minZoom + k).length) };
      emit('edit', ev); return send(res, 200, ev);
    }
    return send(res, 404, { error: 'unknown route', try: '/serve/' });
  } catch (e) { send(res, 500, { error: (e as Error).message }); }
}).listen(PORT, '127.0.0.1', () => console.log(`aslnut server on http://127.0.0.1:${PORT}/serve/`));
