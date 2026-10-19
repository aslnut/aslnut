// kits › dashboard › stats: a number per area, live. Count what lies in each area (its middle), sum or average a
// prop of it, or read the area's own props; normalise by the area's size or by any of its props (people); rank the
// areas. The answer is rows (a source): join them to the areas' shapes and colour them with a scale, list them in
// your UI. When the inputs change (a query, a stream, a new filter), the rows change, and so does every layer on them.
//   const parks = stats({ areas: suburbs, of: openSpace, filter: { group: 'Parks and gardens' }, sum: 'ha', per: 'km2' })
//   area({ data: suburbs.join(parks, { on: 'id' }), color: scale.jenks(d => d.props.value, { range: 'greens' }) })
//   parks.ranked().slice(0, 10)         → [{ id, name, value, raw, rank, … }]
//   parks.set({ per: 'pop', scale: 1000 })    another normalisation: per 1,000 residents
import { bboxOf, centreOf, contains, polygonsOf, type Feature, type Props } from '../../core/data/features.ts';
import { Rows, type Source, type SourceContext } from '../../core/data/sources/index.ts';
import { keep, type Filter } from '../../core/encoding/marks/features.ts';
import { AslnutError } from '../../core/world/errors.ts';
import { makeState } from '../../core/world/state.ts';
import type { BBox } from '../../core/space/geo.ts';

export interface StatsOptions {
  /** the areas (polygons): one row each */
  areas: Source;
  /** what is counted, summed or averaged in each area (each feature where its middle lies) */
  of?: Source;
  /** keep only these of `of` (a function, or props to match: { group: 'Parks and gardens' }) */
  filter?: Filter<Feature> | null;
  /** the number of `of` features in the area (the default when nothing else is asked) */
  count?: boolean;
  /** the sum of a prop of `of` (or your function of one feature) */
  sum?: string | ((f: Feature) => number);
  /** the mean of a prop of `of` (or your function) */
  mean?: string | ((f: Feature) => number);
  /** the area's own number instead: a prop of the area, or your function (its props, and what was counted) */
  value?: string | ((area: Feature, agg: { count: number; sum: number; mean: number | null }) => number | null);
  /** divide by: 'km2' (the area's size), the name of an area prop (people), your function of the area, or nothing */
  per?: 'km2' | 'none' | string | ((area: Feature) => number | null);
  /** times this after dividing (1000: per 1,000 people; 100: a share in %) */
  scale?: number;
  /** what the rows call the area (default its props.name) */
  name?: (area: Feature) => string;
}
export interface StatRow extends Props { id: string | number; name: string; value: number | null; raw: number | null; count: number; area_km2: number; rank: number | null; share: number | null }

const D = Math.PI / 180;
/** km² of a lon / lat polygon (local equirectangular per ring; holes subtracted) */
export function areaKm2(f: Feature): number {
  let a = 0;
  for (const rings of polygonsOf(f.geometry)) rings.forEach((r, i) => {
    const k = 111.32 * Math.cos((r[0]?.[1] ?? 0) * D); let s = 0;
    for (let p = 0, q = r.length - 1; p < r.length; q = p++) s += (r[q]![0] * k - r[p]![0] * k) * (r[q]![1] + r[p]![1]) * 110.574;
    a += (i === 0 ? 1 : -1) * Math.abs(s / 2);
  });
  return a;
}

/** the rows: one per area, recomputed when the areas, `of` or the options change */
export class Stats extends Rows<StatRow> {
  private opt: StatsOptions;
  private seen = '';
  private dead = false;
  private offs: (() => void)[] = [];
  constructor(o: StatsOptions) {
    super([], { id: 'id' });
    if (!o?.areas || typeof (o.areas as Source).features !== 'function') throw new AslnutError('E-DATA-001', 'stats needs areas: a source of polygons', { fix: "stats({ areas: data.geojson('/suburbs.geojson'), of: parks, count: true })" });
    this.opt = o;
    const run = () => this.run();
    this.offs.push(o.areas.watch(run)); if (o.of) this.offs.push(o.of.watch(run));
    this.run();
  }
  protected override async load(ctx: SourceContext): Promise<void> { await Promise.all([this.opt.areas.start(ctx), this.opt.of?.start(ctx)]); this.run(); }
  /** the options now */
  get options(): Readonly<StatsOptions> { return this.opt; }
  /** change what is measured (the measure, the filter, the normalisation): the rows follow */
  setOptions(p: Partial<StatsOptions>): this {
    for (const off of this.offs) off(); this.offs = [];
    this.opt = { ...this.opt, ...p };
    const run = () => this.run();
    this.offs.push(this.opt.areas.watch(run)); if (this.opt.of) this.offs.push(this.opt.of.watch(run));
    this.seen = ''; this.run();
    return this;
  }
  /** the rows, highest first (or lowest: 'asc'); areas without a value last */
  ranked(order: 'desc' | 'asc' = 'desc'): StatRow[] {
    const r = this.rows();
    return [...r].sort((a, b) => (a.value === null ? 1 : b.value === null ? -1 : order === 'desc' ? b.value - a.value : a.value - b.value));
  }
  /** the total of the raw numbers over every area (before normalising) */
  get total(): number { return this.rows().reduce((a, r) => a + (r.raw ?? 0), 0); }
  dispose(): void { this.dead = true; for (const off of this.offs) off(); this.offs = []; }
  private run(): void {
    if (this.dead) return;
    const o = this.opt, areas = o.areas.features(), of = o.of?.features() ?? [];
    const key = `${o.areas.version}/${o.of?.version ?? -1}`;
    if (key === this.seen && this.size) return;
    this.seen = key;
    if (!areas.length) { if (this.size) this.set([]); return; }
    // where each feature of `of` lies: its middle, found in the areas' boxes first
    const boxes: (BBox | null)[] = areas.map((a) => bboxOf(a.geometry));
    const counts = new Float64Array(areas.length), sums = new Float64Array(areas.length), means = new Float64Array(areas.length), meanN = new Float64Array(areas.length);
    const s = makeState();
    const pick = (f: string | ((x: Feature) => number) | undefined, x: Feature) => (f === undefined ? 0 : typeof f === 'function' ? Number(f(x)) : Number(x.props[f]));
    for (const x of of) {
      if (o.filter && !keep(o.filter, x, s)) continue;
      const c = centreOf(x.geometry); if (!c) continue;
      for (let i = 0; i < areas.length; i++) {
        const b = boxes[i]; if (!b || c[0] < b[0] || c[0] > b[2] || c[1] < b[1] || c[1] > b[3]) continue;
        if (!contains(areas[i]!.geometry, c)) continue;
        counts[i]!++;
        if (o.sum !== undefined) { const v = pick(o.sum, x); if (Number.isFinite(v)) sums[i]! += v; }
        if (o.mean !== undefined) { const v = pick(o.mean, x); if (Number.isFinite(v)) { means[i]! += v; meanN[i]!++; } }
        break;
      }
    }
    const rows: StatRow[] = areas.map((a, i) => {
      const km2 = areaKm2(a), agg = { count: counts[i]!, sum: sums[i]!, mean: meanN[i]! ? means[i]! / meanN[i]! : null };
      let raw: number | null;
      if (o.value !== undefined) { const v = typeof o.value === 'function' ? o.value(a, agg) : a.props[o.value]; raw = v === null || v === undefined || v === '' ? null : Number(v); }
      else if (o.sum !== undefined) raw = agg.sum;
      else if (o.mean !== undefined) raw = agg.mean;
      else raw = agg.count;
      if (raw !== null && !Number.isFinite(raw)) raw = null;
      const per = o.per ?? 'none';
      let d: number | null = 1;
      if (per === 'km2') d = km2;
      else if (typeof per === 'function') d = per(a);
      else if (per !== 'none') { const v = Number(a.props[per]); d = Number.isFinite(v) ? v : null; }
      const value = raw === null || d === null || !(d > 0) ? null : (raw / d) * (o.scale ?? 1);
      return { ...a.props, id: a.id, name: o.name ? o.name(a) : String(a.props.name ?? a.id), value, raw, count: agg.count, area_km2: +km2.toFixed(3), rank: null, share: null };
    });
    const total = rows.reduce((t, r) => t + (r.raw ?? 0), 0);
    [...rows].filter((r) => r.value !== null).sort((a, b) => b.value! - a.value!).forEach((r, k) => { r.rank = k + 1; });
    for (const r of rows) r.share = total > 0 && r.raw !== null ? r.raw / total : null;
    this.set(rows);
  }
}
/** a number per area, live: counts, sums or means of what lies in it, or its own props; normalised and ranked */
export const stats = (o: StatsOptions) => new Stats(o);
