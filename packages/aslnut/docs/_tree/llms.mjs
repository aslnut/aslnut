#!/usr/bin/env node
// llms.txt: what an assistant reads to author an aslnut world, made from the sources so it never drifts:
//   1. the authoring guide (docs/authoring.md, written by hand)
//   2. the recipes (examples/recipes/*.ts: complete scripts, type-checked and rendered on WebGPU and WebGL2 by
//      tools/smoke-recipes.mjs), each with its "what it shows"
//   3. the imports: every name the package exports, from its entry files (src/index.ts and its subpaths)
//   4. the API index: every part of the one tree (spec.txt) that exists (built, partly), by its id, with its reference
//      row's signature, params, returns and example; the planned parts named only (they do not exist yet)
// gen.py runs it after the tree; test/llms.test.ts fails when docs/llms.txt is not what this makes. The examples'
// build serves it at the site's root (vite.config.ts).
//   node packages/aslnut/docs/_tree/llms.mjs           write docs/llms.txt
//   node packages/aslnut/docs/_tree/llms.mjs --check   exit 1 when docs/llms.txt is stale
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const DOCS = join(HERE, '..'), PKG = join(DOCS, '..');
export const OUT = join(DOCS, 'llms.txt');
const RECIPES = ['gis-view', 'district-twin', 'fleet', 'analysis', 'own-kind', 'own-thing'];

// ── the tree: names, statuses, pages (as gen.py reads it) ──
function tree() {
  const root = { name: 'aslnut', status: null, page: null, kids: [] }, stack = [[0, root]];
  for (const raw of readFileSync(join(HERE, 'spec.txt'), 'utf8').split('\n')) {
    if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
    const depth = (raw.length - raw.trimStart().length) / 2, text = raw.trim();
    if (depth === 0) continue;
    const node = { name: text.replace(/\s*(\[\w+\]|@\S+|\+\d+)/g, '').trim(), status: (text.match(/\[(\w+)\]/) || [])[1] ?? null, page: (text.match(/@(\S+)/) || [])[1] ?? null, kids: [] };
    while (stack.at(-1)[0] >= depth) stack.pop();
    stack.at(-1)[1].kids.push(node); stack.push([depth, node]);
  }
  // pages inherited, each node's path, its path inside its page (relative to the node that starts the page)
  const finish = (n, page, base, parent) => {
    let own = n.page; const member = own?.endsWith('~'); if (member) own = own.slice(0, -1);
    n.page = own ?? page; n.path = parent ? `${parent}/${n.name}` : n.name;
    if (own && member) base = parent; else if (own) base = n.path;
    n.rel = n.path === base ? '' : base ? n.path.slice(base.length + 1) : n.name;
    n.id = n.path.replace(/^aslnut\/?/, '').replace(/\//g, '.');
    for (const k of n.kids) finish(k, n.page, base, n.path);
  };
  finish(root, null, null, '');
  return root;
}
const walk = function* (n) { yield n; for (const k of n.kids) yield* walk(k); };

// ── the reference rows: | `path` | signature | params | returns | status | example | ──
const cells = (line) => line.trim().replace(/^\||\|$/g, '').split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
function rows(page) {
  const f = join(DOCS, `${page}.md`); if (!existsSync(f)) return [];
  return readFileSync(f, 'utf8').split('\n').filter((l) => l.startsWith('| `')).map(cells).filter((c) => c.length === 6)
    .map(([item, sig, params, ret, status, ex]) => ({ path: item.replace(/`/g, ''), sig, params, ret, status, ex }));
}

/** a long list as indented lines of about 120 characters (every line readable whole) */
const wrap = (items) => {
  const out = []; let line = '';
  for (const x of items) { if (line && line.length + x.length > 118) { out.push(`  ${line},`); line = ''; } line += line ? `, ${x}` : x; }
  if (line) out.push(`  ${line}`);
  return out.join('\n');
};
// ── the imports: names exported from an entry file, following `export * from` ──
function exportsOf(file, seen = new Set()) {
  const out = { values: new Set(), types: new Set() };
  if (seen.has(file) || !existsSync(file)) return out;
  seen.add(file);
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const add = (o) => { for (const v of o.values) out.values.add(v); for (const t of o.types) out.types.add(t); };
  for (const m of src.matchAll(/export\s+\*\s+from\s+'([^']+)'/g)) add(exportsOf(resolve(dirname(file), m[1]), seen));
  for (const m of src.matchAll(/export\s+\*\s+as\s+(\w+)\s+from/g)) out.values.add(m[1]);
  for (const m of src.matchAll(/export\s+(type\s+)?\{([^}]*)\}/g)) for (const spec of m[2].split(',').map((x) => x.trim()).filter(Boolean)) {
    const type = !!m[1] || spec.startsWith('type '), name = spec.replace(/^type\s+/, '').split(/\s+as\s+/).at(-1).trim();
    if (name && name !== 'default') (type ? out.types : out.values).add(name);
  }
  for (const m of src.matchAll(/export\s+(?:declare\s+)?(?:async\s+)?(function\*?|const|let|class|enum)\s+(\w+)/g)) out.values.add(m[2]);
  for (const m of src.matchAll(/export\s+(?:declare\s+)?(interface|type)\s+(\w+)/g)) out.types.add(m[2]);
  return out;
}
/** the file that defines an exported value, following `export { a as b } from` and `export * from` (null: not found) */
function origin(file, name, seen = new Set()) {
  if (seen.has(file) || !existsSync(file)) return null;
  seen.add(file);
  const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  if (new RegExp(`export\\s+(?:declare\\s+)?(?:async\\s+)?(?:function\\*?|const|let|class|enum)\\s+${name}\\b`).test(src)) return file;
  for (const m of src.matchAll(/export\s+\{([^}]*)\}\s*from\s*'([^']+)'/g)) for (const spec of m[1].split(',').map((x) => x.trim().replace(/^type\s+/, ''))) {
    const [from, as = from] = spec.split(/\s+as\s+/).map((x) => x.trim());
    if (as === name) return origin(resolve(dirname(file), m[2]), from, seen);
  }
  for (const m of src.matchAll(/export\s+\*\s+from\s+'([^']+)'/g)) { const f = origin(resolve(dirname(file), m[1]), name, seen); if (f) return f; }
  return null;
}
function imports() {
  const pkg = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8')), srcOf = (d) => join(PKG, d.default.replace(/^\.\/dist\//, 'src/').replace(/\.js$/, '.ts'));
  const main = exportsOf(srcOf(pkg.exports['.'])), lines = [];
  const list = (s) => wrap([...s].sort((a, b) => a.localeCompare(b)));
  lines.push(`from 'aslnut':\n${list(main.values)}`, '', `types from 'aslnut' (import type { … }):\n${list(main.types)}`);
  // the subpaths that bring names the main entry has not (the ready-made people, vehicles, drones; the tools), or a
  // name of their own that the main entry has for something else (aslnut/react's World: the component)
  for (const [sub, d] of Object.entries(pkg.exports)) {
    if (sub === '.' || typeof d !== 'object' || !d.default) continue;
    const e = exportsOf(srcOf(d)), extra = [...e.values].filter((v) => !main.values.has(v) || origin(srcOf(d), v) !== origin(srcOf(pkg.exports['.']), v));
    if (extra.length) lines.push('', `from 'aslnut${sub.slice(1)}':\n${list(new Set(extra))}`);
  }
  return lines.join('\n');
}

// ── the API index ──
const BUILT = new Set(['built', 'partly']);
/** a long note cut at a boundary near n characters (its code spans closed): the reference page has the rest */
const clip = (s, n) => {
  if (s.length <= n) return s;
  let c = s.slice(0, n); const at = Math.max(c.lastIndexOf(' · '), c.lastIndexOf('; '), c.lastIndexOf(', ')); if (at > n / 2) c = c.slice(0, at);
  if ((c.match(/`/g) ?? []).length % 2) c += '`';
  return `${c} …`;
};
function index() {
  const root = tree(), roots = new Map();
  for (const n of walk(root)) if (n.page && n.rel === '' && !roots.has(n.page)) roots.set(n.page, n);
  const out = [];
  for (const [page, top] of roots) {
    const leaves = new Map(); for (const n of walk(top)) if (n.page === page && !n.kids.length) leaves.set(n.rel, n);
    const own = rows(page), shown = [], planned = [];
    for (const r of own) {
      const leaf = leaves.get(r.path), status = leaf?.status ?? (r.status.match(/\[(\w+)\]/) || [])[1] ?? 'open';
      const id = `${top.id}${r.path ? `.${r.path.replace(/\//g, '.')}` : ''}`;
      if (!BUILT.has(status)) { planned.push(id); continue; }
      const note = status === 'partly' ? clip(r.status.replace(/^\[partly\]\s*/, '').replace(/^\((.*)\)$/, '$1'), 360) : '';
      shown.push([`- ${id} [${status}]: ${r.sig}`, r.params && r.params !== '—' ? `  params: ${r.params}` : '', r.ret && r.ret !== '—' ? `  returns: ${clip(r.ret, 360)}` : '',
        note ? `  what is there: ${note}` : '', r.ex && r.ex !== '—' ? `  e.g. ${r.ex}` : ''].filter(Boolean).join('\n'));
    }
    // a leaf with no row of its own (a gap gen.py reports) is still named
    for (const [rel, n] of leaves) if (!own.some((r) => r.path === rel) && !BUILT.has(n.status)) planned.push(n.id);
    if (!shown.length && !planned.length) continue;
    out.push(`### ${top.id} (${page.replace(/^reference\//, 'docs/reference/')}.md)`, '', ...shown);
    if (planned.length) out.push('', `not there yet (planned, proposed or open; do not use):\n${wrap(planned)}`);
    out.push('');
  }
  return out.join('\n');
}

// ── the recipes: each file's opening comment (what it shows) and its code ──
function recipes() {
  const dir = join(PKG, 'examples/recipes'), have = new Set(readdirSync(dir));
  return RECIPES.filter((r) => have.has(`${r}.ts`)).map((r) => {
    const src = readFileSync(join(dir, `${r}.ts`), 'utf8'), head = src.match(/^(\/\/.*\n)+/)?.[0] ?? '';
    const shows = head.split('\n').map((l) => l.replace(/^\/\/\s?/, '')).join(' ').replace(/\s+/g, ' ').trim();
    return `### ${r}\n\n${shows}\n\n\`\`\`ts\n${src.slice(head.length).trim()}\n\`\`\``;
  }).join('\n\n');
}

// ── the kinds: what every design of each carries (read from the package itself, so it never drifts) ──
async function kindsOf() {
  const { kinds } = await import(pathToFileURL(join(PKG, 'src/index.ts')).href);
  const where = (w) => (!w ? '' : `, ${(Array.isArray(w) ? w : [w]).join(' + ')}`);
  return ['house', 'office', 'charger', 'vehicle'].map((name) => {
    const k = kinds[name], lines = [`- ${name} (${k.about}): \`kinds.${name}\``];
    for (const [n, t] of Object.entries(k.traits)) {
      const what = t.anchors ? `anchors of kind '${t.anchors}', ${t.per ? `one per ${t.per}` : `at least ${t.min ?? 1}`}${t.max ? `, at most ${t.max}` : ''}${where(t.where)}`
        : t.parts ? `parts named '${t.parts}…', at least ${t.min ?? 1}` : t.measure ? `measured: its ${t.measure}` : t.param ? `the param '${t.param}'${t.guess ? ' (guessed from a model)' : ''}` : t.data ? `each thing's data '${t.data}' (default ${t.def})` : '';
      lines.push(`  - ${n}: ${what}${t.optional ? ' (optional)' : ''}; ${t.about}`);
    }
    return lines.join('\n');
  }).join('\n');
}

export async function build() {
  const guide = readFileSync(join(DOCS, 'authoring.md'), 'utf8').replace(/^# .*\n+/, '').trim()
    .replace(/\]\(\.\.\/examples\/recipes\)/g, '](#recipes)').replace(/\]\(llms\.txt\)/g, '](#api-index)');
  return `# aslnut

> aslnut is a TypeScript library that makes and runs worlds in the browser on WebGPU and WebGL2: the Earth (or a flat floor) with imagery and terrain, your data drawn as layers, roads, buildings and trees, moving fleets, and things of your own (levels, moving parts, copies over time, clones that each look different). This file is everything an assistant needs to write one: the authoring guide, six complete recipes, every import, and an index of every part that exists.

Generated by docs/_tree/llms.mjs from docs/authoring.md, examples/recipes, the package's entry files, docs/reference and the tree (docs/_tree/spec.txt). Do not edit it: edit those.

## The authoring guide

${guide}

## Recipes

Each one is a complete script for a page with a <canvas>; checked on WebGPU and WebGL2 (tools/smoke-recipes.mjs).

${recipes()}

## Kinds

What every design of a kind carries: a shape says its kind (\`shape({ kind: kinds.office, build })\`), a model is given one (\`shapes.import(url, { kind, anchors })\`). Anchors are in the shape's frame: metres, its foot at y 0, its front +z; 'ground' is at y 0, 'front' in its front half, 'outside' beyond the walls' footprint, 'up' above the ground. The footprint is the box of the shape's group named 'walls' when it has one (\`b.group('walls', …)\`), else of all that stands over 0.3 m: draw the building only, and place what stands at an anchor (a charger, a car) as its own entity, or name the walls, or a post in the car park puts the bays inside the footprint. \`shape.check({ kind })\` builds the shape at its defaults and at every param's ends (each min and max) and every choice: the traits must hold at all of them (enough bays at the smallest width). Your own kind: \`kind({ name, traits })\`.

${await kindsOf()}

## Imports

${imports()}

## API index

Every part of aslnut that exists (built: in the package and tested on WebGPU and WebGL2; partly: some of it, said what), by its id in the one tree, with its signature, params (type = default), returns and an example. Parts not there yet are named only: do not use them.

${index()}`.replace(/[ \t]+$/gm, '') + '\n';
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = await build();
  if (process.argv.includes('--check')) {
    const now = existsSync(OUT) ? readFileSync(OUT, 'utf8') : '';
    if (now !== text) { console.log('docs/llms.txt is stale: node packages/aslnut/docs/_tree/llms.mjs'); process.exit(1); }
    console.log('docs/llms.txt is current');
  } else { writeFileSync(OUT, text); console.log(`docs/llms.txt · ${(text.length / 1024).toFixed(0)} KB · ${text.split('\n').length} lines`); }
}
