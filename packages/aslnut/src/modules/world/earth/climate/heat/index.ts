// modules › world › earth › climate › heat: urban heat (core › simulation › phenomena › heat) on a real place. The street level's open data
// round a point becomes the model's rasters: roads, kerbs, nature strips and footpaths by their real widths, parks,
// water, lawns, buildings with their heights, every tree with its crown; each street its own canyon. Changes to try
// (a scenario): street trees planted, cool road surfaces, watered nature strips. The field drawn on the ground as a
// raster in a heat scale, a person's breakdown anywhere.
//   const r = cityRasters(street.tiles(), { centre: [145.12, -37.92], size: 360, cell: 2 })
//   const m = heatModel(r); const f = await m.field(input)        w.add(raster({ source: heatRaster(r, grid, …) }))
import { raster as rasters, type RasterSource } from '../../../../../core/data/sources/raster.ts';
import type { Material } from '../../../../../core/simulation/phenomena/heat/physics.ts';
import { constants } from '../../../../../core/simulation/constants.ts';
import type { HeatInput, HeatOptions, HeatRasters } from '../../../../../core/simulation/phenomena/heat/model.ts';
import { heat, HEAT_RAMP, type Heat, type HeatMetric, type HeatProps } from '../../../../../core/simulation/phenomena/heat/index.ts';
import { D } from '../../../../../core/space/geo.ts';
import type { DetailContext } from '../../../surface/street-detail.ts';
import { STREET, streetBands } from '../../presets/built/roads/index.ts';
import { treeCrown, treeShapes, type TreeLook } from '../../presets/living/plants/index.ts';
import { seedOf } from '../../shared/plan.ts';
import type { CityTile } from '../../street.ts';

const KZ = 110574;
/** what to change from the place as it is (a scenario to compare with the base) */
export interface HeatChanges {
  /** street trees on every nature strip of local and collector streets, every `every` metres (default false) */
  streetTrees?: boolean | { every?: number; height?: number; radius?: number };
  /** light (cool) road surfaces instead of asphalt */
  coolRoads?: boolean;
  /** nature strips and lawns watered (grass) instead of dry (default: dry in summer) */
  wateredGrass?: boolean;
}
export interface CityRasters extends HeatRasters {
  /** a place of the rasters (metres from the north-west corner, x east, z south) ↔ lon / lat */
  lonLat(x: number, z: number): [number, number];
  xzOf(lon: number, lat: number): [number, number];
  /** the streets' names (regions) */
  streetNames: string[];
}
/** the street level's tiles round a centre as heat rasters: `size` metres a side, `cell` metres a cell */
export function cityRasters(tiles: readonly { tile: CityTile; ctx: DetailContext }[], o: { centre: [number, number]; size: number; cell?: number; changes?: HeatChanges; /** the trees as the street level draws them (their crowns, their canopy) */ trees?: TreeLook }): CityRasters {
  const cell = o.cell ?? 2, w = Math.ceil(o.size / cell), h = w, n = w * h, ch = o.changes ?? {};
  const origin = tiles[0]?.ctx.origin ?? o.centre, kx = 111320 * Math.cos(origin[1] * D);
  // the area's corner in the tiles' metric frame
  const ax0 = (o.centre[0] - origin[0]) * kx - o.size / 2, az0 = -(o.centre[1] - origin[1]) * KZ - o.size / 2;
  // the materials as the constants table holds them now (core › simulation › constants: replace a value, the model follows)
  const mats: Material[] = constants.materials(['drygrass', 'grass', 'asphalt', 'coolpave', 'concrete', 'roof', 'water']);
  const M = { dry: 0, grass: 1, asphalt: 2, cool: 3, concrete: 4, roof: 5, water: 6 };
  const lawn = ch.wateredGrass ? M.grass : M.dry;
  const mat = new Uint8Array(n).fill(lawn), bH = new Float32Array(n), cTop = new Float32Array(n), cBase = new Float32Array(n), cTrans = new Float32Array(n), region = new Uint8Array(n), walk = new Uint8Array(n);
  /** what holds a cell: higher wins (a road over a strip over a footpath over a lawn) */
  const prio = new Uint8Array(n);
  const names: string[] = [], regionOf = new Map<string, number>();
  const put = (k: number, m: number, p: number) => { if (p >= prio[k]!) { prio[k] = p; mat[k] = m; } };
  // tile metres → area metres
  const at = (t: { ctx: DetailContext }, x: number, z: number): [number, number] => [t.ctx.at[0] + x - ax0, t.ctx.at[1] + z - az0];
  const poly = (f: readonly number[], start: number, t: { ctx: DetailContext }): [number, number][] => { const out: [number, number][] = []; let x = f[start]!, z = f[start + 1]!; out.push(at(t, x / 10, z / 10)); for (let i = start + 2; i + 1 < f.length; i += 2) { x += f[i]!; z += f[i + 1]!; out.push(at(t, x / 10, z / 10)); } return out; };
  const fill = (ring: [number, number][], fn: (k: number) => void) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    for (let j = Math.max(0, Math.floor(z0 / cell)); j <= Math.min(h - 1, Math.floor(z1 / cell)); j++) for (let i = Math.max(0, Math.floor(x0 / cell)); i <= Math.min(w - 1, Math.floor(x1 / cell)); i++) {
      const x = (i + 0.5) * cell, z = (j + 0.5) * cell; let c = false;
      for (let a = 0, b = ring.length - 1; a < ring.length; b = a++) { const [xa, za] = ring[a]!, [xb, zb] = ring[b]!; if ((za > z) !== (zb > z) && x < ((xb - xa) * (z - za)) / (zb - za) + xa) c = !c; }
      if (c) fn(j * w + i);
    }
  };
  const disc = (cx: number, cz: number, r: number, fn: (k: number) => void) => {
    for (let j = Math.max(0, Math.floor((cz - r) / cell)); j <= Math.min(h - 1, Math.floor((cz + r) / cell)); j++) for (let i = Math.max(0, Math.floor((cx - r) / cell)); i <= Math.min(w - 1, Math.floor((cx + r) / cell)); i++)
      if (Math.hypot((i + 0.5) * cell - cx, (j + 0.5) * cell - cz) <= r) fn(j * w + i);
  };
  const inArea = (pts: [number, number][], pad: number) => pts.some(([x, z]) => x > -pad && z > -pad && x < o.size + pad && z < o.size + pad);
  for (const t of tiles) {
    const s = (i: number) => t.tile.s?.[i] ?? '';
    for (const p of t.tile.parks) { const ring = poly(p, 3, t); if (!inArea(ring, 50)) continue; const g = s(p[1]!), m = /natural/i.test(g) ? M.dry : M.grass; fill(ring, (k) => put(k, m, 1)); }
    for (const p of t.tile.water) { const ring = poly(p, 3, t); if (inArea(ring, 50)) fill(ring, (k) => put(k, M.water, 2)); }
    // roads and their bands: each cell takes the nearest piece's band
    for (const r of t.tile.roads) {
      const cls = r[0]!, width = r[1]! / 10, name = s(r[2]!), pts = poly(r, (t.tile.v ?? 1) >= 2 ? 4 : 3, t); if (!inArea(pts, 60) || cls >= 6) continue;
      const half = width / 2, bands = streetBands({ cls, width }, STREET), outer = bands.length ? bands[bands.length - 1]!.to : half;
      let reg = 0;
      if (name && cls >= 2) { reg = regionOf.get(name) ?? 0; if (!reg && names.length < 254) { names.push(name); reg = names.length; regionOf.set(name, reg); } }
      for (let q = 0; q + 1 < pts.length; q++) {
        const [ax, az] = pts[q]!, [bx, bz] = pts[q + 1]!, dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const x0 = Math.min(ax, bx) - outer, x1 = Math.max(ax, bx) + outer, z0 = Math.min(az, bz) - outer, z1 = Math.max(az, bz) + outer;
        for (let j = Math.max(0, Math.floor(z0 / cell)); j <= Math.min(h - 1, Math.floor(z1 / cell)); j++) for (let i = Math.max(0, Math.floor(x0 / cell)); i <= Math.min(w - 1, Math.floor(x1 / cell)); i++) {
          const x = (i + 0.5) * cell, z = (j + 0.5) * cell, tt = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2)), d = Math.hypot(x - ax - dx * tt, z - az - dz * tt), k = j * w + i;
          if (d <= half) { put(k, ch.coolRoads ? M.cool : M.asphalt, 6); if (reg) region[k] = reg; continue; }
          for (const b of bands) if (d > b.from && d <= b.to) {
            const strip = b.color === STREET.stripColor, m = strip ? (ch.wateredGrass ? M.grass : M.dry) : M.concrete;
            put(k, m, strip ? 4 : 5); if (reg) region[k] = reg; walk[k] = 1;
          }
        }
        // street trees planted along the strips (a scenario)
        if (ch.streetTrees && cls >= 4 && cls <= 5 && bands.length) {
          const planted = [...treeShapes(o.trees).values()][0]!.transmissivity;
          const st = typeof ch.streetTrees === 'object' ? ch.streetTrees : {}, every = st.every ?? 8, len = Math.sqrt(L2), mid = half + STREET.kerb + STREET.strip / 2;
          for (let u = every / 2; u < len; u += every) for (const side of [-1, 1]) {
            const cx = ax + (dx / len) * u - (dz / len) * mid * side, cz = az + (dz / len) * u + (dx / len) * mid * side, hh = st.height ?? 10, rr = st.radius ?? 4.2;
            disc(cx, cz, rr, (k) => { cTop[k] = Math.max(cTop[k]!, hh); cBase[k] = cBase[k] ? Math.min(cBase[k]!, 3) : 3; cTrans[k] = cTrans[k] ? Math.min(cTrans[k]!, planted) : planted; });
          }
        }
      }
    }
    // buildings over everything; trees with their crowns
    for (const b of t.tile.buildings) { const ring = poly(b, 3, t); if (!inArea(ring, 10)) continue; const hh = b[0]! / 10; fill(ring, (k) => { bH[k] = hh; put(k, M.roof, 9); walk[k] = 0; }); }
    // every tree's crown as it is drawn (its species grown: core › geometry › shapes › recipes), with the share of
    // the sun its leaves let through (modules › world › earth › presets › living › plants › canopy)
    const tr = t.tile.trees;
    for (let i = 0; i + 3 < tr.length; i += 4) {
      const [x, z] = at(t, tr[i]! / 10, tr[i + 1]! / 10); if (x < -20 || z < -20 || x > o.size + 20 || z > o.size + 20) continue;
      const cr = treeCrown({ x: 0, z: 0, height: tr[i + 2]! / 10, radius: tr[i + 3]! / 10, id: 0, seed: seedOf(t.ctx.ix, t.ctx.iz, i) }, o.trees);
      disc(x, z, cr.radius, (k) => { if (bH[k]! > 0) return; cTop[k] = Math.max(cTop[k]!, cr.top); cBase[k] = cBase[k] ? Math.min(cBase[k]!, Math.max(1, cr.base)) : Math.max(1, cr.base); cTrans[k] = cTrans[k] ? Math.min(cTrans[k]!, cr.transmissivity) : cr.transmissivity; });
    }
  }
  return {
    w, h, cell, mat, materials: mats, bH, cTop, cBase, cTrans, region, walk, streetNames: names,
    regions: names.map((id) => ({ id, width: 28 })),
    lonLat: (x, z) => [origin[0] + (ax0 + x) / kx, origin[1] - (az0 + z) / KZ],
    xzOf: (lon, lat) => [(lon - origin[0]) * kx - ax0, -(lat - origin[1]) * KZ - az0],
  };
}

/** a grid of numbers over heat rasters (NaN: nothing), drawn on the ground in a ramp */
export function heatRaster(r: CityRasters, grid: Float32Array, o: { domain: [number, number]; ramp?: string[]; id?: string; alpha?: number; version?: number }): RasterSource {
  const src = rasters.field({
    id: o.id ?? 'heat', ramp: o.ramp ?? HEAT_RAMP, domain: o.domain, cell: 2, alpha: o.alpha ?? 0.9, attribution: 'heat model (aslnut), weather: Open-Meteo',
    value: (lon, lat) => { const [x, z] = r.xzOf(lon, lat), i = Math.floor(x / r.cell), j = Math.floor(z / r.cell); if (i < 0 || j < 0 || i >= r.w || j >= r.h) return null; const v = grid[j * r.w + i]!; return Number.isFinite(v) ? v : null; },
  });
  // a tighter box: only the tiles over the area are painted
  const a = r.lonLat(0, r.h * r.cell), b = r.lonLat(r.w * r.cell, 0);
  return { ...src, where: [a[0], a[1], b[0], b[1]], minZoom: 14, version: o.version ?? 0 };
}

/** urban heat on the street level (Earth's preset of core › simulation › phenomena › heat): the rasters of what is loaded round a
 *  centre, the heat element over them (run it: `await h.run()`); `changes` make a scenario's rasters to compare
 *    const h = w.add(cityHeat(street.tiles(), { centre, size: 360, input })); await h.run()
 *    await h.compare(cityRasters(street.tiles(), { centre, size: 360, changes: { streetTrees: true } })) */
export function cityHeat(tiles: Parameters<typeof cityRasters>[0], o: { id?: string; centre: [number, number]; size?: number; cell?: number; changes?: HeatChanges; trees?: TreeLook; input: HeatInput; options?: Partial<HeatOptions>; metric?: HeatMetric } & Omit<HeatProps, 'id' | 'rasters' | 'input' | 'options' | 'metric'>): Heat {
  const { id, centre, size, cell, changes, trees, ...rest } = o;
  return heat({ ...rest, id: id ?? 'heat', rasters: cityRasters(tiles, { centre, size: size ?? 360, cell: cell ?? 2, changes, trees }) });
}
export { HEAT_RAMP };
