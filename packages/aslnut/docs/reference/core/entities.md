# core › entities

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist). reference implementations of the contracts exist.

**In one line:** the things in a world: sets of entities from data (and crowds), who each one is (identity), whether it is a place or a thing in a place and what it is attached to (placement), how the whole body moves through the world (locomotion), joints between a shape's parts (kinematics), bodies with skeletons, skin and morphs, motion (states, clips, poses, reaching, gaits, blending, looking at things), and why it moves (drive).

Concepts: [entities](../../concepts/entities.md) · [the fabric](../../concepts/fabric.md) · [shapes](../../concepts/shapes.md) · [live twins](../../concepts/live-twins.md)

<!-- tree:reference/core/entities -->
```tree
entities/
├── sets/
│   ├── sets
│   └── crowds
├── identity/
│   ├── id
│   ├── kind
│   └── data
├── placement/
│   ├── place
│   ├── thing
│   └── attach
├── locomotion/
│   ├── none
│   ├── rail
│   ├── lanes
│   ├── surface
│   ├── air
│   └── water
├── kinematics/
│   ├── hinge
│   ├── slider
│   ├── wheel
│   ├── ball
│   └── custom
├── body/
│   ├── skeleton
│   ├── skin
│   └── morphs
├── motion/
│   ├── states
│   ├── clips
│   ├── poses
│   ├── ik
│   ├── gaits
│   ├── blending
│   └── look
└── drive/
    ├── schedule
    ├── simulation
    ├── data
    ├── player
    └── script
```
<!-- /tree -->

## API

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `sets/sets` | `entities(options)` · `entity(options)` | moved by data (`drive: drive.data(…)`): `shape?: Made` (drawn near the camera; dots farther) · `near?: { pixels = 12, max = 200, levels?: { full: px = 120, simple: px = 25, margin = .2 }, level?: 0 \| 1 \| 2 (one pinned), farMax = 4000, size?: { min, max }, scale, turn: s = 1.2, shadow?: true \| { opacity = .5, spread = 1.3, fade?: m \| false = 6 × its size across, off?: m } }` (the shape's three levels by the pixels each thing covers, kept within the margin; the rest dots) (a soft contact shadow under each shape: one quad each, placed on the chip; in the air on the ground under it, shrunk to half and faded away by `fade` m up, none past `off` m; none by default) · `attitude?: { pitch?: true \| value, bank?: true \| value, damp: s = 2, max: [deg, deg] = [30, 45], pivot?: [x, y, z] = [0, 0, 0] }` (its shapes turned in the air: pitch from its climb, bank into its turns at its speed (atan(v ω / g)), each the mean over `damp` s of its path either side, banked only off the ground when its log has an altitude (a plane taxiing does not; a motorbike without one leans); or the log's own columns, degrees; `set.attitude(id, t?)` → `{ pitch, bank }` as drawn) · `size?: px \| d => px \| { value, range, domain } = 7` · `color?: Color \| d => Color \| { value, ramp, domain }` (a value: its samples' value at the time, on the chip) · `outline?` · `trail?: { seconds = 60, width = 2.5, opacity, color, head, fade: 'linear' \| 'ease' \| k = 'ease' } \| false` · `gauge?: { value, domain, size: [px, px] = [28, 6], colors, outline, lift, within, over: m = 0, label?: true \| { size: px, color, halo } } \| false` (a bar over each thing filled to a value, its per cent across it ('72%', from a glyph atlas), on the chip) · `joints?: { [part \| kind]: { rate, unit } \| { formula } \| { value, per } }` (its shapes' parts: core › entities › kinematics) · `links?: { to: d => [lon, lat], height?, width?, color?, opacity = .15, focus = 1, pieces = 24 }` (an arc from each thing's place now, read on the chip, to a place of its own: faint, the hovered and selected ones full) · `on?: 'stand' \| 'ground' \| 'surface' \| 'sea' \| fn = 'stand'` ('surface': the ground, or the sea's surface where the ground is under it: what a plane flies over) · `lift?: m = .3` · `before?: 'hide' \| 'hold'` · `fold?: Relations` (its things held by others for a while: hidden then, every drawing of them, on the chip: core › data › history › relations) · `dots?: boolean = true` (false: none: an icon placed on the set draws them) · `tooltip?` · `onTap?` · `select?` · `when?` · `set.track()` (what a thing placed on its things reads on the chip: core › entities › placement); else a shape for each feature: `shape: Shape` · `data: Source` · `params?` · `at?` · `heading?` | `EntitySet` (one draw for the dots, one for the trails, one for the shapes) · `Entities` | [built] (moved by data: each thing's samples on the chip once, the clock a uniform; the chip finds its sample (a binary search), its place, its heading, its trail; the shapes near the camera chosen once per view change at their levels (400 cars wobbling at an edge: 219 changes without the margin, 0 with it), their parts moved by their joints, each with its soft contact shadow when asked: nothing per thing per frame on the main thread; a thing held by another folded on the chip: the found pass marks it once a change of the time, its every drawing hides it; in the air (its log's altitude): each sample's height read on the chip between samples as its place is (its dot, trail, shape, gauge, link, and what is placed on it), its shapes' pose found once a change of the time for the things drawn as shapes (a pass of its own: pitch and bank, 16 bits each, the CPU's `set.attitude` the same within 0.1°), their shadows on the ground under them fading as they climb; nothing of it compiled in, no column held, when its log has no altitude: 10,000 drones in the air against the same on the ground (phone view, WebGL2 on the chip, playing at 4×, 1,500 drawn as shapes): the main thread 1.75 → 1.88 ms a frame, the chip 0.12 → 0.11 ms, its columns 1.4 MB more (a byte a sample); 10,000 cars with no altitude as before it (1.44 → 1.50 ms, the chip 0.16 ms both, 30.2 MB both)) | `entities({ id: 'fleet', drive: drive.data(log), shape: cars.make({ paint: '#ffffff' }), color: { value: 'charge', ramp: 'rdylgn' } })` |
| `sets/crowds` | `crowd(options)` | `shapes: Shape[]` · `count \| density: Fn<number>` · `on: Network` (walkways) · `levels?: { near, far: 'counted' }` | element | [planned] | `crowd({ shapes: humans.all, density: 0.05, on: walkways })` |
| `identity` | `entity({ id, kind, data })` | the part every entity has: who it is | `Entity` | [planned] | `entity({ id: 'bus-12', kind: 'bus', data: fleet.row('bus-12') })` |
| `identity/id` | `id: Fn<string>` · `w.entity(id)` | stable across reloads, streams and replays (from the data by default: `d => d.id`) | `string` | [planned] | `entities({ data: fleet, id: d => d.props.vin })` |
| `identity/kind` | `kind({ name, traits, extends? })` · `kinds.house` · `kinds.office` · `kinds.charger` · `kinds.vehicle` · `shape({ kind })` · `shape.check({ kind })` · `kind.check(made)` · `kind.checkData(props)` · `traits(made, kind, data?)` · `asKind(made, kind, { anchors?, params? })` | a trait: `anchors?: kind` (`'entry'`, `'parking'`, `'service'`, `'seat'`, `'light'`…) · `parts?: prefix` (`'wheel'`, `'door'`) · `measure?: 'footprint' \| 'front' \| 'roof'` · `param?: name` (with `guess?: made => value` for a model) · `data?: field` with `def?` · `min?: n = 1` · `max?` · `per?: trait` (one per another's: a light per bay) · `where?: 'ground' \| 'front' \| 'outside' \| 'inside' \| 'wall' \| 'up'` · `optional?` | `EntityKind` · `{ ok, problems[] }` · the traits by name (anchors, parts, a footprint `{ width, depth, min, max, from }` (the box of the shape's group named `'walls'` when it has one, else of all that stands over 0.3 m: `footprintOf(made)`), a roof `{ surface m², tilt °, top, kind }`, params, data) | [built] (what a thing is, as the traits every design of it carries: a house (its footprint, front, levels and floor height, roof, entries at its front, parking, service points, occupants), an office (as a house: two doors or more, a car park's bays, workers), a charger (bays, ports, power, connector, a light per bay), a vehicle (wheels, doors, seats, entries); yours the same way. A shape's kind is checked at every param set, each trait missing or misplaced said once; a model from a file is given its kind and anchors (`shapes.import(url, { kind, anchors })`, `asKind`: the same triangles, its own anchors). What uses a house (cars parking, people going in, the sun on its roof) reads `traits(made, kind)`: any design serves) | `kinds.house.check(made).problems` · `traits(typology.house.make({ garage: 'left' }), 'house').parking` · `kind({ name: 'shed', traits: { door: { anchors: 'entry', where: ['ground', 'front'] } } })` |
| `identity/data` | `data?: Source \| Feature` · `entity.data` | its row: props, live updates, the chronicle | `Feature` | [planned] | `entity.data.props.capacity` |
| `placement` | `placement: 'place' \| 'thing'` | how it relates to other entities: it contains things, or it sits in a place | — | [planned] | `entity({ kind: 'station', placement: 'place' })` |
| `placement/place` | `placement: 'place'` · `place.contents(filter?)` · `place.slots(kind?)` | `footprint?: Area` (from the shape or the data) · `slots?: anchors` (where things go) | a place: contains things (a building, a station, a park) | [partly] (`entity({ placement: 'place', footprint })` · `place.contents({ kind })`: the things whose place it is; `slots` planned) | `park.contents({ kind: 'bench' })` |
| `placement/thing` | `placement: 'thing'` · `thing.in` | `in?: Place \| 'auto' = 'auto'` (the place it sits in, found by position) · `slot?: string` | a thing: sits in a place (a bench, a lamp, a tree) | [built] (`entity({ placement: 'thing', in: 'auto' })`: its place is the one whose footprint is under it, or the one given; `slot` planned) | `bench.in?.data.name` |
| `placement/attach` | `entity.attach(target, anchor, opts)` | `target: Entity` · `anchor: string` · `pose?: string` · `hands?: anchor[]` · `feet?: anchor` | `Attachment` (`detach()`) | [partly] (a shape at an anchor of every clone, by its name or kind: `entities({ attach: [{ shape: smoke, at: 'stack', params }] })`: the clones' own records, the shape moved to the anchor, its copies over time from there (smoke at every stack's top, WebGPU and WebGL2); a thing placed on a set's moving things by reference: `placement(of)` (what an icon or a card stands on: a set's things read on the chip from its own track, in the same frame, nothing written per frame; or features, their places read once); a thing held by another for a while folded into it (`entities({ fold: relations })`: hidden on the chip, counted by its host's card); an entity attached to a moving one (pose, hands, feet) planned) | `op.attach(car, 'driver', { pose: 'sit', hands: ['gripL', 'gripR'] })` |
| `locomotion` | `locomotion: Locomotion` | how the whole body moves through the world (separate from kinematics: how parts move relative to the body) | — | [planned] | `entity({ shape: buses.make(), locomotion: lanes({ on: roads }) })` |
| `locomotion/none` | `locomotion: 'none'` (the default for places) | — | never moves (a building, a pylon); only its parts may | [planned] | `entity({ kind: 'school', locomotion: 'none' })` |
| `locomotion/rail` | `rail({ on, … })` | `on: Network` (a line) · `at?: metres` (distance along) · `speed?: Fn<m/s>` | one degree of freedom along a line | [planned] | `rail({ on: tracks.line('L1'), speed: 22 })` |
| `locomotion/lanes` | `lanes({ on, … })` | `on: Lanes` (bound to a network) · `path?: Route` · `speed?: Fn<m/s>` · `steer?: 'auto' \| Fn<degrees> = 'auto'` | path + speed + steer, no sideways slide | [planned] | `lanes({ on: roads.lanes(), path: route, speed: d => d.props.kmh / 3.6 })` |
| `locomotion/surface` | `locomotion.surface({ on?, … })` | `on?: 'walkable' \| Network \| Area = 'walkable'` (free, snapped to a network's lines, or held inside an area) · `speed?: m/s = 1.4` · `run?: m/s` · `jump?: m/s` · `blocked?: (lon, lat) => height` (what stands in the way: it stops and slides along) · `wheels?: { top, boost }` (km/h: throttle, brake, steering by speed) | free on walkable ground, turns on the spot; on wheels, steers | [built] (on the terrain at every step; walks where the view faces, or drives where its wheels point) | `locomotion.surface({ speed: 1.4, blocked: collision(w) })` |
| `locomotion/air` | `locomotion.air({ … })` · in a set moved by data: `history.log({ altitude })` with `entities({ attitude })` | `ceiling?: metres = 400` · `speed?: km/h = 40` · `fast?: km/h = 120` · `hover?: boolean = true` · `glide?: 0..1 = .4` (with `hover: false`: the least of its speed it keeps) · `over?: 'ground' \| 'sea' = 'ground'` (what its height is over) | free in three dimensions (a drone, a bird, a plane) | [built] (a height over the ground kept between 2 m and the ceiling as the ground under it changes; or over the sea, kept over hills and valleys, never under 2 m over the ground; up and down; a drone stays put, a bird or a plane keeps flying. Many in the air at once: a set moved by its log (sets/sets): each sample's height over the ground or the sea, its pitch from its climb and its bank into its turns, its shadow under it; 10,000 drones (phone view): sets/sets' measures) | `locomotion.air({ ceiling: 120 })` · `locomotion.air({ over: 'sea', hover: false })` |
| `locomotion/water` | `water({ … })` | `on?: 'surface' \| 'under' = 'surface'` · `speed?: Fn<m/s>` | on or under water (a boat, a fish); buoyancy from phenomena | [planned] | `water({ on: 'surface', speed: 4 })` |
| `kinematics/hinge` | in the build: `b.part(name, fn, { pivot, joint: { kind: 'hinge', axis, limits? } })` · its driver on the layer: `joints: { [name \| 'hinge']: driver }` · `layer.joint(name, driver)` · `layer.joint(id, name, driver)` (one clone) | `axis: 'x' \| 'y' \| 'z' \| [x, y, z]` (the shape's frame) · `limits?: [min, max]` (degrees) · a driver: `{ rate, unit?: 'rpm' \| 'deg/s' \| 'rad/s', phase? }` (the layer's clock; each clone its phase by its seed) \| `d => ({ rate })` (each clone its own) \| `{ formula }` (statements in the WGSL subset setting `value`, degrees, of `time` and `seed`) \| `{ value, per? }` (a set's: its log's value, degrees × per) | — | [built] (turned on the chip round the axis through its pivot, its normals with it: a still clone's in its record, a set's in its block; one write changes a rate for every clone or one, the value kept where it is; nothing per frame from the app (1,000 rotors turning: the main thread's ms a frame the same as stopped), WebGPU and WebGL2) | `b.part('rotor', fn, { pivot: hub, joint: { kind: 'hinge', axis: 'z' } })` · `joints: { rotor: (d) => ({ rate: d.props.rpm, unit: 'rpm' }) }` |
| `kinematics/slider` | `b.part(name, fn, { pivot, joint: { kind: 'slider', axis, limits? } })` · `joints: { [name \| 'slider']: driver }` | `axis` · `limits?: [min, max]` (metres) · a driver as a hinge's, in metres (`{ rate }` m/s, a formula's `value` m, a log value's m × per) | — | [built] (moved along its axis on the chip, within its limits; as a hinge otherwise) | `b.part('boom', fn, { pivot: [0, 3, 0], joint: { kind: 'slider', axis: 'z', limits: [0, 6] } })` |
| `kinematics/wheel` | `b.part(name, fn, { pivot, joint: { kind: 'wheel', axis, radius } })` · `joints: { [name \| 'wheel']: driver }` | `radius: m` · a driver as a hinge's, or `{ value: 'travel', per? }` (a set's: it rolls by the metres each thing has gone, kept by its log: `history.log({ travel: true })`) · `steer?` (planned) | — | [partly] (spun round its axle on the chip by a rate, a formula, or its thing's own travel read between its samples (each wheel's angle its metres ÷ its radius: nothing written per frame); steering by the path's turn planned) | `joints: { wheel: { value: 'travel' } }` |
| `kinematics/ball` | `ball(opts)` | `limits?: { yaw, pitch, roll }` | `Joint` | [planned] | `shoulder: ball({ limits: { pitch: [-60, 180] } })` |
| `kinematics/custom` | a joint's value by your formula: `joints: { [name]: { formula } }` · a custom transform: `joint(fn)` (planned) | `formula: string` (statements in the WGSL subset setting `value` (degrees; a slider's metres) of `time` s and `seed` 0..1; the same in both shading languages) · `fn: (value, part) => Transform` (planned) | `Joint` | [partly] (a formula drives a hinge's, wheel's or slider's value on the chip (its program built once per formulas; until then the layer's own draws it); a transform of your own planned) | `joints: { arm: { formula: 'value = 30.0 * sin(time * 0.5 + seed * 6.28);' } }` |
| `body/skeleton` | `skeleton(spec)` · `entity.bones` | `bones: { name, parent, at }[]` · or a module preset | `Skeleton` | [planned] | `humans.skeleton('adult')` |
| `body/skin` | `skin(mesh, skeleton, opts)` | `weights: 'painted' \| 'auto' = 'painted'` · `method?: 'linear' \| 'dqs' = 'dqs'` | a skinned mesh | [planned] | `skin(body, skel, { method: 'dqs' })` |
| `body/morphs` | `entity.morph(name, amount)` | `name: string` · `amount: 0..1` | — | [planned] | `op.morph('smile', .6)` |
| `motion/states` | `states: { name: State }` · `entity.state(name, opts?)` | `when?: (d, s) => boolean` · `clip? \| pose?` · `blend?: seconds = .3` | — | [planned] | `door.state('open')` |
| `motion/clips` | `clip(name \| url)` · `entity.play(clip, opts)` | `loop?: boolean = true` · `speed?: number = 1` | `Playback` | [planned] | `op.play('wave', { loop: false })` |
| `motion/poses` | `pose(name \| bones)` · `entity.pose(p)` | `p: string \| Record<bone, angles>` | — | [planned] | `op.pose('sit')` |
| `motion/ik` | `entity.reach(limb, target, opts?)` | `limb: 'handL' \| 'handR' \| 'footL' \| 'footR' \| chain` · `target: anchor \| [x, y, z]` · `weight?: 0..1 = 1` | — | [planned] | `op.reach('handR', { entity: car, anchor: 'gripR' })` |
| `motion/gaits` | `entity.go(opts)` | `to: Point \| { entity, anchor }` · `gait?: 'walk' \| 'run' \| 'drive' …` · `path?: 'network' \| 'direct' = 'network'` | `Promise<void>` on arrival | [planned] | `op.go({ to: { entity: 't-17', anchor: 'service' } })` |
| `motion/blending` | automatic between states; `entity.layer(name, clip, mask)` | `mask?: bone[]` (e.g. the upper body only) | — | [planned] | `op.layer('wave', 'wave', ['spine', 'armR'])` |
| `motion/look` | `entity.look(target, opts?)` | `target: Point \| Entity \| 'camera'` · `with?: 'eyes' \| 'head' \| 'body' = 'head'` | — | [planned] | `op.look('camera')` |
| `drive` | `drive: (d, s) => values` · or one of the sources below | `d: Feature` · `s: State` | `{ [joint]: number \| object }` each frame (and, with a locomotion, where it goes) | [planned] | `drive: (d, s) => ({ rotor: d.props.rpm * 6 * s.time.t })` |
| `drive/schedule` | `drive.schedule(table)` | `table: Source` (a timetable: stops and times, e.g. GTFS) · `dwell?: Fn<seconds>` | why it moves: the clock and a timetable | [planned] | `drive.schedule(data.gtfs('/feed.zip'))` |
| `drive/simulation` | `drive.simulation(model)` | `model: 'traffic' \| 'crowd' \| Model` (car following, lane change, signals; or your own) | why it moves: a model steps it | [planned] | `drive.simulation('traffic')` |
| `drive/data` | `drive.data(source, opts?)` | `source: Log \| Source` (a recorded log; a live source, each row's change a sample) · `smooth?: ms = 250` (a live source; 0 for a log: how far the drawing runs behind the data) · `time?: d => t` (default `d.props.t`, else when it arrived) · `values?: Record<name, d => number>` (a log with an altitude: a point's third coordinate, unless its props say) · `log?: LogOptions` | `DataDrive` (its `log`) | [built] | `drive.data(data.stream('wss://…/fleet'), { log: { values: { charge: 'u8' } } })` |
| `drive/player` | `drive.player(controller)` · `control(w, layer, entity, controller, opts)` | `controller: Controller` (walk, ride, fly; see interaction) · `opts.offset?` (the camera behind) · `opts.eye?: metres` (first person: the camera at its eyes) · `opts.blocked?` | why it moves: a person controls it (the keys, the touch stick; the view turns by a drag) | [built] | `control(w, people, me, controllers.walk())` |
| `drive/script` | `drive.script(fn)` | `fn: (e, s) => void \| Promise<void>` (go here, wait, open the doors) | why it moves: your code | [planned] | `drive.script(async e => { await e.go({ to: stop }); e.state('open') })` |

## Example

```ts
const turbine = kinematics.define(windTurbine, {
  rotor: hinge({ axis: 'x', pivot: 'hub' }), nacelle: hinge({ axis: 'y' }),
});
w.add(entities({
  shape: turbine, data: data.stream('wss://…/scada'),
  drive: (d, s) => ({ rotor: d.props.rpm * 6 * s.time.t, nacelle: d.props.yaw }),
}));
const op = w.add(entity({ shape: humans.worker }));
await op.go({ to: { entity: 't-17', anchor: 'service' }, gait: 'walk' });
op.state('inspect');
```

## Open questions

- Which skeleton is the standard for humans (VRM humanoid bones, or our own with a VRM mapping)?
- Should `drive` run in a worker for large fleets, with only the joint values sent to the frame?
