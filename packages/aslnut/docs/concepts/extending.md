# Extending

> Draft under discussion.

**In one line:** aslnut is a library you **extend, never fork**: your own sources, layers, shapes, rules, reveals and whole parts plug in on the same small interfaces aslnut's own parts use.

## Why

- **Every twin has something nobody else has:** a private API, a special layer, a custom formula.
- **Forks rot.** Extensions survive upgrades because they only touch the public surface.
- **The same surface for people and LLMs:** every part declares what can be changed, so `w.describe()` can list it.

## The rules

1. **Five depths,** from least to most code: props → functions in props → `*.custom` sources → your own layer class → `w.provide` a whole part.
2. **Every part declares its surface:** props with types and defaults, hooks, and what it needs.
3. **Providers are named slots:** `w.provide('earth.buildings', Mine)` replaces a part everywhere it's used.
4. **Shader lines go at named hooks** (`/*@reveal*/`, `/*@inject*/`); see the open question in [graphics](graphics.md).
5. **Heavy work goes to a worker:** `prepare` runs off the main thread when it's declared heavy.
6. **Extensions get the same checks:** a shape package's tests, a layer's prop types, a rule's validation.

```tree
extend/
├── props
├── functions
├── sources/
│   ├── terrain.custom
│   ├── imagery.custom
│   ├── data.custom
│   └── raster.custom
├── layers/
│   ├── props
│   ├── prepare
│   ├── draw
│   └── hooks
├── shapes/
├── rules/
├── reveals/
├── controllers/
├── steps/
└── provide
```

| depth | you write | example |
|---|---|---|
| props | values | `color: '#f80'` |
| functions in props | `d =>`, `s =>`, `t =>` | `color: d => ramp(d.props.rate)` |
| sources | a small object with `load` / `heights` / `draw` | `terrain.custom({ heights })` |
| element class | `prepare` (CPU) + `draw` (GPU) | `class Heat extends Element` |
| provide | a whole part under a name | `w.provide('earth.buildings', Mine)` |

## Examples

```ts
// your own source, on the same small interface
terrain.custom({ id: 'my-dem', attribution: '…', heights: (tile, n) => myDecode(tile, n) });
imagery.custom({ id: 'my-tiles', draw: (ctx, tile) => drawMine(ctx, tile) });
data.custom({ id: 'my-api', load: async (s) => rows });

// your own element (a mark or a part of your own)
class Heat extends Element {
  static props = { data: [], ramp: 'inferno' };
  prepare(data) { … }         // CPU, once per data change (in a worker when it's heavy)
  draw(pass) { … }            // GPU, each frame, through the one graphics interface
}
w.add(new Heat({ data }));

// your own part, used by everything that needs it
w.provide('earth.buildings', MyBuildings);

// your own rule for a field (see physics)
field({ kind: 'raster', res: 1, rule: (cur, n, dt) => cur + dt * .2 * n.laplacian });

// your own reveal, your own compile step
reveal.define('drop-in', { feature: (d, p) => ({ opacity: p, offset: [0, 0, (1 - p) * 300] }) });
compile({ steps: { after: { mesh: chunk => addMyDecals(chunk) } } });
```

**React and other hosts** get the same objects (see [hosting](hosting.md)):

```tsx
<World body={earth({ imagery: [imagery.esri()] })}>
  <Area id="crime" data={joined} color={scale.quantile(d => d.props.rate)} when={s => show} />
</World>
```

## How it relates

- **[Phones and performance](performance.md#building-an-element-frames-and-the-budget):** the practice every layer follows: the frames it wants (`wantsFrames`), the budget it reads and the memory it is counted for.
- **[Configurable](configurable.md):** depths 1–3 are configuration.
- **[Shapes](shapes.md):** shape packages are the way to share objects.
- **[LLMs](llms.md):** `describe()` lists every extension point.

## Common mistakes

- **Patching aslnut's files.** Use `provide` or a layer class.
- **Calling WebGPU directly in a layer.** Use the graphics interface, or the layer won't run on WebGL2.

## Status

| part | status |
|---|---|
| `class extends Element`, WGSL hooks (a research prototype's extensions) | [partly] |
| `w.provide` by name | [partly] (a research prototype, by rack number; names [planned]) |
| `*.custom` sources, `reveal.define`, custom rules and steps | [planned] |
| React shell | [planned] |
