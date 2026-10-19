# Licences and attribution

> Draft under discussion. Interface and structure only.

**In one line:** every provider and dataset carries its **terms as capabilities** (may it be shown, prefetched, kept offline, exported?); aslnut obeys them automatically and puts the right **attribution** on screen and into every capture.

## Why

- **Map data has rules:** some imagery may be shown but not cached; some may not be exported in a video.
- **Breaking terms gets apps blocked,** and is wrong.
- **Credit is required:** © OpenStreetMap contributors, Esri, Mapbox, and your own data's sources.

## The rules

1. **Terms are capabilities** on each source: `show`, `prefetch`, `keep` (store offline), `export` (in captures, video, files). Each is `true`, `false`, or a condition (`{ maxZoom: 16 }`, `{ days: 30 }`).
2. **aslnut obeys them:** no prefetch where `prefetch: false`; packs skip what can't be kept; captures refuse or blank out what can't be exported, with a clear message.
3. **Attribution** is built from what's on screen right now, shown in a corner, and burned into every capture and video.
4. **Data licences** (CC-BY, ODbL, your own) travel with the data into packs, compiled chunks and exports.
5. **Shapes and imports** have a licence and an author too (the shape package's `LICENCE`).
6. **Your own terms** for your own sources: same capabilities.

```tree
licences/
├── terms/
│   ├── show
│   ├── prefetch
│   ├── keep
│   └── export
├── attribution/
│   ├── on-screen
│   └── captures
├── data/
│   ├── cc-by
│   ├── odbl
│   └── custom
└── shapes
```

## Examples

```ts
// 1 · a provider's terms (aslnut ships them for its built-in providers)
imagery.custom({
  id: 'city-ortho', url: 'https://…/{z}/{x}/{y}.jpg',
  attribution: '© City of Bandung 2026',
  terms: { show: true, prefetch: { maxZoom: 16 }, keep: false, export: { watermark: true } },
});

// 2 · ask what's allowed before a capture
w.rights.can('export');            // { ok: false, because: ['mapbox: export not allowed'] }

// 3 · attribution, live and in captures
w.attribution();                   // ['© OpenStreetMap contributors', '© Esri']
await w.capture({ attribution: 'bottom-right' });

// 4 · a dataset's licence travels with it
data.geojson('…/suburbs.geojson', { licence: 'CC-BY-4.0', source: 'ABS 2021' });
```

## The default imagery

`earth()` uses `imagery.esri()` by default because it looks good everywhere with no key. Its terms allow showing, not keeping or prefetching far ahead, so the loader treats it as **session-only**: never packed, never in an offline pack, credited in every capture.

> **Your decision needed (conflict 13):** keep Esri as the default in public examples (best look, session-only), or default the examples to a source that may be kept and exported (OpenStreetMap-based tiles from your own server, or a free satellite mosaic with a lower look). The docs keep **Esri as the default**, marked session-only.

## How it relates

- **[Data](data.md):** terms decide what the loader prefetches and keeps.
- **[Compile](compile.md):** compiled packs keep their sources' licences.
- **[Formats](formats.md):** imported models keep theirs.

## Common mistakes

- **Caching imagery whose terms forbid it** "just for offline". Use a source that allows `keep`.
- **Cropping attribution out of a video.** It's burned in on purpose.

## Status

| part | status |
|---|---|
| attribution strings per provider, on screen | [partly] (`w.attribution()` for what is shown; in captures planned) |
| terms per provider as capabilities (show / prefetch / keep / export) | [built] (the loader refuses what the terms forbid) |
| `show` / `prefetch` / `export` capabilities, burned-in attribution, licences on data | [planned] |
