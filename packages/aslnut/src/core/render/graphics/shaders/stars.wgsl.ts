// Stars from a catalogue: one small screen-facing disc per star at its place in the sky (its equatorial direction
// turned into the view's frame by the sidereal time and the place's latitude), sized and lit by its magnitude,
// coloured by its colour index (B−V); added over the sky, fading at the horizon, with the night and the cloud. Instance
// data: (equatorial direction xyz, magnitude) · (B−V). Twin: stars.glsl.ts.
import { FRAME_WGSL } from './frame.wgsl.ts';

export const STARS_WGSL = /* wgsl */ `${FRAME_WGSL}
// r0..r2: the rows of the turn from the equatorial frame into the view's (x east, y up, z south) · look: (how bright
// 0..1: night, cloud, morph; the faintest magnitude drawn; CSS px a magnitude-0 star spans; a size scale)
struct U { r0: vec4f, r1: vec4f, r2: vec4f, look: vec4f }
@group(0) @binding(1) var<uniform> u: U;
struct I { @builtin(vertex_index) vid: u32, @location(0) a: vec4f, @location(1) b: vec4f }
struct O { @builtin(position) pos: vec4f, @location(0) corner: vec2f, @location(1) col: vec3f }
// the six corners of its two triangles
fn starCorner(v: i32) -> vec2f {
  return vec2f(select(-1.0, 1.0, v == 1 || v == 2 || v == 4), select(-1.0, 1.0, v == 2 || v == 4 || v == 5));
}
// a colour index (B−V) as a colour: blue-white hot stars to orange cool ones
fn starColour(bv: f32) -> vec3f {
  let t = clamp((bv + 0.3) / 2.0, 0.0, 1.0);
  return mix(mix(vec3f(0.62, 0.72, 1.0), vec3f(1.0, 0.97, 0.92), smoothstep(0.0, 0.35, t)), vec3f(1.0, 0.68, 0.42), smoothstep(0.35, 1.0, t));
}
@vertex fn vs(i: I) -> O {
  let e = i.a.xyz;
  let d = vec3f(dot(u.r0.xyz, e), dot(u.r1.xyz, e), dot(u.r2.xyz, e));
  // brighter by 2.512 a magnitude, the faintest drawn just visible; low ones dim through the air
  let lum = clamp(pow(2.512, u.look.y - i.a.w) / pow(2.512, u.look.y), 0.0, 1.0);
  let k = u.look.x * smoothstep(0.0, 0.12, d.y) * smoothstep(-0.05, 0.25, u.look.y - i.a.w);
  let px = max(1.0, u.look.z * pow(lum, 0.25)) * u.look.w * frame.size.z;
  var o: O;
  let corner = starCorner(i32(i.vid));
  let c = frame.viewProj * vec4f(d, 0.0);
  // at infinity, behind everything; a few pixels across
  let off = corner * px / frame.fbsize.xy * c.w;
  o.pos = clipOut(vec4f(c.xy + off, c.w * 0.99999, c.w));
  o.corner = corner;
  o.col = starColour(i.b.x) * min(1.8, 0.35 + 2.2 * pow(lum, 0.5)) * k;
  if (k <= 0.0 || d.y < -0.02) {
    o.pos = vec4f(0.0, 0.0, 2.0, 1.0);
  }
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let r = dot(i.corner, i.corner);
  let a = exp(-r * 2.4);
  return vec4f(themed(i.col, 0.0) * a, a);
}
`;
