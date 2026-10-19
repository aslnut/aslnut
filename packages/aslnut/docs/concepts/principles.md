# Principles

**In one line:** the rules every part of aslnut is built by. When a design choice is unclear, these decide it.

There are nine groups, each a short list:

```
principles
├── 1. what aslnut is
├── 2. looking: orbit › observation › data › viz
├── 3. phone first
├── 4. WebGPU and WebGL2, both first class
├── 5. authoring
├── 6. the real world
├── 7. the viewer is in charge
├── 8. structure
└── 9. proof
```

## 1. What aslnut is

1. **A world library.** It makes and runs worlds: a place, what stands on it, what lives and moves in it, what flows through it, and how you look at it. Maps are one way of looking at a world, not what aslnut is.
2. **A viz engine.** Everything in it is made to be seen: a twin is viz, a GIS map is viz, and every piece of maths serves the picture. "Viz" is the whole library, never one part of it. It makes things visible in two ways, and render draws both:
   - **depiction** (core › geometry): things as they are;
   - **encoding** (core › encoding): data as signs ([encoding and layers](encoding.md)).
3. **Four layers, four reasons to change.**
   - **core:** mechanisms any world needs;
   - **modules:** knowledge of particular worlds, plus ready-made presets;
   - **kits:** optional pieces for one kind of use (dashboard, game, authoring);
   - **tools:** what runs outside the page.
4. **Stories are built on aslnut, not in it.** Scripts, timelines and video editing live outside ([boundaries](boundaries.md)).

## 2. Looking: orbit › observation › data › viz

1. **The chain.** A world is looked at through four links: the orbit (where the eye is), observation (the level looked at), data (the truth) and viz (what is drawn).
   - One job per link.
   - A link passes a change on only when its gate says so.
   - Only the orbit costs something every frame ([observation](observation.md)).
2. **Assume acrobatic orbits.** People zoom, tilt, spin and roll at any speed, at any time, back and forth. Each frame only the picture moves: nothing is loaded, rebuilt, recoloured or faded because the eye moved. Tests fly acrobatically by default.
3. **Data is never changed by looking.** The camera and the observation level never change the data; only simulation and time do. Loading is a cache and never seen: the same feature has the same value and the same colour, loaded early, late or from the cache.
4. **A layer is a statement.** One dataset said one way: its data loaded once, its signs (fill, line, labels) inside it, its legend, its place in the stack. Its look comes from the feature and the settings only; the same value gives the same look, always ([encoding and layers](encoding.md)).
5. **Presence follows the level, never the camera.** A level changes only past its edge by a margin and after a dwell; its data loads ahead, swaps in once and is kept a while. GIS sets no levels by default, so its layers have no gate.
6. **Three kinds of zoom-dependent behaviour, and nothing else:** presence (the observation level), render detail (coarse first, never a hole, never a visible change of look) and loading (a cache, invisible). Nothing else may depend on the camera.

## 3. Phone first

1. **Designed and measured on mid-range phones first.** A desktop is the easy case.
2. **Budgets are hard.** The governor sheds detail before frame time breaks. A phone never cooks ([performance](performance.md)).
3. **Render detail by size on screen, never seen.** What is close and big on screen gets detail; error is measured in pixels, not metres. A coarse version is always there first, never a hole, and detail never changes a look or a colour (core › runtime › detail).
4. **Pay only for what you set.** Every parameter is optional. An unset one is null: it isn't computed, and adds no shader feature, buffer, pass or worker job. A tree may offer twenty parameters; set three and you pay for three.
5. **Nothing blocks the frame.** Heavy work runs in workers, on a server, or ahead of time ([compile](compile.md)).
6. **Data, not meshes, travel.** Ship heights, features and parameters; build meshes on the device. Ship meshes only where they are unique (landmarks, scans).
7. **Lite by default, realistic when needed** ([quality](quality.md)).
8. **A still view costs nothing; budgeting is the default.** Frames are drawn on demand: what animates asks for them itself, only while it is seen, at the rate it needs, and a still view draws none. The device picks the quality and the governor holds it to the device's budget unless you set your own. Every element is built this way ([building an element](performance.md#building-an-element-frames-and-the-budget)).

## 4. WebGPU and WebGL2, both first class

1. **Every feature, test and example works on both from day one.** No feature exists on one only.
2. **Shaders are written twice** (WGSL and GLSL) and checked as twins.
3. **Parity is measured.** The same view on both must match within a set tolerance ([graphics](graphics.md)).

## 5. Authoring

1. **Everything is configurable:**
   - named providers with defaults;
   - your own data;
   - your own functions;
   - `when` on every element;
   - no magic strings ([configurable](configurable.md)).
2. **Lean but strong interfaces.** Few verbs, familiar names. A shape is `shape({ params, build })`, and its builder has seven verbs: solid, extrude, lathe, sweep, copy, scope, mesh ([shapes](shapes.md)).
3. **You choose the depth:** a few plain values first, then detailed settings, then your own functions. You meet the simple form first.
4. **No privileged built-ins.** A new kind of thing, one nobody has made yet, takes the same steps as a built-in one: `shape({ params, build })`, then `entities({ shape, data, params })`.
5. **Expressive from day one; presets come second.** The primitives draw anything: any 3D form, line or wireframe, your own shader on any shape, any hover or selection look, your own element. A user is never stuck waiting for a preset.
6. **Presets are ready-made things, never the mechanism.** A `presets` group:
   - is the last child of its node;
   - holds only things built with the public API, to use as they are or to copy and change;
   - lives at the most general level where it makes sense (a human anywhere, a house on Earth).

   Small value presets (weather, easing, colour ramps) stay inside their part. Each preset has its own import. Heavy assets come from the catalog and are never bundled.
7. **You can extend every level** ([extending](extending.md)).
8. **Presets are neutral; a kind is what is shared.** A kind (a house, an office, a charger, a vehicle, or yours) names its traits: the anchors, parts, measures, params and data every design of it carries (its entries, parking and service points, its roof's surface; wheels, doors, seats).
   - The library fixes what a kind is and gives the tools to build any design of it.
   - A preset is one neutral design: simple shapes, white to grey, every measure a param.
   - An app's own designs (a terrace, a house on stilts, a brand's charger) live in the app and carry the same traits.
   - What uses a thing (cars parking, people going in, the sun on a roof) reads only its traits, so any design serves ([entities](entities.md)).

## 6. The real world

0. **The bar: civil-design and AAA-game grade for roads, terrain, rivers and cities.** We measure ourselves against civil-design corridor tools (corridors, vertical design, junctions, earthworks, structures) and AAA open-world games (city builders, flight and driving simulators). The bar is **position and connection, not surface detail**:
   - how a road joins the next;
   - how it rises onto a bridge and comes down;
   - where each pier stands;
   - how the ground is cut and filled around it;
   - how a river sits in its bed;
   - how a building sits on its pad, behind the reserve.

   A road may look simple, but it must sit exactly right, and it must stay fast on a phone.
   - **Solved once, at build time.** The world is compiled in ordered stages, and every stage ends in an evaluation gate with hard checks: no building on a road, no tree on a road or a building, no pier on a lower road, decks clear, slopes within limits or walled. A failed check runs that rule's **patch policy**: *repair* (with a named, documented algorithm), *omit* the piece, or *stop*. You choose per rule, and each has a default. Every patch is recorded with what it changed and why, in the bake report and on the feature itself, so you can always tell measured from patched ([compile](compile.md#gates-and-patches)).
   - **Ready-made, not the only way.** The ready-made road, terrain, river and building pipelines are presets at this grade. Anyone can still write their own with the same primitives.
1. **Real open data,** with its licence carried as capabilities: what may be shown, prefetched, kept or exported ([licences](licences.md)).
2. **Raw stays raw.** Source data is never changed. Everything derived can be rebuilt. Edits are saved as diffs over the source.
3. **Authored beats measured beats generated, locally:** per place and per feature, never globally.
4. **Pieces own their ground.** Stairs, walls, quays and buildings carry a footprint and a ground contract. Terraforming follows from them; it is not a manual step ([real-world authoring](real-world-authoring.md)).
5. **A scan is the truth to fit, not the thing to ship.** Parametric pieces are fitted to it. Cleaned scan meshes are only for unique landmarks.
6. **Deterministic.** Every procedural choice is seeded from stable ids. The same world appears on every device, every time.
7. **Conserved.** When detail collapses or expands, observed totals and identities are kept.
8. **Precision is local.** Doubles stay on the CPU. The GPU works in cell-local, camera-relative frames, so there is no jitter from orbit to street ([space](space.md)).

## 7. The viewer is in charge

1. **Nothing moves the camera on its own when a world opens.** The viewer decides where to look.
2. **Nothing pops.** Switches between levels of detail are invisible, and a coarse version is always there while the finer one loads.
3. **Apps fade, videos reveal.** In an app, things appear with at most a short fade (0.25 s, no stagger). Full reveal animations are for video ([reveal](reveal.md)).

## 8. Structure

1. **One tree.** Every part and its status lives in one source. The reference, the map and the status view are generated from it.
2. **A hierarchy you can walk:**
   - about 4–9 children per node, and at most 4–5 levels deep;
   - siblings are the same kind of thing;
   - a name predicts what is inside;
   - every part has one home.
3. **The code mirrors the tree.** The folders are the tree.
4. **No sideways imports.** Shared code lives in the `shared` of the lowest level that holds all its users.
5. **Built in an app first, promoted later.** A piece moves into the library when a second real user needs it, and when it is generic and has types, docs, an example and a test.

## 9. Proof

1. **Measure before claiming.** Every number comes with its device, its view and the graphics it ran on.
2. **Built means tested.** A part is built only when it is in the package and tested on WebGPU and WebGL2.
3. **The platform is observable.** Every system reports what it loaded, why, and at what cost ([performance](performance.md)).
4. **Dogfood.** Example apps are built with the public API only. If something is hard to write there, the API is wrong.
