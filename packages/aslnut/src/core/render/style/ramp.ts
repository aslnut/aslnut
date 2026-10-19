// core › render › style › ramp: named colour runs and your own. A ramp is a function t (0..1) → colour.
//   ramp('viridis')(0.4) · ramp([[0, '#023'], [1, '#f80']]) · ramp(['#fee', '#c00']) · ramps.names
import { AslnutError } from '../../world/errors.ts';
import { hex, mix, rgba, type Color } from './color.ts';

/** sequential (low → high), diverging (low ↔ high round a middle) and categorical palettes */
export const RAMPS: Record<string, string[]> = {
  viridis: ['#440154', '#482878', '#3e4989', '#31688e', '#26828e', '#1f9e89', '#35b779', '#6ece58', '#b5de2b', '#fde725'],
  inferno: ['#000004', '#1b0c41', '#4a0c6b', '#781c6d', '#a52c60', '#cf4446', '#ed6925', '#fb9b06', '#f7d13d', '#fcffa4'],
  magma: ['#000004', '#180f3d', '#440f76', '#721f81', '#9e2f7f', '#cd4071', '#f1605d', '#fd9668', '#feca8d', '#fcfdbf'],
  plasma: ['#0d0887', '#46039f', '#7201a8', '#9c179e', '#bd3786', '#d8576b', '#ed7953', '#fb9f3a', '#fdca26', '#f0f921'],
  turbo: ['#30123b', '#4662d7', '#36aaf9', '#1ae4b6', '#72fe5e', '#c8ef34', '#faba39', '#f66b19', '#ca2a04', '#7a0403'],
  cividis: ['#00224e', '#123570', '#3b496c', '#575d6d', '#707173', '#8a8779', '#a69d75', '#c4b56c', '#e4cf5b', '#fee838'],
  reds: ['#fff5f0', '#fee0d2', '#fcbba1', '#fc9272', '#fb6a4a', '#ef3b2c', '#cb181d', '#a50f15', '#67000d'],
  blues: ['#f7fbff', '#deebf7', '#c6dbef', '#9ecae1', '#6baed6', '#4292c6', '#2171b5', '#08519c', '#08306b'],
  greens: ['#f7fcf5', '#e5f5e0', '#c7e9c0', '#a1d99b', '#74c476', '#41ab5d', '#238b45', '#006d2c', '#00441b'],
  oranges: ['#fff5eb', '#fee6ce', '#fdd0a2', '#fdae6b', '#fd8d3c', '#f16913', '#d94801', '#a63603', '#7f2704'],
  purples: ['#fcfbfd', '#efedf5', '#dadaeb', '#bcbddc', '#9e9ac8', '#807dba', '#6a51a3', '#54278f', '#3f007d'],
  greys: ['#ffffff', '#f0f0f0', '#d9d9d9', '#bdbdbd', '#969696', '#737373', '#525252', '#252525', '#000000'],
  ylorrd: ['#ffffcc', '#ffeda0', '#fed976', '#feb24c', '#fd8d3c', '#fc4e2a', '#e31a1c', '#bd0026', '#800026'],
  ylgnbu: ['#ffffd9', '#edf8b1', '#c7e9b4', '#7fcdbb', '#41b6c4', '#1d91c0', '#225ea8', '#253494', '#081d58'],
  rdylgn: ['#a50026', '#d73027', '#f46d43', '#fdae61', '#fee08b', '#d9ef8b', '#a6d96a', '#66bd63', '#1a9850', '#006837'],
  rdbu: ['#67001f', '#b2182b', '#d6604d', '#f4a582', '#fddbc7', '#d1e5f0', '#92c5de', '#4393c3', '#2166ac', '#053061'],
  spectral: ['#9e0142', '#d53e4f', '#f46d43', '#fdae61', '#fee08b', '#e6f598', '#abdda4', '#66c2a5', '#3288bd', '#5e4fa2'],
  // categorical: distinct colours for kinds, not amounts
  category: ['#4e79a7', '#f28e2b', '#e15759', '#76b7b2', '#59a14f', '#edc948', '#b07aa1', '#ff9da7', '#9c755f', '#bab0ac'],
  set2: ['#66c2a5', '#fc8d62', '#8da0cb', '#e78ac3', '#a6d854', '#ffd92f', '#e5c494', '#b3b3b3'],
  pastel: ['#fbb4ae', '#b3cde3', '#ccebc5', '#decbe4', '#fed9a6', '#ffffcc', '#e5d8bd', '#fddaec'],
};
export const CATEGORICAL = new Set(['category', 'set2', 'pastel']);
export type Ramp = string | Color[] | [number, Color][] | ((t: number) => Color);
export interface RampFn { (t: number): string; stops: string[]; name: string }

/** a ramp by name, stops ([t, colour] pairs), colours (evenly spread) or your function */
export function ramp(r: Ramp, o: { reverse?: boolean } = {}): RampFn {
  let f: (t: number) => string, stops: string[], name = 'custom';
  if (typeof r === 'function') { f = (t) => hex(rgba(r(t))); stops = Array.from({ length: 9 }, (_, i) => f(i / 8)); }
  else {
    let pairs: [number, string][];
    if (typeof r === 'string') {
      const k = r.toLowerCase(), list = RAMPS[k];
      if (!list) throw new AslnutError('E-DATA-001', `no ramp '${r}'`, { fix: `use one of ${Object.keys(RAMPS).join(', ')}, or give colours` });
      name = k; pairs = list.map((c, i) => [i / (list.length - 1), c]);
    } else if (Array.isArray(r) && r.length && Array.isArray(r[0]) && typeof (r[0] as unknown[])[0] === 'number' && (r[0] as unknown[]).length === 2) {
      pairs = (r as [number, Color][]).map(([t, c]) => [t, hex(rgba(c))]);
    } else if (Array.isArray(r) && r.length) {
      const cs = r as Color[]; pairs = cs.map((c, i) => [cs.length === 1 ? 0 : i / (cs.length - 1), hex(rgba(c))]);
    } else throw new AslnutError('E-DATA-001', 'a ramp is a name, colours, [t, colour] stops or a function', { fix: "ramp('viridis') · ramp(['#fee', '#c00'])" });
    pairs.sort((a, b) => a[0] - b[0]);
    const cols = pairs.map(([t, c]) => [t, rgba(c)] as const);
    stops = pairs.map((p) => p[1]);
    f = (t) => {
      if (!(t >= cols[0]![0])) return hex(cols[0]![1]);
      for (let i = 1; i < cols.length; i++) if (t <= cols[i]![0]) { const a = cols[i - 1]!, b = cols[i]!; return hex(mix(a[1], b[1], (t - a[0]) / (b[0] - a[0] || 1))); }
      return hex(cols[cols.length - 1]![1]);
    };
  }
  const g = (o.reverse ? (t: number) => f(1 - t) : f) as RampFn;
  Object.defineProperties(g, { stops: { value: o.reverse ? [...stops].reverse() : stops }, name: { value: name } });
  return g;
}
/** n colours from a ramp: evenly from a sequential one, in order from a categorical one */
export function colours(r: Ramp, n: number): string[] {
  if (typeof r === 'string' && CATEGORICAL.has(r.toLowerCase())) { const l = RAMPS[r.toLowerCase()]!; return Array.from({ length: n }, (_, i) => l[i % l.length]!); }
  const f = ramp(r);
  return Array.from({ length: n }, (_, i) => f(n === 1 ? 0.5 : i / (n - 1)));
}
