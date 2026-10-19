// The line mark (lines, area outlines, arcs, trails): four vertices per segment (two triangles), widened on screen in
// device pixels with mitred joins (from the segments before and after), anti-aliased edges, dashes, and the reveal
// modes trace (a soft front with a glowing head), trace-fill (outlines: the first half), pulse and fade.
// Vertex: a, b (place rel. to the origin: lon rad, Mercator y, height m, fraction along) · p0, p3 (the points before
// a and after b; w: 1 when there is one) · x (feature index, length of its line m, which end 0 / 1, which side -1 / 1).
// Not instanced: software renderers (and the WebGL2 fallback on blocklisted chips) draw many instances slowly.
// The mark's own: a (width px, from the feature 0 / 1, dash on px, dash off px) · b (glow, dash flow px/s, depth bias px,
// outline mode) · c (outline colour; a trail's now, window, on, head). Hooks: /*@color*/, /*@alpha*/, /*@reveal*/ (fragment). Twin: line.glsl.ts.
import { FEATURE_WGSL } from './feature.wgsl.ts';

export const LINE_WGSL = /* wgsl */ `${FEATURE_WGSL}
struct Params { /*@params*/ }
@group(0) @binding(2) var<uniform> params: Params;
struct I { @location(0) a: vec4f, @location(1) b: vec4f, @location(2) p0: vec4f, @location(3) p3: vec4f, @location(4) x: vec4f }
struct O {
  @builtin(position) pos: vec4f,
  @location(0) col: vec4f,
  @location(1) across: f32,
  @location(2) halfw: f32,
  @location(3) along: f32,
  @location(4) alongPx: f32,
  @location(5) @interpolate(flat) idx: f32,
  @location(6) @interpolate(flat) state: vec4f,
  @location(7) world: vec3f,
  @location(8) @interpolate(flat) value: f32,
}
/*@functions*/
fn screenOf(c: vec4f) -> vec2f {
  return c.xy / c.w * frame.size.xy * 0.5;
}
fn perp(d: vec2f) -> vec2f {
  return vec2f(-d.y, d.x);
}
fn dirOf(a: vec2f, b: vec2f) -> vec2f {
  let d = b - a;
  let l = length(d);
  if (l < 0.0001) {
    return vec2f(1.0, 0.0);
  }
  return d / l;
}
fn clipAt(rel: vec2f, h: f32) -> vec4f {
  return frame.viewProj * vec4f(liftToEye(placeAt(rel, h), u.b.z), 1.0);
}
@vertex fn vs(i: I) -> O {
  let end = i.x.z;
  let side = i.x.w;
  let idx = i.x.x;
  let state = featAt(idx, 2);
  var motion = vec4f(0.0, 0.0, 0.0, 1.0);
  if (u.reveal.y > 0.5) {
    motion = featAt(idx, 5);
  }
  let lift = u.origin.w + raiseOf(state) + motion.z;
  let ex = u.origin.z;
  let PA = placeAt(i.a.xy, i.a.z * ex + lift);
  let PB = placeAt(i.b.xy, i.b.z * ex + lift);
  let cA = frame.viewProj * vec4f(liftToEye(PA, u.b.z), 1.0);
  let cB = frame.viewProj * vec4f(liftToEye(PB, u.b.z), 1.0);
  var o: O;
  if (cA.w <= 0.0 || cB.w <= 0.0) {
    o.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    return o;
  }
  let sA = screenOf(cA);
  let sB = screenOf(cB);
  let n = perp(dirOf(sA, sB));
  var m = n;
  // the join: only the neighbour on this vertex's end is needed
  if (end < 0.5 && i.p0.w > 0.5) {
    let c0 = clipAt(i.p0.xy, i.p0.z * ex + lift);
    if (c0.w > 0.0) {
      m = normalize(perp(dirOf(screenOf(c0), sA)) + n);
    }
  }
  if (end > 0.5 && i.p3.w > 0.5) {
    let c3 = clipAt(i.p3.xy, i.p3.z * ex + lift);
    if (c3.w > 0.0) {
      m = normalize(n + perp(dirOf(sB, screenOf(c3))));
    }
  }
  let ml = 1.0 / max(dot(m, n), 0.5);
  var w = u.a.x;
  if (u.a.y > 0.5) {
    w = w * featAt(idx, 3).x;
  }
  // CSS px, or metres where this end is seen, within the layer's range (core › render › drawing › size)
  w = sizePx(w, u.size, select(PA, PB, end > 0.5));
  w = w + u.hover2.y * state.x + u.sel2.y * state.y;
  w = w * frame.size.z * motion.w;
  let halfw = w * 0.5 + 1.0;
  let c = select(cA, cB, end > 0.5);
  let off = m * side * halfw * ml;
  o.pos = clipOut(vec4f(c.xy + off / (frame.size.xy * 0.5) * c.w, c.z, c.w));
  var col = vec4f(mix(u.c.rgb, u.hover.rgb, state.x), mix(u.c.a, 1.0, max(state.x, state.y)));
  if (u.b.w < 0.5) {
    col = colourOf(idx, state);
  }
  let P = select(PA, PB, end > 0.5);
  o.col = col;
  o.across = side * halfw * ml;
  o.halfw = halfw;
  o.along = mix(i.a.w, i.b.w, end);
  o.alongPx = o.along * i.x.y / max(mppAt(P) / max(frame.size.z, 0.001), 0.000001);
  o.idx = idx;
  o.state = state;
  o.world = P;
  o.value = featAt(idx, 3).z;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  var color = i.col;
  var alpha = color.a * clamp(i.halfw - abs(i.across), 0.0, 1.0) * clamp((i.halfw - 1.0) * 2.0, 0.0, 1.0);
  let along = i.along;
  let time = frame.eye.w;
  let value = i.value;
  let position = i.world;
  let reveal = i.state.z;
  let mode = u.reveal.x;
  // dashes, flowing along at u.b.y px a second (0: still)
  let dashP = max(u.a.z + u.a.w, 0.0001);
  let dashAt = i.alongPx - time * u.b.y;
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
