// core › data › loading › stores: where answers are kept between visits, one named scope each (a document, the
// session, what persists). In a browser, Cache Storage (one cache per scope); in memory for tests and pages without
// it; in Node, a folder per scope (folder.ts, its own entry point). Per entry: the bytes and a small record (status,
// type, source, when, a few response headers); per scope: created, last written, bytes, items, pinned, persist.
import { AslnutError } from '../../world/errors.ts';

/** one kept answer */
export interface Entry {
  status: number;
  type: string;
  data: ArrayBuffer;
  /** the source rule it came under (esri, mapzen, dataset …) */
  source: string;
  /** when it was fetched (ms since 1970) */
  at: number;
  /** the response's own x-… headers */
  meta?: Record<string, string>;
}
export interface ScopeInfo {
  name: string; created: number; at: number; bytes: number; items: number;
  pinned?: boolean; persist?: boolean;
  /** ms; a scope not written for longer is deleted (unless pinned or persist) */
  maxAge?: number;
}
export interface Store {
  readonly kind: 'cache' | 'folder' | 'memory';
  names(): Promise<string[]>;
  get(scope: string, key: string): Promise<Entry | null>;
  has(scope: string, key: string): Promise<boolean>;
  /** the size, source and status of an entry without its bytes */
  head(scope: string, key: string): Promise<{ bytes: number; source: string; status: number } | null>;
  put(scope: string, key: string, e: Entry): Promise<void>;
  keys(scope: string): Promise<string[]>;
  info(scope: string): Promise<ScopeInfo | null>;
  setInfo(scope: string, patch: Partial<ScopeInfo>): Promise<void>;
  drop(scope: string): Promise<void>;
}

/** a scope name is a plain name: letters, digits, '-', '_', '.', not starting with a dot (so never '.' or '..') */
export function checkScope(scope: string): string {
  if (typeof scope !== 'string' || !/^[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/.test(scope)) {
    throw new AslnutError('E-LOAD-004', `unsafe scope name ${JSON.stringify(scope)}`, { fix: "use letters, digits, '-', '_' and '.', not starting with a dot, at most 128 characters" });
  }
  return scope;
}

const now = () => Date.now();
export const blankInfo = (name: string): ScopeInfo => ({ name, created: now(), at: now(), bytes: 0, items: 0 });

// ── Cache Storage (browsers) ──────────────────────────────────────────────────────────────────────────────────────
const PREFIX = 'aslnut:';
const META = 'https://aslnut.local/__scope__';
const H = { source: 'x-aslnut-source', at: 'x-aslnut-at', bytes: 'x-aslnut-bytes', meta: 'x-aslnut-meta', status: 'x-aslnut-status' };

export class CacheStore implements Store {
  readonly kind = 'cache' as const;
  private infos = new Map<string, ScopeInfo>(); private dirty = new Set<string>(); private flushT: ReturnType<typeof setTimeout> | null = null;
  private open(scope: string): Promise<Cache> { return caches.open(PREFIX + checkScope(scope)); }
  async names(): Promise<string[]> { return (await caches.keys()).filter((k) => k.startsWith(PREFIX)).map((k) => k.slice(PREFIX.length)); }
  private async match(scope: string, key: string): Promise<Response | null> {
    if (!(await caches.has(PREFIX + checkScope(scope)))) return null;
    return (await (await this.open(scope)).match(key)) ?? null;
  }
  async get(scope: string, key: string): Promise<Entry | null> {
    const r = await this.match(scope, key); if (!r) return null;
    const meta = r.headers.get(H.meta);
    return { status: Number(r.headers.get(H.status) ?? r.status), type: r.headers.get('content-type') ?? '', data: await r.arrayBuffer(), source: r.headers.get(H.source) ?? '', at: Number(r.headers.get(H.at) ?? 0), ...(meta ? { meta: JSON.parse(meta) as Record<string, string> } : {}) };
  }
  async has(scope: string, key: string): Promise<boolean> { return !!(await this.match(scope, key)); }
  async head(scope: string, key: string) {
    const r = await this.match(scope, key); if (!r) return null;
    return { bytes: Number(r.headers.get(H.bytes) ?? 0), source: r.headers.get(H.source) ?? '', status: Number(r.headers.get(H.status) ?? r.status) };
  }
  async put(scope: string, key: string, e: Entry): Promise<void> {
    const c = await this.open(scope), had = !!(await c.match(key));
    const headers: Record<string, string> = { 'content-type': e.type || 'application/octet-stream', [H.source]: e.source, [H.at]: String(e.at), [H.bytes]: String(e.data.byteLength), [H.status]: String(e.status) };
    if (e.meta && Object.keys(e.meta).length) headers[H.meta] = JSON.stringify(e.meta);
    await c.put(key, new Response(e.data, { status: 200, headers }));
    const i = (await this.info(scope)) ?? blankInfo(scope);
    if (!had) { i.bytes += e.data.byteLength; i.items++; }
    i.at = now(); this.infos.set(scope, i); this.mark(scope);
  }
  async keys(scope: string): Promise<string[]> {
    if (!(await caches.has(PREFIX + checkScope(scope)))) return [];
    return (await (await this.open(scope)).keys()).map((q) => q.url).filter((u) => u !== META);
  }
  async info(scope: string): Promise<ScopeInfo | null> {
    const have = this.infos.get(scope); if (have) return have;
    if (!(await caches.has(PREFIX + checkScope(scope)))) return null;
    const r = await (await this.open(scope)).match(META);
    const i = r ? ((await r.json()) as ScopeInfo) : await this.count(scope);
    this.infos.set(scope, i); return i;
  }
  async setInfo(scope: string, patch: Partial<ScopeInfo>): Promise<void> {
    const i = { ...((await this.info(scope)) ?? blankInfo(scope)), ...patch, name: scope };
    this.infos.set(scope, i); this.mark(scope); await this.flush();
  }
  async drop(scope: string): Promise<void> { checkScope(scope); this.infos.delete(scope); this.dirty.delete(scope); await caches.delete(PREFIX + scope); }
  private async count(scope: string): Promise<ScopeInfo> {
    const c = await this.open(scope), i = blankInfo(scope);
    for (const q of await c.keys()) { if (q.url === META) continue; const r = await c.match(q); i.items++; i.bytes += Number(r?.headers.get(H.bytes) ?? 0); }
    return i;
  }
  private mark(scope: string): void { this.dirty.add(scope); this.flushT ??= setTimeout(() => { this.flush().catch(() => {}); }, 800); }
  async flush(): Promise<void> {
    if (this.flushT) { clearTimeout(this.flushT); this.flushT = null; }
    for (const s of [...this.dirty]) {
      this.dirty.delete(s); const i = this.infos.get(s); if (!i) continue;
      await (await this.open(s)).put(META, new Response(JSON.stringify(i), { headers: { 'content-type': 'application/json' } }));
    }
  }
  /** stop the pending write of scope records (the loader's dispose) */
  close(): void { if (this.flushT) { clearTimeout(this.flushT); this.flushT = null; } }
}

// ── in memory (tests, and pages without Cache Storage: kept for the page's life) ─────────────────────────────────
export class MemoryStore implements Store {
  readonly kind = 'memory' as const;
  private m = new Map<string, Map<string, Entry>>(); private infos = new Map<string, ScopeInfo>();
  async names(): Promise<string[]> { return [...this.m.keys()]; }
  async get(scope: string, key: string): Promise<Entry | null> { return this.m.get(checkScope(scope))?.get(key) ?? null; }
  async has(scope: string, key: string): Promise<boolean> { return !!this.m.get(checkScope(scope))?.has(key); }
  async head(scope: string, key: string) { const e = this.m.get(checkScope(scope))?.get(key); return e ? { bytes: e.data.byteLength, source: e.source, status: e.status } : null; }
  async put(scope: string, key: string, e: Entry): Promise<void> {
    let s = this.m.get(checkScope(scope)); if (!s) { s = new Map(); this.m.set(scope, s); }
    const i = this.infos.get(scope) ?? blankInfo(scope);
    if (!s.has(key)) { i.bytes += e.data.byteLength; i.items++; }
    s.set(key, e); i.at = now(); this.infos.set(scope, i);
  }
  async keys(scope: string): Promise<string[]> { return [...(this.m.get(checkScope(scope))?.keys() ?? [])]; }
  async info(scope: string): Promise<ScopeInfo | null> { return this.infos.get(scope) ?? (this.m.has(scope) ? blankInfo(scope) : null); }
  async setInfo(scope: string, patch: Partial<ScopeInfo>): Promise<void> { if (!this.m.has(checkScope(scope))) this.m.set(scope, new Map()); this.infos.set(scope, { ...(this.infos.get(scope) ?? blankInfo(scope)), ...patch, name: scope }); }
  async drop(scope: string): Promise<void> { checkScope(scope); this.m.delete(scope); this.infos.delete(scope); }
}
