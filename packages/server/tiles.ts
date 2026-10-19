// Serve or bake. A tile comes from, in order: the memory cache (baked since the last edit there), the prebuilt
// archive (`<set>.pmtiles`, unless an edit made after it touches the tile), or the baker, now (then cached). A whole
// pyramid is baked into a new archive by a job; edits after it only rebake the tiles they touch.
import { existsSync, openSync, readSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { Compression, PMTilesReader, PMTilesWriter, TileType } from '../aslnut/src/core/data/sources/pmtiles.ts';
import { encodeMeshTile } from './mesh-tile.ts';
import { set, TILES, type LiveSet } from './sets.ts';

export const FORMAT = 'aslnut-mesh/1';
const codec = (b: Uint8Array, c: number) => (c === Compression.Gzip ? new Uint8Array(gunzipSync(b)) : b);

// ── tile maths (lon / lat ↔ tiles) ─────────────────────────────────────────────────────────────────────────────
const lonX = (lon: number, z: number) => Math.floor(((lon + 180) / 360) * 2 ** z);
const latY = (lat: number, z: number) => { const r = (Math.max(-85.0511, Math.min(85.0511, lat)) * Math.PI) / 180; return Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z); };
export function tilesIn(b: [number, number, number, number], z: number): [number, number][] {
  const n = 2 ** z, x0 = Math.max(0, lonX(b[0], z)), x1 = Math.min(n - 1, lonX(b[2], z)), y0 = Math.max(0, latY(b[3], z)), y1 = Math.min(n - 1, latY(b[1], z)), out: [number, number][] = [];
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push([x, y]);
  return out;
}
function touches(box: [number, number, number, number], z: number, x: number, y: number): boolean {
  return lonX(box[0], z) <= x && x <= lonX(box[2], z) && latY(box[3], z) <= y && y <= latY(box[1], z);
}

// ── archives ───────────────────────────────────────────────────────────────────────────────────────────────────
interface Archive { reader: PMTilesReader; edits: number; bytes: number; file: string }
const archives = new Map<string, Archive | null>();
export const archiveFile = (id: string) => join(TILES, `${id}.pmtiles`);
async function archive(id: string): Promise<Archive | null> {
  if (archives.has(id)) return archives.get(id)!;
  const file = archiveFile(id);
  let a: Archive | null = null;
  if (existsSync(file)) {
    const fd = openSync(file, 'r');
    const reader = await new PMTilesReader(async (o, l) => { const b = new Uint8Array(l); const n = readSync(fd, b, 0, l, o); return b.subarray(0, n); }, codec).open();
    a = { reader, edits: Number(reader.metadata.edits ?? 0), bytes: statSync(file).size, file };
  }
  archives.set(id, a);
  return a;
}

// ── the memory cache (LRU by insertion) ────────────────────────────────────────────────────────────────────────
const cache = new Map<string, { bytes: Uint8Array | null; v: number }>();
const KEEP = 6000;

export interface Served { bytes: Uint8Array | null; from: 'cache' | 'archive' | 'baked'; ms: number; v: number }
/** the newest edit version touching the tile (0: none) */
function lastEdit(s: LiveSet, z: number, x: number, y: number): number { let v = 0; for (const d of s.dirty) if (d.v > v && touches(d.box, z, x, y)) v = d.v; return v; }

export async function serve(id: string, z: number, x: number, y: number): Promise<Served | null> {
  const s = set(id); if (!s) return null;
  const t0 = performance.now(), key = `${id}/${z}/${x}/${y}`, edited = lastEdit(s, z, x, y);
  const c = cache.get(key);
  if (c && c.v >= edited) return { bytes: c.bytes, from: 'cache', ms: performance.now() - t0, v: c.v };
  const a = await archive(id);
  // the archive holds the tile as of its bake: good unless an edit made after it touches this tile
  if (a && !s.dirty.some((d, i) => i >= a.edits && touches(d.box, z, x, y)) && z >= a.reader.header.minZoom && z <= a.reader.header.maxZoom) {
    const bytes = await a.reader.tile(z, x, y);
    return { bytes, from: 'archive', ms: performance.now() - t0, v: edited };
  }
  const m = s.baker.tile(z, x, y), bytes = m ? new Uint8Array(gzipSync(encodeMeshTile(m), { level: 6 })) : null;
  cache.set(key, { bytes, v: s.version });
  if (cache.size > KEEP) cache.delete(cache.keys().next().value!);
  return { bytes, from: 'baked', ms: performance.now() - t0, v: s.version };
}

/** bake a pyramid into a new archive (written next to the old one, then swapped in) */
export async function bakeArchive(id: string, minZ: number, maxZ: number, progress: (done: number, total: number) => void = () => {}): Promise<{ file: string; tiles: number; bytes: number; ms: number }> {
  const s = set(id); if (!s) throw new Error(`no set ${id}`);
  const t0 = performance.now(), d = s.def, plan: [number, number, number][] = [];
  // the set's archive plan (levels and areas), cut to the levels asked for
  for (const r of d.archive ?? [{ minZoom: d.minZoom, maxZoom: d.maxZoom }])
    for (let z = Math.max(minZ, r.minZoom); z <= Math.min(maxZ, r.maxZoom); z++) for (const [x, y] of tilesIn(r.bounds ?? d.bounds, z)) plan.push([z, x, y]);
  const w = new PMTilesWriter({ tileType: TileType.Unknown, tileCompression: Compression.Gzip, bounds: d.bounds, center: d.center,
    metadata: { format: FORMAT, set: id, title: d.title, attribution: d.attribution, edits: s.edits.length, version: s.version, bakedAt: new Date().toISOString() } });
  let done = 0;
  for (const [z, x, y] of plan) {
    const m = s.baker.tile(z, x, y);
    if (m) w.add(z, x, y, new Uint8Array(gzipSync(encodeMeshTile(m), { level: 9 })));
    if (++done % 200 === 0) { progress(done, plan.length); await new Promise((r) => setImmediate(r)); }   // let requests through
  }
  const bytes = await w.finish((b) => new Uint8Array(gzipSync(b, { level: 9 })));
  const file = archiveFile(id), tmp = file + '.tmp';
  writeFileSync(tmp, bytes); renameSync(tmp, file);
  archives.delete(id);
  for (const k of [...cache.keys()]) if (k.startsWith(id + '/')) cache.delete(k);
  progress(plan.length, plan.length);
  return { file, tiles: w.size, bytes: bytes.length, ms: performance.now() - t0 };
}

export async function info(id: string) {
  const s = set(id); if (!s) return null;
  const a = await archive(id), d = s.def;
  return {
    id, title: d.title, attribution: d.attribution, format: FORMAT, minZoom: d.minZoom, maxZoom: d.maxZoom, bounds: d.bounds, center: d.center,
    version: s.version, edits: s.edits.length,
    archive: a ? { url: `/serve/tiles/${id}.pmtiles`, bytes: a.bytes, minZoom: a.reader.header.minZoom, maxZoom: a.reader.header.maxZoom, tiles: a.reader.header.addressed, edits: a.edits, bakedAt: a.reader.metadata.bakedAt, stale: s.edits.length > a.edits } : null,
    tiles: `/serve/tiles/${id}/{z}/{x}/{y}.mesh`,
  };
}
