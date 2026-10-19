// modules › world › earth › shared › plan: plane geometry the Earth's builders share (metres, x east, z south) and a
// seeded random (the same city every time).
export type P2 = [number, number];

/** the signed area of a ring: positive when it goes counter-clockwise on the map (north up) */
export function signedArea(r: readonly P2[]): number { let a = 0; for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j]![0] + r[i]![0]) * (r[j]![1] - r[i]![1]); return a / 2; }
/** points no farther apart than `step` metres (long segments split evenly) */
export function densify(pts: readonly P2[], step: number): P2[] {
  const out: P2[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!, n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / step));
    for (let k = 0; k < n; k++) out.push([ax + ((bx - ax) * k) / n, az + ((bz - az) * k) / n]);
  }
  if (pts.length) out.push([pts[pts.length - 1]![0], pts[pts.length - 1]![1]]);
  return out;
}
/** the best-fitting rectangle of a ring: its middle, half sides a ≥ b, and its axes u (along a), v (along b) */
export function orientedBox(ring: readonly P2[]): { cx: number; cz: number; a: number; b: number; ux: number; uz: number; vx: number; vz: number } {
  let best = { area: Infinity, cx: 0, cz: 0, a: 0, b: 0, ux: 1, uz: 0, vx: 0, vz: 1 };
  for (let i = 0; i < ring.length; i++) {
    const [ax, az] = ring[i]!, [bx, bz] = ring[(i + 1) % ring.length]!, l = Math.hypot(bx - ax, bz - az); if (l < 0.5) continue;
    const ux = (bx - ax) / l, uz = (bz - az) / l, vx = -uz, vz = ux;
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, z] of ring) { const u = x * ux + z * uz, v = x * vx + z * vz; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
    const area = (u1 - u0) * (v1 - v0);
    if (area < best.area) {
      const cu = (u0 + u1) / 2, cv = (v0 + v1) / 2, A = (u1 - u0) / 2, B = (v1 - v0) / 2;
      best = A >= B ? { area, cx: cu * ux + cv * vx, cz: cu * uz + cv * vz, a: A, b: B, ux, uz, vx, vz } : { area, cx: cu * ux + cv * vx, cz: cu * uz + cv * vz, a: B, b: A, ux: vx, uz: vz, vx: -ux, vz: -uz };
    }
  }
  return best;
}
/** the nearest point on segments to (x, z), with the segment's direction and its data */
export function nearestOn<S extends { ax: number; az: number; bx: number; bz: number }>(x: number, z: number, segs: readonly S[]): { px: number; pz: number; d: number; tx: number; tz: number; seg: S } | null {
  let best: { px: number; pz: number; d: number; tx: number; tz: number; seg: S } | null = null;
  for (const s of segs) {
    const dx = s.bx - s.ax, dz = s.bz - s.az, l2 = dx * dx + dz * dz; if (l2 < 1e-6) continue;
    const t = Math.max(0, Math.min(1, ((x - s.ax) * dx + (z - s.az) * dz) / l2)), px = s.ax + dx * t, pz = s.az + dz * t, d = Math.hypot(x - px, z - pz);
    if (!best || d < best.d) { const l = Math.sqrt(l2); best = { px, pz, d, tx: dx / l, tz: dz / l, seg: s }; }
  }
  return best;
}
export function inside(x: number, z: number, ring: readonly P2[]): boolean {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) { const [xi, zi] = ring[i]!, [xj, zj] = ring[j]!; if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c; }
  return c;
}
/** a seeded random: the same numbers for the same seed */
export class Rng {
  private s: number;
  constructor(seed: number) { this.s = seed >>> 0 || 1; }
  next(): number { let t = (this.s += 0x6d2b79f5); t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }
  range(a: number, b: number): number { return a + (b - a) * this.next(); }
  chance(p: number): boolean { return this.next() < p; }
  pick<T>(xs: readonly T[]): T { return xs[Math.floor(this.next() * xs.length) % xs.length]!; }
  /** by weight: { value: weight } */
  weighted<T extends string>(w: Readonly<Record<T, number>>): T { const e = Object.entries(w) as [T, number][]; let s = 0; for (const [, v] of e) s += v; let r = this.next() * s; for (const [k, v] of e) { r -= v; if (r <= 0) return k; } return e[e.length - 1]![0]; }
}
/** a seed from numbers */
export const seedOf = (...xs: number[]) => { let h = 2166136261; for (const x of xs) { h = Math.imul(h ^ (x | 0), 16777619); h = Math.imul(h ^ ((x * 1000) | 0), 16777619); } return h >>> 0; };
/** what footprints exclude: scattered or placed things (trees, furniture) never stand on a building, a carriageway or
 *  a footpath. Rings (footprints) and bands along lines (from d0 to d1 across a segment: right of its direction
 *  positive); `place` gives where a thing may stand: where it is, nudged out of a band onto the nearest free spot
 *  (within `nudge` m), or null (dropped) */
export class Footprints {
  private rings: { ring: readonly P2[]; x0: number; x1: number; z0: number; z1: number }[] = [];
  private bands: { ax: number; az: number; bx: number; bz: number; tx: number; tz: number; len: number; d0: number; d1: number }[] = [];
  addRing(ring: readonly P2[]): this { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); } this.rings.push({ ring, x0, x1, z0, z1 }); return this; }
  addBand(line: readonly P2[], d0: number, d1: number): this {
    for (let i = 0; i + 1 < line.length; i++) { const [ax, az] = line[i]!, [bx, bz] = line[i + 1]!, len = Math.hypot(bx - ax, bz - az); if (len < 0.05) continue; this.bands.push({ ax, az, bx, bz, tx: (bx - ax) / len, tz: (bz - az) / len, len, d0: Math.min(d0, d1), d1: Math.max(d0, d1) }); }
    return this;
  }
  /** the band (and how far across it) a point is in, or null */
  private bandAt(x: number, z: number, r: number) {
    for (const b of this.bands) {
      const s = (x - b.ax) * b.tx + (z - b.az) * b.tz; if (s < -r || s > b.len + r) continue;
      const d = -(x - b.ax) * b.tz + (z - b.az) * b.tx; // right of the direction: (−tz, tx)
      if (d > b.d0 - r && d < b.d1 + r) return { b, d };
    }
    return null;
  }
  blocked(x: number, z: number, r = 0): boolean { if (this.bandAt(x, z, r)) return true; for (const g of this.rings) if (x >= g.x0 && x <= g.x1 && z >= g.z0 && z <= g.z1 && inside(x, z, g.ring)) return true; return false; }
  /** where a thing of radius r may stand: [x, z] as it is, nudged off a band (at most `nudge` m), or null */
  place(x: number, z: number, o: { r?: number; nudge?: number } = {}): P2 | null {
    const r = o.r ?? 0, nudge = o.nudge ?? 2;
    for (const g of this.rings) if (x >= g.x0 && x <= g.x1 && z >= g.z0 && z <= g.z1 && inside(x, z, g.ring)) return null;
    const hit = this.bandAt(x, z, r); if (!hit) return [x, z];
    const { b, d } = hit, nx = -b.tz, nz = b.tx;
    for (const to of [b.d0 - r - 0.3, b.d1 + r + 0.3].sort((p, q) => Math.abs(p - d) - Math.abs(q - d))) {
      if (Math.abs(to - d) > nudge) continue;
      const px = x + nx * (to - d), pz = z + nz * (to - d);
      if (!this.blocked(px, pz, r)) return [px, pz];
    }
    return null;
  }
}
