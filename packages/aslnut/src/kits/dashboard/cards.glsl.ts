// Twin of cards.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from '../../core/render/graphics/shaders/frame.glsl.ts';
import { ANCHOR_FOLLOW_GLSL, ANCHOR_STILL_GLSL } from '../../core/render/graphics/shaders/anchors.glsl.ts';
import { setsTrackGLSL } from '../../core/render/graphics/shaders/sets.glsl.ts';
import type { SetsVariant } from '../../core/render/graphics/shaders/sets.wgsl.ts';
import { CARD_TEXTURES } from './cards.wgsl.ts';

const STRUCT = 'vec4 place; vec4 size; vec4 lay; vec4 clock; vec4 look; vec4 background; vec4 room; vec4 more; vec4 bar; vec4 dark; vec4 light; vec4 badge; vec4 fill; vec4 badgeOn; vec4 glyph; vec4 claim; vec4 hold; vec4 header; vec4 channels; vec4 rows[6]; vec4 rowsBar[6]; vec4 labels[6]; vec4 labelSize[6];';
const COMMON = /* glsl */ `
vec4 cardItem(int e, int k) {
  int i = e * int(u.more.x) + k;
  return texelFetch(items, ivec2(i % 4096, i / 4096), 0);
}
float cardWide(int e) {
  float w = cardItem(e, 2).w;
  return w > 0.5 ? w : 120.0;
}
float stateFade(vec4 s) {
  float r = round(s.x * 255.0);
  return mod(r, 128.0) / 127.0;
}
bool stateShown(vec4 s) {
  return round(s.x * 255.0) >= 128.0;
}
bool cardLater(int e) {
  vec4 s = texelFetch(state, ivec2(e % 4096, e / 4096), 0);
  return !(stateShown(s) && s.w < 0.99);
}
float cardOrder(int e) {
  return u.glyph.w + cardItem(e, 0).w + (cardLater(e) ? 262144.0 : 0.0);
}
float cardTime(int sl) {
  return texelFetch(times, ivec2(sl % 4096, sl / 4096), 0).x;
}
vec3 cardSample(int e) {
  vec4 m = cardItem(e, 0);
  int a = int(m.x);
  int n = int(m.y);
  float t = u.clock.x;
  if (n <= 1 || t <= cardTime(a)) {
    return vec3(float(a), float(a), 0.0);
  }
  if (t >= cardTime(a + n - 1)) {
    return vec3(float(a + n - 1), float(a + n - 1), 0.0);
  }
  int lo = 0;
  int hi = n - 1;
  for (int k = 0; k < 24; k++) {
    if (hi - lo <= 1) {
      break;
    }
    int mid = (lo + hi) / 2;
    if (cardTime(a + mid) <= t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  float ta = cardTime(a + lo);
  float tb = cardTime(a + hi);
  return vec3(float(a + lo), float(a + hi), tb > ta ? clamp((t - ta) / (tb - ta), 0.0, 1.0) : 0.0);
}
float cardValueAt(int sl, int c) {
  int Q = int(u.channels.x);
  int i = sl * Q + c / 4;
  vec4 v = texelFetch(values, ivec2(i % 4096, i / 4096), 0);
  int k = c % 4;
  return k == 0 ? v.x : k == 1 ? v.y : k == 2 ? v.z : v.w;
}
float cardChannel(vec3 sm, float c) {
  if (c < -0.5) {
    return 0.0;
  }
  int ci = int(c + 0.5);
  return mix(cardValueAt(int(sm.x), ci), cardValueAt(int(sm.y), ci), sm.z);
}
float cardHeight() {
  float st = u.clock.y;
  float head = u.header.x + u.header.y > 0.5 ? u.lay.y : 0.0;
  float body = st < 0.5 ? u.lay.z * u.lay.w : 0.0;
  return 2.0 * u.lay.x + head + body;
}
struct Room { vec4 box; float depth; float ok; float k; };
Room cardRoom(int e) {
  Room r;
  r.box = vec4(0.0);
  r.depth = 0.0;
  r.ok = 0.0;
  r.k = 1.0;
  vec4 a = anchorOf(e);
  if (a.w < 0.5 || anchorBehind(a.xyz)) {
    return r;
  }
  vec4 clip = frame.viewProj * vec4(a.xyz, 1.0);
  if (clip.w < 0.01) {
    return r;
  }
  vec3 ndc = clip.xyz / clip.w;
  vec2 px = vec2(round((ndc.x * 0.5 + 0.5) * frame.size.x), round((0.5 - ndc.y * 0.5) * frame.size.y));
  float w = sizePx(u.size.w, vec4(u.size.xyz, 0.0), a.xyz);
  float k = w / 120.0;
  float dpr = frame.size.z;
  float W = round(cardWide(e) * k * dpr);
  float H = round(cardHeight() * k * dpr);
  float y1 = px.y - round((u.look.y + 2.0) * k * dpr);
  float x0 = px.x - round(W * 0.5);
  r.box = vec4(x0, y1 - H, x0 + W, y1);
  r.depth = clamp(ndc.z, 0.0, 1.0);
  r.ok = 1.0;
  r.k = k;
  return r;
}
vec4 cardClip(vec2 p, float z) {
  return clipOut(vec4(p.x / frame.size.x * 2.0 - 1.0, 1.0 - p.y / frame.size.y * 2.0, z, 1.0));
}
`;
const CARDS_VS = /* glsl */ `
out vec2 vLocal;
flat out vec4 vDims;
flat out vec4 vRa;
flat out vec4 vRb;
flat out vec4 vRc;
flat out vec4 vFill;
flat out vec4 vMisc;
flat out vec4 vHead;
flat out vec4 vHeadSize;
flat out float vId;
vec2 cardCorner(int v) {
  float x = (v == 1 || v == 3) ? 1.0 : 0.0;
  float y = v >= 2 ? 1.0 : 0.0;
  return vec2(x, y);
}
vec4 cardRamp(float v) {
  float t = clamp((v - u.fill.y) / max(u.fill.z - u.fill.y, 1e-9), 0.0, 1.0);
  return texelFetch(fills, ivec2(int(t * 255.0 + 0.5), 0), 0);
}
float cardShown(int e) {
  if (u.claim.w < 0.5) {
    return 1.0;
  }
  return stateFade(texelFetch(state, ivec2(e % 4096, e / 4096), 0));
}
void main() {
  int e = gl_InstanceID;
  bool isDot = gl_VertexID >= 4;
  vec2 corner = cardCorner(gl_VertexID % 4);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vLocal = vec2(0.0);
  vDims = vec4(0.0);
  vRa = vec4(0.0);
  vRb = vec4(0.0);
  vRc = vec4(0.0);
  vFill = vec4(0.0);
  vMisc = vec4(0.0);
  vHead = vec4(0.0);
  vHeadSize = vec4(0.0);
  vId = float(e);
  Room r = cardRoom(e);
  if (r.ok < 0.5) {
    return;
  }
  float seen = cardShown(e);
  vec3 sm = cardSample(e);
  float fv = cardChannel(sm, u.fill.x);
  vec4 fc = u.fill.w > 0.5 ? cardRamp(fv) : u.background;
  float dpr = frame.size.z;
  vec2 tip = vec2((r.box.x + r.box.z) * 0.5, r.box.w + round((u.look.y + 2.0) * r.k * dpr));
  if (isDot) {
    float lost = u.clock.y > 1.5 ? 1.0 : 1.0 - cardShown(e);
    if (lost * u.look.z <= 0.0) {
      return;
    }
    float d = round(u.look.z * dpr);
    vec2 p = tip + (corner - vec2(0.5)) * d;
    gl_Position = cardClip(p, r.depth);
    vLocal = (corner - vec2(0.5)) * 2.0;
    vDims = vec4(-1.0, d, 0.0, lost * u.look.x);
    vFill = u.fill.w > 0.5 ? fc : u.dark;
    return;
  }
  if (u.clock.y > 1.5 || seen <= 0.0) {
    return;
  }
  float m = round(8.0 * r.k * dpr);
  vec4 box = vec4(r.box.x, r.box.y - m, r.box.z + m, tip.y);
  vec2 p = mix(box.xy, box.zw, corner);
  gl_Position = cardClip(p, r.depth);
  vLocal = (p - r.box.xy) / dpr / r.k;
  vDims = vec4((r.box.z - r.box.x) / dpr / r.k, (r.box.w - r.box.y) / dpr / r.k, r.k * dpr, seen * u.look.x);
  vRa = vec4(cardChannel(sm, u.rows[0].x), cardChannel(sm, u.rows[0].y), cardChannel(sm, u.rows[1].x), cardChannel(sm, u.rows[1].y));
  vRb = vec4(cardChannel(sm, u.rows[2].x), cardChannel(sm, u.rows[2].y), cardChannel(sm, u.rows[3].x), cardChannel(sm, u.rows[3].y));
  vRc = vec4(cardChannel(sm, u.rows[4].x), cardChannel(sm, u.rows[4].y), cardChannel(sm, u.rows[5].x), cardChannel(sm, u.rows[5].y));
  vFill = fc;
  vec4 it = cardItem(e, 0);
  vMisc = vec4(it.z, cardChannel(sm, u.badgeOn.x), (cardChannel(sm, u.badgeOn.y) > 0.5 && u.badgeOn.z > 0.5) ? 1.0 : 0.0, 0.0);
  vHead = cardItem(e, 1);
  vHeadSize = cardItem(e, 2);
}
`;
const CARDS_FS = /* glsl */ `
in vec2 vLocal;
flat in vec4 vDims;
flat in vec4 vRa;
flat in vec4 vRb;
flat in vec4 vRc;
flat in vec4 vFill;
flat in vec4 vMisc;
flat in vec4 vHead;
flat in vec4 vHeadSize;
flat in float vId;
out vec4 outColor;
float glyphCover(int code, float x, float y) {
  if (code < 0 || x < 0.0 || x > u.glyph.y || y < 0.0 || y > 1.0) {
    return 0.0;
  }
  vec2 uv = vec2((float(code) * u.glyph.y + x) / (u.glyph.z * u.glyph.y), y);
  return textureLod(glyphs, uv, 0.0).a;
}
int digitCount(int n) {
  int c = 1;
  int m = n / 10;
  for (int k = 0; k < 9; k++) {
    if (m <= 0) {
      break;
    }
    c++;
    m = m / 10;
  }
  return c;
}
int powTen(int d) {
  return d >= 2 ? 100 : d == 1 ? 10 : 1;
}
int numberChar(float v, int dec, int r) {
  int p = powTen(dec);
  int iv = int(round(min(abs(v), 9999999.0) * float(p)));
  int ip = iv / p;
  int fp = iv - ip * p;
  if (r < dec) {
    return (fp / powTen(r)) % 10;
  }
  int k = r - dec;
  if (dec > 0) {
    if (k == 0) {
      return 10;
    }
    k = k - 1;
  }
  int n = digitCount(ip);
  if (k < n) {
    int q = ip;
    for (int j = 0; j < 9; j++) {
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
int numberLength(float v, int dec) {
  int p = powTen(dec);
  int iv = int(round(min(abs(v), 9999999.0) * float(p)));
  return digitCount(iv / p) + (dec > 0 ? dec + 1 : 0) + ((v < 0.0 && iv > 0) ? 1 : 0);
}
float numberCover(vec2 q, float x1, float y0, float h, float v, float ofv, bool hasOf, int dec) {
  float adv = u.glyph.x * h;
  int r = int(floor((x1 - q.x) / adv));
  if (r < 0 || q.y < y0 || q.y > y0 + h) {
    return 0.0;
  }
  int code = -1;
  int rr = r;
  if (hasOf) {
    int no = numberLength(ofv, 0);
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
  float x = (x1 - float(r + 1) * adv - (u.glyph.y * h - adv) * 0.5);
  return glyphCover(code, (q.x - x) / h, (q.y - y0) / h);
}
float pictureCover(vec2 q, vec4 rect, float x0, float y0, float w, float h) {
  vec2 t = (q - vec2(x0, y0)) / vec2(w, h);
  if (t.x < 0.0 || t.y < 0.0 || t.x > 1.0 || t.y > 1.0) {
    return 0.0;
  }
  return textureLod(texts, mix(rect.xy, rect.zw, t), 0.0).a;
}
vec2 rowValue(int k) {
  if (k < 2) {
    return k == 0 ? vRa.xy : vRa.zw;
  }
  if (k < 4) {
    return k == 2 ? vRb.xy : vRb.zw;
  }
  return k == 4 ? vRc.xy : vRc.zw;
}
void main() {
  vec2 q = vLocal;
  float W = vDims.x;
  if (vDims.x < -0.5) {
    float r = length(q);
    float px = 2.0 / max(vDims.y, 1.0);
    float disc = 1.0 - smoothstep(1.0 - px, 1.0, r);
    float rim = smoothstep(1.0 - px * 4.0, 1.0 - px * 3.0, r);
    float a = disc * vDims.w;
    if (a <= 0.004) {
      discard;
    }
    if (frame.pick.x > 0.5) {
      outColor = pickOut(u.clock.z, vId);
      return;
    }
    outColor = vec4(themed(mix(vFill.rgb, u.dark.rgb, rim * 0.85), 1.0), a);
    return;
  }
  float pad = u.lay.x;
  float H = cardHeight();
  float rad = u.look.w;
  vec2 c = clamp(q, vec2(rad), vec2(W - rad, H - rad));
  bool inBox = length(q - c) <= rad;
  float pt = u.look.y;
  bool inTip = q.y >= H - 0.5 && q.y <= H + pt && abs(q.x - W * 0.5) <= (H + pt - q.y) * 0.9;
  vec2 bc = vec2(W - 3.0, 3.0);
  float br = 8.0;
  bool inBadge = vMisc.z > 0.5 && length(q - bc) <= br;
  if (!inBox && !inTip && !inBadge) {
    discard;
  }
  if (frame.pick.x > 0.5) {
    outColor = pickOut(u.clock.z, vId);
    return;
  }
  vec4 bg = vFill;
  float lum = dot(bg.rgb, vec3(0.299, 0.587, 0.114));
  vec4 ink = lum > 0.55 ? u.dark : u.light;
  vec3 rgb = bg.rgb;
  float alpha = bg.a;
  float edge = length(q - c) - rad;
  if (inBox && (edge > -1.0 / vDims.z * 2.0 || q.y > H - 1.0 / vDims.z * 2.0)) {
    rgb = mix(rgb, vec3(0.0), 0.18);
  }
  if (inBadge) {
    float bd = length(q - bc);
    rgb = mix(u.badge.rgb, vec3(1.0), smoothstep(br - 1.5, br - 0.5, bd));
    alpha = 1.0;
    float n = vMisc.y;
    float gh = 10.0;
    float len = float(numberLength(n, 0)) * u.glyph.x * gh;
    float cov = numberCover(q, bc.x + len * 0.5, bc.y - gh * 0.5, gh, n, 0.0, false, 0);
    rgb = mix(rgb, vec3(1.0), cov);
    outColor = vec4(themed(rgb, 1.0), alpha * vDims.w);
    return;
  }
  float cov = 0.0;
  vec3 tint = ink.rgb;
  float headH = u.header.x + u.header.y > 0.5 ? u.lay.y : 0.0;
  if (q.y < pad + headH) {
    float x = pad;
    if (u.header.x > 0.5 && vMisc.x >= 0.0) {
      float s = headH - 2.0;
      vec2 t = (q - vec2(x, pad + 1.0)) / s;
      if (t.x >= 0.0 && t.y >= 0.0 && t.x <= 1.0 && t.y <= 1.0) {
        float col = mod(vMisc.x, u.header.z);
        float row = floor(vMisc.x / u.header.z);
        vec4 ic = textureLod(icons, (vec2(col, row) + t) / vec2(u.header.z, u.header.w), 0.0);
        rgb = mix(rgb, ic.rgb / max(ic.a, 0.0001), ic.a);
      }
      x = x + s + 4.0;
    }
    if (u.header.y > 0.5) {
      float hh = min(vHeadSize.y, headH);
      cov = pictureCover(q, vHead, x, pad + (headH - hh) * 0.5, min(vHeadSize.x, W - pad - x), hh);
    }
  } else {
    int k = int(floor((q.y - pad - headH) / u.lay.z));
    if (k >= 0 && k < int(u.lay.w) && u.clock.y < 0.5) {
      float y0 = pad + headH + float(k) * u.lay.z;
      vec4 rw = u.rows[k];
      vec2 rv = rowValue(k);
      bool hasBar = rw.w > 0.5;
      float lh = u.labelSize[k].y;
      float ly = y0 + (u.lay.z - (hasBar ? 4.0 : 0.0) - lh) * 0.5;
      float lc = pictureCover(q, u.labels[k], pad, ly, u.labelSize[k].x, lh);
      float gh = 10.0;
      float vc = 0.0;
      if (rw.x < -1.5) {
        int e = int(vId + 0.5);
        int slot = int(rw.y + 0.5);
        vec4 sz = cardItem(e, 4 + 2 * slot);
        vc = pictureCover(q, cardItem(e, 3 + 2 * slot), W - pad - sz.x, y0 + (u.lay.z - (hasBar ? 4.0 : 0.0) - sz.y) * 0.5, sz.x, sz.y);
      } else {
        vc = numberCover(q, W - pad, y0 + (u.lay.z - (hasBar ? 4.0 : 0.0) - gh) * 0.5, gh, rv.x, rv.y, rw.y > -0.5, int(rw.z));
      }
      cov = max(lc, vc);
      tint = lc > vc ? mix(ink.rgb, bg.rgb, 0.38) : ink.rgb;
      if (hasBar) {
        float by = y0 + u.lay.z - 4.5;
        if (q.y >= by && q.y <= by + 3.0 && q.x >= pad && q.x <= W - pad) {
          float lo = u.rowsBar[k].x;
          float hi = rw.y > -0.5 ? rv.y : u.rowsBar[k].y;
          float f = clamp((rv.x - lo) / max(hi - lo, 1e-9), 0.0, 1.0);
          bool on = (q.x - pad) / max(W - 2.0 * pad, 1.0) <= f;
          rgb = on ? u.bar.rgb : mix(bg.rgb, ink.rgb, 0.15);
        }
      }
    }
  }
  rgb = mix(rgb, tint, cov);
  outColor = vec4(themed(rgb, 1.0), alpha * vDims.w);
}
`;
const CLAIM_VS = /* glsl */ `
flat out float vId;
void main() {
  int e = gl_InstanceID;
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  vId = 0.0;
  Room r = cardRoom(e);
  if (r.ok < 0.5 || u.clock.y > 1.5) {
    return;
  }
  int v = gl_VertexID;
  vec2 corner = vec2((v == 1 || v == 3) ? 1.0 : 0.0, v >= 2 ? 1.0 : 0.0);
  float m = 2.0 * frame.size.z;
  float b = u.badgeOn.z > 0.5 ? 6.0 * r.k * frame.size.z : 0.0;
  vec2 p = mix(r.box.xy - vec2(m, m + b), r.box.zw + vec2(m + b, m), corner) / (u.claim.z * frame.size.z);
  float rank = cardItem(e, 0).w;
  vId = cardOrder(e);
  float band = cardLater(e) ? 0.5 : 0.0;
  gl_Position = vec4(p.x / u.claim.x * 2.0 - 1.0, 1.0 - p.y / u.claim.y * 2.0, ((u.channels.z + band + 0.5 * (rank + 1.0) / (u.clock.w + 2.0)) / u.channels.w) * 2.0 - 1.0, 1.0);
}
`;
const CLAIM_FS = /* glsl */ `
flat in float vId;
out vec4 outColor;
void main() {
  uint n = uint(vId);
  outColor = vec4(float(n & 255u), float((n >> 8u) & 255u), float((n >> 16u) & 255u), 255.0) / 255.0;
}
`;
const DECIDE_VS = /* glsl */ `
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`;
const DECIDE_FS = /* glsl */ `
out vec4 outColor;
// (GL's rows from the bottom: the caller turns a row from the top over)
int claimOf(int x, int y) {
  vec4 b = round(texelFetch(claims, ivec2(x, y), 0) * 255.0);
  return int(b.x + b.y * 256.0 + b.z * 65536.0);
}
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int e = q.y * 4096 + q.x;
  vec4 prev = texelFetch(state, ivec2(e % 4096, e / 4096), 0);
  if (e >= int(u.clock.w)) {
    outColor = prev;
    return;
  }
  bool fresh = prev.w > 0.99 || u.hold.w > 0.5;
  bool shown = stateShown(prev) && !fresh;
  float fade = stateFade(prev);
  vec2 b = round(prev.yz * 255.0);
  float at = b.x * 256.0 + b.y;
  float cov = round(prev.w * 255.0);
  float now = u.hold.x;
  Room r = cardRoom(e);
  bool placed = r.ok > 0.5 && u.clock.y < 1.5;
  bool want = shown;
  bool looked = false;
  if (placed) {
    float s = u.claim.z * frame.size.z;
    bool off = r.box.z < 0.0 || r.box.x > frame.size.x || r.box.w < 0.0 || r.box.y > frame.size.y;
    if (!off) {
      looked = true;
      int mine = int(cardOrder(e));
      ivec2 c0 = ivec2(ceil(r.box.xy / s - vec2(0.5)));
      ivec2 c1 = ivec2(floor(r.box.zw / s - vec2(0.5)));
      float cells = 0.0;
      float covered = 0.0;
      for (int y = 0; y < 48; y++) {
        int cy = c0.y + y;
        if (cy > c1.y || (!shown && covered > 0.0)) {
          break;
        }
        for (int x = 0; x < 64; x++) {
          int cx = c0.x + x;
          if (cx > c1.x) {
            break;
          }
          if (cx >= 0 && cy >= 0 && cx < int(u.claim.x) && cy < int(u.claim.y)) {
            cells = cells + 1.0;
            int c = claimOf(cx, int(u.claim.y) - 1 - cy);
            if (c > 0 && c < mine) {
              covered = covered + 1.0;
            }
          }
        }
      }
      if (shown) {
        if (covered > u.room.x * max(cells, 1.0)) {
          float t10 = mod(floor(now / 10.0), 254.0) + 1.0;
          if (cov < 0.5 || cov > 254.5) {
            cov = t10;
          } else if (mod(t10 - cov + 254.0, 254.0) * 10.0 >= u.room.y * 1000.0) {
            want = false;
          }
        } else {
          cov = 0.0;
        }
      } else {
        want = covered < 0.5;
      }
    }
  }
  float since = mod(now - at + 63500.0, 63500.0);
  if (fresh && looked) {
    shown = want;
    at = now;
    cov = 0.0;
  } else if (fresh) {
    shown = false;
    cov = 255.0;
  } else if (want != shown && placed) {
    if (!want) {
      shown = false;
      at = now;
      cov = 0.0;
    } else if (since >= u.room.z * 1000.0) {
      shown = true;
      at = now;
      cov = 0.0;
    }
  }
  if (!placed) {
    shown = false;
    cov = 255.0;
  }
  fade = clamp(fade + (shown ? 1.0 : -1.0) * u.hold.y / max(u.room.w, 0.001), 0.0, 1.0);
  outColor = vec4(((shown ? 128.0 : 0.0) + round(fade * 127.0)) / 255.0, floor(at / 256.0) / 255.0, mod(at, 256.0) / 255.0, cov / 255.0);
}
`;
const CARRY_FS = /* glsl */ `
out vec4 outColor;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int e = q.y * 4096 + q.x;
  if (e >= int(u.more.y)) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  int old = int(cardItem(e, 2).z + 0.5) - 1;
  if (old < 0) {
    outColor = vec4(0.0, 0.0, 0.0, 1.0);
    return;
  }
  outColor = texelFetch(state, ivec2(old % 4096, old / 4096), 0);
}
`;
/** the cards' programs on WebGL2 (the twin of cardsWGSL) */
export function cardsGLSL(kind: 'cards' | 'claim' | 'decide' | 'carry', follow: SetsVariant | null): { vertex: string; fragment: string } {
  const head = `${follow ? setsTrackGLSL(follow) : FRAME_GLSL}
layout(std140) uniform U { ${STRUCT} } u;
${follow ? '' : 'uniform highp sampler2D places;'}
${CARD_TEXTURES.map((n) => `uniform highp sampler2D ${n};`).join('\n')}
${follow ? ANCHOR_FOLLOW_GLSL : ANCHOR_STILL_GLSL}${COMMON}`;
  if (kind === 'cards') return { vertex: head + CARDS_VS, fragment: head + CARDS_FS };
  if (kind === 'claim') return { vertex: head + CLAIM_VS, fragment: head + CLAIM_FS };
  return { vertex: head + DECIDE_VS, fragment: head + (kind === 'decide' ? DECIDE_FS : CARRY_FS) };
}
