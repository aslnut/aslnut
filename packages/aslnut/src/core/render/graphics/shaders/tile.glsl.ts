// Twin of tile.wgsl.ts: the same functions in the same order.
export const TILE_GLSL = /* glsl */ `
uniform highp sampler2D geo;
uniform highp sampler2D ids;
layout(std140) uniform T { vec4 bounds; vec4 k; vec4 px; } tile;
const int GW = 2048;
vec4 pieceAt(int n, int r, int k) {
  int t = n * r + k;
  return texelFetch(geo, ivec2(t % GW, t / GW), 0);
}
int pieceOf(int i) {
  return int(texelFetch(ids, ivec2(i % GW, i / GW), 0).x + 0.5);
}
vec2 tileTexel(vec2 rel) {
  float dl = u.origin.x + rel.x - tile.bounds.x;
  float dm = tile.bounds.z - (u.origin.y + rel.y);
  return vec2(dl / tile.bounds.y, dm / tile.bounds.w) * tile.k.x;
}
vec2 tileRel(vec2 t) {
  vec2 q = t / tile.k.x;
  return vec2(tile.bounds.x + q.x * tile.bounds.y - u.origin.x, tile.bounds.z - q.y * tile.bounds.w - u.origin.y);
}
vec4 tileClip(vec2 t) {
  vec2 q = t / tile.k.x;
  return vec4(q.x * 2.0 - 1.0, tile.k.y * (1.0 - q.y * 2.0), 0.0, 1.0);
}
float tilePx(vec2 t) {
  vec2 q = clamp(t / tile.k.x, vec2(0.0), vec2(1.0));
  return max(mix(mix(tile.px.x, tile.px.y, q.x), mix(tile.px.z, tile.px.w, q.x), q.y), 0.000001);
}
float tileSizePx(float v, vec4 s, vec2 t) {
  float px = v;
  if (s.x > 0.5) {
    px = v * tilePx(t) / max(tile.k.w * frame.size.z, 0.000000001);
  }
  return clamp(px, s.y, s.z);
}
`;
