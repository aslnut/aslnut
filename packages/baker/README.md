# aslnut-baker

A road baker in Rust for [aslnut](https://github.com/aslnut/aslnut), the world engine for the web. It designs streets from map lines (curves, cross-sections, junction patterns, one planar partition in which neighbours share their edges, heights from the design) and writes aslnut's baked roads pack, which aslnut reads unchanged.

```
cargo install aslnut-baker
aslnut-baker <roads input dir> <place> --out <dir> [--rules rules.json] [--built <old pack dir>]
aslnut-baker --print-rules          # the default design rules, as JSON
```

It reads `<dir>/<place>.geojson` (the ways), `.ground.json` + `.ground.f32` (the ground grid) and, where they exist, `.paths.geojson`, `.reserve.geojson`, `.water.geojson`. It writes `<out>/<place>/`: `index.json`, the tiles, the clamp, `terrain.json`, `walk.json`, each with its `.gz`. It never writes anywhere but `--out`.

As a library (`baker`), the same bake runs in a browser through its wasm32 build (`--no-default-features`: no threads, no files).

The inputs, the pack format and the design are in [DESIGN.md](DESIGN.md).

Licence: Apache-2.0.
