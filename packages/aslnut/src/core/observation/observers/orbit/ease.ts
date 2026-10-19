// core › render › camera › easing: 0..1 in, 0..1 out (a spring or an overshoot may pass 1 on the way).
//   the presets people pick per key: smooth · cinematic · glide · snap · anticipate · overshoot · linear
//   and expressions: in · out · inOut · step · steps(n) · cubic-bezier(a,b,c,d) · spring(stiffness, damping)
import { AslnutError } from '../../../world/errors.ts';

export const EASES: Record<string, (u: number) => number> = {
  linear: (u) => u,
  in: (u) => u * u * u,
  out: (u) => 1 - (1 - u) ** 3,
  inOut: (u) => (u < 0.5 ? 4 * u * u * u : 1 - (-2 * u + 2) ** 3 / 2),
  step: (u) => (u >= 1 ? 1 : 0),
};
/** the presets: name → an expression */
export const EASE_PRESETS: Record<string, string> = {
  linear: 'linear', smooth: 'inOut', cinematic: 'cubic-bezier(0.7,0,0.18,1)', glide: 'linear',
  snap: 'cubic-bezier(0.15,0.85,0.25,1)', anticipate: 'cubic-bezier(0.55,-0.3,0.3,1)', overshoot: 'cubic-bezier(0.3,1.35,0.55,1)',
};
export const PRESET_NOTES: Record<string, string> = {
  linear: 'constant speed', smooth: 'cubic in-out', cinematic: 'slow start, long settle', glide: 'no stop: constant speed through the key',
  snap: 'fast in, soft settle', anticipate: 'a small pull back before moving', overshoot: 'passes the key, settles back',
};
export type Ease = keyof typeof EASE_PRESETS | (string & {}) | ((u: number) => number);

export const clamp01 = (u: number) => (u < 0 ? 0 : u > 1 ? 1 : u);

/** CSS cubic-bezier(x1, y1, x2, y2): solve x(s) = u (Newton, then bisection), return y(s) */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number): (u: number) => number {
  const bx = (s: number) => 3 * x1 * s * (1 - s) ** 2 + 3 * x2 * s * s * (1 - s) + s ** 3;
  const by = (s: number) => 3 * y1 * s * (1 - s) ** 2 + 3 * y2 * s * s * (1 - s) + s ** 3;
  const dx = (s: number) => 3 * x1 * (1 - s) ** 2 + 6 * (x2 - x1) * s * (1 - s) + 3 * (1 - x2) * s * s;
  return (u) => {
    if (u <= 0) return 0; if (u >= 1) return 1;
    let s = u;
    for (let i = 0; i < 6; i++) { const d = dx(s); if (Math.abs(d) < 1e-6) break; s -= (bx(s) - u) / d; }
    if (s < 0 || s > 1 || Math.abs(bx(s) - u) > 1e-5) { let a = 0, b = 1; s = u; for (let i = 0; i < 40; i++) { s = (a + b) / 2; if (bx(s) < u) a = s; else b = s; } }
    return by(s);
  };
}
/** a damped spring from 0 to 1, its settle time mapped onto 0..1; ends exactly at 1 */
export function spring(stiffness = 170, damping = 26): (u: number) => number {
  const w0 = Math.sqrt(Math.max(1e-6, stiffness)), z = damping / (2 * w0);
  const T = Math.min(10, 6.5 / (Math.max(0.05, Math.min(z, 1)) * w0));
  const x = (t: number) => {
    if (z < 1) { const wd = w0 * Math.sqrt(1 - z * z); return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + ((z * w0) / wd) * Math.sin(wd * t)); }
    if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    const r1 = -w0 * (z - Math.sqrt(z * z - 1)), r2 = -w0 * (z + Math.sqrt(z * z - 1));
    return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
  };
  return (u) => (u <= 0 ? 0 : u >= 1 ? 1 : x(u * T));
}

const made = new Map<string, (u: number) => number>();
/** an easing by preset, name or expression; a typo throws (it never silently becomes linear) */
export function easing(e: Ease | undefined): (u: number) => number {
  if (typeof e === 'function') return e;
  const n0 = (e ?? 'smooth').trim(), n = EASE_PRESETS[n0] ?? n0;
  const f = EASES[n] ?? made.get(n);
  if (f) return f;
  let m = /^cubic-bezier\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)$/.exec(n);
  if (m) { const g = cubicBezier(+m[1]!, +m[2]!, +m[3]!, +m[4]!); made.set(n, g); return g; }
  m = /^steps(?:\(\s*(\d+)\s*\)|\s+(\d+))$/.exec(n);
  if (m) { const k = Number(m[1] ?? m[2]); const g = (u: number) => (u >= 1 ? 1 : Math.floor(u * k) / k); made.set(n, g); return g; }
  m = /^spring(?:\(\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\))?$/.exec(n);
  if (m) { const g = spring(m[1] ? +m[1] : undefined, m[2] ? +m[2] : undefined); made.set(n, g); return g; }
  throw new AslnutError('E-VIEW-001', `unknown ease '${n0}'`, { fix: `use a preset (${Object.keys(EASE_PRESETS).join(', ')}), in / out / inOut, steps(n), cubic-bezier(a,b,c,d), spring(k, d) or a function` });
}
export const ease = (e: Ease | undefined, u: number): number => easing(e)(clamp01(u));
/** a preset's curve as [u, y] samples (thumbnails in an authoring UI) */
export const presetCurve = (name: Ease, n = 32): [number, number][] => Array.from({ length: n + 1 }, (_, i) => [i / n, ease(name, i / n)]);
