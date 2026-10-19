#!/usr/bin/env python3
"""The aslnut docs tree: one source (spec.txt) → the map page's data (map.json), the full tree in
reference/README.md and each reference page's subtree (between <!-- tree:… --> markers), a check that
every leaf has a row in its page's API table (first cell = the item's path inside the page), and llms.txt (the
authoring guide, the recipes and the API index for assistants: _tree/llms.mjs).
    python3 _tree/gen.py            (from packages/aslnut/docs)"""
import json, os, re, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
DOCS = os.path.dirname(HERE)
ORDER = ['built', 'partly', 'planned', 'proposed', 'open']


def parse():
    root, stack = None, []
    for raw in open(os.path.join(HERE, 'spec.txt'), encoding='utf-8'):
        if not raw.strip() or raw.lstrip().startswith('#'):
            continue
        depth = (len(raw) - len(raw.lstrip(' '))) // 2
        text = raw.strip()
        status = (re.search(r'\[(\w+)\]', text) or [None, None])[1]
        page = (re.search(r'@(\S+)', text) or [None, None])[1]
        name = re.sub(r'\s*(\[\w+\]|@\S+|\+\d+)', '', text).strip()   # '+1 +2': the checkpoints the part is needed for (status.mjs)
        node = {'name': name, 'status': status, 'page': page, 'kids': []}
        while stack and stack[-1][0] >= depth:
            stack.pop()
        if stack:
            stack[-1][1]['kids'].append(node)
        else:
            root = node
        stack.append((depth, node))
    return root


def finish(node, page=None, base=None, parent_path=''):
    """inherit pages, compute group statuses, paths inside the page (relative to the node that starts it)"""
    own = node['page']
    member = bool(own and own.endswith('~'))      # '@page~': listed on that page, not its root
    if member:
        own = own[:-1]
    node['page'] = own or page
    node['path'] = (parent_path + '/' + node['name']).lstrip('/')
    if own and member:
        base = parent_path
        node['page_own'] = False
    elif own:
        base = node['path']
    node['rel'] = '' if node['path'] == base else (node['path'][len(base) + 1:] if base else node['name'])
    for k in node['kids']:
        finish(k, node['page'], base, node['path'])
    if node['kids']:
        ss = {k['status'] for k in node['kids']}
        if node['status']:                       # a group with its own status (e.g. built, before planned kids were added) counts it too
            ss.add(node['status'])
        if ss <= {'built'}:
            node['status'] = 'built'
        elif ss & {'built', 'partly'}:
            node['status'] = 'partly'
        elif ss <= {'proposed'}:
            node['status'] = 'proposed'
        elif ss <= {'open'}:
            node['status'] = 'open'
        else:
            node['status'] = 'planned'


def slug(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def href(node):
    if not node['page']:
        return ''
    if node['rel'] == '':
        return node['page']
    return node['page'] + '~' + slug(node['rel'])


def lines(node, prefix='', last=True, top=True):
    out = []
    label = node['name'] + ('/' if node['kids'] else '')
    if top:
        out.append(label)
    else:
        out.append(prefix + ('└── ' if last else '├── ') + label)
    kids = node['kids']
    for i, k in enumerate(kids):
        sub = prefix if top else prefix + ('    ' if last else '│   ')
        out.extend(lines(k, sub, i == len(kids) - 1, False))
    return out


def walk(node):
    yield node
    for k in node['kids']:
        yield from walk(k)


def to_json(node):
    j = {'n': node['name'], 's': node['status'], 'h': href(node)}
    if node['kids']:
        j['c'] = [to_json(k) for k in node['kids']]
    return j


def inject(path, key, text):
    f = os.path.join(DOCS, path + '.md')
    if not os.path.exists(f):
        return False
    s = open(f, encoding='utf-8').read()
    pat = re.compile(r'(<!-- tree:' + re.escape(key) + r' -->\n)(.*?)(<!-- /tree -->)', re.S)
    if not pat.search(s):
        return False
    s = pat.sub(lambda m: m.group(1) + '```tree\n' + text + '\n```\n' + m.group(3), s)
    open(f, 'w', encoding='utf-8').write(s)
    return True


def table_firsts(path):
    f = os.path.join(DOCS, path + '.md')
    if not os.path.exists(f):
        return set()
    out = set()
    for l in open(f, encoding='utf-8'):
        if l.startswith('|') and not re.match(r'^\|\s*-', l):
            first = l.strip().strip('|').split('|')[0].strip().strip('`')
            out.add(first)
    return out


def main():
    root = parse()
    finish(root)
    # page roots: the node where a page starts (the first node carrying it)
    roots = {}
    for n in walk(root):
        if n['page'] and n['rel'] == '' and n['page'] not in roots:
            roots[n['page']] = n
    # map data
    json.dump({'tree': to_json(root)}, open(os.path.join(DOCS, 'map.json'), 'w', encoding='utf-8'), ensure_ascii=False, indent=1)
    # full tree
    ok = inject('reference/README', 'ALL', '\n'.join(lines(root)))
    print('reference/README', 'tree' if ok else 'NO MARKER')
    for page, n in roots.items():
        ok = inject(page, page, '\n'.join(lines(n)))
        print(page, 'tree' if ok else 'NO MARKER')
    # every leaf has a row
    missing = []
    for page, n in roots.items():
        firsts = table_firsts(page)
        for m in walk(n):
            if m is n or m['page'] != page:
                continue
            if not m['kids'] and m['rel'] not in firsts:
                missing.append(f'{page}: {m["rel"]}')
    counts = {}
    for m in walk(root):
        if not m['kids']:
            counts[m['status']] = counts.get(m['status'], 0) + 1
    print('leaves by status', counts)
    # llms.txt: the guide, the recipes, the imports and the index of what exists (made from the same tree and rows)
    try:
        r = subprocess.run(['node', os.path.join(HERE, 'llms.mjs')], capture_output=True, text=True)
        print(r.stdout.strip() or r.stderr.strip())
    except FileNotFoundError:
        print('llms.txt not made: node not found (node _tree/llms.mjs)')
    if missing:
        print('MISSING ROWS', len(missing))
        for x in missing:
            print('  ', x)
        sys.exit(1)


if __name__ == '__main__':
    main()
