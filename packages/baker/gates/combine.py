# Measures of a place taken in parts (boxes), as one: counts and lengths added, worst values the worst, lists joined.
#   python3 combine.py out.json part1.json part2.json ...
import json, sys
out, parts = sys.argv[1], [json.load(open(p)) for p in sys.argv[2:]]
def merge(vals, key=''):
    v0 = vals[0]
    if isinstance(v0, dict): return {k: merge([v.get(k) for v in vals if v is not None], k) for k in v0}
    if isinstance(v0, bool) or v0 is None: return v0
    if isinstance(v0, (int, float)):
        if key.startswith('worst') or key.endswith('M') and key.startswith('worst'): return max(vals)
        return round(sum(vals), 2) if isinstance(v0, float) else sum(vals)
    if isinstance(v0, list): return [x for v in vals for x in v][:8]
    return v0
res = merge(parts)
res['pack'] = parts[0]['pack']
json.dump(res, open(out, 'w'))
print('combined', len(parts), 'parts')
