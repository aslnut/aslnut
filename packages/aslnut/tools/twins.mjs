// The shader-twin lint: every WGSL shader (src/core/render/graphics/shaders/*.wgsl.ts, and any *.wgsl.ts a module or a
// kit carries: a preset's material) has its GLSL twin (*.glsl.ts), with the
// same functions in the same order, and in each function the same numeric literals (a constant changed in one twin
// only, a missing branch, a function missing on one side all fail). Fails the run (exit 1).
//   node tools/twins.mjs
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src'), DIR = join(SRC, 'core', 'render', 'graphics', 'shaders');
/** the shader files: the core's folder, then every module's and kit's (found anywhere under them) */
const walk = (d) => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(d, e.name)) : [join(d, e.name)]));
const FILES = [...readdirSync(DIR).map((f) => join(DIR, f)), ...['modules', 'kits'].flatMap((d) => (existsSync(join(SRC, d)) ? walk(join(SRC, d)) : []))];
// entry points and the clip-space helper differ by design (WGSL vs / fs, GLSL main per stage)
const SKIP = new Set(['vs', 'fs', 'main', 'clipOut']);

/** function name → body text, in order, from WGSL (`fn name(`) or GLSL (`type name(`) */
function functions(text, wgsl) {
  const out = new Map();
  // (a GLSL function may return a struct of its own: a capitalised type name)
  const re = wgsl ? /\bfn\s+([A-Za-z_]\w*)\s*\(/g : /\b(?:void|float|int|uint|bool|[iu]?vec[234]|mat[234]|[A-Z]\w*)\s+([A-Za-z_]\w*)\s*\(/g;
  let m;
  while ((m = re.exec(text))) {
    const open = text.indexOf('{', m.index); if (open < 0) continue;
    // a GLSL prototype (ends with ';' before '{') is not a definition
    if (!wgsl && text.slice(m.index, open).includes(';')) continue;
    let depth = 0, i = open;
    for (; i < text.length; i++) { if (text[i] === '{') depth++; else if (text[i] === '}' && --depth === 0) break; }
    if (!out.has(m[1])) out.set(m[1], text.slice(open, i + 1));
  }
  return out;
}
const numbers = (body) => (body.replace(/\/\/[^\n]*/g, '').replace(/\$\{[^}]*\}/g, '').match(/(?<![\w.])(?:0x[0-9a-f]+u?|\d+\.\d*|\.\d+|\d+(?:e[+-]?\d+)?u?)(?![\w.])/gi) ?? [])
  .map((n) => (/^0x/i.test(n) ? n.toLowerCase().replace(/u$/, '') : String(Number(n.replace(/u$/, ''))))).sort();

let bad = 0, pairs = 0, fns = 0;
for (const full of FILES.filter((x) => x.endsWith('.wgsl.ts')).sort()) {
  const f = relative(SRC, full), twin = full.replace('.wgsl.ts', '.glsl.ts');
  if (!existsSync(twin)) { console.log(`MISSING ${relative(SRC, twin)}: ${f} has no GLSL twin`); bad++; continue; }
  pairs++;
  const W = functions(readFileSync(full, 'utf8'), true), G = functions(readFileSync(twin, 'utf8'), false);
  const wn = [...W.keys()].filter((n) => !SKIP.has(n)), gn = [...G.keys()].filter((n) => !SKIP.has(n));
  for (const n of new Set([...wn, ...gn])) {
    if (!W.has(n) || !G.has(n)) { console.log(`MISSING ${f}: ${n} only in ${W.has(n) ? 'WGSL' : 'GLSL'}`); bad++; continue; }
    fns++;
    const a = numbers(W.get(n)), b = numbers(G.get(n));
    if (a.join(',') !== b.join(',')) { console.log(`DIFFER  ${f}: ${n}\n  wgsl ${a.join(' ')}\n  glsl ${b.join(' ')}`); bad++; }
  }
  if (wn.join(',') !== gn.join(',')) { console.log(`ORDER   ${f}: wgsl ${wn.join(' ')} · glsl ${gn.join(' ')}`); bad++; }
}
for (const full of FILES.filter((x) => x.endsWith('.glsl.ts'))) if (!existsSync(full.replace('.glsl.ts', '.wgsl.ts'))) { console.log(`MISSING ${relative(SRC, full)}: a GLSL shader without its WGSL original`); bad++; }
console.log(`${bad ? 'FAIL' : 'ok  '} shader twins: ${pairs} pairs, ${fns} functions checked${bad ? `, ${bad} problem(s)` : ''}`);
process.exit(bad ? 1 : 0);
