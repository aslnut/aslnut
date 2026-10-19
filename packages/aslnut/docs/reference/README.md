# Reference

> Draft under discussion. Statuses: [built] in `packages/aslnut`, tested on WebGPU and WebGL2; [partly] (some of it is there); [planned] (agreed, not there yet; a research prototype may exist); [proposed] (a new idea, not yet agreed), [open] (a question waiting for a decision). A group's status is summed from its items.

**In one line:** the whole library as one tree, with one page per part; every item on a page has a row with its signature, parameters, what it returns, its status and a one-line example.

**Not in aslnut:** telling stories with worlds (scripts, timelines, scenes, video overlays, sound, editing, output). That is built on aslnut, outside it.

The same tree, collapsible and linked to every row, is on [the map](../map.md).

<!-- tree:ALL -->
```tree
aslnut/
├── core/
│   ├── space/
│   │   ├── bodies
│   │   ├── frames/
│   │   │   ├── inertial
│   │   │   ├── body-fixed
│   │   │   ├── local
│   │   │   ├── object
│   │   │   └── re-rooting
│   │   ├── units
│   │   ├── precision
│   │   ├── cells
│   │   ├── ground/
│   │   │   ├── ground
│   │   │   ├── shells
│   │   │   └── volumes
│   │   ├── regions/
│   │   │   ├── tree
│   │   │   ├── rollup
│   │   │   └── pack
│   │   └── observer/
│   │       ├── light-time
│   │       ├── aberration
│   │       ├── doppler
│   │       └── ship-time
│   ├── time/
│   │   ├── clock
│   │   ├── step
│   │   ├── calendars
│   │   ├── scales
│   │   ├── zones
│   │   ├── ranges
│   │   └── deep
│   ├── data/
│   │   ├── sources/
│   │   │   ├── tiles/
│   │   │   │   ├── xyz
│   │   │   │   ├── cog
│   │   │   │   ├── wms
│   │   │   │   ├── pmtiles
│   │   │   │   └── mvt
│   │   │   ├── files/
│   │   │   │   ├── geojson
│   │   │   │   └── csv
│   │   │   ├── services/
│   │   │   │   ├── wfs
│   │   │   │   └── stream
│   │   │   └── custom
│   │   ├── loading/
│   │   │   ├── loader
│   │   │   ├── stores
│   │   │   ├── packs
│   │   │   ├── readiness
│   │   │   ├── tiles
│   │   │   └── chunks/
│   │   │       ├── manifest
│   │   │       ├── logic-pack
│   │   │       ├── near
│   │   │       ├── far
│   │   │       ├── format
│   │   │       ├── streamer
│   │   │       ├── hot-swap
│   │   │       └── fallback
│   │   ├── features/
│   │   │   ├── features
│   │   │   └── rows
│   │   ├── query/
│   │   │   ├── join
│   │   │   └── query
│   │   ├── live/
│   │   │   ├── set
│   │   │   ├── upsert
│   │   │   ├── patch
│   │   │   └── remove
│   │   ├── history/
│   │   │   ├── log
│   │   │   ├── state-at
│   │   │   ├── replay
│   │   │   ├── checkpoints
│   │   │   └── epochs
│   │   ├── scenarios/
│   │   │   ├── base
│   │   │   ├── variant
│   │   │   ├── diff
│   │   │   ├── compare
│   │   │   └── overrides
│   │   └── rights/
│   │       ├── terms
│   │       ├── capabilities/
│   │       │   ├── show
│   │       │   ├── prefetch
│   │       │   ├── keep
│   │       │   └── export
│   │       ├── attribution
│   │       └── licences
│   ├── observation/
│   │   ├── observers/
│   │   │   ├── orbit/
│   │   │   │   ├── views
│   │   │   │   ├── keys
│   │   │   │   ├── paths/
│   │   │   │   │   ├── line
│   │   │   │   │   ├── bezier
│   │   │   │   │   ├── spline
│   │   │   │   │   ├── along
│   │   │   │   │   └── circle
│   │   │   │   ├── aim/
│   │   │   │   │   ├── look-at
│   │   │   │   │   ├── along-path
│   │   │   │   │   ├── heading
│   │   │   │   │   └── framing
│   │   │   │   ├── lens/
│   │   │   │   │   ├── fov
│   │   │   │   │   ├── focus
│   │   │   │   │   └── depth-of-field
│   │   │   │   ├── speed/
│   │   │   │   │   ├── easing
│   │   │   │   │   ├── ease
│   │   │   │   │   ├── constant
│   │   │   │   │   └── hold
│   │   │   │   ├── moves/
│   │   │   │   │   ├── pan
│   │   │   │   │   ├── tilt
│   │   │   │   │   ├── roll
│   │   │   │   │   ├── dolly
│   │   │   │   │   ├── truck
│   │   │   │   │   ├── pedestal
│   │   │   │   │   ├── crane
│   │   │   │   │   ├── zoom
│   │   │   │   │   ├── dolly-zoom
│   │   │   │   │   ├── arc
│   │   │   │   │   ├── track
│   │   │   │   │   ├── chase
│   │   │   │   │   ├── flyover
│   │   │   │   │   ├── reveal
│   │   │   │   │   ├── whip-pan
│   │   │   │   │   ├── rack-focus
│   │   │   │   │   └── shake
│   │   │   │   ├── follow
│   │   │   │   └── acrobatic
│   │   │   ├── eyes
│   │   │   ├── sensor
│   │   │   └── fixed
│   │   ├── levels/
│   │   │   ├── ladder
│   │   │   ├── level
│   │   │   └── binding
│   │   ├── gates/
│   │   │   ├── margin
│   │   │   ├── dwell
│   │   │   └── keep
│   │   └── presence
│   ├── geometry/
│   │   ├── shapes/
│   │   │   ├── shape
│   │   │   ├── builder/
│   │   │   │   ├── solid
│   │   │   │   ├── extrude
│   │   │   │   ├── lathe
│   │   │   │   ├── sweep
│   │   │   │   ├── copy
│   │   │   │   ├── scope
│   │   │   │   └── mesh
│   │   │   ├── parts
│   │   │   ├── levels/
│   │   │   │   ├── full
│   │   │   │   ├── simple
│   │   │   │   ├── box
│   │   │   │   ├── dot
│   │   │   │   ├── counted
│   │   │   │   └── impostor
│   │   │   ├── instances
│   │   │   ├── checks
│   │   │   └── recipes/
│   │   │       ├── branching
│   │   │       ├── kitbash
│   │   │       ├── presets
│   │   │       └── package
│   │   ├── import/
│   │   │   ├── gltf
│   │   │   ├── gltf-extensions/
│   │   │   │   ├── draco
│   │   │   │   ├── meshopt
│   │   │   │   ├── ktx2
│   │   │   │   ├── lights
│   │   │   │   └── variants
│   │   │   ├── obj
│   │   │   ├── ply
│   │   │   ├── tiles3d
│   │   │   ├── splats
│   │   │   └── pointcloud
│   │   ├── landform/
│   │   │   ├── compose/
│   │   │   │   ├── layers
│   │   │   │   ├── footprints
│   │   │   │   ├── exclusion
│   │   │   │   ├── ground
│   │   │   │   ├── foundation
│   │   │   │   └── fidelity
│   │   │   └── terraform/
│   │   │       ├── flatten
│   │   │       ├── carve
│   │   │       ├── raise
│   │   │       ├── smooth
│   │   │       ├── sweep
│   │   │       ├── stamp
│   │   │       └── erode
│   │   ├── networks/
│   │   │   ├── analysis/
│   │   │   │   ├── graph
│   │   │   │   ├── routing
│   │   │   │   ├── isochrones
│   │   │   │   └── nearest
│   │   │   ├── lanes
│   │   │   ├── walkways
│   │   │   ├── sections
│   │   │   ├── junctions
│   │   │   ├── structures/
│   │   │   │   ├── bridges
│   │   │   │   ├── piers
│   │   │   │   ├── culverts
│   │   │   │   ├── decks
│   │   │   │   ├── stairs
│   │   │   │   ├── walls
│   │   │   │   ├── terraces
│   │   │   │   ├── ramps
│   │   │   │   └── railings
│   │   │   └── clamp
│   │   └── zones/
│   │       ├── booleans
│   │       ├── kinds
│   │       └── rules/
│   │           ├── scatter
│   │           └── frontage
│   ├── encoding/
│   │   ├── marks/
│   │   │   ├── symbols/
│   │   │   │   ├── point
│   │   │   │   ├── icon
│   │   │   │   └── text
│   │   │   ├── lines/
│   │   │   │   ├── line
│   │   │   │   ├── arc
│   │   │   │   ├── trail
│   │   │   │   └── arrows
│   │   │   ├── areas/
│   │   │   │   ├── area
│   │   │   │   ├── extrusion
│   │   │   │   ├── raster
│   │   │   │   ├── grid
│   │   │   │   └── rings
│   │   │   ├── drape
│   │   │   └── custom
│   │   ├── scales
│   │   ├── layers/
│   │   │   ├── layer
│   │   │   ├── labels
│   │   │   ├── legend
│   │   │   └── stack
│   │   └── join
│   ├── render/
│   │   ├── graphics/
│   │   │   ├── interface
│   │   │   ├── webgpu
│   │   │   ├── webgl2
│   │   │   ├── caps
│   │   │   ├── shaders/
│   │   │   │   ├── wgsl
│   │   │   │   ├── glsl
│   │   │   │   ├── translate
│   │   │   │   └── hooks
│   │   │   └── parity
│   │   ├── drawing/
│   │   │   ├── renderer
│   │   │   ├── instancing
│   │   │   ├── text
│   │   │   └── quality
│   │   ├── look/
│   │   │   ├── materials
│   │   │   ├── lights
│   │   │   ├── shadows
│   │   │   ├── post
│   │   │   └── cutaway
│   │   ├── style/
│   │   │   ├── ramp
│   │   │   ├── blend
│   │   │   ├── lens
│   │   │   ├── theme
│   │   │   └── pattern/
│   │   │       ├── fill
│   │   │       ├── stroke
│   │   │       └── along
│   │   ├── project/
│   │   │   ├── project
│   │   │   └── visible
│   │   ├── reveal/
│   │   │   ├── modes
│   │   │   ├── timing
│   │   │   ├── define
│   │   │   └── policy
│   │   └── capture/
│   │       ├── capture
│   │       └── ground-truth
│   ├── interaction/
│   │   ├── picking/
│   │   │   ├── picking
│   │   │   └── hover
│   │   ├── events
│   │   ├── signals/
│   │   │   ├── signals
│   │   │   └── selection
│   │   ├── controllers
│   │   └── history
│   ├── entities/
│   │   ├── sets/
│   │   │   ├── sets
│   │   │   └── crowds
│   │   ├── identity/
│   │   │   ├── id
│   │   │   ├── kind
│   │   │   └── data
│   │   ├── placement/
│   │   │   ├── place
│   │   │   ├── thing
│   │   │   └── attach
│   │   ├── locomotion/
│   │   │   ├── none
│   │   │   ├── rail
│   │   │   ├── lanes
│   │   │   ├── surface
│   │   │   ├── air
│   │   │   └── water
│   │   ├── kinematics/
│   │   │   ├── hinge
│   │   │   ├── slider
│   │   │   ├── wheel
│   │   │   ├── ball
│   │   │   └── custom
│   │   ├── body/
│   │   │   ├── skeleton
│   │   │   ├── skin
│   │   │   └── morphs
│   │   ├── motion/
│   │   │   ├── states
│   │   │   ├── clips
│   │   │   ├── poses
│   │   │   ├── ik
│   │   │   ├── gaits
│   │   │   ├── blending
│   │   │   └── look
│   │   └── drive/
│   │       ├── schedule
│   │       ├── simulation
│   │       ├── data
│   │       ├── player
│   │       └── script
│   ├── simulation/
│   │   ├── agents/
│   │   │   ├── behaviour
│   │   │   ├── rhythm
│   │   │   ├── habitat
│   │   │   ├── senses
│   │   │   ├── populations
│   │   │   └── tiers
│   │   ├── fields/
│   │   │   ├── raster
│   │   │   ├── surface
│   │   │   ├── graph
│   │   │   ├── volume
│   │   │   └── kernels
│   │   ├── rules/
│   │   │   ├── presets
│   │   │   ├── custom
│   │   │   ├── coupling
│   │   │   └── regimes
│   │   ├── fidelity/
│   │   │   ├── fixed
│   │   │   └── observed
│   │   ├── measure/
│   │   │   ├── probes
│   │   │   ├── sensors
│   │   │   └── validation
│   │   ├── constants
│   │   └── phenomena/
│   │       ├── heat
│   │       ├── fluids
│   │       ├── fire
│   │       ├── light
│   │       ├── acoustics
│   │       ├── contacts
│   │       ├── orbits/
│   │       │   ├── ephemerides
│   │       │   ├── tle
│   │       │   ├── n-body
│   │       │   └── transfers
│   │       ├── exchanges
│   │       └── growth
│   ├── world/
│   │   ├── elements/
│   │   │   ├── element
│   │   │   ├── props
│   │   │   └── order
│   │   ├── settings/
│   │   │   ├── params
│   │   │   ├── readouts
│   │   │   └── points
│   │   ├── state/
│   │   │   ├── states
│   │   │   ├── settled
│   │   │   └── json
│   │   ├── describe/
│   │   │   ├── describe
│   │   │   ├── schemas
│   │   │   └── guide
│   │   ├── extend/
│   │   │   ├── extend
│   │   │   ├── provide
│   │   │   └── hot-swap
│   │   ├── lifecycle/
│   │   │   ├── world
│   │   │   ├── errors
│   │   │   └── dispose
│   │   └── host/
│   │       ├── canvases
│   │       ├── plain
│   │       ├── react
│   │       ├── zebflow
│   │       ├── server-safe
│   │       └── package
│   └── runtime/
│       ├── frame
│       ├── detail/
│       │   ├── detail
│       │   ├── priorities
│       │   └── prefetch
│       ├── budget/
│       │   ├── budget
│       │   ├── governor
│       │   └── memory
│       ├── workers/
│       │   ├── workers
│       │   ├── servers
│       │   └── compile
│       ├── partners/
│       │   ├── external-engine
│       │   ├── fmi
│       │   └── experiment
│       └── telemetry/
│           ├── telemetry
│           ├── remote-log
│           └── shots
├── modules/
│   ├── shared
│   ├── world/
│   │   ├── surface/
│   │   │   ├── tiles
│   │   │   ├── imagery
│   │   │   ├── terrain
│   │   │   ├── street-detail
│   │   │   ├── provenance
│   │   │   └── sky
│   │   ├── plane
│   │   ├── sun
│   │   ├── earth/
│   │   │   ├── shared
│   │   │   ├── body/
│   │   │   │   ├── earth
│   │   │   │   └── base/
│   │   │   │       ├── imagery/
│   │   │   │       │   ├── esri
│   │   │   │       │   ├── osm
│   │   │   │       │   ├── sentinel
│   │   │   │       │   ├── mapbox
│   │   │   │       │   └── custom
│   │   │   │       ├── terrain/
│   │   │   │       │   ├── mapzen
│   │   │   │       │   ├── grid
│   │   │   │       │   ├── gebco
│   │   │   │       │   ├── etopo
│   │   │   │       │   ├── lidar
│   │   │   │       │   └── custom
│   │   │   │       ├── basemap
│   │   │   │       ├── coast
│   │   │   │       └── offline
│   │   │   ├── ground/
│   │   │   │   ├── terrain/
│   │   │   │   │   ├── terraform
│   │   │   │   │   └── looks
│   │   │   │   └── subsurface/
│   │   │   │       ├── strata
│   │   │   │       ├── wells
│   │   │   │       ├── aquifers
│   │   │   │       └── magma
│   │   │   ├── air/
│   │   │   │   ├── atmosphere/
│   │   │   │   │   ├── scattering
│   │   │   │   │   ├── haze
│   │   │   │   │   └── clouds
│   │   │   │   ├── weather/
│   │   │   │   │   ├── presets
│   │   │   │   │   ├── wind
│   │   │   │   │   ├── rain
│   │   │   │   │   └── fog
│   │   │   │   └── sky/
│   │   │   │       ├── sun
│   │   │   │       ├── moon
│   │   │   │       ├── stars
│   │   │   │       ├── cultures
│   │   │   │       └── locks
│   │   │   ├── water/
│   │   │   │   ├── hydrology/
│   │   │   │   │   ├── water
│   │   │   │   │   ├── flow
│   │   │   │   │   └── channels
│   │   │   │   └── sea/
│   │   │   │       ├── level
│   │   │   │       ├── shore
│   │   │   │       ├── look
│   │   │   │       └── exposed
│   │   │   ├── climate/
│   │   │   │   ├── heat
│   │   │   │   └── fire
│   │   │   ├── life/
│   │   │   │   ├── society
│   │   │   │   ├── ecology
│   │   │   │   ├── places/
│   │   │   │   │   ├── lots
│   │   │   │   │   └── blocks
│   │   │   │   └── soundscape
│   │   │   ├── analysis/
│   │   │   │   ├── geo
│   │   │   │   └── learn
│   │   │   └── presets/
│   │   │       ├── built/
│   │   │       │   ├── roads/
│   │   │       │   │   ├── sections
│   │   │       │   │   ├── junctions
│   │   │       │   │   ├── markings
│   │   │       │   │   ├── decks
│   │   │       │   │   ├── sidewalks
│   │   │       │   │   └── elevated
│   │   │       │   ├── rail/
│   │   │       │   │   ├── track
│   │   │       │   │   ├── crossings
│   │   │       │   │   ├── viaducts
│   │   │       │   │   └── stations
│   │   │       │   ├── buildings/
│   │   │       │   │   ├── footprints
│   │   │       │   │   ├── cityjson
│   │   │       │   │   ├── typology
│   │   │       │   │   ├── facades
│   │   │       │   │   ├── roofs
│   │   │       │   │   ├── windows
│   │   │       │   │   ├── frontage
│   │   │       │   │   ├── landmarks
│   │   │       │   │   └── interiors
│   │   │       │   ├── furniture/
│   │   │       │   │   ├── benches
│   │   │       │   │   ├── bollards
│   │   │       │   │   ├── bins
│   │   │       │   │   ├── umbrellas
│   │   │       │   │   ├── signs
│   │   │       │   │   └── planters
│   │   │       │   ├── infrastructure/
│   │   │       │   │   ├── energy/
│   │   │       │   │   │   ├── wind-turbine
│   │   │       │   │   │   ├── solar-farm
│   │   │       │   │   │   ├── pylon
│   │   │       │   │   │   └── substation
│   │   │       │   │   ├── mobility/
│   │   │       │   │   │   └── charger
│   │   │       │   │   └── utilities/
│   │   │       │   │       ├── pole
│   │   │       │   │       ├── lines
│   │   │       │   │       ├── pipe
│   │   │       │   │       └── cabinet
│   │   │       │   └── lights/
│   │   │       │       ├── street
│   │   │       │       ├── vehicle
│   │   │       │       └── windows
│   │   │       ├── mobility/
│   │   │       │   ├── traffic
│   │   │       │   ├── signals
│   │   │       │   └── transit
│   │   │       └── living/
│   │   │           └── plants/
│   │   │               ├── species
│   │   │               ├── growth
│   │   │               ├── sway
│   │   │               └── canopy
│   │   ├── moon
│   │   ├── mars
│   │   └── space/
│   │       ├── satellites/
│   │       │   └── tle
│   │       ├── asteroids
│   │       ├── stars
│   │       ├── constellations
│   │       ├── galaxies
│   │       └── exoplanets
│   └── presets/
│       ├── shared/
│       │   └── locomotion/
│       │       ├── lane-follower
│       │       ├── rail-follower
│       │       └── walker
│       ├── humans/
│       │   ├── body
│       │   ├── face
│       │   ├── expressions/
│       │   │   ├── emotions
│       │   │   ├── visemes
│       │   │   ├── gestures
│       │   │   └── blink
│       │   ├── hair
│       │   ├── clothing
│       │   ├── poses
│       │   ├── gaits
│       │   ├── people
│       │   ├── speech
│       │   └── vrm
│       ├── animals/
│       │   ├── quadruped
│       │   ├── bird
│       │   ├── fish
│       │   └── reptile
│       ├── vehicles/
│       │   ├── car
│       │   ├── motorbike
│       │   ├── bus
│       │   ├── minibus
│       │   └── train
│       ├── drones
│       └── robots/
│           ├── robot
│           └── android
├── kits/
│   ├── dashboard/
│   │   ├── legend
│   │   ├── cards
│   │   ├── stats
│   │   └── layers
│   ├── game/
│   │   ├── avatars
│   │   └── collision
│   └── authoring/
│       ├── networks
│       ├── zones
│       ├── rules
│       ├── terraform
│       ├── diffs
│       └── pieces
└── tools/
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

## Pages

| root | pages |
|---|---|
| core | [world](core/world.md) · [space](core/space.md) · [time](core/time.md) · [data](core/data.md) · [geometry](core/geometry.md) · [entities](core/entities.md) · [simulation](core/simulation.md) · [render](core/render.md) · [interaction](core/interaction.md) · [runtime](core/runtime.md) |
| modules | [world](modules/world.md) · [earth](modules/earth.md) · [space](modules/space.md) · [presets](modules/presets.md) · [humans](modules/human.md) |
| kits | [dashboard](kits/dashboard.md) · [game](kits/game.md) · [authoring](kits/authoring.md) |
| tools | [tools](tools.md) |

## How to read a page

- **The tree** at the top is that part's full subtree, generated from the same source as this page and the map.
- **The API table** has one row per item. The first column is the item's path inside the page (`graphics/webgpu`), so the map can link straight to it.
- **params** are written `name: type = default`; `?` means optional.
- `s` is the state every function can read: `view`, `time`, `world`, `user`, `device`, `render` (see [presence](../concepts/presence.md)).
- `d` is one feature: `{ id, props, geometry }`.
- `Fn<T>` means the value can be a constant, `d => T`, `s => T`, or `(d, s) => T` (see [configurable](../concepts/configurable.md)).
