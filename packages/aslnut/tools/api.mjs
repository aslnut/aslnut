// tools/api.mjs: the public interface, frozen. Emits the type declarations, follows every file the package's entry
// points (package.json exports) reach, and writes what they declare (comments, private members and the values of
// constants left out) to api/aslnut.api.txt. Checked against that file: a line gone or changed is a break (exit 1); a
// line added is the interface growing (told, allowed). From 0.2.0 the interface only grows.
//   node tools/api.mjs           check against api/aslnut.api.txt
//   node tools/api.mjs --write   write it again (a release, or growth looked at and kept)
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const snapFile = join(pkg, 'api', 'aslnut.api.txt');
const write = process.argv.includes('--write');

// the declarations, emitted where they cannot be mistaken for a build
const out = mkdtempSync(join(tmpdir(), 'aslnut-api-'));
const tsc = [join(pkg, 'node_modules/.bin/tsc'), join(pkg, '../../node_modules/.bin/tsc')].find(existsSync);
if (!tsc) { console.error('api: no tsc (npm install first)'); process.exit(2); }
try {
  execFileSync(tsc, ['-p', join(pkg, 'tsconfig.build.json'), '--emitDeclarationOnly', '--declarationMap', 'false', '--sourceMap', 'false', '--outDir', out], { stdio: 'inherit' });
} catch { rmSync(out, { recursive: true, force: true }); process.exit(2); }

// the entry points: every export's types, as dist paths, read from the emitted folder
const exportsMap = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).exports;
const entries = Object.values(exportsMap).map((e) => (typeof e === 'object' && e.types) || null).filter(Boolean)
  .map((t) => join(out, relative('dist', t.replace(/^\.\//, ''))));

// every file they reach: export … from, import … from, import("…")
const SPEC = /(?:from\s+|import\s*\(\s*)["'](\.{1,2}\/[^"']+)["']/g;
const dts = (base, spec) => {
  const p = resolve(dirname(base), spec).replace(/\.(ts|js|mjs)$/, '');
  for (const c of [`${p}.d.ts`, join(p, 'index.d.ts')]) if (existsSync(c)) return c;
  return null;
};
const seen = new Set(), queue = [...entries];
while (queue.length) {
  const f = queue.pop();
  if (!f || seen.has(f) || !existsSync(f)) continue;
  seen.add(f);
  for (const m of readFileSync(f, 'utf8').matchAll(SPEC)) { const d = dts(f, m[1]); if (d && !seen.has(d)) queue.push(d); }
}

// what a file declares, in lines: no comments, no private members, a constant's value said by its type
function lines(src) {
  src = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  const kept = [];
  for (let l of src.split('\n')) {
    l = l.replace(/\s+\/\/.*$/, '').trimEnd();
    if (!l.trim()) continue;
    if (/^\s*private\s+[\w$#]+[;?!(:]/.test(l) || /^\s*#private;/.test(l)) continue;
    l = l.replace(/^(\s*export declare const [\w$]+) = "(?:[^"\\]|\\.)*";$/, '$1: string;')
      .replace(/(\b[\w$]+) = -?\d[\d_.e+-]*(?=[,;])/g, '$1: number');
    kept.push(l);
  }
  return kept;
}
const files = [...seen].sort();
const text = files.map((f) => [`## ${relative(out, f)}`, ...lines(readFileSync(f, 'utf8'))].join('\n')).join('\n\n') + '\n';
rmSync(out, { recursive: true, force: true });

if (write || !existsSync(snapFile)) {
  mkdirSync(dirname(snapFile), { recursive: true });
  writeFileSync(snapFile, text);
  console.log(`api: wrote ${relative(pkg, snapFile)} (${files.length} files, ${text.split('\n').length} lines)`);
  process.exit(0);
}

// the check, file by file: lines gone (a break) and lines added (growth), as a multiset of lines
const byFile = (t) => {
  const m = new Map(); let cur = null;
  for (const l of t.split('\n')) { if (l.startsWith('## ')) { cur = l.slice(3); m.set(cur, []); } else if (cur && l) m.get(cur).push(l); }
  return m;
};
const was = byFile(readFileSync(snapFile, 'utf8')), now = byFile(text);
const gone = [], added = [];
for (const [f, ls] of was) {
  const have = new Map(); for (const l of now.get(f) ?? []) have.set(l, (have.get(l) ?? 0) + 1);
  if (!now.has(f)) { gone.push(`${f}: the whole file (${ls.length} lines)`); continue; }
  for (const l of ls) { const n = have.get(l) ?? 0; if (n) have.set(l, n - 1); else gone.push(`${f}: ${l.trim()}`); }
}
for (const [f, ls] of now) {
  const had = new Map(); for (const l of was.get(f) ?? []) had.set(l, (had.get(l) ?? 0) + 1);
  for (const l of ls) { const n = had.get(l) ?? 0; if (n) had.set(l, n - 1); else added.push(`${f}: ${l.trim()}`); }
}
for (const a of added) console.log(`  + ${a}`.slice(0, 240));
for (const g of gone) console.log(`  - ${g}`.slice(0, 240));
if (gone.length) {
  console.log(`api: ${gone.length} line(s) of the frozen interface gone or changed (a break), ${added.length} added. Keep the old form beside the new one; only a widening the reviewer accepts is written with --write`);
  process.exit(1);
}
console.log(`api: no break; ${added.length ? `${added.length} line(s) added (growth: --write to keep them)` : 'unchanged'}`);
