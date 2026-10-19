# modules › world

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist).

**In one line:** the bodies a world can stand on (a flat plane, the Sun, the Earth, the Moon, Mars) and their shared surface (tiles, imagery, terrain); Earth and space have their own pages; ready-made things for any world are on [presets](presets.md).

Concepts: [world and body](../../concepts/world-and-body.md) · [space](../../concepts/space.md) · [configurable](../../concepts/configurable.md)

Also on this page: `modules/shared`, what every module shares.

Modules hold two kinds of thing: bodies with their natural systems (`world`: a default form you can change), and **presets**, ready-made things. `presets` is always the last child of its node, holds only things built with the public API, and lives at the most general level where it still makes sense: `modules.presets` for any world (humans, animals, vehicles, drones, robots), `modules.world.earth.presets` for Earth's (roads, buildings, plants…). Small value presets stay inside their part; each preset has its own import; heavy assets come from the catalog, never bundled. See [presets](presets.md) and the [boundaries](../../concepts/boundaries.md#the-rules).

<!-- tree:reference/modules/world -->
```tree
world/
├── surface/
│   ├── tiles
│   ├── imagery
│   ├── terrain
│   ├── street-detail
│   ├── provenance
│   └── sky
├── plane
├── sun
├── earth/
│   ├── shared
│   ├── body/
│   │   ├── earth
│   │   └── base/
│   │       ├── imagery/
│   │       │   ├── esri
│   │       │   ├── osm
│   │       │   ├── sentinel
│   │       │   ├── mapbox
│   │       │   └── custom
│   │       ├── terrain/
│   │       │   ├── mapzen
│   │       │   ├── grid
│   │       │   ├── gebco
│   │       │   ├── etopo
│   │       │   ├── lidar
│   │       │   └── custom
│   │       ├── basemap
│   │       ├── coast
│   │       └── offline
│   ├── ground/
│   │   ├── terrain/
│   │   │   ├── terraform
│   │   │   └── looks
│   │   └── subsurface/
│   │       ├── strata
│   │       ├── wells
│   │       ├── aquifers
│   │       └── magma
│   ├── air/
│   │   ├── atmosphere/
│   │   │   ├── scattering
│   │   │   ├── haze
│   │   │   └── clouds
│   │   ├── weather/
│   │   │   ├── presets
│   │   │   ├── wind
│   │   │   ├── rain
│   │   │   └── fog
│   │   └── sky/
│   │       ├── sun
│   │       ├── moon
│   │       ├── stars
│   │       ├── cultures
│   │       └── locks
│   ├── water/
│   │   ├── hydrology/
│   │   │   ├── water
│   │   │   ├── flow
│   │   │   └── channels
│   │   └── sea/
│   │       ├── level
│   │       ├── shore
│   │       ├── look
│   │       └── exposed
│   ├── climate/
│   │   ├── heat
│   │   └── fire
│   ├── life/
│   │   ├── society
│   │   ├── ecology
│   │   ├── places/
│   │   │   ├── lots
│   │   │   └── blocks
│   │   └── soundscape
│   ├── analysis/
│   │   ├── geo
│   │   └── learn
│   └── presets/
│       ├── built/
│       │   ├── roads/
│       │   │   ├── sections
│       │   │   ├── junctions
│       │   │   ├── markings
│       │   │   ├── decks
│       │   │   ├── sidewalks
│       │   │   └── elevated
│       │   ├── rail/
│       │   │   ├── track
│       │   │   ├── crossings
│       │   │   ├── viaducts
│       │   │   └── stations
│       │   ├── buildings/
│       │   │   ├── footprints
│       │   │   ├── cityjson
│       │   │   ├── typology
│       │   │   ├── facades
│       │   │   ├── roofs
│       │   │   ├── windows
│       │   │   ├── frontage
│       │   │   ├── landmarks
│       │   │   └── interiors
│       │   ├── furniture/
│       │   │   ├── benches
│       │   │   ├── bollards
│       │   │   ├── bins
│       │   │   ├── umbrellas
│       │   │   ├── signs
│       │   │   └── planters
│       │   ├── infrastructure/
│       │   │   ├── energy/
│       │   │   │   ├── wind-turbine
│       │   │   │   ├── solar-farm
│       │   │   │   ├── pylon
│       │   │   │   └── substation
│       │   │   ├── mobility/
│       │   │   │   └── charger
│       │   │   └── utilities/
│       │   │       ├── pole
│       │   │       ├── lines
│       │   │       ├── pipe
│       │   │       └── cabinet
│       │   └── lights/
│       │       ├── street
│       │       ├── vehicle
│       │       └── windows
│       ├── mobility/
│       │   ├── traffic
│       │   ├── signals
│       │   └── transit
│       └── living/
│           └── plants/
│               ├── species
│               ├── growth
│               ├── sway
│               └── canopy
├── moon
├── mars
└── space/
    ├── satellites/
    │   └── tle
    ├── asteroids
    ├── stars
    ├── constellations
    ├── galaxies
    └── exoplanets
```
<!-- /tree -->

## API

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `shared` | `modules/shared`: the body interface, preset loading, units and attribution helpers every module uses | — | — | [planned] | `import { definePreset } from 'aslnut/modules/shared'` |
| `surface/tiles` | automatic for every body with a surface | `error?: number = 2` (pixels) · `maxZoom?: int = 19` · `skirts?: boolean = true` | a screen-size quadtree of tiles, parents kept while children load; its texture pools by need (Law 13): the imagery pool from 32 layers (256 kB each), grown in steps of 16 when a view needs more tiles than it holds with room to spare (0.6 of them), its layers copied over (nothing loaded again); the draped marks' overlay pool (512 × 512, 1 MB a layer) only for the tiles the marks lie on (their boxes; the rest show none), in steps of 8, grown the same way; both capped by the profile (lite: 128 imagery, 64 overlay layers; else 192 and 128) and the device's memory (`navigator.deviceMemory` 2 GB: 64 and 32; 4 GB: 64 overlay); at the cap, the ground beyond the view's centre is made coarser first, step by step (a tilted view's far side), the centre and what is nearer keeping their detail, then every tile a little bigger | [built] | `earth({ surface: { error: 1.5 } })` |
| `surface/imagery` | `imagery: Imagery[]` on a body | list of providers · per item `where?: Area` · `when?: When` · `opacity?: number = 1` · `blend?` | — | [built] | `earth({ imagery: [imagery.esri(), imagery.xyz(url, { where: city })] })` |
| `surface/terrain` | `terrain: Terrain[]` on a body | list of providers · `exaggerate?: Fn<number> = 1` · per item `where?` · `blend?: metres` | — | [built] | `earth({ terrain: [terrain.mapzen(), terrain.grid({ url, where })] })` |
| `surface/street-detail` | `streetDetail({ url, build })` · `streets({ url })` (earth) | `street?: { kerbs, markings, furniture } \| false` | street-level detail added only when near | [built] (`streetDetail({ url, build })`: square tiles fetched and built round the camera when it comes close, nearest first, a few milliseconds a frame, far ones dropped; built into solids by your function, at once or in workers (`worker`: core › runtime › workers; builds started as the lane has room, two a worker, so one the view left behind waits for none; their answers put inside the frames, `putMs` = 3 a frame shared by the world's streamed layers (one left out two frames running puts one anyway); an answer for a tile no longer wanted let go; its chunks' ground read again when the terrain changes, `groundMs` = 3 a frame, those in view first, the nearest first, not settled until each is read whole at the same terrain); `rebuild()`, `built()`; earth's `streets()` gives a city's from open data) | `world(canvas, { street: { furniture: false } })` |
| `surface/provenance` | `terrain.grid({ kind })` · `w.ground.source(p)` | `kind?: 'dtm' \| 'dsm' = 'dtm'` (bare ground vs with roofs and trees) | `{ provider, kind, res, date }` for any point | [planned] | `w.ground.source([107.6, -6.9])` |
| `surface/sky` | `new Sky(props?)` (added by the body) | `space?: rgb` · `glow?: rgb` (round the globe) · `horizon?, zenith?: rgb` (over the flat map) · `stars?: number` | one full-screen pass behind the surface: space, stars and the glow round the globe; a horizon-to-zenith sky over the flat map | [built] | `new Sky({ stars: .6 })` |
| `plane` | `plane(options)` | `size?: number = 1000` (metres) · `grid?: number \| false = 10` · `color?: color = '#eee'` · `units?: 'm' = 'm'` | `Body` (flat, no curvature) | [built] | `world(canvas, { body: plane({ size: 50 }) })` |
| `sun` | `sun(options?)` | `light?: boolean = true` · `position?: 'real' \| [az, alt] = 'real'` · `surface?: boolean = false` | `Body` and the light source | [planned] (a research prototype exists) | `world(canvas, { bodies: [sun(), earth()] })` |
| `moon` | `moon(options?)` | `imagery?: Imagery[] = [imagery.lroc()]` · `terrain?: Terrain[] = [terrain.lola()]` | `Body` | [planned] | `world(canvas, { body: moon() })` |
| `mars` | `mars(options?)` | `imagery?: Imagery[] = [imagery.ctx()]` · `terrain?: Terrain[] = [terrain.mola()]` | `Body` | [planned] | `world(canvas, { body: mars() })` |

## Example

```ts
// a lab floor
const lab = await world(canvas, { body: plane({ size: 40, grid: 1 }) });

// the Moon with its own terrain, and the Sun lighting it
const w = await world(canvas, { bodies: [sun(), moon()] });
```

## Open questions

- Default imagery and terrain sources for the Moon and Mars (LROC / LOLA, CTX / MOLA) and their terms.
- Should `plane` support a slope or a heightmap, or is that a custom body?
