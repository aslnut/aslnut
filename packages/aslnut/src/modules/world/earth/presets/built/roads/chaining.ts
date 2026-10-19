// Stages 03 & 04 of the 11-stage road bake:
//   Stage 03: OSM Topological Sanitization, Non-Destructive QA Gate & Degree-2 Way-Chaining
//   Stage 04: Horizontal Alignment — Curvature-Continuous Spline Corners, Arc-Length LUT & Curvature κ_xz(s)
import type { P2, RoadEdge, RoadGraph } from '../../../../../../core/geometry/networks/graph.ts';
import type { StageGate } from '../../../../../../core/runtime/workers/compile/patch-policy.ts';
import { profileOfTags } from './profiles.ts';
import type { Chain, RoadProfile, SolveOptions } from '../../../../../../core/geometry/networks/bake-types.ts';

const angleAt = (p: P2, q: P2, r: P2) => {
  const a = Math.atan2(q[1] - p[1], q[0] - p[0]), b = Math.atan2(r[1] - q[1], r[0] - q[0]);
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return Math.abs(d);
};
const edgeLen = (pts: readonly P2[]) => {
  let l = 0;
  for (let i = 1; i < pts.length; i++) l += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return l;
};

export function runStage03Topology(
  g: RoadGraph,
  opts: SolveOptions = {},
): { chains: Chain[]; jn: Set<number>; gate: StageGate } {
  const prof = new Map<string, RoadProfile>();
  for (const e of g.edges.values()) prof.set(e.id, profileOfTags(e.tags, e.oneway));

  // 1. Detect dangling stubs (< 35 m service / link ways ending at a degree-1 node)
  const stubEdges = new Set<string>();
  const flaggedSet = new Set<string | number>();
  let flaggedDanglingStubs = 0, prunedStubs = 0;
  for (const e of g.edges.values()) {
    const hw = e.tags.highway ?? '';
    if (hw === 'service' || hw.endsWith('_link')) {
      const degA = g.nodes.get(e.a)?.edges.length ?? 0, degB = g.nodes.get(e.b)?.edges.length ?? 0;
      if ((degA === 1 || degB === 1) && edgeLen(e.pts) < 35) {
        flaggedDanglingStubs++;
        flaggedSet.add(e.way);
        if (opts.pruneDanglingStubs) { stubEdges.add(e.id); prunedStubs++; }
      }
    }
  }

  // 2. Junction nodes (3+ incident edges, or 2 edges meeting at > 40° kink)
  const activeEdges = (nid: number) => (g.nodes.get(nid)?.edges ?? []).filter((id) => !stubEdges.has(id));
  const isJunction = (nid: number): boolean => {
    const es = activeEdges(nid);
    return es.length >= 3;
  };
  const jn = new Set<number>();
  for (const id of g.nodes.keys()) if (isJunction(id)) jn.add(id);

  // 3. Degree-2 Way-Chaining from each junction or dead end through plain degree-2 nodes
  const used = new Set<string>(), chains: Chain[] = [];
  let rampTransitions = 0;
  const walk = (start: number, first: RoadEdge): Chain => {
    const edges: RoadEdge[] = [], pts: P2[] = [], point: Chain['point'] = [];
    let node = start, e = first;
    for (;;) {
      used.add(e.id); edges.push(e);
      const fwd = e.a === node, ps = fwd ? e.pts : [...e.pts].reverse(), p = prof.get(e.id)!;
      for (let i = pts.length ? 1 : 0; i < ps.length; i++) {
        pts.push(ps[i]!);
        point.push({ bridge: e.bridge, tunnel: e.tunnel, layer: e.layer, half: p.carriageway / 2 });
      }
      node = fwd ? e.b : e.a;
      if (jn.has(node) || node === start) break;
      const next = activeEdges(node).find((id) => !used.has(id));
      if (!next) break;
      const ne = g.edges.get(next)!;
      if (ne.oneway !== e.oneway || ne.tags.highway !== e.tags.highway || prof.get(ne.id)!.lanes !== p.lanes || ne.tags.junction !== e.tags.junction) break;
      if (ne.oneway && ((ne.a === node) !== fwd)) break;
      if (ne.layer !== e.layer || ne.bridge !== e.bridge || ne.tunnel !== e.tunnel) rampTransitions++;
      e = ne;
    }
    const e0 = edges[0]!, p0 = prof.get(e0.id)!;
    return {
      id: `${e0.id}`, edges, pts, prof: p0, a: start, b: node,
      name: e0.tags.name ?? e0.tags.ref ?? '', ring: node === start, tags: e0.tags, point,
      s: [], kappa: [], roundabout:e0.tags.junction==='roundabout',noSidewalk:/^(no|none)$/.test(e0.tags.sidewalk??''),structure:e0.tags['bridge:structure']??'',speed:parseFloat(e0.tags.maxspeed??'')||80,
    };
  };
  for (const nid of g.nodes.keys()) {
    const es = activeEdges(nid);
    if (!jn.has(nid) && es.length !== 1) continue;
    for (const eid of es) if (!used.has(eid)) chains.push(walk(nid, g.edges.get(eid)!));
  }
  for (const e of g.edges.values()) if (!used.has(e.id) && !stubEdges.has(e.id)) chains.push(walk(e.a, e));

  // Orient one-way chains along direction of travel
  for (const c of chains) {
    if (!c.prof.oneway) continue;
    const e = c.edges[0]!, fwd = c.a === e.a;
    if (!fwd) { c.pts.reverse(); const pp=c.point.slice(1).reverse(); c.point=[pp[0]!,...pp]; [c.a, c.b] = [c.b, c.a]; }
  }

  // 4. Non-destructive QA inspection (and optional simplification / hairpin relaxation when options are enabled)
  let flaggedMicroSegments = 0, flaggedAcuteKinks = 0, flaggedHairpins = 0;
  let simplifiedSegments = 0, relaxedHairpins = 0, duplicateNodes = 0;
  let worstKinkDeg = 0, shortestSegmentM = Infinity;

  for (const c of chains) {
    const wayId = c.edges[0]?.way ?? c.id;
    for (let i = 0; i + 1 < c.pts.length; i++) {
      const segLen = Math.hypot(c.pts[i + 1]![0] - c.pts[i]![0], c.pts[i + 1]![1] - c.pts[i]![1]);
      if (segLen < 1e-6) duplicateNodes++;
      if (segLen < shortestSegmentM) shortestSegmentM = segLen;
      if (segLen < 18 && c.pts.length > 2) { flaggedMicroSegments++; flaggedSet.add(wayId); }
    }
    if (opts.simplifyShortSegments && c.pts.length > 2 && !c.ring) {
      const nPts: P2[] = [c.pts[0]!], nPt: Chain['point'] = [c.point[0]!];
      for (let i = 1; i < c.pts.length - 1; i++) {
        const a=nPts[nPts.length-1]!, b=c.pts[i+1]!, q=c.pts[i]!,dx=b[0]-a[0],dz=b[1]-a[1],f=Math.max(0,Math.min(1,((q[0]-a[0])*dx+(q[1]-a[1])*dz)/(dx*dx+dz*dz||1))),deviation=Math.hypot(q[0]-a[0]-f*dx,q[1]-a[1]-f*dz),pp=c.point[i]!,np=c.point[i+1]!;
        if (Math.hypot(q[0]-a[0],q[1]-a[1])>=18||deviation>.35||pp.layer!==np.layer||pp.bridge!==np.bridge||pp.tunnel!==np.tunnel||pp.half!==np.half) {
          nPts.push(c.pts[i]!); nPt.push(c.point[i]!);
        } else simplifiedSegments++;
      }
      nPts.push(c.pts[c.pts.length - 1]!); nPt.push(c.point[c.point.length - 1]!);
      c.pts = nPts; c.point = nPt;
    }
    for (let i = 1; i + 1 < c.pts.length; i++) {
      const p = c.pts[i - 1]!, q = c.pts[i]!, r = c.pts[i + 1]!;
      const l1 = Math.hypot(q[0] - p[0], q[1] - p[1]), l2 = Math.hypot(r[0] - q[0], r[1] - q[1]);
      if (l1 < 1e-4 || l2 < 1e-4) continue;
      const degTurn = (angleAt(p, q, r) * 180) / Math.PI;
      if (degTurn > worstKinkDeg) worstKinkDeg = degTurn;
      if (degTurn > 85 && !c.ring) { flaggedAcuteKinks++; flaggedSet.add(wayId); }
      const rEst = Math.min(l1, l2) / (2 * Math.max(0.05, Math.sin((degTurn * Math.PI) / 360)));
      if (rEst < 15 && degTurn > 45 && !c.ring) {
        flaggedHairpins++; flaggedSet.add(wayId);
        if (opts.relaxHairpins) {
          c.pts[i] = [0.25 * p[0] + 0.5 * q[0] + 0.25 * r[0], 0.25 * p[1] + 0.5 * q[1] + 0.25 * r[1]];
          relaxedHairpins++;
        }
      }
    }
  }

  const errors: string[] = [];
  if (chains.length === 0 && g.edges.size > 0) errors.push('Stage 03: 0 chains produced from non-empty road graph');
  if (duplicateNodes > 0) errors.push(`Stage 03: ${duplicateNodes} duplicate consecutive vertices remain`);

  return {
    chains,
    jn,
    gate: {
      stage: 3,
      id: 'topology-qa-chaining',
      name: 'OSM Topological Sanitization, QA Gate & Degree-2 Way-Chaining',
      ok: errors.length === 0,
      counts: {
        rawEdges: g.edges.size,
        chainedCorridors: chains.length,
        junctionNodes: jn.size,
        rampTransitions,
        flaggedMicroSegments,
        flaggedAcuteKinks,
        flaggedDanglingStubs,
        flaggedHairpins,
        prunedStubs,
        simplifiedSegments,
        relaxedHairpins,
        duplicateNodes,
      },
      worst: {
        worstKinkDeg: +worstKinkDeg.toFixed(1),
        shortestSegmentM: Number.isFinite(shortestSegmentM) ? +shortestSegmentM.toFixed(2) : 0,
      },
      flagged: [...flaggedSet],
      errors,
    },
  };
}

