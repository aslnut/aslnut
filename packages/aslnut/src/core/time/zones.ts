// core › time › zones: the time on the clocks where the view is: in a time zone (an IANA name) or, without one, solar
// time by longitude. The zone may come from the place: 'auto' asks a lookup (default: the nearest of the zones'
// principal places, tzdata's table, loaded only then) for the place under the camera; your own lookup (a zone
// polygon service, a table of your region) gives it exactly.
//   localTime(new Date(), 144.96, 'Australia/Melbourne') → { hour, minute, weekday, zone, offset, … }
//   world(canvas, { timeZone: 'auto' }) · world(canvas, { timeZone: zoneLookups.nearest({ near: 400 }) })

export interface LocalTime { year: number; month: number; day: number; hour: number; minute: number; /** 0 Sunday … 6 Saturday */ weekday: number; /** the IANA zone, or 'solar' */ zone: string; /** minutes ahead of UTC */ offset: number }
/** a place's zone: an IANA name, or null (none known there: solar time) */
export type ZoneLookup = (lon: number, lat: number) => string | null | Promise<string | null>;
/** what a world's clocks keep: a zone (IANA name), 'auto' (the place's, by the nearest principal place) or your
 *  lookup of the place's zone; unset: solar time */
export type TimeZoneOption = string | 'auto' | ZoneLookup;
const fmts = new Map<string, Intl.DateTimeFormat>();
/** the wall-clock time of an instant in a zone (IANA name) or, without one, solar time at a longitude */
export function localTime(now: Date, lon: number, zone?: string | null): LocalTime {
  if (zone) {
    try {
      let f = fmts.get(zone);
      if (!f) { f = new Intl.DateTimeFormat('en-US', { timeZone: zone, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23' }); fmts.set(zone, f); }
      const p: Record<string, number> = {}; for (const x of f.formatToParts(now)) if (x.type !== 'literal') p[x.type] = Number(x.value);
      const asUtc = Date.UTC(p.year!, p.month! - 1, p.day!, p.hour!, p.minute!);
      return { year: p.year!, month: p.month!, day: p.day!, hour: p.hour!, minute: p.minute!, weekday: new Date(Date.UTC(p.year!, p.month! - 1, p.day!)).getUTCDay(), zone, offset: Math.round((asUtc - Math.floor(now.getTime() / 60000) * 60000) / 60000) };
    } catch { /* an unknown zone: solar time */ }
  }
  const off = Math.round(lon * 4), t = new Date(now.getTime() + off * 60000);
  return { year: t.getUTCFullYear(), month: t.getUTCMonth() + 1, day: t.getUTCDate(), hour: t.getUTCHours(), minute: t.getUTCMinutes(), weekday: t.getUTCDay(), zone: 'solar', offset: off };
}
/** the instant a wall-clock time ('2026-01-15T15:00') is in a zone (IANA name): the zone's offset that day */
export function zonedTime(wall: string, zone: string): Date {
  const guess = new Date(`${wall.length === 16 ? `${wall}:00` : wall}Z`);
  let t = guess.getTime();
  // twice: an offset read at the guess, then at the answer (a day the clocks change)
  for (let k = 0; k < 2; k++) { const l = localTime(new Date(t), 0, zone); t = guess.getTime() - l.offset * 60000; }
  return new Date(t);
}
let places: Promise<{ name: string; lon: number; lat: number; x: number; y: number; z: number }[]> | null = null;
const D = Math.PI / 180;
/** the zones' places (loaded once, on first use) as points on the unit sphere */
const loadPlaces = () => (places ??= import('./zone-places.ts').then(({ ZONE_PLACES }) => ZONE_PLACES.split('|').map((r) => {
  const [name, lo, la] = r.split(','), lon = Number(lo), lat = Number(la);
  return { name: name!, lon, lat, x: Math.cos(lat * D) * Math.cos(lon * D), y: Math.cos(lat * D) * Math.sin(lon * D), z: Math.sin(lat * D) };
})));
/** lookups of a place's zone */
export const zoneLookups = {
  /** the zone of the nearest principal place (tzdata's zone1970.tab: 312 zones, 9 kB, loaded on first use): right
   *  across most of a zone, wrong near some borders (a lookup of zone polygons is exact); farther than `near` km
   *  from any (the open sea): null, solar time */
  nearest(o: { near?: number } = {}): ZoneLookup {
    const near = o.near ?? 1500;
    return async (lon, lat) => {
      const ps = await loadPlaces(), x = Math.cos(lat * D) * Math.cos(lon * D), y = Math.cos(lat * D) * Math.sin(lon * D), z = Math.sin(lat * D);
      let best: string | null = null, bd = -2;
      for (const p of ps) { const d = p.x * x + p.y * y + p.z * z; if (d > bd) { bd = d; best = p.name; } }
      return Math.acos(Math.min(1, bd)) * 6371 <= near ? best : null;
    };
  },
  /** one zone everywhere (a lookup that always answers it) */
  fixed: (zone: string): ZoneLookup => () => zone,
};
/** a world's clocks' zone as the camera moves: asked again when the place has moved `every` km (default 25) */
export class ZoneTracker {
  zone: string | null = null; private at: [number, number] | null = null; private busy = false; private ask: ZoneLookup | null; private onChange: () => void; private every: number;
  constructor(o: TimeZoneOption | undefined, onChange: () => void, every = 25) {
    this.onChange = onChange; this.every = every;
    this.ask = typeof o === 'function' ? o : o === 'auto' ? zoneLookups.nearest() : null;
    if (typeof o === 'string' && o !== 'auto') this.zone = o;
  }
  /** the zone for the place (the last answer while a new one is asked) */
  zoneAt(lon: number, lat: number): string | null {
    if (!this.ask || this.busy) return this.zone;
    if (this.at && Math.hypot((lon - this.at[0]) * Math.cos(lat * D), lat - this.at[1]) * 111.2 < this.every) return this.zone;
    this.at = [lon, lat]; this.busy = true;
    void Promise.resolve().then(() => this.ask!(lon, lat)).then((z) => { this.busy = false; if (z !== this.zone) { this.zone = z; this.onChange(); } }, () => { this.busy = false; });
    return this.zone;
  }
}
