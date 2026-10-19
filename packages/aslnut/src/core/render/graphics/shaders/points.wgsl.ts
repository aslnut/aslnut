// The point mark: one screen-facing disc per feature, sized in CSS pixels, with an outline. Instance data: at
// (longitude radians and Mercator y from the layer's origin, height m (true: × L.origin.z here, then the lift), the
// feature's index). The rest is the feature's own, read from the features texture by its index (colour and the one
// before, size now and before, value, state: see feature.wgsl.ts): a restyle writes it once and eases here, on the
// chip, by the layer block's mix. The mark's own: a (0, depth bias, hovered size ×, selected size ×); each feature's
// outline: its width the numbers' fourth, its colour the mark's own plane (6). Hooks: /*@position*/ (vertex), /*@color*/, /*@alpha*/, /*@reveal*/ (fragment). Twin: points.glsl.ts.
import { FEATURE_WGSL } from './feature.wgsl.ts';

export const POINTS_WGSL = /* wgsl */ `${FEATURE_WGSL}
struct Params { /*@params*/ }
@group(0) @binding(2) var<uniform> params: Params;
struct I { @builtin(vertex_index) vid: u32, @location(0) at: vec4f }
struct O { @builtin(position) pos: vec4f, @location(0) corner: vec2f, @location(1) col: vec4f, @location(2) world: vec3f, @location(3) extra: vec4f, @location(4) size: f32, @location(5) reveal: f32, @location(6) ring: f32, @location(7) oc: vec4f }
/*@functions*/
// on the far side of the globe (the earth's middle is RE under the view centre)
fn behindGlobe(p: vec3f) -> bool {
  return frame.size.w < 0.5 && dot(p - vec3f(0.0, -RE, 0.0), frame.eye.xyz - p) < 0.0;
}
// moved along the line to the eye by half the disc: the same place on screen, and the disc stands in front of the
// ground under it instead of half into it
fn towardEye(p: vec3f, discPx: f32) -> vec3f {
  let toEye = frame.eye.xyz - p;
  let d = length(toEye);
  let mpp = 2.0 * d * frame.misc.z / frame.size.y;
  return p + toEye / max(d, 0.001) * min(discPx * frame.size.z * 0.5 * mpp, d * 0.5);
}
fn cornerOf(v: i32) -> vec2f {
  let x = select(-1.0, 1.0, v == 1 || v == 4 || v == 5);
  let y = select(-1.0, 1.0, v == 2 || v == 3 || v == 5);
  return vec2f(x, y);
}
@vertex fn vs(i: I) -> O {
  var o: O;
  let idx = i.at.w;
  let state = featAt(idx, 2);
  // hidden (its own gate, a filter): nothing drawn
  if (state.w <= 0.0) {
    o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
    return o;
  }
  let nums = featAt(idx, 3);
  let corner = cornerOf(i32(i.vid));
  var position = placeAt(i.at.xy, i.at.z * u.origin.z + u.origin.w);
  let hide = behindGlobe(position);
  let hov = state.x;
  let sel = state.y;
  // its outline: each feature's width (the numbers' fourth) and colour (the mark's own plane)
  let ow = nums.w;
  let ring = ow + u.hover2.y * hov + u.sel2.y * sel;
  // pop: the size overshoots as it grows in, the disc shows over the first quarter
  var grow = 1.0;
  var reveal = state.z;
  if (u.reveal.x == 8.0) {
    grow = max(0.0, easeOutBack(state.z));
    reveal = min(1.0, state.z * 4.0);
  }
  // its size: CSS px, or metres where it is seen, within the layer's range (core › render › drawing › size)
  var size = sizePx(mix(nums.y, nums.x, u.look.z), u.size, position) * grow * mix(1.0, u.a.z, hov) * mix(1.0, u.a.w, sel) + 2.0 * (ring - ow);
  let value = nums.z;
  let time = frame.eye.w;
  /*@position*/
  let lifted = towardEye(position, size);
  let clip = frame.viewProj * vec4f(lifted, 1.0);
  let off = corner * size * frame.size.z / frame.size.xy * clip.w;
  o.pos = select(clipOut(vec4f(clip.xy + off, clip.z - u.a.y * clip.w, clip.w)), vec4f(2.0, 2.0, 2.0, 1.0), hide);
  o.corner = corner;
  o.world = position;
  o.extra = vec4f(value, state.w, idx, hov + 2.0 * sel);
  o.size = size * frame.size.z;
  o.reveal = reveal;
  o.ring = ring;
  o.oc = featAt(idx, 6);
  o.col = colourOf(idx, state);
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let r = length(i.corner);
  let px = 2.0 / max(i.size, 1.0);
  let disc = 1.0 - smoothstep(1.0 - px, 1.0, r);
  let ring = smoothstep(1.0 - px * (i.ring + 1.0), 1.0 - px * i.ring, r);
  let hov = select(0.0, 1.0, i.extra.w == 1.0 || i.extra.w == 3.0);
  let sel = select(0.0, 1.0, i.extra.w >= 2.0);
  let oc = mix(mix(i.oc.rgb, u.sel.rgb, sel), u.hover.rgb, hov);
  let oa = max(i.oc.a, max(hov, sel));
  var color = vec4f(mix(i.col.rgb, oc, ring * oa), i.col.a * disc);
  let uv = i.corner;
  let value = i.extra.x;
  let time = frame.eye.w;
  let position = i.world;
  /*@color*/
  var alpha = color.a * u.look.x * i.extra.y;
  /*@alpha*/
  let reveal = i.reveal;
  /*@reveal*/
  if (alpha <= 0.002) {
    discard;
  }
  if (frame.pick.x > 0.5) {
    return pickOut(u.hover2.w, i.extra.z);
  }
  return vec4f(themed(color.rgb, max(hov, sel)), alpha);
}
`;
