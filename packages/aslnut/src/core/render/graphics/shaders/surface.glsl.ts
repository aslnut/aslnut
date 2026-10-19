// Twin of surface.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from './frame.glsl.ts';
import { LIGHT_GLSL } from './light.glsl.ts';
import { SEA_LOOK_GLSL } from './sea.glsl.ts';

const COMMON = /* glsl */ `${FRAME_GLSL}
layout(std140) uniform U { vec4 a; vec4 b; vec4 empty; vec4 horizon; vec4 tint; vec4 grade; vec4 base; vec4 missing; vec4 sea; } u;
layout(std140) uniform Params { /*@params*/ } params;
const int N = 33;
const int M = 35;
const float RE = 6378137.0;
const float PI = 3.141592653589793;
/*@functions*/
`;
// (the sea's look in both stages: its block and the coast's field)
const SEA = SEA_LOOK_GLSL(3, 5);
export const SURFACE_GLSL = {
  vertex: /* glsl */ `${COMMON}
${SEA}
uniform highp sampler2D tiles;
uniform highp sampler2DArray heights;
out vec2 v_uv;
flat out float v_slot;
out vec3 v_world;
out float v_light;
out vec2 v_uv2;
flat out vec2 v_under;
out vec2 v_tuv;
out float v_height;
out vec3 v_normal;
out vec2 v_ouv;
flat out float v_oslot;
flat out float v_known;
float s2(float a) {
  float s = sin(a * 0.5);
  return 2.0 * s * s;
}
vec4 rec(int ii, int k) {
  return texelFetch(tiles, ivec2(k, ii), 0);
}
float hLoad(int slot, int x, int y) {
  return texelFetch(heights, ivec3(x, y, slot), 0).x;
}
float hGrid(int slot, float x, float y) {
  int x0 = int(clamp(floor(x), 0.0, float(N - 1)));
  int y0 = int(clamp(floor(y), 0.0, float(N - 1)));
  int x1 = min(x0 + 1, N - 1);
  int y1 = min(y0 + 1, N - 1);
  float fx = clamp(x - float(x0), 0.0, 1.0);
  float fy = clamp(y - float(y0), 0.0, 1.0);
  return mix(mix(hLoad(slot, x0, y0), hLoad(slot, x1, y0), fx), mix(hLoad(slot, x0, y1), hLoad(slot, x1, y1), fx), fy);
}
float hAt(vec4 r1, vec4 r3, vec4 r5, int i, int j) {
  float par = 0.0;
  if (r3.w >= 0.0) {
    float g = float(N - 1);
    par = hGrid(int(r3.w), (float(i) / g * r5.x + r5.z) * g, (float(j) / g * r5.y + r5.w) * g);
  }
  if (r1.z < 0.0) {
    return par * u.b.x;
  }
  float r = r3.z * r3.z * (3.0 - 2.0 * r3.z);
  return mix(par, hLoad(int(r1.z), i, j), r) * u.b.x;
}
void main() {
  int ii = gl_InstanceID;
  vec4 r0 = rec(ii, 0);
  vec4 r1 = rec(ii, 1);
  vec4 r2 = rec(ii, 2);
  vec4 r3 = rec(ii, 3);
  vec4 r4 = rec(ii, 4);
  vec4 r5 = rec(ii, 5);
  vec4 r6 = rec(ii, 6);
  int v = gl_VertexID;
  int gi = v % M;
  int gj = v / M;
  int i = clamp(gi - 1, 0, N - 1);
  int j = clamp(gj - 1, 0, N - 1);
  bool skirt = gi == 0 || gj == 0 || gi == M - 1 || gj == M - 1;
  float fu = float(i) / float(N - 1);
  float fv = float(j) / float(N - 1);
  float dl = r0.x + fu * r0.y;
  float lat = 2.0 * atan(exp(r0.z - fv * r1.x)) - PI * 0.5;
  if (r1.w == 1.0 && j == 0) {
    lat = mix(PI * 0.5, lat, u.a.w);
  }
  if (r1.w == 2.0 && j == N - 1) {
    lat = mix(-PI * 0.5, lat, u.a.w);
  }
  float edgeM = RE * u.a.y * r0.y;
  float h0 = hAt(r1, r3, r5, i, j);
  float h = h0;
  if (skirt && (r1.z >= 0.0 || r3.w >= 0.0 || u.b.x > 0.0)) {
    h = min(h0 - min(edgeM * 0.015, 2500.0), -50.0);
  }
  if (sea.a.x > 0.5 && u.sea.r >= 0.0 && !skirt && (r1.z >= 0.0 || r3.w >= 0.0)) {
    float c0 = RE * u.a.y;
    h = seaGround(vec3(c0 * dl, 0.0, -c0 * (r0.w - fv * r1.x)), h, u.sea.a);
  }
  float dp = lat - u.a.x;
  float rr = RE + h;
  float cl = cos(lat);
  float k = s2(dp) + u.a.y * cl * s2(dl);
  vec3 G = vec3(rr * cl * sin(dl), h - rr * k, -rr * (sin(dp) + u.a.z * cl * s2(dl)));
  float c = RE * u.a.y;
  vec3 F = vec3(c * dl, h, -c * (r0.w - fv * r1.x));
  vec3 position = mix(G, F, u.a.w);
  float light = 1.0;
  vec3 normal = vec3(0.0, 1.0, 0.0);
  if (r1.z >= 0.0 && u.b.y > 0.0) {
    float hx = hAt(r1, r3, r5, min(i + 1, N - 1), j) - hAt(r1, r3, r5, max(i - 1, 0), j);
    float hz = hAt(r1, r3, r5, i, min(j + 1, N - 1)) - hAt(r1, r3, r5, i, max(j - 1, 0));
    float sx = 2.0 * c * r0.y / float(N - 1);
    float sz = 2.0 * c * r1.x / float(N - 1);
    normal = normalize(vec3(-hx / sx, 1.0, hz / sz));
    light = mix(1.0, clamp(0.35 + 0.85 * dot(normal, normalize(vec3(-0.6, 0.75, -0.6))), 0.45, 1.25), u.b.y);
  }
  vec2 uv = vec2(fu, fv);
  float value = h0;
  float time = frame.eye.w;
  /*@position*/
  // behind whatever lies on it in the depth order (frame: groundClip)
  gl_Position = clipOut(groundClip(frame.viewProj * vec4(position, 1.0)));
  v_uv = uv * r2.xy + r2.zw;
  v_slot = r1.y;
  v_world = position;
  v_light = light;
  v_uv2 = uv * r4.xy + r4.zw;
  v_under = vec2(r3.x, r3.y);
  v_tuv = uv;
  v_height = value;
  v_normal = normal;
  v_ouv = uv * r6.y + r6.zw;
  v_oslot = r6.x;
  v_known = (r1.z >= 0.0 || r3.w >= 0.0) ? 1.0 : 0.0;
}
`,
  fragment: /* glsl */ `${COMMON}
uniform highp sampler2DArray imagery;
uniform highp sampler2DArray overlay;
${LIGHT_GLSL(4)}
${SEA}
in vec2 v_uv;
flat in float v_slot;
in vec3 v_world;
in float v_light;
in vec2 v_uv2;
flat in vec2 v_under;
in vec2 v_tuv;
in float v_height;
in vec3 v_normal;
in vec2 v_ouv;
flat in float v_oslot;
flat in float v_known;
out vec4 outColor;
void main() {
  vec3 c = u.missing.rgb;
  if (v_under.x >= 0.0) {
    c = textureLod(imagery, vec3(v_uv2, v_under.x), 0.0).rgb;
  }
  if (v_slot >= 0.0) {
    float f = v_under.y;
    c = mix(c, textureLod(imagery, vec3(v_uv, v_slot), 0.0).rgb, f * f * (3.0 - 2.0 * f));
  }
  float lumI = dot(c, vec3(0.299, 0.587, 0.114));
  vec3 flatC = u.base.rgb * mix(1.0, clamp(1.0 + (lumI - 0.22) * 3.2, 0.42, 1.9), u.grade.w);
  c = mix(flatC, c, u.base.a);
  c = mix(c * v_light, sunLit(c, normalize(v_normal), v_world), frame.sunColor.w * u.a.w);
  // (a sea with a look draws on a flat world too: its coast's field says where)
  if (u.sea.r >= 0.0 && (u.b.x > 0.0 || sea.a.x > 0.5)) {
    float below = smoothstep(u.sea.a + 0.2 * u.b.x, u.sea.a - 0.6 * u.b.x, v_height) * v_known;
    if (sea.a.x > 0.5) {
      c = seaOver(c, v_world, v_height, smoothstep(u.sea.a + 0.6, u.sea.a + 0.05, v_height) * v_known);
    } else {
      vec3 v = normalize(frame.eye.xyz - v_world);
      float fres = pow(1.0 - max(v.y, 0.0), 4.0);
      float gl = pow(max(dot(normalize(v + frame.sun.xyz), vec3(0.0, 1.0, 0.0)), 0.0), 140.0) * frame.sunColor.w;
      vec3 wc = mix(u.sea.rgb * (0.45 + 0.55 * frame.sun.w), frame.haze.rgb, 0.35 * fres) + frame.sunColor.rgb * gl * 0.7;
      c = mix(c, wc, below);
    }
  }
  float luma = dot(c, vec3(0.299, 0.587, 0.114));
  c = mix(vec3(luma), c, u.grade.x);
  c = (c - vec3(0.5)) * u.grade.z + vec3(0.5);
  c = max(c * u.grade.y, vec3(0.0));
  c = mix(c, u.tint.rgb * (0.25 + 1.5 * luma), u.tint.a);
  float d = distance(v_world, frame.eye.xyz);
  float f = smoothstep(u.b.z, u.b.w, d) * u.a.w;
  vec4 color = vec4(airFog(mix(themedGround(c), frame.haze.w > 0.0 ? frame.haze.rgb : themedGround(u.horizon.rgb), f), v_world), 1.0);
  vec3 position = v_world;
  vec3 normal = v_normal;
  vec2 uv = v_tuv;
  float value = v_height;
  float time = frame.eye.w;
  /*@color*/
  if (frame.pick.x > 0.5) {
    outColor = vec4(0.0);
    return;
  }
  if (v_oslot >= 0.0) {
    vec4 m = textureLod(overlay, vec3(v_ouv, v_oslot), 0.0);
    color = vec4(color.rgb * (1.0 - m.a) + m.rgb * mix(1.0, 0.3 + 0.7 * frame.sun.w, frame.sunColor.w), 1.0);
  }
  outColor = vec4(color.rgb, 1.0);
}
`,
};
