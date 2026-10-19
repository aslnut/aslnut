// modules › world › earth › presets › built › infrastructure › utilities › pole: timber power poles with a crossarm along one side of a
// street, every `spacing` metres, and the wires between them: spans that sag, drawn one pixel wide (a line mark at
// the heights of the pole tops, so they never vanish or shimmer at a distance).
//   poles(mb, pts, offset, POLES, spans)       w.add(wires({ data: spansSource }))
import type { MeshBuilder } from '../../../../../../core/geometry/shapes/mesh.ts';
import { Line, type LineProps } from '../../../../../../core/encoding/marks/line.ts';
import type { Entry } from '../../../../../../core/encoding/marks/features.ts';
import type { FrameContext } from '../../../../../../core/world/element.ts';
import type { P2 } from '../../../shared/plan.ts';
import type { Leveled } from '../../../../../../core/observation/presence.ts';

export interface PoleLook { spacing: number; height: number; chance: number; wires: boolean; color: string; wire: string }
export const POLES: PoleLook = { spacing: 42, height: 10, chance: 0.75, wires: true, color: '#6b5a46', wire: '#1f2328' };
/** a wire span between two pole tops (x, z in the builder's metres), both sides of the crossarm */
export interface Span { ax: number; az: number; bx: number; bz: number; top: number }
/** poles along a line, `offset` metres to its right (negative: left); spans go into `spans` */
export function poles(mb: MeshBuilder, pts: readonly P2[], offset: number, p: PoleLook, spans: Span[]): number {
  let carry = p.spacing * 0.5, prev: P2 | null = null, n = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, az] = pts[i]!, [bx, bz] = pts[i + 1]!, len = Math.hypot(bx - ax, bz - az); if (len < 0.01) continue;
    const tx = (bx - ax) / len, tz = (bz - az) / len, nx = -tz, nz = tx;
    for (let t = carry; t < len; t += p.spacing) {
      const x = ax + tx * t + nx * offset, z = az + tz * t + nz * offset, ang = Math.atan2(tz, tx);
      mb.on([x, z]);
      mb.box(x, z, -0.2, 0.28, p.height + 0.2, 0.28, ang, p.color);
      mb.box(x, z, p.height - 0.6, 0.12, 0.12, 2.0, ang, p.color);
      if (p.wires && prev) for (const s of [-0.85, 0.85]) spans.push({ ax: prev[0] + nx * s, az: prev[1] + nz * s, bx: x + nx * s, bz: z + nz * s, top: p.height - 0.5 });
      prev = [x, z]; carry = t; n++;
    }
    carry -= len; if (carry < 0) carry += p.spacing;
  }
  return n;
}

export interface WireDatum { a: [number, number]; b: [number, number]; /** metres over the ground at each end */ top: number }
export interface WiresProps<D> extends LineProps<D> {
  /** the span's ends [lon, lat] and its height over the ground */
  span?: (d: D) => WireDatum;
  /** metres of sag in the middle (default 0.6) */
  sag?: number;
}
/** wires between poles: each span a line that sags between the pole tops, one pixel wide, at true heights */
export class Wires<D = WireDatum> extends Line<D> {
  /** its props as it runs (given by level: the values for the level now) */
  private get w(): WiresProps<D> { return this.props as unknown as WiresProps<D>; }
  private pf = new Int32Array(0);
  constructor(p: WiresProps<D>) { super({ width: 1, color: POLES.wire, pickable: false, detail: { step: 1e12 }, ...p, on: 'absolute' } as LineProps<D>); }
  // a row's datum is the span itself, or a feature holding it in its props (rows from a source)
  private spanOf(d: D): WireDatum { if (this.w.span) return this.w.span(d); const x = d as unknown as WireDatum & { props?: WireDatum }; return x.a ? x : x.props!; }
  protected override read(now: number): Entry<D>[] {
    return super.read(now).map((e) => {
      const s = this.spanOf(e.d), pts: [number, number][] = [];
      for (let k = 0; k <= 8; k++) pts.push([s.a[0] + (s.b[0] - s.a[0]) * k / 8, s.a[1] + (s.b[1] - s.a[1]) * k / 8]);
      return { ...e, geometry: { type: 'LineString' as const, coordinates: pts } };
    });
  }
  protected override built2(): void {
    const s = this.segs, pf = new Int32Array(s.h.length).fill(-1);
    for (let i = 0; i < s.count; i++) { const q = i * 5; pf[s.seg[q]!] = s.seg[q + 4]!; pf[s.seg[q + 1]!] = s.seg[q + 4]!; }
    this.pf = pf;
  }
  protected override ground(ctx: FrameContext): void {
    const s = this.segs, ex = ctx.world.exaggeration, sag = this.w.sag ?? 0.6, per = new Map<number, [number, number, number]>();
    const g = (p: [number, number]) => { const v = ctx.world.heightAt(p[0], p[1]); return Number.isNaN(v) ? 0 : v * ex; };
    s.heights((i) => {
      const fi = this.pf[i]!; if (fi < 0) return 0;
      let r = per.get(fi); if (!r) { const sp = this.spanOf(this.bySlot[fi]!.d); r = [g(sp.a), g(sp.b), sp.top]; per.set(fi, r); }
      const t = s.frac[i]!; return r[0] + (r[1] - r[0]) * t + r[2] - sag * 4 * t * (1 - t);
    });
    this.upload(ctx);
  }
}
export const wires = <D = WireDatum>(p: Leveled<WiresProps<D>>) => new Wires<D>(p as WiresProps<D>);
