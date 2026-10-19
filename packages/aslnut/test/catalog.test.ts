// tools › catalog: a project's entries searched; one controls schema for a shape's, a package's and an element's params
// (form); an asset's folder as one file (a pack) and back, its code told from its data, unsafe paths refused.
import { test } from 'node:test';
import assert from 'node:assert/strict';

test('catalog: entries checked, searched by words, kind, tag and licence; catalog.json in and out', async () => {
  const { catalog, entryOf, AslnutError } = { ...(await import('../src/tools/catalog.ts')), ...(await import('../src/core/world/errors.ts')) };
  const { cars } = await import('../src/modules/presets/vehicles/index.ts');
  const { drones } = await import('../src/modules/presets/drones/index.ts');
  const car = entryOf(cars.package.info, { kind: 'shape', path: 'vehicles/car', presets: Object.keys(cars.package.presets) });
  const drone = entryOf(drones.package.info, { kind: 'shape', path: 'drone', presets: Object.keys(drones.package.presets) });
  const ring = { id: 'ring', kind: 'element' as const, name: 'Pulsing ring', licence: 'CC0-1.0', path: 'effects/ring', tags: ['effect', 'ground'] };
  const cat = catalog([drone, car, ring]);
  assert.deepEqual(cat.search({ kind: 'shape' }).map((e) => e.id), ['drone', 'car']);
  assert.deepEqual(cat.search('road vehicle').map((e) => e.id), ['car']);
  assert.deepEqual(cat.search('pickup').map((e) => e.id), ['car'], 'a preset name finds its package');
  assert.deepEqual(cat.search({ tag: ['uav', 'effect'] }).map((e) => e.id), ['drone', 'ring'], 'any of the tags');
  assert.deepEqual(cat.search({ licence: 'cc0-1.0' }).map((e) => e.id), ['ring'], 'licences by SPDX id, case ignored');
  assert.deepEqual(cat.search({ kind: 'element', text: 'ring', licence: 'Apache-2.0' }), [], 'every field given holds');
  assert.ok(cat.tags().includes('vehicle') && cat.licences().join() === 'Apache-2.0,CC0-1.0');
  // catalog.json: ordered by path, read back the same; untrusted input checked
  const file = cat.toJSON();
  assert.deepEqual(file.entries.map((e) => e.path), ['drone', 'effects/ring', 'vehicles/car']);
  assert.deepEqual(catalog(JSON.stringify(file)).toJSON(), file);
  assert.throws(() => catalog({ version: 2, entries: [] } as never), (e: unknown) => e instanceof AslnutError);
  assert.throws(() => catalog([{ ...ring, kind: 'sound' } as never]), /kind 'sound'/);
  assert.throws(() => catalog([{ ...ring, path: '../../etc' }]), /unsafe path/);
  assert.throws(() => catalog('{ not json'), /not JSON/);
});

test('form: one controls schema for a shape, a package, an element and params of either kind', async () => {
  const { form } = await import('../src/tools/catalog.ts');
  const { shape, num, int, choice, color, flag, textParam, custom } = await import('../src/index.ts');
  const { drones } = await import('../src/modules/presets/drones/index.ts');
  const s = shape({ id: 'post', params: { h: num(1, 3, 2), n: int(1, 4, 2), kind: choice(['round', 'square']), paint: color('#ff0000'), lit: flag(true), sign: textParam('BUS', 8) }, build: (b, p) => b.solid('box', { size: [0.2, p.h, 0.2], at: [0, p.h / 2, 0] }) });
  assert.deepEqual(form(s).controls.map((c) => c.kind), ['slider', 'stepper', 'dropdown', 'colour', 'switch', 'text']);
  assert.deepEqual(form(s).controls.find((c) => c.key === 'h'), { key: 'h', kind: 'slider', min: 1, max: 3, step: 0.02, value: 2 });
  // a package: its shape's params (the drone's rotors, span, payload, colours)
  assert.deepEqual(form(drones.package).controls.map((c) => `${c.key}:${c.kind}`), ['rotors:stepper', 'span:slider', 'payload:switch', 'body:colour', 'arms:colour']);
  // a world's params by name (core › world › settings › params): number with a range → slider, without → number box
  const k = form({ gain: { type: 'number', range: [0, 4], default: 1, unit: '×', describe: 'how bright' }, seconds: { type: 'number', default: 2 }, mode: { type: 'enum', options: ['add', 'alpha'], default: 'add' }, on: { type: 'bool', default: true }, tint: { type: 'color', default: '#00ffaa' }, at: { type: 'vector', default: [0, 1, 0] }, code: { type: 'text', default: 'A1' } }).controls;
  assert.deepEqual(k.map((c) => c.kind), ['slider', 'number', 'dropdown', 'switch', 'colour', 'vector', 'text']);
  assert.equal(k[0]!.unit, '×'); assert.equal(k[0]!.describe, 'how bright'); assert.equal(k[5]!.size, 3);
  // an element: its own knobs (its shader's params), with their values now
  const el = custom({ id: 'glow', data: [], at: () => [0, 0], uniforms: { gain: 1.5, tint: '#ff5a00' } });
  el.setParam('gain', 3);
  assert.deepEqual(form(el).controls.map((c) => `${c.key}:${c.kind}:${String(c.value)}`), ['gain:number:3', 'tint:colour:#ff5a00']);
  assert.throws(() => form({ odd: { what: 1 } } as never), /neither a shape's/);
});

test('packAsset / unpackAsset: a folder as one file and back; code told from data; unsafe files refused', async () => {
  const { packAsset, unpackAsset, kindOfFiles } = await import('../src/tools/catalog.ts');
  const { FilePack, writePack } = await import('../src/core/data/loading/pack.ts');
  const json = JSON.stringify({ id: 'bin', name: 'Wheelie bin', version: '1.0.0', licence: 'Apache-2.0', tags: ['street'] });
  const glb = new Uint8Array([0x67, 0x6c, 0x54, 0x46, 2, 0, 0, 0]);
  const folder = { 'shape.ts': "import { shape } from 'aslnut';\nexport default 1;\n", 'shape.json': json, 'presets.json': '{ "tall": { "h": 1.3 } }', 'thumbs/tall.png': new Uint8Array([137, 80, 78, 71]), LICENCE: 'Apache License 2.0' };
  const file = packAsset(folder, { id: 'bin' });
  assert.equal(file.type, 'application/x-aslnut-pack');
  const got = await unpackAsset(file);
  assert.equal(got.id, 'bin'); assert.equal(got.kind, 'shape'); assert.equal(got.info?.name, 'Wheelie bin');
  assert.deepEqual(Object.keys(got.files).sort(), Object.keys(folder).sort());
  assert.equal(got.text('shape.ts'), folder['shape.ts']); assert.deepEqual([...got.files['thumbs/tall.png']!], [137, 80, 78, 71]);
  assert.equal(got.trust, 'code'); assert.deepEqual(got.code, ['shape.ts']);
  assert.equal(got.licence, 'Apache-2.0'); assert.equal(got.licenceText, 'Apache License 2.0');
  // the same pack the loader reads (core › data › loading › pack): its scope the asset's id, its keys the paths
  const fp = await FilePack.read(file); assert.equal(fp.scope, 'bin'); assert.ok(fp.keys().includes('thumbs/tall.png'));
  // data only (presets of a known shape, a model): it imports as it is
  const data = await unpackAsset(packAsset({ 'shape.json': json, 'presets.json': '{}', 'model.glb': glb }, { id: 'bin-blue' }));
  assert.equal(data.trust, 'data'); assert.deepEqual(data.code, []); assert.deepEqual(data.data, ['model.glb', 'presets.json', 'shape.json']);
  // an element
  assert.equal(kindOfFiles(['element.ts', 'element.json']), 'element'); assert.equal(kindOfFiles(['notes.txt']), null);
  // refused: a path out of its folder (made by hand: packAsset refuses it too), an unsafe id, a huge file, not a pack
  const evil = writePack('bin', [{ key: '../../.bashrc', e: { status: 200, type: 'text/plain', source: 'x', at: 0, data: new TextEncoder().encode('rm').buffer as ArrayBuffer } }]);
  await assert.rejects(unpackAsset(evil), /unsafe path/);
  assert.throws(() => packAsset({ '/etc/passwd': 'x' }, { id: 'bin' }), /unsafe path/);
  assert.throws(() => packAsset({ 'a.json': '{}' }, { id: '../bin' }), /unsafe scope/);
  assert.throws(() => packAsset({}, { id: 'bin' }), /no files/);
  await assert.rejects(unpackAsset(file, { maxBytes: 10 }), /over/);
  await assert.rejects(unpackAsset(new Blob(['hello'])), /not a valid aslnut pack/);
});
