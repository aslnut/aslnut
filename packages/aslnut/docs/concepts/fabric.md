# The fabric: what a world is made of

> Draft under discussion. Interface and structure only.

**In one line:** a world = a **body** + a **fabric** + **rules** + **fields** + **sky and time** + **entities**. Roads and rivers are fabric, not entities: the fabric gives entities their places and their constraints.

## Why

- **One picture of a world.** A city, a valley or a game level all split the same way, so the same tools serve them.
- **Edit little, get a lot.** A road's centreline makes its surface, its sidewalks, its bridges, the ground under it, the lanes cars drive on and the walkways people use.
- **Things know where they may go.** A train can only follow a rail; a car stays in its lane; a person walks wherever the ground is walkable.

## The parts

```tree
world/
├── body          terrain, terraform, water level
├── fabric/
│   ├── networks  roads, rivers and channels, rail, ways (graphs of lines)
│   ├── areas     zones, biomes, regions
│   └── structures  made from them: bridges, piers, culverts, decks
├── rules         fabric → entities (scatter, frontage, your own)
├── fields        weather, wind, fog, rain, light, heat, air, water flow
├── sky and time
└── entities      places and things (see entities)
```

| part | plain meaning | where |
|---|---|---|
| body | the ground itself: the terrain, your terraform edits, the water level | [world and body](world-and-body.md) |
| networks | lines joined into graphs; each edge carries a cross-section (lanes, curbs, sidewalks, talud = an embankment slope) | [geometry › networks](../reference/core/geometry.md#networks-analysis-graph) |
| areas | zones of a kind (block, residential, lot, park…), biomes, regions | [geometry › zones](../reference/core/geometry.md#zones-kinds) · [regions](../reference/core/space.md) |
| structures | made from the network, never drawn by hand: a bridge where a road crosses a river, piers under a deck, a culvert where a channel passes under | [geometry › structures](../reference/core/geometry.md#networks-structures) |
| rules | turn fabric into entities: scatter trees in a park, put buildings along a block's frontage | [geometry › zones › rules](../reference/core/geometry.md#zones-rules) |
| fields | values spread over space and time | [physics](physics.md) |

## The rules

1. **The fabric gives entities their constraints.** Lanes → `lanes` locomotion; rails → `rail`; ways and walkable ground → `surface` ([entities](entities.md)).
2. **Zones + rules decide placement.** A zone has a kind; a rule for that kind places things in it. Change the zone, and only its things are placed again.
3. **The clamp shapes the ground.** The ground is pushed just below a network's surface and blended back, and nothing is scattered or placed on it.
4. **Graph fields live on network edges:** flow in a channel, load on a road, pressure in a pipe ([physics](physics.md)).
5. **Junctions are platforms** where edges meet: one surface, the sections' parts joined round the corners.
6. **Edit the fabric and the rules, never the output.** Edits are saved as diffs over the source data ([kits › authoring](../reference/kits/authoring.md)).

## Examples

```ts
// [planned] a city's roads as fabric: sections, junctions, structures, the clamp
const roads = network.from(osm.roads, { snap: 1 });
roads.sections(e => section([walk(2), curb(.15), lane(3.2), lane(3.2), curb(.15), walk(2)]));
roads.junctions({ radius: 6 });
roads.structures(e => (e.props.bridge ? { kind: 'bridge' } : null));
roads.clamp({ blend: 4 });

// [planned] zones + rules → entities
const city = zones.from(landuse, { kind: d => d.props.landuse });
w.add(zones.apply(city, [
  zones.rule('park', z => zones.scatter(z, { density: 40, shape: trees.mixed })),
  zones.rule('residential', z => zones.frontage(z, roads, { depth: 12 })),
]));

// [planned] the fabric binds entities: a minibus on the lanes, a walker on the walkable ground
w.add(entity({ kind: 'minibus', shape: minibuses.make(), locomotion: lanes({ on: roads.lanes(), path: route }) }));
w.add(entity({ kind: 'person', shape: humans.make(), locomotion: surface({ on: 'walkable' }) }));
```

## How it relates

- **[Networks](networks.md):** routing, reach, lanes and walkways on the same graphs.
- **[Entities](entities.md):** places and things; locomotion reads the fabric.
- **[World and body](world-and-body.md):** the body the fabric lies on.
- **[Physics](physics.md):** fields, including graph fields on edges.
- **[Compile](compile.md):** the fabric is solved and meshed ahead of time; phones stream the result.

## Common mistakes

- **Making a road an entity.** A road is fabric; the cars on it are entities.
- **Editing the generated mesh.** It is rebuilt from the fabric; edit the road, the zone or the rule.
- **Placing trees by hand in a park.** Give the park a kind and a rule.

## Status

| part | status |
|---|---|
| everything on this page | [planned] in aslnut |
| road solve, sections, junctions, lanes, walkways | a reference implementation exists |
