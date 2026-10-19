// kits › dashboard › markers: a data card over each item (core › entities › placement: on a set's moving things, read
// from its own track; or on features), facing the screen, its width by the one size rule (its layout scales with it).
// A header (an icon from the app's atlas, the item's text: a picture drawn once), rows (a label: a picture; a value:
// digits drawn on the chip from a glyph atlas, '3/4' with its `of`; a bar), a fill (the card's colour from its value
// through a ramp; the text dark or light by it) and a badge (a number in a disc at its corner, while its gate holds).
// Every value is read on the chip at the world's time from the cards' own columns (core › data › history ›
// channels: each item's samples, every channel's value at each; a binary search, a mix). Under the governor a card
// steps down: its rows go, then its header, then it is a dot. Collision (optional, as labels): each card's room
// claimed in priority order into a small picture of the screen (4 CSS px a cell: the highest priority covering a cell
// wins it), each card then shown while it wins every cell it covers, its decision held 0.25 s after a change and
// faded in 0.2 s (the state: a texel a card, two kept in turn); a card that lost is a dot. Nothing per frame on the main
// thread: the clock, the view, the governor's step are uniforms. A card is read, never muted by an analysis view's
// theme (core › render › style › theme: it keeps its colours).
//   U: place (anchors) · size (the width's units, least, most CSS px; its value) · lay (the layout: pad, header, row height, rows)
//   · clock (s from the cards' epoch, the governor's step: 0 whole, 1 its header, 2 a dot; the pick number, items)
//   · look (opacity, the pointer's height, a dot's px (0: none), the corner's radius) · background · text · muted · bar
//   · dark, light (the ink on a light or a dark fill) · badge · fill (its channel, the ramp's domain lo, hi, on)
//   · badgeOn (its value's channel, its gate's channel, on) · glyph (a digit's advance and a cell's width in glyph
//   heights, the cells; the set's place in the room's one order: its cards' claims are it + their rank) · claim (the claims' picture w, h
//   (cells), a cell's CSS px, on) · hold (now ms mod 65536, dt s, the hold s, the first decision) · header (an icon, a
//   text, the icons' columns, rows) · channels (texels a slot, channels, the set's place in the room (0: the top), sets)
//   · rows (each: its value's channel, its of's (−1 none), decimals, a bar) · rowsBar (the bar's domain) · labels (each
//   row's label picture: uv rect) · labelSize (its CSS px)
//   (CSS px at a card 120 px wide: the layout scales with the width)
//   items: 3 texels an item (its first slot, samples, icon cell (−1 none), its rank in priority · its header picture's
//   uv rect · its CSS px width, height) · times (a slot a texel, s from the cards' epoch) · values (Q texels a slot,
//   4 channels a texel) · texts (the pictures: white, their alpha the text) · glyphs (0–9 . − / % +: a cell each) ·
//   icons (the app's atlas) · fills (the fill's colours: a ramp) · state (the collision's: shown, fade, its change's time ms
//   two bytes)
// Twin: cards.glsl.ts.
import { FRAME_WGSL } from '../../core/render/graphics/shaders/frame.wgsl.ts';
import { ANCHOR_FOLLOW_WGSL, ANCHOR_STILL_WGSL } from '../../core/render/graphics/shaders/anchors.wgsl.ts';
import { SET_TEXTURES, setsTrackWGSL, type SetsVariant } from '../../core/render/graphics/shaders/sets.wgsl.ts';

export const CARD_STRUCT = 'place: vec4f, size: vec4f, lay: vec4f, clock: vec4f, look: vec4f, background: vec4f, text: vec4f, muted: vec4f, bar: vec4f, dark: vec4f, light: vec4f, badge: vec4f, fill: vec4f, badgeOn: vec4f, glyph: vec4f, claim: vec4f, hold: vec4f, header: vec4f, channels: vec4f, rows: array<vec4f, 6>, rowsBar: array<vec4f, 6>, labels: array<vec4f, 6>, labelSize: array<vec4f, 6>';
/** floats in the cards' block */
export const CARD_FLOATS = (19 + 24) * 4;

const COMMON = /* wgsl */ `
fn cardItem(e: i32, k: i32) -> vec4f {
  let i = e * 3 + k;
  return textureLoad(items, vec2i(i % 4096, i / 4096), 0);
}
fn cardTime(sl: i32) -> f32 {
  return textureLoad(times, vec2i(sl % 4096, sl / 4096), 0).x;
}
// the item's sample at the clock: (its slot, the next, how far on), a binary search over its slots
fn cardSample(e: i32) -> vec3f {
  let m = cardItem(e, 0);
  let a = i32(m.x);
  let n = i32(m.y);
  let t = u.clock.x;
  if (n <= 1 || t <= cardTime(a)) {
    return vec3f(f32(a), f32(a), 0.0);
  }
  if (t >= cardTime(a + n - 1)) {
    return vec3f(f32(a + n - 1), f32(a + n - 1), 0.0);
  }
  var lo = 0;
  var hi = n - 1;
  for (var k = 0; k < 24; k++) {
    if (hi - lo <= 1) {
      break;
    }
    let mid = (lo + hi) / 2;
    if (cardTime(a + mid) <= t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  let ta = cardTime(a + lo);
  let tb = cardTime(a + hi);
  return vec3f(f32(a + lo), f32(a + hi), select(0.0, clamp((t - ta) / (tb - ta), 0.0, 1.0), tb > ta));
}
fn cardValueAt(sl: i32, c: i32) -> f32 {
  let Q = i32(u.channels.x);
  let i = sl * Q + c / 4;
  let v = textureLoad(values, vec2i(i % 4096, i / 4096), 0);
  let k = c % 4;
  return select(select(select(v.w, v.z, k == 2), v.y, k == 1), v.x, k == 0);
}
// a channel's value at the clock (c < 0: none, 0)
fn cardChannel(sm: vec3f, c: f32) -> f32 {
  if (c < -0.5) {
    return 0.0;
  }
  let ci = i32(c + 0.5);
  return mix(cardValueAt(i32(sm.x), ci), cardValueAt(i32(sm.y), ci), sm.z);
}
// its height (CSS px at 120 wide) at the governor's step: whole, its header only, or none (a dot)
fn cardHeight() -> f32 {
  let st = u.clock.y;
  let head = select(0.0, u.lay.y, u.header.x + u.header.y > 0.5);
  let body = select(0.0, u.lay.z * u.lay.w, st < 0.5);
  return 2.0 * u.lay.x + head + body;
}
// a card's room on the screen (device px from the top left: x0, y0, x1, y1; its pointer's tip at (x, y) =
// ((x0 + x1) / 2, y1 + the pointer)) and its anchor's depth; w: 0 when it is not placed or off the front
struct Room { box: vec4f, depth: f32, ok: f32, k: f32 }
fn cardRoom(e: i32) -> Room {
  var r: Room;
  r.box = vec4f(0.0);
  r.depth = 0.0;
  r.ok = 0.0;
  r.k = 1.0;
  let a = anchorOf(e);
  if (a.w < 0.5 || anchorBehind(a.xyz)) {
    return r;
  }
  let clip = frame.viewProj * vec4f(a.xyz, 1.0);
  if (clip.w < 0.01) {
    return r;
  }
  let ndc = clip.xyz / clip.w;
  let px = vec2f(round((ndc.x * 0.5 + 0.5) * frame.size.x), round((0.5 - ndc.y * 0.5) * frame.size.y));
  let w = sizePx(u.size.w, vec4f(u.size.xyz, 0.0), a.xyz);
  let k = w / 120.0;
  let dpr = frame.size.z;
  let W = round(w * dpr);
  let H = round(cardHeight() * k * dpr);
  let y1 = px.y - round((u.look.y + 2.0) * k * dpr);
  let x0 = px.x - round(W * 0.5);
  r.box = vec4f(x0, y1 - H, x0 + W, y1);
  r.depth = clamp(ndc.z, 0.0, 1.0);
  r.ok = 1.0;
  r.k = k;
  return r;
}
// device px from the top left → clip (the picking pass's region zoomed onto: clipOut)
fn cardClip(p: vec2f, z: f32) -> vec4f {
  return clipOut(vec4f(p.x / frame.size.x * 2.0 - 1.0, 1.0 - p.y / frame.size.y * 2.0, z, 1.0));
}
`;

// ── the cards ──
const CARDS = /* wgsl */ `
struct O { @builtin(position) pos: vec4f, @location(0) local: vec2f, @location(1) @interpolate(flat) dims: vec4f, @location(2) @interpolate(flat) ra: vec4f, @location(3) @interpolate(flat) rb: vec4f, @location(4) @interpolate(flat) rc: vec4f, @location(5) @interpolate(flat) fillc: vec4f, @location(6) @interpolate(flat) misc: vec4f, @location(7) @interpolate(flat) head: vec4f, @location(8) @interpolate(flat) headSize: vec4f, @location(9) @interpolate(flat) id: f32 }
fn cardCorner(v: i32) -> vec2f {
  let x = select(0.0, 1.0, v == 1 || v == 3);
  let y = select(0.0, 1.0, v >= 2);
  return vec2f(x, y);
}
fn cardRamp(v: f32) -> vec4f {
  let t = clamp((v - u.fill.y) / max(u.fill.z - u.fill.y, 1e-9), 0.0, 1.0);
  return textureLoad(fills, vec2i(i32(t * 255.0 + 0.5), 0), 0);
}
// the collision's state of a card: shown 0..1 (its fade; 1 without collision)
fn cardShown(e: i32) -> f32 {
  if (u.claim.w < 0.5) {
    return 1.0;
  }
  return textureLoad(state, vec2i(e % 4096, e / 4096), 0).y;
}
@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> O {
  let e = i32(iid);
  let isDot = vid >= 4u;
  let corner = cardCorner(i32(vid % 4u));
  var o: O;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  o.local = vec2f(0.0);
  o.dims = vec4f(0.0);
  o.ra = vec4f(0.0);
  o.rb = vec4f(0.0);
  o.rc = vec4f(0.0);
  o.fillc = vec4f(0.0);
  o.misc = vec4f(0.0);
  o.head = vec4f(0.0);
  o.headSize = vec4f(0.0);
  o.id = f32(e);
  let r = cardRoom(e);
  if (r.ok < 0.5) {
    return o;
  }
  let seen = cardShown(e);
  let sm = cardSample(e);
  let fv = cardChannel(sm, u.fill.x);
  let fc = select(u.background, cardRamp(fv), u.fill.w > 0.5);
  let dpr = frame.size.z;
  let tip = vec2f((r.box.x + r.box.z) * 0.5, r.box.w + round((u.look.y + 2.0) * r.k * dpr));
  if (isDot) {
    // a dot at its place: a card that lost its room, or one the governor stepped down to it
    let lost = select(1.0 - cardShown(e), 1.0, u.clock.y > 1.5);
    if (lost * u.look.z <= 0.0) {
      return o;
    }
    let d = round(u.look.z * dpr);
    let p = tip + (corner - vec2f(0.5)) * d;
    o.pos = cardClip(p, r.depth);
    o.local = (corner - vec2f(0.5)) * 2.0;
    o.dims = vec4f(-1.0, d, 0.0, lost * u.look.x);
    o.fillc = select(u.dark, fc, u.fill.w > 0.5);
    return o;
  }
  if (u.clock.y > 1.5 || seen <= 0.0) {
    return o;
  }
  // (its quad: the card, its pointer under it, its badge over its top right corner)
  let m = round(8.0 * r.k * dpr);
  let box = vec4f(r.box.x, r.box.y - m, r.box.z + m, tip.y);
  let p = mix(box.xy, box.zw, corner);
  o.pos = cardClip(p, r.depth);
  o.local = (p - r.box.xy) / dpr / r.k;
  o.dims = vec4f((r.box.z - r.box.x) / dpr / r.k, (r.box.w - r.box.y) / dpr / r.k, r.k * dpr, seen * u.look.x);
  o.ra = vec4f(cardChannel(sm, u.rows[0].x), cardChannel(sm, u.rows[0].y), cardChannel(sm, u.rows[1].x), cardChannel(sm, u.rows[1].y));
  o.rb = vec4f(cardChannel(sm, u.rows[2].x), cardChannel(sm, u.rows[2].y), cardChannel(sm, u.rows[3].x), cardChannel(sm, u.rows[3].y));
  o.rc = vec4f(cardChannel(sm, u.rows[4].x), cardChannel(sm, u.rows[4].y), cardChannel(sm, u.rows[5].x), cardChannel(sm, u.rows[5].y));
  o.fillc = fc;
  let it = cardItem(e, 0);
  o.misc = vec4f(it.z, cardChannel(sm, u.badgeOn.x), select(0.0, 1.0, cardChannel(sm, u.badgeOn.y) > 0.5 && u.badgeOn.z > 0.5), 0.0);
  o.head = cardItem(e, 1);
  o.headSize = cardItem(e, 2);
  return o;
}
// a glyph's coverage at (x, y) in its cell (glyph heights), its code (0–9, 10 '.', 11 '−', 12 '/', 13 '%', 14 '+')
fn glyphCover(code: i32, x: f32, y: f32) -> f32 {
  if (code < 0 || x < 0.0 || x > u.glyph.y || y < 0.0 || y > 1.0) {
    return 0.0;
  }
  let uv = vec2f((f32(code) * u.glyph.y + x) / (u.glyph.z * u.glyph.y), y);
  return textureSampleLevel(glyphs, smp, uv, 0.0).a;
}
// the digits of n (n ≥ 0): how many (one at least)
fn digitCount(n: i32) -> i32 {
  var c = 1;
  var m = n / 10;
  for (var k = 0; k < 9; k++) {
    if (m <= 0) {
      break;
    }
    c++;
    m = m / 10;
  }
  return c;
}
fn powTen(d: i32) -> i32 {
  return select(select(1, 10, d == 1), 100, d >= 2);
}
// the r-th character from the right of v written with dec decimals (−1: none)
fn numberChar(v: f32, dec: i32, r: i32) -> i32 {
  let p = powTen(dec);
  let iv = i32(round(min(abs(v), 9999999.0) * f32(p)));
  let ip = iv / p;
  let fp = iv - ip * p;
  if (r < dec) {
    return (fp / powTen(r)) % 10;
  }
  var k = r - dec;
  if (dec > 0) {
    if (k == 0) {
      return 10;
    }
    k = k - 1;
  }
  let n = digitCount(ip);
  if (k < n) {
    var q = ip;
    for (var j = 0; j < 9; j++) {
      if (j >= k) {
        break;
      }
      q = q / 10;
    }
    return q % 10;
  }
  if (k == n && v < 0.0 && iv > 0) {
    return 11;
  }
  return -1;
}
// how many characters v takes with dec decimals
fn numberLength(v: f32, dec: i32) -> i32 {
  let p = powTen(dec);
  let iv = i32(round(min(abs(v), 9999999.0) * f32(p)));
  return digitCount(iv / p) + select(0, dec + 1, dec > 0) + select(0, 1, v < 0.0 && iv > 0);
}
// a value (and its 'of': v/of) right-aligned at x1, its glyphs h px tall: the coverage at q (CSS px at 120 wide)
fn numberCover(q: vec2f, x1: f32, y0: f32, h: f32, v: f32, ofv: f32, hasOf: bool, dec: i32) -> f32 {
  let adv = u.glyph.x * h;
  let r = i32(floor((x1 - q.x) / adv));
  if (r < 0 || q.y < y0 || q.y > y0 + h) {
    return 0.0;
  }
  var code = -1;
  var rr = r;
  if (hasOf) {
    let no = numberLength(ofv, 0);
    if (rr < no) {
      code = numberChar(ofv, 0, rr);
    } else if (rr == no) {
      code = 12;
    }
    rr = rr - no - 1;
  }
  if (code < 0 && rr >= 0) {
    code = numberChar(v, dec, rr);
  }
  let x = (x1 - f32(r + 1) * adv - (u.glyph.y * h - adv) * 0.5);
  return glyphCover(code, (q.x - x) / h, (q.y - y0) / h);
}
// a picture of the texts' atlas: its uv rect, drawn into the box at (x0, y0) of w × h CSS px (at 120 wide)
fn pictureCover(q: vec2f, rect: vec4f, x0: f32, y0: f32, w: f32, h: f32) -> f32 {
  let t = (q - vec2f(x0, y0)) / vec2f(w, h);
  if (t.x < 0.0 || t.y < 0.0 || t.x > 1.0 || t.y > 1.0) {
    return 0.0;
  }
  return textureSampleLevel(texts, smp, mix(rect.xy, rect.zw, t), 0.0).a;
}
fn rowValue(i: O, k: i32) -> vec2f {
  if (k < 2) {
    return select(i.ra.zw, i.ra.xy, k == 0);
  }
  if (k < 4) {
    return select(i.rb.zw, i.rb.xy, k == 2);
  }
  return select(i.rc.zw, i.rc.xy, k == 4);
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let q = i.local;
  let W = i.dims.x;
  // a dot: a disc with a light rim
  if (i.dims.x < -0.5) {
    let r = length(q);
    let px = 2.0 / max(i.dims.y, 1.0);
    let disc = 1.0 - smoothstep(1.0 - px, 1.0, r);
    let rim = smoothstep(1.0 - px * 4.0, 1.0 - px * 3.0, r);
    let a = disc * i.dims.w;
    if (a <= 0.004) {
      discard;
    }
    if (frame.pick.x > 0.5) {
      return pickOut(u.clock.z, i.id);
    }
    return vec4f(themed(mix(i.fillc.rgb, u.dark.rgb, rim * 0.85), 1.0), a);
  }
  let pad = u.lay.x;
  let H = cardHeight();
  let rad = u.look.w;
  // the panel: a rounded box, its pointer under its middle
  let c = clamp(q, vec2f(rad), vec2f(W - rad, H - rad));
  let inBox = length(q - c) <= rad;
  let pt = u.look.y;
  let inTip = q.y >= H - 0.5 && q.y <= H + pt && abs(q.x - W * 0.5) <= (H + pt - q.y) * 0.9;
  // the badge: a disc over its top right corner
  let bc = vec2f(W - 3.0, 3.0);
  let br = 8.0;
  let inBadge = i.misc.z > 0.5 && length(q - bc) <= br;
  if (!inBox && !inTip && !inBadge) {
    discard;
  }
  if (frame.pick.x > 0.5) {
    return pickOut(u.clock.z, i.id);
  }
  let bg = i.fillc;
  let lum = dot(bg.rgb, vec3f(0.299, 0.587, 0.114));
  let ink = select(u.light, u.dark, lum > 0.55);
  var rgb = bg.rgb;
  var alpha = bg.a;
  // its edge: a hairline a shade darker
  let edge = length(q - c) - rad;
  if (inBox && (edge > -1.0 / i.dims.z * 2.0 || q.y > H - 1.0 / i.dims.z * 2.0)) {
    rgb = mix(rgb, vec3f(0.0), 0.18);
  }
  if (inBadge) {
    let bd = length(q - bc);
    rgb = mix(u.badge.rgb, vec3f(1.0), smoothstep(br - 1.5, br - 0.5, bd));
    alpha = 1.0;
    let n = i.misc.y;
    let gh = 10.0;
    let len = f32(numberLength(n, 0)) * u.glyph.x * gh;
    let cov = numberCover(q, bc.x + len * 0.5, bc.y - gh * 0.5, gh, n, 0.0, false, 0);
    rgb = mix(rgb, vec3f(1.0), cov);
    return vec4f(themed(rgb, 1.0), alpha * i.dims.w);
  }
  var cov = 0.0;
  var tint = ink.rgb;
  let headH = select(0.0, u.lay.y, u.header.x + u.header.y > 0.5);
  if (q.y < pad + headH) {
    // the header: its icon, then its text
    var x = pad;
    if (u.header.x > 0.5 && i.misc.x >= 0.0) {
      let s = headH - 2.0;
      let t = (q - vec2f(x, pad + 1.0)) / s;
      if (t.x >= 0.0 && t.y >= 0.0 && t.x <= 1.0 && t.y <= 1.0) {
        let col = i.misc.x % u.header.z;
        let row = floor(i.misc.x / u.header.z);
        let ic = textureSampleLevel(icons, smp, (vec2f(col, row) + t) / vec2f(u.header.z, u.header.w), 0.0);
        rgb = mix(rgb, ic.rgb / max(ic.a, 0.0001), ic.a);
      }
      x = x + s + 4.0;
    }
    if (u.header.y > 0.5) {
      let hh = min(i.headSize.y, headH);
      cov = pictureCover(q, i.head, x, pad + (headH - hh) * 0.5, min(i.headSize.x, W - pad - x), hh);
    }
  } else {
    // a row: its label, its value (right), its bar under them
    let k = i32(floor((q.y - pad - headH) / u.lay.z));
    if (k >= 0 && k < i32(u.lay.w) && u.clock.y < 0.5) {
      let y0 = pad + headH + f32(k) * u.lay.z;
      let rw = u.rows[k];
      let rv = rowValue(i, k);
      let hasBar = rw.w > 0.5;
      let lh = u.labelSize[k].y;
      let ly = y0 + (u.lay.z - select(0.0, 4.0, hasBar) - lh) * 0.5;
      let lc = pictureCover(q, u.labels[k], pad, ly, u.labelSize[k].x, lh);
      let gh = 10.0;
      let vc = numberCover(q, W - pad, y0 + (u.lay.z - select(0.0, 4.0, hasBar) - gh) * 0.5, gh, rv.x, rv.y, rw.y > -0.5, i32(rw.z));
      cov = max(lc, vc);
      tint = select(ink.rgb, mix(ink.rgb, bg.rgb, 0.38), lc > vc);
      if (hasBar) {
        let by = y0 + u.lay.z - 4.5;
        if (q.y >= by && q.y <= by + 3.0 && q.x >= pad && q.x <= W - pad) {
          let lo = u.rowsBar[k].x;
          let hi = select(u.rowsBar[k].y, rv.y, rw.y > -0.5);
          let f = clamp((rv.x - lo) / max(hi - lo, 1e-9), 0.0, 1.0);
          let on = (q.x - pad) / max(W - 2.0 * pad, 1.0) <= f;
          rgb = select(mix(bg.rgb, ink.rgb, 0.15), u.bar.rgb, on);
        }
      }
    }
  }
  rgb = mix(rgb, tint, cov);
  return vec4f(themed(rgb, 1.0), alpha * i.dims.w);
}
`;

// ── collision: the claims (each card's room, its rank its depth: the highest priority nearest) ──
const CLAIM = /* wgsl */ `
struct O { @builtin(position) pos: vec4f, @location(0) @interpolate(flat) id: f32 }
@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> O {
  let e = i32(iid);
  var o: O;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  o.id = u.glyph.w + cardItem(e, 0).w;
  let r = cardRoom(e);
  if (r.ok < 0.5 || u.clock.y > 1.5) {
    return o;
  }
  let v = i32(vid);
  let corner = vec2f(select(0.0, 1.0, v == 1 || v == 3), select(0.0, 1.0, v >= 2));
  // (on the claims' picture: a cell a claim.z CSS px, the room grown by 2 px each side, its badge's over its corner)
  let m = 2.0 * frame.size.z;
  let b = select(0.0, 6.0 * r.k * frame.size.z, u.badgeOn.z > 0.5);
  let p = mix(r.box.xy - vec2f(m, m + b), r.box.zw + vec2f(m + b, m), corner) / (u.claim.z * frame.size.z);
  let rank = cardItem(e, 0).w;
  o.pos = vec4f(p.x / u.claim.x * 2.0 - 1.0, 1.0 - p.y / u.claim.y * 2.0, (u.channels.z + (rank + 1.0) / (u.clock.w + 2.0)) / u.channels.w, 1.0);
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let n = u32(i.id);
  return vec4f(f32(n & 255u), f32((n >> 8u) & 255u), f32((n >> 16u) & 255u), 255.0) / 255.0;
}
`;
// ── collision: each card's decision (a texel a card): it wins when every cell its room covers is its own; held 0.25 s
// after a change; faded 0.2 s; off the screen it keeps what it had ──
const DECIDE = /* wgsl */ `
fn claimOf(x: i32, y: i32) -> i32 {
  let b = round(textureLoad(claims, vec2i(x, y), 0) * 255.0);
  return i32(b.x + b.y * 256.0 + b.z * 65536.0);
}
@vertex fn vs(@builtin(vertex_index) i: u32) -> @builtin(position) vec4f {
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  return vec4f(p * 2.0 - 1.0, 0.0, 1.0);
}
@fragment fn fs(@builtin(position) pos: vec4f) -> @location(0) vec4f {
  let q = vec2i(pos.xy);
  let e = q.y * 4096 + q.x;
  if (e >= i32(u.clock.w)) {
    return vec4f(0.0);
  }
  let prev = textureLoad(state, vec2i(e % 4096, e / 4096), 0);
  var shown = prev.x > 0.5;
  var fade = prev.y;
  let b = round(prev.zw * 255.0);
  var at = b.x * 256.0 + b.y;
  let r = cardRoom(e);
  var want = shown;
  if (r.ok < 0.5 || u.clock.y > 1.5) {
    want = false;
  } else {
    let s = u.claim.z * frame.size.z;
    let off = r.box.z < 0.0 || r.box.x > frame.size.x || r.box.w < 0.0 || r.box.y > frame.size.y;
    if (!off) {
      // the cells whose middles are inside its room: none claimed by a card before it (the claims are each card's place
      // in the one order: the top set first, then each set's own; last frame's: a cell it moved into is empty, or a
      // later card's, and it still wins)
      let mine = i32(u.glyph.w + cardItem(e, 0).w);
      let c0 = vec2i(ceil(r.box.xy / s - vec2f(0.5)));
      let c1 = vec2i(floor(r.box.zw / s - vec2f(0.5)));
      want = true;
      for (var y = 0; y < 48; y++) {
        let cy = c0.y + y;
        if (cy > c1.y || !want) {
          break;
        }
        for (var x = 0; x < 64; x++) {
          let cx = c0.x + x;
          if (cx > c1.x) {
            break;
          }
          if (cx >= 0 && cy >= 0 && cx < i32(u.claim.x) && cy < i32(u.claim.y)) {
            let c = claimOf(cx, cy);
            if (c > 0 && c < mine) {
              want = false;
              break;
            }
          }
        }
      }
    }
  }
  // a change shows at once, then holds (hold.z s) before it may change again; the first decision at once
  let since = (u.hold.x - at + 65536.0) % 65536.0;
  if (want != shown && (u.hold.w > 0.5 || since >= u.hold.z * 1000.0)) {
    shown = want;
    at = u.hold.x;
  }
  fade = clamp(fade + select(-1.0, 1.0, shown) * u.hold.y / 0.2, 0.0, 1.0);
  return vec4f(select(0.0, 1.0, shown), fade, floor(at / 256.0) / 255.0, (at % 256.0) / 255.0);
}
`;
/** the cards' programs on WebGPU: placed on features (still), or on a set's things (its track's variant) */
export function cardsWGSL(kind: 'cards' | 'claim' | 'decide', follow: SetsVariant | null): string {
  const B = follow ? SET_TEXTURES.length : 1;
  const tex = ['items', 'times', 'values', 'texts', 'glyphs', 'icons', 'fills', 'state', 'claims'];
  return `${follow ? setsTrackWGSL(follow) : FRAME_WGSL}
struct U { ${CARD_STRUCT} }
@group(0) @binding(${follow ? 2 : 1}) var<uniform> u: U;
${follow ? '' : '@group(1) @binding(0) var places: texture_2d<f32>;'}
${tex.map((n, i) => `@group(1) @binding(${B + i}) var ${n}: texture_2d<f32>;`).join('\n')}
@group(1) @binding(${B + tex.length}) var smp: sampler;
${follow ? ANCHOR_FOLLOW_WGSL : ANCHOR_STILL_WGSL}${COMMON}${kind === 'cards' ? CARDS : kind === 'claim' ? CLAIM : DECIDE}`;
}
/** the textures after the placement's own, in binding order */
export const CARD_TEXTURES = ['items', 'times', 'values', 'texts', 'glyphs', 'icons', 'fills', 'state', 'claims'] as const;
/** the ones sampled through the filter (pictures); the rest read texel by texel */
export const CARD_FILTERED = new Set(['texts', 'glyphs', 'icons']);
