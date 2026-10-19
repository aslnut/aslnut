// Twin of line.wgsl.ts: the same functions in the same order.
import { FEATURE_GLSL } from './feature.glsl.ts';

const COMMON = /* glsl */ `${FEATURE_GLSL}
layout(std140) uniform Params { /*@params*/ } params;
/*@functions*/
`;
export const LINE_GLSL = {
  vertex: /* glsl */ `${COMMON}
layout(location = 0) in vec4 a;
layout(location = 1) in vec4 b;
layout(location = 2) in vec4 p0;
layout(location = 3) in vec4 p3;
layout(location = 4) in vec4 x;
out vec4 v_col;
out float v_across;
out float v_halfw;
out float v_along;
out float v_alongPx;
flat out float v_idx;
flat out vec4 v_state;
out vec3 v_world;
flat out float v_value;
vec2 screenOf(vec4 c) {
  return c.xy / c.w * frame.size.xy * 0.5;
}
vec2 perp(vec2 d) {
  return vec2(-d.y, d.x);
}
vec2 dirOf(vec2 a, vec2 b) {
  vec2 d = b - a;
  float l = length(d);
  if (l < 0.0001) {
    return vec2(1.0, 0.0);
  }
  return d / l;
}
vec4 clipAt(vec2 rel, float h) {
  return frame.viewProj * vec4(liftToEye(placeAt(rel, h), u.b.z), 1.0);
}
void main() {
  float end = x.z;
  float side = x.w;
  float idx = x.x;
  vec4 state = featAt(idx, 2);
  vec4 motion = vec4(0.0, 0.0, 0.0, 1.0);
  if (u.reveal.y > 0.5) {
    motion = featAt(idx, 5);
  }
  float lift = u.origin.w + raiseOf(state) + motion.z;
  float ex = u.origin.z;
  vec3 PA = placeAt(a.xy, a.z * ex + lift);
  vec3 PB = placeAt(b.xy, b.z * ex + lift);
  vec4 cA = frame.viewProj * vec4(liftToEye(PA, u.b.z), 1.0);
  vec4 cB = frame.viewProj * vec4(liftToEye(PB, u.b.z), 1.0);
  if (cA.w <= 0.0 || cB.w <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  vec2 sA = screenOf(cA);
  vec2 sB = screenOf(cB);
  vec2 n = perp(dirOf(sA, sB));
  vec2 m = n;
  if (end < 0.5 && p0.w > 0.5) {
    vec4 c0 = clipAt(p0.xy, p0.z * ex + lift);
    if (c0.w > 0.0) {
      m = normalize(perp(dirOf(screenOf(c0), sA)) + n);
    }
  }
  if (end > 0.5 && p3.w > 0.5) {
    vec4 c3 = clipAt(p3.xy, p3.z * ex + lift);
    if (c3.w > 0.0) {
      m = normalize(n + perp(dirOf(sB, screenOf(c3))));
    }
  }
  float ml = 1.0 / max(dot(m, n), 0.5);
  float w = u.a.x;
  if (u.a.y > 0.5) {
    w = w * featAt(idx, 3).x;
  }
  w = sizePx(w, u.size, end > 0.5 ? PB : PA);
  w = w + u.hover2.y * state.x + u.sel2.y * state.y;
  w = w * frame.size.z * motion.w;
  float halfw = w * 0.5 + 1.0;
  vec4 c = end > 0.5 ? cB : cA;
  vec2 off = m * side * halfw * ml;
  gl_Position = clipOut(vec4(c.xy + off / (frame.size.xy * 0.5) * c.w, c.z, c.w));
  vec4 col = vec4(mix(u.c.rgb, u.hover.rgb, state.x), mix(u.c.a, 1.0, max(state.x, state.y)));
  if (u.b.w < 0.5) {
    col = colourOf(idx, state);
  }
  vec3 P = end > 0.5 ? PB : PA;
  v_col = col;
  v_across = side * halfw * ml;
  v_halfw = halfw;
  v_along = mix(a.w, b.w, end);
  v_alongPx = v_along * x.y / max(mppAt(P) / max(frame.size.z, 0.001), 0.000001);
  v_idx = idx;
  v_state = state;
  v_world = P;
  v_value = featAt(idx, 3).z;
}
`,
  fragment: /* glsl */ `${COMMON}
in vec4 v_col;
in float v_across;
in float v_halfw;
in float v_along;
in float v_alongPx;
flat in float v_idx;
flat in vec4 v_state;
in vec3 v_world;
flat in float v_value;
out vec4 outColor;
void main() {
  vec4 color = v_col;
  float alpha = color.a * clamp(v_halfw - abs(v_across), 0.0, 1.0) * clamp((v_halfw - 1.0) * 2.0, 0.0, 1.0);
  float along = v_along;
  float time = frame.eye.w;
  float value = v_value;
  vec3 position = v_world;
  float reveal = v_state.z;
  float mode = u.reveal.x;
  // dashes, flowing along at u.b.y px a second (0: still)
  float dashP = max(u.a.z + u.a.w, 0.0001);
  float dashAt = v_alongPx - time * u.b.y;
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
