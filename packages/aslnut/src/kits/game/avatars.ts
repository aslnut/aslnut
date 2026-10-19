// kits › game › avatars: walk, drive or fly through the world with a camera behind you, as in a game. Built on core ›
// entities: the avatar is an entity (a walker with swinging legs, a car, a drone) moved by a person's controller
// (walk, ride, fly) through its locomotion (on the ground, on wheels, in the air), stopped by what stands in its way
// (kits › game › collision), the camera following behind and above, pulled in before a wall, or from its eyes (first
// person, V). Near a vehicle F gets in and out. The street level keeps streaming round it.
//   keys: W A S D move · Shift run / boost · Space jump (walk) / up (drone) · Q C down · F in / out · V eyes / behind · drag to look · wheel zoom · Esc
//   touch: a stick bottom left to move, drag anywhere else to look, ▲ ▼ for the drone, ⇄ in / out, ◉ eyes / behind
//   const av = avatars(w, { start: (at) => nearestStreet(at), obstacle: collision(w) }); w.add(av.layer); av.setMode('walk')
import { MeshBuilder, shapeOf } from '../../core/geometry/shapes/mesh.ts';
import type { Made } from '../../core/geometry/shapes/shape.ts';
import type { World } from '../../core/world/world.ts';
import { D } from '../../core/space/geo.ts';
import { air, control, controllers, entity, EntityElement, surface, type Entity } from '../../core/entities/index.ts';
import type { Figure } from '../../core/entities/body/skin.ts';

export type AvatarMode = 'map' | 'walk' | 'car' | 'drone';
export interface AvatarOptions {
  /** where to start when leaving the map: a street near the centre, facing along it (default: the centre, as it faces) */
  start?: (at: [number, number]) => { at: [number, number]; heading: number } | null;
  /** a mode changed (the map is 'map') */
  onMode?: (m: AvatarMode) => void;
  /** on-screen controls for touch (default: when the device has touch) */
  touch?: boolean;
  /** what stands on the ground at a place (m over it: a building; 0: open): kits › game › collision */
  obstacle?: (lon: number, lat: number) => number;
  /** the walker's, the car's and the drone's colours (the plain shapes) */
  colors?: { shirt?: string; pants?: string; skin?: string; car?: string; cabin?: string; drone?: string };
  /** your own shapes (core › geometry › shapes: () => shape(...).make(), made when first needed): the walker by its stride (0 … 1: legs apart one way
   *  … the other), the car, the drone; the plain ones where you give none */
  shapes?: { walker?: (stride: number) => Made; car?: () => Made; drone?: () => Made };
  /** a skinned body to walk as (core › entities › body: a figure, its palette and decal numbers; `figure` may give null
   *  until it is made): drawn near instead of the walker shape, which stays its far form and its fallback */
  body?: AvatarBody | null;
  /** the camera: behind and above ('follow', default) or from the avatar's eyes ('first-person'); V switches */
  camera?: 'follow' | 'first-person';
  /** vehicles one can get into on foot: near one (within 3 m of its 'entry' or 'driver' anchor, else of its middle),
   *  F (or the touch button) gets in and drives it; F again gets out beside it. Unset: none */
  vehicles?: {
    near: () => { id: string; at: [number, number]; heading: number; made: Made }[];
    /** it was got into: take it off the street (it drives as the avatar now) */
    onEnter?: (id: string) => void;
    /** it was got out of: leave it parked here */
    onExit?: (v: { id: string; at: [number, number]; heading: number; made: Made }) => void;
  };
}
/** a body the avatar walks as */
export interface AvatarBody { figure: () => Figure | null; palette?: readonly (string | number)[]; decal?: readonly [number, number, number]; scale?: number }
const as = (sh: Float32Array): Made => ({ levels: [sh], parts: [], anchors: [], triangles: [sh.length / 18], bounds: [[0, 0, 0], [1, 1, 1]] });

/** the shapes: a walker in five strides (legs and arms swung), a car, a drone with its rotors */
function makeShapes(c: Required<NonNullable<AvatarOptions['colors']>>) {
  const walker = (sw: number) => as(shapeOf((mb: MeshBuilder) => {
    const legs = (x: number, a: number) => { const s = Math.sin(a) * 0.41, co = Math.cos(a) * 0.82; mb.box(x, s, 0.85 - co, 0.16, co, 0.18, 0, c.pants); };
    const arms = (x: number, a: number) => { const s = Math.sin(a) * 0.3, co = Math.cos(a) * 0.6; mb.box(x, -s, 1.42 - co, 0.11, co, 0.12, 0, c.shirt); };
    mb.box(0, 0, 0.85, 0.42, 0.6, 0.24, 0, c.shirt); mb.blob(0, 1.62, 0, 0.15, 0.15, 0.15, c.skin, 1);
    legs(-0.1, sw); legs(0.1, -sw); arms(-0.28, -sw * 0.8); arms(0.28, sw * 0.8);
  }));
  return {
    walker: [-0.8, -0.4, 0, 0.4, 0.8].map(walker),
    car: as(shapeOf((mb) => { mb.box(0, 0, 0.32, 1.8, 0.6, 4.2, 0, c.car); mb.box(0, 0.2, 0.92, 1.6, 0.55, 2.1, 0, c.cabin); for (const [x, z] of [[-0.85, -1.35], [0.85, -1.35], [-0.85, 1.35], [0.85, 1.35]] as const) mb.box(x, z, 0, 0.26, 0.68, 0.68, 0, '#111111'); })),
    drone: as(shapeOf((mb) => {
      mb.box(0, 0, -0.08, 0.5, 0.16, 0.5, 0, c.drone);
      for (const [x, z] of [[-0.42, -0.42], [0.42, -0.42], [-0.42, 0.42], [0.42, 0.42]] as const) { mb.box(x / 2, z / 2, -0.02, 0.06, 0.04, 0.6, Math.atan2(z, x) + Math.PI / 2, '#374151'); mb.cylinder(x, z, 0.06, 0.08, 0.22, 0.22, 12, '#9ca3af'); }
    })),
  };
}

export class Avatars {
  readonly element = new EntityElement({ id: 'avatar' });
  mode: AvatarMode = 'map';
  /** the avatar (an entity) */
  readonly me: Entity;
  private w: World; private o: AvatarOptions; private made: { walker: Made[]; car: Made; drone: Made } | null = null;
  /** the shapes, made when first needed (a page that never leaves the map makes none); the plain ones only where you
   *  give none */
  private get shapes(): { walker: Made[]; car: Made; drone: Made } {
    if (this.made) return this.made;
    const o = this.o, yours = o.shapes ?? {}, plain = !yours.walker || !yours.car || !yours.drone ? makeShapes({ shirt: '#2f6fb0', pants: '#2b2f3a', skin: '#e0b48f', car: '#c0392b', cabin: '#2c3e50', drone: '#e5e7eb', ...o.colors }) : null;
    return (this.made = { walker: yours.walker ? [0, 0.25, 0.5, 0.75, 1].map(yours.walker) : plain!.walker, car: yours.car?.() ?? plain!.car, drone: yours.drone?.() ?? plain!.drone });
  }
  private stop: (() => void) | null = null; private offs: (() => void)[] = []; private ui: HTMLElement | null = null; private minDist0: number;
  constructor(w: World, o: AvatarOptions = {}) {
    this.w = w; this.o = o; this.minDist0 = w.camera.minDist; this.view = o.camera ?? 'follow';

    // the avatar: an entity (core › entities) of kind person, its shape by the mode and its stride
    this.me = entity({ id: 'me', kind: 'person', placement: 'thing', at: [w.camera.lon, w.camera.lat], shape: (e) => (this.view === 'first-person' && this.mode !== 'drone' ? null : this.mode === 'car' ? this.shapes.car : this.mode === 'drone' ? this.shapes.drone : this.shapes.walker[Math.round(((Math.sin(e.gait) * Math.min(1, e.speed / 2.8)) * 0.5 + 0.5) * 4)]!),
      body: () => (this.mode === 'walk' && this.view !== 'first-person' ? this.bodyNow?.figure() ?? null : null) });
    this.setBody(o.body ?? null);
    if (typeof window !== 'undefined') {
      const esc = (e: KeyboardEvent) => { if (this.mode !== 'map' && e.code === 'Escape') this.setMode('map'); if (e.code === 'KeyF' && o.vehicles) this.enterOrExit(); if (e.code === 'KeyV' && this.mode !== 'map') this.setCamera(this.view === 'follow' ? 'first-person' : 'follow'); };
      addEventListener('keydown', esc); this.offs.push(() => removeEventListener('keydown', esc));
    }
  }
  /** the camera now */
  view: 'follow' | 'first-person' = 'follow';
  private bodyNow: AvatarBody | null = null;
  /** walk as another body (null: the walker shape) */
  setBody(b: AvatarBody | null): this {
    this.bodyNow = b;
    if (b?.palette) this.me.setPalette(b.palette);
    if (b?.decal) this.me.decal = [b.decal[0], b.decal[1], b.decal[2]];
    this.me.scale = b?.scale ?? 1;
    this.w.invalidate();
    return this;
  }
  /** the camera behind and above, or from the avatar's eyes (the avatar not drawn then; a drone keeps its camera behind) */
  setCamera(v: 'follow' | 'first-person'): this { if (v === this.view) return this; this.view = v; if (this.mode !== 'map') { this.stop?.(); this.drive(this.mode); this.w.invalidate(); } return this; }
  private drive(m: Exclude<AvatarMode, 'map'>): void {
    const fp = this.view === 'first-person' && m !== 'drone';
    this.stop = control(this.w, this.element, this.me, m === 'walk' ? controllers.walk() : m === 'car' ? controllers.ride() : controllers.fly(), fp ? { eye: m === 'walk' ? 1.62 : 1.15 } : { offset: m === 'walk' ? [0, 2, -7] : m === 'car' ? [0, 3.5, -12] : [0, 8, -17], blocked: m === 'drone' ? undefined : this.o.obstacle });
  }
  /** the vehicle being driven (one got into), or null */
  riding: { id: string; made: Made } | null = null;
  /** get into the nearest vehicle (walking), or out of the one being driven */
  enterOrExit(): boolean {
    const v = this.o.vehicles; if (!v) return false;
    const me = this.me, kx = 111320 * Math.cos((me.at[1] * Math.PI) / 180);
    if (this.mode === 'car' && this.riding) {
      const r = this.riding, h = (me.heading * Math.PI) / 180, side = 1.8;
      // out on the driver's side, the car left parked
      v.onExit?.({ id: r.id, at: [me.at[0], me.at[1]], heading: me.heading, made: r.made });
      this.riding = null; this.made && (this.made = { ...this.made, car: this.carMade0 ?? this.made.car });
      // to its right (heading clockwise from north: right is (cos h east, −sin h north))
      me.at = [me.at[0] + (Math.cos(h) * side) / kx, me.at[1] - (Math.sin(h) * side) / 110574, NaN];
      this.setMode('walk'); return true;
    }
    if (this.mode !== 'walk') return false;
    let best: { id: string; at: [number, number]; heading: number; made: Made } | null = null, bd = 3;
    for (const c of v.near()) {
      const a = c.made.anchors.find((x) => x.kind === 'entry' || x.name === 'entry' || x.kind === 'seat' || x.name === 'driver'), h = (c.heading * Math.PI) / 180;
      // the anchor in the world (east, south metres): the shape turned as its instance is (heading + half a turn)
      const ax = a ? a.at[0] : 0, az = a ? a.at[2] : 0, t = h + Math.PI, ex = ax * Math.cos(t) - az * Math.sin(t), es = ax * Math.sin(t) + az * Math.cos(t);
      const d = Math.hypot((c.at[0] - me.at[0]) * kx + ex, (c.at[1] - me.at[1]) * 110574 - es);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) return false;
    v.onEnter?.(best.id);
    const shapes = this.shapes; this.carMade0 ??= shapes.car; this.made = { ...shapes, car: best.made };
    this.riding = { id: best.id, made: best.made };
    me.at = [best.at[0], best.at[1], NaN]; me.heading = best.heading; this.element.look = (best.heading * Math.PI) / 180;
    this.setMode('car'); return true;
  }
  private carMade0: Made | null = null;
  /** km/h now */
  get kmh(): number { return this.mode === 'map' ? 0 : this.me.speed * 3.6; }
  /** change mode: from the map, the avatar starts at the view's centre (or a street near it) */
  setMode(next: AvatarMode): this {
    if (next === this.mode) return this;
    const w = this.w, c = w.camera, me = this.me;
    this.stop?.(); this.stop = null;
    if (this.mode === 'map') {
      me.at = [c.lon, c.lat, NaN]; me.heading = c.view.bearing;
      const st = next !== 'drone' ? this.o.start?.([c.lon, c.lat]) : null;
      if (st) { me.at = [st.at[0], st.at[1], NaN]; me.heading = st.heading / D; }
      me.velocity = [0, 0, 0]; me.speed = 0;
    }
    if (next === 'drone' && this.mode !== 'drone') me.altitude = 25;
    this.mode = next;
    if (next === 'map') {
      this.element.remove('me'); w.camera.minDist = this.minDist0;
      void w.fly({ lon: me.at[0], lat: me.at[1], zoom: 17.2, tilt: 58, bearing: this.element.look / D }, { seconds: 1 });
    } else {
      if (!this.element.get('me')) this.element.add(me);
      me.locomotion = next === 'walk' ? surface({ speed: 5 / 3.6, run: 18 / 3.6, blocked: this.o.obstacle }) : next === 'car' ? surface({ wheels: {}, blocked: this.o.obstacle }) : air({ ceiling: 400 });
      w.camera.minDist = 1.5;
      this.drive(next);
    }
    this.touchUI();
    this.o.onMode?.(next);
    w.invalidate();
    return this;
  }
  /** the on-screen stick and buttons (touch) */
  private touchUI(): void {
    const touch = this.o.touch ?? (typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches);
    if (this.mode === 'map' || !touch || typeof document === 'undefined') { this.ui?.remove(); this.ui = null; return; }
    if (this.ui) return;
    const ui = document.createElement('div'); this.ui = ui; const input = this.element.input;
    Object.assign(ui.style, { position: 'fixed', left: '18px', bottom: 'calc(84px + env(safe-area-inset-bottom))', width: '120px', height: '120px', borderRadius: '60px', background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.3)', zIndex: '20', touchAction: 'none' });
    const knob = document.createElement('div'); Object.assign(knob.style, { position: 'absolute', left: '40px', top: '40px', width: '40px', height: '40px', borderRadius: '20px', background: 'rgba(255,255,255,.55)' }); ui.appendChild(knob);
    let id = -1;
    const set = (e: PointerEvent) => { const r = ui.getBoundingClientRect(), cx = r.left + 60, cy = r.top + 60; let sx = (e.clientX - cx) / 50, sy = (e.clientY - cy) / 50; const l = Math.hypot(sx, sy); if (l > 1) { sx /= l; sy /= l; } input.stick = [sx, sy]; this.w.invalidate(); knob.style.left = `${40 + sx * 40}px`; knob.style.top = `${40 + sy * 40}px`; };
    ui.addEventListener('pointerdown', (e) => { id = e.pointerId; ui.setPointerCapture(e.pointerId); set(e); e.stopPropagation(); });
    ui.addEventListener('pointermove', (e) => { if (e.pointerId === id) set(e); });
    const end = (e: PointerEvent) => { if (e.pointerId !== id) return; id = -1; input.stick = [0, 0]; knob.style.left = '40px'; knob.style.top = '40px'; };
    ui.addEventListener('pointerup', end); ui.addEventListener('pointercancel', end);
    const btn = (label: string, bottom: number, v: number) => { const b = document.createElement('button'); b.textContent = label; Object.assign(b.style, { position: 'fixed', right: '18px', bottom: `calc(${bottom}px + env(safe-area-inset-bottom))`, width: '56px', height: '56px', borderRadius: '28px', background: 'rgba(255,255,255,.16)', color: '#fff', border: '1px solid rgba(255,255,255,.35)', fontSize: '20px', zIndex: '20', touchAction: 'none' }); b.addEventListener('pointerdown', (e) => { input.up = v; this.w.invalidate(); e.stopPropagation(); }); b.addEventListener('pointerup', () => { input.up = 0; }); b.addEventListener('pointercancel', () => { input.up = 0; }); ui.appendChild(b); };
    btn('▲', 150, 1); btn('▼', 84, -1);
    if (this.o.vehicles) { const b = document.createElement('button'); b.textContent = '⇄'; b.title = 'get in / out'; Object.assign(b.style, { position: 'fixed', right: '18px', bottom: 'calc(216px + env(safe-area-inset-bottom))', width: '56px', height: '56px', borderRadius: '28px', background: 'rgba(255,255,255,.16)', color: '#fff', border: '1px solid rgba(255,255,255,.35)', fontSize: '20px', zIndex: '20', touchAction: 'none' }); b.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.enterOrExit(); }); ui.appendChild(b); }
    { const b = document.createElement('button'); b.textContent = '◉'; b.title = 'camera: behind / eyes'; Object.assign(b.style, { position: 'fixed', right: '84px', bottom: 'calc(84px + env(safe-area-inset-bottom))', width: '56px', height: '56px', borderRadius: '28px', background: 'rgba(255,255,255,.16)', color: '#fff', border: '1px solid rgba(255,255,255,.35)', fontSize: '20px', zIndex: '20', touchAction: 'none' }); b.addEventListener('pointerdown', (e) => { e.stopPropagation(); this.setCamera(this.view === 'follow' ? 'first-person' : 'follow'); }); ui.appendChild(b); }
    document.body.appendChild(ui);
  }
  dispose(): void { this.stop?.(); for (const f of this.offs) f(); this.offs = []; this.ui?.remove(); this.ui = null; this.w.camera.minDist = this.minDist0; }
}
/** walk, car and drone: a third-person camera behind an avatar on the ground */
export const avatars = (w: World, o: AvatarOptions = {}) => new Avatars(w, o);
