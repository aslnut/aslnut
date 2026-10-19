# aslnut

A world engine for the web: GIS, digital twins and 3D viz on **WebGPU and WebGL2 as equals**. It makes and runs worlds in the browser (the Earth from space to a street, or a flat floor), with imagery, terrain, what stands and moves on them, your data and your own shaders; the same worlds run headless in Node.

> 0.1.0: the foundation. What it is: [CHANGELOG](../../CHANGELOG.md). Every part and its status: [STATUS.md](../../STATUS.md). The design, idea by idea: [`docs/`](docs/README.md).

## Install

From source for now; an npm package comes later. Clone the repository, `npm install`, and import `packages/aslnut/src/index.ts` (any bundler that reads TypeScript; Node 24 runs it as it is). Start with the [authoring guide](docs/authoring.md); [llms.txt](docs/llms.txt) carries the guide, the recipes, every import and every signature in one file.

```ts
import { world, earth, imagery, terrain, layer, data, scale } from 'aslnut';

const w = await world(canvas, {
  body: earth({
    imagery: [imagery.esri()],
    terrain: [terrain.mapzen(), terrain.grid({ url: '/dem/my-city', blend: 300 })],
  }),
  view: { lon: 107.62, lat: -6.88, zoom: 11.6, tilt: 62 },
});
// a layer is a statement: one dataset, its signs and its names inside it, loaded once; zoom, tilt and spin only
// move the picture
w.add(layer({
  id: 'places', data: data.geojson('/places.geojson'),
  points: { size: 9, color: scale.category((d) => d.props.kind), params: { gain: 1.5 }, shader: { color: 'color = vec4f(color.rgb * params.gain, color.a);' } },
  labels: { text: (d) => d.props.name },
}));
await w.settled({ strict: true });
w.dispose();
```

- **WebGPU and WebGL2:** `graphics: 'auto'` (the default) tries WebGPU, then WebGL2, and says why; every feature runs on both, and the checks compare the same frame on both.
- **The chain orbit › observation › data › viz:** the camera only moves the picture; data is never changed by looking; a look comes from the feature and the settings only.
- **One `when` on everything:** by the observation level (a twin's ladder: world › … › room), by time, by state: a function of the state `s`, a shorthand (`{ level: { from: 'street' } }`), or a boolean. A GIS layer has no gate.
- **Providers are named factories with defaults:** `imagery.esri()`, `.osm()`, `.sentinel()`, `.custom({ url | draw })`, `terrain.mapzen()`, `.grid({ url | data, where, blend })`, `.custom({ heights })`. Lists compose; `terrain: []` is flat. Each carries its terms, and the loader enforces them.
- **Your own shaders:** hooks in every mark, and `custom()` for a whole visualisation of your own. You write a WGSL subset; it runs on WebGPU, and translated, on WebGL2.
- **Headless:** `world(null, …)` runs in Node with the same results, without graphics.
- **No import-time side effects;** subpath exports (`aslnut/core`, `aslnut/core/observation/observers/orbit`, `aslnut/core/data/loading`, `aslnut/modules/world/earth` …).

## Scripts

| script | what it does |
|---|---|
| `npm test` | node tests (no network, no data, a synthetic DEM) |
| `npm run check` | types, and the shader-twin lint |
| `npm run build` | ESM + declarations into `dist/` (for the npm package, later) |
| `npm run examples` | the examples into `dist-examples/` (bumps `BUILD`) |
| `npm run smoke` | in a headless browser, on WebGPU and WebGL2: render, settle, read back, every hook, dispose |
| `npm run parity` | the same frame on both, pixel-diffed, for every deterministic example (fails over the threshold) |
| `npm run live` | records the globe → city zoom live, at phone size, on both |

## Licence

Apache-2.0 (see `LICENSE` and `NOTICE`). The package holds code only. The data services it can use have their own terms: see `DATA-LICENCES.md`.
