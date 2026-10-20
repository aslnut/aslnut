# Changelog

## 0.1.6

- **A coarse terrain tile no longer freezes a page with baked roads:** `clampTerrain`'s heights walked every 500 m cell of the asked tile's own footprint to find the pack's clamp tiles, so a z2 tile (a quarter of the globe, which the surface asks for on the way down) was some 270 million steps on the main thread: a single frame of over a minute. It walks only the cells within the pack's own tiles now (their box, from the index once); every level gets the same heights as before.

## 0.1.5

- **Orbiting over terrain no longer stalls the street level:** each terrain tile that loaded or refined while the camera moved made every solid (buildings, trees, shapes on the ground) check its ground again everywhere, on the main thread. The terrain now tells where its heights changed (`w.groundChangedSince(v)`: boxes, `[]` nowhere, `null` when not known; optional on `WorldLike`), and while the camera moves a chunk whose square no changed tile meets keeps its ground; once the camera rests every chunk passed over that way is checked again, so a change no box told of (a tile let go, a level switch) still reaches it. A chunk's ground holds while no probe moved by more than half a pixel at its distance (never less than 2 cm), and one chunk near the eye is read whole a frame beyond the frame's budget (it was three). Measured orbiting a suburb-sized scene: ground reads 29 % → 7 % of the main thread, the 95th-percentile frame 17.9 → 10.2 ms.
- **The baker:** a degenerate face whose band line comes out empty is skipped (the bake panicked dividing by zero in `assemble`).

## 0.1.4

- **A feature is drawn where its own row says, whatever other rows come, go or move:** new data that moved a layer's origin (the middle of its data's box) drew the arcs it kept that far off (arcs off their houses by hundreds of metres, shifting with each batch), and a line or area whose build ran over frames drew its old shapes from the new origin meanwhile (kilometres off for those frames); the view's offset is now from the origin of what is drawn, and kept arcs take their ends from the origin now. An arc whose end has no ground known yet waits (drawn as nothing; `readouts().waiting`) instead of standing at sea level and jumping up when the ground comes; an end whose ground goes unknown stays where it was.
- **Park access (the healthy-city example):** a tile's arcs leave when the tile is let go and come back with it. If you copied `examples/healthy-city/park-access.ts`, take this version.

## 0.1.3

- **Params by level:** any prop of any element can be given per observation level, `size: { level: { district: 6, street: 14 } }` (a rung not named takes the nearest named coarser one, else the nearest finer), applied once a level change through the element's own `setProps` (only what changed; `el.byLevel` keeps the specs, `E-LEVEL-002` for a rung not on the ladder); a raster field's `res` and `area` can now change after it is made (by level or `setProps`): a new grid, its state carried over, on WebGPU, WebGL2 and the CPU.
- **Surface fields:** `field({ kind: 'surface', on, values })` shows a value at every point of walls and roofs, drawn by the buildings' or solids' own draws (no extra draw), on WebGPU and WebGL2; values per vertex or your function of the thing, its facet, its normal and its place (asked once when a mesh is made); `.set` writes only the chunks that changed; `.at`, probes and a legend.
- **Epochs:** `data.epochs([{ at, source }], { blend })` plays one dataset per time on the world's clock (replay, seek, a time slider): features, raster grids and surface values; `'morph'` blends grids and surface values on the chip; loaded near the time, a few held, shown in `w.telemetry().epochs`. Raster fields take `data: epochs` instead of a rule.
- **Field surfaces lying on the ground** with no least value drawn are no longer see-through.
- **OffscreenCanvas:** a world runs on an `OffscreenCanvas` on the page (it threw: controls were put on it) and in a worker, on WebGPU and WebGL2; `examples/offscreen` shows both, `tools/checks.mjs offscreen` checks them.
- **A sign added later:** `layer.setProps({ line: { … } })` adds a sign the layer did not have (it was ignored): made from its data, in its place, attached at once; labels added later join the world with it.
- **Roll-ups and joins let go:** `tree.rollup` and `shapes.join` stop following their inputs when the last layer using them is removed or the world disposed (they were followed for ever), follow again when a layer takes them up, and catch up when read meanwhile; `source.close()` for one used without a layer; `source.watching` counts what follows a source. A layer's sources open and close with what they are made from (a stream inside a roll-up too).
- **Constants per world:** `w.constants` is a world's scope of the citable tables: what is added there stays that world's (`constants.add` stays the process's, as documented); `constants.scope()` makes one of your own; `cityHeat(tiles, { constants })` takes a scope's materials. An entry added in part keeps its other values.
- **Houses:** the neutral house's garage is checked at every level for every side, roof and size (a flat-roofed two-storey house with its garage at its left drew it; it stood behind the house in a view of its back). The docs say which way its front faces (the heading: 0 is north).
- **Sun shadows on a flat floor:** `plane({ sky })` takes a sky of yours as `earth({ sky })` does (`sky()`: the sun lights the floor and casts shadows on it). The sun's shadow map is drawn again when a caster's texture changes (textures count their changes: `GTexture.version`, on WebGPU and WebGL2); a map drawn while copies were fading in was kept speckled, so shadows of shapes barely showed.
- **`w.unproject([x, y])`:** a point on the canvas to the place on the ground (the inverse of `project`, on the flat map, the globe and a tilted view).
- **`w.on('view')`:** the view began to move, moved, came to rest; whether it zoomed, and whether a person's hands or the app moved it.
- **Each feature's order inside its layer:** `feature: { order }` on points, icons, lines and areas.
- **Rows of any shape:** `rows.upsert` and `rows.patch` take features `{ id, props, geometry }`; a patch keeps the geometry it does not give.
- **Icons:** an anchor on the place, a size per axis (or by the picture), an atlas that grows (`atlas.add`).
- **Tile URLs:** `raster.xyz` takes `subdomains`, `tileSize: 512`, `zoomOffset`, a URL function and `errorUrl`.
- **The map's hands:** `controllers.orbit({ bounds, viscosity, zoom: { wheel, pinch, keys }, snap, step, keys })`.
- **Lines:** dashes and their offset per feature (up to two pairs), caps and round joins on the ground.
- **Points:** each feature's own outline colour and width.
- **Pictures over a box** answer taps when `pickable: true`.
- **`frame: 'pixels'`:** a zoom is a 2D web map's at the canvas's own pixels.
- **A settled view stays still:** `settled()` waits for the ground the view falls back on (its tiles' coarser ancestors) while it loads or its heights are on the way; they came up to a second after the view settled, and the next frame drawn for anything (your `everyFrame` work) had the water read the ground again for several frames. It also waits for draped areas and lines measuring their pieces' ground ranges (they did that up to a second after it settled, a few frames on a still view).

## 0.1.2

- **Streams close with their world:** `dispose()` (and removing the last layer that uses a stream) closes a `data.stream`, its socket and its reconnect timer; a layer that takes the stream up again opens it again.
- **Format versions:** history logs and baked road chunks say their version; an unknown one is refused (`E-DATA-004`) instead of misread.
- **Decode workers:** a worker that fails rejects its pending requests (`E-LOAD-006`) and leaves the pool; the others keep working.
- **PMTiles across origins:** a partial answer without a readable `Content-Range` is accepted when it has exactly the bytes asked; otherwise the error names `Access-Control-Expose-Headers: Content-Range`.
- **Examples:** an unknown `?go=` shows a message listing the presets, instead of the default scene.
- **Docs:** packs, `when`, the governor's order, the nearest default (300 m) and the hosting imports match the code.
- **Checks:** the everyFrame frame count is measured over its real window.

## 0.1.1

- **Live data without blinks:** cards keep their room (a shown card yields only when mostly covered for a while, and comes back no sooner than a set time); card state is kept by item id; only changed cards are worked out again, on the world's clock; `w.settled()` resolves while data streams.
- **Cards:** text rows and a width per card.
- **Step values** in history logs, so a state never blends through other states.
- **Draping 'ground'** paints only what lies on the ground, never what stands on it.
- **Moving sets:** a folded thing reappears the moment its window ends; only changed chunks are put; buffers are freed only after the frame is sent.
- **React:** `aslnut/react` (`<World>`, `useWorld`, `useElement`, `useWorldEvent`), elements kept in step by id; `shell(w)` for other hosts.
- **Cars:** rounder passenger bodies, each row its own type; a `tailRake` param.
- **Read-back:** a texture is read back only when made to be; an unreadable one is refused on both graphics.
- **Docs:** a guide for third-party implementers (`packages/aslnut/docs/implementers.md`).
- **Tools:** an unknown preset is refused by name; checks no longer need build-time settings.

## 0.1.0 (2026-10-19)

The first public version: the foundation of a world engine for the web, used from source (an npm package comes later). Every part and its status is in [STATUS.md](STATUS.md): 238 of 545 parts built and 37 partly (47% overall).

- **The foundation, orbit › observation › data › viz.** The camera only moves the picture. Observation levels (world › country › region › city › district › street › building › room) change past a margin and after a dwell, and keep the old data a while. A layer is one dataset said one way: its signs, its labels and its legend. Scales take their classes from the whole data. A join redraws only what changed.
- **Both graphics.** WebGPU and WebGL2 as equals, chosen by `graphics: 'auto'` (WebGPU, then WebGL2, and why). Your shaders are written once in a WGSL subset and translated for WebGL2. Parity checks compare the same frame on both. Worlds also run headless in Node.
- **Data.** XYZ, WMS, WFS, PMTiles, MVT, GeoJSON, CSV, streams and sources of your own; rows, joins and queries; live updates, history logs and scenarios. Each source carries its terms, the loader keeps them, and credits are always shown.
- **Marks.** Points, icons, text, lines, arcs, trails, areas, extrusions, rasters, drapes, and custom marks of your own shaders. Reveals, so nothing pops in.
- **The bricks.** One interface for a thing: `shape({ params, build })` with solids, extrusions, lathes, sweeps, meshes and copies; levels by the pixels a thing covers, with a margin; parts with joints driven by a rate, data or a formula; copies over time (smoke, steam); anchors and attachments; kinds and the traits every design of a kind carries.
- **Dashboards.** Cards over the world, legends, stats and a layer list; relations over time, groups per level, icons.
- **The Earth.** Imagery and terrain providers that compose (or a flat ground), an offline base, the atmosphere and haze, clouds, weather (rain, fog, wind), and the sun, moon and stars for the place and time. Water, and the sea with its shore and waves. Heat (UTCI) under the sun and in the shade.
- **A flat world.** `plane()` floors for games and interiors.
- **The built world.** Roads from baked packs (sections, markings, sidewalks, junctions, bridges and piers, the ground held under them), buildings from footprints (typology, roofs, windows, frontage), plants by species with their canopy, chargers.
- **The road baker.** `packages/baker`, in Rust: open road data in, baked road packs out.
- **Things that move.** Sets moved by their logs on the GPU, with trails. A car whose types are rows of numbers (a trailer turned at its hitch), drones, and people: bodies, skin, faces, hair, clothing, poses, gaits and crowds, walking on networks. Altitude for things in the air: each sample's height over the ground or the sea, pitch from the climb, bank into the turns.
- **The camera.** Views, keys and paths; moves (dolly, crane, arc, track, chase, reveal); a follow on critically damped springs; an acrobatic orbit in which only the picture moves; the eye kept over the ground.
- **Networks.** Graphs, routing, isochrones, nearest, walkways.
- **Tiles.** Surface tiles composed in a worker and kept in memory; a growing pool never shows a blank layer.
- **Settling and budgets.** `w.settled()` waits for a complete view and `w.report()` says what is pending. Budgets, a governor, memory limits, detail priorities and prefetch keep a phone smooth; a still view draws nothing.
- **Recording.** `w.record()` steps the world's clock a frame at a time: the same frames on every run.
- **The reference host.** `packages/server` serves and bakes mesh tiles and their PMTiles archives, with live edits.
- **Tools and checks.** Smoke, parity, perf, regressions, the suite, the recipes and the shader twins, each on WebGPU and WebGL2.
- **Docs.** The authoring guide with six recipes, llms.txt, the concepts, a reference page for every part, and the map.
