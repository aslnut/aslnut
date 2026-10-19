// Twin of stars.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from './frame.glsl.ts';

const COMMON = /* glsl */ `${FRAME_GLSL}
layout(std140) uniform U { vec4 r0; vec4 r1; vec4 r2; vec4 look; } u;
`;
export const STARS_GLSL = {
  vertex: /* glsl */ `${COMMON}
layout(location = 0) in vec4 a;
layout(location = 1) in vec4 b;
out vec2 v_corner;
out vec3 v_col;
vec2 starCorner(int v) {
  return vec2(mix(-1.0, 1.0, float(v == 1 || v == 2 || v == 4)), mix(-1.0, 1.0, float(v == 2 || v == 4 || v == 5)));
}
vec3 starColour(float bv) {
  float t = clamp((bv + 0.3) / 2.0, 0.0, 1.0);
  return mix(mix(vec3(0.62, 0.72, 1.0), vec3(1.0, 0.97, 0.92), smoothstep(0.0, 0.35, t)), vec3(1.0, 0.68, 0.42), smoothstep(0.35, 1.0, t));
}
void main() {
  vec3 e = a.xyz;
  vec3 d = vec3(dot(u.r0.xyz, e), dot(u.r1.xyz, e), dot(u.r2.xyz, e));
  float lum = clamp(pow(2.512, u.look.y - a.w) / pow(2.512, u.look.y), 0.0, 1.0);
  float k = u.look.x * smoothstep(0.0, 0.12, d.y) * smoothstep(-0.05, 0.25, u.look.y - a.w);
  float px = max(1.0, u.look.z * pow(lum, 0.25)) * u.look.w * frame.size.z;
  vec2 corner = starCorner(gl_VertexID);
  vec4 c = frame.viewProj * vec4(d, 0.0);
  vec2 off = corner * px / frame.fbsize.xy * c.w;
  gl_Position = clipOut(vec4(c.xy + off, c.w * 0.99999, c.w));
  v_corner = corner;
  v_col = starColour(b.x) * min(1.8, 0.35 + 2.2 * pow(lum, 0.5)) * k;
  if (k <= 0.0 || d.y < -0.02) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
  }
}
`,
  fragment: /* glsl */ `${COMMON}
in vec2 v_corner;
in vec3 v_col;
out vec4 outColor;
void main() {
  float r = dot(v_corner, v_corner);
  float a = exp(-r * 2.4);
  outColor = vec4(themed(v_col, 0.0) * a, a);
}
`,
};
