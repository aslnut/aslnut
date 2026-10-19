// Mesh tiles: vector data made ready for the GPU ahead of time. Per web-map tile, each layer's polygons are
// simplified for the level (half a pixel), clipped to the tile, cut into a grid on the coarse levels (so triangles
// follow the globe's curve), triangulated, and stored with a feature index per vertex; outlines become line segments;
// a feature with a height gets walls and a roof (3D). The browser uploads the buffers and draws: no drawing per tile,
// and colours come from a feature table at run time (a restyle or a highlight is a table write, not a rebake).
// Pure functions (bytes out): the same in a bake script, a server, a browser worker or a host's own script.
import earcut from 'earcut';
import { MAX_LAT, mercY } from '../aslnut/src/core/space/geo.ts';

/** a feature as the baker takes it: lon / lat rings (flat [x, y, x, y, …]; polygons even-odd), its box and props */
export interface Outline { name: string; bbox: number[]; rings: number[][]; props?: Record<string, any> }

export interface MeshLayerInput {
  name: string; features: Outline[];
  /** metres to extrude a feature (0 / undefined: flat) */
  height?: (o: Outline) => number;
  /** fill the polygons (true) · keep their outlines as lines (true) */
  fill?: boolean; lines?: boolean;
  /** props kept in the tile (default: all) */
  keep?: string[];
  /** the levels this input is used at (a ladder of sources under one layer name: coarse far, fine near) */
  minZoom?: number; maxZoom?: number;
  /** the features are open lines (borders, roads), not polygons */
  open?: boolean;
  /** who to credit when this input is on screen (carried in every tile it is in) */
  attribution?: string;
}
export interface MeshFeature { gid: number; name: string; props: Record<string, unknown> }
export interface MeshLayer {
  name: string; features: MeshFeature[]; attribution?: string;
  /** fill vertices: u, v (0 … 65535 over the tile), feature, kind (0 top, 1 wall) as uint16 ×4, then height f32 */
  verts: ArrayBuffer; indices: Uint32Array;
  /** line segments: u0, v0, u1, v1, feature, pad as uint16 ×6, then height f32 */
  segs: ArrayBuffer;
}
export interface MeshTile { z: number; x: number; y: number; layers: MeshLayer[] }

export const VERT_BYTES = 12, SEG_BYTES = 16;
const MAGIC = 0x544d5341;   // "ASMT"

// ── preparation: once per data set (projected to the unit Mercator square, y down; polygons grouped even-odd) ──
interface Poly { outer: Float64Array; holes: Float64Array[]; box: [number, number, number, number] }
interface Prepared { o: Outline; gid: number; rings: Float64Array[]; polys: Poly[]; box: [number, number, number, number]; h: number; byZ: Map<number, { rings: Float64Array[]; polys: Poly[] }> }

const unit = (lon: number, lat: number): [number, number] => [(lon + 180) / 360, (Math.PI - mercY(Math.max(-MAX_LAT, Math.min(MAX_LAT, lat)))) / (2 * Math.PI)];
function boxOf(r: Float64Array): [number, number, number, number] { let x0 = 1, y0 = 1, x1 = 0, y1 = 0; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]!); x1 = Math.max(x1, r[i]!); y0 = Math.min(y0, r[i + 1]!); y1 = Math.max(y1, r[i + 1]!); } return [x0, y0, x1, y1]; }
function area(r: Float64Array): number { let a = 0; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) a += (r[j]! - r[i]!) * (r[j + 1]! + r[i + 1]!); return a / 2; }
function inside(px: number, py: number, r: Float64Array): boolean { let c = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) { const yi = r[i + 1]!, yj = r[j + 1]!; if ((yi > py) !== (yj > py) && px < ((r[j]! - r[i]!) * (py - yi)) / (yj - yi) + r[i]!) c = !c; } return c; }
/** rings under even-odd: a ring inside an odd number of others is a hole of the smallest one containing it */
function group(rings: Float64Array[]): Poly[] {
  const rs = rings.filter((r) => r.length >= 6).map((r) => ({ r, a: Math.abs(area(r)), parent: -1, depth: 0 })).sort((p, q) => q.a - p.a);
  rs.forEach((p, i) => { for (let j = i - 1; j >= 0; j--) if (inside(p.r[0]!, p.r[1]!, rs[j]!.r)) { p.parent = j; p.depth = rs[j]!.depth + 1; break; } });
  const polys: Poly[] = [], at = new Map<number, Poly>();
  rs.forEach((p, i) => { if (p.depth % 2 === 0) { const poly = { outer: p.r, holes: [], box: boxOf(p.r) }; polys.push(poly); at.set(i, poly); } else at.get(p.parent)?.holes.push(p.r); });
  return polys;
}
function prepare(o: Outline, gid: number, h: number, open = false): Prepared {
  const rings = o.rings.map((r) => { const a = new Float64Array(r.length); for (let i = 0; i < r.length; i += 2) { const [x, y] = unit(r[i]!, r[i + 1]!); a[i] = x; a[i + 1] = y; } return a; });
  const polys = open ? [] : group(rings), all = rings.map(boxOf);
  return { o, gid, rings, polys, h, box: [Math.min(...all.map((b) => b[0])), Math.min(...all.map((b) => b[1])), Math.max(...all.map((b) => b[2])), Math.max(...all.map((b) => b[3]))], byZ: new Map() };
}

// ── simplification for a level: Douglas–Peucker, closed rings split at their farthest point first ──
function dp(r: Float64Array, tol: number): Float64Array {
  const n = r.length / 2; if (n < 5) return r;
  let far = 0, fd = -1; for (let i = 1; i < n; i++) { const d = (r[2 * i]! - r[0]!) ** 2 + (r[2 * i + 1]! - r[1]!) ** 2; if (d > fd) { fd = d; far = i; } }
  const keep = new Uint8Array(n); keep[0] = keep[far] = keep[n - 1] = 1;
  const t2 = tol * tol, st: [number, number][] = [[0, far], [far, n - 1]];
  while (st.length) {
    const [a, b] = st.pop()!; if (b - a < 2) continue;
    const ax = r[2 * a]!, ay = r[2 * a + 1]!, dx = r[2 * b]! - ax, dy = r[2 * b + 1]! - ay, L = dx * dx + dy * dy;
    let m = -1, md = t2;
    for (let i = a + 1; i < b; i++) {
      const px = r[2 * i]! - ax, py = r[2 * i + 1]! - ay, t = L ? Math.max(0, Math.min(1, (px * dx + py * dy) / L)) : 0, d = (px - t * dx) ** 2 + (py - t * dy) ** 2;
      if (d > md) { md = d; m = i; }
    }
    if (m >= 0) { keep[m] = 1; st.push([a, m], [m, b]); }
  }
  const out: number[] = []; for (let i = 0; i < n; i++) if (keep[i]) out.push(r[2 * i]!, r[2 * i + 1]!);
  return Float64Array.from(out);
}
function atZoom(p: Prepared, z: number) {
  let s = p.byZ.get(z);
  if (!s) {
    const tol = 1 / (2 ** z * 512), min = tol * tol * 4, ring = (r: Float64Array) => dp(r, tol);
    const ok = (r: Float64Array) => r.length >= 6 && Math.abs(area(r)) > min;
    s = { rings: p.rings.map(ring).filter((r) => r.length >= 4 && (r.length > 4 || r[0] !== r[2] || r[1] !== r[3])), polys: p.polys.map((q) => ({ outer: ring(q.outer), holes: q.holes.map(ring).filter(ok), box: q.box })).filter((q) => ok(q.outer)) };
    p.byZ.set(z, s);
  }
  return s;
}

// ── clipping ───────────────────────────────────────────────────────────────────────────────────────────────────
/** Sutherland–Hodgman against an axis-aligned box (polygon stays one ring; good for triangulation) */
function clipRing(r: Float64Array, x0: number, y0: number, x1: number, y1: number): Float64Array | null {
  let pts = r;
  const edge = (inside: (x: number, y: number) => boolean, cut: (ax: number, ay: number, bx: number, by: number) => [number, number]) => {
    const out: number[] = [], n = pts.length / 2;
    if (!n) return;
    for (let i = 0; i < n; i++) {
      const ax = pts[2 * ((i + n - 1) % n)]!, ay = pts[2 * ((i + n - 1) % n) + 1]!, bx = pts[2 * i]!, by = pts[2 * i + 1]!, ia = inside(ax, ay), ib = inside(bx, by);
      if (ib) { if (!ia) out.push(...cut(ax, ay, bx, by)); out.push(bx, by); } else if (ia) out.push(...cut(ax, ay, bx, by));
    }
    pts = Float64Array.from(out);
  };
  edge((x) => x >= x0, (ax, ay, bx, by) => [x0, ay + ((by - ay) * (x0 - ax)) / (bx - ax)]);
  edge((x) => x <= x1, (ax, ay, bx, by) => [x1, ay + ((by - ay) * (x1 - ax)) / (bx - ax)]);
  edge((_x, y) => y >= y0, (ax, ay, bx, by) => [ax + ((bx - ax) * (y0 - ay)) / (by - ay), y0]);
  edge((_x, y) => y <= y1, (ax, ay, bx, by) => [ax + ((bx - ax) * (y1 - ay)) / (by - ay), y1]);
  return pts.length >= 6 ? pts : null;
}
/** Liang–Barsky: the part of a segment inside the box, or null */
function clipSeg(ax: number, ay: number, bx: number, by: number, x0: number, y0: number, x1: number, y1: number): [number, number, number, number] | null {
  let t0 = 0, t1 = 1; const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]] as [number, number][]) {
    if (p === 0) { if (q < 0) return null; continue; }
    const t = q / p; if (p < 0) { if (t > t1) return null; t0 = Math.max(t0, t); } else { if (t < t0) return null; t1 = Math.min(t1, t); }
  }
  return [ax + t0 * dx, ay + t0 * dy, ax + t1 * dx, ay + t1 * dy];
}

/** how many cells per side a tile is cut into, so a triangle never spans more than a few degrees on the globe */
export const cellsAt = (z: number) => (z <= 1 ? 16 : z <= 3 ? 8 : z <= 5 ? 4 : z <= 7 ? 2 : 1);

// ── the baker ──────────────────────────────────────────────────────────────────────────────────────────────────
/** features by cell of a 256 × 256 grid over the world (a tile asks only the cells it covers) */
const G = 256;
class Grid {
  cells = new Map<number, number[]>(); big: number[] = [];
  add(i: number, b: [number, number, number, number]): void {
    const x0 = Math.max(0, Math.floor(b[0] * G)), x1 = Math.min(G - 1, Math.floor(b[2] * G)), y0 = Math.max(0, Math.floor(b[1] * G)), y1 = Math.min(G - 1, Math.floor(b[3] * G));
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 256) { this.big.push(i); return; }
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const k = y * G + x; let c = this.cells.get(k); if (!c) this.cells.set(k, (c = [])); c.push(i); }
  }
  query(x0: number, y0: number, x1: number, y1: number): number[] {
    const out = new Set(this.big), a = Math.max(0, Math.floor(x0 * G)), b = Math.min(G - 1, Math.floor(x1 * G)), c = Math.max(0, Math.floor(y0 * G)), d = Math.min(G - 1, Math.floor(y1 * G));
    if ((b - a + 1) * (d - c + 1) > 4096) return [...Array(this.size).keys()];
    for (let y = c; y <= d; y++) for (let x = a; x <= b; x++) for (const i of this.cells.get(y * G + x) ?? []) out.add(i);
    return [...out].sort((p, q) => p - q);
  }
  size = 0;
}

export class MeshBaker {
  private layers: { input: MeshLayerInput; prep: Prepared[]; grid: Grid }[];
  constructor(layers: MeshLayerInput[]) {
    this.layers = layers.map((l) => {
      const prep = l.features.map((o, i) => prepare(o, i, l.height?.(o) ?? 0, l.open)), grid = new Grid();
      prep.forEach((p, i) => grid.add(i, p.box)); grid.size = prep.length;
      return { input: l, prep, grid };
    });
  }
  /** replace one feature (an edit): returns the area it touches before and after, in lon / lat, to invalidate tiles */
  update(layer: string, gid: number, o: Outline): [number, number, number, number] {
    const L = this.layers.find((l) => l.input.name === layer); if (!L) throw new Error(`no layer ${layer}`);
    const old = L.prep[gid]!, next = prepare(o, gid, L.input.height?.(o) ?? 0, L.input.open);
    L.prep[gid] = next; L.input.features[gid] = o; L.grid.add(gid, next.box);
    return [Math.min(old.o.bbox[0]!, o.bbox[0]!), Math.min(old.o.bbox[1]!, o.bbox[1]!), Math.max(old.o.bbox[2]!, o.bbox[2]!), Math.max(old.o.bbox[3]!, o.bbox[3]!)];
  }
  get names(): string[] { return [...new Set(this.layers.map((l) => l.input.name))]; }
  feature(layer: string, gid: number): Outline | undefined { return this.layers.find((l) => l.input.name === layer)?.input.features[gid]; }
  find(layer: string, key: (o: Outline) => boolean): number { return this.layers.find((l) => l.input.name === layer)?.input.features.findIndex(key) ?? -1; }

  /** tile z / x / y, or null when nothing is in it */
  tile(z: number, x: number, y: number): MeshTile | null {
    const k = 2 ** z, tx0 = x / k, ty0 = y / k, tx1 = (x + 1) / k, ty1 = (y + 1) / k, size = 1 / k, C = cellsAt(z);
    const q = (v: number, a: number) => Math.max(0, Math.min(65535, Math.round(((v - a) / size) * 65535)));
    const out: MeshLayer[] = [];
    for (const { input, prep, grid } of this.layers) {
      if (z < (input.minZoom ?? 0) || z > (input.maxZoom ?? 99)) continue;
      const feats: MeshFeature[] = [], fIndex = new Map<number, number>(), vs: number[] = [], hs: number[] = [], idx: number[] = [], segs: number[] = [], sh: number[] = [];
      const fid = (p: Prepared) => { let i = fIndex.get(p.gid); if (i === undefined) { i = feats.length; fIndex.set(p.gid, i); const props = input.keep ? Object.fromEntries(input.keep.map((n) => [n, p.o.props?.[n]])) : { ...p.o.props }; feats.push({ gid: p.gid, name: p.o.name, props }); } return i; };
      const vert = (u: number, v: number, f: number, kind: number, h: number) => { vs.push(q(u, tx0), q(v, ty0), f, kind); hs.push(h); return hs.length - 1; };
      for (const pi of grid.query(tx0, ty0, tx1, ty1)) {
        const p = prep[pi]!;
        if (p.box[2] < tx0 || p.box[0] > tx1 || p.box[3] < ty0 || p.box[1] > ty1) continue;
        const s = atZoom(p, z);
        // fills: per polygon, per cell
        if (input.fill !== false && !input.open) for (const poly of s.polys) {
          if (poly.box[2] < tx0 || poly.box[0] > tx1 || poly.box[3] < ty0 || poly.box[1] > ty1) continue;
          const outer = clipRing(poly.outer, tx0, ty0, tx1, ty1); if (!outer) continue;
          const holes = poly.holes.map((hr) => clipRing(hr, tx0, ty0, tx1, ty1)).filter((hr): hr is Float64Array => !!hr);
          for (let cj = 0; cj < C; cj++) for (let ci = 0; ci < C; ci++) {
            const cx0 = tx0 + (ci * size) / C, cy0 = ty0 + (cj * size) / C, cx1 = cx0 + size / C, cy1 = cy0 + size / C;
            const o2 = C === 1 ? outer : clipRing(outer, cx0, cy0, cx1, cy1); if (!o2) continue;
            const flat = Array.from(o2), holeAt: number[] = [];
            for (const hr of holes) { const h2 = C === 1 ? hr : clipRing(hr, cx0, cy0, cx1, cy1); if (h2) { holeAt.push(flat.length / 2); flat.push(...h2); } }
            const tri = earcut(flat, holeAt.length ? holeAt : undefined, 2); if (!tri.length) continue;
            const f = fid(p), b0 = hs.length;
            for (let i = 0; i < flat.length; i += 2) vert(flat[i]!, flat[i + 1]!, f, 0, p.h);
            for (const t of tri) idx.push(b0 + t);
          }
        }
        // outlines (and walls when extruded): the rings' own segments, never the tile's cut edges
        if (input.lines !== false || p.h > 0) for (const r of s.rings) {
          const n = r.length / 2, step = size / C;
          for (let i = 0; i < (input.open ? n - 1 : n); i++) {
            const j = (i + 1) % n, c = clipSeg(r[2 * i]!, r[2 * i + 1]!, r[2 * j]!, r[2 * j + 1]!, tx0, ty0, tx1, ty1); if (!c) continue;
            const f = fid(p), pieces = Math.max(1, Math.ceil(Math.hypot(c[2] - c[0], c[3] - c[1]) / step));
            for (let m = 0; m < pieces; m++) {
              const a0 = m / pieces, a1 = (m + 1) / pieces, ax = c[0] + (c[2] - c[0]) * a0, ay = c[1] + (c[3] - c[1]) * a0, bx = c[0] + (c[2] - c[0]) * a1, by = c[1] + (c[3] - c[1]) * a1;
              if (input.lines !== false) { segs.push(q(ax, tx0), q(ay, ty0), q(bx, tx0), q(by, ty0), f, 0); sh.push(p.h); }
              if (p.h > 0) { const w0 = vert(ax, ay, f, 1, 0), w1 = vert(bx, by, f, 1, 0), w2 = vert(bx, by, f, 1, p.h), w3 = vert(ax, ay, f, 1, p.h); idx.push(w0, w1, w2, w0, w2, w3); }
            }
          }
        }
      }
      if (!feats.length) continue;
      const verts = new ArrayBuffer(hs.length * VERT_BYTES), dv = new DataView(verts);
      hs.forEach((h, i) => { for (let c = 0; c < 4; c++) dv.setUint16(i * VERT_BYTES + c * 2, vs[i * 4 + c]!, true); dv.setFloat32(i * VERT_BYTES + 8, h, true); });
      const sb = new ArrayBuffer(sh.length * SEG_BYTES), ds = new DataView(sb);
      sh.forEach((h, i) => { for (let c = 0; c < 6; c++) ds.setUint16(i * SEG_BYTES + c * 2, segs[i * 6 + c]!, true); ds.setFloat32(i * SEG_BYTES + 12, h, true); });
      out.push({ name: input.name, features: feats, verts, indices: Uint32Array.from(idx), segs: sb, ...(input.attribution ? { attribution: input.attribution } : {}) });
    }
    return out.length ? { z, x, y, layers: out } : null;
  }
}

// ── the bytes: "ASMT" · u32 version · u32 json length · json · (padded to 4) buffers ─────────────────────────────
export function encodeMeshTile(t: MeshTile): Uint8Array {
  let off = 0; const bufs: ArrayBuffer[] = [];
  const at = (b: ArrayBuffer) => { const o = off; bufs.push(b); off += b.byteLength; return o; };
  const head = { z: t.z, x: t.x, y: t.y, layers: t.layers.map((l) => ({ name: l.name, attribution: l.attribution, features: l.features, verts: [at(l.verts), l.verts.byteLength], indices: [at(l.indices.buffer as ArrayBuffer), l.indices.byteLength], segs: [at(l.segs), l.segs.byteLength] })) };
  const json = new TextEncoder().encode(JSON.stringify(head)), pad = (4 - ((12 + json.length) % 4)) % 4, start = 12 + json.length + pad;
  const out = new Uint8Array(start + off), dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true); dv.setUint32(4, 1, true); dv.setUint32(8, json.length, true); out.set(json, 12);
  let o = start; for (const b of bufs) { out.set(new Uint8Array(b), o); o += b.byteLength; }
  return out;
}
export function decodeMeshTile(b: Uint8Array): MeshTile {
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not an aslnut mesh tile');
  const n = dv.getUint32(8, true), head = JSON.parse(new TextDecoder().decode(b.subarray(12, 12 + n))), start = 12 + n + ((4 - ((12 + n) % 4)) % 4);
  const slice = ([o, l]: [number, number]) => b.buffer.slice(b.byteOffset + start + o, b.byteOffset + start + o + l) as ArrayBuffer;
  return { z: head.z, x: head.x, y: head.y, layers: head.layers.map((l: { name: string; attribution?: string; features: MeshFeature[]; verts: [number, number]; indices: [number, number]; segs: [number, number] }) => ({ name: l.name, attribution: l.attribution, features: l.features, verts: slice(l.verts), indices: new Uint32Array(slice(l.indices)), segs: slice(l.segs) })) };
}
