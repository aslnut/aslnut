# The map: every part of aslnut, and how they work together

> Draft under discussion.

**In one line:** aslnut has four roots (core, modules, kits, tools). Your code describes a world, the world decides what's needed for the current view, the loader fetches it, and the graphics part draws it with WebGPU or WebGL2.

The colours show what exists today in the package (`packages/aslnut`):
- **built:** in the package, tested on WebGPU and WebGL2;
- **partly:** some of it is in the package;
- **planned:** agreed, not in the package yet (a research prototype may exist);
- **proposed:** a new idea, not yet agreed;
- **open:** a question waiting for a decision.

## The hierarchy

Tap ▸ to open a branch. Tap a name to jump to its row in the reference.

```hier
```

## How the pieces work together

From your code to the screen, top to bottom. Each box links to its page.

```flow
{
  "steps": [
    { "title": "1 · Your code", "text": "You describe what the world is. Only TypeScript (or JSON), never GPU code.",
      "items": ["a body: earth(), plane()", "the fabric: networks, zones, rules", "data: sources, rows, joins", "layers and shapes: line, area, extrusion, your own shapes", "entities and agents: things that move and decide", "when: the condition for every element"],
      "href": "concepts/world-and-body.md" },
    { "title": "2 · The world", "via": "w.add(…)", "text": "Holds everything that exists, whether shown or not.",
      "items": ["body + surface (imagery, terrain)", "layers (marks from data)", "entities (shapes, joints, states)", "agents (behaviour, rhythm)", "phenomena (fields and rules)"],
      "href": "concepts/presence.md" },
    { "title": "3 · Observation", "via": "every frame: what does this view need?", "text": "Decides what is needed now, at what level, within the budget.",
      "items": ["each element's when (view, time, user, device)", "levels by size on screen (full → simple → box → dot)", "the budget: what to drop first when frames run long", "what the camera will need next (prefetch)"],
      "href": "concepts/observation.md" },
    { "title": "4 · Loading", "via": "what's missing", "text": "Fetches tiles and data once, keeps them, can work offline.",
      "items": ["the loader: memory → packs → browser cache → network", "compiled chunks streamed near the camera", "readiness: plan, rehearse, replay", "terms: only what each licence allows"],
      "href": "reference/core/data.md#loading-loader" },
    { "title": "5 · Building", "via": "data and shapes → numbers", "text": "Turns data and shapes into triangles and buffers of plain numbers, off the main thread where heavy.",
      "items": ["layers prepare their geometry (draped on the ground)", "shapes run build() once per unique set of params", "cache: the same thing is never built twice"],
      "href": "concepts/shapes.md#from-your-typescript-to-the-screen" },
    { "title": "6 · Drawing", "via": "the same numbers", "text": "The graphics part uploads the numbers and draws them with aslnut's own shaders.",
      "items": ["WebGPU on new devices", "WebGL2 on older phones and browsers", "chosen once, automatically; you never write for either"],
      "href": "concepts/graphics.md" },
    { "title": "7 · The screen", "via": "pixels", "text": "One frame. Then it starts again at step 3.", "href": "concepts/quality.md" }
  ],
  "loops": [
    { "title": "Interaction comes back to your code", "text": "hover and tap find the feature under the finger → hover looks, tooltips, and your onHover / onTap functions run → they may change data, params or the camera.", "href": "concepts/interaction.md" },
    { "title": "Time and simulation tick", "text": "the clock moves → agents follow their rhythm, fields and rules update, entities' joints are driven → the world changes → observation sees it next frame.", "href": "concepts/entities.md" },
    { "title": "Live data arrives", "text": "a stream's upsert / patch / remove → only what changed is rebuilt → the chronicle logs it for replay → the reveal plays for new features.", "href": "concepts/live-twins.md" },
    { "title": "Fields step", "text": "each tick the rules advance the fields (water, heat, smoke) on the graphics chip or the CPU → probes read values → coupled fields and networks react.", "href": "concepts/physics.md" },
    { "title": "Partners trade values", "text": "an external engine or an FMI model receives inputs and returns outputs each step → streams update the world.", "href": "concepts/live-twins.md" },
    { "title": "Ahead of time: compile", "text": "on the authoring machine, after you save or from the command line: solve → resolve → mesh → chunks + logic pack + manifest → step 4 streams the chunks near the camera instead of building live.", "href": "concepts/compile.md" },
    { "title": "The governor holds the frame", "text": "frame times are measured → when frames run long, detail steps down in your priority order → it steps back up when there's room.", "href": "concepts/performance.md" }
  ]
}
```

## The four roots

| root | what lives there | rule |
|---|---|---|
| `core` | the machinery: world, space, time, data, geometry, entities, simulation, render, interaction, runtime | knows no domain: no Earth, no cars, no people |
| `modules` | the defaults built with the machinery: world bodies and their natural systems (Earth, Sun, Moon, Mars, a plane, space), and presets: ready-made things for any world (humans, animals, vehicles, drones, robots) and for Earth (roads, buildings, plants…) | may be domain-specific; replaceable |
| `kits` | opinionated pieces for a kind of app: dashboard, game, authoring (what a studio edits: fabric and rules, saved as diffs), compat (other web-map interfaces running on a world unchanged: Leaflet-compatible, built only from the public interface) | built only from core and modules; the screens stay in apps |
| `tools` | Node-only work at build time: geo analysis, baking, converting, exporting, the command line | never in the browser bundle |

**What a world is made of:** a body (terrain, terraform, water level) + a fabric (networks and areas, and the structures made from them) + rules (fabric → entities) + fields + sky and time + entities. Roads and rivers are fabric, not entities ([the fabric](concepts/fabric.md)).

**Not in aslnut:** telling stories with worlds (scripts, timelines, video), which is built on aslnut, outside it.
