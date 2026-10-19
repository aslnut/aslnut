// The sun's light and its shadows, for every mark that is lit (the ground, blocks, shapes). The light comes from the
// frame block (sun direction and colour, the sky's ambient light, the shadow map's matrix); the shadow map is one
// texture the program declares at `binding` of group 1: an 8-bit colour target holding packed depth (every chip
// draws into it, WebGPU and WebGL2 alike), read with four taps and blended (soft edges, no filtering of depths).
// Twin: light.glsl.ts.
export const LIGHT_WGSL = (binding: number) => /* wgsl */ `
@group(1) @binding(${binding}) var shadowMap: texture_2d<f32>;
fn unpackDepth(c: vec4f) -> f32 {
  return dot(c.rgb, vec3f(1.0, 1.0 / 255.0, 1.0 / 65025.0));
}
// 1 where the stored depth is beyond z (lit), 0 where something nearer the sun is there
fn shadowTap(p: vec2i, z: f32) -> f32 {
  let n = vec2i(textureDimensions(shadowMap, 0));
  let q = clamp(p, vec2i(0, 0), n - vec2i(1, 1));
  return step(z, unpackDepth(textureLoad(shadowMap, q, 0)));
}
// how much of the sun reaches a place: 0 in shadow … 1; 1 outside the shadow map. n: the surface normal (the place
// is moved along it by frame.shadow.z metres before the look-up: no acne on the faces that cast)
fn sunShadow(world: vec3f, n: vec3f) -> f32 {
  if (frame.shadow.x <= 0.0) {
    return 1.0;
  }
  let p = frame.light * vec4f(world + n * frame.shadow.z, 1.0);
  let q = p.xyz / p.w;
  let uv = vec2f(q.x * 0.5 + 0.5, 0.5 - q.y * 0.5);
  if (uv.x <= 0.0 || uv.y <= 0.0 || uv.x >= 1.0 || uv.y >= 1.0 || q.z >= 1.0) {
    return 1.0;
  }
  let t = uv / frame.shadow.y - vec2f(0.5, 0.5);
  let i = vec2i(floor(t));
  let f = fract(t);
  // the depth bias grows where the sun grazes the surface (a low sun on flat ground: no stripes of acne)
  let nl = clamp(dot(n, frame.sun.xyz), 0.05, 1.0);
  let z = q.z - frame.shadow.w - frame.fbsize.z * min(sqrt(1.0 - nl * nl) / nl, 8.0);
  let a = shadowTap(i, z);
  let b = shadowTap(i + vec2i(1, 0), z);
  let c = shadowTap(i + vec2i(0, 1), z);
  let d = shadowTap(i + vec2i(1, 1), z);
  // fading out towards the shadow map's edge (no line where the shadows stop)
  let edge = smoothstep(0.0, 0.08, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  return 1.0 - frame.shadow.x * edge * (1.0 - mix(mix(a, b, f.x), mix(c, d, f.x), f.y));
}
// the cloud deck's shadow on a place: the deck's pattern (the sky's, with fewer octaves) where the line to the sun
// crosses its base (frame.pick.z, m; 0: none), its place frame.geo.zw, its cover frame.weather.z; 1 unshaded
fn cloudHash(q: vec2f) -> f32 {
  var p = fract(q * vec2f(0.1031, 0.103));
  p = p + dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
fn cloudNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(cloudHash(i), cloudHash(i + vec2f(1.0, 0.0)), w.x), mix(cloudHash(i + vec2f(0.0, 1.0)), cloudHash(i + vec2f(1.0, 1.0)), w.x), w.y);
}
fn cloudShade(world: vec3f) -> f32 {
  if (frame.pick.z <= 0.0 || frame.weather.z < 0.01 || frame.sun.y < 0.03 || world.y >= frame.pick.z) {
    return 1.0;
  }
  let p = (world.xz + frame.sun.xz * ((frame.pick.z - world.y) / frame.sun.y) + frame.geo.zw) / 3200.0;
  let n = 0.5 * cloudNoise(p) + 0.25 * cloudNoise(p * 2.03 + vec2f(17.1, 17.1)) + 0.125 * cloudNoise(p * 4.12 + vec2f(51.6, 51.6)) + 0.06;
  let c = 1.0 - frame.weather.z;
  return 1.0 - 0.75 * smoothstep(c * 0.75, c * 0.75 + 0.28, n);
}
// a colour under the sky's light and the sun's (with its shadow); the frame's light is off (sunColor.w 0): unchanged
fn sunLit(base: vec3f, n: vec3f, world: vec3f) -> vec3f {
  let nd = max(dot(n, frame.sun.xyz), 0.0);
  var sh = 0.0;
  if (nd > 0.0) {
    sh = sunShadow(world, n) * cloudShade(world);
  }
  let sky = frame.ambient.rgb * (0.62 + 0.38 * n.y) + frame.ambient.rgb * frame.ambient.w * (0.5 - 0.5 * n.y) + vec3f(0.8, 0.85, 1.0) * frame.weather.y;
  // wet: darker, and what faces up gleams with the sky and the sun
  let wet = frame.weather.x * max(n.y, 0.0);
  let v = normalize(frame.eye.xyz - world);
  let glint = pow(max(dot(reflect(-v, n), frame.sun.xyz), 0.0), 60.0) * wet * nd * sh;
  let fres = wet * pow(1.0 - max(dot(v, n), 0.0), 4.0);
  var c = base * (1.0 - 0.35 * wet) * (sky + frame.sunColor.rgb * nd * sh);
  c = mix(c, frame.haze.rgb * 0.8, fres * 0.6) + frame.sunColor.rgb * glint;
  // a soft shoulder over 0.8: a wall in a low sun glows warm instead of clipping to white
  return select(c, vec3f(0.8) + 0.2 * (vec3f(1.0) - exp(-(c - vec3f(0.8)) / 0.2)), c > vec3f(0.8));
}
// the air between the eye and a place: fog and rain (how far one sees, frame.haze.w) blend it into the haze
fn airFog(c: vec3f, world: vec3f) -> vec3f {
  if (frame.haze.w <= 0.0) {
    return c;
  }
  let d = distance(world, frame.eye.xyz) / frame.haze.w;
  return mix(c, frame.haze.rgb, 1.0 - exp(-d * d));
}
`;
