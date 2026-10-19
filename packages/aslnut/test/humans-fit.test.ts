// modules › presets › humans › body › fit: a fit's offsets go on top of the sliders. A zero fit changes nothing; a
// fit keeps every slider's own move (female, heavy…) exactly; a fit for another vertex count is refused. The figure
// tests need the humans pack (data, not in git) and skip without it.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { generate, parseFit, fitBody, humanFigure, figureKey, parseTemplate, type BodyFit, type Template } from '../src/modules/presets/humans/index.ts';
import { AslnutError } from '../src/core/world/errors.ts';

const PACK = join(import.meta.dirname, '..', '..', '..', 'data', 'packs', 'humans');
const tpl: Template | null = existsSync(join(PACK, 'template.json')) ? parseTemplate(JSON.parse(readFileSync(join(PACK, 'template.json'), 'utf8'))) : null;
const needsPack = { skip: tpl ? false : 'the humans pack is not in data/packs/humans (tools/humans-pack.mjs)' };
const N = generate({}).positions.length / 3;
/** a fit of made-up offsets (a few cm, smooth enough), from a seed */
function made(seed: number, scale = 0.03, verts = N): BodyFit {
  let s = seed; const r = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 2 ** 32 - 0.5) * 2 * scale;
  const joints = Object.fromEntries(Object.keys(generate({}).joints).map((k) => [k, { head: [r(), r(), r()], tail: [r(), r(), r()] }]));
  return parseFit({ v: 1, name: `made-${seed}`, verts, d: Array.from({ length: verts * 3 }, r), joints });
}
const zero = parseFit({ v: 1, name: 'zero', verts: N, d: new Array(N * 3).fill(0), joints: {} });
const maxDiff = (a: ArrayLike<number>, b: ArrayLike<number>) => { let m = 0; for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!)); return m; };

test('body fit: a zero fit is the generated body, positions and joints alike', () => {
  for (const sl of [{}, { gender_female: 1 }, { weight_heavy: 0.6, age_elder: 1 }] as Record<string, number>[]) {
    const g = generate(sl), f = fitBody(generate(sl), zero);
    assert.equal(maxDiff(f.positions, g.positions), 0);
    for (const [k, j] of Object.entries(g.joints)) { assert.deepEqual(f.joints[k]!.head, j.head); assert.deepEqual(f.joints[k]!.tail, j.tail); }
  }
  assert.equal(fitBody(generate({}), null).positions.length, N * 3, 'no fit: as it is');
});

test('body fit: the sliders move a fitted body as they move the generated one (their deltas kept)', () => {
  const fit = made(7), b0 = generate({}), f0 = fitBody(b0, fit);
  assert.ok(maxDiff(f0.positions, b0.positions) > 0.01, 'the fit moves the body');
  for (const sl of [{ gender_female: 1 }, { weight_heavy: 1 }, { muscular: 0.7, tall: 1 }, { age_child: 1 }] as Record<string, number>[]) {
    const g = generate(sl), f = fitBody(generate(sl), fit);
    const dg = g.positions.map((x, i) => x - b0.positions[i]!), df = f.positions.map((x, i) => x - f0.positions[i]!);
    assert.ok(maxDiff(dg, df) < 1e-6, `${Object.keys(sl).join('+')}: ${maxDiff(dg, df)}`);
    for (const [k, j] of Object.entries(g.joints)) for (let c = 0; c < 3; c++) {
      const a = j.head[c]! - b0.joints[k]!.head[c]!, b = f.joints[k]!.head[c]! - f0.joints[k]!.head[c]!;
      assert.ok(Math.abs(a - b) < 1e-9, `${k} head`);
    }
  }
});

test('body fit: a fit for another vertex count, or not a fit, is refused with an AslnutError', () => {
  const isLoad = (e: unknown) => e instanceof AslnutError && e.code === 'E-LOAD-005';
  assert.throws(() => fitBody(generate({}), made(3, 0.01, N - 1)), isLoad);
  assert.throws(() => parseFit({ v: 1, verts: N, d: [0, 0, 0] }), isLoad);
  assert.throws(() => parseFit({ v: 2, verts: N, d: new Array(N * 3).fill(0) }), isLoad);
  assert.throws(() => parseFit(JSON.parse(JSON.stringify({ v: 1, verts: N - 1, d: new Array((N - 1) * 3).fill(0) })), N), isLoad);
});

test('body fit: a figure with a fit (zero: the same mesh), its key told apart', needsPack, () => {
  const spec = { body: { gender_female: 1 }, frames: { walk: 0, run: 0, idle: 2 } };
  const a = humanFigure(tpl!, spec), z = humanFigure(tpl!, { ...spec, fit: zero }), f = humanFigure(tpl!, { ...spec, fit: made(11, 0.01) });
  assert.equal(maxDiff(a.mesh.vertices, z.mesh.vertices), 0);
  assert.ok(maxDiff(a.mesh.vertices, f.mesh.vertices) > 0.005);
  assert.equal(a.mesh.vertices.length, f.mesh.vertices.length, 'the same vertices: correctives, hair and garments keep fitting');
  assert.notEqual(figureKey(spec), figureKey({ ...spec, fit: made(11, 0.01) }));
  assert.throws(() => humanFigure(tpl!, { ...spec, fit: made(5, 0.01, N + 3) }), (e: unknown) => e instanceof AslnutError && e.code === 'E-LOAD-005');
});
