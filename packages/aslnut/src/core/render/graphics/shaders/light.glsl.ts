// The sun's light and its shadows. Twin: light.wgsl.ts. GL's framebuffer rows start at the bottom: the shadow map's
// row is read from below (WebGPU's from above). The texture is a sampler named shadowMap (bound by the program's list).
export const LIGHT_GLSL = (_binding: number) => /* glsl */ `
uniform highp sampler2D shadowMap;
float unpackDepth(vec4 c) {
  return dot(c.rgb, vec3(1.0, 1.0 / 255.0, 1.0 / 65025.0));
}
float shadowTap(ivec2 p, float z) {
  ivec2 n = textureSize(shadowMap, 0);
  ivec2 q = clamp(p, ivec2(0, 0), n - ivec2(1, 1));
  return step(z, unpackDepth(texelFetch(shadowMap, q, 0)));
}
float sunShadow(vec3 world, vec3 n) {
  if (frame.shadow.x <= 0.0) {
    return 1.0;
  }
  vec4 p = frame.light * vec4(world + n * frame.shadow.z, 1.0);
  vec3 q = p.xyz / p.w;
  vec2 uv = vec2(q.x * 0.5 + 0.5, q.y * 0.5 + 0.5);
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0 || q.z >= 1.0) {
    return 1.0;
  }
  vec2 t = uv / frame.shadow.y - vec2(0.5, 0.5);
  ivec2 i = ivec2(floor(t));
  vec2 f = fract(t);
  // the depth bias grows where the sun grazes the surface (a low sun on flat ground: no stripes of acne)
  float nl = clamp(dot(n, frame.sun.xyz), 0.05, 1.0);
  float z = q.z - frame.shadow.w - frame.fbsize.z * min(sqrt(1.0 - nl * nl) / nl, 8.0);
  float a = shadowTap(i, z);
  float b = shadowTap(i + ivec2(1, 0), z);
  float c = shadowTap(i + ivec2(0, 1), z);
  float d = shadowTap(i + ivec2(1, 1), z);
  float edge = smoothstep(0.0, 0.08, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  return 1.0 - frame.shadow.x * edge * (1.0 - mix(mix(a, b, f.x), mix(c, d, f.x), f.y));
}
// the cloud deck's shadow on a place: the deck's pattern (the sky's, with fewer octaves) where the line to the sun
// crosses its base (frame.pick.z, m; 0: none), its place frame.geo.zw, its cover frame.weather.z; 1 unshaded
float cloudHash(vec2 q) {
  vec2 p = fract(q * vec2(0.1031, 0.103));
  p = p + dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
float cloudNoise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 w = f * f * (3.0 - 2.0 * f);
  return mix(mix(cloudHash(i), cloudHash(i + vec2(1.0, 0.0)), w.x), mix(cloudHash(i + vec2(0.0, 1.0)), cloudHash(i + vec2(1.0, 1.0)), w.x), w.y);
}
float cloudShade(vec3 world) {
  if (frame.pick.z <= 0.0 || frame.weather.z < 0.01 || frame.sun.y < 0.03 || world.y >= frame.pick.z) {
    return 1.0;
  }
  vec2 p = (world.xz + frame.sun.xz * ((frame.pick.z - world.y) / frame.sun.y) + frame.geo.zw) / 3200.0;
  float n = 0.5 * cloudNoise(p) + 0.25 * cloudNoise(p * 2.03 + vec2(17.1, 17.1)) + 0.125 * cloudNoise(p * 4.12 + vec2(51.6, 51.6)) + 0.06;
  float c = 1.0 - frame.weather.z;
  return 1.0 - 0.75 * smoothstep(c * 0.75, c * 0.75 + 0.28, n);
}
vec3 sunLit(vec3 base, vec3 n, vec3 world) {
  float nd = max(dot(n, frame.sun.xyz), 0.0);
  float sh = 0.0;
  if (nd > 0.0) {
    sh = sunShadow(world, n) * cloudShade(world);
  }
  vec3 sky = frame.ambient.rgb * (0.62 + 0.38 * n.y) + frame.ambient.rgb * frame.ambient.w * (0.5 - 0.5 * n.y) + vec3(0.8, 0.85, 1.0) * frame.weather.y;
  float wet = frame.weather.x * max(n.y, 0.0);
  vec3 v = normalize(frame.eye.xyz - world);
  float glint = pow(max(dot(reflect(-v, n), frame.sun.xyz), 0.0), 60.0) * wet * nd * sh;
  float fres = wet * pow(1.0 - max(dot(v, n), 0.0), 4.0);
  vec3 c = base * (1.0 - 0.35 * wet) * (sky + frame.sunColor.rgb * nd * sh);
  c = mix(c, frame.haze.rgb * 0.8, fres * 0.6) + frame.sunColor.rgb * glint;
  return mix(c, vec3(0.8) + 0.2 * (vec3(1.0) - exp(-(c - vec3(0.8)) / 0.2)), vec3(greaterThan(c, vec3(0.8))));
}
vec3 airFog(vec3 c, vec3 world) {
  if (frame.haze.w <= 0.0) {
    return c;
  }
  float d = distance(world, frame.eye.xyz) / frame.haze.w;
  return mix(c, frame.haze.rgb, 1.0 - exp(-d * d));
}
`;
