// Marks draped on the ground, exactly, whatever the terrain does between their points: each piece (a triangle of an
// area, a segment of a line) is drawn as a prism standing from the lowest to the highest ground under its layer (its
// back faces: every pixel once, the camera inside or not), and each pixel asks the depth drawn so far where the
// ground is there, then whether that point lies inside the piece. No heights per vertex, nothing re-read when the
// terrain sharpens, no hills poking through. The pieces come from a data texture by vertex number (no vertex buffers).
// What area-drape and line-drape share. Twin: drape.glsl.ts.
//   ground (L.ground): the lowest and highest ground under the layer, true metres (× exaggeration here); z = 1: flat
//   (the ground level under it, or its relief under a third of a pixel): one face per piece at ground.x, no prism
export const DRAPE_WGSL = /* wgsl */ `
@group(1) @binding(1) var geo: texture_2d<f32>;
@group(2) @binding(0) var sceneDepth: texture_depth_2d;
/*@upperDecl*/
const GW = 2048;
// texel k of piece n, its record r texels long
fn pieceAt(n: i32, r: i32, k: i32) -> vec4f {
  let t = n * r + k;
  return textureLoad(geo, vec2i(t % GW, t / GW), 0);
}
// the place a depth at a pixel stands for (world metres), bias: the depth its program drew it farther by (the
// ground's: GROUND_DEPTH_BIAS); w = 0 where nothing was drawn
fn depthPlace(fc: vec2f, d: f32, bias: f32) -> vec4f {
  if (d >= 0.9999999) {
    return vec4f(0.0);
  }
  let t = vec2f(fc.x / frame.fbsize.x * 2.0 - 1.0, 1.0 - fc.y / frame.fbsize.y * 2.0);
  let ndc = (t - frame.region.zw) / frame.region.xy;
  // (the ground drew itself a little farther in the depth order: frame's groundClip, undone here)
  let w = frame.inv * vec4f(ndc, d - bias, 1.0);
  // a depth the chip could not turn back into a place (w near 0, a garbage or imprecise copy): no ground there, never a
  // NaN carried into the colour (black specks on some phone chips)
  if (!(abs(w.w) > 0.000000000000000000000000000001)) {
    return vec4f(0.0);
  }
  let p = w.xyz / w.w;
  if (!(abs(p.x) + abs(p.y) + abs(p.z) < 1000000000000000000000000000000.0)) {
    return vec4f(0.0);
  }
  return vec4f(p, 1.0);
}
// the ground under a pixel (the depth drawn so far, back to world metres); w = 0 where nothing was drawn
fn groundAt(fc: vec2f) -> vec4f {
  return depthPlace(fc, textureLoad(sceneDepth, vec2i(fc), 0), GROUND_DEPTH_BIAS);
}
/*@upperFn*/
// the vertical plane through a ground edge a–b (A, B: its ends on the ground, UA, UB: 1 km above them), the same
// numbers from either side (its ends in one order): two pieces sharing an edge split its pixels exactly, none twice,
// none missed
fn edgePlane(a: vec2f, b: vec2f, A: vec3f, UA: vec3f, B: vec3f, UB: vec3f) -> vec4f {
  var P0 = A;
  var U0 = UA;
  var Q0 = B;
  if (b.x < a.x || (b.x == a.x && b.y < a.y)) {
    P0 = B;
    U0 = UB;
    Q0 = A;
  }
  let n = cross(Q0 - P0, U0 - P0);
  return vec4f(n, -dot(n, P0));
}
// inside the side of the plane where the value k (its value at the opposite corner) lies; on the plane: one owner
fn inSide(s: f32, k: f32) -> bool {
  return s * k > 0.0 || (s == 0.0 && k > 0.0);
}
// the height of a level of the prism: 0 its foot, 1 its top; g: the lowest and highest ground under the piece (true m,
// margins included): a prism stands only as tall as the ground under its own piece (little fill on a phone's chip)
fn prismAt(level: f32, g: vec2f) -> f32 {
  /*@upperPrism*/
  if (u.ground.z > 0.5) {
    return u.ground.x * u.origin.z + u.origin.w;
  }
  // w = 1: the pieces' own ranges are being measured again (the ground changed): the layer's, never too short; a
  // piece's own never wider than the layer's (a range read where only coarse tiles were in spans a whole region)
  var r = clamp(g, vec2f(u.ground.x), vec2f(u.ground.y));
  if (u.ground.w > 0.5) {
    r = u.ground.xy;
  }
  return mix(r.x, r.y, level) * u.origin.z + u.origin.w;
}
`;

// A draped mark's part over the twin's solids (core › geometry › marks › drape): the same program drawn after the things
// standing on the ground, painting only what was drawn over the terrain (its depth kept before them: groundDepth); a
// mark on the ground ('ground') only what lies within u.slots2.z metres of the terrain (roads, paths, kerbs), one over
// everything ('over', u.slots2.z = 0) roofs, walls and tree crowns too. Its prisms always stand (no flat route), from
// just under the ground to u.slots2.w metres over the top of the range. Put in by drape.ts's upper variant. Twin:
// UPPER_GLSL (drape.glsl.ts).
export const UPPER_WGSL = {
  decl: /* wgsl */ `@group(2) @binding(1) var groundDepth: texture_2d<f32>;`,
  fn: /* wgsl */ `// what the part paints at this pixel: something drawn over the terrain (and, on the ground, low over it)
fn upperKeeps(fc: vec2f, g: vec4f) -> bool {
  let kept = textureLoad(groundDepth, vec2i(fc), 0).x;
  let here = textureLoad(sceneDepth, vec2i(fc), 0);
  if (!(here < kept)) {
    return false;
  }
  // (what was drawn over the terrain was drawn without the ground's bias: its height over the terrain without it)
  if (u.slots2.z > 0.0) {
    let under = depthPlace(fc, kept, GROUND_DEPTH_BIAS);
    let top = depthPlace(fc, here, 0.0);
    if (under.w < 0.5 || top.y - under.y > u.slots2.z) {
      return false;
    }
  }
  return true;
}`,
  prism: /* wgsl */ `var ru = clamp(g, vec2f(u.ground.x), vec2f(u.ground.y));
  if (u.ground.w > 0.5 || u.ground.z > 0.5) {
    ru = u.ground.xy;
  }
  return mix(ru.x - 5.0, max(ru.x, ru.y) + u.slots2.w, level) * u.origin.z + u.origin.w;`,
  fs: /* wgsl */ `if (!upperKeeps(i.pos.xy, g)) {
    discard;
  }`,
};
