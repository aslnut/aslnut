// Twin of custom-mesh.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from './frame.glsl.ts';

const COMMON = /* glsl */ `${FRAME_GLSL}
layout(std140) uniform U { vec4 misc; vec4 pt; vec4 size; } u;
layout(std140) uniform Params { /*@params*/ } params;
/*@textures*/
vec3 lambert(vec3 n) {
  return frame.sunColor.w > 0.5 ? frame.ambient.rgb + frame.sunColor.rgb * max(dot(n, frame.sun.xyz), 0.0) : vec3(1.0);
}
/*@functions*/
`;
export const CUSTOM_MESH_GLSL = {
  vertex: /* glsl */ `${COMMON}
layout(location = 0) in vec3 a_position;
layout(location = 1) in vec3 a_normal;
layout(location = 2) in vec2 a_uv;
layout(location = 3) in vec4 a_color;
layout(location = 4) in vec4 i_at;
/*@attributes*/
out vec2 v_uv;
out vec3 v_normal;
out vec3 v_world;
out vec4 v_color;
flat out float v_inst;
out vec2 v_corner;
/*@varyings*/
vec2 cornerOf(int v) {
  float x = (v == 1 || v == 4 || v == 5) ? 1.0 : -1.0;
  float y = (v == 2 || v == 3 || v == 5) ? 1.0 : -1.0;
  return vec2(x, y);
}
void main() {
  vec3 position = a_position;
  vec3 normal = a_normal;
  vec2 uv = a_uv;
  vec4 color = a_color;
  float time = frame.eye.w;
  vec3 eye = frame.eye.xyz;
  vec3 origin = i_at.xyz;
  /*@inputs*/
  /*@vertex*/
  float keep = u.size.w > 0.5 ? sizeKeep(u.size.x, vec4(1.0, u.size.y, u.size.z, 0.0), i_at.xyz) : 1.0;
  vec3 world = i_at.xyz + position * keep;
  vec4 clip = frame.viewProj * vec4(world, 1.0);
  vec2 corner = vec2(0.0);
  if (u.pt.y > 0.5) {
    corner = cornerOf(gl_VertexID % 6);
    clip = vec4(clip.xy + corner * u.pt.x * frame.size.z / frame.size.xy * clip.w, clip.z, clip.w);
  }
  gl_Position = clipOut(vec4(clip.xy, clip.z - u.misc.x * clip.w, clip.w));
  v_uv = uv;
  v_normal = normal;
  v_world = world;
  v_color = color;
  v_inst = float(gl_InstanceID);
  v_corner = corner;
  /*@outputs*/
}
`,
  fragment: /* glsl */ `${COMMON}
in vec2 v_uv;
in vec3 v_normal;
in vec3 v_world;
in vec4 v_color;
flat in float v_inst;
in vec2 v_corner;
/*@varyings*/
out vec4 outColor;
void main() {
  if (frame.pick.y > 0.5) {
    outColor = packDepth(gl_FragCoord.z);
    return;
  }
  if (frame.pick.x > 0.5) {
    outColor = pickOut(u.misc.y, v_inst);
    return;
  }
  vec2 uv = v_uv;
  vec3 normal = normalize(v_normal);
  vec3 position = v_world;
  float time = frame.eye.w;
  vec2 corner = v_corner;
  vec4 color = v_color;
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
