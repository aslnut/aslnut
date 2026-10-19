// modules › world › earth › presets › built › roads: roads({ data }): streets from any source of centre lines with
// OSM-style tags (highway, lanes, width, sidewalk, sidewalk:width, oneway). The ways are split where they share a
// node (or a place), each piece a section with its profile (core › geometry › networks › sections: tags, then the
// rules by class; your `section` has the last word), the junctions solved from their arms (platforms, kerb returns,
// verges round the corners, crossings, give-way lines), drawn on the ground in 500 m chunks; and a road network to
// route on (core › geometry › networks › analysis).
//   const r = roads({ id: 'osm-roads', data: data.geojson('/roads.geojson') }); w.add(r); r.network().route(a, b)
import { MeshBuilder, MESH_FLOATS } from '../../../../../../core/geometry/shapes/mesh.ts';
import { Solids, type SolidsProps } from '../../../../../../core/geometry/shapes/solids.ts';
import { Source } from '../../../../../../core/data/sources/source.ts';
import type { Feature } from '../../../../../../core/data/features.ts';
import type { AttachContext } from '../../../../../../core/world/element.ts';
import { solveJunctions, type Junction } from '../../../../../../core/geometry/networks/junctions.ts';
import { lengthOf, along, type Profile, type ProfileRules, type Section } from '../../../../../../core/geometry/networks/sections.ts';
import { network, type Network } from '../../../../../../core/geometry/networks/index.ts';
import type { RoadWay } from '../../../../../../core/geometry/networks/graph.ts';
import { roadGraph } from './graph.ts';
import { CLS, clsOf } from './profiles.ts';
import { profileFor, VIC_STREETS } from './street-profiles.ts';
import { junctionMesh, sectionMesh, STREETS_LOOK, type StreetsLook } from './index.ts';
import type { Leveled } from '../../../../../../core/observation/presence.ts';

export interface RoadsProps extends SolidsProps {
  /** centre lines (LineStrings) with their tags in props (OSM's: highway, lanes, width, sidewalk …; `nodes`: their
   *  node ids, else ways join where they share a place) */
  data: Source | Feature[];
  /** which lines are roads (default: an OSM road highway; not an area, a parking aisle or a driveway) */
  keep?: (d: Feature) => boolean;
  /** its class (0 freeway … 5 local, 6 track, 7 service; default from its highway tag) */
  cls?: (d: Feature) => number;
  /** your word on a section's profile (it has the one from its tags and the rules) */
  section?: (d: Feature, p: Profile) => Profile;
  /** the rules a profile is made by when tags say less (default Victoria's street types: VIC_STREETS) */
  rules?: ProfileRules;
  /** kerb return radii and which arms get crossings (default 15 m arterial … 7.5 m local; collectors and bigger) */
  junctions?: { radius?: (cls: number) => number; crossings?: (cls: number) => boolean };
  /** fit to the terrain: every vertex on its ground (default true); false: each piece at its middle's ground */
  solve?: boolean;
  look?: Partial<StreetsLook>;
}
const CHUNK = 500;
const isRoad = (t: Record<string, unknown>) => { const h = String(t.highway ?? '').replace(/_link$/, ''); return h in CLS && t.area !== 'yes' && t.service !== 'parking_aisle' && t.service !== 'driveway'; };

export class Roads extends Solids {
  // (it lies on the ground: a mark on the ground paints it)
  override readonly stands = false;
  /** its props as it runs (given by level: the values for the level now) */
  private get rp(): RoadsProps { return this.props as unknown as RoadsProps; }
  private src: Source | null = null; private seen = -1; private off: (() => void) | null = null;
  private secs: Section[] = []; private juncs: Junction[] = []; private net: Network<{ cls: number; name: string }> | null = null; private lines: { line: [number, number][]; props: { cls: number; name: string } }[] = [];
  constructor(p: RoadsProps) { super({ hover: { color: '#ffd166' }, ...p }); }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    const d = this.rp.data;
    if (d instanceof Source) { this.src = d; this.off = d.watch(() => this.build()); void d.start({ loader: ctx.loader, error: (e) => ctx.world.error(e) }).then(() => this.build()); }
    else this.build();
  }
  override detach(): void { this.off?.(); this.off = null; super.detach(); }
  /** the sections (in one metric frame round the first point: x east, z south) and the junctions solved */
  sections(): readonly Section[] { return this.secs; }
  junctions(): readonly Junction[] { return this.juncs; }
  /** the road network to route on (the sections' centre lines, as lon / lat) */
  network(): Network<{ cls: number; name: string }> { return (this.net ??= network({ lines: this.lines, snap: 1 })); }
  private build(): void {
    if (this.src && this.src.version === this.seen) return;
    this.seen = this.src?.version ?? 0;
    for (const k of this.keys()) this.drop(k);
    const fs = (this.src ? this.src.features() : (this.rp.data as Feature[])).map((f) => ((f as Feature).props ? f : { ...f, props: (f as unknown as { properties?: Record<string, unknown> }).properties ?? {} }) as Feature);
    // the ways: each line kept, its nodes (given, or one per place: ways meet where they share one)
    const byId = new Map<string | number, Feature>(), ids = new Map<string, number>(), ways: RoadWay[] = [];
    const nodeAt = (p: [number, number]) => { const k = `${Math.round(p[0] * 1e7)},${Math.round(p[1] * 1e7)}`; let n = ids.get(k); if (n === undefined) ids.set(k, (n = -1 - ids.size)); return n; };
    for (const f of fs) {
      const g = f.geometry as { type: string; coordinates: unknown } | null, t = f.props as Record<string, unknown>;
      if (!g || !(this.rp.keep ? this.rp.keep(f) : isRoad(t))) continue;
      for (const line of g.type === 'LineString' ? [g.coordinates as [number, number][]] : g.type === 'MultiLineString' ? (g.coordinates as [number, number][][]) : []) {
        if (line.length < 2) continue;
        const id = `${f.id ?? ways.length}:${ways.length}`, given = Array.isArray(t.nodes) && (t.nodes as unknown[]).length === line.length && g.type === 'LineString';
        byId.set(id, f);
        ways.push({ id, nodes: given ? (t.nodes as number[]) : line.map(nodeAt), pts: line, tags: Object.fromEntries(Object.entries(t).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)])) });
      }
    }
    this.secs = []; this.juncs = []; this.lines = []; this.net = null;
    if (!ways.length) return;
    const origin: [number, number] = [ways[0]!.pts[0]![0], ways[0]!.pts[0]![1]], graph = roadGraph(ways, origin), rules = this.rp.rules ?? VIC_STREETS;
    // the sections: each edge between nodes (tunnels under the ground: not drawn), its profile from its tags
    const featOf = new Map<Section, Feature>();
    for (const e of graph.edges.values()) {
      if (e.tunnel) continue;
      const f = byId.get(e.way)!, cls = this.rp.cls?.(f) ?? clsOf(e.tags);
      let profile = profileFor(cls, { tags: e.tags }, rules); if (this.rp.section) profile = this.rp.section(f, profile);
      const s: Section = { id: e.id, cls, name: e.tags.name ?? '', pts: e.pts, trim: [0, 0], ends: [null, null], profile };
      this.secs.push(s); featOf.set(s, f);
      this.lines.push({ line: e.pts.map(([x, z]) => graph.toLonLat(x, z)), props: { cls, name: s.name } });
    }
    this.juncs = solveJunctions(this.secs, this.rp.junctions ?? {});
    // drawn in 500 m chunks: a section by its middle, a junction by its centre (its platform drawn by one chunk)
    const look = { ...STREETS_LOOK, ...this.rp.look }, solve = this.rp.solve !== false;
    type Piece = { kind: 'section'; s: Section } | { kind: 'junction'; j: Junction };
    const by = new Map<string, Piece[]>(), keyOf = (x: number, z: number) => `${Math.floor(x / CHUNK)}_${Math.floor(z / CHUNK)}`;
    for (const s of this.secs) { const m = along(s.pts, lengthOf(s.pts) / 2), k = keyOf(m.x, m.z); let a = by.get(k); if (!a) by.set(k, (a = [])); a.push({ kind: 'section', s }); }
    for (const j of this.juncs) { const k = keyOf(j.at[0], j.at[1]); let a = by.get(k); if (!a) by.set(k, (a = [])); a.push({ kind: 'junction', j }); }
    for (const [key, list] of by) {
      const [ix, iz] = key.split('_').map(Number) as [number, number], ox = ix * CHUNK, oz = iz * CHUNK, far = new MeshBuilder(), infos: { id: string; props: Record<string, unknown> }[] = [];
      const mids: [number, number][] = [];
      list.forEach((pc, id) => {
        far.as(id);
        if (pc.kind === 'section') {
          const s = pc.s, f = featOf.get(s)!, p = s.profile; sectionMesh(far, s, look, true);
          infos[id] = { id: s.id, props: { name: s.name || (f.props as Record<string, unknown>).highway, highway: (f.props as Record<string, unknown>).highway, class: s.cls, 'carriageway (m)': +p.carriageway.toFixed(1), lanes: p.lanes, profile: p.from } };
          const m = along(s.pts, lengthOf(s.pts) / 2); mids[id] = [m.x - ox, m.z - oz];
        } else {
          junctionMesh(far, pc.j, look, true);
          infos[id] = { id: `junction ${pc.j.key}`, props: { name: 'junction', arms: pc.j.arms.length, crossings: pc.j.crossings.length } };
          mids[id] = [pc.j.at[0] - ox, pc.j.at[1] - oz];
        }
      });
      // the whole mesh (verges, markings, kerbs) made when the chunk comes near, let go when it is far again
      const whole = () => { const mb = new MeshBuilder(); list.forEach((pc, id) => { mb.as(id); if (pc.kind === 'section') sectionMesh(mb, pc.s, look); else junctionMesh(mb, pc.j, look); }); return local(mb.build(), true); };
      // into the chunk's own metres (its corner); each piece at its middle's ground when not fitted vertex by vertex
      const local = (m: Float32Array, own: boolean) => {
        for (let i = 0; i + MESH_FLOATS <= m.length; i += MESH_FLOATS) {
          m[i] = m[i]! - ox; m[i + 2] = m[i + 2]! - oz;
          const id = m[i + 7]! % 65536, mid = mids[id];
          if (!solve && own && mid) { m[i + 4] = mid[0]; m[i + 5] = mid[1]; } else { m[i + 4] = m[i + 4]! - ox; m[i + 5] = m[i + 5]! - oz; }
        }
        return m;
      };
      this.put(key, { origin, side: CHUNK, at: [ox, oz], mesh: whole, far: local(far.build(), true), info: (id) => { const x = infos[id]; return x ? { kind: 'road', id: x.id, props: x.props } : null; } });
    }
  }
}
/** streets from any source of centre lines with OSM-style tags: roads({ data }) */
export const roads = (p: Leveled<RoadsProps>) => new Roads(p as RoadsProps);
