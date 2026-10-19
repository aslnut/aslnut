# modules › presets

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist). reference implementations of the presets exist.

**In one line:** ready-made things for any world, built on core › entities: shared locomotion (lane follower, rail follower, walker), humans (their own page), animals, vehicles (cars, motorbikes, buses, minibuses, trains), drones and robots (robots and androids), each a shape package with its kinematics, states and a default locomotion.

Humanoids: the machinery (skeleton, skin, morphs, motion, attach, look, crowds) is in [core › entities](../core/entities.md); the presets are `humans` and `robots/android` here. A humanoid = an entity (its body) + optionally an agent (its mind, [core › simulation › agents](../core/simulation.md)).

`presets` is always the last child of its node. It holds only ready-made things built with the public API, to use as they are or to copy and change. It lives at the most general level where it still makes sense: a human goes anywhere (`modules.presets`), Victorian houses only on Earth (`modules.world.earth.presets`). Small value presets (weather presets, easing, ramps) stay inside their part. Each preset has its own import, and heavy assets (models, textures) come from the catalog, never bundled.

Concepts: [entities](../../concepts/entities.md) · [the fabric](../../concepts/fabric.md) · [shapes](../../concepts/shapes.md)

<!-- tree:reference/modules/presets -->
```tree
presets/
├── shared/
│   └── locomotion/
│       ├── lane-follower
│       ├── rail-follower
│       └── walker
├── humans/
│   ├── body
│   ├── face
│   ├── expressions/
│   │   ├── emotions
│   │   ├── visemes
│   │   ├── gestures
│   │   └── blink
│   ├── hair
│   ├── clothing
│   ├── poses
│   ├── gaits
│   ├── people
│   ├── speech
│   └── vrm
├── animals/
│   ├── quadruped
│   ├── bird
│   ├── fish
│   └── reptile
├── vehicles/
│   ├── car
│   ├── motorbike
│   ├── bus
│   ├── minibus
│   └── train
├── drones
└── robots/
    ├── robot
    └── android
```
<!-- /tree -->

## API

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `shared` | `presets/shared`: common skeletons, gaits and states the presets share | — | — | [planned] | `import { gaits } from 'aslnut/modules/presets/shared'` |
| `shared/locomotion` | `followers.*` | ready-made locomotion for the presets, on core › entities › locomotion | `Locomotion` | [planned] | `entity({ shape: buses.make(), locomotion: followers.lane({ on: lanes }) })` |
| `shared/locomotion/lane-follower` | `followers.lane(opts)` | `on: Lanes` · `route?: Route` · `model?: 'idm' \| Model = 'idm'` (keeps a gap to the one ahead) · `change?: boolean = true` (lane changes) | `Locomotion` (`lanes`) | [planned] | `followers.lane({ on: roads.lanes(), route })` |
| `shared/locomotion/rail-follower` | `followers.rail(opts)` | `on: Network` (a track) · `stops?: Source` · `accel?: m/s² = .8` · `brake?: m/s² = 1` | `Locomotion` (`rail`) | [planned] | `followers.rail({ on: tracks, stops: stations })` |
| `shared/locomotion/walker` | `followers.walk(opts)` | `on?: 'walkable' \| Network = 'walkable'` · `speed?: Fn<m/s> = 1.3` · `avoid?: boolean = true` (keeps out of others' way) | `Locomotion` (`surface`), its gait picked from the speed | [planned] | `followers.walk({ on: walkways })` |
| `animals/quadruped` | `animals.quadruped(params)` | `species: choice(['cow', 'goat', 'dog', 'cat', 'horse'])` · `size: num` | `Shape` with gaits walk, trot, gallop | [planned] | `crowd({ shapes: [animals.quadruped({ species: 'goat' })], density: .01 })` |
| `animals/bird` | `animals.bird(params)` | `species: choice([...])` · `flock?: boolean = false` | `Shape` with gaits fly, glide, perch | [planned] | `crowd({ shapes: [animals.bird({ species: 'sparrow' })], flock: true })` |
| `animals/fish` | `animals.fish(params)` | `species` · `school?: boolean = true` | `Shape` with swim | [planned] | `crowd({ shapes: [animals.fish({ species: 'tilapia' })], in: pond })` |
| `animals/reptile` | `animals.reptile(params)` | `species: choice(['gecko', 'monitor', 'turtle'])` | `Shape` with crawl | [planned] | `entity({ shape: animals.reptile({ species: 'gecko' }) })` |
| `vehicles/car` | `cars.make(params)` (a `type` given brings its row) · presets `cars.hatch`, `cars.sedan`, `cars.wagon`, `cars.pickup`, `cars.van`, `cars.bus`, `cars.truck`, `cars.suv`, `cars.crossover`, `cars.tractor`, `cars.citybus` · `cars.package` · `cars.hitch(rows, tractor, o)` · `cars.locomotion(o)` (`aslnut/modules/presets/vehicles`) | `type: choice` (a row of `presets.json`) · `length, width, height, wheel: num` · the silhouette: `wheelbase, front, rear: num` (m, scaled to the length) · `bonnet: num` (m; 0 a flat front) · `rake: num` (the windscreen, degrees from upright) · `roofline: 'flat' \| 'falling' \| 'fastback'` · `tail: 'fastback' \| 'hatch' \| 'notch' \| 'box'` · `tailRake: num` (the rear glass, degrees from upright) · `clearance, arch, belt, glass, windows: num` · `cladding: flag` · `lights: 'strip' \| 'round' \| 'block'` · its load: `load: 'none' \| 'tray' \| 'box' \| 'trailer'` · `cab, loadLength, loadHeight: num` · `loadAxles, axles, doors: int` (a bus's door openings) · `pods: flag` (a bus's roof pods) · `paint: color = light grey` (tinted) · `livery: text` · `traffic: 'right' \| 'left' = 'right'` (the driver away from the kerb, a bus's doors to it) · hitch: `kingpin?, axle?` (m; default its anchors) · `radius?: m = 9` · `value?: 'hitch'` · `step?: degrees = 1` · `axles?: (id, track) => void` | `Shape` of kind vehicle with wheels, doors, a trailer, seat and grip anchors; `cars.hitch`: the rows with `values.hitch` (degrees) | [built] (a shape package, neutral by default (its paint and its rows white to grey: a fleet's colours are its instances'); each type one row of its silhouette's numbers (a new body is a row, not code): its side profile (bumper, bonnet, windscreen at its rake, roof by its line, tail by its kind) swept across its width with its plan's ends rounded, a section station by station (the floor, a well over each tyre, the sill tucked in, the side bulging to its widest, a shoulder line, the shoulder rounded, the glass leaning in and bowed, the rail rounded into the roof, its crown) as smooth panels, the front doors cut from it; its glass a group wrapping round (windscreen, side and rear glass between the pillars), its cladding a group (arches, sills, bumpers' feet), a load's box a group; head and tail lamps (strips, round or blocks) lit from dusk; bumpers, mirrors, plates; a bed, a box on a chassis, or a trailer on its axles hitched at the fifth wheel by a hinge (a part) that its log's `hitch` turns (`cars.hitch`: the trailer's axles pulled along the track by the fifth wheel, a tractrix: off-tracking inside a turn, straight after; the track's corners rounded to its turning radius, sampled where it turns); a bus's door openings, pillars, sign and roof pods; wheels (dual behind a heavy one), front doors and a trailer as parts with their joints and states (kinematics.ts, states.ts); driver and passenger seats, grips, entries; whole (~2.8–3k triangles a car, ~3.3k a tractor and trailer), simple (fewer sides, ~1.1k) and a far symbol (its outline across its width, ~50); its default locomotion on wheels; its parts are turned by core › entities › kinematics, and lanes kept by a lane follower: theirs) | `entities({ shape: cars.pickup, data: fleet })` · `entities({ shape: cars.shape, data, params: (d) => ({ type: d.props.kind }), tint: (d) => d.props.colour })` · `entities({ drive: drive.data(log), shape: cars.tractor.make(), joints: { trailer: { value: 'hitch' } } })` |
| `vehicles/motorbike` | `motorbikes.make(params)` | `type: choice(['scooter', 'sport', 'ojek'])` · `paint: color` · `box: flag(false)` | `Shape` with lean, wheels, rider anchors | [planned] | `entities({ shape: motorbikes.make({ type: 'ojek' }), data: riders })` |
| `vehicles/bus` | `buses.make(params)` | `length: num(8, 18, 12)` · `doors: int(1, 4, 2)` · `paint: color` · `livery: text` | `Shape` with wheels, door joints, seat anchors; lane follower by default | [planned] | `entities({ shape: buses.make({ doors: 3 }), data: fleet })` |
| `vehicles/minibus` | `minibuses.make(params)` | `length: num(4, 7, 5)` · `doors: choice(['side', 'rear', 'both'])` · `paint: color` · `livery: text` · `route?: text` | `Shape` with wheels, a sliding door, bench anchors | [planned] | `entities({ shape: minibuses.make({ paint: '#2a7' }), data: routeFleet })` |
| `vehicles/train` | `trains.make(params)` | `cars: int(1, 12, 4)` · `kind: choice(['commuter', 'metro', 'tram', 'freight'])` · `paint: color` | `Shape` per car with bogies and door joints; rail follower by default | [planned] | `entity({ shape: trains.make({ cars: 6 }), locomotion: followers.rail({ on: tracks }) })` |
| `drones` | `drones.make(params)` · presets `drones.quad`, `drones.survey`, `drones.hexa`, `drones.cargo` · `drones.package` · `drones.kinematicsFor(n)` · `drones.locomotion(o)` (`aslnut/modules/presets/drones`) | `rotors: int(4, 8, 4)` (even) · `span: num(.3, 2, .6)` · `payload: flag(false)` · `body, arms: color` | `Shape` with spinning rotors, a camera anchor | [built] (a shape package: rotors on arms round the body, each a part on its motor (blades and a blurred disc) with its joint; landing legs with feet, lamps at the arms' ends lit from dusk, a camera on a gimbal (an anchor), a payload box and its grip; whole, simple and a box far away; its default locomotion in the air, hovering; the blades turned by core › entities › kinematics: theirs) | `entity({ shape: drones.make({ rotors: 6 }) })` |
| `robots/robot` | `robots.arm` · `robots.amr` · `robots.make(params)` | `kind: choice(['arm', 'amr', 'quadruped'])` · `reach: num(.5, 3, 1.2)` · `axes: int(4, 7, 6)` | `Shape` with joints | [planned] | `entity({ shape: robots.arm, drive: (d) => d.props.joints })` |
| `robots/android` | `androids.default` · `androids.make(params)` | `height: num(1.4, 2.0, 1.7)` · `finish: choice(['white', 'metal', 'skin'])` · `face: flag(true)` | `Shape` (human skeleton, rigid parts) | [planned] | `entity({ shape: androids.make({ finish: 'metal' }) })` |

## Example

```ts
w.add(entities({
  shape: cars.pickup, data: data.stream('wss://…/fleet', { id: d => d.vin }),
  params: d => ({ paint: d.props.color, livery: 'PLN' }),
  drive: (d, s) => ({ wheels: { spin: d.props.speed, steer: d.props.steer } }),
}));
```

## Open questions

- Which presets ship in the base package, and which as separate shape packages?
