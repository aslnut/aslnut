// The area mark drawn into a ground tile's overlay (see tile.wgsl.ts): its triangles in the tile's own map space,
// three vertices each from the pieces under the tile, the colours, hover, selection, reveal modes and hooks of
// area-drape.wgsl.ts. Hooks: /*@color*/, /*@alpha*/, /*@reveal*/ (fragment; `position` is the ground point at sea
// level). Twin: area-tile.glsl.ts.
import { FEATURE_WGSL } from './feature.wgsl.ts';
import { TILE_WGSL } from './tile.wgsl.ts';

export const AREA_TILE_WGSL = /* wgsl */ `${FEATURE_WGSL}${TILE_WGSL}
struct Params { /*@params*/ }
@group(0) @binding(2) var<uniform> params: Params;
struct O {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) col: vec4f,
  @location(1) @interpolate(flat) idx: f32,
  @location(2) @interpolate(flat) state: vec4f,
  @location(3) @interpolate(flat) value: f32,
  @location(4) rel: vec2f,
  @location(5) @interpolate(flat) box: vec4f,
}
/*@functions*/
fn metresToRel(e: f32, n: f32) -> vec2f {
  return vec2f(e, n) / (RE * max(frame.misc.y, 0.01));
}
fn moved(r: vec2f, box: vec4f, state: vec4f, motion: vec4f) -> vec2f {
  var p = r;
  if (u.reveal.x == 4.0) {
    p = box.xy + (p - box.xy) * state.z;
  }
  return box.xy + (p - box.xy) * motion.w + metresToRel(motion.x, motion.y);
}
@vertex fn vs(@builtin(vertex_index) vid: u32) -> O {
  let n = pieceOf(i32(vid) / 3);
  let c = i32(vid) % 3;
  let t0 = pieceAt(n, 3, 0);
  let t1 = pieceAt(n, 3, 1);
  let idx = t1.z;
  let state = featAt(idx, 2);
  var motion = vec4f(0.0, 0.0, 0.0, 1.0);
  if (u.reveal.y > 0.5) {
    motion = featAt(idx, 5);
  }
  let box = featAt(idx, 4);
  var r = moved(t0.xy, box, state, motion);
  if (c == 1) {
    r = moved(t0.zw, box, state, motion);
  } else if (c == 2) {
    r = moved(t1.xy, box, state, motion);
  }
  var o: O;
  o.pos = tileClip(tileTexel(r));
  o.rel = r;
  o.box = box;
  o.col = colourOf(idx, state);
  o.idx = idx;
  o.state = state;
  o.value = featAt(idx, 3).z;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let position = placeAt(i.rel, 0.0);
  let uv = (i.rel - i.box.xy) / max(i.box.zw, vec2f(0.0000001));
  var color = i.col;
  var alpha = color.a;
  let reveal = i.state.z;
  let mode = u.reveal.x;
  let time = frame.eye.w;
  let value = i.value;
  if (mode == 3.0) {
    alpha = alpha * clamp(reveal * 2.0 - 1.0, 0.0, 1.0);
  } else if (mode == 4.0) {
    alpha = alpha * clamp(reveal * 3.0, 0.0, 1.0);
  } else if (mode == 5.0) {
    let e = -1.15 + 2.3 * reveal;
    alpha = alpha * (1.0 - smoothstep(e - 0.12, e + 0.12, uv.x));
  } else if (mode == 6.0) {
    let e = reveal * 1.6;
    alpha = alpha * (1.0 - smoothstep(e - 0.15, e + 0.05, length(uv)));
  } else if (mode != 14.0) {
    alpha = alpha * reveal;
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
