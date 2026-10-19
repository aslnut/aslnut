// core › geometry › shapes › shape: a shape is params and a build. Its params are typed (num, int, choice, color,
// flag, text) and clamped; it is made for instances (cached by its params and seed) with its levels (whole, simple, far:
// levels.ts), or built straight into a chunk's mesh with an id; check() builds it at its defaults and every param's
// ends; form(shape) gives a control per param.
//   const bin = shape({ params: { lid: color('#c43c2c') }, build: (b, p) => b.solid('box', { size: [.6, 1, .7], at: [0, .5, 0], color: p.lid }) })
import { MeshBuilder, SHAPE_FLOATS, type Colorish } from './mesh.ts';
import { AslnutError } from '../../world/errors.ts';
import { Builder } from './builder.ts';
import type { Anchor, Emitter, Part, V3 } from './parts.ts';
import { impostor, blockOf, boundsOf, shapeFrom, type ImpostorLevel } from './levels.ts';
import { kindOf, isKind, anchorKindsOf, type EntityKind } from '../../entities/kinds.ts';
import type { SizeRange } from '../../render/drawing/size.ts';

export type ParamSpec =
  | { kind: 'num'; min: number; max: number; def: number }
  | { kind: 'int'; min: number; max: number; def: number }
  | { kind: 'choice'; options: readonly string[]; def: string }
  | { kind: 'color'; def: string }
  | { kind: 'flag'; def: boolean }
  | { kind: 'text'; def: string; max: number };
export const num = (min: number, max: number, def = (min + max) / 2) => ({ kind: 'num' as const, min, max, def });
export const int = (min: number, max: number, def = Math.round((min + max) / 2)) => ({ kind: 'int' as const, min, max, def });
export const choice = (options: readonly string[], def = options[0]!) => ({ kind: 'choice' as const, options, def });
export const color = (def: string) => ({ kind: 'color' as const, def });
export const flag = (def = false) => ({ kind: 'flag' as const, def });
/** words (a livery, a sign's), cut to `max` characters */
export const text = (def = '', max = 24) => ({ kind: 'text' as const, def, max });
type ParamValue<S extends ParamSpec> = S extends { kind: 'num' | 'int' } ? number : S extends { kind: 'flag' } ? boolean : string;
export type ParamsOf<D extends Record<string, ParamSpec>> = { [K in keyof D]: ParamValue<D[K]> };
export interface ShapeSpec<D extends Record<string, ParamSpec>, X = object> {
  id?: string;
  params?: D;
  /** its defaults by what you give (a car given its type: that type's row of numbers): what you give stands over
   *  them, and they over its params' own defaults */
  defaults?: (given: Partial<ParamsOf<D>>) => Partial<ParamsOf<D>> | null | undefined;
  /** build it: the builder, its params (with what you pass beyond them: a footprint, a seed…), a seeded random */
  build: (b: Builder, p: ParamsOf<D> & X, rand: () => number) => void;
  /** a simpler form farther away: true (its build again at level 1: fewer sides, what is marked `detail: 0` left
   *  out), or your own build. Unset: none is made (the whole one is drawn there) */
  simple?: boolean | ((b: Builder, p: ParamsOf<D> & X, rand: () => number) => void);
  /** its far form: an impostor of the whole, a box or a dot in its colours, or your own build. Unset: none is made
   *  (the simple one, or the whole, is drawn there) */
  far?: ((b: Builder, p: ParamsOf<D> & X, rand: () => number) => void) | 'impostor' | 'box' | 'dot' | 'none';
  /** its range on screen: its own metres, kept within [min, max] CSS px across wherever it is drawn (a symbol that
   *  stays readable far away and never fills the screen near; core › render › drawing › size). Unset: its metres */
  size?: SizeRange;
  /** triangles allowed at each level */
  budget?: { whole?: number; simple?: number; far?: number };
  /** what it is (core › entities › identity › kind: a house, a vehicle, yours): the traits it carries, checked by
   *  check() at every param set, read by traits(made, kind) */
  kind?: EntityKind | string;
}
/** a shape built: its levels for instances [whole, simple, far], its parts and anchors, its size; its groups (their
 *  vertices in the whole level), the params it was made with, its kind's name */
export interface Made { levels: readonly (Float32Array | ImpostorLevel | null)[]; parts: Part[]; anchors: Anchor[]; triangles: number[]; bounds: [V3, V3]; groups?: { name: string; first: number; count: number }[]; /** its pieces by number (a vertex's part 1…15 and group 1…7 in its code): the parts (each its pivot and joint) and the groups */ pieces?: Pieces; params?: Record<string, unknown>; kind?: string; /** its range on screen (the shape's `size`) */ size?: SizeRange }
export interface ShapeCheck { ok: boolean; problems: string[]; triangles: { whole: number; simple: number; far: number }; builds: number }

export class Shape<D extends Record<string, ParamSpec> = Record<string, ParamSpec>, X = object> {
  readonly id: string; spec: ShapeSpec<D, X>;
  /** its builds (params and seed → made), the most lately used last: past CACHE_ENTRIES or CACHE_MB the least lately
   *  used out first (each build counted by its levels' bytes) */
  private cache = new Map<string, Made>(); private cacheBytes = 0;
  /** bumped by update(): what places it builds again (core › geometry › shapes › recipes › package: one definition) */
  version = 0;
  private watchers = new Set<() => void>();
  /** told when its definition changes (update): the layers placing it build again once, every clone follows */
  watch(fn: () => void): () => void { this.watchers.add(fn); return () => this.watchers.delete(fn); }
  /** a new definition for it (its build, levels, params…): its builds let go, every layer placing it builds again */
  update(spec: Partial<ShapeSpec<D, X>>): this {
    this.spec = { ...this.spec, ...spec }; this.cache.clear(); this.cacheBytes = 0; this.levels.clear(); this.version++;
    for (const f of [...this.watchers]) { try { f(); } catch (e) { console.error(e); } }
    return this;
  }
  constructor(spec: ShapeSpec<D, X>) {
    if (typeof spec?.build !== 'function') throw new AslnutError('E-DATA-001', 'a shape needs build(b, p)', { fix: "shape({ params: { h: num(1, 3, 2) }, build: (b, p) => b.solid('box', { size: [1, p.h, 1], at: [0, p.h / 2, 0] }) })" });
    this.spec = spec; this.id = spec.id ?? `shape-${++shapeSeq}`;
  }
  /** its params with your values over the defaults */
  params(p: Partial<ParamsOf<D> & X> = {}): ParamsOf<D> & X {
    const out: Record<string, unknown> = {}, d = (this.spec.defaults?.(p as Partial<ParamsOf<D>>) ?? {}) as Record<string, unknown>;
    for (const [k, s] of Object.entries(this.spec.params ?? {})) { const v = (p as Record<string, unknown>)[k]; out[k] = clampParam(s, v === undefined ? d[k] : v); }
    for (const [k, v] of Object.entries(p)) if (!(k in out)) out[k] = v;
    return out as ParamsOf<D> & X;
  }
  /** every level its builds made, by the hash of its numbers, held weakly (a level no build, layer or chip buffer keeps
   *  is let go, and its entry with it): builds that come out the same share one array however many were built between
   *  them (more than the cache keeps: 100 forms of 40 seeds each are 100 forms, not one more each time one was let go) */
  private levels = new Map<number, WeakRef<Float32Array>[]>();
  private gone = new FinalizationRegistry<number>((h) => { const a = this.levels.get(h); if (!a) return; const live = a.filter((r) => r.deref()); if (live.length) this.levels.set(h, live); else this.levels.delete(h); });
  /** a level the same as one made before (by its numbers): that one's array */
  private sameAs(l: Float32Array): Float32Array {
    const h = numbersHash(l), a = this.levels.get(h);
    if (a) for (const r of a) { const o = r.deref(); if (o && o !== l && o.length === l.length && sameNumbers(o, l)) return o; }
    if (a) a.push(new WeakRef(l)); else this.levels.set(h, [new WeakRef(l)]);
    this.gone.register(l, h);
    return l;
  }
  /** build it for instances (cached by its params and seed): levels whole, simple, far */
  make(p: Partial<ParamsOf<D> & X> = {}, seed = 1): Made {
    const pp = this.params(p), key = `${seed}|${JSON.stringify(pp)}`;
    let m = this.cache.get(key); if (m) { this.cache.delete(key); this.cache.set(key, m); return m; }
    const run = (level: number, fn = this.spec.build) => { const mb = new MeshBuilder(); const b = new Builder(mb, level); let r = seedRand(seed); fn(b, pp, r); r = null as never; return { shape: shapeFrom(mb), b }; };
    // pay only for what is set: a level not asked for is not built; the one before it stands in (the same array: no
    // second buffer, and an instance set of one form is never sorted by level)
    const whole = run(0), sp = this.spec.simple, simple = sp ? run(1, typeof sp === 'function' ? sp : this.spec.build) : null;
    // each piece's number in its vertices' code: its part (what a joint moves) and its group (what a clone may tint), by
    // name as the whole build has them (every level the same numbers)
    const partNames = [...new Set(whole.b.parts.map((x) => x.name))].slice(0, 15), groupNames = [...new Set(whole.b.groups.map((x) => x.name))].slice(0, 7);
    for (const r of [whole, simple]) if (r) r.shape = slotted(r.shape, r.b, partNames, groupNames);
    const ff = this.spec.far, farRun = typeof ff === 'function' ? run(2, ff) : null; if (farRun) farRun.shape = slotted(farRun.shape, farRun.b, partNames, groupNames);
    const f = this.spec.far, far = !f || f === 'none' ? null : farRun ? farRun.shape : f === 'box' || f === 'dot' ? blockOf(whole.shape, f) : impostor(whole.shape, { views: 8 });
    const mid = simple ? simple.shape : whole.shape;
    const k = this.spec.kind;
    // a level the same as one built before (a seed or a param that changes nothing there): that one's array, so one
    // buffer on the chip and its clones drawn with that build's
    m = { levels: [whole.shape, mid, far ?? mid].map((l) => (l instanceof Float32Array ? this.sameAs(l) : l)), parts: whole.b.parts, anchors: whole.b.anchors, triangles: [whole.b.triangles, simple ? simple.b.triangles : whole.b.triangles, far instanceof Float32Array ? far.length / 18 : far ? 2 : simple ? simple.b.triangles : whole.b.triangles], bounds: boundsOf(whole.shape), groups: whole.b.groups, pieces: { parts: partNames.map((n) => { const pt = whole.b.parts.find((x) => x.name === n)!; return { name: n, pivot: pt.pivot, ...(pt.joint ? { joint: pt.joint } : {}) }; }), groups: groupNames, emitters: whole.b.emitters }, params: pp as Record<string, unknown>, ...(k ? { kind: typeof k === 'string' ? k : k.name } : {}), ...(this.spec.size ? { size: this.spec.size } : {}) };
    this.cache.set(key, m); this.cacheBytes += bytesOf(m);
    for (const [k, old] of this.cache) { if (this.cache.size <= CACHE_ENTRIES && this.cacheBytes <= CACHE_MB * 1048576) break; if (old === m) continue; this.cache.delete(k); this.cacheBytes -= bytesOf(old); }
    return m;
  }
  /** build it straight into a mesh (a solids chunk's): placed and turned, its triangles carrying `id`, its tinted
   *  pieces in `tint` */
  into(mb: MeshBuilder, p: Partial<ParamsOf<D> & X>, o: { at?: V3; turn?: number; id?: number; level?: number; seed?: number; anchor?: [number, number]; /** the colour its tinted pieces take */ tint?: Colorish } = {}): Builder {
    const keepId = mb.idNow; if (o.id !== undefined) mb.as(o.id);
    if (o.anchor) mb.on(o.anchor);
    const b = new Builder(mb, o.level ?? 0); b.tintColor = o.tint ?? null;
    b.frame({ at: o.at ?? [0, 0, 0], turn: o.turn ?? 0 }, () => this.spec.build(b, this.params(p), seedRand(o.seed ?? 1)));
    mb.as(keepId); mb.on(null);
    return b;
  }
  /** build it at its defaults, at every param's ends and every choice: what breaks, what is over budget (`with`:
   *  what it is built on besides its params: a footprint…); its kind's traits (its own, or `kind`: a kind or a kind's
   *  name), missing or misplaced */
  check(withExtra: Partial<X> & { kind?: EntityKind | string } = {}): ShapeCheck {
    // (`kind` is the kind to check against, unless it is one of its params or what it is built on)
    const kw = (withExtra as { kind?: unknown }).kind, asKind = isKind(kw) || (typeof kw === 'string' && !(this.spec.params && 'kind' in this.spec.params));
    const k = asKind ? (kw as EntityKind | string) : this.spec.kind;
    if (asKind) { const { kind: _k, ...rest } = withExtra as Record<string, unknown>; withExtra = rest as typeof withExtra; void _k; }
    const problems: string[] = [], sets: Partial<ParamsOf<D>>[] = [{}], said = new Set<string>();
    // (anchors its kind places: where they may be is its kind's rule (a car park's bays well past a building's walls))
    const placed = k ? anchorKindsOf(kindOf(k)) : new Set<string>();
    for (const [k, s] of Object.entries(this.spec.params ?? {})) {
      if (s.kind === 'num' || s.kind === 'int') sets.push({ [k]: s.min } as never, { [k]: s.max } as never);
      else if (s.kind === 'choice') for (const o of s.options) sets.push({ [k]: o } as never);
      else if (s.kind === 'flag') sets.push({ [k]: !s.def } as never);
      else if (s.kind === 'text') sets.push({ [k]: '' } as never, { [k]: 'W'.repeat(s.max) } as never);
    }
    let tri = { whole: 0, simple: 0, far: 0 }, builds = 0;
    for (const p of sets) {
      let m: Made;
      try { this.cache.clear(); this.cacheBytes = 0; m = this.make({ ...withExtra, ...p } as never); builds++; } catch (e) { problems.push(`${JSON.stringify(p)}: ${(e as Error).message}`); continue; }
      const w = m.levels[0] as Float32Array;
      if (!w.length) problems.push(`${JSON.stringify(p)}: nothing built`);
      // (every level's vertices: a simple or a far form made by its own build)
      m.levels.forEach((l, L) => { if (!(l instanceof Float32Array) || (L > 0 && m.levels.indexOf(l) < L)) return; for (let i = 0; i < l.length; i++) if (!Number.isFinite(l[i]!)) { problems.push(`${JSON.stringify(p)}: a number that is not one (NaN or infinite) in its ${['whole', 'simple', 'far'][L]} level's vertices`); break; } });
      if (m.triangles[1]! > m.triangles[0]!) problems.push(`${JSON.stringify(p)}: the simple level has more triangles (${m.triangles[1]}) than the whole (${m.triangles[0]})`);
      // anchors and part pivots within reach of the shape (a seat a metre outside it is a mistake)
      const [lo, hi] = m.bounds, pad = Math.max(0.5, Math.max(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]) * 0.25), out = (q: V3) => q.some((v, k) => v < lo[k]! - pad || v > hi[k]! + pad);
      for (const a of m.anchors) if (!(a.kind && placed.has(a.kind)) && out(a.at)) problems.push(`${JSON.stringify(p)}: anchor '${a.name}' at ${a.at.map((v) => v.toFixed(2))} is outside the shape`);
      for (const pt of m.parts) { if (out(pt.pivot)) problems.push(`${JSON.stringify(p)}: part '${pt.name}' turns round a pivot outside the shape`); if (!pt.count) problems.push(`${JSON.stringify(p)}: part '${pt.name}' has nothing in it`); }
      // its kind's traits (each problem once: at the first params it shows at)
      if (k) for (const pr of kindOf(k).check(m).problems) if (!said.has(pr)) { said.add(pr); problems.push(`${JSON.stringify(p)}: ${pr}`); }
      tri = { whole: Math.max(tri.whole, m.triangles[0]!), simple: Math.max(tri.simple, m.triangles[1]!), far: Math.max(tri.far, m.triangles[2]!) };
    }
    const bu = this.spec.budget ?? {};
    if (bu.whole !== undefined && tri.whole > bu.whole) problems.push(`whole: ${tri.whole} triangles over its budget ${bu.whole}`);
    if (bu.simple !== undefined && tri.simple > bu.simple) problems.push(`simple: ${tri.simple} triangles over its budget ${bu.simple}`);
    if (bu.far !== undefined && tri.far > bu.far) problems.push(`far: ${tri.far} triangles over its budget ${bu.far}`);
    this.cache.clear(); this.cacheBytes = 0;
    return { ok: !problems.length, problems, triangles: tri, builds };
  }
}
let shapeSeq = 0;
/** a level's numbers hashed (FNV-1a over their bits): builds that come out the same share one array */
function numbersHash(l: Float32Array): number { const u = new Uint32Array(l.buffer, l.byteOffset, l.length); let h = 2166136261; for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i]!, 16777619); return h >>> 0; }
function sameNumbers(a: Float32Array, b: Float32Array): boolean { const x = new Uint32Array(a.buffer, a.byteOffset, a.length), y = new Uint32Array(b.buffer, b.byteOffset, b.length); for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false; return true; }
/** a shape's builds kept: at most this many, and this many MB of their levels */
export const CACHE_ENTRIES = 256, CACHE_MB = 48;
const bytesOf = (m: Made) => { let b = 0; const seen = new Set<unknown>(); for (const l of m.levels) if (l instanceof Float32Array && !seen.has(l)) { seen.add(l); b += l.byteLength; } return b; };
/** a shape's pieces by number: its parts (their pivots, their joints: what can move) and its groups (what a clone may
 *  tint) */
export interface Pieces { parts: { name: string; pivot: V3; joint?: Part['joint'] }[]; groups: string[]; /** its copies over time (copy: emit) */ emitters: Emitter[] }
/** a level's vertices with each one's part and group (their numbers 1…15 and 1…7, 0: none) in its code, as
 *  512 × (part + 16 × group) over the material and the own colour (below 512; a leaf card's code is left as it is) */
function slotted(sh: Float32Array, b: Builder, parts: readonly string[], groups: readonly string[]): Float32Array {
  if (!parts.length && !groups.length) return sh;
  const n = sh.length / SHAPE_FLOATS, slot = new Uint8Array(n);
  // (outer parts first: a part inside another takes its own number)
  for (const pt of [...b.parts].sort((a, c) => c.count - a.count)) { const k = parts.indexOf(pt.name) + 1; if (k > 0) for (let v = pt.first; v < Math.min(n, pt.first + pt.count); v++) slot[v] = (slot[v]! & 0xf0) | k; }
  for (const gr of b.groups) { const k = groups.indexOf(gr.name) + 1; if (k > 0) for (let v = gr.first; v < Math.min(n, gr.first + gr.count); v++) slot[v] = (slot[v]! & 0x0f) | (k << 4); }
  for (let v = 0; v < n; v++) { const i = v * SHAPE_FLOATS + 5; if (slot[v] && sh[i]! < 65536) sh[i] = (sh[i]! % 512) + 512 * slot[v]!; }
  return sh;
}
/** a shape: params and a build (see Builder for its verbs) */
export const shape = <D extends Record<string, ParamSpec> = Record<string, never>, X = object>(spec: ShapeSpec<D, X>) => new Shape<D, X>(spec);
function clampParam(s: ParamSpec, v: unknown): unknown {
  if (v === undefined || v === null) return s.def;
  if (s.kind === 'num') return Math.max(s.min, Math.min(s.max, Number(v)));
  if (s.kind === 'int') return Math.round(Math.max(s.min, Math.min(s.max, Number(v))));
  if (s.kind === 'choice') return s.options.includes(String(v)) ? String(v) : s.def;
  if (s.kind === 'flag') return !!v;
  if (s.kind === 'text') return String(v).slice(0, s.max);
  return String(v);
}
function seedRand(seed: number): () => number { let s = (seed * 2654435761) >>> 0 || 1; return () => { s ^= s << 13; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296; }; }

/** a form for a shape's params: one control each (a slider, a whole-number slider, a dropdown, a colour, a switch),
 *  with its range and default; `render` makes it in a page (its values go to `onChange`) */
export interface FormControl { key: string; kind: 'slider' | 'stepper' | 'dropdown' | 'colour' | 'switch' | 'text'; min?: number; max?: number; step?: number; options?: readonly string[]; value: unknown }
export function form<D extends Record<string, ParamSpec>, X>(s: Shape<D, X>): { controls: FormControl[]; render(into: HTMLElement, onChange: (p: Partial<ParamsOf<D>>) => void): HTMLElement } {
  const controls: FormControl[] = Object.entries(s.spec.params ?? {}).map(([key, p]) => p.kind === 'num' ? { key, kind: 'slider', min: p.min, max: p.max, step: (p.max - p.min) / 100, value: p.def } : p.kind === 'int' ? { key, kind: 'stepper', min: p.min, max: p.max, step: 1, value: p.def } : p.kind === 'choice' ? { key, kind: 'dropdown', options: p.options, value: p.def } : p.kind === 'color' ? { key, kind: 'colour', value: p.def } : p.kind === 'text' ? { key, kind: 'text', max: p.max, value: p.def } : { key, kind: 'switch', value: p.def });
  return {
    controls,
    render(into, onChange) {
      const box = document.createElement('div'), now: Record<string, unknown> = Object.fromEntries(controls.map((c) => [c.key, c.value]));
      for (const c of controls) {
        const row = document.createElement('label'); row.style.display = 'block'; row.textContent = `${c.key} `;
        let el: HTMLInputElement | HTMLSelectElement;
        if (c.kind === 'dropdown') { const sel = document.createElement('select'); for (const o of c.options ?? []) { const op = document.createElement('option'); op.value = o; op.textContent = o; sel.appendChild(op); } sel.value = String(c.value); el = sel; }
        else { const inp = document.createElement('input'); inp.type = c.kind === 'colour' ? 'color' : c.kind === 'switch' ? 'checkbox' : c.kind === 'text' ? 'text' : 'range'; if (c.max !== undefined && c.kind === 'text') inp.maxLength = c.max; if (c.min !== undefined && c.kind !== 'text') inp.min = String(c.min); if (c.max !== undefined && c.kind !== 'text') inp.max = String(c.max); if (c.step !== undefined) inp.step = String(c.step); if (c.kind === 'switch') inp.checked = !!c.value; else inp.value = String(c.value); el = inp; }
        el.addEventListener('input', () => { now[c.key] = c.kind === 'switch' ? (el as HTMLInputElement).checked : c.kind === 'slider' || c.kind === 'stepper' ? Number(el.value) : el.value; onChange({ ...now } as Partial<ParamsOf<D>>); });
        row.appendChild(el); box.appendChild(row);
      }
      into.appendChild(box); return box;
    },
  };
}
