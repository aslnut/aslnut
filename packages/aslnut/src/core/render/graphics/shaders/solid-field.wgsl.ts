// A solids mesh with a surface field's values (core › simulation › fields › surface): the mesh's own program with one
// more texture, a value per vertex turned into a colour by the field's ramp over the vertex's own (lit, shadowed and
// windowed as before). The texture (r32f, FW texels a row): row 0 the look (on, the ramp's low and high, the least
// drawn, how much over its own colour, the next values' share, the rows one set of values takes, a theme's subject;
// from texel 8 the ramp: 256 colours, each 0xRRGGBB as a number), then the values (one a vertex, in the order drawn),
// then the next epoch's (morph: both on the chip, mixed by their share). A value below −1e30: none (its own colour).
// Twin: solid-field.glsl.ts.
import { SOLID_WGSL } from './solid.wgsl.ts';

/** texels a row of a field's texture */
export const FIELD_TEXELS = 2048;
const FNS = /* wgsl */ `
@group(1) @binding(4) var fieldv: texture_2d<f32>;
const FW = 2048;
// texel k of the field's texture, row by row
fn fieldTexel(k: i32) -> f32 {
  return textureLoad(fieldv, vec2i(k % FW, k / FW), 0).x;
}
// vertex vi's value: its epoch's, the next one's mixed in by its share (one missing: the other)
fn fieldValue(vi: i32) -> f32 {
  let a = fieldTexel(FW + vi);
  let f = fieldTexel(5);
  if (f <= 0.0) {
    return a;
  }
  let b = fieldTexel(FW * (1 + i32(fieldTexel(6))) + vi);
  if (a < -1.0e30) {
    return b;
  }
  if (b < -1.0e30) {
    return a;
  }
  return mix(a, b, f);
}
// a value's colour over the vertex's own: the ramp between its two nearest colours, by how much; its own colour where
// there is none, or below the least drawn
fn fieldColor(own: vec3f, v: f32) -> vec3f {
  if (fieldTexel(0) < 0.5 || v < -1.0e30 || v < fieldTexel(3)) {
    return own;
  }
  let lo = fieldTexel(1);
  let hi = fieldTexel(2);
  let x = clamp((v - lo) / max(hi - lo, 0.000001), 0.0, 1.0) * 255.0;
  let i = i32(floor(x));
  let j = min(i + 1, 255);
  let c = mix(unpackRGB(fieldTexel(8 + i)), unpackRGB(fieldTexel(8 + j)), x - f32(i));
  return mix(own, c, fieldTexel(4));
}
// shown and a subject: a theme keeps its colours
fn fieldKeep() -> f32 {
  return step(0.5, fieldTexel(0)) * step(0.001, fieldTexel(4)) * fieldTexel(7);
}
`;
/** the solids' mesh program with a field's values */
export const SOLID_FIELD_WGSL = /* wgsl */ `${SOLID_WGSL.replace('/*@fieldvertex*/', 'o.col = fieldColor(o.col, fieldValue(i32(vi)));').replace('/*@fieldfragment*/', 'fieldNear = fieldKeep();')}
${FNS}`;
if (SOLID_FIELD_WGSL.includes('/*@field')) throw new Error('solid-field: the solids program lost its field hooks');
