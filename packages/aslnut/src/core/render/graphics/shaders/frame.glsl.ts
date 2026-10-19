// The frame block every program shares. Twin: frame.wgsl.ts. Both stages start with this header.
export const FRAME_GLSL = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp sampler2DArray;
layout(std140) uniform Frame { mat4 viewProj; vec4 eye; vec4 size; vec4 sun; vec4 misc; vec4 geo; vec4 pick; vec4 region; mat4 inv; vec4 fbsize; mat4 light; vec4 sunColor; vec4 ambient; vec4 shadow; vec4 haze; vec4 weather; vec4 theme; vec4 mute; vec4 themeGround; } frame;
// aslnut writes WebGPU's clip space (depth 0..w); GL's is -w..w. The region zooms onto a few pixels for picking
vec4 clipOut(vec4 p) { return vec4(p.xy * frame.region.xy + frame.region.zw * p.w, p.z * 2.0 - p.w, p.w); }
// the ground's place in the depth order (in WebGPU's depth, before clipOut): a little farther than its own depth
const float GROUND_DEPTH_BIAS = 2e-6;
vec4 groundClip(vec4 p) { return vec4(p.xy, p.z + GROUND_DEPTH_BIAS * p.w, p.w); }
vec4 pickOut(float layer, float index) {
  uint i = uint(max(index, 0.0) + 0.5);
  return vec4(layer, float(i & 255u), float((i >> 8u) & 255u), float((i >> 16u) & 255u)) / 255.0;
}
// the analysis view's muting (core › render › style › theme): keep 0..1 is how much of it is a subject
vec3 themed(vec3 c, float keep) {
  float k = frame.mute.w * (1.0 - keep);
  if (k <= 0.0) {
    return c;
  }
  float l = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 m = mix(c, vec3(l), frame.mute.x);
  m = mix(m, frame.theme.rgb * (2.0 * l), frame.theme.w);
  m = (m - vec3(0.5)) * frame.mute.z + vec3(0.5);
  m = max(m * frame.mute.y, vec3(0.0));
  return mix(c, m, k);
}
vec3 themedGround(vec3 c) {
  return themed(c, 0.0) * mix(1.0, frame.themeGround.x, frame.mute.w);
}
// core › render › drawing › instancing: one size rule for every mark and shape (s: units 0 CSS px / 1 metres, least,
// most CSS px)
vec3 viewEye() {
  if (frame.pick.y > 0.5) {
    vec4 h = frame.inv * vec4(0.0, 0.0, 1.0, 0.0);
    return h.xyz / h.w;
  }
  return frame.eye.xyz;
}
float cssMpp(vec3 p) {
  return 2.0 * length(viewEye() - p) * frame.misc.z / max(frame.fbsize.w, 1.0);
}
float sizePx(float v, vec4 s, vec3 p) {
  float px = v;
  if (s.x > 0.5) {
    px = v / max(cssMpp(p), 0.000000001);
  }
  return clamp(px, s.y, s.z);
}
float sizeKeep(float m, vec4 s, vec3 p) {
  float px = m / max(cssMpp(p), 0.000000001);
  return clamp(px, s.y, s.z) / max(px, 0.000000001);
}
vec4 packDepth(float d) {
  vec3 e = fract(vec3(1.0, 255.0, 65025.0) * clamp(d, 0.0, 0.999999));
  return vec4(e - vec3(e.y, e.z, 0.0) / 255.0, 1.0);
}
`;
