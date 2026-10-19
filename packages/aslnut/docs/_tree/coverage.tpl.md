# Coverage: every need, checked against this design

> Audit of 2026-10-11. The acceptance test is a list of needs gathered before the design (187 needs, forces, 17 conflicts), plus 5 needs found since (a reference video). Made by `_tree/audit.py`, which checks every link against the real rows.

**In one line:** every need now has a place in the design: 183 covered, 7 served outside aslnut on purpose, 1 waiting for a decision, 1 a release step. Nothing in the reference is without a reason.

## Summary

| | before | after |
|---|---|---|
| needs | 187 | {{TOTAL}} (5 new) |
| status | {{BEFORE}} | {{AFTER}} |
| API rows | 346 | {{ROWS}} |
| rows with no need | 8 | {{ORPHANS}} |
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
| physics | complete: fields, rules, multi-rate coupling, regimes, citable constants, fidelity, probes; sea level and river flow | [physics](#concepts/physics), [phenomena](#reference/core/simulation) |
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

{{KEY}}

Status: **covered** (an interface serves it) · **thin** (mentioned, not enough) · **GAP** (missing) · **outside** (served by tools built on aslnut; the boundary is written) · **open** (a decision) · **process** (a release step, not an interface).
{{TABLE}}
