# Space: bodies, frames, orbits and the sky beyond

> Draft under discussion. Interface and structure only.

**In one line:** one world can hold **several bodies** (Earth, the Moon, Mars, the Sun); each lives in a **frame tree** (inertial → body-fixed → local), satellites follow orbits from TLEs, planets from ephemerides, and the far sky (stars, constellations, galaxies, exoplanets) is real data; a **light-speed voyager** shows what a fast traveller would actually see.

## Why

- **Twins don't stop at the ground:** satellites over a disaster, the Moon for a lunar base, the stars for a planetarium.
- **One frame model avoids broken maths:** centimetres on a street and millions of kilometres in space, in one scene, without jitter.
- **True sky:** real positions for a place and time, not a painted dome.

## The rules

1. **Bodies** are added to the world: `earth()`, `moon()`, `mars()`, `sun()`, or `body({ radius, shape, surface })`.
2. **Frames** nest: `inertial` (fixed to the stars) → `body-fixed` (turns with a body) → `local` (east-north-up at a place) → `object` (a ship's or entity's own). Every element says which frame it's in.
3. **Re-rooting:** the camera's frame becomes the origin, so numbers stay small and nothing jitters (the floating origin, generalised).
4. **Orbits:** satellites from TLEs (propagated each frame), planets and moons from ephemerides, n-body for your own, transfers for planned paths.
5. **The far sky** is data: star catalogues, constellation lines per culture, galaxies, exoplanets.
6. **The observer** can be ordinary or a **voyager:** with light-time (you see things where they were), aberration (fast motion bunches the sky forward), Doppler (colours shift) and ship time (time slows for the traveller).

```tree
space/
├── bodies/
│   ├── earth
│   ├── moon
│   ├── mars
│   ├── sun
│   └── custom
├── frames/
│   ├── inertial
│   ├── body-fixed
│   ├── local
│   ├── object
│   └── re-rooting
├── orbits/
│   ├── tle
│   ├── ephemerides
│   ├── n-body
│   └── transfers
├── sky/
│   ├── stars
│   ├── constellations
│   ├── galaxies
│   └── exoplanets
└── observer/
    ├── light-time
    ├── aberration
    ├── doppler
    └── ship-time
```

Plain meanings: **TLE** = two lines of numbers that describe a satellite's orbit, published daily; **ephemeris** = a table of where planets are at each time; **aberration** = moving fast makes the stars appear bunched toward where you're heading; **light-time** = light takes time to arrive, so you see the Sun as it was 8 minutes ago.

## Examples

```ts
// 1 · Earth and Moon, satellites from TLEs
const w = await world(canvas, { bodies: [earth(), moon()], frame: 'inertial' });
w.add(satellites({ data: data.csv('https://celestrak.org/…/active.txt', { format: 'tle' }),
                   trail: { minutes: 30 }, when: { level: { to: 'region' } } }));

// 2 · an element in a body's local frame
points({ data: stations, frame: { body: 'moon', kind: 'local' } });

// 3 · the far sky
w.add(stars({ catalogue: 'hipparcos', magnitude: 6.5 }),
      constellations({ culture: 'western' }),
      exoplanets({ data: data.csv('…/exoplanets.csv') }));

// 4 · a light-speed voyager
const ship = w.observer({ kind: 'voyager', speed: .9, effects: ['light-time', 'aberration', 'doppler'] });
ship.go({ to: 'alpha-centauri' });
ship.time;    // ship time, slower than the world's clock
```

## How it relates

- **[World and body](world-and-body.md):** a body is a world's surface; several can share one world.
- **[Sky](sky.md):** the sky seen from the ground uses the same sun, moon and stars.
- **[Time](../reference/core/time.md):** scales (UTC, TT) matter for orbits.

## Common mistakes

- **Putting a satellite in a local frame.** Orbits are inertial; draw them there.
- **Old TLEs.** They drift within days; refresh them.

## Open questions

- Which ephemeris source by default, and how much of it ships offline?
- How many star catalogue levels for phones?

## Status

| part | status |
|---|---|
| one body, local frame, precision (floating origin) | [built] |
| several bodies, frame tree, re-rooting | [planned] |
| sun position, basic star field | [partly] (a star field and the glow; the sun's position is planned; a research prototype exists) |
| TLE, ephemerides, n-body, transfers | [planned] |
| constellations, galaxies, exoplanets | [planned] |
| voyager effects | [planned] |
