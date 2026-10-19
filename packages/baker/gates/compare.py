# old against new: every measured gate number side by side
import json, sys
o = json.load(open(sys.argv[1])); n = json.load(open(sys.argv[2]))
def flat(d, p=''):
    r = {}
    for k, v in d.items():
        if k in ('worst', 'jogAt', 'foldAt', 'sliverAt', 'thinAt', 'stepAt', 'at', 'box', 'pack'): continue
        if isinstance(v, dict): r.update(flat(v, p + k + '.'))
        else: r[p + k] = v
    return r
fo, fn = flat(o), flat(n)
for k in fn: print(f"{k:42} old {fo.get(k, '-')!s:>10}  new {fn[k]!s:>10}")
