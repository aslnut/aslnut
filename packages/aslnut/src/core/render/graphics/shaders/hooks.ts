// core › render › graphics › shaders › hooks: your code inside aslnut's shaders, on WebGPU and WebGL2 alike. You write the WGSL
// subset; it goes into the WGSL program as written and, translated, into the GLSL twin. Each hook point names the
// values in scope (documented in HOOK_POINTS) and which of them you may change.
//   points({ data, shader: { color: `color = vec4f(color.rgb * params.gain, color.a);` }, params: { gain: 1.5 } })
//   w.set('cities.gain', 2)    → the uniform, next frame
import { AslnutError } from '../../../world/errors.ts';
import { glslType, parseType, translateModule, translateStatements, typeName, uniformLayout, type ScopeSpec, type Type } from './translate.ts';

export type HookName = 'position' | 'color' | 'alpha' | 'reveal';
export interface HookPoint {
  stage: 'vertex' | 'fragment';
  /** the values in scope (WGSL types); mutable ones are what the hook may change */
  values: Record<string, { type: string; mutable?: boolean; doc: string }>;
  /** what runs when you give no code */
  default?: string;
  doc: string;
}
export interface ShaderCode {
  /** helper functions and consts, callable from every hook */
  functions?: string;
  position?: string; color?: string; alpha?: string; reveal?: string;
}
/** a param that becomes a uniform: a number (f32), [x, y] / [x, y, z] / [x, y, z, w] (vecNf), or a '#rrggbb' colour (vec3f) */
export type ParamValue = number | readonly number[] | string;

const v = (type: string, doc: string, mutable = false) => ({ type, doc, mutable });
export const HOOK_POINTS: Record<'surface' | 'points' | 'line' | 'area' | 'extrusion' | 'text', Partial<Record<HookName, HookPoint>>> = {
  surface: {
    position: { stage: 'vertex', doc: 'move a point of the ground', values: { position: v('vec3f', 'the point, world metres from the view centre (y up)', true), uv: v('vec2f', 'where in its tile, 0..1'), value: v('f32', 'its height, metres × exaggeration'), time: v('f32', "the world's clock, s") } },
    color: { stage: 'fragment', doc: 'recolour the ground', values: { color: v('vec4f', 'the colour so far (imagery, shade, grade, fog)', true), position: v('vec3f', 'world metres'), normal: v('vec3f', 'the ground normal'), uv: v('vec2f', 'where in its tile, 0..1'), value: v('f32', 'height, metres'), time: v('f32', "the world's clock, s") } },
  },
  points: {
    position: { stage: 'vertex', doc: 'move or resize a point', values: { position: v('vec3f', 'world metres from the view centre', true), size: v('f32', 'diameter, CSS px', true), value: v('f32', "the feature's value"), time: v('f32', "the world's clock, s") } },
    color: { stage: 'fragment', doc: 'recolour a point', values: { color: v('vec4f', 'the colour so far (alpha: the disc edge)', true), uv: v('vec2f', 'across the disc, -1..1'), value: v('f32', "the feature's value"), time: v('f32', "the world's clock, s"), position: v('vec3f', 'world metres') } },
    alpha: { stage: 'fragment', doc: 'change how opaque it is', values: { alpha: v('f32', 'opacity so far', true), color: v('vec4f', 'the final colour'), uv: v('vec2f', 'across the disc, -1..1'), value: v('f32', "the feature's value"), time: v('f32', "the world's clock, s") } },
    reveal: { stage: 'fragment', default: 'alpha = alpha * reveal;', doc: 'how it appears as `when` fades it in (reveal 0 → 1)', values: { alpha: v('f32', 'opacity so far', true), reveal: v('f32', 'how far shown, 0..1'), uv: v('vec2f', 'across the disc, -1..1'), value: v('f32', "the feature's value"), time: v('f32', "the world's clock, s") } },
  },
  line: {
    color: { stage: 'fragment', doc: 'recolour a line', values: { color: v('vec4f', 'the colour so far', true), alpha: v('f32', 'opacity so far (the edge, the reveal)', true), along: v('f32', 'how far along its line, 0..1'), value: v('f32', "the feature's value"), time: v('f32', "the world's clock, s"), position: v('vec3f', 'world metres') } },
    alpha: { stage: 'fragment', doc: 'change how opaque it is', values: { alpha: v('f32', 'opacity so far', true), color: v('vec4f', 'the final colour'), along: v('f32', 'how far along, 0..1'), value: v('f32', "the feature's value"), time: v('f32', "the world's clock, s") } },
    reveal: { stage: 'fragment', doc: 'how it appears (reveal 0 → 1; with mode "custom" nothing else is applied)', values: { alpha: v('f32', 'opacity so far', true), reveal: v('f32', 'how far shown, 0..1'), along: v('f32', 'how far along, 0..1'), position: v('vec3f', 'world metres'), time: v('f32', "the world's clock, s") } },
  },
  area: {
    position: { stage: 'vertex', doc: 'move a point of an area', values: { position: v('vec3f', 'world metres from the view centre (y up)', true), value: v('f32', "the feature's value"), time: v('f32', "the world's clock, s") } },
    color: { stage: 'fragment', doc: 'recolour an area', values: { color: v('vec4f', 'the colour so far', true), alpha: v('f32', 'opacity so far', true), uv: v('vec2f', 'across the feature, -1..1'), value: v('f32', "the feature's value"), time: v('f32', "the world's clock, s"), position: v('vec3f', 'world metres') } },
    alpha: { stage: 'fragment', doc: 'change how opaque it is', values: { alpha: v('f32', 'opacity so far', true), color: v('vec4f', 'the final colour'), uv: v('vec2f', 'across the feature, -1..1'), value: v('f32', "the feature's value"), time: v('f32', "the world's clock, s") } },
    reveal: { stage: 'fragment', doc: 'how it appears (reveal 0 → 1)', values: { alpha: v('f32', 'opacity so far', true), reveal: v('f32', 'how far shown, 0..1'), uv: v('vec2f', 'across the feature, -1..1'), position: v('vec3f', 'world metres'), time: v('f32', "the world's clock, s") } },
  },
  extrusion: {
    position: { stage: 'vertex', doc: 'move a point of a block', values: { position: v('vec3f', 'world metres from the view centre (y up)', true), value: v('f32', "the feature's value"), time: v('f32', "the world's clock, s") } },
    color: { stage: 'fragment', doc: 'recolour a block', values: { color: v('vec4f', 'the colour so far (lit)', true), alpha: v('f32', 'opacity so far', true), normal: v('vec3f', 'east, up, north'), value: v('f32', "the feature's value"), time: v('f32', "the world's clock, s"), position: v('vec3f', 'world metres') } },
    alpha: { stage: 'fragment', doc: 'change how opaque it is', values: { alpha: v('f32', 'opacity so far', true), color: v('vec4f', 'the final colour'), value: v('f32', "the feature's value"), time: v('f32', "the world's clock, s") } },
    reveal: { stage: 'fragment', doc: 'how it appears (reveal 0 → 1)', values: { alpha: v('f32', 'opacity so far', true), reveal: v('f32', 'how far shown, 0..1'), position: v('vec3f', 'world metres'), time: v('f32', "the world's clock, s") } },
  },
  text: {
    color: { stage: 'fragment', doc: 'recolour a label', values: { color: v('vec4f', 'the colour so far (text over its halo)', true), uv: v('vec2f', 'across the label, 0..1'), time: v('f32', "the world's clock, s") } },
    alpha: { stage: 'fragment', doc: 'change how opaque it is', values: { alpha: v('f32', 'opacity so far', true), uv: v('vec2f', 'across the label, 0..1'), time: v('f32', "the world's clock, s") } },
    reveal: { stage: 'fragment', doc: 'how it appears (reveal 0 → 1)', values: { alpha: v('f32', 'opacity so far', true), reveal: v('f32', 'how far shown, 0..1'), uv: v('vec2f', 'across the label, 0..1'), time: v('f32', "the world's clock, s") } },
  },
};

// ── params as uniforms ───────────────────────────────────────────────────────────────────────────────────────────
export interface ParamBlock { members: [string, Type][]; size: number; offsets: Record<string, number>; wgsl: string; glsl: string; pack(values: Record<string, ParamValue>, into?: Float32Array): Float32Array }
export function paramType(v: ParamValue, name: string): Type {
  if (typeof v === 'number') return parseType('f32');
  if (typeof v === 'string') { if (/^#[0-9a-f]{6}$/i.test(v)) return parseType('vec3f'); throw new AslnutError('E-WORLD-004', `param '${name}': '${v}' is not a number, a vector or a '#rrggbb' colour`, { where: name, fix: "write 1.5, [1, 0.5, 0] or '#ff8800'" }); }
  if (Array.isArray(v) && v.length >= 2 && v.length <= 4 && v.every((x) => typeof x === 'number')) return parseType(`vec${v.length}f`);
  throw new AslnutError('E-WORLD-004', `param '${name}' must be a number, 2 to 4 numbers, or a '#rrggbb' colour`, { where: name, fix: 'write 1.5, [1, 0.5, 0] or "#ff8800"' });
}
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
export function paramBlock(params: Record<string, ParamValue>): ParamBlock {
  const members: [string, Type][] = Object.entries(params).map(([n, val]) => {
    if (!NAME.test(n)) throw new AslnutError('E-WORLD-004', `param name '${n}' cannot be a uniform`, { where: n, fix: 'use letters, digits and _ , starting with a letter' });
    return [n, paramType(val, n)];
  });
  const list = members.length ? members : [['pad0', parseType('f32')] as [string, Type]];
  const { offsets, size } = uniformLayout(list);
  return {
    members, size, offsets,
    wgsl: list.map(([n, t]) => `${n}: ${typeName(t)},`).join(' '),
    glsl: list.map(([n, t]) => `${glslType(t)} ${n};`).join(' '),
    pack(values, into = new Float32Array(size / 4)) {
      for (const [n, t] of members) {
        const val = values[n] ?? params[n]!, o = offsets[n]! / 4;
        const arr = typeof val === 'number' ? [val] : typeof val === 'string' ? hex(val) : [...val];
        if (t.k === 'vec' && arr.length !== t.n || t.k === 'scalar' && arr.length !== 1) throw new AslnutError('E-WORLD-004', `param '${n}' is a ${typeName(t)}; got ${JSON.stringify(val)}`, { where: n, fix: `give ${t.k === 'vec' ? `${t.n} numbers` : 'a number'}` });
        into.set(arr, o);
      }
      return into;
    },
  };
}
const hex = (s: string) => { const n = parseInt(s.slice(1), 16); return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255]; };

// ── assembling ───────────────────────────────────────────────────────────────────────────────────────────────────
export interface Sources { wgsl: string; glsl: { vertex: string; fragment: string } }
const put = (s: string, marker: string, code: string) => s.split(`/*@${marker}*/`).join(code);
const structs = (p: ParamBlock): ScopeSpec['structs'] => ({ params: Object.fromEntries(p.members) });

/** the base program with your hooks, functions and params written in, in both languages */
export function assemble(base: Sources, points: Partial<Record<HookName, HookPoint>>, code: ShaderCode, params: ParamBlock, where: string): Sources {
  let wgsl = base.wgsl, vert = base.glsl.vertex, frag = base.glsl.fragment;
  for (const k of Object.keys(code) as (keyof ShaderCode)[]) {
    if (k !== 'functions' && !points[k as HookName]) throw new AslnutError('E-SHADER-001', `this layer has no '${k}' hook`, { where, fix: `its hooks: ${Object.keys(points).join(', ') || 'none'}; or write a custom() layer` });
  }
  let fns: ReturnType<typeof translateModule>['functions'] = [], fnGlsl = '';
  if (code.functions) { const t = translateModule(code.functions, { structs: structs(params) }, { where: `${where} shader.functions` }); fns = t.functions; fnGlsl = t.glsl; }
  wgsl = put(wgsl, 'functions', code.functions ?? ''); vert = put(vert, 'functions', fnGlsl); frag = put(frag, 'functions', fnGlsl);
  wgsl = put(wgsl, 'params', params.wgsl); vert = put(vert, 'params', params.glsl); frag = put(frag, 'params', params.glsl);
  for (const [name, hp] of Object.entries(points) as [HookName, HookPoint][]) {
    const src = code[name] ?? hp.default ?? '';
    if (!src.trim()) { wgsl = put(wgsl, name, ''); if (hp.stage === 'vertex') vert = put(vert, name, ''); else frag = put(frag, name, ''); continue; }
    const t = translateStatements(src, { values: Object.fromEntries(Object.entries(hp.values).map(([n, x]) => [n, { type: x.type, mutable: x.mutable }])), structs: structs(params), functions: fns }, { where: `${where} shader.${name}` });
    wgsl = put(wgsl, name, src);
    if (hp.stage === 'vertex') vert = put(vert, name, t.glsl.trim()); else frag = put(frag, name, t.glsl.trim());
  }
  return { wgsl, glsl: { vertex: vert, fragment: frag } };
}

// ── custom layers ────────────────────────────────────────────────────────────────────────────────────────────────
export interface CustomCode {
  /** per item: name → WGSL type (f32, vec2f, vec3f, vec4f) */
  attributes: Record<string, string>;
  /** vertex → fragment: name → WGSL type (f32 … vec4f) */
  varyings: Record<string, string>;
  vertex?: string; fragment?: string; functions?: string;
}
const TAKEN = new Set(['corner', 'position', 'size', 'time', 'color', 'params', 'frame', 'o', 'i', 'u', 'at', 'clip', 'alpha']);
export const CUSTOM_SCOPE = {
  vertex: { corner: v('vec2f', 'the quad corner, -1..1'), position: v('vec3f', "the item's place, world metres", true), size: v('f32', 'CSS px (screen) or metres (ground)', true), time: v('f32', "the world's clock, s") },
  fragment: { corner: v('vec2f', 'across the quad, -1..1'), time: v('f32', "the world's clock, s"), color: v('vec4f', 'what you draw (default white)', true) },
};
export function assembleCustom(base: Sources, code: CustomCode, params: ParamBlock, where: string): Sources & { attributes: { name: string; size: 1 | 2 | 3 | 4 }[] } {
  const types = (o: Record<string, string>, what: string) => Object.entries(o).map(([n, ty]) => {
    if (!NAME.test(n) || TAKEN.has(n)) throw new AslnutError('E-SHADER-001', `${what} name '${n}' is taken or not a plain name`, { where, fix: `pick another (taken: ${[...TAKEN].join(', ')})` });
    const t = parseType(ty);
    if (!(t.k === 'scalar' && t.s === 'f32') && !(t.k === 'vec' && t.s === 'f32')) throw new AslnutError('E-SHADER-001', `${what} '${n}' must be f32 or vec2f..vec4f (got ${ty})`, { where, fix: 'use floats' });
    return [n, t] as [string, Type];
  });
  const attrs = types(code.attributes, 'attribute'), vary = types(code.varyings, 'varying');
  for (const [n] of vary) if (code.attributes[n]) throw new AslnutError('E-SHADER-001', `'${n}' is both an attribute and a varying`, { where, fix: 'rename one' });
  const zero = (t: Type) => (t.k === 'scalar' ? '0.0' : `${typeName(t)}(0.0)`);
  const gz = (t: Type) => (t.k === 'scalar' ? '0.0' : `${glslType(t)}(0.0)`);
  let wgsl = base.wgsl, vert = base.glsl.vertex, frag = base.glsl.fragment;
  wgsl = put(wgsl, 'attributes', attrs.map(([n, t], k) => `@location(${k + 1}) a_${n}: ${typeName(t)},`).join(' '));
  vert = put(vert, 'attributes', attrs.map(([n, t], k) => `layout(location = ${k + 1}) in ${glslType(t)} a_${n};`).join('\n'));
  wgsl = put(wgsl, 'varyings', vary.map(([n, t], k) => `@location(${k + 1}) v_${n}: ${typeName(t)},`).join(' '));
  vert = put(vert, 'varyings', vary.map(([n, t]) => `out ${glslType(t)} v_${n};`).join('\n'));
  frag = put(frag, 'varyings', vary.map(([n, t]) => `in ${glslType(t)} v_${n};`).join('\n'));
  wgsl = put(wgsl, 'inputs', [...attrs.map(([n]) => `let ${n} = i.a_${n};`), ...vary.map(([n, t]) => `var ${n} = ${zero(t)};`)].join('\n  '));
  vert = put(vert, 'inputs', [...attrs.map(([n, t]) => `${glslType(t)} ${n} = a_${n};`), ...vary.map(([n, t]) => `${glslType(t)} ${n} = ${gz(t)};`)].join('\n  '));
  wgsl = put(wgsl, 'outputs', vary.map(([n]) => `o.v_${n} = ${n};`).join('\n  '));
  vert = put(vert, 'outputs', vary.map(([n]) => `v_${n} = ${n};`).join('\n  '));
  wgsl = put(wgsl, 'finputs', vary.map(([n]) => `var ${n} = i.v_${n};`).join('\n  '));
  frag = put(frag, 'finputs', vary.map(([n, t]) => `${glslType(t)} ${n} = v_${n};`).join('\n  '));
  const vScope = { ...Object.fromEntries(Object.entries(CUSTOM_SCOPE.vertex).map(([n, x]) => [n, { type: x.type, mutable: x.mutable }])), ...Object.fromEntries(attrs.map(([n, t]) => [n, { type: t }])), ...Object.fromEntries(vary.map(([n, t]) => [n, { type: t, mutable: true }])) };
  const fScope = { ...Object.fromEntries(Object.entries(CUSTOM_SCOPE.fragment).map(([n, x]) => [n, { type: x.type, mutable: x.mutable }])), ...Object.fromEntries(vary.map(([n, t]) => [n, { type: t, mutable: true }])) };
  const hooks: Partial<Record<HookName, HookPoint>> = {};
  const merged = assemble({ wgsl, glsl: { vertex: vert, fragment: frag } }, hooks, { functions: code.functions }, params, where);
  wgsl = merged.wgsl; vert = merged.glsl.vertex; frag = merged.glsl.fragment;
  const fns = code.functions ? translateModule(code.functions, { structs: structs(params) }, { where: `${where} functions` }).functions : [];
  for (const [stage, src, scope] of [['vertex', code.vertex ?? '', vScope], ['fragment', code.fragment ?? '', fScope]] as const) {
    const t = src.trim() ? translateStatements(src, { values: scope as ScopeSpec['values'], structs: structs(params), functions: fns }, { where: `${where} ${stage}` }).glsl.trim() : '';
    wgsl = put(wgsl, stage, src);
    if (stage === 'vertex') vert = put(vert, 'vertex', t); else frag = put(frag, 'fragment', t);
  }
  return { wgsl, glsl: { vertex: vert, fragment: frag }, attributes: attrs.map(([n, t]) => ({ name: n, size: (t.k === 'vec' ? t.n : 1) as 1 | 2 | 3 | 4 })) };
}

// ── your own material (core › render › look › materials: material.custom) ────────────────────────────────────
export const MATERIAL_SCOPE = {
  vertex: { position: v('vec3f', 'the point, world metres from the view centre (y up)', true), normal: v('vec3f', 'its normal'), time: v('f32', "the world's clock, s") },
  fragment: { color: v('vec4f', 'the colour so far (lit, fogged; alpha 1, or a ghost\'s)', true), base: v('vec3f', 'its own colour'), normal: v('vec3f', 'its normal'), position: v('vec3f', 'world metres'), id: v('f32', 'its id (picking)'), time: v('f32', "the world's clock, s") },
};
export interface MaterialCode { vertex?: string; fragment: string; functions?: string; varyings?: Record<string, string> }
/** the solids' program (a mesh's or the instances') with your material's code, params and varyings written in */
export function assembleMaterial(base: Sources, code: MaterialCode, params: ParamBlock, where: string, binding = 2): Sources {
  const taken = new Set([...Object.keys(MATERIAL_SCOPE.vertex), ...Object.keys(MATERIAL_SCOPE.fragment), 'params', 'frame', 'o', 'i', 't', 'm', 'h', 'n', 'p', 'c', 's', 'r', 'q', 'mat', 'si', 'g', 'keep']);
  const vary = Object.entries(code.varyings ?? {}).map(([n, ty]) => {
    if (!NAME.test(n) || taken.has(n)) throw new AslnutError('E-SHADER-001', `varying name '${n}' is taken or not a plain name`, { where, fix: `pick another (taken: ${[...taken].join(', ')})` });
    const t = parseType(ty);
    if (!(t.k === 'scalar' && t.s === 'f32') && !(t.k === 'vec' && t.s === 'f32')) throw new AslnutError('E-SHADER-001', `varying '${n}' must be f32 or vec2f..vec4f (got ${ty})`, { where, fix: 'use floats' });
    return [n, t] as [string, Type];
  });
  const zero = (t: Type) => (t.k === 'scalar' ? '0.0' : `${typeName(t)}(0.0)`), gz = (t: Type) => (t.k === 'scalar' ? '0.0' : `${glslType(t)}(0.0)`);
  let wgsl = base.wgsl, vert = base.glsl.vertex, frag = base.glsl.fragment;
  wgsl = put(wgsl, 'mparams', `struct MP { ${params.wgsl} }\n@group(0) @binding(${binding}) var<uniform> params: MP;`);
  const glp = `layout(std140) uniform MP { ${params.glsl} } params;`; vert = put(vert, 'mparams', glp); frag = put(frag, 'mparams', glp);
  wgsl = put(wgsl, 'mvaryings', vary.map(([n, t], k) => `@location(${7 + k}) v_${n}: ${typeName(t)},`).join(' '));
  vert = put(vert, 'mvaryingsOut', vary.map(([n, t]) => `out ${glslType(t)} v_${n};`).join('\n'));
  frag = put(frag, 'mvaryingsIn', vary.map(([n, t]) => `in ${glslType(t)} v_${n};`).join('\n'));
  wgsl = put(wgsl, 'mvinputs', ['let normal = o.n;', 'let time = frame.eye.w;', ...vary.map(([n, t]) => `var ${n} = ${zero(t)};`)].join('\n  '));
  vert = put(vert, 'mvinputs', ['vec3 normal = v_n;', 'float time = frame.eye.w;', ...vary.map(([n, t]) => `${glslType(t)} ${n} = ${gz(t)};`)].join('\n  '));
  wgsl = put(wgsl, 'mvoutputs', vary.map(([n]) => `o.v_${n} = ${n};`).join('\n  '));
  vert = put(vert, 'mvoutputs', vary.map(([n]) => `v_${n} = ${n};`).join('\n  '));
  wgsl = put(wgsl, 'mfinputs', ['let base = i.col;', 'let normal = normalize(i.n);', 'let position = i.world;', 'let id = i.id;', 'let time = frame.eye.w;', ...vary.map(([n]) => `var ${n} = i.v_${n};`)].join('\n  '));
  frag = put(frag, 'mfinputs', ['vec3 base = v_col;', 'vec3 normal = normalize(v_n);', 'vec3 position = v_world;', 'float id = v_id;', 'float time = frame.eye.w;', ...vary.map(([n, t]) => `${glslType(t)} ${n} = v_${n};`)].join('\n  '));
  let fns: ReturnType<typeof translateModule>['functions'] = [], fnGlsl = '';
  if (code.functions) { const t = translateModule(code.functions, { structs: structs(params) }, { where: `${where} functions` }); fns = t.functions; fnGlsl = t.glsl; }
  wgsl = put(wgsl, 'functions', code.functions ?? ''); vert = put(vert, 'functions', fnGlsl); frag = put(frag, 'functions', fnGlsl);
  const scope = (o: Record<string, { type: string; mutable?: boolean }>) => ({ ...Object.fromEntries(Object.entries(o).map(([n, x]) => [n, { type: x.type, mutable: x.mutable }])), ...Object.fromEntries(vary.map(([n, t]) => [n, { type: t, mutable: true }])) });
  for (const [stage, src, sc] of [['vertex', code.vertex ?? '', scope(MATERIAL_SCOPE.vertex)], ['fragment', code.fragment, scope(MATERIAL_SCOPE.fragment)]] as const) {
    const t = src.trim() ? translateStatements(src, { values: sc as ScopeSpec['values'], structs: structs(params), functions: fns }, { where: `${where} ${stage}` }).glsl.trim() : '';
    wgsl = put(wgsl, stage === 'vertex' ? 'mvertex' : 'mfragment', src);
    if (stage === 'vertex') vert = put(vert, 'mvertex', t); else frag = put(frag, 'mfragment', t);
  }
  return { wgsl, glsl: { vertex: vert, fragment: frag } };
}

// ── a custom layer of your own geometry (custom({ geometry })) ───────────────────────────────────────────
export const MESH_SCOPE = {
  vertex: { position: v('vec3f', 'the vertex, metres from its copy\'s place (x east, y up, z south)', true), normal: v('vec3f', 'its normal', true), uv: v('vec2f', 'its uv'), color: v('vec4f', 'its colour', true), time: v('f32', "the world's clock, s"), eye: v('vec3f', 'the camera, world metres'), origin: v('vec3f', "this copy's place, world metres (billboards: turn position towards the eye)") },
  fragment: { color: v('vec4f', 'what you draw (default: the vertex colour)', true), corner: v('vec2f', 'across a point, -1..1 (0 on triangles and lines)'), uv: v('vec2f', 'the uv here'), normal: v('vec3f', 'the normal here'), position: v('vec3f', 'world metres'), time: v('f32', "the world's clock, s") },
};
export interface MeshCode {
  /** per vertex (your geometry's attributes) and per copy (instances): name → WGSL type */
  vertexAttributes: Record<string, string>; instanceAttributes: Record<string, string>;
  varyings: Record<string, string>; textures: string[];
  vertex?: string; fragment?: string; functions?: string;
}
const fnSig = (name: string, params: string[], ret: string) => ({ name, params: params.map((p) => parseType(p)), ret: parseType(ret) });
/** the custom mesh program with your attributes, varyings, textures (tex_<name>(uv) → vec4f), params and code */
export function assembleCustomMesh(base: Sources, code: MeshCode, params: ParamBlock, where: string): Sources & { vertexAttrs: { name: string; size: 1 | 2 | 3 | 4 }[]; instanceAttrs: { name: string; size: 1 | 2 | 3 | 4 }[] } {
  const taken = new Set([...Object.keys(MESH_SCOPE.vertex), ...Object.keys(MESH_SCOPE.fragment), 'params', 'frame', 'o', 'i', 'u', 'world', 'clip', 'alpha', 'inst', 'vid', 'lambert', 'cornerOf']);
  const types = (o: Record<string, string>, what: string) => Object.entries(o).map(([n, ty]) => {
    if (!NAME.test(n) || taken.has(n)) throw new AslnutError('E-SHADER-001', `${what} name '${n}' is taken or not a plain name`, { where, fix: `pick another (taken: ${[...taken].join(', ')})` });
    taken.add(n);
    const t = parseType(ty);
    if (!(t.k === 'scalar' && t.s === 'f32') && !(t.k === 'vec' && t.s === 'f32')) throw new AslnutError('E-SHADER-001', `${what} '${n}' must be f32 or vec2f..vec4f (got ${ty})`, { where, fix: 'use floats' });
    return [n, t] as [string, Type];
  });
  const va = types(code.vertexAttributes, 'attribute'), ia = types(code.instanceAttributes, 'instance attribute'), vary = types(code.varyings, 'varying');
  for (const n of code.textures) { if (!NAME.test(n) || taken.has(n)) throw new AslnutError('E-SHADER-001', `texture name '${n}' is taken or not a plain name`, { where, fix: 'pick another' }); }
  const attrs = [...va, ...ia], zero = (t: Type) => (t.k === 'scalar' ? '0.0' : `${typeName(t)}(0.0)`), gz = (t: Type) => (t.k === 'scalar' ? '0.0' : `${glslType(t)}(0.0)`);
  let wgsl = base.wgsl, vert = base.glsl.vertex, frag = base.glsl.fragment;
  wgsl = put(wgsl, 'attributes', attrs.map(([n, t], k) => `@location(${k + 5}) a_${n}: ${typeName(t)},`).join(' '));
  vert = put(vert, 'attributes', attrs.map(([n, t], k) => `layout(location = ${k + 5}) in ${glslType(t)} a_${n};`).join('\n'));
  wgsl = put(wgsl, 'varyings', vary.map(([n, t], k) => `@location(${k + 6}) v_${n}: ${typeName(t)},`).join(' '));
  vert = put(vert, 'varyings', vary.map(([n, t]) => `out ${glslType(t)} v_${n};`).join('\n'));
  frag = put(frag, 'varyings', vary.map(([n, t]) => `in ${glslType(t)} v_${n};`).join('\n'));
  // textures: group 1, bindings 0..n-1, the sampler at n; read with tex_<name>(uv) (the level 0: any stage, any branch)
  const T = code.textures;
  wgsl = put(wgsl, 'textures', T.length ? [...T.map((n, k) => `@group(1) @binding(${k}) var t_${n}: texture_2d<f32>;`), `@group(1) @binding(${T.length}) var t_sampler: sampler;`, ...T.map((n) => `fn tex_${n}(uv: vec2f) -> vec4f {\n  return textureSampleLevel(t_${n}, t_sampler, uv, 0.0);\n}`)].join('\n') : '');
  const glt = T.map((n) => `uniform highp sampler2D t_${n};\nvec4 tex_${n}(vec2 uv) {\n  return textureLod(t_${n}, uv, 0.0);\n}`).join('\n');
  vert = put(vert, 'textures', glt); frag = put(frag, 'textures', glt);
  wgsl = put(wgsl, 'inputs', [...attrs.map(([n]) => `let ${n} = i.a_${n};`), ...vary.map(([n, t]) => `var ${n} = ${zero(t)};`)].join('\n  '));
  vert = put(vert, 'inputs', [...attrs.map(([n, t]) => `${glslType(t)} ${n} = a_${n};`), ...vary.map(([n, t]) => `${glslType(t)} ${n} = ${gz(t)};`)].join('\n  '));
  wgsl = put(wgsl, 'outputs', vary.map(([n]) => `o.v_${n} = ${n};`).join('\n  '));
  vert = put(vert, 'outputs', vary.map(([n]) => `v_${n} = ${n};`).join('\n  '));
  wgsl = put(wgsl, 'finputs', vary.map(([n]) => `var ${n} = i.v_${n};`).join('\n  '));
  frag = put(frag, 'finputs', vary.map(([n, t]) => `${glslType(t)} ${n} = v_${n};`).join('\n  '));
  wgsl = put(wgsl, 'params', params.wgsl); vert = put(vert, 'params', params.glsl); frag = put(frag, 'params', params.glsl);
  const builtins = [fnSig('lambert', ['vec3f'], 'vec3f'), ...T.map((n) => fnSig(`tex_${n}`, ['vec2f'], 'vec4f'))];
  let fns: ReturnType<typeof translateModule>['functions'] = [...builtins], fnGlsl = '';
  if (code.functions) { const t = translateModule(code.functions, { structs: structs(params), functions: builtins }, { where: `${where} functions` }); fns = [...builtins, ...t.functions]; fnGlsl = t.glsl; }
  wgsl = put(wgsl, 'functions', code.functions ?? ''); vert = put(vert, 'functions', fnGlsl); frag = put(frag, 'functions', fnGlsl);
  const scope = (o: Record<string, { type: string; mutable?: boolean }>, withAttrs: boolean) => ({ ...Object.fromEntries(Object.entries(o).map(([n, x]) => [n, { type: x.type, mutable: x.mutable }])), ...(withAttrs ? Object.fromEntries(attrs.map(([n, t]) => [n, { type: t }])) : {}), ...Object.fromEntries(vary.map(([n, t]) => [n, { type: t, mutable: true }])) });
  for (const [stage, src, sc] of [['vertex', code.vertex ?? '', scope(MESH_SCOPE.vertex, true)], ['fragment', code.fragment ?? '', scope(MESH_SCOPE.fragment, false)]] as const) {
    const t = src.trim() ? translateStatements(src, { values: sc as ScopeSpec['values'], structs: structs(params), functions: fns }, { where: `${where} ${stage}` }).glsl.trim() : '';
    wgsl = put(wgsl, stage, src);
    if (stage === 'vertex') vert = put(vert, 'vertex', t); else frag = put(frag, 'fragment', t);
  }
  const size = (t: Type) => (t.k === 'vec' ? t.n : 1) as 1 | 2 | 3 | 4;
  return { wgsl, glsl: { vertex: vert, fragment: frag }, vertexAttrs: va.map(([n, t]) => ({ name: n, size: size(t) })), instanceAttrs: ia.map(([n, t]) => ({ name: n, size: size(t) })) };
}
