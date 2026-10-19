// Twin of anchors.wgsl.ts: the same functions in the same order.
export const ANCHOR_STILL_GLSL = /* glsl */ `
const float PI = 3.141592653589793;
const float RE = 6378137.0;
float anchorS2(float a) {
  float h = sin(a * 0.5);
  return 2.0 * h * h;
}
vec3 anchorPlace(vec2 rel, float h) {
  float dl = u.place.x + rel.x;
  float dm = u.place.y + rel.y;
  float c = RE * frame.misc.y;
  vec3 F = vec3(c * dl, h, -c * dm);
  if (frame.size.w >= 1.0) {
    return F;
  }
  float lat = 2.0 * atan(exp(frame.geo.x + dm)) - PI * 0.5;
  float dp = lat - frame.misc.x;
  float rr = RE + h;
  float cl = cos(lat);
  float k = anchorS2(dp) + frame.misc.y * cl * anchorS2(dl);
  vec3 G = vec3(rr * cl * sin(dl), h - rr * k, -rr * (sin(dp) + frame.geo.y * cl * anchorS2(dl)));
  return mix(G, F, frame.size.w);
}
vec4 anchorTexel(int e, int k) {
  int i = e * 2 + k;
  return texelFetch(places, ivec2(i % 4096, i / 4096), 0);
}
vec4 anchorOf(int e) {
  vec4 a = anchorTexel(e, 0);
  if (a.w < 0.5) {
    return vec4(0.0);
  }
  vec4 b = anchorTexel(e, 1);
  float h = (a.w < 1.5 ? a.z * u.place.z : a.z) + b.y;
  return vec4(anchorPlace(a.xy, h), 1.0);
}
float anchorTurn(int e) {
  return anchorTexel(e, 1).x;
}
bool anchorShaped(int e) {
  return false;
}
bool anchorBehind(vec3 p) {
  return frame.size.w < 0.5 && dot(p - vec3(0.0, -RE, 0.0), frame.eye.xyz - p) < 0.0;
}
`;
export const ANCHOR_FOLLOW_GLSL = /* glsl */ `
vec4 anchorOf(int e) {
  vec4 m = liveOf(e);
  vec4 w = whereAt(m, jOf(e), s.clock.x);
  int j = int(w.z);
  if ((j < 0 && s.misc.w < 0.5) || m.y < 1.0) {
    return vec4(0.0);
  }
  return vec4(placeAt(w.xy, heightOf(w.xy, altNow(e)) + u.place.w), 1.0);
}
float anchorTurn(int e) {
  vec4 m = liveOf(e);
  vec4 w = whereAt(m, jOf(e), s.clock.x);
  return headingAt(m, int(w.z), s.clock.x);
}
bool anchorShaped(int e) {
  return lookOf(e).z > 0.5;
}
bool anchorBehind(vec3 p) {
  return behindGlobe(p);
}
`;
