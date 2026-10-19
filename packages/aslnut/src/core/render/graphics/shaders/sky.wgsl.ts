// The sky, one full-screen pass behind everything: from space, black with stars and the glow round the globe's edge;
// over the flat map, a sky from the horizon colour up to the zenith; blended by the morph. Twin: sky.glsl.ts.
import { FRAME_WGSL } from './frame.wgsl.ts';

export const SKY_WGSL = /* wgsl */ `${FRAME_WGSL}
// inv: the inverse view-projection · misc: (morph, radius, stars, 0)
struct U { inv: mat4x4f, space: vec4f, glow: vec4f, horizon: vec4f, zenith: vec4f, misc: vec4f }
@group(0) @binding(1) var<uniform> u: U;
struct O { @builtin(position) pos: vec4f, @location(0) ndc: vec2f }
@vertex fn vs(@builtin(vertex_index) vid: u32) -> O {
  let i = i32(vid);
  let p = vec2f(f32((i << 1u) & 2), f32(i & 2)) * 2.0 - 1.0;
  var o: O;
  o.pos = clipOut(vec4f(p, 1.0, 1.0));
  o.ndc = p;
  return o;
}
// an integer hash: the same bits on every chip and both graphics
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hash3(q: vec3f) -> f32 {
  let iq = vec3i(q);
  return f32(pcg(u32(iq.x) ^ pcg(u32(iq.y) ^ pcg(u32(iq.z))))) / 4294967295.0;
}
fn skyColor(ndc: vec2f) -> vec3f {
  let a = u.inv * vec4f(ndc, 0.0, 1.0);
  let b = u.inv * vec4f(ndc, 1.0, 1.0);
  let o = a.xyz / a.w;
  let d = normalize(b.xyz / b.w - o);
  let q = floor(d * 900.0);
  let s = step(1.0 - 0.0018 * u.misc.z, hash3(q)) * hash3(q + vec3f(1.0, 2.0, 3.0));
  var c = u.space.rgb + vec3f(s);
  let C = vec3f(0.0, -u.misc.y, 0.0);
  let oc = C - o;
  let t = dot(oc, d);
  if (t > 0.0) {
    let dm = length(oc - d * t);
    let g = exp(-max(dm - u.misc.y, 0.0) / (u.misc.y * 0.035)) * smoothstep(u.misc.y * 0.96, u.misc.y, dm);
    c = mix(c, u.glow.rgb, clamp(g, 0.0, 1.0));
  }
  let sky = mix(u.horizon.rgb, u.zenith.rgb, smoothstep(0.0, 0.45, d.y));
  return mix(c, sky, u.misc.x);
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  return vec4f(themed(skyColor(i.ndc), 0.0), 1.0);
}
`;
