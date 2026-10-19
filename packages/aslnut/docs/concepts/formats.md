# Formats

> Draft under discussion.

**In one line:** aslnut reads a few open 3D formats directly in the browser (glTF/GLB, OBJ, PLY, 3D Tiles); everything heavier (FBX, IFC, CityGML, LAS, USD) is converted ahead of time by `tools`, so a phone only ever opens light, ready files.

## Why

- **People bring models:** a truck from a CAD team, a building from a city's open data, a scanned site.
- **Phones shouldn't parse heavy formats.** IFC or FBX parsing is slow and large; it belongs in a conversion step.
- **One way in:** every imported model becomes a [shape](shapes.md), so levels, parts, anchors and instancing all work the same.

## The rules

1. **Read at run time (core):** glTF/GLB with its common extensions, OBJ, PLY, 3D Tiles.
2. **Read by a module:** CityJSON (earth buildings), VRM (human avatars).
3. **Converted by tools, ahead of time:** FBX, IFC, CityGML, LAS/LAZ, USD → glTF or packs.
4. **Exported:** glTF and USD from a scene; images and video from capture.
5. **An import is a shape:** `shapes.import(url, { parts, anchors, levels })` maps the file's node names to parts and anchors.
6. Missing levels are made automatically (simplified versions, a box, a dot).

```tree
formats/
├── runtime/
│   ├── gltf
│   ├── glb
│   ├── gltf-extensions/
│   │   ├── draco
│   │   ├── meshopt
│   │   ├── ktx2
│   │   ├── lights
│   │   └── variants
│   ├── obj
│   ├── ply
│   └── tiles3d
├── modules/
│   ├── cityjson
│   └── vrm
├── convert/
│   ├── fbx
│   ├── ifc
│   ├── citygml
│   ├── las
│   └── usd
├── export/
│   ├── gltf
│   └── usd
└── later/
    └── splats
```

| format | what it is | where |
|---|---|---|
| glTF / GLB | the standard web 3D file (GLB = one binary file) | core |
| draco, meshopt | compressed geometry | core |
| ktx2 | compressed textures the graphics chip reads directly | core |
| lights, variants | lights in the file; colour/material options | core |
| OBJ | old simple meshes | core |
| PLY | points and scans | core |
| 3D Tiles | streamed city-scale models | core |
| CityJSON | city buildings with semantics | earth › presets › built › buildings |
| VRM | humanoid avatars (glTF + rig rules) | presets › humans |
| FBX | animation packages | tools › convert |
| IFC | building design (BIM) | tools › convert |
| CityGML | city models as XML | tools › convert |
| LAS / LAZ | lidar point clouds | tools › convert |
| USD | film and studio 3D scenes | tools › convert, export |
| splats | photo-real captures as soft points | [proposed] later |

## Examples

```ts
// 1 · a GLB as a shape, with parts and anchors from its node names
const truck = await shapes.import('/models/pln-truck.glb', {
  parts:   { doorL: 'Door_L', wheelFL: 'Wheel_FL' },
  anchors: { driver: 'Seat_Driver' },
  levels:  { simple: 'auto', box: 'auto' },
});
w.add(entities({ shape: truck, data: fleet }));

// 2 · 3D Tiles of a city
w.add(tiles3d({ url: 'https://…/tileset.json', when: { level: { from: 'street' } } }));

// 3 · convert heavy files ahead of time
// $ aslnut convert site.ifc --to glb --out ./models
// $ aslnut convert scan.laz --to pack --out ./packs/scan
```

## How it relates

- **[Shapes](shapes.md):** an import joins the shape pipeline at step 4 (the cache).
- **[Compile](compile.md):** conversion and compile both run on the authoring machine.
- **[Licences](licences.md):** an imported model keeps its licence and attribution.

## Common mistakes

- **Loading IFC or FBX on a phone.** Convert first.
- **Huge textures in a GLB.** Use ktx2.

## Status

| part | status |
|---|---|
| everything on this page | [planned] |
| PLY reading | [planned] (a reference reader for scans exists) |
