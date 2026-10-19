// Solids repeated by instances (trees, poles, a fleet of one shape): one shape, many places, each clone only its record
// (a texture's texels: its place, scale, turn, seed, tints, its joints' rates), turned, scaled and coloured, standing on
// its tile's ground, its parts moved by their joints. One draw a form and level for every chunk of the layer: an
// instance is its record's first texel in the layer's records, the record names its chunk (its slot), whose place and
// state the records' first row holds. The fragment stage is the solids' own (solid.wgsl.ts). Twin: solid-inst.glsl.ts.
//   a record: (x, z, height, id) · (scale x, y, z, turn rad) · (colour, the share of its leaf cards kept out, seed 0..1,
//   its chunk's slot) · its groups' colours (1…4; −1: the group's own), when its set tints them · its joints' (rate,
//   phase) pairs
//   a chunk (row 0, two texels a slot): its corner and scales (the T block's o) · (its hovered id, shown 0..1, its
//   ground's layer, the first row of its tints)
import { SOLID_COMMON_WGSL } from './solid.wgsl.ts';

/** an instance set's own block, its records and its joints (the instance programs: solids', impostors', variants') */
export const SOLID_SET_WGSL = /* wgsl */ `
// an instance set's block (S, binding 2: one for its form's clones in every chunk): a (its shape's size across m, 1 when
// it keeps a range on screen, the least and the most CSS px: core › render › drawing › size) · b (0, texels a record, 0,
// 1 when its clones tint its groups) · c (its clock's start s, its joints, 0, 0) · d (the share of its copies over
// time the governor keeps, 0, 0, 0) · e (each emitter 3: its place, its copies' life s · rise, spread m, grow ×, its
// copies at the whole level · opacity at birth, at death, drift x, z m: core › geometry › shapes › builder › copy) · j (each joint 4:
// pivot xyz and kind (1 hinge, 2 wheel, 3 slider) · axis xyz, radius · its driver (0 none, 1 a rate, 2 a formula), the
// rate (rad or m a second), least, most (none: least ≥ most) · its part, the float of a record its clone's rate starts
// at (−1: the set's rate, a phase by the clone's seed), the set's offset (what a change of rate keeps), 0)
struct SI { a: vec4f, b: vec4f, c: vec4f, d: vec4f, j: array<vec4f, 32>, e: array<vec4f, 6> }
@group(0) @binding(2) var<uniform> si: SI;
@group(1) @binding(4) var recs: texture_2d<f32>;
// texel k of the record at texel r of the layer's records
fn recAt(r: f32, k: i32) -> vec4f {
  let a = i32(r + 0.5) + k;
  let w = i32(textureDimensions(recs, 0).x);
  return textureLoad(recs, vec2i(a % w, a / w), 0);
}
// the tile of the chunk in slot \`slot\` (the records' first row), with what its layer's block holds for every chunk
fn tileAt(slot: f32) {
  let s = i32(slot + 0.5) * 2;
  let a = textureLoad(recs, vec2i(s, 0), 0);
  let b = textureLoad(recs, vec2i(s + 1, 0), 0);
  t = T(a, vec4f(tb.v.x, tb.v.y, b.x, b.y), vec4f(tb.w.xyz, slot), vec4f(tb.l.x, tb.l.y, b.w, b.z));
}
// the share of its own size an instance of this scale keeps at p: within its set's range on screen (1: none set)
fn keepOf(scale: f32, p: vec3f) -> f32 {
  return select(1.0, sizeKeep(si.a.x * scale, vec4f(1.0, si.a.z, si.a.w, 0.0), p), si.a.y > 0.5);
}
// core › entities › kinematics: p turned by t radians round the unit axis a (Rodrigues)
fn rotAxis(p: vec3f, a: vec3f, t: f32) -> vec3f {
  let c = cos(t);
  return p * c + cross(a, p) * sin(t) + a * dot(a, p) * (1.0 - c);
}
// your formulas (a joint's value of the clock and the clone's seed; degrees, or metres for a slider)
fn jointFormula(k: i32, time: f32, seed: f32) -> f32 {
  /*@jointFormula*/
  return 0.0;
}
// a joint's value now (radians; a slider's metres): its driver's (a rate from the set's clock, its clone's own rate
// and phase, or your formula), within its limits
fn jointValue(k: i32, r: f32, seed: f32) -> f32 {
  let d = si.j[k * 4 + 2];
  let s = si.j[k * 4 + 3];
  var v = 0.0;
  if (d.x == 1.0) {
    var rate = d.y;
    var phase = seed * 6.2831853;
    if (s.y >= 0.0) {
      let q = recAt(r, i32(s.y + 0.5) / 4);
      let even = (i32(s.y + 0.5) % 4) == 0;
      rate = select(q.z, q.x, even);
      phase = select(q.w, q.y, even);
    }
    v = phase + rate * (frame.eye.w - si.c.x) + s.z;
  } else if (d.x == 2.0) {
    v = jointFormula(k, frame.eye.w, seed) * select(0.017453293, 1.0, si.j[k * 4].w == 3.0);
  }
  if (d.z < d.w) {
    v = clamp(v, d.z, d.w);
  }
  return v;
}
// the pivot of the first joint that moves part \`part\` (w: 1; 0: none moves it)
fn partPivot(part: i32) -> vec4f {
  if (part == 0) {
    return vec4f(0.0);
  }
  for (var k = 0; k < i32(si.c.y); k++) {
    if (i32(si.j[k * 4 + 3].x + 0.5) == part) {
      return vec4f(si.j[k * 4].xyz, 1.0);
    }
  }
  return vec4f(0.0);
}
// a vertex (q, its normal n) of part \`part\` moved by that part's joints: turned round the axis through the pivot (a
// hinge, a wheel), or slid along it
struct Moved { q: vec3f, n: vec3f }
fn jointMove(q: vec3f, n: vec3f, part: i32, r: f32, seed: f32) -> Moved {
  var m = Moved(q, n);
  if (part == 0) {
    return m;
  }
  for (var k = 0; k < i32(si.c.y); k++) {
    if (i32(si.j[k * 4 + 3].x + 0.5) != part) {
      continue;
    }
    let pv = si.j[k * 4];
    let ax = si.j[k * 4 + 1].xyz;
    let v = jointValue(k, r, seed);
    if (pv.w == 3.0) {
      m.q = m.q + ax * v;
    } else {
      m.q = pv.xyz + rotAxis(m.q - pv.xyz, ax, v);
      m.n = rotAxis(m.n, ax, v);
    }
  }
  return m;
}
`;

export const SOLID_INST_WGSL = /* wgsl */ `${SOLID_COMMON_WGSL}${SOLID_SET_WGSL}
struct I { @location(0) r: f32, @location(3) v: vec4f, @location(4) vc: f32, @location(5) card: f32 }
@vertex fn vs(i: I) -> O {
  let r0 = recAt(i.r, 0);
  let r1 = recAt(i.r, 1);
  let r2 = recAt(i.r, 2);
  tileAt(r2.w);
  // its code: a leaf card's, or its material, its own colour (256) and its piece (part + 16 × group) × 512
  let leafy = i.card >= 65536.0;
  let ci = select(i32(i.card + 0.5), 0, leafy);
  let lo = ci % 512;
  let piece = ci / 512;
  let mv = jointMove(i.v.xyz, unpackNormal(i.v.w), piece % 16, i.r, r2.z);
  let c = cos(r1.w);
  let s = sin(r1.w);
  let g = groundAt(r0.x, r0.y) * t.v.x + r0.z;
  // its set's range on screen: the share of its size it keeps where it stands (seen at its middle)
  let keep = keepOf(max(r1.x, r1.z), placeOf(r0.x, g + si.a.x * 0.5 * r1.y, r0.y));
  // its scale and stretch (a taller tower) on what stands still; a part a joint moves rides along, its pivot stretched
  // and itself only scaled (a rotor stays round)
  let pp = partPivot(piece % 16);
  let q = select(mv.q * r1.xyz, pp.xyz * r1.xyz + (mv.q - pp.xyz) * r1.x, pp.w > 0.5) * keep;
  let rr = vec3f(q.x * c - q.z * s, q.y, q.x * s + q.z * c);
  let h = g + rr.y;
  var position = placeOf(r0.x + rr.x, h, r0.y + rr.z);
  let n = select(mv.n / r1.xyz, mv.n, pp.w > 0.5);
  var o: O;
  // 256…511: a piece that keeps its own colour (its shape has tinted pieces: only they take the clone's); a group its
  // set tints takes its clone's colour for it
  var tint = unpackRGB(r2.x);
  var own = !leafy && lo >= 256;
  let grp = piece / 16;
  if (si.b.w > 0.5 && grp > 0 && grp <= 4) {
    let gt = recAt(i.r, 3)[grp - 1];
    if (gt >= 0.0) {
      tint = unpackRGB(gt);
      own = false;
    }
  }
  o.col = select(tint, vec3f(1.0, 1.0, 1.0), own) * unpackRGB(i.vc);
  let code = select(f32(lo % 256), i.card, leafy);
  o.n = vec3f(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  o.id = r0.w;
  // a card's code, or (below 65536) its material
  o.leaf = select(vec3f(0.0, 0.0, -code), unpackCard(i.card), leafy);
  if (o.leaf.z > 0.5) {
    o.leaf.z = o.leaf.z + 0.45 * clamp(1.0 - r2.y, 0.0, 1.0);
  }
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
