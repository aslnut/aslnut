// Twin of line-drape.wgsl.ts: the same functions in the same order.
import { FEATURE_GLSL } from './feature.glsl.ts';
import { DRAPE_GLSL } from './drape.glsl.ts';

const COMMON = /* glsl */ `${FEATURE_GLSL}${DRAPE_GLSL}
layout(std140) uniform Params { /*@params*/ } params;
/*@functions*/
`;
export const LINE_DRAPE_GLSL = {
  vertex: /* glsl */ `${COMMON}
flat out vec4 v_col;
flat out vec3 v_a0;
flat out vec4 v_dir;
flat out vec3 v_side;
flat out vec4 v_ends;
flat out float v_halfw;
flat out float v_len;
flat out float v_idx;
flat out vec4 v_state;
flat out float v_value;
out vec3 v_world;
int boxCorner(int k) {
  const int t[36] = int[](0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5);
  return t[k];
}
int footCorner(int k) {
  const int t[6] = int[](0, 2, 1, 1, 2, 3);
  return t[k];
}
void main() {
  bool level0 = u.ground.z > 0.5 /*@flat*/;
  int per = 36;
  if (level0) {
    per = 6;
  }
  int n = gl_VertexID / per;
  int c = 0;
  if (level0) {
    c = footCorner(gl_VertexID % 6);
  } else {
    c = boxCorner(gl_VertexID % 36);
  }
  vec4 a = pieceAt(n, 5, 0);
  vec4 b = pieceAt(n, 5, 1);
  vec4 before = pieceAt(n, 5, 2);
  vec4 after = pieceAt(n, 5, 3);
  vec4 x = pieceAt(n, 5, 4);
  float idx = x.x;
  vec4 state = featAt(idx, 2);
  vec4 motion = vec4(0.0, 0.0, 0.0, 1.0);
  if (u.reveal.y > 0.5) {
    motion = featAt(idx, 5);
  }
  float w = u.a.x;
  if (u.a.y > 0.5) {
    w = w * featAt(idx, 3).x;
  }
  vec3 SP; vec3 SD; placeUp((c % 2) == 1 ? b.xy : a.xy, SP, SD);
  w = sizePx(w, u.size, SP);
  w = w + u.hover2.y * state.x + u.sel2.y * state.y;
  w = w * frame.size.z * motion.w;
  float halfw = w * 0.5 + 1.0;
  float lo = prismAt(0.0, x.zw);
  float hi = prismAt(1.0, x.zw);
  vec3 PA; vec3 DA; placeUp(a.xy, PA, DA);
  vec3 PB; vec3 DB; placeUp(b.xy, PB, DB);
  vec3 A0 = PA + lo * DA;
  vec3 B0 = PB + lo * DB;
  vec3 up = normalize(DA);
  vec3 ab = B0 - A0;
  float L = max(length(ab), 0.001);
  vec3 d = ab / L;
  vec3 side = normalize(cross(up, d));
  float end = float(c % 2);
  float s = float((c / 2) % 2) * 2.0 - 1.0;
  float level = float(c / 4);
  vec3 AP = end > 0.5 ? PB : PA;
  vec3 AD = end > 0.5 ? DB : DA;
  float ext = halfw * max(mppAt(AP + lo * AD), mppAt(AP + hi * AD)) * 1.5 + 0.5;
  vec3 corner = AP + prismAt(level, x.zw) * AD + side * s * ext + d * (end * 2.0 - 1.0) * ext;
  gl_Position = clipOut(frame.viewProj * vec4(corner, 1.0));
  v_world = corner;
  vec4 col = vec4(mix(u.c.rgb, u.hover.rgb, state.x), mix(u.c.a, 1.0, max(state.x, state.y)));
  if (u.b.w < 0.5) {
    col = colourOf(idx, state);
  }
  v_col = col;
  v_a0 = A0;
  v_dir = vec4(d, L);
  v_side = side;
  v_ends = vec4(a.w, b.w, before.w, after.w);
  v_halfw = halfw;
  v_len = x.y;
  v_idx = idx;
  v_state = state;
  v_value = featAt(idx, 3).z;
}
`,
  fragment: /* glsl */ `${COMMON}
flat in vec4 v_col;
flat in vec3 v_a0;
flat in vec4 v_dir;
flat in vec3 v_side;
flat in vec4 v_ends;
flat in float v_halfw;
flat in float v_len;
flat in float v_idx;
flat in vec4 v_state;
flat in float v_value;
in vec3 v_world;
out vec4 outColor;
void main() {
  vec4 g = groundAt(gl_FragCoord.xy);
  if (g.w < 0.5) {
    discard;
  }
  /*@upper*/
  vec3 position = g.xyz;
  if (u.ground.z > 0.5 /*@flat*/) {
    position = v_world;
  }
  vec3 rp = position - v_a0;
  float t = dot(rp, v_dir.xyz) / v_dir.w;
  float s = dot(rp, v_side);
  float mpp = mppAt(position);
  float across = s / mpp;
  if (t < 0.0) {
    if (v_ends.z > 0.5) {
      discard;
    }
    across = length(vec2(s, t * v_dir.w)) / mpp;
  } else if (t >= 1.0) {
    if (v_ends.w > 0.5) {
      discard;
    }
    across = length(vec2(s, (t - 1.0) * v_dir.w)) / mpp;
  }
  if (abs(across) > v_halfw) {
    discard;
  }
  vec4 color = v_col;
  float alpha = color.a * clamp(v_halfw - abs(across), 0.0, 1.0) * clamp((v_halfw - 1.0) * 2.0, 0.0, 1.0);
  float along = mix(v_ends.x, v_ends.y, clamp(t, 0.0, 1.0));
  float alongPx = along * v_len / max(mpp / max(frame.size.z, 0.001), 0.000001);
  float time = frame.eye.w;
  float value = v_value;
  float reveal = v_state.z;
  float mode = u.reveal.x;
  // dashes, flowing along at u.b.y px a second (0: still)
  float dashP = max(u.a.z + u.a.w, 0.0001);
  float dashAt = alongPx - time * u.b.y;
  if (u.a.z > 0.0 && mod(dashAt, dashP) > u.a.z) {
    discard;
  }
  if (mode == 1.0 || mode == 3.0) {
    float p = reveal;
    if (mode == 3.0) {
      p = clamp(reveal * 2.0, 0.0, 1.0);
    }
    float soft = max(u.reveal.z, 0.001);
    alpha = alpha * (1.0 - smoothstep(p - soft, p, along)) * step(0.0001, p);
    float head = u.reveal.w * exp(-abs(along - p) / soft * 2.0) * step(along, p + soft) * (1.0 - step(1.0, p));
    color = vec4(color.rgb + vec3(head), color.a);
  } else if (mode == 2.0) {
    float k = fract(along - time * 0.35);
    color = vec4(color.rgb + vec3(u.b.x * exp(-k * 12.0)), color.a);
    alpha = alpha * reveal;
  } else if (mode != 14.0) {
    alpha = alpha * reveal;
  }
  // a trail (c: now, window, on, head; along = time): drawn up to now, fading over the window, a glowing head
  if (u.b.w < 0.5 && u.c.z > 0.5) {
    float age = u.c.x - along;
    alpha = alpha * step(0.0, age) * (1.0 - smoothstep(u.c.y * 0.35, u.c.y, age));
    color = vec4(color.rgb + vec3(u.c.w * exp(-age / max(u.c.y * 0.06, 0.000001))), color.a);
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
