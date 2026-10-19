// What every shape's shaders unpack: a colour as one number, an octahedral normal, a leaf card's code and its cut-out
// (solids, their instances, the impostors and their baking). Twin: shape-fns.glsl.ts.
export const SHAPE_FNS_WGSL = /* wgsl */ `
fn unpackRGB(c: f32) -> vec3f {
  let i = u32(round(c));
  return vec3f(f32((i >> 16u) & 255u), f32((i >> 8u) & 255u), f32(i & 255u)) / 255.0;
}
// octahedral normal (world axes: x east, y up, z south)
fn unpackNormal(n: f32) -> vec3f {
  let i = u32(round(n));
  let e = vec2f(f32(i >> 12u), f32(i & 4095u)) / 4095.0 * 2.0 - vec2f(1.0, 1.0);
  var v = vec3f(e.x, e.y, 1.0 - abs(e.x) - abs(e.y));
  let k = max(-v.z, 0.0);
  v.x = v.x + select(k, -k, v.x >= 0.0);
  v.y = v.y + select(k, -k, v.y >= 0.0);
  return normalize(vec3f(v.x, v.z, v.y));
}
// a leaf card's code (0: solid) → (u, v, kind): 1 + u + v · 256 + kind · 65536, u and v 0 or 255 at the corners
fn unpackCard(c: f32) -> vec3f {
  let code = round(c);
  if (code < 65536.0) {
    return vec3f(0.0, 0.0, 0.0);
  }
  let kind = floor(code / 65536.0);
  let rest = code - kind * 65536.0 - 1.0;
  return vec3f((rest - 256.0 * floor(rest / 256.0)) / 255.0, floor(rest / 256.0) / 255.0, kind);
}
// a cluster of leaves on a card: 1 inside a leaf, 0 between them (kind 1 broad, 2 needles, 3 narrow hanging leaves)
fn leafMask(uv: vec2f, kind: f32) -> f32 {
  let p = uv * 2.0 - vec2f(1.0, 1.0);
  var hit = 0.0;
  for (var k = 0; k < 9; k++) {
    let a = f32(k) * 2.39996 + kind * 1.3;
    let r = select(0.62 * sqrt(f32(k) / 8.0), 0.0, k == 0);
    let c = vec2f(cos(a), sin(a)) * r;
    let dir = select(normalize(c + vec2f(0.0001, 0.0)), vec2f(0.0, 1.0), k == 0);
    let d = p - c;
    let along = dot(d, dir);
    let across = dot(d, vec2f(-dir.y, dir.x));
    let len = select(select(0.5, 0.55, kind > 2.5), 0.55, kind > 1.5 && kind < 2.5);
    let wid = select(select(0.3, 0.12, kind > 2.5), 0.04, kind > 1.5 && kind < 2.5);
    hit = max(hit, step((along * along) / (len * len) + (across * across) / (wid * wid), 1.0));
  }
  return hit;
}
`;
