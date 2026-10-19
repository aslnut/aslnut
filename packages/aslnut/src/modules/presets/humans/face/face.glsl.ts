// Twin of face.wgsl.ts: the face drawn on the face decal, the same functions in the same order.
export const FACE_GLSL = /* glsl */ `
float nib(float v, float at) {
  return (floor(v / at) - floor(v / (at * 16.0)) * 16.0) / 15.0;
}
float inEllipse(vec2 q, vec2 r) {
  float k = length(q / r);
  return (1.0 - k) * min(r.x, r.y);
}
float aa(float d, float w) {
  return clamp(d / max(w, 1e-5) + 0.5, 0.0, 1.0);
}
vec3 skinDecal(vec2 uv, vec3 p, vec3 base, float seed) {
  float px = 0.004;
  float eyeSize = nib(p.y, 1.0);
  float open = 0.42 + nib(p.y, 16.0) * 0.9;
  float gap = 0.16 + nib(p.y, 256.0) * 0.12;
  float tiltK = nib(p.y, 4096.0);
  float lash = nib(p.y, 65536.0);
  float style = floor(p.y / 1048576.0);
  float smile = nib(p.z, 1.0);
  float browW = nib(p.z, 16.0);
  float browY = nib(p.z, 256.0);
  float mouth = nib(p.z, 4096.0);
  float blush = nib(p.z, 65536.0);
  float browTilt = (floor(p.z / 1048576.0) - floor(p.z / 8388608.0) * 8.0 - 3.0) / 3.0;
  float blinks = floor(p.z / 8388608.0);
  float beat = 3.2 + fract(seed * 0.618) * 2.6;
  float ph = fract(frame.eye.w / beat + fract(seed * 0.377));
  bool shut = blinks > 0.5 && ph < 0.05;
  vec3 c = base;
  float s = uv.x > 0.5 ? 1.0 : -1.0;
  float ew = 0.095 + eyeSize * 0.08;
  float eh = ew * (1.0 + eyeSize * 0.3) * open;
  vec2 ec = vec2(0.5 + s * gap, 0.46);
  float ta = (tiltK - 0.5) * 0.5 * s + (1.0 - min(1.0, open)) * 0.12 * s;
  vec2 d = uv - ec;
  vec2 q = vec2(d.x * cos(ta) + d.y * sin(ta), -d.x * sin(ta) + d.y * cos(ta));
  vec3 ink = vec3(0.13, 0.08, 0.06);
  if (blush > 0.02) {
    float b = aa(inEllipse(uv - vec2(ec.x + s * ew * 0.25, ec.y + ew * 1.05), vec2(ew * 0.7, ew * 0.2)), px);
    c = mix(c, vec3(0.94, 0.43, 0.43), b * blush * 0.45);
  }
  if (shut || style > 1.5) {
    vec2 a = vec2(q.x / (ew * 0.9), (q.y - eh * 0.25) / (eh * 0.45 + 0.01));
    bool on = abs(length(a) - 1.0) * eh * 0.45 < 0.012 && a.y < -0.2;
    c = on ? ink : c;
  } else if (style > 0.5) {
    vec2 r = vec2(ew * 0.42, max(ew * 0.18, eh * 0.5));
    c = mix(c, vec3(0.12, 0.07, 0.06), aa(inEllipse(q, r), px));
    c = mix(c, vec3(1.0), aa(inEllipse(q - vec2(-ew * 0.12 * s, -eh * 0.14), vec2(ew * 0.11)), px));
  } else {
    float white = aa(inEllipse(q, vec2(ew, eh * 0.62)), px);
    float ih = max(eh, ew * 0.9);
    float iris = aa(inEllipse(q - vec2(0.0, ih * 0.04), vec2(ew * 0.62, ih * 0.6)), px) * white;
    float pupil = aa(inEllipse(q - vec2(0.0, ih * 0.08), vec2(ew * 0.26, ih * 0.3)), px) * white;
    float glint = max(aa(inEllipse(q - vec2(-ew * 0.22 * s, -ih * 0.18), vec2(ew * 0.16, ih * 0.13)), px), aa(inEllipse(q - vec2(ew * 0.2 * s, ih * 0.22), vec2(ew * 0.07)), px)) * white;
    vec3 ic = unpackRGB(p.x);
    c = mix(c, vec3(1.0), white);
    c = mix(c, mix(ic * 0.55, ic * 1.15, clamp((q.y + ih * 0.6) / (ih * 1.2), 0.0, 1.0)), iris);
    c = mix(c, vec3(0.1, 0.06, 0.05), pupil);
    c = mix(c, vec3(1.0), glint);
    vec2 lq = vec2(q.x / (ew * 1.04), (q.y - eh * 0.05) / (eh * 0.66));
    float lw = (6.0 + lash * 10.0) / 1024.0;
    bool lid = abs(length(lq) - 1.0) * eh * 0.66 < lw && lq.y < -0.25;
    c = lid ? ink : c;
  }
  float by = ec.y - ew * (0.95 + browY * 0.55) - eh * 0.3;
  float bx = (uv.x - ec.x) * s;
  if (abs(bx) < ew * 1.0) {
    float tb = bx / ew;
    float yb = by + 0.012 * tb * tb - 0.01 - browTilt * 0.02 * (-tb);
    float bw = (4.0 + browW * 9.0) / 1024.0;
    c = abs(uv.y - yb) < bw && browW > 0.01 ? ink : c;
  }
  float mw = 0.05 + mouth * 0.08;
  float sm = (smile - 0.5) * 30.0 / 512.0;
  float mx = (uv.x - 0.5) / mw;
  if (abs(mx) < 1.0) {
    float tt = (mx + 1.0) * 0.5;
    float y0 = 0.77 - sm * 0.3;
    float ym = y0 + 2.0 * tt * (1.0 - tt) * (0.77 + sm - y0);
    c = abs(uv.y - ym) < 5.0 / 1024.0 ? vec3(0.42, 0.16, 0.14) : c;
  }
  return c;
}
`;
