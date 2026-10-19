# core › time

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist).

**In one line:** the world's clock (now, rate, paused, replay) and its step, calendars for showing dates, time scales (UTC, TAI, TT) for orbits and the sky, time zones, ranges, and deep time (years ago, ka, Ma); every `when`, `drive` and rule reads it as `s.time`.

Concepts: [presence](../../concepts/presence.md) · [live twins](../../concepts/live-twins.md) · [sky](../../concepts/sky.md)

<!-- tree:reference/core/time -->
```tree
time/
├── clock
├── step
├── calendars
├── scales
├── zones
├── ranges
└── deep
```
<!-- /tree -->

## API

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `clock` | `w.time` · `w.setTime(t, { rate })` · `w.setTimeRate(n)` · `w.timeRate` | `t: Date \| 'now'` · `rate?: number` (seconds per second; with a date the default is 0: the time held; with 'now' 1) · `zone?: string = local` | `s.time = { t, date, hour, day, year, rate, paused, zone }` | [built] (`w.time`, `w.setTime(t \| 'now', { rate })`, `w.setTimeRate(n)` (0 holds, 600 a time-lapse), `w.timeRate`, `s.time.rate`; a fast clock keeps the frames coming) | `w.setTime(new Date('2026-06-21T15:00+07:00'), { rate: 600 })` |
| `step` | `w.step(ms)` · `world(canvas, { clock: 'manual' })` | `ms` (the world advanced by that much and one frame drawn) | `this` | [built] (with a manual clock nothing runs by itself: the same steps give the same world; `await w.settled({ hold: true })` for what loads meanwhile; a fixed clock `{ fps }` draws every frame at a fixed step) | `for (let i = 0; i < 600; i++) w.step(1000 / 30)` |
| `calendars` | `w.time.calendar = name` · `s.time.format(fmt)` | `name: 'gregorian' \| 'islamic' \| 'javanese' \| 'sundanese' …` · `fmt?: string` | formatted dates | [planned] | `w.time.calendar = 'islamic'` |
| `scales` | `time.to(t, scale)` | `scale: 'utc' \| 'tai' \| 'tt' \| 'tdb'` | `number` (seconds) | [planned] | `ephemeris('mars', time.to(t, 'tdb'))` |
| `zones` | `s.time.local` · `world(canvas, { timeZone })` · `w.setTimeZone(zone)` · `w.timeZone` · `zoneLookups.nearest(opts)` · `zoneLookups.fixed(name)` · `zonedTime(wall, zone)` | `timeZone?: IANA name \| 'auto' \| (lon, lat) => name \| null` (auto: the place's under the camera, asked again every 25 km; unset: solar time) · `nearest: { near?: km = 1500 }` | local time for the place: `{ year, month, day, hour, minute, weekday, zone, offset }` | [built] (through the IANA zone, daylight saving right; `'auto'`: the zone of the nearest principal place (tzdata's zone1970.tab, 312 zones, 9 kB, loaded only when asked): right across most of a zone, wrong near some borders, so your own lookup (zone polygons) makes it exact; the open sea far from any: solar time; `zonedTime` the instant of a wall-clock time in a zone) | `world(canvas, { timeZone: 'auto' })` · `when: s => s.time.local.hour >= 18` |
| `ranges` | `w.time.set(t)` with deep time | `t: Date \| { year: number }` (negative and geologic years, e.g. `{ year: -1_000_000 }`) | — | [planned] | `w.time.set({ year: -10000 })` |
| `deep` | `w.time.set({ ago })` · `s.time.ago` · `s.time.format('ka')` | `ago?: years` · `ka?: number` (thousands of years ago) · `ma?: number` (millions) | years before present, readable as a counter | [planned] | `w.time.animate({ from: { ka: 140 }, to: { ago: 0 }, dur: 30 })` |

## Example

```ts
const w = await world(canvas, { body: earth(), time: '2026-06-21T06:00+07:00' });
w.time.rate = 900;                                  // 15 minutes per second
lights({ data: lamps, when: { hour: [18, 6] } });   // reads s.time.hour
```

## Open questions

- The world's clock exists (real, or a fixed step per frame for captures); a clock object with speed and seeking comes next.
- Should replay be part of the clock (`w.time.replay`) or of the chronicle?
