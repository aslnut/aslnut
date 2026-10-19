// The area mark: polygons as triangles (split finely enough to follow the terrain and the globe), coloured per
// feature from the feature texture, lifted over the ground they lie on, with the reveal modes fade, trace-fill (fills
// after its outline ran round), grow (out from its middle), wipe (west to east), radial and sweep. The outline is a
// line mark drawn by the same layer. Vertex: v (place rel. to the origin: lon rad, Mercator y; ground m; feature
// index). The mark's own: a (depth bias px, height scale, 0, 0). Hooks: /*@position*/ (vertex), /*@color*/,
// /*@alpha*/, /*@reveal*/ (fragment). Twin: area.glsl.ts.
import { FEATURE_WGSL } from './feature.wgsl.ts';

export const AREA_WGSL = /* wgsl */ `${FEATURE_WGSL}
struct Params { /*@params*/ }
@group(0) @binding(2) var<uniform> params: Params;
struct I { @location(0) v: vec4f }
struct O {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) q: vec2f,
  @location(2) @interpolate(flat) idx: f32,
  @location(3) @interpolate(flat) state: vec4f,
  @location(4) world: vec3f,
  @location(5) @interpolate(flat) value: f32,
}
/*@functions*/
fn metresToRel(e: f32, n: f32) -> vec2f {
  return vec2f(e, n) / (RE * max(frame.misc.y, 0.01));
}
@vertex fn vs(i: I) -> O {
  let idx = i.v.w;
  let state = featAt(idx, 2);
  var motion = vec4f(0.0, 0.0, 0.0, 1.0);
  if (u.reveal.y > 0.5) {
    motion = featAt(idx, 5);
  }
  let box = featAt(idx, 4);
  let nums = featAt(idx, 3);
  var rel = i.v.xy;
  if (u.reveal.x == 4.0) {
    rel = box.xy + (rel - box.xy) * state.z;
  }
  rel = box.xy + (rel - box.xy) * motion.w + metresToRel(motion.x, motion.y);
  let value = nums.z;
  let time = frame.eye.w;
  let h = i.v.z * u.origin.z + u.origin.w + raiseOf(state) + motion.z + mix(nums.y, nums.x, u.look.z) * u.a.y;
  var position = placeAt(rel, h);
  /*@position*/
  var o: O;
  o.pos = clipOut(frame.viewProj * vec4f(liftToEye(position, u.a.x), 1.0));
  o.col = colourOf(idx, state);
  o.q = (i.v.xy - box.xy) / max(box.zw, vec2f(0.0000001));
  o.idx = idx;
  o.state = state;
  o.world = position;
  o.value = value;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  var color = i.col;
  var alpha = color.a;
  let reveal = i.state.z;
  let mode = u.reveal.x;
  let time = frame.eye.w;
  let value = i.value;
  let position = i.world;
  let uv = i.q;
  if (mode == 3.0) {
    alpha = alpha * clamp(reveal * 2.0 - 1.0, 0.0, 1.0);
  } else if (mode == 4.0) {
    alpha = alpha * clamp(reveal * 3.0, 0.0, 1.0);
  } else if (mode == 5.0) {
    let e = -1.15 + 2.3 * reveal;
    alpha = alpha * (1.0 - smoothstep(e - 0.12, e + 0.12, i.q.x));
  } else if (mode == 6.0) {
    let e = reveal * 1.6;
    alpha = alpha * (1.0 - smoothstep(e - 0.15, e + 0.05, length(i.q)));
  } else if (mode != 14.0) {
    alpha = alpha * reveal;
  }
  /*@color*/
  alpha = alpha * u.look.x * i.state.w;
  /*@alpha*/
  /*@reveal*/
  if (alpha <= 0.002) {
    discard;
  }
  if (frame.pick.x > 0.5) {
    return pickOut(u.hover2.w, i.idx);
  }
  return vec4f(themed(color.rgb, max(i.state.x, i.state.y)) * mix(1.0, alpha, u.hover2.z), alpha);
}
`;
/** a picture over the feature's box (core › geometry › marks › areas › raster, an image): its texture after the
 *  program's own (binding n) and the sampler after it; imageAt(uv) its colour where uv (-1..1 across the box, north
 *  +1) is. Put in before the functions by the area programs' image variant. Twin: AREA_IMAGE_GLSL (area.glsl.ts) */
export const AREA_IMAGE_WGSL = (n: number) => /* wgsl */ `@group(1) @binding(${n}) var img: texture_2d<f32>;
@group(1) @binding(${n + 1}) var imgSampler: sampler;
fn imageAt(uv: vec2f) -> vec4f {
  // (held as colours times alpha: filtered without fringes, divided again here)
  let c = textureSampleLevel(img, imgSampler, vec2f(uv.x * 0.5 + 0.5, 0.5 - uv.y * 0.5), 0.0);
  return vec4f(c.rgb / max(c.a, 0.0001), c.a);
}
`;
