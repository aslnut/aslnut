# kits › authoring

> Draft under discussion. Statuses: **built** = in `packages/aslnut`, tested on WebGPU and WebGL2; **partly** = some of it there; **planned** = not there yet (a research prototype may exist).

**In one line:** what a studio edits: the fabric (networks, zones), the rules that turn fabric into things, and the ground (terraform), all saved as diffs over the source data; generated output is never edited. Built only from core and modules; the screens (panels, toolbars, menus) stay in apps.

Concepts: [the fabric](../../concepts/fabric.md) · [real-world authoring](../../concepts/real-world-authoring.md) · [networks](../../concepts/networks.md) · [compile](../../concepts/compile.md) · [boundaries](../../concepts/boundaries.md)

<!-- tree:reference/kits/authoring -->
```tree
authoring/
├── networks
├── zones
├── rules
├── terraform
├── diffs
└── pieces
```
<!-- /tree -->

## The rule

- **Edit the fabric and the rules, never the output.** A road's centreline, a zone's edge and a rule's density are edited; the swept road surface, the clamped ground and the scattered trees are generated again from them.
- **Every edit is a diff** over the source data (OSM, a cadastre, your own files), so a source update can be applied under the edits, and edits can be listed, undone and shared.
- **The kit gives the edit operations and their previews;** the screens that call them are the app's.

## API

| item | signature | params (type = default) | returns | status | example |
|---|---|---|---|---|---|
| `networks` | `edit.network(net)` · `.move(node, to)` · `.split(edge, at)` · `.join(a, b)` · `.set(edge, props)` · `.remove(id)` | `net: Network` (roads, rails, channels, ways) · `props`: section, lanes, speed, structure… | `Edit` (a diff); sections, junctions, structures and the clamp are rebuilt where it changed | [planned] | `edit.network(roads).set('e-418', { lanes: 4, sidewalks: { left: 2 } })` |
| `zones` | `edit.zones(z)` · `.draw(polygon, kind)` · `.reshape(id, polygon)` · `.kind(id, kind)` · `.remove(id)` | `z: Zones` · `kind: string` (block, residential, lot, park…) | `Edit` (a diff); the rules rerun inside the changed zones only | [planned] | `edit.zones(city).draw(poly, 'park')` |
| `rules` | `edit.rules(rules)` · `.set(kind, rule)` · `.tune(kind, params)` | `rule: Rule` (core › geometry › zones › rules) · `params`: density, setback, species… | `Edit`; every zone of that kind is regenerated | [planned] | `edit.rules(cityRules).tune('park', { density: 25 })` |
| `terraform` | `edit.terraform(body)` · `.raise \| lower \| flatten \| smooth (area, opts)` | `area: Polygon \| { at, radius }` · `by?: metres` · `to?: metres` · `blend?: metres = 5` | `Edit` (a height diff over the terrain, applied with the clamp) | [planned] | `edit.terraform(w.body).flatten(lot, { to: 712, blend: 4 })` |
| `diffs` | `edits.list()` · `edits.undo()` · `edits.redo()` · `edits.save()` · `edits.load(json)` · `edits.rebase(source)` | `source?: Source` (a newer source to put under the edits) | `Diff[]` (JSON, kept apart from the source data) | [planned] | `await edits.rebase(osm.roads); edits.save()` |
| `pieces` | `edit.pieces(comp)` · `.place(shape, at, opts?)` · `.align(id, to)` · `.fit(id, fit)` · `.snap(id, opts)` · `.set(id, params)` · `.remove(id)` | `comp: Composition` (core › geometry › compose) · `at: [lon, lat, h?]` · `to: Scan \| [Point, Point][]` (match points, or an automatic fit to a scan) · `fit: Fit` (tools › scan › fit) · `snap?: { grid?: metres, ground?: boolean, sockets?: boolean }` | `Edit` (a diff); the piece's footprint, exclusions, ground and foundation follow it | [proposed] | `edit.pieces(comp).place(landmark, [144.9671, -37.8183]).align('station', scan)` |

## Example

```ts
// [planned] widen a road, turn a block into a park, and keep the edits as diffs
const edits = authoring(w, { networks: [roads], zones: [city], rules: cityRules });
edits.network(roads).set('e-418', { lanes: 4, sidewalks: { left: 2, right: 2 } });   // the road, its sidewalks and the clamped ground rebuild
edits.zones(city).kind('z-77', 'park');                                               // the park rule scatters trees and benches there
const json = edits.save();                                                             // only the diffs; the output is regenerated on load
```

## Open questions

- Do diffs live in the world's JSON form, or in a file of their own beside the sources?
- Does the compiler (tools › compile) take the diffs as an input step, so compiled chunks match the edited world?
