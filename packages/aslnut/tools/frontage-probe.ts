// probe: the buildings, pads and road pieces near a line (lon,lat lon,lat) in a place's baked pack
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { decodeBuiltTile } from '../src/modules/world/earth/presets/built/buildings/tiles.ts';
import { bakedPieces } from '../src/modules/world/earth/presets/built/roads/baked.ts';
const [place = 'street', a = '145.1215549,-37.9225458', b = '145.1257849,-37.9230671', R = '25'] = process.argv.slice(2);
const DIR = join(import.meta.dirname, '..', '..', '..', 'data', 'packs', 'roads', place);
const IDX = JSON.parse(readFileSync(join(DIR, 'index.json'), 'utf8')), BI = JSON.parse(readFileSync(join(DIR, 'built', 'index.json'), 'utf8'));
const KX = 111320 * Math.cos((IDX.origin[1] * Math.PI) / 180), KZ = 110574;
const loc = (s: string) => { const [lon, lat] = s.split(',').map(Number); return [(lon! - IDX.origin[0]) * KX, -(lat! - IDX.origin[1]) * KZ] as [number, number]; };
const A = loc(a), B = loc(b);
const segD = (p: number[], q: number[], r: number[]) => { const dx = r[0]! - q[0]!, dz = r[1]! - q[1]!, L = dx * dx + dz * dz, t = Math.max(0, Math.min(1, ((p[0]! - q[0]!) * dx + (p[1]! - q[1]!) * dz) / L)); return Math.hypot(p[0]! - q[0]! - t * dx, p[1]! - q[1]! - t * dz); };
const side = (p: number[]) => Math.sign((B[0] - A[0]) * (p[1]! - A[1]) - (B[1] - A[1]) * (p[0]! - A[0]));
console.log('A', A.map((v) => v.toFixed(1)), 'B', B.map((v) => v.toFixed(1)));
const tilesNear = new Set<string>(); for (let s = 0; s <= 1; s += 0.05) { const x = A[0] + (B[0] - A[0]) * s, z = A[1] + (B[1] - A[1]) * s; tilesNear.add(`${Math.floor(x / 500)}_${Math.floor(z / 500)}`); }
const Rm = +R;
for (const k of tilesNear) {
  const f = join(DIR, 'built', `${k}.json`); if (!existsSync(f)) continue;
  const t = decodeBuiltTile(JSON.parse(readFileSync(f, 'utf8'))) as any, [ix, iz] = k.split('_').map(Number), ox = ix! * 500, oz = iz! * 500;
  (t.buildings as number[][]).forEach((row, i) => {
    const [h, hf, cls, ...line] = row; const ring: number[][] = []; let x = 0, z = 0; for (let j = 0; j < line.length; j += 2) { x += line[j]!; z += line[j + 1]!; ring.push([ox + x / 10, oz + z / 10]); }
    const d = Math.min(...ring.map((p) => segD(p, A, B))); if (d > Rm) return;
    const xs = ring.map((p) => p[0]!), zs = ring.map((p) => p[1]!);
    const pads = t.pads as number[], patches = (t.patches as number[][]).filter((p) => p[0] === 0 && p[1] === i).map((p) => t.s[p[2]!]);
    // longest edge
    let longest = 0; for (let j = 0; j < ring.length; j++) { const p = ring[j]!, q = ring[(j + 1) % ring.length]!; longest = Math.max(longest, Math.hypot(p[0]! - q[0]!, p[1]! - q[1]!)); }
    console.log(`bld ${k}#${i} cls=${t.s[cls!]} h=${h! / 10} from=${hf} nearest=${d.toFixed(1)}m side=${side(ring[0]!)} longest=${longest.toFixed(1)} bbox=${(Math.max(...xs) - Math.min(...xs)).toFixed(1)}x${(Math.max(...zs) - Math.min(...zs)).toFixed(1)} pad=${pads[2 * i]}cm foot=${pads[2 * i + 1]}cm seed=${t.seeds[i]} patches=${JSON.stringify(patches)}`);
  });
}
// road pieces near the line's middle
const M = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2], ik = `${Math.floor(M[0] / IDX.size)}_${Math.floor(M[1] / IDX.size)}`;
const rt = JSON.parse(readFileSync(join(DIR, `${ik}.json`), 'utf8')), ps = bakedPieces(rt, IDX.kinds) as any[];
const cnt: Record<string, number> = {};
for (const p of ps) { const pts = p.t === 'strip' ? p.edges.flat() : p.t === 'poly' ? p.ring : p.t === 'area' ? p.rings[0] : p.t === 'wall' ? p.line : p.t === 'edge' ? p.pts : [p.at]; const [ix2, iz2] = ik.split('_').map(Number); const d = Math.min(...pts.map((q: number[]) => segD([q[0]! + ix2! * IDX.size, q[1]! + iz2! * IDX.size], A, B))); if (d < Rm) cnt[`${p.kind}/${p.t}${p.t === 'wall' ? ' h' + (p.h ?? p.height ?? '?') : ''}`] = (cnt[`${p.kind}/${p.t}`] ?? 0) + 1; }
console.log('road pieces within', Rm, 'm (tile', ik, '):', cnt);
// the fronts (property lines with a fence) near the line: their span and distance from the line
for (const k of tilesNear) {
  const f = join(DIR, 'built', `${k}.json`); if (!existsSync(f)) continue;
  const t = decodeBuiltTile(JSON.parse(readFileSync(f, 'utf8'))) as any, [ix, iz] = k.split('_').map(Number), ox = ix! * 500, oz = iz! * 500;
  for (const fr of t.fronts as number[][]) {
    const [bi, px, pz, tx, tz, s0, s1] = fr, P = [ox + px! / 10, oz + pz! / 10], d = segD(P, A, B); if (d > Rm) continue;
    const row = t.buildings[bi!]; const h = row[0] / 10, cls = t.s[row[2]];
    console.log(`front ${k}#${bi} cls=${cls} h=${h} line at ${d.toFixed(1)} m from the centreline, span ${((s1! - s0!) / 10).toFixed(1)} m`);
  }
}
