// core › world › host › react: <World> and its hooks in React (its development build: strict mode mounts, unmounts and
// mounts again), on a small page of the DOM's own (React needs a document to render into; the world is headless:
// world(null)). The worlds made and disposed are counted on the World class itself.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// ── a page: just what React's DOM renderer touches ──
class Node0 {
  childNodes: Node0[] = []; parentNode: Node0 | null = null; nodeType = 1; nodeName = ''; ownerDocument: unknown = null; namespaceURI = 'http://www.w3.org/1999/xhtml';
  get firstChild(): Node0 | null { return this.childNodes[0] ?? null; }
  get lastChild(): Node0 | null { return this.childNodes.at(-1) ?? null; }
  get nextSibling(): Node0 | null { const p = this.parentNode; if (!p) return null; return p.childNodes[p.childNodes.indexOf(this) + 1] ?? null; }
  appendChild<T extends Node0>(c: T): T { c.parentNode?.removeChild(c); this.childNodes.push(c); c.parentNode = this; return c; }
  insertBefore<T extends Node0>(c: T, ref: Node0 | null): T { if (!ref) return this.appendChild(c); c.parentNode?.removeChild(c); this.childNodes.splice(this.childNodes.indexOf(ref), 0, c); c.parentNode = this; return c; }
  removeChild<T extends Node0>(c: T): T { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  remove(): void { this.parentNode?.removeChild(this); }
  addEventListener(): void {} removeEventListener(): void {}
  get textContent(): string { return this.childNodes.map((c) => c.textContent).join(''); }
  set textContent(v: string) { this.childNodes = []; if (v) this.appendChild(new Text0(v)); }
}
class Text0 extends Node0 {
  nodeValue: string;
  constructor(v: string) { super(); this.nodeType = 3; this.nodeName = '#text'; this.nodeValue = v; }
  override get textContent(): string { return this.nodeValue; }
  override set textContent(v: string) { this.nodeValue = v; }
}
class El extends Node0 {
  tagName: string; attrs = new Map<string, string>(); style: Record<string, string> & { cssText?: string; setProperty?: (k: string, v: string) => void } = {};
  constructor(tag: string, doc: unknown) { super(); this.tagName = tag.toUpperCase(); this.nodeName = this.tagName; this.ownerDocument = doc; this.style.setProperty = (k, v) => { this.style[k] = v; }; }
  setAttribute(k: string, v: string): void { this.attrs.set(k, String(v)); }
  removeAttribute(k: string): void { this.attrs.delete(k); }
  getAttribute(k: string): string | null { return this.attrs.get(k) ?? null; }
  hasAttribute(k: string): boolean { return this.attrs.has(k); }
}
class Doc extends Node0 {
  activeElement = null; body: El; documentElement: El; defaultView: unknown = null;
  constructor() { super(); this.nodeType = 9; this.nodeName = '#document'; this.documentElement = this.appendChild(new El('html', this)); this.body = this.documentElement.appendChild(new El('body', this)); }
  createElement(tag: string): El { return new El(tag, this); }
  createElementNS(_ns: string, tag: string): El { return new El(tag, this); }
  createTextNode(v: string): Node0 { return new Text0(v); }
}
const doc = new Doc();
const win = { document: doc, HTMLIFrameElement: class {}, navigator: { userAgent: 'node' }, addEventListener() {}, removeEventListener() {}, event: undefined, location: { href: 'about:blank' } };
doc.defaultView = win;
Object.assign(globalThis, { window: win, document: doc, IS_REACT_ACT_ENVIRONMENT: true });
if (!('navigator' in globalThis)) Object.assign(globalThis, { navigator: win.navigator });

const React = await import('react');
const { createRoot } = await import('react-dom/client');
const { World, useElement, useWorld, useWorldEvent } = await import('../src/react.ts');
const { World: WorldClass, points, layer } = await import('../src/index.ts');
const { act, createElement: h, StrictMode, useState } = React;

// every world made (world() jumps to its first view once) and disposed
const made: InstanceType<typeof WorldClass>[] = [], disposed: InstanceType<typeof WorldClass>[] = [];
const go = WorldClass.prototype.go, dispose = WorldClass.prototype.dispose;
WorldClass.prototype.go = function (this: InstanceType<typeof WorldClass>, v) { if (!made.includes(this)) made.push(this); return go.call(this, v); };
WorldClass.prototype.dispose = function (this: InstanceType<typeof WorldClass>) { if (!this.isDisposed) disposed.push(this); return dispose.call(this); };
const settle = () => act(async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0)); });
const pts = [{ id: 'a', props: {}, geometry: { type: 'Point' as const, coordinates: [0, 0] } }];
const sq = [{ id: 's', props: {}, geometry: { type: 'Polygon' as const, coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]] } }];

test('react: strict mode mounts twice: the first world is disposed, one stays; unmount disposes it', async () => {
  made.length = 0; disposed.length = 0;
  const box = doc.body.appendChild(doc.createElement('div')), root = createRoot(box as unknown as HTMLElement);
  const ready: unknown[] = [];
  await act(async () => { root.render(h(StrictMode, null, h(World, { headless: true, elements: [points({ id: 'dots', data: pts })], onReady: (w) => ready.push(w), style: { height: '300px' } }))); });
  await settle();
  assert.equal(made.length, 2, 'mounted, unmounted, mounted: two worlds');
  assert.deepEqual(disposed, [made[0]], 'the first disposed as soon as it was made');
  assert.equal(ready.length, 1, 'onReady once, with the world that stays');
  assert.equal(ready[0], made[1]);
  assert.ok(made[1]!.list.some((x) => x.id === 'dots'), 'its elements added before onReady');
  assert.equal(made[0]!.list.length, 0, 'the first never got them');
  await act(async () => { root.unmount(); });
  assert.deepEqual(disposed, [made[0], made[1]], 'unmount disposes');
  assert.ok(made.every((w) => w.isDisposed));
});

test('react: a state change restyles the element in the world (setProps), never a new world or element', async () => {
  made.length = 0; disposed.length = 0;
  let toggle: () => void = () => {};
  let added = 0, removed = 0;
  const name = (d: { id?: string | number }) => String(d.id);
  function App() {
    const [dark, setDark] = useState(false);
    toggle = () => setDark((x) => !x);
    return h(World, {
      headless: true,
      onReady: (w) => { w.on('elements', (c) => { if (c.what === 'add') added += c.ids.length; if (c.what === 'remove') removed += c.ids.length; }); },
      // a new layer each render: kept in step by id
      elements: [layer({ id: 'zones', data: sq, area: { color: dark ? '#222' : '#ddd' }, labels: { text: name } }), ...(dark ? [] : [points({ id: 'dots', data: pts })])],
    });
  }
  const box = doc.body.appendChild(doc.createElement('div')), root = createRoot(box as unknown as HTMLElement);
  await act(async () => { root.render(h(StrictMode, null, h(App))); });
  await settle();
  const w = made.at(-1)!, zones = w.element('zones');
  assert.equal((zones.props as { area: { color: string } }).area.color, '#ddd');
  await act(async () => { toggle(); });
  assert.equal(w.element('zones'), zones, 'the same element');
  assert.equal((zones.props as { area: { color: string } }).area.color, '#222', 'restyled');
  assert.ok(!w.list.some((x) => x.id === 'dots'), 'gone from the list: removed');
  assert.equal(removed, 1); assert.equal(added, 0);
  await act(async () => { toggle(); });
  assert.equal(added, 1, 'back in the list: added');
  assert.equal(made.length, 2, 'no world made again (two: strict mode\'s)');
  await act(async () => { root.unmount(); });
  assert.ok(w.isDisposed);
});

test('react: hooks read the world, an element by id and the world\'s events', async () => {
  made.length = 0; disposed.length = 0;
  const seen: { world: unknown[]; dots: unknown[]; selected: string[][] } = { world: [], dots: [], selected: [] };
  let show: (on: boolean) => void = () => {};
  function Panel() {
    const w = useWorld(), dots = useElement('dots');
    const [, set] = useState(0);
    useWorldEvent('select', (ids) => { seen.selected.push(ids); set((n) => n + 1); });
    seen.world.push(w); seen.dots.push(dots);
    return null;
  }
  function App() {
    const [on, setOn] = useState(true);
    show = setOn;
    return h(World, { headless: true, elements: on ? [points({ id: 'dots', data: pts })] : [] }, h(Panel));
  }
  const box = doc.body.appendChild(doc.createElement('div')), root = createRoot(box as unknown as HTMLElement);
  await act(async () => { root.render(h(App)); });
  assert.equal(seen.world[0], null, 'null before the world is ready');
  await settle();
  const w = made.at(-1)!;
  assert.equal(seen.world.at(-1), w);
  assert.equal(seen.dots.at(-1), w.element('dots'));
  await act(async () => { w.select(['a']); });
  assert.deepEqual(seen.selected, [['a']], 'heard once');
  await act(async () => { show(false); });
  assert.equal(seen.dots.at(-1), null, 'removed: null');
  await act(async () => { root.unmount(); });
  assert.ok(w.isDisposed);
  assert.equal(w.list.length, 0);
});

test('react: a canvas of its own per world, removed with it; the box holds the children', async () => {
  made.length = 0; disposed.length = 0;
  const box = doc.body.appendChild(doc.createElement('div')), root = createRoot(box as unknown as HTMLElement);
  const errors: unknown[] = [];
  // here there is no graphics: world(canvas) fails, said through onError (the page's own way)
  await act(async () => { root.render(h(StrictMode, null, h(World, { options: { onError: (e) => errors.push(e) }, className: 'map' }, h('p', null, 'over the world')))); });
  await settle();
  const outer = box.firstChild as El, holder = outer.firstChild as El;
  assert.equal(outer.getAttribute('class'), 'map');
  assert.equal(outer.style.position, 'relative');
  assert.equal(holder.childNodes.length, 1, 'one canvas (strict mode removed the first)');
  assert.equal((holder.firstChild as El).tagName, 'CANVAS');
  assert.equal(outer.childNodes[1]!.textContent, 'over the world');
  assert.equal(errors.length, 1, 'the world that stays says why it could not draw');
  await act(async () => { root.unmount(); });
  assert.equal(holder.childNodes.length, 0, 'its canvas removed');
});
