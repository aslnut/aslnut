# core › space

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist).

**In one line:** where things are: bodies, the tree of frames positions are measured in, units, precision without jitter, cells for loading, the ground with the shells and volumes above and below it, regions (named areas in a hierarchy: which one a point is in, values rolled up and down the levels, compact packs), and an observer that can see the effects of light's speed.

Concepts: [world and body](../../concepts/world-and-body.md) · [space](../../concepts/space.md) · [underground](../../concepts/underground.md) · [data](../../concepts/data.md)

<!-- tree:reference/core/space -->
```tree
space/
├── bodies
├── frames/
│   ├── inertial
│   ├── body-fixed
│   ├── local
│   ├── object
│   └── re-rooting
├── units
├── precision
├── cells
├── ground/
│   ├── ground
│   ├── shells
│   └── volumes
├── regions/
│   ├── tree
│   ├── rollup
│   └── pack
└── observer/
    ├── light-time
    ├── aberration
    ├── doppler
    └── ship-time
```
<!-- /tree -->

## API

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `bodies` | `body(options)` · `w.bodies` | `id: string` · `radius?: number` · `ellipsoid?: [a, b]` · `plane?: { size }` · `gravity?: number = 9.81` · `rotation?: { period, axis }` · `surface?: Surface` | `Body` | [partly] | `body({ id: 'ceres', radius: 469_700 })` |
| `frames/inertial` | `frame('inertial', centre?)` | `centre?: BodyId = 'sun'` | `Frame` (fixed to the stars) | [planned] | `points({ data: sats, frame: 'inertial' })` |
| `frames/body-fixed` | `frame({ body, kind: 'fixed' })` | `body: BodyId` | `Frame` (turns with the body) | [planned] | `frame({ body: 'earth', kind: 'fixed' })` |
| `frames/local` | `frame({ body, at, kind: 'local' })` | `at: [lon, lat, h]` · `axes?: 'enu' = 'enu'` (east, north, up) | `Frame` | [planned] (a research prototype exists) | `frame({ body: 'moon', at: [23.4, 0.7, 0], kind: 'local' })` |
| `frames/object` | `entity.frame` | — | the entity's own frame | [planned] | `cam.follow({ frame: ship.frame })` |
| `frames/re-rooting` | automatic; `w.origin` | `origin?: 'camera' \| Frame = 'camera'` | — | [planned] | `w.origin = 'camera'` |
| `units` | `units.m`, `units.km`, `units.au`, `units.ly` · `to(value, unit)` | `value: number` · `unit: Unit` | `number` | [planned] | `orbit({ a: 1.52 * units.au })` |
| `precision` | camera-relative positions | — | centimetres at street level, no jitter | [built] | (automatic) |
| `cells` | `cells.of(lon, lat, level)` · `cells.children(id)` | `level: int` · `scheme?: 'mercator' \| 'healpix' = 'mercator'` | `CellId` | [planned] (a research prototype exists) | `cells.of(107.6, -6.9, 14)` |
| `ground/ground` | `w.ground.at(lon, lat)` · `w.ground.normal(lon, lat)` · `on: 'ground'` · `w.standAt(lon, lat, near?)` (where a thing stands: the top of what is drawn there, a road, a kerb, a footpath, a deck, the level nearest `near`; the ground where nothing is drawn; layers that draw such surfaces give `levelsAt(lon, lat, out)`) | `lon, lat: number` · `near?: number` (true m) | `metres` · `[x, y, z]` | [partly] | `const h = await w.ground.at(107.61, -6.9)` |
| `ground/shells` | `shell({ body, from, to })` | `from: number` (metres above ground) · `to: number` | `Shell` (a layer of air or orbit space) | [planned] | `shell({ body: 'earth', from: 0, to: 12000 })` |
| `ground/volumes` | `volume({ data, on, height, res })` | `data: VolumeSource` · `on?: 'ground' \| 'absolute' = 'ground'` · `height: [low, high]` · `res?: number` | `Volume` element | [planned] | `volume({ data, height: [-12000, -3000] })` |
| `regions/tree` | `regions.tree({ levels, sources, parentOf? })` · `await tree.load(loader)` · `tree.at(lon, lat, level?)` · `tree.get(level, id)` · `tree.parent(r)` · `tree.children(r)` · `tree.path(r)` · `tree.level(name)` | `levels: string[]` (top first) · `sources: Record<level, Source>` · `parentOf?: Record<level, f => id>` (default: the parent its middle lies in) | `RegionTree` · `Region { id, level, name, props, parent }` | [built] (from sources; packs planned) | `tree.at(107.61, -6.9, 'district')` |
| `regions/rollup` | `tree.rollup(rows, opts)` · `groups(options)` (things rolled up into groups per level, with values over time) | `rows: Source` · `on: string` (the rows' region id) · `to: level` · `from?: level` · `sum?: string[]` · `mean?: string[]` · `count?: boolean` · `fn?: (rows, region) => props`; groups: `of: id \| Element \| Source \| array` (a set's moving things: in a group while inside it; features) · `by: { regions: Source \| Feature[], name? } \| { cells: m } \| d => key \| { [level]: by }` · `values?: { [name]: { count: true } \| { sum \| mean \| min \| max: Channel } \| { of: Channel, fn: values => number } } = { n: count }` · `log?` · `show?: { levels: string[] }` (the groups there, the members at the others) · `mark?: (g: GroupsSource, level) => Element` (default a label each) | `Rows` at the target level (live: changes with the rows) · `Groups` (an element; a level's `GroupsSource`: a feature a group (its area, its cell, its members' middle) and its `log`: each group a thing, its values over time) | [built] (groups: made once per level in a worker (the places and the members' values as arrays; your own aggregates here), over time when the members move (two samples at one time where one comes or goes); shown only through the observation gates (margin, dwell, keep), never by the camera: the layers example's places counted per suburb at the city and district levels, each place at the street; acrobat over it 0 blinks of its own, nothing changing while still) | `tree.rollup(crime, { on: 'suburb', to: 'lga', sum: ['count'] })` · `groups({ of: 'places', by: { regions: suburbs }, values: { n: { count: true } }, show: { levels: ['city', 'district'] }, mark: (g) => cards({ of: g, rows: [{ label: 'places', value: 'n' }] }) })` |
| `regions/pack` | `regions.pack(source, opts)` (tools) · packed files | `levels: string[]` · `simplify?: number[]` (metres per level) | a region pack | [planned] (a research prototype exists) | `aslnut bake regions ./admin.geojson --levels province,city` |
| `observer/light-time` | `w.observer({ effects: ['light-time'] })` | `effects: Effect[]` | things drawn where they were when the light left | [planned] | `w.observer({ effects: ['light-time'] })` |
| `observer/aberration` | effect `'aberration'` | `speed: number` (fraction of light speed) | the sky bunched toward the motion | [planned] | `w.observer({ kind: 'voyager', speed: .9, effects: ['aberration'] })` |
| `observer/doppler` | effect `'doppler'` | `speed: number` | colours shifted blue ahead, red behind | [planned] | `effects: ['doppler']` |
| `observer/ship-time` | `observer.time` | — | the traveller's own clock (slower at speed) | [planned] | `hud.text = observer.time.toISOString()` |

## Example

Space:

```ts
const w = await world(canvas, { bodies: [earth(), moon()], frame: 'inertial' });
points({ data: landers, frame: { body: 'moon', kind: 'local' } });
volume({ id: 'melt', data, on: 'ground', height: [-12000, -3000] });
const h = await w.ground.at(107.61, -6.9);
```

Regions:

```ts
const tree = await regions.load('/packs/id-admin');
const d = tree.at(107.61, -6.9, 'district');            // { id, name: 'Coblong', … }
w.add(area({ data: tree.level('city').join(tree.rollup(crime, { on: 'suburb', to: 'city', sum: ['count'] }), { on: 'id' }) }));
```

## Open questions

- (space) Healpix cells for whole-planet simulation, or stay with Mercator tiles plus polar caps?
- (space) Should units be numbers multiplied by constants (`1.5 * units.au`) or tagged values?
- (space) `w.ground.at` disagrees with the drawn relief away from local DEMs today (review finding): one ground source for both is planned.
- (regions) A research prototype's region packs exist but aren't wired to `world()`: wire them as the first `tree` source.
