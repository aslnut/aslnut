# States: answers as presentations

> Draft under discussion.

**In one line:** the answer to a question is a **state**: where the camera is, the time, the observation, which layers are shown (with their params and filters), the selection and the toggles. It is plain JSON you can capture, apply (the camera flies, layers reveal), compare, check against a schema, and share as a link.

## Why

- **A question deserves a picture, not a paragraph.** "Where is burglary highest?" is best answered by flying to the right suburbs, the right year and offence on the map, the top three selected.
- **The answer can come from anywhere.** A server, a saved report or an assistant can write the same small JSON; the world shows it.
- **Shareable and comparable.** One link reopens the exact view, and two answers can be compared field by field.

## The rules

1. **A state is plain JSON** with a version: `{ v: 1, note?, view, time?, observation?, layers, params?, selection, toggles? }`.
2. **`w.capture()`** writes the world now as a state; **`w.apply(state)`** shows one.
3. **Applying flies the camera** with an easing preset (`ease`, `seconds`, `path`). Layers **reveal or hide through their own reveal**, never pop.
4. **A state reads and writes only what exists.** If it names a layer the world does not have, the layer is reported in `missing` and never made. A param the world refuses goes to `refused`.
5. **Layers the state does not name are left as they are**, unless you pass `others: 'hide'`.
6. **Filters are data** (`{ kind: 'school' }`, `{ kind: ['a', 'b'] }`, `{ rate: { min: 10 } }`), so they can be saved. A filter function stays in code; it cannot travel in a state.
7. **Checked before it is shown:** `states.validate(json)` follows the published JSON Schema (`states.schema`). An error names the path and the fix (`state.view.lat: 120 is outside -90..90, did you swap lon and lat?`).
8. **Shared as text:** `states.toURL(s)` puts it in a link; `states.fromURL(location.href)` reads it back.

```tree
state/
├── v
├── note
├── view/
│   ├── lon
│   ├── lat
│   ├── zoom
│   ├── tilt
│   └── bearing
├── time
├── observation/
│   └── quality
├── layers/
│   └── <id>/
│       ├── shown
│       ├── params
│       └── filter
├── params
├── selection
└── toggles
```

## Examples

```ts
// 1 · capture the view now, with a title, and keep it
const answer = w.capture({ note: 'Where is burglary highest in 2025?' });
await fetch('/answers', { method: 'POST', body: JSON.stringify(answer) });

// 2 · show an answer that came from a server or an assistant
const s = await (await fetch('/answers/burglary-2025')).json();
const { missing } = await w.apply(s, { seconds: 2.5, ease: 'cinematic' });

// 3 · an answer written by hand: the year and offence are world params the query reads
await w.apply({
  v: 1, note: 'Theft in the south-east, 2021',
  view: { lon: 145.17, lat: -37.95, zoom: 11, tilt: 55, bearing: 140 },
  layers: { crime: { shown: true, filter: null }, councils: { shown: false } },
  params: { 'q.year': 2021, 'q.offence': 'theft' },
  selection: [],
});

// 4 · compare two answers, share one
states.diff(a, b);            // [{ path: 'view.zoom', from: 9.6, to: 11 }, { path: 'layers.crime.shown', … }]
const link = states.toURL(answer);
const opened = states.fromURL(location.href);   // null when the link has none
```

## How it relates

- **[Presence](presence.md):** `shown` in a state overrides `when` until you call `w.release(id)`.
- **[Reveal](reveal.md):** applying plays each layer's reveal.
- **[Camera](../reference/core/render.md):** the flight uses the same easing presets and paths as camera keys.
- **[Data](data.md):** a query's inputs are world params, so a state that sets the params also brings back the query's answer.
- **[Interaction](interaction.md):** the selection in a state is `s.user.selection`, which every style and `when` reads.

## Common mistakes

- **Putting data in a state.** A state says what to show, not the data. Keep numbers in sources; keep their inputs (year, offence) in params.
- **Saving a filter function.** Write the filter as props to match.
- **Expecting a state to add layers.** It shows and hides what the world has; build the world first.

## Status

| part | status |
|---|---|
| `capture`, `apply` (camera flight, reveals, params, filters, selection, toggles, time, quality), `diff`, `validate` + JSON Schema, URL `encode` / `decode` / `toURL` / `fromURL` | [built] (tested on WebGPU and WebGL2) |
| a state per story step, transitions between states on a timeline | outside aslnut (a story tool applies states) |
