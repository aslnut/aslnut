// core › world › host › react: on a server. Importing 'aslnut/react' and rendering <World> to a string need no window,
// document or graphics, and make no world: the page gets an empty box, the world is made in the browser.
import { test } from 'node:test';
import assert from 'node:assert/strict';

// a server: none of a browser's names (a read of one throws; feature checks with typeof see it is not there)
const BROWSER = ['window', 'document', 'HTMLCanvasElement', 'OffscreenCanvas', 'requestAnimationFrame', 'matchMedia', 'ResizeObserver', 'devicePixelRatio'];

test('react on a server: the import and the render touch nothing of a browser, and no world is made', async () => {
  const { createElement: h, StrictMode } = await import('react');
  const { renderToString } = await import('react-dom/server');
  const { World, useWorld, useElement } = await import('../src/react.ts');
  const { World: WorldClass, earth, imagery, layer, points } = await import('../src/index.ts');
  assert.deepEqual(BROWSER.filter((n) => n in globalThis), [], 'no browser here');
  let made = 0;
  const go = WorldClass.prototype.go;
  WorldClass.prototype.go = function (this: InstanceType<typeof WorldClass>, v) { made++; return go.call(this, v); };
  const seen: unknown[] = [];
  function Panel() { seen.push(useWorld(), useElement('zones')); return h('aside', null, 'panel'); }
  const html = renderToString(h(StrictMode, null, h(World, {
    options: { body: earth({ imagery: [imagery.osm()] }), view: { lon: 0, lat: 0, zoom: 3 } },
    elements: [layer({ id: 'zones', data: [], area: { color: '#888' } }), points({ id: 'dots', data: [] })],
    onReady: () => { made++; },
    className: 'map', style: { height: '100vh' },
  }, h(Panel))));
  assert.equal(html, '<div class="map" style="position:relative;height:100vh"><div style="position:absolute;inset:0"></div><aside>panel</aside></div>');
  assert.equal(made, 0, 'no world made, onReady never called');
  assert.ok(seen.every((x) => x === null), 'the hooks give null');
  assert.deepEqual(BROWSER.filter((n) => n in globalThis), [], 'nothing of a browser was made up on the way');
  WorldClass.prototype.go = go;
});
