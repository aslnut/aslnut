// The surface of a body: web-map tiles on the globe and flat, with terrain. All visible tiles are one instanced draw:
// a tile's record (7 texels of the `tiles` texture) says where it is, which imagery layer it shows, what was under
// it while it fades in, and where its heights are (its own, or its nearest ancestor's piece while they load: a tile
// never sits at sea level next to raised neighbours). The vertex shader places each point on the globe and on the
// flat map and blends them by the morph, with centre-relative numbers only. The world's sea with a look (modules ›
// world › earth › water › sea): its block and the coast's field (SEA_LOOK_WGSL). Hooks: /*@position*/, /*@color*/.
// Twin: surface.glsl.ts.
import { FRAME_WGSL } from './frame.wgsl.ts';
import { LIGHT_WGSL } from './light.wgsl.ts';
import { SEA_LOOK_WGSL } from './sea.wgsl.ts';

export const SURFACE_WGSL = /* wgsl */ `${FRAME_WGSL}
// a: (lat0, cos lat0, sin lat0, morph) · b: (exaggeration, shade, fog near, fog far) · tint: (rgb, amount)
// grade: (saturation, brightness, contrast, detail) · base: (rgb, imagery) · missing: (rgb, 1) · sea: (rgb: its
// colour, r < 0 none; its level × the exaggeration, m)
struct U { a: vec4f, b: vec4f, empty: vec4f, horizon: vec4f, tint: vec4f, grade: vec4f, base: vec4f, missing: vec4f, sea: vec4f }
@group(0) @binding(1) var<uniform> u: U;
struct Params { /*@params*/ }
@group(0) @binding(2) var<uniform> params: Params;
@group(1) @binding(0) var imagery: texture_2d_array<f32>;
@group(1) @binding(1) var tiles: texture_2d<f32>;
@group(1) @binding(2) var heights: texture_2d_array<f32>;
// the ground marks drawn into the tiles (premultiplied): a layer per tile, r6 says which (or an ancestor's piece)
@group(1) @binding(3) var overlay: texture_2d_array<f32>;
@group(1) @binding(6) var smp: sampler;
${LIGHT_WGSL(4)}
${SEA_LOOK_WGSL(3, 5)}
const N = 33;
const M = 35;
const RE = 6378137.0;
const PI = 3.141592653589793;
/*@functions*/
fn s2(a: f32) -> f32 {
  let s = sin(a * 0.5);
  return 2.0 * s * s;
}
fn rec(ii: i32, k: i32) -> vec4f {
  return textureLoad(tiles, vec2i(k, ii), 0);
}
fn hLoad(slot: i32, x: i32, y: i32) -> f32 {
  return textureLoad(heights, vec2i(x, y), slot, 0).x;
}
fn hGrid(slot: i32, x: f32, y: f32) -> f32 {
  let x0 = i32(clamp(floor(x), 0.0, f32(N - 1)));
  let y0 = i32(clamp(floor(y), 0.0, f32(N - 1)));
  let x1 = min(x0 + 1, N - 1);
  let y1 = min(y0 + 1, N - 1);
  let fx = clamp(x - f32(x0), 0.0, 1.0);
  let fy = clamp(y - f32(y0), 0.0, 1.0);
  return mix(mix(hLoad(slot, x0, y0), hLoad(slot, x1, y0), fx), mix(hLoad(slot, x0, y1), hLoad(slot, x1, y1), fx), fy);
}
// r1: (mercator span, imagery slot, height slot, pole edge) · r3: (under, fade, rise, parent height slot) · r5: parent uv
fn hAt(r1: vec4f, r3: vec4f, r5: vec4f, i: i32, j: i32) -> f32 {
  var par = 0.0;
  if (r3.w >= 0.0) {
    let g = f32(N - 1);
    par = hGrid(i32(r3.w), (f32(i) / g * r5.x + r5.z) * g, (f32(j) / g * r5.y + r5.w) * g);
  }
  if (r1.z < 0.0) {
    return par * u.b.x;
  }
  let r = r3.z * r3.z * (3.0 - 2.0 * r3.z);
  return mix(par, hLoad(i32(r1.z), i, j), r) * u.b.x;
}
struct O {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) @interpolate(flat) slot: f32,
  @location(2) world: vec3f,
  @location(3) light: f32,
  @location(4) uv2: vec2f,
  @location(5) @interpolate(flat) under: vec2f,
  @location(6) tuv: vec2f,
  @location(7) height: f32,
  @location(8) normal: vec3f,
  @location(9) ouv: vec2f,
  @location(10) @interpolate(flat) oslot: f32,
  @location(11) @interpolate(flat) known: f32,
}
@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> O {
  let ii = i32(iid);
  let r0 = rec(ii, 0);
  let r1 = rec(ii, 1);
  let r2 = rec(ii, 2);
  let r3 = rec(ii, 3);
  let r4 = rec(ii, 4);
  let r5 = rec(ii, 5);
  let r6 = rec(ii, 6);
  let v = i32(vid);
  let gi = v % M;
  let gj = v / M;
  let i = clamp(gi - 1, 0, N - 1);
  let j = clamp(gj - 1, 0, N - 1);
  let skirt = gi == 0 || gj == 0 || gi == M - 1 || gj == M - 1;
  let fu = f32(i) / f32(N - 1);
  let fv = f32(j) / f32(N - 1);
  let dl = r0.x + fu * r0.y;
  var lat = 2.0 * atan(exp(r0.z - fv * r1.x)) - PI * 0.5;
  // web-map tiles stop at ±85°: on the globe the first and last rows reach the poles
  if (r1.w == 1.0 && j == 0) {
    lat = mix(PI * 0.5, lat, u.a.w);
  }
  if (r1.w == 2.0 && j == N - 1) {
    lat = mix(-PI * 0.5, lat, u.a.w);
  }
  let edgeM = RE * u.a.y * r0.y;
  let h0 = hAt(r1, r3, r5, i, j);
  var h = h0;
  // the skirt: a ring that hangs down, so tiles of different levels never show a crack. Every tile has one while the
  // world has terrain (a tile still without heights of its own or its parent's meets neighbours that have them)
  if (skirt && (r1.z >= 0.0 || r3.w >= 0.0 || u.b.x > 0.0)) {
    h = min(h0 - min(edgeM * 0.015, 2500.0), -50.0);
  }
  // the sea's look: the water at its level over the floor, the coast deciding near it (modules › … › water › sea)
  if (sea.a.x > 0.5 && u.sea.r >= 0.0 && !skirt && (r1.z >= 0.0 || r3.w >= 0.0)) {
    let c0 = RE * u.a.y;
    h = seaGround(vec3f(c0 * dl, 0.0, -c0 * (r0.w - fv * r1.x)), h, u.sea.a);
  }
  let dp = lat - u.a.x;
  let rr = RE + h;
  let cl = cos(lat);
  let k = s2(dp) + u.a.y * cl * s2(dl);
  let G = vec3f(rr * cl * sin(dl), h - rr * k, -rr * (sin(dp) + u.a.z * cl * s2(dl)));
  let c = RE * u.a.y;
  let F = vec3f(c * dl, h, -c * (r0.w - fv * r1.x));
  var position = mix(G, F, u.a.w);
  var light = 1.0;
  var normal = vec3f(0.0, 1.0, 0.0);
  if (r1.z >= 0.0 && u.b.y > 0.0) {
    let hx = hAt(r1, r3, r5, min(i + 1, N - 1), j) - hAt(r1, r3, r5, max(i - 1, 0), j);
    let hz = hAt(r1, r3, r5, i, min(j + 1, N - 1)) - hAt(r1, r3, r5, i, max(j - 1, 0));
    let sx = 2.0 * c * r0.y / f32(N - 1);
    let sz = 2.0 * c * r1.x / f32(N - 1);
    normal = normalize(vec3f(-hx / sx, 1.0, hz / sz));
    light = mix(1.0, clamp(0.35 + 0.85 * dot(normal, normalize(vec3f(-0.6, 0.75, -0.6))), 0.45, 1.25), u.b.y);
  }
  let uv = vec2f(fu, fv);
  let value = h0;
  let time = frame.eye.w;
  /*@position*/
  var o: O;
  // behind whatever lies on it in the depth order (frame: groundClip)
  o.pos = clipOut(groundClip(frame.viewProj * vec4f(position, 1.0)));
  o.uv = uv * r2.xy + r2.zw;
  o.slot = r1.y;
  o.world = position;
  o.light = light;
  o.uv2 = uv * r4.xy + r4.zw;
  o.under = vec2f(r3.x, r3.y);
  o.tuv = uv;
  o.height = value;
  o.normal = normal;
  o.ouv = uv * r6.y + r6.zw;
  o.oslot = r6.x;
  // its heights known (its own or its parent's): only there can the ground lie under the sea
  o.known = select(0.0, 1.0, r1.z >= 0.0 || r3.w >= 0.0);
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  // what was there (the old look or a parent), and the tile fading in over it
  var c = u.missing.rgb;
  if (i.under.x >= 0.0) {
    c = textureSampleLevel(imagery, smp, i.uv2, i32(i.under.x), 0.0).rgb;
  }
  if (i.slot >= 0.0) {
    let f = i.under.y;
    c = mix(c, textureSampleLevel(imagery, smp, i.uv, i32(i.slot), 0.0).rgb, f * f * (3.0 - 2.0 * f));
  }
  // imagery 0 → the base colour; detail keeps the imagery's light and dark in it
  let lumI = dot(c, vec3f(0.299, 0.587, 0.114));
  let flatC = u.base.rgb * mix(1.0, clamp(1.0 + (lumI - 0.22) * 3.2, 0.42, 1.9), u.grade.w);
  c = mix(flatC, c, u.base.a);
  // lit by the world's sun and sky (with shadows) on the flat map; the fixed hillshade otherwise
  c = mix(c * i.light, sunLit(c, normalize(i.normal), i.world), frame.sunColor.w * u.a.w);
  // the sea (a layer's: water({ sea })): the ground under its level is water, the sky in it and the sun's glint
  // (a sea with a look draws on a flat world too: its coast's field says where)
  if (u.sea.r >= 0.0 && (u.b.x > 0.0 || sea.a.x > 0.5)) {
    let below = smoothstep(u.sea.a + 0.2 * u.b.x, u.sea.a - 0.6 * u.b.x, i.height) * i.known;
    if (sea.a.x > 0.5) {
      // its look: the waves in its light, its depth, the sun's glitter, the shore's foam and swash (a floor at the level
      // itself is sea: a terrain that knows no depth there flattens it to 0)
      c = seaOver(c, i.world, i.height, smoothstep(u.sea.a + 0.6, u.sea.a + 0.05, i.height) * i.known);
    } else {
      let v = normalize(frame.eye.xyz - i.world);
      let fres = pow(1.0 - max(v.y, 0.0), 4.0);
      let gl = pow(max(dot(normalize(v + frame.sun.xyz), vec3f(0.0, 1.0, 0.0)), 0.0), 140.0) * frame.sunColor.w;
      let wc = mix(u.sea.rgb * (0.45 + 0.55 * frame.sun.w), frame.haze.rgb, 0.35 * fres) + frame.sunColor.rgb * gl * 0.7;
      c = mix(c, wc, below);
    }
  }
  let luma = dot(c, vec3f(0.299, 0.587, 0.114));
  c = mix(vec3f(luma), c, u.grade.x);
  c = (c - vec3f(0.5)) * u.grade.z + vec3f(0.5);
  c = max(c * u.grade.y, vec3f(0.0));
  c = mix(c, u.tint.rgb * (0.25 + 1.5 * luma), u.tint.a);
  let d = distance(i.world, frame.eye.xyz);
  let f = smoothstep(u.b.z, u.b.w, d) * u.a.w;
  // a theme mutes the ground (the haze it fades into is the sky's, dimmed by the theme already); the marks drawn into
  // its tiles mute themselves (a subject's keep their colour)
  var color = vec4f(airFog(mix(themedGround(c), select(themedGround(u.horizon.rgb), frame.haze.rgb, frame.haze.w > 0.0), f), i.world), 1.0);
  let position = i.world;
  let normal = i.normal;
  let uv = i.tuv;
  let value = i.height;
  let time = frame.eye.w;
  /*@color*/
  if (frame.pick.x > 0.5) {
    return vec4f(0.0);
  }
  // the marks on the ground over it, as drawn into the tile
  if (i.oslot >= 0.0) {
    let m = textureSampleLevel(overlay, smp, i.ouv, i32(i.oslot), 0.0);
    color = vec4f(color.rgb * (1.0 - m.a) + m.rgb * mix(1.0, 0.3 + 0.7 * frame.sun.w, frame.sunColor.w), 1.0);
  }
  return vec4f(color.rgb, 1.0);
}
`;
