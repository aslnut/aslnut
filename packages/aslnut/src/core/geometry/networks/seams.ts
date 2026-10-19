// core › geometry › networks › seams: where one level's union surface spans a height step it cannot drive.
// Two roads of one level that touch at different heights (a service road at grade beside a carriageway in a
// cutting, a ramp beside the road it leaves) share one union polygon; triangulated at their own heights, the
// facets between them become steep sheets of asphalt. A carriageway facet steeper than `limit` over more than
// `step` of height is not a road: it is cut out of the surface (the cells are first refined to 2.5 m, so only the
// seam itself remains) and the composed ground under it shows as the bank between the two roads
// (open-seam-to-ground), recorded per road. Plan coordinates never move.
import { unionD, areaD, FillRule } from 'clipper2-ts';
import { facetsOf, FacetIndex, type Facet } from './facets.ts';
import { polysOf } from './union.ts';
import type { Piece, P3 } from './bake-types.ts';
import { patch, patchPolicy, type Patch, type PatchOptions } from '../../runtime/workers/compile/patch-policy.ts';

/** facets joined back into areas like `base`, every vertex at the height of the facet it came from */
export function rejoinFacets(kept: readonly Facet[], base: Extract<Piece, { t: 'area' }>): Piece[] {
  if (!kept.length) return [];
  const index = new FacetIndex([...kept]);
  const height = (x: number, z: number) => { const f = index.at(x, z)[0]; if (f) return f.height(x, z); let best = Infinity, h = 0; for (const g of index.near(x, z, 1)) for (const q of g.points) { const d = Math.hypot(q[0] - x, q[1] - z); if (d < best) { best = d; h = q[2]; } } return h; };
  const shape = unionD(kept.map((f) => { const r = f.points.map((q) => ({ x: q[0], y: q[1] })); if (areaD(r) < 0) r.reverse(); return r; }), [], FillRule.NonZero, 3);
  return polysOf(shape).map((p) => ({ ...base, rings: [p.outer, ...p.holes].map((r) => r.map((q) => [q.x, q.y, height(q.x, q.y)] as P3)) }));
}
const gradeOf = (f: Facet) => { const [a, b, c] = f.points, den = (b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]); if (Math.abs(den) < 1e-8) return 0; const gx = ((b[2] - a[2]) * (c[1] - a[1]) - (c[2] - a[2]) * (b[1] - a[1])) / den, gz = ((b[0] - a[0]) * (c[2] - a[2]) - (c[0] - a[0]) * (b[2] - a[2])) / den; return Math.hypot(gx, gz); };

export function carriagewaySeams(pieces: Piece[], options: PatchOptions = {}, note: (p: Patch, ids: number[]) => void = () => {}, limit = 0.25, step = 0.75, repair = true) {
  let seamFacetsChecked = 0, carriagewaySteepFacets = 0, seamPiecesRepaired = 0, seamFacetsOpened = 0, seamAreaRemovedM2 = 0, maxCarriagewayGrade = 0, maxSeamStepM = 0;
  const errors: string[] = [], byInfo = new Map<number, { area: number; walls: number; step: number }>();
  for (let i = pieces.length - 1; i >= 0; i--) {
    const p = pieces[i]!; if (p.t !== 'area' || p.kind !== 'carriageway' || p.overhead) continue;
    const facets = facetsOf([p]), bad = new Set<Facet>();
    for (const f of facets) {
      seamFacetsChecked++; const g = gradeOf(f), hs = f.points.map((q) => q[2]), dh = Math.max(...hs) - Math.min(...hs);
      if (g > limit && dh > step) { bad.add(f); maxSeamStepM = Math.max(maxSeamStepM, dh); } else maxCarriagewayGrade = Math.max(maxCarriagewayGrade, g);
    }
    if (!bad.size) continue;
    const policy = patchPolicy(options, 'carriageway-step', 'repair', [String(p.info)]);
    if (!repair || policy === 'stop') { carriagewaySteepFacets += bad.size; errors.push(`carriageway-step ${p.info}: ${bad.size} facets steeper than ${limit} over ${step} m`); continue; }
    pieces.splice(i, 1);
    pieces.push(...rejoinFacets(facets.filter((f) => !bad.has(f)), p));
    const rec = byInfo.get(p.info) ?? { area: 0, walls: 0, step: 0 };
    for (const f of bad) {
      const [a, b, c] = f.points, area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2, low = Math.min(a[2], b[2], c[2]);
      seamAreaRemovedM2 += area; rec.area += area; rec.step = Math.max(rec.step, Math.max(a[2], b[2], c[2]) - low);
      rec.walls++; seamFacetsOpened++;
    }
    seamPiecesRepaired++; byInfo.set(p.info, rec);
  }
  for (const [info, r] of byInfo) note(patch('carriageway-step', patchPolicy(options, 'carriageway-step', 'repair', [String(info)]), 'open-seam-to-ground', [String(info)], { facets: r.walls }, { removedAreaM2: r.area, stepM: r.step }, { gradeLimit: limit, sourcePlanMoved: false }), [info]);
  return { counts: { seamFacetsChecked, carriagewaySteepFacets, seamPiecesRepaired, seamFacetsOpened }, worst: { seamAreaRemovedM2, maxCarriagewayGrade, maxSeamStepM }, errors };
}
