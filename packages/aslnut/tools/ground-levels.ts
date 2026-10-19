// The ground under the roads at every level of the terrain, as the device draws it: the runtime's own clamp
// (clampTerrain) made for every terrain tile the roads touch, then drawn as the surface shader draws it (two
// triangles a cell, split from its north-east corner to its south-west one; a tile whose own heights are not in yet
// drawn on its parent's, read bilinear at its points), measured under every road surface point (one every `step` m of
// each facet of the pieces drawn). The investigation's node simulation of the ground (gsim), made a check.
//   const r = await groundLevels({ dir: 'data/packs/roads/street', zooms: [15, 16, 17], standIns: [2] })
//   r.levels['z16'].over15   → road points with the ground more than 15 cm over them at z16
//   node tools/ground-levels.ts data/packs/roads/street [zooms] [step]   (UNDER=0: the clamp at the samples only)
import { readFileSync, existsSync } from 'node:fs';
import { bakedPieces, clampTerrain } from '../src/modules/world/earth/presets/built/roads/baked.ts';
import { facetsOf, FacetIndex, type Facet } from '../src/core/geometry/networks/facets.ts';
import type { UnderOptions } from '../src/core/geometry/networks/clamp-index.ts';
import { decodeNumbers } from '../src/core/data/loading/chunks/numbers.ts';
import type { Terrain } from '../src/modules/world/surface/sources.ts';

export interface LevelStats { samples: number; over5: number; over15: number; over40: number; worst: number; worstAt: [number, number] | null }
export interface SpreadStats { /** samples of the level's tiles lowered more than 5 cm by the cells' clamp (against the clamp at samples only) */ lowered: number; samples: number; /** the farthest of them from a road cell of the clamp, and from a surface drawn (m); their depth: median, 95th percentile, most (m) */ farthest: number; farthestDrawn: number; /** the farthest from a surface drawn: lon, lat, from a surface drawn, from a clamp cell, depth */ farthestAt: [number, number, number, number, number][]; p50: number; p95: number; most: number; /** samples raised against the old clamp (its coarse grade guard gone) */ raised: number; /** the lowered samples off the road surfaces (more than 0.5 m from one), and their depth */ offRoad: number; offP50: number; offP95: number; offMost: number }
export interface GroundReport { pack: string; step: number; kinds: string[]; levels: Record<string, LevelStats>; spread: Record<string, SpreadStats>; tiles: Record<string, number>; ms: Record<string, number> }

const N = 33;
const merc = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
/** a terrain tile's own heights, the clamp made over a flat base (the pack's own graded ground wins inside it) */
function terrainOf(dir: string, under: UnderOptions | false | undefined, base?: Terrain): Terrain {
  const flat: Terrain = { kind: 'terrain', id: 'flat', attribution: '', terms: { show: true, prefetch: true, keep: true, export: true }, maxZoom: 22, blend: 0, version: 0, heights: async (_t, n) => new Float32Array(n * n) };
  return clampTerrain(base ?? flat, `${dir}/clamp.json`, under === undefined ? {} : { under });
}
const ctxOf = () => ({ loader: { get: async (u: string) => (existsSync(u) ? JSON.parse(readFileSync(u, 'utf8')) : null) }, priority: 'now', prefetch: false }) as never;

export async function groundLevels(o: { dir: string; zooms: number[]; standIns?: number[]; step?: number; kinds?: string[]; region?: [number, number, number, number]; under?: UnderOptions | false; spread?: boolean; /** the ground under the clamp (default flat: the pack's own ground wins inside it) */ base?: Terrain; /** the decks' surfaces too (default true): false, the roads at grade or in a cut only (the clamp's) */ overhead?: boolean }): Promise<GroundReport> {
  const dir = o.dir.replace(/\/$/, ''), step = o.step ?? 1, kinds = o.kinds ?? ['carriageway'];
  const index = JSON.parse(readFileSync(`${dir}/index.json`, 'utf8')) as { origin: [number, number]; size: number; kinds: string[]; tiles: [number, number][] };
  const O = index.origin, kx = 111320 * Math.cos((O[1] * Math.PI) / 180), KZ = 110574;
  const ll = (x: number, z: number): [number, number] => [O[0] + x / kx, O[1] - z / KZ];
  // the road surfaces drawn (their facets: as the device triangulates them)
  const [rx0, rz0, rx1, rz1] = o.region ?? [-Infinity, -Infinity, Infinity, Infinity];
  const pieces = index.tiles.filter(([ix, iz]) => (ix + 1) * index.size >= rx0 - 40 && ix * index.size <= rx1 + 40 && (iz + 1) * index.size >= rz0 - 40 && iz * index.size <= rz1 + 40)
    .flatMap(([ix, iz]) => { const f = `${dir}/${ix}_${iz}.json`; return existsSync(f) ? bakedPieces(JSON.parse(readFileSync(f, 'utf8')), index.kinds) : []; });
  const roads = facetsOf(pieces.filter((p) => kinds.includes(p.kind) && p.t === 'area' && (o.overhead !== false || !p.overhead)));
  // the points measured (place metres, the surface's height)
  const px: number[] = [], pz: number[] = [], ph: number[] = [];
  for (const f of roads) {
    const [a, b, c] = f.points, L = Math.max(Math.hypot(a[0] - b[0], a[1] - b[1]), Math.hypot(a[0] - c[0], a[1] - c[1]), Math.hypot(b[0] - c[0], b[1] - c[1])), n = Math.max(1, Math.ceil(L / step));
    for (let i = 0; i < n; i++) for (let j = 0; j < n - i; j++) {
      const u = (i + 1 / 3) / n, v = (j + 1 / 3) / n, x = a[0] * (1 - u - v) + b[0] * u + c[0] * v, z = a[1] * (1 - u - v) + b[1] * u + c[1] * v;
      if (x < rx0 || x > rx1 || z < rz0 || z > rz1) continue;
      px.push(x); pz.push(z); ph.push(f.height(x, z));
    }
  }
  const ctx = ctxOf(), now = terrainOf(dir, o.under, o.base), before = o.spread ? terrainOf(dir, false, o.base) : null;
  // (the spread: the surfaces drawn, and the clamp's road cells, each as facets to measure a distance to)
  const drawn = new FacetIndex(o.spread ? facetsOf(pieces.filter((p) => p.t === 'area' && !p.overhead && ['carriageway', 'footpath', 'verge', 'platform', 'island', 'median'].includes(p.kind))) : [], 20);
  let clampFacets: FacetIndex | null = null;
  const clampSurf = () => (clampFacets ??= (() => {
    const head = JSON.parse(readFileSync(`${dir}/clamp.json`, 'utf8')) as { tiles: [number, number][]; size: number }, out: Facet[] = [];
    for (const [ix, iz] of head.tiles) {
      if ((ix + 1) * head.size < rx0 - 40 || ix * head.size > rx1 + 40 || (iz + 1) * head.size < rz0 - 40 || iz * head.size > rz1 + 40) continue;
      const j = JSON.parse(readFileSync(`${dir}/clamp/${ix}_${iz}.json`, 'utf8')) as { cells?: number[][]; numericCells?: string[]; numericScale?: number };
      for (const a of j.numericCells ? decodeNumbers(j.numericCells, j.numericScale ?? 1000) : j.cells ?? []) {
        const nr = a[0]!, rings: [number, number, number][][] = []; let q = 1 + nr;
        for (let r = 0; r < nr; r++) { const ring: [number, number, number][] = []; for (let i = 0; i < a[1 + r]!; i++) { ring.push([a[q]!, a[q + 1]!, a[q + 2]!]); q += 3; } rings.push(ring); }
        out.push(...facetsOf([{ t: 'area', kind: 'cell', info: 0, rings }]));
      }
    }
    return new FacetIndex(out, 20);
  })());
  const report: GroundReport = { pack: dir, step, kinds, levels: {}, spread: {}, tiles: {}, ms: {} };
  // a point's place on the global grid of samples at a level (32 cells a tile)
  const gridOf = (x: number, z: number, zz: number): [number, number] => { const [lon, lat] = ll(x, z), k = 32 * 2 ** zz; return [((lon + 180) / 360) * k, ((1 - merc(lat) / Math.PI) / 2) * k]; };
  const cache = new Map<string, Promise<Float32Array | null>>();
  const tileH = (t: Terrain, zz: number, tx: number, ty: number) => { const k = `${t === now ? 'n' : 'b'}${zz}/${tx}/${ty}`; let p = cache.get(k); if (!p) cache.set(k, (p = t.heights({ z: zz, x: tx, y: ty }, N, ctx))); return p; };
  const blank = new Float32Array(N * N);
  for (const zz of o.zooms) for (const up of [0, ...(o.standIns ?? [])]) {
    // drawn at level zz + up on the heights of level zz (up 0: its own)
    const t0 = performance.now(), zc = zz + up, name = up ? `z${zc} on z${zz}` : `z${zz}`;
    const need = new Set<string>();
    const cells: Int32Array = new Int32Array(px.length * 2);
    for (let s = 0; s < px.length; s++) { const [gx, gy] = gridOf(px[s]!, pz[s]!, zc); cells[2 * s] = Math.floor(gx); cells[2 * s + 1] = Math.floor(gy); need.add(`${Math.floor(gx / 32) >> up}/${Math.floor(gy / 32) >> up}`); }
    const hs = new Map<string, Float32Array>();
    await Promise.all([...need].map(async (k) => { const [tx, ty] = k.split('/').map(Number) as [number, number]; hs.set(k, (await tileH(now, zz, tx, ty)) ?? blank); }));
    report.tiles[name] = need.size;
    // a vertex of the drawn mesh (global grid at level zc): its own heights, or its parent's read bilinear
    const vertex = (gx: number, gy: number, ctx0: number, cty0: number): number => {
      const ptx = ctx0 >> up, pty = cty0 >> up, h = hs.get(`${ptx}/${pty}`)!;
      const fx = gx / 2 ** up - 32 * ptx, fy = gy / 2 ** up - 32 * pty;
      const x0 = Math.min(N - 1, Math.max(0, Math.floor(fx))), y0 = Math.min(N - 1, Math.max(0, Math.floor(fy))), x1 = Math.min(x0 + 1, N - 1), y1 = Math.min(y0 + 1, N - 1);
      const u = Math.min(1, Math.max(0, fx - x0)), v = Math.min(1, Math.max(0, fy - y0));
      return (h[y0 * N + x0]! * (1 - u) + h[y0 * N + x1]! * u) * (1 - v) + (h[y1 * N + x0]! * (1 - u) + h[y1 * N + x1]! * u) * v;
    };
    const st: LevelStats = { samples: 0, over5: 0, over15: 0, over40: 0, worst: 0, worstAt: null };
    for (let s = 0; s < px.length; s++) {
      const [fx, fy] = gridOf(px[s]!, pz[s]!, zc), gx = cells[2 * s]!, gy = cells[2 * s + 1]!, u = fx - gx, v = fy - gy, tx = Math.floor(gx / 32), ty = Math.floor(gy / 32);
      const h00 = vertex(gx, gy, tx, ty), h10 = vertex(gx + 1, gy, tx, ty), h01 = vertex(gx, gy + 1, tx, ty);
      const g = u + v <= 1 ? h00 + u * (h10 - h00) + v * (h01 - h00) : (() => { const h11 = vertex(gx + 1, gy + 1, tx, ty); return h11 + (1 - u) * (h01 - h11) + (1 - v) * (h10 - h11); })();
      const d = g - ph[s]!; st.samples++;
      if (d > 0.05) st.over5++; if (d > 0.15) st.over15++; if (d > 0.4) st.over40++;
      if (d > st.worst) { st.worst = d; st.worstAt = ll(px[s]!, pz[s]!).map((q) => +q.toFixed(6)) as [number, number]; }
    }
    st.worst = +st.worst.toFixed(3);
    report.levels[name] = st; report.ms[name] = Math.round(performance.now() - t0);
    // how far the lowering spreads: each sample of the level's tiles against the clamp at the samples only, by its
    // distance to the clamp's road cells (what it is held under) and to the surfaces drawn
    if (before && !up) {
      const depths: number[] = [], offRoad: number[] = [], worst: [number, number, number, number, number][] = []; let farthest = 0, farthestDrawn = 0, raised = 0, n = 0;
      for (const k of need) {
        const [tx, ty] = k.split('/').map(Number) as [number, number], a = hs.get(k)!, b = (await tileH(before, zz, tx, ty)) ?? blank;
        for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
          const k2 = 32 * 2 ** zz, lon = ((tx * 32 + i) / k2) * 360 - 180, lat = (Math.atan(Math.sinh(Math.PI * (1 - (2 * (ty * 32 + j)) / k2))) * 180) / Math.PI, x = (lon - O[0]) * kx, z = -(lat - O[1]) * KZ;
          // (in a region: only its own samples, the roads round them loaded)
          if (x < rx0 + 40 || x > rx1 - 40 || z < rz0 + 40 || z > rz1 - 40) continue;
          const q = j * N + i, d = b[q]! - a[q]!; n++;
          if (d < -0.05) raised++;
          if (d <= 0.05) continue;
          depths.push(d);
          const fc = nearest(clampSurf(), x, z), fd = nearest(drawn, x, z);
          if (fd > 0.5) offRoad.push(d);
          farthest = Math.max(farthest, fc);
          if (fd > farthestDrawn) farthestDrawn = fd;
          if (worst.length < 8 || fd > worst[worst.length - 1]![2]) { worst.push([+lon.toFixed(6), +lat.toFixed(6), +fd.toFixed(1), +fc.toFixed(1), +d.toFixed(2)]); worst.sort((p, q) => q[2] - p[2]); worst.length = Math.min(8, worst.length); }
        }
      }
      const pc = (a: number[], f: number) => { a.sort((p, q) => p - q); return +(a[Math.min(a.length - 1, Math.floor(a.length * f))] ?? 0).toFixed(2); };
      report.spread[name] = { lowered: depths.length, samples: n, farthest: +farthest.toFixed(1), farthestDrawn: +farthestDrawn.toFixed(1), p50: pc(depths, 0.5), p95: pc(depths, 0.95), most: pc(depths, 1), raised, offRoad: offRoad.length, offP50: pc(offRoad, 0.5), offP95: pc(offRoad, 0.95), offMost: pc(offRoad, 1), farthestAt: worst };
    }
  }
  return report;
}
/** a point's distance to the nearest facet of an index (plan, m) */
function nearest(ix: FacetIndex, x: number, z: number): number {
  for (const r of [2, 8, 32, 128, 512]) { let best = Infinity; for (const f of ix.near(x, z, r)) best = Math.min(best, toTri(f, x, z)); if (best <= r) return best; }
  return Infinity;
}
/** a point's distance to a triangle (plan, m) */
function toTri(f: Facet, x: number, z: number): number {
  if (f.contains(x, z)) return 0;
  let d = Infinity; const p = f.points;
  for (let e = 0; e < 3; e++) { const a = p[e]!, b = p[(e + 1) % 3]!, dx = b[0] - a[0], dz = b[1] - a[1], t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / (dx * dx + dz * dz || 1))); d = Math.min(d, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)); }
  return d;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [dir = `${import.meta.dirname}/../../../data/packs/roads/street`, zooms = '15,16,17,18,19,20', step = '1'] = process.argv.slice(2);
  const region = process.env.REGION ? (process.env.REGION.split(',').map(Number) as [number, number, number, number]) : undefined;
  const r = await groundLevels({ dir, zooms: zooms.split(',').map(Number), step: Number(step), region, standIns: (process.env.UP ?? '').split(',').filter(Boolean).map(Number), kinds: process.env.KINDS?.split(','), under: process.env.UNDER === '0' ? false : undefined, spread: process.env.SPREAD === '1', overhead: process.env.OVERHEAD !== '0' });
  for (const [k, s] of Object.entries(r.levels)) console.log(k.padEnd(12), `samples ${s.samples} · >5cm ${s.over5} · >15cm ${s.over15} · >40cm ${s.over40} · worst ${s.worst.toFixed(2)} m${s.worstAt ? ` at ${s.worstAt.join(',')}` : ''} · ${r.tiles[k]} tiles · ${r.ms[k]} ms`);
  for (const [k, s] of Object.entries(r.spread)) console.log(`${k.padEnd(12)} lowered ${s.lowered} of ${s.samples} samples · farthest from a road cell ${s.farthest} m, from a surface drawn ${s.farthestDrawn} m · depth p50 ${s.p50} p95 ${s.p95} most ${s.most} m · off the roads ${s.offRoad}: p50 ${s.offP50} p95 ${s.offP95} most ${s.offMost} m · raised ${s.raised}`);
  if (process.env.OUT) (await import('node:fs')).writeFileSync(process.env.OUT, JSON.stringify(r, null, 1));
}
