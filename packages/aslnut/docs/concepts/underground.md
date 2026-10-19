# Underground

> Draft under discussion. Interface and structure only.

**In one line:** below the ground is a world too: rock **strata**, **wells** and drill paths, aquifers, **magma**, all placed with `on: 'ground'` and negative heights, filled as **volumes**, and seen through **cutaways** that slice the surface open.

## Why

- **Geothermal, mining, groundwater, tunnels, cables:** half of infrastructure is underground.
- **Volcanoes and earthquakes** start there.
- **You can't see it without a cut:** cutaways are the tool that makes it readable.

## The rules

1. **Heights below the ground are negative,** measured from the terrain: `on: 'ground', height: -350` means 350 m under the surface right there.
2. **Strata** are layers of rock between surfaces (from boreholes, a model, or your function).
3. **Wells** are paths: vertical, deviated or horizontal, with casing, depths and readings along them.
4. **Volumes** are 3D grids (temperature, porosity, magma melt) drawn as slices, isosurfaces or clouds.
5. **Cutaways** open the view: a box, a plane, a trench along a line, or a circle around the camera. The surface and everything above step aside inside the cut.
6. **Physics** works here too: `volume` fields for heat and groundwater.

```tree
underground/
├── strata/
│   ├── surfaces
│   ├── layers
│   └── faults
├── wells/
│   ├── path
│   ├── casing
│   ├── logs
│   └── drilling
├── aquifers
├── magma/
│   ├── chamber
│   ├── conduit
│   └── melt
├── volumes/
│   ├── slices
│   ├── isosurfaces
│   └── clouds
└── cutaways/
    ├── box
    ├── plane
    ├── trench
    └── around-camera
```

Plain meanings: **stratum** (plural strata) = one layer of rock; **isosurface** = the surface where a value is exactly some number (every point at 200 °C); **well log** = readings measured down a well.

## Examples

```ts
// 1 · strata from boreholes
w.add(strata({ data: data.csv('…/boreholes.csv'), layers: ['soil', 'tuff', 'andesite', 'reservoir'] }));

// 2 · wells with their paths and a temperature log, drilling progress from a stream
w.add(wells({
  data: data.geojson('…/wells.geojson'),
  path: d => d.props.survey,                 // [[md, inclination, azimuth], …]
  log:  { field: 'temp', ramp: 'inferno' },
  drilling: data.stream('wss://…/rig-7'),     // the drilled depth grows live
}));

// 3 · a magma chamber as a volume, an isosurface at 700 °C
w.add(volume({ id: 'melt', data: data.raster('…/temp.vol'), on: 'ground', height: [-12000, -3000],
               draw: { iso: 700, color: '#ff5a1f' } }));

// 4 · a cutaway trench along a line, only at the district level and closer
w.cutaway({ kind: 'trench', along: section, depth: 4000, when: { level: { from: 'district' } } });
```

## How it relates

- **[Presence](presence.md):** `on: 'ground'` with negative heights.
- **[Physics](physics.md):** volume fields.
- **[Render](../reference/core/render.md):** cutaways are drawn by the renderer.
- **[Earth](../reference/modules/earth.md):** `earth.subsurface` holds the presets.

## Common mistakes

- **Absolute heights for underground things.** Use heights from the ground, or a hill moves your well.
- **Drawing underground without a cut.** Nobody sees it; add a cutaway.

## Status

| part | status |
|---|---|
| everything on this page | [planned] |
