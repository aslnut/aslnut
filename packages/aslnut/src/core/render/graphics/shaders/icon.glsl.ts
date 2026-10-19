// Twin of icon.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from './frame.glsl.ts';
import { ANCHOR_FOLLOW_GLSL, ANCHOR_STILL_GLSL } from './anchors.glsl.ts';
import { setsTrackGLSL } from './sets.glsl.ts';
import type { SetsVariant } from './sets.wgsl.ts';

const ICON_VS = /* glsl */ `
out vec2 vUv;
flat out vec4 vCell;
flat out vec4 vTint;
flat out float vId;
vec2 iconCorner(int v) {
  float x = (v == 1 || v == 3) ? 1.0 : -1.0;
  float y = v >= 2 ? 1.0 : -1.0;
  return vec2(x, y);
}
vec4 iconItem(int e, int k) {
  int i = e * 2 + k;
  return texelFetch(items, ivec2(i % 4096, i / 4096), 0);
}
float iconAngle(vec3 p, float h) {
  vec4 a = frame.viewProj * vec4(p, 1.0);
  vec4 b = frame.viewProj * vec4(p + vec3(sin(h), 0.0, -cos(h)), 1.0);
  vec2 d = (b.xy / max(b.w, 0.001) - a.xy / max(a.w, 0.001)) * frame.size.xy;
  return dot(d, d) > 1e-12 ? atan(d.x, d.y) : 0.0;
}
void main() {
  int e = gl_InstanceID;
  vec4 a = anchorOf(e);
  vec4 it = iconItem(e, 0);
  vec2 corner = iconCorner(gl_VertexID);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vUv = vec2(0.0);
  vCell = vec4(0.0);
  vTint = vec4(0.0);
  vId = float(e);
  if (a.w < 0.5 || it.x < 0.0 || anchorShaped(e) || anchorBehind(a.xyz)) {
    return;
  }
  float size = sizePx(it.y, u.size, a.xyz);
  float ang = u.look.w > 0.5 ? iconAngle(a.xyz, anchorTurn(e)) : 0.0;
  float c = cos(ang);
  float sn = sin(ang);
  vec2 r = vec2(corner.x * c + corner.y * sn, -corner.x * sn + corner.y * c);
  vec4 clip = frame.viewProj * vec4(a.xyz, 1.0);
  if (clip.w < 0.01) {
    return;
  }
  vec2 off = r * size * frame.size.z / frame.size.xy * clip.w;
  gl_Position = clipOut(vec4(clip.xy + off, clip.z, clip.w));
  vUv = vec2(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5);
  float col = mod(it.x, u.look.y);
  float row = floor(it.x / u.look.y);
  vCell = vec4(col / u.look.y, row / u.look.z, 1.0 / u.look.y, 1.0 / u.look.z);
  vTint = iconItem(e, 1);
}
`;
const ICON_FS = /* glsl */ `
in vec2 vUv;
flat in vec4 vCell;
flat in vec4 vTint;
flat in float vId;
out vec4 outColor;
void main() {
  vec2 q = clamp(vUv, vec2(0.0), vec2(1.0));
  vec2 dx = dFdx(q) * 0.25;
  vec2 dy = dFdy(q) * 0.25;
  vec2 at = vCell.xy + q * vCell.zw;
  vec2 k = vCell.zw;
  vec4 c = (textureLod(atlas, at + (dx + dy) * k, 0.0) + textureLod(atlas, at + (dx - dy) * k, 0.0) + textureLod(atlas, at - (dx - dy) * k, 0.0) + textureLod(atlas, at - (dx + dy) * k, 0.0)) * 0.25;
  float alpha = c.a * vTint.a * u.look.x;
  if (alpha <= 0.004) {
    discard;
  }
  if (frame.pick.x > 0.5) {
    outColor = pickOut(u.misc.x, vId);
    return;
  }
  outColor = vec4(themed(c.rgb / max(c.a, 0.0001) * vTint.rgb, 0.0), alpha);
}
`;
/** the icon's program on WebGL2 (the twin of iconWGSL) */
export function iconGLSL(follow: SetsVariant | null): { vertex: string; fragment: string } {
  const head = `${follow ? setsTrackGLSL(follow) : FRAME_GLSL}
layout(std140) uniform U { vec4 place; vec4 size; vec4 look; vec4 misc; } u;
${follow ? '' : 'uniform highp sampler2D places;'}
uniform highp sampler2D items;
uniform highp sampler2D atlas;
`;
  return { vertex: head + (follow ? ANCHOR_FOLLOW_GLSL : ANCHOR_STILL_GLSL) + ICON_VS, fragment: head + ICON_FS };
}
