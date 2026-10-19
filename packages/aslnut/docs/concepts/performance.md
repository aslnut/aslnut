# Phones and performance

> Draft under discussion. Interface and structure only.

**In one line:** aslnut keeps a phone smooth with a **budget** per frame, a **governor** that steps detail down and up to hold it, **priorities** you set per app, **workers** that keep heavy work off the frame, whole cities **streamed in tiles**, and **memory limits** that evict what's far away.

## Why

- **Phones are the main device** for many users; a twin that only runs on a desktop isn't used.
- **Smooth beats detailed:** a steady 60 (or 30) frames per second matters more than one more building.
- **Different apps value different things:** a dashboard values labels; a game values the street around the player.

## The rules

1. **A budget per frame:** `budget: { frameMs: 16, memoryMB: 600, triangles: 1.5e6 }`.
2. **The governor** watches real frame times and steps down when frames run long (lower levels, fewer far tiles, lite quality), then steps back up slowly when there's room.
3. **Priorities** say what drops first and what never drops: `drop: ['shadows', 'far-buildings', 'crowd']`, `keep: ['labels', 'selection']`.
4. **Workers** decode tiles, build shapes and run CPU paths; **lanes** separate the frame, workers, partners and servers so none blocks another.
5. **Stream in tiles:** terrain, imagery, buildings and [compiled](compile.md) chunks load near the camera first; far away only coarse levels.
6. **Memory limits:** least-recently-seen tiles and meshes are evicted first; nothing in view is.
7. **Device tiers** set starting points: `s.device.tier` is `low | mid | high`, from caps and a short probe.
8. **Everything is visible** in the observation panel: frame ms, what was dropped, tiles loaded, memory.

```tree
performance/
├── budget/
│   ├── frame
│   ├── memory
│   └── triangles
├── governor/
│   ├── step-down
│   └── step-up
├── priorities/
│   ├── drop
│   └── keep
├── workers
├── lanes/
│   ├── frame
│   ├── workers
│   ├── partners
│   └── servers
├── streaming/
│   ├── tiles
│   ├── chunks
│   └── prefetch
├── memory/
│   ├── limits
│   └── eviction
├── tiers
└── telemetry
```

Plain meanings: **frame ms** = how long one picture takes; 16 ms ≈ 60 per second; **evict** = drop from memory, to be loaded again if needed.

## What runs today (0.1)

The frame's foundation, on WebGPU and WebGL2 alike (measured by `tools/perf.mjs`; its budgets fail the run):

- **Draw on demand** (`renderOnChange`, default on; `frames` to tune it): a still, settled view draws nothing, and after half a second its loop **rests**: it stops asking the display for frames, so a phone's main thread sleeps too (it looks 4 times a second for what data streams bring, and a touch, an invalidate, a resize or a flight wakes it at once). What changes by itself asks for frames itself, only while it is shown, and at its own rate (see [building an element](#building-an-element-frames-and-the-budget)). Measured on a phone's view (390 × 844 at dpr 2, WebGL2 on a chip): the street, the region and the twin dashboard each drew 30 to 60 frames a second while still; now 0.
- **A steady pixel ratio** (1.5 at the most at quality lite, the WebGL2 and touch-device default on either graphics; 2 at realistic). Dynamic resolution (`resolution: { moving }`: lower while the view moves) is there when asked, off by default: each switch resizes the canvas, a hitch at the start and the end of every gesture, and measured on phones a steady 1.5 is smoother.
- **Uploads inside the frame, within a budget** (about 2 ms): a burst of arriving tiles never makes a long frame; tiles a fast zoom went past are not uploaded.
- **As many tiles as a view needs, no more:** at quality lite a 256-pixel tile is split once it would cover more than 384 CSS pixels (the usual web-map density); terrain comes from tiles two levels coarser than the imagery (`terrain.mapzen({ coarser })`, default 2: one request and one decode serve 16 imagery tiles, still 64 × 64 samples each for the 33 × 33 heights).
- **The first view is shown complete, not revealed:** a tile with nothing under it appears at once; it fades (280 ms) only over a coarser piece already shown, and heights that come with the imagery rise with that fade. Heights that come later rise over 600 ms under a picture already shown.
- **Hidden layers a zoom away, and layers hidden by hand (`w.hide`), are prepared ahead** (`layer.prepare`): their data loads, their shapes are built a few ms at a time and their programs for the ground's tiles are compiled, between frames when nothing is drawn, so a layer that shows in the middle of a zoom (or on a button) does not stall it. A hidden layer never holds the view back nor keeps frames coming.
- **Nothing written that a frame in flight reads:** WebGL2 gives a buffer written whole fresh storage, the tiles' records are three textures in turn; on WebGPU the passes into the ground's tiles go with the frame in one submit, pipelines are built in the background, and the depth of the last pass is not stored.
- **Decoded off the main thread:** imagery by the browser's image decoder, uploaded as it is (no canvas, no pixels through JavaScript); terrain heights in workers.
- **Levels held a little longer while moving** (hysteresis): no flicker of tile levels in a slow zoom; a still view always gets the same tiles.
- **Picking on demand:** after the frame, at most every 50 ms, never while the camera moves, read back without stalls. A pointer moving over a still view is answered from the last frame's calls: no frame is drawn for it, only when what is hovered changes. Areas drawn into the ground's tiles are picked on the CPU, at the place on the ground under the pointer (the camera's ray stepped down to the terrain): drawing them into a picking pass cost every vertex of the layer for each pick (2.4 million for a country's 1 000 regions, every 50 ms while a pointer moved).
- **Draped on the ground, exactly:** areas and lines on the ground are drawn where the ground is under each pixel, so no hill pokes through them whatever the terrain does, and nothing is re-read per vertex when the terrain sharpens. At quality lite (the WebGL2 and touch-device default) a mark is drawn into the ground's own tiles where that pays: relief under it, and the mark holding still. Then it is one pass a frame, the mark drawn again only when it changes, and a hovered feature redraws only the tiles under it. On level ground it takes the flat route instead (one face per piece, the same pixels, no overlay memory), and a mark that changes every frame (a trail's clock, flowing dashes, a pulse) never goes into the tiles, which would all be drawn again each frame. The 64 MB of tile overlays exist only while some mark is in the tiles. `groundMarks: 'tiles' | 'prisms'` (the world's, or a layer's own) chooses the route for every mark. A layer fading in or out redraws the tiles in steps of 80 ms of the world's clock (every layer on the same steps, its end exact), not every frame of the fade; a tile showing an older look keeps it until it is drawn again. At realistic, prisms over the frame (`'prisms'`).
- **A still view does no work for its features:** each feature's `when` (and a filter) is asked again only when a field of `s` it read changed (see [presence](presence.md)); points are written to the chip once and moved by the view in the shader, not rewritten per frame.
- **Reveals are short in an app** (a fade of 0.25 s at most; the full reveal in a video, see [reveal](reveal.md)), so a drill-down never animates for seconds.
- **No allocation in the hot paths** of the tile tree, the tile cache and labels.
- **Dispose leaves nothing behind:** `w.dispose()` frees every buffer, texture, program and target on the chip, closes the WebGPU device or the WebGL2 context, closes the decoded images it held, and lets go of every observer, so the world (and its canvas, its data and its tiles) can be collected. `liveGraphics()` tells what the graphics of the page still hold, on WebGPU and WebGL2 alike: a page that makes world after world (a dashboard's views, a test suite) can check that it does not grow. Measured: 20 worlds made and disposed in a row on one page hold 0 graphics, 0 buffers and 0 textures after each, with the page's memory flat (each world was once kept whole by a long-task observer: one more for every world, until a phone closed the tab).
- **The observation panel** shows CPU ms per frame, draw calls, uploads, the heap, how often the view was idle, and frame times (p50, p95, max).

## Building an element: frames and the budget

This is how every element is built (a mark, a layer, a twin's part), the library's own and yours. An element that follows it costs nothing while the view is still, and its share of each frame is visible.

**Frames: say what you need, for what is on screen.**

1. **Nothing by default.** `wantsFrames(s)` returns 0: a still layer is drawn only when something else draws.
2. **Something changed once** (your data came in, a prop was set): call `world.invalidate()`. One frame is drawn. Never keep frames coming for it.
3. **Something changes by itself** (a shader reading `time`, things moving, a fade): return the frames a second it needs.
   - `Infinity`: every display frame (close, fast, or a short fade).
   - `n`: n a second, where a lower rate looks the same. `motionFrames(pxPerSecond)` gives the rate at which on-screen motion steps at most a pixel a frame (a walker far away: a few a second; near: every frame). Far clock-reading materials take 30 or 10.
   - `0`: when it is off screen, out of range, or too small to see. Things off screen wait where they are until frames come again.
4. **Answer for the last frame you drew,** with no side effects: the world asks between frames, as often as it likes, and only while your element is shown. A hidden element is never asked.
5. **Your own work each frame** (a HUD, a marker of yours) goes in `w.everyFrame(fn, { fps })`, never in a loop of your own: it asks for its frames the same way and rests with the world.
6. **The app has the last word:** `world({ frames: { max: 30, rate: (layer, wants, s) => … } })` caps or lowers any element's rate, or freezes it (0).

**The budget: read it, and be counted.**

1. **Leave the defaults on:** `quality: 'auto'` (the device's pick: lite on WebGL2, phones, tablets and low tiers) and `budget: 'auto'` (a phone is held to 30 frames a second at the least). The governor then adapts the quality to measured frame times: it drops detail, shadows, quality and resolution one step at a time, and gives them back slowly. `&quality=` in the example (or `world({ quality })`) overrides it.
2. **Read the governor's levers** in your frame: `s.render.detail` (1, ¾ or ½: scale your distances, sizes and counts by it) and `s.render.quality` (your look).
3. **Name what you put on the chip:** give every buffer and texture a label starting with your element's id (`${this.id} tiles`). `w.telemetry()` then counts its memory as yours.
4. **Keep the frame's own work small:** heavy work goes to workers, or to `prepare()` between frames while you are hidden.
5. **Look at the cost:** `w.telemetry()` gives each element's draws, triangles, ms, graphics memory and the frames it wants, against the budget. The healthy-city panel (≡) shows it on the phone.

```ts
class Beacons extends Element<BeaconProps> {
  frame(ctx) { this.seen = …; this.near = …; return draws; }   // remember what this frame showed
  wantsFrames() { return !this.seen ? 0 : this.near ? Infinity : 10; }   // a pulse: every frame near, 10 a second far
}
const w = await world(canvas, {});                    // quality 'auto', budget 'auto': the defaults are the practice
w.telemetry().elements;                               // [{ id: 'beacons', draws: 1, triangles: 12, ms: 0.04, gpuMB: 0.1, wants: 10 }, …]
```

## Examples

```ts
// 1 · a phone-friendly world
const w = await world(canvas, {
  body: earth(),
  budget: { frameMs: 16, memoryMB: 500 },
  priorities: { drop: ['crowd', 'shadows'], keep: ['labels', 'fleet'] },   // the crowd (an element) first, the fleet never
});

// 2 · a per-app choice by device tier
render: { quality: s => (s.device.tier === 'high' ? 'realistic' : 'lite') }

// 3 · watch it
w.on('governor', e => console.log(e.step, e.dropped));     // e.g. 'down', ['shadows']
w.telemetry();   // { frameMs, gpuMs, tiles, memoryMB, dropped }
```

## How it relates

- **[Observation](observation.md):** levels and the budget live there.
- **[Compile](compile.md):** pre-built chunks make whole cities fit.
- **[Graphics](graphics.md):** compute on WebGPU; CPU paths on WebGL2.
- **[Quality](quality.md):** the governor can lower quality.

## Common mistakes

- **Testing only on a desktop.** Test on the oldest phone you support.
- **Doing heavy work in `when` functions.** They run often; keep them cheap.

## Status

| part | status |
|---|---|
| detail levels, prefetch | [built] (the surface quadtree; prefetch where the terms allow) |
| the frame: draw on demand, resting, `wantsFrames`, `everyFrame` | [built] |
| frame telemetry | [built] (`w.telemetry()`: frame times, draws, triangles, memory, each layer's share, the frames wanted; `w.stats()`) |
| budget (auto by default), governor, memory limits, tiers, auto quality | [built] |
| priorities | [built] (the app's drop order first: a rung of the world's or an element by id (its own detail ¾, ½, ¼); kept ones never) |
| workers and lanes | [built] (workers); lanes for partners and servers [planned] |
| streaming compiled chunks | [planned] (a reference implementation exists) |
