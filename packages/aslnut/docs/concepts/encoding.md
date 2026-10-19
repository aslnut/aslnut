# Encoding and layers

**In one line:** encoding turns data into signs (a mark per feature, its colour, size, width and text set by scales), and a layer is one dataset said one way: a statement that never changes because someone looked.

## Two ways to make visible

aslnut is a viz engine. It makes things visible in two ways, and render draws both:

- **Depiction** (core › geometry): things as they are. A building's walls and roof, a tree, a road and its bridge.
- **Encoding** (core › encoding): data as signs. A suburb filled by its rate, a line as wide as its flow, a name over its place.

Encoding follows the visual variables of cartography (Bertin's): position, size, value, colour hue, orientation, shape, texture. A mark is the sign; a scale turns a value into a variable; a layer says one dataset one way.

```tree
encoding/
├── marks     the signs: point, icon, text, line, arc, trail, arrows, area, extrusion, raster, grid, rings, drape, custom
├── scales    value → look, from the whole data: the same value, the same look, every time
├── layers    one dataset said one way: its signs (fill, line, labels inside), its legend, its place in the stack
└── join      new, changed, gone: only those redraw
```

## A layer is a statement

"These suburbs, coloured by their area, with their names." That sentence is the layer. It holds:

- **one dataset,** loaded once (a file, a service over an extent, rows joined to shapes);
- **its signs,** inside it: a fill, a line, points, labels. The suburbs and their names are one layer, not two;
- **its legend,** from its scales;
- **its place in the stack,** among the other layers.

What a layer is never changes because someone looked:

- **No gate by default.** A GIS layer is shown; zoom, tilt and spin only move the picture. A layer list hides it when the person asks.
- **Its data loads once and stays.** A service is read over an extent, paged, once. View tiles are only on request, and then they only add features by id.
- **Its look comes from the feature and the settings only.** A colour, a class, a width, a label's text: never from the view.

## Scales: from the whole data

- **`'auto'` means the whole source.** A scale's domain (its classes, its range of values) is read once from all of the source's features, when the source is complete.
- **The same value gives the same look, always.** A suburb is the same blue at every zoom, on every device, loaded early or late.
- **It is read again only when the data changes:** a simulation step, a new time, rows joined anew. Never when the view moves.
- **A tiled source must be given a domain.** Its features arrive by view, so "the whole data" is not known on the device. A scale with `'auto'` over a tiled source is an error that says how to fix it:

```
E-DATA-003  scale.quantile over 'parcels' (a tiled source) has no domain: its classes would change as the view moves
fix: scale.quantile(d => d.props.value, { domain: [10, 20, 40, 80] })   (or a threshold scale with your breaks)
```

## The join: only what changed redraws

Every feature has a stable id. When a layer's data changes (a swap at a new level, a simulation step, a time step), its features are joined to the ones it drew, by id:

| | what it is | what happens |
|---|---|---|
| **new** | an id not drawn before | its shape is built, its reveal plays (in an app, at most a short fade) |
| **changed** | an id drawn before, with new values or a new shape | only it is restyled or rebuilt, eased if you ask (`restyle`) |
| **gone** | an id drawn before, not in the data now | it leaves (its reveal backwards) |
| **stayed** | the same id, the same values | nothing: it never fades in again, never blinks |

## Labels: inside their layer, decided once

- **An anchor per feature, computed once** (a point's place, a line's middle, the inside of an area's largest part), never moved by the view.
- **A fixed priority and a stable order:** your `priority`, then the feature's id. The order never depends on what loaded first.
- **Collision with hysteresis in time:** where each label goes is decided from scratch in that one order (the same on every device, whatever loaded first); a change shows at once, and a label that just changed keeps its new state for 0.25 s before it may change again. Two names never trade places frame after frame, and nothing is left to change once the orbit stops.
- **No re-fades.** A label that stayed never fades in again; it fades only when it truly collides or its feature leaves.

## Examples

```ts
// a statement: the suburbs coloured by their area, with their names (one layer, one place in the stack)
w.add(layer({
  id: 'suburbs', label: 'Suburbs by area',
  data: data.wfs(WFS, { typeName: 'ns:suburbs', extent: [144.9, -38.0, 145.3, -37.8] }),
  area: { color: scale.quantile((d) => d.props.km2, { n: 5, range: 'ylgnbu' }), opacity: 0.35, outline: { color: '#fff', width: 1 } },
  labels: { text: (d) => d.props.name, priority: (d) => d.props.km2, size: 13 },
}));

// one dataset, one mark: the marks alone are layers of one sign
w.add(line({ id: 'creeks', label: 'Creeks', data: data.wfs(WFS, { typeName: 'ns:creeks', extent }), width: 2, color: '#2563eb' }));

// a tiled source: its scale is given its classes
w.add(area({ id: 'parcels', data: data.pmtiles('/parcels.pmtiles'), color: scale.threshold((d) => d.props.value, { domain: [10, 20, 40, 80], range: 'reds' }) }));
```

## How it relates

- **[Observation](observation.md):** the chain orbit › observation › data › viz; a layer sits at the end of it and never reads the camera.
- **[Data](data.md):** what a layer says; sources load once.
- **[Order](order.md):** a layer's place in the stack.
- **[Reveal](reveal.md):** what new and gone features play.

## Common mistakes

- **A zoom range on a layer.** It makes the layer blink at its edge and reload; a GIS layer needs no gate.
- **Names as a second layer of the same data.** Put the labels inside the layer: one statement, one place in the stack, one switch.
- **A scale over what is on screen.** Classes from the loaded features change with the view; give a tiled source its domain.
- **Reading the view in a style.** `width: s => s.view.zoom > 12 ? 3 : 1` changes a look with the camera: render detail never changes a look.

## Status

| part | status |
|---|---|
| marks (point, text, line, arc, trail, area, extrusion, raster, drape, custom) | [built] |
| scales: value → look, legends | [built] (from the whole data; a source that follows the view needs its domain) |
| layers: one dataset said one way, labels inside | [built] |
| the join by id (new, changed, gone) | [built] |
| labels decided once (anchor, priority, hysteresis) | [built] |
