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

### React

`<World>` is the plain API in React, and nothing more:

- **Made on mount, disposed on unmount:** `world(canvas, options)` on a canvas of its own (strict mode mounts twice: the first world is disposed as soon as it exists; a canvas a disposed world let go is never drawn on again).
- **Elements are aslnut's own objects,** made in render (`layer(…)`, `entities(…)`), each with an `id`. From one render to the next they are matched by id: a new id is added (`w.add`), a gone one removed (`w.remove`), a changed prop set on the element already in the world (`element.setProps`): never made again. Values are compared by value; functions, sources and logs by identity, so make those once (outside the component, or `useMemo`): one made again each render is a new prop, a restyle each render.
- **Options** are what the world is made with. Later, the ones with a setter follow their changes (`views`, `time`, `timeZone`, `quality`, `render.shadows`, `theme`, `budget`, `priorities`, `observation`); the rest stay as made (a new world: a new `key`). A changed `view` moves the camera only with `viewChange: 'go' | 'fly'`: the camera is the person's.
- **Kept objects work too:** an element made once (`useMemo`, module scope) and taken out of the list and put back is removed and added again, and drawn anew; a new scale given by a prop reads its classes from the data first.
- **Hooks are few:** `useWorld()`, `useElement(id)`, `useWorldEvent(name, fn)`.
- **No component per function:** a JSX element per aslnut function would be a second vocabulary to learn and keep in step. The elements are data, so a flow node or any other shell does the same with `shell(w)` (from `'aslnut'`, no framework): `.elements(list)`, `.options(o)`.

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
// 2 · React: the same objects, as data
import { World, useWorldEvent } from 'aslnut/react';
import { layer, plane } from 'aslnut';
const BODY = plane();                                 // made once (outside the component)
function Map({ dark }: { dark: boolean }) {
  return (
    <World options={{ body: BODY, view }} style={{ height: '100vh' }}
      elements={[layer({ id: 'zones', data, area: { color: dark ? '#333' : '#ddd' } })]}   // dark changes: setProps
      onReady={(w) => console.log(w.api)}>
      <Panel />
    </World>
  );
}
// unmount → dispose, automatically

// 3 · hooks, inside <World>
function Panel() {
  const [picked, setPicked] = useState<Picked | null>(null);
  useWorldEvent('tap', (p) => setPicked(p));          // w.on('tap', …) while mounted
  const w = useWorld(), zones = useElement('zones');  // null until ready, until added
  return picked && <aside>{String(picked.props.name)}</aside>;
}
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

- **Creating a world in React render.** `<World>` makes it in an effect, on the client.
- **Making a source, a log or a function in render.** Each render it is a new prop: a restyle (or a load) each render. Make it once, outside the component or with `useMemo`.
- **An element without an `id`** is a new element each time it is made (said once, through the world's errors).
- **A sign added to a layer later** (`labels` on a layer made without them): a layer's signs are made with it, and `setProps` restyles them but makes none. Give the layer its signs from the start, or a new `id` (a new layer).
- **A `<World>` with no size:** its box is what you give it (a class or `style`); the canvas fills it.
- **Forgetting `dispose`** in a plain single-page app.

## Status

| part | status |
|---|---|
| plain JS | [built] |
| React shell (`aslnut/react`: `<World>`, `useWorld`, `useElement`, `useWorldEvent`; `shell(w)` without React) | [built] |
| Zebflow node | [planned] |
| server-safe imports | [built] |
| `dispose` | [built] |
| the package (subpaths, types, code only) | [built] |
