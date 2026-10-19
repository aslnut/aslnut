// Copies over time (core › geometry › shapes › builder › copy: emit): a clone's emitters' copies, each moved by its age
// over its emitter's life (born at the emitter, risen, spread its own way, drifted, grown, its opacity from birth's to
// death's), looping, each its own phase (its number and its clone's seed): nothing per frame on the main thread. Blended,
// never casting nor picked; the copies the governor drops (si.d.x: the share kept) drawn none. Twin: emit.glsl.ts.
import { SOLID_LIB_WGSL } from './solid.wgsl.ts';
import { SOLID_SET_WGSL } from './solid-inst.wgsl.ts';

export const EMIT_WGSL = /* wgsl */ `${SOLID_LIB_WGSL}${SOLID_SET_WGSL}
struct I { @location(0) r: f32, @location(3) v: vec4f, @location(4) vc: f32, @location(5) card: f32 }
struct OE { @builtin(position) pos: vec4f, @location(0) col: vec4f }
// a copy's own number 0..1 (its way, whether the governor keeps it)
fn copyHash(c: f32, s: f32) -> f32 {
  return fract(sin(c * 12.9898 + s * 78.233) * 43758.5453);
}
@vertex fn vs(i: I) -> OE {
  var o: OE;
  let r0 = recAt(i.r, 0);
  let r1 = recAt(i.r, 1);
  let r2 = recAt(i.r, 2);
  tileAt(r2.w);
  let code = i32(i.v.w + 0.5);
  let e = min(code / 1024, 1);
  let c = f32(code % 1024);
  let E0 = si.e[e * 3];
  let E1 = si.e[e * 3 + 1];
  let E2 = si.e[e * 3 + 2];
  if (copyHash(c, 3.1) > si.d.x || E0.w <= 0.0) {
    o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
    return o;
  }
  let age = fract(frame.eye.w / E0.w + c / max(E1.w, 1.0) + r2.z);
  let hx = copyHash(c, r2.z) * 2.0 - 1.0;
  let hz = copyHash(c + 17.0, r2.z) * 2.0 - 1.0;
  let at = E0.xyz + vec3f(hx * E1.y * age + E2.z * age, E1.x * age, hz * E1.y * age + E2.w * age);
  let q0 = at + (i.v.xyz - E0.xyz) * mix(1.0, E1.z, age);
  // placed as the solids' clones: scaled, turned, on its ground, its set's range on screen kept
  let cc = cos(r1.w);
  let s = sin(r1.w);
  let g = groundAt(r0.x, r0.y) * t.v.x + r0.z;
  let keep = keepOf(max(r1.x, r1.z), placeOf(r0.x, g + si.a.x * 0.5 * r1.y, r0.y));
  let q = q0 * r1.xyz * keep;
  let rr = vec3f(q.x * cc - q.z * s, q.y, q.x * s + q.z * cc);
  let position = placeOf(r0.x + rr.x, g + rr.y, r0.y + rr.z);
  o.col = vec4f(unpackRGB(i.vc), mix(E2.x, E2.y, age) * smoothstep(0.0, 0.1, age) * t.v.w);
  o.pos = clipOut(frame.viewProj * vec4f(towardEye(position), 1.0));
  return o;
}
@fragment fn fs(o: OE) -> @location(0) vec4f {
  if (frame.pick.x > 0.5 || frame.pick.y > 0.5 || o.col.a <= 0.003) {
    discard;
  }
  return vec4f(themed(o.col.rgb, 0.0), o.col.a);
}
`;
