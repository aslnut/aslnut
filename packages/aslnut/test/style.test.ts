import { test } from 'node:test';
import assert from 'node:assert/strict';
import { scale, ramp, colours, rgba, hex, reveal, AslnutError, makeState } from '../src/index.ts';
import { plan, progress } from '../src/core/render/reveal/index.ts';

const feats = (vs: (number | undefined)[]) => vs.map((v, i) => ({ id: i, props: { v }, geometry: null }));

test('colours: the forms people write, read alike; a typo says what is read', () => {
  assert.deepEqual(rgba('#f80'), [1, 136 / 255, 0, 1]);
  assert.deepEqual(rgba('#ff880080').map((x) => +x.toFixed(3)), [1, 0.533, 0, 0.502]);
  assert.deepEqual(rgba('rgb(255 136 0)').slice(0, 3).map((x) => +x.toFixed(3)), [1, 0.533, 0]);
  assert.equal(rgba('rgba(255,136,0,.5)')[3], 0.5);
  assert.equal(hex([1, 0.5, 0, 1]), '#ff8000');
  assert.throws(() => rgba('orangey'), (e: unknown) => e instanceof AslnutError && /colour 'orangey'/.test(e.message));
});

test('ramps: named, your stops, your colours, reversed; categorical palettes cycle', () => {
  assert.equal(ramp('viridis')(0), '#440154'); assert.equal(ramp('viridis')(1), '#fde725');
  assert.equal(ramp(['#000000', '#ffffff'])(0.5), '#808080');
  assert.equal(ramp([[0, '#000'], [0.25, '#fff'], [1, '#fff']])(0.125), '#808080');
  assert.equal(ramp('reds', { reverse: true })(0), ramp('reds')(1));
  assert.equal(colours('category', 12)[10], colours('category', 12)[0]);
  assert.throws(() => ramp('nope'), /no ramp 'nope'/);
});

test('scales: domains read from the data; classes, legends; missing values look missing', () => {
  const q = scale.quantile((d: { props: { v?: number } }) => d.props.v, { n: 4, range: ['#a', '#b', '#c', '#d'] as never });
  const data = feats([1, 2, 3, 4, 5, 6, 7, 8]);
  q.prepare(data);
  assert.deepEqual(data.map((d) => q(d)), ['#a', '#a', '#b', '#b', '#c', '#c', '#d', '#d']);
  assert.deepEqual(q.breaks, [3, 5, 7]);
  assert.equal(q({ props: {} } as never), '#8a8f98', 'missing');
  const l = q.legend(); assert.equal(l.kind, 'classes'); assert.equal(l.items.length, 4); assert.equal(l.items[0]!.label, '< 3.0');
  const v0 = q.version; q.prepare(feats([10, 20, 30, 40])); assert.ok(q.version > v0, 'new numbers re-class');
  const lin = scale.linear((d: { props: { v?: number } }) => d.props.v, { range: [0, 100] });
  lin.prepare(feats([10, 20])); assert.equal(lin(feats([15])[0]!), 50); assert.equal(lin(feats([99])[0]!), 100, 'clamped');
  const sq = scale.sqrt((d: { props: { v?: number } }) => d.props.v, { domain: [0, 100], range: [0, 10] }); assert.equal(sq(feats([25])[0]!), 5);
  const th = scale.threshold((d: { props: { v?: number } }) => d.props.v, { domain: [10, 50], range: 'reds' }); th.prepare(feats([1, 60]));
  assert.notEqual(th(feats([5])[0]!), th(feats([55])[0]!)); assert.equal(th.legend().items.length, 3);
  assert.throws(() => scale.threshold((d: { props: { v?: number } }) => d.props.v, {}), /needs domain/);
  const c = scale.category((d: { props: { k?: string } }) => d.props.k, { range: 'category' });
  c.prepare([{ props: { k: 'b' } }, { props: { k: 'a' } }, { props: { k: 'b' } }] as never);
  assert.deepEqual(c.legend().items.map((i) => i.label), ['b', 'a']);
  assert.equal(c({ props: { k: 'zzz' } } as never), '#8a8f98', 'an unknown kind: other');
  const m = scale.category((d: { props: { k?: string } }) => d.props.k, { map: { yes: '#0f0', no: '#f00' } });
  assert.equal(m({ props: { k: 'no' } } as never), '#f00');
});

test('reveal: modes per mark, order and stagger, progress per feature; your own modes', () => {
  const list = [{ d: 3 }, { d: 1 }, { d: 2 }];
  const p = plan({ mode: 'rise', dur: 1, stagger: 0.5, order: (x: { d: number }) => x.d }, list, { mark: 'extrusion', context: 'video', fallback: 0.35 });
  assert.equal(p.mode, 9); assert.equal(p.total, 2);
  assert.deepEqual([...p.delays], [1, 0, 0.5], 'smallest order first');
  assert.equal(progress(p, 1, 0.5), 1, 'the first is done half way'); assert.equal(progress(p, 0, 0.5), 0, 'the last has not started');
  assert.equal(plan({ video: 'trace', app: 'fade' }, list, { mark: 'line', context: 'video', fallback: 0.3 }).mode, 1);
  assert.equal(plan({ video: 'trace', app: 'fade' }, list, { mark: 'line', context: 'app', fallback: 0.3 }).mode, 0);
  assert.equal(plan('rise', list, { mark: 'line', context: 'app', fallback: 0.3 }).mode, 0, 'a mode the mark has not: fade');
  assert.throws(() => plan('wobble', list, { mark: 'line', context: 'app', fallback: 0.3 }), /no reveal mode 'wobble'/);
  reveal.define('drop-in', { feature: (_d, t) => ({ opacity: t, offset: [0, 0, (1 - t) * 300] }) });
  const q = plan('drop-in', list, { mark: 'area', context: 'video', fallback: 0.3 });
  assert.equal(q.spec!.feature!(null, 0.5).offset![2], 150);
  assert.throws(() => reveal.define('trace', { wgsl: '' }), /built-in/);
  assert.ok(reveal.names().includes('drop-in')); reveal.undefine('drop-in');
  void makeState;
});

test('reveal in an app: a short fade unless the layer asks for an app mode; a stagger spreads over 1 s at most, over the shown', () => {
  const many = Array.from({ length: 1000 }, (_, i) => ({ d: i }));
  const a = plan({ mode: 'radial', dur: 0.9, stagger: 0.02 }, many, { mark: 'area', context: 'app', fallback: 0.35 });
  assert.equal(a.mode, 0, 'an app fades'); assert.ok(a.dur <= 0.25, 'a short fade'); assert.equal(Math.max(...a.delays), 0, 'no stagger');
  const b = plan({ app: 'wipe', dur: 0.6 }, many, { mark: 'area', context: 'app', fallback: 0.35 });
  assert.equal(b.mode, 5, 'asked for an app: played'); assert.equal(b.dur, 0.6);
  const v = plan({ mode: 'pop', dur: 0.5, stagger: 0.02 }, many, { mark: 'point', context: 'video', fallback: 0.35 });
  assert.ok(v.total <= 0.5 + 1 + 1e-6, `a stagger over 1000 features spreads over 1 s at most (total ${v.total})`);
  const w = plan({ mode: 'pop', dur: 0.5, stagger: 0.3 }, many, { mark: 'point', context: 'video', fallback: 0.35, shownOnly: (i) => i < 3 });
  assert.deepEqual([...w.delays.slice(0, 4)].map((x) => +x.toFixed(4)), [0, 0.3, 0.6, 0], 'only the shown take part');
  assert.equal(plan(undefined, many, { mark: 'area', context: 'app', fallback: 0.35 }).dur, 0.25);
  assert.throws(() => plan({ app: 'wobble' }, many, { mark: 'area', context: 'video', fallback: 0.3 }), /no reveal mode 'wobble'/);
});
