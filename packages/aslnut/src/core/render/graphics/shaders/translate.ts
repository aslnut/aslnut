// core › render › graphics › shaders › translate: the one shader language people write in aslnut, a subset of WGSL, turned
// into GLSL ES 3.0 so the same code runs on WebGPU and WebGL2. Core shaders keep hand-written twins; this is for code
// people write: hooks (`shader: { color: '…' }`), custom layers and their functions.
//
// The subset: scalars f32 / i32 / u32 / bool, vectors, square matrices, fixed arrays; literals (1, 1.0, 1u, 1i, 1f,
// 0x1f); let / var / const; = and op=; ++ / --; if / else; for; while; break / continue / return / discard;
// functions (fn name(a: T) -> R); the math built-ins; member access, swizzles and indexing; uniforms and inputs given
// by the caller (params.gain, position, uv …). Not yet: structs you declare, textures, pointers, atomics, loop {}.
// Errors name your line and column, and the fix.
import { AslnutError } from '../../../world/errors.ts';

// ── types ────────────────────────────────────────────────────────────────────────────────────────────────────────
export type Scalar = 'f32' | 'i32' | 'u32' | 'bool';
export type Type =
  | { k: 'scalar'; s: Scalar; abstract?: boolean }
  | { k: 'vec'; n: 2 | 3 | 4; s: Scalar }
  | { k: 'mat'; c: 2 | 3 | 4; r: 2 | 3 | 4 }
  | { k: 'array'; of: Type; n: number }
  | { k: 'struct'; name: string; members: Record<string, Type> }
  | { k: 'void' };
const S = (s: Scalar, abstract = false): Type => ({ k: 'scalar', s, ...(abstract ? { abstract } : {}) });
const V = (n: 2 | 3 | 4, s: Scalar = 'f32'): Type => ({ k: 'vec', n, s });
const F32 = S('f32'), BOOL = S('bool'), VOID: Type = { k: 'void' };

/** a type written as WGSL text ('f32', 'vec3f', 'vec4<f32>', 'mat4x4f', 'array<f32, 4>') */
export function parseType(t: string): Type {
  const r = new Parser(lex(t, 0), '').type();
  return r;
}
export function typeName(t: Type): string {
  switch (t.k) {
    case 'scalar': return t.s;
    case 'vec': return `vec${t.n}${t.s === 'bool' ? '<bool>' : t.s[0]}`;
    case 'mat': return `mat${t.c}x${t.r}f`;
    case 'array': return `array<${typeName(t.of)}, ${t.n}>`;
    case 'struct': return t.name;
    case 'void': return 'void';
  }
}
export function glslType(t: Type): string {
  switch (t.k) {
    case 'scalar': return { f32: 'float', i32: 'int', u32: 'uint', bool: 'bool' }[t.s];
    case 'vec': return `${{ f32: '', i32: 'i', u32: 'u', bool: 'b' }[t.s]}vec${t.n}`;
    case 'mat': return t.c === t.r ? `mat${t.c}` : `mat${t.c}x${t.r}`;
    case 'array': return `${glslType(t.of)}[${t.n}]`;
    case 'struct': return t.name;
    case 'void': return 'void';
  }
}
const same = (a: Type, b: Type): boolean => {
  if (a.k !== b.k) return false;
  if (a.k === 'scalar' && b.k === 'scalar') return a.s === b.s;
  if (a.k === 'vec' && b.k === 'vec') return a.n === b.n && a.s === b.s;
  if (a.k === 'mat' && b.k === 'mat') return a.c === b.c && a.r === b.r;
  if (a.k === 'array' && b.k === 'array') return a.n === b.n && same(a.of, b.of);
  if (a.k === 'struct' && b.k === 'struct') return a.name === b.name;
  return a.k === 'void';
};
const scalarOf = (t: Type): Scalar | null => (t.k === 'scalar' || t.k === 'vec' ? t.s : t.k === 'mat' ? 'f32' : null);
const isAbstract = (t: Type) => t.k === 'scalar' && !!t.abstract;
const isFloaty = (t: Type) => scalarOf(t) === 'f32';
/** an abstract literal type takes the scalar of `to` */
const concrete = (t: Type, to: Scalar): Type => (isAbstract(t) ? S(to) : t);

// ── lexer ────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Tok { t: 'id' | 'num' | 'op' | 'eof'; v: string; line: number; col: number }
const OPS = ['->', '<<=', '>>=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '++', '--', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '(', ')', '{', '}', '[', ']', ',', ';', ':', '.', '=', '<', '>', '+', '-', '*', '/', '%', '!', '&', '|', '^', '~', '@'];
function lex(src: string, line0: number): Tok[] {
  const out: Tok[] = [];
  let i = 0, line = line0 + 1, col = 1;
  const adv = (n: number) => { for (let k = 0; k < n; k++) { if (src[i] === '\n') { line++; col = 1; } else col++; i++; } };
  while (i < src.length) {
    const c = src[i]!;
    if (/\s/.test(c)) { adv(1); continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') adv(1); continue; }
    if (src.startsWith('/*', i)) { const j = src.indexOf('*/', i + 2); adv((j < 0 ? src.length : j + 2) - i); continue; }
    const at = { line, col };
    const num = /^(?:0[xX][0-9a-fA-F]+[iu]?|(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?[fhiu]?)/.exec(src.slice(i));
    if (num && /[\d.]/.test(c) && !(c === '.' && !/\d/.test(src[i + 1] ?? ''))) { out.push({ t: 'num', v: num[0], ...at }); adv(num[0].length); continue; }
    const id = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
    if (id) { out.push({ t: 'id', v: id[0], ...at }); adv(id[0].length); continue; }
    const op = OPS.find((o) => src.startsWith(o, i));
    if (op) { out.push({ t: 'op', v: op, ...at }); adv(op.length); continue; }
    throw new ShaderError(`unexpected character '${c}'`, at.line, at.col, 'remove it; the shader language is a WGSL subset');
  }
  out.push({ t: 'eof', v: '', line, col });
  return out;
}

export class ShaderError extends AslnutError {
  readonly line: number; readonly col: number;
  constructor(msg: string, line: number, col: number, fix: string, where = '') {
    super('E-SHADER-001', `line ${line}, col ${col}: ${msg}`, { fix, where });
    this.name = 'ShaderError'; this.line = line; this.col = col;
  }
}

// ── syntax tree ──────────────────────────────────────────────────────────────────────────────────────────────────
type Expr =
  | { e: 'num'; v: string; tok: Tok }
  | { e: 'bool'; v: boolean; tok: Tok }
  | { e: 'id'; name: string; tok: Tok }
  | { e: 'call'; name: string; targs: Type | null; args: Expr[]; tok: Tok }
  | { e: 'member'; of: Expr; name: string; tok: Tok }
  | { e: 'index'; of: Expr; i: Expr; tok: Tok }
  | { e: 'unary'; op: string; x: Expr; tok: Tok }
  | { e: 'binary'; op: string; a: Expr; b: Expr; tok: Tok };
type Stmt =
  | { s: 'decl'; kind: 'let' | 'var' | 'const'; name: string; type: Type | null; init: Expr | null; tok: Tok }
  | { s: 'assign'; op: string; lhs: Expr; rhs: Expr; tok: Tok }
  | { s: 'incr'; op: '++' | '--'; lhs: Expr; tok: Tok }
  | { s: 'expr'; x: Expr; tok: Tok }
  | { s: 'if'; cond: Expr; then: Stmt[]; else: Stmt[] | null; tok: Tok }
  | { s: 'for'; init: Stmt | null; cond: Expr | null; update: Stmt | null; body: Stmt[]; tok: Tok }
  | { s: 'while'; cond: Expr; body: Stmt[]; tok: Tok }
  | { s: 'break' | 'continue' | 'discard'; tok: Tok }
  | { s: 'return'; x: Expr | null; tok: Tok }
  | { s: 'block'; body: Stmt[]; tok: Tok };
interface FnDecl { name: string; params: { name: string; type: Type }[]; ret: Type; body: Stmt[]; tok: Tok }
interface ConstDecl { name: string; type: Type | null; init: Expr; tok: Tok }

const BIN_PREC: Record<string, number> = { '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '<=': 7, '>': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10 };
const TYPE_NAMES = /^(f32|i32|u32|bool|vec[234][fiu]?|mat[234]x[234]f?|array)$/;

class Parser {
  private p = 0;
  private toks: Tok[]; private where: string;
  constructor(toks: Tok[], where: string) { this.toks = toks; this.where = where; }
  private get cur(): Tok { return this.toks[this.p]!; }
  private err(msg: string, tok = this.cur, fix = 'check the WGSL syntax at that point'): never { throw new ShaderError(msg, tok.line, tok.col, fix, this.where); }
  private is(v: string): boolean { return this.cur.v === v && this.cur.t !== 'num'; }
  private eat(v: string): Tok { if (!this.is(v)) this.err(`expected '${v}', found '${this.cur.v || 'the end'}'`, this.cur, v === ';' ? 'end the statement with ;' : `add '${v}'`); return this.toks[this.p++]!; }
  private id(): Tok { if (this.cur.t !== 'id') this.err(`expected a name, found '${this.cur.v || 'the end'}'`); return this.toks[this.p++]!; }
  get done(): boolean { return this.cur.t === 'eof'; }

  type(): Type {
    const t = this.id(), n = t.v;
    if (n === 'f32' || n === 'i32' || n === 'u32' || n === 'bool') return S(n);
    let m = /^vec([234])([fiu])$/.exec(n);
    if (m) return V(+m[1]! as 2 | 3 | 4, ({ f: 'f32', i: 'i32', u: 'u32' } as const)[m[2] as 'f' | 'i' | 'u']);
    m = /^vec([234])$/.exec(n);
    if (m) { this.eat('<'); const s = this.type(); this.eat('>'); if (s.k !== 'scalar') this.err('a vector holds scalars', t); return V(+m[1]! as 2 | 3 | 4, s.s); }
    m = /^mat([234])x([234])(f?)$/.exec(n);
    if (m) {
      if (!m[3]) { this.eat('<'); const s = this.type(); this.eat('>'); if (s.k !== 'scalar' || s.s !== 'f32') this.err('matrices are of f32', t); }
      return { k: 'mat', c: +m[1]! as 2 | 3 | 4, r: +m[2]! as 2 | 3 | 4 };
    }
    if (n === 'array') {
      this.eat('<'); const of = this.type(); this.eat(',');
      const c = this.cur; if (c.t !== 'num') this.err('an array needs a fixed size', c, 'write array<f32, 4>');
      this.p++; this.eat('>');
      return { k: 'array', of, n: parseInt(c.v, c.v.startsWith('0x') ? 16 : 10) };
    }
    if (n === 'f16' || /^vec[234]h$/.test(n)) this.err(`'${n}' (16-bit floats) is not in the shader subset`, t, 'use f32');
    if (/^texture|^sampler/.test(n)) this.err(`'${n}': textures are not in the shader subset yet`, t, 'use the inputs and params the hook gives');
    if (/^ptr$|^atomic$/.test(n)) this.err(`'${n}' is not in the shader subset`, t, 'use plain values');
    return this.err(`unknown type '${n}'`, t, 'use f32, i32, u32, bool, vec2f..vec4f, vec2i.., vec2u.., mat2x2f..mat4x4f or array<T, N>');
  }

  module(): { fns: FnDecl[]; consts: ConstDecl[] } {
    const fns: FnDecl[] = [], consts: ConstDecl[] = [];
    while (!this.done) {
      if (this.is('@')) this.err('attributes (@…) are not in the shader subset', this.cur, 'write plain functions');
      if (this.is('fn')) {
        const tok = this.eat('fn'), name = this.id().v; this.eat('(');
        const params: FnDecl['params'] = [];
        while (!this.is(')')) { const pn = this.id().v; this.eat(':'); params.push({ name: pn, type: this.type() }); if (!this.is(')')) this.eat(','); }
        this.eat(')');
        let ret: Type = VOID; if (this.is('->')) { this.eat('->'); ret = this.type(); }
        fns.push({ name, params, ret, body: this.block(), tok });
      } else if (this.is('const')) {
        const tok = this.eat('const'), name = this.id().v; let type: Type | null = null;
        if (this.is(':')) { this.eat(':'); type = this.type(); }
        this.eat('='); const init = this.expr(); this.eat(';');
        consts.push({ name, type, init, tok });
      } else if (this.is('struct')) this.err('structs you declare are not in the shader subset yet', this.cur, 'use vectors, or several values');
      else if (this.is('var') || this.is('override')) this.err(`module-level '${this.cur.v}' is not allowed`, this.cur, 'use const, or a param (they become uniforms)');
      else this.err(`expected 'fn' or 'const' at the top level, found '${this.cur.v}'`);
    }
    return { fns, consts };
  }
  statements(): Stmt[] { const out: Stmt[] = []; while (!this.done) out.push(this.stmt()); return out; }
  private block(): Stmt[] { this.eat('{'); const out: Stmt[] = []; while (!this.is('}')) { if (this.done) this.err("missing '}'"); out.push(this.stmt()); } this.eat('}'); return out; }
  private stmt(): Stmt {
    const tok = this.cur;
    if (this.is('{')) return { s: 'block', body: this.block(), tok };
    if (this.is('let') || this.is('var') || this.is('const')) { const d = this.decl(); this.eat(';'); return d; }
    if (this.is('if')) return this.ifStmt();
    if (this.is('for')) {
      this.eat('for'); this.eat('(');
      const init = this.is(';') ? null : this.is('let') || this.is('var') ? this.decl() : this.simple(); this.eat(';');
      const cond = this.is(';') ? null : this.expr(); this.eat(';');
      const update = this.is(')') ? null : this.simple(); this.eat(')');
      return { s: 'for', init, cond, update, body: this.block(), tok };
    }
    if (this.is('while')) { this.eat('while'); const cond = this.expr(); return { s: 'while', cond, body: this.block(), tok }; }
    if (this.is('loop') || this.is('switch')) this.err(`'${tok.v}' is not in the shader subset yet`, tok, tok.v === 'loop' ? 'use for or while' : 'use if / else');
    if (this.is('break') || this.is('continue') || this.is('discard')) { this.p++; this.eat(';'); return { s: tok.v as 'break', tok }; }
    if (this.is('return')) { this.eat('return'); const x = this.is(';') ? null : this.expr(); this.eat(';'); return { s: 'return', x, tok }; }
    const st = this.simple(); this.eat(';'); return st;
  }
  private ifStmt(): Stmt {
    const tok = this.eat('if'), cond = this.expr(), then = this.block();
    let els: Stmt[] | null = null;
    if (this.is('else')) { this.eat('else'); els = this.is('if') ? [this.ifStmt()] : this.block(); }
    return { s: 'if', cond, then, else: els, tok };
  }
  private decl(): Stmt {
    const tok = this.cur, kind = this.id().v as 'let' | 'var' | 'const', name = this.id();
    let type: Type | null = null; if (this.is(':')) { this.eat(':'); type = this.type(); }
    let init: Expr | null = null; if (this.is('=')) { this.eat('='); init = this.expr(); }
    if (!init && kind !== 'var') this.err(`'${kind} ${name.v}' needs a value`, name, `write ${kind} ${name.v} = …;`);
    return { s: 'decl', kind, name: name.v, type, init, tok };
  }
  /** an assignment, ++ / --, or a call */
  private simple(): Stmt {
    const tok = this.cur;
    if (this.is('_')) { this.eat('_'); this.eat('='); return { s: 'expr', x: this.expr(), tok }; }
    const lhs = this.postfix();
    if (this.is('++') || this.is('--')) { const op = this.toks[this.p++]!.v as '++' | '--'; return { s: 'incr', op, lhs, tok }; }
    const op = this.cur.v;
    if (this.cur.t === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(op)) { this.p++; return { s: 'assign', op, lhs, rhs: this.expr(), tok }; }
    if (lhs.e !== 'call') this.err('a statement must assign, call, or declare', tok, 'did you mean x = …; ?');
    return { s: 'expr', x: lhs, tok };
  }
  expr(min = 1): Expr {
    let a = this.unary();
    for (;;) {
      const t = this.cur, prec = t.t === 'op' ? BIN_PREC[t.v] : undefined;
      if (prec === undefined || prec < min) return a;
      this.p++;
      const b = this.expr(prec + 1);
      a = { e: 'binary', op: t.v, a, b, tok: t };
    }
  }
  private unary(): Expr {
    const t = this.cur;
    if (t.t === 'op' && (t.v === '-' || t.v === '!' || t.v === '~')) { this.p++; return { e: 'unary', op: t.v, x: this.unary(), tok: t }; }
    if (t.t === 'op' && (t.v === '&' || t.v === '*')) this.err('pointers are not in the shader subset', t, 'use plain values');
    return this.postfix();
  }
  private postfix(): Expr {
    let x = this.primary();
    for (;;) {
      if (this.is('.')) { const tok = this.eat('.'); x = { e: 'member', of: x, name: this.id().v, tok }; }
      else if (this.is('[')) { const tok = this.eat('['); const i = this.expr(); this.eat(']'); x = { e: 'index', of: x, i, tok }; }
      else return x;
    }
  }
  private primary(): Expr {
    const t = this.cur;
    if (t.t === 'num') { this.p++; return { e: 'num', v: t.v, tok: t }; }
    if (this.is('(')) { this.eat('('); const x = this.expr(); this.eat(')'); return x; }
    if (t.t === 'id') {
      if (t.v === 'true' || t.v === 'false') { this.p++; return { e: 'bool', v: t.v === 'true', tok: t }; }
      // a type constructor with template args: vec3<f32>(…), array<f32, 3>(…)
      if (TYPE_NAMES.test(t.v) && this.toks[this.p + 1]?.v === '<') { const ty = this.type(); this.eat('('); return { e: 'call', name: typeName(ty), targs: ty, args: this.args(), tok: t }; }
      this.p++;
      if (this.is('(')) { this.eat('('); return { e: 'call', name: t.v, targs: null, args: this.args(), tok: t }; }
      return { e: 'id', name: t.v, tok: t };
    }
    return this.err(`unexpected '${t.v || 'end of code'}'`);
  }
  private args(): Expr[] { const out: Expr[] = []; while (!this.is(')')) { out.push(this.expr()); if (!this.is(')')) this.eat(','); } this.eat(')'); return out; }
}

// ── built-in functions ───────────────────────────────────────────────────────────────────────────────────────────
type Rule = 'same' | 'scalar' | 'cross' | 'bool' | 'mixlike' | 'select' | 'transpose' | 'det' | 'fma' | 'saturate' | 'atan2' | 'bitcast';
const BUILTINS: Record<string, { glsl: string; rule: Rule; argc: number[] }> = {};
for (const n of ['abs', 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'sinh', 'cosh', 'tanh', 'asinh', 'acosh', 'atanh', 'exp', 'exp2', 'log', 'log2', 'sqrt', 'floor', 'ceil', 'fract', 'round', 'trunc', 'sign', 'radians', 'degrees', 'normalize', 'fwidth'])
  BUILTINS[n] = { glsl: n, rule: 'same', argc: [1] };
Object.assign(BUILTINS, {
  inverseSqrt: { glsl: 'inversesqrt', rule: 'same', argc: [1] }, dpdx: { glsl: 'dFdx', rule: 'same', argc: [1] }, dpdy: { glsl: 'dFdy', rule: 'same', argc: [1] },
  min: { glsl: 'min', rule: 'same', argc: [2] }, max: { glsl: 'max', rule: 'same', argc: [2] }, pow: { glsl: 'pow', rule: 'same', argc: [2] },
  step: { glsl: 'step', rule: 'mixlike', argc: [2] }, reflect: { glsl: 'reflect', rule: 'same', argc: [2] },
  clamp: { glsl: 'clamp', rule: 'mixlike', argc: [3] }, mix: { glsl: 'mix', rule: 'mixlike', argc: [3] }, smoothstep: { glsl: 'smoothstep', rule: 'mixlike', argc: [3] },
  dot: { glsl: 'dot', rule: 'scalar', argc: [2] }, length: { glsl: 'length', rule: 'scalar', argc: [1] }, distance: { glsl: 'distance', rule: 'scalar', argc: [2] },
  cross: { glsl: 'cross', rule: 'cross', argc: [2] }, any: { glsl: 'any', rule: 'bool', argc: [1] }, all: { glsl: 'all', rule: 'bool', argc: [1] },
  select: { glsl: '', rule: 'select', argc: [3] }, transpose: { glsl: 'transpose', rule: 'transpose', argc: [1] }, determinant: { glsl: 'determinant', rule: 'det', argc: [1] },
  fma: { glsl: '', rule: 'fma', argc: [3] }, saturate: { glsl: '', rule: 'saturate', argc: [1] }, atan2: { glsl: 'atan', rule: 'atan2', argc: [2] },
});
/** GLSL words a WGSL name must not become */
const GLSL_RESERVED = new Set(('attribute const uniform varying layout centroid flat smooth noperspective break continue do for while switch case default if else in out inout float int void bool true false invariant discard return mat2 mat3 mat4 mat2x2 mat2x3 mat2x4 mat3x2 mat3x3 mat3x4 mat4x2 mat4x3 mat4x4 vec2 vec3 vec4 ivec2 ivec3 ivec4 bvec2 bvec3 bvec4 uint uvec2 uvec3 uvec4 lowp mediump highp precision sampler2D sampler3D samplerCube sampler2DShadow samplerCubeShadow sampler2DArray sampler2DArrayShadow isampler2D isampler3D isamplerCube isampler2DArray usampler2D usampler3D usamplerCube usampler2DArray struct ' +
  'asm class union enum typedef template this packed resource goto inline noinline volatile public static extern external interface long short double half fixed unsigned superp input output hvec2 hvec3 hvec4 dvec2 dvec3 dvec4 fvec2 fvec3 fvec4 sampler3DRect filter image1D image2D image3D imageCube iimage1D iimage2D iimage3D iimageCube uimage1D uimage2D uimage3D uimageCube sizeof cast namespace using sample patch subroutine common partition active ' +
  'texture texelFetch mod dFdx dFdy inversesqrt lessThan greaterThan equal notEqual not main').split(' '));
const safeName = (n: string) => (GLSL_RESERVED.has(n) || n.startsWith('gl_') || n.includes('__') ? `w_${n}` : n);

// ── checking and writing GLSL ────────────────────────────────────────────────────────────────────────────────────
interface Sym { type: Type; mutable: boolean; glsl: string }
interface FnSig { name: string; params: Type[]; ret: Type }
export interface ScopeSpec {
  /** names in scope and their WGSL types; `mutable` names may be assigned (a hook's outputs) */
  values?: Record<string, string | Type | { type: string | Type; mutable?: boolean; glsl?: string }>;
  /** uniform blocks / structs in scope: name → members (WGSL types) */
  structs?: Record<string, Record<string, string | Type>>;
  /** functions already declared (by an earlier translate of a module) */
  functions?: FnSig[];
}

class Checker {
  private scopes: Map<string, Sym>[] = [];
  private fns = new Map<string, FnSig>();
  private retType: Type | null = null;
  private where: string;
  constructor(where: string, spec: ScopeSpec) {
    this.where = where;
    const g = new Map<string, Sym>();
    for (const [n, v] of Object.entries(spec.values ?? {})) {
      const o = typeof v === 'object' && 'type' in v ? v : { type: v as string | Type };
      g.set(n, { type: typeof o.type === 'string' ? parseType(o.type) : o.type, mutable: !!(o as { mutable?: boolean }).mutable, glsl: (o as { glsl?: string }).glsl ?? n });
    }
    for (const [n, members] of Object.entries(spec.structs ?? {})) {
      const m: Record<string, Type> = {}; for (const [k, t] of Object.entries(members)) m[k] = typeof t === 'string' ? parseType(t) : t;
      g.set(n, { type: { k: 'struct', name: n, members: m }, mutable: false, glsl: n });
    }
    this.scopes.push(g);
    for (const f of spec.functions ?? []) this.fns.set(f.name, f);
  }
  private err(msg: string, tok: Tok, fix: string): never { throw new ShaderError(msg, tok.line, tok.col, fix, this.where); }
  private lookup(n: string): Sym | undefined { for (let i = this.scopes.length - 1; i >= 0; i--) { const s = this.scopes[i]!.get(n); if (s) return s; } return undefined; }
  private names(): string[] { return this.scopes.flatMap((s) => [...s.keys()]); }
  private define(n: string, type: Type, mutable: boolean, tok: Tok): string {
    if (this.scopes[this.scopes.length - 1]!.has(n)) this.err(`'${n}' is already declared here`, tok, 'use another name, or assign to it');
    if (BUILTINS[n] || /^(f32|i32|u32|bool|vec[234][fiu]?|mat[234]x[234]f)$/.test(n)) this.err(`'${n}' is a built-in name`, tok, 'use another name');
    const glsl = safeName(n);
    this.scopes[this.scopes.length - 1]!.set(n, { type, mutable, glsl });
    return glsl;
  }
  sigs(): FnSig[] { return [...this.fns.values()]; }

  // ── modules ─────────────────────────────────────────────────────────────────────────────────────────────────
  module(m: { fns: FnDecl[]; consts: ConstDecl[] }): string {
    const out: string[] = [];
    for (const c of m.consts) {
      const [x, t0] = this.expr(c.init);
      const t = c.type ?? this.concretize(t0);
      this.assignable(t, t0, c.tok);
      out.push(`const ${glslType(t)} ${this.define(c.name, t, false, c.tok)} = ${this.emitAs(c.init, x, t0, t)};`);
    }
    for (const f of m.fns) {
      if (this.fns.has(f.name) || BUILTINS[f.name]) this.err(`function '${f.name}' is declared twice (or is a built-in)`, f.tok, 'rename it');
      this.fns.set(f.name, { name: f.name, params: f.params.map((p) => p.type), ret: f.ret });
    }
    // prototypes first: WGSL lets functions call each other in any order, GLSL needs them declared
    for (const f of m.fns) out.push(`${glslType(f.ret)} ${safeName(f.name)}(${f.params.map((p) => `${glslType(p.type)} ${safeName(p.name)}`).join(', ')});`);
    for (const f of m.fns) {
      this.scopes.push(new Map()); this.retType = f.ret;
      const ps = f.params.map((p) => `${glslType(p.type)} ${this.define(p.name, p.type, false, f.tok)}`);
      const body = this.block(f.body, 1);
      if (f.ret.k !== 'void' && !returns(f.body)) this.err(`function '${f.name}' does not return a ${typeName(f.ret)} on every path`, f.tok, 'add a return at the end');
      out.push(`${glslType(f.ret)} ${safeName(f.name)}(${ps.join(', ')}) {\n${body}}`);
      this.scopes.pop(); this.retType = null;
    }
    return out.join('\n');
  }
  statements(body: Stmt[], indent = 1): string { return this.block(body, indent, false); }

  private block(body: Stmt[], indent: number, scope = true): string {
    if (scope) this.scopes.push(new Map());
    const pad = '  '.repeat(indent), out = body.map((s) => this.stmt(s, indent).split('\n').map((l) => pad + l).join('\n') + '\n').join('');
    if (scope) this.scopes.pop();
    return out;
  }
  private stmt(st: Stmt, indent: number): string {
    switch (st.s) {
      case 'decl': {
        let t: Type, init: string;
        if (st.init) {
          const [x, t0] = this.expr(st.init);
          t = st.type ?? this.concretize(t0);
          this.assignable(t, t0, st.tok);
          init = this.emitAs(st.init, x, t0, t);
        } else { t = st.type!; if (!t) this.err(`'var ${st.name}' needs a type or a value`, st.tok, `write var ${st.name}: f32;`); init = zero(t); }
        const g = this.define(st.name, t, st.kind === 'var', st.tok);
        return `${st.kind === 'const' ? 'const ' : ''}${glslType(t)} ${g} = ${init};`;
      }
      case 'assign': {
        const [l, lt] = this.lvalue(st.lhs);
        const [r, rt] = this.expr(st.rhs);
        if (st.op === '=') { this.assignable(lt, rt, st.tok); return `${l} = ${this.emitAs(st.rhs, r, rt, lt)};`; }
        const op = st.op.slice(0, -1);
        const [x, t] = this.binaryOf(op, l, lt, this.emitAs(st.rhs, r, rt, concrete(rt, scalarOf(lt) ?? 'f32')), concrete(rt, scalarOf(lt) ?? 'f32'), st.tok);
        this.assignable(lt, t, st.tok);
        return `${l} = ${x};`;
      }
      case 'incr': { const [l, lt] = this.lvalue(st.lhs); if (lt.k !== 'scalar' || lt.s === 'bool' || lt.s === 'f32') this.err(`${st.op} works on i32 / u32 only`, st.tok, 'write x = x + 1.0;'); return `${l}${st.op};`; }
      case 'expr': return `${this.expr(st.x)[0]};`;
      case 'if': {
        const c = this.cond(st.cond, 'if');
        let s = `if (${c}) {\n${this.block(st.then, 1)}}`;
        if (st.else) s += st.else.length === 1 && st.else[0]!.s === 'if' ? ` else ${this.stmt(st.else[0]!, indent)}` : ` else {\n${this.block(st.else, 1)}}`;
        return s;
      }
      case 'for': {
        this.scopes.push(new Map());
        const init = st.init ? this.stmt(st.init, 0).replace(/;$/, '') : '';
        const cond = st.cond ? this.cond(st.cond, 'for') : '';
        const upd = st.update ? this.stmt(st.update, 0).replace(/;$/, '') : '';
        const s = `for (${init}; ${cond}; ${upd}) {\n${this.block(st.body, 1)}}`;
        this.scopes.pop(); return s;
      }
      case 'while': return `while (${this.cond(st.cond, 'while')}) {\n${this.block(st.body, 1)}}`;
      case 'break': case 'continue': case 'discard': return `${st.s};`;
      case 'return': {
        const want = this.retType;
        if (!want) { if (st.x) this.err('a hook does not return a value', st.tok, 'assign to the hook\'s output instead (e.g. color = …;)'); return 'return;'; }
        if (!st.x) { if (want.k !== 'void') this.err(`return needs a ${typeName(want)}`, st.tok, 'return a value'); return 'return;'; }
        const [x, t] = this.expr(st.x); this.assignable(want, t, st.tok);
        return `return ${this.emitAs(st.x, x, t, want)};`;
      }
      case 'block': return `{\n${this.block(st.body, 1)}}`;
    }
  }
  private cond(e: Expr, what: string): string { const [x, t] = this.expr(e); if (!(t.k === 'scalar' && t.s === 'bool')) this.err(`the ${what} condition is a ${typeName(t)}, not a bool`, e.tok, 'compare it: x > 0.0'); return x; }
  private lvalue(e: Expr): [string, Type] {
    let root = e; while (root.e === 'member' || root.e === 'index') root = root.of;
    if (root.e !== 'id') this.err('you can only assign to a variable', e.tok, 'assign to a var');
    const s = this.lookup(root.name);
    if (!s) this.unknown(root.name, root.tok);
    if (!s.mutable) this.err(`'${root.name}' cannot be changed (${s.type.k === 'struct' ? 'a uniform' : 'a let, const or input'})`, e.tok, `declare it with var, or use a new var`);
    if (e.e === 'member' && e.name.length > 1 && /^[xyzwrgba]+$/.test(e.name)) this.err(`assigning to several components at once (.${e.name}) is not allowed in WGSL`, e.tok, `assign the whole vector: v = vec…(…)`);
    return this.expr(e);
  }
  private unknown(n: string, tok: Tok): never {
    const near = this.names().concat(Object.keys(BUILTINS)).filter((x) => lev(x, n) <= 2).sort((a, b) => lev(a, n) - lev(b, n))[0];
    return this.err(`unknown name '${n}'`, tok, near ? `did you mean '${near}'?` : `the names you can use here: ${this.names().join(', ') || 'none'}`);
  }
  /** an abstract literal's own concrete type (WGSL: AbstractInt → i32, AbstractFloat → f32) */
  private concretize(t: Type): Type { return isAbstract(t) ? S((t as { s: Scalar }).s) : t; }
  private assignable(to: Type, from: Type, tok: Tok): void {
    if (same(to, from)) return;
    if (isAbstract(from) && to.k === 'scalar' && to.s !== 'bool' && (from as { s: Scalar }).s !== 'bool') { if ((from as { s: Scalar }).s === 'f32' && to.s !== 'f32') this.err(`a float literal cannot become ${to.s}`, tok, 'write an integer'); return; }
    this.err(`expected ${typeName(to)}, got ${typeName(from)}`, tok, from.k === 'scalar' && to.k === 'vec' ? `write ${typeName(to)}(x)` : `convert it: ${typeName(to)}(…)`);
  }
  /** the GLSL of an expression already written as `x` with type `t`, as type `to` (literals rewritten: 1 → 1.0) */
  private emitAs(e: Expr, x: string, t: Type, to: Type): string {
    if (!isAbstract(t)) return x;
    return lit(e, scalarOf(to) ?? 'f32');
  }

  /** [glsl, type] */
  expr(e: Expr): [string, Type] {
    switch (e.e) {
      case 'num': return numType(e);
      case 'bool': return [String(e.v), BOOL];
      case 'id': { const s = this.lookup(e.name); if (!s) this.unknown(e.name, e.tok); return [s.glsl, s.type]; }
      case 'member': {
        const [x, t] = this.expr(e.of);
        if (t.k === 'struct') { const m = t.members[e.name]; if (!m) this.err(`'${t.name}' has no '${e.name}'`, e.tok, `it has: ${Object.keys(t.members).join(', ')}`); return [`${x}.${e.name}`, m]; }
        if (t.k === 'vec') {
          if (!/^([xyzw]{1,4}|[rgba]{1,4})$/.test(e.name)) this.err(`'.${e.name}' is not a swizzle`, e.tok, 'use x y z w or r g b a, up to four');
          const idx = [...e.name].map((c) => 'xyzwrgba'.indexOf(c) % 4);
          if (idx.some((i) => i >= t.n)) this.err(`a vec${t.n} has no '.${e.name}'`, e.tok, `use up to ${'xyzw'[t.n - 1]}`);
          return [`${paren(x)}.${e.name}`, e.name.length === 1 ? S(t.s) : V(e.name.length as 2 | 3 | 4, t.s)];
        }
        return this.err(`a ${typeName(t)} has no members`, e.tok, 'check the name before the dot');
      }
      case 'index': {
        const [x, t] = this.expr(e.of), [i, it] = this.expr(e.i);
        if (!(it.k === 'scalar' && (it.s === 'i32' || it.s === 'u32'))) this.err('an index must be an integer', e.i.tok, 'write i32(x)');
        const ii = isAbstract(it) ? lit(e.i, 'i32') : i;
        if (t.k === 'vec') return [`${paren(x)}[${ii}]`, S(t.s)];
        if (t.k === 'mat') return [`${paren(x)}[${ii}]`, V(t.r)];
        if (t.k === 'array') return [`${paren(x)}[${ii}]`, t.of];
        return this.err(`a ${typeName(t)} cannot be indexed`, e.tok, 'index vectors, matrices or arrays');
      }
      case 'unary': {
        const [x, t] = this.expr(e.x);
        if (e.op === '-') { if (scalarOf(t) === 'bool' || scalarOf(t) === 'u32') this.err(`cannot negate a ${typeName(t)}`, e.tok, 'use a signed type'); return [`-${paren(x)}`, t]; }
        if (e.op === '!') { if (scalarOf(t) !== 'bool') this.err(`! needs a bool, got ${typeName(t)}`, e.tok, 'compare first'); return [t.k === 'vec' ? `not(${x})` : `!${paren(x)}`, t]; }
        if (scalarOf(t) !== 'i32' && scalarOf(t) !== 'u32') this.err('~ needs an integer', e.tok, 'use i32 or u32');
        return [`~${paren(x)}`, t];
      }
      case 'binary': {
        const [a, at] = this.expr(e.a), [b, bt] = this.expr(e.b);
        // abstract literals take the other side's scalar type
        const sa = scalarOf(at)!, sb = scalarOf(bt)!;
        const at2 = isAbstract(at) && !isAbstract(bt) ? concrete(at, sb) : at, bt2 = isAbstract(bt) && !isAbstract(at) ? concrete(bt, sa) : bt;
        const a2 = at2 !== at ? lit(e.a, sb) : a, b2 = bt2 !== bt ? lit(e.b, sa) : b;
        if (isAbstract(at) && isAbstract(bt)) {
          // both literals: float if either is
          // (float if either is. Integer + - * stay abstract, written again for the context they land in; anything
          // else takes its concrete type, as WGSL would evaluate it)
          const f = sa === 'f32' || sb === 'f32';
          const [x, t] = this.binaryOf(e.op, f ? lit(e.a, 'f32') : a, S(f ? 'f32' : sa), f ? lit(e.b, 'f32') : b, S(f ? 'f32' : sb), e.tok);
          return [x, !f && ['+', '-', '*'].includes(e.op) && t.k === 'scalar' && t.s === 'i32' ? S('i32', true) : t];
        }
        return this.binaryOf(e.op, a2, at2, b2, bt2, e.tok);
      }
      case 'call': return this.call(e);
    }
  }
  private binaryOf(op: string, a: string, at: Type, b: string, bt: Type, tok: Tok): [string, Type] {
    const sa = scalarOf(at), sb = scalarOf(bt);
    if (op === '&&' || op === '||') {
      if (!(at.k === 'scalar' && at.s === 'bool' && bt.k === 'scalar' && bt.s === 'bool')) this.err(`${op} needs two bools`, tok, 'compare first; for vectors of bools use all() / any() / select()');
      return [`${paren(a)} ${op} ${paren(b)}`, BOOL];
    }
    if (['==', '!=', '<', '<=', '>', '>='].includes(op)) {
      if (!same(at, bt) && !(at.k === 'scalar' && bt.k === 'scalar' && sa === sb)) this.err(`cannot compare ${typeName(at)} with ${typeName(bt)}`, tok, 'convert one side');
      if (at.k === 'vec') { const f = { '==': 'equal', '!=': 'notEqual', '<': 'lessThan', '<=': 'lessThanEqual', '>': 'greaterThan', '>=': 'greaterThanEqual' }[op]!; return [`${f}(${a}, ${b})`, V(at.n, 'bool')]; }
      return [`${paren(a)} ${op} ${paren(b)}`, BOOL];
    }
    if (sa === 'bool' || sb === 'bool') { if (['&', '|', '^'].includes(op) && at.k === 'scalar' && bt.k === 'scalar') return [`${paren(a)} ${op === '&' ? '&&' : op === '|' ? '||' : '^^'} ${paren(b)}`, BOOL]; this.err(`${op} does not work on bools`, tok, 'use && or ||'); }
    if (['&', '|', '^', '<<', '>>'].includes(op)) {
      if ((sa !== 'i32' && sa !== 'u32') || (sb !== 'i32' && sb !== 'u32')) this.err(`${op} needs integers`, tok, 'use i32 or u32');
      return [`${paren(a)} ${op} ${paren(b)}`, at.k === 'vec' ? at : bt.k === 'vec' && op !== '<<' && op !== '>>' ? bt : at];
    }
    if (sa !== sb) this.err(`cannot mix ${typeName(at)} and ${typeName(bt)} in ${op}`, tok, `convert one: ${sa === 'f32' ? 'f32(…)' : `${sa}(…)`}`);
    let rt: Type;
    if (at.k === 'mat' || bt.k === 'mat') {
      if (op !== '*' && !(op !== '/' && op !== '%' && same(at, bt))) this.err(`${op} is not defined for matrices here`, tok, 'use * (matrix × vector, matrix × matrix)');
      if (at.k === 'mat' && bt.k === 'vec') { if (at.c !== bt.n) this.err(`mat${at.c}x${at.r} × vec${bt.n}: sizes differ`, tok, 'match the sizes'); rt = V(at.r); }
      else if (at.k === 'vec' && bt.k === 'mat') { if (bt.r !== at.n) this.err('vector × matrix: sizes differ', tok, 'match the sizes'); rt = V(bt.c); }
      else if (at.k === 'mat' && bt.k === 'mat') { if (at.c !== bt.r) this.err('matrix × matrix: sizes differ', tok, 'match the sizes'); rt = { k: 'mat', c: bt.c, r: at.r }; }
      else rt = at.k === 'mat' ? at : bt;
    } else if (at.k === 'vec' && bt.k === 'vec') { if (at.n !== bt.n) this.err(`cannot ${op} a vec${at.n} and a vec${bt.n}`, tok, 'use a swizzle to match sizes (.xyz)'); rt = at; }
    else if (at.k === 'vec') rt = at;
    else if (bt.k === 'vec') rt = bt;
    else rt = isAbstract(at) && isAbstract(bt) ? at : S(sa!);
    if (op === '%' && sa === 'f32') return [`(${a} - ${paren(b)} * trunc(${paren(a)} / ${paren(b)}))`, rt];
    return [`${paren(a)} ${op} ${paren(b)}`, rt];
  }
  private call(e: Extract<Expr, { e: 'call' }>): [string, Type] {
    const name = e.name;
    // constructors and conversions
    const ctor = e.targs ?? ctorType(name);
    if (ctor) {
      if (ctor.k === 'struct' || ctor.k === 'void') this.err(`cannot construct ${name}`, e.tok, 'use a vector or scalar');
      const want = ctor.k === 'array' ? scalarOf(ctor.of) ?? 'f32' : scalarOf(ctor) ?? 'f32';
      const args = e.args.map((a) => { const [x, t] = this.expr(a); return isAbstract(t) ? [lit(a, ctor.k === 'scalar' ? (t as { s: Scalar }).s === 'f32' && ctor.s !== 'f32' ? 'f32' : ctor.s : want), S(want)] as [string, Type] : [x, t] as [string, Type]; });
      if (ctor.k === 'scalar') {
        if (args.length !== 1) this.err(`${name}(…) takes one value`, e.tok, `write ${name}(x)`);
        if (args[0]![1].k !== 'scalar') this.err(`${name}(…) takes a scalar, got ${typeName(args[0]![1])}`, e.tok, 'pick a component: v.x');
        return [`${glslType(ctor)}(${args[0]![0]})`, ctor];
      }
      if (!args.length) return [zero(ctor), ctor];
      if (ctor.k === 'vec') {
        const n = args.reduce((s, [, t]) => s + (t.k === 'scalar' ? 1 : t.k === 'vec' ? t.n : 99), 0);
        if (!(n === ctor.n || (args.length === 1 && args[0]![1].k === 'scalar'))) this.err(`${name}(…) needs ${ctor.n} components, got ${n}`, e.tok, `give ${ctor.n} numbers, or one to fill all`);
      }
      if (ctor.k === 'array' && args.length !== ctor.n) this.err(`${name}(…) needs ${ctor.n} values, got ${args.length}`, e.tok, `give ${ctor.n}`);
      return [`${glslType(ctor)}(${args.map((a) => a[0]).join(', ')})`, ctor];
    }
    const user = this.fns.get(name);
    if (user) {
      if (user.params.length !== e.args.length) this.err(`${name}(…) takes ${user.params.length} values, got ${e.args.length}`, e.tok, 'match the function');
      const args = e.args.map((a, i) => { const [x, t] = this.expr(a); this.assignable(user.params[i]!, t, a.tok); return this.emitAs(a, x, t, user.params[i]!); });
      return [`${safeName(name)}(${args.join(', ')})`, user.ret];
    }
    const b = BUILTINS[name];
    if (!b) {
      if (/^texture/.test(name)) this.err(`'${name}': textures are not in the shader subset yet`, e.tok, 'use the inputs the hook gives');
      return this.unknown(name, e.tok);
    }
    if (!b.argc.includes(e.args.length)) this.err(`${name}(…) takes ${b.argc.join(' or ')} values, got ${e.args.length}`, e.tok, `see the WGSL built-in ${name}`);
    const raw = e.args.map((a) => this.expr(a));
    // the call's scalar: float if any argument is (or any literal is a float), else the first concrete one
    const conc = raw.find(([, t]) => !isAbstract(t));
    const s: Scalar = raw.some(([, t]) => scalarOf(t) === 'f32') ? 'f32' : conc ? scalarOf(conc[1])! : 'f32';
    const args = raw.map(([x, t], i) => (isAbstract(t) ? [lit(e.args[i]!, s), S(s)] as [string, Type] : [x, t] as [string, Type]));
    const ts = args.map((a) => a[1]), xs = args.map((a) => a[0]);
    const bad = (why: string): never => this.err(`${name}(${ts.map(typeName).join(', ')}): ${why}`, e.tok, `see the WGSL built-in ${name}`);
    const widest = ts.find((t) => t.k === 'vec') ?? ts[0]!;
    switch (b.rule) {
      case 'same': {
        if (ts.some((t) => t.k !== 'scalar' && t.k !== 'vec')) bad('needs scalars or vectors');
        if (ts.some((t) => !same(t, ts[0]!))) bad('all values must be the same type');
        if (!['abs', 'min', 'max', 'sign'].includes(name) && scalarOf(ts[0]!) !== 'f32') bad('needs floats');
        return [`${b.glsl}(${xs.join(', ')})`, ts[0]!];
      }
      case 'mixlike': {
        // mix / clamp / smoothstep / step may take scalars for the edges / the amount
        if (ts.some((t) => t.k !== 'scalar' && t.k !== 'vec')) bad('needs scalars or vectors');
        if (ts.some((t) => scalarOf(t) !== scalarOf(widest))) bad('mixed scalar types');
        if (ts.some((t) => t.k === 'vec' && !same(t, widest))) bad('vectors of different sizes');
        if (name !== 'clamp' && scalarOf(widest) !== 'f32') bad('needs floats');
        // WGSL wants the same type throughout (except mix's amount); GLSL accepts the scalar forms: write vectors
        // where WGSL would have them, so both agree
        const fixed = xs.map((x, i) => (ts[i]!.k === 'scalar' && widest.k === 'vec' && !(name === 'mix' && i === 2) && !(name === 'smoothstep' && i < 2) && !(name === 'step' && i === 0) && !(name === 'clamp' && i > 0) ? `${glslType(widest)}(${x})` : x));
        return [`${b.glsl}(${fixed.join(', ')})`, widest];
      }
      case 'scalar': if (ts.some((t) => !isFloaty(t) || t.k === 'mat')) bad('needs float vectors'); return [`${b.glsl}(${xs.join(', ')})`, F32];
      case 'cross': if (!ts.every((t) => t.k === 'vec' && t.n === 3 && t.s === 'f32')) bad('needs two vec3f'); return [`cross(${xs.join(', ')})`, V(3)];
      case 'bool': if (scalarOf(ts[0]!) !== 'bool') bad('needs bools'); return [`${b.glsl}(${xs[0]})`, BOOL];
      case 'select': {
        const [f, t, c] = ts as [Type, Type, Type];
        if (!same(f, t)) bad('the first two values must be the same type');
        if (c.k === 'scalar' && c.s === 'bool') return [`(${xs[2]} ? ${xs[1]} : ${xs[0]})`, f];
        if (c.k === 'vec' && c.s === 'bool' && f.k === 'vec' && f.n === c.n) return [`mix(${xs[0]}, ${xs[1]}, ${xs[2]})`, f];
        return bad('the condition must be a bool (or a vector of bools of the same size)');
      }
      case 'transpose': if (ts[0]!.k !== 'mat') bad('needs a matrix'); return [`transpose(${xs[0]})`, { k: 'mat', c: (ts[0] as { r: 2 }).r, r: (ts[0] as { c: 2 }).c }];
      case 'det': if (ts[0]!.k !== 'mat') bad('needs a square matrix'); return [`determinant(${xs[0]})`, F32];
      case 'fma': if (ts.some((t) => !same(t, ts[0]!) || !isFloaty(t))) bad('needs three floats of one type'); return [`(${paren(xs[0]!)} * ${paren(xs[1]!)} + ${paren(xs[2]!)})`, ts[0]!];
      case 'saturate': if (!isFloaty(ts[0]!)) bad('needs floats'); return [`clamp(${xs[0]}, ${glslType(ts[0]!)}(0.0), ${glslType(ts[0]!)}(1.0))`, ts[0]!];
      case 'atan2': if (!same(ts[0]!, ts[1]!) || !isFloaty(ts[0]!)) bad('needs two floats of one type'); return [`atan(${xs[0]}, ${xs[1]})`, ts[0]!];
      case 'bitcast': return bad('not in the subset');
    }
  }
}

function ctorType(name: string): Type | null {
  if (name === 'f32' || name === 'i32' || name === 'u32' || name === 'bool') return S(name);
  let m = /^vec([234])([fiu])$/.exec(name);
  if (m) return V(+m[1]! as 2, ({ f: 'f32', i: 'i32', u: 'u32' } as const)[m[2] as 'f']);
  m = /^mat([234])x([234])f$/.exec(name);
  if (m) return { k: 'mat', c: +m[1]! as 2, r: +m[2]! as 2 };
  return null;
}
function numType(e: Extract<Expr, { e: 'num' }>): [string, Type] {
  const v = e.v;
  if (/[uU]$/.test(v)) return [`${/^0x/i.test(v) ? v.slice(0, -1) : String(parseInt(v, 10))}u`, S('u32')];
  if (/i$/.test(v)) return [v.slice(0, -1), S('i32')];
  if (/h$/.test(v)) throw new ShaderError(`'${v}': 16-bit floats are not in the shader subset`, e.tok.line, e.tok.col, 'drop the h');
  if (/f$/.test(v) && !/^0x/i.test(v)) return [floatLit(v.slice(0, -1)), F32];
  if (/^0x/i.test(v)) return [v, S('i32', true)];
  if (/[.eE]/.test(v)) return [floatLit(v), S('f32', true)];
  return [v, S('i32', true)];
}
/** a literal written for a scalar type (AbstractInt 1 as a float: 1.0) */
function lit(e: Expr, s: Scalar): string {
  if (e.e === 'unary' && e.op === '-') return `-${lit(e.x, s)}`;
  if (e.e !== 'num') return e.e === 'binary' ? `(${lit(e.a, s)} ${e.op} ${lit(e.b, s)})` : '0';
  const v = e.v.replace(/[fiu]$/, ''), n = /^0x/i.test(v) ? parseInt(v, 16) : Number(v);
  if (s === 'f32') return floatLit(String(n));
  if (s === 'u32') return `${Math.trunc(n)}u`;
  return String(Math.trunc(n));
}
const floatLit = (v: string) => (/[.eE]/.test(v) ? (v.startsWith('.') ? `0${v}` : v.endsWith('.') ? `${v}0` : v) : `${v}.0`);
const paren = (x: string) => (/^[\w.[\]]+$/.test(x) || /^[\w]+\(.*\)$/.test(x) && balanced(x) ? x : `(${x})`);
function balanced(x: string): boolean { let d = 0; for (let i = 0; i < x.length; i++) { if (x[i] === '(') d++; else if (x[i] === ')') { d--; if (d === 0 && i < x.length - 1) return false; } } return d === 0; }
function zero(t: Type): string {
  switch (t.k) {
    case 'scalar': return t.s === 'f32' ? '0.0' : t.s === 'u32' ? '0u' : t.s === 'bool' ? 'false' : '0';
    case 'vec': return `${glslType(t)}(${zero(S(t.s))})`;
    case 'mat': return `${glslType(t)}(0.0)`;
    case 'array': return `${glslType(t)}(${Array.from({ length: t.n }, () => zero(t.of)).join(', ')})`;
    default: return '0';
  }
}
function returns(body: Stmt[]): boolean {
  const last = body[body.length - 1];
  if (!last) return false;
  if (last.s === 'return' || last.s === 'discard') return true;
  if (last.s === 'if') return !!last.else && returns(last.then) && returns(last.else);
  if (last.s === 'block') return returns(last.body);
  return false;
}
function lev(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) d[0]![j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length]![b.length]!;
}

// ── the public functions ─────────────────────────────────────────────────────────────────────────────────────────
export interface Translated { glsl: string; functions: FnSig[] }
/** statements (a hook's body): checked against the scope, written as GLSL statements */
export function translateStatements(src: string, scope: ScopeSpec, o: { where?: string; line?: number; indent?: number } = {}): Translated {
  const p = new Parser(lex(src, o.line ?? 0), o.where ?? '');
  const body = p.statements(), c = new Checker(o.where ?? '', scope);
  return { glsl: c.statements(body, o.indent ?? 1), functions: c.sigs() };
}
/** functions and consts (your helpers): written as GLSL, and their signatures for the statements that call them */
export function translateModule(src: string, scope: ScopeSpec = {}, o: { where?: string; line?: number } = {}): Translated {
  const p = new Parser(lex(src, o.line ?? 0), o.where ?? '');
  const m = p.module(), c = new Checker(o.where ?? '', scope);
  return { glsl: c.module(m), functions: c.sigs().filter((f) => m.fns.some((x) => x.name === f.name)) };
}
/** the std140 / WGSL-uniform layout of a list of members (identical for f32, i32, u32, vecN, mat4x4f) */
export function uniformLayout(members: [string, Type][]): { offsets: Record<string, number>; size: number } {
  let o = 0; const offsets: Record<string, number> = {};
  for (const [n, t] of members) {
    const [align, size] = t.k === 'scalar' ? [4, 4] : t.k === 'vec' ? [t.n === 2 ? 8 : 16, t.n * 4] : t.k === 'mat' && t.c === 4 && t.r === 4 ? [16, 64] : [0, 0];
    if (!align) throw new AslnutError('E-SHADER-001', `a param of type ${typeName(t)} cannot be a uniform yet`, { where: n, fix: 'use f32, i32, u32, vec2f, vec3f, vec4f or mat4x4f' });
    o = Math.ceil(o / align) * align; offsets[n] = o; o += size;
  }
  return { offsets, size: Math.max(16, Math.ceil(o / 16) * 16) };
}
