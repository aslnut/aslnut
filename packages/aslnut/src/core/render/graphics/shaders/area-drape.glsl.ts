// Twin of area-drape.wgsl.ts: the same functions in the same order.
import { FEATURE_GLSL } from './feature.glsl.ts';
import { DRAPE_GLSL } from './drape.glsl.ts';

const COMMON = /* glsl */ `${FEATURE_GLSL}${DRAPE_GLSL}
layout(std140) uniform Params { /*@params*/ } params;
/*@functions*/
`;
export const AREA_DRAPE_GLSL = {
  vertex: /* glsl */ `${COMMON}
flat out vec4 v_col;
flat out float v_idx;
flat out vec4 v_state;
flat out float v_value;
flat out vec4 v_pa;
flat out vec4 v_pb;
flat out vec4 v_pc;
flat out vec3 v_ks;
flat out vec4 v_rab;
flat out vec2 v_rc;
flat out vec4 v_box;
out vec3 v_world;
vec2 metresToRel(float e, float n) {
  return vec2(e, n) / (RE * max(frame.misc.y, 0.01));
}
int prismCorner(int k) {
  const int t[24] = int[](3, 4, 5, 0, 2, 1, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 2, 0, 3, 2, 3, 5);
  return t[k];
}
int footCorner(int k) {
  const int t[3] = int[](0, 2, 1);
  return t[k];
}
vec2 moved(vec2 r, vec4 box, vec4 state, vec4 motion) {
  vec2 p = r;
  if (u.reveal.x == 4.0) {
    p = box.xy + (p - box.xy) * state.z;
  }
  return box.xy + (p - box.xy) * motion.w + metresToRel(motion.x, motion.y);
}
void main() {
  bool level0 = u.ground.z > 0.5 /*@flat*/;
  int per = 24;
  if (level0) {
    per = 3;
  }
  int n = gl_VertexID / per;
  int c = 0;
  if (level0) {
    c = footCorner(gl_VertexID % 3);
  } else {
    c = prismCorner(gl_VertexID % 24);
  }
  vec4 t0 = pieceAt(n, 3, 0);
  vec4 t1 = pieceAt(n, 3, 1);
  vec4 t2 = pieceAt(n, 3, 2);
  float idx = t1.z;
  vec4 state = featAt(idx, 2);
  vec4 motion = vec4(0.0, 0.0, 0.0, 1.0);
  if (u.reveal.y > 0.5) {
    motion = featAt(idx, 5);
  }
  vec4 box = featAt(idx, 4);
  vec2 ra = moved(t0.xy, box, state, motion);
  vec2 rb = moved(t0.zw, box, state, motion);
  vec2 rc = moved(t1.xy, box, state, motion);
  vec3 A; vec3 DA; placeUp(ra, A, DA);
  vec3 B; vec3 DB; placeUp(rb, B, DB);
  vec3 C; vec3 DC; placeUp(rc, C, DC);
  int v = c % 3;
  vec3 P = A;
  vec3 D = DA;
  if (v == 1) {
    P = B;
    D = DB;
  } else if (v == 2) {
    P = C;
    D = DC;
  }
  vec3 corner = P + prismAt(float(c / 3), t2.xy) * D;
  gl_Position = clipOut(frame.viewProj * vec4(corner, 1.0));
  v_world = corner;
  vec3 UA = A + 1000.0 * DA;
  vec3 UB = B + 1000.0 * DB;
  vec3 UC = C + 1000.0 * DC;
  v_pa = edgePlane(rb, rc, B, UB, C, UC);
  v_pb = edgePlane(rc, ra, C, UC, A, UA);
  v_pc = edgePlane(ra, rb, A, UA, B, UB);
  v_ks = vec3(dot(v_pa.xyz, A) + v_pa.w, dot(v_pb.xyz, B) + v_pb.w, dot(v_pc.xyz, C) + v_pc.w);
  v_rab = vec4(ra, rb);
  v_rc = rc;
  v_box = box;
  v_col = colourOf(idx, state);
  v_idx = idx;
  v_state = state;
  v_value = featAt(idx, 3).z;
}
`,
  fragment: /* glsl */ `${COMMON}
flat in vec4 v_col;
flat in float v_idx;
flat in vec4 v_state;
flat in float v_value;
flat in vec4 v_pa;
flat in vec4 v_pb;
flat in vec4 v_pc;
flat in vec3 v_ks;
flat in vec4 v_rab;
flat in vec2 v_rc;
flat in vec4 v_box;
in vec3 v_world;
out vec4 outColor;
void main() {
  vec4 g = groundAt(gl_FragCoord.xy);
  if (g.w < 0.5) {
    discard;
  }
  /*@upper*/
  bool level = u.ground.z > 0.5 /*@flat*/;
  vec3 position = g.xyz;
  if (level) {
    position = v_world;
  }
  float sa = dot(v_pa.xyz, position) + v_pa.w;
  float sb = dot(v_pb.xyz, position) + v_pb.w;
  float sc = dot(v_pc.xyz, position) + v_pc.w;
  if (!level && (!inSide(sa, v_ks.x) || !inSide(sb, v_ks.y) || !inSide(sc, v_ks.z))) {
    discard;
  }
  vec2 rel = v_rab.xy * (sa / v_ks.x) + v_rab.zw * (sb / v_ks.y) + v_rc * (sc / v_ks.z);
  vec2 uv = (rel - v_box.xy) / max(v_box.zw, vec2(0.0000001));
  vec4 color = v_col;
  float alpha = color.a;
  float reveal = v_state.z;
  float mode = u.reveal.x;
  float time = frame.eye.w;
  float value = v_value;
  if (mode == 3.0) {
    alpha = alpha * clamp(reveal * 2.0 - 1.0, 0.0, 1.0);
  } else if (mode == 4.0) {
    alpha = alpha * clamp(reveal * 3.0, 0.0, 1.0);
  } else if (mode == 5.0) {
    float e = -1.15 + 2.3 * reveal;
    alpha = alpha * (1.0 - smoothstep(e - 0.12, e + 0.12, uv.x));
  } else if (mode == 6.0) {
    float e = reveal * 1.6;
    alpha = alpha * (1.0 - smoothstep(e - 0.15, e + 0.05, length(uv)));
  } else if (mode != 14.0) {
    alpha = alpha * reveal;
  }
  /*@color*/
  alpha = alpha * u.look.x * v_state.w;
  /*@alpha*/
  /*@reveal*/
  if (alpha <= 0.002) {
    discard;
  }
  if (frame.pick.x > 0.5) {
    outColor = pickOut(u.hover2.w, v_idx);
    return;
  }
  outColor = vec4(themed(color.rgb, max(v_state.x, v_state.y)) * mix(1.0, alpha, u.hover2.z), alpha);
}
`,
};
