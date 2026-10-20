// modules › world › earth › presets › built › roads (baked): roads solved at build time (tools › compile) drawn on the
// device. A baked tile is data (typed pieces with their heights: each level's road surface cut in cells, its kerb,
// markings, parapets, decks' sides and undersides, piers, abutments, retaining walls, portals); here it is only
// triangulated and drawn,
// streamed round the camera like the street level. The colours are live (the look); the heights are the bake's,
// over the sea. With it, the ground goes under the roads: `clampTerrain(terrain, url)` lowers the terrain wherever
// the bake says a road lies at grade or in a cut (never under a deck or over a tunnel), recomputed on the device from
// the live ground, so the ground never comes up through a road.
//   w.add(bakedRoads({ url: '/packs/roads/clayton/index.json' }))
//   earth({ terrain: [clampTerrain(terrain.mapzen(), '/packs/roads/clayton/clamp.json')] })
import { clampIndex, type ClampJson, type ClampIndex, type UnderOptions } from '../../../../../../core/geometry/networks/clamp-index.ts';
import { decodeNumbers, decodeTile } from '../../../../../../core/data/loading/chunks/numbers.ts';
import { MeshBuilder, rgbOf, type V3 } from '../../../../../../core/geometry/shapes/mesh.ts';
import { earcut } from '../../../../../../core/geometry/build/earcut.ts';
import { StreetDetail, type DetailContext, type StreetDetailProps } from '../../../../surface/street-detail.ts';
import type { Terrain } from '../../../../surface/sources.ts';
import { tilePoint } from '../../../../../../core/space/geo.ts';
import type { Piece, P3 } from '../../../../../../core/geometry/networks/bake-types.ts';
import { standGrid, type StandGrid } from '../../../../../../core/space/stands.ts';
import type { WorkerLane } from '../../../../../../core/runtime/workers.ts';
import type { Leveled } from '../../../../../../core/observation/presence.ts';

/** a baked road tile (v2): see tools › compile › steps › manifest */
export interface BakedTile { v: number; ix: number; iz: number; size: number; infos: { kind: string; props: Record<string, unknown>; patchRefs?:number[] }[]; pieces: number[][]; numeric?: string[]; numericScale?:number;turnUnits?:number; overhead?:number[]; levels?:[number,number][] }
/** the colour of each kind of piece */
export type RoadsLook = Record<string, string>;
export const BAKED_LOOK: RoadsLook = {
  water: '#477985', viaduct: '#b5b1a7', carriageway: '#3b3e42', platform: '#3b3e42', edge: '#9a978d', deck: '#b5b1a7', cut: '#a8a49a', footpath: '#c3beb2', verge: '#7f9f58', ramp: '#b7b4ab', kerb: '#b7b4ab', 'kerb-face': '#a9a69c', skirt: '#9a978d', median: '#6e9b46', island: '#6e9b46',
  marking: '#f2f1ea', parapet: '#c9c6bd', 'parapet-top': '#d4d1c8', 'deck-side': '#b5b1a7', 'deck-under': '#8f8c84', 'pier-cap':'#a8a49a', 'pier-cap-under':'#96938b', girder: '#aaa79e', 'girder-under': '#96938b', pier: '#a8a49a', abutment: '#a8a49a', retaining: '#a8a49a', 'ramp-wall': '#b0ada4', portal: '#9d9a91',
};
export interface BakedRoadsProps extends Omit<StreetDetailProps<BakedTile, null>, 'build'> {
  look?: Partial<RoadsLook>;
  /** kinds not drawn (a debug view: only the carriageways, say) */
  hide?: string[];
  /** build the tiles' meshes in workers (core › runtime › workers) running your module with
   *  workers.serve({ ...bakedRoadsWorker() }) (one lane can serve every streamed layer: the street level's too): only the
   *  tile's numbers cross, the mesh comes back moved; unset, each is built here */
  worker?: WorkerLane;
}
/** what a baked tile's mesh is made from, as it crosses to a worker: its numbers (still encoded: a text crosses at
 *  once), never its infos (they stay here, for picking) */
export type BakedNumbers = Pick<BakedTile, 'v' | 'ix' | 'iz' | 'size' | 'numeric' | 'numericScale' | 'turnUnits'> & { pieces?: number[][] };
/** the functions a worker offers for baked roads (your worker module: workers.serve({ ...bakedRoadsWorker() })); also
 *  the main thread's fallback. `roads(numbers, kinds, look, hide)`: the tile's mesh · `clamp(job)`: a terrain tile's
 *  ground under the roads (clampTerrain's `worker`), the clamp tiles it needs built here once (the last 96 kept) */
export function bakedRoadsWorker() {
  const kept = new Map<string, ClampIndex>();
  const indexOf = (u: string, j: ClampJson, origin: [number, number], legacy: boolean) => {
    const key = `${legacy ? 1 : 0}|${origin.join(',')}|${u}`; let ix = kept.get(key);
    if (ix) { kept.delete(key); kept.set(key, ix); return ix; }
    ix = clampIndex({ ...j, origin }, { legacy }); kept.set(key, ix);
    if (kept.size > 96) kept.delete(kept.keys().next().value!);
    return ix;
  };
  return {
    roads: (t: BakedNumbers, kinds: string[], look: RoadsLook, hide: string[]): Float32Array => bakedMesh({ ...t, infos: [], pieces: t.pieces ?? [] }, kinds, look, new Set(hide)).mesh,
    clamp: (job: ClampJob): Float32Array => clampSamples(job.out, job.t, job.n, job.at, job.keys, job.tiles.map((x) => (x ? indexOf(x.url, x.j, job.at.origin, job.o.legacy) : null)), job.o),
  };
}
/** a tile's numbers to cross (its encoded rows when it has them, else its pieces) */
const numbersOf = (t: BakedTile): BakedNumbers => ({ v: t.v, ix: t.ix, iz: t.iz, size: t.size, ...(t.numeric ? { numeric: t.numeric, numericScale: t.numericScale, turnUnits: t.turnUnits } : { pieces: t.pieces }) });
/** Decode the published descriptors for independent geometry checks. */
export function bakedPieces(t:BakedTile,kinds:readonly string[]):Piece[]{
  decodeTile(t);
  return t.pieces.map((p,index)=>{
    const overhead=t.overhead?.includes(index)??false;
    const kind=kinds[p[1]!]??'',info=p[2]!,x=(v:number)=>v+t.ix*t.size,z=(v:number)=>v+t.iz*t.size;
    const point=(o:number):P3=>[x(p[o]!),z(p[o+1]!),p[o+2]!];
    if(p[0]===0){const ne=p[3]!,np=p[4]!;return {t:'strip',kind,info,overhead,edges:Array.from({length:ne},(_,e)=>Array.from({length:np},(_,i)=>point(5+(e*np+i)*3)))};}
    if(p[0]===1)return {t:'poly',kind,info,fan:p[3]===1,ring:Array.from({length:p[4]!},(_,i)=>point(5+i*3))};
    if(p[0]===2)return {t:'wall',kind,info,line:Array.from({length:p[3]!},(_,i)=>[...point(4+i*4),p[7+i*4]!])};
    if(p[0]===3)return {t:'box',kind,info,at:point(3),top:p[6]!,w:p[7]!,d:p[8]!,turn:p[9]!};
    if(p[0]===4){let o=5+p[4]!;const rings=Array.from({length:p[4]!},(_,r)=>Array.from({length:p[5+r]!},()=>{const q=point(o);o+=3;return q;}));return {t:'area',kind,info,overhead,level:t.levels?.find(row=>row[0]===index)?.[1]??0,down:p[3]===1,rings};}
    return {t:'edge',kind,info,pts:Array.from({length:p[3]!},(_,i)=>[...point(4+i*6),p[7+i*6]!,p[8+i*6]!,p[9+i*6]!])};
  });
}
/** a baked tile's mesh: each piece triangulated, its points at their own heights (a free chunk: nothing stands on the
 *  ground but what the bake says) */
export function bakedMesh(t: BakedTile, kinds: readonly string[], lookIn: RoadsLook, hide: ReadonlySet<string> = new Set()): { mesh: Float32Array; ids: number } {
  decodeTile(t);
  // (the colours as numbers once: a colour read from its text at every triangle took a sixth of the build)
  const look: Record<string, number> = {}; for (const k in lookIn) look[k] = rgbOf(lookIn[k]!);
  const mb = new MeshBuilder();
  // the kerbs' ends here (the edge's point, the inner one and the height, to the cm): where two meet edge to edge the
  // kerb runs on; every other end is closed (most meet a kerb ramp: the kerb's 15 cm stood open there)
  const kerb = kinds.indexOf('kerb'), ends = new Map<string, number>();
  const endOf = (p: number[], i: number) => { const o = 4 + i * 6, c = (v: number) => Math.round(v * 100); return `${c(p[o]!)},${c(p[o + 1]!)},${c(p[o]! + p[o + 4]!)},${c(p[o + 1]! + p[o + 5]!)},${c(p[o + 2]!)}`; };
  if (kerb >= 0 && !hide.has('kerb')) for (const p of t.pieces) if (p[0] === 5 && p[1] === kerb && p[3]! > 1) for (const i of [0, p[3]! - 1]) { const k = endOf(p, i); ends.set(k, (ends.get(k) ?? 0) + 1); }
  for (const p of t.pieces) {
    const type = p[0]!, kind = kinds[p[1]!] ?? '', info = p[2]!; if (hide.has(kind)) continue;
    const col = look[kind] ?? 0x888888;
    mb.as(info).material(['viaduct','deck','deck-under','deck-side','girder','girder-under','parapet','pier','pier-cap','pier-cap-under','abutment','retaining','ramp-wall','portal','cut'].includes(kind)?7:0);
    if (type === 0) {
      const ne = p[3]!, np = p[4]!, at = (e: number, i: number): V3 => { const o = 5 + (e * np + i) * 3; return [p[o]!, p[o + 2]!, p[o + 1]!]; };
      for (let e = 0; e + 1 < ne; e++) for (let i = 0; i + 1 < np; i++) {const a=at(e,i),b=at(e+1,i),c=at(e+1,i+1),d=at(e,i+1);if(kind==='deck-under'||kind==='girder-under'){const up=(b[2]-a[2])*(c[0]-a[0])-(b[0]-a[0])*(c[2]-a[2]);if(up>=0)mb.quad(d,c,b,a,col);else mb.quad(a,b,c,d,col);}else mb.quadUp(a,b,c,d,col);}
    } else if (type === 1) {
      const fan = p[3] === 1, n = p[4]!, at = (i: number): V3 => [p[5 + i * 3]!, p[7 + i * 3]!, p[6 + i * 3]!];
      if (fan) { for (let i = 1; i < n; i++) mb.triUp(at(0), at(i), at(i + 1 < n ? i + 1 : 1), col); }
      else { const ring: number[] = []; for (let i = 0; i < n; i++) ring.push(p[5 + i * 3]!, p[6 + i * 3]!); const tri = earcut(ring, [], 2); for (let k = 0; k + 2 < tri.length; k += 3) mb.triUp(at(tri[k]!), at(tri[k + 1]!), at(tri[k + 2]!), col); }
    } else if (type === 2) {
      const n = p[3]!, q = (i: number) => 4 + i * 4;
      for (let i = 0; i + 1 < n; i++) { const a = q(i), b = q(i + 1); mb.quad([p[a]!, p[a + 3]!, p[a + 1]!], [p[b]!, p[b + 3]!, p[b + 1]!], [p[b]!, p[b + 2]!, p[b + 1]!], [p[a]!, p[a + 2]!, p[a + 1]!], col); }
    } else if (type === 4) {
      // an area: an outline and its holes, every point at its own height (facing down: a deck's underside)
      const down = p[3] === 1, nr = p[4]!, flat: number[] = [], hs: number[] = [], holes: number[] = [];
      let o = 5 + nr;
      for (let r = 0; r < nr; r++) { const n = p[5 + r]!; if (r) holes.push(flat.length / 2); for (let i = 0; i < n; i++) { flat.push(p[o]!, p[o + 1]!); hs.push(p[o + 2]!); o += 3; } }
      const at = (i: number): V3 => [flat[i * 2]!, hs[i]!, flat[i * 2 + 1]!], tri = earcut(flat, holes, 2);
      for (let k = 0; k + 2 < tri.length; k += 3) {
        const a = at(tri[k]!), b = at(tri[k + 1]!), c = at(tri[k + 2]!);
        if (!down) mb.triUp(a, b, c, col);
        else { const ny = (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]); if (ny >= 0) mb.tri(a, c, b, col); else mb.tri(a, b, c, col); }
      }
    } else if (type === 5) {
      // an edge of a road's surface: what stands on it built here (the kerb's top, face and foot; a deck's parapet and
      // side; a cut's retaining wall; a freeway's plain edge)
      const n = p[3]!, P = (i: number) => { const o = 4 + i * 6; return { x: p[o]!, z: p[o + 1]!, h: p[o + 2]!, g: p[o + 3]!, ix: p[o]! + p[o + 4]!, iz: p[o + 1]! + p[o + 5]! }; };
      const wall = (ax: number, az: number, at: number, ab: number, bx: number, bz: number, bt: number, bb: number, c: number) => mb.quad([ax, ab, az], [bx, bb, bz], [bx, bt, bz], [ax, at, az], c);
      for (let i = 0; i + 1 < n; i++) {
        const a = P(i), b = P(i + 1);
        if (kind === 'ramp') {
          // a kerb ramp: the kerb lowered flush (2 cm), its foot as a kerb's
          mb.quadUp([a.x, a.h + 0.02, a.z], [b.x, b.h + 0.02, b.z], [b.ix, b.h + 0.02, b.iz], [a.ix, a.h + 0.02, a.iz], look.ramp ?? col);
          wall(a.x, a.z, a.h + 0.02, Math.min(a.g, a.h) - 0.6, b.x, b.z, b.h + 0.02, Math.min(b.g, b.h) - 0.6, look.skirt ?? col);
        } else if (kind === 'kerb') {
          const kc = look.kerb ?? col, fc = look['kerb-face'] ?? col, sc = look.skirt ?? col;
          mb.quadUp([a.x, a.h + 0.15, a.z], [b.x, b.h + 0.15, b.z], [b.ix, b.h + 0.15, b.iz], [a.ix, a.h + 0.15, a.iz], kc);
          wall(a.ix, a.iz, a.h + 0.15, a.h - 0.05, b.ix, b.iz, b.h + 0.15, b.h - 0.05, fc);
          wall(a.x, a.z, a.h + 0.15, Math.min(a.g, a.h) - 0.6, b.x, b.z, b.h + 0.15, Math.min(b.g, b.h) - 0.6, sc);
        } else if (kind === 'viaduct' || kind === 'deck') {
          const top=kind==='viaduct'?.9:1;
          mb.quadUp([a.x,a.h+top,a.z],[b.x,b.h+top,b.z],[b.ix,b.h+top,b.iz],[a.ix,a.h+top,a.iz],look['parapet-top']??col);
          wall(a.ix,a.iz,a.h+top,a.h,b.ix,b.iz,b.h+top,b.h,look.parapet??col);
          wall(a.x,a.z,a.h+top,a.h,b.x,b.z,b.h+top,b.h,look.parapet??col);
          wall(a.x,a.z,a.h,a.h-(t.v<=2?1.2:.35),b.x,b.z,b.h,b.h-(t.v<=2?1.2:.35),look['deck-side']??col);
        } else if (kind === 'cut') wall(a.x, a.z, Math.max(a.h + 0.6, a.g + 0.3), a.h - 0.05, b.x, b.z, Math.max(b.h + 0.6, b.g + 0.3), b.h - 0.05, look.retaining ?? col);
        else wall(a.x, a.z, a.h, Math.min(a.g, a.h) - 0.6, b.x, b.z, b.h, Math.min(b.g, b.h) - 0.6, look.skirt ?? col);
      }
      // a kerb's ends: its cross-section (top, face down under the road, back down into the ground), facing out along it
      if (kind === 'kerb' && n > 1) for (const [i, j] of [[0, 1], [n - 1, n - 2]] as const) {
        if ((ends.get(endOf(p, i)) ?? 0) > 1) continue;
        const a = P(i), b = P(j), q: [V3, V3, V3, V3] = [[a.x, a.h + 0.15, a.z], [a.ix, a.h + 0.15, a.iz], [a.ix, a.h - 0.05, a.iz], [a.x, Math.min(a.g, a.h) - 0.6, a.z]];
        // (b − a) × (c − a) of the first triangle against the way out (from the next point to the end)
        const ux = q[1][0] - q[0][0], uz = q[1][2] - q[0][2], vy = q[2][1] - q[0][1], out = (ux * vy) * (a.z - b.z) - (uz * vy) * (a.x - b.x);
        if (out >= 0) mb.quad(q[0], q[1], q[2], q[3], look['kerb-face'] ?? col); else mb.quad(q[3], q[2], q[1], q[0], look['kerb-face'] ?? col);
      }
    } else if (type === 3) {
      const [x, z, h, top, w, d, turn] = p.slice(3) as [number, number, number, number, number, number, number];
      const c = Math.cos(turn), s = Math.sin(turn), P = (u: number, v: number, y: number): V3 => [x + u * c - v * s, y, z + u * s + v * c];
      const corners = [P(-d / 2, -w / 2, 0), P(d / 2, -w / 2, 0), P(d / 2, w / 2, 0), P(-d / 2, w / 2, 0)];
      for (let k = 0; k < 4; k++) { const a = corners[k]!, b = corners[(k + 1) % 4]!; mb.quad([b[0], h, b[2]], [a[0], h, a[2]], [a[0], top, a[2]], [b[0], top, b[2]], col); }
      mb.quadUp([corners[0]![0], top, corners[0]![2]], [corners[1]![0], top, corners[1]![2]], [corners[2]![0], top, corners[2]![2]], [corners[3]![0], top, corners[3]![2]], col);
    }
  }
  return { mesh: mb.build(), ids: t.infos.length };
}
/** what is drawn not to be stood on: water, the undersides, the piers' caps */
const NOT_STOOD = new Set(['water', 'deck-under', 'girder-under', 'pier-cap', 'pier-cap-under']);
/** a baked tile's surfaces to stand on (core › space › stands): the tops of its roads, footpaths, verges, decks,
 *  ramps, kerbs, stairs' treads and markings, as drawn (x, z, height × 3 a triangle, the tile's metres) */
export function bakedStands(t: BakedTile, kinds: readonly string[], hide: ReadonlySet<string> = new Set()): Float32Array {
  decodeTile(t);
  const out: number[] = [], tri = (ax: number, az: number, ah: number, bx: number, bz: number, bh: number, cx: number, cz: number, ch: number) => { out.push(ax, az, ah, bx, bz, bh, cx, cz, ch); };
  for (const p of t.pieces) {
    const type = p[0]!, kind = kinds[p[1]!] ?? ''; if (hide.has(kind) || NOT_STOOD.has(kind)) continue;
    if (type === 0) {
      const ne = p[3]!, np = p[4]!, o = (e: number, i: number) => 5 + (e * np + i) * 3;
      for (let e = 0; e + 1 < ne; e++) for (let i = 0; i + 1 < np; i++) { const a = o(e, i), b = o(e + 1, i), c = o(e + 1, i + 1), d = o(e, i + 1); tri(p[a]!, p[a + 1]!, p[a + 2]!, p[b]!, p[b + 1]!, p[b + 2]!, p[c]!, p[c + 1]!, p[c + 2]!); tri(p[a]!, p[a + 1]!, p[a + 2]!, p[c]!, p[c + 1]!, p[c + 2]!, p[d]!, p[d + 1]!, p[d + 2]!); }
    } else if (type === 1 || (type === 4 && p[3] !== 1)) {
      // an outline (and holes) at its points' heights: a fan, or ear-clipped as drawn
      const nr = type === 1 ? 1 : p[4]!, flat: number[] = [], hs: number[] = [], holes: number[] = [];
      let o = type === 1 ? 5 : 5 + nr;
      for (let r = 0; r < nr; r++) { const n = type === 1 ? p[4]! : p[5 + r]!; if (r) holes.push(flat.length / 2); for (let i = 0; i < n; i++) { flat.push(p[o]!, p[o + 1]!); hs.push(p[o + 2]!); o += 3; } }
      const at = (i: number) => [flat[i * 2]!, flat[i * 2 + 1]!, hs[i]!] as const, n = hs.length;
      const ix: number[] = []; if (type === 1 && p[3] === 1) { for (let i = 1; i < n; i++) ix.push(0, i, i + 1 < n ? i + 1 : 1); } else ix.push(...earcut(flat, holes, 2));
      for (let k = 0; k + 2 < ix.length; k += 3) tri(...at(ix[k]!), ...at(ix[k + 1]!), ...at(ix[k + 2]!));
    } else if (type === 5 && (kind === 'kerb' || kind === 'ramp')) {
      // a kerb's top (15 cm over the road's edge), a kerb ramp's (2 cm): from the edge to its inner line
      const n = p[3]!, up = kind === 'kerb' ? 0.15 : 0.02;
      for (let i = 0; i + 1 < n; i++) {
        const a = 4 + i * 6, b = a + 6, ah = p[a + 2]! + up, bh = p[b + 2]! + up;
        tri(p[a]!, p[a + 1]!, ah, p[b]!, p[b + 1]!, bh, p[b]! + p[b + 4]!, p[b + 1]! + p[b + 5]!, bh); tri(p[a]!, p[a + 1]!, ah, p[b]! + p[b + 4]!, p[b + 1]! + p[b + 5]!, bh, p[a]! + p[a + 4]!, p[a + 1]! + p[a + 5]!, ah);
      }
    } else if (type === 3 && kind === 'ramp') {
      // a stair's tread: its top
      const [x, z, , top, w, d, turn] = p.slice(3) as [number, number, number, number, number, number, number];
      const c = Math.cos(turn), s = Math.sin(turn), P = (u: number, v: number) => [x + u * c - v * s, z + u * s + v * c, top] as const;
      tri(...P(-d / 2, -w / 2), ...P(d / 2, -w / 2), ...P(d / 2, w / 2)); tri(...P(-d / 2, -w / 2), ...P(d / 2, w / 2), ...P(-d / 2, w / 2));
    }
  }
  return new Float32Array(out);
}
export class BakedRoads extends StreetDetail<BakedTile, null> {
  constructor(p: BakedRoadsProps) {
    const look = { ...BAKED_LOOK, ...p.look } as RoadsLook, hide = new Set(p.hide ?? []);
    let me: BakedRoads | null = null;
    const build = (t: BakedTile, _ctx: DetailContext) => {
      const kinds = ((me?.area as unknown as { kinds?: string[] } | null)?.kinds) ?? [];
      const audit=((me?.area as unknown as {report?:{stages:{patches?:unknown[]}[]}})?.report?.stages??[]).flatMap(g=>g.patches??[]);
      for(const i of t.infos)if(i.patchRefs){i.props.patches=i.patchRefs.map(id=>audit[id]);delete i.patchRefs;}
      const info = (id: number) => { const i = t.infos[id]; return i ? { kind: i.kind, id: `${t.ix}_${t.iz}:${id}`, props: i.props } : null; };
      // in a worker: the tile's numbers there (decoded there too: the tile kept here stays as it came), its mesh back
      if (p.worker) return p.worker.call<Float32Array>('roads', numbersOf(t), kinds, look, [...hide]).then((mesh) => ({ chunk: { mesh, free: true, info } }));
      decodeTile(t);
      const { mesh } = bakedMesh(t, kinds, look, hide);
      return { chunk: { mesh, free: true, info } };
    };
    // Picking still shows provenance. A source id owns several union cells; tinting it
    // paints arbitrary cell boundaries across a continuous asphalt surface.
    super({ lod: [400, 1200], hover: false, ...p, id: p.id ?? 'roads', build });
    me = this; this.hidden = hide;
  }
  private hidden: ReadonlySet<string>;
  // ── what is stood on (core › space › stands): each built tile's tops in a grid of cells, made when first asked
  // (nothing is spent without someone standing here), let go with the tile ──
  private grids = new WeakMap<BakedTile, StandGrid>();
  /** bumped when a tile is built or let go */
  standVersion = 0;
  override put(key: string, spec: Parameters<StreetDetail['put']>[1]): this { this.standVersion++; super.put(key, spec); this.reach(key); return this; }
  override drop(key: string): this { this.standVersion++; this.unreach(key); return super.drop(key); }
  // which built tiles reach each tile's square (a piece is kept whole in the tile of its middle: a street's kerb reaches
  // hundreds of metres out of it): a place asks those, by where their meshes reach
  private reaching = new Map<string, Map<string, [number, number]>>(); private reached = new Map<string, string[]>();
  private reach(key: string): void {
    this.unreach(key);
    const a = this.area, [tx, tz] = key.split('_').map(Number) as [number, number]; if (!a) return;
    const e = this.reachOf(key), size = a.size, cells: string[] = [];
    const [x0, x1, z0, z1] = e ? [tx + Math.floor(e[0]! / size), tx + Math.floor(e[3]! / size), tz + Math.floor(e[2]! / size), tz + Math.floor(e[5]! / size)] : [tx, tx, tz, tz];
    for (let x = Math.min(x0, tx); x <= Math.max(x1, tx); x++) for (let z = Math.min(z0, tz); z <= Math.max(z1, tz); z++) {
      const k = `${x}_${z}`; let m = this.reaching.get(k); if (!m) this.reaching.set(k, (m = new Map())); m.set(key, [tx, tz]); cells.push(k);
    }
    this.reached.set(key, cells);
  }
  private unreach(key: string): void { for (const k of this.reached.get(key) ?? []) { const m = this.reaching.get(k); m?.delete(key); if (m && !m.size) this.reaching.delete(k); } this.reached.delete(key); }
  /** the heights (true m) of the road surfaces drawn at a place: a road, a kerb's top, a footpath, a verge, a deck, a
   *  ramp, a stair's tread */
  levelsAt(lon: number, lat: number, out: number[]): void {
    const a = this.area; if (!a) return;
    const kx = 111320 * Math.cos(a.origin[1] * Math.PI / 180), X = (lon - a.origin[0]) * kx, Z = -(lat - a.origin[1]) * 110574, size = a.size;
    const here = this.reaching.get(`${Math.floor(X / size)}_${Math.floor(Z / size)}`); if (!here) return;
    // every tile whose pieces reach here (its own, a neighbour's long kerb), by where its mesh reaches
    for (const [key, [tx, tz]] of here) {
      const t = this.builtTile(tx, tz); if (!t) continue;
      const x = X - tx * size, z = Z - tz * size, e = this.reachOf(key);
      if (e && (x < e[0]! - 0.1 || x > e[3]! + 0.1 || z < e[2]! - 0.1 || z > e[5]! + 0.1)) continue;
      let g = this.grids.get(t);
      // (a copy decoded: the tile kept as it came, its numbers still short to send to a worker when built again)
      if (!g) { const kinds = (a as unknown as { kinds?: string[] }).kinds ?? []; this.grids.set(t, (g = standGrid(bakedStands({ ...t }, kinds, this.hidden)))); }
      g.levelsAt(x, z, out);
    }
  }
}
export const bakedRoads = (p: Leveled<BakedRoadsProps>) => new BakedRoads(p as BakedRoadsProps);

// ── the ground under the roads ──────────────────────────────────────────────────────────────────────────────────
/** a terrain whose ground goes under the baked roads: the base terrain's heights, lowered (never raised) where a road
 *  lies at grade or in a cut: a little under its surface across it, level with its kerb's foot for 4 m beside it, then
 *  back to the natural ground on a 1 : 2 batter; and between the samples, at every level of the terrain: every sample
 *  of a cell of the tile's mesh that a road touches goes under that road (its triangles, and a finer tile drawn on
 *  these heights while its own load, never rise through it). The lowering stays within a cell of the road */
/** a path with its '.' and '..' steps resolved */
const normalise = (u: string) => { const [, pre = '', rest = u] = /^([a-z]+:\/\/[^/]*)?(.*)$/i.exec(u) ?? []; const out: string[] = []; for (const seg of rest.split('/')) { if (seg === '..') out.pop(); else if (seg !== '.') out.push(seg); } return pre + out.join('/'); };
/** a terrain tile's clamp, as it crosses to a worker: the ground so far (lowered in place, moved back), the tile, the
 *  place's frame, the clamp tiles under it (their JSON as it came, by URL: built there once) and the options */
export interface ClampJob { out: Float32Array; t: { z: number; x: number; y: number }; n: number; at: ClampAt; keys: string[]; tiles: ({ url: string; j: ClampJson } | null)[]; o: ClampOptions }
interface ClampAt { origin: [number, number]; size: number; kx: number }
interface ClampOptions { batter: number; reach: number; legacy: boolean; under: { margin?: number; steep?: number; coarse?: number } | null }
/** the clamp's own work on a terrain tile (here or in a worker): every sample at most the limit of the road its clamp
 *  tile knows near it; then, between the samples, every corner of a cell a road touches under that road (a cell
 *  listed by several clamp tiles counted by the one its first point lies in, or by each loaded one that lists it when
 *  that one is not). `out` lowered in place */
function clampSamples(out: Float32Array, t: { z: number; x: number; y: number }, n: number, at: ClampAt, keys: readonly string[], got: readonly (ClampIndex | null)[], o: ClampOptions): Float32Array {
  const { batter, reach, under } = o;
  const [lo0, la0] = tilePoint(t.z, t.x, t.y, 0, 0), [lo1, la1] = tilePoint(t.z, t.x, t.y, 1, 1);
  const X = (lon: number) => (lon - at.origin[0]) * at.kx, Z = (lat: number) => -(lat - at.origin[1]) * 110574;
  // each sample asks the clamp tile it lies in (every cell and line within 20 m of a tile is listed in it)
  const byTile = new Map<number, ClampIndex>(); keys.forEach((k, m) => { const ix = got[m]; if (ix) { const [a, b] = k.split('_').map(Number) as [number, number]; byTile.set(a * 65536 + b, ix); } });
  // (the samples' own guard for a coarse mesh, from the road's grade: not needed when the cells are held under)
  const sampleSize = o.legacy || under ? 0 : Math.max(Math.abs(X(lo1) - X(lo0)), Math.abs(Z(la1) - Z(la0))) / (n - 1);
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [lon, lat] = tilePoint(t.z, t.x, t.y, i / (n - 1), j / (n - 1)), x = X(lon), z = Z(lat);
    const ix = byTile.get(Math.floor(x / at.size) * 65536 + Math.floor(z / at.size)), lim = ix?.limit(x, z, batter, reach, sampleSize, !under) ?? Infinity;
    if (lim < Infinity) { const q = j * n + i; if (lim < out[q]!) out[q] = lim; }
  }
  if (under && got.some(Boolean)) {
    const xs = new Float64Array(n), zs = new Float64Array(n), floor = new Float32Array(n * n).fill(Infinity), loaded = new Set(keys.filter((_, k) => got[k]).map((k) => { const [a, b] = k.split('_').map(Number); return a! * 65536 + b!; }));
    for (let i = 0; i < n; i++) xs[i] = X(tilePoint(t.z, t.x, t.y, i / (n - 1), 0)[0]);
    for (let j = 0; j < n; j++) zs[j] = Z(tilePoint(t.z, t.x, t.y, 0, j / (n - 1))[1]);
    keys.forEach((k, m) => {
      const ix = got[m]; if (!ix) return;
      const [kx0, kz0] = k.split('_').map(Number) as [number, number];
      ix.under({ xs, zs }, floor, { ...under, ground: out, owns: (x, z) => { const a = Math.floor(x / at.size), b = Math.floor(z / at.size); return (a === kx0 && b === kz0) || !loaded.has(a * 65536 + b); } });
    });
    for (let q = 0; q < n * n; q++) if (floor[q]! < out[q]!) out[q] = floor[q]!;
  }
  return out;
}
/** the least and most ix, then iz, of a pack's tiles ([0, -1, 0, -1] when it has none: no cell is walked) */
function tileBox(tiles: [number, number][]): [number, number, number, number] {
  let a = Infinity, b = -Infinity, c = Infinity, d = -Infinity;
  for (const [ix, iz] of tiles) { if (ix < a) a = ix; if (ix > b) b = ix; if (iz < c) c = iz; if (iz > d) d = iz; }
  return tiles.length ? [a, b, c, d] : [0, -1, 0, -1];
}
export function clampTerrain(base: Terrain, url: string, o: { batter?: number; reach?: number; legacy?:boolean;
  /** between the samples too (default on): every sample of a mesh cell a road touches goes under that road's surface,
   *  at every level of the terrain, so no triangle rises through a road (nor a finer tile drawn on these heights while
   *  its own load); false: at the samples only (the clamp before) */
  under?: UnderOptions | false;
  /** the clamp made in a worker (core › runtime › workers: one of the lane's, its clamp tiles kept there) running your
   *  module with workers.serve({ ...bakedRoadsWorker() }) (the baked roads' lane): only the tile's ground and its clamp
   *  tiles' JSON cross, the ground comes back moved; unset, here */
  worker?: WorkerLane } = {}): Terrain {
  const batter = o.batter ?? 0.5, reach = o.reach ?? 14, under = o.under === false || o.legacy ? null : { ...o.under };
  const opts: ClampOptions = { batter, reach, legacy: !!o.legacy, under: under ? { margin: under.margin, steep: under.steep, coarse: under.coarse } : null };
  type BakedGround = {x0:number;z0:number;step:number;nx:number;nz:number;data:ArrayLike<number>;numeric?:string[]};
  type Ctx = Parameters<Terrain['heights']>[2];
  const get = <T,>(ctx: Ctx, u: string) => (ctx as { loader: { get<T>(u: string, o: { kind: 'json' }): Promise<T | null> } }).loader.get<T>(u, { kind: 'json' });
  // the index, then each 500 m tile of the clamp as the ground under it is made
  // (`box`: the least and most ix, iz of its tiles: a coarse terrain tile, a quarter of the globe, walks only those)
  let head: Promise<{ origin: [number, number]; size: number; tiles: Set<string>; box: [number, number, number, number]; kx: number; terrain?: BakedGround|null; from: string } | null> | null = null;
  const tiles = new Map<string, Promise<ClampIndex | null>>();
  const base2 = url.replace(/[^/]*$/, '');
  // (`tilesFrom`: the contract tiles of another pack, relative to this one: a stage's own ground over the final clamp)
  const headOf = (ctx: Ctx) => (head ??= get<{v:number;origin:[number,number];size:number;tiles:[number,number][];terrain?:string;tilesFrom?:string}>(ctx,url).then(async j => j ? {origin:j.origin,size:j.size,tiles:new Set(j.tiles.map(t=>`${t[0]}_${t[1]}`)),box:tileBox(j.tiles),kx:111320*Math.cos(j.origin[1]*Math.PI/180),from:j.tilesFrom?normalise(`${base2}${j.tilesFrom}`):base2,...(j.terrain?{terrain:await get<BakedGround>(ctx,`${base2}${j.terrain}`)}:{})} : null));
  const tileOf = (ctx: Ctx, k: string, origin: [number, number], from: string) => { let p = tiles.get(k); if (!p) { p = get<ClampJson>(ctx, `${from}clamp/${k}.json`).then((j) => (j ? clampIndex({ ...j, origin },{legacy:o.legacy}) : null)); tiles.set(k, p); } return p; };
  return {
    kind: 'terrain', id: `${base.id}-clamped`, attribution: base.attribution, terms: base.terms, when: base.when, where: base.where,
    maxZoom: Math.max(base.maxZoom, 20), blend: base.blend, get version() { return base.version; },
    urlFor: base.urlFor ? (t) => base.urlFor!(t) : undefined,
    async heights(t, n, ctx) {
      const [h, hd] = await Promise.all([base.heights(t, n, ctx), headOf(ctx)]);
      // (its heights kept as 32-bit floats: as a list of numbers its millions of heights hold ~5× the bytes)
      if(hd?.terrain?.numeric){hd.terrain.data=Float32Array.from(decodeNumbers(hd.terrain.numeric,100)[0]!);delete hd.terrain.numeric;}
      if (!h || !hd) return h;
      // the clamp tiles under this terrain tile
      const [lo0, la0] = tilePoint(t.z, t.x, t.y, 0, 0), [lo1, la1] = tilePoint(t.z, t.x, t.y, 1, 1);
      const X = (lon: number) => (lon - hd.origin[0]) * hd.kx, Z = (lat: number) => -(lat - hd.origin[1]) * 110574;
      const keys: string[] = [];
      // (only where the pack has tiles: a z2 tile's own footprint is some 270 million cells of 500 m)
      const ix0 = Math.max(hd.box[0], Math.floor(Math.min(X(lo0), X(lo1)) / hd.size)), ix1 = Math.min(hd.box[1], Math.floor(Math.max(X(lo0), X(lo1)) / hd.size));
      const iz0 = Math.max(hd.box[2], Math.floor(Math.min(Z(la0), Z(la1)) / hd.size)), iz1 = Math.min(hd.box[3], Math.floor(Math.max(Z(la0), Z(la1)) / hd.size));
      for (let ix = ix0; ix <= ix1; ix++) for (let iz = iz0; iz <= iz1; iz++) { const k = `${ix}_${iz}`; if (hd.tiles.has(k)) keys.push(k); }
      if (!keys.length && !hd.terrain) return h;
      // the clamp tiles: built here, or their JSON as it came for a worker (built there)
      const lane = o.worker, raw = lane ? await Promise.all(keys.map((k) => get<ClampJson>(ctx, `${hd.from}clamp/${k}.json`))) : null;
      const got = raw ? null : await Promise.all(keys.map((k) => tileOf(ctx, k, hd.origin, hd.from)));
      const any = (raw ?? got)!.some(Boolean);
      if (!any && !hd.terrain) return h;
      const out = h.slice();
      // the pack's own graded ground first (here: its grid is the pack's, read at each sample)
      if (hd.terrain) for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
        const [lon, lat] = tilePoint(t.z, t.x, t.y, i / (n - 1), j / (n - 1)), x = X(lon), z = Z(lat);
        const g=hd.terrain,fx=(x-g.x0)/g.step,fz=(z-g.z0)/g.step;if(fx>=0&&fz>=0&&fx<g.nx-1&&fz<g.nz-1){const gi=Math.floor(fx),gj=Math.floor(fz),u=fx-gi,v=fz-gj,d=g.data,q=gj*g.nx+gi;out[j*n+i]=(d[q]!*(1-u)+d[q+1]!*u)*(1-v)+(d[q+g.nx]!*(1-u)+d[q+g.nx+1]!*u)*v;}
      }
      if (!any) return out;
      const at: ClampAt = { origin: hd.origin, size: hd.size, kx: hd.kx };
      // (in one worker of the lane: the clamp tiles it builds kept there once, not in every worker)
      if (lane && raw) return lane.callIn<Float32Array>(0, 'clamp', { out, t: { z: t.z, x: t.x, y: t.y }, n, at, keys, tiles: raw.map((j, m) => (j ? { url: `${hd.from}clamp/${keys[m]}.json`, j } : null)), o: opts } satisfies ClampJob);
      return clampSamples(out, t, n, at, keys, got!, opts);
    },
  } as Terrain;
}

export { clampIndex } from '../../../../../../core/geometry/networks/clamp-index.ts';
