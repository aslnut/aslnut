// core › observation › levels: the ladder of levels a world is looked at (world › country › region › city ›
// district › street › building › room by default; an app renames it or cuts it), the level now, and the binding that
// lets the orbit drive it. The level changes only past an edge by a margin (hysteresis) and after a dwell (debounce),
// so an acrobatic orbit (a pinch overshooting, a wheel's burst over an edge and back) never flips it. The app can set
// the level directly; the orbit then drives it again only once it crosses its next edge.
// A world without levels has none of this: nothing measured, nothing gated (a GIS map).
//   world(canvas, { observation: { levels: 'default' } })            the default ladder, bound to the orbit
//   world(canvas, { observation: { levels: ['city', 'district', 'street'], margin: 0.5, dwell: 1 } })
//   w.level · w.setLevel('street') · w.on('level', e => …) · s.observation.level
import { AslnutError } from '../world/errors.ts';
import type { State } from '../world/state.ts';

/** a rung of the ladder: its name, and the zoom it starts at (coarse first) */
export interface Rung { readonly name: string; readonly from: number }
/** the default ladder: the web-map zoom at the centre (the screen-shape-free one) each level starts at */
export const DEFAULT_LADDER: readonly Rung[] = Object.freeze([
  { name: 'world', from: -Infinity }, { name: 'country', from: 3.5 }, { name: 'region', from: 6.5 }, { name: 'city', from: 9.5 },
  { name: 'district', from: 12.5 }, { name: 'street', from: 14.5 }, { name: 'building', from: 17 }, { name: 'room', from: 19 },
]);
/** 'default', or the rungs: names from the default ladder (cut: each keeps its default edge), or your own { name, from } */
export type LevelsOption = 'default' | readonly (string | { name: string; from: number })[];
/** the gates' defaults (core › observation › gates): one realistic setting */
export const GATES = Object.freeze({ margin: 0.3, dwell: 0.5, ahead: 1, keep: Object.freeze({ levels: 2, seconds: 60 }) });

export interface ObservationOptions {
  /** the ladder (unset: no levels; a `when: { level }` turns the default one on) */
  levels?: LevelsOption;
  /** the level it starts at (default: the orbit's) */
  level?: string;
  /** who drives the level: 'orbit' (default: the orbit's zoom, through the gates), false (the app alone), or your
   *  function of the state (another observer's rule; its answer passes the dwell too) */
  bind?: 'orbit' | false | ((s: State) => string | null | undefined);
  /** zoom levels past an edge before the level changes (default 0.3) */
  margin?: number;
  /** seconds past the margin before the level changes (default 0.5) */
  dwell?: number;
  /** zoom levels before an edge where the next level's data loads quietly (default 1) */
  ahead?: number;
  /** the last levels' data and built shapes kept: how many levels back, and how long (default 2 levels, 60 s) */
  keep?: { levels?: number; seconds?: number };
}
/** a level change: from, to, and who made it */
export interface LevelChange { from: string | null; to: string; by: 'orbit' | 'app' | 'bind' }
/** presence by level: one rung, a set of rungs, or a range on the ladder (inclusive) */
export type LevelSpec = string | readonly string[] | { from?: string; to?: string };
/** what `when` reads: s.observation */
export interface ObservationState { level: string | null; index: number; levels: readonly string[]; by: 'orbit' | 'app' | 'bind' | null }
/** a world with no levels (a GIS map): nothing gated */
export const NO_OBSERVATION: ObservationState = { level: null, index: -1, levels: [], by: null };

/** the ladder an option names */
export function ladderOf(o: LevelsOption): Rung[] {
  if (o === 'default') return DEFAULT_LADDER.map((r) => ({ ...r }));
  if (!Array.isArray(o) || !o.length) throw new AslnutError('E-LEVEL-001', 'observation levels: give a list of levels, or \'default\'', { where: 'observation.levels', fix: "levels: 'default' · levels: ['city', 'district', 'street'] · levels: [{ name: 'campus', from: 0 }, { name: 'room', from: 19 }]" });
  const out: Rung[] = [];
  for (const x of o) {
    if (typeof x === 'string') {
      const d = DEFAULT_LADDER.find((r) => r.name === x);
      if (!d) throw new AslnutError('E-LEVEL-001', `observation levels: '${x}' is not a default level`, { where: 'observation.levels', fix: `a default level (${DEFAULT_LADDER.map((r) => r.name).join(', ')}), or your own { name, from }` });
      out.push({ ...d });
    } else if (x && typeof x.name === 'string' && typeof x.from === 'number') out.push({ name: x.name, from: x.from });
    else throw new AslnutError('E-LEVEL-001', `observation levels: ${JSON.stringify(x)} is not a level`, { where: 'observation.levels', fix: "a name ('street') or { name, from: zoom }" });
  }
  out.sort((a, b) => a.from - b.from);
  out[0] = { name: out[0]!.name, from: -Infinity };   // the coarsest takes everything below it
  if (new Set(out.map((r) => r.name)).size !== out.length) throw new AslnutError('E-LEVEL-001', 'observation levels: a name twice', { where: 'observation.levels', fix: 'give each level its own name' });
  return out;
}

/** the levels a world is looked at: the ladder, the level now, the binding through the margin and the dwell */
export class Levels {
  readonly ladder: Rung[];
  readonly names: readonly string[];
  readonly margin: number; readonly dwell: number; readonly ahead: number; readonly keep: { levels: number; seconds: number };
  bind: ObservationOptions['bind'];
  /** the level now (an index on the ladder) and who set it */
  index: number; by: 'orbit' | 'app' | 'bind' = 'orbit';
  /** the orbit's own rung, tracked through the gates (the level follows it whenever it changes) */
  private orbitAt: number;
  /** a change waiting out its dwell: to which rung, since when (ms) */
  private pending: { to: number; since: number } | null = null;
  /** the levels looked at before, the latest first (keep) */
  readonly recent: string[] = [];
  private stateNow: ObservationState;

  constructor(o: ObservationOptions, zoom: number, s?: State) {
    this.ladder = ladderOf(o.levels ?? 'default');
    this.names = this.ladder.map((r) => r.name);
    this.margin = Math.max(0, o.margin ?? GATES.margin); this.dwell = Math.max(0, o.dwell ?? GATES.dwell); this.ahead = Math.max(0, o.ahead ?? GATES.ahead);
    this.keep = { levels: Math.max(0, o.keep?.levels ?? GATES.keep.levels), seconds: Math.max(0, o.keep?.seconds ?? GATES.keep.seconds) };
    this.bind = o.bind === undefined ? 'orbit' : o.bind;
    this.orbitAt = this.rungOf(zoom);
    this.index = this.orbitAt;
    if (typeof this.bind === 'function' && s) { const n = this.bound(s); if (n !== null) { this.index = n; this.by = 'bind'; } }
    if (o.level !== undefined) { this.index = this.indexOf(o.level, 'observation.level'); this.by = 'app'; }
    this.stateNow = this.makeState();
  }
  /** the level now */
  get level(): string { return this.ladder[this.index]!.name; }
  /** what `when` reads (the same object until the level changes: gates asked again only then) */
  get state(): ObservationState { return this.stateNow; }
  /** the rung a zoom is on, no margin */
  rungOf(zoom: number): number { let i = 0; while (i + 1 < this.ladder.length && zoom >= this.ladder[i + 1]!.from) i++; return i; }
  indexOf(name: string, where = 'level'): number {
    const i = this.names.indexOf(name);
    if (i < 0) throw new AslnutError('E-LEVEL-001', `no level '${name}'`, { where, fix: `the levels: ${this.names.join(', ')}` });
    return i;
  }
  /** the rung the orbit would move to through the margin (its own rung when it is within the margin of its edges) */
  private through(zoom: number): number {
    const i = this.orbitAt, lo = this.ladder[i]!.from, hi = i + 1 < this.ladder.length ? this.ladder[i + 1]!.from : Infinity;
    if (zoom >= hi + this.margin) return this.rungOf(zoom - this.margin);
    if (zoom < lo - this.margin) return this.rungOf(zoom + this.margin);
    return i;
  }
  private bound(s: State): number | null {
    const f = this.bind as (s: State) => string | null | undefined;
    let n: string | null | undefined;
    try { n = f(s); } catch (e) { throw new AslnutError('E-LEVEL-001', `observation bind threw: ${(e as Error).message}`, { where: 'observation.bind', fix: 'return a level name (or null: no change)', cause: e }); }
    return n === null || n === undefined ? null : this.indexOf(n, 'observation.bind');
  }
  /** a step of the binding (each frame, and between frames while a change waits out its dwell): the change it makes,
   *  or null. `now` in ms (the real clock: a dwell is felt time) */
  step(zoom: number, now: number, s?: State): LevelChange | null {
    if (this.bind === false) { this.pending = null; return null; }
    const target = typeof this.bind === 'function' ? (s ? this.bound(s) : null) ?? this.index : this.through(zoom);
    const at = typeof this.bind === 'function' ? this.index : this.orbitAt;
    if (target === at) { this.pending = null; return null; }
    if (!this.pending || this.pending.to !== target) { this.pending = { to: target, since: now }; if (this.dwell > 0) return null; }
    if (now - this.pending.since < this.dwell * 1000) return null;
    this.pending = null;
    if (typeof this.bind !== 'function') this.orbitAt = target;
    if (target === this.index) return null;
    return this.go(target, typeof this.bind === 'function' ? 'bind' : 'orbit');
  }
  /** a change is waiting out its dwell (a still view looks again when it is due) */
  get waiting(): number | null { return this.pending ? this.pending.since + this.dwell * 1000 : null; }
  /** the app sets the level (the orbit drives it again past its next edge) */
  set(name: string): LevelChange | null { const i = this.indexOf(name); if (i === this.index) { this.by = 'app'; return null; } return this.go(i, 'app'); }
  private go(i: number, by: LevelChange['by']): LevelChange {
    const from = this.level;
    this.index = i; this.by = by;
    this.recent.unshift(from); const seen = new Set<string>(); for (let k = 0; k < this.recent.length; k++) { const n = this.recent[k]!; if (seen.has(n) || n === this.level) { this.recent.splice(k--, 1); } else seen.add(n); }
    if (this.recent.length > 8) this.recent.length = 8;
    this.stateNow = this.makeState();
    return { from, to: this.level, by };
  }
  /** the neighbour level the orbit is within `ahead` of (its data loads quietly), or null */
  near(zoom: number): number | null {
    if (this.bind !== 'orbit' || this.ahead <= 0) return null;
    const i = this.orbitAt, lo = this.ladder[i]!.from, hi = i + 1 < this.ladder.length ? this.ladder[i + 1]!.from : Infinity;
    if (zoom >= hi - this.ahead) return i + 1;
    if (zoom < lo + this.ahead && i > 0) return i - 1;
    return null;
  }
  /** the state `when` would read at another level (ahead of need) */
  stateAt(i: number): ObservationState { return { level: this.ladder[i]!.name, index: i, levels: this.names, by: this.by }; }
  private makeState(): ObservationState { return { level: this.level, index: this.index, levels: this.names, by: this.by }; }
  /** does a level (by index) fall in a spec */
  matches(spec: LevelSpec, i: number, where = ''): boolean { return inLevels(spec, this.names, i, where); }
}

/** does the level at index i of these names fall in a spec (one rung, a set, a range on the ladder) */
export function inLevels(spec: LevelSpec, names: readonly string[], i: number, where = ''): boolean {
  const at = (n: string) => {
    const k = names.indexOf(n);
    if (k < 0) throw new AslnutError('E-LEVEL-001', `no level '${n}'`, { where, fix: names.length ? `the levels: ${names.join(', ')}` : "this world has no levels: world(canvas, { observation: { levels: 'default' } })" });
    return k;
  };
  if (typeof spec === 'string') return at(spec) === i;
  if (Array.isArray(spec)) return spec.some((n) => at(n) === i);
  const r = spec as { from?: string; to?: string };
  if (!r || typeof r !== 'object' || (r.from === undefined && r.to === undefined)) throw new AslnutError('E-WHEN-001', `'when: { level }' is ${JSON.stringify(spec)}`, { where, fix: "a level ('street'), levels (['city', 'district']) or a range ({ from: 'district' } · { from: 'city', to: 'street' })" });
  const a = r.from === undefined ? 0 : at(r.from), b = r.to === undefined ? names.length - 1 : at(r.to);
  return i >= Math.min(a, b) && i <= Math.max(a, b);
}
