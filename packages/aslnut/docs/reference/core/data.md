# core › data

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist).

**In one line:** every load and every dataset: sources (tiles, files, services, your own); loading (the loader: memory → packs → browser cache → network; tiles; compiled chunks streamed near the camera); features with stable ids and rows; joins and queries; live changes; history (the chronicle and epochs); scenarios (with overrides); and rights (terms, capabilities, attribution, licences).

Concepts: [data](../../concepts/data.md) · [compile](../../concepts/compile.md) · [live twins](../../concepts/live-twins.md) · [licences](../../concepts/licences.md)

<!-- tree:reference/core/data -->
```tree
data/
├── sources/
│   ├── tiles/
│   │   ├── xyz
│   │   ├── cog
│   │   ├── wms
│   │   ├── pmtiles
│   │   └── mvt
│   ├── files/
│   │   ├── geojson
│   │   └── csv
│   ├── services/
│   │   ├── wfs
│   │   └── stream
│   └── custom
├── loading/
│   ├── loader
│   ├── stores
│   ├── packs
│   ├── readiness
│   ├── tiles
│   └── chunks/
│       ├── manifest
│       ├── logic-pack
│       ├── near
│       ├── far
│       ├── format
│       ├── streamer
│       ├── hot-swap
│       └── fallback
├── features/
│   ├── features
│   └── rows
├── query/
│   ├── join
│   └── query
├── live/
│   ├── set
│   ├── upsert
│   ├── patch
│   └── remove
├── history/
│   ├── log
│   ├── state-at
│   ├── replay
│   ├── checkpoints
│   └── epochs
├── scenarios/
│   ├── base
│   ├── variant
│   ├── diff
│   ├── compare
│   └── overrides
└── rights/
    ├── terms
    ├── capabilities/
    │   ├── show
    │   ├── prefetch
    │   ├── keep
    │   └── export
    ├── attribution
    └── licences
```
<!-- /tree -->

## API: sources

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `sources/tiles/xyz` | `raster.xyz(url, opts?)` · `imagery.custom({ url })` | `url: string` (`{z}/{x}/{y}`, `{-y}`) · `minZoom?: int = 0` · `maxZoom?: int = 18` · `attribution?: string` · `terms?: Partial<Terms>` · `where?: BBox` | `RasterSource` | [built] | `raster.xyz('https://…/{z}/{x}/{y}.png')` |
| `sources/tiles/cog` | `raster.cog(url, opts?)` | `band?: int = 1` · `nodata?: number` | `RasterSource` | [planned] | `raster.cog('…/solar.tif')` |
| `sources/tiles/wms` | `raster.wms(url, opts)` · `raster.wms.capabilities(url, opts?)` · `raster.wms.legend(url, layer, opts?)` · `raster.wms.info(url, { layers, lon, lat, zoom? }, opts?)` · `raster.view({ url: (box, width, height) => string })` | `layers: string` · `styles?: string` · `format?: string = 'image/png'` · `version?: string = '1.3.0'` · `transparent?: boolean = true` · `params?: Record<string, string>` · `single?: boolean = false` (one picture of the view in CRS:84 instead of EPSG:3857 tiles: drawn on the chip as a mark, stacked among vector layers, its opacity a uniform; asked again when the view reaches new ground or comes 1.6× closer, never while it moves, after a failure only after 2 s doubling to a minute) · `maxSize?: px = 2048` · `scale?: = 1` (picture px per CSS px at the centre) · `headers?` · `fetch?` · `proxy?: string \| (url) => string` | `RasterSource` (tiles, painted into the ground) · `ViewSource` (`single`; its `legend` (GetLegendGraphic) and `wms: { url, layers, version }`) · capabilities: `{ version, title, layers: [{ name, title, crs, bbox, queryable, legend, styles }], formats, infoFormats }` (1.3.0, else 1.1.1) · info: the features there as GeoJSON, each with its `layer` | [built] | `raster({ id: 'zones', source: raster.wms(url, { layers: 'ns:plan_zone', single: true }), opacity: 0.5 })` |
| `sources/tiles/pmtiles` | `data.pmtiles(url, opts?)` | `url: string` (read by byte ranges) · `layer?: string \| string[]` · `id?: string` (a prop that is the id) · `zoom?: number \| 'view' = 'view'` · `maxTiles?: int = 64` · `linger?: ms = 0` (tiles the view left kept among the features while it moves and that long after) · `attribution?` | `Source` (MVT tiles for the view; pieces of one id joined; cut edges marked) | [built] | `data.pmtiles('/tiles/suburbs.pmtiles', { layer: 'suburbs', id: 'code' })` |
| `sources/tiles/mvt` | `data.mvt(url, opts)` | `url: string` (`{z}/{x}/{y}`, `{-y}` for TMS rows) · `layer?: string \| string[]` · `id?` · `minZoom?: int = 0` · `maxZoom?: int = 14` · `bounds?: BBox` · `zoom?: number \| 'view' = 'view'` · `maxTiles?: int = 64` · `linger?: ms = 0` (tiles the view left kept among the features while it moves and that long after) · `attribution?` | `Source` (vector tiles for the view; pieces of one id joined) | [built] (also `decodeMVT`, `encodeMVT`; read inside `data.pmtiles` too) | `data.mvt('…/{z}/{x}/{y}.pbf', { layer: 'roads' })` |
| `sources/files/geojson` | `data.geojson(url \| object, opts?)` | `id?: string \| (f, i) => id` (default: the GeoJSON `id`, else the index) · `attribution?: string` | `Source` | [built] | `data.geojson('/plants.geojson', { id: 'gid' })` |
| `sources/files/csv` | `data.csv(url \| text, opts?)` | `lon?: string = 'lon'` · `lat?: string = 'lat'` · `id?: string \| fn` · `delimiter?: string` (found by itself) · `numbers?: boolean = true` | `Source` (rows; points where they have coordinates) | [built] | `data.csv('/stations.csv', { id: 'code' })` |
| `sources/services/wfs` | `data.wfs(url, opts)` · `data.wfs.capabilities(url, opts?)` · `data.wfs.describe(url, typeName, opts?)` | `typeName: string` (with its prefix) · `extent?: BBox` (the box it loads, once; unset: the whole layer when it is small (at most `most` features, counted first), else an error that says to give one) · `tiles?: boolean = false` (true: the view's tiles instead, asked as the view moves; they only add features by id, never replace or reload them; a scale over it needs its domain) · `most?: int = 20000` (the whole layer loaded when it has at most this many) · `orExtent?: BBox` (no extent and the whole layer too big: this box instead) · `version?: '2.0.0' \| '1.1.0' \| 'auto' = 'auto'` (2.0.0, then 1.1.0 when refused) · `filter?: string \| { cql } \| { fes }` (the extent's box added to it; FES as 2.0.0 writes it, asked of 1.1.0 as `ogc:`) · `geometryName?: string` (a filter's: default DescribeFeatureType's) · `crs?: string` (default EPSG:4326 when offered, else web Mercator (turned back to degrees), else GDA94 / GDA2020 read as degrees; projected only: E-DATA-001) · `format?: string = 'application/json'` · `id?: IdRule` (default the service's feature id) · `pageSize?: = 1000` (count / startIndex; maxFeatures in 1.1.0) · with `tiles`: `gridOffset?: = 1` · `minGrid?: = 10` · `maxGrid?: = 15` · `maxFeatures?: = 5000` (a tile's most) · `maxTiles?: = 24` · `bounds?: BBox` · `headers?` · `fetch?` · `proxy?: string \| (url) => string` (a service without CORS) · `attribution?` | `WFS` (a Source loaded once over its extent, paged, its features handed on together when every page is in; with `tiles`: the screen's own tiles, nearest first, each asked once, features only added by id; `info: { version, crs, requests, bytes, tiles, truncated, features, ms }`) · capabilities: `{ version, title, layers: [{ name, title, crs, bbox }], formats, paging, countDefault }` · describe: `{ fields: [{ name, type }], geometry: { name, type } }` | [built] | `area({ id: 'suburbs', data: data.wfs('https://…/geoserver/wfs', { typeName: 'ns:locality_polygon', extent: [144.9, -38.0, 145.3, -37.8] }) })` |
| `sources/services/stream` | `data.stream(url \| { url?, connect? })` | `connect?: emit => stop` (your simulation, poller or library) · `parse?: data => message` · `retry?: seconds = 2` (doubling to 30) · `id?` · messages: rows (upserted) or `{ set?, upsert?, patch?, remove? }` | `Stream` (a live Source; `close()`) | [built] | `data.stream('wss://…/fleet')` · `data.stream({ connect: emit => sim.on('tick', emit) })` |
| `sources/custom` | `data.custom({ load, id? })` | `load: (ctx) => Promise<Feature[] \| Row[] \| GeoJSON>` (`ctx.loader` for cached fetches) · `attribution?` | `Source` | [built] | `data.custom({ load: async () => (await fetch('/api/plants')).json() })` |

## API: loading

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `loading/loader` | `loader(opts)` · `w.loader.get(url, opts)` | `mode?: 'live' \| 'record' \| 'replay' \| 'offline' = 'live'` · `kind?: 'tile' \| 'json' \| 'binary'` · `priority?: number` · `scope?: string` | `Promise<Response-like>` | [built] | `world(canvas, { loader: { mode: 'offline' } })` |
| `loading/stores` | tiers: memory → packs → browser cache → network | `memoryMB?: number = 256` · `cache?: boolean = true` | — | [built] | `loader: { memoryMB: 128 }` |
| `loading/packs` | `data.pack(url)` · `w.loader.record(name)` · `pack.save()` | `url: string` (a pack or a manifest) | `Pack` | [built] | `loader: { packs: [data.pack('/packs/bandung')] }` |
| `loading/readiness` | `w.ready.plan(views)` · `w.ready.coverage(views)` · `w.ready.ensure(views, opts)` · `w.ready.rehearse(views)` | `views: (View \| name)[]` · coverage `scope?` · ensure `{ scope?, concurrency?, onProgress? }` · rehearse `{ timeout? }` | plan `{ needed: url[] }` · coverage `{ needed, have, missing, fraction }` (kept in packs and the scope's store) · ensure what was fetched and kept (where the terms allow keeping) · rehearse per view `{ settled, ms, frames, pending, missing }` (the camera put back) | [built] (the ground's tiles and their fallbacks: the layers that know what a view loads) | `await w.ready.ensure(['city'])` |
| `loading/tiles` | tiled sources load the view's tiles by themselves (loading is a cache: invisible; features only added by id while the view moves, the far ones let go only off screen): `data.pmtiles(url)` · `data.mvt(template)` · `data.geojson(template)` (a URL with `{z}`) | `zoom?: number \| 'view' = 'view'` (the view's level within the source's, or a fixed one: the whole extent) · `maxTiles?: int = 64` | the features of the view's tiles, pieces of one id joined, shown when every wanted tile is in | [built] | `data.geojson('/tiles/{z}/{x}/{y}.geojson', { maxZoom: 14 })` |
| `loading/chunks/manifest` | `data.pack('…/manifest.json')` | `version: string` · `sources: Record<input, hash>` · `chunks: { id, level, hash, bytes }[]` | `CompiledWorld` | [planned] | `compiled: data.pack('https://…/compiled/manifest.json')` |
| `loading/chunks/logic-pack` | `compiled.logic` | — | `{ clamp, walkways, lanes, holes, culverts }` (global, small) | [planned] | `traffic({ lanes: compiled.logic.lanes })` |
| `loading/chunks/near` | chunk files `near/0_ix_iz.bin` | `size?: number = 256` (metres) | all triangles of their square | [planned] | `chunk: { near: 256 }` |
| `loading/chunks/far` | cell files `far/1_ix_iz.bin` | `size?: number = 1024` (metres) | the far-worthy triangles of their chunks | [planned] | `chunk: { far: 1024 }` |
| `loading/chunks/format` | `header · layers[positions, normals, colours, far-count] · solids` | `quantize?: { xz: 'auto' \| number, y: number = .02 }` · `layers?: string[] = ['solid', 'mark', 'water', 'buildings']` | 14 bytes per corner | [partly] (baked road tiles, v2: JSON per 500 m tile of typed pieces with heights, `{ v, ix, iz, size, infos, pieces }`: areas (an outline and holes, each point's height), edges (a line with heights, ground and the kerb's inward offset), strips, walls, boxes; the binary format planned) | `quantize: { y: .01 }` |
| `loading/chunks/streamer` | `world(canvas, { stream })` | `split?: [number, number] = [900, 300]` (metres, × quality) · `dropFar?: number = 4000` · `fetches?: int = 4` · `decodeMs?: number = 3` per frame · `keepParent?: boolean = true` | — | [planned] | `stream: { split: [600, 200], fetches: 2 }` |
| `loading/chunks/hot-swap` | automatic when the manifest changes; `w.on('chunks', f)` | — | only chunks whose hash changed are fetched | [planned] | `w.on('chunks', e => log(e.swapped))` |
| `loading/chunks/fallback` | `world(canvas, { build })` | `build?: 'auto' \| 'compiled' \| 'live' = 'auto'` | live building when compiled is missing or stale | [planned] | `build: 'live'` |

## API: features, query, live changes, history and scenarios

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `features/features` | `Feature { id, props, geometry, cuts? }` | `id` stable across loads (from the data, a prop, or your function; a repeat kept apart) · `geometry` GeoJSON's types in lon / lat · `cuts` (tile edges, not outlined) | `source.features()` · `source.get(id)` | [built] | `suburbs.get('vic-3168').props.name` |
| `features/rows` | `data.rows(array?, opts?)` · `rows.set(array)` · `rows.rows()` | `array: object[]` · `id?: string \| fn = 'id'` · `lon? / lat?` (rows with coordinates are points) | `Rows` (a Source; geometry only where it has coordinates) | [built] | `const crime = data.rows([])` |
| `query/join` | `shapes.join(rows, opts)` | `on: string \| f => key` (the shapes' prop, or `'id'`) · `rowsOn?: string \| f => key` (when named differently) | `Joined` (a Source; rows that change recolour, shapes stay; `matched`) | [built] | `suburbs.join(crime, { on: 'suburb_code' })` |
| `query/query` | `data.query(fn, opts?)` · `q.refresh()` | `fn: (s) => rows \| GeoJSON \| Promise` · `deps?: s => any` (runs again when it changes; default once; the time or the state, never the view: data is never changed by looking) · `when?: When` · `every?: seconds` · `debounce?: ms = 150` · `map?: answer => rows` | `Query` (Rows; the latest answer wins; `answeredFor`) | [built] | `data.query(s => api.crime(s.world.params['q.year']), { deps: s => s.world.params['q.year'] })` |
| `live/set` | `rows.set(array)` | `array: Row[] \| GeoJSON` | replaces all; shapes rebuild only if shapes changed, else colours ease | [built] | `crime.set(await fetchRows())` |
| `live/upsert` | `rows.upsert(items)` | `items: Row[]` (by id) | — (a new id plays its reveal) | [built] | `fleet.upsert([{ id: 'B1', lon, lat }])` |
| `live/patch` | `rows.patch(id, props)` | `id` · `props: Partial` | — | [built] | `fleet.patch('B1', { soc: .58 })` |
| `live/remove` | `rows.remove(...ids)` | `ids: (string \| number)[]` | — | [built] | `fleet.remove('B1')` |
| `history/log` | `history.log(options)` · `log.append(id, t, lon, lat, values?, props?)` · `log.appendMany(rows)` (a row's `alt`) · `history.fromColumns({ ids, count, start?, t, lon, lat \| lonlat, alt?, values?, props? }, options?)` · `log.toBytes({ things? })` · `history.fromBytes(bytes, { keep?, travel?, altitude? })` · `history.smallest({ box, from, to })` | `values?: Record<name, 'u8' \| 'f32' \| { type, domain }>` · `place?: { type: 'u16' \| 'f32' = 'f32', box? }` · `time?: { type: 'u16' \| 'f32' = 'f32', epoch?, step?: s = .1 }` · `keep?: samples = 512` (a live thing's ring; `Infinity`: all) · `url?` (a saved log, loaded through the world's loader) · `travel?: boolean` (it keeps each sample's metres along its thing's track since its first: a value 'travel', kept as samples come, for a recorded track and once loaded; what a wheel rolls by) · `altitude?: 'ground' \| 'sea' \| { over, type: 'u8' \| 'f32' = 'f32', domain?, value = 'alt' }` (each sample's height: metres over what it stands on or over the sea, a value of its own (`values.alt`, a row's `alt`, a point's third coordinate); `log.at(…).alt`; `log.altMax`; kept in a saved log) | `Log`: things (ids, props), each one's samples in typed columns of the smallest type (16-bit places in a box, 16-bit times in steps, a byte a value), `watch(fn)` (the slots each change touched) · relations over time: `history.relations(rows, { of?, to?, from?, until?, kind? })` · `history.relations.fromLog(log, { value, to: (v, thing) => host })` → `Relations` (`windowsOf(id)`, `hostOf(id, t)`, `heldBy(host, t)`, `count` and `members(agg, value, log?)`: channels) · channels: `channels.derive(items, { name: Channel }, { log?, id?, place? })` → a `Log` (each item's channels over time, derived once: constants, each item's own, a log's values by key (several summed), a relation's count or its members' aggregate, formulas (with inputs of their own); a step kept exact: two samples at one time) | [built] (relations: a thing held by another for a while (a car plugged in), joined per member, held per host; what a set folds by and a card counts by. channels: what cards and groups read on the chip; a recorded log keeps every sample; a live thing's ring once it holds `keep`; samples in time order, an older one dropped; a recorded track straight from its typed arrays (`fromColumns`): each thing's room made once, exactly, every sample written in one pass, the same columns as appending it (a thing out of order sorted; its columns the smallest that hold it unless said): 10,000 trips, 249 k samples, the log made in 46 ms against 108 ms appended, a whole rebuild 94 ms against 158 (phone view, WebGL2 on the chip, medians of 6); an altitude a sample (things in the air): read between samples as places are, a byte over its domain or a 32-bit float, kept by appends, rows, columns, a live source's points and a saved log (its highest sample with it)) | `history.log({ url: '/data/fleet.hist' })` · `log.append('bus-12', Date.now(), 145.12, -37.92, { charge: .8 })` |
| `history/state-at` | `log.stateAt(t, ids?)` · `log.at(id, t)` | `t: number \| Date \| string` · `ids?: (string \| number)[]` | `StateAt[]`: `{ id, lon, lat, heading, speed, values, props, outside }` (between two samples; the heading along its path, held while it stands) | [built] (a binary search a thing; on the graphics chip the same for a set: core › entities › sets) | `log.stateAt('2026-10-15T08:15+11:00')` |
| `history/replay` | `replay(w, opts)` | `from?, to?: Date \| string \| ms` (default the log's span) · `speed?: number = 1` · `loop?: boolean = false` · `play?: boolean = false` · `log?` | `Playback`: `play()` · `pause()` · `toggle()` · `setSpeed(x)` · `seek(t, { share? })` · `on(fn)` · `playing` · `progress` | [built] (on the world's clock: a seek is one change of the time, a paused world draws nothing) | `const p = replay(w, { log, speed: 60, loop: true }); p.play(); p.seek(.5, { share: true })` |
| `history/checkpoints` | automatic; `w.chronicle.checkpoint()` | `every?: duration = '10m'` | — | [planned] | `chronicle: { checkpoints: '5m' }` |
| `history/epochs` | `data.epochs(list, opts?)` | `list: { at: Time, source: Source }[]` (one dataset per time, e.g. ice-sheet extent per epoch) · `blend?: 'step' \| 'morph' = 'step'` | a `Source` that follows `s.time` (or any param) | [planned] | `area({ data: data.epochs(iceSheets), when: s => s.time.ago > 12000 })` |
| `scenarios/base` | `w.scenario.use('base')` · `w.scenario.current` · `w.scenario.list()` | — | the world as it is (everything a scenario changed, put back) | [built] | `w.scenario.use('base')` |
| `scenarios/variant` | `w.scenario(name, opts)` · `w.scenario.use(name)` | `base?: string = 'base'` (its changes under this one's) · `set?: Record<sourceId \| layerId, Source \| Feature[]>` · `params?: Record<key, value>` · `rules?: Record<fieldId, Rule \| { rule, params }>` · `label?` | `Scenario` | [built] (using one swaps the sources of the layers that use them, sets the params, gives fields the other rules (on the chip too); another use or 'base' puts back first) | `w.scenario('more-trees', { set: { trees: planned } })` |
| `scenarios/diff` | `w.scenario.diff(a, b)` | `a, b: string` | `Promise<{ added, removed, changed, params, rules }>` (features as { source, id }; params as { key, a, b }; rules as { field, a, b }) | [built] (the sources either swaps loaded if need be, compared by id, props and shape) | `await w.scenario.diff('base', 'more-trees')` |
| `scenarios/compare` | `w.scenario.compare(a, b, opts)` · `w.scenario.compare(null)` · `w.scenario.setSplit(at)` | `view?: 'split' \| 'swipe' \| 'difference' = 'split'` · `at?: 0..1 = .5` | — | [built] (one canvas, one frame: a twin of each layer b changes drawn on its side only (two scissored passes on WebGPU and WebGL2, picking by the pointer's side), a handle to drag when swiping; difference: a field's b − a in a diverging ramp, features added / changed / removed coloured; params are the world's: a's on both sides) | `w.scenario.compare('base', 'v2', { view: 'swipe' })` |
| `scenarios/overrides` | `data.overrides(table)` | `table: { id, field, value, source }[]` (corrections, each with who and why) | applied at compile and when read, so a fix shows without a rebuild | [planned] | `buildings.with(data.overrides('/fixes.csv'))` |

## API: rights

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `rights/terms` | `terms: Terms` on every source | `{ show, prefetch, keep, export }` | — | [built] | `imagery.custom({ terms: { keep: false } })` |
| `rights/capabilities/show` | `terms.show` | `boolean \| { maxZoom?, where? } = true` | — | [built] | `show: { maxZoom: 18 }` |
| `rights/capabilities/prefetch` | `terms.prefetch` | `boolean \| { maxZoom? } = true` | — | [built] | `prefetch: { maxZoom: 16 }` |
| `rights/capabilities/keep` | `terms.keep` | `boolean \| { days? } = false` | whether packs may store it | [built] | `keep: { days: 30 }` |
| `rights/capabilities/export` | `terms.export` | `boolean \| { watermark? } = false` | whether captures may include it | [built] | `export: { watermark: true }` |
| `rights/attribution` | `w.attribution()` · on screen: `world(canvas, { attribution })` · in captures: `w.frame({ attribution: true })` | `attribution?: false \| { position?: 'bottom-right' \| 'bottom-left' \| 'top-right' \| 'top-left' = 'bottom-right', className?, format?: credits => string }` (false: the app shows them itself) | `string[]` (for what is on screen now) | [built] (the credits of the layers and sources shown, in a box over the canvas's corner, written again only when they change) | `w.attribution()` |
| `rights/licences` | `licence` on sources and shapes · `w.rights.can(action)` | `licence?: string` (SPDX, e.g. `CC-BY-4.0`) · `action: 'export' \| 'keep' …` | `{ ok, because[] }` | [planned] | `w.rights.can('export')` |

## Example

```ts
const crime = data.rows([]);
w.add(area({ id: 'crime', data: suburbs.join(crime, { on: 'suburb_code' }), color: scale.quantile(d => d.props.rate) }));
crime.set(await query('crime by suburb 2025'));

const fleet = data.stream('wss://…/fleet', { id: d => d.vin }), moving = drive.data(fleet, { log: { values: { soc: 'u8' } } });
fleet.patch('B1234', { soc: .58 });
const at815 = moving.log.stateAt('2026-10-11T08:15:00+07:00');
const play = replay(w, { log: history.log({ url: '/data/fleet.hist' }), speed: 60, loop: true });
```

## Open questions

- Fixed (review findings): memory hits obey the policy, the mode and the scope; ranges are validated; a 404 never counts as ready; scope names cannot leave the store's folder; provider terms are enforced as capabilities.
- How long does a live log keep data in the browser (`keep` samples a thing now), and where does older history live?
- Should compiled output be a pack kind, or its own source (`data.compiled(url)`)?
