// A field's step: one draw over the whole grid. Twin: field.wgsl.ts. A rule of your own defines the function `rule`, a vec4 in and out.
const HEAD = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;
export const FIELD_GLSL_VERTEX = /* glsl */ `${HEAD}
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;
export const FIELD_GLSL = (rule: string) => /* glsl */ `${HEAD}
layout(std140) uniform FieldU { vec4 size; vec4 p0; vec4 p1; vec4 p2; vec4 p3; } u;
uniform highp sampler2D cur;
uniform highp sampler2D tin0;
uniform highp sampler2D tin1;
uniform highp sampler2D tin2;
uniform highp sampler2D tin3;
out vec4 outColor;
ivec2 IJ;
vec4 texel(highp sampler2D t, ivec2 p) {
  ivec2 n = textureSize(t, 0);
  return texelFetch(t, clamp(p, ivec2(0, 0), n - ivec2(1, 1)), 0);
}
vec4 at(int dx, int dy) {
  return texel(cur, IJ + ivec2(dx, dy));
}
vec4 in0(int dx, int dy) {
  return texel(tin0, IJ + ivec2(dx, dy));
}
vec4 in1(int dx, int dy) {
  return texel(tin1, IJ + ivec2(dx, dy));
}
vec4 in2(int dx, int dy) {
  return texel(tin2, IJ + ivec2(dx, dy));
}
vec4 in3(int dx, int dy) {
  return texel(tin3, IJ + ivec2(dx, dy));
}
float inside(int dx, int dy) {
  ivec2 p = IJ + ivec2(dx, dy);
  return (p.x >= 0 && p.y >= 0 && p.x < int(u.size.x) && p.y < int(u.size.y)) ? 1.0 : 0.0;
}
float lap() {
  float c = at(0, 0).x;
  return (at(1, 0).x + at(-1, 0).x + at(0, 1).x + at(0, -1).x - 4.0 * c) / (u.size.z * u.size.z);
}
float laplacian(float v) {
  return lap() + 0.0 * v;
}
vec4 sampleAt(vec2 p) {
  vec2 q = clamp(p, vec2(0.0, 0.0), u.size.xy - vec2(1.0, 1.0));
  ivec2 i = ivec2(floor(q));
  vec2 f = q - floor(q);
  vec4 a = texel(cur, i);
  vec4 b = texel(cur, i + ivec2(1, 0));
  vec4 c = texel(cur, i + ivec2(0, 1));
  vec4 d = texel(cur, i + ivec2(1, 1));
  return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
}
vec4 ruleDiffusion(vec4 c) {
  return vec4(c.x + u.size.w * u.p0.x * lap(), c.yzw);
}
vec4 ruleAdvection(vec4 c) {
  vec2 w = mix(u.p0.xy, in0(0, 0).xy, u.p0.z);
  vec2 back = vec2(float(IJ.x), float(IJ.y)) - vec2(w.x, -w.y) * u.size.w / u.size.z;
  return vec4(sampleAt(back).x, c.yzw);
}
vec4 ruleHeat(vec4 c) {
  float goal = mix(u.p0.z, in0(0, 0).x, u.p0.w);
  float src = in1(0, 0).x * u.p1.x;
  return vec4(c.x + u.size.w * (u.p0.x * lap() + u.p0.y * (goal - c.x) + src), c.yzw);
}
float pipe(vec4 a, vec4 b, float ga, float gb, float f) {
  float dt = u.size.w;
  float cell = u.size.z;
  float face = max(0.0, max(ga + a.x, gb + b.x) - max(ga, gb));
  float q = f * max(0.0, 1.0 - u.p0.y * dt) + dt * u.p0.x * face * cell * ((ga + a.x) - (gb + b.x)) / cell;
  float cap = cell * cell / (4.0 * dt);
  return clamp(q, -b.x * cap, a.x * cap);
}
vec4 ruleWater(vec4 c) {
  float g = in0(0, 0).x;
  float ie = inside(1, 0);
  float is = inside(0, 1);
  float iw = inside(-1, 0);
  float jn = inside(0, -1);
  vec4 e = at(1, 0) * ie;
  vec4 s = at(0, 1) * is;
  vec4 w = at(-1, 0) * iw;
  vec4 n = at(0, -1) * jn;
  float qe = pipe(c, e, g, mix(g, in0(1, 0).x, ie), c.y) * max(ie, u.p0.w);
  float qs = pipe(c, s, g, mix(g, in0(0, 1).x, is), c.z) * max(is, u.p0.w);
  float qw = pipe(w, c, mix(g, in0(-1, 0).x, iw), g, w.y) * max(iw, u.p0.w);
  float qn = pipe(n, c, mix(g, in0(0, -1).x, jn), g, n.z) * max(jn, u.p0.w);
  float rain = u.p0.z + in1(0, 0).x * u.p1.x;
  float h = max(0.0, c.x + u.size.w * ((qw + qn - qe - qs) / (u.size.z * u.size.z) + rain));
  return vec4(h, qe, qs, 0.0);
}
${rule}
void main() {
  IJ = ivec2(gl_FragCoord.xy);
  outColor = rule(at(0, 0));
}
`;
