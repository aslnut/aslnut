// modules › world › plane: a flat floor (a lab, a game level, an interior, a test bench). No curvature: the camera is
// always flat. Places on it are metres east / north of its centre: `planeAt(x, y)` gives the [lon, lat] every layer
// takes (the plane sits at lon / lat 0, where a metre is a metre on the flat map).
//   const w = await world(canvas, { body: plane({ size: 200, grid: 5 }) });
//   w.add(points({ data: [{ at: planeAt(10, 20) }] }));
import { AslnutError } from '../../../core/world/errors.ts';
import type { Body } from '../../../core/world/world.ts';
import { D, R, latOfMercY, mercY, tileBounds } from '../../../core/space/geo.ts';
import { Sky } from '../surface/sky.ts';
import { Surface } from '../surface/surface.ts';
import { TILE, type Imagery } from '../surface/sources.ts';

/** metres east / north of the plane's centre → [lon, lat] */
export const planeAt = (x: number, y: number): [number, number] => [x / (R * D), latOfMercY(y / R)];
/** [lon, lat] → metres east / north */
export const planeXY = (lon: number, lat: number): [number, number] => [lon * R * D, mercY(lat) * R];

export interface PlaneOptions {
  /** the side, metres */
  size?: number;
  /** grid spacing, metres (false: none) */
  grid?: number | false;
  color?: string; lines?: string;
  /** the colour beyond the floor */
  beyond?: [number, number, number];
}
export function plane(o: PlaneOptions = {}): Body {
  const size = o.size ?? 1000, grid = o.grid === undefined ? 10 : o.grid;
  if (!(size > 0)) throw new AslnutError('E-DATA-001', `plane size must be > 0 metres (got ${size})`, { fix: 'plane({ size: 200 })' });
  const h = size / 2, [w, s] = planeAt(-h, -h), [e, n] = planeAt(h, h);
  const floor: Imagery = {
    kind: 'imagery', id: 'plane-floor', attribution: '', terms: { show: true, prefetch: true, keep: true, export: true },
    where: [w, s, e, n], minZoom: 0, maxZoom: 30, opacity: 1, blend: 'normal', version: 0,
    async draw(g, t) {
      const b = tileBounds(t.z, t.x, t.y);
      // the tile in metres: x from its west edge, y from its north edge (Mercator × R is metres here)
      const x0 = b.w * R * D, x1 = b.e * R * D, y0 = b.n * R, y1 = b.s * R, px = TILE / (x1 - x0);
      const X = (x: number) => (x - x0) * px, Y = (y: number) => (y0 - y) * px;
      g.fillStyle = o.color ?? '#eeeeee';
      g.fillRect(X(Math.max(-h, x0)), Y(Math.min(h, y0)), (Math.min(h, x1) - Math.max(-h, x0)) * px, (Math.min(h, y0) - Math.max(-h, y1)) * px);
      if (grid) {
        let step = grid; while (step * px < 4) step *= 10;
        g.strokeStyle = o.lines ?? '#b8b8b8'; g.lineWidth = 1;
        g.beginPath();
        for (let x = Math.ceil(Math.max(-h, x0) / step) * step; x <= Math.min(h, x1); x += step) { g.moveTo(X(x), Y(Math.min(h, y0))); g.lineTo(X(x), Y(Math.max(-h, y1))); }
        for (let y = Math.ceil(Math.max(-h, y1) / step) * step; y <= Math.min(h, y0); y += step) { g.moveTo(X(Math.max(-h, x0)), Y(y)); g.lineTo(X(Math.min(h, x1)), Y(y)); }
        g.stroke();
      }
      return true;
    },
  };
  return {
    kind: 'plane', flat: true, bounds: [w, s, e, n],
    view: { lon: 0, lat: 0, dist: size * 1.2, tilt: 50, bearing: 340 },
    elements: () => [
      new Sky({ horizon: [0.86, 0.88, 0.9], zenith: [0.6, 0.7, 0.82] }),
      new Surface({ imagery: [floor], terrain: [], empty: o.beyond ?? [0.82, 0.84, 0.86], horizon: [0.86, 0.88, 0.9], bounds: [w, s, e, n], shade: 0 }),
    ],
  };
}
