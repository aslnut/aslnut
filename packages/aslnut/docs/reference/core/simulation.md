# core › simulation

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist). For agents, a reference implementation of street life exists.

**In one line:** what decides and what flows: agents (a behaviour, a rhythm, a habitat, senses, populations from data, tiers by the observation level); fields (raster, surface, graph, volume) and the kernels that step them; rules (presets, your own, coupling, regimes); fixed or observed fidelity; measures (probes, sensors, validation); citable constants; and the ready-made phenomena (heat, fluids, fire, light, sound, contacts, orbits, exchanges, growth).

Concepts: [entities](../../concepts/entities.md) · [networks](../../concepts/networks.md) · [performance](../../concepts/performance.md) · [physics](../../concepts/physics.md) · [space](../../concepts/space.md) · [underground](../../concepts/underground.md)

<!-- tree:reference/core/simulation -->
```tree
simulation/
├── agents/
│   ├── behaviour
│   ├── rhythm
│   ├── habitat
│   ├── senses
│   ├── populations
│   └── tiers
├── fields/
│   ├── raster
│   ├── surface
│   ├── graph
│   ├── volume
│   └── kernels
├── rules/
│   ├── presets
│   ├── custom
│   ├── coupling
│   └── regimes
├── fidelity/
│   ├── fixed
│   └── observed
├── measure/
│   ├── probes
│   ├── sensors
│   └── validation
├── constants
└── phenomena/
    ├── heat
    ├── fluids
    ├── fire
    ├── light
    ├── acoustics
    ├── contacts
    ├── orbits/
    │   ├── ephemerides
    │   ├── tle
    │   ├── n-body
    │   └── transfers
    ├── exchanges
    └── growth
```
<!-- /tree -->

## API: agents

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `agents/behaviour` | `behaviour(spec)` | `states: Record<name, (a, s) => next?>` · `start: string` · or `tree: BehaviourTree` | `Behaviour` | [planned] | `behaviour({ start: 'home', states: { home: (a, s) => s.time.hour > 7 && 'work' } })` |
| `agents/rhythm` | `rhythm(spec)` | `day?: [hour, activity][]` · `week?: Record<day, factor>` · `year?: Record<month, factor>` · `jitter?: minutes = 20` | `Rhythm` | [planned] | `rhythm({ day: [[6, 'commute'], [8, 'work'], [17, 'commute']] })` |
| `agents/habitat` | `habitat: Source \| (point, s) => boolean` | areas or a function | where an agent may go | [planned] | `habitat: zones.union(parks, walkways)` |
| `agents/senses` | `senses: { see, hear }` | `see?: { range: number = 30, angle: degrees = 120 }` · `hear?: { range: number = 50 }` | `a.sees`, `a.hears` each tick | [planned] | `senses: { see: { range: 40 } }` |
| `agents/populations` | `population(options)` | `data: Source` (census, counts) · `per: d => int` · `agent: AgentSpec` · `seed?` | element | [planned] | `population({ data: blocks, per: d => d.props.residents, agent: resident })` |
| `agents/tiers` | `tiers: { full, simple, counted }` | `full?: { level: name \| name[] \| { from?, to? } = { from: 'street' } }` · `simple?: { level = ['city', 'district'] }` · `counted?: { cell: number = 1000 }` (the tier follows the observation level, never the camera's distance: a level change moves agents between tiers once) | — (counts are conserved: an agent leaving a tier enters the next; the totals per cell never change) | [planned] | `tiers: { full: { level: { from: 'building' } } }` |

## API: fields, rules, fidelity, measures and constants

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `fields/raster` | `field({ kind: 'raster', … })` · `.step(seconds)` · `.play(rate)` · `.pause()` · `.at(point)` · `.values()` · `.sync()` · `.reset(init)` · `.setParams(p)` | `id: string` · `res: number` (metres a cell) · `area: [w, s, e, n] \| { centre, size }` · `init?: number \| (lon, lat) => number \| grid = 0` · `rule: Rule \| Kernel \| fn` · `inputs?: Record<name, Field \| number \| fn \| grid \| 'terrain'>` · `params?` · `rate?: s/s = 0` · `dt?` (default the rule's stable step) · `draw?: { ramp, domain, opacity, min, channel, on: 'ground' \| 'surface', base } \| false` · `gpu?: 'auto' \| boolean` | `Field` (a layer) | [built] (a grid over a piece of the ground, four numbers a cell; stepped on the chip where it takes float targets (one draw a step into a float texture: WebGPU and WebGL2 alike) and on the CPU otherwise, cell for cell the same arithmetic (checked against each other on both); read back a few times a second, never stalling; drawn into the ground's tiles in a ramp, or as a surface standing on its base input (water over the streets) straight from the chip's state; plays with the world's clock; `fidelity` and `area: view` planned) | `field({ id: 'flood', res: 3, area: { centre, size: 600 }, rule: rules.shallowWater(), inputs: { ground: 'terrain' } })` |
| `fields/surface` | `field({ kind: 'surface', on })` | `on: Element \| Shape` (values per vertex of its mesh) · `rule` | `Field` | [planned] (a research prototype exists) | `field({ kind: 'surface', on: 'buildings', rule: rules.heat() })` |
| `fields/graph` | `field({ kind: 'graph', on })` | `on: Network` · `at?: 'nodes' \| 'edges' \| 'both' = 'both'` · `rule` | `Field` | [planned] | `field({ kind: 'graph', on: pipes, rule: rules.flow() })` |
| `fields/volume` | `field({ kind: 'volume', … })` | `res: [xy, z]` · `height: [low, high]` · `on?: 'ground' \| 'absolute' = 'ground'` · `rule` | `Field` | [planned] | `field({ kind: 'volume', res: [50, 10], height: [-2000, 0], rule: rules.heat() })` |
| `fields/kernels` | `rule: { wgsl, glsl?, cpu?, params?, inputs?, maxDt? }` · `kernel(k)` | `wgsl: string` (sets `next` from `cur`, `dt`, `cell`, your params by name, `laplacian(cur)`, `at(dx, dy)`, `in0…in3(dx, dy)`; the same text serves GLSL when it is expressions only) · `cpu?: (cur, n, dt, p) => number` (where the chip cannot) | `Rule` | [built] (compiled into the field's step on WebGPU and WebGL2; without `cpu` it runs on chips with float targets only and says so) | `rule: { wgsl: 'next = cur + dt * k * laplacian(cur);', params: { k: .2 }, cpu: (c, n, dt, p) => c + dt * p.k * n.laplacian }` |
| `rules/presets` | `rules.diffusion(o)` · `rules.advection(o)` · `rules.heat(o)` · `rules.shallowWater(o)` · `rules.flow(o)` | diffusion `k` (m²/s) · advection `wind: [u, v] \| 'input'` · heat `k`, `relax`, `to: number \| 'input'`, `sourceScale` (inputs target, source) · shallowWater / flow `friction`, `gravity`, `rain`, `rainScale`, `openEdges` (inputs ground, rain) | `Rule` (a WGSL kernel and its GLSL twin, and the CPU path) | [built] (each with its longest stable step; shallow water is the pipe model with the depth over the higher ground at each face, never more than a quarter of a cell's water a step, walls or open edges; flow is the same water slower, rain falling on it) | `rule: rules.diffusion({ k: .2 })` |
| `rules/custom` | `rules.custom(fn, opts?)` · or `rule: fn` | `fn: (cur, n, dt, p) => next` · `n: { laplacian, neighbours: [e, s, w, n], inputs }` · `dt: seconds` · `p: params` · `opts: { params, inputs, maxDt }` | `Rule` (CPU) | [built] (runs on the CPU on every graphics; a kernel for the chip is `{ wgsl, cpu }`) | `rule: (c, n, dt, p) => c + dt * p.k * n.laplacian` |
| `rules/coupling` | `inputs: { name: field }` · `couple(a, b, fn)` | `fn: (a, b, dt) => void` · `rate?: hz` per field (each runs at its own pace) · recompute only when an input changed | — | [planned] | `couple(rain, flood, (r, f, dt) => f.add(r.value * dt))` |
| `rules/regimes` | `world(canvas, { regime })` · per rule `regime` | `regime: 'surface' \| 'atmosphere' \| 'orbital' \| 'relativistic'` · `frame?: 'rotating' \| 'inertial'` (rotating adds Coriolis to fluids and winds) | which physics applies, stated, not guessed | [planned] | `field({ rule: rules.shallowWater(), regime: { frame: 'rotating' } })` |
| `fidelity/fixed` | `fidelity: { fixed: res }` | `res: number` | — | [planned] | `fidelity: { fixed: 5 }` |
| `fidelity/observed` | `fidelity: { observed: { near, far } }` | `near: number` · `far: number` (metres per cell) · `by?: 'level' = 'level'` (the resolution follows the observation level, never the camera's distance: it changes once, at a level change) | — | [planned] | `fidelity: { observed: { near: 1, far: 16 } }` |
| `measure/probes` | `field.probe(opts)` · `field.at(point)` | `at: Point` \| `along: Line` \| `over: Area` (a ring) · `every?: 'step' \| seconds = 'step'` | `Probe { value, series, stop() }` · `number` | [built] (the mean of the value where it looks, as the field steps; a series of (simulated seconds, value)) | `water.probe({ at: [107.61, -6.9] })` |
| `measure/sensors` | `field.sensor(opts)` | `id: string` · `feed: Source` · `probe: Probe` · `map?: d => number` | `Sensor { measured, modelled, error }` | [planned] | `water.sensor({ id: 'gauge-3', feed, probe: gauge })` |
| `measure/validation` | `field.validate(opts)` | `against: Source` · `metric?: 'rmse' \| 'bias' \| 'nse' \| fn = 'rmse'` · `period?: [t0, t1]` | `Promise<{ score, series }>` | [planned] | `await water.validate({ against: data.csv('…/2024.csv') })` |
| `constants` | `constants.load(name)` · `constants.get(path)` · `constants.add(name, table)` · `constants.materials(ids)` | `name: 'materials' \| 'physics' \| yours` · every value `{ value, unit, source }` | citable parameter tables (albedo, emissivity, evaporation, heat capacity, conductivity…) | [built] (the street's materials and the physical constants the phenomena use, each with its source; your own tables join them; the heat rasters take their materials from the table, so a value replaced there is the model's) | `constants.get('materials.asphalt.albedo')` |

## API: phenomena

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `phenomena/heat` | `heat(options)` · `.run({ input, options, metric })` · `.compare(variantRasters)` · `.point(at)` · `heatModel(rasters).field(input, options)` | `rasters` (placed on the Earth: `{ w, h, cell, mat, materials, bH, cTop, cBase, region, walk, lonLat, xzOf }`) · `input: { hour, weather, day?, sunAt, key }` · `options?: HeatOptions` (each piece of physics on or off) · `metric?: 'utci' \| 'feels' \| 'tmrt' \| 'air' \| 'surface' = 'utci'` · `height?: m = 1.1` · `draw?` | element (a raster field, its street means `summary`) | [built] (sun and shade from buildings and tree crowns, sky view, walls by orientation, surface temperatures by their energy balance with heat stored through the day (force–restore), street canyon air, mean radiant temperature (SOLWEIG-style), UTCI (the published polynomial) and apparent temperature; on the CPU in slices (the page keeps drawing), drawn as a field on WebGPU and WebGL2; a change compared as a difference; a person's breakdown in sun and shade) | `w.add(heat({ id: 'heat', rasters, input, metric: 'utci' })).run()` |
| `phenomena/fluids` | `fluid(options)` | `kind: 'water' \| 'wind' \| 'smoke'` · `res?: number` · `sources?: Source` | element (field + look) | [planned] (a research prototype exists) | `fluid({ kind: 'wind', res: 100 })` |
| `phenomena/fire` | `fire(options)` | `fuel: RasterSource` · `wind?: FieldRef` · `ignite?: Point[]` | element | [planned] | `fire({ fuel, ignite: [p], wind: 'wind' })` |
| `phenomena/light` | `light(options)` | `kind: 'shade' \| 'sky-view' \| 'visibility' \| 'night'` · `res?: number` | element | [planned] (a research prototype exists) | `light({ kind: 'shade', res: 2 })` |
| `phenomena/acoustics` | `noise(options)` | `sources: Source` · `level: d => dB` · `res?: number = 10` | element | [planned] | `noise({ sources: roads, level: d => d.props.traffic_db })` |
| `phenomena/contacts` | `contacts(options)` · `w.solids` | `solids: Source \| 'compiled'` · `gravity?: number = 9.81` · `water?: { buoyancy, swim }` (floating, wading, swimming) | ground and collision queries for entities | [planned] | `w.solids.column(x, z)` |
| `phenomena/orbits/ephemerides` | `ephemeris(body, t)` | `body: 'sun' \| 'moon' \| 'mars' …` · `t: Date` | `{ position, velocity }` (inertial) | [planned] (a research prototype exists) | `ephemeris('moon', new Date())` |
| `phenomena/orbits/tle` | `orbit.tle(line1, line2)` | `line1, line2: string` | `Orbit` (propagated each frame) | [planned] | `orbit.tle(l1, l2).at(t)` |
| `phenomena/orbits/n-body` | `nbody(bodies, opts)` | `bodies: { mass, position, velocity }[]` · `dt?: seconds = 60` | element | [planned] | `nbody(asteroids, { dt: 3600 })` |
| `phenomena/orbits/transfers` | `transfer(opts)` | `from, to: BodyId \| Orbit` · `depart: Date` · `kind?: 'hohmann' \| 'lambert' = 'lambert'` | `Path` | [planned] | `transfer({ from: 'earth', to: 'mars', depart })` |
| `phenomena/exchanges` | `exchange(kind, opts)` | `kind: 'quake' \| 'landslide' \| 'crater' \| 'dig'` · `at: Point` · `size: number` | changes the ground and fields | [planned] (a research prototype exists) | `exchange('landslide', { at, size: 200 })` |
| `phenomena/growth` | `growth(options)` | `of: Source` (vegetation, urban) · `rate: (d, s) => number` · `limit?: Fn<number>` | element | [planned] | `growth({ of: trees, rate: d => d.props.species.rate })` |

## Example

Agents:

```ts
const resident = agent({
  shape: humans.random,
  behaviour: behaviour({ start: 'home', states: {
    home: (a, s) => s.time.hour >= 7 && 'commute',
    commute: a => a.arrived && 'work',
    work: (a, s) => s.time.hour >= 17 && 'home',
  }}),
  rhythm: rhythm({ jitter: 30 }),
  habitat: walkways,
});
w.add(population({ data: blocks, per: d => d.props.residents / 20, agent: resident,
                   tiers: { full: { level: { from: 'street' } }, counted: { cell: 1000 } } }));
```

Fields and phenomena:

```ts
const water = w.add(field({
  id: 'flood', kind: 'raster', res: 2,
  rule: rules.shallowWater({ friction: .03 }),
  inputs: { ground: 'terrain', rain: data.stream('wss://…/rain') },
  fidelity: { observed: { near: 1, far: 16 } },
  draw: { ramp: 'blues', when: (d, s) => d.value > .05 },
}));
const gauge = water.probe({ at: [107.61, -6.9] });
const { score } = await water.validate({ against: data.csv('…/flood-2024.csv') });
```

## Open questions

- (agents) Behaviour trees or plain state functions as the default form?
- (agents) Should agents run in a worker lane by default?
- (phenomena) How much of a custom rule function can be translated to a GPU kernel automatically (pure maths only)?
- (phenomena) Should every field declare its unit, so coupling can check them?
- (phenomena) A research prototype carries a planet-wide `Fluid`, not inside `world()`: wire it as the first `fluids` preset.
