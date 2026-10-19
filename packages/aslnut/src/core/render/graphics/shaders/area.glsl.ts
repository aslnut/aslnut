// Twin of area.wgsl.ts: the same functions in the same order.
import { FEATURE_GLSL } from './feature.glsl.ts';

const COMMON = /* glsl */ `${FEATURE_GLSL}
layout(std140) uniform Params { /*@params*/ } params;
/*@functions*/
`;
export const AREA_GLSL = {
  vertex: /* glsl */ `${COMMON}
layout(location = 0) in vec4 v;
out vec4 v_col;
out vec2 v_q;
flat out float v_idx;
flat out vec4 v_state;
out vec3 v_world;
flat out float v_value;
vec2 metresToRel(float e, float n) {
  return vec2(e, n) / (RE * max(frame.misc.y, 0.01));
}
void main() {
  float idx = v.w;
  vec4 state = featAt(idx, 2);
  vec4 motion = vec4(0.0, 0.0, 0.0, 1.0);
  if (u.reveal.y > 0.5) {
    motion = featAt(idx, 5);
  }
  vec4 box = featAt(idx, 4);
  vec4 nums = featAt(idx, 3);
  vec2 rel = v.xy;
  if (u.reveal.x == 4.0) {
    rel = box.xy + (rel - box.xy) * state.z;
  }
  rel = box.xy + (rel - box.xy) * motion.w + metresToRel(motion.x, motion.y);
  float value = nums.z;
  float time = frame.eye.w;
  float h = v.z * u.origin.z + u.origin.w + raiseOf(state) + motion.z + mix(nums.y, nums.x, u.look.z) * u.a.y;
  vec3 position = placeAt(rel, h);
  /*@position*/
  gl_Position = clipOut(frame.viewProj * vec4(liftToEye(position, u.a.x), 1.0));
  v_col = colourOf(idx, state);
  v_q = (v.xy - box.xy) / max(box.zw, vec2(0.0000001));
  v_idx = idx;
  v_state = state;
  v_world = position;
  v_value = value;
}
`,
  fragment: /* glsl */ `${COMMON}
in vec4 v_col;
in vec2 v_q;
flat in float v_idx;
flat in vec4 v_state;
in vec3 v_world;
flat in float v_value;
out vec4 outColor;
void main() {
  vec4 color = v_col;
  float alpha = color.a;
  float reveal = v_state.z;
  float mode = u.reveal.x;
  float time = frame.eye.w;
  float value = v_value;
  vec3 position = v_world;
  vec2 uv = v_q;
  if (mode == 3.0) {
    alpha = alpha * clamp(reveal * 2.0 - 1.0, 0.0, 1.0);
  } else if (mode == 4.0) {
    alpha = alpha * clamp(reveal * 3.0, 0.0, 1.0);
  } else if (mode == 5.0) {
    float e = -1.15 + 2.3 * reveal;
    alpha = alpha * (1.0 - smoothstep(e - 0.12, e + 0.12, v_q.x));
  } else if (mode == 6.0) {
    float e = reveal * 1.6;
    alpha = alpha * (1.0 - smoothstep(e - 0.15, e + 0.05, length(v_q)));
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
/** Twin of AREA_IMAGE_WGSL (area.wgsl.ts): the sampler is the texture's own on WebGL2 */
export const AREA_IMAGE_GLSL = /* glsl */ `uniform highp sampler2D img;
vec4 imageAt(vec2 uv) {
  vec4 c = textureLod(img, vec2(uv.x * 0.5 + 0.5, 0.5 - uv.y * 0.5), 0.0);
  return vec4(c.rgb / max(c.a, 0.0001), c.a);
}
`;
