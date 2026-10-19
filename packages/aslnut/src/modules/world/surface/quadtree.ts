// modules › world › surface › quadtree: which tiles a view needs. A quadtree by size on screen: a tile splits while it
// would cover more than `tilePx` CSS pixels; the far side of the globe, what is off screen and what is past the far
// plane are skipped; neighbours differ by one level at most (no steps or cracks). Pure: a pose in, tiles out.
import { mat4 } from 'wgpu-matrix';
import { D, R, globeCentre, wrap } from '../../../core/space/geo.ts';

/** what the quadtree reads from a camera (now, or a view it is about to have) */
export interface QPose { lon: number; lat: number; morph: number; eye: ArrayLike<number>; vp: ArrayLike<number>; H: number; fov: number; dist: number; groundY: number }
export interface Want { z: number; x: number; y: number; /** distance to the camera */ d: number; /** from the screen's centre: 0 centre, 1 edge */ c: number }
export interface QOptions { tilePx: number; maxZoom: number; maxTiles: number; /** coarser with distance beyond the view's centre: the limit grows by this for each centre's distance further (0: none) */ far?: number; /** the highest ground in a tile × exaggeration (m), when known */ hiOf?: (z: number, x: number, y: number) => number; /** a flat body's extent: tiles outside are skipped */ bounds?: [number, number, number, number] }

/** the pose a view would give (for planning and prefetching views not reached yet) */
export function poseOf(v: { lon: number; lat: number; dist: number; bearing?: number; pitch?: number }, cam: { fov: number; width: number; height: number; morphAt(d: number): number; planes(d: number): [number, number]; pitch: number }, groundY = 0): QPose {
  const yaw = -(v.bearing ?? 0) * D, pitch = v.pitch ?? cam.pitch, cp = Math.cos(pitch);
  const eye: [number, number, number] = [v.dist * cp * Math.sin(yaw), groundY + v.dist * Math.sin(pitch), v.dist * cp * Math.cos(yaw)];
  const [n, f] = cam.planes(v.dist);
  const up = pitch > 1.5 ? [-Math.sin(yaw), 0, -Math.cos(yaw)] : [0, 1, 0];
  const vp = mat4.multiply(mat4.perspective(cam.fov, cam.width / Math.max(1, cam.height), n, f), mat4.lookAt(eye, [0, groundY, 0], up));
  return { lon: v.lon, lat: v.lat, morph: cam.morphAt(v.dist), eye, vp, H: cam.height, fov: cam.fov, dist: v.dist, groundY };
}

// scratch, reused by every call: the quadtree runs every frame and allocates nothing but its answer
const PX = new Float64Array(19 * 3), CS = new Float64Array(19 * 3);   // 18 samples and the nearest point
const tk = (z: number, x: number, y: number) => z + 32 * (x + 2 ** z * y);
/** as the surface shader places a tile's points (longitudes not wrapped), written into PX at i */
function place(i: number, f: { lon: number; lat: number; morph: number }, lon: number, lat: number, h: number): void {
  const p0 = f.lat * D, p = lat * D, dl = (lon - f.lon) * D, dp = p - p0, r = R + h, t = f.morph;
  const sh = Math.sin(dp / 2), sl = Math.sin(dl / 2), s2p = 2 * sh * sh, s2l = 2 * sl * sl, cp = Math.cos(p), k = s2p + Math.cos(p0) * cp * s2l;
  const gx = r * cp * Math.sin(dl), gy = h - r * k, gz = -r * (Math.sin(dp) + Math.sin(p0) * cp * s2l);
  const c = R * Math.cos(p0), la = Math.max(-85.0511, Math.min(85.0511, lat)), my = Math.log(Math.tan(Math.PI / 4 + (la * D) / 2)), m0 = Math.log(Math.tan(Math.PI / 4 + (Math.max(-85.0511, Math.min(85.0511, f.lat)) * D) / 2));
  const fx = c * dl, fz = -c * (my - m0);
  PX[i] = gx + (fx - gx) * t; PX[i + 1] = gy + (h - gy) * t; PX[i + 2] = gz + (fz - gz) * t;
}
const mercOf = (lat: number) => Math.log(Math.tan(Math.PI / 4 + (Math.max(-85.0511, Math.min(85.0511, lat)) * D) / 2));
/** place() on a flat map (morph 1): the Mercator plane only, the centre's numbers and the latitude's done once */
function placeFlat(i: number, c: number, lon0: number, m0: number, lon: number, my: number, h: number): void {
  PX[i] = c * (lon - lon0) * D; PX[i + 1] = h; PX[i + 2] = -c * (my - m0);
}
export function wantFor(v: QPose, o: QOptions & { /** hysteresis: the tiles split last time (they stay split a little longer), and where this time's go */ split?: { prev: Set<number>; next: Set<number> } }): Want[] {
  const f = { lon: v.lon, lat: v.lat, morph: v.morph }, eye = v.eye, vp = v.vp, e0 = eye[0]!, e1 = eye[1]!, e2 = eye[2]!;
  const pxPerRad = v.H / (2 * Math.tan(v.fov / 2)), C = globeCentre(), farCut = v.dist * 40 + 1000;
  const want: Want[] = [], prev = o.split?.prev, next = o.split?.next;
  const flat = v.morph >= 1, cF = R * Math.cos(v.lat * D), m0 = mercOf(v.lat);
  next?.clear();
  const visit = (z: number, x: number, y: number) => {
    if (want.length >= o.maxTiles) return;
    const k2 = 2 ** z, bw = (x / k2) * 360 - 180, be = ((x + 1) / k2) * 360 - 180, bn = Math.PI * (1 - (2 * y) / k2), bs = Math.PI * (1 - (2 * (y + 1)) / k2);
    const latN = (2 * Math.atan(Math.exp(bn)) - Math.PI / 2) / D, latS = (2 * Math.atan(Math.exp(bs)) - Math.PI / 2) / D;
    if (o.bounds && z > 0 && (be <= o.bounds[0] || bw >= o.bounds[2] || latN <= o.bounds[1] || latS >= o.bounds[3])) return;
    // samples placed exactly as the shader places the tile: from its west edge relative to the centre, unwrapped
    const w0 = v.lon + wrap(bw - v.lon);
    // the ground may be high: sample at sea level and at the ground's height, so a tile is culled or coarsened
    // only when both are off screen / far
    const hi = Math.max(v.groundY, o.hiOf?.(z, x, y) ?? 0);
    let n = 0;
    for (let jy = 0; jy < 3; jy++) {
      const lat = latN + (latS - latN) * jy * 0.5, my = flat ? mercOf(lat) : 0;
      for (let jx = 0; jx < 3; jx++) {
        const lon = w0 + (be - bw) * jx * 0.5;
        if (flat) { placeFlat(n * 3, cF, v.lon, m0, lon, my, 0); n++; if (hi > 1) { placeFlat(n * 3, cF, v.lon, m0, lon, my, hi); n++; } continue; }
        place(n * 3, f, lon, lat, 0); n++;
        if (hi > 1) { place(n * 3, f, lon, lat, hi); n++; }
      }
    }
    // the far side of the globe: every sample faces away from the camera
    if (v.morph < 0.98 && z > 1) {
      let away = true;
      for (let i = 0; i < n && away; i++) { const q = i * 3; if ((PX[q]! - C[0]) * (e0 - PX[q]!) + (PX[q + 1]! - C[1]) * (e1 - PX[q + 1]!) + (PX[q + 2]! - C[2]) * (e2 - PX[q + 2]!) >= -R * 1e3 * (1 - v.morph)) away = false; }
      if (away) return;
    }
    let l = true, r = true, b = true, t = true, behind = true, near = Infinity;
    for (let i = 0; i < n; i++) {
      const q = i * 3, X = PX[q]!, Y = PX[q + 1]!, Z = PX[q + 2]!;
      const cx = vp[0]! * X + vp[4]! * Y + vp[8]! * Z + vp[12]!, cy = vp[1]! * X + vp[5]! * Y + vp[9]! * Z + vp[13]!, cw = vp[3]! * X + vp[7]! * Y + vp[11]! * Z + vp[15]!;
      CS[q] = cx; CS[q + 1] = cy; CS[q + 2] = cw;
      if (!(cx < -cw)) l = false; if (!(cx > cw)) r = false; if (!(cy < -cw)) b = false; if (!(cy > cw)) t = false; if (!(cw < 0)) behind = false;
      const d = Math.hypot(X - e0, Y - e1, Z - e2); if (d < near) near = d;
    }
    if (z > 1 && (l || r || b || t || behind)) return;
    // the tile's nearest point: the centre clamped into it (the tile under the camera is as near as the camera)
    place(n * 3, f, Math.min(w0 + (be - bw), Math.max(w0, v.lon)), Math.min(latN, Math.max(latS, v.lat)), hi);
    { const q = n * 3, d = Math.hypot(PX[q]! - e0, PX[q + 1]! - e1, PX[q + 2]! - e2); if (d < near) near = d; }
    if (z > 1 && near > farCut) return;
    const edge = (2 * Math.PI * R * Math.cos(((latN + latS) / 2) * D)) / k2;
    const px = (edge / Math.max(near, 1)) * pxPerRad;
    // hysteresis: a tile split last frame stays split until it is clearly small enough (no flicker of levels while
    // zooming slowly or hovering at a threshold)
    // (over the budget: the ground beyond the view's centre coarser first, the centre and what is nearer kept sharp)
    const limit = (prev?.has(tk(z, x, y)) ? o.tilePx * 0.8 : o.tilePx) * (o.far ? 1 + o.far * Math.max(0, near / Math.max(1, v.dist) - 1) : 1);
    if ((px > limit || z < 2) && z < o.maxZoom) { next?.add(tk(z, x, y)); visit(z + 1, 2 * x, 2 * y); visit(z + 1, 2 * x + 1, 2 * y); visit(z + 1, 2 * x, 2 * y + 1); visit(z + 1, 2 * x + 1, 2 * y + 1); return; }
    let c = 9;
    for (let i = 0; i < n; i++) { const q = i * 3; if (CS[q + 2]! > 0) c = Math.min(c, Math.max(Math.abs(CS[q]! / CS[q + 2]!), Math.abs(CS[q + 1]! / CS[q + 2]!))); }
    want.push({ z, x, y, d: near, c });
  };
  visit(0, 0, 0);
  balance(want, o.maxTiles);
  return want;
}

/** split tiles until every neighbour is at most one level coarser */
export function balance(want: Want[], maxTiles: number): void {
  const leaves = new Map<number, Want>();
  for (const t of want) leaves.set(tk(t.z, t.x, t.y), t);
  const cover = (z: number, x: number, y: number) => { for (let k = z; k >= 0; k--) { const l = leaves.get(tk(k, x >> (z - k), y >> (z - k))); if (l) return l; } return null; };
  for (let pass = 0; pass < 8; pass++) {
    let split = false;
    for (const t of [...leaves.values()]) {
      if (!leaves.has(tk(t.z, t.x, t.y))) continue;
      const n = 2 ** t.z;
      for (let d = 0; d < 4; d++) {
        const dx = d === 0 ? 1 : d === 1 ? -1 : 0, dy = d === 2 ? 1 : d === 3 ? -1 : 0;
        const ny = t.y + dy; if (ny < 0 || ny >= n) continue;
        const c = cover(t.z, (t.x + dx + n) % n, ny);
        if (c && c.z < t.z - 1 && leaves.size < maxTiles - 3) {
          leaves.delete(tk(c.z, c.x, c.y));
          for (let q = 0; q < 4; q++) { const k = { z: c.z + 1, x: 2 * c.x + (q & 1), y: 2 * c.y + (q >> 1), d: c.d, c: c.c }; leaves.set(tk(k.z, k.x, k.y), k); }
          split = true;
        }
      }
    }
    if (!split) break;
  }
  want.length = 0; for (const t of leaves.values()) want.push(t);
}
