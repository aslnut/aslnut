// core › geometry › shapes › checks › preview: a shape on a canvas of its own, for any page or studio. Its levels side by side
// (whole, simple, far) with their triangles against its budget; `distance`: one copy and a slider walking the camera
// away (the level changes as it gets small on screen); new params on the fly (a form's).
//   const p = await preview(bin, { canvas, distance: true }); p.set({ lid: '#e8c22c' })
import { world, type World } from '../../world/world.ts';
import { solids, type Solids } from './solids.ts';
import { INSTANCE_FLOATS, rgbOf } from './mesh.ts';
import type { ParamSpec, ParamsOf, Shape } from './shape.ts';

export interface Preview<D extends Record<string, ParamSpec>> {
  readonly world: World;
  /** build it again with these params */
  set(p: Partial<ParamsOf<D>>): void;
  /** triangles per level, and the budget's */
  readonly triangles: number[];
  dispose(): void;
}
export async function preview<D extends Record<string, ParamSpec>, X>(s: Shape<D, X>, o: { canvas: HTMLCanvasElement; params?: Partial<ParamsOf<D> & X>; levels?: boolean; distance?: boolean; graphics?: 'auto' | 'webgpu' | 'webgl2' }): Promise<Preview<D>> {
  const w = await world(o.canvas, { body: null, graphics: o.graphics ?? 'auto', view: { lon: 0, lat: 0, zoom: 19, tilt: 60, bearing: 330 } } as never);
  const layer: Solids = solids({ id: `preview-${s.id}`, hover: false, pixels: { full: 120, simple: 25 } });
  w.add(layer);
  const overlay = document.createElement('div');
  Object.assign(overlay.style, { position: 'absolute', left: '8px', bottom: '8px', font: '12px system-ui', color: '#e5e7eb', background: 'rgba(15,23,42,.7)', padding: '4px 8px', borderRadius: '6px', pointerEvents: 'none' });
  o.canvas.parentElement?.appendChild(overlay);
  let slider: HTMLInputElement | null = null, tris: number[] = [];
  const place = (p: Partial<ParamsOf<D> & X>) => {
    const m = s.make(p), [lo, hi] = m.bounds, size = Math.max(0.5, hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]), gap = size * 1.6, white = rgbOf('#ffffff');
    tris = m.triangles;
    const inst = (x: number) => Float32Array.from([x, 250, 0, 0, 1, 1, 1, Math.PI, white, 0].slice(0, INSTANCE_FLOATS));
    const sets = o.distance
      ? [{ shape: m.levels as never, data: inst(250), radius: size / 2 }]
      : (o.levels ?? true) ? m.levels.map((lv, i) => ({ shape: [lv] as never, data: inst(250 + (i - 1) * gap) })) : [{ shape: m.levels as never, data: inst(250), radius: size / 2 }];
    layer.put('shape', { origin: [0, 0], at: [-250, -250], free: true, instances: sets, info: () => null });
    const b = s.spec.budget ?? {};
    overlay.textContent = ['whole', 'simple', 'far'].map((n, i) => `${n} ${tris[i] ?? 0}${(b as Record<string, number | undefined>)[n] !== undefined ? ` / ${(b as Record<string, number>)[n]}` : ''}`).join(' · ');
    w.go({ lon: 0, lat: 0, dist: Math.max(4, (o.levels ?? true) && !o.distance ? gap * 2.6 : size * 3), tilt: 62, bearing: 330 } as never);
  };
  if (o.distance) {
    slider = document.createElement('input'); slider.type = 'range'; slider.min = '1'; slider.max = '200'; slider.value = '3';
    Object.assign(slider.style, { position: 'absolute', left: '8px', top: '8px', width: '40%' });
    slider.oninput = () => { w.go({ lon: 0, lat: 0, dist: Number(slider!.value) * 2, tilt: 62, bearing: 330 } as never); };
    o.canvas.parentElement?.appendChild(slider);
  }
  place(o.params ?? {});
  return {
    world: w,
    set: (p) => place({ ...(o.params ?? {}), ...p } as never),
    get triangles() { return tris; },
    dispose() { overlay.remove(); slider?.remove(); w.dispose(); },
  };
}
