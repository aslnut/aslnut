// Twin of solid-inst.wgsl.ts: the instances' vertex stage (each clone its record in a texture, its parts moved by their
// joints); the fragment stage is the solids' own.
import { SOLID_FRAGMENT_GLSL, SOLID_VERTEX_COMMON_GLSL } from './solid.glsl.ts';

export const SOLID_SET_GLSL = /* glsl */ `
layout(std140) uniform S { vec4 a; vec4 b; vec4 c; vec4 d; vec4 j[32]; vec4 e[6]; } si;
uniform highp sampler2D recs;
vec4 recAt(float r, int k) {
  int a = int(r + 0.5) + k;
  int w = textureSize(recs, 0).x;
  return texelFetch(recs, ivec2(a % w, a / w), 0);
}
void tileAt(float slot) {
  int s = int(slot + 0.5) * 2;
  vec4 a = texelFetch(recs, ivec2(s, 0), 0);
  vec4 b = texelFetch(recs, ivec2(s + 1, 0), 0);
  t = Tile(a, vec4(tb.v.x, tb.v.y, b.x, b.y), vec4(tb.w.xyz, slot), vec4(tb.l.x, tb.l.y, b.w, b.z));
}
float keepOf(float scale, vec3 p) {
  return si.a.y > 0.5 ? sizeKeep(si.a.x * scale, vec4(1.0, si.a.z, si.a.w, 0.0), p) : 1.0;
}
vec3 rotAxis(vec3 p, vec3 a, float t) {
  float c = cos(t);
  return p * c + cross(a, p) * sin(t) + a * dot(a, p) * (1.0 - c);
}
float jointFormula(int k, float time, float seed) {
  /*@jointFormula*/
  return 0.0;
}
float jointValue(int k, float r, float seed) {
  vec4 d = si.j[k * 4 + 2];
  vec4 s = si.j[k * 4 + 3];
  float v = 0.0;
  if (d.x == 1.0) {
    float rate = d.y;
    float phase = seed * 6.2831853;
    if (s.y >= 0.0) {
      vec4 q = recAt(r, int(s.y + 0.5) / 4);
      bool even = (int(s.y + 0.5) % 4) == 0;
      rate = even ? q.x : q.z;
      phase = even ? q.y : q.w;
    }
    v = phase + rate * (frame.eye.w - si.c.x) + s.z;
  } else if (d.x == 2.0) {
    v = jointFormula(k, frame.eye.w, seed) * (si.j[k * 4].w == 3.0 ? 1.0 : 0.017453293);
  }
  if (d.z < d.w) {
    v = clamp(v, d.z, d.w);
  }
  return v;
}
vec4 partPivot(int part) {
  if (part == 0) {
    return vec4(0.0);
  }
  for (int k = 0; k < int(si.c.y); k++) {
    if (int(si.j[k * 4 + 3].x + 0.5) == part) {
      return vec4(si.j[k * 4].xyz, 1.0);
    }
  }
  return vec4(0.0);
}
void jointMove(vec3 q, vec3 n, int part, float r, float seed, out vec3 mq, out vec3 mn) {
  mq = q;
  mn = n;
  if (part == 0) {
    return;
  }
  for (int k = 0; k < int(si.c.y); k++) {
    if (int(si.j[k * 4 + 3].x + 0.5) != part) {
      continue;
    }
    vec4 pv = si.j[k * 4];
    vec3 ax = si.j[k * 4 + 1].xyz;
    float v = jointValue(k, r, seed);
    if (pv.w == 3.0) {
      mq = mq + ax * v;
    } else {
      mq = pv.xyz + rotAxis(mq - pv.xyz, ax, v);
      mn = rotAxis(mn, ax, v);
    }
  }
}
`;

export const SOLID_INST_GLSL = {
  vertex: /* glsl */ `${SOLID_VERTEX_COMMON_GLSL}${SOLID_SET_GLSL}
layout(location = 0) in float r;
layout(location = 3) in vec4 v;
layout(location = 4) in float vc;
layout(location = 5) in float card;
void main() {
  vec4 r0 = recAt(r, 0);
  vec4 r1 = recAt(r, 1);
  vec4 r2 = recAt(r, 2);
  tileAt(r2.w);
  bool leafy = card >= 65536.0;
  int ci = leafy ? 0 : int(card + 0.5);
  int lo = ci % 512;
  int piece = ci / 512;
  vec3 mq; vec3 mn;
  jointMove(v.xyz, unpackNormal(v.w), piece % 16, r, r2.z, mq, mn);
  float c = cos(r1.w);
  float s = sin(r1.w);
  float g = groundAt(r0.x, r0.y) * t.v.x + r0.z;
  float keep = keepOf(max(r1.x, r1.z), placeOf(r0.x, g + si.a.x * 0.5 * r1.y, r0.y));
  vec4 pp = partPivot(piece % 16);
  vec3 q = (pp.w > 0.5 ? pp.xyz * r1.xyz + (mq - pp.xyz) * r1.x : mq * r1.xyz) * keep;
  vec3 rr = vec3(q.x * c - q.z * s, q.y, q.x * s + q.z * c);
  float h = g + rr.y;
  vec3 position = placeOf(r0.x + rr.x, h, r0.y + rr.z);
  vec3 n = pp.w > 0.5 ? mn : mn / r1.xyz;
  vec3 tint = unpackRGB(r2.x);
  bool own = !leafy && lo >= 256;
  int grp = piece / 16;
  if (si.b.w > 0.5 && grp > 0 && grp <= 4) {
    float gt = recAt(r, 3)[grp - 1];
    if (gt >= 0.0) {
      tint = unpackRGB(gt);
      own = false;
    }
  }
  v_col = (own ? vec3(1.0) : tint) * unpackRGB(vc);
  float code = leafy ? card : float(lo % 256);
  v_n = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  v_id = r0.w;
  v_leaf = leafy ? unpackCard(card) : vec3(0.0, 0.0, -code);
  if (v_leaf.z > 0.5) {
    v_leaf.z = v_leaf.z + 0.45 * clamp(1.0 - r2.y, 0.0, 1.0);
  }
  v_ck = vec4(t.v.z, t.v.w, t.w.w, t.l.z);
  v_co = t.o;
  /*@mvinputs*/
  /*@mvertex*/
  /*@mvoutputs*/
  gl_Position = clipOut(frame.viewProj * vec4(towardEye(position), 1.0));
  v_world = position;
}
`,
  fragment: SOLID_FRAGMENT_GLSL,
};
