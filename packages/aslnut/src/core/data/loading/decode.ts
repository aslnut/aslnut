// core › data › loading › decode: image bytes → raw pixels (RGBA, no colour management, not premultiplied) off the main
// thread, in a small pool of workers. Terrain-RGB tiles become heights from these pixels: the decode and the read-back
// never cost the frame. Where workers cannot start (a strict Content-Security-Policy, Node), the same work runs here.
import { AslnutError } from '../../world/errors.ts';

export interface Pixels { width: number; height: number; data: Uint8ClampedArray }

const WORKER = `self.onmessage = async (e) => {
  const { id, blob, raw, compose } = e.data;
  if (compose) {
    try {
      const { size, fill, parts } = compose, c = new OffscreenCanvas(size, size), g = c.getContext('2d', { willReadFrequently: true });
      g.fillStyle = fill; g.fillRect(0, 0, size, size);
      // every image here is the worker's own (sent, or a copy of the page's): closed once drawn, never left to the
      // garbage collector (a decoded image holds its pixels, on some phones in the graphics process)
      for (const p of parts) { g.globalAlpha = p.alpha; g.globalCompositeOperation = p.op; g.drawImage(p.im, p.sx, p.sy, p.sw, p.sh, 0, 0, size, size); p.im.close(); }
      const d = g.getImageData(0, 0, size, size).data;
      self.postMessage({ id, width: size, height: size, data: d }, [d.buffer]);
    } catch (err) { for (const p of compose.parts) { try { p.im.close(); } catch {} } self.postMessage({ id, error: String(err && err.message || err) }); }
    return;
  }
  try {
    const im = await createImageBitmap(blob, raw ? { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } : { premultiplyAlpha: 'none' });
    const c = new OffscreenCanvas(im.width, im.height), g = c.getContext('2d', { willReadFrequently: true });
    g.drawImage(im, 0, 0); im.close();
    const d = g.getImageData(0, 0, c.width, c.height).data;
    self.postMessage({ id, width: c.width, height: c.height, data: d }, [d.buffer]);
  } catch (err) { self.postMessage({ id, error: String(err && err.message || err) }); }
};`;

let pool: Worker[] | null = null, broken = false, next = 0, seq = 0;
const waiting = new Map<number, { worker: Worker; ok: (p: Pixels) => void; bad: (e: Error) => void }>();
function workers(): Worker[] | null {
  if (pool || broken) return pool;
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined' || typeof Blob === 'undefined') { broken = true; return null; }
    const url = URL.createObjectURL(new Blob([WORKER], { type: 'text/javascript' }));
    const n = Math.max(1, Math.min(3, ((typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 4) - 2));
    pool = [];
    try {
      for (let i = 0; i < n; i++) {
        const w = new Worker(url);
        w.onmessage = (e: MessageEvent<{ id: number; width: number; height: number; data: Uint8ClampedArray; error?: string }>) => {
          const r = waiting.get(e.data.id); if (!r || r.worker !== w) return; waiting.delete(e.data.id);
          if (e.data.error) r.bad(new AslnutError('E-DATA-002', e.data.error, { fix: 'check the image bytes and canvas support' })); else r.ok({ width: e.data.width, height: e.data.height, data: e.data.data });
        };
        w.onerror = (e) => failWorker(w, e.message);
        w.onmessageerror = () => failWorker(w, 'the worker response could not be read');
        pool.push(w);
      }
    } finally { URL.revokeObjectURL(url); }
  } catch {
    for (const w of pool ?? []) w.terminate();
    broken = true; pool = null;
  }
  return pool;
}
function failWorker(w: Worker, message: string): void {
  pool = pool?.filter((x) => x !== w) ?? null;
  if (!pool?.length) { pool = null; broken = true; }
  w.terminate();
  const error = new AslnutError('E-LOAD-006', `image decode worker failed: ${message}`, { fix: 'retry loading the image; check worker and canvas support' });
  for (const [id, r] of waiting) if (r.worker === w) { waiting.delete(id); r.bad(error); }
}
function request(w: Worker, message: object, transfer: Transferable[] = []): Promise<Pixels> {
  const id = ++seq;
  return new Promise<Pixels>((ok, bad) => {
    waiting.set(id, { worker: w, ok, bad });
    try { w.postMessage({ id, ...message }, transfer); }
    catch (e) { failWorker(w, String(e)); }
  });
}
/** start the decoding workers while configured tile sources fetch their bytes */
export function prepareDecode(): void { workers(); }
async function here(blob: Blob, raw: boolean): Promise<Pixels> {
  const im = await createImageBitmap(blob, raw ? { colorSpaceConversion: 'none', premultiplyAlpha: 'none' } : { premultiplyAlpha: 'none' });
  const c = new OffscreenCanvas(im.width, im.height), g = c.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(im, 0, 0); im.close();
  return { width: c.width, height: c.height, data: g.getImageData(0, 0, c.width, c.height).data };
}
/** the pixels of an image, decoded off the main thread when it can be; raw: no colour management (data such as
 *  terrain-RGB), else as the browser shows it (imagery) */
export function pixelsOf(blob: Blob, raw = true): Promise<Pixels> {
  const ws = workers();
  if (!ws || broken) return here(blob, raw);
  return request(ws[next++ % ws.length]!, { blob, raw }).catch((e: unknown) => {
    if (e instanceof AslnutError && e.code === 'E-LOAD-006') throw e;
    return here(blob, raw);
  });
}

/** one layer of a picture composed off the main thread: an image (or a piece of it: sx, sy, sw, sh), its opacity and
 *  how it mixes (a canvas composite operation). own: the image is the composer's to close (sent, not shared) */
export interface ComposePart { im: ImageBitmap; sx: number; sy: number; sw: number; sh: number; alpha: number; op: GlobalCompositeOperation; own?: boolean }
function composeHere(size: number, fill: string, parts: ComposePart[]): Pixels {
  const c = new OffscreenCanvas(size, size), g = c.getContext('2d', { willReadFrequently: true })!;
  g.fillStyle = fill; g.fillRect(0, 0, size, size);
  for (const p of parts) { g.globalAlpha = p.alpha; g.globalCompositeOperation = p.op; g.drawImage(p.im, p.sx, p.sy, p.sw, p.sh, 0, 0, size, size); if (p.own) p.im.close(); }
  return { width: size, height: size, data: g.getImageData(0, 0, size, size).data };
}
/** layers of images composed into one picture's pixels (RGBA, size × size) in a worker: the canvas work and the read
 *  back never cost the main thread (a tile of two imagery sources once took the frame on a phone, worse on WebGPU,
 *  which copied the canvas through the main thread) */
export function composeOf(size: number, fill: string, parts: ComposePart[]): Promise<Pixels> {
  const ws = workers();
  if (!ws || broken) return Promise.resolve(composeHere(size, fill, parts));
  return request(ws[next++ % ws.length]!, { compose: { size, fill, parts } }, parts.filter((p) => p.own).map((p) => p.im));
}
