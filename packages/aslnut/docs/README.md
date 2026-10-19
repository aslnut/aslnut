# aslnut

> **Draft under discussion.** Nothing here is final. Every item is marked [built] (in `packages/aslnut`, tested on WebGPU and WebGL2), [partly], [planned] (a research prototype may exist), [proposed] or [open].

**In one line:** aslnut is a TypeScript library for making and running **worlds**. A world is a place (the Earth, the Moon, a flat floor) plus what stands on it, what lives and moves in it, what flows through it, and how you look at it. It runs in the browser with WebGPU or WebGL2.

It covers in one vocabulary data layers, objects, the globe and maps. It's meant to be easy to write for people and for AI assistants.

**What aslnut is not:** telling stories with worlds (scripts, timelines, video editing) is built *on* aslnut, outside it ([boundaries](concepts/boundaries.md)).

**How it's written:** answer first, then detail; plain words; one idea per line; every structure as a full tree; you meet the simple form first and the deeper levels only when you need them.

```ts
import { world, earth, imagery, terrain, points, data } from 'aslnut';

const w = await world(canvas, {
  body: earth({ imagery: [imagery.esri()], terrain: [terrain.mapzen()] }),
});

w.add(points({
  data: data.geojson('/plants.geojson'),      // loaded once; looking never changes it
  size: d => Math.sqrt(d.props.mw),          // per feature, from its data: the same at every zoom
}));
```

## Start here

0. **[Authoring](authoring.md):** one page to write a world, with a recipe per kind of app (for people and assistants; [llms.txt](llms.txt) adds every signature).
1. **[Principles](concepts/principles.md):** the rules every part is built by: a world library, phone first, both graphics first class, pay only for what you set, lean interfaces, one tree.
2. **[The map](map.md):** the whole library as a tree you can open, and how the pieces work together.
3. **Concepts:** the ideas everything shares, starting with [world and body](concepts/world-and-body.md).
4. **[Reference](reference/README.md):** every part, with its subtree and an API table.
5. **[Coverage](coverage.md):** every need checked against this design, with the decisions still open.

## The ideas in one breath

1. **A world stands on a body.** Layers, things and fields go on the body. ([world and body](concepts/world-and-body.md))
2. **orbit › observation › data › viz.** The camera only moves the picture; the level looked at decides what is present, past a margin and after a dwell; data is never changed by looking. ([observation](concepts/observation.md))
3. **A layer is a statement:** one dataset said one way, its signs and its names inside it, loaded once; the same value gives the same look, always. ([encoding and layers](concepts/encoding.md))
4. **Existing and being shown are separate.** One `when` decides showing, on every element: by level, time and state. ([presence](concepts/presence.md))
5. **Everything is configurable:** named providers with defaults, your own data, your own functions. ([configurable](concepts/configurable.md))
6. **Data is one handle:** sources, rows, joins, live updates. ([data](concepts/data.md))
7. **Order is by kind, then by you.** ([order](concepts/order.md))
8. **You can touch it:** hover, tap, select, controllers. ([interaction](concepts/interaction.md))
9. **Objects are code:** a shape is TypeScript that turns parameters into a 3D object; aslnut gets it to the screen. ([shapes](concepts/shapes.md))
10. **Things move and decide:** entities have joints and states; agents have rhythms. ([entities](concepts/entities.md))
11. **Nothing pops:** every element can be revealed. ([reveal](concepts/reveal.md))
12. **Lite by default, realistic when needed.** ([quality](concepts/quality.md))
13. **WebGPU and WebGL2:** aslnut picks one, automatically. ([graphics](concepts/graphics.md))
14. **glTF is the file format;** other formats come in through tools. ([formats](concepts/formats.md))
15. **You can extend every level.** ([extending](concepts/extending.md))
16. **Heavy building happens once, ahead of time;** phones stream the result. ([compile](concepts/compile.md))
17. **Fields follow rules,** yours or presets, and can be checked against measurements. ([physics](concepts/physics.md))
18. **Twins are live:** streams, history, scenarios, external engines. ([live twins](concepts/live-twins.md))
19. **Beyond the ground:** several bodies, orbits, stars. ([space](concepts/space.md))
20. **Below the ground:** strata, wells, magma, cutaways. ([underground](concepts/underground.md))
21. **The real sky** for a place and time, with weather. ([sky](concepts/sky.md))
22. **Lines become networks:** routes, reach, lanes, walkways; with zones and rules they are the world's **fabric**, and the fabric binds how things move. Real places are scanned, and pieces fitted to the scan own the ground under them. ([networks](concepts/networks.md) · [the fabric](concepts/fabric.md) · [real-world authoring](concepts/real-world-authoring.md))
23. **Phones first:** budgets, a governor, streaming, memory limits. ([performance](concepts/performance.md))
24. **Runs anywhere:** plain JS, React, Zebflow, safe on a server. ([hosting](concepts/hosting.md))
25. **Assistants can use it:** describe, schemas, errors that say the fix. ([LLMs](concepts/llms.md))
26. **Terms are obeyed** and credit is always shown. ([licences](concepts/licences.md))
27. **Only worlds inside;** stories, studios and app menus are built on top. ([boundaries](concepts/boundaries.md))

## Words used in these docs

| word | plain meaning |
|---|---|
| body | what a world stands on: a planet, a moon, a flat floor |
| layer | a set of marks drawn from data (points, lines, areas…) |
| shape | code that makes a 3D object from parameters |
| entity | one thing in the world: identity + shape + placement + locomotion + kinematics + drive (a building, a car, a person, a turbine) |
| fabric | what a world is laid out with: networks (roads, rivers, rail, ways) and areas (zones, biomes, regions); not entities |
| agent | what makes an entity decide what to do (a schedule, a behaviour) |
| field | a value spread over space (water depth, temperature) |
| `when` | the condition for showing an element |
| `s` | the current state: view, time, user, device |
| provider | a named source of tiles or data, with defaults (`imagery.esri()`) |
| WebGPU / WebGL2 | the two ways a browser talks to the graphics chip |
| shader | the small program that runs on the graphics chip; aslnut writes its own, you never have to |
| mesh | a 3D object as triangles: plain lists of numbers |
| instancing | drawing many copies of one mesh in a single call |
| chunk | a square piece of a compiled world, loaded when the camera is near |
| frame (of reference) | what positions are measured from: the stars, a turning planet, a spot on the ground |
| external engine | another program (a simulation server, a model) that aslnut trades values with |
