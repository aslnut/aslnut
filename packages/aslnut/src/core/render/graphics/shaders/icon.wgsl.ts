// core › encoding › marks › symbols › icon: an app's own picture from an atlas, facing the screen at each item's place
// (core › entities › placement: on a set's things, read from its track, or on features), sized by the one size rule,
// tinted, turned by its heading (a set's thing along its path, a feature's own) as seen on the screen. One instance an
// item; it gives way to a set's shape near the camera as the set's dot does.
//   U: place (anchors: the origin − the view's centre, the exaggeration, the lift over a set's things) · size (how it is
//   drawn: units, the least and the most CSS px) · look (opacity, the atlas's columns, rows, turned 0/1) · misc (the
//   pick number, 0, 0, 0)
//   items: 3 texels an instance, in its drawing order (its cell (−1: none), its size across and down CSS px, its item;
//   its tint rgba; its anchor (shares from the picture's top left) and the share of its cell the picture fills)
// Twin: icon.glsl.ts.
import { FRAME_WGSL } from './frame.wgsl.ts';
import { ANCHOR_FOLLOW_WGSL, ANCHOR_STILL_WGSL } from './anchors.wgsl.ts';
import { SET_TEXTURES, setsTrackWGSL, type SetsVariant } from './sets.wgsl.ts';

const ICON = /* wgsl */ `
struct O { @builtin(position) pos: vec4f, @location(0) uv: vec2f, @location(1) @interpolate(flat) cell: vec4f, @location(2) @interpolate(flat) tint: vec4f, @location(3) @interpolate(flat) id: f32 }
fn iconCorner(v: i32) -> vec2f {
  let x = select(-1.0, 1.0, v == 1 || v == 3);
  let y = select(-1.0, 1.0, v >= 2);
  return vec2f(x, y);
}
fn iconItem(e: i32, k: i32) -> vec4f {
  let i = e * 3 + k;
  return textureLoad(items, vec2i(i % 4096, i / 4096), 0);
}
// the screen's angle of a heading at p (radians: 0 points up the screen)
fn iconAngle(p: vec3f, h: f32) -> f32 {
  let a = frame.viewProj * vec4f(p, 1.0);
  let b = frame.viewProj * vec4f(p + vec3f(sin(h), 0.0, -cos(h)), 1.0);
  let d = (b.xy / max(b.w, 0.001) - a.xy / max(a.w, 0.001)) * frame.size.xy;
  return select(0.0, atan2(d.x, d.y), dot(d, d) > 1e-12);
}
@vertex fn vs(@builtin(vertex_index) vid: u32, @builtin(instance_index) iid: u32) -> O {
  // (an instance's slot in the items: its item, its cell, its sizes; its tint; its anchor and its picture's share)
  let slot = i32(iid);
  let it = iconItem(slot, 0);
  let e = i32(it.w + 0.5);
  let a = anchorOf(e);
  let corner = iconCorner(i32(vid));
  var o: O;
  o.pos = vec4f(2.0, 2.0, 2.0, 1.0);
  o.uv = vec2f(0.0);
  o.cell = vec4f(0.0);
  o.tint = vec4f(0.0);
  o.id = f32(e);
  if (a.w < 0.5 || it.x < 0.0 || anchorShaped(e) || anchorBehind(a.xyz)) {
    return o;
  }
  let fit = iconItem(slot, 2);
  let sz = vec2f(sizePx(it.y, u.size, a.xyz), sizePx(it.z, u.size, a.xyz));
  // CSS px from the place: the anchor (shares from the picture's top left) sits on it
  let local = vec2f((corner.x + 1.0) * 0.5 - fit.x, fit.y - (1.0 - corner.y) * 0.5) * sz;
  let ang = select(0.0, iconAngle(a.xyz, anchorTurn(e)), u.look.w > 0.5);
  let c = cos(ang);
  let sn = sin(ang);
  let r = vec2f(local.x * c + local.y * sn, -local.x * sn + local.y * c);
  let clip = frame.viewProj * vec4f(a.xyz, 1.0);
  if (clip.w < 0.01) {
    return o;
  }
  let off = r * 2.0 * frame.size.z / frame.size.xy * clip.w;
  o.pos = clipOut(vec4f(clip.xy + off, clip.z, clip.w));
  o.uv = vec2f(0.5) + (vec2f(corner.x * 0.5 + 0.5, 0.5 - corner.y * 0.5) - vec2f(0.5)) * fit.zw;
  let col = it.x % u.look.y;
  let row = floor(it.x / u.look.y);
  o.cell = vec4f(col / u.look.y, row / u.look.z, 1.0 / u.look.y, 1.0 / u.look.z);
  o.tint = iconItem(slot, 1);
  return o;
}
@fragment fn fs(i: O) -> @location(0) vec4f {
  // four taps across the pixel (the atlas has no smaller levels: an icon drawn small stays smooth)
  let q = clamp(i.uv, vec2f(0.0), vec2f(1.0));
  let dx = dpdx(q) * 0.25;
  let dy = dpdy(q) * 0.25;
  let at = i.cell.xy + q * i.cell.zw;
  let k = i.cell.zw;
  let c = (textureSampleLevel(atlas, smp, at + (dx + dy) * k, 0.0) + textureSampleLevel(atlas, smp, at + (dx - dy) * k, 0.0) + textureSampleLevel(atlas, smp, at - (dx - dy) * k, 0.0) + textureSampleLevel(atlas, smp, at - (dx + dy) * k, 0.0)) * 0.25;
  let alpha = c.a * i.tint.a * u.look.x;
  if (alpha <= 0.004) {
    discard;
  }
  if (frame.pick.x > 0.5) {
    return pickOut(u.misc.x, i.id);
  }
  // (the atlas holds colours times alpha)
  return vec4f(themed(c.rgb / max(c.a, 0.0001) * i.tint.rgb, 0.0), alpha);
}
`;
/** the icon's program on WebGPU: placed on features (still), or on a set's things (its track's variant) */
export function iconWGSL(follow: SetsVariant | null): string {
  const B = follow ? SET_TEXTURES.length : 1;
  return `${follow ? setsTrackWGSL(follow) : FRAME_WGSL}
struct U { place: vec4f, size: vec4f, look: vec4f, misc: vec4f }
@group(0) @binding(${follow ? 2 : 1}) var<uniform> u: U;
${follow ? '' : '@group(1) @binding(0) var places: texture_2d<f32>;'}
@group(1) @binding(${B}) var items: texture_2d<f32>;
@group(1) @binding(${B + 1}) var atlas: texture_2d<f32>;
@group(1) @binding(${B + 2}) var smp: sampler;
${follow ? ANCHOR_FOLLOW_WGSL : ANCHOR_STILL_WGSL}${ICON}`;
}
