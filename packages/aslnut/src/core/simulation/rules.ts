// core › simulation › rules and kernels: how a field steps. A rule carries its kernel for the chip (WGSL and its GLSL
// twin: the ready ones are in core/render/graphics/shaders/field.*.ts) and the same arithmetic for the CPU (where the chip has
// no float targets, or no kernel was given). A cell holds four numbers; most rules step the first and keep the rest.
//   rules.diffusion({ k: 0.2 })                      the first number spreads (m²/s)
//   rules.advection({ wind: [3, -1] })               carried by a wind (m/s east, north), or by an input field
//   rules.heat({ k: 0.1, relax: 1 / 3600, to: 20 })  spreads, relaxes towards a value (or an input), plus a source
//   rules.shallowWater({ friction: 0.03 })           water on the ground (input 'ground'): depth, fluxes (pipe model)
//   rules.flow({ rain: 'rain' })                     overland flow: the same water, slower, rain falling on it
//   rules.custom((cur, n, dt, p) => cur + dt * p.k * n.laplacian, { params: { k: 0.2 } })   your function (CPU)
//   { wgsl: 'next = cur + dt * k * laplacian(cur);', params: { k: 0.2 } }                  your kernel (chip + CPU)
import { AslnutError } from '../world/errors.ts';

/** what a CPU step reads: the grid before, the inputs, the numbers */
export interface CpuGrid {
  w: number; h: number; cell: number; dt: number;
  /** the state, four numbers a cell, row 0 north */
  cur: Float32Array;
  /** the inputs in the rule's order (four numbers a cell; a missing one: zeros) */
  inputs: Float32Array[];
  /** the rule's 16 numbers (p0 … p3 of the kernel) */
  p: Float32Array;
}
export interface Rule {
  readonly name: string;
  /** the kernel: the WGSL and GLSL texts defining `rule` (vec4 in, vec4 out); none: CPU only */
  readonly wgsl?: string; readonly glsl?: string;
  /** one cell's next state into out[o … o + 3] */
  cpu(g: CpuGrid, i: number, j: number, out: Float32Array, o: number): void;
  /** the names of its inputs, in their slots (at most four) */
  readonly inputs: readonly string[];
  /** its numbers by name → slot (0 … 15) and value */
  readonly params: Readonly<Record<string, { slot: number; value: number }>>;
  /** the longest stable step (s) for a cell of `cell` metres and these numbers */
  maxDt(cell: number, p: Float32Array): number;
  /** what its four numbers are (for probes and drawing): the first is the field's value */
  readonly channels: readonly string[];
}

// the CPU's twins of the kernel helpers (field.wgsl.ts): clamped reads, so the two paths agree cell for cell
const tex = (a: Float32Array, w: number, h: number, i: number, j: number, ch: number): number => a[((Math.max(0, Math.min(h - 1, j)) * w + Math.max(0, Math.min(w - 1, i))) << 2) + ch]!;
const inside = (g: CpuGrid, i: number, j: number) => (i >= 0 && j >= 0 && i < g.w && j < g.h ? 1 : 0);
const lap = (g: CpuGrid, i: number, j: number) => { const c = tex(g.cur, g.w, g.h, i, j, 0); return (tex(g.cur, g.w, g.h, i + 1, j, 0) + tex(g.cur, g.w, g.h, i - 1, j, 0) + tex(g.cur, g.w, g.h, i, j + 1, 0) + tex(g.cur, g.w, g.h, i, j - 1, 0) - 4 * c) / (g.cell * g.cell); };
const keep = (g: CpuGrid, i: number, j: number, out: Float32Array, o: number, x: number) => { const k = (j * g.w + i) << 2; out[o] = x; out[o + 1] = g.cur[k + 1]!; out[o + 2] = g.cur[k + 2]!; out[o + 3] = g.cur[k + 3]!; };
const sampleAt = (g: CpuGrid, px: number, py: number, ch: number) => {
  const qx = Math.max(0, Math.min(g.w - 1, px)), qy = Math.max(0, Math.min(g.h - 1, py)), i = Math.floor(qx), j = Math.floor(qy), fx = qx - i, fy = qy - j;
  const a = tex(g.cur, g.w, g.h, i, j, ch), b = tex(g.cur, g.w, g.h, i + 1, j, ch), c = tex(g.cur, g.w, g.h, i, j + 1, ch), d = tex(g.cur, g.w, g.h, i + 1, j + 1, ch);
  return (a + (b - a) * fx) + ((c + (d - c) * fx) - (a + (b - a) * fx)) * fy;
};
const mixf = (a: number, b: number, t: number) => a + (b - a) * t;
const zero = (g: CpuGrid, k: number) => g.inputs[k] ?? null;
const inp = (g: CpuGrid, k: number, i: number, j: number, ch: number) => { const a = zero(g, k); return a ? tex(a, g.w, g.h, i, j, ch) : 0; };

type Spec = Record<string, number>;
const slots = (names: string[], values: Spec, given: Spec = {}): Record<string, { slot: number; value: number }> => {
  const out: Record<string, { slot: number; value: number }> = {};
  names.forEach((n, slot) => { if (n) out[n] = { slot, value: given[n] ?? values[n] ?? 0 }; });
  return out;
};
const preset = (name: string, fn: string, params: Record<string, { slot: number; value: number }>, inputs: string[], channels: string[], cpu: Rule['cpu'], maxDt: Rule['maxDt']): Rule => ({
  name, params, inputs, channels, cpu, maxDt,
  wgsl: `fn rule(c: vec4f) -> vec4f { return ${fn}(c); }`,
  glsl: `vec4 rule(vec4 c) { return ${fn}(c); }`,
});

/** the ready rules (each with its kernel on the chip and its CPU twin) */
export const rules = {
  /** the first number spreads: next = cur + dt · k · ∇²cur (k m²/s) */
  diffusion(o: { k?: number } = {}): Rule {
    return preset('diffusion', 'ruleDiffusion', slots(['k'], { k: 0.2 }, o as Spec), [], ['value'],
      (g, i, j, out, q) => keep(g, i, j, out, q, tex(g.cur, g.w, g.h, i, j, 0) + g.dt * g.p[0]! * lap(g, i, j)),
      (cell, p) => (0.2 * cell * cell) / Math.max(1e-9, p[0]!));
  },
  /** carried by a wind: [u, v] m/s (east, north), or the input 'wind' (its first two numbers) when `wind: 'input'` */
  advection(o: { wind?: [number, number] | 'input' } = {}): Rule {
    const w = Array.isArray(o.wind) ? o.wind : [0, 0], fromInput = o.wind === 'input' ? 1 : 0;
    return preset('advection', 'ruleAdvection', slots(['windEast', 'windNorth', 'windFromInput'], { windEast: w[0]!, windNorth: w[1]!, windFromInput: fromInput }), ['wind'], ['value'],
      (g, i, j, out, q) => {
        const wx = mixf(g.p[0]!, inp(g, 0, i, j, 0), g.p[2]!), wy = mixf(g.p[1]!, inp(g, 0, i, j, 1), g.p[2]!);
        keep(g, i, j, out, q, sampleAt(g, i - (wx * g.dt) / g.cell, j + (wy * g.dt) / g.cell, 0));
      },
      (cell, p) => (0.9 * cell) / Math.max(1e-6, Math.hypot(p[0]!, p[1]!), p[2]! > 0.5 ? 30 : 0));
  },
  /** heat: spreads (k m²/s), relaxes towards `to` (a number, or the input 'target' when 'input') at `relax` per s,
   *  plus the input 'source' × `sourceScale` per s */
  heat(o: { k?: number; relax?: number; to?: number | 'input'; sourceScale?: number } = {}): Rule {
    const fromInput = o.to === 'input' ? 1 : 0, to = typeof o.to === 'number' ? o.to : 0;
    return preset('heat', 'ruleHeat', slots(['k', 'relax', 'to', 'toFromInput', 'sourceScale'], { k: 0.1, relax: 0, to, toFromInput: fromInput, sourceScale: 1 }, { ...(o.k !== undefined ? { k: o.k } : {}), ...(o.relax !== undefined ? { relax: o.relax } : {}), ...(o.sourceScale !== undefined ? { sourceScale: o.sourceScale } : {}) }), ['target', 'source'], ['temperature'],
      (g, i, j, out, q) => {
        const c = tex(g.cur, g.w, g.h, i, j, 0), target = mixf(g.p[2]!, inp(g, 0, i, j, 0), g.p[3]!), src = inp(g, 1, i, j, 0) * g.p[4]!;
        keep(g, i, j, out, q, c + g.dt * (g.p[0]! * lap(g, i, j) + g.p[1]! * (target - c) + src));
      },
      (cell, p) => Math.min((0.2 * cell * cell) / Math.max(1e-9, p[0]!), p[1]! > 0 ? 0.05 / p[1]! : Infinity));
  },
  /** water on the ground (the pipe model): depth (m), the flux east and south (m³/s); the input 'ground' (m), rain
   *  `rain` m/s plus the input 'rain' × `rainScale`; friction per s; gravity; `openEdges`: the water runs out past
 *  the grid's edge (default: walls) */
  shallowWater(o: { friction?: number; gravity?: number; rain?: number; rainScale?: number; openEdges?: boolean } = {}): Rule {
    return water('shallowWater', { friction: 0.03, gravity: 9.81, rain: 0, rainScale: 1, openEdges: false, ...o });
  },
  /** overland flow: water running off the ground, slowed by the surface (more friction), rain falling on it */
  flow(o: { friction?: number; gravity?: number; rain?: number; rainScale?: number; openEdges?: boolean } = {}): Rule {
    return water('flow', { friction: 0.5, gravity: 9.81, rain: 0, rainScale: 1, openEdges: true, ...o });
  },
  /** your function of a cell (CPU only): next = fn(cur, n, dt, p); n: { laplacian, neighbours [e, s, w, n], inputs } */
  custom(fn: (cur: number, n: { laplacian: number; neighbours: [number, number, number, number]; inputs: Record<string, number> }, dt: number, p: Record<string, number>) => number, o: { params?: Record<string, number>; inputs?: string[]; maxDt?: number } = {}): Rule {
    if (typeof fn !== 'function') throw new AslnutError('E-DATA-001', 'rules.custom needs a function (cur, n, dt, p) => next', { fix: 'rules.custom((c, n, dt, p) => c + dt * p.k * n.laplacian, { params: { k: 0.2 } })' });
    const names = Object.keys(o.params ?? {}).slice(0, 16), inputs = (o.inputs ?? []).slice(0, 4), p: Record<string, number> = {};
    return {
      name: 'custom', inputs, channels: ['value'], params: slots(names, o.params ?? {}),
      cpu(g, i, j, out, q) {
        names.forEach((n, k) => { p[n] = g.p[k]!; });
        const ins: Record<string, number> = {}; inputs.forEach((n, k) => { ins[n] = inp(g, k, i, j, 0); });
        const nb: [number, number, number, number] = [tex(g.cur, g.w, g.h, i + 1, j, 0), tex(g.cur, g.w, g.h, i, j + 1, 0), tex(g.cur, g.w, g.h, i - 1, j, 0), tex(g.cur, g.w, g.h, i, j - 1, 0)];
        keep(g, i, j, out, q, fn(tex(g.cur, g.w, g.h, i, j, 0), { laplacian: lap(g, i, j), neighbours: nb, inputs: ins }, g.dt, p));
      },
      maxDt: () => o.maxDt ?? 1,
    };
  },
};
function water(name: string, o: { friction: number; gravity: number; rain: number; rainScale: number; openEdges: boolean }): Rule {
  const params = slots(['gravity', 'friction', 'rain', 'openEdges', 'rainScale'], { gravity: o.gravity, friction: o.friction, rain: o.rain, openEdges: o.openEdges ? 1 : 0, rainScale: o.rainScale });
  // the flux from a cell holding depth a (ground ga) to one holding b (ground gb), f before (field.wgsl.ts: pipe)
  const pipe = (g: CpuGrid, a: number, b: number, f: number, ga: number, gb: number) => {
    const face = Math.max(0, Math.max(ga + a, gb + b) - Math.max(ga, gb));
    const q = f * Math.max(0, 1 - g.p[1]! * g.dt) + (g.dt * g.p[0]! * face * g.cell * ((ga + a) - (gb + b))) / g.cell, cap = (g.cell * g.cell) / (4 * g.dt);
    return Math.max(-b * cap, Math.min(a * cap, q));
  };
  return preset(name, 'ruleWater', params, ['ground', 'rain'], ['depth', 'flux east', 'flux south', ''],
    (g, i, j, out, q) => {
      const W = g.w, H = g.h, C = g.cur, open = g.p[3]!, gr = (x: number, y: number) => inp(g, 0, x, y, 0), d = (x: number, y: number, ch: number) => tex(C, W, H, x, y, ch);
      const c = d(i, j, 0), gc = gr(i, j), ie = inside(g, i + 1, j), is = inside(g, i, j + 1), iw = inside(g, i - 1, j), jn = inside(g, i, j - 1);
      const qe = pipe(g, c, d(i + 1, j, 0) * ie, d(i, j, 1), gc, mixf(gc, gr(i + 1, j), ie)) * Math.max(ie, open);
      const qs = pipe(g, c, d(i, j + 1, 0) * is, d(i, j, 2), gc, mixf(gc, gr(i, j + 1), is)) * Math.max(is, open);
      const qw = pipe(g, d(i - 1, j, 0) * iw, c, d(i - 1, j, 1) * iw, mixf(gc, gr(i - 1, j), iw), gc) * Math.max(iw, open);
      const qn = pipe(g, d(i, j - 1, 0) * jn, c, d(i, j - 1, 2) * jn, mixf(gc, gr(i, j - 1), jn), gc) * Math.max(jn, open);
      const rain = g.p[2]! + inp(g, 1, i, j, 0) * g.p[4]!;
      out[q] = Math.max(0, c + g.dt * ((qw + qn - qe - qs) / (g.cell * g.cell) + rain)); out[q + 1] = qe; out[q + 2] = qs; out[q + 3] = 0;
    },
    // a wave's speed √(g·h) for a metre of water: a quarter of a cell a step
    (cell, p) => (0.25 * cell) / Math.sqrt(Math.max(1e-6, p[0]!)));
}

/** your kernel: the body sets `next` from `cur` (the first number), `dt`, `cell`, your numbers by name, and the
 *  helpers laplacian(cur), at(dx, dy), in0…in3(dx, dy); WGSL and GLSL alike when it is expressions only (`glsl` for a
 *  body that is not); `cpu` the same on the CPU, where the chip cannot step it (a kernel without one runs on chips only) */
export interface Kernel {
  wgsl: string; glsl?: string;
  cpu?: (cur: number, n: { laplacian: number; neighbours: [number, number, number, number]; inputs: Record<string, number> }, dt: number, p: Record<string, number>) => number;
  params?: Record<string, number>; inputs?: string[]; maxDt?: number;
}
export function kernel(k: Kernel): Rule {
  if (typeof k?.wgsl !== 'string') throw new AslnutError('E-DATA-001', 'a kernel needs its WGSL body (it sets next)', { fix: "{ wgsl: 'next = cur + dt * k * laplacian(cur);', params: { k: 0.2 } }" });
  const names = Object.keys(k.params ?? {}).slice(0, 16), at = (n: number) => `u.p${n >> 2}.${'xyzw'[n & 3]}`;
  const base = k.cpu ? rules.custom(k.cpu, { params: k.params, inputs: k.inputs, maxDt: k.maxDt }) : null;
  return {
    name: 'kernel', inputs: (k.inputs ?? []).slice(0, 4), channels: ['value'], params: slots(names, k.params ?? {}),
    wgsl: `fn rule(c: vec4f) -> vec4f {\n  let cur = c.x;\n  let dt = u.size.w;\n  let cell = u.size.z;\n${names.map((n, i) => `  let ${n} = ${at(i)};\n`).join('')}  var next = cur;\n  ${k.wgsl}\n  return vec4f(next, c.yzw);\n}`,
    glsl: `vec4 rule(vec4 c) {\n  float cur = c.x;\n  float dt = u.size.w;\n  float cell = u.size.z;\n${names.map((n, i) => `  float ${n} = ${at(i)};\n`).join('')}  float next = cur;\n  ${k.glsl ?? k.wgsl}\n  return vec4(next, c.yzw);\n}`,
    cpu: base ? base.cpu : () => { throw new AslnutError('E-GPU-003', 'this kernel has no CPU path, and the chip cannot step it here (no float targets)', { fix: 'give the kernel a cpu: (cur, n, dt, p) => next as well' }); },
    maxDt: () => k.maxDt ?? 1,
  };
}
/** a rule from what a field was given: a Rule, your function (CPU), or a kernel */
export function ruleOf(r: Rule | Kernel | ((cur: number, n: Parameters<NonNullable<Kernel['cpu']>>[1], dt: number, p: Record<string, number>) => number)): Rule {
  if (typeof r === 'function') return rules.custom(r);
  if (r && typeof (r as Rule).cpu === 'function' && 'channels' in r) return r as Rule;
  if (r && typeof (r as Kernel).wgsl === 'string') return kernel(r as Kernel);
  throw new AslnutError('E-DATA-001', 'a field needs a rule: rules.diffusion(…), a kernel { wgsl, cpu } or a function', { fix: 'field({ …, rule: rules.diffusion({ k: 0.2 }) })' });
}
