// Ground marks drawn into a surface tile's overlay (a layer of an rgba8 texture the ground samples): the tile's own
// map space, no depth, no ground to read, so exact on any terrain and drawn once per change, not per frame. What the
// area and line overlays share: the pieces (by number, from this tile's list), a place → texels in the tile, texels
// → clip space. Twin: tile.glsl.ts.
//   tile.bounds: west (lon rad), width (rad), north (Mercator y), height, from the view's centre as the layer blocks are
//   tile.k: (texels across, the clip y sign, the most texels per device pixel anywhere in the tile, world metres per
//   texel)
//   tile.px: texels per device pixel at the tile's corners (north-west, north-east, south-west, south-east), from the
//   camera the overlay is drawn with: a line keeps its width in pixels on the near side of a tile and the far side
//   alike, as tiles show anywhere between a fraction and the whole of their size on screen
export const TILE_WGSL = /* wgsl */ `
@group(1) @binding(1) var geo: texture_2d<f32>;
@group(1) @binding(2) var ids: texture_2d<f32>;
struct T { bounds: vec4f, k: vec4f, px: vec4f }
@group(0) @binding(3) var<uniform> tile: T;
const GW = 2048;
// texel k of piece n, its record r texels long
fn pieceAt(n: i32, r: i32, k: i32) -> vec4f {
  let t = n * r + k;
  return textureLoad(geo, vec2i(t % GW, t / GW), 0);
}
// the i-th piece under this tile
fn pieceOf(i: i32) -> i32 {
  return i32(textureLoad(ids, vec2i(i % GW, i / GW), 0).x + 0.5);
}
// a place (from the layer's origin) → texels in the tile, x east and y south of its north-west corner
fn tileTexel(rel: vec2f) -> vec2f {
  let dl = u.origin.x + rel.x - tile.bounds.x;
  let dm = tile.bounds.z - (u.origin.y + rel.y);
  return vec2f(dl / tile.bounds.y, dm / tile.bounds.w) * tile.k.x;
}
// texels in the tile → a place (from the layer's origin)
fn tileRel(t: vec2f) -> vec2f {
  let q = t / tile.k.x;
  return vec2f(tile.bounds.x + q.x * tile.bounds.y - u.origin.x, tile.bounds.z - q.y * tile.bounds.w - u.origin.y);
}
// texels → clip space (the north row is the texture's first on either graphics)
fn tileClip(t: vec2f) -> vec4f {
  let q = t / tile.k.x;
  return vec4f(q.x * 2.0 - 1.0, tile.k.y * (1.0 - q.y * 2.0), 0.0, 1.0);
}
// texels per device pixel at texel t: the corners' own, between them bilinear (the quadtree keeps a tile small against
// its distance, so the distance varies smoothly over it: within a few % of each pixel's own)
fn tilePx(t: vec2f) -> f32 {
  let q = clamp(t / tile.k.x, vec2f(0.0), vec2f(1.0));
  return max(mix(mix(tile.px.x, tile.px.y, q.x), mix(tile.px.z, tile.px.w, q.x), q.y), 0.000001);
}
// a size in CSS px at texel t (core › render › drawing › size): metres by the tile's metres a texel and texels a pixel there
fn tileSizePx(v: f32, s: vec4f, t: vec2f) -> f32 {
  var px = v;
  if (s.x > 0.5) {
    px = v * tilePx(t) / max(tile.k.w * frame.size.z, 0.000000001);
  }
  return clamp(px, s.y, s.z);
}
`;
