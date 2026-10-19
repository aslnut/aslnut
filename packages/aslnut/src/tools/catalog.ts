// tools › catalog: what a project has to make worlds with, as entries to list and search (by words, kind, tag,
// licence); the params of any of them as one controls schema (form: a shape's, a package's, an element's); and an
// asset's folder as one file and back (a pack: core › data › loading › pack), its code told apart from its data so
// whoever imports it can look before running it.
//   const cat = catalog(await (await fetch('/assets/catalog.json')).json()); cat.search({ kind: 'shape', tag: 'vehicle' })
//   form(pkg).controls · form(element).controls          (one schema: slider, stepper, number, dropdown, colour, switch, text, vector)
//   const file = packAsset({ 'shape.ts': src, 'shape.json': json }, { id: 'bin' }); const got = await unpackAsset(file)
//   got.trust === 'code' → show got.code's sources and got.licence, run them only once accepted
// An entry on disk is a folder: a shape package (shape.ts, shape.json, presets.json, kinematics.ts, states.ts, thumbs/,
// LICENCE: core › geometry › shapes › recipes › package) or an element (element.ts: its default export makes an
// Element, its params the world's ParamSpec; element.json: what it is, the same fields as shape.json).
import { AslnutError } from '../core/world/errors.ts';
import { FilePack, writePack } from '../core/data/loading/pack.ts';
import { checkScope, type Entry } from '../core/data/loading/stores.ts';
import type { PackageInfo } from '../core/geometry/shapes/package.ts';
export { form, type FormControl, type FormSource, type KnobSpec } from '../core/geometry/shapes/shape.ts';

/** what an entry is: a shape package, or an element (an effect, a mark of your own, a layer) */
export type AssetKind = 'shape' | 'element';
export const ASSET_KINDS: readonly AssetKind[] = ['shape', 'element'];
/** one entry of a project's catalog (catalog.json at its asset root) */
export interface CatalogEntry {
  id: string; kind: AssetKind; name: string;
  /** an SPDX id */
  licence: string;
  /** its folder, relative to the catalog */
  path: string;
  tags?: string[]; version?: string; author?: string; about?: string;
  /** a picture per preset (relative to its folder) */
  thumbs?: Record<string, string>;
  /** its presets by name (a shape package's variants) */
  presets?: string[];
}
/** catalog.json */
export interface CatalogFile { version: 1; entries: CatalogEntry[] }
/** what to find: words (in its id, name, about, tags: every word somewhere), a kind, a tag or tags (any of them), a
 *  licence or licences (any of them; SPDX ids, case ignored) */
export interface CatalogQuery { text?: string; kind?: AssetKind; tag?: string | string[]; licence?: string | string[] }

const bad = (why: string, fix: string, where?: string) => new AslnutError('E-DATA-001', why, { fix, ...(where ? { where } : {}) });
const SEGMENT = /^[A-Za-z0-9_][A-Za-z0-9._ -]{0,127}$/;
/** a path inside an asset or a catalog: relative, '/' between parts, no '..', no hidden or empty parts */
export function safePath(p: string): string {
  if (typeof p !== 'string' || !p || p.length > 512 || !p.split('/').every((s) => SEGMENT.test(s))) throw bad(`unsafe path ${JSON.stringify(p)} in an asset`, "relative paths of letters, digits, '.', '_', '-' and spaces, '/' between them (no '..', no leading '/' or '.')");
  return p;
}
const lower = (x: string | string[] | undefined) => (x === undefined ? null : (Array.isArray(x) ? x : [x]).map((s) => s.toLowerCase()));
function checkEntry(e: unknown, i: number): CatalogEntry {
  const o = e as Partial<CatalogEntry> | null, where = `entries[${i}]`;
  if (!o || typeof o !== 'object') throw bad(`catalog ${where} is not an object`, '{ id, kind, name, licence, path }', where);
  for (const k of ['id', 'name', 'licence', 'path'] as const) if (typeof o[k] !== 'string' || !o[k]) throw bad(`catalog ${where} needs '${k}' (a string)`, '{ id, kind, name, licence, path }', where);
  if (!ASSET_KINDS.includes(o.kind as AssetKind)) throw bad(`catalog ${where}: kind '${String(o.kind)}' is not one of ${ASSET_KINDS.join(', ')}`, "kind: 'shape' | 'element'", where);
  if (o.path !== '.') safePath(o.path!);
  if (o.tags !== undefined && !(Array.isArray(o.tags) && o.tags.every((t) => typeof t === 'string'))) throw bad(`catalog ${where}: tags must be strings`, "tags: ['vehicle']", where);
  return o as CatalogEntry;
}

/** a project's catalog: its entries, searched */
export class Catalog {
  readonly entries: readonly CatalogEntry[];
  constructor(entries: CatalogEntry[]) { this.entries = entries.map(checkEntry); }
  /** the entries found: by words, or by a query (every field given must hold) */
  search(q: string | CatalogQuery = {}): CatalogEntry[] {
    const Q: CatalogQuery = typeof q === 'string' ? { text: q } : q, words = (Q.text ?? '').toLowerCase().split(/\s+/).filter(Boolean), tags = lower(Q.tag), lic = lower(Q.licence);
    return this.entries.filter((e) => {
      if (Q.kind && e.kind !== Q.kind) return false;
      if (tags && !(e.tags ?? []).some((t) => tags.includes(t.toLowerCase()))) return false;
      if (lic && !lic.includes(e.licence.toLowerCase())) return false;
      const hay = [e.id, e.name, e.about ?? '', ...(e.tags ?? []), ...(e.presets ?? [])].join(' ').toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }
  /** one by id (the first of that id) */
  get(id: string): CatalogEntry | undefined { return this.entries.find((e) => e.id === id); }
  /** every tag and every licence used, sorted (an editor's filters) */
  tags(): string[] { return [...new Set(this.entries.flatMap((e) => e.tags ?? []))].sort(); }
  licences(): string[] { return [...new Set(this.entries.map((e) => e.licence))].sort(); }
  /** catalog.json, ordered by path (the same entries write the same file) */
  toJSON(): CatalogFile { return { version: 1, entries: [...this.entries].sort((a, b) => a.path.localeCompare(b.path)) }; }
}
/** a catalog from its entries, or from catalog.json (an object or its text); untrusted input is checked */
export function catalog(from: CatalogEntry[] | CatalogFile | string = []): Catalog {
  const f = typeof from === 'string' ? (() => { try { return JSON.parse(from) as CatalogFile; } catch { throw bad('catalog.json is not JSON', '{ "version": 1, "entries": [] }'); } })() : from;
  if (Array.isArray(f)) return new Catalog(f);
  if (!f || f.version !== 1 || !Array.isArray(f.entries)) throw bad(`catalog.json: unknown version ${JSON.stringify((f as { version?: unknown } | null)?.version)}`, '{ "version": 1, "entries": [] }');
  return new Catalog(f.entries);
}
/** an entry from what an asset says it is (shape.json, element.json), its kind and its folder */
export function entryOf(info: PackageInfo, o: { kind: AssetKind; path: string; presets?: string[] }): CatalogEntry {
  const e: CatalogEntry = { id: info.id, kind: o.kind, name: info.name, licence: info.licence, path: o.path };
  if (info.version) e.version = info.version;
  if (info.author) e.author = info.author;
  if (info.about) e.about = info.about;
  if (info.tags?.length) e.tags = [...info.tags];
  if (info.thumbs && Object.keys(info.thumbs).length) e.thumbs = { ...info.thumbs };
  if (o.presets?.length) e.presets = [...o.presets];
  return checkEntry(e, 0);
}

// ── an asset's folder as one file ─────────────────────────────────────────────────────────────────────────────────
/** files that run when imported: scripts (and modules, workers, pages, wasm) */
export const CODE_FILES = /\.(m?[jt]sx?|c[jt]s|wasm|html?)$/i;
const TYPES: Record<string, string> = { json: 'application/json', ts: 'text/typescript', tsx: 'text/typescript', js: 'text/javascript', mjs: 'text/javascript', glb: 'model/gltf-binary', gltf: 'model/gltf+json', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', svg: 'image/svg+xml', txt: 'text/plain', md: 'text/markdown', bin: 'application/octet-stream' };
/** a file's media type by its name (LICENCE and other bare names: text) */
export const typeOf = (path: string) => { const m = /\.([A-Za-z0-9]+)$/.exec(path); return m ? TYPES[m[1]!.toLowerCase()] ?? 'application/octet-stream' : 'text/plain'; };
const bytesOf = (x: Uint8Array | ArrayBuffer | string): Uint8Array => (typeof x === 'string' ? new TextEncoder().encode(x) : x instanceof Uint8Array ? x : new Uint8Array(x));
/** what an asset's files say it is: its kind (shape.ts / shape.json → shape; element.ts / element.json → element) */
export function kindOfFiles(paths: Iterable<string>): AssetKind | null {
  const names = new Set([...paths].map((p) => p.split('/').pop()!));
  return names.has('shape.ts') || names.has('shape.json') ? 'shape' : names.has('element.ts') || names.has('element.json') ? 'element' : null;
}
/** an asset's folder as one file: a pack (core › data › loading › pack) whose scope is its id and whose keys are its
 *  files' paths inside the folder */
export function packAsset(files: Record<string, Uint8Array | ArrayBuffer | string>, o: { id: string; kind?: AssetKind }): Blob {
  checkScope(o.id);
  const paths = Object.keys(files).sort(), kind = o.kind ?? kindOfFiles(paths);
  if (!paths.length) throw bad(`asset '${o.id}' has no files`, 'packAsset({ "shape.ts": …, "shape.json": … }, { id })', o.id);
  const at = Date.now();
  const entries = paths.map((p) => { const data = bytesOf(files[safePath(p)]!); const e: Entry = { status: 200, type: typeOf(p), source: 'catalog', at, data: data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer, ...(kind ? { meta: { kind } } : {}) }; return { key: p, e }; });
  return writePack(o.id, entries);
}
/** an asset read back from its file: its files, what it says it is, and whether running it means running its code */
export interface UnpackedAsset {
  id: string; kind: AssetKind | null; created: number;
  files: Record<string, Uint8Array>;
  /** shape.json or element.json, when it has one */
  info: PackageInfo | null;
  /** its licence: the SPDX id it names; and its LICENCE file's text */
  licence: string | null; licenceText: string | null;
  /** the files that run (scripts) and the rest (data: JSON, models, pictures) */
  code: string[]; data: string[];
  /** 'data': it imports as it is; 'code': its sources are shown and run only once accepted */
  trust: 'data' | 'code';
  /** a file's text */
  text(path: string): string;
}
/** an asset's file read back: the pack checked (its header, index and bounds), every path checked (relative, no '..'),
 *  its code told from its data. Packs from elsewhere are untrusted: nothing here runs anything */
export async function unpackAsset(file: Blob | ArrayBuffer, o: { code?: RegExp; maxBytes?: number; maxFiles?: number } = {}): Promise<UnpackedAsset> {
  const size = file instanceof ArrayBuffer ? file.byteLength : file.size, max = o.maxBytes ?? 64 * 2 ** 20;
  if (size > max) throw bad(`the asset's file is ${(size / 2 ** 20).toFixed(1)} MB, over ${(max / 2 ** 20).toFixed(0)} MB`, 'unpackAsset(file, { maxBytes })');
  const pack = await FilePack.read(file), keys = pack.keys();
  if (keys.length > (o.maxFiles ?? 512)) throw bad(`the asset has ${keys.length} files`, 'unpackAsset(file, { maxFiles })', pack.scope);
  const files: Record<string, Uint8Array> = {};
  for (const { key, e } of pack.entries()) files[safePath(key)] = new Uint8Array(e.data);
  const re = o.code ?? CODE_FILES, paths = Object.keys(files).sort(), code = paths.filter((p) => re.test(p)), data = paths.filter((p) => !re.test(p));
  const text = (p: string) => { const f = files[p]; if (!f) throw bad(`the asset has no file '${p}'`, `one of: ${paths.join(', ')}`, pack.scope); return new TextDecoder().decode(f); };
  const head = paths.find((p) => p === 'shape.json' || p === 'element.json');
  let info: PackageInfo | null = null;
  if (head) { try { info = JSON.parse(text(head)) as PackageInfo; } catch { throw bad(`the asset's ${head} is not JSON`, '{ "id", "name", "version", "licence" }', pack.scope); } }
  const lic = paths.find((p) => /^LICEN[CS]E(\.(txt|md))?$/i.test(p));
  return { id: pack.scope, kind: kindOfFiles(paths), created: pack.created, files, info, licence: typeof info?.licence === 'string' ? info.licence : null, licenceText: lic ? text(lic) : null, code, data, trust: code.length ? 'code' : 'data', text };
}
