# Quality: lite by default, realistic when needed

> Draft under discussion.

**In one line:** aslnut draws **lite** by default (flat colours, hillshade, fades), fast on any phone, and turns on **realistic** (shadows, materials, facades, reflections) only where it pays off: close up, on a capable device, or for a shot.

## Why

- **The fastest digital twin first.** Most questions are answered by a clear lite picture.
- **Realism costs.** Shadows and reflections can halve the frame rate; they should be spent where they're seen.
- **The same scene, two tiers:** nothing in your code changes except the quality rule.

## The rules

1. `render.quality` is a value or a function of the state: `'lite' | 'realistic'`, or `'auto'` (the default): the device picks it on first load (its graphics, a touch screen, its memory and cores), the reason in `w.telemetry().quality.why`.
2. Elements read it to choose their look: `look: s => …`.
3. **WebGL2 and touch devices (phones, tablets) default to `lite`**, whichever graphics draws: one device gets the same work on WebGPU and WebGL2. `realistic` stays available where the device can afford it (`world({ quality: 'realistic' })`).
4. The budget can step quality down when frames run long (see [observation](observation.md)). The device's budget is on by default (`budget: 'auto'`: a phone is held to 30 frames a second at the least), so the quality adapts to measured frame times: down after 10 frames over, back up after 120 with room, waiting twice as long each time a step up is soon undone (no flicker). Override it with `world({ quality })`, or `&quality=lite|realistic|auto` in the example.
5. Realism is added in steps, cheapest first: anti-aliasing → ambient occlusion → shadows → materials → reflections.

| | lite | realistic |
|---|---|---|
| ground | imagery + hillshade | + materials, ambient occlusion |
| buildings | flat extrusions | facades, roofs, night windows |
| light | a fixed sun direction | shadows, sky light, reflections |
| image | plain | anti-aliasing, grading, bloom |
| motion | fades | full reveals |

Plain meanings: **ambient occlusion** = darker in corners and under eaves; **anti-aliasing** = smooth edges instead of stairs; **grading** = the overall colour mood; **bloom** = a soft glow round bright lights.

## Examples

```ts
// 1 · realistic only at the street level and closer, on a strong device (it changes once, at a level change)
world(canvas, { render: { quality: s => (s.device.tier === 'high' && s.observation.index >= 5 ? 'realistic' : 'lite') } })

// 2 · an element picks its look from the quality
extrusion({ data: buildings, look: s => (s.render.quality === 'realistic' ? looks.facades : looks.flat) })

// 3 · always realistic for a capture
world(canvas, { render: { quality: 'realistic' } })
```

## How it relates

- **[Observation](observation.md):** the budget can lower quality.
- **[Graphics](graphics.md):** WebGL2 starts at lite.
- **[Shapes](shapes.md):** distance levels (full → dot) are separate from quality tiers.
- **[Sky](sky.md):** realistic sky light and shadows come from the sky module.

## Common mistakes

- **Turning on realistic everywhere** and then blaming the phone.
- **Mixing up levels and quality.** Levels decide *how much* of an object (full vs box); quality decides *how it's lit and finished*.

## Status

| part | status |
|---|---|
| lite rendering (imagery, hillshade, grade, fades) | [built] (WebGL2 starts here) |
| `render.quality` (`'auto'` by default), `look: s => …` | [built] (`look` per element: as each element's reference says) |
| anti-aliasing, ambient occlusion, shadows, materials, reflections | [planned] |
