// What a pack has round a place: every piece touching a box, its kind, its points' heights near the place.
//   node packages/baker/gates/probe.ts <pack dir> <lon> <lat> [radius m]
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
const { bakedPieces } = await import(`${resolve(process.env.ASLNUT_SRC ?? `${import.meta.dirname}/../../aslnut/src`)}/modules/world/earth/presets/built/roads/baked.ts`);
const [D0, LON, LAT, R = '6'] = process.argv.slice(2);
const D = D0.endsWith('/') ? D0 : D0 + '/';
const idx = JSON.parse(readFileSync(D + 'index.json', 'utf8'));
const O = idx.origin, kx = 111320 * Math.cos(O[1] * Math.PI / 180);
const x = (+LON - O[0]) * kx, z = -(+LAT - O[1]) * 110574, r = +R;
console.log(`at ${x.toFixed(1)}, ${z.toFixed(1)} (place metres)`);
for (let ix = Math.floor((x - r) / 500); ix <= Math.floor((x + r) / 500); ix++) for (let iz = Math.floor((z - r) / 500); iz <= Math.floor((z + r) / 500); iz++) {
  const f = `${D}${ix}_${iz}.json`; if (!existsSync(f)) continue;
  const t = JSON.parse(readFileSync(f, 'utf8'));
  for (const p of bakedPieces(t, idx.kinds) as any[]) {
    const pts: number[][] = p.t === 'area' ? p.rings.flat() : p.t === 'poly' ? p.ring : p.t === 'edge' ? p.pts : p.t === 'strip' ? p.edges.flat() : [];
    const near = pts.filter((q) => Math.hypot(q[0]! - x, q[1]! - z) < r);
    if (!near.length) continue;
    const props = t.infos[p.info]?.props ?? {};
    console.log(`${p.t} ${p.kind} (${props.name ?? props.what ?? ''}${props.highway ? ' ' + props.highway : ''}) ${pts.length} pts; near: ${near.slice(0, 8).map((q) => `(${q[0]!.toFixed(2)},${q[1]!.toFixed(2)}: ${q[2]!.toFixed(2)}${p.t === 'edge' ? ' g ' + q[3]!.toFixed(2) : ''})`).join(' ')}`);
  }
}
