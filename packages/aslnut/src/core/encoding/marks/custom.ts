// core › geometry › marks › custom: a whole visualisation of your own, on WebGPU and WebGL2 alike. One quad per item (facing
// the screen and sized in CSS px, or lying on the ground and sized in metres); your attributes per item, your uniforms
// (params: `w.set('<id>.<name>', v)` reaches the shader), your varyings, and your vertex and fragment code in the WGSL
// subset aslnut translates.
//   custom({ id: 'heat', data, at: d => d.at, size: 40, shape: 'ground', blend: 'add',
//            attributes: { value: d => d.v }, uniforms: { gain: 1.5, tint: '#ff5a00' }, varyings: { glow: 'f32' },
//            vertex: `glow = value * params.gain;`,
//            fragment: `let r = length(corner); color = vec4f(params.tint * glow, (1.0 - r) * glow);` })
import { AslnutError } from '../../world/errors.ts';
import { Element, type AttachContext, type FrameContext, type ElementProps, type Picked } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import type { DrawCall, GBuffer, GTexture, Program } from '../../render/graphics/interface.ts';
import { assembleCustom, assembleCustomMesh, paramBlock, type ParamValue } from '../../render/graphics/shaders/hooks.ts';
import { CUSTOM_MESH_GLSL } from '../../render/graphics/shaders/custom-mesh.glsl.ts';
import { CUSTOM_MESH_WGSL } from '../../render/graphics/shaders/custom-mesh.wgsl.ts';
import { CUSTOM_GLSL } from '../../render/graphics/shaders/custom.glsl.ts';
import { CUSTOM_WGSL } from '../../render/graphics/shaders/custom.wgsl.ts';
import { worldOf, type LonLatH } from '../../space/geo.ts';
import { rangeUnits, sizeUnits, sizeValue, type SizeOf, type SizeRange } from '../../render/drawing/size.ts';

export interface CustomProps<D> extends Omit<ElementProps, 'shader'> {
  data: D[];
  at: (d: D) => LonLatH;
  /** CSS px (shape 'screen') or metres (shape 'ground'), or either kept within a range of CSS px: `{ m, min, max }`,
   *  `{ px, min, max }` (core › render › drawing › size) */
  size?: SizeOf<number | ((d: D, s: State) => number)>;
  shape?: 'screen' | 'ground';
  /** per item: name → a function giving a number or 2..4 numbers */
  attributes?: Record<string, (d: D) => number | number[]>;
  /** your uniforms (the same as params) */
  uniforms?: Record<string, ParamValue>;
  /** vertex → fragment values: name → 'f32' | 'vec2f' | 'vec3f' | 'vec4f' */
  varyings?: Record<string, string>;
  /** statements; in scope: corner, position (var), size (var), time, your attributes, your varyings (var), params.* */
  vertex?: string;
  /** statements; in scope: corner, time, color (var, default white), your varyings, params.* */
  fragment?: string;
  /** helper functions for both */
  functions?: string;
  blend?: 'alpha' | 'add';
  opacity?: number;
  /** a depth lift so it never fights the ground */
  bias?: number;
}

export class Custom<D = unknown> extends Element<CustomProps<D> & ElementProps> {
  readonly kind = 'custom' as const;
  private prog: Program | null = null; private inst: GBuffer | null = null; private ubuf: GBuffer | null = null; private pbuf: GBuffer | null = null;
  private attrs: { name: string; size: 1 | 2 | 3 | 4; get: (d: D) => number | number[] }[] = [];
  /** your shader reading the clock changes by itself (render on change keeps drawing it) */
  override animating(): boolean { const p = this.props as unknown as { vertex?: string; fragment?: string }; return /\btime\b|frame\.eye\.w/.test(`${p.vertex ?? ''} ${p.fragment ?? ''}`); }
  private stride = 4; private cap = 0; private buf = new Float32Array(0); private u = new Float32Array(8); private n = 0;
  constructor(p: CustomProps<D>) {
    super({ ...p, params: { ...(p.uniforms ?? {}), ...(p.params ?? {}) } } as CustomProps<D> & ElementProps);
    if (!Array.isArray(p.data)) throw new AslnutError('E-DATA-001', `custom '${this.id}': data must be an array`, { where: this.id, fix: 'pass data: [...]' });
    if (typeof p.at !== 'function') throw new AslnutError('E-DATA-001', `custom '${this.id}': at must be a function d => [lon, lat, h?]`, { where: this.id, fix: 'at: d => d.at' });
    this.paramBlock ??= paramBlock({});
    // attribute types from the first item: a number → f32, n numbers → vecNf
    const first = p.data[0];
    for (const [name, get] of Object.entries(p.attributes ?? {})) {
      const v = first === undefined ? 0 : get(first), size = (Array.isArray(v) ? v.length : 1) as 1 | 2 | 3 | 4;
      if (size < 1 || size > 4) throw new AslnutError('E-SHADER-001', `attribute '${name}' gives ${size} numbers`, { where: this.id, fix: 'give a number or 2 to 4 numbers' });
      this.attrs.push({ name, size, get });
    }
    this.stride = 4 + this.attrs.reduce((a, x) => a + x.size, 0);
  }
  private code() { const p = this.props; return { attributes: Object.fromEntries(this.attrs.map((a) => [a.name, a.size === 1 ? 'f32' : `vec${a.size}f`])), varyings: p.varyings ?? {}, vertex: p.vertex, fragment: p.fragment, functions: p.functions }; }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    if (!ctx.graphics) return;
    this.ubuf = ctx.graphics.buffer('uniform', 32, `${this.id} misc`);
    this.pbuf = ctx.graphics.buffer('uniform', this.paramBlock!.size, `${this.id} params`);
    this.prog = this.build(this.code());
    await this.prog.ready;
  }
  private build(code: ReturnType<Custom<D>['code']>): Program {
    const src = assembleCustom({ wgsl: CUSTOM_WGSL, glsl: CUSTOM_GLSL }, code, this.paramBlock!, `layer '${this.id}'`);
    let off = 4;
    const attributes = [{ name: 'at', location: 0, size: 4 as const, offset: 0 }, ...src.attributes.map((a, k) => { const r = { name: `a_${a.name}`, location: k + 1, size: a.size, offset: off }; off += a.size; return r; })];
    return this.attached!.graphics!.program({ label: `custom ${this.id}`, wgsl: src.wgsl, glsl: src.glsl, blocks: ['Frame', 'U', 'Params'], instance: { stride: this.stride, attributes }, blend: this.props.blend ?? 'alpha', depth: { write: false, test: 'less' } });
  }
  /** new vertex / fragment / functions code (hot reload): the old program stays if the new one fails, and the error
   *  (with your line) is thrown */
  async setShader(code: { vertex?: string; fragment?: string; functions?: string }): Promise<void> {
    const next = { ...this.props, ...code };
    if (!this.attached?.graphics) { this.props = next; return; }
    const keep = this.props; this.props = next;
    let p: Program;
    try { p = this.build(this.code()); } catch (e) { this.props = keep; throw e; }
    try { await p.ready; } catch (e) { p.destroy(); this.props = keep; throw e; }
    this.prog?.destroy(); this.prog = p;
  }
  override readouts() { return { count: () => this.props.data.length, drawn: () => this.n }; }
  frame(ctx: FrameContext): DrawCall[] {
    if (!this.prog || !this.ubuf) return [];
    const p = this.props, s = ctx.s, cam = ctx.camera, ex = ctx.world.exaggeration, n = p.data.length, S = this.stride;
    if (!this.inst || this.cap < n) { this.inst?.destroy(); this.cap = Math.max(64, n * 2); this.inst = ctx.graphics.buffer('instance', this.cap * S * 4, `${this.id} instances`); this.buf = new Float32Array(this.cap * S); }
    let k = 0; const sv = sizeValue(p.size);
    for (const d of p.data) {
      const ll = p.at(d);
      if (!cam.facing(ll[0], ll[1])) continue;
      let h = ll[2]; if (h === undefined) { const g = ctx.world.heightAt(ll[0], ll[1]); h = Number.isNaN(g) ? 0 : g; }
      const P = worldOf(cam, ll[0], ll[1], h * ex), o = k * S;
      this.buf.set([P[0], P[1], P[2], typeof sv === 'function' ? sv(d, s) : sv ?? 12], o);
      let q = o + 4;
      for (const a of this.attrs) { const v = a.get(d); if (Array.isArray(v)) this.buf.set(v, q); else this.buf[q] = v; q += a.size; }
      k++;
    }
    this.n = k;
    if (!k) return [];
    this.inst.write(this.buf.subarray(0, k * S));
    this.u.set([p.bias ?? 0.00002, p.shape === 'ground' ? 1 : 0, p.opacity ?? 1, this.shown]);
    // its size's rule: on the ground a plain size is metres
    this.u.set(p.shape === 'ground' && (p.size === undefined || typeof p.size !== 'object') ? [1, 0, 1e6, 0] : sizeUnits(p.size, `custom '${this.id}' size`), 4);
    this.ubuf.write(this.u);
    if (this.paramsDirty) { this.pbuf!.write(this.paramBlock!.pack(this.paramValues)); this.paramsDirty = false; }
    return [{ program: this.prog, blocks: [ctx.frame, this.ubuf, this.pbuf!], instances: this.inst, count: 6, instanceCount: k }];
  }
  override detach(): void { for (const r of [this.prog, this.inst, this.ubuf, this.pbuf]) r?.destroy(); this.prog = null; this.inst = this.ubuf = this.pbuf = null; super.detach(); }
}
/** a custom layer: quads of your own per item (data, at), or your own geometry (geometry: triangles, lines, points) */
export function custom<D>(p: CustomMeshProps<D>): CustomMesh<D>;
export function custom<D>(p: CustomProps<D>): Custom<D>;
export function custom<D>(p: CustomProps<D> | CustomMeshProps<D>): Custom<D> | CustomMesh<D> { return 'geometry' in p && p.geometry ? new CustomMesh<D>(p as CustomMeshProps<D>) : new Custom<D>(p as CustomProps<D>); }

// ── your own geometry (vertex arrays drawn with your own shader) ────────────────────────────────────────────────
//   custom({ id: 'net', geometry: { positions, colors }, primitive: 'lines', at: [145.12, -37.92] })
//   custom({ id: 'kiosks', geometry: box, data: kiosks, at: d => d.at, attributes: { heat: d => d.v },
//            uniforms: { photo: { image: bitmap }, gain: 1.2 }, varyings: { glow: 'f32' },
//            vertex: `glow = heat * params.gain;`, fragment: `color = vec4f(tex_photo(uv).rgb * lambert(normal) * glow, 1.0);`,
//            blend: 'alpha', depth: { write: false }, side: 'double' })
/** an image for a texture uniform: tex_<name>(uv) reads it (uv 0,0 the image's top left) */
export type TexImage = ImageBitmap | HTMLCanvasElement | OffscreenCanvas | HTMLImageElement;
export interface CustomGeometry {
  /** x, y, z per vertex: metres from its copy's place (x east, y up, z south) */
  positions: ArrayLike<number>;
  normals?: ArrayLike<number>;
  uvs?: ArrayLike<number>;
  /** r, g, b (0..1) or r, g, b, a per vertex */
  colors?: ArrayLike<number>;
  /** your own per vertex: name → { data, size } */
  attributes?: Record<string, { data: ArrayLike<number>; size: 1 | 2 | 3 | 4 }>;
  /** vertex numbers: triangles (or line pairs) by index */
  index?: ArrayLike<number>;
}
export interface CustomMeshProps<D> extends Omit<ElementProps, 'shader'> {
  geometry: CustomGeometry;
  /** what the vertices make (default triangles): 'lines' takes them in pairs (a pixel wide), 'points' draws each as a
   *  square facing the screen, `pointSize` CSS px (your fragment reads `corner`, -1..1 across it) */
  primitive?: 'triangles' | 'lines' | 'points';
  pointSize?: number;
  /** each copy kept within a range of CSS px across (its geometry's own size in metres: core › render › drawing ›
   *  size); unset: as it is */
  size?: SizeRange;
  /** one copy at a place, or with data a copy per datum at its place */
  at?: LonLatH | ((d: D) => LonLatH);
  data?: D[];
  /** per copy: name → a function giving a number or 2..4 numbers */
  attributes?: Record<string, (d: D) => number | number[]>;
  /** numbers, 2 to 4 numbers, '#rrggbb', or { image } (a texture: tex_<name>(uv) → vec4f) */
  uniforms?: Record<string, ParamValue | { image: TexImage }>;
  varyings?: Record<string, string>;
  /** statements; in scope: position (var, metres), normal (var), uv, color (var), time, your attributes, varyings */
  vertex?: string;
  /** statements; in scope: color (var, default the vertex colour), uv, normal, position (world m), corner, time,
   *  varyings, params.*; lambert(normal) → the sky's light, tex_<name>(uv) your textures */
  fragment?: string;
  functions?: string;
  /** how it lies over what is behind it (default 'none': opaque); blended copies are drawn the farthest first */
  blend?: 'none' | 'alpha' | 'add' | 'multiply';
  /** depth test and write (default both on; off: always drawn over / leaves no depth) */
  depth?: { test?: boolean; write?: boolean };
  /** which faces are drawn (default 'double') */
  side?: 'front' | 'back' | 'double';
  opacity?: number;
  /** a depth lift (a fraction: what lies on another never fights it) */
  bias?: number;
  /** casts the sun's shadow (default false) */
  cast?: boolean;
  tooltip?: (d: D | null, s: State) => string | null | undefined;
}
const isImage = (v: unknown): v is { image: TexImage } => typeof v === 'object' && v !== null && !Array.isArray(v) && 'image' in (v as object);
export class CustomMesh<D = unknown> extends Element<CustomMeshProps<D> & ElementProps> {
  readonly kind = 'custom' as const;
  private prog: Program | null = null; private vbuf: GBuffer | null = null; private ibuf: GBuffer | null = null; private inst: GBuffer | null = null; private ubuf: GBuffer | null = null; private pbuf: GBuffer | null = null;
  private texs: GTexture[] = []; private texNames: string[] = [];
  private stride = 12; private count = 0; private istride = 4; private cap = 0; private buf = new Float32Array(0); private u = new Float32Array(12); private n = 0;
  /** the geometry's size across (m), for its range on screen */
  private across = 0;
  private vattrs: { name: string; size: 1 | 2 | 3 | 4 }[] = []; private iattrs: { name: string; size: 1 | 2 | 3 | 4; get: (d: D) => number | number[] }[] = [];
  private drawnOrder: number[] = [];
  constructor(p: CustomMeshProps<D>) {
    const numeric = Object.fromEntries(Object.entries(p.uniforms ?? {}).filter(([, v]) => !isImage(v))) as Record<string, ParamValue>;
    super({ ...p, params: { ...numeric, ...(p.params ?? {}) } } as CustomMeshProps<D> & ElementProps);
    const g = p.geometry;
    if (!g || !g.positions || g.positions.length < 3) throw new AslnutError('E-DATA-001', `custom '${this.id}': geometry.positions needs x, y, z per vertex`, { where: this.id, fix: 'geometry: { positions: [0, 0, 0, 1, 0, 0, 0, 1, 0] }' });
    if (p.data && typeof p.at !== 'function') throw new AslnutError('E-DATA-001', `custom '${this.id}': with data, at must be a function d => [lon, lat, h?]`, { where: this.id, fix: 'at: d => d.at' });
    this.paramBlock ??= paramBlock({});
    this.texNames = Object.entries(p.uniforms ?? {}).filter(([, v]) => isImage(v)).map(([k]) => k);
    const first = p.data?.[0];
    for (const [name, get] of Object.entries(p.attributes ?? {})) { const v = first === undefined ? 0 : get(first), size = (Array.isArray(v) ? v.length : 1) as 1 | 2 | 3 | 4; this.iattrs.push({ name, size, get }); }
    this.istride = 4 + this.iattrs.reduce((a, x) => a + x.size, 0);
    this.vattrs = Object.entries(g.attributes ?? {}).map(([name, a]) => ({ name, size: a.size }));
    this.stride = 12 + this.vattrs.reduce((a, x) => a + x.size, 0);
  }
  /** the vertices interleaved: position 3, normal 3, uv 2, colour 4, yours; indexed or expanded (points: six each) */
  private vertices(): { data: Float32Array; index: Uint32Array | null } {
    const g = this.props.geometry, nv = Math.floor(g.positions.length / 3), S = this.stride, pts = this.props.primitive === 'points';
    const cs = g.colors ? (g.colors.length >= nv * 4 ? 4 : 3) : 0;
    const one = (v: number, out: Float32Array, o: number) => {
      out[o] = g.positions[v * 3]!; out[o + 1] = g.positions[v * 3 + 1]!; out[o + 2] = g.positions[v * 3 + 2]!;
      out[o + 3] = g.normals ? g.normals[v * 3]! : 0; out[o + 4] = g.normals ? g.normals[v * 3 + 1]! : 1; out[o + 5] = g.normals ? g.normals[v * 3 + 2]! : 0;
      out[o + 6] = g.uvs ? g.uvs[v * 2]! : 0; out[o + 7] = g.uvs ? g.uvs[v * 2 + 1]! : 0;
      out[o + 8] = cs ? g.colors![v * cs]! : 1; out[o + 9] = cs ? g.colors![v * cs + 1]! : 1; out[o + 10] = cs ? g.colors![v * cs + 2]! : 1; out[o + 11] = cs === 4 ? g.colors![v * 4 + 3]! : 1;
      let q = o + 12; for (const a of this.vattrs) { const d = g.attributes![a.name]!.data; for (let k = 0; k < a.size; k++) out[q++] = d[v * a.size + k] ?? 0; }
    };
    if (pts) {
      const idx = g.index ? Array.from(g.index) : Array.from({ length: nv }, (_, i) => i), out = new Float32Array(idx.length * 6 * S);
      idx.forEach((v, k) => { for (let c = 0; c < 6; c++) one(v, out, (k * 6 + c) * S); });
      return { data: out, index: null };
    }
    const out = new Float32Array(nv * S); for (let v = 0; v < nv; v++) one(v, out, v * S);
    return { data: out, index: g.index ? Uint32Array.from(g.index) : null };
  }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    const g = ctx.graphics; if (!g) return;
    const p = this.props, vx = this.vertices();
    this.vbuf = g.buffer('vertex', vx.data, `${this.id} vertices`);
    this.ibuf = vx.index ? g.buffer('index', vx.index, `${this.id} index`) : null;
    this.count = vx.index ? vx.index.length : vx.data.length / this.stride;
    this.ubuf = g.buffer('uniform', 48, `${this.id} misc`);
    { const q = p.geometry.positions; let r = 0; for (let k = 0; k + 2 < q.length; k += 3) r = Math.max(r, Math.hypot(q[k]!, q[k + 1]!, q[k + 2]!)); this.across = 2 * r; }
    this.pbuf = g.buffer('uniform', this.paramBlock!.size, `${this.id} params`);
    for (const name of this.texNames) {
      let im = (p.uniforms![name] as { image: TexImage }).image;
      if (typeof HTMLImageElement !== 'undefined' && im instanceof HTMLImageElement) { await im.decode().catch(() => {}); im = await createImageBitmap(im); }
      const w = (im as { width: number }).width, h = (im as { height: number }).height;
      const t = g.texture({ label: `${this.id} ${name}`, width: Math.max(1, w), height: Math.max(1, h), format: 'rgba8', filter: 'linear' });
      t.writeImage(im as ImageBitmap); this.texs.push(t);
    }
    this.prog = this.build();
    await this.prog.ready;
  }
  private build(): Program {
    const p = this.props;
    const src = assembleCustomMesh({ wgsl: CUSTOM_MESH_WGSL, glsl: CUSTOM_MESH_GLSL }, {
      vertexAttributes: Object.fromEntries(this.vattrs.map((a) => [a.name, a.size === 1 ? 'f32' : `vec${a.size}f`])), instanceAttributes: Object.fromEntries(this.iattrs.map((a) => [a.name, a.size === 1 ? 'f32' : `vec${a.size}f`])),
      varyings: p.varyings ?? {}, textures: this.texNames, vertex: p.vertex, fragment: p.fragment, functions: p.functions,
    }, this.paramBlock!, `layer '${this.id}'`);
    let off = 12;
    const vattrs = [{ name: 'a_position', location: 0, size: 3 as const, offset: 0 }, { name: 'a_normal', location: 1, size: 3 as const, offset: 3 }, { name: 'a_uv', location: 2, size: 2 as const, offset: 6 }, { name: 'a_color', location: 3, size: 4 as const, offset: 8 },
      ...src.vertexAttrs.map((a, k) => { const r = { name: `a_${a.name}`, location: 5 + k, size: a.size, offset: off }; off += a.size; return r; })];
    let ioff = 4;
    const iattrs = [{ name: 'i_at', location: 4, size: 4 as const, offset: 0 }, ...src.instanceAttrs.map((a, k) => { const r = { name: `a_${a.name}`, location: 5 + src.vertexAttrs.length + k, size: a.size, offset: ioff }; ioff += a.size; return r; })];
    const d = p.depth ?? {}, side = p.side ?? 'double';
    return this.attached!.graphics!.program({
      label: `custom ${this.id}`, wgsl: src.wgsl, glsl: src.glsl, blocks: ['Frame', 'U', 'Params'],
      textures: this.texNames.map((n) => ({ name: `t_${n}`, kind: '2d' as const, sample: 'float' as const })),
      vertex: { stride: this.stride, attributes: vattrs }, instance: { stride: this.istride, attributes: iattrs },
      blend: p.blend ?? 'none', depth: { test: d.test === false ? 'always' : 'less', write: d.write ?? (p.blend ?? 'none') === 'none' },
      cull: side === 'double' ? 'none' : side === 'front' ? 'back' : 'front', topology: p.primitive === 'lines' ? 'lines' : 'triangles',
    });
  }
  override readouts() { return { copies: () => this.n }; }
  frame(ctx: FrameContext): DrawCall[] {
    if (!this.prog || !this.ubuf || !this.vbuf) return [];
    const p = this.props, cam = ctx.camera, ex = ctx.world.exaggeration, S = this.istride;
    const items: (D | null)[] = p.data ?? [null], n = items.length;
    if (!this.inst || this.cap < n) { this.inst?.destroy(); this.cap = Math.max(16, n * 2); this.inst = ctx.graphics.buffer('instance', this.cap * S * 4, `${this.id} copies`); this.buf = new Float32Array(this.cap * S); }
    // each copy's place in world metres; blended ones the farthest first (what is behind drawn before)
    const places: { k: number; P: [number, number, number]; d2: number }[] = [];
    for (let k = 0; k < n; k++) {
      const d = items[k]!, ll = typeof p.at === 'function' ? p.at(d as D) : p.at ?? [cam.lon, cam.lat];
      if (!cam.facing(ll[0], ll[1])) continue;
      let h = ll[2]; if (h === undefined) { const gh = ctx.world.heightAt(ll[0], ll[1]); h = Number.isNaN(gh) ? 0 : gh; }
      const P = worldOf(cam, ll[0], ll[1], h * ex), e = cam.eye;
      places.push({ k, P, d2: (P[0] - e[0]!) ** 2 + (P[1] - e[1]!) ** 2 + (P[2] - e[2]!) ** 2 });
    }
    if ((p.blend ?? 'none') !== 'none') places.sort((a, b) => b.d2 - a.d2);
    this.drawnOrder = places.map((x) => x.k);
    places.forEach((x, j) => {
      const o = j * S; this.buf.set([x.P[0], x.P[1], x.P[2], 0], o);
      let q = o + 4; const d = items[x.k]!;
      for (const a of this.iattrs) { const v = a.get(d as D); if (Array.isArray(v)) this.buf.set(v, q); else this.buf[q] = v; q += a.size; }
    });
    this.n = places.length;
    if (!this.n) return [];
    this.inst.write(this.buf.subarray(0, this.n * S));
    this.u.set([p.bias ?? 0, this.pickNo, p.opacity ?? 1, this.shown, p.pointSize ?? 6, p.primitive === 'points' ? 1 : 0, 0, 0]);
    { const r = rangeUnits(p.size, `custom '${this.id}' size`); this.u.set([this.across, r[1], r[2], p.size ? 1 : 0], 8); }
    this.ubuf.write(this.u);
    if (this.paramsDirty) { this.pbuf!.write(this.paramBlock!.pack(this.paramValues)); this.paramsDirty = false; }
    const prog = this.prog;
    return [{ program: prog, blocks: [ctx.frame, this.ubuf, this.pbuf!], textures: this.texs.length ? this.texs : undefined, vertices: this.vbuf, index: this.ibuf ?? undefined, instances: this.inst, count: this.count, instanceCount: this.n, pickProgram: () => prog, cast: p.cast }];
  }
  override pickInfo(index: number): Omit<Picked, 'at' | 'x' | 'y'> | null {
    const k = this.drawnOrder[index]; if (k === undefined) return null;
    const d = (this.props.data ?? [null])[k] as D;
    return { element: this.id, id: k, props: (d && typeof d === 'object' ? d : {}) as Record<string, unknown>, d, index };
  }
  override animating(): boolean { const p = this.props; return /\btime\b/.test(`${p.vertex ?? ''} ${p.fragment ?? ''}`); }
  override detach(): void { for (const r of [this.prog, this.vbuf, this.ibuf, this.inst, this.ubuf, this.pbuf, ...this.texs]) r?.destroy(); this.prog = null; this.vbuf = this.ibuf = this.inst = this.ubuf = this.pbuf = null; this.texs = []; super.detach(); }
}
