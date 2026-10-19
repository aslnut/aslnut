// A set of entities driven by data (core › entities › sets, drive › data): each thing's samples stay in columns on the
// chip (things: per thing its slots (start, count, capacity, head) and its look (colour, size); tcol: times, 16-bit
// steps two a texel or 32-bit floats; pcol: places, two 16-bit numbers within the box a texel or two 32-bit floats
// two places a texel; vcol: one value, a byte four a texel or a 32-bit float; acol: each sample's altitude, a value as
// vcol's, when the log keeps one: bound by the programs that read it by the sample, the trails and the pose pass), and
// the clock is a uniform. Each thing
// finds its sample at the time by a binary search over its slots (bounded: 24 steps, 16 million samples) once a change
// of the time, in a pass of its own (found: a texel a thing, j + 1 in three bytes; in the air, a second block of rows:
// its altitude now, 1 cm steps from −500 m in three bytes); its place is between that sample and the next. Three programs read them: the dots (a disc each, sized in CSS px), the
// trails (each thing's last pieces up to `window` seconds back, fading, `K` pieces a thing) and the shapes near the
// camera (a mesh instanced for each thing near enough to be seen as one, turned by its heading along its path; the
// dots give way to them). The ground under them: a grid of heights round the view and one over the whole set. A thing
// in the air (its log's altitude) stands that far over what it stands on, or over the sea; its shape turned by its
// pose (its pitch and its bank, found once a change of the time for the things drawn as shapes, in a pass of its own:
// pose, a texel a thing, each angle in 16 bits), its contact shadow on the ground under it, shrinking and fading with
// height.
//   S: clock (time s from the log's epoch, window s, pieces a thing, head glow) · origin (the log's origin − the
//   view's centre: radians of longitude, Mercator y; exaggeration; lift m) · box (u16 places: x0, y0, width, height)
//   · gridA / gridB (the whole set's grid and the view's: x0, y0, 1 / width, 1 / height) · style (dot px, outline px,
//   opacity, depth bias) · color · outline · trail (px, opacity, lift px, own colour) · trailColor · value (the
//   column's domain lo, hi; the ramp's lo, hi) · near (the shapes' distance m, scale, shown, the seconds a turn takes)
//   · misc (u16 time step s, pick number, things, hold before the first sample) · grid (the whole set's grid read, the
//   view's read, 0, 0) · sz (a size from the value: its domain lo, hi; the sizes px lo, hi) · fx (the trail's fade: its
//   power, the metres the gauge shows through, the gauge's domain lo, hi) · gauge (width, height px; metres over the ground; seen within m) · gaugeLo /
//   gaugeMid / gaugeHi (its colours, empty → full) · gaugeLine (its outline) · glyph (the label's glyphs, in label
//   heights: a digit's advance, the per cent sign's, the pad before a glyph in its cell, a cell's width) · labelText
//   (its colour; w: its height, CSS px) · labelHalo (its halo's colour) · shadow (the shapes' contact shadow: its
//   half width, half length (m, with its spread), its middle's x, z) · shadowLook (its opacity, its core: the share of
//   it fully dark, 0, 0) · dotSize (how a dot's size is drawn: units, the least and the most CSS px) · shapeSize (the
//   shapes' range on screen: their size across m, the least and the most CSS px, 1 when set: core › render › drawing ›
//   size) · pc (the shapes' joints, the clock their rates count from, 0, 0) · parts (each joint 4: pivot xyz and kind,
//   axis xyz and radius, its driver (0 none, 1 a rate, 2 a formula, 3 a log value: jcol), rate (a log value's: its
//   factor), least, most, its part, 0, the offset a change of rate keeps, 0: core › entities › kinematics) · link (its links: width px, rise m (0: a quarter of their length), the
//   faint opacity, a focused one's) · linkColor · linkMore (pieces a link; the width's units, least, most px) · air
//   (the altitude's domain lo, hi: a byte's; 0, 0) · att (its pose: the seconds it eases over either side, the most
//   pitch and bank rad, the height over the ground it banks fully from m) · pivot (what its shape turns about, m: x, y, z, 0) · attv (its pitch's and its bank's
//   columns' domains: lo, hi, lo, hi)
//   shadowLook.z, .w: the height its shadow has faded away by (m; 0: it never fades), the height past which it has none
//   (m; 0: none)
// Twin: sets.glsl.ts.
import { FRAME_WGSL } from './frame.wgsl.ts';
import { SHAPE_FNS_WGSL } from './shape-fns.wgsl.ts';

/** what a set's programs are built for: its columns' types, the colour's source, the slots a texture row holds and
 *  the ground grid's side (pay only for what is set: the rest is compiled out) */
export interface SetsVariant { time: 'u16' | 'f32'; place: 'u16' | 'f32'; value: 'none' | 'u8' | 'f32'; color: 'one' | 'thing' | 'ramp'; size: 'one' | 'thing' | 'value'; row: number; grid: number; /** the gauge's label (its value in per cent) */ label?: boolean; /** its value a step (the log value's step): held from each sample to the next */ step?: boolean; /** the log value its shapes' joints read (a 32-bit column; none: no joint reads one) */ joint?: 'none' | 'f32'; /** the shapes' joints' formulas, as the jointFormula's body (WGSL, GLSL) */ formula?: { wgsl: string; glsl: string }; /** its things fold into others for a while (a relation's windows: core › entities › placement): hidden then */ fold?: boolean; /** each sample's altitude (its column's type; none: on the ground) and what it is over (default the ground) */ alt?: 'u8' | 'f32'; over?: 'ground' | 'sea'; /** its shapes turned by their pose (the pose pass: where the pitch and the bank come from, their path or a column of the log's) */ pose?: { pitch: 'none' | 'climb' | 'u8' | 'f32'; bank: 'none' | 'turn' | 'u8' | 'f32' } }
/** the textures every program of a set reads (group 1, bindings 0 … 6), in order; a program's own come after them (a
 *  card placed on its things already reads 16 textures: the most a stage may on WebGPU by default) */
export const SET_TEXTURES = ['things', 'tcol', 'pcol', 'vcol', 'ground', 'ramp', 'found'] as const;
/** the first binding of a program's own textures (after the set's) */
const B = SET_TEXTURES.length;

/** the programs that read the altitude by the sample (its column at binding 7, their first own) */
const BY_SAMPLE = new Set(['trails', 'pose', 'found']);
const head = (v: SetsVariant, kind = '') => /* wgsl */ `${FRAME_WGSL}
const TIME16: i32 = ${v.time === 'u16' ? 1 : 0};
const PLACE16: i32 = ${v.place === 'u16' ? 1 : 0};
const VALUE: i32 = ${v.value === 'u8' ? 1 : v.value === 'f32' ? 2 : 0};
const STEP: i32 = ${v.step ? 1 : 0};
const COLOR: i32 = ${v.color === 'ramp' ? 2 : v.color === 'thing' ? 1 : 0};
const SIZE: i32 = ${v.size === 'value' ? 2 : v.size === 'thing' ? 1 : 0};
const ROW: i32 = ${v.row};
const GRID: i32 = ${v.grid};
const FOLD: i32 = ${v.fold ? 1 : 0};
const ALT: i32 = ${v.alt === 'u8' ? 1 : v.alt === 'f32' ? 2 : 0};
const OVER_SEA: i32 = ${v.alt && v.over === 'sea' ? 1 : 0};
struct S { clock: vec4f, origin: vec4f, box: vec4f, gridA: vec4f, gridB: vec4f, style: vec4f, color: vec4f, outline: vec4f, trail: vec4f, trailColor: vec4f, value: vec4f, near: vec4f, misc: vec4f, grid: vec4f, sz: vec4f, fx: vec4f, gauge: vec4f, gaugeLo: vec4f, gaugeMid: vec4f, gaugeHi: vec4f, gaugeLine: vec4f, glyph: vec4f, labelText: vec4f, labelHalo: vec4f, shadow: vec4f, shadowLook: vec4f, dotSize: vec4f, shapeSize: vec4f, pc: vec4f, parts: array<vec4f, 32>, link: vec4f, linkColor: vec4f, linkMore: vec4f, air: vec4f, att: vec4f, pivot: vec4f, attv: vec4f }
@group(0) @binding(1) var<uniform> s: S;
@group(1) @binding(0) var things: texture_2d<f32>;
@group(1) @binding(1) var tcol: texture_2d<f32>;
@group(1) @binding(2) var pcol: texture_2d<f32>;
@group(1) @binding(3) var vcol: texture_2d<f32>;
@group(1) @binding(4) var ground: texture_2d<f32>;
@group(1) @binding(5) var ramp: texture_2d<f32>;
@group(1) @binding(6) var found: texture_2d<f32>;
${v.alt && BY_SAMPLE.has(kind) ? `@group(1) @binding(${B}) var acol: texture_2d<f32>;` : ''}
const PI = 3.141592653589793;
const RE = 6378137.0;
${SHAPE_FNS_WGSL}
`;
const COMMON = /* wgsl */ `
fn s2(a: f32) -> f32 {
  let h = sin(a * 0.5);
  return 2.0 * h * h;
}
// a place → world metres from the view centre (y up), on the globe and flat, by the morph (as the point mark)
fn placeAt(rel: vec2f, h: f32) -> vec3f {
  let dl = s.origin.x + rel.x;
  let dm = s.origin.y + rel.y;
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
fn behindGlobe(p: vec3f) -> bool {
  return frame.size.w < 0.5 && dot(p - vec3f(0.0, -RE, 0.0), frame.eye.xyz - p) < 0.0;
}
// moved along the line to the eye by half of px: the same place on screen, in front of the ground under it
fn towardEye(p: vec3f, px: f32) -> vec3f {
  let toEye = frame.eye.xyz - p;
  let d = length(toEye);
  let mpp = 2.0 * d * frame.misc.z / frame.size.y;
  return p + toEye / max(d, 0.001) * min(px * frame.size.z * 0.5 * mpp, d * 0.5);
}
// a quad's four corners (two triangles by the index: 0 1 2 · 2 1 3)
fn cornerOf(v: i32) -> vec2f {
  let x = select(-1.0, 1.0, v == 1 || v == 3);
  let y = select(-1.0, 1.0, v >= 2);
  return vec2f(x, y);
}
// a thing's slots: (first slot, samples, slots, the slot of its oldest sample)
fn metaOf(e: i32) -> vec4f {
  let i = e * 2;
  return textureLoad(things, vec2i(i % 4096, i / 4096), 0);
}
// its look: (colour 0xRRGGBB, dot px; 0: the set's)
fn lookOf(e: i32) -> vec4f {
  let i = e * 2 + 1;
  return textureLoad(things, vec2i(i % 4096, i / 4096), 0);
}
// the slot of its j-th sample (0: its oldest; a ring once it holds as many as it keeps); a live group's member
// (m.z = −(slots + 8192 × the group's size)): its samples interleaved with the group's, one row of the ring each
fn slotOf(m: vec4f, j: i32) -> i32 {
  if (m.z < 0.0) {
    let v = i32(-m.z);
    return i32(m.x) + ((i32(m.w) + j) % max(v % 8192, 1)) * (v / 8192);
  }
  let cap = max(i32(m.z), 1);
  return i32(m.x) + (i32(m.w) + j) % cap;
}
fn tAt(sl: i32) -> f32 {
  let col = sl % ROW;
  let row = sl / ROW;
  if (TIME16 == 1) {
    let b = round(textureLoad(tcol, vec2i(col / 2, row), 0) * 255.0);
    let p = select(b.zw, b.xy, col % 2 == 0);
    return (p.x + p.y * 256.0) * s.misc.x;
  }
  return textureLoad(tcol, vec2i(col, row), 0).x;
}
fn relAt(sl: i32) -> vec2f {
  let col = sl % ROW;
  let row = sl / ROW;
  if (PLACE16 == 1) {
    let b = round(textureLoad(pcol, vec2i(col, row), 0) * 255.0);
    let q = vec2f(b.x + b.y * 256.0, b.z + b.w * 256.0) / 65535.0;
    return s.box.xy + q * s.box.zw;
  }
  let f = textureLoad(pcol, vec2i(col / 2, row), 0);
  return select(f.zw, f.xy, col % 2 == 0);
}
fn valueAt(sl: i32) -> f32 {
  let col = sl % ROW;
  let row = sl / ROW;
  if (VALUE == 1) {
    let b = textureLoad(vcol, vec2i(col / 4, row), 0);
    let c = col % 4;
    let v = select(select(select(b.w, b.z, c == 2), b.y, c == 1), b.x, c == 0);
    return s.value.x + v * (s.value.y - s.value.x);
  }
  if (VALUE == 2) {
    return textureLoad(vcol, vec2i(col, row), 0).x;
  }
  return 0.0;
}
// its sample at or before t (-1: before its first): a binary search over its slots, 24 steps at most
fn sampleAt(m: vec4f, t: f32) -> i32 {
  let n = i32(m.y);
  if (n <= 0) {
    return -1;
  }
  if (t < tAt(slotOf(m, 0))) {
    return -1;
  }
  var lo = 0;
  var hi = n - 1;
  if (t >= tAt(slotOf(m, hi))) {
    return hi;
  }
  for (var k = 0; k < 24; k++) {
    if (hi - lo <= 1) {
      break;
    }
    let mid = (lo + hi) / 2;
    if (tAt(slotOf(m, mid)) <= t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}
// its sample at the time as the found pass wrote it (j + 1 in three bytes; 0: before its first)
fn jOf(e: i32) -> i32 {
  let b = round(textureLoad(found, vec2i(e % 4096, e / 4096), 0) * 255.0);
  return i32(b.x + b.y * 256.0 + b.z * 65536.0) - 1;
}
// its slots as the drawings read them: none while it is folded into another (a relation's window holds it now: the
// found pass's alpha), so every drawing of it (its dot, trail, shape, gauge, link, a card or an icon placed on it) hides
fn liveOf(e: i32) -> vec4f {
  var m = metaOf(e);
  if (FOLD == 1) {
    if (textureLoad(found, vec2i(e % 4096, e / 4096), 0).a < 0.5) {
      m.y = 0.0;
    }
  }
  return m;
}
// where it is at t: its place (xy), its sample before (z; -1 before its first), how far on to the next (w)
fn whereAt(m: vec4f, j: i32, t: f32) -> vec4f {
  let n = i32(m.y);
  let sa = slotOf(m, max(j, 0));
  if (j < 0 || j >= n - 1) {
    let p = relAt(sa);
    return vec4f(p, f32(j), 0.0);
  }
  let sb = slotOf(m, j + 1);
  let ta = tAt(sa);
  let tb = tAt(sb);
  let f = select(0.0, clamp((t - ta) / (tb - ta), 0.0, 1.0), tb > ta);
  return vec4f(mix(relAt(sa), relAt(sb), f), f32(j), f);
}
fn valueBetween(m: vec4f, j: i32, f: f32) -> f32 {
  if (VALUE == 0) {
    return 0.0;
  }
  let n = i32(m.y);
  let a = clamp(j, 0, max(n - 1, 0));
  let b = min(a + 1, max(n - 1, 0));
  // (a step: held from its sample to the next, never through the values between)
  if (STEP == 1) {
    return valueAt(slotOf(m, a));
  }
  return mix(valueAt(slotOf(m, a)), valueAt(slotOf(m, b)), f);
}
// the ground: two GRID × GRID levels in one texture (rows 0…: the whole set's box; GRID…: round the view), metres
fn gLoad(x: i32, y: i32) -> f32 {
  return textureLoad(ground, vec2i(clamp(x, 0, GRID - 1), clamp(y, 0, 2 * GRID - 1)), 0).x;
}
fn gLevel(uv: vec2f, base: i32) -> f32 {
  let g = clamp(uv, vec2f(0.0), vec2f(1.0)) * f32(GRID - 1);
  let i = vec2i(floor(g));
  let f = g - vec2f(i);
  let x1 = min(i.x + 1, GRID - 1);
  let y1 = min(i.y + 1, GRID - 1);
  let a = mix(gLoad(i.x, base + i.y), gLoad(x1, base + i.y), f.x);
  let b = mix(gLoad(i.x, base + y1), gLoad(x1, base + y1), f.x);
  return mix(a, b, f.y);
}
fn groundAt(rel: vec2f) -> f32 {
  let b = (rel - s.gridB.xy) * s.gridB.zw;
  if (s.grid.y > 0.5 && b.x >= 0.0 && b.y >= 0.0 && b.x <= 1.0 && b.y <= 1.0) {
    return gLevel(b, GRID);
  }
  if (s.grid.x > 0.5) {
    return gLevel((rel - s.gridA.xy) * s.gridA.zw, 0);
  }
  return 0.0;
}
fn heightAt(rel: vec2f) -> f32 {
  return groundAt(rel) * s.origin.z + s.origin.w;
}
// its altitude at a slot (m: a byte over its domain, or a 32-bit float; read by the programs that bind its column)
fn altAt(sl: i32) -> f32 {
  /*@altAt*/
  return 0.0;
}
// its altitude between its samples (j the one before, f how far on: as its place)
fn altBetween(m: vec4f, j: i32, f: f32) -> f32 {
  if (ALT == 0) {
    return 0.0;
  }
  let n = i32(m.y);
  let a = clamp(j, 0, max(n - 1, 0));
  let b = min(a + 1, max(n - 1, 0));
  return mix(altAt(slotOf(m, a)), altAt(slotOf(m, b)), f);
}
// how far on from sample j to the next it is at t (0 before its first, after its last)
fn timeShare(m: vec4f, j: i32, t: f32) -> f32 {
  let n = i32(m.y);
  if (j < 0 || j >= n - 1) {
    return 0.0;
  }
  let ta = tAt(slotOf(m, j));
  let tb = tAt(slotOf(m, j + 1));
  return select(0.0, clamp((t - ta) / (tb - ta), 0.0, 1.0), tb > ta);
}
// its altitude now (m), as the found pass wrote it (its second block of rows: 1 cm steps from −500 m); none: 0
fn altNow(e: i32) -> f32 {
  if (ALT == 0) {
    return 0.0;
  }
  let rows = (i32(s.misc.z) + 4095) / 4096;
  let b = round(textureLoad(found, vec2i(e % 4096, rows + e / 4096), 0) * 255.0);
  return (b.x + b.y * 256.0 + b.z * 65536.0) * 0.01 - 500.0;
}
// how far it is over what it stands on (m): its altitude over the ground; over the sea, its height over the ground
// under it (never under it); on the ground, none
fn clearOf(rel: vec2f, alt: f32) -> f32 {
  if (ALT == 0) {
    return 0.0;
  }
  if (OVER_SEA == 1) {
    return max(alt - groundAt(rel), 0.0);
  }
  return max(alt, 0.0);
}
// its height (m): the ground under it (exaggerated) and its lift, and as far over it as it flies
fn heightOf(rel: vec2f, alt: f32) -> f32 {
  return heightAt(rel) + clearOf(rel, alt);
}
fn rampAt(v: f32) -> vec4f {
  let t = clamp((v - s.value.z) / max(s.value.w - s.value.z, 1e-9), 0.0, 1.0);
  return textureLoad(ramp, vec2i(i32(t * 255.0 + 0.5), 0), 0);
}
fn colourOf(look: vec4f, v: f32) -> vec4f {
  if (COLOR == 2) {
    return rampAt(v);
  }
  if (COLOR == 1) {
    return vec4f(unpackRGB(look.x), 1.0);
  }
  return s.color;
}
// a gauge's colour at f (0 empty … 1 full): low → middle → high
fn gaugeColour(f: f32) -> vec3f {
  return select(mix(s.gaugeMid.rgb, s.gaugeHi.rgb, f * 2.0 - 1.0), mix(s.gaugeLo.rgb, s.gaugeMid.rgb, f * 2.0), f < 0.5);
}
// its dot's size (CSS px): one for all, its own, or its value over time (its domain → a range of sizes)
fn sizeOf(look: vec4f, v: f32) -> f32 {
  if (SIZE == 2) {
    let t = clamp((v - s.sz.x) / max(s.sz.y - s.sz.x, 1e-9), 0.0, 1.0);
    return mix(s.sz.z, s.sz.w, t);
  }
  if (SIZE == 1) {
    return look.y;
  }
  return s.style.x;
}
fn angleDiff(a: f32, b: f32) -> f32 {
  let d = b - a;
  return d - 2.0 * PI * floor((d + PI) / (2.0 * PI));
}
// the heading along its k-th piece (radians clockwise from north); where it stands, the piece before (6 back)
fn pieceHeading(m: vec4f, k: i32) -> f32 {
  let n = i32(m.y);
  for (var back = 0; back < 6; back++) {
    let i = k - back;
    if (i >= 0 && i + 1 < n) {
      let d = relAt(slotOf(m, i + 1)) - relAt(slotOf(m, i));
      if (dot(d, d) > 1e-20) {
        return atan2(d.x, d.y);
      }
    }
  }
  return 0.0;
}
// its heading at t: along its piece, turning through each corner over near.w seconds (half before it, half after)
fn headingAt(m: vec4f, j: i32, t: f32) -> f32 {
  let n = i32(m.y);
  let k = clamp(j, 0, max(n - 2, 0));
  let h = pieceHeading(m, k);
  if (s.near.w <= 0.0 || n < 3) {
    return h;
  }
  let ta = tAt(slotOf(m, k));
  let tb = tAt(slotOf(m, k + 1));
  let tau = min(s.near.w, max(tb - ta, 0.001) * 0.5);
  if (k > 0 && t - ta < tau) {
    let h0 = pieceHeading(m, k - 1);
    return h0 + angleDiff(h0, h) * (0.5 + 0.5 * clamp((t - ta) / tau, 0.0, 1.0));
  }
  if (k + 2 < n && tb - t < tau) {
    let h1 = pieceHeading(m, k + 1);
    return h + angleDiff(h, h1) * 0.5 * (1.0 - clamp((tb - t) / tau, 0.0, 1.0));
  }
  return h;
}
`;
const DOTS = /* wgsl */ `
struct O { @builtin(position) pos: vec4f, @location(0) corner: vec2f, @location(1) col: vec4f, @location(2) @interpolate(flat) id: f32, @location(3) size: f32 }
@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> O {
  let e = i32(iid);
  let m = liveOf(e);
  let look = lookOf(e);
  let w = whereAt(m, jOf(e), s.clock.x);
  let j = i32(w.z);
  let v = valueBetween(m, j, w.w);
  let corner = cornerOf(i32(vid));
  let p = placeAt(w.xy, heightOf(w.xy, altNow(e)));
  let size = sizePx(sizeOf(look, v), s.dotSize, p);
  let on = select(0.0, 1.0, j >= 0 || s.misc.w > 0.5);
  let d = length(frame.eye.xyz - p);
  // drawn as a shape (its look's flag, set when the shapes are chosen): its dot gives way
  let give = select(1.0, 0.0, look.z > 0.5);
  let c = colourOf(look, v);
  let lifted = towardEye(p, size);
  let clip = frame.viewProj * vec4f(lifted, 1.0);
  let off = corner * size * frame.size.z / frame.size.xy * clip.w;
  let hide = on < 0.5 || give <= 0.0 || m.y < 1.0 || behindGlobe(p);
  var o: O;
  o.pos = select(clipOut(vec4f(clip.xy + off, clip.z - s.style.w * clip.w, clip.w)), vec4f(2.0, 2.0, 2.0, 1.0), hide);
  o.corner = corner;
  o.col = vec4f(c.rgb, c.a * give);
  o.id = f32(e);
  o.size = size * frame.size.z;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let r = length(i.corner);
  let px = 2.0 / max(i.size, 1.0);
  let disc = 1.0 - smoothstep(1.0 - px, 1.0, r);
  let ring = select(0.0, smoothstep(1.0 - px * (s.style.y + 1.0), 1.0 - px * s.style.y, r), s.style.y > 0.0);
  let rgb = mix(i.col.rgb, s.outline.rgb, ring * s.outline.a);
  let alpha = i.col.a * disc * s.style.z;
  if (alpha <= 0.002) {
    discard;
  }
  if (frame.pick.x > 0.5) {
    return pickOut(s.misc.y, i.id);
  }
  return vec4f(themed(rgb, 0.0), alpha);
}
`;
const TRAILS = /* wgsl */ `
struct O { @builtin(position) pos: vec4f, @location(0) col: vec4f, @location(1) side: f32, @location(2) px: f32 }
@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> O {
  let K = max(i32(s.clock.z), 1);
  let e = i32(iid) / K;
  let seg = i32(iid) - e * K;
  let cs = cornerOf(i32(vid));
  let m = liveOf(e);
  let look = lookOf(e);
  let n = i32(m.y);
  let t = s.clock.x;
  let tt = t - s.clock.y;
  let j = jOf(e);
  var o: O;
  o.side = cs.y;
  o.px = 1.0;
  o.col = vec4f(0.0);
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  // nothing here: before its first sample, older than its first, or older than the window (most pieces, most frames)
  if (j < 0 || j - seg < 0 || m.y < 1.0) {
    return o;
  }
  if (seg > 0 && tAt(slotOf(m, j - seg + 1)) <= tt) {
    return o;
  }
  let ia = max(j - seg, 0);
  let sa = slotOf(m, ia);
  var ta = tAt(sa);
  var pa = relAt(sa);
  var va = valueAt(sa);
  var aa = altAt(sa);
  var pb = pa;
  var tb = ta;
  var vb = va;
  var ab = aa;
  if (seg == 0) {
    if (j < n - 1) {
      let sn = slotOf(m, j + 1);
      let t1 = tAt(sn);
      let f = select(0.0, clamp((t - ta) / (t1 - ta), 0.0, 1.0), t1 > ta);
      pb = mix(pa, relAt(sn), f);
      tb = mix(ta, t1, f);
      vb = mix(va, valueAt(sn), f);
      ab = mix(aa, altAt(sn), f);
    }
  } else {
    let sb = slotOf(m, ia + 1);
    pb = relAt(sb);
    tb = tAt(sb);
    vb = valueAt(sb);
    ab = altAt(sb);
  }
  // (a step: the piece's value its first sample's, to the next)
  if (STEP == 1) {
    vb = va;
  }
  var ok = j >= 0 && j - seg >= 0 && tb > tt && (distance(pa, pb) > 1e-12 || abs(ab - aa) > 0.01);
  if (ta < tt && tb > ta) {
    let f = (tt - ta) / (tb - ta);
    pa = mix(pa, pb, f);
    va = mix(va, vb, f);
    aa = mix(aa, ab, f);
    ta = tt;
  }
  let end = cs.x;
  let side = cs.y;
  let A = towardEye(placeAt(pa, heightOf(pa, aa)), s.trail.z);
  let B = towardEye(placeAt(pb, heightOf(pb, ab)), s.trail.z);
  var ca = frame.viewProj * vec4f(A, 1.0);
  var cb = frame.viewProj * vec4f(B, 1.0);
  let nearW = 0.01;
  if (ca.w < nearW && cb.w < nearW) {
    ok = false;
  }
  if (ca.w < nearW) {
    ca = mix(ca, cb, (nearW - ca.w) / (cb.w - ca.w));
  }
  if (cb.w < nearW) {
    cb = mix(cb, ca, (nearW - cb.w) / (ca.w - cb.w));
  }
  let halfPx = frame.size.xy * 0.5;
  let sa2 = ca.xy / ca.w * halfPx;
  let sb2 = cb.xy / cb.w * halfPx;
  var dir = sb2 - sa2;
  let len = length(dir);
  dir = select(vec2f(1.0, 0.0), dir / len, len > 1e-6);
  let nrm = vec2f(-dir.y, dir.x);
  let w2 = s.trail.x * frame.size.z * 0.5 + 0.5;
  let c = select(ca, cb, end > 0.0);
  let offPx = nrm * side * w2 + dir * end * w2;
  let clip = vec4f(c.xy + offPx / halfPx * c.w, c.z - s.style.w * c.w, c.w);
  let age = clamp((select(ta, tb, end > 0.0) - tt) / max(s.clock.y, 0.001), 0.0, 1.0);
  let col = select(colourOf(look, select(va, vb, end > 0.0)), s.trailColor, s.trail.w > 0.5);
  let glow = s.clock.w * smoothstep(0.85, 1.0, age);
  let hide = !ok || m.y < 1.0 || behindGlobe(select(A, B, end > 0.0));
  o.pos = select(clipOut(clip), vec4f(2.0, 2.0, 2.0, 1.0), hide);
  o.col = vec4f(mix(col.rgb, vec3f(1.0), glow * 0.5), col.a * s.trail.y * pow(age, s.fx.x));
  o.side = side;
  o.px = w2;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let edge = 1.0 - smoothstep(1.0 - 1.0 / max(i.px, 1.0), 1.0, abs(i.side));
  let alpha = i.col.a * edge;
  if (alpha <= 0.002) {
    discard;
  }
  return vec4f(themed(i.col.rgb, 0.0), alpha);
}
`;
const LINKS = /* wgsl */ `
// each thing's link (core › entities › placement: a reference read on the chip): an arc from where it is now (its
// track at the clock, as its dot) to its own place (links: the place, its height m, 1 when it has one), rising to
// link.y m at its middle (0: a quarter of its length); faint (link.z) but for a thing focused (hovered, selected: its
// look's w) at link.w; SEG pieces a link (linkMore.x), drawn as the trails are
@group(1) @binding(${B}) var links: texture_2d<f32>;
struct O { @builtin(position) pos: vec4f, @location(0) col: vec4f, @location(1) side: f32, @location(2) px: f32 }
// a link's point at u (0 the thing, at its height ha; 1 its place, at hb): between them, risen by the arc
fn linkAt(a: vec2f, b: vec2f, ha: f32, hb: f32, rise: f32, u: f32) -> vec3f {
  let p = mix(a, b, u);
  return towardEye(placeAt(p, mix(ha, hb, u) + rise * 4.0 * u * (1.0 - u)), 1.5);
}
@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> O {
  let SEG = max(i32(s.linkMore.x), 1);
  let e = i32(iid) / SEG;
  let k = i32(iid) - e * SEG;
  let cs = cornerOf(i32(vid));
  let m = liveOf(e);
  let look = lookOf(e);
  let L = textureLoad(links, vec2i(e % 4096, e / 4096), 0);
  let w = whereAt(m, jOf(e), s.clock.x);
  let j = i32(w.z);
  var o: O;
  o.side = cs.y;
  o.px = 1.0;
  o.col = vec4f(0.0);
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  if (L.w < 0.5 || m.y < 1.0 || (j < 0 && s.misc.w < 0.5)) {
    return o;
  }
  let span = length((L.xy - w.xy) * vec2f(RE * frame.misc.y, RE * frame.misc.y));
  let rise = select(min(span * 0.25, 400.0), s.link.y, s.link.y > 0.0);
  let hb = L.z * s.origin.z;
  let ha = heightOf(w.xy, altNow(e));
  let A = linkAt(w.xy, L.xy, ha, hb, rise, f32(k) / f32(SEG));
  let B = linkAt(w.xy, L.xy, ha, hb, rise, f32(k + 1) / f32(SEG));
  var ca = frame.viewProj * vec4f(A, 1.0);
  var cb = frame.viewProj * vec4f(B, 1.0);
  if (ca.w < 0.01 || cb.w < 0.01) {
    return o;
  }
  let halfPx = frame.size.xy * 0.5;
  let sa2 = ca.xy / ca.w * halfPx;
  let sb2 = cb.xy / cb.w * halfPx;
  var dir = sb2 - sa2;
  let len = length(dir);
  dir = select(vec2f(1.0, 0.0), dir / len, len > 1e-6);
  let nrm = vec2f(-dir.y, dir.x);
  let w2 = sizePx(s.link.x, s.linkMore.yzwx * vec4f(1.0, 1.0, 1.0, 0.0), A) * frame.size.z * 0.5 + 0.5;
  let end = cs.x;
  let c = select(ca, cb, end > 0.0);
  let offPx = nrm * cs.y * w2 + dir * end * w2;
  o.pos = clipOut(vec4f(c.xy + offPx / halfPx * c.w, c.z - s.style.w * c.w, c.w));
  let focus = look.w > 0.5;
  o.col = vec4f(s.linkColor.rgb, s.linkColor.a * select(s.link.z, s.link.w, focus) * s.style.z);
  o.px = w2;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let edge = 1.0 - smoothstep(1.0 - 1.0 / max(i.px, 1.0), 1.0, abs(i.side));
  let alpha = i.col.a * edge;
  if (alpha <= 0.002) {
    discard;
  }
  return vec4f(themed(i.col.rgb, 0.0), alpha);
}
`;
const MODELS = /* wgsl */ `
/*@jointColumnBinding*/
/*@poseBinding*/
// its pose as the pose pass found it (pitch, bank: radians; 16 bits each): none, level
fn poseOf(e: i32) -> vec2f {
  /*@poseOf*/
  return vec2f(0.0, 0.0);
}
// p turned by its pose: its bank round its length (its right side down in a right turn), then its pitch round its width
// (its nose up)
fn attitude(p: vec3f, pb: vec2f) -> vec3f {
  let cb = cos(pb.y);
  let sb = sin(pb.y);
  let b = vec3f(p.x * cb - p.y * sb, p.x * sb + p.y * cb, p.z);
  let cp = cos(pb.x);
  let sp = sin(pb.x);
  return vec3f(b.x, b.y * cp + b.z * sp, b.z * cp - b.y * sp);
}
// the log value a joint reads (its column: a 32-bit float a slot), at a slot
fn jointColumnAt(sl: i32) -> f32 {
  /*@jointColumnAt*/
  return 0.0;
}
// that value at the time: between the samples either side, as its place (core › entities › drive › data)
fn jointColumn(m: vec4f, j: i32, f: f32) -> f32 {
  let n = i32(m.y);
  let a = clamp(j, 0, max(n - 1, 0));
  let b = min(a + 1, max(n - 1, 0));
  return mix(jointColumnAt(slotOf(m, a)), jointColumnAt(slotOf(m, b)), select(f, 0.0, j < 0));
}
// core › entities › kinematics (the shapes' parts): p turned by t radians round the unit axis a (Rodrigues)
fn rotAxis(p: vec3f, a: vec3f, t: f32) -> vec3f {
  let c = cos(t);
  return p * c + cross(a, p) * sin(t) + a * dot(a, p) * (1.0 - c);
}
// your formulas (a joint's value of the clock and the thing's seed; degrees, or metres for a slider)
fn jointFormula(k: i32, time: f32, seed: f32) -> f32 {
  /*@jointFormula*/
  return 0.0;
}
// a joint's value now (radians; a slider's metres): the set's rate from its clock (each thing's phase by its seed, an
// offset a change of rate keeps), your formula, or its log value × its factor (a wheel: metres it rolled, turned by
// its radius; a hinge: degrees; a slider: metres); within its limits (parts: each joint 4 texels, as an instance set's)
fn jointValue(k: i32, seed: f32, m: vec4f, j: i32, f: f32) -> f32 {
  let d = s.parts[k * 4 + 2];
  let kind = s.parts[k * 4].w;
  var v = 0.0;
  if (d.x == 1.0) {
    v = seed * 6.2831853 + d.y * (frame.eye.w - s.pc.y) + s.parts[k * 4 + 3].z;
  } else if (d.x == 2.0) {
    v = jointFormula(k, frame.eye.w, seed) * select(0.017453293, 1.0, kind == 3.0);
  } else if (d.x == 3.0) {
    let u = jointColumn(m, j, f) * d.y;
    v = select(select(u * 0.017453293, u / max(s.parts[k * 4 + 1].w, 0.001), kind == 2.0), u, kind == 3.0);
  }
  if (d.z < d.w) {
    v = clamp(v, d.z, d.w);
  }
  return v;
}
// a vertex (q, its normal n) of part \`part\` moved by that part's joints
struct Moved { q: vec3f, n: vec3f }
fn jointMove(q: vec3f, n: vec3f, part: i32, seed: f32, m: vec4f, j: i32, f: f32) -> Moved {
  var mv = Moved(q, n);
  if (part == 0) {
    return mv;
  }
  for (var k = 0; k < i32(s.pc.x); k++) {
    if (i32(s.parts[k * 4 + 3].x + 0.5) != part) {
      continue;
    }
    let pv = s.parts[k * 4];
    let ax = s.parts[k * 4 + 1].xyz;
    let v = jointValue(k, seed, m, j, f);
    if (pv.w == 3.0) {
      mv.q = mv.q + ax * v;
    } else {
      mv.q = pv.xyz + rotAxis(mv.q - pv.xyz, ax, v);
      mv.n = rotAxis(mv.n, ax, v);
    }
  }
  return mv;
}
struct I { @builtin(vertex_index) vid: u32, @location(0) ent: f32, @location(3) v: vec4f, @location(4) vc: f32, @location(5) card: f32 }
struct O { @builtin(position) pos: vec4f, @location(0) col: vec3f, @location(1) n: vec3f, @location(2) @interpolate(flat) id: f32 }
@vertex fn vs(i: I) -> O {
  let e = i32(i.ent + 0.5);
  let m = liveOf(e);
  let look = lookOf(e);
  let t = s.clock.x;
  let w = whereAt(m, jOf(e), t);
  let j = i32(w.z);
  let p = placeAt(w.xy, heightOf(w.xy, altNow(e)) - s.origin.w);
  let d = length(frame.eye.xyz - p);
  let a = headingAt(m, j, t) + PI;
  let c = cos(a);
  let sn = sin(a);
  let keep = select(1.0, sizeKeep(s.shapeSize.x * s.near.y, vec4f(1.0, s.shapeSize.y, s.shapeSize.z, 0.0), p), s.shapeSize.w > 0.5);
  // its code: its material, its own colour (256), its piece (part + 16 × group) × 512; its part moved by its joints
  let ci = select(i32(i.card + 0.5), 0, i.card >= 65536.0);
  let mv = jointMove(i.v.xyz, unpackNormal(i.v.w), (ci / 512) % 16, fract(f32(e) * 0.6180339887), m, j, w.w);
  var q = mv.q * s.near.y * keep;
  var n = mv.n;
  // (in the air: turned by its pose about its pivot)
  let pb = poseOf(e);
  if (pb.x != 0.0 || pb.y != 0.0) {
    let pv = s.pivot.xyz * s.near.y * keep;
    q = pv + attitude(q - pv, pb);
    n = attitude(n, pb);
  }
  let r = vec3f(q.x * c - q.z * sn, q.y, q.x * sn + q.z * c);
  let hide = (j < 0 && s.misc.w < 0.5) || m.y < 1.0;
  var o: O;
  o.pos = select(clipOut(frame.viewProj * vec4f(p + r, 1.0)), vec4f(2.0, 2.0, 2.0, 1.0), hide);
  o.n = vec3f(n.x * c - n.z * sn, n.y, n.x * sn + n.z * c);
  let own = i.card < 65536.0 && (ci % 512) >= 256;
  let col = colourOf(look, valueBetween(m, j, w.w));
  o.col = select(col.rgb, vec3f(1.0), own) * unpackRGB(i.vc);
  o.id = f32(e);
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let n = normalize(i.n);
  let lit = frame.sunColor.a > 0.5;
  let L = select(normalize(vec3f(0.4, 0.8, 0.45)), normalize(frame.sun.xyz), lit);
  let diff = max(dot(n, L), 0.0);
  let rgb = select(i.col * (0.55 + 0.45 * diff), i.col * (frame.ambient.rgb + frame.sunColor.rgb * diff), lit);
  if (frame.pick.x > 0.5) {
    return pickOut(s.misc.y, i.id);
  }
  return vec4f(themed(rgb, 0.0), 1.0);
}
`;
// the shapes' contact shadow: a soft dark quad on the ground under each shape near the camera (the near set's things,
// placed and turned as their shapes are), its core fully dark, fading past the shape's sides; no work on the main thread
const SHADOW = /* wgsl */ `
struct I { @builtin(vertex_index) vid: u32, @location(0) ent: f32 }
struct O { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) fade: f32 }
// how much of its shadow is left at a height over the ground (m): shrunk to half and faded away by shadowLook.z m (0:
// never), none past shadowLook.w m (0: no such height); (its share across, its opacity)
fn shadowAt(up: f32) -> vec2f {
  if (s.shadowLook.w > 0.0 && up > s.shadowLook.w) {
    return vec2f(0.0, 0.0);
  }
  let u = select(0.0, clamp(up / max(s.shadowLook.z, 0.001), 0.0, 1.0), s.shadowLook.z > 0.0);
  return vec2f(1.0 - 0.5 * u, (1.0 - u) * (1.0 - u));
}
@vertex fn vs(i: I) -> O {
  let e = i32(i.ent + 0.5);
  let m = liveOf(e);
  let t = s.clock.x;
  let w = whereAt(m, jOf(e), t);
  let j = i32(w.z);
  // on the ground under it, however high it flies
  let p = placeAt(w.xy, heightAt(w.xy) - s.origin.w + 0.03);
  let left = shadowAt(clearOf(w.xy, altNow(e)));
  let d = length(frame.eye.xyz - p);
  let a = headingAt(m, j, t) + PI;
  let c = cos(a);
  let sn = sin(a);
  let uv = cornerOf(i32(i.vid));
  let keep = select(1.0, sizeKeep(s.shapeSize.x * s.near.y, vec4f(1.0, s.shapeSize.y, s.shapeSize.z, 0.0), p), s.shapeSize.w > 0.5);
  let q = vec2f(s.shadow.z + uv.x * s.shadow.x, s.shadow.w + uv.y * s.shadow.y) * s.near.y * keep * left.x;
  let r = vec3f(q.x * c - q.y * sn, 0.0, q.x * sn + q.y * c);
  let hide = (j < 0 && s.misc.w < 0.5) || m.y < 1.0 || left.y <= 0.002;
  // (moved towards the eye by 20 px' worth: the same place on screen, over the ground it lies on, whatever it is)
  let clip = frame.viewProj * vec4f(towardEye(p + r, 20.0), 1.0);
  var o: O;
  o.pos = select(clipOut(clip), vec4f(2.0, 2.0, 2.0, 1.0), hide);
  o.uv = uv;
  o.fade = left.y;
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let k = s.shadowLook.y;
  let q = max(abs(i.uv) - vec2f(k), vec2f(0.0)) / max(1.0 - k, 0.001);
  let f = 1.0 - smoothstep(0.0, 1.0, length(q));
  let alpha = s.shadowLook.x * f * f * s.style.z * i.fade;
  if (alpha <= 0.002) {
    discard;
  }
  return vec4f(0.0, 0.0, 0.0, alpha);
}
`;
// a gauge over each thing: a bar facing the screen, a fixed size in CSS px, `gauge.z` m over the ground under it, filled
// to its value (the gauge's domain) and coloured by it, with an outline; seen within `gauge.w` m. Its label: the value
// in per cent ('72%') across the bar, its glyphs from an atlas (0–9 and %: fill r, halo g; bindings 8 and the sampler 9)
const GAUGE_LABEL = /* wgsl */ `
@group(1) @binding(${B}) var glyphs: texture_2d<f32>;
@group(1) @binding(${B + 1}) var smp: sampler;
// the digit of v at a place (0 ones, 1 tens, 2 hundreds)
fn digitOf(v: i32, place: i32) -> i32 {
  let p = select(select(1, 10, place == 1), 100, place == 2);
  return (v / p) % 10;
}
// a glyph's fill and halo at (x, y) from its cell's top left, in label heights
fn glyphAt(code: i32, x: f32, y: f32) -> vec2f {
  if (x < 0.0 || x > s.glyph.w || y < 0.0 || y > 1.0) {
    return vec2f(0.0, 0.0);
  }
  let uv = vec2f((f32(code) * s.glyph.w + x) / (11.0 * s.glyph.w), y);
  return textureSampleLevel(glyphs, smp, uv, 0.0).rg;
}
// the label at q (device px in the bar of px): its fill and halo; the glyphs either side are read too (a halo spills)
fn labelAt(q: vec2f, px: vec2f, pct: i32) -> vec2f {
  let h = s.labelText.w * frame.size.z;
  let n = select(select(2, 3, pct >= 10), 4, pct >= 100);
  let w = (f32(n - 1) * s.glyph.x + s.glyph.y) * h;
  let x = (q.x - (px.x - w) * 0.5) / h;
  let y = ((px.y + h) * 0.5 - q.y) / h;
  let k = clamp(i32(floor(x / s.glyph.x)), 0, n - 1);
  var out = vec2f(0.0, 0.0);
  for (var j = max(k - 1, 0); j <= min(k + 1, n - 1); j++) {
    let code = select(digitOf(pct, n - 2 - j), 10, j == n - 1);
    out = max(out, glyphAt(code, x - f32(j) * s.glyph.x + s.glyph.z, y));
  }
  return out;
}
`;
const gauge = (v: SetsVariant) => /* wgsl */ `${v.label ? GAUGE_LABEL : ''}
struct O { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) fill: f32, @location(2) col: vec3f, @location(3) px: vec2f, @location(4) @interpolate(flat) id: f32, @location(5) @interpolate(flat) pct: f32 }
@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> O {
  let e = i32(iid);
  let m = liveOf(e);
  let w = whereAt(m, jOf(e), s.clock.x);
  let j = i32(w.z);
  let f = clamp((valueBetween(m, j, w.w) - s.fx.z) / max(s.fx.w - s.fx.z, 1e-9), 0.0, 1.0);
  let corner = cornerOf(i32(vid));
  let p0 = placeAt(w.xy, heightOf(w.xy, altNow(e)) - s.origin.w + s.gauge.z);
  let d = length(frame.eye.xyz - p0);
  let hide = (j < 0 && s.misc.w < 0.5) || m.y < 1.0 || d > s.gauge.w || behindGlobe(p0);
  // (drawn over what stands within fx.y metres in front of it: moved that far towards the eye, the same pixels)
  let p = p0 + (frame.eye.xyz - p0) / max(d, 0.001) * min(s.fx.y, d * 0.5);
  let clip = frame.viewProj * vec4f(p, 1.0);
  let off = corner * s.gauge.xy * frame.size.z / frame.size.xy * clip.w;
  var o: O;
  o.pos = select(clipOut(vec4f(clip.xy + off, clip.z - s.style.w * clip.w, clip.w)), vec4f(2.0, 2.0, 2.0, 1.0), hide);
  o.uv = corner * 0.5 + 0.5;
  o.fill = f;
  o.col = gaugeColour(f);
  o.px = s.gauge.xy * frame.size.z;
  o.id = f32(e);
  o.pct = floor(f * 100.0 + 0.5);
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let q = i.uv * i.px;
  let edge = min(min(q.x, i.px.x - q.x), min(q.y, i.px.y - q.y));
  let line = edge < frame.size.z;
  let full = i.uv.x <= i.fill;
  var rgb = select(select(vec3f(0.08, 0.1, 0.12), i.col, full), s.gaugeLine.rgb, line);
  var alpha = select(select(0.6, 1.0, full), s.gaugeLine.a, line) * s.style.z;${v.label ? `
  let t = labelAt(q, i.px, i32(i.pct));
  rgb = mix(mix(rgb, s.labelHalo.rgb, t.y * s.labelHalo.a), s.labelText.rgb, t.x * s.labelText.a);
  alpha = max(alpha, max(t.x * s.labelText.a, t.y * s.labelHalo.a) * s.style.z);` : ''}
  if (frame.pick.x > 0.5) {
    return pickOut(s.misc.y, i.id);
  }
  return vec4f(themed(rgb, 0.0), alpha);
}
`;
// the found pass: one texel a thing (4096 a row), its sample at the time (a binary search, once a change of the
// time, not once a vertex), j + 1 in three bytes (an rgba8 target: every chip draws into one); in the air, as many
// rows again under them: its altitude now (its column at binding 7, the fold's after it)
// (its things folded into others for a while: each one's windows, a relation's: the fold texture, a texel a thing (its
// first window's texel, how many), then a texel a window (from, until: s from the log's epoch), in time order; a thing
// inside one now is written with alpha 0)
const FOLDED = (v: SetsVariant) => /* wgsl */ `
@group(1) @binding(${B + (v.alt ? 1 : 0)}) var fold: texture_2d<f32>;
fn foldAt(k: i32) -> vec4f {
  return textureLoad(fold, vec2i(k % 4096, k / 4096), 0);
}
fn foldedAt(e: i32, t: f32) -> bool {
  let ix = foldAt(e);
  let n = i32(ix.y);
  let a = i32(ix.x);
  if (n <= 0 || foldAt(a).x > t) {
    return false;
  }
  var lo = 0;
  var hi = n - 1;
  for (var k = 0; k < 24; k++) {
    if (hi <= lo) {
      break;
    }
    let mid = (lo + hi + 1) / 2;
    if (foldAt(a + mid).x <= t) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return t < foldAt(a + lo).y;
}
`;
const found = (v: SetsVariant) => /* wgsl */ `${v.fold ? FOLDED(v) : ''}
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let q = vec2i(pos.xy);
  // (in the air: below its rows of samples, a row of heights: each thing's altitude now, 1 cm steps from −500 m)
  let rows = (i32(s.misc.z) + 4095) / 4096;
  if (ALT > 0 && q.y >= rows) {
    let ea = (q.y - rows) * 4096 + q.x;
    if (ea >= i32(s.misc.z)) {
      return vec4f(0.0);
    }
    let ma = metaOf(ea);
    let ja = sampleAt(ma, s.clock.x);
    let u = clamp(round((altBetween(ma, ja, timeShare(ma, ja, s.clock.x)) + 500.0) * 100.0), 0.0, 16777215.0);
    let hi = floor(u / 65536.0);
    let mid = floor((u - hi * 65536.0) / 256.0);
    return vec4f(u - hi * 65536.0 - mid * 256.0, mid, hi, 255.0) / 255.0;
  }
  let e = q.y * 4096 + q.x;
  if (e >= i32(s.misc.z)) {
    return vec4f(0.0);
  }
  let j = sampleAt(metaOf(e), s.clock.x) + 1;
  let folded = ${v.fold ? 'foldedAt(e, s.clock.x)' : 'false'};
  return vec4f(f32(j % 256), f32((j / 256) % 256), f32(j / 65536), select(255.0, 0.0, folded)) / 255.0;
}
`;
// the pose pass: one texel a thing (4096 a row), its pitch and its bank at the time (radians, 16 bits each: 0.003°), for
// the things drawn as shapes now (the rest: none), once a change of the time; read by its shape (models' poseOf). From
// its path (its climb: the height it gains over the metres it goes; its bank: the turn its heading makes at its speed,
// atan(v ω / g)), each the mean over its path from att.x seconds before to after (its ease), at most att.y and att.z
// rad; or the log's columns (degrees: after the altitude's, the pitch's then the bank's)
const pose = (v: SetsVariant) => {
  const P = v.pose!, kind = (x: string) => (x === 'climb' || x === 'turn' ? 1 : x === 'u8' ? 2 : x === 'f32' ? 3 : 0), PB = B + (v.alt ? 1 : 0), BB = PB + (P.pitch === 'u8' || P.pitch === 'f32' ? 1 : 0);
  return /* wgsl */ `
const PITCH: i32 = ${kind(P.pitch)};
const BANK: i32 = ${kind(P.bank)};
${P.pitch === 'u8' || P.pitch === 'f32' ? `@group(1) @binding(${PB}) var pitchCol: texture_2d<f32>;` : ''}
${P.bank === 'u8' || P.bank === 'f32' ? `@group(1) @binding(${BB}) var bankCol: texture_2d<f32>;` : ''}
// a column's value at a slot (a byte over its domain lo … hi, or a 32-bit float)
fn columnAt(b: vec4f, col: i32, isByte: bool, lo: f32, hi: f32) -> f32 {
  if (!isByte) {
    return b.x;
  }
  let c = col % 4;
  let v = select(select(select(b.w, b.z, c == 2), b.y, c == 1), b.x, c == 0);
  return lo + v * (hi - lo);
}
fn pitchAt(sl: i32) -> f32 {
  ${P.pitch === 'u8' ? 'return columnAt(textureLoad(pitchCol, vec2i((sl % ROW) / 4, sl / ROW), 0), sl % ROW, true, s.attv.x, s.attv.y);' : P.pitch === 'f32' ? 'return columnAt(textureLoad(pitchCol, vec2i(sl % ROW, sl / ROW), 0), 0, false, 0.0, 0.0);' : 'return 0.0;'}
}
fn bankAt(sl: i32) -> f32 {
  ${P.bank === 'u8' ? 'return columnAt(textureLoad(bankCol, vec2i((sl % ROW) / 4, sl / ROW), 0), sl % ROW, true, s.attv.z, s.attv.w);' : P.bank === 'f32' ? 'return columnAt(textureLoad(bankCol, vec2i(sl % ROW, sl / ROW), 0), 0, false, 0.0, 0.0);' : 'return 0.0;'}
}
// the metres a unit of the places is where it is (its latitude's)
fn metresAt(rel: vec2f) -> f32 {
  let lat = 2.0 * atan(exp(frame.geo.x + s.origin.y + rel.y)) - PI * 0.5;
  return RE * cos(lat);
}
// the share of a corner's turn its heading has made at time x (the corner at tk, its turn eased over tl before it and
// tr after it: as headingAt turns it)
fn turnShare(x: f32, tk: f32, tl: f32, tr: f32) -> f32 {
  if (x < tk) {
    return 0.5 * clamp(1.0 - (tk - x) / max(tl, 0.001), 0.0, 1.0);
  }
  return 0.5 + 0.5 * clamp((x - tk) / max(tr, 0.001), 0.0, 1.0);
}
// its pitch from its climb and its bank from its turn at t (radians), over its path from t − att.x to t + att.x: the
// height it gains over the metres it goes; the turn its heading makes over that time at its speed there
fn pathPose(m: vec4f, j: i32, t: f32) -> vec2f {
  let n = i32(m.y);
  if (n < 2) {
    return vec2f(0.0, 0.0);
  }
  let D = max(s.att.x, 0.05);
  let tw = select(s.near.w, D, s.near.w <= 0.0);
  let t0 = max(t - D, tAt(slotOf(m, 0)));
  let t1 = min(t + D, tAt(slotOf(m, n - 1)));
  // the pieces round it: back to one that starts before t0 − tw, on to one that ends after t1 + tw (24 each way at most)
  var k0 = clamp(j, 0, n - 2);
  for (var i = 0; i < 24; i++) {
    if (k0 <= 0 || tAt(slotOf(m, k0)) <= t0 - tw) {
      break;
    }
    k0 = k0 - 1;
  }
  var k1 = clamp(j, 0, n - 2);
  for (var i = 0; i < 24; i++) {
    if (k1 >= n - 2 || tAt(slotOf(m, k1 + 1)) >= t1 + tw) {
      break;
    }
    k1 = k1 + 1;
  }
  var len = 0.0;
  var turn = 0.0;
  var a0 = altAt(slotOf(m, k0));
  var a1 = a0;
  var tp = tAt(slotOf(m, max(k0 - 1, 0)));
  for (var k = k0; k <= k1; k++) {
    let sa = slotOf(m, k);
    let sb = slotOf(m, k + 1);
    let ta = tAt(sa);
    let tb = tAt(sb);
    let dt = max(tb - ta, 0.0001);
    let pa = relAt(sa);
    // its metres within the window; its height at the window's ends
    let inside = max(min(tb, t1) - max(ta, t0), 0.0);
    len = len + length(relAt(sb) - pa) * metresAt(pa) * inside / dt;
    if (t0 >= ta && t0 <= tb) {
      a0 = mix(altAt(sa), altAt(sb), clamp((t0 - ta) / dt, 0.0, 1.0));
    }
    if (t1 >= ta && t1 <= tb) {
      a1 = mix(altAt(sa), altAt(sb), clamp((t1 - ta) / dt, 0.0, 1.0));
    }
    // the turn at the corner it starts at, as much of it as its heading makes within the window
    if (k > 0) {
      let d = angleDiff(pieceHeading(m, k - 1), pieceHeading(m, k));
      let tl = min(tw, max(ta - tp, 0.001) * 0.5);
      let tr = min(tw, dt * 0.5);
      turn = turn + d * (turnShare(t1, ta, tl, tr) - turnShare(t0, ta, tl, tr));
    }
    tp = ta;
  }
  let span = max(t1 - t0, 0.001);
  return vec2f(atan2(a1 - a0, max(len, 0.001)), atan(((len / span) * (turn / span)) / 9.80665));
}
// its pose at t: from its path (each within its most; a thing with an altitude banks only off the ground: fully once
// it is att.w m over it) or the log's columns (degrees, between its samples); up: how far over the ground it is
fn poseAt(m: vec4f, j: i32, f: f32, t: f32, up: f32) -> vec2f {
  var pb = vec2f(0.0, 0.0);
  if (PITCH == 1 || BANK == 1) {
    pb = pathPose(m, j, t);
  }
  var pitch = select(0.0, clamp(pb.x, -s.att.y, s.att.y), PITCH == 1);
  let off = select(1.0, smoothstep(0.0, 1.0, up / max(s.att.w, 0.001)), ALT > 0);
  var bank = select(0.0, clamp(pb.y, -s.att.z, s.att.z) * off, BANK == 1);
  let n = i32(m.y);
  let a = slotOf(m, clamp(j, 0, max(n - 1, 0)));
  let b = slotOf(m, min(clamp(j, 0, max(n - 1, 0)) + 1, max(n - 1, 0)));
  if (PITCH >= 2) {
    pitch = mix(pitchAt(a), pitchAt(b), f) * 0.017453293;
  }
  if (BANK >= 2) {
    bank = mix(bankAt(a), bankAt(b), f) * 0.017453293;
  }
  return vec2f(pitch, bank);
}
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let q = vec2i(pos.xy);
  let e = q.y * 4096 + q.x;
  // (only the things drawn as shapes now)
  if (e >= i32(s.misc.z) || lookOf(e).z < 0.5) {
    return vec4f(0.0, 128.0, 0.0, 128.0) / 255.0;
  }
  let m = liveOf(e);
  let w = whereAt(m, jOf(e), s.clock.x);
  let pb = poseAt(m, i32(w.z), w.w, s.clock.x, clearOf(w.xy, altNow(e)));
  let u = round(clamp(pb / PI + vec2f(0.5), vec2f(0.0), vec2f(1.0)) * 65535.0);
  let hi = floor(u / 256.0);
  return vec4f(u.x - hi.x * 256.0, hi.x, u.y - hi.y * 256.0, hi.y) / 255.0;
}
`;
};
/** the shapes' program: your formulas, the joints' log value read (its column at binding 8) when one reads it, the
 *  pose read (the pose pass's texture, after it) when they are turned by one */
const models = (v: SetsVariant) => {
  const PO = B + (v.joint === 'f32' ? 1 : 0);
  return MODELS.replace('/*@jointFormula*/', v.formula?.wgsl ?? '').replace('/*@jointColumnBinding*/', v.joint === 'f32' ? `@group(1) @binding(${B}) var jcol: texture_2d<f32>;` : '').replace('/*@jointColumnAt*/', v.joint === 'f32' ? 'return textureLoad(jcol, vec2i(sl % ROW, sl / ROW), 0).x;' : '')
    .replace('/*@poseBinding*/', v.pose ? `@group(1) @binding(${PO}) var pose: texture_2d<f32>;` : '')
    .replace('/*@poseOf*/', v.pose ? 'let b = round(textureLoad(pose, vec2i(e % 4096, e / 4096), 0) * 255.0);\n  return (vec2f(b.x + b.y * 256.0, b.z + b.w * 256.0) / 65535.0 - vec2f(0.5)) * PI;' : '');
};
/** what a thing placed on a set's things reads on the chip (core › entities › placement: by reference): the set's
 *  block and textures (SET_TEXTURES: bindings 0 … 6 of group 1) and its functions (whereAt, heightOf, altNow, placeAt,
 *  headingAt, liveOf …); the follower's own block is binding 2 of group 0, its textures from binding 7 */
export function setsTrackWGSL(v: SetsVariant): string { return head(v) + COMMON; }
/** a set's program on WebGPU: the found pass (each thing's sample at the time), the dots, the trails or the shapes
 *  near the camera, for the set's columns */
export function setsWGSL(kind: 'found' | 'pose' | 'dots' | 'trails' | 'models' | 'gauge' | 'shadow' | 'links', v: SetsVariant): string {
  // (the altitude by the sample: its column read where it is bound)
  const common = v.alt && BY_SAMPLE.has(kind) ? COMMON.replace('/*@altAt*/', ALT_AT_WGSL) : COMMON;
  return head(v, kind) + common + (kind === 'found' ? found(v) : kind === 'pose' ? pose(v) : kind === 'dots' ? DOTS : kind === 'trails' ? TRAILS : kind === 'gauge' ? gauge(v) : kind === 'shadow' ? SHADOW : kind === 'links' ? LINKS : models(v));
}
/** the altitude's column read at a slot (a byte over its domain, four a texel; or a 32-bit float) */
const ALT_AT_WGSL = `let col = sl % ROW;
  let row = sl / ROW;
  if (ALT == 1) {
    let b = textureLoad(acol, vec2i(col / 4, row), 0);
    let c = col % 4;
    return s.air.x + select(select(select(b.w, b.z, c == 2), b.y, c == 1), b.x, c == 0) * (s.air.y - s.air.x);
  }
  if (ALT == 2) {
    return textureLoad(acol, vec2i(col, row), 0).x;
  }`;
