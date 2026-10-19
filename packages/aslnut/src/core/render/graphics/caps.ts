// core › render › graphics › caps: what this browser can draw with, and the profile that follows. Both graphics are first
// class: 'auto' takes WebGPU when it works and WebGL2 otherwise, and always says why.
//   const s = await supported();  // { api: 'webgpu' | 'webgl2' | null, webgpu, webgl2, reason }
import { GraphicsUnavailable } from '../../world/errors.ts';
import type { Quality } from '../../world/state.ts';
import type { Api, Caps, Graphics } from './interface.ts';
import { createWebGL2 } from './webgl2.ts';
import { createWebGPU } from './webgpu.ts';

export interface Support { api: Api | null; webgpu: boolean; webgl2: boolean; reason: string }

/** what can draw here (never throws; touches nothing it keeps) */
export async function supported(): Promise<Support> {
  let webgpu = false, webgl2 = false, why = '';
  const gpu = typeof navigator !== 'undefined' ? (navigator as Navigator & { gpu?: GPU }).gpu : undefined;
  if (!gpu) why = 'no navigator.gpu';
  else {
    try { webgpu = !!(await gpu.requestAdapter()); if (!webgpu) why = 'WebGPU present but no adapter'; } catch (e) { why = `WebGPU adapter failed: ${(e as Error).message}`; }
  }
  try {
    const c = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(1, 1) : typeof document !== 'undefined' ? document.createElement('canvas') : null;
    const gl = c?.getContext('webgl2') as WebGL2RenderingContext | null | undefined;
    webgl2 = !!gl; gl?.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { webgl2 = false; }
  const api = webgpu ? 'webgpu' : webgl2 ? 'webgl2' : null;
  const reason = webgpu ? 'WebGPU is available' : webgl2 ? `WebGL2 (${why || 'WebGPU unavailable'})` : `${why}; no WebGL2 either`;
  return { api, webgpu, webgl2, reason };
}

/** open the graphics on a canvas: 'auto' tries WebGPU, then WebGL2; a forced one fails plainly when missing */
export async function openGraphics(canvas: HTMLCanvasElement | OffscreenCanvas, want: 'auto' | Api = 'auto'): Promise<{ graphics: Graphics; reason: string }> {
  let gpuWhy = '';
  if (want === 'auto' || want === 'webgpu') {
    try {
      const g = await createWebGPU(canvas);
      return { graphics: g, reason: want === 'webgpu' ? 'WebGPU, as asked' : 'WebGPU (auto: available here)' };
    } catch (e) {
      gpuWhy = (e as Error).message;
      if (want === 'webgpu') { const s = await supported(); throw new GraphicsUnavailable('webgpu', { webgpu: false, webgl2: s.webgl2, reason: gpuWhy }); }
    }
  }
  try {
    const g = createWebGL2(canvas);
    return { graphics: g, reason: want === 'webgl2' ? 'WebGL2, as asked' : `WebGL2 (auto: ${gpuWhy || 'WebGPU unavailable'})` };
  } catch (e) {
    throw new GraphicsUnavailable(want, { webgpu: false, webgl2: false, reason: `${gpuWhy ? gpuWhy + '; ' : ''}${(e as Error).message}` });
  }
}

/** what a device and a graphics afford: quality, pixel ratio, tile memory, the frame budget it is held to */
export interface Profile {
  quality: Quality; maxPixelRatio: number; tileLayers: number; tilePx: number; tier: 'low' | 'mid' | 'high';
  /** a touch device (a coarse pointer: phones, tablets) */
  touch: boolean;
  /** why this quality, in words ('' : the default for this device) */
  why: string;
  /** the budget a world on it gets unless it sets one (`budget: 'auto'`, the default): phones, tablets and low-tier
   *  devices hold 30 frames a second at the least (22 ms; a frame over 33 ms is over), the governor stepping detail
   *  down and back up; elsewhere none (measured, never stepped) */
  budget: { frameMs: number } | null;
}
/** a coarse pointer: a phone or a tablet */
export const isTouch = (): boolean => typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
/** the device's own pick (quality 'auto'): its tier from its memory and cores, lite on WebGL2, touch screens and low
 *  tiers, realistic elsewhere; the pixel ratio, tiles and budget that go with it */
export function profileOf(caps: Caps, o: { quality?: Quality; deviceMemory?: number; cores?: number; touch?: boolean } = {}): Profile {
  const mem = o.deviceMemory ?? (typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined) ?? 8;
  const cores = o.cores ?? (typeof navigator !== 'undefined' ? navigator.hardwareConcurrency : undefined) ?? 8;
  const tier = mem <= 3 || cores <= 2 ? 'low' : mem <= 6 || cores <= 4 ? 'mid' : 'high';
  const touch = o.touch ?? isTouch();
  // lite on WebGL2 (older phones are why it is there) and on every phone or tablet whichever graphics draws, so one
  // device gets the same work on WebGPU and WebGL2 (on a mid-range phone GPU, realistic on WebGPU drew more tiles at a higher
  // pixel ratio than lite on WebGL2 in the same view); realistic stays a choice
  const why = o.quality ? 'as asked' : caps.api === 'webgl2' ? 'the WebGL2 default' : touch ? 'a touch device' : tier === 'low' ? `${mem} GB of memory, ${cores} cores` : '';
  const quality: Quality = o.quality ?? (caps.api === 'webgl2' || tier === 'low' || touch ? 'lite' : 'realistic');
  const lite = quality === 'lite';
  return {
    quality, tier, touch, why,
    maxPixelRatio: lite ? 1.5 : 2,
    tileLayers: Math.min(caps.maxLayers, lite || tier === 'low' ? 128 : 192),
    tilePx: lite ? 384 : 280,
    budget: touch || tier === 'low' ? { frameMs: 22 } : null,
  };
}
