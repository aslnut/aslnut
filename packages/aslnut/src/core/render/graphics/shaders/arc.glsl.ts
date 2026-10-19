// Twin of arc.wgsl.ts: the same functions in the same order.
import { FEATURE_GLSL } from './feature.glsl.ts';

const COMMON = /* glsl */ `${FEATURE_GLSL}
layout(std140) uniform Params { /*@params*/ } params;
/*@functions*/
`;
export const ARC_GLSL = {
  vertex: /* glsl */ `${COMMON}
layout(location = 0) in vec4 ab;
layout(location = 1) in vec4 hf;
layout(location = 2) in vec2 nw;
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
vec3 unitOf(vec2 p) {
  float lat = 2.0 * atan(exp(clamp(frame.geo.x + p.y, -3.14, 3.14))) - PI * 0.5;
  float c = cos(lat);
  return vec3(c * cos(p.x), c * sin(p.x), sin(lat));
}
vec2 mercOf(vec3 v) {
  float lat = clamp(atan(v.z, length(v.xy)), -1.4844, 1.4844);
  return vec2(atan(v.y, v.x), log(tan(PI * 0.25 + lat * 0.5)) - frame.geo.x);
}
vec2 arcAt(vec4 ab, float w, float t) {
  vec2 p = mix(ab.xy, ab.zw, t);
  float k = smoothstep(0.0005, 0.002, w);
  if (k > 0.0) {
    vec3 va = unitOf(u.origin.xy + ab.xy);
    vec3 vb = unitOf(u.origin.xy + ab.zw);
    vec3 v = (sin((1.0 - t) * w) * va + sin(t * w) * vb) / sin(w);
    vec2 ga = mercOf(va);
    vec2 gb = mercOf(vb);
    gb.x = gb.x - 2.0 * PI * round((gb.x - ga.x) / (2.0 * PI));
    vec2 d = mercOf(v) - mix(ga, gb, t);
    d.x = d.x - 2.0 * PI * round(d.x / (2.0 * PI));
    p = p + d * k;
  }
  return p;
}
float arcH(vec4 hf, float t, float lift) {
  return mix(hf.x, hf.y, t) * u.origin.z + hf.z * 4.0 * t * (1.0 - t) + lift;
}
vec4 arcClip(vec4 ab, vec4 hf, float w, float t, float lift) {
  return frame.viewProj * vec4(placeAt(arcAt(ab, w, t), arcH(hf, t, lift)), 1.0);
}
void main() {
  float n = max(abs(nw.x), 1.0);
  float w = nw.y;
  float idx = hf.w;
  uint vid = uint(gl_VertexID);
  float at = float(vid / 2u);
  float k = min(at, n);
  float side = (vid & 1u) == 1u ? 1.0 : -1.0;
  float t = k / n;
  vec4 state = featAt(idx, 2);
  vec4 motion = vec4(0.0, 0.0, 0.0, 1.0);
  if (u.reveal.y > 0.5) {
    motion = featAt(idx, 5);
  }
  float lift = u.origin.w + raiseOf(state) + motion.z;
  vec3 P = placeAt(arcAt(ab, w, t), arcH(hf, t, lift));
  vec4 c = frame.viewProj * vec4(liftToEye(P, u.b.z), 1.0);
  if (c.w <= 0.0) {
    gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
    return;
  }
  // a point past the arc's own: on its last point's middle, between that point's two vertices (nothing drawn)
  if (at > n) {
    gl_Position = clipOut(c);
    return;
  }
  vec2 s = screenOf(c);
  vec2 nA = vec2(0.0, 0.0);
  vec2 nB = vec2(0.0, 0.0);
  if (k > 0.0) {
    vec4 c0 = arcClip(ab, hf, w, (k - 1.0) / n, lift);
    if (c0.w > 0.0) {
      nA = perp(dirOf(screenOf(c0), s));
    }
  }
  if (k < n) {
    vec4 c1 = arcClip(ab, hf, w, (k + 1.0) / n, lift);
    if (c1.w > 0.0) {
      nB = perp(dirOf(s, screenOf(c1)));
    }
  }
  vec2 m = nA + nB;
  float ml = 1.0;
  if (dot(nA, nA) > 0.5 && dot(nB, nB) > 0.5) {
    m = normalize(m);
    ml = 1.0 / max(dot(m, nA), 0.5);
  } else if (dot(m, m) < 0.5) {
    m = vec2(0.0, 1.0);
  }
  vec4 nums = featAt(idx, 3);
  float wd = u.a.x;
  if (u.a.y > 0.5) {
    wd = wd * nums.x;
  }
  wd = sizePx(wd, u.size, P);
  wd = wd + u.hover2.y * state.x + u.sel2.y * state.y;
  wd = wd * frame.size.z * motion.w;
  float halfw = wd * 0.5 + 1.0;
  vec2 off = m * side * halfw * ml;
  gl_Position = clipOut(vec4(c.xy + off / (frame.size.xy * 0.5) * c.w, c.z, c.w));
  v_col = colourOf(idx, state);
  v_across = side * halfw * ml;
  v_halfw = halfw;
  v_along = nw.x < 0.0 ? 1.0 - t : t;
  v_alongPx = v_along * w * RE / max(mppAt(P) / max(frame.size.z, 0.001), 0.000001);
  v_idx = idx;
  v_state = state;
  v_world = P;
  v_value = nums.z;
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
