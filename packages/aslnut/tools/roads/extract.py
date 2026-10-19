# The road test places: OpenStreetMap ways (roads, with their tags and node ids) and crossing nodes cut from a
# downloaded extract (BBBike's Melbourne, © OpenStreetMap contributors, ODbL), one small GeoJSON per place; the paths
# (footpaths mapped as their own ways, park paths, crossings, steps) beside it; and where the data has them, the road
# reserves (Vicmap Property road casements, CC BY 4.0 © State of Victoria, already downloaded by the city's data tool).
#   python3 tools/roads/extract.py [extract.pbf]   → data/packs/roads/<place>.geojson, .paths.geojson, .reserve.geojson
import json, os, sys
import osmium

PLACES = {
    # Clayton's suburban grid: local streets, T and X junctions
    'clayton':     [145.108, -37.935, 145.135, -37.913],
    # the Monash Freeway at Warrigal Road: an interchange with overpasses
    'interchange': [145.080, -37.889, 145.103, -37.870],
    # Princes Bridge over the Yarra
    'bridge':      [144.959, -37.825, 144.976, -37.813],
    # the Bolte Bridge and CityLink's elevated approaches
    'elevated':    [144.915, -37.828, 144.942, -37.803],
    # the Burnley Tunnel's eastern portal
    'tunnel':      [144.988, -37.833, 145.012, -37.818],
    # a roundabout (found in the data: see below)
    'roundabout':  None,
    # Princes Highway (Dandenong Road) at Clayton: a divided arterial
    'arterial':    [145.103, -37.912, 145.132, -37.897],
    # the healthy city's street level: the city tiles' area, its tiles the same 500 m squares from the same corner
    'street':      [145.09, -37.95, 145.16, -37.9],
}
ORIGIN = {'street': [145.09, -37.9]}
PATHS = {'footway', 'path', 'pedestrian', 'steps', 'cycleway', 'bridleway'}
PATH_KEEP = ['highway', 'footway', 'name', 'width', 'surface', 'crossing', 'crossing:markings', 'layer', 'bridge', 'tunnel', 'access', 'foot', 'bicycle', 'segregated', 'kerb']
WATERS = {'river', 'canal', 'stream', 'drain'}
WATER_KEEP = ['waterway', 'name', 'width', 'tunnel', 'layer', 'intermittent']
CASEMENTS = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'data', 'raw-city', 'wfs-road_casement_polygon-145.09_-37.95_145.16_-37.9.json')
ROADS = {'motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service',
         'motorway_link', 'trunk_link', 'primary_link', 'secondary_link', 'tertiary_link', 'road'}
KEEP = ['highway', 'name', 'ref', 'lanes', 'lanes:forward', 'lanes:backward', 'width', 'oneway', 'bridge', 'tunnel', 'layer', 'junction',
        'bridge:structure', 'maxspeed', 'sidewalk', 'sidewalk:left', 'sidewalk:right', 'sidewalk:both', 'service', 'turn:lanes', 'surface', 'cutting', 'embankment', 'man_made']
src = sys.argv[1] if len(sys.argv) > 1 else os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'data', 'raw-osm', 'Melbourne.osm.pbf')
out = os.path.join(os.path.dirname(__file__), '..', '..', '..', '..', 'data', 'packs', 'roads')
os.makedirs(out, exist_ok=True)

ways, crossings, rings, paths, waters = [], [], [], [], []
class H(osmium.SimpleHandler):
    def node(self, n):
        t = n.tags
        if t.get('highway') in ('crossing', 'traffic_signals', 'stop', 'give_way', 'mini_roundabout') or t.get('kerb'):
            crossings.append({'id': n.id, 'lon': n.location.lon, 'lat': n.location.lat, 'tags': {k: t[k] for k in ('highway', 'crossing', 'crossing:markings', 'kerb') if k in t}})
    def way(self, w):
        t = w.tags
        if t.get('waterway') in WATERS:
            try: pts = [[n.lon, n.lat] for n in w.nodes]
            except osmium.InvalidLocationError: return
            waters.append({'id': w.id, 'pts': pts, 'tags': {k: t[k] for k in WATER_KEEP if k in t}})
            return
        if t.get('highway') in PATHS and t.get('area') != 'yes':
            try: pts = [[n.lon, n.lat] for n in w.nodes]
            except osmium.InvalidLocationError: return
            paths.append({'id': w.id, 'nodes': [n.ref for n in w.nodes], 'pts': pts, 'tags': {k: t[k] for k in PATH_KEEP if k in t}})
            return
        if t.get('highway') not in ROADS or t.get('area') == 'yes': return
        if t.get('highway') == 'service' and t.get('service') in ('parking_aisle', 'driveway', 'drive-through'): return
        try: pts = [[n.lon, n.lat] for n in w.nodes]
        except osmium.InvalidLocationError: return
        ways.append({'id': w.id, 'nodes': [n.ref for n in w.nodes], 'pts': pts, 'tags': {k: t[k] for k in KEEP if k in t}})
H().apply_file(src, locations=True)
print('roads', len(ways), 'paths', len(paths), 'waters', len(waters), 'nodes of note', len(crossings))
casements = json.load(open(CASEMENTS)) if os.path.exists(CASEMENTS) else []

# a roundabout near Clayton (a closed ring of junction=roundabout, not a big one)
def inside(b, lon, lat): return b[0] <= lon <= b[2] and b[1] <= lat <= b[3]
best = None
for w in ways:
    if w['tags'].get('junction') == 'roundabout' and w['nodes'][0] == w['nodes'][-1]:
        lon = sum(p[0] for p in w['pts']) / len(w['pts']); lat = sum(p[1] for p in w['pts']) / len(w['pts'])
        d = (lon - 145.12) ** 2 + (lat + 37.92) ** 2
        if best is None or d < best[0]: best = (d, lon, lat)
if best:
    _, lon, lat = best
    PLACES['roundabout'] = [lon - 0.006, lat - 0.005, lon + 0.006, lat + 0.005]

for name, b in PLACES.items():
    if not b: print(name, 'none found'); continue
    pad = 0.002  # ways crossing the box whole, so junctions at its edge keep their arms
    fs = []
    for w in ways:
        if not any(inside([b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], p[0], p[1]) for p in w['pts']): continue
        fs.append({'type': 'Feature', 'id': w['id'], 'properties': {**w['tags'], 'osm_id': w['id'], 'nodes': w['nodes']}, 'geometry': {'type': 'LineString', 'coordinates': [[round(x, 7) for x in p] for p in w['pts']]}})
    for c in crossings:
        if inside(b, c['lon'], c['lat']): fs.append({'type': 'Feature', 'id': f"n{c['id']}", 'properties': {**c['tags'], 'osm_node': c['id']}, 'geometry': {'type': 'Point', 'coordinates': [round(c['lon'], 7), round(c['lat'], 7)]}})
    doc = {'type': 'FeatureCollection', 'bbox': b, 'name': name, 'attribution': '© OpenStreetMap contributors (ODbL), via BBBike.org', 'features': fs}
    if name in ORIGIN: doc['origin'] = ORIGIN[name]
    # the paths, and the road reserves (casements touching the box)
    ps = [{'type': 'Feature', 'id': w['id'], 'properties': {**w['tags'], 'osm_id': w['id'], 'nodes': w['nodes']}, 'geometry': {'type': 'LineString', 'coordinates': [[round(x, 7) for x in p] for p in w['pts']]}}
          for w in paths if any(inside([b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], p[0], p[1]) for p in w['pts'])]
    json.dump({'type': 'FeatureCollection', 'bbox': b, 'name': name, 'attribution': '© OpenStreetMap contributors (ODbL), via BBBike.org', 'features': ps}, open(os.path.join(out, f'{name}.paths.geojson'), 'w'))
    ws = [{'type': 'Feature', 'id': w['id'], 'properties': {**w['tags'], 'osm_id': w['id']}, 'geometry': {'type': 'LineString', 'coordinates': [[round(x, 7) for x in p] for p in w['pts']]}}
          for w in waters if any(inside([b[0] - pad, b[1] - pad, b[2] + pad, b[3] + pad], p[0], p[1]) for p in w['pts'])]
    json.dump({'type': 'FeatureCollection', 'bbox': b, 'name': name, 'attribution': '© OpenStreetMap contributors (ODbL), via BBBike.org', 'features': ws}, open(os.path.join(out, f'{name}.water.geojson'), 'w'))
    cs = [c for c in casements if c.get('bbox') and c['bbox'][2] >= b[0] - pad and c['bbox'][0] <= b[2] + pad and c['bbox'][3] >= b[1] - pad and c['bbox'][1] <= b[3] + pad]
    cs = [{'type': 'Feature', 'id': c['id'], 'properties': {k: c['properties'].get(k) for k in ('ufi', 'z_level', 'lga_code', 'locality_name')}, 'geometry': c['geometry']} for c in cs]
    if cs: json.dump({'type': 'FeatureCollection', 'bbox': b, 'name': name, 'attribution': 'Vicmap Property road casements, CC BY 4.0 © State of Victoria', 'features': cs}, open(os.path.join(out, f'{name}.reserve.geojson'), 'w'))
    elif os.path.exists(os.path.join(out, f'{name}.reserve.geojson')): os.remove(os.path.join(out, f'{name}.reserve.geojson'))
    print(name, 'paths', len(ps), 'waters', len(ws), 'sidewalks', sum(1 for f in ps if f['properties'].get('footway') == 'sidewalk'), 'reserves', len(cs))
    p = os.path.join(out, f'{name}.geojson')
    json.dump(doc, open(p, 'w'))
    nb = sum(1 for f in fs if f['properties'].get('bridge')); nt = sum(1 for f in fs if f['properties'].get('tunnel'))
    print(name, b, len(fs), 'features', f'{os.path.getsize(p) / 1e6:.2f} MB', 'bridges', nb, 'tunnels', nt)
