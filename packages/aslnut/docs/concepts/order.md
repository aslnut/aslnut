# Order

> Draft under discussion.

**In one line:** elements (marks, layers, the twin's parts) are ordered first by kind (ground pictures at the bottom, points and labels on top), then in the order you add them, and you can override either with `order`, `above` or `below`. A layer's labels take its place among every layer's labels (core › encoding › layers › stack), and labels make room for each other across the stack, the top layer's first.

## Why

- **Sensible by default:** a point is never buried under an area, and a label is never under a building.
- **Exact when needed:** a dashboard often needs one layer just above another.
- **No flicker on the ground:** many layers lie on the same terrain; each needs its own small lift so they don't fight.

## The rules

1. **By kind, bottom to top:** basemap → rasters → areas → lines → extrusions and shapes → points → labels.
2. **Within a kind:** the order you add them; later is on top.
3. **Override** with a number (`order`), or relative to another layer (`above`, `below`).
4. **Move later** with `w.move(id, { above | below | order })`.
5. **Rasters** are painted into the ground's tiles in their order, with their own `opacity` and `blend`.
6. **Draped layers** (on the ground) each get a tiny depth offset in order, so they never flicker.
7. **The ground is under everything placed on it:** the terrain draws itself a few steps of the depth buffer farther than it is (in the shader, the same on WebGPU and WebGL2), so a road, a verge, a park or paint lying on it wins every tie. At street level the near plane stands a tenth of the eye's height over the ground away (at most 2 % of the view's distance), so surfaces a few centimetres apart keep their order as the camera moves.

```tree
order/
├── basemap
├── rasters
├── areas
├── lines
├── extrusions and shapes
├── points
└── labels
```

## Examples

```ts
// 1 · add order within a kind
w.add(raster({ id: 'solar', … }), raster({ id: 'wind', … }));   // wind above solar

// 2 · an explicit number
area({ id: 'crime', order: 5, … })

// 3 · relative to another layer
line({ id: 'grid', above: 'crime', … })

// 4 · change it later
w.move('wind', { below: 'solar' })
```

| blend | effect |
|---|---|
| `normal` | covers what's below, by `opacity` |
| `multiply` | darkens: good for shading |
| `screen` | lightens: good for night lights |
| `add` | adds light: glows |

## How it relates

- **[Data](data.md):** rasters and vectors are ordered differently because rasters are part of the ground.
- **[Presence](presence.md):** order applies only to what's shown.

## Common mistakes

- **Using order to hide something.** Use `when`.
- **Expecting a raster above a vector.** Rasters are part of the ground; draw a vector `area` with an opacity instead.

## Status

| part | status |
|---|---|
| draw order = add order | [built] |
| by kind, `order`, `above`, `below`, `w.move` | [built] |
| raster `blend` | [built] |
| per-layer depth offset on the ground | [built] (every mark lifts toward the camera by `depthBias` pixels) |
