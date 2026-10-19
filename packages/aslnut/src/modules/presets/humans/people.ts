// modules › presets › humans › people: ready-made people, as many as you like, each from a seed (the same seed, the
// same person, on every device). Ages from children to the elderly; body types, heights; skin tones across the
// whole human range; hair styles and colours; outfits; faces; gaits and walking speeds. A crowd shares a few figures
// (the geometry) and dresses each person in their own colours, face and height, walking a walking network round a
// place. No head coverings ship yet (a garment type of your own adds one: clothing › garments).
//   const ana = person(7)                         · person('kiosk-owner', { age: 'elder', presentation: 'fem' })
//   entity({ id: 'ana', body: humanFigure(tpl, ana.figure), palette: paletteOf(ana), decal: decalOf(ana), at })
//   const c = crowd(w, { template: () => loadTemplate(url), network: () => net, around: () => [w.camera.lon, w.camera.lat] })
import { entity, entityElement, type BodiesOptions, type Entity, type EntityElement, type EntityElementProps } from '../../../core/entities/index.ts';
import type { World } from '../../../core/world/world.ts';
import type { Network } from '../../../core/geometry/networks/index.ts';
import { shape, num, type Made } from '../../../core/geometry/shapes/shape.ts';
import type { Template } from './body/template.ts';
import { humanFigure, figureKey, type FigureSpec, type HumanFigure } from './body/figure.ts';
import { HAIR_STYLES } from './hair/styles.ts';
import { FACE_DEFAULTS, IRIS, packFace, type Face } from './face/index.ts';
import { express, EMOTIONS } from './expressions/index.ts';
import { palette, type Outfit } from './clothing/index.ts';
import type { Garment } from './clothing/garments.ts';
import { GAITS } from './gaits/index.ts';
import { seeded, walking } from '../shared/locomotion/walker.ts';

export type Age = 'child' | 'teen' | 'adult' | 'elder';
/** a person: what their figure is made of (body, hair style, garments, gait), and what each copy of it wears */
export interface Person {
  id: string; seed: number; age: Age; presentation: 'fem' | 'masc';
  figure: FigureSpec;
  skin: string; hairColor: string; face: Face; outfit: Outfit;
  /** walking speed, m/s; size (1: as made) */
  speed: number; scale: number;
}
export interface PersonOptions {
  age?: Age; presentation?: 'fem' | 'masc';
  skin?: string; hair?: string | null; hairColor?: string;
  outfit?: Partial<Outfit>; gait?: string; emotion?: keyof typeof EMOTIONS;
  /** body sliders over the drawn ones */
  body?: Record<string, number>;
  /** garments (geometry) allowed when drawn at random (default true) */
  garments?: boolean;
}
/** skin tones across the human range, light to deep (a crowd draws them evenly) */
export const SKIN_TONES: readonly string[] = ['#f6dcc8', '#f0cfb4', '#e8c09c', '#ddb08a', '#d4a07a', '#c68c63', '#b67a52', '#a26845', '#8d573a', '#784a31', '#633c28', '#4f3020', '#3e2518'];
/** natural hair colours (black and browns the most common), and the greys of age */
export const HAIR_COLORS: readonly { color: string; share: number }[] = [
  { color: '#16110e', share: 0.34 }, { color: '#2a1c14', share: 0.24 }, { color: '#45301f', share: 0.14 }, { color: '#6b4a2e', share: 0.08 },
  { color: '#8a5a2c', share: 0.05 }, { color: '#7a3a1c', share: 0.04 }, { color: '#b98c52', share: 0.05 }, { color: '#d9bd85', share: 0.03 }, { color: '#a8442a', share: 0.03 },
];
export const GREYS: readonly string[] = ['#8e8a86', '#a8a49e', '#c4c0b8', '#dad6ce', '#6e6862'];
export const DYED: readonly string[] = ['#5a3a7a', '#2f5d8a', '#c2577a', '#3a7a5a', '#d06a2a'];
const TOPS = ['#f2f2ee', '#1b1b1d', '#d9452f', '#2f3d58', '#3b6b4f', '#e2c06b', '#8fb4d8', '#c96f7a', '#6b3a5a', '#7a8b5a', '#c9a35a', '#e86f2c', '#4a8fc2', '#f0d9e0', '#9a9a9a', '#5b2a2a', '#2d6e6e', '#f4e04d'];
const BOTTOMS = ['#2f3d58', '#1d2433', '#1b1b1d', '#4a4f57', '#8a7a5a', '#5a5f3a', '#4a3b2c', '#6a7f9a', '#d8d2c2', '#7a2a2a'];
const SHOES = ['#f2f2f2', '#1b1b1b', '#3b2a20', '#5a4632', '#8a8f96', '#c24a3a', '#2f4f8f'];
const pickW = <T>(r: () => number, items: readonly T[], w: (t: T) => number): T => { const tot = items.reduce((a, x) => a + w(x), 0); let x = r() * tot; for (const it of items) { x -= w(it); if (x <= 0) return it; } return items[items.length - 1]!; };
const pick = <T>(r: () => number, items: readonly T[]): T => items[Math.floor(r() * items.length)]!;
const rng = (r: () => number, a: number, b: number) => a + (b - a) * r();
/** a number from a seed of any kind */
export function seedOf(s: number | string): number { if (typeof s === 'number') return s >>> 0 || 1; let h = 2166136261; for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619); return h >>> 0 || 1; }

const HAIR_BY_AGE: Partial<Record<Age, Record<'fem' | 'masc', string[]>>> = {
  child: { masc: ['short', 'crew', 'buzz', 'curls', 'spiky', 'afro'], fem: ['ponytail', 'bob', 'long', 'pixie', 'curly-long', 'bun', 'afro', 'shoulder'] },
  elder: { masc: ['receding', 'receding', 'short', 'crew', 'side-part', 'buzz'], fem: ['bob', 'bun', 'short', 'pixie', 'curls', 'shoulder'] },
};
/** a person from a seed (and what you fix of them) */
export function person(seed: number | string, o: PersonOptions = {}): Person {
  const s = seedOf(seed), r = seeded(s);
  const age: Age = o.age ?? pickW(r, ['child', 'teen', 'adult', 'elder'] as Age[], (a) => ({ child: 0.14, teen: 0.12, adult: 0.56, elder: 0.18 })[a]);
  const fem = (o.presentation ?? (r() < 0.5 ? 'fem' : 'masc')) === 'fem';
  // the body: its age, then its build
  const b: Record<string, number> = {};
  if (age === 'child') { b.age_child = 1; if (fem) b.gender_female = rng(r, 0.3, 0.5); }
  else if (age === 'teen') { b.age_teen = 1; b.gender_female = fem ? rng(r, 0.6, 0.9) : rng(r, 0, 0.1); if (r() < 0.4) b.weight_thin = rng(r, 0.2, 0.6); }
  else {
    b.gender_female = fem ? rng(r, 0.85, 1) : rng(r, 0, 0.1);
    if (age === 'elder') b.age_elder = rng(r, 0.6, 1);
    const build = r();
    if (build < 0.28) b.weight_heavy = rng(r, 0.2, 0.85); else if (build < 0.48) b.weight_thin = rng(r, 0.2, 0.6);
    if (!fem && r() < 0.25) b.muscular = rng(r, 0.2, 0.6);
    if (!fem && r() < 0.3) b.shoulders_wide = rng(r, 0.2, 0.6);
    if (fem) { b.bust = rng(r, 0, 0.5); b.hips_wide = rng(r, 0, 0.6); if (r() < 0.4) b.waist_narrow = rng(r, 0.1, 0.5); }
  }
  const h = r(); if (h < 0.3) b.tall = rng(r, 0.1, 0.9); else if (h < 0.6) b.short = rng(r, 0.1, 0.9);
  if (r() < 0.5) b.face_round = rng(r, 0, 0.6);
  if (!fem && r() < 0.4) b.jaw_sharp = rng(r, 0.1, 0.6);
  if (r() < 0.3) b.chin_long = rng(r, 0, 0.5);
  if (r() < 0.4) b.nose_size = rng(r, 0, 0.4);
  if (r() < 0.4) b.nose_wide = rng(r, 0, 0.6);
  if (r() < 0.5) b[r() < 0.5 ? 'nose_bridge' : 'nose_flat'] = rng(r, 0.1, 0.7);
  if (r() < 0.25) b.ears_out = rng(r, 0.1, 0.5);
  Object.assign(b, o.body);
  // hair: a style that suits (by age, then by presentation), its colour (greys with age)
  const pres = fem ? 'fem' : 'masc';
  let hair: string | null = o.hair !== undefined ? o.hair : HAIR_BY_AGE[age] ? pick(r, HAIR_BY_AGE[age]![pres]) : pickW(r, Object.keys(HAIR_STYLES), (k) => HAIR_STYLES[k]!.suits[pres]);
  if (o.hair === undefined && !fem && (age === 'elder' ? r() < 0.18 : age === 'adult' && r() < 0.05)) hair = null;
  const skin = o.skin ?? pick(r, SKIN_TONES), dark = SKIN_TONES.indexOf(skin) / (SKIN_TONES.length - 1);
  const hairColor = o.hairColor ?? (age === 'elder' && r() < 0.8 ? pick(r, GREYS) : (age === 'teen' || age === 'adult') && r() < 0.05 ? pick(r, DYED) : pickW(r, HAIR_COLORS, (c) => c.share * (HAIR_COLORS.indexOf(c) < 3 ? 1 + dark * 2 : 1 - dark * 0.8)).color);
  // the face: the eyes' shape, an iris (lighter skin, more light eyes), lashes and brows, a mood
  const face: Face = {
    ...FACE_DEFAULTS, eyeSize: age === 'child' ? rng(r, 0.55, 0.8) : rng(r, 0.3, 0.6), eyeOpen: rng(r, 0.35, 0.7), eyeGap: rng(r, 0.4, 0.6), eyeTilt: rng(r, 0.35, 0.6),
    lash: fem ? rng(r, 0.5, 0.85) : rng(r, 0.1, 0.35), brow: fem ? rng(r, 0.3, 0.6) : rng(r, 0.5, 0.9), browY: rng(r, 0.4, 0.6), mouth: rng(r, 0.3, 0.6),
    smile: rng(r, 0.45, 0.75), blush: fem ? rng(r, 0.1, 0.4) : rng(r, 0, 0.1), iris: pickW(r, IRIS, (c) => c.share * (IRIS.indexOf(c) < 4 ? 1 : Math.max(0.05, 1.6 - dark * 2))).color,
  };
  const mood = o.emotion ?? pickW(r, ['neutral', 'calm', 'happy', 'tired', 'worried'], (e) => ({ neutral: 4, calm: 3, happy: 2, tired: 0.6, worried: 0.4 })[e] ?? 1);
  const shown = express(face, mood, mood === 'neutral' ? 0 : rng(r, 0.4, 0.8));
  // the outfit: colours, sleeves and legs (paint), a few garments (shape)
  const garments: Garment[] = [];
  if (o.garments !== false) {
    const g = r();
    if (fem && age !== 'child' && g < 0.18) garments.push({ type: 'dress', params: { length: pick(r, ['knee', 'midi', 'ankle']), sleeve: pick(r, ['short', 'elbow', 'long']) } });
    else if (fem && g < 0.32) garments.push({ type: 'skirt', params: { length: pick(r, ['knee', 'midi']) } });
    else if (age === 'adult' && g < 0.36) garments.push({ type: 'sarong' });
    else if (!fem && age !== 'child' && g < 0.48) garments.push({ type: 'jacket' });
    else if (age !== 'child' && g < 0.58) garments.push({ type: 'shirt', params: { sleeve: pick(r, ['short', 'long']), collar: 'yes' } });
  }
  const outfit: Outfit = {
    top: pick(r, TOPS), sleeves: pickW(r, ['short', 'long', 'none', 'elbow'] as const, (x) => ({ short: 5, long: 3, none: 1, elbow: 1 })[x]),
    bottom: pick(r, BOTTOMS), legs: pickW(r, ['long', 'knee', 'short'] as const, (x) => ({ long: age === 'child' ? 3 : 6, knee: 2, short: age === 'child' ? 4 : 2 })[x]),
    shoes: pick(r, SHOES), garments, ...o.outfit,
  };
  const gait = o.gait ?? (age === 'child' ? 'child' : age === 'teen' ? 'teen' : age === 'elder' ? 'elderly' : pickW(r, ['adult', 'brisk', 'relaxed', 'stroll'], (x) => ({ adult: 4, brisk: 2, relaxed: 2, stroll: 1 })[x] ?? 1));
  const speed = { child: rng(r, 1.0, 1.3), teen: rng(r, 1.25, 1.55), adult: rng(r, 1.15, 1.5), elder: rng(r, 0.75, 1.05) }[age] * (gait === 'brisk' ? 1.1 : gait === 'stroll' ? 0.85 : 1);
  return { id: typeof seed === 'string' ? seed : `person-${s}`, seed: s, age, presentation: pres, figure: { body: b, hair, garments: outfit.garments, gait }, skin, hairColor, face: shown, outfit, speed, scale: rng(r, 0.97, 1.03) };
}
/** another copy of a person's figure: the same body, hair style, garments and gait; their own skin, hair colour,
 *  face, colours, height and pace */
export function restyle(p: Person, seed: number | string): Person {
  const q = person(seed, { age: p.age, presentation: p.presentation, hair: p.figure.hair ?? null, gait: typeof p.figure.gait === 'string' ? p.figure.gait : undefined, garments: false });
  return { ...q, id: typeof seed === 'string' ? seed : q.id, figure: p.figure, outfit: { ...q.outfit, garments: p.figure.garments } };
}
/** a person's 8 palette colours (an entity's `palette`) and face numbers (its `decal`) */
/** how a person's colours are drawn: as they are, in greys (each colour's lightness kept), or your own mapping */
export type Tone = 'colour' | 'grey' | ((color: string) => string);
const grey = (c: string) => { const n = parseInt(c.slice(1), 16), l = Math.round(0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255)), h = l.toString(16).padStart(2, '0'); return `#${h}${h}${h}`; };
/** a colour in a tone */
export const toned = (c: string, tone: Tone = 'colour'): string => (tone === 'colour' ? c : tone === 'grey' ? grey(c) : tone(c));
export const paletteOf = (p: Person, tone: Tone = 'colour'): string[] => palette(p.outfit, p.skin, p.hairColor).map((c) => toned(c, tone));
export const decalOf = (p: Person): [number, number, number] => packFace(p.face);

/** a lineup of people to start from: one of each age, both presentations, light to deep skin */
export const PEOPLE: Readonly<Record<string, Person>> = Object.fromEntries(([
  ['office-worker', { age: 'adult', presentation: 'fem', skin: SKIN_TONES[9], hair: 'bob', outfit: { top: '#8fb4d8', bottom: '#2f3d58', shoes: '#1b1b1b', garments: [{ type: 'shirt', params: { sleeve: 'long', collar: 'yes' } }] }, gait: 'brisk' }],
  ['student', { age: 'teen', presentation: 'masc', skin: SKIN_TONES[4], hair: 'spiky', outfit: { top: '#f4f4f0', sleeves: 'short', bottom: '#6b6f75', legs: 'long', garments: [] }, gait: 'teen' }],
  ['grandmother', { age: 'elder', presentation: 'fem', skin: SKIN_TONES[2], hair: 'bun', hairColor: GREYS[3], outfit: { top: '#6b3a5a', garments: [{ type: 'dress', params: { length: 'ankle', sleeve: 'long' } }] }, gait: 'elderly' }],
  ['grandfather', { age: 'elder', presentation: 'masc', skin: SKIN_TONES[11], hair: 'receding', hairColor: GREYS[2], outfit: { top: '#c9a35a', sleeves: 'long', bottom: '#4a3b2c', garments: [] }, gait: 'elderly' }],
  ['girl', { age: 'child', presentation: 'fem', skin: SKIN_TONES[7], hair: 'ponytail', outfit: { top: '#f4e04d', bottom: '#4a8fc2', legs: 'knee', garments: [{ type: 'skirt', params: { length: 'knee' } }] }, gait: 'child' }],
  ['boy', { age: 'child', presentation: 'masc', skin: SKIN_TONES[12], hair: 'afro', outfit: { top: '#d9452f', bottom: '#1f2a44', legs: 'short', garments: [] }, gait: 'child' }],
  ['runner', { age: 'adult', presentation: 'masc', skin: SKIN_TONES[6], hair: 'buzz', outfit: { top: '#e86f2c', sleeves: 'none', bottom: '#1b1b1d', legs: 'short', shoes: '#f2f2f2', garments: [] }, gait: 'brisk', body: { muscular: 0.4, weight_thin: 0.3 } }],
  ['market-seller', { age: 'adult', presentation: 'fem', skin: SKIN_TONES[8], hair: 'long', outfit: { top: '#7a8b5a', bottom: '#5b3a2a', garments: [{ type: 'sarong' }] }, gait: 'relaxed', body: { weight_heavy: 0.4 } }],
  ['teen-girl', { age: 'teen', presentation: 'fem', skin: SKIN_TONES[1], hair: 'long-straight', hairColor: '#b98c52', outfit: { top: '#c96f7a', sleeves: 'short', bottom: '#2f3d58', legs: 'long', garments: [] }, gait: 'teen' }],
  ['big-man', { age: 'adult', presentation: 'masc', skin: SKIN_TONES[3], hair: 'short', outfit: { top: '#2b3a2f', bottom: '#1d2433', garments: [{ type: 'jacket' }] }, gait: 'adult', body: { weight_heavy: 0.8, tall: 0.5 } }],
  ['tall-woman', { age: 'adult', presentation: 'fem', skin: SKIN_TONES[10], hair: 'curly-long', outfit: { top: '#3b5b4f', garments: [{ type: 'dress', params: { length: 'midi', sleeve: 'short' } }] }, gait: 'stroll', body: { tall: 0.9, weight_thin: 0.3 } }],
  ['father', { age: 'adult', presentation: 'masc', skin: SKIN_TONES[0], hair: 'side-part', hairColor: '#6b4a2e', outfit: { top: '#4a8fc2', sleeves: 'short', bottom: '#d8d2c2', legs: 'knee', garments: [] }, gait: 'relaxed' }],
] as [string, PersonOptions][]).map(([id, o], i) => [id, { ...person(`${id}-${i}`, o), id }]));

/** the far form of a person (a few dozen triangles in a stride: 0 … 1), coloured by the instance (their top) */
export const farPerson = shape({
  id: 'humans.far',
  params: { stride: num(0, 1, 0.5) },
  budget: { whole: 160 },
  build: (b, p) => {
    const sw = (p.stride * 2 - 1) * 0.6, limb = (x: number, top: number, len: number, a: number, r: number, col: string) => b.frame({ at: [x, top, 0] }, (b) => b.within([1, 0, 0, 0, Math.cos(a), Math.sin(a), 0, -Math.sin(a), Math.cos(a), 0, 0, 0], () => b.solid('capsule', { radius: r, size: len, at: [0, -len / 2, 0], color: col, sides: 5 })));
    b.solid('capsule', { radius: 0.17, size: 0.6, at: [0, 1.17, 0], color: '#ffffff', sides: 6 });
    b.solid('sphere', { radius: 0.11, at: [0, 1.6, 0], color: '#c8b6a6', sides: 6 });
    limb(-0.09, 0.9, 0.88, sw, 0.07, '#5a5a5a'); limb(0.09, 0.9, 0.88, -sw, 0.07, '#5a5a5a');
    limb(-0.24, 1.4, 0.6, -sw * 0.8, 0.045, '#e8e8e8'); limb(0.24, 1.4, 0.6, sw * 0.8, 0.045, '#e8e8e8');
  },
});
const FAR: Made[] = [];
/** the far form at a gait's phase */
export const farAt = (phase: number): Made => { if (!FAR.length) for (const s of [0, 0.5, 1]) FAR.push(farPerson.make({ stride: s })); return FAR[Math.round((Math.sin(phase) * 0.5 + 0.5) * 2)]!; };

/** a person as an entity: their figure drawn near (when it is made), their far form beyond */
export function personEntity(p: Person, fig: HumanFigure | (() => HumanFigure | null) | null, o: { id?: string; at: [number, number] | [number, number, number]; heading?: number; tone?: Tone } & Partial<Pick<Parameters<typeof entity>[0], 'locomotion' | 'drive' | 'motion'>>): Entity {
  return entity({
    id: o.id ?? p.id, kind: 'person', at: o.at, heading: o.heading, data: { person: p.id, age: p.age },
    shape: (e) => farAt(e.gait), color: toned(p.outfit.top, o.tone),
    body: typeof fig === 'function' ? () => fig() : fig ?? undefined, palette: paletteOf(p, o.tone), decal: decalOf(p), scale: p.scale,
    locomotion: o.locomotion, drive: o.drive, motion: o.motion,
  });
}

export interface CrowdOptions {
  /** the humans template (a pack's template.json): given, or loaded when the crowd first starts */
  template: Template | (() => Promise<Template>);
  /** the walking network to walk (a function: it may come later, or be rebuilt as the view moves) */
  network: () => Network<unknown> | null;
  /** the place people stay round (the view's centre) */
  around: () => [number, number];
  /** people (default 24) and distinct figures among them (default 8) */
  count?: number; figures?: number;
  /** metres round the place they walk (default 220) */
  radius?: number;
  seed?: number;
  /** your own people (the figures: the first `figures` of them; the rest restyle those) */
  people?: (i: number) => Person;
  /** what every drawn person shares (an age, a presentation…) */
  person?: PersonOptions;
  /** how they are coloured (default 'colour'; 'grey': greys only) */
  tone?: Tone;
  /** the skinned bodies' budget and size on screen */
  bodies?: BodiesOptions;
  id?: string;
  /** when the crowd is shown (core › world: when) */
  when?: EntityElementProps['when'];
  /** the time a frame may spend making figures, ms (default 6: one a frame at least) */
  buildMs?: number;
}
export interface Crowd {
  readonly element: EntityElement;
  readonly people: Entity[];
  readonly persons: Person[];
  /** place them (once the network is there): resolves when every figure is made */
  start(): Promise<void>;
  /** take them away */
  clear(): void;
  /** figures made / wanted, triangles each */
  figures(): { made: number; wanted: number; triangles: number[] };
}
/** the ages of a crowd's figures in turn: mostly adults, then elders, children and teens */
const CROWD_AGES: readonly Age[] = ['adult', 'adult', 'elder', 'child', 'adult', 'teen', 'adult', 'elder', 'child', 'teen'];
/** people walking a walking network round a place: a few figures shared, everyone their own colours, face, height,
 *  pace and route */
export function crowd(w: World, o: CrowdOptions): Crowd {
  const N = o.count ?? 24, K = Math.max(1, Math.min(o.figures ?? 8, N)), seed = o.seed ?? 1, R = o.radius ?? 220;
  // (it is not settled while the people placed wait for their figures)
  const layer = entityElement({ id: o.id ?? 'crowd', bodies: { budget: 24, pixels: 28, ...o.bodies }, when: o.when, pending: () => (people.length && figs.size < new Set(keyOf).size ? [`${figs.size} of ${new Set(keyOf).size} figures made`] : []) });
  // the figures cover the ages and both presentations by design (a few figures drawn at random could all be adults)
  const base = Array.from({ length: K }, (_, i) => o.people?.(i) ?? person(seed * 7919 + i, { age: CROWD_AGES[i % CROWD_AGES.length], presentation: i % 2 ? 'masc' : 'fem', ...o.person }));
  const persons = Array.from({ length: N }, (_, i) => (i < K ? base[i]! : o.people ? o.people(i) : restyle(base[i % K]!, seed * 7919 + 100000 + i)));
  const figs = new Map<string, HumanFigure>(), keyOf = persons.map((p) => figureKey(p.figure));
  const people: Entity[] = [];
  let tpl: Template | null = typeof o.template === 'function' ? null : o.template, started: Promise<void> | null = null, stop: (() => void) | null = null;
  // a place on the network round the centre: a random point within the radius, joined to the network's nearest
  const spot = (net: Network<unknown>, r: () => number): [number, number] | null => {
    const c = net.local(o.around());
    for (let t = 0; t < 30; t++) { const a = r() * Math.PI * 2, d = Math.sqrt(r()) * R, n = net.nearest(net.lonLat(c[0] + Math.cos(a) * d, c[1] + Math.sin(a) * d), { max: R * 0.5 }); if (n) return n.at; }
    return null;
  };
  const place = () => {
    const net = o.network(); if (!net || people.length) return !!people.length;
    const r = seeded(seed * 31 + 7);
    persons.forEach((p, i) => {
      const at = spot(net, r); if (!at) return;
      const e = personEntity(p, () => figs.get(keyOf[i]!) ?? null, { id: `${layer.id}-${i}`, at, heading: r() * 360, tone: o.tone, ...walking({ network: o.network, seed: seed * 1000 + i, speed: p.speed, near: o.around, radius: R }) });
      people.push(e); layer.add(e);
    });
    return !!people.length;
  };
  return {
    element: layer, people, persons,
    start() {
      return (started ??= (async () => {
        tpl ??= await (o.template as () => Promise<Template>)();
        // made a few a frame (the frame keeps its pace); everyone walks in their far form meanwhile
        const todo = persons.map((p, i) => ({ p, k: keyOf[i]! })).filter((x, i, a) => a.findIndex((y) => y.k === x.k) === i);
        await new Promise<void>((done) => {
          let respawnAt = 0;
          stop = w.on('frame', () => {
            if (!place()) return;
            const t0 = performance.now();
            // at least one a frame, more while the frame's time allows
            do { const x = todo.shift(); if (!x) break; if (!figs.has(x.k)) figs.set(x.k, humanFigure(tpl!, x.p.figure, { id: x.k })); w.invalidate(); } while (todo.length && performance.now() - t0 < (o.buildMs ?? 6));
            // those who wandered far (the view moved) come back round the place
            if (performance.now() > respawnAt) {
              respawnAt = performance.now() + 1000;
              const net = o.network(); if (net) { const c = net.local(o.around()), r = seeded(Math.floor(performance.now())); for (const e of people) { const p = net.local([e.at[0], e.at[1]]); if (Math.hypot(p[0] - c[0], p[1] - c[1]) > R * 1.6) { const at = spot(net, r); if (at) { e.at = [at[0], at[1], NaN]; (e.locomotion as unknown as { reset?: (e: Entity) => void }).reset?.(e); } } } }
            }
            if (!todo.length) done();
          });
          w.invalidate();
        });
      })());
    },
    clear() { stop?.(); stop = null; started = null; for (const e of people) layer.remove(e.id); people.length = 0; w.invalidate(); },
    figures: () => ({ made: figs.size, wanted: new Set(keyOf).size, triangles: [...figs.values()].map((f) => f.triangles) }),
  };
}
