// Build the earth-lite offline basemap: Sentinel-2 cloudless 2020 by EOX (CC BY 4.0, free to keep and share with
// attribution), levels 0..maxZoom, as XYZ tiles in a folder you host. Never in git or npm: it goes to the data folder.
//   node tools/earth-lite.mjs [outDir] [maxZoom=4]      (z ≤ 4: 341 tiles, about 5 MB)
import { mkdirSync, writeFileSync, existsSync } from 'node:fs';
import net from 'node:net';
import { join, resolve } from 'node:path';
// a slow first connect (far servers) must not lose the IPv4 attempt to IPv6's quick failure
net.setDefaultAutoSelectFamilyAttemptTimeout(3000);
const out = resolve(process.argv[2] ?? join(import.meta.dirname, '..', '..', '..', 'data', 'packs', 'earth-lite'));
const maxZ = Number(process.argv[3] ?? 4);
const url = (z, x, y) => `https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2020_3857/default/g/${z}/${y}/${x}.jpg`;
let n = 0, bytes = 0;
const jobs = [];
for (let z = 0; z <= maxZ; z++) for (let x = 0; x < 2 ** z; x++) { mkdirSync(join(out, String(z), String(x)), { recursive: true }); for (let y = 0; y < 2 ** z; y++) jobs.push([z, x, y]); }
// gently: four at a time, retried
await Promise.all(Array.from({ length: 4 }, async () => {
  for (let j; (j = jobs.shift());) {
    const [z, x, y] = j, f = join(out, String(z), String(x), `${y}.jpg`);
    if (existsSync(f)) continue;
    for (let k = 0; ; k++) {
      try {
        const r = await fetch(url(z, x, y), { signal: AbortSignal.timeout(20000) });
        if (!r.ok) throw new Error(`${r.status} ${url(z, x, y)}`);
        const b = new Uint8Array(await r.arrayBuffer()); writeFileSync(f, b); n++; bytes += b.length; break;
      } catch (e) { if (k >= 4) throw e; await new Promise((ok) => setTimeout(ok, 1000 * 2 ** k)); }
    }
  }
}));
writeFileSync(join(out, 'ATTRIBUTION.txt'), 'Sentinel-2 cloudless 2020 - https://s2maps.eu by EOX IT Services GmbH (contains modified Copernicus Sentinel data 2020). Licence: CC BY 4.0.\n');
console.log(`earth-lite: ${n} tiles, ${(bytes / 1048576).toFixed(1)} MB → ${out}`);
