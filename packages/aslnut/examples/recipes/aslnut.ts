// What `import … from 'aslnut'` is on the recipes page (vite's alias in vite.config.ts; tsc reads the package itself
// through tsconfig's paths): the package as it is, with world() noting each world it makes (window.aslnutWorlds: the
// checks read them) and taking the page's &graphics= and &dpr= (tools/smoke-recipes.mjs runs every recipe on WebGPU and
// on WebGL2). Nothing else differs from the package.
export * from '../../src/index.ts';
import { world as make, type World, type WorldOptions } from '../../src/index.ts';

const q = new URLSearchParams(typeof location === 'undefined' ? '' : location.search);
const graphics = q.get('graphics') as WorldOptions['graphics'] | null;
const dpr = q.get('dpr') ? Number(q.get('dpr')) : undefined;

export async function world(canvas: HTMLCanvasElement | OffscreenCanvas | null, o: WorldOptions = {}): Promise<World> {
  const w = await make(canvas, { ...o, ...(graphics ? { graphics } : {}), ...(dpr ? { pixelRatio: dpr } : {}) });
  const g = globalThis as unknown as { aslnutWorlds?: World[] };
  (g.aslnutWorlds ??= []).push(w);
  return w;
}
