# Entities

> Draft under discussion. Planned in aslnut; a reference implementation exists (people, vehicles, drones).

**In one line:** an entity = **identity + shape + placement + locomotion + kinematics + drive**. Each part is optional, and observation decides how much of it is shown.

## Why

- **A world is full of things:** buildings stand, turbines turn, doors open, cars drive, people walk and sit.
- **Motion from data:** a turbine's rotor speed is a sensor value; a car's position is a GPS stream.
- **One model for buildings, machines and bodies:** a station, a minibus and a person are the same six parts, with different ones filled in.

## What an entity is

| part | answers | kinds |
|---|---|---|
| identity | who is it? | `id`, `kind`, `data` (its row) |
| shape | what does it look like? | a [shape](shapes.md): parts, anchors, levels |
| placement | how does it sit among others? | `place` (contains things: a building, a station, a park) · `thing` (sits in a place: a bench, a lamp, a tree) |
| locomotion | how does the whole body move through the world? | `none` · `rail` (one degree of freedom along a line) · `lanes` (bound to a network: path + speed + steer, no sideways slide) · `surface` (free on walkable ground, turns on the spot) · `air` · `water` |
| kinematics | how do its parts move relative to the body? | joints (`hinge`, `slider`, `wheel`, `ball`, `custom`), or a skeleton |
| drive | why does it move? | `schedule`, `simulation`, `data`, `player`, `script`, or your own `drive` function |

| entity | identity | placement | locomotion | kinematics |
|---|---|---|---|---|
| a building | `kind: 'school'` | place | none | (doors, if near) |
| a car | `kind: 'car'` | thing | lanes | wheel joints |
| a human | `kind: 'person'` | thing | surface | a skeleton |
| a train | `kind: 'train'` | thing | rail | door joints |

- **Locomotion is not kinematics.** Locomotion moves the whole body through the world (a train along its rail); kinematics moves parts relative to the body (the train's doors sliding open).
- **The fabric gives locomotion its constraints:** lanes for `lanes`, rails for `rail`, ways and walkable ground for `surface`. Roads and rivers are fabric, not entities ([the fabric](fabric.md)).
- **Observation decides the detail:** near, the train's doors open and people step out; far, it is a moving box; unseen, it is a position on its line.
- **Humanoids:** the machinery is `core/entities` (skeleton, skin, morphs, motion, attach, look, crowds); the presets are `modules/presets/humans` and `modules/presets/robots/android`. A humanoid = an entity (its body) + optionally an agent (its mind, [core › simulation › agents](../reference/core/simulation.md)).

## The rules

1. **Identity** is stable: the same `id` across reloads, streams and replays; `kind` is data that queries, styles and rules read. A kind names its traits (`kind({ name, traits })`: anchors, parts, measures, params, data): every design of it carries them, `shape.check({ kind })` says which are missing or misplaced, and what uses the thing reads `traits(made, kind)`, never one design's own geometry.
2. **Placement:** a place contains things; a thing finds the place it sits in from its position, or is given one.
3. **Locomotion** is chosen once per entity (`none` for places by default) and bound to the fabric it moves on.
4. **Kinematics** name joints between parts: `hinge`, `slider`, `wheel`, `ball`, or `custom`.
5. **Drive** says why it moves: a timetable, a simulation, a data stream, a player, a script, or `drive: (d, s) => values`, which sets the joints every frame from the feature `d` and the state `s`.
6. **States** are named poses or motions (`open`, `closed`, `working`) with blends between them.
7. **Anchors** (from the shape) let entities attach: a person sits on a `seat`, holds a `grip`, enters at an `entry`.
8. **Bodies** (human, animal, android) add a skeleton, skin, expressions, and gaits.
9. **Agents** give entities a rhythm and a behaviour (see [agents](../reference/core/simulation.md)); far away they become counts.
10. Everything is per feature, from data, like every other element.

```tree
entity/
├── identity/
│   ├── id
│   ├── kind
│   └── data
├── shape
├── placement/
│   ├── place
│   └── thing
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
├── drive/
│   ├── schedule
│   ├── simulation
│   ├── data
│   ├── player
│   └── script
├── states/
├── anchors/
├── attach
├── body/
│   ├── skeleton
│   ├── skin
│   ├── morphs
│   └── expressions
├── motion/
│   ├── clips
│   ├── poses
│   ├── ik
│   ├── gaits
│   └── blending
└── agent/
    ├── behaviour
    └── rhythm
```

| joint | moves like | values |
|---|---|---|
| `hinge` | a door, a rotor | angle (degrees) |
| `slider` | a drawer, a piston | distance (metres) |
| `wheel` | a wheel: spins and can steer | spin, steer |
| `ball` | a shoulder | three angles |
| `custom` | anything | your function `(value, part) => transform` |

Plain meanings: **IK** (inverse kinematics) = put the hand here, and the arm bends to reach; **gait** = a way of walking or running; **morphs** = shape changes blended by number (a smile, a frown); **clip** = a recorded motion.

## Examples

```ts
// 1 · a wind turbine driven by a sensor feed
const turbine = kinematics.define(windTurbine, {
  rotor:   hinge({ axis: 'x', pivot: 'hub' }),
  nacelle: hinge({ axis: 'y' }),
});
w.add(entities({
  shape: turbine,
  data: data.stream('wss://…/scada'),
  drive: (d, s) => ({ rotor: d.props.rpm * 6 * s.time.t, nacelle: d.props.yaw }),
  states: { stopped: { when: d => d.props.rpm < .1 } },
}));

// 2 · an operator walks to the turbine's service anchor and works there
const op = w.add(entity({ shape: humans.worker }));
op.go({ to: { entity: 't-17', anchor: 'service' }, gait: 'walk' }).then(() => op.state('inspect'));

// 3 · a car with a driver attached to its seat; its wheels from speed and steering
const car = w.add(entity({ shape: cars.pickup, drive: (d, s) => ({ wheels: { spin: d.speed, steer: d.steer } }) }));
op.attach(car, 'driver', { pose: 'sit', hands: ['gripL', 'gripR'], feet: 'pedals' });

// 4 · faces and expressions on a human
op.express({ emotion: 'happy', amount: .6 });
op.say('Turbine 17 is fine', { visemes: 'auto' });

// 5 · [planned] a minibus: a thing on lanes, driven by a timetable, its door a slider
w.add(entities({
  kind: 'minibus', placement: 'thing', shape: minibuses.make(), data: fleet,
  locomotion: lanes({ on: roads.lanes() }), drive: drive.schedule(data.gtfs('/feed.zip')),
}));

// 6 · [planned] a station is a place; a bench is a thing in it
const station = w.add(entity({ id: 'st-1', kind: 'station', placement: 'place', shape: stations.small }));
w.add(entity({ kind: 'bench', placement: 'thing', in: station, shape: furniture.bench }));
```

## How it relates

- **[The fabric](fabric.md):** networks and zones give entities their places and their locomotion constraints.
- **[Shapes](shapes.md):** parts and anchors come from the shape.
- **[Interaction](interaction.md):** controllers drive entities; parts can be picked.
- **[Physics](physics.md):** contacts and solids make entities stand and collide.
- **[Live twins](live-twins.md):** streams drive entities; the chronicle replays them.
- **[Observation](observation.md):** far entities lose joints, then become dots, then counts.

## Common mistakes

- **Animating in a `requestAnimationFrame` of your own.** Use `drive`; it runs in step with time, replays and captures.
- **Hand-placing a person in a seat.** Use `attach` with the seat's anchor; it adapts to every vehicle size.

## Status

| part | status |
|---|---|
| identity, placement, locomotion | [planned] in aslnut |
| kinematics, drive, states, attach | [planned] in aslnut (a reference implementation exists) |
| skeleton, skin, morphs, expressions, gaits, IK | [planned] in aslnut (a reference character pipeline exists: generated body, painted weights, DQS) |
| agents with a rhythm, crowds as counts | [planned] (a reference implementation of street life exists) |
| moving points and trails from data | [built] (`points` moved by rows or a stream; `trail` drawn up to the world's time; `w.follow` keeps one in view) |
