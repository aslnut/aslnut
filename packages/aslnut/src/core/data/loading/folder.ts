// core › data › loading › folder: a folder per scope (Node only; its own entry point, `aslnut/core/data/loading/folder`,
// so a browser bundle never sees node:fs). Scope names are checked (no '.', '..', slashes), and every path is
// resolved and checked to stay inside the root before anything is read, written or deleted.
//   loader({ store: new FolderStore('/var/cache/aslnut') })
import { mkdir, readdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, sep } from 'node:path';
import { AslnutError } from '../../world/errors.ts';
import { blankInfo, checkScope, type Entry, type ScopeInfo, type Store } from './stores.ts';

export class FolderStore implements Store {
  readonly kind = 'folder' as const;
  readonly root: string;
  constructor(dir: string) { this.root = resolve(dir); }
  /** the scope's folder, proven to be inside the root */
  private dir(scope: string): string {
    const d = resolve(this.root, checkScope(scope));
    if (!d.startsWith(this.root + sep)) throw new AslnutError('E-LOAD-004', `scope ${JSON.stringify(scope)} resolves outside the store`, { where: this.root, fix: 'use a plain scope name' });
    return d;
  }
  private file(scope: string, key: string): string { return `${this.dir(scope)}${sep}${createHash('sha1').update(key).digest('hex')}`; }
  async names(): Promise<string[]> {
    try { return (await readdir(this.root)).filter((n) => { try { checkScope(n); return true; } catch { return false; } }); } catch { return []; }
  }
  async get(scope: string, key: string): Promise<Entry | null> {
    const f = this.file(scope, key);
    try {
      const rec = JSON.parse(await readFile(f + '.json', 'utf8')) as Omit<Entry, 'data'> & { key: string };
      if (rec.key !== key) return null;   // a hash collision: not this entry
      const b = await readFile(f + '.bin');
      return { status: rec.status, type: rec.type, source: rec.source, at: rec.at, meta: rec.meta, data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer };
    } catch { return null; }
  }
  async has(scope: string, key: string): Promise<boolean> { try { await access(this.file(scope, key) + '.json'); return true; } catch { return false; } }
  async head(scope: string, key: string) {
    try { const r = JSON.parse(await readFile(this.file(scope, key) + '.json', 'utf8')) as { bytes: number; source: string; status: number }; return { bytes: r.bytes, source: r.source, status: r.status }; } catch { return null; }
  }
  async put(scope: string, key: string, e: Entry): Promise<void> {
    const f = this.file(scope, key), had = await this.has(scope, key);
    await mkdir(this.dir(scope), { recursive: true });
    await writeFile(f + '.bin', new Uint8Array(e.data));
    await writeFile(f + '.json', JSON.stringify({ key, status: e.status, type: e.type, source: e.source, at: e.at, meta: e.meta, bytes: e.data.byteLength }));
    const i = (await this.info(scope)) ?? blankInfo(scope);
    if (!had) { i.bytes += e.data.byteLength; i.items++; }
    i.at = Date.now(); await this.writeInfo(scope, i);
  }
  async keys(scope: string): Promise<string[]> {
    const d = this.dir(scope), out: string[] = [];
    let files: string[] = []; try { files = await readdir(d); } catch { return []; }
    for (const f of files) if (f.endsWith('.json') && f !== 'scope.json') out.push((JSON.parse(await readFile(`${d}${sep}${f}`, 'utf8')) as { key: string }).key);
    return out;
  }
  async info(scope: string): Promise<ScopeInfo | null> { try { return JSON.parse(await readFile(`${this.dir(scope)}${sep}scope.json`, 'utf8')) as ScopeInfo; } catch { return null; } }
  async setInfo(scope: string, patch: Partial<ScopeInfo>): Promise<void> { await this.writeInfo(scope, { ...((await this.info(scope)) ?? blankInfo(scope)), ...patch, name: scope }); }
  private async writeInfo(scope: string, i: ScopeInfo): Promise<void> { await mkdir(this.dir(scope), { recursive: true }); await writeFile(`${this.dir(scope)}${sep}scope.json`, JSON.stringify(i)); }
  async drop(scope: string): Promise<void> { await rm(this.dir(scope), { recursive: true, force: true }); }
}
