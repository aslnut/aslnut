// A field drawn as a surface over the ground (core › simulation › fields, draw: { on: 'surface' }): a grid of quads, a
// vertex per cell, standing at the cell's base (its ground input) plus its value (water: its depth). It reads the
// field's state straight from its texture (no trip through the CPU), coloured by a ramp, lit by the world's sun and
// sky with a sheen of the sky at a glancing view, faded where the value is below the least drawn. Twin:
// field-surface.glsl.ts.
import { FRAME_WGSL } from './frame.wgsl.ts';
import { LIGHT_WGSL } from './light.wgsl.ts';

export const FIELD_SURFACE_WGSL = /* wgsl */ `${FRAME_WGSL}
// p: (the north-west cell's centre in world metres x, z; metres a cell x, z) · l: (the ramp's low and high, the least
// drawn, opacity) · m: (exaggeration, columns, rows, which of the four numbers) · e: (1: lying on its base, the value
// only colouring it; metres above the base, the next epoch's share (its values over time: core › data › history ›
// epochs, morphed on the chip), 0)
struct S { p: vec4f, l: vec4f, m: vec4f, e: vec4f }
@group(0) @binding(1) var<uniform> s: S;
@group(1) @binding(0) var state: texture_2d<f32>;
@group(1) @binding(1) var base: texture_2d<f32>;
@group(1) @binding(2) var lut: texture_2d<f32>;
${LIGHT_WGSL(3)}
// the next epoch's state (epochs morphed; else the state again, its share 0)
@group(1) @binding(4) var next: texture_2d<f32>;
struct O { @builtin(position) pos: vec4f, @location(0) world: vec3f, @location(1) v: f32, @location(2) n: vec3f }
fn cellOf(i: i32, j: i32) -> vec2i {
  return clamp(vec2i(i, j), vec2i(0, 0), vec2i(i32(s.m.y) - 1, i32(s.m.z) - 1));
}
// which of a cell's four numbers is drawn
fn channelOf(c: vec4f) -> f32 {
  return select(select(select(c.x, c.y, s.m.w > 0.5), c.z, s.m.w > 1.5), c.w, s.m.w > 2.5);
}
fn cellValue(i: i32, j: i32) -> f32 {
  let a = channelOf(textureLoad(state, cellOf(i, j), 0));
  if (s.e.z <= 0.0) {
    return a;
  }
  return mix(a, channelOf(textureLoad(next, cellOf(i, j), 0)), s.e.z);
}
// the top of a cell in world metres (its base plus its value, exaggerated as the ground is)
fn cellTop(i: i32, j: i32) -> f32 {
  return (textureLoad(base, cellOf(i, j), 0).x + cellValue(i, j) * (1.0 - s.e.x)) * s.m.x + s.e.y;
}
@vertex fn vs(@builtin(vertex_index) vi: u32) -> O {
  let cols = u32(s.m.y) - 1u;
  let quad = vi / 6u;
  let k = vi % 6u;
  // a quad's two triangles: (0, 0) (1, 0) (0, 1) · (0, 1) (1, 0) (1, 1)
  let cx = select(0, 1, k == 1u || k == 4u || k == 5u);
  let cz = select(0, 1, k == 2u || k == 3u || k == 5u);
  let i = i32(quad % cols) + cx;
  let j = i32(quad / cols) + cz;
  let y = cellTop(i, j);
  let gx = (cellTop(i + 1, j) - cellTop(i - 1, j)) / (2.0 * s.p.z);
  let gz = (cellTop(i, j + 1) - cellTop(i, j - 1)) / (2.0 * s.p.w);
  var o: O;
  o.world = vec3f(s.p.x + f32(i) * s.p.z, y, s.p.y + f32(j) * s.p.w);
  o.n = normalize(vec3f(-gx, 1.0, -gz));
  o.v = cellValue(i, j);
  o.pos = clipOut(frame.viewProj * vec4f(o.world, 1.0));
  return o;
}
@fragment fn fs(o: O) -> @location(0) vec4f {
  if (o.v < s.l.z) {
    discard;
  }
  let t = clamp((o.v - s.l.x) / max(s.l.y - s.l.x, 0.000001), 0.0, 1.0);
  let col = textureLoad(lut, vec2i(i32(t * 255.0), 0), 0);
  var c = col.rgb;
  if (frame.sunColor.w > 0.5) {
    c = sunLit(col.rgb, o.n, o.world);
  }
  let v = normalize(frame.eye.xyz - o.world);
  let fres = pow(1.0 - max(dot(v, o.n), 0.0), 3.0);
  c = airFog(mix(themed(c, 0.0), frame.haze.rgb, fres * 0.5), o.world);
  // faded in over its least drawn (water's edge); lying on its base (a value colouring the ground), or no least: whole
  let fade = select(1.0, smoothstep(s.l.z, s.l.z * 3.0 + 0.0001, o.v), s.l.z > -1.0e29 && s.e.x < 0.5);
  let a = s.l.w * col.a * fade;
  return vec4f(c, a);
}
`;
