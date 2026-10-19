// modules › presets › humans › hair › styles: the hair styles a humans pack carries, by name. Some are sculpted (made
// by hand on the base body, a generated cap under them where they leave the scalp bare); the rest are generated from
// a few numbers (hair › generate). A pack bakes them all once (tools/humans-pack.mjs); a style of your own is the
// same numbers: generateHair(yours, scalp).
import type { HairParams } from './generate.ts';

export interface HairStyle {
  /** what it looks like, in a few words */
  label: string;
  /** a sculpted style in the source template (its name there); else generated from `params` */
  sculpted?: string;
  /** a generated shell under a sculpted style: fills what it leaves bare */
  cap?: HairParams;
  params?: HairParams;
  /** who it suits by default when people are made at random: weights by presentation (0: never) */
  suits: { masc: number; fem: number };
  /** long enough to keep off the shoulders when it is tied (a ponytail, a bun) */
  long?: boolean;
}
const SHORT_CAP: HairParams = { front: 0.8, temple: 0.7, side: 0.58, nape: 0.1, thickness: 0.006, volume: 0.004 };
export const HAIR_STYLES: Readonly<Record<string, HairStyle>> = {
  short: { label: 'short, a little messy', sculpted: 'hair_short_m', cap: SHORT_CAP, suits: { masc: 3, fem: 0.6 } },
  spiky: { label: 'short and spiky', sculpted: 'hair_spiky', cap: SHORT_CAP, suits: { masc: 1.2, fem: 0.2 } },
  bob: { label: 'a bob', sculpted: 'hair_bob', suits: { masc: 0.1, fem: 2 } },
  long: { label: 'long, to mid-back, with bangs', sculpted: 'hair_long', suits: { masc: 0.15, fem: 2.2 }, long: true },
  ponytail: { label: 'a ponytail', sculpted: 'hair_ponytail', suits: { masc: 0.1, fem: 1.6 }, long: true },
  bun: { label: 'a bun', sculpted: 'hair_bun', suits: { masc: 0.05, fem: 1.2 }, long: true },
  crew: { label: 'a crew cut', params: { front: 0.8, temple: 0.72, side: 0.6, nape: 0.12, thickness: 0.006, volume: 0.006, sideburn: 0.012 }, suits: { masc: 2.2, fem: 0.2 } },
  'side-part': { label: 'short, parted at the side', params: { front: 0.79, temple: 0.7, side: 0.58, nape: 0.12, thickness: 0.012, volume: 0.022, sideburn: 0.015, part: 1 }, suits: { masc: 1.6, fem: 0.3 } },
  buzz: { label: 'buzzed close', params: { front: 0.82, temple: 0.74, side: 0.62, nape: 0.14, thickness: 0.003, volume: 0, sideburn: 0.008 }, suits: { masc: 1.2, fem: 0.15 } },
  receding: { label: 'thinning, a high hairline', params: { front: 0.93, temple: 0.86, side: 0.6, nape: 0.12, thickness: 0.004, volume: 0.002, sideburn: 0.01 }, suits: { masc: 0.8, fem: 0 } },
  afro: { label: 'a full afro', params: { front: 0.8, temple: 0.7, side: 0.56, nape: 0.16, thickness: 0.022, volume: 0.05, tufts: 0.01, tuftFreq: 13, sideburn: 0.01 }, suits: { masc: 0.7, fem: 0.8 } },
  curls: { label: 'short curls', params: { front: 0.8, temple: 0.7, side: 0.58, nape: 0.14, thickness: 0.014, volume: 0.02, tufts: 0.008, tuftFreq: 11 }, suits: { masc: 1, fem: 0.6 } },
  shoulder: { label: 'straight, to the shoulders', params: { front: 0.8, temple: 0.68, side: 0.55, nape: 0.18, thickness: 0.01, volume: 0.014, length: 0.14, fringe: 0.03, sideburn: 0.02 }, suits: { masc: 0.25, fem: 1.6 } },
  'long-straight': { label: 'long and straight, no fringe', params: { front: 0.82, temple: 0.68, side: 0.55, nape: 0.18, thickness: 0.009, volume: 0.012, length: 0.3, part: -1 }, suits: { masc: 0.1, fem: 1.5 }, long: true },
  'curly-long': { label: 'long curls', params: { front: 0.8, temple: 0.68, side: 0.55, nape: 0.18, thickness: 0.016, volume: 0.03, length: 0.2, tufts: 0.009, tuftFreq: 10 }, suits: { masc: 0.1, fem: 1.2 }, long: true },
  pixie: { label: 'a pixie cut with a fringe', params: { front: 0.8, temple: 0.7, side: 0.58, nape: 0.14, thickness: 0.009, volume: 0.016, fringe: 0.035, sideburn: 0.02 }, suits: { masc: 0.2, fem: 1 } },
};
