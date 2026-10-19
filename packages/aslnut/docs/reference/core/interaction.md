# core › interaction

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist).

**In one line:** finding what's under the finger or mouse, hover looks, events to your functions, signals (selection and toggles that every `when` can read), controllers for the camera and entities, and an undo history for changes made by hand.

Concepts: [interaction](../../concepts/interaction.md)

<!-- tree:reference/core/interaction -->
```tree
interaction/
├── picking/
│   ├── picking
│   └── hover
├── events
├── signals/
│   ├── signals
│   └── selection
├── controllers
└── history
```
<!-- /tree -->

## API

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `picking/picking` | `w.pick(x, y, opts?)` · automatic for hover and tap | `x, y: CSS px` · `elements?: string[]` (only these elements; a layer answers for its signs and labels) · `radius?: px = 4` (taps 12) | `Promise<{ element, id, props, d, index, at: [lon, lat, h], x, y } \| null>` (an id pass over a few pixels, the same on WebGPU and WebGL2; the ground hides what is behind it; the top-most layer wins) | [built] | `const f = await w.pick(e.offsetX, e.offsetY)` |
| `picking/hover` | `hover`, `selected`, `hoverGroup`, `tooltip`, `onHover`, `onTap`, `select` props · world option `tooltip` | `hover?: { color?, mix? = .45, outline?: px, raise?: m, cursor?, shape?: (d, place) => Made \| null, material?, follow? } \| false` (a 3D form on the hovered thing: your shape for its datum, standing where the thing stands: `place = { at, turn, scale, radius? }`; `material` over the shape's own; `follow`: it moves with a moving thing) · `hoverGroup?: d => key` · `tooltip?: (d, s) => string \| HTMLElement` · `onHover?: (f, s) => void` · `onTap?: (f, s) => void` · `select?: 'tap' \| 'toggle'` | — (mouse: hover; touch: a tap shows the tooltip) | [built] (forms: a layer of their own made on first need, never picked) | `streets({ hover: { color: '#ffe066', shape: (d) => d.kind === 'tree' ? crownNet(d.props) : null } })` |
| `events` | `w.on(event, fn)` (returns the function that stops it) | `'hover': (f \| null, pointer)` · `'tap': (f \| null, { x, y, lon, lat })` · `'select': (ids)` · `'frame'` · `'error'` · `'layers': ({ what, ids })` (a layer added, removed, moved, shown or hidden, faded) (`'load'`, `'settled'`, `'governor'`, `'chunks'` planned) | an unsubscribe function | [built] | `w.on('tap', f => f && panel.show(f.props))` |
| `signals/signals` | `signal(initial)` · `sig.set(v)` · `sig.get()` | `initial: any` | a reactive value; any prop can take a signal and updates when it changes | [planned] | `const year = signal(2020); area({ color: d => ramp(d.props[year.get()]) }); year.set(2025)` |
| `signals/selection` | `w.select(ids)` · `w.toggle(name, on?)` · `s.user` · `selected: { color?, mix?, shape, material, follow }` on a layer · `w.selectedBy(id)` | `ids: (string \| number)[] \| null` · `name: string` · a solids layer's `selected`: `color?: colour = '#38bdf8'` · `mix?: 0..1 = .65` · `false`: no colour | `s.user = { hover, selection, toggles, role }` (usable in `when` and styles; layers draw their `selected` look, and a form on each selected thing whose place is known) | [built] (feature layers: their selected colour, outline and raise; solids (buildings, roads, trees): the selected things in their selected colour (blue), through their chunk's tints, on WebGPU and WebGL2; the selected look wins over the hover; a theme keeps them (they are its subjects); an id the world picked from another layer is not this one's (`w.selectedBy`); `isolate`, `highlight` planned) | `when: s => !s.user.selection.length \|\| s.user.selection.includes(d.id)` · `streets({ selected: { color: '#38bdf8' } })` |
| `controllers` | `control(w, layer, target, controller)` · `w.control(target, controller, opts)` | `target: Entity \| null` (null = the map; the entity in an entity layer) · `controller: controllers.walk() \| ride() \| fly() \| custom(read)` (an entity) `\| orbit({ pan?, rotate?, tilt?, zoom?, zoomRange?: [out, in], tiltRange?: [least, most] }) \| pan(o)` (the map: what a person's hands may do; `pan` never turns or tilts) · `opts: { offset?, eye?, blocked? }` (an entity's camera) | — | [built] (walk, ride, fly and your own read the keys and the touch stick into what an entity's drive wants; the camera follows behind, or from its eyes, and a drag looks round; the map's gestures each turned off or kept within a zoom and tilt range; `w.control(null)` gives the default hands back) | `control(w, people, me, controllers.walk())` |
| `history` | `w.history.undo()` · `redo()` · `w.history.mark(label)` | `label?: string` | — | [planned] | `w.history.undo()` |

## Example

```ts
area({
  id: 'suburbs', data,
  hover: { color: '#fff', outline: 3, raise: 30, cursor: 'pointer' },
  hoverGroup: d => d.props.lga,
  tooltip: d => `${d.props.name} · ${d.props.rate}`,
  onTap: f => w.fly({ frame: f, pad: .2 }),
});
w.on('select', (e, s) => panel.list(s.user.selection));
```

## Open questions

- Picking on WebGL2: a colour-ID pass, or CPU picking against the built geometry?
- Should `history` cover data edits (studios), or only view and selection changes?
