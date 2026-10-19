// core › geometry › landform › compose › foundation: a flat pad for each footprint on the composed ground, and the
// ground graded to it.
//   pad      the floor's height: max(the ground at the door, the mean ground along the walls) + `lift`; with
//            `frontWall`, at most that much over the lowest ground along its street-facing walls (`front`): on a slope
//            up from the street the house is set into the hill (the cut below), not raised on a wall over the street
//   cut      the ground's samples under the footprint and within one sample diagonal of it lowered (never raised) to
//            the pad less `lift`, except where `keep` says the ground must stay (a road, a kerb, a footpath): the
//            floor never has ground above it
//   skirt    the foundation from the pad down to `skirt` metres under the lowest ground along the walls: a slope
//            shows a plinth, never a gap
// Then measured on the graded ground (walls every `sample` m, the inside every 2 m): ground above the floor is a
// buried wall; `raise` lifts the pad over it (pad-raise). Heights are the ground's (metres over the sea);
// `ground(x, z)` must read the graded samples (it is asked again after the cut).
//   const pads = gradePads(sites, terrain, (x, z) => groundAt(terrain, x, z));
import type { Ground } from './ground.ts';

export type P2 = [number, number];
export interface PadSite { ring: readonly P2[]; door?: P2 | null; /** points along its street-facing walls */ front?: readonly P2[] | null }
export interface Pad {
  /** the floor (m over the sea) */ pad: number;
  /** the foundation's foot */ bottom: number;
  /** the corner on the lowest graded ground, and that ground */ anchor: number; anchorGround: number;
  /** the graded ground along the walls and inside: lowest, highest */ low: number; high: number;
  /** how far the ground was cut under it (m) */ cutM: number;
  /** ground above the floor before any raise (m; 0 none) */ buriedM: number;
  /** how far the pad was raised over it (m) */ raisedM: number;
  /** the plinth: floor over the lowest ground (m) */ plinthM: number;
  /** the floor over the lowest graded ground along its street-facing walls (m; 0 without `front`) */ frontM: number;
  /** how far the floor was set lower for `frontWall` (m) */ loweredM: number;
}
const inRing = (x: number, z: number, r: readonly P2[]) => { let k = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[i]!, b = r[j]!; if ((a[1] > z) !== (b[1] > z) && x < ((b[0] - a[0]) * (z - a[1])) / (b[1] - a[1]) + a[0]) k = !k; } return k; };
const distToRing = (x: number, z: number, r: readonly P2[]) => { let d = Infinity; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const a = r[j]!, b = r[i]!, dx = b[0] - a[0], dz = b[1] - a[1], L2 = dx * dx + dz * dz || 1, t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (z - a[1]) * dz) / L2)); d = Math.min(d, Math.hypot(x - a[0] - dx * t, z - a[1] - dz * t)); } return d; };
/** points along an outline's walls, `step` m apart at most (its corners first) */
export function wallSamples(ring: readonly P2[], step = 0.5): P2[] {
  const out: P2[] = ring.map((p) => [p[0], p[1]]);
  for (let i = 0; i < ring.length; i++) { const a = ring[i]!, b = ring[(i + 1) % ring.length]!, n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step); for (let k = 1; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]); }
  return out;
}
/** points inside an outline on a `step` m lattice (at most `max`) */
export function insideSamples(ring: readonly P2[], step = 2, max = 400): P2[] {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
  const s = Math.max(step, Math.sqrt(((x1 - x0) * (z1 - z0)) / max)), out: P2[] = [];
  for (let z = z0 + s / 2; z < z1; z += s) for (let x = x0 + s / 2; x < x1; x += s) if (inRing(x, z, ring)) out.push([x, z]);
  return out;
}
export function gradePads(sites: readonly PadSite[], terrain: Ground, ground: (x: number, z: number) => number,
  o: { lift?: number; skirt?: number; sample?: number; cut?: boolean; raise?: boolean; tolerance?: number; keep?: (x0: number, z0: number, x1: number, z1: number) => boolean; /** the most the foundation shows on the street side (m; default: no limit) */ frontWall?: number } = {}): Pad[] {
  const lift = o.lift ?? 0.2, skirt = o.skirt ?? 0.3, sample = o.sample ?? 0.5, tol = o.tolerance ?? 0.02, g = terrain, R = g.step * Math.SQRT2;
  const walls = sites.map((s) => wallSamples(s.ring, sample)), insides = sites.map((s) => insideSamples(s.ring));
  // 1 · each pad from the ground as it is
  const frontLow = (s: PadSite) => { let lo = Infinity; for (const [x, z] of s.front ?? []) lo = Math.min(lo, ground(x, z)); return lo; };
  const lowered = new Float64Array(sites.length);
  const targets = sites.map((s, k) => {
    const w = walls[k]!; let sum = 0; for (const [x, z] of w) sum += ground(x, z); const avg = sum / (w.length || 1), door = s.door ? ground(s.door[0], s.door[1]) : -Infinity, t = Math.max(avg, door);
    // no higher than `frontWall` over the street side's lowest ground (less the lift: the floor stands that over it)
    const fl = o.frontWall !== undefined && s.front?.length ? frontLow(s) + Math.max(0, o.frontWall - lift) : Infinity;
    if (fl < t) { lowered[k] = t - fl; return fl; }
    return t;
  });
  // 2 · the cut: every sample within a diagonal of the footprint, lowered to its pad's ground (the lowest asked)
  const keepCell = new Map<number, boolean>();
  const cellKept = (i: number, j: number) => { if (i < 0 || j < 0 || i >= g.nx - 1 || j >= g.nz - 1) return true; const k = j * g.nx + i; let v = keepCell.get(k); if (v === undefined) { v = o.keep ? o.keep(g.x0 + i * g.step, g.z0 + j * g.step, g.x0 + (i + 1) * g.step, g.z0 + (j + 1) * g.step) : false; keepCell.set(k, v); } return v; };
  const nodeKept = (i: number, j: number) => cellKept(i - 1, j - 1) || cellKept(i, j - 1) || cellKept(i - 1, j) || cellKept(i, j);
  const cutM = new Float64Array(sites.length);
  const cut = (which: readonly number[]) => {
    const cutBy = new Map<number, { to: number; site: number }>();
    for (const k of which) {
      const s = sites[k]!;
      let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity; for (const [x, z] of s.ring) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
      for (let j = Math.max(0, Math.floor((z0 - R - g.z0) / g.step)); j <= Math.min(g.nz - 1, Math.ceil((z1 + R - g.z0) / g.step)); j++) for (let i = Math.max(0, Math.floor((x0 - R - g.x0) / g.step)); i <= Math.min(g.nx - 1, Math.ceil((x1 + R - g.x0) / g.step)); i++) {
        const x = g.x0 + i * g.step, z = g.z0 + j * g.step; if (!inRing(x, z, s.ring) && distToRing(x, z, s.ring) > R) continue;
        const idx = j * g.nx + i; if (g.data[idx]! <= targets[k]!) continue; if (nodeKept(i, j)) continue;
        const c = cutBy.get(idx); if (!c || targets[k]! < c.to) cutBy.set(idx, { to: targets[k]!, site: k });
      }
    }
    for (const [idx, c] of cutBy) { const d = g.data[idx]! - c.to; if (d > 0) { cutM[c.site] = Math.max(cutM[c.site]!, d); g.data[idx] = c.to; } }
  };
  if (o.cut !== false) {
    cut(sites.map((_, k) => k));
    // the cut lowers the ground before a street-facing wall too (the samples behind it, interpolated): lowered again
    // until the street side holds (a few passes: each takes most of what is left)
    for (let pass = 0; o.frontWall !== undefined && pass < 6; pass++) {
      const again: number[] = [];
      sites.forEach((s, k) => { if (!s.front?.length || !lowered[k]) return; const fl = frontLow(s) + Math.max(0, o.frontWall! - lift); if (targets[k]! > fl + 1e-3) { lowered[k]! += targets[k]! - fl; targets[k] = fl; again.push(k); } });
      if (!again.length) break;
      cut(again);
    }
  }
  // 3 · measured on the graded ground: buried walls raised over, the skirt to the lowest ground
  return sites.map((s, k) => {
    let low = Infinity, high = -Infinity, anchor = 0, anchorGround = Infinity;
    s.ring.forEach(([x, z], i) => { const h = ground(x, z); if (h < anchorGround) { anchorGround = h; anchor = i; } });
    for (const [x, z] of [...walls[k]!, ...insides[k]!]) { const h = ground(x, z); low = Math.min(low, h); high = Math.max(high, h); }
    let pad = targets[k]! + lift; const buriedM = Math.max(0, high - pad - tol > 0 ? high - pad : 0);
    let raisedM = 0; if (buriedM > 0 && o.raise !== false) { raisedM = high + lift - pad; pad = high + lift; }
    const fl = s.front?.length ? frontLow(s) : pad;
    return { pad, bottom: low - skirt, anchor, anchorGround, low, high, cutM: cutM[k]!, buriedM, raisedM, plinthM: pad - low, frontM: Math.max(0, pad - fl), loweredM: Math.max(0, lowered[k]! - raisedM) };
  });
}
