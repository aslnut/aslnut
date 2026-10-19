// docs/llms.txt (the authoring guide, the recipes, the imports and the API index for assistants) is what
// docs/_tree/llms.mjs makes from its sources: never stale. Its index names only what exists; its imports are real.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('llms.txt: current with the guide, the recipes, the exports, the reference rows and the tree', async () => {
  const { build, OUT } = await import('../docs/_tree/llms.mjs');
  const made = await build();
  assert.equal(readFileSync(OUT, 'utf8'), made, 'docs/llms.txt is stale: node packages/aslnut/docs/_tree/llms.mjs (gen.py runs it)');
  // the six recipes, each with its code
  for (const r of ['gis-view', 'district-twin', 'fleet', 'analysis', 'own-kind', 'own-thing']) assert.match(made, new RegExp(`### ${r}\\n\\n[^\\n]+\\n\\n\`\`\`ts\\nimport `), r);
  // every name it says 'aslnut' exports is exported (values, at run time)
  const lib = await import('../src/index.ts') as Record<string, unknown>;
  const said = /^from 'aslnut':\n((?: {2}.*\n)+)/m.exec(made)![1]!.split(/,\s*/).map((x) => x.trim()).filter(Boolean);
  assert.ok(said.length > 200);
  assert.deepEqual(said.filter((n) => !(n in lib)), []);
  assert.deepEqual(Object.keys(lib).filter((n) => !said.includes(n)), []);
  // the kinds, read from the package: the office wants two entries and four bays
  assert.match(made, /^- office .*\n(?: {2}- .*\n)*? {2}- entries: anchors of kind 'entry', at least 2, ground \+ front/m);
  assert.match(made, /^ {2}- parking: anchors of kind 'parking', at least 4, ground \+ outside/m);
  // the index: a built part with its row; a planned one only named
  assert.match(made, /^- core\.world\.lifecycle\.world \[built\]: `world\(canvas, options\?\)`/m);
  assert.doesNotMatch(made, /^- core\.world\.describe\.describe /m);
  assert.match(made, /not there yet[^\n]*\n(?: {2}.*\n)*? {2}.*core\.world\.describe\.describe/);
});
