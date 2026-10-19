// modules › world › earth › presets › living › plants: trees grown from species (procedural branching: a trunk, branches by level,
// leaf cards whose gaps the sun shines through), a few variants each, as instances. Each real tree keeps its place,
// height and crown radius (urban tree data); its species by a seeded random from a mix you set. The whole tree near,
// a simple one farther, an impostor far away. The crown's transmissivity (how much sun its leaves let through) is
// the same number the heat model takes (treeCrown).
//   treeInstances(list, mix) → per species variant, the instance numbers and its levels
import { vary, INSTANCE_FLOATS } from '../../../../../../core/geometry/shapes/mesh.ts';
import { branching, type BranchSpec } from '../../../../../../core/geometry/shapes/recipes.ts';
import { impostor, type ImpostorLevel } from '../../../../../../core/geometry/shapes/levels.ts';
import { Rng, seedOf } from '../../../shared/plan.ts';
import { Solids, type SolidsProps } from '../../../../../../core/geometry/shapes/solids.ts';
import { Source } from '../../../../../../core/data/sources/source.ts';
import type { Feature } from '../../../../../../core/data/features.ts';
import type { AttachContext } from '../../../../../../core/world/element.ts';
import { D } from '../../../../../../core/space/geo.ts';
import { SPECIES, speciesOf } from './species.ts';

/** how trees look: the species drawn (each grown from its branching spec, a seeded mix by weight), how many variants
 *  of each, and the canopy. The mix is yours (by default one plain tree, so a street level draws something); a tree
 *  whose species is named (`species: d => …`) is grown from the library (SPECIES) when the mix has no such name */
export interface TreeLook {
  species: Record<string, { spec: BranchSpec; weight?: number }>;
  /** variants of each species (seeds; default 2) */
  variants?: number;
  /** the canopy: how much of the sun a tree's crown lets through (0..1), by tree and species (its grown leaves give
   *  `natural`); the crown is thinned to it (its shadow lighter) and the heat model reads the same number */
  canopy?: {
    transmit?: (t: TreeIn, species: string, natural: number) => number;
    /** the leaf area index instead (m² of leaves per m² of crown): transmissivity e^(−LAI / 2) */
    density?: (t: TreeIn, species: string, natural: number) => number;
  };
}
export const TREES: TreeLook = { species: { tree: { spec: SPECIES.tree.spec } } };
/** a grown tree's levels of detail for instances: [whole, simple, impostor], and what it is like */
export interface TreeShape { levels: readonly (Float32Array | ImpostorLevel | null)[]; height: number; crownRadius: number; crownBase: number; transmissivity: number }
const grownFor = new WeakMap<TreeLook, Map<string, TreeShape>>();
const grow = (spec: BranchSpec, seed: number): TreeShape => { const t = branching({ ...spec, seed }); return { levels: [t.levels[0], t.levels[1], impostor(t.levels[0], { views: 8 })], height: t.height, crownRadius: t.crownRadius, crownBase: t.crownBase, transmissivity: t.transmissivity }; };
/** a look's trees grown (on first use): per species and variant ('name:0'): whole near, simple farther, an impostor
 *  beyond */
export function treeShapes(look: TreeLook = TREES): Map<string, TreeShape> {
  let m = grownFor.get(look);
  if (!m) { m = new Map(); grownFor.set(look, m); for (const [name, sp] of Object.entries(look.species)) for (let v = 0; v < (look.variants ?? 2); v++) m.set(`${name}:${v}`, grow(sp.spec, 11 + v * 7)); }
  return m;
}
export interface TreeIn { x: number; z: number; height: number; /** its crown's radius, m (≤ 0: as grown for its height) */ radius: number; id: number; seed: number; /** its species: one of the look's by name, a spec of its own, or a seeded mix of the look's */ species?: string | BranchSpec }
/** the instances of trees: per species variant (x, z, height above the ground, id · scale · turn · tint), each tree
 *  scaled to its height and crown */
export function treeInstances(list: readonly TreeIn[], look: TreeLook = TREES): { shape: string; data: Float32Array; tree: TreeShape }[] {
  const shapes = treeShapes(look), by = new Map<string, number[]>();
  for (const t of list) {
    const rnd = new Rng(seedOf(t.seed, 31)), { s, key, tree } = choose(t, rnd, look);
    const h = Math.max(2, t.height), k = h / tree.height, kx = crownK(t, h, k, tree);
    const tint = vary('#ffffff', rnd.next(), 0.1), turn = rnd.next() * Math.PI * 2, thin = 1 - keptOf(look, t, s, tree.transmissivity);
    let arr = by.get(key); if (!arr) by.set(key, (arr = []));
    arr.push(t.x, t.z, 0, t.id, kx, k, kx, turn, tint, thin);
  }
  return [...by].map(([shape, v]) => ({ shape, data: Float32Array.from(v), tree: shapes.get(shape)! }));
}
/** a tree's crown in the heat model's terms (core › simulation › phenomena › heat): its top, the foot of its crown, its radius and
 *  the share of the sun it lets through, for a real tree of this height and crown (the grown tree it is drawn as) */
export function treeCrown(t: TreeIn, look: TreeLook = TREES): { top: number; base: number; radius: number; transmissivity: number } {
  const rnd = new Rng(seedOf(t.seed, 31)), { s, tree } = choose(t, rnd, look);
  const h = Math.max(2, t.height), k = h / tree.height, kx = crownK(t, h, k, tree);
  const want = wanted(look, t, s, tree.transmissivity) ?? tree.transmissivity;
  return { top: h, base: tree.crownBase * k, radius: tree.crownRadius * kx, transmissivity: Math.max(want, tree.transmissivity) };
}
/** how wide a tree's crown is drawn (its grown width × this): its crown radius over the grown one's at its height
 *  (within 0.6 … 1.6 of it), or as grown when it has none (radius ≤ 0) */
function crownK(t: TreeIn, h: number, k: number, tree: TreeShape): number {
  if (!(t.radius > 0)) return k;
  const rr = Math.max(1, Math.min(h * 0.6, t.radius));
  return Math.max(0.6, Math.min(1.6, rr / (tree.crownRadius * k))) * k;
}
/** the share of its leaves a tree keeps for the canopy asked (Beer–Lambert: transmissivity = natural ^ kept); a crown is
 *  only thinned, never thickened past its grown leaves */
function keptOf(look: TreeLook, t: TreeIn, s: string, natural: number): number {
  const want = wanted(look, t, s, natural);
  if (want === null || !(natural > 0 && natural < 1)) return 1;
  return Math.max(0, Math.min(1, Math.log(want) / Math.log(natural)));
}
/** the transmissivity the look asks for a tree (null: as grown) */
function wanted(look: TreeLook, t: TreeIn, s: string, natural: number): number | null {
  const c = look.canopy; if (!c) return null;
  const v = c.transmit ? c.transmit(t, s, natural) : c.density ? Math.exp(-c.density(t, s, natural) / 2) : null;
  return v === null ? null : Math.max(0.001, Math.min(1, v));
}
/** a tree's species and grown variant: given, or by the look's seeded mix; a species spec of your own is grown once */
function choose(t: TreeIn, rnd: Rng, look: TreeLook): { s: string; key: string; tree: TreeShape } {
  const shapes = treeShapes(look), weights: Record<string, number> = {};
  for (const [n, sp] of Object.entries(look.species)) weights[n] = sp.weight ?? 1;
  const mix = rnd.weighted(weights), variant = Math.floor(rnd.next() * (look.variants ?? 2));
  if (t.species && typeof t.species === 'object') {
    const key = `custom:${JSON.stringify(t.species)}`;
    let tree = shapes.get(key); if (!tree) { tree = grow(t.species, 11); shapes.set(key, tree); }
    return { s: 'custom', key, tree };
  }
  if (t.species && !look.species[t.species]) {
    // a name the mix has not: the library's (a library name or a botanical one), grown once a variant
    const lib = speciesOf(t.species) as keyof typeof SPECIES | null;
    if (lib) {
      const key = `library:${lib}:${variant}`;
      let tree = shapes.get(key); if (!tree) { tree = grow(SPECIES[lib].spec, 11 + variant * 7); shapes.set(key, tree); }
      return { s: lib, key, tree };
    }
  }
  const s = t.species && look.species[t.species] ? t.species : mix, key = `${s}:${variant}`;
  return { s, key, tree: shapes.get(key)! };
}
export { INSTANCE_FLOATS };

/** a layer of trees from data: points (each a tree: its height and crown from its props), or areas planted at a
 *  density (trees per hectare, scattered by a seed); each grown from its species (a name, or a branching spec of
 *  your own), streamed in 500 m chunks of a solids layer (whole near, simple farther, impostors far away)
 *    w.add(vegetation({ id: 'trees', data: data.geojson('/trees.geojson'), height: (d) => d.props.height_m }))
 *    w.add(vegetation({ id: 'park-trees', data: parks, density: () => 60, species: () => 'eucalypt' })) */
export interface VegetationProps extends SolidsProps {
  data: Source | Feature[];
  /** a tree's height, m (default props.height, else 8) */
  height?: (d: Feature) => number;
  /** its crown radius, m (default props.crown, else 0.4 × its height); null: the species' own for its height */
  crown?: (d: Feature) => number | null;
  /** a tree's species: a name of the look's or of the library (SPECIES; a botanical name by its genus), or a spec of
   *  its own (default, or a name neither knows: the look's seeded mix) */
  species?: (d: Feature) => string | BranchSpec;
  /** areas: trees per hectare inside each (default: areas are not planted) */
  density?: (d: Feature) => number;
  look?: Partial<TreeLook>;
}
const CHUNK = 500, KZ = 110574;
export class Vegetation extends Solids {
  private vp: VegetationProps; private src: Source | null = null; private seen = -1; private off: (() => void) | null = null;
  private infos = new Map<string, Map<number, { id: string | number; props: Record<string, unknown> }>>();
  constructor(p: VegetationProps) { super({ hover: false, ...p }); this.vp = p; }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    const d = this.vp.data;
    if (d instanceof Source) {
      this.src = d;
      this.off = d.watch(() => this.build());
      void d.start({ loader: ctx.loader, error: (e) => ctx.world.error(e) }).then(() => this.build());
    } else this.build();
  }
  override detach(): void { this.off?.(); this.off = null; super.detach(); }
  /** the trees: grouped into chunks, grown and placed */
  private build(): void {
    // features (props) or GeoJSON features (properties)
    const fs = (this.src ? this.src.features() : (this.vp.data as Feature[])).map((f) => ((f as Feature).props ? f : { ...f, props: (f as unknown as { properties?: Record<string, unknown> }).properties ?? {} }) as Feature);
    if (this.src && this.src.version === this.seen) return;
    this.seen = this.src?.version ?? 0;
    const look = { ...TREES, ...this.vp.look } as TreeLook;
    const trees: (TreeIn & { lon: number; lat: number; f: Feature })[] = [];
    const hOf = (f: Feature) => this.vp.height?.(f) ?? Number((f.props as Record<string, unknown>).height ?? 8);
    const rOf = (f: Feature, h: number) => { const c = this.vp.crown ? this.vp.crown(f) : Number((f.props as Record<string, unknown>).crown ?? h * 0.4); return c === null ? 0 : c; };
    let n = 0;
    for (const f of fs) {
      const g = f.geometry as { type: string; coordinates: unknown } | null; if (!g) continue;
      const sp = this.vp.species?.(f);
      if (g.type === 'Point') { const [lon, lat] = g.coordinates as [number, number], h = hOf(f); trees.push({ lon, lat, f, x: 0, z: 0, height: h, radius: rOf(f, h), id: n, seed: seedOf(lon * 1e5, lat * 1e5), species: sp }); n++; continue; }
      const per = this.vp.density?.(f) ?? 0; if (!(per > 0) || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
      const polys = (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as [number, number][][][];
      for (const poly of polys) {
        const ring = poly[0]!; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
        for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
        const kx = 111320 * Math.cos(((y0 + y1) / 2) * D), ha = ((x1 - x0) * kx * (y1 - y0) * KZ) / 1e4, rnd = new Rng(seedOf(x0 * 1e5, y0 * 1e5, n));
        for (let k = 0, want = Math.round(ha * per); k < want * 3 && trees.length < 200000; k++) {
          const lon = rnd.range(x0, x1), lat = rnd.range(y0, y1);
          let inside = false; for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xa, ya] = ring[a]!, [xb, yb] = ring[b]!; if ((ya > lat) !== (yb > lat) && lon < ((xb - xa) * (lat - ya)) / (yb - ya) + xa) inside = !inside; }
          if (!inside) continue;
          const h = hOf(f) * rnd.range(0.75, 1.15); trees.push({ lon, lat, f, x: 0, z: 0, height: h, radius: rOf(f, h), id: n, seed: seedOf(lon * 1e5, lat * 1e5), species: sp }); n++;
        }
      }
    }
    for (const k of this.keys()) this.drop(k);
    this.infos.clear();
    if (!trees.length) return;
    // chunks of 500 m in one metric frame from the first tree
    const origin: [number, number] = [trees[0]!.lon, trees[0]!.lat], kx = 111320 * Math.cos(origin[1] * D), by = new Map<string, typeof trees>();
    for (const t of trees) { const x = (t.lon - origin[0]) * kx, z = -(t.lat - origin[1]) * KZ, ix = Math.floor(x / CHUNK), iz = Math.floor(z / CHUNK), key = `${ix}_${iz}`; t.x = x - ix * CHUNK; t.z = z - iz * CHUNK; let a = by.get(key); if (!a) by.set(key, (a = [])); a.push(t); }
    for (const [key, list] of by) {
      const [ix, iz] = key.split('_').map(Number) as [number, number], info = new Map<number, { id: string | number; props: Record<string, unknown> }>();
      list.forEach((t, i) => { t.id = i; info.set(i, { id: t.f.id ?? `${key}:${i}`, props: { ...(t.f.props as Record<string, unknown>), 'height (m)': +t.height.toFixed(1) } }); });
      this.infos.set(key, info);
      this.put(key, { origin, at: [ix * CHUNK, iz * CHUNK], instances: treeInstances(list, look).map((x) => ({ shape: x.tree.levels, data: x.data, radius: x.tree.crownRadius * 0.8 })), info: (id) => { const x = info.get(id); return x ? { kind: 'tree', id: x.id, props: x.props } : null; } });
    }
  }
}
export const vegetation = (p: VegetationProps) => new Vegetation(p);
