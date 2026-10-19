// Twin of line-tile.wgsl.ts: the same functions in the same order.
import { FEATURE_GLSL } from './feature.glsl.ts';
import { TILE_GLSL } from './tile.glsl.ts';

const COMMON = /* glsl */ `${FEATURE_GLSL}${TILE_GLSL}
layout(std140) uniform Params { /*@params*/ } params;
/*@functions*/
`;
export const LINE_TILE_GLSL = {
  vertex: /* glsl */ `${COMMON}
flat out vec4 v_col;
flat out vec2 v_a0;
flat out vec3 v_dir;
flat out vec2 v_side;
flat out vec4 v_ends;
flat out float v_halfw;
flat out float v_len;
flat out float v_idx;
flat out vec4 v_state;
flat out float v_value;
out vec2 v_p;
int quadCorner(int k) {
  const int t[6] = int[](0, 2, 1, 1, 2, 3);
  return t[k];
}
void main() {
  int n = pieceOf(gl_VertexID / 6);
  int c = quadCorner(gl_VertexID % 6);
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
  w = tileSizePx(w, u.size, (tileTexel(a.xy) + tileTexel(b.xy)) * 0.5);
  w = w + u.hover2.y * state.x + u.sel2.y * state.y;
  w = w * frame.size.z * motion.w;
  float halfw = w * 0.5 + 1.0;
  vec2 A = tileTexel(a.xy);
  vec2 B = tileTexel(b.xy);
  vec2 ab = B - A;
  float L = max(length(ab), 0.0001);
  vec2 d = ab / L;
  vec2 side = vec2(-d.y, d.x);
  float end = float(c % 2);
  float s = float((c / 2) % 2) * 2.0 - 1.0;
  // (wide enough wherever in the tile the segment lies: the most texels a pixel anywhere in it)
  float ext = halfw * tile.k.z + 1.0;
  vec2 at = A;
  if (end > 0.5) {
    at = B;
  }
  vec2 corner = at + side * s * ext + d * (end * 2.0 - 1.0) * ext;
  gl_Position = tileClip(corner);
  v_p = corner;
  vec4 col = vec4(mix(u.c.rgb, u.hover.rgb, state.x), mix(u.c.a, 1.0, max(state.x, state.y)));
  if (u.b.w < 0.5) {
    col = colourOf(idx, state);
  }
  v_col = col;
  v_a0 = A;
  v_dir = vec3(d, L);
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
flat in vec2 v_a0;
flat in vec3 v_dir;
flat in vec2 v_side;
flat in vec4 v_ends;
flat in float v_halfw;
flat in float v_len;
flat in float v_idx;
flat in vec4 v_state;
flat in float v_value;
in vec2 v_p;
out vec4 outColor;
void main() {
  vec3 position = placeAt(tileRel(v_p), 0.0);
  vec2 rp = v_p - v_a0;
  float t = dot(rp, v_dir.xy) / v_dir.z;
  float s = dot(rp, v_side);
  float k = tilePx(v_p);
  float across = s / k;
  if (t < 0.0) {
    if (v_ends.z > 0.5) {
      discard;
    }
    across = length(vec2(s, t * v_dir.z)) / k;
  } else if (t >= 1.0) {
    if (v_ends.w > 0.5) {
      discard;
    }
    across = length(vec2(s, (t - 1.0) * v_dir.z)) / k;
  }
  if (abs(across) > v_halfw) {
    discard;
  }
  vec4 color = v_col;
  float ramp = max(1.0 - 1.0 / k, min(1.0, 1.0 / k));
  float alpha = color.a * clamp((v_halfw - 0.5 + ramp * 0.5 - abs(across)) / ramp, 0.0, 1.0) * clamp((v_halfw - 1.0) * 2.0, 0.0, 1.0);
  float along = mix(v_ends.x, v_ends.y, clamp(t, 0.0, 1.0));
  float mpp = tile.k.w * k;
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
    float q = fract(along - time * 0.35);
    color = vec4(color.rgb + vec3(u.b.x * exp(-q * 12.0)), color.a);
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
  outColor = vec4(themed(color.rgb, max(v_state.x, v_state.y)) * mix(1.0, alpha, u.hover2.z), alpha);
}
`,
};
