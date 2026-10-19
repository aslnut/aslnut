// What can be asked: categories (the dialog's tabs) and questions. A question is one measure per council or suburb,
// made with aslnut's stats kit (count, sum or an area's own number), with the normalisations that make sense for it
// and the open datasets it is built from.
import type { Source, StatsOptions } from '../../src/index.ts';

export type Geography = 'council' | 'suburb';
export type Normalise = 'none' | 'share' | 'per-km2' | 'per-1000' | 'm2-per-resident';
export interface SourceRef { title: string; url: string; licence: string }
export interface Category { id: string; title: string; ready: boolean; note?: string }
export interface Question {
  id: string; category: string; title: string; description: string; unit: string;
  geographies: Geography[]; normalise: Normalise[]; sources: SourceRef[];
  /** red means worse */
  highIsBad?: boolean;
  /** the stats kit's measure (the areas and the normalisation are added) */
  measure: (inputs: { openSpace: Source }) => Partial<StatsOptions>;
}

export const SOURCES = {
  councils: { title: 'Vicmap Admin: LGA polygons', url: 'https://discover.data.vic.gov.au/dataset/vicmap-admin', licence: 'CC BY 4.0 © State of Victoria' },
  suburbs: { title: 'Vicmap Admin: locality (suburb) polygons', url: 'https://discover.data.vic.gov.au/dataset/vicmap-admin', licence: 'CC BY 4.0 © State of Victoria' },
  openSpace: { title: 'VEAC Metropolitan Melbourne open space', url: 'https://discover.data.vic.gov.au/dataset/open-space', licence: 'CC BY 4.0 © VEAC / State of Victoria' },
  census: { title: 'ABS Census 2021, G01 persons (LGA, SAL)', url: 'https://data.api.abs.gov.au/rest/dataflow/ABS/C21_G01_LGA', licence: 'CC BY 4.0 © Australian Bureau of Statistics' },
  bike: { title: 'Bicycle infrastructure network (DTP)', url: 'https://opendata.transport.vic.gov.au/dataset/bicycle-infrastructure-network', licence: 'CC BY 4.0 © State of Victoria' },
  heatMock: { title: 'mock values (seeded, not measured): the urban heat 2018 set is an order-only download', url: 'https://discover.data.vic.gov.au/dataset/metropolitan-melbourne-urban-heat-islands-and-urban-vegetation-2018', licence: '—' },
} satisfies Record<string, SourceRef>;
const AREAS = [SOURCES.councils, SOURCES.suburbs];

export const CATEGORIES: Category[] = [
  { id: 'open-space', title: 'Open space & parks', ready: true },
  { id: 'cycling', title: 'Cycling', ready: true },
  { id: 'population', title: 'Population', ready: true },
  { id: 'heat', title: 'Heat & vegetation', ready: true },
  { id: 'walkability', title: 'Walkability', ready: false, note: 'Park access along the street network: at the street level, Layers › park access (Clayton area).' },
  { id: 'safety', title: 'Safety', ready: false, note: 'Crash data is open; not joined to areas yet.' },
];

const BOTH: Geography[] = ['council', 'suburb'];
const AREA_NORMS: Normalise[] = ['share', 'm2-per-resident', 'per-1000', 'per-km2', 'none'];
const PARKS = { group: 'Parkland and garden' }, SPORT = { group: 'Organised recreation area' };

export const QUESTIONS: Question[] = [
  { id: 'park-area', category: 'open-space', title: 'Park area', description: 'Hectares of open space classed as parkland and gardens, counted where each parcel lies.', unit: 'ha', geographies: BOTH, normalise: AREA_NORMS, sources: [SOURCES.openSpace, ...AREAS, SOURCES.census],
    measure: ({ openSpace }) => ({ of: openSpace, filter: PARKS, sum: 'ha' }) },
  { id: 'open-space-ha', category: 'open-space', title: 'All open space', description: 'Every kind of open space: parks, natural areas, sportsfields, reserves, corridors, civic squares.', unit: 'ha', geographies: BOTH, normalise: AREA_NORMS, sources: [SOURCES.openSpace, ...AREAS, SOURCES.census],
    measure: ({ openSpace }) => ({ of: openSpace, sum: 'ha' }) },
  { id: 'parks', category: 'open-space', title: 'Number of parks', description: 'Open-space parcels classed as parkland and gardens.', unit: 'parks', geographies: BOTH, normalise: ['per-1000', 'per-km2', 'none'], sources: [SOURCES.openSpace, ...AREAS, SOURCES.census],
    measure: ({ openSpace }) => ({ of: openSpace, filter: PARKS, count: true }) },
  { id: 'sportsfields', category: 'open-space', title: 'Sportsfields', description: 'Organised recreation areas: ovals, courts, pitches.', unit: 'sites', geographies: BOTH, normalise: ['per-1000', 'per-km2', 'none'], sources: [SOURCES.openSpace, ...AREAS, SOURCES.census],
    measure: ({ openSpace }) => ({ of: openSpace, filter: SPORT, count: true }) },
  { id: 'bike-km', category: 'cycling', title: 'Bicycle infrastructure', description: 'Length of mapped bicycle infrastructure (lanes, paths, shared paths) inside the area.', unit: 'km', geographies: BOTH, normalise: ['per-km2', 'per-1000', 'none'], sources: [SOURCES.bike, ...AREAS, SOURCES.census],
    measure: () => ({ value: 'bike_km' }) },
  { id: 'population', category: 'population', title: 'Residents', description: 'Usual residents, Census 2021.', unit: 'people', geographies: BOTH, normalise: ['per-km2', 'none'], sources: [SOURCES.census, ...AREAS],
    measure: () => ({ value: 'pop' }) },
  { id: 'uhi', category: 'heat', title: 'Urban heat island', description: 'How much hotter the land surface is than a non-urban baseline on a hot summer day (°C). Mock values in this example.', unit: '°C', geographies: BOTH, normalise: ['none'], sources: [SOURCES.heatMock], highIsBad: true,
    measure: () => ({ value: 'uhi' }) },
  { id: 'tree-cover', category: 'heat', title: 'Tree canopy cover', description: 'Share of the area under tree canopy (3 m and taller). Mock values in this example.', unit: '% of area', geographies: BOTH, normalise: ['none'], sources: [SOURCES.heatMock],
    measure: () => ({ value: 'tree_pct' }) },
  { id: 'grass-cover', category: 'heat', title: 'Grass cover', description: 'Share of the area that is grass. Mock values in this example.', unit: '% of area', geographies: BOTH, normalise: ['none'], sources: [SOURCES.heatMock],
    measure: () => ({ value: 'grass_pct' }) },
];

/** the stats kit's normalisation for a question's unit */
export function normaliseOptions(q: Question, n: Normalise): Partial<StatsOptions> {
  const ha = q.unit === 'ha';
  switch (n) {
    case 'share': return { per: 'km2', scale: 1 };                     // ha per km² is a share in %
    case 'per-km2': return { per: 'km2', scale: 1 };
    case 'per-1000': return { per: 'pop', scale: 1000 };
    case 'm2-per-resident': return { per: 'pop', scale: ha ? 10000 : 1 };
    default: return { per: 'none', scale: 1 };
  }
}
export function unitOf(q: Question, n: Normalise): string {
  switch (n) {
    case 'share': return '% of land';
    case 'm2-per-resident': return 'm² per resident';
    case 'per-km2': return `${q.unit} per km²`;
    case 'per-1000': return `${q.unit} per 1,000 residents`;
    default: return q.unit;
  }
}
export const NORMALISE_LABEL: Record<Normalise, string> = { none: 'total', share: 'share of land (%)', 'per-km2': 'per km²', 'per-1000': 'per 1,000 residents', 'm2-per-resident': 'm² per resident' };
export const CLASS_METHODS = [['jenks', 'Natural breaks (Jenks)'], ['quantile', 'Quantile (equal count)'], ['quantize', 'Equal interval'], ['pretty', 'Pretty breaks']] as const;
export const RAMPS = [['rdylgn', 'Red → Yellow → Green'], ['greens', 'Greens'], ['blues', 'Blues'], ['reds', 'Reds'], ['ylorrd', 'Yellow → Red'], ['viridis', 'Viridis'], ['spectral', 'Spectral']] as const;
export function formatStat(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '–';
  const a = Math.abs(v), digits = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  return v.toLocaleString('en-AU', { maximumFractionDigits: digits });
}
