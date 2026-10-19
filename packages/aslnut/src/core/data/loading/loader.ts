// core › data › loading: every load in aslnut goes through one (tiles, terrain, data files, basemaps, archive ranges).
// It answers from tiers, in order:
//   memory   decoded values (ImageBitmap, parsed JSON, bytes, text), least recently used out first, within a budget
//   packs    read-only bundles (an exported scope in one file)
//   stores   kept answers by scope (Cache Storage in a browser, memory in tests, a folder in Node)
//   network  fetch (Node: also files), per-host concurrency, retries with backoff, priorities now / soon / later
// Rules per provider say the request policy and the provider's terms (show / prefetch / keep / export). Modes: live,
// record (keep what is loaded into the scope), replay / offline (no network: a miss is an event and an error).
// Each world has its own loader (there is no shared global one); pass one in to share it.
//   const net = loader({ scope: 'bandung' });
//   const img = await net.get(url, { kind: 'image' });
//   net.mode = 'replay'; net.on('miss', m => …); await net.ensure(urls); await net.coverage(urls)
import { pixelsOf, prepareDecode, type Pixels } from './decode.ts';
import { AslnutError } from '../../world/errors.ts';
import { FilePack, writePack, type Pack } from './pack.ts';
import { OPEN, SHOW_ONLY, termsOf, type Capability, type Terms } from '../rights.ts';
import { CacheStore, MemoryStore, checkScope, type Entry, type ScopeInfo, type Store } from './stores.ts';

export type Kind = 'bytes' | 'json' | 'text' | 'image' | 'imageRaw' | 'pixels' | 'imagePixels' | 'entry';
export type Priority = 'now' | 'soon' | 'later';
export type Policy = 'cacheFirst' | 'networkFirst' | 'cacheOnly' | 'networkOnly';
export type Mode = 'live' | 'record' | 'replay' | 'offline';
export type Tier = 'memory' | 'shared' | 'pack' | 'store' | 'network';

export interface SourceRule {
  /** which URLs it covers */
  match?: RegExp | string | ((url: string) => boolean);
  policy?: Policy;
  /** the provider's terms (default: open, your own data) */
  terms?: Partial<Terms>;
  /** where kept answers go when keeping is allowed: session (cleared with the browsing session) · scope (the
   *  document's) · persist (until cleared) */
  store?: 'session' | 'scope' | 'persist';
  /** downloads at once to its host */
  concurrency?: number;
  /** ms after which a kept answer is stale (a network answer is preferred when allowed) */
  maxAge?: number;
}
/** a request: a URL, and optionally a byte range [offset, length] */
export interface Req { url: string; range?: [number, number] }
export interface GetOptions {
  kind?: Kind; priority?: Priority;
  /** a source rule by id (else the first rule whose `match` fits the URL) */
  source?: string;
  /** the scope it belongs to (default the loader's) */
  scope?: string;
  /** keep it in the scope whatever the mode (ensure) */
  keep?: boolean;
  /** this load is ahead of need (a view not reached yet): refused where the terms forbid prefetching */
  prefetch?: boolean;
  init?: RequestInit;
  /** stop waiting: the load rejects with an AbortError at once; its fetch stops when nobody else waits for it (in
   *  record mode a fetch is never stopped: a recording keeps every answer the view asked for, whatever its timing) */
  signal?: AbortSignal;
}
/** what a load abandoned through its `signal` rejects with */
export const isAbort = (e: unknown): boolean => (e as { name?: string })?.name === 'AbortError';
const aborted = () => Object.assign(new Error('the load was abandoned'), { name: 'AbortError', retry: false });
export interface LoaderOptions {
  scope?: string;
  mode?: Mode;
  /** memory for decoded values, bytes or "256 MB" */
  memory?: number | string;
  /** what goes first when memory is over: the least seen (default), or your score per item (the lowest out first) */
  evict?: 'least-seen' | ((item: { key: string; bytes: number; seenMsAgo: number }) => number);
  /** where scopes are kept: default Cache Storage in a browser, else memory. Node: pass a FolderStore */
  store?: Store | null;
  /** source rules added before the defaults (a rule with a default's id replaces it) */
  sources?: Record<string, SourceRule>;
  /** downloads at once per host (default 6) */
  concurrency?: number;
  retries?: number;
  /** a request's deadline, ms (default 30 s) */
  timeout?: number;
  /** scopes not written for longer are deleted at start (ms, default 7 days) */
  maxAge?: number;
  /** packs answered before any store */
  packs?: Pack[];
  fetch?: typeof fetch;
}
export interface LoadEvent { url: string; kind: Kind; tier: Tier; source: string; bytes: number; ms: number }
export interface MissEvent { url: string; mode: Mode; source: string; scope: string }
export interface RefuseEvent { url: string; source: string; capability: Capability }
export interface Manifest { scope: string; created: number; bytes: number; items: { url: string; bytes: number; source: string; status: number }[] }
/** how much of a list is answered without the network: `have` counts real answers only (never a 404) */
export interface Coverage { have: number; total: number; fraction: number; missing: string[]; absent: string[] }
export interface EnsureResult { fetched: number; already: number; absent: number; failed: number; refused: number; bytes: number; problems: { url: string; why: string }[] }
type Events = { load: LoadEvent; miss: MissEvent; refuse: RefuseEvent; evict: { key: string; bytes: number }; progress: { phase: string; done: number; total: number; bytes: number }; error: { url: string; error: string } };

/** a load the mode forbids from the network and no tier answers */
export class LoaderMiss extends AslnutError {
  readonly url: string; readonly mode: Mode;
  constructor(url: string, mode: Mode) {
    super('E-LOAD-001', `${url} is not ready (${mode} mode: no network)`, { fix: 'prepare it first: loader.ensure(urls) in live mode, or import its pack' });
    this.name = 'LoaderMiss'; this.url = url; this.mode = mode;
  }
}

/** the built-in provider rules: the services' own terms */
export const DEFAULT_SOURCES: Record<string, SourceRule> = {
  esri: { match: /arcgisonline\.com|arcgis\.com/, terms: SHOW_ONLY, concurrency: 6 },
  osm: { match: /tile\.openstreetmap\.org/, terms: SHOW_ONLY, concurrency: 2 },
  mapbox: { match: /api\.mapbox\.com/, terms: SHOW_ONLY },
  mapzen: { match: /elevation-tiles-prod/, terms: OPEN, store: 'scope', concurrency: 8 },
  sentinel: { match: /tiles\.maps\.eox\.at/, terms: OPEN, store: 'scope', concurrency: 12 },
  default: { terms: OPEN, store: 'scope' },
};
const MB = 1048576;
const isNode = typeof window === 'undefined' && !!(globalThis as { process?: { versions?: { node?: string } } }).process?.versions?.node;
const bytesOf = (v: number | string | undefined, d: number) => typeof v === 'number' ? v : v ? Number(/[\d.]+/.exec(v)?.[0] ?? 0) * (/g/i.test(v) ? 1024 * MB : /k/i.test(v) ? 1024 : MB) : d;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const now = () => Date.now();

interface Mem { v: unknown; bytes: number; /** last asked for (ms) */ seen: number; /** where the answer is known to be kept: scope names, 'pack:<name>' */ kept: Set<string> }
type Tagged = Entry & { tier?: Tier; from?: string };

export class Loader {
  scope: string;
  private _mode: Mode;
  readonly store: Store | null;
  private rules: [string, SourceRule][];
  private packs: Pack[] = [];
  private mem = new Map<string, Mem>(); private memBytes = 0; budget: number;
  private flying = new Map<string, Promise<unknown>>();
  /** per load in flight: who waits for it with a signal, whether anyone waits without one, and its stop */
  private holds = new Map<string, { ctrl: AbortController; n: number; firm: boolean }>();
  private hosts = new Map<string, { active: number; q: Record<Priority, (() => void)[]> }>();
  private ev: { [K in keyof Events]?: Set<(e: Events[K]) => void> } = {};
  private stat = Loader.blankStats();
  private o: LoaderOptions; private ready: Promise<void>; private disposed = false;
  private aborts = new Set<AbortController>();

  constructor(o: LoaderOptions = {}) {
    this.o = o; this.scope = checkScope(o.scope ?? 'default'); this._mode = o.mode ?? 'live';
    const dm = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
    this.budget = bytesOf(o.memory, isNode ? 512 * MB : Math.min(192, (dm ?? 8) * 24) * MB);
    this.store = o.store !== undefined ? o.store : typeof caches !== 'undefined' ? new CacheStore() : new MemoryStore();
    const mine = Object.entries(o.sources ?? {}).filter(([k]) => k !== 'default');
    const defs = Object.entries(DEFAULT_SOURCES).filter(([k]) => k !== 'default' && !(o.sources && k in o.sources));
    this.rules = [...mine, ...defs, ['default', { ...DEFAULT_SOURCES.default!, ...(o.sources?.default ?? {}) }]];
    for (const p of o.packs ?? []) this.addPack(p);
    this.ready = this.housekeeping().catch(() => {});
  }
  private static blankStats() { return { tiers: { memory: 0, shared: 0, pack: 0, store: 0, network: 0 } as Record<Tier, number>, bytesNetwork: 0, misses: 0, errors: 0, kept: 0, refused: 0, inflight: 0, byKind: {} as Record<string, { count: number; bytes: number }>, bySource: {} as Record<string, { count: number; network: number; bytes: number }> }; }

  // ── modes and rules ────────────────────────────────────────────────────────────────────────────────────────
  get mode(): Mode { return this._mode; }
  set mode(m: Mode) { this._mode = m; }
  /** add or change a source rule */
  source(id: string, r: SourceRule): this {
    const i = this.rules.findIndex(([k]) => k === id);
    if (i >= 0) this.rules[i] = [id, { ...this.rules[i]![1], ...r }]; else this.rules.splice(Math.max(0, this.rules.length - 1), 0, [id, r]);
    return this;
  }
  /** the rule a URL falls under */
  ruleOf(url: string, id?: string): [string, SourceRule] {
    if (id) { const r = this.rules.find(([k]) => k === id); if (r) return r; }
    for (const [k, r] of this.rules) {
      const m = r.match; if (!m) continue;
      if (typeof m === 'string' ? url.includes(m) : m instanceof RegExp ? m.test(url) : m(url)) return [k, r];
    }
    return ['default', this.rules.find(([k]) => k === 'default')![1]];
  }
  /** what the provider of a URL allows */
  termsOf(url: string, source?: string): Terms { return termsOf(this.ruleOf(url, source)[1].terms); }
  /** may this URL be shown / prefetched / kept / exported? */
  can(cap: Capability, url: string, source?: string): boolean { return this.termsOf(url, source)[cap]; }

  // ── getting ────────────────────────────────────────────────────────────────────────────────────────────────
  /** the key a request is kept under: its absolute URL (+ the byte range) */
  keyOf(req: string | Req): string {
    const url = typeof req === 'string' ? req : req.url, range = typeof req === 'string' ? undefined : req.range;
    const abs = !isNode && typeof location !== 'undefined' ? new URL(url, location.href).href : url;
    return range ? `${abs}${abs.includes('?') ? '&' : '?'}__range=${range[0]}-${range[1]}` : abs;
  }
  /** a request's identity in memory: the key, plus its headers and credentials (an authorised answer is never shared
   *  with an anonymous one) */
  private idOf(key: string, init?: RequestInit): string {
    if (!init?.headers && !init?.credentials) return key;
    const h: string[] = []; new Headers(init.headers).forEach((v, k) => h.push(`${k}:${v}`));
    return `${key}#${init.credentials ?? ''}#${h.sort().join('|')}`;
  }
  /** a value decoded by `kind` (bytes: ArrayBuffer · json · text · image / imageRaw: ImageBitmap · entry: the kept
   *  answer with its status); null when there is nothing there (404) */
  async get<T = unknown>(req: string | Req, o: GetOptions = {}): Promise<T | null> {
    if (this.disposed) throw new AslnutError('E-WORLD-003', 'the loader was disposed', { fix: 'make a new loader' });
    const kind = o.kind ?? 'bytes', key = this.keyOf(req), mk = `${kind}|${this.idOf(key, o.init)}`;
    const [sid, rule] = this.ruleOf(key, o.source), terms = termsOf(rule.terms), policy = rule.policy ?? 'cacheFirst', scope = checkScope(o.scope ?? this.scope);
    if (!terms.show) throw this.refuse(key, sid, 'show');
    if (o.prefetch && !terms.prefetch) throw this.refuse(key, sid, 'prefetch');
    if (o.keep && !terms.keep) throw this.refuse(key, sid, 'keep');
    const m = this.mem.get(mk);
    if (m && this.memoryAnswers(m, policy, scope, !!o.keep, terms)) {
      this.mem.delete(mk); this.mem.set(mk, m); m.seen = now(); this.stat.tiers.memory++; return m.v as T | null;
    }
    // shared while in flight: only with a request that resolves the same way
    const fk = `${mk}|${policy}|${this._mode}|${scope}|${o.keep ? 1 : 0}`;
    const f = this.flying.get(fk); if (f) { this.stat.tiers.shared++; return this.waitFor(f as Promise<T | null>, fk, o.signal); }
    if (o.signal?.aborted) throw aborted();
    // Start only for an actual pixel request, while its bytes load; procedural terrain needs no decoder workers.
    if (kind === 'pixels' || kind === 'imagePixels') prepareDecode();
    const hold = { ctrl: new AbortController(), n: 0, firm: false };
    const p = (async () => {
      const t0 = now(), e = await this.resolve(req, key, sid, rule, policy, scope, { ...o, signal: hold.ctrl.signal });
      const kept = new Set<string>(e?.from ? [e.from] : []);
      if (!e || e.status === 404 || e.status === 204) { this.remember(mk, null, 64, kept); return null; }
      const v = await decode(kind, e, key);
      this.remember(mk, v, sizeOf(kind, v, e), kept);
      const k = (this.stat.byKind[kind] ??= { count: 0, bytes: 0 }); k.count++; k.bytes += e.data.byteLength;
      this.emit('load', { url: key, kind, tier: e.tier ?? 'network', source: sid, bytes: e.data.byteLength, ms: now() - t0 });
      return v;
    })().finally(() => { this.flying.delete(fk); this.holds.delete(fk); });
    this.flying.set(fk, p); this.holds.set(fk, hold);
    return this.waitFor(p as Promise<T | null>, fk, o.signal);
  }
  /** a caller's wait for a load in flight: without a signal it holds the load to the end; with one, it may let go
   *  (and the fetch stops once the last one lets go) */
  private waitFor<T>(p: Promise<T>, fk: string, signal?: AbortSignal): Promise<T> {
    const hold = this.holds.get(fk);
    if (!hold) return p;
    if (!signal) { hold.firm = true; return p; }
    if (signal.aborted) return Promise.reject(aborted());
    hold.n++;
    return new Promise<T>((ok, bad) => {
      const off = () => {
        bad(aborted());
        if (--hold.n <= 0 && !hold.firm && this._mode !== 'record') hold.ctrl.abort();
      };
      signal.addEventListener('abort', off, { once: true });
      p.then((v) => { signal.removeEventListener('abort', off); ok(v); }, (e) => { signal.removeEventListener('abort', off); bad(e); });
    });
  }
  /** a decoded value in memory answers only when the request's policy, mode and scope would accept it */
  private memoryAnswers(m: Mem, policy: Policy, scope: string, keep: boolean, terms: Terms): boolean {
    const offline = this._mode === 'replay' || this._mode === 'offline';
    if (policy === 'networkOnly') return false;
    if (policy === 'networkFirst' && !offline) return false;
    if (offline) { for (const s of this.readScopes(scope)) if (m.kept.has(s)) return true; for (const p of this.packs) if (m.kept.has(`pack:${p.name}`)) return true; return false; }
    if ((this._mode === 'record' || keep) && terms.keep) return m.kept.has(scope) || [...m.kept].some((k) => k.startsWith('pack:'));
    return true;
  }
  private refuse(url: string, source: string, capability: Capability): AslnutError {
    this.stat.refused++; this.emit('refuse', { url, source, capability });
    return new AslnutError('E-LOAD-002', `the terms of '${source}' do not allow ${capability === 'show' ? 'showing' : capability === 'prefetch' ? 'prefetching' : capability === 'keep' ? 'keeping' : 'exporting'} ${url}`, { where: source, fix: capability === 'prefetch' || capability === 'keep' ? 'use a provider that allows it (terrain.mapzen(), imagery.sentinel(), your own tiles), or hold a licence and set its terms' : 'see DATA-LICENCES.md' });
  }
  /** a Blob URL of a load (an element then needs no network) */
  async objectURL(url: string, type?: string): Promise<string> {
    const e = await this.get<Entry>(url, { kind: 'entry' });
    if (!e) throw new AslnutError('E-LOAD-001', `nothing at ${url}`, { fix: 'check the URL' });
    return URL.createObjectURL(new Blob([e.data], { type: type ?? e.type }));
  }

  private async resolve(req: string | Req, key: string, sid: string, rule: SourceRule, policy: Policy, scope: string, o: GetOptions): Promise<Tagged | null> {
    await this.ready;
    const src = (this.stat.bySource[sid] ??= { count: 0, network: 0, bytes: 0 }); src.count++;
    const offline = this._mode === 'replay' || this._mode === 'offline' || policy === 'cacheOnly';
    for (const pk of this.packs) { const e = await pk.get(key).catch(() => null); if (e) { this.stat.tiers.pack++; return { ...e, tier: 'pack', from: `pack:${pk.name}` }; } }
    let stale: Tagged | null = null;
    const fromStores = async (): Promise<Tagged | null> => {
      if (!this.store || policy === 'networkOnly') return null;
      for (const s of this.readScopes(scope)) {
        const e = await this.store.get(s, key).catch(() => null);
        if (!e) continue;
        if (rule.maxAge && now() - e.at > rule.maxAge && !offline) { stale ??= { ...e, tier: 'store', from: s }; continue; }
        this.stat.tiers.store++; return { ...e, tier: 'store', from: s };
      }
      return null;
    };
    if (policy !== 'networkFirst' || offline) {
      const e = await fromStores();
      if (e) { if ((this._mode === 'record' || o.keep) && e.from !== scope && termsOf(rule.terms).keep) await this.keep(key, e, rule, scope); return e; }
    }
    if (offline) {
      if (stale) return stale;
      this.stat.misses++; this.emit('miss', { url: key, mode: this._mode, source: sid, scope });
      throw new LoaderMiss(key, this._mode);
    }
    let e: Entry | null;
    try { e = await this.network(req, sid, rule, o.priority ?? 'now', o.init, o.signal); }
    catch (err) {
      if (o.signal?.aborted) throw aborted();
      const kept = policy === 'networkFirst' ? await fromStores() : null; if (kept) return kept;
      if (stale) return stale;
      this.stat.errors++; this.emit('error', { url: key, error: String((err as Error).message ?? err) }); throw err;
    }
    this.stat.tiers.network++; src.network++; src.bytes += e?.data.byteLength ?? 0; this.stat.bytesNetwork += e?.data.byteLength ?? 0;
    let from: string | undefined;
    if (e && (this._mode === 'record' || o.keep || rule.store === 'persist')) from = await this.keep(key, e, rule, scope);
    return e ? { ...e, tier: 'network', from } : null;
  }
  /** the scopes a load reads from: the document's, the session, what persists, and any added with `read` */
  private extra = new Set<string>();
  readScopes(scope = this.scope): string[] { return [...new Set([scope, 'session', 'persist', ...this.extra])]; }
  /** also answer from another scope (a shared basemap scope, a second document) */
  read(scope: string): this { this.extra.add(checkScope(scope)); return this; }

  /** keep an answer where its rule says, if its terms allow; returns the scope it went to */
  private async keep(key: string, e: Entry, rule: SourceRule, scope: string): Promise<string | undefined> {
    if (!this.store) return undefined;
    if (!termsOf(rule.terms).keep) { this.stat.refused++; this.emit('refuse', { url: key, source: e.source, capability: 'keep' }); return undefined; }
    const into = rule.store === 'session' ? 'session' : rule.store === 'persist' ? 'persist' : scope;
    try { await this.store.put(into, key, e); this.stat.kept++; return into; } catch (err) { this.emit('error', { url: key, error: `keep: ${(err as Error).message}` }); return undefined; }
  }

  /** fetch through the host's queue: concurrency, priority (later never takes the last slot), retries, a deadline */
  private network(req: string | Req, source: string, rule: SourceRule, prio: Priority, init?: RequestInit, signal?: AbortSignal): Promise<Entry | null> {
    const url = typeof req === 'string' ? req : req.url, range = typeof req === 'string' ? undefined : req.range;
    if (range) checkRange(range, url);
    const host = /^[a-z]+:\/\/([^/]+)/i.exec(url)?.[1] ?? 'local', limit = rule.concurrency ?? this.o.concurrency ?? 6;
    const h = this.hosts.get(host) ?? { active: 0, q: { now: [], soon: [], later: [] } }; this.hosts.set(host, h);
    return new Promise<Entry | null>((ok, bad) => {
      const run = async () => {
        // abandoned while it queued: it never takes a place
        if (signal?.aborted) { bad(aborted()); this.pump(host, limit); return; }
        h.active++; this.stat.inflight++;
        try {
          for (let n = 0; ; n++) {
            try { ok(await this.fetchOnce(url, range, source, init, signal)); return; }
            catch (err) {
              const retry = !this.disposed && !signal?.aborted && n < (this.o.retries ?? 3) && (err as { retry?: boolean }).retry !== false;
              if (!retry) throw err;
              await sleep(300 * 2 ** n);
            }
          }
        } catch (err) { bad(err); } finally { h.active--; this.stat.inflight--; this.pump(host, limit); }
      };
      h.q[prio].push(() => void run()); this.pump(host, limit);
    });
  }
  private pump(host: string, limit: number): void {
    const h = this.hosts.get(host)!;
    while (h.active < limit) {
      const next = h.q.now.shift() ?? h.q.soon.shift() ?? (h.active < Math.max(1, limit - 1) ? h.q.later.shift() : undefined);
      if (!next) return; next();
    }
  }
  private async fetchOnce(url: string, range: [number, number] | undefined, source: string, init?: RequestInit, signal?: AbortSignal): Promise<Entry | null> {
    if ((isNode && !/^[a-z]+:\/\//i.test(url)) || url.startsWith('file://')) return readFileEntry(url, range, source);
    const f = this.o.fetch ?? fetch;
    const headers = new Headers(init?.headers); if (range) headers.set('Range', `bytes=${range[0]}-${range[0] + range[1] - 1}`);
    const ac = new AbortController(), timer = setTimeout(() => ac.abort(), this.o.timeout ?? 30000); this.aborts.add(ac);
    const stop = () => ac.abort(); signal?.addEventListener('abort', stop, { once: true });
    let r: Response, data: ArrayBuffer;
    try {
      try { r = await f(url, { ...init, headers, mode: init?.mode ?? 'cors', signal: ac.signal }); } catch (e) { throw Object.assign(new Error(`network: ${(e as Error).message} ${url}`), { retry: !this.disposed }); }
      if (r.status === 404 || r.status === 204 || r.status === 410) return { status: 404, type: '', data: new ArrayBuffer(0), source, at: now() };
      if (r.status === 416) throw Object.assign(new AslnutError('E-LOAD-003', `the range ${range?.join('+')} is outside ${url}`, { fix: 'check the offset and length' }), { retry: false });
      if (!r.ok) throw Object.assign(new Error(`${r.status} ${url.replace(/access_token=[^&]+/, 'access_token=…')}`), { retry: r.status >= 500 || r.status === 429 });
      data = await r.arrayBuffer();
    } finally { clearTimeout(timer); this.aborts.delete(ac); signal?.removeEventListener('abort', stop); }
    if (range) data = rangeOf(r, data, range, url);
    const meta: Record<string, string> = {};
    r.headers.forEach((v, k) => { if (/^x-/i.test(k) && !/^x-aslnut/i.test(k)) meta[k.toLowerCase()] = v; });
    return { status: 200, type: r.headers.get('content-type') ?? '', data, source, at: now(), ...(Object.keys(meta).length ? { meta } : {}) };
  }

  // ── memory ─────────────────────────────────────────────────────────────────────────────────────────────────
  private remember(mk: string, v: unknown, bytes: number, kept: Set<string>): void {
    if (bytes > this.budget / 8) return;
    const had = this.mem.get(mk); if (had) { this.memBytes -= had.bytes; this.mem.delete(mk); for (const k of had.kept) kept.add(k); }
    this.mem.set(mk, { v, bytes, kept, seen: now() }); this.memBytes += bytes;
    this.trim();
  }
  /** within the budget: the least seen out first (the map's order), or by the app's score (the lowest first) */
  private trim(): void {
    if (this.memBytes <= this.budget) return;
    const ev = this.o.evict, t = now();
    const order = typeof ev === 'function' ? [...this.mem].map(([k, x]) => ({ k, x, s: ev({ key: k, bytes: x.bytes, seenMsAgo: t - x.seen }) })).sort((a, b) => a.s - b.s).map(({ k, x }) => [k, x] as const) : this.mem;
    for (const [k, x] of order) {
      if (this.memBytes <= this.budget) break;
      this.mem.delete(k); this.memBytes -= x.bytes; this.emit('evict', { key: k, bytes: x.bytes });
    }
  }
  /** a new memory budget (bytes or "256 MB"), and how to choose what goes: kept within it at once */
  setMemory(memory: number | string, evict?: LoaderOptions['evict']): this { this.budget = bytesOf(memory, this.budget); if (evict !== undefined) this.o = { ...this.o, evict }; this.trim(); return this; }
  /** forget decoded values (memory only) */
  forget(): void { this.mem.clear(); this.memBytes = 0; }

  // ── packs ──────────────────────────────────────────────────────────────────────────────────────────────────
  addPack(p: Pack): this { this.packs = [p, ...this.packs.filter((x) => x.name !== p.name)]; return this; }
  removePack(name: string): this { this.packs = this.packs.filter((p) => p.name !== name); return this; }
  get packList(): Pack[] { return [...this.packs]; }
  /** one file of a scope; entries whose provider forbids export are left out and listed */
  async export(scope = this.scope): Promise<{ blob: Blob; items: number; refused: string[] }> {
    if (!this.store) throw new AslnutError('E-LOAD-002', 'no store to export from', { fix: 'give the loader a store' });
    const out: { key: string; e: Entry }[] = [], refused: string[] = [];
    for (const k of await this.store.keys(checkScope(scope))) {
      const e = await this.store.get(scope, k); if (!e) continue;
      if (!this.can('export', k, this.rules.some(([id]) => id === e.source) ? e.source : undefined)) { refused.push(k); this.emit('refuse', { url: k, source: e.source, capability: 'export' }); continue; }
      out.push({ key: k, e });
    }
    return { blob: writePack(scope, out), items: out.length, refused };
  }
  /** a pack file: answered from directly (`as: 'pack'`, default) or copied into a scope's store (`as: 'store'`) */
  async import(file: Blob | ArrayBuffer, o: { as?: 'pack' | 'store'; scope?: string; name?: string } = {}): Promise<{ scope: string; items: number }> {
    const p = await FilePack.read(file, o.name);
    if ((o.as ?? 'pack') === 'pack') { this.addPack(p); return { scope: p.scope, items: p.keys().length }; }
    if (!this.store) throw new AslnutError('E-LOAD-002', 'no store to import into', { fix: "give the loader a store, or import as: 'pack'" });
    const scope = checkScope(o.scope ?? p.scope);
    for (const { key, e } of p.entries()) await this.store.put(scope, key, e);
    return { scope, items: p.keys().length };
  }

  // ── scopes ─────────────────────────────────────────────────────────────────────────────────────────────────
  async scopes(): Promise<ScopeInfo[]> {
    if (!this.store) return [];
    const out: ScopeInfo[] = [];
    for (const n of await this.store.names()) { const i = await this.store.info(n); if (i) out.push(i); }
    return out.sort((a, b) => b.at - a.at);
  }
  async scopeRules(name: string, r: { persist?: boolean; maxAge?: number }): Promise<void> { await this.store?.setInfo(checkScope(name), r); }
  async pin(scope: string, on = true): Promise<void> { await this.store?.setInfo(checkScope(scope), { pinned: on }); }
  /** delete a scope, or every scope (and what is decoded in memory); returns how many scopes went */
  async clear(scope?: string): Promise<number> {
    if (!this.store) return 0;
    const names = scope ? [checkScope(scope)] : await this.store.names();
    for (const n of names) await this.store.drop(n);
    this.forget();
    return names.length;
  }
  private async housekeeping(): Promise<void> {
    if (!this.store) return;
    let fresh = isNode;
    try { if (typeof sessionStorage !== 'undefined') { fresh = !sessionStorage.getItem('aslnut.session'); sessionStorage.setItem('aslnut.session', '1'); } } catch { /* no storage */ }
    if (fresh) await this.store.drop('session');
    const limit = now() - (this.o.maxAge ?? 7 * 864e5);
    for (const n of await this.store.names()) {
      const i = await this.store.info(n);
      if (i && !i.pinned && !i.persist && n !== 'persist' && (i.maxAge ? i.at < now() - i.maxAge : i.at < limit)) await this.store.drop(n);
    }
  }

  // ── readiness ──────────────────────────────────────────────────────────────────────────────────────────────
  /** how much of a list is answered without the network. Only real answers count (status 200); a kept 404 is
   *  listed as `absent`, never as ready */
  async coverage(list: string[] | Manifest, scope = this.scope): Promise<Coverage> {
    const urls = Array.isArray(list) ? list : list.items.map((i) => i.url);
    const missing: string[] = [], absent: string[] = [];
    for (const u of urls) {
      const key = this.keyOf(u);
      let st = 0;
      for (const pk of this.packs) { const e = await pk.get(key).catch(() => null); if (e) { st = e.status; break; } }
      if (!st && this.store) for (const s of this.readScopes(scope)) { const h = await this.store.head(s, key); if (h) { st = h.status; break; } }
      if (st === 200 || st === 206) continue;
      (st ? absent : missing).push(u);
    }
    const have = urls.length - missing.length - absent.length;
    return { have, total: urls.length, fraction: urls.length ? have / urls.length : 1, missing, absent };
  }
  /** fetch what a list needs and keep it, at low priority. Refuses URLs whose terms forbid prefetching or keeping;
   *  a 404 counts as `absent`, not fetched */
  async ensure(list: string[] | Manifest, o: { scope?: string; concurrency?: number; onProgress?: (done: number, total: number, bytes: number) => void } = {}): Promise<EnsureResult> {
    const scope = checkScope(o.scope ?? this.scope), cov = await this.coverage(list, scope);
    const r: EnsureResult = { fetched: 0, already: cov.have, absent: cov.absent.length, failed: 0, refused: 0, bytes: 0, problems: [] };
    let done = cov.have + cov.absent.length; o.onProgress?.(done, cov.total, 0);
    const queue = [...cov.missing];
    await Promise.all(Array.from({ length: o.concurrency ?? 12 }, async () => {
      while (queue.length) {
        const u = queue.shift()!, t = this.termsOf(this.keyOf(u));
        if (!t.prefetch || !t.keep) { r.refused++; r.problems.push({ url: u, why: `terms: ${!t.prefetch ? 'no prefetch' : 'no keep'}` }); }
        else {
          try {
            const e = await this.get<Entry>(u, { kind: 'entry', scope, keep: true, prefetch: true, priority: 'later' });
            if (e && (e.status === 200 || e.status === 206)) { r.fetched++; r.bytes += e.data.byteLength; } else { r.absent++; r.problems.push({ url: u, why: 'not found (404)' }); }
          } catch (err) { r.failed++; r.problems.push({ url: u, why: String((err as Error).message ?? err) }); }
        }
        o.onProgress?.(++done, cov.total, r.bytes); this.emit('progress', { phase: 'ensure', done, total: cov.total, bytes: r.bytes });
      }
    }));
    return r;
  }
  /** what a scope holds, as a list another device can `ensure` */
  async manifest(scope = this.scope): Promise<Manifest> {
    const items: Manifest['items'] = [];
    if (this.store) for (const k of await this.store.keys(checkScope(scope))) { const h = await this.store.head(scope, k); if (h) items.push({ url: k, ...h }); }
    return { scope, created: Date.now(), bytes: items.reduce((a, i) => a + i.bytes, 0), items };
  }

  // ── what happened ──────────────────────────────────────────────────────────────────────────────────────────
  stats() {
    return { mode: this._mode, scope: this.scope, tiers: { ...this.stat.tiers }, bytesNetwork: this.stat.bytesNetwork, misses: this.stat.misses, errors: this.stat.errors, kept: this.stat.kept, refused: this.stat.refused, inflight: this.stat.inflight, memory: { bytes: this.memBytes, items: this.mem.size, budget: this.budget }, byKind: structuredClone(this.stat.byKind), bySource: structuredClone(this.stat.bySource), packs: this.packs.map((p) => p.name) };
  }
  resetStats(): void { const inflight = this.stat.inflight; this.stat = Loader.blankStats(); this.stat.inflight = inflight; }
  on<K extends keyof Events>(ev: K, f: (e: Events[K]) => void): () => void {
    const m = this.ev as Record<string, Set<(e: never) => void> | undefined>, s = (m[ev] ??= new Set()) as Set<(e: Events[K]) => void>;
    s.add(f); return () => s.delete(f);
  }
  private emit<K extends keyof Events>(ev: K, e: Events[K]): void { const s = this.ev[ev] as Set<(e: Events[K]) => void> | undefined; if (s) for (const f of s) { try { f(e); } catch { /* a listener's problem */ } } }
  /** stop: abort what is in flight, forget memory, end timers */
  dispose(): void {
    this.disposed = true;
    for (const a of this.aborts) a.abort(); this.aborts.clear();
    for (const h of this.hosts.values()) { h.q.now.length = 0; h.q.soon.length = 0; h.q.later.length = 0; }
    // decoded images are closed (their pixels freed now, not when the garbage collector comes): nothing of a disposed
    // world reads them again
    for (const m of this.mem.values()) if (typeof ImageBitmap !== 'undefined' && m.v instanceof ImageBitmap) m.v.close();
    this.forget(); this.ev = {};
    if (this.store instanceof CacheStore) this.store.close();
  }
}

function checkRange(range: [number, number], url: string): void {
  if (!Number.isInteger(range[0]) || !Number.isInteger(range[1]) || range[0] < 0 || range[1] <= 0) throw new AslnutError('E-LOAD-003', `a byte range must be [offset ≥ 0, length > 0] integers (got [${range.join(', ')}])`, { where: url, fix: 'pass [offset, length]' });
}
/** the requested bytes out of a response: a 206 must say exactly the range asked (Content-Range); a 200 is the whole
 *  resource (the server ignored Range), so the range is cut out of it */
function rangeOf(r: Response, data: ArrayBuffer, range: [number, number], url: string): ArrayBuffer {
  const [a, n] = range;
  if (r.status === 206) {
    const header = r.headers.get('content-range');
    // CORS hides Content-Range unless the server exposes it. An exact-sized partial response is usable.
    const crossOrigin = r.type === 'cors' || (typeof location !== 'undefined' && new URL(url, location.href).origin !== location.origin);
    if (header === null && crossOrigin && data.byteLength === n) return data;
    const m = /^bytes (\d+)-(\d+)\/(\d+|\*)$/.exec(r.headers.get('content-range') ?? '');
    const total = m && m[3] !== '*' ? Number(m[3]) : Infinity;
    const want = Math.min(a + n, total) - 1;
    if (!m || Number(m[1]) !== a || Number(m[2]) !== want || data.byteLength !== want - a + 1) {
      throw Object.assign(new AslnutError('E-LOAD-003', `asked bytes ${a}-${a + n - 1}, got '${r.headers.get('content-range') ?? 'no Content-Range'}' and ${data.byteLength} bytes`, { where: url, fix: 'answer Range requests exactly and expose the header with Access-Control-Expose-Headers: Content-Range' }), { retry: false });
    }
    return data;
  }
  if (data.byteLength <= a) throw Object.assign(new AslnutError('E-LOAD-003', `the range starts at ${a}, past the end (${data.byteLength} bytes)`, { where: url }), { retry: false });
  return data.slice(a, a + n);
}

async function decode(kind: Kind, e: Entry, key: string): Promise<unknown> {
  switch (kind) {
    case 'entry': return e;
    case 'bytes': return e.data;
    case 'text': return new TextDecoder().decode(e.data);
    case 'json': {
      let b = e.data;
      if (/\.gz$/i.test(key.split('?')[0]!) && new Uint8Array(b, 0, 2)[0] === 0x1f) b = await new Response(new Blob([b]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer();
      return JSON.parse(new TextDecoder().decode(b));
    }
    case 'image': case 'imageRaw': {
      if (typeof createImageBitmap === 'undefined') throw new AslnutError('E-LOAD-001', 'images need a browser (createImageBitmap)', { where: key, fix: "load kind: 'bytes' in Node" });
      return createImageBitmap(new Blob([e.data], { type: e.type }), kind === 'imageRaw' ? { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } : {});
    }
    // raw RGBA, decoded in a worker (terrain-RGB): nothing of it runs on the main thread
    case 'pixels': return pixelsOf(new Blob([e.data], { type: e.type }));
    // an image's pixels as shown (imagery for WebGPU: uploaded with writeTexture, decoded in a worker)
    case 'imagePixels': return pixelsOf(new Blob([e.data], { type: e.type }), false);
  }
}
function sizeOf(kind: Kind, v: unknown, e: Entry): number {
  if (kind === 'image' || kind === 'imageRaw') { const b = v as ImageBitmap; return b.width * b.height * 4; }
  if (kind === 'pixels' || kind === 'imagePixels') return (v as Pixels).data.byteLength;
  if (kind === 'json') return e.data.byteLength * (/gzip/.test(e.type) ? 12 : 3);
  if (kind === 'text') return e.data.byteLength * 2;
  return e.data.byteLength;
}
async function readFileEntry(url: string, range: [number, number] | undefined, source: string): Promise<Entry | null> {
  interface FH { read(b: Uint8Array, o: number, l: number, p: number): Promise<{ bytesRead: number }>; close(): Promise<void> }
  const F = 'node:fs/promises', fs = await import(/* @vite-ignore */ F) as { readFile(p: string): Promise<Uint8Array>; open(p: string, f: string): Promise<FH> };
  const path = decodeURIComponent(url.replace(/^file:\/\//, ''));
  try {
    let b: Uint8Array;
    if (range) {
      const h = await fs.open(path, 'r');
      try { b = new Uint8Array(range[1]); const { bytesRead } = await h.read(b, 0, range[1], range[0]); if (!bytesRead) throw Object.assign(new AslnutError('E-LOAD-003', `the range starts at ${range[0]}, past the end`, { where: url }), { retry: false }); b = b.subarray(0, bytesRead); } finally { await h.close(); }
    } else b = await fs.readFile(path);
    return { status: 200, type: '', data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer, source, at: now() };
  } catch (e) {
    if ((e as { code?: string }).code === 'ENOENT') return { status: 404, type: '', data: new ArrayBuffer(0), source, at: now() };
    throw Object.assign(e as Error, { retry: false });
  }
}

export const loader = (o: LoaderOptions = {}): Loader => new Loader(o);
