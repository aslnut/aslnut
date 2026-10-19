# modules › presets › humans

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist). a reference implementation of the body pipeline exists (generated body, painted weights, DQS).

**In one line:** people: a generated body from parameters, a face with expressions (emotions, mouth shapes for speech, gestures, blinking), hair, clothing, poses, gaits, speech, and VRM avatars in and out.

Plain meanings: **viseme** = the mouth shape for a sound; **DQS** (dual-quaternion skinning) = a way of bending skin at joints without the "candy-wrapper" collapse; **VRM** = a standard file for humanoid avatars.

Concepts: [entities](../../concepts/entities.md) · [formats](../../concepts/formats.md)

<!-- tree:reference/modules/human -->
```tree
humans/
├── body
├── face
├── expressions/
│   ├── emotions
│   ├── visemes
│   ├── gestures
│   └── blink
├── hair
├── clothing
├── poses
├── gaits
├── people
├── speech
└── vrm
```
<!-- /tree -->

## API

Its own import: `aslnut/modules/presets/humans`. Built with the public API: `core › entities › body` (a skeleton, a skin blended by dual quaternions, motions baked into rows of skin transforms), drawn by an entity layer on WebGPU and WebGL2 alike. The template URL is required by `loadTemplate(url, fetcher?)`; it has no default URL. The fetcher defaults to the global `fetch`. The template (faces, skin weights, bones, correctives, the face decal, the hair styles) is data from a pack (`tools/humans-pack.mjs`), never bundled.

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `body` | `generate(sliders)` · `humanFigure(template, spec)` · `loadTemplate(url)` | sliders 0…1: `gender_female`, `weight_heavy`, `weight_thin`, `muscular`, `age_child`, `age_teen`, `age_elder`, `tall`, `short`, `bust`, `hips_wide`, … (34, `MORPHS`) · spec: `{ body, hair, garments, gait, face = true, frames = { walk: 16, run: 12, idle: 8 }, poses }` | `{ P, positions, joints }` · a `HumanFigure` (mesh, skeleton, clips) | [built] | `humanFigure(tpl, { body: { age_elder: 0.8 }, hair: 'bun' })` |
| `face` | `packFace(face)` · `FACE_MATERIAL` | `style: 'eyes' \| 'dots' \| 'closed'` · `eyeSize, eyeOpen, eyeGap, eyeTilt, lash, brow, browY, mouth, smile, blush`: 0…1 · `browTilt: −1…1` · `iris: color` · `blinks = true` | 3 numbers (an entity's `decal`) | [built] | `entity({ …, decal: packFace({ iris: '#3b6ea5' }) })` |
| `expressions/emotions` | `express(face, emotion, amount = 1)` | `emotion: 'neutral' \| 'happy' \| 'joy' \| 'calm' \| 'sad' \| 'worried' \| 'surprised' \| 'angry' \| 'tired'` or your own moves | a face | [partly] | `packFace(express(face, 'happy', 0.6))` |
| `expressions/visemes` | — | — | — | [planned] | — |
| `expressions/gestures` | — (still poses for now: `wave`, `greet`) | — | — | [planned] | — |
| `expressions/blink` | the face's `blinks` (the clock in the shader: a sixth of a second every 3–6 s, each person on their own beat) | `blinks: boolean = true` | — | [built] | `blink(face, false)` |
| `hair` | `HAIR_STYLES` (16) · `generateHair(params, scalp)` · `fitHair(tpl, piece, base, body)` | style: `short, spiky, bob, long, ponytail, bun, crew, side-part, buzz, receding, afro, curls, shoulder, long-straight, curly-long, pixie` · generated: `front, temple, side, nape, thickness, volume, length, fringe, sideburn, tufts, tuftFreq, undercut, part` | a skinned piece | [built] | `humanFigure(tpl, { hair: 'afro' })` |
| `clothing` | `palette(outfit, skin, hair)` · `GARMENTS` · `buildGarment(g, body)` | outfit: `{ top, sleeves: none\|short\|elbow\|long, bottom, legs: short\|knee\|long, shoes, garments? }` · garments: `shirt, jacket, dress, trousers, skirt, sarong, shoes` (your own: a `GarmentType`; no head coverings ship) | 8 palette colours · a skinned piece | [partly] | `{ garments: [{ type: 'dress', params: { length: 'midi' } }] }` |
| `poses` | `POSES` · `HumanRig.begin()` → ops → `end()` | ops: `flex, abduct, twist, turn, twistCur, lean, armTo, curl, both` (degrees, the body's rest frame) · poses: `relaxed, squat, cross-legged, ride-bike, sit, kneel, arms-up, wave, shy, greet, phone, look-back` | a `PoseFrame` (helpers and correctives done) | [built] | `humanFigure(tpl, { poses: { sit: 'sit' } })` |
| `gaits` | `cycle(ops, phase, run, amp, style)` · `idle(ops, t, style)` · `GAITS` · `strideOf(style, leg, run)` | style: `stride, arms, lean, knee, armsOut, sway, head` · `adult, brisk, relaxed, elderly, child, teen, stroll` | — (baked into walk, run and idle clips; the phase follows the ground walked) | [built] | `humanFigure(tpl, { gait: 'elderly' })` |
| `people` | `person(seed, opts?)` · `crowd(w, opts)` · `personEntity(person, figure, opts)` · `SKIN_TONES` · `HAIR_COLORS` (from `'aslnut/modules/presets/humans'`) | person: `age?: 'child' \| 'teen' \| 'adult' \| 'elder'` · `presentation?: 'fem' \| 'masc'` · `skin?` · `hair?` · `hairColor?` · `outfit?` · `gait?` · `emotion?` · `body?` (sliders) · `garments?: boolean = true` · crowd: `template: Template \| () => Promise<Template>` · `network: () => Network \| null` (the walking network) · `around: () => [lon, lat]` (where they stay) · `count?: int = 24` · `figures?: int = 8` (distinct figures) · `radius?: m = 220` · `seed?` · `people?: (i) => Person` | `Person` (`{ id, seed, age, presentation, figure, skin, hairColor, face, outfit, speed, scale }`: the same seed, the same person on every device) · `Crowd` (people walking the network round the place, a few figures each dressed in their own colours, face and height) | [built] | `const c = crowd(w, { template: () => loadTemplate(url), network: () => net, around: () => [w.camera.lon, w.camera.lat] })` |
| `speech` | — | — | — | [planned] | — |
| `vrm` | — | — | — | [planned] | — |
| `people` | `person(seed, options)` · `restyle(p, seed)` · `PEOPLE` · `personEntity(p, figure, o)` · `crowd(w, o)` | options: `age, presentation, skin, hair, hairColor, outfit, gait, emotion, body, garments` · crowd: `{ template, network, around, count = 24, figures = 8, radius = 220, seed, people, person, bodies, when, buildMs = 6 }` | a `Person` (the same seed, the same person) · a `Crowd` | [built] | `crowd(w, { template, network: () => net, around: () => [w.camera.lon, w.camera.lat] })` |

## Example

```ts
import { person, humanFigure, loadTemplate, personEntity, crowd } from 'aslnut/modules/presets/humans';
const tpl = await loadTemplate('/data/packs/humans/template.json');
const ana = person(7), me = personEntity(ana, humanFigure(tpl, ana.figure), { at: [145.12, -37.92] });
w.add(entityElement().add(me));                                     // one person, standing at ease
const c = crowd(w, { template: tpl, network: () => footpaths, around: () => [w.camera.lon, w.camera.lat], count: 16 });
w.add(c.layer); await c.start();                                   // a light crowd walking the footpaths
```

## Open questions

- Speech synthesis in the browser or by a server lane? Which voices for Indonesian and Sundanese?
- The standard skeleton: VRM humanoid bones, or our own with a VRM mapping?
