// The area mark draped on the ground (see drape.wgsl.ts): one prism per triangle, from a data texture of three texels
// per triangle (corners a, b · corner c, feature index · the ground's range under it); each pixel finds the ground under it and its place in the
// triangle (barycentric, from the three edge planes), so the colours, hover, selection, reveal modes and hooks are
// those of area.wgsl.ts. Hooks: /*@color*/, /*@alpha*/, /*@reveal*/ (fragment; `position` is the ground point).
// Twin: area-drape.glsl.ts.
import { FEATURE_WGSL } from './feature.wgsl.ts';
import { DRAPE_WGSL } from './drape.wgsl.ts';

export const AREA_DRAPE_WGSL = /* wgsl */ `${FEATURE_WGSL}${DRAPE_WGSL}
struct Params { /*@params*/ }
@group(0) @binding(2) var<uniform> params: Params;
struct O {
  @builtin(position) pos: vec4f,
  @location(0) @interpolate(flat) col: vec4f,
  @location(1) @interpolate(flat) idx: f32,
  @location(2) @interpolate(flat) state: vec4f,
  @location(3) @interpolate(flat) value: f32,
  @location(4) @interpolate(flat) pa: vec4f,
  @location(5) @interpolate(flat) pb: vec4f,
  @location(6) @interpolate(flat) pc: vec4f,
  @location(7) @interpolate(flat) ks: vec3f,
  @location(8) @interpolate(flat) rab: vec4f,
  @location(9) @interpolate(flat) rc: vec2f,
  @location(10) @interpolate(flat) box: vec4f,
  @location(11) world: vec3f,
}
/*@functions*/
fn metresToRel(e: f32, n: f32) -> vec2f {
  return vec2f(e, n) / (RE * max(frame.misc.y, 0.01));
}
// the prism's 24 corners (8 triangles, outward faces counter-clockwise): corner v + 3 · level
fn prismCorner(k: i32) -> i32 {
  var t = array<i32, 24>(3, 4, 5, 0, 2, 1, 0, 1, 4, 0, 4, 3, 1, 2, 5, 1, 5, 4, 2, 0, 3, 2, 3, 5);
  return t[k];
}
// flat: the prism's foot alone (its outward face looks down: drawn from above as the prism's back faces are)
fn footCorner(k: i32) -> i32 {
  var t = array<i32, 3>(0, 2, 1);
  return t[k];
}
fn moved(r: vec2f, box: vec4f, state: vec4f, motion: vec4f) -> vec2f {
  var p = r;
  if (u.reveal.x == 4.0) {
    p = box.xy + (p - box.xy) * state.z;
  }
  return box.xy + (p - box.xy) * motion.w + metresToRel(motion.x, motion.y);
}
@vertex fn vs(@builtin(vertex_index) vid: u32) -> O {
  let level0 = u.ground.z > 0.5 /*@flat*/;
  var per = 24;
  if (level0) {
    per = 3;
  }
  let n = i32(vid) / per;
  var c = 0;
  if (level0) {
    c = footCorner(i32(vid) % 3);
  } else {
    c = prismCorner(i32(vid) % 24);
  }
  let t0 = pieceAt(n, 3, 0);
  let t1 = pieceAt(n, 3, 1);
  let t2 = pieceAt(n, 3, 2);
  let idx = t1.z;
  let state = featAt(idx, 2);
  var motion = vec4f(0.0, 0.0, 0.0, 1.0);
  if (u.reveal.y > 0.5) {
    motion = featAt(idx, 5);
  }
  let box = featAt(idx, 4);
  let ra = moved(t0.xy, box, state, motion);
  let rb = moved(t0.zw, box, state, motion);
  let rc = moved(t1.xy, box, state, motion);
  // each corner placed once (the places at any height follow from it)
  let ua = placeUp(ra);
  let ub = placeUp(rb);
  let uc = placeUp(rc);
  let v = c % 3;
  var up = ua;
  if (v == 1) {
    up = ub;
  } else if (v == 2) {
    up = uc;
  }
  var o: O;
  let corner = up.p + prismAt(f32(c / 3), t2.xy) * up.d;
  o.pos = clipOut(frame.viewProj * vec4f(corner, 1.0));
  o.world = corner;
  // the planes of the edges opposite a, b, c, and each one's value at its opposite corner
  let A = ua.p;
  let B = ub.p;
  let C = uc.p;
  let UA = ua.p + 1000.0 * ua.d;
  let UB = ub.p + 1000.0 * ub.d;
  let UC = uc.p + 1000.0 * uc.d;
  o.pa = edgePlane(rb, rc, B, UB, C, UC);
  o.pb = edgePlane(rc, ra, C, UC, A, UA);
  o.pc = edgePlane(ra, rb, A, UA, B, UB);
  o.ks = vec3f(dot(o.pa.xyz, A) + o.pa.w, dot(o.pb.xyz, B) + o.pb.w, dot(o.pc.xyz, C) + o.pc.w);
  o.rab = vec4f(ra, rb);
  o.rc = rc;
  o.box = box;
  o.col = colourOf(idx, state);
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
  // flat (level ground): the face lies on the ground itself: its own place, exact (the depth read back only says the
  // ground is there), and the rasterizer's coverage is the piece's: no edge tests (their rounding left specks between
  // pieces at regional zooms)
  let level = u.ground.z > 0.5 /*@flat*/;
  var position = g.xyz;
  if (level) {
    position = i.world;
  }
  let sa = dot(i.pa.xyz, position) + i.pa.w;
  let sb = dot(i.pb.xyz, position) + i.pb.w;
  let sc = dot(i.pc.xyz, position) + i.pc.w;
  if (!level && (!inSide(sa, i.ks.x) || !inSide(sb, i.ks.y) || !inSide(sc, i.ks.z))) {
    discard;
  }
  let rel = i.rab.xy * (sa / i.ks.x) + i.rab.zw * (sb / i.ks.y) + i.rc * (sc / i.ks.z);
  let uv = (rel - i.box.xy) / max(i.box.zw, vec2f(0.0000001));
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
  if (frame.pick.x > 0.5) {
    return pickOut(u.hover2.w, i.idx);
  }
  return vec4f(themed(color.rgb, max(i.state.x, i.state.y)) * mix(1.0, alpha, u.hover2.z), alpha);
}
`;
