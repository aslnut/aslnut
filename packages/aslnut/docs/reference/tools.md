# tools

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist). a reference implementation of the compiler exists.

**In one line:** work that runs ahead of time, on the authoring machine, never on a visitor's phone: geo analysis, baking packs, **compiling** a world into chunks, converting heavy formats, exporting, and the command line and MCP server for people and assistants.

Concepts: [compile](../concepts/compile.md) · [formats](../concepts/formats.md) · [real-world authoring](../concepts/real-world-authoring.md) · [LLMs](../concepts/llms.md)

<!-- tree:reference/tools -->
```tree
tools/
├── geo
├── scan/
│   ├── classify
│   ├── align
│   ├── fit
│   ├── clean
│   └── grid
├── bake
├── compile/
│   ├── run/
│   │   ├── on-save
│   │   ├── command
│   │   └── page
│   ├── inputs
│   ├── steps/
│   │   ├── solve
│   │   ├── resolve
│   │   ├── mesh
│   │   ├── assign
│   │   ├── solids
│   │   ├── logic
│   │   └── manifest
│   ├── custom-steps
│   ├── options
│   ├── stale
│   └── outputs
├── convert/
│   ├── fbx
│   ├── ifc
│   ├── citygml
│   ├── las
│   ├── usd
│   └── i3s
├── export/
│   └── usd
├── checks/
│   ├── smoke
│   ├── parity
│   ├── twins
│   ├── regressions
│   ├── suite
│   ├── perf
│   └── recipes
├── catalog
├── cli
└── mcp
```
<!-- /tree -->

## API: geo and bake

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `geo` | `geo.fetch(source, bbox)` · `geo.buffer` · `geo.near` · `geo.zonal` · `geo.contours` · `geo.profile` · `geo.scarps` | `source: 'overture' \| 'osm' \| 'ghsl'` · `bbox: [w, s, e, n]` · per function | GeoJSON, rasters, numbers | [planned] (a research prototype exists) | `await geo.fetch('overture', bbox)` |
| `scan/classify` | `aslnut scan classify <in.laz>` · `scan.classify(cloud, opts)` | `--ground <csf \| pmf> = csf` (the bare-earth filter) · `--model <file.onnx>` (classes past ground) · `--keep <classes>` | a LAZ / COPC with ASPRS classes (2 ground, 3–5 vegetation, 6 building, 9 water, 17 bridge deck…) | [proposed] | `aslnut scan classify yarra.laz --out yarra.copc.laz` |
| `scan/align` | `aslnut scan align <in> --to <world \| ref>` · `scan.align(cloud, opts)` | `--crs <EPSG>` (the scan's frame) · `--gcp <points.csv>` (surveyed control points) · `--icp` (fine fit to a reference scan or the 1 m terrain) | the scan in the world's frame + a transform + the residual error in metres | [proposed] | `aslnut scan align drone.laz --to yarra.copc.laz --icp` |
| `scan/fit` | `aslnut scan fit <in> --kind <stairs \| wall \| terrace \| plane \| railing> --where <area>` · `scan.fit(cloud, kind, opts)` | `--where <geojson>` (the piece's rough footprint, e.g. from OSM) · `--max-error <m> = .03` | `Fit`: the piece's params (risers, tread, wall height and batter, planes) + residuals; the input to core › geometry › networks › structures | [proposed] | `aslnut scan fit yarra.copc.laz --kind stairs --where steps.geojson` |
| `scan/clean` | `aslnut scan clean <mesh.glb>` · `scan.clean(mesh, opts)` | `--delight` (remove baked shadows) · `--remove <people,cars>` · `--clip <footprint.geojson>` · `--decimate <triangles>` · `--levels` | a cleaned `.glb` with its footprint and its levels, ready for modules › earth › presets › built › buildings › landmarks | [proposed] | `aslnut scan clean vaults.glb --delight --remove people --decimate 150000` |
| `scan/grid` | `aslnut scan grid <cloud.laz>` · `scan.grid(cloud, opts)` | `--classes ground` (ASPRS 2, by default) · `--cell <m>` (0.5) · `--breaklines <lines.geojson>` (kerbs, wall tops and feet, step edges kept sharp) | a ground model (elevation tiles) for modules › earth › body/base › terrain › lidar | [proposed] | `aslnut scan grid cbd.laz --cell .5 --breaklines edges.geojson` |
| `bake` | `bake.pack(opts)` · `bake.tiles(opts)` · `bake.pmtiles(opts)` · `aslnut bake …` | `inputs: string[]` · `out: string` · `views?: View[]` (what to include) | packs, mesh tiles, PMTiles | [planned] (a research prototype exists) | `aslnut bake pack --views ./views.json --out ./packs/bandung` |

## API: compile

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `compile/run/on-save` | `studio({ compile: 'on-save' })` | `debounce?: ms = 1500` | a "compiled ✓ / compiling…" badge | [planned] | `studio({ compile: { debounce: 3000 } })` |
| `compile/run/command` | `aslnut compile <project> --out <dir>` | `--only <steps>` · `--changed` (only stale chunks) · `--workers <n>` | exit code; manifest written last | [partly] (roads: `npx tsx tools/compile/run/command.ts roads [place…]`) | `aslnut compile ./my-city --out ./compiled --changed` |
| `compile/run/page` | `compile.html` opened in any browser | `?project=<url>` | the same compile, in a page | [planned] | `/tools/compile.html?project=/my-city` |
| `compile/inputs` | `compile({ inputs })` | `authored: dir` · `raw?: { osm?, dem?, footprints? }` (never modified) · `shapes?: dir` · `terrain?: Terrain[]` | — | [partly] (roads: OSM ways as GeoJSON with node ids and tags, a ground grid) | `inputs: { authored: './authored', raw: { dem: './dem.tif' } }` |
| `compile/steps/solve` | step `solve` | `terraform?: boolean = true` | terrain + roads, rails, rivers fitted to it | [partly] (roads, in three stages: the line graph with its heights; the polygons (buffers unioned per level, corners closed, slivers dropped, junction zones); the kerb last; bridges, tunnels, islands, markings, the clamp) | `steps: { only: ['solve', 'resolve'] }` |
| `compile/steps/resolve` | step `resolve` | — | the ground stack: which ground piece wins where | [planned] | (in order) |
| `compile/steps/mesh` | step `mesh` | `shapes?: 'bake' \| 'live' = 'bake'` | triangles for every element and placed shape | [planned] | `steps: { mesh: { shapes: 'bake' } }` |
| `compile/steps/assign` | step `assign` | `chunk?: { near: 256, far: 1024, levels: 3 }` · `farWorthy?: (tri, layer) => boolean` | triangles in near chunks and far cells, far-worthy first | [planned] | `chunk: { near: 128 }` |
| `compile/steps/solids` | step `solids` | `tags?: Record<layer, tag>` | solid triangles in every chunk they touch | [planned] | (in order) |
| `compile/steps/logic` | step `logic` | `include?: ('clamp' \| 'walkways' \| 'lanes' \| 'holes' \| 'culverts')[]` = all | `logic.bin` | [planned] | (in order) |
| `compile/steps/manifest` | step `manifest` (always last) | — | `manifest.json`: version, input hashes, chunk ids and hashes | [partly] (roads: `index.json` with the kinds, sources, licences and the checks' report) | (always) |
| `compile/custom-steps` | `steps: { before?, after?: { [step]: fn } }` | `fn: (chunk \| ctx) => void \| Promise<void>` | — | [planned] | `steps: { after: { mesh: chunk => addMyDecals(chunk) } }` |
| `compile/options` | `compile(options)` | `out: dir` · `chunk?` · `layers?: string[] = ['solid', 'mark', 'water', 'buildings']` · `quantize?: { xz: 'auto', y: .02 }` · `workers?: int` | `Promise<Manifest>` | [planned] | `await compile({ inputs, out: './compiled', quantize: { y: .01 } })` |
| `compile/stale` | `compile.state(project)` | — | `{ current: boolean, changed: input[] }` (hashes vs the manifest) | [planned] | `if (!(await compile.state('./my-city')).current) …` |
| `compile/outputs` | the folder | — | `manifest.json` · `logic.bin` · `near/0_ix_iz.bin` · `far/1_ix_iz.bin` · `buildings/l0..l2` | [partly] (roads: 500 m tiles of typed pieces with heights (v3), `clamp.json` (v3 index of v4 numeric cell and outline tiles), `index.json`) | load road tiles with `bakedRoads({ url: './compiled/index.json' })`; the compiled manifest loader is planned |

**What is there today (roads).** The roads compile reads OSM ways (GeoJSON with node ids and tags, cut from a downloaded extract) and a ground grid, and works in three stages. **The line graph:** centre lines with their class and width, chained, their heights solved over the whole network (kept as the routing graph, never drawn). **The polygons:** every road buffered to its carriageway and kerb, cut where its level changes; each level's buffers unioned into one surface (close junctions, short connectors and ramps that leave together merge by themselves); each junction's concave corners rounded by a closing with the smaller road's radius (15 / 12.5 / 7.5 m); gaps under 1.5 m closed, slivers under 0.8 m and pieces and holes under 20 m² dropped; junction zones where buffers overlap, each planar. **The kerb last:** a band inward from each level's final outline, one continuous kerb round every block (a parapet on a deck, a wall in a cut). It writes 500 m tiles of typed pieces with heights, never triangles: areas (the surface in 20 m cells), edges, markings, piers, abutments, portals. The device triangulates and draws them; colours stay live. `clamp.json` holds the surfaces' cells and outlines the ground goes under (it only lowers). `index.json` carries the kinds, the sources with their licences, and the report the checks read: invalid outlines, slivers, kerb off the surface or across a road, z-fighting, junction zones, steep pieces, deck clearances. The polygons are made with Clipper2 (`clipper2-ts`, Boost Software License 1.0), at bake time only.

```
npx tsx tools/compile/run/command.ts roads clayton bridge   # bake two places into data/packs/roads/<place>/
node tools/roads.mjs                                         # check every place's bake and view, WebGPU and WebGL2
```

## API: convert, export, command line

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `convert/fbx` | `aslnut convert x.fbx --to glb` | `--anim` (keep clips) | `.glb` | [planned] | `aslnut convert truck.fbx --to glb` |
| `convert/ifc` | `aslnut convert x.ifc --to glb` | `--storeys` · `--props` (keep BIM properties as feature props) | `.glb` + props JSON | [planned] | `aslnut convert site.ifc --to glb --props` |
| `convert/citygml` | `aslnut convert x.gml --to cityjson \| pack` | `--lod <n> = 2` | CityJSON or a pack | [planned] | `aslnut convert city.gml --to pack` |
| `convert/las` | `aslnut convert x.laz --to pack` | `--classes <list>` · `--thin <m>` | a points pack (or 3D Tiles) | [planned] | `aslnut convert scan.laz --to pack --thin .1` |
| `convert/i3s` | `aslnut convert <scene.slpk> --to tiles3d` | `--layer <name>` | OGC 3D Tiles (I3S scene layers read as 3D Tiles) | [proposed] | `aslnut convert city.slpk --to tiles3d` |
| `convert/usd` | `aslnut convert x.usd --to glb` | — | `.glb` | [planned] | `aslnut convert plant.usdz --to glb` |
| `export/usd` | `aslnut export --to usd` · `w.export('usd', opts)` | `area?: Bounds` · `elements?: string[]` | `.usd` (licences permitting) | [planned] | `aslnut export ./my-city --to usd --area bbox.json` |
| `checks/smoke` | `node tools/smoke.mjs` | — (run `npm run examples` first) | exit 1 on a failure on either WebGPU or WebGL2 | [built] | `node tools/smoke.mjs` |
| `checks/parity` | `node tools/parity.mjs [presets]` | presets (default: every deterministic one) | the same frame on WebGPU and WebGL2, pixel-diffed; evidence in `.out/parity/` | [built] | `node tools/parity.mjs parity-globe` |
| `checks/twins` | `node tools/twins.mjs` | — | every WGSL shader has its GLSL twin with the same functions and literals; exit 1 otherwise | [built] | `node tools/twins.mjs` |
| `checks/regressions` | `node tools/checks.mjs [names]` | `names?`: the checks to run (default all but `recipes`; `recipes`, only when named: the authoring guide's recipes by `tools/smoke-recipes.mjs`, the network mocked) | what headless software rendering once let through (draped marks, blinks, motion, holes, idle frames, rejections…), on WebGPU and WebGL2 | [built] | `node tools/checks.mjs` · `node tools/checks.mjs recipes` |
| `checks/suite` | `node tools/suite-headless.mjs [--gpu real \| swiftshader] [--quick] [--only a,b]` · `node tools/suite-report.mjs [result.json]` | `--cpu <×>` · `--uncapped` · `--out file.json` | the performance suite at phone size, case by case against a reference map library | [built] | `node tools/suite-headless.mjs --quick` |
| `checks/perf` | `node tools/perf.mjs [demos \| gesture \| heap \| all]` | `PERF_GPU=real` · `PERF_DEMOS=…` | frame times, CPU, GC, uploads, draws, heap, time to first image and to settled, on WebGPU and WebGL2; budgets fail the run | [built] | `node tools/perf.mjs gesture` |
| `checks/recipes` | `node tools/smoke-recipes.mjs [names] [webgpu,webgl2]` · `node tools/checks.mjs recipes` | `names?`: the recipes (default all six) or `trials/<name>` (a script a model wrote: what it has, to score it) · `PORT` | each recipe renders on the graphics asked for, settles, draws a frame neither black nor flat, fails no element, makes no page error, asks nothing from outside unmocked (tools/recipes-mock.mjs answers the services, tiles, data and model), and has what it says; exit 1 on a failure | [built] | `EXAMPLES_KEEP_BUILD=1 npx vite build && node tools/smoke-recipes.mjs` |
| `catalog` | `aslnut catalog` · `catalog.search(text)` | `kind?: 'shape' \| 'recipe' \| 'source' \| 'preset'` | entries with licence, preview, example | [planned] | `aslnut catalog --kind recipe` |
| `cli` | `aslnut <command>` | `describe` · `check` · `compile` · `convert` · `bake` · `export` | exit codes; `--json` output | [planned] | `aslnut check ./shapes/wind-turbine` |
| `mcp` | `aslnut mcp --world <url>` | tools: `describe`, `add`, `set`, `fly`, `capture`, `query` | an MCP server for assistants | [planned] | `aslnut mcp --world https://example.com/my-world/` |

## Example

```ts
import { compile } from 'aslnut/tools';
await compile({
  inputs: { authored: './authored', raw: { osm: './osm', dem: './dem.tif' }, shapes: './shapes' },
  out: './compiled',
  chunk: { near: 256, far: 1024, levels: 3 },
  steps: { after: { mesh: chunk => addMyDecals(chunk) } },
});
```

## Open questions

- Should `tools` ship as one package with the command line, or one per tool?
- Compiled output for hosted apps: next to the app, or on a shared tile server?
