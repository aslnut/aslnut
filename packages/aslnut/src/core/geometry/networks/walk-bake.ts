// tools › compile › steps › walk: the walking graph from the baked footpaths. Its lines (each footpath's middle, the
// crossings, the links from each kerb ramp to its footpath, the paths through parks) joined into a graph: every line
// cut where it crosses another, every end within `snap` of another line joined to it (a short link), the ends written
// to the centimetre so a network joins them exactly (core › geometry › networks: network({ lines, snap: 0.05 })).
import type { WalkLine } from './union.ts';

type P2 = [number, number];
export interface WalkEdge { kind: WalkLine['kind']; pts: P2[] }
export interface WalkReport { lines: number; edges: number; crossings: number; joined: number; length: number }

export function walkGraph(lines: readonly WalkLine[], o: { snap?: number } = {}): { edges: WalkEdge[]; report: WalkReport } {
  const snap = o.snap ?? 3, CELL = 20;
  const L = lines.filter((l) => l.pts.length > 1).map((l) => ({ kind: l.kind, pts: l.pts.map((p) => [p[0], p[1]] as P2), cuts: [] as { i: number; t: number; p: P2 }[] }));
  // every segment in a grid
  const grid = new Map<string, { l: number; i: number }[]>();
  const key = (x: number, z: number) => `${Math.floor(x / CELL)},${Math.floor(z / CELL)}`;
  L.forEach((l, li) => { for (let i = 1; i < l.pts.length; i++) { const a = l.pts[i - 1]!, b = l.pts[i]!; for (let cx = Math.floor(Math.min(a[0], b[0]) / CELL); cx <= Math.floor(Math.max(a[0], b[0]) / CELL); cx++) for (let cz = Math.floor(Math.min(a[1], b[1]) / CELL); cz <= Math.floor(Math.max(a[1], b[1]) / CELL); cz++) { const k = `${cx},${cz}`; let g = grid.get(k); if (!g) grid.set(k, (g = [])); g.push({ l: li, i }); } } });
  const near = (x: number, z: number, r: number) => { const out = new Set<string>(), res: { l: number; i: number }[] = []; for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) for (const s of grid.get(`${cx},${cz}`) ?? []) { const k = `${s.l}:${s.i}`; if (!out.has(k)) { out.add(k); res.push(s); } } return res; };
  const seg = (l: number, i: number) => [L[l]!.pts[i - 1]!, L[l]!.pts[i]!] as const;
  // where lines cross: a cut on both
  let crossings = 0;
  const seen = new Set<string>();
  L.forEach((l, li) => { for (let i = 1; i < l.pts.length; i++) {
    const [a, b] = seg(li, i);
    for (const s of near((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, Math.hypot(b[0] - a[0], b[1] - a[1]) / 2 + 0.1)) {
      if (s.l === li && Math.abs(s.i - i) <= 1) continue;
      const k = li < s.l || (li === s.l && i < s.i) ? `${li}:${i}|${s.l}:${s.i}` : `${s.l}:${s.i}|${li}:${i}`; if (seen.has(k)) continue; seen.add(k);
      const [c, d] = seg(s.l, s.i), hit = cross(a, b, c, d); if (!hit) continue;
      l.cuts.push({ i, t: hit.t, p: hit.p }); L[s.l]!.cuts.push({ i: s.i, t: hit.u, p: hit.p }); crossings++;
    }
  } });
  // an end within `snap` of another line (not crossing it): joined to it by a short link, the other line cut there
  const links: WalkEdge[] = []; let joined = 0;
  L.forEach((l, li) => { for (const e of [0, l.pts.length - 1]) {
    const p = l.pts[e]!; let best: { l: number; i: number; t: number; q: P2; d: number } | null = null;
    for (const s of near(p[0], p[1], snap)) {
      if (s.l === li) continue;
      const [a, b] = seg(s.l, s.i), dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dz) / L2)), q: P2 = [a[0] + dx * t, a[1] + dz * t], d = Math.hypot(q[0] - p[0], q[1] - p[1]);
      if (d <= snap && (!best || d < best.d)) best = { l: s.l, i: s.i, t, q, d };
    }
    if (!best) continue;
    L[best.l]!.cuts.push({ i: best.i, t: best.t, p: best.q });
    if (best.d > 0.01) links.push({ kind: 'link', pts: [p, best.q] });
    joined++;
  } });
  // each line cut at its cuts: the edges, their ends to the centimetre
  const r2 = (p: P2): P2 => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100];
  const edges: WalkEdge[] = [];
  for (const l of L) {
    const cuts = l.cuts.sort((x, y) => x.i - y.i || x.t - y.t);
    let cur: P2[] = [r2(l.pts[0]!)], c = 0;
    for (let i = 1; i < l.pts.length; i++) {
      while (c < cuts.length && cuts[c]!.i === i) { const p = r2(cuts[c]!.p); const last = cur[cur.length - 1]!; if (p[0] !== last[0] || p[1] !== last[1]) cur.push(p); if (cur.length > 1) edges.push({ kind: l.kind, pts: cur }); cur = [p]; c++; }
      const q = r2(l.pts[i]!), last = cur[cur.length - 1]!; if (q[0] !== last[0] || q[1] !== last[1]) cur.push(q);
    }
    if (cur.length > 1) edges.push({ kind: l.kind, pts: cur });
  }
  for (const k of links) edges.push({ kind: 'link', pts: k.pts.map(r2) });
  let length = 0; for (const e of edges) for (let i = 1; i < e.pts.length; i++) length += Math.hypot(e.pts[i]![0] - e.pts[i - 1]![0], e.pts[i]![1] - e.pts[i - 1]![1]);
  return { edges, report: { lines: L.length, edges: edges.length, crossings, joined, length: Math.round(length) } };
}
function cross(a: P2, b: P2, c: P2, d: P2): { t: number; u: number; p: P2 } | null {
  const rx = b[0] - a[0], rz = b[1] - a[1], sx = d[0] - c[0], sz = d[1] - c[1], den = rx * sz - rz * sx; if (Math.abs(den) < 1e-9) return null;
  const t = ((c[0] - a[0]) * sz - (c[1] - a[1]) * sx) / den, u = ((c[0] - a[0]) * rz - (c[1] - a[1]) * rx) / den;
  if (t <= 0 || t >= 1 || u <= 0 || u >= 1) return null;
  return { t, u, p: [a[0] + rx * t, a[1] + rz * t] };
}
