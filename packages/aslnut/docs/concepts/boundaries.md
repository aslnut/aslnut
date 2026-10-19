# Boundaries: what is in aslnut, and what is built on it

> Draft under discussion.

**In one line:** aslnut holds only what **creates and runs worlds**; how someone *uses* worlds (telling stories, making videos, a studio, an app's menus) is built on aslnut, outside it, through the same public interface anyone can use.

## Why

- **A small core, readable in a day.** Every extra purpose makes the library harder to learn and to change.
- **One honest test:** if a tool built outside can't do its job with the public interface, the interface is missing something, and that gap is fixed in aslnut for everyone.
- **Domain words age fast.** A minibus, a shop-house or a fault line belongs to one kind of app; the core speaks of bodies, layers, shapes, entities and fields.

## The rules

1. **The world rule:** "helps make or run a world" → aslnut. "How someone uses worlds" → outside.
2. **The domain rule:** no domain nouns in `core`. Domain things are presets in `modules` (Earth roads, human bodies), in `kits` (dashboard, game) or in apps.
3. **The promotion rule:** something moves from an app into a module when a second product needs it; into `core` when it makes sense on every body. Until then it stays in the app.
4. **No private door:** tools outside use only the public interface. Whatever they need is a documented row in the reference.
5. **Mobile-first UI belongs to apps.** aslnut draws the world and reports its state; menus, panels and layouts are the app's.
6. **The presets rule:** ready-made things live in a `presets` node, always the last child of its node. A preset is built only with the public API, to use as it is or to copy and change. It sits at the most general level where it still makes sense: a human anywhere (`modules.presets.humans`), Victorian houses only on Earth (`modules.world.earth.presets.built.buildings`). Small value presets (weather presets, easing, ramps) stay inside their part. Each preset has its own import; heavy assets come from the catalog, never bundled.

```tree
aslnut/
├── core
├── modules
├── kits/
│   ├── dashboard
│   └── game
└── tools
built on aslnut, outside/
├── a story tool/
│   ├── script
│   ├── voice
│   ├── timeline
│   ├── scenes
│   ├── shots
│   ├── composition
│   ├── overlays/
│   │   ├── captions
│   │   ├── cards
│   │   └── counters
│   ├── sound
│   ├── music
│   ├── presentation
│   ├── scroll
│   ├── editor
│   └── output/
│       ├── encode
│       └── subtitles
├── a studio app/
│   ├── speech-to-text
│   ├── voice isolation
│   └── reference-video analysis
└── your app/
    ├── menus
    ├── panels
    └── layouts
```

## What aslnut exposes for tools built on it

Everything a story tool, a studio or an app needs, as public rows:

| need | where |
|---|---|
| where a place is on screen | [`w.project`](#reference/core/render~project-project), [`w.visible`](#reference/core/render~project-visible) |
| named values to set and read | [params](#reference/core/world~settings-params), [readouts](#reference/core/world~settings-readouts), [named points](#reference/core/world~settings-points) |
| "everything is loaded" | [`w.settled({ strict })`](#reference/core/world~state-settled), [readiness](#reference/core/data~loading-readiness) |
| a frame as pixels | [capture](#reference/core/render~capture-capture) |
| camera control | [views](#reference/core/observation~observers-orbit-views), [keys](#reference/core/observation~observers-orbit-keys), [easing](#reference/core/observation~observers-orbit-speed-easing), [paths](#reference/core/observation~observers-orbit-paths), [follow](#reference/core/observation~observers-orbit-follow) |
| the clock, readable and settable | [clock](#reference/core/time~clock), [deep](#reference/core/time~deep) |
| exact steps, the same every run | [`w.step`](#reference/core/time~step), [seed](#reference/core/world~lifecycle-world) |
| replay | [history/replay](#reference/core/data~history-replay) |
| reveals | [modes](#reference/core/render~reveal-modes), [timing](#reference/core/render~reveal-timing) |
| clean up | [dispose](#reference/core/world~lifecycle-dispose) |

## How it relates

- **[Hosting](hosting.md):** apps put the world into a page; the package is code only.
- **[Reveal](reveal.md):** reveals are in aslnut (every element can appear); the timeline that orders them is outside.
- **[Coverage](../coverage.md):** the needs served outside are marked "outside".

## Common mistakes

- **Adding a caption or a timeline to a world.** Draw them in the tool outside; read positions with `w.project` and values with `w.read`.
- **Naming a core part after one app's thing.** Name what it is (`entities`, `agents`), and put the app's thing in a preset.

## Status

| part | status |
|---|---|
| the boundary rules | decided |
| the public interface for tools outside | [partly] (projection, params, readouts, points, settled (strict, hold), stepping and frame readback with credits built; capture to files planned) |
