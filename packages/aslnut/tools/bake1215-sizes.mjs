// Pack sizes per place after stages 12–15: the roads (stages 1–11) and the placement (built/), raw and as sent (gzip).
//   node tools/bake1215-sizes.mjs
import { readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const DATA = join(import.meta.dirname, '..', '..', '..', 'data', 'packs', 'roads');
const walk = (d, f) => { for (const e of readdirSync(d, { withFileTypes: true })) { const p = join(d, e.name); if (e.isDirectory()) walk(p, f); else f(p); } };
const rows = [];
for (const place of readdirSync(DATA, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name)) {
  const s = { place, roads: 0, roadsGz: 0, built: 0, builtGz: 0 };
  walk(join(DATA, place), (p) => { const b = statSync(p).size, built = p.includes('/built/'); if (p.endsWith('.gz')) s[built ? 'builtGz' : 'roadsGz'] += b; else s[built ? 'built' : 'roads'] += b; });
  rows.push({ ...s, total: s.roads + s.built, totalGz: s.roadsGz + s.builtGz });
}
const mb = (v) => (v / 1e6).toFixed(2);
for (const r of rows) console.log(`${r.place}: roads ${mb(r.roads)} MB + placement ${mb(r.built)} MB = ${mb(r.total)} MB raw (${mb(r.totalGz)} MB gzip) ${r.total < 50e6 ? 'under' : 'OVER'} 50 MB`);
writeFileSync(join(import.meta.dirname, '..', '.out', 'bake1215', 'sizes.json'), JSON.stringify(rows, null, 1));
