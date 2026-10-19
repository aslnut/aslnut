// The tilesets this server knows: where their data comes from, how they are baked. Each is a MeshBaker over a data
// pack (never in git: the data folder, ASLNUT_DATA), plus the edits made since (replayed from an append-only log on start).
import { appendFileSync, existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MeshBaker, type MeshLayerInput, type Outline } from './mesh-tile.ts';

export const DATA = process.env.ASLNUT_DATA ?? join(import.meta.dirname, '../../data');
export const TILES = join(DATA, 'packs/tiles');

export interface SetDef {
  id: string; title: string; attribution: string;
  minZoom: number; maxZoom: number; bounds: [number, number, number, number]; center: [number, number, number];
  layers: () => MeshLayerInput[];
  /** what a full bake puts in the archive (default: every level over the bounds); deeper levels bake on request */
  archive?: { minZoom: number; maxZoom: number; bounds?: [number, number, number, number] }[];
}
const json = (p: string) => JSON.parse(readFileSync(join(DATA, p), 'utf8'));
const has = (p: string) => existsSync(join(DATA, p));

/** GeoJSON → outlines: every ring of a feature in one outline (even-odd), lines as open rings */
export function outlines(p: string, name: (props: Record<string, any>) => string, props: (props: Record<string, any>) => Record<string, unknown> = () => ({})): Outline[] {
  const d = json(p) as { features: { properties: Record<string, any>; geometry: { type: string; coordinates: any } | null }[] };
  const out: Outline[] = [];
  for (const f of d.features) {
    const g = f.geometry; if (!g) continue;
    const lines: number[][][] = g.type === 'Polygon' ? g.coordinates : g.type === 'MultiPolygon' ? g.coordinates.flat() : g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    if (!lines.length) continue;
    let a = 180, b = 90, c = -180, e = -90;
    const rings = lines.map((r) => { const flat: number[] = []; for (const [x, y] of r as [number, number][]) { flat.push(x, y); a = Math.min(a, x); c = Math.max(c, x); b = Math.min(b, y); e = Math.max(e, y); } return flat; });
    out.push({ name: name(f.properties ?? {}), bbox: [a, b, c, e], rings, props: props(f.properties ?? {}) });
  }
  return out;
}
const NE = 'Natural Earth', OSM = '© OpenStreetMap contributors';

/** OSM land polygons (osmdata.openstreetmap.de, split, EPSG:4326), cut to the regions a set covers */
const OSM_LAND = [{ id: 'aus-idn', file: 'osm/land/land-aus-idn.geojson' }];

export const DEFS: SetDef[] = [
  {
    // a ladder of sources under one set of layer names: each level from the source that is right for it
    id: 'world', title: 'the world: Natural Earth 1:110m → 1:50m → 1:10m, then OSM land (the coast) from z 9', attribution: NE,
    minZoom: 0, maxZoom: 14, bounds: [-180, -85.05, 180, 85.05], center: [115, -5, 2],
    archive: [{ minZoom: 0, maxZoom: 8 }, { minZoom: 9, maxZoom: 10, bounds: [94, -45, 156, 8] }],
    layers: () => {
      const far = json('packs/earth/basemap-far.json'), near = json('packs/earth/basemap-near.json'), keep = ['a3', 'color', 'continent'];
      const ne10 = (n: string, nm: (p: Record<string, any>) => string = (p) => p.NAME ?? p.name ?? '', pr: (p: Record<string, any>) => Record<string, unknown> = () => ({})) => outlines(`geo/raw/ne10m/ne_10m_${n}.geojson`, nm, pr);
      const L: MeshLayerInput[] = [
        { name: 'countries', features: far.countries, keep, maxZoom: 3, attribution: NE },
        { name: 'countries', features: near.countries, keep, minZoom: 4, maxZoom: 5, attribution: NE },
        { name: 'countries', features: ne10('admin_0_countries', (p) => p.NAME, (p) => ({ a3: p.ADM0_A3, color: p.MAPCOLOR7, continent: p.CONTINENT })), keep, minZoom: 6, maxZoom: 8, attribution: NE },
        { name: 'ice', features: far.ice, lines: false, keep: [], maxZoom: 3 },
        { name: 'ice', features: near.ice, lines: false, keep: [], minZoom: 4, maxZoom: 5 },
        { name: 'ice', features: ne10('glaciated_areas'), lines: false, keep: [], minZoom: 6, attribution: NE },
        { name: 'lakes', features: far.lakes, lines: false, keep: [], maxZoom: 3 },
        { name: 'lakes', features: near.lakes, lines: false, keep: [], minZoom: 4, maxZoom: 5 },
        { name: 'lakes', features: ne10('lakes'), lines: false, keep: [], minZoom: 6, attribution: NE },
        // up close: land is OSM's coastline (split in pieces: never stroked), borders are lines over it
        { name: 'borders', features: ne10('admin_0_boundary_lines_land', (p) => p.NAME ?? ''), open: true, fill: false, keep: [], minZoom: 9, attribution: NE },
      ];
      for (const r of OSM_LAND) if (has(r.file)) L.push({ name: 'countries', features: outlines(r.file, () => 'land'), lines: false, keep: [], minZoom: 9, attribution: OSM });
      return L;
    },
  },
  {
    id: 'vic-lga', title: 'Victoria: local government areas (Vicmap Admin)', attribution: 'Vicmap Admin © State of Victoria (CC BY 4.0)',
    minZoom: 4, maxZoom: 14, bounds: [140.9, -39.2, 150.0, -33.9], center: [144.6, -36.9, 6],
    // a feature's `h` (metres) extrudes it: edits set it live
    layers: () => [{ name: 'lga', features: json('packs/aus/vic-lga.json').layers, height: (o: Outline) => Number(o.props?.h ?? 0), keep: ['code', 'h', 'value'], attribution: 'Vicmap Admin © State of Victoria (CC BY 4.0)' }],
  },
  {
    id: 'vic-suburbs', title: 'Victoria: suburbs and localities (Vicmap Admin), each with its LGA', attribution: 'Vicmap Admin © State of Victoria (CC BY 4.0)',
    minZoom: 7, maxZoom: 14, bounds: [140.9, -39.2, 150.0, -33.9], center: [144.96, -37.81, 10], archive: [{ minZoom: 7, maxZoom: 12 }],
    layers: () => [{ name: 'suburb', features: readdirSync(join(DATA, 'packs/aus/vic-suburbs')).filter((f) => f.endsWith('.json')).flatMap((f) => json(`packs/aus/vic-suburbs/${f}`).layers as Outline[]), keep: ['lga'], attribution: 'Vicmap Admin © State of Victoria (CC BY 4.0)' }],
  },
  {
    id: 'idn-provinces', title: 'Indonesia: provinces (BIG)', attribution: 'BIG',
    minZoom: 2, maxZoom: 12, bounds: [94.9, -11.1, 141.1, 6.1], center: [118, -2.5, 4],
    layers: () => [{ name: 'provinces', features: json('geo/idn-provinces.json').layers, height: (o: Outline) => Number(o.props?.h ?? 0), keep: ['h', 'value'], attribution: 'BIG' }],
  },
];

export interface Edit { at: string; layer: string; gid: number; props?: Record<string, unknown>; rings?: number[][] }
/** `dirty`: the areas edited, each with the version it made (a tile baked before that version is stale there) */
export interface LiveSet { def: SetDef; baker: MeshBaker; version: number; edits: Edit[]; dirty: { box: [number, number, number, number]; v: number }[] }

const live = new Map<string, LiveSet>();
const editLog = (id: string) => join(TILES, `${id}.edits.jsonl`);

/** the set, loaded on first use, with its logged edits replayed */
export function set(id: string): LiveSet | null {
  let s = live.get(id);
  if (s) return s;
  const def = DEFS.find((d) => d.id === id); if (!def) return null;
  s = { def, baker: new MeshBaker(def.layers()), version: 0, edits: [], dirty: [] };
  if (existsSync(editLog(id))) for (const line of readFileSync(editLog(id), 'utf8').split('\n')) if (line.trim()) apply(s, JSON.parse(line) as Edit, false);
  live.set(id, s);
  return s;
}

/** change one feature (props merged, rings replaced): returns the area to rebake (lon / lat box) */
export function apply(s: LiveSet, e: Edit, log = true): [number, number, number, number] {
  const o = s.baker.feature(e.layer, e.gid); if (!o) throw new Error(`no feature ${e.gid} in ${e.layer}`);
  const next: Outline = { ...o, props: { ...o.props, ...e.props }, rings: e.rings ?? o.rings, bbox: e.rings ? boxOf(e.rings) : o.bbox };
  const box = s.baker.update(e.layer, e.gid, next);
  s.version++; s.edits.push(e); s.dirty.push({ box, v: s.version });
  if (log) appendFileSync(editLog(s.def.id), JSON.stringify(e) + '\n');
  return box;
}
function boxOf(rings: number[][]): [number, number, number, number] {
  let a = 180, b = 90, c = -180, d = -90;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) { a = Math.min(a, r[i]!); c = Math.max(c, r[i]!); b = Math.min(b, r[i + 1]!); d = Math.max(d, r[i + 1]!); }
  return [a, b, c, d];
}
