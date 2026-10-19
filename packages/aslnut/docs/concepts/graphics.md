# WebGPU and WebGL2: how aslnut talks to the graphics chip

> Draft under discussion; its core was decided on 2026-10-09.

**In one line:** aslnut runs on **WebGPU and WebGL2 as equals, behind one interface**. Your code never knows which one is in use, and nothing ships unless it works on both.

Plain meanings: **WebGPU** = the new browser API for the graphics chip; **WebGL2** = the older one, available almost everywhere; **shader** = a small program that runs on the graphics chip; **WGSL** = WebGPU's shader language; **GLSL** = WebGL2's.

## Why

- **Many phones only have WebGL2,** especially older ones, or a browser without WebGPU.
- **Measured:** the renderers tested got the same frame rate on every phone (the graphics chip was the limit). Under load, WebGPU held quality more steadily.
- **Parity, measured on every example:** the same frame drawn with WebGPU and with WebGL2 differs by a mean of 0.000 to 0.007 / 255, with at most 0.008 % of pixels off by more than 32.

## The rule: both are first class

1. **No feature lands unless it works on both.** Where WebGPU would use compute, WebGL2 gets a CPU path or a fragment-shader pass, tested against the GPU path. Never "WebGPU only, later".
2. **Every test that draws runs on both.** The smoke test is run per graphics. The parity diff runs for every example preset, and a threshold fails the run.
3. **The examples show which one runs,** and offer `?graphics=webgpu` and `?graphics=webgl2` for every preset.
4. **Live recordings and phone-size checks are done on both,** with the numbers side by side.
5. **The shader twins live next to each other with the same structure.** A lint checks that every WGSL file has its GLSL twin, with the same functions in the same order and the same numbers in each.
6. **Errors and the observation panel say which one runs and why:** "WebGPU (auto: available here)", "WebGL2 (auto: no adapter)", "WebGL2, as asked · quality lite (the WebGL2 default)", "WebGPU (auto: available here) · quality lite (a touch device)".

## What the page still holds

`liveGraphics()` counts what the graphics made in this page still hold, WebGPU and WebGL2 alike: open graphics (a WebGPU device or a WebGL2 context each), buffers, textures, targets, programs, and their bytes on the chip. A disposed world leaves nothing there; a count that grows from one world to the next is a leak.

```ts
import { liveGraphics } from 'aslnut';
w.dispose();
liveGraphics();   // { graphics: 0, buffers: 0, textures: 0, targets: 0, programs: 0, bytes: 0, made: 12 }
```

## How it works

1. **One interface:** buffers, textures, programs, draw calls, and a capabilities report. Layers never call WebGPU or WebGL2 directly.
2. **Chosen once,** when the world starts: `graphics: 'auto' | 'webgpu' | 'webgl2'`. `'auto'` takes WebGPU when it works, otherwise WebGL2. A forced choice that isn't available fails with a `GraphicsUnavailable` error that says what this browser has.
3. **Capabilities → profile:** `caps = { api, compute, timer, floatTargets, maxTex, maxLayers, vertexTextures, f16, device }` picks the profile: quality, pixel ratio, tile memory.
4. **The same data on both:** tile records and heights are float textures read with `textureLoad` / `texelFetch`, and imagery is a 2D texture array. Neither path needs storage buffers, so both run the same logic.
5. **Clip space:** both shaders write WebGPU's depth range. The GLSL twin ends with `clipOut()`, which maps it to GL's.
6. **WebGL2 starts at the `lite` quality tier;** `realistic` stays available (see [quality](quality.md)).
7. **Layers declare, aslnut builds:** a layer gives its uniform blocks, textures, instance data and shader pair; aslnut makes the program for either API.

Mirroring traps the translator and the lint watch:
- `select(f, t, c)` ↔ `c ? t : f`;
- `%` on floats (WGSL truncates, GLSL's `mod` floors);
- integer ↔ float literals (GLSL ES has no implicit conversion);
- vector comparisons (`a < b` ↔ `lessThan(a, b)`);
- `let` needs a type in GLSL.

```tree
src/
└── core/
    └── render/
        ├── graphics/
        │   ├── interface.ts
        │   ├── webgpu.ts
        │   ├── webgl2.ts
        │   └── live.ts
        ├── caps.ts
        ├── renderer.ts
        └── shaders/
            ├── frame.wgsl.ts
            ├── frame.glsl.ts
            ├── sky.wgsl.ts
            ├── sky.glsl.ts
            ├── surface.wgsl.ts
            ├── surface.glsl.ts
            ├── points.wgsl.ts
            ├── points.glsl.ts
            ├── custom.wgsl.ts
            ├── custom.glsl.ts
            ├── translate.ts
            └── hooks.ts
tools/
├── twins.mjs
├── parity.mjs
└── smoke.mjs
```

| file | what it is |
|---|---|
| `graphics/interface.ts` | buffers, textures, programs, draw calls, caps |
| `graphics/webgpu.ts`, `webgl2.ts` | the two implementations of that interface |
| `graphics/live.ts` | what the page's graphics still hold (`liveGraphics()`) |
| `caps.ts` | what this browser can do, and the profile that follows |
| `renderer.ts` | the frame loop, the frame block, sizes, frame readback, dispose |
| `shaders/*.wgsl.ts` | written first |
| `shaders/*.glsl.ts` | the twins: the same functions in the same order |
| `shaders/translate.ts` | your shader code (a WGSL subset) → GLSL ES 3.0 |
| `shaders/hooks.ts` | the hook points, params as uniforms, custom layers |
| `tools/twins.mjs` | the twin lint |
| `tools/parity.mjs` | the same frame on both, pixel diff, fails over the threshold |
| `tools/smoke.mjs` | render, settle, read back, every hook, dispose: on both |

## Examples

```ts
import { supported, world, earth } from 'aslnut';
const s = await supported();             // { api: 'webgpu' | 'webgl2' | null, webgpu, webgl2, reason }
if (!s.api) showUnsupported(s.reason);   // say plainly what this browser has
const w = await world(canvas, { body: earth(), graphics: 'auto' });   // or 'webgpu' / 'webgl2'
w.api; w.reason;                         // 'webgl2', 'WebGL2 (auto: no WebGPU adapter) · quality lite (the WebGL2 default)'
```

## Write your own shader

You write one language, a **subset of WGSL**. aslnut puts your code into the WGSL program as written and, translated, into the GLSL twin, so it runs on WebGPU and WebGL2 alike. A mistake is reported with your line, your column and the fix, for example `line 2, col 9: vec4f(…) needs 4 components, got 3`.

**The subset:**
- types: `f32`, `i32`, `u32`, `bool`, vectors, square matrices, fixed arrays;
- statements: `let` / `var` / `const`, `if` / `else`, `for`, `while`, `break`, `continue`, `return`, `discard`;
- your own functions, and the math built-ins;
- swizzles and indexing.

Your own structs, textures and `loop {}` are not in it yet.

**1 · A hook in a layer's own shader.** Every layer that draws has named points: `position`, `color`, and for points also `alpha` and `reveal`. Each names the values you can read and the ones you can change. Params become uniforms by name.

```ts
points({
  id: 'cities', data,
  params: { gain: 1.5, tint: '#ff8800' },     // uniforms: params.gain, params.tint
  shader: { color: `color = vec4f(mix(color.rgb, params.tint, clamp(value / 10.0, 0.0, 1.0)) * params.gain, color.a);` },
});
w.set('cities.gain', 2);                       // reaches the shader next frame
```

| layer | hook | you can change | you can read |
|---|---|---|---|
| surface | `position` (vertex) | `position` | `uv`, `value` (height), `time` |
| surface | `color` (fragment) | `color` | `position`, `normal`, `uv`, `value`, `time` |
| points | `position` (vertex) | `position`, `size` | `value`, `time` |
| points | `color` (fragment) | `color` | `uv`, `value`, `time`, `position` |
| points | `alpha` (fragment) | `alpha` | `color`, `uv`, `value`, `time` |
| points | `reveal` (fragment) | `alpha` | `reveal` (0 → 1 as `when` fades it in), `uv`, `value`, `time` |

**2 · A whole layer of your own.** `custom()` draws one quad per item, either facing the screen (sized in CSS px) or lying on the ground (sized in metres). You give it per-item attributes, uniforms, varyings, and vertex and fragment code.

```ts
custom({
  id: 'heat', data, at: d => d.at, size: 600, shape: 'ground', blend: 'add',
  attributes: { value: d => d.v },
  uniforms: { gain: 1.2, tint: '#ff3d00' },
  varyings: { glow: 'f32' },
  vertex: `glow = value * params.gain;`,
  fragment: `let r = length(corner);
             color = vec4f(mix(vec3f(1.0, 0.85, 0.25), params.tint, clamp(glow, 0.0, 1.0)), smoothstep(1.0, 0.0, r) * glow);`,
});
```

**3 · Change it while it runs.** `layer.setShader(code)` builds the new program on the running graphics. If it fails, the old one keeps drawing and the error says why. The example's editor and the dev server's hot reload both use it.

## How it relates

- **[Quality](quality.md):** WebGL2 starts at lite.
- **[Reveal](reveal.md) and [extending](extending.md):** the `reveal` hook is how you write your own reveal.
- **[Performance](performance.md):** compute vs CPU paths, workers.

## Status

| part | status |
|---|---|
| the one interface, WebGPU and WebGL2 | [built] |
| hand-written twins (frame, sky, surface, points, custom) and the twin lint | [built] |
| parity check on every example preset, with a threshold that fails the run | [built] |
| the smoke test on both (render, settle, read back, hooks, dispose) | [built] |
| caps, profile, `supported()`, `GraphicsUnavailable` | [built] |
| your shader code: the WGSL subset → GLSL ES 3.0, errors with your line | [built] |
| hooks `position` / `color` / `alpha` / `reveal`, params as uniforms, `custom()` | [built] |
| hot reload (`setShader`, the example's editor and dev-server hot reload) | [built] |
| textures and your own structs in the subset | [planned] |
| compute work with CPU / fragment-pass twins on WebGL2 | [planned] (no compute work yet) |
