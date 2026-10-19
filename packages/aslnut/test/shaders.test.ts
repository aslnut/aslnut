import { test } from 'node:test';
import assert from 'node:assert/strict';
import { translateStatements, translateModule, HOOK_POINTS, assemble, assembleCustom, paramBlock, ShaderError, uniformLayout, parseType } from '../src/core/render/graphics/shaders/index.ts';
import { SURFACE_WGSL } from '../src/core/render/graphics/shaders/surface.wgsl.ts';
import { SURFACE_GLSL } from '../src/core/render/graphics/shaders/surface.glsl.ts';
import { POINTS_WGSL } from '../src/core/render/graphics/shaders/points.wgsl.ts';
import { POINTS_GLSL } from '../src/core/render/graphics/shaders/points.glsl.ts';
import { CUSTOM_WGSL } from '../src/core/render/graphics/shaders/custom.wgsl.ts';
import { CUSTOM_GLSL } from '../src/core/render/graphics/shaders/custom.glsl.ts';

const scope = { values: { color: { type: 'vec4f', mutable: true }, uv: 'vec2f', value: 'f32', time: 'f32' }, structs: { params: { gain: 'f32', tint: 'vec3f' } } };
const g = (src: string) => translateStatements(src, scope).glsl.trim();

test('translate: types, literals and the WGSL ↔ GLSL differences', () => {
  assert.equal(g('let a = 1;'), 'int a = 1;');
  assert.equal(g('let a = 1.5;'), 'float a = 1.5;');
  assert.equal(g('let a: f32 = 2;'), 'float a = 2.0;', 'an integer literal where a float is wanted');
  assert.equal(g('let a = value * 2;'), 'float a = value * 2.0;', 'GLSL ES has no implicit int → float');
  assert.equal(g('let a = vec3f(1, 2, 3);'), 'vec3 a = vec3(1.0, 2.0, 3.0);');
  assert.equal(g('let a = vec3<f32>(1.0);'), 'vec3 a = vec3(1.0);');
  assert.equal(g('let a = 3u;'), 'uint a = 3u;');
  assert.equal(g('let a = select(0.0, 1.0, value > 0.5);'), 'float a = (value > 0.5 ? 1.0 : 0.0);');
  assert.equal(g('let a = value % 2.0;'), 'float a = (value - 2.0 * trunc(value / 2.0));', 'WGSL % on floats truncates; GLSL mod floors');
  assert.equal(g('let a = uv < vec2f(0.5);'), 'bvec2 a = lessThan(uv, vec2(0.5));');
  assert.equal(g('let a = atan2(uv.y, uv.x);'), 'float a = atan(uv.y, uv.x);');
  assert.equal(g('let a = inverseSqrt(value);'), 'float a = inversesqrt(value);');
  assert.equal(g('let a = saturate(value);'), 'float a = clamp(value, float(0.0), float(1.0));');
  assert.equal(g('let a = mix(color.rgb, params.tint, 0.5);'), 'vec3 a = mix(color.rgb, params.tint, 0.5);');
  assert.equal(g('let input = 1.0;'), 'float w_input = 1.0;', 'a GLSL reserved word is renamed');
  assert.equal(g('var c = 0; for (var i = 0; i < 4; i++) { c += i; }'), 'int c = 0;\n  for (int i = 0; i < 4; i++) {\n    c = c + i;\n  }');
  assert.match(g('if value > 0.5 { color = vec4f(1.0); } else if value > 0.2 { discard; }'), /if \(value > 0\.5\) \{[\s\S]*\} else if \(value > 0\.2\) \{[\s\S]*discard;/);
});
test('translate: modules (your functions), called from statements', () => {
  const m = translateModule('fn ring(d: f32, w: f32) -> f32 { return smoothstep(w, 0.0, abs(d)); }\nconst K = 3.0;');
  assert.match(m.glsl, /float ring\(float d, float w\);/);
  assert.match(m.glsl, /const float K = 3\.0;/);
  assert.equal(translateStatements('color = vec4f(vec3f(ring(value, 0.1)), 1.0);', { ...scope, functions: m.functions }).glsl.trim(), 'color = vec4(vec3(ring(value, 0.1)), 1.0);');
  assert.throws(() => translateModule('fn f(a: f32) -> f32 { if a > 0.0 { return 1.0; } }'), /does not return a f32 on every path/);
});
test('translate: errors name your line and column, and the fix', () => {
  const err = (src: string) => { try { g(src); } catch (e) { assert.ok(e instanceof ShaderError); return e; } throw new Error('no error'); };
  let e = err('let a = 1.0;\ncolr = vec4f(1.0);');
  assert.equal(e.line, 2); assert.equal(e.col, 1); assert.match(e.fix, /did you mean 'color'/);
  e = err('uv = vec2f(0.0);'); assert.match(e.message, /'uv' cannot be changed/);
  e = err('color.rgb = vec3f(1.0);'); assert.match(e.message, /several components at once/);
  e = err('let t = textureSample(a, b, uv);'); assert.match(e.message, /textures are not in the shader subset yet/);
  e = err('let a = vec3f(1.0) + vec2f(1.0);'); assert.match(e.message, /cannot \+ a vec3 and a vec2/);
  e = err('color = vec4f(1.0, 0.0, 0.0);'); assert.match(e.message, /needs 4 components, got 3/);
  e = err('loop { break; }'); assert.match(e.message, /'loop' is not in the shader subset/);
  e = err('let a = 1.0'); assert.match(e.fix, /end the statement with ;/);
  e = err('let a = params.gian;'); assert.match(e.fix, /it has: gain, tint/);
});
test('hooks: every hook point of every shader translates, in both languages, with params as uniforms', () => {
  const params = paramBlock({ gain: 1.5, tint: '#ff8800', dir: [0, 1] });
  assert.match(params.wgsl, /gain: f32, tint: vec3f, dir: vec2f,/);
  assert.match(params.glsl, /float gain; vec3 tint; vec2 dir;/);
  assert.deepEqual([...params.pack({ gain: 2 })].slice(0, 8).map((x) => +x.toFixed(3)), [2, 0, 0, 0, 1, 0.533, 0, 0]);
  const cases: [string, Record<string, string>][] = [
    ['surface', { position: 'position = position + vec3f(0.0, value * params.gain, 0.0);', color: 'color = vec4f(color.rgb * params.gain + normal * 0.0, color.a);' }],
    ['points', { position: 'size = size * params.gain;', color: 'color = vec4f(params.tint, color.a);', alpha: 'alpha = alpha * 0.5;', reveal: 'alpha = alpha * step(length(uv), reveal);' }],
  ];
  for (const [shader, code] of cases) {
    const base = shader === 'surface' ? { wgsl: SURFACE_WGSL, glsl: SURFACE_GLSL } : { wgsl: POINTS_WGSL, glsl: POINTS_GLSL };
    const out = assemble(base, HOOK_POINTS[shader as 'surface'], code, params, shader);
    for (const [hook, src] of Object.entries(code)) {
      assert.ok(out.wgsl.includes(src), `${shader}.${hook} in WGSL`);
      const stage = HOOK_POINTS[shader as 'surface'][hook as 'color']!.stage;
      assert.ok(!out.glsl[stage].includes(`/*@${hook}*/`), `${shader}.${hook} written into GLSL ${stage}`);
    }
    assert.ok(!/\/\*@(params|functions)\*\//.test(out.wgsl + out.glsl.vertex + out.glsl.fragment), 'every marker filled');
  }
  // no code: the default reveal still runs
  assert.match(assemble({ wgsl: POINTS_WGSL, glsl: POINTS_GLSL }, HOOK_POINTS.points, {}, paramBlock({}), 'p').glsl.fragment, /alpha = alpha \* reveal;/);
  assert.throws(() => assemble({ wgsl: POINTS_WGSL, glsl: POINTS_GLSL }, HOOK_POINTS.points, { normal: 'x' } as never, paramBlock({}), 'p'), /has no 'normal' hook/);
});
test('custom layers: attributes, varyings, vertex and fragment code in both languages', () => {
  const out = assembleCustom({ wgsl: CUSTOM_WGSL, glsl: CUSTOM_GLSL }, { attributes: { value: 'f32', dir: 'vec2f' }, varyings: { glow: 'f32' }, vertex: 'glow = value * params.gain; size = size + dir.x;', fragment: 'color = vec4f(params.tint * glow, 1.0 - length(corner));' }, paramBlock({ gain: 1, tint: '#ff0000' }), 'heat');
  assert.match(out.wgsl, /@location\(1\) a_value: f32, @location\(2\) a_dir: vec2f,/);
  assert.match(out.glsl.vertex, /layout\(location = 2\) in vec2 a_dir;/);
  assert.match(out.glsl.vertex, /v_glow = glow;/);
  assert.match(out.glsl.fragment, /color = vec4\(params\.tint \* glow, 1\.0 - length\(corner\)\);/);
  assert.deepEqual(out.attributes, [{ name: 'value', size: 1 }, { name: 'dir', size: 2 }]);
  assert.throws(() => assembleCustom({ wgsl: CUSTOM_WGSL, glsl: CUSTOM_GLSL }, { attributes: { color: 'f32' }, varyings: {} }, paramBlock({}), 'x'), /taken/);
  assert.throws(() => assembleCustom({ wgsl: CUSTOM_WGSL, glsl: CUSTOM_GLSL }, { attributes: {}, varyings: {}, fragment: 'color = value;' }, paramBlock({}), 'x'), /unknown name 'value'/);
});
test('uniform layout: WGSL uniform rules and std140 agree for the types params use', () => {
  const l = uniformLayout([['a', parseType('f32')], ['b', parseType('vec3f')], ['c', parseType('f32')], ['d', parseType('vec2f')], ['e', parseType('mat4x4f')]]);
  assert.deepEqual(l.offsets, { a: 0, b: 16, c: 28, d: 32, e: 48 });
  assert.equal(l.size, 112);
});
