// The Earth's sky, one full-screen pass behind everything. From afar: space, stars and the glow round the globe (as
// sky.wgsl). Near the ground: a physical daylight sky (Preetham's model; its source and licence: NOTICE) for the sun's
// place, filmic tone mapping, a bluer clear sky, the haze at the horizon; the sun's disc and halo, the moon lit from
// the sun's direction (its phase and tilt right), stars at night; overcast greys it. Blended by the morph.
// Twin: atmosphere.glsl.ts.
import { FRAME_WGSL } from './frame.wgsl.ts';

export const ATMOSPHERE_WGSL = /* wgsl */ `${FRAME_WGSL}
// sun: (towards it xyz, its disc 0..1) · moon: (towards it xyz, opacity) · p1: (turbidity, rayleigh, mie, mie g)
// p2: (overcast, blue sky lift, stars 0..1, morph) · grey: overcast colour (rgb, flash) · horizon: the haze (rgb, exposure)
// space, glow: the view from afar · misc: (the body's radius, the sun's halo, the moon's angular radius, 0)
// cloud: (cover, where the view's centre is in metres (x, z: drift and pan), the cloud base above sea level, m; < 0
// none) · cloudLit: (their sunlit colour, how much they show from the camera's height) · cloudShade: (their shaded colour)
struct U { sun: vec4f, moon: vec4f, p1: vec4f, p2: vec4f, grey: vec4f, horizon: vec4f, space: vec4f, glow: vec4f, misc: vec4f, cloud: vec4f, cloudLit: vec4f, cloudShade: vec4f }
@group(0) @binding(1) var<uniform> u: U;
struct O { @builtin(position) pos: vec4f, @location(0) ndc: vec2f }
@vertex fn vs(@builtin(vertex_index) vid: u32) -> O {
  let i = i32(vid);
  let p = vec2f(f32((i << 1u) & 2), f32(i & 2)) * 2.0 - 1.0;
  var o: O;
  o.pos = clipOut(vec4f(p, 1.0, 1.0));
  o.ndc = p;
  return o;
}
fn pcg(v: u32) -> u32 {
  let s = v * 747796405u + 2891336453u;
  let w = ((s >> ((s >> 28u) + 4u)) ^ s) * 277803737u;
  return (w >> 22u) ^ w;
}
fn hash3(q: vec3f) -> f32 {
  let iq = vec3i(q);
  return f32(pcg(u32(iq.x) ^ pcg(u32(iq.y) ^ pcg(u32(iq.z))))) / 4294967295.0;
}
// from afar: black space with stars, the glow round the globe's edge
fn spaceColor(o: vec3f, d: vec3f) -> vec3f {
  let q = floor(d * 900.0);
  let s = step(0.9982, hash3(q)) * hash3(q + vec3f(1.0, 2.0, 3.0));
  var c = u.space.rgb + vec3f(s);
  let C = vec3f(0.0, -u.misc.x, 0.0);
  let oc = C - o;
  let t = dot(oc, d);
  if (t > 0.0) {
    let dm = length(oc - d * t);
    let g = exp(-max(dm - u.misc.x, 0.0) / (u.misc.x * 0.035)) * smoothstep(u.misc.x * 0.96, u.misc.x, dm);
    c = mix(c, u.glow.rgb, clamp(g, 0.0, 1.0));
  }
  return c;
}
fn sunIntensity(c: f32) -> f32 {
  return 1000.0 * max(0.0, 1.0 - exp(-((1.6110731556870734 - acos(clamp(c, -1.0, 1.0))) / 1.5)));
}
fn totalMie(t: f32) -> vec3f {
  return 0.434 * (0.2 * t) * 10.0e-18 * vec3f(1.8399918514433978e14, 2.7798023919660528e14, 4.0790479543861094e14);
}
fn rayleighPhase(c: f32) -> f32 {
  return 0.05968310365946075 * (1.0 + c * c);
}
fn hgPhase(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return 0.07957747154594767 * ((1.0 - g2) / pow(1.0 - 2.0 * g * c + g2, 1.5));
}
fn rrtOdt(v: vec3f) -> vec3f {
  return (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
}
// filmic tone mapping (ACES, Stephen Hill's fitted curve) and the sRGB curve
fn aces(c: vec3f, exposure: f32) -> vec3f {
  let a = mat3x3f(vec3f(0.59719, 0.07600, 0.02840), vec3f(0.35458, 0.90834, 0.13383), vec3f(0.04823, 0.01566, 0.83777));
  let b = mat3x3f(vec3f(1.60475, -0.10208, -0.00327), vec3f(-0.53108, 1.10813, -0.07276), vec3f(-0.07367, -0.00605, 1.07602));
  return clamp(b * rrtOdt(a * (c * exposure / 0.6)), vec3f(0.0), vec3f(1.0));
}
fn toSRGB(c: vec3f) -> vec3f {
  return mix(pow(c, vec3f(0.41666)) * 1.055 - vec3f(0.055), c * 12.92, step(c, vec3f(0.0031308)));
}
// the daylight sky towards d (Preetham), tone mapped, lifted towards a clear blue, melting into the haze below
fn physical(d: vec3f) -> vec3f {
  let sd = u.sun.xyz;
  let sunE = sunIntensity(sd.y);
  let sunfade = 1.0 - clamp(1.0 - exp(sd.y * 0.8888889), 0.0, 1.0);
  let betaR = vec3f(5.804542996261093e-6, 1.3562911419845635e-5, 3.0265902468824876e-5) * (u.p1.y - (1.0 - sunfade));
  let betaM = totalMie(u.p1.x) * u.p1.z;
  let zen = acos(max(0.0, d.y));
  let inv = 1.0 / (cos(zen) + 0.15 * pow(93.885 - ((zen * 180.0) / 3.141592653589793), -1.253));
  let fex = exp(-(betaR * 8.4e3 * inv + betaM * 1.25e3 * inv));
  let ct = dot(d, sd);
  let bR = betaR * rayleighPhase(ct * 0.5 + 0.5);
  let bM = betaM * hgPhase(ct, u.p1.w);
  let k = (bR + bM) / (betaR + betaM);
  var lin = pow(sunE * k * (1.0 - fex), vec3f(1.5));
  lin = lin * mix(vec3f(1.0), pow(sunE * k * fex, vec3f(0.5)), clamp(pow(1.0 - sd.y, 5.0), 0.0, 1.0));
  var l0 = vec3f(0.1) * fex;
  let disc = smoothstep(0.9999566769464484, 0.9999566769464484 + 0.00002, ct);
  l0 = l0 + (sunE * 19000.0 * fex) * disc * u.sun.w;
  let tex = (lin + l0) * 0.04 + vec3f(0.0, 0.0003, 0.00075);
  var c = pow(tex, vec3f(1.0 / (1.2 + (1.2 * sunfade))));
  c = mix(c, u.grey.rgb, u.p2.x);
  c = toSRGB(aces(c, u.horizon.w));
  let blue = mix(vec3f(0.62, 0.78, 0.93), vec3f(0.22, 0.47, 0.84), smoothstep(0.0, 0.65, d.y));
  c = mix(c, blue, 0.55 * u.p2.y);
  // the sun's halo through haze and thin cloud
  let halo = pow(max(ct, 0.0), 400.0) * 0.6 + pow(max(ct, 0.0), 24.0) * 0.12;
  c = c + vec3f(1.0, 0.92, 0.8) * halo * u.misc.y;
  return mix(c, u.horizon.rgb, 1.0 - smoothstep(0.0, 0.09, d.y));
}
// the moon's disc towards d: (colour, alpha), lit from the sun's direction
fn moonDisc(d: vec3f) -> vec4f {
  let m = u.moon.xyz;
  let ct = dot(d, m);
  let r = u.misc.z;
  if (ct < cos(r)) {
    return vec4f(0.0);
  }
  let p = (d - m * ct) / sin(r);
  let r2 = dot(p, p);
  if (r2 >= 1.0) {
    return vec4f(0.0);
  }
  let n = p - m * sqrt(1.0 - r2);
  let lit = smoothstep(-0.04, 0.1, dot(n, u.sun.xyz));
  let maria = 0.25 * smoothstep(0.6, 0.2, length(p - vec3f(0.2, 0.25, 0.0))) + 0.2 * smoothstep(0.5, 0.1, length(p + vec3f(0.25, 0.1, 0.0)));
  let surf = vec3f(0.95, 0.94, 0.88) * (1.0 - maria);
  let night = 1.0 - smoothstep(-0.1, 0.12, u.sun.y);
  let col = surf * lit + vec3f(0.09, 0.1, 0.13) * (1.0 - lit) * night;
  let a = max(lit, night * 0.85) * (1.0 - smoothstep(0.92, 1.0, r2)) * u.moon.w;
  return vec4f(col * (1.0 + 0.6 * night), a);
}
fn h2(q: vec2f) -> f32 {
  var p = fract(q * vec2f(0.1031, 0.103));
  p = p + dot(p, p.yx + 33.33);
  return fract((p.x + p.y) * p.x);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);
  return mix(mix(h2(i), h2(i + vec2f(1.0, 0.0)), w.x), mix(h2(i + vec2f(0.0, 1.0)), h2(i + vec2f(1.0, 1.0)), w.x), w.y);
}
fn fbm(q: vec2f) -> f32 {
  var p = q;
  var s = 0.0;
  var a = 0.5;
  for (var k = 0; k < 5; k = k + 1) {
    s = s + a * vnoise(p);
    p = p * 2.03 + vec2f(17.1, 17.1);
    a = a * 0.5;
  }
  return s;
}
fn cloudDensity(xz: vec2f) -> f32 {
  let c = 1.0 - u.cloud.x;
  return smoothstep(c * 0.75, c * 0.75 + 0.28, fbm((xz + u.cloud.yz) / 3200.0));
}
// the cloud layer seen towards d from o (below it): colour and cover, lit from the sun's side
fn cloudsAt(o: vec3f, d: vec3f) -> vec4f {
  if (u.cloud.w < 0.0 || u.cloud.x < 0.01 || d.y <= 0.0 || o.y >= u.cloud.w) {
    return vec4f(0.0);
  }
  let p = o + d * ((u.cloud.w - o.y) / d.y);
  let dens = cloudDensity(p.xz);
  if (dens < 0.01) {
    return vec4f(0.0);
  }
  let towardSun = cloudDensity(p.xz + u.sun.xz * 260.0);
  var col = mix(u.cloudLit.rgb, u.cloudShade.rgb, clamp(towardSun * 1.3 - dens * 0.3, 0.0, 1.0));
  let fs = max(dot(d, u.sun.xyz), 0.0);
  col = col + u.cloudLit.rgb * (pow(fs, 40.0) * (1.4 - dens) * 1.3 + pow(fs, 6.0) * 0.25) * u.sun.w;
  col = col + vec3f(0.7, 0.75, 0.9) * u.grey.w;
  let far = length(p.xz - o.xz);
  col = mix(col, u.horizon.rgb, smoothstep(6000.0, 38000.0, far) * 0.85);
  return vec4f(col, dens * 0.92 * (1.0 - smoothstep(22000.0, 42000.0, far)) * u.cloudLit.w);
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  let a = frame.inv * vec4f(i.ndc, 0.0, 1.0);
  let b = frame.inv * vec4f(i.ndc, 1.0, 1.0);
  let o = a.xyz / a.w;
  let d = normalize(b.xyz / b.w - o);
  var c = spaceColor(o, d);
  if (u.p2.w > 0.0) {
    var near = physical(d);
    // stars at night, above the haze
    let q = floor(d * 700.0);
    let s = step(0.9986, hash3(q)) * (0.35 + 0.65 * hash3(q + vec3f(1.0, 2.0, 3.0))) * smoothstep(0.02, 0.2, d.y);
    near = near + vec3f(0.85, 0.9, 1.0) * s * u.p2.z;
    let mo = moonDisc(d);
    near = mix(near, mo.rgb, mo.a);
    let cl = cloudsAt(o, d);
    near = mix(near, cl.rgb, cl.a);
    near = mix(near, vec3f(0.85, 0.88, 1.0), u.grey.w * 0.6);
    c = mix(c, near, u.p2.w);
  }
  return vec4f(c, 1.0);
}
`;
