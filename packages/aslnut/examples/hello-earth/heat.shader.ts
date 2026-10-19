// The heat layer's shader code (the WGSL subset): edit it while the example runs (dev server: hot reload; the page
// also has an editor). The same code runs on WebGPU and, translated, on WebGL2.
export const vertex = /* wgsl */ `
glow = value * params.gain;
`;
export const fragment = /* wgsl */ `
let r = length(corner);
let k = smoothstep(1.0, 0.0, r) * glow;
color = vec4f(mix(vec3f(1.0, 0.85, 0.25), params.tint, clamp(glow, 0.0, 1.0)), k * 0.7);
`;
