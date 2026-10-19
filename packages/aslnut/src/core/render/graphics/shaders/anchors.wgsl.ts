// Where a thing placed on another stands, on the chip (core › entities › placement): what an icon or a card is placed
// on. Two forms, each with the same three functions (the follower's program includes one):
//   still   placed on features: the places texture (`places`, 2 texels an item: x, y from the origin (radians of
//           longitude, Mercator y), its height m and how it stands (0: not placed, 1: on the ground: × the
//           exaggeration, 2: its own height) · its heading rad and its lift m), the follower's block `u` (place: the
//           origin − the view's centre, the exaggeration, 0)
//   follow  placed on a set's things by reference (core › entities › sets: setsTrackWGSL first: its block S and
//           textures, its functions): where each thing is at the set's clock, on the ground under it (or as high
//           over it as it flies), turned along its path; nothing written per frame. `u.place.w`: metres over it
//   anchorOf(e) → (world metres from the view's centre, 1) or 0 (not placed: before its first sample, held by another)
//   anchorTurn(e) → its heading (radians clockwise from north) · anchorShaped(e) → drawn as a shape now (an icon gives
//   way to it, as the set's dot does)
// Twin: anchors.glsl.ts.
export const ANCHOR_STILL_WGSL = /* wgsl */ `
const PI = 3.141592653589793;
const RE = 6378137.0;
fn anchorS2(a: f32) -> f32 {
  let h = sin(a * 0.5);
  return 2.0 * h * h;
}
// a place → world metres from the view centre (y up), on the globe and flat, by the morph (as a set's placeAt)
fn anchorPlace(rel: vec2f, h: f32) -> vec3f {
  let dl = u.place.x + rel.x;
  let dm = u.place.y + rel.y;
  let c = RE * frame.misc.y;
  let F = vec3f(c * dl, h, -c * dm);
  if (frame.size.w >= 1.0) {
    return F;
  }
  let lat = 2.0 * atan(exp(frame.geo.x + dm)) - PI * 0.5;
  let dp = lat - frame.misc.x;
  let rr = RE + h;
  let cl = cos(lat);
  let k = anchorS2(dp) + frame.misc.y * cl * anchorS2(dl);
  let G = vec3f(rr * cl * sin(dl), h - rr * k, -rr * (sin(dp) + frame.geo.y * cl * anchorS2(dl)));
  return mix(G, F, frame.size.w);
}
fn anchorTexel(e: i32, k: i32) -> vec4f {
  let i = e * 2 + k;
  return textureLoad(places, vec2i(i % 4096, i / 4096), 0);
}
fn anchorOf(e: i32) -> vec4f {
  let a = anchorTexel(e, 0);
  if (a.w < 0.5) {
    return vec4f(0.0);
  }
  let b = anchorTexel(e, 1);
  let h = select(a.z, a.z * u.place.z, a.w < 1.5) + b.y;
  return vec4f(anchorPlace(a.xy, h), 1.0);
}
fn anchorTurn(e: i32) -> f32 {
  return anchorTexel(e, 1).x;
}
fn anchorShaped(e: i32) -> bool {
  return false;
}
fn anchorBehind(p: vec3f) -> bool {
  return frame.size.w < 0.5 && dot(p - vec3f(0.0, -RE, 0.0), frame.eye.xyz - p) < 0.0;
}
`;
export const ANCHOR_FOLLOW_WGSL = /* wgsl */ `
fn anchorOf(e: i32) -> vec4f {
  let m = liveOf(e);
  let w = whereAt(m, jOf(e), s.clock.x);
  let j = i32(w.z);
  if ((j < 0 && s.misc.w < 0.5) || m.y < 1.0) {
    return vec4f(0.0);
  }
  return vec4f(placeAt(w.xy, heightOf(w.xy, altNow(e)) + u.place.w), 1.0);
}
fn anchorTurn(e: i32) -> f32 {
  let m = liveOf(e);
  let w = whereAt(m, jOf(e), s.clock.x);
  return headingAt(m, i32(w.z), s.clock.x);
}
fn anchorShaped(e: i32) -> bool {
  return lookOf(e).z > 0.5;
}
fn anchorBehind(p: vec3f) -> bool {
  return behindGlobe(p);
}
`;
