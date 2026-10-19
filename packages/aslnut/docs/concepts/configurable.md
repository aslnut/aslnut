# Everything is configurable

> Draft under discussion.

**In one line:** every element of aslnut can be a named provider with defaults, your own data, or your own function, and every prop value can be a constant or a function. Custom functions are the blood of aslnut.

## Why

- **No magic strings.** `'terrarium'` hides who provides the tiles and can't take your own data. `terrain.mapzen()` names the provider, has defaults, and can be swapped.
- **Real projects mix sources:** a global terrain, your own grid for one city, a lidar for one street, each with its own conditions.
- **Functions cover what options can't.** Any rule you can write in TypeScript works.

## The rules

1. **Providers are factories with defaults:** `terrain.mapzen()`, `imagery.esri()`, `imagery.osm()`, `imagery.mapbox({ token })`. Every option has a default you can override.
2. **Your own data** uses the same words: `terrain.grid({ url, where })`, `points({ data: myArray })`.
3. **Your own function** implements the same small interface. A terrain source is just `{ id, attribution, where?, when?, heights(tile, n) }`.
4. **Lists compose:** later items win where they cover (`where`), blended at the edges (`blend`, in metres).
5. **Every element takes `when`** (see [presence](presence.md)).
6. **Every prop value** can be one of the forms below.

## Every prop value

| form | example | for |
|---|---|---|
| a constant | `color: '#f80'` | the whole element |
| per feature | `color: d => byFuel[d.props.fuel]` | each feature, from its data |
| per level | `width: s => (s.observation.level === 'street' ? 3 : 1)` | how it looks at an observation level (it changes once, at a level change; never with the camera) |
| per time | `opacity: t => …` | changes with world time |
| per feature and time | `size: (d, s) => d.props.mw * s.time.month` | both |
| a scale | `color: scale.quantile(d => d.props.rate, { n: 5 })` | data → colour classes |
| a provider | `imagery: [imagery.esri()]` | sources |

## Examples

```ts
// 1 · providers, your own grid, your own function, all in one list
earth({
  imagery: [
    imagery.esri(),
    imagery.custom({ url: myTiles, when: { level: { from: 'street' } } }),
  ],
  terrain: [
    terrain.mapzen(),                                   // the AWS Terrarium tiles, by Mapzen; global
    terrain.grid({ url: '/dem/bandung-30m', where: bandungBox, when: { level: { from: 'city' } }, blend: 300 }),
    terrain.custom({
      id: 'lidar-braga', attribution: 'Pemkot Bandung lidar', where: bragaBox,
      when: { level: { from: 'street' } },
      heights: async (tile, n) => decodeMyLidar(tile, n),   // your code: n × n heights for this tile
    }),
  ],
  exaggerate: s => (s.observation.index < 3 ? 3 : 1.5),   // a function of the level, not only a number
})

// 2 · per-feature styling
line({ data: grid, color: d => (d.props.kv >= 150 ? '#ffcc00' : '#ff8800'), width: d => d.props.kv / 100 })

// 3 · override a provider's defaults
imagery.esri({ layer: 'World_Imagery', maxZoom: 19, attribution: 'Esri, Maxar' })

// 4 · React (aslnut/react): the same objects, as props
<World options={{ body: earth({ imagery: [esri()], terrain: [mapzen(), grid({ url, when: { level: { from: 'city' } } })] }) }} />
```

## The four levels of customising, lightest first

| level | you write | example |
|---|---|---|
| props | values and functions | `width: d => d.props.kv / 100` |
| hooks | a shader snippet at a named point | `/*@reveal*/`, `/*@color*/` |
| provide | your class for a named part, used everywhere | `w.provide('earth.buildings', MyBuildings)` |
| subclass | your own version of a part | `class MyMark extends Element { … }` |

A **shader** is the small program that runs on the graphics chip; aslnut writes its own, and hooks let you add a line or two to it. See [extending](extending.md).

## How it relates

- **[Presence](presence.md):** `when` is part of every element's configuration.
- **[Data](data.md):** sources are providers too.
- **[Extending](extending.md):** the deeper levels (hooks, provide, subclass).

## Common mistakes

- **Hard-coding a provider URL** in app code. Use the factory so the attribution and terms come with it.
- **Writing a new layer** when a function in a prop would do.
- **Forgetting `where`** on a local source: without it, aslnut can't know where your data stops.

## Status

| part | status |
|---|---|
| provider factories (`imagery.esri()`, `.osm()`, `.sentinel()`, `terrain.mapzen()`) | [built] |
| local grids (`terrain.grid({ url \| data, where, blend })`) | [built] |
| `*.custom` sources | [planned] |
| lists with `where` / `blend` | [built] (terrain: later wins inside `where`, blended over `blend` metres; imagery: in order with `opacity` and `blend`) |
| per-feature / per-view functions | [partly] (`points` size / colour / value per feature; `exaggerate: s => …`; more marks in phase 2) |
| hooks, provide, subclass | [partly] (a research prototype's extensions; provide by rack number) |
