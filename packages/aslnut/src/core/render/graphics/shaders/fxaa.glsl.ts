// Twin of fxaa.wgsl.ts: the same functions in the same order.
export const FXAA_GLSL = {
  vertex: /* glsl */ `#version 300 es
void main() {
  float x = float((gl_VertexID << 1) & 2) * 2.0 - 1.0;
  float y = float(gl_VertexID & 2) * 2.0 - 1.0;
  gl_Position = vec4(x, y, 0.0, 1.0);
}
`,
  fragment: /* glsl */ `#version 300 es
precision highp float;
uniform sampler2D pic;
out vec4 outColor;
float luma(vec3 c) {
  return dot(c, vec3(0.299, 0.587, 0.114));
}
vec3 at(vec2 uv) {
  return textureLod(pic, uv, 0.0).rgb;
}
vec3 fxaa(vec2 uv, vec2 px) {
  float nw = luma(at(uv + vec2(-1.0, -1.0) * px));
  float ne = luma(at(uv + vec2(1.0, -1.0) * px));
  float sw = luma(at(uv + vec2(-1.0, 1.0) * px));
  float se = luma(at(uv + vec2(1.0, 1.0) * px));
  float m = luma(at(uv));
  float lo = min(m, min(min(nw, ne), min(sw, se)));
  float hi = max(m, max(max(nw, ne), max(sw, se)));
  vec2 dir = vec2(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  float reduce = max((nw + ne + sw + se) * 0.03125, 0.0078125);
  float rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcp, vec2(-8.0), vec2(8.0)) * px;
  vec3 a = 0.5 * (at(uv + dir * (1.0 / 3.0 - 0.5)) + at(uv + dir * (2.0 / 3.0 - 0.5)));
  vec3 b = a * 0.5 + 0.25 * (at(uv - dir * 0.5) + at(uv + dir * 0.5));
  float lb = luma(b);
  if (lb < lo || lb > hi) {
    return a;
  }
  return b;
}
void main() {
  vec2 size = vec2(textureSize(pic, 0));
  outColor = vec4(fxaa(gl_FragCoord.xy / size, 1.0 / size), 1.0);
}
`,
};
