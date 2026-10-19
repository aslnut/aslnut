// core › data › sources › pmtiles: PMTiles v3 (https://github.com/protomaps/PMTiles/blob/main/spec/v3/spec.md), one
// file per tileset with a Hilbert-ordered directory, read by byte ranges from any static host, CDN or S3. Pure
// functions, the same in Node, a browser and a server sandbox; compression is passed in (zlib in Node,
// DecompressionStream in a browser). The writer is what tools/bake uses; the reader is what data.pmtiles() uses.

export const Compression = { Unknown: 0, None: 1, Gzip: 2, Brotli: 3, Zstd: 4 } as const;
export type Compression = (typeof Compression)[keyof typeof Compression];
export const TileType = { Unknown: 0, Mvt: 1, Png: 2, Jpeg: 3, Webp: 4, Avif: 5 } as const;
export type TileType = (typeof TileType)[keyof typeof TileType];

export interface Header {
  rootOffset: number; rootLength: number; metadataOffset: number; metadataLength: number;
  leafOffset: number; leafLength: number; dataOffset: number; dataLength: number;
  addressed: number; entries: number; contents: number; clustered: boolean;
  internalCompression: Compression; tileCompression: Compression; tileType: TileType;
  minZoom: number; maxZoom: number; bounds: [number, number, number, number]; center: [number, number, number];
}
export interface Entry { tileId: number; offset: number; length: number; runLength: number }

const HEADER = 127, ROOT_MAX = 16384;

// ── tile ids: z, then the Hilbert curve inside the level ───────────────────────────────────────────────────────
const base = (z: number) => (4 ** z - 1) / 3;
export function tileId(z: number, x: number, y: number): number {
  const n = 2 ** z; let d = 0, tx = x, ty = y;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (tx & s) > 0 ? 1 : 0, ry = (ty & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) { if (rx === 1) { tx = n - 1 - tx; ty = n - 1 - ty; } const t = tx; tx = ty; ty = t; }
  }
  return base(z) + d;
}
export function zxyOf(id: number): [number, number, number] {
  let z = 0; while (base(z + 1) <= id) z++;
  let t = id - base(z), x = 0, y = 0;
  for (let s = 1; s < 2 ** z; s *= 2) {
    const rx = Math.floor(t / 2) % 2, ry = (t % 2) ^ rx;
    if (ry === 0) { if (rx === 1) { x = s - 1 - x; y = s - 1 - y; } const k = x; x = y; y = k; }
    x += s * rx; y += s * ry; t = Math.floor(t / 4);
  }
  return [z, x, y];
}

// ── varints (numbers up to 2^53: arithmetic, not bit shifts) ────────────────────────────────────────────────────
function putVarint(out: number[], v: number): void { while (v >= 128) { out.push((v % 128) | 128); v = Math.floor(v / 128); } out.push(v); }
function getVarint(b: Uint8Array, p: { i: number }): number {
  let v = 0, m = 1;
  for (;;) { const c = b[p.i++]!; v += (c & 127) * m; if (c < 128) return v; m *= 128; }
}

export function encodeDirectory(entries: Entry[]): Uint8Array {
  const o: number[] = [];
  putVarint(o, entries.length);
  let last = 0; for (const e of entries) { putVarint(o, e.tileId - last); last = e.tileId; }
  for (const e of entries) putVarint(o, e.runLength);
  for (const e of entries) putVarint(o, e.length);
  entries.forEach((e, i) => putVarint(o, i > 0 && e.offset === entries[i - 1]!.offset + entries[i - 1]!.length ? 0 : e.offset + 1));
  return Uint8Array.from(o);
}
export function decodeDirectory(b: Uint8Array): Entry[] {
  const p = { i: 0 }, n = getVarint(b, p), es: Entry[] = [];
  let last = 0; for (let k = 0; k < n; k++) { last += getVarint(b, p); es.push({ tileId: last, offset: 0, length: 0, runLength: 0 }); }
  for (const e of es) e.runLength = getVarint(b, p);
  for (const e of es) e.length = getVarint(b, p);
  es.forEach((e, k) => { const v = getVarint(b, p); e.offset = v === 0 && k > 0 ? es[k - 1]!.offset + es[k - 1]!.length : v - 1; });
  return es;
}

// ── the header (little-endian; 64-bit fields as doubles: fine below 2^53) ───────────────────────────────────────
export function encodeHeader(h: Header): Uint8Array {
  const b = new Uint8Array(HEADER), v = new DataView(b.buffer);
  b.set([0x50, 0x4d, 0x54, 0x69, 0x6c, 0x65, 0x73, 3]);   // "PMTiles" v3
  const u64 = (o: number, x: number) => { v.setUint32(o, x % 2 ** 32, true); v.setUint32(o + 4, Math.floor(x / 2 ** 32), true); };
  [h.rootOffset, h.rootLength, h.metadataOffset, h.metadataLength, h.leafOffset, h.leafLength, h.dataOffset, h.dataLength, h.addressed, h.entries, h.contents].forEach((x, i) => u64(8 + i * 8, x));
  b[96] = h.clustered ? 1 : 0; b[97] = h.internalCompression; b[98] = h.tileCompression; b[99] = h.tileType; b[100] = h.minZoom; b[101] = h.maxZoom;
  const e7 = (o: number, x: number) => v.setInt32(o, Math.round(x * 1e7), true);
  e7(102, h.bounds[0]); e7(106, h.bounds[1]); e7(110, h.bounds[2]); e7(114, h.bounds[3]);
  b[118] = h.center[2]; e7(119, h.center[0]); e7(123, h.center[1]);
  return b;
}
export function decodeHeader(b: Uint8Array): Header {
  if (b[0] !== 0x50 || b[1] !== 0x4d || b[7] !== 3) throw new Error('not a PMTiles v3 archive');
  const v = new DataView(b.buffer, b.byteOffset, HEADER), u64 = (o: number) => v.getUint32(o, true) + v.getUint32(o + 4, true) * 2 ** 32, e7 = (o: number) => v.getInt32(o, true) / 1e7;
  const n = Array.from({ length: 11 }, (_, i) => u64(8 + i * 8));
  return {
    rootOffset: n[0]!, rootLength: n[1]!, metadataOffset: n[2]!, metadataLength: n[3]!, leafOffset: n[4]!, leafLength: n[5]!, dataOffset: n[6]!, dataLength: n[7]!,
    addressed: n[8]!, entries: n[9]!, contents: n[10]!, clustered: b[96] === 1, internalCompression: b[97] as Compression, tileCompression: b[98] as Compression, tileType: b[99] as TileType,
    minZoom: b[100]!, maxZoom: b[101]!, bounds: [e7(102), e7(106), e7(110), e7(114)], center: [e7(119), e7(123), b[118]!],
  };
}

export type Codec = (b: Uint8Array, c: Compression) => Uint8Array | Promise<Uint8Array>;

// ── writing: collect tiles, then one archive ────────────────────────────────────────────────────────────────────
export interface WriterOptions { tileType: TileType; tileCompression: Compression; metadata: Record<string, unknown>; bounds?: [number, number, number, number]; center?: [number, number, number] }
/** tiles are given already compressed (`tileCompression`); identical tiles are stored once, runs of them as one entry */
export class PMTilesWriter {
  private tiles = new Map<number, Uint8Array>(); private minZ = 99; private maxZ = 0; private o: WriterOptions;
  constructor(o: WriterOptions) { this.o = o; }
  add(z: number, x: number, y: number, bytes: Uint8Array): void { this.tiles.set(tileId(z, x, y), bytes); this.minZ = Math.min(this.minZ, z); this.maxZ = Math.max(this.maxZ, z); }
  get size(): number { return this.tiles.size; }
  /** the archive's bytes; `gzip` compresses the directories and the metadata */
  async finish(gzip: (b: Uint8Array) => Uint8Array | Promise<Uint8Array>): Promise<Uint8Array> {
    const ids = [...this.tiles.keys()].sort((a, b) => a - b), seen = new Map<string, Entry>(), chunks: Uint8Array[] = [], entries: Entry[] = [];
    let off = 0, contents = 0;
    for (const id of ids) {
      const t = this.tiles.get(id)!, key = hash(t), last = entries[entries.length - 1];
      const same = seen.get(key);
      if (same && last && last.offset === same.offset && last.tileId + last.runLength === id) { last.runLength++; continue; }
      if (same) { entries.push({ tileId: id, offset: same.offset, length: same.length, runLength: 1 }); continue; }
      const e = { tileId: id, offset: off, length: t.length, runLength: 1 };
      seen.set(key, e); entries.push(e); chunks.push(t); off += t.length; contents++;
    }
    // the root directory must fit in the first 16 KB; else leaves
    let root: Uint8Array = await gzip(encodeDirectory(entries)), leaves: Uint8Array = new Uint8Array(0);
    for (let leafSize = 4096; HEADER + root.length > ROOT_MAX; leafSize *= 2) {
      const rootEntries: Entry[] = [], parts: Uint8Array[] = []; let lo = 0;
      for (let i = 0; i < entries.length; i += leafSize) {
        const leaf = await gzip(encodeDirectory(entries.slice(i, i + leafSize)));
        rootEntries.push({ tileId: entries[i]!.tileId, offset: lo, length: leaf.length, runLength: 0 }); parts.push(leaf); lo += leaf.length;
      }
      root = await gzip(encodeDirectory(rootEntries)); leaves = concat(parts);
    }
    const meta = await gzip(new TextEncoder().encode(JSON.stringify(this.o.metadata))), data = concat(chunks);
    const h: Header = {
      rootOffset: HEADER, rootLength: root.length, metadataOffset: HEADER + root.length, metadataLength: meta.length,
      leafOffset: HEADER + root.length + meta.length, leafLength: leaves.length, dataOffset: HEADER + root.length + meta.length + leaves.length, dataLength: data.length,
      addressed: ids.length, entries: entries.length, contents, clustered: true, internalCompression: Compression.Gzip, tileCompression: this.o.tileCompression, tileType: this.o.tileType,
      minZoom: this.minZ === 99 ? 0 : this.minZ, maxZoom: this.maxZ, bounds: this.o.bounds ?? [-180, -85.05, 180, 85.05], center: this.o.center ?? [0, 0, 0],
    };
    return concat([encodeHeader(h), root, meta, leaves, data]);
  }
}

// ── reading by ranges ───────────────────────────────────────────────────────────────────────────────────────────
export type RangeFetch = (offset: number, length: number) => Promise<Uint8Array>;
export class PMTilesReader {
  header!: Header; metadata: Record<string, unknown> = {};
  private root!: Entry[]; private leaves = new Map<number, Promise<Entry[]>>(); private fetch: RangeFetch; private codec: Codec;
  constructor(fetch: RangeFetch, codec: Codec) { this.fetch = fetch; this.codec = codec; }
  async open(): Promise<this> {
    const b = await this.fetch(0, ROOT_MAX);
    this.header = decodeHeader(b);
    const h = this.header, slice = (o: number, l: number) => (o + l <= b.length ? Promise.resolve(b.subarray(o, o + l)) : this.fetch(o, l));
    this.root = decodeDirectory(await this.codec(await slice(h.rootOffset, h.rootLength), h.internalCompression));
    if (h.metadataLength) this.metadata = JSON.parse(new TextDecoder().decode(await this.codec(await slice(h.metadataOffset, h.metadataLength), h.internalCompression)));
    return this;
  }
  /** the tile's stored bytes (still `tileCompression`), or null */
  async tile(z: number, x: number, y: number): Promise<Uint8Array | null> {
    const id = tileId(z, x, y), h = this.header;
    let dir = this.root;
    for (let depth = 0; depth < 4; depth++) {
      const e = find(dir, id); if (!e) return null;
      if (e.runLength > 0) return this.fetch(h.dataOffset + e.offset, e.length);
      let leaf = this.leaves.get(e.offset);
      if (!leaf) { leaf = this.fetch(h.leafOffset + e.offset, e.length).then(async (b) => decodeDirectory(await this.codec(b, h.internalCompression))); this.leaves.set(e.offset, leaf); }
      dir = await leaf;
    }
    return null;
  }
}
function find(es: Entry[], id: number): Entry | null {
  let lo = 0, hi = es.length - 1;
  while (lo <= hi) { const m = (lo + hi) >> 1, c = id - es[m]!.tileId; if (c > 0) lo = m + 1; else if (c < 0) hi = m - 1; else return es[m]!; }
  if (hi >= 0) { const e = es[hi]!; if (e.runLength === 0) return e; if (id - e.tileId < e.runLength) return e; }   // a leaf, or inside a run
  return null;
}

function concat(parts: Uint8Array[]): Uint8Array { const n = parts.reduce((a, p) => a + p.length, 0), o = new Uint8Array(n); let i = 0; for (const p of parts) { o.set(p, i); i += p.length; } return o; }
/** FNV-1a over the bytes and the length: enough to find identical tiles (sea, empty) */
function hash(b: Uint8Array): string { let h = 2166136261; for (let i = 0; i < b.length; i++) h = Math.imul(h ^ b[i]!, 16777619); return `${h >>> 0}:${b.length}`; }
