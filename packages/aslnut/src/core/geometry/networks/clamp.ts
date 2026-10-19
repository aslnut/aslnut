// core › geometry › networks › clamp: the ground meets the road. A road surface stands a little over the ground at
// every vertex (each on its own ground: the road follows the terrain), and its edges go down into the ground (a
// skirt: no gap shows under a kerb or a footpath, whatever the terrain does between its vertices). Pieces own their
// ground: a band's edge takes the ground under it, and the next band starts from there.
//   const sk = skirts(edgeLine, 0.25)   → quads from each edge segment down to 0.4 m under the ground
import type { P2 } from './sections.ts';

/** how high each part of a road stands over the ground (m): the carriageway, the kerb's top, the strip, the footpath,
 *  a junction's platform, and how deep the skirts go */
export interface Levels { carriageway: number; kerb: number; strip: number; footpath: number; platform: number; markings: number; skirt: number }
export const LEVELS: Levels = { carriageway: 0.12, kerb: 0.27, strip: 0.2, footpath: 0.24, platform: 0.13, markings: 0.02, skirt: 0.4 };
/** the skirt under an edge: from its top down into the ground, as segments (a, b, top, bottom) */
export function skirts(edge: readonly P2[], top: number, depth = LEVELS.skirt): { a: P2; b: P2; top: number; bottom: number }[] {
  const out: { a: P2; b: P2; top: number; bottom: number }[] = [];
  for (let i = 0; i + 1 < edge.length; i++) out.push({ a: edge[i]!, b: edge[i + 1]!, top, bottom: -depth });
  return out;
}
