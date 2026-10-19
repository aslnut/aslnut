export interface Ground { x0: number; z0: number; step: number; nx: number; nz: number; data: Float32Array }
export const groundAt = (g: Ground, x: number, z: number): number => {
  const fx = Math.max(0, Math.min(g.nx - 1.001, (x - g.x0) / g.step)), fz = Math.max(0, Math.min(g.nz - 1.001, (z - g.z0) / g.step)), i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, d = g.data, n = g.nx;
  return (d[j * n + i]! * (1 - u) + d[j * n + i + 1]! * u) * (1 - v) + (d[(j + 1) * n + i]! * (1 - u) + d[(j + 1) * n + i + 1]! * u) * v;
};
