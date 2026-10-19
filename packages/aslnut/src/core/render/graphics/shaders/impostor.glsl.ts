// Twin of impostor.wgsl.ts: the same functions in the same order. The bake draws upside down (GL's rows start at the
// bottom): the atlas comes out laid as WebGPU's, so both read it with the same coordinates.
import { SHAPE_FNS_GLSL } from './shape-fns.glsl.ts';
import { SOLID_FRAGMENT_LIB_GLSL, SOLID_VERTEX_COMMON_GLSL } from './solid.glsl.ts';
import { SOLID_SET_GLSL } from './solid-inst.glsl.ts';

const BAKE_HEAD = /* glsl */ `#version 300 es
precision highp float;
precision highp int;
layout(std140) uniform B { mat4 view; vec4 cell; vec4 mode; } b;
${SHAPE_FNS_GLSL}
`;
export const IMPOSTOR_BAKE_GLSL = {
  vertex: /* glsl */ `${BAKE_HEAD}
layout(location = 3) in vec4 v;
layout(location = 4) in float vc;
layout(location = 5) in float card;
out vec3 v_col;
out vec3 v_n;
out vec3 v_leaf;
out vec2 v_q;
void main() {
  vec4 p = b.view * vec4(v.xyz, 1.0);
  v_q = p.xy;
  vec2 xy = p.xy * b.cell.z + b.cell.xy;
  gl_Position = vec4(xy.x, -xy.y, -p.z, 1.0);
  v_col = unpackRGB(vc);
  v_n = unpackNormal(v.w);
  v_leaf = unpackCard(card);
}
`,
  fragment: /* glsl */ `${BAKE_HEAD}
in vec3 v_col;
in vec3 v_n;
in vec3 v_leaf;
in vec2 v_q;
out vec4 outColor;
void main() {
  if (abs(v_q.x) > 1.0 || abs(v_q.y) > 1.0) {
    discard;
  }
  if (v_leaf.z > 0.5 && leafMask(v_leaf.xy, v_leaf.z) < 0.5) {
    discard;
  }
  vec3 n = normalize(v_n);
  if (dot(n, b.mode.yzw) < 0.0) {
    n = -n;
  }
  outColor = b.mode.x > 0.5 ? vec4(n * 0.5 + vec3(0.5, 0.5, 0.5), 1.0) : vec4(v_col, 1.0);
}
`,
};
const IM = /* glsl */ `
layout(std140) uniform IM { vec4 a; } im;
`;
export const IMPOSTOR_GLSL = {
  vertex: /* glsl */ `${SOLID_VERTEX_COMMON_GLSL}${SOLID_SET_GLSL}${IM}
layout(location = 0) in float r;
out vec2 v_uv;
flat out float v_turn;
vec2 hemiOct(vec3 d) {
  vec3 a = vec3(d.x, max(d.y, 0.0), d.z) / (abs(d.x) + max(d.y, 0.0) + abs(d.z) + 0.000001);
  return vec2(a.x + a.z, a.x - a.z) * 0.5 + vec2(0.5, 0.5);
}
vec3 hemiOctDir(vec2 e) {
  vec2 f = e * 2.0 - vec2(1.0, 1.0);
  float x = (f.x + f.y) * 0.5;
  float z = (f.x - f.y) * 0.5;
  return normalize(vec3(x, max(1.0 - abs(x) - abs(z), 0.0), z));
}
void main() {
  vec4 r0 = recAt(r, 0);
  vec4 r1 = recAt(r, 1);
  vec4 r2 = recAt(r, 2);
  tileAt(r2.w);
  float g = groundAt(r0.x, r0.y) * t.v.x + r0.z;
  float s = r1.y * keepOf(max(r1.x, r1.z), placeOf(r0.x, g + im.a.y * r1.y, r0.y));
  float h = g + im.a.y * s;
  vec3 c = placeOf(r0.x, h, r0.y);
  vec3 d = normalize(frame.eye.xyz - c);
  if (frame.pick.y > 0.5) {
    d = normalize(frame.sun.xyz);
  }
  float co = cos(r1.w);
  float si = sin(r1.w);
  float n = im.a.z;
  vec2 cell = clamp(floor(hemiOct(vec3(d.x * co + d.z * si, d.y, -d.x * si + d.z * co)) * n), vec2(0.0, 0.0), vec2(n - 1.0, n - 1.0));
  vec3 bd = hemiOctDir((cell + vec2(0.5, 0.5)) / n);
  vec3 dw = vec3(bd.x * co - bd.z * si, bd.y, bd.x * si + bd.z * co);
  vec3 right = cross(vec3(0.0, 1.0, 0.0), dw);
  if (length(right) < 0.001) {
    right = vec3(co, 0.0, si);
  }
  right = normalize(right);
  vec3 up = cross(dw, right);
  int k = gl_VertexID - (gl_VertexID / 6) * 6;
  float cx = (k == 1 || k == 2 || k == 4) ? 1.0 : -1.0;
  float cy = (k == 2 || k == 4 || k == 5) ? 1.0 : -1.0;
  vec3 p = c + (right * cx + up * cy) * im.a.x * s;
  gl_Position = clipOut(frame.viewProj * vec4(p, 1.0));
  v_col = unpackRGB(r2.x);
  v_world = p;
  v_id = r0.w;
  v_leaf = vec3(0.0, 0.0, 0.0);
  v_n = vec3(0.0, 1.0, 0.0);
  v_uv = (cell + vec2(cx * 0.5 + 0.5, 0.5 - cy * 0.5)) / n;
  v_turn = r1.w;
  v_ck = vec4(t.v.z, t.v.w, t.w.w, t.l.z);
  v_co = t.o;
}
`,
  fragment: /* glsl */ `${SOLID_FRAGMENT_LIB_GLSL}${IM}
uniform highp sampler2D atlas;
uniform highp sampler2D normals;
in vec3 v_col;
in vec3 v_world;
flat in float v_id;
in vec2 v_uv;
flat in float v_turn;
flat in vec4 v_ck;
flat in vec4 v_co;
out vec4 outColor;
void main() {
  tileIn(v_ck, v_co);
  if (t.v.w < 1.0 && dither(gl_FragCoord.xy) > t.v.w) {
    discard;
  }
  ivec2 px = ivec2(clamp(v_uv * im.a.w, vec2(0.0, 0.0), vec2(im.a.w - 1.0, im.a.w - 1.0)));
  vec4 a = texelFetch(atlas, px, 0);
  if (a.a < 0.5) {
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
  vec3 nl = texelFetch(normals, px, 0).xyz * 2.0 - vec3(1.0, 1.0, 1.0);
  float co = cos(v_turn);
  float si = sin(v_turn);
  vec3 nw = normalize(vec3(nl.x * co - nl.z * si, nl.y, nl.x * si + nl.z * co));
  outColor = vec4(shadeSolid(a.rgb * v_col, nw, v_world, v_id, 0.0), 1.0);
}
`,
};
