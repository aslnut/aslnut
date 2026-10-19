import { presetOf } from '../preset.ts';
// layers: a GIS map in the world. A light basemap on the terrain, and over it layers from public map and feature
// services: pictures from a WMS (planning zones, bushfire prone areas) and features from a WFS of every kind of shape
// (suburbs with their names: polygons; sites such as reserves, schools and hospitals: multipolygons; councils: their
// boundaries and names; creeks: lines; pipelines: multilines; places: multipoints; dams: points), all of them in one
// stack. Each layer is a statement (core › encoding › layers): its data loaded ONCE over the area the app gives, its
// signs inside it (the suburbs and their names are one layer), and no gate: zoom, tilt and spin only move the picture
// (no zoom ranges, no reload, a suburb's colour from its own area, the same at every zoom). The layer list (kits ›
// dashboard › layers) shows and hides them, fades them, drags them up and down the stack (one frame each), shows their
// legends (a WMS's own legend picture), and adds a layer from any WMS or WFS URL (its capabilities listed, one picked).
// A tap tells what is there (the feature's attributes, and what each shown WMS layer's service says). &twin=1: the
// same layers with the twin's buildings and trees (healthy-city/clayton.ts), each sitting where it should with them
// (drape: on the ground, over the roofs and crowns, or floating above); the twin's own parts follow its observation
// level (street and closer), the layers stay as they are (one stack, one level).
//   ?go=map | top | tilt | street | region | groups    the views (short links for phones); groups: the places counted per
//   suburb, a card each, at the coarse levels (city, district: core › space › regions › rollup, by the observation
//   levels' gates), each place at the street and closer (the world then has levels: the default ladder)
//   &twin=1      with the twin's buildings, trees, roads and water        &graphics=auto | webgpu | webgl2   &dpr=2
//   &quality=lite | realistic   &ground=tiles | prisms   &n=0..10   how many data layers (the measurements: 3, 6, 8)
//   &base=light | osm | imagery   the base map (the list switches it)   &clouds=1   the sky's clouds and their shadows
//   (a map has none; the twin has them)   &areas=ground | over   the filled layers' place   &parity=1   no network: a procedural ground and the tools' own
//   map and feature service (tools/ows-mock.mjs)   &list=0   &clock=30   &shadows=0   &only=suburbs,creeks   &drape=creeks:over
import { AslnutError, GraphicsUnavailable, area, cards, data, earth, geo, groups, imagery, layer, layers, line, points, raster, scale, sky, supported, terrain, world, zonedTime,
  type DrapeMode, type Feature, type Element, type LayerPart, type Picked, type View, type World } from '../../src/index.ts';
import { CLAYTON, clayton, streetGround, tileLane } from '../healthy-city/clayton.ts';

declare const __BUILD__: number;
const BUILD = typeof __BUILD__ === 'number' ? __BUILD__ : 0;
const q = new URLSearchParams(location.search);
const $ = (s: string) => document.querySelector(s) as HTMLElement;
const TWIN = q.get('twin') === '1', PARITY = q.get('parity') === '1';
const want = (q.get('graphics') ?? 'auto') as 'auto' | 'webgpu' | 'webgl2';
const N = Math.max(0, Math.min(10, Number(q.get('n') ?? 10)));
const AREAS = q.get('areas') as DrapeMode | null;
/** the services: the State of Victoria's open data (both allow other sites to read them: no proxy), or the tools' own */
const OWS = PARITY ? '/aslnut/mock/ows' : 'https://opendata.maps.vic.gov.au/geoserver';
const WMS = `${OWS}/wms`, WFS = `${OWS}/wfs`, NS = 'open-data-platform';
const VIC = '© State of Victoria (DEECA: Vicmap, Planning), CC BY 4.0';

// ── the views ─────────────────────────────────────────────────────────────────────────────────────────────────────
const VIEWS: Record<string, { title: string; view: View }> = {
  map: { title: 'map', view: { lon: 145.1215, lat: -37.9225, zoom: 14.9, tilt: 25, bearing: 0 } },
  top: { title: 'from above', view: { lon: 145.1215, lat: -37.9235, zoom: 17.2, tilt: 0, bearing: 0 } },
  tilt: { title: 'tilted', view: { lon: 145.1215, lat: -37.9225, zoom: 16.4, tilt: 60, bearing: 330 } },
  street: { title: 'close', view: { ...CLAYTON, zoom: 17.3, tilt: 62 } },
  region: { title: 'the area', view: { lon: 145.125, lat: -37.925, zoom: 12.8, tilt: 20, bearing: 0 } },
  groups: { title: 'groups', view: { lon: 145.12, lat: -37.925, zoom: 12.9, tilt: 20, bearing: 0 } },
};
const go = presetOf(q, Object.keys(VIEWS), 'map');
/** the places counted per suburb at the coarse levels (go=groups, or &groups=1 with any view) */
const GROUPS = go === 'groups' || q.get('groups') === '1';

// ── the ground: Esri's light grey basemap on the terrain (the twin's terrain under its roads with &twin=1) ──────────
const relief = { when: (s: { user: { toggles: Record<string, boolean> } }) => s.user.toggles.relief !== false };
const procedural = () => imagery.custom({ id: 'procedural', attribution: 'procedural', draw: (g, t) => { const b = geo.tileBBox(t.z, t.x, t.y); const v = Math.round(200 + 18 * Math.sin((b[0] + b[2]) * 9) * Math.cos((b[1] + b[3]) * 7)); g.fillStyle = `rgb(${v},${v},${v - 4})`; g.fillRect(0, 0, 256, 256); return true; } });
// (the twin's one lane: its ground under the roads, its roads and its street tiles made there)
const LANE = TWIN && q.get('workers') !== '0' ? tileLane() : undefined;
const clampOf = () => { const t = streetGround(LANE); return { ...t, when: relief.when } as typeof t; };
// the base map: one of three (the list's choice), each painted only while chosen (its `when`)
const BASES = { light: 'Esri light grey', osm: 'OpenStreetMap', imagery: 'Esri imagery' } as const;
type Base = keyof typeof BASES;
const BASE0: Base = (q.get('base') as Base) in BASES ? q.get('base') as Base : 'light';
const baseOn = (k: Base) => (s: { user: { toggles: Record<string, boolean> } }) => ((s.user.toggles[`base-${k}`] ?? k === BASE0) ? 1 : 0);
// (Esri's light grey has no tiles past level 16: closer, its level-16 tiles are drawn larger (render detail: the
// coarse version, never a hole, never a look that changes with the zoom); the plain grey under it while tiles load)
const plainLight = () => imagery.custom({ id: 'light-plain', attribution: '', when: baseOn('light'), draw: (g) => { g.fillStyle = '#e2e2e2'; g.fillRect(0, 0, 256, 256); return true; } });
const bases = () => (PARITY ? [procedural()] : [plainLight(), imagery.esri({ layer: 'light', when: baseOn('light') }), imagery.osm({ when: baseOn('osm') }), imagery.esri({ when: baseOn('imagery') })]);
// a map shows no weather: no clouds, no cloud shadows on the ground (the twin keeps its sky's own; &clouds= either way)
const CLOUDS = q.get('clouds') ? q.get('clouds') === '1' : TWIN;
const theSky = () => (CLOUDS ? sky() : sky({ clouds: false }));
const body = () => TWIN
  ? earth({ sky: theSky(), imagery: bases(), terrain: PARITY ? [clampOf()] : [terrain.mapzen(relief), clampOf()], base: null, surface: { shade: 0.75 } })
  : earth({ sky: theSky(), imagery: bases(), terrain: PARITY ? [clampOf()] : [terrain.mapzen(relief)], base: null });

// ── the data layers, bottom of the stack first ──────────────────────────────────────────────────────────────────────
const title = (s: unknown) => String(s ?? '').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
/** a polygon's area, km² (rings in degrees, near enough for a legend) */
const km2 = (d: Feature) => {
  const g = d.geometry; if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) return null;
  let a = 0;
  for (const poly of g.type === 'Polygon' ? [g.coordinates] : g.coordinates) poly.forEach((r, k) => {
    let s = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) s += (r[j]![0] - r[i]![0]) * (r[j]![1] + r[i]![1]);
    a += (k ? -1 : 1) * Math.abs(s / 2);
  });
  return a * 111.32 * 110.574 * Math.cos((-37.92 * Math.PI) / 180);
};
/** the areas each layer is loaded over, once (Clayton and around it; the close one for the dense layers) */
const AREA: geo.BBox = [145.03, -37.99, 145.22, -37.86], NEAR: geo.BBox = [145.07, -37.96, 145.18, -37.89], CLOSE: geo.BBox = [145.095, -37.945, 145.15, -37.9];
const wfs = (name: string, extent: geo.BBox) => data.wfs(WFS, { typeName: `${NS}:${name}`, extent, attribution: VIC });
/** the suburbs, loaded once: their layer, and the groups the places are counted in */
const suburbsData = wfs('vmlite_locality_polygon', AREA);
const wms = (name: string) => raster.wms(WMS, { layers: `${NS}:${name}`, single: true, attribution: VIC });
const PLACE_KINDS = ['education centre', 'hospital', 'care facility', 'community venue', 'emergency facility', 'recreational resource', 'place of worship'];
const SITES = ['reserve', 'sport facility', 'education centre', 'hospital', 'commercial facility'];
/** a name's look: dark text in a light halo, the same for every layer's names */
const NAME = { color: '#1f2937', halo: { width: 3, color: '#ffffffe6' } } as const;
function dataLayers(): Element[] {
  const areaPlace = AREAS ? { drape: AREAS } : {};
  // (the simplified Vicmap layers where there is one: a phone asks for kilobytes, not megabytes)
  const all: Record<string, Element> = {
    zones: raster({ id: 'zones', label: 'Planning zones · WMS', source: wms('plan_zone'), opacity: 0.45, ...areaPlace }) as unknown as Element,
    bushfire: raster({ id: 'bushfire', label: 'Bushfire prone areas · WMS', source: wms('bushfire_prone_area'), opacity: 0.6, ...areaPlace }) as unknown as Element,
    // suburbs (polygons, some with holes) coloured by their own area, with their names: one statement (the bigger
    // suburbs' names first); the classes from every suburb loaded, the same at every zoom
    suburbs: layer({ id: 'suburbs', label: 'Suburbs by area · WFS', data: suburbsData, ...areaPlace,
      area: { color: scale.quantile(km2 as never, { n: 5, range: 'ylgnbu' }), opacity: 0.35, outline: { color: '#ffffff', width: 1 } },
      labels: { text: (d: Feature) => title(d.props.locality_name), priority: (d: Feature) => km2(d) ?? 0, size: 13, ...NAME },
      tooltip: (d: Feature) => `${title(d.props.locality_name)}\n${(km2(d) ?? 0).toFixed(1)} km²`, hover: { color: '#ffffff', mix: 0.3 } }) as unknown as Element,
    // sites (multipolygons: a site in several pieces) by kind
    sites: area({ id: 'sites', label: 'Sites: reserves, schools, hospitals · WFS', data: wfs('foi_polygon', CLOSE), opacity: 0.5, outline: { color: '#334155', width: 0.8 }, ...areaPlace,
      color: scale.category((d: Feature) => (SITES.includes(String(d.props.feature_type)) ? String(d.props.feature_type) : 'other'), { domain: [...SITES, 'other'], range: ['#4ade80', '#22c55e', '#f59e0b', '#ef4444', '#a78bfa', '#94a3b8'] } as never),
      tooltip: (d) => `${d.props.name_label ?? title(d.props.name ?? d.props.feature_subtype)}\n${d.props.feature_subtype ?? d.props.feature_type ?? ''}` }) as unknown as Element,
    // councils: their boundaries (lines round the polygons) and their names, one statement
    councils: layer({ id: 'councils', label: 'Councils · WFS', data: wfs('vmlite_lga', AREA),
      line: { width: 3, color: '#7c3aed' },
      labels: { text: (d: Feature) => title(d.props.lga_name), priority: (d: Feature) => km2(d) ?? 0, size: 15, color: '#4c1d95', halo: NAME.halo },
      tooltip: (d: Feature) => title(d.props.lga_name) }) as unknown as Element,
    // creeks (lines) and pipelines (multilines, dashed)
    creeks: line({ id: 'creeks', label: 'Creeks and drains · WFS', data: wfs('hy_watercourse', NEAR), width: 2.2, color: '#2563eb', tooltip: (d) => title(d.props.name ?? 'watercourse') }) as unknown as Element,
    pipelines: line({ id: 'pipelines', label: 'Pipelines · WFS', data: wfs('foi_line', AREA), width: 2.4, color: '#ea580c', dashes: [10, 6], tooltip: (d) => `${title(d.props.name)}\n${d.props.feature_subtype ?? ''}` }) as unknown as Element,
    // places (multipoints: a place with several sites) by kind, and dams (points)
    places: points({ id: 'places', label: 'Places · WFS', data: wfs('foi_point', CLOSE), size: 9, outline: { color: '#ffffff', width: 1.5 },
      color: scale.category((d: Feature) => (PLACE_KINDS.includes(String(d.props.feature_type)) ? String(d.props.feature_type) : 'other'), { domain: [...PLACE_KINDS, 'other'], range: ['#f97316', '#ef4444', '#ec4899', '#8b5cf6', '#dc2626', '#16a34a', '#0ea5e9', '#94a3b8'] } as never),
      tooltip: (d) => `${d.props.name_label ?? title(d.props.name)}\n${d.props.feature_subtype ?? d.props.feature_type ?? ''}` }) as unknown as Element,
    dams: points({ id: 'dams', label: 'Dams and water points · WFS', data: wfs('hy_water_point', AREA), size: 11, color: '#0284c7', outline: { color: '#ffffff', width: 2 }, tooltip: (d) => title(d.props.name ?? d.props.feature_type_code) }) as unknown as Element,
  };
  // &n: how many (the measurements): 3 · 6 · 8 · 9 (all)
  const pick = N === 0 ? [] : N <= 3 ? ['zones', 'suburbs', 'places'] : N <= 6 ? ['zones', 'suburbs', 'councils', 'creeks', 'places', 'dams']
    : N <= 8 ? ['zones', 'suburbs', 'sites', 'councils', 'creeks', 'places', 'dams', 'pipelines'] : ['zones', 'bushfire', 'suburbs', 'sites', 'councils', 'creeks', 'pipelines', 'places', 'dams'];
  return pick.map((k) => all[k]!);
}

// ── tap: what is there (identify) ───────────────────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
function showInfo(head: string, rows: { title: string; props: Record<string, unknown> }[]): void {
  const el = $('#identify');
  if (!rows.length) { el.style.display = 'none'; return; }
  el.innerHTML = `<header><b>${esc(head)}</b><button aria-label="close" data-close>✕</button></header>${rows.map((r) => `<section><h4>${esc(r.title)}</h4><table>${Object.entries(r.props)
    .filter(([, v]) => v !== null && v !== undefined && v !== '' && typeof v !== 'object').slice(0, 24)
    .map(([k, v]) => `<tr><th>${esc(k.replace(/_/g, ' '))}</th><td>${esc(String(v))}</td></tr>`).join('')}</table></section>`).join('')}`;
  el.style.display = 'block';
}

async function main(): Promise<void> {
  const canvas = $('#view') as HTMLCanvasElement;
  const sup = await supported();
  let w: World;
  try {
    w = await world(canvas, {
      body: body(), view: VIEWS[go]!.view, graphics: want,
      // (the groups: shown by the observation level, the default ladder)
      ...(GROUPS ? { observation: { levels: 'default' as const } } : {}),
      quality: (q.get('quality') as 'lite' | 'realistic' | null) ?? 'auto',
      groundMarks: q.get('ground') === 'tiles' ? 'tiles' : q.get('ground') === 'prisms' ? 'prisms' : undefined,
      clock: q.get('clock') === 'manual' ? 'manual' : q.get('clock') ? { fps: Number(q.get('clock')) } : 'real',
      time: q.get('t') === 'now' ? 'now' : zonedTime(q.get('t') ?? '2026-01-15T14:00', 'Australia/Melbourne'), timeZone: 'auto',
      render: { shadows: q.get('shadows') !== '0' }, pixelRatio: q.get('dpr') ? Number(q.get('dpr')) : undefined,
      attribution: { format: (c) => `${c.slice(0, 3).join(' · ')} · build ${BUILD} · ${w?.api === 'webgpu' ? 'WebGPU' : 'WebGL2'}` },
      onError: (e) => { const el = $('#err'); el.style.display = 'block'; el.textContent = e instanceof AslnutError ? e.message : String((e as Error)?.message ?? e); },
    });
  } catch (e) {
    const el = $('#err'); el.style.display = 'block';
    el.textContent = e instanceof GraphicsUnavailable ? `${e.message} · WebGPU here: ${sup.webgpu ? 'yes' : 'no'} · WebGL2 here: ${sup.webgl2 ? 'yes' : 'no'}` : String((e as Error).message);
    return;
  }
  // the twin's own parts (&twin=1): its roads, its street tiles (buildings, trees, plots, paths), its water
  const twin = TWIN ? clayton({ workers: q.get('workers') === '0' ? false : true, lane: LANE }) : null;
  if (twin) w.add(twin.water, twin.roads, twin.street, twin.street.wires);
  const own = dataLayers();
  // Esri's place names (a picture of the view: the light basemap's own reference layer): off at first (a picture of
  // names laid on a tilted view stretches them; our own labels stand up instead). No gate by the camera: shown when
  // the person shows it
  const names = PARITY ? null : raster({ id: 'reference', label: 'Esri place names (best on flat views)', source: raster.view({
    url: ([w0, s0, e0, n0], W, H) => `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Reference/MapServer/export?bbox=${w0},${s0},${e0},${n0}&bboxSR=4326&imageSR=4326&size=${W},${H}&format=png32&transparent=true&f=image`,
    attribution: '© Esri, HERE, Garmin, © OpenStreetMap contributors' }) }) as unknown as Element;
  w.add(...own, ...(names ? [names] : []));
  // the places counted per suburb (made once, in a worker): a card each at the city and district levels, each place
  // at the street and closer; the levels change only through their gates (a margin, a dwell), never by the camera
  const placesByArea = GROUPS && own.some((l) => l.id === 'places') ? groups({
    id: 'places-by-suburb', of: 'places', by: { regions: suburbsData, name: (f: Feature) => title(f.props.locality_name) }, values: { n: { count: true } },
    show: { levels: ['city', 'district'] },
    mark: (g) => cards({ id: 'suburb-cards', of: g, header: { text: (d: Feature) => String(d.props.name) }, rows: [{ label: 'places', value: 'n' }], size: { px: 104 }, tooltip: (d: Feature) => `${d.props.name}\n${d.props.n} places` }) as unknown as Element,
  }) : null;
  if (placesByArea) w.add(placesByArea);
  // the stack as listed: the data in the order above (bottom first), each in its band; the place names on top
  w.reorder([...own.map((l) => l.id), ...(names ? [names.id] : [])]);
  // &only=a,b: just these data layers shown; &drape=creeks:over: a layer's own place with the twin (the tools)
  if (names && q.get('esri-names') !== '1') w.hide(names.id, { seconds: 0 });
  const only = q.get('only')?.split(/[,+ ]/);
  if (only) for (const l of [...own, ...(names ? [names] : [])]) if (!only.includes(l.id)) w.hide(l.id, { seconds: 0 });
  for (const kv of q.get('drape')?.split(',') ?? []) { const [id, m] = kv.split(':'); try { w.element(id!).setProps({ drape: m as DrapeMode } as never); } catch { /* not here */ } }

  // ── the layer list: the base (terrain, place names, the twin's parts) apart from the data ──
  const reliefPart: LayerPart = { id: 'terrain', label: 'Terrain (relief)', shown: () => w.state.user.toggles.relief !== false, show: (on) => w.toggle('relief', on) };
  const buildingsPart = (st: NonNullable<typeof twin>['street']): LayerPart => {
    let on = true;
    return { id: 'buildings', label: 'Buildings', note: 'its tiles are built again', shown: () => on, show: (v) => { on = v; st.setView((k) => twin!.kinds(k) && (on || k !== 'building')); } };
  };
  const treesPart = (st: NonNullable<typeof twin>['street']): LayerPart => ({ id: 'trees', label: 'Trees', shown: () => st.props.instances !== false, show: (v) => { st.setProps({ instances: v }); } });
  let baseNow: Base = BASE0;
  const baseParts: LayerPart[] = PARITY ? [] : (Object.keys(BASES) as Base[]).map((k) => ({ id: `base-${k}`, label: BASES[k], radio: 'base', shown: () => baseNow === k,
    show: (on) => { if (!on) return; baseNow = k; for (const b of Object.keys(BASES)) w.toggle(`base-${b}`, b === k); } }));
  const baseGroup: (Element | LayerPart)[] = [...baseParts, ...(names ? [names] : []), reliefPart, ...(twin ? [twin.street, buildingsPart(twin.street), treesPart(twin.street), twin.roads, twin.water] : [])];
  // (at the bottom on a phone: the thumb's corner, opening upwards under the page's title)
  const list = q.get('list') === '0' ? null : layers(w, { title: 'Layers', groups: { Data: own, Base: baseGroup }, modes: TWIN, position: innerWidth < 600 ? 'bottom-right' : 'top-right',
    add: { group: 'Data', services: [WMS, WFS] } });

  // ── a tap: the feature's attributes, and what the shown WMS layers say is there (each service asked) ──
  type Wms = { url: string; layers: string; version: string };
  const wmsShown = () => w.list.flatMap((l) => { const m = (l.props as { source?: { wms?: Wms } }).source?.wms; return l.shown > 0 && m ? [{ id: l.id, label: l.props.label ?? l.id, ...m }] : []; });
  let asking = 0;
  w.on('tap', async (f: Picked | null, info: { lon: number | null; lat: number | null }) => {
    const n = ++asking, rows: { title: string; props: Record<string, unknown> }[] = [];
    if (f) { const l = w.element(f.element); rows.push({ title: `${l.props.label ?? l.id}: ${f.props.locality_name ?? f.props.lga_name ?? f.props.name_label ?? f.props.name ?? f.id}`, props: f.props }); }
    const ws = wmsShown();
    if (info.lon === null || info.lat === null || (!ws.length && !rows.length)) { showInfo('', []); return; }
    showInfo('What is here', [...rows, ...(ws.length ? [{ title: `asking the map service (${ws.map((x) => x.label).join(', ')})…`, props: {} }] : [])]);
    if (!ws.length) return;
    // (one request a service: its shown layers together)
    const by = new Map<string, typeof ws>(); for (const x of ws) by.set(x.url, [...(by.get(x.url) ?? []), x]);
    const answers = await Promise.all([...by].map(([url, xs]) => raster.wms.info(url, { layers: xs.map((x) => x.layers).join(','), lon: info.lon!, lat: info.lat!, zoom: w.camera.zoom, version: xs[0]!.version === '1.1.1' ? '1.1.1' : '1.3.0' })
      .then((fs) => fs.map((x) => ({ title: xs.find((y) => x.layer && y.layers.split(',').some((n) => n === x.layer || n.endsWith(`:${x.layer}`)))?.label ?? x.layer ?? 'WMS', props: x.props })))
      .catch((e: Error) => [{ title: xs.map((x) => x.label).join(', '), props: { error: e.message } }])));
    if (n !== asking) return;
    showInfo('What is here', [...rows, ...answers.flat()]);
  });
  $('#identify').addEventListener('click', (e) => { if ((e.target as HTMLElement).closest('[data-close]')) showInfo('', []); });

  // ── the page ──
  const link = (k: string) => { const u = new URLSearchParams(q); u.set('go', k); return `?${u}`; };
  const twinLink = () => { const u = new URLSearchParams(q); if (TWIN) u.delete('twin'); else u.set('twin', '1'); return `?${u}`; };
  $('#views').innerHTML = Object.entries(VIEWS).map(([k, v]) => `<a href="${link(k)}" class="${k === go ? 'on' : ''}">${v.title}</a>`).join('') + `<a href="${twinLink()}">${TWIN ? 'map only' : 'with the twin'}</a>`;
  $('#sub').textContent = `Clayton, Melbourne · ${TWIN ? 'with the twin' : 'Esri light grey on the terrain'} · build ${BUILD} · ${w.api === 'webgpu' ? 'WebGPU' : 'WebGL2'}`;
  const sources = Object.fromEntries(own.map((l) => [l.id, (l as unknown as { source?: unknown }).source ?? null]));
  (window as unknown as { aslnutDemo: unknown }).aslnutDemo = { w, list, go, build: BUILD, twin, layers: own.map((l) => l.id), views: Object.keys(VIEWS), ows: OWS, sources, names, groups: placesByArea };
}
void main();
