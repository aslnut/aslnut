# Data

> Draft under discussion.

**In one line:** every layer takes `data`, which can be a URL source, a ready array, or a live handle; shapes and numbers can be joined by id, and changing the numbers updates the picture without reloading the shapes.

## Why

- **Most twins mix sources:** a basemap, files, an API, a live stream, a query someone just ran.
- **Shapes are heavy, numbers are light.** Suburb boundaries load once; a query result is a few numbers per suburb.
- **Loading should be cached and work offline,** so everything goes through one **loader**.

## The rules

1. **One `data` prop** on every layer: a source, an array, or a handle.
2. **Every feature has a stable id** (from the data, or derived), so picking, joins and live updates work.
3. **Join shapes with rows by id:** `shapes.join(rows, { on })`.
4. **Live changes** (`set`, `upsert`, `patch`, `remove`) update only what changed; new features play their reveal.
5. **Rasters** (pictures of data, like a solar map) are their own kind: they paint into the ground.
6. **Everything loads through the loader:** cache tiers, offline, record and replay.

## Sources

```tree
sources/
├── vector/
│   ├── geojson
│   ├── pmtiles
│   ├── mvt
│   ├── wfs
│   └── csv
├── raster/
│   ├── xyz
│   ├── cog
│   ├── wms
│   └── pmtiles
├── live/
│   ├── rows
│   ├── query
│   └── stream
└── custom
```

| source | plain meaning |
|---|---|
| `data.geojson(url)` | one GeoJSON file |
| `data.pmtiles(url, { layer })` | one file holding tiled vector data, read in pieces |
| `vector.mvt(url)` | vector tiles from a server (`{z}/{x}/{y}.pbf`) |
| `data.wfs(url, { typeName })` | an OGC web feature service |
| `data.csv(url, { lon, lat })` | a table with coordinates |
| `raster.xyz(url)` | picture tiles (`{z}/{x}/{y}.png`) |
| `raster.cog(url)` | a Cloud-Optimised GeoTIFF: one big raster file read in pieces |
| `raster.wms(url, { layers })` | an OGC web map service |
| `data.rows([])` | your own rows, set later |
| `data.query(s => …)` | a function that re-runs when the time or the state it reads changes (never the view: data is never changed by looking) |
| `data.stream(url)` | live updates over a socket |
| `data.custom({ load })` | your own loader |

## Examples

```ts
// 1 · external vectors, draped on the terrain
w.add(
  area({   id: 'concessions', data: data.geojson('https://…/geothermal.geojson'), color: d => byStatus[d.props.status] }),
  line({   id: 'grid', data: data.pmtiles('https://…/power.pmtiles', { layer: 'lines' }), width: d => d.props.kv / 100 }),
  points({ id: 'plants', data: data.wfs('https://…/wfs', { typeName: 'power_plants' }), size: d => Math.sqrt(d.props.mw) }),
);

// 2 · external rasters, stacked in order
w.add(
  raster({ id: 'solar', source: raster.cog('https://…/ghi.tif'), ramp: 'inferno', opacity: .6 }),
  raster({ id: 'night', source: raster.wms('https://…/wms', { layers: 'VIIRS' }), blend: 'screen', when: s => s.time.hour >= 18 }),
);

// 3 · a query result as a ranked map: shapes once, numbers live
const suburbs = data.pmtiles('https://…/vic-suburbs.pmtiles');   // shapes: loaded once, cached
const crime   = data.rows([]);                                    // the query result
w.add(area({
  id: 'crime',
  data: suburbs.join(crime, { on: 'suburb_code' }),
  color: scale.quantile(d => d.props.rate, { n: 5, ramp: 'reds' }),   // high → low in 5 classes
  height: d => d.props.rate * 20,                                     // optional: taller = more
  transition: .6,                                                     // values ease when they change
  legend: true,
}));
crime.set(await fetch('/api/crime?year=2025&type=burglary').then(r => r.json()));  // colours update; shapes stay

// 4 · a query that re-runs by itself, and a live stream
const byYear = data.query(s => fetch(`/api/crime?year=${s.time.year}`).then(r => r.json()), { deps: s => s.time.year });
const fleet  = data.stream('wss://…/fleet');                       // upsert / remove by id
w.add(entities({ data: fleet, shape: vehicles.car, color: d => batteryColour(d.props.soc) }));
```

## Features: ids, live, history

- **Stable ids:** each feature has an `id` (from the data or derived) and `props`.
- **Live:** `rows.set(all)`, `rows.upsert(some)`, `rows.patch(id, change)`, `rows.remove(id)`, or a `stream`.
- **History:** a chronicle keeps the state at any time, so you can scrub back.
- **Scenarios:** a base plus variants (a new park, a new bike lane), compared side by side.
- **Attribution:** every source carries its credit and terms; `w.attribution()` lists what's on screen.

## The loader

Everything above loads through one loader:

```tree
loader/
├── memory
├── packs
├── browser cache
└── network
```

- **Read in that order:** memory first, then packs (baked files), then the browser cache, then the network.
- **Modes:** `live` (normal), `record` (keep everything this run uses), `replay` (use only what was recorded; nothing from the network), `offline`.
- **Readiness:** plan what a run will need, fetch it ahead, and know the coverage before you start.

## How it relates

- **[Presence](presence.md):** data decides what exists; `when` decides what's shown.
- **[Interaction](interaction.md):** picking returns the feature with its id and props.
- **[Order](order.md):** where the data's layer sits.
- **[Reveal](reveal.md):** new features play their reveal.

## Common mistakes

- **Reloading the shapes for every query.** Join; set the rows.
- **Using a raster for data you want to click.** Pictures can't be picked; vectors can.
- **Ignoring provider terms.** Some tile providers forbid caching or offline use; the loader's rules per source must say so.

## Status

| part | status |
|---|---|
| the loader: tiers, scopes, modes, packs, readiness | [built] |
| data passed as a loaded object | [built] |
| `data.geojson`, `csv`, `pmtiles` (MVT), `rows`, `query`, `join`, `stream`, `custom` | [built] (`mvt` URLs, `wfs` planned) |
| stable ids, live set / upsert / patch / remove (numbers recolour, shapes rebuild only when shapes change) | [built] |
| `raster()` layers: `raster.xyz`, `wms`, `field`, `custom`, painted into the ground in order | [built] (`cog` planned) |
| scales and legend | [built] |
| chronicle, scenarios | [planned] |
| attribution and terms per source | [partly] (loader rules exist; per-provider permissions planned) |
