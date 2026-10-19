// Solids: meshes made by code (buildings, roads, street furniture) and shapes repeated by instances (trees), standing on
// the ground of their tile. A tile's places are metres from its corner (x east, z south) and heights above the
// ground; the ground comes from a small height grid per tile (a layer of `ground`; none on flat ground: 0), so a sharper
// terrain moves every solid onto it with one texture write. Lit by the world's sun and sky (with shadows), or a fixed light; they cast
// shadows; a picking id per vertex (or instance); the hovered one lights up; a tile appears by a quick dissolve.
// Twin: solid.glsl.ts.
//   mesh vertex: a (x, height, z, colour) · b (anchor x, anchor z, normal, id)   colour: 0xRRGGBB as a number;
//                normal: octahedral, 12 bits a side, as a number (both exact in a float)
//   instance:    i0 (x, z, height, id) · i1 (scale x, y, z, turn rad) · i2 (colour, 0, 0, 0); vertex v (x, y, z, normal)
import { FRAME_WGSL } from './frame.wgsl.ts';
import { LIGHT_WGSL } from './light.wgsl.ts';
import { SHAPE_FNS_WGSL } from './shape-fns.wgsl.ts';

/** the solids' shared code without the varyings and the fragment stage (the impostors use it too) */
export const SOLID_LIB_WGSL = /* wgsl */ `${FRAME_WGSL}
// o: (the tile's corner in world metres x, z; metres per tile metre x, z) · v: (exaggeration, pick number, hovered
// id, shown 0..1) · w: (highlight rgb, the tile's slot: its part of the picking index) · l: (the share of windows lit at
// night, rooms behind them, the first row of its tints, its ground's layer)
struct T { o: vec4f, v: vec4f, w: vec4f, l: vec4f }
@group(0) @binding(1) var<uniform> tb: T;
// the tile drawn now: a mesh's chunk's block; an instance's chunk's, from its layer's records (core › geometry › shapes ›
// instances: every chunk's clones of a form in one draw), its layer's block for what all its chunks share
var<private> t: T;
/*@mparams*/
/*@functions*/
@group(1) @binding(0) var ground: texture_2d_array<f32>;
// a colour per id over the solid's own (rgb, how much): an analysis tints houses by their walk to a park
@group(1) @binding(2) var tints: texture_2d<f32>;
// the chunk's square seen from above (the imagery material, 15: its 500 m, x east, z south; 1 × 1: none)
@group(1) @binding(3) var picture: texture_2d<f32>;
// a surface field's colours on this mesh (core › simulation › fields › surface: solid-field.wgsl.ts sets it): a theme's
// subject, kept
var<private> fieldNear: f32;
${LIGHT_WGSL(1)}
const GN = 51;
const GSTEP = 10.0;
fn gLoad(x: i32, z: i32) -> f32 {
  return textureLoad(ground, vec2i(clamp(x, 0, GN - 1), clamp(z, 0, GN - 1)), i32(t.l.w), 0).x;
}
// the ground under a place of the tile (true metres), bilinear in its 10 m grid
fn groundAt(ax: f32, az: f32) -> f32 {
  // (a chunk on flat ground has no grid: its ground's layer −1)
  if (t.l.w < 0.0) {
    return 0.0;
  }
  let gx = clamp(ax / GSTEP, 0.0, f32(GN - 1));
  let gz = clamp(az / GSTEP, 0.0, f32(GN - 1));
  let x0 = i32(floor(gx));
  let z0 = i32(floor(gz));
  let fx = gx - f32(x0);
  let fz = gz - f32(z0);
  return mix(mix(gLoad(x0, z0), gLoad(x0 + 1, z0), fx), mix(gLoad(x0, z0 + 1), gLoad(x0 + 1, z0 + 1), fx), fz);
}
${SHAPE_FNS_WGSL}
// a tile's place → world metres from the view's centre (y up)
fn placeOf(x: f32, h: f32, z: f32) -> vec3f {
  return vec3f(t.o.x + x * t.o.z, h, t.o.y + z * t.o.w);
}
// a little towards the eye (half a pixel's worth): ribbons on the ground never sink into it
fn towardEye(p: vec3f) -> vec3f {
  let e = frame.eye.xyz - p;
  let d = length(e);
  return p + e / max(d, 0.001) * min(0.5 * frame.size.z * 2.0 * d * frame.misc.z / frame.size.y, d * 0.25);
}
// a card's leaves: its cut-out, thinned to the share its instance keeps (kind + 0.45 × kept)
fn leafCut(leaf: vec3f, world: vec3f) -> f32 {
  let kind = floor(leaf.z);
  let keep = (leaf.z - kind) / 0.45;
  let h = fract(sin(dot(floor(world * 0.8), vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
  return leafMask(leaf.xy, kind) * step(h, keep + 0.001);
}
// a dither 0..1 per pixel (interleaved gradient noise): a tile appears by dissolving in, with no blending (depth stays
// exact)
fn dither(p: vec2f) -> f32 {
  return fract(52.9829189 * fract(0.06711056 * floor(p.x) + 0.00583715 * floor(p.y)));
}
// the room behind a window (interior mapping): rooms 4 × 3.2 × 4 m on the world's axes, the eye's ray through the glass
// into its room, the surface it meets there (a floor, a ceiling, a wall: rgb) and the room's number (w)
fn roomBehind(world: vec3f) -> vec4f {
  let d = normalize(world - frame.eye.xyz);
  let size = vec3f(4.0, 3.2, 4.0);
  let p = world / size;
  let cell = floor(p + d * 0.002);
  let dd = d / size;
  let safe = select(dd, vec3f(0.00001), abs(dd) < vec3f(0.00001));
  let tt = (cell + step(vec3f(0.0), dd) - p) / safe;
  let k = fract(sin(dot(cell, vec3f(12.9898, 78.233, 37.719))) * 43758.5453);
  var col = vec3f(0.78, 0.72, 0.62) * (0.8 + 0.35 * k);
  var t = min(tt.x, tt.z);
  if (tt.y < t) {
    t = tt.y;
    col = select(vec3f(0.86, 0.84, 0.8), vec3f(0.42, 0.32, 0.24), d.y < 0.0);
  }
  return vec4f(col / (1.0 + t * 0.5), k);
}
// a facade's windows: on walls (not roofs), a floor (3.2 m) and a bay (3.2 m) apart, a pane in the middle of each
fn facadeWindow(world: vec3f, n: vec3f) -> f32 {
  if (abs(n.y) > 0.5) {
    return 0.0;
  }
  let tg = normalize(vec3f(-n.z, 0.0, n.x));
  let fu = fract(dot(world, tg) / 3.2);
  let fv = fract(world.y / 3.2);
  return step(0.22, fu) * step(fu, 0.78) * step(0.3, fv) * step(fv, 0.78);
}
// a physically based surface (192…255: roughness × 8 + metal, each 0…7): the sun's light through a GGX highlight and
// Schlick's Fresnel, the sky's in it, the diffuse share lit as the solids are (shadows, ambient)
fn pbrLit(c: vec3f, n: vec3f, world: vec3f, k: f32) -> vec3f {
  // (the code arrives interpolated: whole again before it is split)
  let q = floor(k + 0.5);
  let rough = max(0.04, floor(q / 8.0) / 7.0);
  let metal = (q - floor(q / 8.0) * 8.0) / 7.0;
  let v = normalize(frame.eye.xyz - world);
  let h = normalize(v + frame.sun.xyz);
  let nl = max(dot(n, frame.sun.xyz), 0.0);
  let nv = max(dot(n, v), 0.001);
  let nh = max(dot(n, h), 0.0);
  let a = rough * rough;
  let dd = nh * nh * (a * a - 1.0) + 1.0;
  let dgx = a * a / (3.14159 * dd * dd);
  let f0 = mix(vec3f(0.04), c, metal);
  let f = f0 + (vec3f(1.0) - f0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
  let kk = (rough + 1.0) * (rough + 1.0) / 8.0;
  let g = (nl / (nl * (1.0 - kk) + kk)) * (nv / (nv * (1.0 - kk) + kk));
  let spec = dgx * g * f / max(4.0 * nl * nv, 0.001);
  let lit = mix(c * (0.62 + 0.38 * max(dot(n, normalize(vec3f(-0.45, 0.8, -0.35))), 0.0)), sunLit(c, n, world), frame.sunColor.w);
  let env = mix(frame.ambient.rgb, frame.haze.rgb, 0.5) * f * (1.0 - 0.7 * rough);
  return lit * (1.0 - metal) + spec * frame.sunColor.rgb * nl * frame.sunColor.w + env;
}
// sheet metal (3: a corrugated iron roof, painted steel): the sun through a GGX highlight at roughness .55 (the
// corrugations spread it), Schlick's Fresnel from a tinted F0, shadowed as the rest; the diffuse what the Fresnel
// leaves (energy kept), the sky in it; the highlight clamped and the sum under sunLit's shoulder: a face in the sun's
// mirror angle gleams, never burns to white
fn metalSheet(c: vec3f, n: vec3f, world: vec3f, lit: vec3f) -> vec3f {
  let v = normalize(frame.eye.xyz - world);
  let h = normalize(v + frame.sun.xyz);
  let nl = max(dot(n, frame.sun.xyz), 0.0);
  let nv = max(dot(n, v), 0.05);
  let nh = max(dot(n, h), 0.0);
  let a = 0.55 * 0.55;
  let dd = nh * nh * (a * a - 1.0) + 1.0;
  let dgx = a * a / (3.14159 * dd * dd);
  let kk = (0.55 + 1.0) * (0.55 + 1.0) / 8.0;
  let g = (nl / (nl * (1.0 - kk) + kk)) * (nv / (nv * (1.0 - kk) + kk));
  let f0 = mix(vec3f(0.06), c, 0.35);
  let f = f0 + (vec3f(1.0) - f0) * pow(1.0 - max(dot(h, v), 0.0), 5.0);
  var sh = 0.0;
  if (nl > 0.0) {
    sh = sunShadow(world, n) * cloudShade(world);
  }
  let spec = min(dgx * g * f / (4.0 * nl * nv + 0.001) * nl * sh * frame.sunColor.w, vec3f(0.45)) * frame.sunColor.rgb;
  let env = mix(frame.ambient.rgb, frame.haze.rgb, 0.5) * f * 0.45;
  let s = lit * (vec3f(1.0) - f) + spec + env;
  return select(s, vec3f(0.8) + 0.2 * (vec3f(1.0) - exp(-(s - vec3f(0.8)) / 0.2)), s > vec3f(0.8));
}
// the tile in the fragment stage: what is its chunk's own came from the vertex (ck: hovered id, shown, slot, first
// tints row; co: its corner and scales), the rest is its block's
fn tileIn(ck: vec4f, co: vec4f) {
  t = T(co, vec4f(tb.v.x, tb.v.y, ck.x, ck.y), vec4f(tb.w.xyz, ck.z), vec4f(tb.l.x, tb.l.y, ck.w, tb.l.w));
}
// the colour of a solid's fragment: tinted, selected, hovered, lit (the world's sun, or a fixed light), both sides of thin
// faces; muted by a theme unless it is a subject
fn shadeSolid(base: vec3f, n0: vec3f, world: vec3f, id: f32, mat0: f32) -> vec3f {
  let k = i32(id + 0.5);
  // (its chunk's rows in the layer's tints, from its first; none: −1)
  var tn = vec4f(0.0);
  if (t.l.z >= 0.0) {
    tn = textureLoad(tints, vec2i(k % 256, min(i32(t.l.z) + k / 256, i32(textureDimensions(tints, 0).y) - 1)), 0);
  }
  var c = mix(base, tn.rgb, tn.a);
  // a theme's subjects keep their colour: what an analysis tints (the selected too: its colour is a tint), the hovered
  var keep = step(0.002, tn.a);
  // (a surface field's colours on it: kept too)
  keep = max(keep, fieldNear);
  if (abs(id - t.v.z) < 0.5) {
    c = mix(c, t.w.rgb, 0.45);
    keep = 1.0;
  }
  // lines (a wire's edges, raw segments) and flat (13): their own colour, unlit, through the air
  if ((mat0 > 7.5 && mat0 < 9.5) || (mat0 > 12.5 && mat0 < 13.5)) {
    return airFog(themed(c, keep), world);
  }
  var n = n0;
  if (dot(n, frame.eye.xyz - world) < 0.0) {
    n = -n;
  }
  // a facade (14): its wall, and windows a floor and a bay apart (lit windows); interior (16): windows with rooms
  var mat = mat0;
  if (mat0 > 13.5 && mat0 < 14.5) {
    mat = select(0.0, 12.0, facadeWindow(world, n) > 0.5);
  }
  if (mat0 > 15.5 && mat0 < 16.5) {
    mat = 12.0;
  }
  let rooms = t.l.y > 0.5 || (mat0 > 15.5 && mat0 < 16.5);
  let plain = c * (0.62 + 0.38 * max(dot(n, normalize(vec3f(-0.45, 0.8, -0.35))), 0.0));
  var o = mix(plain, sunLit(c, n, world), frame.sunColor.w);
  // Concrete retains diffuse sky/ground bounce under a deck. Only sunlight is shadowed.
  // Daylight scales the floor, so night remains dark.
  if (mat > 6.5 && mat < 7.5) {
    o = max(o, c * 0.60 * frame.sun.w);
  }
  // its material: 1 painted, 2 glass (the sky in it), 3 metal, 4 glowing, 5 leaves (the
  // sun through them), 6 water, 10…12 lamps (a ghost, 128…191, and your own, 64…127, are lit plain)
  if ((mat > 0.5 && mat < 6.5) || (mat > 11.5 && mat < 12.5)) {
    let v = normalize(frame.eye.xyz - world);
    let fres = pow(1.0 - max(dot(v, n), 0.0), 4.0);
    let h = normalize(v + frame.sun.xyz);
    let lit = frame.sunColor.w * max(dot(n, frame.sun.xyz), 0.0);
    let night = 1.0 - clamp(frame.sun.w * 4.0, 0.0, 1.0);
    if ((mat > 1.5 && mat < 2.5) || mat > 11.5) {
      o = mix(c * 0.35 * (frame.ambient.rgb + frame.sunColor.rgb * 0.3), frame.haze.rgb, 0.25 + 0.6 * fres) + frame.sunColor.rgb * pow(max(dot(n, h), 0.0), 90.0) * lit;
    } else if (mat > 2.5 && mat < 3.5) {
      o = metalSheet(c, n, world, o);
    } else if (mat > 3.5 && mat < 4.5) {
      o = c * (0.7 + 0.6 * night);
    } else if (mat > 4.5 && mat < 5.5) {
      o = o + c * frame.sunColor.rgb * 0.3 * max(dot(-n, frame.sun.xyz), 0.0) * frame.sunColor.w;
    } else {
      o = o + frame.sunColor.rgb * pow(max(dot(n, h), 0.0), 24.0) * lit * 0.3 + frame.haze.rgb * fres * 0.15;
    }
  }
  // the imagery under it, from above (15): its chunk's picture where it has one
  if (mat0 > 14.5 && mat0 < 15.5) {
    let pd = textureDimensions(picture, 0);
    if (pd.x > 1u) {
      let lx = (world.x - t.o.x) / t.o.z / 500.0;
      let lz = (world.z - t.o.y) / t.o.w / 500.0;
      let im = textureLoad(picture, vec2i(clamp(vec2f(lx, lz), vec2f(0.0), vec2f(0.999)) * vec2f(pd)), 0).rgb;
      o = mix(im * (0.62 + 0.38 * max(dot(n, normalize(vec3f(-0.45, 0.8, -0.35))), 0.0)), sunLit(im, n, world), frame.sunColor.w);
    }
  }
  // physically based (192…255)
  if (mat0 > 191.5) {
    o = pbrLit(c, n, world, mat0 - 192.0);
  }
  // wet (the world's rain): matte, concrete and physically based surfaces darker and glossier
  let wet = frame.weather.x;
  if (wet > 0.0 && (mat < 0.5 || (mat > 6.5 && mat < 7.5) || mat0 > 191.5)) {
    let wv = normalize(frame.eye.xyz - world);
    let wh = normalize(wv + frame.sun.xyz);
    let wl = frame.sunColor.w * max(dot(n, frame.sun.xyz), 0.0);
    o = o * (1.0 - 0.3 * wet) + frame.sunColor.rgb * pow(max(dot(n, wh), 0.0), 70.0) * wl * 0.6 * wet + frame.haze.rgb * pow(1.0 - max(dot(wv, n), 0.0), 4.0) * 0.3 * wet;
  }
  // lamps (10 head, 11 tail, 12 windows): from dusk they glow (a lamp's own colour; windows: glass with a share of
  // them lit rooms, the layer's); by day a lens, a pane of glass
  if (mat > 9.5 && mat < 12.5) {
    let dark = 1.0 - clamp(frame.sun.w * 4.0, 0.0, 1.0);
    if (mat < 11.5) {
      o = mix(o * 0.85 + c * 0.12, c * select(1.35, 1.6, mat < 10.5), dark);
    } else {
      // rooms behind the glass (the layer's interior): seen by day through it, lit or dark at night
      let inner = roomBehind(world);
      let deep = rooms;
      let r = select(fract(sin(dot(floor(world * vec3f(0.33, 0.36, 0.33)), vec3f(12.9898, 78.233, 37.719))) * 43758.5453), inner.w, deep);
      let room = step(1.0 - t.l.x, r);
      let warm = select(vec3f(1.0, 0.8, 0.52) * (0.75 + 0.25 * fract(room * 7.31 + world.y)), inner.rgb * vec3f(1.3, 1.05, 0.75), deep);
      o = mix(o, inner.rgb * (frame.ambient.rgb + frame.sunColor.rgb * 0.25), select(0.0, 0.55 * (1.0 - dark), deep));
      o = mix(o, warm, room * dark);
    }
  }
  return airFog(themed(o, keep), world);
}
`;
export const SOLID_COMMON_WGSL = /* wgsl */ `${SOLID_LIB_WGSL}
struct O {
  @builtin(position) pos: vec4f,
  @location(0) col: vec3f,
  @location(1) n: vec3f,
  @location(2) world: vec3f,
  @location(3) @interpolate(flat) id: f32,
  @location(4) leaf: vec3f,
  @location(5) @interpolate(flat) ck: vec4f,
  @location(6) @interpolate(flat) co: vec4f,
  /*@mvaryings*/
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  tileIn(i.ck, i.co);
  /*@fieldfragment*/
  if (t.v.w < 1.0 && dither(i.pos.xy) > t.v.w) {
    discard;
  }
  // a leaf card: only its leaves (in the frame, the picking and the sun's shadow map alike); a thinner crown (its
  // instance's share of leaves kept, in the kind's fraction) drops patches of them
  if (i.leaf.z > 0.5 && leafCut(i.leaf, i.world) < 0.5) {
    discard;
  }
  if (frame.pick.y > 0.5) {
    return packDepth(i.pos.z);
  }
  if (frame.pick.x > 0.5) {
    return pickOut(t.v.y, t.w.w * 65536.0 + i.id);
  }
  let m = max(-i.leaf.z, 0.0);
  // a ghost: see-through by its code (128…191: opacity 0…1)
  var color = vec4f(shadeSolid(i.col, normalize(i.n), i.world, i.id, m), select(1.0, clamp((m - 128.0) / 63.0, 0.0, 1.0), m > 127.5 && m < 191.5));
  /*@mfinputs*/
  /*@mfragment*/
  return color;
}
`;
export const SOLID_WGSL = /* wgsl */ `${SOLID_COMMON_WGSL}
struct I { @location(0) a: vec4f, @location(1) b: vec4f }
@vertex fn vs(i: I, @builtin(vertex_index) vi: u32) -> O {
  t = tb;
  let h = groundAt(i.b.x, i.b.y) * t.v.x + i.a.y;
  var position = placeOf(i.a.x, h, i.a.z);
  var o: O;
  o.col = unpackRGB(i.a.w);
  /*@fieldvertex*/
  o.n = unpackNormal(i.b.z);
  // the id's high part is the material
  let mat = floor(i.b.w / 65536.0);
  o.id = i.b.w - mat * 65536.0;
  o.leaf = vec3f(0.0, 0.0, -mat);
  o.ck = vec4f(t.v.z, t.v.w, t.w.w, t.l.z);
  o.co = t.o;
  /*@mvinputs*/
  /*@mvertex*/
  /*@mvoutputs*/
  o.pos = clipOut(frame.viewProj * vec4f(towardEye(position), 1.0));
  o.world = position;
  return o;
}
`;
