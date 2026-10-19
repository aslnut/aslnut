# baker: design

A road baker in Rust. It reads the same inputs as the TypeScript roads compile (`packages/aslnut/tools/compile`) and
writes the same pack, so aslnut reads its output unchanged. Where the TypeScript compile buffers each layer from the
map's lines and then cuts the layers against each other, this baker **designs** the street from the lines (curves,
cross-sections, junction patterns), assembles **one planar partition** in which neighbours share their edges, and
takes every height from the design.

Tree leaves this touches (the one tree, `packages/aslnut/docs/_tree/spec.txt`): `tools.bake`, and alongside the
TypeScript compile's `tools.compile.steps.solve`, `tools.compile.steps.resolve`, `tools.compile.steps.mesh`. No new
leaves.

## 1. Inputs (read only)

From one folder (the dataset's `packs/roads/`), for a place `<p>`:

| file | what the baker takes |
|---|---|
| `<p>.geojson` | `LineString` ways: `properties.nodes` (OSM node ids, one per point), `osm_id`, every tag (`highway`, `name`, `lanes`, `width`, `oneway`, `junction`, `layer`, `bridge`, `tunnel`, `sidewalk*`); `Point` features: `highway` (`crossing`, `traffic_signals`, `stop`, `give_way`), `crossing`, `crossing:markings`, `osm_node`. Also `bbox` and `attribution`. |
| `<p>.ground.json` + `<p>.ground.f32` | the ground grid: `origin {lon, lat}` (the place's origin), `x0, z0, step, nx, nz`, `source`; the `.f32` is `nx * nz` little-endian floats, row by row (z), metres over the sea |
| `<p>.reserve.geojson` | road reserve polygons (property-line seeds), where the place has them |
| `<p>.paths.geojson` | mapped paths and sidewalks (counted; non-sidewalk paths go to the walking graph) |
| `<p>.water.geojson` | read; not drawn in this milestone |

Place metres: `x = (lon - lon0) * 111320 cos(lat0)`, `z = -(lat - lat0) * 110574` (x east, z south), as the
TypeScript compile and `baked.ts` use. The design stays inside the ground grid less `frame_margin` (30 m).

## 2. The pack (the contract)

Written to `<out>/<p>/`, byte-for-byte the layout of `packages/aslnut/src/core/data/loading/chunks/write.ts`:

- **`index.json`** `{ v: 2, size: 500, origin: [lon, lat], bbox, kinds: [string], tiles: [[ix, iz]], attribution,
  sources: { name: { title, licence, url } }, report }`. `report` has the TypeScript `SolveReport` fields the viewer
  and `tools/roads.mjs` read (`roads, levels, zones, planar, islands, holes, invalid, slivers, kerbLength,
  kerbOutside, kerbCrossings, zfight, area, reserveFrom, footpathArea, vergeArea, crossings, vergeOverlap,
  vergeSlivers, steep, clearance, walk`) and `stages`: fifteen records `{ stage, id, name, ok, counts, worst, flagged,
  errors, patches, checks: [{ check, policy: repair|omit|stop, algorithm, ok }] }`. Stages 1 to 11 are this baker's
  (§4); 12 to 15 are carried from the pack whose `built/` is copied.
- **`<ix>_<iz>.json`** (one per 500 m tile from the origin) `{ v: 3, ix, iz, size: 500, infos: [{ kind, props }],
  numericScale: 100, turnUnits: 10, numeric: [row] }`. Each piece is in the tile of the mean of its points; its points
  are metres from the tile's corner. Rows (before encoding):
  - strip `[0, kind, info, edges, n, x, z, h …]` (lines side by side, as many points each: quads between
    neighbours; here a street's carriageway half or a verge band from station to station)
  - area `[4, kind, info, down, rings, n0, n1 …, x, z, h …]` (the outline, then holes; heights per point)
  - poly `[1, kind, info, fan, n, x, z, h …]` (markings)
  - edge `[5, kind, info, n, x, z, h, ground, dx, dz …]` (`dx, dz`: inward across the kerb, into the road)
  - (wall `2`, box `3`: not written by this milestone)
- **`clamp.json`** `{ v: 3, terrain: 'terrain.json', origin, size: 500, tiles }` and **`clamp/<ix>_<iz>.json`**
  `{ v: 4, numericScale: 100, numericCells: [[rings, n.., x, z, h ..]], numericEdges: [[x, z, h ..]] }` in place
  metres, a piece in every tile its box (and 20 m round it) touches; an edge in pieces of about 50 m.
- **`terrain.json`** `{ x0, z0, step, nx, nz, numeric: [the grid as one row] }`: the ground conformed to the design.
- **`walk.json`** `{ v: 1, origin, lines: [[kind, x, z, …]] }` (`footpath`, `crossing`, `link`, `path`).
- **`built/`**: copied from an existing pack (buildings, trees, furniture: stages 12 to 15 are out of scope).
- Every `.json` has a gzipped `.json.gz` beside it (a static host such as `packages/aslnut/tools/serve.mjs` serves it when asked).

**Numbers** (`numbers.ts`): each value rounded to 2 decimals as JavaScript does (`Math.round`, halves up), times the
scale, delta-coded in three interleaved channels (index mod 3), zigzag, base-128 varints, base64 (with padding). The
Rust codec is tested against the TypeScript encoder's bytes.

**Kinds** drawn by `bakedMesh` and their meaning here: `carriageway` (strip or area), `footpath` (strip or area),
`verge` (strip or area: nature strip, the gap to the property line, islands and medians), `kerb` and `ramp` (edge: the
kerb's top 150 mm / a ramp's lip 20 mm over the edge's height, drawn from the outline 0.45 m in; in a ramp's flare the
kerb's points are set down so its top comes down to the lip), `edge` (edge: the property line's skirt), `marking`
(poly, 35 mm over the road). Infos: `road` (one per street: `name, highway, lanes, carriageway (m), oneway, layer,
osm, source`; one per junction: `what: 'junction'`), `footpath`, `nature strip` (`what`: nature strip, island,
property line).

## 3. How aslnut reads it

- `src/modules/world/earth/presets/built/roads/baked.ts`: `bakedRoads({ url: …/index.json })` streams the tiles
  (`StreetDetail`), `decodeTile` decodes `numeric`, `bakedMesh` triangulates: area rings by earcut at their own
  heights, edges into the kerb's top, face and skirt (by kind), polys by earcut. `bakedPieces` decodes the same rows
  for checks. `bakedStands` makes the surfaces stood on.
- `clampTerrain(base, …/clamp.json)`: where `terrain.json` covers, it **replaces** the base heights (bilinear), then
  lowers (never raises) the ground under each clamp cell (`surface - 0.35`) and beside each clamp edge (level with it
  for 4 m, then a 1 : 2 batter).
- `examples/roads/main.ts` (`?go=roads` is Clayton, `?go=roads-street` the healthy city's street level) loads
  `/aslnut/data/packs/roads/<p>/index.json`, `<p>.ground` (the place's grid), the clamp and `built/index.json`.
- `tools/roads.mjs` checks the report's fields and stages, then views each place on WebGPU and WebGL2.

To view a private pack unchanged, `tools/frames.mjs` answers the browser's requests for
`/aslnut/data/packs/roads/<p>/…` from the pack folder under test (Playwright routing); nothing in aslnut changes.

## 4. Stages and modules

| stage | module | what it does |
|---|---|---|
| 1 seed | `seed.rs` | the files above, read only; place metres |
| 2 clean | `clean.rs` | ways split at shared nodes; duplicate points merged (`merge_distance`); zigzags dropped (`zigzag_angle`, `zigzag_leg`); a dead end just short of another node joined to it (`snap_distance`); ways that go on through a two-way node (same name, class, lanes, width, one-way, junction) chained into one street. Bridges, tunnels and other levels are left out (listed) |
| 3 fair | `curve.rs` | each street's line as straights and circular arcs, tangent to tangent: at each vertex the largest arc within `fair_tolerance` of it and within half of each neighbouring straight (`fair`) |
| 4 sections | `sections.rs` | one cross-section per street from its tags and the rules: lanes, half width (the TypeScript profile's widths), kerb band 0.45 m inside the outline; each side's verge: nature strip, footpath (tags: `sidewalk*`), gap to the property line. The property line's distance is measured from the reserve data where it says enough (median of rays), else the rules |
| 5 junctions | `junctions.rs` | the street graph's faces (blocks, islands, medians); at every corner of every face a pattern: **kerb return** (an arc tangent to both kerbs, radius by class), **nose** (small radius: arms leaving together, or any corner of an island or median), **cap** (a dead end's half circle), **join** (round the outside of a bend), **taper** (a change of width), **sharp** (fallback). Corners meeting along a short side are shrunk, then merged (that street taken into the junction). Arms are cut past their corners; streets whose cuts meet join one junction (a cluster). Crossings: mapped ones (moved out of junctions) and one at each kerbed arm of a junction of three or more arms, each with a kerb ramp at both kerbs and a link across the nature strip |
| 6 partition | `partition.rs`, `arrangement.rs` | one planar partition per 500 m tile (§5) |
| 7 heights | `heights.rs` | profiles, coupling, junction planes, crossfall, kerb, verges (§6) |
| 8 mesh | `mesh.rs` | the faces as area pieces at their design heights; kerbs and ramps along the kerb loops; property lines; markings; the walking graph; the clamp; the conformed ground |
| 9 gates | `gates.rs` (in the bake), `gates/measure.ts` (old against new) | §7 |
| write | `pack.rs`, `walk.rs` | §2 |

`lib.rs` runs them in order and records each stage; `main.rs` is the command line. The library does no file or
clock work, so it builds for `wasm32-unknown-unknown` (`--no-default-features`) for a later in-browser studio: its
door is three exports (`alloc`, `bake_bundle`, `out_len`; a bundle of named files in, the pack's files out), run from
Node by `tools/wasm-bake.mjs`. The command line (`native` feature) uses every core (rayon). A bake is the same every
run (ordered joins; parallel maps keep their order); the browser's build gives the same tiles but where its own
trigonometry rounds a point to the other centimetre.

The walking graph (`walk.rs`) joins its lines as the TypeScript bake's `walkGraph` does: every line cut where it
crosses another, every end within 3 m of another line joined to it, points to the centimetre (aslnut's
`network({ lines, snap: 0.05 })` joins them exactly).

## 5. The data model

- **Curve** (`curve.rs`): `Prim::Line` and `Prim::Arc { c, r, a0, sweep }`, G1. `offset(s, u)` is exact (a straight's
  parallel, an arc's concentric arc, never past its centre); `stations(s0, s1, u, tol, step)` draws an offset within
  a chord tolerance; `project(p)`.
- **Street** (`junctions.rs`): the cleaned link (its ways, tags, class, one-way), its curve and reversed curve, its
  `Section { lanes, half, outer, kerbed, sides: [Side { verge, strip, footpath, gap }; 2] }`.
- **Arm**: a street's end at a node (`ArmRef { link, end }`), outward along its curve; arms round a node by angle.
- **Face**: half-edges with the face on their left; `corners[k]` sits after half-edge `k`. `island` (small, shallow,
  or a median between one-way carriageways), `outside` (the unbounded face).
- **Corner** `{ a, b, ta, tb, kind, r, centre, pts: [(point, normal into the face)] }`: from arm A's kerb (A's right)
  to arm B's (B's left); `ta, tb` the tangent stations.
- **Kerb loop**: per face, its sides (each street side's exact kerb offset between its corners, with every cut and
  ramp edge as a vertex) and corners in turn; each vertex has its normal into the face, the verge bands there (sides:
  the street's; corners: blended between the two arms'), what its road height comes from (`RoadRef`: a street at
  `(s, u)` or a junction cluster), and what it is concentric round.
- **Cluster**: the nodes of one junction; **ribbon**: a street's own carriageway between its two cut stations.
- **Stations**: one set per street, for both its kerbs and its crown: its arcs' (within the chord tolerance on the
  band's outer edge), the ones its heights need (where the surface stops being straight within
  `vertical_tolerance`), its cuts and its ramps' edges and flares; at most `max_segment`, at least `least_station`
  apart. A piece of carriageway or verge between two stations is a quad: no triangle of the device's ear clipping
  can span past a station and cut a chord under the surface.
- **Partition**: an arrangement in whole millimetres (`arrangement.rs`): segments split where they cross or pass
  within a millimetre of a point (snap rounding), half-edges sorted round each vertex, faces as cycles, holes in
  their smallest enclosing face. Each face is labelled (`partition.rs`): which kerb loop's face it is in (the nearest
  kerb segment, which side), how deep (band), or which street's ribbon side or which junction (the road); and which
  piece along its street it is in (its station interval, or its kerb segment). Faces with one label and one piece are
  one; a face under `scrap_area` or thinner than 0.2 m joins the neighbour it shares most edge with (never left as a
  hole). Points the arrangement made that a line does not need (within 1 cm) are left out on both sides at once.
  Runs of four-cornered pieces along a street are written as strips.

The arrangement's lines: kerb loops, cuts, crowns, a cut straight across each carriageway at each station, band lines
(each kerb loop moved into its face by the strip, the strip and footpath, and the whole verge: concentric round
corners, the two sides' offsets carried to where they meet past a corner's radius), a radial across the verge at
each station (across an island or median, to its other kerb), ramp links, the frame and the tile's edge. A band line
or a radial is kept only where it is truly that deep into its own face (past a narrow face's middle it is not).

## 6. Heights

- **Profiles**: the ground along each street's curve every 2 m, Gaussian-smoothed by class (`profile_sigma`), ends
  brought to their nodes' mean height, held to `max_grade`.
- **Coupling**: a street running beside a greater one with no room between their carriageways (a service road along
  an arterial, a slip lane) is taken to the greater street's gutter there; a divided road's second carriageway is
  taken level with its first across the median; blended in and out over 15 m.
- **Junctions**: one plane per cluster through its arms' cut sections and 4 m into each arm (slope at most 12 %);
  clusters whose surfaces touch share one plane. Each arm blends into its plane over `junction_blend` (at most half
  its carriageway), so a cut line has one height from both sides.
- **Across a street**: crown and `crossfall` (2.5 %) to each gutter.
- **One height per point**: a carriageway point shared by pieces of different streets or junctions (where they touch
  with no cut between) takes their mean; on a tile's edge the same from both tiles. No crack can open.
- **Kerb** 150 mm, **ramp lip** 20 mm (the edge pieces), down to the lip over a 1 : 10 flare each side of a ramp;
  **islands and medians** at their kerbs' tops (each point
  between the nearest kerb top and the one on the other side, weighted by distance: a face spans kerb top to kerb top
  and nothing in it rises over them); **verges** rise from the kerb's top by `verge_slope` (2.5 %) to the property
  line; **the ground follows the design**: `terrain.json` is the grid set just under the carriageways (0.35 m) and
  verges (0.12 m), and in the lots blended from the property line's height back to its own over a batter
  (a `boundary_shoulder` level with it, then `batter_reach`, at least twice the difference). The clamp lowers
  whatever is left: the carriageway's cells (each strip run's outline, each junction area), the kerb lines at the
  kerb's top (beside the road the ground is held level with it, under the verge that rises from there), the property
  lines at the verge's edge (each line no steeper than its own grade allows: a jump in it would make the device's
  guard lower the ground all round it).

## 7. Gates (one per defect group)

Measured twice: in the bake (`gates.rs`, stage 9, on the pieces as made; a check with its policy) and on the written
pack by `gates/measure.ts`, which reads any pack as aslnut does (`bakedPieces`, facets as drawn, the clamp over the
pack's ground) after the read-only investigation's scripts, so the old pack and the new one are measured by one code.
`gates/run.sh` measures against a snapshot of main's aslnut (`ASLNUT_SRC`, default `out/main-ref`: `git archive
main packages/aslnut | tar -x -C packages/baker/out/main-ref`):

| group | measured as | the design that answers it |
|---|---|---|
| B islands and medians | verge pieces with most of their outline on a kerb's inner line; their drawn surface sampled every 0.5 m against the nearest kerb top (weighted with the one opposite): > 10 cm, > 30 cm | islands at kerb top; verges at a 2.5 % crossfall |
| C kerb jogs and folds | along every kerb and ramp edge: jogs (a short step between near-parallel kerb), spikes, folds (the kerb's top quad turned over), inner lines crossing | kerbs are exact offsets of G1 curves; returns are arcs |
| D scraps and slivers | rays from every kerb across the verge: bare ground between kerb and verge (m of kerb); footpath bits under 25 m² | one partition: no opening, no deletion; scraps joined to a neighbour |
| E bites | rays from every kerb: footpath under 1 m wide (m of kerb) | the footpath is a band of the street's section, wrapping corners concentrically |
| F pits and walls | footpath facets (as drawn) steeper than 1 : 4; the property line's skirt standing > 0.5 m over the device's ground beyond | verge crossfall; ground conformed to the property line |
| G seams | carriageway piece boundaries inside the road: a gap > 2 mm or a step > 1 cm (m) | shared vertices; one height per point |
| H dashes in junctions | lane dashes (0.8 to 3.1 m, under 0.2 m wide) lying across another road's carriageway at > 25 degrees | paint only between a street's own cuts |
| I zebras without ramps | zebra stripe groups with a kerb ramp within 2.5 m of each end | every crossing designed with a ramp at both kerbs |

A failed check's policy is in the stage record: `repair` (the algorithm named), `omit` (left out, listed), or `stop`.

## 8. Rules

`rules.rs` holds every number with its default; `baker --print-rules` prints them as JSON; `--rules my.json`
overrides any subset (merged field by field). Classes by OSM `highway` (`classes`), lane widths, kerb width and
height, ramp width and lip, kerbed and verged classes, verge, footpath and gap widths by class, corner radius by
class, nose radius and angle, island depth and area, the least island (smaller is road), median width, least band,
crossfall, junction blend, verge slope, ramp flare, fairing tolerance and largest radius, chord tolerance, longest
and least station spacing, vertical tolerance, profile smoothing and steepest grade by class, scrap area, marking
lift, dash, gap and width, painted classes, cleaning distances and angles, frame margin, batter reach, shoulder.

## 9. Not in this milestone

Bridges, tunnels and other levels (left out, listed); transition curves (clothoids; arcs only now); a kit of repeated
pieces (instancing); water; stages 12 to 15 (copied); the TypeScript compile's stage snapshots (`roads-stages/`).
