// modules › presets › humans › face: a face drawn by the graphics on the face decal from a dozen numbers (no texture),
// so every person has their own at no cost: the eyes' size, opening, spacing and tilt, lashes, the iris colour, brows,
// a mouth and its smile, blushed cheeks; three styles (detailed eyes, dots, closed). Expressions change the numbers
// (expressions › emotions); a blink is the clock in the shader (expressions › blink).
//   const decal = packFace({ ...FACE_DEFAULTS, iris: '#3b6ea5', smile: 0.7 })   → an entity's `decal`
import type { SkinMaterial } from '../../../../core/entities/body/skin.ts';
import { rgbOf } from '../../../../core/geometry/shapes/mesh.ts';
import { FACE_WGSL } from './face.wgsl.ts';
import { FACE_GLSL } from './face.glsl.ts';

export interface Face {
  /** detailed eyes, dots, or closed */
  style: 'eyes' | 'dots' | 'closed';
  /** 0 … 1 each */
  eyeSize: number; eyeOpen: number; eyeGap: number; eyeTilt: number; lash: number;
  brow: number; browY: number; mouth: number; smile: number; blush: number;
  /** −1 (the inner ends down: cross) … 1 (up: sad, worried) */
  browTilt: number;
  /** it blinks now and then */
  blinks: boolean;
  /** the iris */
  iris: string | number;
}
export const FACE_DEFAULTS: Readonly<Face> = { style: 'eyes', eyeSize: 0.45, eyeOpen: 0.55, eyeGap: 0.5, eyeTilt: 0.45, lash: 0.4, brow: 0.5, browY: 0.5, mouth: 0.4, smile: 0.55, blush: 0.1, browTilt: 0, blinks: true, iris: '#5a3a22' };
/** iris colours, the common ones first (browns), as they come in people */
export const IRIS: readonly { color: string; share: number }[] = [
  { color: '#3a2416', share: 0.42 }, { color: '#5a3a22', share: 0.22 }, { color: '#6b4a2a', share: 0.1 }, { color: '#7a6a3a', share: 0.06 },
  { color: '#4f6b3a', share: 0.04 }, { color: '#3b6ea5', share: 0.1 }, { color: '#6d8fa6', share: 0.04 }, { color: '#6b7378', share: 0.02 },
];
const q4 = (v: number) => Math.max(0, Math.min(15, Math.round(v * 15)));
/** a face's three numbers (an entity's `decal`) */
export function packFace(f: Partial<Face> = {}): [number, number, number] {
  const F = { ...FACE_DEFAULTS, ...f }, style = F.style === 'dots' ? 1 : F.style === 'closed' ? 2 : 0;
  const tilt = Math.max(0, Math.min(6, Math.round(F.browTilt * 3 + 3)));
  return [rgbOf(F.iris), q4(F.eyeSize) + q4(F.eyeOpen) * 16 + q4(F.eyeGap) * 256 + q4(F.eyeTilt) * 4096 + q4(F.lash) * 65536 + style * 1048576,
    q4(F.smile) + q4(F.brow) * 16 + q4(F.browY) * 256 + q4(F.mouth) * 4096 + q4(F.blush) * 65536 + tilt * 1048576 + (F.blinks ? 8388608 : 0)];
}
/** the face's material: skin › draw makes one program for every face */
export const FACE_MATERIAL: SkinMaterial = { id: 'human-face', wgsl: FACE_WGSL, glsl: FACE_GLSL };
