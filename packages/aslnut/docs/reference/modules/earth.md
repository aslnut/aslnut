# modules › world › earth

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist).

**In one line:** the Earth as a body with its natural systems: base imagery and terrain providers, the terrain's own looks, the ground below (strata, wells, aquifers, magma), the air (atmosphere, weather), water (rivers, channels, the sea), the sky seen from a place, and the city's life (heat, fire, sound, society, ecology, analysis, places with their lots and blocks); and its presets: what people built (roads, rail, buildings, furniture, infrastructure, lights), how they move (traffic, signals, transit), and what lives there (plants).

Concepts: [world and body](../../concepts/world-and-body.md) · [configurable](../../concepts/configurable.md) · [underground](../../concepts/underground.md) · [sky](../../concepts/sky.md) · [the fabric](../../concepts/fabric.md) · [real-world authoring](../../concepts/real-world-authoring.md) · [licences](../../concepts/licences.md)

<!-- tree:reference/modules/earth -->
```tree
earth/
├── shared
├── body/
│   ├── earth
│   └── base/
│       ├── imagery/
│       │   ├── esri
│       │   ├── osm
│       │   ├── sentinel
│       │   ├── mapbox
│       │   └── custom
│       ├── terrain/
│       │   ├── mapzen
│       │   ├── grid
│       │   ├── gebco
│       │   ├── etopo
│       │   ├── lidar
│       │   └── custom
│       ├── basemap
│       ├── coast
│       └── offline
├── ground/
│   ├── terrain/
│   │   ├── terraform
│   │   └── looks
│   └── subsurface/
│       ├── strata
│       ├── wells
│       ├── aquifers
│       └── magma
├── air/
│   ├── atmosphere/
│   │   ├── scattering
│   │   ├── haze
│   │   └── clouds
│   ├── weather/
│   │   ├── presets
│   │   ├── wind
│   │   ├── rain
│   │   └── fog
│   └── sky/
│       ├── sun
│       ├── moon
│       ├── stars
│       ├── cultures
│       └── locks
├── water/
│   ├── hydrology/
│   │   ├── water
│   │   ├── flow
│   │   └── channels
│   └── sea/
│       ├── level
│       ├── shore
│       ├── look
│       └── exposed
├── climate/
│   ├── heat
│   └── fire
├── life/
│   ├── society
│   ├── ecology
│   ├── places/
│   │   ├── lots
│   │   └── blocks
│   └── soundscape
├── analysis/
│   ├── geo
│   └── learn
└── presets/
    ├── built/
    │   ├── roads/
    │   │   ├── sections
    │   │   ├── junctions
    │   │   ├── markings
    │   │   ├── decks
    │   │   ├── sidewalks
    │   │   └── elevated
    │   ├── rail/
    │   │   ├── track
    │   │   ├── crossings
    │   │   ├── viaducts
    │   │   └── stations
    │   ├── buildings/
    │   │   ├── footprints
    │   │   ├── cityjson
    │   │   ├── typology
    │   │   ├── facades
    │   │   ├── roofs
    │   │   ├── windows
    │   │   ├── frontage
    │   │   ├── landmarks
    │   │   └── interiors
    │   ├── furniture/
    │   │   ├── benches
    │   │   ├── bollards
    │   │   ├── bins
    │   │   ├── umbrellas
    │   │   ├── signs
    │   │   └── planters
    │   ├── infrastructure/
    │   │   ├── energy/
    │   │   │   ├── wind-turbine
    │   │   │   ├── solar-farm
    │   │   │   ├── pylon
    │   │   │   └── substation
    │   │   ├── mobility/
    │   │   │   └── charger
    │   │   └── utilities/
    │   │       ├── pole
    │   │       ├── lines
    │   │       ├── pipe
    │   │       └── cabinet
    │   └── lights/
    │       ├── street
    │       ├── vehicle
    │       └── windows
    ├── mobility/
    │   ├── traffic
    │   ├── signals
    │   └── transit
    └── living/
        └── plants/
            ├── species
            ├── growth
            ├── sway
            └── canopy
```
<!-- /tree -->

## API: body and base

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `shared` | `earth/shared`: helpers every earth part uses (OSM tags, Overture schemas, projections) | — | — | [planned] | `import { osmTags } from 'aslnut/modules/world/earth/shared'` |
| `body/earth` | `earth(options?)` | `imagery?: Imagery[] = [imagery.esri()]` (a list, painted in order) · `terrain?: Terrain[] = [terrain.mapzen()]` (a list; `[]` = flat) · `exaggerate?: Fn<number> = 1` (may change with the observation level or time; never with the camera) · `sea?: Sea` (see `water/sea/level`) · `base?: Imagery \| null` (an offline basemap always under the imagery: `earthLite({ url })`) · `sky?: boolean \| SkyProps \| Element` (default a plain sky; `sky()` the real sun and moon for the place and time, their light and shadows; `false` none) · `surface?` (the ground's grade, shade) | `Body` | [built] | `earth({ imagery: [imagery.esri()], terrain: [terrain.mapzen()], exaggerate: s => s.observation.index < 3 ? 8 : 1.5 })` |
| `body/base/imagery/esri` | `imagery.esri(opts?)` | `layer?: 'world-imagery' \| 'topo' \| 'streets' \| 'light' \| 'dark' = 'world-imagery'` ('light': the Light Gray Canvas a GIS view sits on, tiles to level 16) · `url?: string` · `token?: string` · `when?` · `opacity?` | `Imagery` (terms included) | [built] | `imagery.esri()` |
| `body/base/imagery/osm` | `imagery.osm(opts?)` | `url?: string` (a tile server; the public one allows light use only) | `Imagery` | [built] | `imagery.osm({ url: myTiles })` |
| `body/base/imagery/sentinel` | `imagery.sentinel(opts?)` | `year?: 2018 … 2024 = 2020` | `Imagery` (EOX Sentinel-2 cloudless, CC BY 4.0: free to keep, prefetch and export, with attribution) | [built] | `imagery.sentinel({ when: { level: { to: 'region' } } })` |
| `body/base/imagery/mapbox` | `imagery.mapbox(opts)` | `token: string` · `style?: string = 'satellite-v9'` | `Imagery` | [planned] (a research prototype exists) | `imagery.mapbox({ token })` |
| `body/base/imagery/custom` | `imagery.custom(spec)` | `id` · `url? \| draw?: (ctx, tile) => void` · `attribution` · `terms?` | `Imagery` | [built] | `imagery.custom({ id: 'ortho', url, attribution: '© Kota Bandung' })` |
| `body/base/terrain/mapzen` | `terrain.mapzen(opts?)` | `max?: int = 15` | `Terrain` (AWS Terrarium tiles; includes the seafloor, negative heights) | [built] | `terrain.mapzen()` |
| `body/base/terrain/grid` | `terrain.grid(opts)` | `url: string` (a GeoTIFF or grid pack) · `where?: Area` · `when?` · `blend?: metres = 50` | `Terrain` | [built] | `terrain.grid({ url: '/dem/bandung.tif', where: city })` |
| `body/base/terrain/gebco` | `terrain.gebco(opts?)` | `url?: string` (a tiled copy of the GEBCO grid) · `when?` | `Terrain` (land + seafloor, ~450 m) | [planned] | `earth({ terrain: [terrain.mapzen(), terrain.gebco({ when: { below: 0 } })] })` |
| `body/base/terrain/etopo` | `terrain.etopo(opts?)` | `url?: string` · `res?: '15s' \| '60s' = '60s'` | `Terrain` (land + seafloor, global) | [planned] | `terrain.etopo({ res: '15s' })` |
| `body/base/terrain/lidar` | `terrain.lidar(opts)` | `url: string` (a 1 m bare-earth grid cut for a study area: a COG or a grid pack) · `kind?: 'dtm' \| 'dsm' = 'dtm'` · `where?: Area` · `blend?: metres = 50` (into the coarser terrain round it) · `attribution: string` | `Terrain` (national 1 m elevation models from airborne LiDAR) | [proposed] | `terrain.lidar({ url: '/dem/yarra-dtm-50cm.tif', where: studyArea, attribution: 'City of Melbourne, CC BY 4.0' })` |
| `body/base/terrain/custom` | `terrain.custom(spec)` | `id` · `heights: (tile, n) => Float32Array` · `attribution?` | `Terrain` | [built] | `terrain.custom({ id: 'my-dem', heights })` |
| `body/base/basemap` | `earth({ basemap })` | `basemap?: boolean \| { coasts, borders, names } = true` | Natural Earth countries, coasts, names | [planned] (a research prototype exists) | `earth({ basemap: { names: false } })` |
| `body/base/coast` | `earth({ basemap: { coasts } })` · drawn from the sea level when the seafloor is known | `coasts?: Source = naturalEarth.coast` · `fromTerrain?: boolean = true` | a coastline that follows `water/sea/level` | [planned] (a research prototype exists) | `earth({ basemap: { coasts: osm.coastline } })` |
| `body/base/offline` | `earth.offline(opts)` | `pack: url` (a small world pack: coarse imagery, terrain, coasts, names) | `Body` options that never touch the network | [built] | `earth(earth.offline({ pack: '/earth-lite' }))` |
| `ground/terrain/terraform` | `w.ground` (see core › space) · `terraform(area, fn)` | `fn: (h, p) => number` (cut, fill, flatten; roads and rivers follow) | — | [planned] (a research prototype exists) | `terraform(site, h => Math.min(h, 712))` |
| `ground/terrain/looks` | `earth({ looks })` | `looks?: (p, h, slope, cover) => Material` · presets `looks.biomes()` · `looks.landcover(source)` · `looks.snowline(h)` | — (follows the lens) | [planned] | `earth({ looks: looks.biomes({ snowline: 4200 }) })` |

## API: below and above the ground

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `ground/subsurface/strata` | `strata(options)` | `data: Source` (boreholes or surfaces) · `layers: string[]` · `colors?: Record<layer, color>` · `faults?: Source` | element | [planned] | `strata({ data: boreholes, layers: ['soil', 'tuff', 'andesite'] })` |
| `ground/subsurface/wells` | `wells(options)` | `data: Source` · `path: d => [md, inc, az][]` · `log?: { field, ramp }` · `casing?: d => …` · `drilling?: Stream` | element | [planned] | `wells({ data, path: d => d.props.survey, log: { field: 'temp' } })` |
| `ground/subsurface/aquifers` | `aquifers(options)` | `data: Source` · `top, bottom: Fn<number>` (metres below ground) · `head?: FieldRef` | element | [planned] | `aquifers({ data, top: d => -d.props.top })` |
| `ground/subsurface/magma` | `magma(options)` | `chamber?: Volume` · `conduits?: Source` · `melt?: FieldRef` · `iso?: number` | element | [planned] | `magma({ chamber: vol, iso: 700 })` |
| `air/atmosphere/scattering` | `sky({ weather: { turbidity } })` | `atmosphere?: boolean \| { density, turbidity = 2 } = true` | — | [built] (Preetham's daylight sky for the sun's place, filmic tone mapping, a clear-sky lift, Rayleigh and Mie by the hour and the weather (turbidity, overcast)) | `sky({ atmosphere: { turbidity: 4 } })` |
| `air/atmosphere/haze` | `sky({ haze })` · `sky({ dim })` | `level?: number = 1` · `base?: metres` · `height?: metres = 600` · `clear?: number` · dim: `amount: 0..1 \| s => 0..1` · `color?: string = '#151c28'` · `seconds?: number = 1` | — | [built] (the haze at the horizon follows the sun (gold at dusk, dark blue at night), greyed by cloud; the ground fades into it far away; `level` (× the weather's), `base` (m over the ground it starts thinning above), `height` (m it thins over), `clear` (a clear day's visibility, m); `dim`: the sky and its haze darkened towards a colour so an analysis view's marks read (eased; unset: the world's theme dims it (core › render › style › theme: its `sky`); neither: nothing worked out)) | `sky({ haze: { level: .6, base: 700 } })` · `sky({ dim: { amount: s => s.user.toggles.analysis ? 1 : 0 } })` |
| `air/atmosphere/clouds` | `sky({ clouds })` | `cover` (the weather's) · `base?: metres = 2700` · `shadows?: boolean = true` · `source?: RasterSource` · `zoom?: int = 6` | element | [built] (a cloud deck in the sky drawn with the sky: cover from the weather, lit by the sun and the moon, drifting with the wind, darker underneath when overcast; their shadows on the ground and on everything lit (`shadows: false` turns them off); `source`: a raster's cloud cover read where the view is (`zoom`, default 6)) | `sky({ clouds: { base: 1800 } })` |
| `air/weather/presets` | `sky({ weather })` · `sky.setWeather(name \| mix, { seconds })` · `WEATHERS` | `name: 'clear' \| 'partly' \| 'overcast' \| 'drizzle' \| 'rain' \| 'storm' \| 'fog'` · or a mix `{ cover, overcast, rain, turbidity, fog, wind, lightning }` · `seconds?: number` (eased) | — | [built] (each sets the sky, the clouds, the light and haze, the wet ground, the rain and lightning together, eased over `seconds`) | `sky.setWeather('rain', { seconds: 4 })` |
| `air/weather/wind` | `sky({ weather: { wind } })` · `w.light.wind` · `sky.feed({ data, wind, rain, visibility, cover, every, seconds })` · `openMeteo.current(points)` | `wind: m/s` (or a feed's field) | the wind others can read (`w.light.wind`; the frame's) | [built] (one wind speed for the world: clouds drift, rain slants; from observations with `sky.feed({ data, wind })`: the nearest stations' wind where the view is) | `sky({ weather: { wind: 12 } })` |
| `air/weather/rain` | `rain(options)` · `sky({ weather: { rain } })` · `sky.feed({ data, rain })` | `amount?: number \| s => number` (the sky's rain by default) · `count?` · `box?` · `ceiling?` | falling rain round the eye, wet surfaces (darker, gleaming) | [built] (streaks falling round the eye, the ground and every lit mark wet; from observations: `sky.feed({ data, rain })` in mm/h, 8 mm/h and more as hard as it rains, a storm's lightning over 25 mm/h) | `w.add(rain())` |
| `air/weather/fog` | `sky({ weather: { fog } })` · `w.light.visibility` · `sky.feed({ data, visibility })` | `fog: number` (thickness) → visibility, metres | — | [built] (the air thickens by the weather: everything lit fades into the haze with distance; from observations: `sky.feed({ data, visibility })` in metres) | `sky.setWeather('fog')` |

## API: on the ground

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `water/hydrology/water` | `water(options)` · `waterArea(mb, ring, look)` · `stream(mb, pts, width, look)` · `widthOf(props)` · a layer's `sea(s)` | `rivers?: Source` (lines) · `lakes?: Source` (polygons) · `width?: d => m` (default its width, else by kind: river 20, canal 12, creek 4, drain 3) · `sea?: boolean = true` · `level?: Fn<metres> = 0` (a number or your function of the state: a tide) · `near?: m = 8000` (lakes and rivers drawn while the camera is nearer; the sea at every distance) · `look?: { water, stream, sea }` | element | [built] (lakes on the ground and watercourses as ribbons of their width, in the water material (the sky in it, the sun's shine), picked with their props, in 500 m chunks; the sea it gives the world: the ground under its level is drawn as water (the terrain's seafloor under it), at every zoom, only where the ground's heights are known; the street level's lakes and creeks the same; flow and channels planned (their own parts)) | `water({ rivers: osm.waterways, lakes: osm.water, sea: true })` |
| `water/hydrology/flow` | `water.flow(options)` | `terrain?: 'body' \| Terrain = 'body'` (includes exposed seafloor) · `sea?: 'body' \| Fn<metres>` (rivers end at the coast) · `min?: km² = 50` (catchment that makes a river) · `when?` | `Source` of river lines (`{ order, area }` props) + an accumulation field; recomputed when sea level or terrain changes | [planned] | `w.add(line({ data: water.flow({ min: 200 }), width: d => d.props.order, reveal: { mode: 'trace' } }))` |
| `water/hydrology/channels` | `water.channels(options)` | `data?: Source` (canals, drains, culverted streams; OSM waterways by default) · `section?: d => Section` (bed, banks, talud) · `level?: Fn<metres>` | a channel network (fabric, not an entity): swept sections, its structures (culverts), flow as a graph field | [planned] | `water.channels({ data: osm.waterways, section: d => channel({ width: d.props.width ?? 3 }) })` |
| `water/sea/level` | `earth({ sea: { level } })` · param `earth.seaLevel` · `w.read('earth.seaLevel')` | `level?: Fn<metres> = 0` (a number, a function of time / params, or a data series) | water wherever the ground is below it; the coast moves smoothly | [planned] | `earth({ sea: { level: s => seaCurve(s.time.ago) } })` |
| `water/sea/shore` | `sea({ shore })` · `coastSegments(features, at, box?)` · `coastField(segs, grid, band)` · `localFrame(origin)` · `SHORE` | `coast: Source \| Feature[]` (lines with the land on their left, as OpenStreetMap's `natural=coastline` runs; or polygons of land, either way round) · `surf?: m = 120` (where the waves break) · `runup?: m = 12` (how far up the sand they run, each wave its share) · `period?: Fn<s> = 9` (between waves) · `foam?: 0..1 = 1` · `shelf?: m/m = 0.02` (the floor's fall from the coast: the waves slow by it, the water's depth near the coast by it) · `cell?: m = 2` (the field's finest) | the shore drawn by the ground's sea and the sea's own surface alike: the coast's signed distance (+ at sea, − on land) in a field of 1,024² cells round the eye, within the surf zone's band, made once a window a slice a frame (a new window as the eye moves away, cells coarser higher up: none past a third of the band a cell); the waves coming in from the surf zone's edge in order, slower as the water shallows (√(g h)), each its own size (sets), sections of the shore earlier or later, breaking into a face of foam with a streaked trail behind it, then running up the sand as a thin sheet (the sky in it) with a foam edge and back, the sand wet and darker behind it; near the coast the field says where the water is (the coast's line wins over the terrain's) and the ground is laid under it (the sand over the level, the floor under it) | [built] (WebGPU and WebGL2: the same functions, sea.wgsl.ts and its twin; no coast given: no shore) | `sea({ shore: { coast: data.geojson('/coast.geojson'), surf: 140, runup: 14, period: 11 } })` |
| `water/sea/look` | `sea(options)` (a layer that gives the world its sea, over `water()`'s plain one) · `sea({ look })` · `waveSet({ speed, from, swell?, count? })` · `SEA_LOOK` | `level?: Fn<m> = 0` · `look?: true \| { shallow?: color = '#2fb3ad', deep?: color = '#0b3a57', clarity?: m = 9` (the depth it turns deep over) · `wind?: { speed?: Fn<m/s>` (default the sky's weather, else 6) `, from?: Fn<degrees> = 225 }` · `swell?: { height, period, from } \| false` · `glitter?: 0..2 = 1` · `waves?: int = 16` · `tier?: 'auto' \| 'flat' \| 'displaced' = 'auto'` · `reach?: × eye height = 300` (the displaced surface's) · `clock?: s => seconds` (the waves' own time: default the world's clock) `}` | the sea's look at every zoom: a sum of directional waves the wind raises (Pierson and Moskowitz's sea for its speed, spread round its way, the longest first; a swell when given), their phases written once a frame at the view's centre (a frame of the ground: the waves stay put as the eye moves), the water shallow to deep by its depth (the terrain's floor; near a coast its distance by the shelf; a floor at the level, a sea the terrain knows no depth of: deep), the sky in it by Fresnel, the sun's glitter as wide as the waves left out make it (Cox and Munk: a footprint wider than a wave keeps its roughness, nothing flickers, the whole sea's roughness far away), the haze at the horizon. Tiers by the governor: realistic, the sea's own surface near the eye (rings round the point under it, lifted by the waves (Gerstner) and the shore's, fading into the ground's sea at its reach, the ground's water laid under its troughs); lite (a phone), the ground's sea with the waves in its light only (the 8 longest, the rest's roughness kept): the same sea; a change of tier eased over 0.6 s. Frames only while water is in view, low enough to see it move (every frame under 1.5 km, 30 a second under 6 km, 10 under 30 km) | [built] (WebGPU and WebGL2: sea.wgsl.ts and its twin, the surface's sea and the sea's surface one look; nothing per vertex or pixel on the main thread; no look: the plain sea, nothing of this computed) | `w.add(sea({ look: { wind: { speed: 6, from: 120 }, swell: { height: 1.3, period: 12, from: 225 } }, shore: { coast } }))` |
| `water/sea/exposed` | `earth({ sea: { exposed } })` | `look?: (p, h) => Material` (land that was seafloor) · `blend?: years` (greens over time) | dry shelf drawn as land with its own look | [planned] | `sea: { exposed: { look: looks.lowland() } }` |

## API: the sky from here, and city life

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `air/sky/sun` | `earth({ sky: sky({ sun }) })` · `w.read('sky.sun')` · `w.light` | `sun?: boolean = true` | `{ azimuth, altitude, color }` for the place and time | [built] (`sky()` reckons the sun for the view's place at the world's time (an almanac to a fraction of a degree): its disc and halo, its light on the ground (colour by altitude, the eye's adaptation by day), its shadows; `w.read('sky.sun')`, `w.light`) | `s.world.sun.altitude > 0` |
| `air/sky/moon` | `sky({ moon })` · `w.read('sky.moon')` | `moon?: boolean = true` | `{ azimuth, altitude, phase }` | [built] (its place (parallax), phase and lit fraction; its disc lit from the sun's direction (phase and tilt right); moonlight on the ground at night) | `when: s => s.world.moon.phase > .9` |
| `air/sky/stars` | `sky({ stars })` · `sky().stars(opts)` · `catalogues.hipparcos({ url? })` · `catalogues.custom({ load, attribution? })` · `parseStars(text)` · `skyTurn(t, lon, lat)` | `stars?: false \| number` (a made-up field, its brightness: nothing loaded) `\| { magnitude?: number = 6, catalogue?: Catalogue = catalogues.hipparcos(), brightness?: 0..1 = 1, size?: px = 3 }` · hipparcos `url?` (a list you host: ra, dec, magnitude, B−V, tab-separated; `tools/stars-pack.mjs` makes one) | — | [built] (the real stars from a catalogue: each at its place by the sidereal time and the place's latitude (J2000, precession left out), as bright as its magnitude down to the faintest asked, coloured by its colour index, a small disc added over the sky on WebGPU and WebGL2; at night only, fading with the cloud cover and at the horizon; loaded when night first falls near the ground (Hipparcos from CDS VizieR, only the stars wanted; offline from your list); the made-up field when no catalogue is asked for) | `sky({ stars: { magnitude: 5 } })` · `sky({ stars: { catalogue: catalogues.hipparcos({ url: '/packs/sky/hipparcos.tsv' }) } })` |
| `air/sky/cultures` | `w.sky.stars({ culture, lines })` | `culture?: 'western' \| 'sundanese' \| 'javanese' \| … = 'western'` · `lines?: boolean = false` | — | [planned] | `w.sky.stars({ culture: 'sundanese', lines: true })` |
| `air/sky/locks` | `w.sky.lock(opts)` · `w.sky.unlock()` | `time?: string` · `light?: 'golden-hour' \| 'noon' \| 'blue-hour' \| 'night'` · `weather?: string` | — | [planned] | `w.sky.lock({ light: 'golden-hour' })` |
| `climate/heat` | `cityHeat(tiles, options)` · `cityRasters(tiles, { centre, size, cell, changes })` · `heatRaster(r, grid, { domain })` | `tiles`: the street level's · `centre` · `size?: metres = 360` · `cell?: metres = 2` · `changes?: { streetTrees, coolRoads, wateredGrass }` · `input` · `metric?` | a heat element (core › simulation › phenomena › heat) over the street level · its rasters · a raster source | [built] (the street level's open data as the heat model's rasters: roads, kerbs, strips and footpaths by their widths, parks, water, buildings with their heights, every tree's crown, each street its canyon, materials from the constants table; scenario changes to compare) | `w.add(cityHeat(street.tiles(), { centre, input })).run()` |
| `climate/fire` | `earth.fire(options)` | `fuel?: RasterSource \| d => kg/m² = landcover.esa()` · `wind?: FieldRef \| Fn<[speed, dir]> = the weather wind field` | an Earth preset of core › simulation (wildfire spread) | [planned] | `w.add(earth.fire({ ignite: [p] }))` |
| `life/soundscape` | `soundscape(options)` | `sources?: Source` · `roads?: Network` · `listener?: 'camera'` | element (levels as a field; sound in the browser optional) | [planned] | `soundscape({ roads })` |
| `life/society` | `society(options)` (an agent preset of core › simulation › agents) | `people: Source \| number` · `roles?: Role[]` · `schedules?: (role, day) => Activity[]` · `places?: Record<activity, Source>` | a pattern of life: people with roles and day schedules moving between places | [planned] | `society({ people: 5000, places: { work: offices, home: houses } })` |
| `life/ecology` | `ecology(options)` (an agent preset of core › simulation › agents) | `species: Species[]` · `habitats: Source` · `behaviours?: Record<species, Behaviour>` (graze, flock, flee, nest) | animals in their habitats, behaving | [planned] | `ecology({ species: [birds.egret], habitats: wetlands })` |
| `analysis/geo` | `analysis.buffer \| near \| zonal \| contours \| profile (…)` | per function (e.g. `zonal(areas, raster, { sum: true })`) | `Source` or numbers | [planned] (a research prototype exists) | `analysis.profile(line, { every: 10 })` |
| `analysis/learn` | `analysis.classify(raster, model)` · `analysis.detect(raster, model)` | `model: url \| Model` (ONNX, runs in a worker) · `classes?: string[]` | `Source` (land cover, roofs, trees found in imagery) | [planned] | `analysis.detect(imagery.esri(), { model: '/roofs.onnx' })` |
| `life/places` | `places.search(text)` · `places.near(point)` | `text: string` · `bias?: Point` | `Place[]` (`{ name, at, kind }`) | [planned] (a research prototype exists) | `await places.search('Gedung Sate')` |
| `life/places/lots` | `places.lots(options)` | `data?: Source` (cadastre, or cut from blocks) · `from?: 'blocks' \| Source` · `size?: Fn<m²>` | lots as zones of kind `lot` (a place each); rules place buildings on them | [planned] | `places.lots({ from: 'blocks', size: 200 })` |
| `life/places/blocks` | `places.blocks(options)` | `roads?: Network` (blocks are what roads enclose) · `min?: m² = 400` | blocks as zones of kind `block` | [planned] | `places.blocks({ roads })` |

## API: presets

`presets` is always the last child of its node. It holds only ready-made things built with the public API, to use as they are or to copy and change. It lives at the most general level where it still makes sense: a human goes anywhere (`modules.presets`), Victorian houses only on Earth (`modules.world.earth.presets`). Small value presets (weather presets, easing, ramps) stay inside their part. Each preset has its own import, and heavy assets (models, textures) come from the catalog, never bundled.

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `presets/built/roads/sections` | `roads(options)` · `r.sections()` · `r.junctions()` · `r.network()` · `sectionMesh(mb, section)` · `junctionMesh(mb, junction)` | `data: Source` (centre lines with OSM-style tags: highway, lanes, width, sidewalk, sidewalk:width, oneway; `nodes` when known) · `keep?: d => boolean` (default: a road's highway) · `cls?: d => class` · `section?: (d, profile) => Profile` (your last word; from OSM tags by default) · `rules?: ProfileRules = VIC_STREETS` · `junctions?: { radius, crossings }` · `solve?: boolean = true` (fit to the terrain at every vertex; false: each piece at its middle's ground) · `look?` | element + a road network | [built] (ways split where they share a node (or a place), each piece a section with its profile from its tags, then the rules by class; the junctions solved from their arms (platforms, kerb returns, verges round the corners, crossings, give-way lines); drawn on the ground in 500 m chunks (the carriageways and platforms only far away; the whole made when a chunk comes near), each picked with its class, width and lanes; tunnels left out, bridges on the ground; a network of the centre lines to route on; the street level builds the same per tile from Vicmap's centre lines and road casements, and the bake solves heights, decks and levels (baked roads: `bakedRoads({ url, worker })` builds each tile's mesh in a worker, only its encoded numbers crossing); the bake's verges past the kerbs by road class where no reserve is given: Victoria's by default, a place's own with `verges` (its options: narrow lanes, no nature strips)) | `roads({ data: osm.roads })` |
| `presets/built/roads/junctions` | `roads({ junctions })` | `junctions?: 'auto' \| (node) => Junction` (corner radii, crossings) | — | [planned] | `roads({ data, junctions: 'auto' })` |
| `presets/built/roads/markings` | `roads({ markings })` | `markings?: boolean \| (lane) => Marking[] = true` | lane lines, arrows, crossings | [partly] (centre dashes on collectors and bigger (3 m lines, 9 m gaps), none on local streets; zebra crossings at the bigger roads' junctions; give-way lines on the smaller arms; arrows, and markings drawn in the shader from (s, u), planned) | `roads({ markings: false })` |
| `presets/built/roads/decks` | `roads({ decks })` | `decks?: d => { layer, piers? }` (bridges, flyovers, tunnels from `layer` / `bridge` tags) | — | [planned] | `roads({ decks: d => ({ layer: d.props.layer }) })` |
| `presets/built/roads/sidewalks` | `roads({ sidewalks })` | `sidewalks?: Fn<{ left?, right?: metres } \| false>` (from OSM tags by default) · `kerb?: metres = .15` | sidewalk parts in the section + the walkways people use | [built] (each side's kerb and channel, nature strip and footpath out to the property line: the road reserve from data (Vicmap road casements), tags, then the class's rules; carried round the junctions' corners; a skirt where it meets the ground) | `roads({ sidewalks: d => d.props.highway === 'residential' ? { left: 1.5, right: 1.5 } : false })` |
| `presets/built/roads/elevated` | `roads({ elevated })` | `elevated?: Fn<{ layer, height? } \| false>` (from `layer` / `bridge` tags) · `piers?: PierSpec` | elevated roads: decks, piers and ramps from core › geometry › networks › structures | [planned] | `roads({ elevated: d => d.props.bridge ? { layer: 1 } : false })` |
| `presets/built/rail` | `rail(options)` | `data: Source` · `gauge?: metres = 1.067` · `electrified?: Fn<boolean>` · `solve?: boolean = true` | element + a rail network | [planned] | `rail({ data: osm.railways })` |
| `presets/built/rail/track` | `rail({ track })` | `track?: { sleepers?: boolean = true, ballast?: boolean = true, rails?: 1 \| 2 = 2 }` | the track as a swept section; the line trains run on (`rail` locomotion) | [planned] | `rail({ data, track: { ballast: false } })` |
| `presets/built/rail/crossings` | `rail({ crossings })` | `crossings?: 'auto' \| Source = 'auto'` (where rail meets a road at grade) · `gates?: boolean = true` | level crossings: a junction platform, gates and signals driven by trains | [planned] | `rail({ data, crossings: 'auto' })` |
| `presets/built/rail/viaducts` | `rail({ viaducts })` | `viaducts?: Fn<{ height } \| false>` · `piers?: PierSpec` | elevated rail: decks and piers from core › geometry › networks › structures | [planned] | `rail({ viaducts: d => d.props.bridge ? { height: 12 } : false })` |
| `presets/built/rail/stations` | `rail({ stations })` | `stations?: Source \| 'osm'` (`railway=station`, `public_transport=platform`) · `platforms?: Fn<{ length, height }>` · `concourse?: Shape` | platforms, canopies and concourse levels placed on the track, joined to walkways and stairs; a station with a hero model uses buildings › landmarks for its shell | [proposed] | `rail({ stations: 'osm' })` |
| `presets/built/buildings/footprints` | `buildings(options)` · `footprint(mb, ring, height, rnd, look?)` | `data: Source \| Feature[]` (polygons and multipolygons) · `height?: d => metres` (default: props height, h or est_height; else levels × `floor`; else `fallback`) · `floor?: m = 3.2` · `fallback?: m = 6.4` · `look?: d => { wall?, roof?, window? } \| { block?, house? }` · `house?: (d, area, height) => boolean` (default: by its class, or small and low) · `front?: d => degrees` (a house's door towards its street; default its props' `front`) · `sink?: m = 1` · `roofs?`, `windows?` (below) · a house look of yours (`look: { house: { ...HOUSE, roof?, raise?, posts? } }`): `roof?: Shape` (your roof over its main body and wings) · `raise?: m = 0` (its floor raised on posts, steps up to its door) · `posts?: { color, size, spacing, floor }` | element | [built] (real footprints from any source raised to their height in 500 m chunks of solids (walls and roofs far away and for the sun's shadow, the whole made when a chunk comes near), each picked with its props and height; houses drawn as houses on their plan (`housePlan(footprint, front)`: the footprint's own axes facing its street, a main body and up to three wings, all inside the footprint; the walls set in under the eaves, so next-door houses never overlap), with a roof from `HOUSE.forms` (or a roof of yours: `HouseLook.roof`), windows and a door, a floor on posts with steps to its door when raised (`HouseLook.raise`), blocks as prisms with their roofs and windows; whole near, walls and roofs only far away and for the sun's shadow; the street level builds the same per tile from its bake (`streets()`)) | `buildings({ data: overture.buildings })` |
| `presets/built/buildings/cityjson` | `buildings({ data: data.cityjson(url) })` | `lod?: 1 \| 2 \| 3 = 2` | element | [planned] | `buildings({ data: data.cityjson('/den-haag.json') })` |
| `presets/built/buildings/typology` | `typology.house` · `typology.office` · `typology.make('house' \| 'office', params)` (shapes: `make`, `check`, `entities({ shape: typology.house })`) | house: `width: num(6, 20, 10)` · `depth: num(6, 20, 11)` · `levels: int(1, 3, 1)` · `floor: num(2.7, 3.6, 3)` · `roof: choice(['gable', 'hip', 'dutch', 'pyramidal', 'skillion', 'flat'])` · `pitch: num(8, 50, 25)` · `eaves` · `garage: choice(['right', 'left', 'none'])` (its own side) · `driveway: num(0, 20, 6)` · `paved: flag(true)` · `wall`, `roofing`, `trim`, `glass`, `door: color` (white to grey); office: `width`, `depth`, `levels: int(1, 12, 4)`, `floor`, `roof`, `pitch`, `entries: int(2, 6, 2)`, `carpark: int(1, 2, 2)` (rows), `bays: int(4, 20, 9)`, `bay: num(2.4, 3.2, 2.7)`, `paved`, colours | `Shape` of kind house / office: anchors `entry-k` (at the front, facing the door), `parking-k` (the driveway's, a car park's bays), `service-k` (a charger's or a meter's place: the garage's front wall; the head of each first-row bay); the roof a group (its surface and tilt measured); whole, simple and box levels | [built] (neutral buildings by kind, simple shapes in white to grey, every measure a param, carrying their kind's traits (core › entities › identity › kind); an app's own designs (a terrace, a house on stilts, a brand's store) stay the app's, made with the same tools and carrying the same traits) | `entities({ id: 'homes', shape: typology.house, data, params: (d) => ({ width: d.props.w, garage: 'left' }), heading: (d) => d.props.heading })` |
| `presets/built/buildings/facades` | `buildings({ facades })` | `facades?: Fn<Facade>` (bays, floors, materials) | — | [planned] | `buildings({ facades: d => facades.shopHouse() })` |
| `presets/built/buildings/roofs` | `buildings({ roofs })` · `roofOf(props)` · `roofMesh(mb, box, eave, rise, kind, roof, wall)` | `roofs?: boolean \| (d => 'flat' \| 'gable' \| 'hip' \| 'pyramidal' \| 'skillion' \| 'dome' \| Shape \| null)` (false: flat, the default; true: from its tags `roof:shape` (OSM's names: gabled, hipped, pyramidal, skillion, dome, round, onion …), `roof:height`, `roof:angle`) · `pitch?: degrees = 25` | — | [built] (over the footprint's best-fit rectangle: the walls to the eaves with a cap, the roof rising above them (its height from the tag, else the pitch over the half width; a dome the half width); gable ends in the wall's colour; a shape of your own built there (its params width, depth, height; x along the long side, turned with the footprint); a house's own roof over its plan (`house()`): hip, gable or dutch by `HOUSE.forms` (a squarish body hipped), its ridge along the long side, its pitch `roofPitch` ± `pitchVary`, eaves ending at the footprint's edge and a soffit; a wing in front a gable to the street, an addition at the back or side a lean-to under the main eaves; the faces from `roofFaces(form, w, d, { pitch, ridge })` (core › geometry › shapes › roofs)) | `buildings({ data, roofs: (d) => roofOf(d.props) ?? (d.props.h < 10 ? 'hip' : 'flat') })` |
| `presets/built/buildings/windows` | `buildings({ windows })` · `windowRows(mb, ring, top, floor, color)` · any solids layer's `windows: { lit, interior }` | `windows?: false \| { lit?: 0..1 \| (s) => 0..1 = .45, interior?: boolean = false }` | lit windows at night, rooms behind glass | [built] (rows of windows a floor apart on blocks over two floors, a house's windows on every long wall and its door facing the street; glass by day, from dusk a share of them lit (the layer's `lit`, a function of the state: fewer late at night) as lamps ('windows'); `interior`: rooms 4 × 3.2 × 4 m behind the glass (a floor, a ceiling, walls; each room lit or dark), seen by day and night; the street level's buildings light up the same way; on WebGPU and WebGL2 in the solids' own program) | `buildings({ windows: { lit: (s) => (s.time.local.hour > 22 ? .2 : .5), interior: true } })` |
| `presets/built/buildings/frontage` | `buildings({ frontage })` | `frontage?: { roads: Network, depth?: metres = 12, every?: metres = 8 }` (core › geometry › zones › rules › frontage) | buildings that face the road along a block's edge | [planned] | `buildings({ frontage: { roads, depth: 15 } })` |
| `presets/built/buildings/landmarks` | `buildings({ landmarks })` · `landmarks.add(shape, at, opts?)` | `shape: Shape` (a hand-made model or a cleaned scan, from core › geometry › import) · `at: [lon, lat, h?]` · `heading?: degrees` · `replaces?: 'footprint' \| id[] = 'footprint'` (the procedural buildings it removes) · `ground?` · `foundation?` (core › geometry › compose) | the hero piece in place; its footprint excludes the procedural buildings and the trees below it | [proposed] | `landmarks.add(await shapes.import('/landmarks/station.glb'), [144.9671, -37.8183], { heading: 12, foundation: 'plinth' })` |
| `presets/built/buildings/interiors` | `buildings({ interiors })` · `interiors.add(at, rooms)` | `rooms: Shape \| Source` (floor plans or a hand-made model) · `doors?: anchors` (joined to walkways) · `when?` (shown only near or inside) | enterable rooms inside a building, vault or structure, loaded only when the observer is close | [proposed] | `interiors.add('vault-3', await shapes.import('/rooms/vault-3.glb'))` |
| `presets/built/furniture/benches` | `furniture.bench` (a shape package) | `length: num(1, 4, 1.8)` · `back: flag(true)` · `material: choice(['timber', 'steel', 'stone'])` | `Shape` with `sit` anchors; data `'osm'` (`amenity=bench`, `backrest`, `material`) | [proposed] | `entities({ shape: furniture.bench, data: 'osm' })` |
| `presets/built/furniture/bollards` | `furniture.bollard` | `height: num(.5, 1.2, .9)` · `kind: choice(['post', 'removable', 'rising'])` | `Shape`; data `'osm'` (`barrier=bollard`, nodes or lines) | [proposed] | `entities({ shape: furniture.bollard, data: 'osm' })` |
| `presets/built/furniture/bins` | `furniture.bin` | `size: num(.05, 1.1, .12)` (m³) · `streams: int(1, 3, 1)` | `Shape`; data `'osm'` (`amenity=waste_basket`, `amenity=recycling`) | [proposed] | `entities({ shape: furniture.bin, data: 'osm' })` |
| `presets/built/furniture/umbrellas` | `furniture.umbrella` | `size: num(2, 5, 3)` · `open: flag(true)` · `color` | `Shape` (café and bar umbrellas; open by hour and weather); data your own, or placed by a rule along outdoor seating | [proposed] | `entities({ shape: furniture.umbrella, data: terraces, params: s => ({ open: s.time.hour > 10 }) })` |
| `presets/built/furniture/signs` | `furniture.sign` | `kind: choice(['traffic', 'board', 'wayfinding'])` · `text?: text()` · `height: num(1, 4, 2.4)` | `Shape`; data `'osm'` (`traffic_sign=*`, `information=board`) | [proposed] | `entities({ shape: furniture.sign, data: 'osm' })` |
| `presets/built/furniture/planters` | `furniture.planter` | `outline?: Polygon` (or `size: num`) · `height: num(.2, 1.2, .6)` · `plants?: Shape` | `Shape` (a raised bed, often on a retaining wall's top); data your own, a scan fit, or `'osm'` where mapped | [proposed] | `entities({ shape: furniture.planter, data: beds })` |
| `presets/built/infrastructure/energy/wind-turbine` | `infra.windTurbine` (a shape package) | `hubHeight: num(30, 160, 90)` · `rotor: num(40, 170, 110)` · `blades: int(2, 5, 3)` · `axis: choice` · `color` | `Shape` with parts `tower, nacelle, rotor` | [proposed] | `entities({ shape: infra.windTurbine, data: farms })` |
| `presets/built/infrastructure/energy/solar-farm` | `infra.solarFarm` | `rows: int` · `tilt: num(0, 40, 15)` · `tracking: flag(false)` | `Shape` | [proposed] | `entities({ shape: infra.solarFarm, data: plants })` |
| `presets/built/infrastructure/energy/pylon` | `infra.pylon` | `height: num(15, 80, 40)` · `circuits: int(1, 4, 2)` · `type: choice(['lattice', 'monopole'])` | `Shape` with wire anchors | [proposed] | `entities({ shape: infra.pylon, data: towers })` |
| `presets/built/infrastructure/energy/substation` | `infra.substation` | `size: num` · `voltage: choice([70, 150, 500])` | `Shape` | [proposed] | `entities({ shape: infra.substation, data: subs })` |
| `presets/built/infrastructure/mobility/charger` | `charger` · `chargers.station(ports)` · `chargers.wall(ports, marked)` · `chargers.make(params)` | `ports: int(1, 8, 4)` · `power: choice(['7', '22', '50', '150'], '50')` · `connector: choice(['ccs2', 'type2', 'chademo', 'ccs1', 'j1772', 'gbt'])` · `canopy: flag(true)` · `mount: choice(['pedestal', 'wall'])` · `bay: num(2.3, 3.4, 2.7)` · `brand: color = grey` · `body`, `canopyColor`, `marking: color` · `sign: flag(true)` · `marked: flag(true)` | `Shape` of kind charger (a station: a canopy on posts, pedestals with a screen, a cable and a status light, marked bays, a tall sign with a plug; a wall charger: a box on a post); anchors `bay-k` (`parking`: where a car stands to charge, facing it) and `light-k` (each port's light); whole, simple and box levels | [built] (neutral by default: white and greys, no brand's colour; a brand's colours are its params) | `entities({ shape: charger, data: stations, params: (d) => ({ ports: d.props.bays }), heading: (d) => d.props.heading })` |
| `presets/built/infrastructure/utilities/pole` | `infra.pole` | `height: num(6, 14, 9)` · `lamp: flag(true)` · `cables: int(0, 6, 2)` · `carries: choice(['power', 'telecom', 'both'])` | `Shape` with wire anchors; data `'osm'` (`power=pole`, `telecom=pole`) or placed along roads | [proposed] | `entities({ shape: infra.pole, data: poles })` |
| `presets/built/infrastructure/utilities/lines` | `infra.lines(options)` | `between: Source \| 'poles'` · `kind: choice(['power', 'telecom'])` · `sag: num(0, .1, .03)` · `color` | overhead wires strung between anchors; data `'osm'` (`power=line`, `power=minor_line`, `telecom=line`) | [proposed] | `infra.lines({ between: 'poles', kind: 'power' })` |
| `presets/built/infrastructure/utilities/pipe` | `infra.pipe` | `diameter: num(.05, 3, .3)` · `depth: num(-10, 0, -1.2)` · `carries: choice(['water', 'sewer', 'gas'])` | a line shape along data | [proposed] | `entities({ shape: infra.pipe, data: mains })` |
| `presets/built/infrastructure/utilities/cabinet` | `infra.cabinet` | `size: num` · `carries: choice(['power', 'telecom'])` | `Shape`; data `'osm'` (`man_made=street_cabinet`) | [proposed] | `entities({ shape: infra.cabinet, data: 'osm' })` |
| `presets/built/lights` | `earth.lights(options)` | `source?: RasterSource = raster.viirs()` (any raster, or a function of the place) · `when?: = { hour: [18, 6] }` | night lights on the ground | [planned] | `w.add(earth.lights())` |
| `presets/built/lights/street` | `earth.lights.street(options)` | `on?: Network` (along roads) · `every?: metres = 30` · `shape?: Shape = infra.pole` · `when?: = s => s.world.sun.altitude < -4` | street lamps as things on the network, many small lights | [planned] | `w.add(earth.lights.street({ on: roads, every: 25 }))` |
| `presets/built/lights/vehicle` | `earth.lights.vehicle(options)` | `head?: boolean = true` · `tail?: boolean = true` · `when?` | head and tail lights on vehicles (their shapes' light anchors) | [planned] | `w.add(earth.lights.vehicle())` |
| `presets/built/lights/windows` | `earth.lights.windows(options)` | `lit?: Fn<0..1>` (by hour and use) · `color?: Fn<color>` | lit windows across the city (shared with buildings › windows) | [planned] | `w.add(earth.lights.windows({ lit: s => s.time.hour > 18 ? .6 : .1 }))` |
| `presets/mobility/traffic` | `traffic(options)` | `lanes: Lanes` · `volume?: Fn<number>` · `vehicles?: Shape[]` · `model?: 'flow' \| 'agents' \| custom = 'flow'` (follow-the-leader, lane change) | element | [planned] | `traffic({ lanes, volume: s => s.time.hour === 8 ? 1 : .4 })` |
| `presets/mobility/signals` | `traffic({ signals })` | `signals?: 'osm' \| Source \| (junction, t) => Phase` | traffic lights with phases | [planned] | `traffic({ lanes, signals: 'osm' })` |
| `presets/mobility/transit` | `transit(options)` | `routes: Source` (GTFS) · `dwell?: Fn<seconds>` · `vehicles?: Shape[]` | buses and trains on time, stopping at stops | [planned] | `transit({ routes: data.gtfs('/gtfs.zip'), dwell: 25 })` |
| `presets/living/plants/species` | `vegetation(options)` · `treeInstances(list, look)` · `SPECIES` · `speciesOf(name, extra?)` | `data?: Source` (points: trees; areas: planted) · `density?: d => trees per ha` · `species?: d => name \| BranchSpec` (a name of the look's mix or of the library; a botanical name by its genus) · `height?`, `crown?: d => m \| null` (null: the species' own for its height) · `look?: { species: { name: { spec, weight } }, variants, canopy }` | element | [built] (every tree grown from its species (procedural branching) in a few variants, scaled to its height and crown; whole, simple, impostor by distance; the library: 17 species of temperate and warm cities (plane, elm, oak, maple, ash, eucalypt, paperbark, wattle, lilly pilly, blossom, jacaranda, birch, poplar, cypress, pine, palm and a plain tree), each standing for its genera (`speciesOf('Platanus × acerifolia')` → 'plane'; yours with `extra`); a mix of your own from them (`{ ...SPECIES.plane, weight: 3 }`); growth planned) | `vegetation({ data: trees, species: (d) => speciesOf(d.props.genus) ?? 'tree' })` |
| `presets/living/plants/growth` | `vegetation({ growth })` | `age?: Fn<years>` · `season?: boolean = true` (leaf colour, bare branches) | — | [planned] | `vegetation({ growth: { age: d => d.props.planted } })` |
| `presets/living/plants/sway` | `vegetation({ sway })` | `sway?: boolean \| { wind: FieldRef \| Fn<number> } = true` (the weather wind field by default) | — | [planned] | `vegetation({ sway: { wind: s => s.world.readouts.gust } })` |
| `presets/living/plants/canopy` | `look.canopy` · `treeCrown(t, look)` | `transmit?: (t, species, natural) => 0..1` (how much sun the leaves let through) · `density?: (t, species, natural) => LAI` (e^(−LAI / 2)) | crowns that let some light through: dappled shadows and the shade the heat model reads | [built] (the grown crown's own transmissivity from its leaf cards; a crown is thinned to what you ask (patches of its cards dropped: a lighter shadow), and the heat model takes the same number per cell (cityRasters / cityHeat with the trees' look)) | `look: { canopy: { transmit: (t, s) => (s === 'plane' && winter ? .8 : .25) } }` |

## Example

```ts
const w = await world(canvas, {
  body: earth({
    imagery: [imagery.esri(), imagery.custom({ id: 'ortho', url, where: city, attribution: '© Kota Bandung' })],
    terrain: [terrain.mapzen(), terrain.grid({ url: '/dem/bandung.tif', where: city })],
    sky: sky({ atmosphere: true, haze: { level: .6 } }),
  }),
});
w.add(buildings({ data: overture.buildings }), roads({ data: osm.roads }));
w.add(entities({ shape: infra.windTurbine, data: farms }));
w.sky.weather('haze');
```

## Open questions

- Done: provider factories replace the research build's strings.
- Are the infrastructure shapes part of earth, or a separate `modules/infrastructure` once a second product needs them? (They're [proposed].)
- Overture or OSM as the default buildings source?
