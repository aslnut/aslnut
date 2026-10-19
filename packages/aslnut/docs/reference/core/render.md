# core › render

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist).

**In one line:** drawing both depiction (core › geometry) and encoding (core › encoding): graphics (WebGPU and WebGL2 behind one interface, the device's capabilities, shaders written twice and checked for parity); drawing (the renderer, instancing, text, quality tiers); the look (materials, lights, shadows, finishing effects, cutaways); style (ramps, blends, lenses, themes, patterns); projection (where a place falls on the screen, and whether it is seen); reveal (how elements appear and disappear); and capture (frames and ground truth for vision).

Concepts: [WebGPU and WebGL2](../../concepts/graphics.md) · [quality](../../concepts/quality.md) · [shapes: from your TypeScript to the screen](../../concepts/shapes.md#from-your-typescript-to-the-screen) · [underground](../../concepts/underground.md) · [configurable](../../concepts/configurable.md) · [order](../../concepts/order.md) · [interaction](../../concepts/interaction.md) · [observation](../../concepts/observation.md) · [encoding and layers](../../concepts/encoding.md) · [boundaries](../../concepts/boundaries.md) · [reveal](../../concepts/reveal.md)

<!-- tree:reference/core/render -->
```tree
render/
├── graphics/
│   ├── interface
│   ├── webgpu
│   ├── webgl2
│   ├── caps
│   ├── shaders/
│   │   ├── wgsl
│   │   ├── glsl
│   │   ├── translate
│   │   └── hooks
│   └── parity
├── drawing/
│   ├── renderer
│   ├── instancing
│   ├── text
│   └── quality
├── look/
│   ├── materials
│   ├── lights
│   ├── shadows
│   ├── post
│   └── cutaway
├── style/
│   ├── ramp
│   ├── blend
│   ├── lens
│   ├── theme
│   └── pattern/
│       ├── fill
│       ├── stroke
│       └── along
├── project/
│   ├── project
│   └── visible
├── reveal/
│   ├── modes
│   ├── timing
│   ├── define
│   └── policy
└── capture/
    ├── capture
    └── ground-truth
```
<!-- /tree -->

## API: graphics, drawing and look

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `graphics/interface` | `Graphics { buffer, texture, target, layerTarget, copyLayers, program, frame, readTexture, caps, stats, lost, bytes, destroy }` | `TextureDesc { width, height, layers?, growable? (its layers copied into a bigger one: `copyLayers(from, to, layers)`, a pool grown by need; false where WebGL2 cannot draw into floats, or when the copy did not land: the pool stays as it was), format: 'rgba8' \| 'rgba32f' \| 'r32f', filter?, renderable? }` · `ProgramDesc { wgsl, glsl: { vertex, fragment }, blocks, textures, instance?, vertex?, blend, depth, cull, overlay?, format? }` · `FrameOptions { clear, read?, target? }` | handles · `Promise<pixels>` · `Promise<Float32Array \| Uint8Array>` | [built] (one interface, WebGPU and WebGL2; float textures drawn into (a field's step, caps.floatTargets) and read back without stalling the chip) | `g.frame([{ program, blocks, textures, count: 3 }], { target: g.layerTarget(next, 0), clear: [0, 0, 0, 0] })` |
| `graphics/webgpu` | `world(canvas, { graphics: 'webgpu' })` | — | the WebGPU implementation | [built] | `graphics: 'webgpu'` |
| `graphics/webgl2` | `world(canvas, { graphics: 'webgl2' })` | — | the WebGL2 implementation; starts at `lite` | [built] | `graphics: 'webgl2'` |
| `graphics/caps` | `supported()` · `w.caps` | — | `{ api: 'webgpu' \| 'webgl2' \| null, compute, timer, floatTargets, maxTex, f16, tier }` | [built] | `if (!(await supported()).api) showUnsupported()` |
| `graphics/shaders/wgsl` | `shader({ wgsl })` | `wgsl: string` (written first) | a shader half | [built] | `mesh.wgsl.ts` |
| `graphics/shaders/glsl` | `shader({ glsl })` | `glsl: string` (the twin, GLSL ES 3.0) · your own shader lines (reveal and extension hooks): [open] a small WGSL → GLSL writer, your decision | a shader half | [built] | `mesh.glsl.ts` |
| `graphics/shaders/translate` | `translateStatements(code, scope)` · `translateModule(code)` | `code: string` (the WGSL subset: scalars, vectors, matrices, fixed arrays, let / var / const, if / for / while, functions, the math built-ins, swizzles; not yet: your own structs, textures, pointers, `loop`) | GLSL ES 3.0, or an `E-SHADER-001` error with your line, column and the fix | [built] | `translateStatements('color = vec4f(1.0);', scope)` |
| `graphics/shaders/hooks` | `shader: { color, position, alpha, reveal, functions }` on a layer · `params: { gain: 1.5 }` · `layer.setShader(code)` | per hook point, documented inputs (`position`, `normal`, `uv`, `value`, `time`, `params.<name>`) and outputs (`color`, `position`, `size`, `alpha`) | your code in the WGSL program as written and in the GLSL twin translated; params are uniforms (`w.set('id.gain', 2)`); `setShader` swaps live and keeps the old program if the new one fails | [built] | `points({ data, params: { gain: 2 }, shader: { color: 'color = vec4f(color.rgb * params.gain, color.a);' } })` |
| `graphics/parity` | `parity(scene, opts)` (a CI tool) | `scene: SceneFile` · `max?: number = 1` (mean difference out of 255) | `{ mean, max, pass }` | [built] | `parity('crates.json')` → `{ mean: .94, pass: true }` |
| `drawing/renderer` | owned by the world: device, frame loop, resize, dispose | `pixelRatio?: number = min(devicePixelRatio, 2)` · `fps?: 60 \| 30 = 60` | — | [built] | `world(canvas, { render: { pixelRatio: 1.5 } })` |
| `drawing/instancing` | automatic for shapes and points · one size rule for every mark and shape: a point's, a quad's or a label's `size: n \| { px, min?, max? } \| { m, min?, max? }`, a line's, an arc's or a trail's `width` the same, a shape's `size: { min?, max? }` (`shape({ size })`, `entities({ size })`, a set's `near.size`) · `sizePxAt(v, units, dist, mpp)` | `max?: int = 65536` per draw · a size: CSS px (a value or your function of the feature), or `m` metres, either kept within `min`..`max` CSS px | one draw per mesh | [built] (points, labels and `custom` draw one instanced quad per feature; solids draw shapes by instances (trees: one shape, many places, each turned, scaled, coloured), one draw a form and level for every chunk of a layer (its clones' records in one texture, each naming its chunk; each level's list of them made again only when the view or the data changes), on WebGPU and WebGL2 (no extension); the size rule is one function of the frame shader every program shares (sizePx, sizeKeep): metres become the CSS px they cover where the thing is seen, in the vertex stage, so a zoom writes nothing (no restyle, no rebuild); a shape in its range is scaled round its foot (its shadow too: the view's eye in the shadow map's pass); a label in metres is drawn at the size it is shown, in steps of an eighth of an octave kept within a fifth of a step) | `points({ data, size: { m: 40, min: 4, max: 32 } })` · `line({ data, width: { m: d => d.props.lanes * 3.5, min: 1 } })` · `shape({ build, far, size: { min: 8, max: 40 } })` |
| `drawing/text` | `text({ data, text, size, halo, collide })` | `text: Fn<string>` · `size?: Fn<number> = 12` · `halo?: number = 1.5` · `collide?: boolean = true` | element | [built] | `text({ data: towns, text: d => d.props.name })` |
| `drawing/quality` | `world(canvas, { render: { quality } })` (or `{ quality }`) · `w.setQuality(q \| null)` · `s.render.quality` | `quality: 'auto' \| Fn<'lite' \| 'realistic'>` (a value or your function of the state; `'auto'`, the default: the device's pick, lite on WebGL2, touch screens and low tiers (memory, cores), with the reason in `w.reason` and `w.telemetry().quality`) | — | [built] (setQuality and the governor's drop come before your function; with the device's budget (`budget: 'auto'`) the governor adapts it to measured frame times, a step down after 10 frames over, back up after 120 with room, twice as long each time a step up is soon undone; every `when` with `quality` and the looks read it) | `quality: s => (s.device.tier === 'high' ? 'realistic' : 'lite')` |
| `look/materials` | `material` on every builder verb and in raw meshes (`mb.material(code)`) · `material(kind, opts)` · `material.custom({ fragment, vertex?, uniforms?, varyings?, functions?, blend? })` · a solids layer's `imagery: { source, zoom }` and `windows: { lit, interior }` | `kind: 'matte' \| 'concrete' \| 'painted' \| 'glass' \| 'metal' \| 'emissive' \| 'foliage' \| 'water' \| 'flat' \| 'facade' \| 'imagery' \| 'interior' \| 'pbr' \| 'wire' \| 'ghost'` · pbr `roughness?: 0..1 = .5`, `metal?: 0..1 = 0` · ghost `opacity?: 0..1 = .35` · imagery: the layer's `imagery: { source: RasterSource, zoom?: 17, size?: px = 512 }` · custom: your fragment (`color`, `base`, `normal`, `position`, `id`, `time`, varyings, `params.*`) and vertex code (`position`, `normal`) in the WGSL subset, `m.set(name, v)` | `Material` | [built] (lit kinds carried with every vertex and lit their way on WebGPU and WebGL2; 'flat': its own colour, unlit; 'pbr': roughness and metalness in eight steps each (a GGX highlight, Schlick's Fresnel, the sky in it, the diffuse share lit with shadows); 'facade': a wall with windows a floor and a bay apart drawn in the shader (no geometry per window), lit at night as windows are; 'interior': glass with rooms behind it (a floor, a ceiling, walls), lit or dark at night; 'imagery': the imagery under it seen from above (a chunk's square read from your source at its zoom, only for chunks that have such pieces); wet: the world's rain darkens matte, concrete and physically based surfaces and makes them glossy (the weather's wetness); 'wire': the surface's edges as lines (a sphere net); raw lines (`b.mesh(points, { lines: true })`); 'ghost' blended after the layer's opaque things; your own shader per material; each kind's program made the first time it is drawn (none used: none made)) | `b.solid('sphere', { radius: 4, material: material('pbr', { roughness: .25, metal: 1 }) })` · `b.solid('box', { size: [20, 30, 20], material: 'facade' })` |
| `look/lights` | `lights({ data, color, radius })` | `color?: Fn<color> = '#ffd9a0'` · `radius?: Fn<number> = 20` · `when?` | element (many small lights) | [planned] | `lights({ data: streetLamps, when: { hour: [18, 6] } })` |
| `look/shadows` | `world(canvas, { render: { shadows } })` · `w.setShadows(o)` | `shadows?: boolean \| { from: 'sun', distance: 2000 } = false` | — | [built] (a shadow map from the sun over the part of the view near the camera, texel-snapped to the ground; an 8-bit colour target holding packed depth, drawn by the casters' picking twins and read with four taps by every lit program, on WebGPU and WebGL2 alike; `w.setShadows(o)`, `w.shadowReport()`; options `distance`, `size`, `strength`; the map is kept while its casters' buffers and textures (`GTexture.version`: written, copied into, drawn into) stay as they were, drawn again when one changed; the same on the earth and on a flat floor with a sun: `plane({ sky: sky() })`) | `render: { shadows: { distance: 1500 } }` |
| `look/post` | `render: { post }` | `aa?: boolean = true` · `ao?: boolean = false` · `bloom?: number = 0` · `grade?: Grade` (colour look-up) · `taa?: boolean` (smooth edges over frames) · `reflections?: 'ground' \| false` · `sky?: 'hdri' \| 'physical'` · `skyOcclusion?: 'baked' \| false` (darker street canyons) | — | [planned] | `render: { post: { ao: true, bloom: .2 } }` |
| `look/cutaway` | `w.cutaway(options)` | `kind: 'box' \| 'plane' \| 'trench' \| 'around-camera'` · `along?: Line` · `depth?: number` · `when?` | `Cutaway` (removable) | [planned] | `w.cutaway({ kind: 'trench', along: section, depth: 4000 })` |

## API: style

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `style/ramp` | `ramp(name \| colours \| stops \| fn, opts?)` · `colours(ramp, n)` | `name: 'viridis' \| 'inferno' \| 'magma' \| 'plasma' \| 'turbo' \| 'cividis' \| 'reds' \| 'blues' \| 'greens' \| 'oranges' \| 'purples' \| 'greys' \| 'ylorrd' \| 'ylgnbu' \| 'rdylgn' \| 'rdbu' \| 'spectral' \| 'category' \| 'set2' \| 'pastel'` · or `[t, colour][]` · `reverse?` | `(t: 0..1) => colour` (`.stops`) | [built] | `ramp([[0, '#023'], [1, '#f80']])(0.4)` |
| `style/blend` | `blend: mode` on any element | `mode: 'normal' \| 'multiply' \| 'screen' \| 'add' = 'normal'` | — | [partly] (rasters and the ground: built; vector layers: planned) | `raster({ id: 'night', blend: 'screen' })` |
| `style/lens` | `w.lens(name \| looks)` | `name: 'analytic' \| 'photoreal' \| 'cartographic'` (land cover, biomes and colours follow the lens) · or `looks: { imagery?, base?, tint?, shade? }` | — | [planned] (a research prototype exists) | `w.lens('analytic')` |
| `style/theme` | an analysis view: `world(canvas, { theme })` · `w.setTheme(t \| null, { seconds? })` · `w.theme` · `w.themeNow` · `theme.dark \| grey \| light (opts?)` · `theme.none()` · `theme.custom(spec)` · `theme.define(spec)` (a preset of your own) · a layer's `subject: true` | `grey?: 0..1 = 1` · `tint?: colour` · `tintAmount?: 0..1 = .75` (with a tint) · `brightness?: number = 1` · `contrast?: number = 1` · `ground?: number = 1` (× the ground's brightness after the rest: darker than what stands on it) · `sky?: { amount?: 0..1 = 1, color? } \| false` (the sky and its haze, through the sky's own `dim`) · `subjects?: string[] \| (layer) => boolean` · `ramp?: Ramp = 'viridis'` (the subjects' one colour scale) · `seconds?: number = 1` · `when?: When` · presets: `dark` (blue-grey, the ground .55, the sky '#151c28'), `grey`, `light` | `Theme { name, spec, ramp, scale.linear \| quantile \| category … (value, opts), subject(layer), mute(rgb, amount) }` | [built] (one step every program shares, WGSL and GLSL twins (`themed` in the frame block's code): the ground and its imagery, the solids (buildings, roads, trees, every material, impostors), people, areas, lines, arcs, extrusions, points, labels, custom layers, fields, rain, stars, a flat world's sky; the Earth's sky and its haze through the sky's `dim`. Its subjects keep their colour: the layers it names or that are marked, the selected and the hovered things, what a solids layer tints; they draw with a copy of the frame block that mutes nothing (no extra draws). Eased over `seconds`, from one theme to another; the marks drawn into the ground's tiles redrawn as the muting changes (in 125 ms steps while it eases). No theme: nothing of it worked out) | `w.setTheme(theme.dark({ subjects: ['transit'], ramp: 'turbo' }))` · `line({ id: 'transit', data, subject: true, color: t.scale.category((d) => d.props.route) })` · `world(canvas, { theme: theme.grey({ when: { toggle: 'analysis' } }) })` |
| `style/pattern/fill` | `pattern: { fill }` on any area, extrusion or the ground | `kind: 'dots' \| 'hex' \| 'hatch' \| 'cross' \| 'grid' \| Image \| (uv) => number` · `spacing?: number` · `size?: number \| Fn<number>` (dot size by data: a dot-density look) · `angle?: degrees` · `space?: 'world' \| 'screen' = 'world'` · `jitter?: 0..1` · `color?` · `background?` · `fade?: when` | — (drawn in the shader: no extra geometry, the same on WebGPU and WebGL2) | [proposed] | `area({ data: land, pattern: { fill: { kind: 'hex', spacing: 6, size: d => d.props.influence } } })` |
| `style/pattern/stroke` | `pattern: { stroke }` on any line, arc or outline | `dash?: number[]` · `dots?: { spacing, size }` · `flow?: speed` (the pattern moves along the line) · `space?: 'world' \| 'screen'` | — | [proposed] | `arc({ data: routes, pattern: { stroke: { dash: [6, 4], flow: 20 } } })` |
| `style/pattern/along` | `pattern: { along }` on any line | `symbol: 'chevron' \| 'arrow' \| 'tick' \| Image` · `spacing` · `size` · `offset?` · `flow?` | — | [proposed] | `line({ data: river, pattern: { along: { symbol: 'chevron', spacing: 40, flow: 8 } } })` |

## API: projection

The projection maths: where a place falls on the screen, and whether it can be seen from the eye. The camera that moves it is the orbit (core › observation › observers › orbit).

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `project/project` | `w.project(at)` · its inverse `w.unproject([x, y])` | `at: [lon, lat, h?] \| point name` · `[x, y]`: CSS px on the canvas | `[x, y] \| null` (screen pixels; null when behind the camera) · `[lon, lat] \| null` (the place on the ground under the point: the camera's ray down to the terrain, on the flat map, the globe and a tilted view alike; null: the sky) | [built] | `const xy = w.project('fault.mid')` · `const ll = w.unproject([e.offsetX, e.offsetY])` |
| `project/visible` | `w.visible(at)` | `at: [lon, lat, h?] \| point name` | `boolean` (false when terrain hides it) | [built] | `if (w.visible(peak)) label.show()` |

## API: reveal

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `reveal/modes` | `reveal: mode \| { mode }` · `reveal: { video, app }` (world option `context`) · `w.reveal(id)` · `w.hide(id)` · `w.release(id)` | line: `trace` (from a place with `from`, a soft front `soft`, a glowing head `head: { glow }`), `pulse`, `fade` · area: `trace-fill`, `grow`, `wipe`, `radial`, `sweep`, `fade` · point, extrusion: `sweep`, `pop`, `rise`, `fade` · text: `type`, `count`, `mask`, `fade` | — (plays when shown changes; backwards when hidden; new features play theirs) | [built] (`ripple` for grids planned) | `line({ data, reveal: { mode: 'trace', from: substation, head: { glow: 1 } } })` |
| `reveal/timing` | `reveal: { dur, ease, stagger, order, reverse }` | `dur?: seconds = .8` · `ease?: Ease = 'smooth'` · `stagger?: seconds = 0` · `order?: (d, s) => number` · `reverse?: boolean = false` | — | [built] | `reveal: { mode: 'rise', order: d => d.props.dist, stagger: .02 }` |
| `reveal/define` | `reveal.define(name, spec)` | `feature?: (d, p, s) => { opacity?, offset?: [east, north, up] m, scale? }` · `wgsl?: string` (at `/*@reveal*/`, reads `reveal`, `position`, writes `alpha`; translated for WebGL2) · `base?: mode` | a new mode name | [built] | `reveal.define('drop-in', { feature: (d, p) => ({ opacity: p, offset: [0, 0, (1 - p) * 300] }) })` |
| `reveal/policy` | world option `context: 'app' \| 'video' = 'app'` | app: a layer that asks for no app mode of its own gets a short fade (at most 0.25 s), no stagger · video: the full reveals (mode, timing, stagger capped so many features never take many seconds) · `reveal: { app: 'radial' }` asks for a rich mode in an app | — | [built] | `world(canvas, { context: 'video' })` |

## API: capture

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `capture/capture` | `w.frame(opts?)` · `w.record(opts)` | frame: `attribution?: boolean \| string` (the credits of every layer shown, data included, burned into the bottom right) · record: `fps?: number = 30` (the world's clock steps 1000 / fps ms a frame) · `frames?: int` or `seconds?: number` (unset: until the loop is left) · `size?: [width, height]` (the frame's pixels; unset: the canvas's) · `path?: Keys \| Move \| (t) => View` (the camera's way: what it will see loads ahead; unset: the move playing) · `ahead?: seconds = 2` · `timeout?: ms = 60000` (a frame's longest wait; past it the frame is taken as it is, said) · `attribution?` | frame: `Promise<{ width, height, pixels }>` · record: an async iterator of `{ index, t, width, height, pixels, settled, pending, waitedMs }` | [built] (each frame held at its moment until it is complete (its tiles in and faded, a level's swap done: the clock does not move meanwhile), then read back: the same frames on every run and on WebGPU and WebGL2; before the first frame the way's first seconds whole and all of it two levels coarser, then `ahead` seconds as it goes, the elements of the levels it will cross made ready; a provider whose terms allow no prefetching (show only) is never loaded ahead, a frame that needs it waits for it; the loop stops while it records, the governor holds still (what it had dropped comes back first); a camera set each frame belongs in `w.everyFrame(fn, { before: true })`; encoding the pixels (a video, a GIF) is the app's) | `for await (const f of w.record({ fps: 30, seconds: 37, path })) encoder.add(f.pixels)` |
| `capture/ground-truth` | `w.groundTruth(kinds)` | `kinds: ('segmentation' \| 'depth' \| 'boxes' \| 'normals')[]` | images and boxes per frame | [planned] | `await w.groundTruth(['segmentation', 'boxes'])` |

## Example

Graphics, look and capture:

```ts
const caps = await supported();
const w = await world(canvas, {
  graphics: 'auto',
  render: {
    quality: s => (s.device.api === 'webgpu' && s.device.tier === 'high' ? 'realistic' : 'lite'),
    shadows: { distance: 1500 }, post: { aa: true, ao: true },
  },
});
for await (const f of w.record({ fps: 30, seconds: 8, size: [1080, 1920], attribution: true })) frames.push(f.pixels);
```

Style (the scales themselves are core › encoding › scales):

```ts
area({ id: 'crime', data: joined, color: scale.quantile(d => d.props.rate, { range: 'reds', n: 5 }), blend: 'multiply' });
w.lens('analytic');
// an analysis view: the world grey, its subject (a line layer) in one colour scale
const t = theme.grey({ subjects: ['transit'], ramp: 'turbo' });
w.add(line({ id: 'transit', data: routes, color: t.scale.category((d) => d.props.route) }));
w.setTheme(t, { seconds: 1 });          // w.setTheme(null): eased out
```

Projection:

```ts
const xy = w.project('fault.mid');          // screen pixels, or null behind the eye
if (w.visible(peak)) label.show();          // not hidden by the terrain
```

Reveal:

```ts
area({ id: 'wkp', data, reveal: { mode: 'trace-fill', dur: 1.2, stagger: .08 } });
extrusion({ data: buildings, reveal: { video: 'rise', app: 'fade', order: d => d.props.distanceToFault } });
w.hide('grid', { mode: 'trace', reverse: true });
```

## Open questions

- (render) **Decided:** user shader code is a WGSL subset translated to GLSL ES 3.0 (`shaders/translate`); core shaders keep their hand twins, checked by the twin lint and the parity check. Open: which more of WGSL the subset takes next (textures, your own structs).
- (render) Shadows first, or ambient occlusion first?
- (render) Done: the renderer owns disposal (`w.dispose()` stops the loop and the observers and frees every graphics byte; tested on both graphics).
- (style) `theme` is now the analysis view (the world muted, its subjects in one colour scale). The row's earlier idea (the defaults every element starts from: a palette, type, labels, glow) is not built: keep it under `theme`, or move it to its own leaf? And `lens` ('analytic' …) overlaps the theme: should a lens become a theme preset plus land-cover looks?
- (projection) Done: the camera that moves the picture is the orbit (core › observation › observers › orbit); render keeps only the projection maths.
- (reveal) Translating a user's `wgsl` reveal for WebGL2: [open] (see [graphics](../../concepts/graphics.md)).
