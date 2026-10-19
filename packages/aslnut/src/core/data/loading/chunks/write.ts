// core › data › loading › chunks › format: the solved pieces written as baked tiles (500 m squares from the place's origin;
// each piece in the tile of its middle, its points in metres from the tile's corner, heights over the sea), an index
// (the tiles, the origin, what came from where, the solve's report) and the clamp (where the ground goes under the
// roads: the surfaces' cells with their heights, and the outlines' lines). Numbers to 2 decimals.
//   tile (v2): { v, ix, iz, size, infos: [{ kind, props }], pieces: [[type, kind, info, …numbers]] }
//     strip [t 0, kind, info, edges, points, x, z, h …]   poly [t 1, kind, info, fan, points, x, z, h …]
//     wall [t 2, kind, info, points, x, z, top, bottom …]  box [t 3, kind, info, x, z, h, top, w, d, turn]
//     area [t 4, kind, info, down, rings, points of each ring …, x, z, h …] (the first ring the outline, then holes)
//     edge [t 5, kind, info, points, x, z, h, ground, dx, dz …] (dx, dz: inward across the kerb)
//   clamp (v3): clamp.json { v, origin, size, tiles: [[ix, iz]] }; clamp/ix_iz.json { v, cells: [[rings, points of each …,
//     x, z, h …]], edges: [[x, z, h …]] } (place metres; a piece in every tile its box touches)
import { mkdirSync, readdirSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import { encodeNumbers } from './numbers.ts';
import type { Piece, Solved } from '../../../geometry/networks/bake-types.ts';

const SIZE = 500, r2 = (v: number) => Math.round(v * 100) / 100;
export function writeTiles(dir: string, o: { origin: [number, number]; bbox: number[]; attribution: string; ground: string; solved: Solved; sources?:Record<string,unknown> }): { tiles: number; bytes: number } {
  mkdirSync(dir, { recursive: true });
  for (const f of readdirSync(dir)) rmSync(join(dir, f), { recursive: true });
  const KINDS: string[] = [], kindNo = (k: string) => { let i = KINDS.indexOf(k); if (i < 0) { KINDS.push(k); i = KINDS.length - 1; } return i; };
  const tiles = new Map<string, { ix: number; iz: number; pieces: number[][]; overhead:number[]; levels:[number,number][]; infos: Map<number, number>; list: Solved['infos'] }>();
  const mid = (p: Piece): [number, number] => {
    const pts = p.t === 'strip' ? p.edges.flat() : p.t === 'poly' ? p.ring : p.t === 'wall' ? p.line : p.t === 'area' ? p.rings[0]! : p.t === 'edge' ? p.pts : [p.at];
    let x = 0, z = 0; for (const q of pts) { x += q[0]; z += q[1]; } return [x / pts.length, z / pts.length];
  };
  for (const p of o.solved.pieces) {
    const [mx, mz] = mid(p), ix = Math.floor(mx / SIZE), iz = Math.floor(mz / SIZE), k = `${ix}_${iz}`, ox = ix * SIZE, oz = iz * SIZE;
    let t = tiles.get(k); if (!t) tiles.set(k, (t = { ix, iz, pieces: [], overhead:[], levels:[], infos: new Map(), list: [] }));
    let info = t.infos.get(p.info); if (info === undefined) { info = t.list.length; t.list.push(o.solved.infos[p.info]!); t.infos.set(p.info, info); }
    if(p.t==='area'&&p.level)t.levels.push([t.pieces.length,p.level]);
    if(p.kind==='deck-under'||((p.t==='area'||p.t==='strip')&&p.overhead))t.overhead.push(t.pieces.length);
    const k2 = kindNo(p.kind), xy = (q: number[]) => [r2(q[0]! - ox), r2(q[1]! - oz)];
    if (p.t === 'strip') t.pieces.push([0, k2, info, p.edges.length, p.edges[0]!.length, ...p.edges.flatMap((e) => e.flatMap((q) => [...xy(q), r2(q[2])]))]);
    else if (p.t === 'poly') t.pieces.push([1, k2, info, p.fan ? 1 : 0, p.ring.length, ...p.ring.flatMap((q) => [...xy(q), r2(q[2])])]);
    else if (p.t === 'wall') t.pieces.push([2, k2, info, p.line.length, ...p.line.flatMap((q) => [...xy(q), r2(q[2]), r2(q[3])])]);
    else if (p.t === 'edge') t.pieces.push([5, k2, info, p.pts.length, ...p.pts.flatMap((q) => [...xy(q), r2(q[2]), r2(q[3]), r2(q[4]), r2(q[5])])]);
    else if (p.t === 'area') t.pieces.push([4, k2, info, p.down ? 1 : 0, p.rings.length, ...p.rings.map((r) => r.length), ...p.rings.flatMap((r) => r.flatMap((q) => [...xy(q), r2(q[2])]))]);
    else t.pieces.push([3, k2, info, ...xy(p.at), r2(p.at[2]), r2(p.top), r2(p.w), r2(p.d), Math.round(p.turn * 1000) / 1000]);
  }
  const audit=o.solved.report.stages.flatMap(g=>g.patches??[]),patchIds=new Map(audit.map((p,i)=>[JSON.stringify(p),i]));
  let bytes = 0;
  for (const t of tiles.values()) {
    const infos=t.list.map(i=>{
      const {patches,...props}=i.props;
      return {...i,props,...(patches?{patchRefs:(patches as import('../../../runtime/workers/compile/patch-policy.ts').Patch[]).map(p=>{const id=patchIds.get(JSON.stringify(p));if(id===undefined)throw new Error('Feature patch missing from the stage audit');return id;})}:{})};
    });
    const s=JSON.stringify({v:3,ix:t.ix,iz:t.iz,size:SIZE,infos,...(t.overhead.length?{overhead:t.overhead}:{}),...(t.levels.length?{levels:t.levels}:{}),numericScale:100,turnUnits:10,numeric:encodeNumbers(t.pieces.map(row=>row[0]===3?row.map((v,i)=>i===9?v*10:v):row),100)});
    writeFileSync(join(dir,`${t.ix}_${t.iz}.json`),s);bytes+=Buffer.byteLength(s);
  }
  // the clamp in the same 500 m tiles (a piece in every tile its box touches, a little round: the device loads only
  // the tiles under the ground it is making), with an index
  const P = (q: number[]) => [r2(q[0]!), r2(q[1]!), r2(q[2]!)], ct = new Map<string, { cells: number[][]; edges: number[][] }>();
  const into = (pts: number[][], f: (c: { cells: number[][]; edges: number[][] }) => void) => { let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const q of pts) { x0 = Math.min(x0, q[0]!); x1 = Math.max(x1, q[0]!); z0 = Math.min(z0, q[1]!); z1 = Math.max(z1, q[1]!); } const m = 20; for (let ix = Math.floor((x0 - m) / SIZE); ix <= Math.floor((x1 + m) / SIZE); ix++) for (let iz = Math.floor((z0 - m) / SIZE); iz <= Math.floor((z1 + m) / SIZE); iz++) { const k = `${ix}_${iz}`; let c = ct.get(k); if (!c) ct.set(k, (c = { cells: [], edges: [] })); f(c); } };
  for (const rs of o.solved.clamp.cells) { const row = [rs.length, ...rs.map((r) => r.length), ...rs.flatMap((r) => r.flatMap(P))]; into(rs[0]!, (c) => c.cells.push(row)); }
  // (a long line in pieces of 50 m or so, each in the tiles it touches)
  for (const l of o.solved.clamp.edges) { let a = 0; while (a < l.length - 1) { let len = 0, b = a; while (b < l.length - 1 && len < 50) { len += Math.hypot(l[b + 1]![0] - l[b]![0], l[b + 1]![1] - l[b]![1]); b++; } const part = l.slice(a, b + 1), row = part.flatMap(P); into(part, (c) => c.edges.push(row)); a = b; } }
  mkdirSync(join(dir, 'clamp'), { recursive: true }); for (const f of readdirSync(join(dir, 'clamp'))) rmSync(join(dir, 'clamp', f));
  for (const [k, c] of ct) { const t = JSON.stringify({ v: 4, numericScale:100, numericCells: encodeNumbers(c.cells,100), numericEdges: encodeNumbers(c.edges,100) }); writeFileSync(join(dir, 'clamp', `${k}.json`), t); bytes += Buffer.byteLength(t); }
  const clamp = JSON.stringify({ v: 3, ...(o.solved.clamp.terrain?{terrain:'terrain.json'}:{}), origin: o.origin, size: SIZE, tiles: [...ct.keys()].map((k) => k.split('_').map(Number)) });
  writeFileSync(join(dir, 'clamp.json'), clamp); bytes += Buffer.byteLength(clamp);
  if(o.solved.clamp.terrain){const g=o.solved.clamp.terrain,s=JSON.stringify({...g,data:undefined,numeric:encodeNumbers([Array.from(g.data,r2)],100)});writeFileSync(join(dir,'terrain.json'),s);bytes+=Buffer.byteLength(s);}
  // the walking graph's lines (place metres): footpaths, crossings, links from the kerb ramps, paths
  const walk = JSON.stringify({ v: 1, origin: o.origin, lines: o.solved.walk.map((w) => [w.kind, ...w.pts.flatMap((p) => [r2(p[0]), r2(p[1])])]) });
  writeFileSync(join(dir, 'walk.json'), walk); bytes += Buffer.byteLength(walk);
  const index = JSON.stringify({ v: 2, size: SIZE, origin: o.origin, bbox: o.bbox, kinds: KINDS, tiles: [...tiles.values()].map((t) => [t.ix, t.iz]), attribution: o.attribution, sources:o.sources??{}, report: o.solved.report });
  writeFileSync(join(dir,'index.json'),index);bytes+=Buffer.byteLength(index);
  // Same JSON tile format; precompressed transport avoids shipping repeated numeric text.
  const compress=(base:string)=>{for(const f of readdirSync(base,{withFileTypes:true})){const p=join(base,f.name);if(f.isDirectory())compress(p);else if(f.name.endsWith('.json'))writeFileSync(`${p}.gz`,gzipSync(readFileSync(p)));}};compress(dir);
  return { tiles: tiles.size, bytes };
}
