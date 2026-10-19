// The foundation (core › observation, core › encoding): orbit › observation › data › viz. A level changes only past
// its edge by a margin and after a dwell; a level change swaps once and keeps what it hid a while; data is never
// changed by looking (a scale reads the whole data, never what a view loaded); features keep their slots by id; a
// layer is one statement (its signs and labels inside).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { world, area, points, layer, scale, Element, Levels, Join, AslnutError, data, Tiled, type Feature } from '../src/index.ts';

const square = (id: string, x: number, v: number): Feature => ({ id, props: { v, name: `n${id}` }, geometry: { type: 'Polygon', coordinates: [[[x, 0], [x + 1, 0], [x + 1, 1], [x, 1], [x, 0]]] } });

test('levels: the default ladder; a change only past the edge by the margin and after the dwell; acrobatics never flip it', () => {
  const L = new Levels({ levels: 'default' }, 13);
  assert.equal(L.level, 'district'); assert.deepEqual(L.names, ['world', 'country', 'region', 'city', 'district', 'street', 'building', 'room']);
  // a pinch over the street edge (14.5) and back, faster than the dwell: nothing
  let t = 0;
  for (const z of [14.6, 14.9, 15.2, 14.7, 14.2, 14.9, 15.1, 14.4]) { assert.equal(L.step(z, (t += 100)), null); }
  assert.equal(L.level, 'district', 'a burst over the edge and back changes nothing');
  // within the margin for long: nothing
  assert.equal(L.step(14.75, (t += 100)), null); assert.equal(L.step(14.75, (t += 2000)), null);
  // past the margin for the dwell: one change
  assert.equal(L.step(14.9, (t += 100)), null);
  const ch = L.step(14.9, (t += 600)); assert.deepEqual(ch, { from: 'district', to: 'street', by: 'orbit' });
  // back down within the margin (14.5 - 0.3): it holds
  assert.equal(L.step(14.25, (t += 100)), null); assert.equal(L.step(14.25, (t += 2000)), null); assert.equal(L.level, 'street');
  // a fast zoom out past several edges: one change, to where it stays
  L.step(9, (t += 100)); const ch2 = L.step(9, (t += 600)); assert.equal(ch2?.to, 'region');
});

test('levels: the app sets the level; the orbit drives it again only past its next edge; a cut or own ladder; errors', () => {
  const L = new Levels({ levels: 'default' }, 13);
  assert.deepEqual(L.set('room'), { from: 'district', to: 'room', by: 'app' });
  let t = 0;
  assert.equal(L.step(13.2, (t += 100)), null); assert.equal(L.step(13.2, (t += 1000)), null); assert.equal(L.level, 'room', 'the orbit within its rung: the app\'s level holds');
  L.step(15, (t += 100)); assert.equal(L.step(15, (t += 600))?.to, 'street', 'past the next edge: the orbit drives it again');
  const cut = new Levels({ levels: ['city', 'street', 'room'] }, 3);
  assert.equal(cut.level, 'city', 'the coarsest takes everything below it'); assert.equal(cut.ladder[1]!.from, 14.5);
  const own = new Levels({ levels: [{ name: 'campus', from: 0 }, { name: 'building', from: 16 }, { name: 'room', from: 19 }], margin: 0, dwell: 0 }, 17);
  assert.equal(own.level, 'building'); assert.equal(own.step(19.1, 1)?.to, 'room', 'no margin, no dwell: at once');
  const off = new Levels({ levels: 'default', bind: false }, 13);
  assert.equal(off.step(18, 1), null); assert.equal(off.step(18, 5000), null); assert.equal(off.level, 'district', 'bind false: the app alone');
  assert.throws(() => new Levels({ levels: ['moon'] }, 3), (e: unknown) => e instanceof AslnutError && e.code === 'E-LEVEL-001');
  assert.throws(() => L.set('moon'), /no level 'moon'.*the levels: world/);
  // ahead: near an edge, the neighbour level
  const A = new Levels({ levels: 'default' }, 14);
  assert.equal(A.near(14), 5, 'within a zoom of the street edge: street ahead'); assert.equal(A.near(12.7), 3, 'near the city edge: city ahead');
  const B = new Levels({ levels: 'default', ahead: 0.5 }, 13.5); assert.equal(B.near(13.5), null, 'in the middle of its rung: nothing ahead');
});

/** an element ready only after a few prepares (data loading), counting what the gates did to it */
class Slow extends Element {
  readonly kind = 'custom' as const;
  n = 0; let = 0; readonly need: number; constructor(p: ConstructorParameters<typeof Element>[0], need = 3) { super(p); this.need = need; }
  override prepare(): boolean { return ++this.n >= this.need; }
  override status() { return { ready: this.n >= this.need, pending: this.n >= this.need ? [] : ['loading'], failed: [], missing: [] }; }
  override letGo(): void { this.let++; this.n = 0; }
  frame() { return []; }
}

test('gates: a level change swaps once (the new level\'s things together, when ready; the old ones until then); keep, then let go', async () => {
  const w = await world(null, { view: { lon: 145, lat: -37.9, zoom: 13 }, observation: { levels: 'default', keep: { levels: 2, seconds: 60 } } });
  const near = new Slow({ id: 'near', when: { level: 'street' } }, 4), far = new Slow({ id: 'far', when: { level: 'district' } }, 1), always = new Slow({ id: 'always' }, 1);
  w.add(near, far, always); w.step(16);
  assert.equal(w.level, 'district'); assert.equal(far.target, 1); assert.equal(near.target, 0); assert.equal(always.target, 1);
  const seen: string[] = []; w.on('level', (e) => seen.push(`${e.from}>${e.to}`));
  w.go({ lon: 145, lat: -37.9, zoom: 15.2 }); w.step(16); w.step(600);
  assert.deepEqual(seen, ['district>street']);
  // the swap: 'near' is loading; 'far' stays shown meanwhile, 'near' waits; neither alone
  assert.equal(far.target, 1, 'the old level\'s stays until the new is ready'); assert.equal(near.target, 0, 'what comes in waits');
  for (let i = 0; i < 6; i++) w.step(16);
  assert.equal(near.target, 1); assert.equal(far.target, 0, 'together, in one frame'); assert.equal(always.target, 1, 'what both levels show is never touched');
  assert.equal(w.observation!.counts.swaps, 1);
  // keep: back to district within the keep: nothing let go, back at once
  w.go({ lon: 145, lat: -37.9, zoom: 13 }); w.step(16); w.step(600); w.step(16);
  assert.equal(w.level, 'district'); assert.equal(far.target, 1); assert.equal(far.let, 0);
  // far away for longer than the keep: let go
  w.go({ lon: 145, lat: -37.9, zoom: 18 }); w.step(16); w.step(600); for (let i = 0; i < 8; i++) w.step(16);
  assert.equal(w.level, 'building');
  w.step(61000); w.step(16);
  assert.ok(far.let >= 1 && near.let >= 1, `let go after the keep (far ${far.let}, near ${near.let})`);
  w.dispose();
});

test('join: features keep their slots by id whatever order they come in; a gone one\'s slot is taken only after the next build', () => {
  const j = new Join(), it = (k: string, d: unknown = { props: { v: 1 } }) => ({ key: k, d, geometry: null });
  const a = j.next([it('a'), it('b'), it('c')]);
  assert.deepEqual(a, [0, 1, 2]); assert.deepEqual(j.last, { new: 3, changed: 0, gone: 0, stayed: 0 });
  const b = j.next([it('c'), it('a'), it('b')]);
  assert.deepEqual(b, [2, 0, 1], 'a new order: the same slots'); assert.deepEqual(j.last, { new: 0, changed: 0, gone: 0, stayed: 3 });
  j.next([it('a'), it('c', { props: { v: 2 } })]);
  assert.deepEqual(j.last, { new: 0, changed: 1, gone: 1, stayed: 1 }); assert.deepEqual(j.gone, [1]);
  assert.deepEqual(j.next([it('a'), it('c', { props: { v: 2 } }), it('d')]), [0, 2, 3], 'the gone slot is not taken before a build');
  j.built();
  assert.deepEqual(j.next([it('a'), it('c', { props: { v: 2 } }), it('d'), it('e')]).at(-1), 1, 'after it: taken again');
});

test('scales: from the whole data, once per change of it; the same value gives the same colour whatever is loaded; a tiled source needs a domain', async () => {
  const all = Array.from({ length: 20 }, (_, i) => square(`s${i}`, i, i));
  const q = scale.quantile((d: Feature) => d.props.v as number, { n: 4, range: 'reds' });
  q.prepare(all, 'src:1'); const c7 = q(all[7]);
  q.prepare(all.slice(5, 9), 'src:1'); assert.equal(q(all[7]), c7, 'the same key: nothing read again');
  const w = await world(null), fill = area({ id: 'a', data: all, color: q }); w.add(fill); w.step(16);
  assert.equal(q(all[7]), c7, 'a mark reads the whole data');
  // a source that follows the view, a scale with 'auto': an error with its fix; with a domain: fine
  class ByView extends Tiled { constructor() { super({}); } protected async load() {} protected async tile() { return []; } }
  const errs: unknown[] = []; const w2 = await world(null, { onError: (e) => errs.push(e) });
  w2.add(area({ id: 'b', data: new ByView(), color: scale.quantile((d: Feature) => d.props.v as number) }));
  w2.step(16); await new Promise((k) => setTimeout(k, 0));
  assert.ok(errs.some((e) => e instanceof AslnutError && e.code === 'E-DATA-003' && /domain/.test(e.fix)), String(errs[0]));
  assert.equal(scale.threshold((d: Feature) => d.props.v as number, { domain: [1, 2] }).auto, false);
  assert.equal(scale.quantile((d: Feature) => d.props.v as number, { domain: [5, 10, 15] }).auto, false, 'given breaks: kept');
  w.dispose(); w2.dispose();
});

test('a layer is one statement: its signs and labels inside, one id, one switch, one opacity, one place in the stack, one pick', async () => {
  const fs = [square('a', 0, 1), square('b', 2, 5)];
  const w = await world(null);
  const L = layer({ id: 'suburbs', label: 'Suburbs', data: fs, area: { color: scale.quantile((d: Feature) => d.props.v as number) }, line: { width: 1, color: '#fff' }, labels: { text: (d: Feature) => d.props.name as string } });
  w.add(L, points({ id: 'dots', data: [{ at: [0, 0] }] }));
  w.step(16);
  assert.deepEqual(L.signs.map((m) => m.id), ['suburbs-fill', 'suburbs-line']);
  assert.equal(L.kind, 'area'); assert.ok(w.list.some((l) => l.id === 'suburbs-labels'), 'its labels: in the labels\' band, owned by it');
  assert.equal(w.element('suburbs-labels').owner, L);
  assert.equal(typeof (L.props as { color?: unknown }).color, 'function', 'its legend: its fill\'s scale');
  // one switch: hidden, its labels too
  w.hide('suburbs', { seconds: 0 }); w.step(16);
  assert.equal(L.target, 0); assert.equal(w.element('suburbs-labels').target, 0);
  w.release('suburbs', { seconds: 0 }); w.step(16); assert.equal(w.element('suburbs-labels').target, 1);
  // one opacity
  w.setOpacity('suburbs', 0.5); assert.equal(L.signs[0]!.props.opacity, 0.5); assert.equal(w.element('suburbs-labels').props.opacity, 0.5);
  // one pick: a sign's feature reported as the layer's (its features read as a frame would)
  const fill = L.signs[0] as unknown as { entries: { index: number }[]; read(n: number): { index: number }[] };
  fill.entries = fill.read(0);
  const p = L.pickInfo(fill.entries[1]!.index); assert.equal(p?.element, 'suburbs'); assert.equal(p?.id, 'b');
  // one place in the stack: its labels take the same place among the labels
  w.reorder(['dots', 'suburbs']);
  assert.ok((w.element('suburbs-labels').props.order ?? 0) > 6 && (w.element('suburbs-labels').props.order ?? 0) < 7);
  // no gate by default: a GIS layer is shown, at any zoom
  for (const zoom of [3, 9, 14, 19]) { w.go({ lon: 0, lat: 0, zoom }); w.step(16); assert.equal(L.target, 1); }
  assert.equal(w.level, null, 'no levels: nothing gated, nothing measured');
  w.remove('suburbs'); assert.ok(!w.list.some((l) => l.id === 'suburbs-labels'), 'removed with it');
  assert.throws(() => layer({ id: 'x', data: fs }), /says nothing/);
  w.dispose();
});

test('data is never changed by looking: a WFS loads once; a view moving over a layer asks for nothing', async () => {
  let asked = 0;
  const fetch = (async (url: string) => { asked++; const q = new URL(url).searchParams; const fs = [square('a', 0, 1), square('b', 2, 5)].map((f) => ({ type: 'Feature', id: f.id, properties: f.props, geometry: f.geometry })); return new Response(JSON.stringify({ type: 'FeatureCollection', features: fs.slice(Number(q.get('startIndex') ?? 0)), numberMatched: 2 })); }) as typeof globalThis.fetch;
  const w = await world(null);
  const L = layer({ id: 'suburbs', data: data.wfs('https://x/wfs', { typeName: 'ns:s', extent: [0, 0, 4, 1], fetch }), area: { color: '#f00' } });
  w.add(L); const src = L.source!, ctx = { loader: w.loader, error: (e: unknown) => { throw e; } };
  await src.start(ctx); w.step(16);
  const n = asked; assert.equal(src.size, 2);
  for (const [zoom, tilt, bearing] of [[4, 0, 0], [12, 60, 90], [19, 80, 270], [8, 30, 10]] as const) { w.go({ lon: 2, lat: 0.5, zoom, tilt, bearing }); w.step(16); src.frame(w.state, ctx); }
  await new Promise((k) => setTimeout(k, 0));
  assert.equal(asked, n, 'looking asked for nothing'); assert.equal(src.size, 2);
  w.dispose();
});
