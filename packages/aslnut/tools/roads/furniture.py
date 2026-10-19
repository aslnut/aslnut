# The road test places' street furniture and poles: OpenStreetMap nodes (power poles, street lamps, benches, bins,
# bus stops, post boxes, drinking fountains, picnic tables, barbecues, bicycle parking, bollards, hydrants, phones)
# cut from the downloaded extract (BBBike's Melbourne, © OpenStreetMap contributors, ODbL), one small GeoJSON per
# place beside its roads: the bake's stage 15 places them against the final roads, paths and buildings.
#   python3 tools/roads/furniture.py [extract.pbf]   → data/packs/roads/<place>.furniture.geojson
import json, os, sys
import osmium

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, '..', '..', '..', '..', 'data', 'packs', 'roads')
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, '..', '..', '..', '..', 'data', 'raw-osm', 'Melbourne.osm.pbf')
# the tags kept as furniture (key → values); everything else on a node is not furniture
WANT = {
    'power': {'pole'},
    'highway': {'street_lamp', 'bus_stop'},
    'amenity': {'bench', 'waste_basket', 'bicycle_parking', 'post_box', 'drinking_water', 'bbq', 'telephone', 'vending_machine', 'recycling'},
    'leisure': {'picnic_table'},
    'barrier': {'bollard'},
    'emergency': {'fire_hydrant'},
}
KEEP = ['power', 'highway', 'amenity', 'leisure', 'barrier', 'emergency', 'name', 'operator', 'ref', 'height', 'material', 'backrest', 'shelter', 'bench', 'bin', 'lamp_type', 'colour']
# the places' boxes: those of the road extracts (their .geojson bbox)
places = {}
for f in sorted(os.listdir(OUT)):
    if f.endswith('.geojson') and f.count('.') == 1:
        doc = json.load(open(os.path.join(OUT, f)))
        if doc.get('bbox'): places[f[:-8]] = doc['bbox']
found = {p: [] for p in places}

class Nodes(osmium.SimpleHandler):
    def node(self, n):
        if not n.tags: return
        if not any(n.tags.get(k) in v for k, v in WANT.items()): return
        lon, lat = n.location.lon, n.location.lat
        for p, b in places.items():
            if b[0] <= lon <= b[2] and b[1] <= lat <= b[3]:
                found[p].append({'type': 'Feature', 'id': f'node/{n.id}', 'properties': {k: n.tags.get(k) for k in KEEP if n.tags.get(k)}, 'geometry': {'type': 'Point', 'coordinates': [round(lon, 7), round(lat, 7)]}})

Nodes().apply_file(SRC)
for p, fs in found.items():
    fs.sort(key=lambda f: f['id'])
    json.dump({'type': 'FeatureCollection', 'name': f'{p} street furniture', 'attribution': '© OpenStreetMap contributors (ODbL), via BBBike.org', 'bbox': places[p], 'features': fs}, open(os.path.join(OUT, f'{p}.furniture.geojson'), 'w'))
    print(p, len(fs))
