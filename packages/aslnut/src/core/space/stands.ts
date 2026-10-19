// core › space › stands: where something stands is the top of what is drawn there: the ground where nothing is drawn,
// otherwise the road, the kerb, the footpath, a deck or a stair drawn over it. A layer that draws surfaces to stand on
// gives the world their heights at a place (`levelsAt`); the world picks the one nearest the height the thing had (a
// walker under a bridge stays under it, one on the deck stays on it). Without such a layer nothing changes: the ground.
//   w.standAt(lon, lat)              the lowest drawn (a place first stood on)
//   w.standAt(lon, lat, e.at[2])     the level nearest where it was (true m)
//   const g = standGrid(tris); g.levelsAt(x, z, out)      (tris: x, z, height × 3 a triangle, in a tile's metres)

/** what a layer that draws surfaces to stand on answers: the heights (true m) of what it draws at a place, pushed into
 *  `out` (nothing: it draws nothing there); `standVersion` bumps whenever that changes (a tile built or let go) */
export interface Stands { levelsAt(lon: number, lat: number, out: number[]): void; readonly standVersion?: number }

/** the triangles one stands on, found by a grid of cells: x, z, height × 3 a triangle (metres of a tile's frame) */
export class StandGrid {
  readonly tris: Float32Array; readonly x0: number; readonly z0: number; readonly x1: number; readonly z1: number; readonly cell: number;
  private nx: number; private nz: number; private start: Int32Array; private items: Int32Array;
  constructor(tris: Float32Array, cell = 4) {
    this.tris = tris;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < tris.length; i += 3) { const x = tris[i]!, z = tris[i + 1]!; if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z; }
    if (!(x1 >= x0)) { x0 = z0 = 0; x1 = z1 = -1; }
    this.x0 = x0; this.z0 = z0; this.x1 = x1; this.z1 = z1; this.cell = cell;
    const nx = (this.nx = Math.max(1, Math.ceil((x1 - x0) / cell) + 1)), nz = (this.nz = Math.max(1, Math.ceil((z1 - z0) / cell) + 1)), n = tris.length / 9;
    // two passes: how many triangles a cell holds, then which (each triangle in the cells of its box)
    const count = new Int32Array(nx * nz + 1), box = (t: number, f: (c: number) => void) => {
      const o = t * 9, a = Math.min(tris[o]!, tris[o + 3]!, tris[o + 6]!), b = Math.max(tris[o]!, tris[o + 3]!, tris[o + 6]!), c = Math.min(tris[o + 1]!, tris[o + 4]!, tris[o + 7]!), d = Math.max(tris[o + 1]!, tris[o + 4]!, tris[o + 7]!);
      for (let j = Math.floor((c - z0) / cell); j <= Math.floor((d - z0) / cell); j++) for (let i = Math.floor((a - x0) / cell); i <= Math.floor((b - x0) / cell); i++) f(j * nx + i);
    };
    for (let t = 0; t < n; t++) box(t, (c) => count[c + 1]!++);
    for (let c = 0; c < nx * nz; c++) count[c + 1]! += count[c]!;
    const fill = count.slice(0, nx * nz), items = new Int32Array(count[nx * nz]!);
    for (let t = 0; t < n; t++) box(t, (c) => { items[fill[c]!++] = t; });
    this.start = count; this.items = items;
  }
  /** the heights of the triangles over (x, z), pushed into `out` (the same height twice once) */
  levelsAt(x: number, z: number, out: number[]): void {
    if (x < this.x0 || x > this.x1 || z < this.z0 || z > this.z1) return;
    const c = Math.floor((z - this.z0) / this.cell) * this.nx + Math.floor((x - this.x0) / this.cell), T = this.tris;
    for (let k = this.start[c]!, e = this.start[c + 1]!; k < e; k++) {
      const o = this.items[k]! * 9, ax = T[o]!, az = T[o + 1]!, ux = T[o + 3]! - ax, uz = T[o + 4]! - az, vx = T[o + 6]! - ax, vz = T[o + 7]! - az, d = ux * vz - uz * vx;
      if (!d) continue;
      const s = ((x - ax) * vz - (z - az) * vx) / d, t = ((z - az) * ux - (x - ax) * uz) / d;
      if (s < -1e-6 || t < -1e-6 || s + t > 1 + 1e-6) continue;
      const h = T[o + 2]! + s * (T[o + 5]! - T[o + 2]!) + t * (T[o + 8]! - T[o + 2]!);
      let seen = false; for (let i = 0; i < out.length; i++) if (Math.abs(out[i]! - h) < 1e-3) { seen = true; break; }
      if (!seen) out.push(h);
    }
  }
  /** its size in bytes */
  get bytes(): number { return this.tris.byteLength + this.start.byteLength + this.items.byteLength; }
}
export const standGrid = (tris: Float32Array, cell?: number) => new StandGrid(tris, cell);

/** where to stand among the levels drawn at a place (true m) and the ground there: the one nearest `near` (the height
 *  it had); without it (NaN: a thing first put down) the lowest drawn, so it lands on the road, the kerb or the
 *  footpath however far the ground lies under them, not on a deck over them. The ground is one of them only for a thing
 *  that had a height, and only where nothing is drawn on it (no level from `hidden` under it to `headroom` over it: the
 *  ground under a road is never stood on; the ground under a deck is). */
export function standOn(levels: readonly number[], ground: number, near = NaN, o: { hidden?: number; headroom?: number } = {}): number {
  if (!levels.length) return ground;
  let low = Infinity; for (const l of levels) if (l < low) low = l;
  if (!Number.isFinite(near)) return low;
  const hidden = o.hidden ?? 0.5, headroom = o.headroom ?? 2.2;
  let covered = Number.isNaN(ground); for (const l of levels) if (l >= ground - hidden && l <= ground + headroom) covered = true;
  let best = covered ? NaN : ground, bd = covered ? Infinity : Math.abs(ground - near);
  for (const l of levels) { const d = Math.abs(l - near); if (d < bd) { bd = d; best = l; } }
  return best;
}
