#!/usr/bin/env python3
"""The coverage page: every need in the needs list (plus needs added since) → the rows and concepts that serve it,
with its status before and after the audit. Checks every link against the real rows.
    ASLNUT_NEEDS=<needs.md> [ASLNUT_NEEDS_RENAMES=<renames.tsv>] python3 _tree/audit.py [--write]
        (from packages/aslnut/docs; run after gen.py)
The needs list is a research file kept outside the library: ASLNUT_NEEDS (or --needs=<path>) names it. The optional
renames file (ASLNUT_NEEDS_RENAMES or --renames=<path>, tab-separated: kind, key, label, full text) turns the list's
product codes and words into the kinds of use shown in the "used by" column; without it the column stays empty."""
import os, re, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.dirname(HERE)


def arg(name, env):
    for a in sys.argv[1:]:
        if a.startswith(f'--{name}='):
            return a.split('=', 1)[1]
    return os.environ.get(env)


NEEDS = arg('needs', 'ASLNUT_NEEDS')
RENAMES = arg('renames', 'ASLNUT_NEEDS_RENAMES')
BASE = '601f034'

PAGE = {'WD': 'core/world', 'S': 'core/space', 'T': 'core/time', 'D': 'core/data', 'O': 'core/observation', 'G': 'core/geometry', 'EN': 'core/encoding', 'E': 'core/entities',
        'SM': 'core/simulation', 'R': 'core/render', 'I': 'core/interaction', 'RT': 'core/runtime', 'W': 'modules/world', 'EA': 'modules/earth',
        'MS': 'modules/space', 'MC': 'kits/compat', 'ME': 'modules/presets', 'H': 'modules/human', 'DB': 'kits/dashboard', 'GM': 'kits/game', 'AU': 'kits/authoring', 'TL': 'tools'}

# the kinds of use: from the renames file (codes and words of the needs list → a label, and a full text for the key)
CODES, WORDS, OTHER, KINDS = {}, [], None, []
if RENAMES:
    for line in open(RENAMES, encoding='utf-8'):
        if not line.strip() or line.startswith('#'):
            continue
        kind, key, label, full = (line.rstrip('\n').split('\t') + ['', '', '', ''])[:4]
        if kind == 'code':
            CODES[key] = label
        elif kind == 'word':
            WORDS.append((key, label))
        elif kind == 'other':
            OTHER = label
        if full and (label, full) not in KINDS:
            KINDS.append((label, full))


def products(cell):
    out = []
    for part in re.split(r'[,;]', re.sub(r'\(.*?\)', '', cell)):
        p = part.strip()
        if not p:
            continue
        first = p.split()[0]
        if first in CODES:
            lab = CODES[first]
        elif first.isupper() and OTHER:
            lab = OTHER
        else:
            lab = next((v for k, v in WORDS if k.lower() in p.lower()), None)
        if lab and lab not in out:
            out.append(lab)
    return ', '.join(out)


# need text in general words (where the list's own wording names a particular product)
TEXT = {
    4: 'a body: sphere / ellipsoid / **plane** (lab, game floor, a street lab), gravity, rotation',
    52: 'heat: radiation, T_mrt, energy balance, canyon air, UTCI (a street heat lab as a rule)',
    70: "co-simulation with external engines (a fleet simulation's own engine, FMI)",
    83: 'camera in aslnut: views, keys, easing presets, paths, follow; **shots / composition / continuity → the story tool (outside)**',
    115: 'assistants write shape code; hot swap in open views',
    140: 'tools convert: FBX (incl. animation clips for common rigs), IFC (BIM), CityGML, LAS → COPC, USD → glb',
    141: 'export: OpenUSD → 3D content tools / game engines (cinematic offline renders)',
    174: '**what aslnut must expose for a story tool built on it:** projection (`w.project`, `visible`), params / readouts / named points, `settled()` (strict), frame readback, camera control (views, keys, paths), `time` readable, readiness (plan / rehearse / replay), deterministic stepping, `dispose`',
    175: '**user shader hooks** (reveal / extensions WGSL) must run on WebGL2 too → a small WGSL → GLSL writer for a hook subset (an open decision against "no translator")',
    183: 'aslnut = only what creates and runs worlds; stories → a story tool built on aslnut (outside); studio apps and other apps outside',
    187: 'the repository made public after the 0.1 cleanup',
    186: 'publishable package: ESM, d.ts, subpath exports, `sideEffects: false`, LICENSE, DATA-LICENCES, examples with redistributable data, CI with a headless WebGPU smoke test; private place data kept out',
}
GROUP = {'K': 'Telling and media (served by tools built on aslnut; aslnut exposes what they need)'}

# need → links ('X:rel' = a reference row, 'c:name' = a concept, 'p:path' = a page)
M = {
    1: 'S:precision S:frames/re-rooting c:space', 2: 'S:frames/inertial S:frames/body-fixed S:frames/local S:frames/object S:frames/re-rooting',
    3: 'S:units T:scales', 4: 'S:bodies W:plane EA:body/earth c:world-and-body', 5: 'S:bodies W:sun W:moon W:mars SM:phenomena/orbits/ephemerides',
    6: 'S:ground/shells EA:air/atmosphere/scattering EA:ground/subsurface/strata', 7: 'WD:elements/props S:ground/ground c:presence', 8: 'S:cells S:regions/tree',
    9: 'W:surface/tiles S:frames/local', 10: 'S:frames/local', 11: 'S:ground/volumes SM:fields/volume c:underground', 121: 'W:sun S:bodies',
    12: 'EA:body/earth W:surface/terrain EA:body/base/terrain/grid EA:body/base/terrain/lidar', 13: 'EA:body/base/terrain/gebco EA:body/base/terrain/etopo EA:body/base/coast EA:water/sea/level EA:body/base/basemap',
    14: 'S:ground/ground D:loading/chunks/logic-pack G:networks/walkways G:networks/clamp', 15: 'W:surface/street-detail', 16: 'EA:ground/terrain/terraform R:look/cutaway SM:phenomena/exchanges G:networks/clamp AU:terraform G:landform/terraform/flatten G:landform/terraform/carve G:landform/terraform/raise G:landform/terraform/smooth G:landform/terraform/sweep G:landform/terraform/stamp G:landform/terraform/erode G:landform/compose/layers G:landform/compose/footprints G:landform/compose/exclusion G:landform/compose/ground G:landform/compose/foundation G:landform/compose/fidelity c:real-world-authoring',
    17: 'W:surface/imagery EA:body/base/imagery/esri EA:body/base/imagery/sentinel EA:body/base/imagery/osm EA:body/base/imagery/mapbox EA:body/base/imagery/custom D:sources/tiles/xyz D:sources/tiles/wms D:sources/tiles/pmtiles',
    18: 'EA:body/base/offline EA:body/base/basemap c:hosting', 19: 'WD:host/package D:loading/packs c:hosting', 20: 'S:regions/tree S:regions/rollup S:regions/pack',
    21: 'EN:marks/symbols/text R:drawing/text EN:layers/labels EA:body/base/basemap', 22: 'EA:ground/terrain/looks R:style/lens', 122: 'EA:body/base/imagery/esri EA:body/base/terrain/mapzen c:configurable',
    123: 'W:surface/terrain W:surface/imagery EA:body/base/terrain/grid EA:body/base/terrain/custom', 124: 'EA:body/earth W:surface/terrain',
    125: 'W:surface/provenance EA:body/base/terrain/mapzen',
    23: 'EN:marks/symbols/point EN:marks/lines/line EN:marks/areas/area EN:marks/areas/extrusion EN:marks/lines/arc EN:marks/lines/trail EN:marks/areas/grid EN:marks/areas/rings EN:marks/lines/arrows EN:marks/areas/raster EN:marks/symbols/text EN:marks/symbols/icon EN:marks/drape',
    24: 'WD:elements/props EN:scales R:style/ramp R:style/blend', 25: 'G:shapes/shape',
    26: 'G:shapes/builder/solid G:shapes/builder/extrude G:shapes/builder/lathe G:shapes/builder/sweep G:shapes/builder/mesh G:shapes/parts G:shapes/builder/copy G:shapes/recipes/kitbash',
    27: 'G:import/gltf G:import/gltf-extensions/draco G:import/gltf-extensions/meshopt G:import/gltf-extensions/ktx2 G:import/gltf-extensions/lights G:import/gltf-extensions/variants G:import/obj G:import/ply G:import/tiles3d G:import/pointcloud',
    28: 'G:shapes/instances R:drawing/instancing', 29: 'EA:presets/built/buildings/footprints EA:presets/built/buildings/typology EA:presets/built/buildings/facades EA:presets/built/buildings/roofs EA:presets/built/buildings/windows EA:presets/built/buildings/frontage EA:presets/built/buildings/landmarks EA:presets/built/buildings/interiors G:shapes/builder/scope',
    30: 'G:networks/analysis/graph G:networks/sections G:networks/junctions G:networks/structures G:networks/structures/bridges G:networks/structures/piers G:networks/structures/culverts G:networks/structures/decks G:networks/structures/stairs G:networks/structures/walls G:networks/structures/terraces G:networks/structures/ramps G:networks/structures/railings EA:presets/built/roads/sections EA:presets/built/roads/junctions EA:presets/built/roads/markings EA:presets/built/roads/decks EA:presets/built/roads/sidewalks EA:presets/built/roads/elevated EA:presets/built/rail EA:presets/built/rail/track EA:presets/built/rail/crossings EA:presets/built/rail/viaducts EA:presets/built/rail/stations EA:water/hydrology/water EA:water/hydrology/channels EA:presets/built/infrastructure/utilities/pipe c:fabric',
    31: 'EA:presets/living/plants/species EA:presets/living/plants/growth EA:presets/living/plants/sway EA:presets/living/plants/canopy G:shapes/recipes/branching', 32: 'G:zones/booleans G:zones/kinds G:zones/rules G:zones/rules/scatter G:zones/rules/frontage EA:life/places/lots EA:life/places/blocks c:fabric',
    33: 'R:look/materials', 34: 'R:look/cutaway', 35: 'EA:ground/subsurface/strata EA:ground/subsurface/wells EA:ground/subsurface/aquifers EA:ground/subsurface/magma c:underground',
    126: 'G:shapes/shape', 127: 'G:shapes/recipes/presets G:shapes/instances', 128: 'G:shapes/parts',
    129: 'G:shapes/levels/full G:shapes/levels/simple G:shapes/levels/box G:shapes/levels/dot G:shapes/levels/counted G:shapes/levels/impostor',
    130: 'RT:detail/detail RT:budget/budget', 131: 'G:shapes/checks', 132: 'G:shapes/recipes/package', 133: 'G:shapes/checks', 134: 'G:shapes/shape',
    135: 'WD:state/json c:shapes', 136: 'G:shapes/recipes/package TL:catalog', 137: 'G:import/gltf c:formats', 138: 'G:shapes/instances RT:workers/workers c:shapes',
    139: 'EA:presets/built/buildings/cityjson', 140: 'TL:convert/fbx TL:convert/ifc TL:convert/citygml TL:convert/las TL:convert/usd TL:scan/classify TL:scan/align TL:scan/fit TL:scan/clean TL:scan/grid TL:convert/i3s', 141: 'TL:export/usd',
    142: 'G:import/splats',
    143: 'EA:presets/built/infrastructure/energy/wind-turbine EA:presets/built/infrastructure/energy/solar-farm EA:presets/built/infrastructure/energy/pylon EA:presets/built/infrastructure/energy/substation EA:presets/built/infrastructure/mobility/charger EA:presets/built/infrastructure/utilities/pole EA:presets/built/infrastructure/utilities/lines EA:presets/built/infrastructure/utilities/pipe EA:presets/built/infrastructure/utilities/cabinet EA:presets/built/furniture/benches EA:presets/built/furniture/bollards EA:presets/built/furniture/bins EA:presets/built/furniture/umbrellas EA:presets/built/furniture/signs EA:presets/built/furniture/planters',
    36: 'E:sets/sets E:identity E:identity/id E:identity/kind E:identity/data E:placement E:placement/place E:placement/thing E:locomotion E:locomotion/none E:locomotion/rail E:locomotion/lanes E:locomotion/surface E:locomotion/air E:locomotion/water SM:agents/tiers c:entities', 37: 'E:kinematics/hinge E:kinematics/slider E:kinematics/wheel E:kinematics/ball E:kinematics/custom',
    38: 'E:body/skeleton E:body/skin E:motion/clips E:motion/poses E:motion/ik E:motion/blending', 39: 'E:sets/crowds',
    40: 'EA:life/society SM:agents/rhythm SM:agents/populations G:networks/walkways E:locomotion/surface ME:shared/locomotion/walker', 41: 'SM:agents/behaviour SM:agents/rhythm SM:agents/habitat SM:agents/senses EA:life/ecology ME:robots/android ME:robots/robot ME:drones',
    42: 'EA:presets/mobility/traffic EA:presets/mobility/signals G:networks/lanes E:locomotion/lanes ME:shared/locomotion ME:shared/locomotion/lane-follower ME:vehicles/car ME:vehicles/motorbike', 43: 'EA:presets/mobility/transit E:locomotion/rail E:drive/schedule ME:shared/locomotion/rail-follower ME:vehicles/bus ME:vehicles/minibus ME:vehicles/train',
    44: 'SM:agents/tiers', 45: 'GM:avatars I:controllers O:observers/orbit/follow', 46: 'SM:phenomena/contacts GM:collision E:locomotion/water E:locomotion/air',
    47: 'MS:satellites/tle SM:phenomena/orbits/tle SM:phenomena/orbits/n-body SM:phenomena/orbits/transfers MS:asteroids',
    48: 'S:observer/light-time S:observer/aberration S:observer/doppler S:observer/ship-time',
    144: 'E:drive E:drive/schedule E:drive/simulation E:drive/data E:drive/player E:drive/script', 145: 'E:motion/states E:motion/gaits', 146: 'E:placement/attach',
    147: 'H:expressions/emotions H:expressions/visemes H:expressions/gestures H:expressions/blink E:body/morphs E:motion/look', 148: 'H:vrm',
    149: 'H:body H:face H:hair H:clothing H:poses H:gaits H:speech H:people',
    150: 'ME:animals/quadruped ME:animals/bird ME:animals/fish ME:animals/reptile', 151: 'SM:agents/rhythm SM:agents/behaviour E:placement/attach',
    49: 'SM:fields/raster SM:fields/surface SM:fields/graph SM:fields/volume O:presence', 50: 'SM:rules/presets SM:rules/custom SM:fields/kernels',
    51: 'SM:phenomena/fluids EA:water/hydrology/water', 52: 'SM:phenomena/heat EA:climate/heat', 53: 'SM:phenomena/fire EA:climate/fire', 54: 'SM:phenomena/exchanges SM:phenomena/growth', 55: 'SM:phenomena/acoustics EA:life/soundscape',
    56: 'W:surface/sky EA:air/sky/sun EA:air/sky/moon EA:air/sky/stars EA:air/sky/cultures EA:air/sky/locks MS:stars MS:constellations c:sky',
    57: 'EA:air/atmosphere/scattering EA:air/atmosphere/haze EA:air/atmosphere/clouds EA:air/weather/presets EA:air/weather/wind EA:air/weather/rain EA:air/weather/fog R:look/materials',
    58: 'SM:phenomena/light R:look/shadows', 59: 'R:look/lights EA:presets/built/lights EA:presets/built/lights/street EA:presets/built/lights/vehicle EA:presets/built/lights/windows EA:presets/built/buildings/windows', 60: 'SM:rules/regimes', 61: 'SM:measure/probes SM:measure/sensors SM:measure/validation',
    62: 'SM:rules/coupling', 63: 'SM:constants', 152: 'SM:fields/raster O:presence',
    64: 'D:loading/loader D:loading/stores D:loading/packs D:loading/readiness', 65: 'D:features/features D:query/join',
    66: 'D:live/set D:live/upsert D:live/patch D:live/remove D:sources/services/stream',
    67: 'D:history/log D:history/state-at D:history/replay D:history/checkpoints',
    68: 'D:scenarios/base D:scenarios/variant D:scenarios/diff D:scenarios/compare', 69: 'WD:lifecycle/world c:world-and-body',
    70: 'RT:partners/external-engine RT:partners/fmi', 71: 'TL:bake RT:workers/compile TL:compile/run/command',
    72: 'D:rights/terms D:rights/capabilities/show D:rights/capabilities/prefetch D:rights/capabilities/keep D:rights/capabilities/export D:rights/attribution D:rights/licences',
    73: 'EA:analysis/geo TL:geo', 74: 'G:networks/analysis/routing G:networks/analysis/isochrones G:networks/analysis/nearest', 75: 'EA:analysis/learn',
    153: 'D:sources/files/geojson D:sources/tiles/pmtiles D:sources/services/wfs D:sources/files/csv D:sources/tiles/mvt D:sources/services/stream D:sources/custom',
    154: 'EN:marks/areas/raster D:sources/tiles/xyz D:sources/tiles/cog D:sources/tiles/wms', 155: 'D:features/rows D:query/query D:live/set D:loading/tiles', 156: 'D:query/join',
    157: 'DB:legend EN:layers/legend', 158: 'WD:elements/props', 159: 'D:scenarios/overrides',
    160: 'TL:compile/run/on-save TL:compile/run/command TL:compile/run/page TL:compile/inputs TL:compile/steps/solve TL:compile/steps/resolve TL:compile/steps/mesh TL:compile/steps/assign TL:compile/steps/solids TL:compile/steps/logic TL:compile/steps/manifest TL:compile/custom-steps TL:compile/options TL:compile/stale TL:compile/outputs RT:workers/compile',
    161: 'D:loading/chunks/manifest D:loading/chunks/logic-pack D:loading/chunks/near D:loading/chunks/far D:loading/chunks/format D:loading/chunks/streamer D:loading/chunks/hot-swap D:loading/chunks/fallback',
    76: 'T:clock', 77: 'T:clock c:boundaries', 78: 'T:ranges T:deep T:calendars T:zones',
    79: 'RT:detail/detail O:levels/ladder O:levels/level O:levels/binding O:observers/eyes O:observers/sensor O:observers/fixed c:observation', 80: 'RT:budget/budget RT:budget/governor RT:detail/priorities RT:budget/memory', 81: 'RT:detail/prefetch W:surface/tiles',
    82: 'O:observers/orbit/views O:observers/orbit/follow I:controllers E:drive/player', 83: 'O:observers/orbit/views O:observers/orbit/keys O:observers/orbit/speed/easing O:observers/orbit/paths O:observers/orbit/paths/line O:observers/orbit/paths/bezier O:observers/orbit/paths/spline O:observers/orbit/paths/along O:observers/orbit/paths/circle O:observers/orbit/aim O:observers/orbit/aim/look-at O:observers/orbit/aim/along-path O:observers/orbit/aim/heading O:observers/orbit/aim/framing O:observers/orbit/lens O:observers/orbit/lens/fov O:observers/orbit/lens/focus O:observers/orbit/lens/depth-of-field O:observers/orbit/speed O:observers/orbit/speed/ease O:observers/orbit/speed/constant O:observers/orbit/speed/hold O:observers/orbit/moves O:observers/orbit/moves/pan O:observers/orbit/moves/tilt O:observers/orbit/moves/roll O:observers/orbit/moves/dolly O:observers/orbit/moves/truck O:observers/orbit/moves/pedestal O:observers/orbit/moves/crane O:observers/orbit/moves/zoom O:observers/orbit/moves/dolly-zoom O:observers/orbit/moves/arc O:observers/orbit/moves/track O:observers/orbit/moves/chase O:observers/orbit/moves/flyover O:observers/orbit/moves/reveal O:observers/orbit/moves/whip-pan O:observers/orbit/moves/rack-focus O:observers/orbit/moves/shake O:observers/orbit/follow c:boundaries', 84: 'RT:detail/prefetch D:loading/readiness',
    85: 'WD:host/canvases', 162: 'O:presence c:presence', 163: 'O:presence c:presence', 164: 'O:presence c:presence', 165: 'WD:elements/order WD:elements/element EN:layers/layer EN:layers/stack c:order c:encoding',
    166: 'WD:host/plain WD:host/react', 167: 'R:drawing/quality R:drawing/renderer c:quality', 168: 'R:look/post R:look/materials R:look/shadows',
    96: 'I:picking/picking I:picking/hover I:events', 97: 'I:signals/signals', 98: 'DB:legend DB:cards EN:layers/labels GM:avatars GM:collision', 99: 'c:boundaries',
    100: 'I:history WD:extend/hot-swap AU:networks AU:zones AU:rules AU:terraform AU:diffs AU:pieces', 101: 'c:boundaries', 169: 'I:signals/selection',
    87: 'R:reveal/modes R:reveal/timing R:reveal/define', 170: 'R:reveal/modes', 171: 'R:reveal/modes', 172: 'R:reveal/timing R:reveal/define', 173: 'R:reveal/modes R:reveal/policy c:reveal',
    86: 'c:boundaries', 88: 'c:boundaries DB:legend EN:layers/labels', 89: 'WD:settings/readouts WD:settings/params WD:elements/props', 90: 'R:capture/capture WD:state/settled',
    91: 'c:boundaries', 92: 'c:boundaries', 93: 'TL:catalog G:shapes/checks', 94: 'R:style/theme R:style/pattern/fill R:style/pattern/stroke R:style/pattern/along', 95: 'c:boundaries',
    174: 'R:project/project R:project/visible WD:settings/params WD:settings/readouts WD:settings/points WD:state/settled R:capture/capture O:observers/orbit/views O:observers/orbit/keys O:observers/orbit/paths T:clock D:loading/readiness T:step WD:lifecycle/dispose c:boundaries',
    102: 'R:graphics/interface R:graphics/webgpu R:graphics/webgl2 R:graphics/shaders/wgsl R:graphics/shaders/glsl R:graphics/parity TL:checks/parity TL:checks/twins TL:checks/regressions',
    103: 'RT:telemetry/telemetry RT:telemetry/remote-log RT:telemetry/shots TL:checks/suite TL:checks/perf', 104: 'RT:frame RT:workers/workers RT:workers/servers', 105: 'D:loading/chunks/streamer S:cells',
    106: 'WD:lifecycle/world T:step', 107: 'WD:lifecycle/dispose WD:host/server-safe', 108: 'WD:host/react WD:host/zebflow WD:host/package',
    175: 'R:graphics/shaders/glsl R:graphics/shaders/translate R:graphics/shaders/hooks EN:marks/custom', 176: 'R:graphics/caps', 177: 'RT:workers/workers G:shapes/instances',
    109: 'WD:extend/extend WD:extend/provide c:extending', 110: 'SM:rules/custom', 111: 'WD:describe/describe WD:describe/schemas WD:describe/guide WD:lifecycle/errors TL:checks/recipes c:llms', 112: 'WD:state/json WD:describe/schemas',
    113: 'TL:cli TL:mcp', 114: 'TL:catalog', 115: 'WD:extend/hot-swap', 116: 'p:README', 178: 'WD:elements/props c:configurable', 179: 'WD:extend/provide',
    180: 'p:map p:reference/README', 181: 'G:shapes/shape WD:lifecycle/world c:shapes',
    117: 'EN:scales R:style/ramp DB:legend', 118: 'DB:stats', 119: 'R:capture/ground-truth', 120: 'D:scenarios/variant SM:rules/presets',
    182: 'RT:partners/experiment T:step', 183: 'c:boundaries', 184: 'c:boundaries',
    185: 'c:boundaries EA:life/society EA:life/ecology EA:presets/built/infrastructure/energy/wind-turbine W:shared EA:shared ME:shared', 186: 'WD:host/package TL:checks/smoke c:hosting', 187: '',
    193: 'WD:state/states c:states',
    194: 'c:boundaries',
    188: 'EA:water/sea/level EA:water/sea/shore WD:settings/params WD:settings/readouts', 189: 'EA:body/base/terrain/gebco EA:body/base/terrain/etopo EA:body/base/terrain/mapzen EA:water/sea/exposed EA:water/sea/look',
    190: 'EA:water/hydrology/flow EN:marks/lines/line R:reveal/modes', 191: 'T:deep T:ranges', 192: 'D:history/epochs O:presence',
}
NEW = {  # needs found since the list (evidence: a reference video, 2026-10-11); the last field: the kinds of use
    188: ('B', 'sea level as a world value that changes (metres; by time, params or `when`): water wherever the ground is below it, a coast that moves smoothly, a configurable look, a readout', 'videos, physics labs'),
    189: ('B', 'bathymetry in the terrain (named providers: Terrarium, GEBCO, ETOPO); exposed seafloor drawn as land with its own look; depth colouring', 'videos, physics labs, hazard twins'),
    190: ('E', 'rivers derived from the terrain (flow routing and accumulation, including the exposed shelf) as a data source drawn with `line` + `trace`', 'videos, physics labs, hazard twins'),
    191: ('G', 'paleo time scales: years ago, ka, Ma, readable as counters', 'videos, physics labs'),
    192: ('F', 'time-varying layers from datasets (e.g. ice-sheet extent per epoch) chosen by the clock or `when`', 'videos, physics labs'),
    194: ('O', 'code written for another web-map interface (Leaflet) runs on a world unchanged, each object a handle over the public parts; a few opt-in extras for what that interface cannot do', 'GIS apps moving to 3D, assistants'),
    193: ('F', 'an answer as a presentation: a saved state (camera, time, observation, layers shown with params and filters, selection) captured, applied with a camera flight and reveals, compared, checked by a schema, shared as a link', 'dashboards, presentations, assistants, city twins'),
}
JUSTIFIED = {  # rows no need names, kept with evidence
    ('core/observation', 'observers/orbit/acrobatic'): 'a design rule: always assume an acrobatic orbit; each frame only the picture moves',
    ('core/observation', 'gates/margin'): 'a design rule: a level changes past the edge by a margin; acrobatics never flip it',
    ('core/observation', 'gates/dwell'): 'a design rule: the "typing" debounce; a change shorter than a moment is no change',
    ('core/observation', 'gates/keep'): 'a design rule: a level change swaps once, the old data kept a while',
    ('core/encoding', 'join'): 'a design rule: after a change only the new, changed and gone features redraw; what stayed never blinks',
    ('kits/dashboard', 'layers'): 'a need found after the list: stacked GIS layers over a twin, with a list to show, fade and order them',
    ('modules/space', 'galaxies'): 'a need found after the list: other galaxies',
    ('modules/space', 'exoplanets'): 'a need found after the list: twins of Earth alternatives',
    ('modules/earth', 'life/places'): 'partly built; finding a place by name for camera views (#83) and assistants (#111)',
}
BEFORE = {}
for n in (175, 13, 22, 29, 30, 31, 42, 43, 44, 46, 58, 62, 78, 90, 93, 97, 100, 103, 112, 124, 131, 142, 168, 174, 182, 12, 40):
    BEFORE[n] = 'thin'
for n in (194, 193, 15, 18, 19, 60, 63, 75, 85, 89, 94, 106, 114, 115, 116, 118, 125, 159, 169, 183, 184, 185, 186, 188, 189, 190, 191, 192):
    BEFORE[n] = 'GAP'
for n in (86, 88, 91, 92, 95, 99, 101):
    BEFORE[n] = 'thin'        # served outside, but the boundary wasn't written down
OUTSIDE = {86, 88, 91, 92, 95, 99, 101}
OPEN = {}   # conflict 7 decided (yes: the WGSL-subset translator), built in phase 1
PROCESS = {187}
WHY = {  # one line on what changed, for every need that wasn't covered before
    12: 'exaggeration is a function of the view; `[]` = flat', 13: 'GEBCO / ETOPO seafloor; coast follows the sea level',
    15: 'street detail added only when near', 18: 'small offline Earth pack from a URL', 19: 'package is code only; data apart',
    22: 'looks: biomes, land cover, snow line; follows the lens', 29: 'typology, facades, roofs, night windows',
    30: 'sections, junctions, markings, decks, rail', 31: 'species, growth, season, sway', 40: 'society = human pattern of life (was: census layers)',
    42: 'car following, lane change, signals', 43: 'GTFS transit with dwell', 44: 'counts conserved between tiers',
    46: 'buoyancy and swimming', 58: 'visibility added to light views', 60: 'regimes and rotating frame (Coriolis)',
    62: 'per-field rate; recompute only when inputs change', 63: 'citable constant tables with units and sources',
    75: 'classify / detect on imagery (ONNX in a worker)', 78: 'time zones, deep time, paleo units', 85: 'a second view of the same world',
    89: 'params, readouts, named points as rows', 90: 'strict settle; never a half-loaded frame', 93: 'catalog + level previews',
    94: 'themes: palette, type, easing, glow', 97: 'signals are reactive values', 100: 'hot swap of code in open views',
    103: 'remote log and phone shots', 106: 'seed + fixed steps', 112: 'world to / from JSON', 114: 'catalog of shapes, recipes, presets',
    115: 'hot swap, checked in a worker', 116: 'how the docs are written, on the first page', 118: 'stats per area',
    124: 'terrain `[]` = flat, layers unchanged', 125: 'DTM vs DSM, source per point', 131: 'thumbnail strip, distance slider, budget',
    142: 'splats as an import', 159: 'corrections table at compile and read', 168: 'TAA, reflections, HDRI, sky occlusion, interiors, wet',
    169: 'select / isolate / highlight in `s.user`', 174: 'project, visible, settled, readback, stepping all listed',
    182: 'a synchronous experiment socket', 183: 'the boundaries page', 184: 'the domain rule', 185: 'the promotion rule',
    186: 'the package section', 193: 'core/world/state/states', 194: 'kits › compat › leaflet', 188: 'sea/level, shore', 189: 'gebco, etopo, exposed, look', 190: 'water.flow',
    191: 'time › deep', 192: 'data › history/epochs', 86: 'boundary written', 88: 'boundary written; the legend stays in the kit, names are a layer\'s labels',
    91: 'boundary written', 92: 'boundary written', 95: 'boundary written', 99: 'boundary written', 101: 'boundary written',
}


def rows():
    have = {}
    for root, _, fs in os.walk(os.path.join(DOCS, 'reference')):
        for f in fs:
            if f.endswith('.md') and f != 'README.md':
                p = os.path.relpath(os.path.join(root, f), os.path.join(DOCS, 'reference'))[:-3]
                for l in open(os.path.join(root, f), encoding='utf-8'):
                    if l.startswith('| `'):
                        have.setdefault(p, []).append(l.split(' | ')[0][2:].strip('` '))
    return have


def slug(s):
    return re.sub(r'^-|-$', '', re.sub(r'[^a-z0-9]+', '-', s.lower()))


def links(spec, have, used):
    out = []
    for tok in spec.split():
        k, _, rel = tok.partition(':')
        if k == 'c':
            assert os.path.exists(os.path.join(DOCS, 'concepts', rel + '.md')), tok
            out.append(f'[{rel}](#concepts/{rel})')
        elif k == 'p':
            assert os.path.exists(os.path.join(DOCS, rel + '.md')), tok
            out.append(f'[{rel.split("/")[0]}](#{rel})')
        else:
            page = PAGE[k]
            assert rel in have.get(page, []), f'no row {page} › {rel}'
            used.add((page, rel))
            out.append(f'[{rel}](#reference/{page}~{slug(rel)})')
    return ' · '.join(out)


def needs():
    if not NEEDS or not os.path.exists(NEEDS):
        sys.exit(f'audit.py: no needs list{" at " + NEEDS if NEEDS else ""}. It is a research file kept outside the library: '
                 'set ASLNUT_NEEDS=<path to needs.md> (or --needs=<path>).')
    out, group = [], None
    for l in open(NEEDS, encoding='utf-8'):
        m = re.match(r'### ([A-O])\. (.+)', l)
        if m:
            group = (m[1], GROUP.get(m[1], m[2].strip()))
        m = re.match(r'\| (\d+)( NEW| REV)? \| (.+?) \| (.+?) \| (.+?) \| (.+?) \| (.+?) \|$', l.rstrip())
        if m and group:
            out.append((int(m[1]), group, TEXT.get(int(m[1]), m[3]), m[4]))
    return out


def main():
    have, used = rows(), set()
    N = needs()
    groups = {}
    for n, g, t, p in N:
        groups.setdefault(g, []).append((n, t, p))
    gname = {g[0]: g for g in groups}
    for n, (gk, t, p) in NEW.items():
        groups[gname[gk]].append((n, t, p))
    total = sum(len(v) for v in groups.values())
    assert total == len(M), (total, len(M), set(M) ^ {n for v in groups.values() for n, *_ in v})

    def after(n):
        if n in PROCESS: return 'process'
        if n in OUTSIDE: return 'outside'
        if n in OPEN: return 'open'
        return 'covered'
    cnt_b, cnt_a = {}, {}
    table = []
    for g in sorted(groups):
        table.append(f'\n### {g[0]}. {g[1]}\n')
        table.append('| # | need | used by | → where | status |')
        table.append('|---|---|---|---|---|')
        for n, t, p in sorted(groups[g]):
            b = BEFORE.get(n, 'covered'); a = after(n)
            if n in PROCESS: b = 'process'
            cnt_b[b] = cnt_b.get(b, 0) + 1; cnt_a[a] = cnt_a.get(a, 0) + 1
            where = links(M[n], have, used) or 'a release step, not an interface'
            st = a if b == a else f'{b} → **{a}**'
            if n in WHY: st += f' ({WHY[n]})'
            if n in OPEN: st += f' · decision needed ({OPEN[n]})'
            mark = ' NEW' if n in NEW else ''
            table.append(f'| {n}{mark} | {t} | {p if n in NEW else products(p)} | {where} | {st} |')
    orphans = [(p, r) for p, rs in have.items() for r in rs if (p, r) not in used and (p, r) not in JUSTIFIED]
    return total, cnt_b, cnt_a, table, orphans, have


if __name__ == '__main__':
    total, cb, ca, table, orphans, have = main()
    nrows = sum(len(v) for v in have.values())
    print('needs', total, 'before', cb, 'after', ca, 'rows', nrows, 'orphans', len(orphans))
    for o in orphans:
        print('  orphan', o[0], '›', o[1])
    if '--write' in sys.argv:
        tpl = open(os.path.join(HERE, 'coverage.tpl.md'), encoding='utf-8').read()
        fmt = lambda c: ' · '.join(f'{c.get(k, 0)} {k}' for k in ('covered', 'thin', 'GAP', 'outside', 'open', 'process') if c.get(k))
        key = '\n'.join(f'- **{label}:** {full}' for label, full in KINDS)
        others = list(dict.fromkeys(label for _, label in WORDS if label not in {k for k, _ in KINDS}))
        if others:
            key += '\n- Others as named: ' + ', '.join(others) + '.'
        if not KINDS:
            key = '- (the kinds of use are not listed: no renames file was given)'
        out = (tpl.replace('{{TOTAL}}', str(total)).replace('{{BEFORE}}', fmt(cb)).replace('{{AFTER}}', fmt(ca))
               .replace('{{ROWS}}', str(nrows)).replace('{{ORPHANS}}', str(len(orphans)))
               .replace('{{KEY}}', key).replace('{{TABLE}}', '\n'.join(table)))
        open(os.path.join(DOCS, 'coverage.md'), 'w', encoding='utf-8').write(out)
        print('wrote coverage.md')
