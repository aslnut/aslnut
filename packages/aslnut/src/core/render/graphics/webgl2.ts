// core › render › graphics › webgl2: the interface on WebGL2. Same programs (the GLSL twin), same textures (2D
// arrays, float data textures read with texelFetch in the vertex stage), same draws, same pixels.
import { AslnutError } from '../../world/errors.ts';
import { Held, tally, unreadable } from './live.ts';
import type { BufferKind, Caps, DrawCall, FrameOptions, GBuffer, GTarget, GTexture, Graphics, Program, ProgramDesc, TextureDesc } from './interface.ts';
import { FXAA_GLSL } from './shaders/fxaa.glsl.ts';

// the layer copy's shaders (a pool grown by need, an image into a layer of an array): one triangle over the target's
// rectangle (its corner `at`), each texel fetched from the source as it is. WebGL2's own: WebGPU copies texture to
// texture (copyTextureToTexture)
const COPY_VERTEX = /* glsl */ `#version 300 es
void main() {
  float x = float((gl_VertexID << 1) & 2) * 2.0 - 1.0;
  float y = float(gl_VertexID & 2) * 2.0 - 1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
}
`;
const COPY_GLSL = {
  vertex: COPY_VERTEX,
  /** from a layer of a 2D array */
  layer: /* glsl */ `#version 300 es
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray src;
uniform int layer;
uniform ivec2 at;
out vec4 outColor;
void main() {
  outColor = texelFetch(src, ivec3(ivec2(gl_FragCoord.xy) - at, layer), 0);
}
`,
  /** from a 2D texture */
  plane: /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D src;
uniform ivec2 at;
out vec4 outColor;
void main() {
  outColor = texelFetch(src, ivec2(gl_FragCoord.xy) - at, 0);
}
`,
};

interface PBuf extends GBuffer { buf: WebGLBuffer; target: number; /** a number for the vertex arrays' cache */ vid: number; version: number }
interface PTex extends GTexture { tex: WebGLTexture; target: number }
interface PProg extends Program { prog: WebGLProgram | null; vao: WebGLVertexArrayObject | null; ok: boolean; depthUnit: number; /** the unit of the terrain's kept depth (groundDepth) */ groundUnit: number; /** a vertex array per (instances, vertices) pair it draws with: their pointers set once */ vaos: Map<number, WebGLVertexArrayObject> }
/** a picture drawn into: colour and depth renderbuffers, and (made on first need) a copy of its depth as a texture */
interface Scene { fb: WebGLFramebuffer; color: WebGLRenderbuffer | null; colorTex?: WebGLTexture; depth: WebGLRenderbuffer; w: number; h: number; copyFb: WebGLFramebuffer | null; copy: WebGLTexture | null; /** the terrain's depth kept before the solids (made on first need) */ keptFb?: WebGLFramebuffer | null; kept?: WebGLTexture | null }
interface PTarget extends GTarget { scene: Scene | null; layerFb?: WebGLFramebuffer }

export function createWebGL2(canvas: HTMLCanvasElement | OffscreenCanvas): Graphics {
  const gl = canvas.getContext('webgl2', { antialias: false, depth: true, stencil: false, alpha: false, premultipliedAlpha: false, preserveDrawingBuffer: false, powerPreference: 'high-performance' }) as WebGL2RenderingContext | null;
  if (!gl) throw new Error('the canvas gave no WebGL2 context');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  const caps: Caps = {
    api: 'webgl2', compute: false, timer: !!gl.getExtension('EXT_disjoint_timer_query_webgl2'), floatTargets: !!gl.getExtension('EXT_color_buffer_float'),
    maxTex: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number, maxLayers: gl.getParameter(gl.MAX_ARRAY_TEXTURE_LAYERS) as number,
    vertexTextures: gl.getParameter(gl.MAX_VERTEX_TEXTURE_IMAGE_UNITS) as number, f16: false,
    device: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : '',
  };
  let width = canvas.width, height = canvas.height, bytes = 0, dead = false, uploads = 0; const held = new Held();
  const stats = { draws: 0, passes: 0, uploadBytes: 0, uploads: 0, gpuMs: null as number | null, uploadMaxMs: 0 }; let nUp = 0, upMax = 0;
  // the chip's time per frame (where the driver tells it): one query in flight at a time, read when ready, never waited on
  const timerExt = gl.getExtension('EXT_disjoint_timer_query_webgl2') as { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  let timerQ: WebGLQuery | null = null, timerOpen = false;
  const timerBegin = () => { if (!timerExt || timerQ) return; timerQ = gl.createQuery(); if (!timerQ) return; gl.beginQuery(timerExt.TIME_ELAPSED_EXT, timerQ); timerOpen = true; };
  const timerEnd = () => { if (timerOpen && timerExt) { gl.endQuery(timerExt.TIME_ELAPSED_EXT); timerOpen = false; } };
  const timerPoll = () => {
    if (!timerExt || !timerQ || timerOpen) return;
    if (!gl.getQueryParameter(timerQ, gl.QUERY_RESULT_AVAILABLE)) return;
    const disjoint = gl.getParameter(timerExt.GPU_DISJOINT_EXT) as boolean;
    if (!disjoint) stats.gpuMs = +((gl.getQueryParameter(timerQ, gl.QUERY_RESULT) as number) / 1e6).toFixed(2);
    gl.deleteQuery(timerQ); timerQ = null;
  };
  const timed = <T>(f: () => T): T => { const t0 = performance.now(); try { return f(); } finally { const ms = performance.now() - t0; if (ms > upMax) upMax = ms; } };
  // an off-screen scene for frames with draws that read the depth (the canvas's own depth cannot be read): drawn
  // there, then its colour copied to the canvas in one blit
  const makeScene = (W: number, H: number, sampled = false): Scene => {
    const fb = gl.createFramebuffer()!, depth = gl.createRenderbuffer()!;
    // sampled (the shadow map): its colour is a texture later draws read
    const color = sampled ? null : gl.createRenderbuffer()!, colorTex = sampled ? gl.createTexture()! : undefined;
    if (color) { gl.bindRenderbuffer(gl.RENDERBUFFER, color); gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, W, H); }
    if (colorTex) { gl.bindTexture(gl.TEXTURE_2D, colorTex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, W, H); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); gl.bindTexture(gl.TEXTURE_2D, null); }
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth); gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, W, H);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    if (color) gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, color);
    else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, colorTex!, 0);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return { fb, color, colorTex, depth, w: W, h: H, copyFb: null, copy: null };
  };
  const freeScene = (sc: Scene) => { gl.deleteFramebuffer(sc.fb); if (sc.color) gl.deleteRenderbuffer(sc.color); if (sc.colorTex) gl.deleteTexture(sc.colorTex); gl.deleteRenderbuffer(sc.depth); if (sc.copyFb) gl.deleteFramebuffer(sc.copyFb); if (sc.copy) gl.deleteTexture(sc.copy); if (sc.keptFb) gl.deleteFramebuffer(sc.keptFb); if (sc.kept) gl.deleteTexture(sc.kept); };
  /** the depth drawn so far, copied into a texture the next draws read (a blit: same format, no feedback loop) */
  const snapshot = (sc: Scene) => {
    if (!sc.copy) {
      sc.copy = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, sc.copy);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, sc.w, sc.h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
      sc.copyFb = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, sc.copyFb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, sc.copy, 0);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sc.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sc.copyFb);
    gl.blitFramebuffer(0, 0, sc.w, sc.h, 0, 0, sc.w, sc.h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sc.fb);
  };
  /** the terrain's depth kept (a draw marked keepDepth: before the twin's solids) for the draped marks' parts drawn
   *  over them (groundDepth): one more blit, only in frames that have such parts */
  const keep = (sc: Scene) => {
    if (!sc.kept) {
      sc.kept = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, sc.kept);
      gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, sc.w, sc.h);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.bindTexture(gl.TEXTURE_2D, null);
      sc.keptFb = gl.createFramebuffer()!; gl.bindFramebuffer(gl.FRAMEBUFFER, sc.keptFb); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, sc.kept, 0);
    }
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sc.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, sc.keptFb!);
    gl.blitFramebuffer(0, 0, sc.w, sc.h, 0, 0, sc.w, sc.h, gl.DEPTH_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.FRAMEBUFFER, sc.fb);
  };
  let main: Scene | null = null;
  // the anti-aliased frame: drawn into `aaScene` (its colour a texture, filtered), then through FXAA onto the canvas
  let aaScene: Scene | null = null, aaProg: WebGLProgram | null = null, aaVao: WebGLVertexArrayObject | null = null;
  const aaProgram = (): WebGLProgram | null => {
    if (aaProg) return aaProg;
    const pr = gl.createProgram()!, vs = gl.createShader(gl.VERTEX_SHADER)!, fs = gl.createShader(gl.FRAGMENT_SHADER)!;
    gl.shaderSource(vs, FXAA_GLSL.vertex); gl.compileShader(vs); gl.shaderSource(fs, FXAA_GLSL.fragment); gl.compileShader(fs);
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr);
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { gl.deleteProgram(pr); return null; }
    gl.useProgram(pr); gl.uniform1i(gl.getUniformLocation(pr, 'pic'), 0); aaVao = gl.createVertexArray();
    return (aaProg = pr);
  };
  // a 2D texture images land in on their way into a layer of an array (see writeImage)
  let staging: { tex: WebGLTexture; w: number; h: number } | null = null;
  const stage = (w: number, h: number) => {
    if (staging && staging.w === w && staging.h === h) return staging;
    if (staging) gl.deleteTexture(staging.tex);
    const t = gl.createTexture()!; gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, w, h);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return (staging = { tex: t, w, h });
  };
  // a layer copied on the chip (a pool grown by need, an image from the staging texture into its layer) is drawn: one
  // triangle over the target, each texel fetched from the source (COPY_GLSL). WebGL2's copy from a
  // framebuffer (copyTexSubImage3D) dropped layers when the GPU process was busy (a GPU and a CPU load): some silently,
  // and from some layer on every copy refused with an incomplete framebuffer; the settled view showed black tiles.
  // Drawn, in a framebuffer of its own a layer, none was lost (the copy alone beside a page busy drawing: 40 of 1,080
  // layers lost by the framebuffer copy, none of 1,080 drawn)
  type CopyKind = 'layer' | 'plane';
  const copier: { layer: WebGLProgram | null; plane: WebGLProgram | null; linking: Partial<Record<CopyKind, WebGLProgram>>; vao: WebGLVertexArrayObject | null; uLayer: WebGLUniformLocation | null; uAt: [WebGLUniformLocation | null, WebGLUniformLocation | null] } = { layer: null, plane: null, linking: {}, vao: null, uLayer: null, uAt: [null, null] };
  /** its program linked ahead (when a texture is made that may need it): its first copy does not wait for it */
  const linkCopy = (kind: CopyKind): void => {
    if (copier[kind] || copier.linking[kind]) return;
    const pr = gl.createProgram()!, vs = shader(gl.VERTEX_SHADER, COPY_GLSL.vertex), fs = shader(gl.FRAGMENT_SHADER, COPY_GLSL[kind]);
    gl.attachShader(pr, vs); gl.attachShader(pr, fs); gl.linkProgram(pr); gl.deleteShader(vs); gl.deleteShader(fs);
    copier.linking[kind] = pr;
  };
  const copyProgram = (from: number): WebGLProgram | null => {
    const kind: CopyKind = from === gl.TEXTURE_2D_ARRAY ? 'layer' : 'plane', had = copier[kind]; if (had) return had;
    linkCopy(kind);
    const pr = copier.linking[kind]!; delete copier.linking[kind];
    if (!gl.getProgramParameter(pr, gl.LINK_STATUS)) { gl.deleteProgram(pr); return null; }
    gl.useProgram(pr); gl.uniform1i(gl.getUniformLocation(pr, 'src'), 0);
    if (kind === 'layer') copier.uLayer = gl.getUniformLocation(pr, 'layer');
    copier.uAt[kind === 'layer' ? 0 : 1] = gl.getUniformLocation(pr, 'at');
    gl.useProgram(null);
    copier.vao ??= gl.createVertexArray();
    return (copier[kind] = pr);
  };
  /** the errors earlier calls left (at most one a kind): not this copy's */
  const clearErrors = () => { for (let i = 0; i < 8 && gl.getError() !== gl.NO_ERROR; i++); };
  /** a w × h rectangle of `from` (its layer `fl`, or the whole of a 2D one) drawn into `to` at (x, y) (its layer `tl`,
   *  or a 2D one), through a framebuffer of its own; every copy since clearErrors() landed (said by the context once:
   *  one round trip to the GPU process for a run of copies) is `landed()` */
  const drawCopy = (from: { tex: WebGLTexture; target: number }, fl: number, to: { tex: WebGLTexture; target: number }, tl: number, x: number, y: number, w: number, h: number): boolean => {
    const pr = copyProgram(from.target); if (!pr) return false;
    const fb = gl.createFramebuffer()!;
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    if (to.target === gl.TEXTURE_2D_ARRAY) gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, to.tex, 0, tl); else gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, to.tex, 0);
    gl.viewport(x, y, w, h);
    gl.disable(gl.BLEND); gl.disable(gl.DEPTH_TEST); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST); gl.disable(gl.DITHER);
    gl.useProgram(pr);
    const layered = from.target === gl.TEXTURE_2D_ARRAY;
    if (layered) gl.uniform1i(copier.uLayer, fl);
    gl.uniform2i(copier.uAt[layered ? 0 : 1], x, y);
    gl.activeTexture(gl.TEXTURE0); gl.bindTexture(from.target, from.tex);
    gl.bindVertexArray(copier.vao); gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null);
    gl.bindTexture(from.target, null); gl.useProgram(null); gl.enable(gl.DITHER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb);
    return true;
  };
  /** every copy since clearErrors() landed: no error, the context still there */
  const landed = () => !dead && gl.getError() === gl.NO_ERROR && !gl.isContextLost();
  // reading pixels back without stalling: into a pixel buffer, then fetched when the chip says it is done
  const readAsync = (w: number, h: number): Promise<Uint8Array> => {
    const pbo = gl.createBuffer()!;
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, w * h * 4, gl.STREAM_READ);
    gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!; gl.flush();
    return new Promise((ok, bad) => {
      const poll = () => {
        if (dead || gl.isContextLost()) { bad(new AslnutError('E-GPU-004', 'the WebGL2 context was lost', { fix: 'reload the page' })); return; }
        const st = gl.clientWaitSync(sync, 0, 0);
        if (st === gl.TIMEOUT_EXPIRED) { setTimeout(poll, 1); return; }
        gl.deleteSync(sync);
        const raw = new Uint8Array(w * h * 4), px = new Uint8Array(w * h * 4);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, raw); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.deleteBuffer(pbo);
        for (let y = 0; y < h; y++) px.set(raw.subarray((h - 1 - y) * w * 4, (h - y) * w * 4), y * w * 4);
        ok(px);
      };
      poll();
    });
  };
  const owned = new Set<{ destroy(): void }>();
  // (a frame being made: what is destroyed meanwhile is deleted once it is drawn, its draws may hold it)
  let holding = false; const later: (() => void)[] = [];
  const gone = (f: () => void): void => { if (holding) later.push(f); else f(); };
  // vertex arrays per (program, instances, vertices): the attribute pointers set once, not each draw
  let vids = 0; const progs = new Set<PProg>();
  const vaoOf = (p: PProg, inst: PBuf | undefined, vert: PBuf | undefined): WebGLVertexArrayObject | null => {
    const desc = p.desc; if (!desc.instance && !desc.vertex) return p.vao;
    const key = (inst && desc.instance ? inst.vid : 0) * 4194304 + (vert && desc.vertex ? vert.vid : 0);
    let v = p.vaos.get(key); if (v) return v;
    v = gl.createVertexArray()!; gl.bindVertexArray(v);
    const set = (b: PBuf | undefined, layout: { stride: number; attributes: { location: number; size: number; offset: number }[] } | undefined, div: number) => {
      if (!layout) return;
      for (const a of layout.attributes) { gl.enableVertexAttribArray(a.location); gl.vertexAttribDivisor(a.location, div); }
      if (!b) return;
      gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
      for (const a of layout.attributes) gl.vertexAttribPointer(a.location, a.size, gl.FLOAT, false, layout.stride * 4, a.offset * 4);
      gl.bindBuffer(gl.ARRAY_BUFFER, null);
    };
    set(inst, desc.instance, 1); set(vert, desc.vertex, 0);
    p.vaos.set(key, v);
    return v;
  };
  const forgetVaos = (vid: number) => {
    for (const p of progs) for (const [k, v] of p.vaos) if (Math.floor(k / 4194304) === vid || k % 4194304 === vid) { gl.deleteVertexArray(v); p.vaos.delete(k); }
  };
  let onLost: (r: string) => void = () => {};
  const lost = new Promise<string>((r) => { onLost = r; });
  const lostHandler = (e: Event) => { e.preventDefault(); dead = true; onLost('the WebGL2 context was lost'); };
  canvas.addEventListener('webglcontextlost', lostHandler as EventListener);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  tally.open(); let closed = false;
  gl.pixelStorei(gl.PACK_ALIGNMENT, 1);

  // programs compile in the background where the driver can (KHR_parallel_shader_compile): frames go on drawing what
  // is ready while a layer's program links; its status is read only when it is done
  const parallel = gl.getExtension('KHR_parallel_shader_compile') as { COMPLETION_STATUS_KHR: number } | null;
  const shader = (type: number, src: string): WebGLShader => { const s = gl.createShader(type)!; gl.shaderSource(s, src); gl.compileShader(s); return s; };
  const checked = (s: WebGLShader, type: number, label: string): void => {
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS) && !gl.isContextLost()) {
      const log = gl.getShaderInfoLog(s) ?? '';
      throw new AslnutError('E-GPU-003', `WebGL2 could not compile the ${type === gl.VERTEX_SHADER ? 'vertex' : 'fragment'} shader of '${label}': ${log.trim()}`, { where: label, fix: 'if this is your shader code, check the line given; otherwise report it with the browser and device', details: { glsl: gl.getShaderSource(s) ?? '' } });
    }
  };

  const g: Graphics = {
    api: 'webgl2', caps, lost, stats,
    flush() { if (!dead) gl.flush(); },
    get width() { return width; }, get height() { return height; }, get bytes() { return bytes; }, memory: () => held.list(),
    resize(w, h) { width = Math.max(1, Math.round(w)); height = Math.max(1, Math.round(h)); if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height; },
    buffer(kind: BufferKind, sizeOrData, _label) {
      const target = kind === 'uniform' ? gl.UNIFORM_BUFFER : kind === 'index' ? gl.ELEMENT_ARRAY_BUFFER : gl.ARRAY_BUFFER;
      const data = typeof sizeOrData === 'number' ? null : sizeOrData;
      const size = Math.max(kind === 'uniform' ? 16 : 4, Math.ceil((data ? data.byteLength : (sizeOrData as number)) / 4) * 4);
      const buf = gl.createBuffer()!;
      gl.bindVertexArray(null);
      gl.bindBuffer(target, buf); gl.bufferData(target, size, gl.DYNAMIC_DRAW); gl.bindBuffer(target, null);
      bytes += size; const lab = _label ?? kind; held.add(lab, size);
      const b: PBuf = {
        kind, size, buf, target, vid: ++vids, uid: vids, version: 0,
        write(d, off = 0) {
          b.version++;
          if (dead) return;
          gl.bindVertexArray(null); gl.bindBuffer(target, buf);
          // all of it written again (a uniform block each frame, a layer's records): fresh storage first, so a driver
          // never copies (or waits for) the old contents that frames still in flight are reading
          if (off === 0 && d.byteLength >= size) gl.bufferData(target, size, gl.DYNAMIC_DRAW);
          gl.bufferSubData(target, off, d); gl.bindBuffer(target, null); nUp++; uploads += d.byteLength;
        },
        destroy() { if (owned.delete(b)) { bytes -= size; held.remove(lab, size); tally.remove('buffers', size); gone(() => { gl.deleteBuffer(buf); forgetVaos(b.vid); }); } },
      };
      owned.add(b); tally.add('buffers', size);
      if (data) b.write(data);
      return b;
    },
    texture(desc: TextureDesc) {
      const target = desc.layers !== undefined ? gl.TEXTURE_2D_ARRAY : gl.TEXTURE_2D;
      const internal = desc.format === 'rgba8' ? gl.RGBA8 : desc.format === 'rgba32f' ? gl.RGBA32F : gl.R32F;
      // (an array: its layers may be copied (grown) or drawn from images, so the copies' programs link meanwhile)
      if (target === gl.TEXTURE_2D_ARRAY && !dead) { linkCopy('layer'); if (desc.format === 'rgba8') linkCopy('plane'); }
      const tex = gl.createTexture()!;
      gl.bindTexture(target, tex);
      if (target === gl.TEXTURE_2D_ARRAY) gl.texStorage3D(target, 1, internal, desc.width, desc.height, desc.layers!);
      else gl.texStorage2D(target, 1, internal, desc.width, desc.height);
      // float textures are read with texelFetch: nearest keeps them complete without the float-linear extension
      const filter = desc.format === 'rgba8' && (desc.filter ?? 'linear') === 'linear' ? gl.LINEAR : gl.NEAREST;
      gl.texParameteri(target, gl.TEXTURE_MIN_FILTER, filter); gl.texParameteri(target, gl.TEXTURE_MAG_FILTER, filter);
      gl.texParameteri(target, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(target, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.bindTexture(target, null);
      const size = desc.width * desc.height * (desc.layers ?? 1) * (desc.format === 'rgba32f' ? 16 : 4);
      bytes += size; const lab = desc.label ?? 'texture'; held.add(lab, size);
      const fmt = desc.format === 'r32f' ? gl.RED : gl.RGBA, type = desc.format === 'rgba8' ? gl.UNSIGNED_BYTE : gl.FLOAT;
      const t: PTex = {
        desc, tex, target,
        write(d, o = {}) {
          if (dead) return;
          const w = o.width ?? desc.width, h = o.height ?? desc.height;
          timed(() => {
            gl.bindTexture(target, tex);
            if (target === gl.TEXTURE_2D_ARRAY) gl.texSubImage3D(target, 0, o.x ?? 0, o.y ?? 0, o.layer ?? 0, w, h, 1, fmt, type, d);
            else gl.texSubImage2D(target, 0, o.x ?? 0, o.y ?? 0, w, h, fmt, type, d);
            gl.bindTexture(target, null);
          });
          nUp++; uploads += w * h * (desc.format === 'rgba32f' ? 16 : 4);
        },
        writeImage(src, o = {}) {
          if (dead) return;
          // (a canvas's colours times alpha here; a bitmap keeps how it was made: premultiplyAlpha: 'premultiply')
          if (o.premultiplied) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
          timed(() => {
            if (target === gl.TEXTURE_2D_ARRAY) {
              // browsers copy an image into a 2D texture on the chip, but into a layer of an array through the CPU: so
              // into a 2D texture first, then from it into the layer (drawn on the chip: see drawCopy)
              const st = stage(src.width, src.height);
              clearErrors();
              gl.bindTexture(gl.TEXTURE_2D, st.tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, src.width, src.height, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource); gl.bindTexture(gl.TEXTURE_2D, null);
              // (one that did not land is an error: the tile loads again, never shown blank as loaded)
              if (!drawCopy({ tex: st.tex, target: gl.TEXTURE_2D }, 0, t, o.layer ?? 0, o.x ?? 0, o.y ?? 0, src.width, src.height) || !landed()) {
                if (o.premultiplied) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
                throw new AslnutError('E-GPU-005', `WebGL2 did not draw an image into layer ${o.layer ?? 0} of '${desc.label ?? 'texture'}'`, { where: desc.label, fix: 'nothing to do: it is loaded again' });
              }
            } else { gl.bindTexture(target, tex); gl.texSubImage2D(target, 0, o.x ?? 0, o.y ?? 0, src.width, src.height, gl.RGBA, gl.UNSIGNED_BYTE, src as TexImageSource); }
            gl.bindTexture(target, null);
          });
          if (o.premultiplied) gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
          nUp++; uploads += src.width * src.height * 4;
        },
        destroy() { if (owned.delete(t)) { bytes -= size; held.remove(lab, size); tally.remove('textures', size); gone(() => gl.deleteTexture(tex)); } },
      };
      owned.add(t); tally.add('textures', size);
      return t;
    },
    copyLayers(from: GTexture, to: GTexture, layers: number) {
      const a = from as PTex, b = to as PTex, n = Math.min(layers, a.desc.layers ?? 1, b.desc.layers ?? 1);
      if (dead || n <= 0) return true;
      // (each layer drawn into the new one: a float one only where floats can be drawn into)
      if (a.desc.format !== 'rgba8' && !caps.floatTargets) return false;
      const w = Math.min(a.desc.width, b.desc.width), h = Math.min(a.desc.height, b.desc.height);
      clearErrors();
      for (let l = 0; l < n; l++) if (!drawCopy(a, l, b, l, 0, 0, w, h)) return false;
      // a copy that did not land is said (false: `from` as it was), never left to show as blank layers
      return landed();
    },
    layerTarget(texture: GTexture, layer: number) {
      const tx = texture as PTex, fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      if (tx.target === gl.TEXTURE_2D) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx.tex, 0); else gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tx.tex, 0, layer);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      const t: PTarget = { width: tx.desc.width, height: tx.desc.height, scene: null, layerFb: fb, destroy() { if (owned.delete(t)) { tally.remove('targets'); gone(() => gl.deleteFramebuffer(fb)); } } };
      owned.add(t); tally.add('targets');
      return t;
    },
    target(w: number, h: number, o: { sampled?: boolean; label?: string } = {}) {
      const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h)), scene = makeScene(W, H, !!o.sampled);
      bytes += W * H * 8; const lab = o.label ?? 'target'; held.add(lab, W * H * 8);
      const texture: PTex | undefined = scene.colorTex ? { desc: { label: 'target', width: W, height: H, format: 'rgba8', filter: 'nearest' }, tex: scene.colorTex, target: gl.TEXTURE_2D, write() { throw new AslnutError('E-GPU-003', 'a target is drawn into, not written', { fix: 'draw into it with frame({ target })' }); }, writeImage() { throw new AslnutError('E-GPU-003', 'a target is drawn into, not written', { fix: 'draw into it with frame({ target })' }); }, destroy() {} } : undefined;
      const t: PTarget = { width: W, height: H, scene, texture, destroy() { if (owned.delete(t)) { bytes -= W * H * 8; held.remove(lab, W * H * 8); tally.remove('targets', W * H * 8); gone(() => freeScene(scene)); } } };
      owned.add(t); tally.add('targets', W * H * 8);
      return t;
    },
    program(desc: ProgramDesc) {
      const p: PProg = { label: desc.label, desc, prog: null, vao: null, ok: false, depthUnit: (desc.textures ?? []).length, groundUnit: (desc.textures ?? []).length + 1, vaos: new Map(), ready: Promise.resolve(), destroy() { if (owned.delete(p)) { tally.remove('programs'); if (p.prog) gl.deleteProgram(p.prog); if (p.vao) gl.deleteVertexArray(p.vao); for (const v of p.vaos.values()) gl.deleteVertexArray(v); p.vaos.clear(); progs.delete(p); } } };
      const vs = shader(gl.VERTEX_SHADER, desc.glsl.vertex), fs = shader(gl.FRAGMENT_SHADER, desc.glsl.fragment);
      const prog = gl.createProgram()!;
      gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
      const finish = () => {
        if (!gl.getProgramParameter(prog, gl.LINK_STATUS) && !gl.isContextLost()) {
          // a compile error names the shader and the line; else the link's own message
          try { checked(vs, gl.VERTEX_SHADER, desc.label); checked(fs, gl.FRAGMENT_SHADER, desc.label); } finally { gl.deleteShader(vs); gl.deleteShader(fs); }
          const log = gl.getProgramInfoLog(prog) ?? ''; gl.deleteProgram(prog);
          throw new AslnutError('E-GPU-003', `WebGL2 could not link '${desc.label}': ${log.trim()}`, { where: desc.label, fix: 'the vertex and fragment shaders must agree on their in / out values' });
        }
        gl.deleteShader(vs); gl.deleteShader(fs);
        desc.blocks.forEach((name, i) => { const ix = gl.getUniformBlockIndex(prog, name); if (ix !== gl.INVALID_INDEX) gl.uniformBlockBinding(prog, ix, i); });
        gl.useProgram(prog);
        (desc.textures ?? []).forEach((t, i) => { const loc = gl.getUniformLocation(prog, t.name); if (loc) gl.uniform1i(loc, i); });
        if (desc.sceneDepth) { const loc = gl.getUniformLocation(prog, 'sceneDepth'); if (loc) gl.uniform1i(loc, p.depthUnit); }
        if (desc.groundDepth) { const loc = gl.getUniformLocation(prog, 'groundDepth'); if (loc) gl.uniform1i(loc, p.groundUnit); }
        gl.useProgram(null);
        const vao = gl.createVertexArray()!;
        gl.bindVertexArray(vao);
        for (const a of desc.instance?.attributes ?? []) { gl.enableVertexAttribArray(a.location); gl.vertexAttribDivisor(a.location, 1); }
        for (const a of desc.vertex?.attributes ?? []) { gl.enableVertexAttribArray(a.location); gl.vertexAttribDivisor(a.location, 0); }
        gl.bindVertexArray(null);
        p.prog = prog; p.vao = vao; p.ok = true;
      };
      const fail = (e: unknown) => { (p as { ready: Promise<void> }).ready = Promise.reject(e); p.ready.catch(() => {}); };
      // owned first: the poll below reads "still wanted" from it (a program not in `owned` was destroyed meanwhile)
      owned.add(p); tally.add('programs'); progs.add(p);
      if (parallel && !gl.isContextLost()) {
        (p as { ready: Promise<void> }).ready = new Promise<void>((ok, bad) => {
          const poll = () => { if (owned.has(p) && !gl.isContextLost() && !gl.getProgramParameter(prog, parallel.COMPLETION_STATUS_KHR)) { setTimeout(poll, 4); return; } try { if (owned.has(p)) finish(); else { gl.deleteProgram(prog); gl.deleteShader(vs); gl.deleteShader(fs); } ok(); } catch (e) { bad(e); } };
          poll();
        });
        p.ready.catch(() => {});
      } else { try { finish(); } catch (e) { fail(e); } }
      return p;
    },
    readTexture(texture: GTexture) {
      if (dead || gl.isContextLost()) return Promise.reject(new AslnutError('E-GPU-004', 'the WebGL2 context was lost', { fix: 'reload the page' }));
      const tx = texture as PTex, d = tx.desc, w = d.width, h = d.height, float = d.format !== 'rgba8';
      // (read back only what was made to be: as WebGPU, where another texture cannot be copied out)
      if (!d.renderable && !d.growable) return Promise.reject(unreadable(d));
      const fb = gl.createFramebuffer()!;
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      if (tx.target === gl.TEXTURE_2D) gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tx.tex, 0); else gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, tx.tex, 0, 0);
      // RGBA is the read format every colour buffer takes (float: RGBA / FLOAT); r32f keeps the first of the four
      const bytes = w * h * 4 * (float ? 4 : 1), pbo = gl.createBuffer()!;
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.bufferData(gl.PIXEL_PACK_BUFFER, bytes, gl.STREAM_READ);
      gl.readPixels(0, 0, w, h, gl.RGBA, float ? gl.FLOAT : gl.UNSIGNED_BYTE, 0);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.deleteFramebuffer(fb);
      const sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0)!; gl.flush();
      return new Promise<Float32Array | Uint8Array>((ok, bad) => {
        const poll = () => {
          if (dead || gl.isContextLost()) { bad(new AslnutError('E-GPU-004', 'the WebGL2 context was lost', { fix: 'reload the page' })); return; }
          if (gl.clientWaitSync(sync, 0, 0) === gl.TIMEOUT_EXPIRED) { setTimeout(poll, 1); return; }
          gl.deleteSync(sync);
          const raw = float ? new Float32Array(w * h * 4) : new Uint8Array(w * h * 4);
          gl.bindBuffer(gl.PIXEL_PACK_BUFFER, pbo); gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, raw); gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null); gl.deleteBuffer(pbo);
          if (d.format !== 'r32f') { ok(raw); return; }
          const one = new Float32Array(w * h); for (let i = 0; i < one.length; i++) one[i] = raw[i * 4]!;
          ok(one);
        };
        poll();
      });
    },
    frame(draws: DrawCall[], o: FrameOptions) {
      if (dead || gl.isContextLost()) return o.read ? Promise.reject(new AslnutError('E-GPU-004', 'the WebGL2 context was lost', { fix: 'reload the page' })) : null;
      const tg = o.target as PTarget | undefined;
      const width = tg ? tg.width : this.width, height = tg ? tg.height : this.height;
      // a layer of a texture (a tile's ground marks): colour only, no depth, the draws in order
      if (tg?.layerFb) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, tg.layerFb); gl.viewport(0, 0, width, height);
        gl.clearColor(...o.clear); gl.clear(gl.COLOR_BUFFER_BIT); gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.CULL_FACE);
        for (const d of draws) {
          const p = d.program as PProg; if (!p.ok || !p.prog) continue;
          gl.useProgram(p.prog);
          // a float target (a field's step) is never blended (float32 blending is an extension)
          const bl = p.desc.format && p.desc.format !== 'rgba8' ? 'none' : p.desc.blend ?? 'none';
          if (bl === 'none') gl.disable(gl.BLEND); else { gl.enable(gl.BLEND); gl.blendFuncSeparate(bl === 'premultiplied' ? gl.ONE : gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
          gl.bindVertexArray(p.vao);
          for (let i = 0; i < d.blocks.length; i++) gl.bindBufferBase(gl.UNIFORM_BUFFER, i, (d.blocks[i] as PBuf).buf);
          const tx = d.textures; if (tx) for (let i = 0; i < tx.length; i++) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture((tx[i] as PTex).target, (tx[i] as PTex).tex); }
          gl.drawArraysInstanced(p.desc.topology === 'lines' ? gl.LINES : gl.TRIANGLES, d.first ?? 0, d.count, d.instanceCount ?? 1);
          gl.bindVertexArray(null);
        }
        gl.depthMask(true); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        return null;
      }
      // a frame whose draws read the depth is drawn off screen (targets always are)
      const reads = draws.some((d) => ((d.program as PProg).ok && d.program.desc.sceneDepth) || d.keepDepth);
      let sc: Scene | null = tg ? tg.scene : null;
      const aa = !!o.aa && !tg && !o.keep && !o.scissor && !!aaProgram();
      if (aa) {
        if (!aaScene || aaScene.w !== width || aaScene.h !== height) {
          if (aaScene) freeScene(aaScene); aaScene = makeScene(width, height, true);
          gl.bindTexture(gl.TEXTURE_2D, aaScene.colorTex!); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR); gl.bindTexture(gl.TEXTURE_2D, null);
        }
        sc = aaScene;
      } else if (!tg && reads) { if (!main || main.w !== width || main.h !== height) { if (main) freeScene(main); main = makeScene(width, height); } sc = main; }
      if (!tg) { timerPoll(); timerBegin(); }
      gl.bindFramebuffer(gl.FRAMEBUFFER, sc ? sc.fb : null);
      gl.viewport(0, 0, width, height);
      // a part of the picture (a scenario beside another): the clear and every draw stay inside it (GL's rows from below)
      if (o.scissor) { gl.enable(gl.SCISSOR_TEST); gl.scissor(Math.floor(o.scissor[0]), Math.floor(height - o.scissor[1] - o.scissor[3]), Math.ceil(o.scissor[2]), Math.ceil(o.scissor[3])); }
      gl.clearColor(...o.clear); gl.clearDepth(1); gl.depthMask(true);
      const mask = (o.keep && !o.scissor ? 0 : gl.COLOR_BUFFER_BIT) | (o.keep && o.keepDepth ? 0 : gl.DEPTH_BUFFER_BIT); if (mask) gl.clear(mask);
      let depthDirty = true, n = 0, passes = 1;
      // the state set by the draw before: what is the same is not set again (a city frame is a hundred draws, most of
      // one program, one blend, one depth test, the frame's block)
      let curProg: WebGLProgram | null = null, curBlend = '', curDepth = '', curCull = '';
      const curUbo: (WebGLBuffer | null)[] = [], curTex: (WebGLTexture | null)[] = [];
      let kept = false;
      for (const d of draws) {
        if (d.keepDepth && sc && !tg && !kept) { keep(sc); kept = true; passes++; curTex.length = 0; }
        const p = d.program as PProg; if (!p.ok || !p.prog) continue;
        const desc = p.desc;
        if (desc.sceneDepth && sc) { if (depthDirty) { snapshot(sc); depthDirty = false; passes++; curTex.length = 0; } }
        else if (desc.sceneDepth) continue;
        if (curProg !== p.prog) { gl.useProgram(p.prog); curProg = p.prog; }
        const bl = desc.blend ?? 'none';
        if (bl === curBlend) { /* as before */ }
        else if (bl === 'none') { gl.disable(gl.BLEND); curBlend = bl; }
        else {
          curBlend = bl;
          gl.enable(gl.BLEND);
          if (bl === 'alpha') gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          else if (bl === 'add') gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE, gl.ONE, gl.ONE);
          else if (bl === 'multiply') gl.blendFuncSeparate(gl.DST_COLOR, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          else if (bl === 'screen') gl.blendFuncSeparate(gl.ONE_MINUS_DST_COLOR, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
          else gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
        }
        const dt = desc.depth?.test ?? 'less', dw = desc.sceneDepth ? false : desc.depth?.write ?? true, dk = `${dt}${dw}`;
        if (dk !== curDepth) { gl.enable(gl.DEPTH_TEST); gl.depthFunc(dt === 'less' ? gl.LESS : dt === 'less-equal' ? gl.LEQUAL : dt === 'greater-equal' ? gl.GEQUAL : gl.ALWAYS); gl.depthMask(dw); curDepth = dk; }
        if (dw) depthDirty = true;
        const cull = desc.cull ?? 'none';
        if (cull !== curCull) { if (cull !== 'none') { gl.enable(gl.CULL_FACE); gl.cullFace(cull === 'back' ? gl.BACK : gl.FRONT); } else gl.disable(gl.CULL_FACE); curCull = cull; }
        gl.bindVertexArray(vaoOf(p, d.instances as PBuf | undefined, d.vertices as PBuf | undefined));
        for (let i = 0; i < d.blocks.length; i++) { const b = (d.blocks[i] as PBuf).buf; if (curUbo[i] !== b) { gl.bindBufferBase(gl.UNIFORM_BUFFER, i, b); curUbo[i] = b; } }
        const tx = d.textures; if (tx) for (let i = 0; i < tx.length; i++) { const t = (tx[i] as PTex).tex; if (curTex[i] !== t) { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture((tx[i] as PTex).target, t); curTex[i] = t; } }
        if (desc.sceneDepth && sc) { gl.activeTexture(gl.TEXTURE0 + p.depthUnit); gl.bindTexture(gl.TEXTURE_2D, sc.copy); curTex[p.depthUnit] = sc.copy; }
        // (no terrain depth kept this frame: the scene's own, and the part draws nothing: nothing stands over the terrain)
        if (desc.groundDepth && sc) { const k = kept && sc.kept ? sc.kept : sc.copy; gl.activeTexture(gl.TEXTURE0 + p.groundUnit); gl.bindTexture(gl.TEXTURE_2D, k); curTex[p.groundUnit] = k; }
        if (d.index) { gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, (d.index as PBuf).buf); gl.drawElementsInstanced(desc.topology === 'lines' ? gl.LINES : gl.TRIANGLES, d.count, gl.UNSIGNED_INT, 0, d.instanceCount ?? 1); }
        else gl.drawArraysInstanced(desc.topology === 'lines' ? gl.LINES : gl.TRIANGLES, d.first ?? 0, d.count, d.instanceCount ?? 1);
        n++;
      }
      if (o.scissor) gl.disable(gl.SCISSOR_TEST);
      gl.bindVertexArray(null);
      // anti-aliased: the scene through FXAA onto the canvas (then read from there)
      if (aa && sc) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, width, height);
        gl.disable(gl.DEPTH_TEST); gl.depthMask(false); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
        gl.useProgram(aaProg); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, sc.colorTex!); gl.bindVertexArray(aaVao);
        gl.drawArrays(gl.TRIANGLES, 0, 3); gl.bindVertexArray(null); gl.depthMask(true); passes++;
        const out2 = o.read ? readAsync(width, height) : null;
        if (!tg) { timerEnd(); stats.draws = n; stats.passes = passes; stats.uploadBytes = uploads; uploads = 0; stats.uploads = nUp; nUp = 0; stats.uploadMaxMs = +upMax.toFixed(2); upMax = 0; }
        return out2;
      }
      const out = o.read ? readAsync(width, height) : null;
      // the off-screen scene onto the canvas
      if (!tg && sc) { gl.bindFramebuffer(gl.READ_FRAMEBUFFER, sc.fb); gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, null); gl.blitFramebuffer(0, 0, width, height, 0, 0, width, height, gl.COLOR_BUFFER_BIT, gl.NEAREST); passes++; }
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!tg) { timerEnd(); stats.draws = n; stats.passes = passes; stats.uploadBytes = uploads; uploads = 0; stats.uploads = nUp; nUp = 0; stats.uploadMaxMs = +upMax.toFixed(2); upMax = 0; }
      return out;
    },
    hold(on: boolean) {
      holding = on;
      if (!on && later.length) for (const f of later.splice(0)) f();
    },
    destroy() {
      if (closed) return;
      closed = true; holding = false;
      for (const r of [...owned]) r.destroy();
      for (const f of later.splice(0)) f();
      if (main) { freeScene(main); main = null; }
      if (aaScene) { freeScene(aaScene); aaScene = null; } if (aaProg) { gl.deleteProgram(aaProg); aaProg = null; }
      if (staging) { gl.deleteTexture(staging.tex); staging = null; }
      for (const p of [copier.layer, copier.plane, ...Object.values(copier.linking)]) if (p) gl.deleteProgram(p);
      if (copier.vao) gl.deleteVertexArray(copier.vao);
      copier.layer = copier.plane = copier.vao = null; copier.linking = {};
      timerEnd(); if (timerQ) { gl.deleteQuery(timerQ); timerQ = null; }
      tally.close();
      canvas.removeEventListener('webglcontextlost', lostHandler as EventListener);
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      dead = true;
    },
  };
  return g;
}
