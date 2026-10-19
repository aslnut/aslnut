// Twin of emit.wgsl.ts: copies over time, moved by their age on the chip.
import { SOLID_FRAGMENT_LIB_GLSL, SOLID_VERTEX_COMMON_GLSL } from './solid.glsl.ts';
import { SOLID_SET_GLSL } from './solid-inst.glsl.ts';

export const EMIT_GLSL = {
  vertex: /* glsl */ `${SOLID_VERTEX_COMMON_GLSL}${SOLID_SET_GLSL}
layout(location = 0) in float r;
layout(location = 3) in vec4 v;
layout(location = 4) in float vc;
layout(location = 5) in float card;
out vec4 v_ecol;
float copyHash(float c, float s) {
  return fract(sin(c * 12.9898 + s * 78.233) * 43758.5453);
}
void main() {
  vec4 r0 = recAt(r, 0);
  vec4 r1 = recAt(r, 1);
  vec4 r2 = recAt(r, 2);
  tileAt(r2.w);
  int code = int(v.w + 0.5);
  int e = min(code / 1024, 1);
  float c = float(code % 1024);
  vec4 E0 = si.e[e * 3];
  vec4 E1 = si.e[e * 3 + 1];
  vec4 E2 = si.e[e * 3 + 2];
  v_ecol = vec4(0.0);
  if (copyHash(c, 3.1) > si.d.x || E0.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  float age = fract(frame.eye.w / E0.w + c / max(E1.w, 1.0) + r2.z);
  float hx = copyHash(c, r2.z) * 2.0 - 1.0;
  float hz = copyHash(c + 17.0, r2.z) * 2.0 - 1.0;
  vec3 at = E0.xyz + vec3(hx * E1.y * age + E2.z * age, E1.x * age, hz * E1.y * age + E2.w * age);
  vec3 q0 = at + (v.xyz - E0.xyz) * mix(1.0, E1.z, age);
  float cc = cos(r1.w);
  float s = sin(r1.w);
  float g = groundAt(r0.x, r0.y) * t.v.x + r0.z;
  float keep = keepOf(max(r1.x, r1.z), placeOf(r0.x, g + si.a.x * 0.5 * r1.y, r0.y));
  vec3 q = q0 * r1.xyz * keep;
  vec3 rr = vec3(q.x * cc - q.z * s, q.y, q.x * s + q.z * cc);
  vec3 position = placeOf(r0.x + rr.x, g + rr.y, r0.y + rr.z);
  v_ecol = vec4(unpackRGB(vc), mix(E2.x, E2.y, age) * smoothstep(0.0, 0.1, age) * t.v.w);
  gl_Position = clipOut(frame.viewProj * vec4(towardEye(position), 1.0));
}
`,
  fragment: /* glsl */ `${SOLID_FRAGMENT_LIB_GLSL}
in vec4 v_ecol;
out vec4 outColor;
void main() {
  if (frame.pick.x > 0.5 || frame.pick.y > 0.5 || v_ecol.a <= 0.003) {
    discard;
  }
  outColor = vec4(themed(v_ecol.rgb, 0.0), v_ecol.a);
}
`,
};
