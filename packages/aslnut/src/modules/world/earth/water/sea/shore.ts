// modules › world › earth › water › sea › shore: where the sea meets the land. The coast (lines with the land on their
// left, as OpenStreetMap's natural=coastline runs, or land polygons) becomes a field: each cell's distance to the coast,
// signed (+ at sea, − on land), within a band round it, made once for a window of the world (and again only when the
// view goes to another window). The waves break by it: they come in from the sea shoreward in order, slowing as the
// water shallows, break inside the surf zone into lines of foam, and run up the sand as a thin sheet and back, the sand
// wet behind them. The ground and the sea's surface read the same field and the same clock, so both draw one shore.
//   water({ sea: { look: {}, shore: { coast: data.geojson('/coast.geojson'), surf: 120, runup: 12, period: 9 } } })
import type { Feature, Position } from '../../../../../core/data/features.ts';
import { linesOf, polygonsOf, ringArea } from '../../../../../core/data/features.ts';
import type { Source } from '../../../../../core/data/sources/source.ts';
import type { Fn } from '../../../../../core/observation/presence.ts';

export interface SeaShore {
  /** the coast: lines with the land on their left (OpenStreetMap's natural=coastline), or polygons of land */
  coast: Source | Feature[];
  /** how far out the waves break, m: the surf zone (default 120) */
  surf?: number;
  /** how far up the sand a wave runs, m (default 12; each wave its own share of it) */
  runup?: number;
  /** seconds between waves (default 9) */
  period?: Fn<number>;
  /** how much foam (0..1, default 1; 0: none) */
  foam?: number;
  /** how fast the sea floor falls away from the coast: m of depth a metre out (default 0.02: 1 in 50). The waves slow
   *  by it as they come in, and the water's colour deepens by it near the coast */
  shelf?: number;
  /** the field's finest cell, m (default 2) */
  cell?: number;
}
/** the shore's values with their defaults */
export const SHORE = { surf: 120, runup: 12, period: 9, foam: 1, shelf: 0.02, cell: 2 } as const;
/** a cell the coast is farther than the band from (the field does not know it: the ground's height decides) */
export const FAR = 1e6;

/** the coast as segments [ax, ay, bx, by, …] in metres east and north (`at`: a place → its metres; the bake's frame
 *  of a place, or the world's), each with the land on its left (a polygon's outer ring turned counter-clockwise, its
 *  holes clockwise); only those with a point inside `box` [w, s, e, n] when one is given */
export function coastSegments(features: readonly Feature[], at: (lon: number, lat: number) => readonly [number, number], box?: readonly [number, number, number, number]): Float64Array {
  const out: number[] = [];
  const put = (line: readonly Position[]) => {
    for (let i = 0; i + 1 < line.length; i++) {
      const a = line[i]!, b = line[i + 1]!; if (a[0] === b[0] && a[1] === b[1]) continue;
      if (box && !((a[0] >= box[0] && a[0] <= box[2] && a[1] >= box[1] && a[1] <= box[3]) || (b[0] >= box[0] && b[0] <= box[2] && b[1] >= box[1] && b[1] <= box[3]))) continue;
      const p = at(a[0], a[1]), q = at(b[0], b[1]); out.push(p[0], p[1], q[0], q[1]);
    }
  };
  for (const f of features) {
    const g = f.geometry; if (!g) continue;
    if (g.type === 'Polygon' || g.type === 'MultiPolygon') {
      for (const poly of polygonsOf(g)) poly.forEach((ring, k) => { const ccw = ringArea(ring) > 0; put((k === 0) === ccw ? ring : [...ring].reverse()); });
    } else for (const line of linesOf(g, false)) put(line);
  }
  return Float64Array.from(out);
}
/** a place's metres east and north of an origin [lon, lat], on its tangent plane (the bake's frame of a place) */
export const localFrame = (origin: readonly [number, number]) => { const kx = 111320 * Math.cos((origin[1] * Math.PI) / 180); return (lon: number, lat: number): [number, number] => [(lon - origin[0]) * kx, (lat - origin[1]) * 110574]; };
/** a field's grid: its north-west corner (m east and north of the segments' origin), its cell (m), its size in cells
 *  (row 0 north) */
export interface FieldGrid { x0: number; y0: number; cell: number; nx: number; ny: number }
/** the coast's signed distance at each cell's middle (m: + at sea, − on land) within `band` m of it; FAR beyond. Made a
 *  slice at a time: `step()` does at most `budget` segments' cells (each its box round it) and says when it is done */
export function coastField(segs: Float64Array, grid: FieldGrid, band: number): { out: Float32Array; step(budget?: number): boolean } {
  const { x0, y0, cell, nx, ny } = grid, n = nx * ny, best = new Float32Array(n).fill(Infinity), sin = new Float32Array(n), side = new Int8Array(n), out = new Float32Array(n).fill(FAR);
  let k = 0, done = false;
  const step = (budget = Infinity): boolean => {
    if (done) return true;
    const end = Math.min(segs.length, k + 4 * Math.max(1, Math.floor(budget)));
    for (; k < end; k += 4) {
      const ax = segs[k]!, ay = segs[k + 1]!, bx = segs[k + 2]!, by = segs[k + 3]!, dx = bx - ax, dy = by - ay, L2 = dx * dx + dy * dy, L = Math.sqrt(L2);
      // the cells within the band of it (columns east, rows south from the corner)
      const i0 = Math.max(0, Math.floor((Math.min(ax, bx) - band - x0) / cell)), i1 = Math.min(nx - 1, Math.ceil((Math.max(ax, bx) + band - x0) / cell));
      const j0 = Math.max(0, Math.floor((y0 - Math.max(ay, by) - band) / cell)), j1 = Math.min(ny - 1, Math.ceil((y0 - Math.min(ay, by) + band) / cell));
      for (let j = j0; j <= j1; j++) {
        const py = y0 - (j + 0.5) * cell, row = j * nx;
        for (let i = i0; i <= i1; i++) {
          const px = x0 + (i + 0.5) * cell, t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / L2));
          const ex = px - (ax + t * dx), ey = py - (ay + t * dy), d = Math.sqrt(ex * ex + ey * ey);
          if (d > band) continue;
          const c = row + i, cr = dx * (py - ay) - dy * (px - ax), s = Math.abs(cr) / (L * Math.max(d, 1e-6));
          // the nearest segment says the side; two meeting at the nearest corner: the one the cell is more square to
          if (d < best[c]! - 1e-4 || (d <= best[c]! + 1e-4 && s > sin[c]!)) { best[c] = d; sin[c] = s; side[c] = cr > 0 ? -1 : 1; }
        }
      }
    }
    if (k >= segs.length) { for (let c = 0; c < n; c++) if (best[c]! <= band) out[c] = side[c]! * best[c]!; done = true; }
    return done;
  };
  return { out, step };
}
/** the shore's coast features, from a source or a list */
export function coastFeatures(coast: SeaShore['coast']): readonly Feature[] {
  if (Array.isArray(coast)) return coast.map((f) => ((f as Feature).props ? f : { ...f, props: (f as unknown as { properties?: Record<string, unknown> }).properties ?? {} }) as Feature);
  return (coast as Source).features();
}
