// The humans pack: a body template exported from the modelling tool → the pack aslnut's humans presets load (bones
// named without a prefix, every hair style of modules › presets › humans › hair › styles baked on the base body,
// numbers rounded to 0.01 mm), gzipped beside; the reference positions the generator is tested against copied too.
//   node tools/humans-pack.mjs <template.json> [<reference.json>] [<out dir, default ../../data/packs/humans>]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import { join, resolve } from 'node:path';
import { generate, vertexParts, PART_NAMES } from '../src/modules/presets/humans/body/generator.ts';
import { scalpOf, generateHair, mergePieces } from '../src/modules/presets/humans/hair/generate.ts';
import { HAIR_STYLES } from '../src/modules/presets/humans/hair/styles.ts';

const [src, refSrc, outArg] = process.argv.slice(2);
if (!src) { console.log('node tools/humans-pack.mjs <template.json> [<reference.json>] [<out dir>]'); process.exit(1); }
const OUT = resolve(outArg ?? join(import.meta.dirname, '..', '..', '..', 'data', 'packs', 'humans'));
mkdirSync(OUT, { recursive: true });
const name = (n) => (n ? String(n).replace(/^mixamorig:?/, '') : null);
const r5 = (x) => Math.round(x * 1e5) / 1e5;
const t0 = performance.now();
const s = JSON.parse(readFileSync(src, 'utf8'));
const base = generate({});
if (base.positions.length / 3 !== s.verts) throw new Error(`the template has ${s.verts} vertices, the generator makes ${base.positions.length / 3}`);
const tpl = {
  v: 1, verts: s.verts, faces: s.faces,
  bones: s.bones.map((b) => ({ name: name(b.name), parent: name(b.parent), head: b.head.map(r5) })),
  j: s.j, w: s.w,
  helpers: (s.rig?.helpers ?? []).map((h) => ({ bone: name(h.bone), source: name(h.source), factor: h.factor ?? 0.5 })),
  correctives: Object.fromEntries(Object.entries(s.correctives ?? {}).map(([k, c]) => [k, { idx: c.idx, d: c.d.map(r5) }])),
  rules: (s.rig?.correctives ?? []).map((c) => ({ ...c, bone: name(c.bone) })),
  decal: { vids: s.decal.vids, uv: s.decal.uv.map((p) => p.map(r5)), tris: s.decal.tris, offset: s.decal.offset },
  hair: {},
};
// the hair: sculpted styles (a cap under the short ones), the generated ones from their numbers
const parts = vertexParts(), headSet = [];
for (let v = 0; v < s.verts; v++) if (['head', 'neck'].includes(PART_NAMES[parts[v]])) headSet.push(v);
const scalp = scalpOf(tpl, base.positions, headSet);
const piece = (p) => ({ pos: Array.from(p.pos, r5), tris: Array.from(p.tris), j: Array.from(p.j), w: Array.from(p.w) });
for (const [id, st] of Object.entries(HAIR_STYLES)) {
  if (st.sculpted) {
    const h = s.hair?.[st.sculpted]; if (!h) { console.log(`skip ${id}: no sculpted '${st.sculpted}' in the template`); continue; }
    tpl.hair[id] = piece(st.cap ? mergePieces(h, generateHair(st.cap, scalp)) : h);
  } else tpl.hair[id] = piece(generateHair(st.params ?? {}, scalp));
}
const json = JSON.stringify(tpl);
writeFileSync(join(OUT, 'template.json'), json); writeFileSync(join(OUT, 'template.json.gz'), gzipSync(json, { level: 9 }));
if (refSrc) {
  const r = JSON.parse(readFileSync(refSrc, 'utf8'));
  r.bones = Object.fromEntries(Object.entries(r.bones).map(([k, v]) => [name(k), v]));
  writeFileSync(join(OUT, 'reference.json'), JSON.stringify(r));
}
const kb = (n) => `${(n / 1024).toFixed(0)} KB`;
console.log(`humans pack → ${OUT}: template ${kb(json.length)} (gzip ${kb(gzipSync(json).length)}), ${Object.keys(tpl.hair).length} hair styles (${Object.entries(tpl.hair).map(([k, h]) => `${k} ${h.tris.length / 3}`).join(', ')} triangles) · ${((performance.now() - t0) / 1000).toFixed(1)} s`);
