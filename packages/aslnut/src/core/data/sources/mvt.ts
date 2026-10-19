// core › data › sources › mvt: Mapbox Vector Tiles (https://github.com/mapbox/vector-tile-spec) read into features in
// longitude / latitude, and written (tools/bake). Polygons and lines are cut to the tile's own square on reading, so
// neighbouring tiles meet without overlap; the edges made by that cut are marked (`cuts`) so outlines skip them.
//   decodeMVT(bytes, { z, x, y }) → { [layer]: Feature[] }
import { AslnutError } from '../../world/errors.ts';
import type { Feature, Geometry, Position, Props } from '../features.ts';

// ── protobuf, the little that MVT needs ──────────────────────────────────────────────────────────────────────────
class Reader {
  i = 0; readonly b: Uint8Array; private end: number;
  constructor(b: Uint8Array, end = b.length) { this.b = b; this.end = end; }
  get more(): boolean { return this.i < this.end; }
  varint(): number { let v = 0, m = 1, c: number; do { c = this.b[this.i++]!; v += (c & 127) * m; m *= 128; } while (c >= 128); return v; }
  svarint(): number { const v = this.varint(); return v % 2 === 1 ? (v + 1) / -2 : v / 2; }
  bytes(): Uint8Array { const n = this.varint(), s = this.b.subarray(this.i, this.i + n); this.i += n; return s; }
  sub(): Reader { const n = this.varint(), r = new Reader(this.b, this.i + n); r.i = this.i; this.i += n; return r; }
  skip(wire: number): void { if (wire === 0) this.varint(); else if (wire === 1) this.i += 8; else if (wire === 2) this.i += this.varint(); else if (wire === 5) this.i += 4; else throw new Error(`protobuf wire type ${wire}`); }
  f32(): number { const v = new DataView(this.b.buffer, this.b.byteOffset + this.i, 4).getFloat32(0, true); this.i += 4; return v; }
  f64(): number { const v = new DataView(this.b.buffer, this.b.byteOffset + this.i, 8).getFloat64(0, true); this.i += 8; return v; }
}
const dec = new TextDecoder();
class Writer {
  private out: number[] = [];
  varint(v: number): this { v = Math.floor(v); while (v >= 128) { this.out.push((v % 128) | 128); v = Math.floor(v / 128); } this.out.push(v); return this; }
  tag(field: number, wire: number): this { return this.varint(field * 8 + wire); }
  bytes(field: number, b: Uint8Array): this { this.tag(field, 2).varint(b.length); for (const x of b) this.out.push(x); return this; }
  string(field: number, s: string): this { return this.bytes(field, new TextEncoder().encode(s)); }
  packed(field: number, vs: number[]): this { const w = new Writer(); for (const v of vs) w.varint(v); return this.bytes(field, w.finish()); }
  f64(field: number, v: number): this { this.tag(field, 1); const b = new Uint8Array(8); new DataView(b.buffer).setFloat64(0, v, true); for (const x of b) this.out.push(x); return this; }
  finish(): Uint8Array { return Uint8Array.from(this.out); }
}
const zig = (n: number) => (n < 0 ? -2 * n - 1 : 2 * n);

// ── reading ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TileXYZ { z: number; x: number; y: number }
export interface DecodeOptions {
  /** which layers (default all) */
  layers?: string[];
  /** an id from a prop instead of the tile's feature id */
  idProp?: string;
}
type Ring = { pts: [number, number][]; cut: number[] };

/** the features of a tile, per layer, in lon / lat */
export function decodeMVT(bytes: Uint8Array, t: TileXYZ, o: DecodeOptions = {}): Record<string, Feature[]> {
  const r = new Reader(bytes), out: Record<string, Feature[]> = {};
  try {
    while (r.more) {
      const tag = r.varint();
      if (tag >> 3 === 3 && (tag & 7) === 2) { const l = layer(r.sub(), t, o); if (l && (!o.layers || o.layers.includes(l.name))) (out[l.name] ??= []).push(...l.features); }
      else r.skip(tag & 7);
    }
  } catch (e) { throw new AslnutError('E-DATA-002', `tile ${t.z}/${t.x}/${t.y} is not a vector tile: ${(e as Error).message}`, { fix: 'check the archive holds MVT tiles (and how they are compressed)' }); }
  return out;
}
function layer(r: Reader, t: TileXYZ, o: DecodeOptions): { name: string; features: Feature[] } | null {
  let name = '', extent = 4096;
  const keys: string[] = [], values: unknown[] = [], raws: Reader[] = [];
  while (r.more) {
    const tag = r.varint(), f = tag >> 3;
    if (f === 1) name = dec.decode(r.bytes());
    else if (f === 2) raws.push(r.sub());
    else if (f === 3) keys.push(dec.decode(r.bytes()));
    else if (f === 4) values.push(value(r.sub()));
    else if (f === 5) extent = r.varint();
    else r.skip(tag & 7);
  }
  if (o.layers && !o.layers.includes(name)) return { name, features: [] };
  const features: Feature[] = [];
  for (const fr of raws) {
    let id: number | undefined, type = 0, tags: number[] = [], geom: number[] = [];
    while (fr.more) {
      const tag = fr.varint(), f = tag >> 3;
      if (f === 1) id = fr.varint();
      else if (f === 2) { const p = fr.sub(); while (p.more) tags.push(p.varint()); }
      else if (f === 3) type = fr.varint();
      else if (f === 4) { const p = fr.sub(); while (p.more) geom.push(p.varint()); }
      else fr.skip(tag & 7);
    }
    const props: Props = {};
    for (let k = 0; k + 1 < tags.length; k += 2) props[keys[tags[k]!]!] = values[tags[k + 1]!];
    const g = geometry(type, geom, extent, t);
    if (!g) continue;
    const fid = o.idProp !== undefined ? props[o.idProp] : id;
    features.push({ id: (typeof fid === 'string' || typeof fid === 'number') ? fid : `${t.z}/${t.x}/${t.y}#${features.length}`, props, geometry: g.geometry, cuts: g.cuts });
  }
  return { name, features };
}
function value(r: Reader): unknown {
  let v: unknown = null;
  while (r.more) {
    const tag = r.varint(), f = tag >> 3;
    if (f === 1) v = dec.decode(r.bytes()); else if (f === 2) v = r.f32(); else if (f === 3) v = r.f64();
    else if (f === 4 || f === 5) v = r.varint(); else if (f === 6) v = r.svarint(); else if (f === 7) v = r.varint() === 1; else r.skip(tag & 7);
  }
  return v;
}
function geometry(type: number, g: number[], E: number, t: TileXYZ): { geometry: Geometry; cuts?: Uint8Array[][] } | null {
  const parts: [number, number][][] = [];
  let x = 0, y = 0, cur: [number, number][] | null = null;
  for (let i = 0; i < g.length;) {
    const c = g[i++]!, id = c & 7, n = c >> 3;
    if (id === 7) { if (cur && cur.length) cur.push([cur[0]![0], cur[0]![1]]); continue; }
    for (let k = 0; k < n; k++) {
      x += zag(g[i++]!); y += zag(g[i++]!);
      if (id === 1) { cur = [[x, y]]; parts.push(cur); } else cur?.push([x, y]);
    }
  }
  const k = 2 ** t.z, ll = (p: [number, number]): Position => {
    const lon = ((t.x + p[0] / E) / k) * 360 - 180, m = Math.PI * (1 - (2 * (t.y + p[1] / E)) / k);
    return [lon, (2 * Math.atan(Math.exp(m)) - Math.PI / 2) * (180 / Math.PI)];
  };
  if (type === 1) {
    const pts = parts.flat().filter((p) => p[0] >= 0 && p[1] >= 0 && p[0] < E && p[1] < E).map(ll);
    if (!pts.length) return null;
    return { geometry: pts.length === 1 ? { type: 'Point', coordinates: pts[0]! } : { type: 'MultiPoint', coordinates: pts } };
  }
  if (type === 2) {
    const lines = parts.flatMap((l) => clipLine(l, E)).filter((l) => l.length > 1).map((l) => l.map(ll));
    if (!lines.length) return null;
    return { geometry: lines.length === 1 ? { type: 'LineString', coordinates: lines[0]! } : { type: 'MultiLineString', coordinates: lines } };
  }
  if (type === 3) {
    // rings: positive area (in tile coordinates, y down) starts a polygon; negative ones are its holes
    const polys: Ring[][] = [];
    for (const ring of parts) {
      if (ring.length < 4) continue;
      const c = clipRing(ring, E); if (c.pts.length < 4) continue;
      if (area(ring) > 0 || !polys.length) polys.push([c]); else polys[polys.length - 1]!.push(c);
    }
    if (!polys.length) return null;
    const coords = polys.map((p) => p.map((r) => r.pts.map(ll)));
    const cuts = polys.map((p) => p.map((r) => Uint8Array.from(r.cut)));
    return { geometry: coords.length === 1 ? { type: 'Polygon', coordinates: coords[0]! } : { type: 'MultiPolygon', coordinates: coords }, cuts };
  }
  return null;
}
const zag = (n: number) => (n % 2 === 1 ? (n + 1) / -2 : n / 2);
const area = (r: [number, number][]) => { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += r[j]![0] * r[i]![1] - r[i]![0] * r[j]![1]; return a; };
/** a closed ring cut to the square [0, E]² (Sutherland–Hodgman); edges lying on the square's sides are cuts */
export function clipRing(ring: [number, number][], E: number): Ring {
  let pts = ring.slice(0, -1);
  const sides: [(p: [number, number]) => boolean, (a: [number, number], b: [number, number]) => [number, number]][] = [
    [(p) => p[0] >= 0, (a, b) => [0, a[1] + ((b[1] - a[1]) * (0 - a[0])) / (b[0] - a[0])]],
    [(p) => p[0] <= E, (a, b) => [E, a[1] + ((b[1] - a[1]) * (E - a[0])) / (b[0] - a[0])]],
    [(p) => p[1] >= 0, (a, b) => [a[0] + ((b[0] - a[0]) * (0 - a[1])) / (b[1] - a[1]), 0]],
    [(p) => p[1] <= E, (a, b) => [a[0] + ((b[0] - a[0]) * (E - a[1])) / (b[1] - a[1]), E]],
  ];
  for (const [inside, cut] of sides) {
    if (!pts.length) break;
    const next: [number, number][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[(i + pts.length - 1) % pts.length]!, b = pts[i]!;
      if (inside(b)) { if (!inside(a)) next.push(cut(a, b)); next.push(b); } else if (inside(a)) next.push(cut(a, b));
    }
    pts = next;
  }
  if (pts.length < 3) return { pts: [], cut: [] };
  pts.push([pts[0]![0], pts[0]![1]]);
  const on = (p: [number, number]) => (p[0] <= 0 ? 1 : 0) | (p[0] >= E ? 2 : 0) | (p[1] <= 0 ? 4 : 0) | (p[1] >= E ? 8 : 0);
  const cut: number[] = [];
  for (let i = 0; i + 1 < pts.length; i++) cut.push(on(pts[i]!) & on(pts[i + 1]!) ? 1 : 0);
  return { pts, cut };
}
/** a line cut to the square [0, E]² (pieces) */
function clipLine(l: [number, number][], E: number): [number, number][][] {
  const out: [number, number][][] = []; let cur: [number, number][] = [];
  const inB = (p: [number, number]) => p[0] >= 0 && p[0] <= E && p[1] >= 0 && p[1] <= E;
  for (let i = 0; i + 1 < l.length; i++) {
    const s = clipSegment(l[i]!, l[i + 1]!, E);
    if (!s) { if (cur.length) { out.push(cur); cur = []; } continue; }
    if (!cur.length || cur[cur.length - 1]![0] !== s[0][0] || cur[cur.length - 1]![1] !== s[0][1]) { if (cur.length) out.push(cur); cur = [s[0]]; }
    cur.push(s[1]);
    if (!inB(l[i + 1]!)) { out.push(cur); cur = []; }
  }
  if (cur.length) out.push(cur);
  return out;
}
function clipSegment(a: [number, number], b: [number, number], E: number): [[number, number], [number, number]] | null {
  // Liang–Barsky
  let t0 = 0, t1 = 1; const dx = b[0] - a[0], dy = b[1] - a[1];
  for (const [p, q] of [[-dx, a[0]], [dx, E - a[0]], [-dy, a[1]], [dy, E - a[1]]] as [number, number][]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const r = q / p; if (p < 0) { if (r > t1) return null; if (r > t0) t0 = r; } else { if (r < t0) return null; if (r < t1) t1 = r; }
  }
  return [[a[0] + t0 * dx, a[1] + t0 * dy], [a[0] + t1 * dx, a[1] + t1 * dy]];
}

// ── writing (tools/bake) ─────────────────────────────────────────────────────────────────────────────────────────
/** features (lon / lat) → one vector tile; polygons and lines cut to the tile's square plus `buffer` */
export function encodeMVT(layers: Record<string, Feature[]>, t: TileXYZ, o: { extent?: number; buffer?: number } = {}): Uint8Array {
  const E = o.extent ?? 4096, B = o.buffer ?? 64, k = 2 ** t.z, tile = new Writer();
  const px = (p: Position): [number, number] => {
    const m = Math.log(Math.tan(Math.PI / 4 + (Math.max(-85.0511, Math.min(85.0511, p[1])) * Math.PI) / 360));
    return [Math.round((((p[0] + 180) / 360) * k - t.x) * E), Math.round(((1 - m / Math.PI) / 2 * k - t.y) * E)];
  };
  for (const [name, feats] of Object.entries(layers)) {
    const L = new Writer(), keys = new Map<string, number>(), vals = new Map<string, number>(), valList: unknown[] = [];
    L.varint(15 * 8).varint(2).string(1, name);
    for (const f of feats) {
      const enc = geomOf(f.geometry, px, E, B); if (!enc) continue;
      const tags: number[] = [];
      for (const [kk, v] of Object.entries(f.props)) {
        if (v === null || v === undefined || typeof v === 'object') continue;
        if (!keys.has(kk)) keys.set(kk, keys.size);
        const vk = `${typeof v}:${String(v)}`;
        if (!vals.has(vk)) { vals.set(vk, valList.length); valList.push(v); }
        tags.push(keys.get(kk)!, vals.get(vk)!);
      }
      const F = new Writer();
      if (typeof f.id === 'number' && Number.isInteger(f.id) && f.id >= 0) F.tag(1, 0).varint(f.id);
      F.packed(2, tags).tag(3, 0).varint(enc.type).packed(4, enc.cmds);
      L.bytes(2, F.finish());
    }
    for (const kk of keys.keys()) L.string(3, kk);
    for (const v of valList) { const V = new Writer(); if (typeof v === 'string') V.string(1, v); else if (typeof v === 'boolean') V.tag(7, 0).varint(v ? 1 : 0); else if (Number.isInteger(v as number) && (v as number) >= 0) V.tag(5, 0).varint(v as number); else if (Number.isInteger(v as number)) V.tag(6, 0).varint(zig(v as number)); else V.f64(3, v as number); L.bytes(4, V.finish()); }
    L.tag(5, 0).varint(E);
    tile.bytes(3, L.finish());
  }
  return tile.finish();
}
function geomOf(g: Geometry | null, px: (p: Position) => [number, number], E: number, B: number): { type: number; cmds: number[] } | null {
  if (!g) return null;
  const cmds: number[] = []; let cx = 0, cy = 0;
  const move = (p: [number, number]) => { cmds.push((1 & 7) | (1 << 3), zig(p[0] - cx), zig(p[1] - cy)); cx = p[0]; cy = p[1]; };
  const lineTo = (ps: [number, number][]) => { if (!ps.length) return; cmds.push((2 & 7) | (ps.length << 3)); for (const p of ps) { cmds.push(zig(p[0] - cx), zig(p[1] - cy)); cx = p[0]; cy = p[1]; } };
  const shift = (r: [number, number][]) => r.map((p) => [p[0] + B, p[1] + B] as [number, number]);
  const back = (r: [number, number][]) => r.map((p) => [p[0] - B, p[1] - B] as [number, number]);
  const dedupe = (r: [number, number][]) => r.filter((p, i) => i === 0 || p[0] !== r[i - 1]![0] || p[1] !== r[i - 1]![1]);
  if (g.type === 'Point' || g.type === 'MultiPoint') {
    const pts = (g.type === 'Point' ? [g.coordinates] : g.coordinates).map(px).filter((p) => p[0] >= -B && p[1] >= -B && p[0] < E + B && p[1] < E + B);
    if (!pts.length) return null;
    cmds.push((1 & 7) | (pts.length << 3)); for (const p of pts) { cmds.push(zig(p[0] - cx), zig(p[1] - cy)); cx = p[0]; cy = p[1]; }
    return { type: 1, cmds };
  }
  if (g.type === 'LineString' || g.type === 'MultiLineString') {
    const ls = g.type === 'LineString' ? [g.coordinates] : g.coordinates;
    for (const l of ls) for (const piece of clipLine(shift(dedupe(l.map(px))), E + 2 * B)) { const p = dedupe(back(piece)); if (p.length < 2) continue; move(p[0]!); lineTo(p.slice(1)); }
    return cmds.length ? { type: 2, cmds } : null;
  }
  const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
  for (const poly of polys) poly.forEach((ring, ri) => {
    const c = clipRing(shift(dedupe(ring.map(px))), E + 2 * B); if (c.pts.length < 4) return;
    let r = dedupe(back(c.pts)).slice(0, -1); if (r.length < 3) return;
    // exterior rings positive (clockwise with y down), holes negative
    if ((area([...r, r[0]!]) > 0) !== (ri === 0)) r = r.reverse();
    move(r[0]!); lineTo(r.slice(1)); cmds.push((7 & 7) | (1 << 3));
  });
  return cmds.length ? { type: 3, cmds } : null;
}
