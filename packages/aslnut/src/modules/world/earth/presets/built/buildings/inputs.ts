// modules › world › earth › presets › built › buildings › inputs: what stands in a place, as the bake's stages 12–15
// read it, in the place's metres (x east, z south of its origin):
//   city tiles  the street level's 500 m tiles (tools/demo-data-city-tiles.mjs: building footprints with heights and
//               classes, real trees with height and crown, open space, water, streams, roads), from any origin
//   furniture   OpenStreetMap nodes (tools/roads/furniture.py): poles, lamps, benches, bins, bus stops, …
// Nothing is moved here; ids name the source row (city tile and index, or the OSM node).
import type { P2 } from '../../../shared/plan.ts';

export interface SourceBuilding { id: string; ring: P2[]; height: number; heightFrom: number; cls: string; seed: number }
export interface SourceTree { id: string; x: number; z: number; height: number; crown: number; seed: number }
export interface SourceFurniture { id: string; x: number; z: number; tags: Record<string, string> }
/** what the tiles carry besides (kept as they are, in the place's metres): roads for networks, open space, water */
export interface SourceGround { roads: { cls: number; width: number; name: string; uid: string; pts: P2[] }[]; parks: { name: string; group: string; area: number; ring: P2[] }[]; water: { name: string; type: string; area: number; ring: P2[] }[]; streams: { width: number; name: string; type: string; pts: P2[] }[] }
export interface BuiltInputs extends SourceGround { buildings: SourceBuilding[]; trees: SourceTree[]; furniture: SourceFurniture[]; sources: Record<string, unknown>; attribution: string }
interface CityTileRow { ix: number; iz: number; size: number; s?: string[]; roads: number[][]; buildings: number[][]; trees: number[]; parks: number[][]; water: number[][]; streams: number[][] }

const seedOf = (...xs: number[]) => { let h = 2166136261; for (const x of xs) { h = Math.imul(h ^ (x | 0), 16777619); h = Math.imul(h ^ ((x * 1000) | 0), 16777619); } return h >>> 0; };
const polyline = (f: readonly number[], start: number, at: (x: number, z: number) => P2): P2[] => { const out: P2[] = []; let x = f[start]!, z = f[start + 1]!; out.push(at(x / 10, z / 10)); for (let i = start + 2; i + 1 < f.length; i += 2) { x += f[i]!; z += f[i + 1]!; out.push(at(x / 10, z / 10)); } return out; };
const KX = (lat: number) => 111320 * Math.cos((lat * Math.PI) / 180), KZ = 110574;
/** a frame's metres → another's (through longitude and latitude) */
export const reframe = (from: [number, number], to: [number, number]) => { const kf = KX(from[1]), kt = KX(to[1]); return (x: number, z: number): P2 => [(from[0] + x / kf - to[0]) * kt, -(from[1] - z / KZ - to[1]) * KZ]; };

/** the city tiles (their index and the tiles over the box) in a place's frame: features whose middle lies in `bbox`
 *  [west, south, east, north] */
export function cityInputs(index: { origin: [number, number]; sources?: Record<string, unknown>; attribution?: string }, tiles: CityTileRow[], origin: [number, number], bbox: readonly number[]): Omit<BuiltInputs, 'furniture'> {
  const to = reframe(index.origin, origin), kf = KX(index.origin[1]);
  const inBox = (x: number, z: number) => { const lon = index.origin[0] + x / kf, lat = index.origin[1] - z / KZ; return lon >= bbox[0]! && lon <= bbox[2]! && lat >= bbox[1]! && lat <= bbox[3]!; };
  const out: Omit<BuiltInputs, 'furniture'> = { buildings: [], trees: [], roads: [], parks: [], water: [], streams: [], sources: index.sources ?? {}, attribution: index.attribution ?? '' };
  for (const t of [...tiles].sort((a, b) => a.ix - b.ix || a.iz - b.iz)) {
    const ox = t.ix * t.size, oz = t.iz * t.size, str = (i: number) => t.s?.[i] ?? '', at = (x: number, z: number) => to(ox + x, oz + z), mid = (r: readonly number[], s: number) => { const p = polyline(r, s, (x, z) => [ox + x, oz + z]); let x = 0, z = 0; for (const q of p) { x += q[0]; z += q[1]; } return [x / p.length, z / p.length] as P2; };
    t.buildings.forEach((b, k) => {
      const [mx, mz] = mid(b, 3); if (!inBox(mx, mz)) return;
      let ring = polyline(b, 3, at); if (ring.length > 1 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1]) ring = ring.slice(0, -1);
      if (ring.length >= 3) out.buildings.push({ id: `bld-${t.ix}-${t.iz}-${k}`, ring, height: b[0]! / 10, heightFrom: b[1]!, cls: str(b[2]!), seed: seedOf(t.ix, t.iz, k) });
    });
    for (let i = 0; i + 3 < t.trees.length; i += 4) { const x = ox + t.trees[i]! / 10, z = oz + t.trees[i + 1]! / 10; if (!inBox(x, z)) continue; const [px, pz] = to(x, z); out.trees.push({ id: `tree-${t.ix}-${t.iz}-${i / 4}`, x: px, z: pz, height: t.trees[i + 2]! / 10, crown: t.trees[i + 3]! / 10, seed: seedOf(t.ix, t.iz, i) }); }
    for (const r of t.roads) { const [mx, mz] = mid(r, 4); if (inBox(mx, mz)) out.roads.push({ cls: r[0]!, width: r[1]! / 10, name: str(r[2]!), uid: str(r[3]!), pts: polyline(r, 4, at) }); }
    for (const p of t.parks) { const [mx, mz] = mid(p, 3); if (inBox(mx, mz)) out.parks.push({ name: str(p[0]!), group: str(p[1]!), area: p[2]!, ring: polyline(p, 3, at) }); }
    for (const w of t.water) { const [mx, mz] = mid(w, 3); if (inBox(mx, mz)) out.water.push({ name: str(w[0]!), type: str(w[1]!), area: w[2]!, ring: polyline(w, 3, at) }); }
    for (const s of t.streams) { const [mx, mz] = mid(s, 3); if (inBox(mx, mz)) out.streams.push({ width: s[0]! / 10, name: str(s[1]!), type: str(s[2]!), pts: polyline(s, 3, at) }); }
  }
  return out;
}
/** furniture nodes (GeoJSON points with an id) in a place's frame */
export function furnitureInputs(features: readonly { id?: string | number; properties?: Record<string, string>; geometry?: { type: string; coordinates: number[] } }[], origin: [number, number]): SourceFurniture[] {
  const kx = KX(origin[1]);
  return features.filter((f) => f.geometry?.type === 'Point').map((f) => ({ id: String(f.id ?? ''), x: (f.geometry!.coordinates[0]! - origin[0]) * kx, z: -(f.geometry!.coordinates[1]! - origin[1]) * KZ, tags: f.properties ?? {} }));
}
