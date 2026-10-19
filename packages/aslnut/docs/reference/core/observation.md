# core › observation

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist).

**In one line:** who looks, from where, at what level, and so what is present: the observers (the orbit, the camera a person flies acrobatically: its views, keys, paths, aim, lens, speed, moves and follow; a person's eyes, a sensor, a fixed view); the levels (a ladder, the level now, the binding from the orbit to the level); the gates (a margin past each edge, a dwell before a change, the last levels' data kept); and presence (what is shown, by level, time and state).

The chain is orbit › observation › data › viz: one job per link; a link passes a change on only when its gate says so; only the orbit costs something every frame. The camera never decides the data.

Concepts: [observation](../../concepts/observation.md) · [presence](../../concepts/presence.md) · [encoding and layers](../../concepts/encoding.md) · [boundaries](../../concepts/boundaries.md)

<!-- tree:reference/core/observation -->
```tree
observation/
├── observers/
│   ├── orbit/
│   │   ├── views
│   │   ├── keys
│   │   ├── paths/
│   │   │   ├── line
│   │   │   ├── bezier
│   │   │   ├── spline
│   │   │   ├── along
│   │   │   └── circle
│   │   ├── aim/
│   │   │   ├── look-at
│   │   │   ├── along-path
│   │   │   ├── heading
│   │   │   └── framing
│   │   ├── lens/
│   │   │   ├── fov
│   │   │   ├── focus
│   │   │   └── depth-of-field
│   │   ├── speed/
│   │   │   ├── easing
│   │   │   ├── ease
│   │   │   ├── constant
│   │   │   └── hold
│   │   ├── moves/
│   │   │   ├── pan
│   │   │   ├── tilt
│   │   │   ├── roll
│   │   │   ├── dolly
│   │   │   ├── truck
│   │   │   ├── pedestal
│   │   │   ├── crane
│   │   │   ├── zoom
│   │   │   ├── dolly-zoom
│   │   │   ├── arc
│   │   │   ├── track
│   │   │   ├── chase
│   │   │   ├── flyover
│   │   │   ├── reveal
│   │   │   ├── whip-pan
│   │   │   ├── rack-focus
│   │   │   └── shake
│   │   ├── follow
│   │   └── acrobatic
│   ├── eyes
│   ├── sensor
│   └── fixed
├── levels/
│   ├── ladder
│   ├── level
│   └── binding
├── gates/
│   ├── margin
│   ├── dwell
│   └── keep
└── presence
```
<!-- /tree -->

## API: observers › orbit

The orbit is one observer: the camera a person flies. Always assume they fly acrobatically (zoom, tilt, bearing and roll at any speed, at any time); each frame only the picture moves.

Bearing is the direction the view faces, in degrees clockwise from north: 0 faces north, 90 faces east (east is at the top of the screen), 180 faces south. Views, keys, flights, following, and saved states use the same value. To preserve a view saved with the former reversed convention, negate its bearing (or use `360 - bearing`, modulo 360).

A view's numbers are checked wherever one comes in (`w.go`, `w.fly`, `w.fit`, `w.addView`, camera keys, flights, a follow's offset, a controller's ranges, the camera's moves): a lon, lat, dist, zoom, tilt or bearing that is not a finite number (NaN, Infinity) is refused with `E-VIEW-001`, naming it, and nothing changes. The view now, in the same terms, is `w.camera.view`, and it is written back as it is (`w.fly({ ...w.camera.view, tilt: 40 })`: its dist and zoom agree; to change one, leave the other out). The camera's own `yaw` and `pitch` are radians, and it has no `bearing` or `tilt` of its own; a number that is not finite written straight into them is said once (`E-VIEW-001`), and the world still rests. A flight's or camera keys' time starts at their first drawn frame (the start pose): a 1.2 s flight from a resting world takes 1.2 s.

### A camera move in four parts

```tree
camera move/
├── path    where the camera goes (line, bezier, spline, along a road, a circle)
├── aim     where it looks (at a thing, along the path, a heading, a framing)
├── lens    how it sees (field of view, focus, depth of field)
└── speed   how it moves in time (ease, constant, hold)
```

- **The moves are what a camera operator knows:** pan, tilt, roll, dolly, truck, pedestal, crane, zoom, dolly-zoom, arc, track, chase, flyover, reveal, whip-pan, rack-focus, shake.
- **Each move is a path + aim + damping + speed.** The path is the rig round what it looks at (how far, how tilted, the way it faces) at keys over the move; the aim is `lookAt` a place or a thing by its track; the damping is the follow's springs; the speed is each key's ease. Every move runs on one engine (chase, track, crane, dolly, arc and reveal are presets of it); a lens and moves that combine (crane up while panning right) are planned.
- **Speed is separate:** the same path can ease, run at constant speed (by arc length), or hold.
- **Not in aslnut:** shot lists, composition across shots and continuity. They are built on aslnut, outside it ([boundaries](../../concepts/boundaries.md)). aslnut gives the moves; a story tool decides which shot comes next.

```ts
// chase a car on its log, then crane up from the chase's own eye over 12 s (one engine: a path of rigs round an aim, damped)
const car = track(carLog, 'car', { up: 1 });
void w.play(moves.chase(car, { behind: 42, up: 16 }));
await w.play(moves.crane(car, { to: { dist: 1400, tilt: 52, turn: 30 } }), { seconds: 12 });

// your own move from the same parts: keyed rigs round a plane in the air, each key's ease
await w.play(move({ aim: lookAt(track(planeLog, 'plane', { up: altAt })), keys: [
  { at: 0, rig: { dist: 20000, tilt: 55, turn: 0 } }, { at: .35, rig: { dist: 9.5e6, tilt: 4, bearing: 0 }, ease: 'cinematic' },
] }), { seconds: 8 });

// [planned] moves combined, paths of their own, a lens
w.play(moves.crane(place, { up: 30 }).with(moves.pan({ right: 40 })), { seconds: 4 });
w.play(paths.spline([a, b, c]), { speed: 'constant', aim: alongPath(), then: { hold: 2 } });
```

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `observers/orbit/views` | `w.go(view)` · `w.addView(name, view)` · `w.fly(to, opts)` · `w.fit(target, opts)` · `w.viewToFit(target, opts)` · `w.setProjection(p, seconds?)` · `world(canvas, { frame })` · `w.camera.tiltLimit` · `w.camera.clear` | `view: { lon, lat, dist? \| zoom?, tilt?: degrees = 0, bearing?: degrees = 0 }` (both dist and zoom when they agree: `w.camera.view` written back as it is, camera keys' views too) · `tilt`: up to 88° with the eye at street level or below (30 m over the ground under the centre), 80° from 300 m up, eased between (`tiltLimit: { low: 88, high: 80, street: 30, above: 300 }`; a zoom out from the street takes the tilt back to the map's) · `clear?: metres \| false = 1` (the eye kept over the ground and what is stood on under it, whatever moves it: a hand, a flight, a move; false: a view from under the ground) · `target: [w, s, e, n] \| Feature \| Feature[]` · `padding?: number = .08` · `maxZoom?` · `p: 'auto' \| 'globe' \| 'flat'` (eased over `seconds = 1.2`: the globe opens into the map) · `frame?: 'auto' \| 'height' = 'auto'` ('auto': a portrait screen sees as much across as a landscape one, so a zoom shows the same place whole on a phone) | `Promise<void>` (fly, fit) · a view (viewToFit: the box whole on this canvas, any shape) | [built] (the first view as asked: nearer than the default nearest distance (40 m), that is the nearest; a flat body's nearest is 1 m) | `await w.fit(suburb, { padding: .1, tilt: 30 }); w.setProjection('flat')` |
| `observers/orbit/keys` | `camera.keys(list)` | `list: { at: seconds, view: View, ease?: Ease, path?: Path }[]` | `Playback` | [built] | `camera.keys([{ at: 0, view: a }, { at: 6, view: b, ease: 'cinematic' }])` |
| `observers/orbit/paths` | `path` | `'direct' \| 'arc' \| 'around' = 'direct'` · `around?: { centre, turns }` (between two views; built) · or a `Path` from the kinds below | — | [built] (between views) · the kinds below [planned] | `path: 'arc'` |
| `observers/orbit/paths/line` | `paths.line(from, to)` | `from, to: View \| Point` | `Path` (straight) | [partly]: today as a key's `path: 'direct'`; `paths.line` planned | `paths.line(here, there)` |
| `observers/orbit/paths/bezier` | `paths.bezier(from, to, controls)` | `controls: [Point, Point?]` | `Path` (one smooth curve you shape) | [planned] | `paths.bezier(a, b, [c1, c2])` |
| `observers/orbit/paths/spline` | `paths.spline(points, opts?)` | `points: Point[]` (through every waypoint) · `tension?: 0..1 = .5` · `closed?: boolean = false` | `Path` (by arc length, so constant speed is available) | [planned] | `paths.spline([a, b, c, d])` |
| `observers/orbit/paths/along` | `paths.along(line, opts?)` | `line: Feature \| Route \| Network edge ids` (a road, a route) · `up?: metres = 30` · `side?: metres = 0` · `smooth?: metres = 20` | `Path` | [planned] | `paths.along(route, { up: 40 })` |
| `observers/orbit/paths/circle` | `paths.circle(centre, opts)` | `centre: Point \| Entity` · `radius: metres` · `turns?: number = 1` · `up?: metres` · `tilt?: degrees` | `Path` (a circle or part of one) | [partly]: today as a key's `path: 'around'` with `turns`; `paths.circle` planned | `paths.circle(tower, { radius: 300, turns: .25 })` |
| `observers/orbit/aim` | `aim: Aim` (a move's first argument, or `move({ aim })`) | one of the kinds below | — | [partly] (look-at; along-path, heading, framing planned) | `moves.chase(lookAt(plane, { raise: .2 }))` |
| `observers/orbit/aim/look-at` | `lookAt(target, opts?)` · `track(log, id, opts?)` | `target: [lon, lat, h?]` (h: metres over the sea) `\| { lon, lat, up?, heading? }` (up: metres over the ground) `\| point name \| track(log, id, { up })` (a thing on a log, wherever the world's time puts it; `up`: metres or your function of where it is) `\| (timeMs) => …` · `lead?: seconds` (look ahead of where it goes) · `raise?: share of half the screen = 0` (where it sits: up from the middle) | `Aim` | [built] (a thing in the air sits where asked on the screen: the camera still orbits the ground beyond it, its levels and tiles the ground's) | `lookAt(track(planeLog, 'plane', { up: altAt }))` |
| `observers/orbit/aim/along-path` | `alongPath(opts?)` | `ahead?: metres = 20` · `down?: degrees = 10` | `Aim` (looks where it is going) | [planned] | `alongPath({ ahead: 50 })` |
| `observers/orbit/aim/heading` | `heading(bearing, tilt?)` | `bearing: Fn<degrees>` · `tilt?: Fn<degrees>` | `Aim` (a fixed or changing compass direction) | [planned] | `heading(90, 30)` |
| `observers/orbit/aim/framing` | `framing(subject, opts?)` | `subject: Entity \| Point` · `slot?: 'centre' \| 'left-third' \| 'right-third' \| 'top-third' \| 'bottom-third' \| [x, y] = 'centre'` (rule of thirds) · `keep?: boolean = true` (keep the subject in frame) | `Aim` | [planned] | `framing(minibus, { slot: 'left-third' })` |
| `observers/orbit/lens` | `lens: Lens` (in `play`) · `w.camera.lens(l)` | the parts below; each can be a value or `[from, to]` over the move | — | [planned] | `lens: { fov: [60, 35] }` |
| `observers/orbit/lens/fov` | `fov` | `fov: degrees = 45` (vertical field of view) · or `focal: mm` | — | [planned] | `w.camera.lens({ fov: 30 })` |
| `observers/orbit/lens/focus` | `focus` | `focus: metres \| Point \| Entity \| 'auto' = 'auto'` | — | [planned] | `lens: { focus: minibus }` |
| `observers/orbit/lens/depth-of-field` | `depthOfField` | `aperture?: f-number = 8` · `on?: boolean = false` (off on phones unless asked; quality decides) | — | [planned] | `lens: { depthOfField: { aperture: 2.8 } }` |
| `observers/orbit/speed` | `speed` (in `play`) | how the move spends its time | — | [planned] | `speed: 'constant'` |
| `observers/orbit/speed/easing` | `ease` | `'smooth' \| 'cinematic' \| 'glide' \| 'snap' \| 'anticipate' \| 'overshoot' \| 'cubic-bezier(a,b,c,d)' = 'smooth'` | — | [built] | `ease: 'glide'` |
| `observers/orbit/speed/ease` | `ease` | any `easing` value · `'inOut'` | — | [planned] | `{ seconds: 4, ease: 'inOut' }` |
| `observers/orbit/speed/constant` | `speed: 'constant'` · `speed: m/s` | even speed by arc length along the path | — | [planned] | `{ speed: 'constant' }` |
| `observers/orbit/speed/hold` | `hold(seconds)` · `then: { hold }` | `seconds: number` (stay still, keep aiming) | — | [planned] | `then: { hold: 2 }` |
| `observers/orbit/moves` | `w.play(move, opts)` · `w.playing` · `move({ aim, keys, damping, over, seconds })` (your own, from the same parts) | `opts: { seconds?, ease? }` (no seconds: it holds its first key until stopped) · a move is four parts: the path (`keys: { at: 0..1, rig: { dist, tilt, bearing \| turn, raise } \| 'now', ease? }[]`: the rig round what it looks at, `turn` from the thing's heading, 'now' where the camera is when it starts), the aim (`lookAt`), the damping (follow's springs), the speed (each key's ease) · `over?: metres \| false` (the eye kept over what stands near it, eased: up quickly, down slowly) | `Promise<void>` (it ends at its seconds, on a new move, a flight, a jump, or a person's hands moving the camera) | [partly] (one engine for every preset; a move after another on the same thing carries its springs on; what a move of a second or more will see loads ahead; `.with`, `.then`, `seek` planned) | `await w.play(moves.crane(car, { up: 400, swing: 30 }), { seconds: 6 })` |
| `observers/orbit/moves/pan` | `moves.pan(opts)` | `left? \| right?: degrees` (turn sideways, the camera stays put) | `Move` | [planned] | `moves.pan({ right: 40 })` |
| `observers/orbit/moves/tilt` | `moves.tilt(opts)` | `up? \| down?: degrees` (turn up or down, the camera stays put) | `Move` | [planned] | `moves.tilt({ up: 20 })` |
| `observers/orbit/moves/roll` | `moves.roll(opts)` | `degrees: number` (turn round the view direction) | `Move` | [planned] | `moves.roll({ degrees: 10 })` |
| `observers/orbit/moves/dolly` | `moves.dolly(target, opts)` | `in? \| out?: metres` (along the line of sight, from where the camera is) or `to?: metres` · `ease?` · `damping?` | `Move` | [built] | `moves.dolly(fountain, { in: 50 })` |
| `observers/orbit/moves/truck` | `moves.truck(opts)` | `left? \| right?: metres` (move sideways) | `Move` | [planned] | `moves.truck({ left: 20 })` |
| `observers/orbit/moves/pedestal` | `moves.pedestal(opts)` | `up? \| down?: metres` (move straight up or down, the view stays level) | `Move` | [planned] | `moves.pedestal({ up: 5 })` |
| `observers/orbit/moves/crane` | `moves.crane(target, opts)` | `up?: metres = 30` · `back?: metres = 0` (farther along the ground) · `swing?: degrees = 0` (round it) · or `to?: rig` · from where the camera is (a crane up from a chase's own eye) | `Move` | [built] | `moves.crane(car, { to: { dist: 1400, tilt: 52, turn: 30 } })` |
| `observers/orbit/moves/zoom` | `moves.zoom(opts)` | `to: degrees` (fov) or `by: number` (×) (the lens changes, the camera stays put) | `Move` | [planned] | `moves.zoom({ by: 2 })` |
| `observers/orbit/moves/dolly-zoom` | `moves.dollyZoom(subject, opts)` | `subject: Point \| Entity` · `by: metres` (dolly while zooming so the subject keeps its size) | `Move` | [planned] | `moves.dollyZoom(tower, { by: -80 })` |
| `observers/orbit/moves/arc` | `moves.arc(target, opts)` | `degrees?: number = 90` (clockwise seen from above; negative the other way) · `dist?`, `tilt?` (kept unless given) · `from?: rig` (default where the camera is) | `Move` (part of an orbit round it) | [built] | `moves.arc(place, { degrees: 110 })` |
| `observers/orbit/moves/track` | `moves.track(target, opts?)` | `side?: metres = 8` (to its left; negative its right) · `up?: metres = 2` · `to?: rig` (a track that falls back behind it) · `raise?` | `Move` (alongside a moving thing, looking across at it) | [built] | `moves.track(plane, { side: 77, up: 14, raise: .15 })` |
| `observers/orbit/moves/chase` | `moves.chase(target, opts?)` | `behind?: metres = 12` · `up?: metres = 4` · `turn?: degrees = 0` (round it from straight behind) · `to?: rig` (a chase that drifts round) · `over?: metres = 4` (over what stands near the eye) · `damping?` (default: the follow's) | `Move` | [built] (its heading the way the thing goes, damped: a log's heading steps at each sample, its motion does not) | `moves.chase(track(log, 'car'), { behind: 42, up: 16 })` |
| `observers/orbit/moves/flyover` | `moves.flyover(area \| line, opts?)` | `up?: metres` · `look?: 'down' \| 'ahead' = 'ahead'` | `Move` (a high pass over a place or along a line) | [planned] | `moves.flyover(river, { up: 300 })` |
| `observers/orbit/moves/reveal` | `moves.reveal(target, opts?)` | `from?: 'below' \| 'behind' \| 'side' = 'behind'` (from close in: low and near, rising; near from behind, pulling back and up; near from its side, coming round) · `dist?: metres = 40` · `to?: rig` (default 55° from straight down) · `ease?: 'cinematic'` | `Move` | [built] | `moves.reveal(fountain, { from: 'below', dist: 30 })` |
| `observers/orbit/moves/whip-pan` | `moves.whipPan(opts)` | `right? \| left?: degrees` · `blur?: boolean = true` (a very fast pan, blurred) | `Move` | [planned] | `moves.whipPan({ right: 90 })` |
| `observers/orbit/moves/rack-focus` | `moves.rackFocus(from, to)` | `from, to: Point \| Entity \| metres` (focus moves, the camera stays put) | `Move` | [planned] | `moves.rackFocus(bench, tower)` |
| `observers/orbit/moves/shake` | `moves.shake(opts)` | `amount?: 0..1 = .3` · `rate?: Hz = 8` · `seed?` (handheld or impact, deterministic) | `Move` (adds to any move) | [planned] | `moves.chase(bus).with(moves.shake({ amount: .1 }))` |
| `observers/orbit/follow` | `w.follow(target, opts?)` · `w.follow(null)` · `w.isFollowing` · `followEntity(w, entity, opts)` | `target: point name \| [lon, lat, h?] \| { lon, lat, up?, heading? } \| track(log, id) \| (timeMs) => …` (a vehicle, a player, a storm; a thing in the air stays at the middle of the screen) · `heading?: true \| degrees` (the view turns with it) · `dist?: metres` (the eye kept that far) · `damping?: { place, aim, dist, heading: { halfLife?: s \| stiffness?: 1/s², deadZone?, maxSpeed?, lead?, from?: 'motion' \| 'thing' }, snap?: metres \| false }` (a critically damped spring per channel, exact on the world's clock: the same camera at any frame rate; a dead zone, a look ahead (default: the spring's own lag, so a thing going steadily is followed with none), a top speed; the heading the short way round, from the way it goes; a jump farther than `snap` (default twice the distance) cuts) · `smooth?: ms` (the old knob: the place's half-life that lags as much) · for entities: `offset?: [right, up, behind] = [0, 3, -8]` · `lag?` · `look?` · `yaw?`, `pitch?` · `blocked?` | `this` · a stop function | [built] (defaults half-lives place .35 s (the aim on the same spring: the rig held round the thing, only its heading turns the view), distance .4 s, heading .7 s (dead zone .5°): a chased car's view on a bumpy log 23 → 3.3 °/s² RMS, 280 → 10 at most, a plane's 720 → 1.8, the journey's car on its route 100 → 18 (tools/camera-jitter.mjs); a person's hands end it only when they move what it keeps (a pan; a turn when it keeps the heading; a zoom when it keeps the distance): a zoom goes round it; asked again each frame it keeps its springs) | `w.follow(track(log, 'bus-12'), { heading: true, damping: { heading: { halfLife: 1 } } })` |
| `observers/orbit/acrobatic` | automatic: every gesture, flight, key and follow | — | each frame only the picture's uniforms change (the view's matrices): nothing is loaded, rebuilt, recoloured or faded because the eye moved; a level changes only through the binding and its gates | [built] | (a pinch from street to region and back in 2 s: 0 loads, 0 restyles, 0 fades) |
## API: other observers

The orbit is one observer. Others look at the same world and may drive its level through a binding (`bind: s => …`).

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `observers/eyes` | `observer.eyes(entity, opts?)` | `entity: Entity` (a person in the world) · `fov?: degrees = 120` · `reach?: metres = 200` | an observer: what a person in the world sees, its own level (a room, a street) | [planned] | `w.observe({ levels: 'default', bind: observer.eyes(walker) })` |
| `observers/sensor` | `observer.sensor(opts)` | `at: [lon, lat, h]` · `look: { bearing, tilt }` · `fov?: degrees` · `range?: metres` | an observer: a camera or lidar in the world (what it covers, for presence and simulation) | [planned] | `observer.sensor({ at: gate, look: { bearing: 90, tilt: 20 }, fov: 70 })` |
| `observers/fixed` | `observer.fixed(view)` | `view: View` (a fixed view: a screen in a control room, a kiosk) | an observer that never moves: its level set once | [planned] | `observer.fixed({ lon, lat, zoom: 15 })` |


## API: levels

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `levels/ladder` | `world(canvas, { observation: { levels } })` · `w.observe(options \| null)` · `w.levels` | `levels?: 'default' \| (string \| { name, from })[]` · `'default'`: world (from zoom −∞) › country (3.5) › region (6.5) › city (9.5) › district (12.5) › street (14.5) › building (17) › room (19); a list of names cuts the default (each keeps its default edge); `{ name, from }`: your own rungs, coarse to fine (`from`: the zoom it starts at) · unset: no levels (a GIS map), nothing gated, nothing measured | the ladder: `{ name, from }[]`, coarse first | [built] | `observation: { levels: ['city', 'district', 'street', 'building'] }` |
| `levels/level` | `w.level` · `w.setLevel(name)` · `w.on('level', f)` · `s.observation` · `w.observation` (the ladder, the gates and what they did: `{ level, by, waiting, swapping, counts: { changes, swaps, released, waitedMs } }`, for an observation panel) | `name: string` (a rung of the ladder; an unknown one is an error that lists them) | `w.level`: the name now (null: no levels) · the event `{ from, to, by: 'orbit' \| 'app' }` · `s.observation: { level, index, levels, by }` | [built] | `w.setLevel('street')` · `when: s => s.observation.level === 'room'` |
| `levels/binding` | `observation: { bind }` | `bind?: 'orbit' \| false \| (s) => string = 'orbit'` ('orbit': the orbit's zoom drives the level through the gates; false: the app alone sets it; your function: another observer's rule, asked as the state changes) | — (the app's `setLevel` holds until the orbit crosses the next edge past the margin) | [built] | `observation: { levels: 'default', bind: false }` |

## API: gates

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `gates/margin` | `observation: { margin }` | `margin?: number = 0.3` (zoom levels past an edge before the level changes: hysteresis; back across needs the same margin the other way) | — | [built] | `observation: { margin: 0.5 }` |
| `gates/dwell` | `observation: { dwell }` | `dwell?: seconds = 0.5` (how long the orbit stays past the margin before the level changes: a debounce; a burst over an edge and back changes nothing) · `ahead?: number = 1` (zoom levels before an edge where the next level's data loads quietly) | — | [built] | `observation: { dwell: 1 }` |
| `gates/keep` | `observation: { keep }` | `keep?: { levels?: int = 2, seconds?: number = 60 }` (the last levels' data and built shapes kept: going back is instant; past it, freed) | — (a level change swaps once: the new level's things shown together when ready, the old ones until then) | [built] | `observation: { keep: { levels: 3, seconds: 120 } }` |

## API: presence

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `presence` | `when: (s) => boolean \| number` or a shorthand, on every element and every feature (`feature: { when }`) | `s: State` · shorthand `{ level?: name \| name[] \| { from?, to? }, hour?: [a, b], month?: [a, b], year?: [a, b], api?, quality?, role?, toggle? }` (`level`: one rung, a set of rungs, or a range on the ladder; with no ladder set, `level` turns the default one on) · or `boolean = true` · no `when`: always shown (a GIS layer: no gate) | `boolean \| 0..1` (fraction = partly shown); a change by level plays once, at the level change (the gates); `when: { zoom }` is an error with its fix (the camera never decides presence: use `level`; a function of `s.view` still works if you insist) | [built] | `when: { level: { from: 'district' }, hour: [18, 6] }` · `when: s => s.user.toggles.crime` |

## Example

```ts
// a twin with the default ladder, bound to the orbit: margin 0.3, dwell 0.5 s, keep 2 levels for 60 s
const w = await world(canvas, { body: earth(), observation: { levels: 'default' } });
w.add(extrusion({ id: 'rooms', data: rooms, when: { level: 'room' } }));
w.add(points({ id: 'totals', data: totals, when: { level: ['region', 'city'] } }));
w.on('level', (e) => console.log(e.from, '→', e.to, e.by));   // 'city' → 'district' 'orbit'
w.setLevel('street');                                         // the app sets it

// the orbit: views, flights, follow
w.addView('city', { lon: 107.61, lat: -6.91, dist: 6000, tilt: 50 });
await w.fly('city', { ease: 'cinematic', path: 'arc' });
w.follow(() => carPosition(), { smooth: 300 });
```

## Open questions

- Decided: other observers are leaves of `observers` beside `orbit` (eyes, sensor, fixed), planned.
- One vocabulary for `w.go` and `w.fly` (tilt and bearing in degrees everywhere): planned.
- Decided: the circle path is `paths/circle` (the orbit is the observer).
