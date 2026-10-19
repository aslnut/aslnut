# core › runtime

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist).

**In one line:** how a world runs without blocking the frame: the frame itself; detail (render detail: what the current view needs at what level of detail, what drops first, what loads next; invisible by rule: it never changes what is shown or its colour); the budget (a governor holds the frame time, memory limits evict what is far); workers on the device, servers you call and the compiler on the authoring machine; partners (external engines, FMI models, experiments) that trade values each step; and telemetry (counters, the remote log, shots).

Plain meaning: the **runtime** is how and where code runs on its own schedule (a **lane**: the frame, a worker thread, a server), and what each view is given within its budget.

Concepts: [observation](../../concepts/observation.md) (presence by level lives in core › observation; here only render detail) · [performance](../../concepts/performance.md) · [compile](../../concepts/compile.md) · [live twins](../../concepts/live-twins.md)

<!-- tree:reference/core/runtime -->
```tree
runtime/
├── frame
├── detail/
│   ├── detail
│   ├── priorities
│   └── prefetch
├── budget/
│   ├── budget
│   ├── governor
│   └── memory
├── workers/
│   ├── workers
│   ├── servers
│   └── compile
├── partners/
│   ├── external-engine
│   ├── fmi
│   └── experiment
└── telemetry/
    ├── telemetry
    ├── remote-log
    └── shots
```
<!-- /tree -->

## API

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `frame` | automatic (draw on demand) · `world(canvas, { frames })` · `w.everyFrame(fn, o)` · a layer's `wantsFrames(s)` | `frames.max?: number` (the most frames a second any one animation gets; default every display frame) · `frames.rate?: (layer, wants, s) => number` (your rule: lower a layer's rate, or 0 to freeze it) · `frames.rest?: ms \| false = 500` (stillness after motion before the loop rests; after a change of its own on a still, settled view, a layer shown or faded, it rests at the next frame: one frame drawn, two asked) · `frames.light?: ms = 60000` (time 'now': a look at the light) · everyFrame: `fn: (s, dt) => void` · `fps?: number = every frame` (0: none asked) · `budgetMs?: number = 1` · `before?: boolean = false` (run before the frame is drawn, after the clock moved and before the camera's own update: a camera set there is this frame's, not the next one's) | everyFrame: the function that turns it off · `wantsFrames`: 0 none, Infinity every display frame, n a second | [built] (a still view draws 0 frames and its loop rests: no display frames asked, woken by a touch, an invalidate, a resize, a flight; a layer asks for frames only while shown, for what its last frame drew: chunks fading in, clock-reading materials by distance (near every frame, mid 30, far 10), moving things on screen by how fast they cross it (a pixel a frame), flowing dashes by their pace, a storm between flashes 10, a time-lapse's sun 0.02° a frame; checked on WebGPU and WebGL2 by smoke-city `rest`) | `w.everyFrame((s, dt) => hud.update(s), { fps: 10 })` |
| `detail/detail` | automatic; `detail: { error, levels }` per element · a shape's levels by the pixels it covers: `solids({ pixels: { full, simple, margin } })`, `entities({ pixels })`, a set's `near: { levels: { full, simple, margin } }` (or one pinned: `level`) · `keptLevel(v, prev, a, b, 1 + margin, byDistance)` | `error?: number = 2` (pixels of allowed error) · `levels?: LevelRules` · `margin?: share = .2` (a level changes only past its edge by this share of it; the eye moving a few metres is the dwell) | the level of detail per tile or object: coarse first, never a hole, never a visible change of look or colour (a shape's simpler version, a coarser tile; never what is shown: that is the observation level) | [built] (a shape's level is chosen per instance (a solids layer's sized sets, a set's things) by the pixels it covers as shown (within its range on screen), kept within the margin: a camera wobbling at an edge flips none (300 turbines and 400 cars: 282 and 219 changes without it, 0 with it); a chunk's levels by distance the same; the governor's detail raises the edges (coarser sooner) and every sized set is sorted again; the swap is one frame: never a hole) | `earth({ detail: { error: 1.5 } })` |
| `detail/priorities` | `world(canvas, { priorities })` · `w.setPriorities(p)` | `drop?: string[]` (first dropped first: a rung of the world's ('detail', 'shadows', 'quality', 'resolution') or an element by id: its own detail ¾, ½, ¼ (coarser levels sooner, fewer copies over time; never hidden: that is your call, on the governor's event)) · `keep?: string[]` (never dropped: a kept element draws at full detail whatever the world's; a kept rung is never taken) | — | [built] (the app's order first, the world's rungs after in their own; a change gives back everything dropped and makes the ladder again; each element draws at its own detail (`element.detailOf(s)`); checked on WebGPU and WebGL2 with a budget no frame meets: the stacks and their smoke stepped first, then the world's detail; the budget taken away, all of it back) | `priorities: { drop: ['smoke', 'shadows'], keep: ['fleet', 'labels'] }` |
| `detail/prefetch` | `w.prefetch(views, opts)` · automatic for a flight's end (`w.fly`), camera keys and moves of a second or more (`w.play`) and a recording's way (`w.record({ path })`) | `views: (View \| name \| Pose)[]` · `depth?: int = 1` (coarser levels loaded first) · `timeout?: ms = 30000` | `Promise<{ needed, have }>` (the tiles in) | [built] (the ground's tiles load with room left, between frames too: a still view draws nothing for it, but a frame a second while it waits for room (the tiles make it on their own clock); the elements of the levels the views are looked at get ready too (between frames, a few ms at a time: a known way's levels, as the gates' ahead does for the orbit nearing an edge); only sources whose terms allow prefetching: a tile loaded ahead without a show-only source (Esri, OSM) is a look of its own, never taken for the whole one, loaded whole when the view reaches it; a new call replaces the views) | `await w.prefetch(['city', 'port'])` |
| `budget/budget` | `world(canvas, { budget })` · `w.setBudget(b \| null)` · `w.governor` (the budget, what is dropped) | `'auto'` (the default: the device's, `{ frameMs: 22 }` on phones, tablets and low tiers, none elsewhere) · `false` (none) · or yours: `frameMs?: number` (ms between frames; over at 1.5 ×) · `memoryMB?: number` (graphics memory) · `triangles?: number` · `drawCalls?: number` (each unset one is not measured; no budget: no governor) | — | [built] (in the package; auto by default (phones held to 30 frames a second at the least), with the quality the device picks (`quality: 'auto'`, the default: lite on WebGL2, touch screens and low tiers) and the reason in `w.reason`; also the loader's memory budget, a per-frame upload budget for tiles, dynamic resolution while the view moves (`world({ resolution: { moving } })`)) | `budget: { frameMs: 33, memoryMB: 400 }` |
| `budget/governor` | automatic with a budget; `world(canvas, { governor })` · `w.on('governor', f)` | `stepDownAfter?: frames = 10` · `stepUpAfter?: frames = 120` (twice as long each time a step up is soon undone) · `ladder?: { name, down(), up() }[]` (default: detail first, ¾ and ½ (`s.render.detail`: coarser ground tiles, nearer levels of detail), the sun's shadow map half, a quarter, off, quality lite, and only then the pixel ratio, by quarters down to `resolution.floor` (default 1.5, or the screen's when less), the picture smoothed by FXAA while it is cut (`resolution.antialias`: `'auto'` the default, `true` every frame, `false` never)) · `false`: measured, never stepped | events `{ step: 'down' \| 'up', dropped: string[], why }` | [built] (samples are frames drawn after a drawn frame on the real clock: their gap, the main thread's ms, the chip's where known, draws, triangles, graphics memory) | `w.on('governor', e => log(e.dropped))` |
| `budget/memory` | `world(canvas, { memory: { limitMB, evict } })` · `loader.setMemory(bytes, evict)` | `limitMB?: number` (default from the device's memory, 192 at most) · `evict?: 'least-seen' \| ({ key, bytes, seenMsAgo }) => number = 'least-seen'` (the lowest score out first) | — | [built] (the loader's decoded tiles and data; an `evict` event each) | `memory: { limitMB: 350 }` |
| `workers/workers` | `workers.worker(module, opts)` · `lane.call(name, ...args)` · `lane.callIn(at, name, ...args)` (in that worker: what your module keeps there, a cache, kept once) · `workers.serve(fns)` (in the worker) · `heavy: true` on layers | `module: URL \| () => Worker` · `count?: int = cores − 2 (1 … 4)` · `transfer?: boolean = true` · `fallback?: Record<name, fn>` (the main thread's, where workers cannot run) | `WorkerLane` with `call(name, ...args)` | [built] (calls go to the least busy worker; typed arrays in the answer move without a copy; the street level builds its tiles there (with your houses and trees) and its near whole meshes on demand, the baked roads their tiles' meshes and the ground under them (the clamp, in one worker of the lane) (one lane can serve all: `serve({ ...streetsWorker(look), ...bakedRoadsWorker() })`); a streamed layer starts its builds as the lane has room (two a worker, the nearest first) and puts their answers inside the frames, about 3 ms a frame for all of them; the loader's own pool decodes images; `heavy` planned) | `const tiles = lanes.worker(() => new Worker(new URL('./tiles.worker.ts', import.meta.url), { type: 'module' }))` |
| `workers/servers` | `workers.server(url, opts)` | `url: string` · `timeout?: ms = 10000` · `retry?: int = 2` | `Server lane` with `call(name, args)` | [planned] | `workers.server('https://api.example/route')` |
| `workers/compile` | runs on the authoring machine (studio after save, command line, compile page) · `compile(opts)` | see [tools › compile](../tools.md) · `workers?: int = cores` | `Promise<Manifest>` | [planned] | `await compile({ inputs, out: './compiled' })` |
| `partners/external-engine` | `w.partner(id, opts)` | `url: string` (WebSocket or HTTP) · `send: s => object` · `receive: (out, s) => void` · `step?: seconds = 1` · `sync?: 'lockstep' \| 'loose' = 'loose'` | `Partner` (`stop()`, `status`) | [planned] | `w.partner('fleet', { url: 'wss://sim.example/step', send, receive })` |
| `partners/fmi` | `w.partner(id, fmi(url, opts))` | `url: string` (an `.fmu`) · `inputs: Record<var, path>` · `outputs: Record<var, path>` · `runs?: 'worker' \| 'server' = 'worker'` | `Partner` | [planned] | `w.partner('chiller', fmi('/chiller.fmu', { inputs: { load: 'building.load' } }))` |
| `partners/experiment` | `w.serve(opts)` · `aslnut serve --experiment` | `step: 'sync'` (the world waits for the caller) · `actors?: Entity[]` · `sensors?: Probe[]` · `port?` | a socket protocol: step, set, read, add actors, read sensors | [planned] | `w.serve({ step: 'sync', sensors: [cam1, lidar] })` |
| `telemetry/telemetry` | `w.telemetry()` · the observation panel · `g.memory()` (a graphics' holdings by label) | — | `{ frameMs, frameP95, cpuMs, gpuMs, draws, triangles, memoryMB, tiles, loading, dropped, budget, quality: { now, auto, tier, why }, frames: { fps, wants, who, resting, restedMs }, elements: [{ id, draws, triangles, ms, gpuMB, wants }], memory: [{ id, MB }] }` | [built] (every layer's share of the frame and the chip's memory, never hidden; the healthy-city panel shows it; WebGPU and WebGL2 alike) | `panel.show(w.telemetry())` |
| `telemetry/remote-log` | `world(canvas, { log: url \| options })` · `w.log(ev, data)` | `url: string` (takes POSTed JSON lines) · `level?: 'warn' \| 'info' = 'warn'` (warn: errors, the governor's steps, frames over 100 ms; info: and a heartbeat a second (frame times p50 / p95, draws, tiles, pixel ratio, graphics MB, what is dropped), long frames, your events) · `fields?: object \| () => object` (on every line) · `every?: ms = 2000` (batched) · `send?: (url, body) => void` | events from phones reach your machine | [built] (the healthy-city example's phone log runs on it) | `world(canvas, { log: { url: '/api/log', level: 'info', fields: { page: 'city' } } })` |
| `telemetry/shots` | `w.shot(opts?)` | `send?: url` · `state?: boolean = true` (attach `w.describe()` + stats) | a screenshot + the state, for bugs you only see on a real phone | [planned] (a research prototype exists) | `w.shot({ send: '/api/shot' })` |

## Example

Draw on demand (a still view costs nothing):

```ts
const w = await world(canvas, { frames: { max: 30, rate: (l, wants) => (l.id === 'crowd' ? Math.min(wants, 15) : wants) } });
const off = w.everyFrame((s, dt) => hud.update(s), { fps: 4 });   // your own animation asks for its frames
w.telemetry().frames;     // { fps: 0, wants: 0, who: '', resting: true, … }: nothing drawn, the loop rests
class Beacon extends Element {                                         // a layer says what it needs, for what is on screen
  wantsFrames(s) { return this.onScreen ? (this.near ? Infinity : 10) : 0; }
}
```

Render detail and budget:

```ts
const w = await world(canvas, {
  body: earth(),
  budget: { frameMs: 22, memoryMB: 500 },             // set: the governor holds it; unset: nothing measured
  memory: { limitMB: 300 },
  priorities: { drop: ['crowd', 'shadows'], keep: ['labels', 'fleet'] }, // the crowd (an element) first, the fleet never
  log: { url: '/api/log', level: 'info' },            // a phone's heartbeat, errors and budget steps
});
w.on('governor', e => console.log(e.step, e.dropped)); // 'down' ['shadows half', 'detail 0.75']
```

Workers and partners:

```ts
w.partner('fleet', {
  url: 'wss://sim.example/step',          // an external engine (e.g. a fleet simulation's own engine)
  send:    s => ({ t: s.time.t, closures: s.world.closures }),
  receive: out => fleet.upsertMany(out.vehicles),
  sync: 'lockstep', step: 1,
});
```

## Open questions

- (detail) Should the governor be able to lower the frame rate target (60 → 30) before dropping detail? (`frames.max` caps the animations' own frames today; the governor does not move it)
- (detail) One panel shape for every app, or a telemetry API and each app draws its own?
- (workers) Lock-step partners slower than the frame: pause the clock, or keep drawing with interpolation?
- (workers) FMUs in a worker need a WebAssembly build of the model: which FMI tools can produce one?
