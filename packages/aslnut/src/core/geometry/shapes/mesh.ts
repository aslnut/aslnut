// core › geometry › shapes › mesh: solids made by code. Triangles, quads, walls, boxes, prisms and roofs into one
// buffer of numbers a solids layer draws: places in metres from a tile's corner (x east, z south), heights above the
// ground at an anchor (a building stands on one point; a road follows the ground at every vertex), a colour, a flat
// normal and a picking id per vertex. Shapes for instances (a tree's crown, a trunk) are made the same way.
//   const mb = new MeshBuilder(); mb.as(7).prism(ring, 0, 9, '#e8e2d4', '#7b7d80', anchor)
//   const crown = shapeOf((mb) => mb.sphere(0, 0, 0, 1, 1, '#fff'))
export type V3 = [number, number, number];
export type Colorish = string | number | readonly [number, number, number];

/** a colour as one number 0xRRGGBB (exact in a float) */
export function rgbOf(c: Colorish): number {
  if (typeof c === 'number') return c >>> 0;
  if (typeof c === 'string') { const h = c.replace('#', ''); const f = h.length === 3 ? h.split('').map((x) => x + x).join('') : h.slice(0, 6); return parseInt(f, 16) >>> 0; }
  return (Math.round(Math.max(0, Math.min(1, c[0])) * 255) << 16) + (Math.round(Math.max(0, Math.min(1, c[1])) * 255) << 8) + Math.round(Math.max(0, Math.min(1, c[2])) * 255);
}
/** a colour varied by ±amount (lightness), by a number 0..1 */
export function vary(c: Colorish, r: number, amount = 0.06): number {
  const n = rgbOf(c), k = 1 + (r * 2 - 1) * amount;
  const ch = (s: number) => Math.max(0, Math.min(255, Math.round(((n >> s) & 255) * k)));
  return (ch(16) << 16) + (ch(8) << 8) + ch(0);
}
/** a unit normal (x east, y up, z south) as one number: octahedral, 12 bits a side */
export function packNormal(nx: number, ny: number, nz: number): number {
  const X = nx, Y = nz, Z = ny, l = Math.abs(X) + Math.abs(Y) + Math.abs(Z) || 1;
  let ex = X / l, ey = Y / l;
  if (Z < 0) { const ax = (1 - Math.abs(ey)) * (ex >= 0 ? 1 : -1), ay = (1 - Math.abs(ex)) * (ey >= 0 ? 1 : -1); ex = ax; ey = ay; }
  const qx = Math.round((ex * 0.5 + 0.5) * 4095), qy = Math.round((ey * 0.5 + 0.5) * 4095);
  return qx * 4096 + qy;
}
/** a normal packed by packNormal, back to a unit vector (x east, y up, z south) */
export function unpackNormal(n: number): [number, number, number] {
  const i = Math.round(n), ex = ((i >> 12) / 4095) * 2 - 1, ey = ((i & 4095) / 4095) * 2 - 1;
  let x = ex, y = ey; const z = 1 - Math.abs(ex) - Math.abs(ey), k = Math.max(-z, 0);
  x += x >= 0 ? -k : k; y += y >= 0 ? -k : k;
  const l = Math.hypot(x, z, y) || 1; return [x / l, z / l, y / l];
}
const UP = packNormal(0, 1, 0);
/** floats per vertex of a mesh: x, height, z, colour, anchor x, anchor z, normal, id */
export const MESH_FLOATS = 8;

export class MeshBuilder {
  /** the vertices' numbers so far (`n` of them), in a typed array doubled as it fills: a list of numbers pushed to cost
   *  two thirds of a road tile's build (its growing and the collector) */
  private d = new Float32Array(256); private n = 0;
  /** per vertex: a leaf card's code (≥ 65536) or the material (0…255), + 512 when it takes the instance's colour
   *  (a tinted piece: shapeOf) */
  private ex = new Float64Array(32);
  /** what follows takes the instance's colour (core › geometry › shapes › builder: the finish's tint) */
  private tintNow = false;
  /** the material of what follows (core › geometry › shapes: finish) */
  private matNow = 0;
  /** the id the vertices carry now */
  idNow = 0;
  /** the anchor of what follows: its ground carries it (null: every vertex on its own ground) */
  private anchor: [number, number] | null = null;
  /** the vertices so far */
  get count(): number { return this.n / MESH_FLOATS; }
  /** the id the next vertices carry (picking) */
  as(id: number): this { this.idNow = id; return this; }
  /** the material of what follows (a code: core › render › look › materials; 0 matte) */
  material(code: number): this { this.matNow = code; return this; }
  /** what follows stands on the ground at one place (a building), or each vertex on its own ground (null: roads) */
  on(anchor: [number, number] | null): this { this.anchor = anchor; return this; }
  /** what follows raised by `y` metres (a building on its pad: 0 again after) */
  lift(y: number): this { this.liftNow = y; return this; }
  private liftNow = 0;
  /** the number written in place of the normal (a copy over time's emitter and copy: core › geometry › shapes ›
   *  builder › copy); null: the normal */
  normalNow: number | null = null;
  private v(p: V3, col: number, n: number): void {
    const a = this.anchor, i = this.n;
    if (i + MESH_FLOATS > this.d.length) this.room(i + MESH_FLOATS);
    const d = this.d;
    d[i] = p[0]; d[i + 1] = p[1] + this.liftNow; d[i + 2] = p[2]; d[i + 3] = col; d[i + 4] = a ? a[0] : p[0]; d[i + 5] = a ? a[1] : p[2]; d[i + 6] = this.normalNow ?? n; d[i + 7] = this.idNow;
    this.ex[i / MESH_FLOATS] = this.cardNow || this.matNow + (this.tintNow ? TINTED : 0);
    this.n = i + MESH_FLOATS;
  }
  /** room for `floats` numbers (and their vertices' extras): the arrays doubled, what is there kept */
  private room(floats: number): void {
    let size = this.d.length; while (size < floats) size *= 2;
    const d = new Float32Array(size), ex = new Float64Array(size / MESH_FLOATS);
    d.set(this.d.subarray(0, this.n)); ex.set(this.ex.subarray(0, this.n / MESH_FLOATS));
    this.d = d; this.ex = ex;
  }
  /** a triangle (counter-clockwise seen from its front), flat shaded */
  tri(a: V3, b: V3, c: V3, color: Colorish): this {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
    // (b − a) × (c − a): the axes (x east, y up, z south) turn right-handed, so a triangle counter-clockwise seen from
    // its front faces that way (on the map, north up, counter-clockwise faces up)
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz); if (l < 1e-12) return this;
    nx /= l; ny /= l; nz /= l;
    const col = rgbOf(color), n = Math.abs(ny) > 0.9999 && ny > 0 ? UP : packNormal(nx, ny, nz);
    this.v(a, col, n); this.v(b, col, n); this.v(c, col, n);
    return this;
  }
  quad(a: V3, b: V3, c: V3, d: V3, color: Colorish): this { return this.tri(a, b, c, color).tri(a, c, d, color); }
  /** a vertical wall from (ax, az) to (bx, bz), heights y0..y1 above the anchor's ground (its front: to the right of a → b
   *  seen from above, which is outward for a counter-clockwise ring in x east / z south) */
  wall(ax: number, az: number, bx: number, bz: number, y0: number, y1: number, color: Colorish, y0b = y0, y1b = y1): this {
    return this.quad([ax, y0, az], [bx, y0b, bz], [bx, y1b, bz], [ax, y1, az], color);
  }
  /** a box centred on (x, z), from y0 up by h, w along `angle` (radians from east towards south), d across; or by
   *  options: box({ size: [w, h, d], at: [x, y, z] (its centre), color, round: m (rounded edges) }) */
  box(o: SolidOptions): this;
  box(x: number, z: number, y0: number, w: number, h: number, d: number, angle: number, color: Colorish, top?: Colorish): this;
  box(xo: number | SolidOptions, z = 0, y0 = 0, w = 1, h = 1, d = 1, angle = 0, color: Colorish = '#ffffff', top?: Colorish): this {
    if (typeof xo === 'object') {
      const [sw, sh, sd] = sizeOf(xo.size, 1), at = xo.at ?? [0, 0, 0], c = xo.color ?? '#ffffff', r = Math.min(xo.round ?? 0, sw / 2, sh / 2, sd / 2);
      if (r > 0) return this.rounded(at, [sw / 2, sh / 2, sd / 2], r, c);
      return this.box(at[0], at[2], at[1] - sh / 2, sw, sh, sd, 0, c);
    }
    const x = xo;
    const c = Math.cos(angle), s = Math.sin(angle), hw = w / 2, hd = d / 2;
    const P = (u: number, v: number): [number, number] => [x + u * c - v * s, z + u * s + v * c];
    const q = [P(-hw, -hd), P(hw, -hd), P(hw, hd), P(-hw, hd)];
    // the corners go clockwise on the map: each wall from the next corner back (its front outward)
    for (let i = 0; i < 4; i++) { const a = q[i]!, b = q[(i + 1) % 4]!; this.wall(b[0], b[1], a[0], a[1], y0, y0 + h, color); }
    const t = top ?? color;
    this.quad([q[0]![0], y0 + h, q[0]![1]], [q[3]![0], y0 + h, q[3]![1]], [q[2]![0], y0 + h, q[2]![1]], [q[1]![0], y0 + h, q[1]![1]], t);
    return this;
  }
  /** a footprint raised from y0 to y1: walls round it and a flat roof (triangulated by `tris`: index triples) */
  prism(ring: readonly [number, number][], y0: number, y1: number, wall: Colorish, roof: Colorish, tris: readonly number[]): this {
    const n = ring.length, ccw = signedArea(ring) > 0;
    for (let i = 0; i < n; i++) {
      const a = ring[i]!, b = ring[(i + 1) % n]!;
      if (ccw) this.wall(a[0], a[1], b[0], b[1], y0, y1, wall); else this.wall(b[0], b[1], a[0], a[1], y0, y1, wall);
    }
    for (let k = 0; k + 2 < tris.length; k += 3) {
      const a = ring[tris[k]!]!, b = ring[tris[k + 1]!]!, c = ring[tris[k + 2]!]!;
      const up = (b[1] - a[1]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[1] - a[1]) > 0;
      if (up) this.tri([a[0], y1, a[1]], [b[0], y1, b[1]], [c[0], y1, c[1]], roof); else this.tri([a[0], y1, a[1]], [c[0], y1, c[1]], [b[0], y1, b[1]], roof);
    }
    return this;
  }
  /** a ribbon along a line on the ground: from `left` to `right` metres across (negative: left of the line), lifted
   *  `lift` metres, each vertex on its own ground */
  ribbon(pts: readonly [number, number][], left: number, right: number, lift: number, color: Colorish): this {
    const keep = this.anchor; this.anchor = null;
    for (let i = 0; i + 1 < pts.length; i++) {
      const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!, len = Math.hypot(bx - ax, bz - az); if (len < 1e-6) continue;
      // across: to the right of the direction (x east, z south: right of (dx, dz) is (-dz, dx))
      const nx = -(bz - az) / len, nz = (bx - ax) / len;
      const A0: V3 = [ax + nx * left, lift, az + nz * left], A1: V3 = [ax + nx * right, lift, az + nz * right];
      const B0: V3 = [bx + nx * left, lift, bz + nz * left], B1: V3 = [bx + nx * right, lift, bz + nz * right];
      this.quadUp(A0, A1, B1, B0, color);
    }
    this.anchor = keep;
    return this;
  }
  /** a flat polygon on the ground (a park, a lake), lifted, each vertex on its own ground: `tris` index triples */
  floor(ring: readonly [number, number][], lift: number, color: Colorish, tris: readonly number[]): this {
    const keep = this.anchor; this.anchor = null;
    for (let k = 0; k + 2 < tris.length; k += 3) { const a = ring[tris[k]!]!, b = ring[tris[k + 1]!]!, c = ring[tris[k + 2]!]!; this.triUp([a[0], lift, a[1]], [b[0], lift, b[1]], [c[0], lift, c[1]], color); }
    this.anchor = keep;
    return this;
  }
  /** a triangle with a normal at each corner (a smooth tube: a branch) */
  smoothTri(a: V3, na: V3, b: V3, nb: V3, c: V3, nc: V3, color: Colorish): this {
    const col = rgbOf(color);
    this.v(a, col, packNormal(na[0], na[1], na[2])); this.v(b, col, packNormal(nb[0], nb[1], nb[2])); this.v(c, col, packNormal(nc[0], nc[1], nc[2]));
    return this;
  }
  /** a card of leaves (instance shapes only): corners a b c d, its normal n; each corner carries the cut-out's
   *  coordinates and kind in place of the id (1 + u + v · 256 + kind · 65536, u and v 0 or 255): the shader cuts the
   *  leaves out of it */
  card(a: V3, b: V3, c: V3, d: V3, n: V3, kind: number, color: Colorish): this {
    const col = rgbOf(color), pn = packNormal(n[0], n[1], n[2]), keep = this.idNow, k = Math.max(1, Math.min(15, Math.round(kind))) * 65536;
    const at = (p: V3, u: number, v: number) => { this.cardNow = 1 + u * 255 + v * 255 * 256 + k; this.v(p, col, pn); };
    at(a, 0, 0); at(b, 1, 0); at(c, 1, 1); at(a, 0, 0); at(c, 1, 1); at(d, 0, 1);
    this.cardNow = 0; void keep;
    return this;
  }
  /** a quad / triangle facing up whatever its winding (ground pieces) */
  quadUp(a: V3, b: V3, c: V3, d: V3, color: Colorish): this { return this.triUp(a, b, c, color).triUp(a, c, d, color); }
  triUp(a: V3, b: V3, c: V3, color: Colorish): this {
    const col = rgbOf(color);
    const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]);
    if (ny >= 0) { this.v(a, col, UP); this.v(b, col, UP); this.v(c, col, UP); } else { this.v(a, col, UP); this.v(c, col, UP); this.v(b, col, UP); }
    return this;
  }
  /** a sphere-ish blob (an icosahedron, 0 or 1 subdivision) at (x, y, z), radii rx, ry, rz */
  blob(x: number, y: number, z: number, rx: number, ry: number, rz: number, color: Colorish, detail = 1): this {
    for (const [a, b, c] of icosphere(detail)) this.tri([x + a[0] * rx, y + a[1] * ry, z + a[2] * rz], [x + b[0] * rx, y + b[1] * ry, z + b[2] * rz], [x + c[0] * rx, y + c[1] * ry, z + c[2] * rz], color);
    return this;
  }
  /** a cylinder (n sides) on (x, z) from y0 to y1, radius r0 at the bottom, r1 at the top; or by options:
   *  cylinder({ radius, size: its length, at: its centre, axis: 'x' | 'y' | 'z', color, sides }) (with its ends) */
  cylinder(o: SolidOptions & { radius: number; sides?: number }): this;
  cylinder(x: number, z: number, y0: number, y1: number, r0: number, r1: number, n: number, color: Colorish): this;
  cylinder(xo: number | (SolidOptions & { radius: number; sides?: number }), z = 0, y0 = 0, y1 = 1, r0 = 1, r1 = 1, n = 8, color: Colorish = '#ffffff'): this {
    if (typeof xo === 'object') {
      const r = xo.radius, len = sizeOf(xo.size, 1)[1], at = xo.at ?? [0, 0, 0], sides = Math.max(3, xo.sides ?? 16), c = xo.color ?? '#ffffff', axis = xo.axis ?? 'y';
      // along y first, then turned onto its axis
      const tr = (p: V3): V3 => (axis === 'y' ? [at[0] + p[0], at[1] + p[1], at[2] + p[2]] : axis === 'x' ? [at[0] + p[1], at[1] + p[0], at[2] + p[2]] : [at[0] + p[0], at[1] + p[2], at[2] + p[1]]);
      const flip = axis !== 'y';
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2, b = ((i + 1) / sides) * Math.PI * 2, ca = Math.cos(a) * r, sa = Math.sin(a) * r, cb = Math.cos(b) * r, sb = Math.sin(b) * r, h = len / 2;
        const A = tr([cb, -h, sb]), B = tr([ca, -h, sa]), C = tr([ca, h, sa]), D = tr([cb, h, sb]), T = tr([0, h, 0]), U = tr([0, -h, 0]);
        if (flip) { this.quad(D, C, B, A, c); this.tri(T, C, D, c); this.tri(U, A, B, c); } else { this.quad(A, B, C, D, c); this.tri(T, D, C, c); this.tri(U, B, A, c); }
      }
      return this;
    }
    const x = xo;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, b = ((i + 1) / n) * Math.PI * 2;
      // the side faces outward: counter-clockwise seen from outside
      this.quad([x + Math.cos(b) * r0, y0, z + Math.sin(b) * r0], [x + Math.cos(a) * r0, y0, z + Math.sin(a) * r0], [x + Math.cos(a) * r1, y1, z + Math.sin(a) * r1], [x + Math.cos(b) * r1, y1, z + Math.sin(b) * r1], color);
    }
    return this;
  }
  /** a sphere: sphere({ radius, at: its centre, color, detail: 0..2 }) */
  sphere(o: { radius: number; at?: V3; color?: Colorish; detail?: number }): this {
    const at = o.at ?? [0, 0, 0]; return this.blob(at[0], at[1], at[2], o.radius, o.radius, o.radius, o.color ?? '#ffffff', Math.max(0, Math.min(2, o.detail ?? 1)));
  }
  /** a box with rounded edges: a sphere's grid pushed out onto the box's inner corner (its normals smooth) */
  private rounded(at: V3, half: V3, r: number, color: Colorish): this {
    const U = 16, V = 8, inner: V3 = [half[0] - r, half[1] - r, half[2] - r];
    const pt = (u: number, v: number): [V3, V3] => {
      const th = (u / U) * Math.PI * 2, ph = (v / V) * Math.PI, d: V3 = [Math.sin(ph) * Math.cos(th), Math.cos(ph), Math.sin(ph) * Math.sin(th)];
      const c: V3 = [Math.sign(d[0]) * inner[0], Math.sign(d[1]) * inner[1], Math.sign(d[2]) * inner[2]];
      return [[at[0] + c[0] + d[0] * r, at[1] + c[1] + d[1] * r, at[2] + c[2] + d[2] * r], d];
    };
    for (let v = 0; v < V; v++) for (let u = 0; u < U; u++) {
      const [a, na] = pt(u, v), [b, nb] = pt(u + 1, v), [c, nc] = pt(u + 1, v + 1), [d, nd] = pt(u, v + 1);
      this.smoothTri(a, na, b, nb, c, nc, color).smoothTri(a, na, c, nc, d, nd, color);
    }
    return this;
  }
  /** the numbers (MESH_FLOATS per vertex) */
  build(): Float32Array {
    // the material rides in the id's high part (ids are below 65536 a chunk); cards only in shapes (shapeOf)
    const out = this.d.slice(0, this.n);
    for (let i = 0, k = 0; i < out.length; i += MESH_FLOATS, k++) { const e = this.ex[k]! % TINTED; if (e > 0 && e < 256) out[i + 7] = out[i + 7]! + e * 65536; }
    return out;
  }
  /** take another builder's vertices as its own (a shape built elsewhere) */
  adopt(o: MeshBuilder): this {
    if (this.n + o.n > this.d.length) this.room(this.n + o.n);
    this.d.set(o.d.subarray(0, o.n), this.n); this.ex.set(o.ex.subarray(0, o.n / MESH_FLOATS), this.n / MESH_FLOATS); this.n += o.n;
    return this;
  }
  /** per vertex: a card's code or the material (shapeOf takes them) */
  extras(): Float32Array { return Float32Array.from(this.ex.subarray(0, this.n / MESH_FLOATS)); }
  /** a vertex with its own normal and material (core › geometry › shapes › builder) */
  solidVertex(p: V3, n: V3, color: Colorish, material = 0, tinted = false): this { const keep = this.matNow, kt = this.tintNow; this.matNow = material; this.tintNow = tinted; this.v(p, rgbOf(color), packNormal(n[0], n[1], n[2])); this.matNow = keep; this.tintNow = kt; return this; }
  private cardNow = 0;
}
/** a solid by options (box, cylinder): its size (one number: a cube's side, or [w, h, d]), its centre, its axis, colour,
 *  rounded edges (m) */
export interface SolidOptions { size?: number | readonly [number, number, number]; at?: V3; axis?: 'x' | 'y' | 'z'; color?: Colorish; round?: number }
const sizeOf = (s: SolidOptions['size'], def: number): [number, number, number] => (typeof s === 'number' ? [s, s, s] : s ? [s[0], s[1], s[2]] : [def, def, def]);
/** the signed area of a ring of (x east, z south) places: positive when it goes counter-clockwise on the map (north up) */
export function signedArea(r: readonly [number, number][]): number { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] + r[i]![0]) * (r[j]![1] - r[i]![1]); return a / 2; }

/** a builder's mark on a vertex that takes the instance's colour (a tinted piece) */
const TINTED = 512;
/** a shape vertex's mark: it keeps its own colour (a shape with tinted pieces: the others) */
export const OWN_COLOUR = 256;
/** floats per vertex of an instance's shape: x, y, z, normal, colour, leaf card (≥ 65536) or material (0…255; + 256:
 *  it keeps its own colour) */
export const SHAPE_FLOATS = 6;
/** a shape for instances, made with the builder (heights from 0 at its foot); its colours times the instance's (a
 *  white shape takes the instance's colour: a crown green, a trunk brown). With tinted pieces (the finish's `tint`),
 *  only those take it: the others keep their own (a car's paint by instance, its tyres and glass as built) */
export function shapeOf(make: (mb: MeshBuilder) => void): Float32Array {
  const mb = new MeshBuilder(); make(mb);
  const d = mb.build(), ex = mb.extras(), out = new Float32Array((d.length / MESH_FLOATS) * SHAPE_FLOATS);
  let tinted = false; for (const e of ex) if (e >= TINTED && e < 65536) { tinted = true; break; }
  for (let i = 0, j = 0, k = 0; i < d.length; i += MESH_FLOATS, j += SHAPE_FLOATS, k++) {
    const e = ex[k]!;
    out[j] = d[i]!; out[j + 1] = d[i + 1]!; out[j + 2] = d[i + 2]!; out[j + 3] = d[i + 6]!; out[j + 4] = d[i + 3]!;
    out[j + 5] = e >= 65536 ? e : e >= TINTED ? e - TINTED : e + (tinted ? OWN_COLOUR : 0);
  }
  return out;
}
/** floats per instance: x, z, height, id · scale x, y, z, turn · colour, the share of its leaf cards thinned out (0:
 *  all there) */
export const INSTANCE_FLOATS = 10;

let ico: [V3, V3, V3][][] = [];
/** the faces of a unit icosphere (0: 20 faces, 1: 80), outward counter-clockwise */
export function icosphere(detail: number): [V3, V3, V3][] {
  if (ico[detail]) return ico[detail]!;
  const t = (1 + Math.sqrt(5)) / 2;
  const vs: V3[] = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]].map((p) => { const l = Math.hypot(...(p as V3)); return [p[0]! / l, p[1]! / l, p[2]! / l] as V3; });
  let faces: [V3, V3, V3][] = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]].map(([a, b, c]) => [vs[a!]!, vs[b!]!, vs[c!]!]);
  for (let k = 0; k < detail; k++) {
    const next: [V3, V3, V3][] = [];
    const mid = (a: V3, b: V3): V3 => { const m: V3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2], l = Math.hypot(...m); return [m[0] / l, m[1] / l, m[2] / l]; };
    for (const [a, b, c] of faces) { const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a); next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]); }
    faces = next;
  }
  // the classic winding faces outward in right-handed axes, as ours are
  ico[detail] = faces;
  return ico[detail]!;
}
