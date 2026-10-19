// Twin of sky.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from './frame.glsl.ts';

const COMMON = /* glsl */ `${FRAME_GLSL}
layout(std140) uniform U { mat4 inv; vec4 space; vec4 glow; vec4 horizon; vec4 zenith; vec4 misc; } u;
`;
export const SKY_GLSL = {
  vertex: /* glsl */ `${COMMON}
out vec2 v_ndc;
void main() {
  int i = gl_VertexID;
  vec2 p = vec2(float((i << 1u) & 2), float(i & 2)) * 2.0 - 1.0;
  gl_Position = clipOut(vec4(p, 1.0, 1.0));
  v_ndc = p;
}
`,
  fragment: /* glsl */ `${COMMON}
in vec2 v_ndc;
out vec4 outColor;
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float hash3(vec3 q) {
  ivec3 iq = ivec3(q);
  return float(pcg(uint(iq.x) ^ pcg(uint(iq.y) ^ pcg(uint(iq.z))))) / 4294967295.0;
}
vec3 skyColor(vec2 ndc) {
  vec4 a = u.inv * vec4(ndc, 0.0, 1.0);
  vec4 b = u.inv * vec4(ndc, 1.0, 1.0);
  vec3 o = a.xyz / a.w;
  vec3 d = normalize(b.xyz / b.w - o);
  vec3 q = floor(d * 900.0);
  float s = step(1.0 - 0.0018 * u.misc.z, hash3(q)) * hash3(q + vec3(1.0, 2.0, 3.0));
  vec3 c = u.space.rgb + vec3(s);
  vec3 C = vec3(0.0, -u.misc.y, 0.0);
  vec3 oc = C - o;
  float t = dot(oc, d);
  if (t > 0.0) {
    float dm = length(oc - d * t);
    float g = exp(-max(dm - u.misc.y, 0.0) / (u.misc.y * 0.035)) * smoothstep(u.misc.y * 0.96, u.misc.y, dm);
    c = mix(c, u.glow.rgb, clamp(g, 0.0, 1.0));
  }
  vec3 sky = mix(u.horizon.rgb, u.zenith.rgb, smoothstep(0.0, 0.45, d.y));
  return mix(c, sky, u.misc.x);
}
void main() {
  outColor = vec4(themed(skyColor(v_ndc), 0.0), 1.0);
}
`,
};
