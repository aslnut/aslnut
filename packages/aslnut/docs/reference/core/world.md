# core › world

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist).

**In one line:** composing a world: make a world; its elements (the base every element shares, its props: order, opacity, reveal; what is shown is core › observation › presence); its settings (params, readouts, named points); its state (captured, applied, settled, as JSON); describing it for people and assistants; extending it and providing parts; its lifecycle (the world, errors, dispose); and hosting it in plain JS, React or Zebflow.

Concepts: [world and body](../../concepts/world-and-body.md) · [observation](../../concepts/observation.md) · [presence](../../concepts/presence.md) · [extending](../../concepts/extending.md) · [hosting](../../concepts/hosting.md) · [LLMs](../../concepts/llms.md)

<!-- tree:reference/core/world -->
```tree
world/
├── elements/
│   ├── element
│   ├── props
│   └── order
├── settings/
│   ├── params
│   ├── readouts
│   └── points
├── state/
│   ├── states
│   ├── settled
│   └── json
├── describe/
│   ├── describe
│   ├── schemas
│   └── guide
├── extend/
│   ├── extend
│   ├── provide
│   └── hot-swap
├── lifecycle/
│   ├── world
│   ├── errors
│   └── dispose
└── host/
    ├── canvases
    ├── plain
    ├── react
    ├── zebflow
    ├── server-safe
    └── package
```
<!-- /tree -->

## API

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `elements/element` | `w.add(...elements)` · `w.remove(id)` · `w.element(id)` · `class X extends Element` (an element: anything added to a world, a mark, a layer, a twin's part, the ground, the sky) | `elements: Element[]` · `id: string` | `World` · `Element` | [built] | `w.add(area({ id: 'wkp', data }))` |
| `elements/props` | the props every element shares | `id?: string = auto` · `data?: Source` · `when?: When` · `order?: number` · `above?: string` · `below?: string` · `opacity?: number = 1` (a uniform: `w.setOpacity(id, v)`, one frame, nothing built again; `layer.fades` says a layer can) · `label?: string` (its name for people: a layer list) · showing by hand: `w.reveal(id, { seconds })` · `w.hide(id, { seconds })` · `w.release(id, { seconds })` (0: one frame) · `reveal?: Reveal` · `hover?: HoverLook` · `on?: 'ground' \| 'sea' \| 'seafloor' \| 'air' \| orbit(…) \| 'absolute' = 'ground'` · `height?: Fn<metres>` (negative = below the ground) · `transition?: seconds = 0` (values ease when data changes) | — | [partly] | `line({ id: 'grid', data, opacity: .8, reveal: { mode: 'trace' } })` |
| `elements/order` | `order: n` · `above: id` · `below: id` · `w.move(id, to)` · `w.reorder(ids)` (a stack, bottom first: each layer keeps its band, a mark on the ground under the twin's solids, a floating one over them; one frame, nothing built again) · `w.on('elements', f)` (`{ what: 'add' \| 'remove' \| 'order' \| 'shown' \| 'opacity' \| 'props', ids }`: a layer list keeps in step) | `n: number` · `id: string` · `to: { above? , below?, order? }` · `ids: string[]` | — | [built] | `w.move('wind', { below: 'solar' })` |
| `settings/params` | `w.param(key, spec, set, get?)` · `w.set(key, v)` · `w.get(key)` · `w.params()` | `key: string` (dotted, e.g. `fault.glow`) · `spec: { type: 'number' \| 'enum' \| 'bool' \| 'color' \| 'vector' \| 'text', range?, options?, default, unit?, describe? }` ('text': a code or a name, e.g. the region a drill-down is in) | the list of every knob, for editors and assistants | [built] | `w.param('looks.navy', { type: 'number', range: [0, 1], default: 1 }, v => …)` |
| `settings/readouts` | `w.readout(key, fn)` · `w.read(key)` · `s.world.readouts` | `fn: () => any` (a live value computed from the world) | the value | [built] | `w.readout('buildings.lit', () => lit.count)` · `when: s => s.world.readouts['buildings.lit'] > 0` |
| `settings/points` | `w.point(name, fn)` · `w.pointAt(name)` | `fn: () => [lon, lat, h?]` | a named place other parts can aim at (markers, cameras, anchors) | [built] | `w.point('fault.mid', () => mid)` |
| `state/states` | `w.capture(opts?)` · `await w.apply(state, opts?)` · `states.diff(a, b)` · `states.validate(json)` · `states.schema` · `states.encode(s)` / `decode(text)` · `states.toURL(s)` / `fromURL(url)` · `w.setTime(t)` · `w.setQuality(q)` | capture: `note?: string` · `layers?: string[]` · `time?: boolean = true` · apply: `seconds?: number` (0 = jump) · `ease?: Ease = 'cinematic'` · `path?: 'direct' \| 'arc' \| 'around'` · `others?: 'keep' \| 'hide' = 'keep'` | `WorldState` (plain JSON: `{ v: 1, note?, view, time?, observation?, layers: { [id]: { shown?, params?, filter? } }, params?, selection, toggles? }`) · apply: `Promise<{ missing, refused }>` (layers it names that the world has not are reported, never made) | [built] | `await w.apply(await (await fetch('/answers/burglary')).json(), { seconds: 2.5 })` |
| `state/settled` | `await w.settled(opts?)` | `strict?: boolean = false` (strict: fails instead of timing out) · `timeout?: ms = 30000` · `hold?: boolean = false` (a paused world settles without moving its clock: only loading is waited for, the moment's motion and reveals stay as they are; captures frame by frame) | `Promise<boolean>`: every tile, layer and build needed for the current view is in and faded in | [built] | `await w.settled({ strict: true }); const px = await w.frame(1080, 1920)` |
| `state/json` | `world.fromJSON(doc)` · `w.toJSON()` | `doc: WorldDoc` (body, sources, elements, params; every element's JSON form, validated by `schema`) | `World` · `WorldDoc` | [planned] | `const w = await world.fromJSON(canvas, await (await fetch('/twin.json')).json())` |
| `describe/describe` | `w.describe(filter?)` | `filter?: { kind?, id? }` | `{ bodies, elements, providers, hooks, status }` as data | [planned] | `w.describe({ kind: 'area' })` |
| `describe/schemas` | `schema(kind)` | `kind: string` (`'area'`, `'shape'`, `'world'` …) | a JSON schema | [partly] (the state schema is built: `states.schema`, `states.validate`; schemas for every element planned) | `schema('area').properties.color` |
| `describe/guide` | `docs/authoring.md` · `docs/llms.txt` (also at the examples' site root) · `examples/recipes` | — | the authoring guide (one page: the model, your own thing, the rules, a recipe per kind of app, the common mistakes), six complete recipes, every import, the kinds' traits and an index of every part that exists, made from the docs and the tree (`docs/_tree/llms.mjs`; gen.py runs it) | [built] (the recipes type-checked and rendered on WebGPU and WebGL2 by tools/smoke-recipes.mjs; llms.txt kept current by test/llms.test.ts; a small model with it did three tasks of three in half the tool calls and half the time it took with the docs alone) | `node packages/aslnut/docs/_tree/llms.mjs --check` |
| `extend/extend` | `class X extends Element { readonly kind; attach(ctx); frame(ctx): DrawCall[]; detach() }` | `ctx.graphics.program({ wgsl, glsl, blocks, vertex?, instance?, textures?, blend?, depth?, cull?, topology? })` · `ctx.graphics.buffer(kind, data)` · `ctx.frame` (the frame block) · `pickInfo(index)` · `placeOf(picked)` · `wantsFrames(s)` (the frames it needs by itself: 0, n a second, Infinity; [the practice](../../concepts/performance.md#building-an-element-frames-and-the-budget)) · `animating()` (its short form) | a new element kind, on WebGPU and WebGL2 | [built] (your WGSL and its GLSL twin; the primitives check page draws one: examples/primitives ?go=extend) | `class PulseRing extends Element { … }` |
| `extend/provide` | `w.provide(name, Part)` | `name: string` (dotted, e.g. `earth.buildings`) · `Part: class \| factory` | `World` | [planned] (a research prototype exists) | `w.provide('earth.buildings', MyBuildings)` |
| `extend/hot-swap` | automatic in development; `w.hot(module)` | `module: { shapes?, layers?, rules? }` (a changed file, checked in a worker first) | swaps by id; the old version stays if the new one fails, with file + line | [partly] | `if (import.meta.hot) import.meta.hot.accept(m => w.hot(m))` |
| `lifecycle/world` | `world(canvas, options?)` | `canvas: HTMLCanvasElement \| null` (null = headless: Node, servers, tests, the same results) · `body?: Body = earth()` · `bodies?: Body[]` · `view?: View` · `time?: Date \| 'now' = 'now'` · `graphics?: 'auto' \| 'webgpu' \| 'webgl2' = 'auto'` · `render?: { quality, shadows?: boolean \| ShadowOptions }` (`'auto'`: the device's quality; shadows off by default, cast by the light of a `sky()`) · `timeZone?: string \| 'auto'` (the clocks' zone: `s.time.local`) · `clock?: 'real' \| { fps }` · `attribution?: false \| { position, format }` · `onError?: (e) => void` · `pixelRatio?: number` · `budget?: Budget \| 'auto' \| false = 'auto'` · `frames?: FramesOptions` (draw on demand) · `loader?: LoaderOptions` · `build?: 'auto' \| 'compiled' \| 'live' = 'auto'` · `seed?: number` (planned: same seed, same world; a shape's builds take their own seed) · `theme?: Theme` (an analysis view: core › render › style › theme) | `Promise<World>` | [built] | `const w = await world(canvas, { body: earth() })` |
| `lifecycle/errors` | `AslnutError` | `code: string` · `message: string` · `fix?: string` · `where?: string` | thrown | [built] | `catch (e) { if (e.code === 'E-GPU-001') showUnsupported() }` |
| `lifecycle/dispose` | `w.dispose()` | — | `void` (stops the clock, ends workers and streams, frees GPU memory) | [built] | `onUnmount(() => w.dispose())` |
| `host/canvases` | `w.view(canvas, opts?)` | `canvas: HTMLCanvasElement` · `camera?: View` · `lens?: Lens` | a second view of the **same** world (one truth, many pictures) | [planned] | `w.view(miniMap, { camera: { zoom: 10 }, lens: 'analytic' })` |
| `host/plain` | ES module, no framework | — | — | [built] | `import { world } from 'aslnut'` |
| `host/react` | `<World …>` + one component per element · `useWorld()` · `useWorldState(sel)` | the same props as the functions | React elements | [planned] | `<World body={earth()}><Area data={d} /></World>` |
| `host/zebflow` | a node `aslnut.world` with ports · the React shell as a Zebflow library (Zeb React) | `in: data, selection` · `out: tap, hover, state` | a Zebflow node | [planned] | `[source] ─▶ (aslnut.world) ─▶ [panel]` |
| `host/server-safe` | imports never touch `window`, `document` or the graphics chip | — | — | [built] | `import { describe } from 'aslnut'` in Node |
| `host/package` | `import … from 'aslnut'` · `'aslnut/core/…'` · `'aslnut/modules/world/earth'` · `'aslnut/react'` | ES modules + types · one entry per part (subpath exports) · `sideEffects: false` · code only, never data (`earth-lite` comes from a URL, see [hosting](../../concepts/hosting.md)) | — | [built] | `import { world } from 'aslnut'; import { earth } from 'aslnut/modules/world/earth'` |

## Example

```ts
import { world, earth, imagery, points, data } from 'aslnut';

const w = await world(canvas, { body: earth({ imagery: [imagery.esri()] }) });
w.add(points({ id: 'plants', data: data.geojson('/plants.geojson'), size: d => Math.sqrt(d.props.mw) }));
w.on('tap', f => panel.show(f.props));
console.log(w.describe({ id: 'plants' }));
// later
w.dispose();
```

## Open questions

- Is `world` the right entry word for a lab floor or a solar system too?
- Should `w.on` events carry the state `s` as a second argument? (Proposed: yes.)
- Error codes: one list for the whole library, or one per part?
