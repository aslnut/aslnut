// The line mark drawn into a ground tile's overlay (lines, area outlines, trails; see tile.wgsl.ts): a quad per
// segment in the tile's own map space, as wide as the line is in device pixels wherever in the tile it shows (tilePx:
// texels a pixel there), shaded as line-drape.wgsl.ts: anti-aliased edges, round caps, dashes, trace / pulse / fade
// reveals, a trail's time window. Hooks: /*@color*/, /*@alpha*/, /*@reveal*/ (fragment). Twin: line-tile.glsl.ts.
import { FEATURE_WGSL } from './feature.wgsl.ts';
import { TILE_WGSL } from './tile.wgsl.ts';

export const LINE_TILE_WGSL = /* wgsl */ `${FEATURE_WGSL}${TILE_WGSL}
struct Params { /*@params*/ }
@group(0) @binding(2) var<uniform> params: Params;
struct O {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) col: vec4f,
  @location(1) @interpolate(flat) a0: vec2f,
  @location(2) @interpolate(flat) dir: vec3f,
  @location(3) @interpolate(flat) side: vec2f,
  @location(4) @interpolate(flat) ends: vec4f,
  @location(5) @interpolate(flat) halfw: f32,
  @location(6) @interpolate(flat) len: f32,
  @location(7) @interpolate(flat) idx: f32,
  @location(8) @interpolate(flat) state: vec4f,
  @location(9) @interpolate(flat) value: f32,
  @location(10) p: vec2f,
}
/*@functions*/
// the quad's 6 corners: end + 2 · side
fn quadCorner(k: i32) -> i32 {
  var t = array<i32, 6>(0, 2, 1, 1, 2, 3);
  return t[k];
}
@vertex fn vs(@builtin(vertex_index) vid: u32) -> O {
  let n = pieceOf(i32(vid) / 6);
  let c = quadCorner(i32(vid) % 6);
  let a = pieceAt(n, 5, 0);
  let b = pieceAt(n, 5, 1);
  let before = pieceAt(n, 5, 2);
  let after = pieceAt(n, 5, 3);
  let x = pieceAt(n, 5, 4);
  let idx = x.x;
  let state = featAt(idx, 2);
  var motion = vec4f(0.0, 0.0, 0.0, 1.0);
  if (u.reveal.y > 0.5) {
    motion = featAt(idx, 5);
  }
  var w = u.a.x;
  if (u.a.y > 0.5) {
    w = w * featAt(idx, 3).x;
  }
  w = tileSizePx(w, u.size, (tileTexel(a.xy) + tileTexel(b.xy)) * 0.5);
  w = w + u.hover2.y * state.x + u.sel2.y * state.y;
  w = w * frame.size.z * motion.w;
  let halfw = w * 0.5 + 1.0;
  let A = tileTexel(a.xy);
  let B = tileTexel(b.xy);
  let ab = B - A;
  let L = max(length(ab), 0.0001);
  let d = ab / L;
  let side = vec2f(-d.y, d.x);
  let end = f32(c % 2);
  let s = f32((c / 2) % 2) * 2.0 - 1.0;
  // (wide enough wherever in the tile the segment lies: the most texels a pixel anywhere in it)
  let ext = halfw * tile.k.z + 1.0;
  var at = A;
  if (end > 0.5) {
    at = B;
  }
  let corner = at + side * s * ext + d * (end * 2.0 - 1.0) * ext;
  var o: O;
  o.pos = tileClip(corner);
  o.p = corner;
  var col = vec4f(mix(u.c.rgb, u.hover.rgb, state.x), mix(u.c.a, 1.0, max(state.x, state.y)));
  if (u.b.w < 0.5) {
    col = colourOf(idx, state);
  }
  o.col = col;
  o.a0 = A;
  o.dir = vec3f(d, L);
  o.side = side;
  o.ends = vec4f(a.w, b.w, before.w, after.w);
  o.halfw = halfw;
  o.len = x.y;
  o.idx = idx;
  o.state = state;
  o.value = featAt(idx, 3).z;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let position = placeAt(tileRel(i.p), 0.0);
  let rp = i.p - i.a0;
  let t = dot(rp, i.dir.xy) / i.dir.z;
  let s = dot(rp, i.side);
  let k = tilePx(i.p);
  // its caps at the line's ends, its joints (acrossAt)
  let across = acrossAt(t, s, i.dir.z, k, i.ends);
  if (abs(across) > i.halfw) {
    discard;
  }
  var color = i.col;
  // the edge: a device pixel's ramp as on the prisms, less the texel the ground's sampling of the overlay softens it by
  // (never under a texel: finer aliases), centred where the prisms' is (the same amount of line)
  let ramp = max(1.0 - 1.0 / k, min(1.0, 1.0 / k));
  var alpha = color.a * clamp((i.halfw - 0.5 + ramp * 0.5 - abs(across)) / ramp, 0.0, 1.0) * clamp((i.halfw - 1.0) * 2.0, 0.0, 1.0);
  let along = mix(i.ends.x, i.ends.y, clamp(t, 0.0, 1.0));
  let mpp = tile.k.w * k;
  let alongPx = along * i.len / max(mpp / max(frame.size.z, 0.001), 0.000001);
  let time = frame.eye.w;
  let value = i.value;
  let reveal = i.state.z;
  let mode = u.reveal.x;
  // dashes (the feature's own pattern and offset), flowing along at u.b.y px a second (0: still)
  if (!dashOn(alongPx + featAt(i.idx, 3).w - time * u.b.y, featAt(i.idx, 6))) {
    discard;
  }
  if (mode == 1.0 || mode == 3.0) {
    var p = reveal;
    if (mode == 3.0) {
      p = clamp(reveal * 2.0, 0.0, 1.0);
    }
    let soft = max(u.reveal.z, 0.001);
    alpha = alpha * (1.0 - smoothstep(p - soft, p, along)) * step(0.0001, p);
    let head = u.reveal.w * exp(-abs(along - p) / soft * 2.0) * step(along, p + soft) * (1.0 - step(1.0, p));
    color = vec4f(color.rgb + vec3f(head), color.a);
  } else if (mode == 2.0) {
    let q = fract(along - time * 0.35);
    color = vec4f(color.rgb + vec3f(u.b.x * exp(-q * 12.0)), color.a);
    alpha = alpha * reveal;
  } else if (mode != 14.0) {
    alpha = alpha * reveal;
  }
  // a trail (c: now, window, on, head; along = time): drawn up to now, fading over the window, a glowing head
  if (u.b.w < 0.5 && u.c.z > 0.5) {
    let age = u.c.x - along;
    alpha = alpha * step(0.0, age) * (1.0 - smoothstep(u.c.y * 0.35, u.c.y, age));
    color = vec4f(color.rgb + vec3f(u.c.w * exp(-age / max(u.c.y * 0.06, 0.000001))), color.a);
  }
  /*@color*/
  alpha = alpha * u.look.x * i.state.w;
  /*@alpha*/
  /*@reveal*/
  if (alpha <= 0.002) {
    discard;
  }
  return vec4f(themed(color.rgb, max(i.state.x, i.state.y)) * mix(1.0, alpha, u.hover2.z), alpha);
}
`;
