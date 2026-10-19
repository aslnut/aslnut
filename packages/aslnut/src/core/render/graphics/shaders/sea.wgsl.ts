// The sea's look (modules › world › earth › water › sea: look and shore), shared by the ground's sea (the surface
// program draws the ground under the sea level as water) and the sea's own surface near the eye (SEA_WGSL: the waves
// displaced). One block, one field of the coast, the same functions: both draw one sea, whichever draws it. Twin:
// sea.glsl.ts.
//   Sea block · a: (1 a look, the displaced surface's share 0..1, waves the vertices take, waves in all) · b: (the sun's
//   glitter, the waves' frame (its metres a world metre), the shore's clock s, the sea level × exaggeration) · shallow:
//   (rgb, the depth it turns deep over m) · deep: (rgb, the shelf: m of depth a metre from the coast) · field: (the
//   coast's field: its west x and north z in world metres, its cell m, 1 when there is one) · fieldN: (its cells
//   across, down, its band m, the ground's drop under the sea's own surface m) · shore: (surf m, run-up m, period s,
//   foam 0..1) · reach: (the displaced surface: its first ring m, the ratio from ring to ring, its rings, its outer
//   radius m) · centre: (its middle x, z: under the eye; the ground's fog near, far m) · more: (the slopes' variance of
//   the waves left out, the sea's whole (Cox and Munk: what a wide footprint sees), 0, 0) · w[16]: each wave (its direction
//   x, z in the waves' frame, wavenumber rad/m, amplitude m) · p[16]: (its phase at the view's centre now rad, its
//   steepness 0..1, 0, 0)
import { FRAME_WGSL } from './frame.wgsl.ts';
import { LIGHT_WGSL } from './light.wgsl.ts';

/** the floats of the sea's block: 10 vec4 and 16 waves of 2 */
export const SEA_FLOATS = 10 * 4 + 16 * 8;
/** the most waves a look has */
export const SEA_WAVES = 16;
/** the displaced surface's segments round its middle (its rings come from the block) */
export const SEA_SEGMENTS = 192;
const BLOCK = 'struct Sea { a: vec4f, b: vec4f, shallow: vec4f, deep: vec4f, field: vec4f, fieldN: vec4f, shore: vec4f, reach: vec4f, centre: vec4f, more: vec4f, w: array<vec4f, 16>, p: array<vec4f, 16> }';

/** the look's functions, for a program with the frame block: the sea's block at `block` of group 0, the coast's field
 *  at `field` of group 1 */
export const SEA_LOOK_WGSL = (block: number, field: number) => /* wgsl */ `
${BLOCK}
@group(0) @binding(${block}) var<uniform> sea: Sea;
@group(1) @binding(${field}) var seaField: texture_2d<f32>;
struct Shore { foam: f32, height: f32, slope: f32, sheet: f32, wet: f32 }
fn seaHash(p: vec2f) -> f32 {
  var q = fract(p * vec2f(0.1031, 0.103));
  q = q + dot(q, q.yx + 33.33);
  return fract((q.x + q.y) * q.x);
}
fn seaNoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(seaHash(i), seaHash(i + vec2f(1.0, 0.0)), w.x), mix(seaHash(i + vec2f(0.0, 1.0)), seaHash(i + vec2f(1.0, 1.0)), w.x), w.y);
}
// a place in the waves' frame (fixed to the ground: the waves stay where they are as the eye moves)
fn seaQ(world: vec3f) -> vec2f {
  return world.xz * sea.b.y;
}
fn seaCell(i: i32, j: i32) -> f32 {
  let n = vec2i(i32(sea.fieldN.x), i32(sea.fieldN.y));
  return textureLoad(seaField, clamp(vec2i(i, j), vec2i(0, 0), n - vec2i(1, 1)), 0).x;
}
// the coast at a place: its signed distance (m: + at sea, − on land), the way away from the land (x, z), and 1 where
// the field knows it (in its window, within its band of the coast), 0 where the ground's height decides
fn seaCoast(world: vec3f) -> vec4f {
  if (sea.field.w < 0.5) {
    return vec4f(1000000.0, 0.0, 0.0, 0.0);
  }
  let c = sea.field.z;
  let x = (world.x - sea.field.x) / c - 0.5;
  let y = (world.z - sea.field.y) / c - 0.5;
  if (x < 0.0 || y < 0.0 || x > sea.fieldN.x - 1.0 || y > sea.fieldN.y - 1.0) {
    return vec4f(1000000.0, 0.0, 0.0, 0.0);
  }
  let i = i32(floor(x));
  let j = i32(floor(y));
  let fx = x - floor(x);
  let fy = y - floor(y);
  let a = seaCell(i, j);
  let b = seaCell(i + 1, j);
  let d = seaCell(i, j + 1);
  let e = seaCell(i + 1, j + 1);
  if (max(max(abs(a), abs(b)), max(abs(d), abs(e))) > sea.fieldN.z) {
    return vec4f(1000000.0, 0.0, 0.0, 0.0);
  }
  let v = mix(mix(a, b, fx), mix(d, e, fx), fy);
  return vec4f(v, mix(b - a, e - d, fy) / c, mix(d - a, e - b, fx) / c, 1.0);
}
// the directional waves at a place of the waves' frame, waves i0 .. i1: (∂h/∂x, ∂h/∂z, h m, the slopes' variance
// left out). A wave shorter than about two footprints (m a pixel) is left out and its roughness kept: the sun's
// glitter widens far away instead of flickering. Near the coast (d m out: inside the surf zone) they die down, the
// shore's waves taking over
fn seaWaves(q: vec2f, i0: i32, i1: i32, foot: f32, d: f32) -> vec4f {
  var o = vec4f(0.0);
  let calm = smoothstep(0.0, max(sea.shore.x, 1.0), d);
  for (var i = i0; i < i1; i = i + 1) {
    let w = sea.w[i];
    let s = w.z * w.w * calm;
    let keep = 1.0 - smoothstep(0.35, 0.7, foot * w.z / 6.283185);
    let ph = w.z * dot(w.xy, q) + sea.p[i].x;
    let c = cos(ph) * s * keep;
    o = o + vec4f(w.x * c, w.y * c, sin(ph) * w.w * calm * keep, 0.5 * s * s * (1.0 - keep * keep));
  }
  return o;
}
// where a point of the sea's own surface goes (Gerstner: the water moves round under the crests, so they sharpen):
// x, up, z in the waves' frame; a wave shorter than 6 to 12 of the surface's steps there (m) left out
fn seaDisplace(q: vec2f, n: i32, spacing: f32, d: f32) -> vec3f {
  var o = vec3f(0.0);
  let calm = smoothstep(0.0, max(sea.shore.x, 1.0), d);
  for (var i = 0; i < n; i = i + 1) {
    let w = sea.w[i];
    let a = w.w * calm * (1.0 - smoothstep(0.08, 0.16, spacing * w.z / 6.283185));
    let ph = w.z * dot(w.xy, q) + sea.p[i].x;
    let k = sea.p[i].y * a * cos(ph);
    o = o + vec3f(w.x * k, a * sin(ph), w.y * k);
  }
  return o;
}
// the shore d m from the coast (+ at sea): the waves come in from the surf zone's edge in order, slowing as the water
// shallows (√(g h), the depth by the shelf), each its own size (a set: some bigger), breaking where it is as deep as it
// is tall into a face of foam with a trail of it behind, then running up the sand as a thin sheet and back, the sand
// wet behind it. q: where along the shore (each place's waves come a little earlier or later)
fn seaShore(d: f32, q: vec2f) -> Shore {
  var o = Shore(0.0, 0.0, 0.0, 0.0, 0.0);
  let surf = max(sea.shore.x, 1.0);
  let runup = sea.shore.y;
  let T = sea.shore.z;
  if (T <= 0.0 || d > surf * 1.3 || d < -runup * 1.6 - 2.0) {
    return o;
  }
  let shelf = max(sea.deep.w, 0.002);
  let along = (seaNoise(q / 150.0) - 0.5) * 0.5 * T + (seaNoise(q / 45.0) - 0.5) * 0.3 * T;
  let tau = 2.0 * sqrt(max(d, 0.0) / (9.81 * shelf));
  let u = (sea.b.z + tau + along) / T;
  let n = floor(u);
  let f = u - n;
  let big = 0.5 + 0.5 * seaHash(vec2f(n, 7.0)) * (0.55 + 0.45 * seaNoise(q / 37.0 + vec2f(n * 1.7, 0.0)));
  let brk = surf * (0.5 + 0.5 * big);
  let back = exp(-f / 0.16);
  let face = exp(-(1.0 - f) / 0.035);
  let crest = max(back, face);
  // grown as it shoals to where it breaks, then the broken wave (a bore of white water) lower to the coast
  var env = clamp(d / brk, 0.15, 1.0);
  if (d >= brk) {
    env = sqrt(clamp(1.0 - (d - brk) / (surf * 1.3 - brk + 1.0), 0.0, 1.0));
  }
  o.height = big * 0.9 * crest * env * step(0.0, d);
  let dfdd = 1.0 / (T * sqrt(9.81 * shelf * max(d, 0.5)));
  o.slope = big * 0.9 * env * step(0.0, d) * select(-back / 0.16, face / 0.035, face > back) * dfdd;
  let broken = smoothstep(brk, brk * 0.82, d) * step(0.0, d);
  // its foam streaked along the shore (across it: the distance itself; along it, a fixed slant of the ground's frame:
  // the coast's own direction jumps from cell to cell, its noise would show the seams), moving with the wave
  let s = vec2f(q.x * 0.8 + q.y * 0.6, d);
  let blot = 0.45 + 0.55 * seaNoise(vec2f(s.x / 5.0, s.y / 1.3) + vec2f(n * 3.7, f * 2.0)) * seaNoise(vec2f(s.x / 1.7, s.y / 0.9) + vec2f(0.0, n));
  o.foam = broken * (exp(-f / 0.12) + exp(-f / 0.45) * 0.7 + face) * blot + broken * 0.22 * smoothstep(0.5, 0.85, seaNoise(vec2f(s.x / 2.3, s.y / 1.1) + vec2f(n, f)));
  // the swash: since the wave reached the coast (f0 of a period), its water up the sand and back
  let u0 = (sea.b.z + along) / T;
  let f0 = u0 - floor(u0);
  let big0 = 0.55 + 0.45 * seaHash(vec2f(floor(u0), 7.0));
  let reach = runup * big0 * max(0.0, 1.0 - pow(2.0 * f0 / 0.75 - 1.0, 2.0)) * step(f0, 0.75);
  let up = step(0.05, reach);
  o.sheet = smoothstep(-reach - 0.6, -reach + 0.4, d) * step(d, 0.5) * up;
  o.wet = smoothstep(-runup * big0 - 1.0, -runup * big0 * 0.5, d) * (0.6 + 0.4 * (1.0 - f0));
  if (d < 0.0) {
    o.foam = exp(-abs(d + reach) / 0.5) * up * select(0.55, 1.0, f0 < 0.375) * blot;
  }
  o.foam = clamp(o.foam * sea.shore.w, 0.0, 1.0);
  return o;
}
// the sky seen in the water in a direction: the haze at the horizon, the sky's light above it (as the frame carries
// them: a sky's own colours, or a plain day's)
fn seaSky(r: vec3f) -> vec3f {
  let up = clamp(r.y, 0.0, 1.0);
  var hz = vec3f(0.62, 0.72, 0.82) * (0.25 + 0.75 * frame.sun.w);
  if (frame.sunColor.w > 0.5) {
    hz = frame.haze.rgb;
  }
  let zen = select(vec3f(0.3, 0.45, 0.7) * (0.2 + 0.8 * frame.sun.w), frame.ambient.rgb * 1.5, frame.sunColor.w > 0.5);
  return mix(hz, zen, smoothstep(0.0, 0.45, pow(up, 0.7)));
}
// foam's colour: white, lit as the ground is (the sky's light and the sun's; a plain day's without a sky)
fn seaFoamLit() -> vec3f {
  let fl = select(vec3f(0.55 + 0.45 * frame.sun.w), frame.ambient.rgb * 1.7 + frame.sunColor.rgb * (0.3 + 0.7 * max(frame.sun.y, 0.0)) * 0.8, frame.sunColor.w > 0.5);
  return vec3f(0.92, 0.95, 0.97) * fl;
}
// the sea's colour at a place: its water (shallow to deep by its depth m), the sky in it and the sun's glitter by its
// normal (a lobe as wide as the slopes left out make it: Cox and Munk), the foam on it
fn seaColour(world: vec3f, n: vec3f, depth: f32, rough: f32, foam: f32) -> vec3f {
  let v = normalize(frame.eye.xyz - world);
  let nv = max(dot(n, v), 0.0);
  let fres = 0.02 + 0.98 * pow(1.0 - nv, 5.0);
  let r = reflect(-v, n);
  let day = frame.sun.w;
  let lit = frame.ambient.rgb * 0.9 + frame.sunColor.rgb * max(frame.sun.y, 0.0) * 0.55;
  let k = 1.0 - exp(-max(depth, 0.0) / max(sea.shallow.w, 0.1));
  let body = mix(sea.shallow.rgb, sea.deep.rgb, k) * select(vec3f(0.45 + 0.55 * day), lit, frame.sunColor.w > 0.5);
  var c = mix(body, seaSky(r), fres);
  let m2 = 0.0016 + (rough + sea.more.x) * 2.0;
  let h = normalize(v + frame.sun.xyz);
  let nh = max(dot(n, h), 0.05);
  let spec = exp(-(1.0 - nh * nh) / (nh * nh * m2)) / (3.141593 * m2 * nh * nh * nh * nh);
  c = c + frame.sunColor.rgb * min(spec, 60.0) * fres * sea.b.x * 0.08 * step(0.0, frame.sun.y);
  return mix(c, seaFoamLit(), clamp(foam, 0.0, 1.0));
}
// metres a pixel at a place, along the view (a grazing look stretches it: the waves left out there sooner)
fn seaFoot(world: vec3f) -> f32 {
  let e = frame.eye.xyz - world;
  return length(e) * 2.0 * frame.misc.z / max(frame.fbsize.y, 1.0) / max(abs(e.y) / max(length(e), 0.001), 0.003);
}
// the ground's colour c at a place under the sea's look: water where the sea is (the coast deciding near it, else the
// ground's height: below 0..1, the ground's own height m × exaggeration), and on the shore's land side the sand wet and
// darker behind the swash, the swash a thin sheet with the sky in it and the sand through it, its edge foam
fn seaOver(c: vec3f, world: vec3f, height: f32, below: f32) -> vec3f {
  let cs = seaCoast(world);
  let q = seaQ(world);
  var water = below;
  var sh = Shore(0.0, 0.0, 0.0, 0.0, 0.0);
  if (cs.w > 0.5) {
    water = smoothstep(-0.25, 0.25, cs.x);
    sh = seaShore(cs.x, q);
  }
  if (water <= 0.0 && sh.wet <= 0.0 && sh.sheet <= 0.0 && sh.foam <= 0.0) {
    return c;
  }
  let foot = seaFoot(world);
  let wv = seaWaves(q, 0, i32(sea.a.w), foot, cs.x);
  let n = normalize(vec3f(-wv.x * sea.b.y - sh.slope * cs.y, 1.0, -wv.y * sea.b.y - sh.slope * cs.z));
  // (a floor at the level itself: the terrain knows no depth there (a sea flattened to 0): deep)
  var depth = select(sea.b.w - height, 1000.0, sea.b.w - height < 0.05);
  if (cs.w > 0.5) {
    depth = mix(max(cs.x, 0.0) * sea.deep.w, max(depth, 0.0), smoothstep(0.55, 0.95, cs.x / max(sea.fieldN.z, 1.0)));
  }
  let wc = seaColour(world, n, depth, wv.w + sea.more.y * smoothstep(0.02, 1.5, foot), sh.foam);
  let v = normalize(frame.eye.xyz - world);
  var land = c * (1.0 - 0.38 * sh.wet);
  let film = mix(land * 0.75, seaSky(reflect(-v, vec3f(0.0, 1.0, 0.0))), 0.35 + 0.4 * pow(1.0 - max(v.y, 0.0), 3.0));
  land = mix(mix(land, film, sh.sheet * 0.85), seaFoamLit(), sh.foam);
  return mix(land, wc, water);
}
// the ground's height under the sea's look (m × exaggeration): the water at the sea level over the floor (lower near
// the eye while the sea's own surface draws there, so its troughs never show it), the coast deciding near it (the sand
// over the level, the floor under it)
fn seaGround(p: vec3f, h: f32, level: f32) -> f32 {
  let cs = seaCoast(p);
  var water = h < level + 0.3;
  if (cs.w > 0.5) {
    water = cs.x > 0.0;
  }
  if (!water) {
    if (cs.w > 0.5) {
      return max(h, level + 0.05 - 0.02 * cs.x);
    }
    return h;
  }
  let e = distance(p.xz, sea.centre.xy);
  let drop = sea.fieldN.w * sea.a.y * (1.0 - smoothstep(0.7, 0.95, e / max(sea.reach.w, 1.0))) * smoothstep(0.0, 6.0, cs.x);
  return level - drop;
}
`;

/** the sea's own surface near the eye: rings round the point under the eye (closer near it, farther apart out to
 *  its reach), each point lifted by the waves (Gerstner) and the shore's, the same look as the ground's sea; it fades
 *  in and out with its share, and into the ground's sea at its edge. Hidden where the ground is over it (depth), and
 *  on the land side of the coast's field. Group 0: the frame, the sea's block; group 1: the coast's field, the shadow
 *  map */
export const SEA_WGSL = /* wgsl */ `${FRAME_WGSL}
${SEA_LOOK_WGSL(1, 0)}
${LIGHT_WGSL(1)}
const NA = ${SEA_SEGMENTS};
struct O {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) q: vec2f,
  @location(2) edge: f32,
}
@vertex fn vs(@builtin(vertex_index) vid: u32) -> O {
  let j = i32(vid) / (NA + 1);
  let i = i32(vid) % (NA + 1);
  let k = sea.reach.y;
  let r = sea.reach.x * (pow(k, f32(j)) - 1.0) / (k - 1.0);
  let a = f32(i) / f32(NA) * 6.283185;
  var p = vec3f(sea.centre.x + r * cos(a), sea.b.w, sea.centre.y + r * sin(a));
  let q = seaQ(p);
  let cs = seaCoast(p);
  let fade = 1.0 - smoothstep(0.6, 0.95, r / max(sea.reach.w, 1.0));
  var lift = seaDisplace(q, i32(sea.a.z), sea.reach.x * pow(k, f32(j)), cs.x) / sea.b.y * fade;
  if (cs.w > 0.5) {
    let sh = seaShore(cs.x, q);
    lift.y = lift.y + sh.height * fade * smoothstep(0.0, 4.0, cs.x);
  }
  p = p + lift;
  var o: O;
  o.pos = clipOut(frame.viewProj * vec4f(p, 1.0));
  o.world = p;
  o.q = q;
  o.edge = smoothstep(0.75, 0.95, r / max(sea.reach.w, 1.0));
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let cs = seaCoast(i.world);
  let foot = seaFoot(i.world);
  let wv = seaWaves(i.q, 0, i32(sea.a.w), foot, cs.x);
  var foam = 0.0;
  var sx = 0.0;
  var sz = 0.0;
  var land = 0.0;
  if (cs.w > 0.5) {
    let sh = seaShore(cs.x, i.q);
    foam = sh.foam * smoothstep(0.0, 1.0, cs.x);
    sx = sh.slope * cs.y;
    sz = sh.slope * cs.z;
    land = 1.0 - smoothstep(-0.2, 0.3, cs.x);
  }
  let n = normalize(vec3f(-wv.x * sea.b.y - sx, 1.0, -wv.y * sea.b.y - sz));
  let depth = select(1000.0, max(cs.x, 0.0) * sea.deep.w, cs.w > 0.5);
  var c = seaColour(i.world, n, depth, wv.w + sea.more.y * smoothstep(0.02, 1.5, foot), foam) * mix(1.0, 0.55 + 0.45 * sunShadow(i.world, vec3f(0.0, 1.0, 0.0)), frame.sunColor.w);
  let d = distance(i.world, frame.eye.xyz);
  let f = smoothstep(sea.centre.z, sea.centre.w, d) * frame.size.w;
  c = airFog(mix(themedGround(c), select(themedGround(c), frame.haze.rgb, frame.haze.w > 0.0), f), i.world);
  let alpha = sea.a.y * (1.0 - i.edge) * (1.0 - land);
  if (frame.pick.x > 0.5) {
    return vec4f(0.0);
  }
  return vec4f(c, alpha);
}
`;
