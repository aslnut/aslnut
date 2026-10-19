// Twin of solid-field.wgsl.ts: the same functions in the same order.
import { SOLID_GLSL } from './solid.glsl.ts';

const FNS = /* glsl */ `
uniform highp sampler2D fieldv;
const int FW = 2048;
float fieldTexel(int k) {
  return texelFetch(fieldv, ivec2(k % FW, k / FW), 0).x;
}
float fieldValue(int vi) {
  float a = fieldTexel(FW + vi);
  float f = fieldTexel(5);
  if (f <= 0.0) {
    return a;
  }
  float b = fieldTexel(FW * (1 + int(fieldTexel(6))) + vi);
  if (a < -1.0e30) {
    return b;
  }
  if (b < -1.0e30) {
    return a;
  }
  return mix(a, b, f);
}
vec3 fieldColor(vec3 own, float v) {
  if (fieldTexel(0) < 0.5 || v < -1.0e30 || v < fieldTexel(3)) {
    return own;
  }
  float lo = fieldTexel(1);
  float hi = fieldTexel(2);
  float x = clamp((v - lo) / max(hi - lo, 0.000001), 0.0, 1.0) * 255.0;
  int i = int(floor(x));
  int j = min(i + 1, 255);
  vec3 c = mix(unpackRGB(fieldTexel(8 + i)), unpackRGB(fieldTexel(8 + j)), x - float(i));
  return mix(own, c, fieldTexel(4));
}
float fieldKeep() {
  return step(0.5, fieldTexel(0)) * step(0.001, fieldTexel(4)) * fieldTexel(7);
}
`;
/** the field's functions before a stage's main */
const withFns = (src: string, hook: string, code: string) => {
  const at = src.lastIndexOf('void main() {');
  if (at < 0 || !src.includes(hook)) throw new Error('solid-field: the solids program lost its field hooks');
  return `${src.slice(0, at)}${FNS}\n${src.slice(at)}`.replace(hook, code);
};
export const SOLID_FIELD_GLSL = {
  vertex: withFns(SOLID_GLSL.vertex, '/*@fieldvertex*/', 'v_col = fieldColor(v_col, fieldValue(gl_VertexID));'),
  fragment: withFns(SOLID_GLSL.fragment, '/*@fieldfragment*/', 'fieldNear = fieldKeep();'),
};
