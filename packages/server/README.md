# aslnut server: serve or bake

The reference host for aslnut's formats: mesh tiles (`aslnut-mesh/1`, vector data made ready for the GPU) and their PMTiles archives, with live edits. Any host can take the same role (Zebflow, a static CDN for the archives, your own server); this one shows what the role is. Node 24 runs it as is, with no build step.

```
node packages/server/main.ts               # /serve/ on port 8091 (PORT; ASLNUT_DATA: the data folder)
node packages/server/bake.ts world 0 6     # build time: a pyramid → <data>/packs/tiles/world.pmtiles
```

A page reaches it directly, or through any host that forwards `/serve/` to it. Your own routes go in with `ASLNUT_SERVER_ROUTES=a.ts,b.ts`: each module's default export is `(req, res, path, send, cors) => Promise<boolean>`, asked first.

A tile comes from the first of these that has it:
1. **the cache:** baked since the last edit there;
2. **the archive:** `<set>.pmtiles`, built ahead of time, unless an edit made after it touches the tile;
3. **the baker:** now, in a few ms, then cached.

An **edit** (`POST /serve/tiles/<set>/edit`) changes one feature, for example its height `h` (3D) or its shape. Only the tiles it touches are rebaked. Open maps are told by server-sent events and refetch just those tiles.

A **bake job** (`POST /serve/tiles/<set>/bake?min=&max=`) writes a new archive that includes the edits.

| route | |
|---|---|
| `GET /serve/` | the sets, their archives, recent jobs |
| `GET /serve/tiles/<set>/<z>/<x>/<y>.mesh` | one mesh tile, gzip; headers `X-From` (cache / archive / baked) and `X-Bake-Ms` |
| `GET /serve/tiles/<set>.pmtiles` | the archive, by byte ranges (what a CDN would serve) |
| `GET /serve/tiles/<set>/meta.json` | bounds, zooms, version, the archive |
| `POST /serve/tiles/<set>/edit` | `{ layer, gid \| name, props?, rings? }` |
| `POST /serve/tiles/<set>/bake?min=0&max=6` | a job |
| `GET /serve/events` | server-sent: `edit`, `job`, `archive` |

Sets (`sets.ts`), with data from the data folder (`ASLNUT_DATA`, default `<repo>/data`), never in git:

| set | data | zoom levels |
|---|---|---|
| `world` | Natural Earth countries, ice, lakes | z0–8 |
| `vic-lga` | Vicmap LGAs; `h` extrudes | z4–14 |
| `vic-suburbs` | Vicmap suburbs and localities | z7–14 |
| `idn-provinces` | BIG (Badan Informasi Geospasial) | z2–12 |

Edits go to an append-only log (`<set>.edits.jsonl` next to the archive) and are replayed on start.

The tile baker is `mesh-tile.ts` (pure functions, bytes out); the archives are read and written with the library's own PMTiles code (`packages/aslnut/src/core/data/sources/pmtiles.ts`).
