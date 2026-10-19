# Compile: build the world once, stream it everywhere

> Draft under discussion. Planned in aslnut; a reference implementation exists and was measured.

**In one line:** the heavy work of turning authored data into meshes (solving roads, resolving the ground, building shapes) runs **once, on the authoring machine**, into small chunks plus a manifest. A visitor's phone only downloads and draws the chunks near the camera.

## Why

- **Boot time and frame cost should depend on what is near you, not on the size of the city.** A multiplayer online city game that built a whole city at boot measured 1.6 s of ground solving on the main thread and a 537k-triangle road mesh with no levels. Compiled, a view costs 250–390k triangles instead of 3.5M.
- **Building is a step that belongs to editing.** It runs once per edit, never on every visitor's device.
- **The same code builds both ways.** The compiler uses the same build code as live building, so a compiled world and a live-built one are identical (a reference implementation checked 507 ground samples: equal).

## The rules

1. **When it runs:** at edit or build time, on the authoring machine. Three ways: automatically after you save (debounced), from a command line, or from a compile page in any browser. **Never on the visitor's phone.**
2. **Live building stays.** If the compiled world is missing or out of date, aslnut builds live, as it does today. You can force either with `world(canvas, { build: 'compiled' | 'live' | 'auto' })`.
3. **Inputs are never changed.** Raw sources (OSM, a DEM) stay untouched; authored data sits beside them.
4. **The manifest is written last,** with a hash per chunk, so a visitor never sees half a compile.
5. **Stale detection:** the inputs are hashed and compared with the manifest's. The studio shows "compiled ✓" or "compiling…".
6. **Only what changed is rebuilt and reloaded:** a chunk whose hash didn't change is not rebuilt or swapped.
7. **Configurable like everything:** chunk sizes, levels, layers, quantization, and your own steps as functions.

Plain meanings: **chunk** = a square piece of the world's meshes (256 m by default); **far cell** = a bigger square (1024 m) holding only what's worth seeing from far; **quantization** = storing positions as small whole numbers (to the millimetre) instead of full decimals, so files are about 2.5× smaller; **solids** = the triangles you can stand on or bump into (physics).

## Inputs

```tree
inputs/
├── authored/
│   ├── roads
│   ├── ground
│   ├── landmarks
│   └── placements
├── raw/
│   ├── osm
│   ├── dem
│   └── footprints
├── shapes/
└── terrain/
```

## Steps

```tree
compile/
├── solve
├── resolve
├── mesh
├── assign
├── solids
├── logic
└── manifest
```

| step | what happens |
|---|---|
| `solve` | the terrain plus your terraforming; roads, rails and rivers solved against it |
| `resolve` | the ground stack: which ground piece wins where (road over grass over soil) |
| `mesh` | every element and every placed shape built into triangles (shapes use their `build`; see [shapes](shapes.md)) |
| `assign` | each drawn triangle → its near chunk (by its centre), quantized, and ordered `far-worthy` first, then `detail`; far cells take the far-worthy triangles of their chunks |
| `solids` | triangles you can stand on or hit (decks, channels, barriers) → every chunk they touch |
| `logic` | one small global pack: surface heights for clamping, walkways, lanes, holes, culverts: what agents and traffic need |
| `manifest` | written last: version, input hashes, every chunk with its hash |

## Gates and patches

Every stage ends in a **gate**: hard checks on what the stage produced. A failed check never passes silently. It runs that check's **patch policy**:

| policy | what happens | recorded as |
|---|---|---|
| **repair** | a named algorithm fixes the piece; the original stays in the source | `patched: '<algorithm>'` + what moved and by how much |
| **omit** | the piece is left out of the world | `omitted: '<check>'` + the source id |
| **stop** | the bake fails with the place, the stage, the check and the ids | the failed report |

**Policies are per check, with defaults, and every policy is yours to change** (`compile({ patch: { 'deck-clearance': 'stop' } })`, or a function of the piece). Patches are data:
- the bake report lists them per stage, with counts and the worst values;
- each baked feature carries its patches, and picking shows them next to its source ("OSM way 123 · patched: clearance-raise +0.8 m");
- a re-bake with the same inputs and policies patches the same way (deterministic).

**The default policies** (the ready-made road and building pipelines):

| check (stage) | default | the algorithm |
|---|---|---|
| deck clearance below the limit (5) | repair | **clearance-raise**: add the clearance as a constraint and re-solve the deck's vertical profile, with the vertical curves lengthened to keep K |
| vertical curve below the K limit (5) | repair | **curve-lengthen**: move the curve's start and end apart until K holds; if the road is too short, use the absolute-minimum K and flag it |
| vertical solve not converging (5) | repair, then stop | **relax-in-order**: drop soft targets (ground following, then grade preference) one by one; stop if the hard constraints still conflict |
| two levels overlapping within 0.5 m (7) | repair | **level-separate**: move the piece that is further from the ground by half a level; if it can't move, merge the two into one level |
| kerb across a road (8) | repair | **kerb-clip**: cut the kerb where it lies inside another surface |
| footpath over a road (9) | repair | **path-clip**: subtract the road surface from the path; omit the path if under 1 m² is left |
| pier on a lower road (10) | repair | **the five pier rules** in order: shift, median pier, side pier, straddle portal, standard |
| deck detached from its approach (8) | repair, then stop | **seat-continuous-approach**: join the full-width abutment plane to the connected vertical profile; retain one surface owner across the seam |
| footpath steeper than 1:12 (9) | repair, then omit bank facets | **split-at-unwalkable-grade**: test the final walking facets in their steepest direction; a footpath beside a road may take that road's grade along it; up to 1:4 is kept and flagged for route design; steeper (a bank) is omitted and recorded; never invent a straight climb up a bank |
| footbridge end above the ground (9) | repair, then stop | **lift-mapped-approach-or-generate-switchback**: a walkway beside a road deck takes that deck's height; mapped steps joined to the end are built as steps; a joined footway is lifted on an accessible ramp profile (at most 1:14, a 1.5 m level landing after every 9 m) until it meets the ground; where nothing is mapped, a switchback ramp (else a flight of steps) is generated on road-free land and recorded. No access towers; every elevated walking line is checked at 1:14 (steps excepted) |
| carriageway facet steeper than 1:4 over a step of 0.75 m (8) | repair, then stop | **open-seam-to-ground**: refine the union's cells to 2.5 m where their triangles would span a height step between two touching roads, then cut the remaining seam out of the surface so the composed ground shows as the bank between them |
| support outside the deck it carries or above its soffit (10) | repair, then stop | **move-under-carried-deck**: validate the whole column and cap footprint against the final deck; try station shifts and the pier rules with the deck footprint as a hard bound |
| structure solid in a lower road's full-width 5.5 m envelope (11) | repair, then stop | **shorten-or-split-span**: intersect the quantized road facets with each solid's horizontal footprint and vertical bounds; shorten or split walls, skirts and girder spans around the envelope, and recheck every remaining piece. Essential conflicting columns stop publication |
| support cap away from the final deck (10) | repair | **seat-on-final-soffit**: use the triangulated upper deck for the beam seat; use the lower road only for the beam direction |
| slope over the limit (11) | repair | **wall-promote**: a retaining wall instead of the batter slope |
| exposed carriageway covered by terrain or a low piece (11) | repair, then stop | **clamp-facets-and-clip-cover**: test quantized facet interiors against interpolated terrain and other surfaces; lower the covering terrain samples, clip optional covering walking, turf, stair or water surfaces, or stop if a low road/structural piece still covers it. Declared elevated footprints are excluded from the exposed-road check and remain subject to the deck and footbridge clearance gates. An unresolved cover stops publication. The omit policy removes an optional covering path, turf piece, stair tread or water ribbon; a terrain contract cannot be omitted while leaving its road covered |
| no property line within 40 m of a house (12) | omit | **no-property-line**: the house keeps no plot (no frontage); the house itself stays |
| plot in the reserve, over another building, or over a neighbour's plot (12) | repair | **plot-clip**: take the reserve, the building or the neighbour's plot out of it (a plot is made as the house's span along its property line, 1.5 m wider each side, back to 3 m behind it; clipped out of the reserve; split with each neighbour along the bisector of their buildings; clipped off the buildings crossing its edge: what the gate then still finds is patched) |
| building in the road reserve (13) | repair, then omit | **footprint-clip** if under 15 % of the footprint is in the reserve, else **setback** up to 3 m (never onto a path, water or a new overlap); omit if neither fits |
| building on a path mapped outside the reserve (13) | repair, then omit | **footprint-clip** under 15 %; omit otherwise. A building open at the ground (a roof, a shelter, a station's canopy, a car park) may stand over a path |
| building on water (13) | repair, then omit | **footprint-clip** under 15 %; omit otherwise |
| buildings overlapping (13) | repair, then omit | **overlap-clip**: the smaller loses what the larger covers, if half of it is left; omit otherwise |
| ground above a building's floor (13) | repair | **pad-raise**: lift the floor over it (the pad is first cut into the ground; ground beside a road, path or water is never cut) |
| a foundation's foot above the ground (13) | stop | **skirt-to-lowest-ground**: the foundation reaches 0.3 m under the lowest ground along the walls (by construction; a failure stops) |
| tree on a carriageway, kerb, footpath, path, structure, water or building (14) | repair, then omit | **nudge** within 2 m: onto a nature strip if it stood in the reserve, else off the reserve; omit otherwise. The crown may overhang |
| tree with no height (14) | omit | the data gives nothing to draw |
| furniture or pole where its kind may not stand (15) | repair, then omit | **nudge** within 2 m; omit otherwise. Poles and lamps keep off carriageways, kerbs, footpaths and paths; benches, bins, bus stops and the like off carriageways and kerbs; bollards and hydrants only off structures and water. All keep off buildings |

**Measured data is never patched silently.** A patch changes the baked world, never the source, and is always visible as a patch.

### Placement, not looks

Stages 12–15 decide **where things stand, never how they look.** Their output is placement data:
- per building: its footprint (clipped or set back), its pad (the floor's height and the foundation's foot), its front (the property line's point and direction) and plot, a seed, and its source attributes (class, height and where the height came from);
- per tree: its place, height, crown and seed;
- per piece of furniture: its kind, place and seed;
- per piece, its patches; per place, what was left out and why.

The look is chosen when it is drawn, with the same public API as anything else: `shape({ params, build })` → `entities({ shape, data, params })`, or a preset (a procedural house, a species of tree). So a new house style, a variation of a preset or another tree species needs no re-bake. A look that needs more room than its footprint fits itself inside the baked footprint, pad and plot when it is drawn; it never moves them.

## Outputs

```tree
compiled/
├── manifest.json
├── logic.bin
├── near/
│   └── 0_ix_iz.bin
├── far/
│   └── 1_ix_iz.bin
└── buildings/
    ├── l0
    ├── l1
    └── l2
```

```tree
chunk/
├── header
│   ├── magic
│   ├── level
│   ├── ix
│   ├── iz
│   ├── centre
│   ├── y0
│   └── scales
├── layers/
│   ├── solid
│   ├── mark
│   ├── water
│   └── buildings
├── per-layer/
│   ├── positions
│   ├── normals
│   ├── colours
│   └── far-count
└── solids/
    ├── positions
    ├── normal-y
    └── tag
```

| part | how it's stored |
|---|---|
| positions | 3 whole numbers per corner (x, z to 7.8 mm in a 256 m chunk; y to 2 cm) |
| normals | 4 tiny numbers per corner |
| colours | 4 bytes per corner |
| far-count | a far cell draws only the first `far` triangles of each layer; a near chunk draws them all |
| per corner | 14 bytes, against 36 as plain decimals |

## At run time

```tree
runtime/
├── boot
│   ├── manifest
│   └── logic-pack
├── streamer
│   ├── quadtree
│   ├── split
│   ├── keep-parent
│   ├── fetch-queue
│   ├── decode-budget
│   └── unload
├── solids
└── hot-swap
```

1. **Boot:** load `manifest.json` and the logic pack. Agents, traffic and terrain workers run from the logic pack unchanged.
2. **Stream:** a quadtree over the far cells. A cell splits into finer chunks when the camera is close enough (900 m → 512 m cells, 300 m → 256 m chunks, × the quality setting). The cell you stand in always splits, so its solids are there.
3. **No holes:** a parent stays drawn until all its children are ready, with a short dithered cross-fade.
4. **Budgets:** at most 4 fetches at once; decoding and mesh creation take a fixed slice of each frame.
5. **Hot swap:** when the manifest changes, only chunks whose hash changed are fetched again.

## Examples

```ts
// 1 · compile from the command line (or let the studio do it after each save)
// $ aslnut compile ./my-city --out ./compiled

// 2 · the same, as code, with your own settings
import { compile } from 'aslnut/tools';
await compile({
  inputs: { authored: './authored', raw: { osm: './osm', dem: './dem.tif' }, shapes: './shapes' },
  out: './compiled',
  chunk: { near: 256, far: 1024, levels: 3 },
  layers: ['solid', 'mark', 'water', 'buildings'],
  quantize: { xz: 'auto', y: .02 },
  steps: { after: { mesh: (chunk) => addMyDecals(chunk) } },   // your own step, a function
});

// 3 · use it in a world; live building is the fallback
const w = await world(canvas, {
  body: earth(),
  build: 'auto',                                   // compiled if current, else live
  compiled: data.pack('https://…/compiled/manifest.json'),
  stream: { split: [900, 300], dropFar: 4000, fetches: 4 },
});
```

## How it relates

- **[Data](data.md):** compiled output is a **pack** for the loader; it records, replays and works offline like any pack.
- **[Shapes](shapes.md):** placed shapes are **baked** into chunks at the `mesh` step; their parts that move stay live.
- **[Observation](observation.md):** the streamer is observation's near/far for compiled worlds; its loaded chunks show in the observation panel.
- **[Performance](performance.md):** the main way to run a whole city on a phone.
- **[Lanes](../reference/core/runtime.md):** the compiler runs in workers on the authoring machine or as a command; never in the visitor's frame.

## Common mistakes

- **Compiling on the phone.** If it's slow there, it belongs in compile.
- **Editing compiled files by hand.** Edit the inputs; compile again.
- **Dropping live building.** It is the fallback while a compile is stale, and the way to check that the two agree.

## Open questions

- Should the logic pack also be chunked (per 1 km) for twins much bigger than one city?
- Where does compiled output live for hosted apps: next to the app, or on a shared tile server?

## Status

| part | status |
|---|---|
| everything on this page | [planned] in aslnut |
| compiler page, command line, chunk format, logic pack, quadtree streamer, hot swap, stale badge | a reference implementation exists |
| packs in the loader (record / replay / offline) | [built] |
