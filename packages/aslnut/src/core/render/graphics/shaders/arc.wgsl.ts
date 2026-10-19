// The arc mark: lines through the air, one instance per arc, its shape made here. Each arc is a small record (its ends,
// their heights, the rise, its feature, its segments, its angular length); the vertices come from one strip shared by
// every arc, two per point along it (the vertex number: point × 2 + side). A point at t along: straight between the
// ends in Mercator, bent onto the great circle by how long the arc is (a long one; a short one is straight to within
// centimetres), lifted by its ends' heights and the rise (4 t (1 − t)). Its width in device pixels, mitred at the
// joins from the points before and after (t ± 1 / n), as the line mark. Points past the arc's own count fold onto its
// last one (nothing drawn). The fragment stage is the line mark's (dashes, the reveal modes, the hooks).
// Instance: ab (end a, end b: rel. to the origin, lon rad and Mercator y) · hf (end a's height, end b's height (the
// ground's and their own, true m), the rise m, the feature index) · nw (segments, negative: along runs from b; the
// angle between the ends, rad). The mark's own: a (width px, from the feature 0 / 1, dash on px, dash off px) · b (glow,
// dash flow px/s, depth bias px, 0) · c (unused). Hooks: /*@color*/, /*@alpha*/, /*@reveal*/ (fragment). Twin: arc.glsl.ts.
import { FEATURE_WGSL } from './feature.wgsl.ts';

export const ARC_WGSL = /* wgsl */ `${FEATURE_WGSL}
struct Params { /*@params*/ }
@group(0) @binding(2) var<uniform> params: Params;
struct I { @location(0) ab: vec4f, @location(1) hf: vec4f, @location(2) nw: vec2f, @builtin(vertex_index) vid: u32 }
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
// a place on the unit sphere (longitude from the view centre, latitude) and back (longitude, Mercator y)
fn unitOf(p: vec2f) -> vec3f {
  let lat = 2.0 * atan(exp(clamp(frame.geo.x + p.y, -3.14, 3.14))) - PI * 0.5;
  let c = cos(lat);
  return vec3f(c * cos(p.x), c * sin(p.x), sin(lat));
}
fn mercOf(v: vec3f) -> vec2f {
  let lat = clamp(atan2(v.z, length(v.xy)), -1.4844, 1.4844);
  return vec2f(atan2(v.y, v.x), log(tan(PI * 0.25 + lat * 0.5)) - frame.geo.x);
}
// the arc's place at t (rel. to the layer's origin): straight in Mercator, plus the great circle's departure from
// straight where the arc is long (from 3 km; the departure is taken between places made the same way, so the ends stay
// exact and float32's rounding cancels)
fn arcAt(ab: vec4f, w: f32, t: f32) -> vec2f {
  var p = mix(ab.xy, ab.zw, t);
  let k = smoothstep(0.0005, 0.002, w);
  if (k > 0.0) {
    let va = unitOf(u.origin.xy + ab.xy);
    let vb = unitOf(u.origin.xy + ab.zw);
    let v = (sin((1.0 - t) * w) * va + sin(t * w) * vb) / sin(w);
    let ga = mercOf(va);
    var gb = mercOf(vb);
    gb.x = gb.x - 2.0 * PI * round((gb.x - ga.x) / (2.0 * PI));
    var d = mercOf(v) - mix(ga, gb, t);
    d.x = d.x - 2.0 * PI * round(d.x / (2.0 * PI));
    p = p + d * k;
  }
  return p;
}
// its height at t (m): its ends' (× the exaggeration), the rise, the lift
fn arcH(hf: vec4f, t: f32, lift: f32) -> f32 {
  return mix(hf.x, hf.y, t) * u.origin.z + hf.z * 4.0 * t * (1.0 - t) + lift;
}
// a neighbour's place on the screen (only its direction is used: not moved towards the eye)
fn arcClip(ab: vec4f, hf: vec4f, w: f32, t: f32, lift: f32) -> vec4f {
  return frame.viewProj * vec4f(placeAt(arcAt(ab, w, t), arcH(hf, t, lift)), 1.0);
}
@vertex fn vs(i: I) -> O {
  let n = max(abs(i.nw.x), 1.0);
  let w = i.nw.y;
  let idx = i.hf.w;
  let at = f32(i.vid / 2u);
  let k = min(at, n);
  let side = select(-1.0, 1.0, (i.vid & 1u) == 1u);
  let t = k / n;
  let state = featAt(idx, 2);
  var motion = vec4f(0.0, 0.0, 0.0, 1.0);
  if (u.reveal.y > 0.5) {
    motion = featAt(idx, 5);
  }
  let lift = u.origin.w + raiseOf(state) + motion.z;
  let P = placeAt(arcAt(i.ab, w, t), arcH(i.hf, t, lift));
  let c = frame.viewProj * vec4f(liftToEye(P, u.b.z), 1.0);
  var o: O;
  if (c.w <= 0.0) {
    o.pos = vec4f(0.0, 0.0, 2.0, 1.0);
    return o;
  }
  // a point past the arc's own: on its last point's middle, between that point's two vertices (nothing drawn)
  if (at > n) {
    o.pos = clipOut(c);
    return o;
  }
  let s = screenOf(c);
  // the join: the segments before and after this point (t ± 1 / n), mitred
  var nA = vec2f(0.0, 0.0);
  var nB = vec2f(0.0, 0.0);
  if (k > 0.0) {
    let c0 = arcClip(i.ab, i.hf, w, (k - 1.0) / n, lift);
    if (c0.w > 0.0) {
      nA = perp(dirOf(screenOf(c0), s));
    }
  }
  if (k < n) {
    let c1 = arcClip(i.ab, i.hf, w, (k + 1.0) / n, lift);
    if (c1.w > 0.0) {
      nB = perp(dirOf(s, screenOf(c1)));
    }
  }
  var m = nA + nB;
  var ml = 1.0;
  if (dot(nA, nA) > 0.5 && dot(nB, nB) > 0.5) {
    m = normalize(m);
    ml = 1.0 / max(dot(m, nA), 0.5);
  } else if (dot(m, m) < 0.5) {
    m = vec2f(0.0, 1.0);
  }
  let nums = featAt(idx, 3);
  var wd = u.a.x;
  if (u.a.y > 0.5) {
    wd = wd * nums.x;
  }
  wd = sizePx(wd, u.size, P);
  wd = wd + u.hover2.y * state.x + u.sel2.y * state.y;
  wd = wd * frame.size.z * motion.w;
  let halfw = wd * 0.5 + 1.0;
  let off = m * side * halfw * ml;
  o.pos = clipOut(vec4f(c.xy + off / (frame.size.xy * 0.5) * c.w, c.z, c.w));
  o.col = colourOf(idx, state);
  o.across = side * halfw * ml;
  o.halfw = halfw;
  o.along = select(t, 1.0 - t, i.nw.x < 0.0);
  o.alongPx = o.along * w * RE / max(mppAt(P) / max(frame.size.z, 0.001), 0.000001);
  o.idx = idx;
  o.state = state;
  o.world = P;
  o.value = nums.z;
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
