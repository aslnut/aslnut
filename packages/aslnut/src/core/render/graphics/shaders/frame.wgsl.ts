// The frame block every program shares (group 0, binding 0). Twin: frame.glsl.ts.
//   viewProj · eye (xyz: the camera in world metres, w: the world's clock, s) · size (device px w, h, pixel ratio,
//   morph) · sun (direction xyz, daylight) · misc (centre lat rad, cos lat, tan(fov / 2), the body's radius) · geo
//   (Mercator y of the centre, sin lat, 0, 0) · pick (1 while drawing ids for picking, 0, 0, 0) · region (the part of
//   the screen drawn: xy scale, zw offset; (1, 1, 0, 0) for the whole frame, a few pixels round the pointer for picking)
//   · inv (viewProj inverted: a pixel and its depth back to world metres) · fbsize (the size drawn into, px: w, h; the
//   shadow depth bias per unit of the slope towards the sun; the view's CSS height: sizes in CSS px, every pass)
//   · light (world metres → the sun's shadow map, clip space) · sunColor (rgb × intensity, 1 when the world has a
//   real light: a sky with a sun; 0: each mark keeps its own fixed shading) · ambient (the sky's light rgb, the ground's
//   bounce) · shadow (its strength 0..1 when the shadow map is drawn, else 0; 1 / its size, the normal offset m, the
//   depth bias) · haze (the air's colour far away: rgb, and how far one sees through it, m: 0 = no haze from the sky)
//   · weather (how wet the ground is 0..1, a lightning flash 0..1, cloud cover 0..1, wind m/s) · theme (the analysis
//   view's tint rgb, how far towards it) · mute (how grey, brightness, contrast, how much it mutes now: 0 = as it is;
//   a theme's subject draws with mute.w 0) · themeGround (× the ground's brightness under it, 0, 0, 0)
//   pick.y is 1 while drawing the shadow map (casters write their depth, packed)
export const FRAME_WGSL = /* wgsl */ `
struct Frame { viewProj: mat4x4f, eye: vec4f, size: vec4f, sun: vec4f, misc: vec4f, geo: vec4f, pick: vec4f, region: vec4f, inv: mat4x4f, fbsize: vec4f, light: mat4x4f, sunColor: vec4f, ambient: vec4f, shadow: vec4f, haze: vec4f, weather: vec4f, theme: vec4f, mute: vec4f, themeGround: vec4f }
@group(0) @binding(0) var<uniform> frame: Frame;
// WebGPU's clip space already is the one aslnut writes (depth 0..w); the region zooms onto a few pixels for picking
fn clipOut(p: vec4f) -> vec4f { return vec4f(p.xy * frame.region.xy + frame.region.zw * p.w, p.z, p.w); }
// the ground's place in the depth order: a little farther than its own depth (in the depth buffer's units: some 32
// steps of a 24-bit buffer, centimetres in the world), so whatever lies on it wins every tie: a road, a verge, a park,
// paint. In the shader, not the pipeline: the same on WebGPU and WebGL2, every depth format
const GROUND_DEPTH_BIAS: f32 = 2e-6;
fn groundClip(p: vec4f) -> vec4f { return vec4f(p.xy, p.z + GROUND_DEPTH_BIAS * p.w, p.w); }
// a layer number (1..255) and a feature index (0..2^24 - 1) as a colour: what picking reads back
fn pickOut(layer: f32, index: f32) -> vec4f {
  let i = u32(max(index, 0.0) + 0.5);
  return vec4f(layer, f32(i & 255u), f32((i >> 8u) & 255u), f32((i >> 16u) & 255u)) / 255.0;
}
// core › render › style › theme: what is not an analysis view's subject muted (greyed, towards the tint keeping its
// light and dark, contrast round the middle grey, brightness), by mute.w; keep 0..1: how much of it is a subject (the
// selected, the hovered, a thing an analysis tints). No theme (mute.w 0): the colour as it is
fn themed(c: vec3f, keep: f32) -> vec3f {
  let k = frame.mute.w * (1.0 - keep);
  if (k <= 0.0) {
    return c;
  }
  let l = dot(c, vec3f(0.299, 0.587, 0.114));
  var m = mix(c, vec3f(l), frame.mute.x);
  m = mix(m, frame.theme.rgb * (2.0 * l), frame.theme.w);
  m = (m - vec3f(0.5)) * frame.mute.z + vec3f(0.5);
  m = max(m * frame.mute.y, vec3f(0.0));
  return mix(c, m, k);
}
// the ground under a theme: muted, and darker or lighter than what stands on it (themeGround.x)
fn themedGround(c: vec3f) -> vec3f {
  return themed(c, 0.0) * mix(1.0, frame.themeGround.x, frame.mute.w);
}
// core › render › drawing › instancing: one size rule for every mark and shape. s: (units: 0 CSS px, 1 metres; the
// least and the most CSS px). Metres become the CSS px they cover where p is seen (a zoom writes nothing); either is
// kept within [least, most]
// the view's own eye: in the shadow map's pass the eye is the light's, the view's found from its inverse (so a thing
// casts the shadow of the size it is drawn at)
fn viewEye() -> vec3f {
  if (frame.pick.y > 0.5) {
    let h = frame.inv * vec4f(0.0, 0.0, 1.0, 0.0);
    return h.xyz / h.w;
  }
  return frame.eye.xyz;
}
// metres per CSS px at p, as the view sees it (fbsize.w: the view's CSS height, in every pass)
fn cssMpp(p: vec3f) -> f32 {
  return 2.0 * length(viewEye() - p) * frame.misc.z / max(frame.fbsize.w, 1.0);
}
fn sizePx(v: f32, s: vec4f, p: vec3f) -> f32 {
  var px = v;
  if (s.x > 0.5) {
    px = v / max(cssMpp(p), 0.000000001);
  }
  return clamp(px, s.y, s.z);
}
// the share of its own size a thing of m metres across keeps at p so that it covers [least, most] CSS px (1: as it is)
fn sizeKeep(m: f32, s: vec4f, p: vec3f) -> f32 {
  let px = m / max(cssMpp(p), 0.000000001);
  return clamp(px, s.y, s.z) / max(px, 0.000000001);
}
// a depth 0..1 in three bytes (the shadow map is an 8-bit colour target on every chip)
fn packDepth(d: f32) -> vec4f {
  let e = fract(vec3f(1.0, 255.0, 65025.0) * clamp(d, 0.0, 0.999999));
  return vec4f(e - vec3f(e.y, e.z, 0.0) / 255.0, 1.0);
}
`;
