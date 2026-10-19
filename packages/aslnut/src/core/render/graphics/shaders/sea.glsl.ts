// Twin of sea.wgsl.ts: the same functions in the same order. The coast's field is a sampler named seaField (both
// stages), the sea's block `Sea`.
import { FRAME_GLSL } from './frame.glsl.ts';
import { LIGHT_GLSL } from './light.glsl.ts';
import { SEA_SEGMENTS } from './sea.wgsl.ts';

const BLOCK = 'layout(std140) uniform Sea { vec4 a; vec4 b; vec4 shallow; vec4 deep; vec4 field; vec4 fieldN; vec4 shore; vec4 reach; vec4 centre; vec4 more; vec4 w[16]; vec4 p[16]; } sea;';

/** the look's functions (the block and the field's sampler declared here: put it in both stages) */
export const SEA_LOOK_GLSL = (_block: number, _field: number) => /* glsl */ `
${BLOCK}
uniform highp sampler2D seaField;
struct Shore { float foam; float height; float slope; float sheet; float wet; };
float seaHash(vec2 p) {
  vec2 q = fract(p * vec2(0.1031, 0.103));
  q = q + dot(q, q.yx + 33.33);
  return fract((q.x + q.y) * q.x);
}
float seaNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(seaHash(i), seaHash(i + vec2(1.0, 0.0)), w.x), mix(seaHash(i + vec2(0.0, 1.0)), seaHash(i + vec2(1.0, 1.0)), w.x), w.y);
}
vec2 seaQ(vec3 world) {
  return world.xz * sea.b.y;
}
float seaCell(int i, int j) {
  ivec2 n = ivec2(int(sea.fieldN.x), int(sea.fieldN.y));
  return texelFetch(seaField, clamp(ivec2(i, j), ivec2(0, 0), n - ivec2(1, 1)), 0).x;
}
vec4 seaCoast(vec3 world) {
  if (sea.field.w < 0.5) {
    return vec4(1000000.0, 0.0, 0.0, 0.0);
  }
  float c = sea.field.z;
  float x = (world.x - sea.field.x) / c - 0.5;
  float y = (world.z - sea.field.y) / c - 0.5;
  if (x < 0.0 || y < 0.0 || x > sea.fieldN.x - 1.0 || y > sea.fieldN.y - 1.0) {
    return vec4(1000000.0, 0.0, 0.0, 0.0);
  }
  int i = int(floor(x));
  int j = int(floor(y));
  float fx = x - floor(x);
  float fy = y - floor(y);
  float a = seaCell(i, j);
  float b = seaCell(i + 1, j);
  float d = seaCell(i, j + 1);
  float e = seaCell(i + 1, j + 1);
  if (max(max(abs(a), abs(b)), max(abs(d), abs(e))) > sea.fieldN.z) {
    return vec4(1000000.0, 0.0, 0.0, 0.0);
  }
  float v = mix(mix(a, b, fx), mix(d, e, fx), fy);
  return vec4(v, mix(b - a, e - d, fy) / c, mix(d - a, e - b, fx) / c, 1.0);
}
vec4 seaWaves(vec2 q, int i0, int i1, float foot, float d) {
  vec4 o = vec4(0.0);
  float calm = smoothstep(0.0, max(sea.shore.x, 1.0), d);
  for (int i = i0; i < i1; i = i + 1) {
    vec4 w = sea.w[i];
    float s = w.z * w.w * calm;
    float keep = 1.0 - smoothstep(0.35, 0.7, foot * w.z / 6.283185);
    float ph = w.z * dot(w.xy, q) + sea.p[i].x;
    float c = cos(ph) * s * keep;
    o = o + vec4(w.x * c, w.y * c, sin(ph) * w.w * calm * keep, 0.5 * s * s * (1.0 - keep * keep));
  }
  return o;
}
vec3 seaDisplace(vec2 q, int n, float spacing, float d) {
  vec3 o = vec3(0.0);
  float calm = smoothstep(0.0, max(sea.shore.x, 1.0), d);
  for (int i = 0; i < n; i = i + 1) {
    vec4 w = sea.w[i];
    float a = w.w * calm * (1.0 - smoothstep(0.08, 0.16, spacing * w.z / 6.283185));
    float ph = w.z * dot(w.xy, q) + sea.p[i].x;
    float k = sea.p[i].y * a * cos(ph);
    o = o + vec3(w.x * k, a * sin(ph), w.y * k);
  }
  return o;
}
Shore seaShore(float d, vec2 q) {
  Shore o = Shore(0.0, 0.0, 0.0, 0.0, 0.0);
  float surf = max(sea.shore.x, 1.0);
  float runup = sea.shore.y;
  float T = sea.shore.z;
  if (T <= 0.0 || d > surf * 1.3 || d < -runup * 1.6 - 2.0) {
    return o;
  }
  float shelf = max(sea.deep.w, 0.002);
  float along = (seaNoise(q / 150.0) - 0.5) * 0.5 * T + (seaNoise(q / 45.0) - 0.5) * 0.3 * T;
  float tau = 2.0 * sqrt(max(d, 0.0) / (9.81 * shelf));
  float u = (sea.b.z + tau + along) / T;
  float n = floor(u);
  float f = u - n;
  float big = 0.5 + 0.5 * seaHash(vec2(n, 7.0)) * (0.55 + 0.45 * seaNoise(q / 37.0 + vec2(n * 1.7, 0.0)));
  float brk = surf * (0.5 + 0.5 * big);
  float back = exp(-f / 0.16);
  float face = exp(-(1.0 - f) / 0.035);
  float crest = max(back, face);
  float env = clamp(d / brk, 0.15, 1.0);
  if (d >= brk) {
    env = sqrt(clamp(1.0 - (d - brk) / (surf * 1.3 - brk + 1.0), 0.0, 1.0));
  }
  o.height = big * 0.9 * crest * env * step(0.0, d);
  float dfdd = 1.0 / (T * sqrt(9.81 * shelf * max(d, 0.5)));
  o.slope = big * 0.9 * env * step(0.0, d) * (face > back ? face / 0.035 : -back / 0.16) * dfdd;
  float broken = smoothstep(brk, brk * 0.82, d) * step(0.0, d);
  vec2 s = vec2(q.x * 0.8 + q.y * 0.6, d);
  float blot = 0.45 + 0.55 * seaNoise(vec2(s.x / 5.0, s.y / 1.3) + vec2(n * 3.7, f * 2.0)) * seaNoise(vec2(s.x / 1.7, s.y / 0.9) + vec2(0.0, n));
  o.foam = broken * (exp(-f / 0.12) + exp(-f / 0.45) * 0.7 + face) * blot + broken * 0.22 * smoothstep(0.5, 0.85, seaNoise(vec2(s.x / 2.3, s.y / 1.1) + vec2(n, f)));
  float u0 = (sea.b.z + along) / T;
  float f0 = u0 - floor(u0);
  float big0 = 0.55 + 0.45 * seaHash(vec2(floor(u0), 7.0));
  float reach = runup * big0 * max(0.0, 1.0 - pow(2.0 * f0 / 0.75 - 1.0, 2.0)) * step(f0, 0.75);
  float up = step(0.05, reach);
  o.sheet = smoothstep(-reach - 0.6, -reach + 0.4, d) * step(d, 0.5) * up;
  o.wet = smoothstep(-runup * big0 - 1.0, -runup * big0 * 0.5, d) * (0.6 + 0.4 * (1.0 - f0));
  if (d < 0.0) {
    o.foam = exp(-abs(d + reach) / 0.5) * up * (f0 < 0.375 ? 1.0 : 0.55) * blot;
  }
  o.foam = clamp(o.foam * sea.shore.w, 0.0, 1.0);
  return o;
}
vec3 seaSky(vec3 r) {
  float up = clamp(r.y, 0.0, 1.0);
  vec3 hz = vec3(0.62, 0.72, 0.82) * (0.25 + 0.75 * frame.sun.w);
  if (frame.sunColor.w > 0.5) {
    hz = frame.haze.rgb;
  }
  vec3 zen = frame.sunColor.w > 0.5 ? frame.ambient.rgb * 1.5 : vec3(0.3, 0.45, 0.7) * (0.2 + 0.8 * frame.sun.w);
  return mix(hz, zen, smoothstep(0.0, 0.45, pow(up, 0.7)));
}
vec3 seaFoamLit() {
  vec3 fl = frame.sunColor.w > 0.5 ? frame.ambient.rgb * 1.7 + frame.sunColor.rgb * (0.3 + 0.7 * max(frame.sun.y, 0.0)) * 0.8 : vec3(0.55 + 0.45 * frame.sun.w);
  return vec3(0.92, 0.95, 0.97) * fl;
}
vec3 seaColour(vec3 world, vec3 n, float depth, float rough, float foam) {
  vec3 v = normalize(frame.eye.xyz - world);
  float nv = max(dot(n, v), 0.0);
  float fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  vec3 r = reflect(-v, n);
  float day = frame.sun.w;
  vec3 lit = frame.ambient.rgb * 0.9 + frame.sunColor.rgb * max(frame.sun.y, 0.0) * 0.55;
  float k = 1.0 - exp(-max(depth, 0.0) / max(sea.shallow.w, 0.1));
  vec3 body = mix(sea.shallow.rgb, sea.deep.rgb, k) * (frame.sunColor.w > 0.5 ? lit : vec3(0.45 + 0.55 * day));
  vec3 c = mix(body, seaSky(r), fres);
  float m2 = 0.0016 + (rough + sea.more.x) * 2.0;
  vec3 h = normalize(v + frame.sun.xyz);
  float nh = max(dot(n, h), 0.05);
  float spec = exp(-(1.0 - nh * nh) / (nh * nh * m2)) / (3.141593 * m2 * nh * nh * nh * nh);
  c = c + frame.sunColor.rgb * min(spec, 60.0) * fres * sea.b.x * 0.08 * step(0.0, frame.sun.y);
  return mix(c, seaFoamLit(), clamp(foam, 0.0, 1.0));
}
float seaFoot(vec3 world) {
  vec3 e = frame.eye.xyz - world;
  return length(e) * 2.0 * frame.misc.z / max(frame.fbsize.y, 1.0) / max(abs(e.y) / max(length(e), 0.001), 0.003);
}
vec3 seaOver(vec3 c, vec3 world, float height, float below) {
  vec4 cs = seaCoast(world);
  vec2 q = seaQ(world);
  float water = below;
  Shore sh = Shore(0.0, 0.0, 0.0, 0.0, 0.0);
  if (cs.w > 0.5) {
    water = smoothstep(-0.25, 0.25, cs.x);
    sh = seaShore(cs.x, q);
  }
  if (water <= 0.0 && sh.wet <= 0.0 && sh.sheet <= 0.0 && sh.foam <= 0.0) {
    return c;
  }
  float foot = seaFoot(world);
  vec4 wv = seaWaves(q, 0, int(sea.a.w), foot, cs.x);
  vec3 n = normalize(vec3(-wv.x * sea.b.y - sh.slope * cs.y, 1.0, -wv.y * sea.b.y - sh.slope * cs.z));
  float depth = sea.b.w - height < 0.05 ? 1000.0 : sea.b.w - height;
  if (cs.w > 0.5) {
    depth = mix(max(cs.x, 0.0) * sea.deep.w, max(depth, 0.0), smoothstep(0.55, 0.95, cs.x / max(sea.fieldN.z, 1.0)));
  }
  vec3 wc = seaColour(world, n, depth, wv.w + sea.more.y * smoothstep(0.02, 1.5, foot), sh.foam);
  vec3 v = normalize(frame.eye.xyz - world);
  vec3 land = c * (1.0 - 0.38 * sh.wet);
  vec3 film = mix(land * 0.75, seaSky(reflect(-v, vec3(0.0, 1.0, 0.0))), 0.35 + 0.4 * pow(1.0 - max(v.y, 0.0), 3.0));
  land = mix(mix(land, film, sh.sheet * 0.85), seaFoamLit(), sh.foam);
  return mix(land, wc, water);
}
float seaGround(vec3 p, float h, float level) {
  vec4 cs = seaCoast(p);
  bool water = h < level + 0.3;
  if (cs.w > 0.5) {
    water = cs.x > 0.0;
  }
  if (!water) {
    if (cs.w > 0.5) {
      return max(h, level + 0.05 - 0.02 * cs.x);
    }
    return h;
  }
  float e = distance(p.xz, sea.centre.xy);
  float drop = sea.fieldN.w * sea.a.y * (1.0 - smoothstep(0.7, 0.95, e / max(sea.reach.w, 1.0))) * smoothstep(0.0, 6.0, cs.x);
  return level - drop;
}
`;

const COMMON = /* glsl */ `${FRAME_GLSL}
${SEA_LOOK_GLSL(1, 0)}
const int NA = ${SEA_SEGMENTS};
`;
export const SEA_GLSL = {
  vertex: /* glsl */ `${COMMON}
out vec3 v_world;
out vec2 v_q;
out float v_edge;
void main() {
  int vid = gl_VertexID;
  int j = vid / (NA + 1);
  int i = vid % (NA + 1);
  float k = sea.reach.y;
  float r = sea.reach.x * (pow(k, float(j)) - 1.0) / (k - 1.0);
  float a = float(i) / float(NA) * 6.283185;
  vec3 p = vec3(sea.centre.x + r * cos(a), sea.b.w, sea.centre.y + r * sin(a));
  vec2 q = seaQ(p);
  vec4 cs = seaCoast(p);
  float fade = 1.0 - smoothstep(0.6, 0.95, r / max(sea.reach.w, 1.0));
  vec3 lift = seaDisplace(q, int(sea.a.z), sea.reach.x * pow(k, float(j)), cs.x) / sea.b.y * fade;
  if (cs.w > 0.5) {
    Shore sh = seaShore(cs.x, q);
    lift.y = lift.y + sh.height * fade * smoothstep(0.0, 4.0, cs.x);
  }
  p = p + lift;
  gl_Position = clipOut(frame.viewProj * vec4(p, 1.0));
  v_world = p;
  v_q = q;
  v_edge = smoothstep(0.75, 0.95, r / max(sea.reach.w, 1.0));
}
`,
  fragment: /* glsl */ `${COMMON}
${LIGHT_GLSL(1)}
in vec3 v_world;
in vec2 v_q;
in float v_edge;
out vec4 outColor;
void main() {
  vec4 cs = seaCoast(v_world);
  float foot = seaFoot(v_world);
  vec4 wv = seaWaves(v_q, 0, int(sea.a.w), foot, cs.x);
  float foam = 0.0;
  float sx = 0.0;
  float sz = 0.0;
  float land = 0.0;
  if (cs.w > 0.5) {
    Shore sh = seaShore(cs.x, v_q);
    foam = sh.foam * smoothstep(0.0, 1.0, cs.x);
    sx = sh.slope * cs.y;
    sz = sh.slope * cs.z;
    land = 1.0 - smoothstep(-0.2, 0.3, cs.x);
  }
  vec3 n = normalize(vec3(-wv.x * sea.b.y - sx, 1.0, -wv.y * sea.b.y - sz));
  float depth = cs.w > 0.5 ? max(cs.x, 0.0) * sea.deep.w : 1000.0;
  vec3 c = seaColour(v_world, n, depth, wv.w + sea.more.y * smoothstep(0.02, 1.5, foot), foam) * mix(1.0, 0.55 + 0.45 * sunShadow(v_world, vec3(0.0, 1.0, 0.0)), frame.sunColor.w);
  float d = distance(v_world, frame.eye.xyz);
  float f = smoothstep(sea.centre.z, sea.centre.w, d) * frame.size.w;
  c = airFog(mix(themedGround(c), frame.haze.w > 0.0 ? frame.haze.rgb : themedGround(c), f), v_world);
  float alpha = sea.a.y * (1.0 - v_edge) * (1.0 - land);
  if (frame.pick.x > 0.5) {
    outColor = vec4(0.0);
    return;
  }
  outColor = vec4(c, alpha);
}
`,
};
