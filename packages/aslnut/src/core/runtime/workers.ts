// core › runtime › workers: your heavy work off the main thread, so the frames keep coming. A worker lane is a few
// workers running your module; call a function of it by name and get a promise; typed arrays in the answer move
// across without a copy. Where workers cannot run (or your module fails to load), your fallback functions run here.
//   main:    const tiles = workers.worker(() => new Worker(new URL('./tiles.worker.ts', import.meta.url), { type: 'module' }), { fallback: { build } })
//            const out = await tiles.call('build', tile, place)        (tiles.callIn(0, 'clamp', job): in that worker, its cache there)
//   worker:  workers.serve({ build(tile, place) { …; return { mesh } } })
import { AslnutError } from '../world/errors.ts';

export interface WorkerLane {
  /** run your module's function `name` with these arguments (structured-cloned) in the least busy worker */
  call<T = unknown>(name: string, ...args: unknown[]): Promise<T>;
  /** the same in one worker of the lane (`at`, counted round its size): what your module keeps between calls (a cache
   *  of big data) is kept once, in that worker, and asked there */
  callIn<T = unknown>(at: number, name: string, ...args: unknown[]): Promise<T>;
  /** workers running (0: the fallback runs on the main thread) */
  readonly size: number;
  /** calls waiting or running */
  readonly busy: number;
  terminate(): void;
}
export interface WorkerOptions {
  /** workers (default: the cores less two, 1 … 4) */
  count?: number;
  /** move the answers' typed arrays instead of copying them (default true) */
  transfer?: boolean;
  /** the same functions on the main thread, where workers cannot run */
  fallback?: Record<string, (...args: never[]) => unknown>;
}
type Msg = { id: number; name: string; args: unknown[] };
type Ans = { id: number; ok: boolean; value?: unknown; error?: string };

/** a lane of workers running your module: a URL (a module worker), or a function making one (bundlers need
 *  `new Worker(new URL('./x.ts', import.meta.url), { type: 'module' })` written in your code) */
export function worker(module: URL | string | (() => Worker), o: WorkerOptions = {}): WorkerLane {
  const n = Math.max(1, Math.min(4, o.count ?? Math.max(1, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 2)));
  const pool: { w: Worker; busy: number }[] = [];
  const waiting = new Map<number, { ok: (v: unknown) => void; bad: (e: unknown) => void; at: number }>();
  let seq = 0, broken = typeof Worker === 'undefined';
  const fail = (why: string) => { broken = true; for (const [id, r] of waiting) { waiting.delete(id); r.bad(new AslnutError('E-LANE-001', `the worker lane stopped: ${why}`, { fix: 'check the worker module loads (its imports must not touch the page)' })); } for (const p of pool) p.w.terminate(); pool.length = 0; };
  if (!broken) {
    try {
      for (let i = 0; i < n; i++) {
        const w = typeof module === 'function' ? module() : new Worker(module, { type: 'module' });
        const slot = { w, busy: 0 };
        w.onmessage = (e: MessageEvent<Ans>) => { const r = waiting.get(e.data.id); if (!r) return; waiting.delete(e.data.id); slot.busy--; if (e.data.ok) r.ok(e.data.value); else r.bad(new AslnutError('E-LANE-002', `a worker's call failed: ${e.data.error}`, { fix: 'the error is from your worker function' })); };
        w.onerror = (e) => { e.preventDefault?.(); fail(e.message || 'the worker failed to start'); };
        pool.push(slot);
      }
    } catch (e) { fail(String((e as Error)?.message ?? e)); }
  }
  const here = async (name: string, args: unknown[]) => {
    const f = o.fallback?.[name];
    if (!f) throw new AslnutError('E-LANE-001', `no worker to run '${name}' and no fallback for it`, { fix: `workers.worker(module, { fallback: { ${name} } })` });
    return (f as (...a: unknown[]) => unknown)(...args);
  };
  const send = <T,>(at: number | null, name: string, args: unknown[]): Promise<T> => {
    if (broken || !pool.length) return here(name, args) as Promise<T>;
    const slot = at === null ? pool.reduce((a, b) => (b.busy < a.busy ? b : a)) : pool[((at % pool.length) + pool.length) % pool.length]!, id = ++seq;
    slot.busy++;
    return new Promise<T>((ok, bad) => {
      waiting.set(id, { ok: ok as (v: unknown) => void, bad, at: performance.now() });
      slot.w.postMessage({ id, name, args } satisfies Msg);
    }).catch((e) => { if (broken && o.fallback?.[name]) return here(name, args) as Promise<T>; throw e; });
  };
  return {
    call<T>(name: string, ...args: unknown[]): Promise<T> { return send<T>(null, name, args); },
    callIn<T>(at: number, name: string, ...args: unknown[]): Promise<T> { return send<T>(at, name, args); },
    get size() { return broken ? 0 : pool.length; },
    get busy() { return waiting.size; },
    terminate() { fail('terminated'); },
  };
}
/** in your worker module: the functions it offers (their answers' typed arrays are moved, not copied) */
export function serve(fns: Record<string, (...args: never[]) => unknown>, o: { transfer?: boolean } = {}): void {
  const scope = globalThis as unknown as { onmessage: ((e: MessageEvent<Msg>) => void) | null; postMessage(m: unknown, t?: Transferable[]): void };
  scope.onmessage = async (e) => {
    const { id, name, args } = e.data;
    try {
      const f = fns[name]; if (!f) throw new Error(`no function '${name}' (there are ${Object.keys(fns).join(', ')})`);
      const value = await (f as (...a: unknown[]) => unknown)(...args);
      scope.postMessage({ id, ok: true, value } satisfies Ans, o.transfer === false ? [] : buffersOf(value));
    } catch (err) { scope.postMessage({ id, ok: false, error: String((err as Error)?.stack ?? err) } satisfies Ans); }
  };
}
/** the distinct ArrayBuffers of the typed arrays in a value (to move) */
function buffersOf(v: unknown, out = new Set<ArrayBuffer>(), depth = 0): ArrayBuffer[] {
  if (depth > 6 || v === null || typeof v !== 'object') return [...out];
  if (ArrayBuffer.isView(v)) { if (v.buffer instanceof ArrayBuffer) out.add(v.buffer); return [...out]; }
  if (Array.isArray(v)) { for (const x of v) buffersOf(x, out, depth + 1); return [...out]; }
  for (const x of Object.values(v as Record<string, unknown>)) buffersOf(x, out, depth + 1);
  return [...out];
}
export const workers = { worker, serve };
