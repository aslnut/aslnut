// Twin of field-surface.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from './frame.glsl.ts';
import { LIGHT_GLSL } from './light.glsl.ts';

const COMMON = /* glsl */ `${FRAME_GLSL}
layout(std140) uniform S { vec4 p; vec4 l; vec4 m; vec4 e; } s;
uniform highp sampler2D state;
uniform highp sampler2D base;
uniform highp sampler2D lut;
${LIGHT_GLSL(3)}
ivec2 cellOf(int i, int j) {
  return clamp(ivec2(i, j), ivec2(0, 0), ivec2(int(s.m.y) - 1, int(s.m.z) - 1));
}
float cellValue(int i, int j) {
  vec4 c = texelFetch(state, cellOf(i, j), 0);
  return s.m.w > 2.5 ? c.w : s.m.w > 1.5 ? c.z : s.m.w > 0.5 ? c.y : c.x;
}
float cellTop(int i, int j) {
  return (texelFetch(base, cellOf(i, j), 0).x + cellValue(i, j) * (1.0 - s.e.x)) * s.m.x + s.e.y;
}
`;
export const FIELD_SURFACE_GLSL = {
  vertex: /* glsl */ `${COMMON}
out vec3 v_world;
out float v_v;
out vec3 v_n;
void main() {
  int cols = int(s.m.y) - 1;
  int vi = gl_VertexID;
  int quad = vi / 6;
  int k = vi - quad * 6;
  int cx = (k == 1 || k == 4 || k == 5) ? 1 : 0;
  int cz = (k == 2 || k == 3 || k == 5) ? 1 : 0;
  int i = quad - (quad / cols) * cols + cx;
  int j = quad / cols + cz;
  float y = cellTop(i, j);
  float gx = (cellTop(i + 1, j) - cellTop(i - 1, j)) / (2.0 * s.p.z);
  float gz = (cellTop(i, j + 1) - cellTop(i, j - 1)) / (2.0 * s.p.w);
  v_world = vec3(s.p.x + float(i) * s.p.z, y, s.p.y + float(j) * s.p.w);
  v_n = normalize(vec3(-gx, 1.0, -gz));
  v_v = cellValue(i, j);
  gl_Position = clipOut(frame.viewProj * vec4(v_world, 1.0));
}
`,
  fragment: /* glsl */ `${COMMON}
in vec3 v_world;
in float v_v;
in vec3 v_n;
out vec4 outColor;
void main() {
  if (v_v < s.l.z) {
    discard;
  }
  float t = clamp((v_v - s.l.x) / max(s.l.y - s.l.x, 0.000001), 0.0, 1.0);
  vec4 col = texelFetch(lut, ivec2(int(t * 255.0), 0), 0);
  vec3 c = col.rgb;
  if (frame.sunColor.w > 0.5) {
    c = sunLit(col.rgb, normalize(v_n), v_world);
  }
  vec3 v = normalize(frame.eye.xyz - v_world);
  float fres = pow(1.0 - max(dot(v, normalize(v_n)), 0.0), 3.0);
  c = airFog(mix(themed(c, 0.0), frame.haze.rgb, fres * 0.5), v_world);
  float a = s.l.w * col.a * smoothstep(s.l.z, s.l.z * 3.0 + 0.0001, v_v);
  outColor = vec4(c, a);
}
`,
};
