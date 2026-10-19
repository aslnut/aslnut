import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Loader, LoaderMiss, MemoryStore, FilePack, writePack, isAbort } from '../src/core/data/loading/index.ts';
import { FolderStore } from '../src/core/data/loading/folder.ts';
import { AslnutError } from '../src/core/world/errors.ts';

/** a fake network: counts calls; '/missing' is a 404; Range honoured unless `ignoreRange` */
function net(o: { ignoreRange?: boolean; lieRange?: boolean } = {}) {
  const calls: string[] = [];
  const body = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));
  const f = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url); calls.push(u);
    if (u.includes('/missing')) return new Response(null, { status: 404 });
    const range = new Headers(init?.headers).get('Range');
    if (range && !o.ignoreRange) {
      const [, a, b] = /bytes=(\d+)-(\d+)/.exec(range)!.map(Number) as [number, number, number];
      const s = o.lieRange ? a + 1 : a;
      return new Response(body.slice(s, b + 1), { status: 206, headers: { 'content-range': `bytes ${s}-${b}/100` } });
    }
    return new Response(u.endsWith('.json') ? JSON.stringify({ u }) : body, { status: 200, headers: { 'content-type': u.endsWith('.json') ? 'application/json' : 'application/octet-stream' } });
  }) as typeof fetch;
  return { f, calls };
}
const mk = (o: ConstructorParameters<typeof Loader>[0] = {}) => new Loader({ store: new MemoryStore(), retries: 0, ...o });

test('memory hits obey the policy: networkOnly always goes to the network', async () => {
  const { f, calls } = net();
  const l = mk({ fetch: f, sources: { live: { match: '/live/', policy: 'networkOnly' } } });
  await l.get('https://x.test/live/a.json', { kind: 'json' });
  await l.get('https://x.test/live/a.json', { kind: 'json' });
  assert.equal(calls.length, 2);
  await l.get('https://x.test/static/a.json', { kind: 'json' });
  await l.get('https://x.test/static/a.json', { kind: 'json' });
  assert.equal(calls.length, 3, 'cacheFirst answers the second from memory');
});
test('memory hits obey the scope: record keeps a value loaded before; replay answers only what was kept', async () => {
  const { f, calls } = net();
  const l = mk({ fetch: f, scope: 'doc' });
  await l.get('https://x.test/a.bin');                  // live: memory only
  l.mode = 'record';
  await l.get('https://x.test/a.bin');                  // not kept yet: kept now (from the network)
  assert.equal(calls.length, 2);
  assert.equal((await l.coverage(['https://x.test/a.bin'])).have, 1);
  await l.get('https://x.test/b.bin');
  l.mode = 'live'; await l.get('https://x.test/c.bin');  // c only in memory
  l.mode = 'replay';
  assert.ok(await l.get('https://x.test/a.bin'));
  await assert.rejects(l.get('https://x.test/c.bin'), (e: unknown) => e instanceof LoaderMiss && e.code === 'E-LOAD-001');
  l.scope = 'other';
  await assert.rejects(l.get('https://x.test/a.bin'), LoaderMiss, 'another scope does not see doc');
});
test('authorised requests are never shared with anonymous ones in memory', async () => {
  const { f, calls } = net();
  const l = mk({ fetch: f });
  await l.get('https://x.test/me.json', { kind: 'json' });
  await l.get('https://x.test/me.json', { kind: 'json', init: { headers: { Authorization: 'Bearer a' } } });
  assert.equal(calls.length, 2);
});
test('a 404 never counts as ready', async () => {
  const { f } = net();
  const l = mk({ fetch: f, scope: 'doc' });
  const r = await l.ensure(['https://x.test/ok.bin', 'https://x.test/missing.bin']);
  assert.equal(r.fetched, 1); assert.equal(r.absent, 1); assert.equal(r.failed, 0);
  const c = await l.coverage(['https://x.test/ok.bin', 'https://x.test/missing.bin']);
  assert.equal(c.have, 1); assert.equal(c.fraction, 0.5); assert.deepEqual(c.absent, ['https://x.test/missing.bin']);
  assert.equal(await l.get('https://x.test/missing.bin'), null);
});
test('ranges are validated: an exact 206, a 200 cut to the range, a wrong 206 fails', async () => {
  const ok = mk({ fetch: net().f });
  assert.deepEqual([...new Uint8Array((await ok.get<ArrayBuffer>({ url: 'https://x.test/r.bin', range: [10, 5] }))!)], [10, 11, 12, 13, 14]);
  const whole = mk({ fetch: net({ ignoreRange: true }).f });
  assert.deepEqual([...new Uint8Array((await whole.get<ArrayBuffer>({ url: 'https://x.test/r.bin', range: [10, 5] }))!)], [10, 11, 12, 13, 14]);
  const liar = mk({ fetch: net({ lieRange: true }).f });
  await assert.rejects(liar.get({ url: 'https://x.test/r.bin', range: [10, 5] }), (e: unknown) => e instanceof AslnutError && e.code === 'E-LOAD-003');
  await assert.rejects(ok.get({ url: 'https://x.test/r.bin', range: [-1, 5] }), /byte range/);
});
test('provider rights: Esri and OSM are show only (no prefetch, keep or export); open data is', async () => {
  const { f, calls } = net();
  const l = mk({ fetch: f, scope: 'doc', mode: 'record' });
  const esri = 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/3/2/1';
  const osm = 'https://tile.openstreetmap.org/3/2/1.png';
  const mapzen = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/3/2/1.png';
  for (const u of [esri, osm]) for (const c of ['prefetch', 'keep', 'export'] as const) assert.equal(l.can(c, u), false, `${u} ${c}`);
  assert.equal(l.can('show', esri), true);
  for (const c of ['prefetch', 'keep', 'export'] as const) assert.equal(l.can(c, mapzen), true);
  await l.get(esri);                           // shown, in record mode: not kept
  assert.equal((await l.coverage([esri])).have, 0);
  await assert.rejects(l.get(osm, { prefetch: true }), (e: unknown) => e instanceof AslnutError && e.code === 'E-LOAD-002');
  const r = await l.ensure([osm, mapzen]);
  assert.equal(r.refused, 1); assert.equal(r.fetched, 1);
  assert.ok(!calls.includes(osm));
  const ex = await l.export('doc');
  assert.equal(ex.items, 1); assert.deepEqual(ex.refused, []);
});
test('FolderStore: scope names cannot escape the root', async () => {
  const root = await mkdtemp(join(tmpdir(), 'aslnut-'));
  try {
    const keep = join(root, 'keep'); await writeFile(join(root, 'sibling.txt'), 'x');
    const s = new FolderStore(keep);
    for (const bad of ['..', '.', '../x', 'a/b', 'a\\b', '', '.hidden', 'x'.repeat(200)]) {
      await assert.rejects(s.drop(bad), (e: unknown) => e instanceof AslnutError && e.code === 'E-LOAD-004', bad);
      await assert.rejects(s.put(bad, 'k', { status: 200, type: '', data: new ArrayBuffer(1), source: 't', at: 0 }), /unsafe scope/);
    }
    await s.put('doc-1', 'https://x.test/a', { status: 200, type: 't', data: new Uint8Array([1, 2]).buffer, source: 't', at: 1 });
    assert.deepEqual([...new Uint8Array((await s.get('doc-1', 'https://x.test/a'))!.data)], [1, 2]);
    await s.drop('doc-1');
    assert.deepEqual((await readdir(root)).sort(), ['keep', 'sibling.txt']);
  } finally { await rm(root, { recursive: true, force: true }); }
});
test('packs: round trip, and a malformed pack is refused', async () => {
  const blob = writePack('doc', [{ key: 'https://x.test/a', e: { status: 200, type: 't', data: new Uint8Array([7]).buffer, source: 's', at: 0 } }]);
  const p = await FilePack.read(blob);
  assert.deepEqual([...new Uint8Array((await p.get('https://x.test/a'))!.data)], [7]);
  const buf = new Uint8Array(await blob.arrayBuffer());
  await assert.rejects(FilePack.read(buf.slice(0, 20).buffer), /E-LOAD-005/);
  const ix = JSON.stringify({ version: 1, scope: '..', created: 0, entries: [] }), head = new Uint8Array(12);
  head.set(new TextEncoder().encode('ASLNUTPK')); new DataView(head.buffer).setUint32(8, ix.length, true);
  await assert.rejects(FilePack.read(new Blob([head, ix])), /unsafe scope/);
  const big = JSON.stringify({ version: 1, scope: 'a', created: 0, entries: [{ key: 'k', offset: 0, length: 999 }] }), h2 = new Uint8Array(12);
  h2.set(new TextEncoder().encode('ASLNUTPK')); new DataView(h2.buffer).setUint32(8, big.length, true);
  await assert.rejects(FilePack.read(new Blob([h2, big])), /out of bounds/);
});
test('dispose: no more loads', async () => {
  const l = mk({ fetch: net().f });
  l.dispose();
  await assert.rejects(l.get('https://x.test/a'), /disposed/);
});

/** a slow network that sees its signal: resolves after `ms` unless stopped */
function slowNet(ms = 60) {
  const log = { started: 0, stopped: 0, done: 0 };
  const f = ((_url: string | URL | Request, init?: RequestInit) => new Promise<Response>((ok, bad) => {
    log.started++;
    const t = setTimeout(() => { log.done++; ok(new Response(new Uint8Array([1, 2, 3]), { status: 200 })); }, ms);
    init?.signal?.addEventListener('abort', () => { clearTimeout(t); log.stopped++; bad(Object.assign(new Error('aborted'), { name: 'AbortError' })); });
  })) as typeof fetch;
  return { f, log };
}
test('a load abandoned through its signal rejects at once, stops its fetch and is not remembered', async () => {
  const { f, log } = slowNet(), l = mk({ fetch: f, store: null });
  const ac = new AbortController(), p = l.get('https://x/tile/1.bin', { signal: ac.signal });
  setTimeout(() => ac.abort(), 10);
  await assert.rejects(p, (e: Error) => isAbort(e));
  await new Promise((r) => setTimeout(r, 80));
  assert.equal(log.stopped, 1); assert.equal(log.done, 0);
  // asked again: fetched again (nothing was kept from the abandoned one)
  const v = await l.get<ArrayBuffer>('https://x/tile/1.bin');
  assert.equal(v!.byteLength, 3); assert.equal(log.started, 2);
});
test('a shared load goes on while anyone still waits for it; the last to let go stops it', async () => {
  const { f, log } = slowNet(), l = mk({ fetch: f, store: null });
  const a = new AbortController(), b = new AbortController();
  const pa = l.get('https://x/tile/2.bin', { signal: a.signal }), pb = l.get('https://x/tile/2.bin', { signal: b.signal });
  a.abort();
  await assert.rejects(pa, (e: Error) => isAbort(e));
  assert.equal((await pb as ArrayBuffer).byteLength, 3); assert.equal(log.stopped, 0);
  // one waiting without a signal holds it to the end
  const c = new AbortController(), pc = l.get('https://x/tile/3.bin', { signal: c.signal }), pd = l.get('https://x/tile/3.bin');
  c.abort(); await assert.rejects(pc, (e: Error) => isAbort(e));
  assert.equal((await pd as ArrayBuffer).byteLength, 3); assert.equal(log.stopped, 0);
});
test('record mode never stops a fetch (the recording keeps every answer asked for); a queued load abandoned never starts', async () => {
  const { f, log } = slowNet(), rec = mk({ fetch: f, mode: 'record', scope: 'doc' });
  const ac = new AbortController(), p = rec.get('https://x/tile/4.bin', { signal: ac.signal });
  ac.abort(); await assert.rejects(p, (e: Error) => isAbort(e));
  await new Promise((r) => setTimeout(r, 90));
  assert.equal(log.stopped, 0); assert.equal(log.done, 1);
  // replay finds it
  rec.mode = 'replay'; assert.equal((await rec.get<ArrayBuffer>('https://x/tile/4.bin'))!.byteLength, 3);
  const q = slowNet(), one = mk({ fetch: q.f, store: null, concurrency: 1 });
  const first = one.get('https://x/a.bin'), cc = new AbortController(), second = one.get('https://x/b.bin', { signal: cc.signal });
  cc.abort(); await assert.rejects(second, (e: Error) => isAbort(e)); await first;
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(q.log.started, 1);
});
