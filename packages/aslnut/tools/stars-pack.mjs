// The stars' pack: the Hipparcos catalogue's stars (ESA 1997, from CDS VizieR) down to a magnitude, as the tab-separated
// columns the sky reads (ra, dec in degrees J2000, visual magnitude, B−V): a list to serve yourself, so the night sky
// draws without the network (catalogues.hipparcos({ url })).
//   node tools/stars-pack.mjs <out.tsv> [magnitude = 6.5] [from.tsv: VizieR's asu-tsv already downloaded]
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { gzipSync } from 'node:zlib';

const [out, mag = '6.5', from] = process.argv.slice(2);
if (!out) { console.log('node tools/stars-pack.mjs <out.tsv> [magnitude] [from.tsv]'); process.exit(1); }
const url = `https://vizier.cds.unistra.fr/viz-bin/asu-tsv?-source=I/239/hip_main&-out=RAICRS&-out=DEICRS&-out=Vmag&-out=B-V&Vmag=%3C${Number(mag).toFixed(1)}&-out.max=60000`;
const text = from ? readFileSync(from, 'utf8') : await (await fetch(url)).text();
const rows = [];
for (const line of text.split('\n')) {
  if (!line || line[0] === '#') continue;
  const c = line.split('\t'), n = c.map((x) => x.trim());
  // VizieR's own rows (HIP first) or ours: the four numbers from the right place
  const v = n.length >= 5 && /^\d+$/.test(n[0]) ? n.slice(1, 5) : n.slice(0, 4);
  const [ra, dec, m, bv] = v.map(Number);
  if (!v[0] || !Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(m) || m > Number(mag)) continue;
  rows.push(`${ra.toFixed(4)}\t${dec.toFixed(4)}\t${m.toFixed(2)}\t${v[3] && Number.isFinite(bv) ? bv.toFixed(2) : ''}`);
}
const body = `# Hipparcos (ESA 1997) via CDS VizieR I/239: ra, dec (degrees, J2000), Vmag, B-V; ${rows.length} stars to magnitude ${mag}\n${rows.join('\n')}\n`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, body); writeFileSync(`${out}.gz`, gzipSync(body, { level: 9 }));
console.log(`${out}: ${rows.length} stars, ${(body.length / 1024).toFixed(0)} kB (${(gzipSync(body).length / 1024).toFixed(0)} kB gzipped)`);
