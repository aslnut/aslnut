// core › geometry › marks › extrusion: footprints raised into blocks: buildings from their outlines, or a value on a
// map as a height (a 3D choropleth). Each block stands on the lowest ground under its footprint; walls and a roof lit
// by the sun; reveal modes rise (grow up), pop, sweep and fade, in any order (outward from a place, biggest first).
//   extrusion({ id: 'buildings', data, height: d => d.props.levels * 3.2, color: '#d9d4c7', reveal: { mode: 'rise', stagger: .01 } })
import { polygonsOf, type Feature } from '../../data/features.ts';
import type { FrameContext } from '../../world/element.ts';
import type { State } from '../../world/state.ts';
import type { DrawCall, GBuffer } from '../../render/graphics/interface.ts';
import { EXTRUSION_GLSL } from '../../render/graphics/shaders/extrusion.glsl.ts';
import { EXTRUSION_WGSL } from '../../render/graphics/shaders/extrusion.wgsl.ts';
import { HOOK_POINTS, assemble, type ShaderCode } from '../../render/graphics/shaders/hooks.ts';
import { rgba, type Color } from '../../render/style/color.ts';
import { polygonMesh } from '../../geometry/build/mesh.ts';
import { FeatureMark, P_BOX, P_NUMBERS, Prog, type Entry, type FeatureMarkProps, type PerFeature, type Styled } from './features.ts';
import type { Leveled } from '../../observation/presence.ts';

export interface ExtrusionProps<D> extends FeatureMarkProps<D> {
  /** metres (default 10) */
  height?: PerFeature<number, D>;
  color?: PerFeature<Color, D>;
  value?: PerFeature<number, D>;
  /** casts the sun's shadow and takes shadows (when the world draws them; default true) */
  shadows?: boolean;
}
const val = <T, D>(v: PerFeature<T, D> | undefined, d: D, s: State, def: T): T => (v === undefined ? def : typeof v === 'function' ? (v as (d: D, s: State) => T)(d, s) : v);
const V = 8;

export class Extrusion<D = Feature> extends FeatureMark<D, ExtrusionProps<D>> {
  readonly kind = 'extrusion' as const;
  protected readonly mark = 'extrusion';
  /** its shaders read each feature's numbers (height, the lowest ground under it) and box */
  protected override planesWanted(): number { return super.planesWanted() | (1 << P_NUMBERS) | (1 << P_BOX); }
  private lonlat = new Float64Array(0); private corner = new Int32Array(0); private verts = new Float32Array(0); private feature = new Int32Array(0); private vbuf: GBuffer | null = null; private n = 0;
  protected programs(code: ShaderCode): Prog[] {
    const src = assemble({ wgsl: EXTRUSION_WGSL, glsl: EXTRUSION_GLSL }, HOOK_POINTS.extrusion, code, this.paramBlock!, `layer '${this.id}'`);
    return [new Prog(this.g!, {
      label: `extrusion ${this.id}`, wgsl: src.wgsl, glsl: src.glsl, blocks: ['Frame', 'L', 'Params'], textures: [{ name: 'feat', kind: '2d', sample: 'unfilterable' }, { name: 'shadowMap', kind: '2d', sample: 'float' }],
      vertex: { stride: V, attributes: [{ name: 'v', location: 0, size: 4, offset: 0 }, { name: 'n', location: 1, size: 4, offset: 4 }] }, blend: this.props.blend ?? 'alpha', depth: { write: true, test: 'less' }, cull: 'none',
    })];
  }
  protected styleProps(): unknown[] { return [this.props.color, this.props.height, this.props.value]; }
  protected style(e: Entry<D>, s: State): Styled {
    return { color: rgba(val(this.props.color, e.d, s, '#d8d2c4' as Color)), number: val(this.props.height, e.d, s, 10), value: val(this.props.value, e.d, s, 0) };
  }
  protected build(ctx: FrameContext): void {
    const ll: number[] = [], vs: number[] = [], fs: number[] = [], ix: number[] = [], seen = new Map<string, number>();
    // each corner's ground is read once (a corner is in about six vertices: roof, walls)
    const put = (x: number, y: number, f: number, n: [number, number, number], top: number) => {
      const key = `${x},${y}`; let k = seen.get(key);
      if (k === undefined) { k = ll.length / 2; seen.set(key, k); const p = this.origin.lonLat(x, y); ll.push(p[0], p[1]); }
      ix.push(k); vs.push(x, y, 0, f, n[0], n[1], n[2], top); fs.push(f);
    };
    for (const e of this.entries) {
      for (const rings of polygonsOf(e.geometry)) {
        // the roof: the footprint's triangles (no splitting: a roof is flat)
        const m = polygonMesh(this.origin, rings, 1e12);
        for (const t of m.tris) put(m.xy[2 * t]!, m.xy[2 * t + 1]!, e.index, [0, 1, 0], 1);
        // the walls: each edge, outward
        rings.forEach((r, ri) => {
          const pts = r.map((p) => this.origin.rel(p[0], p[1]));
          let a2 = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a2 += (pts[j]![0] - pts[i]![0]) * (pts[j]![1] + pts[i]![1]);
          // a2 = Σ (x_prev − x) (y_prev + y): positive for a counter-clockwise ring (y north)
          const ccw = a2 > 0, out = ri === 0 ? ccw : !ccw;
          for (let i = 0; i + 1 < pts.length; i++) {
            const a = pts[i]!, b = pts[i + 1]!, dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
            // outward in east / north, as world x (east), y (up), z (south)
            const ne = (out ? dy : -dy) / l, nn = (out ? -dx : dx) / l, n: [number, number, number] = [ne, 0, -nn];
            put(a[0], a[1], e.index, n, 0); put(b[0], b[1], e.index, n, 0); put(a[0], a[1], e.index, n, 1);
            put(a[0], a[1], e.index, n, 1); put(b[0], b[1], e.index, n, 0); put(b[0], b[1], e.index, n, 1);
          }
        });
      }
    }
    this.lonlat = Float64Array.from(ll); this.corner = Int32Array.from(ix); this.verts = Float32Array.from(vs); this.feature = Int32Array.from(fs); this.n = fs.length;
    this.vbuf?.destroy(); this.vbuf = this.n ? ctx.graphics.buffer('vertex', this.verts, `${this.id} vertices`) : null;
    this.boxes();
  }
  protected override groundEvery = 600;
  protected ground(ctx: FrameContext): void {
    const v = this.verts, ll = this.lonlat, f = this.featData, lowest = new Float64Array(this.bySlot.length).fill(Infinity);
    const nc = ll.length / 2, hc = new Float64Array(nc);
    for (let c = 0; c < nc; c++) hc[c] = this.groundAt(ctx, ll[2 * c]!, ll[2 * c + 1]!);
    for (let i = 0; i < this.n; i++) { const h = hc[this.corner[i]!]!; v[i * V + 2] = h; const k = this.feature[i]!; if (h < lowest[k]!) lowest[k] = h; }
    for (const e of this.entries) f[this.at(e.index, 3) + 3] = Number.isFinite(lowest[e.index]!) ? lowest[e.index]! : 0;
    this.vbuf?.write(v);
    this.touch(P_NUMBERS); this.flushPlanes();
  }
  protected override uniforms(): void { this.L.set([this.props.depthBias ?? 0.5, 0, 0, 0], 28); this.L.set([0, 0, 0, 0], 32); this.L.set([0, 0, 0, 0], 36); }
  protected draws(ctx: FrameContext): DrawCall[] {
    if (!this.vbuf || !this.n) return [];
    const d = this.call(this.progs[0]!, { vertices: this.vbuf, count: this.n }, ctx.frame);
    return [{ ...d, textures: [this.feat!, ctx.shadowMap!], cast: this.props.shadows !== false }];
  }
  protected freeGeometry(): void { this.vbuf?.destroy(); this.vbuf = null; }
}
export const extrusion = <D = Feature>(p: Leveled<ExtrusionProps<D>>) => new Extrusion<D>(p as ExtrusionProps<D>);
