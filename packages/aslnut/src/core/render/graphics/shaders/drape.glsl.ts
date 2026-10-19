// Twin of drape.wgsl.ts: the same functions in the same order.
export const DRAPE_GLSL = /* glsl */ `
uniform highp sampler2D geo;
uniform highp sampler2D sceneDepth;
/*@upperDecl*/
const int GW = 2048;
vec4 pieceAt(int n, int r, int k) {
  int t = n * r + k;
  return texelFetch(geo, ivec2(t % GW, t / GW), 0);
}
vec4 depthPlace(vec2 fc, float d, float bias) {
  if (d >= 0.9999999) {
    return vec4(0.0);
  }
  vec2 t = vec2(fc.x / frame.fbsize.x * 2.0 - 1.0, fc.y / frame.fbsize.y * 2.0 - 1.0);
  vec2 ndc = (t - frame.region.zw) / frame.region.xy;
  // (the ground drew itself a little farther in the depth order: frame's groundClip, undone here)
  vec4 w = frame.inv * vec4(ndc, d - bias, 1.0);
  if (!(abs(w.w) > 0.000000000000000000000000000001)) {
    return vec4(0.0);
  }
  vec3 p = w.xyz / w.w;
  if (!(abs(p.x) + abs(p.y) + abs(p.z) < 1000000000000000000000000000000.0)) {
    return vec4(0.0);
  }
  return vec4(p, 1.0);
}
vec4 groundAt(vec2 fc) {
  return depthPlace(fc, texelFetch(sceneDepth, ivec2(fc), 0).r, GROUND_DEPTH_BIAS);
}
/*@upperFn*/
vec4 edgePlane(vec2 a, vec2 b, vec3 A, vec3 UA, vec3 B, vec3 UB) {
  vec3 P0 = A;
  vec3 U0 = UA;
  vec3 Q0 = B;
  if (b.x < a.x || (b.x == a.x && b.y < a.y)) {
    P0 = B;
    U0 = UB;
    Q0 = A;
  }
  vec3 n = cross(Q0 - P0, U0 - P0);
  return vec4(n, -dot(n, P0));
}
bool inSide(float s, float k) {
  return s * k > 0.0 || (s == 0.0 && k > 0.0);
}
float prismAt(float level, vec2 g) {
  /*@upperPrism*/
  if (u.ground.z > 0.5) {
    return u.ground.x * u.origin.z + u.origin.w;
  }
  // w = 1: the pieces' own ranges are being measured again (the ground changed): the layer's, never too short; a
  // piece's own never wider than the layer's (a range read where only coarse tiles were in spans a whole region)
  vec2 r = clamp(g, vec2(u.ground.x), vec2(u.ground.y));
  if (u.ground.w > 0.5) {
    r = u.ground.xy;
  }
  return mix(r.x, r.y, level) * u.origin.z + u.origin.w;
}
`;

// Twin of UPPER_WGSL (drape.wgsl.ts).
export const UPPER_GLSL = {
  decl: /* glsl */ `uniform highp sampler2D groundDepth;`,
  fn: /* glsl */ `bool upperKeeps(vec2 fc, vec4 g) {
  float kept = texelFetch(groundDepth, ivec2(fc), 0).r;
  float here = texelFetch(sceneDepth, ivec2(fc), 0).r;
  if (!(here < kept)) {
    return false;
  }
  if (u.slots2.z > 0.0) {
    vec4 under = depthPlace(fc, kept, GROUND_DEPTH_BIAS);
    vec4 top = depthPlace(fc, here, 0.0);
    if (under.w < 0.5 || top.y - under.y > u.slots2.z) {
      return false;
    }
  }
  return true;
}`,
  prism: /* glsl */ `vec2 ru = clamp(g, vec2(u.ground.x), vec2(u.ground.y));
  if (u.ground.w > 0.5 || u.ground.z > 0.5) {
    ru = u.ground.xy;
  }
  return mix(ru.x - 5.0, max(ru.x, ru.y) + u.slots2.w, level) * u.origin.z + u.origin.w;`,
  fs: /* glsl */ `if (!upperKeeps(gl_FragCoord.xy, g)) {
    discard;
  }`,
};
