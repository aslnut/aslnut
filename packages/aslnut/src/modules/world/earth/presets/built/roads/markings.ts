import { alongRun, project, type MarkingContext, type Run } from '../../../../../../core/geometry/networks/union.ts';
import type { P3 } from '../../../../../../core/geometry/networks/bake-types.ts';
const LIFT=.035;
export function roadMarkings({I,pieces,runs,regionS,regionJ,levels,ends,ri,nearRoads,H}:MarkingContext):void{
  // ── markings: along the centre lines, on the surface, stopped in the junction zones; none on local streets ──
  const inS = (level: number, x: number, z: number) => regionS.get(level)!.has(x, z), inJ = (level: number, x: number, z: number) => regionJ.get(level)!.has(x, z);
  const at = (r: Run, d: number, u: number): P3 => { const q = alongRun(r, d), x = q.x - q.tz * u, z = q.z + q.tx * u; return [x, z, H(r.level, x, z) + LIFT]; };
  const paintable = (r: Run, d: number, u: number) => { const p = at(r, d, u); return inS(r.level, p[0], p[1]) && !inJ(r.level, p[0], p[1]); };
  for (const r of runs) {
    const c = r.chain, { lanes, oneway, cls } = c.prof, half = r.half, L = r.acc[r.acc.length - 1]!, id = I.roadInfo.get(c) ?? 0;
    if (cls >= 5 || L < 3) continue;
    const line = (u: number, w: number, dash: [number, number] | null) => {
      if (dash) { for (let d = 0.5; d + dash[0] <= L - 0.5; d += dash[0] + dash[1]) if (paintable(r, d, u) && paintable(r, d + dash[0], u) && paintable(r, d + dash[0] / 2, u)) pieces.push({ t: 'strip', kind: 'marking', edges: [[at(r, d, u - w / 2), at(r, d + dash[0], u - w / 2)], [at(r, d, u + w / 2), at(r, d + dash[0], u + w / 2)]], info: id }); return; }
      let ds: number[] = [];
      const flush = () => { if (ds.length > 1) pieces.push({ t: 'strip', kind: 'marking', edges: [ds.map((d) => at(r, d, u - w / 2)), ds.map((d) => at(r, d, u + w / 2))], info: id }); ds = []; };
      for (let d = 0.5; d <= L - 0.5; d += 3) { if (paintable(r, d, u)) ds.push(d); else flush(); }
      flush();
    };
    if (oneway) {
      for (let k = 1; k < lanes; k++) line(-half + (2 * half * k) / lanes, 0.12, [3, 9]);
    } else if (lanes >= 4) { line(-0.15, 0.1, null); line(0.15, 0.1, null); for (let k = 1; k < lanes / 2; k++) { const u = (half * k) / (lanes / 2); line(u, 0.12, [3, 9]); line(-u, 0.12, [3, 9]); } }
    else line(0, 0.12, [3, 9]);
  }
  // where each arm leaves its junction zone (from the node outward), for stop and give-way lines and crossings
  const signals = I.crossings.filter((x) => x.kind === 'traffic_signals');
  const zoneEdge = new Map<string, number>();
  for (const e of ends.values()) {
    if (e.arms.length < 2) continue;
    for (const { run, end } of e.arms) {
      const L = run.acc[run.acc.length - 1]!; let dJ = -1;
      let seen = false; for (let s2 = 0; s2 <= Math.min(L, 80); s2 += 0.5) { const d = end === 0 ? s2 : L - s2, q = alongRun(run, d); if (inJ(run.level, q.x, q.z)) seen = true; else if (seen) { dJ = s2; break; } }
      if (dJ < 0) continue;
      zoneEdge.set(`${ri.get(run)}:${end}`, dJ);
      const c = run.chain, cls = c.prof.cls; if (cls >= 5) continue;
      const nodeAt = end === 0 ? run.pts[0]! : run.pts[run.pts.length - 1]!;
      const lit = signals.some((x) => Math.hypot(x.at[0] - nodeAt[0], x.at[1] - nodeAt[1]) < 30);
      const stop=I.crossings.some(x=>x.kind==='stop'&&Math.hypot(x.at[0]-nodeAt[0],x.at[1]-nodeAt[1])<30),giveWay=I.crossings.some(x=>x.kind==='give_way'&&Math.hypot(x.at[0]-nodeAt[0],x.at[1]-nodeAt[1])<30);
      const minCls = Math.min(...e.arms.map(a => a.run.chain.prof.cls));
      if (!lit && !stop && !giveWay && cls <= minCls) continue;
      // traffic towards the node: its half (keep left); a one-way road leaving the node has none
      if (c.prof.oneway && end === 0) continue;
      // (u is to the right of the run's direction; traffic keeps left: towards a node at the run's end its half is −u,
      // towards a node at its start (against the run) +u; a one-way road, towards its end, all of it)
      const d = end === 0 ? dJ + 0.3 : L - dJ - 0.3, h2 = run.half;
      const [ua, ub] = c.prof.oneway ? [-h2 + 0.2, h2 - 0.2] : end === 0 ? [0.1, h2 - 0.2] : [-h2 + 0.2, -0.1];
      const id = I.roadInfo.get(c) ?? 0;
      if (lit || stop) pieces.push({ t: 'strip', kind: 'marking', edges: [[at(run, d - 0.15, ua), at(run, d - 0.15, ub)], [at(run, d + 0.15, ua), at(run, d + 0.15, ub)]], info: id });
      else for (let u = ua; u + 0.6 <= ub + 0.01; u += 1.2) pieces.push({ t: 'strip', kind: 'marking', edges: [[at(run, d - 0.15, u), at(run, d - 0.15, u + 0.6)], [at(run, d + 0.15, u), at(run, d + 0.15, u + 0.6)]], info: id });
    }
  }
  // zebra crossings from the data: at the zone's edge when they are near a junction, else where they are
  for (const x of I.crossings) {
    if (!(x.kind === 'crossing' && x.marked)) continue;
    let best: { r: Run; d: number; dist: number } | null = null;
    for (const level of levels) { if (level > 0) continue; for (const n of nearRoads(level, x.at[0], x.at[1], 2)) { const pr = project(n.run, x.at[0], x.at[1]); if (pr.dist < 1.5 && (!best || pr.dist < best.dist)) best = { r: n.run, d: pr.d, dist: pr.dist }; } }
    if (!best) continue;
    const r = best.r, L = r.acc[r.acc.length - 1]!, i = ri.get(r)!;
    let d = best.d;
    const e0 = zoneEdge.get(`${i}:0`), e1 = zoneEdge.get(`${i}:1`);
    if (e0 !== undefined && d < e0 + 25) d = e0 + 2; else if (e1 !== undefined && L - d < e1 + 25) d = L - e1 - 2;
    if (d - 1.5 < 0 || d + 1.5 > L || inJ(r.level, alongRun(r, d).x, alongRun(r, d).z)) continue;
    const id = I.roadInfo.get(r.chain) ?? 0;
    for (let u = -r.half + 0.3; u + 0.6 <= r.half - 0.2; u += 1.2) pieces.push({ t: 'strip', kind: 'marking', edges: [[at(r, d - 1.5, u), at(r, d + 1.5, u)], [at(r, d - 1.5, u + 0.6), at(r, d + 1.5, u + 0.6)]], info: id });
  }

}
