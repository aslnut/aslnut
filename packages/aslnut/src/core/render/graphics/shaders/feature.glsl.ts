// Twin of feature.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from './frame.glsl.ts';

export const FEATURE_GLSL = /* glsl */ `${FRAME_GLSL}
layout(std140) uniform L { vec4 origin; vec4 look; vec4 reveal; vec4 hover; vec4 hover2; vec4 sel; vec4 sel2; vec4 a; vec4 b; vec4 c; vec4 ground; vec4 slots; vec4 slots2; vec4 k0; vec4 k3; vec4 size; vec4 slots3; vec4 k6; } u;
uniform highp sampler2D feat;
const int FW = 512;
const float PI = 3.141592653589793;
const float RE = 6378137.0;
float s2(float a) {
  float s = sin(a * 0.5);
  return 2.0 * s * s;
}
vec3 placeAt(vec2 rel, float h) {
  float dl = u.origin.x + rel.x;
  float dm = u.origin.y + rel.y;
  float c = RE * frame.misc.y;
  vec3 F = vec3(c * dl, h, -c * dm);
  if (frame.size.w >= 1.0) {
    return F;
  }
  float lat = 2.0 * atan(exp(frame.geo.x + dm)) - PI * 0.5;
  float dp = lat - frame.misc.x;
  float rr = RE + h;
  float cl = cos(lat);
  float k = s2(dp) + frame.misc.y * cl * s2(dl);
  vec3 G = vec3(rr * cl * sin(dl), h - rr * k, -rr * (sin(dp) + frame.geo.y * cl * s2(dl)));
  return mix(G, F, frame.size.w);
}
void placeUp(vec2 rel, out vec3 p, out vec3 d) {
  float dl = u.origin.x + rel.x;
  float dm = u.origin.y + rel.y;
  float c = RE * frame.misc.y;
  vec3 F = vec3(c * dl, 0.0, -c * dm);
  if (frame.size.w >= 1.0) {
    p = F;
    d = vec3(0.0, 1.0, 0.0);
    return;
  }
  float lat = 2.0 * atan(exp(frame.geo.x + dm)) - PI * 0.5;
  float dp = lat - frame.misc.x;
  float cl = cos(lat);
  float k = s2(dp) + frame.misc.y * cl * s2(dl);
  vec3 D = vec3(cl * sin(dl), -k, -(sin(dp) + frame.geo.y * cl * s2(dl)));
  p = mix(RE * D, F, frame.size.w);
  d = mix(D + vec3(0.0, 1.0, 0.0), vec3(0.0, 1.0, 0.0), frame.size.w);
}
vec3 liftToEye(vec3 p, float px) {
  vec3 toEye = frame.eye.xyz - p;
  float d = length(toEye);
  float mpp = 2.0 * d * frame.misc.z / frame.size.y;
  return p + toEye / max(d, 0.001) * min(px * frame.size.z * mpp, d * 0.5);
}
float mppAt(vec3 p) {
  return 2.0 * length(frame.eye.xyz - p) * frame.misc.z / frame.size.y;
}
float slotOf(int plane) {
  float s = u.slots2.y;
  if (plane == 0) {
    s = u.slots.x;
  }
  if (plane == 1) {
    s = u.slots.y;
  }
  if (plane == 2) {
    s = u.slots2.x;
  }
  if (plane == 3) {
    s = u.slots.z;
  }
  if (plane == 4) {
    s = u.slots.w;
  }
  if (plane == 6) {
    s = u.slots3.x;
  }
  return s;
}
vec4 constOf(int plane) {
  if (plane <= 1) {
    return u.k0;
  }
  if (plane == 3) {
    return u.k3;
  }
  if (plane == 5) {
    return vec4(0.0, 0.0, 0.0, 1.0);
  }
  if (plane == 6) {
    return u.k6;
  }
  return vec4(0.0);
}
vec4 featAt(float index, int plane) {
  float s = slotOf(plane);
  if (s < 0.0) {
    return constOf(plane);
  }
  int i = int(index + 0.5);
  return texelFetch(feat, ivec2(i % FW, i / FW + int(s) * int(u.look.w)), 0);
}
vec4 colourOf(float index, vec4 state) {
  vec4 c = mix(featAt(index, 1), featAt(index, 0), u.look.z);
  c = vec4(mix(c.rgb, u.sel.rgb, u.sel.a * state.y), c.a);
  c = vec4(mix(c.rgb, u.hover.rgb, u.hover.a * state.x), c.a);
  return c;
}
float raiseOf(vec4 state) {
  return u.hover2.x * state.x + u.sel2.x * state.y;
}
bool dashOn(float at, vec4 d) {
  float p = d.x + d.y + d.z + d.w;
  if (d.x <= 0.0 || p <= 0.0001) {
    return true;
  }
  float k = at - floor(at / p) * p;
  return k < d.x || (k >= d.x + d.y && k < d.x + d.y + d.z);
}
float acrossAt(float t, float s, float len, float k, vec4 ends) {
  float cap = u.a.z;
  if (t < 0.0) {
    if (ends.z > 0.5 || (cap > 0.5 && cap < 1.5)) {
      return 1e9;
    }
    if (cap > 1.5) {
      return max(abs(s), -t * len) / k;
    }
    return length(vec2(s, t * len)) / k;
  }
  if (t >= 1.0) {
    if (ends.w > 0.5) {
      if (u.a.w < 0.5) {
        return 1e9;
      }
      return length(vec2(s, (t - 1.0) * len)) / k;
    }
    if (cap > 0.5 && cap < 1.5) {
      return 1e9;
    }
    if (cap > 1.5) {
      return max(abs(s), (t - 1.0) * len) / k;
    }
    return length(vec2(s, (t - 1.0) * len)) / k;
  }
  return s / k;
}
float easeOutBack(float t) {
  float c = 1.70158;
  float x = t - 1.0;
  return 1.0 + (c + 1.0) * x * x * x + c * x * x;
}
`;
