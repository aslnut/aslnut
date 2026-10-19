# Real-world authoring: scans in, pieces out

> Draft under discussion. Interface and structure only. Every aslnut part on this page is named by its id in the one tree (`docs/_tree/spec.txt`). Statuses are copied from `STATUS.md` on 2026-10-13.

**In one line:** nobody sculpts a real place by hand. The place is **scanned**, and the scan is **positioned** in the world. The world is then rebuilt from **semantic, parametric pieces fitted to that scan** (a stair, a quay wall, a terrace). The few **unique landmarks** come in as **cleaned scan meshes**. Each piece **owns the ground under it**, so the terrain is cut, filled and flattened as a consequence, never as a manual step.

## Why

- **Hand terraforming does not scale and is never true.** A person dragging the ground into shape guesses. A scan measures.
- **A raw scan is not a world.** It is one surface with no meaning. It has no steps to count, no wall to lean on, no railing to stop a fall, and no deck a train can run on. People, physics, routing and light all need meaning.
- **The same few techniques recur.** Whole-planet simulations, game cities and national city models all layer them. This page lists them, shows how they are layered, and maps each one to aslnut's parts.
- **One world, many screens.** The same API serves a script, an assistant and a studio. Nothing is built only in a studio.

## The principle

1. **The scan is the truth to fit to.** Point clouds and elevation models are measurements. They are the reference, not the product.
2. **What enters the world is semantic and parametric.** A flight of steps is `risers`, `tread` and `width`, fitted to the scan. It can be walked, routed, lit, edited and shown at any level of detail.
3. **Cleaned scan meshes only for unique landmarks.** A heritage bridge or a vaulted bar cannot be described by a few numbers. It enters as a mesh, cleaned, with its own footprint.
4. **Pieces own their ground.** Every piece has a footprint and a ground contract (cut, fill, clamp, flatten, keep), and the terrain under it follows. A landmark removes whatever was generated below it.
5. **Edits are diffs over source data.** A source update (a new scan, a new OSM extract) is applied under the edits, never over them.

## 1. The techniques

They are grouped by what they make. "Terms" means the terms of the data or the tool, as far as they limit what you may build and ship.

### 1.1 Capture: measuring the real place

| technique | input | output | strengths | limits | terms |
|---|---|---|---|---|---|
| Aerial photogrammetry (city scale) | overlapping oblique and nadir aerial photos | one textured mesh, streamed as tiles | looks real from the air; covers whole cities | one surface with no meaning; trees, cars and people melted in; poor at street level; heavy | the provider's; commercial services are usually show only |
| Ground and drone photogrammetry | photos from the ground or a drone | textured mesh, dense points, DSM / DTM, orthomosaic | cheap capture; real textures; great for one landmark | shadows baked in (de-lighting removes them); holes; scale and position need control points | free and paid tools; the output is yours |
| LiDAR (airborne, mobile, terrestrial) | laser returns | point clouds in LAS 1.4, LAZ (lossless, 7–25% of the size) or COPC (one LAZ file in a clustered octree, read over HTTP ranges); ASPRS classes per point | true geometry under trees; centimetre precision; classified | no texture unless a colour pass is added; big files; needs classification and registration | open where governments publish it (CC BY is common); LAZ 1.4 became an OGC community standard in 2026 |
| Elevation models from LiDAR | classified points | DTM (bare earth), DSM (the top surface with roofs and crowns), breaklines | the right ground for a whole region | 1 m blurs steps, kerbs and wall tops; a DSM includes trees and roofs | often CC BY, but not always: Victoria's 1 m DEM is restricted and paid |
| Gaussian splatting and radiance fields | photos or video | a radiance field, or millions of 3D Gaussians drawn at 100+ fps | photoreal, view-dependent, fast to capture | no meaning and no clean surface for physics or routing; lighting baked in; hard to edit and relight; large | the original reference code is for non-commercial research only; check each implementation |

### 1.2 Streamed city meshes and their formats

| technique | input | output | strengths | limits | terms |
|---|---|---|---|---|---|
| Commercial photoreal 3D tile services | the provider's own capture | OGC 3D Tiles with glTF meshes, from a tile API | populated areas worldwide in one source | not survey-grade: cars and awnings melt into the mesh, trees float; heavy on phones | typically show only: no pre-fetching, storing or caching beyond the cache headers, no offline use, no analysis or extraction of geodata, nothing traced or derived from the meshes (measuring counts), the provider's logo and credits always visible. A backdrop, never a foundation |
| OGC 3D Tiles 1.0 / 1.1 | photogrammetry, buildings, point clouds, BIM / CAD | a tileset: a tree of tiles with a geometric error; 1.1 adds glTF content directly, metadata and implicit tiling (a declared quadtree or octree) | open standard; streams any size | a format, not a method; meaning only as far as the metadata goes | OGC community standard (1.0 approved in 2018) |
| Hosted 3D Tiles services and global OSM building tilesets | uploaded scans, models, terrain; OSM | hosted 3D Tiles; hundreds of millions of OSM buildings (a few metres per level where the height is missing) | turnkey hosting and tiling | a service; the OSM buildings are boxes where tags are thin | hosting: commercial, often with a free tier; OSM buildings: ODbL |
| OGC I3S (Indexed 3D Scene Layers) | the same kinds of content | 3D objects, integrated mesh, points, point clouds, building scene layers; SLPK packages | open spec | few tools read it | OGC community standard (2017); spec text CC BY-ND 4.0 |

### 1.3 City models from data

| technique | input | output | strengths | limits | terms |
|---|---|---|---|---|---|
| ML footprints and heights from imagery | satellite and aerial imagery | footprints with heights (2.5D), in open datasets of a billion and more buildings, and in merged building datasets | covers the whole planet; good enough from the air | boxes, guessed roofs, guessed heights; wrong at street level | the open datasets: permissive data licences; merged datasets with OSM in them: ODbL |
| CityGML LoD0 to LoD4, CityJSON | footprints, LiDAR, surveys | semantic city models. LoD0 footprint, LoD1 flat-roof block, LoD2 roof shapes and themed surfaces, LoD3 doors and windows, LoD4 interiors (CityGML 2.0). CityGML 3.0 drops LoD4 and lets any LoD carry interiors. CityJSON 2.0 is the compact JSON form (about 7× smaller) | semantic (walls, roofs, bridges, tunnels); open | LoD3 and above are rare; the XML is big | OGC standards; data licences vary |
| National open city models | aerial surveys and LiDAR by mapping agencies and local governments, updated every few years | CityGML or CityJSON for a whole country (also 3D Tiles and vector tiles); mostly LoD1 and LoD2 (some with sloped roof planes), LoD3 in a few places | national scale, semantic, open, often automatic and validated | one country each; uneven LoD; often buildings only | open licences, often CC BY 4.0 or compatible; credit required |

### 1.4 Procedural generation and assembly

| technique | input | output | strengths | limits | terms |
|---|---|---|---|---|---|
| Shape grammars (split grammars) | footprints and lots, street networks (OSM, SHP, DXF), rule files | buildings and facades by `extrude`, `split` (with repeat), `comp` (into faces, edges, vertices), `insert`; exported as glTF and other formats | whole cities from rules; a consistent style | rules are hard to write; generic unless fed real attributes | the tools are commercial; grammars as an idea are open (published research since 2001) |
| Heightfields and city pipelines in procedural 3D tools | DEMs; OSM (every tag kept as an attribute); LiDAR (E57, LAS, LAZ with classes) | heightfields with masks; hydraulic and thermal erosion with flow and sediment layers; scatter; roads and buildings; batched as work items in a task graph (a city split into tiles) | procedural and data-driven together; re-runs when inputs change | heightfields cannot hold vertical surfaces; a desktop tool whose output is exported elsewhere | commercial, with cheaper small-studio and learning tiers |
| Landscape splines and procedural content graphs | a landscape, splines, meshes, volumes | splines raise or lower the heightmap under a road or river with a falloff, paint a layer and bend meshes; content graphs sample the landscape and splines into points and spawn meshes, in an editor or at runtime | the ground is shaped under a road; rules re-run on change | locked inside one editor | the editor's |
| Streamed world cells and HLOD | the whole level, one file per object | the world in a streamed grid of cells (for example 256 m); far cells drawn as merged proxy meshes (HLOD) | huge worlds on limited memory | long bake times | — |
| Procedural cities from rules and kits | a layout generated by rules, modular building kits | a published sample city of about 16 km²: hundreds of kilometres of roads and sidewalks, over a thousand intersections, thousands of buildings, tens of thousands of lamp posts; the rules made the island, roads, freeway, lots, sidewalks and building placement, and a rule processor turns their points into instances | proof that a believable city comes from rules plus modular kits | an invented city, not a real place | sample assets usually licensed for one toolchain only |
| Kitbash (modular sets) | a set of modular pieces on a fixed footprint and snap grid | buildings, walls, arcades, interiors snapped together (a handful of kits can make hundreds of levels) | fast, consistent, instanced (cheap) | repetition shows; needs a good kit | per kit |
| Procedural trees | species parameters | branching meshes, leaves, LODs, wind, by L-systems or space colonisation (branches compete for space; better for mature trees) | any tree from a few numbers; seasons | realism needs a good species library | commercial tools and small open-source libraries |
| Octahedral impostors | any mesh | an atlas of views on an octahedral or hemi-octahedral grid (hemi for trees seen from above), drawn on one card | a tree or a building far away for two triangles | baking cost; parallax limits up close | the technique is open, common in open-world games |

### 1.5 Ground and engineering

| technique | input | output | strengths | limits | terms |
|---|---|---|---|---|---|
| LiDAR classification | raw points | ASPRS classes per point: 2 ground, 3–5 low / medium / high vegetation, 6 building, 7 low noise, 9 water, 10 rail, 11 road surface, 13–16 wires and towers, 17 bridge deck, 18 high noise | separates ground from buildings, trees, water, wires, bridge decks | errors near walls, steps and vegetation; needs checking | open-source and commercial tools, ML models |
| DTM / DSM and breaklines | classified points, survey strings | a TIN or a grid. Hard breaklines force a slope break (kerbs, banks, wall tops); soft breaklines hold known heights | the ground stays sharp where it should | breaklines are drawn or fitted; grids lose them | — |
| Civil corridors and grading | a horizontal alignment + a profile + an assembly of subassemblies (lanes, kerbs, side slopes) | a 3D corridor; grading from feature lines with slopes that "daylight" to the existing ground (cut, fill or both) | engineering-true; the ground follows the design | engineering tools, engineering effort | commercial civil design tools |
| Scan-to-BIM and IFC | point clouds | IFC objects: `IfcStair` (made of `IfcStairFlight`, landings and `IfcRailing`), `IfcWall`, `IfcRamp`. In IFC 4.3 a flight's risers and treads move from attributes to `Pset_StairFlightCommon` | semantic, parametric, exchangeable | mostly manual today (BIM tools with scan plug-ins); automatic fitting is research | IFC is an open ISO standard |
| Erosion | a height field | natural relief: hydraulic and thermal erosion, flow maps | believable terrain where there is no data | invented, not measured | terrain tools, often free for non-commercial use and paid above it |

### 1.6 A whole-planet world, in detail

A simulation of the whole planet, as flight simulators build one, shows the whole stack at once:

- **Photogrammetry for a few hundred cities,** from aerial capture, streamed; regional updates add more cities and finer (1–2 m) LiDAR elevation.
- **Generated buildings everywhere else,** rebuilt from 2D imagery:
  - computer vision finds the footprints;
  - machine learning completes what shadows hide;
  - heights come from GIS data where it exists, and otherwise from shadows, roof cues and regional averages.

  A share of the buildings is accepted to be wrong.
- **Hand-made airports and points of interest** where people look; the rest is generated.
- **Layered packages** let hand-made scenery win where it is placed:
  - **packages are layered:** when two hold the same file, the one mounted last wins;
  - **exclusion polygons** remove things inside a polygon: the streamed terrain mesh (this is how **photogrammetry is cut out**), OSM buildings, buildings detected from imagery, or everything at once;
  - **terraform polygons** set the terrain to the polygon's altitude, with a **falloff** in metres back to the surrounding ground, and a priority decides which overlapping polygon wins; **rectangles** flatten the terrain or carry a sculpted heightmap;
  - **exclusion rectangles** remove objects, polygons, projected meshes and airports from packages loaded before them;
  - **projected meshes** are drawn onto the ground in 2D, like decals, and baked into the terrain textures with taxiways and aprons;
  - **placed models** come from model libraries (glTF with LODs).

## 2. How whole worlds layer them

They all build the same stack, bottom to top:

```tree
a real place, layer by layer
├── 1 elevation      a DTM for the region (1 m where it exists, coarser elsewhere)
├── 2 imagery        the ground's colour
├── 3 fabric         roads, paths, rivers, rail from vector data, with the ground shaped under them
├── 4 mass           buildings from footprints and heights (ML, CityGML, OSM), by rules
├── 5 scatter        trees, furniture, lights, by rules and data
├── 6 scans          photogrammetry or LiDAR meshes where captured
├── 7 hero pieces    hand-made or cleaned-scan landmarks
└── 8 local edits    exclusions and terraforms around every hero piece
```

**The hybrid best practice:**

1. **Generate the bulk, hand-make the few.** Generated buildings and rules cover the world. People spend time only where it matters: airports, stations, a riverfront.
2. **Higher layers remove lower ones inside their footprint.** Exclusion polygons, photogrammetry clipped under a placed model, one building per footprint in a city model.
3. **The ground follows the piece.** Flattening polygons, landscape splines and civil daylighting all work this way: the piece decides the ground, never the reverse.
4. **The scan is a reference, not the deliverable,** for anything you walk on or simulate. Walkable, collidable, semantic geometry is rebuilt. Scans stay as backdrops or as landmark meshes.
5. **Every layer has a far form.** HLOD clusters, impostors and tile LODs let detail fall away with distance.

## 3. aslnut's mechanism

### 3.1 The compose stack

`core.geometry.landform.compose.layers` combines every source of one place in a fixed order. A higher layer wins inside its footprint.

```tree
compose (bottom → top)
├── elevation   modules.world.earth.body.base.terrain.* (mapzen, grid, lidar, custom)
├── fabric      core.geometry.networks.* (sections, junctions, structures, clamp), zones and rules
├── pieces      parametric pieces: stairs, walls, terraces, ramps, railings, furniture, procedural buildings and trees
├── scans       cleaned scan meshes and landmarks (modules.world.earth.presets.built.buildings.landmarks)
└── edits       kits.authoring diffs (move, align, re-parameter, remove)
```

- **Footprints** (`core.geometry.landform.compose.footprints`): every piece knows the polygon it claims and the band of heights it claims. A bridge deck claims only its own band, so the river still flows under it.
- **Exclusion** (`core.geometry.landform.compose.exclusion`): inside its footprint, a piece removes the things of the layers below it: generated buildings, scattered trees, furniture, scan points. They are hidden, never deleted from their source.
- **Recompute only where it changed.** Moving one stair re-resolves only its old and new footprints.

### 3.2 Pieces own their ground

Every piece has a ground contract (`core.geometry.landform.compose.ground`):

| contract | what happens to the terrain under the footprint | typical piece |
|---|---|---|
| `clamp` | pushed just below the piece's surface, blended back to the natural ground | paths, promenades, the fabric's surfaces |
| `cut` | lowered to the piece's base; nothing above stays | a stair flight going down, a quay's low side, a basement |
| `fill` | raised to the piece's base; nothing below stays empty | a terrace platform, an embankment |
| `flatten` | set to one height, blended at the edge | a plaza, a vault floor, a station forecourt |
| `keep` | untouched; the piece stands on it | a bench, a lamp, a tree |

A **foundation** (`core.geometry.landform.compose.foundation`) closes the gap where a piece meets a slope, with a plinth, a skirt or piles down to the ground under it. Nothing floats, and nothing is buried by accident.

### 3.3 Fidelity per place

`core.geometry.landform.compose.fidelity` chooses, per place, which kind of piece fills it:

| what exists for the place | what enters the world |
|---|---|
| a cleaned scan of a unique landmark | the landmark mesh (`modules.world.earth.presets.built.buildings.landmarks`) |
| a scan or survey of a standard element (steps, a wall) | a parametric piece fitted to it (`tools.scan.fit` → `core.geometry.networks.structures.*`) |
| tags only (`highway=steps` + `step_count`, `barrier=retaining_wall` + `height`) | a parametric piece from the tags |
| a footprint only | a procedural piece (`core.geometry.shapes.builder.scope`, `modules.world.earth.presets.built.buildings.*`) |
| nothing | rules over zones (`core.geometry.zones.rules.*`) |

The choice also weighs the budget (`core.runtime.budget.budget`). Far away, a landmark may draw as its impostor (`core.geometry.shapes.levels.impostor`).

### 3.4 Terraform is a consequence, not a manual step

`core.geometry.landform.terraform.*` (flatten, carve, raise, smooth, sweep, stamp, erode) works on any body. It is rarely called by hand:

- a piece's ground contract **makes** a flatten, cut or fill under its footprint;
- the fabric's clamp (`core.geometry.networks.clamp`) **makes** a sweep along a road or a path, with daylighting slopes back to the ground;
- a fitted scan patch **makes** a stamp where the 1 m grid is too coarse (stair landings, a quay top);
- `erode` is only for places with no data at all.

`modules.world.earth.ground.terrain.terraform` becomes Earth's data only (the saved height edits of a place), applied by the core.

### 3.5 Edits are diffs over source data

`kits.authoring.diffs` keeps every change as a diff, such as "move piece `stairs-3` by 0.4 m", "set `risers` to 21", or "exclude scan points in this polygon". The sources (the scan, OSM, the elevation model) are never modified. A newer source is put under the edits with `edits.rebase(source)`. The core's `core.data.scenarios.diff` (built) compares two states of a world the same way.

### 3.6 The studio is only a screen over the same API

`kits.authoring.pieces` gives the operations and their previews: place, align to a scan, fit, snap, re-parameter, remove. A studio calls them, and so can a script or an assistant. There is no studio-only data and no studio-only geometry.

### 3.7 Offline tools for scans

The heavy work runs ahead of time, on the authoring machine (see [compile](compile.md)):

| step | id | in | out |
|---|---|---|---|
| classify | `tools.scan.classify` | raw LAS / LAZ | ASPRS classes (ground, building, vegetation, water, bridge deck…) |
| align | `tools.scan.align` | a scan in its own frame | the scan in the world's frame, with the error in metres |
| fit | `tools.scan.fit` | a classified, aligned scan + a rough footprint (from OSM) | piece parameters (risers, tread, wall height and batter, planes) with residuals |
| clean | `tools.scan.clean` | a photogrammetry mesh | a de-lit, decimated mesh without people and cars, clipped to its footprint |
| convert | `tools.convert.las` | LAS / LAZ | a points pack (or 3D Tiles) for `core.geometry.import.pointcloud` |

Everything that reaches the visitor's phone draws the same on WebGPU and WebGL2.

### 3.8 Licences decide what may enter

`core.data.rights` carries each source's terms as capabilities: `show`, `prefetch`, `keep` and `export` (see [licences](licences.md)).

- An open scan (CC BY) may be kept, fitted to and exported, with its credit on screen.
- A commercial photoreal tile service may only be shown (`keep: false`, `export: false`, no fitting or tracing). It is a backdrop, never a source for pieces.
- OSM-derived pieces carry ODbL.

## 4. Every technique mapped to the tree

Statuses are from `STATUS.md` (2026-10-13). **built** = in the package and tested on WebGPU and WebGL2.

| technique | aslnut parts (ids) | status |
|---|---|---|
| layering, priority | `core.geometry.landform.compose.layers` | proposed |
| exclusion polygons, cutting photogrammetry | `core.geometry.landform.compose.footprints` · `core.geometry.landform.compose.exclusion` | proposed |
| flattening and terraform polygons with falloff | `core.geometry.landform.compose.ground` · `core.geometry.landform.terraform.flatten` · `raise` · `carve` · `smooth` | proposed |
| plinths under placed models | `core.geometry.landform.compose.foundation` | proposed |
| choosing scan, hand-made or autogen per place | `core.geometry.landform.compose.fidelity` | proposed |
| civil corridors, landscape splines | `core.geometry.networks.sections` · `core.geometry.networks.clamp` · `core.geometry.landform.terraform.sweep` | planned · planned · proposed |
| projected meshes (decals on the ground) | `core.geometry.marks.drape` · `core.geometry.marks.areas.area` · `modules.world.earth.presets.built.roads.markings` | built · built · partly |
| scan height patches | `core.geometry.landform.terraform.stamp` | proposed |
| erosion tools | `core.geometry.landform.terraform.erode` | proposed |
| 1 m DTM / DSM | `modules.world.earth.body.base.terrain.lidar` · `modules.world.earth.body.base.terrain.grid` | proposed · built |
| breaklines | `tools.scan.fit` (wall tops and nosings become piece edges) · `core.geometry.landform.compose.ground` | proposed |
| LiDAR point clouds (LAS, LAZ, COPC) | `core.geometry.import.pointcloud` · `tools.convert.las` | proposed · planned |
| LiDAR classification | `tools.scan.classify` | proposed |
| registration to the world | `tools.scan.align` | proposed |
| scan-to-BIM fitting | `tools.scan.fit` · `core.geometry.networks.structures.stairs` · `walls` · `terraces` · `ramps` · `railings` | proposed |
| IFC in | `tools.convert.ifc` | planned |
| bridges, piers, culverts, decks | `core.geometry.networks.structures.bridges` · `piers` · `culverts` · `decks` | planned |
| photogrammetry clean-up | `tools.scan.clean` | proposed |
| hand-made and cleaned-scan landmarks | `modules.world.earth.presets.built.buildings.landmarks` · `core.geometry.import.gltf` · `kits.authoring.pieces` | proposed · planned · proposed |
| 3D Tiles (a commercial service: show only) | `core.geometry.import.tiles3d` · `core.data.rights.capabilities.*` | planned · built |
| I3S | not covered (see the open questions) | — |
| Gaussian splats | `core.geometry.import.splats` | planned |
| ML footprints and heights | `modules.world.earth.presets.built.buildings.footprints` | partly |
| CityGML / CityJSON, national open city models | `modules.world.earth.presets.built.buildings.cityjson` · `tools.convert.citygml` | planned |
| shape grammars | `core.geometry.shapes.builder.scope` · `modules.world.earth.presets.built.buildings.facades` · `roofs` | proposed · planned · partly |
| kitbash | `core.geometry.shapes.recipes.kitbash` · `core.geometry.shapes.instances` | proposed · partly |
| procedural trees | `core.geometry.shapes.recipes.branching` · `modules.world.earth.presets.living.plants.species` · `growth` | proposed · partly · planned |
| leaves letting light through | `modules.world.earth.presets.living.plants.canopy` | proposed |
| octahedral impostors | `core.geometry.shapes.levels.impostor` | proposed |
| HLOD and streamed cells | `core.data.loading.chunks.*` · `tools.compile.steps.assign` · `core.geometry.shapes.levels.*` | planned (impostor proposed) |
| procedural content rules, scatter | `core.geometry.zones.rules.scatter` · `core.geometry.zones.rules.frontage` | planned |
| batching a city as tiled work items | `tools.compile.*` | planned |
| street furniture | `modules.world.earth.presets.built.furniture.benches` · `bollards` · `bins` · `umbrellas` · `signs` · `planters` | proposed |
| poles, wires, cabinets | `modules.world.earth.presets.built.infrastructure.utilities.pole` · `lines` · `pipe` · `cabinet` | proposed |
| placing and aligning by hand | `kits.authoring.pieces` | proposed |
| edits as diffs | `kits.authoring.diffs` · `core.data.scenarios.diff` | planned · built |
| licence terms | `core.data.rights.terms` · `core.data.rights.capabilities.*` · `core.data.rights.attribution` | built · built · partly |
| shadows through crowns, heat | `core.render.look.shadows` · `core.simulation.phenomena.heat` | built |

## 5. Worked example: a riverfront under a road bridge

**The place:** Melbourne's Yarra, north bank, either side of Princes Bridge (opened 1888: three iron spans on bluestone piers).

- **West of the bridge is Flinders Walk,** the promenade beside Flinders Street Station. Wide terraced steps run down to it. A quay wall drops to the water. A retaining wall with a planter holds the slope. Railings line the drops and lamps stand along the walk. An autumn tree leans over the steps.
- **Under the bridge's approach are the Princes Walk Vaults** (1889): twenty brick barrel vaults faced in basalt, built with the bridge. A bar fills some of them, at Federation Wharf.
- **Further west, the Banana Alley Vaults** sit under the station's Flinders Street Viaduct (1891).

**The study area:** about 600 m × 400 m, from the station's west end to Federation Wharf. Every dataset is cut to this box.

### 5.1 Piece by piece

| piece | aslnut ids | data | kind | what the ground does |
|---|---|---|---|---|
| the ground | `modules.world.earth.body.base.terrain.lidar` over `modules.world.earth.body.base.terrain.mapzen` | a DTM gridded from the City of Melbourne point cloud's ground class (class 2) | measured | the reference every other piece fits to; blended into the coarser terrain at the box's edge |
| the river | `modules.world.earth.water.hydrology.water` | OSM `waterway=river` / `natural=water`; the point cloud's water class (9) for the water line | data | carved below the quay's toe |
| the quay wall | `core.geometry.networks.structures.walls` (`kind: 'quay'`) | OSM `man_made=quay` (or the river bank) for the line; height and batter from `tools.scan.fit` | parametric, fitted to the scan | `cut` on the river side, held on the promenade side |
| the promenade | `core.geometry.networks.walkways` · `core.geometry.networks.sections` · `core.geometry.networks.clamp` | OSM `highway=footway`; width and level from the scan | parametric (fabric) | `clamp`: the ground swept flat under it, daylighting back to the slope |
| the terraced steps | `core.geometry.networks.structures.terraces` + `core.geometry.networks.structures.stairs` | OSM `highway=steps` with `step_count`, `incline`, `width`, `handrail`; risers, treads and platform levels from `tools.scan.fit` | parametric, fitted to the scan | `cut` and `fill` to each platform; a `stamp` where the 1 m grid is too coarse |
| the retaining wall and its planter | `core.geometry.networks.structures.walls` (`kind: 'retaining'`) + `modules.world.earth.presets.built.furniture.planters` | OSM `barrier=retaining_wall` (the low side is on the right of the way); height from the scan | parametric, fitted | `fill` on the high side, `cut` on the low side; the planter `keep`s the wall's top |
| railings | `core.geometry.networks.structures.railings` (`along: 'drops'`) | made from every drop over 0.5 m (quay, terraces, retaining wall); posts checked against the scan | parametric, derived | `keep` |
| lamps | `modules.world.earth.presets.built.lights.street` with `modules.world.earth.presets.built.infrastructure.utilities.pole` | OSM `highway=street_lamp` where mapped; positions from pole-shaped points in the scan | parametric | `keep` (a small `foundation` on the slope) |
| benches, bins, bollards, signs | `modules.world.earth.presets.built.furniture.benches` · `bins` · `bollards` · `signs` | OSM `amenity=bench`, `amenity=waste_basket`, `barrier=bollard`, `information=board` | parametric | `keep` |
| Princes Bridge | `core.geometry.networks.structures.bridges` + `piers` (the deck the road and trams use) and `modules.world.earth.presets.built.buildings.landmarks` (the iron spans and bluestone piers) | OSM `bridge=yes` on the road, `man_made=bridge` for the outline; the City of Melbourne textured mesh, cleaned, for the spans | fabric deck + landmark mesh | the deck claims only its band, so the walk passes under; the piers `keep` |
| the Princes Walk Vaults and the bar | `modules.world.earth.presets.built.buildings.landmarks` (the vault fronts) · `modules.world.earth.presets.built.furniture.umbrellas` · `benches` | a cleaned ground-level photogrammetry scan (or the textured mesh); your own data for the bar's tables | landmark mesh | `flatten` to the vault floor; `foundation: 'none'` |
| the station's viaduct and its vaults | `modules.world.earth.presets.built.rail.viaducts` · `core.geometry.shapes.recipes.kitbash` (an arch kit repeated along it) | OSM `railway=rail` + `bridge=viaduct`; arch spacing from the scan | parametric + kit | `keep`; each arch's footprint excludes generated buildings |
| the autumn tree | `modules.world.earth.presets.living.plants.species` · `growth` · `canopy` · `core.geometry.shapes.recipes.branching` · `core.geometry.shapes.levels.impostor` | the City of Melbourne urban forest data (species, trunk diameter, year planted); position and crown from the scan's vegetation classes (3–5) | procedural, sized to the scan | `keep`; the crown lets some light through, for shade and heat |
| the station building | `modules.world.earth.presets.built.buildings.landmarks` | the textured mesh, cleaned, or a hand-made model | landmark mesh | `flatten` + `plinth` |
| the city behind | `modules.world.earth.presets.built.buildings.footprints` · `roofs` · `facades` | OSM and Overture footprints; heights from the City of Melbourne DSM | procedural | `clamp`; excluded inside every landmark footprint |

### 5.2 The same, as code

```ts
// [proposed] the riverfront under the bridge: scans in, pieces out
const comp = compose({
  where: studyArea,
  layers: [
    terrain.lidar({ url: '/dem/yarra-dtm-50cm.tif', attribution: 'City of Melbourne, CC BY 4.0' }),
    walkways, // the fabric: sections + clamp from OSM
    pieces,   // stairs, terraces, walls, railings, furniture, trees
    landmarks,
    edits,
  ],
});

const fits = await loadFits('/fits/yarra.json'); // made offline by tools.scan.fit

walkways.structures(e =>
  e.props.highway === 'steps' ? { kind: 'stairs', fit: fits[e.id], ground: 'cut' } : null);
pieces.add(structures.terraces(riverSteps, { fit: fits.terraces, edge: 'seats' }));
pieces.add(structures.wall({ kind: 'quay', fit: fits.quay, holds: 'left' }));
pieces.add(structures.wall({ kind: 'retaining', fit: fits.retaining }));
pieces.add(structures.railings({ along: 'drops' }));

landmarks.add(await shapes.import('/landmarks/princes-walk-vaults.glb'), vaultsAt,
  { ground: 'flatten', excludes: ['buildings', 'vegetation'] });

comp.fidelity((place, have) =>
  have.scan && place.landmark ? 'scan' : have.fit || have.tags ? 'parametric' : 'procedural');
w.add(comp);
```

### 5.3 What is parametric, fitted, or a landmark

- **Parametric from tags or rules:** the promenade, benches, bins, bollards, signs, lamps, the city behind.
- **Parametric, fitted to the scan:** the quay wall, the terraced steps, the retaining wall, the planter, the railings' line, the viaduct's arch spacing, the tree's size.
- **Landmark meshes (cleaned scans):** the bridge's spans, the vault fronts and the bar, the station building.
- **Measured, used only as the reference:** the point cloud and the DSM. They are drawn only for checking (`core.geometry.import.pointcloud`).

## 6. Open data for the example

| dataset | what | format, size | resolution / accuracy | licence | use here |
|---|---|---|---|---|---|
| [City of Melbourne 3D Point Cloud 2018](https://data.melbourne.vic.gov.au/explore/dataset/city-of-melbourne-3d-point-cloud-2018/) | the municipality in coloured points, May 2018, MGA zone 55 / AHD heights | LAS in ZIP, 4 GB for the whole municipality | 7.5 cm ground sample distance, 25 cm absolute accuracy | CC BY 4.0 on the City's portal and DataVic (some older catalogue copies of the City's 3D data say CC BY 3.0 AU) | the reference to fit stairs, walls, terraces, poles and trees to; its ground class gives the DTM |
| [City of Melbourne Digital Surface Model](https://data.melbourne.vic.gov.au/explore/dataset/digital-surface-model/) | the top surface (roofs, crowns), May 2018 | GeoTIFF, 12 GB | 0.1 m pixels | CC BY 4.0 | building heights, tree crowns |
| City of Melbourne 3D Textured Mesh (Photomesh) 2020 | the municipality as a textured mesh | OBJ / MTL / JPG tiles, levels 13–20 | 7.5 cm ground sample distance | CC BY 4.0 | the source meshes for the landmarks, cleaned by `tools.scan.clean` |
| City of Melbourne urban forest | 80,000+ council trees: species, genus, trunk diameter, year planted, age, life expectancy | CSV / GeoJSON | point | CC BY 4.0 | species, growth and canopy |
| Vicmap Elevation 1 m DEM | bare earth from airborne LiDAR, about 60% of Victoria | grid | 1 m, ±10 cm | **restricted** (a paid licence); only its footprints are CC BY 4.0 | **not used** under our data rule; the DTM comes from the City's point cloud instead |
| OpenStreetMap | the fabric and the tags below | PBF / Overpass JSON | — | ODbL, © OpenStreetMap contributors | walkways, steps, walls, the bridge, furniture |
| Overture buildings | footprints with heights | GeoParquet | — | ODbL | the city behind |

**OpenStreetMap tags this place uses:**

| tag | meaning | piece |
|---|---|---|
| `highway=steps` + `step_count`, `incline`, `width`, `handrail`, `step:height` | a flight of steps (`incline=up` rises in the way's direction) | `core.geometry.networks.structures.stairs` |
| `barrier=retaining_wall` + `height` | a wall holding a slope; the low side is on the right of the way | `core.geometry.networks.structures.walls` |
| `man_made=quay` | a quay (the wall itself may also carry `barrier=retaining_wall`) | `core.geometry.networks.structures.walls` (`kind: 'quay'`) |
| `man_made=bridge` (the outline) / `bridge=yes` + `layer` (on each way across) | a bridge | `core.geometry.networks.structures.bridges` |
| `power=pole`, `power=line` / `power=minor_line` | poles and overhead wires | `modules.world.earth.presets.built.infrastructure.utilities.pole` / `lines` |
| `man_made=street_cabinet` + `utility` | a utility cabinet | `modules.world.earth.presets.built.infrastructure.utilities.cabinet` |
| `amenity=bench` + `backrest`, `material` | a bench | `modules.world.earth.presets.built.furniture.benches` |
| `barrier=bollard` + `bollard` | a bollard (a node, or a way for a row) | `modules.world.earth.presets.built.furniture.bollards` |
| `amenity=waste_basket` | a bin | `modules.world.earth.presets.built.furniture.bins` |

**Our data rule:** real open data, under 50 MB per dataset. The City's point cloud (4 GB), DSM (12 GB) and mesh are far bigger, so we **cut tiles for the study area only**:

- the points as LAZ for the box, thinned if a tile is still over 50 MB;
- the DTM gridded at 0.5 m from the ground class;
- the DSM resampled to 0.25 m for the box;
- only the mesh tiles that hold the landmarks.

Every tile keeps its source's licence and credit, and the world shows each one ([licences](licences.md)).

## 7. Common mistakes

- **Shipping the scan as the world.** It has no steps to count and no wall to lean on. Fit pieces to it.
- **Terraforming by hand around a piece.** Give the piece a ground contract, and the terrain follows.
- **Fitting to a commercial photoreal tile service.** Its terms forbid it. Fit to open scans, and show such a service only as a backdrop.
- **Deleting generated buildings under a landmark.** Exclude them by footprint instead. Otherwise a source update brings them back.
- **A landmark for every object.** Landmarks cost memory and cannot be edited by parameter. Use them only for the few unique places.

## Open questions

- I3S scene layers: convert them to 3D Tiles in `tools.convert`, or leave them out?
- Gridding a DTM (with breaklines) from classified points has no part of its own today. Is it an option of `tools.convert.las`, or a new `tools.scan` step?
- A station (platforms, concourse) and enterable interiors (the bar in a vault) have no parts of their own. Today they are landmarks.

## How it relates

- **[The fabric](fabric.md):** networks, structures and the clamp are the fabric layer of the stack.
- **[Shapes](shapes.md):** procedural pieces, kits, levels and impostors.
- **[Compile](compile.md):** scans are processed, pieces resolved and the ground solved ahead of time.
- **[Formats](formats.md):** glTF in; LAS, IFC and CityGML through tools.
- **[Licences](licences.md):** what may be kept, fitted to and exported.
- **[Observation](observation.md):** fidelity and levels follow the budget.

## Data sources

The open data the worked example uses, with its terms (checked 2026-10-13):

- City of Melbourne 3D Point Cloud 2018 (CC BY 4.0): https://data.melbourne.vic.gov.au/explore/dataset/city-of-melbourne-3d-point-cloud-2018/ · https://discover.data.vic.gov.au/dataset/city-of-melbourne-3d-point-cloud-2018
- City of Melbourne Digital Surface Model (CC BY 4.0): https://data.melbourne.vic.gov.au/explore/dataset/digital-surface-model/ · https://discover.data.vic.gov.au/dataset/digital-surface-model
- City of Melbourne 3D Textured Mesh (Photomesh) 2020 (CC BY 4.0): https://discover.data.vic.gov.au/dataset/city-of-melbourne-3d-textured-mesh-photomesh-2020
- City of Melbourne urban forest, trees with species and dimensions (CC BY 4.0): https://discover.data.vic.gov.au/dataset/trees-with-species-and-dimensions-urban-forest
- Vicmap Elevation 1 m DEM footprints (CC BY 4.0; the DEM itself is restricted): https://discover.data.vic.gov.au/dataset/vicmap-elevation-1m-digital-elevation-model-dem-footprints
- OpenStreetMap (ODbL, © OpenStreetMap contributors): https://www.openstreetmap.org/copyright · the tags: https://wiki.openstreetmap.org/wiki/Tag:highway=steps · https://wiki.openstreetmap.org/wiki/Key:incline · https://wiki.openstreetmap.org/wiki/Tag:barrier=retaining_wall · https://wiki.openstreetmap.org/wiki/Tag:man_made=quay · https://wiki.openstreetmap.org/wiki/Tag:man_made=bridge · https://wiki.openstreetmap.org/wiki/Tag:power=pole · https://wiki.openstreetmap.org/wiki/Tag:power=minor_line · https://wiki.openstreetmap.org/wiki/Tag:man_made=street_cabinet · https://wiki.openstreetmap.org/wiki/Tag:amenity=bench · https://wiki.openstreetmap.org/wiki/Tag:barrier=bollard · https://wiki.openstreetmap.org/wiki/Tag:amenity=waste_basket
- Overture buildings (ODbL): https://docs.overturemaps.org/guides/buildings/
