import type { P2, RoadWay, RoadGraph, RoadEdge, RoadNode } from '../../../../../../core/geometry/networks/graph.ts';
const D = Math.PI / 180, KZ = 110574;
export function roadGraph(ways: readonly RoadWay[], origin: [number, number]): RoadGraph {
  const kx = 111320 * Math.cos(origin[1] * D);
  const toLocal = (lon: number, lat: number): P2 => [(lon - origin[0]) * kx, -(lat - origin[1]) * KZ];
  const toLonLat = (x: number, z: number): [number, number] => [origin[0] + x / kx, origin[1] - z / KZ];
  // how many ways use each node (and whether it ends one): those split the ways
  const uses = new Map<number, number>();
  for (const w of ways) w.nodes.forEach((n, i) => uses.set(n, (uses.get(n) ?? 0) + (i === 0 || i === w.nodes.length - 1 ? 2 : 1)));
  const nodes = new Map<number, RoadNode>(), edges = new Map<string, RoadEdge>();
  const nodeOf = (id: number, at: P2) => { let n = nodes.get(id); if (!n) nodes.set(id, (n = { id, at, edges: [] })); return n; };
  for (const w of ways) {
    const t = w.tags, layer = Number.parseInt(t.layer ?? '', 10), bridge = !!t.bridge && t.bridge !== 'no', tunnel = !!t.tunnel && t.tunnel !== 'no' && t.tunnel !== 'building_passage';
    const lv = Number.isFinite(layer) ? layer : bridge ? 1 : tunnel ? -1 : 0;
    const oneway = t.oneway === 'yes' || t.oneway === '1' || t.oneway === '-1' || t.junction === 'roundabout' || t.highway === 'motorway' || (t.highway?.endsWith('_link') ?? false) && t.oneway !== 'no';
    const reverse = t.oneway === '-1';
    const ids = reverse ? [...w.nodes].reverse() : w.nodes, pts = reverse ? [...w.pts].reverse() : w.pts;
    let start = 0, k = 0;
    for (let i = 1; i < ids.length; i++) {
      if (i < ids.length - 1 && (uses.get(ids[i]!) ?? 0) < 2) continue;
      const seg = pts.slice(start, i + 1).map(([lo, la]) => toLocal(lo, la)), segIds = ids.slice(start, i + 1);
      if (seg.length >= 2) {
        const id = `${w.id}:${k++}`, a = segIds[0]!, b = segIds[segIds.length - 1]!;
        edges.set(id, { id, way: w.id, tags: t, a, b, pts: seg, nodes: segIds, layer: lv, bridge, tunnel, oneway });
        nodeOf(a, seg[0]!).edges.push(id); nodeOf(b, seg[seg.length - 1]!).edges.push(id);
      }
      start = i;
    }
  }
  return { origin, nodes, edges, toLocal, toLonLat };
}
