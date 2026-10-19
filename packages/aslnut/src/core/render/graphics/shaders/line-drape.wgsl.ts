// The line mark draped on the ground (lines, area outlines, trails; see drape.wgsl.ts): one prism per segment, from a
// data texture of five texels per segment (a, b, the point before, the point after, x: feature, line length, the ground's range under it), as
// wide as the line is in pixels where it lies; each pixel finds the ground under it, its distance across the line
// (in pixels at that distance: the width holds on any slope) and how far along, then shades as line.wgsl.ts does:
// anti-aliased edges, round caps, dashes, trace / pulse / fade reveals, a trail's time window. Hooks: /*@color*/,
// /*@alpha*/, /*@reveal*/ (fragment). Twin: line-drape.glsl.ts.
import { FEATURE_WGSL } from './feature.wgsl.ts';
import { DRAPE_WGSL } from './drape.wgsl.ts';

export const LINE_DRAPE_WGSL = /* wgsl */ `${FEATURE_WGSL}${DRAPE_WGSL}
struct Params { /*@params*/ }
@group(0) @binding(2) var<uniform> params: Params;
struct O {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) col: vec4f,
  @location(1) @interpolate(flat) a0: vec3f,
  @location(2) @interpolate(flat) dir: vec4f,
  @location(3) @interpolate(flat) side: vec3f,
  @location(4) @interpolate(flat) ends: vec4f,
  @location(5) @interpolate(flat) halfw: f32,
  @location(6) @interpolate(flat) len: f32,
  @location(7) @interpolate(flat) idx: f32,
  @location(8) @interpolate(flat) state: vec4f,
  @location(9) @interpolate(flat) value: f32,
  @location(10) world: vec3f,
}
/*@functions*/
// a box's 36 corners (12 triangles, outward faces counter-clockwise): end + 2 · side + 4 · level
fn boxCorner(k: i32) -> i32 {
  var t = array<i32, 36>(0, 2, 1, 1, 2, 3, 4, 5, 6, 5, 7, 6, 0, 1, 5, 0, 5, 4, 2, 6, 7, 2, 7, 3, 0, 4, 6, 0, 6, 2, 1, 3, 7, 1, 7, 5);
  return t[k];
}
// flat: the box's foot alone, a ribbon on the ground
fn footCorner(k: i32) -> i32 {
  var t = array<i32, 6>(0, 2, 1, 1, 2, 3);
  return t[k];
}
@vertex fn vs(@builtin(vertex_index) vid: u32) -> O {
  let level0 = u.ground.z > 0.5 /*@flat*/;
  var per = 36;
  if (level0) {
    per = 6;
  }
  let n = i32(vid) / per;
  var c = 0;
  if (level0) {
    c = footCorner(i32(vid) % 6);
  } else {
    c = boxCorner(i32(vid) % 36);
  }
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
  w = sizePx(w, u.size, placeUp(select(a.xy, b.xy, (c % 2) == 1)).p);
  w = w + u.hover2.y * state.x + u.sel2.y * state.y;
  w = w * frame.size.z * motion.w;
  let halfw = w * 0.5 + 1.0;
  let lo = prismAt(0.0, x.zw);
  let hi = prismAt(1.0, x.zw);
  let ua = placeUp(a.xy);
  let ub = placeUp(b.xy);
  let A0 = ua.p + lo * ua.d;
  let B0 = ub.p + lo * ub.d;
  let up = normalize(ua.d);
  let ab = B0 - A0;
  let L = max(length(ab), 0.001);
  let d = ab / L;
  let side = normalize(cross(up, d));
  let end = f32(c % 2);
  let s = f32((c / 2) % 2) * 2.0 - 1.0;
  let level = f32(c / 4);
  var at = ua;
  if (end > 0.5) {
    at = ub;
  }
  let ext = halfw * max(mppAt(at.p + lo * at.d), mppAt(at.p + hi * at.d)) * 1.5 + 0.5;
  let corner = at.p + prismAt(level, x.zw) * at.d + side * s * ext + d * (end * 2.0 - 1.0) * ext;
  var o: O;
  o.pos = clipOut(frame.viewProj * vec4f(corner, 1.0));
  o.world = corner;
  var col = vec4f(mix(u.c.rgb, u.hover.rgb, state.x), mix(u.c.a, 1.0, max(state.x, state.y)));
  if (u.b.w < 0.5) {
    col = colourOf(idx, state);
  }
  o.col = col;
  o.a0 = A0;
  o.dir = vec4f(d, L);
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
  let g = groundAt(i.pos.xy);
  if (g.w < 0.5) {
    discard;
  }
  /*@upper*/
  // level ground: the ribbon lies on the ground itself: its own place, exact (the depth read back only says the ground
  // is there)
  var position = g.xyz;
  if (u.ground.z > 0.5 /*@flat*/) {
    position = i.world;
  }
  let rp = position - i.a0;
  let t = dot(rp, i.dir.xyz) / i.dir.w;
  let s = dot(rp, i.side);
  let mpp = mppAt(position);
  var across = s / mpp;
  // round caps at the line's ends; a joint belongs to the segment after it
  if (t < 0.0) {
    if (i.ends.z > 0.5) {
      discard;
    }
    across = length(vec2f(s, t * i.dir.w)) / mpp;
  } else if (t >= 1.0) {
    if (i.ends.w > 0.5) {
      discard;
    }
    across = length(vec2f(s, (t - 1.0) * i.dir.w)) / mpp;
  }
  if (abs(across) > i.halfw) {
    discard;
  }
  var color = i.col;
  var alpha = color.a * clamp(i.halfw - abs(across), 0.0, 1.0) * clamp((i.halfw - 1.0) * 2.0, 0.0, 1.0);
  let along = mix(i.ends.x, i.ends.y, clamp(t, 0.0, 1.0));
  let alongPx = along * i.len / max(mpp / max(frame.size.z, 0.001), 0.000001);
  let time = frame.eye.w;
  let value = i.value;
  let reveal = i.state.z;
  let mode = u.reveal.x;
  // dashes, flowing along at u.b.y px a second (0: still)
  let dashP = max(u.a.z + u.a.w, 0.0001);
  let dashAt = alongPx - time * u.b.y;
  if (u.a.z > 0.0 && (dashAt - floor(dashAt / dashP) * dashP) > u.a.z) {
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
    let k = fract(along - time * 0.35);
    color = vec4f(color.rgb + vec3f(u.b.x * exp(-k * 12.0)), color.a);
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
  if (frame.pick.x > 0.5) {
    return pickOut(u.hover2.w, i.idx);
  }
  return vec4f(themed(color.rgb, max(i.state.x, i.state.y)) * mix(1.0, alpha, u.hover2.z), alpha);
}
`;
