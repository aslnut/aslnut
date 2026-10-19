// core › render › look › materials: what a surface is made of, on every builder verb and in raw meshes. Each material
// rides with every vertex as a code (0…255); the solids layer draws each kind its way:
//   lit kinds        matte 0 · painted 1 · glass 2 · metal 3 · emissive 4 · foliage 5 · water 6 (one program, as before)
//   'wire'     8     the surface's edges as lines (a sphere net: b.solid('sphere', { material: 'wire' })); the
//                    diagonals of flat quads are left out, so a sphere shows its latitudes and longitudes
//   lines      9     raw 3D segments (b.mesh(segments, { lines: true }))
//   lamps  10…12     a piece that lights up from dusk (the finish's `lamps`): 10 head (a lens by day, bright white at
//                    night), 11 tail (red), 12 windows (some of them lit rooms at night)
//   'flat'    13     its own colour, unlit (a sign, a marker, a diagram)
//   'facade'  14     a wall with windows a floor and a bay apart (3.2 m), drawn in the shader: no geometry per window;
//                    they light up at night as windows do
//   'imagery' 15     the imagery under it, seen from above (a roof's satellite photo: the layer's `imagery` source)
//   'interior' 16    glass with rooms behind it (a floor, a ceiling, walls), lit or dark at night
//   'pbr'  192…255   physically based: roughness and metalness (material('pbr', { roughness, metal })), the sun's
//                    highlight and the sky in it
// The world's rain wets matte, concrete and physically based surfaces (darker, glossier) on its own.
//   'ghost'  128…191 see-through, blended: material('ghost', { opacity })
//   custom    64…127 your shader: material.custom({ fragment, vertex?, uniforms?, varyings?, functions? }) in the WGSL
//                    subset (the same as custom() marks), translated to GLSL for WebGL2
// Pay only for what you set: a mesh with none of the special kinds is drawn as before (no second program, no pass);
// each kind's program is made the first time something of that kind is drawn.
//   b.solid('sphere', { radius: 4, material: 'wire', color: '#7fdcff' })
//   const pulse = material.custom({ uniforms: { speed: 2 }, fragment: `color = vec4f(color.rgb * (0.6 + 0.4 * sin(time * params.speed)), 1.0);` })
import { AslnutError } from '../../world/errors.ts';
import type { ParamValue } from '../graphics/shaders/hooks.ts';

export type MaterialName = 'matte' | 'concrete' | 'painted' | 'glass' | 'metal' | 'emissive' | 'foliage' | 'water' | 'wire' | 'ghost' | 'flat' | 'facade' | 'imagery' | 'interior' | 'pbr';
export const MATERIAL_CODES: Record<Exclude<MaterialName, 'ghost' | 'pbr'>, number> = { matte: 0, concrete: 7, painted: 1, glass: 2, metal: 3, emissive: 4, foliage: 5, water: 6, wire: 8, flat: 13, facade: 14, imagery: 15, interior: 16 };
/** physically based: 192 + roughness (0…7) × 8 + metal (0…7) */
export const PBR_BASE = 192;
/** a physically based surface's code: its roughness and metalness 0..1 (eight steps each) */
export const pbrCode = (roughness = 0.5, metal = 0) => PBR_BASE + Math.round(Math.max(0, Math.min(1, roughness)) * 7) * 8 + Math.round(Math.max(0, Math.min(1, metal)) * 7);
/** a segment of raw lines (b.mesh(segments, { lines: true })) */
export const LINE_CODE = 9;
export const GHOST_BASE = 128, CUSTOM_BASE = 64;
/** a copy over time (core › geometry › shapes › builder › copy: emit): its triangles drawn apart, moved on the chip by
 *  its emitter's age (its normal's number: emitter × 1024 + its copy) */
export const EMIT_CODE = 17;
/** lamps (the finish's `lamps`): drawn by the solids' own program, lit from dusk */
export const LAMP_CODES = { head: 10, tail: 11, windows: 12 } as const;
export type LampKind = keyof typeof LAMP_CODES;

/** your own material's code, in the WGSL subset (translated for WebGL2). In the fragment: `color` (vec4f, the lit
 *  colour so far: change it), `base` (vec3f, its own colour), `normal`, `position` (world metres), `id`, `time`, your
 *  varyings and `params.*`. In the vertex stage: `position` (world metres: move it), `normal`, `time`, your varyings */
export interface CustomMaterialSpec {
  fragment: string;
  vertex?: string;
  /** helper functions for both stages */
  functions?: string;
  /** values your code reads as params.name: numbers, 2 to 4 numbers, '#rrggbb' */
  uniforms?: Record<string, ParamValue>;
  /** vertex → fragment: name → 'f32' | 'vec2f' | 'vec3f' | 'vec4f' */
  varyings?: Record<string, string>;
  /** blended over what is behind it (default 'none': opaque, its depth written) */
  blend?: 'none' | 'alpha' | 'add';
}
export interface Material {
  readonly kind: MaterialName | 'custom';
  /** the code every vertex carries */
  readonly code: number;
}
export class CustomMaterial implements Material {
  readonly kind = 'custom' as const;
  readonly code: number; readonly spec: CustomMaterialSpec;
  /** the uniforms now (set() changes them for every layer drawing it) */
  readonly values: Record<string, ParamValue>;
  /** bumped by set(): the layers write their copy again */
  version = 0;
  constructor(code: number, spec: CustomMaterialSpec) { this.code = code; this.spec = spec; this.values = { ...(spec.uniforms ?? {}) }; }
  /** a uniform's new value (next frame, every layer that draws it) */
  set(name: string, v: ParamValue): this {
    if (!(name in this.values)) throw new AslnutError('E-WORLD-004', `material has no uniform '${name}'`, { fix: `its uniforms: ${Object.keys(this.values).join(', ') || 'none'}` });
    this.values[name] = v; this.version++; return this;
  }
  /** does its code read the clock (the frames keep coming while it is drawn) */
  get animated(): boolean { return /\btime\b/.test(`${this.spec.vertex ?? ''} ${this.spec.fragment}`); }
}
const customs: CustomMaterial[] = [];
/** a material: a kind, with its options (ghost: how opaque, default .35) */
export function material(kind: MaterialName, o: { opacity?: number; roughness?: number; metal?: number } = {}): Material {
  if (kind === 'ghost') return { kind, code: GHOST_BASE + Math.round(Math.max(0, Math.min(1, o.opacity ?? 0.35)) * 63) };
  if (kind === 'pbr') return { kind, code: pbrCode(o.roughness, o.metal) };
  const code = MATERIAL_CODES[kind];
  if (code === undefined) throw new AslnutError('E-DATA-001', `no material '${kind}'`, { fix: `one of ${[...Object.keys(MATERIAL_CODES), 'ghost'].join(', ')}, or material.custom({ fragment })` });
  return { kind, code };
}
/** your own shader for a surface (at most 64 in a page) */
material.custom = (spec: CustomMaterialSpec): CustomMaterial => {
  if (!spec || typeof spec.fragment !== 'string') throw new AslnutError('E-SHADER-001', 'material.custom needs a fragment (WGSL statements)', { fix: "material.custom({ fragment: 'color = vec4f(1.0, 0.0, 0.0, 1.0);' })" });
  if (customs.length >= 64) throw new AslnutError('E-SHADER-001', 'more than 64 custom materials in one page', { fix: 'reuse one, with uniforms for what differs' });
  const m = new CustomMaterial(CUSTOM_BASE + customs.length, spec); customs.push(m); return m;
};
/** the custom material of a code (null: not one) */
export const customOf = (code: number): CustomMaterial | null => (code >= CUSTOM_BASE && code < CUSTOM_BASE + 64 ? customs[code - CUSTOM_BASE] ?? null : null);
/** a finish's material as its code */
export function codeOf(m: MaterialName | Material | undefined | null): number {
  if (m === undefined || m === null) return 0;
  if (typeof m === 'string') return m === 'ghost' ? material('ghost').code : m === 'pbr' ? pbrCode() : (MATERIAL_CODES[m] ?? 0);
  return m.code;
}
/** how a code is drawn */
export type PartKind = 'solid' | 'wire' | 'line' | 'ghost' | 'custom' | 'emit';
export function partOf(code: number): PartKind {
  if (code === MATERIAL_CODES.wire) return 'wire';
  if (code === LINE_CODE) return 'line';
  if (code === EMIT_CODE) return 'emit';
  if (code >= GHOST_BASE && code < GHOST_BASE + 64) return 'ghost';
  if (code >= CUSTOM_BASE && code < CUSTOM_BASE + 64) return 'custom';
  return 'solid';
}
/** a vertex array split by how each part is drawn: the solid triangles as they were; wire triangles turned into their
 *  edges (lines: pairs of vertices), raw segments into lines, ghost and custom triangles apart (custom by code).
 *  `codeAt(arr, i)` reads vertex i's code; null when every vertex is solid (nothing to split: the array as it is) */
export interface Split { solid: Float32Array; lines: Float32Array | null; ghost: Float32Array | null; custom: Map<number, Float32Array>; /** copies over time */ emit: Float32Array | null }
export function splitParts(arr: Float32Array, stride: number, codeAt: (arr: Float32Array, i: number) => number): Split | null {
  const n = Math.floor(arr.length / stride); let special = false;
  for (let i = 0; i < n; i += 3) { if (partOf(codeAt(arr, i)) !== 'solid') { special = true; break; } }
  if (!special) return null;
  const solid: number[] = [], lines: number[] = [], ghost: number[] = [], custom = new Map<number, number[]>(), wires: number[] = [], emit: number[] = [];
  const push = (to: number[], v: number) => { for (let k = 0; k < stride; k++) to.push(arr[v * stride + k]!); };
  for (let t = 0; t + 2 < n; t += 3) {
    const code = codeAt(arr, t), kind = partOf(code);
    if (kind === 'solid') { push(solid, t); push(solid, t + 1); push(solid, t + 2); }
    else if (kind === 'line') { push(lines, t); push(lines, t + 1); }
    else if (kind === 'ghost') { push(ghost, t); push(ghost, t + 1); push(ghost, t + 2); }
    else if (kind === 'emit') { push(emit, t); push(emit, t + 1); push(emit, t + 2); }
    else if (kind === 'custom') { let c = custom.get(code); if (!c) custom.set(code, (c = [])); push(c, t); push(c, t + 1); push(c, t + 2); }
    else wires.push(t);
  }
  if (wires.length) edgesOf(arr, stride, wires, lines);
  return { solid: Float32Array.from(solid), lines: lines.length ? Float32Array.from(lines) : null, ghost: ghost.length ? Float32Array.from(ghost) : null, custom: new Map([...custom].map(([k, v]) => [k, Float32Array.from(v)])), emit: emit.length ? Float32Array.from(emit) : null };
}
/** the edges of wire triangles: each once; an edge between two faces that lie flat together (a quad's diagonal) left out */
function edgesOf(arr: Float32Array, stride: number, tris: number[], out: number[]): void {
  const key = (v: number) => `${Math.round(arr[v * stride]! * 1e4)},${Math.round(arr[v * stride + 1]! * 1e4)},${Math.round(arr[v * stride + 2]! * 1e4)}`;
  const normal = (t: number): [number, number, number] => {
    const p = (v: number, k: number) => arr[(t + v) * stride + k]!;
    const ux = p(1, 0) - p(0, 0), uy = p(1, 1) - p(0, 1), uz = p(1, 2) - p(0, 2), vx = p(2, 0) - p(0, 0), vy = p(2, 1) - p(0, 1), vz = p(2, 2) - p(0, 2);
    const x = uy * vz - uz * vy, y = uz * vx - ux * vz, z = ux * vy - uy * vx, l = Math.hypot(x, y, z) || 1; return [x / l, y / l, z / l];
  };
  const edges = new Map<string, { a: number; b: number; n: [number, number, number]; flat: boolean; count: number }>();
  for (const t of tris) {
    const n = normal(t);
    for (const [i, j] of [[0, 1], [1, 2], [2, 0]] as const) {
      const a = t + i, b = t + j, ka = key(a), kb = key(b), k = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = edges.get(k);
      if (!e) { edges.set(k, { a, b, n, flat: false, count: 1 }); continue; }
      e.count++; if (e.n[0] * n[0] + e.n[1] * n[1] + e.n[2] * n[2] > 0.9995) e.flat = true;
    }
  }
  for (const e of edges.values()) {
    if (e.flat) continue;
    for (const v of [e.a, e.b]) for (let k = 0; k < stride; k++) out.push(arr[v * stride + k]!);
  }
}
/** the code of vertex i: a chunk mesh (the id's high part, MESH_FLOATS 8) */
export const meshCode = (arr: Float32Array, i: number) => Math.floor(arr[i * 8 + 7]! / 65536);
/** the code of vertex i: an instance shape (its last number below 65536; leaf cards are solid) */
export const shapeCode = (arr: Float32Array, i: number) => { const c = arr[i * 6 + 5]!; return c >= 65536 ? 0 : c % 256; };
