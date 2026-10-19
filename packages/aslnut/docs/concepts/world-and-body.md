# World and body

> Draft under discussion.

**In one line:** a **world** is one place with everything in it, and it always stands on a **body**: the Earth, the Moon, Mars, a flat floor, or several bodies together.

## Why

- **One entry for every kind of app.** A dashboard, a game, a flood lab and a space view all start the same way.
- **The same words on every body.** A line is a line on the Earth, on Mars or on a game floor; only the body changes.
- **Earth is a preset, not the core.** The core knows nothing about the Earth, so a plane lab or another planet needs no special code.

## The rules

1. Every world has one body (`body:`) or several (`bodies:`).
2. Everything else is added **on** the body: layers, shapes, entities, fields.
3. A world without a screen (`world(null)`) is **headless**: the same params, queries and simulation, no drawing. It runs in Node or a worker.
4. What belongs to one body only (Earth's imagery providers, roads, weather) lives in that body's module, never in core.

## Examples

```ts
// 1 · the Earth, default look
const w = await world(canvas, { body: earth() });

// 2 · a flat lab or game floor, 200 m wide
const lab = await world(canvas, { body: plane({ size: 200 }) });

// 3 · several bodies, real positions on a date
const sky = await world(canvas, { bodies: [sun(), earth(), moon()], time: '2026-10-11T12:00Z' });

// 4 · headless: no screen, same answers (for servers, tests, analysis)
const hl = await world(null, { body: earth({ terrain: [terrain.grid({ url: '/dem/bandung-30m' })] }) });
const h = await hl.ground.at(107.61, -6.83);     // metres
```

Everything lives on the body:

```ts
w.add(line({ … }), area({ … }), points({ … }));        // marks drawn from data
w.add(entities({ data: farms, shape: windTurbine }));   // things that can move
w.add(field({ kind: 'surface', rule: rules.shallowWater }));   // values that flow
w.go({ lon: 107.6, lat: -6.9, zoom: 12, tilt: 50, bearing: 20 });  // where you look
```

## What a body is

```tree
body/
├── shape/
│   ├── sphere
│   ├── ellipsoid
│   └── plane
├── gravity
├── rotation
├── surface/
│   ├── imagery
│   └── terrain
├── shells/
│   ├── atmosphere
│   ├── crust
│   └── mantle
└── frames
```

| part | plain meaning |
|---|---|
| shape | the body's form: a sphere, an ellipsoid (the Earth is slightly flattened), or a flat plane |
| gravity, rotation | how strongly things fall; how fast it turns (the length of a day) |
| surface | the ground as tiles: imagery (the picture) and terrain (the heights) |
| shells | layers above and below the ground: air, crust, mantle |
| frames | its own coordinates; the world links all bodies' frames together |

| body | what it is | status |
|---|---|---|
| `earth()` | the Earth with imagery and terrain lists | [partly] (a sphere for now; provider factories built) |
| `plane()` | a flat floor: a lab, a game level, an interior | [planned] |
| `sun()` | the star: light and position | [planned] (a research prototype exists) |
| `moon()`, `mars()` | other bodies with their tiles and real positions | [planned] |

## Sea level, the seafloor and rivers that follow it

**In one line:** the Earth's terrain includes the seafloor, and the sea level is a value of the world that can change; water is drawn wherever the ground is below it, and rivers can be traced from the terrain itself.

```tree
earth/
├── base/
│   └── terrain/
│       ├── mapzen
│       ├── gebco
│       └── etopo
├── sea/
│   ├── level
│   ├── shore
│   ├── look
│   └── exposed
└── hydrology/
    ├── water
    └── flow
```

```ts
// an ice-age shelf: the sea falls to −120 m and rises again; rivers cross the dry shelf
const w = await world(canvas, {
  body: earth({
    terrain: [terrain.mapzen(), terrain.gebco({ when: { below: 0 } })],   // land + seafloor
    sea: {
      level: s => seaCurve(s.time.ago),          // metres; your own curve, a param, or a data series
      look: { color: ramps.depth },              // coloured by depth
      exposed: { look: looks.lowland() },        // dry seafloor drawn as land
    },
  }),
});

w.time.set({ ka: 140 });                         // 140,000 years ago
w.add(line({ data: water.flow({ min: 200 }), reveal: { mode: 'trace' } }));    // rivers from the terrain
w.add(area({ data: data.epochs(iceSheets), color: '#eef' }));                   // ice extent per epoch
const counter = s => `${s.world.readouts['earth.seaLevel']} m · ${s.time.format('ka')}`;   // for your own overlay
```

- **The coast moves smoothly** because it is computed from the sea level and the terrain, not from a fixed outline.
- **Rivers re-route** when the sea level or the terrain changes: `water.flow` is a data source like any other, drawn with `line` and revealed with `trace`.
- **Datasets that change over time** (ice sheets per epoch, shorelines per century) are one source with `data.epochs`; `when` and the clock pick the frame.
- Reference: [sea/level](#reference/modules/earth~water-sea-level), [hydrology/flow](#reference/modules/earth~water-hydrology-flow), [base/terrain/gebco](#reference/modules/earth~body-base-terrain-gebco), [time › paleo](#reference/core/time~deep), [data › epochs](#reference/core/data~history-epochs).

### The sea's look and its shore (built)

The plan above is the whole of it; what exists now is `sea({ level, look, shore })`, a layer that gives the world its sea (over `water()`'s plain one). It is visual fluid: aslnut's own algorithm for the picture, not a simulation.

```tree
sea/
├── look     the waves the wind raises, the water by its depth, the sky and the sun in it
│   ├── waves       a sum of directional waves (a fully developed sea for the wind's speed, a swell when given)
│   ├── tiers       realistic: the sea's own surface near the eye, lifted by them · lite: the ground's sea, flat
│   └── far away    the waves too small to see left out, their roughness kept (the glitter widens, never flickers)
└── shore    where it meets the land
    ├── field       the coast's signed distance round the eye, made once a window, a slice a frame
    ├── breakers    in from the surf zone in order, slower as the water shallows, foam on their faces
    └── swash       a thin sheet up the sand and back, the sand wet behind it
```

```ts
w.add(sea({
  look: { wind: { speed: 6, from: 120 }, swell: { height: 1.3, period: 12, from: 225 } },
  shore: { coast: data.geojson('/coast.geojson'), surf: 140, runup: 14, period: 11 },   // natural=coastline: land on the left
}));
```

- **One sea, two drawings.** The ground's sea (the surface program) and the sea's own surface near the eye read one block of uniforms and one field: a phone's flat sea and a desktop's displaced one look alike, and the governor can trade one for the other without a visible change.
- **Nothing per vertex or pixel on the main thread.** Each frame only the waves' phases at the view's centre are written (a frame fixed to the ground: the waves stay where they are as the eye moves); the coast's field is made once for a window round the eye and again only when the eye moves to another.
- **The coast's line wins near it.** Where the field knows the coast, it says where the water is and lays the ground under it; elsewhere the terrain's height does.
- **Any coast, any app.** The field takes any lines with the land on their left (OpenStreetMap's coastline as it comes) or polygons of land.
- Reference: [sea/look](#reference/modules/earth~water-sea-look), [sea/shore](#reference/modules/earth~water-sea-shore).

## Open questions

- **Your decision needed (conflict 4):** the older planet simulation grid (a whole-Earth cell grid for fluids and climate) has no home yet. Proposal: it becomes a `field({ kind: 'surface' })` on any body ([phenomena › fields/surface](#reference/core/simulation~fields-surface)), so it needs no Earth-only module.

## How it relates

- **[Presence](presence.md):** what's on the body may exist without being shown.
- **[Observation](observation.md):** the camera's view on the body decides detail.
- **[Data](data.md):** layers bring data onto the body.
- **[Entities](entities.md):** things that move stand on, ride or fly over the body.
- Reference: [core › space](../reference/core/space.md), [modules › world](../reference/modules/world.md), [modules › earth](../reference/modules/earth.md).

## Common mistakes

- **Putting Earth things in core.** A road or an imagery provider belongs to `modules/world/earth`.
- **Expecting `world(null)` to draw.** It answers questions (heights, params, readouts, simulation), it doesn't make pictures.
- **Treating terrain on/off as a layer change.** Layers stand on the ground whatever the terrain is (see [presence](presence.md) and `on: 'ground'`).
