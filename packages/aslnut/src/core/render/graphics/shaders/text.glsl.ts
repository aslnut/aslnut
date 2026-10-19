// Twin of text.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from './frame.glsl.ts';

const COMMON = /* glsl */ `${FRAME_GLSL}
layout(std140) uniform T { vec4 misc; vec4 hov; } u;
layout(std140) uniform Params { /*@params*/ } params;
uniform highp sampler2D atlas;
/*@functions*/
`;
export const TEXT_GLSL = {
  vertex: /* glsl */ `${COMMON}
layout(location = 0) in vec4 at;
layout(location = 1) in vec4 box;
layout(location = 2) in vec4 uvr;
layout(location = 3) in vec4 extra;
out vec2 v_uv;
out vec2 v_t;
flat out vec4 v_extra;
vec2 quadCorner(int v) {
  float x = (v == 1 || v == 4 || v == 5) ? 1.0 : 0.0;
  float y = (v == 2 || v == 3 || v == 5) ? 1.0 : 0.0;
  return vec2(x, y);
}
void main() {
  vec2 c = quadCorner(gl_VertexID);
  vec4 clip = frame.viewProj * vec4(at.xyz, 1.0);
  vec2 px = (vec2(c.x - 0.5, 0.5 - c.y) * box.xy + vec2(box.z, -box.w)) * frame.size.z;
  gl_Position = clipOut(vec4(clip.xy + px / (frame.size.xy * 0.5) * clip.w, clip.z - u.misc.x * clip.w, clip.w));
  v_uv = mix(uvr.xy, uvr.zw, c);
  v_t = c;
  v_extra = extra;
}
`,
  fragment: /* glsl */ `${COMMON}
in vec2 v_uv;
in vec2 v_t;
flat in vec4 v_extra;
out vec4 outColor;
void main() {
  vec4 color = textureLod(atlas, v_uv, 0.0);
  float hov = (v_extra.w == 1.0 || v_extra.w == 3.0) ? 1.0 : 0.0;
  color = vec4(mix(color.rgb, u.hov.rgb, u.hov.a * hov * color.a), color.a);
  float alpha = color.a * v_extra.x;
  vec2 uv = v_t;
  float time = frame.eye.w;
  float reveal = v_extra.y;
  if (u.misc.z == 11.0) {
    alpha = alpha * step(uv.x, reveal + 0.0001);
  } else if (u.misc.z == 13.0) {
    alpha = alpha * (1.0 - smoothstep(reveal * 1.2 - 0.2, reveal * 1.2, uv.x));
  } else if (u.misc.z != 12.0 && u.misc.z != 14.0) {
    alpha = alpha * reveal;
  }
  /*@color*/
  /*@alpha*/
  /*@reveal*/
  if (alpha <= 0.004) {
    discard;
  }
  if (frame.pick.x > 0.5) {
    outColor = pickOut(u.misc.y, v_extra.z);
    return;
  }
  outColor = vec4(themed(color.rgb, step(0.5, v_extra.w)), alpha);
}
`,
};
