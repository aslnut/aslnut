// The offscreen page: a world on an OffscreenCanvas, on WebGPU or WebGL2, on the page (an OffscreenCanvas made here)
// or in a worker (the page's canvas handed over). No controls there: the host sends the input (w.go, w.fly). The
// tools read window.aslnutOffscreen (tools/checks.mjs offscreen).
//   ?where=page | worker   &graphics=auto | webgpu | webgl2
import { scene, type OffscreenResult } from './scene.ts';

declare global { interface Window { aslnutOffscreen?: OffscreenResult } }
const q = new URLSearchParams(location.search), where = q.get('where') === 'page' ? 'page' : 'worker';
const graphics = (['webgpu', 'webgl2'].includes(q.get('graphics') ?? '') ? q.get('graphics') : 'auto') as 'auto' | 'webgpu' | 'webgl2';
const view = document.getElementById('view') as HTMLCanvasElement, note = document.getElementById('note')!;
view.width = Math.round(view.clientWidth * devicePixelRatio); view.height = Math.round(view.clientHeight * devicePixelRatio);
const done = (r: OffscreenResult) => { window.aslnutOffscreen = r; note.textContent = r.error ? `failed (${r.where}): ${r.error}` : `a world in ${r.where === 'page' ? 'an OffscreenCanvas on the page' : 'a worker'} on ${r.api}: ${r.width} × ${r.height}, ${r.frames} frames`; };
if (where === 'worker') {
  const wk = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  wk.onmessage = (e: MessageEvent<OffscreenResult>) => done(e.data);
  wk.onerror = (e) => done({ where, error: `the worker failed: ${e.message}` });
  const oc = view.transferControlToOffscreen();
  wk.postMessage({ canvas: oc, graphics }, [oc]);
} else {
  // (on the page: its pixels shown through a bitmap each time it is read; here once)
  const oc = new OffscreenCanvas(view.width, view.height);
  void scene(oc, graphics, 'page').then((r) => { done(r); if (!r.error) view.getContext('bitmaprenderer')?.transferFromImageBitmap(oc.transferToImageBitmap()); });
}
