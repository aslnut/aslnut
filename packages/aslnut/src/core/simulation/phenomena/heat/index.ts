// core › simulation › phenomena › heat: the heat model (model.ts) as an element of a world. A raster field over the place's rasters
// holding what a person feels at a height (UTCI, apparent temperature, mean radiant, air or surface temperature),
// drawn on the ground in a heat ramp, asked anywhere (a person's whole breakdown, as in the sun or the shade), probed
// over streets or areas; a change to the place (a scenario's rasters) compared with it as a difference.
//   const h = w.add(heat({ id: 'heat', rasters, input: { hour: 15, weather, day, sunAt, key }, metric: 'utci' }))
//   await h.run()  ·  h.point([lon, lat])  ·  h.probe({ over: street }).value  ·  await h.compare(variantRasters)
import { AslnutError } from '../../../world/errors.ts';
import { RasterField, type FieldDraw, type FieldProps } from '../../fields/raster.ts';
import { rules } from '../../rules.ts';
import { DEFAULT_HEAT_OPTIONS, heatModel, type HeatField, type HeatInput, type HeatModel, type HeatOptions, type HeatPoint, type HeatRasters } from './model.ts';

type LonLat = [number, number];
/** heat rasters placed on the Earth (x east, z south metres from the north-west corner) */
export interface PlacedHeatRasters extends HeatRasters { lonLat(x: number, z: number): LonLat; xzOf(lon: number, lat: number): [number, number] }
export type HeatMetric = 'utci' | 'feels' | 'tmrt' | 'air' | 'surface';
/** the metrics, their units and a range the heat ramp spans */
export const HEAT_METRICS: Record<HeatMetric, { label: string; unit: string; range: [number, number] }> = {
  utci: { label: 'UTCI (feels like, thermal stress)', unit: '°C', range: [26, 52] },
  feels: { label: 'Apparent temperature', unit: '°C', range: [26, 52] },
  tmrt: { label: 'Mean radiant temperature', unit: '°C', range: [20, 80] },
  air: { label: 'Air temperature', unit: '°C', range: [30, 46] },
  surface: { label: 'Surface temperature', unit: '°C', range: [20, 75] },
};
/** a heat scale (a thermal ramp): blue … green … yellow … red … purple */
export const HEAT_RAMP = ['#2c7bb6', '#00a6ca', '#90eb9d', '#f9d057', '#f29e2e', '#e76818', '#d7191c', '#7a0177'];
/** a change's ramp: cooler blue … warmer red */
export const HEAT_DIFF_RAMP = ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b'];
export interface HeatSummary { utci: number; feels: number; tmrt: number; air: number; shaded: number; road: number; points: number }
export interface HeatProps extends Omit<FieldProps, 'rule' | 'res' | 'area' | 'init' | 'inputs' | 'params' | 'rate' | 'dt' | 'gpu'> {
  rasters: PlacedHeatRasters;
  input: HeatInput;
  options?: Partial<HeatOptions>;
  metric?: HeatMetric;
  /** a person's height (m, default 1.1: the chest of someone walking) */
  height?: number;
}
const pause = () => new Promise<void>((ok) => setTimeout(ok, 0));
const valueOf = (p: HeatPoint, m: HeatMetric) => (m === 'utci' ? p.utci : m === 'feels' ? p.feels : m === 'tmrt' ? p.tmrt : m === 'air' ? p.air : p.surface);

export class Heat extends RasterField {
  readonly rasters: PlacedHeatRasters;
  metric: HeatMetric;
  input: HeatInput;
  options: HeatOptions;
  /** the street means (where people walk) of the last run, and of the change compared */
  summary: HeatSummary | null = null; changed: HeatSummary | null = null;
  /** what the run is doing ('' when done) */
  busy = '';
  private model: HeatModel; private hf: HeatField | null = null; private runId = 0;
  private hp: HeatProps;
  constructor(p: HeatProps) {
    const r = p.rasters;
    if (!r || typeof r.lonLat !== 'function') throw new AslnutError('E-DATA-001', `heat '${p.id}' needs rasters placed on the Earth (with lonLat and xzOf)`, { where: p.id, fix: 'heat({ rasters: cityRasters(street.tiles(), { centre, size: 360 }), input })' });
    const nw = r.lonLat(0, 0), se = r.lonLat(r.w * r.cell, r.h * r.cell), metric = p.metric ?? 'utci';
    super({ ...p, res: r.cell, area: [nw[0], se[1], se[0], nw[1]], rule: rules.heat({ k: 0 }), init: NaN, gpu: false, draw: p.draw === false ? false : { ramp: HEAT_RAMP, domain: HEAT_METRICS[metric].range, opacity: 0.9, ...(p.draw || {}) } });
    this.hp = p; this.rasters = r; this.metric = metric; this.input = p.input; this.options = { ...DEFAULT_HEAT_OPTIONS, ...p.options };
    this.model = heatModel(r);
  }
  /** work out the field for the input and options (in slices: the page keeps drawing) */
  async run(o: { input?: HeatInput; options?: Partial<HeatOptions>; metric?: HeatMetric } = {}): Promise<HeatSummary | null> {
    if (o.input) this.input = o.input; if (o.options) this.options = { ...this.options, ...o.options }; if (o.metric) this.metric = o.metric;
    const id = ++this.runId;
    this.busy = 'sun, sky, surfaces through the day…';
    const hf = await this.model.field(this.input, this.options, { yield: pause });
    if (id !== this.runId) return null;
    this.hf = hf; this.busy = 'what a person feels, cell by cell…';
    const { grid, summary } = await this.sample(hf, this.rasters);
    if (id !== this.runId) return null;
    this.summary = summary; this.changed = null; this.busy = '';
    this.setLook(HEAT_METRICS[this.metric].range, HEAT_RAMP);
    this.reset(grid);
    return summary;
  }
  /** the same hour on changed rasters (a scenario): drawn as the change (variant − base), its street means kept */
  async compare(variant: PlacedHeatRasters, o: { domain?: [number, number] } = {}): Promise<HeatSummary | null> {
    if (!this.hf) await this.run();
    const id = this.runId, base = this.hf!;
    this.busy = 'the change…';
    const vf = await heatModel(variant).field({ ...this.input, key: `${this.input.key}|variant` }, this.options, { yield: pause });
    if (id !== this.runId) return null;
    const a = await this.sample(base, this.rasters), b = await this.sample(vf, variant);
    if (id !== this.runId) return null;
    const diff = new Float32Array(a.grid.length); for (let k = 0; k < diff.length; k++) diff[k] = b.grid[k]! - a.grid[k]!;
    this.summary = a.summary; this.changed = b.summary; this.busy = '';
    this.setLook(o.domain ?? [-6, 6], HEAT_DIFF_RAMP);
    this.reset(diff);
    return b.summary;
  }
  /** a person's breakdown at a place, and the same place in shade (null outside or in a building) */
  point(at: LonLat): { p: HeatPoint; shade: HeatPoint | null } | null {
    const hf = this.hf; if (!hf) return null;
    const [x, z] = this.rasters.xzOf(at[0], at[1]), y = this.hp.height ?? 1.1, p = hf.point(x, z, y); if (!p) return null;
    return { p, shade: p.sunVisible > 0.5 ? hf.point(x, z, y, this.options.canopyTransmission) : null };
  }
  /** what the model said (for your own questions) */
  get modelField(): HeatField | null { return this.hf; }
  private setLook(domain: [number, number], ramp: string[]): void { const d = (this.props.draw || {}) as FieldDraw; if (this.props.draw !== false) this.setProps({ draw: { ...d, domain, ramp } }); }
  /** the metric at each of this field's cells (NaN in buildings), the street means */
  private async sample(hf: HeatField, r: PlacedHeatRasters): Promise<{ grid: Float32Array; summary: HeatSummary }> {
    const grid = new Float32Array(this.w * this.h).fill(NaN), y = this.hp.height ?? 1.1;
    const s: HeatSummary = { utci: 0, feels: 0, tmrt: 0, air: 0, shaded: 0, road: 0, points: 0 }; let roadN = 0;
    for (let j = 0; j < this.h; j++) {
      for (let i = 0; i < this.w; i++) {
        const [lon, lat] = this.lonLatOf(i, j), [x, z] = r.xzOf(lon, lat), ci = Math.floor(x / r.cell), cj = Math.floor(z / r.cell);
        if (ci < 0 || cj < 0 || ci >= r.w || cj >= r.h) continue;
        const k = cj * r.w + ci; if (r.bH[k]! > 0) continue;
        const p = hf.point((ci + 0.5) * r.cell, (cj + 0.5) * r.cell, y); if (!p) continue;
        grid[j * this.w + i] = valueOf(p, this.metric);
        if (r.walk[k]) { s.utci += p.utci; s.feels += p.feels; s.tmrt += p.tmrt; s.air += p.air; if (p.sunVisible < 0.5) s.shaded++; s.points++; }
        if (p.material.id === 'asphalt' || p.material.id === 'coolpave') { s.road += p.surface; roadN++; }
      }
      if (j % 12 === 0) await pause();
    }
    const n = Math.max(1, s.points);
    return { grid, summary: { utci: s.utci / n, feels: s.feels / n, tmrt: s.tmrt / n, air: s.air / n, shaded: s.shaded / n, road: roadN ? s.road / roadN : NaN, points: s.points } };
  }
  override readouts(): Record<string, () => unknown> { return { ...super.readouts(), metric: () => this.metric, utci: () => this.summary?.utci ?? null, busy: () => this.busy }; }
}
/** urban heat as an element: heat({ id, rasters, input, metric }) */
export const heat = (p: HeatProps) => new Heat(p);
