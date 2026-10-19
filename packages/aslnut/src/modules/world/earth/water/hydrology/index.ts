// modules › world › earth › water › hydrology: water on the ground as built solids: lakes and ponds (their shapes, flat on
// the ground), streams and drains (ribbons of their width), in the water material (the sky's light and its shine);
// water({ lakes, rivers, sea }) draws them from any source, and gives the world its sea: the ground under sea level (or
// yours: a tide) is drawn as water (the terrain's seafloor under it), at every zoom.
//   w.add(water({ id: 'water', lakes: data.geojson('/lakes.geojson'), rivers: data.geojson('/waterways.geojson') }))
import { earcut } from '../../../../../core/geometry/build/earcut.ts';
import { MeshBuilder } from '../../../../../core/geometry/shapes/mesh.ts';
import { Solids, type SolidsProps } from '../../../../../core/geometry/shapes/solids.ts';
import { Source } from '../../../../../core/data/sources/source.ts';
import type { Feature } from '../../../../../core/data/features.ts';
import type { AttachContext, FrameContext, ElementStatus, Sea } from '../../../../../core/world/element.ts';
import type { DrawCall } from '../../../../../core/render/graphics/interface.ts';
import type { State } from '../../../../../core/world/state.ts';
import { MATERIAL_CODES } from '../../../../../core/render/look/materials.ts';
import { D } from '../../../../../core/space/geo.ts';
import { densify, type P2 } from '../../shared/plan.ts';

export interface WaterLook { water: string; stream: string; sea: string }
export const WATER: WaterLook = { water: '#3f7fae', stream: '#3f7fae', sea: '#2f6a96' };
/** a lake's shape on the ground (a little over it), in the water material */
export function waterArea(mb: MeshBuilder, ring: readonly P2[], l: Partial<WaterLook> = WATER): void { mb.material(MATERIAL_CODES.water).floor(ring, 0.25, l.water ?? WATER.water, earcut(ring.flat(), [], 2)).material(0); }
/** a stream as a ribbon of its width on the ground, in the water material */
export function stream(mb: MeshBuilder, pts: readonly P2[], width: number, l: Partial<WaterLook> = WATER): void { mb.material(MATERIAL_CODES.water).ribbon(densify(pts, 6), -width / 2, width / 2, 0.25, l.stream ?? WATER.stream).material(0); }
/** a watercourse's width by its kind (OSM's waterway, Vicmap's feature type), m */
export function widthOf(props: Record<string, unknown>): number {
  const w = Number(props.width); if (Number.isFinite(w) && w > 0) return w;
  const k = String(props.waterway ?? props.feature_type_code ?? props.kind ?? '').toLowerCase();
  return /river/.test(k) ? 20 : /canal/.test(k) ? 12 : /channel|drain/.test(k) ? 3 : /ditch/.test(k) ? 1.5 : /stream|creek|watercourse/.test(k) ? 4 : 3;
}
export interface WaterProps extends SolidsProps {
  /** lakes, ponds, reservoirs: polygons */
  lakes?: Source | Feature[];
  /** rivers, creeks, drains: lines (their width: `width`) */
  rivers?: Source | Feature[];
  /** a watercourse's width, m (default its props' width, else by its kind: river 20, canal 12, creek 4, drain 3) */
  width?: (d: Feature) => number;
  /** the sea: the ground under its level drawn as water (default true; false: none) */
  sea?: boolean;
  /** sea level, m (default 0): a number, or your function of the state (a tide, a rise) */
  level?: number | ((s: State) => number);
  look?: Partial<WaterLook>;
  /** lakes and rivers are drawn while the camera is nearer than this, m (default 8000; the sea at every distance) */
  near?: number;
}
const CHUNK = 500, KZ = 110574;
export class Water extends Solids {
  private wp: WaterProps; private srcs: Source[] = []; private offs: (() => void)[] = []; private seenV = '';
  constructor(p: WaterProps) { super({ hover: false, shadows: false, ...p }); this.wp = p; }
  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    for (const d of [this.wp.lakes, this.wp.rivers]) if (d instanceof Source) { this.srcs.push(d); this.offs.push(d.watch(() => this.build())); void d.start({ loader: ctx.loader, error: (e) => ctx.world.error(e) }).then(() => this.build()); }
    this.build();
  }
  override detach(): void { for (const o of this.offs) o(); this.offs = []; this.srcs = []; super.detach(); }
  private feats(d: Source | Feature[] | undefined): Feature[] {
    if (!d) return [];
    return (d instanceof Source ? d.features() : d).map((f) => ((f as Feature).props ? f : { ...f, props: (f as unknown as { properties?: Record<string, unknown> }).properties ?? {} }) as Feature);
  }
  /** the lakes and rivers in 500 m chunks (each a picking id: its name and kind) */
  private build(): void {
    const v = this.srcs.map((s) => s.version).join(','); if (v === this.seenV && this.seenV !== '') return; this.seenV = v || 'none';
    for (const k of this.keys()) this.drop(k);
    const items: { f: Feature; lake: boolean; pts: [number, number][] }[] = [];
    for (const f of this.feats(this.wp.lakes)) { const g = f.geometry as { type: string; coordinates: unknown } | null; if (!g) continue; for (const poly of g.type === 'Polygon' ? [g.coordinates as [number, number][][]] : g.type === 'MultiPolygon' ? (g.coordinates as [number, number][][][]) : []) items.push({ f, lake: true, pts: poly[0]! }); }
    for (const f of this.feats(this.wp.rivers)) { const g = f.geometry as { type: string; coordinates: unknown } | null; if (!g) continue; for (const line of g.type === 'LineString' ? [g.coordinates as [number, number][]] : g.type === 'MultiLineString' ? (g.coordinates as [number, number][][]) : []) items.push({ f, lake: false, pts: line }); }
    if (!items.length) return;
    const o = items[0]!.pts[0]!, origin: [number, number] = [o[0], o[1]], kx = 111320 * Math.cos(origin[1] * D), by = new Map<string, typeof items>();
    for (const it of items) { const p = it.pts[0]!, key = `${Math.floor(((p[0] - origin[0]) * kx) / CHUNK)}_${Math.floor((-(p[1] - origin[1]) * KZ) / CHUNK)}`; let a = by.get(key); if (!a) by.set(key, (a = [])); a.push(it); }
    for (const [key, list] of by) {
      const [ix, iz] = key.split('_').map(Number) as [number, number], mb = new MeshBuilder(), infos: { id: string | number; props: Record<string, unknown> }[] = [];
      list.forEach((it, id) => {
        const pts = it.pts.map(([lon, lat]) => [(lon - origin[0]) * kx - ix * CHUNK, -(lat - origin[1]) * KZ - iz * CHUNK] as P2);
        mb.as(id); infos[id] = { id: it.f.id ?? `${key}:${id}`, props: { ...(it.f.props as Record<string, unknown>) } };
        if (it.lake) { if (pts.length > 3) waterArea(mb, pts.slice(0, -1), this.wp.look); }
        else { const w = this.wp.width?.(it.f) ?? widthOf(it.f.props as Record<string, unknown>); infos[id]!.props['width (m)'] = w; stream(mb, pts, w, this.wp.look); }
      });
      this.put(key, { origin, side: CHUNK, at: [ix * CHUNK, iz * CHUNK], mesh: mb.build(), info: (id) => { const x = infos[id]; return x ? { kind: 'water', id: x.id, props: x.props } : null; } });
    }
  }
  /** the sea level now (m) */
  seaLevel(s: State): number { const l = this.wp.level; return typeof l === 'function' ? l(s) : l ?? 0; }
  /** lakes and rivers only near (small far away: no draws for them); the sea is the ground's at every distance */
  override frame(ctx: FrameContext): DrawCall[] { this.far = ctx.camera.dist > (this.wp.near ?? 8000); return this.far ? [] : super.frame(ctx); }
  private far = false;
  /** far away its lakes and rivers are not drawn: no frames for them (their last near frame's fade or shimmer is
   *  not on screen) */
  override animating(): boolean { return !this.far && super.animating(); }
  override wantsFrames(s: State): number { return this.far ? 0 : super.wantsFrames(s); }
  /** far away its lakes and rivers are not drawn: nothing of theirs to wait for */
  override status(): ElementStatus { const st = super.status(); return this.far ? { ...st, pending: [], ready: !st.failed.length } : st; }
  /** the sea it gives the world (unless `sea: false`): the ground under the level is drawn as water, at every zoom,
   *  on the globe and flat */
  override sea(s: State): Sea | null { return this.wp.sea === false ? null : { level: this.seaLevel(s), color: this.seaColour }; }
  private get seaColour(): [number, number, number] { const h = (this.wp.look?.sea ?? WATER.sea).replace('#', ''); return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4, 6), 16) / 255]; }

}
/** lakes, rivers and the sea from any sources: water({ lakes, rivers, sea, level }) */
export const water = (p: WaterProps = {}) => new Water(p);
