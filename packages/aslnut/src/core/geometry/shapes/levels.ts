// core › geometry › shapes › levels › impostor: a shape far away as one card facing the camera. impostor(shape) is a
// level of detail you put last in an instance's levels; a solids layer bakes it once on the chip it draws with (the
// shape seen from views × views directions over the upper half of a sphere, its colour and its normals into two
// atlases) and then draws each far instance as six vertices, lit and shadowed as the shape would be.
//   instances: [{ shape: [tree.whole, tree.simple, impostor(tree.whole, { views: 8 })], data }]
import type { GBuffer, GTarget, GTexture, Graphics, Program } from '../../render/graphics/interface.ts';
import { IMPOSTOR_BAKE_GLSL } from '../../render/graphics/shaders/impostor.glsl.ts';
import { IMPOSTOR_BAKE_WGSL } from '../../render/graphics/shaders/impostor.wgsl.ts';
import { MeshBuilder, OWN_COLOUR, SHAPE_FLOATS, shapeOf } from './mesh.ts';
import { Builder } from './builder.ts';
import type { V3 } from './parts.ts';

/** an impostor level: the shape it stands for, how it is baked */
export interface ImpostorLevel {
  readonly kind: 'impostor';
  /** the shape baked (an instance shape: SHAPE_FLOATS numbers a vertex) */
  readonly shape: Float32Array;
  /** views a side of the grid (views² directions) */
  readonly views: number;
  /** the atlas side, px */
  readonly size: number;
  /** the shape's bounding sphere: its centre's height and its radius (shape units) */
  readonly centreY: number; readonly radius: number;
}
/** an impostor of a shape (put it last in its levels of detail) */
export function impostor(shape: Float32Array, o: { views?: number; size?: number } = {}): ImpostorLevel {
  let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + SHAPE_FLOATS <= shape.length; i += SHAPE_FLOATS) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, shape[i + k]!); hi[k] = Math.max(hi[k]!, shape[i + k]!); }
  if (!Number.isFinite(lo[0]!)) { lo = [0, 0, 0]; hi = [1, 1, 1]; }
  const c = [(lo[0]! + hi[0]!) / 2, (lo[1]! + hi[1]!) / 2, (lo[2]! + hi[2]!) / 2];
  // the sphere stands on the shape's axis (an instance's place): its centre at the middle height, x = z = 0
  let r = 0; for (let i = 0; i + SHAPE_FLOATS <= shape.length; i += SHAPE_FLOATS) r = Math.max(r, Math.hypot(shape[i]!, shape[i + 1]! - c[1]!, shape[i + 2]!));
  const views = Math.max(2, Math.min(16, Math.round(o.views ?? 8)));
  return { kind: 'impostor', shape, views, size: Math.max(views * 16, Math.min(4096, o.size ?? views * 64)), centreY: c[1]!, radius: r * 1.02 };
}
export const isImpostor = (x: unknown): x is ImpostorLevel => !!x && (x as ImpostorLevel).kind === 'impostor';

/** the direction a grid cell was baked from (0..1 on the square → the upper half of a sphere) */
export function hemiOctDir(u: number, v: number): [number, number, number] {
  const fx = u * 2 - 1, fy = v * 2 - 1, x = (fx + fy) / 2, z = (fx - fy) / 2, y = Math.max(0, 1 - Math.abs(x) - Math.abs(z)), l = Math.hypot(x, y, z) || 1;
  return [x / l, y / l, z / l];
}
export interface BakedImpostor { color: GTexture; normals: GTexture; targets: GTarget[]; buffers: GBuffer[] }
let bakeProgs = new WeakMap<Graphics, Program>();
/** bake an impostor's atlases on this chip (two frames into two targets; the shape's buffer is yours) */
export async function bakeImpostor(g: Graphics, lv: ImpostorLevel, shapeBuf: GBuffer): Promise<BakedImpostor> {
  let prog = bakeProgs.get(g);
  if (!prog) {
    prog = g.program({ label: 'impostor bake', wgsl: IMPOSTOR_BAKE_WGSL, glsl: IMPOSTOR_BAKE_GLSL, blocks: ['B'],
      vertex: { stride: SHAPE_FLOATS, attributes: [{ name: 'v', location: 3, size: 4, offset: 0 }, { name: 'vc', location: 4, size: 1, offset: 4 }, { name: 'card', location: 5, size: 1, offset: 5 }] }, depth: { write: true, test: 'less' }, cull: 'none' });
    bakeProgs.set(g, prog);
  }
  await prog.ready;
  const n = lv.views, R = lv.radius, cy = lv.centreY, nv = lv.shape.length / SHAPE_FLOATS, buffers: GBuffer[] = [], draws = [];
  const blocks: Float32Array[] = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const d = hemiOctDir((i + 0.5) / n, (j + 0.5) / n);
    let rx = d[2], rz = -d[0]; const rl = Math.hypot(rx, rz); if (rl < 1e-3) { rx = 1; rz = 0; } else { rx /= rl; rz /= rl; }
    // right = up × d, up' = d × right (as the cards are drawn)
    const right = [rx, 0, rz], up = [d[1] * right[2]! - d[2] * right[1]!, d[2] * right[0]! - d[0] * right[2]!, d[0] * right[1]! - d[1] * right[0]!];
    // the view: shape − centre onto (right, up, d), over the radius; column-major mat4
    const m = new Float32Array(16), rows = [right, up, d];
    for (let r = 0; r < 3; r++) { const a = rows[r]!; m[r] = a[0]! / R; m[4 + r] = a[1]! / R; m[8 + r] = a[2]! / R; m[12 + r] = -(a[1]! * cy) / R; }
    m[15] = 1;
    const b = new Float32Array(24); b.set(m, 0); b.set([-1 + (2 * i + 1) / n, 1 - (2 * j + 1) / n, 1 / n, 0], 16); b.set([0, d[0], d[1], d[2]], 20);
    blocks.push(b);
    const buf = g.buffer('uniform', b, 'impostor bake cell'); buffers.push(buf);
    draws.push({ program: prog, blocks: [buf], vertices: shapeBuf, count: nv });
  }
  const color = g.target(lv.size, lv.size, { sampled: true, label: 'impostor colours' }), normals = g.target(lv.size, lv.size, { sampled: true, label: 'impostor normals' });
  g.frame(draws, { clear: [0, 0, 0, 0], target: color });
  // the same views, normals this time (the buffers written after the colour frame went to the chip)
  blocks.forEach((b, k) => { b[20] = 1; buffers[k]!.write(b); });
  g.frame(draws, { clear: [0.5, 1, 0.5, 0], target: normals });
  return { color: color.texture!, normals: normals.texture!, targets: [color, normals], buffers };
}
export function forgetBakes(): void { bakeProgs = new WeakMap(); }

/** a box (or a dot: a small diamond at its middle) in a shape's mean colour */
export function blockOf(sh: Float32Array, kind: 'box' | 'dot'): Float32Array {
  const [lo, hi] = boundsOf(sh); let r = 0, g = 0, bl = 0, n = 0, own = 0, all = 0;
  for (let i = 0; i + 6 <= sh.length; i += 6) { const c = sh[i + 4]!; r += (c >> 16) & 255; g += (c >> 8) & 255; bl += c & 255; n++; }
  // how much of its surface keeps its own colour (by area)
  for (let i = 0; i + 18 <= sh.length; i += 18) {
    const ux = sh[i + 6]! - sh[i]!, uy = sh[i + 7]! - sh[i + 1]!, uz = sh[i + 8]! - sh[i + 2]!, vx = sh[i + 12]! - sh[i]!, vy = sh[i + 13]! - sh[i + 1]!, vz = sh[i + 14]! - sh[i + 2]!;
    const a = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx); all += a; if (sh[i + 5]! >= OWN_COLOUR && sh[i + 5]! < 65536) own += a;
  }
  const col = n ? [(r / n) / 255, (g / n) / 255, (bl / n) / 255] as [number, number, number] : [0.5, 0.5, 0.5] as [number, number, number];
  const mb = new MeshBuilder(), b = new Builder(mb, 2), c: V3 = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
  if (kind === 'box') b.solid('box', { size: [hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]], at: c, color: col });
  else b.solid('sphere', { radius: Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) / 3, at: c, color: col, sides: 4 });
  // a shape mostly of pieces that keep their own colours (few tinted): so does its block
  const out = shapeFrom(mb);
  if (own * 2 > all) for (let i = 5; i < out.length; i += 6) if (out[i]! < OWN_COLOUR) out[i] = out[i]! + OWN_COLOUR;
  return out;
}
export function boundsOf(sh: Float32Array): [V3, V3] {
  const lo: V3 = [Infinity, Infinity, Infinity], hi: V3 = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i + 6 <= sh.length; i += 6) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, sh[i + k]!); hi[k] = Math.max(hi[k]!, sh[i + k]!); }
  return [lo, hi];
}
/** what a builder built, as an instance shape */
export function shapeFrom(mb: MeshBuilder): Float32Array { return shapeOf((m) => { (m as unknown as { adopt(o: MeshBuilder): void }).adopt(mb); }); }
