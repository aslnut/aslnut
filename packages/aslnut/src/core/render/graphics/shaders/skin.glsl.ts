// Twin of skin.wgsl.ts: skinned bodies drawn as instances, the same functions in the same order.
import { SOLID_FRAGMENT_LIB_GLSL, SOLID_VERTEX_COMMON_GLSL } from './solid.glsl.ts';

/** the default decal: the colour as it is */
export const SKIN_DECAL_GLSL = /* glsl */ `
vec3 skinDecal(vec2 uv, vec3 p, vec3 base, float seed) {
  return base;
}
`;
/** the program, with a material's skinDecal (GLSL) */
export const skinGLSL = (decal: string = SKIN_DECAL_GLSL) => ({
  vertex: /* glsl */ `${SOLID_VERTEX_COMMON_GLSL}
uniform highp sampler2D bones;
out vec2 v_uv;
flat out vec4 v_dp;
vec4 texel(float row, float x) {
  return texelFetch(bones, ivec2(int(x + 0.5), int(row + 0.5)), 0);
}
vec3 dqPoint(vec4 r, vec4 d, vec3 p) {
  return p + 2.0 * cross(r.xyz, cross(r.xyz, p) + r.w * p) + 2.0 * (r.w * d.xyz - d.w * r.xyz + cross(r.xyz, d.xyz));
}
vec3 dqVector(vec4 r, vec3 v) {
  return v + 2.0 * cross(r.xyz, cross(r.xyz, v) + r.w * v);
}
vec2 unpack12(float v) {
  float hi = floor(v / 4096.0);
  return (vec2(hi, v - hi * 4096.0) - vec2(2048.0, 2048.0)) / 10000.0;
}
layout(location = 0) in vec4 i0;
layout(location = 1) in vec4 i1;
layout(location = 2) in vec4 i2;
layout(location = 3) in vec4 i3;
layout(location = 4) in vec4 i4;
layout(location = 5) in vec4 a0;
layout(location = 6) in vec4 a1;
layout(location = 7) in vec4 a2;
layout(location = 8) in vec4 a3;
void main() {
  t = Tile(tb.o, tb.v, tb.w, tb.l);
  float A = i1.x;
  float B = i1.y;
  float tw = i1.z;
  float js[4] = float[4](a1.x - floor(a1.x / 256.0) * 256.0, floor(a1.x / 256.0), a1.y - floor(a1.y / 256.0) * 256.0, floor(a1.y / 256.0));
  float ws[4] = float[4](a2.x, a2.y, a2.z, a2.w);
  vec4 r = vec4(0.0);
  vec4 d = vec4(0.0);
  vec4 r0 = vec4(0.0, 0.0, 0.0, 1.0);
  for (int k = 0; k < 4; k++) {
    if (k > 0 && ws[k] <= 0.0) {
      continue;
    }
    float bx = js[k] * 2.0;
    vec4 ra = texel(A, bx);
    vec4 rb = texel(B, bx);
    vec4 da = texel(A, bx + 1.0);
    vec4 db = texel(B, bx + 1.0);
    if (dot(ra, rb) < 0.0) {
      rb = -rb;
      db = -db;
    }
    vec4 qr = mix(ra, rb, tw);
    vec4 qd = mix(da, db, tw);
    if (k == 0) {
      r0 = qr;
    }
    float w = dot(qr, r0) < 0.0 ? -ws[k] : ws[k];
    r += qr * w;
    d += qd * w;
  }
  float len = max(length(r), 1e-6);
  r /= len;
  d /= len;
  vec3 p = a0.xyz;
  if (a3.w > -0.5) {
    float nb = float(textureSize(bones, 0).x) - 1.0;
    vec4 mw = mix(texel(A, nb), texel(B, nb), tw);
    vec2 pw = a3.w > 0.5 ? mw.zw : mw.xy;
    vec2 ax = unpack12(a3.x);
    vec2 ay = unpack12(a3.y);
    vec2 az = unpack12(a3.z);
    p += vec3(ax.x, ax.y, ay.x) * pw.x + vec3(ay.y, az.x, az.y) * pw.y;
  }
  vec3 q = dqPoint(r, d, p) * i1.w;
  vec3 nq = dqVector(r, unpackNormal(a0.w));
  float c = cos(i0.w);
  float s = sin(i0.w);
  vec3 position = placeOf(i0.x + q.x * c - q.z * s, i0.z + q.y, i0.y + q.x * s + q.z * c);
  float pal[8] = float[8](i2.x, i2.y, i2.z, i2.w, i3.x, i3.y, i3.z, i3.w);
  v_col = unpackRGB(pal[clamp(int(a1.z + 0.5), 0, 7)]);
  v_n = vec3(nq.x * c - nq.z * s, nq.y, nq.x * s + nq.z * c);
  v_id = i4.x;
  v_leaf = vec3(0.0);
  float hu = floor(a1.w / 4096.0);
  v_uv = a1.w >= 0.0 ? vec2(hu, a1.w - hu * 4096.0) / 4095.0 : vec2(-1.0, -1.0);
  v_dp = vec4(i4.yzw, i4.x);
  gl_Position = clipOut(frame.viewProj * vec4(position, 1.0));
  v_world = position;
}
`,
  fragment: /* glsl */ `${SOLID_FRAGMENT_LIB_GLSL}
${decal}
in vec3 v_col;
in vec3 v_n;
in vec3 v_world;
flat in float v_id;
in vec2 v_uv;
flat in vec4 v_dp;
out vec4 outColor;
void main() {
  t = Tile(tb.o, tb.v, tb.w, tb.l);
  if (t.v.w < 1.0 && dither(gl_FragCoord.xy) > t.v.w) {
    discard;
  }
  if (frame.pick.y > 0.5) {
    outColor = packDepth(gl_FragCoord.z);
    return;
  }
  if (frame.pick.x > 0.5) {
    outColor = pickOut(t.v.y, t.w.w * 65536.0 + v_id);
    return;
  }
  vec3 base = v_col;
  if (v_uv.x >= 0.0) {
    base = skinDecal(v_uv, v_dp.xyz, base, v_dp.w);
  }
  outColor = vec4(shadeSolid(base, normalize(v_n), v_world, v_id, 0.0), 1.0);
}
`,
});
/** the default program */
export const SKIN_GLSL = skinGLSL();
