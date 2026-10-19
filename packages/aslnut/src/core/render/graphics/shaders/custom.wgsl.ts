// A fully custom layer: one quad per item (facing the screen, sized in CSS px; or lying on the ground, sized in
// metres), with the item's attributes, your params as uniforms, your varyings, and your vertex and fragment code
// (the WGSL subset). aslnut writes the declarations at /*@attributes*/, /*@varyings*/, /*@inputs*/, /*@outputs*/.
// Twin: custom.glsl.ts.
import { FRAME_WGSL } from './frame.wgsl.ts';

export const CUSTOM_WGSL = /* wgsl */ `${FRAME_WGSL}
// misc: (depth bias, shape: 0 screen / 1 ground, opacity, reveal) · size: how an item's size is drawn (units: 0 CSS px,
// 1 metres; the least and the most CSS px: core › render › drawing › size)
struct U { misc: vec4f, size: vec4f }
@group(0) @binding(1) var<uniform> u: U;
struct Params { /*@params*/ }
@group(0) @binding(2) var<uniform> params: Params;
struct I { @builtin(vertex_index) vid: u32, @location(0) at: vec4f, /*@attributes*/ }
struct O { @builtin(position) pos: vec4f, @location(0) corner: vec2f, /*@varyings*/ }
/*@functions*/
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
  let corner = cornerOf(i32(i.vid));
  var position = i.at.xyz;
  var size = i.at.w;
  let time = frame.eye.w;
  // its size by the layer's rule: facing the screen, CSS px; on the ground, metres (CSS px there as metres)
  if (u.misc.y > 0.5) {
    size = select(sizePx(size, u.size, position) * cssMpp(position), size * sizeKeep(size, u.size, position), u.size.x > 0.5);
  } else {
    size = sizePx(size, u.size, position);
  }
  /*@inputs*/
  /*@vertex*/
  var clip = frame.viewProj * vec4f(position, 1.0);
  if (u.misc.y > 0.5) {
    clip = frame.viewProj * vec4f(position + vec3f(corner.x, 0.0, -corner.y) * size * 0.5, 1.0);
  } else {
    clip = frame.viewProj * vec4f(towardEye(position, size), 1.0);
    clip = vec4f(clip.xy + corner * size * frame.size.z / frame.size.xy * clip.w, clip.z, clip.w);
  }
  var o: O;
  o.pos = clipOut(vec4f(clip.xy, clip.z - u.misc.x * clip.w, clip.w));
  o.corner = corner;
  /*@outputs*/
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let corner = i.corner;
  let time = frame.eye.w;
  var color = vec4f(1.0);
  /*@finputs*/
  /*@fragment*/
  let alpha = color.a * u.misc.z * u.misc.w;
  if (alpha <= 0.002) {
    discard;
  }
  return vec4f(themed(color.rgb, 0.0), alpha);
}
`;
