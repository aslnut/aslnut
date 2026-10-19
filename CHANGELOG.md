# Changelog

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
