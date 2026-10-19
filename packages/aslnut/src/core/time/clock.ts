// core › time › clock: the world's clock as everything reads it (s.time): the time, the local solar hour and the
// season at the view's centre, the seconds it has run and its rate; and how it runs (real, fixed steps, manual).
//   world(canvas, { time: '2026-06-21T06:00+07:00', clock: 'manual' }) · w.step(1000) · when: s => s.time.hour > 18
import { localTime, type LocalTime } from './zones.ts';

/** 'real': the display's frames · { fps }: fixed steps, every frame drawn (captures) · 'manual': nothing runs by itself;
 *  each w.step(ms) advances the world by that much and draws one frame (same steps, same world) */
export type Clock = 'real' | { fps: number } | 'manual';
export interface TimeState {
  /** the world's time */
  now: Date;
  year: number; month: number; day: number;
  /** local solar hour at the view's centre, 0..24 (UTC + lon / 15) */
  hour: number;
  /** 'dry' | 'wet' in the tropics, else the meteorological season of the centre's hemisphere */
  season: 'spring' | 'summer' | 'autumn' | 'winter';
  /** seconds the world's clock has run (frames × step when capturing; never the wall clock in a capture) */
  t: number;
  /** how fast the world's time runs: seconds per second (1: real time; 0: it stands still; 600: a time-lapse) */
  rate: number;
  /** the time on the clocks where the view is: in the world's time zone (an IANA name), else solar time by longitude */
  local: LocalTime;
}

export function timeState(now: Date, lon: number, lat: number, t: number): TimeState {
  const utcH = now.getUTCHours() + now.getUTCMinutes() / 60 + now.getUTCSeconds() / 3600;
  const hour = (((utcH + lon / 15) % 24) + 24) % 24, m = now.getUTCMonth();
  const north = ['winter', 'winter', 'spring', 'spring', 'spring', 'summer', 'summer', 'summer', 'autumn', 'autumn', 'autumn', 'winter'] as const;
  const south = { winter: 'summer', summer: 'winter', spring: 'autumn', autumn: 'spring' } as const;
  const sn = north[m]!;
  return { now, year: now.getUTCFullYear(), month: m + 1, day: now.getUTCDate(), hour, season: lat >= 0 ? sn : south[sn], t, rate: 1, local: localTime(now, lon) };
}
