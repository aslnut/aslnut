# The journey example's open data, cut from two downloaded OpenStreetMap extracts (© OpenStreetMap contributors, ODbL):
# BBBike's Melbourne (data/raw-osm/Melbourne.osm.pbf) and Geofabrik's Nusa Tenggara (Bali and the islands east of it:
# data/raw-osm/nusa-tenggara-latest.osm.pbf). Each place is a small GeoJSON in data/raw-journey/ (never in git), the
# inputs tools/journey-data.mjs routes, bakes and packs:
#   <place>.roads.geojson     the drivable ways (their class, one way, name) the car's route is found on
#   <place>.airport.geojson   runways, taxiways, aprons, terminals and the buildings round them (names left out: the
#                             terminals keep their ref, T2)
#   kuta.geojson (+ .paths, .water)   the street place's ways with their tags and node ids, crossing nodes, its paths
#                             and drains: what the road bake reads (as tools/roads/extract.py writes a place)
#   kuta.built.geojson        its buildings (height, levels), trees (natural=tree, tree rows), parks, beaches
#   kuta.ground.{json,f32}    the ground under it: Mapzen's terrain tiles (Terrarium, z15) on a 4 m grid, buildings
#                             taken out (as tools/roads/dem.py samples a place)
#   bali-coast.geojson        the coastline round the airport and Kuta (natural=coastline: the land on its left) and
#                             the beaches
# Names: roads and beaches keep theirs; buildings, shops and the airports' parts never carry one (no business is named).
#   python3 tools/journey/extract.py            (the extracts downloaded first: see the example's notes)
import io, json, math, os, sys, urllib.request
import osmium
import numpy as np
from PIL import Image

DATA = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'data')
RAW, OUT = os.path.join(DATA, 'raw-osm'), os.path.join(DATA, 'raw-journey')
os.makedirs(OUT, exist_ok=True)
MEL, BALI = os.path.join(RAW, 'Melbourne.osm.pbf'), os.path.join(RAW, 'nusa-tenggara-latest.osm.pbf')
# [west, south, east, north]
PLACES = {
    # Melbourne's inner north-west to the airport at Tullamarine: the car drives from the city
    'mel': {'src': MEL, 'roads': [144.83, -37.83, 144.99, -37.645], 'airport': [144.80, -37.705, 144.875, -37.64]},
    # Ngurah Rai to Kuta
    'dps': {'src': BALI, 'roads': [115.150, -8.766, 115.196, -8.700], 'airport': [115.145, -8.761, 115.190, -8.735]},
}
# the street place: Kuta's beach, the beach road and the blocks behind it
STREET = {'name': 'kuta', 'src': BALI, 'bbox': [115.1625, -8.7345, 115.1780, -8.7140]}
COAST = {'name': 'bali-coast', 'src': BALI, 'bbox': [115.10, -8.82, 115.22, -8.64]}
DRIVE = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
         'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'road'}
# what the road bake reads (tools/roads/extract.py keeps the same)
PATHS = {'footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway'}
PATH_KEEP = ['highway', 'footway', 'name', 'width', 'surface', 'crossing', 'crossing:markings', 'layer', 'bridge', 'tunnel', 'access', 'foot', 'bicycle', 'segregated', 'kerb']
WATERS = {'river', 'canal', 'stream', 'drain'}
WATER_KEEP = ['waterway', 'name', 'width', 'tunnel', 'layer', 'intermittent']
KEEP = ['highway', 'name', 'ref', 'lanes', 'lanes:forward', 'lanes:backward', 'width', 'oneway', 'bridge', 'tunnel', 'layer', 'junction',
        'bridge:structure', 'maxspeed', 'sidewalk', 'sidewalk:left', 'sidewalk:right', 'sidewalk:both', 'service', 'turn:lanes', 'surface', 'cutting', 'embankment', 'man_made']
AEROWAYS = {'runway', 'taxiway', 'taxilane', 'apron', 'terminal', 'hangar', 'gate', 'parking_position', 'aerodrome'}
PARKS = {('leisure', 'park'), ('leisure', 'garden'), ('landuse', 'grass'), ('landuse', 'greenery'), ('leisure', 'pitch'), ('natural', 'grassland'), ('landuse', 'meadow'), ('natural', 'scrub')}
ODBL = '© OpenStreetMap contributors (ODbL)'

def inside(b, lon, lat, pad=0.0): return b[0] - pad <= lon <= b[2] + pad and b[1] - pad <= lat <= b[3] + pad
def r7(p): return [round(p[0], 7), round(p[1], 7)]
def collection(name, bbox, features, via): return {'type': 'FeatureCollection', 'name': name, 'bbox': bbox, 'attribution': f'{ODBL}, via {via}', 'features': features}
def height_of(t):
    """a building's height (m) from its tags: height, else its levels × 3.2 (None: not said)"""
    for k in ('height', 'building:height'):
        try: return float(str(t.get(k)).replace('m', '').strip())
        except (TypeError, ValueError): pass
    try: return float(t.get('building:levels')) * 3.2
    except (TypeError, ValueError): return None

class Cut(osmium.SimpleHandler):
    """one pass over an extract: every place's features of it"""
    def __init__(self, src):
        super().__init__()
        self.places = {k: p for k, p in PLACES.items() if p['src'] == src}
        self.street = STREET if STREET['src'] == src else None
        self.coast = COAST if COAST['src'] == src else None
        self.out = {k: {'roads': [], 'airport': []} for k in self.places}
        self.s = {'ways': [], 'crossings': [], 'paths': [], 'waters': [], 'buildings': [], 'trees': [], 'rows': [], 'parks': [], 'beaches': []}
        self.c = {'coast': [], 'beaches': []}
    def node(self, n):
        if not n.location.valid(): return
        t, lon, lat = n.tags, n.location.lon, n.location.lat
        s = self.street
        if not s or not inside(s['bbox'], lon, lat, 0.002): return
        if t.get('highway') in ('crossing', 'traffic_signals', 'stop', 'give_way', 'mini_roundabout') or t.get('kerb'):
            self.s['crossings'].append({'id': n.id, 'lon': lon, 'lat': lat, 'tags': {k: t[k] for k in ('highway', 'crossing', 'crossing:markings', 'kerb') if k in t}})
        if t.get('natural') == 'tree' and inside(s['bbox'], lon, lat):
            self.s['trees'].append({'id': n.id, 'at': [lon, lat], 'tags': {k: t[k] for k in ('height', 'circumference', 'diameter_crown', 'leaf_type', 'genus', 'species') if k in t}})
    def way(self, w):
        t = w.tags
        try: pts = [[n.lon, n.lat] for n in w.nodes]
        except osmium.InvalidLocationError: return
        if not pts: return
        closed = len(pts) > 3 and w.nodes[0].ref == w.nodes[-1].ref
        hw = t.get('highway')
        for k, p in self.places.items():
            o = self.out[k]
            if hw in DRIVE and t.get('area') != 'yes' and any(inside(p['roads'], *q) for q in pts):
                if not (hw == 'service' and t.get('service') in ('parking_aisle', 'driveway', 'drive-through')):
                    o['roads'].append({'type': 'Feature', 'id': w.id, 'properties': {kk: t[kk] for kk in ('highway', 'oneway', 'junction', 'name', 'ref', 'lanes', 'maxspeed') if kk in t}, 'geometry': {'type': 'LineString', 'coordinates': [r7(q) for q in pts]}})
            a = t.get('aeroway')
            if (a in AEROWAYS or ('building' in t and not a)) and any(inside(p['airport'], *q) for q in pts):
                props = {'aeroway': a} if a else {'building': t.get('building')}
                if a in ('terminal', 'runway', 'taxiway', 'taxilane', 'gate', 'parking_position') and 'ref' in t: props['ref'] = t['ref']
                h = height_of(t)
                if h: props['height'] = h
                if a in ('runway', 'taxiway', 'taxilane') and 'width' in t: props['width'] = t['width']
                line = a in ('runway', 'taxiway', 'taxilane', 'parking_position') and not (a == 'runway' and closed and t.get('area') == 'yes')
                geom = {'type': 'LineString', 'coordinates': [r7(q) for q in pts]} if line or not closed else {'type': 'Polygon', 'coordinates': [[r7(q) for q in pts]]}
                o['airport'].append({'type': 'Feature', 'id': w.id, 'properties': props, 'geometry': geom})
        s = self.street
        if s and any(inside(s['bbox'], *q, 0.002) for q in pts):
            if t.get('waterway') in WATERS:
                self.s['waters'].append({'id': w.id, 'pts': pts, 'tags': {k: t[k] for k in WATER_KEEP if k in t}})
            elif hw in PATHS and t.get('area') != 'yes':
                self.s['paths'].append({'id': w.id, 'nodes': [n.ref for n in w.nodes], 'pts': pts, 'tags': {k: t[k] for k in PATH_KEEP if k in t}})
            elif hw in DRIVE and t.get('area') != 'yes' and not (hw == 'service' and t.get('service') in ('parking_aisle', 'driveway', 'drive-through')):
                self.s['ways'].append({'id': w.id, 'nodes': [n.ref for n in w.nodes], 'pts': pts, 'tags': {k: t[k] for k in KEEP if k in t}})
            if 'building' in t and closed and t.get('building') not in ('no', 'roof') and any(inside(s['bbox'], *q) for q in pts):
                self.s['buildings'].append({'id': w.id, 'ring': pts, 'height': height_of(t), 'levels': t.get('building:levels'), 'kind': t.get('building')})
            if t.get('natural') == 'tree_row' and not closed:
                self.s['rows'].append({'id': w.id, 'pts': pts})
            if closed and any(t.get(k) == v for k, v in PARKS):
                self.s['parks'].append({'id': w.id, 'ring': pts, 'kind': next(f'{k}={v}' for k, v in PARKS if t.get(k) == v)})
            if closed and t.get('natural') == 'beach':
                self.s['beaches'].append({'id': w.id, 'ring': pts, 'name': t.get('name')})
        c = self.coast
        if c and any(inside(c['bbox'], *q) for q in pts):
            if t.get('natural') == 'coastline':
                self.c['coast'].append({'type': 'Feature', 'id': w.id, 'properties': {'natural': 'coastline'}, 'geometry': {'type': 'LineString', 'coordinates': [r7(q) for q in pts]}})
            elif t.get('natural') == 'beach' and closed:
                self.c['beaches'].append({'type': 'Feature', 'id': w.id, 'properties': {'natural': 'beach', **({'name': t['name']} if 'name' in t else {})}, 'geometry': {'type': 'Polygon', 'coordinates': [[r7(q) for q in pts]]}})

    def area(self, a):
        if a.from_way(): return
        t = a.tags; ae = t.get('aeroway')
        if ae not in AEROWAYS and 'building' not in t: return
        polys = []
        for outer in a.outer_rings():
            ring = [[n.lon, n.lat] for n in outer]
            holes = [[[n.lon, n.lat] for n in inner] for inner in a.inner_rings(outer)]
            polys.append([[r7(q) for q in ring]] + [[r7(q) for q in h] for h in holes])
        if not polys: return
        for k, p in self.places.items():
            if not any(inside(p['airport'], *q) for poly in polys for q in poly[0]): continue
            props = {'aeroway': ae} if ae else {'building': t.get('building')}
            if ae == 'terminal' and 'ref' in t: props['ref'] = t['ref']
            h = height_of(t)
            if h: props['height'] = h
            self.out[k]['airport'].append({'type': 'Feature', 'id': f'r{a.orig_id()}', 'properties': props, 'geometry': {'type': 'MultiPolygon', 'coordinates': polys}})

def write(name, doc):
    f = os.path.join(OUT, name); json.dump(doc, open(f, 'w')); print(f'  {name}: {len(doc["features"])} features, {os.path.getsize(f) / 1e6:.2f} MB')

# ── the ground under the street place (as tools/roads/dem.py samples one) ──
RAWDEM = os.path.join(DATA, 'raw-dem'); os.makedirs(RAWDEM, exist_ok=True)
Z, STEP, PAD = 15, 4.0, 0.004
cache = {}
def tile(x, y):
    f = os.path.join(RAWDEM, f'{Z}_{x}_{y}.png')
    if not os.path.exists(f):
        with urllib.request.urlopen(f'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{Z}/{x}/{y}.png', timeout=60) as r: open(f, 'wb').write(r.read())
    a = np.asarray(Image.open(f).convert('RGB'), dtype=np.float64)
    return a[:, :, 0] * 256 + a[:, :, 1] + a[:, :, 2] / 256 - 32768
def dem_at(lon, lat):
    n = 2 ** Z; fx = (lon + 180) / 360 * n; fy = (1 - math.log(math.tan(math.pi / 4 + math.radians(lat) / 2)) / math.pi) / 2 * n
    tx, ty = int(fx), int(fy); px, py = (fx - tx) * 256 - 0.5, (fy - ty) * 256 - 0.5
    def at(i, j):
        X, Y = tx, ty
        if i < 0: X -= 1; i += 256
        if i > 255: X += 1; i -= 256
        if j < 0: Y -= 1; j += 256
        if j > 255: Y += 1; j -= 256
        if (X, Y) not in cache: cache[(X, Y)] = tile(X, Y)
        return cache[(X, Y)][j, i]
    i0, j0 = math.floor(px), math.floor(py); u, v = px - i0, py - j0
    return (at(i0, j0) * (1 - u) + at(i0 + 1, j0) * u) * (1 - v) + (at(i0, j0 + 1) * (1 - u) + at(i0 + 1, j0 + 1) * u) * v
def ground(name, b):
    lon0, lat0 = (b[0] + b[2]) / 2, (b[1] + b[3]) / 2
    kx, kz = 111320 * math.cos(math.radians(lat0)), 110574
    x0, x1 = (b[0] - PAD - lon0) * kx, (b[2] + PAD - lon0) * kx
    z0, z1 = -(b[3] + PAD - lat0) * kz, -(b[1] - PAD - lat0) * kz
    nx, nz = int((x1 - x0) / STEP) + 1, int((z1 - z0) / STEP) + 1
    g = np.array([[dem_at(lon0 + (x0 + i * STEP) / kx, lat0 - (z0 + j * STEP) / kz) for i in range(nx)] for j in range(nz)], dtype=np.float32)
    from numpy.lib.stride_tricks import sliding_window_view as sw
    pad = np.pad(g, 2, mode='edge'); med = np.median(sw(pad, (5, 5)), axis=(2, 3)).astype(np.float32)
    bad = np.abs(g - med) > 6; g[bad] = med[bad]; g = np.clip(g, -30, 400)
    def filt(a, k, f):
        p = np.pad(a, ((0, 0), (k // 2, k // 2)), mode='edge'); a = f(sw(p, k, axis=1), axis=2)
        p = np.pad(a, ((k // 2, k // 2), (0, 0)), mode='edge'); return f(sw(p, k, axis=0), axis=2)
    g = filt(filt(g, 25, np.min), 25, np.max).astype(np.float32)
    g = filt(g, 5, np.mean).astype(np.float32)
    g.tofile(os.path.join(OUT, f'{name}.ground.f32'))
    json.dump({'origin': {'lon': lon0, 'lat': lat0}, 'cols': nx, 'rows': nz, 'west_e': x0 - STEP / 2, 'north_n': -z0 + STEP / 2, 'cell': STEP,
               'x0': x0, 'z0': z0, 'step': STEP, 'nx': nx, 'nz': nz, 'zoom': Z,
               'source': 'Mapzen terrain tiles (Terrarium), AWS Open Data: SRTM, GMTED2010, ETOPO1, GEBCO and others; buildings taken out (a 100 m grey opening)'}, open(os.path.join(OUT, f'{name}.ground.json'), 'w'))
    print(f'  {name}.ground: {nx} × {nz}, {g.min():.1f}..{g.max():.1f} m')

for src, via in ((MEL, 'BBBike.org'), (BALI, 'Geofabrik')):
    if not os.path.exists(src): sys.exit(f'no extract at {src}: download it first')
    h = Cut(src); h.apply_file(src, locations=True)
    print(os.path.basename(src))
    for k, o in h.out.items():
        write(f'{k}.roads.geojson', collection(f'{k} roads', h.places[k]['roads'], o['roads'], via))
        write(f'{k}.airport.geojson', collection(f'{k} airport', h.places[k]['airport'], o['airport'], via))
    if h.street:
        s, b, n = h.s, h.street['bbox'], h.street['name']
        fs = [{'type': 'Feature', 'id': w['id'], 'properties': {**w['tags'], 'osm_id': w['id'], 'nodes': w['nodes']}, 'geometry': {'type': 'LineString', 'coordinates': [r7(p) for p in w['pts']]}} for w in s['ways']]
        fs += [{'type': 'Feature', 'id': f"n{c['id']}", 'properties': {**c['tags'], 'osm_node': c['id']}, 'geometry': {'type': 'Point', 'coordinates': r7([c['lon'], c['lat']])}} for c in s['crossings'] if inside(b, c['lon'], c['lat'])]
        write(f'{n}.geojson', collection(n, b, fs, via))
        write(f'{n}.paths.geojson', collection(n, b, [{'type': 'Feature', 'id': w['id'], 'properties': {**w['tags'], 'osm_id': w['id'], 'nodes': w['nodes']}, 'geometry': {'type': 'LineString', 'coordinates': [r7(p) for p in w['pts']]}} for w in s['paths']], via))
        write(f'{n}.water.geojson', collection(n, b, [{'type': 'Feature', 'id': w['id'], 'properties': {**w['tags'], 'osm_id': w['id']}, 'geometry': {'type': 'LineString', 'coordinates': [r7(p) for p in w['pts']]}} for w in s['waters']], via))
        built = [{'type': 'Feature', 'id': f"b{x['id']}", 'properties': {'kind': 'building', 'building': x['kind'], **({'height': x['height']} if x['height'] else {}), **({'building:levels': x['levels']} if x['levels'] else {})}, 'geometry': {'type': 'Polygon', 'coordinates': [[r7(p) for p in x['ring']]]}} for x in s['buildings']]
        built += [{'type': 'Feature', 'id': f"t{x['id']}", 'properties': {'kind': 'tree', **x['tags']}, 'geometry': {'type': 'Point', 'coordinates': r7(x['at'])}} for x in s['trees']]
        built += [{'type': 'Feature', 'id': f"r{x['id']}", 'properties': {'kind': 'tree_row'}, 'geometry': {'type': 'LineString', 'coordinates': [r7(p) for p in x['pts']]}} for x in s['rows']]
        built += [{'type': 'Feature', 'id': f"p{x['id']}", 'properties': {'kind': 'park', 'group': x['kind']}, 'geometry': {'type': 'Polygon', 'coordinates': [[r7(p) for p in x['ring']]]}} for x in s['parks']]
        built += [{'type': 'Feature', 'id': f"s{x['id']}", 'properties': {'kind': 'beach', **({'name': x['name']} if x['name'] else {})}, 'geometry': {'type': 'Polygon', 'coordinates': [[r7(p) for p in x['ring']]]}} for x in s['beaches']]
        write(f'{n}.built.geojson', collection(f'{n} built', b, built, via))
        ground(n, b)
    if h.coast:
        write(f"{h.coast['name']}.geojson", collection(h.coast['name'], h.coast['bbox'], h.c['coast'] + h.c['beaches'], via))
