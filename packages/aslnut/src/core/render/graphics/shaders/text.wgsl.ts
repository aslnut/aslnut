// The text mark: labels as screen-facing quads (CSS px) cut from one atlas of rendered labels (each with its halo),
// placed over a point of the world, readable at any tilt. Reveal modes: type (left to right in steps), mask (a soft
// wipe), fade (count runs on the CPU: numbers count up). Instance: at (world xyz, 0) · box (w, h px, offset x, y px) ·
// uv (u0, v0, u1, v1) · extra (alpha, reveal, feature index, hovered + 2 · selected).
// The mark's own block T: misc (depth bias, pick number, mode, 0) · hov (rgb, mix). Hooks: /*@color*/, /*@alpha*/,
// /*@reveal*/ (fragment). Twin: text.glsl.ts.
import { FRAME_WGSL } from './frame.wgsl.ts';

export const TEXT_WGSL = /* wgsl */ `${FRAME_WGSL}
struct T { misc: vec4f, hov: vec4f }
@group(0) @binding(1) var<uniform> u: T;
struct Params { /*@params*/ }
@group(0) @binding(2) var<uniform> params: Params;
@group(1) @binding(0) var atlas: texture_2d<f32>;
@group(1) @binding(1) var smp: sampler;
struct I { @builtin(vertex_index) vid: u32, @location(0) at: vec4f, @location(1) box: vec4f, @location(2) uvr: vec4f, @location(3) extra: vec4f }
struct O { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) t: vec2f, @location(2) @interpolate(flat) extra: vec4f }
/*@functions*/
fn quadCorner(v: i32) -> vec2f {
  let x = select(0.0, 1.0, v == 1 || v == 4 || v == 5);
  let y = select(0.0, 1.0, v == 2 || v == 3 || v == 5);
  return vec2f(x, y);
}
@vertex fn vs(i: I) -> O {
  let c = quadCorner(i32(i.vid));
  let clip = frame.viewProj * vec4f(i.at.xyz, 1.0);
  let px = (vec2f(c.x - 0.5, 0.5 - c.y) * i.box.xy + vec2f(i.box.z, -i.box.w)) * frame.size.z;
  var o: O;
  o.pos = clipOut(vec4f(clip.xy + px / (frame.size.xy * 0.5) * clip.w, clip.z - u.misc.x * clip.w, clip.w));
  o.uv = mix(i.uvr.xy, i.uvr.zw, c);
  o.t = c;
  o.extra = i.extra;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  var color = textureSampleLevel(atlas, smp, i.uv, 0.0);
  let hov = select(0.0, 1.0, i.extra.w == 1.0 || i.extra.w == 3.0);
  color = vec4f(mix(color.rgb, u.hov.rgb, u.hov.a * hov * color.a), color.a);
  var alpha = color.a * i.extra.x;
  let uv = i.t;
  let time = frame.eye.w;
  let reveal = i.extra.y;
  if (u.misc.z == 11.0) {
    alpha = alpha * step(uv.x, reveal + 0.0001);
  } else if (u.misc.z == 13.0) {
    alpha = alpha * (1.0 - smoothstep(reveal * 1.2 - 0.2, reveal * 1.2, uv.x));
  } else if (u.misc.z != 12.0 && u.misc.z != 14.0) {
    alpha = alpha * reveal;
  }
  /*@color*/
  /*@alpha*/
  /*@reveal*/
  if (alpha <= 0.004) {
    discard;
  }
  if (frame.pick.x > 0.5) {
    return pickOut(u.misc.y, i.extra.z);
  }
  return vec4f(themed(color.rgb, step(0.5, i.extra.w)), alpha);
}
`;
