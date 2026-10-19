import { facetsOf, type Facet } from './facets.ts';
import { decodeNumbers } from '../../data/loading/chunks/numbers.ts';
/** a clamp tile (v3): the road surfaces' cells (outlines and holes with heights) and their outlines' lines (place metres) */
export interface ClampJson { v: number; origin: [number, number]; cells: number[][]; edges: number[][]; numericScale?:number; numericCells?: string[]; numericEdges?: string[] }
export interface ClampIndex {
  origin: [number, number]; kx: number;
  /** the ground's highest height at a point (null: no road near): under a road's surface on it, level with its edge
   *  beside it, then the batter */
  limit(x: number, z: number, batter: number, reach: number, sampleSize?: number, /** false: beside the roads only (a mesh
   *  whose cells are held under them: `under`) */ surfaces?: boolean): number | null;
  /** the conservative clamp of a mesh: every corner of a cell of the grid that a road surface touches is held under
   *  that surface, so no triangle of the mesh rises through a road between its samples, and no finer mesh drawn from
   *  these heights either (a tile's parent standing in: its heights read bilinear inside its cells). Under a facet,
   *  the cells of a row take one linear bound that stays under it where it crosses the row: its own plane, its lowest
   *  point there, a blend of the two, or (with `ground`) the cells' own ground as a plane lowered just clear of it; with
   *  `ground`, the one that cuts least into it. Mins into `out` (rows × columns, row-major). Nothing with `legacy` */
  under(grid: MeshGrid, out: Float32Array, o?: UnderOptions): void;
}
/** a mesh's samples on a rectilinear grid (place metres): its columns' x and its rows' z, each increasing */
export interface MeshGrid { xs: ArrayLike<number>; zs: ArrayLike<number> }
export interface UnderOptions {
  /** how far under the surface (m, default 0.35: as under a road at a sample) */
  margin?: number;
  /** without `ground`: a surface steeper than this (rise over run, default 0.25) holds the corners under its lowest
   *  point in the row instead of its plane carried to them (a broken piece's near-vertical facet sank a corner far) */
  steep?: number;
  /** the grid's heights as they are (rows × columns): each bound chosen to cut least into them */
  ground?: ArrayLike<number>;
  /** a road cell this many times smaller than the mesh's cells (default 2) holds those its outline meets under one bound
   *  for it, not one a facet: its lowest point, the cell's own ground lowered clear of it, or a blend (a facet's plane
   *  carried far helps nothing there) */
  coarse?: number;
  /** whether this index answers for a road cell (by its first point): a cell listed in several clamp tiles counts once */
  owns?: (x: number, z: number) => boolean;
}
type R3 = [number, number, number][];
/** the first index whose value is ≥ v (> v: `after`) of a sorted list of near even steps: guessed, then walked */
const search = (a: ArrayLike<number>, v: number, after: boolean) => {
  const n = a.length, a0 = a[0]!, a1 = a[n - 1]!; if (n < 2 || a1 <= a0) return v < a0 || (!after && v === a0) ? 0 : n;
  let i = Math.max(0, Math.min(n, Math.floor(((v - a0) / (a1 - a0)) * (n - 1))));
  const before = (k: number) => (after ? a[k]! <= v : a[k]! < v);
  while (i > 0 && !before(i - 1)) i--;
  while (i < n && before(i)) i++;
  return i;
};
const lower = (a: ArrayLike<number>, v: number) => search(a, v, false), upper = (a: ArrayLike<number>, v: number) => search(a, v, true);
/** whether an outline meets a box (closed): a point of it inside, or a side of it crossing the box */
function touches(ring: readonly (readonly number[])[], x0: number, z0: number, x1: number, z1: number): boolean {
  for (const q of ring) if (q[0]! >= x0 && q[0]! <= x1 && q[1]! >= z0 && q[1]! <= z1) return true;
  for (let k = 0; k < ring.length; k++) {
    const a = ring[k]!, b = ring[(k + 1) % ring.length]!, dx = b[0]! - a[0]!, dz = b[1]! - a[1]!;
    // the side clipped to the box (Liang–Barsky): anything left of it is inside
    let t0 = 0, t1 = 1, ok = true;
    for (const [p, q] of [[-dx, a[0]! - x0], [dx, x1 - a[0]!], [-dz, a[1]! - z0], [dz, z1 - a[1]!]] as const) {
      if (p === 0) { if (q < 0) { ok = false; break; } continue; }
      const r = q / p; if (p < 0) { if (r > t1) { ok = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { ok = false; break; } if (r < t1) t1 = r; }
    }
    if (ok && t0 <= t1) return true;
  }
  return false;
}
export function clampIndex(j: ClampJson, options:{legacy?:boolean}={}): ClampIndex {
  if(j.numericCells)j.cells=decodeNumbers(j.numericCells,j.numericScale??1000);
  if(j.numericEdges)j.edges=decodeNumbers(j.numericEdges,j.numericScale??1000);
  const kx = 111320 * Math.cos((j.origin[1] * Math.PI) / 180), CELL = 50, R = 20;
  // (a cell of the grid by number: no string a question)
  const grid = new Map<number, { c: number[]; e: number[] }>(), key = (cx: number, cz: number) => (cx + 32768) * 65536 + cz + 32768;
  const put = (x0: number, z0: number, x1: number, z1: number, f: (c: { c: number[]; e: number[] }) => void) => { for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) { const k = key(cx, cz); let c = grid.get(k); if (!c) grid.set(k, (c = { c: [], e: [] })); f(c); } };
  // (a cell's facets: as the device triangulates its outline; made when first asked, by `limit` on a road)
  const cells: { rings: R3[]; box: [number, number, number, number]; grade: number; facets: Facet[] | null; low?: number }[] = [];
  const facetsAt = (c: (typeof cells)[number]) => (c.facets ??= options.legacy ? [] : facetsOf([{ t: 'area', kind: 'contract', info: 0, rings: c.rings }]));
  for (const a of j.cells) {
    const nr = a[0]!, rings: R3[] = []; let o = 1 + nr;
    for (let r = 0; r < nr; r++) { const ring: R3 = []; for (let i = 0; i < a[1 + r]!; i++) { ring.push([a[o]!, a[o + 1]!, a[o + 2]!]); o += 3; } rings.push(ring); }
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const q of rings[0]!) { x0 = Math.min(x0, q[0]); x1 = Math.max(x1, q[0]); z0 = Math.min(z0, q[1]); z1 = Math.max(z1, q[1]); }
    let grade=0;for(const r of rings)for(let k=0;k<r.length;k++){const a=r[k]!,b=r[(k+1)%r.length]!,ds=Math.hypot(b[0]-a[0],b[1]-a[1]);if(ds>.05)grade=Math.max(grade,Math.abs(b[2]-a[2])/ds);}
    const i = cells.push({ rings, box: [x0, z0, x1, z1], grade: Math.min(.4, grade), facets: null }) - 1; put(x0, z0, x1, z1, (c) => c.c.push(i));
  }
  const segs: { ax: number; az: number; ah: number; bx: number; bz: number; bh: number }[] = [];
  for (const l of j.edges) for (let k = 0; k + 5 < l.length; k += 3) { const i = segs.push({ ax: l[k]!, az: l[k + 1]!, ah: l[k + 2]!, bx: l[k + 3]!, bz: l[k + 4]!, bh: l[k + 5]! }) - 1, s = segs[i]!; put(Math.min(s.ax, s.bx) - R, Math.min(s.az, s.bz) - R, Math.max(s.ax, s.bx) + R, Math.max(s.az, s.bz) + R, (c) => c.e.push(i)); }
  const inRing = (x: number, z: number, p: R3, boundary: boolean | null = null) => { let inside = false; for (let a = 0, b = p.length - 1; a < p.length; b = a++) { const A = p[a]!, B = p[b]!; if(boundary!==null){const dx=B[0]-A[0],dz=B[1]-A[1],t=Math.max(0,Math.min(1,((x-A[0])*dx+(z-A[1])*dz)/(dx*dx+dz*dz||1)));if(Math.hypot(x-A[0]-dx*t,z-A[1]-dz*t)<=.02)return boundary;} if ((A[1] > z) !== (B[1] > z) && x < ((B[0] - A[0]) * (z - A[1])) / (B[1] - A[1]) + A[0]) inside = !inside; } return inside; };
  // the cells' facets as numbers, made the first time a mesh asks (a, b, c: x, z, h each; a cell's run from first[i]);
  // the facets themselves not kept for it (a whole pack's as objects weighed 100 MB)
  let tri: Float32Array | null = null, first: Int32Array | null = null;
  const flatten = () => {
    const each = cells.map((c) => c.facets ?? facetsOf([{ t: 'area', kind: 'contract', info: 0, rings: c.rings }]));
    first = new Int32Array(cells.length + 1); let n = 0;
    each.forEach((f, i) => { first![i] = n; n += f.length; }); first[cells.length] = n;
    tri = new Float32Array(n * 9); let o = 0;
    for (const fs of each) for (const f of fs) for (const p of f.points) { tri[o++] = p[0]; tri[o++] = p[1]; tri[o++] = p[2]; }
  };
  // a strip of a triangle (its points: the corners inside, the crossings of its sides), a plane at a row's corners:
  // reused
  const sx = new Float64Array(9), sz = new Float64Array(9); let pc = new Float64Array(64), ac = new Float64Array(64), tc = new Float64Array(64);
  return {
    origin: j.origin, kx,
    under(g, out, o = {}) {
      if (options.legacy) return;
      const xs = g.xs, zs = g.zs, nx = xs.length, nz = zs.length; if (nx < 2 || nz < 2) return;
      const m = o.margin ?? 0.35, steep = o.steep ?? 0.25, gr = o.ground, coarse = o.coarse ?? 2, X0 = xs[0]!, X1 = xs[nx - 1]!, Z0 = zs[0]!, Z1 = zs[nz - 1]!;
      const cellW = (X1 - X0) / (nx - 1), cellH = (Z1 - Z0) / (nz - 1);
      if (!tri) flatten();
      if (pc.length < 2 * (nx + 1)) { pc = new Float64Array(2 * (nx + 1)); ac = new Float64Array(2 * (nx + 1)); tc = new Float64Array(2 * (nx + 1)); }
      const T = tri!, F = first!;
      for (let ci = 0; ci < cells.length; ci++) {
        const cl = cells[ci]!, b = cl.box; if (b[2] < X0 || b[0] > X1 || b[3] < Z0 || b[1] > Z1) continue;
        const p0 = cl.rings[0]![0]!; if (o.owns && !o.owns(p0[0], p0[1])) continue;
        // small against the mesh's cells: each cell its box meets held under it by one bound for the whole road cell: level
        // at its lowest point, the cell's own ground (its plane through its corners) lowered just clear of it, or a blend
        // of the two (with `ground`: the one that cuts least into it)
        if ((b[2] - b[0]) * coarse <= cellW && (b[3] - b[1]) * coarse <= cellH) {
          if (cl.low === undefined) { let lo = Infinity; for (const r of cl.rings) for (const q of r) if (q[2] < lo) lo = q[2]; cl.low = lo; }
          const i0 = Math.max(0, lower(xs, b[0]) - 1), i1 = Math.min(nx - 2, upper(xs, b[2]) - 1), j0 = Math.max(0, lower(zs, b[1]) - 1), j1 = Math.min(nz - 2, upper(zs, b[3]) - 1), lo = cl.low;
          for (let jc = j0; jc <= j1; jc++) for (let ic = i0; ic <= i1; ic++) {
            if ((i1 > i0 || j1 > j0) && !touches(cl.rings[0]!, xs[ic]!, zs[jc]!, xs[ic + 1]!, zs[jc + 1]!)) continue;
            const q00 = jc * nx + ic, q10 = q00 + 1, q01 = q00 + nx, q11 = q01 + 1;
            if (!gr) { const v = lo - m; if (v < out[q00]!) out[q00] = v; if (v < out[q10]!) out[q10] = v; if (v < out[q01]!) out[q01] = v; if (v < out[q11]!) out[q11] = v; continue; }
            // the cell's ground as a plane (its corners' slopes), lowered until the road cell is over it (at its points:
            // it is flat between them); each corner's bound as a height over lo
            const xa = xs[ic]!, xb = xs[ic + 1]!, za = zs[jc]!, zb = zs[jc + 1]!, hx = (xb - xa) / 2, hz = (zb - za) / 2, xc = xa + hx, zc = za + hz;
            const g00 = gr[q00]!, g10 = gr[q10]!, g01 = gr[q01]!, g11 = gr[q11]!, gx = (g10 + g11 - g00 - g01) / (4 * hx), gz = (g01 + g11 - g00 - g10) / (4 * hz);
            let d = -Infinity; for (const r of cl.rings) for (const v of r) { const e = gx * (v[0] - xc) + gz * (v[1] - zc) - v[2]; if (e > d) d = e; }
            const base = -d - lo, l00 = base - gx * hx - gz * hz, l10 = base + gx * hx - gz * hz, l01 = base - gx * hx + gz * hz, l11 = base + gx * hx + gz * hz;
            const a00 = g00 - lo, a10 = g10 - lo, a01 = g01 - lo, a11 = g11 - lo;
            let best = Infinity, s = 0;
            for (let k = 0; k <= 4; k++) { const t = k * 0.25, cut = Math.max(a00 - t * l00, a10 - t * l10, a01 - t * l01, a11 - t * l11); if (cut < best - 1e-6) { best = cut; s = t; } }
            const v00 = lo + s * l00 - m, v10 = lo + s * l10 - m, v01 = lo + s * l01 - m, v11 = lo + s * l11 - m;
            if (v00 < out[q00]!) out[q00] = v00; if (v10 < out[q10]!) out[q10] = v10; if (v01 < out[q01]!) out[q01] = v01; if (v11 < out[q11]!) out[q11] = v11;
          }
          continue;
        }
        for (let k = F[ci]!; k < F[ci + 1]!; k++) {
          const q = k * 9, ax = T[q]!, az = T[q + 1]!, ah = T[q + 2]!, bx = T[q + 3]!, bz = T[q + 4]!, bh = T[q + 5]!, cx = T[q + 6]!, cz = T[q + 7]!, ch = T[q + 8]!;
          const zmin = Math.min(az, bz, cz), zmax = Math.max(az, bz, cz), xmin = Math.min(ax, bx, cx), xmax = Math.max(ax, bx, cx);
          if (zmax < Z0 || zmin > Z1 || xmax < X0 || xmin > X1) continue;
          // its plane: h = ah + gx (x − ax) + gz (z − az)
          const ux = bx - ax, uz = bz - az, vx = cx - ax, vz = cz - az, den = ux * vz - vx * uz; if (Math.abs(den) < 1e-9) continue;
          const gx = ((bh - ah) * vz - (ch - ah) * uz) / den, gz = (ux * (ch - ah) - vx * (bh - ah)) / den, gentle = Math.hypot(gx, gz) <= steep;
          // the rows of cells it meets (closed: a facet on a row's line holds both rows)
          const j0 = Math.max(0, lower(zs, zmin) - 1), j1 = Math.min(nz - 2, upper(zs, zmax) - 1);
          for (let jr = j0; jr <= j1; jr++) {
            // its part in the row's strip: the x it spans there, and its lowest height there (all of it: its own)
            const za = zs[jr]!, zb = zs[jr + 1]!;
            let xlo = xmin, xhi = xmax, hlo = Math.min(ah, bh, ch), np = 3;
            sx[0] = ax; sz[0] = az; sx[1] = bx; sz[1] = bz; sx[2] = cx; sz[2] = cz;
            if (zmin < za || zmax > zb) {
              np = 0;
              for (let e = 0; e < 3; e++) {
                const pxe = e === 0 ? ax : e === 1 ? bx : cx, pze = e === 0 ? az : e === 1 ? bz : cz, qx = e === 0 ? bx : e === 1 ? cx : ax, qz = e === 0 ? bz : e === 1 ? cz : az;
                if (pze >= za && pze <= zb) { sx[np] = pxe; sz[np++] = pze; }
                if ((pze - za) * (qz - za) < 0) { sx[np] = pxe + ((qx - pxe) * (za - pze)) / (qz - pze); sz[np++] = za; }
                if ((pze - zb) * (qz - zb) < 0) { sx[np] = pxe + ((qx - pxe) * (zb - pze)) / (qz - pze); sz[np++] = zb; }
              }
              if (!np) continue;
              xlo = Infinity; xhi = -Infinity; hlo = Infinity;
              for (let p = 0; p < np; p++) { const x = sx[p]!, h = ah + gx * (x - ax) + gz * (sz[p]! - az); if (x < xlo) xlo = x; if (x > xhi) xhi = x; if (h < hlo) hlo = h; }
              if (xhi < X0 || xlo > X1) continue;
            }
            const i0 = Math.max(0, lower(xs, xlo) - 1), i1 = Math.min(nx - 2, upper(xs, xhi) - 1), w = i1 - i0 + 2;
            // its plane at the corners of the cells it meets (two rows), from hlo; and the ground there, from hlo
            let far = 0;
            for (let r = 0; r < 2; r++) { const dz = zs[jr + r]! - az, row = (jr + r) * nx + i0; for (let i = 0; i < w; i++) { const v = ah + gx * (xs[i0 + i]! - ax) + gz * dz - hlo; pc[r * w + i] = v; if (gr) ac[r * w + i] = gr[row + i]! - hlo; if (v > far) far = v; else if (-v > far) far = -v; } }
            // the bound, hlo + s (plane − hlo): under the facet wherever it crosses the row for any s in 0..1 (the plane
            // is at least hlo there); or the ground of those cells as a plane, lowered until the facet's part there is
            // over it. The one that cuts least into the ground at the corners; else by the slope
            let s = gentle ? 1 : 0, own = false;
            if (gr && far > 0.01) {
              let best = Infinity;
              for (let q = 0; q <= 4; q++) {
                const t = 1 - q * 0.25; let cut = -Infinity;
                for (let k = 0; k < 2 * w; k++) { const c = ac[k]! - t * pc[k]!; if (c > cut) cut = c; }
                if (cut < best - 1e-6) { best = cut; s = t; }
              }
              // (the corners' plane: least squares over the two rows; lowered by the most it is over the facet's part)
              const xc = (xs[i0]! + xs[i0 + w - 1]!) / 2, zc = (za + zb) / 2; let sa = 0, sb = 0, sxx = 0, sxg = 0;
              for (let i = 0; i < w; i++) { const x = xs[i0 + i]! - xc, g0 = ac[i]!, g1 = ac[w + i]!; sa += g0; sb += g1; sxx += 2 * x * x; sxg += x * (g0 + g1); }
              const ta = (sa + sb) / (2 * w), tx = sxx > 0 ? sxg / sxx : 0, tz = (sb - sa) / w / (zb - za);
              let d = -Infinity; for (let p = 0; p < np; p++) { const e = ta + tx * (sx[p]! - xc) + tz * (sz[p]! - zc) - (ah + gx * (sx[p]! - ax) + gz * (sz[p]! - az) - hlo); if (e > d) d = e; }
              let cut = -Infinity;
              for (let r = 0; r < 2; r++) { const z = (r ? zb : za) - zc; for (let i = 0; i < w; i++) { const t = ta + tx * (xs[i0 + i]! - xc) + tz * z - d; tc[r * w + i] = t; const c = ac[r * w + i]! - t; if (c > cut) cut = c; } }
              if (cut < best - 1e-6) own = true;
            }
            // every corner of the cells it meets under that bound
            for (let r = 0; r < 2; r++) { const row = (jr + r) * nx + i0; for (let i = 0; i < w; i++) { const v = hlo + (own ? tc[r * w + i]! : s * pc[r * w + i]!) - m; if (v < out[row + i]!) out[row + i] = v; } }
          }
        }
      }
    },
    limit(x, z, batter, reach, sampleSize = 0, surfaces = true) {
      const c = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL))); if (!c) return null;
      let lim = Infinity;
      // on a road: a little under its surface (its outline's points, by inverse distance)
      if (surfaces) for (const i of c.c) {
        const cl = cells[i]!; if (x < cl.box[0] || x > cl.box[2] || z < cl.box[1] || z > cl.box[3]) continue;
        if (!inRing(x, z, cl.rings[0]!, options.legacy?null:true) || cl.rings.slice(1).some((h) => inRing(x, z, h, options.legacy?null:false))) continue;
        let sw = 0, sh = 0, low = Infinity; for (const r of cl.rings) for (const q of r) { const w = 1 / (Math.hypot(q[0] - x, q[1] - z) ** 2 + 0.01); sw += w; sh += w * q[2]; low = Math.min(low, q[2]); }
        const facet=facetsAt(cl).find(f=>f.contains(x,z));
        const surface=facet?facet.height(x,z):Math.min(sh/sw,low+.3);
        const v = surface - ((options.legacy?.3:.35) + cl.grade * sampleSize * 1.6); if (v < lim) lim = v;
      }
      // beside it: level with the kerb's foot for 4 m, then the batter
      for (const i of c.e) {
        const s = segs[i]!;
        // (a line whose box, grown by the reach, leaves the point out is farther than the reach: most of a cell's)
        if (x < (s.ax < s.bx ? s.ax : s.bx) - reach || x > (s.ax > s.bx ? s.ax : s.bx) + reach || z < (s.az < s.bz ? s.az : s.bz) - reach || z > (s.az > s.bz ? s.az : s.bz) + reach) continue;
        const dx = s.bx - s.ax, dz = s.bz - s.az, L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / L2));
        const d = Math.hypot(x - s.ax - dx * t, z - s.az - dz * t); if (d > reach) continue;
        const h = s.ah + (s.bh - s.ah) * t,guard=Math.min(.4,Math.abs(s.bh-s.ah)/Math.max(.1,Math.hypot(dx,dz)))*sampleSize*1.6, v = d <= 4 ? h + 0.06 - guard : h + 0.06 - guard + (d - 4) * batter;
        if (v < lim) lim = v;
      }
      return Number.isFinite(lim) ? lim : null;
    },
  };
}
