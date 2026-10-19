# aslnut: the one tree and its status

> **Generated. Do not edit by hand.** The single source is `packages/aslnut/docs/_tree/spec.txt`.
> After any status change: edit spec.txt → `python3 packages/aslnut/docs/_tree/gen.py` (from `packages/aslnut/docs`) → `node packages/aslnut/docs/_tree/status.mjs` → commit both.

**Statuses:** built (in `packages/aslnut`, tested on WebGPU and WebGL2) · partly (some of it there) · planned · proposed · open.
**Done:** built = 1, partly = ½.

- **Checkpoint 1 · the healthy-city twin (regions, walking, sun and shadows, heat): 99% (153 built, 3 partly / 156)**
- **Checkpoint 2 · the city at night in rain (a game: streets, traffic, people, lights, weather): 69% (145 built, 19 partly / 225)**
- **Checkpoint 3 · the riverfront city core (quays, outdoor stairs and terraces, bridges, a station; built from scans and data): 72% (125 built, 9 partly / 181)**
- **Overall (every part): 47% (238 built, 37 partly / 545)** · built 238 · partly 37 · planned 225 · proposed 45 · open 0.

## Checkpoints

A part is in a checkpoint when it is tagged `+N` in spec.txt (a tag on a group covers every leaf under it).

### Checkpoint 1 · the healthy-city twin (regions, walking, sun and shadows, heat)

Only the parts this checkpoint needs, to the leaves.

```
aslnut  99% (153 built, 3 partly / 156)
├── core  99% (114 built, 3 partly / 117)
│   ├── space  100% (2 built, 0 partly / 2)
│   │   └── regions  100% (2 built, 0 partly / 2)
│   │       ├── tree  built
│   │       └── rollup  built
│   ├── time  100% (3 built, 0 partly / 3)
│   │   ├── clock  built
│   │   ├── step  built
│   │   └── zones  built
│   ├── data  100% (18 built, 0 partly / 18)
│   │   ├── sources  100% (4 built, 0 partly / 4)
│   │   │   ├── tiles  100% (1 built, 0 partly / 1)
│   │   │   │   └── xyz  built
│   │   │   ├── files  100% (2 built, 0 partly / 2)
│   │   │   │   ├── geojson  built
│   │   │   │   └── csv  built
│   │   │   └── custom  built
│   │   ├── loading  100% (5 built, 0 partly / 5)
│   │   │   ├── loader  built
│   │   │   ├── stores  built
│   │   │   ├── packs  built
│   │   │   ├── readiness  built
│   │   │   └── tiles  built
│   │   ├── features  100% (2 built, 0 partly / 2)
│   │   │   ├── features  built
│   │   │   └── rows  built
│   │   ├── query  100% (2 built, 0 partly / 2)
│   │   │   ├── join  built
│   │   │   └── query  built
│   │   ├── scenarios  100% (4 built, 0 partly / 4)
│   │   │   ├── base  built
│   │   │   ├── variant  built
│   │   │   ├── diff  built
│   │   │   └── compare  built
│   │   └── rights  100% (1 built, 0 partly / 1)
│   │       └── attribution  built
│   ├── observation  100% (5 built, 0 partly / 5)
│   │   ├── observers  100% (4 built, 0 partly / 4)
│   │   │   └── orbit  100% (4 built, 0 partly / 4)
│   │   │       ├── views  built
│   │   │       ├── keys  built
│   │   │       ├── speed  100% (1 built, 0 partly / 1)
│   │   │       │   └── easing  built
│   │   │       └── follow  built
│   │   └── presence  built
│   ├── geometry  95% (25 built, 3 partly / 28)
│   │   ├── shapes  100% (20 built, 0 partly / 20)
│   │   │   ├── shape  built
│   │   │   ├── builder  100% (6 built, 0 partly / 6)
│   │   │   │   ├── solid  built
│   │   │   │   ├── extrude  built
│   │   │   │   ├── lathe  built
│   │   │   │   ├── sweep  built
│   │   │   │   ├── copy  built
│   │   │   │   └── scope  built
│   │   │   ├── parts  built
│   │   │   ├── levels  100% (6 built, 0 partly / 6)
│   │   │   │   ├── full  built
│   │   │   │   ├── simple  built
│   │   │   │   ├── box  built
│   │   │   │   ├── dot  built
│   │   │   │   ├── counted  built
│   │   │   │   └── impostor  built
│   │   │   ├── instances  built
│   │   │   ├── checks  built
│   │   │   └── recipes  100% (4 built, 0 partly / 4)
│   │   │       ├── branching  built
│   │   │       ├── kitbash  built
│   │   │       ├── presets  built
│   │   │       └── package  built
│   │   └── networks  81% (5 built, 3 partly / 8)
│   │       ├── analysis  100% (4 built, 0 partly / 4)
│   │       │   ├── graph  built
│   │       │   ├── routing  built
│   │       │   ├── isochrones  built
│   │       │   └── nearest  built
│   │       ├── walkways  built
│   │       ├── sections  partly
│   │       ├── junctions  partly
│   │       └── clamp  partly
│   ├── encoding  100% (9 built, 0 partly / 9)
│   │   ├── marks  100% (7 built, 0 partly / 7)
│   │   │   ├── symbols  100% (2 built, 0 partly / 2)
│   │   │   │   ├── point  built
│   │   │   │   └── text  built
│   │   │   ├── lines  100% (1 built, 0 partly / 1)
│   │   │   │   └── line  built
│   │   │   ├── areas  100% (3 built, 0 partly / 3)
│   │   │   │   ├── area  built
│   │   │   │   ├── extrusion  built
│   │   │   │   └── raster  built
│   │   │   └── drape  built
│   │   ├── scales  built
│   │   └── layers  100% (1 built, 0 partly / 1)
│   │       └── labels  built
│   ├── render  100% (21 built, 0 partly / 21)
│   │   ├── graphics  100% (9 built, 0 partly / 9)
│   │   │   ├── interface  built
│   │   │   ├── webgpu  built
│   │   │   ├── webgl2  built
│   │   │   ├── caps  built
│   │   │   ├── shaders  100% (4 built, 0 partly / 4)
│   │   │   │   ├── wgsl  built
│   │   │   │   ├── glsl  built
│   │   │   │   ├── translate  built
│   │   │   │   └── hooks  built
│   │   │   └── parity  built
│   │   ├── drawing  100% (4 built, 0 partly / 4)
│   │   │   ├── renderer  built
│   │   │   ├── instancing  built
│   │   │   ├── text  built
│   │   │   └── quality  built
│   │   ├── look  100% (2 built, 0 partly / 2)
│   │   │   ├── materials  built
│   │   │   └── shadows  built
│   │   ├── style  100% (1 built, 0 partly / 1)
│   │   │   └── ramp  built
│   │   ├── project  100% (1 built, 0 partly / 1)
│   │   │   └── project  built
│   │   └── reveal  100% (4 built, 0 partly / 4)
│   │       ├── modes  built
│   │       ├── timing  built
│   │       ├── define  built
│   │       └── policy  built
│   ├── interaction  100% (5 built, 0 partly / 5)
│   │   ├── picking  100% (2 built, 0 partly / 2)
│   │   │   ├── picking  built
│   │   │   └── hover  built
│   │   ├── events  built
│   │   ├── signals  100% (1 built, 0 partly / 1)
│   │   │   └── selection  built
│   │   └── controllers  built
│   ├── entities  100% (4 built, 0 partly / 4)
│   │   ├── placement  100% (1 built, 0 partly / 1)
│   │   │   └── thing  built
│   │   ├── locomotion  100% (2 built, 0 partly / 2)
│   │   │   ├── surface  built
│   │   │   └── air  built
│   │   └── drive  100% (1 built, 0 partly / 1)
│   │       └── player  built
│   ├── simulation  100% (6 built, 0 partly / 6)
│   │   ├── fields  100% (2 built, 0 partly / 2)
│   │   │   ├── raster  built
│   │   │   └── kernels  built
│   │   ├── rules  100% (1 built, 0 partly / 1)
│   │   │   └── presets  built
│   │   ├── measure  100% (1 built, 0 partly / 1)
│   │   │   └── probes  built
│   │   ├── constants  built
│   │   └── phenomena  100% (1 built, 0 partly / 1)
│   │       └── heat  built
│   ├── world  100% (9 built, 0 partly / 9)
│   │   ├── elements  100% (1 built, 0 partly / 1)
│   │   │   └── element  built
│   │   ├── settings  100% (2 built, 0 partly / 2)
│   │   │   ├── params  built
│   │   │   └── readouts  built
│   │   ├── state  100% (1 built, 0 partly / 1)
│   │   │   └── settled  built
│   │   ├── lifecycle  100% (3 built, 0 partly / 3)
│   │   │   ├── world  built
│   │   │   ├── errors  built
│   │   │   └── dispose  built
│   │   └── host  100% (2 built, 0 partly / 2)
│   │       ├── plain  built
│   │       └── package  built
│   └── runtime  100% (7 built, 0 partly / 7)
│       ├── detail  100% (2 built, 0 partly / 2)
│       │   ├── detail  built
│       │   └── prefetch  built
│       ├── budget  100% (3 built, 0 partly / 3)
│       │   ├── budget  built
│       │   ├── governor  built
│       │   └── memory  built
│       ├── workers  100% (1 built, 0 partly / 1)
│       │   └── workers  built
│       └── telemetry  100% (1 built, 0 partly / 1)
│           └── remote-log  built
├── modules  100% (30 built, 0 partly / 30)
│   ├── world  100% (28 built, 0 partly / 28)
│   │   ├── surface  100% (5 built, 0 partly / 5)
│   │   │   ├── tiles  built
│   │   │   ├── imagery  built
│   │   │   ├── terrain  built
│   │   │   ├── street-detail  built
│   │   │   └── sky  built
│   │   └── earth  100% (23 built, 0 partly / 23)
│   │       ├── body  100% (3 built, 0 partly / 3)
│   │       │   ├── earth  built
│   │       │   └── base  100% (2 built, 0 partly / 2)
│   │       │       ├── imagery  100% (1 built, 0 partly / 1)
│   │       │       │   └── esri  built
│   │       │       └── terrain  100% (1 built, 0 partly / 1)
│   │       │           └── mapzen  built
│   │       ├── air  100% (10 built, 0 partly / 10)
│   │       │   ├── atmosphere  100% (3 built, 0 partly / 3)
│   │       │   │   ├── scattering  built
│   │       │   │   ├── haze  built
│   │       │   │   └── clouds  built
│   │       │   ├── weather  100% (4 built, 0 partly / 4)
│   │       │   │   ├── presets  built
│   │       │   │   ├── wind  built
│   │       │   │   ├── rain  built
│   │       │   │   └── fog  built
│   │       │   └── sky  100% (3 built, 0 partly / 3)
│   │       │       ├── sun  built
│   │       │       ├── moon  built
│   │       │       └── stars  built
│   │       ├── water  100% (1 built, 0 partly / 1)
│   │       │   └── hydrology  100% (1 built, 0 partly / 1)
│   │       │       └── water  built
│   │       ├── climate  100% (1 built, 0 partly / 1)
│   │       │   └── heat  built
│   │       └── presets  100% (8 built, 0 partly / 8)
│   │           ├── built  100% (6 built, 0 partly / 6)
│   │           │   ├── roads  100% (3 built, 0 partly / 3)
│   │           │   │   ├── sections  built
│   │           │   │   ├── markings  built
│   │           │   │   └── sidewalks  built
│   │           │   └── buildings  100% (3 built, 0 partly / 3)
│   │           │       ├── footprints  built
│   │           │       ├── roofs  built
│   │           │       └── windows  built
│   │           └── living  100% (2 built, 0 partly / 2)
│   │               └── plants  100% (2 built, 0 partly / 2)
│   │                   ├── species  built
│   │                   └── canopy  built
│   └── presets  100% (2 built, 0 partly / 2)
│       ├── vehicles  100% (1 built, 0 partly / 1)
│       │   └── car  built
│       └── drones  built
├── kits  100% (4 built, 0 partly / 4)
│   ├── dashboard  100% (2 built, 0 partly / 2)
│   │   ├── legend  built
│   │   └── stats  built
│   └── game  100% (2 built, 0 partly / 2)
│       ├── avatars  built
│       └── collision  built
└── tools  100% (5 built, 0 partly / 5)
    └── checks  100% (5 built, 0 partly / 5)
        ├── smoke  built
        ├── parity  built
        ├── twins  built
        ├── regressions  built
        └── perf  built
```

### Checkpoint 2 · the city at night in rain (a game: streets, traffic, people, lights, weather)

Only the parts this checkpoint needs, to the leaves.

```
aslnut  69% (145 built, 19 partly / 225)
├── core  70% (100 built, 17 partly / 155)
│   ├── time  100% (3 built, 0 partly / 3)
│   │   ├── clock  built
│   │   ├── step  built
│   │   └── zones  built
│   ├── data  64% (13 built, 1 partly / 21)
│   │   ├── sources  100% (3 built, 0 partly / 3)
│   │   │   ├── tiles  100% (1 built, 0 partly / 1)
│   │   │   │   └── xyz  built
│   │   │   ├── files  100% (1 built, 0 partly / 1)
│   │   │   │   └── geojson  built
│   │   │   └── custom  built
│   │   ├── loading  42% (5 built, 1 partly / 13)
│   │   │   ├── loader  built
│   │   │   ├── stores  built
│   │   │   ├── packs  built
│   │   │   ├── readiness  built
│   │   │   ├── tiles  built
│   │   │   └── chunks  6% (0 built, 1 partly / 8)
│   │   │       ├── manifest  planned
│   │   │       ├── logic-pack  planned
│   │   │       ├── near  planned
│   │   │       ├── far  planned
│   │   │       ├── format  partly
│   │   │       ├── streamer  planned
│   │   │       ├── hot-swap  planned
│   │   │       └── fallback  planned
│   │   ├── features  100% (2 built, 0 partly / 2)
│   │   │   ├── features  built
│   │   │   └── rows  built
│   │   ├── query  100% (2 built, 0 partly / 2)
│   │   │   ├── join  built
│   │   │   └── query  built
│   │   └── rights  100% (1 built, 0 partly / 1)
│   │       └── attribution  built
│   ├── observation  100% (5 built, 0 partly / 5)
│   │   ├── observers  100% (4 built, 0 partly / 4)
│   │   │   └── orbit  100% (4 built, 0 partly / 4)
│   │   │       ├── views  built
│   │   │       ├── keys  built
│   │   │       ├── speed  100% (1 built, 0 partly / 1)
│   │   │       │   └── easing  built
│   │   │       └── follow  built
│   │   └── presence  built
│   ├── geometry  62% (19 built, 8 partly / 37)
│   │   ├── shapes  100% (15 built, 0 partly / 15)
│   │   │   ├── shape  built
│   │   │   ├── builder  100% (4 built, 0 partly / 4)
│   │   │   │   ├── solid  built
│   │   │   │   ├── extrude  built
│   │   │   │   ├── lathe  built
│   │   │   │   └── sweep  built
│   │   │   ├── parts  built
│   │   │   ├── levels  100% (6 built, 0 partly / 6)
│   │   │   │   ├── full  built
│   │   │   │   ├── simple  built
│   │   │   │   ├── box  built
│   │   │   │   ├── dot  built
│   │   │   │   ├── counted  built
│   │   │   │   └── impostor  built
│   │   │   ├── instances  built
│   │   │   └── recipes  100% (2 built, 0 partly / 2)
│   │   │       ├── branching  built
│   │   │       └── presets  built
│   │   ├── import  50% (0 built, 1 partly / 1)
│   │   │   └── gltf  partly
│   │   ├── networks  41% (4 built, 6 partly / 17)
│   │   │   ├── analysis  100% (3 built, 0 partly / 3)
│   │   │   │   ├── graph  built
│   │   │   │   ├── routing  built
│   │   │   │   └── nearest  built
│   │   │   ├── lanes  planned
│   │   │   ├── walkways  built
│   │   │   ├── sections  partly
│   │   │   ├── junctions  partly
│   │   │   ├── structures  17% (0 built, 3 partly / 9)
│   │   │   │   ├── bridges  partly
│   │   │   │   ├── piers  partly
│   │   │   │   ├── culverts  planned
│   │   │   │   ├── decks  partly
│   │   │   │   ├── stairs  proposed
│   │   │   │   ├── walls  proposed
│   │   │   │   ├── terraces  proposed
│   │   │   │   ├── ramps  proposed
│   │   │   │   └── railings  proposed
│   │   │   └── clamp  partly
│   │   └── zones  13% (0 built, 1 partly / 4)
│   │       ├── booleans  planned
│   │       ├── kinds  planned
│   │       └── rules  25% (0 built, 1 partly / 2)
│   │           ├── scatter  planned
│   │           └── frontage  partly
│   ├── encoding  100% (7 built, 0 partly / 7)
│   │   ├── marks  100% (6 built, 0 partly / 6)
│   │   │   ├── symbols  100% (2 built, 0 partly / 2)
│   │   │   │   ├── point  built
│   │   │   │   └── text  built
│   │   │   ├── lines  100% (1 built, 0 partly / 1)
│   │   │   │   └── line  built
│   │   │   ├── areas  100% (2 built, 0 partly / 2)
│   │   │   │   ├── area  built
│   │   │   │   └── extrusion  built
│   │   │   └── drape  built
│   │   └── scales  built
│   ├── render  91% (21 built, 0 partly / 23)
│   │   ├── graphics  100% (9 built, 0 partly / 9)
│   │   │   ├── interface  built
│   │   │   ├── webgpu  built
│   │   │   ├── webgl2  built
│   │   │   ├── caps  built
│   │   │   ├── shaders  100% (4 built, 0 partly / 4)
│   │   │   │   ├── wgsl  built
│   │   │   │   ├── glsl  built
│   │   │   │   ├── translate  built
│   │   │   │   └── hooks  built
│   │   │   └── parity  built
│   │   ├── drawing  100% (4 built, 0 partly / 4)
│   │   │   ├── renderer  built
│   │   │   ├── instancing  built
│   │   │   ├── text  built
│   │   │   └── quality  built
│   │   ├── look  50% (2 built, 0 partly / 4)
│   │   │   ├── materials  built
│   │   │   ├── lights  planned
│   │   │   ├── shadows  built
│   │   │   └── post  planned
│   │   ├── style  100% (1 built, 0 partly / 1)
│   │   │   └── ramp  built
│   │   ├── project  100% (1 built, 0 partly / 1)
│   │   │   └── project  built
│   │   └── reveal  100% (4 built, 0 partly / 4)
│   │       ├── modes  built
│   │       ├── timing  built
│   │       ├── define  built
│   │       └── policy  built
│   ├── interaction  100% (5 built, 0 partly / 5)
│   │   ├── picking  100% (2 built, 0 partly / 2)
│   │   │   ├── picking  built
│   │   │   └── hover  built
│   │   ├── events  built
│   │   ├── signals  100% (1 built, 0 partly / 1)
│   │   │   └── selection  built
│   │   └── controllers  built
│   ├── entities  44% (11 built, 8 partly / 34)
│   │   ├── sets  50% (1 built, 0 partly / 2)
│   │   │   ├── sets  built
│   │   │   └── crowds  planned
│   │   ├── identity  33% (1 built, 0 partly / 3)
│   │   │   ├── id  planned
│   │   │   ├── kind  built
│   │   │   └── data  planned
│   │   ├── placement  67% (1 built, 2 partly / 3)
│   │   │   ├── place  partly
│   │   │   ├── thing  built
│   │   │   └── attach  partly
│   │   ├── locomotion  33% (2 built, 0 partly / 6)
│   │   │   ├── none  planned
│   │   │   ├── rail  planned
│   │   │   ├── lanes  planned
│   │   │   ├── surface  built
│   │   │   ├── air  built
│   │   │   └── water  planned
│   │   ├── kinematics  60% (2 built, 2 partly / 5)
│   │   │   ├── hinge  built
│   │   │   ├── slider  built
│   │   │   ├── wheel  partly
│   │   │   ├── ball  planned
│   │   │   └── custom  partly
│   │   ├── body  83% (2 built, 1 partly / 3)
│   │   │   ├── skeleton  built
│   │   │   ├── skin  built
│   │   │   └── morphs  partly
│   │   ├── motion  21% (0 built, 3 partly / 7)
│   │   │   ├── states  planned
│   │   │   ├── clips  partly
│   │   │   ├── poses  planned
│   │   │   ├── ik  planned
│   │   │   ├── gaits  partly
│   │   │   ├── blending  partly
│   │   │   └── look  planned
│   │   └── drive  40% (2 built, 0 partly / 5)
│   │       ├── schedule  planned
│   │       ├── simulation  planned
│   │       ├── data  built
│   │       ├── player  built
│   │       └── script  planned
│   ├── simulation  0% (0 built, 0 partly / 4)
│   │   └── agents  0% (0 built, 0 partly / 4)
│   │       ├── behaviour  planned
│   │       ├── rhythm  planned
│   │       ├── populations  planned
│   │       └── tiers  planned
│   ├── world  100% (9 built, 0 partly / 9)
│   │   ├── elements  100% (1 built, 0 partly / 1)
│   │   │   └── element  built
│   │   ├── settings  100% (2 built, 0 partly / 2)
│   │   │   ├── params  built
│   │   │   └── readouts  built
│   │   ├── state  100% (1 built, 0 partly / 1)
│   │   │   └── settled  built
│   │   ├── lifecycle  100% (3 built, 0 partly / 3)
│   │   │   ├── world  built
│   │   │   ├── errors  built
│   │   │   └── dispose  built
│   │   └── host  100% (2 built, 0 partly / 2)
│   │       ├── plain  built
│   │       └── package  built
│   └── runtime  100% (7 built, 0 partly / 7)
│       ├── detail  100% (2 built, 0 partly / 2)
│       │   ├── detail  built
│       │   └── prefetch  built
│       ├── budget  100% (3 built, 0 partly / 3)
│       │   ├── budget  built
│       │   ├── governor  built
│       │   └── memory  built
│       ├── workers  100% (1 built, 0 partly / 1)
│       │   └── workers  built
│       └── telemetry  100% (1 built, 0 partly / 1)
│           └── remote-log  built
├── modules  62% (38 built, 2 partly / 63)
│   ├── world  63% (28 built, 1 partly / 45)
│   │   ├── surface  100% (5 built, 0 partly / 5)
│   │   │   ├── tiles  built
│   │   │   ├── imagery  built
│   │   │   ├── terrain  built
│   │   │   ├── street-detail  built
│   │   │   └── sky  built
│   │   └── earth  59% (23 built, 1 partly / 40)
│   │       ├── body  100% (3 built, 0 partly / 3)
│   │       │   ├── earth  built
│   │       │   └── base  100% (2 built, 0 partly / 2)
│   │       │       ├── imagery  100% (1 built, 0 partly / 1)
│   │       │       │   └── esri  built
│   │       │       └── terrain  100% (1 built, 0 partly / 1)
│   │       │           └── mapzen  built
│   │       ├── air  100% (10 built, 0 partly / 10)
│   │       │   ├── atmosphere  100% (3 built, 0 partly / 3)
│   │       │   │   ├── scattering  built
│   │       │   │   ├── haze  built
│   │       │   │   └── clouds  built
│   │       │   ├── weather  100% (4 built, 0 partly / 4)
│   │       │   │   ├── presets  built
│   │       │   │   ├── wind  built
│   │       │   │   ├── rain  built
│   │       │   │   └── fog  built
│   │       │   └── sky  100% (3 built, 0 partly / 3)
│   │       │       ├── sun  built
│   │       │       ├── moon  built
│   │       │       └── stars  built
│   │       ├── water  50% (1 built, 0 partly / 2)
│   │       │   └── hydrology  50% (1 built, 0 partly / 2)
│   │       │       ├── water  built
│   │       │       └── channels  planned
│   │       └── presets  38% (9 built, 1 partly / 25)
│   │           ├── built  39% (7 built, 1 partly / 19)
│   │           │   ├── roads  50% (3 built, 0 partly / 6)
│   │           │   │   ├── sections  built
│   │           │   │   ├── junctions  planned
│   │           │   │   ├── markings  built
│   │           │   │   ├── decks  planned
│   │           │   │   ├── sidewalks  built
│   │           │   │   └── elevated  planned
│   │           │   ├── rail  0% (0 built, 0 partly / 4)
│   │           │   │   ├── track  planned
│   │           │   │   ├── crossings  planned
│   │           │   │   ├── viaducts  planned
│   │           │   │   └── stations  proposed
│   │           │   ├── buildings  75% (4 built, 1 partly / 6)
│   │           │   │   ├── footprints  built
│   │           │   │   ├── typology  built
│   │           │   │   ├── facades  planned
│   │           │   │   ├── roofs  built
│   │           │   │   ├── windows  built
│   │           │   │   └── frontage  partly
│   │           │   └── lights  0% (0 built, 0 partly / 3)
│   │           │       ├── street  planned
│   │           │       ├── vehicle  planned
│   │           │       └── windows  planned
│   │           ├── mobility  0% (0 built, 0 partly / 3)
│   │           │   ├── traffic  planned
│   │           │   ├── signals  planned
│   │           │   └── transit  planned
│   │           └── living  67% (2 built, 0 partly / 3)
│   │               └── plants  67% (2 built, 0 partly / 3)
│   │                   ├── species  built
│   │                   ├── sway  planned
│   │                   └── canopy  built
│   └── presets  58% (10 built, 1 partly / 18)
│       ├── shared  33% (1 built, 0 partly / 3)
│       │   └── locomotion  33% (1 built, 0 partly / 3)
│       │       ├── lane-follower  planned
│       │       ├── rail-follower  planned
│       │       └── walker  built
│       ├── humans  83% (7 built, 1 partly / 9)
│       │   ├── body  built
│       │   ├── face  built
│       │   ├── expressions  100% (1 built, 0 partly / 1)
│       │   │   └── blink  built
│       │   ├── hair  built
│       │   ├── clothing  partly
│       │   ├── poses  built
│       │   ├── gaits  built
│       │   ├── people  built
│       │   └── vrm  planned
│       ├── vehicles  20% (1 built, 0 partly / 5)
│       │   ├── car  built
│       │   ├── motorbike  planned
│       │   ├── bus  planned
│       │   ├── minibus  planned
│       │   └── train  planned
│       └── drones  built
├── kits  100% (2 built, 0 partly / 2)
│   └── game  100% (2 built, 0 partly / 2)
│       ├── avatars  built
│       └── collision  built
└── tools  100% (5 built, 0 partly / 5)
    └── checks  100% (5 built, 0 partly / 5)
        ├── smoke  built
        ├── parity  built
        ├── twins  built
        ├── regressions  built
        └── perf  built
```

### Checkpoint 3 · the riverfront city core (quays, outdoor stairs and terraces, bridges, a station; built from scans and data)

Only the parts this checkpoint needs, to the leaves.

```
aslnut  72% (125 built, 9 partly / 181)
├── core  79% (88 built, 9 partly / 117)
│   ├── time  100% (3 built, 0 partly / 3)
│   │   ├── clock  built
│   │   ├── step  built
│   │   └── zones  built
│   ├── data  100% (13 built, 0 partly / 13)
│   │   ├── sources  100% (3 built, 0 partly / 3)
│   │   │   ├── tiles  100% (1 built, 0 partly / 1)
│   │   │   │   └── xyz  built
│   │   │   ├── files  100% (1 built, 0 partly / 1)
│   │   │   │   └── geojson  built
│   │   │   └── custom  built
│   │   ├── loading  100% (5 built, 0 partly / 5)
│   │   │   ├── loader  built
│   │   │   ├── stores  built
│   │   │   ├── packs  built
│   │   │   ├── readiness  built
│   │   │   └── tiles  built
│   │   ├── features  100% (2 built, 0 partly / 2)
│   │   │   ├── features  built
│   │   │   └── rows  built
│   │   ├── query  100% (2 built, 0 partly / 2)
│   │   │   ├── join  built
│   │   │   └── query  built
│   │   └── rights  100% (1 built, 0 partly / 1)
│   │       └── attribution  built
│   ├── observation  100% (5 built, 0 partly / 5)
│   │   ├── observers  100% (4 built, 0 partly / 4)
│   │   │   └── orbit  100% (4 built, 0 partly / 4)
│   │   │       ├── views  built
│   │   │       ├── keys  built
│   │   │       ├── speed  100% (1 built, 0 partly / 1)
│   │   │       │   └── easing  built
│   │   │       └── follow  built
│   │   └── presence  built
│   ├── geometry  45% (14 built, 9 partly / 41)
│   │   ├── shapes  100% (10 built, 0 partly / 10)
│   │   │   ├── builder  100% (1 built, 0 partly / 1)
│   │   │   │   └── solid  built
│   │   │   ├── levels  100% (6 built, 0 partly / 6)
│   │   │   │   ├── full  built
│   │   │   │   ├── simple  built
│   │   │   │   ├── box  built
│   │   │   │   ├── dot  built
│   │   │   │   ├── counted  built
│   │   │   │   └── impostor  built
│   │   │   ├── instances  built
│   │   │   └── recipes  100% (2 built, 0 partly / 2)
│   │   │       ├── branching  built
│   │   │       └── kitbash  built
│   │   ├── import  25% (0 built, 1 partly / 2)
│   │   │   ├── gltf  partly
│   │   │   └── pointcloud  proposed
│   │   ├── landform  8% (0 built, 2 partly / 13)
│   │   │   ├── compose  17% (0 built, 2 partly / 6)
│   │   │   │   ├── layers  proposed
│   │   │   │   ├── footprints  proposed
│   │   │   │   ├── exclusion  partly
│   │   │   │   ├── ground  proposed
│   │   │   │   ├── foundation  partly
│   │   │   │   └── fidelity  proposed
│   │   │   └── terraform  0% (0 built, 0 partly / 7)
│   │   │       ├── flatten  proposed
│   │   │       ├── carve  proposed
│   │   │       ├── raise  proposed
│   │   │       ├── smooth  proposed
│   │   │       ├── sweep  proposed
│   │   │       ├── stamp  proposed
│   │   │       └── erode  proposed
│   │   └── networks  44% (4 built, 6 partly / 16)
│   │       ├── analysis  100% (3 built, 0 partly / 3)
│   │       │   ├── graph  built
│   │       │   ├── routing  built
│   │       │   └── nearest  built
│   │       ├── walkways  built
│   │       ├── sections  partly
│   │       ├── junctions  partly
│   │       ├── structures  17% (0 built, 3 partly / 9)
│   │       │   ├── bridges  partly
│   │       │   ├── piers  partly
│   │       │   ├── culverts  planned
│   │       │   ├── decks  partly
│   │       │   ├── stairs  proposed
│   │       │   ├── walls  proposed
│   │       │   ├── terraces  proposed
│   │       │   ├── ramps  proposed
│   │       │   └── railings  proposed
│   │       └── clamp  partly
│   ├── encoding  100% (7 built, 0 partly / 7)
│   │   ├── marks  100% (6 built, 0 partly / 6)
│   │   │   ├── symbols  100% (2 built, 0 partly / 2)
│   │   │   │   ├── point  built
│   │   │   │   └── text  built
│   │   │   ├── lines  100% (1 built, 0 partly / 1)
│   │   │   │   └── line  built
│   │   │   ├── areas  100% (2 built, 0 partly / 2)
│   │   │   │   ├── area  built
│   │   │   │   └── extrusion  built
│   │   │   └── drape  built
│   │   └── scales  built
│   ├── render  95% (21 built, 0 partly / 22)
│   │   ├── graphics  100% (9 built, 0 partly / 9)
│   │   │   ├── interface  built
│   │   │   ├── webgpu  built
│   │   │   ├── webgl2  built
│   │   │   ├── caps  built
│   │   │   ├── shaders  100% (4 built, 0 partly / 4)
│   │   │   │   ├── wgsl  built
│   │   │   │   ├── glsl  built
│   │   │   │   ├── translate  built
│   │   │   │   └── hooks  built
│   │   │   └── parity  built
│   │   ├── drawing  100% (4 built, 0 partly / 4)
│   │   │   ├── renderer  built
│   │   │   ├── instancing  built
│   │   │   ├── text  built
│   │   │   └── quality  built
│   │   ├── look  67% (2 built, 0 partly / 3)
│   │   │   ├── materials  built
│   │   │   ├── lights  planned
│   │   │   └── shadows  built
│   │   ├── style  100% (1 built, 0 partly / 1)
│   │   │   └── ramp  built
│   │   ├── project  100% (1 built, 0 partly / 1)
│   │   │   └── project  built
│   │   └── reveal  100% (4 built, 0 partly / 4)
│   │       ├── modes  built
│   │       ├── timing  built
│   │       ├── define  built
│   │       └── policy  built
│   ├── interaction  100% (5 built, 0 partly / 5)
│   │   ├── picking  100% (2 built, 0 partly / 2)
│   │   │   ├── picking  built
│   │   │   └── hover  built
│   │   ├── events  built
│   │   ├── signals  100% (1 built, 0 partly / 1)
│   │   │   └── selection  built
│   │   └── controllers  built
│   ├── entities  80% (4 built, 0 partly / 5)
│   │   ├── placement  100% (1 built, 0 partly / 1)
│   │   │   └── thing  built
│   │   ├── locomotion  67% (2 built, 0 partly / 3)
│   │   │   ├── rail  planned
│   │   │   ├── surface  built
│   │   │   └── air  built
│   │   └── drive  100% (1 built, 0 partly / 1)
│   │       └── player  built
│   ├── world  100% (9 built, 0 partly / 9)
│   │   ├── elements  100% (1 built, 0 partly / 1)
│   │   │   └── element  built
│   │   ├── settings  100% (2 built, 0 partly / 2)
│   │   │   ├── params  built
│   │   │   └── readouts  built
│   │   ├── state  100% (1 built, 0 partly / 1)
│   │   │   └── settled  built
│   │   ├── lifecycle  100% (3 built, 0 partly / 3)
│   │   │   ├── world  built
│   │   │   ├── errors  built
│   │   │   └── dispose  built
│   │   └── host  100% (2 built, 0 partly / 2)
│   │       ├── plain  built
│   │       └── package  built
│   └── runtime  100% (7 built, 0 partly / 7)
│       ├── detail  100% (2 built, 0 partly / 2)
│       │   ├── detail  built
│       │   └── prefetch  built
│       ├── budget  100% (3 built, 0 partly / 3)
│       │   ├── budget  built
│       │   ├── governor  built
│       │   └── memory  built
│       ├── workers  100% (1 built, 0 partly / 1)
│       │   └── workers  built
│       └── telemetry  100% (1 built, 0 partly / 1)
│           └── remote-log  built
├── modules  61% (30 built, 0 partly / 49)
│   ├── world  60% (27 built, 0 partly / 45)
│   │   ├── surface  100% (5 built, 0 partly / 5)
│   │   │   ├── tiles  built
│   │   │   ├── imagery  built
│   │   │   ├── terrain  built
│   │   │   ├── street-detail  built
│   │   │   └── sky  built
│   │   └── earth  55% (22 built, 0 partly / 40)
│   │       ├── body  75% (3 built, 0 partly / 4)
│   │       │   ├── earth  built
│   │       │   └── base  67% (2 built, 0 partly / 3)
│   │       │       ├── imagery  100% (1 built, 0 partly / 1)
│   │       │       │   └── esri  built
│   │       │       └── terrain  50% (1 built, 0 partly / 2)
│   │       │           ├── mapzen  built
│   │       │           └── lidar  proposed
│   │       ├── ground  0% (0 built, 0 partly / 1)
│   │       │   └── terrain  0% (0 built, 0 partly / 1)
│   │       │       └── terraform  planned
│   │       ├── air  100% (10 built, 0 partly / 10)
│   │       │   ├── atmosphere  100% (3 built, 0 partly / 3)
│   │       │   │   ├── scattering  built
│   │       │   │   ├── haze  built
│   │       │   │   └── clouds  built
│   │       │   ├── weather  100% (4 built, 0 partly / 4)
│   │       │   │   ├── presets  built
│   │       │   │   ├── wind  built
│   │       │   │   ├── rain  built
│   │       │   │   └── fog  built
│   │       │   └── sky  100% (3 built, 0 partly / 3)
│   │       │       ├── sun  built
│   │       │       ├── moon  built
│   │       │       └── stars  built
│   │       ├── water  50% (1 built, 0 partly / 2)
│   │       │   └── hydrology  50% (1 built, 0 partly / 2)
│   │       │       ├── water  built
│   │       │       └── channels  planned
│   │       └── presets  35% (8 built, 0 partly / 23)
│   │           ├── built  30% (6 built, 0 partly / 20)
│   │           │   ├── roads  100% (3 built, 0 partly / 3)
│   │           │   │   ├── sections  built
│   │           │   │   ├── markings  built
│   │           │   │   └── sidewalks  built
│   │           │   ├── rail  0% (0 built, 0 partly / 4)
│   │           │   │   ├── track  planned
│   │           │   │   ├── crossings  planned
│   │           │   │   ├── viaducts  planned
│   │           │   │   └── stations  proposed
│   │           │   ├── buildings  50% (3 built, 0 partly / 6)
│   │           │   │   ├── footprints  built
│   │           │   │   ├── facades  planned
│   │           │   │   ├── roofs  built
│   │           │   │   ├── windows  built
│   │           │   │   ├── landmarks  proposed
│   │           │   │   └── interiors  proposed
│   │           │   ├── furniture  0% (0 built, 0 partly / 6)
│   │           │   │   ├── benches  proposed
│   │           │   │   ├── bollards  proposed
│   │           │   │   ├── bins  proposed
│   │           │   │   ├── umbrellas  proposed
│   │           │   │   ├── signs  proposed
│   │           │   │   └── planters  proposed
│   │           │   └── lights  0% (0 built, 0 partly / 1)
│   │           │       └── street  planned
│   │           └── living  67% (2 built, 0 partly / 3)
│   │               └── plants  67% (2 built, 0 partly / 3)
│   │                   ├── species  built
│   │                   ├── growth  planned
│   │                   └── canopy  built
│   └── presets  75% (3 built, 0 partly / 4)
│       ├── humans  100% (1 built, 0 partly / 1)
│       │   └── body  built
│       ├── vehicles  50% (1 built, 0 partly / 2)
│       │   ├── car  built
│       │   └── train  planned
│       └── drones  built
├── kits  50% (2 built, 0 partly / 4)
│   ├── game  100% (2 built, 0 partly / 2)
│   │   ├── avatars  built
│   │   └── collision  built
│   └── authoring  0% (0 built, 0 partly / 2)
│       ├── diffs  planned
│       └── pieces  proposed
└── tools  45% (5 built, 0 partly / 11)
    ├── scan  0% (0 built, 0 partly / 5)
    │   ├── classify  proposed
    │   ├── align  proposed
    │   ├── fit  proposed
    │   ├── clean  proposed
    │   └── grid  proposed
    ├── convert  0% (0 built, 0 partly / 1)
    │   └── las  planned
    └── checks  100% (5 built, 0 partly / 5)
        ├── smoke  built
        ├── parity  built
        ├── twins  built
        ├── regressions  built
        └── perf  built
```

## The whole tree, 4 levels

```
aslnut  47% (238 built, 37 partly / 545)
├── core  53% (175 built, 28 partly / 355)
│   ├── space  21% (3 built, 2 partly / 19)
│   │   ├── bodies  partly
│   │   ├── frames  0% (0 built, 0 partly / 5)
│   │   │   ├── inertial  planned
│   │   │   ├── body-fixed  planned
│   │   │   ├── local  planned
│   │   │   ├── object  planned
│   │   │   └── re-rooting  planned
│   │   ├── units  planned
│   │   ├── precision  built
│   │   ├── cells  planned
│   │   ├── ground  17% (0 built, 1 partly / 3)
│   │   │   ├── ground  partly
│   │   │   ├── shells  planned
│   │   │   └── volumes  planned
│   │   ├── regions  67% (2 built, 0 partly / 3)
│   │   │   ├── tree  built
│   │   │   ├── rollup  built
│   │   │   └── pack  planned
│   │   └── observer  0% (0 built, 0 partly / 4)
│   │       ├── light-time  planned
│   │       ├── aberration  planned
│   │       ├── doppler  planned
│   │       └── ship-time  planned
│   ├── time  43% (3 built, 0 partly / 7)
│   │   ├── clock  built
│   │   ├── step  built
│   │   ├── calendars  planned
│   │   ├── scales  planned
│   │   ├── zones  built
│   │   ├── ranges  planned
│   │   └── deep  planned
│   ├── data  74% (35 built, 1 partly / 48)
│   │   ├── sources  90% (9 built, 0 partly / 10)
│   │   │   ├── tiles  80% (4 built, 0 partly / 5)
│   │   │   ├── files  100% (2 built, 0 partly / 2)
│   │   │   ├── services  100% (2 built, 0 partly / 2)
│   │   │   └── custom  built
│   │   ├── loading  42% (5 built, 1 partly / 13)
│   │   │   ├── loader  built
│   │   │   ├── stores  built
│   │   │   ├── packs  built
│   │   │   ├── readiness  built
│   │   │   ├── tiles  built
│   │   │   └── chunks  6% (0 built, 1 partly / 8)
│   │   ├── features  100% (2 built, 0 partly / 2)
│   │   │   ├── features  built
│   │   │   └── rows  built
│   │   ├── query  100% (2 built, 0 partly / 2)
│   │   │   ├── join  built
│   │   │   └── query  built
│   │   ├── live  100% (4 built, 0 partly / 4)
│   │   │   ├── set  built
│   │   │   ├── upsert  built
│   │   │   ├── patch  built
│   │   │   └── remove  built
│   │   ├── history  60% (3 built, 0 partly / 5)
│   │   │   ├── log  built
│   │   │   ├── state-at  built
│   │   │   ├── replay  built
│   │   │   ├── checkpoints  planned
│   │   │   └── epochs  planned
│   │   ├── scenarios  80% (4 built, 0 partly / 5)
│   │   │   ├── base  built
│   │   │   ├── variant  built
│   │   │   ├── diff  built
│   │   │   ├── compare  built
│   │   │   └── overrides  planned
│   │   └── rights  86% (6 built, 0 partly / 7)
│   │       ├── terms  built
│   │       ├── capabilities  100% (4 built, 0 partly / 4)
│   │       ├── attribution  built
│   │       └── licences  planned
│   ├── observation  43% (19 built, 2 partly / 47)
│   │   ├── observers  33% (12 built, 2 partly / 40)
│   │   │   ├── orbit  35% (12 built, 2 partly / 37)
│   │   │   ├── eyes  planned
│   │   │   ├── sensor  planned
│   │   │   └── fixed  planned
│   │   ├── levels  100% (3 built, 0 partly / 3)
│   │   │   ├── ladder  built
│   │   │   ├── level  built
│   │   │   └── binding  built
│   │   ├── gates  100% (3 built, 0 partly / 3)
│   │   │   ├── margin  built
│   │   │   ├── dwell  built
│   │   │   └── keep  built
│   │   └── presence  built
│   ├── geometry  46% (26 built, 10 partly / 67)
│   │   ├── shapes  100% (21 built, 0 partly / 21)
│   │   │   ├── shape  built
│   │   │   ├── builder  100% (7 built, 0 partly / 7)
│   │   │   ├── parts  built
│   │   │   ├── levels  100% (6 built, 0 partly / 6)
│   │   │   ├── instances  built
│   │   │   ├── checks  built
│   │   │   └── recipes  100% (4 built, 0 partly / 4)
│   │   ├── import  5% (0 built, 1 partly / 11)
│   │   │   ├── gltf  partly
│   │   │   ├── gltf-extensions  0% (0 built, 0 partly / 5)
│   │   │   ├── obj  planned
│   │   │   ├── ply  planned
│   │   │   ├── tiles3d  planned
│   │   │   ├── splats  planned
│   │   │   └── pointcloud  proposed
│   │   ├── landform  8% (0 built, 2 partly / 13)
│   │   │   ├── compose  17% (0 built, 2 partly / 6)
│   │   │   └── terraform  0% (0 built, 0 partly / 7)
│   │   ├── networks  44% (5 built, 6 partly / 18)
│   │   │   ├── analysis  100% (4 built, 0 partly / 4)
│   │   │   ├── lanes  planned
│   │   │   ├── walkways  built
│   │   │   ├── sections  partly
│   │   │   ├── junctions  partly
│   │   │   ├── structures  17% (0 built, 3 partly / 9)
│   │   │   └── clamp  partly
│   │   └── zones  13% (0 built, 1 partly / 4)
│   │       ├── booleans  planned
│   │       ├── kinds  planned
│   │       └── rules  25% (0 built, 1 partly / 2)
│   ├── encoding  85% (17 built, 0 partly / 20)
│   │   ├── marks  79% (11 built, 0 partly / 14)
│   │   │   ├── symbols  100% (3 built, 0 partly / 3)
│   │   │   ├── lines  75% (3 built, 0 partly / 4)
│   │   │   ├── areas  60% (3 built, 0 partly / 5)
│   │   │   ├── drape  built
│   │   │   └── custom  built
│   │   ├── scales  built
│   │   ├── layers  100% (4 built, 0 partly / 4)
│   │   │   ├── layer  built
│   │   │   ├── labels  built
│   │   │   ├── legend  built
│   │   │   └── stack  built
│   │   └── join  built
│   ├── render  74% (24 built, 1 partly / 33)
│   │   ├── graphics  100% (9 built, 0 partly / 9)
│   │   │   ├── interface  built
│   │   │   ├── webgpu  built
│   │   │   ├── webgl2  built
│   │   │   ├── caps  built
│   │   │   ├── shaders  100% (4 built, 0 partly / 4)
│   │   │   └── parity  built
│   │   ├── drawing  100% (4 built, 0 partly / 4)
│   │   │   ├── renderer  built
│   │   │   ├── instancing  built
│   │   │   ├── text  built
│   │   │   └── quality  built
│   │   ├── look  40% (2 built, 0 partly / 5)
│   │   │   ├── materials  built
│   │   │   ├── lights  planned
│   │   │   ├── shadows  built
│   │   │   ├── post  planned
│   │   │   └── cutaway  planned
│   │   ├── style  36% (2 built, 1 partly / 7)
│   │   │   ├── ramp  built
│   │   │   ├── blend  partly
│   │   │   ├── lens  planned
│   │   │   ├── theme  built
│   │   │   └── pattern  0% (0 built, 0 partly / 3)
│   │   ├── project  100% (2 built, 0 partly / 2)
│   │   │   ├── project  built
│   │   │   └── visible  built
│   │   ├── reveal  100% (4 built, 0 partly / 4)
│   │   │   ├── modes  built
│   │   │   ├── timing  built
│   │   │   ├── define  built
│   │   │   └── policy  built
│   │   └── capture  50% (1 built, 0 partly / 2)
│   │       ├── capture  built
│   │       └── ground-truth  planned
│   ├── interaction  71% (5 built, 0 partly / 7)
│   │   ├── picking  100% (2 built, 0 partly / 2)
│   │   │   ├── picking  built
│   │   │   └── hover  built
│   │   ├── events  built
│   │   ├── signals  50% (1 built, 0 partly / 2)
│   │   │   ├── signals  planned
│   │   │   └── selection  built
│   │   ├── controllers  built
│   │   └── history  planned
│   ├── entities  44% (11 built, 8 partly / 34)
│   │   ├── sets  50% (1 built, 0 partly / 2)
│   │   │   ├── sets  built
│   │   │   └── crowds  planned
│   │   ├── identity  33% (1 built, 0 partly / 3)
│   │   │   ├── id  planned
│   │   │   ├── kind  built
│   │   │   └── data  planned
│   │   ├── placement  67% (1 built, 2 partly / 3)
│   │   │   ├── place  partly
│   │   │   ├── thing  built
│   │   │   └── attach  partly
│   │   ├── locomotion  33% (2 built, 0 partly / 6)
│   │   │   ├── none  planned
│   │   │   ├── rail  planned
│   │   │   ├── lanes  planned
│   │   │   ├── surface  built
│   │   │   ├── air  built
│   │   │   └── water  planned
│   │   ├── kinematics  60% (2 built, 2 partly / 5)
│   │   │   ├── hinge  built
│   │   │   ├── slider  built
│   │   │   ├── wheel  partly
│   │   │   ├── ball  planned
│   │   │   └── custom  partly
│   │   ├── body  83% (2 built, 1 partly / 3)
│   │   │   ├── skeleton  built
│   │   │   ├── skin  built
│   │   │   └── morphs  partly
│   │   ├── motion  21% (0 built, 3 partly / 7)
│   │   │   ├── states  planned
│   │   │   ├── clips  partly
│   │   │   ├── poses  planned
│   │   │   ├── ik  planned
│   │   │   ├── gaits  partly
│   │   │   ├── blending  partly
│   │   │   └── look  planned
│   │   └── drive  40% (2 built, 0 partly / 5)
│   │       ├── schedule  planned
│   │       ├── simulation  planned
│   │       ├── data  built
│   │       ├── player  built
│   │       └── script  planned
│   ├── simulation  21% (7 built, 0 partly / 33)
│   │   ├── agents  0% (0 built, 0 partly / 6)
│   │   │   ├── behaviour  planned
│   │   │   ├── rhythm  planned
│   │   │   ├── habitat  planned
│   │   │   ├── senses  planned
│   │   │   ├── populations  planned
│   │   │   └── tiers  planned
│   │   ├── fields  40% (2 built, 0 partly / 5)
│   │   │   ├── raster  built
│   │   │   ├── surface  planned
│   │   │   ├── graph  planned
│   │   │   ├── volume  planned
│   │   │   └── kernels  built
│   │   ├── rules  50% (2 built, 0 partly / 4)
│   │   │   ├── presets  built
│   │   │   ├── custom  built
│   │   │   ├── coupling  planned
│   │   │   └── regimes  planned
│   │   ├── fidelity  0% (0 built, 0 partly / 2)
│   │   │   ├── fixed  planned
│   │   │   └── observed  planned
│   │   ├── measure  33% (1 built, 0 partly / 3)
│   │   │   ├── probes  built
│   │   │   ├── sensors  planned
│   │   │   └── validation  planned
│   │   ├── constants  built
│   │   └── phenomena  8% (1 built, 0 partly / 12)
│   │       ├── heat  built
│   │       ├── fluids  planned
│   │       ├── fire  planned
│   │       ├── light  planned
│   │       ├── acoustics  planned
│   │       ├── contacts  planned
│   │       ├── orbits  0% (0 built, 0 partly / 4)
│   │       ├── exchanges  planned
│   │       └── growth  planned
│   ├── world  69% (15 built, 3 partly / 24)
│   │   ├── elements  83% (2 built, 1 partly / 3)
│   │   │   ├── element  built
│   │   │   ├── props  partly
│   │   │   └── order  built
│   │   ├── settings  100% (3 built, 0 partly / 3)
│   │   │   ├── params  built
│   │   │   ├── readouts  built
│   │   │   └── points  built
│   │   ├── state  67% (2 built, 0 partly / 3)
│   │   │   ├── states  built
│   │   │   ├── settled  built
│   │   │   └── json  planned
│   │   ├── describe  50% (1 built, 1 partly / 3)
│   │   │   ├── describe  planned
│   │   │   ├── schemas  partly
│   │   │   └── guide  built
│   │   ├── extend  50% (1 built, 1 partly / 3)
│   │   │   ├── extend  built
│   │   │   ├── provide  planned
│   │   │   └── hot-swap  partly
│   │   ├── lifecycle  100% (3 built, 0 partly / 3)
│   │   │   ├── world  built
│   │   │   ├── errors  built
│   │   │   └── dispose  built
│   │   └── host  50% (3 built, 0 partly / 6)
│   │       ├── canvases  planned
│   │       ├── plain  built
│   │       ├── react  planned
│   │       ├── zebflow  planned
│   │       ├── server-safe  built
│   │       └── package  built
│   └── runtime  66% (10 built, 1 partly / 16)
│       ├── frame  built
│       ├── detail  100% (3 built, 0 partly / 3)
│       │   ├── detail  built
│       │   ├── priorities  built
│       │   └── prefetch  built
│       ├── budget  100% (3 built, 0 partly / 3)
│       │   ├── budget  built
│       │   ├── governor  built
│       │   └── memory  built
│       ├── workers  50% (1 built, 1 partly / 3)
│       │   ├── workers  built
│       │   ├── servers  planned
│       │   └── compile  partly
│       ├── partners  0% (0 built, 0 partly / 3)
│       │   ├── external-engine  planned
│       │   ├── fmi  planned
│       │   └── experiment  planned
│       └── telemetry  67% (2 built, 0 partly / 3)
│           ├── telemetry  built
│           ├── remote-log  built
│           └── shots  planned
├── modules  37% (49 built, 4 partly / 139)
│   ├── shared  planned
│   ├── world  36% (39 built, 2 partly / 110)
│   │   ├── surface  83% (5 built, 0 partly / 6)
│   │   │   ├── tiles  built
│   │   │   ├── imagery  built
│   │   │   ├── terrain  built
│   │   │   ├── street-detail  built
│   │   │   ├── provenance  planned
│   │   │   └── sky  built
│   │   ├── plane  built
│   │   ├── sun  planned
│   │   ├── earth  36% (33 built, 2 partly / 94)
│   │   │   ├── shared  partly
│   │   │   ├── body  60% (9 built, 0 partly / 15)
│   │   │   ├── ground  0% (0 built, 0 partly / 6)
│   │   │   ├── air  83% (10 built, 0 partly / 12)
│   │   │   ├── water  43% (3 built, 0 partly / 7)
│   │   │   ├── climate  50% (1 built, 0 partly / 2)
│   │   │   ├── life  0% (0 built, 0 partly / 5)
│   │   │   ├── analysis  0% (0 built, 0 partly / 2)
│   │   │   └── presets  24% (10 built, 1 partly / 44)
│   │   ├── moon  planned
│   │   ├── mars  planned
│   │   └── space  0% (0 built, 0 partly / 6)
│   │       ├── satellites  0% (0 built, 0 partly / 1)
│   │       ├── asteroids  planned
│   │       ├── stars  planned
│   │       ├── constellations  planned
│   │       ├── galaxies  planned
│   │       └── exoplanets  planned
│   └── presets  39% (10 built, 2 partly / 28)
│       ├── shared  33% (1 built, 0 partly / 3)
│       │   └── locomotion  33% (1 built, 0 partly / 3)
│       ├── humans  62% (7 built, 2 partly / 13)
│       │   ├── body  built
│       │   ├── face  built
│       │   ├── expressions  38% (1 built, 1 partly / 4)
│       │   ├── hair  built
│       │   ├── clothing  partly
│       │   ├── poses  built
│       │   ├── gaits  built
│       │   ├── people  built
│       │   ├── speech  planned
│       │   └── vrm  planned
│       ├── animals  0% (0 built, 0 partly / 4)
│       │   ├── quadruped  planned
│       │   ├── bird  planned
│       │   ├── fish  planned
│       │   └── reptile  planned
│       ├── vehicles  20% (1 built, 0 partly / 5)
│       │   ├── car  built
│       │   ├── motorbike  planned
│       │   ├── bus  planned
│       │   ├── minibus  planned
│       │   └── train  planned
│       ├── drones  built
│       └── robots  0% (0 built, 0 partly / 2)
│           ├── robot  planned
│           └── android  planned
├── kits  50% (6 built, 0 partly / 12)
│   ├── dashboard  100% (4 built, 0 partly / 4)
│   │   ├── legend  built
│   │   ├── cards  built
│   │   ├── stats  built
│   │   └── layers  built
│   ├── game  100% (2 built, 0 partly / 2)
│   │   ├── avatars  built
│   │   └── collision  built
│   └── authoring  0% (0 built, 0 partly / 6)
│       ├── networks  planned
│       ├── zones  planned
│       ├── rules  planned
│       ├── terraform  planned
│       ├── diffs  planned
│       └── pieces  proposed
└── tools  27% (8 built, 5 partly / 39)
    ├── geo  planned
    ├── scan  0% (0 built, 0 partly / 5)
    │   ├── classify  proposed
    │   ├── align  proposed
    │   ├── fit  proposed
    │   ├── clean  proposed
    │   └── grid  proposed
    ├── bake  partly
    ├── compile  20% (1 built, 4 partly / 15)
    │   ├── run  33% (1 built, 0 partly / 3)
    │   │   ├── on-save  planned
    │   │   ├── command  built
    │   │   └── page  planned
    │   ├── inputs  partly
    │   ├── steps  14% (0 built, 2 partly / 7)
    │   │   ├── solve  partly
    │   │   ├── resolve  planned
    │   │   ├── mesh  planned
    │   │   ├── assign  planned
    │   │   ├── solids  planned
    │   │   ├── logic  planned
    │   │   └── manifest  partly
    │   ├── custom-steps  planned
    │   ├── options  planned
    │   ├── stale  planned
    │   └── outputs  partly
    ├── convert  0% (0 built, 0 partly / 6)
    │   ├── fbx  planned
    │   ├── ifc  planned
    │   ├── citygml  planned
    │   ├── las  planned
    │   ├── usd  planned
    │   └── i3s  proposed
    ├── export  0% (0 built, 0 partly / 1)
    │   └── usd  planned
    ├── checks  100% (7 built, 0 partly / 7)
    │   ├── smoke  built
    │   ├── parity  built
    │   ├── twins  built
    │   ├── regressions  built
    │   ├── suite  built
    │   ├── perf  built
    │   └── recipes  built
    ├── catalog  planned
    ├── cli  planned
    └── mcp  planned
```

## Every part's id (for reports: "did core.entities.locomotion.lanes")

| id | status | checkpoints |
|---|---|---|
| `core` | 53% (175 built, 28 partly / 355) | 1 2 3 |
| `core.space` | 21% (3 built, 2 partly / 19) | 1 |
| `core.space.bodies` | partly |  |
| `core.space.frames` | 0% (0 built, 0 partly / 5) |  |
| `core.space.frames.inertial` | planned |  |
| `core.space.frames.body-fixed` | planned |  |
| `core.space.frames.local` | planned |  |
| `core.space.frames.object` | planned |  |
| `core.space.frames.re-rooting` | planned |  |
| `core.space.units` | planned |  |
| `core.space.precision` | built |  |
| `core.space.cells` | planned |  |
| `core.space.ground` | 17% (0 built, 1 partly / 3) |  |
| `core.space.ground.ground` | partly |  |
| `core.space.ground.shells` | planned |  |
| `core.space.ground.volumes` | planned |  |
| `core.space.regions` | 67% (2 built, 0 partly / 3) | 1 |
| `core.space.regions.tree` | built | 1 |
| `core.space.regions.rollup` | built | 1 |
| `core.space.regions.pack` | planned |  |
| `core.space.observer` | 0% (0 built, 0 partly / 4) |  |
| `core.space.observer.light-time` | planned |  |
| `core.space.observer.aberration` | planned |  |
| `core.space.observer.doppler` | planned |  |
| `core.space.observer.ship-time` | planned |  |
| `core.time` | 43% (3 built, 0 partly / 7) | 1 2 3 |
| `core.time.clock` | built | 1 2 3 |
| `core.time.step` | built | 1 2 3 |
| `core.time.calendars` | planned |  |
| `core.time.scales` | planned |  |
| `core.time.zones` | built | 1 2 3 |
| `core.time.ranges` | planned |  |
| `core.time.deep` | planned |  |
| `core.data` | 74% (35 built, 1 partly / 48) | 1 2 3 |
| `core.data.sources` | 90% (9 built, 0 partly / 10) | 1 2 3 |
| `core.data.sources.tiles` | 80% (4 built, 0 partly / 5) | 1 2 3 |
| `core.data.sources.tiles.xyz` | built | 1 2 3 |
| `core.data.sources.tiles.cog` | planned |  |
| `core.data.sources.tiles.wms` | built |  |
| `core.data.sources.tiles.pmtiles` | built |  |
| `core.data.sources.tiles.mvt` | built |  |
| `core.data.sources.files` | 100% (2 built, 0 partly / 2) | 1 2 3 |
| `core.data.sources.files.geojson` | built | 1 2 3 |
| `core.data.sources.files.csv` | built | 1 |
| `core.data.sources.services` | 100% (2 built, 0 partly / 2) |  |
| `core.data.sources.services.wfs` | built |  |
| `core.data.sources.services.stream` | built |  |
| `core.data.sources.custom` | built | 1 2 3 |
| `core.data.loading` | 42% (5 built, 1 partly / 13) | 1 2 3 |
| `core.data.loading.loader` | built | 1 2 3 |
| `core.data.loading.stores` | built | 1 2 3 |
| `core.data.loading.packs` | built | 1 2 3 |
| `core.data.loading.readiness` | built | 1 2 3 |
| `core.data.loading.tiles` | built | 1 2 3 |
| `core.data.loading.chunks` | 6% (0 built, 1 partly / 8) | 2 |
| `core.data.loading.chunks.manifest` | planned | 2 |
| `core.data.loading.chunks.logic-pack` | planned | 2 |
| `core.data.loading.chunks.near` | planned | 2 |
| `core.data.loading.chunks.far` | planned | 2 |
| `core.data.loading.chunks.format` | partly | 2 |
| `core.data.loading.chunks.streamer` | planned | 2 |
| `core.data.loading.chunks.hot-swap` | planned | 2 |
| `core.data.loading.chunks.fallback` | planned | 2 |
| `core.data.features` | 100% (2 built, 0 partly / 2) | 1 2 3 |
| `core.data.features.features` | built | 1 2 3 |
| `core.data.features.rows` | built | 1 2 3 |
| `core.data.query` | 100% (2 built, 0 partly / 2) | 1 2 3 |
| `core.data.query.join` | built | 1 2 3 |
| `core.data.query.query` | built | 1 2 3 |
| `core.data.live` | 100% (4 built, 0 partly / 4) |  |
| `core.data.live.set` | built |  |
| `core.data.live.upsert` | built |  |
| `core.data.live.patch` | built |  |
| `core.data.live.remove` | built |  |
| `core.data.history` | 60% (3 built, 0 partly / 5) |  |
| `core.data.history.log` | built |  |
| `core.data.history.state-at` | built |  |
| `core.data.history.replay` | built |  |
| `core.data.history.checkpoints` | planned |  |
| `core.data.history.epochs` | planned |  |
| `core.data.scenarios` | 80% (4 built, 0 partly / 5) | 1 |
| `core.data.scenarios.base` | built | 1 |
| `core.data.scenarios.variant` | built | 1 |
| `core.data.scenarios.diff` | built | 1 |
| `core.data.scenarios.compare` | built | 1 |
| `core.data.scenarios.overrides` | planned |  |
| `core.data.rights` | 86% (6 built, 0 partly / 7) | 1 2 3 |
| `core.data.rights.terms` | built |  |
| `core.data.rights.capabilities` | 100% (4 built, 0 partly / 4) |  |
| `core.data.rights.capabilities.show` | built |  |
| `core.data.rights.capabilities.prefetch` | built |  |
| `core.data.rights.capabilities.keep` | built |  |
| `core.data.rights.capabilities.export` | built |  |
| `core.data.rights.attribution` | built | 1 2 3 |
| `core.data.rights.licences` | planned |  |
| `core.observation` | 43% (19 built, 2 partly / 47) | 1 2 3 |
| `core.observation.observers` | 33% (12 built, 2 partly / 40) | 1 2 3 |
| `core.observation.observers.orbit` | 35% (12 built, 2 partly / 37) | 1 2 3 |
| `core.observation.observers.orbit.views` | built | 1 2 3 |
| `core.observation.observers.orbit.keys` | built | 1 2 3 |
| `core.observation.observers.orbit.paths` | 20% (0 built, 2 partly / 5) |  |
| `core.observation.observers.orbit.paths.line` | partly |  |
| `core.observation.observers.orbit.paths.bezier` | planned |  |
| `core.observation.observers.orbit.paths.spline` | planned |  |
| `core.observation.observers.orbit.paths.along` | planned |  |
| `core.observation.observers.orbit.paths.circle` | partly |  |
| `core.observation.observers.orbit.aim` | 25% (1 built, 0 partly / 4) |  |
| `core.observation.observers.orbit.aim.look-at` | built |  |
| `core.observation.observers.orbit.aim.along-path` | planned |  |
| `core.observation.observers.orbit.aim.heading` | planned |  |
| `core.observation.observers.orbit.aim.framing` | planned |  |
| `core.observation.observers.orbit.lens` | 0% (0 built, 0 partly / 3) |  |
| `core.observation.observers.orbit.lens.fov` | planned |  |
| `core.observation.observers.orbit.lens.focus` | planned |  |
| `core.observation.observers.orbit.lens.depth-of-field` | planned |  |
| `core.observation.observers.orbit.speed` | 25% (1 built, 0 partly / 4) | 1 2 3 |
| `core.observation.observers.orbit.speed.easing` | built | 1 2 3 |
| `core.observation.observers.orbit.speed.ease` | planned |  |
| `core.observation.observers.orbit.speed.constant` | planned |  |
| `core.observation.observers.orbit.speed.hold` | planned |  |
| `core.observation.observers.orbit.moves` | 35% (6 built, 0 partly / 17) |  |
| `core.observation.observers.orbit.moves.pan` | planned |  |
| `core.observation.observers.orbit.moves.tilt` | planned |  |
| `core.observation.observers.orbit.moves.roll` | planned |  |
| `core.observation.observers.orbit.moves.dolly` | built |  |
| `core.observation.observers.orbit.moves.truck` | planned |  |
| `core.observation.observers.orbit.moves.pedestal` | planned |  |
| `core.observation.observers.orbit.moves.crane` | built |  |
| `core.observation.observers.orbit.moves.zoom` | planned |  |
| `core.observation.observers.orbit.moves.dolly-zoom` | planned |  |
| `core.observation.observers.orbit.moves.arc` | built |  |
| `core.observation.observers.orbit.moves.track` | built |  |
| `core.observation.observers.orbit.moves.chase` | built |  |
| `core.observation.observers.orbit.moves.flyover` | planned |  |
| `core.observation.observers.orbit.moves.reveal` | built |  |
| `core.observation.observers.orbit.moves.whip-pan` | planned |  |
| `core.observation.observers.orbit.moves.rack-focus` | planned |  |
| `core.observation.observers.orbit.moves.shake` | planned |  |
| `core.observation.observers.orbit.follow` | built | 1 2 3 |
| `core.observation.observers.orbit.acrobatic` | built |  |
| `core.observation.observers.eyes` | planned |  |
| `core.observation.observers.sensor` | planned |  |
| `core.observation.observers.fixed` | planned |  |
| `core.observation.levels` | 100% (3 built, 0 partly / 3) |  |
| `core.observation.levels.ladder` | built |  |
| `core.observation.levels.level` | built |  |
| `core.observation.levels.binding` | built |  |
| `core.observation.gates` | 100% (3 built, 0 partly / 3) |  |
| `core.observation.gates.margin` | built |  |
| `core.observation.gates.dwell` | built |  |
| `core.observation.gates.keep` | built |  |
| `core.observation.presence` | built | 1 2 3 |
| `core.geometry` | 46% (26 built, 10 partly / 67) | 1 2 3 |
| `core.geometry.shapes` | 100% (21 built, 0 partly / 21) | 1 2 3 |
| `core.geometry.shapes.shape` | built | 1 2 |
| `core.geometry.shapes.builder` | 100% (7 built, 0 partly / 7) | 1 2 3 |
| `core.geometry.shapes.builder.solid` | built | 1 2 3 |
| `core.geometry.shapes.builder.extrude` | built | 1 2 |
| `core.geometry.shapes.builder.lathe` | built | 1 2 |
| `core.geometry.shapes.builder.sweep` | built | 1 2 |
| `core.geometry.shapes.builder.copy` | built | 1 |
| `core.geometry.shapes.builder.scope` | built | 1 |
| `core.geometry.shapes.builder.mesh` | built |  |
| `core.geometry.shapes.parts` | built | 1 2 |
| `core.geometry.shapes.levels` | 100% (6 built, 0 partly / 6) | 1 2 3 |
| `core.geometry.shapes.levels.full` | built | 1 2 3 |
| `core.geometry.shapes.levels.simple` | built | 1 2 3 |
| `core.geometry.shapes.levels.box` | built | 1 2 3 |
| `core.geometry.shapes.levels.dot` | built | 1 2 3 |
| `core.geometry.shapes.levels.counted` | built | 1 2 3 |
| `core.geometry.shapes.levels.impostor` | built | 1 2 3 |
| `core.geometry.shapes.instances` | built | 1 2 3 |
| `core.geometry.shapes.checks` | built | 1 |
| `core.geometry.shapes.recipes` | 100% (4 built, 0 partly / 4) | 1 2 3 |
| `core.geometry.shapes.recipes.branching` | built | 1 2 3 |
| `core.geometry.shapes.recipes.kitbash` | built | 1 3 |
| `core.geometry.shapes.recipes.presets` | built | 1 2 |
| `core.geometry.shapes.recipes.package` | built | 1 |
| `core.geometry.import` | 5% (0 built, 1 partly / 11) | 2 3 |
| `core.geometry.import.gltf` | partly | 2 3 |
| `core.geometry.import.gltf-extensions` | 0% (0 built, 0 partly / 5) |  |
| `core.geometry.import.gltf-extensions.draco` | planned |  |
| `core.geometry.import.gltf-extensions.meshopt` | planned |  |
| `core.geometry.import.gltf-extensions.ktx2` | planned |  |
| `core.geometry.import.gltf-extensions.lights` | planned |  |
| `core.geometry.import.gltf-extensions.variants` | planned |  |
| `core.geometry.import.obj` | planned |  |
| `core.geometry.import.ply` | planned |  |
| `core.geometry.import.tiles3d` | planned |  |
| `core.geometry.import.splats` | planned |  |
| `core.geometry.import.pointcloud` | proposed | 3 |
| `core.geometry.landform` | 8% (0 built, 2 partly / 13) | 3 |
| `core.geometry.landform.compose` | 17% (0 built, 2 partly / 6) | 3 |
| `core.geometry.landform.compose.layers` | proposed | 3 |
| `core.geometry.landform.compose.footprints` | proposed | 3 |
| `core.geometry.landform.compose.exclusion` | partly | 3 |
| `core.geometry.landform.compose.ground` | proposed | 3 |
| `core.geometry.landform.compose.foundation` | partly | 3 |
| `core.geometry.landform.compose.fidelity` | proposed | 3 |
| `core.geometry.landform.terraform` | 0% (0 built, 0 partly / 7) | 3 |
| `core.geometry.landform.terraform.flatten` | proposed | 3 |
| `core.geometry.landform.terraform.carve` | proposed | 3 |
| `core.geometry.landform.terraform.raise` | proposed | 3 |
| `core.geometry.landform.terraform.smooth` | proposed | 3 |
| `core.geometry.landform.terraform.sweep` | proposed | 3 |
| `core.geometry.landform.terraform.stamp` | proposed | 3 |
| `core.geometry.landform.terraform.erode` | proposed | 3 |
| `core.geometry.networks` | 44% (5 built, 6 partly / 18) | 1 2 3 |
| `core.geometry.networks.analysis` | 100% (4 built, 0 partly / 4) | 1 2 3 |
| `core.geometry.networks.analysis.graph` | built | 1 2 3 |
| `core.geometry.networks.analysis.routing` | built | 1 2 3 |
| `core.geometry.networks.analysis.isochrones` | built | 1 |
| `core.geometry.networks.analysis.nearest` | built | 1 2 3 |
| `core.geometry.networks.lanes` | planned | 2 |
| `core.geometry.networks.walkways` | built | 1 2 3 |
| `core.geometry.networks.sections` | partly | 1 2 3 |
| `core.geometry.networks.junctions` | partly | 1 2 3 |
| `core.geometry.networks.structures` | 17% (0 built, 3 partly / 9) | 2 3 |
| `core.geometry.networks.structures.bridges` | partly | 2 3 |
| `core.geometry.networks.structures.piers` | partly | 2 3 |
| `core.geometry.networks.structures.culverts` | planned | 2 3 |
| `core.geometry.networks.structures.decks` | partly | 2 3 |
| `core.geometry.networks.structures.stairs` | proposed | 2 3 |
| `core.geometry.networks.structures.walls` | proposed | 2 3 |
| `core.geometry.networks.structures.terraces` | proposed | 2 3 |
| `core.geometry.networks.structures.ramps` | proposed | 2 3 |
| `core.geometry.networks.structures.railings` | proposed | 2 3 |
| `core.geometry.networks.clamp` | partly | 1 2 3 |
| `core.geometry.zones` | 13% (0 built, 1 partly / 4) | 2 |
| `core.geometry.zones.booleans` | planned | 2 |
| `core.geometry.zones.kinds` | planned | 2 |
| `core.geometry.zones.rules` | 25% (0 built, 1 partly / 2) | 2 |
| `core.geometry.zones.rules.scatter` | planned | 2 |
| `core.geometry.zones.rules.frontage` | partly | 2 |
| `core.encoding` | 85% (17 built, 0 partly / 20) | 1 2 3 |
| `core.encoding.marks` | 79% (11 built, 0 partly / 14) | 1 2 3 |
| `core.encoding.marks.symbols` | 100% (3 built, 0 partly / 3) | 1 2 3 |
| `core.encoding.marks.symbols.point` | built | 1 2 3 |
| `core.encoding.marks.symbols.icon` | built |  |
| `core.encoding.marks.symbols.text` | built | 1 2 3 |
| `core.encoding.marks.lines` | 75% (3 built, 0 partly / 4) | 1 2 3 |
| `core.encoding.marks.lines.line` | built | 1 2 3 |
| `core.encoding.marks.lines.arc` | built |  |
| `core.encoding.marks.lines.trail` | built |  |
| `core.encoding.marks.lines.arrows` | planned |  |
| `core.encoding.marks.areas` | 60% (3 built, 0 partly / 5) | 1 2 3 |
| `core.encoding.marks.areas.area` | built | 1 2 3 |
| `core.encoding.marks.areas.extrusion` | built | 1 2 3 |
| `core.encoding.marks.areas.raster` | built | 1 |
| `core.encoding.marks.areas.grid` | planned |  |
| `core.encoding.marks.areas.rings` | planned |  |
| `core.encoding.marks.drape` | built | 1 2 3 |
| `core.encoding.marks.custom` | built |  |
| `core.encoding.scales` | built | 1 2 3 |
| `core.encoding.layers` | 100% (4 built, 0 partly / 4) | 1 |
| `core.encoding.layers.layer` | built |  |
| `core.encoding.layers.labels` | built | 1 |
| `core.encoding.layers.legend` | built |  |
| `core.encoding.layers.stack` | built |  |
| `core.encoding.join` | built |  |
| `core.render` | 74% (24 built, 1 partly / 33) | 1 2 3 |
| `core.render.graphics` | 100% (9 built, 0 partly / 9) | 1 2 3 |
| `core.render.graphics.interface` | built | 1 2 3 |
| `core.render.graphics.webgpu` | built | 1 2 3 |
| `core.render.graphics.webgl2` | built | 1 2 3 |
| `core.render.graphics.caps` | built | 1 2 3 |
| `core.render.graphics.shaders` | 100% (4 built, 0 partly / 4) | 1 2 3 |
| `core.render.graphics.shaders.wgsl` | built | 1 2 3 |
| `core.render.graphics.shaders.glsl` | built | 1 2 3 |
| `core.render.graphics.shaders.translate` | built | 1 2 3 |
| `core.render.graphics.shaders.hooks` | built | 1 2 3 |
| `core.render.graphics.parity` | built | 1 2 3 |
| `core.render.drawing` | 100% (4 built, 0 partly / 4) | 1 2 3 |
| `core.render.drawing.renderer` | built | 1 2 3 |
| `core.render.drawing.instancing` | built | 1 2 3 |
| `core.render.drawing.text` | built | 1 2 3 |
| `core.render.drawing.quality` | built | 1 2 3 |
| `core.render.look` | 40% (2 built, 0 partly / 5) | 1 2 3 |
| `core.render.look.materials` | built | 1 2 3 |
| `core.render.look.lights` | planned | 2 3 |
| `core.render.look.shadows` | built | 1 2 3 |
| `core.render.look.post` | planned | 2 |
| `core.render.look.cutaway` | planned |  |
| `core.render.style` | 36% (2 built, 1 partly / 7) | 1 2 3 |
| `core.render.style.ramp` | built | 1 2 3 |
| `core.render.style.blend` | partly |  |
| `core.render.style.lens` | planned |  |
| `core.render.style.theme` | built |  |
| `core.render.style.pattern` | 0% (0 built, 0 partly / 3) |  |
| `core.render.style.pattern.fill` | proposed |  |
| `core.render.style.pattern.stroke` | proposed |  |
| `core.render.style.pattern.along` | proposed |  |
| `core.render.project` | 100% (2 built, 0 partly / 2) | 1 2 3 |
| `core.render.project.project` | built | 1 2 3 |
| `core.render.project.visible` | built |  |
| `core.render.reveal` | 100% (4 built, 0 partly / 4) | 1 2 3 |
| `core.render.reveal.modes` | built | 1 2 3 |
| `core.render.reveal.timing` | built | 1 2 3 |
| `core.render.reveal.define` | built | 1 2 3 |
| `core.render.reveal.policy` | built | 1 2 3 |
| `core.render.capture` | 50% (1 built, 0 partly / 2) |  |
| `core.render.capture.capture` | built |  |
| `core.render.capture.ground-truth` | planned |  |
| `core.interaction` | 71% (5 built, 0 partly / 7) | 1 2 3 |
| `core.interaction.picking` | 100% (2 built, 0 partly / 2) | 1 2 3 |
| `core.interaction.picking.picking` | built | 1 2 3 |
| `core.interaction.picking.hover` | built | 1 2 3 |
| `core.interaction.events` | built | 1 2 3 |
| `core.interaction.signals` | 50% (1 built, 0 partly / 2) | 1 2 3 |
| `core.interaction.signals.signals` | planned |  |
| `core.interaction.signals.selection` | built | 1 2 3 |
| `core.interaction.controllers` | built | 1 2 3 |
| `core.interaction.history` | planned |  |
| `core.entities` | 44% (11 built, 8 partly / 34) | 1 2 3 |
| `core.entities.sets` | 50% (1 built, 0 partly / 2) | 2 |
| `core.entities.sets.sets` | built | 2 |
| `core.entities.sets.crowds` | planned | 2 |
| `core.entities.identity` | 33% (1 built, 0 partly / 3) | 2 |
| `core.entities.identity.id` | planned | 2 |
| `core.entities.identity.kind` | built | 2 |
| `core.entities.identity.data` | planned | 2 |
| `core.entities.placement` | 67% (1 built, 2 partly / 3) | 1 2 3 |
| `core.entities.placement.place` | partly | 2 |
| `core.entities.placement.thing` | built | 1 2 3 |
| `core.entities.placement.attach` | partly | 2 |
| `core.entities.locomotion` | 33% (2 built, 0 partly / 6) | 1 2 3 |
| `core.entities.locomotion.none` | planned | 2 |
| `core.entities.locomotion.rail` | planned | 2 3 |
| `core.entities.locomotion.lanes` | planned | 2 |
| `core.entities.locomotion.surface` | built | 1 2 3 |
| `core.entities.locomotion.air` | built | 1 2 3 |
| `core.entities.locomotion.water` | planned | 2 |
| `core.entities.kinematics` | 60% (2 built, 2 partly / 5) | 2 |
| `core.entities.kinematics.hinge` | built | 2 |
| `core.entities.kinematics.slider` | built | 2 |
| `core.entities.kinematics.wheel` | partly | 2 |
| `core.entities.kinematics.ball` | planned | 2 |
| `core.entities.kinematics.custom` | partly | 2 |
| `core.entities.body` | 83% (2 built, 1 partly / 3) | 2 |
| `core.entities.body.skeleton` | built | 2 |
| `core.entities.body.skin` | built | 2 |
| `core.entities.body.morphs` | partly | 2 |
| `core.entities.motion` | 21% (0 built, 3 partly / 7) | 2 |
| `core.entities.motion.states` | planned | 2 |
| `core.entities.motion.clips` | partly | 2 |
| `core.entities.motion.poses` | planned | 2 |
| `core.entities.motion.ik` | planned | 2 |
| `core.entities.motion.gaits` | partly | 2 |
| `core.entities.motion.blending` | partly | 2 |
| `core.entities.motion.look` | planned | 2 |
| `core.entities.drive` | 40% (2 built, 0 partly / 5) | 1 2 3 |
| `core.entities.drive.schedule` | planned | 2 |
| `core.entities.drive.simulation` | planned | 2 |
| `core.entities.drive.data` | built | 2 |
| `core.entities.drive.player` | built | 1 2 3 |
| `core.entities.drive.script` | planned | 2 |
| `core.simulation` | 21% (7 built, 0 partly / 33) | 1 2 |
| `core.simulation.agents` | 0% (0 built, 0 partly / 6) | 2 |
| `core.simulation.agents.behaviour` | planned | 2 |
| `core.simulation.agents.rhythm` | planned | 2 |
| `core.simulation.agents.habitat` | planned |  |
| `core.simulation.agents.senses` | planned |  |
| `core.simulation.agents.populations` | planned | 2 |
| `core.simulation.agents.tiers` | planned | 2 |
| `core.simulation.fields` | 40% (2 built, 0 partly / 5) | 1 |
| `core.simulation.fields.raster` | built | 1 |
| `core.simulation.fields.surface` | planned |  |
| `core.simulation.fields.graph` | planned |  |
| `core.simulation.fields.volume` | planned |  |
| `core.simulation.fields.kernels` | built | 1 |
| `core.simulation.rules` | 50% (2 built, 0 partly / 4) | 1 |
| `core.simulation.rules.presets` | built | 1 |
| `core.simulation.rules.custom` | built |  |
| `core.simulation.rules.coupling` | planned |  |
| `core.simulation.rules.regimes` | planned |  |
| `core.simulation.fidelity` | 0% (0 built, 0 partly / 2) |  |
| `core.simulation.fidelity.fixed` | planned |  |
| `core.simulation.fidelity.observed` | planned |  |
| `core.simulation.measure` | 33% (1 built, 0 partly / 3) | 1 |
| `core.simulation.measure.probes` | built | 1 |
| `core.simulation.measure.sensors` | planned |  |
| `core.simulation.measure.validation` | planned |  |
| `core.simulation.constants` | built | 1 |
| `core.simulation.phenomena` | 8% (1 built, 0 partly / 12) | 1 |
| `core.simulation.phenomena.heat` | built | 1 |
| `core.simulation.phenomena.fluids` | planned |  |
| `core.simulation.phenomena.fire` | planned |  |
| `core.simulation.phenomena.light` | planned |  |
| `core.simulation.phenomena.acoustics` | planned |  |
| `core.simulation.phenomena.contacts` | planned |  |
| `core.simulation.phenomena.orbits` | 0% (0 built, 0 partly / 4) |  |
| `core.simulation.phenomena.orbits.ephemerides` | planned |  |
| `core.simulation.phenomena.orbits.tle` | planned |  |
| `core.simulation.phenomena.orbits.n-body` | planned |  |
| `core.simulation.phenomena.orbits.transfers` | planned |  |
| `core.simulation.phenomena.exchanges` | planned |  |
| `core.simulation.phenomena.growth` | planned |  |
| `core.world` | 69% (15 built, 3 partly / 24) | 1 2 3 |
| `core.world.elements` | 83% (2 built, 1 partly / 3) | 1 2 3 |
| `core.world.elements.element` | built | 1 2 3 |
| `core.world.elements.props` | partly |  |
| `core.world.elements.order` | built |  |
| `core.world.settings` | 100% (3 built, 0 partly / 3) | 1 2 3 |
| `core.world.settings.params` | built | 1 2 3 |
| `core.world.settings.readouts` | built | 1 2 3 |
| `core.world.settings.points` | built |  |
| `core.world.state` | 67% (2 built, 0 partly / 3) | 1 2 3 |
| `core.world.state.states` | built |  |
| `core.world.state.settled` | built | 1 2 3 |
| `core.world.state.json` | planned |  |
| `core.world.describe` | 50% (1 built, 1 partly / 3) |  |
| `core.world.describe.describe` | planned |  |
| `core.world.describe.schemas` | partly |  |
| `core.world.describe.guide` | built |  |
| `core.world.extend` | 50% (1 built, 1 partly / 3) |  |
| `core.world.extend.extend` | built |  |
| `core.world.extend.provide` | planned |  |
| `core.world.extend.hot-swap` | partly |  |
| `core.world.lifecycle` | 100% (3 built, 0 partly / 3) | 1 2 3 |
| `core.world.lifecycle.world` | built | 1 2 3 |
| `core.world.lifecycle.errors` | built | 1 2 3 |
| `core.world.lifecycle.dispose` | built | 1 2 3 |
| `core.world.host` | 50% (3 built, 0 partly / 6) | 1 2 3 |
| `core.world.host.canvases` | planned |  |
| `core.world.host.plain` | built | 1 2 3 |
| `core.world.host.react` | planned |  |
| `core.world.host.zebflow` | planned |  |
| `core.world.host.server-safe` | built |  |
| `core.world.host.package` | built | 1 2 3 |
| `core.runtime` | 66% (10 built, 1 partly / 16) | 1 2 3 |
| `core.runtime.frame` | built |  |
| `core.runtime.detail` | 100% (3 built, 0 partly / 3) | 1 2 3 |
| `core.runtime.detail.detail` | built | 1 2 3 |
| `core.runtime.detail.priorities` | built |  |
| `core.runtime.detail.prefetch` | built | 1 2 3 |
| `core.runtime.budget` | 100% (3 built, 0 partly / 3) | 1 2 3 |
| `core.runtime.budget.budget` | built | 1 2 3 |
| `core.runtime.budget.governor` | built | 1 2 3 |
| `core.runtime.budget.memory` | built | 1 2 3 |
| `core.runtime.workers` | 50% (1 built, 1 partly / 3) | 1 2 3 |
| `core.runtime.workers.workers` | built | 1 2 3 |
| `core.runtime.workers.servers` | planned |  |
| `core.runtime.workers.compile` | partly |  |
| `core.runtime.partners` | 0% (0 built, 0 partly / 3) |  |
| `core.runtime.partners.external-engine` | planned |  |
| `core.runtime.partners.fmi` | planned |  |
| `core.runtime.partners.experiment` | planned |  |
| `core.runtime.telemetry` | 67% (2 built, 0 partly / 3) | 1 2 3 |
| `core.runtime.telemetry.telemetry` | built |  |
| `core.runtime.telemetry.remote-log` | built | 1 2 3 |
| `core.runtime.telemetry.shots` | planned |  |
| `modules` | 37% (49 built, 4 partly / 139) | 1 2 3 |
| `modules.shared` | planned |  |
| `modules.world` | 36% (39 built, 2 partly / 110) | 1 2 3 |
| `modules.world.surface` | 83% (5 built, 0 partly / 6) | 1 2 3 |
| `modules.world.surface.tiles` | built | 1 2 3 |
| `modules.world.surface.imagery` | built | 1 2 3 |
| `modules.world.surface.terrain` | built | 1 2 3 |
| `modules.world.surface.street-detail` | built | 1 2 3 |
| `modules.world.surface.provenance` | planned |  |
| `modules.world.surface.sky` | built | 1 2 3 |
| `modules.world.plane` | built |  |
| `modules.world.sun` | planned |  |
| `modules.world.earth` | 36% (33 built, 2 partly / 94) | 1 2 3 |
| `modules.world.earth.shared` | partly |  |
| `modules.world.earth.body` | 60% (9 built, 0 partly / 15) | 1 2 3 |
| `modules.world.earth.body.earth` | built | 1 2 3 |
| `modules.world.earth.body.base` | 57% (8 built, 0 partly / 14) | 1 2 3 |
| `modules.world.earth.body.base.imagery` | 80% (4 built, 0 partly / 5) | 1 2 3 |
| `modules.world.earth.body.base.imagery.esri` | built | 1 2 3 |
| `modules.world.earth.body.base.imagery.osm` | built |  |
| `modules.world.earth.body.base.imagery.sentinel` | built |  |
| `modules.world.earth.body.base.imagery.mapbox` | planned |  |
| `modules.world.earth.body.base.imagery.custom` | built |  |
| `modules.world.earth.body.base.terrain` | 50% (3 built, 0 partly / 6) | 1 2 3 |
| `modules.world.earth.body.base.terrain.mapzen` | built | 1 2 3 |
| `modules.world.earth.body.base.terrain.grid` | built |  |
| `modules.world.earth.body.base.terrain.gebco` | planned |  |
| `modules.world.earth.body.base.terrain.etopo` | planned |  |
| `modules.world.earth.body.base.terrain.lidar` | proposed | 3 |
| `modules.world.earth.body.base.terrain.custom` | built |  |
| `modules.world.earth.body.base.basemap` | planned |  |
| `modules.world.earth.body.base.coast` | planned |  |
| `modules.world.earth.body.base.offline` | built |  |
| `modules.world.earth.ground` | 0% (0 built, 0 partly / 6) | 3 |
| `modules.world.earth.ground.terrain` | 0% (0 built, 0 partly / 2) | 3 |
| `modules.world.earth.ground.terrain.terraform` | planned | 3 |
| `modules.world.earth.ground.terrain.looks` | planned |  |
| `modules.world.earth.ground.subsurface` | 0% (0 built, 0 partly / 4) |  |
| `modules.world.earth.ground.subsurface.strata` | planned |  |
| `modules.world.earth.ground.subsurface.wells` | planned |  |
| `modules.world.earth.ground.subsurface.aquifers` | planned |  |
| `modules.world.earth.ground.subsurface.magma` | planned |  |
| `modules.world.earth.air` | 83% (10 built, 0 partly / 12) | 1 2 3 |
| `modules.world.earth.air.atmosphere` | 100% (3 built, 0 partly / 3) | 1 2 3 |
| `modules.world.earth.air.atmosphere.scattering` | built | 1 2 3 |
| `modules.world.earth.air.atmosphere.haze` | built | 1 2 3 |
| `modules.world.earth.air.atmosphere.clouds` | built | 1 2 3 |
| `modules.world.earth.air.weather` | 100% (4 built, 0 partly / 4) | 1 2 3 |
| `modules.world.earth.air.weather.presets` | built | 1 2 3 |
| `modules.world.earth.air.weather.wind` | built | 1 2 3 |
| `modules.world.earth.air.weather.rain` | built | 1 2 3 |
| `modules.world.earth.air.weather.fog` | built | 1 2 3 |
| `modules.world.earth.air.sky` | 60% (3 built, 0 partly / 5) | 1 2 3 |
| `modules.world.earth.air.sky.sun` | built | 1 2 3 |
| `modules.world.earth.air.sky.moon` | built | 1 2 3 |
| `modules.world.earth.air.sky.stars` | built | 1 2 3 |
| `modules.world.earth.air.sky.cultures` | planned |  |
| `modules.world.earth.air.sky.locks` | planned |  |
| `modules.world.earth.water` | 43% (3 built, 0 partly / 7) | 1 2 3 |
| `modules.world.earth.water.hydrology` | 33% (1 built, 0 partly / 3) | 1 2 3 |
| `modules.world.earth.water.hydrology.water` | built | 1 2 3 |
| `modules.world.earth.water.hydrology.flow` | planned |  |
| `modules.world.earth.water.hydrology.channels` | planned | 2 3 |
| `modules.world.earth.water.sea` | 50% (2 built, 0 partly / 4) |  |
| `modules.world.earth.water.sea.level` | planned |  |
| `modules.world.earth.water.sea.shore` | built |  |
| `modules.world.earth.water.sea.look` | built |  |
| `modules.world.earth.water.sea.exposed` | planned |  |
| `modules.world.earth.climate` | 50% (1 built, 0 partly / 2) | 1 |
| `modules.world.earth.climate.heat` | built | 1 |
| `modules.world.earth.climate.fire` | planned |  |
| `modules.world.earth.life` | 0% (0 built, 0 partly / 5) |  |
| `modules.world.earth.life.society` | planned |  |
| `modules.world.earth.life.ecology` | planned |  |
| `modules.world.earth.life.places` | 0% (0 built, 0 partly / 2) |  |
| `modules.world.earth.life.places.lots` | planned |  |
| `modules.world.earth.life.places.blocks` | planned |  |
| `modules.world.earth.life.soundscape` | planned |  |
| `modules.world.earth.analysis` | 0% (0 built, 0 partly / 2) |  |
| `modules.world.earth.analysis.geo` | planned |  |
| `modules.world.earth.analysis.learn` | planned |  |
| `modules.world.earth.presets` | 24% (10 built, 1 partly / 44) | 1 2 3 |
| `modules.world.earth.presets.built` | 23% (8 built, 1 partly / 37) | 1 2 3 |
| `modules.world.earth.presets.built.roads` | 50% (3 built, 0 partly / 6) | 1 2 3 |
| `modules.world.earth.presets.built.roads.sections` | built | 1 2 3 |
| `modules.world.earth.presets.built.roads.junctions` | planned | 2 |
| `modules.world.earth.presets.built.roads.markings` | built | 1 2 3 |
| `modules.world.earth.presets.built.roads.decks` | planned | 2 |
| `modules.world.earth.presets.built.roads.sidewalks` | built | 1 2 3 |
| `modules.world.earth.presets.built.roads.elevated` | planned | 2 |
| `modules.world.earth.presets.built.rail` | 0% (0 built, 0 partly / 4) | 2 3 |
| `modules.world.earth.presets.built.rail.track` | planned | 2 3 |
| `modules.world.earth.presets.built.rail.crossings` | planned | 2 3 |
| `modules.world.earth.presets.built.rail.viaducts` | planned | 2 3 |
| `modules.world.earth.presets.built.rail.stations` | proposed | 2 3 |
| `modules.world.earth.presets.built.buildings` | 50% (4 built, 1 partly / 9) | 1 2 3 |
| `modules.world.earth.presets.built.buildings.footprints` | built | 1 2 3 |
| `modules.world.earth.presets.built.buildings.cityjson` | planned |  |
| `modules.world.earth.presets.built.buildings.typology` | built | 2 |
| `modules.world.earth.presets.built.buildings.facades` | planned | 2 3 |
| `modules.world.earth.presets.built.buildings.roofs` | built | 1 2 3 |
| `modules.world.earth.presets.built.buildings.windows` | built | 1 2 3 |
| `modules.world.earth.presets.built.buildings.frontage` | partly | 2 |
| `modules.world.earth.presets.built.buildings.landmarks` | proposed | 3 |
| `modules.world.earth.presets.built.buildings.interiors` | proposed | 3 |
| `modules.world.earth.presets.built.furniture` | 0% (0 built, 0 partly / 6) | 3 |
| `modules.world.earth.presets.built.furniture.benches` | proposed | 3 |
| `modules.world.earth.presets.built.furniture.bollards` | proposed | 3 |
| `modules.world.earth.presets.built.furniture.bins` | proposed | 3 |
| `modules.world.earth.presets.built.furniture.umbrellas` | proposed | 3 |
| `modules.world.earth.presets.built.furniture.signs` | proposed | 3 |
| `modules.world.earth.presets.built.furniture.planters` | proposed | 3 |
| `modules.world.earth.presets.built.infrastructure` | 11% (1 built, 0 partly / 9) |  |
| `modules.world.earth.presets.built.infrastructure.energy` | 0% (0 built, 0 partly / 4) |  |
| `modules.world.earth.presets.built.infrastructure.energy.wind-turbine` | proposed |  |
| `modules.world.earth.presets.built.infrastructure.energy.solar-farm` | proposed |  |
| `modules.world.earth.presets.built.infrastructure.energy.pylon` | proposed |  |
| `modules.world.earth.presets.built.infrastructure.energy.substation` | proposed |  |
| `modules.world.earth.presets.built.infrastructure.mobility` | 100% (1 built, 0 partly / 1) |  |
| `modules.world.earth.presets.built.infrastructure.mobility.charger` | built |  |
| `modules.world.earth.presets.built.infrastructure.utilities` | 0% (0 built, 0 partly / 4) |  |
| `modules.world.earth.presets.built.infrastructure.utilities.pole` | proposed |  |
| `modules.world.earth.presets.built.infrastructure.utilities.lines` | proposed |  |
| `modules.world.earth.presets.built.infrastructure.utilities.pipe` | proposed |  |
| `modules.world.earth.presets.built.infrastructure.utilities.cabinet` | proposed |  |
| `modules.world.earth.presets.built.lights` | 0% (0 built, 0 partly / 3) | 2 3 |
| `modules.world.earth.presets.built.lights.street` | planned | 2 3 |
| `modules.world.earth.presets.built.lights.vehicle` | planned | 2 |
| `modules.world.earth.presets.built.lights.windows` | planned | 2 |
| `modules.world.earth.presets.mobility` | 0% (0 built, 0 partly / 3) | 2 |
| `modules.world.earth.presets.mobility.traffic` | planned | 2 |
| `modules.world.earth.presets.mobility.signals` | planned | 2 |
| `modules.world.earth.presets.mobility.transit` | planned | 2 |
| `modules.world.earth.presets.living` | 50% (2 built, 0 partly / 4) | 1 2 3 |
| `modules.world.earth.presets.living.plants` | 50% (2 built, 0 partly / 4) | 1 2 3 |
| `modules.world.earth.presets.living.plants.species` | built | 1 2 3 |
| `modules.world.earth.presets.living.plants.growth` | planned | 3 |
| `modules.world.earth.presets.living.plants.sway` | planned | 2 |
| `modules.world.earth.presets.living.plants.canopy` | built | 1 2 3 |
| `modules.world.moon` | planned |  |
| `modules.world.mars` | planned |  |
| `modules.world.space` | 0% (0 built, 0 partly / 6) |  |
| `modules.world.space.satellites` | 0% (0 built, 0 partly / 1) |  |
| `modules.world.space.satellites.tle` | planned |  |
| `modules.world.space.asteroids` | planned |  |
| `modules.world.space.stars` | planned |  |
| `modules.world.space.constellations` | planned |  |
| `modules.world.space.galaxies` | planned |  |
| `modules.world.space.exoplanets` | planned |  |
| `modules.presets` | 39% (10 built, 2 partly / 28) | 1 2 3 |
| `modules.presets.shared` | 33% (1 built, 0 partly / 3) | 2 |
| `modules.presets.shared.locomotion` | 33% (1 built, 0 partly / 3) | 2 |
| `modules.presets.shared.locomotion.lane-follower` | planned | 2 |
| `modules.presets.shared.locomotion.rail-follower` | planned | 2 |
| `modules.presets.shared.locomotion.walker` | built | 2 |
| `modules.presets.humans` | 62% (7 built, 2 partly / 13) | 2 3 |
| `modules.presets.humans.body` | built | 2 3 |
| `modules.presets.humans.face` | built | 2 |
| `modules.presets.humans.expressions` | 38% (1 built, 1 partly / 4) | 2 |
| `modules.presets.humans.expressions.emotions` | partly |  |
| `modules.presets.humans.expressions.visemes` | planned |  |
| `modules.presets.humans.expressions.gestures` | planned |  |
| `modules.presets.humans.expressions.blink` | built | 2 |
| `modules.presets.humans.hair` | built | 2 |
| `modules.presets.humans.clothing` | partly | 2 |
| `modules.presets.humans.poses` | built | 2 |
| `modules.presets.humans.gaits` | built | 2 |
| `modules.presets.humans.people` | built | 2 |
| `modules.presets.humans.speech` | planned |  |
| `modules.presets.humans.vrm` | planned | 2 |
| `modules.presets.animals` | 0% (0 built, 0 partly / 4) |  |
| `modules.presets.animals.quadruped` | planned |  |
| `modules.presets.animals.bird` | planned |  |
| `modules.presets.animals.fish` | planned |  |
| `modules.presets.animals.reptile` | planned |  |
| `modules.presets.vehicles` | 20% (1 built, 0 partly / 5) | 1 2 3 |
| `modules.presets.vehicles.car` | built | 1 2 3 |
| `modules.presets.vehicles.motorbike` | planned | 2 |
| `modules.presets.vehicles.bus` | planned | 2 |
| `modules.presets.vehicles.minibus` | planned | 2 |
| `modules.presets.vehicles.train` | planned | 2 3 |
| `modules.presets.drones` | built | 1 2 3 |
| `modules.presets.robots` | 0% (0 built, 0 partly / 2) |  |
| `modules.presets.robots.robot` | planned |  |
| `modules.presets.robots.android` | planned |  |
| `kits` | 50% (6 built, 0 partly / 12) | 1 2 3 |
| `kits.dashboard` | 100% (4 built, 0 partly / 4) | 1 |
| `kits.dashboard.legend` | built | 1 |
| `kits.dashboard.cards` | built |  |
| `kits.dashboard.stats` | built | 1 |
| `kits.dashboard.layers` | built |  |
| `kits.game` | 100% (2 built, 0 partly / 2) | 1 2 3 |
| `kits.game.avatars` | built | 1 2 3 |
| `kits.game.collision` | built | 1 2 3 |
| `kits.authoring` | 0% (0 built, 0 partly / 6) | 3 |
| `kits.authoring.networks` | planned |  |
| `kits.authoring.zones` | planned |  |
| `kits.authoring.rules` | planned |  |
| `kits.authoring.terraform` | planned |  |
| `kits.authoring.diffs` | planned | 3 |
| `kits.authoring.pieces` | proposed | 3 |
| `tools` | 27% (8 built, 5 partly / 39) | 1 2 3 |
| `tools.geo` | planned |  |
| `tools.scan` | 0% (0 built, 0 partly / 5) | 3 |
| `tools.scan.classify` | proposed | 3 |
| `tools.scan.align` | proposed | 3 |
| `tools.scan.fit` | proposed | 3 |
| `tools.scan.clean` | proposed | 3 |
| `tools.scan.grid` | proposed | 3 |
| `tools.bake` | partly |  |
| `tools.compile` | 20% (1 built, 4 partly / 15) |  |
| `tools.compile.run` | 33% (1 built, 0 partly / 3) |  |
| `tools.compile.run.on-save` | planned |  |
| `tools.compile.run.command` | built |  |
| `tools.compile.run.page` | planned |  |
| `tools.compile.inputs` | partly |  |
| `tools.compile.steps` | 14% (0 built, 2 partly / 7) |  |
| `tools.compile.steps.solve` | partly |  |
| `tools.compile.steps.resolve` | planned |  |
| `tools.compile.steps.mesh` | planned |  |
| `tools.compile.steps.assign` | planned |  |
| `tools.compile.steps.solids` | planned |  |
| `tools.compile.steps.logic` | planned |  |
| `tools.compile.steps.manifest` | partly |  |
| `tools.compile.custom-steps` | planned |  |
| `tools.compile.options` | planned |  |
| `tools.compile.stale` | planned |  |
| `tools.compile.outputs` | partly |  |
| `tools.convert` | 0% (0 built, 0 partly / 6) | 3 |
| `tools.convert.fbx` | planned |  |
| `tools.convert.ifc` | planned |  |
| `tools.convert.citygml` | planned |  |
| `tools.convert.las` | planned | 3 |
| `tools.convert.usd` | planned |  |
| `tools.convert.i3s` | proposed |  |
| `tools.export` | 0% (0 built, 0 partly / 1) |  |
| `tools.export.usd` | planned |  |
| `tools.checks` | 100% (7 built, 0 partly / 7) | 1 2 3 |
| `tools.checks.smoke` | built | 1 2 3 |
| `tools.checks.parity` | built | 1 2 3 |
| `tools.checks.twins` | built | 1 2 3 |
| `tools.checks.regressions` | built | 1 2 3 |
| `tools.checks.suite` | built |  |
| `tools.checks.perf` | built | 1 2 3 |
| `tools.checks.recipes` | built |  |
| `tools.catalog` | planned |  |
| `tools.cli` | planned |  |
| `tools.mcp` | planned |  |
