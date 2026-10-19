// modules › presets › humans › clothing: what a person wears, in two kinds. The light one is colour only: the body is
// painted by region from the person's palette (a top, its sleeves to where they end, the bottoms and their length,
// shoes), so a crowd's outfits cost nothing. The full one is garments (clothing › garments): shells over the body and
// pieces that hang (skirts, dresses, collars), made into the figure. Both take their colours from the same palette.
//   const outfit = { top: '#d9452f', sleeves: 'short', bottom: '#1f2a44', legs: 'long', shoes: '#e9e9e9' }
//   palette(outfit, skin, hair)   → 8 colours, an entity's `palette`
export { GARMENTS, buildGarment, garmentParams, type Garment, type GarmentType, type GarmentPiece, type GarmentBody } from './garments.ts';
import type { Garment } from './garments.ts';

/** the palette's slots: what each colour paints */
export const PALETTE = { skin: 0, top: 1, upperArm: 2, forearm: 3, bottom: 4, shin: 5, shoes: 6, hair: 7 } as const;
export interface Outfit {
  top: string; sleeves: 'none' | 'short' | 'elbow' | 'long';
  bottom: string; legs: 'short' | 'knee' | 'long';
  shoes: string;
  /** garments made into the figure (shells, skirts, dresses); their colours from the slots above */
  garments?: Garment[];
}
const hex = (c: string) => parseInt(c.replace('#', ''), 16);
const mix = (a: string, b: string, t: number) => { const x = hex(a), y = hex(b), ch = (s: number) => Math.round(((x >> s) & 255) * (1 - t) + ((y >> s) & 255) * t); return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`; };
/** a person's 8 colours: skin, the top, the upper arms and forearms (the top's or the skin's, by the sleeves), the
 *  bottoms, the shins (by the legs' length: a knee length half and half), the shoes, the hair */
export function palette(o: Outfit, skin: string, hair: string): string[] {
  const garments = o.garments ?? [], dress = garments.some((g) => g.type === 'dress'), bottom = dress ? o.top : o.bottom;
  const legs = dress ? (garments.find((g) => g.type === 'dress')?.params?.length === 'knee' ? 'knee' : 'long') : o.legs;
  const sleeves = garments.find((g) => g.type === 'shirt' || g.type === 'dress' || g.type === 'jacket')?.params?.sleeve as Outfit['sleeves'] | undefined ?? o.sleeves;
  return [skin, o.top, sleeves === 'none' ? skin : o.top, sleeves === 'long' ? o.top : sleeves === 'elbow' ? mix(o.top, skin, 0.5) : skin, bottom, legs === 'long' ? bottom : legs === 'knee' ? mix(bottom, skin, 0.5) : skin, o.shoes, hair];
}
/** the outfits most streets show, as starting points */
export const OUTFITS: Readonly<Record<string, Outfit>> = {
  tee: { top: '#f2f2ee', sleeves: 'short', bottom: '#2f3d58', legs: 'long', shoes: '#2b2b2b' },
  shirt: { top: '#8fb4d8', sleeves: 'long', bottom: '#3a3a40', legs: 'long', shoes: '#3b2a20', garments: [{ type: 'shirt', params: { sleeve: 'long', collar: 'yes' } }] },
  school: { top: '#f4f4f0', sleeves: 'short', bottom: '#6b6f75', legs: 'long', shoes: '#151515' },
  sport: { top: '#d9452f', sleeves: 'short', bottom: '#1f2a44', legs: 'short', shoes: '#e9e9e9' },
  market: { top: '#7a8b5a', sleeves: 'short', bottom: '#4a3b2c', legs: 'knee', shoes: '#5a4632' },
  jacket: { top: '#2b3a2f', sleeves: 'long', bottom: '#2f3d58', legs: 'long', shoes: '#2b2b2b', garments: [{ type: 'jacket' }] },
  dress: { top: '#3b5b4f', sleeves: 'short', bottom: '#3b5b4f', legs: 'long', shoes: '#2b2b2b', garments: [{ type: 'dress', params: { length: 'midi', sleeve: 'short' } }] },
  skirt: { top: '#f2e6d8', sleeves: 'short', bottom: '#5a4a6a', legs: 'knee', shoes: '#2b2b2b', garments: [{ type: 'skirt', params: { length: 'knee' } }] },
  sarong: { top: '#e8e2d0', sleeves: 'short', bottom: '#5b3a2a', legs: 'long', shoes: '#4a3524', garments: [{ type: 'sarong' }] },
};
