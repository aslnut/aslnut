# modules › world › space

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist).

**In one line:** what lies beyond the bodies: satellites from TLEs, asteroids, the star catalogue, constellation lines, galaxies and exoplanets, all from real data.

Concepts: [space](../../concepts/space.md) · [sky](../../concepts/sky.md)

<!-- tree:reference/modules/space -->
```tree
space/
├── satellites/
│   └── tle
├── asteroids
├── stars
├── constellations
├── galaxies
└── exoplanets
```
<!-- /tree -->

## API

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `satellites/tle` | `satellites(options)` | `data: Source` (TLE text, `format: 'tle'`) · `trail?: { minutes: number = 0 }` · `size?: Fn<number> = 3` · `filter?: d => boolean` · `when?` | element (propagated each frame, inertial frame) | [planned] | `satellites({ data: data.csv(celestrak, { format: 'tle' }), trail: { minutes: 30 } })` |
| `asteroids` | `asteroids(options)` | `data: Source` (orbital elements) · `max?: int = 10000` · `color?: Fn<color>` | element | [planned] | `asteroids({ data: data.csv('/mpc.csv'), max: 50000 })` |
| `stars` | `stars(options)` | `catalogue?: Catalogue = catalogues.hipparcos()` (`catalogues.gaiaLite()`, or your own `catalogues.custom({ load })`) · `magnitude?: number = 6.5` · `colors?: boolean = true` | element | [planned] (a research prototype exists) | `stars({ magnitude: 7 })` |
| `constellations` | `constellations(options)` | `culture?: string = 'western'` · `lines?: boolean = true` · `names?: boolean = true` · `bounds?: boolean = false` | element | [planned] | `constellations({ culture: 'sundanese' })` |
| `galaxies` | `galaxies(options)` | `milkyWay?: boolean = true` · `catalogue?: Catalogue = catalogues.messier()` (`catalogues.ngc()`, or your own) | element | [planned] | `galaxies({ catalogue: catalogues.ngc() })` |
| `exoplanets` | `exoplanets(options)` | `data?: Source = NASA archive` · `systems?: boolean = false` (draw orbits when close) | element | [planned] | `exoplanets({ systems: true })` |

## Example

```ts
const w = await world(canvas, { bodies: [earth(), moon()], frame: 'inertial' });
w.add(
  satellites({ data: data.csv('https://celestrak.org/…/active.txt', { format: 'tle' }), trail: { minutes: 30 } }),
  stars({ magnitude: 6.5 }), constellations({ culture: 'western' }), exoplanets(),
);
```

## Open questions

- Which star catalogue level ships for phones, and which loads on demand?
- Asteroid orbits on the graphics chip (compute) with a CPU path on WebGL2: at what count does it matter?
