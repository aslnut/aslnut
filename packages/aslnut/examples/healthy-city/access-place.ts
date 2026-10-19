// Park access for a whole place, made once (in a worker: access.worker.ts; on the main thread where workers cannot
// run): the walking graph (the baked footpaths, crossings and paths through parks), the place's parks (open space),
// their entrances (points of the graph within `entrance` metres of a park), one pass from every entrance at once (each
// point's walk to its nearest park), the walk bands (aslnut's isochrones, from that pass: no second one). Then each
// house as it comes, once: its straight-line distance to the nearest park edge, its walk, and its way to the park
// until it meets a way already drawn (every stretch once: the shortest-path tree). Nothing here is made again.
import { network, type LonLat, type Network, type Shortest } from '../../src/core/geometry/networks/index.ts';

export interface PlaceOptions {
  /** the walking graph: { origin: [lon, lat], lines: [kind, x, z, x, z …] } (metres east / south of the origin) */
  walk: string;
  /** the parks: GeoJSON polygons with a `group` */
  parks: string;
  /** the park groups that count (default parkland, sports, natural areas, corridors) */
  groups?: string[];
  /** metres from a park that make a graph point its entrance (default 30) */
  entrance?: number;
  /** metres searched for the nearest park edge (default 3000) */
  search?: number;
  /** the walk bands, metres (default [400, 800]); their grid and reach off the graph (default 20, 50) */
  bands?: number[]; cell?: number; reach?: number;
}
export interface PlaceInfo { nodes: number; pieces: number; parks: number; entrances: number; bands: { type: 'Feature'; id: string | number; properties: Record<string, unknown>; geometry: unknown }[]; ms: { graph: number; parks: number; entrances: number; pass: number; bands: number } }
/** per house (in the order given): the straight-line distance (Infinity: no park within the search) and the place on
 *  the park's edge; the walk (0 inside a park, Infinity: no way); its new way to the park: points (lon, lat, the walk
 *  left from there) from verts[offs[i] * 3] to verts[offs[i + 1] * 3] */
export interface HouseAnswers { straight: Float64Array; at: Float64Array; walk: Float64Array; verts: Float64Array; offs: Int32Array; ms: number }

const GROUPS = ['Parkland and garden', 'Organised recreation area', 'Natural and semi-natural area', 'Recreation corridor'];
const CELL = 100;
/** park edges in the graph's metres, on a grid of CELL metres (numeric keys) */
class Edges {
  private cells = new Map<number, number[]>();
  add(ax: number, az: number, bx: number, bz: number): void {
    for (let cx = Math.floor(Math.min(ax, bx) / CELL); cx <= Math.floor(Math.max(ax, bx) / CELL); cx++)
      for (let cz = Math.floor(Math.min(az, bz) / CELL); cz <= Math.floor(Math.max(az, bz) / CELL); cz++) {
        const k = (cx + 32768) * 65536 + (cz + 32768); let l = this.cells.get(k); if (!l) this.cells.set(k, (l = [])); l.push(ax, az, bx, bz);
      }
  }
  /** the nearest edge point within `limit` m: [distance, x, z] (distance Infinity: none) */
  nearest(x: number, z: number, limit: number): [number, number, number] {
    let best = Infinity, px = x, pz = z; const hx = Math.floor(x / CELL), hz = Math.floor(z / CELL);
    for (let ring = 0; ring * CELL <= limit + CELL; ring++) {
      for (let cx = hx - ring; cx <= hx + ring; cx++) for (let cz = hz - ring; cz <= hz + ring; cz++) {
        if (Math.max(Math.abs(cx - hx), Math.abs(cz - hz)) !== ring) continue;
        const l = this.cells.get((cx + 32768) * 65536 + (cz + 32768)); if (!l) continue;
        for (let i = 0; i < l.length; i += 4) {
          const ax = l[i]!, az = l[i + 1]!, dx = l[i + 2]! - ax, dz = l[i + 3]! - az, L2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), qx = ax + dx * t, qz = az + dz * t, d = Math.hypot(x - qx, z - qz);
          if (d < best) { best = d; px = qx; pz = qz; }
        }
      }
      if (best <= ring * CELL) break;
    }
    return best <= limit ? [best, px, pz] : [Infinity, x, z];
  }
}
type Ring = number[][];
const ringsOf = (g: { type: string; coordinates: unknown } | null): Ring[] => (!g ? [] : g.type === 'Polygon' ? (g.coordinates as Ring[]) : g.type === 'MultiPolygon' ? (g.coordinates as Ring[][]).flat() : []);

/** the place's park access: load it once, then ask for houses */
export function accessPlace(fetcher: (url: string) => Promise<unknown> = (u) => fetch(u).then((r) => { if (!r.ok) throw new Error(`${u}: ${r.status}`); return r.json(); })) {
  let net: Network<{ kind: string }> | null = null, edges: Edges | null = null, pass: Shortest | null = null, drawn = new Uint8Array(0), search = 3000;
  return {
    async load(o: PlaceOptions): Promise<PlaceInfo> {
      const now = () => performance.now(); let t = now(); const ms = { graph: 0, parks: 0, entrances: 0, pass: 0, bands: 0 };
      const [wj, pj] = await Promise.all([fetcher(o.walk), fetcher(o.parks)]) as [{ origin: [number, number]; lines: (string | number)[][] }, { features: { properties?: { group?: string }; geometry: { type: string; coordinates: unknown } | null }[] }];
      const kx = 111320 * Math.cos((wj.origin[1] * Math.PI) / 180), ll = (x: number, z: number): LonLat => [wj.origin[0] + x / kx, wj.origin[1] - z / 110574];
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
      const lines = wj.lines.map((l) => { const pts: LonLat[] = []; for (let i = 1; i + 1 < l.length; i += 2) { const p = ll(l[i] as number, l[i + 1] as number); pts.push(p); if (p[0] < w) w = p[0]; if (p[0] > e) e = p[0]; if (p[1] < s) s = p[1]; if (p[1] > n) n = p[1]; } return { line: pts, props: { kind: l[0] as string } }; });
      net = network({ lines, snap: 0.05 }); ms.graph = now() - t; t = now();
      // the parks round the place (its box and the search beyond it)
      search = o.search ?? 3000;
      const groups = new Set(o.groups ?? GROUPS), mx = search / kx, mz = search / 110574;
      edges = new Edges(); let parks = 0;
      for (const f of pj.features) {
        if (!groups.has(f.properties?.group ?? '')) continue;
        const rings = ringsOf(f.geometry); let inside = false;
        for (const r of rings) for (const p of r) if (p[0]! > w - mx && p[0]! < e + mx && p[1]! > s - mz && p[1]! < n + mz) { inside = true; break; }
        if (!inside) continue;
        parks++;
        for (const r of rings) for (let i = 0; i + 1 < r.length; i++) { const a = net.local([r[i]![0]!, r[i]![1]!]), b = net.local([r[i + 1]![0]!, r[i + 1]![1]!]); edges.add(a[0], a[1], b[0], b[1]); }
      }
      ms.parks = now() - t; t = now();
      // the entrances: graph points near a park, each starting at its distance from it
      const ent = o.entrance ?? 30, sources: { node: number; cost: number }[] = [];
      for (let i = 0; i < net.xs.length; i++) { const p = edges.nearest(net.xs[i]!, net.zs[i]!, ent); if (p[0] <= ent) sources.push({ node: i, cost: p[0] }); }
      ms.entrances = now() - t; t = now();
      pass = net.shortest(sources); drawn = new Uint8Array(net.xs.length); ms.pass = now() - t; t = now();
      const bands = net.isochrone(pass, o.bands ?? [400, 800], { cell: o.cell ?? 20, reach: o.reach ?? 50 }).map((f) => ({ type: 'Feature' as const, id: f.id, properties: f.props as Record<string, unknown>, geometry: f.geometry }));
      ms.bands = now() - t;
      return { nodes: net.size.nodes, pieces: net.size.pieces, parks, entrances: sources.length, bands, ms };
    },
    /** houses as lon, lat pairs: each one's answers (see HouseAnswers); its way is drawn once */
    houses(at: Float64Array): HouseAnswers {
      const t0 = performance.now(), k = at.length / 2;
      const straight = new Float64Array(k).fill(Infinity), sat = new Float64Array(k * 2), walk = new Float64Array(k).fill(Infinity), offs = new Int32Array(k + 1), verts: number[] = [];
      if (!net || !edges || !pass) return { straight, at: sat, walk, verts: new Float64Array(0), offs, ms: 0 };
      const dist = pass.dist, prev = pass.prev, xs = net.xs, zs = net.zs;
      for (let i = 0; i < k; i++) {
        const h: LonLat = [at[i * 2]!, at[i * 2 + 1]!], [x, z] = net.local(h), p = edges.nearest(x, z, search);
        straight[i] = p[0]; const q = net.lonLat(p[1], p[2]); sat[i * 2] = q[0]; sat[i * 2 + 1] = q[1];
        if (p[0] < 1) walk[i] = 0;
        else {
          // joined at its nearest point, on to the cheaper end, then back towards the park until a way already drawn
          const near = net.nearest(h);
          if (near) {
            const ca = dist[near.a]! + near.toA, cb = dist[near.b]! + near.toB, c = near.distance + Math.min(ca, cb);
            if (Number.isFinite(c)) {
              walk[i] = c;
              let u = ca <= cb ? near.a : near.b;
              verts.push(h[0], h[1], c, near.at[0], near.at[1], c - near.distance);
              for (let guard = 0; u >= 0 && guard < 100000; guard++) { const p2 = net.lonLat(xs[u]!, zs[u]!); verts.push(p2[0], p2[1], dist[u]!); if (drawn[u]) break; drawn[u] = 1; u = prev[u]!; }
            }
          }
        }
        offs[i + 1] = verts.length / 3;
      }
      return { straight, at: sat, walk, verts: Float64Array.from(verts), offs, ms: performance.now() - t0 };
    },
  };
}
