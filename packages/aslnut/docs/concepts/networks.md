# Networks: graphs, routes, reach

> The road compiler in `tools/compile` runs eleven ordered stages: terrain and hydrology; CSG stamps; topology QA and compatible degree-2 chaining; measured alignment with optional centripetal interpolation; connected vertical design and tangent parabolic curves; upward frames and optional banking; union per level; corridor templates; separate footways and access; pier placement; cut/fill, walls and portals. Each stage records counts, extrema and feature ids and stops on unresolved hard failures. A deck envelope failure retries the bake from unchanged inputs with station height constraints. Buildings, forestry, decorators and lane graph export belong to the later stages.
>
> Source plan vertices stay fixed by default. Stub pruning, short-segment simplification, hairpin relaxation and lower-road widening require explicit options. Banking stays unset on town streets. Junction clusters use the existing buffers, union per level, closing of concave corners and kerb along the final outline. Connected ramps use their shared node and arm geometry to distinguish a graded merge from a stacked crossing. Tiles store typed polygons, heights and structure descriptors in quantized numeric rows. The clamp index can reference a compiled heightfield. Patch records live once in the report; tile features reference them for picking. Per-check patch policies are set through `compile({ patch: { 'deck-clearance': 'stop' } })` or the CLI's `BAKE_OPTIONS` JSON file. Repairs and omissions retain their source, algorithm and movement in both the stage report and picked feature properties.

**In one line:** any set of lines (roads, rails, pipes, cables, footpaths) becomes a **graph** you can route on, measure reach from (**isochrones**), and break into **lanes** for vehicles and **walkways** for people. With a **cross-section** swept along it, a network becomes the ground's fabric: surfaces, **junctions**, **structures** made from it, and the ground **clamped** below ([the fabric](fabric.md)).

**The bar** ([principles](principles.md) §5.0): roads are civil-design and AAA-game grade in position and connection: joins, bridges, piers, cut and fill. They're solved once at build time in ordered stages, each with an evaluation gate. The reference pipeline is the road compiler's ordered stages (above); the ready-made Earth roads follow it, and you can still write your own.

## Why

- **Twins are about flows:** cars on roads, power in cables, water in pipes, people on footpaths.
- **Questions are network questions:** how far can an EV get, which homes lose power if this cable fails, which schools are within 15 minutes' walk.
- **Agents need paths:** traffic and crowds move along lanes and walkways.

## The rules

1. **`network.from(lines, options)`** joins lines into a graph: nodes where they meet (within a snap distance), edges with props (length, speed, capacity, one-way).
2. **Costs are functions:** `cost: (e, s) => e.length / e.speed`, so closures, time of day, or a flood can change them.
3. **Routing:** shortest or cheapest path, between points or many-to-many.
4. **Isochrones:** everything reachable within a cost (15 minutes, 50 km of battery), drawn as areas.
5. **Nearest:** the closest node or edge to a point (snapping).
6. **Lanes** split road edges into drivable lanes with turns; **walkways** are the footpaths and crossings people use.
7. Graph values (flow, load, pressure) are **graph fields** on the edges (see [physics](physics.md)).
8. **Sections:** a cross-section (lanes, curbs, sidewalks, talud = an embankment slope) is swept along every edge.
9. **Junctions** are where the roads' buffers overlap in one unioned surface: no platforms to solve; their corners rounded by a closing.
10. **Structures** are made from the network, never drawn by hand: bridges, piers, culverts, decks.
11. **The clamp** pushes the ground just below the network and blends it back; nothing is placed on it.
12. **Networks are fabric, not entities.** They give entities their constraints: lanes → `lanes` locomotion, rails → `rail`, walkways → `surface` ([entities](entities.md)).

```tree
networks/
├── graph/
│   ├── nodes
│   ├── edges
│   └── snap
├── costs
├── routing/
│   ├── path
│   └── matrix
├── isochrones
├── nearest
├── lanes/
│   ├── lanes
│   ├── turns
│   └── signals
├── walkways/
│   ├── paths
│   └── crossings
├── sections
├── junctions
├── structures/
│   ├── bridges
│   ├── piers
│   ├── culverts
│   └── decks
└── clamp
```

Plain meanings: **graph** = points (nodes) joined by links (edges); **isochrone** = the area you can reach within a given time or cost.

## Examples

```ts
// 1 · a road graph from OSM lines
const roads = network.from(data.geojson('…/roads.geojson'), {
  snap: 1, speed: e => ({ primary: 60, residential: 30 })[e.props.highway] ?? 40,
  oneway: e => e.props.oneway === 'yes',
});

// 2 · a route and a 15-minute isochrone
const r = roads.route({ from: home, to: office, cost: (e, s) => e.length / e.speed });
w.add(line({ data: r.line, color: '#0af', reveal: { mode: 'trace' } }));
w.add(area({ data: roads.isochrone({ from: school, within: 15 * 60 }), color: '#0f8', opacity: .3 }));

// 3 · a cost that reads the world: flooded edges are closed
roads.cost = (e, s) => (s.world.fields.flood.at(e.mid) > .3 ? Infinity : e.length / e.speed);

// 4 · lanes for traffic, walkways for people
const lanes = roads.lanes({ width: 3.2, turns: 'auto' });
const walk  = network.walkways({ from: roads, sidewalks: true, crossings: 'auto' });

// 5 · [planned] the same graph as fabric: a section, junctions, bridges where it crosses water, the ground clamped below
roads.sections(e => section([walk(2), curb(.15), lane(3.2), lane(3.2), curb(.15), walk(2)]));
roads.junctions({ radius: 6 });
roads.structures(e => (e.crosses('water') ? { kind: 'bridge' } : null));
roads.clamp({ blend: 4 });
```

## How it relates

- **[The fabric](fabric.md):** networks with zones, rules and fields make up a world.
- **[Entities](entities.md):** lanes, rails and walkways bind locomotion.
- **[Agents](../reference/core/simulation.md):** traffic and crowds move on lanes and walkways.
- **[Physics](physics.md):** graph fields carry flows.
- **[Compile](compile.md):** lanes and walkways go into the logic pack.

## Common mistakes

- **No snap distance:** lines that almost meet stay disconnected.
- **A fixed cost** in a live twin; use a function of `s`.

## Status

| part | status |
|---|---|
| roads baked (carriageway, kerbs, junctions, heights, bridges, tunnels, medians, islands, markings, the clamp) | [partly] in aslnut (`tools.compile`, examples/roads) |
| footpaths, crossings' ramps, lanes, traffic | [planned] in aslnut |
| road solve, lanes, walkways, traffic on them | a reference implementation exists |

## How roads are built

> Draft under discussion. Distilled from a survey of road-authoring tools, procedural city tools, driving-simulation road formats (OpenDRIVE), the earlier prototype, and the Victorian street standards. The offline road compiler (`tools.compile`, test view `?go=roads`) now runs the eleven-stage pipeline described above. This section describes the corridor responsibilities; its numbered design steps are not the compiler stage numbers. Alignment, vertical design, union, footways, piers, landform and gates live in `src/core`. OSM interpretation, chaining, profiles and marking rules live in the Earth road preset. `tools/compile` only orchestrates. Public network integration remains partial for `core.geometry.networks.sections`, `core.geometry.networks.junctions`, `core.geometry.networks.clamp` and the Earth preset `modules.world.earth.presets.built.roads`; the existing `core.geometry.networks.walkways` graph is reused.

**In one line:** the road network is a **line graph** (centre lines with their class and width, the routing graph, never drawn); its surface is **every road buffered to its width and the buffers unioned**, one surface per level, the junctions' corners rounded by a **closing**; the **kerb comes last**, along the final outline. Heights are **solved** on the line graph, the ground is **clamped** below, the reserve is **kept clear**, and **observation** decides how much of this is built.

Most tools we read trim and fill each junction from its arms (sort the arms by angle, offset them, intersect neighbours, trim, fill a platform: traffic-simulation network builders, OSM-to-3D renderers, street-network tools, our prototype). That fails where several junctions sit close together: flaps, slivers, kerb fragments and platforms overlapping each other, cut-backs that meet, ramps that run beside their road. A union of buffers has none of those: close junctions, short connectors and ramps that leave together merge by themselves, and there are no platforms to solve. What makes roads look right is the rest: kerb returns with real radii, one continuous kerb round every block, footpaths round the corners, no lines on local streets, a solved height, and a ground that never comes up through the road.

```tree
from OSM lines to a finished street
├── 1. read          lines, tags, reserves, separate footpaths, crossings → local metres
├── 2. graph         split at shared nodes, snap, levels from layer / bridge / tunnel
├── 3. clean         clusters, short edges, roundabouts, dual carriageways, side paths
├── 4. profile       the section of each edge: tags → reserve data → regional defaults
├── 5. centre line   keep the vertices, round only sharp ones, work in (s, u)
├── 6. surface       buffers → union per level → corners closed → slivers dropped → zones → kerb last
├── 7. walkways      footpaths, corners and crossings as one graph for people
├── 8. heights       on the line graph; each vertex from the centre lines near it, junction zones planar
├── 9. clamp         the ground below the road, the verge set, blended back
├── 10. markings     from the lanes, drawn from (s, u) in the shader
├── 11. near roads   the reserve as a mask: trees, poles, houses, frontage
└── 12. detail       far = ribbon; near = sections + junctions; built in tiles, in workers
```

### 1. Read

- **Inputs:** OSM ways with `highway=*` and their tags. Optional: `area:highway` polygons, separate sidewalks (`footway=sidewalk`), crossing nodes (`highway=crossing`), reserve polygons (Vicmap road casements), property parcels, real surface polygons where a city publishes them.
- Project everything into the cell's local metres (law 7).
- Keep every OSM way and node id on every piece. Ids seed every choice (law 5) and key every authored override (law 10).

### 2. Graph (`core.geometry.networks.analysis.graph`, built)

- Split ways where they share a node. A node used by one way only is a shape point, not a junction (as street-network tools do).
- Snap ends within `snap` (1 m).
- **Levels:** from `bridge`, `tunnel` and `layer`. Two pieces on different levels never join, even where they cross in plan. `layer` only says who is above; it is not a height (OSM wiki).
- Join consecutive pieces when their tags match. Keep a node where the profile changes: a section change needs one.

### 3. Clean (no part of its own yet; today it would sit in `analysis.graph`)

Run in this order (the usual cleanup order: intersect, snap, merge, resolve):

1. **Roundabouts.** A ring of `junction=roundabout` ways is a ring section, one-way, plus a central island. Its nodes are ordinary 3-arm junctions (ring in, ring out, arm); step 6 never closes a corner between two parts of the ring, and cuts its island out of the middle. `highway=mini_roundabout` is a painted, mountable circle inside an ordinary junction.
2. **Dual carriageways.** Two one-way ways, same name, parallel within about 30°, closer than about 40 m. The gap between them stays a hole in the surface (a median, grass or concrete) with a kerb round it; it ends where the cross roads' buffers fill it. Where two dual roads cross, their four nodes become one cluster.
3. **Side paths.** If a road says `sidewalk=separate`, or a `footway=sidewalk` runs inside its reserve, the section has no footpath on that side. The footway is its own walkway ribbon; the verge fills the gap (street-network tools "zip" them).
4. **Clusters and short edges.** Nothing to merge: the union of step 6 makes close junctions one surface by itself. (Trim-and-fill tools must merge junctions whose platforms overlap, and every rule for it fails somewhere: a 5 m rule merges in too many places; a 10 m rule leaves clusters too complex to solve.)
5. **Near-parallel arms** leaving one node (under about 20°) are one direction: one shared asphalt, no corner between them (as traffic-simulation network builders do). The kerb between them is clipped away (prototype).

### 4. Profile (`core.geometry.networks.sections`; Earth: `modules.world.earth.presets.built.roads.sections`, `.sidewalks`)

A **section** is an ordered list of parts, left to right, each `{ kind, width, height?, look? }`. Kinds: lane, parking, bike, median, channel, kerb, verge (nature strip), footpath, shared path, shoulder. Parts beyond the kerb are **ground parts**: the ground there is set to them (step 9).

**Where each number comes from**, best first (law 10):

1. authored (a profile, or a range on an edge);
2. measured surface polygons (City of Melbourne road segments: carriageway, kerb, channel, footway, nature strip, median);
3. tags:
   - carriageway: sum of lane widths → `width` (or `width:carriageway`) → `lanes` × lane width (+ parking and bike lanes) → `est_width` → the class default;
   - footpaths: `sidewalk` both / left / right / no / separate; `sidewalk:*:width`;
   - kerb: `kerb` raised / lowered / flush / rolled; `kerb:height`;
   - one-way, `lanes:forward/backward`, `turn:lanes`, `cycleway`, `parking:*`;
4. the reserve: if a reserve polygon exists, cast across it every few metres. The verge is what is left between the back of kerb and the boundary. The footpath sits at its standard offset from the boundary (0.05 m), and the nature strip takes the rest;
5. the regional default profile for the road class (below).

**Changes along an edge.** A new piece wherever a part appears, goes or changes width (OpenDRIVE lane sections). Width changes over a taper (a setting, default 20 m), as a smooth cubic, never a step. A two-arm node with a width change: the taper joins them.

### 5. Centre line

- **Keep the measured vertices.** Data tools keep the OSM polyline; only game tools author splines.
- Round only sharp vertices (deflection over about 10°): an arc tangent to both pieces, its radius limited to half of each piece. Chaikin moves every corner and shortens long straights; avoid it on data.
- Resample by pixel error at the level being built (law 2), not by a fixed step.
- Everything after this works in **(s, u)**: `s` metres along the line, `u` metres to the left. Part edges are offset polylines at fixed `u`. On the inside of tight bends, remove the loops an offset makes.

### 6. Surface and junctions (`core.geometry.networks.junctions`, `.sections`; baked: `tools.compile.steps.solve`)

The surface is made in polygons, at build time (a polygon library, Clipper2, does the booleans and offsets), in this order.

**a. Buffers.**
- Every road is buffered to its carriageway width plus its kerb (per side when the two sides differ), with square ends.
- A road is cut where its level changes (`layer`, `bridge`, `tunnel`, or a tunnel deep enough to be covered); the cut is a **cap**, where the road goes on at another level.
- Where a road goes on as a narrower one, it narrows over its last 15 m (a smooth taper, never a step).
- At every node where roads end: a disc of the narrowest road's half width (a dead end's round end; the wedge outside a bend filled).

**b. Levels.** One surface per level: at grade, each bridge level, each tunnel level. A ramp belongs to the level it is tagged with along its length, with a cap where that changes. Two roads on one level that cross or run beside each other at different heights without meeting (no node in common: a street over a cutting, a ramp on its bank) are told apart: the one further off the ground moves half a level up or down.

**c. Union.** Each level's buffers unioned into one surface. Close junctions, short connector roads and ramps that leave together merge by themselves.

**d. Kerb returns.** Each junction's corners rounded by a **morphological closing** (out by `r`, back by `r`) of its arms two by two, kept to the corner's sector between them, so only the concave corners fill:
- `r` by the smaller road's class: residential 7.5 m, collector 12.5 m, arterial 15 m (IDM §12.5.6); 4 m on service roads.
- Arms leaving within 25° of each other (a median's nose, a gore) are not closed: the gap between them stays.
- A roundabout's ring on both sides of a corner: never closed (its island stays). The island is the ring's centre line moved in by the half width and the kerb (a mini roundabout's at least 1.5 m across).

**e. Clean up.** A small closing (gaps under 1.5 m), an opening (slivers under 0.8 m wide), pieces and holes under 20 m² dropped (pinholes filled), the offsets' micro-steps smoothed. Where two levels overlap at nearly the same height (a road going on at another level, by its cap), the overlap is kept by one of them; along that seam neither has a kerb.

**f. Junction zones.** Where two or more roads' buffers overlap (with the corners and the discs). Markings stop in them; stop lines, give-way lines and crossings sit at their edge. A zone is planar (step 8).

**g. Checks** (reported by every bake, law 12): each level's outline a valid set of simple polygons (no edge crosses another); no sliver (nothing an opening by 0.8 m would still take away); the kerb's inner edge on the surface and the kerb never across a road's centre line; no two levels within 0.5 m of each other (no z-fighting).

**h. The kerb, last.** The kerb is a band 0.45 m wide **inward from the final outline** of each level: one continuous kerb round every block, never across a cap. On a deck it is a parapet with the deck's side below it; in a cut, a retaining wall; on a freeway, a plain edge. The bake writes the edge line with each point's height, ground and inward offset; the device builds the kerb's top, face and foot from it.

**i. Verges: footpaths and nature strips** (baked, at grade), in polygons, after the road surface:
- **The reserve:** the data's road reserves (Vicmap Property road casements) and the road surface in them; a kerbed road the data leaves out, or leaves less than 3 m of verge, gets its verge by the rules (local 4.3 m, collector 5.5 m, arterial 6 m beyond the kerb). The verge is the reserve less the road surface.
- **Footpaths from the data first:** OSM sidewalks (`footway=sidewalk`) buffered to their width (`width`, `sidewalk:width`, else the council's default: 1.4 m in Monash, Victoria's 1.5 m), kept to the verge.
- **Generated only where the data has none:** a band along the property line, inside the reserve (0.05 m off it, the default width), beside a kerbed road, more than 3 m from a mapped sidewalk, not along a road tagged `sidewalk=no`.
- **The nature strip** is what is left: the verge less the footpaths, by polygon difference.
- The same clean rules: footpaths and strips opened (nothing under 0.7 m wide), pieces under 2 m² dropped; checked never on the road and never on each other.
- Heights: the kerb's top at the road's edge, rising 1 : 50 away from it (at most 0.4 m). The property line goes down into the ground (a skirt). The corner splay (3 × 3 m, or 5 × 5 m where a collector or arterial meets, Clause 56 Standard C20, IDM §12.5.5) comes from the reserve data where it has it.

**j. Crossings.**
- Where both sides of an arm have a footpath within 14 m, a crossing crosses the arm just past its kerb returns (outside the junction zone). OSM's own crossing nodes make crossings too, and a junction arm with one within 15 m makes no other.
- Each end gets a kerb ramp (the kerb lowered flush over 1.8 m), with a 1.5 m link of footpath from the ramp across the nature strip to the footpath.
- **Paint only what the data says.** `crossing=traffic_signals` gets two lines; `crossing:markings=zebra` gets zebra bars. Most Australian side-street junctions have no marked crossing.

**k. Other cases, same algorithm.**
- **T, X, 5 or more arms, clusters:** nothing special; the union and the closing handle them all.
- **Dead end:** a round end. `highway=turning_circle` gives a court bowl (10 m carriageway radius, IDM) (planned).

### 7. Walkways (`core.geometry.networks.walkways`) and lanes (`core.geometry.networks.lanes`)

- **Walkways (baked):** the mapped sidewalks, the generated footpaths' middle lines, the crossings, the links from each kerb ramp, and the other paths (through parks): every line cut where it crosses another, every end within 3 m of another line joined to it, the ends to the centimetre (`walk.json`). One graph people route on (`network({ lines, snap: 0.05 })`): park access walks it.
- **Lanes:** the lane parts' centre lines. Joined through each junction zone by connecting curves from each incoming lane to its allowed outgoing lanes (OpenDRIVE connecting roads; `turn:lanes`).

### 8. Heights (part of `sections`, `solve: true`; structures: `core.geometry.networks.structures.*`)

Heights are decided **in one fixed order**, each step reading the previous one, so every conflict has one winner (prototype):

terrain → deliberate terraform → water → **road solve** → **clamp** → ground pieces (verge, lots) → furniture → elevated structures.

1. **On the line graph.** Stations every 4 m on every road; the ground smoothed along it; decks over their level, tunnels under it, ramps from each end within the grade; a road crossing over another held 5.9 m above it (4.5 m clear and the deck).
2. **Each edge.**
   - Target = the mean of the terrain at the centre and at both reserve edges, so the road sits in its corridor.
   - Fit `h` to minimise `Σ(h − t)² + λ Σ(Δh)²`, with `λ = (smoothing length / spacing)²`. It is one tridiagonal solve, O(n).
   - A node's roads share its height.
3. **The surface's vertices.** Each surface is cut in 20 m cells; every vertex takes its height from the solved centre lines near it (inverse distance by how far it is outside each road). A junction zone is a plane through its outline (least squares, at most 12 %), blended into its roads over 6 m round it; a zone whose roads disagree by more than 0.35 m keeps their heights and is reported (the idea of the OpenDRIVE 1.8 junction elevation grid).
4. **Cross-fall.**
   - Carriageway crown 3%.
   - Kerb face 0.15 m (B2) or 0.125 m (SM2) above the channel.
   - Footpath 1:50 rising away from the road; verge at most 1:10 (IDM).
   - The kerb height is a result. If the ground at the boundary differs more than the verge can take, report it, or add a batter or wall (`core.geometry.networks.structures.walls`).
5. **Grade check.** Over windows of about 15 m. Report anything over the class limit (IDM: desirable 10%, absolute 20%). Never hide it.
6. **Bridges and tunnels** (`structures.bridges`, `.decks`, `.piers`; Earth `roads.decks`, `roads.elevated`).
   - A `bridge` edge is a deck between abutments where the way meets solid ground (OSM wiki). It keeps clearance (4.5 m over a road) and its approaches stay within grade.
   - A `tunnel` edge runs below the ground and is not clamped.
   - Piers are never placed on a road below.
7. **No banking** on town streets (unset = null). Superelevation is a cubic along `s` (OpenDRIVE), only where set.

### 9. Clamp (`core.geometry.networks.clamp`, `core.geometry.landform.compose.ground`)

- **Under the surface (its cells, any level):** `ground = min(ground, road − below)`. Beside it, level with the kerb's foot for 4 m, then back on a batter. Behind a tunnel's portal, 6 m cut back so its mouth is open.
  - A min-clamp only lowers. Coarse terrain levels interpolate between clamped vertices, so they stay below the road too (prototype).
  - `below` grows with the terrain cell size and the grade (prototype: `0.3 m + grade × cell × 1.6`).
- **Within one terrain cell of any footprint:** never above it (the guard).
- **Ground parts** (verge, nature strip, footpath): the ground *is* the solved section there; it is set, not just lowered.
- **Outside the reserve:** blend back to the natural ground over `blend`, with a smoothstep (game-engine landscape splines use a cosine falloff).
- If the blend needs a slope steeper than the batter limit, make a wall.
- Decks never shape the ground.
- The clamp is **recomputed, never baked.** Moving a road leaves no scar (law 11).

### 10. Markings (Earth: `modules.world.earth.presets.built.roads.markings`)

- **From the lane parts, not invented.**
  - Local access streets carry no lines (VPA: "lanes unmarked").
  - Collectors and up get a broken dividing line: 3 m line, 9 m gap, 0.1 m wide (AS 1742.2).
  - Lane lines from the lane count.
  - Bike lane lines from `cycleway=lane`.
- **Junction lines.**
  - Stop line 0.3 m at stop signs and signals.
  - Give-way line 0.3 m wide, 0.6 m on and 0.6 m off.
  - Zebra bars 0.6 m with 0.6 m gaps, only where tagged.
  - Each sits at its arm's cut line.
  - Lines stop in the junction zones (where two or more buffers overlap); a dash never runs into one.
- **Drawn from (s, u), not stored.** The road surface carries `s` and `u` in metres (two UV sets: along and across). A dash is `fract(s / period) < on / period` within `|u − u₀| < width / 2`.
  - Lines are antialiased with screen-space derivatives. They fade to asphalt when thinner than a pixel, so they never shimmer and switch off without a pop (law 3).
  - Stop and give-way lines and crossings sit at a junction zone's edge.
  - Written in WGSL and GLSL alike.
  - Markings cost a shader feature only when set (law 13).

### 11. What goes near roads (`core.geometry.landform.compose.exclusion`, `core.geometry.zones.rules.scatter`, `.frontage`)

The **footprint** is each level's surface (carriageways, junctions, kerbs). The **reserve** is the footprint plus the verges and footpaths out to the property boundary, with the corner splays. Both are masks that every placing system subtracts (PCG Difference, City Sample, EasyRoads3D tree removal).

**Trees never stand on a road.**
- No tree trunk inside the footprint or on a footpath. Test the trunk point with its radius plus a margin.
- A *measured* tree that lands on the carriageway, a kerb, a footpath or a building is moved onto the nature strip if there is some within 2.5 m (an offset error), or else dropped, and reported. It is never drawn in the traffic. Baked: resolved once against the final surfaces (`tools.compile.steps.street`).
- **Houses stand behind the property line.** A house reaching into the reserve is moved back out of it (3 m at most, else reported); its fence stands on the property line before it.
- *Generated* street trees go in the nature strip:
  - centred between the footpath and the back of kerb;
  - every 8 to 12 m by size, or one per lot;
  - at least 8 m from a T-intersection kerb line, 6 m from a pole, 3 m from a driveway or hydrant (IDM).
- Crowns may overhang the road above 4.5 m (IDM pruning height).

**Poles and houses respect the reserve.**
- Light and power poles stand 0.8 m behind the back of kerb (Code of Practice). Never on the footpath, never in a kerb return, never on a crossing.
- Houses, fences and bins stand behind the property boundary.
- A *measured* building that crosses the boundary keeps its place (law 10). The footpath narrows there, and it is reported.
- Frontage (`zones.rules.frontage`, `modules.world.earth.presets.built.buildings.frontage`) reads the boundary. Lots face the road. One driveway per lot, at least 6 m from an intersection (IDM).

### 12. Detail by observation (`core.runtime.observation.detail`, `modules.world.surface.street-detail`)

Detail is chosen by **pixel error** (laws 1 and 2). A part appears when its smallest feature covers about a pixel:

| level | when (roughly) | what is built |
|---|---|---|
| far | a pixel covers more than about 3 m | **a ribbon** per edge: carriageway width, colour by class. No junction solve: bigger classes drawn over smaller, as today, because the overlap is below a pixel. |
| middle | about 0.3 to 3 m | **sections and junctions, flat:** carriageway, nature strip, footpath as bands; junctions as part of the surface, corner bands as polygons; kerbs as a colour band; no markings. |
| near | under about 0.3 m | **everything:** swept kerb profiles and returns, ramps, crossings, markings, poles, street trees in their spots. |

- Switches cross-fade or dither (law 3).
- The ribbon stays until the near tile is built (law 4).
- Built per street-detail tile, in workers, nearest first, a few milliseconds a frame.
- **Tile ownership is deterministic.** A junction belongs to the tile holding its centre. An edge cut by a tile border is cut at the same `s` on both sides, so the halves meet.
- Every layer reports what it has built and why (law 12, the observation panel).

### The rules

1. **Law 13: a road with only a width costs only a ribbon.** `section({ width })` alone builds one ribbon: no junction solve, no clamp, no kerb, no markings, no mask, no shader feature. Each setting adds only its own cost:

   | you set | you pay for |
   |---|---|
   | `junctions` | the surface: union, corners closed, zones (step 6) |
   | kerb parts | the swept kerb profiles |
   | `solve` | the height fit (step 8) |
   | `clamp` | the terraform and its recompute (step 9) |
   | `markings` | one shader feature (step 10) |
   | `keepOut` | the reserve mask (step 11) |

   The Earth preset sets them all, so the preset pays, and you can unset any.
2. **Trees never on a road.** Measured trees are moved to the verge or dropped, and reported. Generated ones go only in the nature strip.
3. **Poles and houses respect the reserve.** Poles 0.8 m behind the kerb. Houses behind the boundary. Measured data is never moved; the generated part gives way.
4. **Detail by observation.** Far = ribbon; near = sections + junctions. By pixel error, never by a private distance.
5. **Measured beats generated.** Real surface polygons beat tags, tags beat reserve casts, and reserve casts beat defaults, per edge (law 10).
6. **Paint only what is there.** No lines on local streets; crossings only where the data marks them.
7. **Report, don't patch.** An outline that crosses itself, a sliver, a kerb across a road, two levels z-fighting, a non-planar junction zone, a grade over the limit, a bridge under 4.5 m, a building in the reserve, a tree on the road, a collapsed edge: each goes to telemetry with its ids (law 12).
8. **Stable under edits.** Everything is a function of data, parameters and ids. An edit dirties only:
   - the changed edges;
   - their end junctions;
   - the arms within a cut-back of them;
   - their clamp footprint.

   Authored changes are diffs keyed by OSM id, kept apart from the raw data (laws 6, 11).
9. **WebGPU and WebGL2 alike.** The same meshes; the marking shader written in WGSL and GLSL and checked as twins.

### Default profiles: Victoria (`modules.world.earth.presets.built.roads`)

Defaults only: measured data and tags win. Carriageway is invert to invert (line of kerb). The verge is the back of kerb to the boundary. Divided roads in OSM are two one-way ways, so a median comes from the geometry (step 3.2), not from the profile.

| OSM `highway` | Victorian type | reserve | carriageway | kerb | nature strip (each side) | footpath (each side) | lines | source |
|---|---|---|---|---|---|---|---|---|
| `residential`, `unclassified` | access street | 16.0 m | 7.3 m, 2 lanes | B2 (or SM2) | about 2.65 m | 1.5 m, 0.05 m off the boundary | none | IDM Table 2, SD605; Clause 56 Table C1 |
| `living_street`, `service` (lanes) | access lane | 5.5 to 10 m | 5.5 m | none or M1 | 0 | none (shared) | none | IDM, Clause 56; Hoddle little streets 10 m |
| `tertiary` | connector L1 | 24.0 m | 11.6 m: 2 lanes + parking both sides | B2 | about 3 m | 2.5 m shared path, 0.5 m off the boundary | broken dividing line | IDM Table 2, SD605 |
| `secondary` | connector | 26 m | per direction 2.3 parking + 1.7 bike + 3.5 lane | B2 | 3.5 m | 1.5 m | dividing line, bike lane lines | VPA note |
| `primary` | secondary arterial | 34 m | per direction 2 × 3.5 m lanes + 2.0 m bike lane; 6 m median when divided | B2 | verge 5 m with a 3.0 m shared path | (shared path) | lane lines | VPA note |
| `trunk` | primary arterial | 41 m | per direction 3 × 3.5 m lanes; 6 m median when divided | B2 | 6.5 m clear zone | per authority | lane lines | VPA note |
| `motorway` | freeway | per authority | lanes × 3.5 m + shoulders | none (edge lines, barriers) | — | none | lane and edge lines | lane width not from a Victorian source |
| central city | Hoddle Grid | 30 m main, 10 m little streets | from City of Melbourne surface polygons | bluestone: kerb 0.30 m + channel 0.25 m, face 0.15 m | from data | from data | from data | Hoddle Grid; CoM Design Standard 301.01 |

**Kerbs** (IDM SD100), as swept profiles:

| profile | overall width | channel | face height |
|---|---|---|---|
| B2 barrier | 0.45 m | 0.30 m | 0.15 m |
| SM2 semi-mountable | 0.60 m | 0.30 m | 0.125 m |
| M1 mountable | 0.30 m | — | 0.05 m |

**Corners:**
- Kerb return radius: residential 7.5 m, collector 12.5 m, arterial 15.0 m (IDM §12.5.6).
- Property splay: 3 × 3 m, or 5 × 5 m with a collector or arterial (Clause 56 C20).

**Falls:**
- Carriageway crown 3%.
- Footpath 1:50 (at most 1:40).
- Verge at most 1:10.
- Grade 0.5% to 10% desirable, 20% at most (IDM).

**In the verge** (Code of Practice 2016, IDM SD630):
- footpath 0.05 m off the boundary;
- trees centred between the footpath and the kerb;
- light poles 0.8 m behind the back of kerb.

**City of Monash** (Clayton) builds 1.4 m footpaths (drawing C01). That is today's aslnut number, kept as a council override.

**Open data that replaces the defaults (all CC BY 4.0):**
- Vicmap Property road casements give the reserve; parcels give the boundary.
- City of Melbourne "road segments with surface type" gives the real carriageway, kerb, channel, footway, nature strip and median polygons.
- City of Melbourne footpaths, property boundaries and trees.
- Vicmap Transport road lines carry no widths.
- Each source keeps its licence and credit ([licences](licences.md)).

```ts
// [planned] the steps above, as settings (names are a draft)
const roads = network.from(osm.roads, { snap: 1 });
roads.sections(e => profiles.victoria(e.props));          // step 4: tags → reserve → defaults
roads.junctions({ radius: (a, b) => Math.min(a.radius, b.radius), crossings: 'data' }); // step 6
roads.clamp({ blend: 4, keepOut: true });                  // steps 9 and 11
// unset any of them and it costs nothing: roads.sections(e => section({ width: e.props.width }))  → a ribbon
```
