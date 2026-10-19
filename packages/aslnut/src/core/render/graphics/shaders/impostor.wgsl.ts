// Impostors (core › geometry › shapes › levels › impostor): a shape far away as one camera-facing card. Baked once:
// the shape seen from a grid of directions over the upper half of a sphere (hemi-octahedral), its colour into one
// atlas and its normals into another; drawn: the card for an instance picks the view nearest to where it is seen from
// (the sun's direction in the shadow pass: its shadow is the shape's too), cut out where the shape is not, lit with
// the baked normals turned as the instance is. Twin: impostor.glsl.ts.
import { SHAPE_FNS_WGSL } from './shape-fns.wgsl.ts';
import { SOLID_LIB_WGSL } from './solid.wgsl.ts';
import { SOLID_SET_WGSL } from './solid-inst.wgsl.ts';

/** the bake: one draw per view, into its cell of the atlas (b.view: the shape → the view's frame, scaled to its
 *  bounding sphere; b.cell: the cell's centre in clip space and its half size; b.mode: x 0 colour / 1 normals, yzw the
 *  direction seen from) */
export const IMPOSTOR_BAKE_WGSL = /* wgsl */ `
struct B { view: mat4x4f, cell: vec4f, mode: vec4f }
@group(0) @binding(0) var<uniform> b: B;
${SHAPE_FNS_WGSL}
struct VI { @location(3) v: vec4f, @location(4) vc: f32, @location(5) card: f32 }
struct VO { @builtin(position) pos: vec4f, @location(0) col: vec3f, @location(1) n: vec3f, @location(2) leaf: vec3f, @location(3) q: vec2f }
@vertex fn vs(i: VI) -> VO {
  let p = b.view * vec4f(i.v.xyz, 1.0);
  var o: VO;
  o.q = p.xy;
  o.pos = vec4f(p.xy * b.cell.z + b.cell.xy, 0.5 - p.z * 0.5, 1.0);
  o.col = unpackRGB(i.vc);
  o.n = unpackNormal(i.v.w);
  o.leaf = unpackCard(i.card);
  return o;
}
@fragment fn fs(o: VO) -> @location(0) vec4f {
  if (abs(o.q.x) > 1.0 || abs(o.q.y) > 1.0) {
    discard;
  }
  if (o.leaf.z > 0.5 && leafMask(o.leaf.xy, o.leaf.z) < 0.5) {
    discard;
  }
  var n = normalize(o.n);
  if (dot(n, b.mode.yzw) < 0.0) {
    n = -n;
  }
  return select(vec4f(o.col, 1.0), vec4f(n * 0.5 + vec3f(0.5, 0.5, 0.5), 1.0), b.mode.x > 0.5);
}
`;

/** the cards: im.a (the shape's bounding radius and its centre's height, views a side, the atlas side px) */
export const IMPOSTOR_WGSL = /* wgsl */ `${SOLID_LIB_WGSL}${SOLID_SET_WGSL}
struct IM { a: vec4f }
@group(0) @binding(3) var<uniform> im: IM;
@group(1) @binding(5) var atlas: texture_2d<f32>;
@group(1) @binding(6) var normals: texture_2d<f32>;
// a direction over the upper half of a sphere → 0..1 on a square (hemi-octahedral)
fn hemiOct(d: vec3f) -> vec2f {
  let a = vec3f(d.x, max(d.y, 0.0), d.z) / (abs(d.x) + max(d.y, 0.0) + abs(d.z) + 0.000001);
  return vec2f(a.x + a.z, a.x - a.z) * 0.5 + vec2f(0.5, 0.5);
}
// the view a cell of the grid was baked from (its direction)
fn hemiOctDir(e: vec2f) -> vec3f {
  let f = e * 2.0 - vec2f(1.0, 1.0);
  let x = (f.x + f.y) * 0.5;
  let z = (f.x - f.y) * 0.5;
  return normalize(vec3f(x, max(1.0 - abs(x) - abs(z), 0.0), z));
}
struct I { @location(0) r: f32 }
struct OI {
  @builtin(position) pos: vec4f,
  @location(0) col: vec3f,
  @location(1) world: vec3f,
  @location(2) @interpolate(flat) id: f32,
  @location(3) uv: vec2f,
  @location(4) @interpolate(flat) turn: f32,
  @location(5) @interpolate(flat) ck: vec4f,
  @location(6) @interpolate(flat) co: vec4f,
}
@vertex fn vs(@builtin(vertex_index) vi: u32, i: I) -> OI {
  let r0 = recAt(i.r, 0);
  let r1 = recAt(i.r, 1);
  let r2 = recAt(i.r, 2);
  tileAt(r2.w);
  let g = groundAt(r0.x, r0.y) * t.v.x + r0.z;
  // its set's range on screen (the whole shape's, seen at its middle)
  let s = r1.y * keepOf(max(r1.x, r1.z), placeOf(r0.x, g + im.a.y * r1.y, r0.y));
  let h = g + im.a.y * s;
  let c = placeOf(r0.x, h, r0.y);
  // seen from the eye; in the sun's shadow pass, from the sun
  var d = normalize(frame.eye.xyz - c);
  if (frame.pick.y > 0.5) {
    d = normalize(frame.sun.xyz);
  }
  let co = cos(r1.w);
  let si = sin(r1.w);
  let n = im.a.z;
  let cell = clamp(floor(hemiOct(vec3f(d.x * co + d.z * si, d.y, -d.x * si + d.z * co)) * n), vec2f(0.0, 0.0), vec2f(n - 1.0, n - 1.0));
  // the card faces the view the cell was baked from, turned as the instance is
  let bd = hemiOctDir((cell + vec2f(0.5, 0.5)) / n);
  let dw = vec3f(bd.x * co - bd.z * si, bd.y, bd.x * si + bd.z * co);
  var right = cross(vec3f(0.0, 1.0, 0.0), dw);
  if (length(right) < 0.001) {
    right = vec3f(co, 0.0, si);
  }
  right = normalize(right);
  let up = cross(dw, right);
  let k = vi % 6u;
  let cx = select(-1.0, 1.0, k == 1u || k == 2u || k == 4u);
  let cy = select(-1.0, 1.0, k == 2u || k == 4u || k == 5u);
  let p = c + (right * cx + up * cy) * im.a.x * s;
  var o: OI;
  o.pos = clipOut(frame.viewProj * vec4f(p, 1.0));
  o.col = unpackRGB(r2.x);
  o.world = p;
  o.id = r0.w;
  o.uv = (cell + vec2f(cx * 0.5 + 0.5, 0.5 - cy * 0.5)) / n;
  o.turn = r1.w;
  o.ck = vec4f(t.v.z, t.v.w, t.w.w, t.l.z);
  o.co = t.o;
  return o;
}
@fragment fn fs(o: OI) -> @location(0) vec4f {
  tileIn(o.ck, o.co);
  if (t.v.w < 1.0 && dither(o.pos.xy) > t.v.w) {
    discard;
  }
  let px = vec2i(clamp(o.uv * im.a.w, vec2f(0.0, 0.0), vec2f(im.a.w - 1.0, im.a.w - 1.0)));
  let a = textureLoad(atlas, px, 0);
  if (a.a < 0.5) {
    discard;
  }
  if (frame.pick.y > 0.5) {
    return packDepth(o.pos.z);
  }
  if (frame.pick.x > 0.5) {
    return pickOut(t.v.y, t.w.w * 65536.0 + o.id);
  }
  let nl = textureLoad(normals, px, 0).xyz * 2.0 - vec3f(1.0, 1.0, 1.0);
  let co = cos(o.turn);
  let si = sin(o.turn);
  let nw = normalize(vec3f(nl.x * co - nl.z * si, nl.y, nl.x * si + nl.z * co));
  return vec4f(shadeSolid(a.rgb * o.col, nw, o.world, o.id, 0.0), 1.0);
}
`;
