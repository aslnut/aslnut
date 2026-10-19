// core › data › loading › pack: a read-only bundle answered before any cache: an exported scope in one file (a
// document's tiles and data, to ship with a demo or use offline). Packs from elsewhere are untrusted: the header,
// the index and every entry's bounds are checked before use.
//   file: "ASLNUTPK" · u32 index length · the index (JSON: version, scope, created, entries with offsets) · bodies
import { AslnutError } from '../../world/errors.ts';
import { checkScope, type Entry } from './stores.ts';

export interface Pack {
  readonly name: string;
  get(key: string): Promise<Entry | null>;
  has(key: string): Promise<boolean>;
  keys?(): string[];
}
interface IndexEntry { key: string; status: number; type: string; source: string; at: number; meta?: Record<string, string>; offset: number; length: number }
interface PackIndex { version: 1; scope: string; created: number; entries: IndexEntry[] }
const MAGIC = 'ASLNUTPK';
const bad = (why: string) => new AslnutError('E-LOAD-005', `not a valid aslnut pack: ${why}`, { fix: 'export the pack again with loader.export()' });

/** one file from a scope's entries */
export function writePack(scope: string, entries: { key: string; e: Entry }[]): Blob {
  let offset = 0;
  const index: PackIndex = { version: 1, scope: checkScope(scope), created: Date.now(), entries: entries.map(({ key, e }) => { const r = { key, status: e.status, type: e.type, source: e.source, at: e.at, ...(e.meta ? { meta: e.meta } : {}), offset, length: e.data.byteLength }; offset += e.data.byteLength; return r; }) };
  const ix = new TextEncoder().encode(JSON.stringify(index)), head = new Uint8Array(12);
  head.set(new TextEncoder().encode(MAGIC), 0); new DataView(head.buffer).setUint32(8, ix.byteLength, true);
  return new Blob([head, ix, ...entries.map(({ e }) => new Uint8Array(e.data))], { type: 'application/x-aslnut-pack' });
}

export class FilePack implements Pack {
  readonly name: string; readonly scope: string; readonly created: number;
  private ix = new Map<string, IndexEntry>(); private body: ArrayBuffer; private base: number;
  private constructor(name: string, index: PackIndex, buf: ArrayBuffer, base: number) {
    this.name = name; this.scope = index.scope; this.created = index.created; this.body = buf; this.base = base;
    for (const e of index.entries) this.ix.set(e.key, e);
  }
  static async read(blob: Blob | ArrayBuffer, name?: string): Promise<FilePack> {
    const buf = blob instanceof ArrayBuffer ? blob : await blob.arrayBuffer();
    if (buf.byteLength < 12 || new TextDecoder().decode(new Uint8Array(buf, 0, 8)) !== MAGIC) throw bad('the header is missing');
    const n = new DataView(buf, 8, 4).getUint32(0, true);
    if (12 + n > buf.byteLength) throw bad('the index runs past the end of the file');
    let index: PackIndex;
    try { index = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, n))) as PackIndex; } catch { throw bad('the index is not JSON'); }
    if (index.version !== 1 || !Array.isArray(index.entries)) throw bad(`unknown version ${String(index.version)}`);
    checkScope(index.scope);
    const room = buf.byteLength - 12 - n;
    for (const e of index.entries) {
      if (typeof e.key !== 'string' || !Number.isInteger(e.offset) || !Number.isInteger(e.length) || e.offset < 0 || e.length < 0 || e.offset + e.length > room) throw bad(`entry ${JSON.stringify(e.key)} is out of bounds`);
    }
    return new FilePack(name ?? index.scope, index, buf, 12 + n);
  }
  entries(): { key: string; e: Entry }[] { return [...this.ix.keys()].map((k) => ({ key: k, e: this.entry(this.ix.get(k)!) })); }
  private entry(r: IndexEntry): Entry { return { status: r.status, type: r.type, source: r.source, at: r.at, meta: r.meta, data: this.body.slice(this.base + r.offset, this.base + r.offset + r.length) }; }
  async get(key: string): Promise<Entry | null> { const r = this.ix.get(key); return r ? this.entry(r) : null; }
  async has(key: string): Promise<boolean> { return this.ix.has(key); }
  keys(): string[] { return [...this.ix.keys()]; }
  get bytes(): number { return this.body.byteLength - this.base; }
}
