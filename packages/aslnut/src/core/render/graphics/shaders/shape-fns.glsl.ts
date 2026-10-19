// Twin of shape-fns.wgsl.ts: the same functions in the same order.
export const SHAPE_FNS_GLSL = /* glsl */ `
vec3 unpackRGB(float c) {
  uint i = uint(round(c));
  return vec3(float((i >> 16u) & 255u), float((i >> 8u) & 255u), float(i & 255u)) / 255.0;
}
vec3 unpackNormal(float n) {
  uint i = uint(round(n));
  vec2 e = vec2(float(i >> 12u), float(i & 4095u)) / 4095.0 * 2.0 - vec2(1.0, 1.0);
  vec3 v = vec3(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  float k = max(-v.z, 0.0);
  v.x = v.x + (v.x >= 0.0 ? -k : k);
  v.y = v.y + (v.y >= 0.0 ? -k : k);
  return normalize(vec3(v.x, v.z, v.y));
}
vec3 unpackCard(float c) {
  float code = round(c);
  if (code < 65536.0) {
    return vec3(0.0, 0.0, 0.0);
  }
  float kind = floor(code / 65536.0);
  float rest = code - kind * 65536.0 - 1.0;
  return vec3((rest - 256.0 * floor(rest / 256.0)) / 255.0, floor(rest / 256.0) / 255.0, kind);
}
float leafMask(vec2 uv, float kind) {
  vec2 p = uv * 2.0 - vec2(1.0, 1.0);
  float hit = 0.0;
  for (int k = 0; k < 9; k++) {
    float a = float(k) * 2.39996 + kind * 1.3;
    float r = k == 0 ? 0.0 : 0.62 * sqrt(float(k) / 8.0);
    vec2 c = vec2(cos(a), sin(a)) * r;
    vec2 dir = k == 0 ? vec2(0.0, 1.0) : normalize(c + vec2(0.0001, 0.0));
    vec2 d = p - c;
    float along = dot(d, dir);
    float across = dot(d, vec2(-dir.y, dir.x));
    float len = (kind > 1.5 && kind < 2.5) ? 0.55 : (kind > 2.5 ? 0.55 : 0.5);
    float wid = (kind > 1.5 && kind < 2.5) ? 0.04 : (kind > 2.5 ? 0.12 : 0.3);
    hit = max(hit, step((along * along) / (len * len) + (across * across) / (wid * wid), 1.0));
  }
  return hit;
}
`;
