// core › geometry › networks › walkways: the footpaths as their own network. Each section's footpaths (their middle
// lines, cut back at the junctions) and the footpaths round each junction's corners, joined end to end: the lines a
// walking graph is made of (network({ lines }): routes and park access along the footpaths, not the carriageways).
// Places are metres in one plane (x east, z south).
//   const lines = walkways(sections, junctions)
import { cut, lengthOf, type P2, type Section } from './sections.ts';
import type { Junction } from './junctions.ts';

/** a footpath's middle line, its section (or junction) and side */
export interface Walkway { line: P2[]; of: string; side: 'left' | 'right' | 'corner'; width: number }
export function walkways(sections: readonly Section[], junctions: readonly Junction[] = []): Walkway[] {
  const out: Walkway[] = [];
  for (const s of sections) {
    const L = lengthOf(s.pts), p = s.profile, line = cut(s.pts, s.trim[0], L - s.trim[1]); if (line.length < 2) continue;
    for (const side of ['left', 'right'] as const) {
      const v = p[side]; if (!(v.footpath > 0)) continue;
      const d = p.carriageway / 2 + v.kerb + v.strip + v.footpath / 2;
      out.push({ line: offsetLine(line, side === 'left' ? -d : d), of: s.id, side, width: v.footpath });
    }
  }
  for (const j of junctions) for (const c of j.corners) {
    const f = c.bands.find((b) => b.kind === 'footpath'); if (!f) continue;
    out.push({ line: f.inner.map((p, i) => [(p[0] + f.outer[i]![0]) / 2, (p[1] + f.outer[i]![1]) / 2]), of: j.key, side: 'corner', width: Math.hypot(f.outer[0]![0] - f.inner[0]![0], f.outer[0]![1] - f.inner[0]![1]) });
  }
  return out;
}
/** a line moved sideways (positive: to the right of its direction, x east, z south), the corners mitred */
export function offsetLine(pts: readonly P2[], d: number): P2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)]!, b = pts[Math.min(pts.length - 1, i + 1)]!, l = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    return [p[0] - ((b[1] - a[1]) / l) * d, p[1] + ((b[0] - a[0]) / l) * d];
  });
}
