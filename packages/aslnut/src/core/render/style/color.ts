// core › render › style › color: colours as people write them → [r, g, b, a] in 0..1.
//   '#f80' · '#ff8800' · '#ff880080' · 'rgb(255 136 0)' · 'rgba(255,136,0,.5)' · [1, 0.53, 0] · [1, 0.53, 0, 0.5]
import { AslnutError } from '../../world/errors.ts';

export type Color = string | readonly number[];
export type RGBA = [number, number, number, number];
const cache = new Map<string, RGBA>();

export function rgba(c: Color | undefined | null, fallback: Color = '#ffffff'): RGBA {
  if (c === undefined || c === null) return rgba(fallback);
  if (Array.isArray(c)) return [c[0] ?? 1, c[1] ?? 1, c[2] ?? 1, c[3] ?? 1];
  const s = c as string, hit = cache.get(s); if (hit) return hit;
  let out: RGBA | null = null;
  let m = /^#([0-9a-f]{3,4})$/i.exec(s);
  if (m) { const h = m[1]!; out = [parseInt(h[0]! + h[0], 16) / 255, parseInt(h[1]! + h[1], 16) / 255, parseInt(h[2]! + h[2], 16) / 255, h[3] ? parseInt(h[3] + h[3], 16) / 255 : 1]; }
  m = out ? null : /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(s);
  if (m) { const n = parseInt(m[1]!, 16); out = [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255, m[2] ? parseInt(m[2], 16) / 255 : 1]; }
  m = out ? null : /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/i.exec(s);
  if (m) { const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : +m[4]; out = [+m[1]! / 255, +m[2]! / 255, +m[3]! / 255, a]; }
  if (!out && s === 'transparent') out = [0, 0, 0, 0];
  if (!out) throw new AslnutError('E-DATA-001', `colour '${s}' is not one aslnut reads`, { fix: "write '#ff8800', '#ff880080', 'rgb(255 136 0)' or [1, 0.53, 0]" });
  if (cache.size > 4096) cache.clear();
  cache.set(s, out);
  return out;
}
export const hex = (c: RGBA): string => `#${c.slice(0, 3).map((v) => Math.round(Math.max(0, Math.min(1, v)) * 255).toString(16).padStart(2, '0')).join('')}${c[3] < 1 ? Math.round(Math.max(0, c[3]) * 255).toString(16).padStart(2, '0') : ''}`;
export const mix = (a: RGBA, b: RGBA, t: number): RGBA => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, a[3] + (b[3] - a[3]) * t];
