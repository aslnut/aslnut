// The face, drawn where the face decal is (its texture coordinates: u across, the face's left at u > 0.5; v down, the
// forehead 0, the eye line about 0.46, the chin 1): eyes (white, an iris, a pupil, a catch-light, the upper lash line),
// brows, a mouth, cheeks; or dots for eyes (the plain style). No texture: a few numbers an instance carries, so every
// person's face costs nothing to hold, and it blinks by the clock. Twin: face.glsl.ts.
//   p.x: the iris colour (0xRRGGBB) · p.y: eye size, opening, spacing, tilt, lashes (4 bits each), style (2 bits) ·
//   p.z: smile, brow thickness, brow height, mouth width, blush (4 bits each), brow tilt (3 bits), blinks (1 bit)
export const FACE_WGSL = /* wgsl */ `
// four bits of a packed number, as 0 … 1
fn nib(v: f32, at: f32) -> f32 {
  return (floor(v / at) - floor(v / (at * 16.0)) * 16.0) / 15.0;
}
// how far inside an ellipse (> 0 inside), scaled to about a unit of uv near its edge
fn inEllipse(q: vec2f, r: vec2f) -> f32 {
  let k = length(q / r);
  return (1.0 - k) * min(r.x, r.y);
}
// a soft step over about a pixel of uv
fn aa(d: f32, w: f32) -> f32 {
  return clamp(d / max(w, 1e-5) + 0.5, 0.0, 1.0);
}
fn skinDecal(uv: vec2f, p: vec3f, base: vec3f, seed: f32) -> vec3f {
  // a soft edge of a few thousandths of the face (no derivatives: it is drawn under a branch)
  let px = 0.004;
  let eyeSize = nib(p.y, 1.0);
  let open = 0.42 + nib(p.y, 16.0) * 0.9;
  let gap = 0.16 + nib(p.y, 256.0) * 0.12;
  let tiltK = nib(p.y, 4096.0);
  let lash = nib(p.y, 65536.0);
  let style = floor(p.y / 1048576.0);
  let smile = nib(p.z, 1.0);
  let browW = nib(p.z, 16.0);
  let browY = nib(p.z, 256.0);
  let mouth = nib(p.z, 4096.0);
  let blush = nib(p.z, 65536.0);
  let browTilt = (floor(p.z / 1048576.0) - floor(p.z / 8388608.0) * 8.0 - 3.0) / 3.0;
  let blinks = floor(p.z / 8388608.0);
  // a blink every few seconds, a sixth of a second long, each person on their own beat
  let beat = 3.2 + fract(seed * 0.618) * 2.6;
  let ph = fract(frame.eye.w / beat + fract(seed * 0.377));
  let shut = blinks > 0.5 && ph < 0.05;
  var c = base;
  let s = select(-1.0, 1.0, uv.x > 0.5);
  let ew = 0.095 + eyeSize * 0.08;
  let eh = ew * (1.0 + eyeSize * 0.3) * open;
  let ec = vec2f(0.5 + s * gap, 0.46);
  let ta = (tiltK - 0.5) * 0.5 * s + (1.0 - min(1.0, open)) * 0.12 * s;
  let d = uv - ec;
  let q = vec2f(d.x * cos(ta) + d.y * sin(ta), -d.x * sin(ta) + d.y * cos(ta));
  let ink = vec3f(0.13, 0.08, 0.06);
  // cheeks
  if (blush > 0.02) {
    let b = aa(inEllipse(uv - vec2f(ec.x + s * ew * 0.25, ec.y + ew * 1.05), vec2f(ew * 0.7, ew * 0.2)), px);
    c = mix(c, vec3f(0.94, 0.43, 0.43), b * blush * 0.45);
  }
  if (shut || style > 1.5) {
    // closed: a happy arc
    let a = vec2f(q.x / (ew * 0.9), (q.y - eh * 0.25) / (eh * 0.45 + 0.01));
    let on = abs(length(a) - 1.0) * eh * 0.45 < 0.012 && a.y < -0.2;
    c = select(c, ink, on);
  } else if (style > 0.5) {
    // dots
    let r = vec2f(ew * 0.42, max(ew * 0.18, eh * 0.5));
    c = mix(c, vec3f(0.12, 0.07, 0.06), aa(inEllipse(q, r), px));
    c = mix(c, vec3f(1.0), aa(inEllipse(q - vec2f(-ew * 0.12 * s, -eh * 0.14), vec2f(ew * 0.11)), px));
  } else {
    let white = aa(inEllipse(q, vec2f(ew, eh * 0.62)), px);
    let ih = max(eh, ew * 0.9);
    let iris = aa(inEllipse(q - vec2f(0.0, ih * 0.04), vec2f(ew * 0.62, ih * 0.6)), px) * white;
    let pupil = aa(inEllipse(q - vec2f(0.0, ih * 0.08), vec2f(ew * 0.26, ih * 0.3)), px) * white;
    let glint = max(aa(inEllipse(q - vec2f(-ew * 0.22 * s, -ih * 0.18), vec2f(ew * 0.16, ih * 0.13)), px), aa(inEllipse(q - vec2f(ew * 0.2 * s, ih * 0.22), vec2f(ew * 0.07)), px)) * white;
    let ic = unpackRGB(p.x);
    c = mix(c, vec3f(1.0), white);
    c = mix(c, mix(ic * 0.55, ic * 1.15, clamp((q.y + ih * 0.6) / (ih * 1.2), 0.0, 1.0)), iris);
    c = mix(c, vec3f(0.1, 0.06, 0.05), pupil);
    c = mix(c, vec3f(1.0), glint);
    // the upper lash line: a thick arc over the top of the eye
    let lq = vec2f(q.x / (ew * 1.04), (q.y - eh * 0.05) / (eh * 0.66));
    let lw = (6.0 + lash * 10.0) / 1024.0;
    let lid = abs(length(lq) - 1.0) * eh * 0.66 < lw && lq.y < -0.25;
    c = select(c, ink, lid);
  }
  // the brow: a curved stroke above the eye, its inner end lifted (sad) or lowered (cross)
  let by = ec.y - ew * (0.95 + browY * 0.55) - eh * 0.3;
  let bx = (uv.x - ec.x) * s;
  if (abs(bx) < ew * 1.0) {
    let tb = bx / ew;
    let yb = by + 0.012 * tb * tb - 0.01 - browTilt * 0.02 * (-tb);
    let bw = (4.0 + browW * 9.0) / 1024.0;
    c = select(c, ink, abs(uv.y - yb) < bw && browW > 0.01);
  }
  // the mouth: a curve between the nose and the chin (a smile bends it up)
  let mw = 0.05 + mouth * 0.08;
  let sm = (smile - 0.5) * 30.0 / 512.0;
  let mx = (uv.x - 0.5) / mw;
  if (abs(mx) < 1.0) {
    let tt = (mx + 1.0) * 0.5;
    let y0 = 0.77 - sm * 0.3;
    let ym = y0 + 2.0 * tt * (1.0 - tt) * (0.77 + sm - y0);
    c = select(c, vec3f(0.42, 0.16, 0.14), abs(uv.y - ym) < 5.0 / 1024.0);
  }
  return c;
}
`;
