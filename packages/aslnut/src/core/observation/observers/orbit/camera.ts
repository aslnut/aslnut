// core › render › camera: the camera of a world. It always orbits the view's centre (lon / lat), which is the world's origin;
// dragging moves the centre over the body instead of the camera, so the numbers near the camera stay small at any zoom.
// Distance gives the zoom level and the globe → flat morph. Mouse and touch: one finger pans, two pinch, twist and
// tilt; the wheel zooms towards the pointer and eases there; a drag let go glides on.
// Time comes from the world's clock (`update(w, h, dtMs)`), never the wall clock: a capture steps it exactly.
import { mat4, vec3, vec4 } from 'wgpu-matrix';
import { REF_H, distForZoom, zoomForDist } from '../../../world/state.ts';
import { D, MAX_LAT, R, lonLatOf, worldOf, wrap, type Frame } from '../../../space/geo.ts';
import { AslnutError } from '../../../world/errors.ts';
import { ease, easing, type Ease } from './ease.ts';
import type { Keys } from './keys.ts';
import { PATHS, type Path } from './keys.ts';
import { TILT_LIMIT, TILT_MAX, checkPose, leg, pitchFloor, poseOf, tiltMaxAt, viewOf, type Pose, type TiltLimit, type View } from './views.ts';

export interface FlyOptions { seconds?: number; ease?: Ease; path?: Path }

/** a move by hand (or your own controls) with a number that is not finite (or a zoom factor not above 0): refused */
function move(where: string, ok: boolean, ...xs: number[]): void {
  if (ok && xs.every(Number.isFinite)) return;
  throw new AslnutError('E-VIEW-001', `camera.${where}(${xs.join(', ')}): not a finite move`, { where: `camera.${where}`, fix: where === 'zoomBy' ? 'give a factor above 0 (2: twice as far)' : 'give finite numbers (metres, radians)' });
}

export class Camera implements Frame {
  lon = 0; lat = 0; dist = R * 3;
  /** orbit radians counterclockwise from north; public bearing is clockwise */
  yaw = 0;
  /** radians above the horizon: π/2 = straight down */
  pitch = Math.PI / 2 - 1e-4;
  fov = (50 * Math.PI) / 180;
  morph = 0;
  /** above `globeAbove` metres a globe, below `flatBelow` a flat map (a flat body: always flat) */
  globeAbove = 3.2e6; flatBelow = 1.1e6;
  /** a flat body (a floor, a level): never a globe */
  flat = false;
  /** the globe, the flat map, or each by distance */
  projection: 'auto' | 'globe' | 'flat' = 'auto';
  private morphEase = 0;
  /** pointer presses and wheel turns so far */
  touches = 0;
  /** what a person's hands moved so far: the centre (a drag, a glide, two fingers moving), the turn and the tilt, the
   *  zoom (a pinch, the wheel). A follow ends only when they move what it keeps (the centre: a pan) */
  readonly hands = { pan: 0, turn: 0, zoom: 0 };
  /** a one-finger (left button) drag moves the map ('pan', default) or turns and tilts round the centre ('orbit');
   *  the other button or Shift does the other */
  drag: 'pan' | 'orbit' = 'pan';
  /** something keeps the view's centre (a follow, a move): a pinch or the wheel zooms round it, not round the finger */
  held = false;
  /** a person's touch, drag or wheel stops any flight, camera keys and follow (default); false: they play on and
   *  input waits for them to end */
  interrupt = true;
  minDist = 40; maxDist = R * 8;
  /** what a person's hands may do to the camera (core › interaction › controllers: orbit, pan) */
  gestures = { pan: true, rotate: true, tilt: true, zoom: true };
  /** the inputs that zoom (each within gestures.zoom) */
  zoomInputs = { wheel: true, pinch: true, keys: true };
  /** the box the centre is kept in by hand [w, s, e, n] (null: none), how hard it holds (1: never past it) */
  bounds: [number, number, number, number] | null = null; viscosity = 1;
  /** a zoom by hand ends on a multiple of these levels (0: where it stops); levels a key zooms; the keys on */
  snap = 0; step = 1; keys = false;
  /** the pitch a person may tilt to (radians over the horizon: 2° … straight down; the tilt limit by the eye's height
   *  holds too) */
  pitchRange: [number, number] = [(90 - TILT_MAX) * D, Math.PI / 2 - 1e-4];
  /** how far a view may tilt by the eye's height (core › observation › observers › orbit › views): 88° at street
   *  level or below, 80° from 300 m up, eased between */
  tiltLimit: TiltLimit = { ...TILT_LIMIT };
  /** the least pitch at a distance (the tilt limit by the eye's height there) */
  pitchFloor(dist = this.dist): number { return pitchFloor(dist, this.tiltLimit); }
  /** the least pitch for an eye `h` metres over the centre's ground */
  pitchAt(h: number): number { return (90 - tiltMaxAt(h, this.tiltLimit)) * D; }
  /** minDist and maxDist come from a zoom range (they follow the framing) */
  zoomLimited = false;
  /** the ground's height under the centre × exaggeration (m): the camera orbits it */
  groundY = 0;
  readonly viewProj = mat4.create(); readonly eye = vec3.create(); readonly inv = mat4.create();
  /** the canvas in CSS px, from the last frame */
  width = 1200; height = 800;
  /** seconds on the camera's clock (the world's) */
  clock = 0;
  // (t0: when it started on the camera's clock, NaN until its first frame: a move's time starts at its first drawn
  // frame, so a flight from a resting world takes its seconds; the world's clock catching up the rest, up to a
  // quarter of a second in that frame, is not the flight's)
  private motion: { from: Pose; to: Pose; t0: number; seconds: number; ease: Ease; path: Path; done: () => void } | null = null;
  private playing: { keys: Keys; t0: number; loop: boolean; done: () => void } | null = null;
  /** a driver of the world's (a camera move: core › observation › observers › orbit › moves): asked for the pose each
   *  frame (dt seconds on the camera's clock); it ends when it says so (true), on a new move, or when a person's hands
   *  move the camera */
  private driver: { step: (dt: number) => boolean | void; done: () => void } | null = null;
  private zoomLeft = 1; private zoomAtPx: [number, number] = [0, 0];
  private glide: [number, number] = [0, 0];

  constructor(v?: View) { if (v) this.jump(v); }
  /** called when something sets it moving (a jump, a flight, keys, a hand on it): a resting frame loop wakes */
  changed: (() => void) | null = null;

  // ── where it is ─────────────────────────────────────────────────────────────────────────────────────────────
  get pose(): Pose { return { lon: this.lon, lat: this.lat, dist: this.dist, bearing: wrap(-this.yaw / D), pitch: this.pitch }; }
  get view(): Required<View> { return viewOf({ ...this.pose, dist: this.dist / this.frameK }); }
  /** web-map zoom at the centre, for a reference frame 800 CSS px tall (the same framing on every screen) */
  get zoom(): number { return zoomForDist(this.dist / this.frameK, this.lat); }
  /** 'auto': a portrait screen sees as much across as a landscape one does (a zoom shows the same place whole on a
   *  phone); 'height': a zoom frames the same height on every screen; 'pixels': a zoom is the web map's at this
   *  canvas's own pixels (a 256 px tile of that level drawn 256 CSS px across, whatever the canvas's size) */
  frame: 'auto' | 'height' | 'pixels' = 'auto';
  /** how much farther the camera stands for this screen's shape (1, or more on a portrait screen; 'pixels': its height
   *  against the 800 px reference) */
  get frameK(): number {
    if (this.frame === 'pixels') return Math.max(1, this.height) / REF_H;
    return this.frame !== 'auto' || this.width >= this.height ? 1 : Math.min(2.5, Math.max(1, (1.2 * this.height) / Math.max(1, this.width)));
  }
  /** metres per CSS pixel at the centre */
  get pixelSize(): number { return (2 * this.dist * Math.tan(this.fov / 2)) / Math.max(1, this.height); }
  /** set the pose at once (stops any flight); a view or pose with a number that is not finite is refused (nothing
   *  changes) */
  jump(v: View | Pose): void {
    const p = 'pitch' in v ? v : this.framed(poseOf(v));
    checkPose(p, 'jump');
    this.stop();
    this.setPose(p); this.changed?.();
  }
  /** (every pose the camera takes is checked: a NaN or an Infinity in it would draw every frame for ever) */
  private setPose(p: Pose, where = 'pose'): void {
    checkPose(p, where);
    this.lon = wrap(p.lon); this.lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, p.lat));
    this.dist = Math.min(this.maxDist, Math.max(this.minDist, p.dist)); this.yaw = -p.bearing * D; this.pitch = p.pitch;
    this.limitTilt();
  }
  /** the tilt within the limit by the eye's height (a pitch under 10° only ever needs it) */
  private limitTilt(): void { if (this.pitch < (90 - Math.min(this.tiltLimit.low, this.tiltLimit.high)) * D) this.pitch = Math.max(this.pitch, this.pitchFloor()); }
  /** set the pose a driver works out (a move), with the ground under its centre (world metres): the eye stands where
   *  the driver put it (the ground's easing is for the view's own centre moving, not for this) */
  place(p: Pose, groundY?: number): void {
    // (the eye where the move puts it: the nearest and farthest distances are a person's hands', not a move's)
    this.setPose(p, 'move'); this.dist = Math.min(R * 8, Math.max(0.01, p.dist)); this.limitTilt();
    if (groundY !== undefined && Number.isFinite(groundY)) this.groundY = groundY;
  }
  /** a view's pose as this screen frames it */
  framed(p: Pose): Pose { const k = this.frameK; return k === 1 ? p : { ...p, dist: p.dist * k }; }
  /** fly to a view; resolves when it arrives (or rejects nothing: a newer move ends it early, resolved). Its time starts
   *  at its first drawn frame (the start pose), and it arrives `seconds` after it */
  fly(to: View, o: FlyOptions = {}): Promise<void> {
    // (what it is asked is checked before anything stops: the view, its seconds, ease and path)
    const target = this.framed(poseOf(to));
    if (o.seconds !== undefined && !(Number.isFinite(o.seconds) && o.seconds >= 0)) throw new AslnutError('E-VIEW-001', `a flight's seconds is ${o.seconds}`, { where: 'fly', fix: 'give seconds as a finite number, 0 or more (0: at once), or leave it out' });
    if (o.path !== undefined && !PATHS.includes(o.path)) throw new AslnutError('E-VIEW-001', `unknown path '${o.path}'`, { where: 'fly', fix: `use ${PATHS.join(', ')}` });
    easing(o.ease);   // an unknown ease throws here, not mid-flight
    this.stop();
    const from = this.pose;
    if (to.bearing === undefined) target.bearing = from.bearing;
    if (to.tilt === undefined) target.pitch = from.pitch;
    const ground = Math.hypot(wrap(target.lon - from.lon), target.lat - from.lat) * 111320;
    const seconds = o.seconds ?? Math.min(6, 0.9 + 0.35 * (Math.abs(Math.log(target.dist / from.dist)) + Math.log(1 + ground / Math.min(from.dist, target.dist))));
    return new Promise((done) => { this.motion = { from, to: target, t0: NaN, seconds, ease: o.ease ?? 'smooth', path: o.path ?? 'arc', done }; this.changed?.(); });
  }
  /** follow camera keys on the camera's clock, from their first drawn frame (the first key); resolves at the end (loop:
   *  never) */
  play(k: Keys, o: { loop?: boolean } = {}): Promise<void> {
    this.stop();
    return new Promise((done) => { this.playing = { keys: k, t0: NaN, loop: !!o.loop, done }; this.changed?.(); });
  }
  /** the view is changing: a flight, camera keys, a glide, a hand on it, or a pose set from outside on consecutive
   *  frames (`w.go` each frame, a follow, your own driver): everything that moves the view counts the same, so
   *  dynamic resolution and steady tile levels engage for scripted motion as they do for touch */
  get moving(): boolean { return !!(this.motion || this.playing || this.driver || this.zoomLeft !== 1 || this.glide[0] || this.glide[1]) || this.changedFrames > 0; }
  // the pose at the last update and how many more updates still count as moving since it last changed
  private last = [NaN, NaN, NaN, NaN, NaN]; private changedFrames = 0;
  private noteChange(): void {
    const l = this.last, ne = (a: number, b: number) => a !== b && !(Number.isNaN(a) && Number.isNaN(b));
    // (a NaN written into the fields is one change, not one a frame: NaN is never equal to itself; the world reports it)
    if (ne(l[0]!, this.lon) || ne(l[1]!, this.lat) || ne(l[2]!, this.dist) || ne(l[3]!, this.yaw) || ne(l[4]!, this.pitch)) {
      // the first pose ever is not a move
      this.changedFrames = Number.isNaN(l[0]!) ? 0 : 2;
      l[0] = this.lon; l[1] = this.lat; l[2] = this.dist; l[3] = this.yaw; l[4] = this.pitch;
    } else if (this.changedFrames > 0) this.changedFrames--;
  }
  /** stop every motion (a jump, a flight, camera keys, a move) */
  stop(): void {
    const m = this.motion, p = this.playing, d = this.driver;
    this.motion = null; this.playing = null; this.driver = null; this.zoomLeft = 1; this.glide = [0, 0];
    m?.done(); p?.done(); d?.done();
  }
  /** a driver of the world's moves the camera from now on (it ends any other motion); resolves when it ends */
  drive(step: (dt: number) => boolean | void): Promise<void> {
    this.stop();
    return new Promise((done) => { this.driver = { step, done }; this.changed?.(); });
  }
  get driving(): boolean { return this.driver !== null; }
  /** a person's hands moved the camera (what: the centre, the turn, the zoom): counted; a driver ends (a move keeps
   *  everything of the view) */
  private byHand(what: 'pan' | 'turn' | 'zoom'): void {
    this.hands[what]++;
    if (this.driver && this.interrupt) { const d = this.driver; this.driver = null; d.done(); }
  }

  // ── each frame ──────────────────────────────────────────────────────────────────────────────────────────────
  /** advance by dtMs on the world's clock and recompute the matrices */
  update(w: number, h: number, dtMs: number): void {
    // the screen changed shape (a phone turned): keep the same zoom
    const k0 = this.frameK; this.width = w; this.height = h; const k1 = this.frameK;
    // (a zoom range set by a person's controller is in zooms: its distances follow the framing too)
    if (k0 !== k1 && this.zoomLimited) { this.minDist *= k1 / k0; this.maxDist *= k1 / k0; }
    if (k0 !== k1 && !this.motion && !this.playing) this.dist = Math.min(this.maxDist, Math.max(this.minDist, this.dist * (k1 / k0)));
    const dt = Math.min(64, Math.max(0, dtMs));
    this.clock += dtMs / 1000;
    if (this.zoomLeft !== 1) {
      const k = Math.abs(Math.log(this.zoomLeft)) < 1e-4 ? this.zoomLeft : this.zoomLeft ** (1 - Math.exp(-dt / 90));
      this.zoomByHand(k, ...this.zoomAtPx); this.zoomLeft /= k;
      if (Math.abs(Math.log(this.zoomLeft)) < 1e-4) this.zoomLeft = 1;
      if (this.zoomLeft === 1) this.snapping = false;
    }
    if (this.glide[0] || this.glide[1]) {
      this.panByHand(this.glide[0] * dt, this.glide[1] * dt);
      const f = Math.exp(-dt / 170); this.glide = [this.glide[0] * f, this.glide[1] * f];
      if (Math.hypot(...this.glide) < 0.01) this.glide = [0, 0];
    }
    // a zoom by hand that ended (the wheel's ease done, the fingers off): on to the nearest multiple of `snap`
    if (this.zoomedByHand && this.zoomLeft === 1 && this.pinching === 0 && this.clock - this.zoomedAt > 0.12) {
      this.zoomedByHand = false;
      if (this.snap > 0) {
        const z = this.zoom, to = Math.round(z / this.snap) * this.snap, want = Math.min(this.maxDist, Math.max(this.minDist, distForZoom(to, this.lat) * this.frameK));
        if (Math.abs(to - z) > 1e-3 && Number.isFinite(want)) { this.zoomLeft = want / this.dist; this.snapping = true; }
      }
    }
    // let go past the box (viscosity under 1): eased back inside
    if (this.pastBox && this.bounds && this.pressed === 0 && !this.glide[0] && !this.glide[1]) {
      const [w, s, e, n] = this.bounds, lon = Math.min(e, Math.max(w, this.lon)), lat = Math.min(n, Math.max(s, this.lat));
      if (lon === this.lon && lat === this.lat) this.pastBox = false;
      else {
        const k = 1 - Math.exp(-dt / 90), near = Math.abs(lon - this.lon) < 1e-7 && Math.abs(lat - this.lat) < 1e-7;
        this.lon = near ? lon : this.lon + (lon - this.lon) * k; this.lat = near ? lat : this.lat + (lat - this.lat) * k;
      }
    }
    if (this.motion) {
      const m = this.motion; if (Number.isNaN(m.t0)) m.t0 = this.clock;
      const u = m.seconds > 0 ? Math.min(1, (this.clock - m.t0) / m.seconds) : 1;
      // (an ease of your own that answers NaN: the flight ends there, refused)
      try { this.setPose(leg(m.from, m.to, ease(m.ease, u), m.path), 'fly'); } catch (e) { this.stop(); throw e; }
      if (u >= 1) { this.motion = null; m.done(); }
    }
    if (this.playing) {
      const p = this.playing, d = p.keys.duration; if (Number.isNaN(p.t0)) p.t0 = this.clock - p.keys.list[0]!.at;
      let t = this.clock - p.t0;
      if (p.loop && d > 0) t = p.keys.list[0]!.at + ((t - p.keys.list[0]!.at) % d);
      // (keys of your own whose pose is not one: the play ends there, refused)
      try { this.setPose(this.framed(p.keys.pose(t)), 'play'); } catch (e) { this.stop(); throw e; }
      if (!p.loop && t >= p.keys.list[p.keys.list.length - 1]!.at) { this.playing = null; p.done(); }
    }
    if (this.driver) {
      const d = this.driver;
      // (a driver of your own that throws, or poses a NaN: it ends there, refused)
      let end: boolean | void = false;
      try { end = d.step(dtMs / 1000); } catch (e) { if (this.driver === d) { this.driver = null; d.done(); } throw e; }
      if (end && this.driver === d) { this.driver = null; d.done(); }
    }
    // the tilt within the limit by the eye's height (a zoom out from the street takes the tilt back to the map's)
    this.limitTilt();
    const want = this.morphAt(this.dist);
    if (this.morphEase > 0) { this.morph += (want - this.morph) * Math.min(1, dt / 1000 / this.morphEase * 4); if (Math.abs(want - this.morph) < 0.002) { this.morph = want; this.morphEase = 0; } }
    else this.morph = want;
    // the eye over what is under it
    this.keepClear();
    this.noteChange();
    this.matrices();
  }
  /** the globe, the flat map, or each by distance; eases over `seconds` */
  setProjection(p: 'auto' | 'globe' | 'flat', seconds = 1.2): void { this.projection = p; this.morphEase = Math.max(0, seconds); this.changed?.(); }
  morphAt(dist: number): number {
    if (this.flat || this.projection === 'flat') return 1;
    if (this.projection === 'globe') return 0;
    const s = Math.min(1, Math.max(0, (dist - this.flatBelow) / (this.globeAbove - this.flatBelow)));
    return 1 - s * s * (3 - 2 * s);
  }
  /** the eye's height over the ground under it (m; the world sets it every frame on the flat map; 0: not known) */
  clearance = 0;
  /** metres the eye keeps over what is under it (the ground, what is stood on there: a deck, a road), whatever moves
   *  the camera (a hand, a flight, a move); false: none (a view from under the ground) */
  clear: number | false = 1;
  /** what is under a place (world metres; the world says: the ground and what is stood on, the level nearest the eye's
   *  height `y`); null: nothing known */
  under: ((lon: number, lat: number, y: number) => number) | null = null;
  /** the least pitch the eye is drawn at this frame (0: the view's own): what keeps it over what is under it */
  private clearPitch = 0;
  /** the eye raised over what is under it, near the ground only: the picture is drawn tilted up as far as that needs
   *  (the centre and the distance stay), the view's own pose kept (a ground still easing in, heights still arriving:
   *  nothing of it stays once the eye is clear) */
  private keepClear(): void {
    this.clearPitch = 0;
    const u = this.under, clear = this.clear; if (!u || clear === false || this.morph < 0.5) return;
    const h = this.dist * Math.sin(this.pitch); if (h > 3000) return;
    const back = this.dist * Math.cos(this.pitch), b = -this.yaw, kz = R * D, kx = kz * Math.cos(this.lat * D);
    const lon = wrap(this.lon - (Math.sin(b) * back) / kx), lat = this.lat - (Math.cos(b) * back) / kz;
    // (a number not finite written into the camera: nothing to keep clear; the world says so once)
    if (!Number.isFinite(lon) || !Number.isFinite(lat) || !Number.isFinite(h) || !Number.isFinite(this.groundY)) return;
    const g = u(lon, lat, this.groundY + h); if (!Number.isFinite(g)) return;
    const want = g + clear - this.groundY; if (h >= want) return;
    this.clearPitch = want >= this.dist ? Math.PI / 2 - 1e-4 : Math.asin(want / this.dist);
  }
  /** near / far planes for a distance: far reaches the horizon of a tilted flat map. The near plane stands as far out
   *  as is safe (a tenth of the eye's clearance, at most 2 % of the distance): the depth buffer's precision grows with
   *  it, so surfaces centimetres apart (a verge on the ground, paint on a road) keep their order at street level */
  planes(dist = this.dist): [number, number] { return [Math.max(0.05, dist * 0.004, Math.min(this.clearance * 0.1, dist * 0.02)), dist * 40 + 1000]; }
  private matrices(): void {
    // (the pitch drawn: the view's own, raised while the eye would be under what is under it)
    const pitch = Math.max(this.pitch, this.clearPitch), cp = Math.cos(pitch), t: [number, number, number] = [0, this.groundY, 0];
    vec3.set(this.dist * cp * Math.sin(this.yaw), this.groundY + this.dist * Math.sin(pitch), this.dist * cp * Math.cos(this.yaw), this.eye);
    const up = pitch > 1.5 ? [Math.sin(this.yaw) * -1, 0, -Math.cos(this.yaw)] : [0, 1, 0];
    const [n, f] = this.planes();
    mat4.multiply(mat4.perspective(this.fov, this.width / Math.max(1, this.height), n, f), mat4.lookAt(this.eye, t, up), this.viewProj);
    mat4.inverse(this.viewProj, this.inv);
  }

  // ── screen ↔ world ──────────────────────────────────────────────────────────────────────────────────────────
  /** the ray through a screen point (CSS px), in world metres */
  ray(px: number, py: number): { o: [number, number, number]; d: [number, number, number] } {
    const x = (px / this.width) * 2 - 1, y = 1 - (py / this.height) * 2;
    const a = vec4.transformMat4([x, y, 0, 1], this.inv), b = vec4.transformMat4([x, y, 1, 1], this.inv);
    const o: [number, number, number] = [a[0]! / a[3]!, a[1]! / a[3]!, a[2]! / a[3]!];
    const f = [b[0]! / b[3]!, b[1]! / b[3]!, b[2]! / b[3]!], l = Math.hypot(f[0]! - o[0], f[1]! - o[1], f[2]! - o[2]) || 1;
    return { o, d: [(f[0]! - o[0]) / l, (f[1]! - o[1]) / l, (f[2]! - o[2]) / l] };
  }
  /** where a screen point meets the ground: the plane y = h on the flat map, the sphere on the globe */
  groundHit(px: number, py: number, h = this.groundY): [number, number, number] | null {
    const { o, d } = this.ray(px, py);
    if (this.morph < 0.5) {
      const c = [0, -R, 0], r = R + h, oc = [o[0] - c[0]!, o[1] - c[1]!, o[2] - c[2]!];
      const b = oc[0]! * d[0] + oc[1]! * d[1] + oc[2]! * d[2], q = oc[0]! ** 2 + oc[1]! ** 2 + oc[2]! ** 2 - r * r, disc = b * b - q;
      if (disc < 0) return null;
      const t = -b - Math.sqrt(disc);
      return t > 0 ? [o[0] + d[0] * t, o[1] + d[1] * t, o[2] + d[2] * t] : null;
    }
    if (Math.abs(d[1]) < 1e-9) return null;
    const t = (h - o[1]) / d[1];
    return t > 0 ? [o[0] + d[0] * t, h, o[2] + d[2] * t] : null;
  }
  /** a screen point → lon / lat on the ground (null: the sky) */
  lonLatAt(px: number, py: number): [number, number] | null {
    const p = this.groundHit(px, py); return p ? lonLatOf(this, p[0], p[1], p[2]) : null;
  }
  /** world metres → CSS px (null behind the camera) */
  projectWorld(x: number, y: number, z: number): [number, number] | null {
    const c = vec4.transformMat4([x, y, z, 1], this.viewProj);
    if (c[3]! <= 0) return null;
    return [((c[0]! / c[3]! + 1) / 2) * this.width, ((1 - c[1]! / c[3]!) / 2) * this.height];
  }
  /** a place → CSS px (null behind the camera); h is metres above sea level, times the exaggeration given */
  project(lon: number, lat: number, h = 0): [number, number] | null { const p = worldOf(this, lon, lat, h); return this.projectWorld(p[0], p[1], p[2]); }
  /** a place is on the camera's side of the globe (not behind its curve) */
  facing(lon: number, lat: number, h = 0): boolean {
    if (this.morph > 0.98) return true;
    const p = worldOf(this, lon, lat, h), n = [p[0], p[1] + R, p[2]], e = this.eye;
    return n[0]! * (e[0]! - p[0]) + n[1]! * (e[1]! - p[1]) + n[2]! * (e[2]! - p[2]) > 0;
  }

  // ── moving by hand ──────────────────────────────────────────────────────────────────────────────────────────
  zoomBy(f: number): void { move('zoomBy', f > 0, f); this.dist = Math.min(this.maxDist, Math.max(this.minDist, this.dist * f)); }
  /** zoom by `f` keeping the ground under a screen point where it is (on the globe: round the centre) */
  zoomAt(f: number, px: number, py: number): void {
    if (this.morph < 0.6 || this.held) { this.zoomBy(f); return; }
    const P = this.groundHit(px, py), d0 = this.dist;
    this.zoomBy(f);
    const k = this.dist / d0;
    if (!P || Math.hypot(P[0], P[2]) > d0 * 20) return;
    this.moveBy(P[0] * (1 - k), P[2] * (1 - k));
  }
  /** move by screen pixels (the ground under the finger follows it) */
  pan(dx: number, dy: number): void {
    const s = (2 * this.dist * Math.tan(this.fov / 2)) / this.height, c = Math.cos(this.yaw), n = Math.sin(this.yaw);
    const k = 1 / Math.max(0.35, Math.sin(this.pitch));
    this.moveBy((-c * dx - n * dy * k) * s, (n * dx - c * dy * k) * s);
  }
  /** metres east / south, as a move of the centre over the body */
  moveBy(ex: number, ez: number): void {
    move('moveBy', true, ex, ez);
    this.lon = wrap(this.lon + ex / (R * Math.max(0.05, Math.cos(this.lat * D))) / D);
    this.lat = Math.max(-MAX_LAT, Math.min(MAX_LAT, this.lat - ez / R / D));
  }
  turn(dYawRad: number, dPitchRad: number): void {
    move('turn', true, dYawRad, dPitchRad);
    this.yaw += dYawRad;
    this.pitch = Math.min(this.pitchRange[1], Math.max(this.pitchRange[0], this.pitch + dPitchRad));
    this.limitTilt();
  }
  /** turn by a person's hands: only what the gestures allow */
  private turnByHand(dYaw: number, dPitch: number): void {
    const y = this.gestures.rotate ? dYaw : 0, p = this.gestures.tilt ? dPitch : 0;
    if (y || p) { this.turn(y, p); this.byHand('turn'); }
  }
  /** move the centre by a person's hands (a drag, a glide, two fingers moving together) */
  private panByHand(dx: number, dy: number): void {
    if (!dx && !dy) return;
    const lon0 = this.lon, lat0 = this.lat;
    this.pan(dx, dy); this.byHand('pan');
    const b = this.bounds; if (!b) return;
    // past the box: held at its edge (viscosity 1), or let go past it by the share left (eased back when let go)
    const [w, s, e, n] = b, v = Math.max(0, Math.min(1, this.viscosity)), keep = (x: number, x0: number, lo: number, hi: number) => {
      if (x >= lo && x <= hi) return x;
      const edge = x < lo ? lo : hi;
      if (v >= 1) return edge;
      // (from the edge when it was inside; from where it was when it was past already: only going farther is held back)
      if (x0 >= lo && x0 <= hi) return edge + (x - edge) * (1 - v);
      return Math.abs(x - edge) > Math.abs(x0 - edge) ? x0 + (x - x0) * (1 - v) : x;
    };
    this.lon = keep(this.lon, lon0, w, e); this.lat = keep(this.lat, lat0, s, n);
    this.pastBox = this.lon < w || this.lon > e || this.lat < s || this.lat > n;
  }
  /** dragged past the box (viscosity under 1): eased back once let go */
  private pastBox = false;
  /** zoom by a person's hands (a pinch, the wheel easing in) */
  private zoomByHand(f: number, px: number, py: number): void {
    if (f === 1) return;
    this.zoomAt(f, px, py); this.byHand('zoom');
    // (a snap's own ease is not a new zoom by hand: it ends where it was going)
    if (this.snapping) return;
    this.zoomedByHand = true; this.zoomedAt = this.clock;
  }
  /** a zoom by hand went on (ended: snapped to `snap`), when it last moved, a snap under way, fingers down, pinching */
  private zoomedByHand = false; private zoomedAt = 0; private snapping = false; private pressed = 0; private pinching = 0;
  /** a key pressed on the canvas (keys on): the arrows move the view by a sixth of the screen, + and - zoom by `step`
   *  levels (round the centre); true when it was one of them */
  key(k: string): boolean {
    if (!this.keys) return false;
    const g = this.gestures, pan = (dx: number, dy: number) => { if (!g.pan) return; this.glide = [0, 0]; this.panByHand(dx, dy); };
    const w = this.width / 6, h = this.height / 6;
    switch (k) {
      case 'ArrowLeft': pan(w, 0); return true;
      case 'ArrowRight': pan(-w, 0); return true;
      case 'ArrowUp': pan(0, h); return true;
      case 'ArrowDown': pan(0, -h); return true;
      case '+': case '=': case '-': case '_': {
        if (!g.zoom || !this.zoomInputs.keys) return true;
        const out = k === '-' || k === '_';
        this.zoomLeft = Math.min(8, Math.max(1 / 8, this.zoomLeft * 2 ** (out ? this.step : -this.step))); this.zoomAtPx = [this.width / 2, this.height / 2]; this.changed?.();
        return true;
      }
      default: return false;
    }
  }

  private el: HTMLElement | null = null;
  /** with the keys on, the element it is attached to takes the focus (a tab stop, focused by a press) */
  focusable(): void { const el = this.el; if (!el || !this.keys || el.tabIndex >= 0) return; el.tabIndex = 0; el.addEventListener('pointerdown', () => el.focus({ preventScroll: true })); }
  /** pointer, touch and wheel on an element; returns the function that removes them all */
  attach(el: HTMLElement, onTap?: (x: number, y: number) => void): () => void {
    const pts = new Map<number, { x: number; y: number }>();
    let moved = 0, pinch = 0, twist = 0, mid: [number, number] | null = null, midY = 0, vel: [number, number] = [0, 0], tMove = 0;
    const local = (x: number, y: number): [number, number] => { const r = el.getBoundingClientRect(); return [x - r.left, y - r.top]; };
    const two = () => { const [a, b] = [...pts.values()] as [{ x: number; y: number }, { x: number; y: number }]; return { d: Math.hypot(a.x - b.x, a.y - b.y), ang: Math.atan2(b.y - a.y, b.x - a.x), m: [(a.x + b.x) / 2, (a.y + b.y) / 2] as [number, number] }; };
    const prevTouch = el.style.touchAction; el.style.touchAction = 'none';
    const on: [string, (e: Event) => void, AddEventListenerOptions?][] = [];
    const add = <K extends keyof HTMLElementEventMap>(t: K, f: (e: HTMLElementEventMap[K]) => void, o?: AddEventListenerOptions) => { el.addEventListener(t, f as EventListener, o); on.push([t, f as (e: Event) => void, o]); };
    add('contextmenu', (e) => e.preventDefault());
    add('pointerdown', (e) => {
      if (!this.interrupt && (this.motion || this.playing || this.driver)) return;
      // (a press stops a flight and camera keys; a move and a follow end only when the hands move what they keep)
      const d = this.driver; this.driver = null;
      el.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); this.stop(); this.driver = d; this.touches++; this.pressed = pts.size; this.pinching = pts.size >= 2 ? 1 : 0; if (this.snapping) { this.snapping = false; this.zoomLeft = 1; }
      if (pts.size === 1) { moved = 0; vel = [0, 0]; }
      if (pts.size === 2) { const t = two(); pinch = t.d; twist = t.ang; mid = t.m; midY = t.m[1]; }
    });
    add('pointermove', (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      this.changed?.();
      const dx = e.clientX - p.x, dy = e.clientY - p.y; p.x = e.clientX; p.y = e.clientY; moved += Math.abs(dx) + Math.abs(dy);
      if (pts.size === 1) {
        // (the left button or a finger: the drag's own; the other button or Shift: the other)
        const own = !(e.buttons & 2) && !e.shiftKey;
        if (own === (this.drag === 'pan')) {
          if (!this.gestures.pan) return;
          this.panByHand(dx, dy);
          const t = performance.now(), ddt = Math.max(1, t - tMove); tMove = t;
          vel = [vel[0] * 0.6 + (dx / ddt) * 0.4, vel[1] * 0.6 + (dy / ddt) * 0.4];
        } else this.turnByHand(-dx * 0.006, dy * 0.005);
      } else if (pts.size === 2 && mid) {
        const t = two();
        const g = this.gestures;
        // (two fingers on one point give no ratio yet)
        if (g.zoom && this.zoomInputs.pinch && pinch > 0) this.zoomByHand(pinch / Math.max(1, t.d), ...local(t.m[0], t.m[1]));
        if (g.rotate && t.ang !== twist) { this.yaw += t.ang - twist; this.byHand('turn'); }
        // two fingers moving up / down together: tilt
        const dm = t.m[1] - midY; if (Math.abs(t.d - pinch) < 4) this.turnByHand(0, dm * 0.004);
        if (g.pan) this.panByHand(t.m[0] - mid[0], 0);
        vel = [0, 0]; pinch = t.d; twist = t.ang; mid = t.m; midY = t.m[1];
      }
    });
    const up = (e: PointerEvent) => {
      if (pts.size === 1 && moved < 8 && e.type === 'pointerup') { const r = el.getBoundingClientRect(); onTap?.(e.clientX - r.left, e.clientY - r.top); }
      else if (pts.size === 1 && performance.now() - tMove < 60 && Math.hypot(...vel) > 0.15) this.glide = [vel[0], vel[1]];
      pts.delete(e.pointerId); if (pts.size < 2) mid = null;
      this.pressed = pts.size; if (pts.size < 2) this.pinching = 0;
    };
    add('pointerup', up); add('pointercancel', up);
    add('wheel', (e) => {
      e.preventDefault();
      if (!this.gestures.zoom || !this.zoomInputs.wheel || (!this.interrupt && (this.motion || this.playing || this.driver))) return;
      // the wheel takes the camera as a touch does: flights and keys end (a move ends as it zooms; a follow goes on)
      if (this.motion || this.playing) { const d = this.driver; this.driver = null; this.stop(); this.driver = d; }
      this.glide = [0, 0]; this.touches++; this.snapping = false;
      const d = e.deltaY * (e.deltaMode === 1 ? 16 : 1) * (e.ctrlKey ? 0.01 : 0.0018);
      this.zoomLeft = Math.min(8, Math.max(1 / 8, this.zoomLeft * Math.exp(d))); this.zoomAtPx = local(e.clientX, e.clientY); this.changed?.();
    }, { passive: false });
    // the keys (controllers.orbit({ keys: true })): the canvas takes the focus to hear them
    add('keydown', (e) => { if (!e.ctrlKey && !e.metaKey && !e.altKey && this.key(e.key)) e.preventDefault(); });
    this.el = el; this.focusable();
    return () => { for (const [t, f, o] of on) el.removeEventListener(t, f, o); el.style.touchAction = prevTouch; this.el = null; };
  }
}
