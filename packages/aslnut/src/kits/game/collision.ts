// kits › game › collision: what stands in the way. A question you can give a walker's or a car's locomotion and a
// following camera: how high is what stands at a place (m over the ground; 0: open), looked for in a circle of the
// body's radius; anything lower than a step is walked over. From the world's own solids ('compiled': every layer that
// answers blockerAt, as the street level does for its buildings) or from your polygons with heights.
//   const blocked = collision(w, { radius: 0.3 })     surface({ blocked })   follow(w, me, { blocked })
import type { World } from '../../core/world/world.ts';
import type { Feature } from '../../core/data/features.ts';
import { Source } from '../../core/data/sources/source.ts';
import { D } from '../../core/space/geo.ts';

type LonLat = [number, number];
export interface CollisionOptions {
  /** 'compiled' (default): the world's layers that answer blockerAt; or polygons (a source or features) with heights */
  solids?: 'compiled' | Source | Feature[];
  /** a polygon's height, m (default props.height, else 6) */
  height?: (f: Feature) => number;
  /** the body's radius, m (default 0.3): a place is blocked when anything is within it */
  radius?: number;
  /** what is lower than this is stepped over (default 0.35 m) */
  step?: number;
}
export function collision(w: World, o: CollisionOptions = {}): (lon: number, lat: number) => number {
  const r = o.radius ?? 0.3, step = o.step ?? 0.35;
  let at: (lon: number, lat: number) => number;
  if (!o.solids || o.solids === 'compiled') {
    at = (lon, lat) => { let h = 0; for (const l of w.elementsOfKind('shape')) { const f = (l as unknown as { blockerAt?: (lon: number, lat: number) => number }).blockerAt; if (f) h = Math.max(h, f.call(l, lon, lat)); } return h; };
  } else {
    // your polygons: a grid of 20 m cells holding the ones that touch it
    const src = o.solids; let seen = -1, cells = new Map<string, { ring: LonLat[]; h: number }[]>(), k = 0;
    const index = () => {
      const fs = src instanceof Source ? src.features() : src; if (src instanceof Source) { if (src.version === seen) return; seen = src.version; }
      cells = new Map(); k = 0;
      for (const f of fs) {
        const g = f.geometry as { type: string; coordinates: unknown } | null; if (!g || (g.type !== 'Polygon' && g.type !== 'MultiPolygon')) continue;
        const h = o.height?.(f) ?? Number((f.props as Record<string, unknown>)?.height ?? 6);
        for (const poly of (g.type === 'Polygon' ? [g.coordinates] : g.coordinates) as LonLat[][][]) {
          const ring = poly[0]!; let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const [x, y] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); }
          if (!k) k = 111320 * Math.cos(((y0 + y1) / 2) * D);
          for (let cx = Math.floor((x0 * k) / 20); cx <= Math.floor((x1 * k) / 20); cx++) for (let cy = Math.floor((y0 * 110574) / 20); cy <= Math.floor((y1 * 110574) / 20); cy++) { const key = `${cx}_${cy}`; let a = cells.get(key); if (!a) cells.set(key, (a = [])); a.push({ ring, h }); }
        }
      }
    };
    index();
    at = (lon, lat) => {
      index(); if (!k) return 0;
      let h = 0; for (const b of cells.get(`${Math.floor((lon * k) / 20)}_${Math.floor((lat * 110574) / 20)}`) ?? []) if (b.h > h && inRing(b.ring, lon, lat)) h = b.h;
      return h;
    };
  }
  return (lon, lat) => {
    // in a circle of the radius: the middle and eight round it
    const kx = 111320 * Math.cos(lat * D); let h = at(lon, lat);
    if (r > 0) for (let i = 0; i < 8; i++) { const a = (i / 8) * Math.PI * 2; h = Math.max(h, at(lon + (Math.cos(a) * r) / kx, lat + (Math.sin(a) * r) / 110574)); }
    return h < step ? 0 : h;
  };
}
const inRing = (r: LonLat[], x: number, y: number) => { let c = false; for (let a = 0, b = r.length - 1; a < r.length; b = a++) { const [xa, ya] = r[a]!, [xb, yb] = r[b]!; if ((ya > y) !== (yb > y) && x < ((xb - xa) * (y - ya)) / (yb - ya) + xa) c = !c; } return c; };
