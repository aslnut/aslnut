// A small static server for the tools (smoke, parity, live): the built examples at / (examples/<page>/), the data
// folder (never in git) at /dataset/ and /aslnut/data/, the pages' log answered at /api/log (204; a page logs there
// with &log=/api/log), a small map and feature service at /aslnut/mock/ows/ (tools/ows-mock.mjs:
// the same answers on every run). Local only (127.0.0.1); byte ranges honoured.
//   node tools/serve.mjs [port]
import { createServer } from 'node:http';
import { createReadStream, statSync, existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { answer, asked } from './ows-mock.mjs';

const PKG = resolve(import.meta.dirname, '..');
const DATA = resolve(PKG, '..', '..', 'data');
// (the data first: the examples' root is the last mount, it takes every other path)
const MOUNTS = [['/aslnut/data/', DATA], ['/dataset/', DATA], ['/', process.env.ASLNUT_DIST ?? join(PKG, 'dist-examples')]];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.png': 'image/png', '.jpg': 'image/jpeg', '.map': 'application/json', '.f32': 'application/octet-stream' };

export function serve(port = 8093) {
  const server = createServer((req, res) => {
    const p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    // (Chrome's new headless asks for a favicon: a 404 there would be a console error, a failed check)
    if (p === '/api/log' || p === '/favicon.ico') { res.writeHead(204); return res.end(); }
    if (p === '/aslnut/mock/ows/asked') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(asked)); }
    const mock = answer(req.url);
    if (mock) { res.writeHead(mock.status, { 'Content-Type': mock.type, 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-cache' }); return res.end(mock.body); }
    const m = MOUNTS.find(([pre]) => p.startsWith(pre));
    if (!m) { res.writeHead(404); return res.end(); }
    let f = normalize(join(m[1], p.slice(m[0].length)));
    if (!f.startsWith(m[1])) { res.writeHead(403); return res.end(); }
    if (f.endsWith('/')) f += 'index.html';
    let st; try { st = statSync(f); if (st.isDirectory()) { f = join(f, 'index.html'); st = statSync(f); } } catch { res.writeHead(404); return res.end(); }
    const type = TYPES[extname(f)] ?? 'application/octet-stream';
    const rg = /^bytes=(\d+)-(\d*)$/.exec(req.headers.range ?? '');
    if (rg) {
      const a = Number(rg[1]), b = Math.min(st.size - 1, rg[2] ? Number(rg[2]) : st.size - 1);
      res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1 });
      return createReadStream(f, { start: a, end: b }).pipe(res);
    }
    const gzip=!req.headers.range&&/gzip/.test(req.headers['accept-encoding']??'')&&existsSync(`${f}.gz`)&&statSync(`${f}.gz`).mtimeMs>=st.mtimeMs;
    if(gzip){f+= '.gz';st=statSync(f);}
    res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Cache-Control': 'no-cache',...(gzip?{'Content-Encoding':'gzip','Vary':'Accept-Encoding'}:{}) });
    createReadStream(f).pipe(res);
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}
if (import.meta.url === `file://${process.argv[1]}`) { const port = Number(process.argv[2] ?? 8093); await serve(port); console.log(`serving on http://127.0.0.1:${port}/examples/hello-earth/`); }
