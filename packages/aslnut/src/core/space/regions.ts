// core › space › regions: named areas in a hierarchy (country → province → city → district → suburb). Which region a place is
// in, a region's parent and children, and numbers rolled up from one level to another, live: when the rows change,
// the rolled-up rows change, and so does every layer joined to them.
//   const tree = regions.tree({ levels: ['lga', 'suburb'], sources: { lga: lgas, suburb: suburbs }, parentOf: { suburb: d => d.props.lga_code } })
//   await tree.load(w.loader)
//   tree.at(144.96, -37.81, 'suburb')                               → { id, level, name, props, parent }
//   area({ data: tree.level('lga').join(tree.rollup(crime, { on: 'suburb', to: 'lga', sum: ['count'] }), { on: 'id' }) })
import type { Loader } from '../data/loading/loader.ts';
import { bboxOf, centreOf, contains, type Feature, type Props } from '../data/features.ts';
import { Rows, type Source, type SourceContext } from '../data/sources/index.ts';
import { AslnutError } from '../world/errors.ts';
import type { BBox } from './geo.ts';

export interface Region { id: string | number; level: string; name: string; props: Props; parent: string | number | null; feature: Feature }
export interface TreeOptions {
  /** the levels, top first */
  levels: string[];
  sources: Record<string, Source>;
  /** a feature's parent id, per level (default: the parent level's region its middle lies in) */
  parentOf?: Record<string, (f: Feature) => string | number | null | undefined>;
  /** a feature's name (default props.name) */
  nameOf?: (f: Feature, level: string) => string;
}
export interface RollupOptions {
  /** the rows' prop holding the region id (of `from`, default the bottom level) */
  on: string;
  /** the level to roll up to */
  to: string;
  from?: string;
  sum?: string[]; mean?: string[];
  /** a count of rows per region, as `count` */
  count?: boolean;
  /** your own: rows of a region → props to add */
  fn?: (rows: Props[], region: Region) => Props;
}

export class RegionTree {
  readonly levels: string[];
  private o: TreeOptions;
  private regions = new Map<string, Region>(); private kids = new Map<string, string[]>(); private boxes = new Map<string, BBox>();
  private byLevel = new Map<string, Region[]>();
  private built = -1;
  constructor(o: TreeOptions) {
    if (!o?.levels?.length) throw new AslnutError('E-DATA-001', 'a region tree needs levels, top first', { fix: "regions.tree({ levels: ['lga', 'suburb'], sources: { … } })" });
    for (const l of o.levels) if (!o.sources?.[l]) throw new AslnutError('E-DATA-001', `no source for level '${l}'`, { fix: `give sources: { ${l}: data.geojson(…) }` });
    this.o = o; this.levels = o.levels;
  }
  private key = (level: string, id: string | number) => `${level}\u0000${id}`;
  /** load every level's source (through this loader) and build the tree */
  async load(loader: Loader): Promise<this> {
    await Promise.all(this.levels.map((l) => this.o.sources[l]!.start({ loader, error: (e) => { throw e; } })));
    this.build();
    return this;
  }
  /** (re)build from what the sources have now */
  build(): void {
    const v = this.levels.map((l) => this.o.sources[l]!.version).reduce((a, b) => a * 31 + b, 7);
    if (v === this.built) return;
    this.built = v;
    this.regions.clear(); this.kids.clear(); this.boxes.clear(); this.byLevel.clear();
    this.levels.forEach((level, li) => {
      const list: Region[] = [];
      for (const f of this.o.sources[level]!.features()) {
        let parent: string | number | null = null;
        if (li > 0) {
          const up = this.levels[li - 1]!, rule = this.o.parentOf?.[level];
          if (rule) parent = rule(f) ?? null;
          else { const c = centreOf(f.geometry); if (c) parent = this.find(c[0], c[1], up)?.id ?? null; }
        }
        const r: Region = { id: f.id, level, name: this.o.nameOf ? this.o.nameOf(f, level) : String(f.props.name ?? f.id), props: f.props, parent, feature: f };
        this.regions.set(this.key(level, f.id), r); list.push(r);
        const b = bboxOf(f.geometry); if (b) this.boxes.set(this.key(level, f.id), b);
        if (parent !== null) { const k = this.key(this.levels[li - 1]!, parent); (this.kids.get(k) ?? this.kids.set(k, []).get(k)!).push(this.key(level, f.id)); }
      }
      this.byLevel.set(level, list);
    });
  }
  private find(lon: number, lat: number, level: string): Region | null {
    for (const r of this.byLevel.get(level) ?? []) {
      const b = this.boxes.get(this.key(level, r.id));
      if (b && (lon < b[0] || lon > b[2] || lat < b[1] || lat > b[3])) continue;
      if (contains(r.feature.geometry, [lon, lat])) return r;
    }
    return null;
  }
  /** the region of a level a place is in */
  at(lon: number, lat: number, level = this.levels[this.levels.length - 1]!): Region | null { this.build(); return this.find(lon, lat, level); }
  get(level: string, id: string | number): Region | null { this.build(); return this.regions.get(this.key(level, id)) ?? null; }
  parent(r: Region): Region | null { const li = this.levels.indexOf(r.level); return li > 0 && r.parent !== null ? this.get(this.levels[li - 1]!, r.parent) : null; }
  children(r: Region): Region[] { this.build(); return (this.kids.get(this.key(r.level, r.id)) ?? []).map((k) => this.regions.get(k)!); }
  /** a region and every one above it, top first */
  path(r: Region): Region[] { const out = [r]; let p = this.parent(r); while (p) { out.unshift(p); p = this.parent(p); } return out; }
  /** the regions of a level */
  regionsOf(level: string): Region[] { this.build(); return this.byLevel.get(level) ?? []; }
  /** a level's shapes, as a source for layers */
  level(level: string): Source { const s = this.o.sources[level]; if (!s) throw new AslnutError('E-DATA-001', `no level '${level}'`, { fix: `the levels: ${this.levels.join(', ')}` }); return s; }
  /** rows of one level rolled up to another: sums, means, counts or your function per region; live */
  rollup(rows: Source<any>, o: RollupOptions): Rows {   // eslint-disable-line @typescript-eslint/no-explicit-any
    const from = o.from ?? this.levels[this.levels.length - 1]!, fi = this.levels.indexOf(from), ti = this.levels.indexOf(o.to);
    if (fi < 0 || ti < 0 || ti > fi) throw new AslnutError('E-DATA-001', `cannot roll '${from}' up to '${o.to}'`, { fix: `roll a lower level up to a higher one of ${this.levels.join(' → ')}` });
    // a layer showing the rolled-up rows starts what they come from: the rows and every level's shapes
    const out = new Rolled([rows, ...this.levels.map((l) => this.o.sources[l]!)]);
    const run = () => {
      this.build();
      const groups = new Map<string, { region: Region; rows: Props[] }>();
      for (const f of rows.features()) {
        let r = this.get(from, f.props[o.on] as string | number);
        while (r && r.level !== o.to) r = this.parent(r);
        if (!r) continue;
        const k = String(r.id); (groups.get(k) ?? groups.set(k, { region: r, rows: [] }).get(k)!).rows.push(f.props);
      }
      out.set([...groups.values()].map(({ region, rows: rs }) => {
        const p: Props = { id: region.id, name: region.name };
        for (const k of o.sum ?? []) p[k] = rs.reduce((a, x) => a + (Number(x[k]) || 0), 0);
        for (const k of o.mean ?? []) { const xs = rs.map((x) => Number(x[k])).filter(Number.isFinite); p[k] = xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null; }
        if (o.count) p.count = rs.length;
        return o.fn ? { ...p, ...o.fn(rs, region) } : p;
      }));
    };
    rows.watch(run); for (const l of this.levels) this.o.sources[l]!.watch(run);
    run();
    return out;
  }
}
/** rolled-up rows: loading them loads their inputs */
class Rolled extends Rows<Props> {
  private deps: Source<any>[];   // eslint-disable-line @typescript-eslint/no-explicit-any
  constructor(deps: Source<any>[]) { super([], { id: 'id' }); this.deps = deps; }   // eslint-disable-line @typescript-eslint/no-explicit-any
  protected override async load(ctx: SourceContext): Promise<void> { await Promise.all(this.deps.map((d) => d.start(ctx))); }
}
export const regions = { tree: (o: TreeOptions) => new RegionTree(o) };
