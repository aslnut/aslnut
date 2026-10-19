# Presence: exists vs shown, and one `when`

**In one line:** whether something **exists** (it is counted and simulated) and whether it is **shown** (it is drawn) are two separate questions, and one prop, `when`, decides showing on every element.

## Why

- **The simulation must not depend on the camera.** A hidden flood still wets the streets; hidden residents still fill the census; a turbine you can't see still produces power.
- **One word everywhere is easier** for people and for AI assistants than a different rule per element (`visible`, `minZoom`, `filter`, `enabled`…).
- **Conditions are real needs:** a building's rooms only at the room level, night lights only at night, a layer only for the admin.
- **The camera never decides presence.** What is shown follows the observation level, the time and the state; moving the camera only moves the picture ([observation](observation.md)).

## The rules

1. **Exists** is decided by data and by the simulation: what the source contains, `filter`, `where` (coverage), validity in time, the scenario.
2. **Shown** is decided by `when` (by level, by time, by state), plus what aslnut does on its own (off screen, behind the horizon, label collision). Render detail never shows or hides anything: it only picks a coarser or finer version of what is shown.
3. `when` is on **every** element: terrain sources, imagery, layers, single features, labels, entities, fields.
4. `when` receives **one state object `s`**, the same everywhere.
5. `when` returns `true`/`false`, or a number from 0 to 1 (how much: it fades).
6. When `when` changes, the element's **reveal** plays (see [reveal](reveal.md)).
7. **Who wins, in order, for everything:** `when` (the author's gate; if it says no, nothing below can show it) → exists gates (what doesn't exist can't be shown) → render detail (picks a version by size on screen, invisibly) → the budget (may push detail down under pressure, never up). A rule with **fixed fidelity** overrides observation for its computation, never for its picture ([physics](physics.md)).
8. **A GIS layer has no gate by default.** With no levels set, nothing is gated: each layer loads once and stays.

## The state `s`

```ts
when: (s) => boolean | number

s.observation // level (the rung of the ladder looked at; null: no levels), index, levels, by ('orbit' | 'app')
s.view     // zoom, distance, tilt, bearing, centre, pixelSize: the orbit (for render detail and your own functions, never a look)
s.time     // now, year, month, day, hour, season, local (time zone), ago (years before present)
s.world    // params, readouts (live values)
s.user     // selection, hover, toggles, role
s.device   // api ('webgpu' | 'webgl2'), tier ('low' | 'mid' | 'high'), budget
s.render   // quality ('lite' | 'realistic')
```

## Examples

```ts
// 1 · a building's rooms only at the room level (a twin with observation levels)
extrusion({ data: rooms, when: { level: 'room' } })

// 2 · night-light imagery only at night
imagery.custom({ url: nightTiles, when: s => s.time.hour >= 18 || s.time.hour < 6 })

// 3 · a whole element, and each feature inside it
points({
  data: plants,
  when: { level: { from: 'region' } },                                            // the element: region and closer
  feature: { when: (d, s) => d.props.mw > 100 || s.observation.index >= 4 },        // each feature: big ones from further out
})

// 4 · shorthand for the common cases: the same thing as a function
area({ data: zones, when: { level: ['city', 'district'], hour: [18, 6], year: [2024, Infinity] } })
```

**React** (`aslnut/react`) uses the identical prop. A React state reaches `when` through the state `s` (a toggle), or decides what is in the list:

```tsx
const [showLidar, setShowLidar] = useState(false);
useEffect(() => { w?.toggle('lidar', showLidar); }, [w, showLidar]);                // when: s => s.user.toggles.lidar
<World options={{ body }} elements={[...(showLidar ? [lidarPoints] : [])]} />    // or: in the list, added; out, removed
```

**Exists** is set with data words, not `when`:

```ts
points({ data: plants, filter: d => d.props.status === 'operating' })   // not counted at all otherwise
area({ data: zones, valid: d => [d.props.from, d.props.until] })          // exists only in that time range
```

## Everything that can change presence

```tree
presence/
├── exists/
│   ├── data/
│   │   ├── present in the source
│   │   ├── loaded
│   │   ├── filter
│   │   ├── value threshold
│   │   ├── live add / remove
│   │   └── version
│   ├── time/
│   │   ├── valid from / until
│   │   ├── season
│   │   ├── time of day
│   │   └── schedule
│   ├── space/
│   │   ├── coverage
│   │   ├── body
│   │   └── volume
│   ├── state/
│   │   ├── simulation
│   │   ├── phenomena
│   │   ├── agents
│   │   └── weather
│   └── scenario/
│       ├── base
│       └── variant
└── shown/
    ├── observation/
    │   ├── level
    │   └── observer
    ├── visibility/
    │   ├── frustum
    │   ├── horizon
    │   ├── occlusion
    │   └── cutaway
    ├── budget/
    │   ├── governor
    │   ├── memory
    │   └── priority
    ├── conflict/
    │   ├── label collision
    │   └── overlap priority
    ├── relation/
    │   ├── parent / child
    │   └── depends on another
    ├── user/
    │   ├── toggle
    │   ├── selection
    │   ├── hover
    │   ├── search
    │   └── role
    ├── lens/
    │   ├── style
    │   └── mode
    ├── device/
    │   ├── gpu
    │   └── capability
    └── rights/
        ├── licence
        ├── attribution
        └── privacy
```

Plain meanings: **frustum** = inside the camera's view; **horizon** = not behind the curve of the globe; **occlusion** = not hidden behind a hill or building; **cutaway** = a slice opened to show underground.

## Standing on the ground: `on`

Where something stands is separate from whether it's shown. The default is `on: 'ground'`: it sits on the terrain, whatever the terrain is.

| `on` | means |
|---|---|
| `'ground'` (default) | on the terrain; turning terrain on or off never changes layer code |
| `'sea'` | flat at sea level |
| `'air'` | at `height` above the ground |
| `orbit(…)` | moving along an orbit (satellites) |
| `height: -d.props.depth` | below the ground (wells, pipes, strata) |

## What it costs: asked again only when what it reads changes

A gate is a function, so aslnut watches what it reads. The first time a feature's `when` (or a `filter` function) is asked, every field of `s` it touches is written down (`s.world.params['region']`, `s.observation.level`, `s.user.selection` …). After that the features are asked again only when:

- one of those fields changed (a drill-down param, a level, a selection);
- the data changed;
- once a second (a gate reading your own variables, outside `s`, still catches up).

A still view asks nothing and writes nothing: thousands of features behind a `when` cost no work per frame. Reading through `s` (a param, a toggle) rather than a variable of your own keeps the answer immediate.

## How it relates

- **[Observation](observation.md)** sets the level (`s.observation`) past a margin and after a dwell; `when: { level }` reads it.
- **[Data](data.md)** decides what exists.
- **[Reveal](reveal.md)** plays whenever shown changes.
- **[Configurable](configurable.md):** `when` is one of the props every element accepts.

## Common mistakes

- **Using `when` to remove things from a count.** `when` only hides; use `filter` so it doesn't exist.
- **Hiding a simulation to make it cheaper.** Hidden fields still run; lower their resolution instead.
- **Gating by zoom or distance.** `when: { zoom }` is gone: the camera never decides presence. Use the level (`when: { level }`); keep the view for render detail (core › runtime › detail). A function of `s.view` still works if you insist; it makes the element blink at its edge.
- **Reading the camera directly** (`camera.zoom`) instead of `s`: it breaks headless runs and React.

## Status

| part | status |
|---|---|
| `when` (function, shorthand, per feature) | [built] (elements, imagery, terrain; per feature on every mark, asked again only when the fields it reads change) |
| `when: { level }` (presence by the observation level) | [built] |
| the state `s` | [built] (observation, view, time, world, user, device, render) |
| `on: 'ground'` draping | [built] (points, lines, areas, extrusions, labels and custom layers follow the terrain; rasters are painted into it) |
| `on: 'sea' / 'air' / orbit` | [planned] |
| `filter` | [planned] |
| `valid` (time ranges) | [planned] |
| frustum / horizon culling | [built] |
| occlusion test for markers | [built] (`w.visible(at)`) |
