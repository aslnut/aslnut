// Twin of extrusion.wgsl.ts: the same functions in the same order.
import { FEATURE_GLSL } from './feature.glsl.ts';
import { LIGHT_GLSL } from './light.glsl.ts';

const COMMON = /* glsl */ `${FEATURE_GLSL}
layout(std140) uniform Params { /*@params*/ } params;
/*@functions*/
`;
export const EXTRUSION_GLSL = {
  vertex: /* glsl */ `${COMMON}
layout(location = 0) in vec4 v;
layout(location = 1) in vec4 n;
out vec4 v_col;
flat out float v_idx;
flat out vec4 v_state;
out vec3 v_world;
out vec3 v_normal;
out float v_up;
flat out float v_value;
out float v_shade;
float shade(vec3 nn, float top) {
  vec3 l = normalize(vec3(-0.45, 0.8, -0.35));
  return mix(0.62 + 0.38 * max(dot(nn, l), 0.0), 1.0, top * 0.35);
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
  float ex = u.origin.z;
  float grow = 1.0;
  float scale = motion.w;
  if (u.reveal.x == 9.0) {
    grow = state.z;
  }
  if (u.reveal.x == 8.0) {
    scale = scale * easeOutBack(state.z);
    grow = easeOutBack(state.z);
  }
  vec2 rel = box.xy + (v.xy - box.xy) * scale + vec2(motion.x, motion.y) / (RE * max(frame.misc.y, 0.01));
  float height = mix(nums.y, nums.x, u.look.z) * grow;
  float base = nums.w * ex + u.origin.w + motion.z + raiseOf(state);
  float h = min(v.z, nums.w) * ex - 30.0;
  if (n.w > 0.5) {
    h = base + max(height, 0.0);
  }
  float value = nums.z;
  float time = frame.eye.w;
  vec3 position = placeAt(rel, h);
  /*@position*/
  gl_Position = clipOut(frame.viewProj * vec4(liftToEye(position, u.a.x), 1.0));
  vec4 c = colourOf(idx, state);
  v_col = c;
  v_shade = shade(n.xyz, n.w);
  v_idx = idx;
  v_state = state;
  v_world = position;
  v_normal = n.xyz;
  v_up = n.w;
  v_value = value;
}
`,
  fragment: /* glsl */ `${COMMON}
${LIGHT_GLSL(1)}
in vec4 v_col;
flat in float v_idx;
flat in vec4 v_state;
in vec3 v_world;
in vec3 v_normal;
in float v_up;
flat in float v_value;
in float v_shade;
out vec4 outColor;
void main() {
  vec4 color = vec4(airFog(themed(mix(v_col.rgb * v_shade, sunLit(v_col.rgb, normalize(v_normal), v_world), frame.sunColor.w), max(v_state.x, v_state.y)), v_world), v_col.a);
  float alpha = color.a;
  float reveal = v_state.z;
  float mode = u.reveal.x;
  float time = frame.eye.w;
  float value = v_value;
  vec3 position = v_world;
  vec3 normal = v_normal;
  if (mode == 0.0 || mode == 7.0) {
    alpha = alpha * reveal;
  } else if (mode != 14.0) {
    alpha = alpha * step(0.001, reveal);
  }
  /*@color*/
  alpha = alpha * u.look.x * v_state.w;
  /*@alpha*/
  /*@reveal*/
  if (alpha <= 0.002) {
    discard;
  }
  if (frame.pick.y > 0.5) {
    outColor = packDepth(gl_FragCoord.z);
    return;
  }
  if (frame.pick.x > 0.5) {
    outColor = pickOut(u.hover2.w, v_idx);
    return;
  }
  outColor = vec4(color.rgb * mix(1.0, alpha, u.hover2.z), alpha);
}
`,
};
