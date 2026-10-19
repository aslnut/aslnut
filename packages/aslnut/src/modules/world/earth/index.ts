// modules › world › earth: the Earth as a body, with provider factories for its ground. Every provider is a named
// factory with defaults you can override, your own data, or your own function; lists compose; everything takes `when`.
//   earth({ imagery: [imagery.esri()], terrain: [terrain.mapzen(), terrain.grid({ url, where, blend: 300 })],
//           exaggerate: s => (s.observation.level === 'world' || s.observation.level === 'country' ? 3 : 1.5), base: earthLite({ url: '/packs/earth-lite' }) })
//   earth({ terrain: [] })   // flat
import { SHOW_ONLY, type Terms } from '../../../core/data/rights.ts';
import { AslnutError } from '../../../core/world/errors.ts';
import { Element } from '../../../core/world/element.ts';
import type { Body } from '../../../core/world/world.ts';
import type { State } from '../../../core/world/state.ts';
import { valueOf, type Fn, type When } from '../../../core/observation/presence.ts';
import type { View } from '../../../core/observation/observers/orbit/views.ts';
import type { BBox } from '../../../core/space/geo.ts';
import { Sky, type SkyProps } from '../surface/sky.ts';
import { Surface, type SurfaceGrade, type SurfaceProps } from '../surface/surface.ts';
import { checkBBox, gridSampler, paint, rgbTerrain, tileHeights, xyzImagery, type Blend, type CommonOptions, type Ctx2D, type GridData, type Imagery, type SourceContext, type Terrain, type Tile } from '../surface/sources.ts';

// ── imagery ──────────────────────────────────────────────────────────────────────────────────────────────────────
const ESRI = {
  'world-imagery': { path: 'World_Imagery', max: 19, attribution: 'Imagery © Esri, Maxar, Earthstar Geographics' },
  topo: { path: 'World_Topo_Map', max: 19, attribution: '© Esri, HERE, Garmin, © OpenStreetMap contributors' },
  streets: { path: 'World_Street_Map', max: 19, attribution: '© Esri, HERE, Garmin, © OpenStreetMap contributors' },
  light: { path: 'Canvas/World_Light_Gray_Base', max: 16, attribution: '© Esri, HERE, Garmin, © OpenStreetMap contributors' },
  dark: { path: 'Canvas/World_Dark_Gray_Base', max: 16, attribution: '© Esri, HERE, Garmin, © OpenStreetMap contributors' },
} as const;
export interface ImageryOptions extends CommonOptions { opacity?: number; blend?: Blend; minZoom?: number; maxZoom?: number }
export const imagery = {
  /** Esri's basemaps (show only: their terms allow viewing, not keeping, prefetching or exporting) */
  esri(o: ImageryOptions & { layer?: keyof typeof ESRI; url?: string } = {}): Imagery {
    const l = ESRI[o.layer ?? 'world-imagery'];
    if (!l) throw new AslnutError('E-DATA-001', `unknown Esri layer '${o.layer}'`, { fix: `use ${Object.keys(ESRI).join(', ')}` });
    return xyzImagery({ id: `esri-${o.layer ?? 'world-imagery'}`, url: o.url ?? `https://server.arcgisonline.com/ArcGIS/rest/services/${l.path}/MapServer/tile/{z}/{y}/{x}`, maxZoom: l.max, attribution: l.attribution, ...o }, SHOW_ONLY);
  },
  /** OpenStreetMap's standard tiles (show only: the public tile server forbids bulk and offline use); pass your
   *  own tile server's `url` for heavier use */
  osm(o: ImageryOptions & { url?: string } = {}): Imagery {
    return xyzImagery({ id: 'osm', url: o.url ?? 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', maxZoom: 19, attribution: '© OpenStreetMap contributors', ...o }, o.url ? undefined : SHOW_ONLY);
  },
  /** Sentinel-2 cloudless by EOX (CC BY 4.0 for 2018 and later): cloud-free satellite imagery, free to keep */
  sentinel(o: ImageryOptions & { year?: 2018 | 2019 | 2020 | 2021 | 2022 | 2023 | 2024 } = {}): Imagery {
    const y = o.year ?? 2020;
    return xyzImagery({ id: `sentinel-${y}`, url: `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-${y}_3857/default/g/{z}/{y}/{x}.jpg`, maxZoom: 15, attribution: `Sentinel-2 cloudless ${y} by EOX IT Services GmbH (contains modified Copernicus Sentinel data ${y}), CC BY 4.0`, ...o });
  },
  /** yours: an XYZ `url`, or a `draw(g, tile, ctx)` function painting a 256 px tile */
  custom(o: ImageryOptions & ({ url: string; subdomains?: string[] } | { draw: (g: Ctx2D, tile: Tile, ctx: SourceContext) => boolean | Promise<boolean> })): Imagery {
    if ('url' in o && o.url) return xyzImagery({ id: o.id ?? 'custom', ...o });
    const draw = (o as { draw?: unknown }).draw;
    if (typeof draw !== 'function') throw new AslnutError('E-DATA-001', 'imagery.custom needs a url or a draw function', { where: o.id ?? 'imagery.custom', fix: "imagery.custom({ url: 'https://…/{z}/{x}/{y}.png' }) or imagery.custom({ draw: (g, tile) => { …; return true } })" });
    const img: Imagery = {
      kind: 'imagery', id: o.id ?? 'custom', attribution: o.attribution ?? '', terms: { show: true, prefetch: true, keep: true, export: true, ...o.terms },
      when: o.when, where: checkBBox(o.where, o.id ?? 'imagery.custom'), minZoom: o.minZoom ?? 0, maxZoom: o.maxZoom ?? 22, opacity: o.opacity ?? 1, blend: o.blend ?? 'normal', version: 0,
      draw: (g, t, ctx) => paint(g, img, t, () => (draw as (g: Ctx2D, t: Tile, c: SourceContext) => boolean | Promise<boolean>)(g, t, ctx)),
    };
    return img;
  },
};

// ── terrain ──────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TerrainOptions extends CommonOptions { blend?: number }
export const terrain = {
  /** the Terrarium terrain tiles by Mapzen on AWS Open Data: global, land and seafloor, open to keep */
  mapzen(o: TerrainOptions & { maxZoom?: number; url?: string; /** levels coarser than the imagery tile (default 2) */ coarser?: number } = {}): Terrain {
    return rgbTerrain({ id: 'mapzen', url: o.url ?? 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png', encoding: 'terrarium', maxZoom: o.maxZoom ?? 15, attribution: 'Terrain: Mapzen terrain tiles (AWS Open Data; SRTM, GMTED2010, ETOPO1, GEBCO and others)', ...o });
  },
  /** your own height grid for one area: `url` (a .json description + a .f32 grid, row 0 north) or `data` in memory.
   *  Wins over what is under it inside `where` (default: the grid's own box), blended over `blend` metres */
  grid(o: TerrainOptions & ({ url: string } | { data: GridData })): Terrain {
    const id = o.id ?? ('url' in o ? `grid:${o.url}` : 'grid');
    let sampler: ReturnType<typeof gridSampler> | null = null, loading: Promise<ReturnType<typeof gridSampler> | null> | null = null;
    if ('data' in o) sampler = gridSampler(o.data, id);
    else if (typeof (o as { url?: unknown }).url !== 'string') throw new AslnutError('E-DATA-001', 'terrain.grid needs a url or data', { where: id, fix: "terrain.grid({ url: '/dem/bandung-30m' })" });
    const get = async (ctx: SourceContext) => {
      if (sampler) return sampler;
      loading ??= (async () => {
        const base = (o as { url: string }).url.replace(/\.(json|f32)$/, '');
        const meta = await ctx.loader.get<Record<string, unknown>>(`${base}.json`, { kind: 'json', priority: 'now', prefetch: ctx.prefetch });
        const bytes = await ctx.loader.get<ArrayBuffer>(`${base}.f32`, { kind: 'bytes', priority: 'now', prefetch: ctx.prefetch });
        if (!meta || !bytes) throw new AslnutError('E-DATA-001', `no grid at ${base}.json / .f32`, { where: id, fix: 'check the url (without the extension)' });
        const cols = Number(meta.cols ?? meta.width), rows = Number(meta.rows ?? meta.height);
        const origin = meta.origin as { lon: number; lat: number } | undefined;
        const g: GridData = { cols, rows, heights: new Float32Array(bytes), nodata: meta.nodata as number | undefined,
          ...(origin && meta.west_e !== undefined ? { local: { lon0: origin.lon, lat0: origin.lat, west: Number(meta.west_e), north: Number(meta.north_n), cell: Number(meta.cell) } } : { bbox: meta.bbox as BBox }) };
        sampler = gridSampler(g, id);
        if (!t.where) t.where = sampler.box;
        return sampler;
      })();
      loading.catch(() => { loading = null; });
      return loading;
    };
    const t: Terrain = {
      kind: 'terrain', id, attribution: o.attribution ?? '', terms: { show: true, prefetch: true, keep: true, export: true, ...o.terms }, when: o.when,
      where: checkBBox(o.where, id) ?? sampler?.box, maxZoom: 22, blend: o.blend ?? 50, version: 0,
      async heights(tile, n, ctx) {
        const sm = await get(ctx);
        if (!sm) return null;
        const h = tileHeights(tile, n, sm.at);
        return h.some((v) => !Number.isNaN(v)) ? h : null;
      },
      urlFor: 'url' in o ? () => `${(o as { url: string }).url.replace(/\.(json|f32)$/, '')}.f32` : undefined,
    };
    return t;
  },
  /** yours: heights(tile, n) gives n × n metres for a tile (row 0 north), or null where you have nothing */
  custom(o: TerrainOptions & { heights: (tile: Tile, n: number, ctx: SourceContext) => Float32Array | null | Promise<Float32Array | null>; maxZoom?: number }): Terrain {
    if (typeof o.heights !== 'function') throw new AslnutError('E-DATA-001', 'terrain.custom needs heights(tile, n)', { where: o.id ?? 'terrain.custom', fix: 'terrain.custom({ heights: (tile, n) => new Float32Array(n * n) })' });
    return {
      kind: 'terrain', id: o.id ?? 'custom-terrain', attribution: o.attribution ?? '', terms: { show: true, prefetch: true, keep: true, export: true, ...o.terms }, when: o.when,
      where: checkBBox(o.where, o.id ?? 'terrain.custom'), maxZoom: o.maxZoom ?? 22, blend: o.blend ?? 0, version: 0,
      async heights(tile, n, ctx) {
        const h = await o.heights(tile, n, ctx);
        if (h && h.length !== n * n) throw new AslnutError('E-DATA-001', `terrain '${o.id ?? 'custom'}' gave ${h.length} heights for ${n} × ${n}`, { where: o.id, fix: 'return a Float32Array of n * n' });
        return h;
      },
    };
  },
};

/** an offline basemap you host (never in npm): XYZ tiles at `url` (`{z}/{x}/{y}.jpg` by default), up to `maxZoom`.
 *  Always painted first, so the globe is never empty, even with no network */
export function earthLite(o: { url: string; maxZoom?: number; format?: 'jpg' | 'png' | 'webp'; attribution?: string; terms?: Partial<Terms> }): Imagery {
  if (typeof o?.url !== 'string') throw new AslnutError('E-DATA-001', 'earthLite needs the url where you host it', { fix: "earthLite({ url: '/packs/earth-lite' })" });
  const url = /\{z\}/.test(o.url) ? o.url : `${o.url.replace(/\/$/, '')}/{z}/{x}/{y}.${o.format ?? 'jpg'}`;
  return xyzImagery({ id: 'earth-lite', url, maxZoom: o.maxZoom ?? 5, attribution: o.attribution ?? 'earth-lite basemap', terms: o.terms });
}

export interface EarthOptions {
  /** painted in order (later on top); default [imagery.esri()] */
  imagery?: Imagery[];
  /** later wins where it covers; default [terrain.mapzen()]; [] = flat */
  terrain?: Terrain[];
  /** heights × this (a number, or a function of the view: s => …) */
  exaggerate?: Fn<number>;
  /** an offline basemap always under the imagery */
  base?: Imagery | null;
  /** the space and the glow round the globe, and the sky over the flat map (false: none); a sky layer of your own:
   *  the physical sky with the real sun and moon that lights the world, `sky()` of modules › earth › air › sky */
  sky?: boolean | SkyProps | Element;
  surface?: Omit<SurfaceProps, 'imagery' | 'terrain' | 'base' | 'exaggerate'> & { grade?: Partial<SurfaceGrade> };
  view?: View;
  /** the surface layer's `when` (rarely needed) */
  when?: When;
}
export function earth(o: EarthOptions = {}): Body {
  const im = o.imagery ?? [imagery.esri()], te = o.terrain ?? [terrain.mapzen()];
  for (const [k, list] of [['imagery', im], ['terrain', te]] as const) {
    if (!Array.isArray(list)) throw new AslnutError('E-DATA-001', `earth({ ${k} }) takes a list`, { fix: k === 'terrain' ? 'terrain: [terrain.mapzen()] (or [] for flat)' : 'imagery: [imagery.esri()]' });
    for (const s of list) if (!s || (s as { kind?: string }).kind !== (k === 'imagery' ? 'imagery' : 'terrain')) throw new AslnutError('E-DATA-001', `earth({ ${k} }) has something that is not ${k === 'imagery' ? 'an imagery' : 'a terrain'} source`, { fix: k === 'imagery' ? 'use imagery.esri(), imagery.osm(), imagery.sentinel(), imagery.custom(…)' : 'use terrain.mapzen(), terrain.grid(…), terrain.custom(…)' });
  }
  const ex = o.exaggerate ?? 1;
  return {
    kind: 'earth', flat: false, view: o.view ?? { lon: 110, lat: 0, zoom: 1.6 },
    exaggeration: (s: State) => (te.length ? valueOf(ex, s) : 1),
    elements: () => [
      ...(o.sky === false ? [] : [o.sky instanceof Element ? o.sky : new Sky(typeof o.sky === 'object' ? o.sky : {})]),
      new Surface({ ...o.surface, imagery: im, terrain: te, base: o.base ?? null, exaggerate: ex, when: o.when }),
    ],
  };
}
