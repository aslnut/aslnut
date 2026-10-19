# Reveal

> Draft under discussion.

**In one line:** reveals are for presentation. In an app (the default context) things appear with a short fade; in a recorded video (`context: 'video'`) they play the full reveal (a line grows from a point, an area's outline runs round and fills, buildings rise), and you can define your own.

## Why

- **The eye follows motion.** A line that grows shows where it starts; a sudden pop shows nothing.
- **Same element, two contexts:** in an app a plain, short fade is enough (people are working, not watching); in a recorded video the full reveal tells the story.
- **Not just maps:** the same rule holds for every element that appears (areas, lines, points, shapes, labels, entities).
- **Cheap:** one number per layer, and a still view does no work for it.

## The rules

1. A reveal plays when an element **becomes shown**: it's added, its `when` turns true, or new features arrive. It plays backwards when hidden.
2. Each element kind has its own modes (below).
3. **The context decides.** `world({ context: 'app' })` (the default) plays a fade of at most 0.25 s with no stagger, whatever `mode` says, unless the layer asks for an app mode itself: `reveal: { app: 'radial' }`. `world({ context: 'video' })` plays `video ?? mode`.
4. Timing is `dur` (seconds), `ease`, `stagger` (seconds between features) and `order` (which feature goes first). A stagger spreads over **1 s at most**, however many features there are, and only over the features shown at that moment (the ones their own `when` hides wait for nothing).
5. You can trigger by hand: `w.reveal(id)`, `w.hide(id)`.
6. You can add your own modes, at four depths (below).

## Modes

| element | modes |
|---|---|
| line | `trace` (from the start, the end, the middle, or the point nearest a place; with a soft front and a glowing head), `pulse` (a light running along), `fade` |
| area | `trace-fill` (the outline runs round, then fills), `grow` (out from a line or the middle), `wipe`, `radial`, `fade` |
| points, extrusions, shapes | `sweep` (in an order), `pop`, `rise` (grow up from the ground), `fade` |
| grids | `ripple`, `fade` |
| text | `type`, `count` (numbers count up), `mask`, `fade` |

## Examples

```ts
// 1 · a line grows from a substation, with a glowing head
line({ id: 'grid', data, reveal: { mode: 'trace', from: substation, dur: 1.5, head: { glow: 1 } } })

// 2 · an area: the outline runs round, then fills; features one after another
area({ id: 'wkp', data, reveal: { mode: 'trace-fill', dur: 1.2, stagger: .08 } })

// 3 · buildings rise outward from a fault line, biggest power plants pop first
extrusion({ data: buildings, reveal: { mode: 'rise', order: d => d.props.distanceToFault, dur: 2 } })
points({ data: plants, reveal: { mode: 'pop', order: d => -d.props.mw, stagger: .02 } })

// 4 · rich in video, plain in an app (the default without `app`); a mode asked for in an app too; and by hand
area({ id: 'crime', data: rows, reveal: { video: 'sweep', app: 'fade' } })
area({ id: 'zones', data, reveal: { app: 'radial', video: 'radial', dur: .5 } })
w.reveal('grid');  w.hide('grid', { mode: 'trace', reverse: true });
```

## Your own reveal, four depths

| depth | you write | example |
|---|---|---|
| 1 · props | mode, timing | `{ mode: 'trace', dur: 1.5, ease: 'cinematic', stagger: .05 }` |
| 2 · your order | a function of each feature | `order: (d, s) => distance(d, s.view.centre)` |
| 3 · your mode, per feature | how a feature looks at progress `p` (0 → 1) | `reveal.define('drop-in', { feature: (d, p) => ({ opacity: p, offset: [0, 0, (1 - p) * 300] }) })` |
| 4 · your mode, per pixel | a shader line at the `/*@reveal*/` hook | `reveal.define('scan', { wgsl: 'alpha *= step(fract(world.y * .01 - reveal * 2.0), .5);' })` |

Depth 4 is a line of shader code (the small program on the graphics chip), written once in WGSL; aslnut translates it for WebGL2 (see [graphics](graphics.md)).

## How it relates

- **[Presence](presence.md):** reveals play when shown changes.
- **[Quality](quality.md):** WebGL2 and low budgets may shorten reveals to fades.
- **[Camera](../reference/core/render.md):** camera moves are separate from reveals; both can run at once.

## Common mistakes

- **Expecting a rich reveal in an app.** Without `app:` an app shows a short fade; ask for `{ app: 'wipe' }` when the app needs it.
- **A stagger as a timer.** It is capped at 1 s over all features; use `order` for meaning, `dur` for pace.
- **No `order`** when the meaning has a direction (outward from a fault, biggest first).

## Status

| part | status |
|---|---|
| a fade when `when` changes (`transition`), and your own reveal in a shader hook (`shader: { reveal }`) | [built] |
| `reveal` on layers: trace (from a place, soft front, glowing head), pulse, trace-fill, grow, wipe, radial, sweep, pop, rise, fade | [built] (ripple for grids planned) |
| text modes type, count, mask | [built] |
| `{ video, app }`, `w.reveal` / `w.hide` / `w.release`, stagger and order | [built] |
| the context policy: an app fades (≤ 0.25 s, no stagger) unless `app:` asks; stagger capped at 1 s over the shown features | [built] |
| `reveal.define` (depths 3 and 4; the WGSL line is translated for WebGL2) | [built] |
