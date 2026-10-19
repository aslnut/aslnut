#!/usr/bin/env node
// The one tree's status view: reads spec.txt (the single source of every part of aslnut and its status) and writes
// STATUS.md at the repo root: each checkpoint's % (the parts it needs, tagged '+N' in spec.txt; a tag on a group covers
// every leaf under it) with its parts as a tree, then the whole tree 4 levels deep, each group with % done
// (built = 1, partly = ½) and counts, each leaf with its status, plus every part's id (a.b.c.d) for reports.
//   node packages/aslnut/docs/_tree/status.mjs          (from the repo root; run after every status change)
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../..');
const DEPTH = 4;

const root = { name: 'aslnut', status: '', tags: [], kids: [] };
const checkpoints = [];                                  // '# checkpoint N: title' lines in spec.txt
const stack = [[-1, root]];
for (const raw of readFileSync(join(HERE, 'spec.txt'), 'utf8').split('\n')) {
  const cp = raw.match(/^#\s*checkpoint\s+(\d+):\s*(.+)$/);
  if (cp) { checkpoints.push({ n: cp[1], title: cp[2].trim() }); continue; }
  if (!raw.trim() || raw.trimStart().startsWith('#')) continue;
  const depth = (raw.length - raw.trimStart().length) / 2;
  const text = raw.trim();
  const node = {
    name: text.replace(/\s*(\[\w+\]|@\S+|\+\d+)/g, '').trim(),
    status: (text.match(/\[(\w+)\]/) || [])[1] || '',
    tags: [...text.matchAll(/\+(\d+)/g)].map((m) => m[1]),
    kids: [],
  };
  if (depth === 0) { root.status = node.status; continue; }   // the spec's own root line is "aslnut"
  while (stack.at(-1)[0] >= depth) stack.pop();
  const parent = stack.at(-1)[1];
  node.tags = [...new Set([...parent.tags, ...node.tags])];   // a group's tag covers its leaves
  parent.kids.push(node);
  stack.push([depth, node]);
}

const leaves = (n) => (n.kids.length ? n.kids.flatMap(leaves) : [n]);
const pct = (l) => {
  const b = l.filter((x) => x.status === 'built').length, p = l.filter((x) => x.status === 'partly').length;
  return `${Math.round(((b + p / 2) / (l.length || 1)) * 100)}% (${b} built, ${p} partly / ${l.length})`;
};
const label = (n, keep = () => true) => (n.kids.length ? pct(leaves(n).filter(keep)) : n.status);

const draw = (top, keep, depth) => {
  const out = [];
  const walk = (n, pre, last, d) => {
    out.push((d ? pre + (last ? '└── ' : '├── ') : '') + n.name + '  ' + label(n, keep));
    if (d >= depth) return;
    const kids = n.kids.filter((k) => leaves(k).some(keep));
    kids.forEach((k, i) => walk(k, d ? pre + (last ? '    ' : '│   ') : '', i === kids.length - 1, d + 1));
  };
  walk(top, '', true, 0);
  return out.join('\n');
};

const ids = [];
const list = (n, path) => {
  for (const k of n.kids) {
    const id = path ? `${path}.${k.name}` : k.name;
    const cps = [...new Set(leaves(k).flatMap((x) => x.tags))].sort();
    ids.push(`| \`${id}\` | ${label(k)} | ${cps.join(' ')} |`);
    list(k, id);
  }
};
list(root, '');

const all = leaves(root);
const count = (s) => all.filter((x) => x.status === s).length;
const cpLines = checkpoints.map((c) => `- **Checkpoint ${c.n} · ${c.title}: ${pct(all.filter((x) => x.tags.includes(c.n)))}**`).join('\n');
const cpTrees = checkpoints.map((c) => `### Checkpoint ${c.n} · ${c.title}

Only the parts this checkpoint needs, to the leaves.

\`\`\`
${draw(root, (x) => x.tags.includes(c.n), 99)}
\`\`\``).join('\n\n');

writeFileSync(join(ROOT, 'STATUS.md'), `# aslnut: the one tree and its status

> **Generated. Do not edit by hand.** The single source is \`packages/aslnut/docs/_tree/spec.txt\`.
> After any status change: edit spec.txt → \`python3 packages/aslnut/docs/_tree/gen.py\` (from \`packages/aslnut/docs\`) → \`node packages/aslnut/docs/_tree/status.mjs\` → commit both.

**Statuses:** built (in \`packages/aslnut\`, tested on WebGPU and WebGL2) · partly (some of it there) · planned · proposed · open.
**Done:** built = 1, partly = ½.

${cpLines}
- **Overall (every part): ${label(root)}** · built ${count('built')} · partly ${count('partly')} · planned ${count('planned')} · proposed ${count('proposed')} · open ${count('open')}.

## Checkpoints

A part is in a checkpoint when it is tagged \`+N\` in spec.txt (a tag on a group covers every leaf under it).

${cpTrees}

## The whole tree, ${DEPTH} levels

\`\`\`
${draw(root, () => true, DEPTH)}
\`\`\`

## Every part's id (for reports: "did core.entities.locomotion.lanes")

| id | status | checkpoints |
|---|---|---|
${ids.join('\n')}
`);
console.log(checkpoints.map((c) => `checkpoint ${c.n}: ${pct(all.filter((x) => x.tags.includes(c.n)))}`).join('\n'));
console.log(`STATUS.md: ${label(root)}`);
