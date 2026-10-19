# The gates, old pack against new, as a markdown table: python3 table.py <place> <old.json> <new.json> [...]
import json, sys

ROWS = [
    ('B', 'islands and medians rising > 10 cm over their kerb tops (pieces)', lambda g: g['B']['over10cm']),
    ('B', '... > 30 cm (pieces)', lambda g: g['B']['over30cm']),
    ('B', 'verge pieces between kerbs, measured', lambda g: g['B']['islandsAndMedians']),
    ('C', 'kerb jogs', lambda g: g['C']['jogs']),
    ('C', 'kerb folds (top turned over)', lambda g: g['C']['folds']),
    ('C', 'kerb spikes', lambda g: g['C']['spikes']),
    ('D', 'bare strip between kerb and verge (m of kerb)', lambda g: g['D']['sliverAlongKerbM']),
    ('D', 'holes in the verge along the kerb (m of kerb)', lambda g: g['D']['holesAlongKerbM']),
    ('D', 'footpath bits under 25 m2', lambda g: g['D']['footpathBitsUnder25m2']),
    ('E', 'footpath under 1 m wide (m of kerb)', lambda g: g['E']['footpathUnder1mAlongKerbM']),
    ('F', 'footpath facets steeper than 1:4 (as drawn)', lambda g: g['F']['steeperThan1in4']),
    ('F', 'property line > 0.5 m over the ground (m)', lambda g: g['F']['wallOver50cmM']),
    ('F', 'property line > 0.15 m over the ground (m)', lambda g: g['F']['wallOver15cmM']),
    ('F', 'ground over the verge (m of kerb)', lambda g: g['groundOverVerge']['alongKerbM']),
    ('G', 'carriageway seams with a step > 1 cm (m)', lambda g: g['G']['stepOver1cmM']),
    ('G', 'carriageway seams with a gap > 2 mm (m)', lambda g: g['G']['gapOver2mmM']),
    ('G', 'worst step (m)', lambda g: g['G']['worstStepM']),
    ('H', 'dashes across another road (pieces)', lambda g: g['H']['dashesAcrossAnotherRoad']),
    ('H', '... in how many junctions', lambda g: g['H']['junctions']),
    ('I', 'zebras without a ramp at each end', lambda g: g['I']['withoutRampAtEachEnd']),
    ('I', 'zebras', lambda g: g['I']['zebras']),
    ('', 'kerb measured (km)', lambda g: g['D']['kerbKm']),
    ('', 'property line measured (km)', lambda g: g['F']['propertyLineKm']),
]
args = sys.argv[1:]
places = [(args[i], json.load(open(args[i + 1])), json.load(open(args[i + 2]))) for i in range(0, len(args), 3)]
head = '| group | measure | ' + ' | '.join(f'{p} old | {p} new' for p, _, _ in places) + ' |'
print(head)
print('|' + '---|' * (2 + 2 * len(places)))
for g, name, f in ROWS:
    cells = []
    for _, o, n in places:
        for x in (o, n):
            try: v = f(x)
            except Exception: v = '-'
            cells.append(f'{v:,}' if isinstance(v, int) else (f'{v:,.2f}' if isinstance(v, float) else str(v)))
    print(f'| {g} | {name} | ' + ' | '.join(cells) + ' |')
