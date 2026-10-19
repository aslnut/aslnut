// modules › world › earth › air › weather: hourly weather for a place and a day from Open-Meteo (open data, no key, CORS):
// the archive (ERA5 reanalysis) for past days, the forecast for today and the days ahead. Air temperature, humidity,
// 10 m wind, cloud, direct and diffuse sun on a level surface (means over the hour before), rain.
//   const day = await openMeteo.day({ lat: -37.91, lon: 145.13, date: '2026-01-27', zone: 'Australia/Melbourne' })
import type { DayWeather, HourWeather } from '../../../../../core/simulation/phenomena/heat/model.ts';
import type { Loader } from '../../../../../core/data/loading/loader.ts';

const VARS = 'temperature_2m,relative_humidity_2m,wind_speed_10m,cloud_cover,direct_radiation,diffuse_radiation,precipitation';
export const openMeteo = {
  /** the weather now at a few places, as features for a sky's feed (see current) */
  current: (points: readonly [number, number][], o: { loader?: Loader } = {}) => current(points, o),
  /** the URL of a day's hours (archive for past days, forecast otherwise) */
  url(o: { lat: number; lon: number; date: string; zone?: string; today?: string }): { url: string; source: string } {
    const today = o.today ?? new Date().toISOString().slice(0, 10), past = o.date < today;
    const host = past ? 'https://archive-api.open-meteo.com/v1/archive' : 'https://api.open-meteo.com/v1/forecast';
    return { url: `${host}?latitude=${o.lat}&longitude=${o.lon}&start_date=${o.date}&end_date=${o.date}&hourly=${VARS}&wind_speed_unit=ms&timezone=${encodeURIComponent(o.zone ?? 'GMT')}`, source: past ? 'Open-Meteo Historical (ERA5)' : 'Open-Meteo Forecast' };
  },
  /** a day's 24 hours (through the world's loader when given: cached, replayable) */
  async day(o: { lat: number; lon: number; date: string; zone?: string; loader?: Loader }): Promise<DayWeather> {
    const { url, source } = openMeteo.url(o);
    const d = o.loader ? await o.loader.get<{ hourly: Record<string, (number | string | null)[]> }>(url, { kind: 'json', priority: 'now' }) : await (await fetch(url)).json();
    const h = d?.hourly; if (!h?.time) throw new Error(`no weather for ${o.date}`);
    const n = (k: string, i: number) => Number(h[k]?.[i] ?? 0);
    const hours: HourWeather[] = h.time.map((t: number | string | null, i: number) => ({ hour: Number(String(t).slice(11, 13)), ta: n('temperature_2m', i), rh: n('relative_humidity_2m', i), u10: n('wind_speed_10m', i), cloud: n('cloud_cover', i) / 100, dirH: n('direct_radiation', i), difH: n('diffuse_radiation', i), precip: n('precipitation', i) }));
    return { date: o.date, source, hours };
  },
};
/** the weather now at a few places (Open-Meteo's current conditions) as features for a sky's feed:
 *  { wind (m/s), rain (mm/h), visibility (m), cover (0..1) } at each point
 *    sky.feed({ data: await openMeteo.current(points, { loader }), wind: 'wind', rain: 'rain', visibility: 'visibility', cover: 'cover' }) */
export async function current(points: readonly [number, number][], o: { loader?: Loader } = {}): Promise<{ geometry: { type: 'Point'; coordinates: [number, number] }; props: Record<string, unknown> }[]> {
  const url = `https://api.open-meteo.com/v1/forecast?latitude=${points.map((p) => p[1].toFixed(4)).join(',')}&longitude=${points.map((p) => p[0].toFixed(4)).join(',')}&current=wind_speed_10m,precipitation,visibility,cloud_cover&wind_speed_unit=ms`;
  const d = o.loader ? await o.loader.get<unknown>(url, { kind: 'json', priority: 'now' }) : await (await fetch(url)).json();
  const list = (Array.isArray(d) ? d : [d]) as { current?: Record<string, number> }[];
  return list.map((x, i) => ({ geometry: { type: 'Point', coordinates: points[i]! }, props: { wind: x.current?.wind_speed_10m ?? null, rain: x.current?.precipitation ?? null, visibility: x.current?.visibility ?? null, cover: x.current?.cloud_cover !== undefined ? x.current.cloud_cover / 100 : null, source: 'Open-Meteo current' } }));
}
/** a hot afternoon (27 Jan 2026, 3 pm, Clayton, as measured): what a lab shows when the weather service cannot be reached */
export const HOT_HOUR: HourWeather = { hour: 15, ta: 41.3, rh: 15, u10: 4.9, cloud: 0, dirH: 866, difH: 111, precip: 0 };
