// core › world › order: which layer is drawn over which. By kind first (ground pictures at the bottom, points and
// labels on top), then by the order they were added (later on top). Override with `order` (a place on the kind
// scale below: 2.5 = above areas, under lines), or relative to another layer with `above` / `below`.
//   w.add(raster({ id: 'solar' }), raster({ id: 'wind' }))     wind over solar
//   line({ id: 'grid', above: 'crime' }) · w.move('wind', { below: 'solar' })
import { AslnutError } from './errors.ts';

export type Kind = 'sky' | 'basemap' | 'raster' | 'area' | 'line' | 'extrusion' | 'shape' | 'custom' | 'point' | 'label';
/** the kind scale, bottom to top */
export const KIND_ORDER: Record<Kind, number> = { sky: -1, basemap: 0, raster: 1, area: 2, line: 3, extrusion: 4, shape: 4, custom: 4, point: 5, label: 6 };

export interface Orderable { id: string; kind: Kind; order?: number; above?: string; below?: string; /** add sequence */ added: number }

/** the draw order, bottom first */
export function sortElements<T extends Orderable>(list: readonly T[]): T[] {
  const ids = new Map(list.map((l) => [l.id, l]));
  for (const l of list) for (const ref of [l.above, l.below]) if (ref !== undefined && !ids.has(ref)) {
    throw new AslnutError('E-WORLD-002', `layer '${l.id}' is ${l.above === ref ? 'above' : 'below'} '${ref}', which is not in the world`, { where: l.id, fix: `add '${ref}' first, or remove the ${l.above === ref ? 'above' : 'below'}` });
  }
  const rank = (l: T) => l.order ?? KIND_ORDER[l.kind];
  const out = [...list].filter((l) => l.above === undefined && l.below === undefined).sort((a, b) => rank(a) - rank(b) || a.added - b.added);
  // relative ones: each placed next to its anchor, once the anchor is placed (chains resolve in a few passes)
  let rest = list.filter((l) => l.above !== undefined || l.below !== undefined).sort((a, b) => a.added - b.added);
  while (rest.length) {
    const left: T[] = [];
    for (const l of rest) {
      const ref = (l.above ?? l.below)!, i = out.findIndex((x) => x.id === ref);
      if (i < 0) { left.push(l); continue; }
      if (l.above !== undefined) {
        // directly above the anchor, but above anything already placed above it the same way (add order holds)
        let j = i + 1; while (j < out.length && out[j]!.above === ref) j++;
        out.splice(j, 0, l);
      } else out.splice(i, 0, l);
    }
    if (left.length === rest.length) throw new AslnutError('E-WORLD-002', `layers ${left.map((l) => `'${l.id}'`).join(', ')} are placed relative to each other in a circle`, { fix: 'give one of them an order number instead of above / below' });
    rest = left;
  }
  return out;
}
