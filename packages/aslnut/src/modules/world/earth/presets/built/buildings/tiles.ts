// modules › world › earth › presets › built › buildings › tiles: the placement of stages 12–15 written as the street
// level's tiles (the city tile format, v3: 500 m squares from the place's origin, decimetres from a tile's north-west
// corner, x east, z south). Placement only: no look is decided here.
//   buildings  [height dm, height from, class, x0, z0, dx, dz …]   the footprint as placed (clipped or set back)
//   anchors    per building, the corner on the lowest graded ground
//   pads       per building, [floor, foundation's foot] in cm over the anchor's graded ground
//   seeds      per building (the source's seed) and per tree (`tseeds`, 16 bits of it)
//   homes      per building, 1 when the bake made it a house (a plot, a front, a house's look), else 0
//   fronts     [building, x, z, along x, along z (× 1000), span from, span to (dm)]: the property line before a house
//   lots       [building, x0, z0, dx, dz …]: its plot (in half metres: a plot is made, not measured)
//   trees      [x, z, height (dm)] triples and `crowns` (dm) apart (decoded as [x, z, height, crown]) · furniture [kind, x, z, id, seed]
//   patches    [what (0 building, 1 tree, 2 furniture), index, text, source tile x, z, row (a building's)] · omitted [what (0 building, 1 plot, 2 tree,
//              3 furniture), x, z, check, id]
// Numbers travel as `numeric` rows (core › data › loading › chunks › numbers, whole decimetres); `decodeBuiltTile`
// gives the plain arrays back. Roads (for networks: class, width, name, line), open space, water and streams ride
// along as they came.
import { encodeNumbers, decodeNumbers } from '../../../../../../core/data/loading/chunks/numbers.ts';
import type { StageGate } from '../../../../../../core/runtime/workers/compile/patch-policy.ts';
import type { P2 } from '../../../shared/plan.ts';
import type { BuiltPlacement, FeaturePatch } from './compile.ts';
import type { SourceGround } from './inputs.ts';

const SIZE = 500, NUMERIC = ['roads', 'buildings', 'parks', 'water', 'streams', 'lots'] as const, FLAT = ['trees', 'crowns', 'anchors', 'pads', 'seeds', 'tseeds', 'fronts', 'furniture', 'homes'] as const;
const dm = (v: number) => Math.round(v * 10);
const encodeLine = (pts: readonly P2[], ox: number, oz: number, per = 10) => { const out: number[] = []; let px = 0, pz = 0; pts.forEach((p, i) => { const x = Math.round((p[0] - ox) * per), z = Math.round((p[1] - oz) * per); if (i === 0) out.push(x, z); else out.push(x - px, z - pz); px = x; pz = z; }); return out; };
const middle = (pts: readonly P2[]): P2 => { let x = 0, z = 0; for (const p of pts) { x += p[0]; z += p[1]; } return [x / (pts.length || 1), z / (pts.length || 1)]; };
export const patchText = (p: FeaturePatch) => `${p.policy === 'omit' ? 'omitted' : 'patched'}: ${p.algorithm}${p.amount !== undefined ? ` ${p.amount.toFixed(2)} ${p.unit ?? ''}`.trimEnd() : ''} (${p.check})`;
/** a stage's gate without its id lists (the roads' index keeps those) */
const summary = (g: StageGate) => ({ stage: g.stage, id: g.id, name: g.name, ok: g.ok, counts: g.counts, worst: g.worst, checks: g.checks, patches: (g.patches ?? []).map((p) => ({ check: p.check, policy: p.policy, algorithm: p.algorithm, pieces: p.counts.pieces ?? p.ids.length, worst: p.worst })) });

export function builtTiles(o: { placement: BuiltPlacement; ground: SourceGround; origin: [number, number]; bbox: readonly number[]; attribution: string; sources: Record<string, unknown>; gates: StageGate[] }): { index: Record<string, unknown>; tiles: Map<string, Record<string, unknown>> } {
  type T = { ix: number; iz: number; s: string[]; sx: Map<string, number>; rows: Record<string, number[][]>; flat: Record<string, number[]>; patches: number[][]; omitted: number[][]; nb: number; nt: number; nf: number };
  const tiles = new Map<string, T>();
  const tileAt = (x: number, z: number): T => { const ix = Math.floor(x / SIZE), iz = Math.floor(z / SIZE), k = `${ix}_${iz}`; let t = tiles.get(k); if (!t) tiles.set(k, (t = { ix, iz, s: [], sx: new Map(), rows: Object.fromEntries(NUMERIC.map((n) => [n, []])), flat: Object.fromEntries(FLAT.map((n) => [n, []])), patches: [], omitted: [], nb: 0, nt: 0, nf: 0 })); return t; };
  const str = (t: T, v: string) => { let i = t.sx.get(v); if (i === undefined) { i = t.s.length; t.s.push(v); t.sx.set(v, i); } return i; };
  const g = o.ground;
  for (const r of g.roads) { const t = tileAt(...middle(r.pts)); t.rows.roads!.push([r.cls, dm(r.width), str(t, r.name), str(t, ''), ...encodeLine(r.pts, t.ix * SIZE, t.iz * SIZE)]); }
  for (const p of g.parks) { const t = tileAt(...middle(p.ring)); t.rows.parks!.push([str(t, p.name), str(t, p.group), p.area, ...encodeLine(p.ring, t.ix * SIZE, t.iz * SIZE)]); }
  for (const w of g.water) { const t = tileAt(...middle(w.ring)); t.rows.water!.push([str(t, w.name), str(t, w.type), w.area, ...encodeLine(w.ring, t.ix * SIZE, t.iz * SIZE)]); }
  for (const s of g.streams) { const t = tileAt(...middle(s.pts)); t.rows.streams!.push([dm(s.width), str(t, s.name), str(t, s.type), ...encodeLine(s.pts, t.ix * SIZE, t.iz * SIZE)]); }
  const p = o.placement;
  for (const b of p.buildings) {
    const t = tileAt(...middle(b.ring)), ox = t.ix * SIZE, oz = t.iz * SIZE, k = t.nb++;
    t.rows.buildings!.push([dm(b.height), b.heightFrom, str(t, b.cls), ...encodeLine(b.ring, ox, oz)]);
    const anchor = b.pad?.anchor ?? 0, ag = b.pad?.anchorGround ?? 0;
    t.flat.anchors!.push(anchor); t.flat.pads!.push(b.pad ? Math.round((b.pad.pad - ag) * 100) : 0, b.pad ? Math.round((b.pad.bottom - ag) * 100) : -30); t.flat.seeds!.push(b.seed); t.flat.homes!.push(b.house ? 1 : 0);
    if (b.plot) {
      const [px, pz] = b.plot.front.p, [tx, tz] = b.plot.front.t, [s0, s1] = b.plot.span ?? [0, 0];
      t.flat.fronts!.push(k, dm(px - ox), dm(pz - oz), Math.round(tx * 1000), Math.round(tz * 1000), dm(s0), dm(s1));
      t.rows.lots!.push([k, ...encodeLine(b.plot.ring, ox, oz, 2)]);
    }
    const src = /^bld-(-?\d+)-(-?\d+)-(\d+)$/.exec(b.id); for (const q of b.patches) t.patches.push([0, k, str(t, patchText(q)), ...(src ? [+src[1]!, +src[2]!, +src[3]!] : [0, 0, -1])]);
  }
  for (const tr of p.trees) { const t = tileAt(tr.x, tr.z), k = t.nt++; t.flat.trees!.push(dm(tr.x - t.ix * SIZE), dm(tr.z - t.iz * SIZE), dm(tr.height)); t.flat.crowns!.push(dm(tr.crown)); t.flat.tseeds!.push(tr.seed & 0xffff); for (const q of tr.patches) t.patches.push([1, k, str(t, patchText(q)), 0, 0, -1]); }
  for (const f of p.furniture) { const t = tileAt(f.x, f.z), k = t.nf++; t.flat.furniture!.push(str(t, f.kind), dm(f.x - t.ix * SIZE), dm(f.z - t.iz * SIZE), str(t, f.name ? `${f.id} · ${f.name}` : f.id), f.seed); for (const q of f.patches) t.patches.push([2, k, str(t, patchText(q)), 0, 0, -1]); }
  const KIND = { building: 0, plot: 1, tree: 2, furniture: 3 } as const;
  for (const m of p.omitted) { const t = tileAt(m.at[0], m.at[1]); t.omitted.push([KIND[m.kind], dm(m.at[0] - t.ix * SIZE), dm(m.at[1] - t.iz * SIZE), str(t, m.check), str(t, `${m.id} · ${m.source}`)]); }
  const out = new Map<string, Record<string, unknown>>();
  for (const [k, t] of tiles) {
    const numeric: Record<string, string[]> = {};
    for (const n of NUMERIC) if (t.rows[n]!.length) numeric[n] = encodeNumbers(t.rows[n]!, 1);
    for (const n of FLAT) if (t.flat[n]!.length) numeric[n] = encodeNumbers([t.flat[n]!], 1);
    if (t.patches.length) numeric.patches = encodeNumbers([t.patches.flat()], 1);
    out.set(k, { v: 3, ix: t.ix, iz: t.iz, size: SIZE, baked: true, s: t.s, numeric, ...(t.omitted.length ? { omitted: t.omitted } : {}) });
  }
  const index = { v: 3, size: SIZE, origin: o.origin, bbox: o.bbox, attribution: o.attribution, sources: o.sources, baked: true, stages: o.gates.map(summary), tiles: [...tiles.values()].map((t) => [t.ix, t.iz]) };
  return { index, tiles: out };
}
/** a v3 tile's numbers back as the plain arrays (in place; a v1/v2 tile is left as it is) */
export function decodeBuiltTile<T extends Record<string, unknown>>(t: T): T {
  const n = (t as { numeric?: Record<string, string[]> }).numeric; if (!n) return t;
  const r = t as Record<string, unknown>;
  for (const k of NUMERIC) r[k] = n[k] ? decodeNumbers(n[k], 1).map((row) => row.map(Math.round)) : [];
  for (const k of FLAT) r[k] = n[k] ? decodeNumbers(n[k], 1)[0]!.map(Math.round) : [];
  // fronts back as rows of seven, patches of six
  const rowsOf = (f: number[], n: number) => { const rows: number[][] = []; for (let i = 0; i + n - 1 < f.length; i += n) rows.push(f.slice(i, i + n)); return rows; };
  r.fronts = rowsOf(r.fronts as number[], 7);
  // trees travel as x, z, height triples and their crowns apart: back as [x, z, height, crown] fours
  const xyz = r.trees as number[], crowns = r.crowns as number[], four: number[] = []; for (let i = 0; i * 3 + 2 < xyz.length; i++) four.push(xyz[3 * i]!, xyz[3 * i + 1]!, xyz[3 * i + 2]!, crowns[i] ?? 0); r.trees = four; delete r.crowns;
  r.patches = n.patches ? rowsOf(decodeNumbers(n.patches, 1)[0]!.map(Math.round), 6) : [];
  delete r.numeric;
  return t;
}
