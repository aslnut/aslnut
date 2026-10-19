# Physics: fields, rules and probes

> Draft under discussion. Interface and structure only.

**In one line:** a **field** is a quantity spread over space (water depth, temperature, smoke, pressure); a **rule** says how it changes each step; aslnut runs the rule on the graphics chip (or the CPU on WebGL2), couples fields together, and lets you read values back with probes and check them against real measurements.

## Why

- **Twins answer "what if":** where does the flood go, how hot does the street get, where does the smoke drift.
- **Your formula, not ours:** engineers bring their own equations; aslnut runs them fast and draws them.
- **Honest accuracy:** you choose the detail (fixed, or more where you look), and validation says how close it is to measurements.

## The rules

1. **A field has a shape:** `raster` (a grid over the ground), `surface` (values on a mesh), `graph` (values on a network's nodes and edges), `volume` (a 3D grid, for air or the underground).
2. **A rule** advances the field by one step: a preset (`rules.shallowWater`, `rules.diffusion`, `rules.advection`, `rules.heat`) or your own function.
3. **A kernel** is the small piece of code that runs per cell; presets come with WGSL kernels and a CPU path.
4. **Coupling:** a field can read others (rain → water depth → flooded roads → traffic).
5. **Resolution by level:** a field's `res` is one number (the same everywhere) or one per observation level (`res: { level: { street: 1, city: 16 } }`: finer near, coarser far, same rule; its `area` by level too: a smaller piece near, a bigger one far). It is a param by level like any other (core › observation › presence), not a part of its own: at a level change the field becomes a new grid, its state carried over where the two overlap.
6. **Probes and sensors:** read a value at a place, along a line, or over an area, every step; a sensor compares it with a real feed.
7. **Validation:** a run is scored against measured data (error, bias), so a result shows how much to trust it.
8. Fields draw like any element: `field(…).draw({ ramp, when })`.

```tree
physics/
├── fields/
│   ├── raster
│   ├── surface
│   ├── graph
│   └── volume
├── rules/
│   ├── presets/
│   │   ├── shallowWater
│   │   ├── diffusion
│   │   ├── advection
│   │   └── heat
│   └── custom
├── kernels/
│   ├── wgsl
│   └── cpu
├── coupling
├── probes/
│   ├── point
│   ├── line
│   └── area
├── sensors
└── validation
```

Plain meanings: **laplacian** = how different a cell is from its neighbours (what spreads heat); **advection** = carried along by a flow (smoke on wind); **shallow water** = the standard equations for floods on a surface.

## Examples

```ts
// 1 · a flood with a preset rule, fed by rain, finer where you look
const water = w.add(field({
  id: 'flood', kind: 'raster', res: { level: { street: 1, city: 16 } },
  rule: rules.shallowWater({ friction: .03 }),
  inputs: { ground: 'terrain', rain: data.stream('wss://…/rain') },
  draw: { ramp: 'blues', when: (d, s) => d.value > .05 },
}));

// 2 · your own rule, as a function (aslnut writes it into a kernel)
field({
  id: 'heat', kind: 'raster', res: 5,
  rule: (cur, n, dt, p) => cur + dt * (p.k * n.laplacian + p.sun * n.albedo - p.cool * (cur - p.air)),
  params: { k: .2, sun: 1, cool: .05, air: 28 },
});

// 3 · coupling: flooded roads close lanes in the network
network.roads.closeWhere(e => water.at(e.mid) > .3);

// 4 · probes, sensors and validation
const gauge = water.probe({ at: [107.61, -6.9] });              // a value every step
water.sensor({ id: 'gauge-3', feed: data.stream('…/gauges/3'), probe: gauge });
const score = await water.validate({ against: data.csv('…/flood-2024.csv'), metric: 'rmse' });
```

## How it relates

- **[Underground](underground.md):** `volume` fields for groundwater and heat in rock.
- **[Networks](networks.md):** `graph` fields for flow in pipes and roads.
- **[Live twins](live-twins.md):** sensors and scenarios compare runs.
- **[Graphics](graphics.md):** kernels run as compute on WebGPU, on the CPU on WebGL2.
- **[Performance](performance.md):** a resolution by level keeps the cost about the same at every level.

## Common mistakes

- **One huge fixed grid.** Give `res` per level.
- **Trusting a run without validation.** Attach sensors and score it.

## Open questions

- How much of a custom rule function can aslnut translate to a GPU kernel (pure maths only?), and when does it fall back to the CPU?
- Units: should every field declare its unit so coupling can check them?

## Status

| part | status |
|---|---|
| raster and surface fields on the ground, kernels | [planned] (a research prototype exists) |
| graph and volume fields | [planned] |
| rule presets, custom rules, coupling | [planned] |
| a resolution by level (`res` per level) | [planned] |
| probes, sensors, validation | [planned] |
