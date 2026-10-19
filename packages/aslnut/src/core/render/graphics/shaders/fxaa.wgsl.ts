// The picture's anti-aliasing (FXAA, the light variant): a full-screen triangle reading the frame drawn off screen;
// where the luminance crosses an edge, blended along it. Drawn when the picture is made smaller than the screen (the
// governor's resolution step, dynamic resolution) or when asked. Twin: fxaa.glsl.ts.
export const FXAA_WGSL = /* wgsl */ `
@group(0) @binding(0) var pic: texture_2d<f32>;
@group(0) @binding(1) var smp: sampler;
struct VOut { @builtin(position) pos: vec4f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> VOut {
  var o: VOut;
  let x = f32((i << 1u) & 2u) * 2.0 - 1.0;
  let y = f32(i & 2u) * 2.0 - 1.0;
  o.pos = vec4f(x, y, 0.0, 1.0);
  return o;
}
fn luma(c: vec3f) -> f32 {
  return dot(c, vec3f(0.299, 0.587, 0.114));
}
fn at(uv: vec2f) -> vec3f {
  return textureSampleLevel(pic, smp, uv, 0.0).rgb;
}
fn fxaa(uv: vec2f, px: vec2f) -> vec3f {
  let nw = luma(at(uv + vec2f(-1.0, -1.0) * px));
  let ne = luma(at(uv + vec2f(1.0, -1.0) * px));
  let sw = luma(at(uv + vec2f(-1.0, 1.0) * px));
  let se = luma(at(uv + vec2f(1.0, 1.0) * px));
  let m = luma(at(uv));
  let lo = min(m, min(min(nw, ne), min(sw, se)));
  let hi = max(m, max(max(nw, ne), max(sw, se)));
  var dir = vec2f(-((nw + ne) - (sw + se)), (nw + sw) - (ne + se));
  let reduce = max((nw + ne + sw + se) * 0.03125, 0.0078125);
  let rcp = 1.0 / (min(abs(dir.x), abs(dir.y)) + reduce);
  dir = clamp(dir * rcp, vec2f(-8.0), vec2f(8.0)) * px;
  let a = 0.5 * (at(uv + dir * (1.0 / 3.0 - 0.5)) + at(uv + dir * (2.0 / 3.0 - 0.5)));
  let b = a * 0.5 + 0.25 * (at(uv - dir * 0.5) + at(uv + dir * 0.5));
  let lb = luma(b);
  if (lb < lo || lb > hi) {
    return a;
  }
  return b;
}
@fragment fn fs(v: VOut) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(pic));
  return vec4f(fxaa(v.pos.xy / size, 1.0 / size), 1.0);
}
`;
