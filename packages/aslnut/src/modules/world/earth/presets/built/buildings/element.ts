// modules › world › earth › presets › built › buildings: buildings({ data }): every footprint of a source (Overture,
// OSM, a council's) raised to its height (measured, from its levels, or a default) as built solids, in 500 m chunks.
// A house (by its class, or small and low) is a detached house (walls, a hip or gable roof, windows, a door); a block
// has its roof (flat by default; from its tags or your function: gable, hip, pyramidal, skillion, dome, or a shape of
// your own over its best-fit rectangle) and rows of windows a floor apart that light up at night (a share of them,
// yours: `windows.lit`), rooms seen through them when `windows.interior` is set.
//   w.add(buildings({ id: 'buildings', data: data.geojson('/buildings.geojson'), roofs: true, windows: { lit: (s) => s.time.local.hour > 22 ? .2 : .5 } }))
import { earcut } from '../../../../../../core/geometry/build/earcut.ts';
import { MeshBuilder, vary, type Colorish, type V3 } from '../../../../../../core/geometry/shapes/mesh.ts';
import { Solids, type SolidsProps } from '../../../../../../core/geometry/shapes/solids.ts';
import { Source } from '../../../../../../core/data/sources/source.ts';
import type { Feature } from '../../../../../../core/data/features.ts';
import type { AttachContext } from '../../../../../../core/world/element.ts';
import { LAMP_CODES } from '../../../../../../core/render/look/materials.ts';
import { D } from '../../../../../../core/space/geo.ts';
import { orientedBox, signedArea, Rng, seedOf, type P2 } from '../../../shared/plan.ts';
import { BLOCK, HOUSE, house, isHouse, type BlockLook, type HouseLook, type RoofShape } from './index.ts';
import type { Leveled } from '../../../../../../core/observation/presence.ts';

/** a roof by kind, or a shape of your own built over the footprint's best-fit rectangle (its params: width, depth,
 *  height: metres; x along the rectangle's long side, its foot at the eaves) */
export type RoofKind = 'flat' | 'gable' | 'hip' | 'pyramidal' | 'skillion' | 'dome';
export type { RoofShape };
export type Roof = RoofKind | RoofShape;
/** a building's look: its walls, roof and windows (colours) */
export interface BuildingLook { wall: string; roof: string; window: string }
export interface BuildingsProps extends Omit<SolidsProps, 'windows'> {
  data: Source | Feature[];
  /** its height, m (default: props height, h or est_height; else its levels × `floor`; else `fallback`) */
  height?: (d: Feature) => number;
  /** a floor's height, m (default 3.2) */
  floor?: number;
  /** a building of no height known, m (default 6.4) */
  fallback?: number;
  /** its look: your function (a part of it: the rest from the palette), or the palettes (a seeded pick by id) */
  look?: ((d: Feature) => Partial<BuildingLook>) | { block?: BlockLook; house?: HouseLook };
  /** a house (default: by its class (house, residential, detached, terrace …) or small and low); its door faces its
   *  `front` (degrees clockwise from north: towards its street; default its props' `front`, else from its shape), its
   *  roof a gable or a hip when its tags say so (with `roofs`) */
  house?: (d: Feature, area: number, height: number) => boolean;
  front?: (d: Feature) => number | null | undefined;
  /** roofs: false (flat, the default), true (from its tags: roof:shape, roof:height, roof:angle; flat when none), or
   *  your function (a kind, a shape, null: flat) */
  roofs?: boolean | ((d: Feature) => Roof | null | undefined);
  /** a pitched roof's angle, degrees (default 25; a tag's or your height wins) */
  pitch?: number;
  /** its windows: none (false), or rows a floor apart on blocks over two floors; at night a share of them lit (`lit`:
   *  0..1 or your function of the state; default .45), rooms behind the glass (`interior`) */
  windows?: false | { lit?: number | ((s: import('../../../../../../core/world/state.ts').State) => number); interior?: boolean };
  /** where the walls start (m under the ground: a slope shows no gap; default 1) */
  sink?: number;
}
const CHUNK = 500, KZ = 110574;
const ROOF_TAGS = ['roof:shape', 'roof_shape', 'roofShape'];
const KINDS: Record<string, RoofKind> = { flat: 'flat', gabled: 'gable', gable: 'gable', hipped: 'hip', hip: 'hip', 'half-hipped': 'hip', pyramidal: 'pyramidal', skillion: 'skillion', lean_to: 'skillion', dome: 'dome', onion: 'dome', round: 'dome', gambrel: 'gable', mansard: 'hip', saltbox: 'gable' };
/** a roof kind from a feature's tags (OSM's roof:shape names), or null */
export function roofOf(props: Record<string, unknown>): RoofKind | null {
  for (const k of ROOF_TAGS) { const v = props[k]; if (typeof v === 'string' && KINDS[v.toLowerCase()]) return KINDS[v.toLowerCase()]!; }
  return null;
}
const num = (v: unknown) => { const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN; return Number.isFinite(n) ? n : null; };

export class Buildings extends Solids {
  private bp: BuildingsProps; private src: Source | null = null; private seen = -1; private off: (() => void) | null = null;
  constructor(p: BuildingsProps) {
    const w = p.windows;
    super({ hover: { color: '#ffd166' }, ...p, windows: w === false ? undefined : w ? { lit: w.lit, interior: w.interior } : undefined } as SolidsProps);
    // (its own props: those given by level as resolved now)
    const run = this.props as unknown as Record<string, unknown>;
    this.bp = { ...p, ...Object.fromEntries(Object.keys(this.byLevel).filter((k) => k !== 'windows').map((k) => [k, run[k]])) } as BuildingsProps;
  }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    const d = this.bp.data;
    if (d instanceof Source) { this.src = d; this.off = d.watch(() => this.build()); void d.start({ loader: ctx.loader, error: (e) => ctx.world.error(e) }).then(() => this.build()); }
    else this.build();
  }
  override detach(): void { this.off?.(); this.off = null; super.detach(); }
  /** build again (your functions or the data changed) */
  refresh(): this { this.seen = -1; this.build(); return this; }
  private build(): void {
    if (this.src && this.src.version === this.seen) return;
    this.seen = this.src?.version ?? 0;
    const fs = (this.src ? this.src.features() : (this.bp.data as Feature[])).map((f) => ((f as Feature).props ? f : { ...f, props: (f as unknown as { properties?: Record<string, unknown> }).properties ?? {} }) as Feature);
    for (const k of this.keys()) this.drop(k);
    const polys: { f: Feature; rings: [number, number][][] }[] = [];
    for (const f of fs) {
      const g = f.geometry as { type: string; coordinates: unknown } | null; if (!g) continue;
      if (g.type === 'Polygon') polys.push({ f, rings: (g.coordinates as [number, number][][]) });
      else if (g.type === 'MultiPolygon') for (const p of g.coordinates as [number, number][][][]) polys.push({ f, rings: p });
    }
    if (!polys.length) return;
    // chunks of 500 m in one metric frame from the first building; each building in the chunk its middle is in
    const o0 = polys[0]!.rings[0]![0]!, origin: [number, number] = [o0[0], o0[1]], kx = 111320 * Math.cos(origin[1] * D), by = new Map<string, typeof polys>();
    for (const p of polys) {
      let x = 0, z = 0; const r = p.rings[0]!; for (const [lon, lat] of r) { x += (lon - origin[0]) * kx; z += -(lat - origin[1]) * KZ; }
      const key = `${Math.floor(x / r.length / CHUNK)}_${Math.floor(z / r.length / CHUNK)}`; let a = by.get(key); if (!a) by.set(key, (a = [])); a.push(p);
    }
    for (const [key, list] of by) {
      const [ix, iz] = key.split('_').map(Number) as [number, number], far = new MeshBuilder(), infos: { id: string | number; props: Record<string, unknown> }[] = [];
      const rings: (P2[] | null)[] = list.map((p) => {
        const ring = p.rings[0]!.map(([lon, lat]) => [(lon - origin[0]) * kx - ix * CHUNK, -(lat - origin[1]) * KZ - iz * CHUNK] as P2);
        if (ring.length > 3 && ring[0]![0] === ring[ring.length - 1]![0] && ring[0]![1] === ring[ring.length - 1]![1]) ring.pop();
        return ring.length < 3 ? null : ring;
      });
      list.forEach((p, id) => {
        const ring = rings[id]; if (!ring) return;
        const h = this.oneBuilding(far.as(id), ring, p.f, true);
        infos[id] = { id: p.f.id ?? `${key}:${id}`, props: { ...(p.f.props as Record<string, unknown>), 'height (m)': +h.toFixed(1) } };
      });
      // the whole mesh (windows, a house's door, soffit and chimney) made when the chunk comes near, let go far away
      const whole = () => { const mb = new MeshBuilder(); list.forEach((p, id) => { const ring = rings[id]; if (ring) this.oneBuilding(mb.as(id), ring, p.f, false); }); return mb.build(); };
      this.put(key, { origin, side: CHUNK, at: [ix * CHUNK, iz * CHUNK], mesh: whole, far: far.build(), info: (id) => { const x = infos[id]; return x ? { kind: 'building', id: x.id, props: x.props } : null; } });
    }
  }
  /** one building into the chunk's meshes (and its far one): its height */
  /** one building into a chunk's mesh: whole (windows, a house's details) or far (walls and roofs only: far away and
   *  the sun's shadow map); its height */
  private oneBuilding(m: MeshBuilder, ring0: P2[], f: Feature, far: boolean): number {
    const p = this.bp, props = f.props as Record<string, unknown>, floor = p.floor ?? 3.2;
    const levels = num(props['building:levels']) ?? num(props.levels) ?? num(props.num_floors);
    const h = Math.max(2.5, p.height?.(f) ?? num(props.height) ?? num(props.h) ?? num(props.est_height) ?? (levels ? levels * floor : null) ?? p.fallback ?? 6.4);
    const ring = signedArea(ring0) > 0 ? ring0 : [...ring0].reverse(), area = Math.abs(signedArea(ring));
    let cx = 0, cz = 0; for (const [x, z] of ring) { cx += x; cz += z; } cx /= ring.length; cz /= ring.length;
    m.on([cx, cz]);
    // (the same seed for both meshes: the same building near and far)
    const rnd = new Rng(seedOf(cx * 100, cz * 100, ring.length)), cls = String(props.class ?? props.cls ?? props.building ?? props.subtype ?? '');
    const lookFn = typeof p.look === 'function' ? p.look : null, pal = lookFn ? null : (p.look as { block?: BlockLook; house?: HouseLook } | undefined);
    const own = lookFn?.(f) ?? {}, sink = -(p.sink ?? 1);
    if ((p.house ?? ((_d, a, hh) => isHouse(cls, a, hh)))(f, area, h)) {
      const tagged = p.roofs === true ? roofOf(props) : null, fr = p.front ? p.front(f) ?? null : num(props.front);
      const hl = { ...(pal?.house ?? HOUSE), ...(tagged === 'gable' || tagged === 'hip' ? { forms: { [tagged]: 1 } } : {}), ...(own.wall ? { walls: { [own.wall]: 1 } } : {}), ...(own.roof ? { roofs: { [own.roof]: 1 } } : {}), ...(own.window ? { windowColor: own.window } : {}) };
      house(m, { ring, height: h, ...(fr !== null ? { front: { x: Math.sin(fr * D), z: -Math.cos(fr * D) } } : {}) }, hl, rnd, far, sink, p.windows !== false);
      return h;
    }
    const bl = pal?.block ?? BLOCK, wall = own.wall ?? vary(rnd.pick(bl.walls), rnd.next(), 0.06), roof = own.roof ?? rnd.pick(bl.roofs), win = own.window ?? bl.window;
    // its roof: flat, from its tags, or yours; a pitched one rises over the eaves
    const r = p.roofs === true ? roofOf(props) : typeof p.roofs === 'function' ? p.roofs(f) ?? null : null;
    const box = orientedBox(ring), pitch = (num(props['roof:angle']) ?? p.pitch ?? 25) * D, kind = r && typeof r === 'string' ? r : null;
    const rise = !r || r === 'flat' ? 0 : Math.min(h * 0.6, num(props['roof:height']) ?? (kind === 'dome' ? box.b : kind === 'skillion' ? 2 * box.b * Math.tan(pitch) * 0.5 : box.b * Math.tan(pitch)));
    const eave = h - rise;
    m.prism(ring, sink, eave, wall, roof, earcut(ring.flat(), [], 2));
    if (r && r !== 'flat') { if (typeof r === 'string') roofMesh(m, box, eave, rise, r, roof, wall); else r.into(m, { width: box.a * 2, depth: box.b * 2, height: rise }, { at: [box.cx, eave, box.cz], turn: (Math.atan2(box.uz, box.ux) * 180) / Math.PI, level: far ? 2 : 0 }); }
    // rows of windows a floor apart on blocks over two floors (lit from dusk: lamps 'windows')
    if (!far && p.windows !== false && eave > floor * 2) windowRows(m, ring, eave, floor, win);
    return h;
  }

}
/** rows of windows on a block's walls (each wall of 3 m or more), a floor apart, as lit windows (lamps 'windows') */
export function windowRows(mb: MeshBuilder, ring: readonly P2[], top: number, floor: number, color: Colorish): void {
  mb.material(LAMP_CODES.windows);
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    const [ax, az] = ring[i]!, [bx, bz] = ring[(i + 1) % n]!, len = Math.hypot(bx - ax, bz - az); if (len < 3) continue;
    const tx = (bx - ax) / len, tz = (bz - az) / len, nx = -tz * 0.06, nz = tx * 0.06, k = Math.max(1, Math.floor(len / floor)), w = Math.min(1.8, len / k - 0.8);
    for (let y = floor * 0.35; y + floor * 0.45 < top - 0.6; y += floor) for (let j = 0; j < k; j++) {
      const c = ((j + 0.5) / k) * len;
      mb.wall(ax + tx * (c - w / 2) + nx, az + tz * (c - w / 2) + nz, ax + tx * (c + w / 2) + nx, az + tz * (c + w / 2) + nz, y, y + floor * 0.45, color);
    }
  }
  mb.material(0);
}
/** a pitched roof over a best-fit rectangle (its eaves at `eave`, its top `rise` above): gable (end walls in the
 *  wall's colour), hip, pyramidal, skillion (its high side −v), dome; each face outward */
export function roofMesh(mb: MeshBuilder, box: ReturnType<typeof orientedBox>, eave: number, rise: number, kind: RoofKind, roof: Colorish, wall: Colorish): void {
  const { cx, cz, ux, uz, vx, vz, a: A, b: B } = box, top = eave + rise, mid: V3 = [cx, eave + rise * 0.4, cz];
  const C = (u: number, v: number, y: number): V3 => [cx + ux * u + vx * v, y, cz + uz * u + vz * v];
  // a triangle facing away from the roof's middle
  const out = (a: V3, b: V3, c: V3, col: Colorish) => {
    const n = [(b[1] - a[1]) * (c[2] - a[2]) - (b[2] - a[2]) * (c[1] - a[1]), (b[2] - a[2]) * (c[0] - a[0]) - (b[0] - a[0]) * (c[2] - a[2]), (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])];
    const m = [(a[0] + b[0] + c[0]) / 3 - mid[0], (a[1] + b[1] + c[1]) / 3 - mid[1], (a[2] + b[2] + c[2]) / 3 - mid[2]];
    if (n[0]! * m[0]! + n[1]! * m[1]! + n[2]! * m[2]! >= 0) mb.tri(a, b, c, col); else mb.tri(a, c, b, col);
  };
  const quad = (a: V3, b: V3, c: V3, d: V3, col: Colorish) => { out(a, b, c, col); out(a, c, d, col); };
  const c1 = C(-A, -B, eave), c2 = C(A, -B, eave), c3 = C(A, B, eave), c4 = C(-A, B, eave);
  if (kind === 'gable') { const r1 = C(-A, 0, top), r2 = C(A, 0, top); quad(c1, c2, r2, r1, roof); quad(c3, c4, r1, r2, roof); out(c4, c1, r1, wall); out(c2, c3, r2, wall); return; }
  if (kind === 'hip') { const rh = Math.max(0, A - B), r1 = C(-rh, 0, top), r2 = C(rh, 0, top); quad(c1, c2, r2, r1, roof); quad(c3, c4, r1, r2, roof); out(c4, c1, r1, roof); out(c2, c3, r2, roof); return; }
  if (kind === 'pyramidal') { const p = C(0, 0, top); out(c1, c2, p, roof); out(c2, c3, p, roof); out(c3, c4, p, roof); out(c4, c1, p, roof); return; }
  if (kind === 'skillion') { const h1 = C(-A, -B, top), h2 = C(A, -B, top); quad(h1, h2, c3, c4, roof); quad(c1, c2, h2, h1, wall); out(c4, c1, h1, wall); out(c2, c3, h2, wall); return; }
  // a dome: a half-ellipsoid on the rectangle's inscribed circle (its radius the half width), `rise` high
  const n = 16, m = 6, R = B;
  for (let j = 0; j < m; j++) for (let i = 0; i < n; i++) {
    const p = (j0: number, i0: number): V3 => { const ph = (j0 / m) * (Math.PI / 2), th = (i0 / n) * Math.PI * 2, rr = R * Math.cos(ph); return C(Math.cos(th) * rr, Math.sin(th) * rr, eave + rise * Math.sin(ph)); };
    if (j === m - 1) out(p(j, i), p(j, i + 1), p(m, 0), roof); else quad(p(j, i), p(j, i + 1), p(j + 1, i + 1), p(j + 1, i), roof);
  }
  void A;
}
/** buildings from any source of footprints: buildings({ data, height, roofs, windows }) */
export const buildings = (p: Leveled<BuildingsProps>) => new Buildings(p as BuildingsProps);
