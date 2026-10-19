// The offscreen page's worker: the world drawn here, on the canvas the page handed over (transferControlToOffscreen).
import { scene } from './scene.ts';

self.onmessage = async (e: MessageEvent<{ canvas: OffscreenCanvas; graphics: 'auto' | 'webgpu' | 'webgl2' }>) => {
  (self as unknown as Worker).postMessage(await scene(e.data.canvas, e.data.graphics, 'worker'));
};
