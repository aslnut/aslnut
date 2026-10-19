// The offscreen page's scene: a floor and nine points, on an OffscreenCanvas (on the page or in a worker), settled, one
// frame read back and counted (the points' red, the colours). The same code in both places.
import { planeAt, plane, points, world } from '../../src/index.ts';

export interface OffscreenResult { api?: string; width?: number; height?: number; red?: number; colours?: number; frames?: number; where: 'page' | 'worker'; error?: string }
export async function scene(canvas: OffscreenCanvas, graphics: 'auto' | 'webgpu' | 'webgl2', where: 'page' | 'worker'): Promise<OffscreenResult> {
  try {
    const w = await world(canvas, { body: plane({ size: 200, grid: 10 }), graphics, view: { lon: 0, lat: 0, dist: 260, tilt: 0, bearing: 0 } });
    w.add(points({ id: 'posts', data: Array.from({ length: 9 }, (_, i) => ({ at: planeAt(-40 + (i % 3) * 40, -40 + Math.floor(i / 3) * 40) })), size: 24, color: '#e11d48' }));
    await w.settled({ strict: true, timeout: 60000 });
    const f = await w.frame();
    let red = 0; const cols = new Set<number>();
    for (let i = 0; i < f.pixels.length; i += 4) { if (f.pixels[i]! > 180 && f.pixels[i + 1]! < 80) red++; if (i % 64 === 0) cols.add(f.pixels[i]! * 65536 + f.pixels[i + 1]! * 256 + f.pixels[i + 2]!); }
    const out = { api: w.api, width: f.width, height: f.height, red, colours: cols.size, frames: w.report().frames, where };
    return out;
  } catch (e) { return { where, error: String((e as Error)?.stack ?? e) }; }
}
