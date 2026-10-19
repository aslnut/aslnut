# Interaction

> Draft under discussion.

**In one line:** every layer and entity can be hovered, tapped and selected; aslnut finds the feature under the finger or mouse, applies the look you set, and calls your functions with the feature and the state `s`.

## Why

- **Dashboards and twins live on it:** hover a suburb to see its number, tap it to fly there.
- **One way for everything:** areas, lines, points, buildings and moving entities all answer the same way.
- **Games need controllers:** walk, ride, fly, through the same events.

## The rules

1. **Picking** finds the feature under a screen point: its layer, `id`, `props`, and where on the ground it was hit.
2. **Hover looks** are props: `hover: { color, outline, raise, cursor }`. They need no code.
3. **`hoverGroup`** lights up a whole group (all suburbs of one LGA) instead of one feature.
4. **`tooltip: d => text`** shows a small label; **`onHover`** and **`onTap`** call your functions with `(feature, s)`.
5. **`w.on(event, f)`** listens for any layer: `hover`, `tap`, `select`, `load`, `settled`.
6. **Selection** is state: `w.select(ids)`, and `s.user.selection` is readable by every `when` and style.
7. **Controllers** drive the camera or an entity: orbit and pan (map), walk, ride, fly.

## Examples

```ts
// 1 · hover and tap on areas
area({
  id: 'suburbs', data,
  hover: { color: '#ffffff', outline: 3, raise: 30, cursor: 'pointer' },  // how the hovered one looks
  hoverGroup: d => d.props.lga,                     // light the whole LGA, not one suburb
  tooltip: d => `${d.props.name} · ${d.props.rate} per 1,000`,
  onHover: (f, s) => panel.preview(f),
  onTap:   f => w.fly({ frame: f, pad: .2 }),       // fly to fit it on screen
});

// 2 · any layer, globally
w.on('hover', f => (status.text = f ? `${f.element}: ${f.id}` : ''));
w.on('tap',   f => f && panel.show(f.props));

// 3 · selection drives looks everywhere
w.select(['vic-3168', 'vic-3169']);
points({ data: schools, color: (d, s) => (s.user.selection.includes(d.props.suburb) ? '#f80' : '#888') });

// 4 · controllers: walk with a person, then hand control back to the map
const me = w.add(entity({ shape: humans.default }));
w.control(me, controllers.walk());      // keys, touch stick, follow camera
w.control(null);                        // back to the map's orbit and pan
```

## What a pick returns

```ts
{
  layer: 'suburbs',
  id: 'vic-3168',
  props: { name: 'Clayton', rate: 41.2, lga: 'Monash' },
  at: [145.12, -37.92, 64],     // lon, lat, metres: where the ground or object was hit
  part: 'wheelFL',              // for shapes: which part was hit, if any
}
```

## How it relates

- **[Data](data.md):** picking needs stable ids.
- **[Presence](presence.md):** `s.user` (hover, selection, toggles) feeds every `when`.
- **[Entities](entities.md):** controllers drive entities; their parts can be picked.
- **[Order](order.md):** the top-most shown feature wins the pick.

## Common mistakes

- **Building hover with your own mouse maths.** Use `hover` / `onHover`; picking knows the terrain and the order.
- **Putting the selection in your own variable only.** Use `w.select` so styles and `when` can read it.

## Status

| part | status |
|---|---|
| tapping the ground (returns lon, lat) | [built] (`w.on('tap', …)`) |
| polygon lookup at a point (`PolygonSource.at`) | [built] (a research prototype's map module) |
| picking features on every layer (an id pass, the same on WebGPU and WebGL2), hover looks, tooltip, `onHover` / `onTap`, `hoverGroup`, `select` | [built] |
| `w.on('hover' \| 'tap' \| 'select')`, `w.select`, `w.toggle` | [built] |
| `w.isolate`, `w.highlight`, signals | [planned] |
| map controllers (orbit, pan, pinch) | [built] |
| walk / ride / fly controllers | [planned] |
