# Hosting: plain JS, React, Zebflow, servers

> Draft under discussion. Interface and structure only.

**In one line:** aslnut is plain JavaScript with no framework; thin shells put the same objects into React and Zebflow; imports are safe to run on a server (nothing touches the browser until a world starts); and `w.dispose()` frees everything.

## Why

- **Apps are built in different ways:** a plain page, a React app, a Zebflow flow.
- **Servers render pages first:** an import that touches `window` crashes server rendering.
- **Single-page apps open and close views:** a world that doesn't clean up leaks the graphics chip's memory.

## The rules

1. **Plain first:** `world(canvas, options)` returns a world; everything else is objects and functions.
2. **Shells add nothing:** the React component and the Zebflow node pass props straight to the same objects.
3. **Server-safe imports:** importing `aslnut` never touches `window`, `document` or the graphics chip. Only `world(canvas)` does, and it throws a clear error on a server; `world(null)` is headless and runs there with the same results.
4. **`w.dispose()`** stops the clock, ends workers and streams, and frees GPU buffers, textures and memory. Shells call it on unmount.
5. **One world per canvas;** several worlds per page are fine.
6. **Sizes follow the canvas:** a resize observer, and device-pixel-ratio limits for phones.

```tree
host/
├── plain
├── react/
│   ├── World
│   ├── elements
│   └── hooks
├── zebflow/
│   ├── node
│   └── ports
├── server-safe
├── dispose
├── sizing
└── package/
    ├── subpaths
    ├── types
    ├── code-only
    └── data-apart
```

## Examples

```ts
// 1 · plain
import { world, earth, area } from 'aslnut';
const w = await world(document.querySelector('canvas'), { body: earth() });
w.add(area({ data }));
// later
w.dispose();
```

```tsx
// 2 · React: the same props
import { World, Area } from 'aslnut/react';
<World body={earth()} onReady={w => (window.w = w)}>
  <Area id="suburbs" data={data} color={d => ramp(d.props.rate)} />
</World>
// unmount → dispose, automatically

// 3 · a hook for the state s
const s = useWorldState(w => ({ zoom: w.view.zoom }));
```

```ts
// 4 · Zebflow: a node with ports
// [data source] ─▶ (aslnut.world { body: earth() }) ─▶ [selection] ─▶ [panel]

// 5 · on a server: imports are safe, worlds aren't
import { describe } from 'aslnut';   // fine in Node
await world(canvas);                 // → AslnutError: "world() needs a browser canvas. Create it on the client (useEffect / onMount)."
```

## The package

**In one line:** the npm package holds code only; every byte of map data, imagery or terrain comes from a URL you choose.

- **Subpath imports:** `aslnut`, `aslnut/react`, `aslnut/modules/world/earth`, `aslnut/kits/dashboard`… so an app loads only what it uses.
- **ESM with types:** `.d.ts` for everything; `sideEffects: false`, so unused parts drop out of the bundle.
- **Code only:** no globe data, no imagery, no place packs in the package. `LICENSE` for the code, `DATA-LICENCES` for what the examples fetch.
- **The small offline Earth** (coarse imagery, terrain, coasts, names) is a pack loaded from a URL: `earth(earth.offline({ pack: url }))`. See [modules › earth › body/base/offline](#reference/modules/earth~body-base-offline).
- **Examples** use only data that may be redistributed.
- **A headless smoke test** runs in CI (WebGPU and WebGL2).

> **Your decision needed (conflict 9):** the offline Earth pack (about 3–4 MB) can ship *inside* npm (works with no server, heavier install) or *outside* it, from a URL (the rule "no data in the library", lighter install). The docs assume **outside, from a URL**.

## How it relates

- **[Extending](extending.md):** shells are themselves extensions.
- **[LLMs](llms.md):** `describe()` and the schemas work on a server.

## Common mistakes

- **Creating a world in React render.** Create it in the component (the shell does it).
- **Forgetting `dispose`** in a plain single-page app.

## Status

| part | status |
|---|---|
| plain JS | [built] |
| React shell, Zebflow node | [planned] |
| server-safe imports | [planned] |
| `dispose` | [planned] |
| the package (subpaths, types, code only) | [planned] |
