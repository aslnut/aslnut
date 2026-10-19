// modules › world › earth › air › sky › stars: the night sky from a star catalogue. Each star at its place (its right
// ascension and declination, turned into the sky over the view by the sidereal time and the place's latitude), as
// bright as its magnitude, coloured by its colour index; down to a faintest magnitude. The default catalogue is
// Hipparcos (ESA 1997) as the CDS VizieR service serves it, asked for only the stars wanted; a list you host (the same
// columns: tools/stars-pack.mjs makes one) works offline; your own loader gives any other.
//   sky({ stars: { magnitude: 5 } }) · sky().stars({ catalogue: catalogues.hipparcos({ url: '/packs/sky/hipparcos.tsv' }) })
import type { Loader } from '../../../../../core/data/loading/loader.ts';
import { AslnutError } from '../../../../../core/world/errors.ts';

/** a star: right ascension and declination (degrees, J2000), visual magnitude, colour index B−V */
export interface Star { ra: number; dec: number; mag: number; bv?: number }
/** a catalogue of stars: its name, its credit, and how it loads the stars down to a magnitude */
export interface Catalogue { readonly id: string; readonly attribution: string; load(o: { magnitude: number; loader: Loader | null }): Promise<Star[]> }
const VIZIER = 'https://vizier.cds.unistra.fr/viz-bin/asu-tsv';
/** stars from tab-separated text: columns ra, dec (degrees), magnitude and B−V, the first four numbers of each row
 *  (VizieR's asu-tsv as is: its comments and headers skipped) */
export function parseStars(text: string): Star[] {
  const out: Star[] = [];
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const c = line.split('\t'); if (c.length < 3) continue;
    const ra = Number(c[0]), dec = Number(c[1]), mag = Number(c[2]), bv = c[3] !== undefined && c[3].trim() !== '' ? Number(c[3]) : NaN;
    if (!c[0]!.trim() || !c[2]!.trim() || !Number.isFinite(ra) || !Number.isFinite(dec) || !Number.isFinite(mag)) continue;
    out.push({ ra, dec, mag, bv: Number.isFinite(bv) ? bv : undefined });
  }
  return out;
}
export const catalogues = {
  /** Hipparcos (ESA 1997): from CDS VizieR (only the stars to the magnitude asked), or a list you host (`url`: the same
   *  tab-separated columns: ra, dec, magnitude, B−V) */
  hipparcos(o: { url?: string } = {}): Catalogue {
    return {
      id: 'hipparcos', attribution: 'Stars: Hipparcos (ESA 1997), CDS VizieR',
      async load({ magnitude, loader }) {
        const url = o.url ?? `${VIZIER}?-source=I/239/hip_main&-out=RAICRS&-out=DEICRS&-out=Vmag&-out=B-V&Vmag=%3C${magnitude.toFixed(1)}&-out.max=60000`;
        const text = loader ? await loader.get<string>(url, { kind: 'text', priority: 'later' }) : await (await fetch(url)).text();
        if (typeof text !== 'string') throw new AslnutError('E-DATA-002', `stars: ${url} gave nothing`, { where: 'sky.stars', fix: 'check the url (or the network): catalogues.hipparcos({ url })' });
        return parseStars(text).filter((s) => s.mag <= magnitude);
      },
    };
  },
  /** your own stars (a list, or a function that loads them) */
  custom(o: { id?: string; attribution?: string; load: (magnitude: number) => Promise<Star[]> | Star[] }): Catalogue {
    return { id: o.id ?? 'custom', attribution: o.attribution ?? '', load: async ({ magnitude }) => (await o.load(magnitude)).filter((s) => s.mag <= magnitude) };
  },
};
/** floats per star for the stars' program: its equatorial direction (x, y, z), magnitude · B−V, 0, 0, 0 */
export const STAR_FLOATS = 8;
const D = Math.PI / 180;
/** the stars as numbers to draw (the brightest first) */
export function starData(stars: readonly Star[]): Float32Array {
  const s = [...stars].sort((a, b) => a.mag - b.mag), out = new Float32Array(s.length * STAR_FLOATS);
  s.forEach((x, i) => { const ra = x.ra * D, dec = x.dec * D; out.set([Math.cos(dec) * Math.cos(ra), Math.cos(dec) * Math.sin(ra), Math.sin(dec), x.mag, x.bv ?? 0.6, 0, 0, 0], i * STAR_FLOATS); });
  return out;
}
/** Greenwich mean sidereal time, radians, at an instant */
export function gmst(t: Date | number): number {
  const jd = (typeof t === 'number' ? t : t.getTime()) / 86400000 + 2440587.5, g = (280.46061837 + 360.98564736629 * (jd - 2451545.0)) % 360;
  return ((g + 360) % 360) * D;
}
/** the turn from the equatorial frame (J2000; precession left out) into the sky over a place (x east, y up, z south)
 *  at an instant: three rows */
export function skyTurn(t: Date | number, lon: number, lat: number): [number[], number[], number[]] {
  const lst = gmst(t) + lon * D, c = Math.cos(lst), s = Math.sin(lst), cp = Math.cos(lat * D), sp = Math.sin(lat * D);
  // into the meridian frame (x: the meridian on the equator, y: east, z: the pole: turned back by the sidereal time),
  // then the horizon's axes: east = y, up = cos φ x + sin φ z, south = sin φ x − cos φ z
  const X = [c, s, 0], Y = [-s, c, 0], Z = [0, 0, 1];
  const east = Y, up = X.map((v, k) => cp * v + sp * Z[k]!), south = X.map((v, k) => sp * v - cp * Z[k]!);
  return [east, up, south];
}
