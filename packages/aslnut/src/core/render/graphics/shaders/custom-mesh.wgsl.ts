// A custom layer of your own geometry (vertex arrays drawn with your own shader): your positions, normals,
// uvs, colours and attributes per vertex (triangles or lines), drawn at each copy's place (instances, with their own
// attributes), your uniforms (numbers, vectors, colours, textures), your varyings, and your vertex and fragment code in
// the WGSL subset. aslnut writes the declarations at the markers. Places are metres from each copy's place: x east,
// y up, z south. Twin: custom-mesh.glsl.ts.
import { FRAME_WGSL } from './frame.wgsl.ts';

export const CUSTOM_MESH_WGSL = /* wgsl */ `${FRAME_WGSL}
// misc: (depth bias, the layer's pick number, opacity, reveal) · pt: (a point's size in CSS px, 1 when the vertices are
// points: each drawn as six (a square facing the screen), 0, 0) · size: a copy's range on screen (its geometry's size
// across m, the least and the most CSS px, 1 when set: core › render › drawing › size)
struct U { misc: vec4f, pt: vec4f, size: vec4f }
@group(0) @binding(1) var<uniform> u: U;
struct Params { /*@params*/ }
@group(0) @binding(2) var<uniform> params: Params;
/*@textures*/
struct I { @location(0) a_position: vec3f, @location(1) a_normal: vec3f, @location(2) a_uv: vec2f, @location(3) a_color: vec4f, @location(4) i_at: vec4f, /*@attributes*/ }
struct O { @builtin(position) pos: vec4f, @location(0) v_uv: vec2f, @location(1) v_normal: vec3f, @location(2) v_world: vec3f, @location(3) v_color: vec4f, @location(4) @interpolate(flat) v_inst: f32, @location(5) v_corner: vec2f, /*@varyings*/ }
// the sky's light on a surface facing n (its ambient and the sun, no shadows): multiply a colour by it
fn lambert(n: vec3f) -> vec3f {
  return select(vec3f(1.0), frame.ambient.rgb + frame.sunColor.rgb * max(dot(n, frame.sun.xyz), 0.0), frame.sunColor.w > 0.5);
}
/*@functions*/
fn cornerOf(v: i32) -> vec2f {
  let x = select(-1.0, 1.0, v == 1 || v == 4 || v == 5);
  let y = select(-1.0, 1.0, v == 2 || v == 3 || v == 5);
  return vec2f(x, y);
}
@vertex fn vs(i: I, @builtin(instance_index) inst: u32, @builtin(vertex_index) vid: u32) -> O {
  var position = i.a_position;
  var normal = i.a_normal;
  let uv = i.a_uv;
  var color = i.a_color;
  let time = frame.eye.w;
  let eye = frame.eye.xyz;
  let origin = i.i_at.xyz;
  /*@inputs*/
  /*@vertex*/
  // a copy kept within its range of CSS px (round its place)
  let keep = select(1.0, sizeKeep(u.size.x, vec4f(1.0, u.size.y, u.size.z, 0.0), i.i_at.xyz), u.size.w > 0.5);
  let world = i.i_at.xyz + position * keep;
  var clip = frame.viewProj * vec4f(world, 1.0);
  var corner = vec2f(0.0);
  if (u.pt.y > 0.5) {
    corner = cornerOf(i32(vid % 6u));
    clip = vec4f(clip.xy + corner * u.pt.x * frame.size.z / frame.size.xy * clip.w, clip.z, clip.w);
  }
  var o: O;
  o.pos = clipOut(vec4f(clip.xy, clip.z - u.misc.x * clip.w, clip.w));
  o.v_uv = uv;
  o.v_normal = normal;
  o.v_world = world;
  o.v_color = color;
  o.v_inst = f32(inst);
  o.v_corner = corner;
  /*@outputs*/
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  if (frame.pick.y > 0.5) {
    return packDepth(i.pos.z);
  }
  if (frame.pick.x > 0.5) {
    return pickOut(u.misc.y, i.v_inst);
  }
  let uv = i.v_uv;
  let normal = normalize(i.v_normal);
  let position = i.v_world;
  let time = frame.eye.w;
  let corner = i.v_corner;
  var color = i.v_color;
  /*@finputs*/
  /*@fragment*/
  let alpha = color.a * u.misc.z * u.misc.w;
  if (alpha <= 0.002) {
    discard;
  }
  return vec4f(themed(color.rgb, 0.0), alpha);
}
`;
