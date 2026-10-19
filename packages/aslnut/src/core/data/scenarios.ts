// core › data › scenarios: the world as it is ('base') and as it could be. A scenario swaps sources (by the source's
// id or the layer's), sets params and gives fields other rules, on top of another scenario; using one applies it,
// using 'base' puts everything back. Two scenarios are compared side by side (split, or a swipe you drag), or as
// their difference (fields: b − a in a diverging ramp; features: added, removed, changed coloured); diff lists what
// differs.
//   w.scenario('more-trees', { set: { trees: data.geojson('trees-planned.geojson') }, params: { 'heat.k': 0.2 } })
//   w.scenario.use('more-trees')  ·  await w.scenario.diff('base', 'more-trees')
//   w.scenario.compare('base', 'more-trees', { view: 'swipe' })  ·  w.scenario.compare(null)
import { AslnutError } from '../world/errors.ts';
import type { Element } from '../world/element.ts';
import type { Loader } from './loading/loader.ts';
import type { Feature } from './features.ts';
import { Source } from './sources/source.ts';
import type { RasterField } from '../simulation/fields/raster.ts';
import type { Kernel, Rule } from '../simulation/rules.ts';

export type RuleLike = Rule | Kernel | ((cur: number, n: { laplacian: number; neighbours: [number, number, number, number]; inputs: Record<string, number> }, dt: number, p: Record<string, number>) => number);
export interface ScenarioOptions {
  /** the scenario it changes (default 'base') */
  base?: string;
  /** sources in place of others: by the source's id or the layer's id */
  set?: Record<string, Source | Feature[]>;
  /** params ('layer.name' or world params) */
  params?: Record<string, unknown>;
  /** fields (by id) stepped by another rule, with its numbers */
  rules?: Record<string, RuleLike | { rule: RuleLike; params?: Record<string, number> }>;
  label?: string;
}
export interface Scenario { readonly name: string; readonly base: string; readonly set: Record<string, Source | Feature[]>; readonly params: Record<string, unknown>; readonly rules: ScenarioOptions['rules'] & object; readonly label: string }
export interface ScenarioDiff {
  added: { source: string; id: string | number }[]; removed: { source: string; id: string | number }[]; changed: { source: string; id: string | number }[];
  params: { key: string; a: unknown; b: unknown }[]; rules: { field: string; a: string; b: string }[];
}
export type CompareView = 'split' | 'swipe' | 'difference';
/** what a world gives scenarios */
export interface ScenarioWorld {
  readonly elements: readonly Element[]; readonly loader: Loader;
  add(...l: Element[]): unknown; remove(id: string): unknown; element(id: string): Element | undefined;
  get(key: string): unknown; set(key: string, v: unknown): unknown; invalidate(): void; error(e: unknown): void;
  compareView: { at: number; leftHides: Set<Element>; rightHides: Set<Element> } | null;
  readonly canvasElement?: HTMLCanvasElement | null;
}
type Original = { data?: unknown; rule?: Rule; params?: Record<string, number>; draw?: unknown };
const isField = (l: Element): l is RasterField => typeof (l as unknown as { setRule?: unknown }).setRule === 'function';
const DIFF_COLOURS = { added: '#22c55e', removed: '#ef4444', changed: '#f59e0b' };

export class Scenarios {
  private w: ScenarioWorld;
  private all = new Map<string, Scenario>([['base', { name: 'base', base: '', set: {}, params: {}, rules: {}, label: 'as it is' }]]);
  private now = 'base';
  /** what each layer had before a scenario changed it (to put back) */
  private originals = new Map<Element, Original>();
  private paramsBefore = new Map<string, unknown>();
  private cmp: { a: string; b: string; view: CompareView; twins: Element[]; hidden: Element[]; divider: HTMLElement | null; offs: (() => void)[] } | null = null;
  constructor(w: ScenarioWorld) { this.w = w; }

  /** define (or replace) a scenario; with no options, the one by that name */
  define(name: string, o?: ScenarioOptions): Scenario {
    if (o === undefined) { const s = this.all.get(name); if (!s) throw new AslnutError('E-DATA-001', `no scenario '${name}' (there are ${[...this.all.keys()].join(', ')})`, { fix: `w.scenario('${name}', { set: { … } })` }); return s; }
    if (name === 'base') throw new AslnutError('E-DATA-001', "'base' is the world as it is: it cannot be changed", { fix: "give your scenario another name: w.scenario('plan-a', { … })" });
    const base = o.base ?? 'base'; if (!this.all.has(base)) throw new AslnutError('E-DATA-001', `scenario '${name}' is based on '${base}', which is not defined`, { fix: `define '${base}' first` });
    const s: Scenario = { name, base, set: { ...(o.set ?? {}) }, params: { ...(o.params ?? {}) }, rules: { ...(o.rules ?? {}) }, label: o.label ?? name };
    this.all.set(name, s);
    if (this.now === name) this.use(name);
    return s;
  }
  /** the scenarios there are */
  list(): string[] { return [...this.all.keys()]; }
  /** the one in use */
  get current(): string { return this.now; }
  /** what a scenario changes with its bases' changes under it (its own win) */
  resolved(name: string): { set: Record<string, Source | Feature[]>; params: Record<string, unknown>; rules: Record<string, { rule: RuleLike; params?: Record<string, number> }> } {
    const chain: Scenario[] = []; let s: Scenario | undefined = this.define(name);
    while (s && s.name !== 'base') { if (chain.includes(s)) throw new AslnutError('E-DATA-001', `scenarios are based on each other in a circle (${chain.map((x) => x.name).join(' → ')})`, { fix: 'base one of them on base' }); chain.unshift(s); s = this.all.get(s.base); }
    const out = { set: {} as Record<string, Source | Feature[]>, params: {} as Record<string, unknown>, rules: {} as Record<string, { rule: RuleLike; params?: Record<string, number> }> };
    for (const c of chain) { Object.assign(out.set, c.set); Object.assign(out.params, c.params); for (const [k, r] of Object.entries(c.rules ?? {})) out.rules[k] = typeof r === 'object' && r !== null && 'rule' in r ? r as { rule: RuleLike; params?: Record<string, number> } : { rule: r as RuleLike }; }
    return out;
  }
  /** apply a scenario (everything another one changed goes back first) */
  use(name: string): this {
    const r = this.resolved(name);
    this.restore();
    for (const [key, src] of Object.entries(r.set)) {
      const ls = this.layersFor(key);
      if (!ls.length) this.w.error(new AslnutError('E-DATA-001', `scenario '${name}': no layer uses the source or is the layer '${key}'`, { fix: 'set: { <source id or layer id>: data.geojson(…) }' }));
      for (const l of ls) { this.remember(l, 'data'); l.setProps({ data: src } as never); }
    }
    for (const [key, v] of Object.entries(r.params)) { if (!this.paramsBefore.has(key)) this.paramsBefore.set(key, this.w.get(key)); this.w.set(key, v); }
    for (const [id, x] of Object.entries(r.rules)) {
      const l = this.w.element(id); if (!l || !isField(l)) { this.w.error(new AslnutError('E-DATA-001', `scenario '${name}': no field '${id}'`, { fix: 'rules: { <field id>: rules.diffusion(…) }' })); continue; }
      this.remember(l, 'rule'); void l.setRule(x.rule, x.params ?? {}).catch((e) => this.w.error(e));
    }
    this.now = name; this.w.invalidate();
    return this;
  }
  /** what differs between two scenarios: features of the sources either swaps (loaded if need be), params, rules */
  async diff(a: string, b: string): Promise<ScenarioDiff> {
    const ra = this.resolved(a), rb = this.resolved(b), out: ScenarioDiff = { added: [], removed: [], changed: [], params: [], rules: [] };
    const ctx = { loader: this.w.loader, error: (e: unknown) => this.w.error(e) };
    const featuresOf = async (x: Source | Feature[] | undefined, key: string): Promise<readonly Feature[]> => {
      const v = x ?? this.originalData(key);
      if (Array.isArray(v)) return v as Feature[];
      if (v instanceof Source) { await v.start(ctx); await v.ready; return v.features(); }
      return [];
    };
    for (const key of new Set([...Object.keys(ra.set), ...Object.keys(rb.set)])) {
      const fa = await featuresOf(ra.set[key], key), fb = await featuresOf(rb.set[key], key);
      const ma = new Map(fa.map((f) => [String(f.id), f])), mb = new Map(fb.map((f) => [String(f.id), f]));
      for (const [id, f] of mb) { const o = ma.get(id); if (!o) out.added.push({ source: key, id: f.id }); else if (JSON.stringify([o.props, o.geometry]) !== JSON.stringify([f.props, f.geometry])) out.changed.push({ source: key, id: f.id }); }
      for (const [id, f] of ma) if (!mb.has(id)) out.removed.push({ source: key, id: f.id });
    }
    for (const key of new Set([...Object.keys(ra.params), ...Object.keys(rb.params)])) {
      const va = key in ra.params ? ra.params[key] : this.paramsBefore.has(key) ? this.paramsBefore.get(key) : this.w.get(key), vb = key in rb.params ? rb.params[key] : this.paramsBefore.has(key) ? this.paramsBefore.get(key) : this.w.get(key);
      if (JSON.stringify(va) !== JSON.stringify(vb)) out.params.push({ key, a: va, b: vb });
    }
    for (const id of new Set([...Object.keys(ra.rules), ...Object.keys(rb.rules)])) {
      const name = (x?: { rule: RuleLike }) => (x ? (typeof x.rule === 'function' ? 'custom' : (x.rule as Rule).name ?? 'kernel') : this.originalRuleName(id));
      if (ra.rules[id]?.rule !== rb.rules[id]?.rule) out.rules.push({ field: id, a: name(ra.rules[id]), b: name(rb.rules[id]) });
    }
    return out;
  }
  /** a and b on one screen: 'split' (b on the right half), 'swipe' (a handle you drag), 'difference' (fields b − a,
   *  features coloured added / removed / changed); null stops comparing */
  compare(a: string | null, b?: string, o: { view?: CompareView; at?: number } = {}): this {
    this.stopCompare();
    if (a === null) return this;
    if (!b) throw new AslnutError('E-DATA-001', 'compare needs two scenarios', { fix: "w.scenario.compare('base', 'plan-a')" });
    const view = o.view ?? 'split', rb = this.resolved(b);
    this.use(a);
    // b's layers: a twin of every layer b changes, drawn beside (or instead of) the one a shows
    const twins: Element[] = [], hidden: Element[] = [], pairs: [Element, Element][] = [];
    const twin = (l: Element, props: Record<string, unknown>): Element => {
      const Ctor = l.constructor as new (p: unknown) => Element;
      const t = new Ctor({ ...(l.props as object), ...props, id: `${l.id}--${b}`, above: l.id, order: undefined });
      twins.push(t); pairs.push([l, t]); return t;
    };
    for (const [key, src] of Object.entries(rb.set)) for (const l of this.layersFor(key)) {
      if (view !== 'difference') { twin(l, { data: src }); continue; }
      // the difference of features: what b adds or changes in b's shapes, what it removes in a's
      hidden.push(l);
      const cls = (k: keyof typeof DIFF_COLOURS) => (f: { id: string | number }) => (this.diffSets.get(`${l.id}:${k}`)?.has(String(f.id)) ? DIFF_COLOURS[k] : 'rgba(0,0,0,0)');
      twin(l, { data: src, color: (d: { id: string | number }) => (this.diffSets.get(`${l.id}:added`)?.has(String(d.id)) ? DIFF_COLOURS.added : cls('changed')(d)) });
      const gone = new (l.constructor as new (p: unknown) => Element)({ ...(l.props as object), id: `${l.id}--${b}--removed`, above: l.id, order: undefined, color: cls('removed') });
      twins.push(gone);
    }
    for (const [id, x] of Object.entries(rb.rules)) {
      const l = this.w.element(id); if (!l || !isField(l)) continue;
      const f = l as RasterField, d = (f.props.draw || {}) as Record<string, unknown>;
      // drawn as surfaces for the compare (a ground painting is shared by both halves), lying flat
      const surface = { ...d, on: 'surface', flat: d.on !== 'surface' ? true : d.flat };
      this.remember(f, 'draw'); f.setProps({ draw: surface } as never);
      const t = twin(f, { rule: x.rule, params: x.params ?? {}, draw: surface, init: f.state.slice(0) }) as RasterField;
      // in step with it: the same moment, playing as it plays
      t.time = f.time; if (f.rate > 0) t.play(f.rate); else t.pause();
      if (view === 'difference') {
        hidden.push(f, t);
        const dd = { ...surface, ramp: ['#2166ac', '#67a9cf', '#d1e5f0', '#f7f7f7', '#fddbc7', '#ef8a62', '#b2182b'], domain: (d.diffDomain as [number, number] | undefined) ?? [-1, 1], min: -1e30 };
        const diffField = new (f.constructor as new (p: unknown) => RasterField)({ ...(f.props as object), id: `${f.id}--${b}--difference`, rule: f.rule, init: 0, rate: 0, draw: dd, gpu: false, above: f.id, order: undefined });
        twins.push(diffField);
        const tick = () => { const va = f.values(), vb = t.values(), g = new Float32Array(va.length); for (let k = 0; k < g.length; k++) g[k] = vb[k]! - va[k]!; diffField.reset(g); };
        const timer = setInterval(tick, 300); this.pendingOffs.push(() => clearInterval(timer)); tick();
      }
    }
    for (const t of twins) this.w.add(t);
    for (const l of hidden) { this.remember(l, 'when'); l.setProps({ when: false } as never); }
    if (view === 'difference') void this.markDiff(a, b).catch((e) => { if (this.cmp?.b === b) this.w.error(e); });
    const cv = { at: o.at ?? 0.5, leftHides: new Set<Element>(), rightHides: new Set<Element>() };
    if (view !== 'difference') for (const [orig, t] of pairs) { cv.leftHides.add(t); cv.rightHides.add(orig); }
    this.w.compareView = view === 'difference' ? null : cv;
    this.cmp = { a, b, view, twins, hidden, divider: view === 'difference' ? null : this.divider(cv, view === 'swipe'), offs: this.pendingOffs.splice(0) };
    this.w.invalidate();
    return this;
  }
  /** where the halves meet (0..1 of the width) */
  setSplit(at: number): this { const cv = this.w.compareView; if (cv) { cv.at = Math.max(0, Math.min(1, at)); this.placeDivider(); this.w.invalidate(); } return this; }
  get comparing(): { a: string; b: string; view: CompareView } | null { return this.cmp ? { a: this.cmp.a, b: this.cmp.b, view: this.cmp.view } : null; }
  private stopCompare(): void {
    const c = this.cmp; if (!c) return;
    this.cmp = null; this.w.compareView = null;
    for (const f of c.offs) f();
    for (const t of c.twins) this.w.remove(t.id);
    c.divider?.remove();
    // the layers hidden or redrawn for it, back as they were
    for (const [l, o] of this.originals) { if ('when' in o) { l.setProps({ when: o.when } as never); delete (o as { when?: unknown }).when; } if ('draw' in o) { l.setProps({ draw: o.draw } as never); delete o.draw; } }
    this.w.invalidate();
  }
  private pendingOffs: (() => void)[] = [];
  private diffSets = new Map<string, Set<string>>();
  private async markDiff(a: string, b: string): Promise<void> {
    const d = await this.diff(a, b);
    if (this.cmp?.a !== a || this.cmp?.b !== b) return;
    for (const k of ['added', 'removed', 'changed'] as const) for (const x of d[k]) for (const l of this.layersFor(x.source)) { const key = `${l.id}:${k}`; if (!this.diffSets.has(key)) this.diffSets.set(key, new Set()); this.diffSets.get(key)!.add(String(x.id)); }
    for (const t of this.cmp?.twins ?? []) t.setProps({} as never);
    this.w.invalidate();
  }
  /** the line where the halves meet (a handle to drag when swiping) */
  private divider(cv: { at: number }, drag: boolean): HTMLElement | null {
    const canvas = this.w.canvasElement; if (!canvas || typeof document === 'undefined' || !canvas.parentElement) return null;
    const el = document.createElement('div');
    Object.assign(el.style, { position: 'absolute', top: '0', bottom: '0', width: drag ? '22px' : '2px', marginLeft: drag ? '-11px' : '-1px', zIndex: '5', cursor: drag ? 'ew-resize' : 'default', touchAction: 'none', pointerEvents: drag ? 'auto' : 'none', display: 'flex', justifyContent: 'center' });
    const line = document.createElement('div'); Object.assign(line.style, { width: '2px', height: '100%', background: 'rgba(255,255,255,.9)', boxShadow: '0 0 4px rgba(0,0,0,.6)' }); el.appendChild(line);
    if (getComputedStyle(canvas.parentElement).position === 'static') canvas.parentElement.style.position = 'relative';
    canvas.parentElement.appendChild(el);
    if (drag) {
      let on = false;
      el.addEventListener('pointerdown', (e) => { on = true; el.setPointerCapture(e.pointerId); e.stopPropagation(); });
      el.addEventListener('pointermove', (e) => { if (!on) return; const r = canvas.getBoundingClientRect(); this.setSplit((e.clientX - r.left) / r.width); e.stopPropagation(); });
      el.addEventListener('pointerup', () => { on = false; });
    }
    this.dividerEl = el; void cv; this.placeDivider();
    return el;
  }
  private dividerEl: HTMLElement | null = null;
  private placeDivider(): void {
    const el = this.dividerEl, canvas = this.w.canvasElement, cv = this.w.compareView; if (!el || !canvas || !cv) return;
    el.style.left = `${canvas.offsetLeft + cv.at * canvas.clientWidth}px`; el.style.top = `${canvas.offsetTop}px`; el.style.height = `${canvas.clientHeight}px`; el.style.bottom = '';
  }
  private isTwin(l: Element): boolean { return !!this.cmp?.twins.includes(l) || this.building.has(l); }
  private building = new Set<Element>();
  private layersFor(key: string): Element[] {
    return this.w.elements.filter((l) => !this.isTwin(l) && (l.id === key || ((l.props as { data?: unknown }).data instanceof Source && ((this.originals.get(l)?.data ?? (l.props as { data: Source }).data) as Source).id === key)));
  }
  private originalData(key: string): unknown { const l = this.layersFor(key)[0]; if (!l) return undefined; return this.originals.get(l)?.data ?? (l.props as { data?: unknown }).data; }
  private originalRuleName(id: string): string { const l = this.w.element(id); if (!l || !isField(l)) return '—'; return (this.originals.get(l)?.rule ?? (l as RasterField).rule).name; }
  private remember(l: Element, what: 'data' | 'rule' | 'draw' | 'when'): void {
    const o = this.originals.get(l) ?? {}; this.originals.set(l, o);
    if (what in o) return;
    if (what === 'data') o.data = (l.props as { data?: unknown }).data;
    else if (what === 'rule') { const f = l as RasterField; o.rule = f.rule; o.params = Object.fromEntries(Object.keys(f.rule.params).map((n) => [n, f.rule.params[n]!.value])); }
    else if (what === 'draw') o.draw = (l.props as { draw?: unknown }).draw;
    else (o as { when?: unknown }).when = l.props.when;
  }
  /** everything a scenario changed, back */
  private restore(): void {
    for (const [l, o] of this.originals) {
      if ('data' in o) l.setProps({ data: o.data } as never);
      if (o.rule && isField(l)) void l.setRule(o.rule, o.params ?? {}).catch((e) => this.w.error(e));
    }
    for (const [l, o] of [...this.originals]) { delete o.data; delete o.rule; delete o.params; if (!Object.keys(o).length) this.originals.delete(l); }
    for (const [k, v] of this.paramsBefore) this.w.set(k, v);
    this.paramsBefore.clear();
  }
}
/** w.scenario(name, opts) defines one; w.scenario.use / diff / compare / list / current */
export type ScenarioApi = ((name: string, o?: ScenarioOptions) => Scenario) & { use(name: string): Scenarios; diff(a: string, b: string): Promise<ScenarioDiff>; compare(a: string | null, b?: string, o?: { view?: CompareView; at?: number }): Scenarios; setSplit(at: number): Scenarios; list(): string[]; readonly current: string; readonly comparing: Scenarios['comparing']; readonly manager: Scenarios };
export function scenarioApi(w: ScenarioWorld): ScenarioApi {
  const m = new Scenarios(w);
  const f = ((name: string, o?: ScenarioOptions) => m.define(name, o)) as ScenarioApi;
  Object.defineProperties(f, {
    use: { value: (n: string) => m.use(n) }, diff: { value: (a: string, b: string) => m.diff(a, b) }, compare: { value: (a: string | null, b?: string, o?: { view?: CompareView; at?: number }) => m.compare(a, b, o) },
    setSplit: { value: (x: number) => m.setSplit(x) }, list: { value: () => m.list() }, current: { get: () => m.current }, comparing: { get: () => m.comparing }, manager: { value: m },
  });
  return f;
}
