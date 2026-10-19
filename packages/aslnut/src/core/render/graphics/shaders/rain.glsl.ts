// Twin of rain.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from './frame.glsl.ts';

const COMMON = /* glsl */ `${FRAME_GLSL}
layout(std140) uniform U { vec4 a; vec4 b; vec4 c; } u;
`;
export const RAIN_GLSL = {
  vertex: /* glsl */ `${COMMON}
layout(location = 0) in vec4 s;
out float v_alpha;
float wrapIn(float v, float size) {
  return v - size * floor(v / size) - size * 0.5;
}
void main() {
  float side = u.a.x;
  float h = u.a.y;
  float t = u.c.z;
  float speed = 9.0 * s.w;
  float x = wrapIn(s.x * side - u.c.x, side);
  float z = wrapIn(s.z * side - u.c.y, side);
  float y = wrapIn(s.y * h - t * speed, h);
  vec3 top = frame.eye.xyz + vec3(x, y, z);
  vec3 fall = vec3(u.a.w * 0.06, -1.0, 0.0) * (0.06 * speed);
  int vid = gl_VertexID;
  int k = vid;
  if (vid == 3) {
    k = 2;
  } else if (vid == 4) {
    k = 1;
  } else if (vid == 5) {
    k = 3;
  }
  float end = float(k % 2);
  float side2 = float(k / 2) * 2.0 - 1.0;
  vec3 p = top + fall * end;
  vec4 c0 = frame.viewProj * vec4(top, 1.0);
  vec4 c1 = frame.viewProj * vec4(top + fall, 1.0);
  vec2 dir = normalize((c1.xy / max(c1.w, 0.001) - c0.xy / max(c0.w, 0.001)) * frame.size.xy + vec2(0.0001, 0.0));
  vec2 across = vec2(-dir.y, dir.x) / frame.size.xy * frame.size.z * 1.2;
  vec4 c = frame.viewProj * vec4(p, 1.0);
  c = vec4(c.xy + across * side2 * c.w, c.z, c.w);
  gl_Position = clipOut(c);
  float dist = length(vec2(x, z));
  v_alpha = u.b.w * (1.0 - smoothstep(side * 0.25, side * 0.5, dist)) * (0.35 + 0.65 * u.a.z);
}
`,
  fragment: /* glsl */ `${COMMON}
in float v_alpha;
out vec4 outColor;
void main() {
  if (v_alpha <= 0.002) {
    discard;
  }
  outColor = vec4(themed(u.b.rgb, 0.0), v_alpha);
}
`,
};
