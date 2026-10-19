// core › world › host › react › elements: what a shell (the React component, a flow node, your own) keeps in step with
// its props, using only the world's own calls; it imports no framework. Elements are aslnut's own objects (layer(…),
// entities(…), …), matched by id from one list to the next: a new id is added (w.add), a gone one removed (w.remove), a
// changed prop set on the element already in the world (element.setProps: never made again). The list's order is the
// order new elements are added in; a place in the stack is a prop (order, above, below), set like any other. Options
// that have a setter follow their changes (time, theme, …); a changed view moves the camera only when asked
// ('go' | 'fly'): the camera is the person's. The rest (body, graphics, loader, …) are the world's for its life.
//   const s = shell(w, { options });
//   s.elements([layer({ id: 'roads', data, line: { color: dark ? '#fff' : '#333' } })]);   // a restyle, not a rebuild
//   s.options({ ...options, time: new Date('2026-06-21T12:00') });                         // → w.setTime(…)
import type { FlyOptions } from '../../observation/observers/orbit/camera.ts';
import type { View } from '../../observation/observers/orbit/views.ts';
import type { Element } from '../element.ts';
import { AslnutError } from '../errors.ts';
import type { World, WorldOptions } from '../world.ts';

/** how a changed `options.view` moves the camera: 'go' (a jump), 'fly' or fly options (a flight); unset: it stays */
export type ViewChange = 'go' | 'fly' | FlyOptions;
export interface ShellOptions {
  /** the options the world was made with (what later options are compared with) */
  options?: WorldOptions;
  viewChange?: ViewChange;
}
export interface Shell {
  /** keep the world's elements to this list (by id) */
  elements(list: readonly Element[]): void;
  /** keep the world's options to these (the ones with a setter) */
  options(o: WorldOptions, viewChange?: ViewChange): void;
  /** the ids it added and keeps, in the list's order */
  readonly ids: readonly string[];
}

const plain = (x: unknown): x is Record<string, unknown> => {
  if (!x || typeof x !== 'object') return false;
  const p = Object.getPrototypeOf(x); return p === Object.prototype || p === null;
};
/** the same value: the same object, or plain objects and arrays with the same values (`depth` levels down), dates at
 *  the same time. Functions, sources and other objects are the same only when they are the same object */
export function same(a: unknown, b: unknown, depth = 3): boolean {
  if (Object.is(a, b)) return true;
  if (depth <= 0 || !a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (Array.isArray(a) && Array.isArray(b)) { if (a.length !== b.length) return false; for (let i = 0; i < a.length; i++) if (!same(a[i], b[i], depth - 1)) return false; return true; }
  if (!plain(a) || !plain(b)) return false;
  const ka = Object.keys(a); if (ka.length !== Object.keys(b).length) return false;
  for (const k of ka) if (!(k in b) || !same(a[k], b[k], depth - 1)) return false;
  return true;
}
/** the props that differ (a prop gone is set to undefined); null: none */
function changed(was: Record<string, unknown>, now: Record<string, unknown>): Record<string, unknown> | null {
  let out: Record<string, unknown> | null = null;
  for (const k of new Set([...Object.keys(was), ...Object.keys(now)])) if (k !== 'id' && !same(was[k], now[k])) (out ??= {})[k] = now[k];
  return out;
}

type Opt = WorldOptions;
/** the options with a setter: when one counts as changed, and the world's call for its new value */
const SETTERS: { key: (o: Opt) => unknown; set: (w: World, o: Opt) => void }[] = [
  { key: (o) => o.views, set: (w, o) => { for (const [k, v] of Object.entries(o.views ?? {})) w.addView(k, v); } },
  { key: (o) => o.time, set: (w, o) => { w.setTime(o.time ?? 'now'); } },
  { key: (o) => o.timeZone, set: (w, o) => { w.setTimeZone(o.timeZone); } },
  // a value is set; unset, 'auto' or your function: back to the world's own (the device's, or the function it was made with)
  { key: (o) => o.render?.quality ?? o.quality, set: (w, o) => { const q = o.render?.quality ?? o.quality; w.setQuality(q === 'lite' || q === 'realistic' ? q : null); } },
  { key: (o) => o.render?.shadows, set: (w, o) => { w.setShadows(o.render?.shadows ?? false); } },
  // (a theme is made again by theme.dark() each render: the same by its name and settings)
  { key: (o) => (o.theme ? [o.theme.name, o.theme.spec] : o.theme), set: (w, o) => { w.setTheme(o.theme ?? null); } },
  { key: (o) => o.budget, set: (w, o) => { const b = o.budget; w.setBudget(b === 'auto' || b === undefined ? w.profile?.budget ?? null : b === false ? null : b); } },
  { key: (o) => o.priorities, set: (w, o) => { w.setPriorities(o.priorities ?? {}); } },
  { key: (o) => o.observation, set: (w, o) => { w.observe(o.observation ?? null); } },
];

/** keep a world in step with what a shell's props say */
export function shell(w: World, so: ShellOptions = {}): Shell {
  /** the elements it added, by id, with the props the last list gave each */
  const held = new Map<string, { el: Element; props: Record<string, unknown> }>();
  let opts: Opt = so.options ?? {}, order: string[] = [], warned = false;
  const fail = (e: unknown) => { if (!w.isDisposed) w.error(e); };
  const run = (f: () => void) => { try { f(); } catch (e) { fail(e); } };
  const inWorld = (el: Element) => w.list.includes(el);

  /** remove these, what is placed above or below another of them first (the world refuses to strand it) */
  function removeAll(els: Element[]): void {
    let rest = els.filter(inWorld);
    while (rest.length) {
      const anchors = rest.filter((el) => rest.some((x) => x !== el && (x.above === el.id || x.below === el.id)));
      const now = anchors.length < rest.length ? rest.filter((el) => !anchors.includes(el)) : rest;
      for (const el of now) run(() => { w.remove(el.id); });
      rest = now === rest ? [] : anchors;
    }
  }

  function elements(list: readonly Element[]): void {
    if (w.isDisposed) return;
    const next = new Map<string, Element>(), add: Element[] = [], swapped: Element[] = [], set: [Element, Record<string, unknown>][] = [];
    for (const el of list) {
      if (!el || typeof el.frame !== 'function') { fail(new AslnutError('E-WORLD-001', 'elements take aslnut elements', { fix: "elements={[layer({ id: 'roads', data, line: { color } })]}" })); continue; }
      if (next.has(el.id)) { fail(new AslnutError('E-WORLD-001', `two elements with id '${el.id}'`, { where: el.id, fix: 'give each element its own id' })); continue; }
      next.set(el.id, el);
      const h = held.get(el.id);
      if (!h) { add.push(el); continue; }
      const now = el.props as unknown as Record<string, unknown>;
      if (h.el === el) { h.props = now; continue; }
      // another kind under the same id: made anew (the only rebuild, and the list's own doing)
      if (el.constructor !== h.el.constructor || el.kind !== h.el.kind) { swapped.push(h.el); held.delete(el.id); add.push(el); continue; }
      const p = changed(h.props, now); h.props = now;
      if (p) set.push([h.el, p]);
    }
    // an element without an id of its own is a new one each time it is made: said once
    if (!warned && held.size) for (const el of add) if (el.props.id === undefined) { warned = true; fail(new AslnutError('E-WORLD-001', `element '${el.id}' has no id of its own: a new one is added each time it is made`, { where: el.id, fix: "give it an id: layer({ id: 'roads', … })" })); break; }
    const gone: Element[] = []; for (const [id, h] of held) if (!next.has(id)) { gone.push(h.el); held.delete(id); }
    // the order: the swapped ones out, the new ones in (one add: one placed above another new one finds it), the
    // changed props set (a new place may name a new element), then the gone ones out (a kept one placed above one of
    // them has been moved by now)
    removeAll(swapped);
    const taken = add.filter((el) => w.list.some((x) => x.id === el.id));
    for (const el of taken) fail(new AslnutError('E-WORLD-001', `two elements with id '${el.id}'`, { where: el.id, fix: "the world has one already (its body's, or one added by hand): give this one its own id" }));
    const fresh = add.filter((el) => !taken.includes(el));
    if (fresh.length) run(() => { w.add(...fresh); });
    for (const el of fresh) if (inWorld(el)) held.set(el.id, { el, props: el.props as unknown as Record<string, unknown> });
    for (const [el, p] of set) run(() => { el.setProps(p as never); });
    removeAll(gone);
    order = [...next.keys()].filter((id) => held.has(id));
  }

  function options(o: Opt, viewChange = so.viewChange): void {
    if (w.isDisposed) return;
    const was = opts; opts = o;
    for (const s of SETTERS) if (!same(s.key(was), s.key(o))) run(() => { s.set(w, o); });
    if (viewChange !== undefined && o.view !== undefined && !same(was.view, o.view)) {
      const v = o.view as View | string;
      run(() => { if (viewChange === 'go') w.go(v); else void w.fly(v, viewChange === 'fly' ? undefined : viewChange).catch(fail); });
    }
  }
  return { elements, options, get ids() { return order; } };
}
