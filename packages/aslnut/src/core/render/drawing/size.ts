// core › render › drawing › instancing › size: one rule for how big a thing is drawn, the same for every mark and every
// shape: CSS px as given, or metres, either kept within a range of CSS px. The metres become the pixels they cover
// where the thing is seen, in the vertex stage (sizePx and sizeKeep in the frame shader every program shares), so a
// zoom writes nothing: no restyle, no rebuild.
//   points({ size: 8 })                                CSS px (as before)
//   points({ size: { m: 40, min: 4, max: 32 } })       40 m across, never under 4 px nor over 32 px
//   line({ width: { m: (d) => d.props.lanes * 3.5, min: 1 } })      a road's width in metres, at least a pixel
//   shape({ size: { min: 6, max: 64 } })               a shape's own metres, kept 6 to 64 px across on screen
import { AslnutError } from '../../world/errors.ts';

/** a size: CSS px (a value), CSS px kept within a range, or metres kept within a range of CSS px. The value is what
 *  the mark takes for its size (a number, or your function of the feature) */
export type SizeOf<V> = V | { px: V; min?: number; max?: number } | { m: V; min?: number; max?: number };
/** a shape's on-screen range: its own metres, kept within [min, max] CSS px across */
export interface SizeRange { min?: number; max?: number }
/** how a size is drawn: units (0 CSS px, 1 metres), the least and the most CSS px (the frame shader's `s`) */
export type SizeUnits = readonly [number, number, number, number];
/** no range: px as given */
export const PX: SizeUnits = Object.freeze([0, 0, 1e6, 0]) as SizeUnits;

const isSpec = (v: unknown): v is { px?: unknown; m?: unknown; min?: number; max?: number } => !!v && typeof v === 'object' && !Array.isArray(v) && ('px' in (v as object) || 'm' in (v as object));
/** the value a size gives (a number, a function: what the mark styles per feature) */
export function sizeValue<V>(s: SizeOf<V> | undefined): V | undefined {
  if (!isSpec(s)) return s as V | undefined;
  return ('m' in s ? s.m : s.px) as V;
}
/** how a size is drawn (`where`: the prop, for its error) */
export function sizeUnits(s: unknown, where = 'size'): SizeUnits {
  if (!isSpec(s)) return PX;
  const lo = s.min ?? 0, hi = s.max ?? 1e6;
  if (!(lo >= 0) || !(hi >= lo)) throw new AslnutError('E-DATA-001', `${where}: min ${s.min} and max ${s.max} are not a range of CSS px`, { where, fix: `${where}: { m: 40, min: 4, max: 32 }` });
  return ['m' in s ? 1 : 0, lo, hi, 0];
}
/** a shape's range (metres kept within [min, max] CSS px); unset: as it is */
export function rangeUnits(r: SizeRange | undefined, where = 'size'): SizeUnits {
  return r ? sizeUnits({ m: 0, min: r.min, max: r.max }, where) : PX;
}
/** CSS px from a size at a distance (m) from the eye: the same as the frame shader's sizePx, for the main thread's own
 *  choices (a label's picture, a level by the pixels a shape covers). `mpp`: metres per CSS px at 1 m (2 tan(fov / 2)
 *  / the view's CSS height) */
export function sizePxAt(v: number, u: SizeUnits, dist: number, mpp: number): number {
  const px = u[0] > 0.5 ? v / Math.max(dist * mpp, 1e-9) : v;
  return Math.min(u[2], Math.max(u[1], px));
}
