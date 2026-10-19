// core › geometry › import › gltf: a glTF 2.0 model (a .glb, or a .gltf with its buffers beside it) as a made shape:
// its meshes' triangles placed by their nodes, each vertex coloured by its material (the base colour × its texture at
// the vertex: a palette texture is read exactly), scaled to a size, its foot at 0. Its paint (the colour over most of
// it, or one you name) takes each instance's colour, so a street of one model has many colours, one build. Static
// meshes only: no skins, morphs, animations or compressed geometry (yet). Given a kind (core › entities › identity ›
// kind) and its anchors (a list, by name, or your function of the model as made: its bounds, its footprint), a model
// carries the kind's traits: a downloaded house serves as a house (its entries, its parking, its charger's place).
//   const car = await shapes.import('/models/sedan.glb', { length: 4.6 })
//   const home = await shapes.import('/models/house.glb', { scale: 8.5, kind: 'house', anchors: (m) => ({ 'parking-1': { at: [3, 0, m.bounds[1][2] + 3], kind: 'parking', heading: 180 } }) })
//   w.add(entities({ id: 'fleet', drive: drive.data(log), shape: car, color: (d) => paints[d.index % 8] }))
import { AslnutError } from '../../world/errors.ts';
import { packNormal, rgbOf, OWN_COLOUR, SHAPE_FLOATS } from '../shapes/mesh.ts';
import type { Made } from '../shapes/shape.ts';
import { asKind, anchorList, type Anchors, type EntityKind } from '../../entities/kinds.ts';
import { rgba, type Color } from '../../render/style/color.ts';

export interface ImportOptions {
  /** metres its length (the longer of its width and depth) is scaled to; or `scale` (default 1: as it is) */
  length?: number; scale?: number;
  /** the colour that takes each instance's colour: 'auto' (the colour family over most of its surface, a coloured
   *  one first: its paint; the default), a colour of the model's, or false (it keeps its own colours) */
  paint?: 'auto' | Color | false;
  /** how near a colour must be to the paint to be painted (0..1 of the colour space; default .06) */
  tolerance?: number;
  /** degrees it is turned round the vertical (its front must face +z, its right side −x) */
  turn?: number;
  /** your fetch (default the page's) */
  fetch?: (url: string) => Promise<ArrayBuffer>;
  /** what it is: a kind (or its name); its traits are checked (kindOf(kind).check(made)) and read (traits) as any
   *  shape's of that kind */
  kind?: EntityKind | string;
  /** its anchors (metres in its frame as made: turned and scaled, its foot at 0, centred, its front +z): a list, by
   *  name ({ 'entry-1': { at, kind, heading } }), or your function of the made model (an adapter: from its bounds) */
  anchors?: Anchors | ((m: Made) => Anchors);
  /** the params its kind reads (levels, floor, roof) */
  params?: Record<string, unknown>;
}
export type { Anchors };
interface Gltf {
  asset?: { version?: string };
  scene?: number; scenes?: { nodes?: number[] }[];
  nodes?: { mesh?: number; children?: number[]; matrix?: number[]; translation?: number[]; rotation?: number[]; scale?: number[] }[];
  meshes?: { primitives: { attributes: Record<string, number>; indices?: number; material?: number; mode?: number }[] }[];
  accessors?: { bufferView?: number; byteOffset?: number; componentType: number; normalized?: boolean; count: number; type: string }[];
  bufferViews?: { buffer: number; byteOffset?: number; byteLength: number; byteStride?: number }[];
  buffers?: { uri?: string; byteLength: number }[];
  materials?: { pbrMetallicRoughness?: { baseColorFactor?: number[]; baseColorTexture?: { index: number; texCoord?: number } } }[];
  textures?: { source?: number }[];
  images?: { uri?: string; bufferView?: number; mimeType?: string }[];
}
const SIZE: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT4: 16 };
const resolveUrl = (base: string, rel: string) => { try { return new URL(rel, new URL(base, typeof location !== 'undefined' ? location.href : 'http://x/')).href; } catch { return rel; } };

/** an accessor's numbers as floats (normalised integers to 0..1) */
function read(g: Gltf, bins: ArrayBuffer[], i: number): { data: Float32Array | Uint32Array; size: number; count: number } {
  const a = g.accessors![i]!, n = SIZE[a.type] ?? 1, bv = a.bufferView !== undefined ? g.bufferViews![a.bufferView]! : null;
  const out = a.componentType === 5125 || (!a.normalized && (a.componentType === 5121 || a.componentType === 5123)) ? new Uint32Array(a.count * n) : new Float32Array(a.count * n);
  if (!bv) return { data: out, size: n, count: a.count };
  const buf = bins[bv.buffer]!, dv = new DataView(buf), es = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }[a.componentType] ?? 4;
  const stride = bv.byteStride ?? n * es, base = (bv.byteOffset ?? 0) + (a.byteOffset ?? 0);
  for (let k = 0; k < a.count; k++) for (let c = 0; c < n; c++) {
    const at = base + k * stride + c * es;
    let v: number;
    switch (a.componentType) {
      case 5126: v = dv.getFloat32(at, true); break;
      case 5125: v = dv.getUint32(at, true); break;
      case 5123: v = dv.getUint16(at, true); if (a.normalized) v /= 65535; break;
      case 5122: v = dv.getInt16(at, true); if (a.normalized) v = Math.max(-1, v / 32767); break;
      case 5121: v = dv.getUint8(at); if (a.normalized) v /= 255; break;
      default: v = dv.getInt8(at); if (a.normalized) v = Math.max(-1, v / 127);
    }
    out[k * n + c] = v;
  }
  return { data: out, size: n, count: a.count };
}
/** a node's matrix (column-major 4 × 4) from its matrix or its translation, rotation (a quaternion) and scale */
function local(n: NonNullable<Gltf['nodes']>[number]): number[] {
  if (n.matrix) return n.matrix;
  const q = n.rotation ?? [0, 0, 0, 1], sc = n.scale ?? [1, 1, 1], t = n.translation ?? [0, 0, 0];
  const x = q[0]!, y = q[1]!, z = q[2]!, w = q[3]!, sx = sc[0]!, sy = sc[1]!, sz = sc[2]!;
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, t[0]!, t[1]!, t[2]!, 1];
}
const mul = (a: number[], b: number[]) => { const o = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) for (let k = 0; k < 4; k++) o[c * 4 + r] += a[k * 4 + r]! * b[c * 4 + k]!; return o as number[]; };

/** an image's RGBA pixels (null where the page cannot decode images: the base colour alone then) */
async function pixels(g: Gltf, bins: ArrayBuffer[], url: string, i: number, get: (u: string) => Promise<ArrayBuffer>): Promise<{ w: number; h: number; px: Uint8ClampedArray } | null> {
  const im = g.images?.[i]; if (!im || typeof createImageBitmap === 'undefined' || typeof OffscreenCanvas === 'undefined') return null;
  let bytes: ArrayBuffer;
  if (im.bufferView !== undefined) { const bv = g.bufferViews![im.bufferView]!; bytes = bins[bv.buffer]!.slice(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength); }
  else if (im.uri) bytes = await get(resolveUrl(url, im.uri));
  else return null;
  const bmp = await createImageBitmap(new Blob([bytes], { type: im.mimeType ?? 'image/png' }), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const cv = new OffscreenCanvas(bmp.width, bmp.height), cx = cv.getContext('2d')!; cx.drawImage(bmp, 0, 0);
  return { w: bmp.width, h: bmp.height, px: cx.getImageData(0, 0, bmp.width, bmp.height).data };
}

/** a glTF model as a made shape (its levels: the same triangles for each) */
export async function importShape(url: string, o: ImportOptions = {}): Promise<Made> {
  const get = o.fetch ?? (async (u: string) => { const r = await fetch(u); if (!r.ok) throw new AslnutError('E-DATA-002', `nothing at ${u} (${r.status})`, { fix: 'check the URL (a model kept outside git, served with the data)' }); return r.arrayBuffer(); });
  const raw = await get(url), head = new Uint8Array(raw, 0, 4);
  let g: Gltf; const bins: ArrayBuffer[] = [];
  if (head[0] === 0x67 && head[1] === 0x6c && head[2] === 0x54 && head[3] === 0x46) {
    // a .glb: its JSON chunk, then its binary chunk (buffer 0)
    const dv = new DataView(raw), jl = dv.getUint32(12, true);
    g = JSON.parse(new TextDecoder().decode(new Uint8Array(raw, 20, jl))) as Gltf;
    const at = 20 + jl; if (at + 8 <= raw.byteLength) { const bl = dv.getUint32(at, true); bins.push(raw.slice(at + 8, at + 8 + bl)); }
  } else g = JSON.parse(new TextDecoder().decode(new Uint8Array(raw))) as Gltf;
  if (!g.meshes?.length) throw new AslnutError('E-DATA-002', `${url} has no meshes`, { fix: 'a glTF 2.0 model with triangles' });
  // buffers given by URI (beside the .gltf, or data: URIs)
  for (let b = 0; b < (g.buffers?.length ?? 0); b++) { const u = g.buffers![b]!.uri; if (u && bins[b] === undefined) bins[b] = await get(u.startsWith('data:') ? u : resolveUrl(url, u)); }
  // each material's base colour and texture (decoded once)
  const mats = await Promise.all((g.materials ?? []).map(async (m) => {
    const pb = m.pbrMetallicRoughness ?? {}, f = pb.baseColorFactor ?? [1, 1, 1, 1], ti = pb.baseColorTexture?.index;
    const src = ti !== undefined ? g.textures?.[ti]?.source : undefined;
    return { f, tex: src !== undefined ? await pixels(g, bins, url, src, get).catch(() => null) : null };
  }));
  // every primitive's triangles, placed by its node's world matrix
  const P: number[] = [], N: number[] = [], C: number[] = [];
  const walk = (ni: number, parent: number[]) => {
    const n = g.nodes![ni]!, m = mul(parent, local(n));
    if (n.mesh !== undefined) for (const pr of g.meshes![n.mesh]!.primitives) {
      if ((pr.mode ?? 4) !== 4 || pr.attributes.POSITION === undefined) continue;
      const pos = read(g, bins, pr.attributes.POSITION), nor = pr.attributes.NORMAL !== undefined ? read(g, bins, pr.attributes.NORMAL) : null, uv = pr.attributes.TEXCOORD_0 !== undefined ? read(g, bins, pr.attributes.TEXCOORD_0) : null;
      const idx = pr.indices !== undefined ? read(g, bins, pr.indices).data : Uint32Array.from({ length: pos.count }, (_, k) => k);
      const mat = pr.material !== undefined ? mats[pr.material] : null, f = mat?.f ?? [1, 1, 1, 1], tex = mat?.tex ?? null;
      for (let t = 0; t + 2 < idx.length; t += 3) for (let c = 0; c < 3; c++) {
        const k = idx[t + c]!, x = pos.data[3 * k]!, y = pos.data[3 * k + 1]!, z = pos.data[3 * k + 2]!;
        P.push(m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, m[1]! * x + m[5]! * y + m[9]! * z + m[13]!, m[2]! * x + m[6]! * y + m[10]! * z + m[14]!);
        const nx = nor ? nor.data[3 * k]! : 0, ny = nor ? nor.data[3 * k + 1]! : 1, nz = nor ? nor.data[3 * k + 2]! : 0;
        const wx = m[0]! * nx + m[4]! * ny + m[8]! * nz, wy = m[1]! * nx + m[5]! * ny + m[9]! * nz, wz = m[2]! * nx + m[6]! * ny + m[10]! * nz, l = Math.hypot(wx, wy, wz) || 1;
        N.push(wx / l, wy / l, wz / l);
        let r = f[0]!, gg = f[1]!, b = f[2]!;
        if (tex && uv) {
          const u = uv.data[2 * k]!, v = uv.data[2 * k + 1]!, px = Math.min(tex.w - 1, Math.max(0, Math.floor((((u % 1) + 1) % 1) * tex.w))), py = Math.min(tex.h - 1, Math.max(0, Math.floor((((v % 1) + 1) % 1) * tex.h))), q = (py * tex.w + px) * 4;
          r *= tex.px[q]! / 255; gg *= tex.px[q + 1]! / 255; b *= tex.px[q + 2]! / 255;
        }
        C.push(r, gg, b);
      }
    }
    for (const ch of n.children ?? []) walk(ch, m);
  };
  const roots = g.scenes?.[g.scene ?? 0]?.nodes ?? g.nodes?.map((_, i) => i) ?? [];
  for (const r of roots) walk(r, [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  const nv = P.length / 3;
  if (!nv) throw new AslnutError('E-DATA-002', `${url} has no triangles`, { fix: 'a glTF 2.0 model with triangle meshes' });
  // turned, scaled to its size, its foot at 0, centred over its middle
  const turn = ((o.turn ?? 0) * Math.PI) / 180, ct = Math.cos(turn), st = Math.sin(turn);
  for (let i = 0; i < nv; i++) for (const A of [P, N]) { const x = A[3 * i]!, z = A[3 * i + 2]!; A[3 * i] = x * ct + z * st; A[3 * i + 2] = -x * st + z * ct; }
  const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < nv; i++) for (let c = 0; c < 3; c++) { const v = P[3 * i + c]!; if (v < lo[c]!) lo[c] = v; if (v > hi[c]!) hi[c] = v; }
  const k = o.scale ?? (o.length ? o.length / Math.max(1e-9, Math.max(hi[0]! - lo[0]!, hi[2]! - lo[2]!)) : 1);
  const mx = (lo[0]! + hi[0]!) / 2, mz = (lo[2]! + hi[2]!) / 2;
  // its paint: the colour family over most of its surface (a coloured one first: a car's body over its grey glass
  // and tyres; its panels' shades one family), or yours. A painted vertex keeps its shade (its lightness over the
  // family's lightest), the instance's colour on it
  const quant = (i: number) => (Math.round(C[3 * i]! * 31) << 10) | (Math.round(C[3 * i + 1]! * 31) << 5) | Math.round(C[3 * i + 2]! * 31);
  const tol = o.tolerance ?? 0.06;
  const chroma = (r: number, g: number, b: number) => { const m = Math.max(r, g, b, 1e-6); return [r / m, g / m, b / m, (m - Math.min(r, g, b)) / m, m] as const; };
  const kin = (a: readonly number[], b: readonly number[]) => (a[3]! > 0.2) === (b[3]! > 0.2) && (a[3]! > 0.2 ? Math.abs(a[0]! - b[0]!) + Math.abs(a[1]! - b[1]!) + Math.abs(a[2]! - b[2]!) <= tol * 4 : Math.abs(a[4]! - b[4]!) <= tol * 2);
  let paint: readonly number[] | null = null;
  if (o.paint !== false) {
    if (o.paint && o.paint !== 'auto') { const q = rgba(o.paint); paint = chroma(q[0], q[1], q[2]); }
    else {
      const area = new Map<number, { a: number; c: readonly number[] }>(); let total = 0;
      for (let t = 0; t < nv; t += 3) {
        const ax = P[3 * t]!, ay = P[3 * t + 1]!, az = P[3 * t + 2]!, ux = P[3 * t + 3]! - ax, uy = P[3 * t + 4]! - ay, uz = P[3 * t + 5]! - az, vx = P[3 * t + 6]! - ax, vy = P[3 * t + 7]! - ay, vz = P[3 * t + 8]! - az;
        const a = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx) / 2, q = quant(t), e = area.get(q);
        if (e) e.a += a; else area.set(q, { a, c: chroma(C[3 * t]!, C[3 * t + 1]!, C[3 * t + 2]!) });
        total += a;
      }
      // each colour's family (the colours of its kind) and its area: the coloured family over most of it, else the
      // largest family of all
      const list = [...area.values()], fam = list.map((x) => ({ x, a: list.reduce((s, y) => s + (kin(x.c, y.c) ? y.a : 0), 0) }));
      const coloured = fam.filter((f) => f.x.c[3]! > 0.2).sort((a, b) => b.a - a.a)[0], any = [...fam].sort((a, b) => b.a - a.a)[0];
      const pick = coloured && coloured.a > total * 0.12 ? coloured : any;
      // the family's lightest member: every shade as a share of it
      if (pick) paint = list.filter((y) => kin(pick.x.c, y.c)).reduce((m, y) => (y.c[4]! > m[4]! ? y.c : m), pick.x.c);
    }
  }
  const out = new Float32Array(nv * SHAPE_FLOATS);
  for (let i = 0; i < nv; i++) {
    const j = i * SHAPE_FLOATS, r = C[3 * i]!, gg = C[3 * i + 1]!, b = C[3 * i + 2]!, c = chroma(r, gg, b);
    out[j] = (P[3 * i]! - mx) * k; out[j + 1] = (P[3 * i + 1]! - lo[1]!) * k; out[j + 2] = (P[3 * i + 2]! - mz) * k;
    out[j + 3] = packNormal(N[3 * i]!, N[3 * i + 1]!, N[3 * i + 2]!);
    const painted = !!paint && kin(c, paint), shade = painted ? Math.min(1, c[4]! / Math.max(1e-6, paint![4]!)) : 1;
    // a painted vertex: its shade of white, the instance's colour on it; the rest keep their own
    out[j + 4] = painted ? rgbOf([shade, shade, shade]) : rgbOf([r, gg, b]); out[j + 5] = painted ? 0 : paint ? OWN_COLOUR : 0;
  }
  const bounds: [[number, number, number], [number, number, number]] = [[(lo[0]! - mx) * k, 0, (lo[2]! - mz) * k], [(hi[0]! - mx) * k, (hi[1]! - lo[1]!) * k, (hi[2]! - mz) * k]];
  const made: Made = { levels: [out, out, out], parts: [], anchors: [], triangles: [nv / 3, nv / 3, nv / 3], bounds };
  // (given a kind: its name, anchors and params, as asKind gives them)
  if (o.kind !== undefined) return asKind(made, o.kind, { anchors: o.anchors, params: o.params });
  if (o.params) made.params = { ...o.params };
  if (o.anchors) made.anchors = anchorList(typeof o.anchors === 'function' ? o.anchors(made) : o.anchors);
  return made;
}
/** shapes from files: shapes.import(url, opts) */
export const shapes = { import: importShape };
