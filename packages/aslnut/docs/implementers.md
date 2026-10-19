# Implementing aslnut in your platform

**In one line:** this page is for people and assistants who wrap aslnut into a platform of their own (a component library, a flow runtime, a server-side pipeline): what aslnut is, how to load it, how to keep it in step with your components, how to feed it, which formats a server writes or serves, how it holds a phone's budget, how to check your wrapper, and what to ship with it.

Read the [authoring guide](authoring.md) first: it is the API a person writes. This page is what sits round it.

```ts
// the whole contract of a wrapper, in five calls
const w = await world(canvas, options);   // mount: one world on one canvas (null: headless)
w.add(layer({ id: 'zones', data, area: { color } }));       // an element per id
w.element('zones').setProps({ area: { color: next } });     // a changed prop: set, never made again
w.remove('zones');                                           // a gone id
w.dispose();                                                 // unmount
```

## 1 · What aslnut is, and what it is not

- **A viz engine for worlds.** It draws the Earth (or a flat floor), what stands on it, what moves on it, and your data over it, on WebGPU and WebGL2.
- **One chain runs it: orbit › observation › data › viz.**
  - **Orbit:** the camera only moves the picture. Zoom, tilt and spin never change the data and never cost a rebuild.
  - **Observation:** in a twin, the level looked at (world › country › region › city › district › street › building › room) decides what is present, past a margin and after a dwell. A GIS view has no levels.
  - **Data:** each dataset is loaded once and said one way.
  - **Viz:** the look comes from the feature and your settings only.
- **Your math runs outside.** Your simulation, your model, your routing service: they run where you choose and hand aslnut their results as data. aslnut draws them.
- **aslnut may offer reusable math** (routing on a graph, groups per level, field steps, a heat model). Each one is optional. Nothing in aslnut requires you to use it.
- **What it is not:** an app. Menus, panels, layouts, story tools and editors are yours ([boundaries](concepts/boundaries.md)). aslnut draws the world and reports its state.

## 2 · Using it from source

aslnut 0.1.0 is used from source. An npm package comes later.

### Entry points

`packages/aslnut/package.json` lists the entry points (`exports`). Each subpath maps to a source file:

| import | source |
|---|---|
| `aslnut` | `src/index.ts` (core, the world modules, the dashboard and game kits) |
| `aslnut/core` | `src/core/index.ts` |
| `aslnut/core/observation/observers/orbit` | the camera, views, keys and moves |
| `aslnut/core/data/loading` | the loader, stores and packs |
| `aslnut/core/data/loading/folder` | `FolderStore`: a cache on disk (**Node only**) |
| `aslnut/core/data/sources` | the sources |
| `aslnut/core/render/graphics/shaders` | the shader translator |
| `aslnut/core/world/states` | saved states (`states`, `STATE_SCHEMA`) |
| `aslnut/modules/world`, `…/earth`, `…/plane` | the bodies |
| `aslnut/kits/dashboard` | legends, stats, the layer list |
| `aslnut/modules/presets/humans`, `…/vehicles`, `…/drones`, `…/shared` | the ready-made people, vehicles and drones |
| `aslnut/tools` | build-time entries (the roads compile), kept out of a visitor's bundle |

- **From source:** point the names at the source. The package's own `tsconfig.json` does it with `paths`: `"aslnut": ["./src/index.ts"]`, `"aslnut/*": ["./src/*/index.ts", "./src/*.ts"]`. Give your bundler the same aliases (the root README shows one for Vite).
- **Built:** `npm run build` (in `packages/aslnut`) writes `dist/` with types. The `exports` point there. `dist/` is not in the repository: build it before you resolve `aslnut` through the package.
- **Node 24** runs the source as it is (`.ts` files, no build step). Headless worlds, the tools and the reference server use that.
- **`sideEffects: false`.** Importing runs nothing, registers nothing and touches nothing. Unused parts drop out of your bundle.

### Server-safe imports, headless worlds

- **Importing `aslnut` never touches `window`, `document` or the graphics chip.** Only `world(canvas)` does. A server-rendered page may import it freely.
- **`world(null, options)` is headless.** Views, flights, projection, params, readouts, `when`, levels and data run with the same results and no graphics. `w.api` is `'none'`; `w.reason` is `'headless (no canvas)'`. The unit tests run worlds this way (`test/world.test.ts`).
- **What a headless world cannot do:** draw, pick (`w.pick` answers `null`), read frames (`w.frame`, `w.record` throw `E-WORLD-003`).
- **On a server, make the world on the client.** A server has no canvas to give. Create the world in your component's mount step (an effect, `onMount`), never during a render.

### One world, one canvas

- `world(canvas, options)` is async. It opens the graphics, adds the body's elements and starts the loop (`autostart: false` holds it).
- **`graphics: 'auto'`** (the default) tries WebGPU, then WebGL2. `w.api` says which (`'webgpu'`, `'webgl2'`); `w.reason` says why, in words. `'webgpu'` or `'webgl2'` asks for one and fails plainly with `GraphicsUnavailable` (`E-GPU-001`: neither; `E-GPU-002`: not the one asked). `supported()` asks before you make a world.
- **One world per canvas.** Several worlds on one page are fine.
- **After `w.dispose()`, give the next world a new canvas.** Dispose frees the graphics; on WebGL2 it loses the canvas's context for good.
- **Sizes follow the canvas.** The world watches the canvas element (a resize observer) and draws at its CSS size times the pixel ratio. Size the canvas with CSS (your component's box); never set `canvas.width` yourself. The pixel ratio is capped by the device's profile (1.5 at quality lite, 2 at realistic); `pixelRatio` fixes it.
- **Controls, hover, tooltips and credits** attach to an `HTMLCanvasElement` in a page. The type also takes an `OffscreenCanvas`; no check runs a world on one yet.
- **`w.dispose()`** stops the clock, removes the controls and observers, detaches every element, frees all graphics memory and ends the world's own loader. It is safe to call twice. A call on a disposed world throws `E-WORLD-003` with its fix.

## 3 · Wrapping it as components

### The rules

1. **Shells add nothing** ([hosting](concepts/hosting.md)). Your component, node or tag passes props straight to aslnut's own objects. It never invents props, never wraps the data, never keeps a second model of the world.
2. **Elements are aslnut's own objects:** `layer(…)`, `points(…)`, `entities(…)`, `roads(…)`… made by your user's code, each with an `id`.
3. **Kept in step by id.** A new id is added (`w.add`). A gone id is removed (`w.remove`). A changed prop is set on the element already in the world (`element.setProps`). **A restyle is never a rebuild.**
4. **The camera is the person's.** A changed view in your props moves the camera only when your platform says so (a jump with `w.go`, a flight with `w.fly`).
5. **Options with a setter follow their changes;** the rest are the world's for its life:

| option | setter |
|---|---|
| `views` | `w.addView(name, view)` |
| `time` | `w.setTime(date \| 'now', { rate })` |
| `timeZone` | `w.setTimeZone(zone)` |
| `quality` / `render.quality` | `w.setQuality(q \| null)` (null: the world's own again) |
| `render.shadows` | `w.setShadows(on \| options)` |
| `theme` | `w.setTheme(theme \| null)` |
| `budget` | `w.setBudget(budget \| null)` |
| `priorities` | `w.setPriorities(p)` |
| `observation` | `w.observe(options \| null)` |
| `body`, `graphics`, `loader`, `controls`, `clock`… | none: a new world |

### Keeping elements in step, in plain code

The same pattern serves a component library, a flow runtime's node, or a page of your own. It uses only the world's own calls.

```ts
import type { Element, World } from 'aslnut';

/** keep a world's elements to a list, by id */
export function keeper(w: World) {
  const held = new Map<string, { el: Element; props: Record<string, unknown> }>();
  return (list: readonly Element[]) => {
    const next = new Map(list.map((el) => [el.id, el]));
    for (const [id] of held) if (!next.has(id)) { w.remove(id); held.delete(id); }            // gone: removed
    for (const el of list) {
      const now = el.props as unknown as Record<string, unknown>, h = held.get(el.id);
      if (!h) { w.add(el); held.set(el.id, { el, props: now }); continue; }                  // new: added
      if (el.constructor !== h.el.constructor) { w.remove(el.id); w.add(el); held.set(el.id, { el, props: now }); continue; } // another kind
      const changed: Record<string, unknown> = {};
      for (const k of new Set([...Object.keys(h.props), ...Object.keys(now)])) if (k !== 'id' && h.props[k] !== now[k]) changed[k] = now[k];
      if (Object.keys(changed).length) h.el.setProps(changed as never);                      // changed: set, not made again
      h.props = now;
    }
  };
}

// mount → world; each update → the list; unmount → dispose
const w = await world(canvas, options);
const keep = keeper(w);
keep([layer({ id: 'zones', data: zones, area: { color: dark ? '#333' : '#ddd' } })]);
// … later, the same id with a new colour: one setProps, nothing loaded or built again
w.dispose();
```

What to know:

- **Give every element an `id`.** Without one, each call to `layer(…)` makes a new id: your list adds a new element every update.
- **The new element object of an update is never added.** Only its props are read. Making it is cheap: nothing loads or touches the chip until `w.add`.
- **Compare props by value where you can.** A prop that is a new object each update (a source, a log, a function made inline) counts as changed every time: a restyle (or a load) each update. Make sources, logs and functions once, outside the render.
- **A sign added to a layer later needs a new layer.** A layer's signs (`area`, `line`, `points`, `extrusion`, `labels`) are made with it; `setProps` restyles them but makes none.
- **Remove an element placed by another first.** `w.remove(id)` throws `E-WORLD-002` while another element is `above` or `below` it.
- **An element removed is best made anew** before it is added again: make a new object with the same id.
- **Ids are plain names:** letters, digits, `-` and `_` (`E-WORLD-001` otherwise). Params are `<id>.<name>`.
- **Order is a prop** (`order`, `above`, `below`), set like any other; `w.reorder(ids)` sets a whole stack.

### Listening

- **`w.on(name, fn)`** returns the function that stops it. The events:

| event | gives | when |
|---|---|---|
| `elements` | `{ what: 'add' \| 'remove' \| 'order' \| 'shown' \| 'opacity' \| 'props', ids }` | the elements changed (a layer list keeps in step) |
| `level` | the level change | the observation level changed |
| `tap` | `(picked \| null, pointer)` | a tap or click; `pointer` is CSS px and the ground's lon / lat |
| `hover` | `(picked \| null, pointer \| null)` | the thing under a mouse changed |
| `select` | `ids` | the selection changed |
| `frame` | `{ n, dt }` | a frame was drawn |
| `error` | the error | anything failed (see errors below) |
| `long` | `{ gapMs, profile }` | a frame came over 50 ms after the one before |
| `governor` | `{ step, dropped, why }` | the governor stepped detail down or up |

- **Picking:** `await w.pick(x, y, { radius, elements })` (CSS px on the canvas) answers the top-most shown feature, the same on WebGPU and WebGL2: `{ element, id, props, d, index, at, x, y }`. A world gives picking numbers to its first 255 elements; past that an element is drawn but not picked.
- **Selection:** `w.select(ids | null)`; it lives in the state (`s.user.selection`).
- **Hidden or shown by hand:** `w.hide(id)`, `w.reveal(id)`, `w.release(id)` (back to its `when`).

### Settled and report

- **`await w.settled({ strict, timeout, hold })`** resolves when the view is complete: every element attached, every tile in and faded, every reveal done, the camera still. It resolves `false` on a failure or a timeout (default 30 s); `strict: true` rejects with `E-SETTLE-001` (still pending) or `E-SETTLE-002` (failed), with what in `details`.
- **`w.report()`** says what is pending, failed and missing now. A flow runtime can pass it on as a node's status.
- **`w.isDisposed`** says whether the world is gone.

### Errors

- **Every error aslnut throws is an `AslnutError`:** a `code` (`E-GPU-001`, `E-DATA-002`…), a `message`, a `fix` in one sentence, a `where` (an element id, a source id, a shader line) and `details`. The codes are listed in `src/core/world/errors.ts`.
- **Errors that happen later** (a tile that failed, a layer whose attach failed) go to `w.on('error', fn)` when one is set, else to the `onError` option, else to `console.error`. A wrapper sets one and shows it its own way.
- **`GraphicsUnavailable`** carries what the device has (`found: { webgpu, webgl2, reason }`): enough to explain it plainly in your UI.

| code | meaning | fix |
|---|---|---|
| `E-LOAD-003` | a response does not match the requested byte range | honour Range and expose `Content-Range` across origins |
| `E-LOAD-006` | an image decode worker failed; its pending requests reject | retry the image load and check worker and canvas support |
| `E-DATA-004` | an unsupported history log or road chunk version | use compatible saved data or regenerate it |

### State in and out

- **`w.capture({ note })`** gives the state as plain JSON (`v: 1`): the view, the time, the level, each element shown or hidden with its params and filter, the selection, the toggles.
- **`await w.apply(state, { seconds })`** brings it back. `states.validate(json)` checks one against `STATE_SCHEMA` (JSON Schema). A flow runtime can store and pass states between nodes.

## 4 · Feeding data

### Sources

A source is where a layer's features come from. One source can feed several layers; it loads once, through the world's loader.

| source | what it takes | what your server gives |
|---|---|---|
| `data.rows(rows, { id, lon, lat })` | your rows; a point where a row has `lon` / `lat` | nothing: rows from your code |
| `data.geojson(url \| object, { id })` | a GeoJSON file or object; a URL with `{z}/{x}/{y}` is GeoJSON tiles for the view | a GeoJSON file |
| `data.csv(url \| text, { lon, lat, id })` | a CSV or TSV table (the delimiter is found) | a CSV file |
| `data.wfs(url, { typeName, extent })` | an OGC web feature service's layer | WFS 2.0.0 (else 1.1.0) answering `GetFeature` with `outputFormat=application/json` |
| `data.pmtiles(url, { layer })` | vector tiles in one PMTiles file, read in pieces for the view | a PMTiles v3 file of MVT tiles, by byte ranges (see [section 5](#5--work-that-can-run-on-a-server)) |
| `data.mvt(url, { maxZoom })` | MVT tiles at a `{z}/{x}/{y}` URL | MVT tiles |
| `data.query(s => …, { deps, every })` | your function's answer as rows, asked again when `deps(s)` changes or every `every` seconds | whatever your function fetches |
| `data.stream(url \| { connect })` | live changes over a WebSocket, or your own `connect(emit)` | WebSocket messages (below) |
| `data.custom({ load })` | your own loader | yours |
| `districts.join(rows, { on: 'code' })` | a source of shapes that loads once, joined to a source of numbers that change | two sources |

- **Every feature has an id.** Give one (`id: 'code'`, or a function). A row without one falls back to its place in the list, and a live change then lands on the wrong feature.
- **A feature written in code** has `props`, not `properties`: `{ id, props, geometry }`.
- **Your own source** extends `Source` and calls `this.replace(features)` from `load(ctx)` (`src/core/data/sources/source.ts`).

### Live changes

`data.rows`, `data.query`, `data.stream`, `data.csv` and `data.custom` share four calls:

| call | does |
|---|---|
| `src.set(rows)` | replaces every row |
| `src.upsert(rows)` | adds or replaces rows by id |
| `src.patch(id, change)` | merges some props into one row (`E-DATA-001` when the id is unknown) |
| `src.remove(...ids)` | removes rows |

- **A layer redraws only what changed.** A change of numbers recolours; a change of shapes builds again. A source says which (`version`, `shapeVersion`).
- **Batch your changes.** Each call is one change of the whole list: a thousand rows in one `upsert` cost one pass; a thousand `patch` calls cost a thousand.
- **A stream's message** (JSON text by default; `parse` reads yours) is rows (upserted), or `{ set?, upsert?, remove?, patch?: { id, change } }`, applied in the order set, upsert, patch, remove. A patch for an unknown id is dropped. A dropped socket reconnects after `retry` seconds (default 2, doubling to 30). The protocol has no sequence numbers and no resume: after a reconnect, send `{ set }` again.
- **Close a stream yourself.** `w.dispose()` and `w.remove(id)` do not close a source (a source can feed several layers, and outlive a world). Call `stream.close()` when your component goes.

### History logs: timed samples

A moving thing is fed as **samples** (where it was, when, with what values), never as a position each frame.

```ts
const log = history.log({ values: { charge: { type: 'u8', domain: [0, 1] } }, travel: true, altitude: 'ground' });
log.appendMany(rows.map((r) => ({ id: r.vehicle, t: r.time, lon: r.lon, lat: r.lat, alt: r.alt, values: { charge: r.charge } })));
w.add(entities({ id: 'fleet', shape, drive: drive.data(log), joints: { wheel: { value: 'travel' } } }));
replay(w, { log, speed: 10, loop: true, play: true });
```

- **`log.append(id, t, lon, lat, values?, props?)`** and **`log.appendMany(rows)`** take samples. A thing's samples come in time order: an older one than its last is dropped. A value not given keeps the thing's last one.
- **Values** are columns of their own: a byte over its `domain` (`'u8'`: 255 steps), or a 32-bit float (`'f32'`, the default). `travel: true` keeps the metres each thing has gone (wheels roll by it).
- **Altitude:** `altitude: 'ground'` (or `'sea'`) keeps each sample's height over the ground (or the sea) as the value `alt`.
- **Relations over time:** `history.relations(rows)` takes `{ of, to, from, until, kind? }` rows (a car held by a charger for a while); `history.relations.fromLog(log, { value, to })` makes them from a value.
- **Live positions:** `drive.data(data.stream(url))` records each changed point into a log and draws it 250 ms behind the data (`smooth`), moved smoothly between samples.
- **Size:** a live thing keeps its last `keep` samples (default 512, at most 8,191) in a ring.

### Rates and samples, never a value a frame

- **What moves is moved on the chip** from the world's clock: a log's samples, a joint's `rate` (`joints: { wheel: { rate: 30, unit: 'rpm' } }`), a formula. Send the rate, or the samples at your own rate.
- **Never set a value each frame from the main thread** (in `w.on('frame')` or a timer) for things the world can move. Every write is an upload and a frame drawn; on a phone the main thread is the first thing to run out.
- **Your own per-frame work** goes in `w.everyFrame(fn, { fps, budgetMs })`, at the lowest rate that looks the same. A camera set each frame uses `{ before: true }`.

### Scales from the whole data

- **A scale's classes come from the whole data** (`scale.quantile`, `scale.category`…), read once each time the data changes, never from what a view has loaded: the same value gives the same look at every zoom.
- **A source that follows the view** (`data.pmtiles`, `data.mvt`, `data.wfs(…, { tiles: true })`) holds no whole on the device. Its scale is given its `domain`; an `'auto'` one is `E-DATA-003` with its fix. A server that tiles data should publish the domain beside the tiles.
- **`legend(null, { for: scale }).describe()`** gives a scale's legend as data for your own UI.

### Levels, never camera keys

- **A GIS view has no levels:** every layer is shown and stays. No gate is needed.
- **A twin is looked at through levels:** `world(…, { observation: { levels: 'default' } })`, then `when: { level: { from: 'district' } }` on an element. An element asking for a level turns the default ladder on by itself.
- **Never gate by the camera.** `when: { zoom }`, `{ dist }`, `{ altitude }` and `{ tilt }` throw `E-WHEN-001`: what is shown never follows the camera. A wrapper must not offer zoom ranges as a prop.
- **`when`** takes `true`, `false`, a shorthand (`level`, `hour`, `year`, `month`, `api`, `quality`, `role`, `toggle`) or a function of the state, `(s) => boolean | 0..1`.

## 5 · Work that can run on a server

### Stable, and what may change in 0.x

Nothing in 0.x is frozen: a minor version may change an API or a format. The open standards aslnut reads (GeoJSON, CSV, MVT, PMTiles v3, WFS) are the safest ground. Of aslnut's own formats, a format is as firm as its version field and the reader that checks it:

| format | marker and version | the reader checks it |
|---|---|---|
| pack | `ASLNUTPK`, index `version: 1` | yes: magic, version, every entry's bounds |
| saved state | `v: 1`, `STATE_SCHEMA` | yes |
| history log (`.hist`) | `ASLNHST1`, header `v: 1` | the magic only |
| road pack (chunks) | JSON: `index.json` `v: 2`, tiles `v: 3`, `clamp.json` `v: 3`, clamp tiles `v: 4`, `walk.json` `v: 1` | no (`core.data.loading.chunks.format` is partly built) |
| mesh tile (reference host) | `ASMT`, u32 version 1, `aslnut-mesh/1` | no; the library has no reader for it yet |

Write the newest version, and treat the ones the reader does not check as previews.

### Packs

A pack is one cache scope in one file, answered before any cache or network (`src/core/data/loading/pack.ts`): `"ASLNUTPK"`, a little-endian u32 index length, the index (JSON: `version`, `scope`, `created`, `entries` of `{ key, status, type, source, at, meta?, offset, length }`), then the bodies.

- **Make one with aslnut itself:** a `Loader` with a store (`FolderStore` in Node, from `aslnut/core/data/loading/folder`), `loader.ensure(urls, { scope })`, then `loader.export(scope)`. Entries whose terms forbid export are left out and listed.
- **Keys are the URLs the loader asks:** absolute in a browser (a byte range adds `?__range=offset-length`). Give absolute URLs when you make a pack in Node.
- **A page loads it whole:** fetch the file, then `w.loader.import(file)` (or `packs` in the loader's options).

### Range requests and CORS

PMTiles, packs of pieces and every ranged read go through the loader: `fetch` with `mode: 'cors'`, six requests a host, three retries on 5xx and 429.

- A `206` must carry exactly `Content-Range: bytes a-b/total`; a `200` with the whole file is accepted and cut.
- Cross-origin, allow the `Range` request header and expose it with `Access-Control-Expose-Headers: Content-Range`. With the response header hidden, a 206 is accepted only when its byte length exactly matches the requested length; otherwise it fails with `E-LOAD-003`.

### Tiles: PMTiles and the reference host

- **`data.pmtiles(url)`** reads PMTiles v3 of **MVT** tiles, gzip or uncompressed (brotli and zstd are refused). The library writes them too: `encodeMVT` and `PMTilesWriter` (both exported).
- **`packages/server`** is the reference host for aslnut's tile formats (Node 24, no build): `node packages/server/main.ts`. It serves mesh tiles (`aslnut-mesh/1`: vector data made ready for the GPU) from a cache, a PMTiles archive or the baker on demand; takes edits (`POST /serve/tiles/<set>/edit`), rebakes only the tiles they touch, and tells open pages by server-sent events (`GET /serve/events`: `edit`, `job`, `archive`). Its routes are in its [README](../../server/README.md).
- **Know before you build on it:** the library has no reader for mesh tiles yet, and `data.pmtiles` reads MVT only, so a world cannot draw the host's tiles today. It listens on 127.0.0.1 only, with no authentication on edits or bakes: put your own server in front.

### Road packs and the road baker

- **A road pack** is a folder of JSON (each with a `.json.gz` beside it): `index.json`, a tile per 500 m (`<ix>_<iz>.json`: typed pieces with their heights, numbers packed as base64 varints), `clamp.json` and its tiles (where the ground goes under the roads), `walk.json`. A world reads it with `bakedRoads({ url: '…/index.json' })` and `clampTerrain(terrain, '…/clamp.json')`.
- **Two bakers write it:** the TypeScript compile (`compile` from `aslnut/tools`; `node tools/compile/run/command.ts roads <place>`) and **`packages/baker`**, a Rust crate (`rlib` and `cdylib`):
  - the command line: `baker <input dir> <place> --out <dir> [--rules rules.json] [--built <old pack>]`, `baker --print-rules`;
  - the library: `baker::bake(&SeedFiles, &Rules, old_stages, clock) -> Result<Baked, String>`, `baker::bundle::bake(bytes) -> bytes`;
  - WebAssembly (`--no-default-features`): `alloc`, `bake_bundle`, `out_len`, on a bundle of named files (a u32 count, then each name and its bytes, little-endian; no magic, no version).
- **Its input:** OpenStreetMap ways as GeoJSON (`<place>.geojson`, each line with its `nodes`) and a ground grid (`<place>.ground.json` and `.ground.f32`). Its rules default to one city's street standards: give your own (`--rules`).

### History logs

- **Write a `.hist` with aslnut in Node:** `history.log(o)`, `log.appendMany(rows)`, `log.toBytes()`. A page reads it whole: `history.log({ url })`.
- **The layout** (`src/core/data/history.ts`, `toBytes`): `"ASLNHST1"`, a little-endian u32 header length, the JSON header (`v: 1`, the epoch, the origin, the columns' types, the ids, the props, each section's offset), then 8-byte-aligned columns: `start`, `count`, `time`, `place`, and one per value. Places are kept relative to the log's origin in Mercator units, not in degrees: write them with aslnut rather than by hand.
- **The reader checks the magic only:** serve logs you made.

### Networks: routing, isochrones, nearest

`network({ lines, snap, keep, cost, oneway })` builds a graph from lines (no DOM, no GPU: it runs in Node).

| call | gives |
|---|---|
| `net.route(from, to)` | `{ cost, line }` or null |
| `net.shortest(sources, { toward })` | one pass from many places (`costAt`, `pathFrom`) |
| `net.matrix(from, to)` | costs, `Infinity` where none |
| `net.isochrone(from, [400, 800], { cell, reach })` | a feature per band (`{ id, props, geometry }`: aslnut's feature form, `props` not `properties`) |
| `net.nearest(at, { max })` | the nearest point of the network, within 300 m by default |

### Groups and rollups per level

- **`regions.tree({ levels, sources })`**, then `await tree.load(loader)`: which region a place is in, parents, children. `tree.rollup(rows, { on, to, sum, mean, count })` sums rows up a level, live. It runs in Node with `new Loader({ store: new MemoryStore() })`.
- **`groups({ of, by, values, show: { levels } })`** groups things per observation level (by regions, cells or a key), over time. Its counting step is a pure function, `groupsJob(input)` (typed arrays in and out), that runs in a worker or in Node.

### Fields on the CPU

- **`field({ res, area, init, rule, inputs })`** steps a grid with a rule (`rules.diffusion`, `.advection`, `.heat`, `.shallowWater`, `.flow`, `.custom`, or your `kernel`). Without graphics it steps on the CPU: call `f.step(seconds)` yourself, read `f.at([lon, lat])`, `f.values()` or a `f.probe(…)`.
- **`heatModel(rasters).field(input)`** is the heat model on the CPU. `constants` holds citable tables; `constants.add` changes them for the whole process.

### Recording frames in a headless browser

- **`for await (const f of w.record({ fps, seconds, size, path, attribution: true }))`** steps the world's clock 1 / fps a frame, holds each frame until it is complete, and gives its pixels (`{ index, t, width, height, pixels, settled, pending }`, RGBA, top row first). The same steps give the same frames on every run.
- **It needs graphics:** run it in a headless browser (`tools/browser.mjs` shows the flags for WebGPU and WebGL2 with no GPU), send the pixels out of the page, and encode them on your side.

### Logs from the page

`world(canvas, { log: url })` posts JSON lines (one event per line, batched every 2 s and when the page hides): errors, governor steps and long frames at `level: 'warn'`; a heartbeat a second and `w.log(ev, data)` at `'info'`. Your server answers the POST and keeps the lines.

## 6 · Budget and devices

Phones come first. Leave the defaults on, and let your platform show what the world reports.

- **`quality: 'auto'`** (the default) is the device's pick: lite on WebGL2, on touch screens (phones, tablets) and on low tiers (3 GB of memory or 2 cores and less); realistic elsewhere. `w.reason` says which graphics and which quality, and why. A value (`'lite'`, `'realistic'`) or your function of the state overrides it.
- **`budget: 'auto'`** (the default) holds phones, tablets and low tiers to `{ frameMs: 22 }` (at least 30 frames a second); elsewhere the frame is measured, never stepped. Your own: `{ frameMs, memoryMB, triangles, drawCalls }`; `false`: none.
- **The governor** runs with a budget. Ten frames over it (within a short while) step detail down one rung; 120 frames with room step it back up, waiting twice as long each time a step up is soon undone. The world's ladder, in order:
  1. `detail`: ¾, then ½ (coarser levels sooner, fewer copies over time);
  2. `shadows`: half, a quarter, off;
  3. `quality`: lite;
  4. `resolution`: the pixel ratio, down to a floor (`resolution: { floor }`, default 1.5).
- **Priorities** say what goes first and what never: `priorities: { drop: ['parked'], keep: ['cars'] }` (`w.setPriorities` changes them). Each name is a rung of the world's or an element's id. A dropped element steps its own detail (¾, ½, ¼); it is never hidden. Hiding is your call, on the `governor` event.
- **A still view draws nothing.** Frames are drawn when something changes, loads or animates; after 500 ms of stillness the loop rests. `w.invalidate()` asks for a frame after a change aslnut cannot see.
- **Memory:** `memory: { limitMB, evict }` holds the loader's decoded tiles and data; the least seen go first.
- **Telemetry:**
  - `w.telemetry()`: frame ms (median, p95), main-thread and chip ms, draws, triangles, graphics MB, tiles, what is loading, what the governor dropped, the quality and why, and each element's share.
  - `w.governor`: the budget and what is dropped now; the `governor` event says each step.
  - `w.frameProfile()` and the `long` event: where a slow frame's time went.
  - `log: url` sends a phone's errors, governor steps and long frames to your server as JSON lines (section 5).
- **On your side:** give the canvas the box it needs, not more; keep `pixelRatio` unset; never draw a second world under a hidden tab; and show `w.reason` somewhere a tester can read it.

## 7 · Checking your wrapper

Run the repository's own checks once on your checkout, then the same kind of check on your wrapper.

| check | command (from `packages/aslnut`) | what it proves |
|---|---|---|
| types | `npm run check` | the source and the examples type-check; every WGSL shader has its GLSL twin |
| unit tests | `npm test` | the library in Node: headless worlds, data, formats, the docs' `llms.txt` current |
| smoke | `npm run examples` then `node tools/smoke.mjs` | a world renders, settles, picks, disposes, on WebGPU **and** WebGL2 |
| parity | `node tools/parity.mjs` | the same frame on WebGPU and WebGL2, pixel by pixel (`.out/parity/`) |
| regressions | `node tools/checks.mjs` | what software rendering once let through, on both |
| recipes | `node tools/checks.mjs recipes` | the authoring guide's six recipes render, settle and ask nothing from outside |
| performance | `node tools/perf.mjs` | frame times, uploads, heap and time to settled, on both |

The browser tools run a headless browser through `playwright-core` (`tools/browser.mjs`). `ASLNUT_GPU=swiftshader` runs WebGPU and WebGL2 on any machine with no GPU; `gpu` uses the machine's own.

**Your wrapper's own checks:**

1. **Both graphics, the same picture.** Mount your component twice, with `graphics: 'webgpu'` and `graphics: 'webgl2'`. `await w.settled({ strict: true })`, read `await w.frame()` from each, and compare the pixels. Reuse `launch`, `openDemo`, `settledFrame` and `bytesOf` from `tools/browser.mjs`.
2. **A restyle is not a rebuild.** Change one colour through your props. The element in `w.list` must be the same object as before, and the `elements` event must say `props`, not `remove` and `add`.
3. **No leaks.** Mount and unmount your component ten times, then read `liveGraphics()`: `graphics`, `buffers`, `textures` and `bytes` must be back to zero. A count that grows from one world to the next is a leak.
4. **Server-safe.** Import your package in Node with no DOM and render your component on a server: nothing may touch `window` until mount.
5. **No machine paths.** Your wrapper, its tests and its docs name no home folder, drive or workspace. Take paths and browsers from the environment, as the tools do (`PLAYWRIGHT_CORE`, `CHROME`, `GPU_CHROME`, `ASLNUT_GPU`, `PORT`), data from a `data/` folder or a URL, and URLs relative to the page.

## 8 · Licence and credits

- **aslnut is Apache-2.0.** Ship `LICENSE` and `NOTICE` with anything that contains aslnut's code. Keep every copyright, patent and attribution notice. Mark the files you changed. `NOTICE` also carries the notices of the code aslnut includes (MIT): keep them.
- **Your own code may use another licence.** A wrapper that imports aslnut is your work; only the aslnut files inside it stay under Apache-2.0.
- **Data credits stay on screen.** Every world shows the credits of what is shown, in a corner of the canvas (`attribution`: position, class, format). `attribution: false` is only for an app that shows `w.attribution()` itself, always. Never crop or hide them.
- **Recordings carry them too:** `w.record({ attribution: true })` and `w.frame({ attribution: true })` burn the credits into each frame.
- **Terms are capabilities** on every provider (`show`, `prefetch`, `keep`, `export`). The loader refuses what a source's terms forbid (`E-LOAD-002`). The defaults and each service's terms are in [DATA-LICENCES.md](../DATA-LICENCES.md):
  - Esri imagery and OpenStreetMap's tiles are **show only**: drawn while looked at, never prefetched, never kept, never packed.
  - Sentinel-2 cloudless (EOX, CC BY 4.0) and the Mapzen terrain tiles may be kept and exported, with their credits.
- **Frames you record are yours to clear.** The loader keeps a show-only source out of packs and caches; a recording of it is not checked. Use a source that allows `export` (or hold a licence) before you publish video of it.
- **Your own data** carries its own credit: `attribution` on the source or provider. Your own terms use the same capabilities.
