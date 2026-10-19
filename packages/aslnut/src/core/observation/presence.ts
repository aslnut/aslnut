// core › observation › presence: one gate on every element (terrain sources, imagery, marks, layers, features). It
// decides whether something is SHOWN, never whether it exists, by the observation level, the time and the state;
// never by the camera (the orbit only moves the picture). No `when`: always shown (a GIS layer has no gate).
//   when: { level: { from: 'district' }, hour: [18, 6] }   the shorthand (ranges are [from, to); hours wrap round midnight)
//   when: s => s.observation.level === 'room' && s.user.toggles.rooms      a function of the state (boolean, or 0..1)
//   when: false                                                             a plain boolean
import { AslnutError } from '../world/errors.ts';
import type { Api, Quality, State } from '../world/state.ts';
import { inLevels, type LevelSpec } from './levels.ts';

export type Range = readonly [number, number];
export interface WhenShorthand {
  /** the observation level: one ('street'), a set (['city', 'district']) or a range ({ from: 'district' }) */
  level?: LevelSpec;
  /** local solar hour; [18, 6] = from 18:00 to 06:00 */
  hour?: Range;
  year?: Range; month?: Range;
  api?: Api | Api[];
  quality?: Quality;
  role?: string | string[];
  /** a user toggle that must be on */
  toggle?: string;
}
export type WhenFn = (s: State) => boolean | number;
export type When = boolean | WhenShorthand | WhenFn;

const inRange = (v: number, r: Range) => v >= r[0] && v < r[1];
const inWrapped = (v: number, r: Range) => (r[0] <= r[1] ? inRange(v, r) : v >= r[0] || v < r[1]);
const KEYS = ['level', 'hour', 'year', 'month', 'api', 'quality', 'role', 'toggle'];
/** the camera's keys, gone: presence never follows the camera */
const CAMERA = ['zoom', 'dist', 'altitude', 'tilt'];

/** how much is shown: 0 (hidden) … 1 (fully); a fraction fades */
export function shown(when: When | undefined, s: State, where = ''): number {
  if (when === undefined || when === true) return 1;
  if (when === false) return 0;
  if (typeof when === 'function') {
    let r: unknown;
    try { r = when(s); } catch (e) { throw new AslnutError('E-WHEN-001', `a 'when' function threw: ${(e as Error).message}`, { where, fix: 'check the fields it reads exist on s (s.observation, s.time, s.world, s.user, s.device, s.render)', cause: e }); }
    if (typeof r === 'boolean') return r ? 1 : 0;
    if (typeof r === 'number' && Number.isFinite(r)) return r < 0 ? 0 : r > 1 ? 1 : r;
    throw new AslnutError('E-WHEN-001', `a 'when' function returned ${typeof r === 'number' ? r : typeof r}`, { where, fix: 'return a boolean, or a number from 0 to 1' });
  }
  if (typeof when === 'object') {
    for (const k of Object.keys(when)) {
      if (CAMERA.includes(k)) throw new AslnutError('E-WHEN-001', `'when: { ${k} }' is gone: the camera never decides what is shown`, { where, fix: "use the observation level: when: { level: { from: 'district' } } (world(canvas, { observation: { levels: 'default' } })); a GIS layer needs no gate at all" });
      if (!KEYS.includes(k)) throw new AslnutError('E-WHEN-001', `unknown 'when' key '${k}'`, { where, fix: `use one of ${KEYS.join(', ')}, or a function s => …` });
    }
    const w = when, t = s.time;
    if (w.level !== undefined) {
      const o = s.observation;
      if (!o || o.level === null) throw new AslnutError('E-WHEN-001', "'when: { level }' in a world with no levels", { where, fix: "world(canvas, { observation: { levels: 'default' } }) (a world turns the default ladder on by itself when an element asks for a level)" });
      if (!inLevels(w.level, o.levels, o.index, where)) return 0;
    }
    if (w.hour && !inWrapped(t.hour, w.hour)) return 0;
    if (w.year && !inRange(t.year, w.year)) return 0;
    if (w.month && !inWrapped(t.month, w.month)) return 0;
    if (w.api && !(Array.isArray(w.api) ? w.api : [w.api]).includes(s.device.api)) return 0;
    if (w.quality && s.render.quality !== w.quality) return 0;
    if (w.role && !(Array.isArray(w.role) ? w.role : [w.role]).includes(s.user.role)) return 0;
    if (w.toggle && !s.user.toggles[w.toggle]) return 0;
    return 1;
  }
  throw new AslnutError('E-WHEN-001', `'when' is a ${typeof when}`, { where, fix: "use a boolean, an object like { level: 'street' } or { hour: [18, 6] }, or a function s => …" });
}

/** the state as a gate sees it, every field it reads written down (path parts joined by \u0001): a gate asked over
 *  thousands of features is asked again only when one of those fields changed */
export function tracked<T extends object>(o: T, rec: Set<string>, path = ''): T {
  return new Proxy(o, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (typeof k !== 'string') return v;
      const p = path ? `${path}\u0001${k}` : k;
      if (v && typeof v === 'object' && !(v instanceof Date) && !Array.isArray(v)) return tracked(v as object, rec, p);
      rec.add(p); return v;
    },
  });
}
/** the values at the paths a gate read, as one string (compared frame to frame) */
export function readsOf(s: object, paths: readonly string[]): string {
  let out = '';
  for (const p of paths) {
    let v: unknown = s;
    for (const k of p.split('\u0001')) { if (v === null || v === undefined) break; v = (v as Record<string, unknown>)[k]; }
    out += `${p}=${v instanceof Date ? v.getTime() : Array.isArray(v) ? v.join('\u0002') : v && typeof v === 'object' ? JSON.stringify(v) : String(v)}\u0003`;
  }
  return out;
}
/** a gate's answer as 0..1 */
export function gateValue(r: unknown, where: string): number {
  if (typeof r === 'boolean') return r ? 1 : 0;
  if (typeof r === 'number' && Number.isFinite(r)) return r < 0 ? 0 : r > 1 ? 1 : r;
  throw new AslnutError('E-WHEN-001', `a 'when' function returned ${typeof r === 'number' ? r : typeof r}`, { where, fix: 'return a boolean, or a number from 0 to 1' });
}

/** a prop that may be a constant or a function of the state */
export type Fn<T> = T | ((s: State) => T);
export const valueOf = <T>(v: Fn<T>, s: State): T => (typeof v === 'function' ? (v as (s: State) => T)(s) : v);

/** does a gate read the observation level (a level change may turn it: core › observation › gates swap such
 *  elements together, once). A shorthand with `level`; a function asked once with the state watched */
export function asksLevel(when: When | undefined, s: State): boolean {
  if (when === undefined || typeof when === 'boolean') return false;
  if (typeof when === 'object') return (when as WhenShorthand).level !== undefined;
  const rec = new Set<string>();
  try { when(tracked(s, rec)); } catch { return false; }
  for (const p of rec) if (p === 'observation' || p.startsWith('observation\u0001')) return true;
  return false;
}

// ── params by level ─────────────────────────────────────────────────────────────────────────────────────────────────
// Any prop of any element may be given per observation level: an object whose only key is `level`, its value the
// rungs by name (plain JSON: a catalog or a config carries it). A rung not named takes the nearest named coarser rung
// on the ladder; with none coarser, the nearest finer. It is resolved once a level change (the same moment `when`
// turns, through the gates' margin and dwell), never per frame, and applied through the element's own setProps.
//   points({ size: { level: { district: 6, street: 14 } } })     world … district: 6 · street, building, room: 14
//   field({ res: { level: { street: 1, district: 4, city: 16 } } })

/** a value given per observation level: { level: { district: 6, street: 14 } } (any value: a number, a colour, an
 *  object, an array) */
export interface LevelValues<T> { level: Record<string, T> }
/** a value, or the same given per observation level */
export type ByLevel<T> = T | LevelValues<T>;
/** props, each of which may be given per observation level (where element props enter: factories, setProps) */
export type Leveled<P> = { [K in keyof P]: P[K] | LevelValues<P[K]> };

const plain = (v: unknown): v is Record<string, unknown> => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return false;
  const pr = Object.getPrototypeOf(v);
  return pr === Object.prototype || pr === null;
};
/** a prop given per level: a plain object whose ONLY key is `level`, its value a plain object of rungs (nothing else
 *  is taken for one). `when` is never one: its own `{ level }` is presence */
export function isByLevel(v: unknown): v is LevelValues<unknown> {
  if (!plain(v)) return false;
  const ks = Object.keys(v);
  return ks.length === 1 && ks[0] === 'level' && plain(v.level);
}
/** the value a prop given per level takes at the rung `index` of `names`: the nearest named rung at or coarser than
 *  it, else the nearest finer. A rung not on the ladder is an error (E-LEVEL-002), `where` the element and prop */
export function levelValue<T>(spec: LevelValues<T>, names: readonly string[], index: number, where = ''): T {
  const given = Object.keys(spec.level);
  if (!given.length) throw new AslnutError('E-LEVEL-002', `${where || 'a prop by level'}: no levels named`, { where, fix: "name at least one level: { level: { district: 6, street: 14 } }" });
  let coarse = -1, fine = Infinity;
  for (const n of given) {
    const k = names.indexOf(n);
    if (k < 0) throw new AslnutError('E-LEVEL-002', `${where || 'a prop by level'}: no level '${n}' on the ladder`, { where, fix: names.length ? `the levels: ${names.join(', ')}` : "this world has no levels: world(canvas, { observation: { levels: 'default' } })" });
    if (k <= index) { if (k > coarse) coarse = k; } else if (k < fine) fine = k;
  }
  return spec.level[names[coarse >= 0 ? coarse : fine]!] as T;
}
