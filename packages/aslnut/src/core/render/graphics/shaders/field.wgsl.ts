// A field's step (core › simulation › fields): one draw over the whole grid, each texel its cell, from the state before
// (cur, rgba32f: four numbers a cell) and up to four inputs (other grids of the same size) into the next state. The
// ready rules are here; a rule of your own defines the function `rule`, a vec4 in and out. Twin: field.glsl.ts.
//   u.size: the grid's width and height in cells, a cell's side (m), the step (s) · u.p0…p3: the rule's numbers
export const FIELD_WGSL = (rule: string) => /* wgsl */ `
struct FieldU { size: vec4f, p0: vec4f, p1: vec4f, p2: vec4f, p3: vec4f }
@group(0) @binding(0) var<uniform> u: FieldU;
@group(1) @binding(0) var cur: texture_2d<f32>;
@group(1) @binding(1) var tin0: texture_2d<f32>;
@group(1) @binding(2) var tin1: texture_2d<f32>;
@group(1) @binding(3) var tin2: texture_2d<f32>;
@group(1) @binding(4) var tin3: texture_2d<f32>;
var<private> IJ: vec2i;
// a texel of a grid; past its edge, the nearest one (no flow across the edge)
fn texel(t: texture_2d<f32>, p: vec2i) -> vec4f {
  let n = vec2i(textureDimensions(t, 0));
  return textureLoad(t, clamp(p, vec2i(0, 0), n - vec2i(1, 1)), 0);
}
fn at(dx: i32, dy: i32) -> vec4f {
  return texel(cur, IJ + vec2i(dx, dy));
}
fn in0(dx: i32, dy: i32) -> vec4f {
  return texel(tin0, IJ + vec2i(dx, dy));
}
fn in1(dx: i32, dy: i32) -> vec4f {
  return texel(tin1, IJ + vec2i(dx, dy));
}
fn in2(dx: i32, dy: i32) -> vec4f {
  return texel(tin2, IJ + vec2i(dx, dy));
}
fn in3(dx: i32, dy: i32) -> vec4f {
  return texel(tin3, IJ + vec2i(dx, dy));
}
// 1 where the neighbour is in the grid
fn inside(dx: i32, dy: i32) -> f32 {
  let p = IJ + vec2i(dx, dy);
  return select(0.0, 1.0, p.x >= 0 && p.y >= 0 && p.x < i32(u.size.x) && p.y < i32(u.size.y));
}
// the Laplacian of the first number (per m²)
fn lap() -> f32 {
  let c = at(0, 0).x;
  return (at(1, 0).x + at(-1, 0).x + at(0, 1).x + at(0, -1).x - 4.0 * c) / (u.size.z * u.size.z);
}
fn laplacian(v: f32) -> f32 {
  return lap() + 0.0 * v;
}
// the state between cells (cell centres at whole numbers), bilinear
fn sampleAt(p: vec2f) -> vec4f {
  let q = clamp(p, vec2f(0.0, 0.0), u.size.xy - vec2f(1.0, 1.0));
  let i = vec2i(floor(q));
  let f = q - floor(q);
  let a = texel(cur, i);
  let b = texel(cur, i + vec2i(1, 0));
  let c = texel(cur, i + vec2i(0, 1));
  let d = texel(cur, i + vec2i(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
// diffusion: p0.x the diffusivity (m²/s)
fn ruleDiffusion(c: vec4f) -> vec4f {
  return vec4f(c.x + u.size.w * u.p0.x * lap(), c.yzw);
}
// advection (semi-Lagrangian): the wind p0.xy (m/s east, north), or input 0's xy where p0.z is 1
fn ruleAdvection(c: vec4f) -> vec4f {
  let w = mix(u.p0.xy, in0(0, 0).xy, u.p0.z);
  let back = vec2f(f32(IJ.x), f32(IJ.y)) - vec2f(w.x, -w.y) * u.size.w / u.size.z;
  return vec4f(sampleAt(back).x, c.yzw);
}
// heat: diffusion (p0.x), relaxing (p0.y per s) towards p0.z, or input 0 where p0.w is 1, plus input 1 × p1.x per s
fn ruleHeat(c: vec4f) -> vec4f {
  let goal = mix(u.p0.z, in0(0, 0).x, u.p0.w);
  let src = in1(0, 0).x * u.p1.x;
  return vec4f(c.x + u.size.w * (u.p0.x * lap() + u.p0.y * (goal - c.x) + src), c.yzw);
}
// the pipe model's flux from a to b (m³/s): it was f, damped by friction (p0.y per s), pushed by the difference of
// the water's surface (ground + depth, gravity p0.x) through the depth of water standing over the higher ground at
// the face between them; never more than a quarter of what the giver holds in a step
fn pipe(a: vec4f, b: vec4f, ga: f32, gb: f32, f: f32) -> f32 {
  let dt = u.size.w;
  let cell = u.size.z;
  let face = max(0.0, max(ga + a.x, gb + b.x) - max(ga, gb));
  let q = f * max(0.0, 1.0 - u.p0.y * dt) + dt * u.p0.x * face * cell * ((ga + a.x) - (gb + b.x)) / cell;
  let cap = cell * cell / (4.0 * dt);
  return clamp(q, -b.x * cap, a.x * cap);
}
// shallow water (the pipe model): depth x (m), the flux to the east y and to the south z (m³/s); the ground's height
// is input 0 (m); rain p0.z m/s, plus input 1 × p1.x. Past the grid's edge: dry ground as high as the edge cell, the
// water running out into it where p0.w is 1 (open edges), held where it is 0 (walls)
fn ruleWater(c: vec4f) -> vec4f {
  let g = in0(0, 0).x;
  let ie = inside(1, 0);
  let is = inside(0, 1);
  let iw = inside(-1, 0);
  let jn = inside(0, -1);
  let e = at(1, 0) * ie;
  let s = at(0, 1) * is;
  let w = at(-1, 0) * iw;
  let n = at(0, -1) * jn;
  let qe = pipe(c, e, g, mix(g, in0(1, 0).x, ie), c.y) * max(ie, u.p0.w);
  let qs = pipe(c, s, g, mix(g, in0(0, 1).x, is), c.z) * max(is, u.p0.w);
  let qw = pipe(w, c, mix(g, in0(-1, 0).x, iw), g, w.y) * max(iw, u.p0.w);
  let qn = pipe(n, c, mix(g, in0(0, -1).x, jn), g, n.z) * max(jn, u.p0.w);
  let rain = u.p0.z + in1(0, 0).x * u.p1.x;
  let h = max(0.0, c.x + u.size.w * ((qw + qn - qe - qs) / (u.size.z * u.size.z) + rain));
  return vec4f(h, qe, qs, 0.0);
}
${rule}
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  IJ = vec2i(pos.xy);
  return rule(at(0, 0));
}
`;
