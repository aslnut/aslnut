// core › render › graphics: a texture's texels read back (readTexture) only when it was made to be (renderable or
// growable), and refused alike on WebGPU and WebGL2 otherwise. WebGPU cannot copy out a texture made without it (its
// usage lacks COPY_SRC): it once read such a texture back as zeros, silently (a set's pose looked 90° off there only).
// Both graphics on fakes of their own: what each asks of the chip is recorded, nothing is drawn.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createWebGPU } from '../src/core/render/graphics/webgpu.ts';
import { createWebGL2 } from '../src/core/render/graphics/webgl2.ts';

/** WebGPU's flags (as the browser has them) */
const USAGE = { MAP_READ: 1, MAP_WRITE: 2, COPY_SRC: 4, COPY_DST: 8, INDEX: 16, VERTEX: 32, UNIFORM: 64, STORAGE: 128, INDIRECT: 256, QUERY_RESOLVE: 512 };
const TEX = { COPY_SRC: 1, COPY_DST: 2, TEXTURE_BINDING: 4, STORAGE_BINDING: 8, RENDER_ATTACHMENT: 16 };
/** a WebGPU device that records the textures made and the copies out */
function fakeGPU() {
  const copies: { usage: number }[] = [];
  const view = () => ({});
  const device = {
    limits: { maxTextureDimension2D: 8192, maxTextureArrayLayers: 256 }, features: new Set(), lost: new Promise(() => {}),
    queue: { writeTexture() {}, writeBuffer() {}, submit() {}, copyExternalImageToTexture() {} },
    createSampler: () => ({}),
    createTexture: (d: { size: number[]; usage: number }) => ({ usage: d.usage, width: d.size[0], height: d.size[1], createView: view, destroy() {} }),
    createBuffer: (d: { size: number }) => ({ size: d.size, mapAsync: () => Promise.resolve(), getMappedRange: () => new ArrayBuffer(d.size), unmap() {}, destroy() {} }),
    createCommandEncoder: () => ({ copyTextureToBuffer: (src: { texture: { usage: number } }) => copies.push({ usage: src.texture.usage }), finish: () => ({}) }),
    pushErrorScope() {}, popErrorScope: () => Promise.resolve(null), destroy() {},
  };
  const adapter = { limits: { maxTextureArrayLayers: 256 }, features: new Set(), info: { vendor: 'fake', architecture: '', description: '' }, requestDevice: () => Promise.resolve(device) };
  return { gpu: { requestAdapter: () => Promise.resolve(adapter), getPreferredCanvasFormat: () => 'bgra8unorm' }, copies };
}

test('readTexture: WebGPU reads back what was made to be, and refuses the rest (never zeros in their place)', async () => {
  const { gpu, copies } = fakeGPU();
  const g0 = globalThis as unknown as Record<string, unknown>;
  const was = { nav: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), GPUTextureUsage: g0.GPUTextureUsage, GPUBufferUsage: g0.GPUBufferUsage, GPUMapMode: g0.GPUMapMode, GPUShaderStage: g0.GPUShaderStage };
  Object.defineProperty(globalThis, 'navigator', { value: { gpu }, configurable: true });
  Object.assign(g0, { GPUTextureUsage: TEX, GPUBufferUsage: USAGE, GPUMapMode: { READ: 1, WRITE: 2 }, GPUShaderStage: { VERTEX: 1, FRAGMENT: 2, COMPUTE: 4 } });
  try {
    const canvas = { width: 8, height: 8, getContext: () => ({ configure() {}, getCurrentTexture: () => ({}) }) } as unknown as HTMLCanvasElement;
    const g = await createWebGPU(canvas);
    // (an rgba8 texture is drawn into, as every rgba8 one; it is not read back unless made renderable)
    const plain = g.texture({ label: 'pose', width: 4096, height: 1, format: 'rgba8', filter: 'nearest' });
    await assert.rejects(g.readTexture(plain), (e: Error & { code?: string }) => /texture 'pose' was not made to be read back/.test(e.message) && e.code === 'E-GPU-003');
    assert.equal(copies.length, 0, 'nothing copied out of it');
    const made = g.texture({ label: 'pose', width: 4096, height: 1, format: 'rgba8', filter: 'nearest', renderable: true });
    const px = await g.readTexture(made);
    assert.ok(px instanceof Uint8Array && px.length === 4096 * 4); assert.equal(copies.length, 1); assert.ok(copies[0]!.usage & TEX.COPY_SRC);
  } finally {
    if (was.nav) Object.defineProperty(globalThis, 'navigator', was.nav);
    Object.assign(g0, { GPUTextureUsage: was.GPUTextureUsage, GPUBufferUsage: was.GPUBufferUsage, GPUMapMode: was.GPUMapMode, GPUShaderStage: was.GPUShaderStage });
  }
});

test('readTexture: WebGL2 refuses alike what was not made to be read back', async () => {
  // (a WebGL2 context that answers every call: its constants numbers, its objects empty ones, never lost)
  const gl = new Proxy({}, { get: (_t, k) => (k === 'isContextLost' ? () => false : k === 'getParameter' ? () => 4096 : k === 'getExtension' ? () => null : typeof k === 'string' && /^[A-Z0-9_]+$/.test(k) ? 1 : () => ({})) });
  const canvas = { width: 8, height: 8, getContext: () => gl, addEventListener() {}, removeEventListener() {} } as unknown as HTMLCanvasElement;
  const g = createWebGL2(canvas);
  const plain = g.texture({ label: 'pose', width: 4096, height: 1, format: 'rgba8', filter: 'nearest' });
  await assert.rejects(g.readTexture(plain), (e: Error & { code?: string }) => /texture 'pose' was not made to be read back/.test(e.message) && e.code === 'E-GPU-003');
});
