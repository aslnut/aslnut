// The extrusion mark: footprints raised into blocks (buildings, bars on a map), walls and a roof, lit by the sun,
// standing on the lowest ground under their footprint; reveal modes rise (grow up), pop (spring up from the middle),
// sweep and fade. Vertex: v (place rel. to the origin: lon rad, Mercator y; the ground here m; feature index) ·
// n (normal east, up, north; 1 on the roof). Heights come from the feature texture (plane 3: now, before, value,
// the footprint's lowest ground). The mark's own: a (depth bias px, 0, 0, 0). Hooks: /*@position*/ (vertex),
// /*@color*/, /*@alpha*/, /*@reveal*/ (fragment). Twin: extrusion.glsl.ts.
import { FEATURE_WGSL } from './feature.wgsl.ts';
import { LIGHT_WGSL } from './light.wgsl.ts';

export const EXTRUSION_WGSL = /* wgsl */ `${FEATURE_WGSL}
struct Params { /*@params*/ }
@group(0) @binding(2) var<uniform> params: Params;
${LIGHT_WGSL(1)}
struct I { @location(0) v: vec4f, @location(1) n: vec4f }
struct O {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) @interpolate(flat) idx: f32,
  @location(2) @interpolate(flat) state: vec4f,
  @location(3) world: vec3f,
  @location(4) normal: vec3f,
  @location(5) up: f32,
  @location(6) @interpolate(flat) value: f32,
  @location(7) shade: f32,
}
/*@functions*/
fn shade(n: vec3f, top: f32) -> f32 {
  let l = normalize(vec3f(-0.45, 0.8, -0.35));
  return mix(0.62 + 0.38 * max(dot(n, l), 0.0), 1.0, top * 0.35);
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
  let ex = u.origin.z;
  var grow = 1.0;
  var scale = motion.w;
  if (u.reveal.x == 9.0) {
    grow = state.z;
  }
  if (u.reveal.x == 8.0) {
    scale = scale * easeOutBack(state.z);
    grow = easeOutBack(state.z);
  }
  let rel = box.xy + (i.v.xy - box.xy) * scale + vec2f(motion.x, motion.y) / (RE * max(frame.misc.y, 0.01));
  let height = mix(nums.y, nums.x, u.look.z) * grow;
  let base = nums.w * ex + u.origin.w + motion.z + raiseOf(state);
  var h = min(i.v.z, nums.w) * ex - 30.0;
  if (i.n.w > 0.5) {
    h = base + max(height, 0.0);
  }
  let value = nums.z;
  let time = frame.eye.w;
  var position = placeAt(rel, h);
  /*@position*/
  var o: O;
  o.pos = clipOut(frame.viewProj * vec4f(liftToEye(position, u.a.x), 1.0));
  let c = colourOf(idx, state);
  o.col = c;
  o.shade = shade(i.n.xyz, i.n.w);
  o.idx = idx;
  o.state = state;
  o.world = position;
  o.normal = i.n.xyz;
  o.up = i.n.w;
  o.value = value;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  // lit by the world's sun and sky (with shadows), or the fixed shading
  var color = vec4f(airFog(themed(mix(i.col.rgb * i.shade, sunLit(i.col.rgb, normalize(i.normal), i.world), frame.sunColor.w), max(i.state.x, i.state.y)), i.world), i.col.a);
  var alpha = color.a;
  let reveal = i.state.z;
  let mode = u.reveal.x;
  let time = frame.eye.w;
  let value = i.value;
  let position = i.world;
  let normal = i.normal;
  if (mode == 0.0 || mode == 7.0) {
    alpha = alpha * reveal;
  } else if (mode != 14.0) {
    alpha = alpha * step(0.001, reveal);
  }
  /*@color*/
  alpha = alpha * u.look.x * i.state.w;
  /*@alpha*/
  /*@reveal*/
  if (alpha <= 0.002) {
    discard;
  }
  if (frame.pick.y > 0.5) {
    return packDepth(i.pos.z);
  }
  if (frame.pick.x > 0.5) {
    return pickOut(u.hover2.w, i.idx);
  }
  return vec4f(color.rgb * mix(1.0, alpha, u.hover2.z), alpha);
}
`;
