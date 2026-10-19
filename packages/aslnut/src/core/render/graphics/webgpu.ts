// core › render › graphics › webgpu: the interface on WebGPU.
import { AslnutError } from '../../world/errors.ts';
import { Held, tally } from './live.ts';
import { FXAA_WGSL } from './shaders/fxaa.wgsl.ts';
import type { Attribute, BufferKind, Caps, DrawCall, FrameOptions, GBuffer, GTarget, GTexture, Graphics, Program, ProgramDesc, TextureDesc } from './interface.ts';

const FORMAT = { rgba8: 'rgba8unorm', rgba32f: 'rgba32float', r32f: 'r32float' } as const;
const BPP = { rgba8: 4, rgba32f: 16, r32f: 4 } as const;
const VFMT = { 1: 'float32', 2: 'float32x2', 3: 'float32x3', 4: 'float32x4' } as const;
const BLEND: Record<string, GPUBlendState | undefined> = {
  none: undefined,
  alpha: { color: { srcFactor: 'src-alpha', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
  add: { color: { srcFactor: 'src-alpha', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one' } },
  premultiplied: { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
  // multiply and screen: the shader gives premultiplied colour (rgb × alpha)
  multiply: { color: { srcFactor: 'dst', dstFactor: 'one-minus-src-alpha' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
  screen: { color: { srcFactor: 'one-minus-dst', dstFactor: 'one' }, alpha: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha' } },
};
const DEPTH = { less: 'less', 'less-equal': 'less-equal', 'greater-equal': 'greater-equal', always: 'always' } as const;
let nextId = 1;

interface PBuf extends GBuffer { id: number; buf: GPUBuffer; version: number }
interface PTex extends GTexture { id: number; view: GPUTextureView; tex: GPUTexture }
interface PProg extends Omit<Program, 'ready'> { id: number; pipe: GPURenderPipeline | null; layouts: GPUBindGroupLayout[]; ok: boolean; ready: Promise<void>; vslot: number; depthLayout: GPUBindGroupLayout | null }
interface PTarget extends GTarget { layerView?: GPUTextureView; color?: GPUTexture; depth?: GPUTexture }

export async function createWebGPU(canvas: HTMLCanvasElement | OffscreenCanvas, o: { powerPreference?: GPUPowerPreference } = {}): Promise<Graphics> {
  const gpu = (navigator as Navigator & { gpu?: GPU }).gpu;
  if (!gpu) throw new Error('navigator.gpu is missing');
  const adapter = await gpu.requestAdapter({ powerPreference: o.powerPreference ?? 'high-performance' });
  if (!adapter) throw new Error('no WebGPU adapter (the browser has WebGPU, but no usable graphics chip for it)');
  const device = await adapter.requestDevice({ requiredLimits: { maxTextureArrayLayers: Math.min(256, adapter.limits.maxTextureArrayLayers) } });
  const ctx = canvas.getContext('webgpu') as GPUCanvasContext | null;
  if (!ctx) throw new Error('the canvas gave no WebGPU context (was it used for WebGL before?)');
  const format = gpu.getPreferredCanvasFormat();
  // the canvas is drawn into only, until a frame is read back (a capture): a usage it never needs can cost a phone's
  // chip its compressed framebuffer, so copying out is added on the first read (and kept)
  let readable = false;
  const configure = () => ctx.configure({ device, format, alphaMode: 'opaque', usage: GPUTextureUsage.RENDER_ATTACHMENT | (readable ? GPUTextureUsage.COPY_SRC : 0) });
  configure();
  const info = (adapter as GPUAdapter & { info?: GPUAdapterInfo }).info;
  const caps: Caps = {
    api: 'webgpu', compute: true, timer: adapter.features.has('timestamp-query'), floatTargets: true,
    maxTex: device.limits.maxTextureDimension2D, maxLayers: device.limits.maxTextureArrayLayers, vertexTextures: 16,
    f16: adapter.features.has('shader-f16'), device: [info?.vendor, info?.architecture, info?.description].filter(Boolean).join(' '),
  };
  let width = canvas.width, height = canvas.height, depth: GPUTexture | null = null, bytes = 0, dead = false, uploads = 0; const held = new Held();
  // the chip's time is not measured here yet (timestamp queries need the feature and a resolve per frame): null
  const stats = { draws: 0, passes: 0, uploadBytes: 0, uploads: 0, gpuMs: null as number | null, uploadMaxMs: 0 }; let nUp = 0;
  const DEPTH_USAGE = GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING;
  const depthGroups = new WeakMap<GPUTexture, Map<GPUBindGroupLayout, GPUBindGroup>>();
  const depthGroup = (t: GPUTexture, layout: GPUBindGroupLayout): GPUBindGroup => {
    let m = depthGroups.get(t); if (!m) { m = new Map(); depthGroups.set(t, m); }
    let g0 = m.get(layout); if (!g0) { g0 = device.createBindGroup({ layout, entries: [{ binding: 0, resource: t.createView() }] }); m.set(layout, g0); }
    return g0;
  };
  let bufUids = 0;
  const owned = new Set<{ destroy(): void }>();
  const groups = new Map<string, GPUBindGroup>();
  // passes into texture layers (the ground tiles' marks) are recorded here and go to the chip with the frame that
  // follows, in one submit (one submit per tile cost a phone's main thread and its GPU process tens of ms a frame
  // when a look changed and every tile was drawn again); what is destroyed meanwhile waits for that submit
  let pending: GPUCommandEncoder | null = null;
  const later: (() => void)[] = [];
  const submit = (enc: GPUCommandEncoder | null): void => {
    const list: GPUCommandBuffer[] = [];
    if (pending) { list.push(pending.finish()); pending = null; }
    if (enc) list.push(enc.finish());
    if (list.length) device.queue.submit(list);
    if (later.length) for (const f of later.splice(0)) f();
  };
  const gone = (f: () => void): void => { if (pending) later.push(f); else f(); };
  /** a bind group's cache key: the program and its resources' ids (no arrays made per draw) */
  const keyOf = (pid: number, kind: string, xs: readonly { id: number }[]): string => { let k = `${pid}${kind}`; for (let i = 0; i < xs.length; i++) k += `${xs[i]!.id},`; return k; };
  const sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
  const ensureDepth = () => {
    if (depth && depth.width === width && depth.height === height) return;
    depth?.destroy();
    depth = device.createTexture({ size: [Math.max(1, width), Math.max(1, height)], format: 'depth24plus', usage: DEPTH_USAGE });
  };
  // the anti-aliased frame: drawn into `aaTex`, then through FXAA onto the canvas (its pipeline built in the
  // background: frames go on without it until it is ready)
  let aaTex: GPUTexture | null = null, aaPipe: GPURenderPipeline | null = null, aaWait: Promise<void> | null = null, aaGroup: GPUBindGroup | null = null;
  const aaReady = (): boolean => {
    if (aaPipe) return true;
    if (!aaWait) { const module = device.createShaderModule({ label: 'fxaa', code: FXAA_WGSL }); aaWait = device.createRenderPipelineAsync({ label: 'fxaa', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format }] }, primitive: { topology: 'triangle-list' } }).then((p) => { aaPipe = p; }, () => {}); }
    return false;
  };
  const ensureAA = () => {
    if (aaTex && aaTex.width === width && aaTex.height === height) return;
    aaTex?.destroy();
    aaTex = device.createTexture({ label: 'fxaa picture', size: [Math.max(1, width), Math.max(1, height)], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    aaGroup = device.createBindGroup({ layout: aaPipe!.getBindGroupLayout(0), entries: [{ binding: 0, resource: aaTex.createView() }, { binding: 1, resource: sampler }] });
  };
  // the terrain's depth kept for the draped marks' parts over the twin's solids (a draw marked keepDepth): a depth24plus
  // texture cannot be copied, so one pass reads it and writes it into an r32float picture. Its pipeline is built when the
  // first program reading it is made (in the background); a frame before it is ready leaves those parts out
  let kept: GPUTexture | null = null, keptView: GPUTextureView | null = null, keepPipe: GPURenderPipeline | null = null, keepWait: Promise<void> | null = null;
  const keepGroups = new WeakMap<GPUTexture, GPUBindGroup>(), groundGroups = new WeakMap<GPUBindGroupLayout, { d: GPUTexture; k: GPUTexture; g: GPUBindGroup }>();
  const KEEP_WGSL = /* wgsl */ `@group(0) @binding(0) var d: texture_depth_2d;
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) p: vec4f) -> @location(0) vec4f {
  return vec4f(textureLoad(d, vec2i(p.xy), 0), 0.0, 0.0, 1.0);
}`;
  const keepReady = (): boolean => {
    if (keepPipe) return true;
    if (!keepWait) { const module = device.createShaderModule({ label: 'kept depth', code: KEEP_WGSL }); keepWait = device.createRenderPipelineAsync({ label: 'kept depth', layout: 'auto', vertex: { module, entryPoint: 'vs' }, fragment: { module, entryPoint: 'fs', targets: [{ format: 'r32float' }] }, primitive: { topology: 'triangle-list' } }).then((x) => { keepPipe = x; }, () => {}); }
    return false;
  };
  const ensureKept = (): void => {
    if (kept && kept.width === width && kept.height === height) return;
    if (kept) { bytes -= kept.width * kept.height * 4; held.remove('kept depth', kept.width * kept.height * 4); const old = kept; gone(() => old.destroy()); }
    kept = device.createTexture({ label: 'kept depth', size: [Math.max(1, width), Math.max(1, height)], format: 'r32float', usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING });
    keptView = kept.createView(); bytes += kept.width * kept.height * 4; held.add('kept depth', kept.width * kept.height * 4);
  };
  const lost = device.lost.then((i) => { dead = true; return i.message || String(i.reason); });
  tally.open(); let closed = false;

  const g: Graphics = {
    api: 'webgpu', caps, lost, stats,
    flush() { if (!dead) submit(null); },
    get width() { return width; }, get height() { return height; }, get bytes() { return bytes; }, memory: () => held.list(),
    resize(w, h) { width = Math.max(1, Math.round(w)); height = Math.max(1, Math.round(h)); if (canvas.width !== width) canvas.width = width; if (canvas.height !== height) canvas.height = height; },
    buffer(kind: BufferKind, sizeOrData, label) {
      const data = typeof sizeOrData === 'number' ? null : sizeOrData;
      const size = Math.max(kind === 'uniform' ? 16 : 4, Math.ceil((data ? data.byteLength : (sizeOrData as number)) / 4) * 4);
      const usage = (kind === 'uniform' ? GPUBufferUsage.UNIFORM : kind === 'index' ? GPUBufferUsage.INDEX : GPUBufferUsage.VERTEX) | GPUBufferUsage.COPY_DST;
      const buf = device.createBuffer({ size, usage, label });
      bytes += size; const lab = label ?? kind; held.add(lab, size);
      const b: PBuf = {
        id: nextId++, kind, size, buf,
        uid: ++bufUids, version: 0,
        write(d, off = 0) { if (!dead) { device.queue.writeBuffer(buf, off, d.buffer as ArrayBuffer, d.byteOffset, d.byteLength); nUp++; uploads += d.byteLength; b.version++; } },
        destroy() { if (owned.delete(b)) { gone(() => buf.destroy()); bytes -= size; held.remove(lab, size); groups.clear(); tally.remove('buffers', size); } },
      };
      owned.add(b); tally.add('buffers', size);
      if (data) b.write(data);
      return b;
    },
    texture(desc: TextureDesc) {
      // rgba8 can take images straight from the browser's decoder (copyExternalImageToTexture needs RENDER_ATTACHMENT)
      const tex = device.createTexture({ label: desc.label, size: [desc.width, desc.height, desc.layers ?? 1], format: FORMAT[desc.format], usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST | (desc.format === 'rgba8' || desc.renderable ? GPUTextureUsage.RENDER_ATTACHMENT : 0) | (desc.renderable || desc.growable ? GPUTextureUsage.COPY_SRC : 0) });
      const size = desc.width * desc.height * (desc.layers ?? 1) * BPP[desc.format];
      bytes += size; const lab = desc.label ?? 'texture'; held.add(lab, size);
      const t: PTex = {
        id: nextId++, desc, tex, view: tex.createView({ dimension: desc.layers !== undefined ? '2d-array' : '2d' }),
        write(d, o = {}) {
          if (dead) return;
          const w = o.width ?? desc.width, h = o.height ?? desc.height;
          device.queue.writeTexture({ texture: tex, origin: [o.x ?? 0, o.y ?? 0, o.layer ?? 0] }, d.buffer as ArrayBuffer, { offset: d.byteOffset, bytesPerRow: w * BPP[desc.format], rowsPerImage: h }, [w, h, 1]);
          nUp++; uploads += w * h * BPP[desc.format];
        },
        writeImage(src, o = {}) {
          if (dead) return;
          device.queue.copyExternalImageToTexture({ source: src }, { texture: tex, origin: [o.x ?? 0, o.y ?? 0, o.layer ?? 0], premultipliedAlpha: !!o.premultiplied }, [src.width, src.height, 1]);
          nUp++; uploads += src.width * src.height * 4;
        },
        destroy() { if (owned.delete(t)) { gone(() => tex.destroy()); bytes -= size; held.remove(lab, size); groups.clear(); tally.remove('textures', size); } },
      };
      owned.add(t); tally.add('textures', size);
      return t;
    },
    copyLayers(from: GTexture, to: GTexture, layers: number) {
      const a = from as PTex, b = to as PTex, n = Math.min(layers, a.desc.layers ?? 1, b.desc.layers ?? 1);
      if (dead || n <= 0) return true;
      const enc = device.createCommandEncoder({ label: 'copy layers' });
      enc.copyTextureToTexture({ texture: a.tex }, { texture: b.tex }, [Math.min(a.desc.width, b.desc.width), Math.min(a.desc.height, b.desc.height), n]);
      device.queue.submit([enc.finish()]);
      return true;
    },
    layerTarget(texture: GTexture, layer: number) {
      const tx = texture as PTex;
      const t: PTarget = { width: tx.desc.width, height: tx.desc.height, layerView: tx.tex.createView({ dimension: '2d', baseArrayLayer: layer, arrayLayerCount: 1 }), destroy() { if (owned.delete(t)) tally.remove('targets'); } };
      owned.add(t); tally.add('targets');
      return t;
    },
    target(w: number, h: number, o: { sampled?: boolean; label?: string } = {}) {
      const W = Math.max(1, Math.round(w)), H = Math.max(1, Math.round(h));
      const color = device.createTexture({ size: [W, H], format, usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.COPY_SRC | (o.sampled ? GPUTextureUsage.TEXTURE_BINDING : 0) });
      const depthT = device.createTexture({ size: [W, H], format: 'depth24plus', usage: DEPTH_USAGE });
      bytes += W * H * 8; const lab = o.label ?? 'target'; held.add(lab, W * H * 8);
      // its colour as a texture draws read (the shadow map): never written from the CPU
      const texture: PTex | undefined = o.sampled ? { id: nextId++, desc: { label: 'target', width: W, height: H, format: 'rgba8', filter: 'nearest' }, tex: color, view: color.createView(), write() { throw new AslnutError('E-GPU-003', 'a target is drawn into, not written', { fix: 'draw into it with frame({ target })' }); }, writeImage() { throw new AslnutError('E-GPU-003', 'a target is drawn into, not written', { fix: 'draw into it with frame({ target })' }); }, destroy() {} } : undefined;
      const t: PTarget = { width: W, height: H, color, depth: depthT, texture, destroy() { if (owned.delete(t)) { gone(() => { color.destroy(); depthT.destroy(); }); bytes -= W * H * 8; held.remove(lab, W * H * 8); tally.remove('targets', W * H * 8); groups.clear(); } } };
      owned.add(t); tally.add('targets', W * H * 8);
      return t;
    },
    program(desc: ProgramDesc) {
      device.pushErrorScope('validation');
      const module = device.createShaderModule({ label: desc.label, code: desc.wgsl });
      const vis = GPUShaderStage.VERTEX | GPUShaderStage.FRAGMENT;
      const layouts = [device.createBindGroupLayout({ label: `${desc.label} blocks`, entries: desc.blocks.map((_, i) => ({ binding: i, visibility: vis, buffer: { type: 'uniform' as const } })) })];
      if (desc.textures?.length) layouts.push(device.createBindGroupLayout({ label: `${desc.label} textures`, entries: [
        ...desc.textures.map((t, i) => ({ binding: i, visibility: vis, texture: { sampleType: t.sample === 'float' ? 'float' as const : 'unfilterable-float' as const, viewDimension: t.kind } })),
        { binding: desc.textures.length, visibility: GPUShaderStage.FRAGMENT, sampler: { type: 'filtering' as const } },
      ] }));
      const depthLayout = desc.sceneDepth ? device.createBindGroupLayout({ label: `${desc.label} scene depth`, entries: [{ binding: 0, visibility: vis, texture: { sampleType: 'depth' as const, viewDimension: '2d' as const } },
        ...(desc.groundDepth ? [{ binding: 1, visibility: vis, texture: { sampleType: 'unfilterable-float' as const, viewDimension: '2d' as const } }] : [])] }) : null;
      if (desc.groundDepth) keepReady();
      if (depthLayout) { if (layouts.length < 2) layouts.push(device.createBindGroupLayout({ label: `${desc.label} no textures`, entries: [] })); layouts.push(depthLayout); }
      const attrs = (a: Attribute[]) => a.map((x) => ({ shaderLocation: x.location, offset: x.offset * 4, format: VFMT[x.size] }));
      // built in the background (createRenderPipelineAsync): frames go on drawing what is ready while it compiles (a
      // pipeline built at once can hold a phone's GPU process for a long frame), as WebGL2's parallel compile does
      const pdesc: GPURenderPipelineDescriptor = {
        label: desc.label,
        layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
        vertex: { module, entryPoint: 'vs', buffers: [
          ...(desc.instance ? [{ arrayStride: desc.instance.stride * 4, stepMode: 'instance' as const, attributes: attrs(desc.instance.attributes) }] : []),
          ...(desc.vertex ? [{ arrayStride: desc.vertex.stride * 4, stepMode: 'vertex' as const, attributes: attrs(desc.vertex.attributes) }] : []),
        ] },
        // a float target (a field's step) is never blended (float32 blending is an optional feature)
        fragment: { module, entryPoint: 'fs', targets: [{ format: desc.overlay ? FORMAT[desc.format ?? 'rgba8'] : format, blend: desc.overlay && desc.format && desc.format !== 'rgba8' ? undefined : BLEND[desc.blend ?? 'none'] }] },
        primitive: { topology: desc.topology === 'lines' ? 'line-list' : 'triangle-list', cullMode: desc.cull ?? 'none' },
        // drawn into a texture layer (a tile's ground marks): colour only
        ...(desc.overlay ? {} : { depthStencil: { format: 'depth24plus' as GPUTextureFormat, depthWriteEnabled: desc.sceneDepth ? false : desc.depth?.write ?? true, depthCompare: DEPTH[desc.depth?.test ?? 'less'] } }),
      };
      const built = device.createRenderPipelineAsync(pdesc).then((x) => x, (e: unknown) => e as Error);
      const p: PProg = {
        id: nextId++, label: desc.label, desc, pipe: null, layouts, ok: false, ready: Promise.resolve(), vslot: desc.instance ? 1 : 0, depthLayout,
        destroy() { if (owned.delete(p)) tally.remove('programs'); },
      };
      p.ready = (async () => {
          const [err, info, pipe] = await Promise.all([device.popErrorScope(), module.getCompilationInfo(), built]);
          const msgs = info.messages.filter((m) => m.type === 'error').map((m) => `line ${m.lineNum}:${m.linePos} ${m.message}`);
          const bad = pipe instanceof Error ? pipe : null;
          if (err || msgs.length || bad) throw new AslnutError('E-GPU-003', `WebGPU could not build '${desc.label}': ${msgs.join('; ') || err?.message || bad?.message}`, { where: desc.label, fix: 'if this is your shader code, check the line given; otherwise report it with the browser and device', details: { wgsl: desc.wgsl } });
          if (!owned.has(p)) return;
          p.pipe = pipe as GPURenderPipeline; p.ok = true;
        })();
      p.ready.catch(() => {});
      owned.add(p); tally.add('programs');
      return p;
    },
    readTexture(texture: GTexture) {
      if (dead) return Promise.reject(new AslnutError('E-GPU-004', 'the WebGPU device was lost', { fix: 'reload the page' }));
      const tx = texture as PTex, d = tx.desc, bpp = BPP[d.format], w = d.width, h = d.height, row = Math.ceil((w * bpp) / 256) * 256;
      // what was drawn into it is still in the encoder being recorded: sent first
      if (pending) submit(null);
      const out = device.createBuffer({ size: row * h, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ }), enc = device.createCommandEncoder();
      enc.copyTextureToBuffer({ texture: tx.tex }, { buffer: out, bytesPerRow: row }, [w, h, 1]);
      submit(enc);
      return out.mapAsync(GPUMapMode.READ).then(() => {
        const src = new Uint8Array(out.getMappedRange()), raw = new Uint8Array(w * h * bpp);
        for (let y = 0; y < h; y++) raw.set(src.subarray(y * row, y * row + w * bpp), y * w * bpp);
        out.unmap(); out.destroy();
        return d.format === 'rgba8' ? raw : new Float32Array(raw.buffer);
      });
    },
    frame(draws: DrawCall[], o: FrameOptions) {
      if (dead) return o.read ? Promise.reject(new AslnutError('E-GPU-004', 'the WebGPU device was lost', { fix: 'reload the page' })) : null;
      const tg = o.target as PTarget | undefined;
      const blocks = (pass: GPURenderPassEncoder, p: PProg, d: DrawCall) => {
        const k0 = keyOf(p.id, 'b', d.blocks as unknown as PBuf[]);
        let g0 = groups.get(k0);
        if (!g0) { g0 = device.createBindGroup({ layout: p.layouts[0]!, entries: d.blocks.map((b, i) => ({ binding: i, resource: { buffer: (b as PBuf).buf } })) }); groups.set(k0, g0); }
        pass.setBindGroup(0, g0);
        if (p.layouts[1] && d.textures?.length) {
          const k1 = keyOf(p.id, 't', d.textures as unknown as PTex[]);
          let g1 = groups.get(k1);
          if (!g1) { g1 = device.createBindGroup({ layout: p.layouts[1], entries: [...d.textures.map((t, i) => ({ binding: i, resource: (t as PTex).view })), { binding: d.textures.length, resource: sampler }] }); groups.set(k1, g1); }
          pass.setBindGroup(1, g1);
          return true;
        }
        return false;
      };
      // a layer of a texture (a tile's ground marks): one pass, colour only, the draws in order; recorded now, sent
      // with the next frame (or at the end of this task)
      if (tg?.layerView) {
        if (!pending) { pending = device.createCommandEncoder(); queueMicrotask(() => { if (pending && !dead) submit(null); }); }
        const pass = pending.beginRenderPass({ colorAttachments: [{ view: tg.layerView, clearValue: { r: o.clear[0], g: o.clear[1], b: o.clear[2], a: o.clear[3] }, loadOp: 'clear', storeOp: 'store' }] });
        for (const d of draws) {
          const p = d.program as PProg; if (!p.ok) continue;
          pass.setPipeline(p.pipe!);
          blocks(pass, p, d);
          pass.draw(d.count, d.instanceCount ?? 1, d.first ?? 0);
        }
        pass.end();
        return null;
      }
      if (!tg) ensureDepth();
      if (o.read && !tg && !readable) { readable = true; configure(); }
      const tex = tg ? tg.color! : ctx.getCurrentTexture(), enc = device.createCommandEncoder();
      const width = tg ? tg.width : this.width, height = tg ? tg.height : this.height;
      const aa = !!o.aa && !tg && !o.keep && !o.scissor && aaReady();
      if (aa) ensureAA();
      const dtex = tg ? tg.depth! : depth!, colorView = aa ? aaTex!.createView() : tex.createView(), depthView = dtex.createView();
      // one pass, split where a draw reads the depth drawn so far (it is bound read-only: no copy). The depth of the
      // last pass is never read again: not stored (a tiled chip keeps it on chip and never writes it out)
      let total = 1, ro0 = false;
      for (const d of draws) { const p = d.program as PProg; if (!p.ok) continue; const w = !!p.depthLayout; if (w !== ro0) { total++; ro0 = w; } }
      const keeps = !tg && draws.some((d) => d.keepDepth) && keepReady();
      if (keeps) total++;
      let keptNow = false;
      let readOnly = false, first = true, passes = 0, n = 0;
      const sc = o.scissor ? [Math.max(0, Math.floor(o.scissor[0])), Math.max(0, Math.floor(o.scissor[1]))] as [number, number] : null;
      const scWH = o.scissor && sc ? [Math.max(0, Math.min(width - sc[0], Math.ceil(o.scissor[2]))), Math.max(0, Math.min(height - sc[1], Math.ceil(o.scissor[3])))] as [number, number] : null;
      const open = (ro: boolean) => {
        passes++;
        const p = enc.beginRenderPass({
          colorAttachments: [{ view: colorView, clearValue: { r: o.clear[0], g: o.clear[1], b: o.clear[2], a: o.clear[3] }, loadOp: first && !o.keep ? 'clear' : 'load', storeOp: 'store' }],
          depthStencilAttachment: ro ? { view: depthView, depthReadOnly: true } : { view: depthView, depthClearValue: 1, depthLoadOp: first && !(o.keep && o.keepDepth) ? 'clear' : 'load', depthStoreOp: passes === total && !o.keepDepth ? 'discard' : 'store' },
        });
        if (sc && scWH) p.setScissorRect(sc[0], sc[1], scWH[0], scWH[1]);
        first = false; readOnly = ro; return p;
      };
      let pass = open(false);
      for (const d of draws) {
        if (keeps && !keptNow && d.keepDepth) {
          // the terrain's depth so far into the kept picture (its own pass), then the frame goes on where it was
          pass.end(); ensureKept();
          let kg = keepGroups.get(dtex); if (!kg) { kg = device.createBindGroup({ layout: keepPipe!.getBindGroupLayout(0), entries: [{ binding: 0, resource: dtex.createView() }] }); keepGroups.set(dtex, kg); }
          const kp = enc.beginRenderPass({ colorAttachments: [{ view: keptView!, clearValue: { r: 1, g: 0, b: 0, a: 1 }, loadOp: 'clear', storeOp: 'store' }] });
          kp.setPipeline(keepPipe!); kp.setBindGroup(0, kg); kp.draw(3); kp.end();
          keptNow = true; pass = open(readOnly);
        }
        const p = d.program as PProg; if (!p.ok) continue;
        // (no terrain depth kept this frame: a part over the twin's solids has nothing to read, it is left out)
        if (p.desc.groundDepth && !keptNow) continue;
        const wants = !!p.depthLayout;
        if (wants !== readOnly) { pass.end(); pass = open(wants); }
        pass.setPipeline(p.pipe!);
        if (!blocks(pass, p, d) && p.depthLayout) {
          const k1 = `${p.id}:none`; let g1 = groups.get(k1);
          if (!g1) { g1 = device.createBindGroup({ layout: p.layouts[1]!, entries: [] }); groups.set(k1, g1); }
          pass.setBindGroup(1, g1);
        }
        if (p.depthLayout && p.desc.groundDepth) {
          let e = groundGroups.get(p.depthLayout);
          if (!e || e.d !== dtex || e.k !== kept) { e = { d: dtex, k: kept!, g: device.createBindGroup({ layout: p.depthLayout, entries: [{ binding: 0, resource: dtex.createView() }, { binding: 1, resource: keptView! }] }) }; groundGroups.set(p.depthLayout, e); }
          pass.setBindGroup(2, e.g);
        } else if (p.depthLayout) pass.setBindGroup(2, depthGroup(dtex, p.depthLayout));
        if (d.instances) pass.setVertexBuffer(0, (d.instances as PBuf).buf);
        if (d.vertices) pass.setVertexBuffer(p.vslot, (d.vertices as PBuf).buf);
        if (d.index) { pass.setIndexBuffer((d.index as PBuf).buf, 'uint32'); pass.drawIndexed(d.count, d.instanceCount ?? 1); }
        else pass.draw(d.count, d.instanceCount ?? 1, d.first ?? 0);
        n++;
      }
      if (!tg) { stats.draws = n; stats.passes = passes + (keptNow ? 1 : 0); stats.uploadBytes = uploads; uploads = 0; stats.uploads = nUp; nUp = 0; }
      pass.end();
      // anti-aliased: the picture through FXAA onto the canvas
      if (aa) { const fp = enc.beginRenderPass({ colorAttachments: [{ view: tex.createView(), clearValue: { r: o.clear[0], g: o.clear[1], b: o.clear[2], a: o.clear[3] }, loadOp: 'clear', storeOp: 'store' }] }); fp.setPipeline(aaPipe!); fp.setBindGroup(0, aaGroup!); fp.draw(3); fp.end(); if (!tg) stats.passes = passes + (keptNow ? 2 : 1); }
      if (groups.size > 1024) groups.clear();
      if (!o.read) { submit(enc); return null; }
      const row = Math.ceil((width * 4) / 256) * 256, out = device.createBuffer({ size: row * height, usage: GPUBufferUsage.COPY_DST | GPUBufferUsage.MAP_READ });
      enc.copyTextureToBuffer({ texture: tex }, { buffer: out, bytesPerRow: row }, [width, height]);
      submit(enc);
      const w = width, h = height, bgra = format === 'bgra8unorm';
      return out.mapAsync(GPUMapMode.READ).then(() => {
        const src = new Uint8Array(out.getMappedRange()), px = new Uint8Array(w * h * 4);
        for (let y = 0; y < h; y++) px.set(src.subarray(y * row, y * row + w * 4), y * w * 4);
        out.unmap(); out.destroy();
        if (bgra) for (let i = 0; i < px.length; i += 4) { const b = px[i]!; px[i] = px[i + 2]!; px[i + 2] = b; }
        return px;
      });
    },
    destroy() {
      if (closed) return;
      closed = true;
      if (pending && !dead) submit(null);
      for (const r of [...owned]) r.destroy();
      depth?.destroy(); depth = null; aaTex?.destroy(); aaTex = null; kept?.destroy(); kept = null; groups.clear(); later.length = 0;
      try { ctx.unconfigure(); } catch { /* already gone */ }
      device.destroy(); dead = true;
      tally.close();
    },
  };
  return g;
}
