// core › geometry › networks: a graph made from lines (streets, paths, pipes), and what is asked of it. Ends and
// vertices closer than `snap` metres become one node, so pieces cut at tile edges and crossings join up. Shortest
// paths from one place or from many at once (multi-source Dijkstra: every house's walk to its nearest park entrance in
// one pass), the nearest point of the network to a place, the way back along a route, and the places reached within a
// cost (isochrones). A line may go one way only (`oneway`: a one-way street, a roundabout): the costs then run the way
// asked (from the sources, or `toward` them: the way to a destination from everywhere).
//   const net = network({ lines, keep: (p) => p.cls !== 0 })
//   const r = net.route([145.12, -37.92], [145.13, -37.91])          → { cost, line: [lon, lat][] }
//   const all = net.shortest(entrances.map((p) => ({ at: p, cost: 0 })))  then all.costAt(house)
//   network({ lines, oneway: (p) => p.oneway === 'yes' })  ·  net.shortest([{ node: d }], { toward: true }).prev  the next node to d
//   net.isochrone([145.12, -37.92], [400, 800])                       → polygons (features)
//   net.isochrone(all, [400, 800])                                    → the same from a pass already made (no pass again)
import type { Feature } from '../../data/features.ts';
import { AslnutError } from '../../world/errors.ts';

export type LonLat = [number, number];
export interface NetworkLine<P = Record<string, unknown>> { line: readonly LonLat[]; props?: P }
export interface NetworkOptions<P> {
  /** the lines: [lon, lat] points with their props */
  lines: readonly NetworkLine<P>[];
  /** metres within which points join into one node (default 1) */
  snap?: number;
  /** keep a line (its props): no freeways for walking */
  keep?: (props: P) => boolean;
  /** the cost of going along a piece of a line, from its length in metres and its props (default: the length) */
  cost?: (metres: number, props: P) => number;
  /** a line gone one way only (its props): true or 1 along its points, -1 against them, false or 0 both ways (default:
   *  every line both ways) */
  oneway?: (props: P) => boolean | number | null | undefined;
}
export interface Nearest {
  /** the piece's ends (nodes) */ a: number; b: number; /** the point on it */ at: LonLat; /** metres from the place to it */ distance: number; /** cost from the point to a, to b */ toA: number; toB: number;
  /** the way the piece may be gone: 0 both, 1 from a to b only, -1 from b to a only */
  way: number;
}
export interface Shortest {
  /** cost from the nearest source to each node (Infinity: unreachable) */
  dist: Float64Array;
  /** the node before each on its way back to its source (-1: a source) */
  prev: Int32Array;
  /** which source each node is reached from (-1: none) */
  origin: Int32Array;
  /** the cost from a place (joined to the network at its nearest point, the walk to it counted) to its nearest source */
  costAt(at: LonLat, o?: { max?: number }): number;
  /** the way from a place back to its nearest source: [lon, lat] points, the place first */
  pathFrom(at: LonLat, o?: { max?: number }): LonLat[] | null;
}

const D = Math.PI / 180;
class Heap {
  private k: number[] = []; private v: number[] = [];
  get size(): number { return this.k.length; }
  push(key: number, val: number): void {
    const k = this.k, v = this.v; let i = k.length; k.push(key); v.push(val);
    while (i > 0) { const p = (i - 1) >> 1; if (k[p]! <= key) break; k[i] = k[p]!; v[i] = v[p]!; i = p; }
    k[i] = key; v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k, v = this.v, top: [number, number] = [k[0]!, v[0]!], lk = k.pop()!, lv = v.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) { const l = i * 2 + 1, r = l + 1; let m = i, mk = lk; if (l < k.length && k[l]! < mk) { m = l; mk = k[l]!; } if (r < k.length && k[r]! < mk) { m = r; mk = k[r]!; } if (m === i) break; k[i] = k[m]!; v[i] = v[m]!; i = m; }
      k[i] = lk; v[i] = lv;
    }
    return top;
  }
}

export class Network<P = Record<string, unknown>> {
  /** node places in local metres (x east, z south) round the network's middle, and as lon / lat */
  readonly xs: number[] = []; readonly zs: number[] = [];
  /** per node: neighbour, cost, neighbour, cost … (the pieces one may go along from it) */
  readonly adj: number[][] = [];
  /** per node: the pieces one may come along to it (neighbour, cost …): adj itself when every line goes both ways */
  readonly radj: number[][];
  /** pieces: node a, node b, the line's index */
  readonly pieces: number[] = [];
  /** each piece's cost, and its way (0 both, 1 a → b only, -1 b → a only; empty: every piece both ways) */
  readonly pieceCost: number[] = []; readonly pieceWay: number[] = [];
  readonly lines: readonly NetworkLine<P>[];
  private lon0 = 0; private lat0 = 0; private kx = 1; private grid = new Map<string, number[]>(); private cell = 60;
  constructor(o: NetworkOptions<P>) {
    if (!Array.isArray(o?.lines)) throw new AslnutError('E-DATA-001', 'network needs lines', { fix: 'network({ lines: [{ line: [[lon, lat], …], props }] })' });
    this.lines = o.lines;
    let n = 0; for (const l of o.lines) for (const p of l.line) { this.lon0 += p[0]; this.lat0 += p[1]; n++; }
    if (n) { this.lon0 /= n; this.lat0 /= n; }
    this.kx = 111320 * Math.cos(this.lat0 * D);
    const snap = o.snap ?? 1, ids = new Map<string, number>();
    const node = (x: number, z: number) => {
      const k = `${Math.round(x / snap)}_${Math.round(z / snap)}`; let id = ids.get(k);
      if (id === undefined) { id = this.xs.length; ids.set(k, id); this.xs.push(x); this.zs.push(z); this.adj.push([]); }
      return id;
    };
    o.lines.forEach((l, li) => {
      const props = (l.props ?? {}) as P;
      if (o.keep && !o.keep(props)) return;
      // (its way: 1 along its points, -1 against them, 0 both)
      const ow = o.oneway ? o.oneway(props) : 0, way = ow === true || (typeof ow === 'number' && ow > 0) ? 1 : typeof ow === 'number' && ow < 0 ? -1 : 0;
      let prev = -1;
      for (const p of l.line) {
        const [x, z] = this.local(p), cur = node(x, z);
        if (prev >= 0 && cur !== prev) {
          const len = Math.hypot(this.xs[cur]! - this.xs[prev]!, this.zs[cur]! - this.zs[prev]!), c = o.cost ? o.cost(len, props) : len;
          if (way >= 0) this.adj[prev]!.push(cur, c);
          if (way <= 0) this.adj[cur]!.push(prev, c);
          this.pieces.push(prev, cur, li); this.pieceCost.push(c); if (o.oneway) this.pieceWay.push(way);
        }
        prev = cur;
      }
    });
    // the pieces coming to each node (the way to a destination is found along them, backwards)
    if (this.pieceWay.some((w) => w !== 0)) {
      this.radj = this.adj.map(() => []);
      this.adj.forEach((nb, u) => { for (let k = 0; k < nb.length; k += 2) this.radj[nb[k]!]!.push(u, nb[k + 1]!); });
    } else this.radj = this.adj;
    // a grid over the pieces: the nearest piece to a place
    for (let s = 0; s < this.pieces.length; s += 3) {
      const a = this.pieces[s]!, b = this.pieces[s + 1]!;
      for (let cx = Math.floor(Math.min(this.xs[a]!, this.xs[b]!) / this.cell); cx <= Math.floor(Math.max(this.xs[a]!, this.xs[b]!) / this.cell); cx++)
        for (let cz = Math.floor(Math.min(this.zs[a]!, this.zs[b]!) / this.cell); cz <= Math.floor(Math.max(this.zs[a]!, this.zs[b]!) / this.cell); cz++) {
          const k = `${cx}_${cz}`; let l = this.grid.get(k); if (!l) this.grid.set(k, (l = [])); l.push(s);
        }
    }
  }
  /** nodes and pieces */
  get size(): { nodes: number; pieces: number } { return { nodes: this.xs.length, pieces: this.pieces.length / 3 }; }
  /** a place → local metres (x east, z south) */
  local(p: LonLat): [number, number] { return [(p[0] - this.lon0) * this.kx, -(p[1] - this.lat0) * 110574]; }
  /** local metres → [lon, lat] */
  lonLat(x: number, z: number): LonLat { return [this.lon0 + x / this.kx, this.lat0 - z / 110574]; }
  /** the nearest point of the network to a place (within `max` metres, default 300) */
  nearest(at: LonLat, o: { max?: number } = {}): Nearest | null {
    const [x, z] = this.local(at), max = o.max ?? 300, hx = Math.floor(x / this.cell), hz = Math.floor(z / this.cell);
    let best: Nearest | null = null, bd = Infinity;
    for (let ring = 0; ring * this.cell <= max + this.cell; ring++) {
      for (let cx = hx - ring; cx <= hx + ring; cx++) for (let cz = hz - ring; cz <= hz + ring; cz++) {
        if (Math.max(Math.abs(cx - hx), Math.abs(cz - hz)) !== ring) continue;
        for (const s of this.grid.get(`${cx}_${cz}`) ?? []) {
          const a = this.pieces[s]!, b = this.pieces[s + 1]!, ax = this.xs[a]!, az = this.zs[a]!, dx = this.xs[b]! - ax, dz = this.zs[b]! - az, l2 = dx * dx + dz * dz || 1;
          const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / l2)), px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
          if (d < bd) { bd = d; const L = Math.sqrt(l2), c = this.pieceCost[s / 3]! / Math.max(1e-9, L); best = { a, b, at: this.lonLat(px, pz), distance: d, toA: t * L * c, toB: (1 - t) * L * c, way: this.pieceWay[s / 3] ?? 0 }; }
        }
      }
      if (best && bd <= ring * this.cell) break;
    }
    return best && bd <= max ? best : null;
  }
  /** shortest costs from many sources at once (a source: a place joined at its nearest point, or a node), each node
   *  reached from its nearest source; `toward`: the costs from each node to its nearest source, `prev` the next node on
   *  the way there (the same as from them where every line goes both ways) */
  shortest(sources: readonly ({ at: LonLat; cost?: number } | { node: number; cost?: number })[], o: { max?: number; toward?: boolean } = {}): Shortest {
    const n = this.xs.length, dist = new Float64Array(n).fill(Infinity), prev = new Int32Array(n).fill(-1), origin = new Int32Array(n).fill(-1), heap = new Heap();
    const start = (node: number, c: number, i: number) => { if (c < dist[node]!) { dist[node] = c; origin[node] = i; prev[node] = -1; heap.push(c, node); } };
    // a place on a one-way piece: from it (outward) only the way the piece goes; to it (toward) only from where it comes
    const T = !!o.toward, adj = T ? this.radj : this.adj;
    sources.forEach((s, i) => {
      if ('node' in s) { start(s.node, s.cost ?? 0, i); return; }
      const near = this.nearest(s.at, { max: o.max }); if (!near) return;
      if (T ? near.way !== -1 : near.way !== 1) start(near.a, (s.cost ?? 0) + near.distance + near.toA, i);
      if (T ? near.way !== 1 : near.way !== -1) start(near.b, (s.cost ?? 0) + near.distance + near.toB, i);
    });
    while (heap.size) {
      const [d, u] = heap.pop(); if (d > dist[u]!) continue;
      const nb = adj[u]!;
      for (let k = 0; k < nb.length; k += 2) { const v = nb[k]!, nd = d + nb[k + 1]!; if (nd < dist[v]!) { dist[v] = nd; prev[v] = u; origin[v] = origin[u]!; heap.push(nd, v); } }
    }
    const via = (at: LonLat, max?: number) => {
      const near = this.nearest(at, { max }); if (!near) return null;
      const ca = (T ? near.way !== 1 : near.way !== -1) ? dist[near.a]! + near.toA : Infinity, cb = (T ? near.way !== -1 : near.way !== 1) ? dist[near.b]! + near.toB : Infinity;
      return { near, node: ca <= cb ? near.a : near.b, cost: near.distance + Math.min(ca, cb) };
    };
    return {
      dist, prev, origin,
      costAt: (at, oo = {}) => { const v = via(at, oo.max); return v ? v.cost : Infinity; },
      pathFrom: (at, oo = {}) => {
        const v = via(at, oo.max); if (!v || !Number.isFinite(v.cost)) return null;
        const out: LonLat[] = [at, v.near.at]; let u = v.node, guard = 0;
        while (u >= 0 && guard++ < 100000) { out.push(this.lonLat(this.xs[u]!, this.zs[u]!)); u = prev[u]!; }
        return out;
      },
    };
  }
  /** the cheapest way from one place to another: its cost and its line; null when they are not joined */
  route(from: LonLat, to: LonLat, o: { max?: number } = {}): { cost: number; line: LonLat[] } | null {
    // (the costs toward `to`: one-way pieces gone their way)
    const s = this.shortest([{ at: to }], { ...o, toward: true }), line = s.pathFrom(from, o), cost = s.costAt(from, o);
    // two places on one piece: straight along it, when it may be gone that way and that is cheaper
    const nf = this.nearest(from, o), nt = this.nearest(to, o);
    if (nf && nt && nf.a === nt.a && nf.b === nt.b && (nt.toA >= nf.toA ? nf.way !== -1 : nf.way !== 1)) {
      const direct = nf.distance + Math.abs(nt.toA - nf.toA) + nt.distance;
      if (!(direct >= cost)) return { cost: direct, line: [from, nf.at, nt.at, to] };
    }
    if (!line) return null;
    line.push(to);
    return { cost, line };
  }
  /** the cost from each of `from` to each of `to` along the network: rows by `from` (Infinity: not reachable) */
  matrix(from: readonly LonLat[], to: readonly LonLat[], o: { max?: number } = {}): number[][] {
    return from.map((f) => { const s = this.shortest([{ at: f }], o); return to.map((t) => s.costAt(t, o)); });
  }
  /** where one gets within each cost from a place (or places): per band, smooth outlines of the ground within reach.
   *  The network's costs, spread `reach` metres off it (at `off` cost a metre: walking off the street), on a grid of
   *  `cell` metres, contoured (marching squares); a band may be several areas (MultiPolygon). `from` may be a pass
   *  already made (`net.shortest(…)`): its costs are used as they are, no pass made again */
  isochrone(from: LonLat | readonly LonLat[] | readonly ({ at: LonLat; cost?: number } | { node: number; cost?: number })[] | Shortest, within: readonly number[], o: { max?: number; cell?: number; reach?: number; off?: number } = {}): Feature[] {
    let s: Shortest;
    if (isShortest(from)) {
      if (from.dist.length !== this.xs.length) throw new AslnutError('E-DATA-001', `isochrone: the pass given has ${from.dist.length} nodes, this network ${this.xs.length}`, { fix: 'give a pass made by this network: net.isochrone(net.shortest(sources), [400, 800])' });
      s = from;
    } else {
      // a place, places, or sources as for shortest (a node or a place, each with the cost it starts at)
      const list = (Array.isArray(from[0]) || (from.length && typeof from[0] === 'object') ? from : [from]) as (LonLat | { at: LonLat; cost?: number } | { node: number; cost?: number })[];
      s = this.shortest(list.map((x) => (Array.isArray(x) ? { at: x as LonLat } : x as { node: number; cost?: number })), o);
    }
    const out: Feature[] = [];
    const top = Math.max(...within), cell = o.cell ?? 25, reach = o.reach ?? 60, off = o.off ?? 1.2;
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < this.xs.length; i++) if (s.dist[i]! <= top) { x0 = Math.min(x0, this.xs[i]!); x1 = Math.max(x1, this.xs[i]!); z0 = Math.min(z0, this.zs[i]!); z1 = Math.max(z1, this.zs[i]!); }
    if (!Number.isFinite(x0)) return out;
    x0 -= reach + cell; z0 -= reach + cell; x1 += reach + cell; z1 += reach + cell;
    const W = Math.ceil((x1 - x0) / cell) + 1, H = Math.ceil((z1 - z0) / cell) + 1, g = new Float32Array(W * H).fill(Infinity), r = Math.ceil(reach / cell);
    // the cost at each grid point: the cheapest point along the reached pieces near it, plus the walk off the street
    const splat = (px: number, pz: number, d: number) => {
      const ci = Math.round((px - x0) / cell), cj = Math.round((pz - z0) / cell);
      for (let j = Math.max(0, cj - r); j <= Math.min(H - 1, cj + r); j++) for (let i = Math.max(0, ci - r); i <= Math.min(W - 1, ci + r); i++) {
        const dd = Math.hypot(x0 + i * cell - px, z0 + j * cell - pz); if (dd > reach) continue;
        const v = d + dd * off; if (v < g[j * W + i]!) g[j * W + i] = v;
      }
    };
    for (let q = 0; q < this.pieces.length; q += 3) {
      const a = this.pieces[q]!, b = this.pieces[q + 1]!, da = s.dist[a]!, db = s.dist[b]!; if (!(Math.min(da, db) <= top)) continue;
      const len = Math.hypot(this.xs[b]! - this.xs[a]!, this.zs[b]! - this.zs[a]!), c = this.pieceCost[q / 3] ?? len;
      const steps = Math.max(1, Math.ceil(len / (cell * 0.75)));
      for (let k = 0; k <= steps; k++) { const t = k / steps, d = Math.min(da + t * c, db + (1 - t) * c); if (d <= top) splat(this.xs[a]! + (this.xs[b]! - this.xs[a]!) * t, this.zs[a]! + (this.zs[b]! - this.zs[a]!) * t, d); }
    }
    for (let n = 0; n < this.xs.length; n++) { const d = s.dist[n]!; if (d <= top && !this.adj[n]!.length && !this.radj[n]!.length) splat(this.xs[n]!, this.zs[n]!, d); }
    for (const limit of [...within].sort((a, b) => b - a)) {
      const rings = contour(g, W, H, limit).map((ring) => ring.map(([i, j]) => this.lonLat(x0 + i * cell, z0 + j * cell)));
      if (!rings.length) continue;
      // a ring inside another is its hole (an unreached block inside the reach), inside a hole an area again
      const area = (rg: LonLat[]) => { let a = 0; for (let k = 0, m = rg.length - 1; k < rg.length; m = k++) a += (rg[m]![0] + rg[k]![0]) * (rg[m]![1] - rg[k]![1]); return Math.abs(a / 2); };
      const ins = (p: LonLat, rg: LonLat[]) => { let c = false; for (let a = 0, bb = rg.length - 1; a < rg.length; bb = a++) { const [xa, ya] = rg[a]!, [xb, yb] = rg[bb]!; if ((ya > p[1]) !== (yb > p[1]) && p[0] < ((xb - xa) * (p[1] - ya)) / (yb - ya) + xa) c = !c; } return c; };
      const sorted = rings.filter((rg) => rg.length >= 4).sort((p1, p2) => area(p2) - area(p1)), polys: LonLat[][][] = [], owner: number[] = [];
      sorted.forEach((rg, k) => {
        let depth = 0, outer = -1;
        for (let m = 0; m < k; m++) if (ins(rg[0]!, sorted[m]!)) { depth++; if (outer < 0 || area(sorted[m]!) < area(sorted[outer]!)) outer = m; }
        if (depth % 2 === 1 && outer >= 0 && owner[outer]! >= 0) { polys[owner[outer]!]!.push(rg); owner[k] = -1; } else { owner[k] = polys.length; polys.push([rg]); }
      });
      out.push({ id: `within-${limit}`, props: { within: limit, areas: polys.length }, geometry: polys.length === 1 ? { type: 'Polygon', coordinates: polys[0]! } : { type: 'MultiPolygon', coordinates: polys } });
    }
    return out;
  }
}
/** a pass made by `shortest` (its costs per node, the way back) */
const isShortest = (x: unknown): x is Shortest => !!x && typeof x === 'object' && !Array.isArray(x) && (x as Shortest).dist instanceof Float64Array && (x as Shortest).prev instanceof Int32Array;
/** a graph from lines: shortest paths, the nearest point, routes, isochrones */
export const network = <P = Record<string, unknown>>(o: NetworkOptions<P>) => new Network<P>(o);

/** the outlines where a grid's values cross `level` (marching squares, the inside below it): closed rings of grid
 *  coordinates; outside the grid counts as above */
export function contour(g: Float32Array, W: number, H: number, level: number): [number, number][][] {
  const v = (i: number, j: number) => (i < 0 || j < 0 || i >= W || j >= H ? Infinity : g[j * W + i]!);
  const lerp = (a: number, b: number) => (!Number.isFinite(a) || !Number.isFinite(b) ? 0.5 : Math.max(0, Math.min(1, (level - a) / (b - a))));
  // a segment per cell; ends keyed by their edge (shared with the cell next to it)
  const segs = new Map<string, { a: string; b: string; pa: [number, number]; pb: [number, number] }[]>();
  const edge = (i: number, j: number, side: 0 | 1 | 2 | 3): [string, [number, number]] => {
    const a00 = v(i, j), a10 = v(i + 1, j), a11 = v(i + 1, j + 1), a01 = v(i, j + 1);
    if (side === 0) return [`h${i},${j}`, [i + lerp(a00, a10), j]];
    if (side === 1) return [`v${i + 1},${j}`, [i + 1, j + lerp(a10, a11)]];
    if (side === 2) return [`h${i},${j + 1}`, [i + lerp(a01, a11), j + 1]];
    return [`v${i},${j}`, [i, j + lerp(a00, a01)]];
  };
  const add = (i: number, j: number, s1: 0 | 1 | 2 | 3, s2: 0 | 1 | 2 | 3) => { const [ka, pa] = edge(i, j, s1), [kb, pb] = edge(i, j, s2), sg = { a: ka, b: kb, pa, pb }; for (const k of [ka, kb]) { let l = segs.get(k); if (!l) segs.set(k, (l = [])); l.push(sg); } };
  for (let j = -1; j < H; j++) for (let i = -1; i < W; i++) {
    const c = (v(i, j) < level ? 1 : 0) | (v(i + 1, j) < level ? 2 : 0) | (v(i + 1, j + 1) < level ? 4 : 0) | (v(i, j + 1) < level ? 8 : 0);
    switch (c) {
      case 1: case 14: add(i, j, 3, 0); break;
      case 2: case 13: add(i, j, 0, 1); break;
      case 3: case 12: add(i, j, 3, 1); break;
      case 4: case 11: add(i, j, 1, 2); break;
      case 6: case 9: add(i, j, 0, 2); break;
      case 7: case 8: add(i, j, 3, 2); break;
      case 5: add(i, j, 3, 0); add(i, j, 1, 2); break;
      case 10: add(i, j, 0, 1); add(i, j, 3, 2); break;
    }
  }
  // stitch the segments into rings
  const used = new Set<object>(), rings: [number, number][][] = [];
  for (const list of segs.values()) for (const sg of list) {
    if (used.has(sg)) continue;
    used.add(sg);
    const ring: [number, number][] = [sg.pa, sg.pb]; let key = sg.b;
    for (let guard = 0; guard < 1e6; guard++) {
      const next = (segs.get(key) ?? []).find((x) => !used.has(x)); if (!next) break;
      used.add(next);
      if (next.a === key) { ring.push(next.pb); key = next.b; } else { ring.push(next.pa); key = next.a; }
    }
    if (ring.length >= 4) { const f = ring[0]!, l = ring[ring.length - 1]!; if (f[0] !== l[0] || f[1] !== l[1]) ring.push(f); rings.push(ring); }
  }
  return rings;
}
