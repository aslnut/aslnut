// Twin of sets.wgsl.ts: the same functions in the same order.
import { FRAME_GLSL } from './frame.glsl.ts';
import { SHAPE_FNS_GLSL } from './shape-fns.glsl.ts';
import { SET_TEXTURES, type SetsVariant } from './sets.wgsl.ts';

/** the programs that read the altitude by the sample (its column bound: acol) */
const BY_SAMPLE = new Set(['trails', 'pose', 'found']);
const head = (v: SetsVariant, kind = '') => /* glsl */ `${FRAME_GLSL}
const int TIME16 = ${v.time === 'u16' ? 1 : 0};
const int PLACE16 = ${v.place === 'u16' ? 1 : 0};
const int VALUE = ${v.value === 'u8' ? 1 : v.value === 'f32' ? 2 : 0};
const int STEP = ${v.step ? 1 : 0};
const int COLOR = ${v.color === 'ramp' ? 2 : v.color === 'thing' ? 1 : 0};
const int SIZE = ${v.size === 'value' ? 2 : v.size === 'thing' ? 1 : 0};
const int ROW = ${v.row};
const int GRID = ${v.grid};
const int FOLD = ${v.fold ? 1 : 0};
const int ALT = ${v.alt === 'u8' ? 1 : v.alt === 'f32' ? 2 : 0};
const int OVER_SEA = ${v.alt && v.over === 'sea' ? 1 : 0};
layout(std140) uniform S { vec4 clock; vec4 origin; vec4 box; vec4 gridA; vec4 gridB; vec4 style; vec4 color; vec4 outline; vec4 trail; vec4 trailColor; vec4 value; vec4 near; vec4 misc; vec4 grid; vec4 sz; vec4 fx; vec4 gauge; vec4 gaugeLo; vec4 gaugeMid; vec4 gaugeHi; vec4 gaugeLine; vec4 glyph; vec4 labelText; vec4 labelHalo; vec4 shadow; vec4 shadowLook; vec4 dotSize; vec4 shapeSize; vec4 pc; vec4 parts[32]; vec4 link; vec4 linkColor; vec4 linkMore; vec4 air; vec4 att; vec4 pivot; vec4 attv; } s;
${SET_TEXTURES.map((n) => `uniform highp sampler2D ${n};`).join('\n')}
${v.alt && BY_SAMPLE.has(kind) ? 'uniform highp sampler2D acol;' : ''}
const float PI = 3.141592653589793;
const float RE = 6378137.0;
${SHAPE_FNS_GLSL}
`;
const COMMON = /* glsl */ `
float s2(float a) {
  float h = sin(a * 0.5);
  return 2.0 * h * h;
}
vec3 placeAt(vec2 rel, float h) {
  float dl = s.origin.x + rel.x;
  float dm = s.origin.y + rel.y;
  float c = RE * frame.misc.y;
  vec3 F = vec3(c * dl, h, -c * dm);
  if (frame.size.w >= 1.0) {
    return F;
  }
  float lat = 2.0 * atan(exp(frame.geo.x + dm)) - PI * 0.5;
  float dp = lat - frame.misc.x;
  float rr = RE + h;
  float cl = cos(lat);
  float k = s2(dp) + frame.misc.y * cl * s2(dl);
  vec3 G = vec3(rr * cl * sin(dl), h - rr * k, -rr * (sin(dp) + frame.geo.y * cl * s2(dl)));
  return mix(G, F, frame.size.w);
}
bool behindGlobe(vec3 p) {
  return frame.size.w < 0.5 && dot(p - vec3(0.0, -RE, 0.0), frame.eye.xyz - p) < 0.0;
}
vec3 towardEye(vec3 p, float px) {
  vec3 toEye = frame.eye.xyz - p;
  float d = length(toEye);
  float mpp = 2.0 * d * frame.misc.z / frame.size.y;
  return p + toEye / max(d, 0.001) * min(px * frame.size.z * 0.5 * mpp, d * 0.5);
}
vec2 cornerOf(int v) {
  float x = (v == 1 || v == 3) ? 1.0 : -1.0;
  float y = v >= 2 ? 1.0 : -1.0;
  return vec2(x, y);
}
vec4 metaOf(int e) {
  int i = e * 2;
  return texelFetch(things, ivec2(i % 4096, i / 4096), 0);
}
vec4 lookOf(int e) {
  int i = e * 2 + 1;
  return texelFetch(things, ivec2(i % 4096, i / 4096), 0);
}
int slotOf(vec4 m, int j) {
  if (m.z < 0.0) {
    int v = int(-m.z);
    return int(m.x) + ((int(m.w) + j) % max(v % 8192, 1)) * (v / 8192);
  }
  int cap = max(int(m.z), 1);
  return int(m.x) + (int(m.w) + j) % cap;
}
float tAt(int sl) {
  int col = sl % ROW;
  int row = sl / ROW;
  if (TIME16 == 1) {
    vec4 b = round(texelFetch(tcol, ivec2(col / 2, row), 0) * 255.0);
    vec2 p = (col % 2 == 0) ? b.xy : b.zw;
    return (p.x + p.y * 256.0) * s.misc.x;
  }
  return texelFetch(tcol, ivec2(col, row), 0).x;
}
vec2 relAt(int sl) {
  int col = sl % ROW;
  int row = sl / ROW;
  if (PLACE16 == 1) {
    vec4 b = round(texelFetch(pcol, ivec2(col, row), 0) * 255.0);
    vec2 q = vec2(b.x + b.y * 256.0, b.z + b.w * 256.0) / 65535.0;
    return s.box.xy + q * s.box.zw;
  }
  vec4 f = texelFetch(pcol, ivec2(col / 2, row), 0);
  return (col % 2 == 0) ? f.xy : f.zw;
}
float valueAt(int sl) {
  int col = sl % ROW;
  int row = sl / ROW;
  if (VALUE == 1) {
    vec4 b = texelFetch(vcol, ivec2(col / 4, row), 0);
    int c = col % 4;
    float v = c == 0 ? b.x : (c == 1 ? b.y : (c == 2 ? b.z : b.w));
    return s.value.x + v * (s.value.y - s.value.x);
  }
  if (VALUE == 2) {
    return texelFetch(vcol, ivec2(col, row), 0).x;
  }
  return 0.0;
}
int sampleAt(vec4 m, float t) {
  int n = int(m.y);
  if (n <= 0) {
    return -1;
  }
  if (t < tAt(slotOf(m, 0))) {
    return -1;
  }
  int lo = 0;
  int hi = n - 1;
  if (t >= tAt(slotOf(m, hi))) {
    return hi;
  }
  for (int k = 0; k < 24; k++) {
    if (hi - lo <= 1) {
      break;
    }
    int mid = (lo + hi) / 2;
    if (tAt(slotOf(m, mid)) <= t) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return lo;
}
int jOf(int e) {
  vec4 b = round(texelFetch(found, ivec2(e % 4096, e / 4096), 0) * 255.0);
  return int(b.x + b.y * 256.0 + b.z * 65536.0) - 1;
}
vec4 liveOf(int e) {
  vec4 m = metaOf(e);
  if (FOLD == 1) {
    if (texelFetch(found, ivec2(e % 4096, e / 4096), 0).a < 0.5) {
      m.y = 0.0;
    }
  }
  return m;
}
vec4 whereAt(vec4 m, int j, float t) {
  int n = int(m.y);
  int sa = slotOf(m, max(j, 0));
  if (j < 0 || j >= n - 1) {
    vec2 p = relAt(sa);
    return vec4(p, float(j), 0.0);
  }
  int sb = slotOf(m, j + 1);
  float ta = tAt(sa);
  float tb = tAt(sb);
  float f = tb > ta ? clamp((t - ta) / (tb - ta), 0.0, 1.0) : 0.0;
  return vec4(mix(relAt(sa), relAt(sb), f), float(j), f);
}
float valueBetween(vec4 m, int j, float f) {
  if (VALUE == 0) {
    return 0.0;
  }
  int n = int(m.y);
  int a = clamp(j, 0, max(n - 1, 0));
  int b = min(a + 1, max(n - 1, 0));
  // (a step: held from its sample to the next, never through the values between)
  if (STEP == 1) {
    return valueAt(slotOf(m, a));
  }
  return mix(valueAt(slotOf(m, a)), valueAt(slotOf(m, b)), f);
}
float gLoad(int x, int y) {
  return texelFetch(ground, ivec2(clamp(x, 0, GRID - 1), clamp(y, 0, 2 * GRID - 1)), 0).x;
}
float gLevel(vec2 uv, int base) {
  vec2 g = clamp(uv, vec2(0.0), vec2(1.0)) * float(GRID - 1);
  ivec2 i = ivec2(floor(g));
  vec2 f = g - vec2(i);
  int x1 = min(i.x + 1, GRID - 1);
  int y1 = min(i.y + 1, GRID - 1);
  float a = mix(gLoad(i.x, base + i.y), gLoad(x1, base + i.y), f.x);
  float b = mix(gLoad(i.x, base + y1), gLoad(x1, base + y1), f.x);
  return mix(a, b, f.y);
}
float groundAt(vec2 rel) {
  vec2 b = (rel - s.gridB.xy) * s.gridB.zw;
  if (s.grid.y > 0.5 && b.x >= 0.0 && b.y >= 0.0 && b.x <= 1.0 && b.y <= 1.0) {
    return gLevel(b, GRID);
  }
  if (s.grid.x > 0.5) {
    return gLevel((rel - s.gridA.xy) * s.gridA.zw, 0);
  }
  return 0.0;
}
float heightAt(vec2 rel) {
  return groundAt(rel) * s.origin.z + s.origin.w;
}
float altAt(int sl) {
  /*@altAt*/
  return 0.0;
}
float altBetween(vec4 m, int j, float f) {
  if (ALT == 0) {
    return 0.0;
  }
  int n = int(m.y);
  int a = clamp(j, 0, max(n - 1, 0));
  int b = min(a + 1, max(n - 1, 0));
  return mix(altAt(slotOf(m, a)), altAt(slotOf(m, b)), f);
}
float timeShare(vec4 m, int j, float t) {
  int n = int(m.y);
  if (j < 0 || j >= n - 1) {
    return 0.0;
  }
  float ta = tAt(slotOf(m, j));
  float tb = tAt(slotOf(m, j + 1));
  return tb > ta ? clamp((t - ta) / (tb - ta), 0.0, 1.0) : 0.0;
}
float altNow(int e) {
  if (ALT == 0) {
    return 0.0;
  }
  int rows = (int(s.misc.z) + 4095) / 4096;
  vec4 b = round(texelFetch(found, ivec2(e % 4096, rows + e / 4096), 0) * 255.0);
  return (b.x + b.y * 256.0 + b.z * 65536.0) * 0.01 - 500.0;
}
float clearOf(vec2 rel, float alt) {
  if (ALT == 0) {
    return 0.0;
  }
  if (OVER_SEA == 1) {
    return max(alt - groundAt(rel), 0.0);
  }
  return max(alt, 0.0);
}
float heightOf(vec2 rel, float alt) {
  return heightAt(rel) + clearOf(rel, alt);
}
vec4 rampAt(float v) {
  float t = clamp((v - s.value.z) / max(s.value.w - s.value.z, 1e-9), 0.0, 1.0);
  return texelFetch(ramp, ivec2(int(t * 255.0 + 0.5), 0), 0);
}
vec4 colourOf(vec4 look, float v) {
  if (COLOR == 2) {
    return rampAt(v);
  }
  if (COLOR == 1) {
    return vec4(unpackRGB(look.x), 1.0);
  }
  return s.color;
}
vec3 gaugeColour(float f) {
  return f < 0.5 ? mix(s.gaugeLo.rgb, s.gaugeMid.rgb, f * 2.0) : mix(s.gaugeMid.rgb, s.gaugeHi.rgb, f * 2.0 - 1.0);
}
float sizeOf(vec4 look, float v) {
  if (SIZE == 2) {
    float t = clamp((v - s.sz.x) / max(s.sz.y - s.sz.x, 1e-9), 0.0, 1.0);
    return mix(s.sz.z, s.sz.w, t);
  }
  if (SIZE == 1) {
    return look.y;
  }
  return s.style.x;
}
float angleDiff(float a, float b) {
  float d = b - a;
  return d - 2.0 * PI * floor((d + PI) / (2.0 * PI));
}
float pieceHeading(vec4 m, int k) {
  int n = int(m.y);
  for (int back = 0; back < 6; back++) {
    int i = k - back;
    if (i >= 0 && i + 1 < n) {
      vec2 d = relAt(slotOf(m, i + 1)) - relAt(slotOf(m, i));
      if (dot(d, d) > 1e-20) {
        return atan(d.x, d.y);
      }
    }
  }
  return 0.0;
}
float headingAt(vec4 m, int j, float t) {
  int n = int(m.y);
  int k = clamp(j, 0, max(n - 2, 0));
  float h = pieceHeading(m, k);
  if (s.near.w <= 0.0 || n < 3) {
    return h;
  }
  float ta = tAt(slotOf(m, k));
  float tb = tAt(slotOf(m, k + 1));
  float tau = min(s.near.w, max(tb - ta, 0.001) * 0.5);
  if (k > 0 && t - ta < tau) {
    float h0 = pieceHeading(m, k - 1);
    return h0 + angleDiff(h0, h) * (0.5 + 0.5 * clamp((t - ta) / tau, 0.0, 1.0));
  }
  if (k + 2 < n && tb - t < tau) {
    float h1 = pieceHeading(m, k + 1);
    return h + angleDiff(h, h1) * 0.5 * (1.0 - clamp((tb - t) / tau, 0.0, 1.0));
  }
  return h;
}
`;
const DOTS = {
  vertex: /* glsl */ `
out vec2 v_corner;
out vec4 v_col;
flat out float v_id;
out float v_size;
void main() {
  int e = gl_InstanceID;
  vec4 m = liveOf(e);
  vec4 look = lookOf(e);
  vec4 w = whereAt(m, jOf(e), s.clock.x);
  int j = int(w.z);
  float v = valueBetween(m, j, w.w);
  vec2 corner = cornerOf(gl_VertexID);
  vec3 p = placeAt(w.xy, heightOf(w.xy, altNow(e)));
  float size = sizePx(sizeOf(look, v), s.dotSize, p);
  float on = (j >= 0 || s.misc.w > 0.5) ? 1.0 : 0.0;
  float d = length(frame.eye.xyz - p);
  float give = look.z > 0.5 ? 0.0 : 1.0;
  vec4 c = colourOf(look, v);
  vec3 lifted = towardEye(p, size);
  vec4 clip = frame.viewProj * vec4(lifted, 1.0);
  vec2 off = corner * size * frame.size.z / frame.size.xy * clip.w;
  bool hide = on < 0.5 || give <= 0.0 || m.y < 1.0 || behindGlobe(p);
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : clipOut(vec4(clip.xy + off, clip.z - s.style.w * clip.w, clip.w));
  v_corner = corner;
  v_col = vec4(c.rgb, c.a * give);
  v_id = float(e);
  v_size = size * frame.size.z;
}
`,
  fragment: /* glsl */ `
in vec2 v_corner;
in vec4 v_col;
flat in float v_id;
in float v_size;
out vec4 outColor;
void main() {
  float r = length(v_corner);
  float px = 2.0 / max(v_size, 1.0);
  float disc = 1.0 - smoothstep(1.0 - px, 1.0, r);
  float ring = s.style.y > 0.0 ? smoothstep(1.0 - px * (s.style.y + 1.0), 1.0 - px * s.style.y, r) : 0.0;
  vec3 rgb = mix(v_col.rgb, s.outline.rgb, ring * s.outline.a);
  float alpha = v_col.a * disc * s.style.z;
  if (alpha <= 0.002) {
    discard;
  }
  if (frame.pick.x > 0.5) {
    outColor = pickOut(s.misc.y, v_id);
    return;
  }
  outColor = vec4(themed(rgb, 0.0), alpha);
}
`,
};
const TRAILS = {
  vertex: /* glsl */ `
out vec4 v_col;
out float v_side;
out float v_px;
void main() {
  int K = max(int(s.clock.z), 1);
  int e = gl_InstanceID / K;
  int seg = gl_InstanceID - e * K;
  vec2 cs = cornerOf(gl_VertexID);
  vec4 m = liveOf(e);
  vec4 look = lookOf(e);
  int n = int(m.y);
  float t = s.clock.x;
  float tt = t - s.clock.y;
  int j = jOf(e);
  v_side = cs.y;
  v_px = 1.0;
  v_col = vec4(0.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (j < 0 || j - seg < 0 || m.y < 1.0) {
    return;
  }
  if (seg > 0 && tAt(slotOf(m, j - seg + 1)) <= tt) {
    return;
  }
  int ia = max(j - seg, 0);
  int sa = slotOf(m, ia);
  float ta = tAt(sa);
  vec2 pa = relAt(sa);
  float va = valueAt(sa);
  float aa = altAt(sa);
  vec2 pb = pa;
  float tb = ta;
  float vb = va;
  float ab = aa;
  if (seg == 0) {
    if (j < n - 1) {
      int sn = slotOf(m, j + 1);
      float t1 = tAt(sn);
      float f = t1 > ta ? clamp((t - ta) / (t1 - ta), 0.0, 1.0) : 0.0;
      pb = mix(pa, relAt(sn), f);
      tb = mix(ta, t1, f);
      vb = mix(va, valueAt(sn), f);
      ab = mix(aa, altAt(sn), f);
    }
  } else {
    int sb = slotOf(m, ia + 1);
    pb = relAt(sb);
    tb = tAt(sb);
    vb = valueAt(sb);
    ab = altAt(sb);
  }
  // (a step: the piece's value its first sample's, to the next)
  if (STEP == 1) {
    vb = va;
  }
  bool ok = j >= 0 && j - seg >= 0 && tb > tt && (distance(pa, pb) > 1e-12 || abs(ab - aa) > 0.01);
  if (ta < tt && tb > ta) {
    float f = (tt - ta) / (tb - ta);
    pa = mix(pa, pb, f);
    va = mix(va, vb, f);
    aa = mix(aa, ab, f);
    ta = tt;
  }
  float end = cs.x;
  float side = cs.y;
  vec3 A = towardEye(placeAt(pa, heightOf(pa, aa)), s.trail.z);
  vec3 B = towardEye(placeAt(pb, heightOf(pb, ab)), s.trail.z);
  vec4 ca = frame.viewProj * vec4(A, 1.0);
  vec4 cb = frame.viewProj * vec4(B, 1.0);
  float nearW = 0.01;
  if (ca.w < nearW && cb.w < nearW) {
    ok = false;
  }
  if (ca.w < nearW) {
    ca = mix(ca, cb, (nearW - ca.w) / (cb.w - ca.w));
  }
  if (cb.w < nearW) {
    cb = mix(cb, ca, (nearW - cb.w) / (ca.w - cb.w));
  }
  vec2 halfPx = frame.size.xy * 0.5;
  vec2 sa2 = ca.xy / ca.w * halfPx;
  vec2 sb2 = cb.xy / cb.w * halfPx;
  vec2 dir = sb2 - sa2;
  float len = length(dir);
  dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w2 = s.trail.x * frame.size.z * 0.5 + 0.5;
  vec4 c = end > 0.0 ? cb : ca;
  vec2 offPx = nrm * side * w2 + dir * end * w2;
  vec4 clip = vec4(c.xy + offPx / halfPx * c.w, c.z - s.style.w * c.w, c.w);
  float age = clamp(((end > 0.0 ? tb : ta) - tt) / max(s.clock.y, 0.001), 0.0, 1.0);
  vec4 col = s.trail.w > 0.5 ? s.trailColor : colourOf(look, end > 0.0 ? vb : va);
  float glow = s.clock.w * smoothstep(0.85, 1.0, age);
  bool hide = !ok || m.y < 1.0 || behindGlobe(end > 0.0 ? B : A);
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : clipOut(clip);
  v_col = vec4(mix(col.rgb, vec3(1.0), glow * 0.5), col.a * s.trail.y * pow(age, s.fx.x));
  v_side = side;
  v_px = w2;
}
`,
  fragment: /* glsl */ `
in vec4 v_col;
in float v_side;
in float v_px;
out vec4 outColor;
void main() {
  float edge = 1.0 - smoothstep(1.0 - 1.0 / max(v_px, 1.0), 1.0, abs(v_side));
  float alpha = v_col.a * edge;
  if (alpha <= 0.002) {
    discard;
  }
  outColor = vec4(themed(v_col.rgb, 0.0), alpha);
}
`,
};
const LINKS = {
  vertex: /* glsl */ `
uniform highp sampler2D links;
out vec4 v_col;
out float v_side;
out float v_px;
vec3 linkAt(vec2 a, vec2 b, float ha, float hb, float rise, float u) {
  vec2 p = mix(a, b, u);
  return towardEye(placeAt(p, mix(ha, hb, u) + rise * 4.0 * u * (1.0 - u)), 1.5);
}
void main() {
  int SEG = max(int(s.linkMore.x), 1);
  int e = gl_InstanceID / SEG;
  int k = gl_InstanceID - e * SEG;
  vec2 cs = cornerOf(gl_VertexID);
  vec4 m = liveOf(e);
  vec4 look = lookOf(e);
  vec4 L = texelFetch(links, ivec2(e % 4096, e / 4096), 0);
  vec4 w = whereAt(m, jOf(e), s.clock.x);
  int j = int(w.z);
  v_side = cs.y;
  v_px = 1.0;
  v_col = vec4(0.0);
  gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
  if (L.w < 0.5 || m.y < 1.0 || (j < 0 && s.misc.w < 0.5)) {
    return;
  }
  float span = length((L.xy - w.xy) * vec2(RE * frame.misc.y, RE * frame.misc.y));
  float rise = s.link.y > 0.0 ? s.link.y : min(span * 0.25, 400.0);
  float hb = L.z * s.origin.z;
  float ha = heightOf(w.xy, altNow(e));
  vec3 A = linkAt(w.xy, L.xy, ha, hb, rise, float(k) / float(SEG));
  vec3 B = linkAt(w.xy, L.xy, ha, hb, rise, float(k + 1) / float(SEG));
  vec4 ca = frame.viewProj * vec4(A, 1.0);
  vec4 cb = frame.viewProj * vec4(B, 1.0);
  if (ca.w < 0.01 || cb.w < 0.01) {
    return;
  }
  vec2 halfPx = frame.size.xy * 0.5;
  vec2 sa2 = ca.xy / ca.w * halfPx;
  vec2 sb2 = cb.xy / cb.w * halfPx;
  vec2 dir = sb2 - sa2;
  float len = length(dir);
  dir = len > 1e-6 ? dir / len : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float w2 = sizePx(s.link.x, s.linkMore.yzwx * vec4(1.0, 1.0, 1.0, 0.0), A) * frame.size.z * 0.5 + 0.5;
  float end = cs.x;
  vec4 c = end > 0.0 ? cb : ca;
  vec2 offPx = nrm * cs.y * w2 + dir * end * w2;
  gl_Position = clipOut(vec4(c.xy + offPx / halfPx * c.w, c.z - s.style.w * c.w, c.w));
  bool focus = look.w > 0.5;
  v_col = vec4(s.linkColor.rgb, s.linkColor.a * (focus ? s.link.w : s.link.z) * s.style.z);
  v_px = w2;
}
`,
  fragment: /* glsl */ `
in vec4 v_col;
in float v_side;
in float v_px;
out vec4 outColor;
void main() {
  float edge = 1.0 - smoothstep(1.0 - 1.0 / max(v_px, 1.0), 1.0, abs(v_side));
  float alpha = v_col.a * edge;
  if (alpha <= 0.002) {
    discard;
  }
  outColor = vec4(themed(v_col.rgb, 0.0), alpha);
}
`,
};
const MODELS = {
  vertex: /* glsl */ `
/*@jointColumnBinding*/
/*@poseBinding*/
vec2 poseOf(int e) {
  /*@poseOf*/
  return vec2(0.0, 0.0);
}
vec3 attitude(vec3 p, vec2 pb) {
  float cb = cos(pb.y);
  float sb = sin(pb.y);
  vec3 b = vec3(p.x * cb - p.y * sb, p.x * sb + p.y * cb, p.z);
  float cp = cos(pb.x);
  float sp = sin(pb.x);
  return vec3(b.x, b.y * cp + b.z * sp, b.z * cp - b.y * sp);
}
float jointColumnAt(int sl) {
  /*@jointColumnAt*/
  return 0.0;
}
float jointColumn(vec4 m, int j, float f) {
  int n = int(m.y);
  int a = clamp(j, 0, max(n - 1, 0));
  int b = min(a + 1, max(n - 1, 0));
  return mix(jointColumnAt(slotOf(m, a)), jointColumnAt(slotOf(m, b)), j < 0 ? 0.0 : f);
}
vec3 rotAxis(vec3 p, vec3 a, float t) {
  float c = cos(t);
  return p * c + cross(a, p) * sin(t) + a * dot(a, p) * (1.0 - c);
}
float jointFormula(int k, float time, float seed) {
  /*@jointFormula*/
  return 0.0;
}
float jointValue(int k, float seed, vec4 m, int j, float f) {
  vec4 d = s.parts[k * 4 + 2];
  float kind = s.parts[k * 4].w;
  float v = 0.0;
  if (d.x == 1.0) {
    v = seed * 6.2831853 + d.y * (frame.eye.w - s.pc.y) + s.parts[k * 4 + 3].z;
  } else if (d.x == 2.0) {
    v = jointFormula(k, frame.eye.w, seed) * (kind == 3.0 ? 1.0 : 0.017453293);
  } else if (d.x == 3.0) {
    float u = jointColumn(m, j, f) * d.y;
    v = kind == 3.0 ? u : (kind == 2.0 ? u / max(s.parts[k * 4 + 1].w, 0.001) : u * 0.017453293);
  }
  if (d.z < d.w) {
    v = clamp(v, d.z, d.w);
  }
  return v;
}
void jointMove(vec3 q, vec3 n, int part, float seed, vec4 m, int j, float f, out vec3 mq, out vec3 mn) {
  mq = q;
  mn = n;
  if (part == 0) {
    return;
  }
  for (int k = 0; k < int(s.pc.x); k++) {
    if (int(s.parts[k * 4 + 3].x + 0.5) != part) {
      continue;
    }
    vec4 pv = s.parts[k * 4];
    vec3 ax = s.parts[k * 4 + 1].xyz;
    float v = jointValue(k, seed, m, j, f);
    if (pv.w == 3.0) {
      mq = mq + ax * v;
    } else {
      mq = pv.xyz + rotAxis(mq - pv.xyz, ax, v);
      mn = rotAxis(mn, ax, v);
    }
  }
}
layout(location = 0) in float ent;
layout(location = 3) in vec4 v;
layout(location = 4) in float vc;
layout(location = 5) in float card;
out vec3 v_col;
out vec3 v_n;
flat out float v_id;
void main() {
  int e = int(ent + 0.5);
  vec4 m = liveOf(e);
  vec4 look = lookOf(e);
  float t = s.clock.x;
  vec4 w = whereAt(m, jOf(e), t);
  int j = int(w.z);
  vec3 p = placeAt(w.xy, heightOf(w.xy, altNow(e)) - s.origin.w);
  float d = length(frame.eye.xyz - p);
  float a = headingAt(m, j, t) + PI;
  float c = cos(a);
  float sn = sin(a);
  float keep = s.shapeSize.w > 0.5 ? sizeKeep(s.shapeSize.x * s.near.y, vec4(1.0, s.shapeSize.y, s.shapeSize.z, 0.0), p) : 1.0;
  int ci = card >= 65536.0 ? 0 : int(card + 0.5);
  vec3 mq; vec3 mn;
  jointMove(v.xyz, unpackNormal(v.w), (ci / 512) % 16, fract(float(e) * 0.6180339887), m, j, w.w, mq, mn);
  vec3 q = mq * s.near.y * keep;
  vec3 n = mn;
  vec2 pb = poseOf(e);
  if (pb.x != 0.0 || pb.y != 0.0) {
    vec3 pv = s.pivot.xyz * s.near.y * keep;
    q = pv + attitude(q - pv, pb);
    n = attitude(n, pb);
  }
  vec3 r = vec3(q.x * c - q.z * sn, q.y, q.x * sn + q.z * c);
  bool hide = (j < 0 && s.misc.w < 0.5) || m.y < 1.0;
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : clipOut(frame.viewProj * vec4(p + r, 1.0));
  v_n = vec3(n.x * c - n.z * sn, n.y, n.x * sn + n.z * c);
  bool own = card < 65536.0 && (ci % 512) >= 256;
  vec4 col = colourOf(look, valueBetween(m, j, w.w));
  v_col = (own ? vec3(1.0) : col.rgb) * unpackRGB(vc);
  v_id = float(e);
}
`,
  fragment: /* glsl */ `
in vec3 v_col;
in vec3 v_n;
flat in float v_id;
out vec4 outColor;
void main() {
  vec3 n = normalize(v_n);
  bool lit = frame.sunColor.a > 0.5;
  vec3 L = lit ? normalize(frame.sun.xyz) : normalize(vec3(0.4, 0.8, 0.45));
  float diff = max(dot(n, L), 0.0);
  vec3 rgb = lit ? v_col * (frame.ambient.rgb + frame.sunColor.rgb * diff) : v_col * (0.55 + 0.45 * diff);
  if (frame.pick.x > 0.5) {
    outColor = pickOut(s.misc.y, v_id);
    return;
  }
  outColor = vec4(themed(rgb, 0.0), 1.0);
}
`,
};
// the shapes' contact shadow (sets.wgsl.ts' SHADOW)
const SHADOW = {
  vertex: /* glsl */ `
layout(location = 0) in float ent;
out vec2 v_uv;
out float v_fade;
vec2 shadowAt(float up) {
  if (s.shadowLook.w > 0.0 && up > s.shadowLook.w) {
    return vec2(0.0, 0.0);
  }
  float u = s.shadowLook.z > 0.0 ? clamp(up / max(s.shadowLook.z, 0.001), 0.0, 1.0) : 0.0;
  return vec2(1.0 - 0.5 * u, (1.0 - u) * (1.0 - u));
}
void main() {
  int e = int(ent + 0.5);
  vec4 m = liveOf(e);
  float t = s.clock.x;
  vec4 w = whereAt(m, jOf(e), t);
  int j = int(w.z);
  vec3 p = placeAt(w.xy, heightAt(w.xy) - s.origin.w + 0.03);
  vec2 left = shadowAt(clearOf(w.xy, altNow(e)));
  float d = length(frame.eye.xyz - p);
  float a = headingAt(m, j, t) + PI;
  float c = cos(a);
  float sn = sin(a);
  vec2 uv = cornerOf(gl_VertexID);
  float keep = s.shapeSize.w > 0.5 ? sizeKeep(s.shapeSize.x * s.near.y, vec4(1.0, s.shapeSize.y, s.shapeSize.z, 0.0), p) : 1.0;
  vec2 q = vec2(s.shadow.z + uv.x * s.shadow.x, s.shadow.w + uv.y * s.shadow.y) * s.near.y * keep * left.x;
  vec3 r = vec3(q.x * c - q.y * sn, 0.0, q.x * sn + q.y * c);
  bool hide = (j < 0 && s.misc.w < 0.5) || m.y < 1.0 || left.y <= 0.002;
  vec4 clip = frame.viewProj * vec4(towardEye(p + r, 20.0), 1.0);
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : clipOut(clip);
  v_uv = uv;
  v_fade = left.y;
}
`,
  fragment: /* glsl */ `
in vec2 v_uv;
in float v_fade;
out vec4 outColor;
void main() {
  float k = s.shadowLook.y;
  vec2 q = max(abs(v_uv) - vec2(k), vec2(0.0)) / max(1.0 - k, 0.001);
  float f = 1.0 - smoothstep(0.0, 1.0, length(q));
  float alpha = s.shadowLook.x * f * f * s.style.z * v_fade;
  if (alpha <= 0.002) {
    discard;
  }
  outColor = vec4(0.0, 0.0, 0.0, alpha);
}
`,
};
// the gauge's label: its glyphs (0–9 and %: fill r, halo g)
const GAUGE_LABEL = /* glsl */ `
uniform highp sampler2D glyphs;
int digitOf(int v, int place) {
  int p = place == 2 ? 100 : (place == 1 ? 10 : 1);
  return (v / p) % 10;
}
vec2 glyphAt(int code, float x, float y) {
  if (x < 0.0 || x > s.glyph.w || y < 0.0 || y > 1.0) {
    return vec2(0.0, 0.0);
  }
  vec2 uv = vec2((float(code) * s.glyph.w + x) / (11.0 * s.glyph.w), y);
  return textureLod(glyphs, uv, 0.0).rg;
}
vec2 labelAt(vec2 q, vec2 px, int pct) {
  float h = s.labelText.w * frame.size.z;
  int n = pct >= 100 ? 4 : (pct >= 10 ? 3 : 2);
  float w = (float(n - 1) * s.glyph.x + s.glyph.y) * h;
  float x = (q.x - (px.x - w) * 0.5) / h;
  float y = ((px.y + h) * 0.5 - q.y) / h;
  int k = clamp(int(floor(x / s.glyph.x)), 0, n - 1);
  vec2 outv = vec2(0.0, 0.0);
  for (int j = max(k - 1, 0); j <= min(k + 1, n - 1); j++) {
    int code = j == n - 1 ? 10 : digitOf(pct, n - 2 - j);
    outv = max(outv, glyphAt(code, x - float(j) * s.glyph.x + s.glyph.z, y));
  }
  return outv;
}
`;
const gauge = (v: SetsVariant) => ({
  vertex: /* glsl */ `
out vec2 v_uv;
out float v_fill;
out vec3 v_col;
out vec2 v_px;
flat out float v_id;
flat out float v_pct;
void main() {
  int e = gl_InstanceID;
  vec4 m = liveOf(e);
  vec4 w = whereAt(m, jOf(e), s.clock.x);
  int j = int(w.z);
  float f = clamp((valueBetween(m, j, w.w) - s.fx.z) / max(s.fx.w - s.fx.z, 1e-9), 0.0, 1.0);
  vec2 corner = cornerOf(gl_VertexID);
  vec3 p0 = placeAt(w.xy, heightOf(w.xy, altNow(e)) - s.origin.w + s.gauge.z);
  float d = length(frame.eye.xyz - p0);
  bool hide = (j < 0 && s.misc.w < 0.5) || m.y < 1.0 || d > s.gauge.w || behindGlobe(p0);
  vec3 p = p0 + (frame.eye.xyz - p0) / max(d, 0.001) * min(s.fx.y, d * 0.5);
  vec4 clip = frame.viewProj * vec4(p, 1.0);
  vec2 off = corner * s.gauge.xy * frame.size.z / frame.size.xy * clip.w;
  gl_Position = hide ? vec4(2.0, 2.0, 2.0, 1.0) : clipOut(vec4(clip.xy + off, clip.z - s.style.w * clip.w, clip.w));
  v_uv = corner * 0.5 + 0.5;
  v_fill = f;
  v_col = gaugeColour(f);
  v_px = s.gauge.xy * frame.size.z;
  v_id = float(e);
  v_pct = floor(f * 100.0 + 0.5);
}
`,
  fragment: /* glsl */ `${v.label ? GAUGE_LABEL : ''}
in vec2 v_uv;
in float v_fill;
in vec3 v_col;
in vec2 v_px;
flat in float v_id;
flat in float v_pct;
out vec4 outColor;
void main() {
  vec2 q = v_uv * v_px;
  float edge = min(min(q.x, v_px.x - q.x), min(q.y, v_px.y - q.y));
  bool line = edge < frame.size.z;
  bool full = v_uv.x <= v_fill;
  vec3 rgb = line ? s.gaugeLine.rgb : (full ? v_col : vec3(0.08, 0.1, 0.12));
  float alpha = (line ? s.gaugeLine.a : (full ? 1.0 : 0.6)) * s.style.z;${v.label ? `
  vec2 t = labelAt(q, v_px, int(v_pct));
  rgb = mix(mix(rgb, s.labelHalo.rgb, t.y * s.labelHalo.a), s.labelText.rgb, t.x * s.labelText.a);
  alpha = max(alpha, max(t.x * s.labelText.a, t.y * s.labelHalo.a) * s.style.z);` : ''}
  if (frame.pick.x > 0.5) {
    outColor = pickOut(s.misc.y, v_id);
    return;
  }
  outColor = vec4(themed(rgb, 0.0), alpha);
}
`,
});
const FOLDED = /* glsl */ `
uniform highp sampler2D fold;
vec4 foldAt(int k) {
  return texelFetch(fold, ivec2(k % 4096, k / 4096), 0);
}
bool foldedAt(int e, float t) {
  vec4 ix = foldAt(e);
  int n = int(ix.y);
  int a = int(ix.x);
  if (n <= 0 || foldAt(a).x > t) {
    return false;
  }
  int lo = 0;
  int hi = n - 1;
  for (int k = 0; k < 24; k++) {
    if (hi <= lo) {
      break;
    }
    int mid = (lo + hi + 1) / 2;
    if (foldAt(a + mid).x <= t) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return t < foldAt(a + lo).y;
}
`;
const FOUND = {
  vertex: /* glsl */ `
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}
`,
  fragment: (v: SetsVariant) => /* glsl */ `${v.fold ? FOLDED : ''}
out vec4 outColor;
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int rows = (int(s.misc.z) + 4095) / 4096;
  if (ALT > 0 && q.y >= rows) {
    int ea = (q.y - rows) * 4096 + q.x;
    if (ea >= int(s.misc.z)) {
      outColor = vec4(0.0);
      return;
    }
    vec4 ma = metaOf(ea);
    int ja = sampleAt(ma, s.clock.x);
    float u = clamp(round((altBetween(ma, ja, timeShare(ma, ja, s.clock.x)) + 500.0) * 100.0), 0.0, 16777215.0);
    float hi = floor(u / 65536.0);
    float mid = floor((u - hi * 65536.0) / 256.0);
    outColor = vec4(u - hi * 65536.0 - mid * 256.0, mid, hi, 255.0) / 255.0;
    return;
  }
  int e = q.y * 4096 + q.x;
  if (e >= int(s.misc.z)) {
    outColor = vec4(0.0);
    return;
  }
  int j = sampleAt(metaOf(e), s.clock.x) + 1;
  bool folded = ${v.fold ? 'foldedAt(e, s.clock.x)' : 'false'};
  outColor = vec4(float(j % 256), float((j / 256) % 256), float(j / 65536), folded ? 0.0 : 255.0) / 255.0;
}
`,
};
// the pose pass (sets.wgsl.ts' pose)
const POSE = {
  fragment: (v: SetsVariant) => {
    const P = v.pose!, kind = (x: string) => (x === 'climb' || x === 'turn' ? 1 : x === 'u8' ? 2 : x === 'f32' ? 3 : 0);
    return /* glsl */ `
const int PITCH = ${kind(P.pitch)};
const int BANK = ${kind(P.bank)};
${P.pitch === 'u8' || P.pitch === 'f32' ? 'uniform highp sampler2D pitchCol;' : ''}
${P.bank === 'u8' || P.bank === 'f32' ? 'uniform highp sampler2D bankCol;' : ''}
out vec4 outColor;
float columnAt(vec4 b, int col, bool isByte, float lo, float hi) {
  if (!isByte) {
    return b.x;
  }
  int c = col % 4;
  float v = c == 0 ? b.x : (c == 1 ? b.y : (c == 2 ? b.z : b.w));
  return lo + v * (hi - lo);
}
float pitchAt(int sl) {
  ${P.pitch === 'u8' ? 'return columnAt(texelFetch(pitchCol, ivec2((sl % ROW) / 4, sl / ROW), 0), sl % ROW, true, s.attv.x, s.attv.y);' : P.pitch === 'f32' ? 'return columnAt(texelFetch(pitchCol, ivec2(sl % ROW, sl / ROW), 0), 0, false, 0.0, 0.0);' : 'return 0.0;'}
}
float bankAt(int sl) {
  ${P.bank === 'u8' ? 'return columnAt(texelFetch(bankCol, ivec2((sl % ROW) / 4, sl / ROW), 0), sl % ROW, true, s.attv.z, s.attv.w);' : P.bank === 'f32' ? 'return columnAt(texelFetch(bankCol, ivec2(sl % ROW, sl / ROW), 0), 0, false, 0.0, 0.0);' : 'return 0.0;'}
}
float metresAt(vec2 rel) {
  float lat = 2.0 * atan(exp(frame.geo.x + s.origin.y + rel.y)) - PI * 0.5;
  return RE * cos(lat);
}
float turnShare(float x, float tk, float tl, float tr) {
  if (x < tk) {
    return 0.5 * clamp(1.0 - (tk - x) / max(tl, 0.001), 0.0, 1.0);
  }
  return 0.5 + 0.5 * clamp((x - tk) / max(tr, 0.001), 0.0, 1.0);
}
vec2 pathPose(vec4 m, int j, float t) {
  int n = int(m.y);
  if (n < 2) {
    return vec2(0.0, 0.0);
  }
  float D = max(s.att.x, 0.05);
  float tw = s.near.w <= 0.0 ? D : s.near.w;
  float t0 = max(t - D, tAt(slotOf(m, 0)));
  float t1 = min(t + D, tAt(slotOf(m, n - 1)));
  int k0 = clamp(j, 0, n - 2);
  for (int i = 0; i < 24; i++) {
    if (k0 <= 0 || tAt(slotOf(m, k0)) <= t0 - tw) {
      break;
    }
    k0 = k0 - 1;
  }
  int k1 = clamp(j, 0, n - 2);
  for (int i = 0; i < 24; i++) {
    if (k1 >= n - 2 || tAt(slotOf(m, k1 + 1)) >= t1 + tw) {
      break;
    }
    k1 = k1 + 1;
  }
  float len = 0.0;
  float turn = 0.0;
  float a0 = altAt(slotOf(m, k0));
  float a1 = a0;
  float tp = tAt(slotOf(m, max(k0 - 1, 0)));
  for (int k = k0; k <= k1; k++) {
    int sa = slotOf(m, k);
    int sb = slotOf(m, k + 1);
    float ta = tAt(sa);
    float tb = tAt(sb);
    float dt = max(tb - ta, 0.0001);
    vec2 pa = relAt(sa);
    float inside = max(min(tb, t1) - max(ta, t0), 0.0);
    len = len + length(relAt(sb) - pa) * metresAt(pa) * inside / dt;
    if (t0 >= ta && t0 <= tb) {
      a0 = mix(altAt(sa), altAt(sb), clamp((t0 - ta) / dt, 0.0, 1.0));
    }
    if (t1 >= ta && t1 <= tb) {
      a1 = mix(altAt(sa), altAt(sb), clamp((t1 - ta) / dt, 0.0, 1.0));
    }
    if (k > 0) {
      float d = angleDiff(pieceHeading(m, k - 1), pieceHeading(m, k));
      float tl = min(tw, max(ta - tp, 0.001) * 0.5);
      float tr = min(tw, dt * 0.5);
      turn = turn + d * (turnShare(t1, ta, tl, tr) - turnShare(t0, ta, tl, tr));
    }
    tp = ta;
  }
  float span = max(t1 - t0, 0.001);
  return vec2(atan(a1 - a0, max(len, 0.001)), atan(((len / span) * (turn / span)) / 9.80665));
}
vec2 poseAt(vec4 m, int j, float f, float t, float up) {
  vec2 pb = vec2(0.0, 0.0);
  if (PITCH == 1 || BANK == 1) {
    pb = pathPose(m, j, t);
  }
  float pitch = PITCH == 1 ? clamp(pb.x, -s.att.y, s.att.y) : 0.0;
  float off = ALT > 0 ? smoothstep(0.0, 1.0, up / max(s.att.w, 0.001)) : 1.0;
  float bank = BANK == 1 ? clamp(pb.y, -s.att.z, s.att.z) * off : 0.0;
  int n = int(m.y);
  int a = slotOf(m, clamp(j, 0, max(n - 1, 0)));
  int b = slotOf(m, min(clamp(j, 0, max(n - 1, 0)) + 1, max(n - 1, 0)));
  if (PITCH >= 2) {
    pitch = mix(pitchAt(a), pitchAt(b), f) * 0.017453293;
  }
  if (BANK >= 2) {
    bank = mix(bankAt(a), bankAt(b), f) * 0.017453293;
  }
  return vec2(pitch, bank);
}
void main() {
  ivec2 q = ivec2(gl_FragCoord.xy);
  int e = q.y * 4096 + q.x;
  if (e >= int(s.misc.z) || lookOf(e).z < 0.5) {
    outColor = vec4(0.0, 128.0, 0.0, 128.0) / 255.0;
    return;
  }
  vec4 m = liveOf(e);
  vec4 w = whereAt(m, jOf(e), s.clock.x);
  vec2 pb = poseAt(m, int(w.z), w.w, s.clock.x, clearOf(w.xy, altNow(e)));
  vec2 u = round(clamp(pb / PI + vec2(0.5), vec2(0.0), vec2(1.0)) * 65535.0);
  vec2 hi = floor(u / 256.0);
  outColor = vec4(u.x - hi.x * 256.0, hi.x, u.y - hi.y * 256.0, hi.y) / 255.0;
}
`;
  },
};
/** what a thing placed on a set's things reads on the chip (the twin of setsTrackWGSL): the set's block S, its samplers
 *  and its functions */
export function setsTrackGLSL(v: SetsVariant): string { return head(v) + COMMON; }
/** a set's program on WebGL2: the found pass (each thing's sample at the time), the dots, the trails or the shapes
 *  near the camera, for the set's columns */
export function setsGLSL(kind: 'found' | 'pose' | 'dots' | 'trails' | 'models' | 'gauge' | 'shadow' | 'links', v: SetsVariant): { vertex: string; fragment: string } {
  const COMMON_ = v.alt && BY_SAMPLE.has(kind) ? COMMON.replace('/*@altAt*/', ALT_AT_GLSL) : COMMON, h = head(v, kind);
  if (kind === 'found') return { vertex: h + FOUND.vertex, fragment: h + COMMON_ + FOUND.fragment(v) };
  if (kind === 'pose') return { vertex: h + FOUND.vertex, fragment: h + COMMON_ + POSE.fragment(v) };
  const p = kind === 'dots' ? DOTS : kind === 'trails' ? TRAILS : kind === 'gauge' ? gauge(v) : kind === 'shadow' ? SHADOW : kind === 'links' ? LINKS : MODELS;
  return { vertex: h + COMMON_ + (kind === 'models' ? p.vertex.replace('/*@jointFormula*/', v.formula?.glsl ?? '').replace('/*@jointColumnBinding*/', v.joint === 'f32' ? 'uniform highp sampler2D jcol;' : '').replace('/*@jointColumnAt*/', v.joint === 'f32' ? 'return texelFetch(jcol, ivec2(sl % ROW, sl / ROW), 0).x;' : '')
    .replace('/*@poseBinding*/', v.pose ? 'uniform highp sampler2D pose;' : '')
    .replace('/*@poseOf*/', v.pose ? 'vec4 b = round(texelFetch(pose, ivec2(e % 4096, e / 4096), 0) * 255.0);\n  return (vec2(b.x + b.y * 256.0, b.z + b.w * 256.0) / 65535.0 - vec2(0.5)) * PI;' : '') : p.vertex), fragment: h + p.fragment };
}
/** the altitude's column read at a slot (sets.wgsl.ts' ALT_AT_WGSL) */
const ALT_AT_GLSL = `int col = sl % ROW;
  int row = sl / ROW;
  if (ALT == 1) {
    vec4 b = texelFetch(acol, ivec2(col / 4, row), 0);
    int c = col % 4;
    return s.air.x + (c == 0 ? b.x : (c == 1 ? b.y : (c == 2 ? b.z : b.w))) * (s.air.y - s.air.x);
  }
  if (ALT == 2) {
    return texelFetch(acol, ivec2(col, row), 0).x;
  }`;
