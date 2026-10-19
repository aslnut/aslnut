// Twin of atmosphere.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from './frame.glsl.ts';

const COMMON = /* glsl */ `${FRAME_GLSL}
layout(std140) uniform U { vec4 sun; vec4 moon; vec4 p1; vec4 p2; vec4 grey; vec4 horizon; vec4 space; vec4 glow; vec4 misc; vec4 cloud; vec4 cloudLit; vec4 cloudShade; } u;
`;
export const ATMOSPHERE_GLSL = {
  vertex: /* glsl */ `${COMMON}
out vec2 v_ndc;
void main() {
  int i = gl_VertexID;
  vec2 p = vec2(float((i << 1) & 2), float(i & 2)) * 2.0 - 1.0;
  gl_Position = clipOut(vec4(p, 1.0, 1.0));
  v_ndc = p;
}
`,
  fragment: /* glsl */ `${COMMON}
in vec2 v_ndc;
out vec4 outColor;
uint pcg(uint v) {
  uint s = v * 747796405u + 2891336453u;
  uint w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
float hash3(vec3 q) {
  ivec3 iq = ivec3(q);
  return float(pcg(uint(iq.x) ^ pcg(uint(iq.y) ^ pcg(uint(iq.z))))) / 4294967295.0;
}
vec3 spaceColor(vec3 o, vec3 d) {
  vec3 q = floor(d * 900.0);
  float s = step(0.9982, hash3(q)) * hash3(q + vec3(1.0, 2.0, 3.0));
  vec3 c = u.space.rgb + vec3(s);
  vec3 C = vec3(0.0, -u.misc.x, 0.0);
  vec3 oc = C - o;
  float t = dot(oc, d);
  if (t > 0.0) {
    float dm = length(oc - d * t);
    float g = exp(-max(dm - u.misc.x, 0.0) / (u.misc.x * 0.035)) * smoothstep(u.misc.x * 0.96, u.misc.x, dm);
    c = mix(c, u.glow.rgb, clamp(g, 0.0, 1.0));
  }
  return c;
}
float sunIntensity(float c) {
  return 1000.0 * max(0.0, 1.0 - exp(-((1.6110731556870734 - acos(clamp(c, -1.0, 1.0))) / 1.5)));
}
vec3 totalMie(float t) {
  return 0.434 * (0.2 * t) * 10.0e-18 * vec3(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14);
}
float rayleighPhase(float c) {
  return 0.05968310365946075 * (1.0 + c * c);
}
float hgPhase(float c, float g) {
  float g2 = g * g;
  return 0.07957747154594767 * ((1.0 - g2) / pow(1.0 - 2.0 * g * c + g2, 1.5));
}
vec3 rrtOdt(vec3 v) {
  return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
}
vec3 aces(vec3 c, float exposure) {
  mat3 a = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  mat3 b = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(b * rrtOdt(a * (c * exposure / 0.6)), vec3(0.0), vec3(1.0));
}
vec3 toSRGB(vec3 c) {
  return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, step(c, vec3(0.0031308)));
}
vec3 physical(vec3 d) {
  vec3 sd = u.sun.xyz;
  float sunE = sunIntensity(sd.y);
  float sunfade = 1.0 - clamp(1.0 - exp(sd.y * 0.8888889), 0.0, 1.0);
  vec3 betaR = vec3(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5) * (u.p1.y - (1.0 - sunfade));
  vec3 betaM = totalMie(u.p1.x) * u.p1.z;
  float zen = acos(max(0.0, d.y));
  float inv = 1.0 / (cos(zen) + 0.15 * pow(93.885 - ((zen * 180.0) / 3.141592653589793), -1.253));
  vec3 fex = exp(-(betaR * 8.4e3 * inv + betaM * 1.25e3 * inv));
  float ct = dot(d, sd);
  vec3 bR = betaR * rayleighPhase(ct * 0.5 + 0.5);
  vec3 bM = betaM * hgPhase(ct, u.p1.w);
  vec3 k = (bR + bM) / (betaR + betaM);
  vec3 lin = pow(sunE * k * (1.0 - fex), vec3(1.5));
  lin = lin * mix(vec3(1.0), pow(sunE * k * fex, vec3(0.5)), clamp(pow(1.0 - sd.y, 5.0), 0.0, 1.0));
  vec3 l0 = vec3(0.1) * fex;
  float disc = smoothstep(0.9999566769464484, 0.9999566769464484 + 0.00002, ct);
  l0 = l0 + (sunE * 19000.0 * fex) * disc * u.sun.w;
  vec3 tex = (lin + l0) * 0.04 + vec3(0.0, 0.0003, 0.00075);
  vec3 c = pow(tex, vec3(1.0 / (1.2 + (1.2 * sunfade))));
  c = mix(c, u.grey.rgb, u.p2.x);
  c = toSRGB(aces(c, u.horizon.w));
  vec3 blue = mix(vec3(0.62, 0.78, 0.93), vec3(0.22, 0.47, 0.84), smoothstep(0.0, 0.65, d.y));
  c = mix(c, blue, 0.55 * u.p2.y);
  float halo = pow(max(ct, 0.0), 400.0) * 0.6 + pow(max(ct, 0.0), 24.0) * 0.12;
  c = c + vec3(1.0, 0.92, 0.8) * halo * u.misc.y;
  return mix(c, u.horizon.rgb, 1.0 - smoothstep(0.0, 0.09, d.y));
}
vec4 moonDisc(vec3 d) {
  vec3 m = u.moon.xyz;
  float ct = dot(d, m);
  float r = u.misc.z;
  if (ct < cos(r)) {
    return vec4(0.0);
  }
  vec3 p = (d - m * ct) / sin(r);
  float r2 = dot(p, p);
  if (r2 >= 1.0) {
    return vec4(0.0);
  }
  vec3 n = p - m * sqrt(1.0 - r2);
  float lit = smoothstep(-0.04, 0.1, dot(n, u.sun.xyz));
  float maria = 0.25 * smoothstep(0.6, 0.2, length(p - vec3(0.2, 0.25, 0.0))) + 0.2 * smoothstep(0.5, 0.1, length(p + vec3(0.25, 0.1, 0.0)));
  vec3 surf = vec3(0.95, 0.94, 0.88) * (1.0 - maria);
  float night = 1.0 - smoothstep(-0.1, 0.12, u.sun.y);
  vec3 col = surf * lit + vec3(0.09, 0.1, 0.13) * (1.0 - lit) * night;
  float a = max(lit, night * 0.85) * (1.0 - smoothstep(0.92, 1.0, r2)) * u.moon.w;
  return vec4(col * (1.0 + 0.6 * night), a);
}
float h2(vec2 q) {
  vec2 p = fract(q * vec2(0.1031, 0.103));
  p = p + dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float vnoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2(1.0, 0.0)), w.x), mix(h2(i + vec2(0.0, 1.0)), h2(i + vec2(1.0, 1.0)), w.x), w.y);
}
float fbm(vec2 q) {
  vec2 p = q;
  float s = 0.0;
  float a = 0.5;
  for (int k = 0; k < 5; k = k + 1) {
    s = s + a * vnoise(p);
    p = p * 2.03 + vec2(17.1, 17.1);
    a = a * 0.5;
  }
  return s;
}
float cloudDensity(vec2 xz) {
  float c = 1.0 - u.cloud.x;
  return smoothstep(c * 0.75, c * 0.75 + 0.28, fbm((xz + u.cloud.yz) / 3200.0));
}
vec4 cloudsAt(vec3 o, vec3 d) {
  if (u.cloud.w < 0.0 || u.cloud.x < 0.01 || d.y <= 0.0 || o.y >= u.cloud.w) {
    return vec4(0.0);
  }
  vec3 p = o + d * ((u.cloud.w - o.y) / d.y);
  float dens = cloudDensity(p.xz);
  if (dens < 0.01) {
    return vec4(0.0);
  }
  float towardSun = cloudDensity(p.xz + u.sun.xz * 260.0);
  vec3 col = mix(u.cloudLit.rgb, u.cloudShade.rgb, clamp(towardSun * 1.3 - dens * 0.3, 0.0, 1.0));
  float fs = max(dot(d, u.sun.xyz), 0.0);
  col = col + u.cloudLit.rgb * (pow(fs, 40.0) * (1.4 - dens) * 1.3 + pow(fs, 6.0) * 0.25) * u.sun.w;
  col = col + vec3(0.7, 0.75, 0.9) * u.grey.w;
  float far = length(p.xz - o.xz);
  col = mix(col, u.horizon.rgb, smoothstep(6000.0, 38000.0, far) * 0.85);
  return vec4(col, dens * 0.92 * (1.0 - smoothstep(22000.0, 42000.0, far)) * u.cloudLit.w);
}
void main() {
  vec4 a = frame.inv * vec4(v_ndc, 0.0, 1.0);
  vec4 b = frame.inv * vec4(v_ndc, 1.0, 1.0);
  vec3 o = a.xyz / a.w;
  vec3 d = normalize(b.xyz / b.w - o);
  vec3 c = spaceColor(o, d);
  if (u.p2.w > 0.0) {
    vec3 near = physical(d);
    vec3 q = floor(d * 700.0);
    float s = step(0.9986, hash3(q)) * (0.35 + 0.65 * hash3(q + vec3(1.0, 2.0, 3.0))) * smoothstep(0.02, 0.2, d.y);
    near = near + vec3(0.85, 0.9, 1.0) * s * u.p2.z;
    vec4 mo = moonDisc(d);
    near = mix(near, mo.rgb, mo.a);
    vec4 cl = cloudsAt(o, d);
    near = mix(near, cl.rgb, cl.a);
    near = mix(near, vec3(0.85, 0.88, 1.0), u.grey.w * 0.6);
    c = mix(c, near, u.p2.w);
  }
  outColor = vec4(c, 1.0);
}
`,
};
