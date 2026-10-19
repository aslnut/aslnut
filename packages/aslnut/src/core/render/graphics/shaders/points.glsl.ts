// Twin of points.wgsl.ts: the same functions in the same order.
import { FEATURE_GLSL } from './feature.glsl.ts';

const COMMON = /* glsl */ `${FEATURE_GLSL}
layout(std140) uniform Params { /*@params*/ } params;
/*@functions*/
bool behindGlobe(vec3 p) {
  return frame.size.w < 0.5 && dot(p - vec3(0.0, -RE, 0.0), frame.eye.xyz - p) < 0.0;
}
`;
export const POINTS_GLSL = {
  vertex: /* glsl */ `${COMMON}
layout(location = 0) in vec4 at;
out vec2 v_corner;
out vec4 v_col;
out vec3 v_world;
out vec4 v_extra;
out float v_size;
out float v_reveal;
out float v_ring;
vec3 towardEye(vec3 p, float discPx) {
  vec3 toEye = frame.eye.xyz - p;
  float d = length(toEye);
  float mpp = 2.0 * d * frame.misc.z / frame.size.y;
  return p + toEye / max(d, 0.001) * min(discPx * frame.size.z * 0.5 * mpp, d * 0.5);
}
vec2 cornerOf(int v) {
  float x = (v == 1 || v == 4 || v == 5) ? 1.0 : -1.0;
  float y = (v == 2 || v == 3 || v == 5) ? 1.0 : -1.0;
  return vec2(x, y);
}
void main() {
  float idx = at.w;
  vec4 state = featAt(idx, 2);
  v_corner = vec2(0.0);
  v_col = vec4(0.0);
  v_world = vec3(0.0);
  v_extra = vec4(0.0);
  v_size = 1.0;
  v_reveal = 0.0;
  v_ring = 0.0;
  if (state.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec4 nums = featAt(idx, 3);
  vec2 corner = cornerOf(gl_VertexID);
  vec3 position = placeAt(at.xy, at.z * u.origin.z + u.origin.w);
  bool hide = behindGlobe(position);
  float hov = state.x;
  float sel = state.y;
  float ring = u.a.x + u.hover2.y * hov + u.sel2.y * sel;
  float grow = 1.0;
  float reveal = state.z;
  if (u.reveal.x == 8.0) {
    grow = max(0.0, easeOutBack(state.z));
    reveal = min(1.0, state.z * 4.0);
  }
  float size = sizePx(mix(nums.y, nums.x, u.look.z), u.size, position) * grow * mix(1.0, u.a.z, hov) * mix(1.0, u.a.w, sel) + 2.0 * (ring - u.a.x);
  float value = nums.z;
  float time = frame.eye.w;
  /*@position*/
  vec3 lifted = towardEye(position, size);
  vec4 clip = frame.viewProj * vec4(lifted, 1.0);
  vec2 off = corner * size * frame.size.z / frame.size.xy * clip.w;
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : clipOut(vec4(clip.xy + off, clip.z - u.a.y * clip.w, clip.w));
  v_corner = corner;
  v_world = position;
  v_extra = vec4(value, state.w, idx, hov + 2.0 * sel);
  v_size = size * frame.size.z;
  v_reveal = reveal;
  v_ring = ring;
  v_col = colourOf(idx, state);
}
`,
  fragment: /* glsl */ `${COMMON}
in vec2 v_corner;
in vec4 v_col;
in vec3 v_world;
in vec4 v_extra;
in float v_size;
in float v_reveal;
in float v_ring;
out vec4 outColor;
void main() {
  float r = length(v_corner);
  float px = 2.0 / max(v_size, 1.0);
  float disc = 1.0 - smoothstep(1.0 - px, 1.0, r);
  float ring = smoothstep(1.0 - px * (v_ring + 1.0), 1.0 - px * v_ring, r);
  float hov = (v_extra.w == 1.0 || v_extra.w == 3.0) ? 1.0 : 0.0;
  float sel = v_extra.w >= 2.0 ? 1.0 : 0.0;
  vec3 oc = mix(mix(u.b.rgb, u.sel.rgb, sel), u.hover.rgb, hov);
  float oa = max(u.b.a, max(hov, sel));
  vec4 color = vec4(mix(v_col.rgb, oc, ring * oa), v_col.a * disc);
  vec2 uv = v_corner;
  float value = v_extra.x;
  float time = frame.eye.w;
  vec3 position = v_world;
  /*@color*/
  float alpha = color.a * u.look.x * v_extra.y;
  /*@alpha*/
  float reveal = v_reveal;
  /*@reveal*/
  if (alpha <= 0.002) {
    discard;
  }
  if (frame.pick.x > 0.5) {
    outColor = pickOut(u.hover2.w, v_extra.z);
    return;
  }
  outColor = vec4(themed(color.rgb, max(hov, sel)), alpha);
}
`,
};
