// Twin of area-tile.wgsl.ts: the same functions in the same order.
import { FEATURE_GLSL } from './feature.glsl.ts';
import { TILE_GLSL } from './tile.glsl.ts';

const COMMON = /* glsl */ `${FEATURE_GLSL}${TILE_GLSL}
layout(std140) uniform Params { /*@params*/ } params;
/*@functions*/
`;
export const AREA_TILE_GLSL = {
  vertex: /* glsl */ `${COMMON}
flat out vec4 v_col;
flat out float v_idx;
flat out vec4 v_state;
flat out float v_value;
out vec2 v_rel;
flat out vec4 v_box;
vec2 metresToRel(float e, float n) {
  return vec2(e, n) / (RE * max(frame.misc.y, 0.01));
}
vec2 moved(vec2 r, vec4 box, vec4 state, vec4 motion) {
  vec2 p = r;
  if (u.reveal.x == 4.0) {
    p = box.xy + (p - box.xy) * state.z;
  }
  return box.xy + (p - box.xy) * motion.w + metresToRel(motion.x, motion.y);
}
void main() {
  int n = pieceOf(gl_VertexID / 3);
  int c = gl_VertexID % 3;
  vec4 t0 = pieceAt(n, 3, 0);
  vec4 t1 = pieceAt(n, 3, 1);
  float idx = t1.z;
  vec4 state = featAt(idx, 2);
  vec4 motion = vec4(0.0, 0.0, 0.0, 1.0);
  if (u.reveal.y > 0.5) {
    motion = featAt(idx, 5);
  }
  vec4 box = featAt(idx, 4);
  vec2 r = moved(t0.xy, box, state, motion);
  if (c == 1) {
    r = moved(t0.zw, box, state, motion);
  } else if (c == 2) {
    r = moved(t1.xy, box, state, motion);
  }
  gl_Position = tileClip(tileTexel(r));
  v_rel = r;
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
in vec2 v_rel;
flat in vec4 v_box;
out vec4 outColor;
void main() {
  vec3 position = placeAt(v_rel, 0.0);
  vec2 uv = (v_rel - v_box.xy) / max(v_box.zw, vec2(0.0000001));
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
  outColor = vec4(themed(color.rgb, max(v_state.x, v_state.y)) * mix(1.0, alpha, u.hover2.z), alpha);
}
`,
};
