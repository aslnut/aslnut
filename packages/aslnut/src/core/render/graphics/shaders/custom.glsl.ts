// Twin of custom.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from './frame.glsl.ts';

const COMMON = /* glsl */ `${FRAME_GLSL}
layout(std140) uniform U { vec4 misc; vec4 size; } u;
layout(std140) uniform Params { /*@params*/ } params;
/*@functions*/
`;
export const CUSTOM_GLSL = {
  vertex: /* glsl */ `${COMMON}
layout(location = 0) in vec4 at;
/*@attributes*/
out vec2 v_corner;
/*@varyings*/
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
  vec2 corner = cornerOf(gl_VertexID);
  vec3 position = at.xyz;
  float size = at.w;
  float time = frame.eye.w;
  if (u.misc.y > 0.5) {
    size = u.size.x > 0.5 ? size * sizeKeep(size, u.size, position) : sizePx(size, u.size, position) * cssMpp(position);
  } else {
    size = sizePx(size, u.size, position);
  }
  /*@inputs*/
  /*@vertex*/
  vec4 clip = frame.viewProj * vec4(position, 1.0);
  if (u.misc.y > 0.5) {
    clip = frame.viewProj * vec4(position + vec3(corner.x, 0.0, -corner.y) * size * 0.5, 1.0);
  } else {
    clip = frame.viewProj * vec4(towardEye(position, size), 1.0);
    clip = vec4(clip.xy + corner * size * frame.size.z / frame.size.xy * clip.w, clip.z, clip.w);
  }
  gl_Position = clipOut(vec4(clip.xy, clip.z - u.misc.x * clip.w, clip.w));
  v_corner = corner;
  /*@outputs*/
}
`,
  fragment: /* glsl */ `${COMMON}
in vec2 v_corner;
/*@varyings*/
out vec4 outColor;
void main() {
  vec2 corner = v_corner;
  float time = frame.eye.w;
  vec4 color = vec4(1.0);
  /*@finputs*/
  /*@fragment*/
  float alpha = color.a * u.misc.z * u.misc.w;
  if (alpha <= 0.002) {
    discard;
  }
  outColor = vec4(themed(color.rgb, 0.0), alpha);
}
`,
};
