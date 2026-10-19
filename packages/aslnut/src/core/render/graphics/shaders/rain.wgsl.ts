// Rain: streaks falling round the eye, each a thin quad a pixel or two wide, as long as it falls in a moment, slanted
// by the wind; they wrap round the eye (a box of space travels with it, the streaks stay where they are in the world
// as it moves); hidden by what stands in front (depth test), never hiding anything (no depth write). Twin: rain.glsl.ts.
//   instance: (x, y, z in the box 0..1, speed 0.7..1.3)
import { FRAME_WGSL } from './frame.wgsl.ts';

export const RAIN_WGSL = /* wgsl */ `${FRAME_WGSL}
// a: (the box's side m, its height m, how hard it rains 0..1, the wind m/s) · b: (colour rgb, opacity) ·
// c: (where the eye is in metres of a frame fixed to the ground, x, z; the rain's clock s; 0)
struct U { a: vec4f, b: vec4f, c: vec4f }
@group(0) @binding(1) var<uniform> u: U;
struct I { @location(0) s: vec4f }
struct O { @builtin(position) pos: vec4f, @location(0) alpha: f32 }
fn wrapIn(v: f32, size: f32) -> f32 {
  return v - size * floor(v / size) - size * 0.5;
}
@vertex fn vs(i: I, @builtin(vertex_index) vid: u32) -> O {
  let side = u.a.x;
  let h = u.a.y;
  let t = u.c.z;
  let speed = 9.0 * i.s.w;
  // where the streak is: its place in the box, the box round the eye (fixed to the ground as the eye moves)
  let x = wrapIn(i.s.x * side - u.c.x, side);
  let z = wrapIn(i.s.z * side - u.c.y, side);
  let y = wrapIn(i.s.y * h - t * speed, h);
  let top = frame.eye.xyz + vec3f(x, y, z);
  let fall = vec3f(u.a.w * 0.06, -1.0, 0.0) * (0.06 * speed);
  // two triangles: corners 0 1 2, 2 1 3 (end along the fall, side across it)
  var k = vid;
  if (vid == 3u) {
    k = 2u;
  } else if (vid == 4u) {
    k = 1u;
  } else if (vid == 5u) {
    k = 3u;
  }
  let end = f32(k % 2u);
  let side2 = f32(k / 2u) * 2.0 - 1.0;
  let p = top + fall * end;
  var o: O;
  let c0 = frame.viewProj * vec4f(top, 1.0);
  let c1 = frame.viewProj * vec4f(top + fall, 1.0);
  let dir = normalize((c1.xy / max(c1.w, 0.001) - c0.xy / max(c0.w, 0.001)) * frame.size.xy + vec2f(0.0001, 0.0));
  let across = vec2f(-dir.y, dir.x) / frame.size.xy * frame.size.z * 1.2;
  var c = frame.viewProj * vec4f(p, 1.0);
  c = vec4f(c.xy + across * side2 * c.w, c.z, c.w);
  o.pos = clipOut(c);
  let dist = length(vec2f(x, z));
  o.alpha = u.b.w * (1.0 - smoothstep(side * 0.25, side * 0.5, dist)) * (0.35 + 0.65 * u.a.z);
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  if (i.alpha <= 0.002) {
    discard;
  }
  return vec4f(themed(u.b.rgb, 0.0), i.alpha);
}
`;
