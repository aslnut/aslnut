// modules › presets › vehicles › car › hitch: a tractor's track with its trailer's angle. The trailer is a part on a
// hinge at the tractor's fifth wheel (kinematics.ts: `trailer`); what turns it is a value of the log that moves the set
// (core › entities › kinematics: a joint driven by a log value, read on the chip between samples as places are). The
// angle comes from the track itself: the trailer's axles are pulled along by the fifth wheel (a tractrix), so on a
// turn they keep inside the tractor's path (its off-tracking) and straighten behind it after. The track's corners are
// rounded first (no tighter than `radius`: a tractor turns, it does not pivot) and it is sampled where the tractor
// turns or its trailer's angle changes, so what the chip draws between two samples is what the trailer does. The math
// is the app's to choose (it may write its own angles); this is one to pick.
//   const rows = cars.hitch(track, cars.tractor.make())      // the track's rows, each with values.hitch (degrees)
//   const log = history.log({ keep: Infinity, values: { hitch: 'f32' } }); log.appendMany(rows)
//   w.add(entities({ id: 'freight', drive: drive.data(log), shape: cars.tractor.make(), joints: { trailer: { value: 'hitch' } } }))
import type { Anchor } from '../../../../core/geometry/shapes/parts.ts';

/** a sample of a track (a history log's row) */
export interface TrackRow { id: string | number; t: number | Date | string; lon: number; lat: number; values?: Record<string, number>; props?: Record<string, unknown> }
export interface HitchOptions {
  /** the fifth wheel ahead of the tractor's place, m (behind it: negative; default the shape's `hitch` anchor) */
  kingpin?: number;
  /** the trailer's axles behind the fifth wheel, m (default from the shape's `hitch` and `trailerAxle` anchors) */
  axle?: number;
  /** the tightest turn its track is rounded to, m (default 9) */
  radius?: number;
  /** the value it writes, in degrees (default 'hitch') */
  value?: string;
  /** a sample where the trailer's angle has changed by this many degrees (default 1) */
  step?: number;
  /** the trailer's axles' own track (each thing's: [lon, lat] at each sample written): to draw it, to check it */
  axles?: (id: string | number, track: [number, number][]) => void;
}
const ms = (t: number | Date | string) => (typeof t === 'number' ? t : t instanceof Date ? t.getTime() : Date.parse(t));
const wrap = (a: number) => a - 2 * Math.PI * Math.floor((a + Math.PI) / (2 * Math.PI));
/** the angle, degrees clockwise from north, of a step east dx and north dy */
const headingOf = (dx: number, dy: number) => Math.atan2(dx, dy);

/** a tractor's track (its rows, one thing or many) with its trailer's angle at each sample (`values.hitch`, degrees:
 *  the hinge's turn, the tractor's heading less the trailer's), its corners rounded and sampled where it turns */
export function hitch(rows: readonly TrackRow[], tractor: { anchors: readonly Anchor[] } | null = null, o: HitchOptions = {}): TrackRow[] {
  const an = (n: string) => tractor?.anchors.find((a) => a.name === n)?.at;
  const kp = o.kingpin ?? an('hitch')?.[2] ?? -1.7, L = Math.max(0.5, o.axle ?? (an('hitch') && an('trailerAxle') ? an('hitch')![2] - an('trailerAxle')![2] : 9.3));
  const R = Math.max(0.5, o.radius ?? 9), key = o.value ?? 'hitch', step = ((o.step ?? 1) * Math.PI) / 180;
  const by = new Map<string | number, TrackRow[]>();
  for (const r of rows) { const l = by.get(r.id); if (l) l.push(r); else by.set(r.id, [r]); }
  const out: TrackRow[] = [];
  for (const [id, list] of by) {
    // (in time order, a sample the same as the one before it, at its time and place, once)
    const s = [...list].sort((a, b) => ms(a.t) - ms(b.t)).filter((r, i, l) => !i || ms(r.t) !== ms(l[i - 1]!.t) || r.lon !== l[i - 1]!.lon || r.lat !== l[i - 1]!.lat), lon0 = s[0]!.lon, lat0 = s[0]!.lat;
    const kx = 111320 * Math.cos((lat0 * Math.PI) / 180), ky = 110574;
    const P = s.map((r) => [(r.lon - lon0) * kx, (r.lat - lat0) * ky] as [number, number]), T = s.map((r) => ms(r.t));
    // (the rows' own values between their samples: asked in time order)
    let vi = 0;
    const valuesAt = (t: number): Record<string, number> => {
      while (vi > 0 && T[vi]! > t) vi--;
      while (vi + 1 < s.length && T[vi + 1]! <= t) vi++;
      const i = vi;
      const a = s[i]!, b = s[Math.min(s.length - 1, i + 1)]!, f = T[i + 1] !== undefined && T[i + 1]! > T[i]! ? Math.max(0, Math.min(1, (t - T[i]!) / (T[i + 1]! - T[i]!))) : 0, v: Record<string, number> = {};
      for (const k of Object.keys(a.values ?? {})) v[k] = (a.values![k] ?? 0) + ((b.values?.[k] ?? a.values![k] ?? 0) - (a.values![k] ?? 0)) * f;
      return v;
    };
    // the track rounded: each corner an arc (its tangents within the legs either side), its times along it
    const path: { x: number; y: number; t: number }[] = [{ x: P[0]![0], y: P[0]![1], t: T[0]! }];
    for (let i = 1; i < P.length; i++) {
      const a = P[i - 1]!, b = P[i]!, c = P[i + 1], la = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const lc = c ? Math.hypot(c[0] - b[0], c[1] - b[1]) : 0;
      if (!c || la < 1e-3 || lc < 1e-3) { path.push({ x: b[0], y: b[1], t: T[i]! }); continue; }
      const ua = [(b[0] - a[0]) / la, (b[1] - a[1]) / la], uc = [(c[0] - b[0]) / lc, (c[1] - b[1]) / lc];
      const th = Math.acos(Math.max(-1, Math.min(1, ua[0]! * uc[0]! + ua[1]! * uc[1]!)));
      if (th < 0.01) { path.push({ x: b[0], y: b[1], t: T[i]! }); continue; }
      const d = Math.min(R * Math.tan(th / 2), la * 0.45, lc * 0.45), rr = d / Math.tan(th / 2), turn = Math.sign(ua[0]! * uc[1]! - ua[1]! * uc[0]!);
      const A = [b[0] - ua[0]! * d, b[1] - ua[1]! * d], tA = T[i]! - (d / la) * (T[i]! - T[i - 1]!), tC = T[i]! + (d / lc) * (T[i + 1]! - T[i]!);
      const cx = A[0]! - ua[1]! * rr * turn, cy = A[1]! + ua[0]! * rr * turn, a0 = Math.atan2(A[1]! - cy, A[0]! - cx), n = Math.max(2, Math.ceil(th / ((3 * Math.PI) / 180)));
      for (let k = 0; k <= n; k++) { const q = a0 + turn * th * (k / n); path.push({ x: cx + Math.cos(q) * rr, y: cy + Math.sin(q) * rr, t: tA + ((tC - tA) * k) / n }); }
    }
    // the fifth wheel along it pulling the trailer's axles (a tractrix, in steps of 10 cm); a sample written at each of
    // the path's points and wherever the trailer's angle has moved by `step` since the last
    const dirOf = (i: number) => { const a = path[Math.max(0, i - 1)]!, b = path[Math.min(path.length - 1, Math.max(1, i))]!; return headingOf(b.x - a.x, b.y - a.y); };
    let h = dirOf(1), ax = path[0]!.x + Math.sin(h) * kp - Math.sin(h) * L, ay = path[0]!.y + Math.cos(h) * kp - Math.cos(h) * L, last = NaN;
    const axles: [number, number][] = [];
    // (its props on its first sample, as a log keeps them)
    const emit = (x: number, y: number, t: number, phi: number) => {
      out.push({ id, t, lon: lon0 + x / kx, lat: lat0 + y / ky, values: { ...valuesAt(t), [key]: (phi * 180) / Math.PI }, ...(s[0]!.props && !axles.length ? { props: s[0]!.props } : {}) });
      axles.push([lon0 + ax / kx, lat0 + ay / ky]); last = phi;
    };
    for (let i = 0; i < path.length; i++) {
      const a = path[Math.max(0, i - 1)]!, b = path[i]!, len = Math.hypot(b.x - a.x, b.y - a.y);
      if (i > 0 && len > 1e-4) h = headingOf(b.x - a.x, b.y - a.y);
      const n = i > 0 ? Math.ceil(len / 0.1) : 0;
      for (let k = 1; k <= n; k++) {
        const f = k / n, x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f, Kx = x + Math.sin(h) * kp, Ky = y + Math.cos(h) * kp;
        const vx = Kx - ax, vy = Ky - ay, l = Math.hypot(vx, vy) || 1; ax = Kx - (vx / l) * L; ay = Ky - (vy / l) * L;
        const phi = wrap(h - headingOf(vx, vy));
        if (k < n && Math.abs(wrap(phi - last)) >= step) emit(x, y, a.t + (b.t - a.t) * f, phi);
      }
      const Kx = b.x + Math.sin(h) * kp, Ky = b.y + Math.cos(h) * kp;
      emit(b.x, b.y, b.t, i === 0 ? 0 : wrap(h - headingOf(Kx - ax, Ky - ay)));
    }
    o.axles?.(id, axles);
  }
  return out;
}
