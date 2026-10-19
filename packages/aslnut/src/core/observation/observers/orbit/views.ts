// core › render › camera › views: one vocabulary for where the camera is, the way people say it, everywhere in aslnut.
//   { lon, lat, dist | zoom, tilt, bearing }   degrees · metres · web-map zoom · 0 tilt = straight down · 0 bearing = north up
// A camera pose (what the camera takes) is the same in radians; `poseOf` / `viewOf` convert, `leg` goes from one to
// another up and over, and a Flight passes through several, evaluated at any progress (nothing animates on its own).
import { AslnutError } from '../../../world/errors.ts';
import { distForZoom, zoomForDist } from '../../../world/state.ts';
import { D, wrap } from '../../../space/geo.ts';

export interface View { lon: number; lat: number; dist?: number; zoom?: number; tilt?: number; /** degrees clockwise from north that the view faces (90: east at the top), the web-map convention */ bearing?: number }
/** the camera's own numbers: dist in metres, bearing in degrees, pitch in radians above the horizon (π/2 = straight down) */
export interface Pose { lon: number; lat: number; dist: number; bearing: number; pitch: number }

/** the most any view tilts (degrees from straight down): with the eye at street level or below (TILT_LIMIT) */
export const TILT_MAX = 88;
/** how far a view may tilt by the eye's height over the ground under the view's centre: `low` degrees from straight
 *  down with the eye `street` metres up or lower (a person's eye, a car's, a balcony: the horizon in view), `high`
 *  degrees from `above` metres up (a tilted map: the far ground stays near), eased between (on a log scale of the
 *  height). Nothing clips into the ground either way: the world keeps the eye over the ground under it */
export interface TiltLimit { low: number; high: number; street: number; above: number }
export const TILT_LIMIT: Readonly<TiltLimit> = Object.freeze({ low: 88, high: 80, street: 30, above: 300 });
const PITCH_MIN = (90 - TILT_MAX) * D, PITCH_MAX = Math.PI / 2 - 1e-4;
/** the most a view tilts (degrees) with the eye `h` metres over its centre's ground */
export function tiltMaxAt(h: number, l: TiltLimit = TILT_LIMIT): number {
  if (!(h > l.street)) return l.low;
  if (h >= l.above) return l.high;
  const u = Math.log(h / l.street) / Math.log(l.above / Math.max(1e-3, l.street)), k = u * u * (3 - 2 * u);
  return l.low + (l.high - l.low) * k;
}
/** the least pitch (radians over the horizon) a camera `dist` metres from its centre may take: the height its eye
 *  would have decides the limit, and that height is the pitch's (the smallest pitch that keeps within the limit) */
export function pitchFloor(dist: number, l: TiltLimit = TILT_LIMIT): number {
  const lo = (90 - Math.max(l.low, l.high)) * D, hi = (90 - Math.min(l.low, l.high)) * D;
  const ok = (p: number) => p >= (90 - tiltMaxAt(dist * Math.sin(p), l)) * D - 1e-9;
  if (ok(lo)) return lo;
  let a = lo, b = hi;
  for (let i = 0; i < 30; i++) { const m = (a + b) / 2; if (ok(m)) b = m; else a = m; }
  return b;
}

/** what each of a view's numbers is (the fix an error gives) */
const VIEW_UNITS = { lon: 'degrees east', lat: 'degrees north (-90..90)', dist: 'metres from the camera to the centre', zoom: 'a web-map zoom level', tilt: 'degrees from straight down (0..88; 80 at most once the eye is some 300 m up)', bearing: 'degrees clockwise from north' } as const;
/** a number a view or pose must have: finite (a NaN or an Infinity in the camera would draw every frame for ever) */
const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
export function checkView(v: View, where = 'view'): void {
  if (!v || typeof v !== 'object' || v.lon === undefined || v.lat === undefined) {
    throw new AslnutError('E-VIEW-001', `a view needs numbers lon and lat (got ${JSON.stringify(v)})`, { where, fix: 'write { lon: 107.6, lat: -6.9, zoom: 11 }' });
  }
  for (const k of ['lon', 'lat', 'dist', 'zoom', 'tilt', 'bearing'] as const) {
    const x = v[k]; if (x === undefined || finite(x)) continue;
    throw new AslnutError('E-VIEW-001', `a view's ${k} is not a finite number (got ${typeof x === 'number' ? String(x) : JSON.stringify(x)})`, {
      where, fix: `give ${k} in ${VIEW_UNITS[k]}${k === 'lon' || k === 'lat' ? '' : ', or leave it out'}; the view now, in the same terms, is w.camera.view (the camera's own yaw and pitch are radians)`,
    });
  }
  if (v.dist !== undefined && v.dist <= 0) throw new AslnutError('E-VIEW-001', `a view's dist is ${v.dist}`, { where, fix: 'give dist in metres above 0, or a zoom' });
  if (v.lat < -90 || v.lat > 90) throw new AslnutError('E-VIEW-001', `lat ${v.lat} is outside -90..90`, { where, fix: 'did you swap lon and lat? A view is { lon, lat }' });
  // both dist and zoom: the view as it is read (w.camera.view carries both) is written back as it is, so they must agree
  if (v.dist !== undefined && v.zoom !== undefined && Math.abs(zoomForDist(v.dist, v.lat) - v.zoom) > 1e-6) {
    throw new AslnutError('E-VIEW-001', `a view's dist (${v.dist} m) and zoom (${v.zoom}) disagree: that dist is zoom ${+zoomForDist(v.dist, v.lat).toFixed(4)} at lat ${v.lat}`, { where, fix: 'keep one: dist (metres) or zoom (web-map level); to change one of a view read from w.camera.view, leave the other out' });
  }
}
/** a camera pose's numbers: finite, its dist above 0 (a pose set from outside, a flight's, camera keys' of your own) */
export function checkPose(p: Pose, where = 'pose'): void {
  for (const k of ['lon', 'lat', 'dist', 'bearing', 'pitch'] as const) {
    const x = p?.[k]; if (finite(x) && (k !== 'dist' || x > 0)) continue;
    throw new AslnutError('E-VIEW-001', `a camera pose's ${k} is ${typeof x === 'number' ? String(x) : JSON.stringify(x)}`, {
      where, fix: 'a pose is { lon, lat (degrees), dist (metres above 0), bearing (degrees), pitch (radians over the horizon) }, all finite; poseOf(view) makes one from a view',
    });
  }
}
export function poseOf(v: View): Pose {
  checkView(v);
  const dist = v.dist ?? distForZoom(v.zoom ?? 3, v.lat);
  const pitch = Math.max(PITCH_MIN, Math.min(PITCH_MAX, (90 - (v.tilt ?? 0)) * D));
  return { lon: v.lon, lat: v.lat, dist, bearing: v.bearing ?? 0, pitch };
}
export function viewOf(p: Pose): Required<View> {
  return { lon: p.lon, lat: p.lat, dist: p.dist, zoom: zoomForDist(p.dist, p.lat), tilt: 90 - p.pitch / D, bearing: p.bearing };
}
const groundMetres = (a: Pose, b: Pose) => Math.hypot(wrap(b.lon - a.lon) * Math.cos(((a.lat + b.lat) / 2) * D), b.lat - a.lat) * 111320;

/** one leg, u 0..1 (linear; the caller eases). 'arc' goes up and over a long way; 'direct' stays low;
 *  'around' turns round the centre `turns` times while it moves */
export function leg(a: Pose, b: Pose, u: number, path: 'direct' | 'arc' | 'around' = 'arc', turns = 1): Pose {
  const la = Math.log(a.dist), lb = Math.log(b.dist);
  let ld = la + (lb - la) * u;
  if (path === 'arc') { const far = Math.max(a.dist, b.dist, groundMetres(a, b) * 1.2); ld += Math.sin(Math.PI * u) * Math.max(0, Math.log(far) - Math.max(la, lb)); }
  const db = ((b.bearing - a.bearing + 540) % 360) - 180;
  const bearing = a.bearing + db * u + (path === 'around' ? 360 * turns * u : 0);
  return { lon: wrap(a.lon + wrap(b.lon - a.lon) * u), lat: a.lat + (b.lat - a.lat) * u, dist: Math.exp(ld), bearing, pitch: a.pitch + (b.pitch - a.pitch) * u };
}
/** how long a leg feels: zooming and crossing ground both cost */
export function legCost(a: Pose, b: Pose): number {
  return 0.2 + Math.abs(Math.log(b.dist / a.dist)) + Math.log(1 + groundMetres(a, b) / Math.min(a.dist, b.dist)) + Math.abs(b.pitch - a.pitch) + Math.abs(((b.bearing - a.bearing + 540) % 360) - 180) / 90;
}
/** a flight through views; at(p) for p in 0..1, the legs shared by how long each feels */
export class Flight {
  readonly poses: Pose[]; private cum: number[];
  constructor(views: (View | Pose)[]) {
    if (!views.length) throw new AslnutError('E-VIEW-001', 'a flight needs at least one view', { fix: 'pass [from, to]' });
    this.poses = views.map((v, i) => { if (!('pitch' in v)) return poseOf(v); checkPose(v, `flight[${i}]`); return v; });
    this.cum = [0];
    for (let i = 1; i < this.poses.length; i++) this.cum.push(this.cum[i - 1]! + legCost(this.poses[i - 1]!, this.poses[i]!));
  }
  /** a duration that feels right for this flight (s) */
  get seconds(): number { return Math.min(9, 0.8 + this.cum[this.cum.length - 1]! * 0.35); }
  at(p: number): Pose {
    const v = this.poses; if (v.length === 1 || p <= 0) return v[0]!; if (p >= 1) return v[v.length - 1]!;
    const total = this.cum[this.cum.length - 1]!, x = p * total;
    let i = 1; while (i < v.length - 1 && this.cum[i]! < x) i++;
    const a = this.cum[i - 1]!, b = this.cum[i]!;
    return leg(v[i - 1]!, v[i]!, b > a ? (x - a) / (b - a) : 1);
  }
}
