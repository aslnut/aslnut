// core › encoding › layers: a layer is a statement, one dataset said one way: "these suburbs, coloured by their area,
// with their names". It holds its data (loaded once, shared by its signs), its signs inside it (a fill, a line,
// points, an extrusion, labels), its legend, and its place in the stack. Nothing about it changes because someone
// looked: no gate by default, its look from the feature and the settings only.
// It is one element: one id, one switch, one opacity, one place in the stack, one pick (its features, whichever sign
// is touched). Its fill, line, points and extrusion draw in its band, in that order; its labels draw in the labels'
// band over every layer's fills (in the stack's order), owned by it: shown, faded and stacked with it.
//   layer({ id: 'suburbs', data, area: { color: scale.quantile(km2) }, labels: { text: d => d.props.name } })
import type { Feature } from '../data/features.ts';
import type { Source } from '../data/sources/source.ts';
import { AslnutError } from '../world/errors.ts';
import { Element, type AttachContext, type ElementProps, type ElementStatus, type FrameContext, type Picked, type ThingPlace } from '../world/element.ts';
import type { Kind } from '../world/order.ts';
import type { State } from '../world/state.ts';
import type { DrawCall } from '../render/graphics/interface.ts';
import type { Legend } from './scales.ts';
import { area, type AreaProps } from './marks/area.ts';
import { line, type LineProps } from './marks/line.ts';
import { points, type PointsProps } from './marks/points.ts';
import { extrusion, type ExtrusionProps } from './marks/extrusion.ts';
import { text, type TextProps } from './marks/text.ts';
import type { Data, FeatureMark, FeatureMarkProps, Look } from './marks/features.ts';
import type { DrapeMode } from './marks/drape.ts';
import type { Leveled } from '../observation/presence.ts';

type Sign<P> = Omit<P, 'data' | 'id' | 'when' | 'order' | 'above' | 'below' | 'label' | 'opacity'> & { opacity?: number };
export interface LayerProps<D = Feature> extends ElementProps {
  /** one dataset, loaded once, shared by its signs */
  data: Data<D>;
  /** its signs (a mark's options without data): a fill and its outline */
  area?: Sign<AreaProps<D>>;
  line?: Sign<LineProps<D>>;
  points?: Sign<PointsProps<D>>;
  extrusion?: Sign<ExtrusionProps<D>>;
  /** its labels, inside it: decided once (an anchor per feature, a fixed priority and order, collision with
   *  hysteresis), drawn in the labels' band over every fill */
  labels?: Sign<TextProps<D>>;
  /** its legend (a scale or a description); default its first sign's colour scale */
  legend?: Legend | { legend(): Legend };
  /** shared by its signs */
  tooltip?: (d: D, s: State) => string | null | undefined;
  hover?: Look | false;
  onTap?: (f: Picked<D>, s: State) => void;
  onHover?: (f: Picked<D> | null, s: State) => void;
  select?: 'tap' | 'toggle' | false;
  /** where its fill and lines sit with the twin (each sign's own `drape` wins) */
  drape?: boolean | DrapeMode;
  /** its first sign's colour (read by legends and the layer list) */
  readonly color?: unknown;
}

const SHARED = ['tooltip', 'hover', 'onTap', 'onHover', 'select', 'drape', 'subject'] as const;
/** a layer's labels: an element of its own in the labels' band, owned by the layer (its show, fade, opacity and place
 *  follow the layer's; a pick on it is a pick on the layer) */
export interface Owned { owner?: Element | null }

/** its signs in their order in its band, each with its id's suffix (labels last: drawn in the labels' band) */
const SIGNS = [['area', 'fill'], ['extrusion', 'extrusion'], ['line', 'line'], ['points', 'points']] as const;
type SignKey = (typeof SIGNS)[number][0] | 'labels';

export class Layer<D = Feature> extends Element<LayerProps<D>> {
  /** its band in the stack: its first sign's (a sign added later that comes first moves it) */
  get kind(): Kind { return this.signs[0]?.kind ?? 'label'; }
  /** its signs drawn in its band (fill, extrusion, line, points), in that order */
  readonly signs: FeatureMark<D, FeatureMarkProps<D>>[] = [];
  /** its labels (drawn in the labels' band, owned by it) */
  labels: (FeatureMark<D, FeatureMarkProps<D>> & Owned) | null = null;
  /** signs added by setProps while it was in a world, still attaching (settled waits for them) */
  private adding = new Set<Promise<void>>();

  constructor(p: LayerProps<D>) {
    if (!p || p.data === undefined) throw new AslnutError('E-DATA-001', 'layer() needs data', { fix: "layer({ id: 'suburbs', data: data.wfs(url, { typeName, extent }), area: { color }, labels: { text } })" });
    const main = p.area?.color ?? p.extrusion?.color ?? p.line?.color ?? p.points?.color;
    super({ ...p, color: main });
    for (const [k] of SIGNS) if (p[k]) this.makeSign(k);
    if (p.labels) this.makeSign('labels');
    if (!this.signs.length && !this.labels) throw new AslnutError('E-DATA-001', `layer '${this.id}' says nothing: give it a sign`, { where: this.id, fix: 'area: { color }, line: { color }, points: { size }, extrusion: { height } or labels: { text }' });
  }
  /** a sign made from its props (shared options, its data, its opacity times the layer's), in its place */
  private makeSign(k: SignKey): FeatureMark<D, FeatureMarkProps<D>> {
    const p = this.props, id = this.id, shared: Record<string, unknown> = {};
    for (const x of SHARED) if (p[x] !== undefined) shared[x] = p[x];
    const o = p[k] as Record<string, unknown> & { opacity?: number }, opacity = (o.opacity ?? 1) * (p.opacity ?? 1);
    let m: FeatureMark<D, FeatureMarkProps<D>>;
    if (k === 'labels') {
      // readable by default: a halo, room made for each other, 12 px
      m = text({ halo: 2, collide: true, size: 12, ...shared, ...o, id: `${id}-labels`, data: p.data, opacity } as TextProps<D>) as unknown as FeatureMark<D, FeatureMarkProps<D>>;
      this.labels = m as FeatureMark<D, FeatureMarkProps<D>> & Owned;
    } else {
      const suffix = SIGNS.find(([x]) => x === k)![1], q = { ...shared, ...o, id: `${id}-${suffix}`, data: p.data, opacity };
      m = (k === 'area' ? area(q as AreaProps<D>) : k === 'extrusion' ? extrusion(q as ExtrusionProps<D>) : k === 'line' ? line(q as LineProps<D>) : points(q as PointsProps<D>)) as unknown as FeatureMark<D, FeatureMarkProps<D>>;
      // (in its place: fill, extrusion, line, points)
      const rank = (x: { id: string }) => SIGNS.findIndex(([, sf]) => x.id === `${id}-${sf}`);
      const at = this.signs.findIndex((x) => rank(x) > rank(m));
      this.signs.splice(at < 0 ? this.signs.length : at, 0, m);
    }
    (m as unknown as { signOpacity: number }).signOpacity = o.opacity ?? 1;
    (m as unknown as Owned).owner = this;
    return m;
  }
  /** a sign given by setProps that it did not have: made and, in a world, attached (a fill first now: the layer moves
   *  to the fills' band; labels: added to the world with it, removed with it) */
  private addSign(k: SignKey): void {
    const before = this.kind, m = this.makeSign(k), ctx = this.attached;
    if (this.props.color === undefined && k !== 'labels') this.props = { ...this.props, color: (this.props[k] as { color?: unknown }).color };
    if (!ctx) return;
    const w = ctx.world as unknown as { add?(...e: Element[]): unknown; elementChanged?(l: Element, keys: string[]): void };
    if (k === 'labels') { w.add?.(m); return; }
    m.pickNo = this.pickNo;
    const done = m.attach(ctx).catch((e: unknown) => { m.failure = e instanceof Error ? e : new Error(String(e)); ctx.world.error(e); }).finally(() => { this.adding.delete(done); });
    this.adding.add(done);
    if (this.kind !== before) w.elementChanged?.(this, ['order']);
  }
  get source(): Source | null { return (this.signs[0] ?? this.labels)?.source ?? null; }
  override get fades(): boolean { return true; }
  override get sits(): 'ground' | 'over' | 'above' | 'free' | null { return (this.signs[0] ?? this.labels)!.sits; }
  override get order(): number | undefined { return this.props.order ?? this.signs[0]?.order; }
  /** what the last data change did (its first sign's join) */
  get joined() { return (this.signs[0] ?? this.labels)!.joined; }
  /** its labels: an element in the labels' band (added and removed with it) */
  override companions(): Element[] { return this.labels ? [this.labels] : []; }
  /** its place in a stack (w.reorder): its labels take the same place among the labels */
  restacked(k: number): void { if (this.labels) this.labels.props = { ...this.labels.props, order: 6 + k, above: undefined, below: undefined }; }

  override async attach(ctx: AttachContext): Promise<void> {
    await super.attach(ctx);
    // one pick for the whole statement: its signs answer with its number
    for (const m of this.signs) m.pickNo = this.pickNo;
    await Promise.all(this.signs.map((m) => m.attach(ctx)));
  }
  override detach(): void { for (const m of this.signs) m.detach(); super.detach(); }
  override setProps(given: Partial<Leveled<LayerProps<D>>>): this { const p = given as Partial<LayerProps<D>>;
    super.setProps(p);
    const pass: Record<string, unknown> = {};
    if ('data' in p) pass.data = p.data;
    for (const k of SHARED) if (k in p) pass[k] = p[k];
    for (const m of [...this.signs, ...(this.labels ? [this.labels] : [])]) {
      const q: Record<string, unknown> = { ...pass };
      if ('opacity' in p) q.opacity = ((m as unknown as { signOpacity?: number }).signOpacity ?? 1) * (p.opacity ?? 1);
      if (Object.keys(q).length) m.setProps(q as never);
    }
    // a sign's own options (its own opacity, times the layer's); a sign it did not have is added
    const sign = (k: SignKey, suffix: string) => {
      const o = p[k] as { opacity?: number } | undefined; if (!o) return;
      const m = suffix === 'labels' ? this.labels : this.signs.find((x) => x.id === `${this.id}-${suffix}`);
      if (!m) { this.addSign(k); return; }
      if (o.opacity !== undefined) (m as unknown as { signOpacity: number }).signOpacity = o.opacity;
      m.setProps({ ...o, ...(o.opacity !== undefined ? { opacity: o.opacity * (this.props.opacity ?? 1) } : {}) } as never);
    };
    sign('area', 'fill'); sign('line', 'line'); sign('points', 'points'); sign('extrusion', 'extrusion'); sign('labels', 'labels');
    return this;
  }
  frame(ctx: FrameContext): DrawCall[] {
    const out: DrawCall[] = [];
    for (const m of this.signs) { m.shown = this.shown; m.target = this.target; m.pickNo = this.pickNo; out.push(...m.frame(ctx)); }
    return out;
  }
  override prepare(ctx: FrameContext): boolean { let done = true; for (const m of this.signs) if (!m.prepare(ctx)) done = false; if (this.labels && !this.labels.prepare(ctx)) done = false; return done; }
  override letGo(): void { for (const m of this.signs) m.letGo?.(); this.labels?.letGo?.(); }
  override status(): ElementStatus {
    const st: ElementStatus = { ready: true, pending: [], failed: this.failure ? [{ what: this.id, error: this.failure.message }] : [], missing: [] };
    for (const m of this.signs) { const s = m.status(); st.ready &&= s.ready; st.pending.push(...s.pending); st.failed.push(...s.failed); st.missing.push(...s.missing); }
    if (this.adding.size) { st.ready = false; st.pending.push(`layer '${this.id}': a sign added`); }
    return st;
  }
  override wantsFrames(s: State): number { let n = 0; for (const m of this.signs) n = Math.max(n, m.wantsFrames(s)); return n; }
  override animating(s: State): boolean { return this.signs.some((m) => m.animating(s)); }
  override revealSeconds(): number { return Math.max(0, ...this.signs.map((m) => m.revealSeconds())); }
  override pickInfo(index: number): Omit<Picked, 'at' | 'x' | 'y'> | null { for (const m of this.signs) { const r = m.pickInfo(index); if (r) return { ...r, element: this.id }; } return null; }
  override groundPick(lon: number, lat: number): number | null { for (const m of this.signs) { const i = m.groundPick?.(lon, lat); if (i !== null && i !== undefined) return i; } return null; }
  override hovered(ids: Set<string> | null): void { for (const m of this.signs) m.hovered(ids); this.labels?.hovered(ids); }
  override placeOf(f: Picked): ThingPlace | null { for (const m of this.signs) { const r = m.placeOf(f); if (r) return r; } return null; }
  override attribution(): string[] { return (this.signs[0] ?? this.labels)!.attribution(); }
  override readouts(): Record<string, () => unknown> { const m = this.signs[0] ?? this.labels!, lb = this.labels; return { count: () => m.size, ...(lb ? { labels: () => ((lb.readouts() as Record<string, () => unknown>).shown?.() ?? 0) } : {}) }; }
  /** the keys lit together with feature `key` (a sign's hover group) */
  groupOf(key: string): Set<string> { const m = this.signs[0] as unknown as { groupOf?: (k: string) => Set<string> } | undefined; return m?.groupOf?.(key) ?? new Set([key]); }
  get size(): number { return (this.signs[0] ?? this.labels)?.size ?? 0; }
}
/** a layer: one dataset said one way (its signs, its labels inside, its legend, its place in the stack) */
export const layer = <D = Feature>(p: Leveled<LayerProps<D>>) => new Layer<D>(p as LayerProps<D>);
