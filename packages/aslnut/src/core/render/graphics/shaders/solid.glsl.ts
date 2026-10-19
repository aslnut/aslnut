// Twin of solid.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from './frame.glsl.ts';
import { LIGHT_GLSL } from './light.glsl.ts';
import { SHAPE_FNS_GLSL } from './shape-fns.glsl.ts';

const HEAD = /* glsl */ `${FRAME_GLSL}
layout(std140) uniform T { vec4 o; vec4 v; vec4 w; vec4 l; } tb;
struct Tile { vec4 o; vec4 v; vec4 w; vec4 l; };
Tile t;
/*@mparams*/
`;
/** what both vertex stages (meshes and instances) share */
export const SOLID_VERTEX_COMMON_GLSL = /* glsl */ `${HEAD}
uniform highp sampler2DArray ground;
const int GN = 51;
const float GSTEP = 10.0;
float gLoad(int x, int z) {
  return texelFetch(ground, ivec3(clamp(x, 0, GN - 1), clamp(z, 0, GN - 1), int(t.l.w)), 0).x;
}
float groundAt(float ax, float az) {
  if (t.l.w < 0.0) {
    return 0.0;
  }
  float gx = clamp(ax / GSTEP, 0.0, float(GN - 1));
  float gz = clamp(az / GSTEP, 0.0, float(GN - 1));
  int x0 = int(floor(gx));
  int z0 = int(floor(gz));
  float fx = gx - float(x0);
  float fz = gz - float(z0);
  return mix(mix(gLoad(x0, z0), gLoad(x0 + 1, z0), fx), mix(gLoad(x0, z0 + 1), gLoad(x0 + 1, z0 + 1), fx), fz);
}
${SHAPE_FNS_GLSL}
vec3 placeOf(float x, float h, float z) {
  return vec3(t.o.x + x * t.o.z, h, t.o.y + z * t.o.w);
}
vec3 towardEye(vec3 p) {
  vec3 e = frame.eye.xyz - p;
  float d = length(e);
  return p + e / max(d, 0.001) * min(0.5 * frame.size.z * 2.0 * d * frame.misc.z / frame.size.y, d * 0.25);
}
out vec3 v_col;
out vec3 v_n;
out vec3 v_world;
flat out float v_id;
out vec3 v_leaf;
flat out vec4 v_ck;
flat out vec4 v_co;
/*@mvaryingsOut*/
/*@functions*/
`;
/** the fragment stage's shared code (the impostors use it too) */
export const SOLID_FRAGMENT_LIB_GLSL = /* glsl */ `${HEAD}
uniform highp sampler2D tints;
uniform highp sampler2D picture;
${LIGHT_GLSL(1)}
${SHAPE_FNS_GLSL}
/*@functions*/
float leafCut(vec3 leaf, vec3 world) {
  float kind = floor(leaf.z);
  float keep = (leaf.z - kind) / 0.45;
  float h = fract(sin(dot(floor(world * 0.8), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  return leafMask(leaf.xy, kind) * step(h, keep + 0.001);
}
float dither(vec2 p) {
  return fract(52.9829189 * fract(0.06711056 * floor(p.x) + 0.00583715 * floor(p.y)));
}
vec4 roomBehind(vec3 world) {
  vec3 d = normalize(world - frame.eye.xyz);
  vec3 size = vec3(4.0, 3.2, 4.0);
  vec3 p = world / size;
  vec3 cell = floor(p + d * 0.002);
  vec3 dd = d / size;
  vec3 safe = mix(dd, vec3(0.00001), lessThan(abs(dd), vec3(0.00001)));
  vec3 tt = (cell + step(vec3(0.0), dd) - p) / safe;
  float k = fract(sin(dot(cell, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  vec3 col = vec3(0.78, 0.72, 0.62) * (0.8 + 0.35 * k);
  float t = min(tt.x, tt.z);
  if (tt.y < t) {
    t = tt.y;
    col = d.y < 0.0 ? vec3(0.42, 0.32, 0.24) : vec3(0.86, 0.84, 0.8);
  }
  return vec4(col / (1.0 + t * 0.5), k);
}
float facadeWindow(vec3 world, vec3 n) {
  if (abs(n.y) > 0.5) {
    return 0.0;
  }
  vec3 tg = normalize(vec3(-n.z, 0.0, n.x));
  float fu = fract(dot(world, tg) / 3.2);
  float fv = fract(world.y / 3.2);
  return step(0.22, fu) * step(fu, 0.78) * step(0.3, fv) * step(fv, 0.78);
}
vec3 pbrLit(vec3 c, vec3 n, vec3 world, float k) {
  float q = floor(k + 0.5);
  float rough = max(0.04, floor(q / 8.0) / 7.0);
  float metal = (q - floor(q / 8.0) * 8.0) / 7.0;
  vec3 v = normalize(frame.eye.xyz - world);
  vec3 h = normalize(v + frame.sun.xyz);
  float nl = max(dot(n, frame.sun.xyz), 0.0);
  float nv = max(dot(n, v), 0.001);
  float nh = max(dot(n, h), 0.0);
  float a = rough * rough;
  float dd = nh * nh * (a * a - 1.0) + 1.0;
  float dgx = a * a / (3.14159 * dd * dd);
  vec3 f0 = mix(vec3(0.04), c, metal);
  vec3 f = f0 + (vec3(1.0) - f0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
  float kk = (rough + 1.0) * (rough + 1.0) / 8.0;
  float g = (nl / (nl * (1.0 - kk) + kk)) * (nv / (nv * (1.0 - kk) + kk));
  vec3 spec = dgx * g * f / max(4.0 * nl * nv, 0.001);
  vec3 lit = mix(c * (0.62 + 0.38 * max(dot(n, normalize(vec3(-0.45, 0.8, -0.35))), 0.0)), sunLit(c, n, world), frame.sunColor.w);
  vec3 env = mix(frame.ambient.rgb, frame.haze.rgb, 0.5) * f * (1.0 - 0.7 * rough);
  return lit * (1.0 - metal) + spec * frame.sunColor.rgb * nl * frame.sunColor.w + env;
}
vec3 metalSheet(vec3 c, vec3 n, vec3 world, vec3 lit) {
  vec3 v = normalize(frame.eye.xyz - world);
  vec3 h = normalize(v + frame.sun.xyz);
  float nl = max(dot(n, frame.sun.xyz), 0.0);
  float nv = max(dot(n, v), 0.05);
  float nh = max(dot(n, h), 0.0);
  float a = 0.55 * 0.55;
  float dd = nh * nh * (a * a - 1.0) + 1.0;
  float dgx = a * a / (3.14159 * dd * dd);
  float kk = (0.55 + 1.0) * (0.55 + 1.0) / 8.0;
  float g = (nl / (nl * (1.0 - kk) + kk)) * (nv / (nv * (1.0 - kk) + kk));
  vec3 f0 = mix(vec3(0.06), c, 0.35);
  vec3 f = f0 + (vec3(1.0) - f0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
  float sh = 0.0;
  if (nl > 0.0) {
    sh = sunShadow(world, n) * cloudShade(world);
  }
  vec3 spec = min(dgx * g * f / (4.0 * nl * nv + 0.001) * nl * sh * frame.sunColor.w, vec3(0.45)) * frame.sunColor.rgb;
  vec3 env = mix(frame.ambient.rgb, frame.haze.rgb, 0.5) * f * 0.45;
  vec3 s = lit * (vec3(1.0) - f) + spec + env;
  return mix(s, vec3(0.8) + 0.2 * (vec3(1.0) - exp(-(s - vec3(0.8)) / 0.2)), vec3(greaterThan(s, vec3(0.8))));
}
void tileIn(vec4 ck, vec4 co) {
  t = Tile(co, vec4(tb.v.x, tb.v.y, ck.x, ck.y), vec4(tb.w.xyz, ck.z), vec4(tb.l.x, tb.l.y, ck.w, tb.l.w));
}
vec3 shadeSolid(vec3 base, vec3 n0, vec3 world, float id, float mat0) {
  int k = int(id + 0.5);
  vec4 tn = vec4(0.0);
  if (t.l.z >= 0.0) {
    tn = texelFetch(tints, ivec2(k % 256, min(int(t.l.z) + k / 256, textureSize(tints, 0).y - 1)), 0);
  }
  vec3 c = mix(base, tn.rgb, tn.a);
  float keep = step(0.002, tn.a);
  if (abs(id - t.v.z) < 0.5) {
    c = mix(c, t.w.rgb, 0.45);
    keep = 1.0;
  }
  if ((mat0 > 7.5 && mat0 < 9.5) || (mat0 > 12.5 && mat0 < 13.5)) {
    return airFog(themed(c, keep), world);
  }
  vec3 n = n0;
  if (dot(n, frame.eye.xyz - world) < 0.0) {
    n = -n;
  }
  float mat = mat0;
  if (mat0 > 13.5 && mat0 < 14.5) {
    mat = facadeWindow(world, n) > 0.5 ? 12.0 : 0.0;
  }
  if (mat0 > 15.5 && mat0 < 16.5) {
    mat = 12.0;
  }
  bool rooms = t.l.y > 0.5 || (mat0 > 15.5 && mat0 < 16.5);
  vec3 plain = c * (0.62 + 0.38 * max(dot(n, normalize(vec3(-0.45, 0.8, -0.35))), 0.0));
  vec3 o = mix(plain, sunLit(c, n, world), frame.sunColor.w);
  // Concrete diffuse sky/ground bounce, scaled by daylight.
  if (mat > 6.5 && mat < 7.5) {
    o = max(o, c * 0.60 * frame.sun.w);
  }
  if ((mat > 0.5 && mat < 6.5) || (mat > 11.5 && mat < 12.5)) {
    vec3 v = normalize(frame.eye.xyz - world);
    float fres = pow(1.0 - max(dot(v, n), 0.0), 4.0);
    vec3 h = normalize(v + frame.sun.xyz);
    float lit = frame.sunColor.w * max(dot(n, frame.sun.xyz), 0.0);
    float night = 1.0 - clamp(frame.sun.w * 4.0, 0.0, 1.0);
    if ((mat > 1.5 && mat < 2.5) || mat > 11.5) {
      o = mix(c * 0.35 * (frame.ambient.rgb + frame.sunColor.rgb * 0.3), frame.haze.rgb, 0.25 + 0.6 * fres) + frame.sunColor.rgb * pow(max(dot(n, h), 0.0), 90.0) * lit;
    } else if (mat > 2.5 && mat < 3.5) {
      o = metalSheet(c, n, world, o);
    } else if (mat > 3.5 && mat < 4.5) {
      o = c * (0.7 + 0.6 * night);
    } else if (mat > 4.5 && mat < 5.5) {
      o = o + c * frame.sunColor.rgb * 0.3 * max(dot(-n, frame.sun.xyz), 0.0) * frame.sunColor.w;
    } else {
      o = o + frame.sunColor.rgb * pow(max(dot(n, h), 0.0), 24.0) * lit * 0.3 + frame.haze.rgb * fres * 0.15;
    }
  }
  if (mat0 > 14.5 && mat0 < 15.5) {
    ivec2 pd = textureSize(picture, 0);
    if (pd.x > 1) {
      float lx = (world.x - t.o.x) / t.o.z / 500.0;
      float lz = (world.z - t.o.y) / t.o.w / 500.0;
      vec3 im = texelFetch(picture, ivec2(clamp(vec2(lx, lz), vec2(0.0), vec2(0.999)) * vec2(pd)), 0).rgb;
      o = mix(im * (0.62 + 0.38 * max(dot(n, normalize(vec3(-0.45, 0.8, -0.35))), 0.0)), sunLit(im, n, world), frame.sunColor.w);
    }
  }
  if (mat0 > 191.5) {
    o = pbrLit(c, n, world, mat0 - 192.0);
  }
  float wet = frame.weather.x;
  if (wet > 0.0 && (mat < 0.5 || (mat > 6.5 && mat < 7.5) || mat0 > 191.5)) {
    vec3 wv = normalize(frame.eye.xyz - world);
    vec3 wh = normalize(wv + frame.sun.xyz);
    float wl = frame.sunColor.w * max(dot(n, frame.sun.xyz), 0.0);
    o = o * (1.0 - 0.3 * wet) + frame.sunColor.rgb * pow(max(dot(n, wh), 0.0), 70.0) * wl * 0.6 * wet + frame.haze.rgb * pow(1.0 - max(dot(wv, n), 0.0), 4.0) * 0.3 * wet;
  }
  if (mat > 9.5 && mat < 12.5) {
    float dark = 1.0 - clamp(frame.sun.w * 4.0, 0.0, 1.0);
    if (mat < 11.5) {
      o = mix(o * 0.85 + c * 0.12, c * (mat < 10.5 ? 1.6 : 1.35), dark);
    } else {
      vec4 inner = roomBehind(world);
      bool deep = rooms;
      float r = deep ? inner.w : fract(sin(dot(floor(world * vec3(0.33, 0.36, 0.33)), vec3(12.9898, 78.233, 37.719))) * 43758.5453);
      float room = step(1.0 - t.l.x, r);
      vec3 warm = deep ? inner.rgb * vec3(1.3, 1.05, 0.75) : vec3(1.0, 0.8, 0.52) * (0.75 + 0.25 * fract(room * 7.31 + world.y));
      o = mix(o, inner.rgb * (frame.ambient.rgb + frame.sunColor.rgb * 0.25), deep ? 0.55 * (1.0 - dark) : 0.0);
      o = mix(o, warm, room * dark);
    }
  }
  return airFog(themed(o, keep), world);
}
`;
export const SOLID_FRAGMENT_GLSL = /* glsl */ `${SOLID_FRAGMENT_LIB_GLSL}
in vec3 v_col;
in vec3 v_n;
in vec3 v_world;
flat in float v_id;
in vec3 v_leaf;
flat in vec4 v_ck;
flat in vec4 v_co;
/*@mvaryingsIn*/
out vec4 outColor;
void main() {
  tileIn(v_ck, v_co);
  if (t.v.w < 1.0 && dither(gl_FragCoord.xy) > t.v.w) {
    discard;
  }
  if (v_leaf.z > 0.5 && leafCut(v_leaf, v_world) < 0.5) {
    discard;
  }
  if (frame.pick.y > 0.5) {
    outColor = packDepth(gl_FragCoord.z);
    return;
  }
  if (frame.pick.x > 0.5) {
    outColor = pickOut(t.v.y, t.w.w * 65536.0 + v_id);
    return;
  }
  float m = max(-v_leaf.z, 0.0);
  vec4 color = vec4(shadeSolid(v_col, normalize(v_n), v_world, v_id, m), m > 127.5 && m < 191.5 ? clamp((m - 128.0) / 63.0, 0.0, 1.0) : 1.0);
  /*@mfinputs*/
  /*@mfragment*/
  outColor = color;
}
`;
export const SOLID_GLSL = {
  vertex: /* glsl */ `${SOLID_VERTEX_COMMON_GLSL}
layout(location = 0) in vec4 a;
layout(location = 1) in vec4 b;
void main() {
  t = Tile(tb.o, tb.v, tb.w, tb.l);
  float h = groundAt(b.x, b.y) * t.v.x + a.y;
  vec3 position = placeOf(a.x, h, a.z);
  v_col = unpackRGB(a.w);
  v_n = unpackNormal(b.z);
  float mat = floor(b.w / 65536.0);
  v_id = b.w - mat * 65536.0;
  v_leaf = vec3(0.0, 0.0, -mat);
  v_ck = vec4(t.v.z, t.v.w, t.w.w, t.l.z);
  v_co = t.o;
  /*@mvinputs*/
  /*@mvertex*/
  /*@mvoutputs*/
  gl_Position = clipOut(frame.viewProj * vec4(towardEye(position), 1.0));
  v_world = position;
}
`,
  fragment: SOLID_FRAGMENT_GLSL,
};
