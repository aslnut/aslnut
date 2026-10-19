# kits › game

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist). a reference implementation exists.

**In one line:** pieces a game in a twin needs: a player avatar wired to a controller and the camera, and collision against the world's solids; built only from core and modules.

Concepts: [entities](../../concepts/entities.md) · [interaction](../../concepts/interaction.md) · [compile](../../concepts/compile.md)

<!-- tree:reference/kits/game -->
```tree
game/
├── avatars
└── collision
```
<!-- /tree -->

## API

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `avatars` | `avatars(w, options)` · `.setMode('walk' \| 'car' \| 'drone' \| 'map')` · `.setCamera('follow' \| 'first-person')` (V, or ◉ on a phone) · `.me` (the entity) | `start?: at => { at, heading }` (a street near) · `obstacle?: (lon, lat) => height` · `touch?: boolean` (a stick, ▲ ▼) · `shapes?: { walker: stride => Made, car: () => Made, drone: () => Made }` (yours, from shape(...); made when first needed) · `colors?` (the plain ones) · `vehicles?: { near, onEnter, onExit }` (get in at a vehicle's entry or driver anchor with F or ⇄, out beside it, left parked) · `camera?: 'follow' \| 'first-person'` | the camera behind it, under control | [built] (an entity of core › entities: walking on the surface, on wheels, in the air, driven by a person's controller, the camera following and pulled in before a wall, or from its eyes with the avatar not drawn; your own walker, car and drone; vehicles got into at their entry anchor and left parked) | `avatars(w, { obstacle, shapes: { car: () => car.make() } }).setMode('walk')` |
| `collision` | `collision(w, options)` | `solids?: 'compiled' \| Source \| Feature[] = 'compiled'` (the world's layers that answer `blockerAt`: the street level's buildings; or your polygons) · `height?: f => m` · `radius?: number = .3` · `step?: number = .35` (metres you can step over) | `(lon, lat) => height` (0: open) | [built] (a walker and a car stop at what stands there and slide along it; a following camera is pulled in before it; the street level answers from a 2 m grid of each tile's buildings) | `locomotion.surface({ blocked: collision(w, { radius: .3 }) })` |

## Example

```ts
const me = avatar({ shape: humans.make({ height: 1.75 }), camera: 'follow' });
w.add(me, collision({ solids: 'compiled' }));
```

## Open questions

- Is collision physics with rigid bodies (falling, pushing) in the kit, or only standing and blocking?
