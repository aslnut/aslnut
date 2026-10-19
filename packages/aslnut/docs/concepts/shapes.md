# Shapes

> Draft under discussion. The examples on this page are the design sketch; the names as built and every part's status are on the reference page ([core › geometry › shapes](../reference/core/geometry.md#shapes-shape)).

**In one line:** a shape is TypeScript that turns parameters into a 3D object (a car, a bed, a wind turbine). You write only the shape; aslnut builds it, keeps it, and gets it onto the screen with WebGPU or WebGL2.

**Where it lives:** the shape *mechanism* (shape, builder, parts, levels, instances, checks, recipes) is in core (`core/geometry/shapes`); the *objects* (cars, beds, turbines) live outside core, in modules, kits or apps.

## Why

- **One definition, many variants.** Every row of data can make its own size, colour or type.
- **People write TypeScript, not GPU code.** The graphics part is aslnut's job.
- **Objects for every app:** buildings, street furniture, vehicles, machines, furniture, bodies.

## The rules

1. A shape has an `id`, `params` (every knob, with a range and a default) and `build(p, b, rand, detail)`.
2. `build` uses the **builder** `b` to make pieces: everything in metres, standing on y = 0.
3. **Parts** (`b.part`) are pieces that can move; **anchors** (`b.anchor`) are contact points for people and other things.
4. **Presets** are named sets of params, nothing more.
5. **Levels** (full → simple → box → dot → counted) are written by you or made automatically.
6. A shape never touches WebGPU or WebGL2; aslnut does that (see *From your TypeScript to the screen*).
7. A shape that one app uses lives in that app; when a second product needs it, it moves to a module.

## The contract

```ts
const thing = shape({
  id: 'furniture.bed',                       // unique, dotted
  params: { … },                             // every knob, with a range and a default
  build(p, b, rand, detail) { … },           // your code: p = params, b = builder
  far: (p, b) => { … },                      // optional: the cheap far-away version
});
thing.preset('king', { width: 1.8 });        // named configs
```

| param type | example | form control |
|---|---|---|
| `num(min, max, default)` | `num(30, 160, 90)` | slider |
| `int(min, max, default)` | `int(2, 5, 3)` | stepper |
| `choice(options, default)` | `choice(['pickup', '4x4', 'van'], 'pickup')` | dropdown |
| `color(default)` | `color('#f2f2f2')` | colour picker |
| `text(default)` | `text('PLN')` | text field |
| `flag(default)` | `flag(true)` | switch |

- **`rand`:** a seeded random function (the seed comes from the shape id and the variant), so a variant always builds the same way.
- **`detail`:** `'near' | 'mid' | 'far'`, so one `build` can skip small parts far away.

## The builder (`b`)

```tree
builder/
├── solid
├── extrude
├── lathe
├── sweep
├── copy
├── scope
└── mesh
```

| verb | plain meaning |
|---|---|
| `solid` | a box, cylinder, sphere, cone or capsule, by size and centre (`at`) |
| `extrude` | an outline pushed up into a solid |
| `lathe` | a profile spun round an axis (a vase, a wheel hub, a tower) |
| `sweep` | a profile pulled along a path (a rail, a moulding, a car's side profile → its body); `extrude` and `lathe` are its two common cases |
| `copy` | the same pieces mirrored, repeated, along a path or scattered in an area |
| `scope` | a box or a footprint split into floors, bays and faces: how buildings are made (a grammar of rules) |
| `mesh` | raw triangles: the escape hatch |
| the finish, on every verb | `round` (softened edges), `color`, `material` (glass: see-through panes; metal; paint; emissive), `tint` (each copy's own colour), `label` (text on a surface), `lamps` (head, tail and window lights that glow at night) |

**Parts** (`b.part`, `b.anchor`, `b.group`, `b.frame`) name what the verbs build:

| piece | plain meaning |
|---|---|
| `part` | a named piece that can move (wheels, doors, rotor) |
| `anchor` | a named contact point with a kind: seat, grip, foot, entry, parking, lie, sit |
| `group` | a named set of pieces that does not move (a cab, a bay) |
| `frame` | building moved, turned or scaled |

## Example 1 · the simplest: one box

```ts
const crate = shape({
  id: 'crate',
  params: { size: num(.3, 2, .6), color: color('#9a6b3c') },
  build: (p, b) => b.box({ size: [p.size, p.size, p.size], at: [0, p.size / 2, 0], color: p.color }),
});
```

## Example 2 · a bed: a few boxes, params, places to sit and lie

```ts
const bed = shape({
  id: 'furniture.bed',
  params: {
    width:     choice([.9, 1.2, 1.6, 1.8], 1.6),     // single … king
    length:    num(1.9, 2.2, 2.0),
    frame:     color('#6b4a2f'),
    sheet:     color('#e8e4dc'),
    headboard: flag(true),
    pillows:   int(0, 4, 2),
  },
  build(p, b, rand, detail) {
    const W = p.width, L = p.length, legH = .25, frameH = .12, mattH = .22;
    for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]])
      b.box({ size: [.06, legH, .06], at: [x * (W / 2 - .04), legH / 2, z * (L / 2 - .04)], color: p.frame });
    b.box({ size: [W, frameH, L], at: [0, legH + frameH / 2, 0], color: p.frame });
    b.box({ size: [W - .04, mattH, L - .04], at: [0, legH + frameH + mattH / 2, 0], color: p.sheet, round: .04 });
    if (p.headboard) b.box({ size: [W, .9, .06], at: [0, .45 + legH, -L / 2 - .03], color: p.frame });
    const top = legH + frameH + mattH;
    if (detail !== 'far')
      for (let i = 0; i < p.pillows; i++) {
        const x = (i + .5) / p.pillows * W - W / 2;
        b.box({ size: [W / p.pillows - .06, .12, .4], at: [x, top + .06, -L / 2 + .3],
                color: p.sheet, round: .05, jitter: rand(.02) });   // a little untidy
      }
    b.anchor('lie',  [0, top, 0],            { kind: 'lie', heading: 0 });
    b.anchor('sitL', [-W / 2 + .1, top, .2], { kind: 'sit', heading: -90 });
    b.anchor('sitR', [ W / 2 - .1, top, .2], { kind: 'sit', heading:  90 });
  },
  far: (p, b) => b.box({ size: [p.width, .6, p.length], at: [0, .3, 0], color: p.sheet }),
});
bed.preset('single', { width: .9,  pillows: 1 });
bed.preset('king',   { width: 1.8, pillows: 4 });
```

## Example 3 · the same bed with no code: parts as data

For no-code tools and AI assistants. Expressions in `{…}` read the params.

```json
{
  "id": "furniture.bed-simple",
  "params": { "width": { "type": "number", "range": [0.9, 1.8], "default": 1.6 } },
  "parts": [
    { "box": ["{width}", 0.12, 2.0],         "at": [0, 0.31, 0],    "color": "#6b4a2f" },
    { "box": ["{width} - 0.04", 0.22, 1.96], "at": [0, 0.48, 0],    "color": "#e8e4dc", "round": 0.04 },
    { "box": ["{width}", 0.9, 0.06],         "at": [0, 0.7, -1.03], "color": "#6b4a2f" }
  ],
  "anchors": { "lie": [0, 0.59, 0] }
}
```

## Example 4 · a car: a profile, parts that move, anchors from the same numbers

Modelled on a reference car shape: a side profile, axles, a belt line (the window line), then the seat placed from the belt line.

```ts
export const car = shape({
  id: 'vehicle.car',
  params: {
    type:   choice(['pickup', '4x4', 'van'], 'pickup'),
    length: num(3.6, 5.6, 4.9),  width: num(1.6, 2.0, 1.8),  height: num(1.4, 2.1, 1.8),
    wheel:  num(.30, .45, .38),  paint: color('#ffffff'),  livery: text('PLN'),  rack: flag(true),
  },
  build(p, b, rand, detail) {
    const L = p.length, W = p.width, H = p.height, r = p.wheel;
    const belt = H * .55, cabEnd = p.type === 'pickup' ? L * .55 : L * .9;

    // body: a side profile swept across the width; tint = takes the paint colour
    const side = profile([[0, r], [0, belt], [L * .18, H], [cabEnd, H], [cabEnd + .1, belt], [L, belt], [L, r]]);
    b.part('body', () => b.sweep(side, W, { tint: true }));
    if (p.type === 'pickup') b.part('bed', () => b.tray([cabEnd, L], W, belt - r));
    b.glass(b.windows(side, { from: r + belt * .2, to: H - .05, until: cabEnd }));

    // four wheels as parts, so kinematics can spin and steer them
    for (const [x, s] of [[L * .2, 1], [L * .2, -1], [L * .8, 1], [L * .8, -1]])
      b.part(`wheel${x < L / 2 ? 'F' : 'R'}${s > 0 ? 'R' : 'L'}`,
             () => b.cylinder({ at: [x, r, s * (W / 2 - .1)], radius: r, width: .25, axis: 'z' }));
    b.part('doorL', () => b.panel({ from: [L * .25, r], to: [L * .5, belt], side: -1 }), { pivot: [L * .25, 0, -W / 2] });

    // small details only when close
    if (detail !== 'far') {
      b.lamps({ head: [[L, belt * .8, W / 2 - .2], [L, belt * .8, -(W / 2 - .2)]],
                tail: [[0, belt * .8, W / 2 - .2], [0, belt * .8, -(W / 2 - .2)]] });
      b.label(p.livery, { on: 'side', at: [L * .45, belt * .7], height: .25 });
      if (p.rack) b.rack({ on: 'roof', length: cabEnd * .7 });
    }

    // contact points, computed from the same numbers: every size gets them right
    const seatY = belt - .42, seatX = L * .38;
    b.anchor('driver',    [seatX, seatY, -W / 4],                  { kind: 'seat' });
    b.anchor('passenger', [seatX, seatY,  W / 4],                  { kind: 'seat' });
    b.anchor('gripL',     [seatX + .45, belt + .05, -W / 4 - .18], { kind: 'grip' });
    b.anchor('gripR',     [seatX + .45, belt + .05, -W / 4 + .18], { kind: 'grip' });
    b.anchor('pedals',    [seatX + .75, r + .1, -W / 4],           { kind: 'foot' });
    b.anchor('doorL',     [L * .38, 0, -W / 2 - .5],               { kind: 'entry', heading: 90 });
  },
  far: (p, b) => b.box({ size: [p.length, p.height * .8, p.width], at: [p.length / 2, p.height * .4, 0], tint: true }),
});
car.preset('pickup-pln', { type: 'pickup', paint: '#f5f5f5', livery: 'PLN' });
car.preset('4x4-field',  { type: '4x4',    paint: '#2f5d3a', livery: '', height: 1.9 });
```

## Many of one shape, each its own

```ts
w.add(entities({
  data: data.geojson('https://…/wind-farms.geojson'),
  shape: windTurbine,
  params: d => d.props.model ? windTurbine.presets[d.props.model]
                             : { hubHeight: d.props.hub_m, rotor: d.props.rotor_m },
  variation: { seed: d => d.id, color: .05 },          // small natural differences
}));
```

## From your TypeScript to the screen

**Who does what:** you write steps 1 and 2. aslnut does steps 3 to 7. You never write GPU code.

| step | who | what happens |
|---|---|---|
| 1 | you | write the shape (`shape`) |
| 2 | you | place it (`entities({ shape, data })`) |
| 3 | aslnut | **build:** run `build` once per unique set of params → a mesh (plain numbers) |
| 4 | aslnut | **cache:** keep the mesh; never build the same thing twice |
| 5 | aslnut | **choose WebGPU or WebGL2** once, when the world starts |
| 6 | aslnut | **upload** the same numbers to the graphics chip, once per mesh |
| 7 | aslnut | **draw** every copy in one call per mesh, every frame, with aslnut's own shader |

The running example: the crate above, three on the map.

**Step 1 and 2 · you**
```ts
w.add(entities({
  id: 'crates', shape: crate,
  data: [
    { lon: 107.610, lat: -6.900, size: 1 },
    { lon: 107.611, lat: -6.900, size: 1 },
    { lon: 107.612, lat: -6.900, size: 2 },
  ],
  params: d => ({ size: d.size }),
}));
```

**Step 3 · build.** There are two different param sets (`size: 1` twice, `size: 2` once), so `build` runs **twice, not three times**. The builder turns `b.box(…)` into triangles. For the size-1 crate:

```text
pos  (24 corners × x, y, z in metres)
  front:  -0.5,0,0.5    0.5,0,0.5    0.5,1,0.5    -0.5,1,0.5
  back:    0.5,0,-0.5  -0.5,0,-0.5  -0.5,1,-0.5    0.5,1,-0.5
  … 4 more faces
nor  (which way each corner's face looks)
  front: 0,0,1 ×4   back: 0,0,-1 ×4   top: 0,1,0 ×4 …
col  (#9a6b3c → 0.60, 0.42, 0.24 per corner)
tris (12 triangles, 3 corner numbers each)
  0,1,2   0,2,3   4,5,6   4,6,7   …
```

Each face has its own 4 corners, so it gets one direction and shades as a crisp flat side.

**Step 4 · cache.** The key is `crate` + `{ size: 1, color: #9a6b3c }` + level `full`. Anything asking for the same crate again reuses the mesh. That's why 500 turbines in 5 sizes cost 5 builds.

**Step 5 · choose WebGPU or WebGL2** (once, when the world starts):
```ts
const adapter = navigator.gpu && await navigator.gpu.requestAdapter();
graphics = adapter ? new WebGPUGraphics(canvas, adapter)                  // new phones, PCs
                   : new WebGL2Graphics(canvas.getContext('webgl2'));       // older phones, some browsers
```
Everything after this goes through one interface (`createBuffer`, `createPipeline`, `draw`). The rest of aslnut never knows which one it is.

**Step 6 · upload,** the same numbers to either:
```ts
// WebGPU
const pos = device.createBuffer({ size: mesh.pos.byteLength, usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST });
device.queue.writeBuffer(pos, 0, mesh.pos);
// WebGL2
const pos = gl.createBuffer();
gl.bindBuffer(gl.ARRAY_BUFFER, pos);
gl.bufferData(gl.ARRAY_BUFFER, mesh.pos, gl.STATIC_DRAW);
```

aslnut also uploads one small list per mesh, one row per crate: where it stands and how it's turned.
```text
size-1 mesh → [ x1, z1, heading1, 1 ],  [ x2, z2, heading2, 1 ]
size-2 mesh → [ x3, z3, heading3, 1 ]
(x, z = metres from the map centre; the ground's height is added from the terrain)
```

**Step 7 · draw.** The shader (the small program on the graphics chip) is aslnut's, written twice by hand, once per language, line for line:
```wgsl
// WGSL, for WebGPU
@vertex fn vs(@location(0) pos: vec3f, @location(1) nor: vec3f, @location(2) col: vec3f,
              @location(3) inst: vec4f) -> Out {
  let p = rotateY(pos, inst.z) + vec3f(inst.x, groundAt(inst.xy), inst.y);
  var o: Out;
  o.pos = frame.viewProj * vec4f(p, 1.0);          // where on screen
  o.col = col * sunLight(rotateY(nor, inst.z));     // how bright
  return o;
}
```
```glsl
// GLSL, for WebGL2
in vec3 pos; in vec3 nor; in vec3 col; in vec4 inst;
void main() {
  vec3 p = rotateY(pos, inst.z) + vec3(inst.x, groundAt(inst.xy), inst.y);
  gl_Position = viewProj * vec4(p, 1.0);
  vCol = col * sunLight(rotateY(nor, inst.z));
}
```
```ts
// one draw per mesh, all its crates at once
pass.drawIndexed(36, 2);                                              // WebGPU: 36 corner numbers, 2 crates
gl.drawElementsInstanced(gl.TRIANGLES, 36, gl.UNSIGNED_INT, 0, 2);    // WebGL2: the same
```
The size-2 mesh gets its own call with count 1, so 3 crates take **2 draw calls**, on either. A parity check draws the same frame both ways and compares the pixels, so the two shaders never drift apart.

**Moving parts.** You mark `b.part('wheelFL', …)` and give `kinematics` and `drive` (see [entities](entities.md)). Each frame aslnut computes each part's rotation, puts it in the per-copy list, and the shader turns those vertices. The mesh is never rebuilt.

**Far away.** aslnut builds the far version once (steps 3–6 again) and, each frame, moves each copy to the level its size on screen calls for.

**An imported glb** (`shapes.import('truck.glb')`) reads the file's numbers and joins at step 4. From there it's identical.

```tree
src/
└── core/
    ├── geometry/
    │   └── shapes/
    │       ├── shape.ts
    │       ├── builder.ts
    │       ├── scope.ts
    │       ├── parts.ts
    │       ├── mesh.ts
    │       ├── levels.ts
    │       ├── instances.ts
    │       ├── solids.ts
    │       ├── checks.ts
    │       └── recipes.ts
    ├── render/
    │   └── graphics/
    │       ├── interface.ts
    │       ├── webgpu.ts
    │       ├── webgl2.ts
    │       └── shaders/
    │           ├── solid-inst.wgsl.ts
    │           └── solid-inst.glsl.ts
    └── runtime/
        └── workers.ts
```

| file | step |
|---|---|
| `shape.ts` | 3, 4: run `build` per unique params, cache keys |
| `builder.ts`, `scope.ts`, `parts.ts` | 3: `b.solid()` … → triangles |
| `mesh.ts` | 3: the triangles as plain numbers |
| `levels.ts` | full / simple / box / dot / impostor |
| `instances.ts`, `solids.ts` | 6: one row per copy; upload once, draw many |
| `checks.ts` | a shape checked and previewed at every level |
| `graphics/interface.ts` | 5: one interface for both |
| `graphics/webgpu.ts`, `graphics/webgl2.ts` | 6, 7 with each one's calls |
| `graphics/shaders/solid-inst.wgsl.ts`, `solid-inst.glsl.ts` | 7: the shader in both languages |
| `runtime/workers.ts` | builds run off the main thread |

**In one sentence:** you write a TypeScript recipe; aslnut runs it into numbers, gives those numbers to whichever graphics API the device has, and draws them with its own shader written for that API.

**Where it comes from:** a reference mesh builder (`box`, `tri`, `quad`, `frustum`, `blob`, `limb`, `glass`, `label`, `anchor`, `fx`, `out()`) already returns plain typed arrays. The aslnut builder is that one, generalised.

## Levels: how far away looks

```tree
car/
├── full
├── simple
├── box
├── dot
└── counted
```

```ts
// 1 · only the real form: the rest is automatic (simplified like a crowd's levels)
shape({ id: 'car', params, build });

// 2 · the real form + your own simple one
shape({ id: 'car', params, build, far: (p, b) => b.box({ … }) });

// 3 · as many as you want, named, with your own switch rules
shape({ id: 'car', params, levels: {
  full:   { build,                                when: s => s.pixels > 120 },
  simple: { build: (p, b) => buildBodyOnly(p, b), when: s => s.pixels > 25 },
  box:    { auto: 'box',                          when: s => s.pixels > 4 },
  dot:    { auto: 'dot' },
}});

// 4 · the user of a shape can override without touching it
entities({ shape: car, levels: { full: { when: s => s.pixels > 300 } } });
```

- **By size on screen in pixels,** not distance.
- **The budget can push it:** a busy frame drops a level earlier.
- **No popping:** a short crossfade at the switch, with a margin so it doesn't flicker back.
- **Preview:** a thumbnail per level, a distance slider, triangle counts per level against the shape's budget.

## The shape package

One shape is one folder, so people can write and share their own.

```tree
wind-turbine/
├── shape.ts
├── shape.json
├── presets.json
├── kinematics.ts
├── states.ts
├── thumbs/
│   ├── default.webp
│   └── presets.webp
├── test.ts
└── LICENCE
```

| file | what it is |
|---|---|
| `shape.ts` | the shape's code: params, build, far |
| `shape.json` | the manifest, readable without running code |
| `presets.json` | named configs |
| `kinematics.ts`, `states.ts` | optional: joints and motions (see [entities](entities.md)) |
| `thumbs/` | a default image and a 4×4 sheet of presets |
| `test.ts` | the checks |

```json
{
  "id": "earth.infrastructure.wind-turbine",
  "version": "1.2.0",
  "params": {
    "hubHeight": { "type": "number", "range": [30, 160], "default": 90, "unit": "m" },
    "blades":    { "type": "int",    "range": [2, 5],    "default": 3 },
    "axis":      { "type": "choice", "options": ["horizontal", "vertical"], "default": "horizontal" },
    "color":     { "type": "color",  "default": "#f2f2f2" }
  },
  "parts":   ["tower", "nacelle", "rotor"],
  "anchors": { "service": "parking", "door": "entry" },
  "budget":  { "near": 6000, "far": 40 },
  "licence": "MIT", "author": "…"
}
```

**The checks every shape passes** (from a reference implementation's checks, generalised):
- it builds at every param's minimum, maximum and default;
- its triangles stay within the declared budgets;
- every declared anchor and every part the kinematics use exists;
- a build finishes within a time limit, in a worker, so a stranger's shape can't freeze the page;
- a far version exists, written or automatic.

**Forms for free:** because params are declared, any studio draws the form itself (sliders, colour pickers, dropdowns), with a live preview and save as preset.

```ts
import turbine from './shapes/wind-turbine/shape.ts';
w.shapes.use(turbine);                                    // your own
w.shapes.load('https://…/shapes/catalog.json');           // a catalog by URL
```

## Import

Shapes can also come from files; see [formats](formats.md).

```ts
const truck = await shapes.import('/models/pln-truck.glb', {
  parts:   { doorL: 'Door_L', wheelFL: 'Wheel_FL' },           // the file's node names → our parts
  anchors: { driver: 'Seat_Driver', gripL: 'Wheel_Grip_L' },   // empty markers in the file → anchors
  levels:  { simple: 'auto', box: 'auto' },
});
```

## How it relates

- **[Entities](entities.md):** a shape plus joints and motion is an entity.
- **[Observation](observation.md):** picks the level.
- **[Graphics](graphics.md):** steps 5–7.
- **[Formats](formats.md):** imported files become shapes.

## Common mistakes

- **Writing GPU code in a shape.** Never needed; `build` only makes numbers.
- **Computing anchors by hand per size.** Compute them from the same params in `build`.
- **One shape per variant.** Use params and presets.

## Open questions

- Should the JSON (no-code) form be a first-class format, or a convenience that compiles to `build`?
- The default time limit for a build in a worker?

## Status

| part | status |
|---|---|
| every part on this page | its row in [core › geometry](../reference/core/geometry.md#shapes-shape) (the statuses live in the one tree) |
| the shape contract, builder, anchors, presets, checks, studio forms | a reference implementation exists |
