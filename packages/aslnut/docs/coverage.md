# Coverage: every need, checked against this design

> Audit of 2026-10-11. The acceptance test is a list of needs gathered before the design (187 needs, forces, 17 conflicts), plus 5 needs found since (a reference video). Made by `_tree/audit.py`, which checks every link against the real rows.

**In one line:** every need now has a place in the design: 183 covered, 7 served outside aslnut on purpose, 1 waiting for a decision, 1 a release step. Nothing in the reference is without a reason.

## Summary

| | before | after |
|---|---|---|
| needs | 187 | 194 (5 new) |
| status | 131 covered · 34 thin · 28 GAP · 1 process | 186 covered · 7 outside · 1 process |
| API rows | 346 | 560 |
| rows with no need | 8 | 0 |
| pattern violations | 20 | 0 |

- **Before** counts the 5 new needs as GAP. Of the original 187: 131 covered · 34 thin · 21 GAP · 1 a release step.
- **Rows with no need (8):** 5 already served needs and were linked (`base/basemap` → 13, 18, 21; `networks/walkways` → 14, 40; three `shared` helper rows → 185). 3 are kept with evidence (`space/galaxies`, `space/exoplanets`: needs found after the list; `earth/places`: partly built, finding a place by name). None were removed.

## Open decisions

> **Decision needed:** seven choices still open. The docs carry the default shown in bold until each is decided.

| # | conflict | the choice | default in the docs | where |
|---|---|---|---|---|
| decision 1 | 4 | where the older whole-planet simulation grid lives | **a surface field on any body** | [world and body](#concepts/world-and-body~open-questions) |
| decision 2 | 7 | a small WGSL → GLSL writer so *your* shader hooks run on WebGL2 (vs "hand twins only") | **open** | [render › graphics/shaders/glsl](#reference/core/render~graphics-shaders-glsl) |
| decision 3 | 8 | layer names `points` / `extrusion` / `grid` vs `dots` / `footprints` / `cells` | **points / extrusion / grid** | [geometry › open questions](#reference/core/geometry~open-questions) |
| decision 4 | 9 | the small offline Earth (3–4 MB) inside npm or from a URL | **from a URL** | [hosting › the package](#concepts/hosting~the-package) |
| decision 5 | 13 | Esri as the default imagery in public examples | **Esri, session-only** | [licences](#concepts/licences~the-default-imagery) |
| decision 6 | 14 | the `earth/infrastructure` module (turbines, pylons, chargers…) | **proposed** | [earth › presets › built › infrastructure](#reference/modules/earth~presets-built-infrastructure-energy-wind-turbine) |
| decision 7 | 15 | the content of the whole tree (the format is agreed) | **this draft** | [the map](#map) |

## What was added

```tree
added/
├── core/
│   ├── world/
│   │   ├── settings/params
│   │   ├── settings/readouts
│   │   ├── settings/points
│   │   ├── state/settled
│   │   ├── state/json
│   │   ├── extend/hot-swap
│   │   ├── host/canvases
│   │   └── host/package
│   ├── time/
│   │   ├── step
│   │   ├── zones
│   │   ├── ranges
│   │   └── deep
│   ├── data/
│   │   ├── history/epochs
│   │   └── scenarios/overrides
│   ├── geometry/
│   │   ├── shapes/checks
│   │   └── import/splats
│   ├── simulation/
│   │   ├── rules/regimes
│   │   └── constants
│   ├── render/
│   │   ├── style/theme
│   │   ├── camera/project/project
│   │   └── camera/project/visible
│   ├── interaction/signals/selection
│   └── runtime/
│       ├── partners/experiment
│       ├── telemetry/remote-log
│       └── telemetry/shots
├── modules/
│   ├── world/surface/
│   │   ├── street-detail
│   │   └── provenance
│   └── earth/
│       ├── base/
│       │   ├── terrain/gebco
│       │   ├── terrain/etopo
│       │   ├── coast
│       │   └── offline
│       ├── terrain/looks
│       ├── hydrology/flow
│       ├── sea/
│       │   ├── level
│       │   ├── shore
│       │   ├── look
│       │   └── exposed
│       ├── roads/
│       │   ├── junctions
│       │   ├── markings
│       │   └── decks
│       ├── rail
│       ├── buildings/
│       │   ├── typology
│       │   ├── facades
│       │   ├── roofs
│       │   └── windows
│       ├── vegetation/
│       │   ├── growth
│       │   └── sway
│       ├── mobility/
│       │   ├── signals
│       │   └── transit
│       └── analysis/learn
├── kits/dashboard/stats
├── tools/catalog
└── concepts/
    ├── boundaries
    ├── hosting › the package
    ├── presence › who wins
    ├── licences › the default imagery
    └── world and body › sea level
```

Rows split into a subtree (the old row became the first leaf): earth `terrain` → `terrain/terraform`, `hydrology` → `hydrology/water`, `roads` → `roads/sections`, `vegetation` → `vegetation/species`, `mobility` → `mobility/traffic`, `analysis` → `analysis/geo`.

## The one-pattern check

The pattern: providers with defaults · your own data · custom functions · `when` with `s` · the four extension levels · plain names · honest statuses. Violations found, all fixed:

| # | where | the violation | now |
|---|---|---|---|
| fix 1 | [earth › life/society](#reference/modules/earth~life-society) | meant census layers | the human pattern of life (roles, schedules, places), an agent preset |
| fix 2 | [earth › life/ecology](#reference/modules/earth~life-ecology) | meant habitat layers | animals in habitats with behaviours, an agent preset |
| fix 3 | [earth › body/earth](#reference/modules/earth~body-earth) | `exaggerate` only a number; no way to say "flat" | `Fn<number>`; `terrain: []` = flat |
| fix 4 | [world › surface/terrain](#reference/modules/world~surface-terrain) | `exaggerate` only a number | `Fn<number>` |
| fix 5 | [interaction › signals](#reference/core/interaction~signals-signals) | "signals" meant select / toggle | reactive values; select / isolate / highlight in [selection](#reference/core/interaction~signals-selection) |
| fix 6 | [earth › air/sky/stars](#reference/modules/earth~air-sky-stars) | catalogue as a magic string | `catalogues.hipparcos()` or your own |
| fix 7 | [space › stars](#reference/modules/space~stars) | catalogue as a magic string | a catalogue factory |
| fix 8 | [space › galaxies](#reference/modules/space~galaxies) | catalogue as a magic string | a catalogue factory |
| fix 9 | [earth › presets › built › lights](#reference/modules/earth~presets-built-lights) | `'viirs'` | `raster.viirs()` or any raster |
| fix 10 | [earth › climate/fire](#reference/modules/earth~climate-fire) | `wind: 'weather'` | a field or a function |
| fix 11 | [earth › presets › living › plants/sway](#reference/modules/earth~presets-living-plants-sway) | `wind: 'weather'` | a field or a function |
| fix 12 | [hosting](#concepts/hosting) | Zebflow example `body: 'earth'` | `body: earth()` |
| fix 13 | [hosting](#concepts/hosting) | "world() throws on a server" contradicted headless `world(null)` | `world(null)` runs on a server |
| fix 14 | [earth › climate/heat](#reference/modules/earth~climate-heat) | looked like a separate engine | an Earth preset of core › simulation › phenomena › heat |
| fix 15 | [earth › climate/fire](#reference/modules/earth~climate-fire) | looked like a separate engine | an Earth preset of core › simulation |
| fix 16 | [observation › observers/orbit/keys](#reference/core/observation~observers-orbit-keys) | status built, works only inside the old story runtime | partly |
| fix 17 | [observation › observers/orbit/paths](#reference/core/observation~observers-orbit-paths) | same | partly |
| fix 18 | [render › capture](#reference/core/render~capture-capture) | built, but settle could time out into a half-loaded frame | partly; `settle: 'strict'` |
| fix 19 | [runtime › detail/prefetch](#reference/core/runtime~detail-prefetch) | built, but prefetch along a camera path is only partly there | partly |
| fix 20 | [data › loading/readiness](#reference/core/data~loading-readiness) | built, but plan / rehearse / ensure are only partly there | partly |


## Vision check per area

| area | verdict | where |
|---|---|---|
| space | complete: bodies, frames, orbits, the observer at light speed, satellites, stars, galaxies | [space](#concepts/space), [modules › space](#reference/modules/space) |
| bodies & agents | complete: agents for any body; humans and animals as presets; tiers that conserve counts | [agents](#reference/core/simulation), [society](#reference/modules/earth~life-society), [ecology](#reference/modules/earth~life-ecology) |
| physics | complete: fields, rules, multi-rate coupling, regimes, citable constants, a resolution by level, probes; sea level and river flow | [physics](#concepts/physics), [phenomena](#reference/core/simulation) |
| live twins | complete: live updates, streams, history, scenarios, corrections, external engines, an experiment socket | [live twins](#concepts/live-twins) |
| phones | complete: lite by default, WebGL2, budgets, compiled chunks, workers, remote log, phone shots | [performance](#concepts/performance), [runtime](#reference/core/runtime) |
| hosting | complete: plain, React, Zebflow, server-safe, dispose, a code-only package (decision 9) | [hosting](#concepts/hosting) |
| LLMs | complete: describe, schemas, a JSON form, errors with fixes, CLI and MCP, a catalog | [LLMs](#concepts/llms) |
| licences | complete: terms as permissions, credit in captures (decision 13) | [licences](#concepts/licences) |
| compile | complete: the same build code ahead of time, chunks, stale check, hot swap | [compile](#concepts/compile), [tools](#reference/tools) |
| realism | complete: quality tiers; TAA, reflections, HDRI sky, sky occlusion, interiors, wet streets; facades and trees; splats later | [quality](#concepts/quality), [render › look/post](#reference/core/render~look-post) |
| tools built on aslnut (#174) | complete: project, visible, params, readouts, points, settled, readback, camera, clock, readiness, stepping, dispose | [boundaries](#concepts/boundaries~what-aslnut-exposes-for-tools-built-on-it) |
| an ice-age explainer (reference video) | complete: sea level that changes, seafloor, rivers from terrain, years ago, ice per epoch | [world and body › sea level](#concepts/world-and-body~sea-level-the-seafloor-and-rivers-that-follow-it) |

## Forces

| force | status | where |
|---|---|---|
| phone-first | stated | [performance](#concepts/performance), [quality](#concepts/quality) |
| WebGPU + WebGL2 | stated; user hooks need decision 7 | [graphics](#concepts/graphics) |
| one atom: cell × observation × budget | stated | [observation](#concepts/observation) |
| determinism and conservation; strict settle | stated | [settled](#reference/core/world~state-settled), [step](#reference/core/time~step), [tiers](#reference/core/simulation~agents-tiers) |
| data and code apart | stated | [the package](#concepts/hosting~the-package), [compile](#concepts/compile) |
| loading and caching first-class | stated | [data](#concepts/data) |
| everything configurable | stated | [configurable](#concepts/configurable) |
| writable by LLMs and people | stated | [LLMs](#concepts/llms), [README](#README) |
| a small core | stated | [boundaries](#concepts/boundaries) |
| body-agnostic core | stated | [world and body](#concepts/world-and-body) |
| truth vs picture | stated | [presence](#concepts/presence) |
| visible state | stated | [runtime › telemetry](#reference/core/runtime~telemetry-telemetry) |
| licences | stated | [licences](#concepts/licences) |
| grown by dogfooding | stated | [the promotion rule](#concepts/boundaries~the-rules) |
| docs first | stated | [README](#README) |
| structure as full trees | stated | every page |

## The 17 conflicts

| # | conflict | status | where |
|---|---|---|---|
| conflict 1 | story placement | resolved: outside; reveal and camera keys stay in core | [boundaries](#concepts/boundaries) |
| conflict 2 | society vs agents | resolved: core agents; society and ecology are Earth presets | [agents](#reference/core/simulation) |
| conflict 3 | "Twin" naming | resolved: the entry is `world()`; no `Twin` in the interface | [world › lifecycle/world](#reference/core/world~lifecycle-world) |
| conflict 4 | the planet grid's home | **decision needed** | [world and body](#concepts/world-and-body~open-questions) |
| conflict 5 | planet vs world | resolved: `modules/world` | [modules › world](#reference/modules/world) |
| conflict 6 | rack numbers as API | resolved: `w.provide` by readable names | [provide](#reference/core/world~extend-provide) |
| conflict 7 | shader translation for user hooks | **decision needed** | [graphics/shaders/glsl](#reference/core/render~graphics-shaders-glsl) |
| conflict 8 | layer names | **decision needed** | [geometry](#reference/core/geometry~open-questions) |
| conflict 9 | data in npm | **decision needed** | [the package](#concepts/hosting~the-package) |
| conflict 10 | code vs data form | resolved: TypeScript first; a JSON form of worlds and shapes beside it | [json](#reference/core/world~state-json) |
| conflict 11 | fidelity precedence | resolved: one order, `when` → exists → observation → budget | [presence › rules](#concepts/presence~the-rules) |
| conflict 12 | determinism claims | resolved: strict settle, seed, fixed steps | [capture](#reference/core/render~capture-capture) |
| conflict 13 | Esri as default imagery | **decision needed** | [licences](#concepts/licences~the-default-imagery) |
| conflict 14 | the infrastructure module | **decision needed** | [earth](#reference/modules/earth~presets-built-infrastructure-energy-wind-turbine) |
| conflict 15 | the tree's content | **decision needed** | [the map](#map) |
| conflict 16 | shapes: mechanism in core | resolved: stated on the first lines | [shapes](#concepts/shapes) |
| conflict 17 | camerawork vs camera | resolved: views, keys, easing, paths in core; shots outside | [camera](#reference/core/render) |

## Every need

The kinds of use, in general words:

- **games:** games and playable city worlds
- **city twins:** city digital twins (walking, cycling, parks, heat, live simulation)
- **fleets:** vehicle fleets (replays and simulations)
- **dashboards:** analytics dashboards over regions
- **hazard twins:** hazard twins (flood, fire)
- **data maps:** thematic data maps (regions, statistics, culture)
- **videos:** geo explainer videos and short clips
- **presentations:** presentations and scroll stories
- **Zebflow apps:** apps hosted on Zebflow
- **space:** space and orbit views
- **physics labs:** physics labs
- **ecology:** ecology simulations
- **robots & vehicles:** robots, androids, drones, vehicles
- **synthetic data:** synthetic training data
- **researchers:** researchers
- **story tools:** story tools built on aslnut (outside the library)
- **assistants:** AI assistants writing worlds
- **all:** every use
- **studio apps:** studio apps built on aslnut (outside the library)
- Others as named: energy maps, phone users, shape authors, third parties, release, showcase, editors, no-code users, public outputs.

Status: **covered** (an interface serves it) · **thin** (mentioned, not enough) · **GAP** (missing) · **outside** (served by tools built on aslnut; the boundary is written) · **open** (a decision) · **process** (a release step, not an interface).

### A. Place, coordinates, bodies

| # | need | used by | → where | status |
|---|---|---|---|---|
| 1 | cm precision from street to orbit (camera-relative) | all | [precision](#reference/core/space~precision) · [frames/re-rooting](#reference/core/space~frames-re-rooting) · [space](#concepts/space) | covered |
| 2 | frame tree (inertial / body-fixed / local / object), re-rooting, floating origin | space, games, robots & vehicles | [frames/inertial](#reference/core/space~frames-inertial) · [frames/body-fixed](#reference/core/space~frames-body-fixed) · [frames/local](#reference/core/space~frames-local) · [frames/object](#reference/core/space~frames-object) · [frames/re-rooting](#reference/core/space~frames-re-rooting) | covered |
| 3 | SI units; time scales UTC / TT / TDB | space, physics labs | [units](#reference/core/space~units) · [scales](#reference/core/time~scales) | covered |
| 4 | a body: sphere / ellipsoid / **plane** (lab, game floor, a street lab), gravity, rotation | all | [bodies](#reference/core/space~bodies) · [plane](#reference/modules/world~plane) · [body/earth](#reference/modules/earth~body-earth) · [world-and-body](#concepts/world-and-body) | covered |
| 5 | several bodies in one world (Sun, Earth, Moon, Mars), ephemerides | space | [bodies](#reference/core/space~bodies) · [sun](#reference/modules/world~sun) · [moon](#reference/modules/world~moon) · [mars](#reference/modules/world~mars) · [phenomena/orbits/ephemerides](#reference/core/simulation~phenomena-orbits-ephemerides) | covered |
| 6 | body shells: atmosphere layers, crust strata, mantle | space, physics labs | [ground/shells](#reference/core/space~ground-shells) · [air/atmosphere/scattering](#reference/modules/earth~air-atmosphere-scattering) · [ground/subsurface/strata](#reference/modules/earth~ground-subsurface-strata) | covered |
| 7 | stand on ground / sea / seafloor / air / orbit; **draped on ground by default**; negative height below ground | all, physics labs | [elements/props](#reference/core/world~elements-props) · [ground/ground](#reference/core/space~ground-ground) · [presence](#concepts/presence) | covered |
| 8 | hierarchical cells / addressing (load + simulate) | all | [cells](#reference/core/space~cells) · [regions/tree](#reference/core/space~regions-tree) | covered |
| 9 | globe ↔ flat continuous zoom | dashboards, fleets, data maps, city twins | [surface/tiles](#reference/modules/world~surface-tiles) · [frames/local](#reference/core/space~frames-local) | covered |
| 10 | local flat frame for street level | games | [frames/local](#reference/core/space~frames-local) | covered |
| 11 | volumes (underground, air, magma, reservoirs) | physics labs, space | [ground/volumes](#reference/core/space~ground-volumes) · [fields/volume](#reference/core/simulation~fields-volume) · [underground](#concepts/underground) | covered |
| 121 | the Sun as a body (a star) in the world family, not only sun direction | space, all | [sun](#reference/modules/world~sun) · [bodies](#reference/core/space~bodies) | covered |

### B. Ground, terrain, base data

| # | need | used by | → where | status |
|---|---|---|---|---|
| 12 | relief from any DEM + global fallback; exaggeration (also as a function of the view) | games, city twins, hazard twins, videos | [body/earth](#reference/modules/earth~body-earth) · [surface/terrain](#reference/modules/world~surface-terrain) · [body/base/terrain/grid](#reference/modules/earth~body-base-terrain-grid) · [body/base/terrain/lidar](#reference/modules/earth~body-base-terrain-lidar) | thin → **covered** (exaggeration is a function of the view; `[]` = flat) |
| 13 | bathymetry + coastline guard; outlines as the 0 m line | hazard twins, physics labs | [body/base/terrain/gebco](#reference/modules/earth~body-base-terrain-gebco) · [body/base/terrain/etopo](#reference/modules/earth~body-base-terrain-etopo) · [body/base/coast](#reference/modules/earth~body-base-coast) · [water/sea/level](#reference/modules/earth~water-sea-level) · [body/base/basemap](#reference/modules/earth~body-base-basemap) | thin → **covered** (GEBCO / ETOPO seafloor; coast follows the sea level) |
| 14 | one authoritative ground / surface query (roads, bridges, water, solids), the same truth as rendered | games, city twins, robots & vehicles, fleets | [ground/ground](#reference/core/space~ground-ground) · [loading/chunks/logic-pack](#reference/core/data~loading-chunks-logic-pack) · [networks/walkways](#reference/core/geometry~networks-walkways) · [networks/clamp](#reference/core/geometry~networks-clamp) | covered |
| 15 | street-level terrain detail (4–8 m, error-bounded) | games, city twins | [surface/street-detail](#reference/modules/world~surface-street-detail) | GAP → **covered** (street detail added only when near) |
| 16 | terraform, holes, cutaways, dig / quarry / crater | games, physics labs | [ground/terrain/terraform](#reference/modules/earth~ground-terrain-terraform) · [look/cutaway](#reference/core/render~look-cutaway) · [phenomena/exchanges](#reference/core/simulation~phenomena-exchanges) · [networks/clamp](#reference/core/geometry~networks-clamp) · [terraform](#reference/kits/authoring~terraform) · [landform/terraform/flatten](#reference/core/geometry~landform-terraform-flatten) · [landform/terraform/carve](#reference/core/geometry~landform-terraform-carve) · [landform/terraform/raise](#reference/core/geometry~landform-terraform-raise) · [landform/terraform/smooth](#reference/core/geometry~landform-terraform-smooth) · [landform/terraform/sweep](#reference/core/geometry~landform-terraform-sweep) · [landform/terraform/stamp](#reference/core/geometry~landform-terraform-stamp) · [landform/terraform/erode](#reference/core/geometry~landform-terraform-erode) · [landform/compose/layers](#reference/core/geometry~landform-compose-layers) · [landform/compose/footprints](#reference/core/geometry~landform-compose-footprints) · [landform/compose/exclusion](#reference/core/geometry~landform-compose-exclusion) · [landform/compose/ground](#reference/core/geometry~landform-compose-ground) · [landform/compose/foundation](#reference/core/geometry~landform-compose-foundation) · [landform/compose/fidelity](#reference/core/geometry~landform-compose-fidelity) · [real-world-authoring](#concepts/real-world-authoring) | covered |
| 17 | stack raster / imagery sources (OSM, Esri, Mapbox, WMS, XYZ, PMTiles) as the body's imagery | all | [surface/imagery](#reference/modules/world~surface-imagery) · [body/base/imagery/esri](#reference/modules/earth~body-base-imagery-esri) · [body/base/imagery/sentinel](#reference/modules/earth~body-base-imagery-sentinel) · [body/base/imagery/osm](#reference/modules/earth~body-base-imagery-osm) · [body/base/imagery/mapbox](#reference/modules/earth~body-base-imagery-mapbox) · [body/base/imagery/custom](#reference/modules/earth~body-base-imagery-custom) · [sources/tiles/xyz](#reference/core/data~sources-tiles-xyz) · [sources/tiles/wms](#reference/core/data~sources-tiles-wms) · [sources/tiles/pmtiles](#reference/core/data~sources-tiles-pmtiles) | covered |
| 18 | default offline Earth preset, small npm footprint | all | [body/base/offline](#reference/modules/earth~body-base-offline) · [body/base/basemap](#reference/modules/earth~body-base-basemap) · [hosting](#concepts/hosting) | GAP → **covered** (small offline Earth pack from a URL) |
| 19 | no data in the library; packs / localities ship separately | all | [host/package](#reference/core/world~host-package) · [loading/packs](#reference/core/data~loading-packs) · [hosting](#concepts/hosting) | GAP → **covered** (package is code only; data apart) |
| 20 | region hierarchy, any depth; drill-down; roll-up; validity in time | dashboards, data maps, hazard twins, city twins | [regions/tree](#reference/core/space~regions-tree) · [regions/rollup](#reference/core/space~regions-rollup) · [regions/pack](#reference/core/space~regions-pack) | covered |
| 21 | labels: collision, globe-attached, per basemap; in captures | all, story tools | [marks/symbols/text](#reference/core/encoding~marks-symbols-text) · [drawing/text](#reference/core/render~drawing-text) · [layers/labels](#reference/core/encoding~layers-labels) · [body/base/basemap](#reference/modules/earth~body-base-basemap) | covered |
| 22 | land cover / biomes / looks (photoreal, cartographic, analytic) | games, dashboards, story tools | [ground/terrain/looks](#reference/modules/earth~ground-terrain-looks) · [style/lens](#reference/core/render~style-lens) | thin → **covered** (looks: biomes, land cover, snow line; follows the lens) |
| 122 | **terrain / imagery as named provider factories with defaults** (`terrain.mapzen()`, `imagery.esri()`); never magic strings | all | [body/base/imagery/esri](#reference/modules/earth~body-base-imagery-esri) · [body/base/terrain/mapzen](#reference/modules/earth~body-base-terrain-mapzen) · [configurable](#concepts/configurable) | covered |
| 123 | **compose several terrain / imagery sources:** own grid for part of a city + global fallback, with `where` (coverage), `blend` (soft edge), order; a custom heights function on the same interface | games, city twins, videos | [surface/terrain](#reference/modules/world~surface-terrain) · [surface/imagery](#reference/modules/world~surface-imagery) · [body/base/terrain/grid](#reference/modules/earth~body-base-terrain-grid) · [body/base/terrain/custom](#reference/modules/earth~body-base-terrain-custom) | covered |
| 124 | terrain truly off ("without heightmap", flat default) with layer code unchanged | all | [body/earth](#reference/modules/earth~body-earth) · [surface/terrain](#reference/modules/world~surface-terrain) | thin → **covered** (terrain `[]` = flat, layers unchanged) |
| 125 | terrain-data provenance known (Terrarium sources, Copernicus DSM vs DTM) and selectable | videos, researchers | [surface/provenance](#reference/modules/world~surface-provenance) · [body/base/terrain/mapzen](#reference/modules/earth~body-base-terrain-mapzen) | GAP → **covered** (DTM vs DSM, source per point) |
| 188 NEW | sea level as a world value that changes (metres; by time, params or `when`): water wherever the ground is below it, a coast that moves smoothly, a configurable look, a readout | videos, physics labs | [water/sea/level](#reference/modules/earth~water-sea-level) · [water/sea/shore](#reference/modules/earth~water-sea-shore) · [settings/params](#reference/core/world~settings-params) · [settings/readouts](#reference/core/world~settings-readouts) | GAP → **covered** (sea/level, shore) |
| 189 NEW | bathymetry in the terrain (named providers: Terrarium, GEBCO, ETOPO); exposed seafloor drawn as land with its own look; depth colouring | videos, physics labs, hazard twins | [body/base/terrain/gebco](#reference/modules/earth~body-base-terrain-gebco) · [body/base/terrain/etopo](#reference/modules/earth~body-base-terrain-etopo) · [body/base/terrain/mapzen](#reference/modules/earth~body-base-terrain-mapzen) · [water/sea/exposed](#reference/modules/earth~water-sea-exposed) · [water/sea/look](#reference/modules/earth~water-sea-look) | GAP → **covered** (gebco, etopo, exposed, look) |

### C. Things and geometry

| # | need | used by | → where | status |
|---|---|---|---|---|
| 23 | marks: points, lines, areas, extrusions, arcs, trails, grid, text, icons, **raster as a layer** | all | [marks/symbols/point](#reference/core/encoding~marks-symbols-point) · [marks/lines/line](#reference/core/encoding~marks-lines-line) · [marks/areas/area](#reference/core/encoding~marks-areas-area) · [marks/areas/extrusion](#reference/core/encoding~marks-areas-extrusion) · [marks/lines/arc](#reference/core/encoding~marks-lines-arc) · [marks/lines/trail](#reference/core/encoding~marks-lines-trail) · [marks/areas/grid](#reference/core/encoding~marks-areas-grid) · [marks/areas/rings](#reference/core/encoding~marks-areas-rings) · [marks/lines/arrows](#reference/core/encoding~marks-lines-arrows) · [marks/areas/raster](#reference/core/encoding~marks-areas-raster) · [marks/symbols/text](#reference/core/encoding~marks-symbols-text) · [marks/symbols/icon](#reference/core/encoding~marks-symbols-icon) · [marks/drape](#reference/core/encoding~marks-drape) | covered |
| 24 | per-feature style `d => …`, per-view `s => …`, per-time `t => …`; scales (quantile / quantize / jenks / linear), ramps | dashboards, story tools | [elements/props](#reference/core/world~elements-props) · [scales](#reference/core/encoding~scales) · [style/ramp](#reference/core/render~style-ramp) · [style/blend](#reference/core/render~style-blend) | covered |
| 25 | procedural shapes: `shapes.define({ id, params, build(p, b, rand, detail), far })` | games, city twins, robots & vehicles, all | [shapes/shape](#reference/core/geometry~shapes-shape) | covered |
| 26 | builder vocabulary: box, cylinder, sphere, extrude, sweep, lathe, round, color / tint / material, glass, label, lamps | games, city twins | [shapes/builder/solid](#reference/core/geometry~shapes-builder-solid) · [shapes/builder/extrude](#reference/core/geometry~shapes-builder-extrude) · [shapes/builder/lathe](#reference/core/geometry~shapes-builder-lathe) · [shapes/builder/sweep](#reference/core/geometry~shapes-builder-sweep) · [shapes/builder/mesh](#reference/core/geometry~shapes-builder-mesh) · [shapes/parts](#reference/core/geometry~shapes-parts) · [shapes/builder/copy](#reference/core/geometry~shapes-builder-copy) · [shapes/recipes/kitbash](#reference/core/geometry~shapes-recipes-kitbash) | covered |
| 27 | import: glTF / GLB (+ draco, meshopt, KTX2, lights, variants), OBJ, PLY, 3D Tiles | games, videos, space, city twins | [import/gltf](#reference/core/geometry~import-gltf) · [import/gltf-extensions/draco](#reference/core/geometry~import-gltf-extensions-draco) · [import/gltf-extensions/meshopt](#reference/core/geometry~import-gltf-extensions-meshopt) · [import/gltf-extensions/ktx2](#reference/core/geometry~import-gltf-extensions-ktx2) · [import/gltf-extensions/lights](#reference/core/geometry~import-gltf-extensions-lights) · [import/gltf-extensions/variants](#reference/core/geometry~import-gltf-extensions-variants) · [import/obj](#reference/core/geometry~import-obj) · [import/ply](#reference/core/geometry~import-ply) · [import/tiles3d](#reference/core/geometry~import-tiles3d) · [import/pointcloud](#reference/core/geometry~import-pointcloud) | covered |
| 28 | instancing; one build per unique params; cached | games, city twins, fleets | [shapes/instances](#reference/core/geometry~shapes-instances) · [drawing/instancing](#reference/core/render~drawing-instancing) | covered |
| 29 | buildings from footprints / attributes: typology, facade grammar, roofs, night windows | games, city twins, dashboards, showcase | [presets/built/buildings/footprints](#reference/modules/earth~presets-built-buildings-footprints) · [presets/built/buildings/typology](#reference/modules/earth~presets-built-buildings-typology) · [presets/built/buildings/facades](#reference/modules/earth~presets-built-buildings-facades) · [presets/built/buildings/roofs](#reference/modules/earth~presets-built-buildings-roofs) · [presets/built/buildings/windows](#reference/modules/earth~presets-built-buildings-windows) · [presets/built/buildings/frontage](#reference/modules/earth~presets-built-buildings-frontage) · [presets/built/buildings/landmarks](#reference/modules/earth~presets-built-buildings-landmarks) · [presets/built/buildings/interiors](#reference/modules/earth~presets-built-buildings-interiors) · [shapes/builder/scope](#reference/core/geometry~shapes-builder-scope) | thin → **covered** (typology, facades, roofs, night windows) |
| 30 | linear networks as geometry: sections, curbs, sidewalks, decks, piers, rail, rivers, pipes | games, city twins, fleets | [networks/analysis/graph](#reference/core/geometry~networks-analysis-graph) · [networks/sections](#reference/core/geometry~networks-sections) · [networks/junctions](#reference/core/geometry~networks-junctions) · [networks/structures](#reference/core/geometry~networks-structures) · [networks/structures/bridges](#reference/core/geometry~networks-structures-bridges) · [networks/structures/piers](#reference/core/geometry~networks-structures-piers) · [networks/structures/culverts](#reference/core/geometry~networks-structures-culverts) · [networks/structures/decks](#reference/core/geometry~networks-structures-decks) · [networks/structures/stairs](#reference/core/geometry~networks-structures-stairs) · [networks/structures/walls](#reference/core/geometry~networks-structures-walls) · [networks/structures/terraces](#reference/core/geometry~networks-structures-terraces) · [networks/structures/ramps](#reference/core/geometry~networks-structures-ramps) · [networks/structures/railings](#reference/core/geometry~networks-structures-railings) · [presets/built/roads/sections](#reference/modules/earth~presets-built-roads-sections) · [presets/built/roads/junctions](#reference/modules/earth~presets-built-roads-junctions) · [presets/built/roads/markings](#reference/modules/earth~presets-built-roads-markings) · [presets/built/roads/decks](#reference/modules/earth~presets-built-roads-decks) · [presets/built/roads/sidewalks](#reference/modules/earth~presets-built-roads-sidewalks) · [presets/built/roads/elevated](#reference/modules/earth~presets-built-roads-elevated) · [presets/built/rail](#reference/modules/earth~presets-built-rail) · [presets/built/rail/track](#reference/modules/earth~presets-built-rail-track) · [presets/built/rail/crossings](#reference/modules/earth~presets-built-rail-crossings) · [presets/built/rail/viaducts](#reference/modules/earth~presets-built-rail-viaducts) · [presets/built/rail/stations](#reference/modules/earth~presets-built-rail-stations) · [water/hydrology/water](#reference/modules/earth~water-hydrology-water) · [water/hydrology/channels](#reference/modules/earth~water-hydrology-channels) · [presets/built/infrastructure/utilities/pipe](#reference/modules/earth~presets-built-infrastructure-utilities-pipe) · [fabric](#concepts/fabric) | thin → **covered** (sections, junctions, markings, decks, rail) |
| 31 | vegetation: species, age, season, sway | games, city twins | [presets/living/plants/species](#reference/modules/earth~presets-living-plants-species) · [presets/living/plants/growth](#reference/modules/earth~presets-living-plants-growth) · [presets/living/plants/sway](#reference/modules/earth~presets-living-plants-sway) · [presets/living/plants/canopy](#reference/modules/earth~presets-living-plants-canopy) · [shapes/recipes/branching](#reference/core/geometry~shapes-recipes-branching) | thin → **covered** (species, growth, season, sway) |
| 32 | ground stack: zones by booleans; frontage; scatter by rules; furniture from records | games, city twins, showcase | [zones/booleans](#reference/core/geometry~zones-booleans) · [zones/kinds](#reference/core/geometry~zones-kinds) · [zones/rules](#reference/core/geometry~zones-rules) · [zones/rules/scatter](#reference/core/geometry~zones-rules-scatter) · [zones/rules/frontage](#reference/core/geometry~zones-rules-frontage) · [life/places/lots](#reference/modules/earth~life-places-lots) · [life/places/blocks](#reference/modules/earth~life-places-blocks) · [fabric](#concepts/fabric) | covered |
| 33 | materials / looks (PBR, glass, water, metal) | games, city twins, story tools | [look/materials](#reference/core/render~look-materials) | covered |
| 34 | cutaway / see-through ground / clipping | physics labs, story tools | [look/cutaway](#reference/core/render~look-cutaway) | covered |
| 35 | underground objects: wells, strata, seismic | physics labs | [ground/subsurface/strata](#reference/modules/earth~ground-subsurface-strata) · [ground/subsurface/wells](#reference/modules/earth~ground-subsurface-wells) · [ground/subsurface/aquifers](#reference/modules/earth~ground-subsurface-aquifers) · [ground/subsurface/magma](#reference/modules/earth~ground-subsurface-magma) · [underground](#concepts/underground) | covered |
| 126 | **shape param types** num / int / choice / color / text / flag (range, default, unit) | all, studio apps, assistants | [shapes/shape](#reference/core/geometry~shapes-shape) | covered |
| 127 | **presets** (named configs) and **variation** (seeded natural differences) per shape | games, energy maps | [shapes/recipes/presets](#reference/core/geometry~shapes-recipes-presets) · [shapes/instances](#reference/core/geometry~shapes-instances) | covered |
| 128 | **parts** (named movable pieces) and **anchors** (contact points with kind: seat, grip, foot, entry, parking, lie, sit, service, door), computed from params | games, robots & vehicles, energy maps | [shapes/parts](#reference/core/geometry~shapes-parts) | covered |
| 129 | **shape levels:** full → simple → box → dot → counted; author writes 1 (rest automatic incl. simplification), 2 (`far`) or N named levels with `when` | all | [shapes/levels/full](#reference/core/geometry~shapes-levels-full) · [shapes/levels/simple](#reference/core/geometry~shapes-levels-simple) · [shapes/levels/box](#reference/core/geometry~shapes-levels-box) · [shapes/levels/dot](#reference/core/geometry~shapes-levels-dot) · [shapes/levels/counted](#reference/core/geometry~shapes-levels-counted) · [shapes/levels/impostor](#reference/core/geometry~shapes-levels-impostor) | covered |
| 130 | level switching by **pixels on screen**, budget can push, crossfade + hysteresis; overridable per use | all | [detail/detail](#reference/core/runtime~detail-detail) · [budget/budget](#reference/core/runtime~budget-budget) | covered |
| 131 | level previews: thumbnail strip, distance slider, triangle counts vs budget | studio apps, shape authors | [shapes/checks](#reference/core/geometry~shapes-checks) | thin → **covered** (thumbnail strip, distance slider, budget) |
| 132 | **shape package format:** folder (shape.ts, shape.json manifest, presets.json, kinematics.ts, states.ts, thumbs, test.ts, LICENCE) | all, third parties | [shapes/recipes/package](#reference/core/geometry~shapes-recipes-package) | covered |
| 133 | **shape checks:** param sweep min / max / default, triangle budget, anchors / parts present, time limit in a worker, far exists | all, third parties | [shapes/checks](#reference/core/geometry~shapes-checks) | covered |
| 134 | **forms generated from params** (sliders, colours, dropdowns, live preview, save preset) | games, city twins, studio apps | [shapes/shape](#reference/core/geometry~shapes-shape) | covered |
| 135 | **no-code JSON shape** (parts as data with `{param}` expressions) | assistants, no-code users | [state/json](#reference/core/world~state-json) · [shapes](#concepts/shapes) | covered |
| 136 | sharing shapes by URL / npm; `w.shapes.use / load(catalog)` | third parties | [shapes/recipes/package](#reference/core/geometry~shapes-recipes-package) · [catalog](#reference/tools~catalog) | covered |
| 137 | imported models become shapes: node names → parts, empties → anchors, levels auto | games, city twins, videos | [import/gltf](#reference/core/geometry~import-gltf) · [formats](#concepts/formats) | covered |
| 138 | where meshes are made: builder → typed arrays per part → cache (shape + params + variant + detail) → one upload → instanced draws; build runs in the visitor's browser when added, once per unique params, in a worker; or baked ahead | all | [shapes/instances](#reference/core/geometry~shapes-instances) · [workers/workers](#reference/core/runtime~workers-workers) · [shapes](#concepts/shapes) | covered |
| 139 | CityJSON buildings (LOD1–2 with attributes) | city twins, dashboards, showcase | [presets/built/buildings/cityjson](#reference/modules/earth~presets-built-buildings-cityjson) | covered |
| 140 | tools convert: FBX (incl. animation clips for common rigs), IFC (BIM), CityGML, LAS → COPC, USD → glb | games, city twins, researchers | [convert/fbx](#reference/tools~convert-fbx) · [convert/ifc](#reference/tools~convert-ifc) · [convert/citygml](#reference/tools~convert-citygml) · [convert/las](#reference/tools~convert-las) · [convert/usd](#reference/tools~convert-usd) · [scan/classify](#reference/tools~scan-classify) · [scan/align](#reference/tools~scan-align) · [scan/fit](#reference/tools~scan-fit) · [scan/clean](#reference/tools~scan-clean) · [scan/grid](#reference/tools~scan-grid) · [convert/i3s](#reference/tools~convert-i3s) | covered |
| 141 | export: OpenUSD → 3D content tools / game engines (cinematic offline renders) | story tools, showcase | [export/usd](#reference/tools~export-usd) | covered |
| 142 | Gaussian splats (photoreal scans), later | city twins | [import/splats](#reference/core/geometry~import-splats) | thin → **covered** (splats as an import) |
| 143 | infrastructure presets: wind turbine, solar farm, pylon, substation, charger, pole, pipe (`earth/infrastructure`, proposed) | energy maps, fleets, city twins | [presets/built/infrastructure/energy/wind-turbine](#reference/modules/earth~presets-built-infrastructure-energy-wind-turbine) · [presets/built/infrastructure/energy/solar-farm](#reference/modules/earth~presets-built-infrastructure-energy-solar-farm) · [presets/built/infrastructure/energy/pylon](#reference/modules/earth~presets-built-infrastructure-energy-pylon) · [presets/built/infrastructure/energy/substation](#reference/modules/earth~presets-built-infrastructure-energy-substation) · [presets/built/infrastructure/mobility/charger](#reference/modules/earth~presets-built-infrastructure-mobility-charger) · [presets/built/infrastructure/utilities/pole](#reference/modules/earth~presets-built-infrastructure-utilities-pole) · [presets/built/infrastructure/utilities/lines](#reference/modules/earth~presets-built-infrastructure-utilities-lines) · [presets/built/infrastructure/utilities/pipe](#reference/modules/earth~presets-built-infrastructure-utilities-pipe) · [presets/built/infrastructure/utilities/cabinet](#reference/modules/earth~presets-built-infrastructure-utilities-cabinet) · [presets/built/furniture/benches](#reference/modules/earth~presets-built-furniture-benches) · [presets/built/furniture/bollards](#reference/modules/earth~presets-built-furniture-bollards) · [presets/built/furniture/bins](#reference/modules/earth~presets-built-furniture-bins) · [presets/built/furniture/umbrellas](#reference/modules/earth~presets-built-furniture-umbrellas) · [presets/built/furniture/signs](#reference/modules/earth~presets-built-furniture-signs) · [presets/built/furniture/planters](#reference/modules/earth~presets-built-furniture-planters) | covered |

### D. Motion and life

| # | need | used by | → where | status |
|---|---|---|---|---|
| 36 | entity sets as GPU arrays with components and tiers | games, fleets, robots & vehicles, ecology | [sets/sets](#reference/core/entities~sets-sets) · [identity](#reference/core/entities~identity) · [identity/id](#reference/core/entities~identity-id) · [identity/kind](#reference/core/entities~identity-kind) · [identity/data](#reference/core/entities~identity-data) · [placement](#reference/core/entities~placement) · [placement/place](#reference/core/entities~placement-place) · [placement/thing](#reference/core/entities~placement-thing) · [locomotion](#reference/core/entities~locomotion) · [locomotion/none](#reference/core/entities~locomotion-none) · [locomotion/rail](#reference/core/entities~locomotion-rail) · [locomotion/lanes](#reference/core/entities~locomotion-lanes) · [locomotion/surface](#reference/core/entities~locomotion-surface) · [locomotion/air](#reference/core/entities~locomotion-air) · [locomotion/water](#reference/core/entities~locomotion-water) · [agents/tiers](#reference/core/simulation~agents-tiers) · [entities](#concepts/entities) | covered |
| 37 | kinematics: `kinematics.define` joints hinge / slider / wheel / ball / custom over shape parts | games, robots & vehicles, energy maps | [kinematics/hinge](#reference/core/entities~kinematics-hinge) · [kinematics/slider](#reference/core/entities~kinematics-slider) · [kinematics/wheel](#reference/core/entities~kinematics-wheel) · [kinematics/ball](#reference/core/entities~kinematics-ball) · [kinematics/custom](#reference/core/entities~kinematics-custom) | covered |
| 38 | skeleton + skinning (LBS / DQS), clips, poses, IK, blending; human = a preset | games, videos, robots & vehicles, ecology | [body/skeleton](#reference/core/entities~body-skeleton) · [body/skin](#reference/core/entities~body-skin) · [motion/clips](#reference/core/entities~motion-clips) · [motion/poses](#reference/core/entities~motion-poses) · [motion/ik](#reference/core/entities~motion-ik) · [motion/blending](#reference/core/entities~motion-blending) | covered |
| 39 | crowds: VAT bake, LOD tiers, one draw per LOD | games, city twins | [sets/crowds](#reference/core/entities~sets-crowds) | covered |
| 40 | agents with a pattern of life (roles, schedules, places): **human preset** (earth/society) | games, city twins, fleets | [life/society](#reference/modules/earth~life-society) · [agents/rhythm](#reference/core/simulation~agents-rhythm) · [agents/populations](#reference/core/simulation~agents-populations) · [networks/walkways](#reference/core/geometry~networks-walkways) · [locomotion/surface](#reference/core/entities~locomotion-surface) · [shared/locomotion/walker](#reference/modules/presets~shared-locomotion-walker) | thin → **covered** (society = human pattern of life (was: census layers)) |
| 41 | agents for **any body:** behaviour, rhythm (daily / tidal / seasonal), habitat, senses (sea reptiles, robots, drones, vehicles) | ecology, robots & vehicles, fleets | [agents/behaviour](#reference/core/simulation~agents-behaviour) · [agents/rhythm](#reference/core/simulation~agents-rhythm) · [agents/habitat](#reference/core/simulation~agents-habitat) · [agents/senses](#reference/core/simulation~agents-senses) · [life/ecology](#reference/modules/earth~life-ecology) · [robots/android](#reference/modules/presets~robots-android) · [robots/robot](#reference/modules/presets~robots-robot) · [drones](#reference/modules/presets~drones) | covered |
| 42 | traffic: route / lane following, car following (own IDM / MOBIL, cited from papers), motorbike filtering, signals | games, fleets, city twins | [presets/mobility/traffic](#reference/modules/earth~presets-mobility-traffic) · [presets/mobility/signals](#reference/modules/earth~presets-mobility-signals) · [networks/lanes](#reference/core/geometry~networks-lanes) · [locomotion/lanes](#reference/core/entities~locomotion-lanes) · [shared/locomotion](#reference/modules/presets~shared-locomotion) · [shared/locomotion/lane-follower](#reference/modules/presets~shared-locomotion-lane-follower) · [vehicles/car](#reference/modules/presets~vehicles-car) · [vehicles/motorbike](#reference/modules/presets~vehicles-motorbike) | thin → **covered** (car following, lane change, signals) |
| 43 | transit: routes, stops, dwell, riding | games | [presets/mobility/transit](#reference/modules/earth~presets-mobility-transit) · [locomotion/rail](#reference/core/entities~locomotion-rail) · [drive/schedule](#reference/core/entities~drive-schedule) · [shared/locomotion/rail-follower](#reference/modules/presets~shared-locomotion-rail-follower) · [vehicles/bus](#reference/modules/presets~vehicles-bus) · [vehicles/minibus](#reference/modules/presets~vehicles-minibus) · [vehicles/train](#reference/modules/presets~vehicles-train) | thin → **covered** (GTFS transit with dwell) |
| 44 | population tiers counts → dots → bodies with conservation | games, city twins, dashboards | [agents/tiers](#reference/core/simulation~agents-tiers) | thin → **covered** (counts conserved between tiers) |
| 45 | player / avatar controllers (walk, ride, fly), first person | games, city twins | [avatars](#reference/kits/game~avatars) · [controllers](#reference/core/interaction~controllers) · [observers/orbit/follow](#reference/core/observation~observers-orbit-follow) | covered |
| 46 | contacts / collision / buoyancy / soft crowds / swimming | games, physics labs | [phenomena/contacts](#reference/core/simulation~phenomena-contacts) · [collision](#reference/kits/game~collision) · [locomotion/water](#reference/core/entities~locomotion-water) · [locomotion/air](#reference/core/entities~locomotion-air) | thin → **covered** (buoyancy and swimming) |
| 47 | satellites (TLE / SGP4), transfers, n-body, asteroids | space | [satellites/tle](#reference/modules/space~satellites-tle) · [phenomena/orbits/tle](#reference/core/simulation~phenomena-orbits-tle) · [phenomena/orbits/n-body](#reference/core/simulation~phenomena-orbits-n-body) · [phenomena/orbits/transfers](#reference/core/simulation~phenomena-orbits-transfers) · [asteroids](#reference/modules/space~asteroids) | covered |
| 48 | relativistic observer (light-time, aberration, Doppler, ship time) | space | [observer/light-time](#reference/core/space~observer-light-time) · [observer/aberration](#reference/core/space~observer-aberration) · [observer/doppler](#reference/core/space~observer-doppler) · [observer/ship-time](#reference/core/space~observer-ship-time) | covered |
| 144 | **`drive: (d, s) => joint values`** (motion as your own function), or clips / IK / simulation | games, robots & vehicles, energy maps | [drive](#reference/core/entities~drive) · [drive/schedule](#reference/core/entities~drive-schedule) · [drive/simulation](#reference/core/entities~drive-simulation) · [drive/data](#reference/core/entities~drive-data) · [drive/player](#reference/core/entities~drive-player) · [drive/script](#reference/core/entities~drive-script) | covered |
| 145 | **motion states:** idle / walk / drive / work… = clip / pose / gait / IK targets (+ expression), eased between | games, robots & vehicles, videos | [motion/states](#reference/core/entities~motion-states) · [motion/gaits](#reference/core/entities~motion-gaits) | covered |
| 146 | **attach:** one entity on another's anchor (ride, carry, hold), moving with it, IK to grips / pedals | games, energy maps | [placement/attach](#reference/core/entities~placement-attach) | covered |
| 147 | **face expressions:** morphs, emotions / visemes / gestures, auto blink, `expression('smile', .6)` | games, videos, robots & vehicles | [expressions/emotions](#reference/modules/human~expressions-emotions) · [expressions/visemes](#reference/modules/human~expressions-visemes) · [expressions/gestures](#reference/modules/human~expressions-gestures) · [expressions/blink](#reference/modules/human~expressions-blink) · [body/morphs](#reference/core/entities~body-morphs) · [motion/look](#reference/core/entities~motion-look) | covered |
| 148 | VRM avatars (humanoid bones, expressions, spring bones, look-at) | games, videos | [vrm](#reference/modules/human~vrm) | covered |
| 149 | human authoring: body, face, hair, clothing, poses, gaits, speech as sub-presets | games, videos | [body](#reference/modules/human~body) · [face](#reference/modules/human~face) · [hair](#reference/modules/human~hair) · [clothing](#reference/modules/human~clothing) · [poses](#reference/modules/human~poses) · [gaits](#reference/modules/human~gaits) · [speech](#reference/modules/human~speech) · [people](#reference/modules/human~people) | covered |
| 150 | animal presets: quadruped, bird, fish, reptile | ecology | [animals/quadruped](#reference/modules/presets~animals-quadruped) · [animals/bird](#reference/modules/presets~animals-bird) · [animals/fish](#reference/modules/presets~animals-fish) · [animals/reptile](#reference/modules/presets~animals-reptile) | covered |
| 151 | schedules that move entities between anchors (the operator: drive → park → walk → inspect → return) | games, energy maps, fleets | [agents/rhythm](#reference/core/simulation~agents-rhythm) · [agents/behaviour](#reference/core/simulation~agents-behaviour) · [placement/attach](#reference/core/entities~placement-attach) | covered |

### E. Physics and fields

| # | need | used by | → where | status |
|---|---|---|---|---|
| 49 | fields (raster / surface / graph / volume), observation-chosen resolution, conservation | city twins, hazard twins, physics labs | [fields/raster](#reference/core/simulation~fields-raster) · [fields/surface](#reference/core/simulation~fields-surface) · [fields/graph](#reference/core/simulation~fields-graph) · [fields/volume](#reference/core/simulation~fields-volume) · [presence](#reference/core/observation~presence) | covered |
| 50 | rules / kernels with a stdlib and slots (inject a formula, custom functions) | researchers, physics labs, city twins | [rules/presets](#reference/core/simulation~rules-presets) · [rules/custom](#reference/core/simulation~rules-custom) · [fields/kernels](#reference/core/simulation~fields-kernels) | covered |
| 51 | fluids: flow-1d, shallow water, wind / advection | games, hazard twins, city twins, physics labs | [phenomena/fluids](#reference/core/simulation~phenomena-fluids) · [water/hydrology/water](#reference/modules/earth~water-hydrology-water) | covered |
| 52 | heat: radiation, T_mrt, energy balance, canyon air, UTCI (a street heat lab as a rule) | city twins | [phenomena/heat](#reference/core/simulation~phenomena-heat) · [climate/heat](#reference/modules/earth~climate-heat) | covered |
| 53 | fire spread + smoke | hazard twins | [phenomena/fire](#reference/core/simulation~phenomena-fire) · [climate/fire](#reference/modules/earth~climate-fire) | covered |
| 54 | exchanges: quake lift, landslide, crater, magma, karst | physics labs, videos | [phenomena/exchanges](#reference/core/simulation~phenomena-exchanges) · [phenomena/growth](#reference/core/simulation~phenomena-growth) | covered |
| 55 | sound: soundscape, propagation, ambient life | games, videos | [phenomena/acoustics](#reference/core/simulation~phenomena-acoustics) · [life/soundscape](#reference/modules/earth~life-soundscape) | covered |
| 56 | sky: real Sun / Moon / stars / constellations for a place and time; picture locks | games, city twins, space, story tools | [surface/sky](#reference/modules/world~surface-sky) · [air/sky/sun](#reference/modules/earth~air-sky-sun) · [air/sky/moon](#reference/modules/earth~air-sky-moon) · [air/sky/stars](#reference/modules/earth~air-sky-stars) · [air/sky/cultures](#reference/modules/earth~air-sky-cultures) · [air/sky/locks](#reference/modules/earth~air-sky-locks) · [stars](#reference/modules/space~stars) · [constellations](#reference/modules/space~constellations) · [sky](#concepts/sky) | covered |
| 57 | atmosphere, weather, clouds, rain, wet ground, fog | games, city twins | [air/atmosphere/scattering](#reference/modules/earth~air-atmosphere-scattering) · [air/atmosphere/haze](#reference/modules/earth~air-atmosphere-haze) · [air/atmosphere/clouds](#reference/modules/earth~air-atmosphere-clouds) · [air/weather/presets](#reference/modules/earth~air-weather-presets) · [air/weather/wind](#reference/modules/earth~air-weather-wind) · [air/weather/rain](#reference/modules/earth~air-weather-rain) · [air/weather/fog](#reference/modules/earth~air-weather-fog) · [look/materials](#reference/core/render~look-materials) | covered |
| 58 | views into fields (shadows, sky view factor, visibility) | city twins | [phenomena/light](#reference/core/simulation~phenomena-light) · [look/shadows](#reference/core/render~look-shadows) | thin → **covered** (visibility added to light views) |
| 59 | lights: many small lights, night city, lit windows | games | [look/lights](#reference/core/render~look-lights) · [presets/built/lights](#reference/modules/earth~presets-built-lights) · [presets/built/lights/street](#reference/modules/earth~presets-built-lights-street) · [presets/built/lights/vehicle](#reference/modules/earth~presets-built-lights-vehicle) · [presets/built/lights/windows](#reference/modules/earth~presets-built-lights-windows) · [presets/built/buildings/windows](#reference/modules/earth~presets-built-buildings-windows) | covered |
| 60 | physics regimes declared; Coriolis | space, physics labs | [rules/regimes](#reference/core/simulation~rules-regimes) | GAP → **covered** (regimes and rotating frame (Coriolis)) |
| 61 | probes (virtual sensors), validation | city twins, researchers | [measure/probes](#reference/core/simulation~measure-probes) · [measure/sensors](#reference/core/simulation~measure-sensors) · [measure/validation](#reference/core/simulation~measure-validation) | covered |
| 62 | coupled systems, multi-rate, dirty propagation | city twins | [rules/coupling](#reference/core/simulation~rules-coupling) | thin → **covered** (per-field rate; recompute only when inputs change) |
| 63 | parameter libraries (materials, units, citable) | city twins, researchers | [constants](#reference/core/simulation~constants) | GAP → **covered** (citable constant tables with units and sources) |
| 152 | fidelity per rule: fixed (science, the whole basin) vs observed (picture) | city twins, hazard twins, physics labs | [fields/raster](#reference/core/simulation~fields-raster) · [presence](#reference/core/observation~presence) | covered |
| 190 NEW | rivers derived from the terrain (flow routing and accumulation, including the exposed shelf) as a data source drawn with `line` + `trace` | videos, physics labs, hazard twins | [water/hydrology/flow](#reference/modules/earth~water-hydrology-flow) · [marks/lines/line](#reference/core/encoding~marks-lines-line) · [reveal/modes](#reference/core/render~reveal-modes) | GAP → **covered** (water.flow) |

### F. Data, live, state

| # | need | used by | → where | status |
|---|---|---|---|---|
| 64 | one loader: tiers, scopes, offline, record / replay, readiness, temporary clearable caches | all | [loading/loader](#reference/core/data~loading-loader) · [loading/stores](#reference/core/data~loading-stores) · [loading/packs](#reference/core/data~loading-packs) · [loading/readiness](#reference/core/data~loading-readiness) | covered |
| 65 | stable feature ids, joins by id, revisions | dashboards, data maps, city twins, fleets | [features/features](#reference/core/data~features-features) · [query/join](#reference/core/data~query-join) | covered |
| 66 | live data: upsert / patch / remove; streams (sensors, WS, SSE) | fleets, dashboards, city twins | [live/set](#reference/core/data~live-set) · [live/upsert](#reference/core/data~live-upsert) · [live/patch](#reference/core/data~live-patch) · [live/remove](#reference/core/data~live-remove) · [sources/services/stream](#reference/core/data~sources-services-stream) | covered |
| 67 | chronicle: state(t) at any t, replay, checkpoints | fleets, dashboards, story tools, videos | [history/log](#reference/core/data~history-log) · [history/state-at](#reference/core/data~history-state-at) · [history/replay](#reference/core/data~history-replay) · [history/checkpoints](#reference/core/data~history-checkpoints) | covered |
| 68 | scenarios: base vs variant, diff, compare (interventions) | city twins, hazard twins | [scenarios/base](#reference/core/data~scenarios-base) · [scenarios/variant](#reference/core/data~scenarios-variant) · [scenarios/diff](#reference/core/data~scenarios-diff) · [scenarios/compare](#reference/core/data~scenarios-compare) | covered |
| 69 | headless world (Node, server, CI) with the same results | city twins, synthetic data, story tools | [lifecycle/world](#reference/core/world~lifecycle-world) · [world-and-body](#concepts/world-and-body) | covered |
| 70 | co-simulation with external engines (a fleet simulation's own engine, FMI) | fleets, researchers | [partners/external-engine](#reference/core/runtime~partners-external-engine) · [partners/fmi](#reference/core/runtime~partners-fmi) | covered |
| 71 | build-time baking; serve-time on demand | all, Zebflow apps | [bake](#reference/tools~bake) · [workers/compile](#reference/core/runtime~workers-compile) · [compile/run/command](#reference/tools~compile-run-command) | covered |
| 72 | attribution / licences per source; provider terms as permissions (show / prefetch / keep / export); credits on screen and in captures | public outputs | [rights/terms](#reference/core/data~rights-terms) · [rights/capabilities/show](#reference/core/data~rights-capabilities-show) · [rights/capabilities/prefetch](#reference/core/data~rights-capabilities-prefetch) · [rights/capabilities/keep](#reference/core/data~rights-capabilities-keep) · [rights/capabilities/export](#reference/core/data~rights-capabilities-export) · [rights/attribution](#reference/core/data~rights-attribution) · [rights/licences](#reference/core/data~rights-licences) | covered |
| 73 | geo analysis (buffer, zonal, contours, profiles, counts, scarp traces) | story tools, city twins, dashboards | [analysis/geo](#reference/modules/earth~analysis-geo) · [geo](#reference/tools~geo) | covered |
| 74 | network analysis: routing, isochrones, nearest destination | city twins, fleets, games | [networks/analysis/routing](#reference/core/geometry~networks-analysis-routing) · [networks/analysis/isochrones](#reference/core/geometry~networks-analysis-isochrones) · [networks/analysis/nearest](#reference/core/geometry~networks-analysis-nearest) | covered |
| 75 | ML on imagery → fields / features | dashboards | [analysis/learn](#reference/modules/earth~analysis-learn) | GAP → **covered** (classify / detect on imagery (ONNX in a worker)) |
| 153 | **external vector sources by URL:** `data.geojson / pmtiles / wfs / csv / mvt / stream`; your own arrays; `source.custom` | all | [sources/files/geojson](#reference/core/data~sources-files-geojson) · [sources/tiles/pmtiles](#reference/core/data~sources-tiles-pmtiles) · [sources/services/wfs](#reference/core/data~sources-services-wfs) · [sources/files/csv](#reference/core/data~sources-files-csv) · [sources/tiles/mvt](#reference/core/data~sources-tiles-mvt) · [sources/services/stream](#reference/core/data~sources-services-stream) · [sources/custom](#reference/core/data~sources-custom) | covered |
| 154 | **raster data layers:** `raster({ source: raster.xyz / cog / wms / pmtiles, ramp, opacity, blend })` stacked on the ground | energy maps, dashboards, hazard twins, city twins | [marks/areas/raster](#reference/core/encoding~marks-areas-raster) · [sources/tiles/xyz](#reference/core/data~sources-tiles-xyz) · [sources/tiles/cog](#reference/core/data~sources-tiles-cog) · [sources/tiles/wms](#reference/core/data~sources-tiles-wms) | covered |
| 155 | **query results:** `data.rows([])`, `rows.set(result)` updates colours / heights only; `data.query(s => fetch…, { when })` re-runs on view / time | dashboards, city twins | [features/rows](#reference/core/data~features-rows) · [query/query](#reference/core/data~query-query) · [live/set](#reference/core/data~live-set) · [loading/tiles](#reference/core/data~loading-tiles) | covered |
| 156 | geometry ⨝ rows by key: `suburbs.join(rows, { on })` | dashboards, city twins, data maps | [query/join](#reference/core/data~query-join) | covered |
| 157 | legend from the same scale | dashboards, city twins | [legend](#reference/kits/dashboard~legend) · [layers/legend](#reference/core/encoding~layers-legend) | covered |
| 158 | value transitions when data changes (`transition`) | dashboards, story tools | [elements/props](#reference/core/world~elements-props) | covered |
| 159 | truth overrides at read time (one corrections table at compile and at read) | city twins | [scenarios/overrides](#reference/core/data~scenarios-overrides) | GAP → **covered** (corrections table at compile and read) |
| 160 | **world compiler:** at edit / build time (auto after save, CLI), same build code as live, live building as fallback; inputs (authored data, raw sources, shapes, terrain); steps (solve → resolve → mesh → near / far chunks → solids → logic pack → manifest last with per-chunk hashes); stale detection | games, city twins | [compile/run/on-save](#reference/tools~compile-run-on-save) · [compile/run/command](#reference/tools~compile-run-command) · [compile/run/page](#reference/tools~compile-run-page) · [compile/inputs](#reference/tools~compile-inputs) · [compile/steps/solve](#reference/tools~compile-steps-solve) · [compile/steps/resolve](#reference/tools~compile-steps-resolve) · [compile/steps/mesh](#reference/tools~compile-steps-mesh) · [compile/steps/assign](#reference/tools~compile-steps-assign) · [compile/steps/solids](#reference/tools~compile-steps-solids) · [compile/steps/logic](#reference/tools~compile-steps-logic) · [compile/steps/manifest](#reference/tools~compile-steps-manifest) · [compile/custom-steps](#reference/tools~compile-custom-steps) · [compile/options](#reference/tools~compile-options) · [compile/stale](#reference/tools~compile-stale) · [compile/outputs](#reference/tools~compile-outputs) · [workers/compile](#reference/core/runtime~workers-compile) | covered |
| 161 | chunk streaming: manifest + logic pack at load; quadtree near camera; parent kept till children ready; swap only changed chunks by hash | games, city twins | [loading/chunks/manifest](#reference/core/data~loading-chunks-manifest) · [loading/chunks/logic-pack](#reference/core/data~loading-chunks-logic-pack) · [loading/chunks/near](#reference/core/data~loading-chunks-near) · [loading/chunks/far](#reference/core/data~loading-chunks-far) · [loading/chunks/format](#reference/core/data~loading-chunks-format) · [loading/chunks/streamer](#reference/core/data~loading-chunks-streamer) · [loading/chunks/hot-swap](#reference/core/data~loading-chunks-hot-swap) · [loading/chunks/fallback](#reference/core/data~loading-chunks-fallback) | covered |
| 192 NEW | time-varying layers from datasets (e.g. ice-sheet extent per epoch) chosen by the clock or `when` | videos, physics labs | [history/epochs](#reference/core/data~history-epochs) · [presence](#reference/core/observation~presence) | GAP → **covered** (data › history/epochs) |
| 193 NEW | an answer as a presentation: a saved state (camera, time, observation, layers shown with params and filters, selection) captured, applied with a camera flight and reveals, compared, checked by a schema, shared as a link | dashboards, presentations, assistants, city twins | [state/states](#reference/core/world~state-states) · [states](#concepts/states) | GAP → **covered** (core/world/state/states) |

### G. Time

| # | need | used by | → where | status |
|---|---|---|---|---|
| 76 | one clock: real / scaled / paused / scrubbed; events at times | all | [clock](#reference/core/time~clock) | covered |
| 77 | presentation time ↔ world time mapping | story tools, presentations | [clock](#reference/core/time~clock) · [boundaries](#concepts/boundaries) | covered |
| 78 | long ranges (centuries, geologic), calendars, time zones | story tools, space, games | [ranges](#reference/core/time~ranges) · [deep](#reference/core/time~deep) · [calendars](#reference/core/time~calendars) · [zones](#reference/core/time~zones) | thin → **covered** (time zones, deep time, paleo units) |
| 191 NEW | paleo time scales: years ago, ka, Ma, readable as counters | videos, physics labs | [deep](#reference/core/time~deep) · [ranges](#reference/core/time~ranges) | GAP → **covered** (time › deep) |

### H. Viewing, presence, camera

| # | need | used by | → where | status |
|---|---|---|---|---|
| 79 | observation decides detail for everything | all | [detail/detail](#reference/core/runtime~detail-detail) · [levels/ladder](#reference/core/observation~levels-ladder) · [levels/level](#reference/core/observation~levels-level) · [levels/binding](#reference/core/observation~levels-binding) · [observers/eyes](#reference/core/observation~observers-eyes) · [observers/sensor](#reference/core/observation~observers-sensor) · [observers/fixed](#reference/core/observation~observers-fixed) · [observation](#concepts/observation) | covered |
| 80 | budget / governor; aspects + priorities per app | games, city twins, phone users | [budget/budget](#reference/core/runtime~budget-budget) · [budget/governor](#reference/core/runtime~budget-governor) · [detail/priorities](#reference/core/runtime~detail-priorities) · [budget/memory](#reference/core/runtime~budget-memory) | covered |
| 81 | smooth zoom, no blank tiles (parents, fades, centre-out, prefetch); no frame shows what it shouldn't | all | [detail/prefetch](#reference/core/runtime~detail-prefetch) · [surface/tiles](#reference/modules/world~surface-tiles) | covered |
| 82 | camera modes: orbit / pan per app, WASD, follow, first person, drag up = look up | games, city twins, dashboards | [observers/orbit/views](#reference/core/observation~observers-orbit-views) · [observers/orbit/follow](#reference/core/observation~observers-orbit-follow) · [controllers](#reference/core/interaction~controllers) · [drive/player](#reference/core/entities~drive-player) | covered |
| 83 | camera in aslnut: views, keys, easing presets, paths, follow; **shots / composition / continuity → the story tool (outside)** | all, story tools | [observers/orbit/views](#reference/core/observation~observers-orbit-views) · [observers/orbit/keys](#reference/core/observation~observers-orbit-keys) · [observers/orbit/speed/easing](#reference/core/observation~observers-orbit-speed-easing) · [observers/orbit/paths](#reference/core/observation~observers-orbit-paths) · [observers/orbit/paths/line](#reference/core/observation~observers-orbit-paths-line) · [observers/orbit/paths/bezier](#reference/core/observation~observers-orbit-paths-bezier) · [observers/orbit/paths/spline](#reference/core/observation~observers-orbit-paths-spline) · [observers/orbit/paths/along](#reference/core/observation~observers-orbit-paths-along) · [observers/orbit/paths/circle](#reference/core/observation~observers-orbit-paths-circle) · [observers/orbit/aim](#reference/core/observation~observers-orbit-aim) · [observers/orbit/aim/look-at](#reference/core/observation~observers-orbit-aim-look-at) · [observers/orbit/aim/along-path](#reference/core/observation~observers-orbit-aim-along-path) · [observers/orbit/aim/heading](#reference/core/observation~observers-orbit-aim-heading) · [observers/orbit/aim/framing](#reference/core/observation~observers-orbit-aim-framing) · [observers/orbit/lens](#reference/core/observation~observers-orbit-lens) · [observers/orbit/lens/fov](#reference/core/observation~observers-orbit-lens-fov) · [observers/orbit/lens/focus](#reference/core/observation~observers-orbit-lens-focus) · [observers/orbit/lens/depth-of-field](#reference/core/observation~observers-orbit-lens-depth-of-field) · [observers/orbit/speed](#reference/core/observation~observers-orbit-speed) · [observers/orbit/speed/ease](#reference/core/observation~observers-orbit-speed-ease) · [observers/orbit/speed/constant](#reference/core/observation~observers-orbit-speed-constant) · [observers/orbit/speed/hold](#reference/core/observation~observers-orbit-speed-hold) · [observers/orbit/moves](#reference/core/observation~observers-orbit-moves) · [observers/orbit/moves/pan](#reference/core/observation~observers-orbit-moves-pan) · [observers/orbit/moves/tilt](#reference/core/observation~observers-orbit-moves-tilt) · [observers/orbit/moves/roll](#reference/core/observation~observers-orbit-moves-roll) · [observers/orbit/moves/dolly](#reference/core/observation~observers-orbit-moves-dolly) · [observers/orbit/moves/truck](#reference/core/observation~observers-orbit-moves-truck) · [observers/orbit/moves/pedestal](#reference/core/observation~observers-orbit-moves-pedestal) · [observers/orbit/moves/crane](#reference/core/observation~observers-orbit-moves-crane) · [observers/orbit/moves/zoom](#reference/core/observation~observers-orbit-moves-zoom) · [observers/orbit/moves/dolly-zoom](#reference/core/observation~observers-orbit-moves-dolly-zoom) · [observers/orbit/moves/arc](#reference/core/observation~observers-orbit-moves-arc) · [observers/orbit/moves/track](#reference/core/observation~observers-orbit-moves-track) · [observers/orbit/moves/chase](#reference/core/observation~observers-orbit-moves-chase) · [observers/orbit/moves/flyover](#reference/core/observation~observers-orbit-moves-flyover) · [observers/orbit/moves/reveal](#reference/core/observation~observers-orbit-moves-reveal) · [observers/orbit/moves/whip-pan](#reference/core/observation~observers-orbit-moves-whip-pan) · [observers/orbit/moves/rack-focus](#reference/core/observation~observers-orbit-moves-rack-focus) · [observers/orbit/moves/shake](#reference/core/observation~observers-orbit-moves-shake) · [observers/orbit/follow](#reference/core/observation~observers-orbit-follow) · [boundaries](#concepts/boundaries) | covered |
| 84 | prefetch along the path; motion-aware observation | story tools, games | [detail/prefetch](#reference/core/runtime~detail-prefetch) · [loading/readiness](#reference/core/data~loading-readiness) | covered |
| 85 | many views of one truth; pictures never change physics | city twins, synthetic data | [host/canvases](#reference/core/world~host-canvases) | GAP → **covered** (a second view of the same world) |
| 162 | **uniform `when` on every element** (sources, layers, features, labels, entities, shape levels): `(s) => boolean \| 0..1` (a fade), object shorthand `{ zoom, hour, year … }`, or a boolean | all | [presence](#reference/core/observation~presence) · [presence](#concepts/presence) | covered |
| 163 | **one state object `s`:** view (zoom, distance, tilt, bearing, centre, pixelSize, pixels), time (now, year, month, hour, season), world (params, readouts), user (selection, hover, toggles, role), device (gpu, budget, tier), render (quality) | all | [presence](#reference/core/observation~presence) · [presence](#concepts/presence) | covered |
| 164 | **exists vs shown:** existence gates (data present / filter / threshold / live, valid from-until, schedule, coverage, simulation state, scenario) separate from showing gates (observation, frustum, horizon, occlusion, cutaway, budget, label collision, relation, user toggle / selection / role, lens / mode, reveal, device, rights) | all | [presence](#reference/core/observation~presence) · [presence](#concepts/presence) | covered |
| 165 | **layer order:** by kind (basemap → rasters → areas → lines → points → labels) then add order; `order`, `above`, `below`, `w.move` | all | [elements/order](#reference/core/world~elements-order) · [elements/element](#reference/core/world~elements-element) · [layers/layer](#reference/core/encoding~layers-layer) · [layers/stack](#reference/core/encoding~layers-stack) · [order](#concepts/order) · [encoding](#concepts/encoding) | covered |
| 166 | React and plain JS with identical props (`when` closing over React state) | dashboards, fleets, city twins, Zebflow apps | [host/plain](#reference/core/world~host-plain) · [host/react](#reference/core/world~host-react) | covered |
| 167 | quality tiers: lite (default, phones, WebGL2) vs realistic (shadows, AO, materials, facades) chosen by `s` (device, zoom); per-layer looks by tier | all, showcase | [drawing/quality](#reference/core/render~drawing-quality) · [drawing/renderer](#reference/core/render~drawing-renderer) · [quality](#concepts/quality) | covered |
| 168 | the realism stack when needed: shadows → AO → anti-aliasing (TAA) → reflections, HDRI sky + grading, baked sky occlusion, interior-mapped windows, wet streets | city twins, games | [look/post](#reference/core/render~look-post) · [look/materials](#reference/core/render~look-materials) · [look/shadows](#reference/core/render~look-shadows) | thin → **covered** (TAA, reflections, HDRI, sky occlusion, interiors, wet) |

### I. Interaction and UI

| # | need | used by | → where | status |
|---|---|---|---|---|
| 96 | **hover / tap on any feature:** `hover` (look), `hoverGroup`, `tooltip`, `onHover`, `onTap`, `w.on('hover' \| 'tap')`, fields + source + licence | dashboards, city twins, data maps, games, editors | [picking/picking](#reference/core/interaction~picking-picking) · [picking/hover](#reference/core/interaction~picking-hover) · [events](#reference/core/interaction~events) | covered |
| 97 | reactive values (signals) | dashboards | [signals/signals](#reference/core/interaction~signals-signals) | thin → **covered** (signals are reactive values) |
| 98 | UI kits outside the core: legend, markers, labels (dashboard); avatars, collision (game) | dashboards, city twins, data maps, games | [legend](#reference/kits/dashboard~legend) · [cards](#reference/kits/dashboard~cards) · [layers/labels](#reference/core/encoding~layers-labels) · [avatars](#reference/kits/game~avatars) · [collision](#reference/kits/game~collision) | covered |
| 99 | mobile-first, collapsible UI | all | [boundaries](#concepts/boundaries) | thin → **outside** (boundary written) |
| 100 | in-world editing (zones, roads, assets) with history + hot reload | games, city twins | [history](#reference/core/interaction~history) · [extend/hot-swap](#reference/core/world~extend-hot-swap) · [networks](#reference/kits/authoring~networks) · [zones](#reference/kits/authoring~zones) · [rules](#reference/kits/authoring~rules) · [terraform](#reference/kits/authoring~terraform) · [diffs](#reference/kits/authoring~diffs) · [pieces](#reference/kits/authoring~pieces) | thin → **covered** (hot swap of code in open views) |
| 101 | timeline editor | story tools | [boundaries](#concepts/boundaries) | thin → **outside** (boundary written) |
| 169 | selection / isolate / highlight state usable by `when` and styles (`s.user.selection`) | dashboards, city twins | [signals/selection](#reference/core/interaction~signals-selection) | GAP → **covered** (select / isolate / highlight in `s.user`) |

### J. Reveal (now core, for every element)

| # | need | used by | → where | status |
|---|---|---|---|---|
| 87 | a reveal for every element: modes trace / pulse / trace-fill / grow / wipe / radial / sweep / pop / rise / ripple / type / count / mask / fade; glowing head, flash, highlight | story tools, all | [reveal/modes](#reference/core/render~reveal-modes) · [reveal/timing](#reference/core/render~reveal-timing) · [reveal/define](#reference/core/render~reveal-define) | covered |
| 170 | reveal context: rich in video, alpha fades in apps (`reveal: { video, app }`) | story tools, all | [reveal/modes](#reference/core/render~reveal-modes) | covered |
| 171 | reveal triggers: on add, when `when` turns true, when new rows arrive; hide = reverse; `w.reveal / w.hide` by hand | all | [reveal/modes](#reference/core/render~reveal-modes) | covered |
| 172 | reveal extension depths: 1 props (mode, dur, ease, from, stagger, order) · 2 your own order / timing function · 3 `reveal.define(name, { feature: (d, p) => … })` · 4 a shader hook (`wgsl` at `/*@reveal*/`) | all, researchers | [reveal/timing](#reference/core/render~reveal-timing) · [reveal/define](#reference/core/render~reveal-define) | covered |
| 173 | reveals cost ~nothing (one number per layer + a per-vertex order) | phone users | [reveal/modes](#reference/core/render~reveal-modes) · [reveal/policy](#reference/core/render~reveal-policy) · [reveal](#concepts/reveal) | covered |

### K. Telling and media (served by tools built on aslnut; aslnut exposes what they need)

| # | need | used by | → where | status |
|---|---|---|---|---|
| 86 | timeline anchored to spoken words; scenes; transitions | story tools, presentations | [boundaries](#concepts/boundaries) | thin → **outside** (boundary written) |
| 88 | overlays: captions, cards, counters, credits, legends, charts | story tools | [boundaries](#concepts/boundaries) · [legend](#reference/kits/dashboard~legend) · [layers/labels](#reference/core/encoding~layers-labels) | thin → **outside** (boundary written; the legend stays in the kit, names are a layer's labels) |
| 89 | elements as functions of state and time (same in twin and video) | story tools, hazard twins, dashboards | [settings/readouts](#reference/core/world~settings-readouts) · [settings/params](#reference/core/world~settings-params) · [elements/props](#reference/core/world~elements-props) | GAP → **covered** (params, readouts, named points as rows) |
| 90 | deterministic capture at any aspect | story tools, videos | [capture/capture](#reference/core/render~capture-capture) · [state/settled](#reference/core/world~state-settled) | thin → **covered** (strict settle; never a half-loaded frame) |
| 91 | audio: voice, music, effects, ducking, loudness | story tools | [boundaries](#concepts/boundaries) | thin → **outside** (boundary written) |
| 92 | presentation (steps) and scroll modes | story tools, presentations, dashboards | [boundaries](#concepts/boundaries) | thin → **outside** (boundary written) |
| 93 | visual catalog (4×4 sheets per element family) | studio apps, assistants | [catalog](#reference/tools~catalog) · [shapes/checks](#reference/core/geometry~shapes-checks) | thin → **covered** (catalog + level previews) |
| 94 | premium defaults (palette, easing, type, glow) | story tools, all | [style/theme](#reference/core/render~style-theme) · [style/pattern/fill](#reference/core/render~style-pattern-fill) · [style/pattern/stroke](#reference/core/render~style-pattern-stroke) · [style/pattern/along](#reference/core/render~style-pattern-along) | GAP → **covered** (themes: palette, type, easing, glow) |
| 95 | STT, voice isolation, reference-video analysis | studio apps | [boundaries](#concepts/boundaries) | thin → **outside** (boundary written) |
| 174 | **what aslnut must expose for a story tool built on it:** projection (`w.project`, `visible`), params / readouts / named points, `settled()` (strict), frame readback, camera control (views, keys, paths), `time` readable, readiness (plan / rehearse / replay), deterministic stepping, `dispose` | story tools | [project/project](#reference/core/render~project-project) · [project/visible](#reference/core/render~project-visible) · [settings/params](#reference/core/world~settings-params) · [settings/readouts](#reference/core/world~settings-readouts) · [settings/points](#reference/core/world~settings-points) · [state/settled](#reference/core/world~state-settled) · [capture/capture](#reference/core/render~capture-capture) · [observers/orbit/views](#reference/core/observation~observers-orbit-views) · [observers/orbit/keys](#reference/core/observation~observers-orbit-keys) · [observers/orbit/paths](#reference/core/observation~observers-orbit-paths) · [clock](#reference/core/time~clock) · [loading/readiness](#reference/core/data~loading-readiness) · [step](#reference/core/time~step) · [lifecycle/dispose](#reference/core/world~lifecycle-dispose) · [boundaries](#concepts/boundaries) | thin → **covered** (project, visible, settled, readback, stepping all listed) |

### L. Loading, performance, platform

| # | need | used by | → where | status |
|---|---|---|---|---|
| 102 | **WebGPU and WebGL2 both** (old phones): one interface; hand-written WGSL ↔ GLSL twins for aslnut's own shaders; parity check; compute WebGPU-only with CPU paths; WebGL2 defaults to lite | all | [graphics/interface](#reference/core/render~graphics-interface) · [graphics/webgpu](#reference/core/render~graphics-webgpu) · [graphics/webgl2](#reference/core/render~graphics-webgl2) · [graphics/shaders/wgsl](#reference/core/render~graphics-shaders-wgsl) · [graphics/shaders/glsl](#reference/core/render~graphics-shaders-glsl) · [graphics/parity](#reference/core/render~graphics-parity) · [checks/parity](#reference/tools~checks-parity) · [checks/twins](#reference/tools~checks-twins) · [checks/regressions](#reference/tools~checks-regressions) | covered |
| 103 | observation / telemetry panel; remote phone log; 📷 phone screenshots | all | [telemetry/telemetry](#reference/core/runtime~telemetry-telemetry) · [telemetry/remote-log](#reference/core/runtime~telemetry-remote-log) · [telemetry/shots](#reference/core/runtime~telemetry-shots) · [checks/suite](#reference/tools~checks-suite) · [checks/perf](#reference/tools~checks-perf) | thin → **covered** (remote log and phone shots) |
| 104 | lanes: workers, server lanes, rates apart from frame | games, city twins | [frame](#reference/core/runtime~frame) · [workers/workers](#reference/core/runtime~workers-workers) · [workers/servers](#reference/core/runtime~workers-servers) | covered |
| 105 | streaming / infinite world by grid; compiled chunks | games | [loading/chunks/streamer](#reference/core/data~loading-chunks-streamer) · [cells](#reference/core/space~cells) | covered |
| 106 | determinism (seeded), replay | all | [lifecycle/world](#reference/core/world~lifecycle-world) · [step](#reference/core/time~step) | GAP → **covered** (seed + fixed steps) |
| 107 | embedding: dispose, SSR-safe imports (Zebflow runs modules on the server), no import-time side effects | city twins, dashboards, data maps, Zebflow apps | [lifecycle/dispose](#reference/core/world~lifecycle-dispose) · [host/server-safe](#reference/core/world~host-server-safe) | covered |
| 108 | distributions: npm, React, Zeb React | all | [host/react](#reference/core/world~host-react) · [host/zebflow](#reference/core/world~host-zebflow) · [host/package](#reference/core/world~host-package) | covered |
| 175 | **user shader hooks** (reveal / extensions WGSL) must run on WebGL2 too → a small WGSL → GLSL writer for a hook subset (an open decision against "no translator") | researchers, all | [graphics/shaders/glsl](#reference/core/render~graphics-shaders-glsl) · [graphics/shaders/translate](#reference/core/render~graphics-shaders-translate) · [graphics/shaders/hooks](#reference/core/render~graphics-shaders-hooks) · [marks/custom](#reference/core/encoding~marks-custom) | thin → **covered** |
| 176 | `supported()` / capability profile; a clear unsupported message; a browser matrix | all | [graphics/caps](#reference/core/render~graphics-caps) | covered |
| 177 | shape builds off the main thread (worker), geometry preparation off the main thread | phone users | [workers/workers](#reference/core/runtime~workers-workers) · [shapes/instances](#reference/core/geometry~shapes-instances) | covered |

### M. Extensibility, agents, authoring

| # | need | used by | → where | status |
|---|---|---|---|---|
| 109 | customise without forking: props → hooks → provide → subclass, **applied to every element** | all, researchers | [extend/extend](#reference/core/world~extend-extend) · [extend/provide](#reference/core/world~extend-provide) · [extending](#concepts/extending) | covered |
| 110 | swap a formula in a slot | researchers, physics labs | [rules/custom](#reference/core/simulation~rules-custom) | covered |
| 111 | LLM-writable: typed, `describe`, schemas, `llms.txt`, errors that say the fix | all, studio apps | [describe/describe](#reference/core/world~describe-describe) · [describe/schemas](#reference/core/world~describe-schemas) · [describe/guide](#reference/core/world~describe-guide) · [lifecycle/errors](#reference/core/world~lifecycle-errors) · [checks/recipes](#reference/tools~checks-recipes) · [llms](#concepts/llms) | covered |
| 112 | JSON form of a world / shapes | studio apps, Zebflow apps, assistants | [state/json](#reference/core/world~state-json) · [describe/schemas](#reference/core/world~describe-schemas) | thin → **covered** (world to / from JSON) |
| 113 | agent CLI / MCP: new, validate, run headless, shot, probe, perf | studio apps | [cli](#reference/tools~cli) · [mcp](#reference/tools~mcp) | covered |
| 114 | rack / catalog with recipes (numbers not exposed as API) | studio apps, assistants | [catalog](#reference/tools~catalog) | GAP → **covered** (catalog of shapes, recipes, presets) |
| 115 | assistants write shape code; hot swap in open views | games, studio apps | [extend/hot-swap](#reference/core/world~extend-hot-swap) | GAP → **covered** (hot swap, checked in a worker) |
| 116 | low cognitive load: progressive disclosure, few words, plain words | all | [README](#README) | GAP → **covered** (how the docs are written, on the first page) |
| 178 | **custom functions are the blood:** every element accepts a constant, a function of feature / view / time, a provider factory, or your own implementation of the same small interface | all | [elements/props](#reference/core/world~elements-props) · [configurable](#concepts/configurable) | covered |
| 179 | `w.provide(name, Class)` by readable names (not rack numbers) | all, researchers | [extend/provide](#reference/core/world~extend-provide) | covered |
| 180 | docs as the contract: concepts + reference + a hierarchy map + a runtime flow, statuses built / partly / planned / proposed / open | all, assistants | [map](#map) · [reference](#reference/README) | covered |
| 181 | the person's flow is short: shape file → world in a page → entities with data → open the browser; nothing graphics-specific to write | all | [shapes/shape](#reference/core/geometry~shapes-shape) · [lifecycle/world](#reference/core/world~lifecycle-world) · [shapes](#concepts/shapes) | covered |

### N. Analysis and synthetic

| # | need | used by | → where | status |
|---|---|---|---|---|
| 117 | thematic maps, zonation, classify → ramp → legend | dashboards, data maps, city twins, hazard twins | [scales](#reference/core/encoding~scales) · [style/ramp](#reference/core/render~style-ramp) · [legend](#reference/kits/dashboard~legend) | covered |
| 118 | statistics per area (rank, normalise, per capita) | city twins, dashboards | [stats](#reference/kits/dashboard~stats) | GAP → **covered** (stats per area) |
| 119 | perception ground truth (segmentation, depth, boxes, COCO / KITTI) | synthetic data, dashboards | [capture/ground-truth](#reference/core/render~capture-ground-truth) | covered |
| 120 | simulate interventions | city twins | [scenarios/variant](#reference/core/data~scenarios-variant) · [rules/presets](#reference/core/simulation~rules-presets) | covered |
| 182 | scenario / experiment API (synchronous stepping, actors, sensors) for research and agents | fleets, researchers, synthetic data | [partners/experiment](#reference/core/runtime~partners-experiment) · [step](#reference/core/time~step) | thin → **covered** (a synchronous experiment socket) |

### O. Hosting and boundaries

| # | need | used by | → where | status |
|---|---|---|---|---|
| 183 | aslnut = only what creates and runs worlds; stories → a story tool built on aslnut (outside); studio apps and other apps outside | all | [boundaries](#concepts/boundaries) | GAP → **covered** (the boundaries page) |
| 184 | domain things never in core (no angkot, ruko, fault); they are presets in apps / modules / kits | all | [boundaries](#concepts/boundaries) | GAP → **covered** (the domain rule) |
| 185 | modules shared by several products (earth/infrastructure, earth/society, earth/ecology) by the promotion rule | all | [boundaries](#concepts/boundaries) · [life/society](#reference/modules/earth~life-society) · [life/ecology](#reference/modules/earth~life-ecology) · [presets/built/infrastructure/energy/wind-turbine](#reference/modules/earth~presets-built-infrastructure-energy-wind-turbine) · [shared](#reference/modules/world~shared) · [shared](#reference/modules/earth~shared) · [shared](#reference/modules/presets~shared) | GAP → **covered** (the promotion rule) |
| 186 | publishable package: ESM, d.ts, subpath exports, `sideEffects: false`, LICENSE, DATA-LICENCES, examples with redistributable data, CI with a headless WebGPU smoke test; private place data kept out | release | [host/package](#reference/core/world~host-package) · [checks/smoke](#reference/tools~checks-smoke) · [hosting](#concepts/hosting) | GAP → **covered** (the package section) |
| 187 | the repository made public after the 0.1 cleanup | release | a release step, not an interface | process |
| 194 NEW | code written for another web-map interface (Leaflet) runs on a world unchanged, each object a handle over the public parts; a few opt-in extras for what that interface cannot do | GIS apps moving to 3D, assistants | [boundaries](#concepts/boundaries) | GAP → **covered** (kits › compat › leaflet) |
