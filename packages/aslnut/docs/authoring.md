# Authoring aslnut

**In one line:** aslnut makes **worlds** in the browser on WebGPU and WebGL2: the Earth (or a flat floor), what stands on it, what moves on it, and your data drawn over it. This page is enough to write one. The [recipes](../examples/recipes) are six complete scripts, one per kind of app; [llms.txt](llms.txt) carries this page, the recipes, every import and every part's signature (generated: it never drifts). Wrapping aslnut into a platform of your own (components, a flow runtime, a server): the [implementers' guide](implementers.md).

```ts
import { data, earth, imagery, layer, legend, scale, terrain, world } from 'aslnut';

const canvas = document.querySelector('canvas')!;
const w = await world(canvas, {                                              // a promise: await it
  body: earth({ imagery: [imagery.esri()], terrain: [terrain.mapzen()] }),   // the ground: lists of providers
  view: { lon: 145.12, lat: -37.92, zoom: 14, tilt: 40, bearing: 0 },        // where the camera starts
});
w.add(layer({                                                                // one dataset said one way
  id: 'suburbs', label: 'Suburbs by rate', data: data.geojson('suburbs.geojson'),   // loaded once
  area: { color: scale.quantile((d) => Number(d.props.rate), { range: 'reds' }), opacity: 0.8 }, // classes from all of it
  labels: { text: (d) => String(d.props.name) },                            // its names, inside the layer
  tooltip: (d) => `${d.props.name}: ${d.props.rate}`,
}));
legend(w, { for: 'suburbs', title: 'Rate' });
await w.settled();                                                           // the view complete: tiles, data, builds
```

## The model

- **A world stands on a body:** `earth({ imagery, terrain, sky })`, or `plane()` for a flat floor. A view is `{ lon, lat, zoom, tilt, bearing }` (degrees; tilt 0 looks straight down). The view now is `w.camera.view`, in the same terms: `w.fly({ ...w.camera.view, tilt: 40 })`.
- **Elements are added and named:** `w.add(a, b, …)`. Each has an `id`: `w.element(id).setProps({ … })`, `w.hide(id)`, `w.reveal(id)`, `w.remove(id)`; `w.list` is every element, and `w.on('elements', …)` hears the list change.
- **A layer is a statement:** one dataset said one way. `layer({ id, data, area, line, points, extrusion, labels, legend })` holds its data (loaded once, shared by its signs), its signs, its names (`labels`) and its legend: one switch, one place in the stack. A mark alone (`points`, `line`, `area`, `extrusion`, `text`, `raster`, `arc`, `trail`) is a layer of one sign.
- **Data becomes signs:** a source (`data.geojson`, `data.csv`, `data.wfs`, `data.pmtiles`, `data.rows`, `data.query`) feeds a layer. A style prop takes a value, your function of the feature `(d) => …` (its fields in `d.props`), or a `scale.*`. A scale's classes come from the whole data: the same value gives the same look at every zoom. Rows join shapes by a key: `districts.join(rows, { on: 'code' })` (two sources, one of shapes).
- **orbit › observation › data › viz:** the camera only moves the picture. A GIS view has no levels: every layer is shown and stays. A twin is looked at through levels (`world(…, { observation: { levels: 'default' } })`: world › country › region › city › district › street › building › room), and `when: { level: { from: 'district' } }` decides what is present. A level changes past a margin and after a dwell; `w.setLevel('street')` sets it; `w.on('level', …)` hears it.
- **Things stand and move:** ready-made elements from data (`roads`, `buildings`, `vegetation`, `water`); your own shapes (`shape({ params, build })`) placed by `entities({ shape, data })`; moving sets from a log (`entities({ shape, drive: drive.data(log) })`).
- **Kinds and traits:** a kind (`kinds.house`, `office`, `charger`, `vehicle`, or yours: `kind({ name, traits })`) names what every design of it carries: anchors (`entry`, `parking`, `service`), measures (its footprint, its front at +z, its roof), params (`levels`). `shape({ kind, build })` places them with `b.anchor(…)`; `shape.check({ kind })` says what is missing or misplaced; `traits(made, kind)` reads them.
- **`when` decides showing,** on every element and provider: `true`, `{ level }`, or `(s) => …` of the state (`s.observation.level`, `s.time`, `s.user.toggles`, `s.world.params`). Never of the camera.
- **Knobs and queries:** `w.param('group.name', spec, set)` declares a knob, `w.set(key, value)` turns it; a `data.query` with `deps` asks again and its layers recolour.
- **The camera:** `w.go(view)` and `w.fly(view)` set it; `w.follow(thing)` keeps it on a moving thing on damped springs (`track(log, id)`, a point, your function of the time; `heading: true` turns with it); `w.play(moves.chase(thing, { behind, up }))` plays a move (chase, track, crane, dolly, arc, reveal, or `move({ aim: lookAt(thing), keys })` of your own: rigs round what it looks at, each key's ease), a thing in the air looked at where it is. A view tilts to 88° with the eye at street level, 80° high up; the eye stays over the ground.
- **Recording:** `for await (const f of w.record({ fps: 30, seconds: 8, path }))` steps the world's clock a frame at a time, holds each frame until it is complete and reads it back: the same frames on every run. Your code that sets the camera each frame goes in `w.everyFrame(fn, { before: true })`.
- **Settled and report:** `await w.settled()` waits until the view is complete; `w.report()` says what is pending or failed.

## Your own thing

A thing is one `shape`. Its build says what it is (the builder's verbs), what can move (a part's joint), where things attach (anchors) and what repeats over time (`emit`). The element that places it gives the drivers, the attachments and each clone's look.

```ts
// (tri: a triangle's three points; data: your points; walls, roofs: your colours)
const thing = shape({
  id: 'mill', params: { width: num(6, 12, 8) },                 // params: what changes its geometry (one build each, cached)
  build: (b, p) => {                                            // metres in its frame: its foot at y 0, its front +z
    b.solid('box', { size: [p.width, 5, 7], at: [0, 2.5, 0], tint: true });          // takes each clone's colour
    b.group('roof', (b) => b.solid('box', { size: [p.width, 1, 7], at: [0, 5.5, 0] })); // a group: a colour per clone
    b.part('wheel', (b) => b.solid('cylinder', { radius: 2, size: .3, axis: 'x', at: [5, 2, 0] }),
      { pivot: [5, 2, 0], joint: { kind: 'hinge', axis: 'x' } });                  // can turn; nothing turns it yet
    b.anchor('chimney', [1, 9, -2], { kind: 'stack' });                            // where things attach
    b.frame({ at: [1, 9, -2] }, (b) => b.copy((b) => b.mesh(tri), { emit: { count: [24, 8, 0], life: 4, rise: 12, fade: [.7, 0] } }));
  },
  simple: true,                                                 // level 1: the same build, fewer sides
  far: (b, p) => b.solid('box', { size: [p.width, 7, 7], at: [0, 3.5, 0], tint: true }), // level 2: your symbol
  size: { min: 4 },                                             // never under 4 CSS px across
});
const set = entities({ id: 'mills', shape: thing, data,
  variation: { seed: (d) => String(d.id), color: .06, scale: .1 },  // a seeded spread round each colour and size
  tint: (d) => walls[Number(d.props.n) % 4]!, tints: { roof: (d) => roofs[Number(d.props.n) % 3] },
  heading: (d) => Number(d.props.facing), stretch: (d) => 1 + Number(d.props.n) % 3 * .1, // taller (parts ride along)
  joints: { wheel: (d) => ({ rate: Number(d.props.rpm), unit: 'rpm' }) },  // turned on the chip from the clock
  pixels: { full: 120, simple: 25, margin: .2 } });                // each clone's level by its size on screen
w.add(set);
set.joint('m7', 'wheel', { rate: 0 });                             // one clone changed in one write
```

| brick | how | what to know |
|---|---|---|
| levels | `simple: true \| (b, p) => …` · `far: (b, p) => … \| 'box' \| 'dot' \| 'impostor'` · `detail: 0 \| 1 \| 2` on any verb | each clone takes its level by the pixels it covers (`pixels: { full, simple, margin }`); the margin stops it flipping at an edge; unset levels cost nothing (the whole stands in) |
| parts that move | `b.part(name, fn, { pivot, joint: { kind: 'hinge' \| 'wheel' \| 'slider', axis } })` | the element drives it: `joints: { name: { rate, unit } }`, each clone's own `(d) => …`, a formula (`{ formula: 'value = 30.0 * sin(time * 0.5 + seed * 6.28);' }`, degrees), or a log's value (`{ value: 'travel' }` with `history.log({ travel: true })`: every wheel rolls by its car's travel) |
| copies over time | `b.copy(fn, { emit: { count: [whole, simple, far], life, rise, spread, grow, fade, drift } })` | smoke, steam, sparks: born again every `life` seconds, moved and faded on the chip; two a shape, up to 1,023 copies each |
| anchors and attach | `b.anchor(name, at, { kind })` · `entities({ attach: [{ shape: smoke, at: 'stack' }] })` | a shape at every anchor of that name or kind of every clone (still things; on moving ones planned) |
| bodies from a profile | `b.mesh(triangles, { smooth: true, crease: 50 })` · `shape({ defaults: (given) => row })` | your own loft (sections station by station) drawn as smooth panels, edges past the crease kept sharp; a type given brings its row of numbers, what is given besides stands over it |
| vehicles | `cars.make({ type: 'suv' })` · `cars.suv` · `entities({ shape: cars.shape, params: (d) => ({ type: d.props.kind }) })` | each type one row of its silhouette (`presets.json`: wheelbase, overhangs, bonnet, rake, roofline, tail and its rake, clearance, wheel, arch, belt, glass, windows, cladding, lights, load): a new body is a row, not code; `tints: { glass, cladding, load }`; a tractor's trailer turns at its fifth wheel by its track: `log.appendMany(cars.hitch(rows, tractor))` with `joints: { trailer: { value: 'hitch' } }` |
| clones with variety | `tint`, `tints: { group }` (four groups), `stretch`, `scale`, `heading`, `variation: { seed, color, scale, builds }` | a clone is a record on the chip, no geometry of its own: vary the record, build only what changes the geometry (each distinct params × builds is one more draw) |
| size | marks: `size: { m: 40, min: 4, max: 32 }` (metres kept within CSS px) or `{ px: 8 }` · a shape: `size: { min, max }` (px) | one rule for points, lines, arcs, text and shapes: zoom writes nothing |
| priorities | `w.setPriorities({ drop: ['parked'], keep: ['cars'] })` | on a slow device, what loses detail first and what never does |

## React

`aslnut/react` is the same API in a React app (React 18 or 19, an optional peer). `<World>` makes the world on mount and disposes it on unmount; its `elements` are aslnut's own objects, made in render:

```tsx
import { useState } from 'react';
import { layer, plane, scale, type Feature, type Picked } from 'aslnut';
import { World, useWorldEvent } from 'aslnut/react';

const BODY = plane();                                                       // made once, outside the component
const BY_KIND = scale.category((d: Feature) => String(d.props.kind), { range: 'set2' });
const BY_RATE = scale.quantile((d: Feature) => Number(d.props.rate), { range: 'blues' });

function Map({ blocks }: { blocks: Feature[] }) {
  const [byRate, setByRate] = useState(false);
  return (
    <World options={{ body: BODY, view: { lon: 0, lat: 0, zoom: 16 } }} style={{ height: '100dvh' }}
      elements={[layer({ id: 'blocks', data: blocks, area: { color: byRate ? BY_RATE : BY_KIND } })]}  // a change: setProps
      onReady={(w) => console.log(w.api)}>
      <button onClick={() => setByRate((x) => !x)}>colour</button>
      <Panel />
    </World>
  );
}
function Panel() {                                                           // inside <World>: the hooks
  const [picked, setPicked] = useState<Picked | null>(null);
  useWorldEvent('tap', (p) => setPicked(p));
  return picked && <aside>{String(picked.props.name)}</aside>;
}
```

- **Elements are matched by `id`** from one render to the next: a new id is added, a gone one removed, a changed prop set on the element already in the world (`setProps`: a restyle, never a rebuild). Give every element an `id`.
- **Make sources, logs, scales and functions once** (outside the component or with `useMemo`): one made again in render is a new prop each render (a restyle, or for a source a load). Plain values and objects are compared by value.
- **`options`** are what the world is made with. Later, `views`, `time`, `timeZone`, `quality`, `render.shadows`, `theme`, `budget`, `priorities` and `observation` follow their changes; the rest stay (a new world: a new `key`). A changed `view` moves the camera only with `viewChange="go"` or `viewChange={{ seconds: 1.5 }}`.
- **Hooks:** `useWorld()` (null until ready), `useElement(id)`, `useWorldEvent(name, fn)`. The world in `onReady` is the plain one: `w.fly`, `replay(w, …)`, `w.on`.
- **Give `<World>` a size** (`style` or a class); the canvas fills it, the children are drawn over it. On a server it renders an empty box.

## The rules

1. **Pay only for what you set.** Every option is optional, and an unset one costs nothing. Start with a few props.
2. **Everything is configurable** through provider factories with defaults: `imagery.esri({ layer: 'light' })`, `imagery.osm()`, `imagery.custom({ url })`; `terrain.mapzen()`, `terrain.custom({ heights })`; `terrain: []` is flat. Any value can be your function.
3. **WebGPU and WebGL2, both.** `world()` picks one (`graphics: 'auto'`). The API and the picture are the same on both: never write for one only.
4. **One import:** everything comes from `'aslnut'`, except the ready-made people, vehicles and drones: `'aslnut/modules/presets/humans'`, `'…/vehicles'` (`cars`), `'…/drones'`; and the React shell: `'aslnut/react'`.
5. **Errors say the fix:** an `AslnutError` has a `code`, a `message` and a `fix`.

## Pick a recipe

| app | recipe | what it uses |
|---|---|---|
| GIS view | `gis-view` | `imagery.esri({ layer: 'light' })`, `raster.wms`, `data.wfs(url, { typeName, extent })`, `layer({ area, labels })`, `area` / `line` / `points`, `layers(w)`, `legend(w)` |
| district twin | `district-twin` | `roads`, `buildings`, `vegetation`, `sky()`, `render: { shadows: true }`, `time`, `observation: { levels }`, `when: { level }` |
| fleet | `fleet` | `history.log({ values, travel })` + `appendMany`, `entities({ drive: drive.data(log), joints, trail, gauge })`, `replay` |
| analysis view | `analysis` | `theme.dark()`, `subject: true`, `layer` with `scale.quantile` and `labels`, `legend`, `tooltip`, `w.param` + `data.query` + `join` |
| your design of a kind | `own-kind` | `shape({ kind, build })`, `b.group('walls')`, `b.anchor`, `shape.check({ kind })`, `shapes.import(url, { kind, anchors })`, `entities` |
| your own thing | `own-thing` | `shape({ build, simple, far, size })`, `b.part` with a joint, `b.copy` with `emit`, `entities({ variation, tint, tints, joints, pixels })`, `set.joint` |

## Common mistakes

- `d.props.x` is `unknown`: write `String(d.props.name)` or `Number(d.props.rate)` where a string or a number is wanted.
- `earth()` takes lists: `imagery: [imagery.esri()]`, `terrain: [terrain.mapzen()]`.
- A feature you write in code has `props`, not `properties`: `{ id: 'a', props: {}, geometry: { type: 'Point', coordinates: [lon, lat] } }`.
- Names as a second element of the same data: put them in the layer (`layer({ data, area, labels: { text } })`).
- A zoom range or a colour that reads the camera: a GIS layer needs no gate, and a look comes from the data only. In a twin, gate presence by level (`when: { level }`) with `observation: { levels: 'default' }` on the world; `when: { zoom }` does not exist.
- A WMS is a picture: `raster({ source: raster.wms(url, { layers }) })`. A WFS is data, loaded once: `data.wfs(url, { typeName, extent })` (give the `extent` unless the layer is small). A tiled source (`data.pmtiles`, `data.wfs(…, { tiles: true })`) needs its scale's `domain`.
- `legend(w, { for: id })` needs that layer's `color` to be a `scale.*`. `layers(w)` lists the elements that have a `label`.
- A theme mutes everything that is not a subject: give your data layers `subject: true`.
- `w.set(key, v)` needs the knob declared first: `w.param('stats.year', { type: 'number', range: [2019, 2025], default: 2025 }, () => {})`. Keys are dotted.
- Moving things need the clock to run: `replay(w, { log, play: true })`. A gauge shows only where the shape is drawn unless you give it `within` (metres).
- Shadows need a sun: `earth({ sky: sky() })` with `world(…, { render: { shadows: true }, time })` at a daytime hour.
- A part does not move by itself: give its driver in the element's `joints`. A wheel looks the same at every angle: give it spokes or paddles to show it turning.
- `b.mesh` takes its triangles as listed: each faces the side from which its three points run counter-clockwise (that side is lit). The solids and sweeps face outward by themselves.
- A small thing at street zoom (a 2 m cart covers a few px at zoom 17): give its shape the size rule's floor, `size: { min: 8 }` (CSS px), so it stays readable, and expect its whole level only close up (`pixels: { full, simple }` say when).
- Each distinct `params` is a build of its own (and a draw a chunk a level): vary what only looks different with `tint`, `tints`, `stretch`, `scale` and `heading`, not params.
- Anchors are in the shape's frame (metres, its foot at y 0, its front +z) and must meet the kind's traits (llms.txt › Kinds): a house wants an `entry` at the front on the ground, `parking` outside the walls and a `service` point on the ground; an office two entries and four parking bays. An anchor marks where a thing goes: draw the building only, and place what stands at an anchor (a charger, a car) as its own entity. The footprint is the box of a group named `'walls'` when the shape has one (`b.group('walls', …)`), else of all that stands over 0.3 m: without it, a post or a letterbox out by the drive puts the bays inside it.
- `shape.check({ kind })` builds the shape at every param's ends (each min and max): the traits must hold at all of them, so make the counts hold at the smallest size too (enough bays on the narrowest office).
- A model from `shapes.import(url, …)` is placed as it is: `entities({ shape: model, data })`.
- A camera set each frame in `w.on('frame', …)` or a plain `w.everyFrame` lands on the next frame (they run after the draws): use `w.everyFrame(fn, { before: true })`, or a move (`w.play`). A follow need not be asked again each frame: a zoom goes on following, only a pan ends it.
- Never invent a prop or a function: look it up in the API index. A part marked planned does not exist yet.
