// What every mark drawn from features shares (lines, areas, extrusions, labels). Twin: feature.glsl.ts.
//   place      a place given as longitude (radians) and Mercator y, both from the layer's origin, and a height:
//              on the globe and on the flat map, blended by the morph, with centre-relative numbers only
//   the layer  block L: its origin from the view's centre, exaggeration, lift, opacity, reveal, hover and
//              selection looks, the pick number
//   features   one float texture, up to 6 planes of one texel per feature: 0 colour · 1 the colour before (an eased
//              restyle) · 2 state (hovered, selected, reveal progress, shown) · 3 numbers (now, before, value, base)
//              · 4 centre and half size (from the origin) · 5 motion (east, north, up metres, scale) · 6 the mark's
//              own (a point's outline colour, a line's dashes). Only the planes
//              that differ between features are there (L.slots: each one's row block, -1: not there); the others are
//              the same for every feature: the colour and numbers in L.k0 and L.k3, no motion, no box
import { FRAME_WGSL } from './frame.wgsl.ts';

export const FEATURE_WGSL = /* wgsl */ `${FRAME_WGSL}
// origin: (lon of the origin − the centre's, radians · Mercator y likewise · exaggeration · lift m)
// look: (opacity, shown, transition mix, rows per plane) · reveal: (mode, 1 when plane 5 moves features, soft, glow)
// hover: (rgb, mix) · hover2: (raise m, outline px, outline mix, pick number) · sel: (rgb, mix) · sel2: (raise, outline px, 0, 0)
// a, b, c: the mark's own · ground: (the lowest, the highest ground under it, m) for marks draped on the ground
// slots: (colour, colour before, numbers, box) planes' row blocks · slots2: (state, motion, 0, 0) · k0: the colour and
// k3: the numbers when they are the same for every feature · size: how its size or width is drawn (units, least, most
// CSS px: core › render › drawing › instancing, sizePx) · slots3: (the mark's own plane's row block, 0, 0, 0) · k6: that
// plane when it is the same for every feature
struct L { origin: vec4f, look: vec4f, reveal: vec4f, hover: vec4f, hover2: vec4f, sel: vec4f, sel2: vec4f, a: vec4f, b: vec4f, c: vec4f, ground: vec4f, slots: vec4f, slots2: vec4f, k0: vec4f, k3: vec4f, size: vec4f, slots3: vec4f, k6: vec4f }
@group(0) @binding(1) var<uniform> u: L;
@group(1) @binding(0) var feat: texture_2d<f32>;
const FW = 512;
const PI = 3.141592653589793;
const RE = 6378137.0;
fn s2(a: f32) -> f32 {
  let s = sin(a * 0.5);
  return 2.0 * s * s;
}
// a place → world metres from the view centre (y up), on the globe and flat, by the morph
fn placeAt(rel: vec2f, h: f32) -> vec3f {
  let dl = u.origin.x + rel.x;
  let dm = u.origin.y + rel.y;
  let c = RE * frame.misc.y;
  let F = vec3f(c * dl, h, -c * dm);
  if (frame.size.w >= 1.0) {
    return F;
  }
  let lat = 2.0 * atan(exp(frame.geo.x + dm)) - PI * 0.5;
  let dp = lat - frame.misc.x;
  let rr = RE + h;
  let cl = cos(lat);
  let k = s2(dp) + frame.misc.y * cl * s2(dl);
  let G = vec3f(rr * cl * sin(dl), h - rr * k, -rr * (sin(dp) + frame.geo.y * cl * s2(dl)));
  return mix(G, F, frame.size.w);
}
// a place on the ground (p) and how it moves per metre up (d): placeAt(rel, h) = p + h · d, one evaluation for every
// height (the draped marks place a piece's corners at several heights)
struct Up { p: vec3f, d: vec3f }
fn placeUp(rel: vec2f) -> Up {
  let dl = u.origin.x + rel.x;
  let dm = u.origin.y + rel.y;
  let c = RE * frame.misc.y;
  let F = vec3f(c * dl, 0.0, -c * dm);
  if (frame.size.w >= 1.0) {
    return Up(F, vec3f(0.0, 1.0, 0.0));
  }
  let lat = 2.0 * atan(exp(frame.geo.x + dm)) - PI * 0.5;
  let dp = lat - frame.misc.x;
  let cl = cos(lat);
  let k = s2(dp) + frame.misc.y * cl * s2(dl);
  let D = vec3f(cl * sin(dl), -k, -(sin(dp) + frame.geo.y * cl * s2(dl)));
  return Up(mix(RE * D, F, frame.size.w), mix(D + vec3f(0.0, 1.0, 0.0), vec3f(0.0, 1.0, 0.0), frame.size.w));
}
// moved towards the eye by px pixels' worth of metres: drawn over the ground under it, never into it
fn liftToEye(p: vec3f, px: f32) -> vec3f {
  let toEye = frame.eye.xyz - p;
  let d = length(toEye);
  let mpp = 2.0 * d * frame.misc.z / frame.size.y;
  return p + toEye / max(d, 0.001) * min(px * frame.size.z * mpp, d * 0.5);
}
// metres per device pixel at a place
fn mppAt(p: vec3f) -> f32 {
  return 2.0 * length(frame.eye.xyz - p) * frame.misc.z / frame.size.y;
}
// where a plane is in the texture (its row block; -1: not there)
fn slotOf(plane: i32) -> f32 {
  var s = u.slots2.y;
  if (plane == 0) {
    s = u.slots.x;
  }
  if (plane == 1) {
    s = u.slots.y;
  }
  if (plane == 2) {
    s = u.slots2.x;
  }
  if (plane == 3) {
    s = u.slots.z;
  }
  if (plane == 4) {
    s = u.slots.w;
  }
  if (plane == 6) {
    s = u.slots3.x;
  }
  return s;
}
// a plane the same for every feature: the colour (now and before), the numbers, no motion, no box
fn constOf(plane: i32) -> vec4f {
  if (plane <= 1) {
    return u.k0;
  }
  if (plane == 3) {
    return u.k3;
  }
  if (plane == 5) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  if (plane == 6) {
    return u.k6;
  }
  return vec4f(0.0);
}
// a feature's texel in a plane
fn featAt(index: f32, plane: i32) -> vec4f {
  let s = slotOf(plane);
  if (s < 0.0) {
    return constOf(plane);
  }
  let i = i32(index + 0.5);
  return textureLoad(feat, vec2i(i % FW, i / FW + i32(s) * i32(u.look.w)), 0);
}
// the colour now: the transition between before and now, then the hover and selection looks
fn colourOf(index: f32, state: vec4f) -> vec4f {
  var c = mix(featAt(index, 1), featAt(index, 0), u.look.z);
  c = vec4f(mix(c.rgb, u.sel.rgb, u.sel.a * state.y), c.a);
  c = vec4f(mix(c.rgb, u.hover.rgb, u.hover.a * state.x), c.a);
  return c;
}
fn raiseOf(state: vec4f) -> f32 {
  return u.hover2.x * state.x + u.sel2.x * state.y;
}
// a dash pattern (on, off, on, off CSS px; the first 0: none) at a distance along it: false in its gaps
fn dashOn(at: f32, d: vec4f) -> bool {
  let p = d.x + d.y + d.z + d.w;
  if (d.x <= 0.0 || p <= 0.0001) {
    return true;
  }
  let k = at - floor(at / p) * p;
  return k < d.x || (k >= d.x + d.y && k < d.x + d.y + d.z);
}
// how far across a line's piece a point is, in px (t: along the piece 0..1, s: across, len: the piece's length, k: units
// a px; ends.z / .w: a piece before / after it): at the line's ends its caps (u.a.z: 0 round, 1 butt, 2 square); a
// joint belongs to the piece after it, and to this piece's round end too with round joins (u.a.w: 1); 1e9: not drawn
fn acrossAt(t: f32, s: f32, len: f32, k: f32, ends: vec4f) -> f32 {
  let cap = u.a.z;
  if (t < 0.0) {
    if (ends.z > 0.5 || (cap > 0.5 && cap < 1.5)) {
      return 1e9;
    }
    if (cap > 1.5) {
      return max(abs(s), -t * len) / k;
    }
    return length(vec2f(s, t * len)) / k;
  }
  if (t >= 1.0) {
    if (ends.w > 0.5) {
      if (u.a.w < 0.5) {
        return 1e9;
      }
      return length(vec2f(s, (t - 1.0) * len)) / k;
    }
    if (cap > 0.5 && cap < 1.5) {
      return 1e9;
    }
    if (cap > 1.5) {
      return max(abs(s), (t - 1.0) * len) / k;
    }
    return length(vec2f(s, (t - 1.0) * len)) / k;
  }
  return s / k;
}
fn easeOutBack(t: f32) -> f32 {
  let c = 1.70158;
  let x = t - 1.0;
  return 1.0 + (c + 1.0) * x * x * x + c * x * x;
}
`;
