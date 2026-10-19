# Observation

**In one line:** who looks, from where, at what level, decides what is present; the camera never decides the data, and moving it only moves the picture.

## The chain

aslnut is a viz engine: a twin is viz, a GIS map is viz. Every world is looked at through one chain of four links:

```
orbit › observation › data › viz
```

- **One job per link.**
- **A link passes a change on only when its gate says so.** A change that no gate lets through stops there.
- **Only the orbit costs something every frame.** The rest is asked only when the link before it changed.

| link | its job | what changes it | what it costs a frame |
|---|---|---|---|
| **orbit** | where the eye is: zoom, tilt, bearing, roll | a hand, a flight, a follow | the picture's uniforms (the view's matrices); nothing else |
| **observation** | the level being looked at (a ladder: world › country › region › city › district › street › building › room) | the orbit, only through a binding, past a margin and after a dwell; or the app | nothing while the level holds |
| **data** | the truth: features, rows, fields | simulation and time only; never looking | nothing; loading is a cache, never seen |
| **viz** | geometry (things as they are) and encoding (data as signs), drawn by render | a level change (one swap), a data change (only what changed) | nothing beyond drawing what is there |

## The orbit: acrobatic

- **Always assume the person flies acrobatically.** Zoom, tilt, bearing and roll, at any speed, at any time, back and forth over the same place.
- **Each frame only the picture moves.** Nothing is loaded, rebuilt, recoloured or faded because the eye moved.
- **Tests fly acrobatically by default.** A world is measured with a script that zooms, tilts, spins and stops, on WebGPU and WebGL2, at phone size.

## Observation: the level

- **A level is a rung of a ladder.** The default ladder is world › country › region › city › district › street › building › room. An app renames it or cuts it (a campus app: campus › building › room).
- **The level decides presence:** what is shown. A building's rooms at `room`, the districts' totals at `city`.
- **It changes only past the edge by a margin, and after a dwell.** The margin is 0.3 zoom levels past the edge; the dwell is 0.5 s there. A zoom hovering on an edge, a wheel's burst over it, a pinch that overshoots and comes back: none of them flips the level.
- **The app can set the level directly.** The orbit drives it only through a binding (on by default when there are levels). With no binding, the level is the app's alone.
- **Observation is more than the camera.** The camera is one observer. Others are planned: a person's eyes in the world, a sensor, a fixed view.

```tree
observation/
├── observers    who looks: the orbit (the camera) today; eyes, sensors and fixed views planned
├── levels       the ladder, the level now, the binding (orbit → level)
├── gates        margin (hysteresis), dwell (debounce), keep (the last levels' data)
└── presence     what is shown: by level, by time, by state
```

## Data: never changed by looking

- **Data is the truth.** Looking at it never changes it. Only simulation and time change data.
- **Ahead:** as the orbit nears a level's edge, the next level's data loads quietly in the background.
- **Swap once:** when the level changes, the new level's things come in together, once. The old ones stay until the new ones are ready.
- **Keep:** the last two levels' data stay for 60 s, so going back is instant.
- **Loading is a cache.** Whatever is loaded for speed is invisible: the same features, the same values, the same colours, whether they came early, late or from the cache.

## Viz: the same value, the same look

- **A look comes from the feature and the settings only.** The same value gives the same colour, always, at every zoom.
- **The join:** after a swap or a data change, only the new, changed and gone features redraw. What stayed never fades in again or blinks.
- **Render detail is invisible.** Coarser ground tiles far away and simpler shapes when small are chosen by size on screen, coarse first and never a hole, and never change a look or a colour ([performance](performance.md)).

## GIS, twin, hybrid

- **GIS sets no levels by default.** There is no gate: each layer loads once and stays; zoom, tilt and spin only move the picture.
- **A twin uses levels.** Its parts come and go by level, with the gates above.
- **A hybrid shares one stack and one level.** GIS layers over a twin stay as they are; the twin's parts follow the level.

## Three kinds of zoom-dependent behaviour, and nothing else

Anything that changes with zoom or distance is exactly one of three:

| kind | where it lives | the rule |
|---|---|---|
| **(a) presence** | the observation level (`when: { level }`) | changes only at a level change, past the margin, after the dwell; swaps once |
| **(b) render detail** | core › runtime › detail | coarse first, never a hole, never a visible change of look or colour |
| **(c) loading** | the data cache | invisible: never changes what is shown or its colour |

Nothing else may depend on the camera. A colour, a class, a label's text or a feature set that moves with the zoom is a bug.

## Examples

```ts
// a GIS map: no levels, no gates; each layer loads once and stays
const w = await world(canvas, { body: earth() });
w.add(layer({ id: 'suburbs', data: data.wfs(url, { typeName, extent }), area: { color: scale.quantile(rate) }, labels: { text: name } }));

// a twin: the default ladder, bound to the orbit (margin 0.3, dwell 0.5 s, keep 2 levels for 60 s)
const t = await world(canvas, { body: earth(), observation: { levels: 'default' } });
t.add(extrusion({ data: buildings, when: { level: { from: 'district' } } }));   // district and closer
t.add(points({ data: totals, when: { level: ['region', 'city'] } }));          // these two levels only
t.on('level', (e) => panel.show(e.to));                                          // { from, to, by: 'orbit' | 'app' }

// the app sets the level (a guided tour, a button); the orbit drives it again past the next edge
t.setLevel('street');

// your own ladder and gates
world(canvas, { observation: { levels: [{ name: 'campus', from: 0 }, { name: 'building', from: 16 }, { name: 'room', from: 19 }], margin: 0.5, dwell: 1 } });
```

## How it relates

- **[Presence](presence.md):** `when` reads the level (`s.observation.level`), the time and the state.
- **[Encoding and layers](encoding.md):** a layer is a statement; its look never reads the camera.
- **[Data](data.md):** sources load once; services load over an extent; tiles only add.
- **[Performance](performance.md):** render detail and the budget, invisible by rule.

## Common mistakes

- **A zoom range on a GIS layer.** A GIS layer is shown; it needs no gate. A layer list hides it if the person wants.
- **A colour that reads the view.** `color: s => s.view.zoom > 12 ? …` makes a place change colour as you zoom. Encode the data, not the camera.
- **Classes from what is loaded now.** A scale's domain comes from the whole data, never from the features on screen.
- **Distance or zoom in a twin's part.** Use the level (`when: { level }`); keep distance for render detail only (core › runtime › detail).

## Status

| part | status |
|---|---|
| the orbit: views, keys, flights, follow | [built] |
| the orbit acrobatic: only uniforms move each frame | [built] (measured with an acrobatic script at phone size on WebGPU and WebGL2: within a level no load, no restyle, no fade) |
| the ladder, the level, the binding (margin, dwell) | [built] |
| the app sets the level | [built] |
| presence by level (`when: { level }`) | [built] |
| data ahead, swapped once, kept | [built] |
| other observers (eyes, sensors, fixed views) | [planned] |
| render detail: parents shown while loading, never a hole | [built] |
