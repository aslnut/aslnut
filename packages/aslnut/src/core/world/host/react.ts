// core › world › host › react: aslnut in a React app ('aslnut/react'). <World> makes a world on a canvas of its own when
// it mounts (world(canvas, options)) and disposes it when it unmounts; its elements are aslnut's own objects, kept in
// step by id (core › world › host › shell: new → w.add, gone → w.remove, a changed prop → element.setProps, never made
// again). Hooks read the world from context: useWorld(), useElement(id), useWorldEvent(name, fn). React is an optional
// peer: nothing else in aslnut imports it. Server-safe: on a server it renders an empty box and touches nothing.
//   <World options={{ body: plane() }} elements={[layer({ id: 'zones', data, area: { color: dark ? '#333' : '#ddd' } })]}
//     onReady={(w) => w.fly('zones')} style={{ height: '100vh' }}>
//     <Panel />                                     {/* useWorldEvent('tap', (p) => …) inside */}
//   </World>
import { createContext, createElement, useCallback, useContext, useEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type ReactElement, type ReactNode } from 'react';
import type { Element } from '../element.ts';
import { world as makeWorld, type World as AslnutWorld, type WorldEvents, type WorldOptions } from '../world.ts';
import { shell, type Shell, type ViewChange } from './shell.ts';

export interface WorldProps {
  /** what the world is made with (world(canvas, options)); later, the ones with a setter follow their changes (views,
   *  time, timeZone, quality, render.shadows, theme, budget, priorities, observation), the rest stay as made (a new
   *  world: a new `key`) */
  options?: WorldOptions;
  /** aslnut's elements (layer(…), entities(…), …), each with an id: kept in step by id */
  elements?: readonly Element[];
  /** the world is ready, its elements added (once per world) */
  onReady?: (w: AslnutWorld) => void;
  /** a changed `options.view`: 'go' jumps there, 'fly' (or fly options) flies; unset: the camera stays the person's */
  viewChange?: ViewChange;
  /** no canvas, nothing drawn: world(null) (an app's tests) */
  headless?: boolean;
  className?: string;
  /** the box the world fills (give it a size); it is `position: relative` unless you say */
  style?: CSSProperties;
  /** drawn over the world (panels, legends): they read it with the hooks */
  children?: ReactNode;
}

const WorldContext = createContext<AslnutWorld | null>(null);
const FILL: CSSProperties = { position: 'absolute', inset: 0 };

/** a world in a React app: made on mount on its own canvas, disposed on unmount */
export function World(p: WorldProps): ReactElement {
  const box = useRef<HTMLDivElement>(null);
  const kept = useRef<Shell | null>(null);
  const [w, setW] = useState<AslnutWorld | null>(null);
  const headless = !!p.headless, options = p.options;
  // made once per mount (strict mode mounts twice: the first world is disposed as soon as it exists), on a canvas of
  // its own: a canvas a disposed world let go is never drawn on again
  useEffect(() => {
    let live = true, made: AslnutWorld | null = null;
    const o = options ?? {};
    const canvas = headless ? null : document.createElement('canvas');
    if (canvas) { canvas.style.cssText = 'display:block;width:100%;height:100%;touch-action:none'; box.current?.appendChild(canvas); }
    makeWorld(canvas, o).then((x) => {
      if (!live) { x.dispose(); return; }
      made = x; kept.current = shell(x, { options: o }); setW(x);
    }, (e: unknown) => { if (live) (o.onError ?? console.error)(e); });
    return () => { live = false; kept.current = null; made?.dispose(); made = null; setW(null); canvas?.remove(); };
  }, [headless]); // eslint-disable-line react-hooks/exhaustive-deps
  // (in this order: the elements are in the world before onReady)
  useEffect(() => { if (w && kept.current) kept.current.elements(p.elements ?? []); }, [w, p.elements]);
  useEffect(() => { if (w && kept.current) kept.current.options(p.options ?? {}, p.viewChange); }, [w, p.options, p.viewChange]);
  useEffect(() => { if (w) p.onReady?.(w); }, [w]); // eslint-disable-line react-hooks/exhaustive-deps
  return createElement(WorldContext.Provider, { value: w },
    createElement('div', { className: p.className, style: { position: 'relative', ...p.style } },
      createElement('div', { ref: box, style: FILL }), p.children));
}

/** the world of the <World> round it (null until it is ready, and after it is gone) */
export function useWorld(): AslnutWorld | null { return useContext(WorldContext); }

/** an element of the world by id (null until it is added, and after it is removed); `w`: another world than the
 *  context's */
export function useElement<E extends Element = Element>(id: string, w?: AslnutWorld | null): E | null {
  const ctx = useContext(WorldContext), world = w === undefined ? ctx : w;
  const subscribe = useCallback((changed: () => void) => { if (!world) return () => {}; const off = world.on('elements', changed); return () => { off(); }; }, [world]);
  const get = () => (world && !world.isDisposed ? (world.list.find((x) => x.id === id) as E | undefined) ?? null : null);
  return useSyncExternalStore(subscribe, get, () => null);
}

/** hear a world's event while mounted (w.on(name, fn)): 'tap', 'hover', 'select', 'elements', 'level', 'frame',
 *  'error', 'long', 'governor'. Your function may change each render; it is heard once. `w`: another world than the
 *  context's */
export function useWorldEvent<K extends keyof WorldEvents>(name: K, fn: (...e: WorldEvents[K]) => void, w?: AslnutWorld | null): void {
  const ctx = useContext(WorldContext), world = w === undefined ? ctx : w;
  const latest = useRef(fn);
  useEffect(() => { latest.current = fn; });
  useEffect(() => {
    if (!world || world.isDisposed) return;
    const off = world.on(name, (...e: WorldEvents[K]) => latest.current(...e));
    return () => { off(); };
  }, [world, name]);
}

export type { ViewChange } from './shell.ts';
