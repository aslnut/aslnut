// Skinned bodies (people, animals): a mesh bound to bones, drawn as instances that share it. Each instance points
// at two rows of a texture of skin transforms (dual quaternions, two texels a bone, then the morph weights) and how
// far between them it is: the frames of a clip, or two clips blended. Its 4 bones blended by dual quaternions (bent
// and twisted joints keep their volume), up to two morph shapes added first; then turned, scaled and placed like the
// solids' instances, lit and shadowed as they are (their fragment shading). A decal (a face) is drawn by a material's
// skinDecal where the vertex has texture coordinates. Twin: skin.glsl.ts.
//   instance: i0 (x, z, height, turn) · i1 (row a, row b, between, scale) · i2, i3 (8 palette colours 0xRRGGBB) ·
//             i4 (id, decal params ×3)
//   vertex:   a0 (x, y, z, normal) · a1 (joints 0 + 256 × 1, joints 2 + 256 × 3, palette slot, uv as 4096 u + v, −1
//             none) · a2 (weights) · a3 (morph offsets packed in three, the weight pair: 0, 1, −1 none)
import { SOLID_LIB_WGSL } from './solid.wgsl.ts';

/** the default decal: the colour as it is */
export const SKIN_DECAL_WGSL = /* wgsl */ `
fn skinDecal(uv: vec2f, p: vec3f, base: vec3f, seed: f32) -> vec3f {
  return base;
}
`;
/** the program, with a material's skinDecal (WGSL) */
export const skinWGSL = (decal: string = SKIN_DECAL_WGSL) => /* wgsl */ `${SOLID_LIB_WGSL}
@group(1) @binding(4) var bones: texture_2d<f32>;
struct O {
  @builtin(position) pos: vec4f,
  @location(0) col: vec3f,
  @location(1) n: vec3f,
  @location(2) world: vec3f,
  @location(3) @interpolate(flat) id: f32,
  @location(4) uv: vec2f,
  @location(5) @interpolate(flat) dp: vec4f,
}
${decal}
// a texel of the skin transforms: a row, a column
fn texel(row: f32, x: f32) -> vec4f {
  return textureLoad(bones, vec2i(i32(x + 0.5), i32(row + 0.5)), 0);
}
// a rest point moved by a unit dual quaternion (r: rotation, d: its dual part)
fn dqPoint(r: vec4f, d: vec4f, p: vec3f) -> vec3f {
  return p + 2.0 * cross(r.xyz, cross(r.xyz, p) + r.w * p) + 2.0 * (r.w * d.xyz - d.w * r.xyz + cross(r.xyz, d.xyz));
}
fn dqVector(r: vec4f, v: vec3f) -> vec3f {
  return v + 2.0 * cross(r.xyz, cross(r.xyz, v) + r.w * v);
}
// two morph offsets' numbers out of one float (12 bits each, ±0.2 m in 0.1 mm)
fn unpack12(v: f32) -> vec2f {
  let hi = floor(v / 4096.0);
  return (vec2f(hi, v - hi * 4096.0) - vec2f(2048.0, 2048.0)) / 10000.0;
}
struct I { @location(0) i0: vec4f, @location(1) i1: vec4f, @location(2) i2: vec4f, @location(3) i3: vec4f, @location(4) i4: vec4f, @location(5) a0: vec4f, @location(6) a1: vec4f, @location(7) a2: vec4f, @location(8) a3: vec4f }
@vertex fn vs(i: I) -> O {
  t = tb;
  let A = i.i1.x;
  let B = i.i1.y;
  let tw = i.i1.z;
  var js = array<f32, 4>(i.a1.x - floor(i.a1.x / 256.0) * 256.0, floor(i.a1.x / 256.0), i.a1.y - floor(i.a1.y / 256.0) * 256.0, floor(i.a1.y / 256.0));
  var ws = array<f32, 4>(i.a2.x, i.a2.y, i.a2.z, i.a2.w);
  var r = vec4f(0.0);
  var d = vec4f(0.0);
  var r0 = vec4f(0.0, 0.0, 0.0, 1.0);
  for (var k = 0; k < 4; k++) {
    if (k > 0 && ws[k] <= 0.0) {
      continue;
    }
    // the bone between the two rows (the shorter way round)
    let bx = js[k] * 2.0;
    let ra = texel(A, bx);
    var rb = texel(B, bx);
    let da = texel(A, bx + 1.0);
    var db = texel(B, bx + 1.0);
    if (dot(ra, rb) < 0.0) {
      rb = -rb;
      db = -db;
    }
    let qr = mix(ra, rb, tw);
    let qd = mix(da, db, tw);
    if (k == 0) {
      r0 = qr;
    }
    // in the first bone's hemisphere
    let w = select(ws[k], -ws[k], dot(qr, r0) < 0.0);
    r += qr * w;
    d += qd * w;
  }
  let len = max(length(r), 1e-6);
  r /= len;
  d /= len;
  var p = i.a0.xyz;
  if (i.a3.w > -0.5) {
    let nb = f32(textureDimensions(bones, 0).x) - 1.0;
    let mw = mix(texel(A, nb), texel(B, nb), tw);
    let pw = select(mw.xy, mw.zw, i.a3.w > 0.5);
    let ax = unpack12(i.a3.x);
    let ay = unpack12(i.a3.y);
    let az = unpack12(i.a3.z);
    p += vec3f(ax.x, ax.y, ay.x) * pw.x + vec3f(ay.y, az.x, az.y) * pw.y;
  }
  let q = dqPoint(r, d, p) * i.i1.w;
  let nq = dqVector(r, unpackNormal(i.a0.w));
  let c = cos(i.i0.w);
  let s = sin(i.i0.w);
  var position = placeOf(i.i0.x + q.x * c - q.z * s, i.i0.z + q.y, i.i0.y + q.x * s + q.z * c);
  var pal = array<f32, 8>(i.i2.x, i.i2.y, i.i2.z, i.i2.w, i.i3.x, i.i3.y, i.i3.z, i.i3.w);
  var o: O;
  o.col = unpackRGB(pal[clamp(i32(i.a1.z + 0.5), 0, 7)]);
  o.n = vec3f(nq.x * c - nq.z * s, nq.y, nq.x * s + nq.z * c);
  o.id = i.i4.x;
  let hu = floor(i.a1.w / 4096.0);
  o.uv = select(vec2f(-1.0, -1.0), vec2f(hu, i.a1.w - hu * 4096.0) / 4095.0, i.a1.w >= 0.0);
  o.dp = vec4f(i.i4.yzw, i.i4.x);
  o.pos = clipOut(frame.viewProj * vec4f(position, 1.0));
  o.world = position;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  t = tb;
  if (t.v.w < 1.0 && dither(i.pos.xy) > t.v.w) {
    discard;
  }
  if (frame.pick.y > 0.5) {
    return packDepth(i.pos.z);
  }
  if (frame.pick.x > 0.5) {
    return pickOut(t.v.y, t.w.w * 65536.0 + i.id);
  }
  var base = i.col;
  if (i.uv.x >= 0.0) {
    base = skinDecal(i.uv, i.dp.xyz, base, i.dp.w);
  }
  return vec4f(shadeSolid(base, normalize(i.n), i.world, i.id, 0.0), 1.0);
}
`;
/** the default program */
export const SKIN_WGSL = skinWGSL();
