// modules › presets › humans › expressions: what a face shows. Emotions are the face's numbers moved (a smile, the
// brows, the eyes' opening), mixed in by an amount; a blink is drawn by the clock (a sixth of a second every three to
// six seconds, each person on their own beat: the face's `blinks`). Speech (visemes) and gestures come later.
//   entity.decal = packFace(express(face, 'happy', 0.8))
import type { Face } from '../face/index.ts';

type Moves = Partial<Pick<Face, 'eyeOpen' | 'brow' | 'browY' | 'browTilt' | 'mouth' | 'smile' | 'blush' | 'style'>>;
export const EMOTIONS: Readonly<Record<string, Moves>> = {
  neutral: {},
  happy: { smile: 0.95, eyeOpen: 0.45, blush: 0.3, browY: 0.6 },
  joy: { smile: 1, style: 'closed', blush: 0.45, browY: 0.7 },
  calm: { smile: 0.65, eyeOpen: 0.45 },
  sad: { smile: 0.15, browTilt: 1, eyeOpen: 0.4, browY: 0.45 },
  worried: { smile: 0.35, browTilt: 0.7, eyeOpen: 0.65, browY: 0.7 },
  surprised: { eyeOpen: 1, browY: 1, smile: 0.5, mouth: 0.15 },
  angry: { browTilt: -1, smile: 0.25, eyeOpen: 0.45, browY: 0.25, brow: 0.8 },
  tired: { eyeOpen: 0.15, smile: 0.4, browY: 0.35 },
};
/** a face with an emotion mixed in (amount 0 … 1; a style switches past half) */
export function express(f: Face, emotion: keyof typeof EMOTIONS | Moves, amount = 1): Face {
  const m = typeof emotion === 'string' ? EMOTIONS[emotion] ?? {} : emotion, out: Face = { ...f };
  for (const [k, v] of Object.entries(m) as [keyof Moves, number | string][]) {
    if (k === 'style') { if (amount >= 0.5) out.style = v as Face['style']; continue; }
    (out as unknown as Record<string, number>)[k] = (f[k] as number) + ((v as number) - (f[k] as number)) * amount;
  }
  return out;
}
/** blinking: on or off for a face (the clock does the rest) */
export const blink = (f: Face, on = true): Face => ({ ...f, blinks: on });
